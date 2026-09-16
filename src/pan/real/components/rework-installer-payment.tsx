"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { submitReworkPaymentApproval, reworkPaymentApprovalStatus, currentCollectorName } from "@/app/orders/approval-actions";
import { MultiImageUpload } from "./multi-image-upload";
import { SignaturePad } from "./signature-pad";
import { Modal } from "./modal";

const peso2 = (n: number) => (Number(n) || 0).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// Koleksyon ng REWORK (RMA) balance mula sa Installation screen. Ang bayad ay
// napupunta sa RMA LEDGER (returns.rework_downpayment) via collectReworkPayment
// — hindi sa orders ledger — para bumukas ang "Delivered" guardrail.
//
// DALAWANG PARAAN LANG (2026-08-25): Cash, at ang apat na bangko na may QR.
// Inalis ang auto-generate na "Maya QR" (nadoble sa static na Maya) at ang
// Terminal (POS) na may slip OCR — sa tindahan iyon, at ang koleksyong ito ay
// nangyayari sa bahay ng customer habang nag-i-install.
//
// PROOF FLOW (2026-08-25) — kapareho na ng Sales sa parehong screen. Diretso
// itong naitatala noon: isang pindot at bayad na ang RMA, walang litrato,
// walang pirma, walang aprubador, habang ang koleksyon ng order sa katabing
// kahon ay dumaraan sa lahat ng iyon. Ang daanan ngayon ay:
//     bangko: QR → litrato → pirma → submit → HINTAY NG APRUBAHAN
//     cash:        litrato → pirma → submit → HINTAY NG APRUBAHAN
// Ang Approve LANG (Payment Approval page) ang tunay na nagtatala.
export function ReworkInstallerPayment({ returnId, rmaNo, balance, collectorName = "" }: {
  returnId: number; rmaNo?: string | null; balance: number;
  // Ang naka-login — siya ang kumukolekta. May field noon na tinatanong ito,
  // pero hindi naipapadala kahit saan: tinitipa at nawawala.
  collectorName?: string;
}) {
  const [mode, setMode] = useState<"cash" | "BDO" | "BPI" | "GCash" | "Maya">("cash");
  // Kapag walang naipasang collectorName ang embed, kunin sa server ang
  // naka-login — hindi na tina-type ang sariling pangalan.
  const [autoName, setAutoName] = useState(collectorName);
  useEffect(() => {
    if (collectorName) return;
    let on = true;
    currentCollectorName().then((n) => { if (on && n) setAutoName(n); }).catch(() => { /* walang pangalan — mananatiling blangko */ });
    return () => { on = false; };
  }, [collectorName]);
  const collector = collectorName || autoName;
  // Ang BANGKO ay may QR — hindi manu-manong marka lang: ipinapakita ang QR ng
  // PAN, isinusan ng customer, saka itinatala. Kaparehong QR ng Sales
  // (paymentQrAssets → quotation/bdo-qr.jpg atbp.).
  const isBank = mode !== "cash";
  const [payQrs, setPayQrs] = useState<{ BDO: string | null; BPI: string | null; GCash: string | null; Maya: string | null } | null>(null);
  // Nakita na ba ang QR? Ang mga hakbang ay bukas lang pagkatapos — para hindi
  // maitala ang bayad na hindi pa naipapakita kung saan magbabayad.
  const [qrShown, setQrShown] = useState(false);

  // ── Ang mga hakbang ────────────────────────────────────────────────────────
  const FLOW = (isBank ? ["pay", "photo", "sig", "record"] : ["photo", "sig", "record"]) as ("pay" | "photo" | "sig" | "record")[];
  const [stage, setStage] = useState<"pay" | "photo" | "sig" | "record">("photo");
  const stepShown = (st: typeof stage) => FLOW.indexOf(st) <= FLOW.indexOf(stage);
  const stepNo = (st: typeof stage) => FLOW.indexOf(st) + 1;
  const [photos, setPhotos] = useState<string[]>([]);
  const [sig, setSig] = useState<string | null>(null);
  const [sigOpen, setSigOpen] = useState(false);

  const [approval, setApproval] = useState<"none" | "waiting" | "rejected" | "paid">("none");
  const [rejectNote, setRejectNote] = useState<string | null>(null);
  const [waitInfo, setWaitInfo] = useState<{ method: string; amount: number; by: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const router = useRouter();

  // Isang token kada submit — pigil sa doble kapag nadoble ang pindot o
  // na-retry ang request. Bago kapag na-reject, para bagong pending.
  const tokenRef = useRef<string>("");
  if (!tokenRef.current) tokenRef.current = typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `rw${returnId}-${balance}`;

  const folder = `rework-proof/${(rmaNo || `RMA${returnId}`).replace(/[^a-z0-9_-]/gi, "")}`;

  // ── Poll ng aprubahan ──────────────────────────────────────────────────────
  // Humihinto kapag nakatago ang tab: ang tablet na naiwang bukas ay hindi
  // kumakain. Ang 8s na pantay-pantay na poll ang isa sa dalawang sanhi ng
  // pag-pause ng Vercel noong 8/7 (1,012 sa 360 GB-hrs) — kaya hindi na
  // babalik doon; tingnan ang hati sa startPoll.
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  function stopPoll() { if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; } }
  function startPoll() {
    stopPoll();
    // MABILIS ANG UNANG MINUTO, MABAGAL PAGKATAPOS (2026-08-27). Ang 60s na
    // pantay-pantay ay nagpapaisip na sira ang app: naaprubahan na sa kabilang
    // tab pero "Waiting for Approval" pa rin ang nakikita ng nakatingin. Ang
    // pag-aprubahan ay MADALAS na kaagad kapag may naghihintay — kaya 5s sa
    // unang minuto, tapos hihina sa 60s. Ang kabuuang tawag ay malapit pa rin
    // sa dati sa mahabang paghihintay, kaya walang panganib na maulit ang
    // pag-pause ng Vercel noong 8/7.
    const startedAt = Date.now();
    let tick = 0;
    const check = async () => {
      if (typeof document !== "undefined" && document.hidden) return;
      // Sa unang minuto ay tuwing 5s; pagkatapos, isang beses kada 60s.
      const fast = Date.now() - startedAt < 60_000;
      tick += 5;
      if (!fast && tick % 60 !== 0) return;
      const st = await reworkPaymentApprovalStatus(returnId);
      // NA-APRUBAHAN = BAYAD. Ang "none" ang nakalagay noon, na nagbabalik sa
      // blangkong form na parang walang nangyari — iyon ang "wala nangyayari
      // dito pag ka approved". Ang refresh ang nagsasara ng kahon (ang due ay
      // naging 0), pero may agwat: ito ang sumasagot sa mata agad.
      if (st.status === "approved") { setApproval("paid"); stopPoll(); router.refresh(); }
      if (st.status === "rejected") {
        setApproval("rejected"); setRejectNote(st.note); stopPoll();
        tokenRef.current = typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `rw${returnId}-${Date.now()}`;
      }
    };
    pollRef.current = setInterval(check, 5000);
  }

  // Pagbukas: kung may PENDING nang submit ang RMA na ito, dumiretso sa
  // Waiting for Approval (kahit na-refresh o ibang tablet ang gumamit).
  useEffect(() => {
    let alive = true;
    reworkPaymentApprovalStatus(returnId).then((st) => {
      if (!alive) return;
      if (st.status === "pending") {
        setWaitInfo({ method: st.method || "", amount: st.amount || balance, by: st.submittedBy || "" });
        setApproval("waiting"); startPoll();
      }
      if (st.status === "approved") { setWaitInfo({ method: st.method || "", amount: st.amount || balance, by: st.submittedBy || "" }); setApproval("paid"); }
      if (st.status === "rejected") { setApproval("rejected"); setRejectNote(st.note); }
    }).catch(() => { /* wala pang migration 0195 */ });
    return () => { alive = false; stopPoll(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [returnId]);

  // Ang QR ng bangko ay hinihila kapag napili ang isa — static na larawan,
  // kaparehong pinagmumulan ng Sales. Walang polling: walang QR na ginagawa,
  // kaya walang hinihintay na sagot.
  useEffect(() => {
    if (isBank && payQrs === null) {
      import("@/app/orders/slip-actions")
        .then((m) => m.paymentQrAssets())
        .then(setPayQrs)
        .catch(() => setPayQrs({ BDO: null, BPI: null, GCash: null, Maya: null }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  // Paglipat ng channel: balik sa unang hakbang ng bagong daanan.
  function pickMode(k: typeof mode) {
    setMode(k);
    setQrShown(false);
    setStage(k === "cash" ? "photo" : "pay");
  }

  async function submit() {
    if (busy) return;
    setBusy(true); setError(null);
    const r = await submitReworkPaymentApproval(
      returnId,
      mode === "cash" ? "Cash" : mode,
      [...photos, ...(sig ? [sig] : [])],
      tokenRef.current,
      balance,
    );
    setBusy(false);
    if ("error" in r) { setError(r.error); return; }
    setWaitInfo({ method: mode === "cash" ? "Cash" : mode, amount: balance, by: collector });
    setApproval("waiting"); startPoll();
    router.refresh();
  }

  if (approval === "paid") {
    return (
      <div className="overflow-hidden rounded-xl border border-emerald-200 bg-emerald-50 shadow-sm">
        <div className="flex items-center justify-between gap-3 bg-emerald-700 px-4 py-2.5">
          <span className="text-[10.5px] font-extrabold uppercase tracking-[0.16em] text-white">Payment Approved</span>
          {rmaNo && <span className="font-mono text-[11.5px] font-bold text-emerald-100">{rmaNo}</span>}
        </div>
        <div className="flex flex-col items-center px-5 pb-5 pt-5 text-center">
          <span className="flex h-12 w-12 items-center justify-center rounded-full bg-emerald-600 text-2xl font-extrabold text-white">✓</span>
          <p className="mt-3 text-lg font-extrabold tracking-tight text-emerald-800">Paid</p>
          <p className="mt-0.5 text-sm font-bold text-emerald-700">
            {waitInfo?.method || "Payment"} · ₱{peso2(waitInfo?.amount || balance)}
          </p>
          <p className="mt-2 text-[11px] text-emerald-700/80">
            Recorded against {rmaNo ?? "the RMA"}. The rework balance is settled.
          </p>
        </div>
      </div>
    );
  }

  // ── Naghihintay ng aprubahan ───────────────────────────────────────────────
  if (approval === "waiting") {
    return (
      <div className="overflow-hidden rounded-xl border border-[#e6dcc4] bg-white shadow-sm">
        <div className="flex items-center justify-between gap-3 bg-[#4a3b1a] px-4 py-2.5">
          <span className="text-[10.5px] font-extrabold uppercase tracking-[0.16em] text-[#f4ead8]">Payment Submitted — For Approval</span>
          {rmaNo && <span className="font-mono text-[11.5px] font-bold text-[#caa45a]">{rmaNo}</span>}
        </div>
        <div className="flex flex-col items-center px-5 pb-5 pt-6 text-center">
          <div className="h-[52px] w-[52px] animate-spin rounded-full border-4 border-[#efe5cd] border-t-[#8a6a1f]" aria-hidden />
          <p className="mt-3.5 text-lg font-extrabold tracking-tight text-[#3a2e14]">Waiting for Approval</p>
          <p className="mt-0.5 text-sm font-bold text-[#8a6a1f]">
            {waitInfo?.method || "Payment"} · ₱{peso2(waitInfo?.amount || balance)}
            {waitInfo?.by ? <span className="font-normal text-muted"> · submitted by {waitInfo.by}</span> : null}
          </p>
          <span className="mt-2.5 inline-flex items-center gap-1.5 rounded-full border border-[#ecd9b8] bg-amber-50 px-3 py-1 text-[10px] font-extrabold uppercase tracking-[0.13em] text-amber-700">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-amber-600" />
            Pending approval
          </span>
          <p className="mt-3 text-[11px] text-muted">
            The photo and signature are attached to {rmaNo ?? "the RMA"}. The rework is marked paid only once approved.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-border bg-stone-50/60 p-4">
      <div className="mb-3 flex items-center justify-between border-b border-border/60 pb-2">
        <span className="text-sm font-medium text-muted">Balance to collect{rmaNo ? ` · ${rmaNo}` : ""}</span>
        <span className="text-lg font-bold text-primary">₱{peso2(balance)}</span>
      </div>

      {approval === "rejected" && (
        <div className="mb-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2">
          <p className="text-xs font-bold text-rose-700">Payment rejected — collect again</p>
          {rejectNote && <p className="mt-0.5 text-[11px] text-rose-600">{rejectNote}</p>}
        </div>
      )}

      {/* Kaparehong chips ng Create Order — maliliit na pill sa isang hanay. */}
      <div className="mb-3 flex flex-wrap gap-1.5">
        {([
          { key: "cash", label: "Cash", sub: "in-store" },
          { key: "BDO", label: "BDO", sub: "transfer" },
          { key: "BPI", label: "BPI", sub: "transfer" },
          { key: "GCash", label: "GCash", sub: "transfer" },
          { key: "Maya", label: "Maya", sub: "transfer" },
        ] as const).map((o) => (
          <button key={o.key} type="button" onClick={() => pickMode(o.key)} title={o.sub}
            className={`rounded-full border px-3 py-1.5 text-xs font-bold transition-all ${
              mode === o.key
                ? "border-[#4a3b1a] bg-[#4a3b1a] text-[#f4ead8] shadow-sm"
                : "border-[#e6dcc4] bg-white text-muted hover:border-[#caa45a] hover:bg-[#faf6ec]"}`}>
            {o.label}{mode === o.key ? " ✓" : ""}
          </button>
        ))}
      </div>

      <div className="space-y-2">
        {/* HAKBANG 1 (bangko lang) — ang QR */}
        {isBank && stepShown("pay") && (
          <RwStep n={stepNo("pay")} title={`Show the ${mode} QR`} done={qrShown} expanded={stage === "pay"} onHeaderClick={() => setStage("pay")}>
            <div className="flex flex-col items-center gap-2 text-center">
              {payQrs === null ? (
                <p className="py-6 text-sm text-muted">Loading the {mode} QR…</p>
              ) : payQrs[mode] ? (
                <>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={payQrs[mode]!} alt={`${mode} QR`} className="w-full max-w-[320px] rounded-lg border border-border bg-white" />
                  <p className="text-sm font-bold text-[#3a2e14]">Pay ₱{peso2(balance)} via {mode}</p>
                  <p className="text-[11px] text-muted">Have the customer scan the QR and transfer the full balance.</p>
                </>
              ) : (
                <p className="rounded-lg border border-dashed border-border px-3 py-4 text-[11px] text-muted">
                  No {mode} QR uploaded. The payment can still be recorded.
                </p>
              )}
              <button type="button" onClick={() => { setQrShown(true); setStage("photo"); }}
                className="w-full rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-accent hover:bg-primary/90">
                Customer has paid — Next
              </button>
            </div>
          </RwStep>
        )}

        {/* HAKBANG 2 — ang litrato */}
        {stepShown("photo") && (
          <RwStep
            n={stepNo("photo")}
            title={mode === "cash" ? "Photo of the cash received" : `Photo of the ${mode} transfer receipt`}
            done={photos.length > 0}
            expanded={stage === "photo"}
            onHeaderClick={() => setStage("photo")}
          >
            <MultiImageUpload
              value={photos}
              onChange={(v) => {
                setPhotos(v);
                // Tapos ang litrato → tuloy agad sa pirma.
                if (v.length > 0 && stage === "photo") setStage("sig");
              }}
              camera
              folder={folder}
            />
            <p className="mt-1.5 text-[11px] text-muted">
              {mode === "cash"
                ? "Photograph the cash (or the cash with the customer) — this is the proof the payment was received."
                : `Photograph the ${mode} transfer confirmation / receipt on the customer's phone — this is the proof.`}
            </p>
          </RwStep>
        )}

        {/* HAKBANG 3 — ang pirma */}
        {stepShown("sig") && (
          <RwStep n={stepNo("sig")} title="Customer signature — payment confirmation" done={!!sig} expanded={stage === "sig"} onHeaderClick={() => setStage("sig")}>
            {sig ? (
              <div className="flex items-center gap-3">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={sig} alt="customer signature" className="h-14 rounded border border-border bg-white" />
                <button type="button" onClick={() => { setSig(null); setSigOpen(true); }} className="text-[11px] font-semibold text-danger underline">Clear — sign again</button>
              </div>
            ) : (
              // Malaking pindutan → full-screen na pirmahan (tablet): ang
              // customer mismo ang pipirma, kaya malapad ang sulatan.
              <button
                type="button"
                onClick={() => setSigOpen(true)}
                className="flex h-28 w-full flex-col items-center justify-center gap-1.5 rounded-xl border-2 border-dashed border-[#caa45a] bg-[#faf6ec]/60 text-[#4a3b1a] transition-colors hover:bg-[#f4ead8]"
              >
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" /></svg>
                <span className="text-sm font-bold">Customer Signature</span>
                <span className="text-[11px] text-muted">Tap to open the signing screen</span>
              </button>
            )}

            <Modal
              open={sigOpen}
              onClose={() => setSigOpen(false)}
              title="Customer Signature"
              description={`${rmaNo ?? ""} · Rework payment confirmation — please sign below`.trim()}
              size="2xl"
              footer={<div className="flex justify-end"><button type="button" onClick={() => setSigOpen(false)} className="rounded-lg border border-border px-4 py-2 text-sm font-medium hover:bg-stone-100">Cancel</button></div>}
            >
              <SignaturePad
                big
                value={null}
                folder={folder}
                onChange={(url) => {
                  setSig(url);
                  if (url) {
                    setSigOpen(false);
                    if (stage === "sig") setStage("record");
                  }
                }}
              />
            </Modal>
          </RwStep>
        )}

        {/* HAKBANG 4 — ang submit */}
        {stepShown("record") && (
          <RwStep n={stepNo("record")} title="Submit for approval" done={false} last expanded onHeaderClick={() => setStage("record")}>
            {collector && (
              <div className="mb-2 flex items-center justify-between rounded-lg border border-[#e6dcc4] bg-[#faf6ec] px-3 py-2">
                <span className="text-[11px] font-semibold uppercase tracking-wide text-[#7a5e1f]">Collected by</span>
                <span className="text-sm font-bold text-[#3a2e14]">{collector}</span>
              </div>
            )}
            <button
              type="button"
              onClick={submit}
              disabled={busy || photos.length === 0 || !sig}
              className="w-full rounded-lg bg-primary px-4 py-2.5 text-sm font-bold text-accent shadow-sm hover:bg-primary/90 disabled:opacity-50"
            >
              {busy
                ? "Submitting…"
                : photos.length === 0
                  ? `Take the proof photo first (Step ${stepNo("photo")})`
                  : !sig
                    ? `Customer signature needed (Step ${stepNo("sig")})`
                    : `Submit Payment · ₱${peso2(balance)}`}
            </button>
            <p className="mt-1.5 text-center text-[10.5px] text-muted">
              Sent to Payment Approval — the rework is marked paid only once approved. The photo and signature attach to {rmaNo ?? "the RMA"} as permanent proof.
            </p>
          </RwStep>
        )}
      </div>

      {error && <p className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p>}
    </div>
  );
}

// Isang hakbang sa proof flow — bilang na selyo, pamagat, at status chip sa
// header. Ang laman ay lumalabas lang kapag ITO ang kasalukuyang hakbang; ang
// tapos na ay naka-collapse na may tsek at pinipindot ang header para balikan.
// Kaparehong hulma ng CashStep sa installer-payment.tsx.
function RwStep({ n, title, done, last, expanded = true, onHeaderClick, children }: {
  n: number; title: string; done: boolean; last?: boolean;
  expanded?: boolean; onHeaderClick?: () => void; children: React.ReactNode;
}) {
  return (
    <div className="overflow-hidden rounded-xl border border-[#e6dcc4] bg-white shadow-sm">
      <button
        type="button"
        onClick={onHeaderClick}
        className={`flex w-full items-center gap-2.5 border-[#efe7d6] bg-[#faf6ec]/70 px-3 py-2 text-left ${expanded ? "border-b" : ""} ${onHeaderClick && !expanded ? "cursor-pointer hover:bg-[#f4ead8]/70" : "cursor-default"}`}
      >
        <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-extrabold ${done ? "bg-emerald-600 text-white" : "bg-[#4a3b1a] text-[#f4ead8]"}`}>
          {done ? "✓" : n}
        </span>
        <span className="text-[11px] font-bold uppercase tracking-wide text-[#3a2e14]">{title}</span>
        {!last && (
          <span className={`ml-auto rounded-full px-2 py-0.5 text-[10px] font-extrabold ${done ? "bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-600/20" : "bg-amber-50 text-amber-700 ring-1 ring-inset ring-amber-600/20"}`}>
            {done ? "Done" : "Required"}
          </span>
        )}
        {!expanded && done && <span className="ml-2 shrink-0 text-[10px] font-semibold text-muted underline">Edit</span>}
      </button>
      {expanded && <div className="p-3">{children}</div>}
    </div>
  );
}
