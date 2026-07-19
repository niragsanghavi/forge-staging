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

const IS_STAGING =
  location.hostname === 'localhost' ||
  location.hostname === '127.0.0.1' ||
  location.pathname.includes('forge-staging');
window.IS_STAGING = IS_STAGING;
const FB_CFG = IS_STAGING ? STAGING_CFG : PROD_CFG;

firebase.initializeApp(FB_CFG);
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
    const unsubscribe = auth.onAuthStateChanged(user => {
      if(user){ unsubscribe(); resolve(user.uid); }
    });
    auth.signInAnonymously().catch(err => {
      unsubscribe();
      console.error('Anonymous sign-in failed:', err);
      reject(err);
    });
  });
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
  try { await db.terminate(); } catch(e){ console.warn('[Forge] fixLocalState step3 (terminate):', e); }
  // 4. clear the poisoned offline persistence. 'failed-precondition' = another
  //    tab still holds it — log and continue; the IndexedDB purge (below) and
  //    reload still recover this tab.
  try { await db.clearPersistence(); }
  catch(e){ console.warn('[Forge] fixLocalState step4 (clearPersistence, code='+(e&&e.code)+'):', e); }
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
  try { await auth.signOut(); } catch(e){ console.warn('[Forge] fixLocalState step5 (signOut):', e); }
  // 6. clear ONLY Forge's own session pointers — NOT localStorage.clear()
  //    (leaves forge_theme / forge_goal_* / unrelated origin data intact).
  //    forge_session is the legacy single-session key migrateLegacySession
  //    re-imports, so it must go too or the reset wouldn't log them out.
  try { ['forge_sessions','forge_active','forge_session'].forEach(k => { try{ localStorage.removeItem(k); }catch(e){} }); }
  catch(e){ console.warn('[Forge] fixLocalState step6 (localStorage):', e); }
  // 7. hard reload → fresh anon auth + onboarding. Server identity intact.
  try { location.reload(); } catch(e){ location.href = location.pathname; }
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
