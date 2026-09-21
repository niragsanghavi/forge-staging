import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {memoryFirestore} from './memory-firestore.mjs';
import fs from 'node:fs';
import vm from 'node:vm';
const require=createRequire(import.meta.url),prefix='groups/TEST/seasons/2026-09';
function setup(){
 const h=memoryFirestore([['groups/TEST',{currentSeasonId:'2026-09'}],[prefix,{year:2026,month:9,roster:[{name:'Alex',userId:'person',team:'A'}]}],['authIdentities/owner',{userId:'person'}],['users/person',{authUid:'owner'}],[prefix+'/twists/jack_of_all_trades',{enabled:true}]]);
 class HttpsError extends Error{constructor(code,message){super(message);this.code=code;}}
 const deps={db:h.db,FieldValue:{serverTimestamp:()=>1},HttpsError,now:()=>Date.parse('2026-09-20T06:00:00Z')},identity=require('../functions-identity/identity-service.js')(deps);
 const api=require('../functions-identity/group-write-service.js')({...deps,identity});
 const request={auth:{uid:'owner',token:{firebase:{sign_in_provider:'google.com'}}},data:{groupCode:'TEST',year:2026,month:9,day:20}};
 const log=(id,workouts,extra={})=>h.records.set('logs/'+id,{groupCode:'TEST',year:2026,month:9,day:20,player:'Alex',userId:'person',workouts,...extra});
 return {...h,api,request,log};
}
test('client workout list never authorizes an award',async()=>{const h=setup();h.request.data.workouts=['Gym','Walk','Run','Yoga'];assert.equal((await h.api.checkJack(h.request)).awarded,false);});
test('four persisted types award exactly once under concurrent retries',async()=>{const h=setup();h.log('one',['Gym','Walk','Run','Yoga']);const rs=await Promise.all([h.api.checkJack(h.request),h.api.checkJack(h.request)]);assert.equal(rs.filter(r=>r.awarded).length,1);const awards=[...h.records].filter(([key])=>key.includes('/jackAwards/'));assert.equal(awards.length,1);assert.equal(awards[0][1].week,'2026-W38');assert.equal(awards[0][1].userId,'person');});
test('voided, future, different-owner and previous-week logs do not count',async()=>{for(const extra of [{voided:true},{day:21},{day:13},{userId:'other'}]){const h=setup();h.log('bad',['Gym','Walk','Run','Yoga'],extra);assert.equal((await h.api.checkJack(h.request)).awarded,false);}});
test('legacy award IDs prevent duplicate upgraded awards',async()=>{const h=setup();h.log('one',['Gym','Walk','Run','Yoga']);h.records.set(prefix+'/jackAwards/legacy',{player:'Alex',week:'2026-W38'});assert.equal((await h.api.checkJack(h.request)).already,true);});
test('disabled twists and outsiders cannot earn awards',async()=>{const h=setup();h.log('one',['Gym','Walk','Run','Yoga']);h.records.set(prefix+'/twists/jack_of_all_trades',{enabled:false});assert.equal((await h.api.checkJack(h.request)).awarded,false);h.request.auth.uid='outsider';await assert.rejects(h.api.checkJack(h.request),e=>e.code==='permission-denied');});
test('provider client submits receipt scope, never caller-selected award fields or stale celebration',async()=>{
 const source=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
 const start=source.indexOf('async function checkJackOfAllTrades('),end=source.indexOf('// ── IRON PLEDGE',start);
 for(const current of [true,false]){
  const calls=[],toasts=[],ctx=vm.createContext({FEATURE_GOOGLE_AUTH:true,callFunction:async(name,data)=>{calls.push({name,data});return {awarded:true};},_isSubmissionViewCurrent:()=>current,toast:s=>toasts.push(s),logErr:()=>assert.fail('unexpected client error')});
  vm.runInContext(source.slice(start,end),ctx);
  await ctx.checkJackOfAllTrades(20,['Invented'],{actor:{name:'Alex'},season:{year:2026,month:9},seasonId:'2026-09',groupCode:'TEST',score:{twists:{jack_of_all_trades:{enabled:true}},logs:[]}});
  assert.equal(calls[0].name,'checkJackAward');assert.deepEqual(JSON.parse(JSON.stringify(calls[0].data)),{groupCode:'TEST',year:2026,month:9,day:20});assert.equal(toasts.length,current?1:0);
 }
});
