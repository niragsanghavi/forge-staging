'use strict';
const crypto=require('node:crypto');
const {profileSummary,workoutSummary}=require('./aggregate-service');
// User-initiated legacy linking only. Never replace a provider owner, infer
// ownership from a name, split a merge across commits, or expose PIN verifiers.
module.exports=({db,FieldValue,HttpsError,identity,groupWrites,now=Date.now})=>async request=>{
 const actor=identity.actor(request),d=request.data||{},code=d.groupCode;
 const fail=(code,message)=>{throw new HttpsError(code,message);};
 if(typeof code!=='string'||!/^[A-Z0-9]{4,10}$/.test(code)||typeof d.name!=='string'||d.name.length>24||!/^\d{4}$/.test(String(d.pin||'')))fail('invalid-argument','Enter the group, profile name and Forge PIN.');
 const result=await db.runTransaction(async tx=>{
  const a=await groupWrites.owner(tx,request),selfRef=db.collection('users').doc(a.userId),selfSnap=await tx.get(selfRef),self=selfSnap.data();
  if(self.mergedInto)fail('failed-precondition','Refresh your account before linking.');
  const group=await tx.get(db.collection('groups').doc(code)),sid=group.exists&&group.data().currentSeasonId;
  if(!sid)fail('permission-denied','Could not confirm this profile.');
  const season=await tx.get(group.ref.collection('seasons').doc(sid));
  if(!season.exists||season.data().credentialSchema!==2)fail('failed-precondition','This group needs its reviewed account migration first.');
  const matches=(season.data().roster||[]).filter(p=>p&&!p.departed&&String(p.name).toLowerCase()===d.name.trim().toLowerCase());
  if(matches.length!==1||!matches[0].userId)fail('permission-denied','Could not confirm this profile.');
  const targetId=matches[0].userId;
  if(targetId===a.userId)return {ok:true,already:true,canonical:a.userId,groupName:group.data().name||code};
  const targetRef=db.collection('users').doc(targetId),targetSnap=await tx.get(targetRef),target=targetSnap.exists&&targetSnap.data();
  if(!target||target.authUid||target.mergedInto||target.deleted||target.deletedAt||target.deletionRequestedAt)fail('permission-denied','This profile cannot be linked using its old PIN.');
  const limitRef=db.collection('identityClaimLimits').doc(targetId),limitSnap=await tx.get(limitRef),limit=limitSnap.exists?limitSnap.data():{},at=now();
  const count=Number.isFinite(limit.startedAt)&&at-limit.startedAt<3600000?(Number(limit.count)||0):0;
  if(count>=5)return {limited:true};
  const expected=String(target.pinHash||''),actual=crypto.createHash('sha256').update(String(d.pin)).digest('hex');
  if(!/^[a-f0-9]{64}$/i.test(expected)||!crypto.timingSafeEqual(Buffer.from(expected,'hex'),Buffer.from(actual,'hex'))){tx.set(limitRef,{startedAt:count?limit.startedAt:at,count:count+1});return {invalid:true};}
  const memberships={...target.memberships,...self.memberships};if(Object.keys(memberships).length>7)fail('failed-precondition','More than seven memberships need a reviewed migration.');
  const groups=await tx.get(db.collection('groups')),allLogs=await tx.get(db.collection('logs')),writes=[],groupCodes=[];
  for(const g of groups.docs){
   const seasons=await tx.get(g.ref.collection('seasons'));
   for(const ss of seasons.docs){
    const s=ss.data(),rows=s.roster||[],owned=rows.filter(p=>p?.userId===targetId);
    if(ss.id===g.data().currentSeasonId&&rows.some(p=>p&&!p.departed&&[a.userId,targetId].includes(p.userId)))groupCodes.push(g.id);
    if(!owned.length)continue;
    if(rows.some(p=>p?.userId===a.userId))fail('failed-precondition','Both profiles appear in the same season. A reviewed merge is required.');
    if(allLogs.docs.some(doc=>{const l=doc.data();return !l.voided&&!l.userId&&l.groupCode===g.id&&l.year===s.year&&l.month===s.month&&owned.some(p=>p.name===l.player);}))fail('failed-precondition','Historical workouts need verified ownership before linking.');
    const remap=rows=>rows.map(p=>p?.userId===targetId?{...p,userId:a.userId}:p);
    const value={roster:remap(rows)};
    for(const key of ['finalStandings','badgesAwarded'])if(Array.isArray(s[key]))value[key]=remap(s[key]);
    writes.push({ref:ss.ref,value,update:true});
    for(const kind of ['bets','jackAwards','stepWeeks']){
     const docs=await tx.get(ss.ref.collection(kind).where('userId','==',targetId));for(const doc of docs.docs)writes.push({ref:doc.ref,value:{userId:a.userId},update:true});
    }
   }
  }
  for(const doc of allLogs.docs)if(doc.data().userId===targetId)writes.push({ref:doc.ref,value:{userId:a.userId},update:true});
  for(const kind of ['bonuses_30day','bonuses_iron_pledge','flags']){
   const docs=await tx.get(db.collection(kind).where('userId','==',targetId));for(const doc of docs.docs)writes.push({ref:doc.ref,value:{userId:a.userId},update:true});
  }
  const archives=await tx.get(targetRef.collection('seasons'));
  for(const old of archives.docs){
   const ref=selfRef.collection('seasons').doc(old.id);if((await tx.get(ref)).exists)fail('failed-precondition','Overlapping season archives need review.');
   writes.push({ref,value:old.data()},{ref:old.ref,remove:true});
  }
  if(groupCodes.length>7)fail('failed-precondition','More than seven active groups need a reviewed migration.');
  if(writes.length>400)fail('failed-precondition','This history needs a reviewed large-account merge. Nothing was changed.');
  const combined=allLogs.docs.filter(doc=>[targetId,a.userId].includes(doc.data().userId)).map(doc=>({id:doc.id,...doc.data()}));
  const badgeCounts={...self.stats?.badgeCounts};for(const [key,n]of Object.entries(target.stats?.badgeCounts||{}))badgeCounts[key]=(Number(badgeCounts[key])||0)+(Number(n)||0);
  const stamp=FieldValue.serverTimestamp();
  for(const w of writes){if(w.remove)tx.delete(w.ref);else if(w.update)tx.update(w.ref,w.value);else tx.set(w.ref,w.value);}
  tx.update(selfRef,{memberships,stats:{...self.stats,...profileSummary(combined,at),badgeCounts},workoutCounts:workoutSummary(combined,at),monthlyGoals:{...target.monthlyGoals,...self.monthlyGoals},groupRanks:{...target.groupRanks,...self.groupRanks}});
  tx.set(targetRef,{mergedInto:a.userId,mergedAt:stamp});
  tx.set(db.collection('authIdentities').doc(actor.uid),{userId:a.userId,groupCodes});
  tx.set(db.collection('identityMergeAudits').doc(crypto.createHash('sha256').update(JSON.stringify([a.userId,targetId])).digest('hex')),{canonical:a.userId,mergedIn:targetId,at:stamp,changedDocuments:writes.length+4,actor:actor.uid});
  return {ok:true,already:false,canonical:a.userId,groupName:group.data().name||code};
 });
 if(result.limited)fail('resource-exhausted','Too many attempts. Try again in an hour.');
 if(result.invalid)fail('permission-denied','Could not confirm this profile. Check your PIN.');
 return result;
};
