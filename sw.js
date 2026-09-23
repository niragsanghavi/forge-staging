// Forge service worker — NETWORK-FIRST on purpose.
// You deploy often and have been bitten by stale caches before, so this always
// tries the network first and only falls back to cache when offline.
// To force every device to refresh, bump CACHE_VERSION (e.g. 'forge-v1' -> 'forge-v2').
const CACHE_VERSION = 'forge-staging-v101-recap-channel';
const CACHE_PREFIX = 'forge-shell:' + self.registration.scope + ':';
const CACHE_NAME = CACHE_PREFIX + CACHE_VERSION;
const READY_KEY = new URL('__forge_shell_ready__',self.registration.scope).href;
const APP_SHELL = [
  './',
  './index.html',
  './branding.html',
  './src/style/branding.css',
  './src/style/solo.css?v=unified-20260923',
  './src/ui/dialogs.js',
  './src/ui/release-features.js',
  './src/ui/account-extras.js',
  './src/ui/welcome.js?v=unified-20260923',
  './src/ui/solo.js?v=unified-20260923',
  './src/ui/account-feedback.js',
  './src/ui/account-recovery.js',
  './src/ui/group-cleanup.js',
  './assets/modes/group.webp',
  './assets/modes/solo.webp',
  './assets/auth/google-signin.svg',
  './assets/auth/apple-signin.png',
  './src/style/main.css',
  './src/style/today.css?v=f026-1',
  './src/style/sports-icons.css',
  './src/ui/today.js?v=unified-20260923',
  './src/ui/sports-icons.js',
  './assets/sports/soft-sculpt.webp',
  './assets/sports/fire.webp',
  './assets/forgeling.webp?v=f026-1',
  './assets/fonts/archivo-800.woff2',
  './assets/icons/forge-f.svg',
  './src/config/firebase.js',
  './src/config/build-target.js',
  './src/services/nativeAuth.js',
  './src/state/appState.js',
  './src/services/scoringEngine.js',
];

self.addEventListener('install', e=>{
  e.waitUntil((async()=>{
    const cache=await caches.open(CACHE_NAME);
    // Failed downloads must reject installation, leaving the previous worker
    // and complete cache in charge. Never swallow a precache failure.
    // cache:'reload' skips the browser's HTTP cache: GitHub Pages marks every
    // file fresh for 10 minutes, so a plain download could fill the NEW
    // version's cache with the OLD version's files.
    await cache.addAll(APP_SHELL.map(path=>new Request(path,{cache:'reload'})));
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
  // "Network first" was not reaching the network: GitHub Pages sends
  // max-age=600, so for 10 minutes after any open the browser answered from
  // its HTTP cache. A deploy was invisible to anyone who had opened Forge in
  // the last 10 minutes — found 23 Sep 2026, when a phone reopened 24 seconds
  // after a fix went live and kept running the old notification code.
  // no-cache revalidates every time (a 304 when nothing changed). The plain
  // retry only runs if a browser refuses the option on this request.
  e.respondWith(
    fetch(req,{cache:'no-cache'}).catch(()=>fetch(req))
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
