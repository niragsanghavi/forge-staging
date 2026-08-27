#!/usr/bin/env node
// Forge QA kit — one read-only pass. Exits non-zero on any failure.
// Run from either repo root: node qa/check.mjs
import fs from 'node:fs';
import vm from 'node:vm';
import { execSync } from 'node:child_process';

const ROOT = process.cwd();
const has = p => fs.existsSync(`${ROOT}/${p}`);
if (!has('index.html')) { console.error('run from a Forge repo root'); process.exit(2); }
let fails = 0;
const P = (ok, msg) => { console.log((ok ? '  \x1b[32m✓\x1b[0m ' : '  \x1b[31m✗\x1b[0m ') + msg); if (!ok) fails++; };
const section = t => console.log(`\n\x1b[1m${t}\x1b[0m`);

// ─────────────────────────── 1. STATIC ───────────────────────────
section('1. STATIC');
const html = fs.readFileSync(`${ROOT}/index.html`, 'utf8');
P(![...html.split('\n')].some(l => /^(<{7}|={7}|>{7})( |$)/.test(l)), 'no git conflict markers');

const blocks = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map(m => m[1]);
const mods = ['src/state/appState.js','src/services/scoringEngine.js','src/config/firebase.js']
  .filter(has).map(p => fs.readFileSync(`${ROOT}/${p}`, 'utf8'));
let parseOK = true;
[...blocks, ...mods].forEach((code, i) => {
  try { new vm.Script(code); } catch (e) { parseOK = false; console.log(`     parse error in unit ${i}: ${e.message}`); }
});
P(parseOK, `all ${blocks.length} script blocks + ${mods.length} modules parse`);

const defs = {};
for (const m of html.matchAll(/^(?:async )?function ([A-Za-z_]\w*)\s*\(/gm)) defs[m[1]] = (defs[m[1]]||0)+1;
const dups = Object.entries(defs).filter(([,n]) => n > 1).map(([k]) => k);
P(dups.length === 0, dups.length ? `duplicate functions: ${dups}` : 'no duplicate function definitions');

const allSrc = html + mods.join('\n');
const called = new Set([...html.matchAll(/on(?:click|change|input|keydown|submit)="(?:if\(event[^"]*?\))?\s*([A-Za-z_]\w*)\s*\(/g)].map(m => m[1]));
const known = new Set(['this','event','fn']);
const missing = [...called].filter(c => !defs[c] && !new RegExp(`(?:window\\.)?${c}\\s*=\\s*(?:async )?(?:function|\\()`).test(allSrc) && !known.has(c));
P(missing.length === 0, missing.length ? `unresolved handlers: ${missing}` : `all ${called.size} onclick handlers resolve`);

// ─────────────────────────── 2. SCORING ──────────────────────────
section('2. SCORING (live prod data)');
const cfg = fs.readFileSync(`${ROOT}/src/config/firebase.js`, 'utf8');
const idx = cfg.indexOf('forge-25c8c');
const API = cfg.slice(Math.max(0, idx-400), idx+400).match(/apiKey:\s*"([^"]+)"/)[1];
const B = 'https://firestore.googleapis.com/v1/projects/forge-25c8c/databases/(default)/documents';
const val = v => { const k = Object.keys(v)[0];
  if (k==='integerValue') return +v[k]; if (k==='booleanValue') return v[k];
  if (k==='arrayValue') return (v[k].values||[]).map(val);
  if (k==='mapValue') { const o={}; for (const [a,b] of Object.entries(v[k].fields||{})) o[a]=val(b); return o; } return v[k]; };
const docOf = d => { const o={}; for (const [a,b] of Object.entries(d.fields||{})) o[a]=val(b); return o; };
try {
  const tok = (await (await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${API}`,
    { method:'POST', headers:{'Content-Type':'application/json'}, body:'{"returnSecureToken":true}' })).json()).idToken;
  const H = { 'Content-Type':'application/json', Authorization:'Bearer '+tok };
  const engineSrc = fs.readFileSync(`${ROOT}/src/services/scoringEngine.js`, 'utf8');
  const now = new Date(Date.now() + 5.5*3600*1000);
  const M = now.getUTCMonth()+1, Y = now.getUTCFullYear();
  for (const gc of ['75EKZT','AJ6W6B','BR0RRU','IPJEGE','LNLNLN']) {
    const season = docOf(await (await fetch(`${B}/groups/${gc}/seasons/${Y}-${String(M).padStart(2,'0')}`, { headers:H })).json());
    if (!season.roster) { P(false, `${gc}: no current season doc (${Y}-${M})`); continue; }
    const q = { structuredQuery: { from:[{collectionId:'logs'}], where:{ compositeFilter:{ op:'AND', filters:[
      {fieldFilter:{field:{fieldPath:'groupCode'},op:'EQUAL',value:{stringValue:gc}}},
      {fieldFilter:{field:{fieldPath:'month'},op:'EQUAL',value:{integerValue:String(M)}}},
      {fieldFilter:{field:{fieldPath:'year'},op:'EQUAL',value:{integerValue:String(Y)}}}]}}, limit:2000 } };
    const rows = await (await fetch(B+':runQuery', { method:'POST', headers:H, body:JSON.stringify(q) })).json();
    const logs = rows.filter(r=>r.document).map(r=>docOf(r.document)).filter(l=>l.voided!==true);
    const run = flag => {
      const ctx = { window:{}, console, groupCode:gc, seasonId:`${Y}-${M}` };
      vm.createContext(ctx); vm.runInContext(engineSrc, ctx);
      const s2 = {...season}; if (flag) s2.scoringV2 = true; else delete s2.scoringV2;
      const out = {}; let bad = false;
      for (const p of season.roster) {
        const r = ctx.window.score(p.name, { season:s2, logs, twistWindows:[], groupCode:gc });
        out[p.name] = r.total;
        const sum = r.base+r.sb+r.wb+r.rb+r.tb+r.b30+r.pen+r.bossBonus+r.dayBonuses+r.underdogBonus+r.jackBonus+r.ipBonus+r.kmBonus+(r.stepBonus||0);
        if (!Number.isFinite(r.total) || r.total !== Math.max(0, sum)) bad = true;
      }
      return { out, bad };
    };
    const off = run(false), on = run(true);
    const regress = Object.keys(off.out).filter(n => on.out[n] < off.out[n]);
    P(!off.bad && !on.bad && regress.length === 0,
      `${gc}: ${season.roster.length} members — totals reconcile, V2 Pareto`);
  }
} catch (e) { P(false, `scoring pass could not reach prod: ${e.message}`); }

// ─────────────────────────── 3. LIVE ─────────────────────────────
section('3. LIVE SITES');
for (const site of ['https://goforge.in','https://niragsanghavi.github.io/forge-staging']) {
  try {
    const cb = Math.floor(Date.now()/1000);
    const sw = await (await fetch(`${site}/sw.js?cb=${cb}`)).text();
    const ver = (sw.match(/CACHE_VERSION\s*=\s*'([^']+)'/) || [])[1] || '?';
    const rules = await fetch(`${site}/firestore.rules?cb=${cb}`);
    P(rules.status === 404, `${site.replace('https://','')} — cache ${ver}, rules 404 (not leaked)`);
  } catch (e) { P(false, `${site}: unreachable — ${e.message}`); }
}

console.log(`\n${fails ? '\x1b[31m'+fails+' FAILURE(S)\x1b[0m' : '\x1b[32mALL CHECKS PASS\x1b[0m'}`);
process.exit(fails ? 1 : 0);
