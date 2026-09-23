// Deterministic source assembly only. Never invokes Firebase, reads user data,
// migrates function ownership, deploys, or accesses cloud credentials.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
if(process.argv.length!==2)throw Error('No arguments supported; run npm run prepare:backend.');
const files={
  'functions-identity/group-import-service.js':'group-import-service.js',
  'functions-identity/device-registration-service.js':'device-registration-service.js',
  'functions-identity/workout-removal-service.js':'workout-removal-service.js',
  'functions-identity/announcement-service.js':'announcement-service.js',
  'functions/index.js':'legacy-entry.js',
  'functions-identity/identity-entry.js':'identity-entry.js',
  'functions-identity/identity-service.js':'identity-service.js',
  'functions-identity/deletion-history.js':'deletion-history.js',
  'functions-identity/aggregate-service.js':'aggregate-service.js',
  'functions-identity/admin-service.js':'admin-service.js',
  'functions-identity/twist-admin-service.js':'twist-admin-service.js',
  'functions-identity/season-dates.js':'season-dates.js',
  'functions-identity/pledge-service.js':'pledge-service.js',
  'functions-identity/rollover-service.js':'rollover-service.js',
  'functions-identity/group-create-service.js':'group-create-service.js',
  'functions-identity/group-archive-service.js':'group-archive-service.js',
  'functions-identity/group-write-service.js':'group-write-service.js',
  'functions-identity/legacy-link-service.js':'legacy-link-service.js',
  'functions-identity/migration-state.js':'migration-state.js',
  'functions-identity/solo-service.js':'solo-service.js',
  'functions-identity/support-service.js':'support-service.js',
  'functions-identity/steps-service.js':'steps-service.js',
  'functions-identity/scoring-engine.js':'scoring-engine.js',
  'functions-identity/package-lock.json':'package-lock.json'
};
const contents=Object.entries(files).map(([source,destination])=>{
  const full=path.join(root,source);
  if(!fs.lstatSync(full).isFile() || fs.lstatSync(full).isSymbolicLink())throw Error('Expected regular source file: '+source);
  return {source,destination,bytes:fs.readFileSync(full)};
});
const pkg=JSON.parse(fs.readFileSync(path.join(root,'functions-identity/package.json'),'utf8'));
pkg.main='production-entry.js';
pkg.description='Reviewed production assembly; existing default codebase ownership retained';
pkg.type='commonjs';
// Create a NEW directory each time. Never overwrite a previous release candidate.
const output=fs.mkdtempSync(path.join(root,'build/production-backend-'));
const functions=path.join(output,'functions');fs.mkdirSync(functions);
for(const item of contents)fs.writeFileSync(path.join(functions,item.destination),item.bytes);
fs.writeFileSync(path.join(functions,'package.json'),JSON.stringify(pkg,null,2)+'\n');
fs.writeFileSync(path.join(functions,'production-entry.js'),[
  "'use strict';",
  "// Keep all production endpoints, including claimIdentity, in the existing default codebase.",
  "for (const source of ['./legacy-entry','./identity-entry']) {",
  "  for (const [name, handler] of Object.entries(require(source))) {",
  "    if (Object.prototype.hasOwnProperty.call(exports, name)) throw new Error('Duplicate production endpoint: '+name);",
  "    exports[name] = handler;",
  "  }",
  "}",''
].join('\n'));
fs.writeFileSync(path.join(output,'firebase.json'),JSON.stringify({
  functions:[{source:'functions',codebase:'default',ignore:['node_modules','.git','*-debug.log']}]
},null,2)+'\n');
const manifest={project:'forge-25c8c',codebase:'default',deployed:false,
  note:'Source assembly only. Verify current cloud inventory, production rules/indexes, secrets, rollback and approval before user-run deployment.',
  files:contents.map(({source,destination,bytes})=>({source,destination,sha256:crypto.createHash('sha256').update(bytes).digest('hex')}))};
fs.writeFileSync(path.join(output,'source-manifest.json'),JSON.stringify(manifest,null,2)+'\n');
console.log(JSON.stringify({output,project:manifest.project,deployed:false}));
