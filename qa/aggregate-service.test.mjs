// npm test: deterministic aggregate/scoring examples, no cloud access.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {memoryFirestore} from './memory-firestore.mjs';
const require=createRequire(import.meta.url);
const {profileSummary,monthlySlice,workoutSummary}=require('../functions-identity/aggregate-service.js');
const {score}=require('../functions-identity/scoring-engine.js');
const now=Date.parse('2026-09-20T06:00:00Z');
const log=(day,extra={})=>({year:2026,month:9,day,groupCode:'TEST',player:'Person',userId:'person',workouts:['Walk'],...extra});
test('recap returns only caller percentile and unions their days across groups',async()=>{
 const h=memoryFirestore([['authIdentities/owner',{userId:'person'}],['users/person',{authUid:'owner'}],['analytics/global/monthly/2026-09',{groups:{A:{days:{Me:[1,2],B:[1],C:[2],D:[3],E:[4]},users:{Me:'person',B:'b',C:'c',D:'d',E:'e'}},B:{days:{Me:[2,3,99]},users:{Me:'person'}}}}]]);
 class HttpsError extends Error{constructor(code,message){super(message);this.code=code;}}
 const identity=require('../functions-identity/identity-service.js')({db:h.db,FieldValue:{},HttpsError});
 const service=require('../functions-identity/aggregate-service.js')({db:h.db,FieldValue:{},HttpsError,identity});
 const request={auth:{uid:'owner',token:{firebase:{sign_in_provider:'google.com'}}},data:{seasonId:'2026-09',userId:'b'}};
 assert.deepEqual(await service.recapPercentile(request),{available:true,percentile:80,population:5,days:3});
 h.records.get('users/person').deletionRequestedAt=1;await assert.rejects(service.recapPercentile(request),e=>e.code==='permission-denied');
 delete h.records.get('users/person').deletionRequestedAt;h.records.get('analytics/global/monthly/2026-09').groups={};assert.deepEqual(await service.recapPercentile(request),{available:false});
});
test('profile streak deduplicates days across groups and repairs backdated runs',()=>{
 const summary=profileSummary([log(20),log(18),log(19),log(19,{groupCode:'OTHER'})],now);
 assert.equal(summary.currentStreak,3);assert.equal(summary.longestStreak,3);assert.equal(summary.monthsLogged,1);assert.equal(summary.seasonsPlayed,2);
});
test('personal workout counts deduplicate broadcasts and labels, excluding void/future days',()=>{
 const logs=[log(19,{submissionId:'same',workouts:['Walk','walk','Yoga']}),log(19,{submissionId:'same',groupCode:'OTHER',workouts:['Walk','Yoga']}),log(20,{workouts:['Gym']}),log(19,{voided:true,workouts:['Run']}),log(21,{workouts:['Run']})];
 const counts=workoutSummary(logs,now);assert.deepEqual(Object.keys(counts).sort(),['gym','walk','yoga']);assert.equal(counts.walk.n,1);assert.equal(counts.yoga.n,1);assert.equal(counts.gym.n,1);
 assert.equal(workoutSummary([log(20,{workouts:['__proto__']})],now).__proto__.n,1);
});
test('maintenance preview is read-only, admin-only and blocks unresolved ownership',async()=>{
 const h=memoryFirestore([['users/person',{authUid:'owner',stats:{badgeCounts:{season_winner:1}}}],['logs/one',log(19,{id:'one'})]]);
 class HttpsError extends Error{constructor(code,message){super(message);this.code=code;}}
 const deps={db:h.db,FieldValue:{serverTimestamp:()=>1},HttpsError,now:()=>now},identity=require('../functions-identity/identity-service.js')(deps),api=require('../functions-identity/aggregate-service.js')({...deps,identity});
 const request={auth:{uid:'owner',token:{firebase:{sign_in_provider:'google.com'},forgeAdmin:true}},data:{mode:'profiles',dryRun:true}};
 const before=JSON.stringify([...h.records]),preview=await api.repair(request);assert.equal(JSON.stringify([...h.records]),before);assert.equal(preview.unresolved,0);
 await assert.rejects(api.repair({...request,auth:{...request.auth,token:{firebase:{sign_in_provider:'google.com'}}}}),e=>e.code==='permission-denied');
 await assert.rejects(api.repair({...request,data:{mode:'profiles',dryRun:false,confirmation:'forged'}}),e=>e.code==='failed-precondition');
 await api.repair({...request,data:{mode:'profiles',dryRun:false,confirmation:preview.confirmation}});assert.equal(h.records.get('users/person').stats.totalWorkouts,1);assert.equal(h.records.get('users/person').stats.badgeCounts.season_winner,1);
 h.records.set('logs/unmapped',log(19,{userId:null}));const next=await api.repair(request);assert.equal(next.unresolved,1);await assert.rejects(api.repair({...request,data:{mode:'profiles',dryRun:false,confirmation:next.confirmation}}),e=>e.code==='failed-precondition');
});
test('voided, demo, future, malformed and impossible dates do not inflate profile statistics',()=>{
 const records=[log(20),log(19,{voided:true}),log(18,{demo:true}),log(21),log(32),log(0),log(2,{month:13}),log(4,{workouts:[]}),log(5,{workouts:{}}),log(6,{workouts:['Walk',null]})];
 const summary=profileSummary(records,now);assert.equal(summary.totalWorkouts,1);assert.equal(summary.currentStreak,1);
});
test('one confirmed broadcast counts once, while separate sessions still count separately',()=>{
 const summary=profileSummary([log(20,{submissionId:'one'}),log(20,{submissionId:'one',groupCode:'OTHER'}),log(20,{submissionId:'two'})],now);
 assert.equal(summary.totalWorkouts,2);assert.equal(summary.currentStreak,1);
});
test('stale streak falls to zero while personal best stays intact',()=>{
 const summary=profileSummary([log(1),log(2),log(3)],now);assert.equal(summary.currentStreak,0);assert.equal(summary.longestStreak,3);
});
test('IST midnight controls profile current streak',()=>{
 const summary=profileSummary([log(19)],Date.parse('2026-09-20T18:31:00Z'));assert.equal(summary.currentStreak,0);
});
test('monthly summary handles hostile object-property labels as ordinary text',()=>{
 const summary=monthlySlice([log(1,{player:'__proto__',workouts:['constructor']})],[{name:'__proto__',userId:'person'}],123);
 assert.deepEqual(summary.days.__proto__,[1]);assert.equal(summary.wo.constructor.n,1);assert.equal(summary.users.__proto__,'person');
});
test('monthly summary does not infer a unique identity from duplicate roster names',()=>{
 const summary=monthlySlice([log(1,{userId:null})],[{name:'Person',userId:'one'},{name:'Person',userId:'two'}],123);
 assert.equal(summary.users.Person,null);
});
test('server scoring day changes invalidate cached end-of-month penalties',()=>{
 const ctx={groupCode:'TEST',asOf:'2026-09-20',season:{year:2026,month:9,days:30,minWorkouts:10,rolesEnabled:false,roster:[{name:'Person',team:'A'}]},logs:[log(1)],twists:{},bonuses:[]};
 const before=score('Person',ctx);ctx.asOf='2026-09-30';const end=score('Person',ctx);
 assert.equal(before.pen,0);assert.equal(end.pen,-45);assert.ok(end.total<before.total);
});
