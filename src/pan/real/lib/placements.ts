import "server-only";
import type { createServerSupabase } from "@/lib/supabase/server";

type SB = ReturnType<typeof createServerSupabase>;

// PER-CUBIC NA STOCK (0199). Ang isang SKU ay maaaring nasa maraming cubic —
// ang bagong dating na hindi kasya sa L1-A1 ay pumupunta sa L3-A1, at pareho
// silang totoo. Best-effort ang lahat dito: kapag wala pa ang 0199, tahimik na
// walang ginagawa — ang stock mismo (oh_inv) ang katotohanan, ito ay puwesto
// lang.
//
// KADA KULAY (0235, Joe 2026-09-06): ang puwesto ay (sku, cubic, kulay) na —
// ang tatlong leather ng iisang SKU ay tig-kanyang bunton sa mapa. Bago ang
// 0235 (walang `color` na kolum) ay bumabagsak sa dating kada-SKU na asal.

const normColor = (c: string | null | undefined) => String(c ?? "").replace(/\s+/g, " ").trim();
const noColorCol = (e: { message?: string } | null | undefined) => !!e && /color/i.test(String(e.message ?? ""));

// Dagdag (o bawas, negatibong qty) sa isang cubic. Ang hilerang umabot sa 0 ay
// binubura para hindi maglista ng walang-lamang puwesto ang mapa.
export async function addPlacement(
  supabase: SB,
  sku: string | null | undefined,
  code: string | null | undefined,
  qty: number,
  // ANG MAY-ARI (0219): kapag ang pinasok ay para sa isang order (rework
  // redelivery, MTO mula workshop), ang Order # ay nakadikit sa MISMONG cubic
  // na ito — hindi sa buong SKU — para hindi ito lumitaw sa lumang bunton sa
  // ibang istante. Best-effort ang pagsulat: bago ang 0219 ay walang kolum.
  orderId?: number | null,
  color?: string | null,
): Promise<void> {
  const s = (sku ?? "").trim();
  const c = (code ?? "").trim();
  const col = normColor(color);
  if (!s || !c || !qty) return;
  try {
    let sel = await supabase.from("stock_placements").select("id, qty").eq("sku", s).eq("location_code", c).eq("color", col).maybeSingle();
    const legacy = noColorCol(sel.error);
    if (legacy) sel = await supabase.from("stock_placements").select("id, qty").eq("sku", s).eq("location_code", c).maybeSingle();
    const data = sel.data;
    if (data) {
      const next = Math.max(Number(data.qty) + qty, 0);
      if (next <= 0) await supabase.from("stock_placements").delete().eq("id", data.id);
      else {
        await supabase.from("stock_placements").update({ qty: next, updated_at: new Date().toISOString() }).eq("id", data.id);
        if (orderId) {
          try { await supabase.from("stock_placements").update({ order_id: orderId }).eq("id", data.id); } catch { /* wala pang 0219 */ }
        }
      }
    } else if (qty > 0) {
      const base: Record<string, unknown> = { sku: s, location_code: c, qty };
      if (!legacy) base.color = col;
      const { error } = orderId
        ? await supabase.from("stock_placements").insert({ ...base, order_id: orderId })
        : await supabase.from("stock_placements").insert(base);
      // Bago ang 0219: ang insert na may order_id ay babagsak — ulitin nang wala.
      if (error && orderId) {
        const r2 = await supabase.from("stock_placements").insert(base);
        if (noColorCol(r2.error)) await supabase.from("stock_placements").insert({ sku: s, location_code: c, qty });
      } else if (noColorCol(error)) {
        await supabase.from("stock_placements").insert({ sku: s, location_code: c, qty });
      }
    }
  } catch { /* wala pang 0199 */ }
}

// Bawas sa paglabas ng stock — walang sinabi kung aling cubic ang kinuhanan,
// kaya ang pinakamatandang puwesto ang unang binabawasan (FIFO: doon ang
// pinakamatagal nang nakalagay, malamang iyon ang unang hinugot).
//
// `preferOrderId` (0219, 2026-08-31): kapag ang lumalabas ay ANG unit ng isang
// order (rework redelivery), ang placement na pag-aari ng order na iyon ang
// unang kinukuha — hindi ang lumang bunton sa kabilang istante.
//
// `color` (0235): ang puwesto ng KULAY na iyon ang binabawasan; ang lumang
// hilerang walang kulay ay pambalik kapag walang sariling puwesto ang kulay.
export async function consumePlacements(supabase: SB, sku: string | null | undefined, qty: number, preferOrderId?: number | null, color?: string | null): Promise<void> {
  const s = (sku ?? "").trim();
  const col = normColor(color);
  if (!s || qty <= 0) return;
  try {
    const sel = await supabase.from("stock_placements").select("id, qty, order_id, color").eq("sku", s).order("updated_at", { ascending: true });
    // Bago ang 0219/0235 ay kulang ang kolum — ulitin nang wala.
    const { data } = sel.error
      ? await supabase.from("stock_placements").select("id, qty").eq("sku", s).order("updated_at", { ascending: true })
      : sel;
    let rows = [...((data ?? []) as { id: number; qty: number; order_id?: number | null; color?: string | null }[])];
    if (!sel.error && col) {
      const own = rows.filter((r) => normColor(r.color).toLowerCase() === col.toLowerCase());
      const blank = rows.filter((r) => !normColor(r.color));
      rows = own.length ? [...own, ...blank] : blank;
    }
    if (preferOrderId) rows.sort((a, b) => Number(b.order_id === preferOrderId) - Number(a.order_id === preferOrderId));
    let left = qty;
    for (const row of rows) {
      if (left <= 0) break;
      const have = Number(row.qty) || 0;
      const take = Math.min(have, left);
      left -= take;
      if (have - take <= 0) await supabase.from("stock_placements").delete().eq("id", row.id);
      else await supabase.from("stock_placements").update({ qty: have - take, updated_at: new Date().toISOString() }).eq("id", row.id);
    }
  } catch { /* wala pang 0199 */ }
}
