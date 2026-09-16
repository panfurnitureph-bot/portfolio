"use client";

import { useState, useTransition } from "react";
import { Modal } from "./modal";
import { loadFollowupTargets, sendFbFollowup, type FollowupTarget } from "@/app/orders/fb-followup-actions";

// FOLLOW-UP SA MESSENGER — para masagot ng sales ang mga kaka-chat na customer
// nang hindi bubuksan ang Business Suite isa-isa.
//
// Ipinapakita LANG ang mga nasa loob ng 24-ORAS na bintana ni Meta, dahil doon
// lang pumapayag ang Meta na mag-message ang Page. Ang 7-araw na HUMAN_AGENT ay
// nasa server na pero kailangan ng App Review bago umandar sa tunay na customer.

const MAX = 50;

function when(iso: string): string {
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  return `${Math.round(mins / 60)}h ago`;
}

export function FbFollowupButton() {
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [targets, setTargets] = useState<FollowupTarget[]>([]);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [text, setText] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  // Hanapin sa loob ng listahan — sa 200 recipients, hindi praktikal ang scroll.
  // Client-side lang: nasa memory na ang buong listahan (24h window), kaya walang
  // dahilan para pumunta pa sa server.
  const [q, setQ] = useState("");

  function openModal() {
    setOpen(true);
    setMsg(null);
    if (loaded) return;
    start(async () => {
      setTargets(await loadFollowupTargets());
      setLoaded(true);
    });
  }

  function toggle(psid: string) {
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(psid)) next.delete(psid);
      else if (next.size < MAX) next.add(psid);
      return next;
    });
  }

  // Ang nakikitang listahan. Ang mga NAPILI ay nananatili kahit mag-hanap o
  // magbago ng hanap — ang padala ay sa `picked`, hindi sa nakikita.
  const term = q.trim().toLowerCase();
  const shown = term ? targets.filter((t) => t.name.toLowerCase().includes(term)) : targets;

  function send() {
    setMsg(null);
    start(async () => {
      const r = await sendFbFollowup([...picked], text);
      if ("error" in r) { setMsg(r.error); return; }
      const parts = [`Sent to ${r.sent}`];
      if (r.failed) parts.push(`${r.failed} failed`);
      if (r.skipped) parts.push(`${r.skipped} outside the 24h window`);
      setMsg(parts.join(" · "));
      setPicked(new Set());
      setText("");
    });
  }

  return (
    <div className="apk-hide">
      <button
        onClick={openModal}
        title="Reply to customers who chatted in the last 24 hours"
        className="rounded-lg border border-border bg-surface px-3 py-2 text-sm font-medium hover:bg-stone-100"
      >
        Follow up on Messenger
      </button>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Follow up on Messenger"
        description="Customers who chatted in the last 24 hours — Meta only allows replies inside that window."
        size="lg"
        footer={
          <div className="flex items-center justify-between gap-3">
            <span className="text-xs text-muted">
              {/* Ang bilang ay sa BUONG pinili, hindi sa nakikita — may mga napili
                  na nasa labas ng kasalukuyang hanap, at delikado kung hindi ito
                  malinaw bago pindutin ang Send. */}
              {picked.size} selected{picked.size >= MAX ? ` (max ${MAX})` : ""}
              {msg && <span className="ml-2 font-medium text-foreground">{msg}</span>}
            </span>
            <span className="flex gap-2">
              <button onClick={() => setOpen(false)} className="rounded-lg border border-border px-3 py-2 text-sm hover:bg-stone-100">Close</button>
              <button
                onClick={send}
                disabled={pending || !picked.size || !text.trim()}
                className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
              >
                {pending ? "Sending…" : `Send to ${picked.size}`}
              </button>
            </span>
          </div>
        }
      >
        <label className="block">
          <span className="mb-1 block text-xs font-semibold text-muted">Message</span>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={4}
            maxLength={1800}
            placeholder="Hi! Following up on your inquiry — is there anything else you'd like to know about the item?"
            className="w-full rounded-md border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-primary"
          />
          <span className="mt-1 block text-[11px] text-muted">
            The same message goes to everyone selected. Keep it a genuine reply — promotional blasts can get the Page&apos;s
            Messenger access restricted.
          </span>
        </label>

        <div className="mt-4">
          <div className="mb-1 flex items-center justify-between">
            <span className="text-xs font-semibold text-muted">
              Recipients {loaded && (q.trim() ? `(${shown.length} of ${targets.length})` : `(${targets.length} available)`)}
            </span>
            {targets.length > 0 && (
              <button
                // Ang "Select" ay tumutungo sa NAKIKITA lang (kung may hanap),
                // hindi sa buong listahan — iyon ang inaasahan kapag may filter.
                onClick={() => setPicked(picked.size ? new Set() : new Set(shown.slice(0, MAX).map((t) => t.psid)))}
                className="text-xs text-primary underline"
              >
                {picked.size ? "Clear" : `Select first ${Math.min(MAX, shown.length)}`}
              </button>
            )}
          </div>
          {targets.length > 0 && (
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search name…"
              className="mb-1 w-full rounded-md border border-border bg-surface px-3 py-1.5 text-sm outline-none focus:border-primary"
            />
          )}
          <div className="max-h-72 overflow-auto rounded-md border border-border">
            {!loaded && <p className="px-3 py-4 text-sm text-muted">Loading…</p>}
            {loaded && targets.length === 0 && (
              <p className="px-3 py-4 text-sm text-muted">
                Nobody chatted in the last 24 hours, so there is no one Meta will let us message right now.
              </p>
            )}
            {loaded && targets.length > 0 && shown.length === 0 && (
              <p className="px-3 py-4 text-sm text-muted">No one matches “{q.trim()}”.</p>
            )}
            {shown.map((t) => (
              <label
                key={t.psid}
                className="flex cursor-pointer items-center gap-3 border-b border-border/60 px-3 py-2 last:border-0 hover:bg-stone-50"
              >
                <input
                  type="checkbox"
                  checked={picked.has(t.psid)}
                  onChange={() => toggle(t.psid)}
                  className="h-4 w-4 accent-primary"
                />
                <span className="min-w-0 flex-1 truncate text-sm font-medium">{t.name}</span>
                <span className="shrink-0 text-[11px] text-muted">{when(t.lastMsg)}</span>
              </label>
            ))}
          </div>
        </div>
      </Modal>
    </div>
  );
}
