// npm test — actual UI handlers, fictional profiles and mocked transport only.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import {runtime,flush} from './solo-dom.mjs';
const html=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
const config=fs.readFileSync(new URL('../src/config/firebase.js',import.meta.url),'utf8');
const slice=(from,to)=>html.slice(html.indexOf(from),html.indexOf(to,html.indexOf(from)));
function profile(h){h.w.me={name:'Legacy',userId:'legacy'};h.w.groupCode='TEST';h.w._claimPending={uid:'owner',userId:'legacy',groupCode:'TEST'};h.w.toast=()=>{};h.w.logErr=()=>{};h.w.mirIco=()=>'';return h.w._claimPending;}
for(const anonymous of [null,{uid:'anon',isAnonymous:true}])test('welcome Solo opens a visible sign-in screen before authentication '+!!anonymous,async()=>{
 const h=runtime();h.w.auth.currentUser=anonymous;await h.w.ForgeWelcome.choose('solo');
 assert.equal(h.d.querySelector('#screen-solo').classList.contains('active'),true);assert.equal(h.d.querySelectorAll('#soloRoot .forge-provider-button').length,2);assert.equal(h.calls.length,0);h.close();
});
for(const [code,message,kind]of [
 ['functions/permission-denied','This sign-in already belongs to another Forge profile.','recover'],
 ['functions/permission-denied','This profile is already linked. Sign in with its linked account.','linked'],
 ['functions/permission-denied','Could not confirm this profile. Check your PIN.','pin'],
 ['functions/resource-exhausted','Too many attempts for this profile. Try again in an hour.','retry-later'],
 ['functions/unauthenticated','Sign in again to confirm this change.','reauth'],
 ['functions/unavailable','Server unreachable','network'],
 ['functions/failed-precondition','Historical ownership needs repair.','support']
])test('account feedback distinguishes '+kind,()=>{const h=runtime();assert.equal(h.w.ForgeFeedback.claim({code,message}).kind,kind);h.close();});
test('claim handler offers explicit recovery for existing owner and clears PIN',async()=>{
 const h=runtime({call:async name=>{if(name==='claimIdentity')throw {code:'functions/permission-denied',message:'This sign-in already belongs to another Forge profile.'};}});
 profile(h);h.w.eval(slice('function renderGoogleAuthCard(){','// Fresh device:'));h.w.renderGoogleAuthCard();
 h.d.querySelector('#claimPinInput').value=String(crypto.randomInt(1000,10000));await h.w.submitGoogleClaim();
 assert.match(h.d.querySelector('#googleAuthResult').textContent,/already connected/);assert.equal(h.d.querySelector('#claimPinInput').value,'');
 h.button('Review bringing back my group profile').click();assert.ok(h.d.querySelector('dialog'));assert.ok(!h.calls.some(c=>c.name==='linkLegacyGroup'));h.close();
});
test('recovery sends deployed name/group/PIN contract only after explicit confirmation',async()=>{
 const h=runtime();const pending=profile(h);h.w.ForgeAccountRecovery.open(pending);
 assert.equal(h.calls.length,0);h.d.querySelector('#recoverGroupPin').value=String(crypto.randomInt(1000,10000));
 await h.button('Confirm and bring back my history').onclick();const call=h.calls.find(c=>c.name==='linkLegacyGroup');
 assert.deepEqual(Object.keys(call.data).sort(),['groupCode','name','pin']);assert.equal(call.data.name,'Legacy');assert.equal(call.data.groupCode,'TEST');assert.ok(h.calls.some(c=>c.name==='restore'));h.close();
});
test('recovery rejects changed sign-in and never automatically merges',async()=>{
 const h=runtime();h.w.ForgeAccountRecovery.open(profile(h));h.d.querySelector('#recoverGroupPin').value=String(crypto.randomInt(1000,10000));h.w.auth.currentUser.uid='someone-else';
 await h.button('Confirm and bring back my history').onclick();assert.equal(h.calls.length,0);assert.match(h.d.querySelector('dialog').textContent,/active account changed/);h.close();
});
test('wrong recovery PIN leaves history alone, clears input and allows retry',async()=>{
 const h=runtime({call:async name=>{if(name==='linkLegacyGroup')throw {code:'functions/permission-denied',message:'Could not confirm this profile. Check your PIN.'};}});
 h.w.ForgeAccountRecovery.open(profile(h));h.d.querySelector('#recoverGroupPin').value=String(crypto.randomInt(1000,10000));await h.button('Confirm and bring back my history').onclick();
 assert.equal(h.d.querySelector('#recoverGroupPin').value,'');assert.match(h.d.querySelector('dialog').textContent,/PIN could not confirm/);assert.ok(!h.calls.some(c=>c.name==='restore'));assert.equal(h.button('Confirm and bring back my history').disabled,false);h.close();
});
function pushUI(h){
 profile(h);h.w.FEATURE_PUSH=true;h.w.pushSupported=()=>true;h.w.pushPermission=()=> 'granted';h.w.startForegroundPush=()=>{};h.w.forgePushDeadline=p=>p;
 h.w.firebase={firestore:{FieldValue:{serverTimestamp:()=>1,delete:()=>null}}};
 h.w.eval(slice('function renderPushCard(){','// ── GOOGLE SIGN-IN'));h.w.renderPushCard();
}
test('notification success waits for the profile save acknowledgment',async()=>{
 const h=runtime();pushUI(h);let save;h.w.enablePush=async progress=>{progress('Permission allowed. Registering this device…');return 'fictional-device';};
 h.w.db={collection:()=>({doc:()=>({set:()=>new Promise(r=>save=r)})})};
 const promise=h.w.turnOnPush();await flush();assert.equal(h.w._myPushToken,undefined);assert.match(h.d.querySelector('#pushResult').textContent,/Saving/);assert.equal(h.d.querySelector('#pushBtn').disabled,true);
 save();await promise;assert.match(h.d.querySelector('#pushCard').textContent,/Notifications on/);assert.equal(h.w.localStorage.getItem('forgePushEnabled'),'1');h.close();
});
test('denied profile save is specific, does not claim enabled and restores button',async()=>{
 const h=runtime();pushUI(h);h.w.enablePush=async()=> 'fictional-device';h.w.db={collection:()=>({doc:()=>({set:async()=>{throw {code:'permission-denied'};}})})};
 await h.w.turnOnPush();assert.equal(h.w._myPushToken,undefined);assert.equal(h.w.localStorage.getItem('forgePushEnabled'),null);assert.match(h.d.querySelector('#pushResult').textContent,/could not save/);assert.equal(h.d.querySelector('#pushBtn').disabled,false);h.close();
});
test('profile changes during permission do not save a token to the new profile',async()=>{
 const h=runtime();pushUI(h);let accept,writes=0;h.w.enablePush=()=>new Promise(r=>accept=r);h.w.db={collection:()=>({doc:()=>({set:async()=>writes++})})};
 const pending=h.w.turnOnPush();h.w.me.userId='different';accept('fictional-device');await pending;assert.equal(writes,0);assert.equal(h.w._forgePushBusy,false);h.close();
});
test('SDK permission granted plus missing token is a registration error, not a refusal',async()=>{
 const h=runtime();h.w.FEATURE_PUSH=true;h.w.pushSupported=()=>true;h.w.Notification={requestPermission:async()=> 'granted'};
 const src=config.slice(config.indexOf('window.enablePush ='),config.indexOf('// Foreground messages'));
 h.w.forgePushDeadline=p=>p;h.w._loadMessaging=async()=>({getToken:async()=>null});h.w._messagingSW=async()=>({});h.w._dropForeignPushSubscription=async()=>{};h.w.eval(src);
 let progress='';await assert.rejects(h.w.enablePush(text=>progress=text),/PUSH_NO_TOKEN/);assert.match(progress,/Permission allowed/);h.close();
});
test('notification deadline settles stalled registration instead of hanging',async()=>{
 const h=runtime();h.w.eval(config.slice(config.indexOf('window.forgePushDeadline ='),config.indexOf('let _nativePushPermission')));
 await assert.rejects(h.w.forgePushDeadline(new Promise(()=>{}),2),/PUSH_TIMEOUT/);h.close();
});
test('group cleanup requires verified server admin and exact typed confirmation',async()=>{
 const h=runtime({call:async name=>name==='getAdminAccess'?{superadmin:true}:name==='previewGroupArchive'?{name:'Fictional',groupCode:'TEST',members:1,workoutRecords:4,revision:'revision',archived:false}:name==='setGroupArchived'?{ok:true}:undefined});
 profile(h);h.w.loadSuperAdmin=async()=>{};await h.w.ForgeGroupCleanup.open('TEST');
 const button=h.button('Archive group');assert.equal(button.disabled,true);await button.onclick();assert.ok(!h.calls.some(c=>c.name==='setGroupArchived'));
 const input=h.d.querySelector('#archiveConfirmCode');input.value='TEST';input.oninput();await button.onclick();assert.equal(h.calls.filter(c=>c.name==='setGroupArchived').length,1);h.close();
});
test('old admin PIN and client state cannot bypass verified server authorization',async()=>{
 const h=runtime({call:async name=>name==='getAdminAccess'?{superadmin:false}:undefined});profile(h);await h.w.ForgeGroupCleanup.open('TEST');
 assert.match(h.d.querySelector('dialog').textContent,/does not have verified/);assert.ok(!h.calls.some(c=>c.name==='previewGroupArchive'));h.close();
});
test('branding, full-size guide button and focused device-settings tour target are wired',()=>{
 const h=runtime();assert.equal(h.d.querySelector('.forge-new-here').getAttribute('href'),'guide.html');assert.equal(h.d.querySelector('.forge-brand-link').getAttribute('href'),'branding.html');
 assert.ok(h.d.querySelector('#forgeDeviceSettings #pushCard'));assert.ok(h.d.querySelector('#forgeDeviceSettings #healthCard'));
 assert.match(html,/t:'#forgeDeviceSettings'.*Make Forge work for you/);assert.ok(fs.existsSync(new URL('../branding.html',import.meta.url)));h.close();
});
test('hardcoded campaign is replaced with the published announcement channel',()=>{
 const h=runtime();let renders=0;h.w.ForgeAnnouncements={render:()=>renders++};h.w.eval(slice('function renderAnnounceCard(){','function dismissAnnounce()'));
 h.w.renderAnnounceCard();assert.equal(renders,1);assert.doesNotMatch(html,/const ANNOUNCE_KEY=/);h.close();
});
