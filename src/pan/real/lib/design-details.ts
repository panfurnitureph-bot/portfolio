// DESIGN DETAILS — ang spec sheet na ipinapadala sa customer bago gawin ang
// muwebles (hal. kama): sukat, tela, disenyo, at LARAWANG may mga label na
// nakaturo sa mga parte ("Headboard Height: 4ft from floor", "16" from floor").
//
// Parehong makina ng Formal Quotation (lib/quotation.ts): SVG ang output,
// iniupload sa public bucket, ipinapadala sa Messenger bilang larawan. Ang mga
// larawan sa loob ay DATA URI — hinahatak ni Meta ang SVG sa server nila at
// hindi maaasahan doon ang panlabas na <image href>.
//
// ANG SUSING DISENYO: iba-iba ang headboard at ang mga komento bawat order, kaya
// ang mga label ay HINDI fixed — inilalagay ng staff sa builder sa pag-click sa
// mismong parte ng litrato. Ang bawat label ay {x, y, text} na FRACTION (0..1)
// ng litrato, kaya tama ang puwesto anuman ang sukat ng render.

export type DesignLabel = {
  x: number; // 0..1, kaliwa→kanan sa litrato (GITNA ng label)
  y: number; // 0..1, taas→baba sa litrato
  text: string;
  // NUMERO ng spec na tinutukoy (2026-08-10, mula sa enterprise template):
  // ang parehong pulang numero ay nasa specs list at sa label sa litrato,
  // kaya malinaw kung aling detalye ang itinuturo. Opsyonal.
  num?: number;
  // SUKAT-ARROW (kahilingan 2026-08-09): dilaw na dalawang-ulong palaso na
  // dumadaan sa likod ng label — "v" patayo (hal. 16" from floor), "h" pahiga.
  arrow?: "v" | "h" | null;
  // Haba ng palaso bilang fraction ng taas (v) o lapad (h) ng litrato.
  len?: number;
  // MALAYANG DULO (kahilingan 2026-08-09, "dapat pwede ma-rotate"): kapag may
  // ax/ay/bx/by (fractions), ang palaso ay mula (ax,ay) hanggang (bx,by) —
  // kahit anong hilig. Ito ang iniimbak ng builder ngayon; ang arrow/len ay
  // panlumang datos na lang.
  ax?: number;
  ay?: number;
  bx?: number;
  by?: number;
};

// INSET PHOTO (2026-08-10): maliit na pangalawang litrato na nakapatong sa
// pangunahing litrato — hal. bukas na lift storage bilang halimbawa — na may
// opsyonal na orange na label, gaya ng orihinal na template nila.
export type DesignInset = {
  x: number;  // 0..1 — GITNA ng inset sa litrato
  y: number;
  w: number;  // lapad bilang fraction ng lapad ng litrato
  iw: number; // tunay na sukat ng inset image — para tama ang taas
  ih: number;
  text?: string;      // laman ng orange na label (hal. "Lift Storage")
  url?: string;       // storage URL (builder/imbakan)
  img?: string | null; // data URI — inilalagay ng server bago mag-render
};

export type DesignInput = {
  customerName: string;
  address?: string | null;
  orderNumber?: string | null;
  // DD number sa document header (enterprise template) — kinukuha BAGO ang
  // render; sa preview ay wala pa, kaya may placeholder.
  ddNumber?: string | null;
  dateLabel: string;          // "8/8/2026"
  initials?: string | null;   // "OCRAY" — kadugtong ng petsa sa ibaba
  title: string;              // "PROMO BED: FULL DOUBLE SIZE 54X75"
  bullets: string[];          // "Headboard Height: 4ft from floor", …
  // Pangunahing litrato bilang DATA URI, kasama ang tunay na sukat nito para
  // tumapat ang mga label (walang letterbox: ang iginuguhit na kahon ay eksaktong
  // kasukat ng aspect ratio).
  photo?: string | null;
  photoW?: number;
  photoH?: number;
  labels?: DesignLabel[];
  insets?: DesignInset[];
  // Swatch ng tela (maliit na litrato sa kanang itaas) + pangalan nito.
  swatch?: string | null;
  swatchLabel?: string | null;
  // IMPORTANT NOTE sa ibaba.
  mattress?: string | null;   // "n/a" o "6 inches"
  headboard?: string | null;  // "34 inches"
  note?: string | null;       // ang italic na talata (default: lift storage)
  logo?: string | null;       // PAN logo — malabong watermark sa gitna
  // APPROVED na sheet (hiling 2026-08-16): kapag inaprubahan ng customer sa
  // Messenger (DD_ACCEPT), muling nire-render ang sheet na PUNO na ang tatlong
  // pirmahan — pangalan ng customer, petsa ng approval, at ang gumawa ng DD —
  // at berdeng "APPROVED" na ang chip.
  approval?: { customer: string; date: string; authorized: string } | null;
};

// Default na paalala — ang laging nakasulat sa sheet nila; editable sa builder.
export const DESIGN_NOTE_DEFAULT =
  "Please note that the lift storage is subject for approval. If the door and stairs have a small opening, " +
  "please send us the height and width of both openings so we can check whether the lift storage will fit.";

export const DESIGN_STATUSES = ["Draft", "Sent", "Accepted", "Declined", "Expired"] as const;
export type DesignStatus = (typeof DESIGN_STATUSES)[number];

// FOLLOW-UP — parehong patakaran ng quotation: hanggang TATLO, magkakaiba ang
// mensahe, at hindi nito pinahahaba ang 24h window ni Meta.
export const DESIGN_MAX_FOLLOWUPS = 3;

export function designFollowupMessage(n: number, firstName: string): string {
  const name = firstName.trim() || "there";
  switch (n) {
    case 1:
      return [
        `Hi ${name}, just following up`,
        "on the design details we sent.",
        "",
        "Please review the measurements",
        "and the fabric — once you",
        "approve, we start production.",
      ].join("\n");
    case 2:
      return [
        `Hi ${name}! Checking in again`,
        "on your design details.",
        "",
        "If anything needs changing —",
        "the size, the fabric, or the",
        "headboard design — just tell",
        "us and we will revise it.",
      ].join("\n");
    default:
      return [
        `Hi ${name}, this is our last`,
        "follow-up on this design.",
        "",
        "Production starts only after",
        "your approval, so take your",
        "time. Message us anytime and",
        "we will pick this up again.",
      ].join("\n");
  }
}

// ── Palette: enterprise template (inaprubahan sa artifact, 2026-08-10) ───────
// Mainit-init na puting papel, pulang heading, itim na teksto, gintong accent.
// Ang mga pangalan ng constant ay pinanatili (WHITE = pangunahing teksto,
// GREY = pangalawang teksto) para maliit ang diff.
const BG = "#fdfbf6";
const RED = "#c0392f";
const WHITE = "#241d10";
const GREY = "#6d6250";
const GOLD = "#a97f34";     // corner ticks ng photo plate
const ARROW = "#d99b21";    // sukat-arrow — ginto, hindi na matingkad na dilaw
const HAIR = "#e4dac2";     // manipis na guhit / divider
const EDGE = "#ddd2bc";     // border ng meta strip at photo plate

function escXml(s: string): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

// Parehong dahilan ng quotation (nasukat 2026-08-09): ang mga character na wala
// sa font ng server ni Meta ay lumalabas na kahon (▨) — fullwidth ＃, curly
// quotes, atbp. Ginagawang plain ASCII.
function toRenderSafe(s: string): string {
  return String(s ?? "")
    .replace(/[！-～]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/　/g, " ")
    .replace(/[‘’‛]/g, "'")
    .replace(/[“”‟]/g, '"')
    .replace(/[–—‒]/g, "-")
    .replace(/…/g, "...")
    .replace(/ /g, " ");
}

// Manu-manong word-wrap — walang awtomatikong wrap ang SVG text.
function wrap(text: string, maxChars: number): string[] {
  const out: string[] = [];
  for (const raw of String(text ?? "").split("\n")) {
    let line = "";
    for (const word of raw.split(/\s+/).filter(Boolean)) {
      if (!line.length) line = word;
      else if (line.length + 1 + word.length <= maxChars) line += " " + word;
      else { out.push(line); line = word; }
    }
    out.push(line);
  }
  return out.length ? out : [""];
}

export function renderDesignDetailsSvg(input: DesignInput): string {
  const W = 940;
  const PAD = 44;
  const RIGHT = W - PAD;
  const MID = W / 2;

  const p: string[] = [];
  const text = (
    x: number, y: number, s: string,
    o: { size?: number; bold?: boolean; anchor?: string; italic?: boolean; fill?: string; spacing?: number; serif?: boolean } = {},
  ) =>
    // serif: masthead at pamagat lang — Georgia/Times ang gamit; tiyak na nasa
    // server ni Meta ang Times New Roman, kaya ligtas ang fallback.
    p.push(`<text x="${x}" y="${y}" font-size="${o.size ?? 14}"${o.bold ? ' font-weight="700"' : ""}${o.italic ? ' font-style="italic"' : ""}${o.anchor ? ` text-anchor="${o.anchor}"` : ""}${o.spacing ? ` letter-spacing="${o.spacing}"` : ""}${o.serif ? " font-family=\"Georgia, 'Times New Roman', serif\"" : ""} fill="${o.fill ?? WHITE}">${escXml(toRenderSafe(s))}</text>`);

  let y = PAD;

  // ── BRAND ROW: logo sa kaliwa, document ID block sa kanan ───────────────────
  const ddNum = (input.ddNumber ?? "").trim();
  if (input.logo) {
    p.push(`<image href="${input.logo}" x="${PAD}" y="${y - 6}" width="74" height="74" preserveAspectRatio="xMidYMid meet"/>`);
  }
  text(RIGHT, y + 16, ddNum || "DD-______", { size: 17, bold: true, anchor: "end", spacing: 1 });
  text(RIGHT, y + 34, [((input.orderNumber ?? "").trim() || "No order ref"), "Rev. A"].join(" · "), { size: 11.5, anchor: "end", fill: GREY });

  // ── MASTHEAD: serif, pula, naka-letterspace, may maikling rule sa ilalim ────
  text(MID, y + 34, "DESIGN DETAILS", { size: 30, bold: true, anchor: "middle", fill: RED, spacing: 8, serif: true });
  p.push(`<rect x="${MID - 60}" y="${y + 46}" width="120" height="3" fill="${RED}"/>`);
  y += 78;

  // ── META STRIP: Date | Prepared by | Order | STATUS chip ────────────────────
  const metaTop = y;
  p.push(`<line x1="${PAD}" y1="${metaTop}" x2="${RIGHT}" y2="${metaTop}" stroke="${EDGE}" stroke-width="1"/>`);
  const metaCols: { k: string; v: string }[] = [
    { k: "DATE", v: input.dateLabel },
    { k: "PREPARED BY", v: (input.initials ?? "").trim() || "—" },
    { k: "ORDER", v: (input.orderNumber ?? "").trim() || "—" },
  ];
  const CHIP_W = 132;
  const colW = (RIGHT - PAD - CHIP_W) / metaCols.length;
  metaCols.forEach((c, i) => {
    const cx = PAD + i * colW;
    if (i > 0) p.push(`<line x1="${cx}" y1="${metaTop + 8}" x2="${cx}" y2="${metaTop + 44}" stroke="${EDGE}" stroke-width="1"/>`);
    text(cx + (i ? 14 : 0), metaTop + 22, c.k, { size: 10, fill: GREY, spacing: 1.4 });
    text(cx + (i ? 14 : 0), metaTop + 40, c.v, { size: 13.5, bold: true });
  });
  // Status chip — amber "FOR APPROVAL" habang hinihintay; berdeng "APPROVED"
  // kapag inaprubahan na (muling render mula sa DD_ACCEPT webhook).
  if (input.approval) {
    p.push(`<rect x="${RIGHT - CHIP_W}" y="${metaTop + 13}" width="${CHIP_W}" height="26" rx="13" fill="#e3f4e9" stroke="#59a86e" stroke-width="1"/>`);
    text(RIGHT - CHIP_W / 2, metaTop + 30, "APPROVED", { size: 11, bold: true, anchor: "middle", fill: "#1f6b3a", spacing: 1.2 });
  } else {
    p.push(`<rect x="${RIGHT - CHIP_W}" y="${metaTop + 13}" width="${CHIP_W}" height="26" rx="13" fill="#fff3d6" stroke="#e2c069" stroke-width="1"/>`);
    text(RIGHT - CHIP_W / 2, metaTop + 30, "FOR APPROVAL", { size: 11, bold: true, anchor: "middle", fill: "#8a5d00", spacing: 1.2 });
  }
  p.push(`<line x1="${PAD}" y1="${metaTop + 52}" x2="${RIGHT}" y2="${metaTop + 52}" stroke="${EDGE}" stroke-width="1"/>`);
  y = metaTop + 76;

  // ── CUSTOMER / ADDRESS — maliit na label, salungguhit ang halaga ────────────
  const field = (label: string, value: string) => {
    const lines = wrap(value || "N/A", 70);
    text(PAD, y, label, { size: 10, fill: GREY, spacing: 1.4 });
    lines.forEach((ln, i) => {
      const ly = y + 18 + i * 20;
      text(PAD, ly, ln, { size: 15, bold: true });
      p.push(`<line x1="${PAD}" y1="${ly + 5}" x2="${PAD + Math.max(60, ln.length * 8)}" y2="${ly + 5}" stroke="#cabd9f" stroke-width="1"/>`);
    });
    y += 18 + lines.length * 20 + 6;
  };
  field("CUSTOMER", input.customerName);
  field("ADDRESS", input.address ?? "");
  y += 4;

  // ── PAMAGAT — serif, pula, makapal, may salungguhit ─────────────────────────
  const titleLines = wrap(input.title || "—", 52);
  titleLines.forEach((ln) => {
    text(PAD, y + 16, ln, { size: 21, bold: true, fill: RED, serif: true });
    p.push(`<line x1="${PAD}" y1="${y + 22}" x2="${PAD + Math.max(60, ln.length * 11.2)}" y2="${y + 22}" stroke="${RED}" stroke-width="2"/>`);
    y += 30;
  });
  y += 16;

  // ── NAKA-NUMERONG SPECS (kaliwa) + SWATCH CARD (kanan) ──────────────────────
  // Bawat spec ay may pulang numero — sa builder, malinaw sa staff at customer
  // kung aling detalye ang tinutukoy; hango sa artifact template.
  const SW_W = 226, SW_H = 176;
  const hasSwatch = !!input.swatch;
  const swatchTop = y - 6;
  if (hasSwatch) {
    // Swatch card — may border na parang tunay na swatch book.
    p.push(`<rect x="${RIGHT - SW_W - 10}" y="${swatchTop - 10}" width="${SW_W + 20}" height="${SW_H + 20 + (input.swatchLabel?.trim() ? 16 : 0)}" fill="#fffdf8" stroke="#d8cdb2" stroke-width="1"/>`);
    p.push(`<image href="${input.swatch}" x="${RIGHT - SW_W}" y="${swatchTop}" width="${SW_W}" height="${SW_H}" preserveAspectRatio="xMidYMid meet"/>`);
    if (input.swatchLabel?.trim()) {
      const lbl = input.swatchLabel.trim().toUpperCase();
      const bw = Math.max(64, lbl.length * 9 + 20);
      const bx = RIGHT - SW_W / 2 - bw / 2;
      const by = swatchTop + SW_H - 14;
      p.push(`<rect x="${bx}" y="${by}" width="${bw}" height="26" fill="${BG}" stroke="${WHITE}" stroke-width="1"/>`);
      text(RIGHT - SW_W / 2, by + 18, lbl, { size: 13, bold: true, anchor: "middle" });
    }
  }
  const specs = (input.bullets ?? []).map((s) => String(s ?? "").trim()).filter(Boolean);
  const bulletMax = hasSwatch ? 44 : 60;
  p.push(`<line x1="${PAD}" y1="${y - 4}" x2="${PAD + (hasSwatch ? 590 : RIGHT - PAD)}" y2="${y - 4}" stroke="${WHITE}" stroke-width="2"/>`);
  specs.forEach((b, n) => {
    const lines = wrap(b, bulletMax);
    // Pulang numero chip — iginuhit, hindi glyph.
    p.push(`<rect x="${PAD}" y="${y + 2}" width="19" height="19" rx="3" fill="${RED}"/>`);
    text(PAD + 9.5, y + 16, String(n + 1), { size: 11, bold: true, anchor: "middle", fill: "#fdfbf6" });
    // Kapag may "Label: halaga" — kulay-abo ang label, makapal ang halaga.
    const colon = lines[0].indexOf(":");
    if (lines.length === 1 && colon > 0 && colon < 30) {
      text(PAD + 30, y + 17, lines[0].slice(0, colon + 1), { size: 14.5, fill: GREY });
      text(PAD + 30 + (colon + 1) * 7.3 + 6, y + 17, lines[0].slice(colon + 1).trim(), { size: 14.5, bold: true });
    } else {
      lines.forEach((ln, i) => text(PAD + 30, y + 17 + i * 21, ln, { size: 14.5, bold: true }));
    }
    y += lines.length * 21 + 8;
    p.push(`<line x1="${PAD}" y1="${y - 1}" x2="${PAD + (hasSwatch ? 590 : RIGHT - PAD)}" y2="${y - 1}" stroke="${HAIR}" stroke-width="1"/>`);
  });
  y = Math.max(y, hasSwatch ? swatchTop + SW_H + 24 : y) + 22;

  // ── ANG LITRATO na may mga label ────────────────────────────────────────────
  if (input.photo) {
    // Eksaktong kasukat ng aspect ratio ang kahon — walang letterbox, kaya ang
    // fraction na (x, y) ng label ay tumatapat mismo sa parte ng litrato.
    //
    // HALOS BUONG LAPAD ang litrato — sa orihinal na sheet nila, ang litrato ay
    // umaabot sa gilid-gilid; ang dating 600px ay maliit at maraming tira
    // (kahilingan 2026-08-09: "dapat full image").
    const pw = Math.max(1, Number(input.photoW) || 4);
    const ph = Math.max(1, Number(input.photoH) || 3);
    const scale = Math.min((W - PAD * 2 - 28) / pw, 900 / ph);
    const dw = Math.round(pw * scale), dh = Math.round(ph * scale);
    const px = Math.round((W - dw) / 2), py = y + 14;

    // PHOTO PLATE — may manipis na frame at gintong corner ticks (template).
    const fx = PAD, fw = RIGHT - PAD, fy = y, fh = dh + 28;
    p.push(`<rect x="${fx}" y="${fy}" width="${fw}" height="${fh}" fill="#ffffff" stroke="${EDGE}" stroke-width="1"/>`);
    const tick = (cx: number, cy: number, dx: number, dy: number) =>
      p.push(`<path d="M${cx} ${cy + dy * 14} L${cx} ${cy} L${cx + dx * 14} ${cy}" fill="none" stroke="${GOLD}" stroke-width="2.5"/>`);
    tick(fx + 7, fy + 7, 1, 1); tick(fx + fw - 7, fy + 7, -1, 1);
    tick(fx + 7, fy + fh - 7, 1, -1); tick(fx + fw - 7, fy + fh - 7, -1, -1);

    p.push(`<image href="${input.photo}" x="${px}" y="${py}" width="${dw}" height="${dh}"/>`);

    // ── INSET PHOTOS — nakapatong sa litrato, may puting frame at orange na
    // label (gaya ng "Lift Storage" sa orihinal na template). Iginuguhit BAGO
    // ang mga label/arrow para pwede silang pumatong sa inset.
    for (const ins of input.insets ?? []) {
      if (!ins.img) continue;
      const c01 = (n: unknown) => Math.min(1, Math.max(0, Number(n) || 0));
      const wFrac = Math.min(0.9, Math.max(0.1, Number(ins.w) || 0.35));
      const iwN = Math.max(1, Number(ins.iw) || 4), ihN = Math.max(1, Number(ins.ih) || 3);
      const bw2 = wFrac * dw;
      const bh2 = bw2 * (ihN / iwN);
      const cx = px + c01(ins.x) * dw, cy = py + c01(ins.y) * dh;
      const x0 = Math.round(cx - bw2 / 2), y0 = Math.round(cy - bh2 / 2);
      p.push(`<rect x="${x0 - 3}" y="${y0 - 3}" width="${Math.round(bw2) + 6}" height="${Math.round(bh2) + 6}" fill="#ffffff" stroke="#c9c0ac" stroke-width="1"/>`);
      p.push(`<image href="${ins.img}" x="${x0}" y="${y0}" width="${Math.round(bw2)}" height="${Math.round(bh2)}" preserveAspectRatio="xMidYMid slice"/>`);
      const t2 = String(ins.text ?? "").trim();
      if (t2) {
        const lw = Math.max(70, t2.length * 10.5 + 26);
        const lx0 = Math.round(cx - lw / 2), ly0 = y0 - 20;
        p.push(`<rect x="${lx0}" y="${ly0}" width="${Math.round(lw)}" height="34" fill="#e8712c" stroke="#8a3f0e" stroke-width="1"/>`);
        text(Math.round(cx), ly0 + 23, t2, { size: 16.5, bold: true, anchor: "middle", fill: "#1c1208" });
      }
    }

    const YELLOW = ARROW;
    for (const l of input.labels ?? []) {
      const t = String(l.text ?? "").trim();
      // Ang arrow ay pwedeng WALANG text (inilagay muna ang sukat, saka
      // papatungan ng hiwalay na label) — ang laktawan lang ay ang parehong
      // walang text at walang arrow (v/h man o malayang dulo).
      const anyArrow = l.arrow === "v" || l.arrow === "h" ||
        [l.ax, l.ay, l.bx, l.by].every((n) => typeof n === "number" && isFinite(n as number));
      if (!t && !anyArrow) continue;
      const lx = px + Math.min(1, Math.max(0, Number(l.x) || 0)) * dw;
      const ly = py + Math.min(1, Math.max(0, Number(l.y) || 0)) * dh;
      // SUKAT-ARROW: iginuguhit MUNA para ang puting kahon ay nakapatong sa
      // gitna nito — gaya ng "16 from floor" sa orihinal na sheet. Kapag may
      // malayang dulo (ax..by), iyon ang sinusunod — kahit anong hilig; ang
      // v/h + len ay para sa mga lumang naka-imbak na sheet.
      const hasPts = [l.ax, l.ay, l.bx, l.by].every((n) => typeof n === "number" && isFinite(n as number));
      if (hasPts || l.arrow === "v" || l.arrow === "h") {
        const c01 = (n: unknown) => Math.min(1, Math.max(0, Number(n) || 0));
        let x1: number, y1: number, x2: number, y2: number;
        if (hasPts) {
          x1 = px + c01(l.ax) * dw; y1 = py + c01(l.ay) * dh;
          x2 = px + c01(l.bx) * dw; y2 = py + c01(l.by) * dh;
        } else if (l.arrow === "v") {
          const L = Math.min(1, Math.max(0.05, Number(l.len) || 0.3)) * dh;
          x1 = lx; y1 = Math.max(py, ly - L / 2); x2 = lx; y2 = Math.min(py + dh, ly + L / 2);
        } else {
          const L = Math.min(1, Math.max(0.05, Number(l.len) || 0.3)) * dw;
          x1 = Math.max(px, lx - L / 2); y1 = ly; x2 = Math.min(px + dw, lx + L / 2); y2 = ly;
        }
        const ang = Math.atan2(y2 - y1, x2 - x1);
        const deg = (ang * 180) / Math.PI;
        // Paiksiin ang linya sa magkabilang dulo para hindi lumagpas sa ulo.
        const ux = Math.cos(ang), uy = Math.sin(ang);
        p.push(`<line x1="${(x1 + ux * 11).toFixed(1)}" y1="${(y1 + uy * 11).toFixed(1)}" x2="${(x2 - ux * 11).toFixed(1)}" y2="${(y2 - uy * 11).toFixed(1)}" stroke="${YELLOW}" stroke-width="3.5"/>`);
        // Mga ulo: tatsulok na nakaturo palabas sa bawat dulo, nakaikot sa
        // hilig ng linya (template: tulis sa (0,0), nakaturo pataas).
        p.push(`<path d="M0 0 L-7 13 L7 13 Z" fill="${YELLOW}" transform="translate(${x1.toFixed(1)} ${y1.toFixed(1)}) rotate(${(deg + 270).toFixed(1)})"/>`);
        p.push(`<path d="M0 0 L-7 13 L7 13 Z" fill="${YELLOW}" transform="translate(${x2.toFixed(1)} ${y2.toFixed(1)}) rotate(${(deg + 90).toFixed(1)})"/>`);
      }
      // Puting kahon, itim na teksto — gaya ng mga label sa orihinal na sheet.
      // Walang kahon kapag walang text (arrow lang ang inilagay).
      if (!t) continue;
      const numN = Number(l.num);
      const hasNum = Number.isInteger(numN) && numN > 0;
      const CHIP = hasNum ? 27 : 0; // puwang ng pulang numero sa kaliwa
      const bw = Math.max(60, t.length * 8.6 + 22 + CHIP);
      const bh = 30;
      // Huwag hayaang lumampas ang kahon sa gilid ng buong sheet.
      const bx = Math.min(Math.max(lx - bw / 2, PAD - 24), W - PAD + 24 - bw);
      const by = Math.min(Math.max(ly - bh / 2, py - 8), py + dh - bh + 8);
      p.push(`<rect x="${Math.round(bx)}" y="${Math.round(by)}" width="${Math.round(bw)}" height="${bh}" fill="#ffffff" stroke="#000000" stroke-width="1"/>`);
      if (hasNum) {
        // Ang parehong pulang chip ng specs list — iyon ang nag-uugnay.
        p.push(`<rect x="${Math.round(bx + 6)}" y="${Math.round(by + 6)}" width="18" height="18" rx="3" fill="${RED}"/>`);
        text(Math.round(bx + 15), Math.round(by + 19.5), String(numN), { size: 11, bold: true, anchor: "middle", fill: "#fdfbf6" });
      }
      text(Math.round(bx + CHIP + (bw - CHIP) / 2), Math.round(by + 20), t, { size: 15, anchor: "middle", fill: "#111111" });
    }
    y = fy + fh + 30;
  }

  // ── IMPORTANT NOTE — may pulang rule sa itaas (template) ────────────────────
  p.push(`<line x1="${PAD}" y1="${y - 6}" x2="${RIGHT}" y2="${y - 6}" stroke="${RED}" stroke-width="2"/>`);
  y += 16;
  text(MID, y, "IMPORTANT NOTE", { size: 14, bold: true, anchor: "middle", fill: RED, spacing: 2.4 });
  y += 22;
  const facts = [
    input.mattress?.trim() ? `Mattress thickness: ${input.mattress.trim()}` : "",
    input.headboard?.trim() ? `Net visible height of headboard: ${input.headboard.trim()}` : "",
  ].filter(Boolean).join("   ·   ");
  if (facts) {
    text(MID, y, facts, { size: 13.5, bold: true, anchor: "middle" });
    y += 20;
  }
  const note = (input.note ?? "").trim();
  if (note) {
    y += 2;
    for (const ln of wrap(note, 104)) {
      text(MID, y, ln, { size: 12.5, italic: true, anchor: "middle", fill: GREY });
      y += 17;
    }
  }
  p.push(`<line x1="${PAD}" y1="${y + 4}" x2="${RIGHT}" y2="${y + 4}" stroke="${HAIR}" stroke-width="1"/>`);
  y += 34;

  // ── APPROVAL BLOCK — tatlong pirmahan: ang inaprubahang sheet mismo ang
  // kasunduan bago simulan ang produksyon (template).
  const SIG_W = (RIGHT - PAD - 2 * 34) / 3;
  const sigs = ["CUSTOMER APPROVAL", "DATE APPROVED", "PAN FURNITURE · AUTHORIZED"];
  // Kapag APPROVED na: naka-sulat na sa ibabaw ng bawat linya ang halaga —
  // pangalan ng customer, petsa, at ang gumawa ng design details.
  const sigVals = input.approval
    ? [input.approval.customer, input.approval.date, input.approval.authorized]
    : [null, null, null];
  sigs.forEach((cap, i) => {
    const sx = PAD + i * (SIG_W + 34);
    const v = (sigVals[i] ?? "").trim();
    if (v) {
      p.push(`<text x="${sx + SIG_W / 2}" y="${y + 20}" text-anchor="middle" font-family="Georgia, 'Times New Roman', serif" font-style="italic" font-size="15" fill="#2f2818">${v.replace(/&/g, "&amp;").replace(/</g, "&lt;")}</text>`);
    }
    p.push(`<line x1="${sx}" y1="${y + 26}" x2="${sx + SIG_W}" y2="${y + 26}" stroke="${WHITE}" stroke-width="1"/>`);
    text(sx + SIG_W / 2, y + 42, cap, { size: 9.5, anchor: "middle", fill: GREY, spacing: 1.2 });
  });
  y += 62;

  // ── FOOTER STAMP: DD number + rev + petsa-initials | paalala ────────────────
  p.push(`<line x1="${PAD}" y1="${y}" x2="${RIGHT}" y2="${y}" stroke="${HAIR}" stroke-width="1"/>`);
  const stamp = [ddNum || null, "Rev. A", [input.dateLabel, (input.initials ?? "").trim()].filter(Boolean).join("-")]
    .filter(Boolean).join(" · ");
  text(PAD, y + 18, stamp, { size: 11, fill: "#8a7c62" });
  text(RIGHT, y + 18, "Production starts after customer approval", { size: 11, anchor: "end", fill: "#8a7c62" });
  y += 26;

  const H = Math.ceil(y + PAD - 10);

  // PAN logo bilang MALABONG watermark sa gitna — kahilingan 2026-08-09: kita
  // dapat pero light lang. Nasa IBABAW ng lahat (huling layer): ang litrato ay
  // halos buong lapad na at tinatakpan nito ang anumang nasa likod, kaya ang
  // watermark sa ilalim ay hindi na nakikita. Sa 6% opacity, aninag lang ito
  // sa litrato at sa puting papel — hindi nakakaagaw sa laman.
  const watermark = input.logo
    ? `<image href="${input.logo}" x="${MID - 310}" y="${H / 2 - 310}" width="620" height="620" preserveAspectRatio="xMidYMid meet" opacity="0.14"/>`
    : "";

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
<rect width="${W}" height="${H}" fill="${BG}"/>
<g font-family="Arial, Helvetica, sans-serif" fill="${WHITE}">
${p.join("\n")}
</g>
${watermark}
</svg>`;
}
