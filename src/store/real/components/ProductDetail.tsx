"use client";

// Product detail — 1:1 layout with the real site:
// vertical thumbnails on the LEFT of the main image, serif title,
// stars + underlined rating, price block with Comp Value / promo code
// (copy button) / financing "Show more", image swatches with
// GET FREE SWATCHES, filled size buttons, free-shipping + ZIP checker,
// qty box + big add-to-cart + boxed heart, MEASURE FOR DELIVERY +
// VIEW DIMENSIONS links, fullscreen lightbox.

import Image from "next/image";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { averageRating, formatPrice, type Product, type SiteContent } from "@/lib/products";
import { useSwipeFallback } from "@/components/useSwipeFallback";
import { messengerHandle, messengerUrl } from "@/lib/messenger";
import { useStore } from "@/components/store";
import MtoOptions from "@/components/MtoOptions";
import type { MtoItemConfig } from "@/lib/content";
import FitModal from "@/components/FitModal";
import { packagedFrom } from "@/lib/packaged";

// Fallback na 6 bed sizes kung walang custom na bedSizes ang product
const DEFAULT_SIZES = [
  { id: "Single", adj: -400 },
  { id: "Twin", adj: -300 },
  { id: "Double/Full", adj: -150 },
  { id: "Queen", adj: 0 },
  { id: "King", adj: 250 },
  { id: "King 2", adj: 350 },
];
// Ang mga ibinebenta ayon sa sukat — dito lumalabas ang size picker. Kasama
// ang customized-bed: may sariling Bed sizes table din ito sa PAN app admin.
const SIZED_CATEGORIES = ["bed", "customized-bed", "sofa-bed", "mattress", "bedroom", "sofa-beds"];
// Promo config galing sa content/site.json (editable sa admin)

// Ang `site` (promo + shipping rates) ay ipinapasa ng product page (server).
export default function ProductDetail({
  product,
  site,
  mto,
  categoryTitle,
}: {
  product: Product;
  site: SiteContent;
  // Made-to-Order config (IMS Website → MTO Configurator) — published lang.
  mto?: MtoItemConfig | null;
  // Eyebrow sa itaas ng pangalan (hal. "Swivel Chair").
  categoryTitle?: string;
}) {
  // MTO: customizable = ang MtoOptions panel ang options UI; locked = as-is
  // page (presyo + Add to cart lang, walang classic options).
  const mtoActive = !!mto?.customizable;
  // View ng MTO panel (ready | mto) — para sa "— Made to Order" na title.
  const [mtoView, setMtoView] = useState<string>("mto");
  useEffect(() => {
    const h = (e: Event) => setMtoView(String((e as CustomEvent).detail));
    window.addEventListener("mto-view", h);
    return () => window.removeEventListener("mto-view", h);
  }, []);
  const mtoLocked = !!mto && !mto.customizable;
  const hideOpts = mtoActive || mtoLocked;
  // Ang Fabric tiles ng MTO panel (ready-unit view) ang color picker kapag
  // nakatago ang classic options - sumusunod ang gallery sa napiling kulay.
  useEffect(() => {
    const h = (e: Event) => {
      const nm = String((e as CustomEvent).detail ?? "").toLowerCase();
      const i = (product.colorSwatches ?? []).findIndex((s) => s.name.toLowerCase() === nm);
      if (i >= 0) pickColor(i);
    };
    window.addEventListener("pan-color-change", h);
    return () => window.removeEventListener("pan-color-change", h);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [product]);
  const { addToCart, toggleWishlist, wishlist } = useStore();
  const router = useRouter();
  const [imageIdx, setImageIdx] = useState(0);
  const galleryTrack = useRef<HTMLDivElement>(null);
  // Desktop thumbnail rail — pang-scroll ng ˅ button kapag 8+ ang images.
  const thumbRailRef = useRef<HTMLDivElement>(null);
  const gallerySwipe = useSwipeFallback(galleryTrack);
  const [colorIdx, setColorIdx] = useState(0);
  const [hoverColor, setHoverColor] = useState<number | null>(null);
  const [notifyEmail, setNotifyEmail] = useState("");
  const [notified, setNotified] = useState(false);
  // Default = unang available na size (karaniwan Single)
  const [size, setSize] = useState(
    () =>
      (product.bedSizes ?? []).filter((s) => s.enabled !== false)[0]?.size ??
      "Single"
  );
  const [qty, setQtyState] = useState(1);
  const [added, setAdded] = useState(false);
  const [lightbox, setLightbox] = useState(false);
  // HOVER TO ZOOM (2026-09-04 mockup): 220% na kopya ng litrato na sumusunod
  // sa mouse sa ibabaw ng stage; click pa rin = fullscreen.
  const [zoom, setZoom] = useState<{ x: number; y: number } | null>(null);
  const packaged = packagedFrom(product.dimensions || "");
  const [copied, setCopied] = useState(false);

  const color = product.colors[colorIdx] ?? product.colors[0];

  // Gallery = crop shots (product.images). Kapag may napiling KULAY na may
  // sariling recolored photo, idadagdag ito sa DULO ng gallery (para may
  // ma-swap na larawan nang hindi nagugulo ang catalog crops).
  const swatchImg = product.colorSwatches?.[colorIdx]?.image;
  // LITRATO KADA KULAY (IMS 0231, 2026-09-03): kapag may sariling hanay ng
  // litrato ang kulay, ITO ang buong gallery (hero + thumbnails)
  // style. Walang hanay = dating gawi (catalog crops + recolored photo sa dulo).
  const colorImages = product.colorSwatches?.[colorIdx]?.images ?? [];
  const galleryImages =
    colorImages.length
      ? colorImages
      : swatchImg && !product.images.includes(swatchImg)
      ? [...product.images, swatchImg]
      : product.images;

  // Kapag napili ang kulay, ilipat ang gallery sa photo ng kulay na yun
  function pickColor(i: number) {
    setColorIdx(i);
    if (product.colorSwatches?.[i]?.images?.length) { setImageIdx(0); return; }
    const img = product.colorSwatches?.[i]?.image;
    if (img) {
      const merged = product.images.includes(img)
        ? product.images
        : [...product.images, img];
      const gi = merged.indexOf(img);
      if (gi >= 0) setImageIdx(gi);
    } else {
      setImageIdx(0); // walang recolored — balik sa full shot
    }
  }
  const hasSize = SIZED_CATEGORIES.includes(product.category);

  // Kung may custom na bedSizes ang product, gamitin yun (may sariling
  // presyo bawat size); kung wala, ang default na adjustment table.
  const customSizes = (product.bedSizes ?? []).filter((s) => s.enabled !== false);
  const SIZES = customSizes.length
    ? customSizes.map((s) => ({ id: s.size, adj: 0, price: s.price }))
    : DEFAULT_SIZES.map((s) => ({ id: s.id, adj: s.adj, price: undefined as number | undefined }));

  const activeSizeOpt = SIZES.find((s) => s.id === size) ?? SIZES[0];
  // Presyo: kung may custom na price sa size, yun; kung wala, base + adjustment
  // Ang size adjustment ay hindi dapat makapagpababa sa presyo nang wala
  // sa 0 — mangyayari yun kung placeholder pa ang base price (hal. ₱1).
  const basePrice = Math.max(
    0,
    hasSize
      ? activeSizeOpt?.price ?? product.price + (activeSizeOpt?.adj ?? 0)
      : product.price,
  );

  // Add-ons (wall padding, headboard) — per-size ang sukat at presyo kung
  // may `bySize`; kung wala, ang default na detail/price ang gagamitin.
  const [pickedAddOns, setPickedAddOns] = useState<string[]>([]);
  const addOns = (product.addOns ?? [])
    .map((a) => {
      const perSize = a.bySize?.[size];
      return {
        ...a,
        detail: perSize?.detail ?? a.detail,
        price: perSize?.price ?? a.price,
      };
    })
    // Itago LANG kung walang presyo (0) — ang may presyo, laging lumalabas
    // sa LAHAT ng size (hindi na nakadepende sa laki ng halaga).
    .filter((a) => a.price > 0);
  // 4 PCS BUILT-IN SIDE DRAWERS (2026-08-23): Double/Full, Queen, King lang -
  // ang gating ay nasa bySize ng add-on (price 0 sa ibang sukat = nakatago sa
  // filter sa itaas). Dito ang "no other add-ons will reflect": kapag ito ang
  // pinili, bawal ang ibang add-on sa parehong group, at kabaligtaran.
  const isFourDrawers = (a: { label: string }) => /(^|\D)4\s*(pcs\.?\s*)?(built-?in\s*)?(side\s*)?drawers?\b/i.test(a.label);
  const grpOf = (a: { group?: string }) => a.group || "Add-ons";
  const fourAddOn = addOns.find(isFourDrawers);
  const fourOn = !!fourAddOn && pickedAddOns.includes(fourAddOn.id);
  const isSibling = (a: { id: string; group?: string }) => !!fourAddOn && a.id !== fourAddOn.id && grpOf(a) === grpOf(fourAddOn);
  const siblingOn = addOns.some((a) => isSibling(a) && pickedAddOns.includes(a.id));
  // Dami para sa per-unit na add-on (hal. karagdagang headboard height /ft)
  const [addOnQty, setAddOnQty] = useState<Record<string, number>>({});
  // Aling add-on group ang bukas — LAHAT NAKA-MINIMIZE sa unang load
  const [openGroups, setOpenGroups] = useState<string[]>([]);
  const addOnTotal = addOns
    .filter((a) => pickedAddOns.includes(a.id))
    .reduce((sum, a) => {
      // Range na presyo (may priceMax) — HINDI kasama sa total, kumpirmado
      // sa order. Per-unit — presyo × dami.
      if (a.priceMax) return sum;
      if (a.perUnit) return sum + a.price * (addOnQty[a.id] ?? 1);
      return sum + a.price;
    }, 0);
  const price = basePrice + addOnTotal;
  // May napiling add-on ba na kailangan pang kumpirmahin ang presyo?
  const hasQuotedAddOn = addOns.some(
    (a) => pickedAddOns.includes(a.id) && a.priceMax
  );
  const compareAt = product.compareAtPrice
    ? product.compareAtPrice + (hasSize && !activeSizeOpt?.price ? activeSizeOpt?.adj ?? 0 : 0)
    : null;
  // Promo galing sa site.json — pwedeng i-off/on sa admin
  const promo = (site as any).promo ?? { enabled: false, code: "", rate: 0 };
  const PROMO_CODE = promo.code || "";
  const promoOn = promo.enabled && promo.rate > 0;
  const promoPrice = price * (1 - (promoOn ? promo.rate / 100 : 0));

  // Shipping estimator — rates galing sa site.json (editable sa admin)
  const SHIP_PROVINCES: any[] = (site as any).shipping?.provinces ?? [];
  const [shipOpen, setShipOpen] = useState(false);
  const [shipProvince, setShipProvince] = useState("");
  const [shipCity, setShipCity] = useState("");
  const shipCityList =
    SHIP_PROVINCES.find((p) => p.name === shipProvince)?.cities ?? [];
  const shipFee =
    shipCityList.find((c: any) => c.name === shipCity)?.fee ?? null;

  const wished = wishlist.includes(product.slug);
  const rating = averageRating(product) ?? 5;

  function handleAdd() {
    // Kung walang kulay ang product, size lang ang ilalagay (iwas "undefined")
    const baseLabel = [color, hasSize ? size : null]
      .filter(Boolean)
      .join(" / ") || product.name;
    const picked = addOns.filter((a) => pickedAddOns.includes(a.id));
    // Variant key — kailangang unique per kombinasyon (para hindi mag-merge
    // ang magkaibang add-on set sa iisang cart line)
    const variantKey = picked.length
      ? `${baseLabel} + ${picked.map((a) => a.id).join("+")}`
      : baseLabel;
    // Structured breakdown para sa malinis na cart/checkout display
    const addOnLines = picked.map((a) => {
      const qtyUnit = a.perUnit ? (addOnQty[a.id] ?? 1) : 1;
      return {
        label: a.perUnit
          ? `${a.label} (${qtyUnit} ${a.perUnit})`
          : a.label,
        price: a.priceMax ? 0 : a.price * qtyUnit,
        note: a.priceMax
          ? `${formatPrice(a.price)} – ${formatPrice(a.priceMax)} · confirmed on order`
          : undefined,
      };
    });
    addToCart(product.slug, variantKey, qty, price, {
      baseLabel,
      basePrice,
      addOns: addOnLines,
    });
    setAdded(true);
    setTimeout(() => setAdded(false), 2000);
  }

  // Buy now — idagdag sa cart tapos diretso sa checkout.
  function handleBuyNow() {
    handleAdd();
    router.push("/checkout");
  }

  function copyCode() {
    try {
      navigator.clipboard.writeText(PROMO_CODE);
    } catch {}
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  }


  return (
    <div className="grid grid-cols-1 lg:grid-cols-[55%_1fr] gap-10">
      {/* ---------- FULLSCREEN LIGHTBOX ---------- */}
      {lightbox && (
        <div className="fixed inset-0 z-[100] bg-ink/90 flex items-center justify-center p-4">
          <button
            onClick={() => setLightbox(false)}
            aria-label="Close"
            className="absolute top-5 right-6 text-cream text-4xl leading-none z-10"
          >
            ×
          </button>
          <button
            onClick={() => setImageIdx((imageIdx - 1 + galleryImages.length) % galleryImages.length)}
            aria-label="Previous"
            className="absolute left-4 top-1/2 -translate-y-1/2 w-12 h-12 rounded-full bg-cream/20 hover:bg-cream/40 text-cream text-2xl z-10"
          >
            ‹
          </button>
          <div className="relative w-full h-full max-w-5xl" onClick={() => setLightbox(false)}>
            <Image src={galleryImages[imageIdx]} alt={product.name} fill className="object-contain" sizes="100vw" />
          </div>
          <button
            onClick={() => setImageIdx((imageIdx + 1) % galleryImages.length)}
            aria-label="Next"
            className="absolute right-4 top-1/2 -translate-y-1/2 w-12 h-12 rounded-full bg-cream/20 hover:bg-cream/40 text-cream text-2xl z-10"
          >
            ›
          </button>
        </div>
      )}

      {/* ---------- GALLERY ---------- */}
      <div>
        {/* MOBILE: swipe carousel na may dots — kagaya ng tunay na site */}
        <div className="lg:hidden -mx-6">
          <div
            ref={galleryTrack}
            className="flex overflow-x-auto snap-x snap-mandatory [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
            onScroll={(e) => {
              const el = e.currentTarget;
              const idx = Math.round(el.scrollLeft / el.clientWidth);
              if (idx !== imageIdx) setImageIdx(idx);
            }}
            onTouchStart={gallerySwipe.onTouchStart}
            onTouchMove={gallerySwipe.onTouchMove}
            onTouchEnd={gallerySwipe.onTouchEnd}
            onTouchCancel={gallerySwipe.onTouchCancel}
          >
            {galleryImages.map((img, i) => (
              <button
                key={img}
                onClick={() => setLightbox(true)}
                className="relative w-full shrink-0 snap-center aspect-square bg-white"
                aria-label={`Image ${i + 1}`}
              >
                <Image
                  src={img}
                  alt={product.name}
                  fill
                  priority={i === 0}
                  // Eager ang lahat ng gallery images — kapag LAZY at nag-load
                  // habang nag-sw-swipe, nasisira ang snap-point cache ng iOS
                  // WebKit at nagfi-freeze ang gallery pagkatapos ng unang hagod.
                  loading="eager"
                  className="object-contain"
                  sizes="100vw"
                />
              </button>
            ))}
          </div>
          {/* Dots */}
          {galleryImages.length > 1 && (
            <div className="flex justify-center gap-1.5 mt-3">
              {galleryImages.map((_, i) => (
                <span
                  key={i}
                  className={`w-1.5 h-1.5 rounded-full transition-colors ${
                    i === imageIdx ? "bg-ink" : "bg-stone/40"
                  }`}
                />
              ))}
            </div>
          )}
        </div>

        {/* DESKTOP (2026-09-04 mockup): 72px na puting thumbs sa kaliwa (hover =
            palit agad), puting stage na may hover-to-zoom; click = fullscreen. */}
        <div className="hidden lg:grid grid-cols-[72px_1fr] gap-3.5 items-start">
          <div className="relative">
            <div
              ref={thumbRailRef}
              className="flex flex-col gap-2.5 max-h-[640px] overflow-auto [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
            >
              {galleryImages.map((img, i) => (
                <button
                  key={img}
                  onClick={() => setImageIdx(i)}
                  onMouseEnter={() => setImageIdx(i)}
                  className={`relative w-[72px] h-[72px] bg-white border shrink-0 p-1.5 ${i === imageIdx ? "border-ink" : "border-sand hover:border-stone/60"}`}
                  aria-label={`Image ${i + 1}`}
                >
                  <Image src={img} alt="" fill className="object-contain p-1.5" sizes="72px" />
                </button>
              ))}
            </div>
            {galleryImages.length > 7 && (
              <button
                onClick={() => thumbRailRef.current?.scrollBy({ top: 220, behavior: "smooth" })}
                className="absolute bottom-0 left-1/2 flex h-8 w-12 -translate-x-1/2 items-center justify-center bg-white/90 shadow-md hover:bg-white"
                aria-label="Scroll thumbnails down"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M6 9l6 6 6-6" /></svg>
              </button>
            )}
          </div>
          <button
            onClick={() => setLightbox(true)}
            onMouseMove={(e) => { const r = e.currentTarget.getBoundingClientRect(); setZoom({ x: ((e.clientX - r.left) / r.width) * 100, y: ((e.clientY - r.top) / r.height) * 100 }); }}
            onMouseLeave={() => setZoom(null)}
            className="relative aspect-square w-full bg-white border border-sand overflow-hidden cursor-zoom-in"
            aria-label="Open fullscreen gallery"
          >
            <Image src={galleryImages[imageIdx]} alt={product.name} fill priority className="object-contain p-8" sizes="620px" />
            <span
              aria-hidden
              className={`pointer-events-none absolute inset-0 bg-white bg-no-repeat transition-opacity duration-150 ${zoom ? "opacity-100" : "opacity-0"}`}
              style={{ backgroundImage: `url("${galleryImages[imageIdx]}")`, backgroundSize: "220%", backgroundPosition: zoom ? `${zoom.x}% ${zoom.y}%` : "center" }}
            />
            <span className="absolute bottom-3 right-3 bg-cream/90 text-stone text-[11px] px-2 py-1">Hover to zoom · click for full screen</span>
          </button>
        </div>
      </div>

      {/* ---------- INFO ---------- */}
      <div>
        {/* Eyebrow (category) · pangalan · rating — mockup 2026-09-04 */}
        {categoryTitle && <p className="text-[11px] font-bold tracking-[0.16em] uppercase text-goldDeep">{categoryTitle}</p>}
        <h1 className="font-cormorant font-semibold text-3xl sm:text-4xl leading-[1.1] mt-1.5">
          {product.name}
          {mtoActive && mtoView === "mto" ? " — Made to Order" : ""}
        </h1>
        <a href="#reviews" className="inline-flex items-center gap-2 mt-2 text-xs text-stone hover:opacity-70">
          <span className="text-goldDeep tracking-[2px] text-[13px]">
            {"★".repeat(Math.round(rating))}
            {"☆".repeat(5 - Math.round(rating))}
          </span>
          <span>{rating.toFixed(1)}{product.reviews?.length ? ` · ${product.reviews.length} reviews` : ""}</span>
        </a>
        <div className="mb-4" />

        {/* MADE-TO-ORDER panel — pumapalit sa classic options kapag may
            published config ang item sa IMS configurator. */}
        {(mtoActive || mtoLocked) && mto && <MtoOptions cfg={mto} product={product} site={site} locked={mtoLocked} />}

        {/* Price block */}
        {!hideOpts && (
        <div className="flex items-baseline gap-3 flex-wrap border-y border-sand py-3.5">
          <span className="text-[28px] font-semibold">{formatPrice(price)}</span>
          {compareAt && compareAt > price && (
            <span className="text-xs text-stone">
              <span className="line-through">{formatPrice(compareAt)}</span> Comp Value{" "}
              <span title="Comparable value of similar products" className="cursor-help">ⓘ</span>
            </span>
          )}
          {!compareAt && (
            <span className="text-xs text-stone">
              Comp Value <span title="Comparable value of similar products" className="cursor-help">ⓘ</span>
            </span>
          )}
        </div>
        )}
        {!hideOpts && promoOn && (
          <p className="mt-2 text-sm">
            or <span className="text-red-500 text-xl font-medium">{formatPrice(Math.round(promoPrice))}</span>{" "}
            with code <strong>{PROMO_CODE}</strong>{" "}
            <button onClick={copyCode} aria-label="Copy code" className="align-middle hover:opacity-60" title="Copy code">
              {copied ? "✓" : "⧉"}
            </button>
            {copied && <span className="text-green-700 text-xs ml-1">Copied!</span>}
          </p>
        )}
        {/* Color circles (mockup 2026-09-04) — itinatago kung walang kulay */}
        {!hideOpts && product.colors.length > 0 && (
          <p className="mt-4 text-[13px] font-semibold">
            Color <span className="font-normal text-stone ml-1.5">{color}</span>
          </p>
        )}
        <div className="flex gap-2.5 mt-2 flex-wrap">
          {!hideOpts && product.colors.map((c, i) => {
            const sw = product.colorSwatches?.[i];
            // Thumbnail box: tela swatch muna, tapos bed photo sa kulay
            const swatchImg =
              sw?.swatch ??
              sw?.image ??
              product.images[Math.min(i, product.images.length - 1)];
            // Malaking preview sa popup = ang TELA mismo (swatch), fallback
            // sa bed photo sa kulay na yun
            const previewImg =
              sw?.swatch ??
              sw?.image ??
              product.images[Math.min(i, product.images.length - 1)];
            const material = sw?.material ?? product.materials.split(",")[0];
            return (
              <div
                key={c}
                className="relative"
                onMouseEnter={() => setHoverColor(i)}
                onMouseLeave={() => setHoverColor(null)}
              >
                <button
                  onClick={() => pickColor(i)}
                  aria-label={c}
                  className={`relative w-11 h-11 bg-white rounded-full overflow-hidden border border-sand transition ${
                    i === colorIdx ? "ring-2 ring-ink ring-offset-2 ring-offset-cream" : "hover:border-stone/60"
                  }`}
                >
                  <Image src={swatchImg} alt={c} fill className="object-cover" sizes="44px" />
                </button>

                {/* Hover popup — malaking TELA swatch + pangalan + material */}
                {hoverColor === i && (
                  <div className="hidden md:block absolute left-0 bottom-full mb-3 z-30 w-48 bg-white rounded-lg shadow-2xl border border-sand overflow-hidden">
                    <div className="relative aspect-square bg-sand">
                      <Image src={previewImg} alt={c} fill className="object-cover" sizes="192px" />
                    </div>
                    <div className="p-3">
                      <p className="font-bold text-sm leading-tight">{c}</p>
                      {material && <p className="text-xs text-stone">{material}</p>}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Size — filled buttons */}
        {!hideOpts && hasSize && (
          <>
            <hr className="border-sand my-5" />
            <p className="text-sm">
              Size: <span className="text-stone">{size}</span>
            </p>
            <div className="flex gap-2 mt-3 flex-wrap">
              {SIZES.map((s) => (
                <button
                  key={s.id}
                  onClick={() => {
                    setSize(s.id);
                    // I-broadcast sa Dimensions tab para sabay mag-update
                    window.dispatchEvent(
                      new CustomEvent("pan-size-change", { detail: s.id })
                    );
                  }}
                  className={`px-6 py-2.5 text-sm rounded transition-colors ${
                    s.id === size
                      ? "bg-espresso text-cream"
                      : "bg-olive/70 text-cream hover:bg-olive"
                  }`}
                >
                  {s.id}
                </button>
              ))}
            </div>
          </>
        )}

        {/* Add-ons — naka-pangkat ayon sa `group` (hal. Mattress, Wall
            Padding). Kung walang group, "Add-ons" ang heading. */}
        {!hideOpts && addOns.length > 0 &&
          Object.entries(
            addOns.reduce<Record<string, typeof addOns>>((acc, a) => {
              const g = a.group || "Add-ons";
              (acc[g] ??= []).push(a);
              return acc;
            }, {})
          ).map(([groupName, items]) => {
            const open = openGroups.includes(groupName);
            const pickedInGroup = items.filter((a) =>
              pickedAddOns.includes(a.id)
            ).length;
            return (
            <div key={groupName}>
              <hr className="border-sand my-5" />
              <button
                type="button"
                onClick={() =>
                  setOpenGroups((prev) =>
                    prev.includes(groupName)
                      ? prev.filter((g) => g !== groupName)
                      : [...prev, groupName]
                  )
                }
                className="flex items-center justify-between w-full text-sm mb-3 group"
              >
                <span className="flex items-center gap-2">
                  {groupName}
                  {pickedInGroup > 0 && (
                    <span className="text-xs bg-cognac/10 text-cognac font-bold px-2 py-0.5 rounded">
                      {pickedInGroup} selected
                    </span>
                  )}
                </span>
                <span className="text-stone text-xs group-hover:text-ink">
                  {open ? "− Hide" : `+ ${items.length} options`}
                </span>
              </button>
              <div className={`space-y-2 ${open ? "" : "hidden"}`}>
                {items.map((a) => {
                  const on = pickedAddOns.includes(a.id);
                  const blocked = (fourOn && isSibling(a)) || (isFourDrawers(a) && siblingOn);
                  return (
                    <label
                      key={a.id}
                      className={`flex items-center gap-3 border rounded px-4 py-3 transition-colors ${
                        blocked ? "border-stone/20 opacity-50 cursor-not-allowed" : on ? "border-cognac bg-cognac/5 cursor-pointer" : "border-stone/30 hover:border-stone/60 cursor-pointer"
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={on}
                        disabled={blocked}
                        onChange={() =>
                          setPickedAddOns((prev) =>
                            prev.includes(a.id)
                              ? prev.filter((x) => x !== a.id)
                              : isFourDrawers(a) ? [...prev.filter((x) => !addOns.some((o) => o.id === x && isSibling(o))), a.id] : [...prev, a.id]
                          )
                        }
                        className="accent-cognac w-4 h-4"
                      />
                      <span className="flex-1">
                        <span className="block text-sm font-medium">{a.label}</span>
                        {blocked && !on && (<span className="block text-xs text-stone">{isFourDrawers(a) ? "remove the other add-ons first" : "not available with 4 pcs drawers"}</span>)}
                        {a.detail && (
                          <span className="block text-xs text-stone">{a.detail}</span>
                        )}
                        {a.priceMax && (
                          <span className="block text-xs text-stone">
                            Final price confirmed on order
                          </span>
                        )}
                      </span>

                      {/* Dami — para sa per-unit na add-on (hal. /ft) */}
                      {a.perUnit && on && (
                        <span
                          className="flex items-center border border-stone/40 rounded"
                          onClick={(e) => e.preventDefault()}
                        >
                          <button
                            type="button"
                            onClick={() =>
                              setAddOnQty((q) => ({
                                ...q,
                                [a.id]: Math.max(1, (q[a.id] ?? 1) - 1),
                              }))
                            }
                            className="px-2 py-1 text-sm hover:text-cognac"
                          >
                            −
                          </button>
                          <span className="w-10 text-center text-xs">
                            {addOnQty[a.id] ?? 1} {a.perUnit}
                          </span>
                          <button
                            type="button"
                            onClick={() =>
                              setAddOnQty((q) => ({
                                ...q,
                                [a.id]: (q[a.id] ?? 1) + 1,
                              }))
                            }
                            className="px-2 py-1 text-sm hover:text-cognac"
                          >
                            +
                          </button>
                        </span>
                      )}

                      <span className="text-sm font-bold whitespace-nowrap">
                        {a.priceMax ? (
                          `${formatPrice(a.price)} – ${formatPrice(a.priceMax)}`
                        ) : a.perUnit ? (
                          on ? (
                            `+${formatPrice(a.price * (addOnQty[a.id] ?? 1))}`
                          ) : (
                            `+${formatPrice(a.price)}/${a.perUnit}`
                          )
                        ) : (
                          `+${formatPrice(a.price)}`
                        )}
                      </span>
                    </label>
                  );
                })}
              </div>
            </div>
            );
          })}

        {/* MTO: ang estimator ay nasa loob na ng MTO panel (tamang ayos). */}
        {!hideOpts && (<>
        <hr className="border-sand my-5" />

        {/* Shipping estimator — pumili ng lugar, lalabas ang SF.
            Ang rates ay galing sa site.json (editable sa admin). */}
        <div className="text-sm">
          <button
            type="button"
            onClick={() => setShipOpen((v) => !v)}
            className="flex items-center gap-2 text-ink hover:text-cognac transition-colors"
          >
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.3" className="text-olive">
              <path d="M1 7h12v9H1zM13 10h5l3 3v3h-8z" />
              <circle cx="6" cy="18" r="1.8" />
              <circle cx="17" cy="18" r="1.8" />
            </svg>
            <span className="border-b border-ink/40">Estimate your shipping</span>
            <span className="text-stone text-xs">{shipOpen ? "▲" : "▼"}</span>
          </button>

          {shipOpen && (
            <div className="mt-3 border border-stone/25 rounded p-3 bg-linen/40 space-y-2">
              <select
                value={shipProvince}
                onChange={(e) => {
                  setShipProvince(e.target.value);
                  setShipCity("");
                }}
                className="w-full border border-stone/30 bg-white px-3 py-2 text-sm rounded focus:outline-none focus:border-cognac"
              >
                <option value="">Select province</option>
                {SHIP_PROVINCES.map((p: any) => (
                  <option key={p.name} value={p.name}>{p.name}</option>
                ))}
              </select>
              <select
                value={shipCity}
                disabled={!shipProvince}
                onChange={(e) => {
                  setShipCity(e.target.value);
                  // I-remember para auto-fill sa checkout
                  try {
                    localStorage.setItem(
                      "pan_ship_loc",
                      JSON.stringify({ province: shipProvince, city: e.target.value })
                    );
                  } catch {}
                }}
                className="w-full border border-stone/30 bg-white px-3 py-2 text-sm rounded focus:outline-none focus:border-cognac disabled:bg-sand/40 disabled:text-stone"
              >
                <option value="">
                  {shipProvince ? "Select city / town" : "Select a province first"}
                </option>
                {shipCityList.map((c: any) => (
                  <option key={c.name} value={c.name}>{c.name}</option>
                ))}
              </select>
              {shipFee !== null && (
                <div className="pt-2 border-t border-sand space-y-1.5">
                  <p className="flex justify-between items-baseline">
                    <span className="text-stone">
                      Estimated shipping to {shipCity}
                    </span>
                    <span className="font-bold text-cognac">
                      {formatPrice(shipFee)}
                    </span>
                  </p>
                  <p className="text-[11px] text-stone leading-snug">
                    Estimate only. Final fee is confirmed after we check your
                    exact address — you&apos;ll pin your location at checkout.
                    Far-end or boundary areas may differ.
                  </p>
                </div>
              )}
            </div>
          )}
        </div>
        </>)}

        {/* Availability + lead time — enterprise style: malinaw na
            hierarchy, may icon, at trust signals sa ilalim */}
        {!hideOpts && ((product.stock ?? 1) > 0 ? (
          <div className="mt-4 border border-sand bg-white">
            <div className="flex items-center gap-2 px-3.5 py-2.5 bg-[#E6F2EA] text-[#2F7D4F] text-[13px] font-semibold">
              <span className="h-2 w-2 rounded-full bg-[#2F7D4F]" />
              In stock{product.stock !== undefined && product.stock > 0 ? ` · ${product.stock} unit${product.stock === 1 ? "" : "s"}` : ""}
              {(product.stock ?? 99) <= 3 && <span className="ml-auto text-xs font-bold text-goldDeep">Only {product.stock} left</span>}
            </div>
            <div className="px-3.5 py-3 text-[12.5px] text-stone">
              <b className="block text-ink font-semibold text-[13.5px]">Delivery in 4–6 weeks</b>
              Made to order in San Pedro, Laguna — delivered and set up by our own team. Delivery fee shown at checkout.
            </div>
          </div>
        ) : (
          <div className="mt-4 border border-red-200 rounded-lg overflow-hidden">
            <div className="flex items-center gap-2.5 px-4 py-3 bg-red-50 border-b border-red-100">
              <span className="w-2.5 h-2.5 rounded-full bg-red-600 shrink-0" />
              <span className="text-sm font-bold text-red-800">Out of stock</span>
            </div>
            <p className="px-4 py-3 text-xs text-stone">
              Currently unavailable. Enter your email below and we&apos;ll notify
              you as soon as it&apos;s back.
            </p>
          </div>
        ))}

        {/* Qty + Add to cart / Sold out + heart */}
        {!hideOpts && (product.stock ?? 1) > 0 ? (
          <div className="flex gap-2.5 mt-3">
            <div className="flex items-center h-12 border border-sand bg-white">
              <button onClick={() => setQtyState(Math.max(1, qty - 1))} className="w-10 h-full hover:text-goldDeep" aria-label="Decrease quantity">−</button>
              <span className="w-11 text-center text-sm font-semibold">{qty}</span>
              <button onClick={() => setQtyState(qty + 1)} className="w-10 h-full hover:text-goldDeep" aria-label="Increase quantity">+</button>
            </div>
            <button
              onClick={handleAdd}
              className="flex-1 h-12 border-[1.5px] border-brown bg-white text-brown text-xs font-bold tracking-[0.14em] uppercase px-4 hover:bg-brown hover:text-cream transition-colors"
            >
              {added ? "Added ✓" : "Add to cart"}
            </button>
            <button
              onClick={handleBuyNow}
              className="flex-1 h-12 bg-brown text-cream text-xs font-bold tracking-[0.14em] uppercase px-4 hover:bg-brownDeep transition-colors"
            >
              Buy now
            </button>
            <button
              onClick={() => toggleWishlist(product.slug)}
              aria-label="Add to wishlist"
              className="w-12 h-12 border border-sand bg-white flex items-center justify-center hover:border-goldDeep"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill={wished ? "#B87333" : "none"} stroke={wished ? "#B87333" : "#1A1A1A"} strokeWidth="1.6">
                <path d="M12 21C7 16.5 3 13 3 8.8 3 6 5.2 4 7.8 4c1.7 0 3.2.9 4.2 2.3C13 4.9 14.5 4 16.2 4 18.8 4 21 6 21 8.8c0 4.2-4 7.7-9 12.2z" />
              </svg>
            </button>
          </div>
        ) : null}

        {/* Babala kung may add-on na range ang presyo */}
        {!hideOpts && (product.stock ?? 1) > 0 && hasQuotedAddOn && (
          <p className="mt-2 text-xs text-stone bg-linen rounded px-3 py-2">
            Some selected add-ons are priced on a range — we&apos;ll confirm the
            exact amount with you before production.
          </p>
        )}

        {!hideOpts && (product.stock ?? 1) <= 0 && (
          // SOLD OUT flow — kagaya ng tunay na site
          <div className="mt-3">
            <div className="flex gap-3">
              <button
                disabled
                className="flex-1 bg-stone/50 text-cream text-base font-medium rounded py-3 px-4 cursor-not-allowed"
              >
                Sold out
              </button>
              <button
                onClick={() => toggleWishlist(product.slug)}
                aria-label="Add to wishlist"
                className="border border-stone/40 rounded px-4 hover:border-cognac"
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill={wished ? "#B87333" : "none"} stroke={wished ? "#B87333" : "#1A1A1A"} strokeWidth="1.6">
                  <path d="M12 21C7 16.5 3 13 3 8.8 3 6 5.2 4 7.8 4c1.7 0 3.2.9 4.2 2.3C13 4.9 14.5 4 16.2 4 18.8 4 21 6 21 8.8c0 4.2-4 7.7-9 12.2z" />
                </svg>
              </button>
            </div>
            {notified ? (
              <p className="mt-3 text-sm text-green-700 border border-green-200 bg-green-50 rounded py-3 px-4 text-center">
                ✓ We&apos;ll email you when it&apos;s back in stock.
              </p>
            ) : (
              <form
                onSubmit={(e) => { e.preventDefault(); if (notifyEmail.includes("@")) setNotified(true); }}
                className="mt-3 flex gap-2"
              >
                <input
                  type="email"
                  required
                  value={notifyEmail}
                  onChange={(e) => setNotifyEmail(e.target.value)}
                  placeholder="Your email"
                  className="flex-1 border border-stone/40 rounded px-4 py-3 text-sm focus:outline-none focus:border-cognac"
                />
                <button type="submit" className="border border-ink rounded px-5 text-sm font-bold hover:bg-ink hover:text-cream transition-colors">
                  Email me when available
                </button>
              </form>
            )}
          </div>
        )}

        {/* Contact us for more information — opens Messenger with the product
            slug as the ref. m.me only preserves a limited charset (spaces and
            em-dashes get mangled), so we send just the slug; the IMS webhook
            looks the name + photo back up from the catalogue. */}
        {(() => {
          const handle = messengerHandle((site as any).social?.facebook);
          if (!handle) return null;
          const ref = `product_${product.slug}`;
          return (
            <a
              href={messengerUrl(handle, ref)}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => {
                // Sa mobile, ang bagong-tab na m.me redirect ay nawawalan ng
                // thread target sa hand-off papuntang Messenger app (bumubukas
                // sa inbox lang). Same-tab navigation ang maaasahang daan.
                if (/Android|iPhone|iPad/i.test(navigator.userAgent)) {
                  e.preventDefault();
                  window.location.href = messengerUrl(handle, ref);
                }
              }}
              className="mt-3 flex items-center justify-center gap-2 w-full h-12 border-[1.5px] border-ink bg-white px-4 text-xs font-bold tracking-[0.14em] uppercase hover:bg-ink hover:text-cream transition-colors"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
                <path d="M12 2C6.5 2 2 6.14 2 11.25c0 2.88 1.42 5.45 3.65 7.15V22l3.34-1.83c.96.27 1.97.41 3.01.41 5.5 0 10-4.14 10-9.25S17.5 2 12 2zm1.03 12.42l-2.54-2.71-4.96 2.71 5.45-5.79 2.6 2.71 4.9-2.71-5.45 5.79z"/>
              </svg>
              Ask about this item on Messenger
            </a>
          );
        })()}

        {/* Will it fit? + View dimensions, tapos trust list (mockup 2026-09-04) */}
        <div className="flex flex-wrap items-center gap-6 mt-5">
          {packaged && <FitModal name={product.name} packaged={packaged} />}
          <a href="#dimensions" className="text-[11.5px] font-bold tracking-[0.14em] uppercase border-b-[1.5px] border-goldDeep pb-0.5 hover:text-goldDeep transition-colors">
            View dimensions
          </a>
        </div>
        <ul className="mt-4 pt-3.5 border-t border-sand flex flex-col gap-1.5 text-[12.5px] text-stone">
          {["6-month warranty on frame, foam and workmanship", "Delivered nationwide by our own team · live tracking", "Pay via GCash, Maya, BDO, BPI or cash"].map((t) => (
            <li key={t} className="flex items-center gap-2"><span className="h-1.5 w-1.5 bg-goldDeep shrink-0" />{t}</li>
          ))}
        </ul>
      </div>
    </div>
  );
}
