// Pinapangalanan ang mga bullet ng isang build.
//
// Ang description ng isang order line ay pangalan sa unang talata, tapos ang
// build ng customer bilang bullets:
//
//   CUSTOM BED: Costumized Bed
//   • Size: Single 36X75
//   • Fabric: Tanya Frost Gray
//   • 2 built-in drawers
//   • Tufted Footboard
//   • None Headboard
//   • Winged
//   • Customized
//
// Ang Size at Fabric ay may label na mula sa configurator; ang iba ay hindi.
// Ang "2 built-in drawers" ay hindi nagsasabi kung ANONG bahagi iyon hangga't
// hindi mo alam ang katalogo — kaya hinuhugot ang pangalan mula sa mismong
// pananalita, at ang natitira ang halaga: "Footboard: Tufted".
//
// Kapag walang matukoy na pangalan, ang buong linya ang ipinapakita nang walang
// label — mas mabuti kaysa sa maling paghula.

export type BuildSpec = { label: string | null; value: string };

// Alin sa mga salita ang PANGALAN ng bahagi. Nakaayos mula sa pinakatiyak
// pababa: ang "sofa bed" ay hindi dapat mahuli ng "bed".
// `keep`: ang salita ay bahagi ng sinasabi, hindi pamagat — huwag itong
// tanggalin sa halaga. Ang "2 built-in drawers" na naging "2 built-in" ay
// hindi na nagsasabi kung ano ang dalawa.
const PARTS: { re: RegExp; label: string; keep?: boolean }[] = [
  { re: /\bheadboard\b/i, label: "Headboard" },
  { re: /\bfootboard\b/i, label: "Footboard" },
  { re: /\b(drawer|drawers|pullout|pull-out|lift storage|storage)\b/i, label: "Storage", keep: true },
  { re: /\b(leg|legs)\b/i, label: "Legs" },
  { re: /\b(arm|arms)\b/i, label: "Arms" },
  { re: /\b(frame|winged)\b/i, label: "Frame" },
  { re: /\b(wood stain|stain)\b/i, label: "Wood stain" },
  { re: /\bmattress\b/i, label: "Mattress" },
  { re: /\b(top material|finish)\b/i, label: "Finish" },
  { re: /\b(led|light|lighting)\b/i, label: "Lighting", keep: true },
  { re: /\b(design|style|pattern)\b/i, label: "Design" },
  { re: /\b(height|width|depth|panel)\b/i, label: "Dimensions", keep: true },
];

// Ang mga linyang ito ay tanda, hindi spec — walang value na maipapares.
const FLAGS = /^(customized|custom build|made to order)$/i;

export function parseBuildSpecs(fullDesc: string | null | undefined): BuildSpec[] {
  const lines = String(fullDesc ?? "")
    .split("\n")
    .slice(1) // ang unang talata ay ang pangalan ng produkto
    .map((s) => s.trim().replace(/^[•·\-\s]+/, ""))
    .filter(Boolean);

  const out: BuildSpec[] = [];
  for (const line of lines) {
    // "Size: Single 36X75" — may label na mismo.
    const colon = /^([A-Za-z][A-Za-z /&]{1,22}):\s*(.+)$/.exec(line);
    if (colon) {
      out.push({ label: colon[1].trim(), value: colon[2].trim() });
      continue;
    }
    // Isang tanda lang, walang value.
    if (FLAGS.test(line)) {
      out.push({ label: null, value: line });
      continue;
    }
    // Hinuhugot ang pangalan ng bahagi sa loob ng pananalita. Tinatanggal lang
    // ang salita kapag ito ang DULO at may natitirang paglalarawan bago ito:
    // "Tufted Footboard" → Footboard: Tufted. Ang "2 built-in drawers" ay
    // buong-buong pinapanatili — ang "drawers" ay bahagi ng sinasabi, hindi
    // pamagat, at ang pagtanggal nito ay nagbibigay ng "2 built-in".
    const part = PARTS.find((p) => p.re.test(line));
    if (part) {
      const trailing = new RegExp(`\\s+${part.re.source}\\s*$`, "i");
      const rest = !part.keep && trailing.test(line) ? line.replace(trailing, "").trim() : "";
      out.push({ label: part.label, value: rest || line });
      continue;
    }
    out.push({ label: null, value: line });
  }
  return out;
}
