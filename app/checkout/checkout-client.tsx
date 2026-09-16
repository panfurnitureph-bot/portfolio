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
import { useMemo, useState } from "react";
import { formatPrice, type Product, type SiteContent } from "@/lib/products";
import { useStore } from "@/components/store";
import CardForm from "@/components/CardForm";
import RedirectCountdown from "@/components/RedirectCountdown";
import MessengerRedirect from "@/components/MessengerRedirect";

import { messengerHandle } from "@/lib/messenger";
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
  // Row id sa PAN Furnitures app — doon kinukuha ng server ang halagang
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
  return c
    .split("-")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
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
      return JSON.parse(localStorage.getItem("pb_ship_loc") ?? "{}");
    } catch {
      return { province: "", city: "" };
    }
  })();
  const [province, setProvince] = useState(savedLoc.province ?? "");
  const [city, setCity] = useState(savedLoc.city ?? "");
  const [postal, setPostal] = useState("");
  const [phone, setPhone] = useState("");
  const [fbName, setFbName] = useState("");
  const [fbLink, setFbLink] = useState("");
  const [pin, setPin] = useState<{ lat: number; lng: number; address: string } | null>(null);
  // Paano magbabayad ng 30% downpayment: QR Ph (GCash/GoTyme/bank app)
  // o card (CardForm — tinotokenize sa browser, sinisingil ng app)
  const [payMethod, setPayMethod] = useState<"qr" | "card">("qr");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [placing, setPlacing] = useState(false);
  // Nabayaran na ba ang card sa confirmation screen? (Ang QR ay walang
  // katumbas nito — ang webhook ang bahala doon.)
  const [cardPaid, setCardPaid] = useState(false);
  const [order, setOrder] = useState<Order | null>(null);

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
    // Ipadala sa PAN Furnitures app (Orders list) + kumuha ng Maya
    // downpayment QR. Best-effort — kahit mabigo, may confirmation pa rin.
    try {
      const res = await fetch("/api/send-order", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customer_name: `${firstName} ${lastName}`.trim(),
          email,
          contact_number: phone,
          address: [address, city, province, postal].filter(Boolean).join(", "),
          // Hiwalay ding ipinapadala ang mga bahagi ng address. Hindi
          // kayang laktawan ng Maya ang Shipping & Billing step nito kung
          // ang alam lang niya ay isang pinagsamang string — kailangan
          // niyang hiwalay ang city / province / postal para mapunan.
          city,
          province,
          postal_code: postal,
          fb_name: fbName,
          fb_link: fbLink,
          address_lat: pin?.lat ?? null,
          address_lng: pin?.lng ?? null,
          order_ref: newOrder.number,
          payment_method: payMethod,
          total,
          shipping: shippingKnown
            ? {
                // Kaparehong porma ng ibang line item — pamagat, tapos
                // bullet ang destinasyon at ang mismong address kung may pin.
                label: [
                  "Shipping",
                  `• ${city}, ${province}`,
                  ...(pin?.address ? [`• ${pin.address}`] : []),
                ].join("\n"),
                amount: shippingCost,
              }
            : null,
          // Bawat bed frame at add-on ay sariling line item
          items: rows.flatMap(({ item, product }) => {
            const lines: {
              qty: number;
              description: string;
              unitPrice: number;
              image: string | null;
              product_name?: string;
              sku?: string;
              color?: string;
              dimension?: string;
              category?: string;
            }[] = [
              {
                qty: item.qty,
                // Pangalan sa unang linya, tapos bullet bawat detalye —
                // kulay, sukat, kategorya — para mabasa agad sa order.
                description: [
                  product!.name,
                  ...describeVariant(item, product!).map((d) => `• ${d}`),
                ].join("\n"),
                unitPrice: item.basePrice ?? item.unitPrice ?? product!.price,
                image: absoluteUrl(product!.images[0]),
                // Structured — dito hinahanap ng app ang katugmang produkto sa
                // Product Management; kung wala pa, dito nito ibabatay ang
                // bagong record (preorder).
                product_name: product!.name,
                sku: (product as { sku?: string }).sku || undefined,
                color: variantColor(item),
                dimension: variantDimension(item, product!),
                category: prettyCategory(product!.category),
              },
            ];
            for (const a of item.addOns ?? []) {
              lines.push({
                qty: item.qty,
                description: a.note ? `${a.label} — ${a.note}` : a.label,
                unitPrice: a.price,
                image: null,
              });
            }
            return lines;
          }),
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
      const prev = JSON.parse(localStorage.getItem("pb_orders") ?? "[]");
      localStorage.setItem("pb_orders", JSON.stringify([newOrder, ...prev]));
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

            {order.qrDataUrl ? (
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
            ) : cardPaid ? (
              <p className="text-center text-sm font-semibold text-green-700 py-4">
                ✓ Payment received — thank you!
              </p>
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

              {/* Breakdown ng bawat bahagi */}
              {it.addOns && it.addOns.length > 0 && (
                <div className="mt-2.5 pt-2.5 border-t border-sand/70 space-y-1.5">
                  <div className="flex justify-between text-sm">
                    <span>Bed frame</span>
                    <span>{formatPrice(it.basePrice ?? 0)}</span>
                  </div>
                  {it.addOns.map((a, j) => (
                    <div key={j} className="flex justify-between text-sm gap-3">
                      <span>
                        {a.label}
                        {a.note && (
                          <span className="block text-xs text-cognac mt-0.5">
                            {a.note}
                          </span>
                        )}
                      </span>
                      <span className="whitespace-nowrap">
                        {a.price > 0 ? `+${formatPrice(a.price)}` : "TBC"}
                      </span>
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
            autoOpen={cardPaid}
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
            <Field label="Address" value={address} onChange={setAddress} placeholder="House no., street, barangay" error={errors.address} />

            {/* Province dropdown → nagse-set ng shipping fee kasama ang city */}
            <label className="block mb-3 col-span-2 sm:col-span-1">
              <span className="block text-xs font-bold text-stone mb-1">Province</span>
              <select
                value={province}
                onChange={(e) => {
                  setProvince(e.target.value);
                  setCity(""); // reset city kapag nagpalit ng province
                }}
                className={`w-full border bg-white px-4 py-3 text-sm rounded focus:outline-none focus:border-cognac ${
                  errors.province ? "border-red-600" : "border-stone/40"
                }`}
              >
                <option value="">— Select —</option>
                {SHIP_LOCATIONS.map((p) => (
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
                onChange={(e) => setCity(e.target.value)}
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

            <Field label="Postal code" value={postal} onChange={setPostal} half inputMode="numeric" error={errors.postal} />
            <Field label="Phone" value={phone} onChange={setPhone} half inputMode="tel" error={errors.phone} />
            {/* Dito karamihan nakikipag-usap ang customer — kailangan ng
                team para may mabalikan sa Messenger. */}
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
          <LocationPicker
            value={pin}
            flyTo={city && province ? `${city}, ${province}, Philippines` : undefined}
            onChange={(loc) => {
              setPin(loc);
              if (!address.trim()) setAddress(loc.address); // auto-fill kung blanko pa
              if (loc.postcode && !postal.trim()) setPostal(loc.postcode); // auto postal
            }}
          />

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
                    <Image src={product!.images[0]} alt={product!.name} fill className="object-cover" sizes="64px" />
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

                {/* Breakdown: bed frame + bawat add-on, hiwa-hiwalay */}
                {item.addOns && item.addOns.length > 0 && (
                  <div className="mt-3 space-y-2 border-t border-sand pt-3">
                    <div className="flex justify-between text-sm">
                      <span className="text-ink">Bed frame</span>
                      <span className="text-ink">
                        {formatPrice(item.basePrice ?? 0)}
                      </span>
                    </div>
                    {item.addOns.map((a, i) => (
                      <div key={i} className="flex justify-between text-sm gap-3">
                        <span className="text-ink">
                          {a.label}
                          {a.note && (
                            <span className="block text-xs text-cognac mt-0.5">
                              {a.note}
                            </span>
                          )}
                        </span>
                        <span className="text-ink whitespace-nowrap">
                          {a.price > 0 ? `+${formatPrice(a.price)}` : "TBC"}
                        </span>
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
