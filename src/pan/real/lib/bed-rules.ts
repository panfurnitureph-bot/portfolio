// 4 BUILT-IN DRAWERS (hiling 2026-08-23).
//
// Dalawang patakaran, iisang lugar - ginagamit ng BedOptionsPanel (pagpili),
// ng composeBedSpecs (ang naitatala), at ng mga test:
//
//   1. FULL DOUBLE, QUEEN, o KING lang. Sa Single at Twin ay walang puwang
//      para sa apat na drawer sa gilid.
//   2. "No other add-ons will reflect after 4 drawers" - kapag ito ang pinili,
//      walang pullout, lift storage, mattress insert, double walling, o tufted
//      footboard. Ang headboard at legs ay hindi add-on; hindi sila apektado.
//
// Ang pangalan ng option ay kapareho ng "2 built-in drawers" sa IMS at sa
// config ng website; ang storefront ay "4 pcs Built-in Side Drawers" - ang
// isFourDrawersLabel ang nagpapantay sa mga iyon.

export const FOUR_DRAWERS = "4 built-in drawers";
export const FOUR_DRAWERS_NOTE = "no other add-ons";

// IMS: "FULL DOUBLE 54X75", "QUEEN 60X75", "KING 1 72X78" · website: "Double/Full 54X75", "King 2"
export function fourDrawerSizeOk(size: string | null | undefined): boolean {
  return /FULL\s*DOUBLE|DOUBLE\s*\/\s*FULL|QUEEN|KING/i.test(String(size ?? ""));
}

// Napili ang apat na drawer pero hindi na kasya ang sukat (hal. pinalit sa Twin
// pagkatapos pumili) - pulang babala sa form, at hindi isinusulat ng compose.
export function bedFourErr(b: { drawer: string; size: string }): boolean {
  return b.drawer === FOUR_DRAWERS && !fourDrawerSizeOk(b.size);
}

// Tumutugma sa "4 built-in drawers" (IMS/config) at "4 pcs Built-in Side
// Drawers" (storefront) - hindi sa "2 built-in drawers" o "Drawer Position".
export function isFourDrawersLabel(label: string | null | undefined): boolean {
  const l = String(label ?? "");
  return /(^|\D)4\s*(pcs\.?\s*)?(built-?in\s*)?(side\s*)?drawers?\b/i.test(l);
}
