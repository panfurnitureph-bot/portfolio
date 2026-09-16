import { useMemo } from "react";
import { usePersistedState } from "@/hooks/usePersistedState";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { Separator } from "@/components/ui/separator";
import ChannelDashboardTable from "@/components/dashboard/ChannelDashboardTable";
import { useItemAlerts } from "@/hooks/useItemAlerts";
import { useCrossChannelSales } from "@/hooks/useCrossChannelSales";
import { useIncomingShipment } from "@/hooks/useIncomingShipment";
import { usePagePermission } from "@/hooks/usePagePermission";
import { cn } from "@/lib/utils";
import { Table2 } from "lucide-react";

/** Sentinel tableName for the consolidated alert sheet (not a real table). */
const NEEDS_ATTENTION = "__needs_attention__";

/** Excel-style "sheets": each tab swaps the source table the shared dashboard
 *  reads. Remounting on switch (key={tableName}) resets filters/sort per sheet;
 *  react-query caches per table so re-visiting a tab is instant. */
const TABS = [
  { label: "Marketplace Sheet",        tableName: "amazon_dashboard",        salesLabel: "Amazon Sales",        salesKeyPrefix: "sale",    showProjection: true, showSupplyPlan: true, dot: "bg-amber-500",   activeText: "text-amber-700",   activeTop: "border-t-amber-500",   idleBg: "bg-amber-50 hover:bg-amber-100" },
  { label: "Storefront Sheet",       tableName: "website_dashboard",       salesLabel: "Website Sales",       salesKeyPrefix: "sale",    showProjection: true, showSupplyPlan: true, dot: "bg-sky-500",     activeText: "text-sky-700",     activeTop: "border-t-sky-500",     idleBg: "bg-sky-50 hover:bg-sky-100" },
  { label: "Long-tail Channels", tableName: "other_channel_dashboard", salesLabel: "Other Channel Sales", salesKeyPrefix: "sale",    showProjection: true, showSupplyPlan: true, dot: "bg-violet-500",  activeText: "text-violet-700",  activeTop: "border-t-violet-500",  idleBg: "bg-violet-50 hover:bg-violet-100" },
  // Monthly Projection tab hidden per request (component still supports it via forwardSales).
  { label: "⚠️ Flagged SKUs",      tableName: NEEDS_ATTENTION,                salesLabel: "",                   salesKeyPrefix: "sale",    dot: "bg-rose-500",    activeText: "text-rose-700",    activeTop: "border-t-rose-500",    idleBg: "bg-rose-50 hover:bg-rose-100" },
] as const;

export default function AllChannels({ fixedTab }: { fixedTab?: string } = {}) {
  // Persisted so the selected sheet survives remounts (auth refresh on
  // alt-tab) and navigation away/back.
  const [active, setActive] = usePersistedState("channels:activeTab", 0);

  // Tabs with their own permission key are hidden for users without view access
  // (admins always allowed — see usePagePermission).
  const { canView: canViewNeedsAttention } = usePagePermission("needs_attention");
  const { canView: canViewIncoming } = usePagePermission("incoming_shipment_dashboard");
  const visibleTabs = useMemo(
    () => TABS.filter((t) => {
      if (t.tableName === NEEDS_ATTENTION) return canViewNeedsAttention;
      if ("permKey" in t && t.permKey === "incoming_shipment_dashboard") return canViewIncoming;
      return true;
    }),
    [canViewNeedsAttention, canViewIncoming],
  );
  const fixedIndex = fixedTab ? visibleTabs.findIndex((t) => t.label === fixedTab) : -1;
  const safeActive = fixedIndex >= 0 ? fixedIndex : Math.min(active, visibleTabs.length - 1);
  const tab = visibleTabs[safeActive];

  // Pre-warm the queries the Flagged SKUs tab needs (alert status + the
  // Website/Other channel sales) on page mount, using the same cache keys the
  // channel tabs use. By the time the user clicks the tab, it's all cached.
  useItemAlerts(canViewNeedsAttention);
  useCrossChannelSales(canViewNeedsAttention);
  // Pre-warm the Inbound Shipment / Breakdown values (forecast_report) on mount
  // so the 📦 tab paints instantly from cache when clicked.
  useIncomingShipment(canViewIncoming);

  return (
    <div className="flex h-screen w-full flex-col bg-background overflow-hidden min-h-0" style={{ maxWidth: "none" }}>
      {/* ── Header ── */}
      <header className="flex h-14 shrink-0 items-center gap-2 border-b border-border bg-background px-4">
        <SidebarTrigger className="-ml-1" />
        <Separator orientation="vertical" className="mr-2 h-4" />
        <span className="text-sm font-semibold text-foreground">{fixedIndex >= 0 ? tab.label : "Channels"}</span>
        {fixedIndex < 0 && <span className="text-sm text-muted-foreground">/ {tab.label}</span>}
      </header>

      {/* ── Active sheet (toolbar + grid + pagination) ── */}
      {tab.tableName === NEEDS_ATTENTION ? (
        // Reuse the dashboard layout (images, product info) but show the three
        // channels' sales side by side + the Alert column, for flagged SKUs only.
        <ChannelDashboardTable key={NEEDS_ATTENTION} tableName="amazon_dashboard" salesLabel="Amazon Sales" showAllChannelSales showAlerts />
      ) : (
        <ChannelDashboardTable key={tab.label} tableName={tab.tableName} salesLabel={tab.salesLabel} salesKeyPrefix={tab.salesKeyPrefix} forwardSales={!!("forwardSales" in tab && tab.forwardSales)} showProjection={!!("showProjection" in tab && tab.showProjection)} showSupplyPlan={!!("showSupplyPlan" in tab && tab.showSupplyPlan)} hideSales={!!("hideSales" in tab && tab.hideSales)} showIncoming={!!("showIncoming" in tab && tab.showIncoming)} />
      )}

      {/* ── Excel-style sheet tabs (bottom) — hidden when the page is pinned to one sheet ── */}
      {fixedIndex < 0 && <div className="flex shrink-0 items-end gap-1.5 border-t-2 border-primary/40 bg-gradient-to-b from-muted to-muted/60 px-3 pt-2 pb-0">
        <span className="mb-2 flex items-center gap-1.5 pr-1 text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
          <Table2 className="h-4 w-4" />
          Sheets
        </span>
        {visibleTabs.map((t, i) => (
          <button
            key={t.label}
            onClick={() => setActive(i)}
            className={cn(
              "flex items-center gap-2 rounded-t-lg border px-4 text-xs font-semibold transition-all",
              i === safeActive
                ? cn("border-border border-b-background bg-background py-2.5 shadow-[0_-3px_6px_rgba(0,0,0,0.08)] -mb-px border-t-[3px]", t.activeTop, t.activeText)
                : cn("border-border/50 py-2 text-muted-foreground hover:text-foreground", t.idleBg),
            )}
          >
            <span className={cn("h-2 w-2 rounded-full", t.dot, i !== safeActive && "opacity-70")} />
            {t.label}
          </button>
        ))}
      </div>}
    </div>
  );
}
