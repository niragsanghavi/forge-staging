// npm test — Auth hydration and verified PIN-grace boundaries; no network.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const config=fs.readFileSync(new URL('../src/config/firebase.js',import.meta.url),'utf8');
const source=config.slice(config.indexOf('window.ensureAuth ='),config.indexOf('\n\n/*',config.indexOf('window.ensureAuth =')));
function harness(){
 let observe,fail,timeout,created=0,removed=0,resolveAnon;
 const auth={currentUser:null,onAuthStateChanged:(ok,no)=>{observe=ok;fail=no;return()=>removed++;},signInAnonymously:()=>{created++;return new Promise(r=>resolveAnon=r);}};
 const c={auth,setTimeout:f=>{timeout=f;return 1;},clearTimeout:()=>{},Error,Promise};c.window=c;
 vm.runInNewContext(source,c);
 return {c,auth,observe:u=>{auth.currentUser=u;observe(u);},fail:e=>fail(e),timeout:()=>timeout(),created:()=>created,removed:()=>removed,anon:()=>resolveAnon({user:{uid:'anon',isAnonymous:true}})};
}
test('cold reload waits for persisted provider rather than minting anonymous identity',async()=>{
 const h=harness(),p=h.c.ensureAuth();assert.equal(h.created(),0);h.observe({uid:'google',isAnonymous:false});assert.equal(await p,'google');assert.equal(h.created(),0);assert.equal(h.removed(),1);
});
test('concurrent callers share one observer and anonymous creation after resolved null',async()=>{
 const h=harness(),a=h.c.ensureAuth(),b=h.c.ensureAuth();assert.equal(a,b);h.observe(null);h.observe(null);assert.equal(h.created(),1);h.anon();assert.equal(await a,'anon');
});
test('a session from another tab wins without anonymous replacement',async()=>{
 const h=harness(),p=h.c.ensureAuth();h.observe({uid:'apple',isAnonymous:false});assert.equal(await p,'apple');assert.equal(h.created(),0);
});
test('sign-out/reset may create a new anonymous session only after a new null observation',async()=>{
 const h=harness();const first=h.c.ensureAuth();h.observe({uid:'owner'});await first;const second=h.c.ensureAuth();assert.notEqual(first,second);assert.equal(h.created(),0);h.observe(null);h.anon();assert.equal(await second,'anon');
});
test('expired/rejected Auth state fails closed and clears the in-flight attempt',async()=>{
 const h=harness(),p=h.c.ensureAuth();h.fail(Object.assign(Error('expired'),{code:'auth/user-token-expired'}));await assert.rejects(p,{code:'auth/user-token-expired'});assert.equal(h.created(),0);assert.equal(h.c._forgeEnsureAuthPending,null);
});
test('boot timeout remains bounded and ignores a late Auth observation',async()=>{
 const h=harness(),p=h.c.ensureAuth();h.timeout();await assert.rejects(p,/AUTH_TIMEOUT/);h.observe(null);assert.equal(h.created(),0);assert.equal(h.removed(),1);
});
const html=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
const grace=html.slice(html.indexOf('async function gracePinCheckOnResume(){'),html.indexOf('\n// PIN flow state',html.indexOf('async function gracePinCheckOnResume(){')));
function graceHarness(result){
 const c={me:{userId:'profile'},season:{roster:[{userId:'profile',pinSet:false}]},groupCode:'LABONE',FEATURE_GOOGLE_AUTH:true,auth:{currentUser:{uid:'actor',isAnonymous:false}},callFunction:async()=>result};c.window=c;
 vm.runInNewContext(grace,c);return c;
}
test('new provider member bypasses legacy PIN only after verified matching ownership',async()=>{
 const c=graceHarness({linked:true,userId:'profile',groupCodes:['LABONE']});assert.equal(await c.gracePinCheckOnResume(),false);
});
test('wrong profile or wrong group cannot obtain the provider PIN bypass',async()=>{
 for(const result of [{linked:true,userId:'other',groupCodes:['LABONE']},{linked:true,userId:'profile',groupCodes:['OTHER']},{linked:false}]){
  await assert.rejects(graceHarness(result).gracePinCheckOnResume(),/Verify your linked group profile/);
 }
});
test('masked PIN and Enter handler remain present in shipping markup',()=>{
 assert.match(html, /id="pinEntry" type="password" inputmode="numeric"/);
 assert.match(html, /id="codeInput"[^>]*onkeydown="if\(event.key==='Enter'\)verifyCode\(\)"/);
});
