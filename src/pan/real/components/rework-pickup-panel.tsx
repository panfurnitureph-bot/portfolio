"use client";

// PICKUP REWORK — ang Live Tracking + Pickup Proof card, sa MISMONG hugis ng
// Pickup Task (components/pickup-tasks.tsx). Baligtad ang biyahe:
//
//     Pickup Task    : workshop/bodega → customer   (paghatid)
//     Pickup REWORK  : CUSTOMER → workshop          (pagsundo ng sira)
//
// Dalawang leg, dalawang proof — kapareho ng Pickup Task:
//   leg "arrive" — nandoon na sa customer, kinuha ang sirang gamit
//   leg "drop"   — inihatid sa workshop na kukumpuni
//
// Ang mapa ay ang parehong Mapbox engine ng Delivery (`/delivery-map.html`).
//
// HATI ANG PROOF, kaparehong hati ng Pickup Task: ang PIRMA ay nakukuha SA MAPA
// (/api/delivery/pickup-proof) — nandoon ang driver, doon siya pumipirma. Ang
// LITRATO at ang BILANG ay dito sa card, via recordReworkPickupProof. Ang mga
// litrato ay IDINADAGDAG, hindi pinapalitan: may naitala na ang mapa.

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { cn } from "./ui";
import { MultiImageUpload } from "./multi-image-upload";
import { recordReworkPickupProof } from "@/app/rework/actions";
import type { ReworkRow } from "@/app/rework/data";

const MIN_PICKUP_PHOTOS = 3;

const fmtStamp = (iso: string | null) => {
  if (!iso) return "";
  try { return new Date(iso).toLocaleString("en-PH", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", hour12: true }); }
  catch { return ""; }
};

export function ReworkPickupPanel({ row, onOpenMap }: {
  row: ReworkRow;
  // Ang mapa ay hawak ng magulang (buong-screen na modal) — dito lang ito
  // hinihiling, para isa lang ang iframe sa page.
  onOpenMap: (leg: "customer" | "workshop") => void;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [photos, setPhotos] = useState<string[]>([]);
  const [good, setGood] = useState("1");
  const [defect, setDefect] = useState("");
  const [remarks, setRemarks] = useState("");
  const [notes, setNotes] = useState("");
  const [err, setErr] = useState<string | null>(null);

  const arrived = row.pickup_arrived;
  const dropped = row.pickup_dropped;
  const dropArrived = row.pickup_drop_arrived;
  const onTheWay = !arrived && /out for/i.test(row.pickup_status ?? "");

  // BUKOD ANG DALAWANG PROOF (2026-08-27). Ang mapa ang nagre-record ng arrival,
  // kaya hindi tumatakbo ang paglilinis sa submitProof — at ang litrato ng
  // PICKUP ay naiiwan sa form ng DROP, mukhang naka-upload na at mabubura pa.
  // Dalawang biyahe, dalawang katibayan: blangko ang form sa bawat leg. Ang
  // naitala na ay nasa Pickup History card sa kaliwa.
  useEffect(() => {
    setPhotos([]);
    setNotes("");
    setErr(null);
    // `proofOk`, hindi `arrived`: doon lumilipat ang leg ngayon. Kung `arrived`
    // ang susundin, malilinis ang form sa pagpirma sa mapa — kasama ang mga
    // litratong pinipili pa lang ng driver para sa PAREHONG leg.
  }, [row.pickup_proof_ok, dropped]);

  // ── Live Tracking ─────────────────────────────────────────────────────────
  // Dalawang leg ang sinasabi ng isang card: bago pumunta sa customer, at
  // pagkatapos kunin — papunta na sa workshop.
  //
  // ANG PROOF, HINDI ANG PAGDATING, ANG NAGBUBUKAS SA LEG 2 (hiling 2026-08-27).
  // Ang `arrived` ay totoo na sa pagpirma sa mapa, kaya lumalabas ang "Drop to
  // Workshop" bago pa maitala kung ANO ang kinuha at ilan ang may sira — at
  // kapag tumulak na siya, wala nang babalikan ang katibayan.
  const proofOk = row.pickup_proof_ok;
  // Dumating na sa kasalukuyang hantungan pero kulang pa ang litrato: sarado.
  const blocked = dropArrived || (arrived && !proofOk);
  const legWord = dropArrived ? "drop" : "pickup";
  const leg: "customer" | "workshop" = proofOk ? "workshop" : "customer";
  const place = proofOk ? (row.workshop_name ?? "Workshop") : (row.customer_name ?? "Customer");
  const placeAddr = proofOk ? row.workshop_address : row.address;

  const statusChip = dropped
    ? { text: "Dropped", dot: "bg-green-500", cls: "bg-green-100 text-green-700" }
    : dropArrived
      ? { text: "At workshop — proof pending", dot: "bg-rose-500 animate-pulse", cls: "bg-rose-100 text-rose-700" }
      : proofOk
      ? { text: "Item collected", dot: "bg-amber-500 animate-pulse", cls: "bg-amber-100 text-amber-700" }
      : arrived
        ? { text: "At customer — proof pending", dot: "bg-rose-500 animate-pulse", cls: "bg-rose-100 text-rose-700" }
        : onTheWay
          ? { text: "On the way", dot: "bg-amber-500 animate-pulse", cls: "bg-amber-100 text-amber-700" }
          : { text: "Waiting", dot: "bg-stone-400", cls: "bg-stone-100 text-stone-600" };

  async function submitProof(mode: "arrive" | "drop") {
    if (pending) return;
    if (photos.length < MIN_PICKUP_PHOTOS) {
      setErr(`Add at least ${MIN_PICKUP_PHOTOS} photos (${photos.length}/${MIN_PICKUP_PHOTOS} so far).`);
      return;
    }
    if (row.order_id == null) { setErr("This rework has no linked order."); return; }
    setErr(null);
    const orderId = row.order_id;
    start(async () => {
      const res = await recordReworkPickupProof({
        orderId,
        leg: mode,
        photos,
        good: mode === "arrive" ? Number(good) || 0 : null,
        defect: mode === "arrive" ? Number(defect) || 0 : null,
        remarks: mode === "arrive" ? (remarks || null) : null,
        notes: notes || null,
      });
      if ("error" in res) { setErr(res.error); return; }
      setPhotos([]);
      router.refresh();
    });
  }

  return (
    <div className="space-y-3">
      {/* ── Live Tracking ─────────────────────────────────────────────────── */}
      {!dropped && (
        <div className="rounded-xl border-2 border-[#caa45a] bg-gradient-to-b from-[#fffaf0] to-white p-3 shadow-[0_0_0_4px_rgba(202,164,90,.12)]">
          <div className="flex items-center gap-2 text-sm font-bold text-[#4a3b1a]">
            Live Tracking
            <span className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold", statusChip.cls)}>
              <span className={cn("h-1.5 w-1.5 rounded-full", statusChip.dot)} />
              {statusChip.text}
            </span>
          </div>
          <div className="mt-1.5 text-xs text-muted">
            {dropArrived
              ? <>At <b className="text-foreground">{place}</b> — record the drop proof below</>
              : proofOk
              ? <>Deliver to <b className="text-foreground">{place}</b> for repair</>
              : arrived
                ? <>At <b className="text-foreground">{place}</b> — record the pickup proof below</>
                : onTheWay
                  ? <>Navigating to <b className="text-foreground">{place}</b></>
                  : <>Pick up at <b className="text-foreground">{place}</b></>}
          </div>
          {/* NANDOON NA PERO KULANG PA ANG PROOF: sarado ang mapa. Pareho ang
              panuntunan sa DALAWANG biyahe (hiling 2026-08-28) — ang drop leg
              ay walang harang noon, kaya nakakapindot at nakakapirma ang driver
              sa workshop nang 0/3 pa ang Drop Proof, at pagkatapos wala nang
              babalikan ang katibayan kung ano ang inabot. */}
          <button
            type="button"
            onClick={() => onOpenMap(leg)}
            disabled={pending || blocked}
            title={blocked ? `Save the ${legWord} proof first — ${MIN_PICKUP_PHOTOS} photos` : undefined}
            className="mt-2 w-full rounded-lg bg-[#4a3b1a] px-3 py-2 text-xs font-bold text-[#f4ead8] hover:opacity-90 disabled:opacity-50"
          >
            {blocked
              ? `${legWord[0].toUpperCase()}${legWord.slice(1)} proof required`
              : proofOk
                ? "▶ Drop to Workshop"
                : (onTheWay ? "View Live Map" : "▶ Start Pickup")}
          </button>
          {blocked && (
            <p className="mt-1.5 text-center text-[11px] font-medium text-rose-700">
              {dropArrived
                ? "Save the drop proof below to hand the item over."
                : "Save the pickup proof below before leaving for the workshop."}
            </p>
          )}
          {!placeAddr && (
            <p className="mt-1.5 text-center text-[11px] font-medium text-amber-700">
              No address on file — the map will only have the name to search.
            </p>
          )}
        </div>
      )}

      {/* ── Trip ──────────────────────────────────────────────────────────── */}
      <div className="overflow-hidden rounded-xl border border-border">
        <div className="bg-stone-50 px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.18em] text-muted">Trip</div>
        <table className="w-full text-xs [&_td]:border-t [&_td]:border-border [&_td]:px-3 [&_td]:py-2">
          <tbody>
            <tr>
              <td className="w-32 text-[10px] uppercase tracking-wide text-muted">Pick up from</td>
              <td>
                <b className="text-foreground">{row.customer_name ?? "—"}</b>
                {row.address && <div className="text-muted">{row.address}</div>}
              </td>
            </tr>
            <tr>
              <td className="text-[10px] uppercase tracking-wide text-muted">Deliver to</td>
              <td>
                <b className="text-foreground">{row.workshop_name ?? "Workshop"}</b>
                {row.workshop_address && <div className="text-muted">{row.workshop_address}</div>}
              </td>
            </tr>
            {row.pickup_driver && (
              <tr>
                <td className="text-[10px] uppercase tracking-wide text-muted">Driver</td>
                <td className="font-semibold">{row.pickup_driver}</td>
              </tr>
            )}
            {row.pickup_date && (
              <tr>
                <td className="text-[10px] uppercase tracking-wide text-muted">Pick up on</td>
                <td className="font-semibold">
                  {new Date(`${row.pickup_date.slice(0, 10)}T00:00:00`).toLocaleDateString("en-PH", { month: "long", day: "numeric", year: "numeric" })}
                  {row.pickup_window ? ` · ${row.pickup_window}` : ""}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* ── Pickup Proof ──────────────────────────────────────────────────── */}
      {/* Dalawang beses itong hinihingi: pagkuha sa customer, at paghatid sa
          workshop. Pareho ng bilang ng litrato, para pareho ang katibayan. */}
      {!dropped && (() => {
        // ARRIVE hangga't kulang ang proof — hindi basta "arrived". Kung hindi,
        // lumilipat na sa Drop Proof ang form bago pa maitala ang pagkuha, at
        // ang leg 1 ay tuluyang nalalaktawan.
        const mode: "arrive" | "drop" = proofOk ? "drop" : "arrive";
        const enough = photos.length >= MIN_PICKUP_PHOTOS;
        return (
          <div className={cn(
            "overflow-hidden rounded-xl border-2",
            enough ? "border-emerald-500 shadow-[0_0_0_4px_rgba(16,185,129,.12)]" : "border-[#caa45a] shadow-[0_0_0_4px_rgba(202,164,90,.12)]",
          )}>
            <div className={cn(
              "flex items-center justify-between gap-3 px-4 py-3",
              enough ? "bg-gradient-to-r from-emerald-600 to-emerald-700" : "bg-gradient-to-r from-[#4a3b1a] to-[#3a2e12]",
            )}>
              <div className="leading-tight text-white">
                <p className="text-sm font-bold tracking-wide">{mode === "drop" ? "Drop Proof" : "Pickup Proof"}</p>
                <p className="text-[10px] font-medium uppercase tracking-[0.18em] text-white/70">
                  {mode === "drop" ? "Required to hand it to the workshop" : "Required before it leaves the customer"}
                </p>
              </div>
              <span className={cn(
                "inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-sm font-extrabold tabular-nums",
                enough ? "bg-white text-emerald-700" : "bg-[#caa45a] text-[#3a2e12]",
              )}>
                {enough ? `✓ ${photos.length} photos` : `${photos.length} / ${MIN_PICKUP_PHOTOS}`}
              </span>
            </div>

            <div className="bg-white p-4">
              <p className="mb-2.5 text-xs text-muted">
                {mode === "drop"
                  ? <>Photo proof of the item&apos;s <b className="text-foreground">condition as handed over</b>. Upload at least {MIN_PICKUP_PHOTOS}.</>
                  : <>Photo proof of the <b className="text-foreground">damage and how it is loaded</b>. Upload at least {MIN_PICKUP_PHOTOS} — front, back, the defect.</>}
              </p>
              <MultiImageUpload value={photos} onChange={setPhotos} camera folder="pickup-photos" />

              {mode === "arrive" && (
                <div className="mt-3 grid grid-cols-3 gap-2">
                  <label className="block">
                    <span className="mb-1 block text-[10px] font-bold uppercase tracking-wide text-[#a8842e]">Good</span>
                    <input type="number" min={0} value={good} onChange={(e) => setGood(e.target.value)}
                      className="w-full rounded-md border border-emerald-200 bg-emerald-50/40 px-2 py-1.5 text-sm tabular-nums outline-none focus:border-primary" />
                  </label>
                  <label className="block">
                    <span className="mb-1 block text-[10px] font-bold uppercase tracking-wide text-[#a8842e]">Defect</span>
                    <input type="number" min={0} value={defect} onChange={(e) => setDefect(e.target.value)}
                      className="w-full rounded-md border border-border bg-surface px-2 py-1.5 text-sm tabular-nums outline-none focus:border-primary" />
                  </label>
                  <label className="block">
                    <span className="mb-1 block text-[10px] font-bold uppercase tracking-wide text-[#a8842e]">Remarks</span>
                    <input value={remarks} onChange={(e) => setRemarks(e.target.value)} placeholder="— no defect —"
                      className="w-full rounded-md border border-border bg-surface px-2 py-1.5 text-sm outline-none focus:border-primary" />
                  </label>
                </div>
              )}

              <label className="mt-3 block">
                <span className="mb-1 block text-[10px] font-bold uppercase tracking-wide text-[#a8842e]">Notes</span>
                <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2}
                  placeholder={mode === "drop" ? "Anything the workshop should know" : "Anything worth recording about this pickup"}
                  className="w-full rounded-md border border-border bg-surface px-2 py-1.5 text-sm outline-none focus:border-primary" />
              </label>

              {err && <p className="mt-2 rounded-lg bg-rose-50 px-3 py-2 text-xs font-medium text-rose-700">{err}</p>}

              <button
                type="button"
                onClick={() => submitProof(mode)}
                disabled={pending || !enough}
                className="mt-3 w-full rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-bold text-white shadow-sm hover:opacity-90 disabled:opacity-50"
              >
                {pending
                  ? "Recording…"
                  : !enough
                    ? `Add ${MIN_PICKUP_PHOTOS - photos.length} more photo${MIN_PICKUP_PHOTOS - photos.length === 1 ? "" : "s"}`
                    : mode === "drop" ? "✓ Dropped at the workshop" : "✓ Picked up from the customer"}
              </button>
            </div>
          </div>
        );
      })()}

      {/* Tapos na ang pagsundo — walang natitirang gagawin dito. */}
      {dropped && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-4 text-center">
          <p className="text-sm font-bold text-emerald-700">Dropped at {row.workshop_name ?? "the workshop"}</p>
          <p className="mt-1 text-xs text-emerald-600">
            {fmtStamp(row.pickup_date)} — the repair, QC and redelivery follow automatically.
          </p>
        </div>
      )}
    </div>
  );
}
