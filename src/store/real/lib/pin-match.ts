// TUGMA BA ANG PIN SA MGA DROPDOWN?
//
// Ang shipping fee ay galing sa napiling City/Town, hindi sa pin. Kapag
// naiwang luma ang dropdowns pagkatapos ilipat ang pin — pin sa San Pedro,
// dropdown na Paete — ang customer ay sinisingil ng pamasahe para sa biyaheng
// hindi ganoon, at walang nagpapakita niyon hangga't hindi na dumadating ang
// driver sa maling bayan.
//
// HINDI ITO NAGPAPALIT NG PINILI. Ang taong pumili ng Paete ay maaaring
// nagpapadala nga roon at nag-pin lang nang mali; ang pagpapalit ng bayan sa
// ilalim nila ay nagbabago ng presyo nang hindi nila napapansin. Ang senyales
// ang ibinibigay — sa kanila ang pasya.

const norm = (v: string | null | undefined) =>
  String(v ?? "")
    .toLowerCase()
    // "Biñan" at "Binan"; "Sta." at "Santa"
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\bsta\.?\b/g, "santa")
    .replace(/\bsto\.?\b/g, "santo")
    // "San Pedro City" at "San Pedro"
    .replace(/\b(city|municipality|of)\b/g, "")
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

/**
 * Ang pangalan ng lugar na itinuro ng pin kapag HINDI ito tugma sa napili —
 * `null` kapag tugma, walang pin, o walang sapat na alam para masabi.
 */
export function pinMismatch(
  pin: { city?: string; province?: string } | null | undefined,
  picked: { city: string; province: string },
): string | null {
  if (!pin) return null;
  const pc = norm(pin.city);
  const pp = norm(pin.province);
  // Walang masasabi ang Nominatim tungkol sa lugar — walang ibabala.
  if (!pc && !pp) return null;

  const wc = norm(picked.city);
  const wp = norm(picked.province);

  // Ang isa ay maaaring naglalaman ng isa: "San Pedro" vs "San Pedro City".
  const near = (a: string, b: string) => !!a && !!b && (a === b || a.includes(b) || b.includes(a));

  if (pc && wc && !near(pc, wc)) return [pin.city, pin.province].filter(Boolean).join(", ");
  // Tugma ang bayan pero iba ang lalawigan — bihira, pero may magkapangalang
  // bayan sa magkaibang lalawigan.
  if (pp && wp && !near(pp, wp)) return [pin.city, pin.province].filter(Boolean).join(", ");
  return null;
}
