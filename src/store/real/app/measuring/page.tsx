// MEASURE FOR DELIVERY — /measuring (2026-09-04, mockup 2e53e865)
// Hero "Will it fit through the door?" · 3 steps · Fit checker (lahat ng
// produkto laban sa iyong pinakamasikip na daanan) · 4 guide cards (doors,
// hallways, stairs, elevators). Wala nang Explore categories / pre-footer.

import Link from "next/link";
import { products } from "@/lib/products";
import { primeStoreContent } from "@/lib/content";
import FitChecker, { type FitItem } from "@/components/FitChecker";
import { packagedFrom } from "@/lib/packaged";

export const metadata = { title: "Measure for Delivery — PAN Furniture" };
export const revalidate = 0;

const STEPS = [
  { t: "Get the packaged size", p: <>Every product page lists dimensions under the <b className="text-ink">Dimensions</b> tab. Add about 2&quot; per side for padding and the box — that is the size that has to pass.</> },
  { t: "Measure the path", p: <>Front gate, main door, hallway, stairs, elevator, then the room&apos;s door. Write down width, height and the diagonal of each opening — the diagonal is what lets a piece tilt through.</> },
  { t: "Check, or send it to us", p: <>Use the checker below, or send your measurements and a photo on Messenger. We confirm fit before you pay the downpayment.</> },
];

const PH = [["Main door (house)", "36\" × 80\""], ["Bedroom door", "32\" × 80\""], ["Condo unit door", "34\" × 84\""], ["Condo elevator door", "32–36\" × 80\""], ["Stair width (typical)", "36–42\""]];

const GUIDES = [
  {
    t: "Doors and gates",
    svg: <><rect x="28" y="10" width="44" height="82" /><circle cx="64" cy="52" r="2" /><path d="M28 6h44M32 3l-4 3 4 3M68 3l4 3-4 3" /><path d="M78 10v82M75 14l3-4 3 4M75 88l3 4 3-4" /><path d="M30 90L70 12" strokeDasharray="3 3" /></>,
    li: [<><b className="text-ink">Width</b> between the door jambs, not the frame</>, <><b className="text-ink">Height</b> from floor to the top of the opening</>, <><b className="text-ink">Diagonal</b> corner to corner — for tilting a headboard or sofa through</>, <>Check the door can open fully; a door that stops at 90° loses 2–3&quot;</>],
    tip: "Remove the door from its hinges for 3\" more width on the delivery day — our team can do this.",
  },
  {
    t: "Hallways and corners",
    svg: <><path d="M10 20h50v50H90M10 90h50V70" /><path d="M10 14h50M14 11l-4 3 4 3M56 11l4 3-4 3" /><path d="M66 70v20M63 74l3-4 3 4" /><path d="M60 70l30-50" strokeDasharray="3 3" /></>,
    li: [<><b className="text-ink">Width</b> of the hallway at its narrowest — count wall lights, railings, aircon units</>, <><b className="text-ink">Ceiling height</b> where the piece has to stand upright to turn</>, <><b className="text-ink">Turn diagonal</b> from the outer wall to the inner corner</>],
    tip: "Long sofas and king headboards are the usual problem at an L-turn. Send us a photo of the corner.",
  },
  {
    t: "Stairs and landings",
    svg: <><path d="M10 90h16V74h16V58h16V42h16V26h16" /><path d="M26 74V20M23 24l3-4 3 4" /><path d="M10 94h80" /><path d="M42 58l40-38" strokeDasharray="3 3" /></>,
    li: [<><b className="text-ink">Stair width</b> between railing and wall at the narrowest step</>, <><b className="text-ink">Headroom</b> from the top step to the ceiling, and at the bottom</>, <><b className="text-ink">Landing</b> width and depth — the piece has to turn here</>],
    tip: "Spiral stairs: most bed frames and 3-seater sofas will not pass. Choose a knock-down bed or tell us before ordering.",
  },
  {
    t: "Elevators (condos)",
    svg: <><rect x="20" y="14" width="60" height="76" /><path d="M50 14v76" /><path d="M20 8h60M24 5l-4 3 4 3M76 5l4 3-4 3" /><path d="M86 14v76M83 18l3-4 3 4M83 86l3 4 3-4" /><path d="M24 86L76 20" strokeDasharray="3 3" /></>,
    li: [<><b className="text-ink">Door opening</b> width and height</>, <><b className="text-ink">Cab depth</b> and the diagonal from the door to the far top corner</>, <>Ask the admin about service-elevator hours and a gate pass for our team</>],
    tip: "Queen and king headboards usually need the service elevator. Mattresses are rolled and always fit.",
  },
];

export default async function MeasuringPage() {
  await primeStoreContent();
  // Packaged size kada produkto (sukat + 2"/gilid) — ang may W×D×H lang.
  const items: FitItem[] = products
    .map((p) => { const k = packagedFrom(p.dimensions || ""); return k ? { name: p.name, ...k } : null; })
    .filter((x): x is FitItem => !!x)
    .sort((a, b) => a.name.localeCompare(b.name));

  return (
    <div className="max-w-[1100px] mx-auto px-4 sm:px-8">
      <nav className="text-xs text-stone pt-4 flex gap-2">
        <Link href="/" className="hover:text-goldDeep">Home</Link><span>/</span><b className="text-ink font-medium">Measure for delivery</b>
      </nav>

      {/* HERO */}
      <section className="grid md:grid-cols-[1.1fr_1fr] gap-10 items-center py-9 pb-11 border-b border-sand">
        <div>
          <p className="text-[11px] font-bold tracking-[0.16em] uppercase text-goldDeep">Delivery guide</p>
          <h1 className="font-cormorant font-semibold text-[clamp(30px,4vw,46px)] leading-[1.05] mt-2">Will it fit through the door?</h1>
          <p className="text-stone text-[15px] leading-relaxed mt-3.5 max-w-[52ch]">Five minutes with a tape measure saves a failed delivery. Measure the path from the street to the room — door, hallway, stairs or elevator — and compare it with the packaged size on the product page. Our team will still measure on arrival, but this tells you before you order.</p>
        </div>
        <svg viewBox="0 0 320 240" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className="w-full h-auto text-brown">
          <rect x="30" y="30" width="110" height="190" rx="3" /><rect x="48" y="48" width="74" height="172" /><circle cx="112" cy="140" r="3" />
          <path d="M160 40v180M156 44l4-4 4 4M156 216l4 4 4-4" /><text x="168" y="134" fontSize="11" fill="currentColor" stroke="none">H</text>
          <path d="M48 26h74M52 22l-4 4 4 4M118 22l4 4-4 4" /><text x="80" y="18" fontSize="11" fill="currentColor" stroke="none">W</text>
          <path d="M50 218L120 50" strokeDasharray="4 4" /><text x="60" y="140" fontSize="11" fill="currentColor" stroke="none">Diagonal</text>
          <rect x="205" y="120" width="90" height="60" rx="4" /><path d="M205 150h90M250 120v60" /><text x="212" y="112" fontSize="10" fill="currentColor" stroke="none">Packaged box</text>
          <path d="M205 190h90M209 186l-4 4 4 4M291 186l4 4-4 4" /><text x="236" y="206" fontSize="10" fill="currentColor" stroke="none">W+2&quot;</text>
        </svg>
      </section>

      {/* STEPS */}
      <div className="grid md:grid-cols-3 gap-4 mt-10">
        {STEPS.map((s, i) => (
          <div key={s.t} className="bg-white border border-sand p-[22px] flex flex-col gap-2">
            <span className="w-9 h-9 rounded-full bg-brown text-gold border-2 border-gold flex items-center justify-center font-cormorant font-bold text-lg">{i + 1}</span>
            <h3 className="font-cormorant font-semibold text-[19px] mt-1">{s.t}</h3>
            <p className="text-stone text-[13.5px] leading-relaxed">{s.p}</p>
          </div>
        ))}
      </div>

      {/* FIT CHECKER */}
      <section id="checker" className="mt-12 bg-brown text-cream p-6 md:p-9 grid md:grid-cols-2 gap-8">
        <div>
          <p className="text-[11px] font-bold tracking-[0.16em] uppercase text-gold">Fit checker</p>
          <h2 className="font-cormorant font-semibold text-[26px] leading-tight mt-1">Enter your tightest opening — see what fits</h2>
          <p className="text-cream/80 text-sm mt-2 max-w-[44ch]">Usually the front door, a stair landing or the elevator. We check every product size against it, including the tilt-through diagonal — no need to pick a product first.</p>
          <div className="mt-[22px] border border-gold/30 bg-cream/[.06] p-5">
            <h3 className="text-xs tracking-[0.14em] uppercase text-gold mb-2.5">Typical Philippine openings</h3>
            <table className="w-full text-[13px]">
              <tbody>
                {PH.map(([k, v], i) => (
                  <tr key={k}><td className={`py-[7px] ${i < PH.length - 1 ? "border-b border-gold/20" : ""}`}>{k}</td><td className={`py-[7px] text-right font-semibold tabular-nums ${i < PH.length - 1 ? "border-b border-gold/20" : ""}`}>{v}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        <FitChecker items={items} />
      </section>

      {/* GUIDES */}
      <section className="mt-14 mb-16">
        <div className="mb-[18px]">
          <h2 className="font-cormorant font-semibold text-[28px]">What to measure, where</h2>
          <p className="text-stone mt-1.5 max-w-[60ch]">Measure every opening on the way in. The narrowest one decides.</p>
        </div>
        <div className="grid md:grid-cols-2 gap-4">
          {GUIDES.map((g) => (
            <div key={g.t} className="bg-white border border-sand grid sm:grid-cols-[150px_1fr] gap-[18px] p-[22px]">
              <svg viewBox="0 0 100 100" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" className="w-[120px] h-[120px] sm:w-[150px] sm:h-[150px] text-brown">{g.svg}</svg>
              <div>
                <h3 className="font-cormorant font-semibold text-[20px]">{g.t}</h3>
                <ul className="mt-2 pl-4 list-disc text-stone text-[13.5px] leading-[1.7]">
                  {g.li.map((l, i) => <li key={i}>{l}</li>)}
                </ul>
                <div className="mt-2.5 bg-goldSoft text-brown text-xs px-2.5 py-2 border-l-[3px] border-goldDeep">{g.tip}</div>
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
