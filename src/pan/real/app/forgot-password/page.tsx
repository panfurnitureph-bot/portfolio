"use client";

import { useState } from "react";
import Link from "next/link";
import { AuthShell, authInput, authLabel, btnPrimary } from "@/components/auth-shell";
import { createBrowserSupabase } from "@/lib/supabase/client";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    const sb = createBrowserSupabase();
    const { error } = await sb.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: `${window.location.origin}/reset-password`,
    });
    setLoading(false);
    if (error) setError(error.message);
    else setSent(true);
  }

  if (sent) {
    return (
      <AuthShell>
        <div className="flex flex-col items-center text-center">
          <div className="relative mb-4">
            <svg width="56" height="56" viewBox="0 0 24 24" fill="none" stroke="#5b5026" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
              <rect x="2" y="4" width="20" height="16" rx="2" />
              <path d="m2 7 10 6 10-6" />
            </svg>
            <span className="absolute -right-1 -top-1 flex h-5 w-5 items-center justify-center rounded-full bg-[#5b5026] text-white">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="m5 12 5 5L20 7" /></svg>
            </span>
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-[#2a2519]">Check your mail</h1>
          <p className="mt-1 text-sm text-stone-500">
            We have sent an email with a link to reset your password.
          </p>
          <Link href="/login" className={`${btnPrimary} mt-6 text-center`}>
            Back to Login
          </Link>
          <p className="mt-4 text-xs text-stone-400">
            Didn&apos;t receive it? Check your spam folder or try another email address.
          </p>
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell>
      <form onSubmit={handleSubmit}>
        <Link href="/login" className="mb-4 inline-flex items-center gap-1 text-sm font-medium text-[#2a2519] hover:text-stone-600">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m15 18-6-6 6-6" /></svg>
          Back
        </Link>
        <h1 className="text-2xl font-bold tracking-tight text-[#2a2519]">Reset Password</h1>
        <p className="mb-6 mt-1 text-sm text-stone-500">
          Enter the email associated with your account and we will send an email with
          instructions to reset your password.
        </p>

        <label className={authLabel} htmlFor="email">Email Address</label>
        <input
          id="email"
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className={authInput}
          placeholder="name@company.com"
        />

        {error && (
          <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 ring-1 ring-inset ring-red-600/20">
            {error}
          </p>
        )}

        <div className="mt-5">
          <button type="submit" disabled={loading} className={btnPrimary}>
            {loading ? "Sending…" : "Reset Password"}
          </button>
        </div>
      </form>
    </AuthShell>
  );
}
