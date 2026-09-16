"use client";

// QUICK VIEW (2026-09-04) — modal na bumubukas mula sa product card nang hindi
// umaalis sa homepage: gallery ng lahat ng anggulo (hover sa thumb = palit,
// hover sa malaking litrato = zoom), Product code, Availability, presyo,
// maikling description, Color (bilog na swatch → palit ng hero), Size (kapag
// may bedSizes), Quantity, Add to cart, Share. Iisang instance sa page;
// binubuksan ng `window.dispatchEvent(new CustomEvent("pan:quickview",
// { detail: { product } }))`.

import Image from "next/image";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { formatPrice, type Product } from "@/lib/products";
import { useStore } from "@/components/store";
import { readyCartLine } from "@/lib/ready-cart";

export function openQuickView(product: Product) {
  window.dispatchEvent(new CustomEvent("pan:quickview", { detail: { product } }));
}

export default function QuickView() {
  const { addToCart } = useStore();
  const [p, setP] = useState<Product | null>(null);
  const [img, setImg] = useState(0);
  const [color, setColor] = useState(0);
  const [size, setSize] = useState(0);
  const [qty, setQty] = useState(1);
  const [added, setAdded] = useState(false);
  const [copied, setCopied] = useState(false);
  const stage = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState<{ x: number; y: number } | null>(null);

  useEffect(() => {
    const open = (e: Event) => {
      const prod = (e as CustomEvent<{ product: Product }>).detail?.product;
      if (!prod) return;
      setP(prod); setImg(0); setColor(0); setSize(0); setQty(1); setAdded(false);
      document.body.style.overflow = "hidden";
    };
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") close(); };
    window.addEventListener("pan:quickview", open);
    document.addEventListener("keydown", key);
    return () => { window.removeEventListener("pan:quickview", open); document.removeEventListener("keydown", key); };
  }, []);

  function close() { setP(null); document.body.style.overflow = ""; }
  if (!p) return null;

  const gallery = p.images.length ? p.images : ["/store/images/placeholder.jpg"];
  const swatches = (p.colorSwatches ?? []).filter((s) => s.image || s.swatch || s.hex);
  const colorNames = swatches.length ? swatches.map((s) => s.name) : p.colors;
  const sizes = (p.bedSizes ?? []).filter((s) => s.enabled !== false);
  const stock = p.stock ?? 0;
  const mto = stock <= 0;
  const sizePrice = sizes[size]?.price;
  const price = sizePrice && sizePrice > 0 ? sizePrice : p.priceFrom && sizes.length ? p.priceFrom : p.price;
  const colorStock = swatches[color]?.stock;
  const hero = swatches[color]?.images?.[0] ?? swatches[color]?.image ?? gallery[img];
  const shown = zoomSrc(hero);

  function pickImg(i: number) { setImg(i); }
  function pickColor(i: number) { setColor(i); }

  function add(buyNow: boolean) {
    const colorName = colorNames[color] ?? "";
    const sizeName = sizes[size]?.size ?? "";
    // Kapareho ng product page: as-is specs + size + kulay (2026-09-04).
    const line = readyCartLine(p!, colorName, sizeName, price);
    addToCart(p!.slug, line.key, qty, line.unitPrice, { baseLabel: line.baseLabel, basePrice: line.unitPrice, image: hero, addOns: line.addOns });
    if (buyNow) { window.location.href = "/checkout"; return; }
    setAdded(true); setTimeout(() => setAdded(false), 1500);
  }

  const url = typeof window !== "undefined" ? `${window.location.origin}/products/${p.slug}` : `/products/${p.slug}`;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-ink/55" onClick={(e) => { if (e.target === e.currentTarget) close(); }} role="dialog" aria-modal="true" aria-label={`Quick view: ${p.name}`}>
      <div className="relative bg-white w-[min(1000px,100%)] max-h-[92vh] overflow-auto grid md:grid-cols-[1.05fr_1fr] shadow-2xl">
        <button onClick={close} aria-label="Close" className="absolute top-0 right-0 z-10 w-9 h-9 bg-ink text-white text-xl hover:bg-brown">×</button>

        {/* media */}
        <div className="flex flex-col p-5 pt-10 md:p-7 md:pt-10">
          <div
            ref={stage}
            className="relative flex-1 min-h-[260px] md:min-h-[360px] flex items-center justify-center overflow-hidden cursor-zoom-in"
            onMouseMove={(e) => { const r = stage.current!.getBoundingClientRect(); setZoom({ x: ((e.clientX - r.left) / r.width) * 100, y: ((e.clientY - r.top) / r.height) * 100 }); }}
            onMouseLeave={() => setZoom(null)}
          >
            <Image src={shown} alt={p.name} fill className="object-contain" sizes="(min-width: 768px) 520px, 100vw" />
            {zoom && (
              <div className="absolute inset-0 bg-white bg-no-repeat pointer-events-none hidden md:block" style={{ backgroundImage: `url("${shown}")`, backgroundSize: "220%", backgroundPosition: `${zoom.x}% ${zoom.y}%` }} />
            )}
          </div>
          {gallery.length > 1 && (
            <div className="flex items-center gap-2 mt-4">
              <button type="button" aria-label="Previous" onClick={() => pickImg((img - 1 + gallery.length) % gallery.length)} className="w-8 h-8 text-stone hover:text-ink text-2xl">‹</button>
              <div className="flex gap-2 flex-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                {gallery.map((g, i) => (
                  <button key={g + i} type="button" onMouseEnter={() => pickImg(i)} onClick={() => pickImg(i)} className={`relative w-16 h-16 shrink-0 p-1 border-b-2 ${i === img && !swatches[color]?.images?.length ? "border-ink" : "border-transparent"}`}>
                    <Image src={g} alt="" fill className="object-contain p-1" sizes="64px" />
                  </button>
                ))}
              </div>
              <button type="button" aria-label="Next" onClick={() => pickImg((img + 1) % gallery.length)} className="w-8 h-8 text-stone hover:text-ink text-2xl">›</button>
            </div>
          )}
        </div>

        {/* info */}
        <div className="p-5 md:p-10 md:pl-5 flex flex-col gap-4">
          <h3 className="font-cormorant text-2xl font-semibold leading-tight">{p.name}</h3>
          <dl className="grid grid-cols-[120px_1fr] gap-x-3 gap-y-2 text-[13px] m-0">
            <dt className="font-medium">Product code</dt><dd className="m-0 text-stone">{p.sku ?? "—"}</dd>
            <dt className="font-medium">Availability</dt>
            <dd className={`m-0 ${mto ? "text-stone" : "text-[#2F7D4F] font-semibold"}`}>
              {mto ? "Made to order · 4–6 weeks" : `${colorStock ?? stock} in stock · ships this week`}
            </dd>
          </dl>
          <div className="font-cormorant text-2xl font-semibold">
            {sizes.length && !sizePrice ? <span className="font-sans text-xs font-normal text-stone mr-1.5">from</span> : null}
            {formatPrice(price)}
          </div>
          {p.description && <p className="m-0 text-[13px] text-stone leading-relaxed">{p.description.length > 140 ? p.description.slice(0, 137) + "…" : p.description}</p>}

          {colorNames.length > 0 && (
            <div className="flex flex-col gap-2">
              <div className="text-[13px] font-semibold">Color <span className="text-[#C0392B]">*</span> <span className="font-normal text-stone ml-1">{colorNames[color]}</span></div>
              <div className="flex gap-2.5 flex-wrap">
                {colorNames.map((nm, i) => {
                  const s = swatches[i];
                  const src = s?.swatch ?? s?.images?.[0] ?? s?.image;
                  const out = s?.stock !== undefined && s.stock <= 0 && !mto;
                  return (
                    <button key={nm + i} type="button" title={nm} onMouseEnter={() => pickColor(i)} onClick={() => pickColor(i)}
                      className={`relative w-10 h-10 rounded-full overflow-hidden border border-sand bg-white ${i === color ? "ring-2 ring-offset-2 ring-ink" : ""} ${out ? "opacity-40" : ""}`}>
                      {src ? <Image src={src} alt={nm} fill className="object-cover" sizes="40px" /> : <span className="absolute inset-0" style={{ background: s?.hex ?? "#D9CFC0" }} />}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {sizes.length > 0 && (
            <div className="flex flex-col gap-2">
              <div className="text-[13px] font-semibold">Size</div>
              <div className="flex gap-2 flex-wrap">
                {sizes.map((s, i) => (
                  <button key={s.size} type="button" onClick={() => setSize(i)} className={`px-3.5 py-2 text-[12.5px] border min-w-[60px] ${i === size ? "bg-ink text-white border-ink" : "bg-white border-sand"}`}>{s.size}</button>
                ))}
              </div>
            </div>
          )}

          <div className="flex flex-col gap-2">
            <div className="text-[13px] font-semibold">Quantity</div>
            <div className="flex items-center border border-sand bg-white w-max">
              <button type="button" onClick={() => setQty(Math.max(1, qty - 1))} className="w-9 h-10 text-base">−</button>
              <span className="w-14 text-center font-medium">{qty}</span>
              <button type="button" onClick={() => setQty(qty + 1)} className="w-9 h-10 text-base">+</button>
            </div>
          </div>

          <div className="flex gap-2.5 flex-wrap">
            <button type="button" onClick={() => add(false)} disabled={added} className={`h-12 px-7 text-[12px] font-bold tracking-[0.14em] uppercase text-cream ${added ? "bg-[#2F7D4F]" : "bg-brown hover:bg-brownDeep"}`}>
              {added ? "Added ✓" : mto ? "Add to cart — made to order" : "Add to cart"}
            </button>
            <button type="button" onClick={() => add(true)} className="h-12 px-6 text-[12px] font-bold tracking-[0.14em] uppercase border-[1.5px] border-brown text-brown hover:bg-brown hover:text-cream">Buy now</button>
          </div>

          <div className="text-[12.5px] flex items-center gap-3 flex-wrap">
            <span>Share:</span>
            <a className="text-stone underline" href={`https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(url)}`} target="_blank" rel="noopener noreferrer">Facebook</a>
            <a className="text-stone underline" href={`fb-messenger://share?link=${encodeURIComponent(url)}`}>Messenger</a>
            <button type="button" className="text-stone underline" onClick={() => { navigator.clipboard?.writeText(url); setCopied(true); setTimeout(() => setCopied(false), 1200); }}>{copied ? "Copied ✓" : "Copy link"}</button>
          </div>
          <Link href={`/products/${p.slug}`} className="text-[12px] text-stone underline">View full details, dimensions and fabric options →</Link>
        </div>
      </div>
    </div>
  );
}

// next/image ay nag-o-optimize ng src; para sa CSS background zoom, ang
// orihinal na URL ang gamit — pareho ring host (Supabase / public).
function zoomSrc(src: string) { return src; }
