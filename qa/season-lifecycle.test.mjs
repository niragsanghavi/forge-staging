import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {memoryFirestore} from './memory-firestore.mjs';
const require=createRequire(import.meta.url),prefix='groups/TEST/seasons/2026-09';
function setup(date='2026-09-14T06:00:00Z'){
 let time=Date.parse(date);
 const h=memoryFirestore([['groups/TEST',{name:'Friends',currentSeasonId:'2026-09'}],[prefix,{year:2026,month:9,days:30,credentialSchema:2,numTeams:1,minWorkouts:0,rolesEnabled:false,roster:[{name:'Alex',userId:'person',team:'A'}]}],['authIdentities/owner',{userId:'person'}],['users/person',{authUid:'owner',stats:{}}],[prefix+'/twists/double_or_nothing',{enabled:true}]]);
 class HttpsError extends Error{constructor(code,message){super(message);this.code=code;}}
 const deps={db:h.db,FieldValue:{serverTimestamp:()=>1},HttpsError,now:()=>time};
 const identity=require('../functions-identity/identity-service.js')(deps),groupWrites=require('../functions-identity/group-write-service.js')({...deps,identity});
 const pledges=require('../functions-identity/pledge-service.js')({...deps,groupWrites});
 const rollover=require('../functions-identity/rollover-service.js')({...deps,identity,groupWrites,pledges});
 const request=(data={},uid='owner')=>({auth:{uid,token:{firebase:{sign_in_provider:'google.com'}}},data:{groupCode:'TEST',seasonId:'2026-09',...data}});
 const log=(id,day,extra={})=>h.records.set('logs/'+id,{groupCode:'TEST',year:2026,month:9,day,player:'Alex',userId:'person',workouts:['Walk'],...extra});
 return {...h,pledges,rollover,request,log,time:d=>time=Date.parse(d)};
}
test('ISO week helper preserves old unpadded week IDs and validates year boundaries',()=>{
 const {isoWeek,monday}=require('../functions-identity/season-dates.js');
 assert.equal(isoWeek(new Date('2027-01-04T00:00:00Z')),'2027-W1');assert.equal(monday('2027-W1').toISOString(),'2027-01-04T00:00:00.000Z');assert.equal(monday('2027-W01').toISOString(),'2027-01-04T00:00:00.000Z');assert.equal(monday('2027-W53'),null);
});
test('pledge ownership, exact once and immutable targets',async()=>{
 const h=setup();const rs=await Promise.all([h.pledges.lock(h.request({pledge:2})),h.pledges.lock(h.request({pledge:2}))]);assert.equal(rs.filter(r=>!r.already).length,1);
 await assert.rejects(h.pledges.lock(h.request({pledge:3})),e=>e.code==='already-exists');await assert.rejects(h.pledges.lock(h.request({pledge:2},'other')),e=>e.code==='permission-denied');
});
test('partial-month pledge week and disabled twist cannot be locked',async()=>{
 const h=setup('2026-09-28T06:00:00Z');await assert.rejects(h.pledges.lock(h.request({pledge:2})),e=>e.code==='failed-precondition');
 h.time('2026-09-14T06:00:00Z');h.records.set(prefix+'/twists/double_or_nothing',{enabled:false});await assert.rejects(h.pledges.lock(h.request({pledge:2})),e=>e.code==='failed-precondition');
});
test('pledges settle only after Sunday ends, from unique non-void days',async()=>{
 const h=setup();await h.pledges.lock(h.request({pledge:2}));h.log('a',14);h.log('duplicate',14);h.log('void',15,{voided:true});
 h.time('2026-09-20T18:29:59Z');assert.equal((await h.pledges.settle(h.request())).settled,0);
 h.time('2026-09-20T18:30:00Z');assert.equal((await h.pledges.settle(h.request())).settled,1);assert.equal((await h.pledges.settle(h.request())).settled,0);
 const result=[...h.records].find(([key])=>key.startsWith('bonuses_iron_pledge/'))[1];assert.equal(result.actual,1);assert.equal(result.type,'zero');assert.equal(result.rawPoints,5);
});
test('rollover cannot freeze a current month or bypass membership',async()=>{
 const h=setup();assert.equal((await h.rollover.run('TEST',h.request())).reason,'NOT_YET_DUE');await assert.rejects(h.rollover.run('TEST',h.request({},'other')),e=>e.code==='permission-denied');assert.equal(h.records.get(prefix).snapshotAt,undefined);
});
test('rollover settles pledges before snapshot and advances exactly once',async()=>{
 const h=setup();await h.pledges.lock(h.request({pledge:1}));h.log('one',14);h.time('2026-10-01T01:00:00Z');
 const rs=await Promise.all([h.rollover.run('TEST',h.request()),h.rollover.run('TEST',h.request())]);assert.equal(rs.filter(r=>r.ok).length,1);assert.equal(h.records.get('groups/TEST').currentSeasonId,'2026-10');
 const s=h.records.get(prefix);assert.equal(s.finalStandings[0].total,11); // 5 base + 1 team streak + 5 pledge, canonical scoring unchanged.
 assert.equal(s.status,'archived');assert.equal(s.badgesAwarded.some(b=>b.badges.includes('team_winner')),false);
 const next=h.records.get('groups/TEST/seasons/2026-10');assert.equal(next.days,31);assert.equal(next.minWorkouts,0);assert.equal(next.credentialSchema,2);assert.equal(h.records.get('users/person').stats.badgeCounts.season_winner,1);assert.ok(h.records.has('users/person/seasons/TEST_2026-09'));
});
test('steps seasons roll forward without freezing points before final cutoff',async()=>{
 const h=setup('2026-10-01T01:00:00Z');h.records.get(prefix).stepRounds={enabled:true,bonus:5};h.log('one',20);
 const result=await h.rollover.run('TEST',h.request());assert.equal(result.stepsPending,true);assert.equal(h.records.get(prefix).snapshotAt,undefined);assert.deepEqual(h.records.get('groups/TEST/seasons/2026-10').stepRounds,{enabled:true,bonus:5});assert.equal(h.records.has('users/person/seasons/TEST_2026-09'),false);
});
test('deleting profiles receive no archive or stat resurrection',async()=>{
 const h=setup('2026-10-01T01:00:00Z');h.records.get('users/person').deletionRequestedAt=1;h.log('one',20);await h.rollover.run('TEST');assert.equal(h.records.has('users/person/seasons/TEST_2026-09'),false);assert.deepEqual(h.records.get('users/person').stats,{});
});
test('target-season collision and unsanitized rosters block without writes',async()=>{
 const h=setup('2026-10-01T01:00:00Z');h.records.set('groups/TEST/seasons/2026-10',{preserve:true});assert.equal((await h.rollover.run('TEST')).reason,'TARGET_SEASON_EXISTS');assert.equal(h.records.get(prefix).snapshotAt,undefined);
 const x=setup('2026-10-01T01:00:00Z');delete x.records.get(prefix).credentialSchema;await assert.rejects(x.rollover.run('TEST'),e=>e.code==='failed-precondition');assert.equal(x.records.get(prefix).status,undefined);
});
test('a failed transaction cannot leave a snapshot without the new season',async()=>{
 const h=setup('2026-10-01T01:00:00Z');h.log('one',20);h.onCommit(()=>{throw Error('injected write failure');});await assert.rejects(h.rollover.run('TEST'),/injected/);assert.equal(h.records.get(prefix).snapshotAt,undefined);assert.equal(h.records.get('groups/TEST').currentSeasonId,'2026-09');
});
test('step finalization includes pending pledges even when rollover has not run',async()=>{
 const h=setup();await h.pledges.lock(h.request({pledge:1}));h.log('one',14);
 h.records.get(prefix).stepRounds={enabled:true};
 // Existing immutable results avoid conflating finalization with round scoring.
 for(let n=1;n<=4;n++)h.records.set(prefix+'/twistWindows/step_week_2026-09-r'+n,{week:'2026-09-r'+n,awarded:[],settledBy:'server-sweep'});
 h.time('2026-10-01T12:31:00Z');const original=Date.now;Date.now=()=>Date.parse('2026-10-01T12:31:00Z');
 const errors=[];
 try{
  const run=require('../functions-identity/steps-service.js')({db:h.db,FieldValue:{serverTimestamp:()=>1,increment:n=>n},pledges:h.pledges,onSchedule:(_,fn)=>fn,logger:{error:(...args)=>errors.push(args),info(){}}});
  await run();assert.deepEqual(errors,[]);assert.equal(h.records.get(prefix).finalStandings[0].total,11);assert.equal(h.records.get('groups/TEST').currentSeasonId,'2026-09');
  const before=JSON.stringify([...h.records]);await run();assert.equal(JSON.stringify([...h.records]),before);
 }finally{Date.now=original;}
});
