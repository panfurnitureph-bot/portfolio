"use server";

import { createServerSupabase } from "@/lib/supabase/server";
import { requireAnyEdit } from "@/lib/auth/guard";
import { resendOutboxEmail } from "@/lib/email/send";
import { audit } from "@/lib/audit";

// EMAIL LOG NG ISANG ORDER (0201) — ang binabasa ng sobre-button sa Sales
// Orders. Bawat padala: uri, kanino, kailan, status, dahilan ng bigo.
export type EmailLogRow = {
  id: number;
  email_type: string;
  to_email: string;
  subject: string;
  status: string;
  error: string | null;
  has_attachment: boolean;
  created_at: string;
  sent_at: string | null;
};

export async function loadEmailLog(orderId: number): Promise<EmailLogRow[]> {
  const db = createServerSupabase();
  try {
    const { data } = await db.from("email_outbox")
      .select("id, email_type, to_email, subject, status, error, has_attachment, created_at, sent_at")
      .eq("order_id", orderId)
      .order("id", { ascending: false })
      .limit(100);
    return (data ?? []) as EmailLogRow[];
  } catch { return []; /* wala pang 0201 */ }
}

// Muling ipadala ang isang naitala nang email — ang nakalagak na html mismo.
export async function resendEmail(id: number): Promise<{ ok: true } | { error: string }> {
  await requireAnyEdit(["orders", "ops_approval"]);
  const r = await resendOutboxEmail(id);
  if (!r.ok) return { error: r.error ?? "Resend failed." };
  await audit({ module: "orders", table: "email_outbox", recordId: id, action: "update", after: { resent: true } });
  return { ok: true };
}
