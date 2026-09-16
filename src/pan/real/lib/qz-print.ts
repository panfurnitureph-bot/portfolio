"use client";

// Thin wrapper around QZ Tray for raw ESC/POS thermal printing.
// QZ Tray (desktop app) must be installed and running on the PC.
// The qz-tray.js client lib is vendored at /public/qz-tray.js.

/* eslint-disable @typescript-eslint/no-explicit-any */
import { signQz } from "@/app/actions/qz-sign";

type Qz = any;

let qzPromise: Promise<Qz> | null = null;
let certCache: string | null = null;

// Fetch our public signing certificate (served from /public).
async function loadCert(): Promise<string> {
  if (certCache) return certCache;
  const res = await fetch("/digital-certificate.txt", { cache: "force-cache" });
  certCache = await res.text();
  return certCache;
}

// Load /qz-tray.js once and return the global `qz` object.
function loadQz(): Promise<Qz> {
  if (qzPromise) return qzPromise;
  qzPromise = new Promise<Qz>((resolve, reject) => {
    const w = window as any;
    if (w.qz) return resolve(w.qz);
    const s = document.createElement("script");
    s.src = "/qz-tray.js";
    s.onload = () => (w.qz ? resolve(w.qz) : reject(new Error("qz-tray.js loaded but window.qz missing")));
    s.onerror = () => reject(new Error("Failed to load /qz-tray.js"));
    document.head.appendChild(s);
  });
  return qzPromise;
}

// Connect to the QZ Tray websocket, signing requests with our certificate so
// QZ trusts them silently (no "Allow" prompt). The cert must be imported into
// QZ Tray once (Advanced → Site Manager → import /certs/digital-certificate.txt).
async function ensureConnected(qz: Qz): Promise<void> {
  const cert = await loadCert();
  qz.security.setCertificatePromise((resolve: any) => resolve(cert));
  qz.security.setSignatureAlgorithm("SHA512");
  qz.security.setSignaturePromise((toSign: string) => (resolve: any, reject: any) =>
    signQz(toSign).then(resolve).catch(reject),
  );
  if (qz.websocket.isActive()) return;
  await qz.websocket.connect();
}

// Find the configured printer (exact name, else first match containing the hint).
async function findPrinter(qz: Qz, hint: string): Promise<string> {
  try {
    const exact = await qz.printers.find(hint);
    if (exact) return Array.isArray(exact) ? exact[0] : exact;
  } catch {
    /* fall through to listing */
  }
  const all: string[] = await qz.printers.find();
  const list = Array.isArray(all) ? all : [all];
  const m = list.find((p) => p.toLowerCase().includes(hint.toLowerCase()));
  if (m) return m;
  // IBANG PANGALAN SA IBANG LAPTOP (Joe 2026-09-07): ang parehong 80mm Xprinter
  // ay naka-install bilang "XP-80C" sa isang laptop, "Xprinter Q200" sa isa —
  // ang driver ang nagbibigay ng pangalan. Kapag wala ang hint: (1) ang
  // printer na pinili na sa device na ito; (2) kahit aling 80mm Xprinter
  // (Q200 / XP-80 / 80C) — HINDI ang 58mm (XP-58) o label printer (XP-420B /
  // XP-410B), mali ang lapad/wika ng mga iyon.
  const remembered = (() => { try { return localStorage.getItem("pan.thermalPrinter"); } catch { return null; } })();
  if (remembered && list.includes(remembered)) return remembered;
  const auto = list.find((p) => /q200|xp-?80|80c/i.test(p))
    ?? list.find((p) => /xprinter/i.test(p) && !/58|4[12]0|label|tspl/i.test(p));
  if (auto) {
    try { localStorage.setItem("pan.thermalPrinter", auto); } catch { /* wala man */ }
    return auto;
  }
  throw new Error(`Printer "${hint}" not found. Available: ${list.join(", ") || "none"}`);
}

// Print raw ESC/POS data to the named printer.
export async function printRaw(printerHint: string, escpos: string): Promise<void> {
  const qz = await loadQz();
  await ensureConnected(qz);
  const printer = await findPrinter(qz, printerHint);
  const cfg = qz.configs.create(printer, { encoding: "CP437" });
  await qz.print(cfg, [{ type: "raw", format: "plain", data: escpos }]);
}

// Raw print straight to a network printer (host:port 9100) — bypasses the Windows
// driver, which is required for TSPL label printers (e.g. Xprinter XP-420B).
export async function printRawHost(host: string, port: number, data: string): Promise<void> {
  const qz = await loadQz();
  await ensureConnected(qz);
  const cfg = qz.configs.create({ host, port }, { encoding: "CP437" });
  await qz.print(cfg, [{ type: "raw", format: "plain", data }]);
}

// Network address of the Xprinter XP-420B label printer (update if the IP changes).
export const XP420 = { host: "192.168.1.171", port: 9100 };

// HTML print via the Windows driver (renders to raster → driver speaks the printer's
// native language). Needed for label printers that ignore raw socket data (XP-420B).
export async function printHtml(printerHint: string, html: string, sizeMm?: { width: number; height: number }): Promise<void> {
  const qz = await loadQz();
  await ensureConnected(qz);
  const printer = await findPrinter(qz, printerHint);
  // density 203 = the XP-420B's native 203 DPI → the raster matches the print head
  // 1:1 (no down/upscaling blur), so barcodes + text come out crisp/dark.
  const opts: Record<string, unknown> = {
    units: "mm", margins: 0, colorType: "blackwhite", rasterize: true,
    density: 203, interpolation: "nearest-neighbor",
  };
  if (sizeMm) opts.size = { width: sizeMm.width, height: sizeMm.height };
  const cfg = qz.configs.create(printer, opts);
  await qz.print(cfg, [{ type: "html", format: "plain", data: html }]);
}

// ── ESC/POS command helpers ───────────────────────────────────────────────
export const ESC = {
  init: "\x1B\x40", // reset
  alignLeft: "\x1B\x61\x00",
  alignCenter: "\x1B\x61\x01",
  alignRight: "\x1B\x61\x02",
  boldOn: "\x1B\x45\x01",
  boldOff: "\x1B\x45\x00",
  dhOn: "\x1D\x21\x11", // double width+height
  dhOff: "\x1D\x21\x00",
  feed: (n = 1) => "\x1B\x64" + String.fromCharCode(n), // feed n lines
  cut: "\x1D\x56\x42\x00", // partial cut (feeds then cuts)
};

// 80mm printer at Font A = 48 chars/line. Two-column row padded to width.
export const COLS = 48;
export function twoCol(left: string, right: string, cols = COLS): string {
  const space = cols - left.length - right.length;
  if (space < 1) {
    // Too long: put right on its own right-aligned line under left.
    return left + "\n" + right.padStart(cols) + "\n";
  }
  return left + " ".repeat(space) + right + "\n";
}

// Word-wrap a long string to `cols` width.
export function wrap(text: string, cols = COLS): string {
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

// Center text within `cols` (for monospace preview / escpos alignment fallback).
export function center(text: string, cols = COLS): string {
  const pad = Math.max(0, Math.floor((cols - text.length) / 2));
  return " ".repeat(pad) + text;
}

// ── Shared document line model: one source of truth for print + preview ──
// A line carries its styling; `linesToEscpos` renders it to the printer and the
// React preview renders the same array to screen → guaranteed WYSIWYG.
export type PrintLine = { t: string; bold?: boolean; big?: boolean; center?: boolean; pre?: boolean };

// Native ESC/POS Code128 barcode (crisp — printer renders it, not a raster).
// Sets height/width + HRI text below, then emits the barcode for `value`.
export function code128(value: string, opts?: { height?: number; width?: number }): string {
  const h = opts?.height ?? 70;
  const w = opts?.width ?? 2;
  const data = "{B" + value; // Code128 code-set B
  return (
    "\x1D\x68" + String.fromCharCode(h) + // GS h  (height)
    "\x1D\x77" + String.fromCharCode(w) + // GS w  (module width)
    "\x1D\x48\x02" +                      // GS H 2 (HRI below)
    "\x1D\x6B\x49" + String.fromCharCode(data.length) + data // GS k I (Code128)
  );
}

export function linesToEscpos(lines: PrintLine[]): string {
  let s = ESC.init;
  for (const ln of lines) {
    s += ln.center ? ESC.alignCenter : ESC.alignLeft;
    if (ln.bold) s += ESC.boldOn;
    if (ln.big) s += ESC.dhOn;
    // CP437 has no ₱. Map it to ₧ (U+20A7) which QZ encodes to byte 0x9E — many
    // PH thermal printers (incl. Xprinter) print ₱ at that byte. (Preview keeps ₱.)
    // Wala ring • / · / — sa CP437 — lumalabas na "?" sa print, kaya pinapalitan
    // ng "*" at "-" (2026-08-18). Ang preview/PDF ay nananatiling •.
    s += (ln.t || "").replace(/₱/g, "₧").replace(/[•·]/g, "*").replace(/[—–]/g, "-") + "\n";
    if (ln.big) s += ESC.dhOff;
    if (ln.bold) s += ESC.boldOff;
  }
  s += ESC.alignLeft + ESC.feed(3) + ESC.cut;
  return s;
}

// ── TSPL (label printers: Xprinter XP-420B, etc.) ──────────────────────────
// Label printers speak TSPL, not ESC/POS. One label per product, `copies` per label.
export function tsplLabel(code: string, name: string, opts?: { wmm?: number; hmm?: number; copies?: number }): string {
  const w = opts?.wmm ?? 50;
  const h = opts?.hmm ?? 30;
  const copies = Math.max(1, opts?.copies ?? 1);
  const q = (s: string) => String(s ?? "").replace(/["\\]/g, "");
  return [
    `SIZE ${w} mm,${h} mm`,
    `GAP 2 mm,0 mm`,
    `DIRECTION 1`,
    `CLS`,
    `TEXT 16,12,"2",0,1,1,"${q(name).slice(0, 30)}"`,
    `BARCODE 16,46,"128",90,1,0,2,4,"${q(code)}"`,
    `PRINT 1,${copies}`,
    "",
  ].join("\r\n");
}
