import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source=fs.readFileSync(new URL('../src/services/nativeAuth.js',import.meta.url),'utf8');
function harness({provider='google.com',platform='ios',ready=true,pluginResult,fetchOK=true}={}){
  const calls=[],requests=[];
  const user={uid:'owner',isAnonymous:false,providerData:[{providerId:provider}],
    getIdToken:async()=>{calls.push('idToken');return 'fixture-firebase-token';},
    reauthenticateWithCredential:async c=>{calls.push(['reauth',c]);return {user};}};
  const auth={currentUser:user,signInWithCredential:async c=>{calls.push(['signin',c]);return {user:auth.currentUser};}};
  const value=pluginResult || {credential:{providerId:provider,idToken:'fixture-id',nonce:'fixture-nonce',authorizationCode:'fixture-code',accessToken:'fixture-access'}};
  const plugin={signOut:async()=>{calls.push(['nativeSignOut']);},
    signInWithGoogle:async opts=>{calls.push(['google',opts]);return value;},
    signInWithApple:async opts=>{calls.push(['apple',opts]);return value;}};
  const firebase={auth:{GoogleAuthProvider:{credential:(id,access)=>({id,access})},
    OAuthProvider:class {credential(c){return c;}}}};
  const context={window:{},AbortSignal};vm.runInNewContext(source,context);
  const adapter=context.window.createForgeNativeAuth({auth,firebase,plugin,platform,apiKey:'fixture-key',ready:()=>ready,
    fetcher:async(url,opts)=>{requests.push([url,opts]);return {ok:fetchOK};}});
  return {adapter,auth,user,plugin,calls,requests,value};
}
test('loading native adapter has no plugin, auth or network side effects',()=>{
  const h=harness();assert.equal(h.calls.length,0);assert.equal(h.requests.length,0);
});
test('native auth stays blocked until release gate explicitly permits it',async()=>{
  const h=harness({ready:false});await assert.rejects(h.adapter.signIn('google.com'),/NOT_CONFIGURED/);
  assert.equal(h.calls.length,0);
});
test('Google native credentials populate the existing JS auth session',async()=>{
  const h=harness();assert.equal((await h.adapter.signIn('google.com')).uid,'owner');
  assert.equal(h.calls[0][1].skipNativeAuth,true);assert.equal(h.calls[1][0],'signin');
  assert.equal(h.calls[1][1].id,'fixture-id');
});
test('Apple signs in with the raw nonce provided by the native plugin',async()=>{
  const h=harness({provider:'apple.com'});await h.adapter.signIn('apple.com');
  assert.equal(h.calls[1][1].rawNonce,'fixture-nonce');
});
test('missing nonce or mismatched provider never reaches Firebase auth',async()=>{
  for(const credential of [{idToken:'fixture-id',providerId:'apple.com'},{idToken:'fixture-id',nonce:'fixture-nonce',providerId:'google.com'}]){
    const h=harness({provider:'apple.com',pluginResult:{credential}});
    await assert.rejects(h.adapter.signIn('apple.com'),/NONCE_MISSING|CREDENTIAL_INVALID/);
    assert.ok(!h.calls.some(c=>c[0]==='signin'));
  }
});
test('unsupported provider or missing plugin fails explicitly',async()=>{
  const h=harness();await assert.rejects(h.adapter.signIn('other'),/INVALID_PROVIDER/);
  delete h.plugin.signInWithGoogle;
  await assert.rejects(h.adapter.signIn('google.com'),/PLUGIN_MISSING/);
});
test('late native result cannot sign in after the JS actor changes',async()=>{
  const h=harness();let finish;
  h.plugin.signInWithGoogle=()=>new Promise(resolve=>{finish=resolve;});
  const pending=h.adapter.signIn('google.com');h.auth.currentUser={uid:'other'};
  finish(h.value);await assert.rejects(pending,/ACCOUNT_CHANGED/);
  assert.ok(!h.calls.some(c=>c[0]==='signin'));
});
test('concurrent requests are refused and cancellation releases the lock',async()=>{
  const h=harness();let cancel;
  h.plugin.signInWithGoogle=()=>new Promise((_,reject)=>{cancel=reject;});
  const pending=h.adapter.signIn('google.com');
  await assert.rejects(h.adapter.signIn('google.com'),/AUTH_IN_PROGRESS/);
  cancel(Error('cancelled'));await assert.rejects(pending,/cancelled/);
  h.plugin.signInWithGoogle=async()=>h.value;
  assert.equal((await h.adapter.signIn('google.com')).uid,'owner');
});
test('deletion refuses anonymous or different accounts before showing provider UI',async()=>{
  const h=harness();await assert.rejects(h.adapter.confirmDeletion('other'),/SIGN_IN_REQUIRED/);
  h.user.isAnonymous=true;await assert.rejects(h.adapter.confirmDeletion('owner'),/SIGN_IN_REQUIRED/);
  assert.equal(h.calls.length,0);
});
test('Google deletion reauthenticates rather than replacing the JS account',async()=>{
  const h=harness();await h.adapter.confirmDeletion('owner');
  assert.equal(h.calls[1][0],'reauth');assert.equal(h.requests.length,0);
});
test('iOS Apple deletion revokes the authorization code after reauthentication',async()=>{
  const h=harness({provider:'apple.com'});await h.adapter.confirmDeletion('owner');
  const [url,opts]=h.requests[0],body=JSON.parse(opts.body);
  assert.ok(url.startsWith('https://identitytoolkit.googleapis.com/'));
  assert.equal(body.tokenType,'CODE');assert.equal(body.token,'fixture-code');
  assert.equal(body.idToken,'fixture-firebase-token');assert.equal(opts.redirect,'error');
  assert.equal(opts.headers['X-Ios-Bundle-Identifier'],'in.goforge.app');
  assert.equal(h.calls[1][0],'reauth');
});
test('Android Apple deletion uses the OAuth access token',async()=>{
  const h=harness({provider:'apple.com',platform:'android'});await h.adapter.confirmDeletion('owner');
  assert.equal(JSON.parse(h.requests[0][1].body).tokenType,'ACCESS_TOKEN');
});
test('Android Apple needs no invented nonce and clears its temporary native session',async()=>{
  const h=harness({provider:'apple.com',platform:'android',pluginResult:{credential:{providerId:'apple.com',accessToken:'fixture-access'}}});
  await h.adapter.signIn('apple.com');
  assert.equal(h.calls[1][0],'nativeSignOut');
  assert.equal(h.calls[2][1].accessToken,'fixture-access');
});
test('failed revocation is not reported as a completed deletion prerequisite',async()=>{
  const h=harness({provider:'apple.com',fetchOK:false});
  await assert.rejects(h.adapter.confirmDeletion('owner'),/REVOCATION_FAILED/);
});
test('account change during reauthentication prevents revocation',async()=>{
  const h=harness({provider:'apple.com'});
  h.user.reauthenticateWithCredential=async()=>{h.auth.currentUser={uid:'other'};return {user:h.user};};
  await assert.rejects(h.adapter.confirmDeletion('owner'),/ACCOUNT_CHANGED/);
  assert.equal(h.requests.length,0);
});
test('native plugin configuration is credential-only and required assets are bundled',()=>{
  const config=JSON.parse(fs.readFileSync(new URL('../capacitor.config.json',import.meta.url)));
  assert.equal(config.plugins.FirebaseAuthentication.skipNativeAuth,true);
  assert.deepEqual(config.plugins.FirebaseAuthentication.providers,['google.com','apple.com']);
  const manifest=JSON.parse(fs.readFileSync(new URL('../build/runtime-manifest.json',import.meta.url)));
  assert.ok(manifest.files.includes('src/services/nativeAuth.js'));
  const html=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
  const scripts=[...html.matchAll(/<script\b[^>]*src="([^"]+)"/g)].map(m=>m[1]);
  assert.ok(scripts.indexOf('src/services/nativeAuth.js')>=0);
  assert.ok(scripts.indexOf('src/services/nativeAuth.js')<scripts.indexOf('src/config/firebase.js'));
});
