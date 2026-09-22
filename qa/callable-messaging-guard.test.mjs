// Callables must not depend on an FCM token. Functions SDK 9.23.0 calls
// messaging getToken() before every callable once notification permission is
// granted, returns that promise un-awaited inside its try/catch, and so a token
// failure rejects the call before any request is sent. On staging's subpath the
// default messaging worker is a 404, which made every save fail for anyone with
// notifications on (reproduced live, 23 Sep 2026).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync(new URL('../src/config/firebase.js', import.meta.url), 'utf8');
const block = source.slice(source.indexOf('let _forgeFunctions = null;'), source.indexOf('window.callFunction = function'));
const callFunctionSrc = source.slice(source.indexOf('window.callFunction = function'), source.indexOf('};', source.indexOf('window.callFunction = function')) + 2);

// Mirrors the SDK's real shape: getContext awaits getMessagingToken, whose
// original implementation returns a rejecting promise without awaiting it.
function fakeFirebase({ withContext = true } = {}) {
  const requests = [];
  const contextProvider = {
    async getMessagingToken() { return Promise.reject(Object.assign(new Error('Messaging: We are unable to register the default service worker.'), { code: 'messaging/failed-service-worker-registration' })); },
    async getContext() { return { messagingToken: await this.getMessagingToken() }; },
  };
  const service = {
    _delegate: withContext ? { contextProvider } : {},
    httpsCallable: name => async data => {
      if (withContext) await contextProvider.getContext();
      requests.push({ name, data });
      return { data: { ok: true, name } };
    },
  };
  const firebase = { functions: () => service, app: () => ({ functions: () => service }) };
  return { firebase, requests, contextProvider };
}
function load(fb, reports = []) {
  const window = { ForgeErr: { report: (...args) => reports.push(args) } };
  const console = { error: () => {} };
  new Function('firebase', 'window', 'console', block + '\n' + callFunctionSrc)(fb, window, console);
  return window;
}

test('unguarded, a failing token lookup kills the call before any request (the bug)', async () => {
  const { firebase, requests } = fakeFirebase();
  const raw = firebase.app().functions('asia-south1').httpsCallable('saveGroupWorkout');
  await assert.rejects(raw({}), { code: 'messaging/failed-service-worker-registration' });
  assert.equal(requests.length, 0);
});

test('guarded, callFunction reaches the server even when the token lookup would fail', async () => {
  const { firebase, requests, contextProvider } = fakeFirebase();
  const window = load(firebase);
  assert.equal(await contextProvider.getMessagingToken(), undefined, 'token lookup disabled at load');
  const result = await window.callFunction('saveGroupWorkout', { targets: [] });
  assert.deepEqual(result, { ok: true, name: 'saveGroupWorkout' });
  assert.equal(requests.length, 1);
});

test('the guard is applied at load, so direct httpsCallable users are covered too', async () => {
  const { firebase, requests } = fakeFirebase();
  load(firebase);   // no callFunction yet — mirrors the recap percentile path
  const direct = await firebase.app().functions('asia-south1').httpsCallable('getRecapPercentile')({});
  assert.equal(direct.data.ok, true);
  assert.equal(requests.length, 1);
});

test('if SDK internals move, the guard reports itself inactive instead of failing silently', () => {
  const reports = [];
  const { firebase } = fakeFirebase({ withContext: false });
  load(firebase, reports);
  assert.equal(reports.length, 1);
  assert.match(String(reports[0][1]), /messaging guard inactive/);
});
