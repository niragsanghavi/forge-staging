'use strict';
const crypto=require('node:crypto');
module.exports=({db,FieldValue,HttpsError,identity,now=Date.now})=>{
 const currentRef=()=>db.collection('publishedAnnouncements').doc('current');
 const fail=(code,message)=>{throw new HttpsError(code,message);};
 const hash=x=>crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex');
 const revision=s=>s.exists?hash(s.data()):'none';
 const publicValue=s=>!s.exists||!s.data().published||s.data().expiresAt<=now()?null:(({id,title,message,action,webStore,expiresAt})=>({id,title,message,action,webStore,expiresAt}))(s.data());
 function authorize(r){const a=identity.actor(r);if(r.auth.token.forgeAdmin!==true)fail('permission-denied','Only the approved Superadmin can publish.');return a;}
 function draft(d){
  if(typeof d?.title!=='string'||!d.title.trim()||d.title.length>60||typeof d.message!=='string'||!d.message.trim()||d.message.length>500||!['none','guide','log','store'].includes(d.action)||!['none','apple','play'].includes(d.webStore)||!Number.isInteger(d.days)||d.days<1||d.days>31)fail('invalid-argument','Add a title, message, action and expiry of 1–31 days.');
  return {title:d.title.trim(),message:d.message.trim(),action:d.action,webStore:d.webStore,days:d.days};
 }
 async function get(){return {announcement:publicValue(await currentRef().get())};}
 async function preview(r){
  const a=authorize(r),content=draft(r.data?.draft),current=await currentRef().get();
  const reviewId=crypto.randomUUID(),expiresAt=now()+15*60000;
  await db.collection('announcementReviews').doc(reviewId).set({authUid:a.uid,content,expected:revision(current),expiresAt});
  return {reviewId,draft:content,expiresAt,current:publicValue(current)};
 }
 async function publish(r){
  const a=authorize(r),id=r.data?.reviewId,ref=currentRef();
  if(typeof id!=='string'||!/^[a-f0-9-]{36}$/.test(id))fail('invalid-argument','Preview the announcement first.');
  return db.runTransaction(async tx=>{
   const reviewRef=db.collection('announcementReviews').doc(id),review=await tx.get(reviewRef),current=await tx.get(ref);
   if(!review.exists||review.data().authUid!==a.uid)fail('permission-denied','Preview this announcement with your admin account.');
   const p=review.data();
   if(p.publishedId)return {ok:true,id:p.publishedId,already:true};
   if(now()>p.expiresAt||p.expected!==revision(current))fail('failed-precondition','The preview expired or another announcement changed. Preview again.');
   const content=draft(p.content),published={id, title:content.title,message:content.message,action:content.action,webStore:content.webStore,expiresAt:now()+content.days*86400000,published:true,publishedAt:FieldValue.serverTimestamp(),publishedBy:a.uid};
   tx.set(ref,published);tx.update(reviewRef,{publishedId:id});
   tx.set(db.collection('announcementAudit').doc(id),{action:'publish',authUid:a.uid,at:FieldValue.serverTimestamp(),content});
   return {ok:true,id};
  });
 }
 async function unpublish(r){
  const a=authorize(r),id=r.data?.id,ref=currentRef();
  if(typeof id!=='string'||!/^[a-f0-9-]{36}$/.test(id))fail('invalid-argument','Choose the published announcement.');
  return db.runTransaction(async tx=>{
   const current=await tx.get(ref);
   if(!current.exists||current.data().id!==id)fail('failed-precondition','The announcement changed. Refresh before unpublishing.');
   if(!current.data().published)return {ok:true,already:true};
   tx.update(ref,{published:false,unpublishedAt:FieldValue.serverTimestamp(),unpublishedBy:a.uid});
   tx.set(db.collection('announcementAudit').doc(id+'-unpublish'),{action:'unpublish',id,authUid:a.uid,at:FieldValue.serverTimestamp()});
   return {ok:true};
  });
 }
 return {get,preview,publish,unpublish};
};
