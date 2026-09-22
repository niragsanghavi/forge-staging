'use strict';
const crypto=require('node:crypto');
const {wall}=require('./season-dates');
const hash=x=>crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex');
const workouts=l=>[...new Set((l.workouts||[]).map(w=>String(w).trim().toLowerCase()))].sort();
// The revision excludes only our tombstone fields: retrying a confirmed removal
// must not fail because the first request succeeded but its response was lost.
const revision=l=>hash(Object.fromEntries(Object.keys(l).sort().filter(k=>!['voided','voidedBy','voidedAt','removalOperationId'].includes(k)).map(k=>[k,l[k]])));
module.exports=({db,FieldValue,HttpsError,identity,now=Date.now})=>{
 const fail=(code,message)=>{throw new HttpsError(code,message);};
 const valid=x=>typeof x==='string'&&/^[A-Za-z0-9_-]{1,128}$/.test(x);
 async function owner(tx,r){
  const a=identity.actor(r,false),i=await tx.get(db.collection('authIdentities').doc(a.uid)),id=i.exists&&i.data().userId;
  if(!valid(id))fail('permission-denied','Link your Forge profile first.');
  const u=await tx.get(db.collection('users').doc(id));
  if(!u.exists||u.data().authUid!==a.uid||u.data().deleted||u.data().deletedAt||u.data().deletionRequestedAt||u.data().mergedInto)fail('permission-denied','Profile unavailable.');
  return {...a,userId:id};
 }
 async function member(tx,a,l){
  const t=wall(now());
  if(!Number.isInteger(l.day)||l.year!==t.getUTCFullYear()||l.month!==t.getUTCMonth()+1||l.day<Math.max(1,t.getUTCDate()-7)||l.day>t.getUTCDate())fail('failed-precondition','This workout is outside the current removal window.');
  if(typeof l.groupCode!=='string'||!/^[A-Z0-9]{4,10}$/.test(l.groupCode))fail('failed-precondition','Invalid group.');
  const sid=l.year+'-'+String(l.month).padStart(2,'0'),g=db.collection('groups').doc(l.groupCode);
  const group=await tx.get(g),season=await tx.get(g.collection('seasons').doc(sid));
  if(!group.exists||group.data().archived||group.data().currentSeasonId!==sid||!season.exists||['closed','archived','deleted'].includes(season.data().status))fail('failed-precondition','This season is closed.');
  if((season.data().roster||[]).filter(p=>p?.userId===a.userId&&!p.departed).length!==1)fail('permission-denied','You are not a member of this group.');
  return group.data();
 }
 async function preview(r){
  identity.actor(r,false);
  if(!valid(r.data?.logId))fail('invalid-argument','Choose a workout.');
  return db.runTransaction(async tx=>{
   const a=await owner(tx,r),seed=await tx.get(db.collection('logs').doc(r.data.logId));
   if(!seed.exists||seed.data().userId!==a.userId||seed.data().voided)fail('permission-denied','Choose your own active workout.');
   const l=seed.data();await member(tx,a,l);
   if(!Array.isArray(l.workouts)||!l.workouts.length)fail('failed-precondition','Workout activities need repair.');
   // Single-field equality only: no composite index or ordering dependency.
   const query=l.submissionId?db.collection('logs').where('submissionId','==',l.submissionId).limit(101):db.collection('logs').where('userId','==',a.userId).limit(5001);
   const found=await tx.get(query);
   if(found.size> (l.submissionId?100:5000))fail('resource-exhausted','Too much history to review safely. Contact support.');
   const rows=[],unavailable=[];
   for(const d of found.docs){
    const v=d.data();
    if(v.voided||v.userId!==a.userId||v.year!==l.year||v.month!==l.month||v.day!==l.day||hash(workouts(v))!==hash(workouts(l)))continue;
    try{
     const g=await member(tx,a,v);
     rows.push({logId:d.id,groupCode:v.groupCode,groupName:g.name||v.groupCode,year:v.year,month:v.month,day:v.day,workouts:v.workouts,note:v.note||'',km:v.km??null,demo:g.demo===true||v.demo===true,revision:revision(v)});
    }catch(e){if(!['permission-denied','failed-precondition'].includes(e.code))throw e;unavailable.push({groupCode:v.groupCode,reason:e.message});}
   }
   if(!rows.length)fail('failed-precondition','No eligible workouts remain.');
   if(rows.length>100)fail('resource-exhausted','Too many matches. Contact support.');
   rows.sort((a,b)=>a.groupCode.localeCompare(b.groupCode)||a.logId.localeCompare(b.logId));
   const operationId=crypto.randomUUID(),expiresAt=now()+15*60000,mode=l.submissionId?'submission':'inferred';
   tx.set(db.collection('workoutRemovalReviews').doc(operationId),{authUid:a.uid,userId:a.userId,createdAt:now(),expiresAt,mode,rows});
   return {operationId,expiresAt,mode,rows,unavailable};
  });
 }
 async function apply(r){
  const actor=identity.actor(r,false),d=r.data||{};
  if(!valid(d.operationId)||!Array.isArray(d.logIds)||!d.logIds.length||d.logIds.length>100||d.logIds.some(x=>!valid(x))||new Set(d.logIds).size!==d.logIds.length)fail('invalid-argument','Review and select the workouts first.');
  const reviewRef=db.collection('workoutRemovalReviews').doc(d.operationId),review=await reviewRef.get();
  if(!review.exists||review.data().authUid!==actor.uid)fail('permission-denied','This review belongs to another account.');
  const plan=review.data(),selected=plan.rows.filter(x=>d.logIds.includes(x.logId));
  if(selected.length!==d.logIds.length)fail('invalid-argument','Only reviewed workouts can be removed.');
  const results=[];
  // One transaction per group: other groups keep their confirmed results when
  // a group closes, membership changes, or an independent write fails.
  for(const code of [...new Set(selected.map(x=>x.groupCode))]){
   const rows=selected.filter(x=>x.groupCode===code);
   try{
    const result=await db.runTransaction(async tx=>{
     const a=await owner(tx,r),fresh=await tx.get(reviewRef);
     if(a.userId!==plan.userId||!fresh.exists||fresh.data().authUid!==a.uid)fail('permission-denied','Your account changed. Review again.');
     const pending=[],statuses=[];
     for(const row of rows){
      const ref=db.collection('logs').doc(row.logId),snap=await tx.get(ref);
      if(!snap.exists||snap.data().userId!==a.userId)fail('permission-denied','Workout ownership changed. Review again.');
      const l=snap.data();
      if(revision(l)!==row.revision)fail('failed-precondition','A workout changed. Review again.');
      if(l.voided){statuses.push({logId:row.logId,status:'already-removed'});continue;}
      if(now()>plan.expiresAt)fail('failed-precondition','This review expired. Review again.');
      const g=await member(tx,a,l);
      pending.push({ref,l,demo:l.demo===true||g.demo===true});statuses.push({logId:row.logId,status:'removed'});
     }
     const real=pending.filter(x=>!x.demo),globalRef=db.collection('stats').doc('global');
     const global=real.length?await tx.get(globalRef):null,days=new Map();
     for(const {l} of real){
      const ms=l.timestamp?.toMillis?.()??(l.timestamp?.seconds*1000);
      if(!Number.isFinite(ms))continue;
      const day=wall(ms).toISOString().slice(0,10);days.set(day,(days.get(day)||0)+1);
     }
     const daily=[];
     for(const [day,n] of days){const ref=db.collection('analytics').doc('global').collection('daily').doc(day);daily.push({ref,n,snap:await tx.get(ref)});}
     for(const {ref} of pending)tx.update(ref,{voided:true,voidedBy:a.userId,voidedAt:FieldValue.serverTimestamp(),removalOperationId:d.operationId});
     if(real.length&&global.exists)tx.update(globalRef,{totalLogs:Math.max(0,(Number(global.data().totalLogs)||0)-real.length),updatedAt:FieldValue.serverTimestamp()});
     for(const {ref,n,snap} of daily)if(snap.exists){const byGroup={...snap.data().byGroup};byGroup[code]=Math.max(0,(Number(byGroup[code])||0)-n);tx.update(ref,{byGroup,updatedAt:FieldValue.serverTimestamp()});}
     return statuses;
    });
    results.push({groupCode:code,ok:true,logs:result});
   }catch(e){results.push({groupCode:code,ok:false,code:e.code||'unavailable',message:['permission-denied','failed-precondition'].includes(e.code)?e.message:'Removal not confirmed. Retry this review.',logIds:rows.map(x=>x.logId)});}
  }
  return {ok:results.every(x=>x.ok),results};
 }
 return {preview,apply};
};
