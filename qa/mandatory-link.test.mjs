import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const html=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
const choose=html.slice(html.indexOf('async function choosePlayer('),html.indexOf('// Stage 3: validate the entered PIN'));
const submit=html.slice(html.indexOf('async function submitPinEntry('),html.indexOf('// Escape hatch from the PIN-entry screen'));
function harness({linked=false,userId='person',anonymous=false}={}){
 const nodes={},calls=[],steps=[],messages=[],restores=[];
 const node=id=>nodes[id]||(nodes[id]={value:'',textContent:'',classList:{add(){},remove(){}}});
 const ctx={window:{FEATURE_GOOGLE_AUTH:true},season:{roster:[{name:'Person',userId:'person'}]},groupCode:'TEST',seasonId:'2026-09',
  auth:{currentUser:{uid:'owner',isAnonymous:anonymous}},document:{getElementById:node},
  db:new Proxy({},{get(){throw Error('Credential/profile read must not occur before server proof');}}),
  callFunction:async(name,data)=>{calls.push({name,data});return {linked,userId};},
  showObStep:s=>steps.push(s),renderGoogleLoginDoor(){},toast:m=>messages.push(m),restoreIdentityFromGoogle:async r=>restores.push(r)};
 vm.createContext(ctx);
 vm.runInContext(fs.readFileSync(new URL('../src/ui/account-feedback.js',import.meta.url),'utf8'),ctx);
 ctx.ForgeFeedback=ctx.window.ForgeFeedback;
 vm.runInContext(choose+'\n'+submit,ctx);
 return {ctx,nodes,node,calls,steps,messages,restores};
}
test('legacy chooser never downloads password verifiers and routes to server proof',async()=>{
 const h=harness();await h.ctx.choosePlayer('Person');assert.deepEqual(h.steps,[4]);assert.equal(h.ctx.window._pinEntryFor,'Person');assert.equal(h.calls[0].name,'refreshIdentity');assert.match(h.node('ob-s4-sub').textContent,/existing Forge PIN once/);
});
test('anonymous users cannot enter a profile through a PIN-only grace flow',async()=>{
 const h=harness({anonymous:true});await h.ctx.choosePlayer('Person');assert.deepEqual(h.steps,[1]);assert.equal(h.calls.length,0);
});
test('already-linked owner restores without another PIN while wrong owner stays out',async()=>{
 const h=harness({linked:true});await h.ctx.choosePlayer('Person');assert.equal(h.restores.length,1);
 const other=harness({linked:true,userId:'other'});await other.ctx.choosePlayer('Person');assert.equal(other.restores.length,0);assert.match(other.messages[0],/different Forge profile/);
});
test('legacy records without stable identity request recovery, never mint ownership',async()=>{
 const h=harness();delete h.ctx.season.roster[0].userId;await h.ctx.choosePlayer('Person');assert.equal(h.calls.length,0);assert.match(h.messages[0],/needs help linking/);
});
test('PIN is checked only by callable and removed after confirmed linking',async()=>{
 const h=harness();await h.ctx.choosePlayer('Person');h.node('pinEntry').value='1234';await h.ctx.submitPinEntry();assert.equal(h.calls.at(-1).name,'claimIdentity');assert.equal(h.calls.at(-1).data.userId,'person');assert.equal(h.node('pinEntry').value,'');assert.equal(h.restores.length,1);assert.equal(h.ctx.window._forgeClaimBusy,false);
});
test('failed claims and rate limits never launch or restore a profile',async()=>{
 const h=harness();await h.ctx.choosePlayer('Person');h.node('pinEntry').value='1234';h.ctx.callFunction=async()=>{throw {code:'functions/resource-exhausted'};};await h.ctx.submitPinEntry();assert.equal(h.restores.length,0);assert.match(h.node('pinEntryError').textContent,/hour/);assert.equal(h.ctx.window._forgeClaimBusy,false);
});
test('late chooser and claim replies cannot restore a changed actor',async()=>{
 const h=harness();let finish;h.ctx.callFunction=()=>new Promise(resolve=>{finish=resolve;});const pending=h.ctx.choosePlayer('Person');h.ctx.auth.currentUser={uid:'other'};finish({linked:true,userId:'person'});await pending;assert.equal(h.restores.length,0);assert.equal(h.steps.length,0);
 const s=harness();await s.ctx.choosePlayer('Person');s.node('pinEntry').value='1234';s.ctx.callFunction=()=>new Promise(resolve=>{finish=resolve;});const claim=s.ctx.submitPinEntry();s.ctx.auth.currentUser={uid:'other'};finish({ok:true});await claim;assert.equal(s.restores.length,0);
});
test('secure receipt rejects incomplete or duplicate server acknowledgements without direct-write fallback',async()=>{
 const start=html.indexOf('    const rawCommit = window.FEATURE_GOOGLE_AUTH'),end=html.indexOf('    const commitPromise =',start),source=html.slice(start,end)+'rawCommit;';
 for(const result of [undefined,{ok:false},{ok:true,logIds:['a']},{ok:true,logIds:['a','a']},{ok:true,logIds:['a','wrong']}]){
  const context={window:{FEATURE_GOOGLE_AUTH:true},broadcast:[{code:'TEST',logId:'a'},{code:'TEST2',logId:'b'}],submission:{workouts:['Walk'],day:20,month:9,year:2026},callFunction:async()=>result,batch:{commit(){throw Error('FORBIDDEN_DIRECT_WRITE');}}};
  await assert.rejects(vm.runInNewContext(source,context),/GROUP_SAVE_ACK_INVALID/);
 }
});
test('secure save sends only workout content and destination IDs, not claimed ownership',async()=>{
 const start=html.indexOf('    const rawCommit = window.FEATURE_GOOGLE_AUTH'),end=html.indexOf('    const commitPromise =',start);let sent;
 const context={window:{FEATURE_GOOGLE_AUTH:true},broadcast:[{code:'TEST',logId:'a',player:'Forged',team:'Z',userId:'victim'}],submission:{workouts:['Walk'],day:20,month:9,year:2026},callFunction:async(name,data)=>{sent={name,data};return {ok:true,logIds:['a']};},batch:{commit(){throw Error('FORBIDDEN_DIRECT_WRITE');}}};
 await vm.runInNewContext(html.slice(start,end)+'rawCommit;',context);assert.equal(sent.name,'saveGroupWorkout');assert.deepEqual(Object.keys(sent.data.targets[0]).sort(),['code','logId']);assert.ok(!('userId' in sent.data));
});
