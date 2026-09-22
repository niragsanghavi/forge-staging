// Forge service worker — NETWORK-FIRST on purpose.
// You deploy often and have been bitten by stale caches before, so this always
// tries the network first and only falls back to cache when offline.
// To force every device to refresh, bump CACHE_VERSION (e.g. 'forge-v1' -> 'forge-v2').
const CACHE_VERSION = 'forge-staging-v89-solo-full';
const CACHE_PREFIX = 'forge-shell:' + self.registration.scope + ':';
const CACHE_NAME = CACHE_PREFIX + CACHE_VERSION;
const READY_KEY = new URL('__forge_shell_ready__',self.registration.scope).href;
const APP_SHELL = [
  './', './index.html',
  './src/style/main.css',
  './src/style/today.css',
  './src/style/today.css?v=f026-1',
  './src/style/sports-icons.css',
  './src/ui/today.js',
  './src/ui/today.js?v=solo-full-20260922',
  './src/ui/welcome.js?v=solo-full-20260922',
  './src/ui/solo.js?v=solo-full-20260922',
  './src/style/solo.css?v=solo-full-20260922',
  './assets/modes/group.webp',
  './assets/modes/solo.webp',
  './assets/auth/google-signin.svg',
  './assets/auth/apple-signin.png',
  './src/ui/sports-icons.js',
  './assets/sports/soft-sculpt.webp',
  './assets/sports/fire.webp',
  './assets/forgeling.webp',
  './assets/forgeling.webp?v=f026-1',
  './assets/fonts/archivo-800.woff2',
  './assets/icons/forge-f.svg',
  './src/config/firebase.js',
  './src/state/appState.js',
  './src/services/scoringEngine.js'
];

self.addEventListener('install', e=>{
  e.waitUntil((async()=>{
    const cache=await caches.open(CACHE_NAME);
    // Failed downloads must reject installation, leaving the previous worker
    // and complete cache in charge. Never swallow a precache failure.
    await cache.addAll(APP_SHELL);
    await cache.put(READY_KEY,new Response(CACHE_VERSION));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', e=>{
  e.waitUntil(
    (async()=>{
      const cache=await caches.open(CACHE_NAME);
      if(!(await cache.match(READY_KEY)))throw new Error('SHELL_NOT_READY');
      const keys=await caches.keys();
      await Promise.all(keys.filter(k=>k.startsWith(CACHE_PREFIX)&&k!==CACHE_NAME).map(k=>caches.delete(k)));
      // Legacy unscoped caches are retained on this first migration. They
      // cannot safely be attributed to this app on a shared Pages origin.
      await self.clients.claim();
    })()
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
          e.waitUntil(caches.open(CACHE_NAME).then(c=>c.put(req,copy)).catch(()=>{}));
        }
        return res;
      })
      .catch(async()=>{
        const cache=await caches.open(CACHE_NAME);
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
