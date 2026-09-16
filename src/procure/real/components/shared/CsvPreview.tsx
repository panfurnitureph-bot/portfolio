/* Inline CSV preview (same parser/table as POTracker's CsvPreview) — used by the
   packing-list preview modals so demo CSVs render without the MS Office viewer. */
import { useEffect, useState } from "react";

export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else { inQuotes = false; }
      } else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field); field = ""; rows.push(row); row = [];
    } else field += c;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => !(r.length === 1 && r[0] === ""));
}

const CSV_PREVIEW_MAX_ROWS = 200;

export function CsvPreview({ url }: { url: string }) {
  const [rows, setRows] = useState<string[][] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    setRows(null); setError(null);
    (async () => {
      try {
        const res = await fetch(url);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const text = await res.text();
        if (!cancelled) setRows(parseCsv(text));
      } catch (e: any) {
        if (!cancelled) setError(e?.message ?? "Failed to load file");
      }
    })();
    return () => { cancelled = true; };
  }, [url]);

  if (error) return <div className="flex h-full items-center justify-center text-sm text-destructive">Couldn't load preview: {error}</div>;
  if (!rows) return <div className="flex h-full items-center justify-center text-sm text-muted-foreground">Loading preview…</div>;
  if (!rows.length) return <div className="flex h-full items-center justify-center text-sm text-muted-foreground">Empty file.</div>;

  const shown = rows.slice(0, CSV_PREVIEW_MAX_ROWS);
  return (
    <div className="h-full overflow-auto p-2">
      {rows.length > CSV_PREVIEW_MAX_ROWS && (
        <div className="mb-2 text-xs text-muted-foreground">Showing first {CSV_PREVIEW_MAX_ROWS} of {rows.length} rows.</div>
      )}
      <table className="border-collapse text-xs">
        <tbody>
          {shown.map((r, ri) => (
            <tr key={ri} className={ri === 0 ? "bg-muted font-semibold" : ri % 2 ? "bg-background" : "bg-muted/20"}>
              {r.map((cell, ci) => (
                <td key={ci} className="border px-2 py-1 whitespace-nowrap">{cell}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
