# POLY_BARK — Furniture Ecommerce Website

Replica ng [polyandbark.com](https://www.polyandbark.com) na gawa sa **Next.js 14 + TypeScript + Tailwind CSS**. Walang Shopify, walang database — lahat ng laman ay nasa mga JSON file na madaling i-edit.

---

## 🚀 Paano Patakbuhin

```bash
npm install     # isang beses lang, sa unang setup
npm run dev     # buksan ang http://localhost:3000
```

Para sa production build:

```bash
npm run build
npm start
```

---

## 📁 Saan Naka-store ang Lahat

| Gusto mong baguhin | I-edit ang file na ito |
|---|---|
| Mga produkto (pangalan, presyo, detalye, reviews) | `content/products.json` |
| Promo banner, hero text, trust badges, contact info | `content/site.json` |
| Mga larawan | `public/images/` |
| Kulay at font ng site | `tailwind.config.ts` |

**HINDI mo kailangan galawin ang code para mag-update ng laman.**

---

## ✏️ Paano Magdagdag ng Bagong Produkto

1. Buksan ang `content/products.json`
2. Kopyahin ang isang buong product block (mula `{` hanggang `}`) at i-paste sa dulo ng listahan (wag kalimutan ang kuwit `,` sa pagitan)
3. Palitan ang mga detalye:

```json
{
  "slug": "bagong-sofa",                    ← unique, walang space, ito ang URL: /products/bagong-sofa
  "name": "Bagong Sofa",                    ← pangalan na makikita ng customer
  "price": 1299,                            ← presyo (numero lang, walang $)
  "compareAtPrice": 1599,                   ← lumang presyo (para sa SALE strikethrough) o null kung walang sale
  "category": "sofas",                      ← isa sa mga category sa ibaba
  "colors": ["Cognac Tan", "Black"],        ← mga available na kulay
  "images": ["/images/products/bagong-sofa-1.jpg", "/images/products/bagong-sofa-2.jpg"],
  "description": "Maikling paglalarawan…",
  "dimensions": "84\" W x 38\" D x 32\" H",
  "materials": "Full-grain leather, hardwood",
  "care": "Punasan ng tuyong tela.",
  "featured": true,                         ← true = lalabas sa homepage "Customer favorites"
  "isNew": true,                            ← true = may NEW badge + kasama sa "New In"
  "reviews": [
    { "author": "Juan D.", "rating": 5, "text": "Ang ganda!" }
  ]
}
```

4. Ilagay ang mga photo sa `public/images/products/` (pangalan dapat tugma sa `images` paths)
5. I-save. Kung tumatakbo ang `npm run dev`, awtomatikong mag-a-update ang site.

**Mga valid na category:** `sofas`, `sectionals`, `sofa-beds`, `accent-chairs`, `accent-tables`, `stools`, `dining-tables`, `dining-chairs`, `bedroom`, `storage`, `outdoor`, `lighting`, `decor`, `workspace`

---

## 🎛️ ADMIN PANEL — Pinakamadaling Paraan Mag-edit (parang WordPress)

May built-in na admin dashboard — **hindi mo na kailangang gumalaw ng code o JSON**:

1. Patakbuhin ang site: `npm run dev`
2. Buksan: **http://localhost:3000/admin**
3. Login — Username: `admin` · Password: `admin123`
   Para palitan: gumawa ng `.env.local` file sa project folder na may laman:
   ```
   ADMIN_USERNAME=pangalan_mo
   ADMIN_PASSWORD=sikreto_mo
   ```

**Anong kaya i-edit doon — LAHAT:**

| Tab | Laman |
|---|---|
| 🛋️ Products | Add/edit/delete products, presyo, kulay, SALE, description, **drag & drop photo upload**, drag para i-reorder (unang photo = main) |
| 📢 Promo & Site | Promo banner (2 linya), brand name, contact info, trust badges, "Featured in" quote + logos, pre-footer |
| 🖼️ Hero Slides | Mga slide ng malaking slideshow — text, buttons, desktop/mobile images, add/delete/reorder |
| 🎞️ Banners & Sections | "Made in America" / bedroom banner slideshows, 3 split sections, Best-selling carousel |
| ⭐ Reviews & FAQs | Google Reviews (pangalan, stars, comment, photos, petsa), testimonials, FAQs |
| 🎬 Videos & UGC | Video reviews (palit video/poster/pangalan), UGC section |

**Workflow:**
```
Mag-edit sa /admin → I-SAVE → makikita agad sa localhost
Kapag gusto nang ilabas sa live site → git push (auto-deploy si Vercel ~1 min)
```

> ⚠️ Ang admin ay gumagana lang sa sarili mong computer (localhost). Hindi ito
> kasama sa live na website — ligtas, walang ibang makaka-access.

---

## ⚡ PINAKAMABILIS na Paraan Mag-ayos ng Product Images

May **auto-sync script** — hindi mo na kailangang i-type ang image paths sa JSON:

1. Ihulog ang photos sa `public/images/products/` na ganitong pangalan:
   ```
   napa-88-5-leather-sofa-onyx-black-1.jpg   ← unang photo (main)
   napa-88-5-leather-sofa-onyx-black-2.jpg   ← pangalawa
   napa-88-5-leather-sofa-onyx-black-3.jpg   ← pangatlo... dagdag lang nang dagdag
   ```
   (ang unahan ay ang `slug` ng product sa `content/products.json`)

2. Patakbuhin:
   ```bash
   npm run sync-images
   ```

3. Tapos! Auto-updated na ang `products.json`. Sasabihin din ng script kung:
   - may product na WALANG photo
   - may file na mali ang spelling (hindi tugma sa kahit anong slug)

**Papalitan ang photo?** I-overwrite lang ang file (parehong filename) — walang script na kailangan, refresh lang.

---

## 🖼️ Paano Magpalit ng Larawan

**Paraan 1 — Palitan ang file (pinakamadali):**
Ilagay ang bagong photo sa `public/images/products/` na PAREHO ang filename ng luma (hal. `essex-leather-sofa-1.svg` → burahin, ilagay ang bago). Kung JPG ang bago, palitan din ang extension sa `products.json` (`.svg` → `.jpg`).

**Paraan 2 — Bagong filename:**
1. Ilagay ang photo sa `public/images/products/` (hal. `aking-sofa.jpg`)
2. Sa `products.json`, palitan ang path: `"images": ["/images/products/aking-sofa.jpg"]`

**Ibang mga larawan ng site:**
- Hero (malaking photo sa homepage): `public/images/hero-main.svg` — path nasa `content/site.json` → `hero.image`
- Featured sections: `feature-leather.svg`, `feature-pets.svg`, `feature-outdoor.svg` — paths nasa `site.json`
- Category tiles: `public/images/category-<slug>.svg` (hal. `category-sofas.svg`)

> ⚠️ Lahat ng kasalukuyang images ay **placeholder SVG** na may nakasulat na "Palitan ang larawang ito". Palitan mo lahat ng totoong photos (JPG/PNG). Recommended size: products 1200x900, hero 2000x1100, category tiles 800x800.

---

## 💰 Paano Baguhin ang Presyo o Detalye

Buksan ang `content/products.json`, hanapin ang product (Ctrl+F ang pangalan), baguhin ang field, i-save. Yun lang.

- Presyo: `"price": 1799`
- Mag-sale: lagyan ng `"compareAtPrice": 2249` (mas mataas sa price) → awtomatikong may SALE badge + strikethrough
- Tanggalin sa sale: `"compareAtPrice": null`

---

## 📢 Paano Baguhin ang Promo Banner / Hero Text

Buksan ang `content/site.json`:

- **Promo banner** (itim na strip sa taas): `"promoBanner": "…"`
- **Hero** (malaking headline sa homepage): `hero.headline`, `hero.subtext`, `hero.cta`
- **Trust badges**: `trustBadges` array
- **Contact info**: `contact.email`, `contact.phone`, `contact.hours`
- **Social links**: `social`

---

## 🌐 Paano I-deploy (ilagay sa internet, LIBRE)

1. I-push ang project sa GitHub
2. Pumunta sa [vercel.com](https://vercel.com) → Sign in with GitHub → "Add New Project" → piliin ang repo → Deploy
3. Tapos! May URL ka na (hal. `your-site.vercel.app`)

**Pag nag-edit ka ng JSON o photos:** i-commit at i-push lang ulit sa GitHub — awtomatikong magde-deploy ulit ang Vercel sa loob ng ~1 minuto.

```bash
git add .
git commit -m "Update products"
git push
```

---

## 💳 Paano Buksan ang Totoong Payment (Stripe) — kapag handa ka na

Sa ngayon, NAKA-OFF ang payment: ang "Checkout" button ay nagpapakita lang ng "Payment coming soon — contact us to order."

Kapag gusto mo nang tumanggap ng totoong bayad:

1. Gumawa ng account sa [stripe.com](https://stripe.com) (libre; may fee lang per transaction)
2. `npm install stripe @stripe/stripe-js`
3. Gumawa ng `.env.local` file na may:
   ```
   STRIPE_SECRET_KEY=sk_live_…
   NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_live_…
   ```
4. Buksan ang `lib/checkout.ts` — may `TODO(STRIPE)` comment doon. Palitan ang `startCheckout()` ng Stripe Checkout Session (gumawa ng API route sa `app/api/checkout/route.ts` na tumatawag sa `stripe.checkout.sessions.create` at ipasa ang cart items bilang line items, tapos i-redirect ang user sa `session.url`).
5. Sabihin mo lang sa AI assistant mo: *"Buksan na ang Stripe payment sa checkout"* — kayang gawin ang buong step 4 para sa'yo.

---

## 🗂️ Struktura ng Project

```
├── app/                    ← mga page (Next.js App Router)
│   ├── page.tsx            ← homepage
│   ├── collections/[category]/  ← category pages (/collections/sofas)
│   ├── products/[slug]/    ← product detail (/products/essex-leather-sofa)
│   ├── cart/  wishlist/  search/
│   └── faqs/  shipping/  about/  contact/  gift-cards/
├── components/             ← Header, Footer, ProductCard, store (cart/wishlist), atbp.
├── content/                ← ★ DITO KA MAG-E-EDIT ★
│   ├── products.json       ← lahat ng produkto
│   └── site.json           ← banner, hero, badges, contact
├── lib/                    ← products helper + checkout module
├── public/images/          ← ★ DITO ANG MGA LARAWAN ★
└── scripts/make-placeholders.sh  ← generator ng placeholder images
```

---

## ⚠️ Mga Paalala

- Lahat ng images ngayon ay placeholder — **palitan ng sarili mong photos** bago gamitin sa totoong negosyo.
- Ang design ay hango sa polyandbark.com; ang mga tunay na photos at text ng Poly & Bark ay pag-aari nila. Gumamit ng sariling branding, photos, at product info para sa sariling negosyo.
- Cart at wishlist ay naka-save sa browser ng customer (localStorage) — hindi shared sa ibang devices. Sapat ito hangga't walang totoong checkout/accounts.
