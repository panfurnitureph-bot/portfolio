# IMPORT GOOGLE TAKEOUT REVIEWS
# Ini-import LAHAT ng reviews mula sa Google Takeout export ng
# Google Business Profile papunta sa website.
#
# PAANO:
#   1. Punta sa takeout.google.com (naka-login sa account na may-ari
#      ng PAN Furniture business profile)
#   2. Deselect all -> i-check lang ang "Google Business Profile"
#   3. Export -> download ang ZIP
#   4. Sa loob ng ZIP, hanapin ang reviews file (hal. reviews*.json
#      sa loob ng Google Business Profile folder)
#   5. Kopyahin ang file dito: content/google-takeout-reviews.json
#   6. Patakbuhin:  npm run import-reviews
#
# Ang mga bagong review ay idadagdag sa "Reviews on Google" section.
# May dedupe — hindi madodoble ang mga nandoon na.

import io
import json
import os
import sys
from datetime import datetime

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "content", "google-takeout-reviews.json")
HOMEPAGE = os.path.join(ROOT, "content", "homepage.json")

STAR_MAP = {"ONE": 1, "TWO": 2, "THREE": 3, "FOUR": 4, "FIVE": 5}


def parse_date(s):
    try:
        dt = datetime.fromisoformat(str(s).replace("Z", "+00:00"))
        return dt.strftime("%B %d, %Y")
    except Exception:
        return str(s) if s else ""


def normalize(entry):
    """Suportado ang Takeout format at pati simpleng format."""
    # Takeout GBP format
    name = (
        (entry.get("reviewer") or {}).get("displayName")
        or entry.get("name")
        or entry.get("author")
        or "Google user"
    )
    rating = entry.get("starRating") or entry.get("rating") or 5
    if isinstance(rating, str):
        rating = STAR_MAP.get(rating.upper(), 5)
    text = entry.get("comment") or entry.get("text") or ""
    date = parse_date(entry.get("createTime") or entry.get("date") or "")
    return {
        "name": str(name)[:60],
        "rating": int(rating),
        "date": date,
        "text": str(text).strip(),
        "photos": [],
        "product": "",
    }


def main():
    if not os.path.exists(SRC):
        print("HINDI NAHANAP:", SRC)
        print("Ilagay muna ang Takeout reviews file doon, tapos ulitin.")
        sys.exit(1)

    raw = json.load(io.open(SRC, encoding="utf8"))
    # Ang Takeout ay minsan {"reviews": [...]}, minsan list mismo
    entries = raw.get("reviews", raw) if isinstance(raw, dict) else raw
    if not isinstance(entries, list):
        print("Hindi makilala ang format ng file.")
        sys.exit(1)

    reviews = [normalize(e) for e in entries]
    reviews = [r for r in reviews if r["text"]]  # laktawan ang rating-only

    homepage = json.load(io.open(HOMEPAGE, encoding="utf8"))
    existing = homepage["googleReviews"]["items"]
    seen = {(r["name"], r["text"][:80]) for r in existing}

    added = 0
    for r in reviews:
        key = (r["name"], r["text"][:80])
        if key in seen:
            continue
        existing.append(r)
        seen.add(key)
        added += 1

    io.open(HOMEPAGE, "w", encoding="utf8").write(
        json.dumps(homepage, indent=2, ensure_ascii=False)
    )
    print(f"TAPOS: {added} bagong reviews na-import ({len(reviews)} sa file, "
          f"{len(existing)} na kabuuan sa site).")


if __name__ == "__main__":
    main()
