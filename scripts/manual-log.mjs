// manual-log.mjs — DESPERATE MEASURES backlog writer.
//
// Writes ONE properly-shaped log doc for ANY date, bypassing Firestore rules
// via owner IAM. This is the escape hatch for when the in-app 7-day backlog
// clamp legitimately needs to be overridden (someone was travelling, a phone
// died, a season needs repairing) — not a routine tool.
//
// It writes the SAME schema submitLog writes: groupCode, player, team, role,
// workouts[], day, month, year, timestamp, uid, userId — plus demo:true when
// (and only when) the target group is flagged demo, so a demo group's manual
// logs stay out of the shared aggregates exactly like in-app ones.
//
// It deliberately does NOT touch stats/global, the daily rollup or the monthly
// rollup. Those are recomputed/back-filled by the app (writeGlobalStats /
// writeMonthlyRollup run on a debounce whenever any member of the group is
// active), so a manual log self-heals into the aggregates on next activity.
//
// AUTH — same pattern as the other scripts in this folder: an owner access
// token from gcloud. No secrets live in this file.
//
//   export OWNER_TOKEN="$(gcloud auth print-access-token)"
//
// USAGE
//   node scripts/manual-log.mjs --project=staging --group=7BYRZY \
//        --player="Wes" --date=2026-07-04 --workouts="Gym,Run"
//   node scripts/manual-log.mjs --project=prod --group=IPJEGE \
//        --player="Nirag" --date=2026-06-28 --workouts="Padel" --write
//
//   --project   staging | prod            (REQUIRED)
//   --group     canonical group code      (REQUIRED — aliases are not resolved)
//   --player    exact roster name         (REQUIRED — case-insensitive match)
//   --date      YYYY-MM-DD                (REQUIRED)
//   --workouts  comma-separated list      (REQUIRED)
//   --write     actually write            (omit for a DRY RUN — default)
//
// SAFETY
//   * Refuses if the group, its season for that month, or the player is missing.
//   * Refuses if the date's month/year has no matching season on that group
//     (a log must belong to a season that exists, or scoring will never see it).
//   * DRY RUN by default: prints the exact doc it would write, changes nothing.

const CFG = {
  staging: { pid: 'forge-staging-865ff' },
  prod:    { pid: 'forge-25c8c' },
};

const arg = (k) => { const a = process.argv.find(x => x.startsWith(`--${k}=`)); return a ? a.slice(k.length + 3) : null; };
const WRITE = process.argv.includes('--write');

const which = arg('project');
const group = (arg('group') || '').toUpperCase();
const player = arg('player') || '';
const date = arg('date') || '';
const workouts = (arg('workouts') || '').split(',').map(s => s.trim()).filter(Boolean);

const cfg = CFG[which];
if (!cfg)                             fail('Pass --project=staging or --project=prod');
if (!group)                           fail('Pass --group=CODE');
if (!player)                          fail('Pass --player="Name"');
if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) fail('Pass --date=YYYY-MM-DD');
if (!workouts.length)                 fail('Pass --workouts="A,B"');
if (workouts.some(w => /[<>"'\\]/.test(w))) fail('Workout names cannot contain < > " \' \\');

const TOKEN = process.env.OWNER_TOKEN;
if (!TOKEN) fail('OWNER_TOKEN not set.  export OWNER_TOKEN="$(gcloud auth print-access-token)"');

const ROOT = `projects/${cfg.pid}/databases/(default)/documents`;
const H = { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' };

function fail(msg) { console.error('✗ ' + msg); process.exit(1); }

// ── minimal Firestore REST value codec ──
const S = v => ({ stringValue: String(v) });
const I = v => ({ integerValue: String(v) });
const dec = v => v == null ? null
  : 'stringValue' in v ? v.stringValue
  : 'integerValue' in v ? +v.integerValue
  : 'booleanValue' in v ? v.booleanValue
  : 'doubleValue' in v ? v.doubleValue
  : 'timestampValue' in v ? v.timestampValue
  : 'arrayValue' in v ? (v.arrayValue.values || []).map(dec)
  : 'mapValue' in v ? Object.fromEntries(Object.entries(v.mapValue.fields || {}).map(([k, x]) => [k, dec(x)]))
  : 'nullValue' in v ? null : undefined;

async function getDoc(path) {
  const r = await fetch(`https://firestore.googleapis.com/v1/${ROOT}/${path}`, { headers: H });
  if (r.status === 404) return null;
  if (!r.ok) fail(`read ${path} → ${r.status} ${(await r.text()).slice(0, 200)}`);
  const j = await r.json();
  return Object.fromEntries(Object.entries(j.fields || {}).map(([k, v]) => [k, dec(v)]));
}

const [year, month, day] = date.split('-').map(Number);

// ── resolve group ──
const g = await getDoc(`groups/${group}`);
if (!g) fail(`group ${group} does not exist in ${cfg.pid}`);

// ── resolve the season that owns this date ──
const sid = `${year}-${String(month).padStart(2, '0')}`;
const season = await getDoc(`groups/${group}/seasons/${sid}`);
if (!season) fail(`group ${group} has no season ${sid} — a log for ${date} would never be scored.`);

// ── resolve the player on THAT season's roster ──
const roster = Array.isArray(season.roster) ? season.roster : [];
const entry = roster.find(p => p && p.name && p.name.toLowerCase() === player.toLowerCase());
if (!entry) fail(`player "${player}" is not on ${group}'s ${sid} roster (${roster.map(p => p.name).join(', ') || 'empty'})`);

const isDemo = g.demo === true;
const docFields = {
  groupCode: S(group),
  player:    S(entry.name),           // canonical casing from the roster
  team:      S(entry.team || 'A'),
  role:      S(entry.role || 'Player'),
  workouts:  { arrayValue: { values: workouts.map(S) } },
  day:       I(day),
  month:     I(month),
  year:      I(year),
  // Submit-time stamp. The workout DATE lives in day/month/year; timestamp is
  // when the row was created, matching submitLog's serverTimestamp semantics.
  timestamp: { timestampValue: new Date().toISOString() },
  uid:       { nullValue: null },     // no device session behind a manual write
  userId:    entry.userId ? S(entry.userId) : { nullValue: null },
  ...(isDemo ? { demo: { booleanValue: true } } : {}),
  // provenance so these are auditable/greppable later
  manualEntry: { booleanValue: true },
};

const preview = Object.fromEntries(Object.entries(docFields).map(([k, v]) => [k, dec(v)]));
console.log(`\n[${cfg.pid}] ${group} · ${sid} · ${entry.name} (team ${entry.team}, ${entry.userId || 'no userId'})${isDemo ? ' · DEMO GROUP' : ''}`);
console.log('doc to write:\n' + JSON.stringify(preview, null, 2));

if (!WRITE) { console.log('\nDRY RUN — nothing written. Add --write to commit it.\n'); process.exit(0); }

const r = await fetch(`https://firestore.googleapis.com/v1/${ROOT}/logs`, {
  method: 'POST', headers: H, body: JSON.stringify({ fields: docFields }),
});
if (!r.ok) fail(`write failed → ${r.status} ${(await r.text()).slice(0, 300)}`);
const written = await r.json();
const id = written.name.split('/').pop();
console.log(`\n✓ WROTE logs/${id}`);
console.log('  Aggregates (stats/global, daily + monthly rollups) are NOT touched here —');
console.log('  they self-heal the next time any member of this group opens the app.\n');
