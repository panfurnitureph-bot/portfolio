// SYNC IMAGES — awtomatikong ina-update ang images list ng bawat product.
//
// PAANO GAMITIN:
//   1. Ihulog ang photos sa public/images/products/
//      Pangalan: <slug>-1.jpg, <slug>-2.jpg, <slug>-3.jpg ...
//      (ang <slug> ay ang "slug" ng product sa content/products.json)
//   2. Patakbuhin:  npm run sync-images
//   3. Tapos! Auto-updated na ang products.json — hindi mo na
//      kailangang i-type ang image paths isa-isa.
//
// Tinatanggap: .jpg .jpeg .png .webp .gif .svg

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const PRODUCTS_JSON = path.join(ROOT, "content", "products.json");
const IMG_DIR = path.join(ROOT, "public", "images", "products");
const EXTS = /\.(jpe?g|png|webp|gif|svg)$/i;

const products = JSON.parse(fs.readFileSync(PRODUCTS_JSON, "utf8"));
const files = fs.readdirSync(IMG_DIR).filter((f) => EXTS.test(f));

// I-sort ayon sa numero sa dulo ng filename (slug-1, slug-2, slug-10...)
function numOf(file) {
  const m = file.match(/-(\d+)\.\w+$/);
  return m ? parseInt(m[1], 10) : 999;
}

let changed = 0;
const unclaimed = new Set(files);

for (const p of products) {
  // Lahat ng file na nagsisimula sa "<slug>-" o eksaktong "<slug>.<ext>"
  const mine = files
    .filter((f) => f.startsWith(p.slug + "-") || f.replace(EXTS, "") === p.slug)
    .sort((a, b) => numOf(a) - numOf(b));

  mine.forEach((f) => unclaimed.delete(f));

  if (mine.length === 0) {
    console.log(`⚠ WALANG PHOTO: ${p.slug}`);
    continue;
  }

  const newImages = mine.map((f) => `/images/products/${f}`);
  if (JSON.stringify(newImages) !== JSON.stringify(p.images)) {
    p.images = newImages;
    changed++;
    console.log(`✓ updated: ${p.slug}  (${mine.length} photos)`);
  }
}

// Mga file na walang katugmang product — baka typo sa filename
if (unclaimed.size > 0) {
  console.log("\n⚠ May files na hindi tugma sa kahit anong product slug:");
  for (const f of [...unclaimed].slice(0, 20)) console.log("   " + f);
  console.log("  → I-check ang spelling: dapat <slug>-1.jpg ang format.");
}

fs.writeFileSync(PRODUCTS_JSON, JSON.stringify(products, null, 2));
console.log(`\nTAPOS: ${changed} product(s) na-update. Total products: ${products.length}.`);
