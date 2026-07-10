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
  document.getElementById('forgeBootReset').onclick = () => window.resetFirestoreState('boot-failure-manual-reset');
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
