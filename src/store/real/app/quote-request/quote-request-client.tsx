"use client";

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import Image from "next/image";
import Link from "next/link";
import StreetSuggest from "@/components/StreetSuggest";
import AddressSearch, { type PlaceDetail } from "@/components/AddressSearch";
import { matchCity } from "@/lib/city-match";
import { groupBuildLines } from "@/lib/build-groups";
import { categoryTitle } from "@/lib/products";
import { pinMismatch } from "@/lib/pin-match";
import type { PickedLocation } from "@/components/LocationPicker";
import { useStore } from "@/components/store";
import { formatPrice, type SiteContent } from "@/lib/products";
import { messengerHandle, messengerUrl } from "@/lib/messenger";

// Map = client-only (Leaflet umaasa sa window) — walang SSR. Kapareho ng
// checkout: doon lang ito naka-import, kaya walang dagdag na bigat sa ibang
// pahina.
const LocationPicker = dynamic(() => import("@/components/LocationPicker"), {
  ssr: false,
  loading: () => (
    <div className="mb-3 flex h-64 w-full items-center justify-center rounded border border-stone/40 bg-sand/40 text-sm text-stone">
      Loading map…
    </div>
  ),
});

// Ang region ay hinahango sa province — kapareho ng checkout, para iisa ang
// gawi ng dalawang form. Kapag naghiwalay sila, ang customer na dumaan sa
// dalawa ay makakakita ng dalawang magkaibang paraan ng paglalagay ng address.
const REGION_OF: Record<string, string> = {
  "Laguna": "CALABARZON (Region IV-A)", "Batangas": "CALABARZON (Region IV-A)",
  "Cavite": "CALABARZON (Region IV-A)", "Rizal": "CALABARZON (Region IV-A)",
  "Quezon": "CALABARZON (Region IV-A)",
  "Metro Manila (NCR)": "Metro Manila (NCR)", "Bulacan": "Central Luzon (Region III)",
};

function Field({
  label, value, onChange, placeholder, inputMode, err, autoComplete,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  inputMode?: "tel" | "numeric";
  err?: string;
  autoComplete?: string;
}) {
  return (
    <div className="py-1">
      <span className="mb-1 block text-[11px] font-bold text-stone">{label}</span>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        inputMode={inputMode}
        autoComplete={autoComplete}
        className={`w-full rounded-lg border bg-transparent px-3 py-2 text-sm focus:border-cognac focus:outline-none ${err ? "border-red-500" : "border-sand"}`}
      />
      {err && <span className="mt-1 block text-[11px] font-medium text-red-600">{err}</span>}
    </div>
  );
}

export default function QuoteRequestClient({ site }: { site: SiteContent }) {
  const { quote, removeFromQuote, quoteTotal, clearQuote } = useStore();
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => setHydrated(true), []);

  // HATI ANG PANGALAN, kapareho ng checkout — ganoon din ang hinihingi ng
  // delivery paperwork, at ang isang field na "Maria Clara Santos" ay hindi
  // masasabi kung alin ang apelyido.
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [mobile, setMobile] = useState("");
  // Ang FB name ay REQUIRED sa checkout; dito ay hindi — ang request ay
  // nagbubukas ng Messenger thread, kaya nariyan na ang FB identity. Ang
  // paghadlang dito ay paghingi ng bagay na nasa kamay na natin.
  const [fbName, setFbName] = useState("");
  const [fbLink, setFbLink] = useState("");
  const [province, setProvince] = useState("");
  const [city, setCity] = useState("");
  // BUONG ADDRESS, hindi lang province/city. Dito na ipinapadala ang request,
  // at ang eksaktong lugar ang nagtatakda ng delivery fee sa quotation —
  // "Biñan, Laguna" lang ay hindi sapat para ma-ruta ng team.
  const [barangay, setBarangay] = useState("");
  const [street, setStreet] = useState("");
  const [postal, setPostal] = useState("");
  const [landmark, setLandmark] = useState("");
  const [region, setRegion] = useState("");
  // Ang eksaktong tuldok sa mapa — ang "9173 Brgy Maduya" ay hindi mahahanap
  // ng driver; ang pin ay mahahanap.
  // Ang BUONG sagot ng picker, hindi lang ang coordinates: kailangan ang
  // bayan at lalawigan para masabi kung tugma ito sa mga dropdown.
  const [pin, setPin] = useState<PickedLocation | null>(null);
  // Opisyal na PSGC barangay list bawat "Province|City" — static file sa
  // /public, pareho ng checkout.
  const [brgyData, setBrgyData] = useState<Record<string, string[]>>({});
  useEffect(() => {
    fetch("/barangays.json").then((r) => r.json()).then(setBrgyData).catch(() => {});
  }, []);
  const [sending, setSending] = useState(false);
  // m.me link ng naipadalang request — pindutan kapag hinarang ang popup.
  const [messengerLink, setMessengerLink] = useState<string | null>(null);
  // Ang tanging bagay na nakikita ng customer kapag hindi tumuloy ang
  // Messenger. Kung wala ito, ang pagpindot sa Send ay walang epekto sa
  // screen — at walang paraang malaman kung nakarating ba o hindi.
  const [sendErr, setSendErr] = useState("");
  const [errs, setErrs] = useState<Record<string, string>>({});

  const PROVINCES =
    (site as unknown as { shipping?: { provinces?: { name: string; cities: { name: string; fee: number }[] }[] } }).shipping
      ?.provinces ?? [];
  const cityList = PROVINCES.find((p) => p.name === province)?.cities ?? [];
  const shipFee = cityList.find((c) => c.name === city)?.fee ?? null;
  const brgyOptions = brgyData[`${province}|${city}`] ?? [];
  const handle = messengerHandle((site as unknown as { social?: { facebook?: string } }).social?.facebook);

  // Ang buong address, sa pagkakasunod na sinusulat sa Pilipinas — ito ang
  // napupunta sa quotation at siyang binabasa ng delivery team.
  const fullAddress = [street.trim(), barangay, city, province, postal.trim()].filter(Boolean).join(", ");

  // ── ISANG PINDOT MULA SA HANAPAN ──────────────────────────────────────────
  // Ang buong address ay pinupunan mula sa isang napiling lugar. Ang mahirap na
  // bahagi ay ang BAYAN: ang shipping fee ay galing sa listahan ng admin, at ang
  // pagkakasulat doon ay hindi laging pareho ng sinasabi ng Google ("Santa Cruz"
  // vs "Sta Cruz / Pila"). Ang matchCity ang nagtutugma; kapag talagang walang
  // katugma, WALANG ipinapalagay na bayad — nananatiling blangko ang City at ang
  // dropdown ang bahala, kaysa magpakita ng maling halaga.
  const [searchNote, setSearchNote] = useState("");
  function applyPlace(d: PlaceDetail) {
    setSearchNote("");
    if (d.postal) setPostal(d.postal);
    if (d.barangay) setBarangay(d.barangay);
    if (d.street || d.name) setStreet(d.street || d.name);

    const prov = PROVINCES.find((p) => p.name.toLowerCase() === (d.province || "").toLowerCase());
    if (prov) {
      setProvince(prov.name);
      setRegion(REGION_OF[prov.name] ?? "");
      const hit = matchCity(d.city, prov.cities);
      if (hit) {
        setCity(hit);
        // BARANGAY MULA SA LUGAR (2026-09-14): hinahanap ang opisyal na barangay
        // ng bayan sa barangay/kalye/buong address ng napili ("Mayor's Boulevard,
        // Maduya" → Maduya) — dati blangko ang dropdown at humihinto sa
        // "complete the highlighted fields". Tinatanggal din sa kalye.
        const opts = brgyData[`${prov.name}|${hit}`] ?? [];
        const norm = (x: string) => x.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
        const hay = [d.barangay, d.street, d.name, d.formatted].filter(Boolean).map((x) => norm(String(x)));
        const found = opts.find((o) => { const n = norm(o); return n.length >= 3 && hay.some((h) => (" " + h + " ").includes(" " + n + " ")); })
          ?? (d.barangay ? opts.find((o) => norm(o) === norm(d.barangay)) : undefined);
        if (found) {
          setBarangay(found);
          const st = (d.street || d.name || "");
          const cleaned = st.split(",").map((x) => x.trim()).filter((x) => x && norm(x) !== norm(found)).join(", ");
          if (cleaned !== st) setStreet(cleaned || st);
        }
      } else {
        setCity("");
        setSearchNote(`We don't deliver to ${d.city || "this area"} yet — pick the nearest town below.`);
      }
    } else if (d.province) {
      setProvince("");
      setCity("");
      setSearchNote(`We don't deliver to ${d.province} yet — we cover Metro Manila and Calabarzon for now.`);
    }

    // Ang pin ay dumadala sa mapa sa napiling lugar; ang customer ang mag-a-adjust
    // papunta sa mismong bahay — doon nagsisimula ang tumpak na address.
    if (Number.isFinite(d.lat) && Number.isFinite(d.lng)) {
      setPin({ lat: d.lat as number, lng: d.lng as number, address: d.formatted || d.name });
    }
  }

  // Binura ang hanapan → mawawala rin ang lahat ng pinunan nito. Kung hindi,
  // may naiiwang bayan at bayad na walang kaugnayan sa nakikita ng customer sa
  // taas — at wala siyang paraan para malaman kung alin ang totoo.
  function clearPlace() {
    setSearchNote("");
    setRegion("");
    setProvince("");
    setCity("");
    setBarangay("");
    setStreet("");
    setPostal("");
    setPin(null);
  }

  async function send() {
    // WALANG MAAGANG RETURN DITO. Ang naunang `if (!handle) return` ay
    // tumitigil BAGO ang relay papunta sa IMS — kaya nang ang Facebook sa
    // site.json ay naiwang "https://facebook.com" (walang pangalan ng page),
    // ang pagpindot sa Send ay walang ginagawa: walang Messenger, WALANG MTO
    // row, at walang mensahe sa customer. Ang buong build na pinaghirapan ay
    // nawawala nang tahimik.
    //
    // Ang request ay dapat MAKARATING SA IMS kahit hindi mabuksan ang
    // Messenger — doon ito nagiging quotation, at ang thread ay puwedeng
    // habulin mamaya sa mobile o sa Facebook name.
    // LAHAT KAILANGAN dito (maliban sa landmark): dito na ipinapadala ang
    // request, at ang eksaktong address ang nagtatakda ng delivery fee sa
    // quotation. Wala nang ibang pagkakataong itanong ito.
    const e: Record<string, string> = {};
    // TUNAY NA PANGALAN AT NUMERO (2026-09-06): ang browser autofill ay
    // naglalagay ng email sa First name at teksto sa Mobile, at dinadala iyon
    // ng quotation nang buo ("panfurnitureph@gmail.com PAN" ang pangalan).
    // May "@" o link — hindi pangalan. (Dati /@|https?:///i: ang "//" ay naging
    // comment, kaya laging totoo at pulang-pula ang First/Last name.)
    const looksEmail = (v: string) => /@|https?:\/\//i.test(v);
    // Digits lang (bawat + at espasyo ay tinatanggal); 09xxxxxxxxx o 639xxxxxxxxx.
    const phDigits = mobile.replace(/[^0-9]/g, "");
    if (!firstName.trim()) e.firstName = "Required";
    else if (looksEmail(firstName)) e.firstName = "Type your first name, not an email";
    if (!lastName.trim()) e.lastName = "Required";
    else if (looksEmail(lastName)) e.lastName = "Type your last name, not an email";
    if (!mobile.trim()) e.mobile = "Required";
    else if (!/^(09[0-9]{9}|639[0-9]{9})$/.test(phDigits)) e.mobile = "Enter an 11-digit PH mobile number (09xx xxx xxxx)";
    if (!province) e.province = "Required";
    if (!city) e.city = "Required";
    if (!barangay.trim()) e.barangay = "Required";
    if (!street.trim()) e.street = "Required";
    if (!postal.trim()) e.postal = "Required";
    setErrs(e);
    if (Object.keys(e).length) return;
    setSendErr("");
    setSending(true);
    // ANG TAB AY BINUBUKSAN SA MISMONG CLICK (2026-09-06, "pag sinend ko wala
    // nangyayari"): ang window.open PAGKATAPOS ng await fetch ay wala nang user
    // gesture — hinaharang ng popup blocker ng Chrome/Edge sa desktop, kaya
    // naitatala ang MTO pero hindi bumubukas ang Messenger. Bukas na ang tab
    // habang naghihintay; ilalagay ang m.me URL pagkatapos. Sa mobile ay
    // same-tab pa rin (location.href).
    const isMobile = /Android|iPhone|iPad/i.test(navigator.userAgent);
    const pre = !isMobile && handle ? window.open("about:blank", "_blank") : null;
    if (pre) { try { pre.document.write("<p style=\"font:14px system-ui;padding:24px\">Opening Messenger\u2026</p>"); } catch { /* cross-origin later */ } }
    const slots = quote.map(({ id: _id, summary: _s, state: _st, ...rest }) => rest);
    let mtoRef: string | null = null;
    try {
      const res = await fetch("/api/send-mto", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          // Ang unang produkto ay nasa ugat pa rin: may lumang IMS build sa
          // gitna ng deploy na `build` lang ang binabasa.
          sku: slots[0]?.sku,
          slug: slots[0]?.slug,
          name: slots[0]?.name,
          category: slots[0]?.category,
          image: slots[0]?.image ?? null,
          // BUONG ADDRESS, hindi "City, Province" lang — ito ang idinidikit sa
          // quotation at ginagamit sa pagruruta. Ang auto delivery-fee match sa
          // IMS ay naghahanap ng pangalan ng city/province sa loob nito, kaya
          // gumagana pa rin ito sa mas mahabang teksto.
          address: landmark.trim() ? `${fullAddress} (${landmark.trim()})` : fullAddress,
          contact: mobile.trim() || null,
          customer: [firstName.trim(), lastName.trim()].filter(Boolean).join(" ") || null,
          fb_name: fbName.trim() || null,
          fb_link: fbLink.trim() || null,
          // Ang tuldok sa mapa — ito ang mahahanap ng driver, hindi ang teksto.
          address_lat: pin?.lat ?? null,
          address_lng: pin?.lng ?? null,
          build: slots[0]?.build,
          builds: slots,
        }),
        signal: AbortSignal.timeout(20000),
      });
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean; mto_number?: string };
      if (data.ok && data.mto_number) mtoRef = data.mto_number;
    } catch {
      /* relay down — Messenger link pa rin ang fallback */
    }
    setSending(false);

    // HINDI NAKARATING SA AMIN: huwag linisin ang listahan. Ang pagbura ng
    // build na walang nakatanggap ay nagtatapon ng gawaing hindi na mababawi —
    // walang draft, walang history, wala nang mababalikan ang customer.
    if (!mtoRef) {
      try { pre?.close(); } catch { /* nakasara na */ }
      setSendErr(
        "We could not send your request just now. Your builds are still here — please check your connection and try again.",
      );
      return;
    }

    // Naipadala na — linisin, para hindi maisama sa susunod na request.
    clearQuote();

    // WALANG MESSENGER PERO NASA AMIN NA: ang request ay ligtas. Sabihin ito,
    // huwag mag-iwan ng blangkong pahina — akala ng customer ay nabigo ang lahat.
    if (!handle) {
      setSendErr(`Request ${mtoRef} received. Our team will reply to you shortly.`);
      return;
    }

    const url = messengerUrl(handle, `mto_${mtoRef}`);
    setMessengerLink(url);
    if (isMobile) { window.location.href = url; return; }
    if (pre && !pre.closed) { try { pre.location.href = url; return; } catch { /* bumagsak sa ibaba */ } }
    const w = window.open(url, "_blank", "noopener,noreferrer");
    // Hinarang ng popup blocker — may pindutan sa ibaba para sa customer.
    if (!w) setSendErr(`Request ${mtoRef} received. Tap "Open Messenger" to continue the conversation with our team.`);
  }

  // Ang listahan ay galing sa localStorage kaya blangko sa unang render;
  // walang ipinapakitang "walang laman" hangga't hindi pa nababasa — kung
  // hindi, kumukurap ang mensahe bago lumitaw ang tunay na listahan.
  if (!hydrated) {
    return <div className="mx-auto max-w-6xl px-6 py-16" />;
  }

  if (!quote.length) {
    return (
      <div className="mx-auto max-w-6xl px-6 py-16">
        <h1 className="mb-2 text-2xl font-semibold">Your quote request</h1>
        <p className="mb-6 text-sm text-stone">
          Nothing here yet. Configure a made-to-order piece and choose <b className="text-ink">Add to request</b> to
          price several together.
        </p>
        <Link
          href="/collections/bed"
          className="inline-block rounded border border-ink px-5 py-3 text-xs font-bold uppercase tracking-widest2 transition-colors hover:bg-ink hover:text-cream"
        >
          Browse made to order
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl px-6 py-8">
      <nav className="mb-6 text-xs text-stone">
        <Link href="/" className="hover:text-cognac">Home</Link>
        <span className="mx-2">/</span>
        <span className="text-ink">Your quote request</span>
      </nav>

      <div className="grid gap-8 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        {/* ── ANG MGA PRODUKTO, BUONG BUILD ── */}
        <div>
          <h1 className="text-2xl font-semibold">Your quote request</h1>
          <p className="mb-5 text-sm text-stone">
            {quote.length} {quote.length === 1 ? "product" : "products"} · one delivery
          </p>

          {quote.map((b, i) => (
            <div key={b.id} className="flex gap-4 border-b border-sand py-5 last:border-0">
              <span className="w-4 shrink-0 pt-1 text-xs tabular-nums text-stone">{i + 1}</span>
              <span className="relative h-16 w-16 shrink-0 overflow-hidden rounded border border-sand bg-linen">
                {b.image ? <Image src={b.image} alt="" fill sizes="64px" className="object-cover" /> : null}
              </span>

              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                  <span className="font-semibold">{b.name}</span>
                  {b.category && (
                    <span className="text-[10px] uppercase tracking-widest2 text-stone">{categoryTitle(b.category)}</span>
                  )}
                  <span className="ml-auto font-bold tabular-nums">
                    {b.build?.priced && b.build?.total ? formatPrice(b.build.total) : "For quotation"}
                  </span>
                  {/* EDIT — balik sa made-to-order ng MISMONG produkto, dala
                      ang slot id: pinapalitan nito ang item na ito imbes na
                      magdagdag ng bago. */}
                  <span className="flex shrink-0 items-center gap-3 text-xs">
                    <Link href={`/products/${b.slug}?edit=${b.id}`} className="font-semibold text-cognac hover:underline">
                      Edit
                    </Link>
                    <button
                      type="button"
                      onClick={() => removeFromQuote(b.id)}
                      aria-label={`Remove ${b.name} from your request`}
                      className="text-stone hover:text-ink"
                    >
                      ✕
                    </button>
                  </span>
                </div>

                {/* BAWAT LINYA, hindi pinutol na buod — dito tinitingnan ng
                    customer kung tama ang pagkakabuo ng pangalawang kama. */}
                {groupBuildLines(b.build?.lines ?? []).map((g) => (
                  <div key={g.title} className="mt-2">
                    <p className="text-[9px] font-extrabold uppercase tracking-widest2 text-cognac">{g.title}</p>
                    <ul className="mt-0.5 space-y-0.5">
                      {g.lines.map((l) => (
                        <li key={l.label} className="text-[12px] leading-snug text-stone">
                          {l.label}
                          {Number(l.price) > 0 && (
                            <span className="ml-1.5 text-[10px] font-semibold text-cognac">
                              +{formatPrice(Number(l.price))}
                            </span>
                          )}
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            </div>
          ))}

          <div className="mt-4 flex items-baseline border-t-2 border-ink pt-3">
            <span className="text-sm font-bold text-stone">Estimate, before delivery</span>
            <span className="ml-auto text-xl font-extrabold tabular-nums">
              {quoteTotal > 0 ? formatPrice(quoteTotal) : "For quotation"}
            </span>
          </div>
          <p className="mt-2 rounded bg-linen px-3 py-2 text-xs text-stone">
            An estimate only. Our team replies on Messenger with a formal quotation confirming the final total.
          </p>
        </div>

        {/* ── TINATANONG MINSAN, HINDI KADA PRODUKTO ──
            LAHAT KAILANGAN (maliban sa landmark): dito na ipinapadala ang
            request at wala nang ibang pagkakataong itanong ito. Ang eksaktong
            address ang nagtatakda ng delivery fee sa quotation at siyang
            binabasa ng delivery team — hindi sapat ang "City, Province". */}
        <div className="lg:sticky lg:top-6 lg:self-start">
          <div className="rounded-lg border border-sand p-4">
            <p className="mb-2 text-[10px] font-extrabold uppercase tracking-widest2 text-cognac">Where to deliver</p>

            <div className="grid grid-cols-2 gap-2">
              <Field label="First name" value={firstName} onChange={setFirstName} placeholder="First name" err={errs.firstName} autoComplete="given-name" />
              <Field label="Last name" value={lastName} onChange={setLastName} placeholder="Last name" err={errs.lastName} autoComplete="family-name" />
            </div>
            <Field label="Mobile" value={mobile} onChange={setMobile} placeholder="09XX XXX XXXX" inputMode="tel" err={errs.mobile} autoComplete="tel-national" />

            {/* Naka-lock sa Philippines, gaya ng checkout — doon lang tayo
                naghahatid, at ang pagpapakita nito ay nagsasabi niyon nang
                hindi kailangang itanong. */}
            <div className="py-1">
              <span className="mb-1 block text-[11px] font-bold text-stone">Country</span>
              <select value="PH" disabled className="w-full rounded-lg border border-sand bg-sand/40 px-3 py-2 text-sm text-stone">
                <option value="PH">Philippines</option>
              </select>
            </div>

            {/* ── HANAPAN MUNA ────────────────────────────────────────────
                Isang pindot at napupunan ang lahat ng nasa ibaba, pati ang pin
                at ang shipping fee. Ang mga dropdown ay nananatili para sa
                pag-aayos — at para sa lugar na hindi mahanap ng search. */}
            <div className="py-1">
              <AddressSearch onPick={applyPlace} onClear={clearPlace} />
              {searchNote ? (
                <p className="-mt-1 mb-2 rounded bg-cognac/10 px-3 py-2 text-[11px] font-medium leading-snug text-cognac">{searchNote}</p>
              ) : (
                <p className="-mt-1 mb-2 text-[11px] leading-snug text-stone">
                  Type a house, school, church, or town — this fills in the address below. Puwede ring punan nang manu-mano.
                </p>
              )}
            </div>

            {/* EKSAKTONG HANAY NG CHECKOUT: Region → Province → City → Barangay
                → Street → Postal. Ang region ay hinahango sa province, kaya
                ang pagpili ng alinman sa dalawa ay nagtatakda ng isa pa. */}
            <div className="py-1">
              <span className="mb-1 block text-[11px] font-bold text-stone">Region</span>
              <select
                value={region}
                onChange={(e) => { setRegion(e.target.value); setProvince(""); setCity(""); setBarangay(""); }}
                className="w-full rounded-lg border border-sand bg-transparent px-3 py-2 text-sm focus:border-cognac focus:outline-none"
              >
                <option value="">— Select —</option>
                {Array.from(new Set(PROVINCES.map((p) => REGION_OF[p.name] ?? "Other"))).map((r) => (
                  <option key={r} value={r}>{r}</option>
                ))}
              </select>
            </div>

            <div className="py-1">
              <span className="mb-1 block text-[11px] font-bold text-stone">Province</span>
              <select
                value={province}
                onChange={(e) => {
                  setProvince(e.target.value);
                  setCity("");
                  setBarangay("");
                  if (e.target.value) setRegion(REGION_OF[e.target.value] ?? "");
                }}
                className={`w-full rounded-lg border bg-transparent px-3 py-2 text-sm focus:border-cognac focus:outline-none ${errs.province ? "border-red-500" : "border-sand"}`}
              >
                <option value="">— Select —</option>
                {PROVINCES.filter((p) => !region || (REGION_OF[p.name] ?? "Other") === region).map((p) => (
                  <option key={p.name} value={p.name}>{p.name}</option>
                ))}
              </select>
            </div>

            <div className="py-1">
              <span className="mb-1 block text-[11px] font-bold text-stone">City / Town</span>
              <select
                value={city}
                onChange={(e) => { setCity(e.target.value); setBarangay(""); }}
                disabled={!province}
                className={`w-full rounded-lg border bg-transparent px-3 py-2 text-sm focus:border-cognac focus:outline-none disabled:opacity-50 ${errs.city ? "border-red-500" : "border-sand"}`}
              >
                <option value="">{province ? "— Select —" : "Select a province first"}</option>
                {cityList.map((c) => (<option key={c.name} value={c.name}>{c.name}</option>))}
              </select>
            </div>

            {/* Opisyal na PSGC list kapag alam ang city; kung wala, tinitipa —
                huwag hadlangan ang customer sa listahang hindi kumpleto. */}
            <div className="py-1">
              <span className="mb-1 block text-[11px] font-bold text-stone">Barangay</span>
              {brgyOptions.length > 0 ? (
                <select
                  value={barangay}
                  onChange={(e) => setBarangay(e.target.value)}
                  disabled={!city}
                  className={`w-full rounded-lg border bg-transparent px-3 py-2 text-sm focus:border-cognac focus:outline-none disabled:opacity-50 ${errs.barangay ? "border-red-500" : "border-sand"}`}
                >
                  <option value="">{city ? "— Select —" : "Select a city first"}</option>
                  {brgyOptions.map((b) => (<option key={b} value={b}>{b}</option>))}
                </select>
              ) : (
                <input
                  value={barangay}
                  onChange={(e) => setBarangay(e.target.value)}
                  disabled={!city}
                  placeholder={city ? "Type your barangay" : "Select a city first"}
                  className={`w-full rounded-lg border bg-transparent px-3 py-2 text-sm focus:border-cognac focus:outline-none disabled:opacity-50 ${errs.barangay ? "border-red-500" : "border-sand"}`}
                />
              )}
            </div>

            {/* Typeahead ng kalye — naka-scope sa napiling barangay/city, at
                inililipat ang pin kapag pumili. Parehong bahagi ng checkout. */}
            <div className="py-1">
              <StreetSuggest
                label="Street / House no."
                value={street}
                onChange={setStreet}
                onPick={(loc) => { setPin({ lat: loc.lat, lng: loc.lng, address: loc.address }); setErrs((e) => ({ ...e, street: "" })); }}
                context={[barangay, city, province].filter(Boolean).join(", ")}
                bias={pin}
                placeholder="House no., street, subdivision"
                error={errs.street}
              />
            </div>

            <Field label="Postal code" value={postal} onChange={setPostal} placeholder="4024" inputMode="numeric" err={errs.postal} />
            <Field
              label="Landmark / delivery notes (optional)"
              value={landmark}
              onChange={setLandmark}
              placeholder="e.g. blue gate, across the sari-sari store, call on arrival"
            />
            {/* OPTIONAL, hindi tulad ng checkout. Ang request ay nagbubukas ng
                Messenger thread, kaya nariyan na ang FB identity — ang
                paghingi nito bilang kailangan ay paghadlang para sa bagay na
                hawak na natin. Nariyan pa rin para sa taong mas gustong
                sabihin ito nang maaga. */}
            <div className="grid grid-cols-2 gap-2">
              <Field label="Facebook name (optional)" value={fbName} onChange={setFbName} placeholder="Name on Facebook" />
              <Field label="Profile link (optional)" value={fbLink} onChange={setFbLink} placeholder="facebook.com/username" />
            </div>

            {shipFee !== null && (
              <p className="mt-2 flex items-baseline gap-2 rounded bg-linen px-3 py-2 text-xs">
                <span className="text-stone">Estimated shipping to {city}</span>
                <span className="ml-auto font-bold text-cognac">{formatPrice(shipFee)}</span>
              </p>
            )}
            <p className="mt-2 text-[11px] leading-snug text-stone">
              Delivery is quoted <b className="text-ink">once for the whole request</b> — one van, one fee. Final fee is
              confirmed after we check your exact address.
            </p>
          </div>

          {/* MAPA — ang eksaktong lokasyon, hindi lang ang address. Ang
              "9173 Brgy Maduya" ay hindi mahahanap ng driver; ang pin ay
              mahahanap. Lumalabas lang kapag kumpleto na ang address, dahil
              wala itong mailalapit kung saan man bago iyon. */}
          {/* HINDI TUGMA ANG PIN SA NAPILI? Ang shipping fee ay galing sa
              dropdown, hindi sa pin — kaya ang pin sa San Pedro habang
              nakatakda ang Paete ay naniningil para sa maling biyahe. Ang
              senyales lang ang ibinibigay: baka nga roon ipapadala at ang pin
              ang mali, at ang pagpapalit ng bayan sa ilalim nila ay
              nagbabago ng presyo nang hindi nila napapansin. */}
          {pinMismatch(pin, { city, province }) && (
            <p className="mt-3 rounded-lg border border-[#caa45a] bg-linen px-3 py-2 text-[11px] leading-snug text-olive">
              <b>Your pin is in {pinMismatch(pin, { city, province })}</b> but you selected {city}, {province}.
              The shipping fee follows the selection — change it above if the pin is right.
            </p>
          )}

          {province && city && barangay ? (
            <div className="mt-3">
              <LocationPicker
                value={pin}
                flyTo={`${barangay}, ${city}, ${province}, Philippines`}
                onChange={(loc) => {
                  setPin(loc);
                  if (loc.postcode && !postal.trim()) setPostal(loc.postcode);
                  // ANG KALYE MULA SA PIN. Ang inilagay na tuldok ang alam ng
                  // customer; ang pagpapatipa pa ng kalyeng itinuro na niya sa
                  // mapa ay paghingi ng parehong bagay nang dalawang beses.
                  // Hindi pinapatungan ang naitipa na — ang "Blk 7 Lot 12" ay
                  // mas tiyak kaysa sa pangalan ng kalye.
                  if (loc.street && !street.trim()) setStreet(loc.street);
                }}
              />
            </div>
          ) : (
            <p className="mt-3 rounded bg-linen px-3 py-2 text-[11px] text-stone">
              Complete your address and a map will appear — drag the pin to your exact house so our
              driver finds you easily.
            </p>
          )}

          {Object.keys(errs).length > 0 && (
            <p className="mt-3 rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">
              Please complete the highlighted fields — your quotation is priced and delivered to this address.
            </p>
          )}

          {/* LAGING NANDITO ANG BUTON. Naka-kandado ito dati sa `handle` —
              kapag walang maayos na Facebook page sa site.json, walang buton,
              at ang request ay hindi man lang nakakarating sa IMS. Ang
              Messenger ay ang huling hakbang, hindi ang kundisyon. */}
          <button
            type="button"
            onClick={() => void send()}
            disabled={sending}
            className="mt-3 flex w-full items-center justify-center rounded bg-espresso px-4 py-3 text-base font-medium text-cream transition-colors hover:bg-cognac disabled:cursor-not-allowed disabled:bg-stone/50"
          >
            {sending ? "Sending…" : `Send request · ${quote.length} ${quote.length === 1 ? "product" : "products"}`}
          </button>
          {sendErr && (
            <p className="mt-2 rounded bg-linen px-3 py-2 text-xs font-medium text-ink" role="alert">
              {sendErr}
            </p>
          )}
          {/* PAMBALIK KAPAG HINARANG ANG POPUP (2026-09-06): ang link ay nandito
              pa rin — isang click ng customer ang kailangan ng browser. */}
          {messengerLink && (
            <a href={messengerLink} target="_blank" rel="noreferrer"
              className="mt-2 flex w-full items-center justify-center gap-2 rounded bg-[#0084FF] px-4 py-3 text-sm font-bold text-white hover:bg-[#0070d9]">
              Open Messenger
            </a>
          )}
          <Link
            href="/collections/bed"
            className="mt-2 block rounded border border-ink py-3 text-center text-xs font-bold uppercase tracking-widest2 transition-colors hover:bg-ink hover:text-cream"
          >
            Keep browsing
          </Link>
          <p className="mt-2 rounded bg-linen px-3 py-2 text-[11px] text-stone">
            Your builds will be sent to our team on Messenger — we&apos;ll reply there with a formal quotation.
          </p>
        </div>
      </div>
    </div>
  );
}
