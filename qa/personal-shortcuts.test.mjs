import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source=fs.readFileSync(new URL('../src/ui/today.js',import.meta.url),'utf8');
function runtime(){const ctx={Date,document:{readyState:'loading',addEventListener(){},querySelectorAll(){return [];}}};ctx.window=ctx;vm.createContext(ctx);vm.runInContext(source,ctx);return ctx;}
const log=(day,workouts,extra={})=>({year:2026,month:9,day,workouts,...extra});
test('shortcuts choose two frequent workout-day favourites plus a recent different activity',()=>{
 const api=runtime().ForgeExperience,now=new Date(2026,8,20);
 const logs=[log(1,['Swim','Run']),log(2,['Swim','Run']),log(3,['Swim']),log(20,['Tennis']),log(10,['Gym'])];
 assert.deepEqual(Array.from(api.rankWorkouts(logs,now)),['Swim','Run','Tennis']);
});
test('fan-out copies and repeated sessions do not inflate daily frequency',()=>{
 const api=runtime().ForgeExperience,now=new Date(2026,8,20);
 const logs=[...Array.from({length:10},()=>log(19,['Yoga'],{groupCode:'A'})),log(1,['Run']),log(2,['Run']),log(3,['Swim']),log(4,['Swim']),log(20,['Tennis'])];
 assert.deepEqual(Array.from(api.rankWorkouts(logs,now)),['Swim','Run','Tennis']);
});
test('the sixty-day window crosses months and excludes voids, future and demo records',()=>{
 const api=runtime().ForgeExperience,now=new Date(2026,8,20);
 assert.deepEqual(Array.from(api.rankWorkouts([log(23,['Tennis'],{month:7}),log(1,['Old'],{month:6}),log(21,['Future']),log(1,['Void'],{voided:true}),log(1,['Demo'],{demo:true})],now)),['Tennis']);
 assert.deepEqual(Array.from(api.rankWorkouts([],now)),[]);
});
test('uncached shortcuts are identity scoped, including legacy records in the selected group',()=>{
 const ctx=runtime(),d=new Date();ctx.me={name:'One',userId:'u1'};ctx.groupCode='A';ctx.season={month:d.getMonth()+1,year:d.getFullYear()};ctx.getSessions=()=>[];
 ctx.allLogs=[{day:d.getDate(),player:'One',workouts:['Run']},{day:d.getDate(),player:'Two',userId:'u2',workouts:['Gym']}];
 assert.deepEqual(Array.from(ctx.ForgeExperience.recommendedWorkouts()),['Run']);
 ctx.me={name:'Two',userId:'u2'};assert.deepEqual(Array.from(ctx.ForgeExperience.recommendedWorkouts()),['Gym']);
});
