/**
 * ⚠️  MIRROR FILE — DO NOT EDIT INDEPENDENTLY ⚠️
 *
 * Mirrors `generateInventoryReportWorkbook` from
 * src/pages/MonthlyForecast.tsx (~lines 6156-6292).
 *
 * Used by the background email auto-send pipeline. Keep in sync.
 */

export interface RollingMonth {
  month: number;
  year: number;
}

export function getRolling12MonthsStartingCurrent(now: Date): RollingMonth[] {
  const out: RollingMonth[] = [];
  for (let i = 0; i < 12; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() + i, 1);
    out.push({ month: d.getMonth() + 1, year: d.getFullYear() });
  }
  return out;
}

export async function buildInventoryReportWorkbook(
  itemsToExport: Record<string, unknown>[],
  rollingIncomingMonths: RollingMonth[],
) {
  const ExcelJS = (await import('exceljs')).default;

  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet('Reorder Decisions');

  const monthNames = rollingIncomingMonths.slice(0, 3).map((m) => {
    const monthName = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][m.month - 1];
    return monthName;
  });

  const columns = [
    { key: 'sku', label: 'Product Name', width: 20, bg: 'FFEAF2FF', group: 'basic' },
    { key: 'description', label: 'Product ID', width: 20, bg: 'FFEAF2FF', group: 'basic' },
    { key: 'priority_level', label: 'Level of\nPriority', width: 12, bg: 'FFEAF2FF', group: 'basic' },
    { key: 'factory', label: 'Factory', width: 12, bg: 'FFEAF2FF', group: 'basic' },
    { key: 'status', label: 'Status', width: 12, bg: 'FFEAF2FF', group: 'basic' },
    { key: 'kit', label: 'Kit', width: 10, bg: 'FFEAF2FF', group: 'basic' },
    { key: 'category', label: 'Category', width: 12, bg: 'FFEAF2FF', group: 'basic' },
    { key: 'country', label: 'Country', width: 12, bg: 'FFEAF2FF', group: 'basic' },
    { key: 'buyer', label: 'Buyer', width: 12, bg: 'FFEAF2FF', group: 'basic' },
    { key: 'inventory_analyst', label: 'Inventory\nAnalyst', width: 15, bg: 'FFEAF2FF', group: 'basic' },
    { key: 'proj_month_1', label: monthNames[0], width: 10, bg: 'FFFFF4CC', group: 'projection', isMonth: true },
    { key: 'proj_month_2', label: monthNames[1], width: 10, bg: 'FFFFF4CC', group: 'projection', isMonth: true },
    { key: 'proj_month_3', label: monthNames[2], width: 10, bg: 'FFFFF4CC', group: 'projection', isMonth: true },
    { key: 'supply_month_1', label: monthNames[0], width: 10, bg: 'FFE8D4FF', group: 'supply', isMonth: true },
    { key: 'supply_month_2', label: monthNames[1], width: 10, bg: 'FFE8D4FF', group: 'supply', isMonth: true },
    { key: 'supply_month_3', label: monthNames[2], width: 10, bg: 'FFE8D4FF', group: 'supply', isMonth: true },
    { key: 'ninety_day_projection', label: '90-Day\nProjection', width: 12, bg: 'FFD6CCFF', group: 'forecast' },
    { key: 'ninety_day_supply', label: '90-Day\nSupply', width: 12, bg: 'FFD6CCFF', group: 'forecast' },
    { key: 'ninety_day_deficit', label: '90-Day\nDeficit', width: 12, bg: 'FFD6CCFF', group: 'forecast' },
    { key: 'ninety_day_revenue_loss', label: '90-Day\nRevenue Loss', width: 14, bg: 'FFD6CCFF', group: 'forecast' },
    { key: 'safety_stock', label: 'Safety\nStock', width: 12, bg: 'FFD6CCFF', group: 'forecast' },
    { key: 'order_recommended', label: 'Order\nRecommended', width: 14, bg: 'FFD6CCFF', group: 'forecast' },
    { key: 'lead_time', label: 'Lead\nTime', width: 10, bg: 'FFD6CCFF', group: 'forecast' },
    { key: 'order_date_forecast', label: 'Order\nDate', width: 14, bg: 'FFD6CCFF', group: 'forecast' },
    { key: 'supply_month_forecast', label: 'Supply\nMonth', width: 14, bg: 'FFD6CCFF', group: 'forecast' },
    { key: 'covered_months', label: 'Covered\nMonths', width: 12, bg: 'FFD6CCFF', group: 'forecast' },
    { key: 'action', label: 'Action', width: 12, bg: 'FFD6CCFF', group: 'forecast' },
  ] as const;

  worksheet.columns = columns.map((col) => ({ width: col.width }));

  const sectionHeaders = [
    ...Array(10).fill(''),
    'Monthly Projection', '', '',
    'Supply Plan', '', '',
    '90-Day Forecast Analysis', '', '', '', '', '', '', '', '', '',
  ];
  const headerRow1 = worksheet.addRow(sectionHeaders);
  headerRow1.height = 20;
  headerRow1.eachCell((cell) => {
    cell.font = { bold: true, size: 11 };
    cell.alignment = { horizontal: 'center', vertical: 'middle' };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE0E0E0' } };
    cell.border = {
      top: { style: 'thin' },
      left: { style: 'thin' },
      bottom: { style: 'thin' },
      right: { style: 'thin' },
    };
  });

  worksheet.mergeCells(1, 11, 1, 13);
  worksheet.mergeCells(1, 14, 1, 16);
  worksheet.mergeCells(1, 17, 1, 27);

  const headerRow2 = worksheet.addRow(columns.map((col) => col.label));
  headerRow2.height = 30;
  headerRow2.eachCell((cell, colNum) => {
    const col = columns[colNum - 1];
    cell.font = { bold: true, size: 10 };
    cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: col.bg } };
    cell.border = {
      top: { style: 'thin' },
      left: { style: 'thin' },
      bottom: { style: 'thin' },
      right: { style: 'thin' },
    };
  });

  itemsToExport.forEach((row) => {
    const rowData = columns.map((col) => {
      const val = row[col.key];
      if (
        col.key === 'order_date_forecast' ||
        col.key === 'supply_month_forecast' ||
        col.key === 'covered_months'
      ) {
        return val ? new Date(val as string) : null;
      }
      return val ?? '';
    });

    const dataRow = worksheet.addRow(rowData);
    dataRow.eachCell((cell, colNum) => {
      const col = columns[colNum - 1];
      cell.alignment = { horizontal: 'center', vertical: 'middle' };
      cell.border = {
        top: { style: 'thin' },
        left: { style: 'thin' },
        bottom: { style: 'thin' },
        right: { style: 'thin' },
      };

      if (
        col.key === 'order_date_forecast' ||
        col.key === 'supply_month_forecast' ||
        col.key === 'covered_months'
      ) {
        cell.numFmt = 'mmm dd, yyyy';
      }

      if (col.key === 'ninety_day_revenue_loss' && typeof cell.value === 'number') {
        cell.numFmt = '$#,##0.00';
      } else if (typeof cell.value === 'number' && !(col as any).isMonth) {
        cell.numFmt = '#,##0';
      } else if (typeof cell.value === 'number' && (col as any).isMonth) {
        cell.numFmt = '#,##0';
      }

      if (typeof cell.value === 'number' && cell.value < 0) {
        cell.font = { color: { argb: 'FFDC2626' }, bold: true };
      }

      if (col.key === 'ninety_day_deficit' && typeof cell.value === 'number' && cell.value > 0) {
        cell.font = { bold: true };
      }
    });
  });

  return workbook;
}
