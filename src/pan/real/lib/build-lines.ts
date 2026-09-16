// PAGPAPANGKAT NG BUILD LINES ng isang made-to-order request.
//
// NASA lib/, HINDI sa actions.ts: ang isang "use server" na file ay async
// exports lang ang pinapayagan (Server Actions), kaya doon ay hindi ito
// nabu-build. Dito rin nakukuha ng client component nang hindi dumadaan sa
// server — iisang porma ang modal, ang ipinapadalang dokumento, at ang PDF.

// MARAMING PRODUKTO KADA REQUEST (2026-08-21). Ang isang request ay dating
// iisang build; ngayon ay may listahan sa build.products. Ang lumang hugis ay
// hindi minigrate — binabasa ito ng mtoProducts() bilang listahan ng isa, kaya
// ang mga lumang row ay bumubukas pa rin nang walang pagbabago.
// Ang mga label ng sukat kada category, pinagsama-sama — ito ang nagpapasya
// kung ang isang linya ay sukat ng produkto o tunay na add-on.
import { CATEGORY_MEASUREMENTS } from "./website-config";

const MEASURE_LABELS = new Set(
  Object.values(CATEGORY_MEASUREMENTS).flat().map((m) => m.label.trim().toLowerCase()),
);

export type MtoProduct = {
  sku?: string | null;
  slug?: string | null;
  name?: string | null;
  category?: string | null;
  image?: string | null;
  build?: { size?: string; fabric?: string; lines?: { label: string; price?: number }[]; total?: number; priced?: boolean };
};

// Ang mga produkto ng isang request, luma man o bago ang hugis. LAGING may
// laman ang binabalik (isa man lang) — walang tumatawag na kailangang mag-isip
// kung anong bersyon ang binabasa nito.
export function mtoProducts(r: {
  sku?: string | null;
  slug?: string | null;
  product_name?: string | null;
  category?: string | null;
  image_url?: string | null;
  build?: { products?: MtoProduct[]; lines?: { label: string; price?: number }[]; size?: string; fabric?: string; total?: number; priced?: boolean };
}): MtoProduct[] {
  const list = r.build?.products;
  if (Array.isArray(list) && list.length) return list;
  // Lumang hugis: ang produkto ay nasa row mismo, ang build ay ang buong column.
  return [
    {
      sku: r.sku ?? null,
      slug: r.slug ?? null,
      name: r.product_name ?? null,
      category: r.category ?? null,
      image: r.image_url ?? null,
      build: r.build ?? {},
    },
  ];
}

// Ang kama muna, tapos ang mga idinagdag, tapos ang dingding na may sariling
// sukat; blangkong linya sa pagitan. Ang doble ay inaalis — may lumang request
// na may parehong linya nang dalawang beses ("Decorative Nails: Gold" bilang
// option at bilang bahagi ng dingding).
export function groupBuildLines(r: { category?: string | null; product_name?: string | null; sku?: string | null; build?: { lines?: { label: string; price?: number }[] } }): string[] {
  const bl0 = r.build?.lines ?? [];
  const seen = new Set<string>();
  const bl = bl0.filter((l) => {
    const k = String(l.label).trim().toLowerCase();
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  const isBed = (l: string) => /^(size|fabric)\b/i.test(l);
  // ANG SUKAT AY BAHAGI NG ITEM, HINDI ADD-ON (2026-08-23). Ang "Total Height:
  // 1 inches" ay lumilitaw dating sa ilalim ng ADD-ONS — parang may piniling
  // dagdag ang customer, gayong sukat lang iyon ng mismong produkto. Ang
  // listahan ay galing sa CATEGORY_MEASUREMENTS para hindi maiwan kapag may
  // bagong category o field na naidagdag doon.
  // Sukat din ang anumang linyang may numero at unit (34 inches / 90 cm / 6") —
  // ang Product Management specs (End to End, Backrest / Armrest Thickness…) ay
  // hindi lahat nasa CATEGORY_MEASUREMENTS (2026-09-05).
  const UNIT_RE = /:\s*\d+(?:\.\d+)?\s*(?:"|″|in\b|inch(?:es)?\b|cm\b|ft\b)/i;
  const isMeasure = (l: string) => MEASURE_LABELS.has(l.split(":")[0].trim().toLowerCase()) || UNIT_RE.test(l);
  // ANG Height/Thickness/Width NG DINGDING ay ang mga linyang KASUNOD ng
  // "Double walling" (2026-09-04): ngayong may sariling Width/Length/Height
  // ang bawat produkto, ang bare na "Width: 34 inches" BAGO ang Double walling
  // ay sukat ng produkto, hindi ng dingding.
  const wallIdx = bl.findIndex((l) => /^double walling\b/i.test(String(l.label)));
  const hasWall = wallIdx >= 0;
  const idxOf = new Map(bl.map((l, i) => [String(l.label), i]));
  const isWall = (l: string) =>
    hasWall && (/^(double walling|frame dimension|decorative nails|gold accent)\b/i.test(l) || (/^(height|thickness|width)\b/i.test(l) && (idxOf.get(l) ?? -1) > wallIdx));
  // WALANG Size/Fabric ANG IBANG PRODUKTO (side table: taas at kulay ng kahoy
  // lang). Doon, ang mga natitira ANG produkto — hindi "ADD-ONS", na parang
  // may pangunahing bahagi pang nawawala.
  const hasBed = bl.some((l) => isBed(String(l.label)));
  // Ang dingding muna: ang Height/Width KASUNOD ng Double walling ay sa
  // dingding kahit nasa MEASURE_LABELS na rin ang Height/Width ngayon.
  const rank = (l: string) => (isWall(l) ? 2 : isBed(l) || isMeasure(l) ? 0 : hasBed ? 1 : 0);
  const wallRank = (l: string) =>
    /^double walling/i.test(l) ? 0 : /^frame dimension/i.test(l) ? 1 : /^(height|thickness|width)/i.test(l) ? 2 : 3;
  const ordered = bl
    .map((l, i) => ({ l, i }))
    .sort((a, b) => {
      const ra = rank(String(a.l.label));
      const rb = rank(String(b.l.label));
      if (ra !== rb) return ra - rb;
      if (ra === 2) {
        const wa = wallRank(String(a.l.label));
        const wb = wallRank(String(b.l.label));
        if (wa !== wb) return wa - wb;
      }
      return a.i - b.i;
    })
    .map((x) => x.l);

  // PAMAGAT KADA PANGKAT, kapareho ng Messenger echo — ang blangkong linya lang
  // ay hindi nagsasabi kung ano ang tinitingnan mo. Ang dingding ay may sariling
  // pamagat lang kapag talagang may double walling.
  const TITLES = ["THE ITEM", "ADD-ONS", "DOUBLE WALLING"];
  const out = [`${(r.category ?? "").toUpperCase()}${r.category ? ": " : ""}${r.product_name ?? r.sku ?? "Custom build"}`];
  let last = -1;
  for (const l of ordered) {
    const rk = rank(String(l.label));
    if (rk !== last) {
      if (last !== -1) out.push("");
      out.push(TITLES[rk]);
    }
    last = rk;
    out.push(`• ${String(l.label).replace(/^[•·-]\s*/, "")}`);
  }
  out.push("• Customized");
  return out;
}

// Ang parehong pagpapangkat para sa ISANG produkto ng multi-product request.
// Ang groupBuildLines ay tumatanggap ng row; ito ay tumatanggap ng produkto.
export function groupProductLines(p: MtoProduct): string[] {
  return groupBuildLines({ category: p.category ?? null, product_name: p.name ?? null, sku: p.sku ?? null, build: p.build });
}

// ANG TINIPANG PRESYO AY IBINABALIK SA TAMANG PRODUKTO. Ang lineParts ay isang
// mahabang listahan na katapat ng pinagsamang linya ng lahat ng produkto; ang
// bawat produkto ay may sariling hiwa nito. Kapag hindi tama ang hati,
// mapupunta sa ottoman ang presyo ng kama at hindi ito magpaparamdam.
//
// Ang unang linya ng bawat pangkat ay ang pamagat ng produkto at ang mga
// pamagat ng seksyon ay walang katapat na presyo — kaya hinahanap ang presyo
// AYON SA TEKSTO ng linya, hindi ayon sa posisyon sa loob ng pangkat.
export function repriceProducts(
  prods: MtoProduct[],
  lineParts: (number | null)[],
  items: { description: string; unitPrice: number }[],
): MtoProduct[] {
  let cursor = 0;
  return prods.map((p, pi) => {
    const grouped = groupProductLines(p);
    const slice = lineParts.slice(cursor, cursor + grouped.length);
    cursor += grouped.length;
    // teksto ng bullet → presyo, mula sa hiwa ng produktong ito
    const priceOf = new Map<string, number>();
    grouped.forEach((line, i) => {
      const v = slice[i];
      if (typeof v === "number" && v > 0 && line.startsWith("• ")) {
        priceOf.set(line.slice(2).trim().toLowerCase(), v);
      }
    });
    const lines = (p.build?.lines ?? []).map((l) => {
      const key = String(l.label).replace(/^[•·-]\s*/, "").trim().toLowerCase();
      const v = priceOf.get(key);
      return typeof v === "number" ? { ...l, price: v } : { ...l, price: undefined };
    });
    return { ...p, build: { ...(p.build ?? {}), lines, total: items[pi]?.unitPrice ?? 0, priced: true } };
  });
}


// ANG BUONG DOKUMENTO na binubuo mula sa mga produkto — lahat ng pangkat,
// pinagdugtong ng blangkong linya, eksaktong porma ng document editor.
//
// Ginagamit para malaman kung TALAGANG binago ng team ang teksto: kapag
// tugma ito sa nasa editor, walang idinagdag na kahulugan ang pag-iimbak ng
// kopya — at ang naka-pako na kopya ay hindi na sumusunod sa pagbabago ng
// pagpapangkat sa hinaharap.
export function groupedFromProducts(r: Parameters<typeof mtoProducts>[0]): string {
  return mtoProducts(r)
    .map((p) => groupProductLines(p).join("\n"))
    .join("\n\n");
}

// ANG PINAL NA LINYA KADA PRODUKTO. Ang docLines ay ang buong dokumento gaya
// ng nasa editor — blangkong linya sa pagitan ng produkto — at ang docSpans
// ang bilang ng linya ng bawat produkto. ANG SPANS ANG HATI, HINDI ANG "":
// may blangkong linya rin SA LOOB ng produkto (sa pagitan ng THE ITEM,
// ADD-ONS at DOUBLE WALLING), kaya ang paghula sa "" ay naghahati sa maling
// lugar — nakita iyon bilang 30 cell na puro blangko.
//
// Kapag hindi tugma ang spans sa bilang ng produkto o sa haba ng docLines
// (luma o sira ang imbak), ang binuo ang masusunod: mas mabuting mawala ang
// pag-aayos ng teksto kaysa mapunta sa maling produkto ang buong pangkat.
export function productDocLines(
  r: Parameters<typeof mtoProducts>[0] & { build?: { docLines?: string[]; docSpans?: number[] } },
): { p: MtoProduct; lines: string[] }[] {
  const prods = mtoProducts(r);
  const manual = r.build?.docLines;
  const spans = r.build?.docSpans;
  if (manual?.length && spans?.length === prods.length) {
    const expected = spans.reduce((a, b) => a + b, 0) + (prods.length - 1);
    if (manual.length === expected) {
      let at = 0;
      return prods.map((p, i) => {
        const lines = manual.slice(at, at + spans[i]);
        at += spans[i] + 1; // laktawan ang separator
        return { p, lines };
      });
    }
  }
  return prods.map((p) => ({ p, lines: groupProductLines(p) }));
}
