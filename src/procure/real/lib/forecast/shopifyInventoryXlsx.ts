/**
 * @file shopifyInventoryXlsx.ts
 * Generates a styled Excel workbook for Storefront Stock data
 * Similar styling to IDP but with different columns
 */

export interface BuildShopifyInventoryXlsxOptions {
  todayMs: number;
}

export interface ShopifyInventoryXlsxResult {
  workbook: any; // ExcelJS.Workbook
  buffer: ArrayBuffer;
}

// Color palette
const ARGB = {
  white: "FFFFFFFF",
  text: "FF1F2937",
  headerBlue: "FF1E40AF",
  headerLightBlue: "FF3B82F6",
  lightYellow: "FFFEF3C7",
  lightBlue: "FFDBEAFE",
  lightGray: "FFF3F4F6",
  border: "FFD1D5DB",
};

const thinBorder = {
  top: { style: "thin" as const, color: { argb: ARGB.border } },
  left: { style: "thin" as const, color: { argb: ARGB.border } },
  bottom: { style: "thin" as const, color: { argb: ARGB.border } },
  right: { style: "thin" as const, color: { argb: ARGB.border } },
};

interface ColumnDef {
  key: string;
  label: string;
  width: number;
  group: "basic" | "inventory";
}

const COLUMNS: ColumnDef[] = [
  { key: "description", label: "Product Name", width: 35, group: "basic" },
  { key: "sku", label: "SKU", width: 18, group: "basic" },
  { key: "factory", label: "Factory", width: 12, group: "basic" },
  { key: "shopify_status", label: "Shopify Status", width: 15, group: "basic" },
  { key: "fba_reserved", label: "FBA Reserved", width: 12, group: "inventory" },
  { key: "intransit_fba", label: "InTransit FBA", width: 12, group: "inventory" },
  { key: "fba", label: "FBA", width: 10, group: "inventory" },
  { key: "oh_inv", label: "OH Inv", width: 10, group: "inventory" },
  { key: "otw_units", label: "OTW Units", width: 12, group: "inventory" },
  { key: "oo_units", label: "OO Units", width: 12, group: "inventory" },
  { key: "po_in_progress", label: "PO in Progress", width: 14, group: "inventory" },
];

const GROUP_BANNER: Record<string, string> = {
  basic: "",
  inventory: "Inventory Buckets",
};

/**
 * Builds a styled Excel workbook for Storefront Stock report
 */
export async function buildShopifyInventoryXlsx(
  rows: any[],
  opts: BuildShopifyInventoryXlsxOptions,
): Promise<ShopifyInventoryXlsxResult> {
  const ExcelJS = (await import("exceljs")).default;
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Storefront Stock Report";
  workbook.created = new Date();

  const ws = workbook.addWorksheet("Storefront Stock", {
    views: [
      // Freeze first column (Row #) + two header rows
      { state: "frozen", xSplit: 1, ySplit: 2 },
    ],
  });

  // Set column widths
  ws.columns = [
    { width: 5 }, // row # column
    ...COLUMNS.map((c) => ({ width: c.width })),
  ];

  // ─── Row 1: Banner row (group titles) ───
  const row1Values: string[] = [""];
  for (const col of COLUMNS) {
    row1Values.push(GROUP_BANNER[col.group] || "");
  }
  const row1 = ws.addRow(row1Values);
  row1.height = 22;

  // Merge banner cells for "Inventory Buckets" group
  let inventoryStart = -1;
  let inventoryEnd = -1;
  for (let i = 0; i < COLUMNS.length; i++) {
    if (COLUMNS[i].group === "inventory") {
      if (inventoryStart === -1) inventoryStart = i;
      inventoryEnd = i;
    }
  }
  if (inventoryStart !== -1 && inventoryEnd > inventoryStart) {
    const startCol = inventoryStart + 2; // +1 for # column, +1 for 1-based
    const endCol = inventoryEnd + 2;
    ws.mergeCells(1, startCol, 1, endCol);
  }

  // Style row 1
  row1.eachCell({ includeEmpty: true }, (cell, colNumber) => {
    cell.font = { bold: true, size: 11, color: { argb: ARGB.text } };
    cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
    cell.border = thinBorder;
    
    let fillArgb = ARGB.lightGray;
    if (colNumber > 1) {
      const col = COLUMNS[colNumber - 2];
      if (col.group === "inventory") {
        fillArgb = ARGB.lightYellow;
      }
    }
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: fillArgb } };
  });

  // ─── Row 2: Column headers ───
  const row2Values: string[] = ["#"];
  for (const col of COLUMNS) {
    row2Values.push(col.label);
  }
  const row2 = ws.addRow(row2Values);
  row2.height = 28;

  // Style row 2
  row2.eachCell({ includeEmpty: true }, (cell, colNumber) => {
    if (colNumber === 1) {
      // Row # column
      cell.font = { bold: true, size: 10, color: { argb: ARGB.white } };
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: ARGB.headerBlue } };
    } else {
      const col = COLUMNS[colNumber - 2];
      cell.font = { bold: true, size: 10, color: { argb: ARGB.white } };
      
      let fillArgb = ARGB.headerBlue;
      if (col.group === "inventory") {
        fillArgb = ARGB.headerLightBlue;
      }
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: fillArgb } };
    }
    cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
    cell.border = thinBorder;
  });

  // ─── Data rows ───
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const rowNum = i + 1;
    
    const rowValues: (string | number)[] = [rowNum];
    for (const col of COLUMNS) {
      const value = row[col.key];
      
      // Format values
      if (value == null || value === "") {
        rowValues.push("-");
      } else if (typeof value === "number") {
        rowValues.push(value);
      } else {
        rowValues.push(String(value));
      }
    }
    
    const wsRow = ws.addRow(rowValues);
    wsRow.height = 20;
    
    // Style data row
    wsRow.eachCell({ includeEmpty: true }, (cell, colNumber) => {
      cell.border = thinBorder;
      cell.alignment = { 
        vertical: "middle",
        horizontal: colNumber === 1 || colNumber === 2 ? "left" : "center"
      };
      
      if (colNumber === 1) {
        // Row number
        cell.font = { size: 9, color: { argb: ARGB.text } };
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: ARGB.lightGray } };
      } else {
        const col = COLUMNS[colNumber - 2];
        cell.font = { size: 10, color: { argb: ARGB.text } };
        
        // Highlight inventory bucket columns
        if (col.group === "inventory") {
          cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: ARGB.lightYellow } };
        }
        
        // Number formatting
        if (typeof cell.value === "number") {
          cell.numFmt = "#,##0";
        }
        
        // Highlight Shopify Status
        if (col.key === "shopify_status") {
          const status = String(cell.value || "").toLowerCase();
          if (status === "inactive" || status === "-") {
            cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: ARGB.lightBlue } };
          }
        }
      }
    });
  }

  // Generate buffer
  const buffer = await workbook.xlsx.writeBuffer();
  
  return {
    workbook,
    buffer: buffer as ArrayBuffer,
  };
}

/**
 * Converts ArrayBuffer to base64 string
 */
export function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

/**
 * Suggested filename for Storefront Stock report
 */
export function shopifyInventoryXlsxFilename(date = new Date()): string {
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  const yyyy = date.getFullYear();
  return `shopify_inventory_${mm}${dd}${yyyy}.xlsx`;
}
