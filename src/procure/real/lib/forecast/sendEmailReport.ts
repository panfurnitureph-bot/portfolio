/**
 * Background email report sender.
 *
 * Pure async orchestrator: fetches all dependent maps from Supabase, runs the
 * same recompute + workbook + n8n pipeline that the manual "Send Email Report"
 * button in MonthlyForecast.tsx uses. Returns counts so the caller can log /
 * update schedule rows.
 *
 * ⚠️ MIRROR — the manual button still calls its inline version inside
 * MonthlyForecast.tsx. Keep payload, message HTML, and order-by behavior in
 * sync between the two paths.
 */

import { externalSupabase as supabase } from '@/integrations/supabase/externalClient';
import { recomputeForecastRow } from './recomputeForecastRow';
import { fetchScProductNames, buildScNameMap } from './newSku';
import { getRolling12MonthsStartingCurrent } from './buildWorkbook';
import { buildFactoryRowStats, buildFactorySummaryHtml } from './factoryChart';
import { buildIdpXlsx, arrayBufferToBase64 } from './idpXlsx';
import {
  applyIdpFilters,
  summarizeFilters,
  EMPTY_FILTERS,
  type IdpFilterState,
} from './idpFilterState';

// Build-version marker. Bump alongside EmailAutoSendProvider so the two stay
// in lock-step. Logged at module load — if the RDP browser logs an older
// version than the desktop, it's serving a stale cached bundle.
const AUTOSEND_BUILD_VERSION = '2026-06-08-v8';

export interface SendEmailReportResult {
  ok: boolean;
  successCount: number;
  failCount: number;
  totalItemsSent: number;
  emails: number;
  reason?: string;
}

const N8N_WEBHOOK_URL =
  (import.meta as any).env?.VITE_N8N_WEBHOOK_URL ||
  'https://automation.example.invalid/webhook/inventory-report';

function log(...args: unknown[]) {
  console.log('[AutoSend]', ...args);
}

function warn(...args: unknown[]) {
  console.warn('[AutoSend]', ...args);
}

function err(...args: unknown[]) {
  console.error('[AutoSend]', ...args);
}

// Fetches all rows from a table using parallel pagination.
// Eliminates silent truncation from hardcoded .limit() calls.
async function paginatedFetch(tableName: string, selectFields: string, pageSize = 1000): Promise<any[]> {
  const { count, error: countErr } = await (supabase as any)
    .from(tableName)
    .select('*', { count: 'exact', head: true });

  if (countErr) {
    return [];
  }

  if (!count || count === 0) return [];

  const totalPages = Math.ceil(count / pageSize);
  const pageResults = await Promise.all(
    Array.from({ length: totalPages }, (_, i) =>
      (supabase as any)
        .from(tableName)
        .select(selectFields)
        .range(i * pageSize, (i + 1) * pageSize - 1)
    )
  );

  const allData: any[] = [];
  for (const { data, error } of pageResults) {
    if (error) { continue; }
    if (data) allData.push(...data);
  }

  return allData;
}

export async function sendEmailReport(): Promise<SendEmailReportResult> {
  // ── STEP 1: email → factory mapping ──
  const { data: mappings, error: mapErr } = await (supabase as any)
    .from('email_factory_mapping')
    .select('*')
    .order('email', { ascending: true })
    .order('factory', { ascending: true });

  if (mapErr) {
    return { ok: false, successCount: 0, failCount: 0, totalItemsSent: 0, emails: 0, reason: 'mapping_query_failed' };
  }

  const emailFactoryGroups: Record<string, string[]> = {};
  for (const m of mappings || []) {
    const email = String((m as any).email || '');
    const factory = String((m as any).factory || '');
    if (!email) continue;
    if (!emailFactoryGroups[email]) emailFactoryGroups[email] = [];
    if (factory && factory !== 'UNASSIGNED') {
      emailFactoryGroups[email].push(factory);
    }
  }

  const allAssignedFactories = Array.from(
    new Set(Object.values(emailFactoryGroups).flat()),
  ).filter(Boolean);

  if (allAssignedFactories.length === 0) {
    return { ok: false, successCount: 0, failCount: 0, totalItemsSent: 0, emails: 0, reason: 'no_factories' };
  }

  // ── STEP 2: forecast_report rows ──
  // IMPORTANT: do NOT pre-filter by factory here. The page version fetches
  // every row, then applies forecast_report_status.factory override before
  // matching against email_factory_mapping. Pre-filtering by base
  // forecast_report.factory drops rows whose factory was *re-assigned* via
  // override — that was the 145-vs-201 drift bug.
  // Parallel pagination — count first, fetch all pages concurrently.
  const { count: frCount, error: frCountErr } = await (supabase as any)
    .from('forecast_report')
    .select('*', { count: 'exact', head: true });

  if (frCountErr) {
    return { ok: false, successCount: 0, failCount: 0, totalItemsSent: 0, emails: 0, reason: 'forecast_query_failed' };
  }

  const PAGE = 1000;
  const frTotalPages = Math.ceil((frCount ?? 0) / PAGE);
  const frPageResults = await Promise.all(
    Array.from({ length: frTotalPages }, (_, i) =>
      (supabase as any)
        .from('forecast_report')
        .select('*')
        .order('sku', { ascending: true })
        .range(i * PAGE, (i + 1) * PAGE - 1)
    )
  );

  let freshData: Record<string, unknown>[] = [];
  for (const { data, error } of frPageResults) {
    if (error) {
      return { ok: false, successCount: 0, failCount: 0, totalItemsSent: 0, emails: 0, reason: 'forecast_query_failed' };
    }
    if (data) freshData = freshData.concat(data as Record<string, unknown>[]);
  }

  if (freshData.length === 0) {
    return { ok: false, successCount: 0, failCount: 0, totalItemsSent: 0, emails: 0, reason: 'no_rows' };
  }

  // ── STEP 3: side-tables (manual, status overrides, proj/supply overrides, lead-time, monthly sales) ──
  // All 6 side tables fetched in parallel, each with full pagination (no silent 10K truncation).
  const [manualRows, statusRows, projRows, supplyRows, leadTimeRows, monthlySaleRows, scNameRows, landedCostRows] = await Promise.all([
    paginatedFetch('forecast_report_manual', 'sku,order_proposal_qty,buyer_notes,planner_notes,analyst_notes,monthly_projection,forecast_option'),
    paginatedFetch('forecast_report_status', 'sku,factory,status,kit,category'),
    paginatedFetch('forecast_report_proj_override', '*'),
    paginatedFetch('forecast_report_supply_override', '*'),
    paginatedFetch('forecast_report', 'sku,lead_time,buyer,inventory_analyst,country'),
    paginatedFetch('monthly_sale_view_auto', '*'),
    // Non-fatal: a names-lookup failure must not block the report send —
    // rows just keep the stored description, same as the page's fallback.
    fetchScProductNames(supabase).catch((e) => { warn('sc names fetch failed', e); return []; }),
    // unit_cost fallback source (forecast_report.unit_cost is blank on every
    // row) — mirrors the page/worker merge so Revenue Loss matches the UI.
    paginatedFetch('forecast_main', 'sku,landed_cost').catch((e) => { warn('forecast_main fetch failed', e); return []; }),
  ]);

  const landedCostMap = new Map<string, number>();
  for (const r of landedCostRows) {
    const s = String((r as any).sku ?? '').trim();
    const n = Number((r as any).landed_cost);
    if (s && Number.isFinite(n) && n > 0) landedCostMap.set(s, n);
  }

  const manualMap = new Map<string, any>();
  for (const r of manualRows) manualMap.set(String((r as any).sku), r);

  const statusOverrideMap = new Map<string, any>();
  for (const r of statusRows) statusOverrideMap.set(String((r as any).sku), r);

  const projOverrideMap = new Map<string, Record<string, unknown>>();
  for (const r of projRows) projOverrideMap.set(String((r as any).sku ?? ''), r as any);

  const supplyOverrideMap = new Map<string, Record<string, unknown>>();
  for (const r of supplyRows) supplyOverrideMap.set(String((r as any).sku ?? ''), r as any);

  const forecastReportDataMap = new Map<string, any>();
  for (const r of leadTimeRows) forecastReportDataMap.set(String((r as any).sku), r);

  const monthlySaleMap = new Map<string, Record<string, unknown>>();
  for (const r of monthlySaleRows) {
    const pid = String((r as any).product_id ?? '');
    if (pid) monthlySaleMap.set(pid, r as any);
    const sku = String((r as any).sku ?? '');
    if (sku && sku !== pid) monthlySaleMap.set(sku, r as any);
  }

  const scNameMap = buildScNameMap(scNameRows);

  // ── STEP 4: merge + recompute — mirrors mergedAllItems (dashboard "all items" pipeline) 1:1 ──
  // See src/pages/MonthlyForecast.tsx ~line 5396. The dashboard KPI count
  // ("X Order Now items") is derived from mergedAllItems, so we mirror THAT
  // pipeline (not mergedItems) for parity. Key differences vs mergedItems:
  //   - monthly_projection is ALWAYS overwritten with `manual ?? row` (no wipe)
  //   - notes fall back to row.<note> when manual.<note> is null
  const recomputedItems = (freshData as Record<string, unknown>[]).map((row) => {
    const sku = String((row as any).sku ?? '');
    const manual = manualMap.get(sku);
    const statusOvr = statusOverrideMap.get(sku);
    const projOvr = projOverrideMap.get(sku);
    const supplyOvr = supplyOverrideMap.get(sku);
    const forecastReportData = forecastReportDataMap.get(sku);

    let merged: Record<string, unknown> = { ...row };

    // Manual override
    if (manual) {
      (merged as any).order_proposal_qty = manual.order_proposal_qty ?? (row as any).order_proposal_qty;
      (merged as any).monthly_projection = manual.monthly_projection ?? (row as any).monthly_projection;
      (merged as any).buyer_notes = manual.buyer_notes ?? (row as any).buyer_notes;
      (merged as any).planner_notes = manual.planner_notes ?? (row as any).planner_notes;
      (merged as any).analyst_notes = manual.analyst_notes ?? (row as any).analyst_notes;
    }

    // Status overrides — ONLY factory + status are overridable.
    // kit/category/pu_status are the ERP-driven (forecast_report is the
    // sole source of truth). Mirrors MonthlyForecast.tsx merge — keep in sync.
    if (statusOvr) {
      if ((statusOvr as any).factory != null) (merged as any).factory = (statusOvr as any).factory;
      if ((statusOvr as any).status != null) (merged as any).status = (statusOvr as any).status;
    }

    if (forecastReportData) {
      (merged as any).lead_time = (forecastReportData as any).lead_time;
      (merged as any).buyer = (forecastReportData as any).buyer ?? (row as any).buyer;
      (merged as any).inventory_analyst =
        (forecastReportData as any).inventory_analyst ?? (row as any).inventory_analyst;
      (merged as any).country = (forecastReportData as any).country ?? (row as any).country;
    }

    // unit_cost fallback → forecast_main.landed_cost (same rule as the page).
    {
      const uc = Number((merged as any).unit_cost);
      const lc = landedCostMap.get(sku.trim());
      if ((!Number.isFinite(uc) || uc <= 0) && lc != null && lc > 0) (merged as any).unit_cost = lc;
    }

    // Product name — the ERP (erp_product_details) is authoritative, same as
    // the dashboard/exports (stored description drifts: stale "(Set of 4)" etc.).
    if (scNameMap.size > 0) {
      const scName = scNameMap.get(sku);
      if (scName) (merged as any).description = scName;
    }

    const hasManualMonthlyProjection = manual?.monthly_projection != null;
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
    const shouldRecomputeProjection = hasManualMonthlyProjection || hasAnyProjOverride;

    const rawOpt = manual?.forecast_option ?? 0;
    const optionNum = Math.min(4, Math.max(0, Number.isFinite(Number(rawOpt)) ? Number(rawOpt) : 1));

    merged = recomputeForecastRow(
      merged,
      monthlySaleMap,
      shouldRecomputeProjection,
      hasAnyProjOverride ? projOvr : null,
      hasAnySupplyOverride ? supplyOvr : null,
      optionNum,
    );

    return merged;
  });

  const orderNowItems = recomputedItems.filter((item) => (item as any).action === 'Order Now');


  // ── STEP 5: per-recipient row selection ──
  // Scheduled-email policy (NOT the manual planner "Send Email Report"):
  //   each buyer receives ONLY their assigned factories, narrowed to
  //   Action = Urgent AND pu_status = Active. The persisted UI filter
  //   snapshot is intentionally IGNORED here so the scheduled report is
  //   deterministic per recipient — independent of whatever the buyer was
  //   browsing in the planner dialog earlier.
  //
  // The same canonical filter is applied to every recipient, then their
  // factory allowlist scopes the result. Rows must satisfy all three:
  //   factory ∈ recipient's assigned factories
  //   computed action tier == "Urgent"
  //   pu_status canonical == "Active"
  const SCHEDULED_FILTERS: IdpFilterState = {
    ...EMPTY_FILTERS,
    action: ['Urgent'],
    pu_status: ['Active'],
  };
  const SCHEDULED_FILTER_SUMMARY = summarizeFilters(SCHEDULED_FILTERS, '');

  // Apply the canonical filter once; per-recipient we just scope by factory.
  const scheduledBase = applyIdpFilters(recomputedItems, SCHEDULED_FILTERS, '');

  const itemsByEmail: Record<string, Record<string, unknown>[]> = {};
  const filterSummaryByEmail: Record<string, string> = {};
  for (const email of Object.keys(emailFactoryGroups)) {
    itemsByEmail[email] = [];
    filterSummaryByEmail[email] = SCHEDULED_FILTER_SUMMARY;
  }

  // Pre-normalize assignment lists so factory matching is whitespace-insensitive.
  const normalizedFactoryGroups: Record<string, Set<string>> = {};
  for (const [email, factories] of Object.entries(emailFactoryGroups)) {
    normalizedFactoryGroups[email] = new Set(factories.map((f) => String(f).trim()));
  }

  for (const email of Object.keys(emailFactoryGroups)) {
    const factorySet = normalizedFactoryGroups[email];
    const scoped = scheduledBase.filter((row) => {
      const f = String((row as any).factory || '').trim();
      return factorySet.has(f);
    });
    itemsByEmail[email] = scoped;
  }

  // ── STEP 6: send per email via n8n ──
  const rollingIncomingMonths = getRolling12MonthsStartingCurrent(new Date());
  const MONTH_ABBR = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const rollingMonthNames = rollingIncomingMonths.slice(0, 3).map(
    (m) => MONTH_ABBR[m.month - 1],
  ) as [string, string, string];
  const todayMs = Date.now();

  let successCount = 0;
  let failCount = 0;
  let totalItemsSent = 0;

  for (const [email, emailItems] of Object.entries(itemsByEmail)) {
    const factoriesInEmail = emailFactoryGroups[email] || [];
    if (factoriesInEmail.length === 0) {
      continue;
    }

    const factoryCounts = factoriesInEmail.reduce<Record<string, number>>((acc, f) => {
      acc[f] = 0;
      return acc;
    }, {});
    for (const it of emailItems) {
      const f = String((it as any).factory || 'Unknown').trim();
      if (!factoryCounts[f]) factoryCounts[f] = 0;
      factoryCounts[f] += 1;
    }

    // Per-recipient factory summary — inline HTML table, no external asset
    // upload. Aggregates only THIS recipient's emailItems (already filtered
    // to their assigned factories upstream). Removes the canvas → Supabase
    // Storage → public-URL hop that was the failure point for image
    // rendering across some mail clients.
    const factoryStatsRows = buildFactoryRowStats(emailItems, factoriesInEmail);
    const factorySummaryHtml = buildFactorySummaryHtml(factoryStatsRows);

    try {
      // CSV is the canonical attachment. Build from the same row set the UI
      // would render for these factories — buildIdpCsv internally derives
      // every cell via buildIdpExportRow, so columns/order/values/computed
      // formulas exactly match the planner table.
      // Styled XLSX is the attachment. The email body itself stays
      // executive-summary lite — no inline detail table — so recipients
      // open the XLSX for the full dashboard snapshot.
      const xlsxResult = await buildIdpXlsx(emailItems, {
        monthNames: rollingMonthNames,
        todayMs,
      });
      const base64 = arrayBufferToBase64(xlsxResult.buffer);

      const currentDate = new Date();
      const formattedDate = currentDate.toLocaleDateString('en-US', {
        month: '2-digit',
        day: '2-digit',
        year: 'numeric',
      });
      const formattedTime = currentDate.toLocaleTimeString('en-US', {
        hour: '2-digit',
        minute: '2-digit',
        hour12: true,
      });

      const actionLabel = 'Urgent!';
      // Per-recipient deep link: pre-applies Action=Order Now plus the
      // recipient's assigned factories so the planner shows exactly the rows
      // the email is about. Factory codes are encoded individually then joined
      // with literal commas (matching the URL-param parser, which splits on
      // commas before decoding).
      const factoryParam = factoriesInEmail.map(encodeURIComponent).join(',');
      const reviewActionUrl =
        'https://demo.example.invalid/inventory-planner?action=Urgent' +
        (factoryParam ? `&factory=${factoryParam}` : '');
      // HTML-escape '&' for use inside an href attribute.
      const reviewActionHref = reviewActionUrl.replace(/&/g, '&amp;');
      // Filename uses MMDDYYYY (no separators) per spec.
      const filenameDate = `${String(currentDate.getMonth() + 1).padStart(2, '0')}${String(currentDate.getDate()).padStart(2, '0')}${currentDate.getFullYear()}`;
      const chartHtml = factorySummaryHtml;

      const emailMessage = `<div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Helvetica Neue', Arial, sans-serif; line-height: 1.5; color: #5f6368; background: #ffffff;">

<p style="margin: 0 0 12px 0; font-size: 14px; color: #5f6368;">Dear Team,</p>

<p style="margin: 0 0 16px 0; font-size: 14px; color: #5f6368;">Attached is the Purchasing Demand Planner generated on ${formattedDate}.</p>

<!-- Report Summary -->
<p style="margin: 0 0 6px 0; font-size: 14px; color: #5f6368;">📊 <strong style="color: #202124;">Report Summary:</strong></p>
<p style="margin: 0 0 3px 0; font-size: 14px; color: #5f6368; padding-left: 20px;">📦 <strong style="color: #202124;">${emailItems.length}</strong> SKUs requiring immediate action (${actionLabel})</p>
<p style="margin: 0 0 16px 0; font-size: 14px; color: #5f6368; padding-left: 20px;">🏭 <strong style="color: #202124;">${factoriesInEmail.length}</strong> factories involved</p>

<!-- Factory Summary Title -->
<h2 style="margin: 0 0 10px 0; font-size: 15px; font-weight: 600; color: #202124;">Factory Summary — Order Now</h2>

<!-- Factory Table -->
<table cellpadding="0" cellspacing="0" border="0" style="width: 100%; max-width: 800px; border-collapse: collapse; margin-bottom: 16px; border: 1px solid #dadce0;">
  <thead>
    <tr style="background: #4a3228;">
      <th style="padding: 8px 12px; text-align: left; font-size: 12px; font-weight: 600; color: #ffffff; border-right: 1px solid rgba(255,255,255,0.1); white-space: nowrap;">Factory</th>
      <th style="padding: 8px 12px; text-align: center; font-size: 12px; font-weight: 600; color: #ffffff; border-right: 1px solid rgba(255,255,255,0.1); white-space: nowrap;">SKUs</th>
      <th style="padding: 8px 12px; text-align: center; font-size: 12px; font-weight: 600; color: #ffffff; border-right: 1px solid rgba(255,255,255,0.1); white-space: nowrap;">Lead time</th>
      <th style="padding: 8px 12px; text-align: center; font-size: 12px; font-weight: 600; color: #ffffff; border-right: 1px solid rgba(255,255,255,0.1); white-space: nowrap;">Deficit</th>
      <th style="padding: 8px 12px; text-align: center; font-size: 12px; font-weight: 600; color: #ffffff; border-right: 1px solid rgba(255,255,255,0.1); white-space: nowrap;">Runs out before delivery</th>
      <th style="padding: 8px 12px; text-align: center; font-size: 12px; font-weight: 600; color: #ffffff; border-right: 1px solid rgba(255,255,255,0.1); white-space: nowrap;">Order by</th>
      <th style="padding: 8px 12px; text-align: center; font-size: 12px; font-weight: 600; color: #ffffff; white-space: nowrap;">Action</th>
    </tr>
  </thead>
  <tbody>
${chartHtml || '<tr><td colspan="7" style="padding: 16px; text-align: center; color: #80868b; font-size: 14px; background: #f8f9fa;">No factory data available</td></tr>'}
  </tbody>
</table>

<!-- Action Button -->
<a href="${reviewActionHref}"
   style="display: inline-block; padding: 10px 20px; background: #ea4335; color: #ffffff; font-size: 14px; font-weight: 600; text-decoration: none; border-radius: 4px; margin-bottom: 16px;">
  Review &amp; Take Action →
</a>

<p style="margin: 16px 0 6px 0; font-size: 14px; color: #5f6368;">Please review and reach out with any questions.</p>

<p style="margin: 16px 0 6px 0; font-size: 14px; color: #5f6368;">Best regards,</p>

<!-- Signature with Logo -->
<table cellpadding="0" cellspacing="0" border="0" style="margin-top: 12px;">
  <tr>
    <td style="padding-right: 14px; vertical-align: middle;">
      <img src="/procure/logo.png" alt="Northwind Motor Parts" width="60" height="60" style="display: block; border-radius: 50%; background: #4a3228; padding: 6px;" />
    </td>
    <td style="vertical-align: middle; border-left: 2px solid #dadce0; padding-left: 14px;">
      <p style="margin: 0 0 3px 0; font-size: 15px; font-weight: 600; color: #202124;">Purchasing Team</p>
      <p style="margin: 0 0 6px 0; font-size: 14px; color: #5f6368;">E <a href="mailto:admin@northwindparts.example" style="color: #1a73e8; text-decoration: none;">admin@northwindparts.example</a></p>
      <p style="margin: 0; font-size: 14px; color: #202124; font-weight: 600;">northwindparts.example</p>
    </td>
  </tr>
</table>

</div>`;

      const payload = {
        email_to: email,
        factories: factoriesInEmail,
        filename: `purchasing_report_${filenameDate}.xlsx`,
        filedata: base64,
        filetype: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        subject: `📊 Purchasing Demand Planner`,
        message: emailMessage,
        item_count: emailItems.length,
        action_filter: 'Order Now',
        factory_count: factoriesInEmail.length,
        factory_item_counts: factoryCounts,
      };


      const response = await fetch(N8N_WEBHOOK_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        throw new Error(`n8n webhook failed: ${response.statusText}`);
      }

      successCount++;
      totalItemsSent += emailItems.length;
    } catch (e: any) {
      failCount++;
    }
  }

  return {
    ok: successCount > 0,
    successCount,
    failCount,
    totalItemsSent,
    emails: Object.keys(itemsByEmail).length,
  };
}
