// Pure downpayment rules shared by server actions and client components.
// Kept out of the "use server" files, which may only export async functions.

// Ang hinihinging downpayment sa isang bagong order: 30% ng kabuuan. Ito ang
// SINISINGIL (quotation, Maya charge, payment link) at hindi ito nagbago.
export const DOWNPAYMENT_RATE = 0.3;

// ANG PAGBAYAD ANG NAGLALAAN NG STOCK (2026-08-29) ─────────────────────────────
// Dati, 30% ang gate dito rin: hanggang hindi umaabot doon ang bayad, malaya
// pa ring naibebenta ang stock. Sumisira iyon sa isang ordinaryong pangyayari —
// ang pagdaragdag ng item sa isang order na may bayad na. Ang porsyento ay
// sinusukat laban sa isang kabuuang GUMAGALAW, kaya ang ORD-000015 na nagbayad
// ng ₱7,500 sa ₱25,000 (30%, reserved) ay bumagsak sa 16.7% nang magdagdag ng
// ₱20,000 na upuan — at NAWALA ang laan sa dalawa, pati sa unang binayaran na.
// Naka-commit na ang customer; hindi mababawi ng bagong item ang commitment na
// iyon. Kaya: anumang bayad ay naglalaan ng LAHAT ng linya sa order.
//
// Ang 30% ay nananatiling hinihingi sa customer — DOWNPAYMENT_RATE ang gamit
// doon. Ang gate na ito ay tungkol lang sa kung kanino nakalaan ang stock.
//
// Kailangang eksaktong katugma nito ang SQL sa fn_inventory_resync_reserved
// (0210); kapag naghiwalay sila, magkaiba ang bilang ng Inventory at Orders.
export function meetsDownpayment(downpayment: number, fullPayment: number, total: number): boolean {
  const t = Number(total) || 0;
  if (t <= 0) return true; // walang kabuuan, walang maigagate (manual/legacy)
  const paid = (Number(downpayment) || 0) + (Number(fullPayment) || 0);
  return paid > 0.005; // maliit na epsilon para sa float rounding
}
