// Imported only by --live. Staging is deliberately fixed; never creates Auth users.
import vm from 'node:vm';
export const PROJECT = 'forge-staging-865ff';
export const SITE = 'https://niragsanghavi.github.io/forge-staging/';
const BASE = 'https://firestore.googleapis.com/v1/projects/' + PROJECT + '/databases/(default)/documents';
export const COMPONENTS = ['base','sb','wb','rb','tb','b30','pen','bossBonus',
  'dayBonuses','underdogBonus','jackBonus','ipBonus','kmBonus','stepBonus'];

export function decode(value) {
  if ('nullValue' in value) return null;
  if ('stringValue' in value) return value.stringValue;
  if ('booleanValue' in value) return value.booleanValue;
  if ('integerValue' in value || 'doubleValue' in value) {
    const n = Number(value.integerValue ?? value.doubleValue);
    if (!Number.isFinite(n)) throw Error('Non-finite Firestore number');
    return n;
  }
  if ('timestampValue' in value) return value.timestampValue;
  if ('referenceValue' in value) return value.referenceValue;
  if ('arrayValue' in value) return (value.arrayValue.values || []).map(decode);
  if ('mapValue' in value) return Object.fromEntries(Object.entries(value.mapValue.fields || {}).map(([k,v])=>[k,decode(v)]));
  throw Error('Unsupported Firestore field type');
}
function document(doc) {
  if (!doc || typeof doc.name !== 'string' || !doc.name.startsWith(BASE.slice('https://firestore.googleapis.com/v1/'.length) + '/')) throw Error('Invalid document response');
  return {...decode({mapValue:{fields:doc.fields || {}}}), id:doc.name.split('/').at(-1)};
}
export function reader(fetcher, token) {
  if (!token) throw Error('FORGE_QA_ACCESS_TOKEN missing; live scoring was NOT verified');
  async function request(url, body) {
    const response = await fetcher(url, {method:body ? 'POST' : 'GET',
      headers:{Authorization:'Bearer '+token, 'Content-Type':'application/json'},
      ...(body ? {body:JSON.stringify(body)} : {}), redirect:'error', signal:AbortSignal.timeout(20000)});
    if (!response.ok) throw Error('Firestore read failed (HTTP '+response.status+')');
    return response.json();
  }
  return {
    async get(relative) { return document(await request(BASE+'/'+relative)); },
    async list(relative) {
      const result=[], seen=new Set(); let cursor='';
      for (let page=0; page<1000; page++) {
        const body=await request(BASE+'/'+relative+'?pageSize=300'+(cursor?'&pageToken='+encodeURIComponent(cursor):''));
        if (body.documents !== undefined && !Array.isArray(body.documents)) throw Error('Invalid collection response');
        result.push(...(body.documents || []).map(document));
        cursor=body.nextPageToken;
        if (!cursor) return result;
        if (seen.has(cursor)) throw Error('Repeated page token');
        seen.add(cursor);
      }
      throw Error('Collection pagination exceeded safety limit');
    },
    async scoped(collection, code, season) {
      const result=[]; let cursor; const seen=new Set();
      for (let page=0; page<1000; page++) {
        const fields=[['groupCode',{stringValue:code}],['month',{integerValue:String(season.month)}],['year',{integerValue:String(season.year)}]];
        const query={from:[{collectionId:collection}],
          where:{compositeFilter:{op:'AND',filters:fields.map(([fieldPath,value])=>({fieldFilter:{field:{fieldPath},op:'EQUAL',value}}))}},
          orderBy:[{field:{fieldPath:'__name__'},direction:'ASCENDING'}],limit:300,
          ...(cursor?{startAt:{values:[{referenceValue:cursor}],before:false}}:{})};
        const rows=await request(BASE+':runQuery',{structuredQuery:query});
        if (!Array.isArray(rows) || rows.some(r=>r.error || (!r.document && !r.readTime))) throw Error('Invalid query response');
        const docs=rows.filter(r=>r.document).map(r=>r.document);
        result.push(...docs.map(document));
        if (docs.length<300) return result;
        cursor=docs.at(-1).name;
        if (seen.has(cursor)) throw Error('Repeated query cursor');
        seen.add(cursor);
      }
      throw Error('Query pagination exceeded safety limit');
    }
  };
}

// Calendar scoring uses Indian calendar dates, independent of the QA host timezone.
export function scoringDate(now) {
  const instant = new Date(now).valueOf();
  if (!Number.isFinite(instant)) throw Error('Invalid scoring clock');
  return class extends Date {
    constructor(...args) {
      super(args.length > 1 ? Date.UTC(...args) : args.length ? args[0] : instant + 19800000);
    }
    getDate(){return this.getUTCDate();}
    getDay(){return this.getUTCDay();}
    getMonth(){return this.getUTCMonth();}
    getFullYear(){return this.getUTCFullYear();}
    static now(){return instant;}
  };
}
export function scorer(source, now) {
  const context=vm.createContext({window:{},Date:scoringDate(now)});
  new vm.Script(source).runInContext(context,{timeout:2000});
  return (player,ctx)=>{
    context.input=structuredClone({player,ctx});
    return new vm.Script('window.score(input.player, input.ctx)').runInContext(context,{timeout:2000});
  };
}
export function assertScore(score) {
  if (!score || !Number.isFinite(score.total) || COMPONENTS.some(k=>!Number.isFinite(score[k]))) throw Error('Missing/non-finite score component');
  const sum=Math.max(0,COMPONENTS.reduce((n,k)=>n+score[k],0));
  if (Math.abs(sum-score.total)>1e-8) throw Error('Score components do not reconcile');
}
export async function reconcile(db, score) {
  const groups=(await db.list('groups')).filter(g=>!g.deletedAt && !g.archived && g.active!==false && !['archived','deleted','inactive'].includes(g.status));
  if (!groups.length) throw Error('No active groups found; scoring was NOT verified');
  let members=0;
  for (const group of groups) {
    if (!/^[A-Za-z0-9_-]+$/.test(group.id) || !/^\d{4}-\d{2}$/.test(group.currentSeasonId || '')) throw Error('Active group has invalid current season');
    const prefix='groups/'+group.id+'/seasons/'+group.currentSeasonId;
    const season=await db.get(prefix);
    if (!Number.isInteger(season.year) || !Number.isInteger(season.month) || season.month<1 || season.month>12 ||
        group.currentSeasonId!==season.year+'-'+String(season.month).padStart(2,'0') ||
        !Array.isArray(season.roster) || !season.roster.length || season.roster.some(p=>!p || typeof p.name!=='string' || !p.name)) throw Error('Active season/roster is incomplete');
    const [logs,bonuses,ironPledgeBonuses,twistDocs,jackAwards,twistWindows]=await Promise.all([
      db.scoped('logs',group.id,season),db.scoped('bonuses_30day',group.id,season),
      db.scoped('bonuses_iron_pledge',group.id,season),db.list(prefix+'/twists'),
      db.list(prefix+'/jackAwards'),db.list(prefix+'/twistWindows')]);
    const ctx={season,groupCode:group.id,logs,bonuses,ironPledgeBonuses,
      twists:Object.fromEntries(twistDocs.map(d=>[d.id,d])),jackAwards,twistWindows};
    for (const player of season.roster) {
      const old=score(player,{...ctx,season:{...season,scoringV2:false}});
      const next=score(player,{...ctx,season:{...season,scoringV2:true}});
      assertScore(old); assertScore(next);
      if (next.total<old.total) throw Error('scoringV2 lowers a member score');
      members++;
    }
  }
  return {groups:groups.length,members};
}
export async function deployedSite(fetcher=fetch) {
  const opts={redirect:'error',cache:'no-store',signal:AbortSignal.timeout(20000)};
  const sw=await fetcher(SITE+'sw.js?qa='+Date.now(),opts);
  if (sw.status!==200) throw Error('Deployed service worker HTTP '+sw.status);
  const match=(await sw.text()).match(/\bCACHE_VERSION\s*=\s*['"]([^'"]+)['"]/);
  if (!match) throw Error('Deployed CACHE_VERSION missing');
  const rules=await fetcher(SITE+'firestore.rules?qa='+Date.now(),{...opts,signal:AbortSignal.timeout(20000)});
  if (rules.status!==404) throw Error('Deployed firestore.rules must return 404; got '+rules.status);
  return match[1];
}
export async function runLiveChecks({engineSource,check,fetcher=fetch,token=process.env.FORGE_QA_ACCESS_TOKEN,now=new Date().toISOString()}) {
  try {
    const version=await deployedSite(fetcher);
    check(true,'Deployed staging CACHE_VERSION: '+version+'; firestore.rules HTTP 404');
  } catch(e) {check(false,'Deployed staging check: '+e.message);}
  try {
    const result=await reconcile(reader(fetcher,token),scorer(engineSource,now));
    check(true,'Live staging: '+result.groups+' active groups / '+result.members+' members reconciled in both scoring modes');
  } catch(e) {
    // Fetch errors can include URLs; never print credentials, raw documents or names.
    check(false,'Live scoring: '+(e.message.startsWith('fetch') ? 'network request failed' : e.message));
  }
}
