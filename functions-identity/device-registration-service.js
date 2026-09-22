'use strict';
// Device registration only. Never schedules or sends a notification.
module.exports=({db,FieldValue,HttpsError,identity})=>async request=>{
 const a=identity.actor(request,false),d=request.data||{},mode=d.mode;
 if(!['enable','disable','status'].includes(mode)||typeof d.token!=='string'||d.token.length<20||d.token.length>4096||/[.\[\]*/\s]/.test(d.token))throw new HttpsError('invalid-argument','Invalid device registration.');
 if(mode==='enable'&&!['ios','android','web'].includes(d.platform))throw new HttpsError('invalid-argument','Invalid device platform.');
 return db.runTransaction(async tx=>{
  const index=await tx.get(db.collection('authIdentities').doc(a.uid)),id=index.exists&&index.data().userId;
  if(!id)throw new HttpsError('permission-denied','Link your account first.');
  const ref=db.collection('users').doc(id),snap=await tx.get(ref),u=snap.exists&&snap.data();
  if(!u||u.authUid!==a.uid||u.deleted||u.deletedAt||u.deletionRequestedAt||u.mergedInto)throw new HttpsError('permission-denied','Profile unavailable.');
  const tokens={...(u.pushTokens||{})};
  if(mode==='enable'){tokens[d.token]={platform:d.platform,addedAt:FieldValue.serverTimestamp()};tx.update(ref,{pushTokens:tokens,pushEnabledAt:FieldValue.serverTimestamp()});}
  if(mode==='disable'){delete tokens[d.token];tx.update(ref,{pushTokens:tokens});}
  return {ok:true,registered:mode==='enable'||(mode==='status'&&!!tokens[d.token])};
 });
};

