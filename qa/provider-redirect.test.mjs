import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import vm from 'node:vm';
const source=fs.readFileSync(new URL('../src/config/firebase.js',import.meta.url),'utf8');
const bridge=source.slice(source.indexOf('window.forgePopupSignIn ='),source.indexOf('window.confirmForgeAccountDeletion ='));
function harness(error){
 const nodes=[],stored=new Map(),calls=[];
 const node=()=>({children:[],setAttribute(){},append(...n){this.children.push(...n);},prepend(n){this.children.unshift(n);},remove(){},scrollIntoView(){}});
 const host=node(),ctx={window:{FEATURE_GOOGLE_AUTH:true},document:{body:host,querySelector:()=>host,getElementById:()=>null,createElement:()=>{const n=node();nodes.push(n);return n;}},sessionStorage:{setItem:(k,v)=>stored.set(k,v),getItem:k=>stored.get(k),removeItem:k=>stored.delete(k)},Date,Number,JSON,Error,auth:{signInWithPopup:async()=>{throw error;},signInWithRedirect:async p=>calls.push(p.providerId),getRedirectResult:async()=>({user:{uid:'owner',isAnonymous:false,email:'test@example.test'}})}};
 ctx.setTimeout=setTimeout;ctx.clearTimeout=clearTimeout;
 vm.runInNewContext(bridge,ctx);return {ctx,host,nodes,stored,calls};
}
test('blocked popup offers an explicit redirect retry and stores no credential',async()=>{
 const h=harness({code:'auth/popup-blocked'});
 await assert.rejects(h.ctx.window.forgePopupSignIn({providerId:'google.com'},{action:'join',groupCode:'LABONE',pin:'not-a-real-pin',adminKey:'not-a-key'}));
 assert.equal(h.calls.length,0);assert.equal(h.host.children.length,1);
 const button=h.host.children[0].children[1];await button.onclick();
 assert.deepEqual(h.calls,['google.com']);const pending=JSON.parse(h.stored.get('forgeProviderRedirect'));
 assert.deepEqual(Object.keys(pending).sort(),['action','at','groupCode','provider']);
 await h.ctx.window.readForgeRedirectResult();assert.equal(h.ctx.window._forgeRedirectOutcome.uid,'owner');assert.equal(h.stored.size,0);
});
test('popup cancellation never triggers fallback or persistence',async()=>{
 const h=harness({code:'auth/popup-closed-by-user'});await assert.rejects(h.ctx.window.forgePopupSignIn({providerId:'google.com'}));
 assert.equal(h.host.children.length,0);assert.equal(h.calls.length,0);assert.equal(h.stored.size,0);
});
test('redirect failures stay visible and expired intents do not resume',async()=>{
 const h=harness();h.stored.set('forgeProviderRedirect',JSON.stringify({provider:'google.com',at:Date.now(),action:'restore'}));
 h.ctx.auth.getRedirectResult=async()=>({user:null});await h.ctx.window.readForgeRedirectResult();assert.match(h.ctx.window._forgeRedirectError,/cross-site storage/);assert.equal(h.ctx.window._forgeRedirectOutcome,undefined);
 h.stored.set('forgeProviderRedirect',JSON.stringify({provider:'google.com',at:Date.now()-700000}));let called=false;h.ctx.auth.getRedirectResult=async()=>{called=true;};await h.ctx.window.readForgeRedirectResult();assert.equal(called,false);
});
