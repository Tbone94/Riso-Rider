// sw.js — offline support for the installed app.
// Network first, cache as fallback: you always get the newest build when online (so a deploy reaches players
// with no cache clearing), and the last-seen build still plays with no connection.
const CACHE = 'riso-rider-v6';
const SHELL = [
  './', 'index.html', 'manifest.webmanifest', 'riso.js',
  'src/app.js', 'src/physics.js', 'src/levels.js', 'src/side.js', 'src/ride.js', 'src/audio.js',
  'src/levels/ch2.js', 'src/levels/ch3.js', 'src/levels/ch4.js', 'src/levels/ch5.js', 'src/levels/ch6.js',
  'fonts/big-shoulders-stencil-display-latin.woff2', 'fonts/big-shoulders-stencil-display-latin-ext.woff2',
  'fonts/cutive-mono-latin.woff2', 'fonts/cutive-mono-latin-ext.woff2',
  'icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png', 'icons/favicon-32.png',
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  e.respondWith(
    // cache:'no-cache' revalidates with the server every time (a cheap 304 when nothing changed), so the browser's
    // own HTTP cache (GitHub Pages allows 10 min) can't hand out an old build after a deploy.
    fetch(req.url, { cache: 'no-cache', credentials: 'same-origin' }).then(res => {
      if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); }
      return res;
    }).catch(() => caches.match(req, { ignoreSearch: true }).then(hit => hit || caches.match('index.html')))
  );
});
