// ── ENVIRONMENT SELECT ──────────────────────────────────────────────
// One file, two environments. We pick the database by WHERE the app is served:
//   localhost / 127.0.0.1            → STAGING (testing on your Mac)
//   any URL containing "forge-staging" → STAGING (the staging website)
//   anything else (the real /forge/)   → PRODUCTION
const PROD_CFG = {
  apiKey: "AIzaSyCIXojxM6N6f6kp10g7zYV5XYTyLJ6pz2g",
  authDomain: "forge-25c8c.firebaseapp.com",
  projectId: "forge-25c8c",
  storageBucket: "forge-25c8c.firebasestorage.app",
  messagingSenderId: "981352149705",
  appId: "1:981352149705:web:454b18a677e625b9b39318"
};
// ⬇️⬇️ PASTE your forge-staging config here (from Firebase console, step 2) ⬇️⬇️
const STAGING_CFG = {
  apiKey: "AIzaSyD-bFi6X9Hevwmg-p65ajz35G64wco90CA",
  authDomain: "forge-staging-865ff.firebaseapp.com",
  projectId: "forge-staging-865ff",
  storageBucket: "forge-staging-865ff.firebasestorage.app",
  messagingSenderId: "672166239076",
  appId: "1:672166239076:web:a3156e7be0ade35be6b871"
};
// ⬆️⬆️ -------------------------------------------------------------- ⬆️⬆️

// NATIVE FIRST — this check has to come before the hostname one, and the
// reason is a live footgun found the first time the iOS app booted.
//
// Capacitor serves the BUNDLED app from https://localhost. The hostname test
// below reads that as "a developer's machine" and hands back the STAGING
// config, so every iOS user would have been reading and writing the test
// database while the orange STAGING banner sat at the bottom of the screen.
// It fails silently and it fails for everyone.
//
// A native build is always production. If a staging build of the app is ever
// wanted, it needs its own bundle id and an explicit flag — never an accident
// of which URL scheme Capacitor happened to choose.
//
// No-op on the web: window.Capacitor is undefined in every browser, so the
// hostname logic below is reached unchanged.
const IS_NATIVE = !!(window.Capacitor && (
  (typeof window.Capacitor.isNativePlatform === 'function' && window.Capacitor.isNativePlatform())
  || window.Capacitor.platform === 'ios'
  || window.Capacitor.platform === 'android'
));
window.IS_NATIVE = IS_NATIVE;

const IS_STAGING = !IS_NATIVE && (
  location.hostname === 'localhost' ||
  location.hostname === '127.0.0.1' ||
  location.pathname.includes('forge-staging')
);
window.IS_STAGING = IS_STAGING;
const FB_CFG = IS_STAGING ? STAGING_CFG : PROD_CFG;

firebase.initializeApp(FB_CFG);

/* ═══════════════════════════════════════════════════════════════════════════
   APP CHECK — SECURITY_REDTEAM.md rank 4, "the single highest-value security
   change available right now" (AUTH_PHASE2_NOTES).

   WHAT IT STOPS. Every attack the red team actually landed was a plain fetch
   carrying the public API key, with no browser and no app: reading all 66
   names, creating 25 errorLogs docs in 376 ms, scripted mass-delete attempts.
   App Check attests that a request comes from THIS app on a real device, so
   all of that stops working. WHAT IT DOES NOT STOP: a determined person
   driving the real app in a real browser — App Check attests the app, not the
   user. That is the identity layer's job (claimIdentity + ownership rules).

   INERT UNTIL CONFIGURED. Needs one console step per project that no agent
   can do: App Check → register the web app → reCAPTCHA v3 → site key. With
   RECAPTCHA_SITE_KEY empty this whole block no-ops, so it ships safely ahead
   of the console work. Enforcement is a SEPARATE console toggle: register
   first, watch the App Check dashboard for unverified traffic, and only then
   enforce — flipping both at once can lock out a client you forgot about.

   ⚠️ SCRIPTS: gcloud OWNER_TOKEN scripts (manual-log, scrub-*, seed-*,
   ranking-cards) use Google Cloud IAM credentials and BYPASS App Check
   entirely — they need nothing. But scripts/forge-daily.mjs signs in
   anonymously with the PUBLIC API KEY, which is exactly the shape App Check
   blocks: enforcing App Check WILL break the daily brief + backups until it
   either moves to an OWNER_TOKEN or gets a registered debug token. Decide
   before flipping enforcement, not after.
   ═══════════════════════════════════════════════════════════════════════════ */
const RECAPTCHA_SITE_KEY = {
  'forge-staging-865ff': '',   // ⬅️ paste the staging reCAPTCHA v3 site key
  'forge-25c8c':         ''    // ⬅️ prod key — set only at the prod promotion
}[FB_CFG.projectId] || '';

window.APP_CHECK_READY = false;
if(RECAPTCHA_SITE_KEY && typeof firebase !== 'undefined' && firebase.appCheck){
  try{
    // Debug provider for local dev: prints a token to the console to register
    // under App Check → Manage debug tokens. Without this, localhost cannot
    // pass attestation and every read fails once enforcement is on.
    if(location.hostname === 'localhost' || location.hostname === '127.0.0.1'){
      self.FIREBASE_APPCHECK_DEBUG_TOKEN = true;
    }
    firebase.appCheck().activate(RECAPTCHA_SITE_KEY, true);   // true = auto-refresh
    window.APP_CHECK_READY = true;
  }catch(e){
    // Never let attestation setup break boot — an unattested client still
    // works until enforcement is switched on, and a hard failure here would
    // take the whole app down for everyone.
    console.warn('[Forge] App Check activation failed:', e && e.message);
  }
}

const db = firebase.firestore();
// Cache reads in IndexedDB so a returning session gets a resume-token delta
// sync instead of re-billing the whole result set (~85-90% fewer reads on the
// logs listener). synchronizeTabs lets open tabs share one cache; on any
// failure (private mode, unsupported browser) the app runs exactly as before.
db.enablePersistence({synchronizeTabs:true})
  .catch(err => {
    if (err.code !== 'failed-precondition') {
      console.warn('[Forge] Firestore persistence not enabled:', err.code);
      // A non-"another tab has it open" failure at ENABLE time (not the more
      // common mid-session wedge, but a real signal) usually means the local
      // IndexedDB store is already broken. Surface it immediately rather than
      // silently degrading — the alternative is a user stuck on a blank/broken
      // screen with zero path forward.
      window._forgeMarkChannelError && window._forgeMarkChannelError('enablePersistence', err);
    }
  });
const auth = firebase.auth();
// Explicit LOCAL (IndexedDB) auth persistence. This is the compat SDK's default
// already, so it is belt-and-suspenders — guards against future default drift and
// documents intent. NOTE: this is NOT the fix for "installed PWA forgot me": the
// app resumes from the localStorage session (forge_sessions), not this auth
// session, so the real mitigation is storage durability (navigator.storage.persist)
// plus not evicting it — see index.html. Best-effort; never throws.
try { auth.setPersistence(firebase.auth.Auth.Persistence.LOCAL).catch(function(){}); } catch(e){}

// ── CONNECTION RESET — recovers a wedged/corrupted local Firebase state ─────
// Root cause this defends against: Firebase Auth (and, where enabled,
// Firestore) persist their session/cache in IndexedDB. That local store can
// become corrupted or wedged (seen in production: 400s on BOTH the Listen and
// Write channels simultaneously, clearing instantly in Incognito — proving
// it's local browser state, not a server/quota/rules problem). When that
// happens every Firestore call fails silently and there is no in-app path to
// recovery for a non-technical user — they'd need to find browser settings
// and manually clear site data, which they will never do on their own.
//
// This does NOT touch localStorage (forge_sessions/forge_active — the user's
// group membership pointers — must survive) or "all site data." It targets
// only the specific IndexedDB databases Firebase itself creates.
window.resetFirestoreState = function(reason){
  try { console.warn('[Forge] Resetting local Firebase state. Reason:', reason); } catch(e){}
  const known = [
    'firebaseLocalStorageDb',                          // Firebase Auth's own persisted session
    'firebase-heartbeat-database',                      // Firebase internal heartbeat/telemetry
    `firestore/[DEFAULT]/${FB_CFG.projectId}/main`       // Firestore's own offline cache (if enabled)
  ];
  const purge = name => new Promise(resolve => {
    let settled = false;
    const done = () => { if(!settled){ settled = true; resolve(); } };
    try {
      const req = indexedDB.deleteDatabase(name);
      req.onsuccess = done; req.onerror = done; req.onblocked = done;
    } catch(e){ done(); }
    setTimeout(done, 600); // never let one blocked/slow delete hang the reset
  });
  const sweep = (async () => {
    const names = new Set(known);
    try {
      if (indexedDB.databases) {
        const all = await indexedDB.databases();
        all.forEach(d => { if(d.name && /firebase|firestore/i.test(d.name)) names.add(d.name); });
      }
    } catch(e){ /* indexedDB.databases() unsupported (older Safari) — known[] list still covers it */ }
    await Promise.all([...names].map(purge));
  })();
  sweep.finally(() => { location.reload(); });
};

// ── HARD DEVICE RESET ────────────────────────────────────────────────────────
// resetFirestoreState above is the gentle one: it clears Firebase's local
// databases and KEEPS you logged in. That fixes a wedged live channel, and it
// is the right first move — which is why the nav's ↻ does exactly that.
//
// This is the one for the state it cannot fix. Dhwani hit it: closed every tab,
// came back, and the app refused her login. When the stored session pointer
// itself is stale — pointing at a player row or a device token the server no
// longer agrees with — no amount of clearing Firebase's cache helps, because
// the bad data is Forge's own localStorage. The only fix was someone manually
// resetting her, which is not a support model.
//
// So this wipes everything this origin holds: Firebase's IndexedDB, every
// forge_* key, sessionStorage, the service worker and its caches (a stale
// cached index.html is its own version of the same bug). It is a factory reset
// for the device, not the account — nothing server-side is touched, no log,
// score or streak is at risk. The cost is re-entering the group code and PIN.
//
// Deliberately lives HERE, in firebase.js, next to its gentler sibling and
// outside index.html's giant script block: if that block ever throws during
// boot, this function is still defined and the recovery screen can still call
// it. A recovery path that needs the broken thing to work is not a recovery
// path.
window.hardResetDevice = function(reason){
  try { console.warn('[Forge] HARD device reset. Reason:', reason); } catch(e){}
  const jobs = [];
  // 1. every IndexedDB this origin owns (Firebase auth, heartbeat, Firestore cache)
  const purge = name => new Promise(resolve => {
    let settled = false; const done = () => { if(!settled){ settled = true; resolve(); } };
    try { const req = indexedDB.deleteDatabase(name); req.onsuccess=done; req.onerror=done; req.onblocked=done; }
    catch(e){ done(); }
    setTimeout(done, 600);
  });
  jobs.push((async () => {
    const names = new Set([
      'firebaseLocalStorageDb', 'firebase-heartbeat-database',
      `firestore/[DEFAULT]/${FB_CFG.projectId}/main`
    ]);
    try {
      if (indexedDB.databases) (await indexedDB.databases()).forEach(d => { if(d.name) names.add(d.name); });
    } catch(e){ /* older Safari has no databases() — the known list still covers Firebase */ }
    await Promise.all([...names].map(purge));
  })());
  // 2. Forge's own stored state — the part resetFirestoreState deliberately spares
  try {
    Object.keys(localStorage)
      .filter(k => /^forge[_-]/i.test(k) || k === 'forge_session')
      .forEach(k => { try { localStorage.removeItem(k); } catch(e){} });
  } catch(e){}
  try { sessionStorage.clear(); } catch(e){}
  // 3. the service worker and its caches — a stale cached shell is the third
  //    way this failure shows up, and it survives both of the steps above
  jobs.push((async () => {
    try { if(window.caches) await Promise.all((await caches.keys()).map(k => caches.delete(k))); } catch(e){}
    try {
      if(navigator.serviceWorker){
        const regs = await navigator.serviceWorker.getRegistrations();
        await Promise.all(regs.map(r => r.unregister().catch(()=>{})));
      }
    } catch(e){}
  })());
  // Cache-busted reload so the very next request cannot be served from a
  // memory/HTTP cache that outlived everything we just deleted.
  Promise.all(jobs).catch(()=>{}).finally(() => {
    try { location.replace(location.pathname + '?fresh=' + Date.now()); }
    catch(e){ location.reload(); }
  });
};

// ── LIVE CHANNEL ERROR DETECTOR ──────────────────────────────────────────────
// Rolling-window burst detector: a single Firestore hiccup is normal network
// noise; TWO OR MORE distinct channels failing within 8s is the signature of
// a wedged local store, not a blip. index.html's subscribe() (mid-session
// listener errors) and the enablePersistence catch above both feed this.
let _channelErrors = [];
window._forgeMarkChannelError = function(source, err){
  const now = Date.now();
  _channelErrors = _channelErrors.filter(e => now - e.ts < 8000);
  _channelErrors.push({source, ts: now});
  try { console.error('[Forge] Channel error ('+source+'):', err); } catch(e){}
  if (_channelErrors.length >= 2) {
    const distinctSources = new Set(_channelErrors.map(e=>e.source)).size;
    if (distinctSources >= 2 && typeof window._forgeOnChannelWedged === 'function') {
      window._forgeOnChannelWedged();
    }
  }
};

// Self-contained, dependency-free recovery screen for the catastrophic case
// (auth/boot itself fails) — deliberately does NOT rely on main.css classes
// or any index.html function, since this can fire before either is ready.
window.showBootFailureRecovery = function(message){
  if (document.getElementById('forgeBootRecovery')) return; // don't stack
  const wrap = document.createElement('div');
  wrap.id = 'forgeBootRecovery';
  wrap.style.cssText = 'position:fixed;inset:0;z-index:99999;display:flex;align-items:center;justify-content:center;'+
    'background:#0a0a0d;color:#f5f5f7;font-family:-apple-system,BlinkMacSystemFont,"SF Pro Text",sans-serif;padding:32px;text-align:center';
  wrap.innerHTML =
    '<div style="max-width:340px">'+
      '<div style="font-size:17px;font-weight:700;margin-bottom:10px">'+ (message || 'Having trouble connecting') +'</div>'+
      '<div style="font-size:13px;color:#9a9aa3;line-height:1.5;margin-bottom:22px">This usually clears itself. Try again first — if it keeps happening, reset the connection.</div>'+
      '<button id="forgeBootTryAgain" style="display:block;width:100%;padding:14px;border-radius:14px;border:none;'+
        'background:linear-gradient(180deg,#e7bf58,#c69d35);color:#221804;font-size:15px;font-weight:700;margin-bottom:10px;cursor:pointer">Try Again</button>'+
      '<button id="forgeBootReset" style="display:block;width:100%;padding:12px;border-radius:14px;border:1px solid rgba(255,255,255,.15);'+
        'background:transparent;color:#9a9aa3;font-size:13px;cursor:pointer">Reset connection and try again</button>'+
    '</div>';
  document.body.innerHTML = '';
  document.body.appendChild(wrap);
  document.getElementById('forgeBootTryAgain').onclick = () => location.reload();
  // Boot-path and write-path failures now share ONE heal implementation:
  // fixLocalState is the fuller reset (SW + caches + persistence + auth session
  // + Forge session keys), superseding the IndexedDB-only resetFirestoreState.
  document.getElementById('forgeBootReset').onclick = () => window.fixLocalState('boot-failure-manual-reset');
};

window.db = db;
window.firebase = firebase;
window.auth = auth;

// Unmistakable banner so you ALWAYS know which database you're touching.
if(IS_STAGING){
  console.log('%c⚙️ FORGE STAGING — test database','background:#f59e0b;color:#000;font-size:14px;padding:4px 8px;border-radius:4px');
  window.addEventListener('DOMContentLoaded',()=>{
    const b=document.createElement('div');
    b.textContent='⚙️ STAGING — test data';
    b.style.cssText='position:fixed;bottom:0;left:0;right:0;background:#f59e0b;color:#000;font:600 12px sans-serif;text-align:center;padding:4px;z-index:99999';
    document.body.appendChild(b);
  });
}

// Ensure an anonymous Firebase session exists before any Firestore call.
window.ensureAuth = function(){
  return new Promise((resolve, reject) => {
    const existing = auth.currentUser;
    // Did a persisted anon session survive this launch? Recorded BEFORE any
    // signInAnonymously so the session_lost breadcrumb can tell "IndexedDB auth
    // survived but localStorage was evicted" apart from a fresh first visit.
    window._forgeAuthPreexisting = !!existing;
    if(existing){ resolve(existing.uid); return; }
    // A ceiling on the whole thing. signInAnonymously().catch covers the case
    // where the call itself fails, but not the one where it resolves and
    // onAuthStateChanged never fires — a wedged connection, a half-open socket,
    // an IndexedDB that will not answer. There was no timer here, so that path
    // hung forever: no error, no timeout, no screen. Boot simply stopped, which
    // is exactly the "connection stuck" symptom that took a live debugging
    // session to pin down.
    //
    // 15s is deliberately generous — a slow Indian mobile connection on a cold
    // start must not trip this. Anything past 15s was never going to arrive.
    let settled = false;
    const done = fn => (...a) => { if(settled) return; settled = true; clearTimeout(timer); fn(...a); };
    const timer = setTimeout(() => {
      try{ unsubscribe(); }catch(e){}
      done(reject)(new Error('AUTH_TIMEOUT'));
    }, 15000);

    const unsubscribe = auth.onAuthStateChanged(user => {
      if(user){ try{ unsubscribe(); }catch(e){} done(resolve)(user.uid); }
    });
    auth.signInAnonymously().catch(err => {
      try{ unsubscribe(); }catch(e){}
      console.error('Anonymous sign-in failed:', err);
      done(reject)(err);
    });
  });
};

/* ═══════════════════════════════════════════════════════════════════════════
   GOOGLE SIGN-IN — AUTH PHASE 1 (coexistence)
   Contract: AUTH_DESIGN_FINAL.md, Option A, locked 25 Jul 2026.

   PHASE 1 CHANGES NOTHING FOR ANYONE. Anonymous boot above is untouched, PIN
   login is untouched, and every surface below is behind FEATURE_GOOGLE_AUTH,
   which stays FALSE until two console steps are done that no agent can do:
     1. Blaze enabled on the project
     2. Authentication -> Sign-in method -> Google ENABLED, OAuth client created
   With the flag false these functions are inert and the UI never appears, so
   this can sit on staging safely until those are ready.

   WHY REDIRECT, NOT POPUP. signInWithPopup is blocked or silently broken inside
   the Android TWA and in iOS standalone PWAs — the two places most Forge users
   will be. Redirect works everywhere, at the cost of needing the result picked
   up on the next page load (consumeGoogleRedirect below).

   WHY LINK BEFORE SIGN-IN. The device already has an anonymous uid that appears
   in knownDeviceUids and on logs. linkWithCredential UPGRADES that same uid to a
   Google identity, so nothing already written is orphaned. Only when that
   Google account is already attached to another Forge identity do we fall back
   to a plain sign-in, because linking would be a lie about who this is.
   ═══════════════════════════════════════════════════════════════════════════ */

window.googleProvider = function(){
  const p = new firebase.auth.GoogleAuthProvider();
  p.setCustomParameters({ prompt: 'select_account' });   // never silently reuse a stale account
  return p;
};

// Start the flow. Returns a promise that rejects if the provider is not enabled
// yet, so the caller can show a real message instead of a dead button.
// intent: 'link'  — securing the identity you are already using on this device
//         'login' — arriving on a NEW device to reclaim an identity you own
//
// The intent has to be passed in, because the two need OPPOSITE calls and the
// old code could only ever make one of them. ensureAuth() establishes an
// anonymous session before any screen paints, so `currentUser.isAnonymous` is
// ALWAYS true by the time either button is tappable — meaning login took the
// link branch too. On a second device that Google credential is already bound
// to the first device's uid, so linking fails with credential-already-in-use
// and the user is told their own account belongs to someone else. "Continue
// with Google" could never once have succeeded.
window.startGoogleSignIn = function(intent){
  if(!window.FEATURE_GOOGLE_AUTH) return Promise.reject(new Error('FEATURE_OFF'));
  try{ sessionStorage.setItem('forge_google_pending','1'); }catch(e){}
  const cur = auth.currentUser;
  // LOGIN: sign in AS the Google account outright. Discarding this device's
  // throwaway anonymous uid is the whole point — the identity being reclaimed
  // lives on the server, keyed by authUid.
  if(intent === 'login') return auth.signInWithRedirect(window.googleProvider());
  // LINK: upgrade this device's existing anonymous uid in place, so anything
  // already written under it (knownDeviceUids, logs) stays attached.
  if(cur && cur.isAnonymous) return cur.linkWithRedirect(window.googleProvider());
  return auth.signInWithRedirect(window.googleProvider());
};

// Call once on boot. Resolves to {linked:false} on a normal load — this must be
// cheap and silent when no redirect happened, because it runs on every launch.
window.consumeGoogleRedirect = async function(){
  if(!window.FEATURE_GOOGLE_AUTH) return {linked:false};
  let pending=false;
  try{ pending = sessionStorage.getItem('forge_google_pending')==='1'; }catch(e){}
  try{
    const res = await auth.getRedirectResult();
    if(!res || !res.user) return {linked:false};
    try{ sessionStorage.removeItem('forge_google_pending'); }catch(e){}
    return { linked:true, uid:res.user.uid, email:res.user.email||null,
             displayName:res.user.displayName||null, isNewUser: !!(res.additionalUserInfo||{}).isNewUser };
  }catch(err){
    try{ sessionStorage.removeItem('forge_google_pending'); }catch(e){}
    // The Google account is already attached to a different Forge identity.
    // Linking is refused on purpose (one Google account = one identity, Q2),
    // so sign in as that identity instead of pretending the link worked.
    if(err && err.code === 'auth/credential-already-in-use'){
      // Hand the credential BACK. This is not really a failure: it means the
      // Google account already owns a Forge identity, which is precisely the
      // 1:1 rule working. The old code threw err.credential away and left the
      // caller with nothing but an error string, so the only possible outcome
      // was telling the user their own account belonged to someone else.
      // With the credential, signInAsGoogle() below completes the journey.
      return { linked:false, error:'ALREADY_IN_USE', pending, credential: (err.credential || null) };
    }
    if(err && err.code === 'auth/operation-not-allowed'){
      return { linked:false, error:'PROVIDER_DISABLED', pending };
    }
    console.error('Google redirect failed:', err);
    return { linked:false, error: (err&&err.code)||'UNKNOWN', pending };
  }
};

// Complete a sign-in from a credential handed back by a refused link. Resolves
// to the signed-in uid so the caller can look the identity up by authUid.
window.signInAsGoogle = async function(credential){
  if(!credential) throw new Error('NO_CREDENTIAL');
  const res = await auth.signInWithCredential(credential);
  return { uid: res.user.uid, email: res.user.email || null };
};

/* ═══════════════════════════════════════════════════════════════════════════
   CALLABLE CLOUD FUNCTIONS — AUTH PHASE 2 (claimIdentity, awardSeasonBadges,
   adminResetPin). Region asia-south1, matching Firestore + the deployed
   functions. Rejects with FUNCTIONS_SDK_MISSING if the compat SDK didn't load,
   so callers surface a real error instead of a silent no-op. Returns the
   function's `data` payload directly.
   ═══════════════════════════════════════════════════════════════════════════ */
window.callFunction = function(name, data){
  if(typeof firebase === 'undefined' || !firebase.functions){
    return Promise.reject(new Error('FUNCTIONS_SDK_MISSING'));
  }
  return firebase.app().functions('asia-south1').httpsCallable(name)(data || {}).then(r => r.data);
};

/* ═══════════════════════════════════════════════════════════════════════════
   PUSH NOTIFICATIONS — the one Android feature worth having before launch

   WHY THIS AND NOT A WIDGET OR HEALTH SYNC. Forge's loop is time-sensitive in a
   way a tracker's isn't: a streak dies at midnight, and a teammate logging at
   7pm is news nobody learns until they next open the app. Today Forge can only
   speak to people who remember to open it — precisely the people who don't need
   reminding.

   WHAT WE WILL AND WON'T SEND. "Don't forget to work out!" is how a wellness app
   gets muted in a week. The only notifications worth the permission are ones
   that carry information ANOTHER PERSON generated:
       "Tanmmay logged. Your team needs one more today."
   That is news, not nagging, and it is the one push a step-counter cannot send.

   GATED on FEATURE_PUSH, which stays false until a VAPID key exists (Firebase
   console -> Cloud Messaging -> Web Push certificates). Without the key,
   getToken() throws, so the flag is not decoration.
   ═══════════════════════════════════════════════════════════════════════════ */

// Browser capability only — deliberately does NOT require the messaging SDK to
// be loaded, because it isn't: see _loadMessaging below.
// The NATIVE push plugin (@capacitor-firebase/messaging), present only inside
// the Capacitor shells. On iOS it wraps APNs and hands back an FCM token, so
// users.pushTokens holds one token currency across every platform and the
// Cloud Functions sender needs no separate APNs path.
function _nativeMsg(){
  const C = window.Capacitor;
  return (C && C.Plugins && C.Plugins.FirebaseMessaging) || null;
}
window.pushSupported = function(){
  if(typeof isNative==='function' && isNative()) return !!_nativeMsg();
  return 'Notification' in window
      && 'serviceWorker' in navigator
      && 'PushManager' in window;
};

// The messaging SDK is ~50KB and is loaded ON DEMAND, not in the page's script
// tags. Every user would otherwise pay for it on every launch to support a
// feature most of them will never switch on — and one that is currently off for
// everybody. Injected once, cached by the browser thereafter.
let _msgSdk = null;
function _loadMessaging(){
  if(_msgSdk) return _msgSdk;
  _msgSdk = new Promise((resolve, reject) => {
    if(typeof firebase!=='undefined' && firebase.messaging){ resolve(firebase.messaging()); return; }
    const s=document.createElement('script');
    s.src='https://www.gstatic.com/firebasejs/9.23.0/firebase-messaging-compat.js';
    s.onload=()=>{
      try{
        if(firebase.messaging.isSupported && !firebase.messaging.isSupported()){
          reject(new Error('UNSUPPORTED')); return;
        }
        resolve(firebase.messaging());
      }catch(e){ reject(e); }
    };
    s.onerror=()=>reject(new Error('SDK_LOAD_FAILED'));
    document.head.appendChild(s);
  });
  return _msgSdk;
}

window.pushPermission = function(){
  // Native: the plugin's checkPermissions is async, which this sync helper
  // cannot await. 'default' makes every caller treat it as not-yet-asked and
  // route through enablePush, whose native branch asks properly.
  if(typeof isNative==='function' && isNative()) return 'default';
  try{ return Notification.permission; }catch(e){ return 'unsupported'; }
};

// Register OUR messaging worker explicitly. Firebase's default is
// /firebase-messaging-sw.js at the DOMAIN root — right on goforge.in, a 404 on
// niragsanghavi.github.io/forge-staging/. Relative registration keeps both
// environments working and keeps this worker off the app shell's scope.
let _msgSwReg = null;
async function _messagingSW(){
  if(_msgSwReg) return _msgSwReg;
  _msgSwReg = await navigator.serviceWorker.register('firebase-messaging-sw.js',
    { scope: './firebase-cloud-messaging-push-scope' });
  return _msgSwReg;
}

// Ask, then return the device token. Resolves to null on every refusal path so
// the caller only has to distinguish "have a token" from "don't".
window.enablePush = async function(){
  if(!window.FEATURE_PUSH) throw new Error('FEATURE_OFF');
  if(!window.pushSupported()) throw new Error('UNSUPPORTED');
  // NATIVE (App Store / Play builds): APNs-or-FCM via the plugin. The web
  // path below never runs inside the shell — its service worker registration
  // would fail against the capacitor:// scheme anyway.
  if(typeof isNative==='function' && isNative()){
    const M = _nativeMsg(); if(!M) throw new Error('UNSUPPORTED');
    const p = await M.requestPermissions();
    if(!p || p.receive !== 'granted') return null;
    const r = await M.getToken();                    // FCM token on both OSes
    return (r && r.token) || null;
  }
  const perm = await Notification.requestPermission();
  if(perm !== 'granted') return null;                     // includes 'denied'
  const messaging = await _loadMessaging();      // injects the SDK on first use
  const reg = await _messagingSW();
  const token = await messaging.getToken({
    vapidKey: window.FCM_VAPID_KEY,
    serviceWorkerRegistration: reg
  });
  return token || null;
};

// Foreground messages arrive here instead of the system tray. Showing an OS
// notification while someone is literally looking at the app is the fastest way
// to get switched off, so this becomes an in-app toast.
window.startForegroundPush = async function(onMessage){
  if(!window.FEATURE_PUSH || !window.pushSupported()) return;
  // Idempotent: called from boot (permission already granted) AND from
  // turnOnPush (permission granted this session). Double-registering
  // onMessage would toast every arrival twice.
  if(window._fgPushWired) return; window._fgPushWired = true;
  if(typeof isNative==='function' && isNative()){
    const M = _nativeMsg(); if(!M) return;
    try{
      // Same philosophy as the web: an arrival while the person is LOOKING at
      // the app becomes a toast, not a banner over their own screen. The OS
      // handles background arrivals natively — the notification block on the
      // FCM message displays without any code here running.
      M.addListener('notificationReceived', function(ev){
        const n=(ev && ev.notification) || {};
        const d=(n.data) || {};
        if(typeof onMessage==='function') onMessage({ title:n.title||d.title, body:n.body||d.body });
      });
    }catch(e){ console.warn('[Forge] native foreground push unavailable', e); }
    return;
  }
  try{
    const messaging = await _loadMessaging();
    messaging.onMessage(function(payload){
      const d=(payload&&payload.data)||{};
      if(typeof onMessage==='function') onMessage(d);
    });
  }catch(e){ console.warn('[Forge] foreground push unavailable', e); }
};

/* ═══════════════════════════════════════════════════════════════════════════
   SELF-HEAL — device-local-corruption recovery (July 18 incident)
   Failure mode: Firestore offline cache serves READS (app looks healthy,
   roster renders) while every WRITE silently dies — stale anon-auth session +
   stale SW cache + poisoned IndexedDB persistence. Incognito worked, proving
   it's device-local. Manual fix was "clear website data"; this detects the
   state and heals it in one tap. Nothing here touches pinSet/pinHash routing,
   transaction bodies, or scoring — it only observes writes and resets local
   caches. Identity is server-side (userId + pinHash), so a reset loses nothing.
   ═══════════════════════════════════════════════════════════════════════════ */

// Race any promise against a timeout that REJECTS with code 'timeout'.
function _withTimeout(promise, ms, label){
  let timer;
  const t = new Promise((_, rej) => { timer = setTimeout(() => {
    rej(Object.assign(new Error((label||'op')+' timed out after '+ms+'ms'), { code:'timeout' }));
  }, ms); });
  return Promise.race([promise, t]).finally(() => clearTimeout(timer));
}
function _isAuthErr(e){ return !!(e && typeof e.code === 'string' && e.code.indexOf('auth/') === 0); }
function _isTransientErr(e){ return !!(e && (e.code === 'unavailable' || e.code === 'deadline-exceeded')); }
function _isTimeoutErr(e){ return !!(e && e.code === 'timeout'); }

// ── STEP 3: fixLocalState() — the one-tap heal ──────────────────────────────
// Each step in its own try/catch so one failure never aborts the rest, then
// reload. Boot mints fresh anon auth; user lands on group-code → name → PIN.
window.fixLocalState = async function(reason){
  try { console.warn('[Forge] fixLocalState running. Reason:', reason); } catch(e){}

  // THE ONE GUARANTEE: this function always ends in a reload.
  //
  // Every step below awaits Firebase internals — and this runs at precisely
  // the moment those internals are wedged, which is the one condition where
  // db.terminate() / clearPersistence() / signOut() can hang forever. They had
  // no timeouts, so a single hang left the button stuck on "Fixing… ~30s" and
  // the reload at step 7 never ran: the recovery path was defeated by the
  // fault it exists to recover from. Observed live, 17 Aug 2026.
  //
  // A partial clean-up followed by a reload beats a perfect clean-up that
  // never arrives — the reload alone clears most wedges, and step 4b's direct
  // IndexedDB purge (which always had its own timeouts) does the heavy lifting.
  var _reloaded = false;
  var _reload = function(){
    if(_reloaded) return; _reloaded = true;
    try { location.reload(); } catch(e){ try { location.href = location.pathname; } catch(e2){} }
  };
  setTimeout(_reload, 9000);   // hard watchdog — fires no matter what stalls

  // Cap any promise so one wedged call can't stall the chain. Never rejects:
  // a timed-out step is logged and skipped, exactly like a caught error.
  var _cap = function(p, ms, label){
    return Promise.race([
      Promise.resolve(p).catch(function(e){ console.warn('[Forge] fixLocalState '+label+':', e); }),
      new Promise(function(res){ setTimeout(function(){ console.warn('[Forge] fixLocalState '+label+' timed out after '+ms+'ms — continuing'); res(); }, ms); })
    ]);
  };
  // 1. unregister service workers (kills the stale SW controlling the page)
  try {
    if (navigator.serviceWorker && navigator.serviceWorker.getRegistrations) {
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map(r => r.unregister().catch(()=>{})));
    }
  } catch(e){ console.warn('[Forge] fixLocalState step1 (SW unregister):', e); }
  // 2. delete all Cache Storage entries (stale app shell)
  try {
    if (window.caches) { const keys = await caches.keys(); await Promise.all(keys.map(k => caches.delete(k).catch(()=>{}))); }
  } catch(e){ console.warn('[Forge] fixLocalState step2 (caches):', e); }
  // 3. terminate Firestore (must precede clearPersistence)
  await _cap(db.terminate(), 2500, 'step3 (terminate)');
  // 4. clear the poisoned offline persistence. 'failed-precondition' = another
  //    tab still holds it — log and continue; the IndexedDB purge (below) and
  //    reload still recover this tab.
  await _cap(db.clearPersistence(), 2500, 'step4 (clearPersistence)');
  // 4b. belt-and-suspenders: purge Firebase's own IndexedDB stores directly too
  //     (covers auth-session corruption + any store clearPersistence missed).
  try {
    const known = ['firebaseLocalStorageDb','firebase-heartbeat-database',`firestore/[DEFAULT]/${FB_CFG.projectId}/main`];
    const names = new Set(known);
    try { if (indexedDB.databases) { (await indexedDB.databases()).forEach(d => { if(d.name && /firebase|firestore/i.test(d.name)) names.add(d.name); }); } } catch(e){}
    await Promise.all([...names].map(n => new Promise(res => {
      let done=false; const fin=()=>{ if(!done){done=true;res();} };
      try { const rq=indexedDB.deleteDatabase(n); rq.onsuccess=fin; rq.onerror=fin; rq.onblocked=fin; } catch(e){ fin(); }
      setTimeout(fin, 600);
    })));
  } catch(e){ console.warn('[Forge] fixLocalState step4b (indexedDB purge):', e); }
  // 5. kill the (possibly corrupted) anonymous auth session
  await _cap(auth.signOut(), 2500, 'step5 (signOut)');
  // 6. clear ONLY Forge's own session pointers — NOT localStorage.clear()
  //    (leaves forge_theme / forge_goal_* / unrelated origin data intact).
  //    forge_session is the legacy single-session key migrateLegacySession
  //    re-imports, so it must go too or the reset wouldn't log them out.
  try { ['forge_sessions','forge_active','forge_session'].forEach(k => { try{ localStorage.removeItem(k); }catch(e){} }); }
  catch(e){ console.warn('[Forge] fixLocalState step6 (localStorage):', e); }
  // 7. hard reload → fresh anon auth + onboarding. Server identity intact.
  //    Routed through the same guard as the watchdog so the two can never
  //    double-fire (a second reload mid-navigation is how you get a loop).
  _reload();
};

// ── STEP 4: reusable recovery UI (self-contained, inline-styled like the boot
// recovery screen; matches the app palette). Non-blocking bottom card. Shown at
// most once per session unless dismissed and a later failure re-surfaces it. ──
window._forgeRecoveryVisible = false;
window.showConnectionRecovery = function(){
  if (window._forgeRecoveryVisible) return;                 // already up — don't stack
  if (document.getElementById('forgeRecovery')) return;
  if (typeof navigator.onLine === 'boolean' && !navigator.onLine) return;   // genuine offline is supported
  window._forgeRecoveryVisible = true;
  const wrap = document.createElement('div');
  wrap.id = 'forgeRecovery';
  wrap.setAttribute('role','alertdialog');
  wrap.style.cssText = 'position:fixed;left:12px;right:12px;bottom:12px;z-index:100000;margin:0 auto;max-width:440px;'+
    'background:#121218;border:1px solid rgba(212,168,67,.30);border-radius:16px;padding:18px 18px 16px;'+
    'box-shadow:0 12px 40px rgba(0,0,0,.55);font-family:-apple-system,BlinkMacSystemFont,"SF Pro Text","Segoe UI",Roboto,sans-serif;'+
    'color:#f2f0ec;opacity:0;transform:translateY(12px);transition:opacity .28s ease-out,transform .28s ease-out';
  wrap.innerHTML =
    '<div style="font-size:15px;font-weight:800;margin-bottom:6px">Connection stuck?</div>'+
    '<div id="forgeRecoveryMsg" style="font-size:13px;line-height:1.5;color:#b9b7c2;margin-bottom:14px">'+
      'Having trouble saving. Your connection looks fine but the app&rsquo;s local data may be stuck. '+
      '<b style="color:#f2f0ec;font-weight:600">Fix it</b> takes ~30 seconds — you&rsquo;ll re-enter your group code and PIN. Nothing is lost.'+
    '</div>'+
    '<div style="display:flex;gap:10px">'+
      '<button id="forgeRecoveryFix" style="flex:1;min-height:46px;border:none;border-radius:11px;cursor:pointer;'+
        'background:linear-gradient(180deg,#e7bf58,#c69d35);color:#221804;font-size:14px;font-weight:800">Fix it</button>'+
      '<button id="forgeRecoveryLater" style="flex:0 0 auto;min-height:46px;padding:0 18px;border-radius:11px;cursor:pointer;'+
        'background:transparent;border:1px solid rgba(255,255,255,.18);color:#b9b7c2;font-size:14px;font-weight:600">Not now</button>'+
    '</div>';
  document.body.appendChild(wrap);
  requestAnimationFrame(() => { wrap.style.opacity='1'; wrap.style.transform='none'; });
  document.getElementById('forgeRecoveryLater').onclick = function(){
    wrap.remove(); window._forgeRecoveryVisible = false;   // dismissed → a later failure may re-surface it
  };
  document.getElementById('forgeRecoveryFix').onclick = function(){
    const b = document.getElementById('forgeRecoveryFix');
    if(b){ b.disabled = true; b.textContent = 'Fixing… ~30s'; b.style.opacity='.8'; }
    const later = document.getElementById('forgeRecoveryLater'); if(later) later.disabled = true;
    window.fixLocalState('user-tapped-fix');                // async → ends in location.reload()
  };
};

// Shared write-sickness policy (STEP 2). navigator.onLine guard lives here so
// EVERY caller (probe, watchdog, log path) respects genuine-offline.
window._forgeSickWriteCount = 0;
function _noteSickWrite(code){
  if (typeof navigator.onLine === 'boolean' && !navigator.onLine) return;   // offline is supported
  // auth/* and outright timeouts are unambiguous → surface immediately.
  // transient unavailable/deadline can be one-off network noise → only after 2+.
  if (_isAuthErr({code}) || code === 'timeout') { window._backendSick = true; window.showConnectionRecovery(); return; }
  if (code === 'unavailable' || code === 'deadline-exceeded') {
    window._forgeSickWriteCount++;
    if (window._forgeSickWriteCount >= 2) { window._backendSick = true; window.showConnectionRecovery(); }
  }
}

// ── STEP 2: withWriteWatchdog — race a user-blocking WRITE against a timeout;
// on timeout / sick error, surface recovery as a SIDE EFFECT and rethrow so the
// caller's existing catch (logErr, err.textContent, toast) runs unchanged. Wrap
// OUTSIDE transactions — never alters their internal logic. NOTE: a timed-out
// transaction may still commit server-side; the fix-flow reload reconciles from
// the server, so surfacing recovery here is safe (no double-write risk). ──
window.withWriteWatchdog = function(promise, label, ms){
  ms = ms || 10000;
  return _withTimeout(Promise.resolve(promise), ms, 'write:'+(label||'')).catch(function(e){
    if (_isTimeoutErr(e) || _isAuthErr(e) || _isTransientErr(e)) _noteSickWrite(e.code);
    throw e;   // preserve existing catch behavior
  });
};

// ── STEP 1: buildHealthProbe — boot-time backend reachability check. Proves the
// auth backend + Firestore SERVER are reachable past the offline cache. Runs
// after first paint (never delays render). Exactly 1 Firestore read (public
// stats/global, source:'server'). Genuine offline is NOT flagged. ──
window.buildHealthProbe = async function(){
  try {
    if (typeof navigator.onLine === 'boolean' && !navigator.onLine) return;   // offline is a supported state
    // (a) forced token refresh proves the auth backend is reachable AND the anon
    //     session is alive — a corrupted session rejects here with auth/*.
    if (auth.currentUser) {
      try { await _withTimeout(auth.currentUser.getIdToken(true), 10000, 'getIdToken'); }
      catch(e){
        if (_isAuthErr(e) || _isTimeoutErr(e)) { window._backendSick = true; window.showConnectionRecovery(); return; }
        // any other error: not a definitive corruption signal — fall through to (b)
      }
    }
    // (b) 1 server read of a public doc proves Firestore server reachability
    //     past the offline cache. Retry once on 'unavailable' before flagging.
    async function serverPing(){ return _withTimeout(db.collection('stats').doc('global').get({ source:'server' }), 10000, 'stats-ping'); }
    try { await serverPing(); }
    catch(e1){
      if (typeof navigator.onLine === 'boolean' && !navigator.onLine) return;   // went offline mid-probe
      try { await serverPing(); }        // one retry
      catch(e2){
        if (_isTimeoutErr(e2) || e2.code === 'unavailable' || _isAuthErr(e2)) { window._backendSick = true; window.showConnectionRecovery(); }
      }
    }
  } catch(e){ /* the probe must never break boot */ try{ console.warn('[Forge] health probe error', e); }catch(_){} }
};
// Self-schedule after first paint (two rAFs) so it never delays render. No
// index.html change needed; runs once per load.
try {
  window.addEventListener('load', function(){
    requestAnimationFrame(function(){ requestAnimationFrame(function(){ window.buildHealthProbe(); }); });
  });
} catch(e){}
