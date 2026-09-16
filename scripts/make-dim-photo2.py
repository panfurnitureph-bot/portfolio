# Dimension image v2 — GINAGAMIT ANG BUONG PHOTO (walang cutout kaya
# hindi naputol ang headboard) + measurement arrows sa gilid.
# Auto-detect ng gilid ng furniture via edge/contrast para tumpak ang
# posisyon ng arrows.
import sys, os, math
from PIL import Image, ImageOps, ImageDraw, ImageFont, ImageFilter

SITE = r"c:/Users/techj/Documents/GitHub/Website"
src_rel, out_rel = sys.argv[1], sys.argv[2]
W_in = sys.argv[3] if len(sys.argv) > 3 else '75.5"'
H_in = sys.argv[4] if len(sys.argv) > 4 else '40"'
D_in = sys.argv[5] if len(sys.argv) > 5 else '2"'

orig = Image.open(os.path.join(SITE, "public", src_rel.lstrip("/"))).convert("RGB")

# I-fit sa canvas na may margin para sa labels
PAD_L, PAD_B, PAD_R, PAD_T = 120, 90, 90, 40
maxw, maxh = 720, 560
ow, oh = orig.size
scale = min(maxw / ow, maxh / oh)
photo = orig.resize((int(ow * scale), int(oh * scale)), Image.LANCZOS)
pw, ph = photo.size
CW, CH = pw + PAD_L + PAD_R, ph + PAD_T + PAD_B
canvas = Image.new("RGB", (CW, CH), "white")
px, py = PAD_L, PAD_T
canvas.paste(photo, (px, py))

# Auto-detect ng bounding box ng furniture: edge map, hanapin ang
# region na malayo sa plain background
gray = photo.convert("L")
edges = gray.filter(ImageFilter.FIND_EDGES).point(lambda v: 255 if v > 30 else 0)
bbox = edges.getbbox()
if bbox:
    fx0, fy0, fx1, fy1 = [int(v) for v in bbox]
else:
    fx0, fy0, fx1, fy1 = 0, 0, pw, ph
# i-offset sa canvas coords, konting margin
fx0 += px; fy0 += py; fx1 += px; fy1 += py

d = ImageDraw.Draw(canvas)
GRAY = (80, 76, 70)
try:
    f = ImageFont.truetype("C:/Windows/Fonts/arialbd.ttf", 26)
except Exception:
    f = ImageFont.load_default()

def arrow(p1, p2):
    d.line([p1, p2], fill=GRAY, width=2)
    ang = math.atan2(p2[1]-p1[1], p2[0]-p1[0])
    for end, a in [(p1, ang), (p2, ang+math.pi)]:
        for da in (0.45, -0.45):
            d.line([end, (end[0]-13*math.cos(a-da), end[1]-13*math.sin(a-da))], fill=GRAY, width=2)

def tick(a, b):
    d.line([a, b], fill=GRAY, width=1)

def label(cx, cy, t):
    tw = d.textlength(t, font=f)
    d.rectangle([cx-tw/2-6, cy-16, cx+tw/2+6, cy+16], fill="white")
    d.text((cx-tw/2, cy-13), t, fill=GRAY, font=f)

# WIDTH — sa ilalim
wy = fy1 + 42
tick((fx0, fy1), (fx0, wy+8)); tick((fx1, fy1), (fx1, wy+8))
arrow((fx0, wy), (fx1, wy)); label((fx0+fx1)//2, wy, W_in)

# HEIGHT — sa kaliwa
hx = fx0 - 50
tick((fx0, fy0), (hx-8, fy0)); tick((fx0, fy1), (hx-8, fy1))
arrow((hx, fy0), (hx, fy1)); label(hx, (fy0+fy1)//2, H_in)

# CLEARANCE — kanan, ilalim
cx = fx1 + 30
arrow((cx, int(fy0+(fy1-fy0)*0.78)), (cx, fy1)); label(cx+22, int(fy0+(fy1-fy0)*0.9), D_in)

canvas.save(os.path.join(SITE, "public", out_rel.lstrip("/")), quality=92)
import json
print(json.dumps({"ok": True, "url": "/" + out_rel.lstrip("/")}))
