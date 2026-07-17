// SeeYou Service Worker — 缓存应用外壳，接口与照片实时请求不缓存
var CACHE = 'seyou-v1';
var SHELL = ['/', '/seeyou.html', '/manifest.webmanifest', '/icon-192.png', '/icon-512.png', '/apple-touch-icon.png'];

self.addEventListener('install', function(e) {
  e.waitUntil(
    caches.open(CACHE).then(function(c) { return c.addAll(SHELL); }).then(function() { self.skipWaiting(); })
  );
});

self.addEventListener('activate', function(e) {
  e.waitUntil(
    caches.keys().then(function(ks) {
      return Promise.all(ks.filter(function(k) { return k !== CACHE; }).map(function(k) { return caches.delete(k); }));
    }).then(function() { self.clients.claim(); })
  );
});

self.addEventListener('fetch', function(e) {
  var url = new URL(e.request.url);
  if (e.request.method !== 'GET') return;
  // 不缓存 API 接口（保证实时同步）
  if (url.pathname.indexOf('/api/') === 0) return;
  // 上传的图片：缓存优先
  if (url.pathname.indexOf('/uploads/') === 0) {
    e.respondWith(
      caches.open(CACHE).then(async function(c) {
        var cached = await c.match(e.request);
        if (cached) return cached;
        var r = await fetch(e.request);
        if (r.ok) c.put(e.request, r.clone());
        return r;
      })
    );
    return;
  }
  // 应用外壳：缓存优先，离线可打开
  e.respondWith(
    caches.open(CACHE).then(async function(c) {
      var cached = await c.match(e.request);
      if (cached) return cached;
      var r = await fetch(e.request);
      if (r.ok && (url.pathname === '/' || url.pathname === '/seyou.html')) c.put(e.request, r.clone());
      return r;
    })
  );
});
