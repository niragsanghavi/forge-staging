import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {memoryFirestore} from './memory-firestore.mjs';
const require=createRequire(import.meta.url),prefix='groups/TEST/seasons/2026-09';
function setup(when='2026-09-20T06:00:00Z'){
 const h=memoryFirestore([['groups/TEST',{currentSeasonId:'2026-09'}],[prefix,{year:2026,month:9,roster:[{name:'Admin',userId:'person',team:'A',isAdmin:true},{name:'Other',team:'B'}]}],['authIdentities/owner',{userId:'person'}],['users/person',{authUid:'owner'}]]);
 class HttpsError extends Error{constructor(code,message){super(message);this.code=code;}}
 const deps={db:h.db,FieldValue:{serverTimestamp:()=>1},HttpsError,now:()=>Date.parse(when)},identity=require('../functions-identity/identity-service.js')(deps);
 const api=require('../functions-identity/admin-service.js')({...deps,identity});
 const request=(data,uid='owner')=>({auth:{uid,token:{firebase:{sign_in_provider:'google.com'}}},data:{groupCode:'TEST',seasonId:'2026-09',...data}});
 return {...h,change:d=>api.change(request(d)),request,api};
}
test('only a canonical admin can toggle a known twist',async()=>{
 const h=setup();await assert.rejects(h.api.change(h.request({action:'twistToggle',twistId:'double_or_nothing',enabled:true},'outsider')),e=>e.code==='permission-denied');
 await assert.rejects(h.change({action:'twistToggle',twistId:'step_week',enabled:true}),e=>e.code==='invalid-argument');
 await h.change({action:'twistToggle',twistId:'jack_of_all_trades',enabled:true});assert.equal(h.records.get(prefix+'/twists/jack_of_all_trades').enabled,true);
});
test('day-one twists use IST and cannot be disabled after activation',async()=>{
 const h=setup('2026-08-31T19:00:00Z');await h.change({action:'twistToggle',twistId:'freaky_fridays',enabled:true});
 await assert.rejects(h.change({action:'twistToggle',twistId:'freaky_fridays',enabled:false}),e=>e.code==='failed-precondition');
 const late=setup();await assert.rejects(late.change({action:'twistToggle',twistId:'monday_motivation',enabled:true}),e=>e.code==='failed-precondition');
});
test('twist settings cannot inject awards or accept invalid weekdays',async()=>{
 const h=setup();await h.change({action:'twistToggle',twistId:'double_points_day',enabled:true});
 for(const [key,value]of [['day',8],['day',NaN],['awarded',['Other']],['__proto__',{}]])await assert.rejects(h.change({action:'twistConfig',twistId:'double_points_day',key,value}),e=>e.code==='invalid-argument');
 await h.change({action:'twistConfig',twistId:'double_points_day',key:'day',value:'7'});assert.equal(h.records.get(prefix+'/twists/double_points_day').day,7);
});
test('Sunday windows are immutable and concurrent requests create one result',async()=>{
 const h=setup();const d={action:'twistWindow',twistId:'boss_week'};
 const rs=await Promise.all([h.change(d),h.change(d)]);assert.equal(rs.filter(r=>!r.already).length,1);assert.equal(rs[0].window.week,'2026-W39');assert.equal(rs[0].window.monDate,21);
});
test('window boundaries clamp to the season and reject non-Sunday activation',async()=>{
 const h=setup('2026-09-27T06:00:00Z');assert.equal((await h.change({action:'twistWindow',twistId:'boss_week'})).window.sunDate,30);
 const mon=setup('2026-09-21T06:00:00Z');await assert.rejects(mon.change({action:'twistWindow',twistId:'boss_week'}),e=>e.code==='failed-precondition');
});
test('underdogs use unique valid non-void days from server data, not caller selections',async()=>{
 const h=setup();for(const [id,data]of [['a',{player:'Admin',day:1}],['b',{player:'Admin',day:1}],['c',{player:'Other',day:2,voided:true}],['d',{player:'Other',day:30}]])h.records.set('logs/'+id,{groupCode:'TEST',year:2026,month:9,...data});
 const r=await h.change({action:'twistWindow',twistId:'underdog_week',frozenPlayers:['Admin']});assert.deepEqual(r.window.frozenPlayers,['Other']);
});
test('out-of-calendar season cannot be edited even when current pointer is stale',async()=>{
 const h=setup('2026-10-01T06:00:00Z');await assert.rejects(h.change({action:'twistToggle',twistId:'jack_of_all_trades',enabled:true}),e=>e.code==='failed-precondition');
});
