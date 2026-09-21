'use strict';
// Isolated staging account/solo/steps deployment. No admin keys or
// notification senders are loaded by this entry point.
const admin=require('firebase-admin');
const {FieldValue}=require('firebase-admin/firestore');
const {onCall,HttpsError}=require('firebase-functions/v2/https');
const {onSchedule}=require('firebase-functions/v2/scheduler');
const {onDocumentWritten}=require('firebase-functions/v2/firestore');
const {setGlobalOptions}=require('firebase-functions/v2/options');
setGlobalOptions({region:'asia-south1',maxInstances:3});
if(!(admin.apps || []).length) admin.initializeApp();
const db=admin.firestore();
const identity=require('./identity-service')({db,FieldValue,HttpsError,deleteAuthUser:uid=>admin.auth().deleteUser(uid)});
const solo=require('./solo-service')({db,FieldValue,HttpsError,identity});
const support=require('./support-service')({db,HttpsError,identity});
const groupWrites=require('./group-write-service')({db,FieldValue,HttpsError,identity});
exports.linkLegacyGroup=onCall({timeoutSeconds:300},require('./legacy-link-service')({db,FieldValue,HttpsError,identity,groupWrites}));
const pledges=require('./pledge-service')({db,FieldValue,HttpsError,groupWrites});
const rollover=require('./rollover-service')({db,FieldValue,HttpsError,groupWrites,pledges,identity});
exports.lockPledge=onCall(r=>pledges.lock(r));
exports.settlePledges=onCall(r=>pledges.settle(r));
exports.rolloverGroup=onCall({timeoutSeconds:300},r=>rollover.run(r.data?.groupCode,r));
exports.rolloverSweep=onSchedule({schedule:'0 6 * * *',timeZone:'Asia/Kolkata',timeoutSeconds:300},()=>rollover.sweep());
const aggregates=require('./aggregate-service')({db,FieldValue,HttpsError,identity});
const admins=require('./admin-service')({db,FieldValue,HttpsError,identity});
exports.createGroupWithIdentity=onCall(require('./group-create-service')({db,FieldValue,HttpsError,identity}));
exports.getAdminAccess=onCall(r=>admins.access(r));
exports.changeGroupAdmin=onCall(r=>admins.change(r));
exports.getGroupFlags=onCall(r=>admins.flags(r));
exports.flagGroupWorkout=onCall(r=>groupWrites.flag(r));
exports.submitGroupSurvey=onCall(r=>groupWrites.survey(r));
exports.trackGroupTab=onCall(r=>groupWrites.trackTab(r));
exports.refreshGroupStats=onCall(r=>aggregates.refresh(r));
exports.getRecapPercentile=onCall(r=>aggregates.recapPercentile(r));
exports.repairDerivedStats=onCall({timeoutSeconds:300},r=>aggregates.repair(r));
exports.reconcileStatistics=onSchedule({schedule:'5 0 * * *',timeZone:'Asia/Kolkata',timeoutSeconds:300},()=>aggregates.reconcile());
exports.aggregateLogChanges=onDocumentWritten({document:'logs/{logId}',retry:true},async event=>{
  const before=event.data?.before.data(),after=event.data?.after.data();
  for(const code of new Set([before?.groupCode,after?.groupCode].filter(Boolean))){
    if((await db.collection('groups').doc(code).get()).exists)await aggregates.rebuild(code);
  }
  for(const id of new Set([before?.userId,after?.userId].filter(Boolean)))await aggregates.profile(id);
});
exports.aggregateSeasonChanges=onDocumentWritten({document:'groups/{code}/seasons/{sid}',retry:true},async event=>{
  const group=await db.collection('groups').doc(event.params.code).get();
  if(group.exists&&group.data().currentSeasonId===event.params.sid&&event.data?.after.exists)await aggregates.rebuild(event.params.code);
});
exports.aggregateAwardChanges=onDocumentWritten({document:'groups/{code}/seasons/{sid}/{kind}/{id}',retry:true},async event=>{
  if(!['twists','twistWindows','jackAwards'].includes(event.params.kind))return;
  const group=await db.collection('groups').doc(event.params.code).get();
  if(group.exists&&group.data().currentSeasonId===event.params.sid)await aggregates.rebuild(event.params.code);
});
exports.aggregateBonusChanges=onDocumentWritten({document:'{kind}/{id}',retry:true},async event=>{
  if(!['bonuses_30day','bonuses_iron_pledge'].includes(event.params.kind))return;
  for(const code of new Set([event.data?.before.data()?.groupCode,event.data?.after.data()?.groupCode].filter(Boolean))){
    if((await db.collection('groups').doc(code).get()).exists)await aggregates.rebuild(code);
  }
});
exports.saveGroupWorkout=onCall(r=>groupWrites.save(r));
exports.voidGroupWorkout=onCall(r=>groupWrites.voidLog(r));
exports.saveGroupSteps=onCall(r=>groupWrites.saveSteps(r));
exports.setGroupVisibility=onCall(r=>groupWrites.setConsent(r));
exports.checkJackAward=onCall(r=>groupWrites.checkJack(r));
exports.supportGet=onCall(r=>support.get(r));
exports.supportInbox=onCall(r=>support.inbox(r));
exports.supportPost=onCall(r=>support.post(r));
exports.supportSeen=onCall(r=>support.seen(r));
exports.claimIdentity=onCall(r=>identity.claim(r));
exports.refreshIdentity=onCall(r=>identity.refresh(r));
exports.joinWithIdentity=onCall(r=>identity.join(r));
exports.finalizeAccountDeletion=onCall({timeoutSeconds:300},r=>identity.finalizeDeletion(r));
exports.enrollSolo=onCall(r=>solo.enroll(r));
exports.getSolo=onCall(r=>solo.get(r));
exports.saveSolo=onCall(r=>solo.save(r));
exports.soloBoard=onCall(r=>solo.board(r));
exports.hideSoloRanking=onCall(r=>solo.hide(r));
exports.deleteSoloAccount=onCall({timeoutSeconds:300},r=>solo.remove(r));
exports.retryIdentityDeletions=onSchedule({schedule:'every 60 minutes',timeZone:'Asia/Kolkata',timeoutSeconds:300},()=>identity.retryDeletions());
exports.settleSweep=require('./steps-service')({db,FieldValue,onSchedule,pledges,logger:require('firebase-functions').logger});
