'use strict';
const crypto=require('node:crypto');
const {scoreSoloDays}=require('./scoring-engine');
const {wall}=require('./season-dates');
module.exports=({db,FieldValue,HttpsError,identity,now=Date.now})=>{
  const fail=(code,message)=>{throw new HttpsError(code,message);};
  function period(data={}){
    const today=wall(now()),year=Number(data.year??today.getUTCFullYear()),month=Number(data.month??today.getUTCMonth()+1);
    if(!Number.isInteger(year)||year<2020||!Number.isInteger(month)||month<1||month>12||year*12+month>today.getUTCFullYear()*12+today.getUTCMonth()+1)fail('invalid-argument','Choose a current or previous month.');
    const sid=year+'-'+String(month).padStart(2,'0'),current=year===today.getUTCFullYear()&&month===today.getUTCMonth()+1;
    return {year,month,sid,current,throughDay:current?today.getUTCDate():new Date(Date.UTC(year,month,0)).getUTCDate()};
  }
  async function owner(request){
    const a=identity.actor(request,false),index=await db.collection('authIdentities').doc(a.uid).get();
    if(!index.exists)return {...a,userId:null};
    const userId=index.data().userId,u=await db.collection('users').doc(userId).get();
    if(!u.exists||u.data().authUid!==a.uid||u.data().deleted||u.data().deletionRequestedAt)fail('permission-denied','This profile is unavailable.');
    return {...a,userId,user:u.data()};
  }
  async function enroll(request){
    const a=identity.actor(request),name=String(request.data?.name||'').trim();
    if(name.length<2||name.length>24||/[^\p{L}\p{N} .\-]/u.test(name))fail('invalid-argument','Use a name of 2–24 letters or numbers.');
    if(typeof request.data?.publicRanking!=='boolean')fail('invalid-argument','Choose whether to appear on the solo board.');
    const indexRef=db.collection('authIdentities').doc(a.uid),newId=crypto.randomUUID();
    await db.runTransaction(async tx=>{
      const index=await tx.get(indexRef),legacy=await tx.get(db.collection('users').where('authUid','==',a.uid).limit(2));
      if(legacy.docs.length>1)fail('failed-precondition','Account recovery is needed.');
      const userId=index.exists?index.data().userId:legacy.docs[0]?.id||newId,ref=db.collection('users').doc(userId),snap=await tx.get(ref);
      if(legacy.docs[0]&&legacy.docs[0].id!==userId)fail('failed-precondition','Account recovery is needed.');
      if((index.exists&&!snap.exists)||(snap.exists&&(snap.data().authUid!==a.uid||snap.data().deleted||snap.data().deletionRequestedAt)))fail('permission-denied','Profile unavailable.');
      const user=snap.exists?snap.data():{name,nameLower:name.toLowerCase(),pinHash:null,authUid:a.uid,email:a.email,authProvider:a.provider,createdAt:FieldValue.serverTimestamp(),memberships:{},stats:{},knownDeviceUids:[]};
      // Enrollment retries must not silently rename published entries or
      // opt a previously private person into a public board.
      if(user.soloEnabled)return;
      tx.set(ref,{...user,soloEnabled:true,soloDisplayName:name,soloPublicRanking:request.data.publicRanking});
      tx.set(indexRef,{userId});
    });
    return {ok:true};
  }
  async function get(request){
    const a=await owner(request),p=period(request.data);
    if(!a.userId)return {enrolled:false,hasProfile:false};
    if(!a.user.soloEnabled)return {enrolled:false,hasProfile:true,hasGroups:Object.keys(a.user.memberships||{}).length>0,name:a.user.name||''};
    const records=await db.collection('users').doc(a.userId).collection('soloLogs').where('seasonId','==',p.sid).get();
    const logs=records.docs.map(d=>d.data());
    const months=[...new Set(a.user.soloMonths||[])].filter(s=>/^\d{4}-(0[1-9]|1[0-2])$/.test(s)).sort();
    return {enrolled:true,hasProfile:true,name:a.user.soloDisplayName,months,hasGroups:Object.keys(a.user.memberships||{}).length>0,publicRanking:!!a.user.soloPublicRanking,period:p,logs,score:scoreSoloDays(logs,p.year,p.month,p.throughDay)};
  }
  async function save(request){
    const a=await owner(request),p=period(request.data),day=Number(request.data?.day),workouts=request.data?.workouts;
    if(!a.userId||!a.user.soloEnabled)fail('failed-precondition','Choose solo mode first.');
    if(!p.current||!Number.isInteger(day)||day<Math.max(1,p.throughDay-7)||day>p.throughDay)fail('invalid-argument','Log today or one of the previous seven days in the current month.');
    if(!Array.isArray(workouts)||!workouts.length||workouts.length>12||workouts.some(w=>typeof w!=='string'||w.length>40||!w.trim()))fail('invalid-argument','Choose your workout.');
    const note=String(request.data?.note||'').trim();if(note.length>500)fail('invalid-argument','Keep the note under 500 characters.');
    const ref=db.collection('users').doc(a.userId),date=p.sid+'-'+String(day).padStart(2,'0'),logRef=ref.collection('soloLogs').doc(date),boardRef=db.collection('soloBoards').doc(p.sid).collection('entries').doc(a.userId);
    return db.runTransaction(async tx=>{
      const user=await tx.get(ref),records=await tx.get(ref.collection('soloLogs').where('seasonId','==',p.sid));
      if(!user.exists||user.data().authUid!==a.uid||user.data().deletionRequestedAt)fail('permission-denied','Profile unavailable.');
      const log={year:p.year,month:p.month,day,workouts:[...new Set(workouts.map(w=>w.trim()))],note,seasonId:p.sid};
      const logs=records.docs.filter(d=>d.id!==date).map(d=>d.data());logs.push(log);
      const score=scoreSoloDays(logs,p.year,p.month,p.throughDay);
      tx.set(logRef,log);
      tx.update(ref,{soloMonths:FieldValue.arrayUnion(p.sid)});
      if(user.data().soloPublicRanking)tx.set(boardRef,{name:user.data().soloDisplayName,total:score.total,days:score.days,updatedAt:FieldValue.serverTimestamp()});
      else tx.delete(boardRef);
      return {ok:true,score};
    });
  }
  async function board(request){
    const a=await owner(request),p=period(request.data);
    const rows=await db.collection('soloBoards').doc(p.sid).collection('entries').orderBy('total','desc').limit(100).get();
    let previous=null,rank=0;
    return {period:p,entries:rows.docs.map((d,i)=>{const value=d.data();if(value.total!==previous)rank=i+1;previous=value.total;return {name:value.name,total:value.total,days:value.days,rank,isYou:d.id===a.userId};}),limit:100};
  }
  async function visibility(request){
    const a=await owner(request),enabled=request.data?.publicRanking;
    if(typeof enabled!=='boolean')fail('invalid-argument','Choose whether your solo record is public.');
    if(!a.userId||!a.user.soloEnabled)fail('failed-precondition','Choose solo mode first.');
    const ref=db.collection('users').doc(a.userId);
    await db.runTransaction(async tx=>{
      const snap=await tx.get(ref),u=snap.data();
      if(!snap.exists||u.authUid!==a.uid||u.deleted||u.deletionRequestedAt)fail('permission-denied','Profile unavailable.');
      const months=[...new Set(u.soloMonths||[])].filter(s=>/^\d{4}-(0[1-9]|1[0-2])$/.test(s));
      if(months.length>120)fail('failed-precondition','Contact support to update this long-running record.');
      const entries=[];
      // Read every month before any write; retries recompute rather than
      // publishing stale totals. No public visibility changes on partial failure.
      for(const sid of months){
        const boardRef=db.collection('soloBoards').doc(sid).collection('entries').doc(a.userId);
        if(!enabled){entries.push({ref:boardRef});continue;}
        const [year,month]=sid.split('-').map(Number),p=period({year,month});
        const records=await tx.get(ref.collection('soloLogs').where('seasonId','==',sid));
        const score=scoreSoloDays(records.docs.map(d=>d.data()),year,month,p.throughDay);
        entries.push({ref:boardRef,value:score.days?{name:u.soloDisplayName,total:score.total,days:score.days,updatedAt:FieldValue.serverTimestamp()}:null});
      }
      tx.update(ref,{soloPublicRanking:enabled});
      for(const entry of entries){if(entry.value)tx.set(entry.ref,entry.value);else tx.delete(entry.ref);}
    });
    return {ok:true,publicRanking:enabled};
  }
  async function hide(request){
    const a=await owner(request);if(!a.userId)fail('failed-precondition','No solo profile.');
    const ref=db.collection('users').doc(a.userId);
    await db.runTransaction(async tx=>{
      const snap=await tx.get(ref),u=snap.data();
      if(!snap.exists||u.authUid!==a.uid||u.deleted||u.deletionRequestedAt)fail('permission-denied','Profile unavailable.');
      const months=u.soloMonths||[];
      if(months.length>450)fail('failed-precondition','Contact support to hide this long-running record.');
      tx.update(ref,{soloPublicRanking:false});
      for(const sid of months)if(/^\d{4}-\d{2}$/.test(sid))tx.delete(db.collection('soloBoards').doc(sid).collection('entries').doc(a.userId));
    });
    return {ok:true};
  }
  async function remove(request){
    identity.actor(request);const a=await owner(request);
    if(!a.userId)fail('failed-precondition','No solo profile.');
    if(Object.keys(a.user.memberships||{}).length)fail('failed-precondition','Delete this shared account from your group Profile to remove group history too.');
    await db.collection('users').doc(a.userId).update({deletionRequestedAt:FieldValue.serverTimestamp()});
    return identity.finalizeDeletion({...request,data:{userId:a.userId}});
  }
  return {enroll,get,save,board,hide,remove,visibility};
};
