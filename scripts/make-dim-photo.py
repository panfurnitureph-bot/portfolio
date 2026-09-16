# Actual product photo + measurement arrows/labels sa gilid
# (kagaya ng Genoa dimension image — totoong photo, hindi outline).
import sys, os, math
from PIL import Image, ImageOps, ImageDraw, ImageFont
from rembg import remove, new_session

SITE = r"c:/Users/techj/Documents/GitHub/Website"
src_rel, out_rel = sys.argv[1], sys.argv[2]
W_in = sys.argv[3] if len(sys.argv) > 3 else '75.5"'   # width label
H_in = sys.argv[4] if len(sys.argv) > 4 else '40"'     # height label
D_in = sys.argv[5] if len(sys.argv) > 5 else '2"'      # clearance/base

orig = Image.open(os.path.join(SITE, "public", src_rel.lstrip("/"))).convert("RGB")

# Cutout para malinis na maibukod ang bed sa background, ilagay sa
# puting canvas (kagaya ng Genoa — puting bg + bed + measurements)
session = new_session("isnet-general-use")
cut = remove(orig, session=session)  # RGBA

# Canvas na may margin para sa labels
PAD = 130
bw, bh = cut.size
scale = min(760 / bw, 500 / bh)
cut = cut.resize((int(bw*scale), int(bh*scale)), Image.LANCZOS)
bw, bh = cut.size
CW, CH = bw + PAD*2, bh + PAD
canvas = Image.new("RGB", (CW, CH), "white")
canvas.paste(cut, (PAD, 30), cut)

d = ImageDraw.Draw(canvas)
GRAY = (90, 85, 78)
try:
    f = ImageFont.truetype("C:/Windows/Fonts/arialbd.ttf", 26)
except Exception:
    f = ImageFont.load_default()

alpha = cut.split()[3]
bbox = alpha.getbbox()
x0, y0, x1, y1 = [v + off for v, off in zip(bbox, (PAD, 30, PAD, 30))]

def arrow(p1, p2):
    d.line([p1, p2], fill=GRAY, width=2)
    ang = math.atan2(p2[1]-p1[1], p2[0]-p1[0])
    for end, a in [(p1, ang), (p2, ang+math.pi)]:
        for da in (0.45, -0.45):
            d.line([end, (end[0]-13*math.cos(a-da), end[1]-13*math.sin(a-da))], fill=GRAY, width=2)

def tick(x1_, y1_, x2_, y2_):
    d.line([(x1_, y1_), (x2_, y2_)], fill=GRAY, width=1)

def label(cx, cy, t):
    tw = d.textlength(t, font=f)
    # puting kahon sa likod para mabasa
    d.rectangle([cx-tw/2-6, cy-16, cx+tw/2+6, cy+16], fill="white")
    d.text((cx-tw/2, cy-13), t, fill=GRAY, font=f)

# WIDTH — sa ilalim ng bed
wy = y1 + 45
tick(x0, y1, x0, wy+8); tick(x1, y1, x1, wy+8)
arrow((x0, wy), (x1, wy)); label((x0+x1)//2, wy, W_in)

# HEIGHT — sa kaliwa
hx = x0 - 55
tick(x0, y0, hx-8, y0); tick(x0, y1, hx-8, y1)
arrow((hx, y0), (hx, y1)); label(hx, (y0+y1)//2, H_in)

# CLEARANCE/BASE — maliit, kanang-baba
by = y1
arrow((x1+18, int(y0+(y1-y0)*0.78)), (x1+18, y1)); label(x1+42, int(y0+(y1-y0)*0.9), D_in)

canvas.save(os.path.join(SITE, "public", out_rel.lstrip("/")), quality=92)
import json; print(json.dumps({"ok": True, "url": "/" + out_rel.lstrip("/")}))
