import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {spawnSync} from 'node:child_process';
import {COMPONENTS,PROJECT,SITE,decode,reader,assertScore,reconcile,scorer,scoringDate,deployedSite,runLiveChecks} from './live-checks.mjs';
const root=new URL('../',import.meta.url);
const source=fs.readFileSync(new URL('../src/services/scoringEngine.js',import.meta.url),'utf8');
const zero=()=>Object.fromEntries([...COMPONENTS,'total'].map(k=>[k,0]));
const name=id=>'projects/'+PROJECT+'/databases/(default)/documents/'+id;
const doc=id=>({name:name(id),fields:{value:{integerValue:'5'}}});
const reply=(body,status=200)=>new Response(JSON.stringify(body),{status});
function database() {
  const calls=[];
  return {calls,
    list:async p=>{calls.push(p);return p==='groups'?[{id:'ONE',currentSeasonId:'2026-09'},{id:'TWO',currentSeasonId:'2026-09'},{id:'OLD',archived:true}]:p.endsWith('/twists')?[{id:'bonus_workout',enabled:true}]:[{id:'award'}];},
    get:async()=>({month:9,year:2026,days:30,roster:[{name:'A',team:1},{name:'B',team:2}]}),
    scoped:async (c,g,s)=>{calls.push([c,g,s.month]);return [{id:c}];}
  };
}
test('default QA and package test entry remain offline; invalid flags fail closed',()=>{
  const pkg=JSON.parse(fs.readFileSync(new URL('../package.json',import.meta.url)));
  assert.equal(pkg.type,'module');
  assert.equal(pkg.scripts.test,'node qa/check.mjs && node --test qa/*.test.mjs');
  const env={...process.env,FORGE_QA_ACCESS_TOKEN:''};
  const noNetwork='data:text/javascript,'+encodeURIComponent('globalThis.fetch=()=>process.exit(97)');
  const result=spawnSync(process.execPath,['--import',noNetwork,'qa/check.mjs'],{cwd:root,encoding:'utf8',env});
  assert.equal(result.status,0,result.stdout+result.stderr);
  assert.match(result.stdout,/OFFLINE CHECKS PASS/);
  for(const args of [['--other'],['--live','--live'],['--live','--production']]) {
    assert.equal(spawnSync(process.execPath,['qa/check.mjs',...args],{cwd:root,env}).status,2);
  }
});
test('Firestore values decode explicitly; unsupported/nonfinite values fail',()=>{
  assert.deepEqual(decode({mapValue:{fields:{a:{arrayValue:{values:[{integerValue:'3'},{booleanValue:true},{nullValue:null}]}}}}}),{a:[3,true,null]});
  assert.equal(decode({timestampValue:'2026-09-20'}),'2026-09-20');
  assert.throws(()=>decode({doubleValue:'NaN'}),/Non-finite/);
  assert.throws(()=>decode({unknown:1}),/Unsupported/);
});
test('REST reader is staging-only, paginated and uses existing credentials without signup',async()=>{
  const requests=[];
  const db=reader(async(url,opts)=>{
    requests.push([url,opts]);
    return reply(url.includes('pageToken')?{documents:[doc('groups/B')]}:{documents:[doc('groups/A')],nextPageToken:'next'});
  },'test-token');
  assert.deepEqual((await db.list('groups')).map(d=>d.id),['A','B']);
  for(const [url,opts] of requests) {
    assert.ok(url.includes(PROJECT));assert.equal(opts.method,'GET');
    assert.equal(opts.redirect,'error');assert.equal(opts.headers.Authorization,'Bearer test-token');
  }
  assert.throws(()=>reader(()=>assert.fail('unexpected fetch'),''),/NOT verified/);
});
test('query reads complete pages with exclusive cursors and scoped filters',async()=>{
  const bodies=[];
  const db=reader(async(url,opts)=>{
    assert.ok(url.endsWith(':runQuery'));assert.equal(opts.method,'POST');
    const body=JSON.parse(opts.body);bodies.push(body.structuredQuery);
    return reply(bodies.length===1?Array.from({length:300},(_,i)=>({document:doc('logs/'+i)})):[{document:doc('logs/final')}]);
  },'test');
  assert.equal((await db.scoped('logs','ONE',{month:9,year:2026})).length,301);
  assert.equal(bodies[0].where.compositeFilter.filters.length,3);
  assert.deepEqual(bodies[1].startAt,{values:[{referenceValue:name('logs/299')}],before:false});
});
test('denied, malformed and repeating reads cannot pass',async()=>{
  await assert.rejects(reader(async()=>reply({},403),'test').list('groups'),/HTTP 403/);
  await assert.rejects(reader(async()=>reply({documents:'bad'}),'test').list('groups'),/Invalid/);
  await assert.rejects(reader(async()=>reply({nextPageToken:'loop'}),'test').list('groups'),/Repeated/);
  await assert.rejects(reader(async()=>reply([{error:{message:'secret'}}]),'test').scoped('logs','A',{}),/Invalid/);
  await assert.rejects(reader(async()=>reply({name:'projects/production/documents/x'}),'test').get('groups/A'),/Invalid/);
});
test('reconciliation covers every active roster in both modes with full bonus context',async()=>{
  const db=database(),modes=[];
  const result=await reconcile(db,(player,ctx)=>{
    modes.push(ctx.season.scoringV2);
    for(const key of ['logs','bonuses','ironPledgeBonuses','jackAwards','twistWindows']) assert.equal(ctx[key].length,1);
    assert.equal(ctx.twists.bonus_workout.enabled,true);
    return zero();
  });
  assert.deepEqual(result,{groups:2,members:4});
  assert.deepEqual(modes,[false,true,false,true,false,true,false,true]);
});
test('zero-floor is valid; missing, inconsistent and nonfinite score components fail',()=>{
  assertScore({...zero(),pen:-5});
  assert.throws(()=>assertScore({...zero(),total:5}),/reconcile/);
  assert.throws(()=>assertScore({...zero(),base:undefined}),/component/);
  assert.throws(()=>assertScore({...zero(),base:NaN}),/component/);
});
test('V2 regressions, no groups, missing seasons and empty rosters fail rather than skip',async()=>{
  await assert.rejects(reconcile(database(),(_,ctx)=>({...zero(),base:ctx.season.scoringV2?0:5,total:ctx.season.scoringV2?0:5})),/lowers/);
  await assert.rejects(reconcile({...database(),list:async()=>[]},zero),/NOT verified/);
  await assert.rejects(reconcile({...database(),list:async()=>[{id:'A'}]},zero),/invalid current season/);
  await assert.rejects(reconcile({...database(),get:async()=>({year:2026,month:9,roster:[]})},zero),/incomplete/);
});
test('real engine reconciles synthetic complete fixtures in both modes',()=>{
  const fixtures=JSON.parse(fs.readFileSync(new URL('./fixtures/offline-scoring.json',import.meta.url)));
  const scenarios=Array.isArray(fixtures)?fixtures:fixtures.scenarios;
  assert.ok(scenarios.length);
  for(const fixture of scenarios) {
    const score=scorer(source,fixture.now);
    const ctx={season:fixture.season,logs:fixture.logs,groupCode:fixture.groupCode,
      twists:{},bonuses:[],jackAwards:[],ironPledgeBonuses:[],twistWindows:fixture.twistWindows||[]};
    const old=score(fixture.player,{...ctx,season:{...ctx.season,scoringV2:false}});
    const next=score(fixture.player,{...ctx,season:{...ctx.season,scoringV2:true}});
    assertScore(old);assertScore(next);assert.ok(next.total>=old.total);
  }
});
test('scoring clock observes Indian midnight and exact month lengths',()=>{
  const DateIST=scoringDate('2026-09-30T18:30:00Z');
  assert.equal(new DateIST().getMonth(),9);assert.equal(new DateIST().getDate(),1);
  assert.equal(new DateIST(2026,9,0).getDate(),30);
  assert.equal(new DateIST(2026,8,1).getDay(),2);
});
test('deployed site reports actual cache version and requires exact rules 404',async()=>{
  const fetcher=async(url,opts)=>{
    assert.ok(url.startsWith(SITE));assert.equal(opts.redirect,'error');
    return url.includes('sw.js')?new Response("const CACHE_VERSION = 'forge-staging-test';"):new Response('',{status:404});
  };
  assert.equal(await deployedSite(fetcher),'forge-staging-test');
  for(const status of [200,301,403,500]) {
    await assert.rejects(deployedSite(async url=>url.includes('sw.js')?new Response("const CACHE_VERSION='test';"):new Response('',{status})),/must return 404/);
  }
  await assert.rejects(deployedSite(async()=>new Response('html')),/CACHE_VERSION missing/);
  await assert.rejects(deployedSite(async()=>new Response('',{status:503})),/HTTP 503/);
});
test('missing credential still runs public site verification and explicitly fails scoring',async()=>{
  const outcomes=[];
  await runLiveChecks({engineSource:source,token:'',check:(...x)=>outcomes.push(x),
    fetcher:async url=>url.includes('sw.js')?new Response("const CACHE_VERSION='test';"):new Response('',{status:404})});
  assert.equal(outcomes[0][0],true);assert.equal(outcomes[1][0],false);
  assert.match(outcomes[1][1],/NOT verified/);
});
