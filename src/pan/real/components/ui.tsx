import type { ReactNode } from "react";

// Minimal class joiner (no external deps).
export function cn(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

// A rework-sourced work item carries a label that starts with "Rework" —
// workshop jobs: "Rework · RMA-… · item"; redeliveries: "Rework redelivery · …" or
// "Rework (on-site) · …" (see approveReturn / markReworked). Detect it so Workshop /
// Delivery / Installation can flag it as a repair, not a fresh order.
export function isReworkItem(text: string | null | undefined): boolean {
  return /^\s*rework\b/i.test(text ?? "");
}
// Small amber "Rework" pill for those surfaces.
export function ReworkTag({ className }: { className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold text-amber-700", className)}>
      Rework
    </span>
  );
}

// A rework pull-out pickup task (collect the defective item from the customer) is a
// delivery whose items_summary starts with "Pickup for Rework".
export function isPickupTask(text: string | null | undefined): boolean {
  return /pickup for rework/i.test(text ?? "");
}
export function PickupTag({ className }: { className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-full bg-sky-100 px-1.5 py-0.5 text-[10px] font-bold text-sky-700", className)}>
      Pickup
    </span>
  );
}

// STOCK BUILD — ipinagawa nang walang order, para lang magkastock. Walang order
// number ang mga ito, kaya "—" lang ang lumalabas kung saan man sila nakalista.
// Isang tanda sa lahat ng dako, para hindi maisip na kulang ang datos.
export function StockTag({ sku, className }: { sku?: string | null; className?: string }) {
  return (
    <span className={cn("inline-flex flex-col items-center gap-0.5", className)}>
      <span className="rounded-full bg-[#4a3b1a] px-2 py-0.5 text-[9px] font-extrabold tracking-wide text-[#f4ead8]">STOCK</span>
      {sku && <span className="font-mono text-[10px] font-semibold text-muted">{sku}</span>}
    </span>
  );
}

// ANG HANAY NG RMA #. Ang blangkong "—" ay hindi malinaw: hindi masasabi kung
// walang rework o kung nawawala lang ang numero. Ang tanda ang nagsasabi — at
// kapag may rework, ang numero mismo ang lumalabas.
// `leg` — aling biyahe ito ng rework (2026-08-28). Ang pull-out ay dalawa: ang
// pagkuha ng sirang gamit, at ang pagbalik ng naayos. Magkaiba ang gagawin ng
// driver sa dalawa, at pareho silang stop sa ruta ng team — kaya kailangang
// masabi ng tag kung alin, hindi lang na may rework. Opsyonal: kung hindi
// ipinasa, ang RMA number lang ang lumalabas gaya ng dati.
export function ReworkCell({ isRework, rmaNo, leg }: {
  isRework?: boolean | null; rmaNo?: string | null;
  leg?: "pickup" | "redeliver" | "onsite" | null;
}) {
  if (isRework) {
    const tag = leg === "pickup" ? "PULL OUT" : leg === "redeliver" ? "REDELIVER" : leg === "onsite" ? "ON-SITE" : null;
    return (
      <span className="inline-flex flex-col items-center gap-0.5 leading-tight">
        <span className="font-mono text-xs font-bold text-amber-700">{rmaNo ?? "Rework"}</span>
        {tag && <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[9px] font-extrabold tracking-wide text-amber-800">{tag}</span>}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center rounded-full bg-stone-100 px-2 py-0.5 text-[10px] font-semibold text-muted">
      No rework
    </span>
  );
}

export function Card({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "rounded-xl border border-border bg-surface shadow-sm",
        className,
      )}
    >
      {children}
    </div>
  );
}

export function StatCard({
  label,
  value,
  hint,
  tone = "default",
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: "default" | "success" | "warning" | "danger" | "info";
}) {
  const toneColor = {
    default: "text-foreground",
    success: "text-success",
    warning: "text-warning",
    danger: "text-danger",
    info: "text-info",
  }[tone];

  // Nakatago sa loob ng APK (native Android app) — desktop/web lang ito. Ang
  // paghahanap ng APK ay ginagawa ng ApkFlag (data-apk sa <html>) + CSS.
  return (
    <Card className="stat-card p-5">
      <p className="text-sm font-medium text-muted">{label}</p>
      <p className={cn("mt-2 text-3xl font-semibold tracking-tight", toneColor)}>
        {value}
      </p>
      {hint && <p className="mt-1 text-xs text-muted">{hint}</p>}
    </Card>
  );
}

const BADGE_TONES: Record<string, string> = {
  // statuses
  active: "bg-green-50 text-green-700 ring-green-600/20",
  inactive: "bg-stone-100 text-stone-600 ring-stone-500/20",
  draft: "bg-stone-100 text-stone-600 ring-stone-500/20",
  pending: "bg-amber-50 text-amber-700 ring-amber-600/20",
  pending_approval: "bg-amber-50 text-amber-700 ring-amber-600/20",
  processing: "bg-blue-50 text-blue-700 ring-blue-600/20",
  packed: "bg-indigo-50 text-indigo-700 ring-indigo-600/20",
  released: "bg-violet-50 text-violet-700 ring-violet-600/20",
  completed: "bg-green-50 text-green-700 ring-green-600/20",
  approved: "bg-green-50 text-green-700 ring-green-600/20",
  cancelled: "bg-red-50 text-red-700 ring-red-600/20",
  rejected: "bg-red-50 text-red-700 ring-red-600/20",
  returned: "bg-orange-50 text-orange-700 ring-orange-600/20",
  submitted: "bg-blue-50 text-blue-700 ring-blue-600/20",
};

export function Badge({ value }: { value: string }) {
  const tone = BADGE_TONES[value] ?? "bg-stone-100 text-stone-600 ring-stone-500/20";
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium capitalize ring-1 ring-inset",
        tone,
      )}
    >
      {value.replace(/_/g, " ")}
    </span>
  );
}

type Col = { label: string; align?: "left" | "right" | "center" };

// Lightweight table: pass column headers and pre-rendered row cells.
export function DataTable({
  columns,
  rows,
  empty = "No records.",
}: {
  columns: Col[];
  rows: ReactNode[][];
  empty?: string;
}) {
  const alignClass = (a?: string) =>
    a === "right" ? "text-right" : a === "center" ? "text-center" : "text-left";

  return (
    <Card className="overflow-x-auto pf-scroll">
      <table className="w-full min-w-[680px] text-sm">
        <thead>
          <tr className="border-b border-border text-xs uppercase text-muted">
            {columns.map((c, i) => (
              <th key={i} className={cn("px-5 py-3 font-medium", alignClass(c.align))}>
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((cells, r) => (
            <tr key={r} className="border-b border-border last:border-0 hover:bg-stone-50">
              {cells.map((cell, c) => (
                <td key={c} className={cn("px-5 py-3", alignClass(columns[c]?.align))}>
                  {cell}
                </td>
              ))}
            </tr>
          ))}
          {rows.length === 0 && (
            <tr>
              <td colSpan={columns.length} className="px-5 py-8 text-center text-muted">
                {empty}
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </Card>
  );
}

export function PageHeader({
  title,
  subtitle,
  action,
}: {
  title: string;
  subtitle?: string;
  action?: ReactNode;
}) {
  // Ang title at subtitle ay tinatanggap pa rin (para hindi masira ang mga
  // tumatawag) pero hindi na ipinapakita — tinanggal sa lahat ng page; ang
  // sidebar ang nagsasabi kung anong page. Ang action (mga buton) lang ang
  // nananatili, naka-align sa kanan.
  void title;
  void subtitle;
  if (!action) return null;
  return (
    <div className="mb-6 flex items-center justify-end gap-4">
      {action}
    </div>
  );
}

// Standardized label → value spec rows for detail/preview modals. Each field is
// its own row (label left at a fixed width, value right), divider-separated with
// a zebra stripe — easy to scan. Pass items as [label, value] pairs; falsy
// values render as an em dash. `labelWidth` tweaks the label column (default w-24).
// SPEC BULLETS (bagong format 2026-08-18) — bullet list ng Specifications /
// Design details. Tumatanggap ng multi-line na string (item description rest
// lines o product.specs); null render kapag blangko. Ginagamit sa LAHAT ng
// product-detail views para pare-pareho ang hitsura.
export function SpecBullets({ text, className }: { text?: string | null; className?: string }) {
  const lines = (text ?? "").split("\n").map((l) => l.trim()).filter(Boolean).map((l) => l.replace(/^[•·\-\s]+/, ""));
  if (!lines.length) return null;
  return (
    <div className={cn("mt-2", className)}>
      <div className="text-[10px] font-semibold uppercase tracking-wide text-muted">Specifications / Design details</div>
      <div className="mt-1 rounded-lg border border-border bg-stone-50 px-3 py-2 text-xs text-foreground/80">
        {lines.map((l, i) => <div key={i} className="py-0.5">• {l}</div>)}
      </div>
    </div>
  );
}

export function SpecRows({
  items,
  labelWidth = "w-24",
  className,
}: {
  items: Array<[string, ReactNode]>;
  labelWidth?: string;
  className?: string;
}) {
  return (
    <div className={cn("overflow-hidden rounded-xl border border-border", className)}>
      {items.map(([k, v], i) => (
        <div
          key={`${k}-${i}`}
          className="flex items-start gap-4 border-b border-border px-4 py-3 last:border-0 even:bg-stone-50/40"
        >
          <div className={cn("shrink-0 text-[11px] font-semibold uppercase tracking-wide text-muted", labelWidth)}>{k}</div>
          <div className="min-w-0 flex-1 break-words text-sm font-medium leading-snug text-foreground">{v || "—"}</div>
        </div>
      ))}
    </div>
  );
}
