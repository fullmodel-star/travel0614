# 更新記錄 CHANGELOG

> 瑞士義大利旅遊行程 2026（12晚14天）離線可安裝 PWA。
> 版本以 `sw.js` 的快取編號為準（`travel-itinerary-vNN`），每次改版 +1；使用者重開會跳「🔄 有新版本行程」橫幅。
> 發版提醒：每次改 `index.html`／地圖 HTML 後，記得把 `sw.js` 的 `CACHE_NAME` 編號 +1。

- 2026-10-12 · v31（已部署 2026-10-12 GitHub Pages）：桌機（≥768px）引導卡主按鈕限寬 360–420px、手機仍全寬；頁首深色切換由 emoji 🌙／☀️ 改為線條 SVG 月亮／太陽，與回報鈕同為灰底圓鈕＋白色線條圖示（aria-label 不變）；ui_tests 11.1 改驗 SVG 圖示。行程內容未動。

## 2026-10-12 · 體驗改善（v2 評分；sw travel-itinerary-v30，只改 index.html／sw.js）｜已部署 2026-10-12 GitHub Pages

- **效能**：移除 Google Fonts 中文字型（首載 2182KB→359KB），改系統字型堆疊；其餘兩頁（地圖、米蘭）仍用 Google 字型。
- **手機字級與觸控**：主文字 15px、觸控目標全 ≥40px（導覽鈕 44px），手機版導覽改非 sticky（4 排釘在頂端會吃掉 340px）。
- **品牌**：頁首補官方 fitzroy 山形（rl-appbar／rl-glyph）；回報鈕、深色切換鈕移到頁首角落，不再浮在卡片上。
- **導引**：每日行程頂端新增「第一次打開？」卡（主按鈕：依日期顯示「開始看行程／打開今天的行程」＋出發準備清單完成數 x/51 與進度條）；每日卡依住宿地分組標題（6/14–16 策馬特、6/17–19 Lauterbrunnen、6/20 伊姆斯特、6/21–24 Cortina、6/25–27 米蘭）。行程內容未動。
- **對比**：深色 day-num 與頁尾灰字調深（Lighthouse 無障礙 96→100）。
- 測試：`node _tools/ui_tests.mjs` 59/59。

## 2026-10-09 · 體驗盤點：桌機版（sw travel-itinerary-v29）

- **問題**：視窗 ≥1000px 時主欄只有 680px 窄欄；12 個分頁被拉成兩排（6 欄格線），間距過大；首圖在 1440 寬時高達 465px 把內容推到畫面下半。
- **改法**：只新增一段 `@media (min-width:1000px)`（約 13 行 CSS，放在 index.html 第一個 `<style>` 尾端）：12 個分頁排成一列（導覽列最寬 1200px）；主欄放寬到 980px；「每日行程」每日卡片改兩欄（展開不拉高鄰卡）；首圖限高 340px（裁切不變形）；總覽格 4 欄、超市格 3 欄。手機版面零變動（390×844 改前改後 5 個畫面截圖逐像素相同）。
- **sw.js**：`CACHE_NAME` travel-itinerary-v28 → v29。
- 未動：italy-trip-map.html、milano-itinerary.html（獨立頁面，本次未納入桌機版）；其餘分頁（纜車、證件等）在桌機維持單欄 980px。

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
