"use client";

// ADD-ON EDITOR — mga opsyonal na dagdag sa isang product (hal. Wall
// Padding, Headboard). Bawat isa: pangalan, sukat, at sariling presyo.
// Lumalabas bilang checkbox sa product page + row sa FRAME DIMENSIONS.

type SizeSpec = { detail?: string; price: number };
type AddOn = {
  id: string;
  label: string;
  detail?: string; // fallback na sukat, hal. 'H96" x W40"'
  price: number; // fallback na presyo
  group?: string; // pangkat sa product page (hal. "Mattress")
  bySize?: Record<string, SizeSpec>; // per-size na sukat + presyo
};

// Fallback lang kung walang bedSizes pa ang product — ang TUNAY na
// listahan ay galing sa bedSizes ng product mismo (editable sa itaas).
const FALLBACK_SIZES = ["Single", "Twin", "Double/Full", "Queen", "King", "King 2"];

// Ang mga category na may higaan — dito lang may saysay ang Wall Padding,
// Headboard, at mattress.
const BED_CATEGORIES = ["bed", "customized-bed", "sofa-bed"];

// Mga template na add-on — isang click para idagdag. Lahat ng laman
// (pangalan, sukat, presyo) ay EDITABLE pagkatapos idagdag.
// Kung may `bySize`, awtomatikong napupunan ang per-size table.
//
// Ang `categories` ang nagsasabi kung saang uri ng product lumalabas ang
// template. Ang Wall Padding at mattress ay para sa kama lang — walang
// silbi sa upuan o mesa. Kapag walang `categories`, lahat.
const PRESETS: {
  label: string;
  detail: string;
  price: number;
  group?: string; // pangkat sa product page
  // size -> presyo, o size -> { sukat, presyo }. Ang mattress ay ibinebenta
  // sa aktwal na sukat (6x36x75"), hindi sa "Single/Queen", kaya sinasama
  // natin ang tunay na sukat para yun ang makita ng customer.
  bySize?: Record<string, number | { detail: string; price: number }>;
  categories?: string[]; // saang product category ito lumalabas
}[] = [
  { label: "Wall Padding", detail: 'H96" x W40"', price: 0, categories: BED_CATEGORIES },
  { label: "Headboard", detail: 'H48" x W40"', price: 0, categories: BED_CATEGORIES },
  // ---- Uratex mattress (Enero 2026 na rate card) ----
  // Ang presyo ni Uratex ay per lapad: 36" 48" 54" 60" 72". Ganito ang
  // pagkakatugma sa size name natin — ang King at King 2 ay parehong 72",
  // kaya pareho ang presyo maliban sa Comfort Plus na may hiwalay na
  // 72x75 (₱12,000) at 72x78 (₱12,450). Iayos sa admin kung kailangan.
  {
    label: "Uratex Comfort Plus",
    detail: "6 inches thick",
    price: 5950,
    group: "Mattress",
    categories: BED_CATEGORIES,
    bySize: {
      Single: { detail: '6 x 36 x 75"', price: 5950 },
      Twin: { detail: '6 x 48 x 75"', price: 7900 },
      "Double/Full": { detail: '6 x 54 x 75"', price: 8900 },
      Queen: { detail: '6 x 60 x 75"', price: 9900 },
      King: { detail: '6 x 72 x 75"', price: 12000 },
      "King 2": { detail: '6 x 72 x 78"', price: 12450 },
    },
  },
  {
    label: "Uratex Airlite Wind",
    detail: "6 inches thick",
    price: 7250,
    group: "Mattress",
    categories: BED_CATEGORIES,
    bySize: {
      Single: { detail: '6 x 36 x 75"', price: 7250 },
      Twin: { detail: '6 x 48 x 75"', price: 9100 },
      "Double/Full": { detail: '6 x 54 x 75"', price: 10100 },
      Queen: { detail: '6 x 60 x 75"', price: 10900 },
      King: { detail: '6 x 72 x 78"', price: 12750 },
      "King 2": { detail: '6 x 72 x 78"', price: 12750 },
    },
  },
  {
    label: "Uratex Trill Air",
    detail: "5 inches thick",
    price: 7350,
    group: "Mattress",
    categories: BED_CATEGORIES,
    bySize: {
      Single: { detail: '5 x 36 x 75"', price: 7350 },
      Twin: { detail: '5 x 48 x 75"', price: 9150 },
      "Double/Full": { detail: '5 x 54 x 75"', price: 10150 },
      Queen: { detail: '5 x 60 x 75"', price: 11300 },
      King: { detail: '5 x 72 x 78"', price: 13500 },
      "King 2": { detail: '5 x 72 x 78"', price: 13500 },
    },
  },
  {
    label: "Uratex Trill Regal",
    detail: "9 inches thick",
    price: 10800,
    group: "Mattress",
    categories: BED_CATEGORIES,
    bySize: {
      Single: { detail: '9 x 36 x 75"', price: 10800 },
      Twin: { detail: '9 x 48 x 75"', price: 14000 },
      "Double/Full": { detail: '9 x 54 x 75"', price: 17250 },
      Queen: { detail: '9 x 60 x 75"', price: 18300 },
      King: { detail: '9 x 72 x 78"', price: 22650 },
      "King 2": { detail: '9 x 72 x 78"', price: 22650 },
    },
  },
  {
    label: "Uratex Trill Hybrid",
    detail: "10 inches thick",
    price: 16150,
    group: "Mattress",
    categories: BED_CATEGORIES,
    bySize: {
      Single: { detail: '10 x 36 x 75"', price: 16150 },
      Twin: { detail: '10 x 48 x 75"', price: 19400 },
      "Double/Full": { detail: '10 x 54 x 75"', price: 21550 },
      Queen: { detail: '10 x 60 x 75"', price: 22650 },
      King: { detail: '10 x 72 x 78"', price: 28000 },
      "King 2": { detail: '10 x 72 x 78"', price: 28000 },
    },
  },
  // Walang sukat — iisang presyo lahat.
  {
    label: "Gentle Bounce Pillow",
    detail: '18" x 28" · Blue / White',
    price: 370,
    group: "Pillow",
    categories: BED_CATEGORIES,
  },
];

function slugify(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

export default function AddOnEditor({
  value,
  onChange,
  bedSizes,
  category,
}: {
  value?: AddOn[];
  onChange: (addOns: AddOn[]) => void;
  // Ang aktwal na sizes ng product (mula sa Bed sizes table sa itaas) —
  // kaya kung magdagdag/magbago ka doon, sumasabay dito.
  bedSizes?: { size: string; enabled?: boolean }[];
  // Category ng product — dito nakabatay kung aling template ang lumalabas.
  category?: string;
}) {
  const rows: AddOn[] = value ?? [];
  const SIZES =
    bedSizes && bedSizes.length
      ? bedSizes.filter((s) => s.enabled !== false).map((s) => s.size)
      : FALLBACK_SIZES;

  // Ang template na walang `categories` ay pang-lahat; ang may `categories`
  // ay lumalabas lang sa mga category na nakalista. Kapag walang alam na
  // category (bagong product pa lang), ipakita lahat.
  const presets = category
    ? PRESETS.filter((p) => !p.categories || p.categories.includes(category))
    : PRESETS;

  function update(i: number, patch: Partial<AddOn>) {
    const next = rows.map((r, x) => (x === i ? { ...r, ...patch } : r));
    onChange(next);
  }

  // I-update ang isang size entry ng isang add-on
  function updateSize(i: number, size: string, patch: Partial<SizeSpec>) {
    const next = rows.map((r, x) => {
      if (x !== i) return r;
      const bySize = { ...(r.bySize ?? {}) };
      bySize[size] = { ...(bySize[size] ?? { price: r.price }), ...patch };
      return { ...r, bySize };
    });
    onChange(next);
  }

  // Buksan ang per-size table: kopyahin ang default sa lahat ng size
  function enablePerSize(i: number) {
    const r = rows[i];
    const bySize: Record<string, SizeSpec> = {};
    for (const s of SIZES) {
      bySize[s] = r.bySize?.[s] ?? { detail: r.detail, price: r.price };
    }
    update(i, { bySize });
  }
  function disablePerSize(i: number) {
    const next = rows.map((r, x) => {
      if (x !== i) return r;
      const { bySize, ...rest } = r;
      return rest as AddOn;
    });
    onChange(next);
  }
  function remove(i: number) {
    onChange(rows.filter((_, x) => x !== i));
  }
  function addPreset(p: (typeof PRESETS)[number]) {
    if (rows.some((r) => r.id === slugify(p.label))) return; // iwas doble
    // AUTO-FILL sa LAHAT ng size. Kung may per-size na presyo ang preset
    // (hal. mattress), yun ang gagamitin; kung wala, pare-pareho.
    const bySize: Record<string, SizeSpec> = {};
    for (const s of SIZES) {
      const spec = p.bySize?.[s];
      bySize[s] =
        typeof spec === "object"
          ? { detail: spec.detail, price: spec.price } // may sariling sukat (mattress)
          : { detail: p.detail, price: spec ?? p.price };
    }
    const { bySize: _preset, ...rest } = p;
    onChange([...rows, { id: slugify(p.label), ...rest, bySize }]);
  }
  function addCustom() {
    onChange([
      ...rows,
      { id: `addon-${Date.now()}`, label: "New add-on", detail: "", price: 0 },
    ]);
  }

  return (
    <div className="mt-4 border-t border-sand pt-4">
      <div className="flex items-center justify-between mb-1">
        <span className="text-xs font-bold text-stone">
          🧩 Add-ons (optional — any extra with its own price)
        </span>
      </div>
      <p className="text-[11px] text-stone mb-3">
        Appears as a checkbox on the product page (added to the price) and as a
        row in the FRAME DIMENSIONS table. Size format:{" "}
        <code className="bg-sand px-1 rounded">H96&quot; x W40&quot;</code> —
        automatically fills the A (width) and B (height) columns.
      </p>

      {/* Mabilis na dagdag — ang template lang na bagay sa category na ito */}
      <div className="flex flex-wrap gap-2 mb-3">
        {presets.map((p) => {
          const already = rows.some((r) => r.id === slugify(p.label));
          return (
            <button
              key={p.label}
              type="button"
              disabled={already}
              onClick={() => addPreset(p)}
              className={`text-xs font-bold px-3 py-1.5 rounded border ${
                already
                  ? "opacity-40 cursor-not-allowed border-stone/30"
                  : "border-cognac text-cognac hover:bg-cognac hover:text-white"
              }`}
            >
              {already ? `✓ ${p.label}` : `+ ${p.label}`}
            </button>
          );
        })}
        <button
          type="button"
          onClick={addCustom}
          className="text-xs font-bold px-3 py-1.5 rounded border border-stone/40 hover:border-ink"
        >
          + Custom add-on
        </button>
      </div>

      {rows.length === 0 ? (
        <p className="text-xs text-stone italic">
          {presets.length > 0
            ? "No add-ons yet. Tap a template above or + Custom add-on."
            : "No ready templates for this category — tap + Custom add-on."}
        </p>
      ) : (
        <div className="space-y-2">
          {rows.map((r, i) => (
            <div
              key={r.id + i}
              className="grid grid-cols-[1fr_110px_1fr_120px_auto] gap-2 items-end border border-sand rounded p-2 bg-linen/40"
            >
              <label className="block">
                <span className="block text-[11px] font-bold text-stone mb-1">
                  Name
                </span>
                <input
                  value={r.label}
                  onChange={(e) =>
                    update(i, { label: e.target.value, id: slugify(e.target.value) || r.id })
                  }
                  className="w-full border border-stone/40 bg-white px-2 py-1.5 text-sm rounded focus:outline-none focus:border-cognac"
                />
              </label>
              <label className="block">
                <span className="block text-[11px] font-bold text-stone mb-1">
                  Group
                </span>
                <input
                  value={r.group ?? ""}
                  placeholder="Mattress"
                  title="Heading on the product page. Blank = 'Add-ons'"
                  onChange={(e) => update(i, { group: e.target.value })}
                  className="w-full border border-stone/40 bg-white px-2 py-1.5 text-sm rounded focus:outline-none focus:border-cognac"
                />
              </label>
              <label className="block">
                <span className="block text-[11px] font-bold text-stone mb-1">
                  Size (H__&quot; x W__&quot;)
                </span>
                <input
                  value={r.detail ?? ""}
                  placeholder={'H96" x W40"'}
                  onChange={(e) => update(i, { detail: e.target.value })}
                  className="w-full border border-stone/40 bg-white px-2 py-1.5 text-sm rounded focus:outline-none focus:border-cognac"
                />
              </label>
              <label className="block">
                <span className="block text-[11px] font-bold text-stone mb-1">
                  Price (₱)
                </span>
                <div className="flex items-center border border-stone/40 rounded px-2 py-1.5 bg-white focus-within:border-cognac">
                  <span className="text-sm text-stone mr-1 shrink-0">₱</span>
                  <input
                    type="number"
                    value={r.price}
                    onChange={(e) => update(i, { price: Number(e.target.value) || 0 })}
                    className="no-spinner w-full min-w-0 text-sm bg-transparent focus:outline-none"
                  />
                </div>
              </label>
              <button
                type="button"
                onClick={() => remove(i)}
                className="w-7 h-7 mb-1 rounded-full text-red-600 hover:text-white hover:bg-red-600 flex items-center justify-center text-base leading-none transition-colors"
                title="Remove add-on"
                aria-label="Remove"
              >
                ×
              </button>

              {/* ---- PER-SIZE na sukat + presyo ---- */}
              <div className="col-span-5 mt-1">
                {!r.bySize ? (
                  <button
                    type="button"
                    onClick={() => enablePerSize(i)}
                    className="text-[11px] font-bold text-cognac hover:text-ink"
                  >
                    + Different size/price per bed size
                  </button>
                ) : (
                  <div className="border border-stone/25 rounded bg-white p-3">
                    <div className="flex items-center justify-between mb-2 pb-2 border-b border-sand">
                      <span className="text-[11px] font-bold text-stone">
                        Per bed size — this is used when the customer picks a size
                      </span>
                      <button
                        type="button"
                        onClick={() => disablePerSize(i)}
                        className="text-[11px] text-stone hover:text-red-700 font-medium underline decoration-dotted"
                      >
                        use a single size/price
                      </button>
                    </div>
                    {/* Babala kung may size na walang presyo — hindi ito
                        lalabas sa product page hangga't ₱0 */}
                    {SIZES.some((s) => !(r.bySize?.[s]?.price)) && (
                      <p className="text-[11px] text-red-700 mb-2 bg-red-50 border border-red-200 rounded px-2 py-1">
                        ⚠ Some sizes have no price (₱0) — they won&apos;t show on
                        the product page. Fill in all of them to show every size.
                      </p>
                    )}
                    {/* header row */}
                    <div className="grid grid-cols-[96px_1fr_110px] gap-2 mb-1 px-1">
                      <span className="text-[10px] font-bold text-stone uppercase tracking-wide">Size</span>
                      <span className="text-[10px] font-bold text-stone uppercase tracking-wide">Size</span>
                      <span className="text-[10px] font-bold text-stone uppercase tracking-wide">Price</span>
                    </div>
                    <div className="space-y-1.5">
                      {SIZES.map((s) => {
                        const spec = r.bySize?.[s] ?? { detail: "", price: 0 };
                        return (
                          <div
                            key={s}
                            className="grid grid-cols-[96px_1fr_110px] gap-2 items-center"
                          >
                            <span className="text-xs font-medium text-ink">{s}</span>
                            <input
                              value={spec.detail ?? ""}
                              placeholder={'H96" x W40"'}
                              onChange={(e) =>
                                updateSize(i, s, { detail: e.target.value })
                              }
                              className="w-full border border-stone/25 px-2 py-1.5 text-xs rounded focus:outline-none focus:border-cognac"
                            />
                            <div className="flex items-center border border-stone/25 rounded px-2 py-1.5 bg-white focus-within:border-cognac">
                              <span className="text-xs text-stone mr-1 shrink-0">₱</span>
                              <input
                                type="number"
                                value={spec.price}
                                onChange={(e) =>
                                  updateSize(i, s, {
                                    price: Number(e.target.value) || 0,
                                  })
                                }
                                className="no-spinner w-full min-w-0 text-xs bg-transparent focus:outline-none"
                              />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
