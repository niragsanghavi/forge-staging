// npm test — synthetic records only; no Firebase/network access.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import fs from 'node:fs';
const require=createRequire(import.meta.url);
const {belongs,seasonNames,departedRow,scrubLog}=require('../functions-identity/deletion-history.js');
test('stable ownership overrides matching names and old device identities',()=>{
 assert.equal(belongs({userId:'other',uid:'owner',player:'Same'},'person','owner',['Same']),false);
 assert.equal(belongs({userId:'person',uid:'different'},'person','owner'),true);
 assert.equal(belongs({uid:'other',player:'Same'},'person','owner',['Same']),false);
});
test('legacy ownership uses a scoped UID or a proven season label, never a global name',()=>{
 assert.equal(belongs({uid:'owner'},'person','owner'),true);
 assert.equal(belongs({player:'Same'},'person','owner'),false);
 assert.equal(belongs({player:'Same'},'person','owner',['Same']),true);
 assert.equal(belongs(null,'person','owner'),false);
});
test('same-name people cannot donate name-only history to the deleting account',()=>{
 assert.deepEqual(seasonNames([{name:'Same',userId:'person'},{name:'Same',userId:'other'}],'person','owner'),[]);
 assert.deepEqual(seasonNames([{name:'Same',userId:'person'},{name:'Same'}],'person','owner'),[]);
});
test('historical aliases are independently scoped to their own roster',()=>{
 assert.deepEqual(seasonNames([{name:'Earlier',userId:'person'},{name:'Other',userId:'other'}],'person','owner'),['Earlier']);
 assert.deepEqual(seasonNames([{name:'Later',uid:'owner'}],'person','owner'),['Later']);
 assert.deepEqual(seasonNames(null,'person','owner'),[]);
});
test('departed roster rows are reconstructed without unknown identity fields',()=>{
 const result=departedRow({name:'Private',team:'B',role:'Captain',userId:'person',uid:'owner',email:'fictional@example.invalid',secret:'fixture',isAdmin:true},'Departed abcdef123456');
 assert.deepEqual(result,{name:'Departed abcdef123456',team:'B',role:'Player',departed:true});
});
test('tombstoned logs retain only structural season fields, not activity or personal content',()=>{
 const result=scrubLog({groupCode:'TEST',year:2026,month:6,day:4,team:'A',player:'Private',userId:'person',uid:'owner',note:'Private note',km:4,workouts:['Gym'],timestamp:'precise time',unknownPrivateField:'private'},'Departed abcdef123456',123);
 assert.deepEqual(result,{groupCode:'TEST',year:2026,month:6,day:4,team:'A',player:'Departed abcdef123456',workouts:[],voided:true,voidedBy:'account-deletion',voidedAt:123});
});
test('deletion preserves private discovery scope before anonymising a roster',()=>{
 const text=fs.readFileSync(new URL('../functions-identity/deletion-history.js',import.meta.url),'utf8');
 assert.ok(text.indexOf('seasonNames:Object.fromEntries')<text.indexOf('departedRow(p,label)'));
 assert.match(text,/job.activeGroup === group.id/);
 assert.match(text,/DELETION_LEGACY_OWNERSHIP_REQUIRED/);
});
test('provider deletion bypasses every legacy client-side cleanup write',()=>{
 const html=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
 const source=html.slice(html.indexOf('async function executeAccountDeletion('),html.indexOf('async function deleteFromOneGroup('));
 assert.ok(source.indexOf("callFunction('finalizeAccountDeletion'")<source.indexOf("db.collection('users')"));
 assert.match(source,/result.complete!==true&&result.pending!==true/);
 assert.match(source,/return result;/);
});
