"use client";

// PAN OVERALL — pinagsama-samang admin view sa isang tabbed na pahina:
//   PAN Overall (cash-flow ledger) · Dashboard (sales command center) · Customer List
// Admin lang ang nakakakita (naka-guard sa server page).

import { useState } from "react";
import { cn } from "@/components/ui";
import { PanOverallManager } from "@/components/pan-overall-manager";
import { SalesDashboard } from "@/components/sales-dashboard";
import { CustomersManager } from "@/components/customers-manager";
import type { PanAccount, PanCategory, PanTxnRow } from "@/lib/pan/types";
import type { OrderRow, ProductRow } from "@/lib/supabase/server";
import type { SalesOrder, SalesTargets } from "@/app/dashboard/sales-types";
import type { CustomerData } from "@/app/customers/data";

type Tab = "overall" | "dashboard" | "customers";

const TABS: { key: Tab; label: string; dot: string; text: string }[] = [
  { key: "overall", label: "PAN Overall", dot: "bg-emerald-500", text: "text-emerald-700" },
  { key: "dashboard", label: "Dashboard", dot: "bg-amber-500", text: "text-amber-600" },
  { key: "customers", label: "Customer List", dot: "bg-violet-500", text: "text-violet-700" },
];

export function PanOverallTabs({
  overall, dashboard, customers,
}: {
  overall: { accounts: PanAccount[]; categories: PanCategory[]; transactions: PanTxnRow[]; orders: OrderRow[]; products: ProductRow[] };
  dashboard: { orders: SalesOrder[]; targets: SalesTargets; canEditTargets: boolean };
  customers: { data: CustomerData };
}) {
  const [tab, setTab] = useState<Tab>("overall");

  return (
    <div className="space-y-5">
      {/* Aktibong tab — content muna */}
      {tab === "overall" && (
        <PanOverallManager accounts={overall.accounts} categories={overall.categories} transactions={overall.transactions} orders={overall.orders} products={overall.products} />
      )}
      {tab === "dashboard" && (
        <SalesDashboard orders={dashboard.orders} targets={dashboard.targets} canEditTargets={dashboard.canEditTargets} />
      )}
      {tab === "customers" && (
        <CustomersManager data={customers.data} />
      )}

      {/* Tab strip — sa ILALIM ng content (footer). Naka-pin sa baba ng screen
          para laging kita kahit mag-scroll. */}
      <div className="sticky bottom-0 z-30 -mx-4 mt-6 flex flex-wrap items-center justify-center gap-1 border-t border-border bg-background/95 px-4 py-2 backdrop-blur supports-[backdrop-filter]:bg-background/80 sm:-mx-6">
        {TABS.map((t) => {
          const on = tab === t.key;
          return (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={cn(
                "flex items-center gap-2 rounded-full px-4 py-2 text-sm font-medium transition-colors",
                on ? cn("bg-surface shadow-sm ring-1 ring-border", t.text) : "text-muted hover:text-foreground",
              )}
            >
              <span className={cn("h-2 w-2 rounded-full", t.dot)} />
              {t.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
