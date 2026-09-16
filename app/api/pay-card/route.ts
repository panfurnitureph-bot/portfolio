// PAY CARD — isinisingil ang tokenized card sa pamamagitan ng PAN Furnitures app.
//
// Ang browser ay nagpapadala lang ng gamit-minsang paymentTokenId. Ang halaga
// ay SINASADYANG hindi tinatanggap mula sa client — ang app ang kumukuha niyon
// mula sa naka-save na order, kaya hindi ito mapapakialaman mula sa browser.
//
// Kailangan sa .env.local:
//   PAN_APP_URL=https://pan-furnitures.vercel.app
//   PAN_APP_WEBHOOK_SECRET=<parehong secret ng app>

import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const appUrl = process.env.PAN_APP_URL;
  const secret = process.env.PAN_APP_WEBHOOK_SECRET;

  if (!appUrl || !secret) {
    return NextResponse.json(
      { ok: false, code: "VAULT_UNAVAILABLE", error: "Card payments are not configured." },
      { status: 503 },
    );
  }

  let payload: { order_id?: string; payment_token_id?: string };
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON" }, { status: 400 });
  }

  if (!payload.order_id || !payload.payment_token_id) {
    return NextResponse.json(
      { ok: false, error: "order_id and payment_token_id are required" },
      { status: 400 },
    );
  }

  try {
    const res = await fetch(`${appUrl.replace(/\/$/, "")}/api/maya/charge-card`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-webhook-secret": secret,
      },
      // Tanging ang order id at token ang ipinapasa — walang halaga, walang
      // card data. Ang app ang nagpapasya kung magkano ang sisingilin.
      body: JSON.stringify({
        order_id: payload.order_id,
        payment_token_id: payload.payment_token_id,
        // Pagkatapos ng 3DS, dito sa tindahan ibalik ang customer — hindi sa
        // app. Kung wala nito, sa /pay page ng app siya mapupunta.
        return_url: `${new URL(req.url).origin}/pay`,
      }),
      cache: "no-store",
    });

    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      // 403 mula sa Maya = hindi naka-provision ang Vault. Ipinapaalam natin
      // ito sa UI para makabalik sa hosted Checkout sa halip na mag-dead-end.
      const code =
        res.status === 403 || data?.code === "VAULT_UNAVAILABLE"
          ? "VAULT_UNAVAILABLE"
          : undefined;
      return NextResponse.json(
        { ok: false, ...(code ? { code } : {}), error: data?.error ?? `Payment failed (${res.status})` },
        { status: res.status === 403 ? 403 : 502 },
      );
    }

    return NextResponse.json({ ok: true, ...data });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: (e as Error).message },
      { status: 502 },
    );
  }
}
