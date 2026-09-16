// Mga larawang isinasama sa quotation SVG.
//
// BAKIT DATA URI, HINDI URL: hinahatak ni Meta ang SVG sa server nila para
// gawing larawan sa Messenger. Ang `<image href="https://...">` na tumutukoy sa
// ibang host ay hindi maaasahan doon — madalas hindi na-fetch, at blangko ang
// lumalabas. Ang naka-embed na base64 ay laging kasama, kaya laging kita.
//
// Ang logo ay binabasa mula sa public/logo.png (transparent PNG) minsan lang at
// naka-cache sa module scope — server-only ito, kaya hindi lumalaki ang client
// bundle.

import { readFile } from "node:fs/promises";
import path from "node:path";
import { createServerSupabase } from "@/lib/supabase/server";

let logoCache: string | null | undefined;

// Transparent PAN logo bilang data URI. Nagbabalik ng null kung hindi mabasa —
// sa ganoon, may text-based na chip na fallback ang renderer.
export async function panLogoDataUri(): Promise<string | null> {
  if (logoCache !== undefined) return logoCache;
  try {
    // TRANSPARENT na bersyon ang unahin (2026-08-18): ang logo.png ay may
    // PUTING background na lumalabas bilang puting parisukat sa likod ng
    // watermark ng Design Details sheet; fallback ang luma kung wala.
    const buf = await readFile(path.join(process.cwd(), "public", "logo-transparent.png"))
      .catch(() => readFile(path.join(process.cwd(), "public", "logo.png")));
    logoCache = `data:image/png;base64,${buf.toString("base64")}`;
  } catch {
    logoCache = null;
  }
  return logoCache;
}

// ── QR / SIGNATURE CARDS ─────────────────────────────────────────────────────
// Ang BPI at BDO na InstaPay QR cards at ang lagda ay LARAWAN na ina-upload ng
// admin — hindi kayang buuin ng code (ibang QR payload ang InstaPay ng bawat bangko,
// at ang lagda ay scan ng tunay na pirma). Iniimbak sa product-images/quotation/
// gamit ang mga fixed na pangalan sa ibaba, at awtomatikong napupunta sa
// quotation kapag naroon. Kapag wala, teksto na lang ang lalabas — hindi
// nababali ang quotation.
export const QUOTE_ASSET_PATHS = {
  bpiQr: "quotation/bpi-qr",
  bdoQr: "quotation/bdo-qr",
  // GCash / Maya QR — ginagamit ng Installation payment collection (Step 1 QR
  // display). Ang Maya dito ay ang STATIC na personal/merchant QR card — iba sa
  // "Maya QR" na auto-generated (Maya Business checkout na may auto-detect).
  gcashQr: "quotation/gcash-qr",
  mayaQr: "quotation/maya-qr",
  signature: "quotation/signature",
} as const;

export type QuoteAssets = { bpiQr: string | null; bdoQr: string | null; signature: string | null };

// Hanapin ang bawat asset (kahit anong extension) at gawing data URI.
async function findAsset(db: ReturnType<typeof createServerSupabase>, base: string): Promise<string | null> {
  const dir = base.slice(0, base.lastIndexOf("/"));
  const name = base.slice(base.lastIndexOf("/") + 1);
  try {
    const { data } = await db.storage.from("product-images").list(dir, { limit: 100 });
    const hit = (data ?? []).find((f) => f.name.replace(/\.[^.]+$/, "") === name);
    if (!hit) return null;
    const { data: blob } = await db.storage.from("product-images").download(`${dir}/${hit.name}`);
    if (!blob) return null;
    const buf = Buffer.from(await blob.arrayBuffer());
    // Gamitin ang mime na iniulat ng storage; ang extension ay panghuling hulaan
    // lang. Mahalaga ito dahil kahit anong image format ay tinatanggap ngayon.
    const byExt: Record<string, string> = {
      png: "image/png", webp: "image/webp", gif: "image/gif", avif: "image/avif",
      heic: "image/heic", heif: "image/heif", svg: "image/svg+xml", jpg: "image/jpeg", jpeg: "image/jpeg",
    };
    const ext = hit.name.split(".").pop()?.toLowerCase() ?? "";
    const mime = blob.type?.startsWith("image/") ? blob.type : (byExt[ext] ?? "image/jpeg");
    return `data:${mime};base64,${buf.toString("base64")}`;
  } catch {
    return null;
  }
}

// CACHE (2026-08-17): ang tatlong asset ay dina-download dati sa BAWAT preview
// at create — malalaking imahe, kaya mabagal ang "Create & send". Bihira
// magbago ang mga ito; 5 minutong cache ang sapat (pagkatapos mag-upload ng
// bagong QR card, hintayin lang mag-expire o mag-redeploy).
const ASSETS_TTL_MS = 5 * 60_000;
let assetsCache: { at: number; data: QuoteAssets } | null = null;

export async function loadQuoteAssets(): Promise<QuoteAssets> {
  if (assetsCache && Date.now() - assetsCache.at < ASSETS_TTL_MS) return assetsCache.data;
  const db = createServerSupabase();
  const [bpiQr, bdoQr, signature] = await Promise.all([
    findAsset(db, QUOTE_ASSET_PATHS.bpiQr),
    findAsset(db, QUOTE_ASSET_PATHS.bdoQr),
    findAsset(db, QUOTE_ASSET_PATHS.signature),
  ]);
  const data = { bpiQr, bdoQr, signature };
  assetsCache = { at: Date.now(), data };
  return data;
}
