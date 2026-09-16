// PAGTUTUGMA NG BAYAN MULA SA SEARCH SA SHIPPING TABLE.
//
// Ang shipping fee ay galing sa napiling City sa listahan ng admin. Ang sinasabi
// ng Google ay hindi laging pareho ng pagkakasulat doon:
//
//   Google              Listahan
//   Santa Cruz    →     "Sta Cruz / Pila"      (may pinagsamang dalawang bayan)
//   Rizal         →     "Rizal (Laguna)"       (may panaklong na paglilinaw)
//   Santo Tomas   →     "Sto Tomas"            (paikli)
//   Cuenca        →     "Alitagtag / Cuenca"   (pangalawa sa pinagsama)
//   Biñan         →     "Biñan"                (may enye)
//
// Kapag hindi tumugma, WALANG shipping fee na maipapakita — at ang customer ay
// nakakakita ng blangko sa lugar na hinahatiran naman natin. Ito ang nag-aayos
// niyon nang hindi hinuhulaan ang halaga: kapag talagang walang katugma, tahimik
// itong sumusuko at ang dropdown ang bahala.

const norm = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")      // ñ → n
    .replace(/\([^)]*\)/g, " ")           // "Rizal (Laguna)" → "Rizal"
    .replace(/\bsta\.?\b/g, "santa")
    .replace(/\bsto\.?\b/g, "santo")
    .replace(/\bgen\.?\b/g, "general")
    .replace(/\bcity of\b/g, "")
    .replace(/\bcity\b/g, "")             // "Batangas City" ↔ "Batangas"
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

/**
 * Ang eksaktong pangalan ng bayan sa listahan na tumutugma sa `city` mula sa
 * search — o `null` kapag wala. Ang isang entry sa listahan ay maaaring magbanggit
 * ng dalawang bayan ("Sta Cruz / Pila"), kaya ang bawat bahagi ay tinitingnan.
 */
export function matchCity(city: string, cities: { name: string }[]): string | null {
  const want = norm(city);
  if (!want) return null;

  // 1) Eksaktong tugma, o tugma sa isang bahagi ng pinagsamang entry.
  for (const c of cities) {
    const parts = c.name.split("/").map((p) => norm(p));
    if (parts.includes(want)) return c.name;
  }

  // 2) Naglalaman: "Batangas" ↔ "Batangas City", "Rizal" ↔ "Rizal Laguna".
  //    Ang mas mahaba ay dapat naglalaman ng mas maikli BILANG BUONG SALITA —
  //    kung hindi, ang "Bay" ay tutugma sa "Balayan".
  const whole = (hay: string, needle: string) =>
    new RegExp(`(^| )${needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}( |$)`).test(hay);
  for (const c of cities) {
    for (const part of c.name.split("/").map((p) => norm(p))) {
      if (!part) continue;
      if (whole(part, want) || whole(want, part)) return c.name;
    }
  }

  return null;
}

/** Ang bayad para sa isang bayan, o `null` kapag walang katugma. */
export function feeFor(city: string, cities: { name: string; fee: number }[]): { name: string; fee: number } | null {
  const hit = matchCity(city, cities);
  if (!hit) return null;
  const row = cities.find((c) => c.name === hit);
  return row ? { name: row.name, fee: row.fee } : null;
}
