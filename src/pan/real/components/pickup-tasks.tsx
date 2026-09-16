"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { cn } from "./ui";
import { MultiImageUpload } from "./multi-image-upload";
import { SpecFieldsView } from "./spec-fields-input";
import { specCategoryOf } from "./line-items-editor";
import { markPickedUp, rejectPickup, startPickup , markTransferDropped } from "@/app/pickup-task/actions";
import type { PickupData, PickupStop } from "@/app/pickup-task/data";

// PICKUP TASK — ang tab ng delivery team, kaparehong hugis ng Delivery Route:
// isang talahanayan kada lugar na pupuntahan. Isang biyahe ang isang lugar,
// kaya magkasama sa iisang talahanayan ang lahat ng kukunin doon.
//
// Ang pagpindot sa hilera ay bumubukas ng modal, gaya ng Delivery Route —
// doon nakikita ang buong detalye at doon ginagawa ang KUNIN o TANGGIHAN.
// Pareho silang nangangailangan ng litrato: ang tanggihan ay humaharang, hindi
// flag — ang hilera ay nananatili sa listahan hanggang may makuha.

// Ilan ang litratong kailangan bago maituring na nakuha. Tatlo, hindi lima gaya
// ng packing: ang packing ay tungkol sa naka-empake nang kahon (harap, likod,
// selyo, tatak), ito ay tungkol sa kondisyon ng bagay mismo sa sandali ng
// pagkarga — at ang driver ay nasa daan, hindi sa mesa.
const MIN_PICKUP_PHOTOS = 3;

// Kaparehong listahan ng Delivery QA: ang sira ay sira, nakita man sa workshop
// o sa pintuan ng customer.
const DEFECT_TYPES = ["Scratched", "Dented", "Chipped", "Cracked", "Wrong color", "Wrong size", "Missing parts", "Loose joints", "Torn / damaged fabric", "Stained", "Misaligned", "Broken", "Other"];

const TH = "px-3 py-2.5 text-center font-bold";
const TD = "px-3 py-2.5 text-center align-middle";

const fmtTime = (iso: string | null) =>
  iso ? new Date(iso).toLocaleTimeString("en-PH", { hour: "numeric", minute: "2-digit" }) : "";

// Buong petsa, hindi pinaikli: ang "Aug 24" ay hindi nagsasabi ng taon, at ang
// naka-print na listahan ay nabubuhay nang matagal.
const fmtDate = (d: string | null) =>
  d ? new Date(d + "T00:00:00").toLocaleDateString("en-PH", { month: "long", day: "numeric", year: "numeric" }) : null;

const fmtStamp = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString("en-PH", { month: "long", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" }) : "—";

// Ang warehouse stop ay isa kada LINYA pero nagbabahagi ng isang delivery row,
// kaya kasama ang `line_key` — kung wala, magkapareho ang key ng dalawang
// produkto ng iisang order at may nabubura na hilera.
const keyOf = (s: PickupStop) => `${s.source}:${s.declaration_id ?? s.delivery_id}:${s.line_key ?? ""}`;

// ANG TTS AY IPINAPASOK LANG SA BROWSER (naiulat na error 2026-08-24). Ang
// `"use client"` ay hindi nangangahulugang hindi ito nire-render sa server —
// nire-render ito, at ang @capacitor/core ay humahawak ng `window` sa mismong
// pag-load ng module. Dito, ang import ay nangyayari sa loob ng handler: nasa
// browser na tayo bago pa ito mabasa.
const tts = () => import("@/lib/native-tts");

// KAPAREHONG MAPA ng delivery, ibang patutunguhan: hindi ang customer kundi ang
// KUKUNAN. Walang naitalang coordinates ang workshop, kaya address ang
// ipinapasa — ang mapa mismo ang naghahanap nito.
// Ang mapa ng DROP LEG (2026-08-31): mula sa kinaroroonan ng driver papunta sa
// BODEGA — ang drop ay biyahe rin, gaya ng pickup. Walang collect/sid: ang
// selyo ay nasa Drop Proof card, hindi sa mapa; nabigasyon lang ito.
function dropMapSrc(stop: PickupStop, from?: { lat: number; lng: number } | null) {
  const q = new URLSearchParams();
  if (stop.drop_lat != null && stop.drop_lng != null) {
    q.set("dlat", String(stop.drop_lat));
    q.set("dlng", String(stop.drop_lng));
  } else if (stop.drop_address) {
    q.set("addr", stop.drop_address);
  }
  if (from) { q.set("olat", String(from.lat)); q.set("olng", String(from.lng)); }
  q.set("name", "Warehouse");
  if (stop.order_number) q.set("order", stop.order_number);
  // PUMIPIRMA ANG PAGDATING (0222) — parity sa pull-out: pagdating sa bodega,
  // pirma + litrato sa mapa (src=transfer → workshop_job), tapos ang Drop
  // Proof card ang magtatapos.
  q.set("collect", "1");
  q.set("src", "transfer");
  if (stop.job_id != null) q.set("sid", String(stop.job_id));
  q.set("v", "nav-0907e");
  return `/delivery-map.html?${q.toString()}`;
}

function pickupMapSrc(stop: PickupStop, sim = false, from?: { lat: number; lng: number } | null) {
  const q = new URLSearchParams();
  // ANG PIN MUNA, kung meron (0188). Ang address ng workshop ay hindi mahanap ng
  // geocoder — pumapatak ang dalawang GMA workshop sa iisang simbahan — kaya
  // ang naitalang punto ang tumpak. Ang address ay pambalik lang.
  if (stop.place_lat != null && stop.place_lng != null) {
    q.set("dlat", String(stop.place_lat));
    q.set("dlng", String(stop.place_lng));
  } else if (stop.place_address || stop.place) {
    q.set("addr", stop.place_address || stop.place);
  }
  // SAAN NAGSIMULA ANG DRIVER (0189). Kung wala ito, walang maiguguhit na ruta
  // ang mapa hangga't hindi dumarating ang unang GPS fix — at sa loob ng gusali
  // ay maaaring hindi ito dumating. Kapareho ng olat/olng ng delivery.
  // Ang kababasa lang na GPS ang mas sariwa kaysa sa naitala — ang hilera ay
  // hindi pa nagre-refresh sa sandaling bumukas ang mapa.
  const olat = from?.lat ?? stop.from_lat;
  const olng = from?.lng ?? stop.from_lng;
  if (olat != null && olng != null) {
    q.set("olat", String(olat));
    q.set("olng", String(olng));
  }
  q.set("name", stop.place);
  if (stop.order_number) q.set("order", stop.order_number);
  // SIMULATE DRIVE — ang mapa ay may sarili nang paandar nito (`?sim=1`), pero
  // walang buton kahit saan: kailangan itong i-type sa URL nang kamay. Dito ito
  // may pindutan, para makita ang buong biyahe nang hindi umaalis ng opisina.
  if (sim) q.set("sim", "1");
  // COLLECT — pagkuha ng tapos nang gamit. HINDI `pickup=1`: iyon ang Pickup
  // Rework, ang pagsundo ng sirang gamit sa customer. Ang `src`/`sid` ang
  // nagsasabi sa mapa kung aling talaan ang sesellyuhan pagkapirma.
  q.set("collect", "1");
  q.set("src", stop.source);
  const sid = stop.declaration_id ?? stop.delivery_id;
  if (sid != null) q.set("sid", String(sid));
  q.set("v", "nav-0907e");
  return `/delivery-map.html?${q.toString()}`;
}

export function PickupTasks({ data }: { data: PickupData }) {
  const router = useRouter();
  // Isang binuksang stop, gaya ng Delivery Route: ang hilera ay nagbubukas ng
  // modal, hindi ng nakaipit na panel.
  const [open, setOpen] = useState<PickupStop | null>(null);
  // Ang drop trip mula sa row-click (nakuha na, papuntang bodega).
  const [dropOpen, setDropOpen] = useState<PickupStop | null>(null);

  // ANG BUKAS NA MODAL AY SNAPSHOT (2026-08-27): pagkapirma sa mapa ay nagre-
  // refresh nga ang server data, pero ang `open` ay ang LUMANG stop pa rin —
  // "On the way" pa rin ang card hanggang isara't buksan muli. Kapag dumating
  // ang sariwang data, hanapin ang kaparehong stop at ipalit.
  useEffect(() => {
    const fresh = (cur: PickupStop | null) => {
      if (!cur) return cur;
      return data.groups.flatMap((g) => g.stops).find((s) => keyOf(s) === keyOf(cur)) ?? cur;
    };
    // Sinasadya ang setState dito: snapshot-sa-sariwang-data ang pattern — ang
    // bukas na modal ay pinapalitan ng kapareho niyang stop mula sa bagong
    // server data (hindi ito loop; may guard ang React sa parehong value).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setOpen(fresh);
    // Pati ang drop trip: pagkapirma sa mapa ng bodega, ang sariwang stop ang
    // may drop_arrived — kung luma ang hawak, "Start Drop" pa rin ang kita.
    setDropOpen(fresh);
  }, [data]);

  if (data.remaining === 0) {
    return (
      <div className="overflow-hidden rounded-xl border border-border bg-surface shadow-sm">
        <div className="bg-[#4a3b1a] px-4 py-2.5">
          <p className="text-xs font-bold uppercase tracking-wide text-[#f4ead8]">
            {data.team}
            <span className="ml-2 font-medium normal-case text-[#c9b896]">
              {data.picked > 0 ? `all ${data.picked} collected` : "nothing to pick up"}
            </span>
          </p>
        </div>
        <p className="px-4 py-10 text-center text-sm text-muted">
          {data.picked > 0
            ? "Everything on today's list has been collected — the stops are on the Delivery Route now."
            : "Items appear here once the customer confirms a delivery date. Stock builds appear as soon as they pass QC."}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {data.groups.map((g) => {
        const left = g.stops.length;
        return (
          <div key={g.place} className="overflow-hidden rounded-xl border border-border bg-surface shadow-sm">
            {/* Ang pamagat ay ang biyahe: saan pupunta, at ilan ang nakuha na. */}
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 bg-[#4a3b1a] px-4 py-2.5">
              <p className="text-xs font-bold uppercase tracking-wide text-[#f4ead8]">
                {g.place}
                <span className="ml-2 font-medium normal-case text-[#c9b896]">
                  {g.address || "no address set"}
                </span>
              </p>
              <div className="ml-auto flex items-center gap-2.5">
                <span className="text-[10px] font-bold uppercase tracking-widest text-[#c9b896]">To collect</span>
                <span className="text-[11px] font-bold tabular-nums text-[#f4ead8]">{left}</span>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full min-w-[1320px] border-collapse text-sm [&_td]:border-b [&_td]:border-r [&_td]:border-border [&_td:last-child]:border-r-0 [&_th]:border-b [&_th]:border-r [&_th]:border-[#6b5a2f] [&_th:last-child]:border-r-0">
                <thead>
                  <tr className="bg-[#5a4a26] text-[10px] uppercase tracking-widest text-[#e7dcc4]">
                    <th className={TH}>Order #</th>
                    <th className={TH}>SKU</th>
                    <th className={TH}>Photo</th>
                    <th className={TH}>Product Name</th>
                    <th className={TH}>Specification</th>
                    <th className={TH}>Category</th>
                    <th className={TH}>Qty</th>
                    <th className={TH}>Customer</th>
                    <th className={TH}>Pick Up From</th>
                    <th className={TH}>Deliver To</th>
                    <th className={TH}>Deliver On</th>
                    <th className={TH}>Status</th>
                    <th className={TH}>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {g.stops.map((s) => <Row key={keyOf(s)} stop={s} onOpen={() => (s.picked_at && s.to_warehouse ? setDropOpen(s) : setOpen(s))} onDrop={() => setDropOpen(s)} />)}
                </tbody>
              </table>
            </div>
          </div>
        );
      })}

      {/* ANG GATE, nakikita: ang order ay hindi bumubukas sa Delivery Route
          hangga't may natitirang item na hindi pa nakukuha. */}
      <div className="rounded-xl border border-[#caa45a] bg-[#f4ead8] px-4 py-3 text-sm text-[#8a6a1f]">
        <b>{data.picked} of {data.total} picked up.</b>
        {data.remaining > 0 && <span className="ml-1">{data.remaining} left on this list.</span>}
        {data.waiting.length > 0 && (
          <span className="ml-1">
            {data.waiting.map((w) => `${w.order_number} (${w.got} of ${w.of})`).join(", ")}
            {data.waiting.length === 1 ? " still has an item" : " still have items"} to collect — not on the route yet.
          </span>
        )}
      </div>

      {dropOpen && <DropTripModal stop={dropOpen} onClose={() => { setDropOpen(null); router.refresh(); }} />}
      {/* TULOY-TULOY NA BIYAHE (hiling 2026-08-31, "no need na mag close and
          open ulit ung row"): kapag papuntang bodega at nakuha na, ang BUKAS NA
          modal mismo ang nagiging Drop view — kapareho ng Rework (Pull Out).
          Pagka-Confirm ng pickup, refresh lang ang tinatawag; pagdating ng
          sariwang stop (picked_at na), ang render dito ang lilipat sa
          DropTripModal nang hindi nagsasara. */}
      {open && (open.picked_at && open.to_warehouse
        ? <DropTripModal stop={open} onClose={() => { setOpen(null); router.refresh(); }} />
        : (
          <PickupModal
            stop={open}
            team={data.team}
            onClose={() => setOpen(null)}
            onDone={() => {
              if (open.to_warehouse) router.refresh();
              else { setOpen(null); router.refresh(); }
            }}
          />
        ))}
    </div>
  );
}

function Row({ stop, onOpen, onDrop }: { stop: PickupStop; onOpen: () => void; onDrop: () => void }) {
  const done = !!stop.picked_at;
  const rejected = !!stop.rejected_at && !done;
  const deliverOn = fmtDate(stop.deliver_on);

  return (
    <tr
      onClick={onOpen}
      title="Open this pickup"
      className={cn(
        "cursor-pointer hover:bg-[#faf6ec]",
        done && "bg-emerald-50/60",
        rejected && "bg-amber-50/60",
      )}
    >
      {/* Ang daanan muna: kaninong order ito. Ang STOCK BUILD ay walang order —
          tanda ang nasa lugar nito. */}
      {/* TAG KADA KLASE NG BIYAHE (hiling 2026-09-01): STOCK build, REFUND
          haul (balik-benta), TO WAREHOUSE na MTO haul — isang tingin ay alam
          ng team kung anong biyahe ito. */}
      <td className={cn(TD, "whitespace-nowrap")}>
        {stop.stock ? (
          stop.refund
            ? <span className="rounded-full bg-rose-600 px-2 py-0.5 text-[9px] font-extrabold tracking-wide text-white">REFUND</span>
            : <span className="rounded-full bg-[#4a3b1a] px-2 py-0.5 text-[9px] font-extrabold tracking-wide text-[#f4ead8]">STOCK</span>
        ) : (
          <span className="inline-flex flex-col items-center gap-0.5">
            <span className="font-mono text-xs font-bold text-[#8a6a1f]">{stop.order_number ?? "—"}</span>
            {stop.to_warehouse && (
              <span className="rounded-full bg-[#e7dcc4] px-2 py-0.5 text-[9px] font-extrabold tracking-wide text-[#4a3b1a]">TO WAREHOUSE</span>
            )}
          </span>
        )}
      </td>
      <td className={cn(TD, "whitespace-nowrap font-mono text-[11px] font-bold text-[#8a6a1f]")}>
        {stop.sku || <span className="font-sans text-muted/50">—</span>}
      </td>
      <td className={TD}>
        {stop.item_image ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={stop.item_image} alt="" className="mx-auto h-10 w-10 rounded border border-border object-cover" />
        ) : (
          <div className="mx-auto h-10 w-10 rounded border border-dashed border-border bg-stone-50" />
        )}
      </td>
      {/* ANG PANGALAN AY HINDI PINAGPUPUTOL (2026-08-30). Ang rework na item
          ay dumarating bilang "Rework · RMA-000002 · PAN Accent Chair v.02" —
          isang mahabang string na pinuputol ng makitid na hanay bawat salita,
          anim na linyang patayo. Hatiin: ang pangalan sa sariling linya, ang
          Rework·RMA bilang maliit na chip sa ilalim. */}
      <td className={cn(TD, "min-w-[170px] font-semibold")}>
        {(() => {
          const m = stop.item.match(/^Rework · (RMA-\d+) · (.+)$/);
          if (!m) return stop.item;
          return (
            <span className="inline-flex flex-col items-center gap-1">
              <span>{m[2]}</span>
              {stop.refund
                ? <span className="whitespace-nowrap rounded-full bg-rose-50 px-2 py-0.5 text-[10px] font-bold text-rose-700 ring-1 ring-inset ring-rose-200">Refund · {m[1]}</span>
                : <span className="whitespace-nowrap rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-bold text-amber-700 ring-1 ring-inset ring-amber-200">Rework · {m[1]}</span>}
            </span>
          );
        })()}
      </td>
      {/* ANG BUONG BUILD ay nasa modal — dito ay isang linya lang. Ang labing-
          isang spec ng isang custom bed ay ginagawang tatlong beses na mas
          mataas ang hilera kaysa sa ruta na sinusundan nito, at ang listahan
          ay hindi na mabasa nang pahalang. Ang buo ay nasa tooltip at nasa
          modal, isang pindot ang layo. */}
      <td className={cn(TD, "max-w-[300px] truncate text-[11px]")} title={stop.specs.join(" · ")}>
        {stop.specs.length > 0
          ? <span className="text-muted">{stop.specs.join(" · ")}</span>
          : <span className="text-muted/50">—</span>}
      </td>
      <td className={cn(TD, "whitespace-nowrap text-[11px]")}>
        {stop.category || <span className="text-muted/50">—</span>}
      </td>
      <td className={cn(TD, "font-mono text-xs")}>{stop.qty}</td>
      <td className={TD}>{stop.stock ? <span className="text-muted/60">—</span> : (stop.customer || "—")}</td>
      {/* Nasa pamagat ng pangkat ito, pero nasa hilera rin: ang isang naka-print
          na listahan o isang na-screenshot na hilera ay dapat kumpleto. */}
      <td className={cn(TD, "max-w-[190px] truncate text-[11px]")} title={stop.place_address ?? undefined}>
        <span className="font-semibold">{stop.place}</span>
      </td>
      <td className={cn(TD, "max-w-[200px] truncate text-[11px]")} title={stop.deliver_to}>{stop.deliver_to}</td>
      <td className={cn(TD, "whitespace-nowrap font-mono text-[11px]")}>
        {deliverOn ?? <span className="font-sans text-muted/60">—</span>}
      </td>
      <td className={cn(TD, "whitespace-nowrap")}>
        {done ? (
          <>
            <span className="font-mono text-[10px] font-bold text-emerald-700">PICKED UP</span>
            <span className="block text-[10px] text-muted">
              {fmtTime(stop.picked_at)}
              {stop.photos.length > 0 && ` · ${stop.photos.length} photo${stop.photos.length === 1 ? "" : "s"}`}
            </span>
          </>
        ) : rejected ? (
          <>
            <span className="font-mono text-[10px] font-bold text-amber-700">REJECTED</span>
            <span className="block max-w-[9rem] text-[10px] text-muted">{stop.reject_reason}</span>
          </>
        ) : stop.arrived_at ? (
          <>
            <span className="font-mono text-[10px] font-bold text-emerald-700">ARRIVED</span>
            <span className="block text-[10px] text-muted">photograph the item</span>
          </>
        ) : stop.started_at ? (
          <span className="inline-flex items-center gap-1 font-mono text-[10px] font-bold text-[#8a6a1f]">
            <span className="inline-flex h-1.5 w-1.5 animate-pulse rounded-full bg-[#caa45a]" />
            ON THE WAY
          </span>
        ) : (
          <span className="font-mono text-[10px] font-bold text-muted">WAITING</span>
        )}
      </td>
      <td className={cn(TD, "whitespace-nowrap text-[11px] font-semibold text-[#8a6a1f]")} onClick={(e) => { if (done && stop.to_warehouse) e.stopPropagation(); }}>
        {/* ANG HULING HAKBANG NG HAUL (0220): nakuha na sa workshop — ang
            natitira ay ang pagdating sa bodega. Ang selyong ito ang
            nagpapapasok sa Warehouse QC · Workshop (IN); hanggang hindi
            napipindot, "nasa daan" pa ang gamit at wala sa tatanggapin. */}
        {/* IISANG MOUNT ANG MODAL (2026-08-31): dating may sariling kopya ng
            modal ang buton sa LOOB ng table cell — sa loob ng overflow-x-auto,
            nadudurog ang layout (lumulutang ang mga piraso sa labas ng card).
            Ngayon ang buton ay tumatawag sa parehong parent-level na modal na
            binubuksan ng row-click. */}
        {done && stop.to_warehouse && stop.job_id ? (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onDrop(); }}
            className="rounded-lg bg-[#4a3b1a] px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-[#f4ead8] hover:opacity-90"
            title="Drive it to the warehouse — navigate, then record the drop proof on arrival"
          >
            Dropped at Warehouse
          </button>
        ) : done ? <span className="text-muted/60">—</span> : "Open →"}
      </td>
    </tr>
  );
}

// ── MODAL ────────────────────────────────────────────────────────────────────
// Kaparehong anyo ng Delivery modal: overlay, malapad na card, mga seksyon na
// may SpecRows. Ang pinagkaiba ay ang tanong — hindi "paano ito naihatid?"
// kundi "nakuha na ba, at tama ba ang kinuha?".

// Hindi na gamit ang lumang Section — ang pickup modal ay tatlong-kolum na
// kapareho ng Drop; itinira ang function dahil maliit at baka balikan.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="border-b border-border p-5">
      <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">{title}</p>
      {children}
    </div>
  );
}

function PickupModal({ stop, team, onClose, onDone }: {
  stop: PickupStop;
  // Ang team ng pahinang ito — ang CLAIM (0218): sa unang Start ng isang
  // all-teams na stop, ang team na ito ang nagmamay-ari at nawawala ang stop
  // sa listahan ng iba.
  team: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const router = useRouter();
  // ANG DRAFT AY HINDI NAMAMATAY SA RELOAD (2026-09-01, "nag fill up nako neto
  // tapos need ulit fill up"): sa APK, ang pagbalik mula sa camera o isang
  // reload ay pumapatay sa local state — at ang kalahating napunan na proof ay
  // nabubura. Ang bawat pindot ay itinatago sa localStorage kada stop (ang
  // litrato ay URL na — naka-upload na sa storage sa sandaling idagdag), at
  // ibinabalik sa pagbukas. Binubura sa matagumpay na submit.
  const draftKey = `pickup-draft:${stop.source}:${stop.declaration_id ?? stop.delivery_id ?? 0}:${stop.line_key ?? ""}`;
  const draft = (() => {
    try {
      const raw = localStorage.getItem(draftKey);
      return raw ? JSON.parse(raw) as { mode?: "take" | "reject"; photos?: string[]; reason?: string; good?: string; defect?: string; remarks?: string; notes?: string } : null;
    } catch { return null; }
  })();
  const [mode, setMode] = useState<"take" | "reject">(draft?.mode ?? "take");
  const [photos, setPhotos] = useState<string[]>(Array.isArray(draft?.photos) ? draft.photos.filter((u): u is string => typeof u === "string") : []);
  const [reason, setReason] = useState(draft?.reason ?? "");
  // Ilan ang tinanggap at ilan ang may sira — kaparehong tanong ng QA ng
  // delivery. Nakadefault ang Good sa buong dami: iyon ang karaniwan, at ang
  // sira ang binibilang.
  const [good, setGood] = useState<string>(draft?.good ?? String(stop.qty));
  const [defect, setDefect] = useState<string>(draft?.defect ?? "");
  const [remarks, setRemarks] = useState(draft?.remarks ?? "");
  const [notes, setNotes] = useState(draft?.notes ?? "");
  useEffect(() => {
    try {
      if (photos.length || reason || remarks || notes || defect || mode === "reject") {
        localStorage.setItem(draftKey, JSON.stringify({ mode, photos, reason, good, defect, remarks, notes }));
      }
    } catch { /* puno o naka-block ang storage — tuloy pa rin */ }
  }, [draftKey, mode, photos, reason, good, defect, remarks, notes]);
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [showMap, setShowMap] = useState(false);
  const [minimized, setMinimized] = useState(false);
  // Maliit ang thumbnail (2026-08-29) — ang buong sukat ay isang pindot lang,
  // para sa pagkakataóng may gasgas o kulay talagang itinitingnan siya.
  const [bigImg, setBigImg] = useState(false);
  // Pagsasanay at pagsubok: umaandar ang buong ruta nang walang tunay na GPS.
  const [sim, setSim] = useState(false);
  // Ang GPS na nakuha sa mismong pindot — ginagamit agad, bago pa dumating ang
  // sariwang datos mula sa server.
  const [from, setFrom] = useState<{ lat: number; lng: number } | null>(null);
  // Optimistic: ang pindot ang naglilipat ng anyo, hindi ang paghihintay sa server.
  const [rolling, setRolling] = useState(false);

  const done = !!stop.picked_at;
  const rejected = !!stop.rejected_at && !done;
  const onTheWay = rolling || (!!stop.started_at && !done);
  // Nandoon na siya at pumirma — tapos na ang bahagi ng mapa.
  const hasArrived = !!stop.arrived_at && !done;

  // TURN-BY-TURN VOICE: hindi maabot ng mapa (iframe) ang native TTS, kaya ito
  // ang nagsasalin — kapareho ng delivery. Tingnan ang lib/native-tts.
  useEffect(() => {
    if (!showMap) return;
    void tts().then((m) => m.warmUpTts());
    function onSpeak(e: MessageEvent) {
      const m = e.data;
      if (!m || (m.type !== "nav-speak" && m.type !== "nav-speak-stop")) return;
      if (m.type === "nav-speak-stop") { void tts().then((t) => t.stopNav()); return; }
      void tts().then((t) => t.speakNav(String(m.text || "")));
    }
    // Pumirma ang driver SA LOOB ng mapa — nandoon na siya. Hindi pa tapos ang
    // pagkuha: isinasara ang mapa at ibinabalik siya sa Pickup Proof card, kung
    // saan bibilangin kung ilan ang tinanggap at ilan ang may sira.
    function onCollected(e: MessageEvent) {
      if (e.data?.type !== "item-collected") return;
      setShowMap(false);
      void tts().then((t) => t.stopNav());
      router.refresh();
    }
    window.addEventListener("message", onSpeak);
    window.addEventListener("message", onCollected);
    return () => {
      window.removeEventListener("message", onSpeak);
      window.removeEventListener("message", onCollected);
      void tts().then((t) => t.stopNav());
    };
  }, [showMap, router]);

  // Kunin ang kinaroroonan ngayon. Ibinabalik ang null kapag tinanggihan o
  // hindi maabot — bukas pa rin ang mapa, hihintayin na lang nito ang sariling
  // GPS stream.
  async function readFix(): Promise<{ lat: number; lng: number } | null> {
    try {
      const pos = await new Promise<GeolocationPosition>((res, rej) => {
        if (!navigator.geolocation) return rej(new Error("no geolocation"));
        navigator.geolocation.getCurrentPosition(res, rej, { enableHighAccuracy: true, timeout: 12000, maximumAge: 0 });
      });
      return { lat: pos.coords.latitude, lng: pos.coords.longitude };
    } catch { return null; }
  }

  // MULING PAGBUKAS. Ang naitalang pinagmulan ay kung saan siya noong UNANG
  // pindot — matagal na iyon, at malayo na siya ngayon. Sariwang basa muna,
  // saka bukas: kung hindi, magsisimula ang ruta sa lugar na iniwan na niya.
  function reopenMap() {
    setMinimized(false);
    start(async () => {
      const fix = await readFix();
      if (fix) setFrom(fix);
      setShowMap(true);
    });
  }

  // PAALIS NA. Kapareho ng Start Delivery: ang pindot ang gesture na nagbubukas
  // ng audio at ng GPS, at pagkatapos nito ay bukas na ang mapa.
  function clickStart() {
    void tts().then((t) => t.unlockWebSpeech());
    setTimeout(() => {
      try {
        (document.querySelector('iframe[title="Live pickup map"]') as HTMLIFrameElement | null)
          ?.contentWindow?.postMessage({ type: "audio-unlock" }, "*");
      } catch { /* ignore */ }
    }, 1200);
    setRolling(true);
    const id = stop.declaration_id ?? stop.delivery_id;
    start(async () => {
      // Hinihingi ang GPS DITO MISMO, sa loob ng pindot — isang pahintulot para
      // sa buong site, kaya nakakonekta na ang mapa pagbukas nito.
      const fix = await readFix();
      if (fix) setFrom(fix);
      setShowMap(true);
      if (id != null) await startPickup({ source: stop.source, id, team, start_lat: fix?.lat ?? null, start_lng: fix?.lng ?? null });
    });
  }

  function submit() {
    setErr(null);
    start(async () => {
      const id = stop.declaration_id ?? stop.delivery_id;
      if (id == null) { setErr("This stop has no record to update."); return; }
      // ANG BAGSAK AY MAY MUKHA (2026-09-01, "make sure natin na nag sasave"):
      // kapag nag-throw ang server action (putol na network sa APK, patay na
      // dev server), WALANG humuhuli noon — tahimik na tapos ang transition,
      // walang error na lumalabas, at iniisip ng driver na nakuha na gayong
      // walang naisulat. Ngayon: hawak ang throw, malinaw ang mensahe, at
      // buhay pa rin ang draft para isang pindot lang ang ulit.
      try {
        const res = mode === "take"
          ? await markPickedUp({
              source: stop.source, id, line_key: stop.line_key, photos,
              good: good.trim() === "" ? null : Number(good),
              defect: defect.trim() === "" ? null : Number(defect),
              remarks: remarks || null,
              notes: notes || null,
            })
          : await rejectPickup({ source: stop.source, id, reason, photos, notes: notes || null });
        if ("error" in res) { setErr(res.error); return; }
      } catch {
        setErr("Could not reach the server — NOTHING was saved. Check the connection and press Confirm again (your photos and notes are kept).");
        return;
      }
      try { localStorage.removeItem(draftKey); } catch { /* ok lang */ }
      onDone();
    });
  }

  // Kapareho ng Drop modal: label-value na hilera at ang hinating rework head
  // (pangalan lang ang pangalan, hiwalay ang RMA, tunay na kategorya).
  const field = (label: string, value: React.ReactNode) => (
    <div className="flex border-b border-border last:border-0">
      <span className="w-32 shrink-0 px-3 py-2.5 text-[10px] font-bold uppercase tracking-wide text-muted">{label}</span>
      <span className="px-3 py-2.5 text-sm font-medium">{value || "—"}</span>
    </div>
  );
  const line0 = stop.item.split("\n")[0];
  const rw = /^rework\s*·\s*(rma-[\w-]+)\s*·\s*(.+)$/i.exec(line0);
  const prodName = (rw ? rw[2] : line0).trim();
  const catShown = /^rework$/i.test(stop.category ?? "")
    ? specCategoryOf("", prodName) || stop.category
    : stop.category;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4" onClick={onClose}>
      <div className="my-6 w-full max-w-6xl rounded-2xl bg-surface shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between rounded-t-2xl bg-[#2b2620] px-5 py-3 text-[#f4ead8]">
          <div>
            <p className="text-sm font-bold">
              Pickup · {stop.stock ? "STOCK" : (stop.order_number ?? "—")} · {stop.stock ? stop.place : (stop.customer || stop.place)}
            </p>
            <p className="text-[11px] opacity-80">{line0}</p>
          </div>
          <button onClick={onClose} className="rounded-md px-2.5 py-1 text-sm font-bold hover:bg-white/10">×</button>
        </div>

        {/* TATLONG KOLUM, KAPAREHONG-KAPAREHO NG DROP MODAL (hiling 2026-08-31,
            "dapat ganto nalang din ung size mismo at ui mismo nung sa pick
            up"): ang gamit sa kaliwa, ang kasaysayan sa gitna, ang Live
            Tracking + TRIP + Pickup Proof sa kanan. Iisa na ang hulma ng
            pickup at drop — magkapatid na biyahe, magkapatid na mukha. */}
        <div className="grid gap-4 p-5 lg:grid-cols-3">
          {/* KALIWA — ang gamit. */}
          <div className="space-y-3">
            <div className="rounded-xl border border-border bg-white p-3">
              <p className="mb-2 text-[10px] font-bold uppercase tracking-wide text-muted">Item</p>
              <button
                type="button"
                onClick={() => setBigImg(true)}
                disabled={!stop.item_image}
                title={stop.item_image ? "View the photo full size" : undefined}
                className="mx-auto mb-3 block w-full disabled:cursor-default"
              >
                {stop.item_image
                  // eslint-disable-next-line @next/next/no-img-element
                  ? <img src={stop.item_image} alt="" className="mx-auto h-40 rounded-lg border border-border object-contain" />
                  : <span className="mx-auto flex h-40 items-center justify-center rounded-lg border border-dashed border-border text-xs text-muted">no photo</span>}
              </button>
              <div className="rounded-lg border border-border">
                {field("Product / Name", prodName)}
                {rw && field("RMA #", rw[1].toUpperCase())}
                {field("SKU", stop.sku)}
                {field("Category", catShown)}
                {field("Qty", String(stop.qty))}
              </div>
            </div>
            {stop.specs.length > 0 && (
              <div className="rounded-xl border border-border bg-white p-3">
                <SpecFieldsView
                  category={specCategoryOf(stop.category ?? "", stop.item)}
                  specs={stop.specs.join("\n")}
                />
              </div>
            )}
          </div>

          {/* GITNA — PICKUP HISTORY: pirma + litrato, gaya ng RMA/Drop. */}
          <div className="space-y-3">
            <div className="rounded-xl border border-border bg-[#faf6ec] p-4">
              <p className="mb-2 text-[10px] font-bold uppercase tracking-wide text-muted">Pickup History</p>
              {rejected && (
                <div className="mb-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs font-semibold text-amber-800">
                  Rejected {fmtStamp(stop.rejected_at)} — {stop.reject_reason}. It stays on the list until something is collected.
                </div>
              )}
              {stop.signature || stop.photos.length > 0 || done ? (
                <div className="rounded-lg border border-border bg-white p-3">
                  <div className="mb-2 flex items-center justify-between">
                    <p className="text-xs font-bold">{done ? `Picked up at ${stop.place}` : `Arrived at ${stop.place}`}</p>
                    <span className="text-[10px] text-muted">{fmtStamp(done ? stop.picked_at : (stop.arrived_at ?? stop.picked_at))}</span>
                  </div>
                  {done && <p className="mb-2 text-[11px] text-muted">by {stop.picked_by || stop.driver || "—"}</p>}
                  <div className="flex flex-wrap items-start gap-2">
                    {stop.signature && (
                      <div className="text-center">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={stop.signature} alt="signature" className="h-16 w-28 rounded border border-border bg-white object-contain" />
                        <span className="mt-0.5 block text-[9px] uppercase tracking-wide text-muted">Signature</span>
                      </div>
                    )}
                    {stop.photos.map((u, i) => (
                      <a key={i} href={u} target="_blank" rel="noreferrer">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={u} alt="" className="h-16 w-16 rounded border border-border object-cover hover:opacity-90" />
                      </a>
                    ))}
                  </div>
                  {done && (stop.good != null || stop.defect != null || stop.notes) && (
                    <div className="mt-2 border-t border-border pt-2 text-[11px] text-muted">
                      {stop.good != null && <span className="mr-3">Good: <b className="text-foreground">{stop.good}</b></span>}
                      {stop.defect != null && stop.defect > 0 && (
                        <span className="mr-3 font-semibold text-rose-700">Defect: {stop.defect}{stop.remarks ? ` · ${stop.remarks}` : ""}</span>
                      )}
                      {stop.notes && <span className="mt-1 block">{stop.notes}</span>}
                    </div>
                  )}
                </div>
              ) : (
                <p className="rounded-lg border border-dashed border-border bg-white/60 p-3 text-center text-xs text-muted">
                  No events yet — press Start Pickup to head out.
                </p>
              )}
            </div>
          </div>

          {/* KANAN — Live Tracking + TRIP + Pickup Proof. */}
          <div className="space-y-3">
            <div className="rounded-xl border border-[#caa45a] bg-[#fdf9ef] px-4 py-3">
              <p className="flex items-center gap-2 text-sm font-bold">Live Tracking
                <span className={cn(
                  "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold",
                  done ? "bg-emerald-100 text-emerald-700"
                    : hasArrived ? "bg-green-100 text-green-700"
                    : onTheWay || rejected ? "bg-amber-100 text-amber-700"
                    : "bg-stone-100 text-stone-600",
                )}>
                  <span className={cn(
                    "h-1.5 w-1.5 rounded-full",
                    done || hasArrived ? "bg-green-500" : onTheWay ? "animate-pulse bg-amber-500" : "bg-stone-400",
                  )} />
                  {done ? "Collected" : hasArrived ? "Arrived" : onTheWay ? "On the way" : rejected ? "Rejected" : "Waiting"}
                </span>
              </p>
              <p className="mt-0.5 text-xs text-muted">Pick up at <b className="text-foreground">{stop.place}</b>{stop.place_address ? ` — ${stop.place_address}` : ""}</p>
              {done ? (
                <div className="mt-2 w-full rounded-lg bg-emerald-100 px-4 py-2 text-center text-sm font-bold text-emerald-700">Collected — {fmtStamp(stop.picked_at)}</div>
              ) : hasArrived ? (
                <div className="mt-2 w-full cursor-not-allowed rounded-lg bg-green-100 px-4 py-2 text-center text-sm font-bold text-green-700">Arrived — at {stop.place}</div>
              ) : (
                <button
                  type="button"
                  onClick={onTheWay ? reopenMap : clickStart}
                  disabled={pending}
                  className="mt-2 w-full rounded-lg bg-[#4a3b1a] px-4 py-2 text-sm font-bold text-[#f4ead8] hover:opacity-90 disabled:opacity-50"
                >
                  {pending && !onTheWay ? "Starting…" : onTheWay ? "View Live Map" : "▶ Start Pickup"}
                </button>
              )}
              {!done && !hasArrived && !stop.place_address && (
                <p className="mt-1.5 text-center text-[11px] font-medium text-amber-700">
                  No address on file — the map will only have the name to search.
                </p>
              )}
            </div>

            <div className="rounded-xl border border-border bg-white">
              <p className="border-b border-border px-4 py-2 text-[10px] font-bold uppercase tracking-wide text-muted">Trip</p>
              {field("Pick up from", `${stop.place}${stop.place_address ? ` — ${stop.place_address}` : ""}`)}
              {field("Deliver to", stop.deliver_to)}
              {field("Driver", stop.driver ?? "—")}
              {stop.stock
                ? field("Why", "Stock build — no customer waiting; it is going into the warehouse.")
                : (
                  <>
                    {field("Customer", stop.customer || "—")}
                    {field("Deliver on", fmtDate(stop.deliver_on) ?? "—")}
                  </>
                )}
            </div>

            {/* PICKUP PROOF — parehong selyadong card, nasa kanang kolum na
                gaya ng Drop Proof. */}
            {!done && (() => {
              const onFile = Array.isArray(stop.photos) ? stop.photos.length : 0;
              const total = onFile + photos.length;
              const enough = total >= MIN_PICKUP_PHOTOS;
              const pct = Math.min(100, Math.round((total / MIN_PICKUP_PHOTOS) * 100));
              const rejecting = mode === "reject";
              return (
                <div className={cn(
                  "overflow-hidden rounded-xl border-2 shadow-lg transition-colors",
                  rejecting
                    ? "border-red-300 shadow-red-900/5"
                    : enough
                    ? "border-emerald-300 shadow-emerald-900/5"
                    : "border-[#caa45a] shadow-[0_0_0_4px_rgba(202,164,90,.12)]",
                )}>
                  <div className={cn(
                    "flex items-center justify-between gap-3 px-4 py-3",
                    rejecting
                      ? "bg-gradient-to-r from-red-700 to-red-800"
                      : enough
                      ? "bg-gradient-to-r from-emerald-600 to-emerald-700"
                      : "bg-gradient-to-r from-[#4a3b1a] to-[#3a2e12]",
                  )}>
                    <div className="leading-tight text-white">
                      <p className="text-sm font-bold tracking-wide">
                        {rejecting ? "Reject Proof" : "Pickup Proof"}
                      </p>
                      <p className="text-[10px] font-medium uppercase tracking-[0.18em] text-white/70">
                        {rejecting ? "Required to send it back" : "Required before dispatch"}
                      </p>
                    </div>
                    <span className={cn(
                      "inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-sm font-extrabold tabular-nums",
                      enough && !rejecting ? "bg-white text-emerald-700" : rejecting ? "bg-white text-red-700" : "bg-[#caa45a] text-[#3a2e12]",
                    )}>
                      {enough && !rejecting ? `✓ ${total} photos` : `${total} / ${MIN_PICKUP_PHOTOS}`}
                    </span>
                  </div>

                  <div className="bg-white p-4">
                    <div className="mb-3 flex gap-2">
                      <button
                        type="button"
                        onClick={() => { setMode("take"); setErr(null); }}
                        className={cn(
                          "flex-1 rounded-lg px-4 py-2 text-sm font-bold transition",
                          mode === "take" ? "bg-[#4a3b1a] text-[#f4ead8]" : "border border-border bg-surface text-muted hover:bg-stone-50",
                        )}
                      >
                        {rejected ? "Take the replacement" : "Pick up"}
                      </button>
                      <button
                        type="button"
                        onClick={() => { setMode("reject"); setErr(null); }}
                        className={cn(
                          "flex-1 rounded-lg px-4 py-2 text-sm font-bold transition",
                          rejecting ? "bg-danger text-white" : "border border-border bg-surface text-danger hover:bg-stone-50",
                        )}
                      >
                        Reject
                      </button>
                    </div>

                    <p className="mb-2.5 text-xs text-muted">
                      {rejecting
                        ? <>Photo proof of <b className="text-foreground">what is wrong</b>. {stop.source === "warehouse"
                            ? "It goes back to QC OUT so another unit can be picked."
                            : "It goes back to the workshop; nothing moves until it is fixed."}</>
                        : <>Photo proof of the item&apos;s <b className="text-foreground">condition as it is loaded</b>. Upload at least {MIN_PICKUP_PHOTOS} — front, back, any damage.</>}
                    </p>

                    <div className="mb-3 h-2 w-full overflow-hidden rounded-full bg-stone-100">
                      <div
                        className={cn("h-full rounded-full transition-all duration-500", rejecting ? "bg-danger" : enough ? "bg-emerald-500" : "bg-[#caa45a]")}
                        style={{ width: `${pct}%` }}
                      />
                    </div>

                    {rejecting && (
                      <input
                        value={reason}
                        onChange={(e) => setReason(e.target.value)}
                        placeholder="What is wrong with it? e.g. Torn cover on the left side"
                        className="mb-3 w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm"
                      />
                    )}

                    <MultiImageUpload value={photos} onChange={setPhotos} camera folder="pickup-photos" />

                    {!rejecting && (
                      <div className="mt-3 grid grid-cols-3 gap-3 rounded-lg border border-border bg-white p-3">
                        <label className="block">
                          <span className="mb-1 block text-[10px] font-extrabold uppercase tracking-[0.12em] text-[#a8842e]">Good</span>
                          <input
                            type="number" min={0}
                            value={good}
                            onChange={(e) => setGood(e.target.value)}
                            className="w-full rounded-lg border border-border bg-green-50 px-3 py-2 text-center text-sm"
                          />
                        </label>
                        <label className="block">
                          <span className="mb-1 block text-[10px] font-extrabold uppercase tracking-[0.12em] text-[#a8842e]">Defect</span>
                          <input
                            type="number" min={0}
                            value={defect}
                            onChange={(e) => setDefect(e.target.value)}
                            className={cn(
                              "w-full rounded-lg border border-border px-3 py-2 text-center text-sm",
                              Number(defect) > 0 ? "bg-rose-50 text-rose-700" : "bg-surface",
                            )}
                          />
                        </label>
                        <label className="block">
                          <span className="mb-1 block text-[10px] font-extrabold uppercase tracking-[0.12em] text-[#a8842e]">Remarks</span>
                          <select
                            value={remarks}
                            disabled={!(Number(defect) > 0)}
                            onChange={(e) => setRemarks(e.target.value)}
                            className={cn(
                              "w-full rounded-lg border bg-surface px-3 py-2 text-sm",
                              Number(defect) > 0 ? "border-rose-300" : "border-border text-muted",
                            )}
                          >
                            <option value="">{Number(defect) > 0 ? "— select defect —" : "— no defect —"}</option>
                            {DEFECT_TYPES.map((t) => <option key={t}>{t}</option>)}
                          </select>
                        </label>
                      </div>
                    )}

                    <label className="mt-3 block rounded-lg border border-border bg-white p-3">
                      <span className="mb-1 block text-[10px] font-extrabold uppercase tracking-[0.12em] text-[#a8842e]">Notes</span>
                      <textarea
                        value={notes}
                        onChange={(e) => setNotes(e.target.value)}
                        rows={2}
                        placeholder="Anything worth recording about this pickup"
                        className="w-full resize-y rounded-lg border border-border bg-surface px-3 py-2 text-sm"
                      />
                    </label>

                    {err && (
                      <p className="mt-3 rounded-lg bg-rose-50 px-3 py-2.5 text-sm font-bold text-rose-700 ring-2 ring-inset ring-rose-300">
                        {err}
                      </p>
                    )}

                    <div className="mt-3.5 flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3">
                      <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-700 ring-1 ring-inset ring-amber-600/20">
                        {rejected
                          ? `Rejected ${fmtStamp(stop.rejected_at)} — still to be collected`
                          : !enough
                          ? `${MIN_PICKUP_PHOTOS - total} more photo${MIN_PICKUP_PHOTOS - total === 1 ? "" : "s"} needed`
                          : "Not yet picked up — required before dispatch"}
                      </span>
                      <button
                        type="button"
                        disabled={pending || !enough || (rejecting && !reason.trim())}
                        onClick={submit}
                        className={cn(
                          "rounded-lg px-5 py-2.5 text-sm font-bold text-white shadow-sm transition active:scale-[0.98] disabled:opacity-50",
                          rejecting ? "bg-danger hover:opacity-90" : "bg-emerald-600 hover:bg-emerald-700",
                        )}
                      >
                        {pending ? "Saving…" : rejecting ? "Send it back" : "✓ Confirm pick up"}
                      </button>
                    </div>
                  </div>
                </div>
              );
            })()}
          </div>
        </div>
      </div>

      {/* BUONG SUKAT NA LARAWAN. Maliit na ang thumbnail sa itaas; kapag
          may itinitingnan talaga ang driver — gasgas, kulay, tahi — dito ito
          nakikita nang buo, nang walang isang libong pixel na inuupahan sa
          bawat pagbukas ng modal. */}
      {bigImg && stop.item_image && (
        <div className="fixed inset-0 z-[75] flex items-center justify-center bg-black/70 p-6" onClick={(e) => { e.stopPropagation(); setBigImg(false); }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={stop.item_image} alt={stop.item} className="max-h-full max-w-full rounded-xl bg-white object-contain p-2 shadow-2xl" />
        </div>
      )}

      {/* ANG MAPA — kaparehong buong-screen na nav ng delivery, kayang
          i-minimize para makita pa rin ang listahan habang nagmamaneho. Ang
          patutunguhan ay ang KUKUNAN, hindi ang customer. */}
      {showMap && (
        <div
          className={minimized ? "fixed bottom-4 right-4 z-[70]" : "fixed inset-0 z-[70] flex flex-col"}
          onClick={(e) => e.stopPropagation()}
        >
          <div className={minimized
            ? "flex h-[280px] w-[400px] max-w-[92vw] flex-col overflow-hidden rounded-xl bg-white shadow-2xl ring-1 ring-black/15"
            : "flex h-full w-full flex-col overflow-hidden bg-white"}>
            <div className="flex items-center justify-between bg-[#4a3b1a] px-4 py-2.5 text-[#f4ead8]">
              <div className="min-w-0">
                <div className="truncate text-sm font-bold">Pick up · {stop.place}</div>
                {!minimized && (
                  <div className="truncate text-[11px] opacity-80">
                    {stop.place_address || "no address set"} · {stop.item}
                  </div>
                )}
              </div>
              <div className="flex shrink-0 items-center gap-1">
                {!minimized && (
                  <button
                    type="button"
                    onClick={() => setSim((v) => !v)}
                    title="Drive the route without moving — for training and testing"
                    className={cn(
                      "rounded-md px-2.5 py-1 text-[11px] font-bold",
                      sim ? "bg-[#caa45a] text-[#2b2109]" : "hover:bg-white/10",
                    )}
                  >
                    {sim ? "Simulating" : "Simulate"}
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setMinimized((v) => !v)}
                  title={minimized ? "Maximize" : "Minimize"}
                  className="rounded-md px-2.5 py-1 text-[11px] font-bold hover:bg-white/10"
                >
                  {minimized ? "Maximize" : "Minimize"}
                </button>
                <button
                  type="button"
                  onClick={() => { setShowMap(false); setMinimized(false); void tts().then((t) => t.stopNav()); }}
                  title="Close the map"
                  className="rounded-md px-2.5 py-1 text-[11px] font-bold hover:bg-white/10"
                >
                  Close
                </button>
              </div>
            </div>
            {/* Ang IFRAME AY HINDI NAGRE-RELOAD kapag `src` lang ang nagbago:
                hindi ito React attribute kundi paglalayag. Kasama ang pinagmulan
                sa key para muling mabuo kapag dumating ang sariwang GPS —
                kung hindi, mananatili ang unang URL, na walang olat/olng. */}
            <iframe
              key={`${sim ? "sim" : "live"}:${from ? `${from.lat},${from.lng}` : "nofix"}`}
              src={pickupMapSrc(stop, sim, from)}
              title="Live pickup map"
              className="w-full flex-1 border-0"
              allow="geolocation; autoplay"
            />
          </div>
        </div>
      )}
    </div>
  );
}
// "Dumating sa bodega" — ang selyo ng dulo ng haul (0220). Maliit na buton sa
// hilera mismo; ang confirm() ay sapat: ang pagkuha na may litrato ang tunay
// na proof, ito ay ang pagdating lamang.
// Ang buong drop trip — KOPYA ng RMA pull-out review modal (2026-08-31,
// "ganto mismo need na need kong ui at behavior"): tatlong kolum — ang gamit
// sa kaliwa, ang kasaysayan sa gitna, ang Live Tracking + TRIP + Drop Proof
// sa kanan. Parehong pagkakasunod ng estado: Start Drop → mapa na pumipirma
// sa pagdating → "proof pending" → Drop Proof ang huling selyo.
function DropTripModal({ stop, onClose }: { stop: PickupStop; onClose: () => void }) {
  const router = useRouter();
  const [showMap, setShowMap] = useState(false);
  const [from, setFrom] = useState<{ lat: number; lng: number } | null>(null);
  // Kaparehong draft ng Pickup Proof: hindi nabubura ng reload ang kalahating
  // napunan na Drop Proof (2026-09-01).
  const dropDraftKey = `drop-draft:${stop.job_id ?? 0}`;
  const dropDraft = (() => {
    try {
      const raw = localStorage.getItem(dropDraftKey);
      return raw ? JSON.parse(raw) as { photos?: string[]; notes?: string } : null;
    } catch { return null; }
  })();
  const [photos, setPhotos] = useState<string[]>(Array.isArray(dropDraft?.photos) ? dropDraft.photos.filter((u): u is string => typeof u === "string") : []);
  const [notes, setNotes] = useState(dropDraft?.notes ?? "");
  useEffect(() => {
    try {
      if (photos.length || notes) localStorage.setItem(dropDraftKey, JSON.stringify({ photos, notes }));
    } catch { /* puno o naka-block ang storage — tuloy pa rin */ }
  }, [dropDraftKey, photos, notes]);
  const [err, setErr] = useState<string | null>(null);
  const [busy, start] = useTransition();

  // KAPAREHO NG PICKUP MODAL (2026-08-31): ang mapa ay iframe — pagkapirma sa
  // pagdating, `item-collected` ang ipinapasa nito sa parent. Walang nakikinig
  // dito noon, kaya "walang nangyayari" pagkatapos ng arrived + signature:
  // nakasulat na sa DB, pero bukas pa rin ang mapa at luma pa ang modal. Ngayon:
  // sara ang mapa, refresh ang server data — ang sariwang stop (drop_arrived)
  // ang magpapalit ng Live Tracking papuntang "Drop proof required".
  useEffect(() => {
    if (!showMap) return;
    void tts().then((m) => m.warmUpTts());
    function onSpeak(e: MessageEvent) {
      const m = e.data;
      if (!m || (m.type !== "nav-speak" && m.type !== "nav-speak-stop")) return;
      if (m.type === "nav-speak-stop") { void tts().then((t) => t.stopNav()); return; }
      void tts().then((t) => t.speakNav(String(m.text || "")));
    }
    function onCollected(e: MessageEvent) {
      if (e.data?.type !== "item-collected") return;
      setShowMap(false);
      void tts().then((t) => t.stopNav());
      router.refresh();
    }
    window.addEventListener("message", onSpeak);
    window.addEventListener("message", onCollected);
    return () => {
      window.removeEventListener("message", onSpeak);
      window.removeEventListener("message", onCollected);
      void tts().then((t) => t.stopNav());
    };
  }, [showMap, router]);

  const startDrop = () => {
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (pos) => { setFrom({ lat: pos.coords.latitude, lng: pos.coords.longitude }); setShowMap(true); },
        () => setShowMap(true),
        { enableHighAccuracy: true, timeout: 6000 },
      );
    } else setShowMap(true);
  };

  const submit = () => {
    setErr(null);
    start(async () => {
      // Kapareho ng Pickup Proof: ang thrown na server action ay hinuhuli at
      // sinasabi — hindi tahimik na nawawala ang pindot.
      try {
        const res = await markTransferDropped({ job_id: stop.job_id!, photos, notes: notes || null });
        if ("error" in res) { setErr(res.error); return; }
      } catch {
        setErr("Could not reach the server — NOTHING was saved. Check the connection and press Confirm again (your photos and notes are kept).");
        return;
      }
      try { localStorage.removeItem(dropDraftKey); } catch { /* ok lang */ }
      setShowMap(false);
      onClose();
      router.refresh();
    });
  };

  const fmtAt = (iso: string | null) => {
    if (!iso) return "";
    try { return new Date(iso).toLocaleString("en-PH", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", hour12: true }); } catch { return ""; }
  };
  const field = (label: string, value: string | null) => (
    <div className="flex border-b border-border last:border-0">
      <span className="w-32 shrink-0 px-3 py-2.5 text-[10px] font-bold uppercase tracking-wide text-muted">{label}</span>
      <span className="px-3 py-2.5 text-sm font-medium">{value || "—"}</span>
    </div>
  );

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4" onClick={() => !busy && onClose()}>
      <div className="my-6 w-full max-w-6xl rounded-2xl bg-surface shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between rounded-t-2xl bg-[#2b2620] px-5 py-3 text-[#f4ead8]">
          <div>
            <p className="text-sm font-bold">Drop · {stop.order_number ?? "STOCK"} · Warehouse</p>
            <p className="text-[11px] opacity-80">{stop.item.split("\n")[0]}</p>
          </div>
          <button type="button" onClick={onClose} className="rounded-md px-2.5 py-1 text-sm font-bold hover:bg-white/10">×</button>
        </div>

        <div className="grid gap-4 p-5 lg:grid-cols-3">
          {/* KALIWA — ang gamit, gaya ng RETURNED ITEM ng RMA modal. */}
          <div className="space-y-3">
            <div className="rounded-xl border border-border bg-white p-3">
              <p className="mb-2 text-[10px] font-bold uppercase tracking-wide text-muted">Item</p>
              {stop.item_image
                // eslint-disable-next-line @next/next/no-img-element
                ? <img src={stop.item_image} alt="" className="mx-auto mb-3 h-40 rounded-lg border border-border object-contain" />
                : <div className="mx-auto mb-3 flex h-40 items-center justify-center rounded-lg border border-dashed border-border text-xs text-muted">no photo</div>}
              {/* ANG PANGALAN AY PANGALAN LANG (kapareho ng Constructor table,
                  817d9d6): ang "Rework · RMA-000009 · PAN Sofa V.01" ay
                  hinahati — RMA # sa sariling hilera, at ang Category ay ang
                  tunay na kategorya ng produkto, hindi "Rework". */}
              {(() => {
                const line0 = stop.item.split("\n")[0];
                const rw = /^rework\s*·\s*(rma-[\w-]+)\s*·\s*(.+)$/i.exec(line0);
                const name = (rw ? rw[2] : line0).trim();
                const isRework = /^rework$/i.test(stop.category ?? "");
                const cat = isRework ? specCategoryOf("", name) || stop.category : stop.category;
                return (
                  <div className="rounded-lg border border-border">
                    {field("Product / Name", name)}
                    {rw && field("RMA #", rw[1].toUpperCase())}
                    {field("SKU", stop.sku)}
                    {field("Category", cat)}
                    {field("Qty", String(stop.qty))}
                  </div>
                );
              })()}
            </div>
            {/* PAREHONG SPECIFICATIONS CARD NG BUONG APP (hiling 2026-08-31,
                "gawin ganto mismo design") — SpecFieldsView, hindi sariling
                label-value table: numbered chip + "N filled" header, value
                boxes, ✓ kada hilera. Kapareho ng pickup modal sa itaas. */}
            {stop.specs.length > 0 && (
              <div className="rounded-xl border border-border bg-white p-3">
                <SpecFieldsView
                  category={specCategoryOf(stop.category ?? "", stop.item)}
                  specs={stop.specs.join("\n")}
                />
              </div>
            )}
          </div>

          {/* GITNA — PICKUP HISTORY: pirma + litrato kada dulo, gaya ng RMA. */}
          <div className="space-y-3">
            <div className="rounded-xl border border-border bg-[#faf6ec] p-4">
              <p className="mb-2 text-[10px] font-bold uppercase tracking-wide text-muted">Pickup History</p>
              <div className="rounded-lg border border-border bg-white p-3">
                <div className="mb-2 flex items-center justify-between">
                  <p className="text-xs font-bold">Picked up at {stop.place}</p>
                  <span className="text-[10px] text-muted">{fmtAt(stop.picked_at)}</span>
                </div>
                <div className="flex flex-wrap items-start gap-2">
                  {stop.signature && (
                    <div className="text-center">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={stop.signature} alt="signature" className="h-16 w-28 rounded border border-border bg-white object-contain" />
                      <span className="mt-0.5 block text-[9px] uppercase tracking-wide text-muted">Signature</span>
                    </div>
                  )}
                  {stop.photos.map((u, i) => (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img key={i} src={u} alt="" className="h-16 w-16 rounded border border-border object-cover" />
                  ))}
                </div>
              </div>
              {(stop.drop_signature || stop.drop_photos.length > 0) && (
                <div className="mt-3 rounded-lg border border-border bg-white p-3">
                  <p className="mb-2 text-xs font-bold">Arrived at warehouse</p>
                  <div className="flex flex-wrap items-start gap-2">
                    {stop.drop_signature && (
                      <div className="text-center">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={stop.drop_signature} alt="signature" className="h-16 w-28 rounded border border-border bg-white object-contain" />
                        <span className="mt-0.5 block text-[9px] uppercase tracking-wide text-muted">Signature</span>
                      </div>
                    )}
                    {stop.drop_photos.map((u, i) => (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img key={i} src={u} alt="" className="h-16 w-16 rounded border border-border object-cover" />
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* KANAN — Live Tracking + TRIP + Drop Proof, gaya ng RMA modal. */}
          <div className="space-y-3">
            <div className="rounded-xl border border-[#caa45a] bg-[#fdf9ef] px-4 py-3">
              <p className="text-sm font-bold">Live Tracking
                {stop.drop_arrived && <span className="ml-2 rounded-full bg-rose-100 px-2 py-0.5 text-[10px] font-bold text-rose-700">● At warehouse — proof pending</span>}
              </p>
              <p className="mt-0.5 text-xs text-muted">Drop at <b>Warehouse</b>{stop.drop_address ? ` — ${stop.drop_address}` : ""}</p>
              {stop.drop_arrived ? (
                <>
                  <div className="mt-2 w-full rounded-lg bg-stone-300 px-4 py-2 text-center text-sm font-bold text-stone-600">Drop proof required</div>
                  <p className="mt-1 text-center text-[11px] font-semibold text-rose-600">Save the drop proof below to hand the item over.</p>
                </>
              ) : (
                <button type="button" onClick={startDrop} className="mt-2 w-full rounded-lg bg-[#4a3b1a] px-4 py-2 text-sm font-bold text-[#f4ead8] hover:opacity-90">
                  ▶ Start Drop
                </button>
              )}
            </div>

            <div className="rounded-xl border border-border bg-white">
              <p className="border-b border-border px-4 py-2 text-[10px] font-bold uppercase tracking-wide text-muted">Trip</p>
              {field("Pick up from", `${stop.place}${stop.place_address ? ` — ${stop.place_address}` : ""}`)}
              {field("Deliver to", `Warehouse${stop.drop_address ? ` — ${stop.drop_address}` : ""}`)}
              {field("Driver", stop.picked_by ?? stop.driver)}
              {field("Deliver on", stop.deliver_on
                ? (() => { try { return new Date(stop.deliver_on.length <= 10 ? `${stop.deliver_on}T00:00:00` : stop.deliver_on).toLocaleDateString("en-PH", { month: "short", day: "numeric", year: "numeric" }); } catch { return stop.deliver_on; } })()
                : null)}
            </div>

            <div className="rounded-xl border-2 border-[#caa45a] bg-white">
              <div className="flex items-center justify-between rounded-t-[10px] bg-[#2b2620] px-4 py-2.5">
                <div>
                  <p className="text-sm font-bold text-[#f4ead8]">Drop Proof</p>
                  <p className="text-[9px] font-semibold uppercase tracking-wide text-[#c9b896]">Required to hand it to the warehouse</p>
                </div>
                <span className={cn("rounded-full px-2.5 py-0.5 text-xs font-bold", photos.length >= 3 ? "bg-emerald-100 text-emerald-700" : "bg-[#4a3b1a] text-[#f4ead8]")}>{photos.length >= 3 ? `✓ ${photos.length} photos` : `${photos.length} / 3`}</span>
              </div>
              <div className="p-4">
                <p className="mb-2 text-xs text-muted">Photo proof of the item&apos;s <b>condition as it is handed over</b>. Upload at least 3.</p>
                <MultiImageUpload value={photos} onChange={setPhotos} camera folder="transfer-drop-photos" />
                <label className="mt-3 block text-[10px] font-bold uppercase tracking-wide text-[#8a6a1f]">Notes</label>
                <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} placeholder="Anything the warehouse should know" className="mt-1 w-full rounded-lg border border-border px-3 py-2 text-sm" />
                {err && <p className="mt-2 rounded-lg bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-700 ring-1 ring-inset ring-rose-200">{err}</p>}
                <button type="button" disabled={busy || photos.length < 3} onClick={submit} className="mt-3 w-full rounded-lg bg-emerald-500 px-4 py-2 text-sm font-bold text-white hover:opacity-90 disabled:opacity-50">
                  {busy ? "Saving…" : photos.length < 3 ? `Add ${3 - photos.length} more photo${3 - photos.length === 1 ? "" : "s"}` : "✓ Confirm drop"}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      {showMap && (
        <div className="fixed inset-0 z-[70] flex flex-col" onClick={(e) => e.stopPropagation()}>
          <div className="flex h-full w-full flex-col overflow-hidden bg-white">
            <div className="flex items-center justify-between bg-[#4a3b1a] px-4 py-2.5 text-[#f4ead8]">
              <div className="min-w-0">
                <div className="truncate text-sm font-bold">Drop · Warehouse</div>
                <div className="truncate text-[11px] opacity-80">{stop.drop_address || "no address set"} · {stop.item.split("\n")[0]}</div>
              </div>
              <button type="button" onClick={() => setShowMap(false)} className="rounded-md px-2.5 py-1 text-[11px] font-bold hover:bg-white/10">Close</button>
            </div>
            <iframe
              key={from ? `${from.lat},${from.lng}` : "nofix"}
              src={dropMapSrc(stop, from)}
              title="Live drop map"
              className="w-full flex-1 border-0"
              allow="geolocation; autoplay"
            />
          </div>
        </div>
      )}
    </div>
  );
}
