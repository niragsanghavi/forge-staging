'use strict';
const crypto=require('node:crypto');
// Recoverable group removal. No log/season/profile deletions, admin grants,
// score rewrites, notifications, or automatic rollover.
module.exports=({db,FieldValue,HttpsError,identity})=>{
 const fail=(code,message)=>{throw new HttpsError(code,message);};
 const revision=g=>crypto.createHash('sha256').update(JSON.stringify([g.name||'',g.players||[],g.currentSeasonId||null,g.archived===true,g.archiveRevision||0,g.archivedSeasonId||null])).digest('hex');
 function authorize(request,recent){
  const actor=identity.actor(request,recent);
  if(request.auth.token.forgeAdmin!==true)fail('permission-denied','Verified Superadmin access is required.');
  const code=request.data?.groupCode;
  if(typeof code!=='string'||!/^[A-Z0-9]{4,10}$/.test(code))fail('invalid-argument','Choose a valid group.');
  return {actor,code,ref:db.collection('groups').doc(code)};
 }
 async function preview(request){
  const {code,ref}=authorize(request,false),snap=await ref.get();
  if(!snap.exists)fail('not-found','Group no longer exists. Refresh the list.');
  const g=snap.data(),logs=await db.collection('logs').where('groupCode','==',code).limit(1001).get();
  return {groupCode:code,name:g.name||code,archived:g.archived===true,revision:revision(g),members:Array.isArray(g.players)?g.players.length:0,workoutRecords:logs.size,atLeast:logs.size===1001,seasonId:g.currentSeasonId||g.archivedSeasonId||null};
 }
 async function setArchived(request){
  const {actor,code,ref}=authorize(request,true),d=request.data;
  if(typeof d.archived!=='boolean'||d.confirmCode!==code||typeof d.revision!=='string'||!/^[a-f0-9]{64}$/.test(d.revision))fail('invalid-argument','Review the group and type its exact code to confirm.');
  return db.runTransaction(async tx=>{
   const snap=await tx.get(ref);if(!snap.exists)fail('not-found','Group no longer exists.');
   const g=snap.data();
   if(revision(g)!==d.revision)fail('failed-precondition','The group changed. Review it again before confirming.');
   if((g.archived===true)===d.archived)return {ok:true,already:true,archived:d.archived};
   if(!d.archived&&g.archivedSeasonId){
    const season=await tx.get(ref.collection('seasons').doc(g.archivedSeasonId));
    if(!season.exists)fail('failed-precondition','The saved season is missing. Contact support before restoring.');
   }
   const at=FieldValue.serverTimestamp(),version=(Number(g.archiveRevision)||0)+1;
   const patch=d.archived?{archived:true,archivedAt:at,archivedBy:actor.uid,archivedSeasonId:g.currentSeasonId||null,currentSeasonId:null,archiveRevision:version}:{archived:false,restoredAt:at,restoredBy:actor.uid,currentSeasonId:g.archivedSeasonId||null,archiveRevision:version};
   tx.update(ref,patch);
   tx.set(db.collection('groupArchiveAudit').doc(code+'-'+version),{groupCode:code,action:d.archived?'archive':'restore',actorUid:actor.uid,at,previousSeasonId:g.currentSeasonId||null});
   return {ok:true,archived:d.archived};
  });
 }
 return {preview,setArchived};
};
