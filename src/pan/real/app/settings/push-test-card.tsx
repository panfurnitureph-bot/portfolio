// @ts-nocheck — copied verbatim; typed against the native push plugin, the demo shim is untyped
"use client";

// Push notification diagnostics — one tap shows exactly where the chain breaks
// (env, migration, token registration, FCM send) and rings this device if OK.
// Also runs a DEVICE-side check: is this the APK? plugin present? permission?
// token actually issued? — surfaces the client break the silent registrar hides.
import { useState } from "react";
import { sendTestPush, forceNewOrderPush, type PushTestResult } from "@/app/actions/push-test";
import { registerPushToken } from "@/app/actions/push";

type DeviceCheck = { lines: string[] };

async function checkDevice(): Promise<DeviceCheck> {
  const lines: string[] = [];
  const capacitor = (window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor;
  if (!capacitor) { lines.push("This is not the APK (no Capacitor) — Test Push has to be pressed in the TABLET APP, not in a browser."); return { lines }; }
  if (!capacitor.isNativePlatform?.()) { lines.push("Capacitor is present but not native — this is browser mode."); return { lines }; }
  lines.push("APK / native platform");
  try {
    const { PushNotifications } = await import("@capacitor/push-notifications");
    lines.push("Push plugin loaded");
    const perm = await PushNotifications.checkPermissions();
    lines.push(perm.receive === "granted" ? "Notification permission: granted" : `Notification permission: ${perm.receive} — allow it in the tablet’s Settings → Apps → PAN → Notifications`);
    if (perm.receive !== "granted") {
      const req = await PushNotifications.requestPermissions();
      lines.push(req.receive === "granted" ? "Permission granted just now" : "Permission denied again");
      if (req.receive !== "granted") return { lines };
    }
    // Try a live registration and wait briefly for the token.
    const token = await new Promise<string | null>((resolve) => {
      const timer = setTimeout(() => resolve(null), 15000);
      PushNotifications.addListener("registration", (t) => { clearTimeout(timer); resolve(t.value); });
      PushNotifications.addListener("registrationError", () => { clearTimeout(timer); resolve(null); });
      void PushNotifications.register();
    });
    if (!token) { lines.push("No token from FCM (15s) — either an old APK built without google-services.json, or the tablet has no Google Play Services."); return { lines }; }
    lines.push(`May FCM token (${token.slice(0, 12)}…)`);
    const save = await registerPushToken(token);
    lines.push("error" in save ? `Could not save the token: ${save.error}` : "Token saved on the server — press Test Push AGAIN; it should sound now");
  } catch (e) {
    lines.push(`The push plugin is MISSING from this APK (${e instanceof Error ? e.message : "import failed"}) — OLD APK: rebuild and install the new one.`);
  }
  return { lines };
}

export function PushTestCard() {
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<PushTestResult | { error: string } | null>(null);
  const [device, setDevice] = useState<DeviceCheck | null>(null);
  const [forceMsg, setForceMsg] = useState<string | null>(null);
  const [forcing, setForcing] = useState(false);

  async function run() {
    setBusy(true); setRes(null); setDevice(null); setForceMsg(null);
    try {
      const [server, dev] = await Promise.all([sendTestPush(), checkDevice()]);
      setRes(server); setDevice(dev);
    } catch (e) { setRes({ error: e instanceof Error ? e.message : "failed" }); }
    finally { setBusy(false); }
  }

  // Fire the exact new-order alert to every ops/admin device — verifies the real
  // trigger reaches the Operations tablets without creating an order.
  async function forcePush() {
    setForcing(true); setForceMsg(null);
    try {
      const r = await forceNewOrderPush();
      if ("error" in r) setForceMsg(`${r.error}`);
      else setForceMsg(r.targeted > 0 ? `Sent to ${r.targeted} ops device${r.targeted === 1 ? "" : "s"} — it should pop on the lock screen.` : "0 ops devices — no ops/admin account has registered the APK (or the role string differs).");
    } catch (e) { setForceMsg(`${e instanceof Error ? e.message : "failed"}`); }
    finally { setForcing(false); }
  }

  const ok = res && !("error" in res);
  return (
    <div className="rounded-xl border border-border bg-surface p-5">
      <div className="mb-1 flex items-center justify-between">
        <h2 className="text-sm font-semibold">Push Notifications — Test</h2>
        <button onClick={run} disabled={busy}
          className="rounded-lg bg-primary px-3 py-1.5 text-sm font-semibold text-accent hover:opacity-90 disabled:opacity-50">
          {busy ? "Testing…" : "Test Push"}
        </button>
      </div>
      <p className="text-xs text-muted">Press this on the APK tablet — this device should ring. If it does not, the step it broke at shows below.</p>
      {res && "error" in res && <p className="mt-3 rounded-lg bg-rose-50 px-3 py-2 text-xs font-medium text-rose-700">{res.error}</p>}
      {ok && (
        <div className="mt-3 space-y-1 text-xs">
          <p>{(res as PushTestResult).configured ? "" : ""} Server key (FIREBASE_SERVICE_ACCOUNT_B64)</p>
          <p>{(res as PushTestResult).tableOk ? "" : ""} push_tokens table (migration 0117)</p>
          <p>{(res as PushTestResult).myTokens > 0 ? "" : ""} Device tokens for this account: {(res as PushTestResult).myTokens} (all: {(res as PushTestResult).allTokens})</p>
          <p>{(res as PushTestResult).sent > 0 ? "Sent — it should ring!" : "Nothing was sent"}</p>
          {(res as PushTestResult).roles?.length > 0 && (
            <p className="text-muted">Roles with a registered device: <b className="text-foreground">{(res as PushTestResult).roles.join(", ")}</b></p>
          )}
          {(res as PushTestResult).errors.map((e, i) => (
            <p key={i} className="rounded-lg bg-amber-50 px-3 py-2 font-medium text-amber-700">{e}</p>
          ))}
          <div className="mt-2 flex items-center gap-2 border-t border-border/60 pt-2">
            <button onClick={forcePush} disabled={forcing}
              className="rounded-lg bg-[#4a3b1a] px-3 py-1.5 text-xs font-semibold text-[#f4ead8] hover:opacity-90 disabled:opacity-50">
              {forcing ? "Sending…" : "Force the new-order push (to Ops)"}
            </button>
            {forceMsg && <span className="text-[11px] font-medium">{forceMsg}</span>}
          </div>
        </div>
      )}
      {device && (
        <div className="mt-3 space-y-1 rounded-lg bg-stone-50 p-3 text-xs">
          <p className="font-semibold text-muted">Device check (itong mismong device):</p>
          {device.lines.map((l, i) => <p key={i}>{l}</p>)}
        </div>
      )}
    </div>
  );
}
