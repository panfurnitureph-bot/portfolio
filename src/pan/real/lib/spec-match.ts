// SPEC MATCHING (2026-08-24) — para sa Stock Build: bago gumawa ng BAGONG
// produkto, tinitingnan kung may KATULAD na sa records. Kung eksaktong pareho
// ang lahat ng specification (at ang category), ang umiiral na SKU ang dapat
// gamitin — hindi na kailangan ng bagong listing.
//
// Ang paghahambing ay sa TEKSTO ng specs, kaya sinasadyang maluwag sa mga bagay
// na hindi nagpapaiba ng produkto: laki ng titik, dagdag na puwang, bullet, at
// ang PAGKAKASUNOD ng linya. Mahigpit naman sa laman: kahit isang linya ang
// magkaiba (ibang tela, ibang sukat), hindi na ito katugma.

export type SpecCandidate = { sku: string; product_name: string; category: string | null; specs: string | null };

// Isang linya ng spec, nilinis: walang bullet, isahang puwang, maliit na titik.
function normLine(line: string): string {
  return line
    .replace(/^[•·\-\s]+/, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

// Ang buong specs bilang PINAGSUNOD-SUNOD na listahan ng linya — kaya ang
// pagkakaiba lang sa pagkakasunod ay hindi nagiging bagong produkto.
export function normalizeSpecs(specs: string | null | undefined): string {
  return String(specs ?? "")
    .split("\n")
    .map(normLine)
    .filter(Boolean)
    .sort()
    .join("\n");
}

const normCat = (c: string | null | undefined) => String(c ?? "").trim().toLowerCase();

// Ang UNANG produkto sa records na eksaktong pareho ang category at specs.
// Null kapag wala — ibig sabihin bago talaga ito.
export function findSpecMatch(
  candidates: SpecCandidate[],
  category: string | null | undefined,
  specs: string | null | undefined,
): SpecCandidate | null {
  const wantSpecs = normalizeSpecs(specs);
  // Walang laman na specs ay hindi maihahambing — masyadong maluwag, lahat ng
  // walang specs ay magiging "katulad".
  if (!wantSpecs) return null;
  const wantCat = normCat(category);
  return (
    candidates.find((c) => normCat(c.category) === wantCat && normalizeSpecs(c.specs) === wantSpecs) ?? null
  );
}
