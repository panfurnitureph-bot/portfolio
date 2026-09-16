# PROMPT PARA KAY FABLE — Replicate Poly & Bark Website

Kopyahin lahat ng nasa ibaba, ipaste kay Fable bilang isang prompt.

---

## BUONG PROMPT (copy-paste ito)

```
Gumawa ka ng kumpleto at production-ready na ecommerce furniture website na 100% kamukha at kaparehong-gana ng https://www.polyandbark.com — isang premium furniture at home decor online store. Gusto ko ma-replicate mo LAHAT ng hitsura, layout, at functionality, at gusto ko rin madaling ma-update ang mga post, larawan, at detalye ng produkto.

## TECH STACK (gamitin ito)
- Next.js 14 (App Router) + React + TypeScript
- Tailwind CSS para sa styling
- Content/products naka-store sa JSON o Markdown files sa loob ng `/content` folder (para madaling i-edit — HINDI kailangan ng database o CMS login para mag-update)
- Local images sa `/public/images` folder
- Fully responsive (mobile, tablet, desktop)
- Static site (deployable sa Vercel/Netlify nang libre)
- HINDI Shopify. Normal na standalone website. Lahat ng Shopify features (hitsura, cart, product pages) ay gagawin natin mismo — 100% pixel-perfect at gumagana.

## EXACT NA KOPYA — ITO GUSTO KO
Gusto ko EXACT NA KOPYA ng https://www.polyandbark.com — hindi lang kamukha, kundi identical:
- I-download at gamitin ang TUNAY na larawan mula sa polyandbark.com (product photos, hero images, category tiles, logos). Ilagay sa /public/images.
- Kopyahin ang TUNAY na product names, presyo, descriptions, at category structure mula sa site.
- I-match nang exacto ang kulay, spacing, font sizes, at layout ng bawat section.
- Kung may hindi ma-access na image, gumamit ng malapit na placeholder pero markahan sa README kung alin ang kailangan palitan.
(Nota: pang-personal/demo lang ito; ang tunay na content ay pag-aari ng Poly & Bark.)

## LOOK & BRANDING (i-match ito)
- Logo: "POLY_BARK" na clean sans-serif, all caps
- Kulay: warm at neutral tones — cream/off-white background (#FAF8F5), charcoal/black text (#1A1A1A), warm tan/cognac accents (#B87333)
- Font: modern na sans-serif (tulad ng Inter o Helvetica) para sa lahat
- Malalaking lifestyle photos ng furniture (hero images), maraming white space, minimalist premium na dating
- Smooth hover effects sa mga product tiles at buttons

## MGA PAHINA / PAGES (gawin lahat)

### 1. Header (nasa lahat ng pages, sticky sa taas)
- Promo banner sa pinakataas: nagsasabi ng sale (hal. "20% OFF SITEWIDE — exclusions apply") — dapat editable ang text
- Logo sa gitna o kaliwa
- Main nav: New In, Sofas, Living, Dining, Bedroom, Workspace, Outdoor, Lighting, Decor, Gift Cards
- Icons sa kanan: Search, Wishlist (heart), Cart (bag), Account
- Secondary quick links: FAQs, Shipping, Rewards, Order Swatches

### 2. Homepage
- Hero section na may malaking image + headline + CTA button (hal. "Shop Sofas")
- Multiple featured collection sections (Leather Sofas, Pet-Friendly, Outdoor)
- "Shop by Category" grid — 13 na image tiles: Sofas, Outdoor, Bedroom, Storage, Sectionals, Dining Chairs, Sofa Beds, Accent Chairs, Stools, Dining Tables, Accent Tables, Lighting, Decor
- Trust badges row: "Quality materials. Built to last", "100-Day Happiness Guarantee", "Free Shipping", "0% APR Financing"
- "As featured in" logos: The New Yorker, Architectural Digest, Houzz, GQ, Forbes, Domino, PopSugar
- Newsletter signup section

### 3. Category / Collection page (hal. /sofas, /dining)
- Grid ng products na may photo, name, price
- Filter sidebar (by price, color, material, category)
- Sort dropdown (price low-high, high-low, new)
- Breadcrumbs

### 4. Product Detail page (/products/[slug])
- Image gallery (multiple photos, thumbnails, zoom on hover)
- Product name, price, short description
- Color/variant selector
- Quantity selector + "Add to Cart" button + "Add to Wishlist"
- Full description, specs (dimensions, materials, care), tabs para sa Details / Shipping / Reviews
- Star ratings + customer reviews section
- "You may also like" related products

### 5. Cart page
- List ng items (photo, name, qty, price, remove button)
- Subtotal, estimated shipping, total
- "Checkout" button
- Cart state persisted sa localStorage

### 6. Iba pang pages
- Search results page (search by product name)
- Wishlist page
- FAQs page
- Shipping/Returns page
- About page
- Contact page (email hello@polyandbark.com, phone 1-855-310-1450, Mon-Fri 9AM-7:30PM EDT, live chat placeholder)

### 7. Footer (sa lahat ng pages)
- Link columns: Shop, Support, Company, Resources
- Social icons: Facebook, Instagram, Twitter, Pinterest
- Payment icons: Visa, Mastercard, Apple Pay, Google Pay, Klarna
- Newsletter signup
- Copyright

## FUNCTIONALITY (dapat gumana talaga)
- Add to Cart + cart count badge sa header (localStorage)
- Wishlist add/remove (localStorage)
- Search filtering ng products
- Category filtering + sorting
- Variant/color selector na nagpapalit ng image at price
- Responsive mobile menu (hamburger)
- Newsletter form (basta may success message, pwedeng walang backend muna)

## PAYMENT (naka-DEFAULT OFF muna)
- SA NGAYON: WALANG totoong online payment. Ang cart at checkout ay gumagana pero sa "Checkout" button, magpakita lang ng order summary + "Payment coming soon — contact us to order" message. I-display parin ang payment icons (Visa, Mastercard, Apple Pay, Google Pay, Klarna) sa footer para sa hitsura.
- GAWING MADALING BUKSAN LATER: isulat ang checkout code na malinis at hiwalay na module (hal. `/lib/checkout.ts`) na may TODO comment kung saan ilalagay ang Stripe. Sa README, maglagay ng section na "Paano buksan ang totoong payment (Stripe)" — ipaliwanag ang steps kapag handa na ako.

## PAANO MAG-UPDATE (PINAKA-IMPORTANTE — gawing madali)
Gawin mong data-driven ang buong site. Lahat ng laman ay galing sa mga file na madaling i-edit. Gawin ito:

1. Gumawa ng `/content/products.json` — dito lahat ng produkto. Bawat produkto may ganitong hitsura:
   {
     "slug": "essex-leather-sofa",
     "name": "Essex Leather Sofa",
     "price": 1799,
     "category": "sofas",
     "colors": ["Cognac Tan", "Black"],
     "images": ["/images/essex-1.jpg", "/images/essex-2.jpg"],
     "description": "...",
     "dimensions": "84 W x 38 D x 32 H",
     "materials": "Full-grain leather",
     "featured": true,
     "reviews": [{"author": "Jane", "rating": 5, "text": "..."}]
   }

2. Gumawa ng `/content/site.json` para sa promo banner text, hero headlines, at trust badges — para editable din.

3. Ilagay lahat ng larawan sa `/public/images/`.

4. Magsulat ka ng `README.md` na may CLEAR na step-by-step na instructions sa TAGALOG kung paano:
   - Magdagdag ng bagong produkto (i-edit ang products.json + maglagay ng photo)
   - Magpalit ng larawan (palitan ang file sa /public/images, o baguhin ang path sa JSON)
   - Baguhin ang presyo o detalye (i-edit ang field sa JSON)
   - Baguhin ang promo banner o hero text (i-edit ang site.json)
   - I-deploy ulit pagkatapos mag-edit

## MGA DELIVERABLE
- Buong Next.js project, tumatakbo sa `npm run dev`
- Sample data: hindi bababa sa 20 products na hati-hati sa mga category, may placeholder images
- README.md na may setup + update instructions sa Tagalog
- Malinis, may comments ang code

## PAANO GAWIN (para tapos sa isang takbo)
- Gawin ang BUONG project sa isang beses hangga't kaya: skeleton + lahat ng pages + components + sample data + README.
- Kung sobrang laki para sa isang response, gawin muna nang KUMPLETO ang: project setup + header + footer + homepage + product data + isang buong product page — tapos sabihin mo kung ano ang susunod na itutuloy. Tuloy-tuloy hanggang kompleto lahat.
- WAG mag-summary lang o placeholder na code — magsulat ng TOTOONG code na tumatakbo agad sa `npm install` + `npm run dev`.
- Kapag hindi ma-download ang tunay na image, gumamit ng placeholder pero itala sa README kung alin ang papalitan.

Simulan mo na ngayon.
```

---

## MGA NOTA (para sa'yo, hindi kasama sa prompt)

- Ang totoong site ay Shopify. Legal at praktikal na paraan para 100% ma-control at ma-update mo mismo: gawing **static Next.js site na data-driven** (yun ang nasa prompt).
- Kung gusto mong **exact na sipsip ng images/text**: sabihin mo kay Fable "download the real images from polyandbark.com and use them" — pero mas ligtas gumamit ng placeholder o sariling photos (copyright ang tunay).
- Update = i-edit lang ang JSON files + palit photos. Walang login, walang database.
- Para live sa internet: i-push sa GitHub, i-connect sa Vercel (libre).
