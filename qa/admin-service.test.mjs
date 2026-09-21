import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {memoryFirestore} from './memory-firestore.mjs';
const require=createRequire(import.meta.url);
function harness(){
 const records=new Map([['groups/TEST',{currentSeasonId:'2026-09'}],['groups/TEST/seasons/2026-09',{year:2026,month:9,numTeams:2,roster:[{userId:'person',name:'Owner',team:'A',role:'Player',isAdmin:true},{userId:'member',name:'Member',team:'B',role:'Player'}]}],['authIdentities/owner',{userId:'person'}],['users/person',{authUid:'owner'}],['authIdentities/member',{userId:'member'}],['users/member',{authUid:'member'}]]);
 const collection=p=>({doc:id=>({p:p+'/'+id,collection:n=>collection(p+'/'+id+'/'+n)})});
 const db={collection,runTransaction:async fn=>{const writes=[];let writing=false;const result=await fn({get:async ref=>{assert.equal(writing,false);return {exists:records.has(ref.p),data:()=>structuredClone(records.get(ref.p))};},update:(ref,data)=>{writing=true;writes.push([ref.p,{...records.get(ref.p),...data}]);}});for(const [p,v]of writes)records.set(p,v);return result;}};
 class HttpsError extends Error{constructor(code,message){super(message);this.code=code;}}
 const FieldValue={delete:()=>null},identity=require('../functions-identity/identity-service.js')({db,FieldValue,HttpsError});
 const api=require('../functions-identity/admin-service.js')({db,FieldValue,HttpsError,identity});
 const request=(data={},uid='owner',claims={})=>({auth:{uid,token:{firebase:{sign_in_provider:'google.com'},...claims}},data:{groupCode:'TEST',seasonId:'2026-09',...data}});
 return {api,records,request};
}
test('admin access is tied to provider and canonical roster, not request flags',async()=>{
 const h=harness();assert.equal((await h.api.access(h.request())).groupAdmin,true);
 await assert.rejects(h.api.access(h.request({isAdmin:true},'member')),e=>e.code==='permission-denied');
 await assert.rejects(h.api.access(h.request({},'owner',{firebase:{sign_in_provider:'anonymous'},forgeAdmin:true})),e=>e.code==='permission-denied');
});
test('an unlinked anonymous-era UID never gains superadmin from its identifier',async()=>{
 const h=harness();assert.equal((await h.api.access({auth:h.request().auth,data:{}})).superadmin,false);
 assert.equal((await h.api.access({auth:h.request({},'verified',{forgeAdmin:true}).auth,data:{}})).superadmin,true);
});
test('deleted, deleting, stale-index and departed group admins are denied',async()=>{
 for(const profile of [{authUid:'other'},{authUid:'owner',deleted:true},{authUid:'owner',deletionRequestedAt:1}]){const h=harness();h.records.set('users/person',profile);await assert.rejects(h.api.access(h.request()),e=>e.code==='permission-denied');}
 const h=harness();h.records.get('groups/TEST/seasons/2026-09').roster[0].departed=true;await assert.rejects(h.api.access(h.request()),e=>e.code==='permission-denied');
});
test('role changes preserve identities and unrelated members',async()=>{
 const h=harness();const result=await h.api.change(h.request({action:'roles',changes:[{name:'Member',team:'A',role:'Captain'}]}));
 assert.equal(result.roster[1].userId,'member');assert.equal(result.roster[1].team,'A');assert.equal(result.roster[0].isAdmin,true);
});
test('role changes cannot inject identity fields, invalid teams, or unsupported roles',async()=>{
 for(const patch of [{userId:'victim'},{team:'Z'},{role:'Superadmin'},{isAdmin:'yes'}]){const h=harness();await assert.rejects(h.api.change(h.request({action:'roles',changes:[{name:'Member',...patch}]})),e=>e.code==='invalid-argument');}
});
test('removing the last group admin is rejected atomically',async()=>{
 const h=harness();await assert.rejects(h.api.change(h.request({action:'roles',changes:[{name:'Owner',isAdmin:false}]})),e=>e.code==='failed-precondition');assert.equal(h.records.get('groups/TEST/seasons/2026-09').roster[0].isAdmin,true);
});
test('closed seasons and changed current-season pointers reject edits',async()=>{
 for(const status of ['closed','archived','deleted']){const h=harness();h.records.get('groups/TEST/seasons/2026-09').status=status;await assert.rejects(h.api.change(h.request({action:'settings',patch:{minWorkouts:0}})),e=>e.code==='failed-precondition');}
});
test('season settings validate finite bounds and prohibit identity/score injection',async()=>{
 for(const patch of [{roster:[]},{globalStats:{}},{minWorkouts:-1},{numTeams:0},{kmTarget:Infinity},{rolesEnabled:'true'},{stepRounds:{enabled:true,bonus:9999}}]){const h=harness();await assert.rejects(h.api.change(h.request({action:'settings',patch})),e=>e.code==='invalid-argument');}
});
test('one-team settings move the entire roster atomically and preserve challenge overrides',async()=>{
 const h=harness();h.records.get('groups/TEST/seasons/2026-09').stepRounds={enabled:false,target:10000};await h.api.change(h.request({action:'settings',patch:{numTeams:1,stepRounds:{enabled:true}}}));
 const season=h.records.get('groups/TEST/seasons/2026-09');assert.ok(season.roster.every(p=>p.team==='A'));assert.equal(season.stepRounds.target,10000);
});
test('group metadata needs a server-issued superadmin claim',async()=>{
 const h=harness();await assert.rejects(h.api.change(h.request({action:'settings',patch:{},groupName:'Renamed'})),e=>e.code==='permission-denied');
 await h.api.change(h.request({action:'settings',patch:{},groupName:'Renamed'},'verified',{forgeAdmin:true}));assert.equal(h.records.get('groups/TEST').name,'Renamed');
});
test('departed namesakes are never changed by an active member role edit',async()=>{
 const h=harness();h.records.get('groups/TEST/seasons/2026-09').roster.push({name:'Member',userId:'former',team:'B',departed:true});
 await h.api.change(h.request({action:'roles',changes:[{name:'Member',team:'A'}]}));
 assert.equal(h.records.get('groups/TEST/seasons/2026-09').roster[2].team,'B');
});
test('prototype property names are rejected as unsupported settings',async()=>{
 for(const key of ['constructor','toString','__proto__']){const h=harness();await assert.rejects(h.api.change(h.request({action:'settings',patch:JSON.parse('{"'+key+'":1}')})),e=>e.code==='invalid-argument');}
});
test('only superadmin may change scoring mode',async()=>{
 const h=harness();await assert.rejects(h.api.change(h.request({action:'settings',patch:{scoringV2:true}})),e=>e.code==='permission-denied');
 await h.api.change(h.request({action:'settings',patch:{scoringV2:true}},'verified',{forgeAdmin:true}));assert.equal(h.records.get('groups/TEST/seasons/2026-09').scoringV2,true);
});
test('reducing teams never strands active players on removed teams',async()=>{
 const h=harness();h.records.get('groups/TEST/seasons/2026-09').roster[1].team='C';
 await assert.rejects(h.api.change(h.request({action:'settings',patch:{numTeams:2}})),e=>e.code==='failed-precondition');
});
test('concurrent manual awards are exactly once and reject non-members',async()=>{
 const base=harness(),h=memoryFirestore([...base.records]);
 class HttpsError extends Error{constructor(code,message){super(message);this.code=code;}}
 const FieldValue={serverTimestamp:()=>1},identity=require('../functions-identity/identity-service.js')({db:h.db,FieldValue,HttpsError});
 const api=require('../functions-identity/admin-service.js')({db:h.db,FieldValue,HttpsError,identity});
 const request=base.request({action:'award30',name:'Member'});
 const result=await Promise.all([api.change(request),api.change(request)]);
 assert.equal(result.filter(r=>!r.already).length,1);assert.equal([...h.records.keys()].filter(k=>k.startsWith('bonuses_30day/')).length,1);
 await assert.rejects(api.change(base.request({action:'award30',name:'Unknown'})),e=>e.code==='invalid-argument');
});
