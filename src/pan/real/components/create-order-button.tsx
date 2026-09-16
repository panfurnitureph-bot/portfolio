"use client";

import { useState, useTransition, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Modal } from "./modal";
import { cn } from "./ui";
import { LineItemsEditor, type LineItem } from "./line-items-editor";
import { CurtainCalculator } from "./curtain-calculator";
import { AddressAutocomplete, type GeoPoint } from "./address-autocomplete";
import { createOrder } from "@/app/orders/actions";
import { searchFbContacts } from "@/app/orders/fb-actions";
import { linkQuotationOrder, shippingRates, type ShipProvince } from "@/app/quotations/actions";
import { messengerLink, fbLinkLabel } from "@/lib/fb-link";
import { ASSIGNEES } from "@/lib/assignees";
import { PAYMENT_METHODS } from "@/lib/payment-methods";
import type { ProductRow } from "@/lib/supabase/server";

type LA = { label: string; amount: number };

// STATUS select tinanggal sa Create Order (2026-08-16) — laging "Partial" ang
// panimula; nasa Edit Order pa rin ang buong status picker.
// Fixed discount labels — picked from a dropdown instead of free text.
const DISCOUNT_LABELS = ["Discount Kurtina ni PAN", "Discount Warehouse", "Discount Show Room"];
const inp = "rounded-md border border-border bg-surface px-2 py-1.5 text-sm outline-none focus:border-primary";
// Unang mungkahing petsa pag-check ng Rush (order date + ito). Hindi
// DEFAULT_RUSH_DAYS (14) — iyon ang NORMAL na turnaround; ang rush ay mas
// maikli. Napapalitan naman agad sa calendar.
const RUSH_SEED_DAYS = 7;
// Kailan huling nag-message ang FB contact, sa tao-friendly na anyo. Ito ang
// nagbubukod sa magkapangalang customer sa picker (walang profile pic na
// makukuha kay Meta — kailangan ng Business Asset User Profile Access).
function fbWhen(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const mins = Math.round((Date.now() - then) / 60_000);
  if (mins < 1) return "chatted just now";
  if (mins < 60) return `chatted ${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `chatted ${hrs}h ago`;
  const days = Math.round(hrs / 24);
  if (days < 7) return `chatted ${days}d ago`;
  return "chatted " + new Date(iso).toLocaleDateString("en-PH", { month: "short", day: "numeric", year: "numeric" });
}
const todayISO = () => new Date().toISOString().slice(0, 10);
// Rush deadline → Delivery Date: order date + N araw (ISO yyyy-mm-dd).
function addDaysISO(baseISO: string | null, days: number): string {
  const base = baseISO ? new Date(baseISO) : new Date();
  const d = Number.isNaN(base.getTime()) ? new Date() : base;
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}
// Kabaligtaran ng addDaysISO: mula sa napiling rush DATE, ilang araw ito mula
// sa order date? Ito ang `rush_days` na iniimbak — ito ang threshold ng
// countdown na RushBadge sa Orders/Operations/Delivery/Installation.
function daysBetweenISO(fromISO: string | null, toISO: string): number | null {
  if (!toISO) return null;
  const from = new Date((fromISO || todayISO()) + "T00:00:00");
  const to = new Date(toISO + "T00:00:00");
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) return null;
  const days = Math.round((to.getTime() - from.getTime()) / 86_400_000);
  return days > 0 ? days : null;
}
const peso2 = (n: number) => (Number(n) || 0).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function CreateOrderButton({
  nextOrderNumber = "",
  products = [],
  stockBySku = {},
  assignees = ASSIGNEES.map((n) => ({ name: n, role: "" })),
  constructors = [],
  fbContacts = [],
  canEditWorkshop = false,
  silent = false,
}: {
  nextOrderNumber?: string;
  products?: ProductRow[];
  stockBySku?: Record<string, { reserved: number; available: number }>;
  assignees?: { name: string; role?: string }[];
  constructors?: { name: string; role: string }[];
  fbContacts?: { name: string; link: string | null; pic?: string | null; psid?: string | null; thread?: string | null; lastMsg?: string | null }[]; // FB customer suggestions
  canEditWorkshop?: boolean; // Operations-only: show/edit Workshop Date (Sales sees Delivery only)
  // INITIAL SALES: walang email na ipinapadala sa create (pag-encode ng lumang order).
  silent?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  const [orderNo, setOrderNo] = useState(nextOrderNumber);
  const [date, setDate] = useState("");
  const [customer, setCustomer] = useState("");
  const [address, setAddress] = useState("");
  const [landmark, setLandmark] = useState("");
  // Shopee-style hierarchy (kapareho ng website checkout): Region → Province →
  // City → Barangay mula sa PSGC list (/barangays.json), tapos street + pin.
  const [province, setProvince] = useState("");
  const [town, setTown] = useState("");
  const [barangay, setBarangay] = useState("");
  const [brgyData, setBrgyData] = useState<Record<string, string[]>>({});
  // Ang buong address mula sa quotation, hinihintay ang barangays.json bago
  // hatiin — asynchronous ang pagkarga nito, kaya hindi ito kayang gawin sa
  // loob mismo ng fromQuote na effect.
  const [quoteAddress, setQuoteAddress] = useState("");
  // Contact at Messenger thread mula sa request, hinihintay ang mga setter na
  // nasa ibaba pa ng component.
  const [quoteWho, setQuoteWho] = useState<{
    contact: string; psid: string | null; name: string;
    // Ang tuldok sa mapa at ang FB link ay dumadaan din dito: ang setGeo at
    // setFbLink ay naideklara sa IBABA ng handoff effect, at ang tawag bago
    // sila mabuo ay temporal-dead-zone error na bumabagsak ang buong pahina.
    lat?: number | null; lng?: number | null; fbLink?: string;
  } | null>(null);
  useEffect(() => {
    fetch("/barangays.json").then((r) => r.json()).then(setBrgyData).catch(() => {});
  }, []);
  // HANDOFF MULA SA FORMAL QUOTATION: pinindot ang "Create order" sa isang
  // tinanggap na quotation, kaya dinala tayo sa /orders?fromQuote=1 na may laman
  // sa sessionStorage. Bubuksan ang form na punô na — hindi na itinataype muli.
  // Isang beses lang: binubura ang laman pagkatapos, kaya hindi na bumubukas sa
  // muling pag-refresh.
  const [quoteRef, setQuoteRef] = useState<{ id: number; fq: string } | null>(null);
  // Hinahati ang isang-linyang address ng website sa street / city / province,
  // para tumugma sa Province at City dropdowns imbes na madoble ang bayan at
  // lalawigan sa naka-save na address. Kailangan nito ang barangays.json, kaya
  // hiwalay itong effect na naghihintay ng pagkarga.
  useEffect(() => {
    const full = quoteAddress.trim();
    if (!full || !Object.keys(brgyData).length) return;
    const keys = Object.keys(brgyData);
    const parts = full.split(",").map((x) => x.trim()).filter(Boolean);
    // Mula sa dulo: ang huling bahagi ang lalawigan, ang bago nito ang bayan.
    for (let i = parts.length - 1; i >= 1; i--) {
      const prov = keys.find((k) => k.split("|")[0].toLowerCase() === parts[i].toLowerCase())?.split("|")[0];
      if (!prov) continue;
      const cityRaw = parts[i - 1];
      const key = keys.find((k) => k.toLowerCase() === `${prov}|${cityRaw}`.toLowerCase());
      setProvince(prov);
      if (key) {
        setTown(key.split("|")[1]);
        // Ang natitira sa unahan ang street; kadalasan walang laman mula sa
        // website, kaya blangko ito at ipapa-type sa team.
        setAddress(parts.slice(0, i - 1).join(", "));
      } else {
        setAddress(parts.slice(0, i).join(", "));
      }
      setQuoteAddress("");
      return;
    }
    // Walang tumugmang lalawigan — iiwan itong buo sa street.
    setQuoteAddress("");
  }, [quoteAddress, brgyData]);
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!new URLSearchParams(window.location.search).has("fromQuote")) return;
    let raw: string | null = null;
    try { raw = sessionStorage.getItem("pf_quote_to_order"); sessionStorage.removeItem("pf_quote_to_order"); } catch { return; }
    if (!raw) return;
    try {
      const q = JSON.parse(raw) as {
        qid: number; fq: string; customer: string; address: string; items: LineItem[]; deliveryFee: number;
        // Ang mga ito ay galing sa MTO request, hindi sa quotation — wala nito
        // ang mga quotation na manu-manong ginawa, kaya opsyonal.
        contact?: string; psid?: string | null; mto?: string | null;
        // Galing din sa request (0175) — ang buong address na tinipa sa
        // /quote-request, ang tuldok sa mapa, at ang Facebook.
        requestAddress?: string; lat?: number | null; lng?: number | null;
        fbName?: string; fbLink?: string;
      };
      // Ang fromQuote na daan ay hindi dumadaan sa reset(), kaya blanko ang
      // Order Date at nagse-save nang walang petsa (naiulat 2026-08-17) —
      // itakda sa NGAYON gaya ng ordinaryong Create Order.
      setDate(todayISO());
      setCustomer(q.customer ?? "");
      // Ang address mula sa website ay isang linya ("Agoncillo, Batangas"),
      // pero pinagdudugtong ng form ang street + Brgy + town + province kapag
      // sine-save. Kung buo itong isasalpak sa street, madodoble ang bayan at
      // lalawigan — kaya inihihiwalay muna ang dalawang huling bahagi at
      // itinutugma sa dropdowns.
      // ANG ADDRESS NG REQUEST ANG MAS KUMPLETO: doon tinipa ng customer ang
      // barangay, kalye at postal; ang nasa quotation ay ang naipadalang
      // dokumento, na maaaring isang linya lang. Bumabalik sa quotation kapag
      // manu-manong ginawa ang FQ (walang request sa likod nito).
      const addr = q.requestAddress?.trim() || q.address || "";
      setAddress(addr);
      setQuoteAddress(addr);
      // Kilala na ang customer mula sa website request — huwag nang ipa-type
      // muli ang contact, at itali agad ang Messenger thread para makatanggap
      // siya ng order at PAID updates. Itinatabi muna: nasa ibaba pa ng
      // component ang mga setter nila.
      // Ang FB name na tinipa sa /quote-request ay mas maaasahan kaysa sa
      // pangalan ng customer: iyon mismo ang hinahanap sa Messenger.
      if (q.contact || q.psid || q.fbName || q.fbLink || Number.isFinite(q.lat)) {
        setQuoteWho({
          contact: q.contact ?? "",
          psid: q.psid ?? null,
          name: q.fbName?.trim() || q.customer || "",
          lat: q.lat ?? null,
          lng: q.lng ?? null,
          fbLink: q.fbLink ?? "",
        });
      }
      if (q.items?.length) setItems(q.items);
      // Ang delivery fee ng quotation ay SARILING "Shipping Fee" section na
      // (hiling 2026-08-16) — hindi na ordinaryong line item row; pagsa-submit
      // ay isinasama pa rin bilang Shipping line sa order.
      if (Number(q.deliveryFee) > 0) {
        setShipFee({ amount: Number(q.deliveryFee), sub: (q.address ?? "").trim() });
      }
      setQuoteRef({ id: q.qid, fq: q.fq });
      setOpen(true);
    } catch { /* sirang laman — blangkong form */ }
  }, []);

  // AUTO-FILL mula sa napiling address (2026-08-23): kapag pumili ng lugar sa
  // Street typeahead (o ginalaw ang pin), ang Province / City / Barangay
  // dropdowns ay pinupunan mula sa bahagi ng address na tugma sa PSGC list,
  // at ang street field ay nililinis sa kalye/bahay lang (para hindi madoble
  // ang bayan at lalawigan sa naka-save na address).
  const autoFillFromAddress = (full: string, parts?: { district?: string; city?: string; county?: string; state?: string; postcode?: string }) => {
    const keys = Object.keys(brgyData);
    if (!keys.length) return;
    // Pare-parehong anyo: walang tuldik (Biñan = Binan), walang "City of"/"City",
    // "Sta" = "Santa", walang panaklong ("Rizal (Laguna)" = "Rizal").
    const norm = (x: string) => x
      .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/\([^)]*\)/g, " ")
      .replace(/^(city of|municipality of)\s+/, "").replace(/\s+city$/, "")
      .replace(/\bsta\.?\s+/g, "santa ").replace(/\bsto\.?\s+/g, "santo ")
      .replace(/[^a-z0-9]+/g, " ").trim();
    // Ang key na "Sta Cruz / Pila" ay dalawang bayan — tugma kung alinman.
    const keyMatches = (keyPart: string, c: string) => keyPart.split("/").some((k) => norm(k) === norm(c));
    const segs = full.split(",").map((x) => x.trim()).filter(Boolean);
    const cands = [parts?.state, parts?.city, parts?.county, parts?.district, ...segs].filter((x): x is string => !!x);
    // Province
    let prov = "";
    for (const c of cands) { const k = keys.find((k) => keyMatches(k.split("|")[0], c)); if (k) { prov = k.split("|")[0]; break; } }
    if (!prov) return;
    // City — sa loob ng province
    const townKeys = keys.filter((k) => k.startsWith(prov + "|"));
    let tw = "";
    for (const c of cands) { const k = townKeys.find((k) => keyMatches(k.split("|")[1], c)); if (k) { tw = k.split("|")[1]; break; } }
    setProvince(prov);
    setTown(tw);
    // Barangay — sa loob ng town
    let bg = "";
    if (tw) {
      const list: string[] = brgyData[`${prov}|${tw}`] ?? [];
      for (const c of cands) { const hit = list.find((b) => norm(b) === norm(c.replace(/^(brgy\.?|barangay)\s+/i, ""))); if (hit) { bg = hit; break; } }
    }
    setBarangay(bg);
    // Street = mga bahagi bago ang unang tugma sa barangay/bayan/lalawigan/postal.
    const stopAt = segs.findIndex((s) => [bg, tw, prov].filter(Boolean).some((v) => norm(v) === norm(s)) || /^\d{4}$/.test(s));
    if (stopAt > 0) setAddress(segs.slice(0, stopAt).join(", "));
  };
  const provinces = [...new Map(Object.keys(brgyData).map((k) => [k.split("|")[0], true])).keys()];
  const towns = Object.keys(brgyData).filter((k) => k.startsWith(province + "|")).map((k) => k.split("|")[1]);
  const brgys = brgyData[`${province}|${town}`] ?? [];
  const [geo, setGeo] = useState<GeoPoint>(null);
  const [contact, setContact] = useState("");
  // Alternatibong kontak (0224, hiling 2026-09-01): pangalawang numero + kung
  // sino ito sa customer — pantawag kapag hindi masagot ang pangunahin.
  const [altContact, setAltContact] = useState("");
  const [altRelation, setAltRelation] = useState("");
  const [email, setEmail] = useState("");
  const [fbName, setFbName] = useState("");
  const [fbLink, setFbLink] = useState("");
  // Messenger PSID ng napiling contact — pag may laman, awtomatikong
  // mapapadalhan ang customer ng order/PAID updates sa thread nila.
  const [fbPsid, setFbPsid] = useState<string | null>(null);
  // Isinasalin ang naitabing contact/PSID kapag nakabuo na ang component.
  useEffect(() => {
    if (!quoteWho) return;
    if (quoteWho.contact) setContact(quoteWho.contact);
    if (quoteWho.psid) { setFbPsid(quoteWho.psid); setFbName(quoteWho.name); }
    else if (quoteWho.name) setFbName(quoteWho.name);
    if (quoteWho.fbLink?.trim()) setFbLink(quoteWho.fbLink.trim());
    // Ang tuldok sa mapa — inilagay mismo ng customer sa /quote-request. Kung
    // hindi ipapasa, hahanapin muli ng team ang bahay na itinuro na.
    if (Number.isFinite(quoteWho.lat) && Number.isFinite(quoteWho.lng)) {
      setGeo({ lat: Number(quoteWho.lat), lng: Number(quoteWho.lng) });
    }
    setQuoteWho(null);
  }, [quoteWho]);
  // Terminal (POS) tinanggal 2026-08-16 (hiling ni Joe) — pinalitan ng parehong
  // channels ng Installation collection: BDO / BPI / GCash / Maya (static QR).
  const [payMethod, setPayMethod] = useState<"email_qr" | "cash" | "bdo" | "bpi" | "gcash" | "maya">("email_qr");
  // MOP is derived from the chosen payment method so reports still get a value.
  const mop = payMethod === "email_qr" ? "QR Ph"
    : payMethod === "cash" ? "Cash"
    : payMethod === "bdo" ? "BDO"
    : payMethod === "bpi" ? "BPI"
    : payMethod === "gcash" ? "GCash"
    : "Maya";
  const [status] = useState("Partial");
  const [assigned, setAssigned] = useState("");
  // Saan naganap ang sale — showroom tagging para sa PAN Overall income tracking.
  const [branch, setBranch] = useState("");
  const [workshop, setWorkshop] = useState("");
  const [delivery, setDelivery] = useState("");
  // Rush tag — ang taning ay ang Delivery Date MISMO (isang petsa lang, kita sa
  // Rush deadline at sa Schedule). Ang rushDays ay deri-derive dito para may
  // threshold ang countdown na RushBadge sa buong system.
  const [isRush, setIsRush] = useState(false);
  const [rushDays, setRushDays] = useState("");
  const [downpayment, setDownpayment] = useState(0);
  const [dpTouched, setDpTouched] = useState(false); // did the user edit the DP by hand?
  const [dpDate, setDpDate] = useState("");
  const [items, setItems] = useState<LineItem[]>([{ qty: 1, description: "", unitPrice: 0 }]);
  // SHIPPING FEE mula sa quotation — sariling section (hindi item row): pangalan
  // + lugar + ₱ input + ✕; kasama sa total at sa order bilang Shipping line.
  const [shipFee, setShipFee] = useState<{ amount: number; sub: string }>({ amount: 0, sub: "" });
  // AUTO-FILL ng halaga mula sa website shipping rates (hiling 2026-08-17):
  // parehong rates ng quotation/website checkout, tumutugma sa piniling
  // City/Province. Ang mano-manong tinype ay hindi na sinasapawan.
  const [shipRates, setShipRates] = useState<ShipProvince[] | null>(null);
  const [shipTouched, setShipTouched] = useState(false);
  useEffect(() => {
    if (!open || shipRates !== null) return;
    shippingRates().then(setShipRates).catch(() => setShipRates([]));
  }, [open, shipRates]);
  useEffect(() => {
    if (shipTouched || !province || !town || !shipRates?.length) return;
    const norm = (x: string) => x.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
    const prov = shipRates.find((p) => norm(p.name) === norm(province) || norm(p.name).includes(norm(province)) || norm(province).includes(norm(p.name)));
    if (!prov) return;
    const city = prov.cities.find((c) => norm(c.name) === norm(town) || norm(c.name).includes(norm(town)) || norm(town).includes(norm(c.name)));
    if (city && Number(city.fee) > 0) setShipFee((p) => ({ ...p, amount: Number(city.fee) || 0 }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [province, town, shipRates, shipTouched]);
  const [discounts, setDiscounts] = useState<LA[]>([]);
  const [terms, setTerms] = useState<LA[]>([]);

  const subtotal = items.reduce((s, it) => s + (Number(it.qty) || 0) * (Number(it.unitPrice) || 0), 0)
    + (Number(shipFee.amount) || 0);
  const discountTotal = discounts.reduce((s, x) => s + (Number(x.amount) || 0), 0);
  // Total comes from the line items (qty × price) minus discounts — no manual override.
  const total = subtotal - discountTotal;
  // 30% of the total — the standard downpayment. Auto-filled in the field for every
  // method (a typed amount wins). This is the DISPLAYED figure.
  const suggestedDp = total > 0 ? Math.round(total * 0.3 * 100) / 100 : 0;
  const effectiveDp = dpTouched ? Number(downpayment) || 0 : suggestedDp;
  // What actually gets RECORDED on create. NOTHING is recorded as paid up front —
  // Email QR only EMAILS the 30% QR (the customer pays later; the Maya webhook /
  // reconcile records it when they actually pay), and Cash/Terminal are collected in
  // store via Edit → Mark Paid. So record 0 for both; the order stays Pending until a
  // real payment lands. A hand-typed amount is the exception — that's a downpayment
  // actually taken at the counter right now, so honor it.
  const recordedDp = dpTouched ? effectiveDp : 0;
  // KASABAY NG HALAGA ANG PETSA (hiling 2026-08-23). Ang 30%% ay awtomatikong
  // lumilitaw sa field, pero blangko ang petsa — kaya ang order ay may planong
  // downpayment na walang araw. Ang petsa ngayon ang hinuha (dito nagsisimula
  // ang 30-araw na hintayan); ang tinipang petsa ang panalo.
  const effectiveDpDate = dpDate || (effectiveDp > 0 ? new Date().toISOString().slice(0, 10) : "");
  const balance = Math.max(total - effectiveDp, 0);

  function reset() {
    setOrderNo(nextOrderNumber);
    setDate(new Date().toISOString().slice(0, 10)); // today
    setCustomer(""); setAddress(""); setGeo(null); setContact(""); setEmail(""); setFbName(""); setFbLink(""); setFbPsid(null);
    setPayMethod("email_qr");
    setAssigned(""); setWorkshop(""); setDelivery("");
    setIsRush(false); setRushDays("");
    setDownpayment(0); setDpTouched(false); setDpDate("");
    setItems([{ qty: 1, description: "", unitPrice: 0 }]);
    setShipFee({ amount: 0, sub: "" });
    setDiscounts([]); setTerms([]); setError(null);
  }

  function submit() {
    setError(null);
    if (!customer.trim()) { setError("Customer name is required."); return; }
    if (!contact.trim()) { setError("Cellphone number is required."); return; }
    if (!email.trim()) { setError("Email address is required."); return; }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) { setError("Enter a valid email address."); return; }
    if (!address.trim() && !(province && town && barangay)) { setError("Complete the address — pick Province / City / Barangay (or type the address)."); return; }
    if (items.length === 0 || items.every((i) => !i.description.trim())) {
      setError("Add at least one line item with a description."); return;
    }
    start(async () => {
      const res = await createOrder({
        // Order number is assigned server-side from a sequence (gap-free, collision-free).
        // The previewed value below is only a hint; we don't send it so the server is the
        // single source of truth. (The edit form keeps order_number editable for admins.)
        order_number: "",
        date_order: date || null,
        customer_name: customer.trim(),
        address: [address, barangay ? `Brgy. ${barangay}` : "", town, province].filter(Boolean).join(", ") || null,
        landmark: landmark.trim() || null,
        address_lat: geo?.lat ?? null,
        address_lng: geo?.lng ?? null,
        contact_number: contact || null,
        alt_contact_number: altContact.trim() || null,
        alt_contact_relation: altRelation.trim() || null,
        email: email || null,
        fb_name: fbName.trim() || null,
        fb_link: fbLink.trim() || null,
        customer_psid: fbPsid,
        mop: mop || null,
        payment_method: payMethod,
        suppress_emails: silent,
        // Nothing recorded as paid (Cash/Terminal with no typed downpayment) → Pending.
        // Otherwise keep the chosen status (server still gates on the 30% rule).
        status: recordedDp > 0 ? status : "Pending",
        assigned: assigned || null,
        branch: branch || null,
        is_rush: isRush,
        rush_days: isRush && rushDays.trim() ? Number(rushDays) : null,
        workshop_date: workshop || null,
        date_of_delivery: delivery || null,
        date_downpayment: effectiveDpDate || null,
        full_payment_date: null,
        downpayment: recordedDp,
        full_payment: 0,
        total,
        // Isama ang Shipping Fee section bilang sariling Shipping line sa order
        // (kasama sa resibo at computation gaya ng dati).
        items: shipFee.amount > 0
          ? [...items, (() => {
              // Destinasyon = ang piniling City/Province sa form (live), hindi
              // ang lumang quotation text.
              const area = [town, province].filter(Boolean).join(", ") || shipFee.sub;
              return { qty: 1, description: area ? `Shipping\n• ${area}` : "Shipping", unitPrice: Number(shipFee.amount) || 0 };
            })()]
          : items,
        discounts,
        paymentTerms: terms,
      });
      if ("error" in res) { setError(res.error); return; }
      // Galing sa Formal Quotation: itala na naging order na ito, kaya mawawala
      // ang "Create order" na buton doon at hindi madodoble. Ang server ang
      // nagtatakda ng tunay na order number, kaya ang previewed na value ang
      // itinatala — sapat itong tukoy para sa staff.
      if (quoteRef) {
        try { await linkQuotationOrder(quoteRef.id, orderNo || quoteRef.fq); } catch { /* best-effort */ }
        setQuoteRef(null);
      }
      setOpen(false);
      reset();
      router.refresh();
    });
  }

  const updLA = (set: typeof setDiscounts, i: number, p: Partial<LA>) =>
    set((a) => a.map((x, j) => (j === i ? { ...x, ...p } : x)));

  return (
    <>
      <button
        onClick={() => { reset(); setOpen(true); }}
        className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-sm transition-all hover:opacity-90 active:scale-[0.98]"
      >
        + Create Order
      </button>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Create Order"
        description="Multiple line items per order"
        size="xl"
        footer={
          <div className="flex items-center justify-between gap-3">
            {/* IPAKITA ANG DAHILAN NG PAGKAKAIBA (2026-08-29). "Total ₱50,944"
                sa tabi ng "Balance ₱35,660" ay nakakalito: walang nagsasabi
                kung saan napunta ang ₱15,283. Nasa pagitan nila ang 30%% na
                downpayment, at hindi ito nakikita. Ang tanda ng minus at ang
                pantay ang gumagawa nitong isang sumang mababasa. */}
            <div className="flex items-baseline gap-3 whitespace-nowrap">
              <span>
                <span className="mr-1.5 text-[9.5px] font-extrabold uppercase tracking-[0.13em] text-[#a8842e]">Total</span>
                <span className="text-base font-extrabold tabular-nums text-[#3a2e14]">₱{peso2(total)}</span>
              </span>
              {effectiveDp > 0 && (
                <>
                  <span className="text-muted">−</span>
                  <span>
                    {/* "Downpayment" kapag may tinipa — tinanggap na iyon sa
                        counter; "30% DP" kapag hinuha pa lang at hindi pa
                        naitatala sa create (recordedDp = 0). */}
                    <span className="mr-1.5 text-[9.5px] font-extrabold uppercase tracking-[0.13em] text-[#a8842e]">{dpTouched ? "Downpayment" : "30% DP"}</span>
                    <span className="text-base font-extrabold tabular-nums text-[#3a2e14]">₱{peso2(effectiveDp)}</span>
                  </span>
                </>
              )}
              <span className="text-muted">=</span>
              <span>
                <span className="mr-1.5 text-[9.5px] font-extrabold uppercase tracking-[0.13em] text-[#a8842e]">Balance</span>
                <span className="text-base font-extrabold tabular-nums text-[#8a6a1f]">₱{peso2(balance)}</span>
              </span>
            </div>
            <div className="flex gap-2">
              <button onClick={() => setOpen(false)} disabled={pending} className="rounded-lg border border-border bg-surface px-4 py-2 text-sm font-medium hover:bg-stone-100 disabled:opacity-60">Cancel</button>
              <button onClick={submit} disabled={pending} className="rounded-lg bg-[#4a3b1a] px-5 py-2 text-sm font-bold text-[#f4ead8] shadow-sm hover:opacity-90 disabled:opacity-60">{pending ? "Creating…" : "Create Order"}</button>
            </div>
          </div>
        }
      >
        <div className="space-y-5">
          {/* ── Order Details ── */}
          <Section title="Order Details">
            <div className="grid grid-cols-2 gap-3">
              <F label="Order # (auto)"><input value={orderNo} readOnly title="Assigned automatically by the server" placeholder="(auto)" className={cn(inp, "bg-stone-50 text-muted")} /></F>
              {/* Pagbago ng order date habang naka-rush: kailangang mag-recompute
                  ang rush_days — ang bilang ng araw ay mula dito. */}
              <F label="Order Date"><input type="date" value={date} onChange={(e) => {
                setDate(e.target.value);
                if (isRush && delivery) { const d = daysBetweenISO(e.target.value, delivery); setRushDays(d != null ? String(d) : ""); }
              }} className={inp} /></F>
              <F label="Customer *" full><input value={customer} onChange={(e) => setCustomer(e.target.value)} className={inp} /></F>
              <F label="Cellphone Number *"><input value={contact} onChange={(e) => setContact(e.target.value)} placeholder="09xx xxx xxxx" className={inp} /></F>
              <F label="Email Address *"><input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@email.com" className={inp} /></F>
              {/* Alternatibong kontak (0224) — pangalawang tawagan + relasyon. */}
              {/* autoComplete=off: ang browser autofill ay tahimik na naglalagay ng
                  lumang value dito (nangyari: "4024" sa dalawang order na hindi
                  tinype ng user) - kontak ng IBANG TAO ito, hindi ng nag-e-encode. */}
              <F label="Alternative CP #"><input value={altContact} onChange={(e) => setAltContact(e.target.value)} placeholder="09xx xxx xxxx" autoComplete="off" name="alt-cp-no-fill" className={inp} /></F>
              <F label="Relation to Customer"><input value={altRelation} onChange={(e) => setAltRelation(e.target.value)} placeholder="e.g. Spouse, Sibling, Parent" autoComplete="off" name="alt-rel-no-fill" className={inp} /></F>
              <F label="Facebook Name">
                <FbNamePicker
                  value={fbName}
                  contacts={fbContacts}
                  onChange={setFbName}
                  // Manual na profile URL kung meron; kung wala, ang Messenger
                  // thread deep-link — ito ang awtomatikong nakukuha sa Meta at
                  // ito lang ang tunay na mabubuksan (ang facebook.com/<PSID> ay
                  // generic na pahina lang, nasukat 2026-08-08).
                  onPick={(c) => { setFbName(c.name); const url = c.link || c.thread || ""; if (url) setFbLink(url); setFbPsid(c.psid ?? null); }}
                />
              </F>
              {/* Profile link. Ang PSID ay HINDI mapupuntahang profile URL (Meta
                  privacy — nasukat 2026-08-08: pareho ang sagot sa tunay at
                  gawa-gawang PSID), kaya kapag pumili sa picker, ang MESSENGER
                  THREAD deep-link ang awtomatikong napupunta rito ("Open Chat").
                  Mapapalitan pa rin ng rep ng tunay na profile URL. */}
              <F label="Facebook Profile Link (optional)">
                <input type="url" value={fbLink} onChange={(e) => setFbLink(e.target.value)} placeholder="Paste facebook.com/username…" className={inp} />
                {fbLink && (
                  <span className="mt-1 flex items-center gap-3">
                    <a href={fbLink} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs font-medium text-info hover:underline">
                      {fbLinkLabel(fbLink)}
                    </a>
                    {messengerLink(fbLink) && (
                      <a href={messengerLink(fbLink)!} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs font-medium text-info hover:underline">
                        Open Messenger
                      </a>
                    )}
                  </span>
                )}
              </F>
              <F label="Province"><select value={province} onChange={(e) => { setProvince(e.target.value); setTown(""); setBarangay(""); }} className={inp}><option value="">— Select —</option>{provinces.map((p) => <option key={p} value={p}>{p}</option>)}</select></F>
              <F label="City / Municipality"><select value={town} disabled={!province} onChange={(e) => { setTown(e.target.value); setBarangay(""); }} className={inp}><option value="">{province ? "— Select —" : "Province first"}</option>{towns.map((t) => <option key={t} value={t}>{t}</option>)}</select></F>
              <F label="Barangay"><select value={barangay} disabled={!town} onChange={(e) => setBarangay(e.target.value)} className={inp}><option value="">{town ? "— Select —" : "City first"}</option>{brgys.map((b) => <option key={b} value={b}>{b}</option>)}</select></F>
              <F label="Street / House no." full><AddressAutocomplete value={address} coords={geo} onChange={(a, c, parts) => { setAddress(a); setGeo(c); if (c && parts) autoFillFromAddress(a, parts); }} placeholder="House no. / street (optional once the house is pinned)" centerQuery={province && town && barangay ? `${barangay}, ${town}, ${province}` : ""} scopeQuery={[barangay, town, province].filter(Boolean).join(", ")} /></F>
              <F label="Landmark / Delivery notes" full><input value={landmark} onChange={(e) => setLandmark(e.target.value)} placeholder="e.g. blue gate, across the sari-sari store, call on arrival" className={inp} /></F>
              {/* STATUS: TAGO na (hiling 2026-08-16) — laging "Partial" ang
                  panimula; ang tunay na status ay galaw ng bayad/daloy, hindi
                  tina-type sa create. Ang select ay nasa Edit Order pa rin. */}
              <F label="Assigned"><select value={assigned} onChange={(e) => setAssigned(e.target.value)} className={inp}><option value="">— Select —</option>{[...new Map(assignees.map((a) => [a.role?.trim() || "Sales", true])).keys()].map((role) => (<optgroup key={role} label={role}>{assignees.filter((a) => (a.role?.trim() || "Sales") === role).map((a) => <option key={a.name} value={a.name}>{a.name}</option>)}</optgroup>))}</select></F>
              <F label="Showroom Branch"><select value={branch} onChange={(e) => setBranch(e.target.value)} className={inp}><option value="">— Select —</option><option value="San Pedro">San Pedro</option><option value="Carmona">Carmona, Cavite</option></select></F>
              <F label="Rush Order">
                <label className="flex cursor-pointer items-center gap-2 rounded-md border border-border bg-surface px-3 py-2">
                  <input type="checkbox" checked={isRush} onChange={(e) => {
                    setIsRush(e.target.checked);
                    // Pag-check: agad na buksan ang calendar na may nakatakdang
                    // petsa — ang naka-set na Delivery Date kung may saysay pa,
                    // kung hindi ay order date + RUSH_SEED_DAYS. Ang petsang ito
                    // MISMO ang delivery date (sinasalamin sa Schedule sa ibaba).
                    if (e.target.checked) {
                      const existing = daysBetweenISO(date, delivery) != null ? delivery : "";
                      const seed = existing || addDaysISO(date || todayISO(), RUSH_SEED_DAYS);
                      setDelivery(seed);
                      setRushDays(String(daysBetweenISO(date, seed) ?? RUSH_SEED_DAYS));
                    }
                  }} className="h-4 w-4 accent-rose-600" />
                  <span className="text-sm font-semibold text-rose-600">Rush</span>
                </label>
              </F>
              {isRush && (
                <F label="Rush deadline (= Delivery Date)">
                  <input
                    type="date"
                    value={delivery}
                    // Kahit isang araw pagkatapos ng order — ang zero/negatibong
                    // taning ay walang countdown na maipapakita.
                    min={addDaysISO(date || todayISO(), 1)}
                    onChange={(e) => {
                      // Ang napiling petsa ANG delivery date; deri-derive ang rush_days.
                      setDelivery(e.target.value);
                      const d = daysBetweenISO(date, e.target.value);
                      setRushDays(d != null ? String(d) : "");
                    }}
                    className={inp}
                  />
                </F>
              )}
            </div>
          </Section>

          {/* ── Schedule ── Workshop Date is Operations-only; Sales sees Delivery Date only. */}
          <Section title="Schedule">
            <div className="grid grid-cols-2 gap-3">
              {canEditWorkshop && <F label="Workshop Date"><input type="date" value={workshop} onChange={(e) => setWorkshop(e.target.value)} className={inp} /></F>}
              {/* Isa lang ang delivery date — pareho ang field na ito at ang Rush
                  deadline sa itaas. Pagbago dito, sumusunod ang rush_days para
                  tugma ang countdown badge. */}
              <F label="Delivery Date" full={!canEditWorkshop}><input type="date" value={delivery} onChange={(e) => {
                setDelivery(e.target.value);
                if (isRush) { const d = daysBetweenISO(date, e.target.value); setRushDays(d != null ? String(d) : ""); }
              }} className={inp} /></F>
            </div>
          </Section>

          {/* ── Payment ── method + the 30% downpayment (total comes from Line Items). */}
          <Section title="Payment">
            {/* COMPACT chips (hiling 2026-08-18) — dating malalaking 2×3 na
                kahon; isang hanay ng maliliit na pills na lang, tooltip ang
                nagpapaliwanag (Email QR = any bank/e-wallet, atbp.). */}
            <div className="flex flex-wrap gap-1.5">
              {([
                { key: "email_qr", label: "Email QR", sub: "any bank / e-wallet" },
                { key: "cash", label: "Cash", sub: "in-store" },
                { key: "bdo", label: "BDO", sub: "transfer" },
                { key: "bpi", label: "BPI", sub: "transfer" },
                { key: "gcash", label: "GCash", sub: "transfer" },
                { key: "maya", label: "Maya", sub: "transfer" },
              ] as const).map((o) => (
                <button key={o.key} type="button" onClick={() => setPayMethod(o.key)} title={o.sub}
                  className={cn("rounded-full border px-3 py-1.5 text-xs font-bold transition-all",
                    payMethod === o.key
                      ? "border-[#4a3b1a] bg-[#4a3b1a] text-[#f4ead8] shadow-sm"
                      : "border-[#e6dcc4] bg-white text-muted hover:border-[#caa45a] hover:bg-[#faf6ec]")}>
                  {o.label}{payMethod === o.key ? " ✓" : ""}
                </button>
              ))}
            </div>
            <div className="mt-3 grid grid-cols-2 gap-3">
              <F label="Downpayment Date"><input type="date" value={effectiveDpDate} onChange={(e) => setDpDate(e.target.value)} className={inp} /></F>
              <F label="Downpayment (₱) · 30% suggested"><input type="number" min={0} value={effectiveDp || ""} onChange={(e) => { setDpTouched(true); setDownpayment(Number(e.target.value)); }} placeholder="0" className={inp} /></F>
            </div>
            <p className="mt-2 text-[11px] text-muted">
              {payMethod === "email_qr"
                ? "A QR Ph for the 30% downpayment is emailed — the order stays Pending (nothing recorded yet) until the customer actually pays; it's auto-marked paid when the payment lands. Type an amount only if a downpayment was already taken now."
                : payMethod === "cash"
                  ? "The 30% above is the planned downpayment, but nothing is recorded yet — the order stays Pending until you collect in-store and Mark Paid (receipt emailed + printed). Type an amount only if a downpayment was actually taken now."
                  : `The 30% above is the planned downpayment, but nothing is recorded yet — the order stays Pending until the ${mop} transfer is received and you Mark Paid in Edit Order (receipt emailed + printed). Type an amount only if the transfer already came in now.`}
            </p>
            <p className="mt-2 rounded-lg bg-stone-50/60 px-3 py-2 text-[11px] text-muted">Total <b className="text-foreground">₱{peso2(total)}</b> · Balance <b className="text-foreground">₱{peso2(balance)}</b> — computed from the Line Items below.</p>
          </Section>

          {/* ── Line items ── */}
          <div className="space-y-2">
            <div className="flex items-center gap-2.5">
              <span className="h-3.5 w-1 rounded-full bg-[#caa45a]" />
              <p className="text-[11px] font-extrabold uppercase tracking-[0.14em] text-[#4a3b1a]">Line Items *</p>
              <span className="h-px flex-1 bg-gradient-to-r from-[#e6dcc4] to-transparent" />
              <CurtainCalculator onAdd={(qs) => setItems((prev) => {
                // Drop a leading empty starter row, then append each window quote as a line.
                const base = prev.length === 1 && !prev[0].description.trim() ? [] : prev;
                return [...base, ...qs.map((q) => ({ qty: 1, description: q.description, unitPrice: q.unitPrice }))];
              })} />
            </div>
            <LineItemsEditor items={items} onChange={setItems} products={products} stockBySku={stockBySku} constructors={constructors} />
          </div>

          {/* ── SHIPPING FEE — mula sa quotation (hiling 2026-08-16): sariling
              section na may lugar + ₱ input + ✕, hindi ordinaryong item row. */}
          {(
            <div>
              <div className="mb-2 flex items-center gap-2.5">
                <span className="h-3.5 w-1 rounded-full bg-[#caa45a]" />
                <p className="text-[11px] font-extrabold uppercase tracking-[0.14em] text-[#4a3b1a]">Shipping Fee</p>
                <span className="h-px flex-1 bg-gradient-to-r from-[#e6dcc4] to-transparent" />
              </div>
              <div className="flex items-center gap-3 rounded-xl border border-[#e6dcc4] bg-white p-4 shadow-sm">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-[#3a2e14]">Shipping</p>
                  {/* Ang lugar ay LIVE mula sa address na pinili sa form sa
                      itaas (City/Province) — hindi ang lumang quotation text
                      (hiling 2026-08-17). */}
                  {(() => {
                    const area = [town, province].filter(Boolean).join(", ") || shipFee.sub;
                    return area ? <p className="truncate text-xs text-muted" title={area}>{area}</p> : null;
                  })()}
                </div>
                <span className="text-sm font-bold text-[#8a6a1f]">₱</span>
                <input
                  type="number"
                  min={0}
                  step="0.01"
                  value={shipFee.amount || ""}
                  onChange={(e) => { setShipTouched(true); setShipFee({ ...shipFee, amount: Number(e.target.value) || 0 }); }}
                  placeholder="0.00"
                  className={cn(inp, "w-28 text-right")}
                />
                <button type="button" onClick={() => { setShipTouched(true); setShipFee({ ...shipFee, amount: 0 }); }} className="px-1 text-muted hover:text-danger" title="Clear the shipping fee">✕</button>
              </div>
            </div>
          )}

          {/* Discounts */}
          <G title="Discounts" onAdd={() => setDiscounts([...discounts, { label: DISCOUNT_LABELS[0], amount: 0 }])}>
            {discounts.map((x, i) => (
              <LineRow key={i} x={x} options={DISCOUNT_LABELS} onLabel={(v) => updLA(setDiscounts, i, { label: v })} onAmount={(v) => updLA(setDiscounts, i, { amount: v })} onRemove={() => setDiscounts(discounts.filter((_, j) => j !== i))} />
            ))}
            {discounts.length === 0 && <p className="text-xs text-muted">None.</p>}
          </G>

          {/* Payment terms */}
          <G title="Payment Term Breakdown (optional)" onAdd={() => setTerms([...terms, { label: "Bank Transfer", amount: 0 }])}>
            {terms.map((x, i) => (
              <LineRow key={i} x={x} options={PAYMENT_METHODS} onLabel={(v) => updLA(setTerms, i, { label: v })} onAmount={(v) => updLA(setTerms, i, { amount: v })} onRemove={() => setTerms(terms.filter((_, j) => j !== i))} />
            ))}
            {terms.length === 0 && <p className="text-xs text-muted">None.</p>}
          </G>

          {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-xs font-medium text-red-700 ring-1 ring-inset ring-red-600/20">{error}</p>}
        </div>
      </Modal>
    </>
  );
}

// ENTERPRISE section band (2026-08-16): espresso label na may gold marker at
// hairline — kapareho ng ibang enterprise forms; ang laman ay puting card.
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-2 flex items-center gap-2.5">
        <span className="h-3.5 w-1 rounded-full bg-[#caa45a]" />
        <p className="text-[11px] font-extrabold uppercase tracking-[0.14em] text-[#4a3b1a]">{title}</p>
        <span className="h-px flex-1 bg-gradient-to-r from-[#e6dcc4] to-transparent" />
      </div>
      <div className="rounded-xl border border-[#e6dcc4] bg-white p-4 shadow-sm">{children}</div>
    </div>
  );
}
function F({ label, children, full }: { label: string; children: React.ReactNode; full?: boolean }) {
  return (
    <div className={`flex flex-col gap-1 ${full ? "col-span-2" : ""}`}>
      <label className="text-[10px] font-extrabold uppercase tracking-[0.12em] text-[#a8842e]">{label}</label>
      {children}
    </div>
  );
}
function G({ title, onAdd, children }: { title: string; onAdd: () => void; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-2 flex items-center gap-2.5">
        <span className="h-3.5 w-1 rounded-full bg-[#caa45a]" />
        <p className="text-[11px] font-extrabold uppercase tracking-[0.14em] text-[#4a3b1a]">{title}</p>
        <span className="h-px flex-1 bg-gradient-to-r from-[#e6dcc4] to-transparent" />
        <button onClick={onAdd} className="rounded-md border border-[#caa45a] bg-[#faf6ec] px-2.5 py-1 text-xs font-bold text-[#4a3b1a] hover:bg-[#f4ead8]">+ Add</button>
      </div>
      <div className="space-y-2">{children}</div>
    </div>
  );
}
// Type-to-search Facebook customer picker. As the sales rep types a name, it
// suggests matching FB customers seen on PAST orders (Phase 1 — repeat customers,
// no bot). Picking one auto-fills the FB name + link; typing a brand-new name is
// still allowed (free text). Later, `contacts` can also be fed from the Messenger
// bot's saved chats so even first-time customers show up.
function FbNamePicker({
  value, contacts, onChange, onPick,
}: {
  value: string;
  contacts: { name: string; link: string | null; pic?: string | null; psid?: string | null; thread?: string | null; lastMsg?: string | null }[];
  onChange: (v: string) => void;
  onPick: (c: { name: string; link: string | null; pic?: string | null; psid?: string | null; thread?: string | null; lastMsg?: string | null }) => void;
}) {
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);
  // Server-side na hanap: ang `contacts` prop ay ang 500 PINAKA-BAGO lang, pero
  // ang Messenger inbox ay 20,000+ contacts — ang lumang customer ay hindi
  // mahahanap sa client-side filter. Habang nagta-type, hinahanap din sa DB at
  // pinagsasama ang resulta (walang duplicate, preload ang nauuna).
  const [remote, setRemote] = useState<typeof contacts>([]);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Close the suggestion list when clicking outside.
  useEffect(() => {
    function onDoc(e: Event) {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    }
    // Listen for BOTH mouse and touch so the dropdown closes on the APK/tablet too.
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("touchstart", onDoc);
    return () => { document.removeEventListener("mousedown", onDoc); document.removeEventListener("touchstart", onDoc); };
  }, []);

  const q = value.trim().toLowerCase();
  const local = q
    ? contacts.filter((c) => c.name.toLowerCase().includes(q)).slice(0, 20)
    : contacts.slice(0, 12); // show recent contacts on focus even before typing
  // Pagsamahin: preload muna (may pics/link), tapos ang galing sa DB na wala pa.
  const seenNames = new Set(local.map((c) => c.name.toLowerCase()));
  const matches = q
    ? [...local, ...remote.filter((c) => !seenNames.has(c.name.toLowerCase()))].slice(0, 20)
    : local;

  function runSearch(v: string) {
    if (searchTimer.current) clearTimeout(searchTimer.current);
    const term = v.trim();
    if (term.length < 2) { setRemote([]); return; }
    searchTimer.current = setTimeout(async () => {
      try { setRemote(await searchFbContacts(term)); } catch { /* preload lang ang gamit */ }
    }, 300);
  }

  return (
    <div ref={boxRef} className="relative">
      <input
        value={value}
        onChange={(e) => { onChange(e.target.value); setOpen(true); runSearch(e.target.value); }}
        onFocus={() => setOpen(true)}
        placeholder="Type customer's FB name…"
        className={inp}
        autoComplete="off"
      />
      {open && matches.length > 0 && (
        <div className="absolute z-20 mt-1 max-h-56 w-full overflow-auto rounded-lg border border-border bg-surface py-1 shadow-lg">
          {/* Paalala kung ANO ang tinitingnan: kapag walang tinatype, 12 LANG na
              pinakabagong kausap ang nakikita — hindi ito nagbabago kahit libo
              ang bagong na-sync (ang sync ay sumusulong pa-LUMA), kaya mukhang
              hindi gumagana ang Sync. Ang paghahanap ay umaabot sa LAHAT. */}
          {!value.trim() && (
            <div className="border-b border-border/60 px-3 py-1.5 text-[10px] text-muted">
              Most recent chats — type a name to search all customers
            </div>
          )}
          {matches.map((c, i) => (
            <button
              // Ang PSID ang tunay na id; sa 20,000 contacts ay may magkapareho
              // ng pangalan, at ang name-as-key ay nagdudulot ng React collision.
              key={c.psid || `${c.name}-${i}`}
              type="button"
              // onMouseDown/onTouchStart (not onClick) + preventDefault so the pick fires
              // BEFORE the input blur/click-outside closes the dropdown — works on APK/touch.
              onMouseDown={(e) => { e.preventDefault(); onPick(c); setOpen(false); }}
              onTouchStart={(e) => { e.preventDefault(); onPick(c); setOpen(false); }}
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-stone-100"
            >
              {c.pic ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={c.pic} alt="" className="h-6 w-6 shrink-0 rounded-full object-cover" referrerPolicy="no-referrer" />
              ) : (
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-info/10 text-xs text-info">ⓕ</span>
              )}
              {/* Pangalan + KAILAN HULING NAG-CHAT. Walang profile pic na makukuha
                  kay Meta, kaya ang petsa ang panangga sa magkapangalan: ang
                  kausap ngayon ay nasa itaas, ang taong-gulang na thread ay
                  malinaw na iba. */}
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">{c.name}</span>
                {c.lastMsg && <span className="block text-[10px] text-muted">{fbWhen(c.lastMsg)}</span>}
              </span>
              {/* "profile" = may manual na FB profile URL; "chat" = may Messenger
                  thread deep-link (awtomatiko mula sa Meta). */}
              {c.link ? <span className="shrink-0 text-[10px] text-muted">profile</span>
                : c.thread ? <span className="shrink-0 text-[10px] text-muted">chat</span> : null}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
function LineRow({ x, onLabel, onAmount, onRemove, options }: { x: LA; onLabel: (v: string) => void; onAmount: (v: number) => void; onRemove: () => void; options?: string[] }) {
  return (
    <div className="flex gap-2">
      {options ? (
        <select value={x.label} onChange={(e) => onLabel(e.target.value)} className={`${inp} flex-1`}>
          {options.map((o) => <option key={o}>{o}</option>)}
          {x.label && !options.includes(x.label) && <option value={x.label}>{x.label}</option>}
        </select>
      ) : (
        <input value={x.label} onChange={(e) => onLabel(e.target.value)} className={`${inp} flex-1`} placeholder="Label" />
      )}
      <input type="number" value={x.amount} onChange={(e) => onAmount(Number(e.target.value))} className={`${inp} w-28`} placeholder="Amount" />
      <button onClick={onRemove} className="px-2 text-muted hover:text-danger">✕</button>
    </div>
  );
}
