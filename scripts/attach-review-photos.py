# ATTACH REVIEW PHOTOS
# Ikinakabit ang mga photos sa public/images/reviews/ sa tamang review
# batay sa pangalan ng file.
#
# PAANO:
#   1. Kopyahin ang photos sa: public/images/reviews/
#   2. Pangalanan ayon sa reviewer (maliit na letra, gitling):
#        joel-gambala-1.jpg
#        rose-ann-saguid-1.jpg
#   3. Patakbuhin:  npm run attach-photos
#
# Ang bahagi ng filename bago ang huling "-numero" ay imamatch sa
# pangalan ng reviewer sa Reviews on Google section.

import io
import json
import os
import re

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PHOTO_DIR = os.path.join(ROOT, "public", "images", "reviews")
HOMEPAGE = os.path.join(ROOT, "content", "homepage.json")


def slugify(name: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")


def main() -> None:
    if not os.path.isdir(PHOTO_DIR):
        os.makedirs(PHOTO_DIR, exist_ok=True)
        print("Ginawa ang folder:", PHOTO_DIR)
        print("Ilagay doon ang photos, tapos ulitin.")
        return

    files = [
        f for f in os.listdir(PHOTO_DIR)
        if re.search(r"\.(jpe?g|png|webp)$", f, re.I)
    ]
    if not files:
        print("Walang photos sa", PHOTO_DIR)
        return

    homepage = json.load(io.open(HOMEPAGE, encoding="utf8"))
    items = homepage["googleReviews"]["items"]
    by_slug = {slugify(r["name"]): r for r in items}

    attached = 0
    unmatched = []
    for f in sorted(files):
        base = re.sub(r"\.(jpe?g|png|webp)$", "", f, flags=re.I)
        base = re.sub(r"-\d+$", "", base)  # alisin ang -1, -2 sa dulo
        review = by_slug.get(slugify(base))
        if not review:
            # subukang prefix match (hal. "joel" -> "Joel Gambala")
            hits = [r for s, r in by_slug.items() if s.startswith(slugify(base))]
            review = hits[0] if len(hits) == 1 else None
        if not review:
            unmatched.append(f)
            continue
        url = f"/images/reviews/{f}"
        review.setdefault("photos", [])
        if url not in review["photos"]:
            review["photos"].append(url)
            attached += 1
            print(f"OK: {f} -> {review['name']}")

    io.open(HOMEPAGE, "w", encoding="utf8").write(
        json.dumps(homepage, indent=2, ensure_ascii=False)
    )
    print(f"\nTAPOS: {attached} photos ikinabit.")
    if unmatched:
        print("HINDI NA-MATCH (i-check ang spelling ng filename):")
        for f in unmatched:
            print("  -", f)


if __name__ == "__main__":
    main()
