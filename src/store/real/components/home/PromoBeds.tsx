// PROMO BEDS (2026-09-04) — brown band: isang malaking featured bed (presyo
// kada size mula sa bedSizes ng Configurator, kulay) + 2×2 ng iba pang promo
// bed. Pinagmumulan: published na Promo Bed na produkto. Ang IMS → Website
// Content → Promo Beds ay may (1) featured photo override, (2) bed cards na
// litrato na pumapalit sa product photo kapag magkapareho ang pangalan, at
// (3) fallback na laman habang wala pang published na kama. Nakatago kapag
// wala pareho.

import Image from "next/image";
import Link from "next/link";
import { formatPrice, type HomepageContent, type Product } from "@/lib/products";

type Card = { name?: string; price?: string; image?: string; sizes?: string; colors?: string; sizeList?: { size: string; price: string }[]; colorList?: { name: string; image?: string; focus?: string; hex?: string }[] };
type Tile = { key: string; name: string; href: string; image: string; from: number; sizes: { size: string; price: number }[]; colors: { name: string; hex?: string; swatch?: string; focus?: string }[] };

const num = (s: string) => Number(String(s).replace(/[^\d.]/g, "")) || 0;
const norm = (s: string) => s.trim().toLowerCase();
// Pinakamababang presyo sa listahan (0 kapag walang laman) — "from ₱…".
const minOf = (ns: number[]) => { const ps = ns.filter((n) => n > 0); return ps.length ? Math.min(...ps) : 0; };

export default function PromoBeds({ products, copy }: { products: Product[]; copy?: HomepageContent["promoBeds"] }) {
  const cards: Card[] = ((copy as { cards?: Card[] } | undefined)?.cards ?? []).filter((c) => c && (c.name || c.image));
  const photoFor = (name: string) => cards.find((c) => norm(c.name ?? "") === norm(name))?.image || "";
  const beds = products.filter((p) => p.category === "bed");

  let tiles: Tile[];
  if (beds.length) {
    tiles = beds.map((b) => ({
      key: b.slug, name: b.name, href: `/products/${b.slug}`,
      image: photoFor(b.name) || b.images[0] || "/store/images/placeholder.jpg",
      from: b.priceFrom ?? b.price,
      sizes: (b.bedSizes ?? []).filter((s) => s.enabled !== false && (s.price ?? 0) > 0).map((s) => ({ size: s.size, price: s.price! })),
      colors: (b.colorSwatches ?? []).length ? b.colorSwatches!.map((c) => ({ name: c.name, hex: c.hex, swatch: c.image || c.swatch })) : b.colors.map((c) => ({ name: c })),
    }));
    const fs = (copy as { featuredSlug?: string } | undefined)?.featuredSlug;
    const fi = Math.max(0, tiles.findIndex((t) => t.key === fs || (fs === "" && beds.find((b) => b.slug === t.key)?.featured)));
    if (fi > 0) tiles.unshift(...tiles.splice(fi, 1));
  } else {
    // Fallback: cards mula sa IMS habang wala pang published na Promo Bed.
    // Litrato lang ang kailangan; ang walang pangalan ay "Promo Bed n".
    tiles = cards.filter((c) => c.image || c.name).map((c, i) => ({
      key: `card-${i}`, name: c.name || `Promo Bed ${i + 1}`, href: "/collections/bed", image: c.image || "/store/images/placeholder.jpg", from: num(c.price ?? "") || minOf((c.sizeList ?? []).map((s) => num(s.price))),
      // Hiwalay na field kada size/kulay (sizeList/colorList); ang lumang
      // "Single 18799 · …" na text ay binabasa pa rin.
      sizes: (c.sizeList?.length ? c.sizeList.map((s) => ({ size: s.size, price: num(s.price) })) : (c.sizes ?? "").split("·").map((s) => s.trim()).filter(Boolean).map((s) => { const m = /^(.+?)\s+([\d,.]+)$/.exec(s); return m ? { size: m[1], price: num(m[2]) } : { size: s, price: 0 }; })).filter((s) => s.price > 0),
      colors: c.colorList?.length ? c.colorList.filter((x) => x.name || x.image).map((x, k) => ({ name: x.name || `Color ${k + 1}`, hex: x.hex, swatch: x.image, focus: x.focus })) : (c.colors ?? "").split("·").map((s) => s.trim()).filter(Boolean).map((n) => ({ name: n })),
    }));
  }
  if (!tiles.length) return null;

  const featured = tiles[0];
  const featuredImage = (copy as { featuredImage?: string } | undefined)?.featuredImage || featured.image;
  const rest = tiles.slice(1, 5);
  const minPrice = Math.min(...tiles.map((t) => t.from).filter((n) => n > 0));
  const foot = copy?.foot?.length ? copy.foot : ["30% downpayment to start", "4–6 weeks build to delivery", "6-month warranty on frame, foam and workmanship"];

  return (
    <section className="bg-brown text-cream py-12 md:py-14">
      <div className="max-w-7xl mx-auto px-4 sm:px-8">
        <div className="flex items-end justify-between gap-4 mb-5 flex-wrap">
          <div>
            <p className="text-[11px] font-bold tracking-[0.16em] uppercase text-gold">{copy?.eyebrow ?? "Promo Bed · made to order"}</p>
            <h2 className="font-cormorant font-semibold text-[clamp(22px,2.6vw,30px)] leading-[1.05] mt-1.5">{copy?.title || (Number.isFinite(minPrice) ? `Promo beds from ${formatPrice(minPrice)}` : "Promo beds")}</h2>
            {copy?.sub && <p className="text-sm mt-1.5 max-w-[60ch] text-cream/75">{copy.sub}</p>}
          </div>
          <Link href="/collections/bed" className="text-[11.5px] font-bold tracking-[0.14em] uppercase border-b-[1.5px] border-gold text-gold pb-0.5 whitespace-nowrap">See all promo beds →</Link>
        </div>

        <div className={`grid gap-4 ${rest.length ? "md:grid-cols-[1.35fr_1fr]" : ""}`}>
          <Link href={featured.href} className="group relative block min-h-[340px] md:min-h-[420px] bg-brownDeep overflow-hidden">
            <Image src={featuredImage} alt={featured.name} fill className="object-cover transition-transform duration-700 group-hover:scale-[1.03]" sizes="(min-width: 768px) 55vw, 100vw" />
            <span className="absolute top-3.5 left-3.5 bg-gold text-brownDeep text-[10px] font-bold tracking-[0.14em] uppercase px-2.5 py-1">Best seller</span>
            <div className="absolute inset-x-0 bottom-0 p-5 md:p-6 bg-gradient-to-t from-ink/90 via-ink/60 to-transparent flex flex-col gap-2.5">
              <div className="font-cormorant text-2xl font-semibold">{featured.name}</div>
              {featured.sizes.length > 0 ? (
                <div className="flex gap-2 flex-wrap">
                  {featured.sizes.map((s) => (
                    <span key={s.size} className="border border-cream/35 px-2.5 py-1.5 text-xs flex flex-col min-w-[78px]">
                      <b className="text-[10px] tracking-[0.12em] uppercase text-gold font-bold">{s.size}</b>{formatPrice(s.price)}
                    </span>
                  ))}
                </div>
              ) : featured.from > 0 ? (
                <div className="text-sm text-cream/85">from {formatPrice(featured.from)}</div>
              ) : null}
              {featured.colors.length > 0 && (
                <div className="flex items-center gap-1.5 text-xs text-cream/80">
                  {featured.colors.slice(0, 4).map((c) => <i key={c.name} title={c.name} className="w-[22px] h-[22px] rounded-full border-2 border-cream/60 inline-block overflow-hidden relative" style={{ background: c.hex ?? "#CFC2A8" }}>{c.swatch && <Image src={c.swatch} alt="" fill className="object-cover" style={{ objectPosition: c.focus || "50% 50%" }} sizes="24px" />}</i>)}
                  <span>{featured.colors.map((c) => c.name).slice(0, 3).join(" · ")}</span>
                </div>
              )}
              <span className="inline-block w-max mt-0.5 bg-gold text-brownDeep text-[12px] font-bold tracking-[0.14em] uppercase px-5 py-3">Build this bed</span>
            </div>
          </Link>

          {rest.length > 0 && (
            <div className="grid grid-cols-2 gap-4">
              {rest.map((b) => (
                <Link key={b.key} href={b.href} className="group relative block min-h-[150px] md:min-h-[200px] bg-white overflow-hidden text-cream">
                  <Image src={b.image} alt={b.name} fill className="object-cover transition-transform duration-500 group-hover:scale-[1.04]" sizes="(min-width: 768px) 22vw, 50vw" />
                  <div className="absolute inset-x-0 bottom-0 px-3.5 py-3 bg-gradient-to-t from-ink/85 to-transparent flex flex-col">
                    <b className="font-semibold text-sm">{b.name}</b>
                    {b.from > 0 && <span className="text-xs text-gold">from {formatPrice(b.from)}</span>}
                  </div>
                </Link>
              ))}
            </div>
          )}
        </div>

        <div className="flex gap-6 flex-wrap mt-5 pt-4 border-t border-gold/25 text-[12.5px] text-cream/75">
          {foot.map((f) => { const [b, ...r] = f.split(" "); return <span key={f}><b className="text-cream font-semibold">{b} {r[0] ?? ""}</b> {r.slice(1).join(" ")}</span>; })}
        </div>
      </div>
    </section>
  );
}
