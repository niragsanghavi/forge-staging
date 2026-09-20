import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source=fs.readFileSync(new URL('../src/ui/today.js',import.meta.url),'utf8');
class Node{
 constructor(tag){this.tag=tag;this.children=[];this.textContent='';this.value='';this.isConnected=true;this.attrs={};this.classList={toggle(){}};}
 append(...nodes){this.children.push(...nodes);}
 replaceChildren(...nodes){for(const n of this.children)n.isConnected=false;this.children=nodes;}
 setAttribute(k,v){this.attrs[k]=v;}
}
const walk=n=>[n,...n.children.flatMap(walk)],text=n=>walk(n).map(x=>x.textContent).join(' ');
const flush=async()=>{for(let i=0;i<20;i++)await Promise.resolve();};
function runtime(call){
 let body,serial=0;const ctx={Date,crypto:{randomUUID:()=>`test-operation-${++serial}`},auth:{currentUser:{uid:'member',isAnonymous:false}},FEATURE_GOOGLE_AUTH:true,callFunction:call,
 document:{readyState:'loading',createElement:t=>new Node(t),addEventListener(){},querySelectorAll(){return [];},getElementById(){return null;}}};ctx.window=ctx;vm.createContext(ctx);vm.runInContext(source,ctx);
 ctx.ForgeToday.openDialog=(_t,b)=>{if(body)body.isConnected=false;body=b;};return {ctx,get body(){return body;}};
}
const initial={thread:null,messages:[],isAdmin:false,context:{name:'Fictional member',groups:['TEST19']}};
test('unlinked support offers email and never requests private data',()=>{
 const r=runtime(()=>{throw Error('must not call');});r.ctx.auth.currentUser.isAnonymous=true;r.ctx.ForgeSupport.open();assert.match(text(r.body),/Link Google or Apple/);assert.ok(walk(r.body).some(n=>n.href==='mailto:team@goforge.in'));
});
test('late private data cannot paint after a different account signs in',async()=>{
 let resolve;const r=runtime(()=>new Promise(done=>resolve=done));r.ctx.ForgeSupport.open();r.ctx.auth.currentUser.uid='other';resolve(initial);await flush();assert.doesNotMatch(text(r.body),/Fictional member/);
});
test('support drafts survive an uncertain send and retry keeps the message ID',async()=>{
 const calls=[];let reject;
 const r=runtime((name,data)=>{calls.push({name,data});if(name==='supportGet')return Promise.resolve(initial);return new Promise((_ok,no)=>reject=no);});
 r.ctx.ForgeSupport.open();await flush();const form=walk(r.body).find(n=>n.tag==='form'),input=walk(form).find(n=>n.tag==='textarea');input.value='The calendar needs a look';
 const send=form.onsubmit({preventDefault(){}});await flush();await form.onsubmit({preventDefault(){}});assert.equal(calls.filter(c=>c.name==='supportPost').length,1);
 reject(Error('network'));await send;assert.equal(input.value,'The calendar needs a look');
 const retry=form.onsubmit({preventDefault(){}});await flush();reject(Error('network'));await retry;
 const posts=calls.filter(c=>c.name==='supportPost');assert.equal(posts[0].data.operationId,posts[1].data.operationId);
 assert.doesNotMatch(text(r.body),/Open support inbox/);
});
test('support renders message text literally, not as HTML',async()=>{
 const r=runtime(name=>Promise.resolve(name==='supportGet'?{...initial,messages:[{role:'admin',text:'<img src=x onerror=alert(1)>',at:0,status:'working'}]}:{}));r.ctx.ForgeSupport.open();await flush();
 assert.ok(walk(r.body).some(n=>n.textContent==='<img src=x onerror=alert(1)>'));assert.ok(walk(r.body).every(n=>n.innerHTML===undefined));
});
