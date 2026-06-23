// Season-only config + roster accessors, now context-aware so the global
// leaderboard can score players in OTHER groups by passing their data in.
// Default (no ctx) reads the live globals exactly as before — so every existing
// score(name) / teamTotal(team) call is unchanged.
function _seasonOf(ctx){ return (ctx && ctx.season) || window.season || {}; }
function _logsOf(ctx){ return (ctx && ctx.logs) || (typeof allLogs!=='undefined' ? allLogs : []) || []; }
function _twistsOf(ctx){ return (ctx && ctx.twists) || (typeof activeTwists!=='undefined' ? activeTwists : {}) || {}; }
function _bonusesOf(ctx){ return (ctx && ctx.bonuses) || (typeof bonus30!=='undefined' ? bonus30 : []) || []; }
function _rosterOf(ctx){ const s=_seasonOf(ctx); return (s && Array.isArray(s.roster)) ? s.roster : []; }
function _jackAwardsOf(ctx){ return (ctx&&ctx.jackAwards)||(typeof jackAwards!=='undefined'?jackAwards:[])||[]; }
function _ironPledgeBonusesOf(ctx){ return (ctx&&ctx.ironPledgeBonuses)||(typeof ironPledgeBonuses!=='undefined'?ironPledgeBonuses:[])||[]; }
function _twistWindowsOf(ctx){ return (ctx&&ctx.twistWindows)||(typeof twistWindows!=='undefined'?twistWindows:[])||[]; }
function _activeGroupCode(ctx){ return (ctx&&ctx.groupCode)||groupCode||''; }

const _EMPTY_SET = new Set();

// ── SNAPSHOT CACHE ──────────────────────────────────────────────────────────
// score() used to re-scan the whole log array per call, and the team-streak /
// underdog sections re-scanned it per roster entry per call — one leaderboard
// render cost O(P² · N). All of that work depends only on the current data
// snapshot, so it's built once per snapshot below and each player's final
// score object is memoised. Keyed by the logs array reference (the app always
// REPLACES these arrays on Firestore snapshots, never mutates them in place)
// and revalidated against the other data refs + scalar config + today's date.
const _scoreCache = new WeakMap();

function _ctxEntry(ctx){
  const cfg=_seasonOf(ctx), logs=_logsOf(ctx), roster=_rosterOf(ctx);
  const twists=_twistsOf(ctx), bonuses=_bonusesOf(ctx);
  const jacks=_jackAwardsOf(ctx), ips=_ironPledgeBonusesOf(ctx);
  const tw=_twistWindowsOf(ctx);
  const myGC=_activeGroupCode(ctx);
  const today=new Date();
  const stamp=[cfg.month,cfg.year,cfg.days,cfg.capTarget,cfg.vcTarget,cfg.minWorkouts,
               cfg.rolesEnabled,cfg.teamStreakThreshold,myGC,today.toDateString()].join('|');
  const hit=_scoreCache.get(logs);
  if(hit && hit.cfg===cfg && hit.rosterRef===roster && hit.twists===twists &&
     hit.bonuses===bonuses && hit.jacks===jacks && hit.ips===ips && hit.tw===tw && hit.stamp===stamp) return hit;

  const {month, year} = cfg;
  const DAYS = cfg.days ?? 31;

  // Per-player log/day indexes — one O(N) pass over the logs.
  const rosterByName=new Map(roster.map(p=>[p.name,p]));
  const teamOf=new Map(roster.map(p=>[p.name,p.team]));
  const logsByPlayer=new Map(), daysByPlayer=new Map();
  const teamDayLog=new Map();                        // team → Map(day → Set(player))
  for(const l of logs){
    let arr=logsByPlayer.get(l.player); if(!arr) logsByPlayer.set(l.player,arr=[]);
    arr.push(l);
    let ds=daysByPlayer.get(l.player); if(!ds) daysByPlayer.set(l.player,ds=new Set());
    ds.add(l.day);
    if(teamOf.has(l.player)){                        // roster's CURRENT team, not the log's stored team
      const t=teamOf.get(l.player);
      let td=teamDayLog.get(t); if(!td) teamDayLog.set(t,td=new Map());
      let s=td.get(l.day); if(!s) td.set(l.day,s=new Set());
      s.add(l.player);
    }
  }

  // Team-streak qualifying days, resolved once per team instead of per player.
  const thrFactor=cfg.teamStreakThreshold ?? 0.6;
  const teamCount=new Map();
  roster.forEach(p=>teamCount.set(p.team,(teamCount.get(p.team)||0)+1));
  const qualByTeam=new Map();
  for(const [t,count] of teamCount){
    const td=teamDayLog.get(t);
    const thr=Math.ceil(count*thrFactor);
    const qual=[]; let run=0;
    for(let d=1; d<=DAYS; d++){
      const s=(td && td.get(d)) || _EMPTY_SET;
      if(s.size>=thr){ run++; qual.push({set:s, streakLen:run}); }
      else run=0;
    }
    qualByTeam.set(t,qual);
  }

  // Twist + bonus lookups.
  const bonusWT=twists['bonus_workout'];
  const bonusWord=bonusWT?.enabled ? (bonusWT.workout||'').toLowerCase() : null;
  const friOn=!!twists['freaky_fridays']?.enabled;
  const monOn=!!twists['monday_motivation']?.enabled;

  // ── WEEK-BOUND WINDOWS (Boss Week + Underdog Week) ──
  // Scoring reads PERMANENT window docs, never the live toggle — so toggling a
  // twist on/off can never retroactively change a past window's effect.
  const seasonWindows=tw.filter(w=>w && w.month===month && w.year===year);
  // Boss Week: any day-of-month inside a boss_week window's [monDate,sunDate] is doubled.
  const bossDays=new Set();
  for(const w of seasonWindows){
    if(w.twist!=='boss_week') continue;
    for(let d=w.monDate; d<=w.sunDate; d++) bossDays.add(d);   // spanning weeks (mon>sun) add nothing — safe
  }
  // Underdog Week: each window froze its last-place players at activation time.
  const underdogWindows=seasonWindows
    .filter(w=>w.twist==='underdog_week')
    .map(w=>({monDate:w.monDate, sunDate:w.sunDate, frozen:new Set(w.frozenPlayers||[])}));

  const b30Set=new Set(bonuses.map(b=>b.player));
  const jackCnt=new Map();
  jacks.forEach(a=>{ if(!a.groupCode||a.groupCode===myGC) jackCnt.set(a.player,(jackCnt.get(a.player)||0)+1); });
  const ipSum=new Map();
  ips.forEach(b=>{ if(b.groupCode===myGC) ipSum.set(b.player,(ipSum.get(b.player)||0)+(b.type==='double'?+b.rawPoints:-b.rawPoints)); });

  // Date math, computed once per snapshot.
  const dowBase=new Date(year,month-1,1).getDay();   // dow of day d = (dowBase+d-1)%7
  const todayInSeason=today.getMonth()+1===month && today.getFullYear()===year;
  const todayDay=todayInSeason ? today.getDate() : DAYS;
  const seasonPast=(today.getFullYear()>year) || (today.getFullYear()===year && today.getMonth()+1>month);
  const isEnd=seasonPast || (todayInSeason && today.getDate()===DAYS);

  const entry={
    cfg, rosterRef:roster, twists, bonuses, jacks, ips, tw, stamp,
    DAYS, capTarget:cfg.capTarget??16, vcTarget:cfg.vcTarget??20, minWorkouts:cfg.minWorkouts??12,
    rolesEnabled:cfg.rolesEnabled!==false,
    rosterByName, logsByPlayer, daysByPlayer, qualByTeam,
    bonusWord, friOn, monOn, bossDays, underdogWindows,
    b30Set, jackCnt, ipSum,
    dowBase, todayDay, isEnd, rosterLen:roster.length,
    results:new Map()
  };
  _scoreCache.set(logs, entry);
  return entry;
}

function score(playerName, ctx){
  const E=_ctxEntry(ctx);
  let r=E.results.get(playerName);
  if(r) return r;

  const p=E.rosterByName.get(playerName);
  if(!p){
    r={wo:0,base:0,sb:0,wb:0,rb:0,tb:0,b30:0,pen:0,bossBonus:0,dayBonuses:0,underdogBonus:0,jackBonus:0,ipBonus:0,total:0,streak:0,days:_EMPTY_SET};
    E.results.set(playerName,r);
    return r;
  }

  const ownLogs=E.logsByPlayer.get(playerName)||[];
  const days=E.daysByPlayer.get(playerName)||_EMPTY_SET;
  const wo=days.size;

  // ── BASE (per logged day: +5, or +6 on a bonus_workout day, ×2 inside a Boss Week window) ──
  const bonusDaySet=new Set();
  if(E.bonusWord!==null){
    for(const l of ownLogs){
      if(Array.isArray(l.workouts) && l.workouts.some(w=>w.toLowerCase().includes(E.bonusWord))) bonusDaySet.add(l.day);
    }
  }
  // Boss Week doubles a day's base when that day-of-month falls inside a boss_week
  // window. Because scoring keys off the log's `day` integer (never its timestamp),
  // a backlogged workout dated inside a window automatically earns the bonus.
  const dayBaseOf = d => (bonusDaySet.has(d)?6:5) * (E.bossDays.has(d)?2:1);
  let base=0;
  for(const d of days) base += dayBaseOf(d);

  // ── STREAK (display only) ── consecutive run ending today (or yesterday)
  const checkUpTo=days.has(E.todayDay) ? E.todayDay : E.todayDay-1;
  let streak=0;
  for(let d=checkUpTo; d>=1 && days.has(d); d--) streak++;
  const sb=0;

  // ── PERFECT WEEK ──
  // Rolling non-overlapping 7-day windows within the month.
  // Slides forward one day at a time; when a complete window is found,
  // awards +10 and jumps 7 days so no day counts toward two windows.
  let wb=0, winStart=1;
  while(winStart<=E.DAYS-6){
    let complete=true;
    for(let i=0;i<7;i++){ if(!days.has(winStart+i)){ complete=false; break; } }
    if(complete){ wb+=10; winStart+=7; } else { winStart+=1; }
  }

  // ── TEAM STREAK ── cumulative +1/+2/+3 on qualifying days the player logged
  let tb=0;
  for(const q of (E.qualByTeam.get(p.team)||[])){
    if(q.set.has(playerName)) tb+=Math.min(3,q.streakLen);
  }

  // ── ROLE BONUS / PENALTY (last day or after season end only) ──
  let rb=0;
  if(E.isEnd && E.rolesEnabled){
    if(p.role==='Captain') rb=wo>=E.capTarget?10:-10;
    else if(p.role==='Vice Captain') rb=wo>=E.vcTarget?15:-10;
  }
  const pen=E.isEnd && wo<E.minWorkouts ? (wo-E.minWorkouts)*5 : 0;
  const b30=E.b30Set.has(playerName)?50:0;

  // bossBonus kept in return shape for backward compat (value now always 0;
  // the doubling is folded into base above)
  const bossBonus=0;

  // ── DAY-OF-WEEK BONUSES (Freaky Fridays, Monday Motivation) ──
  // Stacks with Boss Week: if boss_week is also on, base is already doubled,
  // then day bonuses add an extra +5 per qualifying day (net ×4 on that day).
  let dayBonuses=0;
  if(E.friOn||E.monOn){
    for(const d of days){
      const dow=(E.dowBase+d-1)%7;                   // 0=Sun,1=Mon,...,5=Fri,6=Sat
      if(E.friOn&&dow===5) dayBonuses+=5;
      if(E.monOn&&dow===1) dayBonuses+=5;
    }
  }

  // ── UNDERDOG WEEK (week-bound, frozen identity, capped at first 3 workouts) ──
  // A player frozen in a window doubles the base of their FIRST 3 logged days
  // inside that window's Mon–Sun range (by day-of-month, ascending); workouts 4+
  // score normally. Identity was frozen at activation — never recomputed here, so
  // toggling the twist later can't change who qualified. Cap is per window.
  let underdogBonus=0;
  for(const w of E.underdogWindows){
    if(!w.frozen.has(playerName)) continue;
    const inWin=[...days].filter(d=>d>=w.monDate && d<=w.sunDate).sort((a,b)=>a-b).slice(0,3);
    for(const d of inWin) underdogBonus += dayBaseOf(d);   // +1 extra copy of the (Boss-aware) day base = doubled
  }

  // ── JACK OF ALL TRADES (+20 per awarded week, scoped to this group) ──
  const jackBonus=(E.jackCnt.get(playerName)||0)*20;

  // ── IRON PLEDGE ──
  // type='double' → +rawPoints added (effectively doubles raw workout pts that week)
  // type='zero'   → -rawPoints subtracted (forfeits raw workout pts that week)
  // Streaks, role bonuses, and all other points are untouched.
  const ipBonus=E.ipSum.get(playerName)||0;

  const total=Math.max(0, base+sb+wb+rb+tb+b30+bossBonus+pen+dayBonuses+underdogBonus+jackBonus+ipBonus);
  r={wo,base,sb,wb,rb,tb,b30,pen,bossBonus,dayBonuses,underdogBonus,jackBonus,ipBonus,total,streak,days};
  E.results.set(playerName,r);
  return r;
}

function teamTotal(team){
  const roster=_rosterOf();
  const players=roster.filter(p=>p.team===team);
  if(players.length===0) return 0;
  const sum=players.reduce((s,p)=>s+score(p.name).total,0);
  return Math.round(sum/players.length); // average for fair cross-team comparison
}

window.score = score;
window.teamTotal = teamTotal;
