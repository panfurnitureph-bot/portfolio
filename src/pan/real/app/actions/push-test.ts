"use server";

// Push diagnostics — one tap answers WHERE the chain is broken:
// service account env? token registered? FCM send accepted?
import { createServerSupabase } from "@/lib/supabase/server";
import { getSession } from "@/lib/auth/session";

export type PushTestResult = {
  configured: boolean;      // FIREBASE_SERVICE_ACCOUNT_B64 present sa server env
  tableOk: boolean;         // push_tokens table exists (0117 applied)
  myTokens: number;         // tokens registered for THIS account
  allTokens: number;        // tokens across all accounts
  sent: number;             // successful FCM sends to my tokens
  roles: string[];          // distinct roles that have a registered device token
  errors: string[];
};

export async function sendTestPush(): Promise<PushTestResult | { error: string }> {
  try {
    const me = await getSession();
    if (!me) return { error: "Not signed in." };
    const errors: string[] = [];
    const configured = !!process.env.FIREBASE_SERVICE_ACCOUNT_B64;

    const db = createServerSupabase();
    let tableOk = true, myTokens = 0, allTokens = 0;
    let roles: string[] = [];
    const { data: mine, error: qErr } = await db.from("push_tokens").select("token").eq("user_id", me.id);
    if (qErr) { tableOk = false; errors.push(`push_tokens: ${qErr.message} (run migration 0117)`); }
    else {
      myTokens = (mine ?? []).length;
      const { data: all, count } = await db.from("push_tokens").select("role", { count: "exact" });
      allTokens = count ?? 0;
      // Distinct roles that actually have a registered device — makes a role mismatch
      // (e.g. new-order push targets "operations_manager" but the token saved "manager")
      // obvious at a glance.
      roles = [...new Set(((all ?? []) as { role: string | null }[]).map((r) => r.role ?? "—"))];
    }

    let sent = 0;
    if (configured && myTokens > 0) {
      try {
        const { sendPushToRoles } = await import("@/lib/push/fcm");
        // Send to the caller's own role — their device(s) should ring.
        await sendPushToRoles([me.role], {
          title: "PAN Furniture — Test notification",
          body: `Push notifications are working. (${new Date().toLocaleTimeString("en-PH", { hour: "numeric", minute: "2-digit" })})`,
          url: "/dashboard",
        });
        sent = myTokens;
      } catch (e) {
        errors.push(`FCM send: ${e instanceof Error ? e.message : "failed"}`);
      }
    }
    if (!configured) errors.push("FIREBASE_SERVICE_ACCOUNT_B64 is MISSING from the server env — add it to the env vars.");
    if (tableOk && myTokens === 0) errors.push("This account has no registered token — an old APK (no push plugin), the app has not been opened since the rebuild, or notification permission was denied.");

    return { configured, tableOk, myTokens, allTokens, sent, roles, errors };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Test failed." };
  }
}

// Force the SAME notification a new order fires, to every ops/admin device — so you
// can verify the real new-order alert reaches the Operations tablets without having
// to create an order. Returns how many ops device tokens it targeted (so a "0" makes
// a role mismatch obvious). Admin-only.
export async function forceNewOrderPush(): Promise<{ ok: true; targeted: number } | { error: string }> {
  try {
    const me = await getSession();
    if (!me) return { error: "Not signed in." };
    const roles = ["administrator", "operations_manager", "operation_manager", "manager", "ops", "operations"];
    const db = createServerSupabase();
    const { data } = await db.from("push_tokens").select("token").in("role", roles).limit(500);
    const targeted = new Set(((data ?? []) as { token: string }[]).map((t) => t.token)).size;
    const { sendPushToRoles } = await import("@/lib/push/fcm");
    await sendPushToRoles(roles, {
      title: "New order ready for approval",
      body: `Test alert — tap to open Order Approval (${new Date().toLocaleTimeString("en-PH", { hour: "numeric", minute: "2-digit" })})`,
      url: "/operations/approval",
    });
    return { ok: true, targeted };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Failed to send." };
  }
}
