// ── PIN HASHES (SHA-256 hex; plaintext lives only in password manager) ────
window.SUPER_PIN_HASH = '365346103ca5afb17413770bfe4dbc212d5fa88719a4c12ac0319c37af16874d';
window.ADMIN_PIN_HASH = 'b0958fda6b5cdee38b99f53f9876c5192b6918760f8e75c98e8d37f5cbd3c4ab';

// ── FEATURE FLAGS ─────────────────────────────────────────────────────────
// Display-only kill switches: flipping one hides UI, never touches data.
// FEATURE_REACTIONS_ENABLED=false removes the feed's 🔥 react button and its
// count badge from every log row (the feed's single reaction render site).
// Stored reaction docs, the reactions listener, and toggleReaction() are all
// untouched, so flipping back to true restores the feature exactly as it was.
window.FEATURE_REACTIONS_ENABLED = false;

// ── CONSTANTS ─────────────────────────────────────────────────────────────
window.COMMON_WORKOUTS = [
  "Gym","Padel","Walk","Run","Yoga","Volleyball","Cricket","Swimming",
  "Cycling","Pickleball","Pilates","Football","Basketball","Badminton",
  "Weight training","Cardio","HIIT","Strength training","Zumba","Boxing",
  "Stretching","Hiking","Dance","Rowing","Spinning","Tennis","Crossfit"
];

window.TWIST_LIBRARY = [
  {
    id:'boss_week',
    name:'Boss Week',
    desc:'All base workout points ×2 for the entire month',
    config:null
  },
  {
    id:'double_points_day',
    name:'Double Points Day',
    desc:'One day per week earns 4x base points',
    config:'Which day? (1=Mon, 7=Sun)',
    configKey:'day',
    configDefault:3
  },
  {
    id:'comeback_bonus',
    name:'Comeback Bonus',
    desc:'Players with 0 logs last week get 2x points for first 3 days of next week',
    config:null
  },
  {
    id:'bonus_workout',
    name:'Bonus Workout Type',
    desc:'A specific workout earns +6 pts instead of +5 this month',
    config:'Which workout?',
    configKey:'workout',
    configDefault:'Run'
  },
  {
    id:'elimination',
    name:'Elimination Round',
    desc:'Lowest scorer each week loses streak bonus for following week',
    config:null
  },
  {
    id:'stakes_mode',
    name:'Stakes Mode',
    desc:'Losing team covers next month for the whole group',
    config:null
  },
  {
    id:'freaky_fridays',
    name:'Freaky Fridays',
    desc:'Workouts logged on a Friday earn ×2 base points for that day',
    config:null
  },
  {
    id:'monday_motivation',
    name:'Monday Motivation',
    desc:'Workouts logged on a Monday earn ×2 base points for that day',
    config:null
  },
  {
    id:'underdog_week',
    name:'Underdog Week',
    desc:'Player(s) in last place (fewest logged days) get ×2 on all base workout points. Ties all qualify.',
    config:null
  },
  {
    id:'jack_of_all_trades',
    name:'Jack of All Trades',
    desc:'Log 4 distinct workout types in one Mon–Sun week → one-time +20 pts. One award per player per week.',
    config:null
  },
  {
    id:'double_or_nothing',
    name:'Iron Pledge',
    desc:'Players lock in a weekly workout target. Hit it: base points for the week double. Miss it: base points for the week go to zero.',
    config:null
  }
];

// ── SHARED STATE ──────────────────────────────────────────────────────────
window.me = null;            // current player {name, team, role} — resolved from season roster
window.groupData = null;     // {name, players:[{name}], currentSeasonId, createdAt}
window.groupCode = null;
window.season = null;        // {month, year, days, capTarget, vcTarget, minWorkouts,
                             //  rolesEnabled, roster:[{name,team,role}], status, ...}
window.seasonId = null;      // "YYYY-MM" string e.g. "2026-07"

window.allLogs = [];
window.bonus30 = [];
window.flags = [];
window.activeTwists = {};
window.jackAwards = [];         // groups/{CODE}/seasons/{ID}/jackAwards subcollection
window.bets = {};               // groups/{CODE}/seasons/{ID}/bets — keyed by playerName
window.ironPledgeBonuses = [];  // bonuses_iron_pledge top-level collection
window.twistWindows = [];       // groups/{CODE}/seasons/{ID}/twistWindows — permanent week-bound twist docs
window.reactions = [];          // S5 🔥 reactions. MUST be pre-declared: renderFeed reads it on the
                                // very first refresh(), before the reactions listener's first snapshot —
                                // as an implicit global that was a boot-order ReferenceError that could
                                // kill the whole render pass (seen live on Android, blocked a real user).
window.selDay = null;
// The MONTH the selected day belongs to. submitLog used to take `day` from the
// tapped calendar cell but `month`/`year` from `season`, with nothing
// reconciling the two — a log's date was assembled from two unrelated sources.
// Nothing crossed them in practice, because closed months are untappable and
// future days are refused, but that is a UI guard standing in for a data
// invariant: one regression in mirTapDay and you get a workout dated into a
// month it did not happen in. Prasham's two ghost logs were exactly that shape,
// written by the backlog script rather than the client.
//
// null means "no calendar context" — submitLog then falls back to season, which
// is the correct answer for the Log-today entry points. Every writer of selDay
// sets these alongside it.
window.selMonth = null;
window.selYear = null;
window.selW = [];
window.selKm = null;            // distance for the log in flight, km. null = not
                                // captured (the overwhelming majority of logs).
                                // Set only by the distance step, which itself only
                                // appears when season.kmTarget is configured.

// Workout types a distance can meaningfully be attached to. Matched loosely
// (substring, lowercased) so "Evening walk", "Treadmill Run" and a custom
// "morning jog" all qualify without needing an exact-match table.
window.DISTANCE_WORKOUTS = [
  'walk','run','jog','cycle','cycling','bike','biking','ride','riding',
  'hike','hiking','trek','trekking','swim','swimming','row','rowing',
  'treadmill','marathon','sprint','elliptical','stair'
];
window.isDistanceWorkout = function(w){
  const s = String(w||'').toLowerCase();
  return window.DISTANCE_WORKOUTS.some(k => s.includes(k));
};

window.selNote = null;          // free-text detail for the log in flight (muscle
                                // groups on a lift). Personal record only — never
                                // scored, never on any leaderboard.

// Workouts where "what did you train" is a meaningful question. Same loose
// substring match as the distance list, so "Leg day at the gym" and a custom
// "push gym session" both qualify.
window.LIFT_WORKOUTS = [
  'gym','weight','strength','lift','bodybuild','crossfit','resistance','calisthen'
];
window.isLiftWorkout = function(w){
  const s = String(w||'').toLowerCase();
  return window.LIFT_WORKOUTS.some(k => s.includes(k));
};

// Offered as chips; anything else goes in the free-text box.
window.MUSCLE_GROUPS = ['Chest','Back','Shoulders','Arms','Legs','Core','Glutes','Full body'];

// Per-device opt-out. Defaults to asking; one tap on "don't ask again" silences
// it forever without touching anyone else's experience.
window.liftPromptEnabled = function(){
  try{ return localStorage.getItem('forge_no_lift_prompt') !== '1'; }catch(e){ return true; }
};
window.setLiftPrompt = function(on){
  try{ on ? localStorage.removeItem('forge_no_lift_prompt')
          : localStorage.setItem('forge_no_lift_prompt','1'); }catch(e){}
};
window.adminUnlocked = false;
window.unsub = [];

// ── HEALTH (Apple Health / Health Connect) ────────────────────────────────
// One bridge for both platforms: @capgo/capacitor-health exposes a UNIFIED
// WorkoutType enum over HealthKit and Android Health Connect, so this mapping
// and everything downstream is written exactly once.
//
// Three decisions govern this integration (HEALTHKIT_ROADMAP.md):
//   D1 READ-ONLY. Forge logs carry no start time or duration, so writing to
//      a health store would mean fabricating both. We never write.
//   D2 Health data never leaves the phone. The app SUGGESTS; the user
//      confirms; the confirmation goes through the same submitLog() a manual
//      tap uses. Raw health samples are never uploaded anywhere.
//   D3 Suggestions respect the server's ~8-day backlog clamp — anything
//      older would be rejected by the Firestore rules on confirm.
window.healthPrefKey = 'forge_health_on';
window.healthSeenKey = 'forge_health_seen_v1';   // suggested/dismissed workout ids

window.healthEnabled = function(){
  try{ return localStorage.getItem(window.healthPrefKey) === '1'; }catch(e){ return false; }
};
window.setHealthEnabled = function(on){
  try{ on ? localStorage.setItem(window.healthPrefKey,'1')
          : localStorage.removeItem(window.healthPrefKey); }catch(e){}
};

// Unified WorkoutType -> Forge's normalized labels. Unmapped types fall back
// to 'Workout' — an honest generic that still logs the day, rather than
// guessing a wrong specific.
window.HEALTH_TYPE_MAP = {
  walking:'Walk', hiking:'Hiking', running:'Run', runningTreadmill:'Run',
  cycling:'Cycling', bikingStationary:'Cycling', handCycling:'Cycling',
  swimming:'Swimming', swimmingPool:'Swimming', swimmingOpenWater:'Swimming',
  yoga:'Yoga', pilates:'Pilates', stretching:'Stretching', flexibility:'Stretching',
  taiChi:'Yoga', mindAndBody:'Yoga', barre:'Pilates',
  traditionalStrengthTraining:'Weight training', strengthTraining:'Weight training',
  weightlifting:'Weight training', functionalStrengthTraining:'Strength training',
  coreTraining:'Strength training', calisthenics:'Strength training',
  crossTraining:'Crossfit', bootCamp:'HIIT', highIntensityIntervalTraining:'HIIT',
  mixedCardio:'Cardio', elliptical:'Cardio', stairClimbing:'Cardio',
  stairClimbingMachine:'Cardio', stepTraining:'Cardio', jumpRope:'Cardio',
  rowing:'Rowing', rowingMachine:'Rowing',
  tennis:'Tennis', badminton:'Badminton', pickleball:'Pickleball',
  squash:'Squash', racquetball:'Squash', tableTennis:'Table tennis',
  cricket:'Cricket', volleyball:'Volleyball', basketball:'Basketball',
  soccer:'Football', football:'Football', hockey:'Hockey', iceHockey:'Hockey',
  dance:'Dance', dancing:'Dance', cardioDance:'Dance', socialDance:'Dance',
  boxing:'Boxing', kickboxing:'Boxing', martialArts:'Boxing',
  golf:'Golf', climbing:'Hiking', rockClimbing:'Hiking'
};
window.healthLabelOf = function(t){
  return window.HEALTH_TYPE_MAP[t] || 'Workout';
};

// Ask for read access to workouts. Returns 'unsupported' | 'denied' | 'granted'.
window.healthConnect = async function(){
  if(!window.isNative()) return 'unsupported';
  const H = (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.Health) || null;
  if(!H) return 'unsupported';
  try{
    // 'steps' rides along with 'workouts' in ONE authorisation sheet. Asking
    // twice would show the person two prompts for what they experience as one
    // decision, and HealthKit does not re-prompt for a type already decided —
    // so a later separate request for steps would silently resolve as
    // "processed" while returning nothing. Both types, one ask, always.
    //
    // WIDENING THIS ARRAY IS AN APP STORE EVENT. The read scope is compiled
    // into the binary and reviewed; adding a type needs a new build, a new
    // review, and NSHealthShareUsageDescription copy that names it. Do not add
    // a type here speculatively.
    const s = await H.requestAuthorization({ read: ['workouts', 'steps'] });
    // HealthKit never reveals read-denial (by design — denial is itself
    // health information). readAuthorized tells us the sheet was processed;
    // an empty query later is indistinguishable from "no workouts", which is
    // exactly how Apple wants it. Treat a completed request as connected.
    return (s && (s.readAuthorized || s.readDenied)) ? 'granted' : 'denied';
  }catch(e){ return 'denied'; }
};

// The last clamp-window of workouts, mapped and ready to suggest.
// Returns [] on any failure — a health hiccup must never break Home.
window.healthRecentWorkouts = async function(){
  if(!window.isNative() || !window.healthEnabled()) return [];
  const H = (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.Health) || null;
  if(!H) return [];
  try{
    const now = new Date();
    // D3: the server clamp is max(1st of month, today-7) .. today. Mirror it.
    const first = new Date(now.getFullYear(), now.getMonth(), 1);
    const week  = new Date(now.getTime() - 7*86400000);
    const start = week > first ? week : first;
    const r = await H.queryWorkouts({ startDate: start.toISOString(), endDate: now.toISOString(), limit: 60 });
    return (r && r.workouts || []).map(w => {
      const d = new Date(w.startDate);
      return {
        id:    w.platformId || (w.workoutType + '|' + w.startDate),
        label: window.healthLabelOf(w.workoutType),
        rawType: w.workoutType,
        day:   d.getDate(), month: d.getMonth()+1, year: d.getFullYear(),
        minutes: Math.round((w.duration || 0) / 60),
        km:    w.totalDistance ? Math.round(w.totalDistance/100)/10 : null,
        source: w.sourceName || ''
      };
    }).filter(w => w.minutes >= 10);   // a 3-minute stroll is not a workout
  }catch(e){ return []; }
};

/* ═══════════════════════════════════════════════════════════════════════════
   THE STEP CHALLENGE — weekly, team-vs-team, read-only from the device.

   ONE NUMBER CONFIGURES IT. `perMemberTarget` (70,000/week = 10k/day) gives
   both the displayed team goal and the win test, because comparing team
   AVERAGES is the same arithmetic as comparing totals-over-size:

       team goal shown  = perMemberTarget × teamSize    (5 → 3,50,000)
       winner           = highest team average
       cleared the bar? = winning average ≥ perMemberTarget

   That equivalence is why unequal teams are fair for free. Forge's teams are
   7-and-8 in at least one live group, and a SUM race would hand the 8 a ~14%
   head start — the same uneven-split unfairness the team-streak threshold
   already ran into.

   WHY NO MANUAL ENTRY. A typed step count is a number a person chooses, and
   points hang on it. Reading the platform's own store is the only version of
   this that is worth playing, and it is also why the feature is native-only:
   a browser cannot see step data at all.

   COMPLETED DAYS ONLY. Today's count climbs all day. Scoring it would make the
   board flicker, let people watch the race live, and turn "who won" into a
   question of who refreshed last. Yesterday and earlier are final and boring,
   which is what a scoreboard needs.
   ═══════════════════════════════════════════════════════════════════════════ */

window.STEP_PER_MEMBER_TARGET = 70000;   // per member, per week (10k × 7)
window.STEP_WIN_BONUS         = 5;       // points to each member of the winning team
// Above any real human day (the recorded 24h record is ~100k) and far below the
// absurd. Applied on READ as well as write, so a forged doc cannot move a board
// even if it slips past the rules — the same belt-and-braces shape as
// KM_MAX_PER_LOG in the scoring engine.
window.STEP_DAILY_CAP         = 100000;

// YYYY-MM-DD in LOCAL time. Deliberately not toISOString(), which converts to
// UTC and would file an 11pm IST walk under the following day.
window.ymdLocal = function(d){
  return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0')
                         + '-' + String(d.getDate()).padStart(2,'0');
};

// The Monday of the week containing `d`, at local midnight. Forge weeks are
// Mon–Sun everywhere (perfect-week scoring, twist windows), so this matches.
window.weekMondayOf = function(d){
  const m = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const dow = m.getDay() || 7;             // Sun(0) → 7
  m.setDate(m.getDate() - (dow - 1));
  return m;
};

// Steps per day for a date range, as { 'YYYY-MM-DD': n }. Reads the platform
// health store — HealthKit on iOS, Health Connect on Android; the plugin
// presents one API over both. Returns {} on any failure: a health hiccup must
// never break Home, same contract as healthRecentWorkouts above.
window.healthDailySteps = async function(fromDate, toDate){
  if(!window.isNative() || !window.healthEnabled()) return {};
  const H = (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.Health) || null;
  if(!H || typeof H.queryAggregated !== 'function') return {};
  try{
    const start = new Date(fromDate.getFullYear(), fromDate.getMonth(), fromDate.getDate());
    const end   = new Date(toDate.getFullYear(),   toDate.getMonth(),   toDate.getDate(), 23, 59, 59, 999);
    if(end < start) return {};
    const r = await H.queryAggregated({
      dataType: 'steps', bucket: 'day',
      startDate: start.toISOString(), endDate: end.toISOString()
    });
    const out = {};
    for(const b of (r && r.aggregatedData) || []){
      // The bucket's own start instant decides which local day it belongs to.
      const d = new Date(b.startDate);
      if(isNaN(d.getTime())) continue;
      // A bucket can carry the value under `value` or under a per-type map,
      // depending on plugin version. Coerce hard: this number is about to
      // become points, and NaN/Infinity/strings must never reach Firestore.
      const raw = (b.value != null) ? b.value
                : (b.values && b.values.steps != null) ? b.values.steps
                : null;
      const n = Math.round(Number(raw));
      if(!Number.isFinite(n) || n <= 0) continue;
      out[window.ymdLocal(d)] = Math.min(n, window.STEP_DAILY_CAP);
    }
    return out;
  }catch(e){ return {}; }
};

// Is the challenge switched on for the season being viewed? Super-admin sets
// season.stepChallenge.enabled. Absent/false on every season that predates the
// feature, so nothing changes for anyone until it is deliberately turned on.
window.isStepChallengeOn = function(s){
  const cfg = (s || window.season || {}).stepChallenge;
  return !!(cfg && cfg.enabled === true);
};
// Per-season overrides, falling back to the constants above.
window.stepTargetOf = function(s){
  const cfg = (s || window.season || {}).stepChallenge || {};
  const t = Number(cfg.perMemberTarget);
  return (Number.isFinite(t) && t > 0) ? t : window.STEP_PER_MEMBER_TARGET;
};
window.stepBonusOf = function(s){
  const cfg = (s || window.season || {}).stepChallenge || {};
  const b = Number(cfg.bonus);
  return (Number.isFinite(b) && b >= 0) ? b : window.STEP_WIN_BONUS;
};

// seen = suggested-and-actioned (logged or dismissed). Bounded to the last
// 200 ids so localStorage cannot grow forever.
window.healthSeen = function(){
  try{ return JSON.parse(localStorage.getItem(window.healthSeenKey) || '[]'); }catch(e){ return []; }
};
window.healthMarkSeen = function(id){
  try{
    const s = window.healthSeen(); if(s.includes(id)) return;
    s.push(id);
    localStorage.setItem(window.healthSeenKey, JSON.stringify(s.slice(-200)));
  }catch(e){}
};

// ── OBJECTIONABLE TEXT ────────────────────────────────────────────────────
// Guideline 1.2 wants "a method for filtering objectionable material from being
// posted". This is a TRIPWIRE, not moderation, and the distinction is worth
// being honest about: a client-side list is trivially bypassed by anyone who
// wants to, and the real protections here are that groups are small, invite-
// only, and every post carries a real name your friends can see.
//
// What it genuinely buys: a slip typed into a shared feed gets caught before it
// lands, and there is a filter to point at. Slurs only — NOT mild profanity.
// Over-blocking a fitness app where people name a workout "leg day killer"
// would be its own kind of failure, and a filter people learn to fight is worse
// than none.
//
// Substring matching with word boundaries where it matters, so "class" and
// "Scunthorpe" survive. Kept deliberately short.
window.BLOCKED_TERMS = [
  'nigger','nigga','faggot','fag ','kike','spic ','chink','wetback','tranny',
  'retard','paki ','coon ','gook','dyke ','beaner','raghead'
];
// Returns the offending term, or null when the text is fine.
window.offensiveTerm = function(text){
  if(!text) return null;
  const s = ' ' + String(text).toLowerCase().replace(/[^a-z ]+/g,' ') + ' ';
  for(const t of window.BLOCKED_TERMS){
    const term = t.trim();
    if(s.includes(' ' + term + ' ') || s.includes(' ' + term) && t.endsWith(' ')) return term;
    if(!t.endsWith(' ') && s.includes(term)) return term;
  }
  return null;
};

// ── BLOCKING ──────────────────────────────────────────────────────────────
// App Store Guideline 1.2 requires an app showing user-generated content to
// let people BLOCK abusive users, not merely report them. Forge qualifies: the
// feed shows other people's activity, and workout names and notes are free
// text. Reporting existed (flagLog); blocking did not.
//
// PER-DEVICE, in localStorage, NOT in Firestore. That is a deliberate choice.
// A server-side block list would be readable by everyone — the rules make
// user docs world-readable — so "who has blocked whom" would become public,
// which is worse for the blocked and the blocker both. Blocking is about what
// YOU have to look at, so it belongs on your device.
//
// Scoped per group: the same display name in two groups is two different
// people (there are real cases of this), so a block must never leak across.
window.blockKey = 'forge_blocked_v1';

function _blockAll(){
  try{ return JSON.parse(localStorage.getItem(window.blockKey) || '{}'); }
  catch(e){ return {}; }
}
function _blockSave(o){
  try{ localStorage.setItem(window.blockKey, JSON.stringify(o)); }catch(e){}
}
// Group-scoped list of blocked display names.
window.blockedIn = function(groupCode){
  const all = _blockAll();
  return Array.isArray(all[groupCode]) ? all[groupCode] : [];
};
window.isBlocked = function(groupCode, name){
  if(!name) return false;
  return window.blockedIn(groupCode).some(n => String(n).toLowerCase() === String(name).toLowerCase());
};
window.blockPlayer = function(groupCode, name){
  if(!groupCode || !name) return;
  const all = _blockAll();
  const list = Array.isArray(all[groupCode]) ? all[groupCode] : [];
  if(!list.some(n => String(n).toLowerCase() === String(name).toLowerCase())) list.push(name);
  all[groupCode] = list; _blockSave(all);
};
window.unblockPlayer = function(groupCode, name){
  const all = _blockAll();
  all[groupCode] = (all[groupCode] || []).filter(n => String(n).toLowerCase() !== String(name).toLowerCase());
  _blockSave(all);
};

// ── NATIVE BRIDGE ─────────────────────────────────────────────────────────
// One codebase, two runtimes. Every helper below does the native thing inside
// the iOS app and the sensible web thing in a browser, so call sites never
// branch and nothing here can break goforge.in.
//
// window.Capacitor only exists inside the native shell — it is undefined in
// every browser, so isNative() is false on the web and each wrapper falls
// through to its web path.
window.isNative = function(){
  const C = window.Capacitor;
  return !!(C && ((typeof C.isNativePlatform === 'function' && C.isNativePlatform())
                   || C.platform === 'ios' || C.platform === 'android'));
};
function _plugin(name){
  const C = window.Capacitor;
  return (C && C.Plugins && C.Plugins[name]) || null;
}

// HAPTICS. navigator.vibrate is Android/Chrome only — on iOS Safari and inside
// WKWebView it does not exist, so the five vibrate() calls in the app have
// always been silent no-ops on iPhone. This routes to the real Taptic Engine on
// native and keeps the old behaviour on the web.
window.tap = function(style){
  try{
    if(window.isNative()){
      const H = _plugin('Haptics');
      if(H){
        if(style === 'success' || style === 'warning' || style === 'error'){
          H.notification({ type: style.toUpperCase() });
        } else {
          H.impact({ style: (style === 'heavy' ? 'HEAVY' : style === 'medium' ? 'MEDIUM' : 'LIGHT') });
        }
        return;
      }
    }
    if(navigator.vibrate) navigator.vibrate(style === 'heavy' ? 18 : 8);
  }catch(e){ /* feedback must never break a tap */ }
};

// SHARE. Native sheet on iOS, Web Share where the browser has it, clipboard as
// the last resort so the action always does something.
window.shareText = async function(title, text, url){
  try{
    if(window.isNative()){
      const S = _plugin('Share');
      if(S){ await S.share({ title, text, url, dialogTitle: title }); return 'native'; }
    }
    if(navigator.share){ await navigator.share({ title, text, url }); return 'web'; }
    await navigator.clipboard.writeText([text, url].filter(Boolean).join(' '));
    return 'clipboard';
  }catch(e){
    if(e && e.name === 'AbortError') return 'cancelled';   // user dismissed the sheet
    return 'failed';
  }
};

// ── LOCAL NOTIFICATIONS ───────────────────────────────────────────────────
// DELIBERATELY NOT "don't forget to work out". functions/index.js states the
// rule and it is the right one: only send what ANOTHER PERSON caused, or what
// the app genuinely finished computing — never a reminder to exercise. An app
// that spends its notification permission on nagging gets muted in a week and
// then has no channel at all.
//
// So the one thing scheduled here is the MONDAY RECAP: last week is closed and
// the in-app recap card is waiting. It is the second of the two notifications
// that file already sanctions, it is purely calendar-based, and that matters —
// a local notification cannot know what other people did after the app was
// closed, so anything depending on live team state would go stale on the
// device. This does not. It is correct whether or not the phone has been
// online since Friday.
//
// The streak-at-risk message stays SERVER-side for exactly that reason: it
// depends on what teammates did in the last few hours, which only the server
// can know. Local and push are not substitutes; they carry different messages.
window.NOTIF_RECAP_ID = 4801;              // stable id so rescheduling replaces
window.notifPrefKey  = 'forge_notif_recap';

window.notifEnabled = function(){
  try{ return localStorage.getItem(window.notifPrefKey) === '1'; }catch(e){ return false; }
};
window.setNotifEnabled = function(on){
  try{ localStorage.setItem(window.notifPrefKey, on ? '1' : '0'); }catch(e){}
};

// Ask, schedule, and report back honestly. Returns one of:
// 'unsupported' | 'denied' | 'scheduled'
window.scheduleMondayRecap = async function(){
  if(!window.isNative()) return 'unsupported';
  const LN = _plugin('LocalNotifications');
  if(!LN) return 'unsupported';
  try{
    let perm = await LN.checkPermissions();
    if(perm.display !== 'granted') perm = await LN.requestPermissions();
    if(perm.display !== 'granted') return 'denied';

    await LN.cancel({ notifications: [{ id: window.NOTIF_RECAP_ID }] });
    await LN.schedule({ notifications: [{
      id: window.NOTIF_RECAP_ID,
      title: 'Last week is in',
      body: 'Your recap is ready. See how the group did, and start the new one.',
      schedule: {
        // Repeating weekly on Monday 08:00 LOCAL time. `allowWhileIdle` so a
        // dozing phone still fires it rather than silently dropping the week.
        on: { weekday: 2, hour: 8, minute: 0 },   // Capacitor weekday: 1=Sun
        allowWhileIdle: true
      }
    }]});
    return 'scheduled';
  }catch(e){ return 'denied'; }
};

window.cancelMondayRecap = async function(){
  if(!window.isNative()) return;
  const LN = _plugin('LocalNotifications');
  if(!LN) return;
  try{ await LN.cancel({ notifications: [{ id: window.NOTIF_RECAP_ID }] }); }catch(e){}
};

// ── HELPERS ───────────────────────────────────────────────────────────────
// Format a season ID from month+year. Always zero-padded: "2026-07" not "2026-7".
window.seasonIdOf = function(month, year){
  return `${year}-${String(month).padStart(2,'0')}`;
};

// ── FEATURE FLAGS ─────────────────────────────────────────────────────────
// AUTH PHASE 1. Stays FALSE until two Firebase-console steps are done, neither
// of which can be automated:
//   1. Blaze enabled on the project (needed later for claimIdentity(); free)
//   2. Authentication -> Sign-in method -> Google ENABLED + OAuth client created
// Flipping this to true is the ONLY code change needed to switch the feature on,
// and flipping it back to false is a complete, instant rollback — every Google
// surface is gated on it and the anonymous + PIN paths are untouched underneath.
// Turn it on for STAGING first; prod stays false until warm-user QA passes.
window.FEATURE_GOOGLE_AUTH = false;

// SERVER-SIDE PRIVILEGED WRITES (AUTH_PHASE2_NOTES.md). When true, the rollover
// snapshot hands its foreign user-doc stat increments to the awardSeasonBadges
// Cloud Function instead of writing them from the client — the prerequisite
// for the users-doc ownership rule (a client can't write a LINKED player's doc
// once that rule is live, and rollover writes to every player). Ships in the
// SAME promotion as the Function deploy + the ownership-rule deploy; false
// keeps the legacy in-batch client write (unchanged behaviour). Staging-first.
window.FEATURE_SERVER_WRITES = false;

// PUSH NOTIFICATIONS. Needs one console step that cannot be automated:
//   Firebase console -> Project settings -> Cloud Messaging ->
//   Web Push certificates -> Generate key pair
// Paste the key below and flip the flag. Without it getToken() throws, so the
// flag is a real gate, not decoration. Staging first; prod after warm QA.
// PILOT OVERRIDE: localStorage.setItem('forgePushPilot','1') turns the push
// UI on for THIS DEVICE ONLY — so the feature can be tested end-to-end on
// prod without 76 people seeing a button that is still being proven. The
// global flag below remains the launch switch for everyone else.
// ?pushpilot in the URL arms the same override — a phone has no console, and
// the pilot's whole point is testing on the devices notifications target.
window.FEATURE_PUSH = false || (function(){ try{
  if(location.search.indexOf('pushpilot')>=0) localStorage.setItem('forgePushPilot','1');
  return localStorage.getItem('forgePushPilot')==='1';
}catch(e){ return false; } })();
window.FCM_VAPID_KEY = 'BP2E5C9t--QJBU2hX9qYNPn2NX7p5V_i_e8U34fvP3SpZgPd9FAFsFw9oBpaYLEGQmPDmR4y345daVedGL88Ad4';   // Web Push certificate (PUBLIC key
// by design — it ships in every client; the private half never leaves Google).
// Generated 26 Aug 2026, forge-25c8c -> Cloud Messaging -> Web configuration.

// ── THE HALL OF THE DEPARTED ──────────────────────────────────────────────
// Locked decision, 25 Jul 2026 (AUTH_DESIGN_FINAL Q4). A deleted player is not
// erased from a group's history — their league record is the GROUP's shared
// record, not only theirs. They are replaced by a punny departure name, taken
// in order, skipping any already used in that group. Bank exhausted -> "Gone
// Player #N".
//
// It also happens to be the right engineering answer. A single generic
// "Deleted user" would collide the moment two people left the same group, and
// this app keys identity on the name string in a dozen places — two identical
// roster names is undefined behaviour, not a cosmetic problem.
window.DEPARTED_NAMES = [
  'Sheera Naway', 'Simran Bhaag', 'Ranaway Rana', 'Gayab Singh',
  'Nikhil Gayaa', 'Farrar Khan',  'Rafu Chakkar', 'Bhaagi Mehta',
  'Gul Hogayaa',  'U-Turn Uday',  'Tata B. Bai',  'Chhod K. Gaya'
];

// Pick the next unused departure name for a roster. Deterministic and
// collision-free within a group, which is what the name-keyed lookups need.
window.pickDepartedName = function(roster){
  const taken = new Set((roster||[]).map(p => p && p.name).filter(Boolean));
  for(const n of window.DEPARTED_NAMES){ if(!taken.has(n)) return n; }
  let i = 1;
  while(taken.has('Gone Player #' + i)) i++;
  return 'Gone Player #' + i;
};

// ── SOLO / SMALL-GROUP MODE ───────────────────────────────────────────────
// numTeams === 1 means "the team is the whole group": no team standings, no
// rivalry UI, one shared GROUP streak, one podium. It is the single change that
// serves every group below 6 AND solo (a group of 1).
//
// Why groups under 6 needed this: the team streak threshold is
// ceil(teamSize x teamStreakThreshold). Split 4 people into 2 teams at the 0.6
// default and each team of 2 needs BOTH people EVERY day — zero slack, so the
// streak never starts and those groups never see the mechanic Forge is built
// around. They were not being fussy; 2v2 is mechanically impossible.
//
// This is a DATA gate, not a build flag: it reads the season's own numTeams, so
// every existing 2- and 3-team group is untouched.
window.isSoloMode = function(){
  return Number(window.season && window.season.numTeams) === 1;
};

// The team letters a season actually uses. Replaces three separate hand-rolled
// `season.numTeams === 2 ? 2 : 3` coercions, each of which silently turned a
// numTeams of 1 into 3 — which is why writing numTeams:1 to Firestore used to
// do nothing at all. Unknown/absent values still fall back to 3, as before.
window.teamLettersOf = function(season){
  const n = Number(season && season.numTeams);
  if(n === 1) return ['A'];
  if(n === 2) return ['A','B'];
  return ['A','B','C'];
};

// Look up a player's team+role from the current season's roster.
// Returns null if player not on roster.
window.rosterEntry = function(name){
  if(!window.season || !Array.isArray(window.season.roster)) return null;
  return window.season.roster.find(p => p.name === name) || null;
};