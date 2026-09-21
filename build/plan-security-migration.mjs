// Read-only: node build/plan-security-migration.mjs /absolute/path/to/export.json
// Emits paths/counts only. Never emits credentials, mutates data or contacts Firebase.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import crypto from 'node:crypto';
const fingerprint=value=>crypto.createHash('sha256').update(JSON.stringify(value,(_key,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.entries(v).sort(([a],[b])=>a.localeCompare(b))):v)).digest('hex');
export function planSecurityMigration(data){
 if(!data||!Array.isArray(data.groups)||!Array.isArray(data.users)||!Array.isArray(data.logs))throw Error('Expected a complete Forge export with groups, users and logs.');
 const users=new Map(data.users.map(u=>[u.id,u])),changes=[],blockers=[],admins=[],seasons=new Map();
 const canonical=id=>{const seen=new Set();while(users.get(id)?.mergedInto){if(seen.has(id))return null;seen.add(id);id=users.get(id).mergedInto;}return users.has(id)?id:null;};
 for(const group of data.groups){
  if(!Array.isArray(group.seasons)){blockers.push({path:'groups/'+group.id,reason:'SEASON_EXPORT_MISSING'});continue;}
  for(const season of group.seasons){
   const target='groups/'+group.id+'/seasons/'+season.id;
   if(!Array.isArray(season.roster)){blockers.push({path:target,reason:'ROSTER_MISSING'});continue;}
   const rows=season.roster.map((r,index)=>({row:r,index,id:canonical(r?.userId||r?.uid)}));
   const seen=new Set();for(const entry of rows){
    if(!entry.row||typeof entry.row.name!=='string'){blockers.push({path:target,index:entry.index,reason:'MALFORMED_ROSTER'});continue;}
    if(entry.id&&seen.has(entry.id))blockers.push({path:target,index:entry.index,reason:'DUPLICATE_PROFILE'});if(entry.id)seen.add(entry.id);
    if(season.id===group.currentSeasonId&&!entry.row.departed&&!entry.id)blockers.push({path:target,index:entry.index,reason:'CURRENT_MEMBER_OWNERSHIP_UNRESOLVED'});
    if(season.id===group.currentSeasonId&&entry.row.isAdmin&&!entry.row.departed)admins.push({path:target,index:entry.index,userId:entry.id,requiresReview:true});
   }
   seasons.set(group.id+'|'+season.id,rows);
   changes.push({path:target,action:'SCRUB_ROSTER_CREDENTIALS_AND_STAMP_SCHEMA',rows:rows.length,identityBackfills:rows.filter(e=>e.id&&e.row.userId!==e.id).length});
  }
 }
 let logBackfills=0;
 for(const log of data.logs){
  if(log.userId&&canonical(log.userId)===log.userId)continue;
  const key=log.groupCode+'|'+log.year+'-'+String(log.month).padStart(2,'0'),matches=(seasons.get(key)||[]).filter(e=>e.row?.name===log.player&&e.id);
  if(matches.length===1&&(!log.userId||canonical(log.userId)===matches[0].id))logBackfills++;
  else if(!log.voided)blockers.push({path:'logs/'+log.id,reason:'LOG_OWNERSHIP_UNRESOLVED'});
 }
 return {readOnly:true,exportTakenAt:data.takenAt||null,environment:data.env||null,counts:{groups:data.groups.length,users:data.users.length,logs:data.logs.length,seasonWrites:changes.length,logBackfills,blockers:blockers.length,adminReviews:admins.length},changes,adminReview:admins,blockers,approvalRequired:true,note:'This is an audit, not an executable migration or a fresh full rollback export. Never deploy secure rules based on this audit alone.'};
}
// Build a reviewable patch manifest, never an implicit live migration. Explicit
// owner decisions are keyed by document path (roster entries add #index).
// No legacy PIN/verifier is copied into the manifest, even for rollback.
export function buildReviewedMigration(data,review={}){
 const copy=structuredClone(data),users=new Map(copy.users.map(u=>[u.id,u])),issues=[],writes=[];
 const assignments=review.assignments||{},admins=review.adminDecisions||{},used=new Set(),usedAdmins=new Set();
 const canonical=id=>{const seen=new Set();while(users.get(id)?.mergedInto){if(seen.has(id))return null;seen.add(id);id=users.get(id).mergedInto;}return users.has(id)?id:null;};
 function selected(key,fallback){
  if(!Object.hasOwn(assignments,key))return canonical(fallback);
  used.add(key);const id=assignments[key],user=users.get(id);
  if(typeof id!=='string'||!user||user.mergedInto||user.deleted||user.deletedAt||user.deletionRequestedAt){issues.push({path:key,reason:'INVALID_REVIEWED_OWNER'});return null;}return id;
 }
 for(const group of copy.groups){
  for(const season of group.seasons||[]){
   const path='groups/'+group.id+'/seasons/'+season.id;
   const original=data.groups.find(g=>g.id===group.id).seasons.find(s=>s.id===season.id);
   season.roster=(season.roster||[]).map((row,index)=>{
    const key=path+'#'+index;if(!row||typeof row!=='object'){issues.push({path:key,reason:'INVALID_ROSTER'});return row;}
    const {pin,pinHash,...safe}=row,id=selected(key,row.userId||row.uid);if(id)safe.userId=id;
    if(group.currentSeasonId===season.id&&row.isAdmin&&!row.departed){
     if(!Object.hasOwn(admins,key)||typeof admins[key]!=='boolean')issues.push({path:key,reason:'ADMIN_DECISION_REQUIRED'});
     else{safe.isAdmin=admins[key];usedAdmins.add(key);}
    }
    return safe;
   });
   season.credentialSchema=2;
   // The precondition is a document fingerprint, never its old credentials.
   const {id:_id,...before}=original;
   writes.push({path,operation:'update',before:fingerprint(before),patch:{roster:season.roster,credentialSchema:2}});
  }
 }
 const bySeason=new Map(copy.groups.flatMap(g=>(g.seasons||[]).map(s=>[g.id+'|'+s.id,s])));
 for(const log of copy.logs){
  const path='logs/'+log.id,explicit=selected(path,log.userId);
  const rows=bySeason.get(log.groupCode+'|'+log.year+'-'+String(log.month).padStart(2,'0'))?.roster||[];
  const matches=rows.filter(r=>r?.name===log.player&&canonical(r.userId));
  const id=explicit||(!log.userId&&matches.length===1?canonical(matches[0].userId):null);
  if(id&&id!==log.userId){const {id:_id,...before}=data.logs.find(l=>l.id===log.id);writes.push({path,operation:'update',before:fingerprint(before),patch:{userId:id}});log.userId=id;}
 }
 for(const key of Object.keys(assignments))if(!used.has(key))issues.push({path:key,reason:'UNUSED_OWNER_DECISION'});
 for(const key of Object.keys(admins))if(!usedAdmins.has(key))issues.push({path:key,reason:'UNUSED_ADMIN_DECISION'});
 const audit=planSecurityMigration(copy),blockers=[...audit.blockers,...issues];
 return {schema:1,readOnly:true,environment:data.env||null,exportTakenAt:data.takenAt||null,readyForHumanReview:blockers.length===0,blockers,writes,manifestHash:fingerprint(writes),requiresFreshFullRollbackExport:true,requiresExplicitApprovalBeforeApply:true};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 if(process.argv.length!==3||!path.isAbsolute(process.argv[2]))throw Error('Provide one absolute path to a Forge JSON export.');
 const result=planSecurityMigration(JSON.parse(fs.readFileSync(process.argv[2],'utf8')));
 console.log(JSON.stringify(result,null,2));process.exitCode=result.counts.blockers?2:0;
}
