"""把 jf open 粉圓 裁成「只含本 App 用圓體顯示的文字」的小字型 → vendor/round-ui/pp-round.woff2

    python _tools/build_round_font.py <jf-openhuninn-2.1.ttf 的路徑>
    （需要 fonttools＋brotli：pip install fonttools brotli）

2026-10-19 版面美化「護照手帳」建立，做法照 605 _tools/build_round_font.py。
- 來源：https://github.com/justfont/open-huninn-font  v2.1（SIL OFL-1.1，全文在 vendor/round-ui/LICENSE.txt）。
  原始 TTF 不進版控。**改到下面這些地方的文字後要重跑**（缺的字會退回系統字，不會變豆腐，但字型會混）。
- 收字範圍（＝CSS 用 var(--round) 的地方）：頁首、分頁、封面、郵戳、按鈕、h1–h4 標題、日期、時段（tl-time）、
  分組標題、section-label、dt/dd，加上 JS 動態寫進主按鈕的字（EXTRA）＋可列印 ASCII。
  時間軸內文、提示框等長文字仍用系統字，不收。
- ⚠ OFL 保留字型名稱：「open huninn」「huninn」與「Varela」「Varela Round」。裁子集＝修改版，
  字型內部名稱改成「PP Round」，版權（nameID 0）與授權（13、14）原樣保留；CSS 用 font-family PPRound。
"""
import re
import sys
from html.parser import HTMLParser
from pathlib import Path

from fontTools import subset
from fontTools.ttLib import TTFont

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "vendor" / "round-ui" / "pp-round.woff2"
FAMILY = "PP Round"
PS = "PPRound-Regular"
RESERVED = re.compile(r"huninn|varela", re.I)
NAME_FIELDS = {1, 3, 4, 6, 16, 17, 18, 20, 21, 22}

TAGS = {"h1", "h2", "h3", "h4", "button", "dt", "dd"}
CLASSES = {"pp-bar", "nav", "pp-top", "day-group", "day-date", "day-num", "tl-time", "section-label", "chevron"}
VOID = {"img", "br", "input", "meta", "link", "hr", "source", "use", "path", "circle", "wbr", "col", "area", "base", "embed", "param", "track"}
# JS 動態寫進畫面、且用圓體顯示的字
EXTRA = "打開今天的行程：回顧行程：從開始開始看行程：今天旅程第天已完成項出發日必去"


class Collect(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.stack = []      # 每層是否「在圓體範圍內」
        self.skip = 0        # script/style 內
        self.out = []

    def handle_starttag(self, tag, attrs):
        if tag in ("script", "style"):
            self.skip += 1
            return
        if tag in VOID:
            return
        cls = set((dict(attrs).get("class") or "").split())
        inside = (self.stack[-1] if self.stack else False) or tag in TAGS or bool(cls & CLASSES)
        self.stack.append(inside)

    def handle_endtag(self, tag):
        if tag in ("script", "style"):
            self.skip = max(0, self.skip - 1)
            return
        if tag in VOID:
            return
        if self.stack:
            self.stack.pop()

    def handle_data(self, data):
        if not self.skip and self.stack and self.stack[-1]:
            self.out.append(data)


def wanted(ch: str) -> bool:
    cp = ord(ch)
    return (0x3000 <= cp <= 0x303F or 0x3400 <= cp <= 0x9FFF or 0xFF00 <= cp <= 0xFFEF
            or 0x2010 <= cp <= 0x2027 or ch in "·×→←↑↓…｜–—▼▲")


def chars_needed() -> str:
    keep = {chr(c) for c in range(0x20, 0x7F)}
    c = Collect()
    c.feed((ROOT / "index.html").read_text(encoding="utf-8"))
    text = "".join(c.out) + EXTRA
    if "瑞義行程" not in text or "每日行程" not in text or "住宿郵戳" not in text:
        print("[FAIL] 收字沒收到頁首／分頁／封面，index.html 結構可能變了"); sys.exit(1)
    keep |= {ch for ch in text if wanted(ch)}
    return "".join(sorted(keep))


def main() -> None:
    if len(sys.argv) != 2:
        print(__doc__); sys.exit(2)
    text = chars_needed()
    font = TTFont(sys.argv[1])
    opts = subset.Options()
    opts.flavor = "woff2"
    opts.layout_features = ["*"]
    opts.name_IDs = ["*"]
    opts.notdef_outline = True
    sub = subset.Subsetter(options=opts)
    sub.populate(text=text)
    sub.subset(font)
    name = font["name"]
    for rec in list(name.names):
        if rec.nameID in (1, 16, 21):
            rec.string = FAMILY
        elif rec.nameID in (2, 17, 22):
            rec.string = "Regular"
        elif rec.nameID == 4:
            rec.string = FAMILY + " Regular"
        elif rec.nameID == 6:
            rec.string = PS
        elif rec.nameID == 3:
            rec.string = PS + ";subset-301"
    left = [(r.nameID, r.toUnicode()) for r in name.names
            if r.nameID in NAME_FIELDS and RESERVED.search(r.toUnicode())]
    if left:
        print("[FAIL] name 表仍含保留字型名稱：", left[:5]); sys.exit(1)
    OUT.parent.mkdir(parents=True, exist_ok=True)
    font.flavor = "woff2"
    font.save(OUT)
    cjk = sum(1 for c in text if ord(c) > 0x7F)
    print(f"[OK] {OUT.relative_to(ROOT)}：{OUT.stat().st_size / 1024:.0f} KB，收 {cjk} 個非 ASCII 字＋ASCII")


if __name__ == "__main__":
    main()
