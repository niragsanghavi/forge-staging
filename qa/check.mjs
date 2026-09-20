#!/usr/bin/env node
// Forge offline QA — local files and synthetic data only. No network or auth.
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
if (args.length) {
  console.error(`Unknown option(s): ${args.join(' ')}\nUsage: node qa/check.mjs`);
  process.exit(2);
}

const ROOT = process.cwd();
const ownPath = fileURLToPath(import.meta.url);
const ownRoot = path.resolve(path.dirname(ownPath), '..');
if (path.resolve(ROOT) !== ownRoot || !fs.existsSync(path.join(ROOT, 'index.html'))) {
  console.error('Run from the Forge repository root: node qa/check.mjs');
  process.exit(2);
}

let failures = 0;
let checks = 0;
const check = (ok, message) => {
  checks++;
  console.log(`${ok ? '  ✓' : '  ✗'} ${message}`);
  if (!ok) failures++;
};
const section = title => console.log(`\n${title}`);
const read = relative => fs.readFileSync(path.join(ROOT, relative), 'utf8');

function parseScript(source, label) {
  try {
    new vm.Script(source, { filename: label });
    return true;
  } catch (error) {
    console.log(`     parse error in ${label}: ${error.message}`);
    return false;
  }
}

function fixedDate(iso) {
  return class FixedDate extends Date {
    constructor(...args) { super(...(args.length ? args : [iso])); }
    static now() { return new Date(iso).valueOf(); }
  };
}

function fixtureErrors(scenario, index) {
  const label = `scenario ${index + 1}`;
  const errors = [];
  if (!scenario || typeof scenario !== 'object' || Array.isArray(scenario)) return [`${label} is an object`];
  if (typeof scenario.id !== 'string' || !scenario.id.trim()) errors.push(`${label} has a name`);
  if (typeof scenario.player !== 'string' || !scenario.player.trim()) errors.push(`${label} has a player`);
  if (!scenario.season || typeof scenario.season !== 'object' || Array.isArray(scenario.season) || !Array.isArray(scenario.season.roster)) errors.push(`${label} has a season with roster array`);
  if (!Array.isArray(scenario.logs)) errors.push(`${label} has a logs array`);
  if (!scenario.expected || typeof scenario.expected !== 'object' || Array.isArray(scenario.expected) || Object.keys(scenario.expected).length === 0) errors.push(`${label} has nonempty explicit expectations`);
  else if (!Number.isFinite(scenario.expected.total)) errors.push(`${label} has a finite expected total`);
  return errors;
}

section('1. OFFLINE STATIC CHECKS');
const html = read('index.html');
check(![...html.split('\n')].some(line => /^(<{7}|={7}|>{7})( |$)/.test(line)), 'no git conflict markers');

const scriptSources = [...html.matchAll(/<script[^>]*\bsrc=["']([^"']+)["'][^>]*><\/script>/gi)].map(match => match[1]);
const localScriptSources = scriptSources.filter(src => !/^(?:https?:)?\/\//i.test(src)).map(src=>src.split(/[?#]/,1)[0]);
const remoteScriptSources = scriptSources.filter(src => /^(?:https?:)?\/\//i.test(src));
const requiredLocal = ['src/config/firebase.js', 'src/state/appState.js', 'src/services/scoringEngine.js'];
const sourceFiles = [...new Set([...localScriptSources, ...requiredLocal])];
const missingLocal = sourceFiles.filter(relative => !fs.existsSync(path.join(ROOT, relative)));
check(missingLocal.length === 0,
  missingLocal.length ? `missing local script reference(s): ${missingLocal.join(', ')}` : `all ${localScriptSources.length} local script reference(s) exist`);
check(scriptSources.length > 0, `found ${scriptSources.length} script reference(s); local sources are inspected without fetching`);

const inline = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)].map(match => match[1]);
let parseOK = true;
inline.forEach((source, index) => { parseOK = parseScript(source, `index.html inline script ${index + 1}`) && parseOK; });
for (const relative of sourceFiles) {
  if (fs.existsSync(path.join(ROOT, relative))) parseOK = parseScript(read(relative), relative) && parseOK;
}
check(parseOK, `${inline.length} inline and ${sourceFiles.length} local script unit(s) parse`);
console.log(`  - Remote script references deliberately not fetched (${remoteScriptSources.length}); deployment/site checks are excluded.`);

const definitions = {};
for (const match of html.matchAll(/^(?:async )?function ([A-Za-z_]\w*)\s*\(/gm)) definitions[match[1]] = (definitions[match[1]] || 0) + 1;
const duplicates = Object.entries(definitions).filter(([, count]) => count > 1).map(([name]) => name);
check(duplicates.length === 0, duplicates.length ? `duplicate functions: ${duplicates.join(', ')}` : 'no duplicate function definitions');

const allLocalSource = html + sourceFiles.filter(relative => fs.existsSync(path.join(ROOT, relative))).map(read).join('\n');
const called = new Set([...html.matchAll(/on(?:click|change|input|keydown|submit)="(?:if\(event[^"]*?\))?\s*([A-Za-z_]\w*)\s*\(/g)].map(match => match[1]));
const unresolved = [...called].filter(name => !definitions[name]
  && !new RegExp(`(?:window\\.)?${name}\\s*=\\s*(?:async )?(?:function|\\()`).test(allLocalSource)
  && !['this', 'event', 'fn'].includes(name));
check(unresolved.length === 0,
  unresolved.length ? `unresolved handlers: ${unresolved.join(', ')}` : `all ${called.size} inline handlers resolve`);

section('2. SYNTHETIC SCORING');
let fixture;
try {
  fixture = JSON.parse(read('qa/fixtures/offline-scoring.json'));
  check(Array.isArray(fixture.scenarios) && fixture.scenarios.length > 0, 'fixture contains at least one scenario');
} catch (error) {
  check(false, `fixture is valid JSON: ${error.message}`);
}

if (Array.isArray(fixture?.scenarios) && fixture.scenarios.length > 0) {
  const engineSource = read('src/services/scoringEngine.js');
  for (const [index, scenario] of fixture.scenarios.entries()) {
    const before = JSON.stringify(scenario);
    const errors = fixtureErrors(scenario, index);
    check(errors.length === 0, errors.length ? errors.join('; ') : `${scenario.id}: fixture schema is complete`);
    if (errors.length) continue;
    try {
      const context = { window: {}, console, Date: fixedDate(scenario.now) };
      vm.createContext(context);
      context.__qaScenario = { player: scenario.player, ctx: { season: scenario.season, logs: scenario.logs, twistWindows: scenario.twistWindows || [], groupCode: scenario.groupCode } };
      vm.runInContext(`${engineSource}\nwindow.__qaResult = window.score(__qaScenario.player, __qaScenario.ctx);`, context, { filename: 'src/services/scoringEngine.js', timeout: 1000 });
      const actual = context.window.__qaResult;
      const mismatches = Object.entries(scenario.expected).filter(([key, expected]) => !(key in actual) || actual[key] !== expected);
      check(mismatches.length === 0,
        mismatches.length ? `${scenario.id}: expected ${mismatches.map(([key, value]) => `${key}=${value}`).join(', ')}` : `${scenario.id}: expected score fields match`);
      check(JSON.stringify(scenario) === before, `${scenario.id}: scoring does not mutate fixture input`);
    } catch (error) {
      check(false, `${scenario.id || 'unnamed scenario'}: scoring runs (${error.message})`);
    }
  }
}

section('3. EXCLUDED BY DESIGN');
console.log('  - No Firebase authentication, Firestore reads/writes, HTTP requests, or deployed-site checks run here.');
console.log('  - Real-device, native build/signing, deployment, and production-data verification remain separate human-gated checks.');

if (checks === 0) {
  console.error('No-op QA run: no checks executed.');
  process.exit(2);
}
console.log(`\n${failures ? `${failures} FAILURE(S)` : `ALL ${checks} OFFLINE CHECKS PASS`}`);
process.exit(failures ? 1 : 0);
