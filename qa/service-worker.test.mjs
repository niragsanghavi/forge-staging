import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source=fs.readFileSync(new URL('../sw.js',import.meta.url),'utf8');
function setup({offline=false,status=200,cached=null}={}){
  const handlers={},puts=[],deleted=[],matches=[],waits=[];
  const cache={addAll:async paths=>{for(const p of paths)assert.ok(fs.existsSync(new URL('../'+p,import.meta.url)));},put:async(...args)=>puts.push(args),match:async key=>{matches.push(key);return typeof key==='string'?new Response('page'):cached;}};
  const context={self:{addEventListener:(name,fn)=>handlers[name]=fn,skipWaiting(){},clients:{claim:async()=>{}}},location:{origin:'https://example.test'},caches:{open:async()=>cache,keys:async()=>['forge-staging-v86-f025','unrelated-app'],delete:async key=>deleted.push(key)},fetch:async()=>{if(offline)throw Error('offline');return new Response('network',{status});},URL,Response};
  vm.runInNewContext(source,context);
  const event={request:{method:'GET',url:'https://example.test/icon.webp',mode:'cors'},waitUntil:p=>waits.push(p),respondWith:p=>event.response=p};
  return {handlers,event,puts,deleted,matches,waits};
}
test('every precached shell asset exists',async()=>{const r=setup();r.handlers.install(r.event);await Promise.all(r.waits);});
test('versioned experience assets use matching offline cache keys',()=>{
  const html=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
  for(const asset of ['src/style/today.css','src/ui/today.js','assets/forgeling.webp']){
    const versioned=asset+'?v=f026-1';assert.ok(html.includes(versioned));assert.ok(source.includes('./'+versioned));
  }
});
test('activation preserves unrelated application caches',async()=>{const r=setup();r.handlers.activate(r.event);await Promise.all(r.waits);assert.deepEqual(r.deleted,['forge-staging-v86-f025']);});
test('successful responses are cached',async()=>{const r=setup();r.handlers.fetch(r.event);assert.equal((await r.event.response).status,200);await Promise.all(r.waits);assert.equal(r.puts.length,1);});
test('HTTP errors never replace a good cache entry',async()=>{const r=setup({status:404});r.handlers.fetch(r.event);assert.equal((await r.event.response).status,404);assert.equal(r.puts.length,0);});
test('missing offline assets do not receive HTML',async()=>{const r=setup({offline:true});r.handlers.fetch(r.event);assert.equal((await r.event.response).type,'error');assert.equal(r.matches.length,1);});
test('offline navigation can fall back to the cached page',async()=>{const r=setup({offline:true});r.event.request.mode='navigate';r.handlers.fetch(r.event);assert.equal(await (await r.event.response).text(),'page');});
test('cached offline assets retain their own response',async()=>{const r=setup({offline:true,cached:new Response('image')});r.handlers.fetch(r.event);assert.equal(await (await r.event.response).text(),'image');});
test('external requests and writes bypass the worker',()=>{for(const request of [{method:'POST',url:'https://example.test/'},{method:'GET',url:'https://external.test/'}]){const r=setup();r.event.request=request;r.handlers.fetch(r.event);assert.equal(r.event.response,undefined);}});
