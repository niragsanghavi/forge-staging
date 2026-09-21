// npm test: inspect real codebase entry points without installing Firebase or making calls.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import crypto from 'node:crypto';
import {spawnSync} from 'node:child_process';
const root=path.resolve(import.meta.dirname,'..');
const trigger=Symbol('firebase trigger');
const wrap=()=>({[trigger]:true});
function exportsFor(directory) {
  const base=path.resolve(root,directory), cache=new Map();
  const forbidden=()=>{throw Error('Function discovery attempted an external operation');};
  const db=new Proxy({}, {get:()=>forbidden});
  const apps=[];
  const sdk={
    'firebase-admin':{apps,initializeApp(){assert.equal(apps.length,0,'Firebase initialized twice');apps.push({});},firestore:()=>db,auth:forbidden},
    'firebase-admin/firestore':{FieldValue:{}},
    'firebase-functions':{logger:{info(){},warn(){},error(){}}},
    'firebase-functions/v2/https':{onCall:wrap,HttpsError:Error},
    'firebase-functions/v2/scheduler':{onSchedule:wrap},
    'firebase-functions/v2/firestore':{onDocumentWritten:wrap},
    'firebase-functions/v2/options':{setGlobalOptions(){}},
    'firebase-functions/params':{defineSecret:()=>({value:forbidden})},
    'crypto':crypto,'node:crypto':crypto
  };
  function load(file) {
    if (!file.startsWith(base+path.sep)) throw Error('Module escaped codebase');
    if(cache.has(file)) return cache.get(file).exports;
    const module={exports:{}}; cache.set(file,module);
    const context=vm.createContext({module,exports:module.exports,Buffer,console,
      require:name=>{
        if(Object.hasOwn(sdk,name)) return sdk[name];
        if(name.startsWith('./')) return load(path.resolve(path.dirname(file),name.endsWith('.js')?name:name+'.js'));
        throw Error('Unexpected module '+name);
      }});
    new vm.Script(fs.readFileSync(file,'utf8'),{filename:file}).runInContext(context,{timeout:2000});
    return module.exports;
  }
  const pkg=JSON.parse(fs.readFileSync(path.join(base,'package.json'),'utf8'));
  const names=[];
  function walk(object,prefix='') {
    for(const [name,value] of Object.entries(object)) {
      if(value?.[trigger]) names.push(prefix+name);
      else if(value && typeof value==='object') walk(value,prefix+name+'-');
      else throw Error('Unrecognized export '+prefix+name);
    }
  }
  walk(load(path.join(base,pkg.main || 'index.js')));
  assert.ok(names.length,'No functions discovered');
  return names;
}
function uniqueOwners(codebases) {
  const owner=new Map();
  for(const [codebase,names] of codebases) for(const name of names) {
    assert.ok(!owner.has(name),'Duplicate function '+name+' in '+owner.get(name)+' and '+codebase);
    owner.set(name,codebase);
  }
  return owner;
}
test('all configured codebases have disjoint actual export names',()=>{
  const bases=new Map();
  for(const config of ['firebase.json','firebase.staging-candidate.json']) {
    for(const entry of JSON.parse(fs.readFileSync(path.join(root,config),'utf8')).functions) {
      const name=entry.codebase || 'default';
      if(bases.has(name)) assert.equal(bases.get(name),entry.source);
      bases.set(name,entry.source);
    }
  }
  const owners=uniqueOwners([...bases].map(([name,source])=>[name,exportsFor(source)]));
  for(const name of ['claimIdentity','refreshIdentity','settleSweep','saveGroupWorkout','voidGroupWorkout','saveGroupSteps','setGroupVisibility','refreshGroupStats','aggregateLogChanges','aggregateSeasonChanges','aggregateAwardChanges','aggregateBonusChanges']) assert.equal(owners.get(name),'identity');
  for(const name of ['streakAtRisk','mondayRecap','testPush','awardSeasonBadges','adminResetPin','sendNotice','noticeQueue','drainScheduledNotices']) assert.equal(owners.get(name),'default');
  for(const name of ['getAdminAccess','changeGroupAdmin','createGroupWithIdentity','checkJackAward','reconcileStatistics','lockPledge','settlePledges','rolloverGroup','rolloverSweep','getGroupFlags','flagGroupWorkout'])assert.equal(owners.get(name),'identity');
  for(const name of ['getRecapPercentile','submitGroupSurvey','repairDerivedStats','trackGroupTab','linkLegacyGroup'])assert.equal(owners.get(name),'identity');
});
test('ownership guard rejects duplicate names, not just known collisions',()=>{
  assert.throws(()=>uniqueOwners([['default',['newName']],['identity',['newName']]]),/Duplicate function/);
});
test('production assembly preserves every endpoint under default, including existing claimIdentity',()=>{
  const result=spawnSync(process.execPath,['build/prepare-production-backend.mjs'],{cwd:root,encoding:'utf8'});
  assert.equal(result.status,0,result.stderr);
  const {output,deployed}=JSON.parse(result.stdout);
  assert.equal(deployed,false);
  assert.ok(output.startsWith(path.join(root,'build/production-backend-')));
  const expected=[...exportsFor('functions'),...exportsFor('functions-identity')].sort();
  const actual=exportsFor(path.relative(root,path.join(output,'functions'))).sort();
  assert.deepEqual(actual,expected);
  for(const name of ['adminResetPin','awardSeasonBadges','claimIdentity','mondayRecap','streakAtRisk','testPush'])assert.ok(actual.includes(name));
  const config=JSON.parse(fs.readFileSync(path.join(output,'firebase.json'),'utf8'));
  assert.equal(config.functions.length,1);assert.equal(config.functions[0].codebase,'default');
  const manifest=JSON.parse(fs.readFileSync(path.join(output,'source-manifest.json'),'utf8'));
  for(const item of manifest.files){
    const hash=crypto.createHash('sha256').update(fs.readFileSync(path.join(output,'functions',item.destination))).digest('hex');
    assert.equal(hash,item.sha256);
    assert.equal(hash,crypto.createHash('sha256').update(fs.readFileSync(path.join(root,item.source))).digest('hex'));
  }
});
