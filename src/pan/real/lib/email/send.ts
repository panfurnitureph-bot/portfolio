import "server-only";
import { createServerSupabase } from "@/lib/supabase/server";

// ─────────────────────────────────────────────────────────────────────────────
// IISANG DAANAN NG LAHAT NG EMAIL (2026-08-26).
//
// Dating apat na magkakaibang fetch(hook) na may kanya-kanyang env var at
// walang tala: ang pumalya ay nawawala nang tahimik, at ang dobleng pindot ay
// dobleng email sa customer. Dito na dumadaan lahat:
//
//   • OUTBOX (0201) — bawat subok ay nakatala (kanino, uri, html, status,
//     error) — ito ang binabasa ng Email Log + Resend sa IMS;
//   • IDEMPOTENCY — parehong susi = hindi na ipapadala ulit ang na-send na;
//   • ISANG RETRY sa timeout bago ideklarang failed;
//   • PLAIN-TEXT — awtomatikong hango sa html (ipapasa ng n8n sa mailer
//     bilang text part kapag inayos na doon).
//
// Best-effort ang outbox: kapag wala pang 0201, tuloy pa rin ang padala —
// ang tala ay hindi dapat pumigil sa email.
// ─────────────────────────────────────────────────────────────────────────────

type SB = ReturnType<typeof createServerSupabase>;

export type SendEmailInput = {
  to: string;
  subject: string;
  html: string;
  type: string;                       // order_confirmed / receipt / delivery_confirmation / ...
  orderId?: number | null;
  orderNumber?: string | null;
  refNo?: string | null;              // RMA- atbp.
  hook?: string | null;               // default: N8N_RECEIPT_WEBHOOK
  // Dagdag na payload ng hook (pdf_base64, filename, qr, track_url, ...).
  extra?: Record<string, unknown>;
  // Parehong susi = isang email lang kahit maulit ang tawag.
  idempotencyKey?: string | null;
  db?: SB;
};

// Payak na text na bersyon mula sa html — pambaba ng spam score at pambasa ng
// lumang clients. Hindi kailangang maganda; kailangang totoo ang laman.
export function htmlToText(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<br\s*\/?>(?=.)/gi, "\n")
    .replace(/<\/(p|tr|div|h\d|li)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&#8369;/g, "₱").replace(/&middot;/g, "·").replace(/&mdash;/g, "—").replace(/&ndash;/g, "–").replace(/&zwnj;/g, "")
    .split("\n").map((l) => l.trim()).filter(Boolean).join("\n");
}

export async function sendEmail(input: SendEmailInput): Promise<{ ok: boolean; skipped?: boolean; error?: string }> {
  const hook = input.hook || process.env.N8N_RECEIPT_WEBHOOK;
  const to = (input.to || "").trim();
  if (!hook) return { ok: false, error: "No email hook configured." };
  if (!to) return { ok: false, error: "No recipient email." };
  const db = input.db ?? createServerSupabase();

  // ── Idempotency: nauna nang na-send ang susing ito? Huwag nang ulitin. ────
  let rowId: number | null = null;
  try {
    if (input.idempotencyKey) {
      const { data: prev } = await db.from("email_outbox")
        .select("id, status").eq("idempotency_key", input.idempotencyKey).maybeSingle();
      if (prev && prev.status === "sent") return { ok: true, skipped: true };
      rowId = (prev?.id as number | undefined) ?? null;
    }
    if (rowId == null) {
      const { data: ins } = await db.from("email_outbox").insert({
        email_type: input.type, to_email: to, subject: input.subject, html: input.html,
        order_id: input.orderId ?? null, order_number: input.orderNumber ?? null,
        ref_no: input.refNo ?? null, status: "pending",
        has_attachment: !!(input.extra && ("pdf_base64" in input.extra)),
        idempotency_key: input.idempotencyKey ?? null,
      }).select("id").single();
      rowId = (ins?.id as number | undefined) ?? null;
    }
  } catch { /* wala pang 0201 — tuloy pa rin ang padala */ }

  const payload = JSON.stringify({
    to, subject: input.subject, html: input.html, text: htmlToText(input.html),
    order_number: input.orderNumber ?? null, type: input.type,
    ...(input.extra ?? {}),
  });

  // ── Padala, isang retry sa bigo ───────────────────────────────────────────
  let lastErr = "";
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const res = await fetch(hook, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: payload, signal: AbortSignal.timeout(20000),
      });
      if (res.ok) {
        try {
          if (rowId != null) await db.from("email_outbox").update({ status: "sent", sent_at: new Date().toISOString(), attempts: attempt, error: null }).eq("id", rowId);
        } catch { /* tala lang */ }
        return { ok: true };
      }
      lastErr = `Hook returned ${res.status}`;
    } catch (e) {
      lastErr = e instanceof Error ? e.message : String(e);
    }
  }
  try {
    if (rowId != null) await db.from("email_outbox").update({ status: "failed", attempts: 2, error: lastErr }).eq("id", rowId);
  } catch { /* tala lang */ }
  return { ok: false, error: lastErr };
}

// Muling ipadala ang isang naitala nang email — ang nakalagak na html mismo.
// (Ang attachment ay hindi naitatago; ang resend ng may-attachment ay ang html
// lang ang dala — nakasaad iyon sa UI.)
export async function resendOutboxEmail(id: number): Promise<{ ok: boolean; error?: string }> {
  const db = createServerSupabase();
  const { data: row } = await db.from("email_outbox").select("*").eq("id", id).maybeSingle();
  if (!row) return { ok: false, error: "Email record not found." };
  const r = await sendEmail({
    to: row.to_email as string,
    subject: row.subject as string,
    html: (row.html as string | null) ?? "",
    type: row.email_type as string,
    orderId: (row.order_id as number | null) ?? null,
    orderNumber: (row.order_number as string | null) ?? null,
    refNo: (row.ref_no as string | null) ?? null,
    db,
  });
  return r.ok ? { ok: true } : { ok: false, error: r.error };
}
