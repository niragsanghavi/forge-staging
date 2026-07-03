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
    if (err.code !== 'failed-precondition') console.warn('[Forge] Firestore persistence not enabled:', err.code);
  });
const auth = firebase.auth();

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
