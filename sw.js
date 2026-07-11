// Forge service worker — NETWORK-FIRST on purpose.
// You deploy often and have been bitten by stale caches before, so this always
// tries the network first and only falls back to cache when offline.
// To force every device to refresh, bump CACHE_VERSION (e.g. 'forge-v1' -> 'forge-v2').
const CACHE_VERSION = 'forge-v26';
const APP_SHELL = [
  './', './index.html',
  './src/style/main.css',
  './src/config/firebase.js',
  './src/state/appState.js',
  './src/services/scoringEngine.js'
];

self.addEventListener('install', e=>{
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE_VERSION).then(c=>c.addAll(APP_SHELL).catch(()=>{})));
});

self.addEventListener('activate', e=>{
  e.waitUntil(
    caches.keys()
      .then(keys=>Promise.all(keys.filter(k=>k!==CACHE_VERSION).map(k=>caches.delete(k))))
      .then(()=>self.clients.claim())
  );
});

self.addEventListener('fetch', e=>{
  const req=e.request;
  if(req.method!=='GET') return;                        // never touch writes / auth
  if(new URL(req.url).origin!==location.origin) return; // let Firebase + CDNs go straight to network
  e.respondWith(
    fetch(req)
      .then(res=>{ const copy=res.clone(); caches.open(CACHE_VERSION).then(c=>c.put(req,copy)).catch(()=>{}); return res; })
      .catch(()=> caches.match(req).then(r=> r || caches.match('./index.html')))
  );
});
