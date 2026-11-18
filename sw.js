'use strict';
// sw.js（球録 v0.1.6）自分のサイトのファイルだけを覚える。更新ボタンが押されるまで、新しい版に切り替わらない
const CACHE_VERSION = '0.1.6';
const CACHE_PREFIX = 'kyr-cache-';
const CACHE_NAME = CACHE_PREFIX + 'v' + CACHE_VERSION;
const PRECACHE = [
  './', 'index.html', 'manifest.webmanifest', 'css/style.css',
  'js/constants.js', 'js/core.js', 'js/db.js', 'js/awake.js', 'js/anim.js', 'js/ui-record.js', 'js/ui-review.js', 'js/ui-settings.js', 'js/app.js',
  'icons/icon-180.png', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/favicon-16.png', 'icons/favicon-32.png', 'icons/favicon-48.png'
];
self.addEventListener('install', function (event) {
  // skipWaiting() は、ここでは呼ばない（更新ボタンが押されたときだけ。下の message）
  event.waitUntil(caches.open(CACHE_NAME).then(function (cache) {
    return cache.addAll(PRECACHE.map(function (u) { return new Request(u, { cache: 'reload' }); }));
  }));
});
self.addEventListener('activate', function (event) {
  event.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (k) { return k.indexOf(CACHE_PREFIX) === 0 && k !== CACHE_NAME; }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});
self.addEventListener('message', function (event) {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});
self.addEventListener('fetch', function (event) {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;           // 外へは手を出さない
  event.respondWith(caches.open(CACHE_NAME).then(function (cache) {
    return cache.match(req, { ignoreSearch: true }).then(function (hit) { return hit || fetch(req); });
  }));
});
