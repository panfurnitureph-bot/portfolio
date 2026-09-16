// Tiny, dependency-free client-side CSV export (RFC-4180).
//
// Quotes any field containing a comma, double-quote, or newline, and escapes
// embedded quotes by doubling them. Prepends a UTF-8 BOM so Excel renders ₱
// and accented characters correctly. Triggers a download via a temporary
// <a download> element. Framework-agnostic — safe to call from any client code.

export type CsvColumn = { key: string; label: string };

function cell(value: unknown): string {
  if (value == null) return "";
  let s: string;
  if (typeof value === "object") s = JSON.stringify(value);
  else s = String(value);
  if (/[",\n\r]/.test(s)) s = `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function exportToCsv(
  filename: string,
  columns: CsvColumn[],
  rows: Record<string, unknown>[],
): void {
  const header = columns.map((c) => cell(c.label)).join(",");
  const body = rows
    .map((row) => columns.map((c) => cell(row[c.key])).join(","))
    .join("\r\n");
  const csv = body ? `${header}\r\n${body}` : header;

  // ﻿ = UTF-8 BOM so Excel detects encoding.
  const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename.toLowerCase().endsWith(".csv") ? filename : `${filename}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
