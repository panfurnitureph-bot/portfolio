"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Modal } from "./modal";
import { cn } from "./ui";
import { updateProduct, deleteProduct } from "@/app/products/actions";
import { MADE_TO_ORDER_CATEGORIES } from "@/lib/categories";
import type { ProductRow } from "@/lib/supabase/server";
import { SpecFieldsInput } from "./spec-fields-input";
import { MultiImageUpload } from "./multi-image-upload";
import { cleanVariants, type ColorVariant } from "@/lib/color-variants";

const inputClass =
  "rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none transition-colors focus:border-primary focus:ring-2 focus:ring-primary/20";

function Field({
  label,
  name,
  defaultValue,
  type = "text",
  full,
  options,
  suggestions,
  raw,          // dropdown that keeps exact casing + a blank first option (optional)
  placeholder,
}: {
  label: string;
  name: string;
  defaultValue?: string | number | null;
  type?: string;
  full?: boolean;
  options?: string[];
  suggestions?: string[];
  raw?: boolean;
  placeholder?: string;
}) {
  const dv = defaultValue ?? "";
  const listId = suggestions ? `dl-edit-${name}` : undefined;
  return (
    <div className={cn("flex flex-col gap-1.5", full && "sm:col-span-2")}>
      {/* Label style — pareho ng Customized builder (gold uppercase) */}
      <label className="text-[9.5px] font-extrabold uppercase tracking-[0.12em] text-[#a8842e]">{label}</label>
      {options ? (
        raw ? (
          // Only show the field's OWN option list (raks for Rak, zones for Zone). If the
          // saved value isn't in that list (e.g. old data with a Rak code in the Zone
          // field), start blank so the user picks the correct one — don't inject the
          // wrong-type value as an option.
          <select name={name} defaultValue={options.includes(String(dv)) ? String(dv) : ""} className={inputClass}>
            <option value="">{placeholder || "Select…"}</option>
            {options.map((o) => <option key={o} value={o}>{o}</option>)}
          </select>
        ) : (
          <select name={name} defaultValue={String(dv) || options[0]} className={inputClass}>
            {options.map((o) => (
              <option key={o} value={o}>
                {o.charAt(0).toUpperCase() + o.slice(1)}
              </option>
            ))}
          </select>
        )
      ) : (
        <>
          <input name={name} type={type} defaultValue={dv} className={inputClass} list={listId} autoComplete="off" />
          {suggestions && <datalist id={listId}>{suggestions.map((s) => <option key={s} value={s} />)}</datalist>}
        </>
      )}
    </div>
  );
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function ProductRowActions({ product, locations = [], zones = [] }: { product: ProductRow; locations?: string[]; zones?: string[] }) {
  const [editOpen, setEditOpen] = useState(false);
  const [delOpen, setDelOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  // Pareho ng Add Product (2026-08-18): category state para sa guided specs,
  // multi-photo (unang photo = product image), segmented Local/Imported.
  const [category, setCategory] = useState(product.category ?? MADE_TO_ORDER_CATEGORIES[0]);
  // LAHAT ng litrato (0230) — hindi na ang image_url lang.
  const [photos, setPhotos] = useState<string[]>(() => {
    const arr = (product as { images?: string[] | null }).images;
    if (Array.isArray(arr) && arr.length) return arr;
    return product.image_url ? [product.image_url] : [];
  });
  // COLOR VARIANTS (0231): tela mula sa library, may litrato kada kulay.
  const [variants, setVariants] = useState<ColorVariant[]>(() => cleanVariants((product as { color_variants?: unknown }).color_variants));
  const [ptype, setPtype] = useState<"" | "Local" | "Imported">(
    (product.product_type ?? "").toLowerCase() === "imported" ? "Imported" : "Local",
  );

  function onEdit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const fd = new FormData(e.currentTarget);
    const get = (k: string) => String(fd.get(k) ?? "").trim();
    const num = (k: string) => {
      const v = get(k);
      return v === "" ? null : Number(v);
    };
    // COLOR = tela mula sa specs (gaya ng Add Product); kapag walang fabric
    // line, panatilihin ang dating color ng produkto.
    const specsVal = get("specs");
    const fabricLine = /^(?:Fabric(?:\s*\/\s*Finish)?|Upholstered Finish):\s*(.+)$/m.exec(specsVal)?.[1]?.trim() ?? "";
    const payload = {
      product_name: get("product_name"),
      sku: product.sku ?? null, // auto na ang SKU — hindi na ine-edit dito
      category: get("category") || null,
      color: fabricLine || product.color || null,
      // Mga field na wala na sa form — panatilihin ang dating values (huwag
      // burahin ang legacy data): dimension/supplier/barcode/storage/status.
      dimension: product.dimension ?? null,
      supplier: product.supplier ?? null,
      barcode: product.barcode ?? null,
      location: product.location ?? null,
      warehouse_location: product.warehouse_location ?? null,
      image_url: photos[0] || null,
      images: photos,
      color_variants: variants,
      cost: num("cost"),
      price: num("price"),
      product_type: ptype || "Local",
      status: product.status ?? "active",
      specs: specsVal || null,
    };
    if (!payload.product_name) {
      setError("Product name is required.");
      return;
    }
    startTransition(async () => {
      const res = await updateProduct(product.id, payload);
      if ("error" in res) {
        setError(res.error);
        return;
      }
      setEditOpen(false);
      router.refresh();
    });
  }

  function onDelete() {
    setError(null);
    startTransition(async () => {
      const res = await deleteProduct(product.id);
      if ("error" in res) {
        setError(res.error);
        return;
      }
      setDelOpen(false);
      router.refresh();
    });
  }

  return (
    <>
      <div className="flex items-center justify-end gap-1">
        <button
          onClick={() => setEditOpen(true)}
          aria-label="Edit"
          className="flex h-8 w-8 items-center justify-center rounded-lg text-muted transition-colors hover:bg-stone-100 hover:text-primary"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 20h9" />
            <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
          </svg>
        </button>
        <button
          onClick={() => setDelOpen(true)}
          aria-label="Delete"
          className="flex h-8 w-8 items-center justify-center rounded-lg text-muted transition-colors hover:bg-red-50 hover:text-danger"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m2 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
          </svg>
        </button>
      </div>

      {/* Edit modal */}
      <Modal
        open={editOpen}
        onClose={() => setEditOpen(false)}
        title="Edit Product"
        description={`Updating "${product.product_name}" in Supabase`}
        size="lg"
      >
        <form onSubmit={onEdit}>
          {/* LAYOUT — 100% pareho ng Add Product / Customized builder:
              Photos → SKU·auto | Category | Product Type* → Product/Name →
              Price* → fabric picker + guided specs. */}
          <div className="space-y-3">
            <div>
              <label className="mb-0.5 block text-[9.5px] font-extrabold uppercase tracking-[0.12em] text-[#a8842e]">Photos</label>
              <MultiImageUpload value={photos} onChange={setPhotos} camera folder="products" />
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="mb-0.5 block text-[9.5px] font-extrabold uppercase tracking-[0.12em] text-[#a8842e]">SKU · auto</label>
                <input value={product.sku ?? "—"} readOnly className={cn(inputClass, "w-full cursor-not-allowed bg-stone-100 text-xs font-mono text-muted")} title="Auto-generated — not editable" />
              </div>
              <div>
                <label className="mb-0.5 block text-[9.5px] font-extrabold uppercase tracking-[0.12em] text-[#a8842e]">Category</label>
                <select
                  name="category"
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                  className={cn(inputClass, "w-full text-xs")}
                >
                  {(product.category && !MADE_TO_ORDER_CATEGORIES.includes(product.category)
                    ? [product.category, ...MADE_TO_ORDER_CATEGORIES]
                    : MADE_TO_ORDER_CATEGORIES
                  ).map((o) => (
                    <option key={o} value={o}>{o}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-0.5 block text-[9.5px] font-extrabold uppercase tracking-[0.12em] text-[#a8842e]">Product Type *</label>
                <div className="grid grid-cols-2 overflow-hidden rounded-md border border-border">
                  {(["Local", "Imported"] as const).map((t, ti) => (
                    <button key={t} type="button" onClick={() => setPtype(t)} className={`px-1 py-1.5 text-xs font-bold ${ti > 0 ? "border-l border-border" : ""} ${ptype === t ? (t === "Imported" ? "bg-blue-700 text-white" : "bg-emerald-700 text-white") : "bg-surface text-muted hover:bg-stone-100"}`}>
                      {t}{ptype === t ? " ✓" : ""}
                    </button>
                  ))}
                </div>
              </div>
            </div>
            <Field label="Product / Name *" name="product_name" defaultValue={product.product_name} full />
            <Field label="Price (₱) *" name="price" type="number" defaultValue={product.price} full />
            {/* SPECS — guided fields + fabric picker; nagsisimula sa "Edit as
                text" dala ang na-save nang specs para walang mabura. */}
            <SpecFieldsInput category={category} withFabricPicker initialText={product.specs} variants={variants} onVariantsChange={setVariants} />
          </div>

          {error && (
            <p className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-xs font-medium text-red-700 ring-1 ring-inset ring-red-600/20">
              {error}
            </p>
          )}

          <div className="mt-5 flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setEditOpen(false)}
              disabled={pending}
              className="rounded-lg border border-border bg-surface px-4 py-2 text-sm font-medium transition-colors hover:bg-stone-100 disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={pending}
              className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-sm transition-all hover:opacity-90 active:scale-[0.98] disabled:opacity-60"
            >
              {pending ? "Saving…" : "Save Changes"}
            </button>
          </div>
        </form>
      </Modal>

      {/* Delete confirm */}
      <Modal
        open={delOpen}
        onClose={() => setDelOpen(false)}
        title="Delete Product"
        size="sm"
        footer={
          <div className="flex justify-end gap-2">
            <button
              onClick={() => setDelOpen(false)}
              disabled={pending}
              className="rounded-lg border border-border bg-surface px-4 py-2 text-sm font-medium hover:bg-stone-100 disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              onClick={onDelete}
              disabled={pending}
              className="rounded-lg bg-danger px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-60"
            >
              {pending ? "Deleting…" : "Delete"}
            </button>
          </div>
        }
      >
        <p className="text-sm">
          Delete <span className="font-semibold">{product.product_name}</span>? This
          removes the row from Supabase and cannot be undone.
        </p>
        {error && (
          <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-xs font-medium text-red-700">
            {error}
          </p>
        )}
      </Modal>
    </>
  );
}
