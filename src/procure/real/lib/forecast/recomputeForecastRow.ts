/**
 * ⚠️  MIRROR FILE — DO NOT EDIT INDEPENDENTLY ⚠️
 *
 * This is a verbatim copy of `recomputeForecastRow` from
 * src/pages/MonthlyForecast.tsx (lines ~4764-5153).
 *
 * It powers the background email auto-send pipeline so it does not need
 * to live inside the MonthlyForecast component closure.
 *
 * If you change forecast math here, change it in MonthlyForecast.tsx
 * the same way (or vice-versa). Drift between the two paths will cause
 * the auto-emailed report to disagree with what users see on the page.
 */

import type { ForecastDateVars } from '@/lib/forecastDateVars';

export function toNumberSafe(v: unknown): number | null {
  if (v == null) return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string') {
    const s = v.trim();
    if (!s) return null;
    const n = Number(s.replace(/,/g, ''));
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

export function recomputeForecastRow(
  row: Record<string, unknown>,
  saleLookup?: Map<string, Record<string, unknown>>,
  drivingInputChanged = false,
  projOverrides?: Record<string, unknown> | null,
  supplyOverrides?: Record<string, unknown> | null,
  optionNum: number = 1,
  dateVars?: ForecastDateVars,
): Record<string, unknown> {
  if (!dateVars) {
    const now = new Date();
    const elapsed_days = now.getDate();
    const days_in_month = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    const remaining_days = days_in_month - elapsed_days;
    const yyyy = now.getFullYear();
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const dd = String(elapsed_days).padStart(2, '0');
    dateVars = {
      now,
      current_date: `${yyyy}-${mm}-${dd}`,
      elapsed_days,
      days_in_month,
      remaining_days,
    };
  }

  const out: Record<string, unknown> = { ...row };

  const effectiveMonthlyProjection = toNumberSafe(out.monthly_projection) ?? 0;
  const orderProposalQty = toNumberSafe(out.order_proposal_qty) ?? 0;
  const cbm = toNumberSafe(out.cbm) ?? 0;

  // total_cbm_approved = cbm × order_proposal_qty
  out.total_cbm_approved = cbm * orderProposalQty;

  // months_worth: LAGING live na kuwenta mula sa effective na Monthly
  // Projection para laging tugma sa ipinapakitang projection — hindi umaasa
  // sa posibleng stale na DB value (MIRROR ng MonthlyForecast.tsx — keep in sync).
  if (effectiveMonthlyProjection > 0) {
    const ohInvMW = toNumberSafe(out.oh_inv) ?? 0;
    const otwUnits = toNumberSafe(out.otw_units) ?? 0;
    const onOrderUnits = toNumberSafe(out.on_order_units) ?? 0;
    const poInProgress = toNumberSafe(out.po_in_progress) ?? 0;
    const fbaReserved = toNumberSafe(out.fba_reserved) ?? 0;
    const intransitFba = toNumberSafe(out.intransit_fba) ?? 0;
    const fba = toNumberSafe(out.fba) ?? 0;
    const totalInv = ohInvMW + otwUnits + onOrderUnits + poInProgress + fbaReserved + intransitFba + fba;
    out.months_worth = Math.round((totalInv / effectiveMonthlyProjection) * 10) / 10;
  } else {
    const dbMonthsWorth = toNumberSafe(row.months_worth);
    out.months_worth = dbMonthsWorth != null ? dbMonthsWorth : 0;
  }

  // ── Resolve sales_month_6 ──
  const rawSalesMonth6 = out.sales_month_6;
  let salesMonth6: number;
  if (rawSalesMonth6 != null && rawSalesMonth6 !== '' && rawSalesMonth6 !== undefined) {
    salesMonth6 = toNumberSafe(rawSalesMonth6) ?? 0;
  } else if (saleLookup) {
    const sku = String(out.sku ?? '');
    const saleRow = saleLookup.get(sku);
    if (saleRow) {
      salesMonth6 = toNumberSafe(saleRow.month_6) ?? 0;
    } else {
      const pid = String(out.product_id ?? '');
      const saleRow2 = pid ? saleLookup.get(pid) : undefined;
      salesMonth6 = saleRow2 ? (toNumberSafe(saleRow2.month_6) ?? 0) : 0;
    }
  } else {
    salesMonth6 = 0;
  }
  out.sales_month_6 = salesMonth6;

  const getOverride = (monthIdx: number): number | null => {
    if (!projOverrides) return null;
    const v = projOverrides[`proj_month_${monthIdx}_override`];
    return v != null ? Number(v) : null;
  };

  // Always recompute in UI so proj_month_1 uses today's live remaining_days.
  const mustRecompute = true;

  const projArr: number[] = [];

  if (!mustRecompute) {
    for (let i = 1; i <= 12; i++) {
      const v = toNumberSafe(row[`proj_month_${i}`]) ?? 0;
      projArr.push(v);
      out[`proj_month_${i}`] = v;
    }
  } else {
    const daysElapsed = Math.max(1, dateVars.elapsed_days);
    const daysInMonth = dateVars.days_in_month;
    const remainingDays = dateVars.remaining_days;

    // proj_month_1
    const ovr1 = getOverride(1);
    let p1: number;
    if (ovr1 != null) {
      p1 = ovr1;
    } else {
      p1 = (effectiveMonthlyProjection / 30) * remainingDays;
    }
    out.proj_month_1 = p1;
    projArr.push(p1);

    const actualSaleOfMonth = toNumberSafe(out.actual_sale_of_month) ?? 0;
    const netVelocity = (actualSaleOfMonth / daysElapsed) * daysInMonth;
    const grossVelocity = toNumberSafe(out.sales_velocity) ?? 0;

    // proj_month_2
    const ovr2 = getOverride(2);
    let p2Calc: number;
    if (optionNum === 2) {
      p2Calc = Math.ceil((effectiveMonthlyProjection + salesMonth6) / 2);
    } else if (optionNum === 3) {
      p2Calc = Math.ceil((salesMonth6 + grossVelocity) / 2);
    } else if (optionNum === 4) {
      p2Calc = Math.ceil((salesMonth6 + p1) / 2);
    } else {
      p2Calc = Math.ceil((effectiveMonthlyProjection + salesMonth6) / 2);
    }
    const p2 = ovr2 != null ? ovr2 : p2Calc;
    out.proj_month_2 = p2;
    projArr.push(p2);

    // proj_month_3
    const ovr3 = getOverride(3);
    let p3Calc: number;
    if (optionNum === 0) {
      // Baseline: monthly_projection + proj_month_2, divided by 2
      p3Calc = Math.ceil((effectiveMonthlyProjection + p2) / 2);
    } else if (optionNum === 1) {
      // Blended: Current Sales Velocity (gross) + proj_month_2 (Jun)
      p3Calc = Math.ceil((grossVelocity + p2) / 2);
    } else if (optionNum === 2) {
      p3Calc = Math.ceil((netVelocity + salesMonth6) / 2);
    } else if (optionNum === 3) {
      p3Calc = Math.ceil((grossVelocity + p2) / 2);
    } else {
      p3Calc = Math.ceil((p1 + p2) / 2);
    }
    const p3 = ovr3 != null ? ovr3 : p3Calc;
    out.proj_month_3 = p3;
    projArr.push(p3);

    // proj_month_4..12
    for (let i = 4; i <= 12; i++) {
      const ovrN = getOverride(i);
      const val = ovrN != null ? ovrN : Math.ceil((projArr[i - 2] + projArr[i - 3]) / 2);
      projArr.push(val);
      out[`proj_month_${i}`] = val;
    }
  }

  // ── Supply months ──
  const ohInv = toNumberSafe(out.oh_inv) ?? 0;
  const replOhInv = toNumberSafe(out.repl_oh_inv) ?? 0;

  const getSupplyOverride = (monthIdx: number): number | null => {
    if (!supplyOverrides) return null;
    const v = supplyOverrides[`supply_month_${monthIdx}_override`];
    return v != null ? Number(v) : null;
  };

  const hasBackendSupply =
    row.supply_month_1 != null && row.supply_month_1 !== '' && row.supply_month_1 !== undefined;
  const hasAnySupplyOverride = supplyOverrides != null;
  const supplyMustRecompute = mustRecompute || hasAnySupplyOverride || !hasBackendSupply;

  const supplyArr: number[] = [];
  if (!supplyMustRecompute) {
    for (let i = 1; i <= 12; i++) {
      const val = toNumberSafe(row[`supply_month_${i}`]) ?? 0;
      supplyArr.push(val);
      out[`supply_month_${i}`] = val;
    }
  } else {
    const sOvr1 = getSupplyOverride(1);
    if (sOvr1 != null) {
      supplyArr.push(sOvr1);
      out.supply_month_1 = sOvr1;
    } else {
      const fba = toNumberSafe(out.fba) ?? 0;
      const inc1 = toNumberSafe(out.incoming_month_1) ?? 0;
      const replFba = toNumberSafe(out.repl_fba) ?? 0;
      const repl1 = toNumberSafe(out.repl_month_1) ?? 0;
      const s1 = Math.round(fba + ohInv + inc1 + replFba + replOhInv + repl1 - projArr[0]);
      supplyArr.push(s1);
      out.supply_month_1 = s1;
    }

    for (let i = 2; i <= 12; i++) {
      const sOvrN = getSupplyOverride(i);
      if (sOvrN != null) {
        supplyArr.push(sOvrN);
        out[`supply_month_${i}`] = sOvrN;
      } else {
        const incN = toNumberSafe(out[`incoming_month_${i}`]) ?? 0;
        const replN = toNumberSafe(out[`repl_month_${i}`]) ?? 0;
        const sN = Math.round(supplyArr[i - 2] + incN + replN - projArr[i - 1]);
        supplyArr.push(sN);
        out[`supply_month_${i}`] = sN;
      }
    }
  }

  // ── Revenue & Lost Revenue ──
  const unitCost = toNumberSafe(out.unit_cost) ?? 0;
  let totalRev = 0;
  let totalLost = 0;
  for (let i = 1; i <= 12; i++) {
    const proj = projArr[i - 1] ?? 0;
    const supply = supplyArr[i - 1] ?? 0;
    const rev = proj * unitCost;
    const lost = supply < 0 ? supply * unitCost : 0;
    out[`rev_month_${i}`] = rev;
    out[`lost_month_${i}`] = lost;
    totalRev += rev;
    totalLost += lost;
  }
  out.total_revenue = totalRev;
  out.total_lost_revenue = totalLost;

  const s1Val = supplyArr[0] ?? 0;
  out.supply_status = s1Val > 0 ? 'Good' : 'Critical';

  const rawSupplyingMonth = row.supplying_month ?? row.supply_month ?? null;
  out.supplying_month = rawSupplyingMonth;
  out.supply_month = rawSupplyingMonth;

  out.__forecast_option = optionNum;

  // ── 90-DAY INVENTORY DECISION PLANNER ──
  // SOURCE OF TRUTH = the Forecast UI. All 90-day figures come from the same
  // monthly values the table displays (rounded, as shown); the planner helpers
  // read __raw_ninety_day_* which now mirror these — never the loader's stored
  // ninety_day_* columns. Mirrors MonthlyForecast.tsx exactly.
  const r0 = (n: number) => Math.round(n);

  const ninetyDayProjection = r0(projArr[0] ?? 0) + r0(projArr[1] ?? 0) + r0(projArr[2] ?? 0);
  out.ninety_day_projection = ninetyDayProjection;

  const ninetyDaySupply = r0(supplyArr[0] ?? 0) + r0(supplyArr[1] ?? 0) + r0(supplyArr[2] ?? 0);
  out.ninety_day_supply = ninetyDaySupply;

  const ninetyDayDeficit = ninetyDaySupply - ninetyDayProjection;
  out.ninety_day_deficit = ninetyDayDeficit;

  out.__raw_ninety_day_projection = ninetyDayProjection;
  out.__raw_ninety_day_supply = ninetyDaySupply;
  out.__raw_ninety_day_deficit = ninetyDayDeficit;

  const revenueLoss = ninetyDayDeficit < 0 ? Math.abs(ninetyDayDeficit) * unitCost : 0;
  out.ninety_day_revenue_loss = revenueLoss;

  const safetyStock = Math.ceil(ninetyDayProjection / 3);
  out.safety_stock = safetyStock;

  const dbLeadTime = toNumberSafe(row.lead_time);
  const leadTimeDays = dbLeadTime ?? toNumberSafe(out.vendor_lead_time) ?? toNumberSafe(out.lead_time_days);

  out.lead_time = row.lead_time;

  const dailySales = ninetyDayProjection / 90;

  let orderNow = false;
  if (leadTimeDays) {
    if (ninetyDayDeficit < 0) {
      orderNow = true;
    } else if (dailySales > 0) {
      const daysUntilDeficit = ninetyDayDeficit / dailySales;
      if (daysUntilDeficit < leadTimeDays) {
        orderNow = true;
      }
    }
  }

  let orderRecommended = 0;
  if (orderNow) {
    if (ninetyDayDeficit < 0) {
      orderRecommended = ninetyDayProjection + Math.abs(ninetyDayDeficit) + safetyStock;
    } else {
      orderRecommended = ninetyDayProjection + safetyStock;
    }
  } else {
    orderRecommended = ninetyDayProjection + safetyStock;
  }
  out.order_recommended = orderRecommended;

  // ── No-demand guard ──
  // If 90-day projection is zero, there's no demand driving an order, so
  // order_date / supply_month / covered_months must all be blank — even
  // when supply exists (e.g. projection = 0 but supply = 465).
  if (ninetyDayProjection <= 0) {
    out.order_date_forecast = null;
    out.supply_month_forecast = null;
    out.covered_months = null;
  } else {
    const today = new Date();
    let orderDate: Date | null = null;
    if (leadTimeDays) {
      if (orderNow) {
        orderDate = today;
      } else if (dailySales > 0) {
        const daysUntilStockOut = ninetyDaySupply / dailySales;
        const stockRunsOutDate = new Date(today.getTime() + daysUntilStockOut * 24 * 60 * 60 * 1000);
        const calculatedOrderDate = new Date(stockRunsOutDate.getTime() - leadTimeDays * 24 * 60 * 60 * 1000);
        orderDate = calculatedOrderDate < today ? today : calculatedOrderDate;
      } else {
        orderDate = today;
      }
    }
    out.order_date_forecast = orderDate ? orderDate.toISOString().split('T')[0] : null;

    if (orderDate && leadTimeDays) {
      const supplyMonth = new Date(orderDate.getTime() + leadTimeDays * 24 * 60 * 60 * 1000);
      out.supply_month_forecast = supplyMonth.toISOString().split('T')[0];

      let coverageDays = 0;
      if (dailySales > 0) {
        coverageDays = orderRecommended / dailySales;
      } else {
        coverageDays = 180;
      }
      const coveredMonths = new Date(supplyMonth.getTime() + coverageDays * 24 * 60 * 60 * 1000);
      out.covered_months = coveredMonths.toISOString().split('T')[0];
    } else {
      out.supply_month_forecast = null;
      out.covered_months = null;
    }
  }

  out.action = orderNow ? 'Order Now' : 'Order Soon';

  // Override order_date / supply_month / covered_months with the ROP-driven
  // formula: today + max(0, dos - lead), then + lead for supply_month.
  // Mirrors MonthlyForecast.tsx logic. Uses local-time YYYY-MM-DD so
  // toISOString() UTC shift doesn't bleed a day backward in PHT/UTC+ zones.
  {
    const rawProj = toNumberSafe(out.__raw_ninety_day_projection) ?? ninetyDayProjection;
    const rawSupply = toNumberSafe(out.__raw_ninety_day_supply) ?? ninetyDaySupply;
    const leadInt = toNumberSafe(leadTimeDays);
    if (rawProj > 0 && leadInt != null && leadInt > 0) {
      const dailyRate = rawProj / 90;
      const dos = dailyRate > 0 && rawSupply > 0 ? Math.floor(rawSupply / dailyRate) : 0;
      const dum = dos - leadInt;
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const orderDate = new Date(today.getTime() + Math.max(0, dum) * 24 * 60 * 60 * 1000);
      const supplyMonth = new Date(orderDate.getTime() + leadInt * 24 * 60 * 60 * 1000);
      const fmt = (d: Date) =>
        `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      out.order_date_forecast = fmt(orderDate);
      out.supply_month_forecast = fmt(supplyMonth);
      out.covered_months = fmt(supplyMonth);
    }
  }

  return out;
}

/* ── unit_cost fallback → forecast_main.landed_cost ─────────────────────────
 * forecast_report.unit_cost is blank on every row, which zeroes Revenue /
 * Lost Revenue and the planner's Revenue Loss. The page/worker/email paths
 * fetch forecast_main themselves; these helpers give the Dashboard's four
 * card pipelines the same rule through one module-level cache.
 * primeLandedCostCache() is idempotent — call it early (module load); the
 * pipelines' own multi-fetch awaits give it ample time to fill. */
let landedCostCache: Map<string, number> | null = null;
let landedCostFetch: Promise<void> | null = null;

export function primeLandedCostCache(supabase: any): Promise<void> {
  if (!landedCostFetch) {
    landedCostFetch = (async () => {
      const m = new Map<string, number>();
      let offset = 0;
      const PAGE = 1000;
      while (true) {
        const { data, error } = await supabase
          .from('forecast_main')
          .select('sku,landed_cost')
          .range(offset, offset + PAGE - 1);
        if (error) throw error;
        const page = (data ?? []) as { sku: string | null; landed_cost: number | null }[];
        for (const r of page) {
          const s = String(r.sku ?? '').trim();
          const n = Number(r.landed_cost);
          if (s && Number.isFinite(n) && n > 0) m.set(s, n);
        }
        if (page.length < PAGE) break;
        offset += PAGE;
      }
      landedCostCache = m;
    })().catch(() => {
      // Non-fatal: cards render without Revenue Loss; allow a later retry.
      landedCostFetch = null;
    });
  }
  return landedCostFetch ?? Promise.resolve();
}

/** Apply the fallback onto a merged row BEFORE recomputeForecastRow runs
 *  (revenue math reads unit_cost inside the recompute). No-op when a real
 *  unit_cost exists or the cache has not filled yet. */
export function applyLandedCostFallback(row: Record<string, unknown>): void {
  const uc = Number(row.unit_cost);
  if (Number.isFinite(uc) && uc > 0) return;
  const lc = landedCostCache?.get(String(row.sku ?? '').trim());
  if (lc != null && lc > 0) row.unit_cost = lc;
}
