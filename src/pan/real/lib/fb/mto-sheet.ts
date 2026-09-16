import { mtoProducts } from "@/lib/build-lines";
import { bodySections, packMessages } from "./echo-chunks";

// ANG MTO SHEET — IISANG PORMA PARA SA LAHAT NG MESSENGER SEND.
//
// Ito ang naka-kahong monospace na sheet na kilala na ng team: header
// ("<customer> · via panfurniture.ph", MADE-TO-ORDER REQUEST, Ref #), ang
// bawat produkto nang pangkat-pangkat (THE ITEM / ADD-ONS / DOUBLE WALLING),
// ORDER, CUSTOMER, at "Sent from panfurniture.ph · oras". Dating nakasulat
// sa loob ng FB webhook lang; nang gumawa ng hiwalay na alerto para sa staff,
// ibang porma ang lumabas (may link sa IMS, walang larawan) at agad itong
// napansin — "eto ung standard natin". Kaya isang builder: ang echo sa
// customer thread at ang alerto sa staff thread ay hindi na maghihiwalay.
//
// Nagbabalik ng LISTAHAN ng mensahe — hinahati ng packMessages sa hangganan
// ng produkto para hindi tumama sa 2,000-char limit ng Send API. Ang larawan
// ay hiwalay na ipinapadala ng caller bago ang sheet.
export type MtoSheetRow = {
  mto_number: string | null;
  product_name: string | null;
  sku: string | null;
  category: string | null;
  image_url: string | null;
  build: Record<string, unknown>;
  customer_name: string | null;
  contact: string | null;
  address: string | null;
};

export function buildMtoSheet(row: MtoSheetRow, fallbackItem = "Custom build"): string[] {
  const build = (row.build ?? {}) as { size?: string; fabric?: string; lines?: { label: string; price?: number }[]; total?: number; priced?: boolean };
  // MARAMING PRODUKTO KADA REQUEST: ang mtoProducts() ay nagbabalik ng
  // listahan kahit luma pa ang hugis ng row, kaya iisa ang landas dito.
  const prods = mtoProducts({
    sku: row.sku ?? null,
    product_name: row.product_name ?? null,
    category: row.category ?? null,
    image_url: row.image_url ?? null,
    build: build as Parameters<typeof mtoProducts>[0]["build"],
  });
  const multi = prods.length > 1;
  const words = (v: string) => v.toLowerCase().replace(/[^a-z ]/g, " ").split(/\s+/).filter(Boolean);
  // Laktawan ang Category kapag halos kapareho na ito ng Item (hal.
  // "Custom Bed" vs "Costumized Bed") — redundant sa mata ng nagbabasa.
  // Ang substring lang ay hindi sapat: ang "Costumized Bed" at "Custom
  // Bed" ay hindi naglalaman ng isa't isa, pero pareho silang sinasabi.
  // Redundant kapag (a) bawat salita ng kategorya ay nasa item na, o
  // (b) pareho sila ng uri — ang huling salita ("bed", "sofa").
  const isRedundant = (itemName: string, cat: string) => {
    const a = words(itemName);
    const b = words(cat);
    if (!a.length || !b.length) return false;
    if (b.every((w) => a.includes(w))) return true;
    return a[a.length - 1] === b[b.length - 1];
  };
  const group = (title: string, items: string[]) => (items.length ? [title, ...items.map((x) => `• ${x}`)] : []);

  // PANGKAT-PANGKAT, hindi isang mahabang listahan. Ang mensaheng ito ang
  // madalas na tanging binabasa bago mag-presyo, kaya ang magkakauri ay
  // magkakasama: ang kama, ang mga idinagdag dito, at ang double walling na
  // may sariling sukat. Sa maraming produkto, ang pagpapangkat ay nasa LOOB
  // ng bawat produkto — kung pinagsama-sama, hulaan na kung aling dingding
  // ang sa aling kama.
  const productBlock = (p: (typeof prods)[number]): string[] => {
    const raw = (p.build?.lines ?? []).map((l) => String(l.label).replace(/^[•·-]\s*/, "").trim()).filter(Boolean);
    // Sukat ng produkto (numero + unit) = bahagi ng THE ITEM, hindi ADD-ONS
    // (2026-09-05: "End to End: 34 inches" ay lumalabas dating dagdag).
    const UNIT_RE = /:\s*\d+(?:\.\d+)?\s*(?:"|″|in\b|inch(?:es)?\b|cm\b|ft\b)/i;
    const isBed = (l: string) => /^(size|fabric)\b/i.test(l) || (UNIT_RE.test(l) && !isWall(l));
    // Ang Height/Thickness/Width ay pag-aari ng dingding — pero kapag walang
    // double walling, ang mga ito ay sukat ng ibang bagay (hal. Wall Padding),
    // kaya ang buong pangkat ay nabubuo lang kapag may Double Walling.
    // Height/Thickness/Width ng dingding = ang mga KASUNOD ng Double walling
    // (2026-09-04); ang nauuna ay sukat ng produkto mismo (Width/Length/Height).
    const wallIdx = raw.findIndex((l) => /^double walling\b/i.test(l));
    const hasWall = wallIdx >= 0;
    const isWall = (l: string) =>
      hasWall && (/^(double walling|frame dimension|decorative nails|gold accent)\b/i.test(l) || (/^(height|thickness|width)\b/i.test(l) && raw.indexOf(l) > wallIdx));
    const bedLines = raw.filter(isBed);
    const wallLines = raw.filter(isWall);
    const rest = raw.filter((l) => !isBed(l) && !isWall(l));
    // WALANG Size/Fabric ANG IBANG PRODUKTO (side table: taas at kulay ng
    // kahoy lang). Doon, ang mga natitira ANG produkto — hindi "ADD-ONS".
    // Kung hindi, "ADD-ONS: Height" ang mababasa ng team, na parang may
    // pangunahing bahagi pang nawawala.
    const bed = bedLines.length ? bedLines : rest;
    const addonLines = bedLines.length ? rest : [];
    const price = p.build?.priced && p.build?.total ? `• Price (site estimate): ₱${Number(p.build.total).toLocaleString()}` : null;
    if (!raw.length) return ["• Custom build", ...(price ? [price] : [])];
    return [
      // "THE ITEM", hindi "THE BED" — ang parehong echo ay ginagamit ng
      // Wall Padding, Sofa at Ottoman.
      ...group("THE ITEM", bed),
      ...(addonLines.length ? ["", ...group("ADD-ONS", addonLines)] : []),
      ...(wallLines.length ? ["", ...group("DOUBLE WALLING", wallLines)] : []),
      ...(multi && price ? ["", price] : []),
    ];
  };


  const head = ["MADE-TO-ORDER REQUEST"];
  if (row.mto_number) head.push(`Ref #: ${row.mto_number}`);
  if (multi) head.push(`${prods.length} products`);
  const itemName = row.product_name || fallbackItem;
  if (!multi) {
    const cat = row.category ?? "";
    if (cat && !isRedundant(itemName, cat)) head.push(`Category: ${cat}`);
    head.push(`Item: ${itemName}`);
    if (row.sku) head.push(`SKU: ${row.sku}`);
  }

  // Ang kabuuan ng request — suma ng mga produkto kapag marami.
  const reqTotal = multi ? prods.reduce((s, p) => s + (Number(p.build?.total) || 0), 0) : Number(build.total) || 0;
  const reqPriced = multi ? prods.every((p) => p.build?.priced) : !!build.priced;
  const orderLines = [
    multi ? `Items: ${prods.length}` : "Qty: 1",
    reqPriced && reqTotal ? `${multi ? "Estimate" : "Price (site estimate)"}: ₱${reqTotal.toLocaleString()}` : "Pricing: for quotation",
  ];

  // LAHAT NG PRODUKTO, WALANG TAKIP. Dating walo lang ang ipinapakita
  // dahil pinuputol ng Messenger ang mahabang mensahe — pero ang
  // packMessages sa ibaba ay humahati na sa hangganan ng produkto, kaya
  // ang 30 produkto ay walong buong mensahe, hindi isang putol. Ang team
  // ay hindi na kailangang lumipat sa IMS para makita ang ika-siyam.
  const body2 = multi
    ? [
        ...prods.flatMap((p, i) => {
          const nm = (p.name ?? p.sku ?? "Item").toUpperCase();
          const cat = p.category ?? "";
          const title = `${i + 1} · ${nm}${p.sku ? `  ${p.sku}` : ""}`;
          return [
            ...(i ? [""] : []),
            title,
            ...(cat && !isRedundant(p.name ?? "", cat) ? [`Category: ${cat}`] : []),
            ...productBlock(p),
          ];
        }),
        "",
        ...group("ORDER", orderLines),
      ]
    : [...productBlock(prods[0]), "", ...group("ORDER", orderLines)];

  const cust: string[] = [];
  if (row.customer_name) cust.push(`• Name: ${row.customer_name}`);
  if (row.contact && !/^messenger$/i.test(row.contact)) cust.push(`• Mobile: ${row.contact}`);
  if (row.address) cust.push(`• Address: ${row.address}`);

  // Footer — pinanggalingan at oras, gaya ng mock ("Sent from
  // panfurniture.ph · Aug 18, 2:41 PM"), sa oras ng Pilipinas.
  const stamp = new Date().toLocaleString("en-PH", {
    timeZone: "Asia/Manila",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
  // MONOSPACE BLOCK (gaya ng mock): binabalot sa triple-backtick para
  // nirerender ng Messenger na naka-kahon at fixed-width — pantay ang
  // hanay ng mga bullet at madaling kopyahin ng team.
  //
  // HATI SA ILANG MENSAHE (2026-08-22). Ang Send API ay tumatanggap lang
  // ng 2,000 character kada mensahe; ang walong produkto ay ~3,900. Ang
  // sobra ay TINATANGGIHAN nang buo (error 100) at ang tanging bakas ay
  // isang console.warn sa server — walang dumarating sa thread, walang
  // nagsasabi kanino man. Gumana ito noong kaunti ang produkto, kaya
  // mukhang "nasira" nang dumami. Ang hati ay sa hangganan ng SEKSYON
  // (header, bawat produkto, ang dulo) — hindi sa gitna ng produkto, para
  // hindi maghiwalay ang kama at ang double walling nito.
  return packMessages([
    `${row.customer_name || "Customer"} · via panfurniture.ph\n\n${head.join("\n")}`,
    ...bodySections(body2),
    [...(cust.length ? ["CUSTOMER", cust.join("\n"), ""] : []), `Sent from panfurniture.ph · ${stamp}`].join("\n"),
  ]);
}

export const isPublicUrl = (u: string) => /^https:\/\//i.test(u) && !/localhost|127\.0\.0\.1/i.test(u);
