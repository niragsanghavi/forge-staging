import test from 'node:test';import assert from 'node:assert/strict';import {createRequire} from 'node:module';import {memoryFirestore} from './memory-firestore.mjs';
const require=createRequire(import.meta.url),importer=require('../functions-identity/group-import-service'),device=require('../functions-identity/device-registration-service');
class Failure extends Error{constructor(code,message){super(message);this.code=code;}}
function fixture(){
 let time=Date.parse('2026-09-22T06:00:00Z');
 const m=memoryFirestore([['authIdentities/owner',{userId:'person'}],['users/person',{authUid:'owner',memberships:{FROM:{},NEXT:{},MORE:{}}}],['stats/global',{totalLogs:10}]]);
 for(const code of ['FROM','NEXT','MORE']){m.records.set('groups/'+code,{name:code,currentSeasonId:'2026-09'});m.records.set('groups/'+code+'/seasons/2026-09',{roster:[{userId:'person',name:'Tester',team:code==='NEXT'?'B':'A',role:'Player'}]});}
 const log=(patch={})=>({userId:'person',groupCode:'FROM',year:2026,month:9,day:1,workouts:['Walk','Yoga'],timestamp:{seconds:time/1000},...patch});
 m.records.set('logs/old',log());m.records.set('logs/shared',log({groupCode:'MORE',workouts:['Yoga','Walk']}));
 const identity={actor(r){if(!r.auth)throw new Failure('unauthenticated','Sign in');if(!['google.com','apple.com'].includes(r.auth.token.firebase.sign_in_provider))throw new Failure('permission-denied','Provider required');return {uid:r.auth.uid};}};
 const args={db:m.db,FieldValue:{serverTimestamp:()=>time},HttpsError:Failure,identity,now:()=>time};
 const request=(data={})=>({auth:{uid:'owner',token:{firebase:{sign_in_provider:'google.com'}}},data:{groupCode:'NEXT',...data}});
 return {...m,log,request,service:importer(args),device:device(args),setTime:t=>time=t};
}
test('month import previews historical dates beyond logging window, collapsing shared copies',async()=>{
 const h=fixture();h.records.set('logs/previous',h.log({month:8}));h.records.set('logs/future',h.log({day:23}));h.records.set('logs/foreign',h.log({userId:'other'}));h.records.set('logs/void',h.log({voided:true}));
 const p=await h.service.preview(h.request());assert.equal(p.rows.length,1);assert.equal(p.rows[0].day,1);assert.equal(h.records.get('stats/global').totalLogs,10);
});
test('copies are explicit, use destination roster, and retry/double-tap exactly once',async()=>{
 const h=fixture(),p=await h.service.preview(h.request()),r=h.request({operationId:p.operationId,keys:p.rows.map(x=>x.key)});
 await Promise.all([h.service.apply(r),h.service.apply(r)]);await h.service.apply(r);
 const copies=[...h.records].filter(([k])=>k.startsWith('logs/import_'));assert.equal(copies.length,1);assert.equal(copies[0][1].team,'B');assert.equal(copies[0][1].day,1);assert.equal(h.records.get('stats/global').totalLogs,11);assert.equal(h.records.get('logs/old').team,undefined);
});
test('existing destination copies skip; genuine repeated sessions in one source are preserved',async()=>{
 const h=fixture();h.records.set('logs/second',h.log());h.records.set('logs/target',h.log({groupCode:'NEXT'}));
 const p=await h.service.preview(h.request());assert.equal(p.rows.length,2);assert.equal(p.rows.filter(x=>x.already).length,1);
 const r=await h.service.apply(h.request({operationId:p.operationId,keys:p.rows.map(x=>x.key)}));assert.equal(r.created,1);assert.equal(r.skipped,1);
});
test('removed imports are never resurrected by a fresh review',async()=>{
 const h=fixture(),p=await h.service.preview(h.request());await h.service.apply(h.request({operationId:p.operationId,keys:p.rows.map(x=>x.key)}));
 const copy=[...h.records].find(([k])=>k.startsWith('logs/import_'));copy[1].voided=true;
 const again=await h.service.preview(h.request()),r=await h.service.apply(h.request({operationId:again.operationId,keys:again.rows.map(x=>x.key)}));assert.equal(r.created,0);assert.equal(copy[1].voided,true);
});
test('source changed, review expired, rollover and membership loss fail closed',async()=>{
 for(const mode of ['source','expired','rollover','member']){
 const h=fixture(),p=await h.service.preview(h.request());
 if(mode==='source')h.records.get('logs/old').note='Changed';
 if(mode==='expired')h.setTime(Date.parse('2026-09-22T07:00:00Z'));
 if(mode==='rollover')h.setTime(Date.parse('2026-09-30T19:00:00Z'));
 if(mode==='member')h.records.get('groups/NEXT/seasons/2026-09').roster=[];
 await assert.rejects(h.service.apply(h.request({operationId:p.operationId,keys:p.rows.map(x=>x.key)})));assert.equal(h.records.get('stats/global').totalLogs,10);
 }});
test('demo groups excluded; unreviewed selection and another account rejected',async()=>{
 const h=fixture();h.records.get('groups/FROM').demo=true;h.records.get('groups/MORE').demo=true;assert.equal((await h.service.preview(h.request())).rows.length,0);
 const x=fixture(),p=await x.service.preview(x.request());await assert.rejects(x.service.apply(x.request({operationId:p.operationId,keys:['not-reviewed']})));
 const req=x.request({operationId:p.operationId,keys:p.rows.map(x=>x.key)});req.auth.uid='intruder';await assert.rejects(x.service.apply(req));
 await assert.rejects(x.service.preview({data:{groupCode:'NEXT'}}));
});
test('device registration works without group globals and preserves other device tokens',async()=>{
 const h=fixture(),token='device_token_abcdefghijklmnop';h.records.get('users/person').pushTokens={other:{platform:'ios'}};
 await h.device(h.request({mode:'enable',token,platform:'web'}));assert.equal((await h.device(h.request({mode:'status',token}))).registered,true);
 await h.device(h.request({mode:'disable',token}));assert.equal((await h.device(h.request({mode:'status',token}))).registered,false);assert.ok(h.records.get('users/person').pushTokens.other);
});
test('device writes reject anonymous, missing identity, bad tokens and wrong owner',async()=>{
 const h=fixture();for(const token of ['short','bad.token_abcdefghijklmnop','bad token_abcdefghijklmnop'])await assert.rejects(h.device(h.request({mode:'enable',token,platform:'web'})));
 const req=h.request({mode:'enable',token:'device_token_abcdefghijklmnop',platform:'web'});req.auth.token.firebase.sign_in_provider='anonymous';await assert.rejects(h.device(req));
 req.auth.token.firebase.sign_in_provider='google.com';h.records.get('users/person').authUid='someone-else';await assert.rejects(h.device(req));
});

