"use server";

// Attach a Maya slip photo to an order as payment proof. Light DB update only —
// the OCR itself runs IN THE BROWSER (the serverless platform kept timing out on
// server-side OCR). Protected from stale-form Save wipes by updateOrder's
// terminal-slips keep-filter.

import { createServerSupabase } from "@/lib/supabase/server";
import { getSession } from "@/lib/auth/session";

// Mga payment QR (BDO/BPI/GCash) para sa Installation collection — ang mga
// parehong card na naka-upload sa Quotation assets (quotation/ folder). Session
// lang ang gate (hindi quotations permission): ang installer/tablet accounts
// ang gagamit nito sa field.
export async function paymentQrAssets(): Promise<{ BDO: string | null; BPI: string | null; GCash: string | null; Maya: string | null }> {
  const none = { BDO: null, BPI: null, GCash: null, Maya: null };
  try {
    if (!(await getSession())) return none;
    const db = createServerSupabase();
    const { data } = await db.storage.from("product-images").list("quotation", { limit: 100 });
    const files = data ?? [];
    const find = (base: string): string | null => {
      const hit = files.find((f) => f.name.replace(/\.[^.]+$/, "") === base);
      if (!hit) return null;
      const pub = db.storage.from("product-images").getPublicUrl(`quotation/${hit.name}`).data.publicUrl;
      const stamp = hit.updated_at ?? hit.created_at ?? "";
      return stamp ? `${pub}?v=${Date.parse(stamp) || ""}` : pub;
    };
    return { BDO: find("bdo-qr"), BPI: find("bpi-qr"), GCash: find("gcash-qr"), Maya: find("maya-qr") };
  } catch {
    return none;
  }
}

export async function attachSlipPhoto(orderId: number, imageUrl: string): Promise<{ ok: true } | { error: string }> {
  try {
    if (!(await getSession())) return { error: "Forbidden." };
    if (!orderId || !imageUrl) return { error: "Missing order / image." };
    const db = createServerSupabase();
    const { data: ord } = await db.from("orders").select("transaction_images").eq("id", orderId).maybeSingle();
    const imgs = ((ord?.transaction_images as string[] | null) ?? []).filter(Boolean);
    if (!imgs.includes(imageUrl)) {
      const { error } = await db.from("orders").update({ transaction_images: [...imgs, imageUrl] }).eq("id", orderId);
      if (error) return { error: error.message };
    }
    return { ok: true };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Failed to attach the slip photo." };
  }
}
