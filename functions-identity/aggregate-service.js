'use strict';
const {score}=require('./scoring-engine');
const dayOf=ms=>new Date(ms+19800000).toISOString().slice(0,10);
function validLogs(logs,now){
  return logs.filter(l=>l&&!l.voided&&!l.demo&&Number.isInteger(l.year)&&Number.isInteger(l.month)&&Number.isInteger(l.day)&&l.month>=1&&l.month<=12&&l.day>=1&&l.day<=new Date(Date.UTC(l.year,l.month,0)).getUTCDate()
    &&(!Object.hasOwn(l,'workouts')||(Array.isArray(l.workouts)&&l.workouts.length>0&&l.workouts.every(w=>typeof w==='string'&&w.trim())))
    &&Date.UTC(l.year,l.month-1,l.day)<=Date.parse(dayOf(now)));
}
function workoutSummary(logs,now){
  const out=Object.create(null),seen=new Set();
  validLogs(logs,now).forEach((l,i)=>{
    const id=l.submissionId?'submission:'+l.submissionId:'legacy:'+(l.id||i);if(seen.has(id))return;seen.add(id);
    const labels=new Map((Array.isArray(l.workouts)?l.workouts:[]).map(w=>[w.trim().toLowerCase(),w.trim()]));
    for(const [key,label] of labels){if(!out[key])out[key]={label,n:0};out[key].n++;}
  });
  return {...out};
}
function profileSummary(logs,now){
  const valid=validLogs(logs,now);
  const key=l=>`${l.year}-${String(l.month).padStart(2,'0')}-${String(l.day).padStart(2,'0')}`;
  const days=[...new Set(valid.map(key))].sort(),monthsList=[...new Set(days.map(d=>d.slice(0,7)))];
  let run=0,longestStreak=0,previous=null;
  for(const day of days){run=previous&&Date.parse(day)-Date.parse(previous)===86400000?run+1:1;previous=day;longestStreak=Math.max(longestStreak,run);}
  const lastLoggedDay=days.at(-1)||null,today=dayOf(now),yesterday=dayOf(now-86400000);
  const totalWorkouts=new Set(valid.map((l,i)=>l.submissionId?'submission:'+l.submissionId:'legacy:'+(l.id||i))).size;
  return {totalWorkouts,currentStreak:lastLoggedDay===today||lastLoggedDay===yesterday?run:0,longestStreak,lastLoggedDay,monthsList,monthsLogged:monthsList.length,seasonsPlayed:new Set(valid.map(l=>`${l.groupCode}|${l.year}-${l.month}`)).size};
}
function monthlySlice(logs,roster,stamp){
  const days=Object.create(null),counts=Object.create(null),wo=Object.create(null),users=Object.create(null);
  const unique=new Map();
  for(const p of roster){if(p?.name&&p.userId){if(unique.has(p.name))unique.set(p.name,null);else unique.set(p.name,p.userId);}}
  for(const l of logs){
    if(!l||l.voided||l.demo||typeof l.player!=='string'||!Number.isInteger(l.day))continue;
    (days[l.player]||(days[l.player]=new Set())).add(l.day);counts[l.day]=(counts[l.day]||0)+1;
    for(const w of Array.isArray(l.workouts)?l.workouts:[]){if(typeof w!=='string'||!w.trim())continue;const label=w.trim(),key=label.toLowerCase();(wo[key]||(wo[key]={label,n:0})).n++;}
    const id=l.userId||unique.get(l.player)||null;
    users[l.player]=Object.hasOwn(users,l.player)&&users[l.player]!==id?null:id;
  }
  return {days:Object.fromEntries(Object.entries(days).map(([k,v])=>[k,[...v].sort((a,b)=>a-b)])),counts:{...counts},wo:{...wo},users:{...users},members:new Set(roster.filter(p=>p&&!p.departed).map(p=>p.userId).filter(Boolean)).size,updatedAt:stamp};
}
module.exports=function({db,FieldValue,HttpsError,identity,now=Date.now}){
  async function rebuildMonth(sid){
    return db.runTransaction(async tx=>{
      const groupSnap=await tx.get(db.collection('groups')),year=Number(sid.slice(0,4)),month=Number(sid.slice(5)),groups={};
      const logs=await tx.get(db.collection('logs').where('year','==',year).where('month','==',month));
      for(const g of groupSnap.docs){
        if(g.data().demo===true)continue;
        const season=await tx.get(g.ref.collection('seasons').doc(sid));if(!season.exists)continue;
        groups[g.id]=monthlySlice(logs.docs.map(d=>d.data()).filter(l=>l.groupCode===g.id),season.data().roster||[],FieldValue.serverTimestamp());
      }
      tx.set(db.collection('analytics').doc('global').collection('monthly').doc(sid),{year,month,groups});
    });
  }
  async function repair(request){
    identity.actor(request,false);
    if(request.auth.token.forgeAdmin!==true)throw new HttpsError('permission-denied','Superadmin access required.');
    const d=request.data||{};
    if(!['profiles','global'].includes(d.mode)||typeof d.dryRun!=='boolean')throw new HttpsError('invalid-argument','Choose a repair and preview it first.');
    const users=await db.collection('users').get(),groups=await db.collection('groups').get(),logs=await db.collection('logs').get();
    const active=users.docs.filter(u=>!u.data().deleted&&!u.data().deletedAt&&!u.data().deletionRequestedAt&&!u.data().mergedInto),ids=new Set(active.map(u=>u.id));
    const unresolved=logs.docs.filter(l=>!l.data().voided&&!l.data().demo&&!ids.has(l.data().userId)).length;
    const months=Array.from({length:6},(_,i)=>{const day=new Date(now()+19800000);return new Date(Date.UTC(day.getUTCFullYear(),day.getUTCMonth()-i,1)).toISOString().slice(0,7);});
    const manifest={mode:d.mode,profiles:active.map(u=>u.id).sort(),groups:groups.docs.map(g=>g.id).sort(),months:d.mode==='global'?months:[],unresolved};
    const confirmation=require('node:crypto').createHash('sha256').update(JSON.stringify(manifest)).digest('hex');
    const preview={ok:true,dryRun:true,profiles:active.length,groups:groups.size,months:manifest.months,unresolved,confirmation};
    if(d.dryRun)return preview;
    if(unresolved)throw new HttpsError('failed-precondition','Resolve historical workout ownership before rebuilding statistics.');
    if(d.confirmation!==confirmation)throw new HttpsError('failed-precondition','Preview changed. Run a fresh preview before confirming.');
    if(d.mode==='profiles'){for(const u of active)await profile(u.id);}
    else{await reconcile();for(const sid of months)await rebuildMonth(sid);}
    return {...preview,dryRun:false};
  }
  async function recapPercentile(request){
    const actor=identity.actor(request,false),sid=request.data?.seasonId;
    if(typeof sid!=='string'||!/^20\d{2}-(0[1-9]|1[0-2])$/.test(sid))throw new HttpsError('invalid-argument','Invalid month.');
    return db.runTransaction(async tx=>{
      const index=await tx.get(db.collection('authIdentities').doc(actor.uid)),id=index.exists&&index.data().userId;
      const user=id&&await tx.get(db.collection('users').doc(id));
      if(!user||!user.exists||user.data().authUid!==actor.uid||user.data().deleted||user.data().deletedAt||user.data().deletionRequestedAt)throw new HttpsError('permission-denied','Linked account required.');
      const snapshot=await tx.get(db.collection('analytics').doc('global').collection('monthly').doc(sid));
      const people=new Map(),limit=new Date(Date.UTC(Number(sid.slice(0,4)),Number(sid.slice(5)),0)).getUTCDate();
      for(const [code,g] of Object.entries(snapshot.exists?snapshot.data().groups||{}:{})){
        for(const [name,days] of Object.entries(g.days||{})){
          const key=g.users?.[name]||code+':'+name.toLowerCase();
          if(!people.has(key))people.set(key,new Set());
          for(const day of Array.isArray(days)?days:[])if(Number.isInteger(day)&&day>=1&&day<=limit)people.get(key).add(day);
        }
      }
      // Return only the requesting person's comparison, never other people's
      // identities, activity dates, or small-population statistics.
      if(people.size<5||!people.has(id))return {available:false};
      const days=people.get(id).size,below=[...people.values()].filter(v=>v.size<days).length;
      return {available:true,percentile:Math.round(below/people.size*100),population:people.size,days};
    });
  }
  async function refresh(request){
    const actor=identity.actor(request,false),code=request.data?.groupCode;
    if(typeof code!=='string'||!/^[A-Z0-9]{4,10}$/.test(code))throw new HttpsError('invalid-argument','Invalid group.');
    return rebuild(code,actor.uid,request.auth.token.forgeAdmin===true);
  }
  async function rebuild(code,uid,admin=false){
    return db.runTransaction(async tx=>{
      const groupRef=db.collection('groups').doc(code),group=await tx.get(groupRef);
      if(!group.exists)throw new HttpsError('not-found','Group unavailable.');
      const sid=group.data().currentSeasonId;
      if(typeof sid!=='string'||!/^\d{4}-\d{2}$/.test(sid))throw new HttpsError('failed-precondition','Season unavailable.');
      const ref=groupRef.collection('seasons').doc(sid),season=await tx.get(ref);
      if(!season.exists||!Array.isArray(season.data().roster))throw new HttpsError('failed-precondition','Roster unavailable.');
      const s=season.data(),roster=s.roster.filter(Boolean);
      if(uid&&!admin){
        const index=await tx.get(db.collection('authIdentities').doc(uid)),id=index.exists&&index.data().userId;
        const person=id&&await tx.get(db.collection('users').doc(id));
        if(!person||!person.exists||person.data().authUid!==uid||person.data().deleted||person.data().deletionRequestedAt||!roster.some(p=>p.userId===id&&!p.departed))throw new HttpsError('permission-denied','Group membership required.');
      }
      // This is only a cache refresh. Throttling never changes the log receipt.
      const old=group.data().globalStats?.computedAt;
      if(uid&&old&&typeof old.toMillis==='function'&&now()-old.toMillis()<15000)return {ok:true,cached:true};
      const logQuery=db.collection('logs').where('groupCode','==',code).where('year','==',s.year).where('month','==',s.month);
      const logSnap=await tx.get(logQuery),logs=logSnap.docs.map(d=>({id:d.id,...d.data()})).filter(l=>!l.voided);
      const load=async query=>(await tx.get(query)).docs.map(d=>({id:d.id,...d.data()}));
      const twists=Object.fromEntries((await load(ref.collection('twists'))).map(d=>[d.id,d]));
      const ctx={season:s,groupCode:code,logs,twists,asOf:dayOf(now()),
        twistWindows:await load(ref.collection('twistWindows')),jackAwards:await load(ref.collection('jackAwards')),
        bonuses:await load(db.collection('bonuses_30day').where('groupCode','==',code).where('year','==',s.year).where('month','==',s.month)),
        ironPledgeBonuses:await load(db.collection('bonuses_iron_pledge').where('groupCode','==',code).where('year','==',s.year).where('month','==',s.month))};
      let total=0;const players=[],ranked=[];
      for(const p of roster){const points=score(p.name,ctx).total;total+=points;ranked.push({p,points});if(p.globalConsent===true&&!p.departed)players.push({name:p.name,userId:p.userId||null,points});}
      ranked.sort((a,b)=>b.points-a.points);
      const rankWrites=[];
      for(const [i,{p}] of ranked.entries()){
        if(!p.userId||p.departed||roster.filter(other=>other.userId===p.userId).length!==1)continue;
        const ref=db.collection('users').doc(p.userId),snap=await tx.get(ref);
        if(snap.exists&&!snap.data().deleted&&!snap.data().deletedAt&&!snap.data().deletionRequestedAt)rankWrites.push({ref,value:{...snap.data().groupRanks,[code]:i+1}});
      }
      const today=dayOf(now()),dailyRef=db.collection('analytics').doc('global').collection('daily').doc(today),daily=await tx.get(dailyRef);
      const monthlyRef=db.collection('analytics').doc('global').collection('monthly').doc(sid),monthly=await tx.get(monthlyRef);
      const stamp=FieldValue.serverTimestamp();
      for(const w of rankWrites)tx.update(w.ref,{groupRanks:w.value});
      tx.update(groupRef,{globalStats:{seasonId:sid,total,avg:roster.length?Math.round(total/roster.length):0,count:roster.length,players,computedAt:stamp}});
      const byGroup={...(daily.exists?daily.data().byGroup:{})},groups={...(monthly.exists?monthly.data().groups:{})};
      if(group.data().demo===true){delete byGroup[code];delete groups[code];}
      else{
        byGroup[code]=logs.filter(l=>!l.demo&&l.timestamp&&typeof l.timestamp.toMillis==='function'&&dayOf(l.timestamp.toMillis())===today).length;
        groups[code]=monthlySlice(logs,roster,stamp);
      }
      tx.set(dailyRef,{byGroup,updatedAt:stamp});
      tx.set(monthlyRef,{year:s.year,month:s.month,groups});
      return {ok:true,cached:false};
    });
  }
  async function profile(id){
    return db.runTransaction(async tx=>{
      const ref=db.collection('users').doc(id),person=await tx.get(ref);
      if(!person.exists||person.data().deleted||person.data().deletedAt||person.data().mergedInto||person.data().deletionRequestedAt)return;
      const records=await tx.get(db.collection('logs').where('userId','==',id));
      const logs=records.docs.map(d=>({id:d.id,...d.data()})),stats=profileSummary(logs,now());
      tx.update(ref,{stats:{...person.data().stats,...stats},workoutCounts:workoutSummary(logs,now())});
    });
  }
  async function reconcile(){
    const groups=await db.collection('groups').get();
    for(const group of groups.docs)if(group.data().currentSeasonId)await rebuild(group.id);
    const users=await db.collection('users').get();
    for(const user of users.docs)await profile(user.id);
    // Public marketing totals are recalculated, not incremented by clients.
    // One daily pass at this scale also repairs missed/out-of-order events.
    return db.runTransaction(async tx=>{
      const userSnap=await tx.get(db.collection('users')),logSnap=await tx.get(db.collection('logs')),groupSnap=await tx.get(db.collection('groups'));
      const realGroups=new Set(groupSnap.docs.filter(d=>d.data().demo!==true).map(d=>d.id));
      const totalUsers=userSnap.docs.filter(d=>{const u=d.data();return !u.deleted&&!u.deletedAt&&!u.deletionRequestedAt&&!u.mergedInto&&(u.soloEnabled||Object.keys(u.memberships||{}).some(c=>realGroups.has(c)));}).length;
      const totalLogs=logSnap.docs.filter(d=>{const l=d.data();return !l.voided&&!l.demo&&realGroups.has(l.groupCode);}).length;
      tx.set(db.collection('stats').doc('global'),{totalUsers,totalLogs,updatedAt:FieldValue.serverTimestamp()});
      return {groups:groups.docs.length,profiles:users.docs.length};
    });
  }
  return {refresh,rebuild,profile,reconcile,recapPercentile,repair};
};
module.exports.profileSummary=profileSummary;
module.exports.monthlySlice=monthlySlice;
module.exports.workoutSummary=workoutSummary;
