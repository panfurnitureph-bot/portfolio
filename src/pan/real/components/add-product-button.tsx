"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Modal } from "./modal";
import { cn } from "./ui";
import { addProduct, nextMadeToOrderSku } from "@/app/products/actions";
import { MADE_TO_ORDER_CATEGORIES } from "@/lib/categories";
import { SpecFieldsInput } from "./spec-fields-input";
import { MultiImageUpload } from "./multi-image-upload";
import type { ColorVariant } from "@/lib/color-variants";

const inputClass =
  "rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none transition-colors focus:border-primary focus:ring-2 focus:ring-primary/20";

function Field({
  label,
  name,
  type = "text",
  placeholder,
  full,
  options,
  suggestions,
  raw,          // dropdown that keeps option text as-is + a blank first option (optional)
}: {
  label: string;
  name: string;
  type?: string;
  placeholder?: string;
  full?: boolean;
  options?: string[];
  suggestions?: string[];
  raw?: boolean;
}) {
  const listId = suggestions ? `dl-${name}` : undefined;
  return (
    <div className={cn("flex flex-col gap-1.5", full && "sm:col-span-2")}>
      {/* Label style — pareho ng Customized builder (gold uppercase) */}
      <label className="text-[9.5px] font-extrabold uppercase tracking-[0.12em] text-[#a8842e]">{label}</label>
      {options ? (
        // `raw` (e.g. warehouse locations): keep exact casing + start blank so it's optional.
        raw ? (
          <select name={name} defaultValue="" className={inputClass}>
            <option value="">{placeholder || "Select…"}</option>
            {options.map((o) => <option key={o} value={o}>{o}</option>)}
          </select>
        ) : (
          <select name={name} defaultValue={options[0]} className={inputClass}>
            {options.map((o) => (
              <option key={o} value={o}>
                {o.charAt(0).toUpperCase() + o.slice(1)}
              </option>
            ))}
          </select>
        )
      ) : (
        <>
          <input name={name} type={type} placeholder={placeholder} className={inputClass} list={listId} autoComplete="off" />
          {suggestions && <datalist id={listId}>{suggestions.map((s) => <option key={s} value={s} />)}</datalist>}
        </>
      )}
    </div>
  );
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function AddProductButton({ locations = [], zones = [] }: { locations?: string[]; zones?: string[] }) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  // AUTO SKU kada category (PREFIX-000001) — preview lang dito; ang final na
  // numero ay sa server sa mismong save (iwas banggaan sa sabay na gumagawa).
  const [category, setCategory] = useState(MADE_TO_ORDER_CATEGORIES[0]);
  const [skuPreview, setSkuPreview] = useState("");
  // Pareho ng Customized builder: multi-photo upload (unang photo ang thumbnail)
  // at required na Local/Imported na pagpili.
  const [photos, setPhotos] = useState<string[]>([]);
  // COLOR VARIANTS (0231): tela mula sa library, may litrato kada kulay.
  const [variants, setVariants] = useState<ColorVariant[]>([]);
  const [ptype, setPtype] = useState<"" | "Local" | "Imported">("");
  useEffect(() => {
    if (!open) return;
    let live = true;
    setSkuPreview("");
    nextMadeToOrderSku(category).then((s) => { if (live) setSkuPreview(s); }).catch(() => {});
    return () => { live = false; };
  }, [category, open]);

  function close() {
    setOpen(false);
    setError(null);
    // I-RESET ANG BUONG FORM (2026-08-26). Ang mga field sa loob ay
    // uncontrolled at nasa <form> na na-unmount, kaya sila ay bumabalik na
    // blangko — pero ang litrato at ang Local/Imported ay React state, at
    // nananatili sila. Kaya pagbukas ulit ng Add Product, nakadikit pa ang
    // litrato ng produktong kaka-save lang: madaling maisama sa mali.
    setPhotos([]);
    setVariants([]);
    setPtype("");
    setCategory(MADE_TO_ORDER_CATEGORIES[0]);
  }

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const fd = new FormData(e.currentTarget);
    const get = (k: string) => String(fd.get(k) ?? "").trim();
    const num = (k: string) => {
      const v = get(k);
      return v === "" ? null : Number(v);
    };

    // COLOR = ang napiling tela sa specs (pareho ng Customized builder na
    // pumalit sa dating Color* field).
    const specsVal = get("specs");
    const fabricLine = /^(?:Fabric(?:\s*\/\s*Finish)?|Upholstered Finish):\s*(.+)$/m.exec(specsVal)?.[1]?.trim() ?? "";

    const payload = {
      product_name: get("product_name"),
      sku: null, // laging auto — category-sequential sa server
      category: get("category") || null,
      color: fabricLine || null,
      dimension: null,
      supplier: null,
      barcode: null, // laging = SKU (server default)
      location: null, // cubic/line — itinatalaga sa QC Receiving
      warehouse_location: null,
      image_url: photos[0] || null,
      images: photos,
      color_variants: variants,
      cost: num("cost"),
      price: num("price"),
      product_type: ptype || "Local",
      status: "active",
      specs: specsVal || null,
    };

    if (!payload.product_name) {
      setError("Product name is required.");
      return;
    }
    // Pareho ng Customized builder: required ang Local/Imported.
    if (!ptype) {
      setError("Select Local or Imported.");
      return;
    }

    startTransition(async () => {
      const res = await addProduct(payload);
      if ("error" in res) {
        setError(res.error);
        return;
      }
      close();
      router.refresh(); // re-fetch the server component with the new row
    });
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-sm transition-all hover:opacity-90 active:scale-[0.98]"
      >
        + Add Product
      </button>

      <Modal
        open={open}
        onClose={close}
        title="Add Product"
        description="Insert a new row into the Supabase product table"
        size="lg"
      >
        <form onSubmit={onSubmit}>
          {/* LAYOUT — 100% pareho ng Customized builder (2026-08-18):
              Photos → SKU·auto | Category | Product Type* → Product/Name →
              Price* → fabric picker + guided specs → IMS-only fields sa baba. */}
          <div className="space-y-3">
            <div>
              <label className="mb-0.5 block text-[9.5px] font-extrabold uppercase tracking-[0.12em] text-[#a8842e]">Photos</label>
              <MultiImageUpload value={photos} onChange={setPhotos} camera folder="products" />
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="mb-0.5 block text-[9.5px] font-extrabold uppercase tracking-[0.12em] text-[#a8842e]">SKU · auto</label>
                <input value={skuPreview || "…"} readOnly className={cn(inputClass, "w-full cursor-not-allowed bg-stone-100 text-xs font-mono text-muted")} title="Auto per category — final number on save" />
              </div>
              <div>
                <label className="mb-0.5 block text-[9.5px] font-extrabold uppercase tracking-[0.12em] text-[#a8842e]">Category</label>
                <select
                  name="category"
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                  className={cn(inputClass, "w-full text-xs")}
                >
                  {/* EKSAKTONG listahan ng Customized builder — walang dagdag
                      (Kurtina/Addons ay sa Edit form na lang kung kailangan) */}
                  {MADE_TO_ORDER_CATEGORIES.map((o) => (
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
            <Field label="Product / Name *" name="product_name" placeholder="e.g. Customized L-shape Sofa" full />
            <Field label="Price (₱) *" name="price" type="number" placeholder="0.00" full />
            {/* SPECS — guided per-category fields + fabric library picker,
                parehong panels ng Customized builder. */}
            <SpecFieldsInput category={category} withFabricPicker variants={variants} onVariantsChange={setVariants} />
            {/* Barcode/Dimension/Supplier/Cubic/Line/Status — tinanggal sa form
                (2026-08-18): eksaktong Customized builder fields na lang. Ang
                cubic/line ay sa QC Receiving na itinatalaga; status = active. */}
          </div>

          {error && (
            <p className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-xs font-medium text-red-700 ring-1 ring-inset ring-red-600/20">
              {error}
            </p>
          )}

          <div className="mt-5 flex justify-end gap-2">
            <button
              type="button"
              onClick={close}
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
              {pending ? "Saving…" : "Save Product"}
            </button>
          </div>
        </form>
      </Modal>
    </>
  );
}
