import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source=fs.readFileSync(new URL('../src/ui/today.js',import.meta.url),'utf8');
function runtime(loader){
 const node=(tag,cls,text)=>({tag,cls,text,isConnected:true,children:[],listeners:{},append(...n){this.children.push(...n);},replaceChildren(...n){this.children=n;},addEventListener(k,fn){this.listeners[k]=fn;}});
 const receipt={report:{cache:{}}};let current=true;
 const ctx={node,button:(text,fn)=>({...node('button','',text),click:fn}),receiptCurrent:r=>r===receipt&&current,_mirLoadRewardGroup:loader};
 vm.createContext(ctx);vm.runInContext(source.slice(source.indexOf('  function groupPoints('),source.indexOf('  function renderReceipt(')),ctx);
 const row=ctx.groupPoints(receipt,{name:'Alpha',code:'A'});
 return {row,body:row.children[1],receipt,stale:()=>current=false};
}
const flush=async()=>{for(let i=0;i<10;i++)await Promise.resolve();};
const text=n=>[n.text||'',...n.children.map(text)].join(' ');
test('inline points load only after expansion and preserve component arithmetic and zero-day explanation',async()=>{
 let reads=0;const r=runtime(async()=>{reads++;return {kind:'ready',data:{delta:0,totalBefore:9,totalAfter:9,components:[],afterScore:{streak:2},zeroMessage:'This day already earned its workout points.'}};});
 assert.equal(reads,0);r.row.open=true;r.row.listeners.toggle();await flush();assert.equal(reads,1);assert.match(text(r.body),/0 points/);assert.match(text(r.body),/already earned/);assert.match(text(r.body),/9 → 9/);
});
test('superseded and detached receipts reject late results',async()=>{
 for(const mode of ['stale','detached']){let resolve;const r=runtime(()=>new Promise(done=>resolve=done));r.row.open=true;r.row.listeners.toggle();if(mode==='stale')r.stale();else r.row.isConnected=false;resolve({kind:'ready',data:{delta:999,components:[]}});await flush();assert.doesNotMatch(text(r.body),/999/);}
});
test('inline error offers a labelled retry with explicit retry semantics',async()=>{
 const calls=[];const r=runtime(async(_r,_c,options)=>{calls.push(options);return {kind:'error',message:'Unavailable'};});r.row.open=true;r.row.listeners.toggle();await flush();const retry=r.body.children.find(x=>x.tag==='button');assert.equal(retry.text,'Retry points');retry.click();await flush();assert.equal(calls[1].retry,true);
});
