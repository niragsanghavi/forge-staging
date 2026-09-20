#!/usr/bin/env node

import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUTPUT = path.join(ROOT, 'www');
const SOURCE_MANIFEST = path.join(ROOT, 'build', 'runtime-manifest.json');
const OUTPUT_MANIFEST_NAME = 'runtime-manifest.json';

const REQUIRED_FILES = Object.freeze([
  'index.html',
  'manifest.json',
  'privacy.html',
  'guide.html',
  'delete-account.html',
  'src/style/main.css',
  'src/style/sports-icons.css',
  'src/style/today.css',
  'src/ui/sports-icons.js',
  'src/ui/today.js',
  'src/config/firebase.js',
  'src/state/appState.js',
  'src/services/scoringEngine.js',
  'icon-180.png',
  'icon-192.png',
  'icon-512.png',
  'assets/badges/champion.webp',
  'assets/badges/champion-spin.webp',
  'assets/badges/team-a.webp',
  'assets/badges/team-b.webp',
  'assets/badges/team-c.webp',
  'assets/forgeling.webp',
  'assets/sports/soft-sculpt.webp',
  'assets/sports/fire.webp',
  'assets/fonts/archivo-800.woff2',
  'assets/icons/forge-f.svg',
]);

const REQUIRED_BADGES = Object.freeze([
  'assets/badges/champion.webp',
  'assets/badges/champion-spin.webp',
  'assets/badges/team-a.webp',
  'assets/badges/team-b.webp',
  'assets/badges/team-c.webp',
]);

// The previous accepted assembler emitted these 17 base files. A complete,
// hash-verified old output is safe to replace when adding the Today payload.
// Do not demand new files inside an older bundle or relax its ownership checks.
const TODAY_RUNTIME_FILES = Object.freeze([
  'src/style/today.css', 'src/ui/today.js', 'assets/forgeling.webp',
  'assets/fonts/archivo-800.woff2', 'assets/icons/forge-f.svg',
]);
const SPORTS_RUNTIME_FILES = Object.freeze([
  'src/style/sports-icons.css', 'src/ui/sports-icons.js',
  'assets/sports/soft-sculpt.webp', 'assets/sports/fire.webp',
]);
const PRE_SPORTS_REQUIRED_FILES = REQUIRED_FILES.filter(file => !SPORTS_RUNTIME_FILES.includes(file));
const PRE_TODAY_REQUIRED_FILES = PRE_SPORTS_REQUIRED_FILES.filter(file => !TODAY_RUNTIME_FILES.includes(file));

const EXACT_RUNTIME_FILES = new Set([
  'index.html',
  'manifest.json',
  'privacy.html',
  'guide.html',
  'delete-account.html',
  'icon-180.png',
  'icon-192.png',
  'icon-512.png',
  'assets/forgeling.webp',
  'assets/icons/forge-f.svg',
  'assets/sports/soft-sculpt.webp',
  'assets/sports/fire.webp',
]);

// These are selected only by the browser-hostname PWA identity shim. They are
// intentionally excluded from the native web payload, whose own manifest and
// icons are the canonical root files above.
const OPTIONAL_WEB_ONLY_REFERENCES = new Set([
  'manifest-staging.json',
  'icon-staging-180.png',
  'icon-staging-192.png',
  'icon-staging-512.png',
  'firebase-messaging-sw.js',
  'sw.js',
]);

const RUNTIME_PATH_RULES = Object.freeze([
  /^src\/(?:config|services|state|ui)\/[A-Za-z0-9][A-Za-z0-9._-]*\.js$/,
  /^src\/style\/[A-Za-z0-9][A-Za-z0-9._-]*\.css$/,
  /^assets\/(?:badges|icons|images)\/[A-Za-z0-9][A-Za-z0-9._/-]*\.(?:avif|gif|jpe?g|png|webp)$/,
  /^assets\/fonts\/[A-Za-z0-9][A-Za-z0-9._/-]*\.(?:otf|ttf|woff2?)$/,
]);

const HASH_PATTERN = /^[a-f0-9]{64}$/;
const PRIVATE_NAME_PATTERN = /(?:^|[/._-])(?:api[-_.]?key|credential|credentials|keychain|keystore|private|private[-_.]?key|provisioning|secret|secrets|service[-_.]?account|signing)(?:[/._-]|$)/i;
const RESOURCE_LITERAL_PATTERN = /["'`]([^"'`\r\n]+\.(?:avif|css|gif|html?|jpe?g|js|json|png|svg|webp|woff2?)(?:[?#][^"'`\r\n]*)?)["'`]/gi;

function fail(message) {
  throw new Error(message);
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function hasExactKeys(value, expected) {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  return actual.length === wanted.length && actual.every((key, index) => key === wanted[index]);
}

function isCanonicalRelativePath(value) {
  if (typeof value !== 'string' || value.length === 0 || value.includes('\\')) return false;
  if (value.startsWith('/') || value.endsWith('/') || value.includes('//')) return false;
  if (!/^[A-Za-z0-9._/-]+$/.test(value)) return false;

  const segments = value.split('/');
  if (segments.some((segment) => segment === '' || segment === '.' || segment === '..')) return false;
  return path.posix.normalize(value) === value;
}

function isAllowedRuntimePath(value) {
  return EXACT_RUNTIME_FILES.has(value) || RUNTIME_PATH_RULES.some((rule) => rule.test(value));
}

function validateRuntimePath(value, label) {
  if (!isCanonicalRelativePath(value) || !isAllowedRuntimePath(value) || PRIVATE_NAME_PATTERN.test(value)) {
    fail(`${label} contains an unrecognized runtime path: ${String(value)}`);
  }
  if (value === OUTPUT_MANIFEST_NAME) {
    fail(`${label} cannot publish its generated output manifest`);
  }
}

async function readJson(jsonPath, label) {
  let text;
  try {
    text = await fs.readFile(jsonPath, 'utf8');
  } catch (error) {
    fail(`cannot read ${label}: ${error.message}`);
  }

  try {
    return JSON.parse(text);
  } catch (error) {
    fail(`malformed ${label}: ${error.message}`);
  }
}

async function loadSourceManifest() {
  await assertNoSourceSymlink('build/runtime-manifest.json');
  const value = await readJson(SOURCE_MANIFEST, 'source runtime manifest');
  if (!isPlainObject(value) || !hasExactKeys(value, ['files']) || !Array.isArray(value.files)) {
    fail('source runtime manifest must be an object containing only a files array');
  }
  if (value.files.length === 0) fail('source runtime manifest cannot be empty');

  const seen = new Set();
  for (const runtimePath of value.files) {
    validateRuntimePath(runtimePath, 'source runtime manifest');
    if (seen.has(runtimePath)) fail(`source runtime manifest contains a duplicate path: ${runtimePath}`);
    seen.add(runtimePath);
  }

  for (const requiredPath of REQUIRED_FILES) {
    if (!seen.has(requiredPath)) fail(`source runtime manifest is missing required file: ${requiredPath}`);
  }
  for (const badgePath of REQUIRED_BADGES) {
    if (!seen.has(badgePath)) fail(`source runtime manifest is missing required dynamic badge: ${badgePath}`);
  }

  return [...value.files].sort((left, right) => left.localeCompare(right));
}

async function assertNoSourceSymlink(runtimePath) {
  const segments = runtimePath.split('/');
  let current = ROOT;
  const rootInfo = await fs.lstat(ROOT);
  if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink()) fail('project root must be a real directory');

  for (let index = 0; index < segments.length; index += 1) {
    current = path.join(current, segments[index]);
    let info;
    try {
      info = await fs.lstat(current, { bigint: true });
    } catch (error) {
      fail(`missing source file: ${runtimePath} (${error.code || error.message})`);
    }
    if (info.isSymbolicLink()) fail(`source path contains a symlink: ${runtimePath}`);
    if (index < segments.length - 1 && !info.isDirectory()) {
      fail(`source ancestor is not a directory: ${runtimePath}`);
    }
  }
}

function sameFileSnapshot(before, after, byteLength) {
  return before.isFile()
    && after.isFile()
    && !before.isSymbolicLink()
    && !after.isSymbolicLink()
    && before.dev === after.dev
    && before.ino === after.ino
    && before.size === after.size
    && before.mtimeNs === after.mtimeNs
    && before.size === BigInt(byteLength);
}

async function snapshotSources(runtimePaths) {
  const snapshots = new Map();

  for (const runtimePath of runtimePaths) {
    await assertNoSourceSymlink(runtimePath);
    const absolutePath = path.join(ROOT, ...runtimePath.split('/'));
    const before = await fs.lstat(absolutePath, { bigint: true });
    const bytes = await fs.readFile(absolutePath);
    const after = await fs.lstat(absolutePath, { bigint: true });
    if (!sameFileSnapshot(before, after, bytes.length)) {
      fail(`source changed while being read: ${runtimePath}`);
    }
    snapshots.set(runtimePath, bytes);
  }

  return snapshots;
}

function isExternalReference(value) {
  return /^\/\//.test(value) || /^[A-Za-z][A-Za-z0-9+.-]*:/.test(value);
}

function resolveLocalReference(fromPath, rawReference) {
  let value = rawReference.trim().replace(/^(["'])|(["'])$/g, '');
  if (!value || value.startsWith('#') || isExternalReference(value)) return null;
  // A generated HTML string may contain concatenated runtime values such as
  // src="'+badge.src+'". Those cannot be proven by static closure; Forge's
  // finite dynamic badge set is enforced separately by REQUIRED_BADGES.
  if (value.includes('+') || value.includes('${')) return null;

  value = value.split('#', 1)[0].split('?', 1)[0];
  if (!value) return null;
  try {
    value = decodeURI(value);
  } catch {
    fail(`invalid encoded resource reference in ${fromPath}: ${rawReference}`);
  }
  if (value.includes('\\') || value.includes('\0')) {
    fail(`unsafe local resource reference in ${fromPath}: ${rawReference}`);
  }

  const joined = value.startsWith('/')
    ? value.slice(1)
    : path.posix.join(path.posix.dirname(fromPath), value);
  const normalized = path.posix.normalize(joined);
  if (!normalized || normalized === '.') return null;
  if (normalized === '..' || normalized.startsWith('../')) {
    fail(`local resource escapes the project root in ${fromPath}: ${rawReference}`);
  }
  return normalized;
}

function addReference(references, fromPath, rawReference) {
  const resolved = resolveLocalReference(fromPath, rawReference);
  if (resolved) references.add(resolved);
}

function attributeValue(attributes, name) {
  const pattern = new RegExp(`\\b${name}\\s*=\\s*(?:(["'])(.*?)\\1|([^\\s>]+))`, 'i');
  const match = pattern.exec(attributes);
  return match ? (match[2] ?? match[3]) : null;
}

function collectHtmlReferences(text, fromPath, references) {
  const resourceTags = /<(script|link|img|source|video|audio|object|embed|iframe|use)\b([^>]*)>/gi;
  for (const match of text.matchAll(resourceTags)) {
    const tag = match[1].toLowerCase();
    const attributes = match[2];
    const names = tag === 'object'
      ? ['data']
      : tag === 'video'
        ? ['src', 'poster']
        : tag === 'link' || tag === 'use'
          ? ['href']
          : ['src'];
    for (const name of names) {
      const value = attributeValue(attributes, name);
      if (value !== null) addReference(references, fromPath, value);
    }

    if (tag === 'img' || tag === 'source') {
      const srcset = attributeValue(attributes, 'srcset');
      if (srcset) {
        for (const candidate of srcset.split(',')) {
          const resource = candidate.trim().split(/\s+/, 1)[0];
          if (resource) addReference(references, fromPath, resource);
        }
      }
    }
  }

  for (const match of text.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style\s*>/gi)) {
    collectCssReferences(match[1], fromPath, references);
  }
  for (const match of text.matchAll(/\bstyle\s*=\s*(["'])(.*?)\1/gi)) {
    collectCssReferences(match[2], fromPath, references);
  }
}

function collectCssReferences(text, fromPath, references) {
  for (const match of text.matchAll(/url\(\s*([^)]+?)\s*\)/gi)) {
    addReference(references, fromPath, match[1]);
  }
  for (const match of text.matchAll(/@import\s+(?:url\(\s*)?(["'][^"']+["']|[^\s;)]+)\s*\)?/gi)) {
    addReference(references, fromPath, match[1]);
  }
}

function collectScriptReferences(text, fromPath, references) {
  const modulePatterns = [
    /\b(?:import|export)\s+(?:[^"'`]*?\s+from\s+)?["'`]([^"'`]+)["'`]/g,
    /\bimport\s*\(\s*["'`]([^"'`]+)["'`]\s*\)/g,
  ];
  for (const pattern of modulePatterns) {
    for (const match of text.matchAll(pattern)) addReference(references, fromPath, match[1]);
  }
}

function collectResourceLiterals(text, fromPath, references) {
  for (const match of text.matchAll(RESOURCE_LITERAL_PATTERN)) {
    addReference(references, fromPath, match[1]);
  }
}

function collectWebManifestReferences(text, fromPath, references) {
  let manifest;
  try {
    manifest = JSON.parse(text);
  } catch (error) {
    fail(`malformed web manifest ${fromPath}: ${error.message}`);
  }

  const visit = (value) => {
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    if (!isPlainObject(value)) return;
    for (const [key, child] of Object.entries(value)) {
      if (key === 'src' && typeof child === 'string') addReference(references, fromPath, child);
      visit(child);
    }
  };
  visit(manifest);
}

function validateResourceClosure(runtimePaths, snapshots) {
  const published = new Set(runtimePaths);
  const references = new Set();

  for (const runtimePath of runtimePaths) {
    const text = snapshots.get(runtimePath).toString('utf8');
    if (runtimePath.endsWith('.html')) collectHtmlReferences(text, runtimePath, references);
    if (runtimePath.endsWith('.css')) collectCssReferences(text, runtimePath, references);
    if (runtimePath.endsWith('.js')) collectScriptReferences(text, runtimePath, references);
    if (runtimePath === 'manifest.json') collectWebManifestReferences(text, runtimePath, references);
    if (/\.(?:css|html|js)$/.test(runtimePath)) {
      // Browser API paths in classic scripts resolve against the document, not
      // the script file. Static module imports above retain module-relative rules.
      const literalBase = runtimePath.endsWith('.js') ? 'index.html' : runtimePath;
      collectResourceLiterals(text, literalBase, references);
    }
  }

  for (const referencedPath of [...references].sort()) {
    if (!published.has(referencedPath) && !OPTIONAL_WEB_ONLY_REFERENCES.has(referencedPath)) {
      fail(`local resource is referenced but absent from runtime manifest: ${referencedPath}`);
    }
  }
}

function outputEntry(bytes, runtimePath) {
  return {
    path: runtimePath,
    size: bytes.length,
    sha256: createHash('sha256').update(bytes).digest('hex'),
  };
}

function expectedDirectories(entries) {
  const directories = new Set();
  for (const entry of entries) {
    let directory = path.posix.dirname(entry.path);
    while (directory !== '.') {
      directories.add(directory);
      directory = path.posix.dirname(directory);
    }
  }
  return directories;
}

async function walkOutput(directory, relativeDirectory = '', found = { files: new Map(), directories: new Set() }) {
  const names = (await fs.readdir(directory)).sort();
  for (const name of names) {
    const relativePath = relativeDirectory ? `${relativeDirectory}/${name}` : name;
    const absolutePath = path.join(directory, name);
    const info = await fs.lstat(absolutePath);
    if (info.isSymbolicLink()) fail(`refusing symlink in existing output: ${relativePath}`);
    if (info.isDirectory()) {
      found.directories.add(relativePath);
      await walkOutput(absolutePath, relativePath, found);
    } else if (info.isFile()) {
      found.files.set(relativePath, absolutePath);
    } else {
      fail(`refusing non-file in existing output: ${relativePath}`);
    }
  }
  return found;
}

function validateOutputManifestShape(value) {
  if (!isPlainObject(value) || !hasExactKeys(value, ['files', 'totalBytes'])) {
    fail('existing output manifest has an unknown schema');
  }
  if (!Array.isArray(value.files) || !Number.isSafeInteger(value.totalBytes) || value.totalBytes < 0) {
    fail('existing output manifest has invalid totals');
  }
  if (value.files.length === 0) fail('existing output manifest cannot be empty');

  let previousPath = null;
  let calculatedTotal = 0;
  const seen = new Set();
  for (const entry of value.files) {
    if (!isPlainObject(entry) || !hasExactKeys(entry, ['path', 'size', 'sha256'])) {
      fail('existing output manifest contains an invalid entry');
    }
    validateRuntimePath(entry.path, 'existing output manifest');
    if (seen.has(entry.path)) fail(`existing output manifest contains a duplicate: ${entry.path}`);
    if (previousPath !== null && previousPath.localeCompare(entry.path) >= 0) {
      fail('existing output manifest entries are not deterministically sorted');
    }
    if (!Number.isSafeInteger(entry.size) || entry.size < 0 || !HASH_PATTERN.test(entry.sha256)) {
      fail(`existing output manifest contains invalid metadata: ${entry.path}`);
    }
    previousPath = entry.path;
    calculatedTotal += entry.size;
    seen.add(entry.path);
  }
  if (calculatedTotal !== value.totalBytes) fail('existing output manifest total does not match its entries');
  const expectedRequired = SPORTS_RUNTIME_FILES.some(file => seen.has(file))
    ? REQUIRED_FILES
    : TODAY_RUNTIME_FILES.some(file => seen.has(file))
      ? PRE_SPORTS_REQUIRED_FILES
      : PRE_TODAY_REQUIRED_FILES;
  for (const requiredPath of expectedRequired) {
    if (!seen.has(requiredPath)) fail(`existing output manifest is missing required file: ${requiredPath}`);
  }
  return value.files;
}

async function validateExistingOutput() {
  let outputInfo;
  try {
    outputInfo = await fs.lstat(OUTPUT);
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
  if (!outputInfo.isDirectory() || outputInfo.isSymbolicLink()) {
    fail('refusing unexpected www output type');
  }

  const inventory = await walkOutput(OUTPUT);
  const manifestPath = inventory.files.get(OUTPUT_MANIFEST_NAME);
  if (!manifestPath) fail('existing output has no generated runtime manifest');
  const manifest = await readJson(manifestPath, 'existing output manifest');
  const entries = validateOutputManifestShape(manifest);
  const expectedFiles = new Set(entries.map((entry) => entry.path));
  expectedFiles.add(OUTPUT_MANIFEST_NAME);

  for (const actualPath of inventory.files.keys()) {
    if (!expectedFiles.has(actualPath)) fail(`refusing unexpected www file: ${actualPath}`);
  }
  for (const expectedPath of expectedFiles) {
    if (!inventory.files.has(expectedPath)) fail(`existing output is missing owned file: ${expectedPath}`);
  }

  const expectedDirs = expectedDirectories(entries);
  for (const actualDirectory of inventory.directories) {
    if (!expectedDirs.has(actualDirectory)) fail(`refusing unexpected www directory: ${actualDirectory}`);
  }
  for (const expectedDirectory of expectedDirs) {
    if (!inventory.directories.has(expectedDirectory)) fail(`existing output is missing owned directory: ${expectedDirectory}`);
  }

  for (const entry of entries) {
    const bytes = await fs.readFile(inventory.files.get(entry.path));
    const hash = createHash('sha256').update(bytes).digest('hex');
    if (bytes.length !== entry.size || hash !== entry.sha256) {
      fail(`existing output file was modified outside the assembler: ${entry.path}`);
    }
  }
  return true;
}

async function writePayload(container, entries, snapshots) {
  const payload = path.join(container, 'payload');
  await fs.mkdir(payload);
  for (const entry of entries) {
    const destination = path.join(payload, ...entry.path.split('/'));
    await fs.mkdir(path.dirname(destination), { recursive: true });
    await fs.writeFile(destination, snapshots.get(entry.path), { flag: 'wx' });
  }
  const outputManifest = {
    files: entries,
    totalBytes: entries.reduce((total, entry) => total + entry.size, 0),
  };
  await fs.writeFile(
    path.join(payload, OUTPUT_MANIFEST_NAME),
    `${JSON.stringify(outputManifest, null, 2)}\n`,
    { flag: 'wx' },
  );
  return payload;
}

async function removeOwnedTemporaryDirectory(directory) {
  if (!directory) return;
  const parent = path.dirname(directory);
  const name = path.basename(directory);
  if (parent !== ROOT || !/^\.www-(?:build|backup)-[A-Za-z0-9_-]+$/.test(name)) {
    fail(`refusing to clean an unowned temporary path: ${directory}`);
  }
  await fs.rm(directory, { recursive: true, force: true });
}

async function swapPayload(payload, hadPriorOutput, buildContainer) {
  let backupContainer = null;
  let backupPath = null;
  let backupHoldsPrior = false;

  try {
    // Source copying can take time. Revalidate immediately before the first
    // move so an unexpected file created meanwhile is never deleted.
    const stillHasPriorOutput = await validateExistingOutput();
    if (stillHasPriorOutput !== hadPriorOutput) {
      fail('www output appeared or disappeared while the payload was assembled');
    }

    if (hadPriorOutput) {
      backupContainer = await fs.mkdtemp(path.join(ROOT, '.www-backup-'));
      backupPath = path.join(backupContainer, 'previous');
      await fs.rename(OUTPUT, backupPath);
      backupHoldsPrior = true;
    }

    try {
      await fs.rename(payload, OUTPUT);
    } catch (swapError) {
      if (backupHoldsPrior) {
        try {
          await fs.rename(backupPath, OUTPUT);
          backupHoldsPrior = false;
        } catch (restoreError) {
          fail(`final swap failed and prior output could not be restored; preserved backup at ${backupPath}: ${swapError.message}; restore: ${restoreError.message}`);
        }
      }
      throw swapError;
    }

    if (backupContainer) {
      try {
        await removeOwnedTemporaryDirectory(backupContainer);
        backupHoldsPrior = false;
      } catch (cleanupError) {
        console.warn(`warning: old validated output remains in ${backupContainer}: ${cleanupError.message}`);
      }
    }
  } finally {
    try {
      await removeOwnedTemporaryDirectory(buildContainer);
    } catch (cleanupError) {
      console.warn(`warning: build temporary directory could not be removed: ${cleanupError.message}`);
    }
    if (backupContainer && !backupHoldsPrior) {
      try {
        await removeOwnedTemporaryDirectory(backupContainer);
      } catch (cleanupError) {
        console.warn(`warning: backup temporary directory could not be removed: ${cleanupError.message}`);
      }
    }
  }
}

async function main() {
  if (process.argv.length !== 2) fail('this assembler accepts no command-line arguments');

  const runtimePaths = await loadSourceManifest();
  const snapshots = await snapshotSources(runtimePaths);
  validateResourceClosure(runtimePaths, snapshots);

  // Validate every byte already under www before creating or moving anything there.
  const hadPriorOutput = await validateExistingOutput();
  const entries = runtimePaths.map((runtimePath) => outputEntry(snapshots.get(runtimePath), runtimePath));
  const totalBytes = entries.reduce((total, entry) => total + entry.size, 0);

  const buildContainer = await fs.mkdtemp(path.join(ROOT, '.www-build-'));
  let payload;
  try {
    payload = await writePayload(buildContainer, entries, snapshots);
  } catch (error) {
    await removeOwnedTemporaryDirectory(buildContainer);
    throw error;
  }

  await swapPayload(payload, hadPriorOutput, buildContainer);
  console.log(`www built: ${entries.length} files, ${totalBytes} bytes`);
  console.warn('warning: external CDN runtime dependencies remain; this payload is not cold-offline-ready');
}

main().catch((error) => {
  console.error(`native payload build failed: ${error.message}`);
  process.exitCode = 1;
});
