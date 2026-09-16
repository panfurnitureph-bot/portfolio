# MAKE REVIEW CARDS
# Ginagawang branded card ang bawat review photo — iisang format:
# photo sa taas (kurbadong ilalim), PAN logo, quote ng review,
# stars, at "PAN FURNITURE · X★ ON GOOGLE" sa baba.
#
# PAANO:  npm run make-cards
# Lahat ng review sa "Reviews on Google" section na may photo ay
# gagawan ng card at ang card na ang ipapakita sa site.
# (Ang orihinal na photo ay mananatili sa folder — hindi binubura.)

import io
import json
import os
import re
import sys

from PIL import Image, ImageDraw, ImageFont, ImageOps

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
HOMEPAGE = os.path.join(ROOT, "content", "homepage.json")
OUT_DIR = os.path.join(ROOT, "public", "images", "reviews")

W, H = 1080, 1080
PHOTO_H = 600
CREAM = (247, 240, 228)
CREAM_TOP = (252, 248, 240)   # gradient: mapusyaw sa taas ng cream area
CREAM_BOT = (243, 231, 209)   # mainit-init sa ilalim
DARK = (58, 47, 38)
GOLD = (176, 141, 87)
GRAY = (110, 100, 90)

FONTS = "C:/Windows/Fonts"
LOGO_PATH = os.path.join(ROOT, "public", "icon.png")

# Mga salitang bibigyan ng BOLD GOLD emphasis sa quote (tulad ng target
# design: "so durable", "excellent product")
EMPHASIS = {
    "durable", "excellent", "quality", "sturdy", "perfect", "beautiful",
    "ganda", "maganda", "solid", "recommended", "recommend", "satisfied",
    "amazing", "great", "love", "loved", "elegant", "comfortable", "best",
    "matibay", "sulit", "affordable", "premium", "helpful", "smooth",
}


def font(name, size):
    return ImageFont.truetype(os.path.join(FONTS, name), size)


def draw_gradient_cream(card, y_start):
    """Banayad na vertical gradient sa cream section (parang target)."""
    d = ImageDraw.Draw(card)
    hgt = H - y_start
    for i in range(hgt):
        t = i / max(1, hgt - 1)
        c = tuple(int(CREAM_TOP[k] + (CREAM_BOT[k] - CREAM_TOP[k]) * t) for k in range(3))
        d.line([(0, y_start + i), (W, y_start + i)], fill=c)


def paste_logo(card, cx, cy, size=170):
    """Ang TUNAY na PAN logo (public/icon.png) sa gitna ng curve —
    nakapatong sa solidong dark-brown na bilog (para hindi maputla ang
    transparency ng logo), may gold ring; fallback sa drawn logo."""
    d = ImageDraw.Draw(card)
    r = size // 2
    try:
        logo = Image.open(LOGO_PATH).convert("RGBA")
        logo = logo.resize((size, size), Image.LANCZOS)
        # gold ring + solidong dark circle sa likod
        d.ellipse([cx - r - 4, cy - r - 4, cx + r + 4, cy + r + 4], fill=GOLD)
        d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=(74, 55, 40))
        # bilog na mask ∩ sariling alpha ng logo
        circle = Image.new("L", (size, size), 0)
        ImageDraw.Draw(circle).ellipse([0, 0, size, size], fill=255)
        from PIL import ImageChops
        alpha = logo.split()[3]
        mask = ImageChops.multiply(circle, alpha)
        card.paste(logo, (cx - r, cy - r), mask)
        return True
    except Exception:
        # fallback: drawn logo (lumang istilo)
        d.ellipse([cx - r - 5, cy - r - 5, cx + r + 5, cy + r + 5], fill=GOLD)
        d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=(74, 55, 40))
        f_logo = font("georgiab.ttf", 44)
        tw = d.textlength("PAN", font=f_logo)
        d.text((cx - tw / 2, cy - 44), "PAN", font=f_logo, fill=GOLD)
        f_sub = font("arial.ttf", 15)
        tw = d.textlength("FURNITURE", font=f_sub)
        d.text((cx - tw / 2, cy + 20), "FURNITURE", font=f_sub, fill=(235, 228, 215))
        return False


def draw_rich_quote(draw, quote, y, max_width, size=42, max_lines=3):
    """Quote na may BOLD GOLD emphasis sa key words (tulad ng target).
    Nagbabalik ng bagong y pagkatapos ng huling linya."""
    f_norm = font("georgiai.ttf", size)   # italic
    f_bold = font("georgiaz.ttf", size)   # bold italic
    words = quote.split()
    if not words:
        return y
    words[0] = "“" + words[0]
    words[-1] = words[-1] + "”"

    # token = (text, emphasized?)
    def is_emph(w_):
        return re.sub(r"[^a-z]", "", w_.lower()) in EMPHASIS

    tokens = [(w_, is_emph(w_)) for w_ in words]
    space_w = draw.textlength(" ", font=f_norm)

    # i-wrap gamit ang tamang font bawat salita
    lines, line, line_w = [], [], 0
    for tok in tokens:
        f = f_bold if tok[1] else f_norm
        w_px = draw.textlength(tok[0], font=f)
        trial = line_w + (space_w if line else 0) + w_px
        if trial <= max_width or not line:
            line.append(tok)
            line_w = trial
        else:
            lines.append((line, line_w))
            line, line_w = [tok], w_px
    if line:
        lines.append((line, line_w))
    lines = lines[:max_lines]

    for toks, lw in lines:
        x = (W - lw) / 2
        for t_, emph in toks:
            f = f_bold if emph else f_norm
            draw.text((x, y), t_, font=f, fill=GOLD if emph else DARK)
            x += draw.textlength(t_, font=f) + space_w
        y += size + 14
    return y


def clean_text(s):
    # Alisin ang emoji/simbolo na hindi kayang i-render ng font
    s = re.sub(r"[^\x00-\x7FÀ-ɏ’‘“”—–\-]", "", s)
    return re.sub(r"\s+", " ", s).strip()


def wrap(draw, text, fnt, max_width):
    words = text.split()
    lines, line = [], ""
    for w_ in words:
        trial = (line + " " + w_).strip()
        if draw.textlength(trial, font=fnt) <= max_width:
            line = trial
        else:
            if line:
                lines.append(line)
            line = w_
    if line:
        lines.append(line)
    return lines


def spaced(s, gap=" "):
    return gap.join(list(s))


def make_card(photo_path, quote, rating, site_rating, out_path):
    card = Image.new("RGB", (W, H), CREAM)
    draw = ImageDraw.Draw(card)

    # ---------- PHOTO sa taas (mas malaki — 660px, tulad ng target) ----------
    photo = Image.open(photo_path).convert("RGB")
    photo = ImageOps.fit(photo, (W, PHOTO_H), Image.LANCZOS, centering=(0.5, 0.45))
    card.paste(photo, (0, 0))

    # Gradient cream sa ilalim (mapusyaw pataas, mainit pababa)
    draw_gradient_cream(card, PHOTO_H)
    draw = ImageDraw.Draw(card)

    # Kurbadong cream na gilid sa ilalim ng photo (mababaw na arko)
    curve = Image.new("L", (W, H), 0)
    cd = ImageDraw.Draw(curve)
    cd.ellipse([-W * 0.35, PHOTO_H - 70, W * 1.35, PHOTO_H + 500], fill=255)
    cream_layer = Image.new("RGB", (W, H), CREAM_TOP)
    card.paste(cream_layer, (0, 0), curve)
    draw = ImageDraw.Draw(card)

    # ---------- GOLD LINE sa magkabila + TUNAY na LOGO sa gitna ----------
    cx, cy = W // 2, PHOTO_H - 6
    r = 80
    draw.line([(0, cy), (cx - r - 22, cy)], fill=GOLD, width=2)
    draw.line([(cx + r + 22, cy), (W, cy)], fill=GOLD, width=2)
    paste_logo(card, cx, cy, size=2 * r)
    draw = ImageDraw.Draw(card)

    y = cy + r + 30

    # ---------- "CUSTOM MADE" ----------
    f_eyebrow = font("arial.ttf", 26)
    eyebrow = spaced("CUSTOM MADE")
    tw = draw.textlength(eyebrow, font=f_eyebrow)
    draw.text(((W - tw) / 2, y), eyebrow, font=f_eyebrow, fill=GRAY)
    y += 48

    # ---------- QUOTE — may BOLD GOLD emphasis (tulad ng target) ----------
    quote = clean_text(quote)
    if len(quote) > 150:
        quote = quote[:147].rstrip() + "..."
    y = draw_rich_quote(draw, quote, y, W - 150, size=38, max_lines=3)
    # ---------- VERIFIED / STARS / FOOTER — naka-angkla sa ilalim ----------
    f_ver = font("arial.ttf", 23)
    ver = "—  " + spaced("VERIFIED GOOGLE REVIEW")
    tw = draw.textlength(ver, font=f_ver)
    draw.text(((W - tw) / 2, H - 146), ver, font=f_ver, fill=GRAY)

    # Stars — Segoe UI Symbol ang may ★
    f_star = font("seguisym.ttf", 38)
    stars = "  ".join(["★"] * int(rating))
    tw = draw.textlength(stars, font=f_star)
    draw.text(((W - tw) / 2, H - 104), stars, font=f_star, fill=GOLD)

    # Footer — pinaghiwalay para tamang font ang bituin
    f_foot = font("arialbd.ttf", 25)
    left = f"P A N   F U R N I T U R E   ·   {site_rating}"
    right = "   O N   G O O G L E"
    f_fstar = font("seguisym.ttf", 25)
    w1 = draw.textlength(left, font=f_foot)
    w2 = draw.textlength("★", font=f_fstar)
    w3 = draw.textlength(right, font=f_foot)
    x = (W - (w1 + w2 + w3)) / 2
    fy = H - 50
    draw.text((x, fy), left, font=f_foot, fill=DARK)
    draw.text((x + w1, fy - 2), "★", font=f_fstar, fill=GOLD)
    draw.text((x + w1 + w2, fy), right, font=f_foot, fill=DARK)

    card.save(out_path, quality=90)


def make_text_card(quote, rating, site_rating, out_path):
    """Text-only na card — para sa reviews na walang photo, para
    pare-pareho pa rin ang itsura ng lahat sa grid."""
    card = Image.new("RGB", (W, H), CREAM)
    draw = ImageDraw.Draw(card)

    # Logo circle sa itaas-gitna
    cx, cy, r = W // 2, 220, 90
    draw.ellipse([cx - r - 5, cy - r - 5, cx + r + 5, cy + r + 5], fill=GOLD)
    draw.ellipse([cx - r, cy - r, cx + r, cy + r], fill=(74, 55, 40))
    draw.ellipse([cx - r + 8, cy - r + 8, cx + r - 8, cy + r - 8], outline=GOLD, width=2)
    f_logo = font("georgiab.ttf", 50)
    tw = draw.textlength("PAN", font=f_logo)
    draw.text((cx - tw / 2, cy - 50), "PAN", font=f_logo, fill=GOLD)
    f_sub = font("arial.ttf", 17)
    tw = draw.textlength("FURNITURE", font=f_sub)
    draw.line([cx - 55, cy + 16, cx + 55, cy + 16], fill=GOLD, width=1)
    draw.text((cx - tw / 2, cy + 24), "FURNITURE", font=f_sub, fill=(235, 228, 215))

    # CUSTOM MADE
    y = cy + r + 60
    f_eyebrow = font("arial.ttf", 28)
    eyebrow = spaced("CUSTOM MADE")
    tw = draw.textlength(eyebrow, font=f_eyebrow)
    draw.text(((W - tw) / 2, y), eyebrow, font=f_eyebrow, fill=GRAY)
    y += 64

    # Quote — mas maluwag dahil walang photo (hanggang 5 linya)
    quote = clean_text(quote)
    if len(quote) > 240:
        quote = quote[:237].rstrip() + "..."
    f_quote = font("georgiai.ttf", 44)
    lines = wrap(draw, f"“{quote}”", f_quote, W - 180)[:5]
    for line in lines:
        tw = draw.textlength(line, font=f_quote)
        draw.text(((W - tw) / 2, y), line, font=f_quote, fill=DARK)
        y += 60

    # VERIFIED / STARS / FOOTER — parehong anchors sa ilalim
    f_ver = font("arial.ttf", 24)
    ver = "—  " + spaced("VERIFIED GOOGLE REVIEW")
    tw = draw.textlength(ver, font=f_ver)
    draw.text(((W - tw) / 2, H - 198), ver, font=f_ver, fill=GRAY)

    f_star = font("seguisym.ttf", 42)
    stars = "  ".join(["★"] * int(rating))
    tw = draw.textlength(stars, font=f_star)
    draw.text(((W - tw) / 2, H - 148), stars, font=f_star, fill=GOLD)

    f_foot = font("arialbd.ttf", 26)
    left = f"P A N   F U R N I T U R E   ·   {site_rating}"
    right = "   O N   G O O G L E"
    f_fstar = font("seguisym.ttf", 26)
    w1 = draw.textlength(left, font=f_foot)
    w2 = draw.textlength("★", font=f_fstar)
    w3 = draw.textlength(right, font=f_foot)
    x = (W - (w1 + w2 + w3)) / 2
    fy = H - 80
    draw.text((x, fy), left, font=f_foot, fill=DARK)
    draw.text((x + w1, fy - 2), "★", font=f_fstar, fill=GOLD)
    draw.text((x + w1 + w2, fy), right, font=f_foot, fill=DARK)

    card.save(out_path, quality=90)


def slugify(name):
    return re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")


def main():
    redo = "--redo" in sys.argv  # i-regenerate KAHIT may card na (bagong design)
    homepage = json.load(io.open(HOMEPAGE, encoding="utf8"))
    gr = homepage["googleReviews"]
    site_rating = gr.get("rating", 4.8)
    made = 0
    for r in gr["items"]:
        if not r.get("text"):
            continue
        photos = r.get("photos") or []
        # May card na? huwag nang galawin (maliban kung --redo)
        if not redo and photos and all("/card-" in p for p in photos):
            continue
        # gamitin ang orihinal (hindi card) bilang source
        source = next((p for p in photos if "/card-" not in p), None)
        if source:
            src_file = os.path.join(ROOT, "public", source.lstrip("/").replace("/", os.sep))
        else:
            slug = slugify(r["name"])
            matches = [
                f for f in os.listdir(OUT_DIR)
                if f.startswith(slug + "-") and not f.startswith("card-")
                and re.search(r"\.(jpe?g|png|webp)$", f, re.I)
            ]
            src_file = os.path.join(OUT_DIR, sorted(matches)[0]) if matches else None
        card_name = f"card-{slugify(r['name'])}.jpg"
        out = os.path.join(OUT_DIR, card_name)
        if src_file and os.path.exists(src_file):
            # May photo — regular na card na may larawan
            make_card(src_file, r["text"], r.get("rating", 5), site_rating, out)
        else:
            # WALANG photo — text-only branded card para pantay pa rin
            make_text_card(r["text"], r.get("rating", 5), site_rating, out)
        r["photos"] = [f"/images/reviews/{card_name}"]
        made += 1
        print("card:", r["name"])
    io.open(HOMEPAGE, "w", encoding="utf8").write(
        json.dumps(homepage, indent=2, ensure_ascii=False)
    )
    print(f"\nTAPOS: {made} cards ginawa.")


def single():
    """Single-card mode — ginagamit ng admin auto-card on upload.
    Args: --single <photo_abs_path> <reviewer_name> <rating> <quote_text>
    Nagpi-print ng JSON: {"ok": true, "url": "/images/reviews/card-....jpg"}
    """
    import time
    photo_path, name, rating, text = sys.argv[2], sys.argv[3], sys.argv[4], sys.argv[5]
    homepage = json.load(io.open(HOMEPAGE, encoding="utf8"))
    site_rating = homepage["googleReviews"].get("rating", 4.8)
    card_name = f"card-{slugify(name)}-{int(time.time() * 1000)}.jpg"
    out = os.path.join(OUT_DIR, card_name)
    make_card(photo_path, text, int(float(rating)), site_rating, out)
    print(json.dumps({"ok": True, "url": f"/images/reviews/{card_name}"}))


if __name__ == "__main__":
    if len(sys.argv) > 1 and sys.argv[1] == "--single":
        single()
    else:
        main()
