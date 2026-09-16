/**
 * Web Worker — merges + recomputes all forecast rows off the main thread.
 * Receives a MergeRequest, posts back a MergeResponse.
 * No DOM, no React, no Supabase — pure data transforms only.
 */

import { recomputeForecastRow } from '@/lib/forecast/recomputeForecastRow';
import { getForecastDateVars } from '@/lib/forecastDateVars';
import type { ForecastDateVars } from '@/lib/forecastDateVars';

export interface MergeRequest {
  allItems: Record<string, unknown>[];
  manualMap: [string, Record<string, unknown>][];
  statusOverrideMap: [string, Record<string, unknown>][];
  projOverrideMap: [string, Record<string, unknown>][];
  supplyOverrideMap: [string, Record<string, unknown>][];
  forecastReportDataMap: [string, Record<string, unknown>][];
  localRowPatches: Record<string, Record<string, unknown>>;
  monthlySaleEntries: [string, Record<string, unknown>][];
  dateVars: ForecastDateVars;
}

export interface MergeResponse {
  rows: Record<string, unknown>[];
}

self.onmessage = (e: MessageEvent<MergeRequest>) => {
  const {
    allItems,
    manualMap: manualEntries,
    statusOverrideMap: statusEntries,
    projOverrideMap: projEntries,
    supplyOverrideMap: supplyEntries,
    forecastReportDataMap: frEntries,
    localRowPatches,
    monthlySaleEntries,
    dateVars,
  } = e.data;

  const manualMap = new Map(manualEntries);
  const statusOverrideMap = new Map(statusEntries);
  const projOverrideMap = new Map(projEntries);
  const supplyOverrideMap = new Map(supplyEntries);
  const forecastReportDataMap = new Map(frEntries);
  const monthlySaleMap = new Map(monthlySaleEntries);

  const rows = allItems.map((row) => {
    const sku = String(row.sku ?? '');
    const manual = manualMap.get(sku);
    const statusOvr = statusOverrideMap.get(sku);
    const projOvr = projOverrideMap.get(sku);
    const supplyOvr = supplyOverrideMap.get(sku);
    const forecastReportData = forecastReportDataMap.get(sku);
    const localPatch = localRowPatches[sku];
    const merged: Record<string, unknown> = { ...row, ...(localPatch ?? {}) };

    if (manual) {
      merged.order_proposal_qty = manual.order_proposal_qty ?? row.order_proposal_qty;
      merged.monthly_projection = manual.monthly_projection ?? row.monthly_projection;
      merged.buyer_notes = manual.buyer_notes ?? row.buyer_notes;
      merged.planner_notes = manual.planner_notes ?? row.planner_notes;
      merged.analyst_notes = manual.analyst_notes ?? row.analyst_notes;
    }

    if (statusOvr) {
      if (statusOvr.factory != null) merged.factory = statusOvr.factory;
      if (statusOvr.status != null) merged.status = statusOvr.status;
    }

    if (forecastReportData) {
      merged.lead_time = forecastReportData.lead_time;
      merged.buyer = forecastReportData.buyer ?? row.buyer;
      merged.inventory_analyst = forecastReportData.inventory_analyst ?? row.inventory_analyst;
      merged.country = forecastReportData.country ?? row.country;
      // unit_cost fallback → forecast_main.landed_cost (mirrors the page merge).
      const uc = Number(merged.unit_cost);
      const lc = Number((forecastReportData as Record<string, unknown>).landed_cost);
      if ((!Number.isFinite(uc) || uc <= 0) && Number.isFinite(lc) && lc > 0) merged.unit_cost = lc;
    }

    const drivingInputChanged = Object.prototype.hasOwnProperty.call(localPatch ?? {}, 'monthly_projection');
    const hasManualMonthlyProjection = (manual as any)?.monthly_projection != null;
    const hasAnyProjOverride =
      !!projOvr &&
      Array.from({ length: 12 }, (_, idx) => idx + 1).some(
        (monthIdx) => (projOvr as any)[`proj_month_${monthIdx}_override`] != null,
      );
    const hasAnySupplyOverride =
      !!supplyOvr &&
      Array.from({ length: 12 }, (_, idx) => idx + 1).some(
        (monthIdx) => (supplyOvr as any)[`supply_month_${monthIdx}_override`] != null,
      );
    const shouldRecomputeProjection = drivingInputChanged || hasManualMonthlyProjection || hasAnyProjOverride;

    const rawOpt = ((localPatch as any)?.forecast_option as number | undefined) ?? (manual as any)?.forecast_option ?? 0;
    const optionNum = Math.min(4, Math.max(0, Number.isFinite(Number(rawOpt)) ? Number(rawOpt) : 1));

    return recomputeForecastRow(
      merged,
      monthlySaleMap,
      shouldRecomputeProjection,
      hasAnyProjOverride ? (projOvr as any) : null,
      hasAnySupplyOverride ? (supplyOvr as any) : null,
      optionNum,
      dateVars,
    );
  });

  const response: MergeResponse = { rows };
  self.postMessage(response);
};
