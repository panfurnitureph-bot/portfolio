"use client";

// PRODUCT CARD (2026-09-04, bagong homepage) — puting parisukat na litrato
// (contain, laging nakasentro), pangalan, presyo, at kanang meta (bilang ng
// kulay o "Ships this week"). Color variants = maliliit na thumb sa ilalim
// (hover = palit ng hero). Hover sa card = pangalawang anggulo ng litrato at
// "Quick view" na button sa ibaba ng litrato. Heart = wishlist (hindi
// ginagalaw). Stock pill at Add to cart ay opsyonal (Ready to ship).

import Image from "next/image";
import Link from "next/link";
import { useState } from "react";
import { formatPrice, type Product } from "@/lib/products";
import { useStore } from "@/components/store";
import { openQuickView } from "@/components/home/QuickView";
import { readyCartLine } from "@/lib/ready-cart";
import FitImage from "@/components/FitImage";

export default function ProductCard({
  product,
  square = true,
  showStock = false,
  showAddToCart = false,
  quickView = true,
}: {
  product: Product;
  square?: boolean;
  showStock?: boolean;
  showAddToCart?: boolean;
  quickView?: boolean;
}) {
  const { wishlist, toggleWishlist, addToCart } = useStore();
  const wished = wishlist.includes(product.slug);
  const onSale = !!product.compareAtPrice && product.compareAtPrice > product.price;

  const swatches = (product.colorSwatches ?? []).filter((s) => s.image || s.swatch || s.images?.length);
  const variants = swatches.map((s) => ({ name: s.name, image: s.images?.[0] ?? s.image ?? product.images[0], images: s.images?.length ? s.images : undefined, thumb: s.swatch ?? s.images?.[0] ?? s.image ?? product.images[0], stock: s.stock }));
  const [activeIdx, setActiveIdx] = useState(0);
  const [added, setAdded] = useState(false);
  const active = variants[activeIdx];
  const hero = active?.image ?? product.images[0] ?? "/store/images/placeholder.jpg";
  // HOVER = pangalawang anggulo (2026-09-04, "ung iba hindi nag-aanimate"):
  // dati ang may color variants ay walang hover. Ngayon: pangalawang litrato ng
  // napiling kulay kung meron, kung wala ang susunod na litrato ng produkto na
  // iba sa hero — lahat ng may 2+ litrato ay nag-a-animate na.
  const alt = (active?.images ?? product.images).find((im) => im !== hero) ?? null;
  // STOCK NG NAPILING KULAY (Joe 2026-09-06, "kung san itapat ung kulay mag
  // papakita mismo kung ilan ung stock nya, wag total"): ang badge ay ang bilang
  // ng kulay na naka-hover/napili; kabuuan lang kapag walang kada-kulay na bilang.
  const stock = active?.stock ?? product.stock ?? 0;
  const inStock = stock > 0;

  function add() {
    // Kapareho ng product page: as-is specs + kulay (2026-09-04).
    const colorName = active?.name ?? "";
    const line = readyCartLine(product, colorName);
    addToCart(product.slug, line.key, 1, line.unitPrice, { baseLabel: line.baseLabel, basePrice: line.unitPrice, image: hero, addOns: line.addOns });
    setAdded(true); setTimeout(() => setAdded(false), 1400);
  }

  return (
    <div className="group relative flex flex-col h-full bg-white border border-sand transition-colors hover:border-goldDeep [contain:content]">
      <button
        aria-label={wished ? "Remove from wishlist" : "Add to wishlist"}
        onClick={() => toggleWishlist(product.slug)}
        className={`absolute top-2.5 right-2.5 z-10 p-1.5 rounded-full bg-cream/85 transition-opacity ${wished ? "opacity-100" : "opacity-0 group-hover:opacity-100 max-lg:opacity-100"}`}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill={wished ? "#B08A3E" : "none"} stroke={wished ? "#B08A3E" : "#1A1A1A"} strokeWidth="1.6">
          <path d="M12 21C7 16.5 3 13 3 8.8 3 6 5.2 4 7.8 4c1.7 0 3.2.9 4.2 2.3C13 4.9 14.5 4 16.2 4 18.8 4 21 6 21 8.8c0 4.2-4 7.7-9 12.2z" />
        </svg>
      </button>

      <div className="absolute top-2.5 left-2.5 z-10 flex flex-col gap-1">
        {showStock ? (
          inStock ? (
            <span className={`inline-flex items-center gap-1.5 text-[9.5px] font-bold tracking-[0.1em] uppercase px-2 py-1 ${stock <= 3 ? "bg-[#F7EBD4] text-[#9A6B1E]" : "bg-[#E6F2EA] text-[#2F7D4F]"}`}>
              <i className={`w-1.5 h-1.5 rounded-full ${stock <= 3 ? "bg-[#9A6B1E]" : "bg-[#2F7D4F]"}`} />{stock <= 3 ? `Only ${stock} left` : `In stock · ${stock}`}
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5 text-[9.5px] font-bold tracking-[0.1em] uppercase px-2 py-1 bg-goldSoft text-brown"><i className="w-1.5 h-1.5 rounded-full bg-goldDeep" />Made to order</span>
          )
        ) : product.isNew ? (
          <span className="bg-brown text-gold text-[9.5px] font-bold tracking-[0.14em] uppercase px-2 py-1">New</span>
        ) : null}
        {onSale && <span className="bg-cognac text-cream text-[9.5px] tracking-[0.14em] uppercase px-2 py-1">Sale</span>}
      </div>

      <div className={`relative ${square ? "aspect-square" : "aspect-[4/3]"} overflow-hidden bg-white`}>
        {/* Litrato = diretso sa product page (2026-09-04, "ang hirap i-click sa mobile");
            ang Quick view ay sa button lang. */}
        <Link href={`/products/${product.slug}`} className="absolute inset-0 block">
          <FitImage src={hero} alt={product.name} className={`transition-opacity duration-300 ${alt ? "group-hover:opacity-0" : ""}`} sizes="(min-width: 1100px) 240px, (min-width: 640px) 33vw, 70vw" />
          {alt && <FitImage src={alt} alt="" className="opacity-0 transition-opacity duration-300 group-hover:opacity-100" sizes="240px" />}
        </Link>
        {quickView && (
          <button
            type="button"
            onClick={() => openQuickView(product)}
            className="absolute left-2.5 right-2.5 bottom-2.5 z-[1] bg-ink/85 text-cream text-[11px] font-bold tracking-[0.14em] uppercase py-2 opacity-0 translate-y-1.5 transition group-hover:opacity-100 group-hover:translate-y-0 max-lg:opacity-100 max-lg:translate-y-0"
          >
            Quick view
          </button>
        )}
      </div>

      <div className="relative flex flex-col gap-1.5 p-3 pt-2.5 border-t border-sand flex-1">
        {/* Buong info area ay link din (pangalan, presyo, puting espasyo) — ang
            color thumbs at Add to cart ay nakapatong (z-[1]) para gumana pa rin. */}
        <Link href={`/products/${product.slug}`} className="absolute inset-0" aria-hidden tabIndex={-1} />
        <Link href={`/products/${product.slug}`} className="relative z-[1] text-[13.5px] font-semibold leading-snug hover:text-goldDeep line-clamp-1" title={product.name}>{product.name}</Link>
        <div className="flex items-baseline justify-between gap-2">
          <span className="text-[15px] font-bold tabular-nums">
            {product.priceFrom ? <><span className="font-normal text-stone text-[11px] mr-1">from</span>{formatPrice(product.priceFrom)}</> : <span className={onSale ? "text-cognac" : ""}>{formatPrice(product.price)}</span>}
            {onSale && <span className="text-stone line-through ml-2 text-xs font-normal">{formatPrice(product.compareAtPrice!)}</span>}
          </span>
          <span className="text-[11px] text-stone whitespace-nowrap">
            {variants.length > 1 ? `${variants.length} colors` : inStock ? "Ships this week" : product.bedSizes?.length ? "Single–King" : ""}
          </span>
        </div>
        {/* UNIFORM NA TAAS (2026-09-04, "dapat uniform"): laging nakalaan ang
            hilera ng color thumbs (70px) kahit walang kulay ang produkto - kaya
            pare-pareho ang taas ng bawat card sa rail at collection. */}
        <div className="relative z-[1] flex h-[70px] items-center gap-2">
          {variants.length > 1 && (<>
            {variants.slice(0, 4).map((v, i) => (
              <button key={v.name + i} type="button" onMouseEnter={() => setActiveIdx(i)} onClick={() => setActiveIdx(i)} title={v.name} aria-label={v.name}
                className={`relative w-[56px] h-[56px] shrink-0 rounded bg-white overflow-hidden border-[1.5px] ${i === activeIdx ? "border-brown" : "border-sand"} ${v.stock !== undefined && v.stock <= 0 ? "opacity-40" : ""}`}>
                <Image src={v.thumb} alt="" fill className="object-contain" sizes="56px" />
              </button>
            ))}
            {variants.length > 4 && <span className="text-[11px] text-stone">+{variants.length - 4}</span>}
          </>)}
        </div>
        {showAddToCart && (
          <button type="button" onClick={add} disabled={added} className={`relative z-[1] mt-auto w-full py-2 text-[12px] font-semibold border ${added ? "bg-[#2F7D4F] border-[#2F7D4F] text-white" : "border-brown text-brown hover:bg-brown hover:text-cream"}`}>
            {added ? "Added ✓" : "Add to cart"}
          </button>
        )}
      </div>
    </div>
  );
}
