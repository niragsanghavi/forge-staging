// No SDK initialization, credentials, network setup or automatic invocation.
// An explicitly authorized operator supplies a project-bound Admin SDK client.
// Default is read-only. A fresh managed full export is the rollback source;
// never copy old PINs or profile verifiers into a local migration journal.
import {fingerprint} from './plan-security-migration.mjs';
const projectFor={PROD:'forge-25c8c',production:'forge-25c8c',STAGING:'forge-staging-865ff',staging:'forge-staging-865ff'};
const id=/^[A-Za-z0-9_-]{1,128}$/;
function validate(manifest){
 if(manifest?.schema!==1||manifest.readyForHumanReview!==true||!Array.isArray(manifest.blockers)||manifest.blockers.length||!Array.isArray(manifest.writes))throw Error('Reviewed, blocker-free manifest required');
 if(manifest.manifestHash!==fingerprint(manifest.writes))throw Error('Manifest fingerprint mismatch');
 const paths=new Set();
 for(const w of manifest.writes){
  if(paths.has(w.path)||w.operation!=='update'||!/^[a-f0-9]{64}$/.test(w.before))throw Error('Invalid or duplicate migration operation');paths.add(w.path);
  if(/^logs\/[A-Za-z0-9_-]{1,128}$/.test(w.path)){
   if(Object.keys(w.patch||{}).join()!=='userId'||!id.test(w.patch.userId))throw Error('Log migration may only assign a reviewed profile ID');
  }else if(/^groups\/[A-Z0-9]{4,10}\/seasons\/20\d{2}-(0[1-9]|1[0-2])$/.test(w.path)){
   if(Object.keys(w.patch||{}).sort().join()!=='credentialSchema,roster'||w.patch.credentialSchema!==2||!Array.isArray(w.patch.roster))throw Error('Invalid roster migration');
   for(const row of w.patch.roster)if(!row||typeof row!=='object'||Object.hasOwn(row,'pin')||Object.hasOwn(row,'pinHash')||(row.userId!==undefined&&!id.test(row.userId)))throw Error('Unsafe migrated roster');
  }else throw Error('Migration path outside approved collections');
 }
}
function refOf(db,path){const p=path.split('/');let ref=db.collection(p[0]).doc(p[1]);for(let i=2;i<p.length;i+=2)ref=ref.collection(p[i]).doc(p[i+1]);return ref;}
const owners=w=>w.patch.roster?w.patch.roster.map(r=>r.userId).filter(Boolean):[w.patch.userId];
const usable=snap=>snap.exists&&!snap.data().mergedInto&&!snap.data().deleted&&!snap.data().deletedAt&&!snap.data().deletionRequestedAt;
function classify(snap,write){
 if(!snap.exists)return 'missing';
 const current=snap.data();
 if(Object.entries(write.patch).every(([key,value])=>Object.hasOwn(current,key)&&fingerprint(current[key])===fingerprint(value)))return 'already';
 if(fingerprint(current)!==write.before)return 'changed';
 if(write.patch.roster){
  if(!Array.isArray(current.roster)||current.roster.length!==write.patch.roster.length)return 'unsafe-roster';
  const stable=row=>Object.fromEntries(Object.entries(row||{}).filter(([key])=>!['pin','pinHash','userId','isAdmin'].includes(key)));
  if(current.roster.some((row,i)=>fingerprint(stable(row))!==fingerprint(stable(write.patch.roster[i]))))return 'unsafe-roster';
 }
 return 'pending';
}
export async function runReviewedMigration({db,manifest,dryRun=true,approvedHash,rollbackExport,allowProduction=false,batchSize=100,now=Date.now}){
 validate(manifest);
 const project=projectFor[manifest.environment];
 if(!project||db?.projectId!==project)throw Error('Explicit database project must match the reviewed manifest');
 if(!Number.isInteger(batchSize)||batchSize<1||batchSize>100)throw Error('Migration batches must contain 1–100 documents');
 if(!dryRun){
  if(project==='forge-25c8c'&&allowProduction!==true)throw Error('Production execution requires separate explicit authorization');
  if(approvedHash!==manifest.manifestHash)throw Error('Approve this exact manifest before applying');
 }
  // Required BEFORE dry-run reads too. This is an operator attestation,
  // NOT independent cloud-backup verification.
  // The operator must inspect a successful managed export before supplying it.
  const age=now()-Date.parse(rollbackExport?.completedAt||'');
  if(rollbackExport?.operatorVerified!==true||rollbackExport.projectId!==project||!/^gs:\/\/[^/]+\/.+/.test(rollbackExport.uri||'')||!Number.isFinite(age)||age<0||age>86400000)throw Error('A freshly verified full rollback export is required');
 const states=[];
 for(const id of new Set(manifest.writes.flatMap(owners))){if(!usable(await db.collection('users').doc(id).get()))states.push({path:'users/'+id,status:'owner-unavailable'});}
 for(const write of manifest.writes)states.push({path:write.path,status:classify(await refOf(db,write.path).get(),write)});
 const conflicts=states.filter(s=>!['pending','already'].includes(s.status));
 const result={projectId:project,manifestHash:manifest.manifestHash,dryRun,pending:states.filter(s=>s.status==='pending').length,already:states.filter(s=>s.status==='already').length,conflicts,applied:0};
 if(dryRun||conflicts.length)return result;
 for(let start=0;start<manifest.writes.length;start+=batchSize){
  const batch=manifest.writes.slice(start,start+batchSize);
  try{
   result.applied+=await db.runTransaction(async tx=>{
    const pending=[];
    for(const id of new Set(batch.flatMap(owners)))if(!usable(await tx.get(db.collection('users').doc(id))))throw Error('Migration owner is no longer available');
    for(const write of batch){
     const ref=refOf(db,write.path),state=classify(await tx.get(ref),write);
     if(state==='already')continue;
     if(state!=='pending')throw Error('Migration precondition changed at '+write.path);
     pending.push({ref,patch:write.patch});
    }
    for(const w of pending)tx.update(w.ref,w.patch);return pending.length;
   });
  }catch(error){
   // Earlier committed batches stay recorded in the result. Re-running the
   // same manifest skips exact applied patches; never automatically undo newer
   // user data. A managed-export rollback is a separate human-approved action.
   error.migrationProgress={...result,partial:result.applied>0};throw error;
  }
 }
 return {...result,pending:0,complete:true};
}
