import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {runtime,flush} from './solo-dom.mjs';
const code=fs.readFileSync(new URL('../src/ui/release-features.js',import.meta.url),'utf8');
function lab(options){
 const h=runtime(options);h.w.me={userId:'person',name:'Tester'};
 h.w.ForgeToday.openDialog=(title,body)=>{h.d.querySelector('[data-feature-dialog]')?.remove();const box=h.d.createElement('div');box.dataset.featureDialog='';box.append(body);h.d.body.append(box);};
 h.w.ForgeToday.closeDialog=()=>h.d.querySelector('[data-feature-dialog]')?.remove();
 h.w.eval(code);return h;
}
const published={id:'one',title:'Hello <script>',message:'Plain <img src=x onerror=alert(1)>',action:'store',webStore:'none',expiresAt:Date.now()+3600000};
test('announcement reads deduplicate across groups and solo; flag-off works; content is literal',async()=>{
 const h=lab({call:async name=>name==='getPublishedAnnouncement'?{announcement:published}:undefined});h.w.FEATURE_GOOGLE_AUTH=false;
 const a=h.d.createElement('div'),b=h.d.createElement('div');h.d.body.append(a,b);
 await Promise.all([h.w.ForgeAnnouncements.render(a),h.w.ForgeAnnouncements.render(b)]);assert.equal(h.calls.filter(c=>c.name==='getPublishedAnnouncement').length,1);
 assert.match(a.textContent,/Hello <script>/);assert.equal(a.querySelector('script,img'),null);assert.equal(a.querySelector('a'),null);h.close();
});
test('dismissal is announcement-specific; native platform controls store links without UA',async()=>{
 let a=published;const h=lab({call:async name=>name==='getPublishedAnnouncement'?{announcement:a}:undefined}),host=h.d.querySelector('#announceCard');
 let now=Date.now();h.w.Date.now=()=>now;
 await h.w.ForgeAnnouncements.render(host);h.button('Got it',host).click();await flush();assert.equal(host.children.length,0);
 now+=121000;a={...published,id:'two'};await h.w.ForgeAnnouncements.render(host);assert.match(host.textContent,/Hello/);
 for(const [platform,part]of [['ios','id6802334800'],['android','in.goforge.app']]){h.w.Capacitor={isNativePlatform:()=>true,getPlatform:()=>platform};assert.ok(h.w.ForgeAnnouncements.storeUrl(a).includes(part));}
 h.w.Capacitor={isNativePlatform:()=>false,getPlatform:()=> 'ios'};assert.equal(h.w.ForgeAnnouncements.storeUrl(a),null);h.close();
});
test('removal requires visible review and explicit confirmation, with selected IDs only',async()=>{
 const rows=['a','b'].map((id,i)=>({logId:id,groupCode:'GROUP'+i,groupName:'Group '+i,year:2026,month:9,day:22,workouts:['Walk'],note:'My note'}));
 const h=lab({call:async(name,data)=>name==='previewWorkoutRemoval'?{operationId:'review',mode:'inferred',rows,unavailable:[]}:name==='removeWorkoutsEverywhere'?{ok:true,results:[{groupCode:'GROUP0',ok:true,logs:[{logId:'a',status:'removed'}]}]}:undefined});
 await h.w.ForgeRemoval.open('a');assert.equal(h.calls.length,0);
 h.button('Review all my groups').click();await flush();assert.match(h.d.querySelector('[data-feature-dialog]').textContent,/matched by your profile/);
 assert.equal(h.calls.some(c=>c.name==='removeWorkoutsEverywhere'),false);
 h.d.querySelectorAll('[data-feature-dialog] input')[1].checked=false;h.button('Confirm removal of selected entries').click();await flush();
 const sent=h.calls.find(c=>c.name==='removeWorkoutsEverywhere');assert.deepEqual(sent.data.logIds,['a']);assert.match(h.d.querySelector('[data-feature-dialog]').textContent,/GROUP0: 1 entries/);h.close();
});
test('publishing requires server preview and second click, and preserves review ID on uncertain retry',async()=>{
 let attempt=0;const h=lab({call:async(name)=>name==='getPublishedAnnouncement'?{announcement:null}:name==='previewAnnouncement'?{reviewId:'review-one',draft:{...published,days:7}}:name==='publishAnnouncement'?(++attempt===1?Promise.reject(Error('offline')):{ok:true,id:'review-one'}):undefined});
 h.w.ForgeAnnouncements.composer();h.button('Preview before publishing').click();await flush();assert.equal(h.calls.some(c=>c.name==='publishAnnouncement'),false);
 h.button('Publish this announcement').click();await flush();h.button('Publish this announcement').click();await flush();
 const calls=h.calls.filter(c=>c.name==='publishAnnouncement');assert.equal(calls.length,2);assert.ok(calls.every(c=>c.data.reviewId==='review-one'));h.close();
});
