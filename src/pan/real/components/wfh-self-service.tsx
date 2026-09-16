"use client";

// SELF-SERVICE PARA SA WFH (2026-08-25) — ang tatlong hiling na matagal nang
// nasa FaceID kiosk: Request Leave, Request Advance, My Payslip. Nasa tindahan
// lang ang tablet, kaya walang paraan ang mga nagtatrabaho sa labas.
//
// Ang naka-login ang nagpapatunay kung sino ang humihiling — hindi mukha, at
// walang pinipiling empleyado: ang server (app/hr/wfh/self-actions) ay
// hinahanap ang tao sa session, kaya laging para sa sarili ang hiling.

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { cn } from "./ui";
import { peso } from "@/lib/format";
import { Modal } from "./modal";
import type { LeaveType } from "@/lib/hr/types";
import type { MyLeave, MyAdvance } from "@/app/hr/wfh/data";
import { PayslipDocButton } from "./payslip-doc";
import { requestOwnLeave, requestOwnAdvance, loadOwnPayslipDoc } from "@/app/hr/wfh/self-actions";

const LEAVE_TYPES: LeaveType[] = ["Vacation", "Sick", "Emergency", "Unpaid", "Restday"];
const inp = "w-full rounded-lg border border-border bg-stone-50 px-3 py-2 text-sm outline-none focus:border-primary focus:bg-surface";

function todayISO(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}
const dateOnly = (d: string | null) => {
  if (!d) return "—";
  const t = new Date(`${String(d).slice(0, 10)}T00:00:00`);
  return isNaN(t.getTime()) ? "—" : t.toLocaleDateString("en-PH", { month: "short", day: "numeric", year: "numeric" });
};

type Sheet = "leave" | "advance" | null;

export function WfhSelfService({ employeeName, leaves = [], advances = [] }: {
  employeeName: string | null;
  leaves?: MyLeave[];
  advances?: MyAdvance[];
}) {
  const [sheet, setSheet] = useState<Sheet>(null);
  // Ang slip mismo ay hawak ng PayslipDocButton; ito ay para sa "wala pang
  // payslip" at sa iba pang dahilan — walang dokumentong maipapakita doon.
  const [payslipErr, setPayslipErr] = useState<string | null>(null);
  // Walang employee record = walang mapaghahainan; ang card ay hindi lumalabas
  // (may sariling babala na ang pahina sa itaas).
  if (!employeeName) return null;

  return (
    <>
      <div className="mt-5 border-t border-border pt-4">
        <p className="text-xs uppercase text-muted">Requests</p>
        <div className="mt-2.5 grid grid-cols-3 gap-3">
          <ActionButton icon="leave" label="Request Leave" onClick={() => setSheet("leave")} />
          <ActionButton icon="advance" label="Request Advance" onClick={() => setSheet("advance")} />
          <PayslipDocButton
            load={async () => {
              const r = await loadOwnPayslipDoc();
              if ("error" in r) { setPayslipErr(r.error); return null; }
              setPayslipErr(null);
              return r.detail;
            }}
            trigger={(open) => <ActionButton icon="payslip" label="My Payslip" onClick={open} />}
          />
        </div>
      </div>

      {/* ANG SINUSUBAYBAY (2026-08-25) — nagpapadala ka ng hiling at wala nang
          balita: walang paraang malaman kung naaprubahan na ang leave. Ang
          katayuan ay nasa hilera; ito ang nagpapakita. Pending sa itaas — iyon
          ang hinihintay; ang naaprubahan at natanggihan ay talaan na lang. */}
      <MyRequests leaves={leaves} advances={advances} />

      {sheet === "leave" && <LeaveSheet who={employeeName} onClose={() => setSheet(null)} />}
      {sheet === "advance" && <AdvanceSheet who={employeeName} onClose={() => setSheet(null)} />}
      {payslipErr && (
        <Modal open onClose={() => setPayslipErr(null)} title="My Payslip" size="sm"
          footer={<div className="flex justify-end"><button onClick={() => setPayslipErr(null)} className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-accent hover:bg-primary/90">Done</button></div>}>
          <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-700">{payslipErr}</p>
        </Modal>
      )}
    </>
  );
}

// Kaparehong tatlong icon ng kiosk, para agad makilala ng kaparehong tao.
function ActionButton({ icon, label, onClick }: { icon: "leave" | "advance" | "payslip"; label: string; onClick: () => void }) {
  const path = icon === "leave"
    ? <><rect x="3" y="4" width="18" height="18" rx="2" /><path d="M16 2v4M8 2v4M3 10h18" /></>
    : icon === "advance"
      ? <><circle cx="12" cy="12" r="9" /><path d="M12 7v10M9.5 9.5h5M9.5 14.5h5" /></>
      : <><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z" /><path d="M14 2v6h6M8 13h8M8 17h5" /></>;
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex flex-col items-center justify-center gap-1.5 rounded-xl border border-border px-2 py-3 text-center transition hover:border-primary hover:bg-stone-50 active:scale-95"
    >
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="text-muted">{path}</svg>
      <span className="text-[11px] font-semibold leading-tight">{label}</span>
    </button>
  );
}

// ── ANG SINUSUBAYBAY ────────────────────────────────────────────────────────
// Pinagsasama ang leave at advance sa isang talaan, pinakabago sa itaas, at ang
// nakabinbin ay nauuna — iyon ang hinihintay ng naghain.
type Req = {
  kind: "Leave" | "Advance";
  what: string;
  when: string;
  status: string;
  reason: string | null;
  sortKey: string;
};

function statusTone(st: string): string {
  const v = st.toLowerCase();
  if (/approved|settled/.test(v)) return "bg-emerald-50 text-emerald-700 ring-emerald-600/20";
  if (/reject|denied|cancel/.test(v)) return "bg-red-50 text-red-700 ring-red-600/20";
  return "bg-amber-50 text-amber-700 ring-amber-600/25";
}
// Ang "Open" na advance ay hindi pa nabayaran — "Pending" ang sinasabi nito sa
// naghain, dahil iyon ang ibig sabihin sa kanya; ang "Open" ay salita ng ledger.
const statusWord = (kind: Req["kind"], st: string) =>
  kind === "Advance" && /^open$/i.test(st) ? "Pending" : st;

function MyRequests({ leaves, advances }: { leaves: MyLeave[]; advances: MyAdvance[] }) {
  const items: Req[] = [
    ...leaves.map((l) => ({
      kind: "Leave" as const,
      what: `${l.leave_type} · ${Number(l.days) || 1} day${(Number(l.days) || 1) === 1 ? "" : "s"}`,
      when: l.date_from === l.date_to ? dateOnly(l.date_from) : `${dateOnly(l.date_from)} – ${dateOnly(l.date_to)}`,
      status: l.status,
      reason: l.reason,
      sortKey: l.created_at ?? l.date_from,
    })),
    ...advances.map((a) => ({
      kind: "Advance" as const,
      what: peso(Number(a.amount) || 0),
      when: dateOnly(a.date_issued),
      status: a.status,
      reason: a.reason,
      sortKey: a.created_at ?? a.date_issued,
    })),
  ];
  if (!items.length) return null;

  const pendingFirst = [...items].sort((a, b) => {
    const ap = /pending|open/i.test(a.status) ? 0 : 1;
    const bp = /pending|open/i.test(b.status) ? 0 : 1;
    return ap !== bp ? ap - bp : String(b.sortKey).localeCompare(String(a.sortKey));
  });
  const waiting = items.filter((i) => /pending|open/i.test(i.status)).length;

  return (
    <div className="mt-4 border-t border-border pt-4">
      <div className="flex items-baseline justify-between">
        <p className="text-xs uppercase text-muted">My requests</p>
        {waiting > 0 && (
          <span className="text-[11px] font-semibold text-amber-700">{waiting} waiting</span>
        )}
      </div>
      <div className="mt-2 space-y-1.5">
        {pendingFirst.slice(0, 8).map((r, i) => (
          <div key={i} className="flex items-center gap-2 text-xs">
            <span className="w-14 shrink-0 font-semibold text-muted">{r.kind}</span>
            <span className="min-w-0 flex-1 truncate" title={r.reason ?? ""}>
              <b className="font-semibold">{r.what}</b>
              <span className="ml-1.5 text-muted">{r.when}</span>
            </span>
            <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ring-1 ring-inset", statusTone(r.status))}>
              {statusWord(r.kind, r.status)}
            </span>
          </div>
        ))}
        {pendingFirst.length > 8 && (
          <p className="text-[11px] text-muted">+{pendingFirst.length - 8} older</p>
        )}
      </div>
    </div>
  );
}

// ── LEAVE ────────────────────────────────────────────────────────────────────
function LeaveSheet({ who, onClose }: { who: string; onClose: () => void }) {
  const router = useRouter();
  const [leaveType, setLeaveType] = useState<LeaveType>("Vacation");
  const [dateFrom, setDateFrom] = useState(todayISO());
  const [dateTo, setDateTo] = useState(todayISO());
  const [reason, setReason] = useState("");
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, start] = useTransition();

  function submit() {
    setError(null);
    start(async () => {
      const r = await requestOwnLeave({ leave_type: leaveType, date_from: dateFrom, date_to: dateTo, reason: reason.trim() || null });
      if ("error" in r) { setError(r.error); return; }
      setDone(true); router.refresh();
    });
  }

  return (
    <Modal open onClose={onClose} title="Request Leave" description={`Filed as ${who}`} size="sm"
      footer={done ? (
        <div className="flex justify-end"><button onClick={onClose} className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-accent hover:bg-primary/90">Done</button></div>
      ) : (
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="rounded-lg px-4 py-2 text-sm font-medium ring-1 ring-inset ring-border hover:bg-stone-100">Cancel</button>
          <button onClick={submit} disabled={busy} className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-accent hover:bg-primary/90 disabled:opacity-60">{busy ? "Submitting…" : "Submit"}</button>
        </div>
      )}
    >
      {done ? (
        <Sent what="Leave request sent" note="Waiting for your manager to approve. Whether it is paid is decided on approval." />
      ) : (
        <div className="space-y-3">
          <div>
            <label className="mb-1 block text-sm font-medium">Type</label>
            <select value={leaveType} onChange={(e) => setLeaveType(e.target.value as LeaveType)} className={inp}>
              {LEAVE_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div><label className="mb-1 block text-sm font-medium">From</label>
              <input type="date" value={dateFrom} onChange={(e) => { setDateFrom(e.target.value); if (dateTo < e.target.value) setDateTo(e.target.value); }} className={inp} /></div>
            <div><label className="mb-1 block text-sm font-medium">To</label>
              <input type="date" value={dateTo} min={dateFrom} onChange={(e) => setDateTo(e.target.value)} className={inp} /></div>
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium">Reason <span className="font-normal text-muted">(optional)</span></label>
            <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} className={inp} />
          </div>
          {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p>}
        </div>
      )}
    </Modal>
  );
}

// ── ADVANCE ──────────────────────────────────────────────────────────────────
function AdvanceSheet({ who, onClose }: { who: string; onClose: () => void }) {
  const router = useRouter();
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, start] = useTransition();

  function submit() {
    setError(null);
    start(async () => {
      const r = await requestOwnAdvance({ amount: Number(amount) || 0, reason: reason.trim() || null });
      if ("error" in r) { setError(r.error); return; }
      setDone(true); router.refresh();
    });
  }

  return (
    <Modal open onClose={onClose} title="Request Advance" description={`Filed as ${who}`} size="sm"
      footer={done ? (
        <div className="flex justify-end"><button onClick={onClose} className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-accent hover:bg-primary/90">Done</button></div>
      ) : (
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="rounded-lg px-4 py-2 text-sm font-medium ring-1 ring-inset ring-border hover:bg-stone-100">Cancel</button>
          <button onClick={submit} disabled={busy || !(Number(amount) > 0)} className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-accent hover:bg-primary/90 disabled:opacity-60">{busy ? "Submitting…" : "Submit"}</button>
        </div>
      )}
    >
      {done ? (
        <Sent what="Advance request sent" note="No money is released yet — your manager reviews it and settles it against a payslip." />
      ) : (
        <div className="space-y-3">
          <div>
            <label className="mb-1 block text-sm font-medium">Amount</label>
            <div className="flex items-center gap-1.5">
              <span className="text-sm font-bold text-muted">₱</span>
              <input value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))} inputMode="decimal" placeholder="0" className={cn(inp, "text-right font-bold tabular-nums")} />
            </div>
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium">Reason <span className="font-normal text-muted">(optional)</span></label>
            <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} className={inp} />
          </div>
          {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p>}
        </div>
      )}
    </Modal>
  );
}

function Sent({ what, note }: { what: string; note: string }) {
  return (
    <div className="py-6 text-center">
      <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-emerald-600 text-2xl font-extrabold text-white">✓</span>
      <p className="mt-3 text-base font-extrabold text-emerald-800">{what}</p>
      <p className="mt-1 text-xs text-muted">{note}</p>
    </div>
  );
}
