import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import crypto from 'node:crypto';
function harness(mode='ok'){
 class Element{
  constructor(tag){this.tag=tag;this.children=[];this.value='';this.isConnected=true;this.classList={contains:()=>true};}
  append(...items){for(const item of items){item.parent=this;this.children.push(item);}}
  replaceChildren(...items){this.children=[];this.append(...items);}
  setAttribute(){} focus(){} remove(){this.isConnected=false;this.parent.children=this.parent.children.filter(x=>x!==this);}
 }
 const root=new Element('root'),screen=new Element('screen'),calls=[],auth={currentUser:{uid:'owner',isAnonymous:false,providerData:[{providerId:'google.com'}]}};
 const all=(el=root)=>[el,...el.children.flatMap(all)];
 const ctx={console,auth,document:{createElement:t=>new Element(t),createTextNode:t=>Object.assign(new Element('text'),{textContent:t}),getElementById:id=>id==='soloRoot'?root:id==='screen-solo'?screen:all().find(e=>e.id===id)},showScreen(){},showObStep(){},FEATURE_GOOGLE_AUTH:true,FEATURE_APPLE_AUTH:true,
  callFunction:async(name,data)=>{calls.push({name});if(name==='getSolo')return {enrolled:false};assert.equal(name,'linkLegacyGroup');assert.equal(data.groupCode,'AWAY');assert.equal(data.name,'Legacy');if(mode==='wrong')throw Object.assign(Error('No'),{code:'functions/permission-denied'});return {ok:true};},
  startForgeProviderSignIn:async()=>{calls.push({name:'signIn'});if(mode==='switch')auth.currentUser={...auth.currentUser,uid:'other'};return {uid:auth.currentUser.uid};},
  restoreIdentityFromGoogle:async r=>{calls.push({name:'restore',uid:r.uid,code:r.preferredCode});}
 };
 ctx.window=ctx;
 const source=fs.readFileSync(new URL('../src/ui/today.js',import.meta.url),'utf8');
 const start=source.indexOf('/* Standalone solo:');const end=source.indexOf('window.ForgeSolo={open};',start);
 vm.runInNewContext(source.slice(start,end)+'window.ForgeSolo={open};\n})();',ctx);
 const button=text=>{const found=all().find(e=>e.tag==='button'&&e.textContent===text);assert.ok(found,text);return found;};
 async function prepare(){
  await ctx.ForgeSolo.open();button('Recover my group profile').onclick();
  const inputs=all().filter(e=>e.tag==='input');inputs[0].value='away';inputs[1].value='Legacy';inputs[2].value=String(crypto.randomInt(1000,10000));
  all().find(e=>e.tag==='form').onsubmit({preventDefault(){}});return inputs;
 }
 return {ctx,calls,all,button,prepare};
}
test('solo recovery requires explicit review and fresh same-account sign-in before linking',async()=>{
 const h=harness(),inputs=await h.prepare();assert.equal(h.calls.filter(c=>c.name==='linkLegacyGroup').length,0);
 await h.button('Verify sign-in and recover profile').onclick();
 assert.deepEqual(h.calls.slice(-3).map(c=>c.name),['signIn','linkLegacyGroup','restore']);
 assert.equal(inputs[2].value,'');assert.equal(h.calls.at(-1).code,'AWAY');
});
test('switching provider account during confirmation cannot claim a profile',async()=>{
 const h=harness('switch'),inputs=await h.prepare();await h.button('Verify sign-in and recover profile').onclick();
 assert.equal(h.calls.some(c=>c.name==='linkLegacyGroup'),false);assert.equal(inputs[2].value,'');
});
test('wrong PIN clears the proof and returns to editable recovery without restoring',async()=>{
 const h=harness('wrong'),inputs=await h.prepare();await h.button('Verify sign-in and recover profile').onclick();
 assert.equal(h.calls.some(c=>c.name==='restore'),false);assert.equal(inputs[2].value,'');assert.equal(inputs[2].disabled,false);assert.equal(h.button('Review recovery').disabled,false);
});
