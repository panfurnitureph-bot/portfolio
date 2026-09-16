"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import dynamic from "next/dynamic";
import { Card, cn } from "@/components/ui";
import { Thumbnail } from "@/components/thumbnail";
import { peso, number, shortDate } from "@/lib/format";
import type { SalesOrder, SalesTargets } from "@/app/dashboard/sales-types";
import { saveTargets } from "@/app/dashboard/targets-actions";

// ── Brand palette ──────────────────────────────────────────────────────
// Magkakaibang malinaw na kulay bawat slice (gaya ng Payment Status donut) —
// para madaling makilala ang bawat bahagi, hindi magkakalapit na shade.
const SLICE_COLORS = ["#6f6234", "#caa45a", "#2563eb", "#16a34a", "#d97706", "#7c3aed", "#0891b2", "#a8a29e"];
// Funnel stage colors — Draft → Completed.
const FUNNEL_COLORS = ["#a8a29e", "#caa45a", "#2563eb", "#d97706", "#16a34a"];

// Charts lazy-loaded so recharts stays out of the initial dashboard bundle.
const SalesTrendChart = dynamic(() => import("@/components/charts/sales-trend-chart"), { ssr: false, loading: () => <div className="h-full w-full animate-pulse rounded-lg bg-stone-100" /> });
const DonutChart = dynamic(() => import("@/components/charts/donut-chart"), { ssr: false, loading: () => <div className="h-full w-full animate-pulse rounded-full bg-stone-100" /> });
const C = { completed: "#16a34a", partial: "#2563eb", pending: "#d97706", other: "#a8a29e" };

const DAY = 86_400_000;
type PeriodKey = "today" | "7d" | "30d" | "qtr" | "ytd";
const PERIODS: { key: PeriodKey; label: string }[] = [
  { key: "today", label: "Today" }, { key: "7d", label: "7d" }, { key: "30d", label: "30d" },
  { key: "qtr", label: "QTR" }, { key: "ytd", label: "YTD" },
];

const pesoK = (n: number) => (Math.abs(n) >= 1000 ? `₱${(n / 1000).toFixed(n >= 100_000 ? 0 : 1)}k` : peso(n));
const dayMs = (iso: string | null) => { if (!iso) return NaN; const d = new Date(iso); return isNaN(d.getTime()) ? NaN : d.setHours(0, 0, 0, 0); };
const collectedOf = (o: SalesOrder) => o.downpayment + o.full_payment;
const outstandingOf = (o: SalesOrder) => Math.max(o.total - collectedOf(o), 0);
const cogsOf = (o: SalesOrder) => o.items.reduce((s, it) => s + it.qty * it.cost, 0);
const unitsOf = (o: SalesOrder) => o.items.reduce((s, it) => s + it.qty, 0);
const norm = (s: string | null) => (s ?? "").trim().toLowerCase();
const titleCase = (s: string) => s.replace(/\w\S*/g, (w) => w[0].toUpperCase() + w.slice(1).toLowerCase());
const initials2 = (name: string) => { const p = name.trim().split(/\s+/).filter(Boolean); return ((p[0]?.[0] ?? "") + (p[1]?.[0] ?? "")).toUpperCase() || name.slice(0, 1).toUpperCase() || "?"; };

function payBucket(status: string | null): keyof typeof C {
  const s = norm(status);
  if (/complete/.test(s)) return "completed";
  if (/partial/.test(s)) return "partial";
  if (/pending|draft/.test(s)) return "pending";
  return "other";
}

export function SalesDashboard({ orders, targets, canEditTargets }: { orders: SalesOrder[]; targets: SalesTargets; canEditTargets: boolean }) {
  const [period, setPeriod] = useState<PeriodKey>("30d");
  const [editTargets, setEditTargets] = useState(false);

  const firstSeen = useMemo(() => {
    const m = new Map<string, number>();
    for (const o of orders) { const c = norm(o.customer_name); const d = dayMs(o.date_order); if (!c || isNaN(d)) continue; m.set(c, Math.min(m.get(c) ?? Infinity, d)); }
    return m;
  }, [orders]);

  const A = useMemo(() => {
    const now = new Date(); const todayStart = new Date(now).setHours(0, 0, 0, 0);
    const days = period === "today" ? 1 : period === "7d" ? 7 : period === "30d" ? 30 : period === "qtr" ? 90
      : Math.max(1, Math.round((todayStart - new Date(now.getFullYear(), 0, 1).setHours(0, 0, 0, 0)) / DAY) + 1);
    const cutoff = todayStart - (days - 1) * DAY;
    const prevCutoff = cutoff - days * DAY;
    const inRange = (o: SalesOrder, lo: number, hi: number) => { const d = dayMs(o.date_order); return !isNaN(d) && d >= lo && d <= hi; };
    const cur = orders.filter((o) => inRange(o, cutoff, todayStart));
    const prev = orders.filter((o) => inRange(o, prevCutoff, cutoff - DAY));
    const sum = (a: SalesOrder[], f: (o: SalesOrder) => number) => a.reduce((s, o) => s + f(o), 0);

    const sales = sum(cur, (o) => o.total);
    const collected = sum(cur, collectedOf);
    const outstanding = sum(cur, outstandingOf);
    const units = sum(cur, unitsOf);
    const cogs = sum(cur, cogsOf);
    const grossProfit = sales - cogs;
    const margin = sales > 0 ? (grossProfit / sales) * 100 : 0;
    const aov = cur.length ? sales / cur.length : 0;

    const pSales = sum(prev, (o) => o.total);
    const pCollected = sum(prev, collectedOf);
    const pUnits = sum(prev, unitsOf);
    const pGross = pSales - sum(prev, cogsOf);
    const pMargin = pSales > 0 ? (pGross / pSales) * 100 : 0;
    const chg = (a: number, b: number) => (b > 0 ? ((a - b) / b) * 100 : a > 0 ? 100 : 0);

    const weekly = days > 31; const bucketMs = weekly ? 7 * DAY : DAY; const buckets = Math.ceil(days / (weekly ? 7 : 1));
    const series = Array.from({ length: buckets }, (_, i) => {
      const lo = cutoff + i * bucketMs; const hi = lo + bucketMs - DAY; const slice = cur.filter((o) => inRange(o, lo, hi));
      return {
        label: weekly ? shortDate(new Date(lo).toISOString()) : new Date(lo).toLocaleDateString("en-US", { month: "short", day: "numeric" }),
        sales: slice.reduce((s, o) => s + o.total, 0), collected: slice.reduce((s, o) => s + collectedOf(o), 0),
        orders: slice.length, units: slice.reduce((s, o) => s + unitsOf(o), 0),
      };
    });
    const periodTarget = targets.revenue * (days / 30);
    const bucketTarget = periodTarget / Math.max(buckets, 1);
    const ordersTarget = Math.max(1, Math.round(targets.orders * (days / 30)));
    const elapsed = Math.max(1, Math.min(days, Math.round((todayStart - cutoff) / DAY) + 1));
    const projected = (sales / elapsed) * days;

    const group = (a: SalesOrder[], keyOf: (o: SalesOrder) => string, valOf: (o: SalesOrder) => number) => {
      const m = new Map<string, { value: number; count: number }>();
      for (const o of a) { const k = keyOf(o); const e = m.get(k) ?? { value: 0, count: 0 }; e.value += valOf(o); e.count++; m.set(k, e); }
      return [...m.entries()].map(([name, v]) => ({ name, ...v })).sort((x, y) => y.value - x.value);
    };

    // Channel — dedup case-insensitively, display Title Case.
    const chMap = new Map<string, { display: string; value: number }>();
    for (const o of cur) { const raw = (o.source || "Unspecified").trim(); const k = raw.toLowerCase(); const e = chMap.get(k) ?? { display: titleCase(raw), value: 0 }; e.value += o.total; chMap.set(k, e); }
    const channels = [...chMap.values()].map((c) => ({ name: c.display, value: c.value })).sort((a, b) => b.value - a.value);

    const reps = group(cur, (o) => o.assigned || "Unassigned", (o) => o.total).slice(0, 6);
    const customers = group(cur, (o) => o.customer_name || "Walk-in", (o) => o.total).slice(0, 5);

    const catMap = new Map<string, number>();
    for (const o of cur) {
      if (o.items.length) for (const it of o.items) { const k = it.category || o.category || "Uncategorized"; catMap.set(k, (catMap.get(k) ?? 0) + it.qty * it.unitPrice); }
      else { const k = o.category || "Uncategorized"; catMap.set(k, (catMap.get(k) ?? 0) + o.total); }
    }
    const categories = [...catMap.entries()].map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value).slice(0, 6);

    const prodMap = new Map<string, { value: number; qty: number; image: string | null }>();
    for (const o of cur) for (const it of o.items) {
      if (!it.description) continue;
      const e = prodMap.get(it.description) ?? { value: 0, qty: 0, image: null };
      e.value += it.qty * it.unitPrice; e.qty += it.qty; if (!e.image && it.image) e.image = it.image; prodMap.set(it.description, e);
    }
    const topProducts = [...prodMap.entries()].map(([name, v]) => ({ name, ...v })).sort((a, b) => b.value - a.value).slice(0, 6);

    const pipeline = group(cur, (o) => o.status || "—", (o) => o.total);

    const payAgg = { completed: { value: 0, count: 0 }, partial: { value: 0, count: 0 }, pending: { value: 0, count: 0 }, other: { value: 0, count: 0 } };
    for (const o of cur) { const b = payBucket(o.status); payAgg[b].value += o.total; payAgg[b].count++; }
    const donut = (["completed", "partial", "pending", "other"] as const)
      .map((k) => ({ key: k, name: k[0].toUpperCase() + k.slice(1), value: payAgg[k].value, count: payAgg[k].count, color: C[k] }))
      .filter((d) => d.count > 0);

    // Conversion funnel.
    const funnel = ["draft", "confirmed", "processing|workshop", "delivery", "complete"].map((re, i) => {
      const slice = cur.filter((o) => new RegExp(re, "i").test(o.status ?? ""));
      return {
        label: ["Draft", "Confirmed", "Processing", "For Delivery", "Completed"][i],
        count: slice.length,
        value: slice.reduce((s, o) => s + o.total, 0),
      };
    });
    const done = funnel[4].count; const winRate = cur.length ? Math.round((done / cur.length) * 100) : 0;

    let newCust = 0, repeatOrders = 0; const seen = new Set<string>();
    for (const o of cur) {
      const c = norm(o.customer_name); if (!c) continue;
      const first = firstSeen.get(c) ?? Infinity; const d = dayMs(o.date_order);
      if (!isNaN(d) && first >= cutoff) { if (!seen.has(c)) { newCust++; seen.add(c); } } else repeatOrders++;
    }
    const repeatPct = cur.length ? Math.round((repeatOrders / cur.length) * 100) : 0;

    // To Collect — orders with an outstanding balance, biggest first.
    const toCollect = cur.filter((o) => outstandingOf(o) > 0)
      .map((o) => ({ id: o.id, order: o.order_number, customer: o.customer_name || "Walk-in", balance: outstandingOf(o), status: o.status }))
      .sort((a, b) => b.balance - a.balance);

    const recent = cur.slice(0, 6);

    return {
      days, sales, collected, outstanding, units, aov, orders: cur.length, grossProfit, margin,
      chgSales: chg(sales, pSales), chgCollected: chg(collected, pCollected), chgUnits: chg(units, pUnits),
      chgOrders: chg(cur.length, prev.length), chgAov: chg(aov, prev.length ? pSales / prev.length : 0),
      chgGross: chg(grossProfit, pGross), chgMargin: margin - pMargin,
      collectionRate: sales > 0 ? Math.round((collected / sales) * 100) : 0,
      series, periodTarget, bucketTarget, ordersTarget, projected,
      channels, reps, customers, categories, topProducts, pipeline, donut, funnel, winRate,
      newCust, repeatPct, toCollect, recent,
      spark: { sales: series.map((s) => s.sales), collected: series.map((s) => s.collected), orders: series.map((s) => s.orders), units: series.map((s) => s.units), gross: series.map((s) => s.sales) },
    };
  }, [orders, period, firstSeen, targets]);

  function exportCsv() {
    const head = ["Order #", "Date", "Customer", "Source", "Status", "Assigned", "Total", "Collected", "Outstanding"];
    const lines = orders.map((o) => [o.order_number ?? "", o.date_order ?? "", o.customer_name ?? "", o.source ?? "", o.status ?? "", o.assigned ?? "", o.total, collectedOf(o), outstandingOf(o)].map((c) => `"${String(c).replace(/"/g, '""')}"`).join(","));
    const blob = new Blob([[head.join(","), ...lines].join("\n")], { type: "text/csv" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = "sales.csv"; a.click(); URL.revokeObjectURL(a.href);
  }

  const revPct = Math.min(100, Math.round((A.sales / Math.max(A.periodTarget, 1)) * 100));
  const ordPct = Math.min(100, Math.round((A.orders / Math.max(A.ordersTarget, 1)) * 100));
  const colPct = Math.min(100, Math.round((A.collectionRate / Math.max(targets.collection, 1)) * 100));
  const aovPct = Math.min(100, Math.round((A.aov / Math.max(targets.aov, 1)) * 100));

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex rounded-lg border border-border bg-surface p-0.5 shadow-sm">
            {PERIODS.map((p) => (
              <button key={p.key} onClick={() => setPeriod(p.key)}
                className={cn("rounded-md px-3 py-1.5 text-xs font-bold transition-all", period === p.key ? "bg-[#4a3b1a] text-[#f4ead8] shadow-sm" : "text-muted hover:text-foreground")}>
                {p.label}
              </button>
            ))}
          </div>
          <button onClick={exportCsv} className="flex items-center gap-1.5 rounded-lg bg-[#4a3b1a] px-3 py-2 text-sm font-bold text-[#f4ead8] shadow-sm transition-colors hover:bg-[#3a2e14]">
            <Icon name="download" /> Export
          </button>
        </div>
      </div>

      {/* Sales Pulse */}
      <SectionLabel>Overview</SectionLabel>
      <div className="apk-hide grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 md:grid-cols-4 xl:grid-cols-8">
        <Kpi label="Total Sales" value={pesoK(A.sales)} change={A.chgSales} spark={A.spark.sales} icon="peso" hero />
        <Kpi label="Gross Profit" value={pesoK(A.grossProfit)} change={A.chgGross} spark={A.spark.gross} icon="trend" />
        <Kpi label="Margin" value={`${A.margin.toFixed(0)}%`} change={A.chgMargin} icon="percent" />
        <Kpi label="Collected" value={pesoK(A.collected)} hint={`${A.collectionRate}% of sales`} icon="wallet" />
        <Kpi label="Outstanding" value={pesoK(A.outstanding)} hint={A.outstanding > 0 ? "to collect" : "all settled"} warn={A.outstanding > 0} icon="clock" />
        <Kpi label="Orders" value={number(A.orders)} change={A.chgOrders} spark={A.spark.orders} icon="receipt" />
        <Kpi label="AOV" value={pesoK(A.orders ? A.aov : 0)} change={A.chgAov} icon="tag" />
        <Kpi label="Units Sold" value={number(A.units)} change={A.chgUnits} spark={A.spark.units} icon="box" />
      </div>

      {/* Trend + payment */}
      <div className="grid grid-cols-1 gap-4 sm:gap-5 lg:grid-cols-3">
        <Card className="overflow-hidden rounded-2xl p-0 transition-shadow duration-200 hover:shadow-md lg:col-span-2">
          <CardHead icon="chart" title="Sales Trend vs Target" hint={`Revenue per ${A.days > 31 ? "week" : "day"} vs pace`}>
            <span className="hidden text-xs text-[#c9b896] sm:inline">Projected <span className="font-bold text-[#f4ead8]">{pesoK(A.projected)}</span> · target {pesoK(A.periodTarget)}</span>
          </CardHead>
          <div className="p-4 sm:p-5">
            <div className="h-52 w-full sm:h-64">
              <SalesTrendChart data={A.series} bucketTarget={A.bucketTarget} />
            </div>
          </div>
        </Card>

        <Card className="overflow-hidden rounded-2xl p-0 transition-shadow duration-200 hover:shadow-md">
          <CardHead icon="pie" title="Payment Status" hint="Collection health" />
          {A.donut.length ? (
            <div className="p-5 pt-3">
              <div className="mt-2 h-40 w-full">
                <DonutChart data={A.donut} />
              </div>
              <ul className="mt-2 space-y-1.5 text-sm">
                {A.donut.map((d) => (
                  <li key={d.key} className="flex items-center justify-between">
                    <span className="flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-full" style={{ background: d.color }} />{d.name}</span>
                    <span className="tabular-nums text-muted">{d.count} · <span className="font-semibold text-[#3a2e14]">{pesoK(d.value)}</span></span>
                  </li>
                ))}
              </ul>
              <p className="mt-3 border-t border-border pt-3 text-xs text-muted">Collection rate: <span className="font-extrabold text-[#3a2e14]">{A.collectionRate}%</span></p>
            </div>
          ) : <Empty icon="pie" msg="No orders in range." />}
        </Card>
      </div>

      {/* Channel / Category / Pipeline */}
      <SectionLabel>Breakdown</SectionLabel>
      <div className="grid grid-cols-1 items-stretch gap-4 sm:grid-cols-2 sm:gap-5 lg:grid-cols-3">
        <DonutBreakdown
          title="Sales by Channel" icon="share" hint="Where revenue comes from" rows={A.channels}
          centerLabel="total" centerValue={pesoK(A.channels.reduce((s, c) => s + c.value, 0))}
        />
        <DonutBreakdown
          title="Sales by Category" icon="layers" hint="Product mix" rows={A.categories}
          centerLabel="total" centerValue={pesoK(A.categories.reduce((s, c) => s + c.value, 0))}
        />
        <Card className="flex flex-col overflow-hidden rounded-2xl p-0 transition-shadow duration-200 hover:shadow-md">
          <CardHead icon="funnel" title="Conversion Funnel" hint={`${number(A.orders)} orders in pipeline`} />
          {A.orders ? (
            <>
              <div className="my-auto space-y-2.5 p-5">
                {A.funnel.map((f, i) => {
                  const max = Math.max(...A.funnel.map((x) => x.count), 1);
                  return (
                    <div key={f.label} className="grid grid-cols-[92px_1fr_auto] items-center gap-2.5 text-sm">
                      <span className="truncate text-xs font-semibold">{f.label}</span>
                      <span className="h-5 overflow-hidden rounded-md bg-stone-100">
                        <span
                          className="flex h-full min-w-[8px] items-center rounded-md px-1.5 text-[10px] font-extrabold text-white"
                          style={{ width: `${Math.max(6, Math.round((f.count / max) * 100))}%`, background: FUNNEL_COLORS[i] }}
                        >
                          {f.count > 0 ? f.count : ""}
                        </span>
                      </span>
                      <span className="tabular-nums text-xs font-semibold text-[#3a2e14]">{pesoK(f.value)}</span>
                    </div>
                  );
                })}
              </div>
              <p className="border-t border-border px-5 py-3 text-xs text-muted">Win rate: <span className="font-extrabold text-[#3a2e14]">{A.winRate}%</span></p>
            </>
          ) : <Empty icon="funnel" msg="No orders in range." />}
        </Card>
      </div>

      {/* Top products / customers / reps */}
      <SectionLabel>Customers &amp; Products</SectionLabel>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 sm:gap-5 lg:grid-cols-3">
        <Card className="overflow-hidden rounded-2xl p-0 transition-shadow duration-200 hover:shadow-md">
          <CardHead icon="box" title="Top Products" hint="By revenue" />
          {A.topProducts.length ? (
            <ul className="space-y-0.5 p-3.5">
              {A.topProducts.map((p, i) => (
                <li key={p.name} className="flex items-center gap-2.5 rounded-lg px-1.5 py-1 text-sm transition-colors hover:bg-[#faf6ec]/70">
                  <span className={cn("flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full text-[10px] font-extrabold", i === 0 ? "bg-[#caa45a] text-[#3a2e14]" : "bg-[#f0e2c4] text-[#4a3b1a]")}>{i + 1}</span>
                  <Thumbnail name={p.name} url={p.image} />
                  <span className="min-w-0 flex-1 truncate font-medium" title={p.name}>{p.name}</span>
                  <span className="shrink-0 font-extrabold tabular-nums text-[#3a2e14]">{pesoK(p.value)}</span>
                  <span className="w-8 shrink-0 text-right text-xs text-muted tabular-nums">{number(p.qty)}u</span>
                </li>
              ))}
            </ul>
          ) : <Empty icon="box" msg="No sales in range." />}
        </Card>
        <Card className="overflow-hidden rounded-2xl p-0 transition-shadow duration-200 hover:shadow-md">
          <CardHead icon="users" title="Top Customers" hint="By revenue">
            <span className="text-xs text-[#c9b896]"><span className="font-bold text-[#f4ead8]">{A.newCust}</span> · <span className="font-bold text-[#f4ead8]">{A.repeatPct}%</span></span>
          </CardHead>
          {A.customers.length ? (
            <ul className="space-y-0.5 p-3.5">
              {A.customers.map((c, i) => (
                <li key={c.name} className="flex items-center gap-2.5 rounded-lg px-1.5 py-1 text-sm transition-colors hover:bg-[#faf6ec]/70">
                  <span className={cn("flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full text-[10px] font-extrabold", i === 0 ? "bg-[#caa45a] text-[#3a2e14]" : "bg-[#f0e2c4] text-[#4a3b1a]")}>{i + 1}</span>
                  <span className="min-w-0 flex-1 truncate font-medium" title={c.name}>{c.name}</span>
                  <span className="shrink-0 font-extrabold tabular-nums text-[#3a2e14]">{pesoK(c.value)}</span>
                </li>
              ))}
            </ul>
          ) : <Empty icon="users" msg="No customers in range." />}
        </Card>
        <Card className="overflow-hidden rounded-2xl p-0 transition-shadow duration-200 hover:shadow-md">
          <CardHead icon="user" title="Sales Rep" hint="Revenue per rep" />
          {A.reps.length ? (
            <ul className="space-y-0.5 p-3.5">
              {A.reps.map((r) => (
                <li key={r.name} className="flex items-center gap-2.5 rounded-lg px-1.5 py-1 text-sm transition-colors hover:bg-[#faf6ec]/70">
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[#4a3b1a] text-[10px] font-extrabold text-[#f4ead8]">{initials2(r.name)}</span>
                  <span className="min-w-0 flex-1 truncate font-medium" title={r.name}>{r.name}</span>
                  <span className="shrink-0 font-extrabold tabular-nums text-[#3a2e14]">{pesoK(r.value)}</span>
                  <span className="w-6 shrink-0 text-right text-xs text-muted tabular-nums">{r.count}</span>
                </li>
              ))}
            </ul>
          ) : <Empty icon="user" msg="No data." />}
        </Card>
      </div>

      {/* Recent / To Collect */}
      <SectionLabel>Follow-up</SectionLabel>
      <div className="grid grid-cols-1 gap-4 sm:gap-5 lg:grid-cols-3">
        <Card className="overflow-hidden rounded-2xl p-0 transition-shadow duration-200 hover:shadow-md lg:col-span-2">
          <CardHead icon="list" title="Recent Orders" hint="Latest activity · click to open" />
          {A.recent.length ? (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[520px] border-separate border-spacing-0 text-sm">
                <thead>
                  <tr className="bg-[#5a4a26] text-[10px] font-extrabold uppercase tracking-[0.14em] text-[#e7dcc4] [&_th]:border-b [&_th]:border-[#6b5a2f] [&_th]:py-2.5">
                    <th className="px-3.5 text-left">Order</th>
                    <th className="px-3.5 text-left">Customer</th>
                    <th className="px-3.5 text-right">Amount</th>
                    <th className="px-3.5 text-center">Status</th>
                    <th className="px-3.5 text-left">Source</th>
                    <th className="px-3.5 text-right">Date</th>
                  </tr>
                </thead>
                <tbody>
                  {A.recent.map((o) => {
                    const b = payBucket(o.status);
                    return (
                      <tr
                        key={o.id}
                        onClick={() => { window.location.href = `/orders?q=${encodeURIComponent(o.order_number ?? "")}`; }}
                        className="group cursor-pointer transition-colors hover:bg-[#faf6ec] [&_td]:border-b [&_td]:border-border/60 [&_td]:px-3.5 [&_td]:py-3"
                        title="Open in Sales Orders"
                      >
                        <td>
                          <span className="inline-flex items-center gap-2">
                            <span className="h-6 w-[3px] shrink-0 rounded-full bg-[#caa45a] opacity-60" />
                            <span className="font-mono text-xs font-semibold">{o.order_number ?? "—"}</span>
                          </span>
                        </td>
                        <td><span className="block max-w-[180px] truncate font-medium">{o.customer_name ?? "—"}</span></td>
                        <td className="text-right font-extrabold tabular-nums text-[#3a2e14]">{pesoK(o.total)}</td>
                        <td className="text-center">
                          <span className="inline-flex items-center gap-1.5 rounded-full py-0.5 pl-2 pr-2.5 text-xs font-semibold capitalize" style={{ background: `${C[b]}1a`, color: C[b] }}>
                            <span className="h-1.5 w-1.5 rounded-full" style={{ background: C[b] }} />{o.status ?? "—"}
                          </span>
                        </td>
                        <td className="text-xs text-muted">{o.source ?? "—"}</td>
                        <td className="text-right text-xs text-muted">{o.date_order ? shortDate(o.date_order) : "—"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : <Empty icon="list" msg="No orders in range." />}
        </Card>
        <Card className="flex flex-col overflow-hidden rounded-2xl p-0 transition-shadow duration-200 hover:shadow-md">
          <CardHead icon="coin" title="To Collect" hint="Outstanding balances" />
          {A.toCollect.length ? (
            <>
              <ul className="space-y-2 p-4">
                {A.toCollect.slice(0, 6).map((t) => (
                  <li
                    key={t.id}
                    onClick={() => { window.location.href = `/orders?q=${encodeURIComponent(t.order ?? "")}`; }}
                    className="flex cursor-pointer items-center gap-2.5 rounded-lg bg-stone-50 px-3 py-2 text-sm transition-colors hover:bg-amber-50"
                    title="Open in Sales Orders"
                  >
                    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[#4a3b1a] text-[10px] font-extrabold text-[#f4ead8]">{initials2(t.customer)}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-semibold" title={t.customer}>{t.customer}</span>
                      <span className="block font-mono text-[10px] text-muted">{t.order ?? "—"} · {t.status ?? "—"}</span>
                    </span>
                    <span className="shrink-0 font-extrabold tabular-nums text-amber-700">{peso(t.balance)}</span>
                  </li>
                ))}
              </ul>
              <p className="mt-auto border-t border-border px-5 py-3 text-xs text-muted">Total to collect: <span className="font-extrabold text-amber-700">{peso(A.outstanding)}</span> · {A.toCollect.length} orders</p>
            </>
          ) : <Empty icon="check" msg="All settled — nothing to collect. ✓" tone="success" />}
        </Card>
      </div>

      {/* Targets */}
      <Card className="overflow-hidden rounded-2xl p-0 transition-shadow duration-200 hover:shadow-md">
        <CardHead icon="target" title="Monthly Targets" hint="Scaled to period">
          {canEditTargets && (
            <button onClick={() => setEditTargets(true)} className="flex items-center gap-1.5 rounded-lg border border-[#caa45a] bg-[#faf6ec] px-2.5 py-1.5 text-xs font-bold text-[#4a3b1a] shadow-sm transition-colors hover:bg-[#f4ead8]">
              <Icon name="edit" size={13} /> Edit
            </button>
          )}
        </CardHead>
        <div className="grid grid-cols-1 gap-4 p-5 sm:grid-cols-2 sm:gap-5 lg:grid-cols-4">
          <Goal label="Revenue" pct={revPct} detail={`${pesoK(A.sales)} / ${pesoK(A.periodTarget)}`} />
          <Goal label="Orders" pct={ordPct} detail={`${A.orders} / ${A.ordersTarget}`} />
          <Goal label="Collection" pct={colPct} detail={`${A.collectionRate}% / ${targets.collection}%`} />
          <Goal label="AOV" pct={aovPct} detail={`${pesoK(A.aov)} / ${pesoK(targets.aov)}`} />
        </div>
      </Card>

      {editTargets && <TargetsModal targets={targets} onClose={() => setEditTargets(false)} />}
    </div>
  );
}

// ── Targets edit modal ──────────────────────────────────────────────────
function TargetsModal({ targets, onClose }: { targets: SalesTargets; onClose: () => void }) {
  const router = useRouter();
  const [f, setF] = useState({ revenue: String(targets.revenue), orders: String(targets.orders), collection: String(targets.collection), aov: String(targets.aov) });
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const inp = "w-full rounded-lg border border-border bg-stone-50 px-3 py-2 text-sm outline-none focus:border-primary focus:bg-surface";

  function save() {
    setError(null);
    start(async () => {
      const res = await saveTargets({ revenue: Number(f.revenue), orders: Number(f.orders), collection: Number(f.collection), aov: Number(f.aov) });
      if ("error" in res) setError(res.error); else { onClose(); router.refresh(); }
    });
  }
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm" onClick={onClose}>
      <div className="w-full max-w-sm overflow-hidden rounded-2xl bg-surface shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-3 bg-[#4a3b1a] bg-gradient-to-br from-[#52421d] to-[#3a2e14] px-6 py-4 text-accent">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-white/15"><Icon name="target" size={18} /></span>
          <div>
            <h3 className="text-base font-semibold text-white">Set Monthly Targets</h3>
            <p className="text-xs text-accent/70">Per 30 days · auto-scales to period</p>
          </div>
        </div>
        <div className="space-y-3 p-6">
          <Field label="Revenue target (₱)"><input value={f.revenue} onChange={(e) => setF((p) => ({ ...p, revenue: e.target.value }))} type="number" className={inp} /></Field>
          <Field label="Orders target"><input value={f.orders} onChange={(e) => setF((p) => ({ ...p, orders: e.target.value }))} type="number" className={inp} /></Field>
          <Field label="Collection rate (%)"><input value={f.collection} onChange={(e) => setF((p) => ({ ...p, collection: e.target.value }))} type="number" className={inp} /></Field>
          <Field label="AOV target (₱)"><input value={f.aov} onChange={(e) => setF((p) => ({ ...p, aov: e.target.value }))} type="number" className={inp} /></Field>
          {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
        </div>
        <div className="flex justify-end gap-2 px-6 pb-6">
          <button onClick={onClose} className="rounded-lg px-4 py-2 text-sm font-medium ring-1 ring-inset ring-border hover:bg-stone-100">Cancel</button>
          <button onClick={save} disabled={pending} className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-accent hover:bg-primary/90 disabled:opacity-60">{pending ? "Saving…" : "Save"}</button>
        </div>
      </div>
    </div>
  );
}
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div><label className="mb-1 block text-sm font-medium">{label}</label>{children}</div>;
}

// ── Sub-components ──────────────────────────────────────────────────────
function Kpi({ label, value, change, hint, spark, hero, warn, icon }: {
  label: string; value: string; change?: number; hint?: string; spark?: number[]; hero?: boolean; warn?: boolean; icon: IconName;
}) {
  const up = (change ?? 0) >= 0;
  if (hero) {
    // Solid espresso base FIRST (bg-[#4a3b1a]) so the card is never white if the gradient
    // doesn't paint — some old Android WebViews drop bg-gradient utilities, which would
    // leave the white/gold text invisible on a white card.
    return (
      <div className="relative overflow-hidden rounded-2xl bg-[#4a3b1a] bg-gradient-to-br from-[#52421d] to-[#3a2e14] p-4 text-accent shadow-md">
        <div className="flex items-center justify-between">
          <p className="text-[10px] font-extrabold uppercase tracking-[0.16em] text-[#caa45a]">{label}</p>
          <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-white/15 text-[#caa45a]"><Icon name={icon} size={13} /></span>
        </div>
        <p className="mt-1.5 text-xl font-extrabold tracking-tight text-white sm:text-2xl">{value}</p>
        <div className="mt-1.5 flex items-center justify-between gap-2">
          {change !== undefined && (
            <span className="inline-flex items-center gap-0.5 rounded-full bg-white/15 px-1.5 py-0.5 text-[11px] font-bold text-white">{up ? "▲" : "▼"} {Math.abs(change).toFixed(1)}%</span>
          )}
          {spark && spark.length > 1 && <Sparkline data={spark} color="#caa45a" />}
        </div>
      </div>
    );
  }
  return (
    <Card className={cn(
      "relative overflow-hidden rounded-2xl border-t-2 p-4 transition-all hover:-translate-y-0.5 hover:shadow-md",
      // Gintong guhit sa taas — brand accent; amber kung may babala (outstanding).
      warn ? "border-t-amber-400" : "border-t-[#caa45a]",
    )}>
      <div className="flex items-center justify-between">
        <p className="text-[10px] font-extrabold uppercase tracking-[0.16em] text-[#a8842e] sm:text-[10.5px]">{label}</p>
        <span className="flex h-7 w-7 items-center justify-center rounded-xl bg-gradient-to-br from-[#caa45a]/25 to-[#caa45a]/5 text-[#a8842e] ring-1 ring-inset ring-[#caa45a]/20"><Icon name={icon} size={14} /></span>
      </div>
      <p className="mt-1.5 text-xl font-extrabold tracking-tight tabular-nums text-[#3a2e14] sm:text-2xl">{value}</p>
      <div className="mt-1.5 flex items-center justify-between gap-2">
        {change !== undefined ? (
          <span className={cn("inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[11px] font-bold", up ? "bg-green-50 text-success" : "bg-red-50 text-danger")}>{up ? "▲" : "▼"} {Math.abs(change).toFixed(1)}%</span>
        ) : hint ? <span className={cn("text-xs", warn ? "text-amber-600" : "text-muted")}>{hint}</span> : <span />}
        {spark && spark.length > 1 && <Sparkline data={spark} color={up ? "#16a34a" : "#dc2626"} />}
      </div>
    </Card>
  );
}

function Sparkline({ data, color }: { data: number[]; color: string }) {
  const w = 52, h = 18; const max = Math.max(...data, 1); const min = Math.min(...data, 0); const span = max - min || 1;
  const pts = data.map((v, i) => `${(i / (data.length - 1)) * w},${h - ((v - min) / span) * h}`).join(" ");
  return <svg width={w} height={h} className="shrink-0" preserveAspectRatio="none"><polyline points={pts} fill="none" stroke={color} strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" /></svg>;
}

// Donut na naka-gitna + legend sa baba, magkakaibang kulay bawat slice (gaya
// ng Payment Status). Ang laman ay naka-center vertically para pantay-pantay
// ang taas ng mga breakdown card.
function DonutBreakdown({
  title, icon, hint, rows, centerLabel, centerValue, footer, withPct = true,
}: {
  title: string; icon: IconName; hint?: string;
  rows: { name: string; value: number }[];
  centerLabel: string; centerValue: string;
  footer?: React.ReactNode; withPct?: boolean;
}) {
  const total = rows.reduce((s, r) => s + r.value, 0);
  const slices = rows.map((r, i) => ({ key: r.name + i, name: r.name, value: r.value, color: SLICE_COLORS[i % SLICE_COLORS.length] }));
  return (
    <Card className="flex flex-col overflow-hidden rounded-2xl p-0 transition-shadow duration-200 hover:shadow-md">
      <CardHead icon={icon} title={title} hint={hint} />
      {rows.length ? (
        <div className="flex flex-1 flex-col p-5">
          {/* Donut — naka-gitna, may total sa loob */}
          <div className="relative mx-auto mt-auto h-40 w-40">
            <DonutChart data={slices} />
            <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
              <span className="text-lg font-extrabold tracking-tight text-[#3a2e14]">{centerValue}</span>
              <span className="text-[10px] uppercase tracking-widest text-muted">{centerLabel}</span>
            </div>
          </div>
          {/* Legend sa baba */}
          <ul className="mb-auto mt-4 space-y-2 text-sm">
            {slices.map((s) => (
              <li key={s.key} className="flex items-center justify-between gap-2">
                <span className="flex min-w-0 items-center gap-2"><span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: s.color }} /><span className="truncate" title={s.name}>{s.name}</span></span>
                <span className="shrink-0 tabular-nums text-muted"><span className="font-extrabold text-[#3a2e14]">{pesoK(s.value)}</span>{withPct && total > 0 && ` · ${Math.round((s.value / total) * 100)}%`}</span>
              </li>
            ))}
          </ul>
          {footer && <div className="mt-3 border-t border-border pt-3 text-xs text-muted">{footer}</div>}
        </div>
      ) : <Empty icon={icon} msg="No data in range." />}
    </Card>
  );
}

// Brand header band — kapareho ng HR Reports at ibang IMS tables (espresso gradient + gold).
function CardHead({ icon, title, hint, children }: { icon: IconName; title: string; hint?: string; children?: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-2.5 border-b border-[#caa45a] bg-gradient-to-r from-[#52421d] to-[#4a3b1a] px-4 py-3 sm:px-5">
      <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#caa45a] text-[#3a2e14]">
        <Icon name={icon} size={15} />
      </span>
      <div className="min-w-0">
        <h2 className="text-sm font-extrabold tracking-wide text-[#f4ead8]">{title}</h2>
        {hint && <p className="truncate text-[11px] text-[#c9b896]">{hint}</p>}
      </div>
      <div className="ml-auto flex items-center gap-2.5">{children}</div>
    </div>
  );
}


function Goal({ label, pct, detail }: { label: string; pct: number; detail: string }) {
  const color = pct >= 80 ? "#16a34a" : pct >= 50 ? "#a8842e" : "#d97706";
  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between text-sm">
        <span className="font-medium">{label}</span>
        <span className="inline-flex items-center gap-1 font-semibold" style={{ color }}>{pct >= 100 && <Icon name="check" size={13} />}{pct}%</span>
      </div>
      <div className="h-3 overflow-hidden rounded-full bg-stone-100"><div className="h-full rounded-full transition-all duration-500" style={{ width: `${Math.min(100, pct)}%`, background: `linear-gradient(90deg, ${color}cc, ${color})` }} /></div>
      <p className="mt-1.5 text-xs text-muted">{detail}</p>
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3 pt-1">
      <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted">{children}</span>
      <span className="h-px flex-1 bg-gradient-to-r from-border to-transparent" />
    </div>
  );
}

function Empty({ icon, msg, tone }: { icon: IconName; msg: string; tone?: "success" }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-8 text-center">
      <span className={cn("flex h-12 w-12 items-center justify-center rounded-2xl", tone === "success" ? "bg-green-100 text-green-600" : "bg-stone-100 text-stone-400")}><Icon name={icon} size={22} /></span>
      <p className={cn("text-sm", tone === "success" ? "text-success" : "text-muted")}>{msg}</p>
    </div>
  );
}

// ── Icons (line-art) ─────────────────────────────────────────────────────
type IconName = "peso" | "trend" | "percent" | "wallet" | "clock" | "receipt" | "tag" | "box"
  | "chart" | "pie" | "share" | "layers" | "funnel" | "users" | "user" | "list" | "coin" | "check" | "target" | "edit" | "download";

function Icon({ name, size = 16 }: { name: IconName; size?: number }) {
  const P: Record<IconName, React.ReactNode> = {
    peso: <><path d="M6 3h6a4 4 0 0 1 0 8H6" /><path d="M6 7h12M6 11h12M6 3v18" /></>,
    trend: <><path d="m3 17 6-6 4 4 8-8" /><path d="M17 7h4v4" /></>,
    percent: <><path d="M19 5 5 19" /><circle cx="6.5" cy="6.5" r="2.5" /><circle cx="17.5" cy="17.5" r="2.5" /></>,
    wallet: <><path d="M3 7h16a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h12" /><path d="M16 12h.01" /></>,
    clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
    receipt: <><path d="M5 3v18l2-1 2 1 2-1 2 1 2-1 2 1V3l-2 1-2-1-2 1-2-1-2 1-2-1Z" /><path d="M8 8h8M8 12h8" /></>,
    tag: <><path d="M3 11V5a2 2 0 0 1 2-2h6l9 9-8 8-9-9Z" /><circle cx="7.5" cy="7.5" r="1" /></>,
    box: <><path d="M21 8 12 3 3 8m18 0-9 5-9-5m18 0v8l-9 5-9-5V8" /></>,
    chart: <><path d="M3 3v18h18" /><path d="m7 14 3-3 3 3 4-5" /></>,
    pie: <><path d="M12 3a9 9 0 1 0 9 9h-9Z" /><path d="M12 3v9h9" /></>,
    share: <><circle cx="6" cy="12" r="2.5" /><circle cx="18" cy="6" r="2.5" /><circle cx="18" cy="18" r="2.5" /><path d="m8.2 10.8 7.6-3.6M8.2 13.2l7.6 3.6" /></>,
    layers: <><path d="m12 2 9 5-9 5-9-5 9-5Z" /><path d="m3 12 9 5 9-5M3 17l9 5 9-5" /></>,
    funnel: <><path d="M3 4h18l-7 8v6l-4 2v-8L3 4Z" /></>,
    users: <><circle cx="9" cy="8" r="3" /><path d="M3 20a6 6 0 0 1 12 0" /><path d="M16 6a3 3 0 0 1 0 6M21 20a6 6 0 0 0-3.5-5.4" /></>,
    user: <><circle cx="12" cy="8" r="3.5" /><path d="M5 20a7 7 0 0 1 14 0" /></>,
    list: <><path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" /></>,
    coin: <><circle cx="12" cy="12" r="9" /><path d="M9.5 9.5a2.5 2.5 0 0 1 5 0c0 1.5-1 2-2.5 2.5s-2.5 1-2.5 2.5a2.5 2.5 0 0 0 5 0" /><path d="M12 7v1.5M12 15.5V17" /></>,
    check: <><circle cx="12" cy="12" r="9" /><path d="m8.5 12 2.5 2.5 4.5-5" /></>,
    target: <><circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="5" /><circle cx="12" cy="12" r="1" /></>,
    edit: <><path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" /></>,
    download: <><path d="M12 3v12m0 0 4-4m-4 4-4-4M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" /></>,
  };
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">{P[name]}</svg>;
}
