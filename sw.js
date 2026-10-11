'use strict';

// Sprema ljusku aplikacije; podaci o proizvodima uvijek se dohvaćaju s mreže.
// Tesseract jezgra i jezični podaci (~17 MB) ne spremaju se unaprijed — Tesseract ih sam sprema u IndexedDB pri prvoj uporabi.
const CACHE = 'scaner-shell-v5';
const SHELL = [
  './', 'index.html', 'styles.css', 'config.js', 'countries.js', 'fields.js', 'api.js', 'app.js', 'db.js', 'ocr.js',
  'icon.svg', 'manifest.webmanifest', 'privacy.html', 'vendor/zxing-0.21.3.min.js', 'vendor/supabase-2.117.2.min.js',
  'vendor/tesseract/tesseract.min.js',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== self.location.origin) return;
  // Mreža prvo, cache kao rezerva — tako nova verzija stigne odmah kad ima interneta.
  event.respondWith(
    fetch(event.request)
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(event.request, copy));
        return res;
      })
      .catch(() => caches.match(event.request))
  );
});
