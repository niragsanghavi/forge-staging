// Small deterministic Firestore double. Real emulator coverage remains required.
import assert from 'node:assert/strict';
export function memoryFirestore(initial=[]){
 const records=new Map(initial);let queue=Promise.resolve(),beforeCommit=()=>{};
 const snap=path=>({id:path.split('/').at(-1),ref:ref(path),exists:records.has(path),data:()=>structuredClone(records.get(path))});
 const ref=path=>({path,id:path.split('/').at(-1),collection:n=>collection(path+'/'+n),get:async()=>snap(path),set:async d=>records.set(path,structuredClone(d)),update:async d=>{assert.ok(records.has(path));records.set(path,{...records.get(path),...structuredClone(d)});},delete:async()=>records.delete(path)});
 function collection(path,filters=[],limit=Infinity,cursor=null){
  const query={path,query:true,doc:id=>ref(path+'/'+id),where:(key,op,value)=>{assert.equal(op,'==');return collection(path,[...filters,[key,value]],limit,cursor);},limit:n=>collection(path,filters,n,cursor),orderBy:key=>{assert.equal(key,'__name__');return query;},startAfter:id=>collection(path,filters,limit,id),get:async()=>{
   const docs=[...records.keys()].filter(k=>k.startsWith(path+'/')&&k.split('/').length===path.split('/').length+1&&(!cursor||k.split('/').at(-1)>cursor)&&filters.every(([key,value])=>records.get(k)[key]===value)).sort().slice(0,limit).map(snap);
   return {docs,size:docs.length,empty:!docs.length};
  }};return query;
 }
 function writes(){
  const pending=[];
  return {pending,set:(r,v)=>pending.push(['set',r.path,structuredClone(v)]),update:(r,v)=>pending.push(['update',r.path,structuredClone(v)]),delete:r=>pending.push(['delete',r.path]),commit:async()=>{
   await beforeCommit(pending);
   for(const [kind,path,value]of pending){if(kind==='delete')records.delete(path);else if(kind==='update'){assert.ok(records.has(path));records.set(path,{...records.get(path),...value});}else records.set(path,value);}
  }};
 }
 const db={collection,batch:writes,runTransaction:fn=>{
  const next=queue.then(async()=>{const batch=writes();const result=await fn({...batch,get:async r=>{assert.equal(batch.pending.length,0,'transaction reads before writes');return r.get();}});await batch.commit();return result;});queue=next.catch(()=>{});return next;
 }};
 return {db,records,onCommit:fn=>{beforeCommit=fn;}};
}
