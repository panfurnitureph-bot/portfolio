import { useMemo } from "react";
import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { externalSupabase as supabase } from "@/integrations/supabase/externalClient";
import { addDays, addHours, format, startOfDay, subDays } from "date-fns";

type Filters = {
  fromDate?: Date;
  toDate?: Date;
  status?: string;
  warehouse?: string;
};

// ✅ include 15d + month-based ranges
export type NewOrdersRange = "today" | "24h" | "7d" | "15d" | "31d" | "4m" | "6m" | "12m";

export type OrdersSeriesPoint = {
  date: string;
  count: number;
  revenue: number; // always numeric (0 if missing) so line reaches today
  total_qty: number;
  has_data: boolean; // ✅ controls dots + tooltip
};

export type ShippedSeriesPoint = {
  date: string;
  shipped_count: number;
  shipped_revenue: number; // always numeric (0 if missing)
  total_ship_qty: number;
  has_data: boolean;
};

const VIEWS = {
  kpis: "dashboard_kpis_windows",
  ordersDaily: "dashboard_orders_daily",
  ordersWindows: "dashboard_orders_windows",
  shippedDaily: "dashboard_shipped_daily",
  shippedWindows: "dashboard_shipped_windows",
};

const num = (v: any) => {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
};

function buildWindow(range: NewOrdersRange, fromDate?: Date, toDate?: Date) {
  const now = new Date();

  // Custom range -> daily buckets
  if (fromDate || toDate) {
    const to = toDate ?? now;
    const from = fromDate ?? subDays(to, 30);
    const days = Math.max(1, Math.min(366, Math.ceil((to.getTime() - from.getTime()) / 86400000) + 1));
    return { from, to, bucket: "day" as const, points: days, isCustom: true as const };
  }

  // Presets
  // ✅ TODAY = 1 day point (today)
  if (range === "today")
    return { from: startOfDay(now), to: now, bucket: "day" as const, points: 1, isCustom: false as const };

  // ✅ 24h = 2 day points (yesterday + today) using DAILY views (since we don't have hourly tables)
  if (range === "24h")
    return { from: subDays(startOfDay(now), 1), to: now, bucket: "day" as const, points: 2, isCustom: false as const };

  if (range === "7d")
    return { from: subDays(now, 6), to: now, bucket: "day" as const, points: 7, isCustom: false as const };

  if (range === "15d")
    return { from: subDays(now, 14), to: now, bucket: "day" as const, points: 15, isCustom: false as const };

  if (range === "4m")
    return { from: subDays(now, 120), to: now, bucket: "day" as const, points: 121, isCustom: false as const };

  if (range === "6m")
    return { from: subDays(now, 180), to: now, bucket: "day" as const, points: 181, isCustom: false as const };

  if (range === "12m")
    return { from: subDays(now, 365), to: now, bucket: "day" as const, points: 366, isCustom: false as const };

  return { from: subDays(now, 30), to: now, bucket: "day" as const, points: 31, isCustom: false as const };
}

// Windows views support today/7d/15d/31d/4m/6m/12m
function rangeToWindowKey(range: NewOrdersRange, isCustom: boolean) {
  if (isCustom) return "31d";
  if (range === "today") return "today";
  if (range === "24h") return "today";
  if (range === "7d") return "7d";
  if (range === "15d") return "15d";
  if (range === "4m") return "4m";
  if (range === "6m") return "6m";
  if (range === "12m") return "12m";
  return "31d";
}

/** Per-day aggregate of forecast_order_tracker lines (fresh through today) —
 *  covers the tail the nightly dashboard_orders_daily loader stopped writing
 *  (it silently died once and flatlined the New Orders chart). */
async function fetchOrderTrackerDaily(fromIso: string, toIso: string) {
  type Agg = { orders: Set<number>; revenue: number; qty: number };
  const byDay = new Map<string, Agg>();
  const PAGE = 1000;
  let offset = 0;
  while (true) {
    const { data, error } = await supabase
      .from("forecast_order_tracker")
      .select("order_id,time_of_order,qty,line_total")
      .gte("time_of_order", fromIso)
      .lte("time_of_order", toIso)
      .order("time_of_order", { ascending: true })
      .range(offset, offset + PAGE - 1);
    if (error) throw error;
    const page = (data ?? []) as { order_id: number; time_of_order: string; qty: number; line_total: number }[];
    for (const r of page) {
      const day = String(r.time_of_order ?? "").slice(0, 10);
      if (!day) continue;
      let agg = byDay.get(day);
      if (!agg) { agg = { orders: new Set(), revenue: 0, qty: 0 }; byDay.set(day, agg); }
      agg.orders.add(Number(r.order_id));
      agg.revenue += num(r.line_total);
      agg.qty += num(r.qty);
    }
    if (page.length < PAGE) break;
    offset += PAGE;
  }
  return byDay;
}

async function fetchDashboardData(effective: ReturnType<typeof buildWindow>, windowKey: string) {
  const dayFrom = format(effective.from, "yyyy-MM-dd");
  const dayTo = format(effective.to, "yyyy-MM-dd");

  // KPI always available (but you can still ignore it later if needed)
  const kpiPromise = supabase.from(VIEWS.kpis).select("*").eq("range_key", windowKey).maybeSingle();

  const [kpiRes, ordersRes, shippedRes, ordersDailyMaxRes] = await Promise.all([
    kpiPromise,
    supabase
      .from(VIEWS.ordersDaily)
      .select("day,order_count,total_qty,revenue")
      .gte("day", dayFrom)
      .lte("day", dayTo)
      .order("day", { ascending: true }),
    supabase
      .from(VIEWS.shippedDaily)
      .select("day,shipped_count,total_ship_qty,shipped_revenue")
      .gte("day", dayFrom)
      .lte("day", dayTo)
      .order("day", { ascending: true }),
    // Global last day the daily-aggregate loader wrote — everything after it
    // comes live from forecast_order_tracker instead.
    supabase.from(VIEWS.ordersDaily).select("day").order("day", { ascending: false }).limit(1),
  ]);

  if (kpiRes.error) throw kpiRes.error;
  if (ordersRes.error) throw ordersRes.error;
  if (shippedRes.error) throw shippedRes.error;

  const od = ordersRes.data ?? [];
  const sd = shippedRes.data ?? [];

  // Live tail: from the daily loader's last written day (inclusive — its last
  // day is typically partial) through the window end. Non-fatal on error so a
  // tracker hiccup never blanks the whole dashboard.
  const lastDailyDay = String((ordersDailyMaxRes.data?.[0] as any)?.day ?? "");
  const tailFromDay = lastDailyDay && lastDailyDay >= dayFrom ? lastDailyDay : dayFrom;
  let trackerByDay = new Map<string, { orders: Set<number>; revenue: number; qty: number }>();
  if (tailFromDay <= dayTo) {
    try {
      trackerByDay = await fetchOrderTrackerDaily(`${tailFromDay}T00:00:00`, `${dayTo}T23:59:59`);
    } catch {
      trackerByDay = new Map();
    }
  }

  // Totals
  let newOrderCount = 0;
  let newOrderRevenue = 0;
  let shippedCount = 0;
  let shippedRevenue = 0;

  if (effective.isCustom) {
    newOrderCount = od.reduce((s: number, r: any) => s + num(r.order_count), 0);
    newOrderRevenue = od.reduce((s: number, r: any) => s + num(r.revenue), 0);

    shippedCount = sd.reduce((s: number, r: any) => s + num(r.shipped_count), 0);
    shippedRevenue = sd.reduce((s: number, r: any) => s + num(r.shipped_revenue), 0);
  } else {
    const [{ data: ow, error: owErr }, { data: sw, error: swErr }] = await Promise.all([
      supabase.from(VIEWS.ordersWindows).select("order_count,revenue").eq("window", windowKey).maybeSingle(),
      supabase.from(VIEWS.shippedWindows).select("shipped_count,shipped_revenue").eq("window", windowKey).maybeSingle(),
    ]);
    if (owErr) throw owErr;
    if (swErr) throw swErr;

    newOrderCount = num(ow?.order_count);
    newOrderRevenue = num(ow?.revenue);

    shippedCount = num(sw?.shipped_count);
    shippedRevenue = num(sw?.shipped_revenue);
  }

  // -------------------------------------------------------
  // ✅ Build Orders series
  // - hour bucket: 24 ticks ending current hour
  // - day bucket: includes TODAY as last point always
  // - revenue/count default 0 so line reaches end
  // - has_data indicates real data (controls dots/tooltip)
  // -------------------------------------------------------
  const ordersBucket = new Map<string, OrdersSeriesPoint>();

  const startDay = startOfDay(effective.from);
  for (let i = 0; i < effective.points; i++) {
    const d = addDays(startDay, i);
    const key = format(d, "yyyy-MM-dd");
    ordersBucket.set(key, { date: key, count: 0, revenue: 0, total_qty: 0, has_data: false });
  }

  for (const r of od) {
    const key = String((r as any).day);
    const cur = ordersBucket.get(key);
    if (cur) {
      cur.count = num((r as any).order_count);
      cur.total_qty = num((r as any).total_qty);
      cur.revenue = num((r as any).revenue);
      cur.has_data = cur.count > 0 || cur.revenue > 0 || cur.total_qty > 0;
    }
  }

  // Overlay the live tracker tail — overrides the loader's (possibly partial)
  // last day and fills every day it never wrote.
  for (const [day, agg] of trackerByDay) {
    const cur = ordersBucket.get(day);
    if (!cur) continue;
    cur.count = agg.orders.size;
    cur.total_qty = agg.qty;
    cur.revenue = agg.revenue;
    cur.has_data = cur.count > 0 || cur.revenue > 0 || cur.total_qty > 0;
  }

  const newOrderSeries: OrdersSeriesPoint[] = Array.from(ordersBucket.values()).sort((a, b) =>
    a.date.localeCompare(b.date),
  );

  // Headline = sum of the exact series the chart draws (the *_windows views
  // stopped updating with the daily loader, so they under-report the tail).
  newOrderCount = newOrderSeries.reduce((s, p) => s + p.count, 0);
  newOrderRevenue = newOrderSeries.reduce((s, p) => s + p.revenue, 0);

  // -------------------------------------------------------
  // ✅ Build Shipped series
  // hour bucket: same behavior as orders (put today's total on last tick)
  // day bucket: includes TODAY
  // -------------------------------------------------------
  const shippedBucket = new Map<string, ShippedSeriesPoint>();

  const startDay2 = startOfDay(effective.from);
  for (let i = 0; i < effective.points; i++) {
    const d = addDays(startDay2, i);
    const key = format(d, "yyyy-MM-dd");
    shippedBucket.set(key, { date: key, shipped_count: 0, shipped_revenue: 0, total_ship_qty: 0, has_data: false });
  }

  for (const r of sd) {
    const key = String((r as any).day);
    const cur = shippedBucket.get(key);
    if (cur) {
      cur.shipped_count = num((r as any).shipped_count);
      cur.total_ship_qty = num((r as any).total_ship_qty);
      cur.shipped_revenue = num((r as any).shipped_revenue);
      cur.has_data = cur.shipped_count > 0 || cur.shipped_revenue > 0 || cur.total_ship_qty > 0;
    }
  }

  const shippedSeries: ShippedSeriesPoint[] = Array.from(shippedBucket.values()).sort((a, b) =>
    a.date.localeCompare(b.date),
  );

  return {
    kpis: kpiRes.data ?? null,
    newOrderSeries,
    newOrderCount,
    newOrderRevenue,
    shippedSeries,
    shippedCount,
    shippedRevenue,
  };
}

export function useDashboardData(filters: Filters, range: NewOrdersRange = "31d") {
  const effective = useMemo(
    () => buildWindow(range, filters.fromDate, filters.toDate),
    [range, filters.fromDate, filters.toDate],
  );

  const windowKey = useMemo(
    () => rangeToWindowKey(range, Boolean(filters.fromDate || filters.toDate)),
    [range, filters.fromDate, filters.toDate],
  );

  const queryKey = useMemo(
    () => [
      "dashboard_data",
      windowKey,
      format(effective.from, "yyyy-MM-dd'T'HH"),
      format(effective.to, "yyyy-MM-dd'T'HH"),
    ],
    [windowKey, effective.from, effective.to],
  );

  const { data, isLoading, error, refetch } = useQuery({
    queryKey,
    queryFn: () => fetchDashboardData(effective, windowKey),
    staleTime: 5 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
    refetchOnWindowFocus: false,
    placeholderData: keepPreviousData,
  });

  return {
    isLoading,
    lastError: error ? (error as Error).message : null,

    kpis: data?.kpis ?? null,

    newOrderSeries: data?.newOrderSeries ?? [],
    newOrderCount: data?.newOrderCount ?? 0,
    newOrderRevenue: data?.newOrderRevenue ?? 0,

    shippedSeries: data?.shippedSeries ?? [],
    shippedCount: data?.shippedCount ?? 0,
    shippedRevenue: data?.shippedRevenue ?? 0,

    refetch,
  };
}
