import type { createServerSupabase } from "@/lib/supabase/server";
import { splitDimension } from "@/lib/receipt-desc";

// ANG REWORK JOB AY GINAGAWA KAPAG NASA WORKSHOP NA ANG GAMIT.
//
// Dalawang tumatawag, at sinasadya iyon:
//   • /api/delivery/pickup-proof leg="drop" — ang mapa, pagpirma sa workshop
//   • recordReworkPickupProof leg="drop"    — ang card, pagkumpleto ng litrato
//
// Alinman ang mauna ay siyang gagawa; IDEMPOTENT ito (`rework_job_id is null`
// ang sinasala), kaya hindi nadodoble. Nasa mapa lang ito noon — at ang mapa ay
// pumipirma bago pa ma-upload ang Drop Proof, kaya nauuna ang job sa katibayan.
//
// Tinatahimik ang bawat pagkabigo: ang proof ang mahalaga, hindi ito. Kapag
// hindi nagawa rito, gagawin ng kabilang tumatawag.
export async function createReworkJobIfNeeded(
  db: ReturnType<typeof createServerSupabase>,
  orderId: number,
  orderNumber: string | null,
): Promise<{ jobId: number | null }> {
  try {
    // Kasama na ang REFUND pull-out (2026-09-01): parehong drop-sa-workshop na
    // daan, pero ang job na gagawin ay STOCK JOB — walang order na nakatali,
    // kaya ang buong pipeline pagkatapos (declare → haul → stock-in) ay
    // natural na malayang stock: walang Order # sa cubic, walang redelivery.
    const { data: rets } = await db.from("returns")
      .select("id, return_no, resolution, sku, item_desc, color, dimension, category, qty, rework_workshop_id")
      .eq("order_id", orderId).in("resolution", ["rework", "refund"]).eq("status", "Rework")
      .is("rework_job_id", null).is("reworked_at", null)
      .order("id", { ascending: false }).limit(1);
    const r = rets?.[0] as {
      id: number; return_no: string | null; resolution: string | null; sku: string | null;
      item_desc: string | null;
      color: string | null; dimension: string | null; category: string | null;
      qty: number | null; rework_workshop_id: number | null;
    } | undefined;
    if (!r || r.rework_workshop_id == null) return { jobId: null };
    const isRefund = r.resolution === "refund";

    const rma = r.return_no ?? `#${r.id}`;

    // HUWAG MAGPANGANAK KAPAG MAY BUKAS NA (2026-08-31). Dalawang tumatawag
    // ang function na ito (mapa at proof card), at ang "idempotency" ay
    // nakasalalay sa write-back ng rework_job_id — na best-effort at minsang
    // nabibigo nang tahimik: ang RMA-000008 ay nagka-DALAWANG job (193, 194)
    // walong minuto ang pagitan, pareho ang dineklara at na-stock-in — isang
    // sofa, naging dalawa sa inventory. Ang bukas na job ng parehong RMA ay
    // muling ginagamit at muling itinatali, hindi dinodoblehan.
    // Ang refund job ay walang order_id (stock job) — ang RMA sa item_desc ang
    // susi ng dedupe nito.
    const existQ = isRefund
      ? db.from("workshop_job").select("id").is("order_id", null).is("qc_received_at", null).ilike("item_desc", `%${rma}%`)
      : db.from("workshop_job").select("id").eq("order_id", orderId).is("qc_received_at", null).ilike("item_desc", `%${rma}%`);
    const { data: existing } = await existQ
      .order("id", { ascending: false })
      .limit(1);
    if (existing?.[0]?.id) {
      await db.from("returns").update({ rework_job_id: existing[0].id }).eq("id", r.id);
      return { jobId: existing[0].id as number };
    }
    // Unang linya = "Rework · RMA · name"; ang specs ay "• …" bullets para
    // makumpleto ng parseDescSpecs ang color/dims/category downstream.
    //
    // ANG BUONG BUILD, HINDI ANG TATLONG HANAY (2026-08-27). Ang color +
    // dimension + category lang ang isinusulat noon, kaya "2 filled" lang ang
    // SPECIFICATIONS card ng HR approval ("Tanya Beige 201", "Sofa") habang ang
    // normal na declaration ay may pito — at hindi malalaman ng aprubador kung
    // ano talaga ang kinumpuni. Ang piniling build ay nasa BULLETS ng
    // returns.item_desc; iyon ang dalhin, at ang tatlong hanay ay panghalili
    // lang kapag walang bullets (lumang RMA).
    const head = `Rework · ${rma} · ${(r.item_desc ?? "").split("\n")[0] || "item"}`;
    const bullets = String(r.item_desc ?? "").split("\n").slice(1)
      .map((l) => l.trim().replace(/^[•·-]+\s*/, ""))
      .filter((l) => l.includes(":"));
    const lines = bullets.length
      ? bullets
      : ([r.color, splitDimension(r.dimension).size, splitDimension(r.dimension).frame, r.category]
          .filter(Boolean) as string[]);

    // ANG REFUND AY STOCK JOB: walang order_id/order_number — hindi na
    // pag-aari ng customer ang unit; stock_request + stock_sku ang tatak, kaya
    // ang declare nito ay diretsong stock papuntang bodega. Ang RMA link ay
    // ang returns.rework_job_id na isinusulat sa ibaba.
    const { data: job } = await db.from("workshop_job").insert({
      order_id: isRefund ? null : orderId,
      order_number: isRefund ? null : orderNumber,
      ...(isRefund ? { stock_request: true, stock_sku: r.sku ?? null, stock_reason: `Refund pull-out · ${rma} — double-check, then back to stock` } : {}),
      workshop_id: r.rework_workshop_id,
      item_desc: [head, ...lines.map((v) => `• ${v}`)].join("\n"),
      qty: Number(r.qty) || 1,
      status: "pending",
      dispatched_at: new Date().toISOString(),
    }).select("id").single();

    if (job?.id) {
      await db.from("returns").update({ rework_job_id: job.id }).eq("id", r.id);
      return { jobId: job.id as number };
    }
    return { jobId: null };
  } catch {
    // Best-effort — huwag ibagsak ang proof dahil dito.
    return { jobId: null };
  }
}
