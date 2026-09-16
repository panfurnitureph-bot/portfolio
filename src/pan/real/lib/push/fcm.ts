import "server-only";

// FCM HTTP v1 sender — no firebase-admin dependency. Auth = RS256 JWT signed with
// the service-account private key (node:crypto), exchanged for an OAuth token,
// cached until near-expiry. Push messages wake the APK even when the screen is
// off / app closed — that's the whole point of FCM.
import crypto from "crypto";
import { createServerSupabase } from "@/lib/supabase/server";

type ServiceAccount = {
  project_id: string;
  private_key: string;
  client_email: string;
  token_uri: string;
};

function loadServiceAccount(): ServiceAccount | null {
  const b64 = process.env.FIREBASE_SERVICE_ACCOUNT_B64;
  if (!b64) return null;
  try { return JSON.parse(Buffer.from(b64, "base64").toString("utf8")) as ServiceAccount; }
  catch { return null; }
}

// OAuth access-token cache (per server process).
let cached: { token: string; exp: number } | null = null;

async function getAccessToken(sa: ServiceAccount): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  if (cached && cached.exp - 60 > now) return cached.token;
  const b64url = (b: Buffer | string) =>
    Buffer.from(b).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = b64url(JSON.stringify({
    iss: sa.client_email,
    scope: "https://www.googleapis.com/auth/firebase.messaging",
    aud: sa.token_uri,
    iat: now,
    exp: now + 3600,
  }));
  const signer = crypto.createSign("RSA-SHA256");
  signer.update(`${header}.${claims}`);
  const signature = b64url(signer.sign(sa.private_key));
  const jwt = `${header}.${claims}.${signature}`;

  const resp = await fetch(sa.token_uri, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: `grant_type=${encodeURIComponent("urn:ietf:params:oauth:grant-type:jwt-bearer")}&assertion=${jwt}`,
    signal: AbortSignal.timeout(10000),
  });
  if (!resp.ok) throw new Error(`FCM auth failed (${resp.status})`);
  const data = (await resp.json()) as { access_token: string; expires_in: number };
  cached = { token: data.access_token, exp: now + (Number(data.expires_in) || 3600) };
  return cached.token;
}

export type PushMessage = {
  title: string;
  body: string;
  url?: string;   // in-app path to open on tap (e.g. /operations/approval)
};

// Send one message to one device token. Returns false on failure; a 404/410
// (dead token) prunes the row so the table stays clean.
async function sendToToken(sa: ServiceAccount, accessToken: string, token: string, msg: PushMessage): Promise<boolean> {
  const resp = await fetch(`https://fcm.googleapis.com/v1/projects/${sa.project_id}/messages:send`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({
      message: {
        token,
        // DATA-ONLY (no `notification` block). A message WITH a notification block is
        // handled by the OS when the app is backgrounded and our custom
        // FirebaseMessagingService is NEVER called — so no full-screen intent, no
        // waking a locked screen. Data-only always routes to the service, which builds
        // the notification itself (full-screen intent + sound) and can wake the screen.
        data: {
          title: msg.title,
          body: msg.body,
          ...(msg.url ? { url: msg.url } : {}),
        },
        android: { priority: "HIGH" },
      },
    }),
    signal: AbortSignal.timeout(10000),
  });
  if (resp.status === 404 || resp.status === 400) {
    // UNREGISTERED / bad token → prune.
    const db = createServerSupabase();
    await db.from("push_tokens").delete().eq("token", token);
    return false;
  }
  return resp.ok;
}

// Push to every registered device of the given roles. Best-effort + fire-safe:
// never throws (a failed push must never break the business action that fired it).
export async function sendPushToRoles(roles: string[], msg: PushMessage): Promise<void> {
  try {
    const sa = loadServiceAccount();
    if (!sa) return; // not configured — silently skip
    const db = createServerSupabase();
    const { data } = await db.from("push_tokens").select("token").in("role", roles).limit(500);
    const tokens = [...new Set(((data ?? []) as { token: string }[]).map((t) => t.token))];
    if (!tokens.length) return;
    const accessToken = await getAccessToken(sa);
    await Promise.allSettled(tokens.map((t) => sendToToken(sa, accessToken, t, msg)));
  } catch { /* best-effort */ }
}
