"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AuthShell, authInput, authLabel, btnNavy } from "@/components/auth-shell";
import { requestOtp, verifyOtpAndLogin } from "./actions";
import { createBrowserSupabase } from "@/lib/supabase/client";

function EyeButton({ shown, onClick }: { shown: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={shown ? "Hide password" : "Show password"}
      className="absolute right-3 top-1/2 -translate-y-1/2 text-stone-400 hover:text-stone-600"
    >
      {shown ? (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9.9 4.2A9.1 9.1 0 0 1 12 4c5 0 9 4.5 10 8a13 13 0 0 1-2 3M6.6 6.6C3.9 8.2 2.3 10.8 2 12c1 3.5 5 8 10 8a9 9 0 0 0 4-.9" /><path d="m2 2 20 20" /></svg>
      ) : (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M2 12s3.5-8 10-8 10 8 10 8-3.5 8-10 8-10-8-10-8Z" /><circle cx="12" cy="12" r="3" /></svg>
      )}
    </button>
  );
}

export default function LoginPage() {
  const router = useRouter();
  const [step, setStep] = useState<"login" | "otp">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [resendIn, setResendIn] = useState(0);
  const [remember, setRemember] = useState(false);
  // Gate the persist effect until the initial restore has run. Without this, the
  // persist effect fires on the very first render (remember=false, email="") and
  // its else-branch removeItem() WIPES the saved credentials before the restore
  // effect can read them — so "Remember me" silently forgot the login every time.
  const [hydrated, setHydrated] = useState(false);

  // Restore saved credentials on mount (opt-in "Remember me"). Stored locally on this
  // device only. Note: convenient for a trusted tablet/PC, but the password is kept in
  // local storage in plain text — don't tick it on a shared/public machine.
  useEffect(() => {
    try {
      const saved = localStorage.getItem("pan_login");
      if (saved) {
        const { email: e, password: p } = JSON.parse(saved) as { email?: string; password?: string };
        if (e) setEmail(e);
        if (p) setPassword(p);
        setRemember(true);
      }
    } catch { /* ignore */ }
    // Dumating mula /api/auth/stale (2026-09-05): ang dating login ng device ay
    // wala nang profile — sabihin kung bakit nandito ulit ang user.
    try {
      if (new URLSearchParams(window.location.search).get("stale") === "1") {
        setError("Your previous sign-in is no longer valid on this device. Please sign in again.");
      }
    } catch { /* ignore */ }
    // ANG LOGIN FORM AY LAGING BAGONG SIMULA (2026-09-05, Huawei kiosk tablet):
    // sa APK, ang unang page load ay dumadaan sa Java proxy ng Capacitor na
    // hindi pa nakakakita ng cookies pagkabukas ng app — kaya ang server ay
    // nagpapakita ng login form kahit may LUMANG session pa ang WebView. Sa
    // sandaling mag-hydrate, ang mga fetch (na may cookie) ay hinihila na ang
    // user sa lumang account: nawawala ang form, hindi pumapasok ang tina-type
    // na credentials, at ang kiosk role ay walang labasan. Kung nasa login form
    // ang user, gusto niyang mag-login nang bago — burahin ang anumang session.
    // WALANG cookie cleanup dito (2026-09-05, huling desisyon). Dalawang beses
    // itong sinubukan at dalawang beses nakasira: (a) client-side signOut na
    // nag-revoke ng session pero nabigong burahin ang cookie → ZOMBIE cookie →
    // /login ↔ /dashboard loop sa dalawang PC; (b) sa APK, ang unang page load
    // ay dumadaan sa Java proxy ng Capacitor na HINDI pa nagdadala ng cookie,
    // kaya laging lumalabas ang login form kahit naka-login — anumang cleanup
    // dito ay NAGLA-LOGOUT sa APK sa bawat pagbukas. Ang tamang lugar ng
    // paglilinis ay ang server: ang proxy ay nagve-verify sa /login at
    // binubura ang patay na cookie; ang root layout ay nagpapadala ng
    // "session pero walang profile" sa /api/auth/stale. Dito: form lang.
    setHydrated(true); // restore done — the persist effect may now run safely
  }, []);

  // Persist or clear the saved credentials whenever the toggle or fields change.
  // Skipped until `hydrated` so it can't clobber the restore on first paint.
  useEffect(() => {
    if (!hydrated) return;
    try {
      if (remember && email) localStorage.setItem("pan_login", JSON.stringify({ email, password }));
      else localStorage.removeItem("pan_login");
    } catch { /* ignore */ }
  }, [hydrated, remember, email, password]);
  // Show the "GET THE APP" downloads only in a plain browser — hide them when we're
  // already running INSIDE the app (Electron desktop shell or the Capacitor Android
  // WebView), where downloading the installer again makes no sense.
  const [isBrowser, setIsBrowser] = useState(false);
  useEffect(() => {
    const ua = navigator.userAgent || "";
    const inElectron = /Electron/i.test(ua);
    const inCapacitor =
      typeof (window as unknown as { Capacitor?: unknown }).Capacitor !== "undefined" ||
      /pan-?system|panfurniture/i.test(ua);
    setIsBrowser(!inElectron && !inCapacitor);
  }, []);

  useEffect(() => {
    if (resendIn <= 0) return;
    const t = setTimeout(() => setResendIn((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [resendIn]);

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    const res = await requestOtp(email, password);
    if (res.status === "error") { setLoading(false); setError(res.error); return; }
    if (res.status === "logged_in") {
      // Write the session cookie from the CLIENT via the browser Supabase client. The
      // server action's Set-Cookie did not persist in the Capacitor Android WebView
      // (cookie bounced straight back to /login); setSession() writes it in the WebView's
      // own document context, which it keeps. Then do a full navigation to /dashboard.
      const go = () => { window.location.href = window.location.origin + "/dashboard"; };
      if (res.access_token && res.refresh_token) {
        try {
          const supabase = createBrowserSupabase();
          await supabase.auth.setSession({
            access_token: res.access_token,
            refresh_token: res.refresh_token,
          });
        } catch { /* fall through to navigate; server cookie may still be present */ }
      }
      go();
      return;
    }
    setLoading(false);
    setStep("otp");
    setResendIn(60);
  }

  async function handleVerify(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    const res = await verifyOtpAndLogin(email, password, code);
    setLoading(false);
    if (res?.error) setError(res.error);
  }

  async function handleResend() {
    if (resendIn > 0) return;
    setError(null);
    const res = await requestOtp(email, password);
    if (res.status === "error") setError(res.error);
    else setResendIn(60);
  }

  const maskedEmail = email.replace(/^(.{2}).*(@.*)$/, "$1***$2");

  return (
    <AuthShell>
      {step === "login" ? (
        <form onSubmit={handleLogin}>
          <h1 className="text-center text-2xl font-bold tracking-tight text-[#2a2519]">
            Sign in
          </h1>
          <p className="mb-6 mt-1 text-center text-sm text-stone-500">
            Login using your account credentials
          </p>

          <label className={authLabel} htmlFor="email">Email</label>
          <input
            id="email"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className={authInput}
            placeholder="name@company.com"
          />

          <label className={`${authLabel} mt-4`} htmlFor="password">Password</label>
          <div className="relative">
            <input
              id="password"
              type={showPw ? "text" : "password"}
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className={`${authInput} pr-10`}
              placeholder="••••••••"
            />
            <EyeButton shown={showPw} onClick={() => setShowPw((s) => !s)} />
          </div>

          <div className="mt-2 flex items-center justify-between">
            <label className="flex cursor-pointer items-center gap-2 text-sm text-stone-600 select-none">
              <input
                type="checkbox"
                checked={remember}
                onChange={(e) => setRemember(e.target.checked)}
                className="h-4 w-4 rounded border-stone-300 text-[#5b5026] focus:ring-[#caa45a]"
              />
              Remember me
            </label>
            <a
              href="/forgot-password"
              className="inline-block text-sm font-medium text-[#5b5026] hover:underline"
            >
              Forgot password?
            </a>
          </div>

          {error && (
            <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 ring-1 ring-inset ring-red-600/20">
              {error}
            </p>
          )}

          <div className="mt-5">
            <button type="submit" disabled={loading} className={btnNavy}>
              {loading ? "Signing in…" : "Sign in"}
            </button>
          </div>

          <p className="mt-4 text-center text-sm text-stone-500">
            Don&apos;t have an account?{" "}
            <span className="font-medium text-stone-400">Ask an administrator</span>
          </p>

          {/* App downloads — browser only (hidden inside the installed app). Ang
              Android APK ay mula sa SUPABASE STORAGE (Google Trust cert) — hindi
              same-origin: ang Let's Encrypt cert ng vercel.app ay hindi na
              pinagkakatiwalaan ng lumang Android/Huawei kaya "invalid link" ang
              download manager (naiulat 2026-08-16). */}
          {isBrowser && (
          <div className="mt-5 space-y-2">
            <p className="text-center text-xs font-medium uppercase tracking-wide text-stone-400">Get the app</p>
            <div className="grid grid-cols-3 gap-2">
              <a
                href="https://ujxzhdkzjgiulvhlcehr.supabase.co/storage/v1/object/public/product-images/app/pan-furniture.apk"
                download
                className="flex flex-col items-center justify-center gap-1 rounded-xl border border-[#d8cdb0] bg-[#faf8f3] px-2 py-2.5 text-xs font-semibold text-[#4a3b1a] transition hover:bg-[#f4ead8] active:scale-[0.98]"
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M6 18a1 1 0 0 0 1 1h1v3.5a1.5 1.5 0 0 0 3 0V19h2v3.5a1.5 1.5 0 0 0 3 0V19h1a1 1 0 0 0 1-1V8H6v10ZM3.5 8A1.5 1.5 0 0 0 2 9.5v6a1.5 1.5 0 0 0 3 0v-6A1.5 1.5 0 0 0 3.5 8Zm17 0A1.5 1.5 0 0 0 19 9.5v6a1.5 1.5 0 0 0 3 0v-6A1.5 1.5 0 0 0 20.5 8ZM15.53 2.16l1.3-1.3a.5.5 0 0 0-.7-.7l-1.48 1.47A5.94 5.94 0 0 0 12 1c-.97 0-1.88.23-2.68.63L7.87.16a.5.5 0 1 0-.7.7l1.3 1.3A5.97 5.97 0 0 0 6 7h12a5.97 5.97 0 0 0-2.47-4.84ZM10 5a1 1 0 1 1 0-2 1 1 0 0 1 0 2Zm4 0a1 1 0 1 1 0-2 1 1 0 0 1 0 2Z"/></svg>
                Android
              </a>
              <a
                href="/updates/PAN-System-Setup.exe"
                download
                className="flex flex-col items-center justify-center gap-1 rounded-xl border border-[#d8cdb0] bg-[#faf8f3] px-2 py-2.5 text-xs font-semibold text-[#4a3b1a] transition hover:bg-[#f4ead8] active:scale-[0.98]"
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M3 5.1 10 4v7.5H3V5.1ZM11 3.9 21 2.5v9H11v-7.6ZM3 12.5h7V20l-7-1.1v-6.4ZM11 12.5h10v9L11 20v-7.5Z"/></svg>
                Windows
              </a>
              <a
                href="/updates/PAN-System.dmg"
                download
                className="flex flex-col items-center justify-center gap-1 rounded-xl border border-[#d8cdb0] bg-[#faf8f3] px-2 py-2.5 text-xs font-semibold text-[#4a3b1a] transition hover:bg-[#f4ead8] active:scale-[0.98]"
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M16.5 1.5c.1 1-.3 2-.9 2.7-.6.8-1.6 1.4-2.6 1.3-.1-1 .4-2 .9-2.7.6-.7 1.7-1.3 2.6-1.3ZM19.5 8.6c-1 .5-1.6 1.5-1.6 2.7 0 1.4.9 2.4 1.8 2.9-.4 1.1-.9 2.2-1.7 3.3-.7 1-1.4 2-2.5 2-1 0-1.4-.6-2.6-.6-1.2 0-1.6.6-2.6.6-1 0-1.8-1-2.5-2-1.5-2.1-2.6-6-1.1-8.6.7-1.3 2-2.1 3.4-2.2 1 0 1.9.7 2.6.7.6 0 1.8-.8 3-.7.5 0 1.9.2 2.9 1.6-.1 0-1.7 1-1.6 2.9Z"/></svg>
                macOS
              </a>
            </div>
          </div>
          )}

        </form>
      ) : (
        <form onSubmit={handleVerify}>
          <h1 className="text-center text-2xl font-bold tracking-tight text-[#2a2519]">
            Verify it&apos;s you
          </h1>
          <p className="mb-6 mt-1 text-center text-sm text-stone-500">
            Enter the 6-digit code sent to {maskedEmail}
          </p>

          <label className={authLabel} htmlFor="code">Verification code</label>
          <input
            id="code"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            required
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
            className={`${authInput} text-center text-lg tracking-[0.5em]`}
            placeholder="123456"
          />

          {error && (
            <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 ring-1 ring-inset ring-red-600/20">
              {error}
            </p>
          )}

          <div className="mt-5">
            <button type="submit" disabled={loading || code.length !== 6} className={btnNavy}>
              {loading ? "Verifying…" : "Verify & sign in"}
            </button>
          </div>

          <div className="mt-4 flex items-center justify-between text-sm">
            <button
              type="button"
              onClick={() => { setStep("login"); setCode(""); setError(null); }}
              className="font-medium text-stone-500 hover:text-stone-700"
            >
              ← Back
            </button>
            <button
              type="button"
              onClick={handleResend}
              disabled={resendIn > 0}
              className="font-medium text-[#5b5026] hover:underline disabled:text-stone-400 disabled:no-underline"
            >
              {resendIn > 0 ? `Resend in ${resendIn}s` : "Resend code"}
            </button>
          </div>
        </form>
      )}
    </AuthShell>
  );
}
