// Seed stats/global {totalLogs, totalUsers, updatedAt} — the 1-read counter
// doc behind the goforge.in/app live stat strip.
//
//   totalLogs  = log docs that are NOT voided:true   (tombstones excluded)
//   totalUsers = users docs WITHOUT mergedInto        (canonical identities)
//
// Counting uses Firestore aggregation queries (COUNT), so a full run costs
// ~4 read units regardless of collection size. Auth is a throwaway anonymous
// session (same as any app visitor) because reads/writes are isAuthed-gated.
//
// Usage:
//   node scripts/seed-global-counter.mjs --project=staging          # dry run (compute + print)
//   node scripts/seed-global-counter.mjs --project=staging --write  # compute + write stats/global
//   node scripts/seed-global-counter.mjs --project=prod             # dry run against prod (read-only)
//   node scripts/seed-global-counter.mjs --project=prod --write     # SEED PROD (run deliberately)

const CFG = {
  staging: { pid: 'forge-staging-865ff', key: 'AIzaSyD-bFi6X9Hevwmg-p65ajz35G64wco90CA' },
  prod:    { pid: 'forge-25c8c',         key: 'AIzaSyCIXojxM6N6f6kp10g7zYV5XYTyLJ6pz2g' },
};
const which = (process.argv.find(a=>a.startsWith('--project='))||'').split('=')[1];
const WRITE = process.argv.includes('--write');
const cfg = CFG[which];
if(!cfg){ console.error('Pass --project=staging | --project=prod'); process.exit(1); }
const ROOT = `projects/${cfg.pid}/databases/(default)/documents`;

// throwaway anonymous auth session (rules: reads/writes need request.auth != null)
const authRes = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${cfg.key}`, {
  method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ returnSecureToken:true })
});
if(!authRes.ok){ console.error('anon auth failed', authRes.status, await authRes.text()); process.exit(1); }
const { idToken } = await authRes.json();
const H = { 'Authorization': `Bearer ${idToken}`, 'Content-Type': 'application/json' };

async function countQuery(collectionId, where){
  const sq = { from:[{ collectionId }] };
  if(where) sq.where = where;
  const r = await fetch(`https://firestore.googleapis.com/v1/${ROOT}:runAggregationQuery`, {
    method:'POST', headers:H,
    body: JSON.stringify({ structuredAggregationQuery: { structuredQuery: sq, aggregations:[{ count:{}, alias:'c' }] } })
  });
  const j = await r.json();
  if(!r.ok) throw new Error(`count(${collectionId}) failed: ${JSON.stringify(j).slice(0,300)}`);
  const row = (Array.isArray(j)?j:[j]).find(x=>x.result);
  return parseInt(row.result.aggregateFields.c.integerValue, 10);
}

const eq  = (f,v)=>({ fieldFilter:{ field:{fieldPath:f}, op:'EQUAL', value:{ booleanValue:v } } });
const gte = (f,v)=>({ fieldFilter:{ field:{fieldPath:f}, op:'GREATER_THAN_OR_EQUAL', value:{ stringValue:v } } });

const logsAll     = await countQuery('logs');
const logsVoided  = await countQuery('logs', eq('voided', true));
const usersAll    = await countQuery('users');
const tombstones  = await countQuery('users', gte('mergedInto', ''));  // matches every doc that HAS the field
const totalLogs   = logsAll - logsVoided;
const totalUsers  = usersAll - tombstones;

console.log(`[${cfg.pid}] logs: ${logsAll} total − ${logsVoided} voided = ${totalLogs}`);
console.log(`[${cfg.pid}] users: ${usersAll} total − ${tombstones} tombstones = ${totalUsers}`);

if(!WRITE){ console.log('DRY RUN — nothing written. Add --write to seed stats/global.'); process.exit(0); }

const w = await fetch(`https://firestore.googleapis.com/v1/${ROOT}/stats/global`, {
  method:'PATCH', headers:H,
  body: JSON.stringify({ fields:{
    totalLogs:  { integerValue: String(totalLogs) },
    totalUsers: { integerValue: String(totalUsers) },
    updatedAt:  { timestampValue: new Date().toISOString() },
  }})
});
if(!w.ok){ console.error('WRITE FAILED', w.status, await w.text()); process.exit(1); }
console.log(`WROTE ${ROOT}/stats/global  { totalLogs: ${totalLogs}, totalUsers: ${totalUsers} }`);
