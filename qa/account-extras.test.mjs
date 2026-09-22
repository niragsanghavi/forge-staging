import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import {runtime,flush} from './solo-dom.mjs';
const code=fs.readFileSync(new URL('../src/ui/account-extras.js',import.meta.url),'utf8');
function lab(options){const h=runtime(options);h.w.ForgeToday.openDialog=(title,body)=>{h.d.querySelector('[data-extra]')?.remove();const host=h.d.createElement('div');host.dataset.extra='';host.append(body);h.d.body.append(host);};h.w.eval(code);return h;}
const review={operationId:'review',groupName:'New group',seasonId:'2026-09',rows:[{key:'old',day:1,workouts:['Walk'],sourceGroup:'FROM',already:true},{key:'new',day:2,workouts:['Yoga'],sourceGroup:'FROM',already:false}]};
test('copy review never writes without explicit confirmation and skips preexisting records',async()=>{
 const h=lab({call:async n=>n==='previewGroupImport'?review:{created:1,skipped:0}});await h.w.ForgeAccountExtras.copyMonth('NEXT');
 assert.equal(h.calls.filter(x=>x.name==='copyCurrentMonthWorkouts').length,0);const boxes=h.d.querySelectorAll('[data-extra] input');assert.equal(boxes[0].disabled,true);assert.equal(boxes[1].checked,true);
 h.button('Copy selected workouts').click();await flush();assert.equal(h.calls.filter(x=>x.name==='copyCurrentMonthWorkouts').length,1);assert.match(h.d.body.textContent,/1 copied/);h.close();
});
test('account switch while preview loads cannot paint or offer copying',async()=>{
 let resolve;const h=lab({call:()=>new Promise(r=>resolve=r)});const pending=h.w.ForgeAccountExtras.copyMonth('NEXT');h.w.auth.currentUser={uid:'other',isAnonymous:false};resolve(review);await pending;assert.equal(h.d.querySelectorAll('[data-extra] input').length,0);h.close();
});
test('Solo notifications wait for saved server registration and report save failure honestly',async()=>{
 const h=lab({call:async()=>{throw Error('Save failed');}});h.w.FEATURE_PUSH=true;h.w.pushSupported=()=>true;h.w.enablePush=async()=> 'device_token_abcdefghijklmnop';h.w.ForgeFeedback={notification:()=> 'Registration could not be saved.'};
 h.w.ForgeAccountExtras.notifications();h.button('Turn on notifications').click();await flush();assert.match(h.d.body.textContent,/Registration could not be saved/);assert.doesNotMatch(h.d.body.textContent,/Notifications on for this device/);assert.ok(h.button('Turn on notifications'));h.close();
});
test('Solo notification enable then disable uses account callable, never group globals',async()=>{
 const h=lab({call:async(n,d)=>({ok:true,registered:d.mode==='enable'})});h.w.FEATURE_PUSH=true;h.w.pushSupported=()=>true;h.w.enablePush=async()=> 'device_token_abcdefghijklmnop';
 h.w.ForgeAccountExtras.notifications();h.button('Turn on notifications').click();await flush();assert.match(h.d.body.textContent,/Notifications on for this device/);h.button('Turn off on this device').click();await flush();assert.match(h.d.body.textContent,/Notifications off for this device/);assert.equal(h.calls.filter(x=>x.name==='manageDeviceRegistration').length,2);h.close();
});

