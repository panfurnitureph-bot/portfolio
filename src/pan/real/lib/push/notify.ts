import "server-only";

// Centralized push-notification composer. One place for every alert's wording so the
// copy stays consistent, professional, and English (the app's UI language). Each
// helper builds the message and fans it out to the right roles; all are best-effort
// (sendPushToRoles never throws), so a failed alert can't break the business action
// that fired it. Callers `await import("@/lib/push/notify")` then call one helper.

import { sendPushToRoles, type PushMessage } from "./fcm";

// --- Role groups -----------------------------------------------------------------
// The role saved on a device token is the account's raw role value, which varies
// between deployments. Each group casts a deliberately wide net over the plausible
// strings; only the intended kind of account ever holds these roles, so extra
// entries are harmless and avoid a silent miss.
const ADMIN = ["administrator", "admin"];
const OPS = ["operations_manager", "operation_manager", "manager", "ops", "operations"];
const WAREHOUSE = ["warehouse_staff", "warehouse", "warehouse_delivery", "delivery", "driver"];
const HR = ["human_resources", "hr"];
const R = {
  ops: [...ADMIN, ...OPS],
  warehouse: [...ADMIN, ...OPS, ...WAREHOUSE],
  hr: [...ADMIN, ...HR],
  opsHr: [...ADMIN, ...OPS, ...HR],
} as const;

const peso = (n: number | null | undefined) =>
  `₱${(Number(n) || 0).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

// Compact "ORD-000123 · Bed with 2 Drawer · ₱13,500.00 · Juan dela Cruz" detail line,
// skipping any part that's missing. Read at a glance, not parsed.
function line(...parts: (string | null | undefined)[]): string {
  return parts.filter((p) => p != null && String(p).trim() !== "").join(" · ");
}

async function fire(roles: readonly string[], msg: PushMessage): Promise<void> {
  await sendPushToRoles([...roles], msg);
}

type OrderRef = { orderNumber: string; product?: string | null; total?: number | null; customer?: string | null };

// Three follow-up emails went unanswered — the confirmation needs a phone call.
export async function notifyConfirmNoResponse(o: { orderNumber: string; customer?: string | null }): Promise<void> {
  await fire(R.ops, {
    title: "No response — CALL the customer",
    body: line(o.orderNumber, o.customer ?? null, "3 confirmation emails unanswered"),
    url: "/operations/delivery-queue",
  });
}

// Customer tapped Reschedule on the reminder and opened the Messenger thread —
// the team needs to reply and arrange the new date (₱500 fee applies once).
export async function notifyRescheduleRequest(o: { orderNumber: string }): Promise<void> {
  await fire(R.ops, {
    title: "Reschedule request",
    body: line(o.orderNumber, "customer opened Messenger to reschedule — reply on the page"),
    url: "/operations/delivery-queue",
  });
}

// Customer picked a NEW date on the 2-days-before reminder's reschedule page —
// auto-confirmed; the stop moved to the new date's route.
export async function notifyDeliveryRescheduled(o: { orderNumber: string; date: string; timeWindow?: string | null }): Promise<void> {
  await fire(R.ops, {
    title: "Delivery rescheduled",
    body: line(o.orderNumber, `customer moved to ${o.date}`, o.timeWindow ?? null),
    url: "/delivery",
  });
}

// Customer pressed Confirm on the delivery-confirmation email — the order is now
// scheduled and shows up in the Delivery module with its team.
export async function notifyDeliveryConfirmed(o: { orderNumber: string; date: string }): Promise<void> {
  await fire(R.ops, {
    title: "Delivery confirmed",
    body: line(o.orderNumber, `customer confirmed for ${o.date}`),
    url: "/delivery",
  });
}

// Sales & Service asked to edit a confirmed (read-only for them) order — Operations
// decides whether to make the change or hand it back.
export async function notifyEditRequest(o: { orderNumber: string; requestedBy: string; reason?: string | null }): Promise<void> {
  await fire(R.ops, {
    title: "Edit request",
    body: line(o.orderNumber, `requested by ${o.requestedBy}`, o.reason ? `"${o.reason}"` : null),
    url: "/operations/edit-requests",
  });
}

// ============================ SALES & OPERATIONS ==================================

// Confirmed (downpayment-paid) order is ready for Operations to assign to a workshop.
export async function notifyOpsNewApproval(o: OrderRef): Promise<void> {
  await fire(R.ops, {
    title: "New order ready for approval",
    body: line(o.orderNumber, o.product, o.total != null ? peso(o.total) : null, o.customer),
    url: "/operations/approval",
  });
}

// A payment settled (downpayment or balance) via cash / terminal / Maya.
export async function notifyPaymentReceived(o: {
  orderNumber: string; amount: number; kind: "downpayment" | "balance"; method?: string | null; collectedBy?: string | null;
}): Promise<void> {
  await fire(R.ops, {
    title: "Payment received",
    body: line(o.orderNumber, `${peso(o.amount)} ${o.kind === "downpayment" ? "downpayment" : "balance"} paid`, o.method, o.collectedBy ? `collected by ${o.collectedBy}` : null),
    url: "/orders",
  });
}

// A rush order's countdown crossed the threshold and it hasn't shipped yet.
export async function notifyRushWarning(o: { orderNumber: string; product?: string | null; daysLeft: number; stage?: string | null }): Promise<void> {
  await fire(R.ops, {
    title: `Rush order — ${o.daysLeft <= 0 ? "overdue" : `${o.daysLeft} day${o.daysLeft === 1 ? "" : "s"} left`}`,
    body: line(o.orderNumber, o.product, o.stage ? `still ${o.stage}` : null),
    url: "/operations/tracker",
  });
}

// ================================ WORKSHOP ========================================

// Operations dispatched an order line to a specific workshop.
export async function notifyJobDispatched(o: { orderNumber: string; product?: string | null; qty?: number | null; workshop?: string | null }): Promise<void> {
  await fire(R.ops, {
    title: "New job dispatched",
    body: line(o.orderNumber, o.qty && o.product ? `${o.qty}× ${o.product}` : o.product, o.workshop ? `workshop ${o.workshop}` : null),
    url: "/workshop/jobs",
  });
}

// A workshop's material request was approved / fulfilled by Operations.
export async function notifyStockRequestApproved(o: { requestNo: string; summary?: string | null }): Promise<void> {
  await fire(R.ops, {
    title: "Stock request approved",
    body: line(o.requestNo, o.summary, "ready to receive at the warehouse"),
    url: "/workshop/requests",
  });
}

// A workshop declared a finished job for project-base salary QC approval (HR).
export async function notifyQcDeclaration(o: { orderNumber: string; product?: string | null; workshop?: string | null; rate?: number | null }): Promise<void> {
  await fire(R.hr, {
    title: "Job declared for QC approval",
    body: line(o.orderNumber, o.product, o.workshop ? `declared by ${o.workshop}` : null, o.rate != null ? `${peso(o.rate)} rate` : null),
    url: "/workshop/quality-control",
  });
}

// =========================== WAREHOUSE & DELIVERY =================================

// QC passed and the order entered the delivery queue.
export async function notifyReadyForDelivery(o: OrderRef): Promise<void> {
  await fire(R.warehouse, {
    title: "Order ready for delivery",
    body: line(o.orderNumber, o.product, "QC passed — schedule & dispatch"),
    url: "/delivery",
  });
}

// Route Planner sent the day's route to the team — driver sees stops + windows.
export async function notifyRouteSent(o: { team: string; driver?: string | null; date: string; stops: number; firstStop?: string | null }): Promise<void> {
  await fire(R.warehouse, {
    title: `Delivery route — ${o.team}${o.driver ? ` · ${o.driver}` : ""}`,
    body: line(o.date, `${o.stops} stop${o.stops === 1 ? "" : "s"}`, o.firstStop ? `first: ${o.firstStop}` : null),
    url: "/delivery",
  });
}

// A rework pull-out needs the defective item collected from the customer FIRST.
export async function notifyReworkPickup(o: { rmaNo: string; orderNumber?: string | null; product?: string | null; address?: string | null }): Promise<void> {
  await fire(R.warehouse, {
    title: "Pickup for rework — collect from customer",
    body: line(o.rmaNo, o.orderNumber, o.product, o.address),
    url: "/delivery",
  });
}

// Driver marked Arrived; the installation task opens.
export async function notifyArrivedToInstall(o: { orderNumber: string; product?: string | null; address?: string | null; team?: string | null }): Promise<void> {
  await fire(R.warehouse, {
    title: "Delivery arrived — ready to install",
    body: line(o.orderNumber, o.product, o.address, o.team ? `driver: ${o.team}` : null),
    url: "/installation",
  });
}

// On-hand dropped below the SKU's reorder point.
export async function notifyLowStock(o: { name: string; onHand: number; reorderPoint?: number | null }): Promise<void> {
  await fire(R.warehouse, {
    title: "Low stock — reorder soon",
    body: line(o.name, `${o.onHand} left`, o.reorderPoint != null ? `below reorder point (${o.reorderPoint})` : "below reorder point"),
    url: "/inventory",
  });
}

// Low-stock alert that fires AT MOST ONCE per SKU per low episode. Inventory status is
// written by an RPC (with a direct-UPDATE fallback), so instead of hooking every write
// path we call this after a ship: it reads the row, and only alerts when the SKU is now
// Low/Out AND wasn't already flagged (a `low_notified_at` stamp guards re-alerts until
// stock recovers). Pass the same supabase client the caller already has.
export async function maybeNotifyLowStock(
  db: { from: (t: string) => any }, // eslint-disable-line @typescript-eslint/no-explicit-any
  inventoryId: number,
): Promise<void> {
  try {
    const { data: row } = await db.from("inventory")
      .select("product_name, oh_inv, status, low_notified_at").eq("id", inventoryId).maybeSingle();
    if (!row) return;
    const isLow = /low stock|out of stock/i.test(String(row.status ?? ""));
    if (!isLow) {
      // Recovered → clear the guard so the next dip alerts again.
      if (row.low_notified_at) await db.from("inventory").update({ low_notified_at: null }).eq("id", inventoryId);
      return;
    }
    if (row.low_notified_at) return; // already alerted this episode
    await db.from("inventory").update({ low_notified_at: new Date().toISOString() }).eq("id", inventoryId);
    await notifyLowStock({ name: String(row.product_name ?? "Item"), onHand: Number(row.oh_inv ?? 0), reorderPoint: 10 });
  } catch { /* best-effort */ }
}

// A purchase order was fully received into stock.
export async function notifyShipmentReceived(o: { poNumber: string; lines?: string | null; supplier?: string | null }): Promise<void> {
  await fire(R.warehouse, {
    title: "Shipment received",
    body: line(o.poNumber, o.lines, o.supplier ? `supplier ${o.supplier}` : null),
    url: "/incoming",
  });
}

// ================================ SERVICE & HR ====================================

// A defect / return was declared and awaits Operations approval.
export async function notifyReturnFiled(o: { rmaNo: string; orderNumber?: string | null; reason?: string | null; source?: string | null }): Promise<void> {
  await fire(R.ops, {
    title: "Return filed — needs approval",
    body: line(o.rmaNo, o.orderNumber, o.reason ? `Defect: ${o.reason}` : null, o.source ? `from ${o.source}` : null),
    url: "/operations/returns",
  });
}

// An HR request (leave / overtime) is pending approval.
export async function notifyHrRequest(o: { kind: "Leave" | "Overtime" | "Day off"; employee: string; date?: string | null; detail?: string | null }): Promise<void> {
  await fire(R.hr, {
    title: `${o.kind} request pending`,
    body: line(o.employee, o.kind, o.date, o.detail),
    url: o.kind === "Overtime" ? "/hr/overtime" : "/hr/leaves",
  });
}
