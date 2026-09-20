'use strict';
// Callable-only private support. A client PIN, name or group role is never authority.
module.exports=({db,identity,HttpsError,now=Date.now})=>{
  const fail=(code,message)=>{throw new HttpsError(code,message);};
  const states=['sent','acknowledged','working','resolved'];
  function actor(r,admin=false){
    const a=identity.actor(r,false),isAdmin=r.auth.token?.forgeSupportAdmin===true;
    if(admin&&!isAdmin)fail('permission-denied','Support admin access is not enabled for this sign-in.');
    return {...a,isAdmin};
  }
  async function profile(a){
    const index=await db.collection('authIdentities').doc(a.uid).get();
    if(!index.exists)fail('failed-precondition','Link your Forge profile to Google or Apple before using private support.');
    const user=await db.collection('users').doc(index.data().userId).get();
    if(!user.exists||user.data().authUid!==a.uid||user.data().deleted||user.data().deletionRequestedAt)fail('permission-denied','This profile is unavailable.');
    return {userId:user.id,user:user.data()};
  }
  function threadRef(r,a){
    const id=r.data?.threadId||a.uid;
    if(typeof id!=='string'||!/^[\w-]{1,128}$/.test(id))fail('invalid-argument','Invalid conversation.');
    if(id!==a.uid&&!a.isAdmin)fail('permission-denied','This conversation is private.');
    return db.collection('supportThreads').doc(id);
  }
  const visible=d=>({id:d.id,...d.data()});
  async function get(r){
    const a=actor(r),ref=threadRef(r,a),p=await profile(a),context={name:p.user.name||'Forge member',groups:Object.keys(p.user.memberships||{}).slice(0,20)};
    const snap=await ref.get();if(!snap.exists)return {thread:null,messages:[],isAdmin:a.isAdmin,context};
    if(snap.data().deleting)fail('failed-precondition','This conversation is being deleted.');
    if(r.data?.summary===true)return {thread:visible(snap),messages:[],isAdmin:a.isAdmin,context};
    const before=Number(r.data?.before||Number.MAX_SAFE_INTEGER);
    if(!Number.isSafeInteger(before)||before<1)fail('invalid-argument','Invalid message page.');
    const messages=await ref.collection('messages').where('sequence','<',before).orderBy('sequence','desc').limit(50).get();
    return {thread:visible(snap),messages:messages.docs.map(d=>{const {authorUid,...message}=visible(d);return message;}).reverse(),isAdmin:a.isAdmin,context};
  }
  async function inbox(r){
    actor(r,true);
    const rows=await db.collection('supportThreads').orderBy('updatedAt','desc').limit(100).get();
    return {threads:rows.docs.map(visible),limit:100};
  }
  async function post(r){
    const a=actor(r),admin=r.data?.asAdmin===true;
    if(admin&&!a.isAdmin)fail('permission-denied','Support admin access is required.');
    const ref=threadRef(r,a),p=await profile(a),text=String(r.data?.text||'').trim(),status=r.data?.status;
    if(ref.id!==a.uid&&!admin)fail('permission-denied','Use the support inbox to reply as an admin.');
    if(text.length>2000||(!text&&!(admin&&states.includes(status))))fail('invalid-argument','Write a message of 1–2,000 characters.');
    if(admin&&status!==undefined&&!states.includes(status))fail('invalid-argument','Choose a valid support status.');
    const operation=r.data?.operationId;
    if(typeof operation!=='string'||!/^[\w-]{16,80}$/.test(operation))fail('invalid-argument','A message identifier is required.');
    const message=ref.collection('messages').doc(operation),at=now();
    return db.runTransaction(async tx=>{
      const prior=await tx.get(message),snap=await tx.get(ref),user=await tx.get(db.collection('users').doc(p.userId));
      if(!user.exists||user.data().authUid!==a.uid||user.data().deleted||user.data().deletionRequestedAt)fail('permission-denied','Profile unavailable.');
      if(prior.exists){if(prior.data().authorUid!==a.uid)fail('permission-denied','Invalid message identifier.');return {ok:true,duplicate:true};}
      const previous=snap.exists?snap.data():null;
      if(previous?.deleting)fail('failed-precondition','This conversation is being deleted.');
      if(admin&&!previous)fail('not-found','Conversation not found.');
      if(!admin&&previous&&previous.ownerUserId!==p.userId)fail('permission-denied','This conversation is unavailable.');
      if(!admin&&previous&&at-previous.lastMemberAt<5000)fail('resource-exhausted','Give that message a moment before sending another.');
      const sequence=(previous?.sequence||0)+1,nextStatus=admin?(status||previous.status):previous?.status==='working'?'working':'sent';
      const groups=Object.keys(user.data().memberships||{}).slice(0,20);
      const thread={...(previous||{}),ownerUserId:previous?.ownerUserId||p.userId,name:previous?.name||user.data().name||'Forge member',groups:previous?.groups||groups,createdAt:previous?.createdAt||at,updatedAt:at,sequence,status:nextStatus,
        memberRead:admin?(previous.memberRead||0):sequence,adminRead:admin?sequence:(previous?.adminRead||0),lastMemberAt:admin?previous.lastMemberAt:at};
      tx.set(ref,thread);
      tx.set(message,{sequence,text,role:admin?'admin':'member',authorUid:a.uid,status:nextStatus,at});
      return {ok:true,sequence};
    });
  }
  async function seen(r){
    const a=actor(r),ref=threadRef(r,a),admin=r.data?.asAdmin===true;
    if(ref.id!==a.uid&&!admin)fail('permission-denied','Use the support inbox for this conversation.');
    await profile(a);if(admin&&!a.isAdmin)fail('permission-denied','Support admin access is required.');
    const sequence=Number(r.data?.sequence);if(!Number.isSafeInteger(sequence)||sequence<0)fail('invalid-argument','Invalid read marker.');
    await db.runTransaction(async tx=>{const snap=await tx.get(ref);if(!snap.exists)return;const data=snap.data(),key=admin?'adminRead':'memberRead';tx.update(ref,{[key]:Math.max(data[key]||0,Math.min(sequence,data.sequence))});});
    return {ok:true};
  }
  return {get,inbox,post,seen};
};
