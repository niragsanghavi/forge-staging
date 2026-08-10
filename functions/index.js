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
const { logger } = require('firebase-functions');
const admin = require('firebase-admin');

admin.initializeApp();
const db = admin.firestore();
const IST = 'Asia/Kolkata';

// ── helpers ────────────────────────────────────────────────────────────────
function istNow(){ return new Date(Date.now() + 5.5*3600*1000); }

/** Tokens for a set of userIds, flattened. Skips users with none. */
async function tokensFor(userIds){
  const out = [];
  for(const id of userIds){
    if(!id) continue;
    try{
      const s = await db.collection('users').doc(id).get();
      if(!s.exists) continue;
      const u = s.data();
      if(u.deletedAt) continue;                       // deleted accounts never get pushed
      Object.keys(u.pushTokens || {}).forEach(t => out.push({ token:t, userId:id }));
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
      await admin.messaging().send({ token:e.token, data });
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
