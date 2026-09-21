import test from 'node:test';
import assert from 'node:assert/strict';
import {memoryFirestore} from './memory-firestore.mjs';
import {buildReviewedMigration,fingerprint} from '../build/plan-security-migration.mjs';
import {runReviewedMigration} from '../build/reviewed-migration-engine.mjs';
const at=Date.parse('2026-09-21T06:00:00Z');
test('dry run requires a fresh project-matched verified backup before any database reads',async()=>{
 for(const mode of ['missing','stale','future','project','unverified']){
  const h=setup();h.db.collection=()=>{throw Error('UNEXPECTED_DATABASE_READ');};
  const backup=h.options.rollbackExport;
  if(mode==='missing')delete h.options.rollbackExport;
  if(mode==='stale')backup.completedAt=new Date(at-86400001).toISOString();
  if(mode==='future')backup.completedAt=new Date(at+1000).toISOString();
  if(mode==='project')backup.projectId='forge-25c8c';
  if(mode==='unverified')backup.operatorVerified=false;
  await assert.rejects(runReviewedMigration(h.options),/freshly verified full rollback export/);
 }
});
function setup(){
 const season={roster:[{name:'Alex',uid:'one',pin:'synthetic-credential'}]},log={groupCode:'TEST',year:2026,month:9,player:'Alex'};
 const h=memoryFirestore([['users/one',{name:'Alex'}],['groups/TEST/seasons/2026-09',season],['logs/a',log]]);h.db.projectId='forge-staging-865ff';
 const manifest=buildReviewedMigration({env:'STAGING',groups:[{id:'TEST',currentSeasonId:'2026-09',seasons:[{id:'2026-09',...season}]}],users:[{id:'one'}],logs:[{id:'a',...log}]});
 const options={db:h.db,manifest,now:()=>at,rollbackExport:{projectId:h.db.projectId,operatorVerified:true,uri:'gs://fictional-rollback/export',completedAt:new Date(at-1000).toISOString()}},apply={...options,dryRun:false,approvedHash:manifest.manifestHash};
 return {...h,options,apply,manifest};
}
test('migration defaults to preview and never exposes credentials',async()=>{
 const h=setup(),before=JSON.stringify([...h.records]),r=await runReviewedMigration(h.options);assert.equal(r.pending,2);assert.equal(JSON.stringify([...h.records]),before);assert.equal(JSON.stringify(r).includes('synthetic-credential'),false);
});
test('exact approved migration is atomic per batch and reruns safely',async()=>{
 const h=setup(),r=await runReviewedMigration(h.apply);assert.equal(r.applied,2);assert.equal(h.records.get('logs/a').userId,'one');assert.equal(h.records.get('groups/TEST/seasons/2026-09').roster[0].pin,undefined);
 const again=await runReviewedMigration(h.apply);assert.equal(again.applied,0);assert.equal(again.already,2);
});
test('wrong project, missing approval or missing verified backup blocks writes',async()=>{
 for(const mode of ['project','approval','backup']){const h=setup(),before=JSON.stringify([...h.records]);if(mode==='project')h.db.projectId='forge-25c8c';if(mode==='approval')h.apply.approvedHash='wrong';if(mode==='backup')delete h.apply.rollbackExport;await assert.rejects(runReviewedMigration(h.apply));assert.equal(JSON.stringify([...h.records]),before);}
});
test('source conflicts are found before the first write',async()=>{
 const h=setup();h.records.get('logs/a').player='Changed';const r=await runReviewedMigration(h.apply);assert.equal(r.applied,0);assert.equal(r.conflicts.length,1);assert.ok(h.records.get('groups/TEST/seasons/2026-09').roster[0].pin);
});
test('partial batch failure reports progress and the same manifest resumes without duplication',async()=>{
 const h=setup();let commits=0;h.onCommit(()=>{if(++commits===2)throw Error('FICTIONAL_FAILURE');});
 await assert.rejects(runReviewedMigration({...h.apply,batchSize:1}),e=>e.migrationProgress.applied===1&&e.migrationProgress.partial);
 h.onCommit(()=>{});const r=await runReviewedMigration({...h.apply,batchSize:1});assert.equal(r.applied,1);assert.equal(r.already,1);
});
test('manifest tampering and scoring/team changes are rejected',async()=>{
 const h=setup();h.manifest.writes[0].patch.roster[0].team='Z';await assert.rejects(runReviewedMigration(h.options),/fingerprint/);
 h.manifest.manifestHash=fingerprint(h.manifest.writes);const r=await runReviewedMigration(h.options);assert.equal(r.conflicts[0].status,'unsafe-roster');
});
test('a deleted or merged destination cannot receive historical ownership',async()=>{
 for(const patch of [{deleted:true},{mergedInto:'elsewhere'},{deletionRequestedAt:1}]){const h=setup();Object.assign(h.records.get('users/one'),patch);const r=await runReviewedMigration(h.apply);assert.equal(r.applied,0);assert.equal(r.conflicts[0].status,'owner-unavailable');}
});
