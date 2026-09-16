// IISANG tuntunin sa buong app: ang "Shipping" / "Shipping Fee" na linya sa
// receipt_items ay BAYARIN (kasama sa kabuuang halaga at resibo), HINDI
// produkto. Sa lahat ng operational na listahan ng items (assign, QC, pack,
// delivery QA, installation, warranty, returns, payouts, product analytics)
// ay hindi ito dapat lumitaw bilang item — ang order form ay may sarili
// nitong "Shipping Fee" section para rito.
// KASAMA ANG PER-ITEM NA DAGDAG (2026-08-29). Ang "Addtl. Shipping Fee" at
// "Addtl. Rush Fee" ay bayarin rin — idinagdag sila sa tabi ng isang produkto
// sa Edit Order, at line item sila sa data para makasama sa kabuuang halaga.
// Pero ang `/^shipping\b/` ay hindi sila nahuhuli, kaya nakalusot sila bilang
// PRODUKTO: sa Delivery QA ay may sariling card ang bawat isa, may "No image"
// at may GOOD/DEFECT na susuriin — walang susuriin sa isang bayad. Nasa
// listahan rin sila ng Installation, ng payout ng HR, at ng product analytics.
// Ang "shipping" ay bayarin kahit mag-isa (ganoon ito naitala ng order form);
// ang "rush" at "delivery" ay bayarin lang kapag may kasamang "fee" o may
// "Addtl."/"Additional" na panimula — para walang tunay na produktong
// nagkataóng nagsisimula sa salitang iyon ang mahulog sa bitag.
const FEE = /^(?:(?:addtl\.?|additional)\s+(?:shipping|rush|delivery)\b|shipping\b|(?:rush|delivery)\s+fee\b)/i;

export function isShippingDesc(desc: string | null | undefined): boolean {
  return FEE.test(String(desc ?? "").trim());
}
