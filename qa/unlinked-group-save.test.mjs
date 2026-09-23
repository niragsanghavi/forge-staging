// A device upgraded from the old app remembers groups joined under separate
// profiles. With server-authorised saves those groups must be left out and
// labelled, never sent — one refused group failed the whole save (23 Sep 2026).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const start = html.indexOf('    const targets = [];');
const end = html.indexOf("_setReceiptState(receipt,targets.length?'pending':'failed');");
assert.ok(start > 0 && end > start, 'target-selection block not found');
const block = html.slice(start, end);

async function select({googleAuth}) {
  const sessions = [
    {code: 'HOME', player: {userId: 'me'}},
    {code: 'LINKED', player: {userId: 'me'}},
    {code: 'OLDAPP', player: {userId: 'someone-else'}},
  ];
  const receipt = {groups: sessions.map(s => ({code: s.code, status: 'checking'}))};
  const context = {
    window: {FEATURE_GOOGLE_AUTH: googleAuth},
    submission: {groupCode: 'HOME', groupDemo: false, seasonId: '2026-09', actor: {userId: 'me'}, sessions},
    receipt, sessions,
    _receiptGroup: (r, code) => r.groups.find(g => g.code === code),
    db: {collection: () => ({doc: () => ({get: async () => ({exists: true, data: () => ({currentSeasonId: '2026-09', demo: false})})})})},
    logErr: () => {}, setTimeout, Promise,
  };
  await vm.runInNewContext(`(async()=>{const sessions=submission.sessions;${block.replace('    const sessions = submission.sessions;', '')}return targets;})()`, context).then(t => { context.targets = t; });
  return {targets: Array.from(context.targets, t => t.code).sort(), receipt};
}

test('signed in: a group remembered under another profile is skipped and labelled', async () => {
  const {targets, receipt} = await select({googleAuth: true});
  assert.deepEqual(targets, ['HOME', 'LINKED']);
  const old = receipt.groups.find(g => g.code === 'OLDAPP');
  assert.equal(old.status, 'skipped');
  assert.equal(old.reason, 'not linked to this account');
});

test('legacy PIN mode is unchanged: every same-season group is still a target', async () => {
  const {targets} = await select({googleAuth: false});
  assert.deepEqual(targets, ['HOME', 'LINKED', 'OLDAPP']);
});
