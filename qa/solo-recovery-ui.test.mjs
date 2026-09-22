import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {runtime,flush} from './solo-dom.mjs';
async function prepare(options={}){
 const h=runtime({enrolled:false,...options});await h.w.ForgeSolo.open();h.w.ForgeSolo.recoverGroup();
 const inputs=[...h.d.querySelectorAll('#soloContent input')];inputs[0].value='away';inputs[1].value='Legacy';inputs[2].value=String(crypto.randomInt(1000,10000));
 h.d.querySelector('#soloContent form').onsubmit({preventDefault(){}});return {...h,inputs};
}
test('solo recovery requires explicit review and fresh same-account sign-in before linking',async()=>{
 const h=await prepare();assert.equal(h.calls.filter(c=>c.name==='linkLegacyGroup').length,0);
 await h.button('Verify sign-in and recover profile').onclick();
 assert.deepEqual(h.calls.slice(-4).map(c=>c.name),['signIn','getSolo','linkLegacyGroup','restore']);
 assert.equal(h.inputs[2].value,'');assert.equal(h.calls.at(-1).preferredCode,'AWAY');h.close();
});
test('switching provider account during confirmation cannot claim a profile',async()=>{
 const h=await prepare({signIn:async w=>{w.auth.currentUser.uid='other';return {uid:'other'};}});
 await h.button('Verify sign-in and recover profile').onclick();
 assert.equal(h.calls.some(c=>['linkLegacyGroup','claimIdentity'].includes(c.name)),false);assert.equal(h.inputs[2].value,'');h.close();
});
test('wrong PIN clears the proof and returns to editable recovery without restoring',async()=>{
 const h=await prepare({call:async name=>{if(name==='linkLegacyGroup')throw Object.assign(Error('No'),{code:'functions/permission-denied'});}});
 await h.button('Verify sign-in and recover profile').onclick();
 assert.equal(h.calls.some(c=>c.name==='restore'),false);assert.equal(h.inputs[2].value,'');assert.equal(h.inputs[2].disabled,false);assert.equal(h.button('Review recovery').disabled,false);h.close();
});
test('an unowned provider claims the roster profile without creating a solo account',async()=>{
 const h=await prepare({hasProfile:false});await h.button('Verify sign-in and recover profile').onclick();
 assert.ok(h.calls.some(c=>c.name==='claimIdentity'&&c.data.userId==='legacy-profile'));
 assert.ok(!h.calls.some(c=>['enrollSolo','linkLegacyGroup'].includes(c.name)));h.close();
});
test('recovery double-click cannot duplicate a merge and never retains PIN after success',async()=>{
 let finish;const h=await prepare({call:async name=>name==='linkLegacyGroup'?new Promise(r=>finish=r):undefined});
 const b=h.button('Verify sign-in and recover profile'),pending=b.onclick();await b.onclick();
 await flush();assert.equal(h.calls.filter(c=>c.name==='linkLegacyGroup').length,1);
 finish({ok:true});await pending;assert.equal(h.inputs[2].value,'');h.close();
});
