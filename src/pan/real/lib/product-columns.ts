// ANG CATEGORY/COLOR/DIMENSION NG ISANG CUSTOM NA PRODUKTO.
//
// Sa simpleng stock, ang tatlong column na ito ay tatlong salita: "Sofa",
// "Beige", "80x40". Sa custom na produkto, doon isinisiksik ang build ng
// customer — kaya ang nababasa sa table ay:
//
//   CATEGORY   Fabric: Amalia Canary Yellow
//   COLOR      Total Height: 1 inches
//   DIMENSION  —
//
// Magkasalit ang pamagat ng column at ang laman, at blangko ang dimension.
//
// Ang pagkakaiba ay simple at matibay: ang TUNAY na category ("Sofa") ay walang
// tutuldok; ang build line ("Fabric: Amalia Canary Yellow") ay laging meron.

// Ang halaga kung tunay itong category/color/dimension; null kung build line.
export function realValue(v: string | null | undefined): string | null {
  const t = (v ?? "").trim();
  return t && !t.includes(":") ? t : null;
}

// Ang build lines na nakasiksik sa tatlong column, sunod-sunod. Walang laman
// kapag simpleng stock ang produkto — doon, walang build na ipapakita.
export function buildSpecLines(row: {
  build_specs?: string[] | null;
  category?: string | null;
  color?: string | null;
  dimension?: string | null;
}): string[] {
  // Kapag naitabi na ng server ang build (build_specs), iyon ang gamit: ang
  // category/color sa hilera ay galing na sa catalog, kaya wala nang build doon
  // na makukuha.
  if (row.build_specs?.length) return row.build_specs;
  return [row.category, row.color, row.dimension]
    .map((v) => String(v ?? "").trim())
    .filter((v) => v.includes(":"));
}
