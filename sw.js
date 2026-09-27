// Service worker: lets the synth open and play without a connection once it has been used.
// The page (index.html) is fetched fresh whenever the network answers, so a new version shows up on the next visit;
// the stand-in sample packs never change, so each one is kept after its first use.
const CACHE = 'trinity-v1';
const CORE = ['./', 'index.html', 'manifest.webmanifest', 'icons/icon-192.png', 'icons/icon-512.png', 'samples/packs.json'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(CORE)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const req = e.request, url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin) return;
  const isSample = /\/samples\/[^/]+\.mp3$/.test(url.pathname);
  e.respondWith(isSample ? cacheFirst(req) : networkFirst(req));
});
async function cacheFirst(req) {
  const hit = await caches.match(req); if (hit) return hit;
  const res = await fetch(req);
  if (res.ok) (await caches.open(CACHE)).put(req, res.clone());
  return res;
}
async function networkFirst(req) {
  try {
    const res = await fetch(req);
    if (res.ok) (await caches.open(CACHE)).put(req, res.clone());
    return res;
  } catch (err) {
    const hit = await caches.match(req, { ignoreSearch: true }); if (hit) return hit;
    throw err;
  }
}
