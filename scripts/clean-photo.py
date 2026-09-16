# clean-photo.py — auto-linis ng ISANG product photo.
#
# Kaya ng tool na ito (TUNAY na gumagana):
#   1. Alisin ang background (rembg) -> malinis na cutout
#   2. white bg  -> product shot (parang P&B)
#   3. beige bg  -> homepage-tile / lifestyle look
#   4. headboard crop -> close-up ng itaas (para may ibang "view")
#
# HINDI kaya: bagong 3D angle (side/back). Walang data ng likod sa isang photo.
#
# Usage:  python scripts/clean-photo.py <input-abs> <out-dir-abs> <slug> [mode]
#   mode = "cutout" (default) -> alis bg: white/beige/closeup
#   mode = "room"             -> PANATILIHIN ang room, gumawa ng crops:
#                                 wide / center / closeup (iba't ibang framing)
# Output (huling linya): JSON {"ok":true,"urls":{...}} na may /images/... paths.

import sys, io, os, json

def die(msg):
    print(json.dumps({"ok": False, "error": msg[:250]}))
    sys.exit(0)

try:
    from PIL import Image, ImageFilter
    from rembg import remove
except Exception as e:
    die("Missing libs: " + str(e))


def cutout(path):
    raw = open(path, "rb").read()
    out = remove(raw)  # PNG na may alpha
    im = Image.open(io.BytesIO(out)).convert("RGBA")
    bbox = im.getbbox()
    return im.crop(bbox) if bbox else im


def on_bg(im, bg_rgb, canvas=1200, pad=0.09):
    w, h = im.size
    scale = (canvas * (1 - 2 * pad)) / max(w, h)
    im = im.resize((max(1, int(w * scale)), max(1, int(h * scale))), Image.LANCZOS)
    bg = Image.new("RGBA", (canvas, canvas), (*bg_rgb, 255))
    x = (canvas - im.width) // 2
    y = (canvas - im.height) // 2
    # malambot na shadow
    sh = Image.new("RGBA", (canvas, canvas), (0, 0, 0, 0))
    a = im.split()[3].point(lambda p: int(p * 0.28))
    sh.paste((0, 0, 0, 255), (x + 6, y + 16), a)
    sh = sh.filter(ImageFilter.GaussianBlur(16))
    bg = Image.alpha_composite(bg, sh)
    bg.paste(im, (x, y), im)
    return bg.convert("RGB")


def headboard_crop(im, bg_rgb, canvas=1200):
    # itaas na bahagi lang (headboard) -> square close-up
    w, h = im.size
    crop = im.crop((0, 0, w, int(h * 0.55)))
    return on_bg(crop, bg_rgb, canvas, pad=0.06)


# ---- ROOM MODE: panatilihin ang buong room, iba-iba lang framing ----
def square_fit(im, canvas=1200):
    # center-fit sa square na may pambura na blur ng gilid (di na-crop mahigpit)
    im = im.convert("RGB")
    w, h = im.size
    scale = canvas / max(w, h)
    im2 = im.resize((int(w * scale), int(h * scale)), Image.LANCZOS)
    # blurred fill bg mula sa mismong photo
    bgs = im.resize((canvas, canvas), Image.LANCZOS).filter(ImageFilter.GaussianBlur(30))
    x = (canvas - im2.width) // 2
    y = (canvas - im2.height) // 2
    bgs.paste(im2, (x, y))
    return bgs


def room_crop(im, box, canvas=1200):
    # box = (l,t,r,b) bilang fraction 0..1
    w, h = im.size
    l, t, r, b = box
    crop = im.crop((int(w * l), int(h * t), int(w * r), int(h * b)))
    return square_fit(crop, canvas)


def main():
    if len(sys.argv) < 4:
        die("usage: clean-photo.py <input> <outdir> <slug> [mode]")
    inp, outdir, slug = sys.argv[1], sys.argv[2], sys.argv[3]
    mode = sys.argv[4] if len(sys.argv) > 4 else "cutout"
    if not os.path.exists(inp):
        die("input not found: " + inp)
    os.makedirs(outdir, exist_ok=True)

    if mode == "room":
        im = Image.open(inp).convert("RGB")
        variants = {
            "room-wide": square_fit(im),                       # buong room, square
            "room-center": room_crop(im, (0.10, 0.05, 0.95, 0.98)),  # bahagyang lapit
            "room-closeup": room_crop(im, (0.18, 0.30, 0.90, 1.0)),  # kama close-up
        }
    else:
        cut = cutout(inp)
        BEIGE = (238, 230, 218)  # P&B sand
        variants = {
            "white": on_bg(cut, (255, 255, 255)),
            "beige": on_bg(cut, BEIGE),
            "closeup": headboard_crop(cut, (255, 255, 255)),
        }

    urls = {}
    for name, im2 in variants.items():
        fn = f"{slug}-clean-{name}.jpg"
        im2.save(os.path.join(outdir, fn), quality=90)
        urls[name] = "/images/products/" + fn
    print(json.dumps({"ok": True, "urls": urls}))


if __name__ == "__main__":
    main()
