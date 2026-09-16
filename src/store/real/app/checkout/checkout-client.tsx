"use client";

// CHECKOUT PAGE — Shopify-style: form sa kaliwa (contact, delivery,
// shipping method, payment), order summary sa kanan.
//
// Ang order ay ipinapadala sa PAN app (send-order), na siyang nagbibigay
// ng tunay na order number at ng 30% downpayment. Dalawang paraan ng bayad:
//   QR Ph  — QR code na sina-scan sa GCash / Maya / GoTyme / bank app
//   Card   — CardForm; tinotokenize ang card sa browser papuntang Maya, at
//            ang app ang naniningil (tingnan ang lib/maya-tokenize.ts at
//            app/api/pay-card). Hindi dumadaan ang card sa server natin.

import Image from "next/image";
import Link from "next/link";
import dynamic from "next/dynamic";
import { useEffect, useMemo, useState } from "react";
import { groupBuildLines } from "@/lib/build-groups";
import { pinMismatch } from "@/lib/pin-match";
import type { PickedLocation } from "@/components/LocationPicker";
import { categoryTitle, formatPrice, type Product, type SiteContent } from "@/lib/products";
import { useStore } from "@/components/store";
import CardForm from "@/components/CardForm";
import RedirectCountdown from "@/components/RedirectCountdown";
import MessengerRedirect from "@/components/MessengerRedirect";
import StreetSuggest from "@/components/StreetSuggest";
import AddressSearch, { type PlaceDetail } from "@/components/AddressSearch";
import { matchCity } from "@/lib/city-match";

import { messengerHandle, messengerUrl } from "@/lib/messenger";
import { DEFAULT_BED_SIZES } from "@/components/FrameDiagram";

// Map = client-only (Leaflet umaasa sa window) — walang SSR
const LocationPicker = dynamic(() => import("@/components/LocationPicker"), {
  ssr: false,
  loading: () => (
    <div className="w-full h-64 rounded border border-stone/40 bg-sand/40 flex items-center justify-center text-sm text-stone mb-3">
      Loading map…
    </div>
  ),
});

// Shipping fee per lokasyon (province -> city -> fee) — naka-edit sa
// Admin → Promo & Site. Nasa loob na ng component ang listahan dahil
// prop na ang `site` (hindi na module-level na import).
type ShipCity = { name: string; fee: number };
type ShipProvince = { name: string; cities: ShipCity[] };

type Order = {
  number: string;
  items: {
    name: string;
    color: string; // variant key (fallback lang)
    qty: number;
    price: number;
    baseLabel?: string; // hal. "Maserati Burly Wood / Single"
    basePrice?: number;
    category?: string; // hal. "Swivel Chair" — pamagat ng base line sa breakdown
    addOns?: { label: string; price: number; note?: string }[];
  }[];
  subtotal: number;
  shipping: number;
  location: string;
  pinnedAddress?: string;
  mapLink?: string;
  total: number;
  email: string;
  name: string;
  // Downpayment (30%) via Maya — QR Ph payload o hosted checkout URL
  amountDue?: number;
  qrDataUrl?: string; // naka-render nang QR image (data: URI)
  paymentUrl?: string;
  // Row id sa PAN Furniture app — doon kinukuha ng server ang halagang
  // sisingilin kapag nagbayad ng card, para hindi ito galing sa browser.
  appOrderId?: string;
  payMethod?: "qr" | "card";
};

// Ang larawan ay naka-imbak bilang "/images/..." — relative sa site na ito.
// Ang PAN app ay ibang domain, kaya hindi niya ito mahahanap; kailangang
// buong URL para makita ng workshop ang reference na larawan.
function absoluteUrl(path?: string | null): string | null {
  if (!path) return null;
  if (/^https?:\/\//i.test(path)) return path;
  if (typeof window === "undefined") return path;
  return `${window.location.origin}${path.startsWith("/") ? "" : "/"}${path}`;
}

// Hanapin ang sukat ng isang size. Ang product ay maaaring walang sariling
// bedSizes — doon ang default ang ipinapakita ng page, kaya doon din tayo
// tumitingin. Hindi rin pare-pareho ang titik ("Single" vs "SINGLE").
function sizeSpecFor(
  size: string,
  bedSizes?: { size: string; dim?: string; A?: string; B?: string; C?: string; D?: string; E?: string }[],
) {
  const key = size.trim().toLowerCase();
  return (
    bedSizes?.find((b) => b.size.trim().toLowerCase() === key) ??
    DEFAULT_BED_SIZES.find((b) => b.size.trim().toLowerCase() === key)
  );
}

// Ang detalye ng isang order line — kulay, sukat, kategorya — bawat isa
// sariling bullet. Ang baseLabel ay "Kulay / Size"; hinihiwalay natin ito
// para makuha ang size, tapos hinahanap ang aktwal na sukat.
function describeVariant(
  item: { baseLabel?: string; color?: string },
  product: { category?: string; bedSizes?: { size: string; dim?: string }[] },
): string[] {
  const parts = (item.baseLabel ?? item.color ?? "")
    .split("/")
    .map((s) => s.trim())
    .filter(Boolean);

  const out: string[] = [];
  let size: string | null = null;

  if (parts.length > 1) {
    // "Kulay / Size" — kulay muna, tapos ang size
    const [color, ...rest] = parts;
    size = rest.join(" / ");
    out.push(color);
  } else if (parts.length === 1) {
    // Isa lang — pwedeng kulay o size; ang lookup ang magsasabi.
    size = parts[0];
  }

  if (size) {
    const spec = sizeSpecFor(size, product.bedSizes);
    out.push(spec?.dim ? `${size} · ${spec.dim}` : size);
    // Ang buong frame na sukat — ito ang ginagamit ng workshop.
    if (spec?.A) {
      const frame = [
        spec.A && `W ${spec.A}`,
        spec.B && `Hdbrd ${spec.B}`,
        spec.C && `L ${spec.C}`,
        spec.D && `Base ${spec.D}`,
        spec.E && `Legs ${spec.E}`,
      ]
        .filter(Boolean)
        .join(" · ");
      if (frame) out.push(frame);
    }
  }

  if (product.category) out.push(prettyCategory(product.category));
  return out;
}

// Ang kulay lang mula sa "Kulay / Size" (kung may size na kasama).
function variantColor(item: { baseLabel?: string; color?: string }): string | undefined {
  const parts = (item.baseLabel ?? item.color ?? "")
    .split("/")
    .map((s) => s.trim())
    .filter(Boolean);
  return parts.length > 1 ? parts[0] : undefined;
}

// Ang aktwal na sukat ng napiling size, hal. '36"x75"'.
function variantDimension(
  item: { baseLabel?: string; color?: string },
  product: { bedSizes?: { size: string; dim?: string }[] },
): string | undefined {
  const parts = (item.baseLabel ?? item.color ?? "")
    .split("/")
    .map((s) => s.trim())
    .filter(Boolean);
  const size = parts.length > 1 ? parts.slice(1).join(" / ") : parts[0];
  return size ? sizeSpecFor(size, product.bedSizes)?.dim : undefined;
}

// "sofa-bed" -> "Sofa Bed"
function prettyCategory(c: string): string {
  return categoryTitle(c);
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  half = false,
  error,
  inputMode,
  maxLength,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  half?: boolean;
  error?: string;
  inputMode?: "numeric" | "text" | "email" | "tel";
  maxLength?: number;
}) {
  return (
    <label className={`block mb-3 ${half ? "" : "col-span-2"}`}>
      <span className="block text-xs font-bold text-stone mb-1">{label}</span>
      <input
        value={value}
        placeholder={placeholder}
        inputMode={inputMode}
        maxLength={maxLength}
        onChange={(e) => onChange(e.target.value)}
        className={`w-full border bg-white px-4 py-3 text-sm rounded focus:outline-none focus:border-cognac ${
          error ? "border-red-600" : "border-stone/40"
        }`}
      />
      {error && <span className="text-red-700 text-xs">{error}</span>}
    </label>
  );
}

// Ang `site` at `products` ay ipinapasa ng page.tsx (server) — doon lang
// nababasa ang sariwang laman ng Supabase.
export default function CheckoutClient({
  site,
  products,
}: {
  site: SiteContent;
  products: Product[];
}) {
  const { cart, clearCart } = useStore();
  const SHIP_LOCATIONS: ShipProvince[] = (site as any).shipping?.provinces ?? [];

  // ── ISANG PINDOT MULA SA HANAPAN ──────────────────────────────────────────
  // BUG NA INAAYOS NITO (2026-08-23): ang StreetSuggest sa ibaba ay nagtatakda
  // lang ng pin at ng teksto ng address — hindi nito ginagalaw ang Province at
  // City. Kaya ang customer na naghanap ng "Bano Street, Pakil, Laguna" ay may
  // Street na Pakil, Laguna PERO Province/City na naiwang Batangas / Mataas na
  // Kahoy — at sinisingil ng ₱5,000 para sa maling bayan. Walang nagsasabi sa
  // kanya, at walang nagsasabi sa atin hangga't hindi na dumarating ang truck.
  const [searchNote, setSearchNote] = useState("");
  function applyPlace(d: PlaceDetail) {
    setSearchNote("");
    if (d.postal) setPostal(d.postal);
    if (d.barangay) setBarangay(d.barangay);
    if (d.street || d.name) setAddress(d.street || d.name);

    const prov = SHIP_LOCATIONS.find((p) => p.name.toLowerCase() === (d.province || "").toLowerCase());
    if (prov) {
      setProvince(prov.name);
      setRegion(REGION_OF[prov.name] ?? "");
      const hit = matchCity(d.city, prov.cities);
      if (hit) setCity(hit);
      else {
        // WALANG HINUHULAANG BAYAD. Mas mabuting blangko kaysa sa singil para sa
        // ibang bayan — ang mali ay nakikita lang sa araw ng delivery.
        setCity("");
        setSearchNote(`We don't deliver to ${d.city || "this area"} yet — pick the nearest town below.`);
      }
    } else if (d.province) {
      setProvince("");
      setCity("");
      setSearchNote(`We don't deliver to ${d.province} yet — we cover Metro Manila and Calabarzon for now.`);
    }

    if (Number.isFinite(d.lat) && Number.isFinite(d.lng)) {
      setPin({ lat: d.lat as number, lng: d.lng as number, address: d.formatted || d.name });
      setErrors((e) => ({ ...e, address: "" }));
    }
  }

  // Binura ang hanapan → mawawala rin ang lahat ng pinunan nito, pati ang
  // shipping fee na nakasalalay sa bayan. Ang naiiwang bayad para sa bayang
  // wala na sa form ay ang mismong bug na inaayos ng hanapang ito.
  function clearPlace() {
    setSearchNote("");
    setRegion("");
    setProvince("");
    setCity("");
    setBarangay("");
    setAddress("");
    setPostal("");
    setPin(null);
  }

  // Page ng tindahan sa Messenger — galing sa Facebook URL sa admin panel.
  const messengerPage = messengerHandle((site as any).social?.facebook);

  // Form state
  const [email, setEmail] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [address, setAddress] = useState("");
  // Auto-fill mula sa shipping estimator sa product page (kung may napili
  // na siyang lugar doon, hindi na uulitin dito)
  const savedLoc = (() => {
    if (typeof window === "undefined") return { province: "", city: "" };
    try {
      return JSON.parse(localStorage.getItem("pan_ship_loc") ?? "{}");
    } catch {
      return { province: "", city: "" };
    }
  })();
  // Shopee-style hierarchy: Country (PH) → Region → Province → City → Barangay.
  // Ang region ay hinango sa province (CALABARZON atbp.) para mag-filter lang.
  const REGION_OF: Record<string, string> = {
    "Laguna": "CALABARZON (Region IV-A)", "Batangas": "CALABARZON (Region IV-A)",
    "Cavite": "CALABARZON (Region IV-A)", "Rizal": "CALABARZON (Region IV-A)",
    "Quezon": "CALABARZON (Region IV-A)",
    "Metro Manila (NCR)": "Metro Manila (NCR)", "Bulacan": "Central Luzon (Region III)",
  };
  const [region, setRegion] = useState(savedLoc.province ? (REGION_OF[savedLoc.province] ?? "") : "");
  const [barangay, setBarangay] = useState("");
  // Opisyal na PSGC barangay list bawat "Province|City" — static file sa /public.
  const [brgyData, setBrgyData] = useState<Record<string, string[]>>({});
  useEffect(() => {
    fetch("/barangays.json").then((r) => r.json()).then(setBrgyData).catch(() => {});
  }, []);
  const [province, setProvince] = useState(savedLoc.province ?? "");
  const [city, setCity] = useState(savedLoc.city ?? "");
  const [postal, setPostal] = useState("");
  const [phone, setPhone] = useState("");
  const [fbName, setFbName] = useState("");
  const [landmark, setLandmark] = useState("");
  const [fbLink, setFbLink] = useState("");
  // Ang BUONG sagot ng picker, hindi lang ang coordinates: kailangan ang
  // bayan at lalawigan para masabi kung tugma ito sa mga dropdown.
  const [pin, setPin] = useState<PickedLocation | null>(null);
  // Paano magbabayad ng 30% downpayment: QR Ph (GCash/GoTyme/bank app)
  // o card (CardForm — tinotokenize sa browser, sinisingil ng app)
  const [payMethod, setPayMethod] = useState<"qr" | "card">("qr");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [placing, setPlacing] = useState(false);
  // Nabayaran na ba ang card sa confirmation screen? (Ang QR ay walang
  // katumbas nito — ang webhook ang bahala doon.)
  const [cardPaid, setCardPaid] = useState(false);
  // Na-detect na ba ang QR payment (poll sa /api/track habang nakabukas ang
  // confirmation page)? Pareho ang epekto ng cardPaid: salamat + uwi sa home.
  const [qrPaid, setQrPaid] = useState(false);
  const [order, setOrder] = useState<Order | null>(null);

  // QR: bantayan kung nag-land na ang bayad. Ang /api/track ay bukas sa
  // order number + email (pareho ng track page), at nagbabalik ng `paid`.
  const paymentDone = cardPaid || qrPaid;
  useEffect(() => {
    if (!order || !order.qrDataUrl || paymentDone) return;
    const iv = setInterval(async () => {
      try {
        const qs = new URLSearchParams({ order: order.number, verify: order.email });
        const res = await fetch(`/api/track?${qs}`, { cache: "no-store" });
        if (!res.ok) return;
        const data = await res.json();
        if ((Number(data?.paid) || 0) > 0) setQrPaid(true);
      } catch {
        /* network blip — susubok ulit sa susunod na ikot */
      }
    }, 5000);
    return () => clearInterval(iv);
  }, [order, paymentDone]);

  // Bayad na (QR man o card): 5 segundong "salamat" tapos diretso sa
  // MESSENGER na may kasamang order ref (parang CHAT WITH US NOW) — doon
  // magsisimula ang conversation: matatali ang PSID nila sa order at
  // awtomatikong ie-echo ng page ang order sa thread. Kung walang naka-set
  // na Messenger page, uwi na lang sa home.
  useEffect(() => {
    if (!paymentDone || !order) return;
    const dest = messengerPage ? messengerUrl(messengerPage, order.number) : "/";
    const t = setTimeout(() => { window.location.href = dest; }, 5000);
    return () => clearTimeout(t);
  }, [paymentDone, order, messengerPage]);

  const rows = useMemo(
    () =>
      cart
        .map((item) => ({
          item,
          product: products.find((p) => p.slug === item.slug),
        }))
        .filter((r) => r.product),
    [cart, products]
  );
  const subtotal = rows.reduce((sum, r) => sum + (r.item.unitPrice ?? r.product!.price) * r.item.qty, 0);

  const brgyOptions = useMemo(
    () => brgyData[`${province}|${city}`] ?? [],
    [brgyData, province, city]
  );

  // Shipping fee base sa napiling province + city
  const cityList = useMemo(
    () => SHIP_LOCATIONS.find((p) => p.name === province)?.cities ?? [],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [province, site]
  );
  const selectedCity = cityList.find((c) => c.name === city);
  const shippingKnown = !!selectedCity;
  const shippingCost = selectedCity?.fee ?? 0;
  const total = subtotal + shippingCost;
  // 30% downpayment — kapareho ng in-store (kinakalkula rin ng app)
  const downpayment = Math.round(total * 0.3 * 100) / 100;


  function validate(): boolean {
    const e: Record<string, string> = {};
    if (!email.includes("@")) e.email = "Enter a valid email.";
    if (!firstName.trim()) e.firstName = "Required.";
    if (!lastName.trim()) e.lastName = "Required.";
    if (!address.trim()) e.address = "Required.";
    if (!province) e.province = "Please select a province.";
    if (brgyOptions.length > 0 && !barangay) e.barangay = "Please select a barangay.";
    if (!city) e.city = "Please select a city/town.";
    if (!postal.trim()) e.postal = "Required.";
    if (phone.replace(/\D/g, "").length < 7) e.phone = "Phone number is required.";
    if (!fbName.trim()) e.fbName = "Required.";
    // Walang card fields — ang bayad ay sa Maya (QR o hosted checkout)
    setErrors(e);
    return Object.keys(e).length === 0;
  }

  async function placeOrder() {
    if (!validate()) return;
    setPlacing(true);
    // DEMO: kunwaring pinoproseso — walang totoong bayad
    await new Promise((r) => setTimeout(r, 1500));
    const newOrder: Order = {
      number: "PAN-" + Math.random().toString(36).slice(2, 8).toUpperCase(),
      items: rows.map((r) => ({
        name: r.product!.name,
        color: r.item.color,
        qty: r.item.qty,
        price: r.item.unitPrice ?? r.product!.price,
        baseLabel: r.item.baseLabel,
        basePrice: r.item.basePrice,
        category: prettyCategory(r.product!.category),
        addOns: r.item.addOns,
      })),
      subtotal,
      shipping: shippingCost,
      location: `${city}, ${province}`,
      pinnedAddress: pin?.address,
      mapLink: pin ? `https://www.google.com/maps?q=${pin.lat},${pin.lng}` : undefined,
      total,
      email,
      name: `${firstName} ${lastName}`,
    };
    // Ipadala sa PAN Furniture app (Orders list) + kumuha ng Maya
    // downpayment QR. Best-effort — kahit mabigo, may confirmation pa rin.
    try {
      const res = await fetch("/api/send-order", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customer_name: `${firstName} ${lastName}`.trim(),
          email,
          contact_number: phone,
          address: [address, barangay ? `Brgy. ${barangay}` : "", city, province, postal].filter(Boolean).join(", "),
          // Hiwalay ding ipinapadala ang mga bahagi ng address. Hindi
          // kayang laktawan ng Maya ang Shipping & Billing step nito kung
          // ang alam lang niya ay isang pinagsamang string — kailangan
          // niyang hiwalay ang city / province / postal para mapunan.
          city,
          province,
          postal_code: postal,
          fb_name: fbName,
          landmark: landmark.trim() || null,
          fb_link: fbLink,
          address_lat: pin?.lat ?? null,
          address_lng: pin?.lng ?? null,
          order_ref: newOrder.number,
          payment_method: payMethod,
          total,
          shipping: shippingKnown
            ? {
                // Pamagat + destinasyon lang (basis ng fee). ANG BUONG ADDRESS
                // AY HINDI NA ISINASAMA — nasa order na mismo iyon; kapag
                // inulit dito, dumodoble ang address sa IMS at receipt.
                label: ["Shipping", `• ${city}, ${province}`].join("\n"),
                amount: shippingCost,
              }
            : null,
          // ISANG LINE ITEM KADA PRODUKTO — ang mga opsyon ay bullet sa loob
          // nito, hindi sariling hilera.
          //
          // Dating flatMap: bawat add-on ay itinutulak bilang hiwalay na item,
          // kaya ang kamang may labing-isang opsyon ay dumarating sa IMS bilang
          // labindalawang hilera, labing-isa niyon ay ₱0.00. Sa Edit Order,
          // ang hilerang "Size: SINGLE 36X75" ay mukhang line item — kaya
          // nabuburang parang line item, at tahimik na nawawala ang sukat sa
          // order. Ganito na ang porma ng quotation/MTO; ito ang sinusundan.
          items: rows.map(({ item, product }) => ({
            qty: item.qty,
            // Pangalan sa unang linya, tapos bullet bawat detalye —
            // kulay, sukat, kategorya, saka ang mga add-on na may presyo.
            description: [
              product!.name,
              ...describeVariant(item, product!).map((d) => `• ${d}`),
              ...(item.addOns ?? []).map((a) => {
                const label = a.note ? `${a.label} — ${a.note}` : a.label;
                // Ang presyo ay nasa bullet para makita kung saan galing ang
                // kabuuan ng hilera — nawawala iyon kapag pinagsama lang.
                return a.price > 0 ? `• ${label} (+${formatPrice(a.price)})` : `• ${label}`;
              }),
            ].join("\n"),
            // Buo ang presyo ng produkto: base kasama ang mga add-on nito.
            // Pareho ang kabuuan ng order — nakatipon lang sa isang hilera.
            unitPrice:
              (item.basePrice ?? item.unitPrice ?? product!.price) +
              (item.addOns ?? []).reduce((s, a) => s + (Number(a.price) || 0), 0),
            image: absoluteUrl(item.image || product!.images[0]),
            // Structured — dito hinahanap ng app ang katugmang produkto sa
            // Product Management; kung wala pa, dito nito ibabatay ang
            // bagong record (preorder).
            product_name: product!.name,
            sku: (product as { sku?: string }).sku || undefined,
            color: variantColor(item),
            dimension: variantDimension(item, product!),
            category: prettyCategory(product!.category),
          })),
        }),
      });

      const data = await res.json().catch(() => ({}));
      if (data?.ok) {
        // Gamitin ang tunay na order number ng app (ORD-000078)
        if (data.order_number) newOrder.number = data.order_number;
        newOrder.amountDue = data.amount_due;
        newOrder.paymentUrl = data.payment_url ?? undefined;
        // I-render ang QR Ph payload bilang image
        if (data.qr_payload) {
          try {
            const QRCode = (await import("qrcode")).default;
            newOrder.qrDataUrl = await QRCode.toDataURL(data.qr_payload, {
              width: 320,
              margin: 1,
              color: { dark: "#2b2118", light: "#ffffff" },
            });
          } catch {
            // kung pumalya ang render, may payment_url pa rin
          }
        }
      }
    } catch {
      // walang hadlang sa customer kahit hindi umabot sa app
    }

    // I-save ang order sa browser (para may record) — pagkatapos makuha
    // ang tunay na order number at payment info
    try {
      const prev = JSON.parse(localStorage.getItem("pan_orders") ?? "[]");
      localStorage.setItem("pan_orders", JSON.stringify([newOrder, ...prev]));
    } catch {}

    clearCart();
    setOrder(newOrder);
    setPlacing(false);
    window.scrollTo({ top: 0 });
  }

  // ---------- ORDER CONFIRMATION ----------
  if (order) {
    return (
      <div className="max-w-3xl mx-auto px-6 py-16 text-center">
        <div className="w-16 h-16 rounded-full bg-green-100 text-green-700 text-3xl flex items-center justify-center mx-auto mb-6">
          ✓
        </div>
        <h1 className="text-3xl font-bold mb-2">Thank you, {order.name.split(" ")[0]}!</h1>
        <p className="text-stone mb-1">
          {order.qrDataUrl || order.paymentUrl
            ? "Your order is reserved — pay the downpayment to confirm it."
            : "Your order is confirmed."}
        </p>
        <p className="text-sm mb-8">
          Order number: <strong className="text-cognac">{order.number}</strong>
        </p>

        {/* ---- BAYARAN: QR Ph o hosted card page (30% downpayment) ---- */}
        {(order.qrDataUrl || order.paymentUrl) && (
          <div className="bg-white border border-sand rounded-lg p-6 mb-8 text-left">
            <div className="flex items-baseline justify-between mb-4">
              <span className="font-bold">Downpayment due now</span>
              <span className="text-2xl font-bold text-cognac">
                {formatPrice(order.amountDue ?? 0)}
              </span>
            </div>

            {paymentDone ? (
              // Bayad na (QR man o card) — salamat + uuwi sa home sa loob ng
              // 5 segundo (tingnan ang redirect effect sa itaas).
              <div className="flex flex-col items-center py-6 text-center">
                <p className="text-sm font-semibold text-green-700">
                  ✓ Payment received — thank you!
                </p>
                <div className="mt-4 h-7 w-7 animate-spin rounded-full border-2 border-sand border-t-cognac" />
                <p className="text-xs text-stone mt-3">
                  Opening our Messenger chat for your order updates…
                </p>
              </div>
            ) : order.qrDataUrl ? (
              <div className="flex flex-col items-center">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={order.qrDataUrl}
                  alt="QR Ph payment code"
                  className="w-56 h-56 rounded border border-sand"
                />
                <p className="text-sm text-stone text-center mt-4 leading-snug">
                  Scan with <strong className="text-ink">GCash</strong>,{" "}
                  <strong className="text-ink">Maya</strong>,{" "}
                  <strong className="text-ink">GoTyme</strong>, or any bank app
                  that supports QR&nbsp;Ph.
                </p>
                {order.paymentUrl && (
                  <a
                    href={order.paymentUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-cognac underline mt-2"
                  >
                    Open payment page instead
                  </a>
                )}
              </div>
            ) : (
              <CardForm
                amount={order.amountDue ?? 0}
                orderId={order.number}
                orderNumber={order.number}
                onPaid={() => setCardPaid(true)}
                // Kapag hindi available ang card (Vault hindi naka-provision),
                // ibinabalik natin siya sa payment page imbes na mag-dead-end.
                onFallback={() => {
                  if (order.paymentUrl) window.location.href = order.paymentUrl;
                }}
              />
            )}

            <p className="text-xs text-stone mt-4 pt-4 border-t border-sand leading-snug">
              Once payment lands, your order moves to production automatically —
              we&apos;ll email your receipt. The remaining balance is settled
              before delivery.
            </p>
          </div>
        )}

        <div className="bg-linen text-left p-6 rounded mb-8">
          {order.items.map((it, i) => (
            <div key={i} className="py-3 border-b border-sand last:border-0">
              {/* Pangalan + kabuuan */}
              <div className="flex justify-between gap-3">
                <span className="font-bold">
                  {it.qty}× {it.name}
                </span>
                <span className="font-bold whitespace-nowrap">
                  {formatPrice(it.price * it.qty)}
                </span>
              </div>
              <p className="text-sm text-stone mt-0.5">
                {it.baseLabel ?? it.color.split(" + ")[0]}
              </p>

              {/* Breakdown ng bawat bahagi — nakapangkat, tugma sa Order
                  Summary at sa /quote-request. Ito ang kumpirmasyon
                  pagkatapos mag-order: ang parehong build ay hindi dapat
                  magbago ng anyo pagkalipat ng isang screen. */}
              {it.addOns && it.addOns.length > 0 && (
                <div className="mt-2.5 space-y-1.5 border-t border-sand/70 pt-2.5">
                  {/* Pamagat ng base line = category ng produkto (Swivel Chair, Promo Bed…),
                      hindi laging "Bed frame" (2026-09-05). Ready unit = lahat ng linya ay
                      ang produkto mismo, walang ADD-ONS. */}
                  <div className="flex justify-between text-sm">
                    <span>{it.category ?? "Base price"}{/^ready unit/i.test(it.baseLabel ?? "") ? " · ready unit" : ""}</span>
                    <span>{formatPrice(it.basePrice ?? 0)}</span>
                  </div>
                  {groupBuildLines(it.addOns, { allItem: /^ready unit/i.test(it.baseLabel ?? "") }).map((g) => (
                    <div key={g.title} className="pt-1">
                      <p className="mb-1 text-[10px] font-extrabold uppercase tracking-widest2 text-cognac">
                        {g.title}
                      </p>
                      <div className="space-y-1">
                        {g.lines.map((a, j) => (
                          <div key={j} className="flex justify-between gap-3 text-[13px]">
                            <span className="text-stone">
                              {a.label}
                              {(a as { note?: string }).note && (
                                <span className="mt-0.5 block text-xs text-cognac">
                                  {(a as { note?: string }).note}
                                </span>
                              )}
                            </span>
                            {Number(a.price) > 0 && (
                              <span className="whitespace-nowrap font-semibold text-cognac">
                                +{formatPrice(Number(a.price))}
                              </span>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
          <div className="pt-3 space-y-1 text-sm border-t border-sand mt-1">
            <div className="flex justify-between text-stone">
              <span>Subtotal</span>
              <span>{formatPrice(order.subtotal)}</span>
            </div>
            <div className="flex justify-between text-stone">
              <span>Shipping · {order.location}</span>
              <span>{formatPrice(order.shipping)}</span>
            </div>
            <div className="flex justify-between font-bold text-base pt-1">
              <span>Total</span>
              <span>{formatPrice(order.total)}</span>
            </div>
          </div>
          {order.pinnedAddress && (
            <div className="border-t border-sand mt-3 pt-3 text-xs text-stone">
              📍 Pinned: {order.pinnedAddress}
              {order.mapLink && (
                <>
                  {" · "}
                  <a href={order.mapLink} target="_blank" rel="noopener noreferrer" className="text-cognac underline">
                    View on Google Maps
                  </a>
                </>
              )}
            </div>
          )}
        </div>

        <p className="text-xs text-stone mb-8">
          We&apos;ll email your receipt to {order.email} once the payment lands.
        </p>

        {/* Dalhin siya sa Messenger kasama ang order number. Nasa ibaba ito ng
            QR at ng buod nang sadya — kung diretso agad sa Messenger,
            hindi na niya makikita ang QR na dapat i-scan para makabayad. */}
        {messengerPage && (
          <MessengerRedirect
            pageId={messengerPage}
            orderNumber={order.number}
            // Bumibilang lang kapag bayad na. Habang hindi pa, nananatili ang
            // buton pero walang awtomatikong paglipat — masama kung mailipat
            // siya habang sina-scan pa ang QR o nagta-type ng card.
            autoOpen={false}
          />
        )}

        {/* Kapag bayad na ang card, ibalik siya sa home. Sa QR ay hindi —
            nasa page pa ang QR code habang sina-scan ito sa phone. */}
        {cardPaid ? (
          <RedirectCountdown label="CONTINUE SHOPPING" />
        ) : (
          <Link
            href="/"
            className="inline-block bg-ink text-cream px-8 py-4 text-sm font-bold tracking-widest2 hover:bg-cognac transition-colors"
          >
            CONTINUE SHOPPING
          </Link>
        )}
      </div>
    );
  }

  // ---------- EMPTY CART ----------
  if (rows.length === 0) {
    return (
      <div className="max-w-2xl mx-auto px-6 py-24 text-center">
        <h1 className="text-3xl font-bold mb-4">Your cart is empty</h1>
        <p className="text-stone mb-8">Add something to your cart before checking out.</p>
        <Link
          href="/collections/sofas"
          className="inline-block bg-ink text-cream px-8 py-4 text-sm font-bold tracking-widest2 hover:bg-cognac transition-colors"
        >
          SHOP SOFAS
        </Link>
      </div>
    );
  }

  // ---------- CHECKOUT FORM ----------
  return (
    <div className="max-w-6xl mx-auto px-6 py-10">
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_460px] gap-12 items-start">
        {/* ---------- LEFT: FORM ---------- */}
        <div>
          {/* Contact */}
          <h2 className="text-xl font-bold mb-4">Contact</h2>
          <div className="grid grid-cols-2 gap-x-3">
            <Field label="Email" value={email} onChange={setEmail} placeholder="you@email.com" inputMode="email" error={errors.email} />
          </div>

          {/* Delivery */}
          <h2 className="text-xl font-bold mb-4 mt-8">Delivery</h2>
          <div className="grid grid-cols-2 gap-x-3">
            <Field label="First name" value={firstName} onChange={setFirstName} half error={errors.firstName} />
            <Field label="Last name" value={lastName} onChange={setLastName} half error={errors.lastName} />
            

            {/* Shopee-style: Country → Region → Province → City → Barangay,
                saka ang street — at ang mapa ay lalabas lang pag kumpleto. */}
            <label className="block mb-3 col-span-2 sm:col-span-1">
              <span className="block text-xs font-bold text-stone mb-1">Country</span>
              <select value="PH" disabled className="w-full border border-stone/40 bg-sand/50 px-4 py-3 text-sm rounded text-stone">
                <option value="PH">Philippines</option>
              </select>
            </label>
            {/* ── HANAPAN MUNA ────────────────────────────────────────────
                Isang pindot at napupunan ang Province, City, Barangay, Postal,
                Street at ang pin — kasama ang tamang shipping fee. Ang mga
                dropdown sa ibaba ay para sa pag-aayos at para sa lugar na hindi
                mahanap ng search. */}
            <div className="col-span-2 mb-1">
              <AddressSearch onPick={applyPlace} onClear={clearPlace} />
              {searchNote ? (
                <p className="-mt-2 mb-3 rounded bg-cognac/10 px-3 py-2 text-[11px] font-medium leading-snug text-cognac">{searchNote}</p>
              ) : (
                <p className="-mt-2 mb-3 text-[11px] leading-snug text-stone">
                  Type a house, school, church, or town — this fills in the address below.
                </p>
              )}
            </div>

            <label className="block mb-3 col-span-2 sm:col-span-1">
              <span className="block text-xs font-bold text-stone mb-1">Region</span>
              <select
                value={region}
                onChange={(e) => { setRegion(e.target.value); setProvince(""); setCity(""); setBarangay(""); }}
                className="w-full border border-stone/40 bg-white px-4 py-3 text-sm rounded focus:outline-none focus:border-cognac"
              >
                <option value="">— Select —</option>
                {Array.from(new Set(SHIP_LOCATIONS.map((p) => REGION_OF[p.name] ?? "Other"))).map((r) => (
                  <option key={r} value={r}>{r}</option>
                ))}
              </select>
            </label>

            {/* Province dropdown → nagse-set ng shipping fee kasama ang city */}
            <label className="block mb-3 col-span-2 sm:col-span-1">
              <span className="block text-xs font-bold text-stone mb-1">Province</span>
              <select
                value={province}
                onChange={(e) => {
                  setProvince(e.target.value);
                  setCity(""); // reset city kapag nagpalit ng province
                  setBarangay("");
                  if (e.target.value) setRegion(REGION_OF[e.target.value] ?? "");
                }}
                className={`w-full border bg-white px-4 py-3 text-sm rounded focus:outline-none focus:border-cognac ${
                  errors.province ? "border-red-600" : "border-stone/40"
                }`}
              >
                <option value="">— Select —</option>
                {SHIP_LOCATIONS.filter((p) => !region || (REGION_OF[p.name] ?? "Other") === region).map((p) => (
                  <option key={p.name} value={p.name}>{p.name}</option>
                ))}
              </select>
              {errors.province && <span className="text-red-700 text-xs">{errors.province}</span>}
            </label>

            {/* City dropdown — depende sa napiling province */}
            <label className="block mb-3 col-span-2 sm:col-span-1">
              <span className="block text-xs font-bold text-stone mb-1">City / Town</span>
              <select
                value={city}
                disabled={!province}
                onChange={(e) => { setCity(e.target.value); setBarangay(""); }}
                className={`w-full border bg-white px-4 py-3 text-sm rounded focus:outline-none focus:border-cognac disabled:bg-sand/50 disabled:text-stone ${
                  errors.city ? "border-red-600" : "border-stone/40"
                }`}
              >
                <option value="">{province ? "— Select —" : "Select a province first"}</option>
                {cityList.map((c) => (
                  <option key={c.name} value={c.name}>
                    {c.name}
                  </option>
                ))}
              </select>
              {errors.city && <span className="text-red-700 text-xs">{errors.city}</span>}
            </label>

            {/* Barangay — opisyal na PSGC list ng napiling city */}
            <label className="block mb-3 col-span-2 sm:col-span-1">
              <span className="block text-xs font-bold text-stone mb-1">Barangay</span>
              {brgyOptions.length > 0 ? (
                <select
                  value={barangay}
                  disabled={!city}
                  onChange={(e) => setBarangay(e.target.value)}
                  className={`w-full border bg-white px-4 py-3 text-sm rounded focus:outline-none focus:border-cognac disabled:bg-sand/50 disabled:text-stone ${errors.barangay ? "border-red-600" : "border-stone/40"}`}
                >
                  <option value="">{city ? "— Select —" : "Select a city first"}</option>
                  {brgyOptions.map((b) => <option key={b} value={b}>{b}</option>)}
                </select>
              ) : (
                <input
                  value={barangay}
                  disabled={!city}
                  onChange={(e) => setBarangay(e.target.value)}
                  placeholder={city ? "Type your barangay" : "Select a city first"}
                  className="w-full border border-stone/40 bg-white px-4 py-3 text-sm rounded focus:outline-none focus:border-cognac disabled:bg-sand/50"
                />
              )}
              {errors.barangay && <span className="text-red-700 text-xs">{errors.barangay}</span>}
            </label>

            {/* Shopee-style typeahead: habang nagta-type, live na suggestions
                (naka-scope sa napiling Province/City/Barangay); pagpili,
                lumilipat ang pin ng mapa sa kalyeng iyon. */}
            <StreetSuggest
              label="Street / House no."
              value={address}
              onChange={setAddress}
              onPick={(loc) => {
                // Ang pagpili rito ay HINDI nagtatakda ng bayan — naka-scope na
                // ito sa napiling Province/City sa itaas, kaya ang pin lang ang
                // gumagalaw. Ang paghahanap na nagpapalit ng bayan ay nasa
                // AddressSearch sa itaas ng form.
                setPin({ lat: loc.lat, lng: loc.lng, address: loc.address });
                setErrors((e) => ({ ...e, address: "" }));
              }}
              context={[barangay, city, province].filter(Boolean).join(", ")}
              bias={pin}
              placeholder="House no., street, subdivision"
              error={errors.address}
            />

            <Field label="Postal code" value={postal} onChange={setPostal} half inputMode="numeric" error={errors.postal} />
            <Field label="Phone" value={phone} onChange={setPhone} half inputMode="tel" error={errors.phone} />
            {/* Dito karamihan nakikipag-usap ang customer — kailangan ng
                team para may mabalikan sa Messenger. */}
            <Field
              label="Landmark / delivery notes (optional)"
              value={landmark}
              onChange={setLandmark}
              placeholder="e.g. blue gate, across the sari-sari store, call on arrival"
            />
            <Field
              label="Facebook name"
              value={fbName}
              onChange={setFbName}
              half
              placeholder="Name on Facebook"
              error={errors.fbName}
            />
            <Field
              label="Facebook profile link (optional)"
              value={fbLink}
              onChange={setFbLink}
              half
              placeholder="facebook.com/username"
            />
          </div>

          {shippingKnown && (
            <div className="bg-linen rounded px-4 py-3 mt-2 mb-4 text-sm">
              <div className="flex justify-between items-center">
                <span className="text-stone">
                  Shipping fee to <strong className="text-ink">{city}</strong>
                </span>
                <span className="font-bold text-cognac">{formatPrice(shippingCost)}</span>
              </div>
              <p className="text-[11px] text-stone mt-1.5 leading-snug">
                Pin your exact location below so we can confirm this fee.
                Far-end or boundary areas may be adjusted — we&apos;ll contact
                you before dispatch if it changes.
              </p>
            </div>
          )}

          {/* Interactive map pin — eksaktong lokasyon para sa delivery.
              Lumilipat kapag pumili ng province+city; pinupunan ang Address
              field kapag naka-pin na. */}
          {/* Tingnan ang paliwanag sa /quote-request — parehong bitag: ang
              bayad ay galing sa dropdown, hindi sa pin. */}
          {pinMismatch(pin, { city, province }) && (
            <p className="mb-3 rounded border border-[#caa45a] bg-linen px-3 py-2 text-xs leading-snug text-olive">
              <b>Your pin is in {pinMismatch(pin, { city, province })}</b> but you selected {city}, {province}.
              The shipping fee follows the selection — change it above if the pin is right.
            </p>
          )}

          {province && city && barangay ? (
            <LocationPicker
              value={pin}
              flyTo={`${barangay}, ${city}, ${province}, Philippines`}
              onChange={(loc) => {
                setPin(loc);
                if (loc.postcode && !postal.trim()) setPostal(loc.postcode); // auto postal
                // ANG KALYE MULA SA PIN. Ang inilagay na tuldok ang alam ng
                // customer; ang pagpapatipa pa ng kalyeng itinuro na niya sa
                // mapa ay paghingi ng parehong bagay nang dalawang beses.
                // Hindi pinapatungan ang naitipa na — ang "Blk 7 Lot 12" ay
                // mas tiyak kaysa sa pangalan ng kalye.
                if (loc.street && !address.trim()) setAddress(loc.street);
              }}
            />
          ) : (
            <p className="text-xs text-stone bg-linen rounded px-3 py-2">
              Complete your address (province, city, barangay, street) and the map will appear —
              drag the pin to your exact house so our driver finds you easily.
            </p>
          )}

          {/* Payment */}
          <h2 className="text-xl font-bold mb-1 mt-8">Payment</h2>
          <p className="text-xs text-stone mb-4">
            A <strong>30% downpayment</strong> ({formatPrice(downpayment)}) confirms
            your order. The balance is settled before delivery.
          </p>

          {/* Paraan ng bayad — QR Ph o card, parehong via Maya */}
          <div className="grid grid-cols-2 gap-3">
            <button
              type="button"
              onClick={() => setPayMethod("qr")}
              className={`border rounded p-4 text-left transition-colors ${
                payMethod === "qr"
                  ? "border-cognac bg-cognac/5"
                  : "border-stone/30 hover:border-stone/60"
              }`}
            >
              <span className="block text-sm font-bold">QR Ph</span>
              <span className="block text-xs text-stone mt-0.5">
                GCash · Maya · GoTyme · any bank app
              </span>
            </button>
            <button
              type="button"
              onClick={() => setPayMethod("card")}
              className={`border rounded p-4 text-left transition-colors ${
                payMethod === "card"
                  ? "border-cognac bg-cognac/5"
                  : "border-stone/30 hover:border-stone/60"
              }`}
            >
              <span className="block text-sm font-bold">Card</span>
              <span className="block text-xs text-stone mt-0.5">
                Visa · Mastercard — secure page
              </span>
            </button>
          </div>

          <button
            onClick={placeOrder}
            disabled={placing}
            className="w-full mt-6 bg-ink text-cream py-4 text-sm font-bold tracking-widest2 hover:bg-cognac transition-colors disabled:opacity-60"
          >
            {placing
              ? "PROCESSING…"
              : `PLACE ORDER · PAY ${formatPrice(downpayment)} NOW`}
          </button>
          <p className="text-xs text-stone text-center mt-3">
            Questions? {site.contact.email} · {site.contact.phone}
          </p>
        </div>

        {/* ---------- RIGHT: ORDER SUMMARY ---------- */}
        <aside className="bg-linen p-6 rounded lg:sticky lg:top-40">
          <h2 className="font-bold text-lg mb-5">Order Summary</h2>
          <div className="space-y-4 mb-5">
            {rows.map(({ item, product }) => (
              <div key={`${item.slug}-${item.color}`} className="text-sm">
                {/* Header: larawan + pangalan + kabuuan ng linyang ito */}
                <div className="flex gap-3 items-start">
                  <div className="relative w-16 h-14 bg-sand rounded overflow-hidden shrink-0">
                    <Image src={item.image || product!.images[0]} alt={product!.name} fill className="object-contain bg-white" sizes="64px" />
                    <span className="absolute -top-0 -right-0 bg-stone text-cream text-[10px] rounded-bl px-1.5">
                      {item.qty}
                    </span>
                  </div>
                  <div className="flex-1">
                    <p className="font-bold text-base leading-snug">{product!.name}</p>
                    <p className="text-sm text-stone">
                      {/* Lumang cart (walang breakdown): kunin lang ang unang
                          bahagi bago ang "+" para hindi mahaba */}
                      {item.baseLabel ?? item.color.split(" + ")[0]}
                    </p>
                  </div>
                  <p className="font-bold text-base whitespace-nowrap">
                    {formatPrice((item.unitPrice ?? product!.price) * item.qty)}
                  </p>
                </div>

                {/* LUMANG cart (walang structured breakdown): ipakita ang
                    mga add-on mula sa lumang label bilang listahan */}
                {!item.addOns && item.color.includes(" + ") && (
                  <div className="mt-2 ml-[76px] space-y-1 border-l border-sand pl-3">
                    {item.color
                      .split(" + ")
                      .slice(1)
                      .map((label, i) => (
                        <p key={i} className="text-xs text-stone">
                          + {label}
                        </p>
                      ))}
                    <p className="text-[10px] text-cognac">
                      Re-add this item to see the full price breakdown.
                    </p>
                  </div>
                )}

                {/* BREAKDOWN, NAKAPANGKAT — parehong hati ng /quote-request,
                    ng quotation at ng Messenger echo. Patag na listahan ito
                    noon, kaya ang parehong build ay may dalawang mukha
                    depende kung saan tinitingnan.

                    Ang "TBC" sa bawat walang presyong linya ay tinanggal din:
                    ang Size at Fabric ay bahagi ng presyo ng bed frame, hindi
                    dagdag na sisingilin — ang kolum ng "TBC" katapat ng bawat
                    isa ay nagmumukhang may siyam pang hindi alam na halaga. */}
                {item.addOns && item.addOns.length > 0 && (
                  <div className="mt-3 space-y-2 border-t border-sand pt-3">
                    <div className="flex justify-between text-sm">
                      <span className="text-ink">{prettyCategory(product!.category)}{/^ready unit/i.test(item.baseLabel ?? "") ? " · ready unit" : ""}</span>
                      <span className="text-ink">{formatPrice(item.basePrice ?? 0)}</span>
                    </div>
                    {groupBuildLines(item.addOns, { allItem: /^ready unit/i.test(item.baseLabel ?? "") }).map((g) => (
                      <div key={g.title} className="pt-1">
                        <p className="mb-1 text-[10px] font-extrabold uppercase tracking-widest2 text-cognac">
                          {g.title}
                        </p>
                        <div className="space-y-1">
                          {g.lines.map((a, i) => (
                            <div key={i} className="flex justify-between gap-3 text-[13px]">
                              <span className="text-stone">
                                {a.label}
                                {(a as { note?: string }).note && (
                                  <span className="mt-0.5 block text-xs text-cognac">
                                    {(a as { note?: string }).note}
                                  </span>
                                )}
                              </span>
                              {Number(a.price) > 0 && (
                                <span className="whitespace-nowrap font-semibold text-cognac">
                                  +{formatPrice(Number(a.price))}
                                </span>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
          <div className="space-y-2 text-sm border-t border-sand pt-4">
            <div className="flex justify-between">
              <span className="text-stone">Subtotal</span>
              <span>{formatPrice(subtotal)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-stone">
                Shipping{shippingKnown && <span className="text-xs"> ({city})</span>}
              </span>
              {shippingKnown ? (
                <span>{formatPrice(shippingCost)}</span>
              ) : (
                <span className="text-xs text-stone italic">Select a location</span>
              )}
            </div>
            <div className="flex justify-between border-t border-sand pt-3 mt-2 font-bold text-base">
              <span>Total</span>
              <span>{shippingKnown ? formatPrice(total) : formatPrice(subtotal) + " + SF"}</span>
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}
