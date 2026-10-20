/* RL_FRESH_START — 2026-10-19 全家族「離線要有，但不能擋更新」（母版：04_管理工具\PWA新鮮度\rl_fresh_sw.js，用 apply.py 重新套用，不要在這裡手改）
   問題：原本 fetch 對網頁本身也是 cache-first → 重整先畫舊畫面、發新版要開兩次才看得到。
   做法：這段排在 sw.js 最前面、最先註冊 fetch：網頁／程式／樣式／資料（.html .js .mjs .css .json 與導覽）一律先拿線上最新的，
   4 秒沒回應或離線才用快取；成功時存一份到 rl-fresh 快取，離線也有最新版可用。
   圖片、字型、地圖圖磚等其他檔案不攔，交給原本的 handler（照舊 cache-first）。
   攔下的請求呼叫 stopImmediatePropagation()，原本的 fetch handler 不會再處理同一個請求。 */
(function(){
  var FRESH = 'rl-fresh';
  var CODE = /\.(?:html?|m?js|css|json|webmanifest)$/i;
  function fromCache(req){
    return caches.match(req).then(function(r){
      if (r) return r;
      return caches.match(req, { ignoreSearch: true }).then(function(r2){
        if (r2 || req.mode !== 'navigate') return r2;
        return caches.match('./').then(function(r3){ return r3 || caches.match('./index.html') || caches.match('index.html'); });
      });
    });
  }
  function fresh(e, req){
    var net = fetch(req).then(function(res){
      if (res && res.ok && res.type === 'basic'){
        var copy = res.clone();
        e.waitUntil(caches.open(FRESH).then(function(c){ return c.put(req, copy); }).catch(function(){}));
      }
      return res;
    });
    var timer = new Promise(function(resolve){ setTimeout(function(){ resolve(null); }, 4000); });
    return Promise.race([net.catch(function(){ return null; }), timer]).then(function(res){
      if (res && (res.ok || res.status === 304 || res.type === 'opaqueredirect')) return res;
      return fromCache(req).then(function(c){
        if (c) return c;
        return net.catch(function(){ return Response.error(); });   /* 快取也沒有：再等網路（可能只是慢） */
      });
    });
  }
  self.addEventListener('fetch', function(e){
    var req = e.request;
    if (req.method !== 'GET') return;
    var url; try { url = new URL(req.url); } catch (x) { return; }
    if (url.origin !== self.location.origin) return;
    if (url.pathname.indexOf('/api/') === 0) return;          /* 有自己 API 的 App（Worker）交給原本邏輯 */
    var isDoc = req.mode === 'navigate' || url.pathname.slice(-1) === '/' || CODE.test(url.pathname);
    if (!isDoc) return;
    if (url.pathname.slice(-6) === '/sw.js' || url.pathname === '/sw.js') return;
    e.stopImmediatePropagation();
    e.respondWith(fresh(e, req));
  });
})();
/* RL_FRESH_END */
const CACHE_NAME = 'travel-itinerary-v38';
const ASSETS = [
  './',
  './index.html',
  './milano-itinerary.html',
  './italy-trip-map.html',
  './manifest.json',
  './icon.svg',
  './icon-192.png',
  './icon-512.png',
  './apple-touch-icon.png',
  './rl-mark-fitzroy-white.png',
  './rl-mark-fitzroy-navy.png',
  // 2026-10-19 護照手帳：圓體子集＋ Fluent 3D
  './vendor/round-ui/pp-round.woff2',
  './vendor/fluent-3d/luggage.png',
  './vendor/fluent-3d/calendar.png',
  './vendor/fluent-3d/tramway.png',
  './vendor/fluent-3d/passport.png',
  './vendor/fluent-3d/cart.png',
  './vendor/fluent-3d/alarm.png',
  './vendor/fluent-3d/toolbox.png',
  './vendor/fluent-3d/boot.png',
  './vendor/fluent-3d/car.png',
  './vendor/fluent-3d/rain.png',
  './vendor/fluent-3d/sos.png',
  './vendor/fluent-3d/dining.png',
  './vendor/fluent-3d/mountain.png',
  './vendor/fluent-3d/book.png'
];

// 安裝 Service Worker 並快取核心資源
// 注意：不自動 skipWaiting，改由使用者點「立即更新」按鈕觸發（見下方 message 監聽），
// 避免 iOS 上「先顯示舊版、背景才換新版」需要關兩次的問題。
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log('[Service Worker] Caching app shell');
      return cache.addAll(ASSETS);
    })
  );
});

// 收到頁面「立即更新」指令時，讓等待中的新版 SW 立刻接管
self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
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

// 頁面導航：Network-First（3 秒逾時退回快取）
// → 有網路時永遠拿到最新內容（iOS 不再卡舊版）；離線/逾時則用快取，山區照常可用
// 其他資源：Stale-While-Revalidate（先回快取秒開，背景向網路更新）
self.addEventListener('fetch', (event) => {
  // 只攔截 GET 請求與 HTTP/HTTPS 協議 (排除 chrome-extension 等)
  if (event.request.method !== 'GET' || !event.request.url.startsWith('http')) {
    return;
  }

  if (event.request.mode === 'navigate') {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE_NAME);
      try {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 3000);
        const res = await fetch(event.request, { signal: ctrl.signal });
        clearTimeout(timer);
        if (res.status === 200) cache.put(event.request, res.clone());
        return res;
      } catch (e) {
        const cached = await cache.match(event.request);
        return cached || cache.match('./index.html');
      }
    })());
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
