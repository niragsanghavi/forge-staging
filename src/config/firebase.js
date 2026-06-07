const FB_CFG = {
  apiKey: "AIzaSyCIXojxM6N6f6kp10g7zYV5XYTyLJ6pz2g",
  authDomain: "forge-25c8c.firebaseapp.com",
  projectId: "forge-25c8c",
  storageBucket: "forge-25c8c.firebasestorage.app",
  messagingSenderId: "981352149705",
  appId: "1:981352149705:web:454b18a677e625b9b39318"
};

firebase.initializeApp(FB_CFG);
const db = firebase.firestore();
const auth = firebase.auth();

window.db = db;
window.firebase = firebase;
window.auth = auth;

// Ensure an anonymous Firebase session exists before any Firestore call.
// Returns a promise that resolves to the user's UID. Idempotent — if already
// signed in, resolves immediately with the existing UID. This is the bedrock
// for PIN auth (Stage 2+) and Firestore Rules (Stage 4); at this stage it is
// invisible to the user and changes no behavior.
window.ensureAuth = function(){
  return new Promise((resolve, reject) => {
    const existing = auth.currentUser;
    if(existing){ resolve(existing.uid); return; }
    // Wait for the first auth state callback (handles page reloads cleanly)
    const unsubscribe = auth.onAuthStateChanged(user => {
      if(user){ unsubscribe(); resolve(user.uid); }
    });
    // Kick off anonymous sign-in if nobody is signed in yet
    auth.signInAnonymously().catch(err => {
      unsubscribe();
      console.error('Anonymous sign-in failed:', err);
      reject(err);
    });
  });
};