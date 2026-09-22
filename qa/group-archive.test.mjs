// node --test qa/group-archive.test.mjs — fictional data; no external writes.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {memoryFirestore} from './memory-firestore.mjs';
const require=createRequire(import.meta.url);
function fixture(){
 const h=memoryFirestore([['groups/TEST',{name:'Fixture group',currentSeasonId:'2026-09',players:[{name:'Athlete'}]}],['groups/TEST/seasons/2026-09',{roster:[{userId:'member',name:'Athlete'}]}],['logs/workout',{groupCode:'TEST',userId:'member',day:1}],['users/member',{memberships:{TEST:{groupName:'Fixture group'}}}]]);
 class HttpsError extends Error{constructor(code,message){super(message);this.code=code;}}
 const FieldValue={serverTimestamp:()=>1};
 const identity=require('../functions-identity/identity-service.js')({db:h.db,FieldValue,HttpsError,now:()=>1000000});
 const api=require('../functions-identity/group-archive-service.js')({db:h.db,FieldValue,HttpsError,identity});
 const request=(data={},token={})=>({auth:{uid:'admin',token:{forgeAdmin:true,auth_time:1000,firebase:{sign_in_provider:'google.com'},...token}},data:{groupCode:'TEST',...data}});
 return {...h,api,request};
}
test('archive and restore preserve every workout, season, member and score field',async()=>{
 const h=fixture(),before=[...h.records].filter(([key])=>!key.startsWith('groups/TEST')||key.includes('/seasons/'));
 let preview=await h.api.preview(h.request());assert.equal(preview.workoutRecords,1);assert.equal(preview.members,1);
 await h.api.setArchived(h.request({archived:true,confirmCode:'TEST',revision:preview.revision}));
 assert.equal(h.records.get('groups/TEST').currentSeasonId,null);assert.equal(h.records.get('groups/TEST').archived,true);
 assert.deepEqual(before.map(([key])=>[key,h.records.get(key)]),before);
 preview=await h.api.preview(h.request());await h.api.setArchived(h.request({archived:false,confirmCode:'TEST',revision:preview.revision}));
 assert.equal(h.records.get('groups/TEST').currentSeasonId,'2026-09');assert.equal(h.records.get('groups/TEST').archived,false);
 assert.equal([...h.records.keys()].filter(key=>key.startsWith('groupArchiveAudit/')).length,2);
});
test('anonymous, ordinary members and self-declared admins cannot preview or archive',async()=>{
 for(const token of [{forgeAdmin:false},{firebase:{sign_in_provider:'anonymous'}}]){
  const h=fixture();for(const method of ['preview','setArchived'])await assert.rejects(h.api[method](h.request({forgeAdmin:true},token)),e=>e.code==='permission-denied');
  assert.equal(h.records.get('groups/TEST').archived,undefined);
 }
 const h=fixture();await assert.rejects(h.api.preview({data:{groupCode:'TEST'}}),e=>e.code==='unauthenticated');
});
test('mutations require fresh sign-in and exact code, and reject stale previews',async()=>{
 const h=fixture(),p=await h.api.preview(h.request()),d={archived:true,confirmCode:'TEST',revision:p.revision};
 await assert.rejects(h.api.setArchived(h.request(d,{auth_time:1})),e=>e.code==='unauthenticated');
 await assert.rejects(h.api.setArchived(h.request({...d,confirmCode:'OTHER'})),e=>e.code==='invalid-argument');
 h.records.get('groups/TEST').currentSeasonId='2026-10';
 await assert.rejects(h.api.setArchived(h.request(d)),e=>e.code==='failed-precondition');
 assert.equal([...h.records.keys()].some(k=>k.startsWith('groupArchiveAudit/')),false);
});
test('double submission cannot duplicate audit or mutate twice',async()=>{
 const h=fixture(),p=await h.api.preview(h.request()),request=h.request({archived:true,confirmCode:'TEST',revision:p.revision});
 const results=await Promise.allSettled([h.api.setArchived(request),h.api.setArchived(request)]);
 assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(h.records.get('groups/TEST').archiveRevision,1);
 const current=await h.api.preview(h.request());assert.equal((await h.api.setArchived(h.request({archived:true,confirmCode:'TEST',revision:current.revision}))).already,true);
});
test('no-season spam groups are recoverable too; missing saved seasons fail closed',async()=>{
 const h=fixture();h.records.get('groups/TEST').currentSeasonId=null;
 let p=await h.api.preview(h.request());await h.api.setArchived(h.request({archived:true,confirmCode:'TEST',revision:p.revision}));
 p=await h.api.preview(h.request());await h.api.setArchived(h.request({archived:false,confirmCode:'TEST',revision:p.revision}));assert.equal(h.records.get('groups/TEST').currentSeasonId,null);
 h.records.set('groups/TEST',{archived:true,archivedSeasonId:'2020-01'});p=await h.api.preview(h.request());
 await assert.rejects(h.api.setArchived(h.request({archived:false,confirmCode:'TEST',revision:p.revision})),e=>e.code==='failed-precondition');
});
