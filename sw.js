const CACHE_NAME = 'travel-itinerary-v11';
const ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './icon.svg',
  './icon-192.png',
  './icon-512.png',
  './apple-touch-icon.png'
];

// 安裝 Service Worker 並快取核心資源
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log('[Service Worker] Caching app shell');
      return cache.addAll(ASSETS);
    }).then(() => self.skipWaiting())
  );
});

// 啟用 Service Worker 並清理舊快取
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheName !== CACHE_NAME) {
            console.log('[Service Worker] Deleting old cache:', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

// 攔截請求：採用 Stale-While-Revalidate 策略
// 離線時直接讀取快取；在線時，先回傳快取以加快速度，並於背景向網路請求最新版本更新快取
self.addEventListener('fetch', (event) => {
  // 只攔截 GET 請求與 HTTP/HTTPS 協議 (排除 chrome-extension 等)
  if (event.request.method !== 'GET' || !event.request.url.startsWith('http')) {
    return;
  }

  event.respondWith(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.match(event.request).then((cachedResponse) => {
        const fetchedResponse = fetch(event.request)
          .then((networkResponse) => {
            // 如果請求成功，將最新資源複製一份存入快取
            if (networkResponse.status === 200) {
              cache.put(event.request, networkResponse.clone());
            }
            return networkResponse;
          })
          .catch((err) => {
            console.log('[Service Worker] Fetch failed, serving from cache offline:', err);
            // 網路失敗時，如果快取有就用快取，沒有就報錯
            return cachedResponse;
          });

        // 優先回傳快取（如果有），否則等待網路請求
        return cachedResponse || fetchedResponse;
      });
    })
  );
});
