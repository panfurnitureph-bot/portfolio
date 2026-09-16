// TOTP (Google Authenticator) MFA helpers — thin wrapper over the ONE app
// Supabase client. This is an ADDITIONAL step layered after the existing
// email-OTP 2FA: login → email OTP → (enroll once) → TOTP verify → aal2.
import { externalSupabase as supabase } from "@/integrations/supabase/externalClient";

export type AalLevel = "aal1" | "aal2" | null;

/** Current vs next Authenticator Assurance Level for the active session.
 *  - current 'aal2'                → fully verified, allow through
 *  - current 'aal1', next 'aal2'   → has a verified factor, must verify this session
 *  - current 'aal1', next 'aal1'   → no verified factor, must enroll */
export async function getAal(): Promise<{ current: AalLevel; next: AalLevel }> {
  const { data, error } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  if (error || !data) return { current: null, next: null };
  return {
    current: (data.currentLevel ?? null) as AalLevel,
    next: (data.nextLevel ?? null) as AalLevel,
  };
}

/** First verified TOTP factor, or null. */
export async function getVerifiedTotpFactor(): Promise<{ id: string } | null> {
  const { data } = await supabase.auth.mfa.listFactors();
  const totp = (data?.totp ?? []) as Array<{ id: string; status: string }>;
  return totp.find((f) => f.status === "verified") ?? null;
}

/** Remove any leftover UNVERIFIED factors so a fresh enroll doesn't collide
 *  with a stale one (Supabase rejects duplicate friendly names). */
export async function cleanupUnverifiedFactors(): Promise<void> {
  const { data } = await supabase.auth.mfa.listFactors();
  const all = (data?.all ?? []) as Array<{ id: string; status: string }>;
  await Promise.all(
    all.filter((f) => f.status === "unverified").map((f) => supabase.auth.mfa.unenroll({ factorId: f.id })),
  );
}

/** Start a TOTP enrollment — returns the QR (SVG data URI), manual secret, and factor id. */
export async function enrollTotp() {
  await cleanupUnverifiedFactors();
  const { data, error } = await supabase.auth.mfa.enroll({
    factorType: "totp",
    friendlyName: "authenticator",
  });
  if (error || !data) return { error: error ?? new Error("Enrollment failed"), qr: null, secret: null, factorId: null };
  return { error: null, qr: data.totp.qr_code, secret: data.totp.secret, factorId: data.id };
}

/** Challenge + verify a 6-digit code for a factor. On success the session is
 *  upgraded to aal2. Returns { error } (null on success). */
export async function challengeAndVerify(factorId: string, code: string): Promise<{ error: Error | null }> {
  const { data: challenge, error: cErr } = await supabase.auth.mfa.challenge({ factorId });
  if (cErr || !challenge) return { error: cErr ?? new Error("Challenge failed") };
  const { error: vErr } = await supabase.auth.mfa.verify({ factorId, challengeId: challenge.id, code });
  return { error: vErr ?? null };
}

/** Days between forced TOTP re-verifications — Supabase's own aal2 status
 *  never expires on its own within a live session, so this is enforced
 *  separately via `profiles.last_mfa_verified_at`. */
export const MFA_REVERIFY_DAYS = 3;

/** Stamp "verified now" after a successful challengeAndVerify, so the
 *  3-day re-verify window (see AuthContext's needsMfaVerify) resets. */
export async function markMfaVerified(userId: string): Promise<void> {
  await supabase.from("profiles").update({ last_mfa_verified_at: new Date().toISOString() }).eq("id", userId);
}
