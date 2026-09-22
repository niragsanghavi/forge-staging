// Synthetic transactional coverage; no production or staging records touched.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {memoryFirestore} from './memory-firestore.mjs';
const require=createRequire(import.meta.url),factory=require('../functions-identity/solo-service.js'),identityFactory=require('../functions-identity/identity-service.js');
function setup(){
 const time=Date.parse('2026-09-22T06:00:00Z'),h=memoryFirestore([
 ['authIdentities/owner',{userId:'person'}],
 ['users/person',{authUid:'owner',soloEnabled:true,soloDisplayName:'Same Name',soloPublicRanking:false,soloMonths:['2026-08','2026-09'],memberships:{}}],
 ...[[8,1],[9,20],[9,21]].map(([month,day])=>['users/person/soloLogs/2026-'+String(month).padStart(2,'0')+'-'+String(day).padStart(2,'0'),{year:2026,month,day,seasonId:'2026-'+String(month).padStart(2,'0'),workouts:['Walk']}])
 ]);
 // The shared double only orders document names. Board tests need a
 // descending score query as Firestore would return it.
 const original=h.db.collection;
 h.db.collection=name=>name!=='soloBoards'?original(name):({doc:sid=>({collection:()=>({doc:id=>original(name).doc(sid).collection('entries').doc(id),orderBy:(field,direction)=>{
 assert.equal(field,'total');assert.equal(direction,'desc');return {limit:limit=>({get:async()=>({docs:[...h.records].filter(([k])=>k.startsWith('soloBoards/'+sid+'/entries/')).sort((a,b)=>b[1].total-a[1].total).slice(0,limit).map(([k,v])=>({id:k.split('/').at(-1),data:()=>structuredClone(v)}))})})};}
 })})});
 class HttpsError extends Error{constructor(code,message){super(message);this.code=code;}}
 const FieldValue={serverTimestamp:()=>time,arrayUnion:value=>[value]};
 const identity=identityFactory({db:h.db,FieldValue,HttpsError,now:()=>time}),api=factory({db:h.db,FieldValue,HttpsError,identity,now:()=>time});
 const request=(data={},uid='owner',provider='google.com')=>({auth:{uid,token:{firebase:{sign_in_provider:provider},auth_time:time/1000}},data});
 return {...h,api,request};
}
test('getSolo distinguishes a new sign-in from an existing unenrolled profile',async()=>{
 const h=setup();assert.deepEqual(await h.api.get(h.request({},'new-person')),{enrolled:false,hasProfile:false});
 h.records.get('users/person').soloEnabled=false;
 assert.deepEqual(await h.api.get(h.request()),{enrolled:false,hasProfile:true,hasGroups:false,name:''});
});
test('history inventory is owner-scoped, unique and sorted',async()=>{
 const h=setup();h.records.get('users/person').soloMonths=['2026-09','bad','2026-08','2026-09'];
 const r=await h.api.get(h.request());assert.deepEqual(r.months,['2026-08','2026-09']);assert.equal(r.score.total,11);assert.equal(r.logs.length,2);
});
test('publishing recomputes every recorded month rather than accepting client totals',async()=>{
 const h=setup();await h.api.visibility(h.request({publicRanking:true,total:9999,userId:'victim'}));
 assert.equal(h.records.get('soloBoards/2026-08/entries/person').total,5);
 assert.equal(h.records.get('soloBoards/2026-09/entries/person').total,11);
 assert.equal(h.records.get('users/person').soloPublicRanking,true);assert.ok(!h.records.has('soloBoards/2026-09/entries/victim'));
});
test('opting out removes all recorded-month public entries and leaves workouts intact',async()=>{
 const h=setup();await h.api.visibility(h.request({publicRanking:true}));const logs=[...h.records].filter(([k])=>k.includes('/soloLogs/'));
 await h.api.visibility(h.request({publicRanking:false}));
 assert.ok(![...h.records.keys()].some(k=>k.startsWith('soloBoards/')));assert.deepEqual([...h.records].filter(([k])=>k.includes('/soloLogs/')),logs);
});
test('public visibility retries are idempotent',async()=>{
 const h=setup();await Promise.all([h.api.visibility(h.request({publicRanking:true})),h.api.visibility(h.request({publicRanking:true}))]);
 assert.equal([...h.records.keys()].filter(k=>k.startsWith('soloBoards/')).length,2);
});
test('private/public same-name leaderboard users are matched by ID, never by name',async()=>{
 const h=setup();await h.api.visibility(h.request({publicRanking:true}));
 h.records.set('soloBoards/2026-09/entries/another',{name:'Same Name',total:11,days:2});
 const board=await h.api.board(h.request());assert.equal(board.entries.filter(e=>e.isYou).length,1);
 assert.deepEqual(board.entries.map(e=>e.rank),[1,1]);assert.ok(board.entries.every(e=>!('userId' in e)));
});
test('empty months never create a zero-effort public leaderboard entry',async()=>{
 const h=setup();h.records.get('users/person').soloMonths.push('2026-07');await h.api.visibility(h.request({publicRanking:true}));
 assert.ok(!h.records.has('soloBoards/2026-07/entries/person'));
});
test('unauthenticated and anonymous callers cannot access solo visibility',async()=>{
 const h=setup();await assert.rejects(h.api.visibility({data:{publicRanking:true}}),e=>e.code==='unauthenticated');
 await assert.rejects(h.api.visibility(h.request({publicRanking:true},'owner','anonymous')),e=>e.code==='permission-denied');
});
test('unlinked caller and non-boolean visibility cannot publish',async()=>{
 const h=setup();await assert.rejects(h.api.visibility(h.request({publicRanking:true},'stranger')),e=>e.code==='failed-precondition');
 for(const value of [undefined,1,'true',null])await assert.rejects(h.api.visibility(h.request({publicRanking:value})),e=>e.code==='invalid-argument');
});
test('deleted, deleting and mismatched-owner profiles cannot be published',async()=>{
 for(const change of [{deleted:true},{deletionRequestedAt:1},{authUid:'other'}]){
 const h=setup();Object.assign(h.records.get('users/person'),change);
 await assert.rejects(h.api.visibility(h.request({publicRanking:true})),e=>e.code==='permission-denied');
 assert.ok(![...h.records.keys()].some(k=>k.startsWith('soloBoards/')));}
});
test('partial database failure cannot flip consent or leak partial history',async()=>{
 const h=setup();h.onCommit(()=>{throw Error('injected failure');});
 await assert.rejects(h.api.visibility(h.request({publicRanking:true})),/injected failure/);
 assert.equal(h.records.get('users/person').soloPublicRanking,false);assert.ok(![...h.records.keys()].some(k=>k.startsWith('soloBoards/')));
});
test('save rejects future and previous-month days without writes',async()=>{
 for(const data of [{day:23},{day:0},{year:2026,month:8,day:1}]){
 const h=setup(),before=structuredClone([...h.records]);await assert.rejects(h.api.save(h.request({...data,workouts:['Walk']})),e=>e.code==='invalid-argument');assert.deepEqual([...h.records],before);}
});
test('same-day workouts are one scoring day and an identical save cannot inflate score',async()=>{
 const h=setup(),request=h.request({year:2026,month:9,day:22,workouts:['Walk','Yoga','Walk']});
 const a=await h.api.save(request),b=await h.api.save(request);assert.equal(a.score.total,18);assert.equal(b.score.total,18);
 assert.deepEqual(h.records.get('users/person/soloLogs/2026-09-22').workouts,['Walk','Yoga']);
});
