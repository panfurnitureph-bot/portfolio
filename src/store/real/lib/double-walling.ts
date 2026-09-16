// DOUBLE WALLING — kapal ng dingding → sukat ng frame.
//
// Ang kamang may double wall ay itinatayo palabas ng kutson, kaya mas malaki
// ang frame kaysa sa sukat na inorder. Ang workshop ay humihiwa sa FRAME, kaya
// dapat malinaw ang dalawa: ang kutson at ang frame.
//
// TALAAN, HINDI FORMULA. May pattern nga ang mga numero (+12/+12, +16/+14,
// +20/+18) pero ang talaan mismo ng team ang batayan — ibinibigay nila ang
// eksaktong sukat kada bagong kapal o laki. Kapag pinormula, ang unang
// hindi-tugmang numero ay tahimik na magiging mali sa hiwa.
//
// PAALALA: ang King 1 dito ay nakasulat na 72X75 sa listahan ng team, samantalang
// ang system ay may King 1 72X78. Ang mga frame na ibinigay nila para sa King 1
// ay tumutugma sa 72X75. Hangga't hindi ito naaayos, ang tugma ay sa PANGALAN
// ("King 1"), hindi sa sukat — para hindi humiwa sa maling haba.

export const WALL_THICKNESSES = [6, 8, 10] as const;
export type WallThickness = (typeof WALL_THICKNESSES)[number];

export type FrameSize = { w: number; l: number };

// Naka-key sa PANGALAN ng size (walang sukat, walang laki ng titik).
// frameBySize[<size>][<kapal>] = { w, l }
const TABLE: Record<string, Record<number, FrameSize>> = {
  single: { 6: { w: 48, l: 87 }, 8: { w: 52, l: 89 }, 10: { w: 56, l: 93 } },
  twin: { 6: { w: 60, l: 87 }, 8: { w: 64, l: 89 }, 10: { w: 68, l: 93 } },
  "full double": { 6: { w: 66, l: 87 }, 8: { w: 70, l: 89 }, 10: { w: 74, l: 93 } },
  queen: { 6: { w: 72, l: 87 }, 8: { w: 76, l: 89 }, 10: { w: 80, l: 93 } },
  "king 1": { 6: { w: 84, l: 87 }, 8: { w: 88, l: 89 }, 10: { w: 92, l: 93 } },
  "king 2": { 6: { w: 84, l: 90 }, 8: { w: 88, l: 92 }, 10: { w: 92, l: 96 } },
};

// Ang isang size label ay maaaring "SINGLE 36X75", "Single 36X75" o
// "Double/Full 54X75" — ang pangalan lang ang kinukuha.
function sizeKey(size: string): string {
  const s = String(size ?? "")
    .toLowerCase()
    .replace(/\d+\s*x\s*\d+/g, "")   // alisin ang sukat
    .replace(/[^a-z0-9 ]+/g, " ")     // ang "Double/Full" ay nagiging "double full"
    .replace(/\s+/g, " ")
    .trim();
  if (!s) return "";
  if (/king\s*2/.test(s)) return "king 2";
  if (/king\s*1|^king$/.test(s)) return "king 1";
  if (/queen/.test(s)) return "queen";
  if (/double|full/.test(s)) return "full double";
  if (/twin/.test(s)) return "twin";
  if (/single/.test(s)) return "single";
  return s;
}

// Ang sukat ng frame para sa isang size at kapal. Null kapag walang talaan —
// mas mabuti ang walang sagot kaysa sa hinulaang sukat.
export function frameFor(size: string, thickness: number): FrameSize | null {
  const row = TABLE[sizeKey(size)];
  if (!row) return null;
  return row[thickness] ?? null;
}

// "76x89" — ang porma sa specs, orders at resibo.
export function frameLabel(size: string, thickness: number): string | null {
  const f = frameFor(size, thickness);
  return f ? `${f.w}x${f.l}` : null;
}
