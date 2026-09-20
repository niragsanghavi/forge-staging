import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const read=p=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8');
const target=read('src/config/build-target.js');
const source=read('src/config/firebase.js').split('firebase.initializeApp(FB_CFG);')[0]+'firebase.initializeApp(FB_CFG);';
function boot({environment='staging',native=false,nativeAuth=false,hostname='localhost',providersEnabled=true}={}){
  const initialized=[];
  const context={location:{hostname,pathname:'/forge-staging/',search:'?production=1'},
    firebase:{initializeApp:cfg=>initialized.push(cfg.projectId)},Capacitor:{isNativePlatform:()=>native},
    FORGE_BUILD_TARGET:{environment,nativeAuth,providersEnabled}};
  context.window=context;vm.createContext(context);
  return {context,initialized,run:()=>vm.runInContext(source,context)};
}
test('checked-in target is immutable staging with native explicitly off',()=>{
  const context=vm.createContext({});vm.runInContext(target,context);
  assert.equal(context.FORGE_BUILD_TARGET.environment,'staging');
  assert.equal(context.FORGE_BUILD_TARGET.nativeAuth,false);
  assert.equal(Object.isFrozen(context.FORGE_BUILD_TARGET),true);
  assert.equal(Object.getOwnPropertyDescriptor(context,'FORGE_BUILD_TARGET').writable,false);
});
test('hostnames and URL flags cannot choose production',()=>{
  for(const hostname of ['localhost','goforge.in','niragsanghavi.github.io']){
    const b=boot({hostname});b.run();assert.deepEqual(b.initialized,['forge-staging-865ff']);
  }
});
test('staging native and unapproved production native fail before Firebase init',()=>{
  for(const options of [{native:true},{environment:'production',native:true},{environment:'production',native:true,nativeAuth:true,providersEnabled:false}]){
    const b=boot(options);assert.throws(b.run,/held/);assert.equal(b.initialized.length,0);
  }
});
test('explicit production target permits its real web origin and configured native only',()=>{
  for(const options of [{environment:'production',hostname:'goforge.in'},{environment:'production',native:true,nativeAuth:true}]){
    const b=boot(options);b.run();assert.deepEqual(b.initialized,['forge-25c8c']);
  }
  const b=boot({environment:'production',hostname:'niragsanghavi.github.io'});assert.throws(b.run,/not permitted/);assert.equal(b.initialized.length,0);
});
test('invalid or missing target cannot fall through to production',()=>{
  const b=boot({environment:'typo'});assert.throws(b.run,/invalid/);assert.equal(b.initialized.length,0);
  const missing=boot();delete missing.context.FORGE_BUILD_TARGET;
  assert.throws(missing.run,/invalid/);assert.equal(missing.initialized.length,0);
});
test('provider gates remain restricted by environment, exact web origin and native approval',()=>{
  const state=read('src/state/appState.js');
  const gate=state.slice(state.indexOf('window.FEATURE_GOOGLE_AUTH ='),state.indexOf('window.FEATURE_APPLE_AUTH =')) ;
  for(const [options,expected] of [
    [{hostname:'niragsanghavi.github.io'},true],[{hostname:'localhost'},false],
    [{hostname:'goforge.in'},false],[{environment:'production',hostname:'goforge.in'},true],
    [{environment:'production',native:true,nativeAuth:true},true],
    [{environment:'production',hostname:'goforge.in',providersEnabled:false},false]
  ]){
    const b=boot(options);b.run();vm.runInContext(gate,b.context);assert.equal(b.context.FEATURE_GOOGLE_AUTH,expected);
  }
});
test('messaging worker imports the same target and refuses production on a staging origin',()=>{
  const worker=read('firebase-messaging-sw.js').split('var messaging =')[0];
  for(const [environment,hostname,expected] of [['staging','goforge.in','forge-staging-865ff'],['production','goforge.in','forge-25c8c'],['production','niragsanghavi.github.io',null]]){
    const initialized=[],context={importScripts(){},FORGE_BUILD_TARGET:{environment},location:{hostname},
      firebase:{initializeApp:cfg=>initialized.push(cfg.projectId)}};
    context.self=context;
    if(expected){vm.runInNewContext(worker,context);assert.deepEqual(initialized,[expected]);}
    else {assert.throws(()=>vm.runInNewContext(worker,context),/not permitted/);assert.equal(initialized.length,0);}
  }
  assert.ok(worker.includes("importScripts('./src/config/build-target.js')"));
});
