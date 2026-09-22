// Two failures found on a phone, 23 Sep 2026.
// 1. Staging sent production's Web Push certificate to the staging project, so
//    FCM refused every registration (401 -> messaging/token-subscribe-failed).
//    A subscription left behind by those attempts carried the wrong key and
//    would have "registered" later without ever delivering.
// 2. After Google sign-in, opening the group stalled silently until force-quit.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { JSDOM } from 'jsdom';

const read = path => fs.readFileSync(new URL('../' + path, import.meta.url), 'utf8');
const appState = read('src/state/appState.js');
const firebaseJs = read('src/config/firebase.js');
const indexHtml = read('index.html');

const PROD_KEY = 'BP2E5C9t--QJBU2hX9qYNPn2NX7p5V_i_e8U34fvP3SpZgPd9FAFsFw9oBpaYLEGQmPDmR4y345daVedGL88Ad4';
const FCM_DEFAULT_KEY = 'BDOU99-h67HcA6JeFXHbSNMu7e2yNNu3RzoMj8TM4W88jITfq7ZmPvIM1Iv-4_l2LxQcYwhqby2xGpWwzjfAnG4';

function slice(source, start, end) {
  const from = source.indexOf(start);
  assert.ok(from >= 0, 'missing: ' + start);
  const to = source.indexOf(end, from);
  assert.ok(to > from, 'missing end of: ' + start);
  return source.slice(from, to + end.length);
}

function vapidFor(isStaging) {
  const window = { IS_STAGING: isStaging };
  new Function('window', slice(appState, 'window.FCM_VAPID_KEY =', ';'))(window);
  return window.FCM_VAPID_KEY;
}

test('staging registers with FCM\'s built-in key, production keeps its own certificate', () => {
  assert.equal(vapidFor(true), FCM_DEFAULT_KEY);
  assert.equal(vapidFor(false), PROD_KEY);
  assert.equal(vapidFor(undefined), PROD_KEY, 'only an explicit staging build leaves the production key');
});

const dropSource = slice(firebaseJs, 'async function _dropForeignPushSubscription', '\n}');
const dropForeign = new Function(dropSource + '\nreturn _dropForeignPushSubscription;')();
const keyBytes = key => Uint8Array.from(Buffer.from(key, 'base64url')).buffer;
function registration(subscription) {
  return { pushManager: { getSubscription: async () => subscription } };
}
function subscription(key) {
  const sub = { unsubscribed: 0, unsubscribe: async () => { sub.unsubscribed++; return true; } };
  if (key !== undefined) sub.options = { applicationServerKey: key === null ? null : keyBytes(key) };
  return sub;
}

test('a subscription made with another key is dropped before registering', async () => {
  const leftover = subscription(PROD_KEY);
  await dropForeign(registration(leftover), FCM_DEFAULT_KEY);
  assert.equal(leftover.unsubscribed, 1);
});

test('a subscription made with the same key is kept', async () => {
  const current = subscription(FCM_DEFAULT_KEY);
  await dropForeign(registration(current), FCM_DEFAULT_KEY);
  assert.equal(current.unsubscribed, 0);
  const prod = subscription(PROD_KEY);
  await dropForeign(registration(prod), PROD_KEY);
  assert.equal(prod.unsubscribed, 0);
});

test('no subscription, or a browser that hides its key, is left alone and never throws', async () => {
  await dropForeign(registration(null), FCM_DEFAULT_KEY);
  const hidden = subscription(undefined);
  await dropForeign(registration(hidden), FCM_DEFAULT_KEY);
  assert.equal(hidden.unsubscribed, 0);
  await dropForeign({ pushManager: { getSubscription: async () => { throw new Error('boom'); } } }, FCM_DEFAULT_KEY);
});

test('registration drops a foreign subscription before asking the SDK for a token', () => {
  const enable = slice(firebaseJs, 'window.enablePush = async function', '\n};');
  const drop = enable.indexOf('_dropForeignPushSubscription(reg, window.FCM_VAPID_KEY)');
  assert.ok(drop > 0);
  assert.ok(drop < enable.indexOf('messaging.getToken('));
});

const openSource = slice(indexHtml, 'async function openRestoredGroup', '\n}');
function restoreHarness({ loadGroup, stage }) {
  const dom = new JSDOM('<body><div class="screen active" id="screen-onboard"></div></body>');
  dom.window.HTMLElement.prototype.scrollIntoView = () => {};   // browsers have it; jsdom does not
  const errors = [];
  let reloads = 0;
  const env = {
    loadGroup,
    groupCode: 'ALPHAT',
    get _groupLoadStage() { return stage(); },
    logErr: (where, error) => errors.push([where, error.message]),
    document: dom.window.document,
    location: { reload: () => { reloads++; } },
  };
  const open = new Function('env', 'with(env){ return (' + openSource.replace('async function openRestoredGroup', 'async function') + '); }')(env);
  return { open, errors, document: dom.window.document, reloads: () => reloads };
}

test('a stalled group open reports its step and offers a reload', async () => {
  const h = restoreHarness({ loadGroup: () => new Promise(() => {}), stage: () => 'profile' });
  await h.open('ALPHAT', 20);
  assert.deepEqual(h.errors, [['restoreIdentityFromGoogle:stalled', 'GROUP_OPEN_STALLED at profile']]);
  const button = h.document.querySelector('#forgeOpenStalled button');
  assert.equal(button.textContent, 'Reload Forge');
  button.click();
  assert.equal(h.reloads(), 1);
});

test('a group that opens in time shows nothing extra', async () => {
  const h = restoreHarness({ loadGroup: async () => {}, stage: () => 'launched' });
  await h.open('ALPHAT', 20);
  assert.equal(h.errors.length, 0);
  assert.equal(h.document.getElementById('forgeOpenStalled'), null);
});

test('an open that launched just as the timer fired is not called a stall', async () => {
  const h = restoreHarness({ loadGroup: () => new Promise(() => {}), stage: () => 'launched' });
  await h.open('ALPHAT', 20);
  assert.equal(h.errors.length, 0);
  assert.equal(h.document.getElementById('forgeOpenStalled'), null);
});

test('sign-in restore waits on the guarded open instead of firing loadGroup blind', () => {
  const restore = slice(indexHtml, 'async function restoreIdentityFromGoogle', '\n}');
  assert.ok(restore.includes('await openRestoredGroup(groupCode);'));
  assert.ok(!/\n\s*loadGroup\(groupCode, true\);/.test(restore));
});
