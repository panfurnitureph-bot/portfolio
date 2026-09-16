"use client";

import { useMemo, useState } from "react";
import { cn, StatCard, SpecRows } from "./ui";
import { usePagination, PaginationFooter } from "./pagination-footer";
import { WarrantyCertificate, type CertData } from "./warranty-certificate";
import type { WarrantyData, WarrantyRow } from "@/app/warranty/data";

const inp = "rounded-md border border-border bg-surface px-2 py-1.5 text-sm outline-none focus:border-primary";
const FILTERS = ["All", "Active", "Expiring", "Expired"] as const;

function wPill(s: string) {
  if (s === "active") return "bg-green-50 text-green-700";
  if (s === "expiring") return "bg-amber-50 text-amber-700";
  return "bg-red-50 text-red-700";
}
function wLabel(s: string) { return s === "active" ? "Active" : s === "expiring" ? "Expiring" : "Expired"; }

// Days left computed LIVE on the client from valid_until in Manila time, so it
// always reflects TODAY (the server `days_left` is a load-time snapshot that can
// drift / cache). Returns null if no valid_until.
function liveDaysLeft(validUntil: string | null | undefined): number | null {
  if (!validUntil) return null;
  const end = new Date(validUntil + "T00:00:00+08:00").getTime(); // Manila midnight of expiry
  // Today at Manila midnight.
  const todayPH = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  const start = new Date(todayPH + "T00:00:00+08:00").getTime();
  if (Number.isNaN(end) || Number.isNaN(start)) return null;
  return Math.round((end - start) / 86_400_000);
}

// Isang entry kada produkto — ang hanay ay isang listahan, hindi isang
// pangungusap. Ang `items_summary` ay pambalik para sa lumang talaan na
// walang naka-parse na linya.
function itemsList(r: WarrantyRow): string[] {
  if (r.items.length) return r.items.map((i) => `${i.qty}× ${(i.description || "").split(/ \/ |\n/)[0].trim()}`);
  const sum = (r.items_summary || "").trim();
  return sum ? sum.split(/,\s*(?=\d+\s*×)/).map((t) => t.trim()).filter(Boolean) : ["—"];
}
function itemsLong(r: WarrantyRow): string {
  if (r.items.length) return r.items.map((i) => `${i.qty}× ${i.description}`).join(" | ");
  return r.items_summary || "";
}

export function WarrantyDocumentsManager({ data }: { data: WarrantyData }) {
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>("All");
  const [open, setOpen] = useState<WarrantyRow | null>(null);

  const rows = useMemo(() => {
    const s = q.trim().toLowerCase();
    return data.rows.filter((r) => {
      if (filter !== "All" && r.wstatus !== filter.toLowerCase()) return false;
      if (!s) return true;
      const hay = [r.order_number, r.warranty_no, r.customer_name, r.items_summary, ...r.items.map((i) => i.sku)].join(" ").toLowerCase();
      return hay.includes(s);
    });
  }, [data.rows, q, filter]);

  const pg = usePagination(rows);

  return (
    <div className="space-y-5">
      <div className="apk-hide grid grid-cols-2 gap-4 md:grid-cols-4">
        <StatCard label="Active" value={String(data.kpi.active)} tone="success" />
        <StatCard label="Expiring soon" value={String(data.kpi.expiring)} tone="warning" />
        <StatCard label="Expired" value={String(data.kpi.expired)} tone="danger" />
        <StatCard label="Total Documents" value={String(data.kpi.total)} tone="info" />
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search order / warranty no / customer / SKU…" className={cn(inp, "w-72")} />
        <div className="flex gap-1 rounded-lg border border-border p-0.5">
          {FILTERS.map((f) => (
            <button key={f} onClick={() => setFilter(f)} className={cn("rounded-md px-3 py-1 text-xs font-medium", filter === f ? "bg-primary text-primary-foreground" : "text-muted hover:bg-stone-100")}>{f}</button>
          ))}
        </div>
      </div>

      <div className="overflow-visible rounded-xl border border-border bg-surface shadow-sm">
        <div className="max-h-[70vh] overflow-auto rounded-t-xl">
        <table className="w-full min-w-[920px] border-collapse text-sm [&_td]:border-b [&_td]:border-r [&_td]:border-border [&_td]:text-center [&_th]:border-b [&_th]:border-r [&_th]:border-border [&_td]:!text-center [&_th]:!text-center [&_th]:font-bold [&_th]:text-center">
          <colgroup>
            <col span={4} />
            <col span={4} />
          </colgroup>
          <thead className="sticky top-0 z-10">
            <tr className="bg-[#4a3b1a] text-xs uppercase tracking-wide text-[#f4ead8]">
              <th colSpan={4} className="sticky top-0 bg-[#4a3b1a] border-b border-[#caa45a] px-5 py-2">Warranty</th>
              <th colSpan={4} className="sticky top-0 bg-[#4a3b1a] border-b border-[#caa45a] !border-l-4 !border-l-[#caa45a] px-5 py-2">Validity</th>
            </tr>
            <tr className="bg-[#5a4a26] text-xs uppercase text-[#e7dcc4]">
              <th className="sticky top-[33px] bg-[#5a4a26] px-4 py-3">Order #</th>
              <th className="sticky top-[33px] bg-[#5a4a26] px-4 py-3">Warranty #</th>
              <th className="sticky top-[33px] bg-[#5a4a26] px-4 py-3">Customer</th>
              <th className="sticky top-[33px] bg-[#5a4a26] px-4 py-3">Item(s)</th>
              <th className="sticky top-[33px] bg-[#5a4a26] !border-l-4 !border-l-[#caa45a] px-4 py-3">Start</th>
              <th className="sticky top-[33px] bg-[#5a4a26] px-4 py-3">Valid Until</th>
              <th className="sticky top-[33px] bg-[#5a4a26] px-4 py-3">Days Left</th>
              <th className="sticky top-[33px] bg-[#5a4a26] px-4 py-3">Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr><td colSpan={8} className="px-4 py-12 text-center text-muted">No warranty documents yet. Completed + signed installations appear here.</td></tr>
            ) : pg.slice.map((r) => (
              <tr key={r.installation_id ?? r.order_id ?? r.warranty_no} onClick={() => setOpen(r)} className="cursor-pointer border-b border-border last:border-0 hover:bg-stone-50">
                <td className="px-4 py-3 font-semibold">
                  {r.has_rework && (
                    <span className="mb-0.5 flex w-fit items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-amber-700 ring-1 ring-inset ring-amber-200">Reworked</span>
                  )}
                  {r.order_number || "—"}
                </td>
                <td className="px-4 py-3 font-medium text-primary">{r.warranty_no}</td>
                <td className="px-4 py-3">{r.customer_name || "—"}</td>
                {/* ISANG LINYA KADA PRODUKTO (hiling 2026-08-29). Isang mahabang
                    comma-list ito noon na pinuputol sa dalawang linya — ang
                    order na may apat na mesa ay nagtatapos sa "1× PAN Dining…"
                    at hindi na masabi kung ilan pa ang natitira. Tatlo ang
                    kasya; ang labis ay binibilang, at ang buo ay nasa tooltip. */}
                <td className="px-4 py-3 text-muted">
                  <div className="mx-auto w-fit max-w-[320px] text-left" title={itemsLong(r)}>
                    {itemsList(r).slice(0, 3).map((t, i) => (
                      <div key={i} className="truncate leading-snug">{t}</div>
                    ))}
                    {itemsList(r).length > 3 && (
                      <div className="text-[11px] font-semibold text-[#8a6a1f]">+{itemsList(r).length - 3} more</div>
                    )}
                  </div>
                </td>
                <td className="!border-l-4 !border-l-[#caa45a] px-4 py-3 text-center text-muted">{r.warranty_start || "—"}</td>
                <td className="px-4 py-3 text-center text-muted">{r.valid_until || "—"}</td>
                <td className={cn("px-4 py-3 text-center font-medium tabular-nums", r.wstatus === "expired" ? "text-muted" : r.wstatus === "expiring" ? "text-amber-600" : "text-green-700")}>
                  {(() => { const dl = liveDaysLeft(r.valid_until); return r.wstatus === "expired" || dl == null || dl <= 0 ? "—" : dl; })()}
                </td>
                <td className="px-4 py-3 text-center"><span className={cn("rounded-full px-2 py-0.5 text-xs font-medium", wPill(r.wstatus))}>{wLabel(r.wstatus)}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
        <PaginationFooter {...pg} />
      </div>

      {open && <DetailModal r={open} onClose={() => setOpen(null)} />}
    </div>
  );
}

function rowToCert(r: WarrantyRow): CertData {
  return {
    warrantyNo: r.warranty_no,
    dateIssued: r.install_date ?? "",
    branch: "Main Branch",
    salesRep: r.sales_rep ?? "",
    customerName: r.customer_name ?? "",
    contact: r.contact_number ?? "",
    email: r.email ?? "",
    address: r.address ?? "",
    invoice: r.order_number ?? "",
    datePurchase: r.date_purchase ?? "",
    dateDelivered: r.date_delivered ?? "",
    mop: r.mop ?? "",
    driver: r.driver_team ?? "",
    installer: r.installer_team ?? "",
    coordinator: r.coordinator ?? "",
    items: r.items,
    warrantyDuration: r.warranty_duration ?? "1 Year",
    validUntil: r.valid_until ?? "",
    signatureUrl: r.signature_url,
  };
}

function DetailModal({ r, onClose }: { r: WarrantyRow; onClose: () => void }) {
  const [showCert, setShowCert] = useState(false);
  // Pinirmahang form ng isang rework visit (imahe) — hiwalay sa orihinal.
  const [showForm, setShowForm] = useState<{ url: string; title: string } | null>(null);

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4" onClick={onClose}>
      <div className="my-6 w-full max-w-5xl rounded-2xl bg-surface shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-border px-5 py-3">
          <div>
            <h2 className="flex items-center gap-2 text-sm font-semibold">
              {r.warranty_no} · {r.customer_name}
              {r.has_rework && (
                <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-amber-700 ring-1 ring-inset ring-amber-200">Reworked</span>
              )}
            </h2>
            <p className="text-xs text-muted">Order # {r.order_number || "—"}</p>
          </div>
          <div className="flex items-center gap-2">
            <span className={cn("rounded-full px-2 py-0.5 text-xs font-medium", wPill(r.wstatus))}>{wLabel(r.wstatus)}</span>
            <button onClick={onClose} className="text-muted hover:text-foreground">✕</button>
          </div>
        </div>

        <div className="space-y-4 bg-stone-50/40 p-5">
          <Section
            title="Warranty Details"
            action={
              <div className="flex flex-wrap items-center justify-end gap-1.5">
                <button onClick={() => setShowCert(true)} className="rounded-lg border border-border bg-surface px-3 py-1.5 text-xs font-medium hover:bg-stone-100">{r.rework_forms?.length ? "Original Warranty Form" : "View Warranty Form"}</button>
                {/* ISANG PINDUTAN KADA REWORK VISIT (2026-09-06): ang form na pinirmahan
                    sa rework ay ang inayos lang ang laman — kasama ito sa dokumento. */}
                {(r.rework_forms ?? []).map((f, i) => (
                  <button
                    key={f.id}
                    disabled={!f.warranty_form_url && !f.signature_url}
                    onClick={() => { const url = f.warranty_form_url ?? f.signature_url; if (url) setShowForm({ url, title: `Rework form ${i + 1}${f.install_date ? ` · ${f.install_date}` : ""}${f.items_summary ? ` · ${f.items_summary}` : ""}` }); }}
                    className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-1.5 text-xs font-medium text-amber-800 hover:bg-amber-100 disabled:opacity-50"
                    title={f.items_summary ?? undefined}
                  >
                    Rework form{f.install_date ? ` · ${f.install_date}` : ` ${i + 1}`}
                  </button>
                ))}
              </div>
            }
          >
            <SpecRows
              labelWidth="w-28"
              items={[
                ["Order #", r.order_number],
                ["Warranty #", r.warranty_no],
                ["Sales Rep", r.sales_rep],
                ["Installed", r.install_date],
                ["Driver", r.driver_team],
                ["Installer", r.installer_team],
                ["Coverage", `${r.warranty_duration ?? "—"} · ${r.warranty_terms ?? "—"}`],
                ["Start", r.warranty_start],
                ["Valid Until", r.valid_until],
                ["Days Left", (() => { const dl = liveDaysLeft(r.valid_until); return r.wstatus === "expired" || dl == null || dl <= 0 ? "Expired" : `${dl} days`; })()],
              ]}
            />
          </Section>

          <Section title={`Items (${r.items.length})`} flush>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[680px] border-collapse text-sm [&_td]:border [&_td]:border-stone-400 [&_td]:px-2 [&_td]:py-1.5 [&_td]:text-center [&_th]:border [&_th]:border-stone-400 [&_th]:bg-stone-100 [&_th]:px-2 [&_th]:py-2 [&_th]:text-center">
                <thead><tr className="text-xs uppercase text-muted"><th>Photo</th><th className="min-w-[260px] text-left">Item</th><th>SKU</th><th>Category</th><th>Color</th><th>Dimension</th><th>Qty</th></tr></thead>
                <tbody>
                  {r.items.length === 0 ? <tr><td colSpan={7} className="py-3 text-center text-muted">{r.items_summary || "—"}</td></tr>
                    : r.items.map((x, i) => (
                      <tr key={i}>
                        <td>{x.image_url ? /* eslint-disable-next-line @next/next/no-img-element */ <img loading="lazy" decoding="async" src={x.image_url} alt="" className="mx-auto h-9 w-9 rounded object-cover" /> : "—"}</td>
                        <td className="text-left text-muted">{x.customized && <span className="mb-0.5 block w-fit rounded bg-amber-100 px-1 text-[9px] font-bold uppercase tracking-wide text-amber-700">Customized</span>}{x.description || "—"}</td>
                        <td className="text-muted">{x.sku || "—"}</td>
                        <td className="text-muted">{x.category || "—"}</td>
                        <td className="text-muted">{x.color || "—"}</td>
                        <td className="text-muted">{x.dimension || "—"}</td>
                        <td className="tabular-nums">{x.qty}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          </Section>

          {r.photos.length > 0 && (
            <Section title={`Installation Photos (${r.photos.length})`}>
              <div className="flex max-h-44 flex-wrap gap-2 overflow-y-auto">
                {r.photos.map((p, i) => (
                  // eslint-disable-next-line @next/next/no-img-element
                  <a key={i} href={p} target="_blank" rel="noreferrer"><img loading="lazy" decoding="async" src={p} alt="" className="h-14 w-14 rounded-lg border border-border object-cover hover:opacity-80" /></a>
                ))}
              </div>
            </Section>
          )}
        </div>
      </div>

      {showForm && (
        <div className="fixed inset-0 z-[80] flex items-start justify-center overflow-y-auto bg-black/60 p-4" onClick={() => setShowForm(null)}>
          <div className="my-6 w-full max-w-4xl" onClick={(e) => e.stopPropagation()}>
            <div className="rounded-t-xl bg-white px-4 py-2 text-sm font-semibold text-stone-800">{showForm.title}</div>
            {/^https?:\/\/.*\.pdf(\?|$)/i.test(showForm.url)
              ? <iframe src={`${showForm.url}#toolbar=0&navpanes=0&view=Fit`} title={showForm.title} className="h-[80vh] w-full rounded-b-xl bg-white" />
              /* eslint-disable-next-line @next/next/no-img-element */
              : <img src={showForm.url} alt={showForm.title} className="w-full rounded-b-xl bg-white" />}
            <div className="mt-3 flex justify-end">
              <button onClick={() => setShowForm(null)} className="rounded-lg bg-white px-4 py-2 text-sm font-medium text-stone-700 shadow hover:bg-stone-100">Close</button>
            </div>
          </div>
        </div>
      )}
      {showCert && (
        <div className="fixed inset-0 z-[80] flex items-start justify-center overflow-y-auto bg-black/60 p-4" onClick={() => setShowCert(false)}>
          <div className="my-6 w-full max-w-4xl" onClick={(e) => e.stopPropagation()}>
            <WarrantyCertificate d={rowToCert(r)} />
            <div className="mt-3 flex justify-end">
              <button onClick={() => setShowCert(false)} className="rounded-lg bg-white px-4 py-2 text-sm font-medium text-stone-700 shadow hover:bg-stone-100">Close</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Section({ title, action, flush, children }: { title: string; action?: React.ReactNode; flush?: boolean; children: React.ReactNode }) {
  return (
    <div className="overflow-hidden rounded-xl border border-border bg-surface">
      <div className="flex items-center justify-between border-b border-border bg-stone-50/70 px-4 py-2.5">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted">{title}</p>
        {action}
      </div>
      <div className={flush ? "" : "p-4"}>{children}</div>
    </div>
  );
}
