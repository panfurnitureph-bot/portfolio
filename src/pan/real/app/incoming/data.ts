import { createServerSupabase } from "@/lib/supabase/server";

// PO statuses that mean "ordered but not yet fully received" → shown in Incoming.
export const INCOMING_STATUSES = ["Sent", "Deposit Paid", "Ordered", "Partially Received"];

export type IncomingItem = {
  id: number | null;          // incoming_shipment_items.id (null until first save)
  po_item_id: number;
  item_no: string | null;
  description: string | null;
  image_url: string | null;
  ordered_qty: number;
  received_qty: number;
  passed_qty: number;
  defective_qty: number;
  qa_remarks: string | null;
  inventory_added: number;
};

export type Incoming = {
  po_id: number;
  pi_number: string | null;
  supplier: string | null;
  container: string | null;
  currency: string;
  total: number;
  status: string;
  details: Record<string, string>;
  // shipment header (may be null until receiving starts)
  shipment_id: number | null;
  eta: string | null;
  arrived_date: string | null;
  tracking_no: string | null;
  forwarder: string | null;
  received_by: string | null;
  items: IncomingItem[];
};

export type IncomingData = {
  rows: Incoming[];
  kpi: { inTransit: number; arrivingSoon: number; partial: number; value: number };
};

export async function loadIncoming(): Promise<IncomingData> {
  const supabase = createServerSupabase();
  const [{ data: pos }, { data: ships }, { data: shipItems }] = await Promise.all([
    supabase.from("purchase_orders").select("id, pi_number, supplier, container, currency, total, status, details, delivery_date, created_at").order("created_at", { ascending: false }).limit(10000),
    supabase.from("incoming_shipments").select("id, po_id, eta, arrived_date, tracking_no, forwarder, received_by").limit(10000),
    supabase.from("incoming_shipment_items").select("id, shipment_id, po_item_id, received_qty, passed_qty, defective_qty, qa_remarks, inventory_added").order("sort").limit(10000),
  ]);

  /* eslint-disable @typescript-eslint/no-explicit-any */
  const incomingPos = (pos ?? []).filter((p) => INCOMING_STATUSES.some((s) => s.toLowerCase() === String(p.status ?? "").toLowerCase()));
  // Only fetch line items for the POs actually shown (not the whole items table).
  const poIds = incomingPos.map((p) => p.id);
  const { data: poItems } = poIds.length
    ? await supabase.from("purchase_order_items").select("id, po_id, item_no, description, image_url, qty, received_qty").in("po_id", poIds).order("sort").limit(10000)
    : { data: [] as any[] };
  const itemsByPo = new Map<number, any[]>();
  for (const it of poItems ?? []) { const a = itemsByPo.get(it.po_id) ?? []; a.push(it); itemsByPo.set(it.po_id, a); }
  const shipByPo = new Map<number, any>();
  for (const s of ships ?? []) shipByPo.set(s.po_id, s);
  const shipItemsByShip = new Map<number, any[]>();
  for (const si of shipItems ?? []) { const a = shipItemsByShip.get(si.shipment_id) ?? []; a.push(si); shipItemsByShip.set(si.shipment_id, a); }

  const rows: Incoming[] = incomingPos.map((p) => {
    const ship = shipByPo.get(p.id) ?? null;
    const sItems: any[] = ship ? (shipItemsByShip.get(ship.id) ?? []) : [];
    const byPoItem = new Map<number, any>();
    for (const si of sItems) if (si.po_item_id != null) byPoItem.set(si.po_item_id, si);

    const items: IncomingItem[] = (itemsByPo.get(p.id) ?? []).map((it) => {
      const si = byPoItem.get(it.id);
      // received_qty is the SINGLE source of truth: purchase_order_items.received_qty,
      // bumped by QC → Incoming (IN) as each unit is inspected + stocked in. (The legacy
      // incoming_shipment_items counters are no longer written.)
      return {
        id: si?.id ?? null,
        po_item_id: it.id,
        item_no: it.item_no ?? null,
        description: it.description ?? null,
        image_url: it.image_url ?? null,
        ordered_qty: Number(it.qty ?? 0),
        received_qty: Number(it.received_qty ?? 0),
        passed_qty: Number(it.received_qty ?? 0),
        defective_qty: Number(si?.defective_qty ?? 0),
        qa_remarks: si?.qa_remarks ?? null,
        inventory_added: Number(it.received_qty ?? 0),
      };
    });

    return {
      po_id: p.id, pi_number: p.pi_number ?? null, supplier: p.supplier ?? null,
      container: p.container ?? null, currency: p.currency ?? "USD", total: Number(p.total ?? 0), status: p.status ?? "Ordered",
      details: (p.details && typeof p.details === "object" ? p.details : {}) as Record<string, string>,
      shipment_id: ship?.id ?? null,
      eta: ship?.eta ?? p.delivery_date ?? null,
      arrived_date: ship?.arrived_date ?? null,
      tracking_no: ship?.tracking_no ?? null,
      forwarder: ship?.forwarder ?? null,
      received_by: ship?.received_by ?? null,
      items,
    };
  });

  const now = Date.now();
  const weekMs = 7 * 24 * 60 * 60 * 1000;
  const arrivingSoon = rows.filter((r) => {
    if (!r.eta) return false;
    const t = new Date(r.eta + "T00:00:00").getTime();
    return !isNaN(t) && t >= now && t <= now + weekMs;
  }).length;
  const partial = rows.filter((r) => /partial/i.test(r.status)).length;
  const value = rows.reduce((s, r) => s + r.total, 0);
  return { rows, kpi: { inTransit: rows.length, arrivingSoon, partial, value } };
}
