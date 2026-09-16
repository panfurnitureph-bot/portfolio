"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { attachSlipPhoto, paymentQrAssets } from "@/app/orders/slip-actions";
import { submitPaymentApproval, paymentApprovalStatus, currentCollectorName } from "@/app/orders/approval-actions";
import { MultiImageUpload } from "./multi-image-upload";
import { SignaturePad } from "./signature-pad";
import { Modal } from "./modal";

const peso2 = (n: number) => (Number(n) || 0).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// Collect an order's remaining balance from the Installation screen — Cash (manual)
// or Maya QR Ph (scannable, auto-detected). Only rendered when balance > 0.
export function InstallerPayment({ orderId, orderNumber, balance, collectorName = "", initialMode, lockMode = false }: {
  orderId: number;
  orderNumber?: string | null;
  // Halagang kokolektahin — sa Installation ito ang buong balanse; sa Edit
  // Order embed pwedeng partial (hal. 30% DP), naka-cap sa balanse sa server.
  balance: number;
  collectorName?: string;
  // Panimulang channel (hal. ang MOP ng order sa Edit Order embed).
  initialMode?: "Cash" | "BDO" | "BPI" | "GCash" | "Maya";
  // Naka-LOCK sa initialMode (hiling 2026-08-16): sa Edit Order, ang napiling
  // channel sa Create Order LANG ang lalabas — walang tabs.
  lockMode?: boolean;
}) {
  // Mga paraan ng bayad: Cash / BDO / BPI / GCash / Maya — lahat manual na may
  // proof flow (photo + pirma + approval). Ang dating "Maya QR" na auto-detect
  // (Maya Business checkout) ay TINANGGAL 2026-08-16 (hiling ni Joe) — ang
  // "Maya" ay ang static na QR card na naka-upload sa assets. Ang napiling
  // channel ang maitatala sa payment ledger at sa resibo.
  const [mode, setMode] = useState<"Cash" | "BDO" | "BPI" | "GCash" | "Maya">(initialMode ?? "Cash");
  // Transfer channel (BDO/BPI/GCash/Maya) = may QR display na UNANG hakbang.
  const isTransfer = mode !== "Cash";
  const [paid, setPaid] = useState(false);
  // PAYMENT APPROVAL (2026-08-10): ang manual submit ay PENDING muna — ang
  // aprubador sa Payment Approval page ang magpapatala. Habang naghihintay,
  // 'Waiting for Approval' ang screen at nagpo-poll; rejected = may dahilan.
  const [approval, setApproval] = useState<"none" | "waiting" | "rejected">("none");
  const [rejectNote, setRejectNote] = useState<string | null>(null);
  // Detalye ng pending submit — ipinapakita sa Waiting for Approval screen
  // (channel · halaga · sino nag-submit), kahit galing sa refresh/ibang tablet.
  const [waitInfo, setWaitInfo] = useState<{ method: string; amount: number; by: string; at: string | null; proofs: string[] } | null>(null);
  const approvalPollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  function stopApprovalPoll() { if (approvalPollRef.current) { clearInterval(approvalPollRef.current); approvalPollRef.current = null; } }
  function startApprovalPoll() {
    stopApprovalPoll();
    // MABILIS ANG UNANG MINUTO, MABAGAL PAGKATAPOS (2026-08-27). Ang 8s na
    // PANTAY-PANTAY na poll na walang hidden-tab guard ay isa sa dalawang sanhi
    // ng pag-pause ng Vercel noong 8/7 (1,012 sa 360 GB-hrs) — ang tablet na
    // naiwang bukas ay tumatawag buong araw. Pero ang 60s na pantay-pantay ay
    // nagpapaisip na sira ang app: naaprubahan na sa kabilang tab pero
    // "Waiting" pa rin ang nakikita. Ang aprubahan ay madalas na kaagad kapag
    // may naghihintay — kaya 5s sa unang minuto, tapos 60s, at tahimik kapag
    // nakatago ang tab.
    const startedAt = Date.now();
    let tick = 0;
    const check = async () => {
      if (typeof document !== "undefined" && document.hidden) return;
      const fast = Date.now() - startedAt < 60_000;
      tick += 5;
      if (!fast && tick % 60 !== 0) return;
      const st = await paymentApprovalStatus(orderId);
      if (st.status === "approved") { setPaid(true); setApproval("none"); stopApprovalPoll(); router.refresh(); }
      if (st.status === "rejected") {
        setApproval("rejected"); setRejectNote(st.note); stopApprovalPoll();
        // Bagong token para ang muling submit ay bagong pending (hindi madedupe
        // sa na-reject na).
        cashTokenRef.current = typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : "" + Date.now();
      }
    };
    approvalPollRef.current = setInterval(check, 5000);
  }
  // Pagbukas: kung may PENDING nang submit ang order na ito, dumiretso sa
  // Waiting for Approval (kahit na-refresh o ibang tablet).
  useEffect(() => {
    let alive = true;
    paymentApprovalStatus(orderId).then((st) => {
      if (!alive) return;
      if (st.status === "pending") {
        setWaitInfo({ method: st.method || "", amount: st.amount || balance, by: st.submittedBy || "", at: st.createdAt, proofs: st.proofs });
        setApproval("waiting"); startApprovalPoll();
      }
      if (st.status === "rejected") { setApproval("rejected"); setRejectNote(st.note); }
    }).catch(() => {});
    return () => { alive = false; stopApprovalPoll(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderId]);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  // cash — ang "Collected by" ay AUTO mula sa naka-login na account (hindi na
  // tina-type, hindi mapapalitan: bahagi ng proof kung sino ang kumolekta).
  const [collectedBy, setCollectedBy] = useState(collectorName);
  // Ilang embed (hal. Edit Order sa Operations) ang walang naipapasang
  // collectorName — kunin sa server para hindi na tina-type ang sariling
  // pangalan. Hindi pinapatungan ang naitype na.
  const [autoName, setAutoName] = useState(collectorName);
  useEffect(() => {
    if (collectorName) return;
    let on = true;
    currentCollectorName().then((n) => {
      if (on && n) { setAutoName(n); setCollectedBy((c) => (c.trim() ? c : n)); }
    }).catch(() => { /* mananatiling manual input */ });
    return () => { on = false; };
  }, [collectorName]);
  const [busy, setBusy] = useState(false);
  // PROOF NG CASH (2026-08-10, hiling ni Joe — "nakukulangan, walang proof"):
  // kailangang may LITRATO ng perang tinanggap at PIRMA ng customer bago
  // ma-mark na paid; parehong naka-attach sa order (kita sa Receipt/Transaction
  // Images) at protektado ng keep-filter (cash-proof folder).
  const [cashPhotos, setCashPhotos] = useState<string[]>([]);
  const [cashSig, setCashSig] = useState<string | null>(null);
  // WIZARD (2026-08-10): isa-isang hakbang lang ang nakabukas — 1 Photo →
  // 2 Signature → 3 Record. Awtomatikong umuusad pagkatapos ng bawat isa;
  // ang tapos nang hakbang ay naka-collapse na may tsek, pinipindot para balikan.
  const FLOW = (isTransfer ? ["pay", "photo", "sig", "record"] : ["photo", "sig", "record"]) as ("pay" | "photo" | "sig" | "record")[];
  const [stage, setStage] = useState<"pay" | "photo" | "sig" | "record">("photo");
  const stepShown = (st: typeof stage) => FLOW.indexOf(st) <= FLOW.indexOf(stage);
  const stepNo = (st: typeof stage) => FLOW.indexOf(st) + 1;
  // Mga naka-upload na payment QR (BDO/BPI/GCash/Maya) — kinukuha minsan lang.
  const [payQrs, setPayQrs] = useState<{ BDO: string | null; BPI: string | null; GCash: string | null; Maya: string | null } | null>(null);
  useEffect(() => {
    // Lipat ng channel = balik sa unang hakbang ng channel na iyon.
    setStage(isTransfer ? "pay" : "photo");
    if (isTransfer && !payQrs) paymentQrAssets().then(setPayQrs).catch(() => setPayQrs({ BDO: null, BPI: null, GCash: null, Maya: null }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);
  // Pop-up ng MALAKING signature pad (tablet/APK) — ang customer mismo ang
  // pipirma, kaya kailangang malapad ang sulatan, hindi ang maliit na inline pad.
  const [sigOpen, setSigOpen] = useState(false);
  // Stable idempotency token for THIS cash-collection action — generated once per mount so
  // a double-click / two-tab retry reuses the same token; recordPayment dedupes on it and
  // can't double-insert a +balance ledger row (BUG 1).
  const cashTokenRef = useRef<string>("");
  if (!cashTokenRef.current) {
    cashTokenRef.current =
      typeof crypto !== "undefined" && crypto.randomUUID
        ? crypto.randomUUID()
        : `${orderId}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }
  async function payCash() {
    if (busy) return; // guard against a synchronous double-click before state flips
    setError(null);
    // PROOF MUNA bago maitala: pangalan + litrato ng cash + pirma ng customer.
    if (!collectedBy.trim()) { setError("Enter the collector's name."); return; }
    if (cashPhotos.length === 0) { setError(mode === "Cash" ? "Take a photo of the cash received — this is the proof." : `Take a photo of the ${mode} transfer receipt — this is the proof.`); return; }
    if (!cashSig) { setError("Ask the customer to sign below as proof of payment."); return; }
    setBusy(true);
    // I-attach ang mga proof sa order BAGO ang record — kahit mabigo ang tala,
    // may proof nang nakakabit; ang attach ay idempotent (hindi nadodoble).
    for (const u of [...cashPhotos, cashSig]) {
      try { await attachSlipPhoto(orderId, u); } catch { /* best-effort */ }
    }
    // Ang `balance` prop ang hinihinging halaga — sa Installation ito ang buong
    // balanse; sa Edit Order embed pwedeng partial (naka-cap sa server).
    const r = await submitPaymentApproval(orderId, mode, collectedBy.trim(), [...cashPhotos, cashSig], cashTokenRef.current, balance);
    setBusy(false);
    if ("error" in r) { setError(r.error); return; }
    // PENDING na — hindi pa bayad: maghihintay ng approval.
    setWaitInfo({ method: mode, amount: balance, by: collectedBy.trim(), at: new Date().toISOString(), proofs: [...cashPhotos, cashSig].filter(Boolean) as string[] });
    setApproval("waiting");
    startApprovalPoll();
    router.refresh();
  }

  // PAID (enterprise redesign, aprubado 2026-08-16): parehong status card —
  // lahat ng 3 hakbang tapos na, hindi na hiwalay na maliit na kahon.
  if (paid) {
    return (
      <div className="overflow-hidden rounded-xl border border-emerald-300 bg-white shadow-sm">
        <div className="flex items-center justify-between gap-3 bg-emerald-700 px-4 py-2.5">
          <span className="text-[10.5px] font-extrabold uppercase tracking-[0.16em] text-emerald-50">Payment Complete</span>
          {orderNumber && <span className="font-mono text-[11.5px] font-bold text-emerald-200">{orderNumber}</span>}
        </div>
        <div className="px-5 pb-5 pt-6">
          <div className="flex flex-col items-center text-center">
            <span className="flex h-[52px] w-[52px] items-center justify-center rounded-full bg-emerald-600 text-2xl font-extrabold text-white shadow-[0_0_0_5px_#e8f5ee]">✓</span>
            <p className="mt-3.5 text-lg font-extrabold tracking-tight text-emerald-700">PAID</p>
            <p className="mt-0.5 text-xs text-muted">Payment collected — order marked paid · official receipt emailed.</p>
          </div>
          <div className="mx-1 mt-5 flex items-start">
            <div className="flex flex-1 flex-col items-center text-center">
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-[#caa45a] text-sm font-extrabold text-[#3a2e14] shadow-[0_0_0_4px_#fdf6e6]">✓</span>
              <span className="mt-1.5 text-[10px] font-extrabold uppercase tracking-wide text-[#8a6a1f]">Submitted</span>
            </div>
            <span className="mt-[15px] h-[3px] min-w-[24px] flex-1 rounded-full bg-gradient-to-r from-[#caa45a] to-[#8a6a1f]" />
            <div className="flex flex-1 flex-col items-center text-center">
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-[#caa45a] text-sm font-extrabold text-[#3a2e14] shadow-[0_0_0_4px_#fdf6e6]">✓</span>
              <span className="mt-1.5 text-[10px] font-extrabold uppercase tracking-wide text-[#8a6a1f]">Reviewed</span>
            </div>
            <span className="mt-[15px] h-[3px] min-w-[24px] flex-1 rounded-full bg-gradient-to-r from-[#8a6a1f] to-emerald-600" />
            <div className="flex flex-1 flex-col items-center text-center">
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-emerald-600 text-sm font-extrabold text-white shadow-[0_0_0_4px_#e8f5ee]">✓</span>
              <span className="mt-1.5 text-[10px] font-extrabold uppercase tracking-wide text-emerald-700">Recorded · Paid</span>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // WAITING FOR APPROVAL (enterprise redesign, aprubado 2026-08-16, artifact
  // a0d1df13): pagka-submit, MAWAWALA ang buong payment UI (pati channel tabs)
  // — itong status card na lang ang kita hanggang umaksyon ang aprubador:
  // header band + umiikot na loading + 3-hakbang na tracker + audit meta +
  // proof thumbnails + live auto-check strip.
  if (approval === "waiting") {
    const at = waitInfo?.at ? new Date(waitInfo.at) : null;
    const atLabel = at && !isNaN(at.getTime())
      ? `${at.toLocaleDateString("en-PH", { month: "short", day: "numeric" })} · ${at.toLocaleTimeString("en-PH", { hour: "numeric", minute: "2-digit" })}`
      : "—";
    return (
      <div className="overflow-hidden rounded-xl border border-[#caa45a] bg-white shadow-sm">
        {/* Header band */}
        <div className="flex items-center justify-between gap-3 bg-[#4a3b1a] px-4 py-2.5">
          <span className="text-[10.5px] font-extrabold uppercase tracking-[0.16em] text-[#f4ead8]">Payment Submitted — For Approval</span>
          {orderNumber && <span className="font-mono text-[11.5px] font-bold text-[#caa45a]">{orderNumber}</span>}
        </div>

        <div className="px-5 pb-4 pt-6">
          {/* Umiikot na loading + headline — sentro ng screen */}
          <div className="flex flex-col items-center text-center">
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
          </div>

          {/* 3-hakbang na tracker: Submitted ✓ → Under Review → Recorded·Paid */}
          <div className="mx-1 mb-4 mt-5 flex items-start">
            <div className="flex flex-1 flex-col items-center text-center">
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-[#caa45a] text-sm font-extrabold text-[#3a2e14] shadow-[0_0_0_4px_#fdf6e6]">✓</span>
              <span className="mt-1.5 text-[10px] font-extrabold uppercase tracking-wide text-[#8a6a1f]">Submitted</span>
              <span className="mt-0.5 text-[10px] text-muted">{atLabel}</span>
            </div>
            <span className="mt-[15px] h-[3px] min-w-[24px] flex-1 rounded-full bg-gradient-to-r from-[#caa45a] to-[#8a6a1f]" />
            <div className="flex flex-1 flex-col items-center text-center">
              <span className="relative flex h-8 w-8 items-center justify-center rounded-full border-[3px] border-amber-600 bg-white text-sm font-extrabold text-amber-700">
                2
                <span className="absolute inset-0 animate-ping rounded-full border-2 border-amber-600/40" aria-hidden />
              </span>
              <span className="mt-1.5 text-[10px] font-extrabold uppercase tracking-wide text-amber-700">Under Review</span>
              <span className="mt-0.5 text-[10px] text-muted">Payment Approval queue</span>
            </div>
            <span className="mt-[15px] h-[3px] min-w-[24px] flex-1 rounded-full bg-[#f4ead8]" />
            <div className="flex flex-1 flex-col items-center text-center">
              <span className="flex h-8 w-8 items-center justify-center rounded-full border border-dashed border-[#d9c992] bg-[#faf6ec] text-sm font-extrabold text-[#b3a26f]">3</span>
              <span className="mt-1.5 text-[10px] font-extrabold uppercase tracking-wide text-[#b3a26f]">Recorded · Paid</span>
              <span className="mt-0.5 text-[10px] text-muted">Ledger + official receipt</span>
            </div>
          </div>

          {/* Audit meta strip — pantay na grid columns (naiulat 2026-08-16 na
              hindi align ang flex na bersyon). */}
          <div className="grid grid-cols-[1fr_1fr_1fr_auto] items-center gap-x-4 rounded-xl border border-[#e6dcc4] bg-[#faf6ec]/70 px-4 py-2.5 max-sm:grid-cols-2 max-sm:gap-y-2">
            <div>
              <p className="text-[9px] font-extrabold uppercase tracking-[0.14em] text-[#a8842e]">Collected by</p>
              <p className="truncate text-[12.5px] font-semibold" title={waitInfo?.by || undefined}>{waitInfo?.by || "—"}</p>
            </div>
            <div>
              <p className="text-[9px] font-extrabold uppercase tracking-[0.14em] text-[#a8842e]">Submitted by</p>
              <p className="truncate text-[12.5px] font-semibold" title={waitInfo?.by || undefined}>{waitInfo?.by || "—"}</p>
            </div>
            <div>
              <p className="text-[9px] font-extrabold uppercase tracking-[0.14em] text-[#a8842e]">Submitted</p>
              <p className="whitespace-nowrap text-[12.5px] font-semibold">{atLabel}</p>
            </div>
            <span className="justify-self-end rounded-lg border border-[#caa45a] bg-[#fffaf0] px-3 py-1 font-mono text-[11.5px] font-extrabold text-[#8a6a1f]">{waitInfo?.method || "—"}</span>
          </div>

          {/* Proof thumbnails */}
          {(waitInfo?.proofs?.length ?? 0) > 0 && (
            <div className="mt-3 flex items-center gap-2">
              <span className="text-[9.5px] font-extrabold uppercase tracking-[0.13em] text-muted">Proof attached</span>
              {waitInfo!.proofs.slice(0, 5).map((u, i) => (
                // eslint-disable-next-line @next/next/no-img-element
                <img key={i} src={u} alt={`proof ${i + 1}`} className="h-10 w-10 rounded-lg border border-border bg-white object-cover" />
              ))}
              {waitInfo!.proofs.length > 5 && <span className="text-[10px] font-semibold text-muted">+{waitInfo!.proofs.length - 5}</span>}
            </div>
          )}
        </div>

        {/* Live auto-check strip */}
        <div className="flex items-center gap-2.5 border-t border-[#e6dcc4] bg-[#faf6ec] px-4 py-2.5 text-[11.5px] text-muted">
          <span className="h-2 w-2 animate-pulse rounded-full bg-amber-600" />
          <span>
            Auto-checking every few seconds — this screen flips to <b className="text-emerald-700">PAID</b> once approved,{" "}
            <b className="text-[#3a2e14]">even after a refresh or on another tablet.</b>
          </span>
        </div>
      </div>
    );
  }

  const inp = "rounded-md border border-border bg-surface px-2 py-1.5 text-sm outline-none focus:border-primary";
  return (
    <div className="rounded-lg border border-border bg-stone-50/60 p-4">
      <div className="mb-3 flex items-center justify-between border-b border-border/60 pb-2">
        <span className="text-sm font-medium text-muted">Balance to collect</span>
        <span className="text-lg font-bold text-primary">₱{peso2(balance)}</span>
      </div>

      {/* NA-REJECT ang huling submit — ipakita ang dahilan ng aprubador, tapos
          hahayaan ang installer na ayusin at mag-submit ulit (bagong token na). */}
      {approval === "rejected" && (
        <div className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2.5">
          <p className="text-[10.5px] font-extrabold uppercase tracking-wide text-red-700">Payment rejected</p>
          <p className="mt-0.5 text-xs leading-relaxed text-red-700">
            {rejectNote ? <>Reason from the approver: <b>{rejectNote}</b>.</> : "Rejected by the approver."}{" "}
            Fix the issue below and submit again.
          </p>
        </div>
      )}

      {/* Terminal (POS) tinanggal 2026-08-10; Maya QR (auto) tinanggal
          2026-08-16 — limang manual channels na lang, lahat dumadaan sa
          proof + Payment Approval. Naka-LOCK (walang tabs) kapag ang order ay
          may napili nang channel sa Create Order. */}
      {lockMode ? (
        <div className="mb-3 flex items-center justify-between rounded-lg border border-[#e6dcc4] bg-[#faf6ec] px-3 py-2">
          <span className="text-[10px] font-extrabold uppercase tracking-[0.13em] text-[#a8842e]">Payment channel</span>
          <span className="rounded-md border border-[#caa45a] bg-white px-2.5 py-0.5 font-mono text-xs font-extrabold text-[#8a6a1f]">{mode}</span>
        </div>
      ) : (
        <div className="mb-3 flex gap-1 rounded-lg border border-border bg-white p-1 text-xs font-medium">
          {(["Cash", "BDO", "BPI", "GCash", "Maya"] as const).map((m) => (
            <button key={m} type="button" onClick={() => setMode(m)} className={`flex-1 rounded-md px-2 py-1.5 ${mode === m ? "bg-primary text-primary-foreground" : "text-muted"}`}>{m}</button>
          ))}
        </div>
      )}

      {/* ENTERPRISE na hakbangan (2026-08-10): 1 Photo → 2 Signature → 3 Record.
          Bawat hakbang ay may bilang na selyo at status chip; ang Submit ay
          naka-disable hangga't kulang ang proof. Ang "Recorded by" ay ang
          naka-login na account — hindi tina-type, bahagi ng audit trail. */}
      <div className="space-y-2.5">
          {/* STEP 1 sa BDO/BPI/GCash: ipakita AGAD ang QR — dito magbabayad ang
              customer (scan sa sariling banking app). Ang mga QR card ay ang
              naka-upload sa Formal Quotation Builder assets. */}
          {isTransfer && (
            <CashStep
              n={stepNo("pay")}
              title={`${mode} QR — customer scans to pay`}
              done={stage !== "pay"}
              expanded={stage === "pay"}
              onHeaderClick={() => setStage("pay")}
            >
              {payQrs === null ? (
                <p className="py-6 text-center text-sm text-muted">Loading the {mode} QR…</p>
              ) : payQrs[mode as "BDO" | "BPI" | "GCash" | "Maya"] ? (
                <div className="flex flex-col items-center gap-2 text-center">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={payQrs[mode as "BDO" | "BPI" | "GCash" | "Maya"]!} alt={`${mode} QR`} className="w-full max-w-[360px] rounded-lg border border-border bg-white" />
                  <p className="text-sm font-bold text-[#3a2e14]">Pay ₱{peso2(balance)} via {mode}</p>
                  <p className="text-[11px] text-muted">Have the customer scan the QR and transfer the full balance.</p>
                  <button
                    type="button"
                    onClick={() => setStage("photo")}
                    className="w-full rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-accent hover:bg-primary/90"
                  >
                    Customer has paid — Next
                  </button>
                </div>
              ) : (
                // WALANG QR PA — huwag harangan ang koleksyon (naiulat
                // 2026-08-16: hindi makausad sa steps 2-4): may paalala na
                // mag-upload, pero may Next pa rin — pwedeng magbayad ang
                // customer sa sariling app / account number, proof pa rin ang
                // susunod na hakbang.
                <div className="space-y-2">
                  <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs leading-relaxed text-amber-700">
                    No {mode} QR uploaded yet — upload the {mode} QR card in <b>Formal Quotation</b> (assets card at the top) so it shows here.
                  </p>
                  <button
                    type="button"
                    onClick={() => setStage("photo")}
                    className="w-full rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-accent hover:bg-primary/90"
                  >
                    Customer has paid via {mode} — Next
                  </button>
                </div>
              )}
            </CashStep>
          )}

          {stepShown("photo") && (
          <CashStep
            n={stepNo("photo")}
            title={mode === "Cash" ? "Photo of the cash received" : `Photo of the ${mode} transfer receipt`}
            done={cashPhotos.length > 0}
            expanded={stage === "photo"}
            onHeaderClick={() => setStage("photo")}
          >
            <MultiImageUpload
              value={cashPhotos}
              onChange={(v) => {
                setCashPhotos(v);
                // Tapos ang litrato → tuloy agad sa pirma.
                if (v.length > 0 && stage === "photo") setStage("sig");
              }}
              camera
              folder={`cash-proof/${(orderNumber || `ORD${orderId}`).replace(/[^a-z0-9_-]/gi, "")}`}
            />
            <p className="mt-1.5 text-[11px] text-muted">{mode === "Cash" ? "Photograph the cash (or the cash with the customer) — this is the proof the payment was received." : `Photograph the ${mode} transfer confirmation / receipt on the customer's phone — this is the proof.`}</p>
          </CashStep>
          )}

          {stepShown("sig") && (
          <CashStep
            n={stepNo("sig")}
            title="Customer signature — payment confirmation"
            done={!!cashSig}
            expanded={stage === "sig"}
            onHeaderClick={() => setStage("sig")}
          >
            {cashSig ? (
              <div className="flex items-center gap-3">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={cashSig} alt="customer signature" className="h-14 rounded border border-border bg-white" />
                <button type="button" onClick={() => { setCashSig(null); setSigOpen(true); }} className="text-[11px] font-semibold text-danger underline">Clear — sign again</button>
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

            {/* Full-screen na pirmahan — malaki ang canvas para sa tablet. */}
            <Modal
              open={sigOpen}
              onClose={() => setSigOpen(false)}
              title="Customer Signature"
              description={`${orderNumber ?? ""} · Payment confirmation — please sign below`.trim()}
              size="2xl"
              footer={<div className="flex justify-end"><button type="button" onClick={() => setSigOpen(false)} className="rounded-lg border border-border px-4 py-2 text-sm font-medium hover:bg-stone-100">Cancel</button></div>}
            >
              <SignaturePad
                big
                value={null}
                folder={`cash-proof/${(orderNumber || `ORD${orderId}`).replace(/[^a-z0-9_-]/gi, "")}`}
                onChange={(url) => {
                  setCashSig(url);
                  if (url) {
                    setSigOpen(false);
                    // Napirmahan → tuloy sa pagtatala.
                    if (stage === "sig") setStage("record");
                  }
                }}
              />
            </Modal>
          </CashStep>
          )}

          {stepShown("record") && (
          <CashStep n={stepNo("record")} title="Submit for approval" done={false} last expanded onHeaderClick={() => setStage("record")}>
            {(collectorName || autoName) ? (
              <div className="mb-2 flex items-center justify-between rounded-lg border border-[#e6dcc4] bg-[#faf6ec] px-3 py-2">
                <span className="text-[11px] font-semibold uppercase tracking-wide text-[#7a5e1f]">Recorded by</span>
                <span className="text-sm font-bold text-[#3a2e14]">{collectorName || autoName}</span>
              </div>
            ) : (
              <input value={collectedBy} onChange={(e) => setCollectedBy(e.target.value)} placeholder="Collected by (name) *" className={`${inp} mb-2 w-full`} />
            )}
            <button
              type="button"
              onClick={payCash}
              disabled={busy || cashPhotos.length === 0 || !cashSig || !collectedBy.trim()}
              className="w-full rounded-lg bg-primary px-4 py-2.5 text-sm font-bold text-accent shadow-sm hover:bg-primary/90 disabled:opacity-50"
            >
              {busy
                ? "Submitting…"
                : cashPhotos.length === 0
                  ? `Take the proof photo first (Step ${stepNo("photo")})`
                  : !cashSig
                    ? `Customer signature needed (Step ${stepNo("sig")})`
                    : `Submit Payment · ₱${peso2(balance)}`}
            </button>
            <p className="mt-1.5 text-center text-[10.5px] text-muted">Sent to Payment Approval — the payment is recorded only once approved. The photo and signature attach to the order as permanent proof.</p>
          </CashStep>
          )}
      </div>
      {error && <p className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p>}
    </div>
  );
}

// Isang hakbang sa Cash proof flow — bilang na selyo (espresso/gold), pamagat,
// at status chip sa header. WIZARD: ang laman ay lumalabas lang kapag ITO ang
// kasalukuyang hakbang (expanded); ang tapos na ay naka-collapse na may tsek at
// pinipindot ang header para balikan/ayusin.
function CashStep({ n, title, done, last, expanded = true, onHeaderClick, children }: {
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

