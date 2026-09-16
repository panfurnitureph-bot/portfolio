// ============================================================
// CHECKOUT MODULE — kasalukuyang NAKA-OFF ang totoong payment.
//
// Kapag handa ka nang magbayad online gamit ang Stripe:
//   1. Gumawa ng Stripe account sa https://stripe.com (libre)
//   2. npm install stripe @stripe/stripe-js
//   3. Ilagay ang STRIPE_SECRET_KEY sa .env.local
//   4. Palitan ang startCheckout() sa ibaba ng tawag sa
//      Stripe Checkout Session (tingnan ang README, section
//      "Paano buksan ang totoong payment").
// ============================================================

export type CheckoutResult = {
  ok: boolean;
  message: string;
};

// TODO(STRIPE): Palitan ang laman nito ng Stripe Checkout redirect
// kapag bubuksan na ang totoong payment.
export async function startCheckout(): Promise<CheckoutResult> {
  return {
    ok: false,
    message:
      "Payment coming soon — contact us to order! Email panfurnitureph@gmail.com.",
  };
}

export const PAYMENT_ENABLED = false;
