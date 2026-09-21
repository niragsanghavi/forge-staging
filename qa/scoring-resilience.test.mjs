import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source=fs.readFileSync(new URL('../src/services/scoringEngine.js',import.meta.url),'utf8');
const runtime={Date,groupCode:'QA'};runtime.window=runtime;vm.createContext(runtime);vm.runInContext(source,runtime);
const base=()=>({groupCode:'QA',season:{month:9,year:2026,days:30,minWorkouts:0,rolesEnabled:false,roster:[{name:'A',team:'A'}]},logs:[],twists:{},bonuses:[],jackAwards:[],ironPledgeBonuses:[],twistWindows:[]});
const log=(extra={})=>({id:'one',player:'A',day:1,month:9,year:2026,groupCode:'QA',workouts:['Walk'],...extra});
test('explicit empty or malformed workouts cannot earn points',()=>{
 for(const workouts of [[],[null],[123],[''],['Walk',null],{},null]){const c=base();c.logs=[log({workouts})];assert.equal(runtime.score('A',c).base,0);}
 const c=base();c.logs=[{player:'A',day:1}];assert.equal(runtime.score('A',c).base,5,'preserve historical missing-field records');
});
test('null roster and awards are ignored without dropping valid data',()=>{
 const c=base();c.season.roster.push(null,{},123);c.logs=[log()];c.bonuses=[null,{player:'A'}];c.jackAwards=[null];
 assert.equal(runtime.score('A',c).base,5);assert.equal(runtime.score('A',c).b30,50);
});
test('bonus-workout and underdog malformed fields never crash',()=>{
 for(const workout of [null,{},123,'']){const c=base();c.logs=[log()];c.twists={bonus_workout:{enabled:true,workout}};c.twistWindows=[{twist:'underdog_week',month:9,year:2026,monDate:1,sunDate:7,frozenPlayers:{}}];assert.equal(runtime.score('A',c).base,5);}
 const c=base();c.logs=[log({workouts:[null]})];c.twists={bonus_workout:{enabled:true,workout:'walk'}};assert.equal(runtime.score('A',c).total,0);
});
test('identified duplicate distance events do not pay twice; distinct events still count',()=>{
 const c=base();c.season.kmTarget=3;c.logs=[log({km:2}),log({km:2})];assert.equal(runtime.score('A',c).myKm,2);assert.equal(runtime.score('A',c).kmBonus,0);
 c.logs=[log({km:2}),log({id:'two',km:2})];assert.equal(runtime.score('A',c).myKm,4);assert.equal(runtime.score('A',c).kmBonus,15);
});
test('invalid collection shapes fail closed and cached results remain protected',()=>{
 const c=base();c.logs={};c.bonuses={};c.jackAwards={};c.ironPledgeBonuses={};c.twistWindows={};assert.equal(runtime.score('A',c).total,0);
 c.logs=[log()];const a=runtime.score('A',c);a.days.add(20);assert.equal(runtime.score('A',c).days.has(20),false);
});
test('server and browser run byte-identical scoring implementation',()=>{
 const server=fs.readFileSync(new URL('../functions-identity/scoring-engine.js',import.meta.url),'utf8');assert.ok(server.includes(source.trimEnd()));
});
