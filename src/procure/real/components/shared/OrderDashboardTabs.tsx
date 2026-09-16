import { useNavigate } from "react-router-dom";
import { cn } from "@/lib/utils";
import { Table2 } from "lucide-react";

export type TabGroup = "finance" | "logistics" | "management";
export type DashboardTab = "invoice" | "shipping" | "po" | "dashboard";

const TABS = [
  { key: "invoice"   as const, label: "Freight Bills",    dot: "bg-orange-500", activeTop: "border-t-orange-500", activeText: "text-orange-700", idleBg: "bg-orange-50 hover:bg-orange-100"  },
  { key: "shipping"  as const, label: "Dispatch Requests",  dot: "bg-blue-500",   activeTop: "border-t-blue-500",   activeText: "text-blue-700",   idleBg: "bg-blue-50 hover:bg-blue-100"      },
  { key: "po"        as const, label: "Order Pipeline",         dot: "bg-green-500",  activeTop: "border-t-green-500",  activeText: "text-green-700",  idleBg: "bg-green-50 hover:bg-green-100"    },
  { key: "dashboard" as const, label: "📊 Dashboard",       dot: "bg-slate-700",  activeTop: "border-t-slate-700",  activeText: "text-slate-800",  idleBg: "bg-slate-100 hover:bg-slate-200"  },
];

const URLS: Record<TabGroup, Record<DashboardTab, string>> = {
  finance:    { invoice: "/invoice-tracker",  shipping: "/shipping-requests",         po: "/po-tracker",          dashboard: "/booking-dashboard"            },
  logistics:  { invoice: "/order-logistics",  shipping: "/order-logistics-shipping",  po: "/order-logistics-po",  dashboard: "/order-logistics-dashboard"    },
  management: { invoice: "/order-management", shipping: "/order-management-shipping", po: "/order-management-po", dashboard: "/order-management-dashboard"   },
};

export function OrderDashboardTabs({ group, activeTab }: { group: TabGroup; activeTab: DashboardTab }) {
  const navigate = useNavigate();
  return (
    <div className="flex shrink-0 items-end gap-1.5 border-t-2 border-primary/40 bg-gradient-to-b from-muted to-muted/60 px-3 pt-2 pb-0">
      <span className="mb-2 flex items-center gap-1.5 pr-1 text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
        <Table2 className="h-4 w-4" />
        Sheets
      </span>
      {TABS.map((t) => {
        const isActive = t.key === activeTab;
        return (
          <button
            key={t.key}
            onClick={() => navigate(URLS[group][t.key])}
            className={cn(
              "flex items-center gap-2 rounded-t-lg border px-4 text-xs font-semibold transition-all",
              isActive
                ? cn("border-border border-b-background bg-background py-2.5 shadow-[0_-3px_6px_rgba(0,0,0,0.08)] -mb-px border-t-[3px]", t.activeTop, t.activeText)
                : cn("border-border/50 py-2 text-muted-foreground hover:text-foreground", t.idleBg),
            )}
          >
            <span className={cn("h-2 w-2 rounded-full", t.dot, !isActive && "opacity-70")} />
            {t.label}
          </button>
        );
      })}
    </div>
  );
}
