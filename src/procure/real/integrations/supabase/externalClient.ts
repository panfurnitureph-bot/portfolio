// External Supabase client for Northwind Motor Parts database
// This is the ONLY Supabase client the app should use for data operations.
import { createClient } from "@supabase/supabase-js";

const EXTERNAL_SUPABASE_URL = "https://demo-storage.example.invalid";
const EXTERNAL_SUPABASE_ANON_KEY =
  "demo-anon-key-not-configured";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _instance: any = null;

function getClient() {
  if (!_instance) {
    _instance = createClient<any>(EXTERNAL_SUPABASE_URL, EXTERNAL_SUPABASE_ANON_KEY, {
      auth: {
        persistSession: true,  // ✅ Enable session persistence
        autoRefreshToken: true,  // ✅ Auto-refresh tokens
        // true so magic link tokens in the URL hash are auto-exchanged for a session
        detectSessionInUrl: true,
      },
      // Realtime throughput: the default cap is 10 events/sec, so bulk edits
      // (many forecast rows changed quickly) drain to other users at ~10/s — a
      // 50-row burst takes ~5s to reflect. Raise it so bursts arrive fast; the
      // RealtimeProvider's 200ms batch still coalesces them into smooth renders.
      realtime: {
        params: { eventsPerSecond: 100 },
      },
    });
  }
  return _instance;
}

export const externalSupabase = getClient();

// Export for convenience
export const EXTERNAL_PROJECT_URL = EXTERNAL_SUPABASE_URL;
export const EXTERNAL_ANON_KEY = EXTERNAL_SUPABASE_ANON_KEY;

// Set to true while OTP 2FA is in-flight so AuthContext ignores the
// SIGNED_IN event emitted by signInWithPassword (which we immediately revoke).
export let otpPending = false;
export function setOtpPending(v: boolean) { otpPending = v; }
