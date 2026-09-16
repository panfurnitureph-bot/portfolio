# recolor-fabric.py — palitan ang KULAY ng tela ng furniture sa isang photo.
#
# Paraan (para di masira ang liwanag/anino/tela texture):
#   1. rembg -> cutout (para tela lang, di apektado ang bg)
#   2. i-convert sa LAB/HSV, panatilihin ang LIGHTNESS (anino, highlight, weave)
#   3. palitan lang ang HUE + SATURATION papunta sa target color
# Resulta: parehong kama, ibang kulay ng tela — realistic pa rin ang lambot.
#
# HINDI ito bagong angle. Recolor lang. Isang shot -> maraming kulay.
#
# Usage:
#   python scripts/recolor-fabric.py <input-abs> <out-dir> <slug> <spec> [spec ...]
#   spec = "name|hex|#RRGGBB"  o  "name|swatch|<abs-path-ng-swatch.jpg>"
#     - hex    : direktang kulay
#     - swatch : kukunin ang average color ng swatch texture (para tumugma
#                sa aktwal na tela na napili ng customer)
# Output (huling linya): JSON {"ok":true,"variants":[{"name","hex","url"},...]}

import sys, io, os, json

def die(msg):
    print(json.dumps({"ok": False, "error": str(msg)[:250]})); sys.exit(0)

try:
    import numpy as np
    from PIL import Image, ImageFilter
    from rembg import remove
    import colorsys
except Exception as e:
    die("Missing libs: " + str(e))


def hex_to_rgb(h):
    h = h.lstrip("#")
    return tuple(int(h[i:i+2], 16) for i in (0, 2, 4))


def cutout(path):
    raw = open(path, "rb").read()
    im = Image.open(io.BytesIO(remove(raw))).convert("RGBA")
    return im


def grabcut_mask(path, seeds):
    """Segment ang tela gamit GrabCut. seeds = listahan ng (x,y) fraction 0..1
    kung saan nag-click ang admin (siguradong TELA). Sinasama ang rembg mask
    bilang karagdagang foreground hint. Malinis ang hangganan (edge-aware),
    kaya di kumakalat sa sahig/dingding kahit magkatulad ang kulay."""
    import cv2
    orig = Image.open(path).convert("RGB")
    W, H = orig.size
    img = cv2.cvtColor(np.asarray(orig), cv2.COLOR_RGB2BGR)

    # simula: lahat "probably background"
    gc = np.full((H, W), cv2.GC_PR_BGD, np.uint8)

    # rembg mask -> probable foreground (kama base madalas nakukuha nito)
    try:
        raw = open(path, "rb").read()
        cut = Image.open(io.BytesIO(remove(raw))).convert("RGBA")
        if cut.size != (W, H):
            cut = cut.resize((W, H), Image.LANCZOS)
        a = np.asarray(cut.split()[3])
        gc[a > 180] = cv2.GC_PR_FGD
    except Exception:
        pass

    # seed clicks -> SIGURADONG foreground (malaking bilog kada click)
    r = max(12, int(min(W, H) * 0.03))
    for (fx, fy) in seeds:
        cx, cy = int(fx * W), int(fy * H)
        cv2.circle(gc, (cx, cy), r, int(cv2.GC_FGD), -1)

    # kung walang sapat na FG, sumuko
    if (gc == cv2.GC_FGD).sum() < 10 and (gc == cv2.GC_PR_FGD).sum() < 100:
        return orig, Image.new("L", (W, H), 0)

    bgdModel = np.zeros((1, 65), np.float64)
    fgdModel = np.zeros((1, 65), np.float64)
    try:
        cv2.grabCut(img, gc, None, bgdModel, fgdModel, 5, cv2.GC_INIT_WITH_MASK)
    except Exception as e:
        die("grabcut failed: " + str(e))

    m = np.where((gc == cv2.GC_FGD) | (gc == cv2.GC_PR_FGD), 255, 0).astype(np.uint8)
    # linisin: sarhan butas, alisin maliliit na tuldok
    m = cv2.morphologyEx(m, cv2.MORPH_CLOSE, np.ones((7, 7), np.uint8))
    m = cv2.morphologyEx(m, cv2.MORPH_OPEN, np.ones((5, 5), np.uint8))
    mask = Image.fromarray(m, "L").filter(ImageFilter.GaussianBlur(1.5))
    return orig, mask


def object_mask(path, expand=False):
    """Alpha mask ng furniture (0..255) + original RGB na buo (walang alis bg).
    Kung expand=True, palawakin ang mask papunta sa magkakatabing pixels na
    KATULAD ng kulay ng tela — para makuha ang upholstered wall panel na
    kadikit sa kama (na kadalasang di nakukuha ng rembg)."""
    raw = open(path, "rb").read()
    cut = Image.open(io.BytesIO(remove(raw))).convert("RGBA")
    orig = Image.open(path).convert("RGB")
    if cut.size != orig.size:
        cut = cut.resize(orig.size, Image.LANCZOS)
    mask = cut.split()[3]
    if not expand:
        return orig, mask

    arr = np.asarray(orig).astype(np.float32)
    m = np.asarray(mask).astype(np.float32) / 255.0

    # 1) Kunin ang katangian (avg color) ng TELA — mula sa matibay na loob
    #    ng rembg mask (alpha > 0.7), pero iwas ang kutson/kobre (madalas puti).
    strong = m > 0.7
    if strong.sum() < 50:
        return orig, mask
    fabric_px = arr[strong]
    # tanggalin ang sobrang liwanag (kobre/kumot) gamit percentile
    lum = fabric_px.mean(1)
    keep = lum < np.percentile(lum, 75)
    ref = fabric_px[keep].mean(0) if keep.sum() > 20 else fabric_px.mean(0)

    # 2) Similarity map: gaano kalapit bawat pixel sa kulay ng tela
    dist = np.sqrt(((arr - ref) ** 2).sum(-1))
    sim = dist < 55.0  # tolerance — mas mataas = mas malawak (baka masama dingding)

    # 3) Panatilihin lang ang similar area na KONEKTADO sa orig mask
    #    (para di masama ang malayong bahagi ng dingding na parehong kulay).
    try:
        from scipy import ndimage
        seed = m > 0.5
        lbl, _ = ndimage.label(sim)
        keep_labels = set(np.unique(lbl[seed])) - {0}
        connected = np.isin(lbl, list(keep_labels))
    except Exception:
        # walang scipy — gamitin ang buong similarity map (mas malawak)
        connected = sim

    final = np.maximum(m, connected.astype(np.float32))
    final_img = Image.fromarray((final * 255).astype(np.uint8), "L")
    final_img = final_img.filter(ImageFilter.MaxFilter(5))  # sarhan maliliit na butas
    final_img = final_img.filter(ImageFilter.GaussianBlur(1.5))
    return orig, final_img


def avg_color(path):
    """Dominant/average color ng isang swatch texture image."""
    im = Image.open(path).convert("RGB")
    # gitna lang (iwas puting gilid/border)
    w, h = im.size
    im = im.crop((int(w*0.2), int(h*0.2), int(w*0.8), int(h*0.8)))
    arr = np.asarray(im).reshape(-1, 3)
    return tuple(int(c) for c in arr.mean(0))


def recolor(cut, target_rgb):
    """Palitan ang hue/sat ng may-laman na pixels papunta sa target,
    panatilihin ang lightness (para buhay pa rin ang anino/highlight)."""
    arr = np.asarray(cut).astype(np.float32) / 255.0
    rgb = arr[..., :3]
    alpha = arr[..., 3]

    # RGB -> HSV (vectorized)
    mx = rgb.max(-1); mn = rgb.min(-1); df = mx - mn + 1e-6
    v = mx
    s = df / (mx + 1e-6)
    # hue
    r, g, b = rgb[..., 0], rgb[..., 1], rgb[..., 2]
    h = np.zeros_like(v)
    mask = mx == r; h[mask] = ((g - b) / df)[mask] % 6
    mask = mx == g; h[mask] = ((b - r) / df + 2)[mask]
    mask = mx == b; h[mask] = ((r - g) / df + 4)[mask]
    h = h / 6.0

    # target hue/sat mula sa target color
    tr, tg, tb = [c / 255.0 for c in target_rgb]
    th, ts, tv = colorsys.rgb_to_hsv(tr, tg, tb)

    # Panatilihin ang V (lightness/anino) ng orig; kunin H mula target;
    # S = pagsamahin (mas maraming target para malinaw ang kulay).
    new_h = np.full_like(h, th)
    new_s = np.clip(s * 0.35 + ts * 0.75, 0, 1)
    # bahagyang i-adjust ang V papunta sa lightness ng target (para tumugma tono)
    new_v = np.clip(v * (0.55 + 0.55 * tv), 0, 1)

    # HSV -> RGB (vectorized)
    i = np.floor(new_h * 6).astype(int) % 6
    f = new_h * 6 - np.floor(new_h * 6)
    p = new_v * (1 - new_s)
    q = new_v * (1 - f * new_s)
    t = new_v * (1 - (1 - f) * new_s)
    out = np.zeros_like(rgb)
    for idx, (R, G, B) in enumerate([(new_v, t, p), (q, new_v, p), (p, new_v, t),
                                     (p, q, new_v), (t, p, new_v), (new_v, p, q)]):
        m = i == idx
        out[..., 0][m] = R[m]; out[..., 1][m] = G[m]; out[..., 2][m] = B[m]

    res = np.dstack([out, alpha]) * 255.0
    return Image.fromarray(res.astype(np.uint8), "RGBA")


def recolor_keep_bg(orig_rgb, mask, target_rgb):
    """Recolor ang tela LANG (nasa loob ng mask), panatilihin ang buong
    background 100%. Idinidikit pabalik sa original photo gamit ang mask."""
    # gawing RGBA ang buong orig (full opaque) para ma-recolor lahat
    full = orig_rgb.convert("RGBA")
    recolored = recolor(full, target_rgb).convert("RGB")
    # feather ang mask para malambot ang gilid (iwas hiwa)
    m = mask.filter(ImageFilter.GaussianBlur(1.5))
    # ilagay ang recolored SA IBABAW ng original, tanging sa loob ng mask
    out = Image.composite(recolored, orig_rgb, m)
    return out


def on_white(im, canvas=1200, pad=0.08):
    bbox = im.getbbox()
    if bbox: im = im.crop(bbox)
    w, h = im.size
    scale = (canvas * (1 - 2 * pad)) / max(w, h)
    im = im.resize((int(w*scale), int(h*scale)), Image.LANCZOS)
    bg = Image.new("RGBA", (canvas, canvas), (255,255,255,255))
    x = (canvas-im.width)//2; y = (canvas-im.height)//2
    sh = Image.new("RGBA", (canvas, canvas), (0,0,0,0))
    a = im.split()[3].point(lambda p: int(p*0.28))
    sh.paste((0,0,0,255), (x+6,y+16), a); sh = sh.filter(ImageFilter.GaussianBlur(16))
    bg = Image.alpha_composite(bg, sh); bg.paste(im, (x,y), im)
    return bg.convert("RGB")


def main():
    # bgmode: "keepbg" (panatilihin ang orig background 100%) o "white" (cutout)
    if len(sys.argv) < 6:
        die("usage: recolor-fabric.py <input> <outdir> <slug> <bgmode> <spec>...")
    inp, outdir, slug, bgmode = sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4]
    specs = sys.argv[5:]
    if not os.path.exists(inp): die("input not found")
    os.makedirs(outdir, exist_ok=True)

    # bgmode:
    #   "keepbg"       -> kama lang (rembg mask)
    #   "keepbg-wall"  -> kama + wall panel (auto-expand, delikado sa sahig)
    #   "mask:<path>"  -> gamitin ang USER-DRAWN mask (brush) — pinaka-tama
    #   "white"        -> cutout white bg
    keepbg = bgmode.startswith("keepbg") or bgmode.startswith("mask:") or bgmode.startswith("grabcut:")
    if bgmode.startswith("grabcut:"):
        # format: grabcut:x1,y1;x2,y2;...  (fractions 0..1)
        pts = []
        for pair in bgmode[len("grabcut:"):].split(";"):
            if "," in pair:
                a, b = pair.split(",")
                try:
                    pts.append((float(a), float(b)))
                except ValueError:
                    pass
        orig_rgb, mask = grabcut_mask(inp, pts)
    elif bgmode.startswith("mask:"):
        mask_path = bgmode[len("mask:"):]
        if not os.path.exists(mask_path):
            die("mask not found: " + mask_path)
        orig_rgb = Image.open(inp).convert("RGB")
        um = Image.open(mask_path).convert("L")
        if um.size != orig_rgb.size:
            um = um.resize(orig_rgb.size, Image.LANCZOS)
        mask = um.filter(ImageFilter.GaussianBlur(1.5))
    elif keepbg:
        expand = bgmode == "keepbg-wall"
        orig_rgb, mask = object_mask(inp, expand=expand)
    else:
        cut = cutout(inp)

    out = []
    for spec in specs:
        # format: name|kind|value
        parts = spec.split("|")
        if len(parts) < 3:
            continue
        name, kind, value = parts[0].strip(), parts[1].strip(), parts[2].strip()
        try:
            if kind == "swatch":
                if not os.path.exists(value):
                    continue
                rgb = avg_color(value)
            else:  # hex
                rgb = hex_to_rgb(value)
        except Exception:
            continue

        safe = "".join(c if c.isalnum() else "-" for c in name.lower()).strip("-") or "color"
        fn = f"{slug}-color-{safe}.jpg"
        if keepbg:
            img = recolor_keep_bg(orig_rgb, mask, rgb)  # buong bg nananatili
        else:
            img = on_white(recolor(cut, rgb))
        img.save(os.path.join(outdir, fn), quality=90)
        out.append({
            "name": name,
            "hex": "#%02x%02x%02x" % rgb,
            "url": "/images/products/" + fn,
        })
    print(json.dumps({"ok": True, "variants": out}))


if __name__ == "__main__":
    main()
