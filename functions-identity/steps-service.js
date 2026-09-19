'use strict';
// Extracted settlement implementation; parity is checked against index.js.
module.exports=({db,FieldValue,onSchedule,logger})=>{
const IST='Asia/Kolkata',REGION='asia-south1';
function istNow(){return new Date(Date.now()+19800000);}
async function liveGroups(){
  const gs = await db.collection('groups').get();
  const out = [];
  for(const g of gs.docs){
    const d = g.data();
    if(d.demo === true || !d.currentSeasonId) continue;
    const s = await db.collection('groups').doc(g.id)
                      .collection('seasons').doc(d.currentSeasonId).get();
    if(s.exists) out.push({ code:g.id, name:d.name||g.id, sid:d.currentSeasonId, season:s.data() });
  }
  return out;
}

const STEP_ROUNDS_PER_MONTH = 4;
const STEP_PER_MEMBER_TARGET = 70000;   // per member per 7 days (10k/day)
const STEP_WIN_BONUS = 5;
const STEP_DAILY_CAP = 100000;
const STEP_RESOLVE_GRACE_H = 36;
const {score:stepSeasonScore}=require('./scoring-engine');

// Finalize the walked month after all four immutable step results exist.
// The transaction reconciles any old premature snapshot without double awards.
async function finalizeStepSeason(code,sid){
  const sRef=db.collection('groups').doc(code).collection('seasons').doc(sid);
  const ss=await sRef.get();if(!ss.exists)return false;
  const s=ss.data();if(!s.stepRounds?.enabled||s.stepsFinalizedAt)return false;
  const rounds=stepRoundsOf(s);
  if(Date.now()<stepCutoff(s,rounds[3]))return false;
  const windows=await sRef.collection('twistWindows').get(),ws=windows.docs.map(d=>d.data());
  if(!rounds.every(r=>ws.some(w=>w.week===stepRoundId(sid,r)&&Array.isArray(w.awarded)&&w.settledBy==='server-sweep')))return false;
  const [logs,bonus,twists,jack,ip,gSnap]=await Promise.all([
    db.collection('logs').where('groupCode','==',code).where('month','==',s.month).where('year','==',s.year).get(),
    db.collection('bonuses_30day').where('groupCode','==',code).where('month','==',s.month).where('year','==',s.year).get(),
    sRef.collection('twists').get(),sRef.collection('jackAwards').get(),
    db.collection('bonuses_iron_pledge').where('groupCode','==',code).where('month','==',s.month).where('year','==',s.year).get(),
    db.collection('groups').doc(code).get()
  ]);
  const ls=logs.docs.map(d=>d.data()).filter(l=>!l.voided),roster=s.roster||[];
  const ctx={season:s,groupCode:code,logs:ls,bonuses:bonus.docs.map(d=>d.data()),twists:Object.fromEntries(twists.docs.map(d=>[d.id,d.data()])),jackAwards:jack.docs.map(d=>d.data()),ironPledgeBonuses:ip.docs.map(d=>d.data()),twistWindows:ws};
  const ranked=roster.map(p=>({p,sc:stepSeasonScore(p.name,ctx)})).sort((a,b)=>b.sc.total-a.sc.total);
  const finalStandings=ranked.map(({p,sc},i)=>({userId:p.userId||null,name:p.name,team:p.team,total:sc.total,wo:sc.wo,streak:sc.streak,rank:i+1}));
  const teamStandings=[...new Set(roster.map(p=>p.team))].map(team=>{const rows=finalStandings.filter(p=>p.team===team);return {team,avg:Math.round(rows.reduce((n,p)=>n+p.total,0)/rows.length),memberCount:rows.length};}).sort((a,b)=>b.avg-a.avg).map((t,i)=>({...t,rank:i+1}));
  const first=finalStandings[0],second=finalStandings[1];
  const winner=first&&first.total>0&&(!second||first.total>second.total)?first.name:null;
  const tw=teamStandings.length>1&&teamStandings[0].avg>teamStandings[1].avg?teamStandings[0].team:null;
  const badgesAwarded=finalStandings.map(p=>({userId:p.userId,name:p.name,badges:[...(p.name===winner?['season_winner']:[]),...(p.team===tw?['team_winner']:[])]})).filter(p=>p.badges.length);
  return db.runTransaction(async tx=>{
    const fresh=await tx.get(sRef);if(!fresh.exists||fresh.data().stepsFinalizedAt)return false;
    const old=fresh.data(),targets=finalStandings.filter(p=>p.userId);
    // Refuse duplicate identities instead of incrementing one account twice.
    if(new Set(targets.map(p=>p.userId)).size!==targets.length)throw Error('Duplicate season identity; snapshot needs review');
    const users=await Promise.all(targets.map(p=>tx.get(db.collection('users').doc(p.userId))));
    const archives=await Promise.all(targets.map(p=>tx.get(db.collection('users').doc(p.userId).collection('seasons').doc(code+'_'+sid))));
    const stamp=FieldValue.serverTimestamp();
    tx.update(sRef,{finalStandings,teamStandings,badgesAwarded,snapshotAt:stamp,stepsFinalizedAt:stamp,statsAwardedAt:stamp});
    targets.forEach((p,i)=>{
      const badges=badgesAwarded.find(b=>b.name===p.name)?.badges||[];
      const previous=archives[i].exists?archives[i].data():null;
      const dayCounts=Array.from({length:s.days},(_,d)=>ls.filter(l=>l.player===p.name&&l.day===d+1).reduce((n,l)=>n+(Array.isArray(l.workouts)?l.workouts.length:1),0));
      const aRef=db.collection('users').doc(p.userId).collection('seasons').doc(code+'_'+sid);
      tx.set(aRef,{groupCode:code,sid,groupName:gSnap.data()?.name||code,month:s.month,year:s.year,rank:p.rank,total:p.total,wo:p.wo,streak:p.streak,team:p.team,teamRank:teamStandings.find(t=>t.team===p.team)?.rank||null,rosterSize:roster.length,badges,dayCounts});
      if(users[i].exists){
        const changes={};if(!previous)changes['stats.seasonsPlayed']=FieldValue.increment(1);
        for(const badge of ['season_winner','team_winner']){const delta=Number(badges.includes(badge))-Number((previous?.badges||[]).includes(badge));if(delta)changes['stats.badgeCounts.'+badge]=FieldValue.increment(delta);}
        if(Object.keys(changes).length)tx.update(db.collection('users').doc(p.userId),changes);
      }
    });
    return true;
  });
}

function stepCutoff(season,round){
  const end=Date.UTC(season.year,season.month-1,round.end+1)-19800000;
  return end+(round.end===new Date(Date.UTC(season.year,season.month,0)).getUTCDate()?18:36)*3600000;
}
function validStepDays(days,season,round){
  const out={};
  if(!days||typeof days!=='object'||Array.isArray(days))return out;
  for(const [key,n] of Object.entries(days)){
    if(!/^\d{4}-\d{2}-\d{2}$/.test(key)||typeof n!=='number'||!Number.isFinite(n)||!Number.isInteger(n)||n<0)continue;
    const [y,m,d]=key.split('-').map(Number);
    if(y!==season.year||m!==season.month||d<round.start||d>round.end||new Date(Date.UTC(y,m-1,d)).getUTCDate()!==d)continue;
    if(Date.UTC(y,m-1,d+1)-19800000>Date.now())continue;
    out[key]=Math.min(n,STEP_DAILY_CAP);
  }
  return out;
}

function stepRoundsOf(season){
  const n = Number.isInteger(season.year)&&Number.isInteger(season.month)&&season.month>=1&&season.month<=12
    ? new Date(Date.UTC(season.year,season.month,0)).getUTCDate()
    : Math.floor(Math.min(31,Math.max(28,Number(season.days)||30)));
  const base = Math.floor(n / STEP_ROUNDS_PER_MONTH);
  const extra = n % STEP_ROUNDS_PER_MONTH;
  const out = []; let start = 1;
  for (let i = 0; i < STEP_ROUNDS_PER_MONTH; i++){
    const len = base + (i < extra ? 1 : 0);
    out.push({ n: i + 1, start, end: start + len - 1, days: len });
    start += len;
  }
  return out;
}
const stepRoundId = (sid, r) => String(sid) + '-r' + r.n;
function stepTargetOf(season, round){
  const cfg = season.stepRounds || {};
  const t = Number(cfg.perMemberTarget);
  const per7 = (Number.isFinite(t) && t > 0) ? t : STEP_PER_MEMBER_TARGET;
  return Math.round(per7 / 7 * round.days);
}
function stepBonusOf(season){
  const cfg = season.stepRounds || {};
  const b = Number(cfg.bonus);
  return (Number.isFinite(b) && b >= 0) ? Math.min(b, 25) : STEP_WIN_BONUS;
}

async function settleOneRound(code, sid, season, round, roundEndDate){
  if(Date.now()<stepCutoff(season,round))return false;
  const week = stepRoundId(sid, round);
  const sRef = db.collection('groups').doc(code).collection('seasons').doc(sid);
  const winRef = sRef.collection('twistWindows').doc('step_week_' + week);

  const winSnap = await winRef.get();
  if(winSnap.exists && Array.isArray((winSnap.data()||{}).awarded)) return false;

  const q = await sRef.collection('stepWeeks').where('week','==',week).get();
  const stepDocs = q.docs.map(d => d.data());

  const roster = (season.roster||[]).filter(p => p && p.departed !== true);
  const teamOf = new Map(roster.map(p => [p.name, p.team]));
  const byPlayer = new Map();
  const daysByPlayer = new Map();
  for(const d of stepDocs){
    if(!d||!teamOf.has(d.player)||d.week!==week)continue;
    const days=daysByPlayer.get(d.player)||{};
    for(const [key,n] of Object.entries(validStepDays(d.days,season,round)))days[key]=Math.max(days[key]??0,n);
    daysByPlayer.set(d.player,days);
  }
  for(const [name,days] of daysByPlayer)byPlayer.set(name,Object.values(days).reduce((a,b)=>a+b,0));
  const teamSum = new Map(), teamSize = new Map();
  for(const p of roster){
    teamSize.set(p.team, (teamSize.get(p.team)||0)+1);
    teamSum.set(p.team, (teamSum.get(p.team)||0)+(byPlayer.get(p.name)||0));
  }
  const teams = [...teamSize.keys()].map(t => ({
    team:t, size:teamSize.get(t), sum:teamSum.get(t)||0,
    avg:(teamSum.get(t)||0)/(teamSize.get(t)||1)
  })).sort((a,b) => b.avg - a.avg);
  const hasData=[...daysByPlayer.values()].some(days=>Object.keys(days).length>0);

  const target = stepTargetOf(season, round);
  let winnerTeam = null, cleared = false;
  if(hasData&&teams.length === 1){
    if(teams[0].avg >= target){ winnerTeam = teams[0].team; cleared = true; }
  } else if(hasData&&teams.length>1&&teams[0].avg > teams[1].avg){
    winnerTeam = teams[0].team;
    cleared = teams[0].avg >= target;
  }
  const awarded = winnerTeam ? roster.filter(p => p.team === winnerTeam).map(p => p.name) : [];
  const start = new Date(season.year, season.month - 1, round.start);
  try{
    await winRef.create({                            // create-only: a racing client wins, we back off
      twist:'step_week', week,
      monDate: start.getDate(), sunDate: round.end,
      month: start.getMonth()+1, year: start.getFullYear(),
      bonus: stepBonusOf(season),
      winner: winnerTeam, awarded, cleared, target,
      status:hasData?(winnerTeam?'settled':'no_winner'):'no_data',
      cutoffAt:new Date(stepCutoff(season,round)).toISOString(),
      standings: teams.map(t => ({ team:t.team, avg:Math.round(t.avg) })),
      resolvedAt: FieldValue.serverTimestamp(),
      settledBy: 'server-sweep'
    });
  }catch(e){
    if(String(e && e.code) === '6' || /already exists/i.test(String(e))) return false;
    throw e;
  }
  return true;
}

return onSchedule(
  { schedule: '0 * * * *', timeZone: IST, region: REGION },
  async () => {
    const now = istNow();
    const day = now.getUTCDate(), month = now.getUTCMonth()+1, year = now.getUTCFullYear();
    let settled = 0;
    for(const g of await liveGroups()){
      const season = g.season;
      try{
        if(season.stepRounds && season.stepRounds.enabled === true
           && Date.UTC(season.year,season.month-1,1)<=Date.UTC(year,month-1,day)){
          // every finished round of the CURRENT season, past its grace
          for(const r of stepRoundsOf(season)){
            if(Date.now()<stepCutoff(season,r))continue;
            if(await settleOneRound(g.code, g.sid, season, r, r.end)) settled++;
          }
          await finalizeStepSeason(g.code,g.sid);
        }
        // previous season's final round, during the first days of a month
        {
          let pm = month - 1, py = year;
          if(pm < 1){ pm = 12; py--; }
          const psid = `${py}-${String(pm).padStart(2,'0')}`;
          const pSnap = await db.collection('groups').doc(g.code)
                                .collection('seasons').doc(psid).get();
          if(pSnap.exists){
            const pSeason = pSnap.data();
            if(pSeason.stepRounds && pSeason.stepRounds.enabled === true){
              for(const round of stepRoundsOf(pSeason))if(Date.now()>=stepCutoff(pSeason,round)){
                if(await settleOneRound(g.code,psid,pSeason,round,round.end))settled++;
              }
              await finalizeStepSeason(g.code,psid);
            }
          }
        }
      }catch(e){ logger.error(`settleSweep ${g.code}:`, e); }
    }
    logger.info(`settleSweep: ${settled} round(s) settled server-side`);
  });

};
