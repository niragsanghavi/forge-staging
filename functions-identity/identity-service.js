'use strict';
const crypto = require('node:crypto');

// Legacy PIN migration is an explicitly accepted lower-assurance transition.
// Never use this endpoint to replace an existing owner. No PINs/tokens in logs.
module.exports = function identityService({db, FieldValue, HttpsError, deleteAuthUser, now=Date.now}) {
  const fail=(code,message)=>{throw new HttpsError(code,message);};
  function actor(request,recent=true){
    const a=request.auth, t=a&&a.token, p=t&&t.firebase&&t.firebase.sign_in_provider;
    if(!a||!a.uid) fail('unauthenticated','Sign in first.');
    if(!['google.com','apple.com'].includes(p)) fail('permission-denied','Use Google or Apple sign-in.');
    if(recent&&(!Number.isFinite(t.auth_time)||now()/1000-t.auth_time>600)) fail('unauthenticated','Sign in again to confirm this change.');
    return {uid:a.uid,provider:p,email:typeof t.email==='string'?t.email:null};
  }
  async function claim(request){
    const a=actor(request), d=request.data||{}, id=String(d.userId||'');
    if(!/^[A-Za-z0-9_-]{1,128}$/.test(id)||!/^\d{4}$/.test(String(d.pin||''))) fail('invalid-argument','Choose your profile and enter its four-digit Forge PIN.');
    const uRef=db.collection('users').doc(id), ownerRef=db.collection('authIdentities').doc(a.uid);
    // Target-wide, not merely per attacking Google account. Transactionally
    // count every attempt; throwing inside the transaction would undo limits.
    const limitRef=db.collection('identityClaimLimits').doc(id);
    const legacy=db.collection('users').where('authUid','==',a.uid).limit(2);
    const at=now();
    const result=await db.runTransaction(async tx=>{
      const uSnap=await tx.get(uRef), owner=await tx.get(ownerRef), limits=await tx.get(limitRef), previous=await tx.get(legacy);
      if(!uSnap.exists||uSnap.data().deletedAt||uSnap.data().deleted||uSnap.data().deletionRequestedAt) return {error:'Profile unavailable.'};
      const u=uSnap.data();
      if(owner.exists&&owner.data().userId!==id) return {error:'This sign-in already belongs to another Forge profile.'};
      if(previous.docs.some(x=>x.id!==id)) return {error:'This sign-in already belongs to another Forge profile.'};
      if(u.authUid&&u.authUid!==a.uid) return {error:'This profile is already linked. Sign in with its linked account.'};
      if(u.authUid===a.uid){tx.set(ownerRef,{userId:id});return {ok:true,userId:id,already:true};}
      const l=limits.exists?limits.data():{}, fresh=Number.isFinite(l.startedAt)&&at-l.startedAt<3600000;
      const count=fresh?Number(l.count)||0:0;
      if(count>=5) return {limited:true};
      tx.set(limitRef,{startedAt:fresh?l.startedAt:at,count:count+1});
      const expected=String(u.pinHash||'');
      const actual=crypto.createHash('sha256').update(String(d.pin)).digest('hex');
      if(!/^[a-f0-9]{64}$/i.test(expected)||!crypto.timingSafeEqual(Buffer.from(expected,'hex'),Buffer.from(actual,'hex'))) return {error:'Could not confirm this profile. Check your PIN.'};
      tx.update(uRef,{authUid:a.uid,email:a.email,authProvider:a.provider,authLinkedAt:FieldValue.serverTimestamp(),claimedAt:FieldValue.serverTimestamp()});
      tx.set(ownerRef,{userId:id,createdAt:FieldValue.serverTimestamp()});
      return {ok:true,userId:id};
    });
    if(result.limited) fail('resource-exhausted','Too many attempts for this profile. Try again in an hour.');
    if(result.error) fail('permission-denied',result.error);
    return result;
  }
  async function join(request){
    const a=actor(request), d=request.data||{}, code=String(d.groupCode||'').trim().toUpperCase(), name=String(d.name||'').trim();
    if(!/^[A-Z0-9]{4,10}$/.test(code)||name.length<2||name.length>24||/[^\p{L}\p{N} .\-]/u.test(name)) fail('invalid-argument','Enter a valid group code and name.');
    const ownerRef=db.collection('authIdentities').doc(a.uid), gRef=db.collection('groups').doc(code), newId=crypto.randomUUID();
    return db.runTransaction(async tx=>{
      const owner=await tx.get(ownerRef), legacy=await tx.get(db.collection('users').where('authUid','==',a.uid).limit(2)), group=await tx.get(gRef);
      if(!group.exists||group.data().demo) fail('not-found','Choose a real group.');
      const sid=group.data().currentSeasonId;
      if(!sid||sid!==d.seasonId) fail('failed-precondition','The season changed. Refresh the group.');
      const sRef=gRef.collection('seasons').doc(sid), season=await tx.get(sRef);
      if(!season.exists||['archived','closed','deleted'].includes(season.data().status)) fail('failed-precondition','This season is not open.');
      if(legacy.docs.length>1) fail('failed-precondition','Account needs recovery before joining.');
      const id=owner.exists?owner.data().userId:legacy.docs.length?legacy.docs[0].id:newId;
      if(legacy.docs.length&&legacy.docs[0].id!==id) fail('failed-precondition','Account needs recovery before joining.');
      const uRef=db.collection('users').doc(id), snap=await tx.get(uRef), u=snap.exists?snap.data():null;
      if((owner.exists&&!u)||(u&&(u.deletedAt||u.deleted||u.deletionRequestedAt||u.authUid!==a.uid))) fail('permission-denied','Account unavailable.');
      const roster=season.data().roster||[], memberships=u&&u.memberships||{};
      if(roster.some(p=>p.userId===id))return {ok:true,userId:id,already:true};
      if(Object.keys(memberships).length>=7&&!memberships[code])fail('failed-precondition','You already belong to seven groups.');
      if(roster.some(p=>String(p.name||'').toLowerCase()===name.toLowerCase()))fail('already-exists','That name is already on this roster. Existing members must link their profile instead.');
      const n=Number(season.data().numTeams)||1;
      if(!Number.isInteger(n)||n<1||n>26)fail('failed-precondition','Group team setup needs attention.');
      const team=String.fromCharCode(65+roster.length%n), stamp=FieldValue.serverTimestamp();
      const entry={name,team,role:'Player',userId:id,uid:a.uid,pinSet:false};
      tx.update(sRef,{roster:[...roster,entry]});
      const players=(group.data().players||[]).filter(p=>p&&typeof p.name==='string');
      if(!players.some(p=>p.name.toLowerCase()===name.toLowerCase()))players.push({name});
      tx.update(gRef,{players});
      const base=u||{name,nameLower:name.toLowerCase(),pinHash:null,createdAt:stamp,authUid:a.uid,email:a.email,authProvider:a.provider,authLinkedAt:stamp,migratedFrom:'provider-signup',knownDeviceUids:[],stats:{seasonsPlayed:0,monthsLogged:0,monthsList:[],badgeCounts:{},totalWorkouts:0,currentStreak:0,longestStreak:0,lastLoggedDay:null}};
      tx.set(uRef,{...base,memberships:{...memberships,[code]:{joinedAt:stamp,groupName:group.data().name||code}}});
      tx.set(ownerRef,{userId:id});
      return {ok:true,userId:id};
    });
  }
  async function finalizeDeletion(request){
    const a=actor(request),id=String(request.data?.userId||'');
    if(!/^[A-Za-z0-9_-]{1,128}$/.test(id))fail('invalid-argument','Invalid profile.');
    const ref=db.collection('users').doc(id),snap=await ref.get();
    if(!snap.exists||snap.data().authUid!==a.uid)fail('permission-denied','Sign in as this profile owner.');
    const u=snap.data();
    if(!u.deletionRequestedAt)fail('failed-precondition','Start deletion in Profile first.');
    const logs=await db.collection('logs').where('userId','==',id).get();
    if(logs.docs.some(d=>!d.data().voided))fail('failed-precondition','Workout deletion has not finished. Retry deletion.');
    for(const code of Object.keys(u.memberships||{})){
      const group=await db.collection('groups').doc(code).get();
      const sid=group.exists&&group.data().currentSeasonId;
      if(!sid)continue;
      const season=await db.collection('groups').doc(code).collection('seasons').doc(sid).get();
      if(season.exists&&(season.data().roster||[]).some(p=>p.userId===id))fail('failed-precondition','Group removal has not finished. Retry deletion.');
    }
    if(typeof deleteAuthUser!=='function')fail('failed-precondition','Account deletion is not configured.');
    // Durable server-only job survives Auth deletion followed by a lost
    // response or failed Firestore write. The scheduled worker can finish it
    // without requiring a now-deleted account to authenticate again.
    await db.collection('identityDeletionJobs').doc(a.uid).set({userId:id,state:'pending',requestedAt:FieldValue.serverTimestamp()});
    await finishDeletionJob(a.uid,id);
    return {ok:true};
  }
  async function finishDeletionJob(uid,id){
    const ref=db.collection('users').doc(id),snap=await ref.get();
    if(!snap.exists||snap.data().authUid!==uid||!snap.data().deletionRequestedAt)fail('failed-precondition','Deletion ownership changed.');
    if(snap.data().soloEnabled){
      // Repeated batches make this resumable even for years of private logs.
      const solo=ref.collection('soloLogs');
      for(;;){
        const records=await solo.limit(200).get();
        if(!records.docs.length)break;
        const cleanup=db.batch();
        for(const d of records.docs)cleanup.delete(solo.doc(d.id));
        await cleanup.commit();
      }
      for(const sid of snap.data().soloMonths||[]){
        if(/^\d{4}-\d{2}$/.test(sid))await db.collection('soloBoards').doc(sid).collection('entries').doc(id).delete();
      }
    }
    const support=db.collection('supportThreads').doc(uid);
    if((await support.get()).exists){
      await support.update({deleting:true});
      for(;;){const records=await support.collection('messages').limit(200).get();if(!records.docs.length)break;const cleanup=db.batch();for(const d of records.docs)cleanup.delete(support.collection('messages').doc(d.id));await cleanup.commit();}
      await support.delete();
    }
    try{await deleteAuthUser(uid);}catch(e){if(e.code!=='auth/user-not-found')throw e;}
    const batch=db.batch();
    batch.update(ref,{name:'Deleted user',nameLower:'deleted user',email:null,pinHash:null,knownDeviceUids:[],pushTokens:{},memberships:{},stats:{},soloEnabled:false,soloDisplayName:null,soloPublicRanking:false,soloMonths:[],deleted:true,deletedAt:FieldValue.serverTimestamp(),authDeletedAt:FieldValue.serverTimestamp()});
    batch.update(db.collection('identityDeletionJobs').doc(uid),{state:'complete',completedAt:FieldValue.serverTimestamp()});
    await batch.commit();
  }
  async function retryDeletions(){
    const jobs=await db.collection('identityDeletionJobs').where('state','==','pending').limit(100).get();
    let completed=0,failed=0;
    for(const job of jobs.docs){try{await finishDeletionJob(job.id,job.data().userId);completed++;}catch(e){failed++;}}
    return {completed,failed};
  }
  return {claim,join,actor,finalizeDeletion,retryDeletions};
};
