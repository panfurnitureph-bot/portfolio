"use client";

// PRODUCTS TAB — add / edit / delete products, drag-drop photos.
// This also drives the collection pages and homepage product
// carousels (everything comes from products.json).

import { useState } from "react";
import { apiGet, apiPut, apiCleanPhoto, apiRecolor, apiRecolorSet, sanitize } from "./api";
import { Area, Btn, Check, Field, ImageList, Modal, SaveBar, SingleImage, useDialogs } from "./ui";
import SwatchManager from "./SwatchManager";
import BedSizeEditor from "./BedSizeEditor";
import AddOnEditor from "./AddOnEditor";

type Product = Record<string, any>;

const CATEGORIES = [
  "bed", "sofa-bed", "sofa", "dining-table", "dining-chairs",
  "dining-set", "side-table", "ottoman-ph", "kurtina-ni-pan",
  "mattress", "customized-bed", "accent-chair",
];

export default function ProductsTab({
  products,
  setProducts,
}: {
  products: Product[];
  setProducts: (p: Product[]) => void;
}) {
  const [selected, setSelected] = useState<number | null>(null);
  const [search, setSearch] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const { dialogs, confirmDlg, alertDlg } = useDialogs();
  const [cleaning, setCleaning] = useState(false);

  // Auto-linis ng UNANG photo -> dagdag na variants.
  //  mode "cutout" -> alis bg (white/beige/closeup) — para standalone product
  //  mode "room"   -> panatilihin room, iba't ibang crop — para room/wall-panel
  async function cleanFirstPhoto(mode: "cutout" | "room") {
    if (selected === null) return;
    const p = products[selected];
    const first = p.images?.[0];
    if (!first || !/^\/images\/products\//.test(first)) {
      await alertDlg(
        "Upload a photo first (the first photo will be used).",
        "No photo"
      );
      return;
    }
    setCleaning(true);
    try {
      const urls = await apiCleanPhoto(first, p.slug, mode);
      const add = Object.values(urls).filter((u) => !p.images.includes(u));
      update(selected, { images: [...p.images, ...add] });
      await alertDlg(
        mode === "room"
          ? "Done: wide, center, and close-up (same room). Added at the end. Don't forget to SAVE."
          : "Done: white bg, beige bg, and close-up. Added at the end. Don't forget to SAVE.",
        "Done!"
      );
    } catch (e) {
      await alertDlg("Failed: " + (e as Error).message, "Failed");
    }
    setCleaning(false);
  }

  // Recolor per swatch. UNA: subukan ang BUONG SET pipeline (panel + kama +
  // beddings + unan — universal recolor-tool, kailangan may config ang photo).
  // Kung walang config -> fallback sa lumang kama-lang recolor.
  async function recolorFromSwatches() {
    if (selected === null) return;
    const p = products[selected];
    const first = p.images?.[0];
    if (!first || !/^\/images\/products\//.test(first)) {
      await alertDlg("Upload a photo first (the first photo will be recolored).", "No photo");
      return;
    }
    const swatches: any[] = p.colorSwatches ?? [];
    if (!swatches.length) {
      await alertDlg(
        "No color swatches yet. Add colors under 'Colors / Variants' below first.",
        "No swatches"
      );
      return;
    }
    setCleaning(true);
    try {
      // --- BUONG SET (universal pipeline) ---
      const r = await apiRecolorSet(p.slug);
      // Ang publish ay direktang nagsusulat sa products.json — i-reload para
      // fresh ang admin at hindi ma-clobber ng susunod na SAVE.
      const fresh = await apiGet("products");
      setProducts(fresh);
      await alertDlg(
        `FULL SET recolored (panel + bed + pillows if configured) and linked to ${r.linked} swatch(es). Already saved — no need to SAVE.`,
        "Done!"
      );
    } catch (e) {
      const msg = (e as Error).message;
      if (msg.includes("no_config")) {
        // --- FALLBACK: lumang kama-lang recolor ---
        try {
          const colors = swatches.map((s) => ({ name: s.name, swatch: s.swatch, hex: s.hex }));
          const variants = await apiRecolor(first, p.slug, colors);
          applyRecolorVariants(p, swatches, variants);
          await alertDlg(
            `Generated ${variants.length} colors (BED ONLY was recolored). ` +
              `To include the wall panel and pillows, this photo must first be configured in the recolor-tool. Don't forget to SAVE.`,
            "Done (bed only)"
          );
        } catch (e2) {
          await alertDlg("Failed: " + (e2 as Error).message, "Failed");
        }
      } else {
        await alertDlg("Failed: " + msg, "Failed");
      }
    }
    setCleaning(false);
  }

  // I-link ang recolor variants pabalik sa swatch + idagdag sa gallery
  function applyRecolorVariants(p: Product, swatches: any[], variants: any[]) {
    const byName = new Map(variants.map((v) => [v.name, v.url]));
    const newSwatches = swatches.map((s) =>
      byName.has(s.name) ? { ...s, image: byName.get(s.name) } : s
    );
    const newImgs = variants.map((v: any) => v.url).filter((u: string) => !p.images.includes(u));
    update(selected!, {
      colorSwatches: newSwatches,
      images: [...p.images, ...newImgs],
    });
  }


  // Add Product modal state
  const [addOpen, setAddOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [newCategory, setNewCategory] = useState("bed");
  const [newPrice, setNewPrice] = useState("");
  const [addError, setAddError] = useState("");

  const filtered = products
    .map((p, i) => ({ p, i }))
    .filter(({ p }) => p.name.toLowerCase().includes(search.toLowerCase()) || p.slug.includes(search.toLowerCase()));

  function update(idx: number, patch: Partial<Product>) {
    const arr = [...products];
    arr[idx] = { ...arr[idx], ...patch };
    setProducts(arr);
  }

  async function save() {
    setSaving(true);
    try {
      await apiPut("products", products);
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (e) {
      await alertDlg("Could not save: " + (e as Error).message, "Save failed");
    }
    setSaving(false);
  }

  function openAdd() {
    setNewName("");
    setNewCategory("bed");
    setNewPrice("");
    setAddError("");
    setAddOpen(true);
  }

  function submitAdd(e: React.FormEvent) {
    e.preventDefault();
    const name = newName.trim();
    if (!name) {
      setAddError("Please enter a product name.");
      return;
    }
    const slug = sanitize(name);
    if (products.some((p) => p.slug === slug)) {
      setAddError("A product with that name already exists.");
      return;
    }
    setProducts([
      {
        slug, name, price: Number(newPrice) || 0, compareAtPrice: null,
        category: newCategory, colors: [], images: [], description: "",
        dimensions: "", materials: "", care: "", featured: false,
        isNew: true, reviews: [], sku: "", stock: 10,
      },
      ...products,
    ]);
    setSelected(0);
    setAddOpen(false);
  }

  async function deleteProduct(idx: number) {
    const ok = await confirmDlg(
      `"${products[idx].name}" will be removed from the store, including its collection pages and homepage sections.`,
      "YES, DELETE",
      "Delete this product?"
    );
    if (!ok) return;
    setProducts(products.filter((_, i) => i !== idx));
    setSelected(null);
  }

  const p = selected !== null ? products[selected] : null;

  return (
    <div className="grid md:grid-cols-[280px_1fr] gap-6">
      {dialogs}

      {/* ---------- ADD PRODUCT MODAL ---------- */}
      <Modal open={addOpen} title="Add a new product" onClose={() => setAddOpen(false)}>
        <form onSubmit={submitAdd}>
          <Field label="Product name" value={newName} onChange={setNewName} placeholder="e.g. Napa Leather Sofa" />
          <label className="block mb-3">
            <span className="block text-xs font-bold text-stone mb-1">Category</span>
            <select
              value={newCategory}
              onChange={(e) => setNewCategory(e.target.value)}
              className="w-full border border-stone/40 bg-white px-3 py-2 text-sm rounded focus:outline-none focus:border-cognac"
            >
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </label>
          <Field label="Price (₱)" type="number" value={newPrice} onChange={setNewPrice} placeholder="0" />
          {newName.trim() && (
            <p className="text-xs text-stone mb-3">
              Link: <code className="bg-sand px-1 rounded">/products/{sanitize(newName)}</code>
            </p>
          )}
          {addError && <p className="text-red-700 text-sm mb-3">{addError}</p>}
          <div className="flex justify-end gap-2 mt-2">
            <Btn kind="ghost" onClick={() => setAddOpen(false)}>CANCEL</Btn>
            <button
              type="submit"
              className="px-5 py-2.5 text-sm bg-ink text-cream hover:bg-cognac font-bold rounded transition-colors"
            >
              CREATE PRODUCT
            </button>
          </div>
          <p className="text-xs text-stone mt-3">
            You can add photos, colors, and the description right after creating it.
          </p>
        </form>
      </Modal>

      {/* Product list */}
      <div>
        <div className="flex gap-2 mb-3">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search…"
            className="flex-1 border border-stone/40 px-3 py-2 text-sm rounded focus:outline-none focus:border-cognac"
          />
          <button
            onClick={openAdd}
            className="whitespace-nowrap px-4 text-xs bg-ink text-cream hover:bg-cognac font-bold rounded transition-colors"
          >
            + ADD
          </button>
        </div>
        <div className="border border-sand rounded max-h-[65vh] overflow-y-auto bg-white">
          {/* Naka-grupo by category para madaling hanapin */}
          {[...CATEGORIES, ...Array.from(new Set(filtered.map(({ p }) => p.category))).filter(
            (c) => !CATEGORIES.includes(c)
          )].map((cat) => {
            const group = filtered.filter(({ p }) => p.category === cat);
            if (group.length === 0) return null;
            return (
              <div key={cat}>
                <p className="sticky top-0 bg-espresso text-cream text-[11px] font-bold tracking-widest2 uppercase px-3 py-1.5">
                  {cat.replace(/-/g, " ")} ({group.length})
                </p>
                <div className="divide-y divide-sand">
                  {group.map(({ p, i }) => (
                    <button
                      key={p.slug}
                      onClick={() => setSelected(i)}
                      className={`block w-full text-left px-3 py-2.5 text-sm hover:bg-linen ${
                        selected === i ? "bg-linen font-bold" : ""
                      }`}
                    >
                      {p.name}
                      <span className="block text-xs text-stone">
                        ₱{p.price} · {p.sku ?? "no SKU"} ·{" "}
                        <span className={(p.stock ?? 0) === 0 ? "text-red-700 font-bold" : (p.stock ?? 0) <= 3 ? "text-cognac font-bold" : ""}>
                          stock: {p.stock ?? 0}
                        </span>
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Editor */}
      <div>
        {p === null ? (
          <p className="text-stone text-sm py-10 text-center">
            ← Select a product or ADD a new one
          </p>
        ) : (
          <div className="bg-white border border-sand rounded p-5">
            <div className="flex justify-between items-center mb-4">
              <h2 className="font-bold text-lg">{p.name}</h2>
              <Btn onClick={() => deleteProduct(selected!)} kind="danger" small>DELETE</Btn>
            </div>

            <ImageList
              images={p.images}
              onChange={(imgs) => update(selected!, { images: imgs })}
              uploadDir="images/products"
              baseName={p.slug}
              hint="Recommended: 1200×1200 (square) or 1200×900 (4:3)"
            />

            {/* Auto-generate variants mula sa UNANG photo */}
            <div className="border border-sand rounded p-3 mb-4 -mt-1 bg-sand/30">
              <p className="text-[11px] font-bold text-stone mb-2">
                ✨ Auto-generate previews from the first photo:
              </p>
              <div className="flex gap-2 flex-wrap">
                <button
                  type="button"
                  onClick={() => cleanFirstPhoto("room")}
                  disabled={cleaning}
                  className="text-xs font-bold bg-cognac text-white px-3 py-2 rounded hover:opacity-90 disabled:opacity-50"
                >
                  {cleaning ? "Working…" : "🛏️ Different shots (keep the room)"}
                </button>
                <button
                  type="button"
                  onClick={() => cleanFirstPhoto("cutout")}
                  disabled={cleaning}
                  className="text-xs font-bold bg-ink text-white px-3 py-2 rounded hover:opacity-90 disabled:opacity-50"
                >
                  {cleaning ? "Working…" : "✂️ Remove bg (white + beige)"}
                </button>
                <button
                  type="button"
                  onClick={recolorFromSwatches}
                  disabled={cleaning}
                  className="text-xs font-bold bg-green-700 text-white px-3 py-2 rounded hover:opacity-90 disabled:opacity-50"
                >
                  {cleaning ? "Working… (takes ~1-3 min)" : "🎨 Recolor per swatch (FULL SET)"}
                </button>
              </div>
              <p className="text-[10px] text-stone mt-2 leading-snug">
                🛏️ = wide, center, and close-up shots — same background (for a room/lifestyle photo).<br />
                ✂️ = remove the background → white + beige (for a standalone product).<br />
                🎨 = renders the bed in EVERY swatch color — only the bed swaps, the whole room/background stays 100% the same. Linked to the swatch: when the customer picks a color, the image changes (like Poly &amp; Bark). Requires color swatches below first.
              </p>
            </div>

            <div className="grid sm:grid-cols-2 gap-x-4">
              <Field label="Name" value={p.name} onChange={(v) => update(selected!, { name: v })} />
              <label className="block mb-3">
                <span className="block text-xs font-bold text-stone mb-1">Category</span>
                <select
                  value={p.category}
                  onChange={(e) => update(selected!, { category: e.target.value })}
                  className="w-full border border-stone/40 bg-white px-3 py-2 text-sm rounded focus:outline-none focus:border-cognac"
                >
                  {CATEGORIES.map((c) => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
              </label>
              <Field label="Price (₱)" type="number" value={p.price} onChange={(v) => update(selected!, { price: Number(v) || 0 })} />
              <Field label="SKU (internal — not shown to customers)" value={p.sku ?? ""} onChange={(v) => update(selected!, { sku: v })} />
              <Field label="Stock (0 = Out of stock sa site)" type="number" value={p.stock ?? 0} onChange={(v) => update(selected!, { stock: Math.max(0, Number(v) || 0) })} />
              <Field
                label="Old price — for SALE badge (blank = no sale)"
                type="number"
                value={p.compareAtPrice ?? ""}
                onChange={(v) => update(selected!, { compareAtPrice: v ? Number(v) : null })}
              />
              <Field label="Dimensions" value={p.dimensions} onChange={(v) => update(selected!, { dimensions: v })} />
              <Field label="Materials" value={p.materials} onChange={(v) => update(selected!, { materials: v })} />
              <Field label="Care" value={p.care} onChange={(v) => update(selected!, { care: v })} />
            </div>
            <SwatchManager
              colors={p.colors}
              swatches={p.colorSwatches ?? []}
              slug={p.slug}
              onChange={(colors, colorSwatches) => update(selected!, { colors, colorSwatches })}
            />

            {/* ---------- DIMENSIONS ---------- */}
            <div className="mt-2 border-t border-sand pt-4">
              {["bed", "sofa-bed", "mattress", "bedroom"].includes(p.category) ? (
                // Beds: editable na size table — bawat size may sukat + presyo
                <BedSizeEditor
                  value={p.bedSizes}
                  basePrice={p.price}
                  category={p.category}
                  onChange={(bedSizes: any) => update(selected!, { bedSizes })}
                />
              ) : (
                // Non-bed: gamitin ang "Dimensions" field sa itaas +
                // optional diagram image dito
                <SingleImage
                  label="Dimension diagram image (optional — upload if you have one)"
                  value={p.dimensionImage ?? ""}
                  onChange={(v) => update(selected!, { dimensionImage: v })}
                  uploadDir="images/dimensions"
                  baseName={p.slug + "-dim"}
                />
              )}
            </div>

            {/* ---------- ADD-ONS (Wall Padding / Headboard / custom) ---------- */}
            {/* Ang category ang nagpapasya kung aling template ang lumalabas —
                walang Wall Padding o mattress sa upuan at mesa. */}
            <AddOnEditor
              value={p.addOns}
              bedSizes={p.bedSizes}
              category={p.category}
              onChange={(addOns: any) => update(selected!, { addOns })}
            />

            <Area label="Description" value={p.description} onChange={(v) => update(selected!, { description: v })} />
            <div className="flex gap-6">
              <Check label="Featured (shows in homepage carousels)" checked={p.featured} onChange={(v) => update(selected!, { featured: v })} />
              <Check label="NEW badge + included in New In" checked={p.isNew} onChange={(v) => update(selected!, { isNew: v })} />
            </div>
          </div>
        )}
        <SaveBar onSave={save} saving={saving} saved={saved} />
      </div>
    </div>
  );
}
