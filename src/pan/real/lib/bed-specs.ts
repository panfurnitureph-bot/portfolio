import type { BedState } from "@/components/line-items-editor";

// KABALIGTARAN NG composeBedSpecs (2026-08-23).
//
// Ang Sofa at Ottoman ay bumabalik sa guided form kapag binuksan sa Create
// Order, dahil may parseSpecsToRows. Ang Promo/Custom Bed ay may composeBedSpecs
// (state -> teksto) pero walang pabalik - kaya ang naka-save nang bed ay laging
// bumubukas bilang plain textarea, samantalang ang katabing Ottoman ay may
// steppers at chips. Ito ang pabalik.
//
// PAREHONG KONTRATA ng parseSpecsToRows: kapag may kahit isang linyang hindi
// kilala, null - text mode na lang, para WALANG data na mawawala sa pag-save.
// Ang "Frame Dimension" ay derived mula sa size at kapal ng dingding, kaya
// nilalaktawan (muling bubuuin ng compose).
//
// Tinatanggap din ang mga lumang anyo na nasa mga na-save nang order:
//   Legs: Standard Wood Legs    -> Standard
//   Winged Headboard: Without   -> Not winged   (With -> Winged)
//   Exceed: 5 cm                -> Exceed Headboard: 5  (hbX=5, hbXU=cm)

// Em dash (ang isinusulat ng compose), o gitling na MAY espasyo sa magkabilang
// gilid. Hindi pwedeng basta "-": tatama ito sa "built-in drawers" at mahahati
// ang halaga sa gitna ("2 built" | "in drawers — Left"). Walang lookbehind -
// hindi ito sinusuportahan ng lumang Android WebView ng APK.
const SEP = "(?:\\s*—\\s*|\\s+-\\s+)";

function unitOf(u: string | undefined): string | null {
  if (!u) return null;
  const v = u.trim().toLowerCase();
  if (v === "in" || v === "inches" || v === "inch") return "inches";
  if (v === "cm") return "cm";
  if (v === "ft") return "ft";
  return null;
}

export function parseBedSpecs(text: string | null | undefined, base: BedState): BedState | null {
  const lines = String(text ?? "")
    .split("\n")
    .map((l) => l.trim().replace(/^[•·\-\s]+/, ""))
    .filter(Boolean);
  if (!lines.length) return null;

  const b: BedState = { ...base, dpos: [...base.dpos] };
  let sawHeader = false;

  for (const ln of lines) {
    let m: RegExpExecArray | null;

    // Unang linya: "Custom Bed — With Add-ons" / "Promo Bed — Knockdown (no add-ons)"
    if ((m = new RegExp(`^(Promo|Custom) Bed${SEP}(With Add-ons|Knockdown(?: \\(no add-ons\\))?)$`, "i").exec(ln))) {
      b.btype = /^custom$/i.test(m[1]) ? "Custom" : "Promo";
      b.build = /^with/i.test(m[2]) ? "Add-ons" : "Knockdown";
      sawHeader = true;
      continue;
    }
    if ((m = /^Size:\s*(.+)$/i.exec(ln))) { b.size = m[1].trim(); continue; }
    if (/^Headboard:\s*None$/i.test(ln)) { b.noHb = true; continue; }
    if ((m = /^Headboard Height:\s*(.+)$/i.exec(ln))) { b.hbAuto = m[1].trim(); continue; }
    if ((m = /^Fabric:\s*(.+)$/i.exec(ln))) { b.fabric = m[1].trim(); continue; }
    if ((m = /^Design:\s*(.+)$/i.exec(ln))) { b.design = m[1].trim(); continue; }
    if ((m = /^Upholstered Finish:\s*(.+)$/i.exec(ln))) {
      // Ang boucle na paalala ay idinadagdag ng compose - hindi bahagi ng tela.
      b.uph = m[1].replace(/\s*\(boucle[^)]*\)\s*$/i, "").trim();
      continue;
    }
    if ((m = new RegExp(`^Drawers:\\s*(.+?)(?:${SEP}([^(]+?))?(?:\\s*\\((.+)\\))?$`, "i").exec(ln))) {
      b.drawer = m[1].trim();
      b.dpos = m[2] ? m[2].split(/,\s*/).map((s) => s.trim()).filter(Boolean) : [];
      b.dnote = m[3] ? m[3].trim() : "";
      continue;
    }
    if ((m = new RegExp(`^Pullout Bed:\\s*(.+?)(?:${SEP}(.+))?$`, "i").exec(ln))) {
      b.pull = m[1].trim();
      b.pside = m[2] ? m[2].trim() : "";
      continue;
    }
    if (/^Lift Storage:\s*Yes/i.test(ln)) { b.lift = true; continue; }
    if ((m = /^Legs:\s*(.+?)(?:\s*\(Lift Storage\))?$/i.exec(ln))) {
      const v = m[1].trim();
      // Lumang anyo: "Standard Wood Legs" - ang chip ngayon ay "Standard".
      b.legs = /^standard(\s+wood\s+legs)?$/i.test(v) ? "Standard" : v;
      continue;
    }
    if ((m = /^Mattress Insert:\s*(.+)$/i.exec(ln))) { b.insert = m[1].trim(); continue; }
    if ((m = /^Double Walling:\s*([\d.]+)\s*(?:"|in|inches)?$/i.exec(ln))) {
      const n = Number(m[1]);
      if (!(n > 0)) return null;
      b.dwall = true; b.dwThick = n;
      continue;
    }
    if (/^Frame Dimension:/i.test(ln)) continue; // derived - muling bubuuin
    if ((m = /^Height:\s*(.+?)\s*(?:in|inches)?$/i.exec(ln))) { b.dwH = m[1].trim(); continue; }
    if ((m = /^Thickness:\s*(.+?)\s*(?:in|inches)?$/i.exec(ln))) { b.dwPad = m[1].trim(); continue; }
    if ((m = /^Width:\s*(.+?)\s*(?:in|inches)?$/i.exec(ln))) { b.dwW = m[1].trim(); continue; }
    if ((m = /^Decorative Nails:\s*(.+)$/i.exec(ln))) { b.dwNails = m[1].trim(); continue; }
    if (/^Gold Accent:\s*Yes$/i.test(ln)) { b.dwAccent = true; continue; }
    if (new RegExp(`^Tufted Footboard(?:${SEP}same design as headboard)?$`, "i").test(ln)) {
      b.tuft = "Tufted Footboard";
      continue;
    }
    if ((m = new RegExp(`^Tufted Elevated Footboard(?:${SEP}Mattress Thickness:\\s*(.+?)\\s*(inches|in|cm|ft)?)?$`, "i").exec(ln))) {
      b.tuft = "Tufted Elevated Footboard";
      if (m[1]) { b.matt = m[1].trim(); const u = unitOf(m[2]); if (u) b.mattU = u; }
      continue;
    }
    if ((m = /^Winged Headboard:\s*(.+)$/i.exec(ln))) {
      const v = m[1].trim();
      // Lumang anyo: With / Without - ang chips ngayon ay Winged / Not winged.
      b.winged = /^(without|not winged|none|no)$/i.test(v) ? "Not winged" : /^(with|winged|yes)$/i.test(v) ? "Winged" : v;
      continue;
    }
    if ((m = /^Headboard Height \(manual\):\s*(.+?)\s*(inches|in|inch|cm|ft)?$/i.exec(ln))) {
      b.hbH = m[1].trim(); const u = unitOf(m[2]); if (u) b.hbHU = u;
      continue;
    }
    if ((m = /^Exceed(?: Headboard)?:\s*(.+?)\s*(inches|in|inch|cm|ft)?$/i.exec(ln))) {
      b.hbX = m[1].trim(); const u = unitOf(m[2]); if (u) b.hbXU = u;
      continue;
    }
    // Hindi kilala - text mode, walang mawawala.
    return null;
  }
  // Walang header = hindi ito bed na galing sa compose (hal. free-form notes).
  return sawHeader ? b : null;
}
