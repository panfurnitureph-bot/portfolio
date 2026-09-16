#!/bin/sh
# Gumagawa ng placeholder SVG images para sa lahat ng products at sections.
# Patakbuhin ulit kung magdadagdag ka ng bagong product: sh scripts/make-placeholders.sh
set -e
mkdir -p public/images/products

svg() {
  # $1 = filepath, $2 = label, $3 = bg color, $4 = width, $5 = height
  cat > "$1" <<EOF
<svg xmlns="http://www.w3.org/2000/svg" width="$4" height="$5" viewBox="0 0 $4 $5">
  <rect width="$4" height="$5" fill="$3"/>
  <rect x="24" y="24" width="$(($4 - 48))" height="$(($5 - 48))" fill="none" stroke="#B87333" stroke-width="2" stroke-dasharray="8 6"/>
  <text x="50%" y="47%" font-family="Helvetica,Arial,sans-serif" font-size="34" font-weight="bold" fill="#1A1A1A" text-anchor="middle">$2</text>
  <text x="50%" y="55%" font-family="Helvetica,Arial,sans-serif" font-size="18" fill="#B87333" text-anchor="middle">Palitan ang larawang ito</text>
</svg>
EOF
}

# --- Product images (2 bawat product) ---
i=0
for slug in \
  essex-leather-sofa napa-leather-sofa burrard-velvet-sofa goodwin-sofa inga-sofa \
  essex-sectional napa-modular-sectional milton-sofa-bed paley-accent-chair kinsey-lounge-chair \
  linden-counter-stool adler-dining-table harvest-oak-dining-table sedona-dining-chair weave-dining-chair \
  marlow-bed-frame cove-nightstand haven-sideboard aria-marble-side-table mira-outdoor-sofa \
  tides-outdoor-lounge-chair halo-floor-lamp sonora-wool-rug lena-writing-desk otto-office-chair
do
  case $((i % 4)) in
    0) bg="#E8DFD3" ;;
    1) bg="#DCD3C4" ;;
    2) bg="#E4DACC" ;;
    3) bg="#EFE8DE" ;;
  esac
  label=$(echo "$slug" | tr '-' ' ')
  svg "public/images/products/${slug}-1.svg" "$label" "$bg" 1200 900
  svg "public/images/products/${slug}-2.svg" "$label (detail)" "$bg" 1200 900
  i=$((i + 1))
done

# --- Hero at feature images ---
svg "public/images/hero-main.svg" "HERO — Cognac Tan Leather Sofa" "#D9C7B2" 2000 1100
svg "public/images/feature-leather.svg" "Signature Leather" "#D4BEA5" 1400 1000
svg "public/images/feature-pets.svg" "Pet-Friendly Furniture" "#E0D6C8" 1400 1000
svg "public/images/feature-outdoor.svg" "Outdoor Year-Round" "#CBD2C6" 1400 1000

# --- Category tiles (13) ---
for cat in sofas outdoor bedroom storage sectionals dining-chairs sofa-beds accent-chairs stools dining-tables accent-tables lighting decor; do
  label=$(echo "$cat" | tr '-' ' ')
  svg "public/images/category-${cat}.svg" "$label" "#E8DFD3" 800 800
done

echo "OK: placeholder images generated."
