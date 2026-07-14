// R2 — scrub lingering plaintext PINs from world-readable season rosters.
//
// Plaintext PINs live ONLY on season roster entries:
//   groups/{code}/seasons/{sid}.roster[i].pin   (a 4-digit string)
// The users/{userId} doc never stores plaintext — only pinHash. Going forward
// the app writes no plaintext at all (index.html register/grace/create fixed);
// this script removes the historical values that are still readable by any
// anonymous token.
//
// SAFETY INVARIANT — never strip a credential we can't replace:
//   An entry's plaintext pin is nulled ONLY IF that entry resolves to a users
//   doc (through the mergedInto tombstone chain) whose pinHash is a valid
//   64-char SHA-256 hex. If the entry has no userId, or no canonical pinHash,
//   the plaintext is LEFT IN PLACE (it's that player's sole login credential —
//   the login fallback `entered === entry.pin`) and the skip is logged.
//
// Idempotent: a second run finds nothing to scrub. Scans ALL seasons (archived
// rosters are world-readable too), not just the current one.
//
// Usage:
//   node scripts/scrub-plaintext-pins.mjs --project=staging            # dry run
//   node scripts/scrub-plaintext-pins.mjs --project=staging --write    # apply
//   node scripts/scrub-plaintext-pins.mjs --project=prod               # dry run vs prod (read-only)
//   node scripts/scrub-plaintext-pins.mjs --project=prod --write       # PROD scrub (run deliberately, AFTER an export)

const CFG = {
  staging: { pid: 'forge-staging-865ff', key: 'AIzaSyD-bFi6X9Hevwmg-p65ajz35G64wco90CA' },
  prod:    { pid: 'forge-25c8c',         key: 'AIzaSyCIXojxM6N6f6kp10g7zYV5XYTyLJ6pz2g' },
};
const which = (process.argv.find(a=>a.startsWith('--project='))||'').split('=')[1];
const WRITE = process.argv.includes('--write');
const cfg = CFG[which];
if(!cfg){ console.error('Pass --project=staging | --project=prod  [--write]'); process.exit(1); }
const ROOT = `projects/${cfg.pid}/databases/(default)/documents`;
const HEX64 = /^[0-9a-f]{64}$/;

// throwaway anonymous session (season writes are gated on isAuthed())
const authRes = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${cfg.key}`, {
  method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ returnSecureToken:true })
});
if(!authRes.ok){ console.error('anon auth failed', authRes.status, await authRes.text()); process.exit(1); }
const { idToken } = await authRes.json();
const H = { 'Authorization': `Bearer ${idToken}`, 'Content-Type': 'application/json' };

// ---- tiny Firestore REST value codec (only the shapes rosters use) ----
function decode(v){
  if(v==null) return undefined;
  if('nullValue' in v) return null;
  if('stringValue' in v) return v.stringValue;
  if('booleanValue' in v) return v.booleanValue;
  if('integerValue' in v) return parseInt(v.integerValue,10);
  if('doubleValue' in v) return v.doubleValue;
  if('timestampValue' in v) return { __ts:v.timestampValue };
  if('arrayValue' in v) return (v.arrayValue.values||[]).map(decode);
  if('mapValue' in v) return Object.fromEntries(Object.entries(v.mapValue.fields||{}).map(([k,x])=>[k,decode(x)]));
  return undefined;
}
function encode(x){
  if(x===null || x===undefined) return { nullValue:null };
  if(typeof x==='boolean') return { booleanValue:x };
  if(typeof x==='number') return Number.isInteger(x)?{ integerValue:String(x) }:{ doubleValue:x };
  if(typeof x==='string') return { stringValue:x };
  if(x && x.__ts) return { timestampValue:x.__ts };
  if(Array.isArray(x)) return { arrayValue:{ values:x.map(encode) } };
  if(typeof x==='object') return { mapValue:{ fields:Object.fromEntries(Object.entries(x).map(([k,v])=>[k,encode(v)])) } };
  throw new Error('encode? '+typeof x);
}

async function listAll(coll){ // coll = collection path relative to ROOT
  let docs=[], pt=null;
  do{
    const u=new URL(`https://firestore.googleapis.com/v1/${ROOT}/${coll}`);
    u.searchParams.set('pageSize','300'); if(pt) u.searchParams.set('pageToken',pt);
    const r=await fetch(u,{headers:H}); const j=await r.json();
    if(!r.ok) throw new Error(`list ${coll}: ${JSON.stringify(j).slice(0,200)}`);
    docs=docs.concat(j.documents||[]); pt=j.nextPageToken;
  }while(pt);
  return docs;
}
async function getDoc(path){ const r=await fetch(`https://firestore.googleapis.com/v1/${ROOT}/${path}`,{headers:H}); return r.ok?await r.json():null; }
const idOf = name => name.split('/').pop();

// ---- resolve a userId through the mergedInto chain, return its pinHash ----
const userCache = new Map();
async function canonicalPinHash(userId){
  if(!userId) return null;
  let seen=new Set(), cur=userId;
  while(cur && !seen.has(cur)){
    seen.add(cur);
    let doc = userCache.get(cur);
    if(doc===undefined){ doc = await getDoc(`users/${cur}`); userCache.set(cur, doc); }
    if(!doc || !doc.fields) return null;
    const merged = doc.fields.mergedInto && decode(doc.fields.mergedInto);
    if(merged){ cur = merged; continue; }         // follow tombstone
    const ph = doc.fields.pinHash && decode(doc.fields.pinHash);
    return (typeof ph==='string' && HEX64.test(ph)) ? ph : null;
  }
  return null;
}

// ---- scan ----
// For every roster entry that has a working hash credential (canonical pinHash
// valid): strip any plaintext `pin` AND stamp `pinSet:true` (the non-secret
// login-routing sentinel the app now uses). Entries with plaintext but no valid
// hash are LEFT UNTOUCHED (plaintext is their sole credential). Idempotent.
const groups = await listAll('groups');
let scannedPlain=0, scrubbed=0, stamped=0, skippedNoUser=0, skippedNoHash=0, seasonsRewritten=0;
const skips=[];

for(const g of groups){
  const code = idOf(g.name);
  const seasons = await listAll(`groups/${code}/seasons`);
  for(const s of seasons){
    const sid = idOf(s.name);
    const roster = (s.fields && s.fields.roster) ? decode(s.fields.roster) : null;
    if(!Array.isArray(roster)) continue;
    let changed=false;
    for(const entry of roster){
      if(!entry) continue;
      const hasPlain = entry.pin!=null && entry.pin!=='';
      if(hasPlain) scannedPlain++;
      const ph = await canonicalPinHash(entry.userId);
      if(ph){
        // credential confirmed → safe to strip plaintext and stamp the sentinel
        if(hasPlain){ entry.pin=null; scrubbed++; changed=true; }
        if(entry.pinSet!==true){ entry.pinSet=true; stamped++; changed=true; }
      } else if(hasPlain){
        // plaintext present but no valid hash fallback → never strip it
        if(!entry.userId){ skippedNoUser++; skips.push(`${code}/${sid} "${entry.name}" — no userId (plaintext is sole credential)`); }
        else { skippedNoHash++; skips.push(`${code}/${sid} "${entry.name}" — userId ${entry.userId} has no valid pinHash`); }
      }
      // entries with neither plaintext nor hash: no credential — left for grace flow
    }
    if(changed){
      seasonsRewritten++;
      if(WRITE){
        const r=await fetch(`https://firestore.googleapis.com/v1/${ROOT}/groups/${code}/seasons/${sid}?updateMask.fieldPaths=roster`,{
          method:'PATCH', headers:H, body:JSON.stringify({ fields:{ roster: encode(roster) } })
        });
        if(!r.ok){ console.error(`WRITE FAIL ${code}/${sid}`, r.status, (await r.text()).slice(0,200)); process.exit(1); }
        console.log(`  normalized roster ${code}/${sid}`);
      } else {
        console.log(`  [dry-run] would normalize roster ${code}/${sid}`);
      }
    }
  }
}

console.log(`\n[${cfg.pid}] plaintext-PIN scrub ${WRITE?'(APPLIED)':'(DRY RUN)'}`);
console.log(`  entries carrying plaintext     : ${scannedPlain}`);
console.log(`  plaintext nulled (hash exists) : ${scrubbed}`);
console.log(`  pinSet:true stamped            : ${stamped}  across ${seasonsRewritten} season roster(s)`);
console.log(`  SKIPPED — no userId            : ${skippedNoUser}`);
console.log(`  SKIPPED — no valid pinHash     : ${skippedNoHash}`);
if(skips.length){ console.log('  skip detail:'); skips.forEach(s=>console.log('    - '+s)); }
if(!WRITE) console.log('\n  DRY RUN — nothing written. Add --write to apply.');
