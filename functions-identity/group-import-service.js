'use strict';
const crypto=require('node:crypto');
module.exports=({db,FieldValue,HttpsError,identity,now=Date.now})=>{
 const fail=(c,m)=>{throw new HttpsError(c,m);},hash=x=>crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex');
 const stampDate=()=>{const t=new Date(now()+19800000);return {year:t.getUTCFullYear(),month:t.getUTCMonth()+1,day:t.getUTCDate(),sid:t.toISOString().slice(0,7)};};
 const signature=l=>JSON.stringify([l.day,[...new Set(l.workouts.map(w=>w.trim().toLowerCase()))].sort()]);
 async function state(request,tx){
  const a=identity.actor(request,false),read=r=>tx?tx.get(r):r.get();
  const code=String(request.data?.groupCode||'');if(!/^[A-Z0-9]{4,10}$/.test(code))fail('invalid-argument','Choose a group.');
  const index=await read(db.collection('authIdentities').doc(a.uid)),id=index.exists&&index.data().userId;if(!id)fail('permission-denied','Link your profile first.');
  const u=await read(db.collection('users').doc(id));if(!u.exists||u.data().authUid!==a.uid||u.data().deleted||u.data().deletedAt||u.data().deletionRequestedAt||u.data().mergedInto)fail('permission-denied','Profile unavailable.');
  const p=stampDate(),group=await read(db.collection('groups').doc(code)),season=await read(db.collection('groups').doc(code).collection('seasons').doc(p.sid));
  if(!group.exists||group.data().demo||group.data().currentSeasonId!==p.sid||!season.exists||['closed','archived','deleted'].includes(season.data().status))fail('failed-precondition','Choose an open, real group in the current month.');
  const roster=(season.data().roster||[]).filter(x=>x.userId===id&&x.departed!==true);
  if(roster.length!==1||!roster[0].name||!roster[0].team)fail('permission-denied','Join this group with your linked profile first.');
  const all=await read(db.collection('logs').where('userId','==',id).limit(5001));
  if(all.size>5000)fail('resource-exhausted','Too much history for automatic copying. Contact Forge support.');
  const valid=all.docs.map(d=>({id:d.id,...d.data()})).filter(l=>!l.voided&&!l.demo&&l.year===p.year&&l.month===p.month&&Number.isInteger(l.day)&&l.day>=1&&l.day<=p.day&&Array.isArray(l.workouts)&&l.workouts.length&&l.workouts.length<=20&&l.workouts.every(w=>typeof w==='string'&&w.trim()&&w.length<=200));
  const sources=valid.filter(l=>l.groupCode!==code&&Object.hasOwn(u.data().memberships||{},l.groupCode));
  const allowed=new Set();
  for(const from of [...new Set(sources.map(l=>l.groupCode))]){
   if(!/^[A-Z0-9]{4,10}$/.test(from))continue;
   const g=await read(db.collection('groups').doc(from)),s=await read(db.collection('groups').doc(from).collection('seasons').doc(p.sid));
   if(g.exists&&!g.data().demo&&s.exists&&(s.data().roster||[]).some(r=>r.userId===id&&r.departed!==true))allowed.add(from);
  }
  const buckets=new Map();
  for(const l of sources.filter(l=>allowed.has(l.groupCode))){const key=signature(l);if(!buckets.has(key))buckets.set(key,new Map());const b=buckets.get(key);if(!b.has(l.groupCode))b.set(l.groupCode,[]);b.get(l.groupCode).push(l);}
  const rows=[];
  for(const [key,groups] of [...buckets].sort(([a],[b])=>a.localeCompare(b))){
   const candidates=[...groups].sort(([a,x],[b,y])=>y.length-x.length||a.localeCompare(b))[0][1].sort((a,b)=>a.id.localeCompare(b.id));
   candidates.forEach((l,i)=>rows.push({key:hash([key,i]),signature:key,ordinal:i,sourceId:l.id,sourceGroup:l.groupCode,day:l.day,workouts:l.workouts,note:typeof l.note==='string'?l.note.slice(0,200):'',km:typeof l.km==='number'&&Number.isFinite(l.km)&&l.km>=0&&l.km<=1000?l.km:null,submissionId:l.submissionId||null,timestamp:l.timestamp||null}));
  }
  if(rows.length>200)fail('resource-exhausted','Too many entries to copy at once. Contact Forge support.');
  const targets=valid.filter(l=>l.groupCode===code),counts=new Map();for(const l of targets){const k=signature(l);counts.set(k,(counts.get(k)||0)+1);}
  return {a,id,p,code,player:roster[0],rows,counts,groupName:group.data().name||code,revision:hash(rows),read};
 }
 async function preview(request){
  const s=await state(request),operationId=crypto.randomUUID(),expiresAt=now()+900000;
  await db.collection('groupImportReviews').doc(operationId).set({authUid:s.a.uid,userId:s.id,groupCode:s.code,seasonId:s.p.sid,revision:s.revision,expiresAt,keys:s.rows.map(r=>r.key)});
  return {operationId,expiresAt,groupCode:s.code,groupName:s.groupName,seasonId:s.p.sid,rows:s.rows.map(r=>({key:r.key,sourceGroup:r.sourceGroup,day:r.day,workouts:r.workouts,already:(s.counts.get(r.signature)||0)>r.ordinal}))};
 }
 async function apply(request){
  identity.actor(request,false);const d=request.data||{};
  if(typeof d.operationId!=='string'||!/^[\w-]{1,128}$/.test(d.operationId)||!Array.isArray(d.keys)||!d.keys.length||d.keys.length>200||new Set(d.keys).size!==d.keys.length)fail('invalid-argument','Review the workouts before copying.');
  return db.runTransaction(async tx=>{
   const s=await state(request,tx),ref=db.collection('groupImportReviews').doc(d.operationId),snap=await tx.get(ref),r=snap.exists&&snap.data();
   if(!r||r.authUid!==s.a.uid||r.userId!==s.id||r.groupCode!==s.code||r.seasonId!==s.p.sid||d.keys.some(k=>!r.keys.includes(k)))fail('permission-denied','This review is not yours.');
   if(r.completed){if(hash(d.keys.slice().sort())!==r.selection)fail('failed-precondition','This review was already completed. Start another review.');return {...r.result,already:true};}
   if(r.expiresAt<now()||r.revision!==s.revision)fail('failed-precondition','Your history changed or this review expired. Review it again.');
   const writes=[],daily=new Map();let skipped=0;
   for(const row of s.rows.filter(x=>d.keys.includes(x.key))){
    if((s.counts.get(row.signature)||0)>row.ordinal){skipped++;continue;}
    const dest=db.collection('logs').doc('import_'+hash([s.id,s.code,s.p.sid,row.key])),old=await tx.get(dest);
    if(old.exists){skipped++;continue;} // Never resurrect a removed copy.
    const millis=typeof row.timestamp?.toMillis==='function'?row.timestamp.toMillis():Number.isFinite(row.timestamp?.seconds)?row.timestamp.seconds*1000:now();
    const day=new Date(millis+19800000).toISOString().slice(0,10);daily.set(day,(daily.get(day)||0)+1);
    writes.push({ref:dest,value:{groupCode:s.code,player:s.player.name,team:s.player.team,role:s.player.role||'Player',userId:s.id,uid:s.a.uid,year:s.p.year,month:s.p.month,day:row.day,workouts:row.workouts,...(row.note?{note:row.note}:{}),...(row.km!==null?{km:row.km}:{}),timestamp:row.timestamp||FieldValue.serverTimestamp(),submissionId:row.submissionId||hash([s.id,s.p.sid,row.key]),importedFrom:{groupCode:row.sourceGroup,logId:row.sourceId},importedAt:FieldValue.serverTimestamp()}});
   }
   const globalRef=db.collection('stats').doc('global'),global=await tx.get(globalRef),days=[];
   for(const [day,count]of daily){const ref=db.collection('analytics').doc('global').collection('daily').doc(day);days.push({ref,count,snap:await tx.get(ref)});}
   for(const w of writes)tx.set(w.ref,w.value);
   if(global.exists&&writes.length)tx.update(globalRef,{totalLogs:Math.max(0,Number(global.data().totalLogs)||0)+writes.length});
   for(const item of days)if(item.snap.exists){const byGroup={...(item.snap.data().byGroup||{})};byGroup[s.code]=(Number(byGroup[s.code])||0)+item.count;tx.update(item.ref,{byGroup});}
   const result={ok:true,created:writes.length,skipped,groupCode:s.code,seasonId:s.p.sid};tx.update(ref,{completed:true,selection:hash(d.keys.slice().sort()),result});return result;
  });
 }
 return {preview,apply};
};

