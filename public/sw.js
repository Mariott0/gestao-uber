const cacheNome = 'gestao-uber-interface-v7';
const interfaceApp = ['/styles.css', '/app.js', '/login.js', '/modo-app.js', '/calculos.js', '/manifest.webmanifest',
  '/icon-180.png', '/icon-192.png', '/icon-512.png'];

self.addEventListener('install', evento => {
  evento.waitUntil(caches.open(cacheNome).then(cache => cache.addAll(interfaceApp)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', evento => {
  evento.waitUntil(caches.keys().then(chaves => Promise.all(chaves
    .filter(chave => chave.startsWith('gestao-uber-interface-') && chave !== cacheNome)
    .map(chave => caches.delete(chave)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', evento => {
  const url = new URL(evento.request.url);
  if (evento.request.method !== 'GET' || url.origin !== self.location.origin || !interfaceApp.includes(url.pathname)) return;
  evento.respondWith(fetch(evento.request).catch(async () =>
    (await caches.match(url.pathname)) ?? Response.error()));
});
