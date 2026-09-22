// npm test — sign-in buttons exercise the shipped provider helper, with the
// external Firebase popup transport stubbed. No account or network writes.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {runtime} from './solo-dom.mjs';
const config=fs.readFileSync(new URL('../src/config/firebase.js',import.meta.url),'utf8');
const bridge=config.slice(config.indexOf('window.googleProvider ='),config.indexOf('window.confirmForgeAccountDeletion ='));
function providerBridge(h,popup){
 class Google {constructor(){this.providerId='google.com';}setCustomParameters(p){this.parameters=p;}}
 class OAuth {constructor(id){this.providerId=id;this.scopes=[];}addScope(s){this.scopes.push(s);}}
 h.w.firebase={auth:{GoogleAuthProvider:Google,OAuthProvider:OAuth}};
 h.w.auth.signInWithPopup=async provider=>{
  h.calls.push({name:'popup',provider:provider.providerId,scopes:provider.scopes,parameters:provider.parameters});
  if(popup)return popup(provider);
  h.w.auth.currentUser={uid:'provider-owner',isAnonymous:false,providerData:[{providerId:provider.providerId}]};
  return {user:h.w.auth.currentUser};
 };
 h.w.eval(bridge);
}
for(const [label,provider]of [['Google','google.com'],['Apple','apple.com']])test(label+' button on signed-out Solo reaches the actual provider bridge and opens the calendar',async()=>{
 const h=runtime();h.w.auth.currentUser=null;providerBridge(h);await h.w.ForgeSolo.open();
 await h.button('Continue with '+label,h.d.querySelector('#soloRoot')).onclick();
 const popup=h.calls.find(c=>c.name==='popup');assert.equal(popup.provider,provider);
 if(label==='Google')assert.equal(popup.parameters.prompt,'select_account');else assert.deepEqual(Array.from(popup.scopes),['email','name']);
 assert.equal(h.d.querySelectorAll('[data-solo-tab]').length,3);assert.ok(h.calls.some(c=>c.name==='getSolo'));
 assert.ok(!h.calls.some(c=>c.name==='enrollSolo'));h.close();
});
for(const [code,message]of [['auth/popup-blocked',/browser blocked/],['auth/popup-closed-by-user',/window closed/],['auth/network-request-failed',/internet connection/],['auth/unauthorized-domain',/not enabled for this web address/],['auth/operation-not-allowed',/provider is not available/]])test('Solo exposes actionable '+code+' and re-enables both buttons',async()=>{
 const h=runtime();h.w.auth.currentUser=null;providerBridge(h,async()=>{throw Object.assign(Error('test'),{code});});await h.w.ForgeSolo.open();
 await h.button('Continue with Google',h.d.querySelector('#soloRoot')).onclick();
 assert.match(h.d.querySelector('#soloStatus').textContent,message);
 assert.equal(h.d.querySelectorAll('#soloRoot .forge-provider-button:disabled').length,0);assert.equal(h.w._forgeProviderBusy,false);
 assert.ok(!h.calls.some(c=>c.name==='getSolo'));h.close();
});
test('the signed-out screen shows pending state and blocks duplicate popup requests',async()=>{
 let finish;const h=runtime();h.w.auth.currentUser=null;providerBridge(h,()=>new Promise(r=>finish=r));await h.w.ForgeSolo.open();
 const row=h.d.querySelector('#soloRoot .forge-provider-row');const p=h.button('Continue with Google',row).onclick();
 assert.match(h.d.querySelector('#soloStatus').textContent,/Opening Google/);assert.equal(row.querySelectorAll(':disabled').length,2);
 await h.button('Continue with Apple',row).onclick();assert.equal(h.calls.filter(c=>c.name==='popup').length,1);
 h.w.auth.currentUser={uid:'ready',isAnonymous:false};finish({user:h.w.auth.currentUser});await p;assert.ok(h.d.querySelector('.solo-calendar'));h.close();
});
test('an auth result without a matching active user is an explicit error, not a silent dead end',async()=>{
 const h=runtime();h.w.auth.currentUser=null;providerBridge(h,async()=>({user:{uid:'not-current'}}));await h.w.ForgeSolo.open();
 await h.button('Continue with Google',h.d.querySelector('#soloRoot')).onclick();assert.match(h.d.querySelector('#soloStatus').textContent,/sign-in changed/);h.close();
});
test('welcome reports popup failure too, without enrolling or restoring anyone',async()=>{
 const h=runtime();providerBridge(h,async()=>{throw Object.assign(Error('blocked'),{code:'auth/popup-blocked'});});
 await h.button('Continue with Apple',h.d.querySelector('#forgeWelcomeProviders')).onclick();
 assert.match(h.d.querySelector('#forgeWelcomeStatus').textContent,/browser blocked/);assert.ok(!h.calls.some(c=>['enrollSolo','restore'].includes(c.name)));h.close();
});
test('group Profile and Your groups offer no Solo entry',()=>{
 const h=runtime();h.w.getSessions=()=>[{code:'GROUP1',name:'My group',player:{name:'Member'}}];h.w.groupCode='GROUP1';h.w.me={name:'Member'};
 assert.equal(h.d.querySelector('#page-profile [onclick*="ForgeSolo"]'),null);
 h.w.ForgeToday.openGroups();assert.doesNotMatch(h.d.querySelector('dialog').textContent,/solo/i);assert.ok(h.button('Sign out of Forge'));h.close();
});
test('a stale Solo link cannot open or enroll from an active PIN or provider group session',async()=>{
 for(const anonymous of [true,false]){
  const h=runtime();h.w.auth.currentUser.isAnonymous=anonymous;h.w.me={name:'Member'};h.w.groupCode='GROUP1';h.w.getSessions=()=>[{code:'GROUP1',player:h.w.me}];h.w.showScreen('app');
  await h.w.ForgeSolo.open();assert.equal(h.d.querySelector('#screen-app').classList.contains('active'),true);assert.equal(h.calls.length,0);
  h.w.ForgeWelcome.choose('solo');await h.w.ForgeWelcome.enter('google.com');assert.ok(!h.calls.some(c=>c.name==='enrollSolo'));h.close();
 }
});
test('join-another-group hides Solo and clearing the local group session restores it',()=>{
 const h=runtime();let sessions=[{code:'GROUP1',player:{name:'Member'}}];h.w.getSessions=()=>sessions;
 h.w.ForgeWelcome.syncGroupChoices();assert.equal(h.d.querySelector('[data-forge-mode=solo]').hidden,true);assert.equal(h.d.querySelector('[data-solo-entry]').hidden,true);
 sessions=[];h.w.ForgeWelcome.syncGroupChoices();assert.equal(h.d.querySelector('[data-forge-mode=solo]').hidden,false);assert.equal(h.w.ForgeWelcome.allowSolo(),true);h.close();
});
const html=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
const signOutSource=html.slice(html.indexOf('async function signOutForgeDevice(){'),html.indexOf('\nfunction promptSwitch(){'));
function logoutFixture({reject=false,pending=false}={}){
 const events=[],saved=new Map([['forge_sessions','stored'],['forge_active','GROUP1'],['forge_session','legacy']]);let finish;
 const c={console,_forgeLogReceipt:pending?{state:'pending'}:null,me:{name:'Member'},groupCode:'GROUP1',groupData:{},season:{},seasonId:'2026-09',unsub:[()=>events.push('unsubscribe')],auth:{signOut:()=>new Promise((resolve,rejectFn)=>{events.push('signOut');finish=()=>reject?rejectFn(Error('offline')):resolve();})},localStorage:{removeItem:k=>saved.delete(k)},location:{reload:()=>events.push('reload')},_invalidateGroupContext:()=>events.push('invalidate'),toast:m=>events.push(m)};
 c.window=c;vm.createContext(c);vm.runInContext(signOutSource,c);return {c,events,saved,finish:()=>finish()};
}
test('full sign-out clears all group sessions only after Firebase sign-out succeeds',async()=>{
 const h=logoutFixture(),p=h.c.signOutForgeDevice();assert.equal(h.saved.size,3);assert.deepEqual(h.events,['signOut']);
 h.finish();await p;assert.equal(h.saved.size,0);assert.equal(h.c.me,null);assert.equal(h.c.groupCode,null);assert.ok(h.events.includes('unsubscribe'));assert.equal(h.events.at(-1),'reload');
});
test('failed sign-out retains the group session and shows an error rather than permitting a silent switch',async()=>{
 const h=logoutFixture({reject:true}),p=h.c.signOutForgeDevice();h.finish();await p;
 assert.equal(h.saved.size,3);assert.ok(h.c.me);assert.ok(!h.events.includes('reload'));assert.match(h.events.at(-1),/did not finish/);
});
test('pending workout saves block full sign-out',async()=>{
 const h=logoutFixture({pending:true});await h.c.signOutForgeDevice();assert.equal(h.saved.size,3);assert.ok(!h.events.includes('signOut'));assert.match(h.events[0],/workout save/);
});
