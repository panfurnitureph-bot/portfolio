import "server-only";
import { createServerSupabase } from "@/lib/supabase/server";
import { checkRateLimit } from "./rate-limit";

const OTP_TTL_MIN = 5;

// OTP is enforced only when the email transport is configured — otherwise login
// falls back to password-only so the app is never bricked before setup.
export function otpConfigured(): boolean {
  return !!process.env.N8N_OTP_WEBHOOK;
}

// Generate, store, and email a 6-digit code via the n8n webhook.
export async function sendOtp(email: string): Promise<void> {
  const webhook = process.env.N8N_OTP_WEBHOOK;
  if (!webhook) throw new Error("OTP email is not configured.");

  // Cap how many codes one email can request (anti-spam). 5 per 10 min.
  const limit = await checkRateLimit(`otp-send:${email}`, 5, 600);
  if (!limit.ok) throw new Error("Too many requests, try again later.");

  const code = String(Math.floor(100000 + Math.random() * 900000));
  const db = createServerSupabase();

  // Invalidate any previous unused codes for this email.
  await db.from("otp_codes").update({ used: true }).eq("email", email).eq("used", false);

  const expires_at = new Date(Date.now() + OTP_TTL_MIN * 60_000).toISOString();
  const { error } = await db.from("otp_codes").insert({ email, code, expires_at });
  if (error) throw new Error(error.message);

  const res = await fetch(webhook, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, code, ttl_minutes: OTP_TTL_MIN }),
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error("Failed to send the verification code.");
}

// Validate a code: must exist, be unused, and not expired. Marks it used.
export async function verifyOtp(email: string, code: string): Promise<boolean> {
  // Brute-force cap: 5 wrong attempts per 10 min per email. On exceed, behave
  // exactly like a wrong code (return false) — no info leak about the limit.
  const limit = await checkRateLimit(`otp-verify:${email}`, 5, 600);
  if (!limit.ok) return false;

  const db = createServerSupabase();
  const { data } = await db
    .from("otp_codes")
    .select("id, expires_at, used")
    .eq("email", email)
    .eq("code", code)
    .eq("used", false)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!data) return false;
  if (new Date(data.expires_at).getTime() < Date.now()) return false;

  await db.from("otp_codes").update({ used: true }).eq("id", data.id);
  return true;
}
