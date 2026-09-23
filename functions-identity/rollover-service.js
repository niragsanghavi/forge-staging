'use strict';
const {score}=require('./scoring-engine');
const {wall,sidOf}=require('./season-dates');
const {seasonMigrated}=require('./migration-state');
module.exports=function({db,FieldValue,HttpsError,groupWrites,pledges,identity,now=Date.now,logger=console}){
 const fail=(code,message)=>{throw new HttpsError(code,message);};
 async function run(code,request=null){
  // Reject callable requests before reading group existence or season state.
  // Internal scheduled work has no request and retains its separate path.
  if(request)identity.actor(request,false);
  if(typeof code!=='string'||!/^[A-Z0-9]{4,10}$/.test(code))fail('invalid-argument','Invalid group.');
  return db.runTransaction(async tx=>{
   const gRef=db.collection('groups').doc(code),gSnap=await tx.get(gRef);
   if(!gSnap.exists)return {ok:false,reason:'GROUP_MISSING'};
   const g=gSnap.data(),sid=g.currentSeasonId;
   if(typeof sid!=='string'||!/^20\d{2}-(0[1-9]|1[0-2])$/.test(sid))return {ok:false,reason:'NO_ACTIVE_SEASON'};
   const ref=gRef.collection('seasons').doc(sid),ss=await tx.get(ref);if(!ss.exists)return {ok:false,reason:'SEASON_MISSING'};
   const s=ss.data();
   if(request){
    // Superadmin still requires a verified provider; a naked claim or old PIN
    // is not sufficient. Normal members may request only their own rollover.
    identity.actor(request,false);
    if(request.auth.token.forgeAdmin!==true){const actor=await groupWrites.owner(tx,request);await groupWrites.membership(tx,actor,code,sid);}
   }
   if(!Number.isInteger(s.year)||!Number.isInteger(s.month)||s.month<1||s.month>12||sid!==s.year+'-'+String(s.month).padStart(2,'0')||!Array.isArray(s.roster))fail('failed-precondition','Season data needs review.');
   const today=wall(now());if(sid>=sidOf(today))return {ok:false,reason:'NOT_YET_DUE'};
   const start=s.startedAt?.toMillis?s.startedAt.toMillis():(s.startedAt?.seconds||0)*1000;
   if(start>now()+86400000)return {ok:false,reason:'FUTURE_START'};
   if(!(await seasonMigrated(tx,gRef,sid,s)))fail('failed-precondition','Complete the reviewed account migration before rollover.');
   const next=new Date(Date.UTC(s.year,s.month,1)),newSid=sidOf(next),newRef=gRef.collection('seasons').doc(newSid);
   if((await tx.get(newRef)).exists)return {ok:false,reason:'TARGET_SEASON_EXISTS'};
   const roster=s.roster.filter(Boolean),stepsPending=s.stepRounds?.enabled===true&&!s.stepsFinalizedAt;
   const writes=[];
   if(stepsPending&&!s.snapshotAt){
    const logs=await tx.get(db.collection('logs').where('groupCode','==',code).where('year','==',s.year).where('month','==',s.month));
    const result=await pledges.plan(tx,code,sid,s,logs.docs.map(d=>d.data()));writes.push(...result.writes);
   }
   if(!s.snapshotAt&&!stepsPending){
    const query=col=>db.collection(col).where('groupCode','==',code).where('year','==',s.year).where('month','==',s.month);
    const [logsSnap,bonus,twists,jack,windows]=await Promise.all([tx.get(query('logs')),tx.get(query('bonuses_30day')),tx.get(ref.collection('twists')),tx.get(ref.collection('jackAwards')),tx.get(ref.collection('twistWindows'))]);
    const logs=logsSnap.docs.map(d=>d.data()).filter(l=>!l.voided),pledge=await pledges.plan(tx,code,sid,s,logs);
    writes.push(...pledge.writes);
    const ctx={season:s,groupCode:code,asOf:newSid+'-01',logs,bonuses:bonus.docs.map(d=>d.data()),twists:Object.fromEntries(twists.docs.map(d=>[d.id,d.data()])),jackAwards:jack.docs.map(d=>d.data()),twistWindows:windows.docs.map(d=>d.data()),ironPledgeBonuses:pledge.bonuses};
    if(new Set(roster.map(p=>p.name)).size!==roster.length)fail('failed-precondition','Duplicate roster names need review before archiving.');
    const ranked=roster.map(p=>({p,sc:score(p.name,ctx)})).sort((a,b)=>b.sc.total-a.sc.total);
    const finalStandings=ranked.map(({p,sc},i)=>({userId:p.userId||null,name:p.name,team:p.team,total:sc.total,wo:sc.wo,streak:sc.streak,rank:i+1}));
    const teamStandings=[...new Set(roster.map(p=>p.team))].map(team=>{const members=finalStandings.filter(p=>p.team===team);return {team,avg:Math.round(members.reduce((n,p)=>n+p.total,0)/members.length),memberCount:members.length};}).sort((a,b)=>b.avg-a.avg).map((t,i)=>({...t,rank:i+1}));
    const top=finalStandings[0],winner=top&&top.total>0&&(!finalStandings[1]||top.total>finalStandings[1].total)?top.name:null;
    const winningTeam=teamStandings.length>1&&teamStandings[0].avg>teamStandings[1].avg?teamStandings[0].team:null;
    const badgesAwarded=finalStandings.map(p=>({userId:p.userId,name:p.name,badges:[...(p.name===winner?['season_winner']:[]),...(p.team===winningTeam?['team_winner']:[])]})).filter(p=>p.badges.length);
    const targets=finalStandings.filter(p=>p.userId);
    if(new Set(targets.map(p=>p.userId)).size!==targets.length)fail('failed-precondition','Duplicate profile ownership needs review.');
    for(const p of targets){
     const userRef=db.collection('users').doc(p.userId),user=await tx.get(userRef),archiveRef=userRef.collection('seasons').doc(code+'_'+sid),archive=await tx.get(archiveRef);
     if(!user.exists||user.data().deleted||user.data().deletedAt||user.data().deletionRequestedAt)continue;
     const badges=badgesAwarded.find(b=>b.name===p.name)?.badges||[],old=archive.exists?archive.data():null,stats=user.data().stats||{},badgeCounts={...stats.badgeCounts};
     for(const b of ['season_winner','team_winner'])badgeCounts[b]=Math.max(0,(Number(badgeCounts[b])||0)+Number(badges.includes(b))-Number((old?.badges||[]).includes(b)));
     const dim=new Date(Date.UTC(s.year,s.month,0)).getUTCDate();
     writes.push({ref:archiveRef,value:{groupCode:code,sid,groupName:g.name||code,month:s.month,year:s.year,rank:p.rank,total:p.total,wo:p.wo,streak:p.streak,team:p.team,teamRank:teamStandings.find(t=>t.team===p.team)?.rank||null,rosterSize:roster.length,badges,dayCounts:Array.from({length:dim},(_,i)=>logs.filter(l=>l.player===p.name&&l.day===i+1).reduce((n,l)=>n+(Array.isArray(l.workouts)?l.workouts.length:1),0))}});
     writes.push({ref:userRef,update:true,value:{stats:{...stats,seasonsPlayed:(Number(stats.seasonsPlayed)||0)+(old?0:1),badgeCounts}}});
    }
    writes.push({ref,update:true,value:{finalStandings,teamStandings,badgesAwarded,snapshotAt:FieldValue.serverTimestamp(),statsAwardedAt:FieldValue.serverTimestamp()}});
   }
   const stamp=FieldValue.serverTimestamp();
   for(const w of writes)w.update?tx.update(w.ref,w.value):tx.set(w.ref,w.value);
   tx.update(ref,{status:'archived',endedAt:stamp});
   tx.set(newRef,{month:next.getUTCMonth()+1,year:next.getUTCFullYear(),days:new Date(Date.UTC(next.getUTCFullYear(),next.getUTCMonth()+1,0)).getUTCDate(),capTarget:s.capTarget??16,vcTarget:s.vcTarget??20,minWorkouts:s.minWorkouts??0,numTeams:s.numTeams??3,teamStreakThreshold:s.teamStreakThreshold??0.6,rolesEnabled:s.rolesEnabled!==false,kmTarget:s.kmTarget??null,...(s.stepRounds?{stepRounds:s.stepRounds}:{}),...(s.scoringV2===true?{scoringV2:true}:{}),roster:roster.filter(p=>!p.departed),credentialSchema:2,status:'active',startedAt:stamp,endedAt:null});
   tx.update(gRef,{currentSeasonId:newSid});return {ok:true,newSid,prevSid:sid,stepsPending};
  });
 }
 async function sweep(){
  const groups=await db.collection('groups').get(),results=[];
  for(const g of groups.docs){try{const result=await run(g.id);results.push({code:g.id,...result});if(!result.ok&&!['NOT_YET_DUE','NO_ACTIVE_SEASON'].includes(result.reason))logger.warn('rollover review required',{groupCode:g.id,reason:result.reason});}catch(e){logger.error('rollover failed',{groupCode:g.id,reason:e.code||'internal'});results.push({code:g.id,ok:false,reason:e.code||'internal'});}}
  return results;
 }
 return {run,sweep};
};
