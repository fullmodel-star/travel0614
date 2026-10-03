/**
 * 301 瑞士義大利行程 · 瀏覽器層功能走查（安全網）
 *
 *   node _tools/ui_tests.mjs                 → 對專案根目錄跑
 *   node _tools/ui_tests.mjs --dir=<資料夾>   → 對別的副本／部署包跑（相對 _tools 上一層，或絕對路徑）
 *
 * 2026-10-03 建立：這支 App 已上線但沒有任何自動測試。之後改版前先把「功能照樣能用」釘成測試。
 * 寫法照 605 _tools/ui_tests.mjs（那支記錄的坑都適用）：
 * - 不用 --virtual-time-budget，一律真實時間輪詢（until）。
 * - 自己起 http server，送 Cache-Control: no-store；直接試綁埠，不先探測（Windows SO_REUSEADDR 會綁到別人的埠）。
 * - addScriptToEvaluateOnNewDocument 每次先移除上一支再加，整段包 IIFE；alert／confirm 一律攔截。
 * - 每條斷言印出樣本數或實際值；空集合一律判失敗。
 *
 * 這支另外的做法：
 * - 對外連線在「瀏覽器層」用 Fetch 網域攔截（不是頁面層）：Service Worker 自己發的 fetch 也攔得到。
 *   允許清單裡的主機一律回固定內容（匯率 API、Google 字型、Leaflet CDN、OSM 圖磚），不連網；
 *   清單外的主機直接擋掉並記下來，最後一條斷言檢查。
 * - Leaflet 1.9.4 用同層 400_走稜步道_trails/vendor/leaflet 的本機副本回應（可用環境變數 LEAFLET_DIR 改）。
 * - 日期相關（倒數、旅程第幾天、自動展開今天）用假時鐘固定在指定時刻，不隨今天日期變動。
 * - 瀏覽器端程式一律寫成 Node 端的函式再 toString 送進去（c.call），避免樣板字串吃掉反斜線。
 */
import { createServer } from 'node:http';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const dirArg = process.argv.find((a) => a.startsWith('--dir='));
const ROOT = path.resolve(HERE, '..', dirArg ? dirArg.slice(6) : '.');
const CHROME = process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const LEAFLET_DIR = process.env.LEAFLET_DIR || path.resolve(HERE, '..', '..', '400_走稜步道_trails', 'vendor', 'leaflet');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.json': 'application/json',
  '.png': 'image/png', '.svg': 'image/svg+xml', '.css': 'text/css', '.txt': 'text/plain', '.woff2': 'font/woff2' };

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ok   ' + name); }
  else { fail++; console.log('  FAIL ' + name + (extra !== undefined ? '  → ' + JSON.stringify(extra).slice(0, 400) : '')); }
}

/* ── 對外連線的固定回應（不依賴網路） ── */
const PNG_1x1 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';
const FAKE_RATES = { base: 'TWD', rates: { TWD: 1, CHF: 0.025, EUR: 0.02 } }; // CHF 1 = TWD 40.0、EUR 1 = TWD 50.0
const leafletJs = await readFile(path.join(LEAFLET_DIR, 'leaflet.js')).catch(() => null);
const leafletCss = await readFile(path.join(LEAFLET_DIR, 'leaflet.css')).catch(() => null);
const STUBS = [
  { host: /^api\.exchangerate-api\.com$/, type: 'application/json', body: () => Buffer.from(JSON.stringify(FAKE_RATES)) },
  { host: /^fonts\.googleapis\.com$/, type: 'text/css', body: () => Buffer.from('/* stub */') },
  { host: /^fonts\.gstatic\.com$/, type: 'font/woff2', body: () => Buffer.alloc(0) },
  { host: /^cdnjs\.cloudflare\.com$/, path: /leaflet\.min\.js$/, type: 'text/javascript', body: () => leafletJs },
  { host: /^cdnjs\.cloudflare\.com$/, path: /leaflet\.min\.css$/, type: 'text/css', body: () => leafletCss },
  { host: /^[abc]\.tile\.openstreetmap\.org$/, type: 'image/png', body: () => Buffer.from(PNG_1x1, 'base64') },
];
const stubHits = {};      // host → 次數（證明攔截有作用）
const blocked = [];       // 清單外、被擋掉的網址

/* ── 靜態伺服器：直接試綁，失敗換下一個 ── */
async function startServer() {
  const server = createServer(async (req, res) => {
    const u = new URL(req.url, 'http://x');
    const rel = decodeURIComponent(u.pathname === '/' ? '/index.html' : u.pathname);
    const p = path.join(ROOT, rel);
    if (!p.startsWith(ROOT)) { res.writeHead(403); res.end(); return; }
    try {
      const b = await readFile(p);
      res.writeHead(200, { 'content-type': TYPES[path.extname(p)] || 'application/octet-stream', 'cache-control': 'no-store' });
      res.end(b);
    } catch { res.writeHead(404); res.end(); }
  });
  for (let port = 8810; port < 8860; port++) {
    const okBind = await new Promise((resolve) => {
      server.once('error', () => resolve(false));
      server.listen(port, '127.0.0.1', () => resolve(true));
    });
    if (okBind) return { server, port };
  }
  throw new Error('找不到可用的埠');
}

/* ── 瀏覽器層連線：攔截所有網路請求（含 Service Worker 發出的） ── */
async function interceptAll(debugPort) {
  let info = null;
  for (let i = 0; i < 40 && !info; i++) {
    try { info = await (await fetch(`http://127.0.0.1:${debugPort}/json/version`)).json(); } catch { await sleep(250); }
  }
  if (!info) throw new Error('接不上 Chrome（/json/version）');
  const ws = new WebSocket(info.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let id = 0;
  const send = (method, params = {}) => ws.send(JSON.stringify({ id: ++id, method, params }));
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.method !== 'Fetch.requestPaused') return;
    const { requestId, request } = m.params;
    let u;
    try { u = new URL(request.url); } catch { send('Fetch.continueRequest', { requestId }); return; }
    if (u.hostname === '127.0.0.1' || !/^https?:$/.test(u.protocol)) { send('Fetch.continueRequest', { requestId }); return; }
    const s = STUBS.find((x) => x.host.test(u.hostname) && (!x.path || x.path.test(u.pathname)));
    const body = s && s.body();
    if (s && body) {
      stubHits[u.hostname] = (stubHits[u.hostname] || 0) + 1;
      send('Fetch.fulfillRequest', { requestId, responseCode: 200, body: body.toString('base64'),
        responseHeaders: [{ name: 'content-type', value: s.type }, { name: 'access-control-allow-origin', value: '*' }] });
    } else {
      blocked.push(request.url);
      send('Fetch.failRequest', { requestId, errorReason: 'BlockedByClient' });
    }
  };
  send('Fetch.enable', { patterns: [{ urlPattern: '*' }] });
  await sleep(200);
  return ws;
}

/* ── 最小 CDP 用戶端（頁面） ── */
class CDP {
  constructor(ws) { this.ws = ws; this.id = 0; this.waiters = new Map(); this.errors = []; this.initScript = null; this.navs = 0; }
  static async connect(debugPort) {
    let target = null;
    for (let i = 0; i < 40 && !target; i++) {
      try {
        const list = await (await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json();
        target = list.find((t) => t.type === 'page');
      } catch { /* Chrome 還沒起來 */ }
      if (!target) await sleep(250);
    }
    if (!target) throw new Error('接不上 Chrome 的 CDP');
    const ws = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
    const c = new CDP(ws);
    ws.onmessage = (ev) => {
      const m = JSON.parse(ev.data);
      if (m.id && c.waiters.has(m.id)) { c.waiters.get(m.id)(m); c.waiters.delete(m.id); }
      if (m.method === 'Runtime.exceptionThrown') {
        c.errors.push(m.params.exceptionDetails?.exception?.description || m.params.exceptionDetails?.text || 'unknown');
      }
      // 主框架每完成一次導覽（含 location.reload）就 +1；用來抓「頁面自己重整」
      if (m.method === 'Page.frameNavigated' && !m.params.frame.parentId && /^http/.test(m.params.frame.url)) c.navs++;
    };
    await c.send('Runtime.enable');
    await c.send('Page.enable');
    return c;
  }
  send(method, params = {}) {
    const id = ++this.id;
    return new Promise((res) => { this.waiters.set(id, res); this.ws.send(JSON.stringify({ id, method, params })); });
  }
  async eval(expr) {
    const r = await this.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
    if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails).slice(0, 400));
    return r.result?.result?.value;
  }
  /** 把 Node 端寫好的函式送進頁面執行（參數走 JSON） */
  call(fn, ...args) { return this.eval(`(${fn.toString()})(...${JSON.stringify(args)})`); }
  async until(expr, ms = 8000, step = 150) {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
      try { if (await this.eval(expr)) return true; } catch { /* 還沒 ready */ }
      await sleep(step);
    }
    return false;
  }
  async width(w, h = 844) {
    await this.send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: w < 600 });
    await sleep(200);
  }
  /**
   * 開頁面。clear=true 先清 localStorage（預設）；clear=false 用來驗「重新整理後還在」。
   * now：假時鐘（本地時間字串，例如 '2026-06-20T10:00:00'），之後照真實時間往前走。
   * confirm：confirm() 的回答。
   */
  async open(url, { clear = true, now = null, confirm = true, ready = null } = {}) {
    if (this.initScript) await this.send('Page.removeScriptToEvaluateOnNewDocument', { identifier: this.initScript });
    const r = await this.send('Page.addScriptToEvaluateOnNewDocument', { source: `(() => {
      ${clear ? 'try { localStorage.clear(); } catch(e) {}' : ''}
      window.__alerts = []; window.__confirms = [];
      window.alert = (m) => { window.__alerts.push(String(m)); };
      window.confirm = (m) => { window.__confirms.push(String(m)); return ${confirm ? 'true' : 'false'}; };
      ${now ? `(() => {
        const RealDate = Date;
        const off = new RealDate(${JSON.stringify(now)}).getTime() - RealDate.now();
        class FakeDate extends RealDate {
          constructor(...a) { if (a.length === 0) super(RealDate.now() + off); else super(...a); }
          static now() { return RealDate.now() + off; }
        }
        window.Date = FakeDate;
      })();` : ''}
    })();` });
    this.initScript = r.result && r.result.identifier;
    await this.send('Page.navigate', { url });
    return this.until(ready || `document.readyState === 'complete' && document.querySelectorAll('#tab-itinerary .day-card').length > 0 && typeof showTab === 'function'`, 15000);
  }
}

/* ── 瀏覽器端用的函式（toString 後送進頁面） ── */
function clickTab(id) {
  const b = [...document.querySelectorAll('.nav-btn')].find((x) => (x.getAttribute('onclick') || '').includes(`'${id}'`));
  if (!b) return false;
  b.click();
  return true;
}
function navTargets() {
  return [...document.querySelectorAll('.nav-btn')].map((b) => {
    const m = (b.getAttribute('onclick') || '').match(/showTab\('([^']+)'\)/);
    return { id: m ? m[1] : null, label: b.textContent.trim() };
  });
}
function hav(a, b) {
  const R = 6371, rad = (d) => d * Math.PI / 180;
  const dLat = rad(b[0] - a[0]), dLng = rad(b[1] - a[1]);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a[0])) * Math.cos(rad(b[0])) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

const { server, port } = await startServer();
const BASE = `http://127.0.0.1:${port}/`;
const profile = await mkdtemp(path.join(tmpdir(), 'trip301-ui-'));
const DEBUG_PORT = 9300 + Math.floor(Math.random() * 400);
const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', `--remote-debugging-port=${DEBUG_PORT}`,
  `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check', 'about:blank'], { stdio: 'ignore' });
let c, bws;
async function cleanup() {
  try { bws && bws.close(); } catch {}
  try { chrome.kill(); } catch {}
  server.close();
  await sleep(300);
  try { await rm(profile, { recursive: true, force: true }); } catch {}
}

console.log('測試對象：' + ROOT);
try {
  if (!leafletJs || !leafletCss) throw new Error('找不到本機 Leaflet（' + LEAFLET_DIR + '），地圖測試需要它；可用 LEAFLET_DIR 指定');
  bws = await interceptAll(DEBUG_PORT);
  c = await CDP.connect(DEBUG_PORT);
  await c.width(390);
  // 固定淺色偏好，避免本機系統深色設定影響主題測試
  await c.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'light' }] });

  /* ───────── 1 首訪 ───────── */
  console.log('\n[1 首訪載入與 Service Worker]');
  c.navs = 0;
  const loaded = await c.open(BASE);
  ok('1.1 首頁載入完成（每日行程卡出現）', loaded, await c.eval(`document.querySelectorAll('#tab-itinerary .day-card').length`));
  // 第一次造訪：sw.js activate 會 clients.claim() → controllerchange。v26 前頁面會因此自己重整一次。
  // 用主框架導覽次數判斷（在頁面上做記號會被重整搶先，舊版照樣通過——605 反向測試抓到過）。
  const controlled = await c.until(`!!(navigator.serviceWorker && navigator.serviceWorker.controller)`, 10000);
  await sleep(2000);
  ok('1.2 🔴 第一次造訪 Service Worker 接管後頁面不會自己重整（導覽次數＝1，實測 ' + c.navs + '）',
    controlled && c.navs === 1, { controlled, navs: c.navs });
  const swCache = await c.eval(`caches.keys().then(async ks => { const k = ks.find(x => /^travel-itinerary-v\\d+$/.test(x)); if (!k) return null; const cc = await caches.open(k); return { k, n: (await cc.keys()).length }; })`);
  ok('1.3 SW 已建立 travel-itinerary-vNN 快取且收進核心檔案（' + JSON.stringify(swCache) + '）', !!swCache && swCache.n >= 8, swCache);

  /* ───────── 2 逐日行程 ───────── */
  console.log('\n[2 每日行程：14 天逐日驗]');
  const days = await c.call(() => [...document.querySelectorAll('#tab-itinerary .day-card')].map((card) => ({
    date: (card.querySelector('.day-date') || {}).textContent || '',
    num: ((card.querySelector('.day-num') || {}).textContent || '').trim(),
    region: ((card.querySelector('.day-region') || {}).textContent || '').trim(),
    hotel: ((card.querySelector('.day-hotel') || {}).textContent || '').trim(),
  })));
  ok('2.0 行程卡共 14 張（12 晚 14 天，6/14～6/27；實際 ' + days.length + '）', days.length === 14, days.map((d) => d.date));
  const WD = '日一二三四五六';
  for (let i = 0; i < 14; i++) {
    const exp = new Date(2026, 5, 14 + i);
    const em = exp.getMonth() + 1, ed = exp.getDate(), ew = WD[exp.getDay()];
    const d = days[i] || { date: '', region: '', hotel: '' };
    const m = d.date.match(/(\d+)月(\d+)日（(.)）/);
    // 展開這一天：點標題，確認內文真的顯示出來、有時間軸或內容
    const body = await c.call((idx) => {
      const card = document.querySelectorAll('#tab-itinerary .day-card')[idx];
      if (!card) return null;
      const wasOpen = card.classList.contains('open');
      card.querySelector('.day-header').click();
      const b = card.querySelector('.day-body');
      const r = { opened: card.classList.contains('open') && !wasOpen, shown: !!b && getComputedStyle(b).display !== 'none' && b.offsetHeight > 0,
        tl: card.querySelectorAll('.timeline-item').length, txt: b ? b.textContent.replace(/\s+/g, '').length : 0,
        titles: [...card.querySelectorAll('.tl-title')].filter((t) => t.textContent.trim().length > 0).length };
      card.querySelector('.day-header').click(); // 收回
      r.closed = !card.classList.contains('open') && getComputedStyle(b).display === 'none';
      return r;
    }, i);
    const good = !!m && +m[1] === em && +m[2] === ed && m[3] === ew && d.region.length > 0 && d.hotel.length > 0
      && !!body && body.opened && body.shown && body.closed && body.tl >= 1 && body.titles === body.tl && body.txt >= 60;
    ok(`2.${i + 1} 第 ${i + 1} 張 ${em}/${ed}（${ew}）：日期連續且星期正確、有地點與住宿、展開後 ${body ? body.tl : 0} 個時段（皆有標題）／內文 ${body ? body.txt : 0} 字、可收回`,
      good, { date: d.date, region: d.region.slice(0, 30), hotel: d.hotel.slice(0, 20), body });
  }
  const nums = days.map((d) => d.num);
  const numsOk = nums.length === 14 && nums[0] === '0' && nums.slice(1, 13).every((n, k) => n === String(k + 1)) && nums[13] === '—';
  ok('2.15 天數徽章依序 0,1…12,—（實際 ' + nums.join(',') + '）', numsOk, nums);

  /* ───────── 3 分頁 ───────── */
  console.log('\n[3 分頁切換]');
  const targets = await c.call(navTargets);
  const sections = await c.eval(`[...document.querySelectorAll('.main > .section')].map(s => s.id)`);
  ok('3.1 預設只有「每日行程」分頁顯示', await c.eval(`(()=>{const a=[...document.querySelectorAll('.section.active')]; return a.length===1 && a[0].id==='tab-itinerary' && document.querySelector('.nav-btn.active').textContent.includes('每日行程')})()`));
  const tabRes = [];
  for (const t of targets) {
    await c.eval(`window.scrollTo(0,0)`);
    await c.call(clickTab, t.id);
    const r = await c.call((id) => {
      const act = [...document.querySelectorAll('.section.active')];
      const sec = document.getElementById('tab-' + id);
      const btn = document.querySelector('.nav-btn.active');
      return { id, n: act.length, right: act.length === 1 && act[0] === sec, vis: !!sec && sec.offsetHeight > 50,
        txt: sec ? sec.textContent.replace(/\s+/g, '').length : 0, btn: !!btn && (btn.getAttribute('onclick') || '').includes(`'${id}'`) };
    }, t.id);
    tabRes.push(r);
  }
  const badTabs = tabRes.filter((r) => !(r.right && r.vis && r.txt >= 200 && r.btn));
  ok(`3.2 ${targets.length} 個分頁按鈕逐一點：只顯示對應區塊、區塊有內容（最少 ${Math.min(...tabRes.map((r) => r.txt))} 字）、按鈕標成 active`,
    targets.length === 12 && badTabs.length === 0, badTabs.length ? badTabs : targets.map((t) => t.id));
  const noBtn = sections.filter((s) => !targets.some((t) => 'tab-' + t.id === s));
  ok(`3.3 反向：${sections.length} 個區塊每個都有導覽按鈕到得了`, sections.length === 12 && noBtn.length === 0, noBtn);
  await c.call(clickTab, 'itinerary');

  /* ───────── 4 站內連結 ───────── */
  console.log('\n[4 站內錨點與頁面連結]');
  const missingTargets = targets.filter((t) => !t.id || !sections.includes('tab-' + t.id));
  const hashLinks = await c.call(() => [...document.querySelectorAll('a[href^="#"]')].map((a) => a.getAttribute('href')).filter((h) => h.length > 1));
  const hashMissing = await c.call((hs) => hs.filter((h) => !document.getElementById(decodeURIComponent(h.slice(1)))), hashLinks);
  ok(`4.1 showTab 目標 ${targets.length} 個、#錨點 ${hashLinks.length} 個，全部指得到存在的區塊`, targets.length === 12 && missingTargets.length === 0 && hashMissing.length === 0, { missingTargets, hashMissing });
  async function relLinks(pageUrl) {
    return c.call(async () => {
      const hs = [...document.querySelectorAll('a[href], link[href]')].map((a) => a.getAttribute('href'))
        .filter((h) => h && !/^(https?:|tel:|mailto:|#|data:|javascript:)/i.test(h));
      const uniq = [...new Set(hs.map((h) => h.split('#')[0]))];
      const out = [];
      for (const h of uniq) {
        try { const r = await fetch(h, { cache: 'no-store' }); const t = await r.text(); out.push({ h, s: r.status, len: t.length }); }
        catch (e) { out.push({ h, s: 0, len: 0 }); }
      }
      return out;
    });
  }
  const rel = await relLinks(BASE);
  const relBad = rel.filter((x) => x.s !== 200 || x.len < 50);
  ok(`4.2 首頁的站內相對連結 ${rel.length} 個（${rel.map((x) => x.h).join(', ')}）都回 200 且有內容`,
    rel.length >= 5 && rel.some((x) => /milano-itinerary\.html$/.test(x.h)) && rel.some((x) => /italy-trip-map\.html$/.test(x.h)) && relBad.length === 0, relBad);

  // 米蘭詳細行程頁
  const milanoOk = await c.open(BASE + 'milano-itinerary.html', { ready: `document.readyState==='complete' && document.querySelectorAll('.tab').length > 0` });
  const milano = await c.call(() => {
    const tabs = [...document.querySelectorAll('.tab')];
    const res = tabs.map((b) => {
      b.click();
      const t = b.getAttribute('data-t');
      const p = document.getElementById('p-' + t);
      const act = [...document.querySelectorAll('.panel.active')];
      return { t, ok: !!p && act.length === 1 && act[0] === p && p.offsetHeight > 0 && p.textContent.trim().length > 50 && b.classList.contains('on') };
    });
    const back = [...document.querySelectorAll('a[href]')].filter((a) => /(^|\/)index\.html$/.test(a.getAttribute('href'))).length;
    return { n: tabs.length, bad: res.filter((r) => !r.ok).map((r) => r.t), back };
  });
  ok(`4.3 米蘭詳細行程頁：${milano.n} 個分頁逐一點都切到對應面板、有回主行程連結（${milano.back} 個）`, milanoOk && milano.n >= 7 && milano.bad.length === 0 && milano.back >= 1, milano);

  /* ───────── 5 地圖 ───────── */
  console.log('\n[5 地圖頁（Leaflet，CDN 與圖磚皆攔截成本機固定回應）]');
  const tilesBefore = (stubHits['a.tile.openstreetmap.org'] || 0) + (stubHits['b.tile.openstreetmap.org'] || 0) + (stubHits['c.tile.openstreetmap.org'] || 0);
  const mapOk = await c.open(BASE + 'italy-trip-map.html', { ready: `document.readyState==='complete' && typeof L !== 'undefined' && document.querySelectorAll('.leaflet-marker-icon').length > 0` });
  const mapInfo = await c.call(() => ({
    data: typeof DATA !== 'undefined' ? DATA.length : -1,
    markers: document.querySelectorAll('.leaflet-marker-icon').length,
    zones: document.querySelectorAll('#zones .zb').length,
    legend: document.querySelectorAll('#lgbody .lg').length,
    back: [...document.querySelectorAll('a[href]')].filter((a) => /(^|\/)index\.html$/.test(a.getAttribute('href'))).length,
  }));
  await c.until(`document.querySelectorAll('.leaflet-tile-loaded').length > 0`, 5000);
  const tilesLoaded = await c.eval(`document.querySelectorAll('.leaflet-tile-loaded').length`);
  ok(`5.1 地圖載入：${mapInfo.markers} 個標記＝資料 ${mapInfo.data} 筆、區域按鈕 ${mapInfo.zones} 個、圖例 ${mapInfo.legend} 類、有回主行程連結`,
    mapOk && mapInfo.data > 10 && mapInfo.markers === mapInfo.data && mapInfo.zones > 2 && mapInfo.legend > 1 && mapInfo.back >= 1, mapInfo);
  const tilesAfter = (stubHits['a.tile.openstreetmap.org'] || 0) + (stubHits['b.tile.openstreetmap.org'] || 0) + (stubHits['c.tile.openstreetmap.org'] || 0);
  ok(`5.2 圖磚有請求且被攔截回應（本次 ${tilesAfter - tilesBefore} 張，畫面已載入 ${tilesLoaded} 張）`, tilesAfter > tilesBefore && tilesLoaded > 0, { tilesBefore, tilesAfter, tilesLoaded });
  const zone = await c.call(() => {
    const b = document.querySelectorAll('#zones .zb')[1];
    const label = b.textContent;
    const want = DATA.filter((p) => p.z === ZONES[0][0]).length;
    b.click();
    return { label, want, got: document.querySelectorAll('.leaflet-marker-icon').length, on: b.classList.contains('on') };
  });
  ok(`5.3 點區域「${zone.label}」：標記剩 ${zone.got} 個＝該區資料 ${zone.want} 筆`, zone.want > 0 && zone.got === zone.want && zone.got < mapInfo.data && zone.on, zone);
  const pop = await c.call(async () => {
    document.querySelector('.leaflet-marker-icon').click();
    await new Promise((r) => setTimeout(r, 300));
    const a = document.querySelector('.leaflet-popup-content a.pnav');
    const n = document.querySelector('.leaflet-popup-content .pn');
    return { name: n ? n.textContent : null, href: a ? a.getAttribute('href') : null };
  });
  ok(`5.4 點標記跳出說明＋Google 導航連結（${pop.name}）`, !!pop.name && /^https:\/\/www\.google\.com\/maps\//.test(pop.href || ''), pop);

  /* ───────── 6 緊急資訊 ───────── */
  console.log('\n[6 緊急資訊]');
  await c.open(BASE);
  await c.call(clickTab, 'sos');
  const tels = await c.call(() => [...document.querySelectorAll('#tab-sos a[href^="tel:"]')].map((a) => ({
    href: a.getAttribute('href'), text: a.textContent.replace(/\s+/g, ' ').trim(), vis: a.offsetHeight > 0,
  })));
  const norm = (h) => { let d = h.replace(/^tel:/, '').replace(/[^\d+]/g, ''); if (d.startsWith('+886')) d = '0' + d.slice(4); return d.replace(/\+/g, ''); };
  const telBad = tels.filter((t) => { const shown = (t.text.match(/[\d+][\d\s\-+]*\d|\d/g) || []).join('').replace(/[^\d]/g, ''); return !t.vis || shown !== norm(t.href); });
  ok(`6.1 緊急頁 ${tels.length} 個撥號連結，tel: 號碼與畫面上顯示的號碼逐一相同且看得到`, tels.length >= 7 && telBad.length === 0,
    telBad.length ? telBad : tels.map((t) => t.href));
  const KEY = [['112', /歐盟|緊急/], ['117', /瑞士警察/], ['118', /義大利救護/], ['1414', /REGA|山難/], ['+886800085095', /外交部|急難/], ['+41313822927', /瑞士代表處/], ['+390685879780', /義大利代表處/]];
  const keyBad = await c.call((K) => K.filter(([num, re]) => {
    const a = document.querySelector(`#tab-sos a[href="tel:${num}"]`);
    if (!a) return true;
    const ctx = (a.closest('li') || a).textContent;
    return !new RegExp(re).test(ctx);
  }).map(([n]) => n), KEY.map(([n, r]) => [n, r.source]));
  ok(`6.2 ${KEY.length} 支關鍵號碼都在，且旁邊標示的單位正確（112 歐盟／117 瑞士警察／118 義大利救護／1414 REGA／外交部／駐瑞士／駐義大利）`, keyBad.length === 0, keyBad);
  // 醫院地圖連結：座標要在文字寫的那個城鎮附近（< 5 公里）
  const TOWN = { Zermatt: [46.0207, 7.7491], Interlaken: [46.6863, 7.8632], Cortina: [46.5404, 12.1357], '米蘭': [45.4642, 9.19] };
  const hosp = await c.call((T, havSrc) => {
    const hv = eval('(' + havSrc + ')');
    return [...document.querySelectorAll('#tab-sos a.map-btn')].map((a) => {
      const m = (a.getAttribute('href') || '').match(/query=(-?[\d.]+),(-?[\d.]+)/);
      const block = a.parentElement.textContent;
      const town = Object.keys(T).find((k) => a.textContent.includes(k));
      const d = m && town ? hv([+m[1], +m[2]], T[town]) : null;
      return { text: a.textContent.trim(), town, km: d === null ? null : +d.toFixed(2), sameBlock: !!town && block.includes(town === '米蘭' ? '米蘭' : town), blank: a.target === '_blank' };
    });
  }, TOWN, hav.toString());
  const hospBad = hosp.filter((h) => !(h.town && h.km !== null && h.km < 5 && h.sameBlock && h.blank));
  ok(`6.3 醫院地圖連結 ${hosp.length} 個：座標都在連結文字所寫城鎮 5 公里內（${hosp.map((h) => h.town + ' ' + h.km + 'km').join('、')}），另開視窗`,
    hosp.length >= 4 && hospBad.length === 0, hospBad);
  ok('6.4 緊急頁標示「離線也能查看」，且已在 SW 快取裡（離線開得到）', await c.eval(`document.getElementById('tab-sos').textContent.includes('離線也能查看')`)
    && await c.eval(`caches.keys().then(ks => Promise.all(ks.map(k => caches.open(k).then(cc => cc.match('./index.html'))))).then(rs => rs.some(r => !!r))`));
  // 全站 Google 地圖座標連結：數字合法、都在行程範圍（瑞士／奧地利西部／義大利北部）
  const maps = await c.call(() => [...document.querySelectorAll('a[href*="google.com/maps"]')].map((a) => a.getAttribute('href')));
  const coordLinks = maps.map((h) => h.match(/query=(-?[\d.]+),(-?[\d.]+)(?:&|$)/)).filter(Boolean).map((m) => [+m[1], +m[2]]);
  const outBox = coordLinks.filter(([la, ln]) => !(la >= 45 && la <= 47.6 && ln >= 7 && ln <= 12.6));
  const textQ = maps.filter((h) => !/query=(-?[\d.]+),(-?[\d.]+)(?:&|$)/.test(h));
  const textQBad = textQ.filter((h) => !/query=[^&]{3,}/.test(h));
  ok(`6.5 全站 Google 地圖連結 ${maps.length} 個（座標 ${coordLinks.length}、地名 ${textQ.length}）：座標都在行程範圍內、地名查詢不空`,
    maps.length >= 80 && coordLinks.length >= 70 && outBox.length === 0 && textQBad.length === 0, { outBox, textQBad });

  /* ───────── 7 出發準備清單 ───────── */
  console.log('\n[7 出發準備清單：勾選與保存]');
  await c.open(BASE);
  await c.call(clickTab, 'checklist');
  const total = await c.eval(`document.querySelectorAll('.todo-check').length`);
  ok(`7.1 清單 ${total} 項，進度顯示「已完成 0 / ${total} 項」`, total >= 10 && await c.eval(`document.getElementById('progress-detail').textContent.trim() === '已完成 0 / ${total} 項' && document.getElementById('progress-pct').textContent === '0%'`),
    await c.eval(`document.getElementById('progress-detail').textContent`));
  const PICK = [0, 2, total - 1];
  await c.call((idx) => { const cbs = document.querySelectorAll('.todo-check'); idx.forEach((i) => cbs[i].click()); return 1; }, PICK);
  const pct3 = Math.round(3 / total * 100);
  const after = await c.call(() => ({ d: document.getElementById('progress-detail').textContent.trim(), p: document.getElementById('progress-pct').textContent, w: document.getElementById('progress-bar').style.width }));
  ok(`7.2 勾 3 項：進度變「已完成 3 / ${total} 項」${pct3}%、進度條寬度跟著變`, after.d === `已完成 3 / ${total} 項` && after.p === pct3 + '%' && after.w === pct3 + '%', after);
  await c.open(BASE, { clear: false });
  const kept = await c.call(() => ({ on: [...document.querySelectorAll('.todo-check')].map((cb, i) => cb.checked ? i : -1).filter((i) => i >= 0), d: document.getElementById('progress-detail').textContent.trim() }));
  ok(`7.3 重新整理後勾選還在（第 ${kept.on.join('、')} 項）、進度仍是 3 / ${total}`, JSON.stringify(kept.on) === JSON.stringify(PICK) && kept.d === `已完成 3 / ${total} 項`, kept);
  await c.call(() => { document.querySelectorAll('.todo-check')[2].click(); return 1; });
  await c.open(BASE, { clear: false });
  const kept2 = await c.call(() => [...document.querySelectorAll('.todo-check')].map((cb, i) => cb.checked ? i : -1).filter((i) => i >= 0));
  ok(`7.4 取消勾選一項，重新整理後也記得（剩 ${kept2.join('、')}）`, JSON.stringify(kept2) === JSON.stringify([0, total - 1]), kept2);

  /* ───────── 8 我的證件 ───────── */
  console.log('\n[8 我的證件（只存本機）]');
  await c.open(BASE);
  await c.call(clickTab, 'docs');
  const idCount = await c.eval(`document.querySelectorAll('input.myid').length`);
  await c.call(() => { for (const [id, v] of [['myid-pnr', 'TST123'], ['myid-hotel-milan', 'Hotel Test 米蘭']]) { const i = document.getElementById(id); i.value = v; i.dispatchEvent(new Event('input', { bubbles: true })); } return 1; });
  await c.open(BASE, { clear: false, confirm: false });
  const idv = await c.eval(`[document.getElementById('myid-pnr').value, document.getElementById('myid-hotel-milan').value]`);
  ok(`8.1 證件欄位 ${idCount} 格；輸入後重新整理仍在（${idv.join(' / ')}）`, idCount >= 10 && idv[0] === 'TST123' && idv[1] === 'Hotel Test 米蘭', idv);
  await c.call(clickTab, 'docs');
  await c.eval(`document.querySelector('#tab-docs button[onclick="clearMyId()"]').click()`);
  const keep = await c.eval(`[document.getElementById('myid-pnr').value, localStorage.getItem('myid-pnr'), window.__confirms.length]`);
  ok('8.2 清除時按「取消」：資料保留（有先問確認）', keep[0] === 'TST123' && keep[1] === 'TST123' && keep[2] === 1, keep);
  await c.open(BASE, { clear: false, confirm: true });
  await c.call(clickTab, 'docs');
  await c.eval(`document.querySelector('#tab-docs button[onclick="clearMyId()"]').click()`);
  const gone = await c.call(() => ({ vals: [...document.querySelectorAll('input.myid')].filter((i) => i.value).length, keys: Object.keys(localStorage).filter((k) => k.startsWith('myid-')).length, asked: window.__confirms.length }));
  ok(`8.3 清除時按「確定」：畫面 ${gone.vals} 格有值、本機 ${gone.keys} 筆 myid 資料（都應為 0）`, gone.vals === 0 && gone.keys === 0 && gone.asked === 1, gone);

  /* ───────── 9 旅遊工具：匯率 ───────── */
  console.log('\n[9 匯率換算（API 攔截成固定匯率）]');
  await c.open(BASE);
  await c.call(clickTab, 'tools');
  ok('9.1 抓到（假）即時匯率：顯示「即時匯率 CHF 1 ≈ TWD 40.0 EUR 1 ≈ TWD 50.0」',
    await c.until(`/即時匯率/.test(document.getElementById('tool-rate-info').textContent) && /TWD 40\\.0/.test(document.getElementById('tool-rate-info').textContent) && /TWD 50\\.0/.test(document.getElementById('tool-rate-info').textContent)`, 5000),
    await c.eval(`document.getElementById('tool-rate-info').textContent`));
  await c.call(() => { document.getElementById('tool-from').value = 'TWD'; document.getElementById('tool-to').value = 'CHF'; setAmount(1000); return 1; });
  const r1 = await c.eval(`document.getElementById('tool-result').textContent`);
  await c.call(() => { document.getElementById('tool-from').value = 'EUR'; document.getElementById('tool-to').value = 'TWD'; setAmount(10); return 1; });
  const r2 = await c.eval(`document.getElementById('tool-result').textContent`);
  ok(`9.2 換算正確：NT$1000→「${r1}」、€10→「${r2}」`, r1 === 'CHF 25.00' && r2 === 'NT$ 500', { r1, r2 });
  const qt = await c.call(() => [...document.querySelectorAll('#quick-table tr')].slice(1).map((tr) => tr.textContent.replace(/\s+/g, ' ').trim()));
  ok(`9.3 速查表 ${qt.length} 列，NT$1,000 那列＝CHF 25.0／€ 20.0`, qt.length === 6 && qt.some((t) => t.includes('NT$ 1,000') && t.includes('CHF 25.0') && t.includes('€ 20.0')), qt);

  /* ───────── 10 日期邏輯（假時鐘） ───────── */
  console.log('\n[10 倒數與「今天」（假時鐘）]');
  await c.open(BASE, { now: '2026-06-12T12:00:00' });
  await c.until(`document.getElementById('bc-days').textContent !== '--'`, 3000);
  const cd = await c.eval(`['bc-label','bc-days','bc-hours','bc-mins'].map(id => document.getElementById(id).textContent)`);
  ok(`10.1 出發前（假定 6/12 12:00）：倒數 ${cd[1]} 天 ${cd[2]} 時 ${cd[3]} 分（應為 2 天 05 時 54～55 分）`, cd[0] === '距離出發' && cd[1] === '2' && cd[2] === '05' && /^5[45]$/.test(cd[3]), cd);
  ok('10.2 出發前不會自動展開任何一天', await c.eval(`document.querySelectorAll('#tab-itinerary .day-card.open, .today-badge').length === 0`));
  await c.open(BASE, { now: '2026-06-20T10:00:00' });
  await c.until(`!!document.querySelector('.today-badge')`, 3000);
  // 倒數函式第一次執行時 #big-countdown 還沒出現在 DOM（script 在它前面），要等 setInterval 下一拍才寫上
  await c.until(`/旅程第/.test(document.getElementById('bc-label').textContent)`, 3000);
  const today = await c.call(() => {
    const open = [...document.querySelectorAll('#tab-itinerary .day-card.open')];
    const badge = [...document.querySelectorAll('.today-badge')];
    const card = badge[0] && badge[0].closest('.day-card');
    return { open: open.length, badge: badge.length, date: card ? card.querySelector('.day-date').textContent : null,
      text: card ? card.textContent : '', label: document.getElementById('bc-label').textContent };
  });
  ok(`10.3 旅程中（假定 6/20）：自動展開並標「今天」的是 ${today.date}，且只有這一張`, today.open === 1 && today.badge === 1 && /6月20日/.test(today.date || ''), { ...today, text: undefined });
  // 倒數區寫的「旅程第 N 天 · 地點」要跟當天行程卡對得上
  const lm = today.label.match(/旅程第 (\d+) 天 · 📍 (.+)$/);
  const toks = lm ? lm[2].split(/[\s/→]+/).filter((t) => t.length >= 2) : [];
  ok(`10.4 倒數區顯示「${today.label}」：第 7 天、地點字樣（${toks.join('、')}）出現在當天行程卡`, !!lm && lm[1] === '7' && toks.length > 0 && toks.some((t) => today.text.includes(t)), today.label);
  // 每一天的地點標籤（TRIP_DAY_LABELS）都要對得上那天的卡片。
  // 去掉「前往／健行」這類動詞；「少女峰區」卡片上寫的是 Lauterbrunnen／少女峰，用地理別名對。
  const labelBad = await c.call(() => {
    const ALIAS = { '少女峰區': ['少女峰', 'Lauterbrunnen', 'Jungfrau'] };
    return [...document.querySelectorAll('#tab-itinerary .day-card')].map((card, i) => {
      const lab = TRIP_DAY_LABELS[i + 1] || '';
      const tk = lab.replace(/前往|健行/g, ' ').split(/[\s/→]+/).filter((t) => t.length >= 2);
      const hit = tk.some((t) => [t, ...(ALIAS[t] || [])].some((a) => card.textContent.includes(a)));
      return { i: i + 1, lab, hit, n: tk.length };
    }).filter((x) => !x.hit || x.n === 0);
  });
  ok('10.5 14 天的「旅程第 N 天」地點標籤逐日都對得上當天行程卡', (await c.eval(`TRIP_DAY_LABELS.length`)) === 15 && (await c.eval(`document.querySelectorAll('#tab-itinerary .day-card').length`)) === 14 && labelBad.length === 0, labelBad);
  await c.open(BASE, { now: '2026-07-01T09:00:00' });
  ok('10.6 旅程結束後（假定 7/1）：顯示「旅程已結束」、不展開任何一天',
    await c.until(`/旅程已結束/.test(document.getElementById('bc-label').textContent)`, 3000) && await c.eval(`document.querySelectorAll('#tab-itinerary .day-card.open').length === 0`),
    await c.eval(`document.getElementById('bc-label').textContent`));

  /* ───────── 11 主題 ───────── */
  console.log('\n[11 深淺色]');
  await c.open(BASE);
  const th0 = await c.eval(`document.documentElement.getAttribute('data-theme')`);
  await c.eval(`document.getElementById('theme-toggle').click()`);
  const th1 = await c.call(() => ({ t: document.documentElement.getAttribute('data-theme'), s: localStorage.getItem('theme'), icon: document.getElementById('theme-toggle').textContent, meta: document.querySelector('meta[name="theme-color"]').content, bg: getComputedStyle(document.body).backgroundColor }));
  ok(`11.1 預設淺色（${th0}），按一次切到深色：記住設定、圖示變 ☀️、網址列顏色 ${th1.meta}`, th0 === 'light' && th1.t === 'dark' && th1.s === 'dark' && th1.icon === '☀️' && th1.meta === '#15130f', th1);
  await c.open(BASE, { clear: false });
  const th2 = await c.call(() => ({ t: document.documentElement.getAttribute('data-theme'), bg: getComputedStyle(document.body).backgroundColor }));
  ok(`11.2 重新整理後仍是深色，且頁面底色真的變了（${th2.bg}）`, th2.t === 'dark' && th2.bg === th1.bg && th2.bg !== 'rgb(250, 248, 244)', th2);

  /* ───────── 12 版面 ───────── */
  console.log('\n[12 版面：手機寬度]');
  for (const w of [360, 390]) {
    await c.width(w);
    await c.open(BASE);
    const over = [];
    for (const t of targets) {
      await c.call(clickTab, t.id);
      if (t.id === 'itinerary' || t.id === 'hiking') {
        await c.eval(`document.querySelectorAll('#tab-${t.id} .day-card:not(.open), #tab-${t.id} .hike-card:not(.open)').forEach(x => x.classList.add('open'))`);
      }
      await sleep(80);
      const sw = await c.eval(`[document.documentElement.scrollWidth, window.innerWidth]`);
      if (sw[0] > sw[1] + 1) over.push({ tab: t.id, sw });
    }
    ok(`12.${w} ${w}px：${targets.length} 個分頁（行程／健行全部展開）都沒有水平捲動`, targets.length === 12 && over.length === 0, over);
    await c.call(clickTab, 'itinerary');
    const sizes = await c.call(() => {
      const pick = (sel) => [...document.querySelectorAll(sel)].filter((e) => e.offsetParent || getComputedStyle(e).position === 'fixed')
        .map((e) => ({ sel, h: Math.round(e.getBoundingClientRect().height), t: e.textContent.trim().slice(0, 8) }));
      return [...pick('.nav-btn'), ...pick('#theme-toggle')];
    });
    const small = sizes.filter((s) => s.h < 36);
    ok(`12.${w}b ${w}px：導覽按鈕 ${sizes.length - 1} 個與主題鈕高度都 ≥ 36px（現行規格；最矮 ${Math.min(...sizes.map((s) => s.h))}px）`, sizes.length >= 13 && small.length === 0, small);
  }
  await c.width(390);

  /* ───────── 13 錯誤與連線 ───────── */
  console.log('\n[13 沒有錯誤、沒有意外的對外連線]');
  ok('13.1 全程沒有未捕捉的 JS 例外（' + c.errors.length + '）', c.errors.length === 0, c.errors.slice(0, 3));
  const hitHosts = Object.keys(stubHits);
  ok('13.2 攔截確實作用：匯率 API 與 OSM 圖磚都被攔下回固定內容（' + hitHosts.map((h) => h + '×' + stubHits[h]).join(', ') + '）',
    (stubHits['api.exchangerate-api.com'] || 0) > 0 && hitHosts.some((h) => /tile\.openstreetmap\.org$/.test(h)) && (stubHits['cdnjs.cloudflare.com'] || 0) > 0, stubHits);
  const blockedHosts = [...new Set(blocked.map((u) => { try { return new URL(u).hostname; } catch { return u; } }))];
  ok('13.3 除了允許清單（匯率／Google 字型／Leaflet CDN／OSM 圖磚），沒有連到其他網域（被擋 ' + blocked.length + ' 次）', blocked.length === 0, blockedHosts);
} catch (e) {
  fail++;
  console.log('  FAIL 測試程式本身出錯：' + (e && e.stack || e));
} finally {
  console.log('\n' + (fail ? 'FAIL' : 'PASS') + '　通過 ' + pass + ' 項，失敗 ' + fail + ' 項');
  await cleanup();
  process.exit(fail ? 1 : 0);
}
