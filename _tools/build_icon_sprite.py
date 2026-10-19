"""把 index.html 用到的 Tabler 線條圖示（MIT）做成內嵌 <svg> sprite，寫進 index.html 的標記之間。

    npm pack @tabler/icons@3.49.0   （在暫存資料夾）→ 解開 →
    python _tools/build_icon_sprite.py <解開後的 package 資料夾>

2026-10-19 版面美化「護照手帳」建立（照 605 _tools/build_icon_sprite.py）：
每日卡的住宿行（床／飛機）、88 個地圖導航鈕（圖釘）、42 個提示框（依原 emoji 語意對應）、更新橫幅，
一律用同一套線條圖示，取代原本混用的彩色 emoji。12 個分頁用 Fluent 3D（build_fluent3d.py）。
- 只收下面 ICONS 用到的圖示；新增圖示＝加進 ICONS 後重跑，不要手改 sprite。
- 授權全文複製到 vendor/tabler-icons/LICENSE.txt。
- index.html 是 CRLF：用二進位讀寫，只換標記之間的內容，其他位元組不動。
"""
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
HTML = ROOT / "index.html"
START = b"<!-- TABLER_SPRITE_START"
END = b"<!-- TABLER_SPRITE_END -->"

# (sprite id, Tabler 檔名)；全部 outline
ICONS = [
    ("bed", "bed"), ("plane", "plane"), ("pin", "map-pin"), ("refresh", "refresh"),
    ("bulb", "bulb"), ("car", "car"), ("alert-octagon", "alert-octagon"), ("alert", "alert-triangle"),
    ("clock", "clock"), ("card", "credit-card"), ("glass", "glass-full"), ("shoe", "shoe"),
    ("train", "train"), ("camera", "camera"), ("kitchen", "tools-kitchen-2"), ("rain", "cloud-rain"),
    ("sunrise", "sunrise"), ("sos", "sos"), ("star", "star"), ("bolt", "bolt"),
]


def symbol(pkg: Path, sid: str, name: str) -> str:
    svg = (pkg / "icons" / "outline" / f"{name}.svg").read_text(encoding="utf-8")
    paths = [p for p in re.findall(r"<path[^>]*/>", svg) if 'stroke="none"' not in p]  # 去掉 24x24 透明底框
    if not paths:
        raise SystemExit(f"[FAIL] outline/{name}.svg 沒有可用的 path")
    attrs = 'fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"'
    return f'<symbol id="ti-{sid}" viewBox="0 0 24 24" {attrs}>{"".join(p.replace(" />", "/>") for p in paths)}</symbol>'


def main() -> None:
    if len(sys.argv) != 2:
        raise SystemExit(__doc__)
    pkg = Path(sys.argv[1])
    version = json.loads((pkg / "package.json").read_text(encoding="utf-8"))["version"]
    raw = HTML.read_bytes()
    used = set(re.findall(rb'href="#ti-([a-z0-9-]+)"', raw))
    have = {i[0].encode() for i in ICONS}
    if used - have:
        raise SystemExit(f"[FAIL] index.html 用到但 ICONS 沒列：{sorted(u.decode() for u in used - have)}")
    syms = "".join(symbol(pkg, *i) for i in ICONS)
    block = (f"<!-- TABLER_SPRITE_START：Tabler Icons {version}（MIT，授權見 vendor/tabler-icons/LICENSE.txt）；"
             f"由 _tools/build_icon_sprite.py 產生，勿手改 -->\r\n"
             f'<svg xmlns="http://www.w3.org/2000/svg" style="position:absolute;width:0;height:0;overflow:hidden" aria-hidden="true" focusable="false">'
             f"{syms}</svg>\r\n").encode("utf-8")
    a = raw.find(START)
    b = raw.find(END)
    if a < 0 or b < a:
        raise SystemExit("[FAIL] index.html 找不到 TABLER_SPRITE 標記")
    HTML.write_bytes(raw[:a] + block + raw[b:])
    lic = ROOT / "vendor" / "tabler-icons" / "LICENSE.txt"
    lic.parent.mkdir(parents=True, exist_ok=True)
    lic.write_bytes((pkg / "LICENSE").read_bytes())
    print(f"[OK] sprite {len(ICONS)} 個圖示（Tabler {version}）；頁面用到 {len(used)} 種；LICENSE 已複製")


if __name__ == "__main__":
    main()
