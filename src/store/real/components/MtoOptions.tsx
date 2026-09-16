"use client";

// MADE-TO-ORDER OPTIONS PANEL (Phase 2, 2026-08-20) — ito ang lumalabas sa
// product page kapag ang item ay may PUBLISHED config sa IMS (Website → MTO
// Configurator, website_item_config). Pumapalit ito sa classic na price/
// colors/sizes/add-ons/buy blocks ng ProductDetail.
//
// Mga patakaran (approved mock):
// • Sizes at CHOICE options = one-line enterprise dropdown (label kaliwa,
//   napili sa gitna, presyo kasama, ✓ sa panel).
// • Fabric = dropdown panel na may search + collection chips + swatch cards
//   na may pangalan; ang fabricsOff at ang leather ban (Sofa/Sofa Bed) ay
//   galing sa config/team rules.
// • Lahat ng on-sizes may presyo → running total + Add to cart / Buy now.
//   May blankong presyo → "Price upon quotation" + Request a Quote
//   (Messenger; papalitan ng MTO webhook sa Phase 3).

import Image from "next/image";
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { formatPrice, swatchLibrary, type LibrarySwatch, type Product, type SiteContent } from "@/lib/products";
import type { MtoAddon, MtoItemConfig } from "@/lib/content";
import { messengerHandle } from "@/lib/messenger";
import { useStore, type QuoteBuild } from "@/components/store";
import { WALL_THICKNESSES, frameFor, frameLabel } from "@/lib/double-walling";

// Kolek­syon mula sa pangalan ng swatch ("New Sahara" = dalawang salita).
const colOf = (n: string) => {
  const w = n.trim().split(/\s+/);
  return w[0]?.toLowerCase() === "new" && w[1] ? `${w[0]} ${w[1]}` : (w[0] ?? "");
};
const COLLECTION_ORDER = ["leather", "tanya", "cairo", "madrid", "sofia", "bristol", "lafayette", "feather", "velbert", "tahoe", "new sahara"];
const colRank = (c: string) => {
  const i = COLLECTION_ORDER.indexOf(c.toLowerCase());
  return i < 0 ? 999 : i;
};
// Team rule: bawal ang leather sa Sofa at Sofa Bed.
const noLeatherCategory = (c: string) => c === "Sofa" || c === "Sofa Bed";

// ½-FRACTION display (parehong gawi ng IMS): 3.5 → "3 ½", ±½ ang steps.
function fmtHalf(n: number): string {
  if (!isFinite(n) || n <= 0) return "0";
  const w = Math.floor(n);
  const fr = n - w;
  if (Math.abs(fr - 0.5) < 0.001) return w ? `${w} ½` : "½";
  return String(n);
}
function parseHalf(v: string): number {
  const s = String(v ?? "").trim();
  if (!s) return 0;
  const half = /½/.test(s) || /\b1\/2\b/.test(s) ? 0.5 : 0;
  const m = /([\d.]+)/.exec(s.replace(/\b1\/2\b/, "").replace(/½/, ""));
  return (m ? parseFloat(m[1]) : 0) + half;
}

function SwatchTile({ s, className }: { s: LibrarySwatch; className?: string }) {
  if (s.swatch)
    return (
      <span className={`relative block ${className ?? ""}`}>
        <Image src={s.swatch} alt={s.name} fill className="object-cover" sizes="92px" />
      </span>
    );
  return <span className={`block ${className ?? ""}`} style={{ backgroundColor: s.color ?? "#ddd" }} />;
}

// ── Enterprise dropdown: centered value, chevron kanan, panel na may ✓ ──
function Dropdown({
  label,
  value,
  placeholder,
  options,
  onPick,
  clearable,
}: {
  label: string;
  value: string;
  placeholder: string;
  // `ban`: dahilan kung bakit hindi pwede ang option na ito ngayon. Ipinapakita
  // pa rin ito — ang nakadimming na pagpipilian ay nagsasabi kung ano ang
  // magagawa kapag inalis ang humaharang; ang tahimik na pagtatago ay hindi.
  options: { label: string; note?: string; ban?: string | null }[];
  onPick: (v: string) => void;
  clearable?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);
  const cur = options.find((o) => o.label === value);
  return (
    <div className="grid grid-cols-[110px_1fr] items-center gap-3 py-1.5">
      <span className="text-sm text-stone">{label}</span>
      <div ref={ref} className="relative">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className={`relative w-full rounded-lg border bg-transparent px-9 py-2.5 text-center text-sm font-semibold transition-colors ${open ? "border-cognac ring-2 ring-cognac/20" : "border-sand hover:border-stone/50"}`}
        >
          {cur ? (
            <>
              {cur.label}
              {cur.note && <span className="ml-1.5 text-xs font-medium text-stone">{cur.note}</span>}
            </>
          ) : (
            <span className="font-normal text-stone/70">{placeholder}</span>
          )}
          <span className={`absolute right-3 top-1/2 -translate-y-1/2 text-stone transition-transform ${open ? "rotate-180" : ""}`}>▾</span>
        </button>
        {open && (
          <div className="absolute left-0 right-0 top-full z-30 mt-1.5 max-h-60 overflow-auto rounded-lg border border-sand bg-white p-1 shadow-xl">
            {clearable && (
              <button type="button" onClick={() => { onPick(""); setOpen(false); }} className="relative w-full rounded-md px-8 py-2 text-center text-sm text-stone/70 hover:bg-linen">
                {placeholder}
                {!value && <span className="absolute right-2.5 top-1/2 -translate-y-1/2 font-bold text-cognac">✓</span>}
              </button>
            )}
            {options.map((o) => {
              const on = o.label === value;
              return (
                <button
                  key={o.label}
                  type="button"
                  disabled={!!o.ban}
                  title={o.ban ?? undefined}
                  onClick={() => { if (o.ban) return; onPick(o.label); setOpen(false); }}
                  className={`relative w-full rounded-md px-8 py-2 text-center text-sm ${o.ban ? "cursor-not-allowed opacity-40" : "hover:bg-linen"} ${on ? "bg-linen font-bold" : ""}`}
                >
                  {o.label}
                  {o.note && !o.ban && <span className="ml-1.5 text-xs text-stone">{o.note}</span>}
                  {o.ban && <span className="ml-1.5 text-[11px] text-stone/70">— {o.ban}</span>}
                  {on && <span className="absolute right-2.5 top-1/2 -translate-y-1/2 font-bold text-cognac">✓</span>}
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

export default function MtoOptions({ cfg, product, site, locked }: { cfg: MtoItemConfig; product: Product; site: SiteContent; locked?: boolean }) {
  const { addToCart, toggleWishlist, wishlist, quote, addToQuote, clearQuote } = useStore();
  // MARAMING PRODUKTO KADA REQUEST (2026-08-21). Ang editId ay may laman kapag
  // binubuksang muli ang naka-save nang build — pinapalitan ito imbes na
  // magdagdag ng pangalawang kopya.
  const [editId, setEditId] = useState<string | null>(null);
  const [added2, setAdded2] = useState(false);
  const router = useRouter();
  const wished = wishlist.includes(product.slug);

  // ── Options mula sa config ──
  const sizes = cfg.sizes.filter((s) => s.on && s.label.trim());
  const addons = cfg.addons.filter((a) => a.on && a.label.trim());
  // Ang mga detalye ng dingding ay ipinapakita ng Double Walling block mismo,
  // kaya hindi na sila inuulit sa pangkalahatang listahan — iisang tanong,
  // iisang bayad. Ang presyo nila ay binabasa pa rin mula sa config.
  const isWallDetail = (l: string) => /^(wall thickness|decorative nails|gold accent)/i.test(l);
  const choices = addons.filter((a) => a.type === "CHOICE" && !isWallDetail(a.label));
  const checks = addons.filter((a) => a.type === "ADD-ON" && !isWallDetail(a.label));
  const fixed = addons.filter((a) => a.type === "FIXED");

  // CHOICE GROUPING (2026-08-20): ang "Legs: Standard" at "Legs: Round" ay
  // IISANG "Legs" dropdown na may dalawang option — hindi tag-isang dropdown.
  // Suportado rin ang single row na "Legs: Standard/Round" (hinahati sa "/").
  type ChoiceOpt = { value: string; full: string; price: number | null };
  const choiceGroups: { name: string; options: ChoiceOpt[] }[] = [];
  for (const c of choices) {
    const m = /^([^:]+):\s*(.+)$/.exec(c.label);
    const gname = m ? m[1].trim() : choiceName(c);
    const optsRaw = m ? m[2].split("/").map((s) => s.trim()).filter(Boolean) : [c.label];
    let g = choiceGroups.find((x) => x.name.toLowerCase() === gname.toLowerCase());
    if (!g) {
      g = { name: gname, options: [] };
      choiceGroups.push(g);
    }
    // Ang bawat pagpipilian ay may sariling presyo kapag may `prices`; kung
    // wala, ang iisang `price` ang para sa lahat — na tama sa "Winged/Not
    // winged" pero mali sa "None/2\"/4\"": doon, ang None ay dapat libre.
    optsRaw.forEach((o, i) => {
      const per = c.prices?.[i];
      g!.options.push({ value: o, full: m ? `${gname}: ${o}` : c.label, price: per !== undefined ? per : (c.price ?? null) });
    });
  }
  // "NONE" SA BAWAT CHOICE (Joe 2026-09-12): ang bawat dropdown ay
  // kailangang masagot bago makapag-proceed, pero ang ilan ay talagang
  // walang gusto ang customer (walang drawer, walang winged). Kaya may
  // "None" na unang option, libre, sa grupong wala pang none/not/without —
  // sagot ito (hindi na "Still needed"), pero hindi isinusulat sa sheet.
  for (const g of choiceGroups) {
    if (g.options.some((o) => /^(none|not|without)/i.test(o.value))) continue;
    g.options.unshift({ value: "None", full: `${g.name}: None`, price: 0 });
  }

  // Priced mode: LAHAT ng on-sizes may presyo (>0). Kung walang size rows,
  // priced kapag may base price ang product.
  const priced = sizes.length ? sizes.every((s) => (s.price ?? 0) > 0) : product.price > 0;

  // ── Fabric library — tanggal ang naka-off at ang leather kung bawal ──
  const fabrics = useMemo(
    () =>
      swatchLibrary
        .filter((l) => (cfg.fabricsOn === false ? false : Array.isArray(cfg.fabricsPick) ? cfg.fabricsPick.includes(l.name) : !cfg.fabricsOff.includes(l.name)))
        .filter((l) => !(noLeatherCategory(cfg.category) && /leather/i.test(l.name)))
        .sort((a, b) => colRank(colOf(a.name)) - colRank(colOf(b.name)) || a.name.localeCompare(b.name, undefined, { numeric: true })),
    [cfg],
  );
  const collections = useMemo(() => Array.from(new Set(fabrics.map((l) => colOf(l.name)))), [fabrics]);

  // FIELD rows — itago ang fabric/upholstery na free-text kapag may fabric
  // picker na (doble kung hindi); ang iba (hal. Top Material) ay lalabas.
  const fields = addons
    .filter((a) => a.type === "FIELD")
    .filter((f) => !(fabrics.length > 0 && /fabric|upholster/i.test(f.label)));

  // ── State ──
  const measures = (cfg.measurements ?? []).filter((m) => m.on && m.label.trim());
  const [measVal, setMeasVal] = useState<Record<string, number>>(() => {
    const init: Record<string, number> = {};
    for (const m of measures) init[m.label] = m.def ?? 0;
    return init;
  });
  // DIMENSIONS TAB (2026-08-23): sumusunod ang frame diagram (B headboard, D
  // base) sa mismong measurement na itinakda ng customer - parehong event-style
  // ng pb-size-change. Ang tab ay ibang component (ProductTabs), kaya window
  // event ang tulay.
  useEffect(() => {
    window.dispatchEvent(new CustomEvent("pan-measure-change", { detail: measVal }));
  }, [measVal]);
  const [size, setSize] = useState(sizes[0]?.label ?? "");
  // Napiling option kada choice group (value = option value, hal. "Standard").
  const [choiceSel, setChoiceSel] = useState<Record<string, string>>({});
  const [checkPick, setCheckPick] = useState<Record<string, boolean>>({});
  const [fieldVal, setFieldVal] = useState<Record<string, string>>({});
  // MARAMIHANG TELA (team, 2026-08-21): iisang tela ang dating kaya, kaya ang
  // kamang may ibang tela sa headboard ay hindi maisusulat. Bawat pili ay may
  // katabing parte, para hindi maghula ang workshop kung saan napupunta ang
  // pangalawang tela.
  const [fabrics_, setFabrics_] = useState<{ name: string; part: string }[]>([]);
  // Ang Promo Bed ay dalawang kulay lang ang inaalok — walang paghahalo.
  const maxFabrics = /promo/i.test(cfg.category ?? "") ? 1 : 3;
  const FABRIC_PARTS = ["Whole bed", "Headboard", "Frame", "Footboard"];
  // DOUBLE WALLING — ang kapal ng dingding ang nagdedesisyon ng sukat ng FRAME.
  const [dwThick, setDwThick] = useState(8);
  const [dwH, setDwH] = useState("");
  const [dwPad, setDwPad] = useState("");
  const [dwW, setDwW] = useState("");
  const [dwNails, setDwNails] = useState("");
  const [dwAccent, setDwAccent] = useState(false);

  // PRESYO MULA SA CONFIGURATOR, hindi hard-coded — ang mga detalye ng dingding
  // ay tunay na option sa MTO Configurator, kaya doon nagmumula ang halaga.
  const dwOpt = (group: string) => cfg.addons.find((a) => a.on !== false && new RegExp(`^${group}`, "i").test(a.label));
  const dwPriceAt = (group: string, i: number) => {
    const a = dwOpt(group);
    if (!a) return 0;
    const per = a.prices?.[i];
    return (per !== undefined && per !== null ? per : a.price) ?? 0;
  };

  // STEPPER — − / halaga / + at unit, kapareho ng guided measurements sa app.
  // Ang text input ay tumatanggap ng kahit ano; ang stepper ay hindi.
  function Stepper({ value, onChange }: { value: string; onChange: (v: string) => void }) {
    // KALAHATING PULGADA ang hakbang, gaya ng ibang measurement dito — ang
    // kapal ng dingding ay bihirang buong pulgada.
    const cur = parseHalf(value) || 0;
    const bump = (d: number) => onChange(fmtHalf(Math.max(0, cur + d * 0.5)));
    const btn = "flex h-9 w-8 items-center justify-center rounded-lg border border-sand text-base font-bold text-stone transition-colors hover:border-cognac hover:bg-linen";
    return (
      <span className="inline-flex items-stretch gap-1">
        <button type="button" onClick={() => bump(-1)} className={btn}>−</button>
        <input
          value={value === "" ? "0" : value}
          // Tinatanggap ang "3", "3.5", "3 ½" at "3 1/2".
          onChange={(e) => onChange(e.target.value.replace(/[^\d.½/ ]/g, ""))}
          inputMode="decimal"
          // Ang blangko ay ipinapakitang 0 (o ang sinusundan nitong sukat), hindi
          // placeholder — ang halagang nakikita ang siyang naitatala.
          className={`h-9 w-16 rounded-lg border border-sand bg-transparent px-2 text-center text-sm font-bold outline-none focus:border-cognac ${value === "" ? "text-stone/60" : ""}`}
        />
        <button type="button" onClick={() => bump(1)} className={btn}>+</button>
        <span className="flex h-9 items-center rounded-lg bg-espresso px-2.5 text-[10px] font-extrabold text-white">in</span>
      </span>
    );
  }
  // Ang unang tela ang siyang "ang tela" sa buod at sa presyo.
  const fabric = fabrics_.length ? fabrics_[0].name : "";
  const [fabOpen, setFabOpen] = useState(false);
  const [fabQ, setFabQ] = useState("");
  const [fabCol, setFabCol] = useState("");
  const [qty, setQty] = useState(1);
  // ADD-ONS card collapse (mock: − HIDE / + SHOW)
  const [addOpen, setAddOpen] = useState(true);
  const [added, setAdded] = useState(false);
  const fabRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!fabOpen) return;
    const close = (e: MouseEvent) => {
      if (fabRef.current && !fabRef.current.contains(e.target as Node)) setFabOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [fabOpen]);

  const selFabric = fabrics.find((l) => l.name === fabric) ?? null;

  // ── BUILT-IN CATEGORY RULES (team, parehong nasa IMS builder/mock) ──
  // Lift Storage = Platform Style base → bawal drawers/pullout (Tufted lang);
  // pullout dapat kasya sa lapad ng size; leather ↔ Lift ban; drawers /
  // pullout / footboard = tig-iisang pipiliin; below Queen = drawers O
  // pullout lang, hindi pareho.
  const bedW = (() => {
    const m = /(\d+)\s*X\s*\d+/i.exec(size || "");
    return m ? +m[1] : 99;
  })();
  const isLift = (l: string) => /lift/i.test(l);
  const isDrawer = (l: string) => /drawer/i.test(l);
  const isPullout = (l: string) => /pullout/i.test(l);
  // 4 built-in drawers (2026-08-23) - "4 built-in drawers" sa IMS config, "4 pcs
  // Built-in Side Drawers" sa product page. Katumbas ng lib/bed-rules sa IMS.
  const isFourDrawers = (l: string) => /(^|\D)4\s*(pcs\.?\s*)?(built-?in\s*)?(side\s*)?drawers?\b/i.test(l);
  const isFootboard = (l: string) => /tufted|footboard/i.test(l);
  const isDoubleWall = (l: string) => /double wall/i.test(l);
  const liftOn = checks.some((a) => isLift(a.label) && checkPick[a.label]);
  const fourOn = checks.some((a) => isFourDrawers(a.label) && !!checkPick[a.label]);
  const otherAddonOn = checks.some((a) => !isFourDrawers(a.label) && !!checkPick[a.label]);
  const leatherFabric = fabrics_.some((f) => /leather/i.test(f.name));

  // Ang piniling halaga ng isang choice group. Ang paghahanap ay HINDI eksakto:
  // ang team ay maaaring "Legs: Standard/Floating" ang isulat (group = "Legs")
  // o "Floating Legs" lang (group = "Floating Legs"), kaya sinasapat na
  // makapaloob ang salita. Kung eksakto ang hinahanap, tahimik na hindi
  // tumatalab ang restriction sa mga item na iba ang pagkakasulat.
  // Ang EKSAKTONG tugma ang nauuna bago ang naglalaman lang: ang "Exceed
  // Headboard" ay naglalaman din ng "headboard", at kung ito ang unang
  // makikita, ang sagot doon ang mababasa bilang sagot sa Headboard —
  // "Exceed: None" ay magiging "walang headboard".
  const findGroup = (q: string) => {
    const t = q.toLowerCase();
    return choiceGroups.find((x) => x.name.toLowerCase() === t)
      ?? choiceGroups.find((x) => x.name.toLowerCase().startsWith(t))
      ?? choiceGroups.find((x) => x.name.toLowerCase().includes(t));
  };
  const pick = (group: string) => {
    const g = findGroup(group);
    return g ? (choiceSel[g.name] ?? "") : "";
  };
  // Ang buong tekstong sinasagot ng isang grupo — kasama ang pangalan nito,
  // dahil sa "None Headboard" ay ang PANGALAN mismo ang nagsasabi ng sagot.
  const pickFull = (group: string) => {
    const g = findGroup(group);
    if (!g) return "";
    const v = choiceSel[g.name] ?? "";
    return v ? `${g.name} ${v}` : "";
  };
  // FLOATING LEGS = nakabitin ang frame, kaya walang mapaglalagyan ng anumang
  // storage (team, 2026-08-21).
  const floatingLegs = /floating/i.test(pickFull("legs"));
  // MATTRESS INSERT = ang kutson ay nakalubog sa frame; nauubos nito ang lalim
  // na kailangan ng drawer o pullout. Ang "None" ay hindi insert.
  const mattressInsert = /(^|\s)(4|5|6)"/.test(pickFull("mattress insert"));
  // Totoo kapag "None" ang sagot sa headboard, kahit "None Headboard" ang
  // buong pangalan ng grupo at iyon din ang tanging pagpipilian.
  const noHeadboard = /none/i.test(pickFull("headboard"));
  const isStorage = (l: string) => isLift(l) || isDrawer(l) || isPullout(l);
  const doubleWallOn = checks.some((a) => isDoubleWall(a.label) && checkPick[a.label]);
  // Ang double walling ay platform ang pagkakagawa — walang ibang paa ang
  // pumapasok dito (team, 2026-08-21). Hindi ito pinipili; sinusunod.
  // Ang Lift Storage at ang Double Walling ay parehong platform ang
  // pagkakagawa (team, 2026-08-21). Pwede silang magkasama; alinman sa kanila
  // ang nagtatakda ng legs.
  const platformForced = doubleWallOn || liftOn;

  function banReason(label: string): string | null {
    // 4 BUILT-IN DRAWERS: Full Double, Queen, King lang; at "no other add-ons
    // will reflect after 4 drawers" - magkabilang panig ang harang para hindi
    // makalusot ang isa habang nakapili ang isa.
    if (isFourDrawers(label) && bedW < 54) return "Full Double, Queen or King only";
    if (fourOn && !isFourDrawers(label)) return "no other add-ons will reflect with 4 built-in drawers";
    if (isFourDrawers(label) && otherAddonOn) return "remove the other add-ons first";
    if (isLift(label) && leatherFabric) return "not available with leather fabric — change the fabric first";
    if ((isDrawer(label) || isPullout(label)) && liftOn) return "not available with Lift Storage (Tufted only)";
    if (isStorage(label) && floatingLegs) return "not available with floating legs — nothing to mount it on";
    if (isStorage(label) && mattressInsert) return "not available with a mattress insert — the insert takes the depth";
    if (isPullout(label)) {
      const m = /(\d+)\s*X\s*\d+/i.exec(label);
      if (m && +m[1] >= bedW) return `does not fit ${size.split(" ")[0] || "this size"}`;
    }
    return null;
  }

  // BAWAL NA CHOICE OPTION. Ang mga choice ay dropdown, kaya ang bawal ay
  // hindi ipinapakita bilang pagpipilian sa halip na tanggihan pagka-pindot.
  function choiceBan(group: string, value: string): string | null {
    // WALANG HEADBOARD = walang mabibigyan ng pakpak, at wala ring maaaring
    // lumagpas dito (team, 2026-08-21).
    if (/wing/i.test(group) && /wing/i.test(value) && !/not|without|none/i.test(value) && noHeadboard) {
      return "needs a headboard";
    }
    // WALANG HEADBOARD = walang lalagpasan.
    if (/^exceed/i.test(group) && noHeadboard) return "needs a headboard";
    // DOUBLE WALLING = platform ang pagkakagawa; wala nang ibang paa.
    if (/leg/i.test(group) && !/platform/i.test(value) && platformForced) {
      return doubleWallOn ? "double walling is platform style" : "lift storage is platform style";
    }
    // Ang storage na napili na ang humaharang sa floating legs at sa insert —
    // hindi kabaligtaran, para hindi mag-away ang dalawang panig.
    const storagePicked = checks.some((a) => isStorage(a.label) && !!checkPick[a.label]);
    // SAAN ILALAGAY ANG DRAWER. Ang tanging bawal ay ang hiniling ng team
    // (2026-08-21): sa Twin at Single, hindi kasya ang DALAWANG drawer sa
    // footboard — ang gilid ay pwede pa rin, at ang isahang drawer sa
    // footboard ay pwede rin. Walang ibang harang dito.
    if (/drawer position|footboard drawer/i.test(group) && /footboard/i.test(value) && bedW <= 48) {
      const twoDrawers = checks.some((a) => /2 built-in drawers/i.test(a.label) && !!checkPick[a.label]);
      if (twoDrawers) return `two drawers do not fit the footboard on ${size.split(" ")[0] || "this size"}`;
    }
    if (/leg/i.test(group) && /floating/i.test(value) && storagePicked) {
      return "remove the storage add-on first";
    }
    if (/mattress insert/i.test(group) && /^(4|5|6)/.test(value) && storagePicked) {
      return "remove the storage add-on first";
    }
    return null;
  }

  // AUTO-LAPSE: kapag naging bawal ang isang napiling choice dahil sa ibang
  // pagbabago (hal. inalis ang headboard habang naka-Winged), inaalis ito —
  // kung hindi, tahimik itong pumapasok sa build at sa presyo.
  useEffect(() => {
    for (const g of choiceGroups) {
      const v = choiceSel[g.name];
      if (v && choiceBan(g.name, v)) setChoiceSel((p) => ({ ...p, [g.name]: "" }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [noHeadboard, floatingLegs, mattressInsert, doubleWallOn, checkPick]);

  // DOUBLE WALLING → Platform Style. Hiniling ng team na awtomatiko ito
  // ("matic din po sana"), hindi lang bawal ang iba — kaya itinatakda mismo.
  useEffect(() => {
    if (!platformForced) return;
    const g = choiceGroups.find((x) => /leg/i.test(x.name));
    if (!g) return;
    const platform = g.options.find((o) => /platform/i.test(o.value));
    if (platform && choiceSel[g.name] !== platform.value) {
      setChoiceSel((p) => ({ ...p, [g.name]: platform.value }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [platformForced]);


  // Effective pick = naka-check AT hindi banned (auto-lapse kapag nag-iba
  // ang size/fabric/lift at naging bawal).
  const isPicked = (label: string) => !!checkPick[label] && !banReason(label);
  function toggleCheck(label: string) {
    if (banReason(label)) return;
    setCheckPick((p) => {
      const next = { ...p, [label]: !p[label] };
      if (next[label]) {
        // Tig-iisa kada grupo: drawers, pullout, footboard.
        const clearGroup = (test: (l: string) => boolean) => {
          for (const a of checks) if (a.label !== label && test(a.label)) next[a.label] = false;
        };
        if (isDrawer(label)) clearGroup(isDrawer);
        if (isPullout(label)) clearGroup(isPullout);
        if (isFootboard(label)) clearGroup(isFootboard);
        // Below Queen (lapad < 60): drawers O pullout lang — hindi pareho.
        if (bedW < 60) {
          if (isDrawer(label)) clearGroup(isPullout);
          if (isPullout(label)) clearGroup(isDrawer);
        }
      }
      return next;
    });
  }

  // ── Presyo ──
  const sizePrice = sizes.find((s) => s.label === size)?.price ?? (sizes.length ? 0 : product.price);
  const pickedChoices = choiceGroups
    .map((g) => g.options.find((o) => o.value === choiceSel[g.name]))
    .filter((o): o is ChoiceOpt => !!o);
  // Ang mga detalye ng dingding ay wala sa `checks`/`choices` (tingnan ang
  // isWallDetail), kaya sila ang idinadagdag dito nang hiwalay — binabayaran
  // pa rin sila.
  const wallTotal = doubleWallOn
    ? dwPriceAt("wall thickness", WALL_THICKNESSES.indexOf(dwThick as (typeof WALL_THICKNESSES)[number])) +
      (dwNails ? dwPriceAt("decorative nails", dwNails === "Gold" ? 0 : 1) : 0) +
      (dwAccent ? (dwOpt("gold accent")?.price ?? 0) : 0)
    : 0;
  const addonTotal =
    checks.reduce((sum, a) => (isPicked(a.label) && a.price ? sum + a.price : sum), 0) +
    pickedChoices.reduce((sum, o) => sum + (o.price ?? 0), 0) +
    wallTotal;
  const total = (sizePrice ?? 0) + addonTotal;

  // ── Build summary (cart lines / quote ref) ──
  const pickedAddonLines = [
    // Ang Double Walling ay may sariling pangkat na sa itaas (kapal, frame,
    // sukat ng dingding) — ang checkbox label ay pag-uulit lang.
    ...checks
      .filter((a) => isPicked(a.label) && !isDoubleWall(a.label))
      .map((a) => ({ label: a.label, price: a.price ?? 0 })),
    // Ang "None" ay pagtanggi sa option, hindi sagot — walang saysay itong
    // isulat sa sheet ("Mattress Insert: None" ay hindi nagsasabi ng gagawin).
    ...pickedChoices
      .filter((o) => !/^(none|not|without)/i.test(o.value))
      .map((o) => ({ label: o.full, price: o.price ?? 0 })),
  ];
  const fieldLines = fields
    .filter((f) => (fieldVal[f.label] ?? "").trim())
    .map((f) => ({ label: `${f.label}: ${fieldVal[f.label].trim()}`, price: 0 }));
  const measureLines = measures
    .filter((m) => (measVal[m.label] ?? 0) > 0)
    .map((m) => ({ label: `${m.label}: ${fmtHalf(measVal[m.label])} ${m.unit}`, price: 0 }));

  function handleAdd(buyNow: boolean) {
    const baseLabel = [fabric || null, size || null].filter(Boolean).join(" / ") || product.name;
    const addOnLines = [...measureLines, ...pickedAddonLines, ...fieldLines];
    const variantKey = addOnLines.length ? `${baseLabel} + ${addOnLines.map((a) => a.label).join("+")}` : baseLabel;
    addToCart(product.slug, variantKey, qty, total, {
      baseLabel,
      basePrice: sizePrice ?? 0,
      addOns: addOnLines,
    });
    if (buyNow) router.push("/checkout");
    else {
      setAdded(true);
      setTimeout(() => setAdded(false), 2000);
    }
  }

  const handle = messengerHandle((site as unknown as { social?: { facebook?: string } }).social?.facebook);

  // ── REQUEST A QUOTE (Phase 3): ipadala ang build sa PAN app → MTO ref →
  // Messenger redirect (ref mto_<MTO-000042>; fallback mto_<slug>). ──
  // Shipping estimator state — nauuna dahil ginagamit ng quote validation.
  const SHIP_PROVINCES = ((site as unknown as { shipping?: { provinces?: { name: string; cities: { name: string; fee: number }[] }[] } }).shipping?.provinces ?? []);
  const [shipOpen, setShipOpen] = useState(false);
  const [shipProvince, setShipProvince] = useState("");
  const [shipCity, setShipCity] = useState("");
  const shipCityList = SHIP_PROVINCES.find((p) => p.name === shipProvince)?.cities ?? [];
  const shipFee = shipCityList.find((c) => c.name === shipCity)?.fee ?? null;

  const [quoteSending, setQuoteSending] = useState(false);
  // Live na listahan ng kulang — nag-a-update habang pumipili ang customer,
  // kaya alam agad kung bakit naka-disable ang Request a Quote.
  const [missingNow, setMissingNow] = useState<string[]>([]);
  // REQUIRED BAGO MAG-QUOTE (2026-08-20): kulang ang quotation kapag walang
  // sukat/tela/opsyon o walang delivery location — hindi malalagyan ng
  // shipping fee ang quote. Ipinapakita ang kulang bago pa mag-submit.
  const [quoteErr, setQuoteErr] = useState<string[]>([]);
  // Kulang sa BUILD lang — walang delivery. Ito ang sinusuri ng "Add to
  // request": ang lugar ay pag-aari ng buong request, hindi ng bawat produkto,
  // kaya walang saysay itanong sa bawat pagdagdag.
  function missingForBuild(): string[] {
    const miss: string[] = [];
    if (sizes.length > 0 && !size) miss.push("Size");
    if (fabrics.length > 0 && !fabric) miss.push("Fabric");
    for (const g of choiceGroups) if (!choiceSel[g.name]) miss.push(g.name);
    for (const m of measures) if (!(measVal[m.label] > 0)) miss.push(m.label);
    for (const f of fields) if (!(fieldVal[f.label] ?? "").trim()) miss.push(f.label.split("—")[0].split(":")[0].trim());
    return miss;
  }

  // DITO, HINDI SA ITAAS NG COMPONENT: binabasa nito ang sizes/fabrics/
  // choiceGroups/measures/fields, na mga const na naideklara sa ibaba ng mga
  // hook. Ang tawag bago sila mabuo ay temporal-dead-zone error na bumabagsak
  // ang BUONG page, hindi lang ang buton.
  const buildMissingNow = missingForBuild();
  // Bilang na nakasulat sa buton: ang naka-save, kasama ang nasa harap ngayon
  // kapag kumpleto ito — iyon ang talagang ipapadala.
  const quoteBtnCount = quote.length + (quote.length && buildMissingNow.length === 0 ? 1 : 0);

  // I-recompute sa bawat pagbabago ng pili (localStorage lang ang hindi
  // reactive, kaya effect — hindi puwedeng derived value lang).
  useEffect(() => {
    setMissingNow(missingForBuild());
    // eslint-disable-next-line react-hooks/exhaustive-deps
    // Wala nang shipCity/shipProvince: hindi na binabasa ng missingForBuild
    // ang lugar — sa /quote-request na iyon tinatanong.
  }, [size, fabrics_, choiceSel, measVal, fieldVal, dwThick, dwH, dwW, dwPad, dwNails, dwAccent, checkPick]);

  // DIMENSIONS TAB (2026-08-23): ang buong build (size, naka-check na add-on,
  // choice groups, double-wall, sukat) ay ibino-broadcast. Ang FrameDiagram
  // ang nagdodrowing ng bawat add-on layer nang live — bawat click, agad.
  useEffect(() => {
    window.dispatchEvent(new CustomEvent("pan-build-change", {
      detail: {
        size,
        checks: checks.filter((a) => isPicked(a.label)).map((a) => a.label),
        choices: choiceSel,
        dw: { thick: dwThick, h: dwH, pad: dwPad, w: dwW, nails: dwNails, accent: dwAccent },
        meas: measVal,
      },
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [size, fabrics_, choiceSel, measVal, dwThick, dwH, dwW, dwPad, dwNails, dwAccent, checkPick]);

  // ANG PAGKAKASUNOD-SUNOD AY AYON SA URI, hindi ayon sa pagkakasulat sa
  // form: sukat muna, tapos tela, mga sukat ng bahagi, ang mga add-on, at
  // panghuli ang dingding — magkakasama ang magkakauri kaya nababasa.
  //
  // HIWALAY NA FUNCTION (2026-08-21): ginagamit ng "Add to request" at ng
  // "Request a Quote". Kapag dinoble ang kodigo, isa lang ang naaayos sa
  // susunod na pagbabago ng patakaran at tahimik na maghihiwalay sila.
  function currentBuildLines(): { label: string; price: number }[] {
    return [
      ...(size ? [{ label: `Size: ${size}`, price: sizes.find((s) => s.label === size)?.price ?? 0 }] : []),
      ...fabrics_.map((f) => ({
        label: f.part && f.part !== "Whole bed" ? `Fabric — ${f.part}: ${f.name}` : `Fabric: ${f.name}`,
        price: 0,
      })),
      ...measureLines.map((l) => ({ label: l.label, price: 0 })),
      ...pickedAddonLines.map((l) => ({ label: l.label, price: l.price })),
      ...(doubleWallOn
        ? [
            // "Double Walling" ang pangalan sa sheet, at ang kapal ang sagot —
            // walang hiwalay na linyang "Wall Thickness", kung hindi dalawang
            // beses ipapakita ang parehong bagay.
            { label: `Double Walling: ${dwThick}"`, price: dwPriceAt("wall thickness", WALL_THICKNESSES.indexOf(dwThick as (typeof WALL_THICKNESSES)[number])) },
            ...(frameLabel(size, dwThick) ? [{ label: `Frame Dimension: ${frameLabel(size, dwThick)}`, price: 0 }] : []),
            // Ang zero ay walang sukat — hindi ito isinusulat, gaya ng blangko.
            // parseHalf, hindi Number: ang "2 ½" ay NaN sa Number().
            // Parehong pangalan at parehong pagkakasunod ng nasa form — kung
            // hindi, hindi mapaghahambing ng team ang inorder sa nasa sheet.
            ...(parseHalf(dwH) > 0 ? [{ label: `Height: ${dwH.trim()} in`, price: 0 }] : []),
            ...(parseHalf(dwPad) > 0 ? [{ label: `Thickness: ${dwPad.trim()} in`, price: 0 }] : []),
            ...(parseHalf(dwW) > 0 ? [{ label: `Width: ${dwW.trim()} in`, price: 0 }] : []),
            ...(dwNails ? [{ label: `Decorative Nails: ${dwNails}`, price: dwPriceAt("decorative nails", dwNails === "Gold" ? 0 : 1) }] : []),
            ...(dwAccent ? [{ label: "Gold Accent: Yes", price: dwOpt("gold accent")?.price ?? 0 }] : []),
          ]
        : []),
      ...fieldLines.map((l) => ({ label: l.label, price: 0 })),
    ];
  }

  // Ang kasalukuyang build bilang slot ng request. Ang summary ang nasa panel —
  // sapat para makilala kung alin ito nang hindi binubuksan muli.
  function currentSlot(): Omit<QuoteBuild, "id"> {
    return {
      slug: product.slug,
      sku: cfg.sku,
      name: product.name,
      image: product.images[0] ?? null,
      category: cfg.category,
      summary: [size, ...fabrics_.map((f) => f.name)].filter(Boolean).join(" · "),
      build: { size, fabric, fabrics: fabrics_, lines: currentBuildLines(), total, priced },
      // Ang eksaktong kalagayan ng form — ito ang ibinabalik ng Edit, hindi
      // ang mga linyang pang-basa.
      state: {
        size,
        fabrics: fabrics_,
        choiceSel,
        checkPick,
        measVal,
        fieldVal,
        ...(doubleWallOn ? { dwThick, dwH, dwPad, dwW, dwNails, dwAccent } : {}),
      },
    };
  }

  // Idagdag sa listahan at ilinis ang form — nananatili ang customer sa pahina
  // at nakakapili ng susunod na produkto. WALANG delivery na tinatanong dito.
  function addToRequest() {
    const miss = missingForBuild();
    if (miss.length) {
      setQuoteErr(miss);
      return;
    }
    setQuoteErr([]);
    addToQuote({ ...currentSlot(), ...(editId ? { id: editId } : {}) });
    // PAGKATAPOS MAG-SAVE, BALIK SA LISTAHAN. Ang customer ay galing doon at
    // may isang bagay lang na inaayos; ang pananatili sa blangkong form ay
    // parang hindi natanggap ang pagbabago.
    if (editId) { window.location.href = "/quote-request"; return; }
    setAdded2(true);
    window.setTimeout(() => setAdded2(false), 1600);
  }

  // ── READY UNIT (Buy Now — ships this week) ──
  // May stock ang item: default view = ang yari nang unit (as-is specs, unit
  // price, Ships this week, Buy now); ang "MADE TO ORDER — CUSTOMIZE" button
  // ang lumilipat sa configurator, at may "BUY NOW — SHIPS THIS WEEK" pabalik.
  const px = product as unknown as { mtoReadySpecs?: string; mtoReadyPrice?: number };
  const readySpecs = String(px.mtoReadySpecs ?? "")
    .split("\n")
    .map((s) => s.trim().replace(/^[•·\-]\s*/, ""))
    .filter(Boolean);
  // MARAMIHANG SIZE (IMS 2026-08-23): "Sizes: 36x75 ₱7,100 · 48x75 ₱8,650 · …"
  // sa specs → Size dropdown; ang presyo ay sumusunod sa napiling size.
  const readySizeOpts = (() => {
    const line = readySpecs.find((l) => /^sizes:/i.test(l));
    if (!line) return [] as { label: string; price: number }[];
    return line.replace(/^sizes:\s*/i, "").split(/\s*·\s*/).map((t) => {
      const m = /^(\S+)(?:\s+₱?\s*([\d,]+(?:\.\d+)?))?/.exec(t.trim());
      return m ? { label: m[1], price: Number((m[2] ?? "0").replace(/,/g, "")) } : null;
    }).filter((x): x is { label: string; price: number } => !!x && !!x.label);
  })();
  const [readySize, setReadySize] = useState("");
  const readySizePick = readySizeOpts.find((o) => o.label === readySize) ?? readySizeOpts[0];
  // READY-UNIT FABRIC (2026-09-03, "pag nag select ako ng fabric is nandito na
  // sya automatic"): ang mga telang pinili sa Configurator ay lumalabas din sa
  // yari-nang-unit na view bilang swatch tiles - ito ang mga kulay na available
  // sa stock. Unang tela ang default; ang pili ay sumasama sa cart line.
  // COLOR VARIANTS ng Product Management (IMS 0231) ang mauuna kapag meron -
  // iyon ang may litrato kada kulay; kung wala, ang fabricsPick ng Configurator.
  const readyColors: LibrarySwatch[] = product.colorSwatches?.length
    ? product.colorSwatches.map((s) => ({ name: s.name, swatch: s.swatch ?? s.image, color: s.hex, material: s.material }))
    : fabrics;
  // STOCK KADA KULAY (IMS 0232): undefined = walang kada-kulay na bilang
  // (lumang listing) → ang kabuuang product.stock ang sinusunod.
  const colorStock = (name: string): number | undefined => product.colorSwatches?.find((s) => s.name === name)?.stock;
  const [readyFabric, setReadyFabric] = useState("");
  // Default = unang kulay na may stock; kung wala, ang una.
  const readyFabricPick =
    readyColors.find((l) => l.name === readyFabric) ??
    readyColors.find((l) => (colorStock(l.name) ?? 1) > 0) ??
    readyColors[0];
  const pickStock = readyFabricPick ? colorStock(readyFabricPick.name) : undefined;
  // Hover popup: malaking litrato ng produkto sa kulay na
  // iyon + pangalan + material - bago pa i-click.
  const [hoverFab, setHoverFab] = useState<string | null>(null);
  const previewOf = (name: string) => {
    const s = product.colorSwatches?.find((x) => x.name === name);
    return s?.images?.[0] ?? s?.image ?? s?.swatch ?? readyColors.find((l) => l.name === name)?.swatch ?? product.images[0];
  };
  const readyPrice = readySizePick && readySizePick.price > 0 ? readySizePick.price : Number(px.mtoReadyPrice ?? product.price ?? 0);
  const readyAvail = (product.stock ?? 0) > 0 && readyPrice > 0;
  // LOCKED (as-is item): laging ready/as-is view — walang customize.
  const [view, setView] = useState<"ready" | "mto">(locked || readyAvail ? "ready" : "mto");
  // Ipaalam sa ProductDetail ang view — "— Made to Order" ang title suffix
  // kapag nasa customize view (gaya ng mock).
  useEffect(() => {
    window.dispatchEvent(new CustomEvent("mto-view", { detail: locked ? "ready" : view }));
  }, [view, locked]);

  // ── EDIT: IBALIK ANG BUONG BUILD ──
  // Ang "Edit" sa /quote-request ay nagbubukas ng pahina ng produkto mismo na
  // may ?edit=<slot id>. Dito ibinabalik ang EKSAKTONG kalagayan ng form noong
  // ini-save ito — hindi mula sa build.lines (tekstong pang-basa, na sisira sa
  // unang pagbabago ng pananalita) kundi mula sa naitalang state.
  //
  // MINSAN LANG: ang listahan ay galing sa localStorage kaya blangko sa unang
  // render at may laman sa pangalawa; kung tatakbo ito tuwing magbabago ang
  // quote, ibabalik nito ang luma tuwing may ie-edit ang customer.
  const restored = useRef(false);
  useEffect(() => {
    if (restored.current || !quote.length) return;
    const want = new URLSearchParams(window.location.search).get("edit");
    if (!want) { restored.current = true; return; }
    const b = quote.find((x) => x.id === want);
    // Maling produkto ang pahina (naka-bookmark o binago ang URL) — dalhin sa
    // tamang isa nang hindi nawawala ang pagka-edit.
    if (b && b.slug !== product.slug) { window.location.replace(`/products/${b.slug}?edit=${b.id}`); return; }
    restored.current = true;
    if (!b) return;
    setEditId(b.id);
    setView("mto");
    const s = b.state;
    if (s) {
      if (s.size) setSize(s.size);
      if (s.fabrics?.length) setFabrics_(s.fabrics);
      if (s.choiceSel) setChoiceSel(s.choiceSel);
      if (s.checkPick) setCheckPick(s.checkPick);
      if (s.measVal) setMeasVal(s.measVal);
      if (s.fieldVal) setFieldVal(s.fieldVal);
      if (typeof s.dwThick === "number") setDwThick(s.dwThick);
      if (s.dwH !== undefined) setDwH(s.dwH);
      if (s.dwPad !== undefined) setDwPad(s.dwPad);
      if (s.dwW !== undefined) setDwW(s.dwW);
      if (s.dwNails !== undefined) setDwNails(s.dwNails);
      if (typeof s.dwAccent === "boolean") setDwAccent(s.dwAccent);
    } else {
      // Slot na na-save bago pa naitala ang state — ang sukat at tela lang ang
      // maibabalik. Sinasabi ito sa customer sa halip na tahimik na maghubad.
      if (b.build?.size) setSize(b.build.size);
      if (b.build?.fabrics?.length) {
        setFabrics_(b.build.fabrics.map((f, i) => ({ name: f.name, part: f.part ?? (i ? "Headboard" : "Whole bed") })));
      }
      setQuoteErr(["This saved build predates the current form — please check every option before saving."]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quote.length]);


  function handleBuyReady(buyNow: boolean) {
    const sizeLabel = readySizePick ? `Size: ${readySizePick.label}` : "";
    const fabricLabel = readyFabricPick ? `Fabric: ${readyFabricPick.name}` : "";
    const base = readySizePick ? `Ready unit — ${readySizePick.label}` : "Ready unit — as configured";
    // Iba't ibang kulay = magkahiwalay na cart line.
    const key = readyFabricPick ? `${base} — ${readyFabricPick.name}` : base;
    addToCart(product.slug, key, qty, readyPrice, {
      baseLabel: base,
      basePrice: readyPrice,
      // Litrato ng napiling kulay ang dala ng cart line (IMS 0231).
      image: readyFabricPick ? previewOf(readyFabricPick.name) ?? null : null,
      addOns: [
        // Ang Fabric/Color line ng specs ay ang buong listahan ng kulay - hindi
        // isinasama kapag may napiling kulay, para hindi doble at para ang
        // IMS ay ang napili lang ang basahin.
        ...readySpecs
          .filter((l) => !/^sizes:/i.test(l))
          .filter((l) => !(fabricLabel && /^(?:fabric(?:\s*\/\s*finish)?|upholstered finish|color)\s*:/i.test(l)))
          .map((l) => ({ label: l, price: 0 })),
        ...(sizeLabel ? [{ label: sizeLabel, price: 0 }] : []),
        ...(fabricLabel ? [{ label: fabricLabel, price: 0 }] : []),
      ],
    });
    if (buyNow) router.push("/checkout");
    else {
      setAdded(true);
      setTimeout(() => setAdded(false), 2000);
    }
  }

  // ── Shipping estimator (kapareho ng classic page; rates sa site.json) ──
  const shipBlock = (
    <div className="mt-4 text-sm">
      <button type="button" onClick={() => setShipOpen((v) => !v)} className="flex items-center gap-2 text-ink hover:text-cognac transition-colors">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.3" className="text-olive">
          <path d="M1 7h12v9H1zM13 10h5l3 3v3h-8z" />
          <circle cx="6" cy="18" r="1.8" />
          <circle cx="17" cy="18" r="1.8" />
        </svg>
        {/* READY-UNIT VIEW LANG ITO NGAYON (2026-08-22) — doon ay diretso sa
            checkout, kaya kailangang makita ang pamasahe bago mag-add to cart.
            Sa made-to-order, ang address ay tinatanong nang buo sa
            /quote-request; ang pagtatanong dito rin ay dalawang beses na
            paghingi ng parehong bagay. Kaya wala nang "optional" na tanda:
            walang hinihinging sagot, pagtataya lang ito. */}
        <span className="border-b border-ink/40">Estimate your shipping</span>
        <span className="text-stone text-xs">{shipOpen ? "▲" : "▼"}</span>
      </button>
      {shipOpen && (
        <div className="mt-3 border border-stone/25 rounded p-3 bg-linen/40 space-y-2">
          <select value={shipProvince} onChange={(e) => { setShipProvince(e.target.value); setShipCity(""); }} className="w-full border border-stone/30 bg-white px-3 py-2 text-sm rounded focus:outline-none focus:border-cognac">
            <option value="">Select province</option>
            {SHIP_PROVINCES.map((p) => (<option key={p.name} value={p.name}>{p.name}</option>))}
          </select>
          <select
            value={shipCity}
            disabled={!shipProvince}
            onChange={(e) => { setShipCity(e.target.value); try { localStorage.setItem("pan_ship_loc", JSON.stringify({ province: shipProvince, city: e.target.value })); } catch {} }}
            className="w-full border border-stone/30 bg-white px-3 py-2 text-sm rounded focus:outline-none focus:border-cognac disabled:bg-sand/40 disabled:text-stone"
          >
            <option value="">{shipProvince ? "Select city / town" : "Select a province first"}</option>
            {shipCityList.map((c) => (<option key={c.name} value={c.name}>{c.name}</option>))}
          </select>
          {shipFee !== null && (
            <div className="pt-2 border-t border-sand space-y-1.5">
              <p className="flex justify-between items-baseline">
                <span className="text-stone">Estimated shipping to {shipCity}</span>
                <span className="font-bold text-cognac">{formatPrice(shipFee)}</span>
              </p>
              <p className="text-[11px] text-stone leading-snug">
                Estimate only. Final fee is confirmed after we check your exact address — you&apos;ll pin your location at
                checkout. Far-end or boundary areas may differ.
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );

  const heartBtn = (
    <button
      onClick={() => toggleWishlist(product.slug)}
      aria-label="Add to wishlist"
      className="w-12 h-12 shrink-0 border border-sand bg-white flex items-center justify-center hover:border-goldDeep"
    >
      <svg width="20" height="20" viewBox="0 0 24 24" fill={wished ? "#B87333" : "none"} stroke={wished ? "#B87333" : "#1A1A1A"} strokeWidth="1.6">
        <path d="M12 21C7 16.5 3 13 3 8.8 3 6 5.2 4 7.8 4c1.7 0 3.2.9 4.2 2.3C13 4.9 14.5 4 16.2 4 18.8 4 21 6 21 8.8c0 4.2-4 7.7-9 12.2z" />
      </svg>
    </button>
  );

  // Availability card — nagpapalit ang delivery text ayon sa view at stock.
  // Ang napiling kulay ang masusunod kapag may kada-kulay na bilang: ubos na
  // kulay = Made to order ang card kahit may stock ang ibang kulay.
  const shipsNow = view === "ready" && (pickStock ?? product.stock ?? 0) > 0;
  // Mockup 2026-09-04: "In stock · N units" na berdeng bar + Ships this week.
  const unitsNow = pickStock ?? product.stock ?? 0;
  const etaCard = (
    <div className="mt-4 border border-sand bg-white">
      <div className={`flex items-center gap-2 px-3.5 py-2.5 text-[13px] font-semibold ${shipsNow ? "bg-[#E6F2EA] text-[#2F7D4F]" : "bg-goldSoft text-brown"}`}>
        <span className={`h-2 w-2 rounded-full ${shipsNow ? "bg-[#2F7D4F]" : "bg-goldDeep"}`} />
        {shipsNow ? `In stock · ${unitsNow} unit${unitsNow === 1 ? "" : "s"}` : "Made to order"}
      </div>
      <div className="px-3.5 py-3 text-[12.5px] text-stone">
        {shipsNow ? (
          <>
            <b className="block text-ink font-semibold text-[13.5px]">Ships this week</b>
            Ready unit — delivered and set up by our own team. Delivery fee shown at checkout.
          </>
        ) : (
          <>
            <b className="block text-ink font-semibold text-[13.5px]">Delivery in 4–6 weeks</b>
            Built in our San Pedro, Laguna workshop — delivered and set up by our own team. Delivery fee shown at checkout.
          </>
        )}
      </div>
    </div>
  );

  if (locked || view === "ready") {
    return (
      <div>
        <div className="flex items-baseline gap-3 flex-wrap border-y border-sand py-3.5 mb-4">
          <span className="text-[28px] font-semibold">{formatPrice(readyPrice)}</span>
        </div>
        {/* As-is spec sheet ng yari nang unit — MOCK STYLE: bold value + gray
            label sub, presyo/"included" sa kanan (galing sa config prices). */}
        {readySizeOpts.length > 0 && (
          <div className="rounded-lg border border-sand overflow-hidden">
            <div className="p-3 space-y-2">
              {readySpecs.map((l) => {
                const m = /^([^:]+):\s*(.+)$/.exec(l);
                const label = m ? m[1].trim() : "";
                const value = m ? m[2].trim() : l;
                // Maraming size → dropdown (presyo kada size), hindi plain na linya.
                if (/^sizes$/i.test(label) && readySizeOpts.length && /mattress/i.test(product.category)) {
                  // MATTRESS: size buttons (hindi dropdown) — kita agad lahat ng
                  // size at presyo, isang pindot lang.
                  return (
                    <div key={l} className="rounded border border-sand bg-transparent px-4 py-3 text-sm">
                      <span className="block text-xs text-stone">Size</span>
                      <div className="mt-2 flex flex-wrap gap-2">
                        {readySizeOpts.map((o) => {
                          const on = o.label === readySizePick?.label;
                          return (
                            <button
                              key={o.label}
                              type="button"
                              onClick={() => {
                                setReadySize(o.label);
                                // Sabihan ang Dimensions tab — sumusunod ang diagram/table.
                                window.dispatchEvent(new CustomEvent("pan-size-change", { detail: o.label }));
                              }}
                              className={`rounded-full border px-3 py-1.5 text-xs font-bold transition-colors ${on ? "border-espresso bg-espresso text-cream" : "border-stone/40 text-ink hover:border-ink"}`}
                            >
                              {o.label.replace(/x/i, "×")}
                              {o.price > 0 && <span className={`ml-1.5 font-normal ${on ? "text-cream/80" : "text-stone"}`}>{formatPrice(o.price)}</span>}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  );
                }
                if (/^sizes$/i.test(label) && readySizeOpts.length) {
                  return (
                    <label key={l} className="flex items-center gap-3 rounded border border-sand bg-transparent px-4 py-3 text-sm">
                      <span className="min-w-0 flex-1">
                        <select
                          value={readySizePick?.label ?? ""}
                          onChange={(e) => setReadySize(e.target.value)}
                          className="w-full bg-transparent font-bold leading-tight outline-none"
                        >
                          {readySizeOpts.map((o) => (
                            <option key={o.label} value={o.label}>{o.label.replace(/x/i, "×")}{o.price > 0 ? ` — ${formatPrice(o.price)}` : ""}</option>
                          ))}
                        </select>
                        <span className="block text-xs text-stone">Size</span>
                      </span>
                    </label>
                  );
                }
                // REDUNDANT (2026-09-03, "mas okay ba alisin dito at iwan ung
                // baba"): ang sukat at tela ay nasa Dimensions tab at sa Fabric
                // tiles na - hindi na inuulit dito. Size picker lang ang natitira.
                return null;
              })}
            </div>
          </div>
        )}
        {/* Fabric / color ng yari nang unit — ang mga telang pinili sa Configurator */}
        {readyColors.length > 0 && (
          // COLOR LINE (2026-09-03): "Color: <pangalan>" na linya, maliliit
          // na parisukat na tile ng produkto sa bawat kulay, madilim na border
          // sa napili; ang pangalan ay nagpapalit sa click.
          <div className="mt-4">
            <p className="text-[13px] font-semibold">
              Color <span className="font-normal text-stone ml-1.5">{readyFabricPick?.name ?? ""}</span>
              {pickStock !== undefined && pickStock <= 0 && <span className="ml-2 text-xs text-stone">Out of stock in this color — made to order</span>}
              {pickStock !== undefined && pickStock > 0 && pickStock <= 3 && <span className="ml-2 text-xs text-cognac">Only {pickStock} left</span>}
            </p>
            <div className="mt-2 flex flex-wrap gap-2.5">
              {readyColors.map((l) => {
                const on = l.name === readyFabricPick?.name;
                const preview = previewOf(l.name);
                const out = (colorStock(l.name) ?? 1) <= 0;
                return (
                  <div key={l.name} className="relative" onMouseEnter={() => setHoverFab(l.name)} onMouseLeave={() => setHoverFab(null)}>
                    <button
                      type="button"
                      onClick={() => {
                        setReadyFabric(l.name);
                        // Sabihan ang gallery - palit sa litrato ng kulay na ito (IMS 0231).
                        window.dispatchEvent(new CustomEvent("pan-color-change", { detail: l.name }));
                      }}
                      title={out ? `${l.name} — out of stock, made to order` : l.name}
                      aria-label={l.name}
                      className={`relative h-11 w-11 overflow-hidden rounded-full bg-white border border-sand transition ${on ? "ring-2 ring-ink ring-offset-2 ring-offset-cream" : "hover:border-stone/60"} ${out ? "opacity-50" : ""}`}
                    >
                      {preview ? (
                        <Image src={preview} alt={l.name} fill className="object-cover" sizes="44px" />
                      ) : (
                        <SwatchTile s={l} className="absolute inset-0" />
                      )}
                      {/* Ubos sa kulay na ito: pahilis na guhit */}
                      {out && <span className="pointer-events-none absolute inset-0 bg-[linear-gradient(to_top_right,transparent_calc(50%-1px),#8a8272_calc(50%-1px),#8a8272_calc(50%+1px),transparent_calc(50%+1px))]" />}
                    </button>
                    {/* Hover popup - produkto sa kulay na ito + pangalan + material */}
                    {hoverFab === l.name && preview && (
                      <div className="pointer-events-none absolute bottom-full left-0 z-30 mb-2 hidden w-56 overflow-hidden rounded-lg border border-sand bg-white shadow-2xl md:block">
                        <div className="relative aspect-square bg-white">
                          <Image src={preview} alt={l.name} fill className="object-contain p-2" sizes="224px" />
                        </div>
                        <div className="px-3 py-2">
                          <p className="text-sm font-bold leading-tight">{l.name}</p>
                          {l.material && <p className="text-xs text-stone">{l.material}</p>}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}
        {shipBlock}
        {etaCard}
        <div className="mt-3 flex gap-2.5">
          <div className="flex items-center h-12 border border-sand bg-white">
            <button onClick={() => setQty(Math.max(1, qty - 1))} className="w-10 h-full hover:text-goldDeep" aria-label="Decrease quantity">−</button>
            <span className="w-11 text-center text-sm font-semibold">{qty}</span>
            <button onClick={() => setQty(qty + 1)} className="w-10 h-full hover:text-goldDeep" aria-label="Increase quantity">+</button>
          </div>
          <button onClick={() => handleBuyReady(false)} className="flex-1 h-12 border-[1.5px] border-brown bg-white px-4 text-xs font-bold tracking-[0.14em] uppercase text-brown transition-colors hover:bg-brown hover:text-cream">
            {added ? "Added ✓" : "Add to cart"}
          </button>
          <button onClick={() => handleBuyReady(true)} className="flex-1 h-12 bg-brown px-4 text-xs font-bold tracking-[0.14em] uppercase text-cream transition-colors hover:bg-brownDeep">
            Buy now
          </button>
          {heartBtn}
        </div>
        {!locked && (
          <button
            onClick={() => setView("mto")}
            className="mt-3 flex w-full items-center justify-center gap-2 rounded border border-ink py-3 px-4 text-sm font-bold tracking-widest2 transition-colors hover:bg-ink hover:text-cream"
          >
            ✎ MADE TO ORDER — CUSTOMIZE
          </button>
        )}
      </div>
    );
  }

  return (
    <div>
      {/* MALINAW NA NAG-E-EDIT — kung hindi, mukhang bagong build ang nasa
          harap at ang "Save changes" ay parang nagdadagdag ng pangalawa. */}
      {editId && (
        <p className="mb-3 flex items-center gap-2 rounded-full border border-cognac bg-cognac/10 px-3 py-1.5 text-[11px] font-bold text-cognac">
          <span>✎ Editing item {quote.findIndex((b) => b.id === editId) + 1} of your request</span>
          <a href="/quote-request" className="ml-auto text-[10px] font-semibold underline">Back to request</a>
        </p>
      )}

      {/* ── PRICE CARD ── */}
      <div className="flex items-baseline gap-3 flex-wrap">
        {priced ? (
          <>
            <span className="text-3xl font-bold">{formatPrice(total)}</span>
            <span className="text-xs text-stone">starting · changes per size/add-on</span>
          </>
        ) : (
          <>
            <span className="text-2xl font-bold">Price upon quotation</span>
            <span className="text-xs text-stone">the team will send it via Messenger after reviewing your build</span>
          </>
        )}
      </div>
      <hr className="border-sand my-5" />

      {/* ── MEASUREMENTS — one-line ±½ steppers ("3 ½") ── */}
      {measures.length > 0 && (
        <div className="mb-3 rounded-lg border border-sand px-4 py-2">
          <p className="mb-1 text-sm">Measurements</p>
          {measures.map((m) => {
            const v = measVal[m.label] ?? 0;
            return (
              <div key={m.label} className="grid grid-cols-[110px_1fr] items-center gap-3 border-b border-dashed border-sand py-1.5 last:border-b-0">
                <span className="text-sm text-stone">{m.label}</span>
                <div className="flex max-w-[220px] items-stretch">
                  <button
                    type="button"
                    onClick={() => setMeasVal((p) => ({ ...p, [m.label]: Math.max(0, (p[m.label] ?? 0) - 0.5) }))}
                    className="w-9 rounded-l border border-sand font-bold hover:text-cognac"
                    aria-label={`Decrease ${m.label}`}
                  >
                    −
                  </button>
                  <input
                    value={fmtHalf(v)}
                    onChange={(e) => setMeasVal((p) => ({ ...p, [m.label]: parseHalf(e.target.value) }))}
                    inputMode="decimal"
                    className="w-full min-w-0 border-y border-sand bg-transparent text-center text-sm font-semibold focus:outline-none"
                  />
                  <button
                    type="button"
                    onClick={() => setMeasVal((p) => ({ ...p, [m.label]: (p[m.label] ?? 0) + 0.5 }))}
                    className="w-9 rounded-r border border-sand font-bold hover:text-cognac"
                    aria-label={`Increase ${m.label}`}
                  >
                    +
                  </button>
                  <span className="ml-2 self-center text-xs text-stone">{m.unit}</span>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ── SIZE dropdown ── */}
      {sizes.length > 0 && (
        <div className="mb-3 rounded-lg border border-sand px-4 py-2">
        <Dropdown
          label="Size"
          value={size}
          placeholder="Select size…"
          options={sizes.map((s) => ({ label: s.label, note: (s.price ?? 0) > 0 ? formatPrice(s.price!) : undefined }))}
          onPick={(v) => {
            setSize(v);
            // Pareho ng classic size chips: ang Dimensions tab (FrameDiagram)
            // ay sumusunod sa napiling size via pb-size-change.
            window.dispatchEvent(new CustomEvent("pan-size-change", { detail: v.split(" ")[0] }));
          }}
        />
        </div>
      )}

      {/* ── CHOICE dropdowns — isang dropdown kada group, options sa loob ── */}
      {choiceGroups.map((g) => (
        <div key={g.name} className="mb-3 rounded-lg border border-sand px-4 py-2">
        <Dropdown
          key={g.name}
          label={g.name}
          value={choiceSel[g.name] ?? ""}
          placeholder={`Select ${g.name.toLowerCase()}…`}
          options={g.options.map((o) => ({ label: o.value, note: (o.price ?? 0) > 0 ? `+${formatPrice(o.price!)}` : undefined, ban: choiceBan(g.name, o.value) }))}
          onPick={(v) => setChoiceSel((p) => ({ ...p, [g.name]: v }))}
          clearable
        />
        </div>
      ))}

      {/* ── FABRIC dropdown panel ── */}
      {fabrics.length > 0 && (
        <div className="mb-3 rounded-lg border border-sand px-4 py-2">
        <div className="grid grid-cols-[110px_1fr] items-center gap-3 py-1.5">
          <span className="text-sm text-stone">Fabric</span>
          <div ref={fabRef} className="relative">
            <button
              type="button"
              onClick={() => setFabOpen((v) => !v)}
              className={`relative flex w-full items-center justify-center gap-2 rounded-lg border bg-transparent px-9 py-2.5 text-sm font-semibold transition-colors ${fabOpen ? "border-cognac ring-2 ring-cognac/20" : "border-sand hover:border-stone/50"}`}
            >
              {fabrics_.length ? (
                <>
                  {fabrics_.slice(0, 3).map((f) => {
                    const lib = fabrics.find((x) => x.name === f.name);
                    return lib ? <SwatchTile key={f.name} s={lib} className="h-[18px] w-[18px] shrink-0 overflow-hidden rounded border border-black/10" /> : null;
                  })}
                  <span className="truncate">
                    {fabrics_.length === 1 ? fabrics_[0].name : `${fabrics_.length} fabrics`}
                  </span>
                </>
              ) : (
                <span className="font-normal text-stone/70">{maxFabrics > 1 ? "Select fabric… (up to " + maxFabrics + ")" : "Select fabric…"}</span>
              )}
              <span className={`absolute right-3 top-1/2 -translate-y-1/2 text-stone transition-transform ${fabOpen ? "rotate-180" : ""}`}>▾</span>
            </button>
            {fabOpen && (
              <div className="absolute right-0 top-full z-30 mt-1.5 w-[330px] max-w-[92vw] rounded-lg border border-sand bg-white p-2.5 shadow-xl">
                <input
                  value={fabQ}
                  onChange={(e) => setFabQ(e.target.value)}
                  placeholder="Search color…"
                  className="mb-2 w-full rounded-md border border-sand px-3 py-1.5 text-sm focus:border-cognac focus:outline-none"
                />
                <div className="mb-2 flex gap-1 overflow-x-auto pb-1">
                  {["", ...collections].map((c) => {
                    const on = fabCol === c;
                    return (
                      <button
                        key={c || "all"}
                        type="button"
                        onClick={() => setFabCol(on && c ? "" : c)}
                        className={`shrink-0 rounded-full border px-2.5 py-1 text-[11px] font-bold ${on || (!fabCol && !c) ? "border-espresso bg-espresso text-cream" : "border-sand bg-white text-stone hover:bg-linen"}`}
                      >
                        {c || "All"}
                      </button>
                    );
                  })}
                </div>
                <div className="flex max-h-56 flex-wrap content-start gap-1.5 overflow-auto">
                  {fabrics
                    .filter((l) => !fabCol || colOf(l.name) === fabCol)
                    .filter((l) => !fabQ.trim() || l.name.toLowerCase().includes(fabQ.trim().toLowerCase()))
                    .map((l) => {
                      const on = fabrics_.some((f) => f.name === l.name);
                      const full = !on && fabrics_.length >= maxFabrics;
                      // Leather ↔ Lift Storage ban (team rule) — disabled ang
                      // leather habang naka-Lift.
                      const leatherBan = liftOn && /leather/i.test(l.name);
                      return (
                        <button
                          key={l.name}
                          type="button"
                          disabled={leatherBan || full}
                          onClick={() => {
                            if (leatherBan || full) return;
                            setFabrics_((p) => (on ? p.filter((f) => f.name !== l.name) : [...p, { name: l.name, part: p.length ? "Headboard" : "Whole bed" }]));
                            // Isang tela lang ang pinapayagan? Isara agad — tapos na.
                            if (maxFabrics === 1) setFabOpen(false);
                          }}
                          title={leatherBan ? `${l.name} — not available with Lift Storage` : full ? `Up to ${maxFabrics} fabrics` : l.name}
                          className={`w-[92px] flex-none overflow-hidden rounded-md bg-white text-center ${leatherBan || full ? "cursor-not-allowed border border-sand opacity-30" : on ? "border-2 border-cognac ring-2 ring-cognac/20" : "border border-sand hover:border-cognac"}`}
                        >
                          <SwatchTile s={l} className="h-9 w-full" />
                          <span className={`block truncate px-1 py-0.5 text-[9px] leading-tight ${on ? "font-bold text-ink" : "text-stone"}`}>
                            {l.name}
                            {on ? " ✓" : ""}
                          </span>
                        </button>
                      );
                    })}
                </div>
              </div>
            )}
            {/* SAAN NAPUPUNTA ANG BAWAT TELA. Lumalabas lang kapag mahigit isa
                ang napili — sa iisang tela, walang itatanong. */}
            {fabrics_.length > 1 && (
              <div className="mt-2 space-y-1">
                {fabrics_.map((f) => {
                  const lib = fabrics.find((x) => x.name === f.name);
                  return (
                    <div key={f.name} className="flex items-center gap-2 rounded-lg border border-sand px-2 py-1.5">
                      {lib && <SwatchTile s={lib} className="h-[18px] w-[18px] shrink-0 overflow-hidden rounded border border-black/10" />}
                      <span className="min-w-0 flex-1 truncate text-xs">{f.name}</span>
                      <select
                        value={f.part}
                        onChange={(e) => setFabrics_((p) => p.map((x) => (x.name === f.name ? { ...x, part: e.target.value } : x)))}
                        className="rounded-md border border-sand bg-transparent px-1.5 py-1 text-[11px] font-semibold outline-none focus:border-cognac"
                      >
                        {FABRIC_PARTS.map((pt) => <option key={pt} value={pt}>{pt}</option>)}
                      </select>
                      <button
                        type="button"
                        onClick={() => setFabrics_((p) => p.filter((x) => x.name !== f.name))}
                        title="Remove this fabric"
                        className="shrink-0 px-1 text-stone hover:text-ink"
                      >✕</button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
        </div>
      )}

      {/* ── FIELD inputs ── */}
      {fields.map((f) => (
        <div key={f.label} className="mb-3 rounded-lg border border-sand px-4 py-2">
        <div className="grid grid-cols-[110px_1fr] items-center gap-3 py-1.5">
          <span className="text-sm text-stone">{f.label.split("—")[0].split(":")[0].trim()}</span>
          <input
            value={fieldVal[f.label] ?? ""}
            onChange={(e) => setFieldVal((p) => ({ ...p, [f.label]: e.target.value }))}
            placeholder={f.label}
            className="w-full rounded-lg border border-sand bg-transparent px-3 py-2.5 text-sm focus:border-cognac focus:outline-none"
          />
        </div>
        </div>
      ))}

      {/* ── ADD-ON checkbox rows ── */}
      {checks.length > 0 && (
        <div className="mb-3 overflow-hidden rounded-lg border border-sand">
          <button type="button" onClick={() => setAddOpen((v) => !v)} className="flex w-full items-center gap-2 border-b border-sand bg-linen px-4 py-2.5 text-left">
            <span className="text-xs font-bold tracking-widest2">ADD-ONS</span>
            <span className="rounded bg-cognac/10 px-2 py-0.5 text-[10px] font-bold tracking-widest2 text-cognac">{checks.filter((a) => isPicked(a.label)).length} SELECTED</span>
            <span className="ml-auto text-xs text-stone">{addOpen ? "− HIDE" : "+ SHOW"}</span>
          </button>
          {addOpen && (
          <div className="p-3">
          <div className="space-y-2">
            {checks.map((a) => {
              const ban = banReason(a.label);
              const on = isPicked(a.label);
              return (
                <label
                  key={a.label}
                  className={`flex items-center gap-3 rounded border px-4 py-3 text-sm transition-colors ${ban ? "cursor-not-allowed border-stone/20 opacity-50" : on ? "cursor-pointer border-cognac bg-cognac/5" : "cursor-pointer border-stone/30 hover:border-stone/60"}`}
                >
                  <input
                    type="checkbox"
                    checked={on}
                    disabled={!!ban}
                    onChange={() => toggleCheck(a.label)}
                    className="accent-cognac"
                  />
                  <span className="min-w-0 flex-1">
                    {/* RED STRIKETHROUGH sa banned — mabilis maintindihang bawal */}
                    {ban ? <s className="decoration-red-600 decoration-2">{a.label}</s> : a.label}
                    {ban && <span className="block text-xs text-stone">{ban}</span>}
                  </span>
                  {(a.price ?? 0) > 0 ? (
                    <span className="shrink-0 font-bold">+{formatPrice(a.price!)}</span>
                  ) : (
                    <span className="shrink-0 text-xs text-stone">confirmed on order</span>
                  )}
                </label>
              );
            })}
          </div>
          {fourOn && (
            <p className="mt-2 rounded bg-linen px-3 py-2 text-xs text-stone">
              4 built-in drawers — no other add-ons will reflect.
            </p>
          )}
          {liftOn && (
            <p className="mt-2 rounded bg-linen px-3 py-2 text-xs text-stone">
              Lift Storage — Platform Style base; drawers/pullout are no longer available (Tufted only).
            </p>
          )}
          </div>
          )}
        </div>
      )}

      {/* ── DOUBLE WALLING ── ang kapal ng dingding ang nagdedesisyon ng sukat ng
          FRAME — doon humihiwa ang workshop, hindi sa sukat ng kutson. */}
      {doubleWallOn && (
        <div className="mt-3 rounded-lg border-l-4 border-cognac bg-linen/50 py-1 pl-4 pr-3">
          <div className="grid grid-cols-[110px_1fr] items-center gap-3 py-1.5">
            {/* Ang kapal ng dingding ang nagtatakda ng sukat ng frame — unang
                tanong ng bloke, at hindi na kailangang pangalanang "thickness"
                dahil may Thickness na sa ibaba para sa padding. */}
            {/* WALANG PANGALAN: ang Double Walling ay nasa checkbox na sa itaas,
                at ang "Thickness" ay pag-aari ng padding sa ibaba. Ang mga chip
                ang nagsasabi kung ano sila — ang kapal ng dingding, na siyang
                nagtatakda ng sukat ng frame sa card sa ilalim nito. */}
            <span className="text-sm text-stone">Wall</span>
            <div className="flex flex-wrap items-center gap-1.5">
              {WALL_THICKNESSES.map((t, i) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setDwThick(t)}
                  className={`rounded-full border px-3 py-1 text-xs font-semibold ${dwThick === t ? "border-cognac bg-cognac text-white" : "border-sand hover:border-cognac"}`}
                >
                  {t}&quot;
                  {dwPriceAt("wall thickness", i) > 0 && (
                    <span className={`ml-1 text-[10px] font-medium ${dwThick === t ? "text-white/80" : "text-stone"}`}>+{formatPrice(dwPriceAt("wall thickness", i))}</span>
                  )}
                </button>
              ))}
            </div>
          </div>
          {/* Kaparehong hulma ng add-on row: rounded border, px-4 py-3, text-sm
              — pangalan sa kaliwa, halaga sa kanan na naka-bold. */}
          {frameLabel(size, dwThick) && (
            <div className="my-1.5 overflow-hidden rounded border border-cognac/40">
              <div className="flex items-center gap-3 border-b border-sand px-4 py-3 text-sm">
                <span className="min-w-0 flex-1 text-stone">Mattress size</span>
                <span className="shrink-0 font-mono tabular-nums">
                  {(() => {
                    const m = /(\d+)\s*[xX]\s*(\d+)/.exec(size);
                    return m ? `${m[1]} × ${m[2]}` : size;
                  })()}
                  <span className="ml-1 text-xs font-sans text-stone">in</span>
                </span>
              </div>
              <div className="flex items-center gap-3 bg-cognac/5 px-4 py-3 text-sm">
                <span className="min-w-0 flex-1 font-semibold text-cognac">Frame Dimension</span>
                <span className="shrink-0 font-mono font-bold tabular-nums">
                  {frameLabel(size, dwThick)!.replace("x", " × ")}
                  <span className="ml-1 text-xs font-sans font-normal text-stone">in</span>
                </span>
              </div>
            </div>
          )}
          <div className="grid grid-cols-[110px_1fr] items-center gap-3 py-1.5">
            <span className="text-sm text-stone">Height</span>
            <div className="flex flex-wrap items-center gap-2">
              <Stepper value={dwH} onChange={setDwH} />
            </div>
          </div>
          <div className="grid grid-cols-[110px_1fr] items-center gap-3 py-1.5">
            <span className="text-sm text-stone">Thickness</span>
            <div className="flex flex-wrap items-center gap-2">
              <Stepper value={dwPad} onChange={setDwPad} />
            </div>
          </div>
          <div className="grid grid-cols-[110px_1fr] items-center gap-3 py-1.5">
            <span className="text-sm text-stone">Width</span>
            <div className="flex flex-wrap items-center gap-2">
              <Stepper value={dwW} onChange={setDwW} />
            </div>
          </div>
          {/* Palamuti — hindi kailangan para maitayo ang dingding. */}
          <div className="mt-1 flex items-center gap-2 border-t border-sand pt-1.5">
            <span className="text-[10px] font-extrabold uppercase tracking-widest text-cognac">Add-ons</span>
            <span className="text-[10px] text-stone">optional trim</span>
          </div>
          <div className="grid grid-cols-[110px_1fr] items-center gap-3 py-1.5">
            <span className="text-sm text-stone">Decorative nails</span>
            <div className="flex flex-wrap items-center gap-1.5">
              {[["Gold", "linear-gradient(140deg,#d4af37,#f0d97a,#b8860b)"], ["Silver", "linear-gradient(140deg,#9aa0a6,#e2e5e8,#7d8388)"]].map(([n, css], i) => (
                <button
                  key={n}
                  type="button"
                  onClick={() => setDwNails(dwNails === n ? "" : n)}
                  className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold ${dwNails === n ? "border-cognac bg-cognac text-white" : "border-sand hover:border-cognac"}`}
                >
                  <span className="h-3 w-3 shrink-0 rounded-full border border-black/15" style={{ background: css }} />
                  {n}
                  {dwPriceAt("decorative nails", i) > 0 && (
                    <span className={`text-[10px] font-medium ${dwNails === n ? "text-white/80" : "text-stone"}`}>+{formatPrice(dwPriceAt("decorative nails", i))}</span>
                  )}
                </button>
              ))}
            </div>
          </div>
          <div className="grid grid-cols-[110px_1fr] items-center gap-3 py-1.5">
            <span className="text-sm text-stone">Gold accent</span>
            <div>
              <button
                type="button"
                onClick={() => setDwAccent((v) => !v)}
                className={`rounded-full border px-3 py-1 text-xs font-semibold ${dwAccent ? "border-cognac bg-cognac text-white" : "border-sand hover:border-cognac"}`}
              >
                Gold accent{dwAccent ? " ✓" : ""}
                {(dwOpt("gold accent")?.price ?? 0) > 0 && (
                  <span className={`ml-1 text-[10px] font-medium ${dwAccent ? "text-white/80" : "text-stone"}`}>+{formatPrice(dwOpt("gold accent")!.price!)}</span>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── FIXED as-is rows ── */}
      {fixed.map((f) => (
        <div key={f.label} className="mt-2 flex items-center gap-2 rounded border border-dashed border-olive/60 bg-linen px-3 py-2 text-sm">
          <span className="min-w-0 flex-1">{f.label}</span>
          <span className="shrink-0 text-[10px] font-extrabold uppercase tracking-widest2 text-olive">as-is</span>
        </div>
      ))}

      {/* WALANG SHIPPING AT MOBILE DITO (2026-08-22). Ang dalawang ito ay
          tinatanong sa /quote-request bago ipadala — kasama ang buong address,
          na hindi kayang ibigay ng estimator. Ang pagtatanong dito rin ay
          paghingi ng parehong bagay nang dalawang beses, at magkaiba pa ang
          haba ng sagot. Ang READY-UNIT view ay may estimator pa rin: diretso
          sa checkout iyon, kaya kailangang makita ang pamasahe bago mag-add
          to cart. */}
      {etaCard}

      {/* ── ANG LISTAHAN NG REQUEST ──
          Lumalabas lang kapag may laman: sa nag-iisang produkto (ang
          karaniwan), walang nadadagdag sa pahina at pareho pa rin ang mga
          hakbang. Ang Edit ay ibinabalik ang build sa form na ito kapag
          parehong produkto; kung iba, dinadala sa sariling pahina nito. */}
      {/* ISANG LINYANG KUMPIRMASYON, HINDI BUONG LISTAHAN. Ang listahan ay
          lumalaki sa bawat pagdagdag at itinutulak paibaba ang mga buton
          habang binubuo pa ng customer ang produkto. Ang buong listahan ay
          nasa /quote-request; ang badge sa header ang paalala. */}
      {added2 && (
        <p className="mt-3 flex items-center gap-2 rounded border border-olive/60 bg-olive/10 px-3 py-2 text-xs font-bold text-olive">
          ✓ Added to your request
          <a href="/quote-request" className="ml-auto text-[11px] font-semibold text-cognac underline">
            View request ({quote.length})
          </a>
        </p>
      )}

      {/* ── QTY + ADD / QUOTE ── */}
      {/* ADD TO REQUEST — pangalawang landas, kaya dashed at cognac: pareho ng
          "MADE TO ORDER — CUSTOMIZE". Ang delivery ay HINDI tinatanong dito;
          pag-aari iyon ng buong request at itinatanong minsan sa pag-send. */}
      {handle && (
        <div className="mt-3 flex gap-3">
          {!editId && (
            <div className="flex items-center rounded border border-stone/40">
              <button onClick={() => setQty(Math.max(1, qty - 1))} className="px-4 py-3 hover:text-cognac" aria-label="Decrease quantity">−</button>
              <span className="w-8 text-center text-sm">{qty}</span>
              <button onClick={() => setQty(qty + 1)} className="px-4 py-3 hover:text-cognac" aria-label="Increase quantity">+</button>
            </div>
          )}
          <button
            type="button"
            disabled={quoteSending || buildMissingNow.length > 0}
            title={buildMissingNow.length ? `Still needed: ${buildMissingNow.join(", ")}` : undefined}
            onClick={addToRequest}
            className="flex flex-1 items-center justify-center rounded border-[1.5px] border-dashed border-cognac bg-linen px-4 py-3 text-sm font-bold text-cognac transition-colors hover:bg-cognac hover:text-cream disabled:cursor-not-allowed disabled:border-stone/40 disabled:bg-transparent disabled:text-stone/60 disabled:hover:bg-transparent disabled:hover:text-stone/60"
          >
            {added2 ? "✓ Added to request" : editId ? "Save changes" : "+ Add to request"}
          </button>
          {/* Sa pag-e-edit, may paraan palabas na hindi binabago ang naka-save. */}
          {editId && (
            <a
              href="/quote-request"
              className="flex items-center justify-center rounded border border-stone/40 px-5 py-3 text-xs font-bold uppercase tracking-widest2 text-stone transition-colors hover:border-ink hover:text-ink"
            >
              Cancel
            </a>
          )}
        </div>
      )}

      {/* ── QTY + BUY / QUOTE ── */}
      {/* SA PAG-E-EDIT, WALANG "Request a Quote": isang bagay lang ang ginagawa
          ngayon — binabago ang naka-save na item. Ang pagpapadala ay nasa
          /quote-request, kung saan nakikita ang buong listahan. */}
      <div className={editId ? "hidden" : handle ? "mt-2 flex gap-3" : "mt-3 flex gap-3"}>
        {!handle && (
          <div className="flex items-center rounded border border-stone/40">
            <button onClick={() => setQty(Math.max(1, qty - 1))} className="px-4 py-3 hover:text-cognac" aria-label="Decrease quantity">−</button>
            <span className="w-8 text-center text-sm">{qty}</span>
            <button onClick={() => setQty(qty + 1)} className="px-4 py-3 hover:text-cognac" aria-label="Increase quantity">+</button>
          </div>
        )}
        {/* IISANG LANDAS PARA SA LAHAT: idinadagdag ang nasa harap sa
            listahan, tapos sa /quote-request ipinapadala. Ang address ay
            tinatanong doon nang buo (barangay, kalye, postal) — kung
            magpapadala rin dito, dalawang beses itatanong ang parehong bagay
            at magkaiba pa ang haba ng sagot. */}
        {handle && (
          <button
            type="button"
            disabled={quoteSending || (quote.length === 0 && buildMissingNow.length > 0)}
            title={quote.length === 0 && buildMissingNow.length ? `Still needed: ${buildMissingNow.join(", ")}` : undefined}
            onClick={() => {
              if (buildMissingNow.length === 0) addToQuote(currentSlot());
              window.location.href = "/quote-request";
            }}
            className="flex flex-1 items-center justify-center rounded bg-espresso px-4 py-3 text-base font-medium text-cream transition-colors hover:bg-cognac disabled:cursor-not-allowed disabled:bg-stone/50 disabled:hover:bg-stone/50"
          >
            {quoteBtnCount > 1 ? `Request a Quote · ${quoteBtnCount} items` : "Request a Quote"}
          </button>
        )}
        {heartBtn}
      </div>
      {/* Ano pa ang kulang — lumalabas LANG kapag may kulang, at ang listahan
          lang. Ang dating pangalawang linya ay nagbabanggit ng delivery
          location; hindi na iyon tinatanong dito kundi sa /quote-request.
          Ang paalalang "ipapadala ito sa Messenger" ay tinanggal din — sinasabi
          na iyon ng buton mismo, at nasa /quote-request bago ipadala. */}
      {missingNow.length > 0 && (
        <p className={`mt-2 rounded border px-3 py-2 text-xs ${quoteErr.length ? "border-red-200 bg-red-50 text-red-800" : "border-sand bg-linen text-stone"}`}>
          <b className={quoteErr.length ? "" : "text-ink"}>Still needed:</b> {missingNow.join(", ")}.
        </p>
      )}
      {/* Balik sa yari nang unit — same button style ng CUSTOMIZE */}
      {readyAvail && (
        <button
          onClick={() => setView("ready")}
          className="mt-3 flex w-full items-center justify-center gap-2 rounded border border-ink py-3 px-4 text-sm font-bold tracking-widest2 transition-colors hover:bg-ink hover:text-cream"
        >
          ● BUY NOW — SHIPS THIS WEEK
        </button>
      )}
    </div>
  );
}

// "Wood Stain (6 stains)" → "Wood Stain"; "Design: Banana/…" → "Design".
function choiceName(a: MtoAddon): string {
  return a.label.split("(")[0].split(":")[0].split("—")[0].trim() || a.label;
}
