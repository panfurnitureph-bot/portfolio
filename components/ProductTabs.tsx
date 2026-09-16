"use client";

// Full-width na horizontal tabs sa ilalim ng product detail — tulad ng
// tunay na site: serif na nakasentro (Description & Features |
// Dimensions | Details & Care | Shipping, Returns & Warranty).
// Ang Shipping tab ay 3-column na may icons.

import Image from "next/image";
import { useEffect, useState } from "react";
import type { Product } from "@/lib/products";
import FrameDiagram, { DEFAULT_BED_SIZES } from "@/components/FrameDiagram";
import MattressDiagram, { splitDim } from "@/components/MattressDiagram";

const TABS = [
  { id: "description", label: "Description & Features" },
  { id: "dimensions", label: "Dimensions" },
  { id: "care", label: "Details & Care" },
  { id: "shipping", label: "Shipping, Returns & Warranty" },
];

// Hilahin ang W/D/H mula sa dimensions text (hal. `84.5" W x 38" D x 32" H`)
function parseDims(s: string): { w?: string; d?: string; h?: string } {
  const grab = (re: RegExp) => s.match(re)?.[1];
  return {
    w: grab(/([\d.]+)\s*(?:"|”|in)?\s*W/i),
    d: grab(/([\d.]+)\s*(?:"|”|in)?\s*D(?![a-z])/i),
    h: grab(/([\d.]+)\s*(?:"|”|in)?\s*H/i),
  };
}

// Simpleng line diagram na may sukat na arrows (front view)
function DimensionDiagram({ w, h, d }: { w?: string; d?: string; h?: string }) {
  return (
    <svg viewBox="0 0 300 210" className="w-full max-w-sm mx-auto text-ink">
      {/* produkto (kahon) */}
      <rect x="60" y="40" width="180" height="110" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <line x1="60" y1="150" x2="45" y2="170" stroke="currentColor" strokeWidth="1.5" />
      <line x1="240" y1="150" x2="255" y2="170" stroke="currentColor" strokeWidth="1.5" />
      {/* width arrow */}
      <line x1="60" y1="22" x2="240" y2="22" stroke="currentColor" strokeWidth="1" />
      <path d="M60 22l6 -3v6zM240 22l-6 -3v6z" fill="currentColor" />
      <text x="150" y="16" textAnchor="middle" fontSize="11" fill="currentColor">
        {w ? `${w}" W` : "Width"}
      </text>
      {/* height arrow */}
      <line x1="272" y1="40" x2="272" y2="150" stroke="currentColor" strokeWidth="1" />
      <path d="M272 40l-3 6h6zM272 150l-3 -6h6z" fill="currentColor" />
      <text x="281" y="100" fontSize="11" fill="currentColor" transform="rotate(90 281 100)" textAnchor="middle">
        {h ? `${h}" H` : "Height"}
      </text>
      {/* depth arrow (pahilis) */}
      <line x1="20" y1="192" x2="52" y2="164" stroke="currentColor" strokeWidth="1" />
      <path d="M20 192l7 -1l-4 -5zM52 164l-7 1l4 5z" fill="currentColor" />
      <text x="18" y="205" fontSize="11" fill="currentColor">
        {d ? `${d}" D` : "Depth"}
      </text>
    </svg>
  );
}

// Mga size ng kama (pareho ng size selector sa itaas)
const BED_SIZES = [
  { id: "Twin", w: '39"', l: '75"' },
  { id: "Full", w: '54"', l: '75"' },
  { id: "Queen", w: '60"', l: '80"' },
  { id: "King", w: '76"', l: '80"' },
];

// Dimensions tab: shared size state — pag pinili ang isang size sa
// FrameDiagram, ang left specs ay nag-hi-highlight sa napiling size.
function DimensionsPanel({ product }: { product: Product }) {
  // Ang mattress ay may sariling sukat (kapal × lapad × haba) — walang frame,
  // kaya hiwalay ang panel nito sa kama.
  const isMattress = product.category === "mattress";
  // Kasama ang customized-bed — may frame din ito, kaya frame diagram ang bagay.
  const isBed =
    !isMattress && ["bed", "customized-bed", "sofa-bed", "bedroom"].includes(product.category);
  const specs = product.dimensionSpecs ?? [];
  const dims = parseDims(product.dimensions);
  // Gamitin ang custom na bedSizes ng product kung meron, kung wala default
  const bedSizes = (product.bedSizes && product.bedSizes.length
    ? product.bedSizes.filter((s: any) => s.enabled !== false)
    : DEFAULT_BED_SIZES) as typeof DEFAULT_BED_SIZES;
  const [sizeFocus, setSizeFocus] = useState<string | null>(
    isBed || isMattress ? bedSizes[0]?.size ?? null : null
  );

  // Makinig sa size selector sa taas (product info) — sabay mag-update
  useEffect(() => {
    function onSize(e: Event) {
      const id = (e as CustomEvent).detail as string;
      // I-match ang selector id (hal. "King 2", "Double/Full") sa table size
      const m = bedSizes.find(
        (s) => s.size.toLowerCase().replace(/[\s/]/g, "") === id.toLowerCase().replace(/[\s/]/g, "")
      );
      if (m) setSizeFocus(m.size);
    }
    window.addEventListener("pb-size-change", onSize);
    return () => window.removeEventListener("pb-size-change", onSize);
  }, []);

  // Ang measurements ng napiling size mula sa size table (A/B/C/D/E)
  const selected = bedSizes.find((s) => s.size === sizeFocus);

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-12 max-w-5xl mx-auto items-start">
      {/* KALIWA: para sa beds — specs ng NAPILING size lang; para sa iba —
          buong specs list */}
      <div className="text-sm">
        {isMattress && selected ? (
          // Mattress: kapal × lapad × haba lang — walang frame na sukat
          (() => {
            const d = splitDim(selected.dim);
            return (
              <div className="space-y-4">
                <div>
                  <p className="font-bold text-ink">{selected.size} Dimensions</p>
                  <p className="text-stone">{selected.dim}</p>
                </div>
                {d && (
                  <>
                    <div>
                      <p className="font-bold text-ink">T — Thickness</p>
                      <p className="text-stone">{d.thickness}&quot;</p>
                    </div>
                    <div>
                      <p className="font-bold text-ink">W — Width</p>
                      <p className="text-stone">{d.width}&quot;</p>
                    </div>
                    <div>
                      <p className="font-bold text-ink">L — Length</p>
                      <p className="text-stone">{d.length}&quot;</p>
                    </div>
                  </>
                )}
                <div>
                  <p className="font-bold text-ink">Packaged (approx.)</p>
                  <p className="text-stone">Rolled or boxed — check delivery notes</p>
                </div>
              </div>
            );
          })()
        ) : isBed && selected ? (
          // Beds: ipakita ang sukat ng napiling size (hal. SINGLE lang)
          <div className="space-y-4">
            <div>
              <p className="font-bold text-ink">{selected.size} Dimensions</p>
              <p className="text-stone">Mattress: {selected.dim}</p>
            </div>
            <div>
              <p className="font-bold text-ink">A — Width</p>
              <p className="text-stone">{selected.A}</p>
            </div>
            <div>
              <p className="font-bold text-ink">B — Headboard Height</p>
              <p className="text-stone">{selected.B}</p>
            </div>
            <div>
              <p className="font-bold text-ink">C — Length</p>
              <p className="text-stone">{selected.C}</p>
            </div>
            <div>
              <p className="font-bold text-ink">D — Base Height</p>
              <p className="text-stone">{selected.D}</p>
            </div>
            <div>
              <p className="font-bold text-ink">E — Legs</p>
              <p className="text-stone">{selected.E}</p>
            </div>
            {/* Ang add-ons (hal. wall padding) ay nasa FRAME DIMENSIONS
                table na sa kanan — hindi na inuulit dito. */}
            <div>
              <p className="font-bold text-ink">Packaged (approx.)</p>
              <p className="text-stone">Add ~2&quot; per side</p>
            </div>
          </div>
        ) : specs.length > 0 ? (
          <div className="space-y-4">
            {specs.map((s) => (
              <div key={s.label}>
                <p className="font-bold text-ink">{s.label}</p>
                <p className="text-stone whitespace-pre-line">{s.value}</p>
              </div>
            ))}
          </div>
        ) : (
          <div className="space-y-4">
            <div>
              <p className="font-bold text-ink">Overall Product Dimensions</p>
              <p className="text-stone">{product.dimensions}</p>
            </div>
            {dims.w && (
              <div>
                <p className="font-bold text-ink">Width</p>
                <p className="text-stone">{dims.w}&quot;</p>
              </div>
            )}
            {dims.h && (
              <div>
                <p className="font-bold text-ink">Height</p>
                <p className="text-stone">{dims.h}&quot;</p>
              </div>
            )}
            <div>
              <p className="font-bold text-ink">Packaged (approx.)</p>
              <p className="text-stone">Add ~2&quot; per side</p>
            </div>
          </div>
        )}
        <a href="/measuring" className="inline-flex items-center gap-2 mt-6 text-xs font-bold tracking-widest2 text-olive border-b border-olive pb-0.5 hover:text-cognac hover:border-cognac">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4">
            <circle cx="7" cy="14" r="4" /><path d="M7 10h13v5h-3v-2m-3 2v-2m-3 2v-2" />
          </svg>
          MEASURE FOR DELIVERY
        </a>
      </div>

      {/* KANAN: diagram */}
      <div>
        {isMattress ? (
          <MattressDiagram sizes={bedSizes} focus={sizeFocus} onFocus={setSizeFocus} />
        ) : isBed ? (
          <FrameDiagram
            sizes={bedSizes}
            focus={sizeFocus}
            onFocus={setSizeFocus}
            hideChips
            addOns={(product.addOns ?? []).map((a) => {
              // gamitin ang sukat/presyo ng NAPILING size kung meron
              const perSize = sizeFocus ? a.bySize?.[sizeFocus] : undefined;
              return {
                ...a,
                detail: perSize?.detail ?? a.detail,
                price: perSize?.price ?? a.price,
              };
            })}
          />
        ) : product.dimensionImage ? (
          <div className="relative aspect-[4/3] bg-white rounded p-4">
            <Image src={product.dimensionImage} alt="Dimensions" fill className="object-contain" sizes="(min-width: 768px) 500px, 100vw" />
          </div>
        ) : (
          <div className="bg-white rounded p-4">
            <DimensionDiagram {...dims} />
          </div>
        )}
      </div>
    </div>
  );
}

export default function ProductTabs({ product }: { product: Product }) {
  // Default = Dimensions para agad makita ang FRAME DIMENSIONS table
  // (hindi na kailangang pindutin ang tab o VIEW DIMENSIONS)
  const [tab, setTab] = useState("dimensions");

  // "View dimensions" link sa itaas → #dimensions → buksan ang tab
  useEffect(() => {
    function onHash() {
      if (window.location.hash === "#dimensions") setTab("dimensions");
    }
    onHash();
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  return (
    <section id="dimensions" className="bg-linen -mx-6 mt-14 scroll-mt-40">
      {/* Tab bar — serif, nakasentro */}
      <div className="flex flex-wrap justify-center gap-x-10 gap-y-2 border-b border-sand px-6 pt-6">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`font-cormorant text-lg sm:text-xl pb-3 border-b-2 -mb-px transition-colors ${
              tab === t.id
                ? "border-ink text-ink"
                : "border-transparent text-stone hover:text-ink"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="max-w-6xl mx-auto px-6 py-12 text-sm text-stone leading-relaxed">
        {tab === "description" && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-10 max-w-4xl mx-auto">
            <div>
              <h3 className="font-bold text-ink mb-3">Description</h3>
              <p>{product.description}</p>
            </div>
            <div>
              <h3 className="font-bold text-ink mb-3">Features</h3>
              <ul className="list-disc pl-5 space-y-1.5">
                <li>Quality materials, built to last</li>
                <li>Designed for everyday living</li>
                <li>Free shipping on every order</li>
                <li>Backed by our 100-Day Happiness Guarantee</li>
              </ul>
            </div>
          </div>
        )}

        {tab === "dimensions" && <DimensionsPanel product={product} />}

        {tab === "care" && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-10 max-w-4xl mx-auto">
            <div>
              <h3 className="font-bold text-ink mb-3">Materials</h3>
              <p>{product.materials}</p>
            </div>
            <div>
              <h3 className="font-bold text-ink mb-3">Care</h3>
              <p>{product.care}</p>
            </div>
          </div>
        )}

        {tab === "shipping" && (
          <div className="grid md:grid-cols-3 gap-10">
            {/* Free shipping */}
            <div>
              <p className="flex items-center gap-3 font-bold text-ink mb-4">
                <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.3">
                  <path d="M1 7h12v9H1zM13 10h5l3 3v3h-8z" />
                  <circle cx="6" cy="18" r="1.8" />
                  <circle cx="17" cy="18" r="1.8" />
                </svg>
                Free shipping on all orders*
              </p>
              <p>
                We offer <strong className="text-ink">Free</strong> Ground Shipping on all eligible orders.*
              </p>
              <p className="mt-2">
                *Certain areas excluded. Extended Area Delivery Surcharges may be added at
                checkout and are not refundable once the order ships.
              </p>
              <p className="mt-2 italic">
                Please note that all delivery dates are estimates and actual delivery times
                may vary or be subject to change.
              </p>
              <a href="/shipping" className="inline-block mt-4 text-xs font-bold tracking-widest2 border-b border-ink pb-0.5 text-ink hover:text-cognac hover:border-cognac">
                SEE MORE
              </a>
            </div>

            {/* 100-day guarantee */}
            <div>
              <p className="flex items-center gap-3 font-bold text-ink mb-4">
                <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.3">
                  <path d="M21 12a9 9 0 11-3-6.7" />
                  <path d="M21 4v4h-4" />
                  <path d="M12 10.5c-.8-.9-2.2-.9-3 0-.7.8-.7 2 0 2.8L12 16l3-2.7c.7-.8.7-2 0-2.8-.8-.9-2.2-.9-3 0z" />
                </svg>
                100-Day Happiness Guarantee
              </p>
              <p className="font-bold text-ink">Shop with Confidence — 100-Day Returns</p>
              <p className="mt-2">
                We think you&apos;ll love your new piece, but if something isn&apos;t quite
                right, our <strong className="text-ink">100-day return window</strong> has
                you covered. Please see our Shipping &amp; Returns guide for more details.
              </p>
              <a href="/shipping" className="inline-block mt-4 text-xs font-bold tracking-widest2 border-b border-ink pb-0.5 text-ink hover:text-cognac hover:border-cognac">
                SHIPPING &amp; RETURNS GUIDE
              </a>
            </div>

            {/* Warranty */}
            <div>
              <p className="flex items-center gap-3 font-bold text-ink mb-4">
                <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.3">
                  <circle cx="12" cy="9" r="5" />
                  <path d="M9 13l-2 8 5-3 5 3-2-8" />
                </svg>
                Warranty
              </p>
              <p className="font-bold text-ink">Manufacturers Warranty</p>
              <p className="mt-2">
                Things don&apos;t always go as planned. In the unlikely event your item
                arrives damaged, please get in touch with us right away. Please inspect
                items before signing for the delivery.
              </p>
              <p className="font-bold text-ink mt-3">1 Year Manufacturer&apos;s Warranty</p>
              <p className="mt-2">
                Our standard manufacturer&apos;s warranty covers defects in materials and
                workmanship for one year from the product&apos;s delivery date.
              </p>
              <a href="/faqs" className="inline-block mt-4 text-xs font-bold tracking-widest2 border-b border-ink pb-0.5 text-ink hover:text-cognac hover:border-cognac">
                LEARN MORE
              </a>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
