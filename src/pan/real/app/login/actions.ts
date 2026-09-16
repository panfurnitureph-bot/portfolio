"use server";

import { redirect } from "next/navigation";
import { createAuthClient } from "@/lib/supabase/auth-server";
import { createServerSupabase } from "@/lib/supabase/server";
import { sendOtp, verifyOtp, otpConfigured } from "@/lib/auth/otp";

export type OtpStart =
  | { status: "otp_sent" }
  // Return the session tokens so the CLIENT can setSession() — in the Capacitor Android
  // WebView the server action's Set-Cookie doesn't persist (SameSite/third-party cookie
  // handling), so the browser client writes the cookie in a context the WebView keeps.
  | { status: "logged_in"; access_token?: string; refresh_token?: string }
  | { status: "error"; error: string };

// Step 1: verify password + active status. If OTP is configured, discard the
// session and email a code; otherwise keep the session (password-only login).
export async function requestOtp(email: string, password: string): Promise<OtpStart> {
  const e = email.trim();
  const db = createServerSupabase();

  // PROFILE MUNA BAGO ANG SESSION (2026-09-05, "stuck sa Signing in sa APK"):
  // dati ay nag-sign-in muna (naglalagay na ng session cookies sa sagot) saka
  // tinitingnan ang profile — kapag wala, sign-out at error. Sa Android WebView
  // ang pag-set-saka-bura ng cookie sa iisang sagot ay hindi maaasahan: naiwan
  // ang session ng account na walang profile, at ang device ay umiikot sa
  // /login ↔ /dashboard (puti). Ngayon: kung walang profile o inactive, hindi
  // kailanman tatawagin ang sign-in — walang cookie na maiiwan.
  const { data: pre } = await db.from("profiles").select("id, status").ilike("email", e).limit(1).maybeSingle();
  if (!pre) {
    return { status: "error", error: "This login has no profile. Ask an administrator to create the App Login again." };
  }
  if (pre.status === "inactive") {
    return { status: "error", error: "Your account is inactive. Contact an administrator." };
  }

  const auth = await createAuthClient();
  const { data, error } = await auth.auth.signInWithPassword({ email: e, password });
  if (error || !data.user) {
    return { status: "error", error: "Invalid email or password." };
  }

  const { data: prof } = await db
    .from("profiles")
    .select("status")
    .eq("id", data.user.id)
    .single();
  if (!prof || prof.status === "inactive") {
    await auth.auth.signOut();
    return { status: "error", error: "Your account is inactive. Contact an administrator." };
  }

  if (!otpConfigured()) {
    // Hand the session to the client so it can setSession() — reliable cookie write in
    // the Android WebView, where the server Set-Cookie alone bounced back to /login.
    return {
      status: "logged_in",
      access_token: data.session?.access_token,
      refresh_token: data.session?.refresh_token,
    };
  }

  await auth.auth.signOut(); // throw away the partial session
  try {
    await sendOtp(e);
  } catch (err) {
    return {
      status: "error",
      error: err instanceof Error ? err.message : "Failed to send the code.",
    };
  }
  return { status: "otp_sent" };
}

export type OtpVerify = { error: string | null };

// Step 2: verify the code, then create the real session.
export async function verifyOtpAndLogin(
  email: string,
  password: string,
  code: string,
): Promise<OtpVerify> {
  const e = email.trim();
  const ok = await verifyOtp(e, code.trim());
  if (!ok) return { error: "Invalid or expired code." };

  const auth = await createAuthClient();
  const { error } = await auth.auth.signInWithPassword({ email: e, password });
  if (error) return { error: "Could not complete sign in. Try again." };

  redirect("/dashboard");
}
