import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {memoryFirestore} from './memory-firestore.mjs';
const require=createRequire(import.meta.url);
function setup(){
 const h=memoryFirestore(),at=Date.parse('2026-09-30T19:00:00Z');
 class HttpsError extends Error{constructor(code,message){super(message);this.code=code;}}
 const deps={db:h.db,FieldValue:{serverTimestamp:()=>at},HttpsError,now:()=>at};
 const identity=require('../functions-identity/identity-service.js')(deps);
 const create=require('../functions-identity/group-create-service.js')({...deps,identity});
 const request=(data={},uid='owner',claims={})=>({auth:{uid,token:{firebase:{sign_in_provider:'google.com'},auth_time:at/1000,...claims}},data:{groupName:'Friends',name:'Alex',code:'ABC123',requestId:'request-0000000001',...data}});
 return {...h,create,request};
}
test('creation uses IST month, server identity, no penalty and no legacy credentials',async()=>{
 const h=setup(),r=await h.create(h.request());
 assert.equal(r.seasonId,'2026-10');const s=h.records.get('groups/ABC123/seasons/2026-10');
 assert.equal(s.days,31);assert.equal(s.minWorkouts,0);assert.equal(s.credentialSchema,2);assert.equal(s.roster[0].userId,r.userId);assert.equal(s.roster[0].isAdmin,true);assert.equal(s.roster[0].pin,undefined);
 assert.equal(h.records.get('users/'+r.userId).authUid,'owner');
});
test('concurrent double taps are idempotent and do not consume creation limit twice',async()=>{
 const h=setup(),results=await Promise.all([h.create(h.request()),h.create(h.request())]);assert.deepEqual(results[0],results[1]);assert.equal(h.records.get('groupCreationLimits/owner').count,1);
});
test('same idempotency key cannot change payload',async()=>{
 const h=setup();await h.create(h.request());await assert.rejects(h.create(h.request({groupName:'Other'})),e=>e.code==='failed-precondition');
});
test('colliding group and alias codes cannot overwrite existing data',async()=>{
 for(const path of ['groups/ABC123','codeAliases/ABC123']){const h=setup();h.records.set(path,{preserve:true});await assert.rejects(h.create(h.request()),e=>e.code==='already-exists');assert.deepEqual(h.records.get(path),{preserve:true});assert.equal(h.records.size,1);}
});
test('anonymous and forged admin requests cannot create groups',async()=>{
 const h=setup();await assert.rejects(h.create(h.request({},'owner',{firebase:{sign_in_provider:'anonymous'}})),e=>e.code==='permission-denied');await assert.rejects(h.create(h.request({admin:true})),e=>e.code==='permission-denied');assert.equal(h.records.size,0);
});
test('daily limits apply on the server across request IDs',async()=>{
 const h=setup();await h.create(h.request());await h.create(h.request({code:'BCD234',requestId:'request-0000000002'}));await assert.rejects(h.create(h.request({code:'CDE345',requestId:'request-0000000003'})),e=>e.code==='resource-exhausted');assert.equal(h.records.has('groups/CDE345'),false);
});
test('existing linked profile is reused, deletion and membership ceiling rejected',async()=>{
 const h=setup();h.records.set('authIdentities/owner',{userId:'existing'});h.records.set('users/existing',{authUid:'owner',memberships:{OLD123:{}}});
 assert.equal((await h.create(h.request())).userId,'existing');assert.ok(h.records.get('users/existing').memberships.OLD123);
 for(const extra of [{deletionRequestedAt:1},{memberships:Object.fromEntries(Array.from({length:7},(_,i)=>['CODE'+i,{}]))}]){const x=setup();x.records.set('authIdentities/owner',{userId:'existing'});x.records.set('users/existing',{authUid:'owner',...extra});await assert.rejects(x.create(x.request()));assert.equal(x.records.has('groups/ABC123'),false);}
});
test('verified superadmin can create empty groups but cannot inject arbitrary settings',async()=>{
 const h=setup();await h.create(h.request({admin:true,settings:{numTeams:3},demo:true},'admin',{forgeAdmin:true}));const s=h.records.get('groups/ABC123/seasons/2026-10');assert.equal(s.numTeams,3);assert.deepEqual(s.roster,[]);assert.equal(s.minWorkouts,0);
 const x=setup();await assert.rejects(x.create(x.request({admin:true,settings:{minWorkouts:8}},'admin',{forgeAdmin:true})),e=>e.code==='invalid-argument');
});
test('malformed and reserved custom codes fail without writes',async()=>{
 for(const code of ['FORGE1','bad/code','ABC','AAAAAAA']){const h=setup();await assert.rejects(h.create(h.request({code})),e=>e.code==='invalid-argument');assert.equal(h.records.size,0);}
});
