// PAYMENT REVIEW CHECKS (2026-08-24) — ang mga automatic na pagsusuri ng
// Payment Approval desk. Purong function: binabasa ang row at nagbibigay ng
// listahan ng tsek na may antas (ok / warn / bad) at isang buod na bandila.
// Tumutulong lang ito sa aprubador — ang litrato at ang desisyon ay sa tao.

export type CheckLevel = "ok" | "warn" | "bad";
export type Check = { level: CheckLevel; text: string };

export type CheckInput = {
  amount: number;
  balanceBefore: number;
  orderTotal: number;
  proofs: string[];
  otherPending: number;
  method: string;
  createdAt: string;
  history: { amount: number; method: string | null; paidAt: string | null }[];
  // REWORK (2026-08-25) — ang parehong tsek ay tumatakbo sa koleksyon ng RMA,
  // pero ibang pitaka ang binibilang. Ang salitang "order" sa teksto ay
  // nagpapaakalang balanse ng order ang pinag-uusapan; ito ang nagpapalit.
  subject?: "order" | "rework";
};

const peso = (n: number) => "₱" + (Math.round(n * 100) / 100).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const r2 = (n: number) => Math.round(n * 100) / 100;

export function runPaymentChecks(r: CheckInput): Check[] {
  const out: Check[] = [];
  const amt = r2(r.amount), bal = r2(r.balanceBefore);
  const what = r.subject === "rework" ? "Rework" : "Order";
  // 1) Halaga vs balanse
  if (bal <= 0) out.push({ level: "bad", text: `${what} has no remaining balance — this would overpay` });
  else if (amt === bal) out.push({ level: "ok", text: "Amount equals the remaining balance — fully paid after approve" });
  else if (amt < bal) out.push({ level: "warn", text: `Amount is ${peso(bal - amt)} short of the balance — approving leaves ${peso(bal - amt)} unpaid (partial)` });
  else out.push({ level: "bad", text: `Amount is ${peso(amt - bal)} MORE than the balance` });
  // 2) May proof ba
  if (r.proofs.filter(Boolean).length > 0) out.push({ level: "ok", text: `Proof photo attached (${r.proofs.length})` });
  else out.push({ level: "bad", text: "No proof photo attached" });
  // 3) Doble: ibang pending sa parehong order
  if (r.otherPending > 0) out.push({ level: "warn", text: `${r.otherPending} other pending payment${r.otherPending > 1 ? "s" : ""} on this ${what.toLowerCase()} — check for a duplicate` });
  else out.push({ level: "ok", text: `No other pending payment on this ${what.toLowerCase()}` });
  // 4) Doble: parehong halaga at channel na naitala na sa loob ng 2 araw
  const now = Date.parse(r.createdAt) || Date.now();
  const same = r.history.find((h) => r2(h.amount) === amt && (h.method ?? "").toLowerCase() === r.method.toLowerCase()
    && h.paidAt && Math.abs(now - Date.parse(h.paidAt)) < 2 * 24 * 3600 * 1000);
  if (same) out.push({ level: "warn", text: `Same amount via ${r.method} already recorded on ${same.paidAt} — possible duplicate` });
  else out.push({ level: "ok", text: "Not a repeat of a recorded payment" });
  // 5) Halaga > 0
  if (amt <= 0) out.push({ level: "bad", text: "Amount is zero" });
  return out;
}

export function summarizeChecks(checks: Check[]): { level: CheckLevel; label: string; okCount: number; total: number } {
  const bad = checks.filter((c) => c.level === "bad").length;
  const warn = checks.filter((c) => c.level === "warn").length;
  const okCount = checks.length - bad - warn;
  if (bad) return { level: "bad", label: `${bad} problem${bad > 1 ? "s" : ""}`, okCount, total: checks.length };
  if (warn) return { level: "warn", label: `${warn} need${warn > 1 ? "" : "s"} a look`, okCount, total: checks.length };
  return { level: "ok", label: `${okCount}/${checks.length} green`, okCount, total: checks.length };
}

// Uri ng bayad para sa badge: DP, balanse, o partial.
export function paymentKindLabel(r: { amount: number; balanceBefore: number; paidBefore: number; orderTotal: number; subject?: "order" | "rework" }): string {
  const amt = r2(r.amount), bal = r2(r.balanceBefore);
  // Ang REWORK ay walang "downpayment / balanse" na hulma gaya ng order — isang
  // singil ito na kinokolekta. Ang "Balance · final payment" sa ulo ng review ay
  // nagmumukhang huling hulog sa kama, hindi bayad sa pagkumpuni.
  const rw = r.subject === "rework";
  if (rw) return bal > 0 && amt < bal ? `Rework · partial (${peso(bal - amt)} left)` : "Rework charge";
  if (r.paidBefore <= 0 && amt < r2(r.orderTotal)) return "Downpayment";
  if (bal > 0 && amt >= bal) return "Balance · final payment";
  if (bal > 0 && amt < bal) return `Partial · ${peso(bal - amt)} left after`;
  return "Payment";
}
