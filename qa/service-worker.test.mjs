import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source=fs.readFileSync(new URL('../sw.js',import.meta.url),'utf8');
function setup({offline=false,status=200,cached=null,precacheFails=false,ready=true}={}){
  const handlers={},puts=[],deleted=[],matches=[],waits=[];
  let skipped=false,claimed=false;
  const cache={addAll:async paths=>{if(precacheFails)throw Error('download failed');for(const p of paths)assert.ok(fs.existsSync(new URL('../'+p,import.meta.url)));},put:async(...args)=>{puts.push(args);if(String(args[0]).endsWith('__forge_shell_ready__'))ready=true;},match:async key=>{matches.push(key);if(String(key).endsWith('__forge_shell_ready__'))return ready?new Response('ready'):undefined;return typeof key==='string'?new Response('page'):cached;}};
  const context={self:{registration:{scope:'https://example.test/forge-staging/'},addEventListener:(name,fn)=>handlers[name]=fn,skipWaiting(){skipped=true;},clients:{claim:async()=>{claimed=true;}}},location:{origin:'https://example.test'},caches:{open:async()=>cache,keys:async()=>['forge-shell:https://example.test/forge-staging/:old','forge-shell:https://example.test/other/:old','forge-staging-v86-f025','unrelated-app'],delete:async key=>deleted.push(key)},fetch:async()=>{if(offline)throw Error('offline');return new Response('network',{status});},URL,Response};
  vm.runInNewContext(source,context);
  const event={request:{method:'GET',url:'https://example.test/icon.webp',mode:'cors'},waitUntil:p=>waits.push(p),respondWith:p=>event.response=p};
  return {handlers,event,puts,deleted,matches,waits,state:()=>({skipped,claimed})};
}
test('every precached shell asset exists',async()=>{const r=setup();r.handlers.install(r.event);await Promise.all(r.waits);});
test('versioned experience assets use matching offline cache keys',()=>{
  const html=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
  for(const asset of ['src/style/today.css','src/ui/today.js','assets/forgeling.webp']){
    const versioned=asset+'?v=f026-1';assert.ok(html.includes(versioned));assert.ok(source.includes('./'+versioned));
  }
});
test('activation deletes only previous caches from this exact app scope',async()=>{const r=setup();r.handlers.activate(r.event);await Promise.all(r.waits);assert.deepEqual(r.deleted,['forge-shell:https://example.test/forge-staging/:old']);});
test('failed precache rejects install without skipWaiting or deleting good caches',async()=>{const r=setup({precacheFails:true,ready:false});r.handlers.install(r.event);await assert.rejects(Promise.all(r.waits),/download failed/);assert.deepEqual(r.state(),{skipped:false,claimed:false});assert.equal(r.deleted.length,0);assert.equal(r.puts.length,0);});
test('activation without completed shell cannot delete or claim',async()=>{const r=setup({ready:false});r.handlers.activate(r.event);await assert.rejects(Promise.all(r.waits),/SHELL_NOT_READY/);assert.equal(r.deleted.length,0);assert.equal(r.state().claimed,false);});
test('complete installation records readiness before permitting activation',async()=>{const r=setup({ready:false});r.handlers.install(r.event);await Promise.all(r.waits);assert.equal(r.state().skipped,true);assert.ok(String(r.puts[0][0]).endsWith('__forge_shell_ready__'));r.handlers.activate(r.event);await Promise.all(r.waits);assert.equal(r.state().claimed,true);});
test('successful responses are cached',async()=>{const r=setup();r.handlers.fetch(r.event);assert.equal((await r.event.response).status,200);await Promise.all(r.waits);assert.equal(r.puts.length,1);});
test('HTTP errors never replace a good cache entry',async()=>{const r=setup({status:404});r.handlers.fetch(r.event);assert.equal((await r.event.response).status,404);assert.equal(r.puts.length,0);});
test('missing offline assets do not receive HTML',async()=>{const r=setup({offline:true});r.handlers.fetch(r.event);assert.equal((await r.event.response).type,'error');assert.equal(r.matches.length,1);});
test('offline navigation can fall back to the cached page',async()=>{const r=setup({offline:true});r.event.request.mode='navigate';r.handlers.fetch(r.event);assert.equal(await (await r.event.response).text(),'page');});
test('cached offline assets retain their own response',async()=>{const r=setup({offline:true,cached:new Response('image')});r.handlers.fetch(r.event);assert.equal(await (await r.event.response).text(),'image');});
test('external requests and writes bypass the worker',()=>{for(const request of [{method:'POST',url:'https://example.test/'},{method:'GET',url:'https://external.test/'}]){const r=setup();r.event.request=request;r.handlers.fetch(r.event);assert.equal(r.event.response,undefined);}});
