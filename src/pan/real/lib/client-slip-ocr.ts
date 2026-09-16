"use client";

// In-BROWSER Maya slip OCR. Server-side OCR kept hitting serverless time limits
// (504), so the scan runs on the device itself — the POS station is a modern
// desktop Chrome. All assets are served from /public/tesseract (no CDN):
// worker.min.js, the LSTM wasm cores, and eng.traineddata.gz.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { parseMayaSlip, type SlipScanResult } from "./maya-slip-parse";

let workerPromise: Promise<any> | null = null;
function getWorker() {
  if (!workerPromise) {
    workerPromise = import("tesseract.js").then(async ({ createWorker }) => {
      const w = await createWorker("eng", undefined, {
        workerPath: "/tesseract/worker.min.js",
        corePath: "/tesseract/",
        langPath: "/tesseract",
        gzip: true,
      });
      // Receipts are one narrow column — single-column segmentation reads the
      // small label/value lines far better than automatic page layout.
      await w.setParameters({ tessedit_pageseg_mode: "4" as never });
      return w;
    });
  }
  return workerPromise;
}

// Canvas preprocessing — thermal slips are photographed dark/low-contrast and the
// text is small in a full-slip photo. Upscale so characters are OCR-sized, then
// grayscale + adaptive threshold (binarize) so faint print turns crisp black on
// white. Falls back to the raw URL on any canvas failure.
async function preprocess(url: string, binarize = true): Promise<Blob | string> {
  try {
    const img = await new Promise<HTMLImageElement>((res, rej) => {
      const i = new Image();
      i.crossOrigin = "anonymous";
      i.onload = () => res(i);
      i.onerror = () => rej(new Error("image load failed"));
      i.src = url;
    });
    // Target ~2300px on the LONG side — the small label/value lines (Ref No, Appr
    // Code) need real pixel size before Tesseract can read them.
    const long = Math.max(img.width, img.height);
    const scale = Math.min(2300 / long, 4); // upscale up to 4×, downscale huge shots
    const w = Math.max(1, Math.round(img.width * scale));
    const h = Math.max(1, Math.round(img.height * scale));
    const c = document.createElement("canvas");
    c.width = w; c.height = h;
    const ctx = c.getContext("2d");
    if (!ctx) return url;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(img, 0, 0, w, h);
    // Grayscale (+ optional threshold against the image's own mean luminance).
    // Binarize helps DARK shots; on clean bright shots it can destroy detail —
    // the caller runs a second plain-grayscale pass when binarize parses nothing.
    const id = ctx.getImageData(0, 0, w, h);
    const px = id.data;
    let sum = 0;
    const n = px.length / 4;
    for (let i = 0; i < px.length; i += 4) sum += px[i] * 0.299 + px[i + 1] * 0.587 + px[i + 2] * 0.114;
    const mean = sum / n;
    const cut = mean * 0.82; // below ~82% of mean = ink
    for (let i = 0; i < px.length; i += 4) {
      const lum = px[i] * 0.299 + px[i + 1] * 0.587 + px[i + 2] * 0.114;
      const v = binarize ? (lum < cut ? 0 : 255) : lum;
      px[i] = px[i + 1] = px[i + 2] = v;
    }
    ctx.putImageData(id, 0, 0);
    return await new Promise<Blob>((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error("canvas blob failed"))), "image/png"));
  } catch {
    return url;
  }
}

const withTimeout = <T,>(p: Promise<T>, ms: number): Promise<T> =>
  Promise.race([p, new Promise<never>((_, rej) => setTimeout(() => rej(new Error("OCR timed out — retake the photo flat and well lit.")), ms))]);

async function ocrOnce(input: Blob | string): Promise<string> {
  const worker = await withTimeout(getWorker(), 45_000);
  try {
    const { data } = await withTimeout<{ data: { text: string } }>(worker.recognize(input), 45_000);
    return data.text || "";
  } catch (e) {
    workerPromise = null; // a dead worker poisons later scans — reset
    throw e;
  }
}

export async function scanSlipInBrowser(url: string): Promise<SlipScanResult> {
  try {
    // Pass 1: binarized (best for dark thermal shots).
    const text1 = await ocrOnce(await preprocess(url, true));
    let best = { text: text1, fields: parseMayaSlip(text1) };
    // Pass 2 (only when the amount wasn't found): plain grayscale — binarization can
    // destroy clean/bright shots. Keep whichever pass parsed the amount.
    if (best.fields.amount == null) {
      const text2 = await ocrOnce(await preprocess(url, false));
      const f2 = parseMayaSlip(text2);
      if (f2.amount != null || (!best.text.trim() && text2.trim())) best = { text: text2, fields: f2 };
    }
    if (!best.text.trim()) return { error: "No text could be read from the photo — retake it flat, well lit, and free of glare." };
    return { ok: true, ...best.fields, rawText: best.text.slice(0, 4000) };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "OCR failed." };
  }
}
