/**
 * Renders a per-factory summary TABLE as a PNG and uploads it to Supabase
 * storage at avatars/factory_chart.png (upsert, cache-busted via querystring).
 *
 * Used by the email send pipeline. Columns:
 *   Factory | SKUs | Lead time | Deficit | Runs out before delivery | Action | Order by
 */

import { externalSupabase as supabase } from '@/integrations/supabase/externalClient';

const STORAGE_BUCKET = 'avatars';
const STORAGE_PATH = 'factory_chart.png';

export interface FactoryRowStats {
  factory: string;
  skus: number;
  /** Average lead time in days for that factory's Order Now rows (rounded). */
  avgLeadTime: number | null;
  /** Count of SKUs where ninetyDayDeficit < 0. */
  deficitCount: number;
  /** Count of SKUs where deficit >= 0 but daysUntilDeficit < leadTimeDays. */
  runsOutBeforeDeliveryCount: number;
}

/**
 * Build the per-factory table stats from already-recomputed order-now rows.
 * Pass `assignedFactories` to include every assigned factory in the output
 * even when it has 0 urgent SKUs — ensures all assigned vendors appear.
 */
export function buildFactoryRowStats(
  orderNowItems: Record<string, unknown>[],
  assignedFactories?: string[],
): FactoryRowStats[] {
  type Acc = {
    skus: number;
    leadTimes: number[];
    deficitCount: number;
    runsOutBeforeDeliveryCount: number;
  };
  const byFactory = new Map<string, Acc>();

  // Seed all assigned factories so they appear even with 0 urgent SKUs.
  if (assignedFactories) {
    for (const f of assignedFactories) {
      const key = String(f).trim();
      if (key && !byFactory.has(key)) {
        byFactory.set(key, { skus: 0, leadTimes: [], deficitCount: 0, runsOutBeforeDeliveryCount: 0 });
      }
    }
  }

  const toNum = (v: unknown): number | null => {
    if (v == null) return null;
    if (typeof v === 'number') return Number.isFinite(v) ? v : null;
    if (typeof v === 'string') {
      const n = Number(v.replace(/,/g, ''));
      return Number.isFinite(n) ? n : null;
    }
    return null;
  };

  for (const row of orderNowItems) {
    const factory = String((row as any).factory || 'Unknown');
    const lead = toNum((row as any).lead_time);
    const ninetyDayDeficit = toNum((row as any).ninety_day_deficit) ?? 0;
    const ninetyDayProjection = toNum((row as any).ninety_day_projection) ?? 0;
    const dailySales = ninetyDayProjection / 90;

    if (!byFactory.has(factory)) {
      byFactory.set(factory, { skus: 0, leadTimes: [], deficitCount: 0, runsOutBeforeDeliveryCount: 0 });
    }
    const acc = byFactory.get(factory)!;
    acc.skus += 1;
    if (lead != null) acc.leadTimes.push(lead);

    if (ninetyDayDeficit < 0) {
      acc.deficitCount += 1;
    } else if (lead != null && dailySales > 0) {
      const daysUntilDeficit = ninetyDayDeficit / dailySales;
      if (daysUntilDeficit < lead) {
        acc.runsOutBeforeDeliveryCount += 1;
      }
    }
  }

  return Array.from(byFactory.entries())
    .map(([factory, acc]) => ({
      factory,
      skus: acc.skus,
      avgLeadTime:
        acc.leadTimes.length > 0
          ? Math.round(acc.leadTimes.reduce((s, n) => s + n, 0) / acc.leadTimes.length)
          : null,
      deficitCount: acc.deficitCount,
      runsOutBeforeDeliveryCount: acc.runsOutBeforeDeliveryCount,
    }))
    .sort((a, b) => b.skus - a.skus);
}

function drawTable(rows: FactoryRowStats[]): HTMLCanvasElement {
  const colDefs = [
    { key: 'factory', label: 'Factory', width: 130, align: 'left' as const },
    { key: 'skus', label: 'SKUs', width: 70, align: 'center' as const },
    { key: 'leadTime', label: 'Lead time', width: 90, align: 'center' as const },
    { key: 'deficit', label: 'Deficit', width: 80, align: 'center' as const },
    { key: 'runsOut', label: 'Runs out before delivery', width: 180, align: 'center' as const },
    { key: 'orderBy', label: 'Order by', width: 110, align: 'center' as const },
    { key: 'action', label: 'Action', width: 90, align: 'center' as const },
  ];

  const headerHeight = 36;
  const rowHeight = 28;
  const titleHeight = 40;
  const padX = 16;
  const tableWidth = colDefs.reduce((s, c) => s + c.width, 0);
  const width = tableWidth + padX * 2;
  const height = titleHeight + headerHeight + Math.max(1, rows.length) * rowHeight + 16;

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('canvas 2d context unavailable');

  // Background
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, width, height);

  // Title
  ctx.fillStyle = '#1f1f1f';
  ctx.font = 'bold 16px Arial, sans-serif';
  ctx.textBaseline = 'top';
  ctx.textAlign = 'left';
  ctx.fillText('Factory Summary — Order Now', padX, 12);

  // Header row
  const headerY = titleHeight;
  ctx.fillStyle = '#4a3228';
  ctx.fillRect(padX, headerY, tableWidth, headerHeight);

  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 12px Arial, sans-serif';
  ctx.textBaseline = 'middle';
  let cursorX = padX;
  for (const col of colDefs) {
    const textX =
      col.align === 'left' ? cursorX + 8 : col.align === 'center' ? cursorX + col.width / 2 : cursorX + col.width - 8;
    ctx.textAlign = col.align;
    ctx.fillText(col.label, textX, headerY + headerHeight / 2);
    cursorX += col.width;
  }

  // Empty-state
  if (rows.length === 0) {
    ctx.fillStyle = '#888';
    ctx.font = '13px Arial, sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText('No factories with Order Now items.', padX, headerY + headerHeight + 12);
    return canvas;
  }

  // Body rows
  ctx.font = '12px Arial, sans-serif';
  rows.forEach((row, i) => {
    const y = headerY + headerHeight + i * rowHeight;

    // Zebra background
    if (i % 2 === 1) {
      ctx.fillStyle = '#f6f3f1';
      ctx.fillRect(padX, y, tableWidth, rowHeight);
    }

    ctx.fillStyle = '#1f1f1f';
    ctx.textBaseline = 'middle';

    const leadTimeText = row.avgLeadTime != null ? `${row.avgLeadTime} days` : '—';
    const cells = [
      row.factory,
      String(row.skus),
      leadTimeText,
      String(row.deficitCount),
      String(row.runsOutBeforeDeliveryCount),
      'Order Today',
      'Urgent',
    ];

    let cX = padX;
    for (let cIdx = 0; cIdx < colDefs.length; cIdx++) {
      const col = colDefs[cIdx];
      const text = cells[cIdx];

      // Highlight the Action cell
      if (col.key === 'action') {
        ctx.fillStyle = '#EF4444';
        ctx.fillRect(cX + 8, y + 4, col.width - 16, rowHeight - 8);
        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 11px Arial, sans-serif';
      } else {
        ctx.fillStyle = '#1f1f1f';
        ctx.font = col.key === 'factory' ? 'bold 12px Arial, sans-serif' : '12px Arial, sans-serif';
      }

      const textX =
        col.align === 'left' ? cX + 8 : col.align === 'center' ? cX + col.width / 2 : cX + col.width - 8;
      ctx.textAlign = col.align;
      ctx.fillText(text, textX, y + rowHeight / 2);
      cX += col.width;
    }

    // Bottom row border
    ctx.strokeStyle = '#e5e0dc';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(padX, y + rowHeight);
    ctx.lineTo(padX + tableWidth, y + rowHeight);
    ctx.stroke();
  });

  // Outer table border
  ctx.strokeStyle = '#4a3228';
  ctx.lineWidth = 1;
  ctx.strokeRect(padX, headerY, tableWidth, headerHeight + rows.length * rowHeight);

  return canvas;
}

async function canvasToPngBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (b) => {
        if (b) resolve(b);
        else reject(new Error('canvas.toBlob returned null'));
      },
      'image/png',
    );
  });
}

function slugifyEmail(email: string): string {
  return email
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 80);
}

/**
 * Renders the factory-summary table and uploads it to a per-recipient path so
 * each email shows only its own factories. Returns the public URL with a
 * cache-buster querystring. `recipientSlug` should uniquely identify the
 * recipient — typically the slugified email address.
 */
export async function buildAndUploadFactoryChart(
  orderNowItems: Record<string, unknown>[],
  recipientSlug?: string,
): Promise<string> {
  const rows = buildFactoryRowStats(orderNowItems);
  const canvas = drawTable(rows);
  const blob = await canvasToPngBlob(canvas);

  const path = recipientSlug
    ? STORAGE_PATH.replace(/\.png$/i, `_${recipientSlug}.png`)
    : STORAGE_PATH;

  const { error } = await (supabase as any).storage
    .from(STORAGE_BUCKET)
    .upload(path, blob, {
      contentType: 'image/png',
      upsert: true,
      cacheControl: '60',
    });

  if (error) {
    throw error;
  }

  const { data } = (supabase as any).storage
    .from(STORAGE_BUCKET)
    .getPublicUrl(path);

  const publicUrl: string = data?.publicUrl || '';
  // Cache-buster so Gmail / Outlook don't serve a stale chart.
  return `${publicUrl}?t=${Date.now()}`;
}

/** Exported for callers that want to derive the recipient slug consistently. */
export { slugifyEmail };

/**
 * Render the factory summary as an inline-styled HTML table for email bodies.
 *
 * Replaces the canvas → PNG → Supabase Storage → public-URL chain with a
 * self-contained `<table>`, removing the storage dependency entirely. Works
 * in Outlook, Gmail, Apple Mail with no external assets, no image-blocking
 * surprises, and no per-recipient upload churn.
 *
 * Build the rows via `buildFactoryRowStats(orderNowItems)` and pass them in.
 */
export function buildFactorySummaryHtml(rows: FactoryRowStats[]): string {
  if (rows.length === 0) return '';

  const escapeHtml = (s: string) =>
    String(s ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');

  const TD = 'padding:6px 10px;font-size:12px;border-bottom:1px solid #dadce0;border-right:1px solid #dadce0;white-space:nowrap;';
  const TDC = TD + 'text-align:center;color:#5f6368;';

  const bodyRows = rows
    .map((r, idx) => {
      const bg = idx % 2 === 0 ? '#fff' : '#f8f9fa';
      const lt = r.avgLeadTime != null ? `${r.avgLeadTime} days` : '—';
      const actionCell = r.skus > 0
        ? `<span style="display:inline-block;padding:3px 10px;background:#ea4335;color:#fff;font-size:11px;font-weight:600;border-radius:3px;">Urgent</span>`
        : `<span style="color:#9aa0a6;">—</span>`;
      return `<tr style="background:${bg};"><td style="${TD}color:#202124;">${escapeHtml(r.factory)}</td><td style="${TDC}">${r.skus}</td><td style="${TDC}">${lt}</td><td style="${TDC}">${r.deficitCount}</td><td style="${TDC}">${r.runsOutBeforeDeliveryCount}</td><td style="${TDC}">${r.skus > 0 ? 'Order Today' : '—'}</td><td style="padding:6px 10px;text-align:center;border-bottom:1px solid #dadce0;white-space:nowrap;">${actionCell}</td></tr>`;
    })
    .join('\n');

  // Return just the tbody rows - the table structure is in the email template
  return bodyRows;
}
