"use client";

// Small UI building blocks for the admin panel.

import Image from "next/image";
import { useRef, useState, type ReactNode } from "react";
import { apiUpload, extOf } from "./api";
import { COLLECTIONS, findByPrefix, products } from "@/lib/products";

export function Field({
  label,
  value,
  onChange,
  type = "text",
  placeholder,
}: {
  label: string;
  value: string | number;
  onChange: (v: string) => void;
  type?: string;
  placeholder?: string;
}) {
  return (
    <label className="block mb-3">
      <span className="block text-xs font-bold text-stone mb-1">{label}</span>
      <input
        type={type}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className="w-full border border-stone/40 bg-white px-3 py-2 text-sm focus:outline-none focus:border-cognac rounded"
      />
    </label>
  );
}

export function Area({
  label,
  value,
  onChange,
  rows = 3,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  rows?: number;
}) {
  return (
    <label className="block mb-3">
      <span className="block text-xs font-bold text-stone mb-1">{label}</span>
      <textarea
        value={value}
        rows={rows}
        onChange={(e) => onChange(e.target.value)}
        className="w-full border border-stone/40 bg-white px-3 py-2 text-sm focus:outline-none focus:border-cognac rounded"
      />
    </label>
  );
}

export function Check({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex items-center gap-2 text-sm mb-2 cursor-pointer">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="accent-cognac"
      />
      {label}
    </label>
  );
}

export function Btn({
  children,
  onClick,
  kind = "primary",
  small = false,
}: {
  children: ReactNode;
  onClick: () => void;
  kind?: "primary" | "danger" | "ghost";
  small?: boolean;
}) {
  const base = small ? "px-3 py-1.5 text-xs" : "px-5 py-2.5 text-sm";
  const style =
    kind === "primary"
      ? "bg-ink text-cream hover:bg-cognac"
      : kind === "danger"
        ? "bg-red-700 text-cream hover:bg-red-800"
        : "border border-stone/40 hover:border-ink";
  return (
    <button onClick={onClick} className={`${base} ${style} font-bold rounded transition-colors`}>
      {children}
    </button>
  );
}

export function SaveBar({
  onSave,
  saving,
  saved,
}: {
  onSave: () => void;
  saving: boolean;
  saved: boolean;
}) {
  return (
    <div className="sticky bottom-0 bg-cream border-t border-sand py-3 flex items-center gap-3 mt-6">
      <Btn onClick={onSave}>{saving ? "SAVING..." : "SAVE ALL CHANGES"}</Btn>
      {saved && <span className="text-green-700 text-sm font-bold">✓ Saved! Refresh the site to see the changes.</span>}
    </div>
  );
}

// ---------- Link dropdown (kapalit ng manual na /collections/... typing) ----------
const PAGE_OPTIONS: { label: string; href: string }[] = [
  { label: "Homepage", href: "/" },
  ...Object.entries(COLLECTIONS).map(([slug, c]) => ({
    label: `Collection: ${c.title}`,
    href: `/collections/${slug}`,
  })),
  { label: "Contact page", href: "/contact" },
  { label: "FAQs page", href: "/faqs" },
  { label: "Shipping page", href: "/shipping" },
  { label: "Measuring guide", href: "/measuring" },
];

export function LinkSelect({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  const known = PAGE_OPTIONS.some((o) => o.href === value);
  const [custom, setCustom] = useState(!known && !!value);
  return (
    <label className="block mb-3">
      <span className="block text-xs font-bold text-stone mb-1">{label}</span>
      {custom ? (
        <div className="flex gap-2">
          <input
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder="/custom-link"
            className="flex-1 border border-stone/40 bg-white px-3 py-2 text-sm rounded focus:outline-none focus:border-cognac"
          />
          <button
            type="button"
            onClick={() => setCustom(false)}
            className="text-xs text-stone underline"
          >
            pick from list
          </button>
        </div>
      ) : (
        <select
          value={known ? value : ""}
          onChange={(e) => {
            if (e.target.value === "__custom__") setCustom(true);
            else onChange(e.target.value);
          }}
          className="w-full border border-stone/40 bg-white px-3 py-2 text-sm rounded focus:outline-none focus:border-cognac"
        >
          {!known && <option value="">— select a page —</option>}
          {PAGE_OPTIONS.map((o) => (
            <option key={o.href} value={o.href}>
              {o.label}
            </option>
          ))}
          <option value="__custom__">Custom link…</option>
        </select>
      )}
    </label>
  );
}

// ---------- Product picker (kapalit ng comma-separated slugs) ----------
export function ProductPicker({
  label,
  value,
  onChange,
  max,
}: {
  label: string;
  value: string[]; // product slugs/prefixes
  onChange: (v: string[]) => void;
  max?: number;
}) {
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState(false);
  const q = search.trim().toLowerCase();
  // Bukas ang dropdown = ipakita LAHAT (o filtered kung may type)
  const matches = products.filter(
    (p) =>
      (!q || p.name.toLowerCase().includes(q) || p.slug.includes(q)) &&
      !value.some((v) => p.slug.startsWith(v))
  );
  const full = max !== undefined && value.length >= max;

  return (
    <div className="mb-3">
      <div className="flex items-center justify-between mb-1">
        <span className="block text-xs font-bold text-stone">
          {label}
          {max ? ` (${value.length}/${max})` : ""}
        </span>
        {value.length > 0 && (
          <button
            type="button"
            onClick={() => onChange([])}
            className="text-xs text-red-700 hover:text-red-900 font-bold"
          >
            ✕ CLEAR ALL
          </button>
        )}
      </div>
      {/* Napiling products bilang chips */}
      <div className="flex flex-wrap gap-2 mb-2">
        {value.map((v, i) => {
          const p = findByPrefix(v);
          return (
            <span
              key={v + i}
              className="inline-flex items-center gap-2 bg-linen border border-sand rounded-full pl-3 pr-1.5 py-1 text-xs"
            >
              {p?.name ?? v}
              <button
                type="button"
                onClick={() => onChange(value.filter((_, x) => x !== i))}
                aria-label="Remove"
                className="w-4 h-4 rounded-full bg-stone/30 hover:bg-red-600 hover:text-white leading-none"
              >
                ×
              </button>
            </span>
          );
        })}
        {value.length === 0 && (
          <span className="text-xs text-stone italic">None selected yet</span>
        )}
      </div>
      {/* Dropdown: click = lalabas LAHAT ng products; type = filter lang */}
      {!full && (
        <div className="relative">
          <div className="flex items-center border border-stone/40 bg-white rounded focus-within:border-cognac">
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onFocus={() => setOpen(true)}
              onBlur={() => setTimeout(() => setOpen(false), 150)}
              placeholder="Select a product…"
              className="flex-1 px-3 py-2 text-sm rounded focus:outline-none bg-transparent"
            />
            <button
              type="button"
              onMouseDown={(e) => {
                e.preventDefault();
                setOpen(!open);
              }}
              aria-label="Toggle list"
              className={`px-3 text-stone transition-transform ${open ? "rotate-180" : ""}`}
            >
              ⌄
            </button>
          </div>
          {open && (
            <div className="absolute z-20 inset-x-0 top-full mt-1 bg-white border border-sand rounded shadow-lg divide-y divide-sand max-h-72 overflow-y-auto">
              {matches.length === 0 && (
                <p className="px-3 py-3 text-sm text-stone">No matches.</p>
              )}
              {matches.map((p) => (
                <button
                  key={p.slug}
                  type="button"
                  // onMouseDown para hindi maunahan ng blur ang pagpili
                  onMouseDown={(e) => {
                    e.preventDefault();
                    if (value.includes(p.slug)) return; // iwas duplicate
                    onChange([...value, p.slug]);
                    setSearch("");
                    if (max !== undefined && value.length + 1 >= max) setOpen(false);
                  }}
                  className="flex items-center gap-3 w-full text-left px-3 py-2 text-sm hover:bg-linen"
                >
                  {p.images[0] && (
                    <span className="relative w-8 h-8 shrink-0 rounded overflow-hidden bg-sand">
                      <Image src={p.images[0]} alt="" fill className="object-cover" sizes="32px" />
                    </span>
                  )}
                  <span className="flex-1">{p.name}</span>
                  <span className="text-xs text-stone">{p.category}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ---------- Modal ----------
export function Modal({
  open,
  title,
  onClose,
  children,
  width = "max-w-md",
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  width?: string;
}) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-ink/60 backdrop-blur-sm" onClick={onClose} />
      <div className={`relative bg-white rounded-lg shadow-2xl w-full ${width} p-6 max-h-[85vh] overflow-y-auto`}>
        <div className="flex justify-between items-center mb-5">
          <h3 className="font-bold text-lg">{title}</h3>
          <button
            onClick={onClose}
            aria-label="Close"
            className="text-stone hover:text-ink text-2xl leading-none -mt-1"
          >
            ×
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

// ---------- Confirm / alert dialogs (kapalit ng browser confirm/alert) ----------
type DialogState = {
  type: "confirm" | "alert";
  title: string;
  message: string;
  confirmLabel: string;
  resolve: (v: boolean) => void;
} | null;

export function useDialogs() {
  const [state, setState] = useState<DialogState>(null);

  function confirmDlg(message: string, confirmLabel = "YES, DELETE", title = "Are you sure?") {
    return new Promise<boolean>((resolve) =>
      setState({ type: "confirm", title, message, confirmLabel, resolve })
    );
  }
  function alertDlg(message: string, title = "Notice") {
    return new Promise<boolean>((resolve) =>
      setState({ type: "alert", title, message, confirmLabel: "OK", resolve })
    );
  }
  function close(v: boolean) {
    state?.resolve(v);
    setState(null);
  }

  const dialogs = (
    <Modal open={!!state} title={state?.title ?? ""} onClose={() => close(false)}>
      <p className="text-sm text-ink/80 mb-6 whitespace-pre-line">{state?.message}</p>
      <div className="flex justify-end gap-2">
        {state?.type === "confirm" && (
          <Btn kind="ghost" onClick={() => close(false)}>
            CANCEL
          </Btn>
        )}
        <Btn
          kind={state?.type === "confirm" ? "danger" : "primary"}
          onClick={() => close(true)}
        >
          {state?.confirmLabel}
        </Btn>
      </div>
    </Modal>
  );

  return { dialogs, confirmDlg, alertDlg };
}

// ---------- Image list with drag-drop upload + drag reorder ----------
export function ImageList({
  images,
  onChange,
  uploadDir,
  baseName,
  unique = false,
  hint,
}: {
  images: string[];
  onChange: (imgs: string[]) => void;
  uploadDir: string; // e.g. "images/products"
  baseName: string; // e.g. product slug
  // unique: timestamp-based filenames — use when baseName is NOT stable
  // (e.g. review index) so uploads never overwrite each other
  unique?: boolean;
  hint?: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const dragIdx = useRef<number | null>(null);

  // Next available number for the slug-N pattern
  function nextIndex(current: string[]): number {
    let max = 0;
    for (const img of current) {
      const m = img.match(/-(\d+)\.\w+$/);
      if (m) max = Math.max(max, parseInt(m[1], 10));
    }
    return max + 1;
  }

  async function handleFiles(files: FileList | File[]) {
    setUploading(true);
    setError("");
    let current = [...images];
    try {
      const batch = Array.from(files);
      for (let i = 0; i < batch.length; i++) {
        const f = batch[i];
        const name = unique
          ? `${baseName}-${Date.now()}-${i}.${extOf(f)}`
          : `${baseName}-${nextIndex(current)}.${extOf(f)}`;
        const url = await apiUpload(`${uploadDir}/${name}`, f);
        current = [...current, url];
      }
      onChange(current);
    } catch (e) {
      setError("Upload failed: " + (e as Error).message);
    }
    setUploading(false);
  }

  function reorder(from: number, to: number) {
    const arr = [...images];
    const [moved] = arr.splice(from, 1);
    arr.splice(to, 0, moved);
    onChange(arr);
  }

  return (
    <div className="mb-3">
      <span className="block text-xs font-bold text-stone mb-1">
        Photos (first photo = main image · drag to reorder)
      </span>
      {hint && (
        <p className="text-[11px] text-cognac mb-1">
          📐 {hint} — auto-center &amp; fit
        </p>
      )}
      <div className="flex flex-wrap gap-2 mb-2">
        {images.map((img, i) => (
          <div
            key={img + i}
            draggable
            onDragStart={() => (dragIdx.current = i)}
            onDragOver={(e) => e.preventDefault()}
            onDrop={() => {
              if (dragIdx.current !== null && dragIdx.current !== i) reorder(dragIdx.current, i);
              dragIdx.current = null;
            }}
            className={`relative w-20 h-20 border-2 rounded overflow-hidden cursor-grab ${
              i === 0 ? "border-cognac" : "border-sand"
            }`}
            title={img}
          >
            <Image src={img} alt="" fill className="object-cover" sizes="80px" />
            {i === 0 && (
              <span className="absolute bottom-0 inset-x-0 bg-cognac text-cream text-[8px] text-center">MAIN</span>
            )}
            <button
              onClick={() => onChange(images.filter((_, x) => x !== i))}
              className="absolute top-0 right-0 bg-red-700 text-cream w-5 h-5 text-xs leading-none"
              aria-label="Remove"
            >
              ×
            </button>
          </div>
        ))}
      </div>
      <div
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          if (e.dataTransfer.files.length) handleFiles(e.dataTransfer.files);
        }}
        className={`border-2 border-dashed rounded p-4 text-center text-sm cursor-pointer transition-colors ${
          dragOver ? "border-cognac bg-cognac/10" : "border-stone/40 hover:border-cognac"
        }`}
      >
        {uploading ? "Uploading..." : "📷 Drag photos HERE or click to browse"}
      </div>
      {error && <p className="text-red-700 text-xs mt-1">{error}</p>}
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        multiple
        hidden
        onChange={(e) => e.target.files && handleFiles(e.target.files)}
      />
    </div>
  );
}

// ---------- Single image with upload ----------
export function SingleImage({
  label,
  value,
  onChange,
  uploadDir,
  baseName,
  hint,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  uploadDir: string;
  baseName: string;
  hint?: string; // hal. "Recommended: 2520×1080 (landscape)"
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");

  async function handleFile(f: File) {
    setUploading(true);
    setError("");
    try {
      const url = await apiUpload(`${uploadDir}/${baseName}-${Date.now()}.${extOf(f)}`, f);
      onChange(url);
    } catch (e) {
      setError("Upload failed: " + (e as Error).message);
    }
    setUploading(false);
  }

  return (
    <div className="mb-3">
      <span className="block text-xs font-bold text-stone mb-1">{label}</span>
      {hint && (
        <p className="text-[11px] text-cognac mb-1">
          📐 {hint} — auto-center &amp; fit (any size adjusts automatically)
        </p>
      )}
      {error && <p className="text-red-700 text-xs mb-1">{error}</p>}
      <div className="flex items-center gap-3">
        {value && (
          <div className="relative w-24 h-16 border border-sand rounded overflow-hidden shrink-0">
            <Image src={value} alt="" fill className="object-cover object-center" sizes="96px" />
          </div>
        )}
        <button
          onClick={() => inputRef.current?.click()}
          className="border border-stone/40 hover:border-cognac px-3 py-1.5 text-xs font-bold rounded"
        >
          {uploading ? "Uploading..." : "REPLACE / UPLOAD"}
        </button>
        <span className="text-xs text-stone truncate max-w-[200px]">{value}</span>
      </div>
      <input
        ref={inputRef}
        type="file"
        accept="image/*,.gif"
        hidden
        onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])}
      />
    </div>
  );
}
