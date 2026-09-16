"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Modal } from "./modal";
import { cn } from "./ui";
import { applyStock } from "@/app/scan/actions";
import type { CatalogItem, Stock } from "@/app/scan/catalog";
import { scanLock } from "@/lib/scan-lock";
import type { ProductRow } from "@/lib/supabase/server";

// Short confirmation beep on a successful scan (warehouse-friendly).
function beep() {
  try {
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const a = new Ctx();
    const o = a.createOscillator();
    const g = a.createGain();
    o.connect(g); g.connect(a.destination);
    o.frequency.value = 880;
    o.start();
    g.gain.setValueAtTime(0.12, a.currentTime);
    g.gain.exponentialRampToValueAtTime(0.0001, a.currentTime + 0.12);
    o.stop(a.currentTime + 0.13);
  } catch { /* no audio — ignore */ }
}

// Warehouse In/Out via barcode scan. Open → "Waiting for Product Information" →
// scan a product barcode → INSTANT preview (in-memory) → qty → Post.
export function WhsScanButton({ direction, label, title, catalog }: { direction: "in" | "out"; label?: string; title?: string; catalog: CatalogItem[] }) {
  const isIn = direction === "in";
  const [open, setOpen] = useState(false);
  const [product, setProduct] = useState<ProductRow | null>(null);
  const [stock, setStock] = useState<Stock | null>(null);
  const [qty, setQty] = useState(1);
  const [flash, setFlash] = useState(false);
  const [toast, setToast] = useState<{ ok: boolean; msg: string } | null>(null);
  const [posting, startPost] = useTransition();
  const router = useRouter();

  function reset() {
    setProduct(null); setStock(null); setQty(1); setToast(null);
  }

  // Instant client-side lookup (no server round-trip).
  function lookup(code: string) {
    let c = code.replace(/^[\s -]*\{[ABC]/i, "").trim().toLowerCase();
    // Collapse an exact doubled scan (held trigger / double-scan → "ABCABC").
    if (c.length % 2 === 0 && c.slice(0, c.length / 2) === c.slice(c.length / 2)) {
      c = c.slice(0, c.length / 2);
    }
    if (c.length < 2) return;
    const hit = catalog.find((it) =>
      (it.product.barcode ?? "").toLowerCase() === c ||
      (it.product.sku ?? "").toLowerCase() === c ||
      `pf-${it.product.id}` === c,
    );
    if (hit) {
      setProduct(hit.product); setStock(hit.stock); setQty(1); setToast(null);
      beep();
      setFlash(true); setTimeout(() => setFlash(false), 350);
    } else {
      setToast({ ok: false, msg: `No product found for: ${code.trim()}` });
    }
  }

  function post() {
    if (!product) return;
    startPost(async () => {
      const res = await applyStock({
        sku: product.sku ?? null,
        product_name: product.product_name,
        direction,
        qty: Number(qty) || 1,
        category: product.category ?? null,
        color: product.color ?? null,
        dimension: product.dimension ?? null,
        users: "Joemarie",
      });
      if ("error" in res) { setToast({ ok: false, msg: res.error }); return; }
      setToast({ ok: true, msg: `WHS Stock ${isIn ? "IN" : "OUT"} ${qty} ✓ — On hand: ${res.onHand}` });
      setProduct(null); setStock(null); setQty(1);
      router.refresh();
    });
  }

  // While open: hold the scan lock (suppress GlobalScanListener) and capture the
  // hardware scanner ourselves (keyboard wedge), even when no field is focused.
  useEffect(() => {
    if (!open) return;
    scanLock.acquire();
    let buf = "";
    let last = 0;
    let idle: ReturnType<typeof setTimeout> | null = null;
    const flush = () => { const v = buf.trim(); buf = ""; if (v.length >= 2) lookup(v); };
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName?.toLowerCase();
      if (tag === "input" || tag === "textarea" || tag === "select") return;
      const now = Date.now();
      if (now - last > 120) buf = ""; // gap = new scan / human → reset
      last = now;
      if (idle) clearTimeout(idle);
      if (e.key === "Enter") {
        // Stop the Enter from activating a focused button (e.g. Close) and flush.
        if (buf.trim().length >= 1) { e.preventDefault(); e.stopPropagation(); }
        flush();
        return;
      }
      if (e.key.length === 1) buf += e.key;
      // Fallback for scanners that DON'T send Enter: flush after a short idle.
      idle = setTimeout(flush, 180);
    };
    window.addEventListener("keydown", onKey, true);
    return () => { window.removeEventListener("keydown", onKey, true); if (idle) clearTimeout(idle); scanLock.release(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  return (
    <>
      <button
        onClick={() => { reset(); setOpen(true); }}
        className={cn(
          "rounded-lg px-4 py-2 text-sm font-medium text-white shadow-sm transition-all hover:opacity-90 active:scale-[0.98]",
          isIn ? "bg-success" : "bg-danger",
        )}
      >
        {label ?? (isIn ? "WHS Stock IN" : "WHS Stock Out")}
      </button>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={title ?? (isIn ? "WHS Stock IN" : "WHS Stock Out")}
        description="Scan a product barcode to begin"
        size="md"
        footer={
          <div className="flex items-center justify-between gap-2">
            {toast && (
              <span className={cn("truncate text-xs font-medium", toast.ok ? "text-success" : "text-danger")}>{toast.msg}</span>
            )}
            <div className="ml-auto flex gap-2">
              <button onClick={() => setOpen(false)} className="rounded-lg border border-border bg-surface px-4 py-2 text-sm font-medium hover:bg-stone-100">Close</button>
              {product && (
                <button onClick={post} disabled={posting} className={cn("rounded-lg px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-60", isIn ? "bg-success" : "bg-danger")}>
                  {posting ? "Posting…" : `Post WHS ${isIn ? "IN" : "OUT"}`}
                </button>
              )}
            </div>
          </div>
        }
      >
        <div className="space-y-5">
          {/* Direction banner */}
          <div className={cn("flex items-center gap-3 rounded-xl px-4 py-3", isIn ? "bg-success/10" : "bg-danger/10")}>
            <span className={cn("flex h-9 w-9 items-center justify-center rounded-full text-white", isIn ? "bg-success" : "bg-danger")}>
              {isIn ? "↓" : "↑"}
            </span>
            <div>
              <p className={cn("text-sm font-semibold", isIn ? "text-success" : "text-danger")}>{isIn ? "Stock IN" : "Stock OUT"}</p>
              <p className="text-xs text-muted">{isIn ? "Receiving into warehouse" : "Deducting from warehouse"}</p>
            </div>
          </div>

          {!product ? (
            <div className="flex flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed border-border bg-stone-50 py-14 text-center">
              <svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4" className="animate-pulse text-stone-400"><path d="M3 5v14M7 5v14M11 5v14M14 5v14M18 5v14M21 5v14" /></svg>
              <div>
                <p className="text-sm font-semibold text-stone-600">Waiting for Product Information</p>
                <p className="mt-0.5 text-xs text-muted">Scan the product barcode</p>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              {/* Product card */}
              <div className={cn("overflow-hidden rounded-xl border bg-white shadow-sm transition-all", flash ? "border-success ring-2 ring-success/40" : "border-border")}>
                <div className="flex items-start gap-4 p-4">
                  <ZoomImage url={product.image_url} name={product.product_name} />
                  <div className="min-w-0 flex-1 text-left">
                    <p className="line-clamp-3 text-[15px] font-semibold leading-snug">{product.product_name}</p>
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <span className="rounded-md bg-stone-100 px-2 py-0.5 font-mono text-xs text-stone-600 ring-1 ring-inset ring-stone-200">{product.barcode || product.sku || `PF-${product.id}`}</span>
                    </div>
                  </div>
                </div>
                <dl className="grid grid-cols-2 gap-px border-t border-border bg-border text-left">
                  <Cell k="SKU" v={product.sku} />
                  <Cell k="Category" v={product.category} />
                  <Cell k="Color" v={product.color} />
                  <Cell k="Dimension" v={product.dimension} />
                  <Cell k="Location" v={product.location} />
                  <Cell k="Supplier" v={product.supplier} />
                  <Cell k="Warehouse Location" v={product.warehouse_location} />
                  <div className="bg-white px-4 py-3">
                    <dt className="text-[11px] font-medium uppercase tracking-wide text-muted">Status</dt>
                    <dd className="mt-1">{product.status ? <StatusPill value={product.status} /> : "—"}</dd>
                  </div>
                </dl>
              </div>

              {/* Current stock */}
              {stock ? (
                <div className="grid grid-cols-3 gap-2">
                  <StockBox label="On Hand" value={stock.onHand} tone="text-foreground" ring="border-border" />
                  <StockBox label="Reserved" value={stock.reserved} tone="text-amber-600" ring="border-amber-200" />
                  <StockBox label="Available" value={stock.available} tone="text-success" ring="border-green-200" />
                </div>
              ) : (
                <p className="rounded-lg bg-amber-50 px-3 py-2 text-center text-xs font-medium text-amber-700">No inventory record yet — posting Stock IN will need an Inventory entry first.</p>
              )}

              {/* Quantity */}
              <div className="flex items-center justify-between rounded-xl border border-border p-4">
                <div>
                  <p className="text-sm font-semibold">Quantity</p>
                  <p className="text-xs text-muted">Units to {isIn ? "receive" : "deduct"}</p>
                </div>
                <div className="flex items-center gap-2">
                  <button type="button" onClick={() => setQty((q) => Math.max(1, q - 1))} className="h-10 w-10 rounded-lg border border-border text-xl leading-none hover:bg-stone-100">−</button>
                  <input type="number" min={1} value={qty} onChange={(e) => setQty(Math.max(1, Number(e.target.value) || 1))} className="w-20 rounded-lg border border-border bg-surface px-2 py-2.5 text-center text-base font-semibold outline-none focus:border-primary" />
                  <button type="button" onClick={() => setQty((q) => q + 1)} className="h-10 w-10 rounded-lg border border-border text-xl leading-none hover:bg-stone-100">+</button>
                </div>
              </div>

              <button type="button" onClick={reset} className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-border py-2 text-xs font-medium text-primary hover:bg-primary/5">
                ⟲ Scan another product
              </button>
            </div>
          )}
        </div>
      </Modal>
    </>
  );
}

// 80x80 product image with a large hover-zoom preview (escapes the modal).
function ZoomImage({ url, name }: { url?: string | null; name: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);

  if (!url) {
    return (
      <div className="flex h-20 w-20 shrink-0 items-center justify-center rounded-xl border border-border bg-white text-sm font-semibold text-muted">
        {name.slice(0, 2).toUpperCase()}
      </div>
    );
  }

  function show() {
    const r = ref.current?.getBoundingClientRect();
    if (!r) return;
    const size = 260, gap = 14;
    let x = r.right + gap;
    if (x + size > window.innerWidth - 8) x = r.left - size - gap;
    x = Math.max(8, x);
    let y = r.top + r.height / 2 - size / 2;
    y = Math.max(8, Math.min(y, window.innerHeight - size - 8));
    setPos({ x, y });
  }

  return (
    <div ref={ref} className="h-20 w-20 shrink-0" onMouseEnter={show} onMouseLeave={() => setPos(null)}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img loading="lazy" decoding="async" src={url} alt={name} className="h-20 w-20 cursor-zoom-in rounded-xl border border-border bg-white object-contain" />
      {pos && (
        // eslint-disable-next-line @next/next/no-img-element
        <img loading="lazy" decoding="async" src={url} alt={name} style={{ position: "fixed", left: pos.x, top: pos.y, width: 260, height: 260 }} className="pf-fade pointer-events-none z-[100] rounded-2xl bg-white object-contain p-3 shadow-2xl ring-1 ring-border" />
      )}
    </div>
  );
}

function Cell({ k, v, full }: { k: string; v?: string | null; full?: boolean }) {
  return (
    <div className={cn("bg-white px-4 py-3 transition-colors hover:bg-stone-50", full && "col-span-2")}>
      <dt className="text-[11px] font-medium uppercase tracking-wide text-muted">{k}</dt>
      <dd className="mt-0.5 break-words text-sm font-medium" title={v ?? undefined}>{v ?? "—"}</dd>
    </div>
  );
}

function StatusPill({ value }: { value: string }) {
  const s = value.toLowerCase();
  const tone =
    s === "active" ? "bg-green-100 text-green-700 ring-green-600/20" :
    s === "inactive" ? "bg-stone-100 text-stone-600 ring-stone-300" :
    "bg-amber-100 text-amber-700 ring-amber-600/20";
  return <span className={cn("rounded-full px-2 py-0.5 text-xs font-medium capitalize ring-1 ring-inset", tone)}>{value}</span>;
}

function StockBox({ label, value, tone, ring }: { label: string; value: number; tone: string; ring: string }) {
  return (
    <div className={cn("rounded-xl border bg-white p-3 text-center shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md", ring)}>
      <p className={cn("text-2xl font-bold tabular-nums", tone)}>{value}</p>
      <p className="mt-0.5 text-[11px] font-medium uppercase tracking-wide text-muted">{label}</p>
    </div>
  );
}
