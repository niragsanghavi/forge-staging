// Synthetic, in-memory backend tests. No network, real tokens or messages.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import crypto from 'node:crypto';
const source=fs.readFileSync(new URL('../functions/index.js',import.meta.url),'utf8');
function harness({secret='fixture-secret'}={}) {
  const records=new Map([
    ['users/u1',{pushTokens:{'fixture-device':{platform:'web'}}}],
    ['groups/TEST',{name:'Test',currentSeasonId:'2026-09'}],
    ['groups/TEST/seasons/2026-09',{roster:[{userId:'u1',team:'A'},{userId:'u1',team:'A'},{userId:'gone',team:'A',departed:true}]}]
  ]), sent=[],writes=[];
  let sequence=0, pending=Promise.resolve();
  function ref(p) {
    return {id:p.split('/').at(-1),p,
      get:async()=>snap(p),
      set:async(v)=>{writes.push(p);records.set(p,{...records.get(p),...v});},
      update:async(v)=>{writes.push(p);records.set(p,{...records.get(p),...v});},
      collection:n=>collection(p+'/'+n)};
  }
  function snap(p){return {id:p.split('/').at(-1),ref:ref(p),exists:records.has(p),data:()=>records.get(p)};}
  function collection(p,filters=[]) {
    return {doc:id=>ref(p+'/'+id),
      add:async v=>{const r=ref(p+'/q'+(++sequence));await r.set(v);return r;},
      where:(f,op,v)=>collection(p,[...filters,[f,op,v]]),
      orderBy:()=>collection(p,filters),limit:()=>collection(p,filters),
      get:async()=>{
        const docs=[...records.keys()].filter(k=>k.startsWith(p+'/')&&k.split('/').length===p.split('/').length+1)
          .filter(k=>filters.every(([f,op,v])=>op==='=='?records.get(k)[f]===v:records.get(k)[f]<=v)).map(snap);
        return {docs,size:docs.length,empty:!docs.length};
      }};
  }
  const db={collection,runTransaction:fn=>{
    const job=pending.then(()=>fn({get:r=>r.get(),set:(r,v)=>r.set(v),update:(r,v)=>r.update(v)}));
    pending=job.catch(()=>{});return job;
  }};
  const wrap=(...args)=>args.at(-1);
  class HttpsError extends Error {constructor(code,message){super(message);this.code=code;}}
  const sdk={
    'firebase-functions/v2/scheduler':{onSchedule:wrap},
    'firebase-functions/v2/https':{onCall:wrap,HttpsError},
    'firebase-functions':{logger:{info(){},warn(){},error(){}}},
    'firebase-admin':{initializeApp(){},firestore:()=>db,messaging:()=>({send:async m=>sent.push(m)})},
    'firebase-admin/firestore':{FieldValue:{serverTimestamp:()=>new Date(),delete:()=>null}},
    'firebase-functions/params':{defineSecret:()=>({value:()=>secret})},crypto};
  const context=vm.createContext({exports:{},Buffer,require:n=>{if(!sdk[n])throw Error('Unexpected dependency');return sdk[n];}});
  new vm.Script(source).runInContext(context,{timeout:1000});
  const request=(data={})=>({auth:{uid:'fixture-admin'},data:{adminKey:'fixture-secret',title:'Test title',body:'Test body',scope:'group',groupCode:'TEST',...data}});
  return {api:context.exports,records,sent,writes,request};
}
test('notice callables refuse anonymous requests before reading or sending',async()=>{
  const h=harness();
  for(const name of ['sendNotice','noticeQueue'])await assert.rejects(h.api[name]({}),e=>e.code==='unauthenticated');
  assert.equal(h.sent.length,0);assert.equal(h.writes.length,0);
});
test('unset admin secret fails closed even when submitted key is empty',async()=>{
  const h=harness({secret:''});
  for(const name of ['sendNotice','noticeQueue'])await assert.rejects(h.api[name](h.request({adminKey:''})),e=>e.code==='failed-precondition');
  assert.equal(h.sent.length,0);
});
test('wrong admin key cannot send or schedule',async()=>{
  const h=harness();
  await assert.rejects(h.api.sendNotice(h.request({adminKey:'wrong',sendAt:new Date(Date.now()+60000).toISOString()})),e=>e.code==='permission-denied');
  assert.equal(h.sent.length,0);assert.ok(!h.writes.some(p=>p.startsWith('scheduledNotices/')));
});
test('dry-run with scheduled time does not write a queue or send',async()=>{
  const h=harness();
  const result=await h.api.sendNotice(h.request({dryRun:true,sendAt:new Date(Date.now()+60000).toISOString()}));
  assert.equal(result.dryRun,true);assert.equal(result.people,1);
  assert.equal(h.sent.length,0);assert.equal(h.writes.length,0);
});
test('unknown audience scopes are rejected rather than broadened to a group',async()=>{
  const h=harness();
  await assert.rejects(h.api.sendNotice(h.request({scope:'typo'})),e=>e.code==='invalid-argument');
  assert.equal(h.sent.length,0);assert.equal(h.writes.length,0);
});
test('immediate sends deduplicate roster recipients and exclude departed members',async()=>{
  const h=harness();const result=await h.api.sendNotice(h.request());
  assert.equal(result.sent,1);assert.equal(result.people,1);assert.equal(h.sent.length,1);
});
test('schedule queues without sending; cancellation prevents delivery',async()=>{
  const h=harness();const result=await h.api.sendNotice(h.request({sendAt:new Date(Date.now()+60000).toISOString()}));
  assert.equal(result.queued,true);assert.equal(h.sent.length,0);
  const cancelled=await h.api.noticeQueue(h.request({action:'cancel',id:result.id}));
  assert.equal(cancelled.cancelled,result.id);
  await h.api.drainScheduledNotices();assert.equal(h.sent.length,0);
});
test('concurrent drains claim a due notice only once',async()=>{
  const h=harness();
  h.records.set('scheduledNotices/due',{status:'queued',sendAt:new Date(Date.now()-1000),title:'Test',body:'Test',scope:'group',groupCode:'TEST'});
  await Promise.all([h.api.drainScheduledNotices(),h.api.drainScheduledNotices()]);
  assert.equal(h.sent.length,1);assert.equal(h.records.get('scheduledNotices/due').status,'sent');
});
test('queue cannot cancel an already claimed notice',async()=>{
  const h=harness();h.records.set('scheduledNotices/busy',{status:'sending'});
  await assert.rejects(h.api.noticeQueue(h.request({action:'cancel',id:'busy'})),e=>e.code==='failed-precondition');
  assert.equal(h.records.get('scheduledNotices/busy').status,'sending');
});
