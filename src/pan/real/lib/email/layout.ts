// ─────────────────────────────────────────────────────────────────────────────
// IISANG HULMA NG LAHAT NG EMAIL (2026-08-26, hiling ni Joe).
//
// Ang bawat email ay may sariling kinopyang HTML dati — sampung magkakaibang
// itsura. Ang padron ay ang transactional na resibo ng Shopee, sa identidad ng
// PAN: kayumangging header na may seal, mga seksiyong may naka-label na guhit
// (ORDER DETAILS / DELIVERY DETAILS / PAYMENT DETAILS / WHAT'S NEXT), item
// cards na may larawan at specs, at malinaw na totals.
//
// Ang bawat email ay BINUBUO mula sa mga bloke dito — walang bagong email na
// magsusulat ng sariling table soup. Email-safe lahat: table layout, inline
// styles, walang flex/grid, walang external CSS.
// ─────────────────────────────────────────────────────────────────────────────

export const esc = (s: string | null | undefined) =>
  String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export const peso = (n: number) =>
  `&#8369;${(Number(n) || 0).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export function longDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(String(iso).length <= 10 ? `${iso}T00:00:00` : String(iso));
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-PH", { month: "long", day: "numeric", year: "numeric" });
}

// ANG LOGO NG EMAIL — naka-host sa Supabase storage (public bucket), kaya
// nakikita ng email clients. Pambalik ang text seal kapag walang env.
const LOGO_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
  ? `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/product-images/email-assets/logo-transparent.png`
  : "";

// PREHEADER (2026-08-26): ang kulay-abong preview sa inbox list pagkatapos ng
// subject. Nakatago sa mismong email; ilagay sa PINAKAUNA ng html.
export function preheader(text: string): string {
  return `<div style="display:none;max-height:0;overflow:hidden;opacity:0;mso-hide:all">${esc(text)}&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;</div>`;
}

// ── Ang balangkas: cream na ground, 620px na card, logo header + enterprise
// footer (rehistradong pangalan + TIN + contact + why-received). ───────────
export function emailShell(bodyHtml: string): string {
  const header = LOGO_URL
    ? `<img src="${LOGO_URL}" alt="Pan Furniture" width="150" style="width:150px;max-width:60%;height:auto;display:block;margin:0 auto">`
    : `<table role="presentation" cellpadding="0" cellspacing="0" align="center"><tr>
            <td align="center" width="58" style="width:58px;height:58px;border:2px solid #caa45a;border-radius:50%;font-family:Georgia,'Times New Roman',serif;font-size:15px;letter-spacing:2px;color:#caa45a;font-weight:bold">PAN</td>
          </tr></table>
          <p style="margin:12px 0 0;font-family:Georgia,'Times New Roman',serif;font-size:22px;letter-spacing:6px;color:#f4ead8;font-weight:bold">PAN&nbsp;FURNITURE</p>`;
  return `
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f2efe8;padding:20px 12px 28px">
    <tr><td align="center">
      <table role="presentation" width="620" cellpadding="0" cellspacing="0" style="max-width:620px;width:100%">
        <tr><td align="center" style="background:#4a3b1a;padding:24px 36px 18px;border-bottom:3px solid #caa45a">
          ${header}
        </td></tr>
        ${bodyHtml}
        <tr><td style="background:#4a3b1a;border-top:3px solid #caa45a;padding:20px 36px">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
            <td style="vertical-align:top">
              <p style="margin:0;font-family:Georgia,serif;font-size:12px;letter-spacing:3px;color:#caa45a;font-weight:bold">PAN FURNITURE</p>
              <p style="margin:8px 0 0;font-family:Arial,Helvetica,sans-serif;font-size:10.5px;line-height:1.8;color:#b7a88a">
                Purificacion and Noriega Furniture Shop Co.<br>
                VAT Reg. TIN: 631-230-396-00000<br>
                Blk 39 Lot 1 Neon St., Epifanio Malia, GMA, Cavite
              </p>
            </td>
            <td align="right" style="vertical-align:top">
              <p style="margin:0;font-family:Arial,Helvetica,sans-serif;font-size:10.5px;line-height:1.8;color:#b7a88a">
                0962 120 7730<br>
                panfurnitureph@gmail.com<br>
                facebook.com/PanFurniturePH<br>
                Mon&ndash;Sat &middot; 8:00 AM &ndash; 5:00 PM
              </p>
            </td>
          </tr></table>
          <p style="margin:14px 0 0;padding-top:12px;border-top:1px solid rgba(202,164,90,.3);font-family:Arial,Helvetica,sans-serif;font-size:9.5px;line-height:1.7;color:#8a7c5e">
            You received this email because you have an order with Pan Furniture. For any concern, just reply to this email &mdash; a real person reads it.
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>`;
}

// Isang puting panel sa loob ng card. Pagkakabitin ang mga panel nang
// magkakasunod — ang bawat isa ay may border maliban sa itaas.
export function panel(innerHtml: string, opts?: { tint?: boolean; pad?: string }): string {
  const bg = opts?.tint ? "#faf6ec" : "#ffffff";
  const pad = opts?.pad ?? "20px 36px 8px";
  return `<tr><td style="background:${bg};border:1px solid #e6dcc4;border-top:0;padding:${pad}">${innerHtml}</td></tr>`;
}

// "ORDER DETAILS" na naka-label na guhit.
export function sectionTitle(label: string): string {
  return `<p style="margin:0 0 4px;font-family:Arial,Helvetica,sans-serif;font-size:10.5px;letter-spacing:2px;text-transform:uppercase;color:#8a8272;font-weight:bold;border-bottom:2px solid #efe9db;padding-bottom:8px">${esc(label)}</p>`;
}

// Pambungad: "Hello <name>," + pangungusap.
export function intro(name: string | null | undefined, sentenceHtml: string): string {
  return `
    <p style="margin:0 0 10px;font-family:Arial,Helvetica,sans-serif;font-size:13px;line-height:1.7;color:#57534b">Hello <b style="color:#2b2620">${esc(name || "there")}</b>,</p>
    <p style="margin:0 0 18px;font-family:Arial,Helvetica,sans-serif;font-size:13px;line-height:1.7;color:#57534b">${sentenceHtml}</p>`;
}

export type KvRow = [label: string, valueHtml: string, opts?: { bold?: boolean; tone?: "gold" | "green" | "muted" }];
export function kvTable(rows: KvRow[]): string {
  const color = (t?: string) => t === "gold" ? "#8a6a1f" : t === "green" ? "#1a7f43" : t === "muted" ? "#8a8272" : "#2b2620";
  return `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-family:Arial,Helvetica,sans-serif;font-size:12.5px">
      ${rows.map(([l, v, o]) => `
      <tr>
        <td style="padding:6px 0;color:#8a8272;white-space:nowrap;vertical-align:top">${esc(l)}:</td>
        <td align="right" style="padding:6px 0 6px 24px;color:${color(o?.tone)};line-height:1.6;${o?.bold ? "font-weight:bold;" : ""}vertical-align:top">${v}</td>
      </tr>`).join("")}
    </table>`;
}

export const mono = (s: string | null | undefined) =>
  `<span style="font-family:'Courier New',monospace;font-weight:bold;color:#8a6a1f">${esc(s)}</span>`;

// Chip/tag sa tabi ng item: DELIVERED / THIS DELIVERY / NEXT DELIVERY / atbp.
export type ItemTag = { text: string; bg: string; color: string };
export const TAG_DELIVERED: ItemTag = { text: "DELIVERED", bg: "#e7f6ec", color: "#1a7f43" };
export const TAG_THIS: ItemTag = { text: "THIS DELIVERY", bg: "#faf1dc", color: "#8a6a1f" };
export const TAG_NEXT: ItemTag = { text: "NEXT DELIVERY", bg: "#f1efe9", color: "#8a8272" };

export type EmailItem = {
  name: string;
  // "pangalan @ kulay" (lib/orders/line-key) — susi ng linyang pinagmulan ng
  // card, para ang mga batch tag ay kada kulay, hindi kada pangalan.
  lineKey?: string;
  // BUONG build specs. Array = isang linya kada spec (hiling ni Joe 2026-08-26
  // — kita ang kumpletong pagkakagawa sa email mismo); string = isang linya.
  specs?: string | string[] | null;
  qty?: number;
  priceTotal?: number | null; // line total; nakatago kapag null
  photoUrl?: string | null;
  tag?: ItemTag | null;
  dimmed?: boolean;           // susunod na batch — kupas
};

// Isang item card na may larawan — hilera ng Shopee.
function itemRow(it: EmailItem, index: number, withBorder: boolean): string {
  const ink = it.dimmed ? "#8a8272" : "#2b2620";
  const sub = it.dimmed ? "#a89e8c" : "#8a8272";
  const border = withBorder ? "border-top:1px solid #f5f1e6;" : "";
  const photo = it.photoUrl
    ? `<img src="${esc(it.photoUrl)}" alt="" width="72" height="72" style="width:72px;height:72px;border:1px solid #e6dcc4;border-radius:8px;object-fit:cover;display:block;${it.dimmed ? "opacity:.55;" : ""}">`
    : `<div style="width:72px;height:72px;border:1px ${it.dimmed ? "dashed" : "solid"} #e6dcc4;border-radius:8px;background:#faf6ec"></div>`;
  const tag = it.tag
    ? `<span style="display:inline-block;margin-top:4px;padding:2px 9px;border-radius:99px;background:${it.tag.bg};color:${it.tag.color};font-family:Arial,Helvetica,sans-serif;font-size:10px;font-weight:bold;letter-spacing:.5px">${esc(it.tag.text)}</span>`
    : "";
  return `
      <tr>
        <td width="76" style="padding:14px 14px 14px 0;vertical-align:top;${border}">${photo}</td>
        <td style="padding:14px 0;vertical-align:top;${border}">
          <p style="margin:0 0 3px;font-family:Arial,Helvetica,sans-serif;font-size:13px;font-weight:bold;color:${ink}">${index}. ${esc(it.name)}</p>
          ${(() => {
            const specHtml = Array.isArray(it.specs)
              ? it.specs.map((l) => esc(l)).join("<br>")
              : it.specs ? esc(it.specs) : "";
            if (!specHtml && it.qty == null) return "";
            return `<p style="margin:0;font-family:Arial,Helvetica,sans-serif;font-size:11.5px;color:${sub};line-height:1.7">${specHtml}${it.qty != null ? `${specHtml ? "<br>" : ""}Quantity: ${it.qty}` : ""}</p>`;
          })()}
          ${tag}
        </td>
        <td align="right" style="padding:14px 0;vertical-align:top;${border}font-family:Arial,Helvetica,sans-serif;font-size:13px;${it.dimmed ? "" : "font-weight:bold;"}color:${it.dimmed ? "#a89e8c" : "#2b2620"};white-space:nowrap">${it.priceTotal != null ? peso(it.priceTotal) : ""}</td>
      </tr>`;
}

export function itemList(items: EmailItem[]): string {
  return `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-top:1px solid #efe9db">
      ${items.map((it, i) => itemRow(it, i + 1, i > 0)).join("")}
    </table>`;
}

// Totals — Subtotal / fee / bawas / MALAKING due.
export type TotalRow = { label: string; amount: number; tone?: "green" | "muted"; big?: boolean; note?: string };
export function totalsTable(rows: TotalRow[]): string {
  return `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-family:Arial,Helvetica,sans-serif;font-size:12.5px;border-top:2px solid #efe9db">
      ${rows.map((r) => {
        if (r.big) return `
      <tr>
        <td style="padding:10px 0;border-top:1px solid #efe9db;font-weight:bold;color:#4a3b1a;font-size:13.5px">${esc(r.label)}:</td>
        <td align="right" style="padding:10px 0;border-top:1px solid #efe9db;font-family:Arial,Helvetica,sans-serif;font-weight:bold;color:#4a3b1a;font-size:17px;letter-spacing:-.3px;white-space:nowrap">${peso(r.amount)}</td>
      </tr>`;
        const c = r.tone === "green" ? "#1a7f43" : r.tone === "muted" ? "#8a8272" : "#2b2620";
        const sign = r.tone === "green" ? "&#8722;" : "";
        return `
      <tr>
        <td style="padding:5px 0;color:#8a8272">${esc(r.label)}${r.note ? ` <span style="font-size:10.5px">(${esc(r.note)})</span>` : ""}:</td>
        <td align="right" style="padding:5px 0;color:${c};white-space:nowrap">${sign}${peso(r.amount)}</td>
      </tr>`;
      }).join("")}
    </table>`;
}

// Gintong petsa-banner (Scheduled Delivery / Arriving Today / atbp).
export function dateBanner(label: string, dateISO: string): string {
  const d = new Date(`${dateISO}T00:00:00`);
  const weekday = isNaN(d.getTime()) ? "" : d.toLocaleDateString("en-PH", { weekday: "long" });
  return `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#faf6ec;border:1px solid #caa45a;border-radius:10px">
      <tr><td align="center" style="padding:16px 24px">
        <p style="margin:0;font-family:Arial,Helvetica,sans-serif;font-size:10px;letter-spacing:2px;text-transform:uppercase;color:#8a8272">${esc(label)}</p>
        <p style="margin:6px 0 0;font-family:Arial,Helvetica,sans-serif;font-size:24px;font-weight:bold;letter-spacing:-.3px;color:#4a3b1a">${longDate(dateISO)}</p>
        ${weekday ? `<p style="margin:4px 0 0;font-family:Arial,Helvetica,sans-serif;font-size:12px;color:#8a8272">${weekday}</p>` : ""}
      </td></tr>
    </table>`;
}

// Gintong CTA button.
export function ctaButton(text: string, url: string, subtext?: string): string {
  return `
    <div style="text-align:center;padding:8px 0 6px">
      <a href="${esc(url)}" style="display:inline-block;background:#caa45a;color:#2b2620;font-family:Arial,Helvetica,sans-serif;font-size:14px;font-weight:bold;letter-spacing:1px;text-transform:uppercase;text-decoration:none;padding:14px 46px;border-radius:8px">${esc(text)}</a>
      ${subtext ? `<p style="margin:12px 0 0;font-family:Arial,Helvetica,sans-serif;font-size:11px;color:#8a8272">${subtext}</p>` : ""}
    </div>`;
}

// Cream na "WHAT'S NEXT" na panel (huling laman bago ang footer).
export function whatsNext(html: string): string {
  return panel(`
    <p style="margin:0 0 6px;font-family:Arial,Helvetica,sans-serif;font-size:10.5px;letter-spacing:2px;text-transform:uppercase;color:#8a8272;font-weight:bold">What's Next</p>
    <p style="margin:0;font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:1.8;color:#57534b">${html}</p>`,
    { tint: true, pad: "18px 36px" });
}

// Malaking halaga sa gitna (AMOUNT PAID / DOWNPAYMENT DUE) na may opsyonal na
// status chip sa itaas — ang "hero" ng payment emails.
export function bigStat(label: string, amount: number, opts?: { chip?: { text: string; bg: string; color: string }; tone?: "green" | "brown"; sub?: string }): string {
  const c = opts?.tone === "green" ? "#1a7f43" : "#4a3b1a";
  return `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#faf6ec;border:1px solid #caa45a;border-radius:10px">
      <tr><td align="center" style="padding:18px 24px">
        ${opts?.chip ? `<span style="display:inline-block;margin-bottom:10px;padding:3px 14px;border-radius:20px;background:${opts.chip.bg};color:${opts.chip.color};font-family:Arial,Helvetica,sans-serif;font-size:11px;font-weight:bold;letter-spacing:.5px">${opts.chip.text}</span><br>` : ""}
        <span style="font-family:Arial,Helvetica,sans-serif;font-size:10px;letter-spacing:2px;text-transform:uppercase;color:#8a8272">${esc(label)}</span>
        <p style="margin:6px 0 0;font-family:Arial,Helvetica,sans-serif;font-size:30px;font-weight:bold;letter-spacing:-.5px;color:${c}">${peso(amount)}</p>
        ${opts?.sub ? `<p style="margin:4px 0 0;font-family:Arial,Helvetica,sans-serif;font-size:12px;color:#8a8272">${opts.sub}</p>` : ""}
      </td></tr>
    </table>`;
}

// "Attached as PDF" na kahon.
export function attachmentNote(text: string): string {
  return `<div style="margin:4px 0;padding:12px;border:1px solid #d4e8dc;background:#f1f8f4;border-radius:10px;text-align:center;font-family:Arial,Helvetica,sans-serif;font-size:12.5px;color:#1a7f43;font-weight:bold">${esc(text)} — attached as PDF</div>`;
}

// QR na kahon para sa For Payment.
export function qrBox(qrUrl: string, caption: string): string {
  return `
    <div style="margin:6px 0;padding:18px 14px;border:1px dashed #caa45a;background:#fffaf0;border-radius:10px;text-align:center">
      <p style="margin:0 0 12px;font-family:Arial,Helvetica,sans-serif;font-size:13px;font-weight:bold;color:#4a3b1a">Scan this QR to pay</p>
      ${qrUrl ? `<img src="${esc(qrUrl)}" alt="Payment QR" width="220" height="220" style="display:block;margin:0 auto;width:220px;height:220px;border-radius:8px;background:#fff;border:1px solid #ece7dc">` : ""}
      <p style="margin:12px 0 0;font-family:Arial,Helvetica,sans-serif;font-size:12px;color:#8a8272;line-height:1.6">${caption}</p>
    </div>`;
}

// 6-hakbang na progress rail ng biyahe (Confirmed → Delivered). Ang mga dots ay
// konektado ng ginintuang linya; ang labels ay hiwalay na hilera para hindi
// masira ang espasyo ng linya.
export type RailStep = { label: string; state: "done" | "current" | "todo"; date?: string };
export function progressRail(steps: RailStep[]): string {
  const dot = (st: RailStep) => {
    const inner = st.state === "todo"
      ? `<div style="width:26px;height:26px;border-radius:50%;background:#ffffff;border:3px solid #d8c08a;margin:0 auto"><div style="width:8px;height:8px;border-radius:50%;background:#d8c08a;margin:6px auto"></div></div>`
      : `<div style="width:26px;height:26px;line-height:26px;border-radius:50%;background:${st.state === "current" ? "#caa45a" : "#1a7f43"};color:#ffffff;font-size:13px;font-weight:700;text-align:center;margin:0 auto">${st.state === "current" ? "&#9679;" : "&#10003;"}</div>`;
    return `<td width="30" align="center" valign="middle" style="padding:0">${inner}</td>`;
  };
  const line = `<td valign="middle" style="padding:0;font-size:0;line-height:0"><div style="height:4px;border-radius:2px;background:#caa45a;font-size:0;line-height:0">&nbsp;</div></td>`;
  const label = (st: RailStep) => {
    const c = st.state === "current" ? "#3a2e20" : st.state === "todo" ? "#c4b9a6" : "#8a6a1f";
    const w = st.state === "current" ? "800" : "600";
    return `<td width="${Math.round(100 / steps.length)}%" align="center" valign="top" style="padding:7px 2px 0;font-family:Arial,sans-serif"><div style="font-size:9px;font-weight:${w};color:${c};line-height:1.2">${esc(st.label)}</div>${st.date ? `<div style="font-size:8.5px;font-weight:600;color:#c2a05a;margin-top:2px">${esc(st.date)}</div>` : ""}</td>`;
  };
  let rail = "", labels = "";
  steps.forEach((st, i) => { rail += dot(st); labels += label(st); if (i < steps.length - 1) rail += line; });
  return `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>${rail}</tr></table>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>${labels}</tr></table>`;
}

// ─── GMAIL SUMMARY CARD (schema.org JSON-LD) ─────────────────────────────────
// Ang kulay-abong card sa itaas ng Gmail ("Delivered Sat, Jul 11 · View order")
// ay hindi bahagi ng HTML — binabasa ng Gmail ang structured data na ito at
// siya ang gumuguhit. Kailangan: aligned na SPF/DKIM ng nagpapadala at tamang
// schema; ang Gmail ang nagpapasya kung ipapakita. Itanim sa UNAHAN ng html.
type SchemaProduct = { name: string; image?: string | null; sku?: string | null };

export function gmailOrderSchema(o: {
  orderNumber: string;
  status: "OrderProcessing" | "OrderInTransit" | "OrderDelivered";
  customerName?: string | null;
  items?: SchemaProduct[];
  viewUrl?: string | null;
  priceTotal?: number | null;
}): string {
  const data = {
    "@context": "http://schema.org",
    "@type": "Order",
    merchant: { "@type": "Organization", name: "Pan Furniture" },
    orderNumber: o.orderNumber,
    orderStatus: `http://schema.org/${o.status}`,
    ...(o.priceTotal != null ? { price: o.priceTotal.toFixed(2), priceCurrency: "PHP" } : {}),
    ...(o.customerName ? { customer: { "@type": "Person", name: o.customerName } } : {}),
    acceptedOffer: (o.items ?? []).slice(0, 5).map((it) => ({
      "@type": "Offer",
      itemOffered: { "@type": "Product", name: it.name, ...(it.image ? { image: it.image } : {}), ...(it.sku ? { sku: it.sku } : {}) },
    })),
    ...(o.viewUrl ? { potentialAction: { "@type": "ViewAction", target: o.viewUrl, name: "View Order" } } : {}),
  };
  return `<script type="application/ld+json">${JSON.stringify(data)}</script>`;
}

export function gmailParcelSchema(o: {
  orderNumber: string;
  status: "OrderInTransit" | "OrderDelivered";
  expectedArrivalISO?: string | null; // YYYY-MM-DD
  trackUrl?: string | null;
  items?: SchemaProduct[];
  address?: string | null;
  customerName?: string | null;
}): string {
  const data = {
    "@context": "http://schema.org",
    "@type": "ParcelDelivery",
    carrier: { "@type": "Organization", name: "Pan Furniture Delivery" },
    ...(o.expectedArrivalISO ? { expectedArrivalUntil: o.expectedArrivalISO } : {}),
    ...(o.trackUrl ? { trackingUrl: o.trackUrl, potentialAction: { "@type": "TrackAction", target: o.trackUrl } } : {}),
    ...(o.items?.length ? { itemShipped: o.items.slice(0, 5).map((it) => ({ "@type": "Product", name: it.name, ...(it.image ? { image: it.image } : {}) })) } : {}),
    ...(o.address ? { deliveryAddress: { "@type": "PostalAddress", streetAddress: o.address, addressCountry: "PH" } } : {}),
    partOfOrder: {
      "@type": "Order",
      orderNumber: o.orderNumber,
      merchant: { "@type": "Organization", name: "Pan Furniture" },
      orderStatus: `http://schema.org/${o.status}`,
      ...(o.customerName ? { customer: { "@type": "Person", name: o.customerName } } : {}),
    },
  };
  return `<script type="application/ld+json">${JSON.stringify(data)}</script>`;
}
