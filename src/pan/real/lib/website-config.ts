// Website MTO Configurator — shared types + category templates (Phase 1).
// Ang template ang default na sizes/add-ons ng bagong item config; lahat ay
// editable ng team sa /website/configurator (dagdag/bawas/presyo/toggle).

export type ConfigSize = { label: string; price: number | null; on: boolean };
// Sukat na ina-adjust ng customer sa site (steppers ±½) — galing sa parehong
// category field lists ng IMS guided specs (SPEC_FIELDS).
export type ConfigMeasure = { label: string; def: number | null; unit: string; on: boolean };
export type ConfigAddon = {
  label: string;
  // ADD-ON = checkbox na may +presyo · CHOICE = pipiliin, karaniwang libre ·
  // FIELD = free-text ng customer · FIXED = as-is na sukat/detalye (display).
  type: "ADD-ON" | "CHOICE" | "FIELD" | "FIXED";
  price: number | null;
  // CHOICE lang: presyo KADA pagpipilian, naka-index sa pagkakasunod ng
  // "A/B/C" sa label. Kung wala, ang `price` ang ginagamit para sa lahat —
  // na tama sa "Winged/Not winged" pero mali sa "None/2\"/4\"/6\"", kung saan
  // ang None ay dapat libre at tumataas ang bayad kada pulgada.
  prices?: (number | null)[];
  on: boolean;
};
export type ItemConfig = {
  sku: string;
  category: string;
  name: string;
  customizable: boolean; // false = as-is/locked page (Add to cart lang)
  published: boolean; // false = draft, hindi pa ginagamit ng site
  sizes: ConfigSize[];
  measurements?: ConfigMeasure[]; // customer-adjustable na sukat (±½ steppers)
  addons: ConfigAddon[];
  fabricsOff: string[]; // LEGACY: swatch names na naka-off (lahat-allowed maliban dito)
  // FABRICS TOGGLE (2026-08-23): `fabricsOn` = may pagpipiliang tela/kulay ang
  // item (false = walang Fabric field sa site, hal. Mattress). `fabricsPick` =
  // ALLOW-LIST ng swatch names — default WALA, ang admin ang pipili. Kapag wala
  // ang dalawang field (lumang config) → legacy: lahat maliban sa fabricsOff.
  fabricsOn?: boolean;
  fabricsPick?: string[];
  // LISTING (2026-08-23): copy at tag ng listing sa site - dati sa Website >
  // Products lang. Opsyonal: ang lumang config ay wala nito; ang Publish ay
  // nagsusulat lang ng mga field na may halaga (tingnan ang listingForPublish).
  listing?: ListingCopy;
  // FRAME DIAGRAM (2026-08-23): ang A-E ng Dimensions tab sa site ay hango sa
  // Sizes + measurements (tingnan ang deriveBedSizes); dito ang allowance at
  // override kada size. Opsyonal - default ang ginagamit kapag wala.
  frame?: FrameConfig;
};

// IMS category → collection ng site (slug + nav groups). Ginagamit ng
// Configurator Publish at ng Link dropdown ng Website editor. Ang wala sa
// mapa ay sina-slugify (lalabas via /collections/<slug>, walang nav group).
// listed:false = may page pa rin, pero wala sa nav/tiles/footer.
export const SITE_CATEGORY: Record<string, { slug: string; groups: string[]; listed?: boolean }> = {
  "Promo Bed": { slug: "bed", groups: ["beds"] },
  "Custom Bed": { slug: "customized-bed", groups: ["beds"] },
  Mattress: { slug: "mattress", groups: ["beds"] },
  "Sofa Bed": { slug: "sofa-bed", groups: ["beds", "sofas"] },
  Sofa: { slug: "sofa", groups: ["sofas", "living"] },
  "Accent Chair": { slug: "accent-chair", groups: ["sofas", "living"] },
  "Dining Table": { slug: "dining-table", groups: ["dining"] },
  "Dining Chair": { slug: "dining-chairs", groups: ["dining"] },
  Barstool: { slug: "barstool", groups: ["dining"] },
  "Side Table": { slug: "side-table", groups: ["living"] },
  Ottoman: { slug: "ottoman-ph", groups: ["living"] },
  "Swivel Chair": { slug: "swivel-chair", groups: ["living"] },
  "Wall Padding": { slug: "wall-padding", groups: [], listed: false },
};

export type FrameConfig = {
  widthAdd?: number;   // frame = lapad ng kutson + ito (default 4")
  lengthAdd?: number;  // frame = haba ng kutson + ito (default 6")
  legs?: number;       // E - taas ng paa (default 4")
  overrides?: Record<string, Partial<Record<"A" | "B" | "C" | "D" | "E", string>>>; // kada size label
};
export type BedSizeRow = { size: string; dim: string; A: string; B: string; C: string; D: string; E: string; enabled: boolean };

export type ListingCopy = {
  description?: string;
  dimensions?: string;
  materials?: string;
  care?: string;
  featured?: boolean;
  isNew?: boolean;
  compareAtPrice?: number | null; // dating presyo (may guhit sa site); null = tanggalin
};

const S = (label: string): ConfigSize => ({ label, price: null, on: true });
const A = (label: string, type: ConfigAddon["type"] = "ADD-ON"): ConfigAddon => ({ label, type, price: null, on: true });
const M = (label: string, def: number | null = null, unit = "in"): ConfigMeasure => ({ label, def, unit, on: true });

// 6 wood stains ni Yuzawa (2026-08-19) — buong listahan para maging tunay na
// dropdown options sa site (hinahati ng storefront sa "/").
const WOOD_STAIN_CHOICE = "Wood Stain: Jacobian/Dark Mahogany/Chestnut Brown/Dark Oak/Midtone Mahogany/Light Oak";

// Measurement fields kada category — kapareho ng IMS guided specs (SPEC_FIELDS
// sa line-items-editor); defaults mula sa team/mock.
// LENGTH + WIDTH sa lahat (Joe 2026-09-04): kasama sa bawat category, walang
// default (mula sa Product Management ang halaga) - ito ang W×D ng site
// (Will it fit, Overall dimensions) kasama ang taas.
const LW = () => [M("Length"), M("Width")];
export const CATEGORY_MEASUREMENTS: Record<string, ConfigMeasure[]> = {
  "Promo Bed": [...LW(), M("Headboard Height"), M("Bedframe Height"), M("Mattress Insert")],
  "Custom Bed": [...LW(), M("Headboard Height"), M("Bedframe Height"), M("Mattress Insert")],
  Sofa: [...LW(), M("Total Height", 34), M("Armrest Height", 24), M("Armrest Thickness"), M("Backrest Thickness"), M("Seat depth", 22), M("Legs")],
  "Sofa Bed": [...LW(), M("Total Height", 34), M("Armrest Height", 24), M("Armrest Thickness"), M("Backrest Thickness"), M("Seat depth", 22), M("Legs", 4)],
  Ottoman: [...LW(), M("Total Height", 16), M("Seat depth", 18)],
  "Dining Chair": [...LW(), M("Total Height", 36), M("Seat Height", 18), M("Seat Depth / Diameter", 17), M("Back Cushion Thickness", 3)],
  Barstool: [...LW(), M("Bar Counter Height", 34.5), M("End to End", 45, "cm"), M("Total Height", 34), M("Backrest to Seat", 55, "cm")],
  "Accent Chair": [...LW(), M("Height", 30), M("Backrest Thickness", 5), M("Backrest to Seat", 20), M("Seat Height", 17)],
  "Side Table": [...LW(), M("Height", 20), M("Depth", 16)],
  "Wall Padding": [M("Length"), M("Height", 96), M("Width", 120)],
  // Idinagdag 2026-08-23 para sa measure diagram ng site - dating walang sukat.
  "Dining Table": [M("Length", 72), M("Width", 36), M("Height", 30)],
  "Swivel Chair": [...LW(), M("Total Height", 38), M("Seat Height", 18), M("Seat Width", 20), M("Base Diameter", 26)],
  // Mattress: WALANG adjustable na sukat — ang kapal (T) ay nakatali sa Model
  // (Comfort Plus 6", Trill Hybrid 10"); tingnan ang mattressThickness().
};

// Kapal ng kutson mula sa isang label ('Thickness: 10"', 'Trill Hybrid 10"')
// o sa pangalan ng item/modelo ng Uratex (Linen by PAN catalog) kapag walang
// numero. Null = hindi alam.
export function mattressThickness(label: string): number | null {
  const m = /(\d+(?:\.\d+)?)\s*(?:"|″|in\b)/i.exec(label ?? "");
  if (m) return Number(m[1]);
  const t = label ?? "";
  if (/trill\s*hybrid/i.test(t)) return 10;
  if (/trill\s*regal/i.test(t)) return 9;
  if (/trill\s*air/i.test(t)) return 5;
  if (/comfort\s*plus/i.test(t)) return 6;
  if (/airlite/i.test(t)) return 6;
  return null;
}

// Default sizes/add-ons kada category — hango sa team rules (mock 2026-08-20).
// Ang wala sa listahan ay nagsisimula sa blangkong sizes/add-ons.
export const CATEGORY_TEMPLATES: Record<string, { sizes: ConfigSize[]; addons: ConfigAddon[] }> = {
  "Promo Bed": {
    sizes: [S("Single 36X75"), S("Twin 48X75"), S("Double/Full 54X75"), S("Queen 60X75")],
    // Kapareho ng Add Product (line-items-editor) — ang naka-encode doon ang
    // dapat na makita ng customer dito, kaya iisa ang listahan.
    addons: [
      A("Lift Storage"), A("2 built-in drawers"), A("4 built-in drawers"), A("1 big drawer"), A("1 small drawer"),
      A("Pullout 30X70"), A("Pullout 36X70"), A("Pullout 48X70"), A("Pullout 54X70"),
      A("Tufted Footboard"),
      A("Drawer Position: Left/Right/Footboard", "CHOICE"),
      A("Fabric: Beige/Gray", "CHOICE"),
      A("Design: Banana/Pumpkin/Pineapple", "CHOICE"),
      A("Legs: Standard/Platform Style/Floating", "CHOICE"),
      A('Mattress Insert: None/4"/5"/6"', "CHOICE"),
      A("Double Walling"),
    ],
  },
  "Custom Bed": {
    sizes: [S("Single 36X75"), S("Twin 48X75"), S("Double/Full 54X75"), S("Queen 60X75"), S("King 1 72X78"), S("King 2 72X78")],
    // Ang Legs, Mattress Insert at Double Walling ay hiniling ng team
    // (2026-08-21). Ang Floating legs at ang mattress insert ay parehong
    // nagbabawal ng storage add-ons — nasa banReason() ng storefront ang
    // pagpapatupad, dito ang listahan lang.
    addons: [
      A("Lift Storage"), A("2 built-in drawers"), A("4 built-in drawers"), A("1 big drawer"), A("1 small drawer"),
      A("Pullout 30X70"), A("Pullout 36X70"), A("Pullout 48X70"), A("Pullout 54X70"),
      A("Tufted Footboard"), A("Tufted Elevated Footboard"),
      A("Drawer Position: Left/Right/Footboard", "CHOICE"),
      A("Headboard: With Headboard/None Headboard", "CHOICE"),
      A("Winged: Winged/Not winged", "CHOICE"),
      A("Legs: Standard/Platform Style/Floating", "CHOICE"),
      A('Mattress Insert: None/4"/5"/6"', "CHOICE"),
      A("Exceed Headboard: None/2\"/4\"/6\"", "CHOICE"),
      A("Double Walling"),
    ],
  },
  Sofa: {
    sizes: [S("2-Seater"), S("3-Seater"), S("L-Shape")],
    addons: [A("Legs: Wood/Box/Tooth/Round/Metal", "CHOICE"), A("Fabric — no leather", "FIELD")],
  },
  "Sofa Bed": {
    sizes: [S("Standard"), S("Wide")],
    addons: [A("Legs: Standard/Round", "CHOICE"), A("Fabric — no leather", "FIELD")],
  },
  Ottoman: {
    sizes: [S("16x18 Standard"), S("20x20 Large")],
    addons: [A("With Storage — platform style"), A('Legs 4"', "CHOICE")],
  },
  "Dining Table": {
    sizes: [S("4 Seater — 4ft x 3ft"), S("6 Seater — 5ft x 3ft"), S("8 Seater — 6–6.5ft x 3ft"), S("10 Seater — 8ft x 3ft")],
    addons: [A("Glass Top"), A("Marble"), A(WOOD_STAIN_CHOICE, "CHOICE"), A("Top Material / Finish", "FIELD"), A('Table Height 30"', "FIXED")],
  },
  "Dining Chair": {
    sizes: [S("Standard")],
    addons: [A(WOOD_STAIN_CHOICE, "CHOICE"), A("Upholstered seat"), A("Back cushion (with wood)")],
  },
  Barstool: {
    sizes: [S("Standard")],
    addons: [A(WOOD_STAIN_CHOICE, "CHOICE"), A("Upholstered Finish", "FIELD"), A('Sizes: 34½"/45cm/34"/55cm', "FIXED")],
  },
  "Accent Chair": {
    sizes: [S("Standard")],
    addons: [A("Frame: Wood/Metal", "CHOICE"), A("Swivel base"), A("Ottoman pair")],
  },
  "Side Table": {
    sizes: [S("16x16"), S("18x18"), S("20x20")],
    addons: [A(WOOD_STAIN_CHOICE, "CHOICE"), A("Drawer")],
  },
  Mattress: {
    sizes: [S("Single 36X75"), S("Twin 48X75"), S("Double/Full 54X75"), S("Queen 60X75"), S("King 72X78")],
    // Linen by PAN catalog: BAWAT MODELO AY SARILING ITEM (Comfort Plus 6",
    // Trill Hybrid 10", Airlite Wind 6", Trill Air 5", Trill Regal 9") — hindi
    // choice. Ang kapal ay FIXED na detalye ng item; i-edit ang numero dito.
    addons: [A('Thickness: 6"', "FIXED")],
  },
  "Swivel Chair": {
    sizes: [S("Standard")],
    addons: [A("Fabric — the only thing that changes", "FIELD"), A("Sizes as-is: 34/6/24/18/28/32", "FIXED")],
  },
  "Wall Padding": {
    sizes: [S("Per panel 24x96")],
    // Kapareho ng Add Product (SPEC_FIELDS): Height, Width, at ang tela.
    addons: [A("LED strip"), A("Style: Classic/Channel/Grid", "CHOICE"), A("Upholstered Finish", "FIELD")],
  },
};

// SPECS -> SUKAT. Ang isang linya ng specs ay "Label: 34 inches" o "Legs: 4
// inches — Standard"; ang unang numero pagkatapos ng tutuldok ang sukat. Ang
// hindi numero ("Fabric: Tanya Beige 201") ay nilalaktawan.
export function measuresFromSpecs(specs: string | null | undefined): Map<string, number> {
  const out = new Map<string, number>();
  for (const raw of String(specs ?? "").split("\n")) {
    const line = raw.trim().replace(/^[\u2022\u00b7-]\s*/, "");
    const i = line.indexOf(":");
    if (i < 1) continue;
    const label = line.slice(0, i).trim();
    const m = /(-?\d+(?:\.\d+)?)/.exec(line.slice(i + 1));
    if (!label || !m) continue;
    const n = Number(m[1]);
    if (Number.isFinite(n)) out.set(label.toLowerCase(), n);
  }
  return out;
}

// Isinasapaw ang sukat mula sa specs ng IMS sa isang measurements list. Ang
// label na wala sa specs ay hindi ginagalaw — mananatili ang dating halaga
// kaysa maging blangko.
export function applySpecMeasures<T extends { label?: unknown; def?: unknown }>(
  measurements: T[],
  specs: string | null | undefined,
): T[] {
  const found = measuresFromSpecs(specs);
  if (!found.size) return measurements;
  return measurements.map((m) => {
    const key = String(m?.label ?? "").trim().toLowerCase();
    return found.has(key) ? { ...m, def: found.get(key)! } : m;
  });
}

// Idinadagdag ang mga sukat ng template na WALA pa sa config ng item (hal. ang
// bagong Length/Width, 2026-09-04) - hindi hinahawakan ang mga meron na; ang
// halaga ng bago ay mula sa specs ng Product Management kung meron.
export function mergeTemplateMeasures<T extends { label?: unknown; def?: unknown }>(
  measurements: T[] | null | undefined,
  category: string,
  specs?: string | null,
): T[] {
  const cur = Array.isArray(measurements) ? measurements : [];
  const have = new Set(cur.map((m) => String(m?.label ?? "").trim().toLowerCase()));
  const add = (CATEGORY_MEASUREMENTS[category] ?? []).filter((m) => !have.has(m.label.toLowerCase())).map((m) => ({ ...m })) as unknown as T[];
  return add.length ? applySpecMeasures([...cur, ...add], specs) : applySpecMeasures(cur, specs);
}

// OVERALL W×D×H PARA SA SITE (2026-09-04): mula sa specs ng Product Management
// ("Width: 34 inches", "Length: 24 inches", "Total Height: 28 inches") ang
// isang linyang '34"W x 24"D x 28"H' na binabasa ng Will-it-fit at ng Overall
// dimensions ng product page. cm/ft ay ginagawang pulgada. Null = kulang.
export function dimensionsFromSpecs(specs: string | null | undefined): string | null {
  const lines = String(specs ?? "").split("\n");
  const get = (re: RegExp): number | null => {
    for (const raw of lines) {
      const i = raw.indexOf(":");
      if (i < 1) continue;
      const label = raw.slice(0, i).trim().replace(/^[\u2022\u00b7-]\s*/, "");
      if (!re.test(label)) continue;
      const m = /(\d+(?:\.\d+)?)\s*(cm|ft|inches|inch|in|"|″)?/i.exec(raw.slice(i + 1));
      if (!m) continue;
      let n = Number(m[1]);
      const u = (m[2] ?? "").toLowerCase();
      if (u === "cm") n = n / 2.54; else if (u === "ft") n = n * 12;
      if (n > 0) return Math.round(n * 10) / 10;
    }
    return null;
  };
  const w = get(/^(width|end to end|seat width|frame width.*)$/i);
  const d = get(/^(length|depth|seat depth(?: \/ diameter)?)$/i);
  const h = get(/^(total height|height|headboard height|table height|bar counter height)$/i);
  if (!w || !h) return null;
  return d ? `${w}"W x ${d}"D x ${h}"H` : `${w}"W x ${h}"H`;
}

// Bagong config ng item — template ng category kung meron, blangko kung wala.
// ANG SUKAT AY GALING SA SPECS NG PRODUKTO (2026-08-26), hindi sa template:
// ang default (Accent Chair 30"/5"/20"/17") ay lumalabas sa product page bilang
// tunay na sukat, kaya bawat bagong produkto ay mali hangga't hindi na-Save sa
// Product Management. Ang template ay panakip na lang kapag walang specs.
export function seedItemConfig(sku: string, category: string, name: string, specs?: string | null): ItemConfig {
  const t = CATEGORY_TEMPLATES[category];
  return {
    sku,
    category,
    name,
    customizable: true,
    published: false,
    sizes: t ? t.sizes.map((s) => ({ ...s })) : [],
    measurements: applySpecMeasures((CATEGORY_MEASUREMENTS[category] ?? []).map((m) => ({ ...m })), specs),
    addons: t ? t.addons.map((a) => ({ ...a })) : [],
    fabricsOff: [],
    // Bagong item: walang kulay hangga't hindi pinipili ng admin.
    fabricsOn: false,
    fabricsPick: [],
  };
}

// Pinapayagan ba ang swatch na ito para sa item? (Hindi kasama ang leather
// ban ng category — hiwalay iyon.) Iisang batas para sa IMS at sa site.
export function fabricAllowed(cfg: Pick<ItemConfig, "fabricsOn" | "fabricsPick" | "fabricsOff">, name: string): boolean {
  if (cfg.fabricsOn === false) return false;
  if (Array.isArray(cfg.fabricsPick)) return cfg.fabricsPick.includes(name);
  return !(cfg.fabricsOff ?? []).includes(name);
}

// ISANIB ANG BAGONG TEMPLATE ADD-ON SA NAKA-SAVE NANG CONFIG (2026-08-23).
//
// Ang config ng item ay KOPYA ng template noong una itong binuksan - kaya kapag
// may idinagdag sa CATEGORY_TEMPLATES (hal. "4 built-in drawers"), hindi ito
// lumilitaw sa mga item na na-configure na. Ang "Reset to template" ay
// bubura ng presyo at toggle; ito ay hindi: idinadagdag lang ang wala pa,
// presyo blangko at nakabukas, sa puwesto nito sa template (pagkatapos ng
// pinakamalapit na naunang template label na naroon na). Walang ginagalaw sa
// mga umiiral, kasama ang custom rows ng team. Idempotent.
export function mergeTemplateAddons(cfg: ItemConfig): ItemConfig {
  const tpl = CATEGORY_TEMPLATES[cfg.category]?.addons ?? [];
  if (!tpl.length) return cfg;
  const norm = (l: string) => l.trim().toLowerCase();
  const addons = cfg.addons.map((a) => ({ ...a }));
  const has = (label: string) => addons.some((a) => norm(a.label) === norm(label));
  // CHOICE = iisang grupo kada pangalan ("Model: …"): kapag may "Model" na ang
  // config (kahit ibang options/label), huwag magdagdag ng pangalawang Model.
  const groupOf = (label: string) => { const m = /^([^:]+):/.exec(label); return m ? norm(m[1]) : ""; };
  // Pareho sa FIXED na may halaga ("Thickness: 6"") — ang in-edit na numero ay
  // hindi dapat madagdagan ng panibagong "Thickness: 6"" sa bawat pagbukas.
  const hasGroup = (t: ConfigAddon) => (t.type === "CHOICE" || t.type === "FIXED") && !!groupOf(t.label) && addons.some((a) => a.type === t.type && groupOf(a.label) === groupOf(t.label));
  let changed = false;
  tpl.forEach((t, ti) => {
    if (has(t.label) || hasGroup(t)) return;
    // Puwesto: pagkatapos ng huling naunang template add-on na nasa config na.
    let at = -1;
    for (let k = ti - 1; k >= 0; k--) {
      const idx = addons.findIndex((a) => norm(a.label) === norm(tpl[k].label));
      if (idx >= 0) { at = idx; break; }
    }
    addons.splice(at >= 0 ? at + 1 : addons.length, 0, { ...t });
    changed = true;
  });
  return changed ? { ...cfg, addons } : cfg;
}

// Ang isusulat ng Publish sa web_products mula sa Listing ng config: ang mga
// field LANG na may halaga. Ang undefined ay "hindi ginalaw dito" - nananatili
// ang nasa listing (na-edit man sa Products o sa nakaraang publish). Ang null
// na compareAtPrice ay sinasadyang pagtanggal, kaya isinusulat.
export function listingForPublish(listing: ListingCopy | undefined): Partial<ListingCopy> {
  const out: Partial<ListingCopy> = {};
  if (!listing) return out;
  (Object.keys(listing) as (keyof ListingCopy)[]).forEach((k) => {
    const v = listing[k];
    if (v !== undefined) (out as Record<string, unknown>)[k] = v;
  });
  return out;
}

// A-E NG FRAME DIAGRAM mula sa config - hindi na manu-manong table (2026-08-23).
//
// Ang Dimensions tab ng site ay may diagram na may A Width / B Headboard Height /
// C Length / D Base / E Legs kada size. Dati ay fixed na table (o default sa
// code) na hindi sumusunod sa Sizes ng Configurator. Ngayon:
//   size   = bawat naka-on na size na may NxM sa label ("Queen 60X75")
//   dim    = 60"x75"
//   A      = lapad + widthAdd (default 4)     C = haba + lengthAdd (default 6)
//   B      = measurement "Headboard Height" default (48 kung wala)
//   D      = measurement "Bedframe Height" default (12 kung wala)
//   E      = frame.legs (4 kung wala)
// Ang override kada size (frame.overrides[label][col]) ang panghuli. Ang mga
// default ay ang eksaktong dating table (Single A40 B48 C81 D12 E4) para walang
// magbago sa site sa unang publish.
export function deriveBedSizes(cfg: ItemConfig): BedSizeRow[] {
  const f = cfg.frame ?? {};
  const wAdd = f.widthAdd ?? 4, lAdd = f.lengthAdd ?? 6, legs = f.legs ?? 4;
  const meas = (label: RegExp, fallback: number) => {
    const m = (cfg.measurements ?? []).find((x) => label.test(x.label));
    return m && m.def != null && m.def > 0 ? m.def : fallback;
  };
  const hb = meas(/headboard\s*height/i, 48);
  const base = meas(/bedframe\s*height|base\s*height/i, 12);
  const inch = (n: number) => (Number.isInteger(n) ? String(n) : String(n)) + "\"";
  const out: BedSizeRow[] = [];
  for (const sz of cfg.sizes) {
    if (!sz.on) continue;
    const m = /(\d+)\s*X\s*(\d+)/i.exec(sz.label);
    if (!m) continue;
    const W = Number(m[1]), L = Number(m[2]);
    const name = sz.label.replace(m[0], "").replace(/\s+/g, " ").trim().toUpperCase() || sz.label.toUpperCase();
    const o = f.overrides?.[sz.label] ?? {};
    out.push({
      size: name, dim: W + "\"x" + L + "\"",
      A: o.A ?? inch(W + wAdd), B: o.B ?? inch(hb), C: o.C ?? inch(L + lAdd), D: o.D ?? inch(base), E: o.E ?? inch(legs),
      enabled: true,
    });
  }
  return out;
}
