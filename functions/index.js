/* ═══════════════════════════════════════════════════════════════════════════
   FORGE — scheduled push

   TWO notifications. That is the whole product, and the restraint IS the
   product. Every wellness app dies the same way: it earns the notification
   permission, spends it on "Don't forget to work out!", and gets muted inside a
   week. After that you have no channel at all.

   So the rule here is: only send what ANOTHER PERSON caused, or what the app
   genuinely finished computing. Never a reminder to exercise.

     1. STREAK AT RISK  (evening, IST)
        Fires only when the team is one person short of holding its streak TODAY,
        and only to the people who have not logged. That is the single message
        that changes behaviour, because it is actionable within hours and the
        cost of ignoring it lands on other people.

     2. MONDAY RECAP READY  (Monday morning, IST)
        One line saying last week closed. Pairs with the in-app recap card.

   DEPLOY: needs Blaze (Functions requires it; the free tier still covers this
   usage). From the repo root:
       firebase deploy --only functions --project forge-staging-865ff
   ═══════════════════════════════════════════════════════════════════════════ */

const { onSchedule } = require('firebase-functions/v2/scheduler');
const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { logger } = require('firebase-functions');
const admin = require('firebase-admin');
// Modular FieldValue: the functions emulator stubs admin.firestore() and
// strips its static .FieldValue, so admin.firestore.FieldValue.* is undefined
// under emulation (works in real deploys, but this is emulator-safe too).
const { FieldValue } = require('firebase-admin/firestore');
const crypto = require('crypto');

if(!(admin.apps || []).length) admin.initializeApp();
const db = admin.firestore();
const IST = 'Asia/Kolkata';
const REGION = 'asia-south1';

// ── helpers ────────────────────────────────────────────────────────────────
function istNow(){ return new Date(Date.now() + 5.5*3600*1000); }

/** Tokens for a set of userIds, flattened, with each token's platform. */
async function tokensFor(userIds){
  const out = [];
  for(const id of userIds){
    if(!id) continue;
    try{
      const s = await db.collection('users').doc(id).get();
      if(!s.exists) continue;
      const u = s.data();
      if(u.deletedAt) continue;                       // deleted accounts never get pushed
      Object.entries(u.pushTokens || {}).forEach(([t,meta]) =>
        out.push({ token:t, userId:id, platform:(meta && meta.platform) || 'web' }));
    }catch(e){ logger.warn('tokensFor failed', id, e.message); }
  }
  return out;
}

/**
 * Send, and prune tokens the device has stopped accepting. Without this,
 * uninstalled apps accumulate forever and every send gets slower and noisier.
 */
async function sendAll(entries, data){
  if(!entries.length) return { sent:0, pruned:0 };
  let sent=0, pruned=0;
  for(const e of entries){
    try{
      // ONE payload shape per platform, and the difference is load-bearing:
      //   web    -> DATA-ONLY. Our firebase-messaging-sw.js displays it. A
      //             `notification` block would make the SDK display it TOO —
      //             every web push would appear twice.
      //   native -> notification block REQUIRED. iOS shows nothing for a
      //             data-only message to a backgrounded app; the block rides
      //             APNs and the OS renders it with no app code running.
      //             `threadId`/`tag` keep replacement semantics (a second
      //             streak nudge replaces the first instead of stacking).
      const msg = (e.platform === 'web')
        ? { token: e.token, data }
        : { token: e.token,
            notification: { title: data.title || 'Forge', body: data.body || '' },
            data,
            apns: { headers: (data.tag ? { 'apns-collapse-id': String(data.tag).slice(0,64) } : {}),
                    payload: { aps: { sound: 'default', 'thread-id': data.tag || 'forge' } } },
            android: (data.tag ? { collapseKey: String(data.tag).slice(0,64),
                                   notification: { tag: String(data.tag).slice(0,64) } } : {}) };
      await admin.messaging().send(msg);
      sent++;
    }catch(err){
      const code = err && err.errorInfo && err.errorInfo.code;
      if(code === 'messaging/registration-token-not-registered'
      || code === 'messaging/invalid-registration-token'){
        try{
          await db.collection('users').doc(e.userId)
                  .update({ ['pushTokens.'+e.token]: admin.firestore.FieldValue.delete() });
          pruned++;
        }catch(e2){ /* pruning is best-effort */ }
      } else {
        logger.warn('send failed', code || (err && err.message));
      }
    }
  }
  return { sent, pruned };
}

/** Active, non-demo groups with a current season. */
async function liveGroups(){
  const gs = await db.collection('groups').get();
  const out = [];
  for(const g of gs.docs){
    const d = g.data();
    if(d.demo === true || !d.currentSeasonId) continue;
    const s = await db.collection('groups').doc(g.id)
                      .collection('seasons').doc(d.currentSeasonId).get();
    if(s.exists) out.push({ code:g.id, name:d.name||g.id, sid:d.currentSeasonId, season:s.data() });
  }
  return out;
}

// ── 1. STREAK AT RISK ──────────────────────────────────────────────────────
// 8pm IST. Late enough that the day's loggers have logged, early enough that
// someone can still do twenty minutes about it.
exports.streakAtRisk = onSchedule(
  { schedule: '0 20 * * *', timeZone: IST, region: 'asia-south1' },
  async () => {
    const now = istNow();
    const day = now.getUTCDate(), month = now.getUTCMonth()+1, year = now.getUTCFullYear();
    let totalSent = 0;

    for(const g of await liveGroups()){
      const season = g.season;
      if(season.month !== month || season.year !== year) continue;   // stale season
      const roster = (season.roster||[]).filter(p => p && p.name && p.departed !== true);
      if(roster.length < 2) continue;

      const snap = await db.collection('logs')
        .where('groupCode','==',g.code).where('month','==',month)
        .where('year','==',year).where('day','==',day).get();
      const loggedToday = new Set(
        snap.docs.map(d => d.data()).filter(l => !l.voided).map(l => l.player));

      const thr = season.teamStreakThreshold ?? 0.6;
      const teams = {};
      roster.forEach(p => { (teams[p.team] = teams[p.team] || []).push(p); });

      for(const [team, members] of Object.entries(teams)){
        const need = Math.ceil(members.length * thr);
        const have = members.filter(p => loggedToday.has(p.name)).length;
        // EXACTLY one short. Two short is usually unreachable and the message
        // becomes noise; already-safe teams need no interruption at all.
        if(have !== need - 1) continue;

        const missing = members.filter(p => !loggedToday.has(p.name) && p.userId);
        const entries = await tokensFor(missing.map(p => p.userId));
        const label = (Number(season.numTeams) === 1) ? 'Your group' : `Team ${team}`;
        const res = await sendAll(entries, {
          title: 'One workout short',
          body: `${label} needs one more today to keep the streak. ${have} of ${need} in.`,
          tag: `streak-${g.code}-${team}`,
          url: './'
        });
        totalSent += res.sent;
        if(res.sent) logger.info(`streakAtRisk ${g.code}/${team}: ${res.sent} sent, ${res.pruned} pruned`);
      }
    }
    logger.info(`streakAtRisk done — ${totalSent} notifications`);
  }
);

// ── 2. MONDAY RECAP ────────────────────────────────────────────────────────
// 8am IST Monday, to land with the in-app recap card that shows Mon–Tue.
exports.mondayRecap = onSchedule(
  { schedule: '0 8 * * 1', timeZone: IST, region: 'asia-south1' },
  async () => {
    let totalSent = 0;
    for(const g of await liveGroups()){
      const roster = (g.season.roster||[]).filter(p => p && p.userId && p.departed !== true);
      if(roster.length < 2) continue;
      const entries = await tokensFor(roster.map(p => p.userId));
      const res = await sendAll(entries, {
        title: 'Last week is in',
        body: `See how ${g.name} did, and start the new one.`,
        tag: `recap-${g.code}`,
        url: './'
      });
      totalSent += res.sent;
    }
    logger.info(`mondayRecap done — ${totalSent} notifications`);
  }
);

/* ═══════════════════════════════════════════════════════════════════════════
   AUTH PHASE 2 — SERVER-SIDE IDENTITY (AUTH_DESIGN_FINAL.md, locked 25 Jul)

   Legacy admin/notification callables and their shared verification helpers.
   Account claims and step settlement belong exclusively to the identity
   codebase. Run npm test at the repository root before deploying either
   firebase.json or firebase.staging-candidate.json; ownership tests cover both.

   Every callable requires an authenticated caller (request.auth) — that is
   the Google-signed-in user, whose uid IS the identity we bind. Admin SDK
   bypasses Firestore rules, so these run regardless of the ownership rule.
   ═══════════════════════════════════════════════════════════════════════════ */

// Resolve a target spec to the set of people it means, plus a human label.
// Shared by the live send and the scheduled drain SO THAT THEY CANNOT DRIFT:
// a scheduled notice must reach whoever is in the group when it fires, not
// whoever was in it when it was written, and the only way to guarantee that
// is for both paths to run this same function.
async function resolveAudience(scope, groupCode, team){
  if(!['all','group','team'].includes(scope)) throw new HttpsError('invalid-argument', 'Unknown audience type.');
  if(scope === 'all'){
    const us = await db.collection('users').get();
    const ids = [];
    us.docs.forEach(u => { if(!u.data().deletedAt) ids.push(u.id); });
    return { userIds: Array.from(new Set(ids)), label: 'everyone on Forge' };
  }
  if(!/^[A-Z0-9_-]{1,64}$/.test(groupCode || '')) throw new HttpsError('invalid-argument', 'Pick a valid group first.');
  const gSnap = await db.collection('groups').doc(groupCode).get();
  if(!gSnap.exists) throw new HttpsError('not-found', 'No group with that code.');
  const g = gSnap.data();
  if(!g.currentSeasonId) throw new HttpsError('failed-precondition', 'That group has no active season.');
  const sSnap = await db.collection('groups').doc(groupCode)
                        .collection('seasons').doc(g.currentSeasonId).get();
  if(!sSnap.exists) throw new HttpsError('not-found', 'That season is missing.');
  // Same roster filter the scheduled senders use: a departed player is not an
  // audience, and a roster row with no userId has no device to reach.
  let roster = (sSnap.data().roster || []).filter(p => p && p.userId && p.departed !== true);
  let label;
  if(scope === 'team'){
    if(!team) throw new HttpsError('invalid-argument', 'Pick a team first.');
    roster = roster.filter(p => String(p.team) === team);
    label  = `Team ${team} in ${g.name || groupCode}`;
  } else {
    label  = g.name || groupCode;
  }
  // One person appearing twice (two roster rows, a merged account) is one
  // person, and must not be sent the same announcement twice.
  return { userIds: Array.from(new Set(roster.map(p => p.userId))), label };
}

// Park a notice for later. The AUDIENCE SPEC is stored, never the resolved
// list: between writing and firing, people join, leave and turn notifications
// on, and a Monday announcement written on Friday should reach Monday's group.
const NOTICE_MAX_DAYS_AHEAD = 90;
function noticeSendTime(value){
  const at = new Date(value);
  if(isNaN(at.getTime())) throw new HttpsError('invalid-argument', 'That send time is not a valid date.');
  // One drain interval of slack, so "schedule for 2 minutes from now" is not
  // rejected by clock skew between the phone and the server.
  if(at.getTime() < Date.now() - 60 * 1000){
    throw new HttpsError('invalid-argument', 'That time is in the past.');
  }
  if(at.getTime() > Date.now() + NOTICE_MAX_DAYS_AHEAD * 864e5){
    throw new HttpsError('invalid-argument', `Pick a time within ${NOTICE_MAX_DAYS_AHEAD} days.`);
  }
  return at;
}
async function queueNotice(d, n){
  const at = noticeSendTime(d.sendAt);
  const ref = await db.collection('scheduledNotices').add({
    title: n.title, body: n.body,
    scope: n.scope, groupCode: n.groupCode || null, team: n.team || null,
    labelAtWrite: n.label,          // for display only; the drain re-resolves
    sendAt: at,
    status: 'queued',
    createdAt: FieldValue.serverTimestamp()
  });
  logger.info(`queueNotice ${ref.id} "${n.title}" → ${n.label} at ${at.toISOString()}`);
  return { ok:true, queued:true, id: ref.id, sendAt: at.toISOString(), label: n.label };
}

// ── 3. MANUAL NOTICE — the superadmin composer ─────────────────────────────
// The only push path in this file with a human on the other end of it.
// streakAtRisk and mondayRecap are scheduled and templated; this is Nirag
// typing a sentence and choosing who hears it.
//
// TWO-STEP BY DESIGN. `dryRun` resolves the audience and returns the counts
// WITHOUT sending, so the confirmation can state a real number produced by the
// same code path that will do the sending — not a guess made on the client.
// A broadcast button whose blast radius you cannot see before pressing it is
// how an app ends up apologising to five group chats at once.
//
// The admin key is the ONLY real boundary here. The superadmin PIN in front of
// this screen is client-side UI over a hash that ships in a public repo, so it
// stops nobody; this check is what actually stands between a stranger and
// everyone's lock screen.
// NOTE the STRING secret name, not the defineSecret object: ADMIN_RESET_KEY is
// declared further down this file, and the options object is evaluated at module
// load, so the object form would hit the temporal dead zone and crash every
// function in the deploy. testPush above takes the string for the same reason;
// .value() inside the handler is fine, since that runs at invocation time.
exports.sendNotice = onCall({ region: REGION, secrets: ['ADMIN_RESET_KEY'] }, async (request) => {
  if(!request.auth || !request.auth.uid) throw new HttpsError('unauthenticated', 'Sign in first.');
  const d        = request.data || {};
  const adminKey = String(d.adminKey || '');
  const dryRun   = d.dryRun === true;
  const expectedKey = ADMIN_RESET_KEY.value();
  if(typeof expectedKey !== 'string' || !expectedKey.trim()) throw new HttpsError('failed-precondition', 'Notice sending is not configured.');

  // Same shape as testPush/adminResetPin: the limiter counts WRONG keys, not
  // use, so guessing costs something while a legitimate check→send pair does
  // not spend two of five attempts.
  await assertUnderRateLimit(request.auth.uid, 'sendnotice', 5, 3600 * 1000);
  if(!hashEq(sha256hex(adminKey), sha256hex(expectedKey))){
    await recordRateHit(request.auth.uid, 'sendnotice', 3600 * 1000);
    throw new HttpsError('permission-denied', 'That admin key is not right.');
  }

  const title = String(d.title || '').trim();
  const body  = String(d.body  || '').trim();
  if(!title)             throw new HttpsError('invalid-argument', 'A title is required.');
  if(!body)              throw new HttpsError('invalid-argument', 'A message is required.');
  if(title.length > 60)  throw new HttpsError('invalid-argument', 'That title is too long (60 characters max).');
  if(body.length  > 180) throw new HttpsError('invalid-argument', 'That message is too long (180 characters max).');

  const scope     = String(d.scope || 'all');
  const groupCode = String(d.groupCode || '').trim().toUpperCase();
  const team      = String(d.team || '').trim();

  const { userIds, label } = await resolveAudience(scope, groupCode, team);

  // A scheduled send resolves its audience AT SEND TIME, not now — see
  // queueNotice. Everything below this line is the send-now path.
  if(d.sendAt) noticeSendTime(d.sendAt);

  const entries = await tokensFor(userIds);
  const people  = new Set(entries.map(e => e.userId)).size;

  if(dryRun){
    return { ok:true, dryRun:true, label, people, devices: entries.length, inAudience: userIds.length };
  }
  if(d.sendAt) return await queueNotice(d, { scope, groupCode, team, title, body, label });
  if(!entries.length){
    return { ok:true, label, people:0, devices:0, sent:0, pruned:0 };
  }

  // A UNIQUE tag per send. The scheduled senders reuse a stable tag on purpose
  // (tonight's streak nudge should replace last night's); two different
  // announcements replacing each other on the lock screen would be a bug.
  const r = await sendAll(entries, {
    kind : 'notice',
    title, body,
    tag  : 'notice-' + Date.now().toString(36),
    url  : './'
  });
  logger.info(`sendNotice [${label}] "${title}" — ${r.sent} sent, ${r.pruned} pruned, `
            + `${people} people, ${entries.length} devices`);
  return { ok:true, label, people, devices: entries.length, ...r };
});

// ── 4. SCHEDULED NOTICE DRAIN ──────────────────────────────────────────────
// Every 5 minutes, send whatever has come due. Granularity is therefore 5
// minutes, which the composer says out loud rather than implying to-the-second.
//
// CLAIM-THEN-SEND. Each notice is flipped to 'sending' inside a transaction
// before anything goes out, so two overlapping runs (a slow send, a retry)
// cannot both pick up the same row and double-notify everyone. A crash after
// the claim leaves it stuck in 'sending' rather than sending twice — the safe
// direction to fail, and visible in the queue list.
exports.drainScheduledNotices = onSchedule(
  { schedule: 'every 5 minutes', timeZone: IST, region: REGION, secrets: ['ADMIN_RESET_KEY'] },
  async () => {
    const due = await db.collection('scheduledNotices')
      .where('status', '==', 'queued')
      .where('sendAt', '<=', new Date())
      .limit(25)                       // a backlog drains over several runs
      .get();
    if(due.empty) return;

    let sentTotal = 0;
    for(const doc of due.docs){
      const claimed = await db.runTransaction(async tx => {
        const fresh = await tx.get(doc.ref);
        if(!fresh.exists || fresh.data().status !== 'queued') return null;
        tx.update(doc.ref, { status: 'sending', claimedAt: FieldValue.serverTimestamp() });
        return fresh.data();
      });
      if(!claimed) continue;           // another run got there first

      try{
        // Re-resolved NOW, not at write time — the group may have changed.
        const { userIds, label } = await resolveAudience(claimed.scope, claimed.groupCode, claimed.team);
        const entries = await tokensFor(userIds);
        const r = entries.length
          ? await sendAll(entries, {
              kind:'notice', title: claimed.title, body: claimed.body,
              tag: 'notice-' + doc.id, url: './'
            })
          : { sent:0, pruned:0 };
        await doc.ref.update({
          status: 'sent',
          sentAt: FieldValue.serverTimestamp(),
          result: { people: new Set(entries.map(e=>e.userId)).size, devices: entries.length,
                    sent: r.sent, label }
        });
        sentTotal += r.sent;
        logger.info(`drainScheduledNotices ${doc.id} "${claimed.title}" → ${label}: ${r.sent} sent`);
      }catch(e){
        // A group deleted between writing and firing must not wedge the queue.
        await doc.ref.update({ status:'failed', error: String((e && e.message) || e),
                               failedAt: FieldValue.serverTimestamp() });
        logger.error(`drainScheduledNotices ${doc.id} failed: ${(e && e.message) || e}`);
      }
    }
    logger.info(`drainScheduledNotices done — ${sentTotal} notifications across ${due.size} notice(s)`);
  }
);

// ── 5. NOTICE QUEUE — list and cancel ──────────────────────────────────────
// The scheduledNotices collection is unreachable from any client: the rules
// end in a default-deny and nothing grants it, so the ONLY way in is through
// this admin-key-gated callable running on the Admin SDK. That is deliberate —
// a client-writable queue would be a way to push to every phone on Forge.
exports.noticeQueue = onCall({ region: REGION, secrets: ['ADMIN_RESET_KEY'] }, async (request) => {
  if(!request.auth || !request.auth.uid) throw new HttpsError('unauthenticated', 'Sign in first.');
  const d = request.data || {};
  const expectedKey = ADMIN_RESET_KEY.value();
  if(typeof expectedKey !== 'string' || !expectedKey.trim()) throw new HttpsError('failed-precondition', 'Notice sending is not configured.');
  await assertUnderRateLimit(request.auth.uid, 'noticequeue', 5, 3600 * 1000);
  if(!hashEq(sha256hex(String(d.adminKey || '')), sha256hex(expectedKey))){
    await recordRateHit(request.auth.uid, 'noticequeue', 3600 * 1000);
    throw new HttpsError('permission-denied', 'That admin key is not right.');
  }

  if(d.action !== undefined && !['list','cancel'].includes(d.action)) throw new HttpsError('invalid-argument', 'Unknown queue action.');
  if(d.action === 'cancel'){
    const id = String(d.id || '');
    if(!/^[A-Za-z0-9_-]{1,128}$/.test(id)) throw new HttpsError('invalid-argument', 'Which notice?');
    const ref = db.collection('scheduledNotices').doc(id);
    // Transactional so a cancel racing the drain cannot un-send a sent notice.
    const outcome = await db.runTransaction(async tx => {
      const s = await tx.get(ref);
      if(!s.exists) return 'missing';
      if(s.data().status !== 'queued') return s.data().status;
      tx.update(ref, { status:'cancelled', cancelledAt: FieldValue.serverTimestamp() });
      return 'cancelled';
    });
    if(outcome === 'missing')   throw new HttpsError('not-found', 'That notice is gone.');
    if(outcome !== 'cancelled') throw new HttpsError('failed-precondition', `Too late — it is already ${outcome}.`);
    return { ok:true, cancelled:id };
  }

  const snap = await db.collection('scheduledNotices')
    .orderBy('sendAt', 'desc').limit(25).get();
  return { ok:true, notices: snap.docs.map(x => {
    const v = x.data();
    return { id:x.id, title:v.title, body:v.body, status:v.status,
             label: (v.result && v.result.label) || v.labelAtWrite || '',
             sendAt: v.sendAt && v.sendAt.toDate ? v.sendAt.toDate().toISOString() : null,
             sent: (v.result && v.result.sent) || 0 };
  })};
});

// Unsalted SHA-256 hex — byte-identical to the app's sha256hex() (index.html).
// The keyspace (4 digits) is the weakness, not the salt; server-side + rate
// limiting is the actual control, per SECURITY_REDTEAM.md rank 5.
function sha256hex(s){ return crypto.createHash('sha256').update(String(s)).digest('hex'); }

// Constant-time compare so a hash match can't be timed. Both are 64-char hex.
function hashEq(a, b){
  if(typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  try { return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b)); }
  catch(e){ return false; }
}

// Rate limit, keyed by the caller's auth uid, stored in authRateLimits/{uid}
// (rules deny all client access). Split in two so ONLY a wrong PIN consumes
// budget — a success or a structural refusal (already-claimed, 1:1) is not a
// brute-force attempt and must not lock the person out.
//
// assertUnderRateLimit throws resource-exhausted if the window is already
// full; it records nothing. recordRateHit appends one failed attempt.
async function assertUnderRateLimit(uid, action, max, windowMs){
  const snap = await db.collection('authRateLimits').doc(uid).get();
  const now = Date.now();
  const hits = ((((snap.data() || {})[action]) || {}).hits || []).filter(t => now - t < windowMs);
  if(hits.length >= max){
    const retryMs = windowMs - (now - hits[0]);
    throw new HttpsError('resource-exhausted',
      `Too many attempts. Try again in ${Math.ceil(retryMs/60000)} minute(s).`);
  }
}
async function recordRateHit(uid, action, windowMs){
  const ref = db.collection('authRateLimits').doc(uid);
  const now = Date.now();
  await db.runTransaction(async tx => {
    const snap = await tx.get(ref);
    const hits = ((((snap.exists ? snap.data() : {})[action]) || {}).hits || []).filter(t => now - t < windowMs);
    hits.push(now);
    tx.set(ref, { [action]: { hits } }, { merge: true });
  });
}

// claimIdentity and settleSweep are owned exclusively by the identity codebase.
// See functions-identity/identity-entry.js; never re-export aliases here.

/**
 * awardSeasonBadges — write the per-user stat/badge increments at rollover.
 *
 * This is the ONE write that forces the ownership rule to move server-side
 * (AUTH_PHASE2_NOTES.md): at rollover the snapshot writer increments
 * stats.seasonsPlayed + stats.badgeCounts on EVERY roster member's user doc,
 * and under `request.auth.uid == authUid` those writes fail for every player
 * who has linked Google. So the client keeps computing + writing the season
 * snapshot and the archive subcollection docs (create-only rule, unaffected),
 * and hands ONLY the foreign parent-doc increments to this callable.
 *
 * Source of truth is the SEASON DOC, never the caller's payload: the badges
 * are read from season.badgesAwarded (which the client also writes as the
 * VISIBLE standings), so farming a badge would mean writing a false public
 * leaderboard for the whole group — loud and once-per-season, not silent. The
 * increments are hardened anyway: only roster userIds, only the two known
 * badge types, +1 seasonsPlayed per player, idempotent via statsAwardedAt.
 *
 * data: { groupCode, sid? }  (sid defaults to the group's current season)
 */
/**
 * testPush — the deterministic end-to-end notification test. streakAtRisk
 * only fires at 8pm IST when a team is genuinely one short, which makes
 * "did the pipe work?" a once-a-day maybe; this sends a test message NOW to
 * every registered token (at pilot time that is one person's devices).
 * Gated on ADMIN_RESET_KEY like adminResetPin — the payload is harmless but
 * an open sender is a spam primitive.
 */
exports.testPush = onCall({ region: REGION, secrets: ['ADMIN_RESET_KEY'] }, async (request) => {
  if(!request.auth || !request.auth.uid) throw new HttpsError('unauthenticated', 'Sign in first.');
  const adminKey = String((request.data && request.data.adminKey) || '');
  await assertUnderRateLimit(request.auth.uid, 'testpush', 5, 3600 * 1000);
  if(!hashEq(sha256hex(adminKey), sha256hex(ADMIN_RESET_KEY.value() || ''))){
    await recordRateHit(request.auth.uid, 'testpush', 3600 * 1000);
    throw new HttpsError('permission-denied', 'That admin key is not right.');
  }
  // Every token in the system. During the pilot that is the tester's own
  // devices; by launch this function should be retired or re-scoped.
  const us = await db.collection('users').get();
  const entries = [];
  us.docs.forEach(u => {
    const d = u.data();
    if(d.deletedAt) return;
    Object.keys(d.pushTokens || {}).forEach(t => entries.push({ token: t, userId: u.id }));
  });
  const r = await sendAll(entries, {
    kind: 'test',
    title: 'Forge — test notification',
    body: 'The pipe works. This is what a real one will feel like.'
  });
  logger.info(`testPush: ${r.sent} sent, ${r.pruned} pruned, ${entries.length} tokens known`);
  return { ok: true, tokens: entries.length, ...r };
});

exports.awardSeasonBadges = onCall({ region: REGION }, async (request) => {
  if(!request.auth || !request.auth.uid) throw new HttpsError('unauthenticated', 'Sign in first.');
  const groupCode = String((request.data && request.data.groupCode) || '').trim().toUpperCase();
  if(!groupCode) throw new HttpsError('invalid-argument', 'groupCode is required.');

  const gSnap = await db.collection('groups').doc(groupCode).get();
  if(!gSnap.exists) throw new HttpsError('not-found', 'No group with that code.');
  const sid = String((request.data && request.data.sid) || gSnap.data().currentSeasonId || '');
  if(!sid) throw new HttpsError('not-found', 'No season to award.');

  const sRef = db.collection('groups').doc(groupCode).collection('seasons').doc(sid);
  const KNOWN_BADGES = new Set(['season_winner', 'team_winner']);

  const result = await db.runTransaction(async tx => {
    const sSnap = await tx.get(sRef);
    if(!sSnap.exists) throw new HttpsError('not-found', 'Season not found.');
    const s = sSnap.data();
    // Only after standings are finalized, and only once.
    if(!s.snapshotAt) throw new HttpsError('failed-precondition', 'Season is not snapshotted yet.');
    if(s.statsAwardedAt) return { already:true, awarded:0 };

    const roster = s.roster || [];
    const rosterUserIds = new Set(roster.filter(p => p && p.userId).map(p => p.userId));
    const finalStandings = Array.isArray(s.finalStandings) ? s.finalStandings : [];
    const badgesByUser = {};
    (Array.isArray(s.badgesAwarded) ? s.badgesAwarded : []).forEach(b => {
      if(b && b.userId) badgesByUser[b.userId] = Array.isArray(b.badges) ? b.badges.filter(x => KNOWN_BADGES.has(x)) : [];
    });

    // Read each target user doc up front (transaction: all reads before writes).
    const targets = finalStandings.filter(e => e && e.userId && rosterUserIds.has(e.userId));
    const uSnaps = await Promise.all(targets.map(e => tx.get(db.collection('users').doc(e.userId))));

    let awarded = 0;
    targets.forEach((e, i) => {
      if(!uSnaps[i].exists) return;        // no user doc → nothing to increment
      const inc = { 'stats.seasonsPlayed': FieldValue.increment(1) };
      (badgesByUser[e.userId] || []).forEach(bd => { inc[`stats.badgeCounts.${bd}`] = FieldValue.increment(1); });
      tx.update(db.collection('users').doc(e.userId), inc);
      awarded++;
    });
    tx.update(sRef, { statsAwardedAt: FieldValue.serverTimestamp() });
    return { already:false, awarded };
  });

  logger.info(`awardSeasonBadges: ${groupCode}/${sid} — ${result.awarded} awarded${result.already?' (already)':''}`);
  return { ok:true, ...result };
});

/**
 * adminResetPin — clear a player's PIN so they can set a new one.
 *
 * WHY THIS HAS TO BE SERVER-SIDE. The client used to do this itself, in
 * resetPlayerPin(). Then the 17 Aug rules made users.pinHash WRITE-ONCE from
 * any client — deliberately, because value -> null is the second half of a
 * proven takeover (PATCH someone's pinHash, then sign in as them). That rule
 * is right and stays. It also means the reset button has been failing for
 * every player who ever set a PIN — 72 of them — since the day it shipped.
 * The admin SDK bypasses rules, so this is the only place the write can live.
 *
 * WHAT GATES IT, AND WHY NOT THE OBVIOUS THINGS.
 * This callable can unlock ANY account in ANY group, so what authorises it
 * matters more than the write itself. Two tempting options are both worthless:
 *
 *   - roster entry `isAdmin`. The roster is a plain array on a client-writable
 *     season doc; anyone can add isAdmin:true to their own entry. Proven live.
 *   - the app's ADMIN_PIN_HASH. It sits in src/state/appState.js in a PUBLIC
 *     repo, and it hashes a FOUR DIGIT pin — 10,000 candidates, so the hash
 *     being public means the PIN is public. It is not a secret and never was.
 *
 * So the gate is a value that has never been in the repo and never reaches a
 * browser bundle: a Firebase secret. Set it once, out of band:
 *
 *     firebase functions:secrets:set ADMIN_RESET_KEY --project forge-25c8c
 *
 * Deploying needs Blaze (Functions always has); this usage stays inside the
 * free grant.
 *
 * data: { groupCode, name, adminKey }
 * Returns: { ok:true, cleared:{roster,userDoc}, already? }
 */
const { defineSecret } = require('firebase-functions/params');
const ADMIN_RESET_KEY = defineSecret('ADMIN_RESET_KEY');

exports.adminResetPin = onCall({ region: REGION, secrets: [ADMIN_RESET_KEY] }, async (request) => {
  const auth = request.auth;
  if(!auth || !auth.uid) throw new HttpsError('unauthenticated', 'Open the app first.');
  const uid = auth.uid;

  const groupCode = String((request.data && request.data.groupCode) || '').trim().toUpperCase();
  const name      = String((request.data && request.data.name) || '').trim();
  const adminKey  = String((request.data && request.data.adminKey) || '');
  if(!groupCode || !name || !adminKey){
    throw new HttpsError('invalid-argument', 'Group code, player name and the admin key are required.');
  }

  // Rate limit BEFORE the key check, so the budget cannot be probed for free.
  // Only a WRONG key spends it — a successful reset is not a brute-force
  // attempt, and an admin clearing four PINs in a row must not lock themselves
  // out halfway through.
  await assertUnderRateLimit(uid, 'adminReset', 5, 3600 * 1000);

  const expected = ADMIN_RESET_KEY.value();
  if(!expected){
    // Fail closed and say so. A missing secret must never read as "no gate".
    throw new HttpsError('failed-precondition', 'Server key is not configured. Set ADMIN_RESET_KEY.');
  }
  // Compare the HASHES, not the values: hashEq is constant-time but only over
  // equal-length inputs, and raw keys differ in length. Hashing first makes
  // every comparison 64 hex chars, so length alone leaks nothing.
  if(!hashEq(sha256hex(adminKey), sha256hex(expected))){
    await recordRateHit(uid, 'adminReset', 3600 * 1000);
    throw new HttpsError('permission-denied', 'That admin key is not right.');
  }

  const gSnap = await db.collection('groups').doc(groupCode).get();
  if(!gSnap.exists) throw new HttpsError('not-found', 'No group with that code.');
  const sid = gSnap.data().currentSeasonId;
  if(!sid) throw new HttpsError('not-found', 'That group has no active season.');
  const sRef = db.collection('groups').doc(groupCode).collection('seasons').doc(sid);

  const result = await db.runTransaction(async tx => {
    const sSnap = await tx.get(sRef);
    if(!sSnap.exists) throw new HttpsError('not-found', 'That season is missing.');
    const roster = sSnap.data().roster || [];
    const idx = roster.findIndex(p => p && String(p.name).toLowerCase() === name.toLowerCase());
    if(idx < 0) throw new HttpsError('not-found', `${name} is not on ${groupCode}'s roster.`);

    const entry = roster[idx];
    const userId = entry.userId || null;

    // ALL READS BEFORE ANY WRITE — Firestore transactions require it.
    let uSnap = null;
    if(userId) uSnap = await tx.get(db.collection('users').doc(userId));

    // A Google-linked account has no PIN to reset, and clearing one would be a
    // takeover route rather than a favour: the next person to reach the grace
    // flow on that name would set a credential on a secured account.
    if(uSnap && uSnap.exists && uSnap.data().authUid){
      throw new HttpsError('failed-precondition', `${entry.name} signs in with Google — there is no PIN to reset.`);
    }

    const rosterHadPin = entry.pin != null || entry.pinSet === true;
    const userHadHash  = !!(uSnap && uSnap.exists && uSnap.data().pinHash);
    if(!rosterHadPin && !userHadHash){
      return { already:true, cleared:{ roster:false, userDoc:false }, displayName: entry.name };
    }

    // Rebuild the entry rather than mutating in place, so nothing else on it
    // (team, role, uid, userId) can be dropped by accident.
    roster[idx] = { ...entry, pin: null, pinSet: false };
    tx.update(sRef, { roster });

    // Only touch the user doc if it actually exists. tx.update on a missing
    // doc throws, and a roster entry can outlive its user record.
    if(uSnap && uSnap.exists) tx.update(db.collection('users').doc(userId), { pinHash: null });

    return { already:false, cleared:{ roster:true, userDoc:!!(uSnap && uSnap.exists) }, displayName: entry.name };
  });

  // AUDIT. This callable can unlock any account, so every use leaves a record
  // that no client can read or delete. Names and codes only — never a PIN,
  // never a hash, and never the admin key.
  try{
    await db.collection('pinResets').add({
      groupCode, seasonId: sid, player: result.displayName,
      byUid: uid, at: FieldValue.serverTimestamp(),
      already: result.already, cleared: result.cleared
    });
  }catch(e){ logger.warn('adminResetPin: audit write failed', e.message); }

  logger.info(`adminResetPin: ${result.displayName} in ${groupCode}${result.already?' (already clear)':''}`);
  return { ok:true, ...result };
});
