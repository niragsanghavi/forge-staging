import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {memoryFirestore} from './memory-firestore.mjs';
const factory=createRequire(import.meta.url)('../functions-identity/identity-service.js');
function harness(){
 const h=memoryFirestore([['users/person',{authUid:'owner',name:'Fictional',memberships:{},privateUnknown:'remove'}],['authIdentities/owner',{userId:'person'}]]);
 let authDeletes=0,clock=Date.parse('2026-09-20T06:00:00Z');
 class HttpsError extends Error{constructor(code,message){super(message);this.code=code;}}
 const api=factory({db:h.db,FieldValue:{serverTimestamp:()=>clock},HttpsError,now:()=>clock,deleteAuthUser:async()=>{authDeletes++;}});
 const request=(uid='owner',provider='google.com')=>({auth:{uid,token:{auth_time:clock/1000,firebase:{sign_in_provider:provider}}},data:{userId:'person'}});
 return {...h,api,request,get authDeletes(){return authDeletes;},advance:ms=>clock+=ms};
}
test('deletion rejects another owner, anonymous sessions, stale and future authentication',async()=>{
 const h=harness();for(const r of [h.request('other'),h.request('owner','anonymous'),{...h.request(),auth:{...h.request().auth,token:{...h.request().auth.token,auth_time:1}}},{...h.request(),auth:{...h.request().auth,token:{...h.request().auth.token,auth_time:9999999999}}}])await assert.rejects(h.api.finalizeDeletion(r));
 assert.equal(h.authDeletes,0);assert.equal(h.records.has('identityDeletionJobs/owner'),false);
});
test('server stamps request and scrubs historical logs without requiring client-side deletion',async()=>{
 const h=harness();h.records.set('logs/old',{userId:'person',player:'Fictional',note:'private',workouts:['Walk']});
 const result=await h.api.finalizeDeletion(h.request());assert.equal(result.complete,true);assert.equal(h.authDeletes,1);assert.equal(h.records.get('logs/old').voided,true);assert.equal(h.records.get('logs/old').note,undefined);assert.equal(h.records.get('users/person').privateUnknown,undefined);assert.equal(h.records.get('identityDeletionJobs/owner').state,'complete');assert.equal(h.records.has('authIdentities/owner'),false);
});
test('failed final database commit after Auth deletion resumes without user login',async()=>{
 const h=harness();let fail=true;
 h.onCommit(writes=>{if(fail&&writes.some(([kind,path,v])=>kind==='set'&&path==='identityDeletionJobs/owner'&&v.state==='complete'))throw Error('FICTIONAL_OFFLINE');});
 await assert.rejects(h.api.finalizeDeletion(h.request()),/FICTIONAL_OFFLINE/);assert.equal(h.authDeletes,1);assert.equal(h.records.get('identityDeletionJobs/owner').state,'pending');
 fail=false;assert.equal((await h.api.retryDeletions()).completed,1);assert.equal(h.records.get('users/person').deleted,true);
});
test('active lease does not start a duplicate cleanup or claim completion',async()=>{
 const h=harness();h.records.set('identityDeletionJobs/owner',{userId:'person',state:'pending',leaseUntil:Date.parse('2026-09-20T06:05:00Z'),departedLabel:'Departed abcdef123456'});
 const result=await h.api.finalizeDeletion(h.request());assert.equal(result.pending,true);assert.equal(result.complete,false);assert.equal(h.authDeletes,0);
 h.advance(360000);assert.equal((await h.api.retryDeletions()).completed,1);
});
test('more than ten groups yields a durable cursor and completes on scheduled retry',async()=>{
 const h=harness();for(let i=0;i<11;i++)h.records.set('groups/G'+String(i).padStart(3,'0'),{currentSeasonId:'2026-09'});
 const result=await h.api.finalizeDeletion(h.request());assert.equal(result.pending,true);assert.equal(h.authDeletes,0);assert.equal(h.records.get('identityDeletionJobs/owner').groupCursor,'G009');
 assert.equal((await h.api.retryDeletions()).completed,1);assert.equal(h.authDeletes,1);
});
test('ambiguous legacy ownership blocks Auth deletion and survives roster anonymisation on retry',async()=>{
 const h=harness();h.records.set('groups/TEST',{currentSeasonId:'2026-09'});h.records.set('groups/TEST/seasons/2026-09',{roster:[{userId:'person',name:'Fictional',team:'A'}]});h.records.set('flags/legacy',{groupCode:'TEST',player:'Fictional'});
 await assert.rejects(h.api.finalizeDeletion(h.request()),/DELETION_LEGACY_OWNERSHIP_REQUIRED/);
 await assert.rejects(h.api.finalizeDeletion(h.request()),/DELETION_LEGACY_OWNERSHIP_REQUIRED/);assert.equal(h.authDeletes,0);assert.equal(h.records.has('flags/legacy'),true);
 // A verified migration stamps ownership; retries can then safely finish.
 h.records.get('flags/legacy').userId='person';assert.equal((await h.api.finalizeDeletion(h.request())).complete,true);
});
