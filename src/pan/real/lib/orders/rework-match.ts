import { colorOfDesc, lineName, normColor } from "@/lib/orders/line-key";

// ALIN ANG INAAYOS — KASAMA ANG KULAY (Joe 2026-09-06, "pati return, rework,
// lahat ng process dapat maayos ung per color"). Ang RMA ay tumutukoy sa isang
// gamit (returns.item_desc + sku + color). Ang lumang tugma ay SKU (o pangalan)
// lang — kaya sa order na may dalawang Puto Seko Chair na magkaibang leather,
// ang redelivery/install/pickup ng isang RMA ay tinatamaan ang DALAWA.
//
// Tuntunin: SKU muna (kapag pareho may SKU), pangalan bilang panghalili — gaya
// ng dati — at saka ang KULAY: kapag may kulay ang RMA (color column o
// "Fabric:" bullet ng item_desc) at may kulay ang linya, dapat magkapareho.
// Walang kulay sa alinman = tugma (lumang RMA / lumang linya).

export type ReworkRef = { item_desc?: string | null; sku?: string | null; color?: string | null };
export type LineRef = { description?: string | null; sku?: string | null; color?: string | null };

const norm = (s: unknown) => String(s ?? "").trim().toLowerCase();

export const reworkColor = (rw: ReworkRef): string => normColor(rw.color) || colorOfDesc(rw.item_desc);
export const lineColor = (l: LineRef): string => normColor(l.color) || colorOfDesc(l.description);

export function isReworkLine(rw: ReworkRef | null | undefined, line: LineRef): boolean {
  if (!rw) return false;
  const rwSku = norm(rw.sku), sku = norm(line.sku);
  const rwName = lineName(rw.item_desc), name = lineName(line.description);
  const idMatch = rwSku && sku ? sku === rwSku : !!rwName && name === rwName;
  if (!idMatch) return false;
  const rc = reworkColor(rw), lc = lineColor(line);
  return !rc || !lc || rc === lc;
}

// Ang mga linya ng RMA lang; buong listahan kapag walang tumugma (binago o
// binura ang linya) — kaysa magpakita ng stop na walang laman.
export function reworkLinesOnly<T extends LineRef>(lines: T[], rw: ReworkRef | null | undefined): T[] {
  if (!rw || (!norm(rw.sku) && !lineName(rw.item_desc))) return lines;
  const only = lines.filter((l) => isReworkLine(rw, l));
  return only.length ? only : lines;
}
