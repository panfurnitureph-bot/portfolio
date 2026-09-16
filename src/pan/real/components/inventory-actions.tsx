"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Modal } from "./modal";
import { cn } from "./ui";
import {
  addInventory,
  updateInventory,
  deleteInventory,
  type NewInventory,
} from "@/app/inventory/actions";
import type { InventoryRow, ProductRow } from "@/lib/supabase/server";
import { SpecFieldsView } from "./spec-fields-input";
import { cleanVariants, type ColorVariant } from "@/lib/color-variants";
import { imageUrl } from "./website/util";

// Inventory row na may kasamang product details (inilalakip ng inventory page)
// para makita sa Edit dialog ang photos/price/type/specs ng produkto.
export type InventoryRowWithProduct = InventoryRow & {
  imageUrl?: string | null;
  productSpecs?: string | null;
  productPrice?: number | null;
  productType?: string | null;
};

const inputClass =
  "rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none transition-colors focus:border-primary focus:ring-2 focus:ring-primary/20";

const STATUS_OPTIONS = ["In stock", "Low stock", "Out of stock"];

function Field({
  label,
  name,
  defaultValue,
  type = "text",
  full,
  options,
}: {
  label: string;
  name: string;
  defaultValue?: string | number | null;
  type?: string;
  full?: boolean;
  options?: string[];
}) {
  const dv = defaultValue ?? "";
  return (
    <div className={cn("flex flex-col gap-1.5", full && "sm:col-span-2")}>
      <label className="text-[9.5px] font-extrabold uppercase tracking-[0.12em] text-[#a8842e]">{label}</label>
      {options ? (
        <select name={name} defaultValue={String(dv) || options[0]} className={inputClass}>
          {options.map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </select>
      ) : (
        <input name={name} type={type} defaultValue={dv} className={inputClass} />
      )}
    </div>
  );
}

// EDIT (2026-08-18) — pareho ng Add Inventory: buong product details na
// read-only (photos/price/type/specs kasama), On Hand + Status lang ang
// ine-edit. Ang tinanggal na fields (dimension, cubic, line, supplier) ay
// dala pa rin bilang hidden para hindi mabura.
function Fields({ row }: { row?: InventoryRowWithProduct }) {
  const ro = "cursor-not-allowed bg-stone-100 text-muted";
  const lbl = "mb-0.5 block text-[9.5px] font-extrabold uppercase tracking-[0.12em] text-[#a8842e]";
  const ptype = (row?.productType ?? "").toLowerCase() === "imported" ? "Imported" : "Local";
  return (
    <div className="space-y-3">
      {row?.imageUrl && (
        <div>
          <label className={lbl}>Photos</label>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={row.imageUrl} alt={row.product_name ?? ""} className="h-20 w-20 rounded-lg border border-border object-cover" />
        </div>
      )}
      <div className="grid grid-cols-3 gap-3">
        <div>
          <label className={lbl}>SKU · auto</label>
          <input name="sku" defaultValue={row?.sku ?? ""} readOnly className={cn(inputClass, "w-full text-xs font-mono", ro)} />
        </div>
        <div>
          <label className={lbl}>Category</label>
          <input name="category" defaultValue={row?.category ?? ""} readOnly className={cn(inputClass, "w-full text-xs", ro)} />
        </div>
        <div>
          <label className={lbl}>Product Type</label>
          <div className="grid grid-cols-2 overflow-hidden rounded-md border border-border">
            {(["Local", "Imported"] as const).map((t, ti) => (
              <span key={t} className={`px-1 py-1.5 text-center text-xs font-bold ${ti > 0 ? "border-l border-border" : ""} ${ptype === t ? (t === "Imported" ? "bg-blue-700 text-white" : "bg-emerald-700 text-white") : "bg-surface text-muted"}`}>
                {t}{ptype === t ? " ✓" : ""}
              </span>
            ))}
          </div>
        </div>
      </div>
      <div>
        <label className={lbl}>Product / Name *</label>
        <input name="product_name" defaultValue={row?.product_name ?? ""} readOnly className={cn(inputClass, "w-full", ro)} />
      </div>
      {/* Color/Fabric — itago kapag may fabric line na sa specs (nasa guided
          cards na sa ibaba); dala pa rin ang value bilang hidden sa save.
          INVENTORY KADA KULAY (0232): kapag may kulay ang row, laging kita -
          iyon ang pagkakakilanlan ng row. */}
      {!row?.color && /^(Fabric(\s*\/\s*Finish)?|Upholstered Finish):/m.test(row?.productSpecs ?? "") ? (
        <>
          <div>
            <label className={lbl}>Price (₱)</label>
            <input value={row?.productPrice != null ? String(row.productPrice) : "—"} readOnly className={cn(inputClass, "w-full", ro)} />
          </div>
          <input type="hidden" name="color" defaultValue={row?.color ?? ""} />
        </>
      ) : (
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={lbl}>Price (₱)</label>
            <input value={row?.productPrice != null ? String(row.productPrice) : "—"} readOnly className={cn(inputClass, "w-full", ro)} />
          </div>
          <div>
            <label className={lbl}>Color / Fabric</label>
            <input name="color" defaultValue={row?.color ?? ""} readOnly className={cn(inputClass, "w-full", ro)} />
          </div>
        </div>
      )}
      {/* SPECS — parehong guided cards ng Customized, read-only */}
      <SpecFieldsView category={row?.category ?? ""} specs={row?.productSpecs} />
      <input type="hidden" name="dimension" defaultValue={row?.dimension ?? ""} />
      <input type="hidden" name="location" defaultValue={row?.location ?? ""} />
      <input type="hidden" name="warehouse_location" defaultValue={row?.warehouse_location ?? ""} />
      <input type="hidden" name="supplier" defaultValue={row?.supplier ?? ""} />
      <div className="grid grid-cols-2 gap-3 border-t border-dashed border-border pt-3">
        <Field label="On Hand" name="oh_inv" type="number" defaultValue={row?.oh_inv} />
        <Field label="Status" name="status" defaultValue={row?.status} options={STATUS_OPTIONS} />
      </div>
    </div>
  );
}

function readForm(form: HTMLFormElement): NewInventory {
  const fd = new FormData(form);
  const get = (k: string) => String(fd.get(k) ?? "").trim();
  const num = (k: string) => Number(get(k) || 0);
  return {
    product_name: get("product_name"),
    sku: get("sku") || null,
    category: get("category") || null,
    color: get("color") || null,
    dimension: get("dimension") || null,
    location: get("location") || null,
    warehouse_location: get("warehouse_location") || null,
    supplier: get("supplier") || null,
    oh_inv: num("oh_inv"),
    reserved: num("reserved"),
    status: get("status") || "In stock",
  };
}

// --------------------------------------------------------------- Add
const EMPTY = {
  product_name: "",
  sku: "",
  category: "",
  color: "",
  dimension: "",
  // Specs — read-only na display mula sa napiling produkto (bagong format);
  // hindi ito sine-save sa inventory row.
  specs: "",
  location: "",
  warehouse_location: "",
  supplier: "",
  oh_inv: "",
  reserved: "",
  status: "In stock",
  // Display-only (galing sa napiling produkto) — hindi sine-save sa inventory.
  image_url: "",
  price: "",
  product_type: "",
};

// Label style — pareho ng Add Product / Customized builder (gold uppercase).
const goldLabel = "text-[9.5px] font-extrabold uppercase tracking-[0.12em] text-[#a8842e]";

function MiniThumb({ url, name }: { url?: string | null; name: string }) {
  if (url) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img loading="lazy" decoding="async" src={url} alt={name} className="h-7 w-7 shrink-0 rounded object-cover ring-1 ring-border" />;
  }
  return (
    <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded bg-stone-200 text-[9px] font-semibold text-stone-500">
      {name.slice(0, 2).toUpperCase()}
    </div>
  );
}

// Custom product dropdown with thumbnails + search.
function ProductPicker({
  products,
  onPick,
}: {
  products: ProductRow[];
  onPick: (p: ProductRow) => void;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [sel, setSel] = useState<ProductRow | null>(null);

  const list = products.filter((p) => {
    const s = q.trim().toLowerCase();
    return !s || p.product_name?.toLowerCase().includes(s) || p.sku?.toLowerCase().includes(s);
  });

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={cn(inputClass, "flex w-full items-center justify-between gap-2 text-left")}
      >
        {sel ? (
          <span className="flex min-w-0 items-center gap-2">
            <MiniThumb url={sel.image_url} name={sel.product_name} />
            <span className="truncate">{sel.product_name}</span>
          </span>
        ) : (
          <span className="text-muted">— pick a product to autofill —</span>
        )}
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="shrink-0 text-muted">
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>

      {open && (
        <>
          {/* click-outside backdrop */}
          <div className="fixed inset-0 z-20" onClick={() => setOpen(false)} />
          <div className="absolute left-0 right-0 z-30 mt-1 rounded-lg border border-border bg-surface shadow-xl">
            <div className="border-b border-border p-2">
              <input
                autoFocus
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search product…"
                className="w-full rounded-md border border-border bg-surface px-2 py-1.5 text-sm outline-none focus:border-primary"
              />
            </div>
            <ul className="pf-scroll max-h-60 overflow-y-auto py-1">
              {list.map((p) => (
                <li key={p.id}>
                  <button
                    type="button"
                    onClick={() => {
                      setSel(p);
                      onPick(p);
                      setOpen(false);
                      setQ("");
                    }}
                    className="flex w-full items-center gap-2.5 px-3 py-2 text-left hover:bg-stone-100"
                  >
                    <MiniThumb url={p.image_url} name={p.product_name} />
                    <span className="min-w-0">
                      <span className="block truncate text-sm">{p.product_name}</span>
                      {p.sku && <span className="block font-mono text-xs text-muted">{p.sku}</span>}
                    </span>
                  </button>
                </li>
              ))}
              {list.length === 0 && (
                <li className="px-3 py-3 text-center text-sm text-muted">No match.</li>
              )}
            </ul>
          </div>
        </>
      )}
    </div>
  );
}

export function AddInventoryButton({ products, usedColors = {} }: { products: ProductRow[]; usedColors?: Record<string, string[]> }) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [v, setV] = useState({ ...EMPTY });
  // INVENTORY KADA KULAY (0232): ang color variants ng napiling produkto -
  // isang On Hand kada kulay, isang inventory row kada kulay sa save.
  const [variants, setVariants] = useState<ColorVariant[]>([]);
  const [perColor, setPerColor] = useState<Record<string, string>>({});
  const router = useRouter();

  const set = (k: keyof typeof EMPTY) => (val: string) =>
    setV((prev) => ({ ...prev, [k]: val }));

  function reset() {
    setV({ ...EMPTY });
    setVariants([]);
    setPerColor({});
    setError(null);
  }

  // Pick an existing product → autofill ALL its details (incl. location + warehouse).
  function pickProduct(id: string) {
    const p = products.find((x) => String(x.id) === id);
    if (!p) return;
    setV((prev) => ({
      ...prev,
      product_name: p.product_name ?? "",
      sku: p.sku ?? "",
      category: p.category ?? "",
      color: p.color ?? "",
      dimension: p.dimension ?? "",
      location: p.location ?? "",                    // Rak #
      warehouse_location: p.warehouse_location ?? "", // Zone #
      supplier: p.supplier ?? "",
      specs: p.specs ?? "",
      image_url: p.image_url ?? "",
      price: p.price != null ? String(p.price) : "",
      product_type: (p.product_type ?? "").toLowerCase() === "imported" ? "Imported" : "Local",
    }));
    // Ang mga kulay na may row na ay hindi na inaalok - ang kulang lang.
    const have = new Set(usedColors[(p.sku ?? "").toLowerCase()] ?? []);
    setVariants(cleanVariants((p as { color_variants?: unknown }).color_variants).filter((v) => !have.has(v.name.trim().toLowerCase())));
    setPerColor({});
  }

  // Reserved removed from the form → available is simply on hand.
  const available = variants.length
    ? variants.reduce((a, c) => a + Math.max(Number(perColor[c.name]) || 0, 0), 0)
    : Math.max(Number(v.oh_inv) || 0, 0);

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    if (!v.product_name.trim()) {
      setError("Pick a product or enter a product name.");
      return;
    }
    const payload: NewInventory = {
      product_name: v.product_name.trim(),
      sku: v.sku || null,
      category: v.category || null,
      color: v.color || null,
      dimension: v.dimension || null,
      location: v.location || null,
      warehouse_location: v.warehouse_location || null,
      supplier: v.supplier || null,
      oh_inv: Number(v.oh_inv) || 0,
      reserved: 0, // reserved removed from the form — available == on hand
      status: v.status || "In stock",
      ...(variants.length ? { colors: variants.map((c) => ({ color: c.name, oh_inv: Math.max(Number(perColor[c.name]) || 0, 0) })) } : {}),
    };
    startTransition(async () => {
      const res = await addInventory(payload);
      if ("error" in res) {
        setError(res.error);
        return;
      }
      setOpen(false);
      reset();
      router.refresh();
    });
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-sm transition-all hover:opacity-90 active:scale-[0.98]"
      >
        + Add Inventory
      </button>
      <Modal
        open={open}
        onClose={() => {
          setOpen(false);
          reset();
        }}
        title="Add Inventory Item"
        description="Pick a product to autofill, then set quantities"
        size="lg"
      >
        <form onSubmit={onSubmit}>
          {/* LAYOUT — 100% pareho ng Add Product / Customized builder; lahat
              ng galing sa produkto ay READ-ONLY, On Hand + Status lang ang
              ine-edit dito. */}
          <div className="space-y-3">
            <div className="flex flex-col gap-1.5">
              <label className={goldLabel}>Select Product</label>
              <ProductPicker
                products={products}
                onPick={(p) => pickProduct(String(p.id))}
              />
            </div>
            {/* Photo ng napiling produkto — basahin lang */}
            {v.image_url && (
              <div>
                <label className={`mb-0.5 block ${goldLabel}`}>Photos</label>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={v.image_url} alt={v.product_name} className="h-20 w-20 rounded-lg border border-border object-cover" />
              </div>
            )}
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className={`mb-0.5 block ${goldLabel}`}>SKU · auto</label>
                <input value={v.sku || "—"} readOnly className={cn(inputClass, "w-full cursor-not-allowed bg-stone-100 text-xs font-mono text-muted")} />
              </div>
              <div>
                <label className={`mb-0.5 block ${goldLabel}`}>Category</label>
                <input value={v.category || "—"} readOnly className={cn(inputClass, "w-full bg-stone-100 text-xs text-muted")} />
              </div>
              <div>
                <label className={`mb-0.5 block ${goldLabel}`}>Product Type</label>
                <div className="grid grid-cols-2 overflow-hidden rounded-md border border-border">
                  {(["Local", "Imported"] as const).map((t, ti) => (
                    <span key={t} className={`px-1 py-1.5 text-center text-xs font-bold ${ti > 0 ? "border-l border-border" : ""} ${v.product_type === t ? (t === "Imported" ? "bg-blue-700 text-white" : "bg-emerald-700 text-white") : "bg-surface text-muted"}`}>
                      {t}{v.product_type === t ? " ✓" : ""}
                    </span>
                  ))}
                </div>
              </div>
            </div>
            <div>
              <label className={`mb-0.5 block ${goldLabel}`}>Product / Name *</label>
              <input value={v.product_name || ""} readOnly className={cn(inputClass, "w-full bg-stone-100 text-muted")} />
            </div>
            <div>
              <label className={`mb-0.5 block ${goldLabel}`}>Price (₱)</label>
              <input value={v.price || "—"} readOnly className={cn(inputClass, "w-full bg-stone-100 text-muted")} />
            </div>
            {/* SPECS ng napiling produkto — parehong guided cards ng
                Customized (MEASUREMENTS/DETAILS), read-only lang dito. */}
            <SpecFieldsView category={v.category} specs={v.specs} />
            {/* ANG DALAWANG EDITABLE — On Hand at Status. INVENTORY KADA
                KULAY (0232): may color variants ang produkto → isang On Hand
                kada kulay, isang inventory row kada kulay; ang status ay
                awtomatiko mula sa bilang. */}
            {variants.length > 0 ? (
              <div className="border-t border-dashed border-border pt-3">
                <div className="mb-1 flex items-center justify-between">
                  <label className={goldLabel}>On Hand per color</label>
                  <span className="text-[10px] text-muted">{variants.length} color{variants.length === 1 ? "" : "s"} · one inventory row each</span>
                </div>
                <div className="overflow-hidden rounded-lg border border-border">
                  {variants.map((c, i) => (
                    <div key={c.name} className={`flex items-center gap-3 px-3 py-2 ${i > 0 ? "border-t border-border" : ""}`}>
                      {c.images[0] || c.swatch ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={imageUrl(c.images[0] || c.swatch || "")} alt={c.name} className="h-9 w-9 shrink-0 rounded border border-border bg-white object-contain" />
                      ) : (
                        <span className="h-9 w-9 shrink-0 rounded border border-border" style={{ backgroundColor: c.color ?? "#ddd" }} />
                      )}
                      <span className="min-w-0 flex-1 truncate text-sm font-semibold">{c.name}</span>
                      <input
                        type="number"
                        min={0}
                        value={perColor[c.name] ?? ""}
                        onChange={(e) => setPerColor((p) => ({ ...p, [c.name]: e.target.value }))}
                        placeholder="0"
                        className={cn(inputClass, "w-24 text-right")}
                      />
                      <span className={`w-20 shrink-0 text-right text-[10px] font-bold ${(Number(perColor[c.name]) || 0) <= 0 ? "text-rose-600" : (Number(perColor[c.name]) || 0) <= 3 ? "text-amber-600" : "text-emerald-600"}`}>
                        {(Number(perColor[c.name]) || 0) <= 0 ? "Out of stock" : (Number(perColor[c.name]) || 0) <= 3 ? "Low stock" : "In stock"}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-3 border-t border-dashed border-border pt-3">
                <div>
                  <label className={`mb-0.5 block ${goldLabel}`}>On Hand</label>
                  <input type="number" min={0} value={v.oh_inv} onChange={(e) => set("oh_inv")(e.target.value)} placeholder="0" className={cn(inputClass, "w-full")} />
                </div>
                <div>
                  <label className={`mb-0.5 block ${goldLabel}`}>Status</label>
                  <select value={v.status} onChange={(e) => set("status")(e.target.value)} className={cn(inputClass, "w-full")}>
                    {STATUS_OPTIONS.map((o) => (
                      <option key={o} value={o}>{o}</option>
                    ))}
                  </select>
                </div>
              </div>
            )}
          </div>

          <p className="mt-3 text-xs text-muted">
            {variants.length ? "Total on hand (all colors): " : "Available (auto): "}<span className="font-semibold text-foreground">{available}</span>
          </p>

          {error && (
            <p className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-xs font-medium text-red-700 ring-1 ring-inset ring-red-600/20">
              {error}
            </p>
          )}
          <FormButtons pending={pending} onCancel={() => { setOpen(false); reset(); }} submitLabel="Save Item" />
        </form>
      </Modal>
    </>
  );
}

// --------------------------------------------------------- Row actions
export function InventoryRowActions({ row }: { row: InventoryRowWithProduct }) {
  const [editOpen, setEditOpen] = useState(false);
  const [delOpen, setDelOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  function onEdit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const payload = readForm(e.currentTarget);
    if (!payload.product_name) {
      setError("Product name is required.");
      return;
    }
    startTransition(async () => {
      const res = await updateInventory(row.id, payload);
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
      const res = await deleteInventory(row.id);
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
      <div className="flex items-center justify-center gap-1">
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

      <Modal
        open={editOpen}
        onClose={() => setEditOpen(false)}
        title="Edit Inventory Item"
        description={`Updating "${row.product_name}"`}
        size="lg"
      >
        <form onSubmit={onEdit}>
          <Fields row={row} />
          {error && (
            <p className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-xs font-medium text-red-700 ring-1 ring-inset ring-red-600/20">
              {error}
            </p>
          )}
          <FormButtons pending={pending} onCancel={() => setEditOpen(false)} submitLabel="Save Changes" />
        </form>
      </Modal>

      <Modal
        open={delOpen}
        onClose={() => setDelOpen(false)}
        title="Delete Inventory Item"
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
          Delete <span className="font-semibold">{row.product_name}</span> from inventory?
          This cannot be undone.
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

function FormButtons({
  pending,
  onCancel,
  submitLabel,
}: {
  pending: boolean;
  onCancel: () => void;
  submitLabel: string;
}) {
  return (
    <div className="mt-5 flex justify-end gap-2">
      <button
        type="button"
        onClick={onCancel}
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
        {pending ? "Saving…" : submitLabel}
      </button>
    </div>
  );
}
