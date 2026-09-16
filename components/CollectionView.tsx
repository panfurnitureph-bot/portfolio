"use client";

// Client-side na product grid na may filter sidebar (price, color,
// material, category) at sort dropdown.

import Image from "next/image";
import Link from "next/link";
import { useMemo, useRef, useState } from "react";
import type { LibrarySwatch, Product } from "@/lib/products";
import ProductCard from "@/components/ProductCard";

export type SubnavLink = { label: string; href: string; active: boolean };

type SortKey = "featured" | "price-asc" | "price-desc" | "new";

// Ang mga tunay na kulay (swatch names) ng isang product — para sa filter na
// may TUNAY na swatch image (tela mismo), hindi generic na tuldok.
function swatchNamesOf(p: Product): string[] {
  const names = new Set<string>();
  for (const c of p.colors ?? []) names.add(c);
  for (const s of p.colorSwatches ?? []) names.add(s.name);
  return Array.from(names);
}

// Kunin ang swatch image (o hex) para sa isang color name — mula library
// muna, tapos sa product's sariling swatch, tapos fallback na kulay.
// Ang `swatches` ay ipinapasa ng server page — kagaya ng findSwatch(),
// lowercase ang paghahambing ng pangalan.
function swatchVisual(
  name: string,
  products: Product[],
  swatchByName: Map<string, LibrarySwatch>
): { image?: string; hex?: string } {
  const lib = swatchByName.get(name.toLowerCase());
  if (lib?.swatch) return { image: lib.swatch, hex: lib.color };
  for (const p of products) {
    const s = (p.colorSwatches ?? []).find((x) => x.name === name);
    if (s?.swatch) return { image: s.swatch, hex: undefined };
  }
  return { hex: lib?.color ?? "#cccccc" };
}

function materialsOf(p: Product): string[] {
  const set = new Set<string>();
  for (const s of p.colorSwatches ?? []) if (s.material) set.add(s.material);
  // fallback: materials text field
  const txt = (p.materials ?? "").toLowerCase();
  for (const m of ["Fabric", "Leather", "Velvet", "Wood", "Metal"]) {
    if (txt.includes(m.toLowerCase())) set.add(m);
  }
  return Array.from(set);
}

function sizesOf(p: Product): string[] {
  return (p.bedSizes ?? [])
    .filter((b) => b.enabled !== false && b.size)
    .map((b) => b.size);
}

// Ang `swatches` ay galing sa server page (naka-prime na mula sa Supabase) —
// hindi kasi umaabot dito ang naka-prime na swatchLibrary sa browser.
export default function CollectionView({
  products,
  swatches,
  subnav = [],
}: {
  products: Product[];
  swatches: LibrarySwatch[];
  subnav?: SubnavLink[];
}) {
  // Mabilis na lookup: swatch name (lowercase) -> library entry
  const swatchByName = useMemo(
    () => new Map(swatches.map((s) => [s.name.toLowerCase(), s])),
    [swatches]
  );
  const [sort, setSort] = useState<SortKey>("featured");
  const [inStockOnly, setInStockOnly] = useState(false);
  const [colorFilters, setColorFilters] = useState<string[]>([]);
  const [materialFilters, setMaterialFilters] = useState<string[]>([]);
  const [sizeFilters, setSizeFilters] = useState<string[]>([]);
  const [categoryFilters, setCategoryFilters] = useState<string[]>([]);
  const [filtersOpen, setFiltersOpen] = useState(false);

  // Price bounds mula sa products (para sa slider)
  const priceBounds = useMemo(() => {
    const prices = products.map((p) => p.price).filter((n) => n > 0);
    if (!prices.length) return { min: 0, max: 0 };
    return { min: Math.floor(Math.min(...prices)), max: Math.ceil(Math.max(...prices)) };
  }, [products]);
  const [priceMin, setPriceMin] = useState(priceBounds.min);
  const [priceMax, setPriceMax] = useState(priceBounds.max);
  // I-reset ang slider kapag nagbago ang product list (ibang collection)
  const boundsKey = `${priceBounds.min}-${priceBounds.max}`;
  const lastBounds = useRef(boundsKey);
  if (lastBounds.current !== boundsKey) {
    lastBounds.current = boundsKey;
    setPriceMin(priceBounds.min);
    setPriceMax(priceBounds.max);
  }
  const priceActive = priceMin > priceBounds.min || priceMax < priceBounds.max;

  // Available na kulay (tunay na swatch names) + kanilang swatch image
  const availColors = useMemo(() => {
    const names = Array.from(new Set(products.flatMap(swatchNamesOf))).sort();
    return names.map((name) => ({ name, ...swatchVisual(name, products, swatchByName) }));
  }, [products, swatchByName]);
  const availMaterials = useMemo(
    () => Array.from(new Set(products.flatMap(materialsOf))).sort(),
    [products]
  );
  const availSizes = useMemo(() => {
    const order = ["Single", "Twin", "Double/Full", "Queen", "King", "King 2"];
    const present = new Set(products.flatMap(sizesOf));
    return order.filter((s) => present.has(s));
  }, [products]);
  const allCategories = useMemo(
    () => Array.from(new Set(products.map((p) => p.category))).sort(),
    [products]
  );

  function toggle<T>(list: T[], value: T, setter: (v: T[]) => void) {
    setter(list.includes(value) ? list.filter((v) => v !== value) : [...list, value]);
  }

  const activeCount =
    (inStockOnly ? 1 : 0) + (priceActive ? 1 : 0) + colorFilters.length +
    materialFilters.length + sizeFilters.length + categoryFilters.length;

  function clearAll() {
    setInStockOnly(false);
    setPriceMin(priceBounds.min); setPriceMax(priceBounds.max);
    setColorFilters([]); setMaterialFilters([]);
    setSizeFilters([]); setCategoryFilters([]);
  }

  const filtered = useMemo(() => {
    let result = products;

    if (inStockOnly) result = result.filter((p) => (p.stock ?? 0) > 0);
    if (priceActive) {
      result = result.filter((p) => p.price >= priceMin && p.price <= priceMax);
    }
    if (colorFilters.length) {
      result = result.filter((p) => swatchNamesOf(p).some((c) => colorFilters.includes(c)));
    }
    if (materialFilters.length) {
      result = result.filter((p) => materialsOf(p).some((m) => materialFilters.includes(m)));
    }
    if (sizeFilters.length) {
      result = result.filter((p) => sizesOf(p).some((s) => sizeFilters.includes(s)));
    }
    if (categoryFilters.length) {
      result = result.filter((p) => categoryFilters.includes(p.category));
    }

    switch (sort) {
      case "price-asc":
        return [...result].sort((a, b) => a.price - b.price);
      case "price-desc":
        return [...result].sort((a, b) => b.price - a.price);
      case "new":
        return [...result].sort((a, b) => Number(b.isNew) - Number(a.isNew));
      default:
        return [...result].sort((a, b) => Number(b.featured) - Number(a.featured));
    }
  }, [products, sort, inStockOnly, priceActive, priceMin, priceMax, colorFilters, materialFilters, sizeFilters, categoryFilters]);

  // Subcategory links — sidebar sa desktop (kagaya ng tunay na site)
  const subnavSection = subnav.length > 0 && (
    <nav className="mb-8">
      <ul className="space-y-3">
        {subnav.map((l) => (
          <li key={l.href}>
            <Link
              href={l.href}
              className={`text-sm border-b pb-0.5 transition-colors ${
                l.active
                  ? "text-ink border-ink"
                  : "text-stone border-transparent hover:text-ink hover:border-ink"
              }`}
            >
              {l.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );

  const filterSection = (
    <div className="space-y-8">
      {/* Header + Clear all */}
      {activeCount > 0 && (
        <div className="flex items-center justify-between">
          <span className="text-xs text-stone">{activeCount} filter{activeCount > 1 ? "s" : ""} applied</span>
          <button onClick={clearAll} className="text-xs font-bold text-cognac hover:text-ink">
            Clear all
          </button>
        </div>
      )}

      {/* Availability */}
      <div>
        <h3 className="text-sm font-bold tracking-widest2 mb-3">AVAILABILITY</h3>
        <label className="flex items-center gap-2 text-sm text-stone py-1 cursor-pointer hover:text-ink">
          <input
            type="checkbox"
            checked={inStockOnly}
            onChange={() => setInStockOnly(!inStockOnly)}
            className="accent-cognac"
          />
          In stock
        </label>
      </div>

      {/* Sort by (radio, sa sidebar) */}
      <div>
        <h3 className="text-sm font-bold tracking-widest2 mb-3">SORT BY</h3>
        {[
          { key: "new", label: "Newest" },
          { key: "price-asc", label: "Price: Low to High" },
          { key: "price-desc", label: "Price: High to Low" },
        ].map((o) => (
          <label key={o.key} className="flex items-center gap-2 text-sm text-stone py-1 cursor-pointer hover:text-ink">
            <input
              type="radio"
              name="sort"
              checked={sort === o.key}
              onChange={() => setSort(o.key as SortKey)}
              className="accent-cognac"
            />
            {o.label}
          </label>
        ))}
      </div>

      {/* Price — slider na may min/max inputs (parang Poly & Bark) */}
      {priceBounds.max > priceBounds.min && (
        <div>
          <h3 className="text-sm font-bold tracking-widest2 mb-3">PRICE</h3>
          <div className="flex items-center gap-2 mb-3">
            <div className="flex-1 min-w-0 flex items-center border border-stone/40 rounded px-2 py-1.5 bg-cream">
              <span className="text-stone text-sm mr-1 shrink-0">₱</span>
              <input
                type="number"
                value={priceMin}
                min={priceBounds.min}
                max={priceMax}
                onChange={(e) => setPriceMin(Math.min(Number(e.target.value) || 0, priceMax))}
                className="no-spinner w-full min-w-0 text-sm bg-transparent focus:outline-none"
              />
            </div>
            <span className="text-stone text-sm shrink-0">to</span>
            <div className="flex-1 min-w-0 flex items-center border border-stone/40 rounded px-2 py-1.5 bg-cream">
              <span className="text-stone text-sm mr-1 shrink-0">₱</span>
              <input
                type="number"
                value={priceMax}
                min={priceMin}
                max={priceBounds.max}
                onChange={(e) => setPriceMax(Math.max(Number(e.target.value) || 0, priceMin))}
                className="no-spinner w-full min-w-0 text-sm bg-transparent focus:outline-none"
              />
            </div>
          </div>
          {/* Dual-range slider (dalawang magkapatong na range input) */}
          <div className="relative h-5">
            <div className="absolute top-1/2 -translate-y-1/2 w-full h-1 bg-sand rounded" />
            <div
              className="absolute top-1/2 -translate-y-1/2 h-1 bg-cognac rounded"
              style={{
                left: `${((priceMin - priceBounds.min) / (priceBounds.max - priceBounds.min)) * 100}%`,
                right: `${100 - ((priceMax - priceBounds.min) / (priceBounds.max - priceBounds.min)) * 100}%`,
              }}
            />
            <input
              type="range"
              min={priceBounds.min}
              max={priceBounds.max}
              value={priceMin}
              onChange={(e) => setPriceMin(Math.min(Number(e.target.value), priceMax))}
              className="range-thumb absolute w-full top-0 appearance-none bg-transparent pointer-events-none"
            />
            <input
              type="range"
              min={priceBounds.min}
              max={priceBounds.max}
              value={priceMax}
              onChange={(e) => setPriceMax(Math.max(Number(e.target.value), priceMin))}
              className="range-thumb absolute w-full top-0 appearance-none bg-transparent pointer-events-none"
            />
          </div>
        </div>
      )}

      {/* Color — list na may swatch box + buong pangalan (parang P&B) */}
      {availColors.length > 0 && (
        <div>
          <h3 className="text-sm font-bold tracking-widest2 mb-3">COLOR</h3>
          <div className="space-y-1">
            {availColors.map((c) => {
              const active = colorFilters.includes(c.name);
              return (
                <button
                  key={c.name}
                  type="button"
                  onClick={() => toggle(colorFilters, c.name, setColorFilters)}
                  className={`flex items-center gap-2.5 w-full py-1 text-sm text-left transition ${
                    active ? "text-ink font-medium" : "text-stone hover:text-ink"
                  }`}
                >
                  <span
                    className={`relative w-6 h-6 rounded overflow-hidden border-2 shrink-0 transition ${
                      active ? "border-cognac ring-1 ring-cognac/40" : "border-stone/25"
                    }`}
                    style={{ backgroundColor: c.hex ?? "#eee" }}
                  >
                    {c.image && (
                      <Image src={c.image} alt={c.name} fill className="object-cover" sizes="24px" />
                    )}
                  </span>
                  {c.name}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Material */}
      {availMaterials.length > 0 && (
        <div>
          <h3 className="text-sm font-bold tracking-widest2 mb-3">MATERIAL</h3>
          {availMaterials.map((m) => (
            <label key={m} className="flex items-center gap-2 text-sm text-stone py-1 cursor-pointer hover:text-ink">
              <input
                type="checkbox"
                checked={materialFilters.includes(m)}
                onChange={() => toggle(materialFilters, m, setMaterialFilters)}
                className="accent-cognac"
              />
              {m}
            </label>
          ))}
        </div>
      )}

      {/* Mattress Size */}
      {availSizes.length > 0 && (
        <div>
          <h3 className="text-sm font-bold tracking-widest2 mb-3">SIZE</h3>
          {availSizes.map((s) => (
            <label key={s} className="flex items-center gap-2 text-sm text-stone py-1 cursor-pointer hover:text-ink">
              <input
                type="checkbox"
                checked={sizeFilters.includes(s)}
                onChange={() => toggle(sizeFilters, s, setSizeFilters)}
                className="accent-cognac"
              />
              {s}
            </label>
          ))}
        </div>
      )}

      {/* Product Type (ipakita lang kung may higit sa isang category) */}
      {allCategories.length > 1 && (
        <div>
          <h3 className="text-sm font-bold tracking-widest2 mb-3">PRODUCT TYPE</h3>
          {allCategories.map((c) => (
            <label key={c} className="flex items-center gap-2 text-sm text-stone py-1 cursor-pointer hover:text-ink capitalize">
              <input
                type="checkbox"
                checked={categoryFilters.includes(c)}
                onChange={() => toggle(categoryFilters, c, setCategoryFilters)}
                className="accent-cognac"
              />
              {c.replace(/-/g, " ")}
            </label>
          ))}
        </div>
      )}
    </div>
  );

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[220px_1fr] gap-10">
      {/* Sidebar (desktop): subcategories + filters */}
      <aside className="hidden lg:block">
        {subnavSection}
        {filterSection}
      </aside>

      <div>
        {/* Toolbar */}
        <div className="flex items-center justify-between mb-6">
          <button
            className="lg:hidden flex items-center gap-2 text-sm text-ink"
            onClick={() => setFiltersOpen(!filtersOpen)}
          >
            Filter & Sort{activeCount > 0 && ` (${activeCount})`}
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
              <path d="M4 7h16M7 12h10M10 17h4" />
            </svg>
          </button>
          <span className="text-sm text-stone ml-auto lg:ml-0">
            {filtered.length} {filtered.length === 1 ? "product" : "products"}
          </span>
        </div>

        {/* Mobile filters */}
        {filtersOpen && (
          <div className="lg:hidden border border-sand p-5 mb-6">{filterSection}</div>
        )}

        {/* Grid */}
        {filtered.length === 0 ? (
          <p className="text-stone text-sm py-16 text-center">
            No products match your filters. Try removing some filters.
          </p>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-x-4 gap-y-10">
            {filtered.map((p) => (
              <ProductCard key={p.slug} product={p} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
