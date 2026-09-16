# make-angles.py — 1 photo -> maraming "angle" preview.
#
# PAALALA: HINDI ito tunay na 3D re-angle. Wala tayong likod/gilid na data
# ng object. Ang ginagawa: cutout (rembg) tapos perspective-warp (skew) para
# mag-mukhang tinitingnan mula gilid. Fake-3/4 lang — flat photo na kiniling.
# Test kung katanggap-tanggap; kung sira, kailangan tunay na photos per angle.
#
# Usage: python scripts/make-angles.py <input.jpg> <out-prefix>
#   -> <out-prefix>-front.png, -3q-left.png, -3q-right.png, -side.png (white bg)

import sys, io
from PIL import Image, ImageFilter, ImageOps

def load_cutout(path):
    from rembg import remove
    raw = open(path, "rb").read()
    out = remove(raw)  # PNG bytes na may alpha
    return Image.open(io.BytesIO(out)).convert("RGBA")

def trim_alpha(im):
    bbox = im.getbbox()
    return im.crop(bbox) if bbox else im

def perspective_coeffs(src, dst):
    # src/dst = 4 corner points (TL,TR,BR,BL). Solve para sa PIL QUAD/PERSPECTIVE.
    import numpy as np
    A = []
    for (x, y), (X, Y) in zip(dst, src):
        A.append([x, y, 1, 0, 0, 0, -X * x, -X * y])
        A.append([0, 0, 0, x, y, 1, -Y * x, -Y * y])
    A = np.array(A, dtype=float)
    B = np.array([c for pt in src for c in pt], dtype=float)
    res = np.linalg.solve(A, B)
    return res.tolist()

def warp(im, amount, direction):
    # amount 0..0.35 = lakas ng skew. direction: 'left'/'right'/'side'
    w, h = im.size
    dx = int(w * amount)
    dy = int(h * amount * 0.5)
    if direction == "left":
        # kaliwang gilid palapit (parang lumihis pakaliwa)
        dst = [(dx, dy), (w, 0), (w, h), (dx, h - dy)]
    elif direction == "right":
        dst = [(0, 0), (w - dx, dy), (w - dx, h - dy), (0, h)]
    else:  # side = mas malakas
        dst = [(int(w * 0.35), int(h * 0.08)), (w, 0), (w, h), (int(w * 0.35), h)]
    src = [(0, 0), (w, 0), (w, h), (0, h)]
    coeffs = perspective_coeffs(src, dst)
    return im.transform((w, h), Image.PERSPECTIVE, coeffs, Image.BICUBIC)

def on_white(im, pad=0.10, canvas=1200):
    im = trim_alpha(im)
    # shadow mula sa alpha
    w, h = im.size
    scale = (canvas * (1 - 2 * pad)) / max(w, h)
    im = im.resize((max(1, int(w * scale)), max(1, int(h * scale))), Image.LANCZOS)
    bg = Image.new("RGBA", (canvas, canvas), (255, 255, 255, 255))
    x = (canvas - im.width) // 2
    y = (canvas - im.height) // 2
    # soft shadow
    sh = Image.new("RGBA", (canvas, canvas), (0, 0, 0, 0))
    a = im.split()[3].point(lambda p: int(p * 0.30))
    sh.paste((0, 0, 0, 255), (x + 8, y + 18), a)
    sh = sh.filter(ImageFilter.GaussianBlur(14))
    bg = Image.alpha_composite(bg, sh)
    bg.paste(im, (x, y), im)
    return bg.convert("RGB")

def main():
    inp, prefix = sys.argv[1], sys.argv[2]
    cut = load_cutout(inp)
    variants = {
        "front": cut,
        "3q-left": warp(cut, 0.14, "left"),
        "3q-right": warp(cut, 0.14, "right"),
        "side": warp(cut, 0.28, "side"),
    }
    for name, im in variants.items():
        out = f"{prefix}-{name}.png"
        on_white(im).save(out)
        print("saved", out)

if __name__ == "__main__":
    main()
