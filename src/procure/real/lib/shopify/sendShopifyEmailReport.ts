/**
 * Storefront Stock Email Report Sender
 *
 * Data source: forecast_report WHERE shopify_status ilike 'not listed'
 * This matches the manual "Send Email Report" button in MonthlyForecast.tsx exactly.
 *
 * CRITICAL: Webhook URL is hardcoded — do not use env vars (causes fallback issues).
 */

import { externalSupabase as supabase } from '@/integrations/supabase/externalClient';
import { buildShopifyInventoryXlsx, arrayBufferToBase64, shopifyInventoryXlsxFilename } from '@/lib/forecast/shopifyInventoryXlsx';

const SHOPIFY_WEBHOOK_URL = 'https://automation.example.invalid/webhook/shopify-inventory-report';

const SHOPIFY_BUILD_VERSION = '2026-06-08-v10';

export interface SendShopifyEmailReportResult {
  ok: boolean;
  successCount: number;
  failCount: number;
  totalItemsSent: number;
  emails: number;
  reason?: string;
  lastError?: string;
}

function log(...args: unknown[]) { console.log('[ShopifyAutoSend]', ...args); }
function warn(...args: unknown[]) { console.warn('[ShopifyAutoSend]', ...args); }
function err(...args: unknown[]) { console.error('[ShopifyAutoSend]', ...args); }

const SELECT_COLS = 'sku,description,factory,shopify_status,fba_reserved,intransit_fba,fba,oh_inv,otw_units,on_order_units,po_in_progress';
const PAGE = 1000;

export async function sendShopifyEmailReport(): Promise<SendShopifyEmailReportResult> {

  // ── STEP 1: Get email → factory mapping ──
  const { data: mappings, error: mapErr } = await (supabase as any)
    .from('email_factory_mapping')
    .select('*')
    .eq('report_type', 'shopify')
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
    if (factory && factory !== 'UNASSIGNED') emailFactoryGroups[email].push(factory);
  }

  if (Object.keys(emailFactoryGroups).length === 0) {
    return { ok: false, successCount: 0, failCount: 0, totalItemsSent: 0, emails: 0, reason: 'no_recipients' };
  }

  // ── STEP 2: Fetch ALL forecast_report rows in PARALLEL pages ──
  // PostgREST misinterprets '-' in .or('shopify_status.eq.-,...'), so we fetch all
  // rows and apply the same filter MonthlyForecast uses in the browser.
  // Optimization #2: count first, then fetch all pages concurrently.
  let allItems: Record<string, unknown>[] = [];
  {
    const { count, error: countErr } = await (supabase as any)
      .from('forecast_report')
      .select('*', { count: 'exact', head: true });

    if (countErr) {
      return { ok: false, successCount: 0, failCount: 0, totalItemsSent: 0, emails: 0, reason: 'data_query_failed' };
    }

    const totalPages = Math.ceil((count ?? 0) / PAGE);

    const pageResults = await Promise.all(
      Array.from({ length: totalPages }, (_, i) =>
        (supabase as any)
          .from('forecast_report')
          .select(SELECT_COLS)
          .order('sku', { ascending: true })
          .range(i * PAGE, (i + 1) * PAGE - 1)
      )
    );

    for (const { data, error } of pageResults) {
      if (error) {
        return { ok: false, successCount: 0, failCount: 0, totalItemsSent: 0, emails: 0, reason: 'data_query_failed' };
      }
      if (data) allItems = allItems.concat(data as any[]);
    }

    // Filter 1: shopify_status = "Not listed" (same as the MonthlyForecast dialog/handler)
    allItems = allItems.filter(item => {
      const s = String((item as any).shopify_status ?? '').trim().toLowerCase();
      return s === 'not listed';
    });

    // Filter 2: skip rows where ALL inventory bucket columns are null/0 (nothing to report)
    const INV_COLS = ['oh_inv', 'otw_units', 'on_order_units', 'po_in_progress'];
    allItems = allItems.filter(item =>
      INV_COLS.some(col => ((item as any)[col] ?? 0) !== 0)
    );

  }

  if (allItems.length === 0) {
    return { ok: false, successCount: 0, failCount: 0, totalItemsSent: 0, emails: 0, reason: 'no_data' };
  }

  // ── STEP 3: Route items to each email recipient by factory ──
  // Optimization #3: pre-build factory→emails Map for O(1) lookup per item.
  const factoryToEmails = new Map<string, string[]>();
  for (const [email, factories] of Object.entries(emailFactoryGroups)) {
    for (const factory of factories) {
      if (!factoryToEmails.has(factory)) factoryToEmails.set(factory, []);
      factoryToEmails.get(factory)!.push(email);
    }
  }

  const itemsByEmail: Record<string, typeof allItems> = {};
  const unroutedItems: typeof allItems = [];

  for (const email of Object.keys(emailFactoryGroups)) {
    itemsByEmail[email] = [];
  }

  for (const item of allItems) {
    const factory = String((item as any).factory || '');
    const recipients = factoryToEmails.get(factory);

    if (!recipients || recipients.length === 0) {
      unroutedItems.push(item);
    } else {
      for (const email of recipients) itemsByEmail[email].push(item);
    }
  }

  if (unroutedItems.length > 0) {
    for (const email of Object.keys(itemsByEmail)) {
      for (const item of unroutedItems) itemsByEmail[email].push(item);
    }
  }

  // ── STEP 4: Build and send reports in PARALLEL ──
  // Optimization #1: all recipients' XLSX builds + webhook POSTs run concurrently.
  // Remap on_order_units → oo_units and normalize shopify_status for the xlsx builder.
  const toXlsxRow = (item: Record<string, unknown>) => {
    const rawStatus = String((item as any).shopify_status ?? '').trim();
    return {
      ...item,
      oo_units: item.on_order_units,
      shopify_status: (rawStatus === '' || rawStatus === '-') ? 'Inactive' : rawStatus,
    };
  };

  const buildShopifyXlsx = async (items: typeof allItems): Promise<string> => {
    const result = await buildShopifyInventoryXlsx(items.map(toXlsxRow), { todayMs: Date.now() });
    return arrayBufferToBase64(result.buffer);
  };

  const currentDate = new Date();
  const formattedDate = currentDate.toLocaleDateString('en-US', { month: '2-digit', day: '2-digit', year: 'numeric' });

  const sendResults = await Promise.all(
    Object.entries(itemsByEmail).map(async ([email, emailItems]) => {
      const factoriesInEmail = emailFactoryGroups[email] || [];

      if (factoriesInEmail.length === 0) {
        return { success: false, skipped: true, itemCount: 0, error: '' };
      }

      if (emailItems.length === 0) {
        return { success: false, skipped: true, itemCount: 0, error: '' };
      }

      try {
        const excelBase64 = await buildShopifyXlsx(emailItems);

        const payload = {
          source: 'shopify_inventory',
          email,
          subject: `📊 Storefront Stock Report`,
          message: buildEmailHtml(emailItems, factoriesInEmail, formattedDate),
          excelBase64,
          excelFilename: shopifyInventoryXlsxFilename(currentDate),
          timestamp: currentDate.toISOString(),
          itemCount: emailItems.length,
          factoryCount: factoriesInEmail.length,
        };


        const resp = await fetch(SHOPIFY_WEBHOOK_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });

        if (resp.ok) {
          return { success: true, skipped: false, itemCount: emailItems.length, error: '' };
        } else {
          const txt = await resp.text();
          const error = `HTTP ${resp.status}: ${txt.slice(0, 200)}`;
          return { success: false, skipped: false, itemCount: 0, error };
        }
      } catch (e: any) {
        const error = String(e?.message || e);
        return { success: false, skipped: false, itemCount: 0, error };
      }
    })
  );

  let successCount = 0;
  let failCount = 0;
  let totalItemsSent = 0;
  let lastError = '';

  for (const r of sendResults) {
    if (r.skipped) continue;
    if (r.success) {
      successCount++;
      totalItemsSent += r.itemCount;
    } else {
      failCount++;
      if (r.error) lastError = r.error;
    }
  }


  return {
    ok: successCount > 0,
    successCount,
    failCount,
    totalItemsSent,
    emails: Object.keys(emailFactoryGroups).length,
    lastError: lastError || undefined,
  };
}

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

function buildEmailHtml(
  items: Record<string, unknown>[],
  factoriesInEmail: string[],
  formattedDate: string,
): string {
  const factoryStats: Record<string, { skuCount: number; totalOH: number; totalOTW: number; totalOO: number }> = {};
  for (const f of factoriesInEmail) {
    factoryStats[f] = { skuCount: 0, totalOH: 0, totalOTW: 0, totalOO: 0 };
  }
  for (const item of items) {
    const factory = String((item as any).factory || '');
    if (factoryStats[factory]) {
      factoryStats[factory].skuCount++;
      factoryStats[factory].totalOH += Number((item as any).oh_inv) || 0;
      factoryStats[factory].totalOTW += Number((item as any).otw_units) || 0;
      factoryStats[factory].totalOO += Number((item as any).on_order_units) || 0;
    }
  }

  const factoryRows = factoriesInEmail
    .filter(f => factoryStats[f].skuCount > 0)
    .map(factory => {
      const s = factoryStats[factory];
      return `
    <tr style="border-bottom: 1px solid #dadce0;">
      <td style="padding: 8px 12px; font-size: 13px; color: #202124; border-right: 1px solid #dadce0;">${esc(factory)}</td>
      <td style="padding: 8px 12px; text-align: center; font-size: 13px; color: #202124; border-right: 1px solid #dadce0;">${s.skuCount}</td>
      <td style="padding: 8px 12px; text-align: center; font-size: 13px; color: #202124; border-right: 1px solid #dadce0;">${s.totalOH.toLocaleString()}</td>
      <td style="padding: 8px 12px; text-align: center; font-size: 13px; color: #202124; border-right: 1px solid #dadce0;">${s.totalOTW.toLocaleString()}</td>
      <td style="padding: 8px 12px; text-align: center; font-size: 13px; color: #202124;">${s.totalOO.toLocaleString()}</td>
    </tr>`;
    })
    .join('');

  const reviewHref = 'https://demo.example.invalid/monthly-forecast?view=shopify';

  return `<div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Helvetica Neue', Arial, sans-serif; line-height: 1.5; color: #5f6368; background: #ffffff;">

<p style="margin: 0 0 12px 0; font-size: 14px; color: #5f6368;">Dear Team,</p>

<p style="margin: 0 0 16px 0; font-size: 14px; color: #5f6368;">Attached is the Storefront Stock Report generated on ${formattedDate}.</p>

<p style="margin: 0 0 6px 0; font-size: 14px; color: #5f6368;">📊 <strong style="color: #202124;">Report Summary:</strong></p>
<p style="margin: 0 0 3px 0; font-size: 14px; color: #5f6368; padding-left: 20px;">📦 <strong style="color: #202124;">${items.length}</strong> SKUs in Storefront Stock</p>
<p style="margin: 0 0 16px 0; font-size: 14px; color: #5f6368; padding-left: 20px;">🏭 <strong style="color: #202124;">${factoriesInEmail.length}</strong> factories involved</p>

<h2 style="margin: 0 0 10px 0; font-size: 15px; font-weight: 600; color: #202124;">Factory Summary — Storefront Stock</h2>

<table cellpadding="0" cellspacing="0" border="0" style="width: 100%; max-width: 800px; border-collapse: collapse; margin-bottom: 16px; border: 1px solid #dadce0;">
  <thead>
    <tr style="background: #0c4849;">
      <th style="padding: 8px 12px; text-align: left; font-size: 12px; font-weight: 600; color: #ffffff; border-right: 1px solid rgba(255,255,255,0.1); white-space: nowrap;">Factory</th>
      <th style="padding: 8px 12px; text-align: center; font-size: 12px; font-weight: 600; color: #ffffff; border-right: 1px solid rgba(255,255,255,0.1); white-space: nowrap;">SKUs</th>
      <th style="padding: 8px 12px; text-align: center; font-size: 12px; font-weight: 600; color: #ffffff; border-right: 1px solid rgba(255,255,255,0.1); white-space: nowrap;">OH Inv</th>
      <th style="padding: 8px 12px; text-align: center; font-size: 12px; font-weight: 600; color: #ffffff; border-right: 1px solid rgba(255,255,255,0.1); white-space: nowrap;">OTW Units</th>
      <th style="padding: 8px 12px; text-align: center; font-size: 12px; font-weight: 600; color: #ffffff; white-space: nowrap;">OO Units</th>
    </tr>
  </thead>
  <tbody>
${factoryRows || '<tr><td colspan="5" style="padding: 16px; text-align: center; color: #80868b; font-size: 14px; background: #f8f9fa;">No factory data available</td></tr>'}
  </tbody>
</table>

<a href="${reviewHref}"
   style="display: inline-block; padding: 10px 20px; background: #0c4849; color: #ffffff; font-size: 14px; font-weight: 600; text-decoration: none; border-radius: 4px; margin-bottom: 16px;">
  Review Storefront Stock →
</a>

<p style="margin: 16px 0 6px 0; font-size: 14px; color: #5f6368;">Please review and reach out with any questions.</p>

<p style="margin: 16px 0 6px 0; font-size: 14px; color: #5f6368;">Best regards,</p>

<table cellpadding="0" cellspacing="0" border="0" style="margin-top: 12px;">
  <tr>
    <td style="padding-right: 14px; vertical-align: middle;">
      <img src="/procure/logo.png" alt="Northwind Motor Parts" width="60" height="60" style="display: block; border-radius: 50%; background: #0c4849; padding: 6px;" />
    </td>
    <td style="vertical-align: middle; border-left: 2px solid #dadce0; padding-left: 14px;">
      <p style="margin: 0 0 3px 0; font-size: 15px; font-weight: 600; color: #202124;">Purchasing Team</p>
      <p style="margin: 0 0 6px 0; font-size: 14px; color: #5f6368;">E <a href="mailto:admin@northwindparts.example" style="color: #1a73e8; text-decoration: none;">admin@northwindparts.example</a></p>
      <p style="margin: 0; font-size: 14px; color: #202124; font-weight: 600;">northwindparts.example</p>
    </td>
  </tr>
</table>

</div>`;
}
