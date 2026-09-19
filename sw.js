// Forge service worker — NETWORK-FIRST on purpose.
// You deploy often and have been bitten by stale caches before, so this always
// tries the network first and only falls back to cache when offline.
// To force every device to refresh, bump CACHE_VERSION (e.g. 'forge-v1' -> 'forge-v2').
const CACHE_VERSION = 'forge-staging-v86-f025';
const APP_SHELL = [
  './', './index.html',
  './src/style/main.css',
  './src/style/today.css',
  './src/style/today.css?v=f025-1',
  './src/style/sports-icons.css',
  './src/ui/today.js',
  './src/ui/today.js?v=f025-1',
  './src/ui/sports-icons.js',
  './assets/sports/soft-sculpt.webp',
  './assets/sports/fire.webp',
  './assets/forgeling.webp',
  './assets/forgeling.webp?v=f025-1',
  './assets/fonts/archivo-800.woff2',
  './assets/icons/forge-f.svg',
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
      .then(keys=>Promise.all(keys.filter(k=>k.startsWith('forge-') && k!==CACHE_VERSION).map(k=>caches.delete(k))))
      .then(()=>self.clients.claim())
  );
});

self.addEventListener('fetch', e=>{
  const req=e.request;
  if(req.method!=='GET') return;                        // never touch writes / auth
  if(new URL(req.url).origin!==location.origin) return; // let Firebase + CDNs go straight to network
  e.respondWith(
    fetch(req)
      .then(res=>{
        if(res.ok && res.type!=='opaque'){
          const copy=res.clone();
          e.waitUntil(caches.open(CACHE_VERSION).then(c=>c.put(req,copy)).catch(()=>{}));
        }
        return res;
      })
      .catch(async()=>{
        const cache=await caches.open(CACHE_VERSION);
        const cached=await cache.match(req);
        if(cached)return cached;
        if(req.mode==='navigate'){
          const page=await cache.match('./index.html');
          if(page)return page;
        }
        return Response.error();
      })
  );
});
