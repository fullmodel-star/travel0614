"""下載 Microsoft Fluent Emoji 的 3D 圖（MIT），縮成 128px PNG → vendor/fluent-3d/<key>.png

    python _tools/build_fluent3d.py
    （需要 Pillow：pip install pillow）

2026-10-19 版面美化「護照手帳」建立（做法照 605 _tools/build_fluent3d.py）：
12 個分頁、護照封面主視覺、主按鈕、出發準備票卡用同一套 3D 立體圖（不再混 emoji／國旗字母）。
- 來源：https://github.com/microsoft/fluentui-emoji （MIT，全文寫到 vendor/fluent-3d/LICENSE.txt）。
- 顯示最大約 200px（桌機封面山），存 128px；分頁 24px。
- 下載後檢查是 PNG 檔頭（不是錯誤頁），不合格就停。User-Agent 用 curl/8。
"""
import io
import sys
import urllib.parse
import urllib.request
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "vendor" / "fluent-3d"
BASE = "https://raw.githubusercontent.com/microsoft/fluentui-emoji/main"
SIZE = 128

# key → Fluent 資料夾名（大小寫要完全一樣；檔名＝資料夾名小寫、空白換底線＋_3d.png）
ICONS = {
    # 12 個分頁（對應 index.html 的 .nav-btn）
    "luggage": "Luggage",                    # 出發準備（也用在首頁出發準備票卡）
    "calendar": "Spiral calendar",           # 每日行程
    "tramway": "Aerial tramway",             # 纜車票券
    "passport": "Passport control",          # 證件通行
    "cart": "Shopping cart",                 # 超市餐廳
    "alarm": "Alarm clock",                  # 預訂提醒
    "toolbox": "Toolbox",                    # 旅遊工具
    "boot": "Hiking boot",                   # 健行指南
    "car": "Automobile",                     # 開車指南
    "rain": "Cloud with rain",               # 備案決策
    "sos": "Sos button",                     # 緊急資訊（⚠ 資料夾名是 Sos 不是 SOS，大寫會 404）
    "dining": "Fork and knife with plate",   # 餐廳購物
    # 護照封面
    "mountain": "Snow-capped mountain",
    "book": "Open book",                     # 主按鈕「開始看行程／回顧行程」
}


def fetch(url: str) -> bytes:
    req = urllib.request.Request(url, headers={"User-Agent": "curl/8"})
    with urllib.request.urlopen(req, timeout=30) as r:
        return r.read()


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    for key, folder in ICONS.items():
        fname = folder.lower().replace(" ", "_") + "_3d.png"
        url = f"{BASE}/assets/{urllib.parse.quote(folder)}/3D/{urllib.parse.quote(fname)}"
        raw = fetch(url)
        if not raw.startswith(b"\x89PNG"):
            print(f"[FAIL] {key}：{url} 不是 PNG"); sys.exit(1)
        im = Image.open(io.BytesIO(raw)).convert("RGBA")
        im = im.resize((SIZE, SIZE), Image.LANCZOS)
        dst = OUT / f"{key}.png"
        im.save(dst, optimize=True)
        print(f"OK {key:10s} {dst.stat().st_size // 1024} KB  ← {folder}")
    (OUT / "LICENSE.txt").write_bytes(fetch(f"{BASE}/LICENSE"))
    print("OK LICENSE.txt")


if __name__ == "__main__":
    main()
