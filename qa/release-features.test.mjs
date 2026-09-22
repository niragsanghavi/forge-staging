import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {memoryFirestore} from './memory-firestore.mjs';
const require=createRequire(import.meta.url),removal=require('../functions-identity/workout-removal-service'),announcements=require('../functions-identity/announcement-service');
class Failure extends Error{constructor(code,message){super(message);this.code=code;}}
function fixture(){
 let time=Date.parse('2026-09-22T06:00:00Z');
 const m=memoryFirestore([['authIdentities/owner',{userId:'person'}],['users/person',{authUid:'owner'}],['stats/global',{totalLogs:10}],['analytics/global/daily/2026-09-22',{byGroup:{GRPA:4,GRPB:6}}]]);
 for(const code of ['GRPA','GRPB']){m.records.set('groups/'+code,{name:code,currentSeasonId:'2026-09'});m.records.set('groups/'+code+'/seasons/2026-09',{roster:[{userId:'person',name:'Tester'}]});}
 const log=(code,patch={})=>({userId:'person',groupCode:code,year:2026,month:9,day:22,workouts:['Walk','Yoga'],timestamp:{seconds:time/1000},...patch});
 m.records.set('logs/a',log('GRPA'));m.records.set('logs/b',log('GRPB',{workouts:['Yoga','Walk']}));
 const identity={actor(r){if(!r.auth)throw new Failure('unauthenticated','Sign in');if(!['google.com','apple.com'].includes(r.auth.token.firebase.sign_in_provider))throw new Failure('permission-denied','Provider required');return {uid:r.auth.uid};}};
 const args={db:m.db,FieldValue:{serverTimestamp:()=>time},HttpsError:Failure,identity,now:()=>time};
 const request=(data={},admin=false)=>({auth:{uid:'owner',token:{forgeAdmin:admin,firebase:{sign_in_provider:'google.com'}}},data});
 return {...m,request,log,remove:removal(args),ann:announcements(args),setTime:t=>time=t};
}
test('legacy identity/date/workout-set preview includes duplicates explicitly; no writes to logs',async()=>{
 const h=fixture();h.records.set('logs/c',h.log('GRPB',{note:'Second session'}));h.records.set('logs/d',h.log('GRPB',{day:21}));h.records.set('logs/e',h.log('GRPB',{userId:'other'}));
 const p=await h.remove.preview(h.request({logId:'a'}));assert.equal(p.mode,'inferred');assert.deepEqual(p.rows.map(x=>x.logId),['a','b','c']);assert.equal(p.rows[2].note,'Second session');
 assert.equal(h.records.get('stats/global').totalLogs,10);assert.equal(h.records.get('logs/a').voided,undefined);
});
test('submission matching reuses submissionId and excludes unrelated same-day logs',async()=>{
 const h=fixture();for(const id of ['a','b'])h.records.get('logs/'+id).submissionId='shared';h.records.set('logs/c',h.log('GRPB'));
 const p=await h.remove.preview(h.request({logId:'a'}));assert.equal(p.mode,'submission');assert.equal(p.rows.length,2);
});
test('explicit subset, double taps and retries tombstone and decrement exactly once',async()=>{
 const h=fixture(),p=await h.remove.preview(h.request({logId:'a'})),r=h.request({operationId:p.operationId,logIds:['a','b']});
 await Promise.all([h.remove.apply(r),h.remove.apply(r)]);await h.remove.apply(r);
 assert.equal(h.records.get('stats/global').totalLogs,8);assert.equal(h.records.get('analytics/global/daily/2026-09-22').byGroup.GRPA,3);
 for(const id of ['a','b'])assert.equal(h.records.get('logs/'+id).voided,true);
 assert.equal(h.records.get('logs/a').voidedBy,'person');
});
test('demo is isolated; changed group fails independently and retry preserves successful counters',async()=>{
 const h=fixture();h.records.get('groups/GRPA').demo=true;const p=await h.remove.preview(h.request({logId:'a'}));h.records.get('groups/GRPB').currentSeasonId='2026-10';
 const r=h.request({operationId:p.operationId,logIds:['a','b']}),first=await h.remove.apply(r);assert.equal(first.ok,false);assert.equal(first.results[0].ok,true);assert.equal(first.results[1].ok,false);
 assert.equal(h.records.get('stats/global').totalLogs,10);assert.equal(h.records.get('logs/b').voided,undefined);
 h.records.get('groups/GRPB').currentSeasonId='2026-09';assert.equal((await h.remove.apply(r)).ok,true);assert.equal(h.records.get('stats/global').totalLogs,9);
});
test('changed content, changed owner, unreviewed ID, expired preview and admin override are rejected',async()=>{
 for(const scenario of ['content','owner','unreviewed','expired','admin']){
  const h=fixture(),p=await h.remove.preview(h.request({logId:'a'}));
  if(scenario==='content')h.records.get('logs/a').note='Changed';
  if(scenario==='owner')h.records.get('users/person').authUid='elsewhere';
  if(scenario==='expired')h.setTime(Date.parse('2026-09-22T07:00:00Z'));
  if(scenario==='admin')h.records.get('logs/a').userId='someone-else';
  const r=h.request({operationId:p.operationId,logIds:scenario==='unreviewed'?['not-reviewed']:['a']},true);
  if(scenario==='unreviewed')await assert.rejects(h.remove.apply(r));
  else assert.equal((await h.remove.apply(r)).ok,false);
  assert.equal(h.records.get('logs/a').voided,undefined);
 }
});
test('another account cannot preview or execute and anonymous callers are denied',async()=>{
 const h=fixture(),p=await h.remove.preview(h.request({logId:'a'}));
 const r=h.request({operationId:p.operationId,logIds:['a']});r.auth.uid='intruder';await assert.rejects(h.remove.apply(r),e=>e.code==='permission-denied');
 await assert.rejects(h.remove.preview({data:{logId:'a'}}),e=>e.code==='unauthenticated');
 const anon=h.request({logId:'a'});anon.auth.token.firebase.sign_in_provider='anonymous';await assert.rejects(h.remove.preview(anon));
});
const draft={title:'A new week',message:'Your next small win.',action:'store',webStore:'none',days:7};
test('announcement public read is empty until authorized preview+publish; repeats retain id',async()=>{
 const h=fixture();assert.equal((await h.ann.get()).announcement,null);
 await assert.rejects(h.ann.preview(h.request({draft})),e=>e.code==='permission-denied');
 const p=await h.ann.preview(h.request({draft},true));assert.equal((await h.ann.get()).announcement,null);
 const r=h.request({reviewId:p.reviewId},true),one=await h.ann.publish(r),two=await h.ann.publish(r);assert.equal(one.id,two.id);assert.equal(two.already,true);
 assert.deepEqual(Object.keys((await h.ann.get()).announcement).sort(),['action','expiresAt','id','message','title','webStore']);
});
test('unpublish is idempotent; old review cannot resurrect; new publishing has a new dismissal identity',async()=>{
 const h=fixture(),p=await h.ann.preview(h.request({draft},true));await h.ann.publish(h.request({reviewId:p.reviewId},true));
 await h.ann.unpublish(h.request({id:p.reviewId},true));await h.ann.unpublish(h.request({id:p.reviewId},true));await h.ann.publish(h.request({reviewId:p.reviewId},true));
 assert.equal((await h.ann.get()).announcement,null);
 const next=await h.ann.preview(h.request({draft},true));await h.ann.publish(h.request({reviewId:next.reviewId},true));assert.notEqual(p.reviewId,next.reviewId);
 await assert.rejects(h.ann.unpublish(h.request({id:p.reviewId},true)),e=>e.code==='failed-precondition');
});
test('stale parallel preview cannot overwrite; expired content hides; malformed and unauthorized writes fail',async()=>{
 const h=fixture(),p=await h.ann.preview(h.request({draft},true)),q=await h.ann.preview(h.request({draft},true));
 await h.ann.publish(h.request({reviewId:p.reviewId},true));await assert.rejects(h.ann.publish(h.request({reviewId:q.reviewId},true)),e=>e.code==='failed-precondition');
 await assert.rejects(h.ann.unpublish(h.request({id:p.reviewId})),e=>e.code==='permission-denied');
 await assert.rejects(h.ann.preview(h.request({draft:{...draft,webStore:'javascript:alert(1)'}},true)),e=>e.code==='invalid-argument');
 h.setTime(Date.parse('2026-10-10'));assert.equal((await h.ann.get()).announcement,null);
});
