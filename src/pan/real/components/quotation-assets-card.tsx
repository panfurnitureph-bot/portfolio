"use client";

import { useState, useTransition } from "react";
import { uploadQuoteAsset, type AssetKind, type AssetStatus } from "@/app/quotations/actions";

// Ang tatlong larawan na hindi kayang buuin ng code: ang InstaPay QR card ng BPI
// at ng BDO (ibang payload ang bawat bangko) at ang lagda. Isang upload lang —
// pagkatapos, awtomatiko nang kasama sa bawat quotation.

const ITEMS: { kind: AssetKind; label: string; hint: string }[] = [
  { kind: "bpiQr", label: "BPI payment card", hint: "The full card with the account name and number. Leave the InstaPay QR out — Messenger scans it and attaches its own transfer card under the quotation." },
  { kind: "bdoQr", label: "BDO payment card", hint: "The full card with the account name and number. Leave the InstaPay QR out — Messenger scans it and attaches its own transfer card under the quotation." },
  { kind: "gcashQr", label: "GCash QR card", hint: "Shown for GCash payments in the installation collection" },
  { kind: "mayaQr", label: "Maya QR card", hint: "Static Maya QR card — shown for Maya transfers in the installation collection" },
  { kind: "signature", label: "Signature", hint: "A scan of the signature — transparent PNG works best" },
];

export function QuotationAssetsCard({ status }: { status: Record<AssetKind, AssetStatus> }) {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const [state, setState] = useState(status);

  function pick(kind: AssetKind) {
    const el = document.createElement("input");
    el.type = "file";
    // Tinatanggap ang LAHAT ng larawan. Dating PNG/JPEG/WEBP lang, kaya ang file
    // na ibang format (hal. AVIF, GIF, HEIC mula sa telepono) ay hindi lumalabas
    // sa picker — mukhang "hindi ma-upload" kahit pumipili ka naman. Ang server
    // ang nagsasabi ngayon kung hindi tanggap ang format.
    el.accept = "image/*";
    el.onchange = () => {
      const file = el.files?.[0];
      if (!file) return;
      if (file.size > 4_000_000) {
        setMsg(`${file.name} is ${Math.round(file.size / 1024 / 1024)}MB — the limit is 4MB.`);
        return;
      }
      setMsg("Uploading…");
      const fr = new FileReader();
      fr.onerror = () => setMsg("Could not read that file. Try another one.");
      fr.onload = () => {
        const dataUrl = String(fr.result);
        // Ipakita AGAD ang napiling larawan (optimistic) — ang naka-imbak na URL
        // ay hindi agad nagbabago dahil pareho ang pangalan, kaya ang data URI
        // ng bagong pili ang pinakamabilis na kumpirmasyon na tama ang file.
        setState((s) => ({ ...s, [kind]: { uploaded: true, url: dataUrl } }));
        start(async () => {
          const r = await uploadQuoteAsset(kind, dataUrl);
          if ("error" in r) {
            setMsg(r.error);
            setState((s) => ({ ...s, [kind]: status[kind] })); // ibalik sa dating laman
            return;
          }
          setMsg("Saved — it will appear on the next quotation.");
        });
      };
      fr.readAsDataURL(file);
    };
    el.click();
  }

  const missing = ITEMS.filter((i) => !state[i.kind]?.uploaded);

  return (
    <div className="rounded-xl border border-border bg-surface p-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-sm font-semibold">Quotation assets</h2>
          <p className="mt-0.5 text-xs text-muted">
            {missing.length === 0
              ? "All set — the QR cards and signature are on every quotation."
              : `Upload these once so they appear on every quotation: ${missing.map((m) => m.label).join(", ")}.`}
          </p>
        </div>
        {msg && <span className="shrink-0 text-xs font-medium text-foreground">{msg}</span>}
      </div>

      <div className="mt-3 grid gap-3 sm:grid-cols-3">
        {ITEMS.map((it) => {
          const st = state[it.kind];
          return (
            <button
              key={it.kind}
              onClick={() => pick(it.kind)}
              disabled={pending}
              title={it.hint}
              className="flex items-center gap-3 rounded-lg border border-border p-2 text-left hover:bg-stone-50 disabled:opacity-60"
            >
              {/* Preview — checkerboard-free plain surface para kita ang
                  transparent na lagda; object-contain para hindi ma-crop. */}
              <span className="flex h-14 w-20 shrink-0 items-center justify-center overflow-hidden rounded border border-border/60 bg-white">
                {st?.url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={st.url} alt={it.label} className="h-full w-full object-contain" />
                ) : (
                  <span className="text-[10px] text-muted">none</span>
                )}
              </span>
              <span className="min-w-0">
                <span className="block truncate text-sm font-medium">{it.label}</span>
                <span className={`block text-[11px] ${st?.uploaded ? "text-success" : "text-muted"}`}>
                  {st?.uploaded ? "Uploaded — tap to replace" : "Not uploaded yet"}
                </span>
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
