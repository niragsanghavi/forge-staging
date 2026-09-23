// Apps already in people's hands roll a group into the next month without the
// credentialSchema marker, copying the migrated roster. Server rollover and
// legacy linking must keep working after such a month, and still refuse any
// roster that carries a credential or has no migrated month behind it.
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {createRequire} from 'node:module';
import {memoryFirestore} from './memory-firestore.mjs';
const require=createRequire(import.meta.url);
const {seasonMigrated,rosterIsClean,previousSid}=require('../functions-identity/migration-state.js');
class HttpsError extends Error{constructor(code,message){super(message);this.code=code;}}
const season=(month,extra={})=>({year:2026,month,days:30,numTeams:1,minWorkouts:0,rolesEnabled:false,roster:[{name:'Alex',userId:'person',team:'A',pinSet:true}],...extra});

test('helpers: month arithmetic and what counts as a clean roster',()=>{
 assert.equal(previousSid('2026-10'),'2026-09');assert.equal(previousSid('2027-01'),'2026-12');
 assert.equal(rosterIsClean([{name:'A',pinSet:true},{name:'B',pin:null},{name:'C',pin:''},null]),true);
 assert.equal(rosterIsClean([{name:'A',pin:'1234'}]),false);
 assert.equal(rosterIsClean([{name:'A',pinHash:'ab'.repeat(32)}]),false);
 assert.equal(rosterIsClean(undefined),false);
});

function rolloverSetup(seasons,date){
 const records=[['groups/TEST',{name:'Friends',currentSeasonId:Object.keys(seasons).sort().at(-1)}],['authIdentities/owner',{userId:'person'}],['users/person',{authUid:'owner',stats:{}}]];
 for(const [sid,data] of Object.entries(seasons))records.push(['groups/TEST/seasons/'+sid,data]);
 const h=memoryFirestore(records),time=Date.parse(date);
 const deps={db:h.db,FieldValue:{serverTimestamp:()=>1},HttpsError,now:()=>time};
 const identity=require('../functions-identity/identity-service.js')(deps),groupWrites=require('../functions-identity/group-write-service.js')({...deps,identity});
 const pledges=require('../functions-identity/pledge-service.js')({...deps,groupWrites});
 const rollover=require('../functions-identity/rollover-service.js')({...deps,identity,groupWrites,pledges});
 return {...h,rollover};
}

test('rollover after a month an older app created: proceeds and marks the new month',async()=>{
 const h=rolloverSetup({'2026-09':season(9,{credentialSchema:2,status:'archived'}),'2026-10':season(10,{days:31})},'2026-11-01T01:00:00Z');
 const r=await h.rollover.run('TEST');assert.equal(r.ok,true);
 assert.equal(h.records.get('groups/TEST').currentSeasonId,'2026-11');assert.equal(h.records.get('groups/TEST/seasons/2026-11').credentialSchema,2);
});

test('two older-app months in a row still lead back to the migrated month',async()=>{
 const h=rolloverSetup({'2026-09':season(9,{credentialSchema:2}),'2026-10':season(10,{days:31}),'2026-11':season(11)},'2026-12-01T01:00:00Z');
 assert.equal((await h.rollover.run('TEST')).ok,true);assert.equal(h.records.get('groups/TEST/seasons/2026-12').credentialSchema,2);
});

test('a credential in the roster, or a gap in the months, still blocks without writes',async()=>{
 const withPin=rolloverSetup({'2026-09':season(9,{credentialSchema:2}),'2026-10':season(10,{days:31,roster:[{name:'Alex',userId:'person',team:'A',pin:'1234'}]})},'2026-11-01T01:00:00Z');
 let before=JSON.stringify([...withPin.records]);
 await assert.rejects(withPin.rollover.run('TEST'),e=>e.code==='failed-precondition');assert.equal(JSON.stringify([...withPin.records]),before);
 const gap=rolloverSetup({'2026-08':season(8,{credentialSchema:2}),'2026-10':season(10,{days:31})},'2026-11-01T01:00:00Z');
 before=JSON.stringify([...gap.records]);
 await assert.rejects(gap.rollover.run('TEST'),e=>e.code==='failed-precondition');assert.equal(JSON.stringify([...gap.records]),before);
});

test('an older-app month whose history was never migrated stays blocked',async()=>{
 const tx={get:async()=>({exists:false})},groupRef={collection:()=>({doc:()=>({})})};
 assert.equal(await seasonMigrated(tx,groupRef,'2026-10',season(10)),false);
 assert.equal(await seasonMigrated(tx,groupRef,'not-a-month',season(10)),false);
});

test('legacy linking works in a month an older app created',async()=>{
 const at=Date.parse('2026-10-05T06:00:00Z'),pin=String(crypto.randomInt(1000,10000));
 const h=memoryFirestore([
  ['users/self',{authUid:'owner',name:'Primary',memberships:{HOME:{}},stats:{}}],['authIdentities/owner',{userId:'self',groupCodes:['HOME']}],
  ['users/legacy',{name:'Legacy',pinHash:crypto.createHash('sha256').update(pin).digest('hex'),memberships:{AWAY:{}},stats:{}}],
  ['groups/HOME',{name:'Home',currentSeasonId:'2026-10'}],['groups/AWAY',{name:'Away',currentSeasonId:'2026-10'}],
  ['groups/HOME/seasons/2026-10',{year:2026,month:10,roster:[{name:'Primary',userId:'self',team:'A'}]}],
  ['groups/AWAY/seasons/2026-09',{year:2026,month:9,credentialSchema:2,roster:[{name:'Legacy',userId:'legacy',team:'B'}]}],
  ['groups/AWAY/seasons/2026-10',{year:2026,month:10,roster:[{name:'Legacy',userId:'legacy',team:'B',pinSet:true}]}],
  ['logs/old',{userId:'legacy',groupCode:'AWAY',year:2026,month:10,day:2,player:'Legacy',workouts:['Walk']}]
 ]);
 const deps={db:h.db,FieldValue:{serverTimestamp:()=>at},HttpsError,now:()=>at},identity=require('../functions-identity/identity-service.js')(deps),groupWrites=require('../functions-identity/group-write-service.js')({...deps,identity});
 const api=require('../functions-identity/legacy-link-service.js')({...deps,identity,groupWrites});
 const request={auth:{uid:'owner',token:{auth_time:at/1000,firebase:{sign_in_provider:'google.com'}}},data:{groupCode:'AWAY',name:'Legacy',pin}};
 const r=await api(request);assert.notEqual(r.invalid,true);assert.equal(h.records.get('logs/old').userId,'self');
 assert.equal(h.records.get('groups/AWAY/seasons/2026-10').roster[0].userId,'self');
});
