// Offline authorization boundary tests. Real Firebase emulator tests are an
// additional release gate, not replaced by this transactional in-memory model.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const factory=require('../functions-identity/group-write-service.js');
const identityFactory=require('../functions-identity/identity-service.js');
function harness(){
  let time=Date.parse('2026-09-20T06:00:00Z'),queue=Promise.resolve();
  const records=new Map([
    ['authIdentities/owner',{userId:'person'}],['users/person',{authUid:'owner'}],
    ['groups/TEST',{currentSeasonId:'2026-09'}],
    ['groups/TEST/seasons/2026-09',{year:2026,month:9,roster:[{userId:'person',name:'Correct Name',team:'B',role:'Player'}]}]
  ]);
  const ref=p=>({p,collection:n=>collection(p+'/'+n)});
  const collection=p=>({doc:id=>ref(p+'/'+id)});
  const db={collection,runTransaction:fn=>{
    const operation=queue.then(async()=>{
      const writes=[];let writing=false;
      const result=await fn({get:async r=>{assert.equal(writing,false,'all reads must precede writes');const v=records.get(r.p);return {exists:records.has(r.p),data:()=>structuredClone(v)};},
        set:(r,v)=>{writing=true;writes.push([r.p,v]);},update:(r,v)=>{writing=true;assert.ok(records.has(r.p));writes.push([r.p,{...records.get(r.p),...v}]);}});
      for(const [p,v] of writes)records.set(p,structuredClone(v));return result;
    });queue=operation.catch(()=>{});return operation;
  }};
  class HttpsError extends Error{constructor(code,message){super(message);this.code=code;}}
  const FieldValue={serverTimestamp:()=>time},identity=identityFactory({db,FieldValue,HttpsError,now:()=>time});
  const api=factory({db,FieldValue,HttpsError,identity,now:()=>time});
  const request=(data={},uid='owner',provider='google.com')=>({auth:{uid,token:{firebase:{sign_in_provider:provider},auth_time:time/1000}},data:{year:2026,month:9,day:20,workouts:['Walk'],targets:[{code:'TEST',logId:'request_1'}],...data}});
  return {api,request,records,setTime:t=>{time=Date.parse(t);}};
}
test('group save derives every identity field from the server roster',async()=>{
 const h=harness();await h.api.save(h.request({userId:'victim',player:'Victim',team:'A',role:'Captain',uid:'victim'}));
 const log=h.records.get('logs/request_1');assert.equal(log.userId,'person');assert.equal(log.player,'Correct Name');assert.equal(log.team,'B');assert.equal(log.role,'Player');assert.equal(log.uid,'owner');
});
test('unauthenticated and anonymous callers cannot save',async()=>{
 const h=harness();await assert.rejects(h.api.save({data:{}}),e=>e.code==='unauthenticated');
 await assert.rejects(h.api.save(h.request({},'owner','anonymous')),e=>e.code==='permission-denied');assert.ok(!h.records.has('logs/request_1'));
});
test('unlinked provider identities cannot borrow another profile',async()=>{
 const h=harness();await assert.rejects(h.api.save(h.request({userId:'person'},'outsider')),e=>e.code==='permission-denied');
});
test('stale identity index and deleted or deleting owners fail closed',async()=>{
 for(const user of [{authUid:'different'},{authUid:'owner',deleted:true},{authUid:'owner',deletedAt:1},{authUid:'owner',deletionRequestedAt:1}]){
  const h=harness();h.records.set('users/person',user);await assert.rejects(h.api.save(h.request()),e=>e.code==='permission-denied');
 }
});
test('canonical roster, not profile membership or matching names, authorizes writes',async()=>{
 for(const roster of [[],[{name:'Correct Name',team:'B'}],[{userId:'other',name:'Correct Name',team:'B'}],[{userId:'person',name:'Correct Name',team:'B',departed:true}]]){
  const h=harness();h.records.get('groups/TEST/seasons/2026-09').roster=roster;await assert.rejects(h.api.save(h.request()),e=>e.code==='permission-denied');
 }
});
test('ambiguous or malformed roster is rejected',async()=>{
 const h=harness(),s=h.records.get('groups/TEST/seasons/2026-09');s.roster.push({...s.roster[0]});
 await assert.rejects(h.api.save(h.request()),e=>e.code==='permission-denied');s.roster=null;
 await assert.rejects(h.api.save(h.request()),e=>e.code==='failed-precondition');
});
test('closed or rolled-over seasons cannot accept new workouts',async()=>{
 for(const status of ['closed','archived','deleted']){const h=harness();h.records.get('groups/TEST/seasons/2026-09').status=status;await assert.rejects(h.api.save(h.request()),e=>e.code==='failed-precondition');}
 const h=harness();h.records.get('groups/TEST').currentSeasonId='2026-10';await assert.rejects(h.api.save(h.request()),e=>e.code==='failed-precondition');
});
test('IST logging window excludes future, old and prior-month days',async()=>{
 for(const data of [{day:21},{day:12},{day:0},{day:20.1},{month:8},{year:2025},{day:'20'}]){const h=harness();await assert.rejects(h.api.save(h.request(data)),e=>e.code==='invalid-argument');}
 const h=harness();h.setTime('2026-09-19T20:00:00Z');await h.api.save(h.request({day:20}));assert.ok(h.records.has('logs/request_1'));
});
test('invalid workouts, note and distance never write',async()=>{
 for(const data of [{workouts:[]},{workouts:[null]},{workouts:[' ']},{workouts:Array(21).fill('Walk')},{workouts:['x'.repeat(201)]},{note:'x'.repeat(201)},{km:NaN},{km:Infinity},{km:-1},{km:'2'}]){
  const h=harness();await assert.rejects(h.api.save(h.request(data)),e=>e.code==='invalid-argument');assert.ok(!h.records.has('logs/request_1'));
 }
});
test('duplicate and invalid destinations are refused',async()=>{
 for(const targets of [[],[{code:'../TEST',logId:'one'}],[{code:'TEST',logId:'../one'}],[{code:'TEST',logId:'one'},{code:'TEST',logId:'two'}]]){
 const h=harness();await assert.rejects(h.api.save(h.request({targets})),e=>e.code==='invalid-argument');}
});
test('broadcast authorization failure leaves every destination unwritten',async()=>{
 const h=harness();await assert.rejects(h.api.save(h.request({targets:[{code:'TEST',logId:'one'},{code:'NOPE',logId:'two'}]})),e=>e.code==='not-found');assert.ok(!h.records.has('logs/one'));
});
test('concurrent identical retries create one immutable log',async()=>{
 const h=harness();const results=await Promise.all([h.api.save(h.request()),h.api.save(h.request())]);assert.equal(results.reduce((n,r)=>n+r.created,0),1);assert.equal(h.records.get('logs/request_1').workouts.length,1);
});
test('changed retry or collision cannot overwrite an existing log',async()=>{
 const h=harness();await h.api.save(h.request());await assert.rejects(h.api.save(h.request({workouts:['Yoga']})),e=>e.code==='already-exists');assert.deepEqual(h.records.get('logs/request_1').workouts,['Walk']);
});
test('void cannot target another person even with forged client identity',async()=>{
 const h=harness();await h.api.save(h.request());h.records.get('logs/request_1').userId='victim';await assert.rejects(h.api.voidLog(h.request({logId:'request_1',userId:'victim'})),e=>e.code==='permission-denied');assert.ok(!h.records.get('logs/request_1').voided);
});
test('owner void is idempotent and a voided identifier cannot be resurrected',async()=>{
 const h=harness();await h.api.save(h.request());assert.equal((await h.api.voidLog(h.request({logId:'request_1'}))).already,false);assert.equal((await h.api.voidLog(h.request({logId:'request_1'}))).already,true);
 assert.equal(h.records.get('logs/request_1').voidedBy,'person');await assert.rejects(h.api.save(h.request()),e=>e.code==='already-exists');
});
function stepsHarness(){const h=harness();h.records.get('groups/TEST/seasons/2026-09').stepRounds={enabled:true};h.stepRequest=(data={},uid='owner')=>h.request({groupCode:'TEST',seasonId:'2026-09',round:3,days:{'2026-09-19':12345},source:'healthkit',...data},uid);return h;}
test('visibility changes only the owner row and opt-out immediately removes the public entry',async()=>{
 const h=harness();const s=h.records.get('groups/TEST/seasons/2026-09');s.roster.push({userId:'other',name:'Other',team:'A',globalConsent:true});
 h.records.get('groups/TEST').globalStats={total:50,players:[{userId:'person',name:'Correct Name'},{userId:'other',name:'Other'}]};
 await h.api.setConsent(h.request({groupCode:'TEST',seasonId:'2026-09',visible:false,userId:'other'}));
 const updated=h.records.get('groups/TEST/seasons/2026-09').roster;assert.equal(updated[0].globalConsent,false);assert.equal(updated[1].globalConsent,true);assert.equal(h.records.get('groups/TEST').globalStats.players.length,1);assert.equal(h.records.get('groups/TEST').globalStats.players[0].userId,'other');
});
test('outsiders cannot change visibility and visibility must be boolean',async()=>{
 const h=harness();await assert.rejects(h.api.setConsent(h.request({groupCode:'TEST',seasonId:'2026-09',visible:true},'outsider')),e=>e.code==='permission-denied');await assert.rejects(h.api.setConsent(h.request({groupCode:'TEST',seasonId:'2026-09',visible:'true'})),e=>e.code==='invalid-argument');
});
test('step owner and team are derived rather than copied from submitted fields',async()=>{
 const h=stepsHarness();await h.api.saveSteps(h.stepRequest({userId:'victim',player:'Victim',team:'A',total:999999}));const d=h.records.get('groups/TEST/seasons/2026-09/stepWeeks/2026-09-r3__correct-name');assert.equal(d.userId,'person');assert.equal(d.team,'B');assert.equal(d.player,'Correct Name');assert.equal(d.total,12345);
});
test('unlinked or nonmember step uploader is rejected',async()=>{
 const h=stepsHarness();await assert.rejects(h.api.saveSteps(h.stepRequest({},'outsider')),e=>e.code==='permission-denied');h.records.get('groups/TEST/seasons/2026-09').roster=[];await assert.rejects(h.api.saveSteps(h.stepRequest()),e=>e.code==='permission-denied');
});
test('today, cross-round, cross-month and malformed step readings are rejected',async()=>{
 for(const days of [{'2026-09-20':1},{'2026-09-16':1},{'2026-08-19':1},{'2026-09-19':-1},{'2026-09-19':100001},{'2026-09-19':1.5},{'2026-09-19':'123'},{}]){const h=stepsHarness();await assert.rejects(h.api.saveSteps(h.stepRequest({days})),e=>e.code==='invalid-argument');}
});
test('settled rounds and disabled challenges cannot accept readings',async()=>{
 const h=stepsHarness();h.records.set('groups/TEST/seasons/2026-09/twistWindows/step_week_2026-09-r3',{awarded:[]});await assert.rejects(h.api.saveSteps(h.stepRequest()),e=>e.code==='failed-precondition');h.records.delete('groups/TEST/seasons/2026-09/twistWindows/step_week_2026-09-r3');h.records.get('groups/TEST/seasons/2026-09').stepRounds.enabled=false;await assert.rejects(h.api.saveSteps(h.stepRequest()),e=>e.code==='failed-precondition');
});
test('September final sync closes exactly October 1 at 18:00 IST',async()=>{
 const h=stepsHarness();h.setTime('2026-10-01T12:29:59Z');await h.api.saveSteps(h.stepRequest({round:4,days:{'2026-09-30':10000}}));h.setTime('2026-10-01T12:30:00Z');await assert.rejects(h.api.saveSteps(h.stepRequest({round:4,days:{'2026-09-30':10001}})),e=>e.code==='failed-precondition');assert.equal(h.records.get('groups/TEST/seasons/2026-09/stepWeeks/2026-09-r4__correct-name').total,10000);
});
test('repeated readings overwrite the same day without accumulating duplicates',async()=>{
 const h=stepsHarness();await Promise.all([h.api.saveSteps(h.stepRequest()),h.api.saveSteps(h.stepRequest())]);await h.api.saveSteps(h.stepRequest({days:{'2026-09-18':5000}}));assert.equal(h.records.get('groups/TEST/seasons/2026-09/stepWeeks/2026-09-r3__correct-name').total,17345);
});
