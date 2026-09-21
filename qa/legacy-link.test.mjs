import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {createRequire} from 'node:module';
import {memoryFirestore} from './memory-firestore.mjs';
const require=createRequire(import.meta.url),at=Date.parse('2026-09-21T06:00:00Z');
function setup(){
 const pin=String(crypto.randomInt(1000,10000)),h=memoryFirestore([
 ['users/self',{authUid:'owner',name:'Primary',memberships:{HOME:{}},stats:{badgeCounts:{team_winner:1}}}],['authIdentities/owner',{userId:'self',groupCodes:['HOME']}],
 ['users/legacy',{name:'Legacy',pinHash:crypto.createHash('sha256').update(pin).digest('hex'),memberships:{AWAY:{}},stats:{badgeCounts:{season_winner:1}}}],
 ['groups/HOME',{name:'Home',currentSeasonId:'2026-09'}],['groups/AWAY',{name:'Away',currentSeasonId:'2026-09'}],
 ['groups/HOME/seasons/2026-09',{year:2026,month:9,credentialSchema:2,roster:[{name:'Primary',userId:'self',team:'A'}]}],
 ['groups/AWAY/seasons/2026-09',{year:2026,month:9,credentialSchema:2,roster:[{name:'Legacy',userId:'legacy',team:'B'}]}],
 ['logs/old',{userId:'legacy',groupCode:'AWAY',year:2026,month:9,day:19,player:'Legacy',workouts:['Walk']}],
 ['users/legacy/seasons/AWAY_2026-08',{total:100,badges:['season_winner']}]
 ]);
 class HttpsError extends Error{constructor(code,message){super(message);this.code=code;}}
 const deps={db:h.db,FieldValue:{serverTimestamp:()=>at},HttpsError,now:()=>at},identity=require('../functions-identity/identity-service.js')(deps),groupWrites=require('../functions-identity/group-write-service.js')({...deps,identity});
 const api=require('../functions-identity/legacy-link-service.js')({...deps,identity,groupWrites});
 const request=()=>({auth:{uid:'owner',token:{auth_time:at/1000,firebase:{sign_in_provider:'google.com'}}},data:{groupCode:'AWAY',name:'Legacy',pin}});
 return {...h,api,request};
}
test('legacy group link keeps signed-in identity and moves history atomically, exactly once',async()=>{
 const h=setup();const r=await Promise.all([h.api(h.request()),h.api(h.request())]);assert.equal(r.filter(v=>!v.already).length,1);
 assert.equal(h.records.get('logs/old').userId,'self');assert.equal(h.records.get('logs/old').player,'Legacy');assert.equal(h.records.get('groups/AWAY/seasons/2026-09').roster[0].userId,'self');
 assert.equal(h.records.get('users/self/seasons/AWAY_2026-08').total,100);assert.equal(h.records.has('users/legacy/seasons/AWAY_2026-08'),false);assert.equal(h.records.get('users/legacy').pinHash,undefined);
 assert.equal(h.records.get('users/self').authUid,'owner');assert.equal(h.records.get('users/self').stats.totalWorkouts,1);assert.equal(h.records.get('users/self').stats.badgeCounts.season_winner,1);assert.deepEqual(h.records.get('authIdentities/owner').groupCodes.sort(),['AWAY','HOME']);
});
test('legacy link refuses another provider owner and anonymous/stale sessions',async()=>{
 for(const mode of ['owned','anonymous','stale']){
  const h=setup(),r=h.request();if(mode==='owned')h.records.get('users/legacy').authUid='another';if(mode==='anonymous')r.auth.token.firebase.sign_in_provider='anonymous';if(mode==='stale')r.auth.token.auth_time=1;
  const before=JSON.stringify([...h.records]);await assert.rejects(h.api(r));assert.equal(JSON.stringify([...h.records]),before);
 }
});
test('wrong legacy PIN is target-wide rate limited with no identity changes',async()=>{
 const h=setup(),r=h.request();r.data.pin=String((Number(r.data.pin)+1)%10000).padStart(4,'0');
 for(let i=0;i<5;i++)await assert.rejects(h.api(r),e=>e.code==='permission-denied');await assert.rejects(h.api(h.request()),e=>e.code==='resource-exhausted');assert.equal(h.records.get('logs/old').userId,'legacy');
});
test('overlapping membership, archives or unstamped history require review',async()=>{
 for(const mode of ['roster','archive','unstamped']){
  const h=setup();if(mode==='roster')h.records.get('groups/AWAY/seasons/2026-09').roster.push({name:'Other',userId:'self'});if(mode==='archive')h.records.set('users/self/seasons/AWAY_2026-08',{total:40});if(mode==='unstamped')delete h.records.get('logs/old').userId;
  const before=JSON.stringify([...h.records]);await assert.rejects(h.api(h.request()),e=>e.code==='failed-precondition');assert.equal(JSON.stringify([...h.records]),before);
 }
});
test('failed merge commit leaves every profile, roster and log unchanged',async()=>{
 const h=setup(),before=JSON.stringify([...h.records]);h.onCommit(()=>{throw Error('FICTIONAL_COMMIT_FAILURE');});await assert.rejects(h.api(h.request()),/FICTIONAL/);assert.equal(JSON.stringify([...h.records]),before);
});
test('large legacy merge refuses rather than partially moving history',async()=>{
 const h=setup();for(let n=0;n<401;n++)h.records.set('logs/bulk'+n,{...h.records.get('logs/old')});await assert.rejects(h.api(h.request()),e=>e.code==='failed-precondition');assert.equal(h.records.get('logs/old').userId,'legacy');
});
