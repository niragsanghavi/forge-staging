/* ═══════════════════════════════════════════════════════════════════════════
   FORGE — background push handler

   DELIBERATELY SEPARATE FROM sw.js. The app shell worker is what serves Forge
   offline, and importScripts() failing during install ABORTS the whole worker.
   Putting the Firebase SDK imports in sw.js would mean a gstatic hiccup takes
   the offline app down with it. Here, the worst case is that push stops working
   and nothing else notices.

   It also lives at its own scope, registered explicitly by firebase.js. That is
   not optional: Firebase's default lookup is /firebase-messaging-sw.js at the
   DOMAIN root, which is correct on goforge.in and a 404 on
   niragsanghavi.github.io/forge-staging/. Staging would silently never receive
   a push and nothing would say why.

   The config is duplicated here on purpose — a service worker cannot read the
   page's variables. Keep it in step with src/config/firebase.js.
   ═══════════════════════════════════════════════════════════════════════════ */

importScripts('https://www.gstatic.com/firebasejs/9.23.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/9.23.0/firebase-messaging-compat.js');

// Same rule as firebase.js: localhost or a path containing forge-staging is
// STAGING, everything else is production.
var IS_STAGING =
  self.location.hostname === 'localhost' ||
  self.location.hostname === '127.0.0.1' ||
  self.location.pathname.indexOf('forge-staging') !== -1;

firebase.initializeApp(IS_STAGING ? {
  apiKey: "AIzaSyD-bFi6X9Hevwmg-p65ajz35G64wco90CA",
  authDomain: "forge-staging-865ff.firebaseapp.com",
  projectId: "forge-staging-865ff",
  storageBucket: "forge-staging-865ff.firebasestorage.app",
  messagingSenderId: "672166239076",
  appId: "1:672166239076:web:a3156e7be0ade35be6b871"
} : {
  apiKey: "AIzaSyCIXojxM6N6f6kp10g7zYV5XYTyLJ6pz2g",
  authDomain: "forge-25c8c.firebaseapp.com",
  projectId: "forge-25c8c",
  storageBucket: "forge-25c8c.firebasestorage.app",
  messagingSenderId: "981352149705",
  appId: "1:981352149705:web:454b18a677e625b9b39318"
});

var messaging = firebase.messaging();

// Fires only when the app is closed or backgrounded. Foreground messages are
// handled on the page (firebase.js) so they can become a toast instead of a
// system notification you have to dismiss while looking at the app.
messaging.onBackgroundMessage(function(payload){
  var d = (payload && payload.data) || {};
  var title = d.title || 'Forge';
  self.registration.showNotification(title, {
    body: d.body || '',
    icon: d.icon || 'icon-192.png',
    badge: 'icon-192.png',
    // Same tag = a second push REPLACES the first rather than stacking. Three
    // "your team needs one more" notifications in an evening is how an app gets
    // muted forever.
    tag: d.tag || 'forge',
    renotify: false,
    data: { url: d.url || './' }
  });
});

self.addEventListener('notificationclick', function(e){
  e.notification.close();
  var target = (e.notification.data && e.notification.data.url) || './';
  // Focus an already-open Forge tab rather than opening a second one.
  e.waitUntil(
    clients.matchAll({type:'window', includeUncontrolled:true}).then(function(list){
      for(var i=0;i<list.length;i++){
        if(list[i].url.indexOf(self.registration.scope.replace(/[^/]*$/,'')) === 0 && 'focus' in list[i]){
          return list[i].focus();
        }
      }
      if(clients.openWindow) return clients.openWindow(target);
    })
  );
});
