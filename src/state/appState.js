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
window.FEATURE_PUSH = false;
window.FCM_VAPID_KEY = '';   // <-- paste the Web Push certificate key pair here

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