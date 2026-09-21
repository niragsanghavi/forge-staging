import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {memoryFirestore} from './memory-firestore.mjs';
const require=createRequire(import.meta.url),prefix='groups/TEST/seasons/2026-09';
function setup(){
 const h=memoryFirestore([['groups/TEST',{currentSeasonId:'2026-09',players:[{name:'Alex'},{name:'Member'}]}],[prefix,{year:2026,month:9,numTeams:2,roster:[{name:'Alex',userId:'person',team:'A',isAdmin:true},{name:'Member',userId:'member',team:'B'}]}],['authIdentities/owner',{userId:'person'}],['users/person',{authUid:'owner',name:'Alex'}],['authIdentities/member',{userId:'member'}],['users/member',{authUid:'member'}],['logs/one',{groupCode:'TEST',year:2026,month:9,day:20,player:'Member',userId:'member',workouts:['Walk']}]]);
 class HttpsError extends Error{constructor(code,message){super(message);this.code=code;}}
 const deps={db:h.db,FieldValue:{serverTimestamp:()=>1},HttpsError},identity=require('../functions-identity/identity-service.js')(deps);
 const api=require('../functions-identity/admin-service.js')({...deps,identity}),group=require('../functions-identity/group-write-service.js')({...deps,identity});
 const request=(data={},uid='owner')=>({auth:{uid,token:{firebase:{sign_in_provider:'google.com'}}},data:{groupCode:'TEST',seasonId:'2026-09',...data}});
 return {...h,api,group,request};
}
test('reporter identity is canonical and duplicate reports cannot inflate the queue',async()=>{
 const h=setup();await Promise.all([h.group.flag(h.request({logId:'one',flaggedBy:'Fake'})),h.group.flag(h.request({logId:'one'}))]);const entries=[...h.records].filter(([k])=>k.startsWith('flags/'));assert.equal(entries.length,1);assert.equal(entries[0][1].flaggedBy,'Alex');await assert.rejects(h.group.flag(h.request({logId:'one'},'outsider')),e=>e.code==='permission-denied');
});
test('reports are private to admins and resolution voids without deleting the log',async()=>{
 const h=setup();await h.group.flag(h.request({logId:'one'}));await assert.rejects(h.api.flags(h.request({},'member')),e=>e.code==='permission-denied');assert.equal((await h.api.flags(h.request())).flags.length,1);
 await h.api.change(h.request({action:'resolveFlag',logId:'one',resolution:'remove'}));assert.equal(h.records.get('logs/one').voided,true);assert.equal((await h.api.flags(h.request())).flags.length,0);
});
test('moderators cannot resolve another group’s log',async()=>{
 const h=setup();h.records.get('logs/one').groupCode='OTHER';await assert.rejects(h.api.change(h.request({action:'resolveFlag',logId:'one',resolution:'remove'})),e=>e.code==='permission-denied');assert.equal(h.records.get('logs/one').voided,undefined);
});
test('renaming preserves identity and updates the canonical account only when it matches',async()=>{
 const h=setup();const r=await h.api.change(h.request({action:'rename',oldName:'Alex',newName:'Alex New'}));assert.equal(r.roster[0].userId,'person');assert.equal(h.records.get('users/person').name,'Alex New');assert.equal(h.records.get('groups/TEST').players[0].name,'Alex New');
});
test('rename cannot attach another owner’s workouts or collide with a member',async()=>{
 for(const name of ['Member','Foreign']){const h=setup();h.records.set('logs/foreign',{groupCode:'TEST',year:2026,month:9,player:'Foreign',userId:'foreign'});await assert.rejects(h.api.change(h.request({action:'rename',oldName:'Alex',newName:name})),e=>e.code==='failed-precondition');assert.equal(h.records.get('users/person').name,'Alex');}
});
test('rebalance changes teams but cannot smuggle admin privileges',async()=>{
 const h=setup();await assert.rejects(h.api.change(h.request({action:'rebalance',changes:[{name:'Member',team:'A',isAdmin:true}]})),e=>e.code==='invalid-argument');await h.api.change(h.request({action:'rebalance',changes:[{name:'Member',team:'A'}]}));assert.equal(h.records.get(prefix).rebalancedAt,1);assert.equal(h.records.get(prefix).roster[1].userId,'member');assert.equal(h.records.get(prefix).roster[1].isAdmin,undefined);
});
test('survey responses are enabled explicitly and use canonical, idempotent ownership',async()=>{
 const h=setup(),data={choice:'both',note:'Test feedback',userId:'forged'};
 await assert.rejects(h.group.survey(h.request(data)),e=>e.code==='failed-precondition');
 await assert.rejects(h.api.change(h.request({action:'survey',enabled:true})),e=>e.code==='permission-denied');
 const admin=h.request({action:'survey',enabled:true});admin.auth.token.forgeAdmin=true;await h.api.change(admin);
 const replies=await Promise.all([h.group.survey(h.request(data)),h.group.survey(h.request(data))]);assert.equal(replies.filter(r=>!r.already).length,1);
 const stored=[...h.records].filter(([k])=>k.startsWith('survey/'));assert.equal(stored.length,1);assert.equal(stored[0][1].userId,'person');assert.equal(stored[0][1].answers.player,'Alex');
 await assert.rejects(h.group.survey(h.request(data,'outsider')),e=>e.code==='permission-denied');await assert.rejects(h.group.survey(h.request({...data,note:'x'.repeat(301)})),e=>e.code==='invalid-argument');
});
test('existing tab counters require membership and cap rapid duplicate requests',async()=>{
 const h=setup();const result=await Promise.all([h.group.trackTab(h.request({tab:'home'})),h.group.trackTab(h.request({tab:'home'}))]);assert.equal(result.filter(r=>r.counted).length,1);assert.equal(h.records.get('analytics/TEST/tabClicks/2026-09').home,1);
 await assert.rejects(h.group.trackTab(h.request({tab:'home'},'outsider')),e=>e.code==='permission-denied');await assert.rejects(h.group.trackTab(h.request({tab:'__proto__'})),e=>e.code==='invalid-argument');
});
