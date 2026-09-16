"use client";

// SET TEMP PASSWORD — sariling popup (2026-09-03, "dapat pop lang to"): ang
// dating window.prompt ay hilaw na browser dialog ("localhost says…"); ito ang
// in-app na bersyon, ginagamit ng App Login preview, ng Edit modal, at ng
// Team & Shared Logins tab. Ang tagumpay ay ipinapakita ang bagong password
// nang isang beses (naka-record na rin ito sa 0228 para sa preview).

import { useState, useTransition } from "react";
import { Modal } from "./modal";
import { setEmployeeLoginPassword } from "@/app/hr/directory/login-actions";

export function SetPasswordDialog({ profileId, name, onClose, onSet }: {
  profileId: string;
  name: string;
  onClose: () => void;
  // Tinatawag pagkatapos ma-set — dala ang bagong password (pang-echo sa caller).
  onSet?: (password: string) => void;
}) {
  const [pw, setPw] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [copied, setCopied] = useState(false);
  const [pending, start] = useTransition();

  function save() {
    setError(null);
    if (pw.length < 8) { setError("Temp password needs at least 8 characters."); return; }
    start(async () => {
      const r = await setEmployeeLoginPassword(profileId, pw);
      if ("error" in r) { setError(r.error); return; }
      setDone(true);
      onSet?.(pw);
    });
  }

  function copy() {
    try { void navigator.clipboard.writeText(pw); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch { /* kita naman ang teksto */ }
  }

  if (done) {
    return (
      <Modal open onClose={onClose} title={`Temp password set — ${name}`} description="Hand it to them now — they change it after first sign-in."
        footer={<div className="flex justify-end"><button onClick={onClose} className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-accent hover:bg-primary/90">Done</button></div>}
      >
        <div className="flex items-center justify-between gap-3 rounded-xl border-[1.5px] border-[#caa45a]/70 bg-[#fdfaf3] px-4 py-3">
          <span className="font-mono text-sm">{pw}</span>
          <button onClick={copy} className="rounded-lg px-3 py-1.5 text-xs font-semibold text-[#8a6a1f] ring-1 ring-inset ring-[#caa45a]/60 hover:bg-[#faf1dc]">{copied ? "Copied" : "Copy"}</button>
        </div>
      </Modal>
    );
  }

  return (
    <Modal open onClose={onClose} title={`Set temp password — ${name}`} description="They sign in with this and can change it after."
      footer={
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="rounded-lg px-4 py-2 text-sm font-medium ring-1 ring-inset ring-border hover:bg-stone-100">Cancel</button>
          <button onClick={save} disabled={pending} className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-accent hover:bg-primary/90 disabled:opacity-60">{pending ? "Setting…" : "Set password"}</button>
        </div>
      }
    >
      <div className="space-y-3">
        <div>
          <label className="mb-1 block text-sm font-medium">New temp password (8+ chars)</label>
          <input
            value={pw}
            onChange={(ev) => setPw(ev.target.value)}
            onKeyDown={(ev) => { if (ev.key === "Enter") save(); }}
            type="text"
            autoFocus
            placeholder="They change it after first sign-in"
            className="w-full rounded-lg border border-border bg-stone-50 px-3 py-2 text-sm outline-none focus:border-primary focus:bg-surface"
          />
        </div>
        {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 ring-1 ring-inset ring-red-600/20">{error}</p>}
      </div>
    </Modal>
  );
}
