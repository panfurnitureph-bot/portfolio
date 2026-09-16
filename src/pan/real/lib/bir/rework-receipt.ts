import "server-only";

// Rework / repair service receipt — MISMONG BIR Service Invoice format ng
// original na resibo (company header, VAT breakdown, payment details, BIR
// footer), pero para sa RMA service charge (parts + delivery + order balance).
// Hiwalay sa OrderRow para hindi entangled sa order receipt templates.

type ReworkReceiptInput = {
  customerName: string | null;
  rmaNo: string;
  // Saang order nakakabit ang pagkumpuni (2026-09-01, "di organize") — kulang
  // ito sa resibo: RMA lang ang mababasa at walang tumbok sa order.
  orderNo?: string | null;
  mode: "onsite" | "pullout";
  // ANO ang kinumpuni — pangalan sa unang linya, isang spec kada sunod (kaparehong
  // hugis ng returns.item_desc). Hindi masasabi ng resibo kung saan napunta ang
  // ₱3,400.70 kung ang pinangalanan lang ay ang hatid.
  itemDesc?: string | null;
  itemSku?: string | null;
  parts: { part: string; qty: number; amount: number }[];
  deliveryPrice: number;
  chargeTotal: number;
  amountDue: number;   // 50% due (payment-request variant)
  collected: number;   // total collected so far (receipt variant)
  method?: string | null;
  // Sino ang kumolekta — pangalan sa signature block, gaya ng Sales
  // Representative sa order AR.
  collectedBy?: string | null;
};

const COLS = 48;
const NL = String.fromCharCode(10);
type Ln = { t: string; center?: boolean; bold?: boolean };

const peso2 = (n: number) => (Number(n) || 0).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const peso = (n: number) => "₱" + peso2(n);

function twoCol(left: string, right: string, cols = COLS): string {
  const space = cols - left.length - right.length;
  if (space < 1) return left + "\n" + right.padStart(cols) + "\n";
  return left + " ".repeat(space) + right + "\n";
}
function wrap(text: string, cols = COLS): string {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let cur = "";
  for (const wd of words) {
    if (!cur.length) cur = wd;
    else if (cur.length + 1 + wd.length <= cols) cur += " " + wd;
    else { lines.push(cur); cur = wd; }
  }
  if (cur) lines.push(cur);
  return lines.join("\n") + "\n";
}
function itemLines(qty: number, name: string, amount: number): string[] {
  const price = "₱" + peso2(amount);
  const lines = wrap(`${qty}x ${name}`).trimEnd().split("\n");
  const last = lines.length - 1;
  if (lines[last].length + 1 + price.length <= COLS) lines[last] = lines[last] + " ".repeat(COLS - lines[last].length - price.length) + price;
  else lines.push(price.padStart(COLS));
  return lines;
}

function model(e: ReworkReceiptInput, kind: "qr" | "receipt"): Ln[] {
  const dashes = "-".repeat(COLS), eq = "=".repeat(COLS);
  const out: Ln[] = [];
  const push = (t: string, o: Partial<Ln> = {}) => out.push({ t, ...o });
  const cols = (s: string, o: Partial<Ln> = {}) => s.trimEnd().split("\n").forEach((t) => out.push({ t, ...o }));

  // BIR-style service items: order balance + parts + delivery = ang rework charge.
  //
  // ANG BALANSE AY IKINUKUWENTA DITO (2026-08-25), hindi pinagkakatiwalaan sa
  // tumatawag. Dalawang tumatawag ang nagpapasa ng 0, at ang pangatlo ay
  // kinukuha ang balanse ng order sa PANAHON NG RESIBO — kaya kapag bayad na ang
  // order, nawawala ang hanay at ang mga item ay hindi na sumasapat sa total:
  // "1x Delivery (redeliver) ₱2,000.00" sa ilalim ng "TOTAL ₱3,400.70".
  // Ang singil ay hindi nagbabago pagka-deklara, kaya ang pagbabawas dito ang
  // tanging paraang laging tumutugma.
  const partsSum = Math.round(e.parts.reduce((n, p) => n + (Number(p.amount) || 0), 0) * 100) / 100;
  const obal = Math.max(Math.round((e.chargeTotal - partsSum - e.deliveryPrice) * 100) / 100, 0);
  // DALAWANG GRUPO, hindi isang listahan (hiling 2026-08-25). Ang lumang utang
  // sa kasangkapan at ang bagong bayad sa pagkumpuni ay magkaibang bagay; sa
  // isang hanay ay parang lahat ay bayarin sa rework.
  const newCharges: { qty: number; name: string; amount: number }[] = [
    ...e.parts.map((p) => ({ qty: Number(p.qty) || 1, name: p.part, amount: Number(p.amount) || 0 })),
    ...(e.deliveryPrice > 0 ? [{ qty: 1, name: e.mode === "pullout" ? "Delivery (pull-out & return)" : "Delivery (redeliver)", amount: e.deliveryPrice }] : []),
  ];
  const newTotal = Math.round((partsSum + e.deliveryPrice) * 100) / 100;
  const total = e.chargeTotal;
  const vat = total * (12 / 112);
  const netOfVat = total - vat;
  const balance = Math.max(Math.round((total - e.collected) * 100) / 100, 0);
  const today = new Date().toLocaleDateString("en-US", { timeZone: "Asia/Manila", year: "numeric", month: "short", day: "numeric" });

  // PAREHONG HULMA NG ORDER ACKNOWLEDGEMENT RECEIPT (2026-09-01, "dapat ganto
  // format sya"): PAN FURNITURE na simpleng AR — hindi na ang BIR service
  // invoice na may company block, VAT breakdown at disclaimers. Ang laman ay
  // pareho pa rin: ang kinumpuni, ang mga singil, ang bayad at balanse.
  push("PAN FURNITURE", { center: true, bold: true });
  push("ACKNOWLEDGEMENT RECEIPT", { center: true, bold: true });
  push(eq);
  cols(twoCol("Date", today));
  cols(twoCol("RMA #", e.rmaNo));
  if (e.orderNo) cols(twoCol("Order #", e.orderNo));
  cols(twoCol("Service", e.mode === "pullout" ? "Rework (Pull-out)" : "Rework (On-site)"));
  if (kind === "receipt") cols(twoCol("Payment", e.method ?? "-"));
  cols(twoCol("Customer", e.customerName ?? "-"));
  push(dashes);
  // ANO ang kinumpuni — pangalan, SKU, at buong specification, kapareho ng
  // items ng order AR.
  if (e.itemDesc && e.itemDesc.trim()) {
    const lns = e.itemDesc.split("\n").map((l) => l.trim().replace(/^[•·-]+\s*/, "")).filter(Boolean);
    push("ITEM REPAIRED", { bold: true });
    push("");
    wrap(lns[0]).trimEnd().split("\n").forEach((t) => out.push({ t, bold: true }));
    if (e.itemSku) push("SKU: " + e.itemSku);
    if (lns.length > 1) {
      push("");
      push("SPECIFICATION / DESIGN DETAILS");
      for (const l of lns.slice(1)) wrap("* " + l).trimEnd().split("\n").forEach((t) => push(t));
    }
    push(dashes);
  }
  push("REPAIR CHARGES", { bold: true });
  push("");
  // Tuloy-tuloy ang listahan — walang blangkong linya kada singil.
  for (const it of newCharges) {
    itemLines(it.qty, it.name, it.amount).forEach((t) => out.push({ t, bold: true }));
  }
  if (newCharges.length > 1 && obal > 0) cols(twoCol("  Rework charges", peso(newTotal)));
  // Lumang utang sa kasangkapan — hindi bayad sa pagkumpuni, kaya bukod.
  if (obal > 0) {
    push("");
    push("BROUGHT FORWARD", { bold: true });
    itemLines(1, "Unpaid balance on the order", obal).forEach((t) => out.push({ t, bold: true }));
  }
  push(dashes);
  cols(twoCol("TOTAL", peso(total)), { bold: true });
  if (kind === "receipt") {
    cols(twoCol("Amount Paid", peso(e.collected)), { bold: true });
    cols(twoCol("BALANCE DUE", peso(balance)), { bold: true });
  } else {
    cols(twoCol("50% Downpayment Due Now", peso(e.amountDue)), { bold: true });
  }
  push(eq);
  if (kind === "qr") {
    wrap("Scan the Maya QR in the email to pay — the amount is locked.").trimEnd().split("\n").forEach((t) => push(t, { center: true }));
  } else {
    push(`Balance as of ${today}: ${peso(balance)}`, { center: true });
  }
  push("");
  // KAPAREHONG ILALIM NG ORDER AR (2026-09-01, "ganto dapat ung ilalim"):
  // ang polisiya, tapos ang may-pangalang signature block.
  wrap("Down payments are non-refundable. Refunds or exchanges for defective items within 3 days of delivery.")
    .trimEnd().split(NL).forEach((t) => push(t, { center: true }));
  push("");
  push("");
  push("______________________", { center: true });
  push(e.collectedBy || "-", { center: true, bold: true });
  push("Sales Representative", { center: true });
  push("");
  push("Thank you for your business!", { center: true });
  return out;
}

const escXml = (s: string) => String(s ?? "").replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c] as string));

// Monospace SVG ng parehong invoice — para sa Receipt/Transaction Images
// thumbnail (browsers render SVG sa <img>; ang PDF ay para sa email attachment).
export function renderReworkReceiptSvg(e: ReworkReceiptInput, kind: "qr" | "receipt"): string {
  const lines = model(e, kind);
  const CH = 8.4, FS = 14, LH = 19, PAD = 22;
  const W = Math.ceil(COLS * CH + PAD * 2);
  const H = Math.ceil(lines.length * LH + PAD * 2);
  let y = PAD + FS;
  const body = lines.map((ln) => {
    const weight = ln.bold ? ' font-weight="700"' : "";
    const t = ln.center
      ? `<text x="${W / 2}" y="${y}" text-anchor="middle"${weight}>${escXml(ln.t || " ")}</text>`
      : `<text x="${PAD}" y="${y}" xml:space="preserve"${weight}>${escXml(ln.t || " ")}</text>`;
    y += LH;
    return t;
  }).join("\n");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
<rect width="${W}" height="${H}" fill="#ffffff"/>
<g font-family="'Courier New', Courier, monospace" font-size="${FS}" fill="#000000">
${body}
</g>
</svg>`;
}

// ₱ is absent from the core PDF fonts → rendered as "P" to keep column alignment.
export async function renderReworkReceiptPdfBase64(e: ReworkReceiptInput, kind: "qr" | "receipt"): Promise<string> {
  const lines = model(e, kind);
  const { jsPDF } = await import("jspdf");
  const FS = 8, LH = 11, PADX = 10, PADY = 18, CHARW = FS * 0.6;
  const W = Math.ceil(COLS * CHARW + PADX * 2);
  const H = Math.ceil(lines.length * LH + PADY * 2);
  const doc = new jsPDF({ unit: "pt", format: [W, H] });
  let y = PADY;
  for (const ln of lines) {
    doc.setFontSize(FS);
    doc.setFont("courier", ln.bold ? "bold" : "normal");
    const t = (ln.t || " ").replace(/₱/g, "P");
    if (ln.center) doc.text(t, W / 2, y, { align: "center" });
    else doc.text(t, PADX, y, { align: "left" });
    y += LH;
  }
  return Buffer.from(doc.output("arraybuffer")).toString("base64");
}
