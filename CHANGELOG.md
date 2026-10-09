# 更新記錄 CHANGELOG

> 瑞士義大利旅遊行程 2026（12晚14天）離線可安裝 PWA。
> 版本以 `sw.js` 的快取編號為準（`travel-itinerary-vNN`），每次改版 +1；使用者重開會跳「🔄 有新版本行程」橫幅。
> 發版提醒：每次改 `index.html`／地圖 HTML 後，記得把 `sw.js` 的 `CACHE_NAME` 編號 +1。

## 2026-10-09 · 體驗盤點：字級下限 13px（sw travel-itinerary-v28；index／italy-trip-map／milano-itinerary 三頁）

- 字級下限 13px（`01_原始碼庫_apps-monorepo/packages/tooling/_font_floor.py`）：寫死的 10～12.9px→13px、`.625～.81rem`→`.8125rem`；<10px、em、font: 簡寫、品牌層 ridgeline-ui.css 不動。手機 390 寬 13px 以下字比例 43%→0%，橫向溢出 0。

## 2026-10-09 · 浮動安裝鈕不再蓋住行程卡

- **浮動按鈕不擋內容**：「📲 安裝到桌面」原本找不到品牌頁尾時固定在畫面底部置中（`.rdg-fixed`），壓住卡片與主按鈕。加上與英語家族同一套 `<!--FABSAFE_START-->` 區塊（工具：`01_原始碼庫_apps-monorepo/packages/tooling/_fabsafe_inject.py`，冪等），安裝鈕改成頁面最底的一般區塊；按鈕功能不變。

## 2026-10-03 新增自動化走查測試（App 未改）

- `node _tools/ui_tests.mjs`：headless Chrome 瀏覽器走查，不連外網、不動 App 檔；`--dir=<路徑>` 可對副本跑。
- 59 項：14 天行程逐日、12 分頁、緊急電話號碼與畫面一致、醫院座標、清單／證件儲存、假時鐘倒數、版面；外部請求全部攔截。反向測試 7 條。
- ⚠ Leaflet 借用 `400_走稜步道_trails/vendor/leaflet`（環境變數 LEAFLET_DIR 可改）。
- 走查順帶看到（未改，待確認）：餐飲區標題寫「維羅納（6/25 過夜）」但同區說 6/25 不住維羅納；台灣急難電話只列國內 0800-085-095，沒列海外免付費 800-0885-0885。

## v26 — 2026-10-03 修第一次造訪頁面自己重整

- sw activate 會 clients.claim()，首訪「沒有控制者→有控制者」也觸發 controllerchange，原本直接 reload＝新使用者打開 1～2 秒後頁面自己重整。加 hadController，只有真的換版才重新載入（比照 605／607～609）。全新瀏覽器實測導覽次數 2→1。
- sw CACHE_NAME travel-itinerary-v25→v26。部署前確認 GitHub Pages 線上 index.html／sw.js＝git HEAD。

## v22（最新 · 2026-06-11）

目前發布版本，內容涵蓋：

- **每日行程**：12晚14天逐日時間軸，含自駕路線、車程、邊境 Vignette（瑞 CHF40／奧）、Brenner 與義大利高速通行費提醒。
- **重點預訂提醒**：Seceda 纜車 2026 起強制線上時段預訂（€74）等關鍵卡關事項。
- 附 `italy-trip-map.html`（行程地圖）、`milano-itinerary.html`（米蘭行程）。
- 離線可用 + 加到主畫面（PWA，含 icon 與 manifest）。

---

> 說明：v22 之前的逐版改動未個別條列（版本號即 `sw.js` 累計發版次數）。
> 自本檔起，新改動請在上方新增 `## v23 — 標題（日期）` 區塊記錄。
