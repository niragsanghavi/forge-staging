// The Monday recap joins the Android shell's "Forge" channel only when that
// channel exists: Android silently drops a notification aimed at a missing one.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync(new URL('../src/state/appState.js', import.meta.url), 'utf8');
const start = source.indexOf('window.scheduleMondayRecap = async function');
const body = source.slice(start, source.indexOf('\n};', start) + 3);

function recap(listChannels) {
  const scheduled = [];
  const LN = {
    checkPermissions: async () => ({ display: 'granted' }),
    requestPermissions: async () => ({ display: 'granted' }),
    cancel: async () => {},
    schedule: async ({ notifications }) => { scheduled.push(...notifications); },
    listChannels,
  };
  const window = { isNative: () => true, NOTIF_RECAP_ID: 4801 };
  new Function('window', '_plugin', body)(window, () => LN);
  return { run: () => window.scheduleMondayRecap(), scheduled };
}

test('Android with the Forge channel: the recap posts to it', async () => {
  const r = recap(async () => ({ channels: [{ id: 'default' }, { id: 'forge_updates' }] }));
  assert.equal(await r.run(), 'scheduled');
  assert.equal(r.scheduled[0].channelId, 'forge_updates');
});

test('an older shell without the channel keeps the plugin default', async () => {
  const r = recap(async () => ({ channels: [{ id: 'default' }] }));
  assert.equal(await r.run(), 'scheduled');
  assert.equal('channelId' in r.scheduled[0], false);
});

test('iOS, where listing channels is unavailable, still schedules', async () => {
  const r = recap(async () => { throw new Error('not available on iOS'); });
  assert.equal(await r.run(), 'scheduled');
  assert.equal('channelId' in r.scheduled[0], false);
  assert.equal(r.scheduled[0].schedule.on.weekday, 2);
});
