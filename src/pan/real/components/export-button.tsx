"use client";

import { exportToCsv, type CsvColumn } from "@/lib/export-csv";

// Reusable secondary-styled button that downloads the given rows as a CSV.
export function ExportButton({
  filename,
  columns,
  rows,
  label = "Export CSV",
}: {
  filename: string;
  columns: CsvColumn[];
  rows: Record<string, unknown>[];
  label?: string;
}) {
  return (
    <button
      type="button"
      onClick={() => exportToCsv(filename, columns, rows)}
      className="apk-hide inline-flex items-center gap-2 rounded-lg border border-border bg-surface px-3 py-2 text-sm font-medium hover:bg-stone-100"
    >
      <svg
        width="15"
        height="15"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
        <polyline points="7 10 12 15 17 10" />
        <line x1="12" y1="15" x2="12" y2="3" />
      </svg>
      {label}
    </button>
  );
}
