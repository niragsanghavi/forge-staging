import test from 'node:test';
import assert from 'node:assert/strict';
import {runtime,flush} from './solo-dom.mjs';
import {createRequire} from 'node:module';
const makeSolo=createRequire(import.meta.url)('../functions-identity/solo-service.js');
test('Tuesday Solo window includes last Tuesday, excludes Monday, and preserves history',async()=>{
 const h=runtime({logs:[{year:2026,month:9,day:14,workouts:['Yoga'],note:'Older history'}]});
 await h.w.ForgeSolo.open();
 h.w.ForgeSolo.edit(15);assert.ok(h.d.querySelector('dialog form'));
 h.d.querySelector('dialog').close();
 h.w.ForgeSolo.edit(14);assert.equal(h.d.querySelector('dialog form'),null);
 assert.match(h.d.querySelector('dialog').textContent,/Older history/);
 assert.match(h.d.querySelector('dialog').textContent,/read-only/);h.close();
});
test('Solo server enforces inclusive seven-day lookback using IST, including midnight and month seams',async()=>{
 for(const [clock,data,allowed] of [
  ['2026-09-22T06:00:00Z',{year:2026,month:9,day:15},true],
  ['2026-09-22T06:00:00Z',{year:2026,month:9,day:14},false],
  ['2026-09-22T06:00:00Z',{year:2026,month:9,day:22},true],
  ['2026-09-22T06:00:00Z',{year:2026,month:9,day:23},false],
  ['2026-09-21T18:29:59Z',{year:2026,month:9,day:14},true],
  ['2026-09-21T18:30:00Z',{year:2026,month:9,day:14},false],
  ['2026-09-30T18:30:00Z',{year:2026,month:10,day:1},true],
  ['2026-09-30T18:30:00Z',{year:2026,month:9,day:30},false]
 ]){
  let transaction=false;
  const db={collection:name=>({doc:()=>({
   get:async()=>({exists:true,data:()=>name==='authIdentities'?{userId:'profile'}:{authUid:'actor',soloEnabled:true}}),
   collection:()=>({doc:()=>({})})
  })}),runTransaction:async()=>{transaction=true;return {ok:true};}};
  class Failure extends Error{constructor(code,message){super(message);this.code=code;}}
  const service=makeSolo({db,FieldValue:{},HttpsError:Failure,identity:{actor:()=>({uid:'actor'})},now:()=>Date.parse(clock)});
  const action=service.save({data:{...data,workouts:['Walk']}});
  if(allowed)assert.equal((await action).ok,true);
  else await assert.rejects(action,e=>e.code==='invalid-argument');
  assert.equal(transaction,allowed,clock+' '+JSON.stringify(data));
 }
});
test('solo has three real destinations and Profile, not a single placeholder page',async()=>{
 const h=runtime();await h.w.ForgeSolo.open();assert.equal(h.d.querySelectorAll('[data-solo-tab]').length,3);
 for(const [tab,text] of [['history','The work you put in.'],['board','Your own lane. Good company.'],['profile','Test Athlete'],['today','Your month. Your pace.']]){
 h.w.ForgeSolo.selectTab(tab);await flush();assert.ok(h.d.querySelector('#soloContent').textContent.includes(text));}
 h.close();
});
test('calendar shows first activity plus count, not overlapping workout marks',async()=>{
 const h=runtime();await h.w.ForgeSolo.open();const day=h.d.querySelector('.solo-day[aria-label*="20 September"]');
 assert.equal(day.querySelectorAll('.forge-sport').length,1);assert.equal(day.querySelector('small').textContent,'+1');assert.match(day.getAttribute('aria-label'),/Walk, Yoga/);h.close();
});
test('past months are inspectable but read-only; future days cannot open logging',async()=>{
 const h=runtime();await h.w.ForgeSolo.open({year:2026,month:8});h.w.ForgeSolo.edit(1);
 assert.match(h.d.querySelector('dialog').textContent,/read-only/);assert.equal(h.d.querySelector('dialog form'),null);
 await h.w.ForgeSolo.open();h.w.ForgeSolo.edit(23);assert.equal(h.d.querySelector('dialog'),null);h.close();
});
test('new sign-in does not enroll solo, and recovery remains visible before enrollment',async()=>{
 const h=runtime({enrolled:false,hasProfile:false});await h.w.ForgeSolo.open();
 assert.ok(h.button('Recover my group profile'));assert.ok(h.button('Start my solo calendar'));assert.equal(h.calls.some(c=>c.name==='enrollSolo'),false);h.close();
});
test('provider buttons share one row with official images and accessible names',()=>{
 const h=runtime(),row=h.d.querySelector('#forgeWelcomeProviders .forge-provider-row');assert.equal(row.children.length,2);
 for(const name of ['Google','Apple'])assert.ok(h.button('Continue with '+name,row).querySelector('img'));
 h.close();
});
test('generic provider sign-in restores identity and never silently opens/enrolls solo',async()=>{
 const h=runtime();await h.w.ForgeWelcome.enter('google.com');assert.equal(h.calls.at(-1).name,'restore');assert.equal(h.calls.at(-1).welcome,true);
 assert.equal(h.calls.some(c=>c.name==='enrollSolo'),false);h.close();
});
test('workout save is owner-scoped, deduplicated while pending, with server-confirmed receipt',async()=>{
 let finish;const h=runtime({call:async(name)=>name==='saveSolo'?new Promise(r=>finish=r):undefined});
 await h.w.ForgeSolo.open();h.w.ForgeSolo.edit(22,'Walk');const form=h.d.querySelector('dialog form');
 const p=form.onsubmit({preventDefault(){}});await form.onsubmit({preventDefault(){}});await flush();
 assert.equal(h.calls.filter(c=>c.name==='saveSolo').length,1);assert.equal(h.calls.find(c=>c.name==='saveSolo').data.groupCode,undefined);
 finish({ok:true,score:{total:18}});await p;assert.match(h.d.querySelector('.solo-receipt').textContent,/\+7 points/);h.close();
});
test('an uncertain save keeps the workout draft and does not display success',async()=>{
 const h=runtime({call:async name=>{if(name==='saveSolo')throw Error('offline');}});await h.w.ForgeSolo.open();h.w.ForgeSolo.edit(22,'Yoga');
 const form=h.d.querySelector('dialog form');form.querySelector('textarea').value='Keep this draft';
 await form.onsubmit({preventDefault(){}});assert.equal(form.querySelector('textarea').value,'Keep this draft');assert.match(form.textContent,/Save not confirmed/);assert.equal(h.d.querySelector('.solo-receipt'),null);h.close();
});
test('stale responses cannot expose another account history',async()=>{
 let finish;const h=runtime({call:async name=>name==='getSolo'?new Promise(r=>finish=r):undefined});const p=h.w.ForgeSolo.open();
 await flush();h.w.auth.currentUser.uid='different';finish(h.data({}));await p;assert.doesNotMatch(h.d.querySelector('#soloContent').textContent,/Test Athlete/);h.close();
});
test('same-name leaderboard rows do not both get marked as you',async()=>{
 const h=runtime();await h.w.ForgeSolo.open();h.w.ForgeSolo.selectTab('board');await flush();
 assert.equal(h.d.querySelectorAll('.solo-board-row.is-you').length,1);assert.equal(h.d.querySelector('.solo-board-row.is-you').dataset.rank,'2');h.close();
});
test('visibility failures restore the confirmed choice rather than pretend success',async()=>{
 const h=runtime({call:async name=>{if(name==='setSoloVisibility')throw Error('offline');}});
 await h.w.ForgeSolo.open();h.w.ForgeSolo.selectTab('profile');const check=h.d.querySelector('#soloContent input[type=checkbox]');check.checked=true;await check.onchange();assert.equal(check.checked,false);assert.match(h.d.querySelector('#soloStatus').textContent,/not confirmed/);h.close();
});
test('history renders notes literally and gym selections change the shared body map',async()=>{
 const h=runtime();h.records[0].note='<img src=x onerror=evil()>';await h.w.ForgeSolo.open();h.w.ForgeSolo.selectTab('history');
 assert.ok(h.d.querySelector('#soloContent').textContent.includes('<img src=x onerror=evil()>'));assert.equal(h.d.querySelector('img[src=x]'),null);
 h.w.ForgeSolo.edit(21);assert.ok(h.d.querySelector('.solo-body-map svg'));assert.equal(h.d.querySelector('.solo-muscle-choice[data-muscle=Chest]').getAttribute('aria-pressed'),'true');h.close();
});
test('weekly recap sums canonical daily scores without resetting the week streak',async()=>{
 const h=runtime();await h.w.ForgeSolo.open();h.w.ForgeSolo.selectTab('profile');h.button('Weekly recap').onclick();
 assert.match(h.d.querySelector('dialog').textContent,/6points earned/);h.close();
});
test('all-time errors never masquerade as complete lifetime totals',async()=>{
 const h=runtime({months:['2026-08','2026-09'],call:async(name,data)=>{if(name==='getSolo'&&data.month===8)throw Error('offline');}});await h.w.ForgeSolo.open();
 h.w.ForgeSolo.selectTab('profile');h.button('All-time solo record').onclick();await flush();
 assert.match(h.d.querySelector('dialog').textContent,/No incomplete total/);h.close();
});
test('a failed month load hides old records and offers retry',async()=>{
 const h=runtime({call:async(name,data)=>{if(name==='getSolo'&&data.month===8)throw Error('offline');}});await h.w.ForgeSolo.open();await h.w.ForgeSolo.open({year:2026,month:8});
 assert.equal(h.d.querySelectorAll('.solo-day').length,0);assert.ok(h.button('Try again'));assert.match(h.d.querySelector('#soloStatus').textContent,/could not load/);h.close();
});
test('provider double clicks and mode changes cannot redirect the pending sign-in',async()=>{
 let done;const h=runtime({signIn:()=>new Promise(r=>done=r)});
 const pending=h.w.ForgeWelcome.enter('google.com');await h.w.ForgeWelcome.enter('apple.com');h.w.ForgeWelcome.choose('solo');
 assert.equal(h.calls.filter(c=>c.name==='signIn').length,1);done({uid:'owner'});await pending;assert.equal(h.calls.at(-1).name,'restore');h.close();
});
test('filtering history keeps keyboard focus on the replacement filter',async()=>{
 const h=runtime();await h.w.ForgeSolo.open();h.w.ForgeSolo.selectTab('history');const select=h.d.querySelector('#soloContent select');select.value='Gym';select.onchange();
 assert.equal(h.d.activeElement.tagName,'SELECT');assert.equal(h.d.querySelectorAll('.solo-history-row').length,1);h.close();
});
test('an unconfirmed privacy response cannot report public success',async()=>{
 const h=runtime({call:async name=>name==='setSoloVisibility'?{ok:false}:undefined});await h.w.ForgeSolo.open();h.w.ForgeSolo.selectTab('profile');
 const c=h.d.querySelector('#soloContent input');c.checked=true;await c.onchange();assert.equal(c.checked,false);assert.match(h.d.querySelector('#soloStatus').textContent,/not confirmed/);h.close();
});
test('a linked account choosing Solo from a signed-out device does not need recovery again',async()=>{
 const h=runtime({call:async name=>name==='getSolo'?{enrolled:false,hasProfile:true,hasGroups:true,name:'Already Linked'}:undefined});
 h.w.getSessions=()=>[];
 await h.w.ForgeSolo.open();assert.match(h.d.querySelector('#soloContent').textContent,/already linked/);assert.equal(h.d.querySelector('#soloContent input').value,'Already Linked');
 h.button('SoloChange mode ›').onclick();h.button('My groups').onclick();assert.equal(h.calls.at(-1).name,'restore');h.close();
});
test('refresh reloads the selected month without changing the selected destination',async()=>{
 const h=runtime();await h.w.ForgeSolo.open({year:2026,month:8},'history');await h.button('Refresh solo calendar').onclick();
 const call=h.calls.filter(c=>c.name==='getSolo').at(-1);assert.equal(call.data.month,8);assert.match(h.d.querySelector('#soloContent').textContent,/The work you put in/);h.close();
});
