"use client";

import { useEffect, useMemo, useRef, useState } from "react";

export type EmpOpt = { name: string; on_call: boolean; role?: string };

// Custom dropdown grouped by ROLE (bold header) with its members under it.
// On-call entries get a badge. Keeps a custom existing value too.
export function EmployeePicker({
  value, onChange, options, className,
}: {
  value: string;
  onChange: (v: string) => void;
  options: EmpOpt[];
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const selected = options.find((o) => o.name === value);
  const pick = (v: string) => { onChange(v); setOpen(false); };

  // Close when clicking anywhere outside (robust inside modals where a z-10 backdrop is hidden behind the modal).
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (!rootRef.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  // Group by role label, preserving first-seen order.
  const groups = useMemo(() => {
    const m = new Map<string, EmpOpt[]>();
    for (const o of options) {
      const key = (o.role && o.role.trim()) || "Staff";
      const arr = m.get(key) ?? [];
      arr.push(o);
      m.set(key, arr);
    }
    return [...m.entries()];
  }, [options]);

  return (
    <div ref={rootRef} className="relative">
      <button type="button" onClick={() => setOpen((v) => !v)} className={`${className ?? ""} ${open ? "relative z-30" : ""} flex items-center justify-between gap-2 text-left`}>
        <span className={value ? "" : "text-muted"}>
          {value || "— select —"}
          {selected?.on_call && <span className="ml-1.5 rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-700">On Call</span>}
        </span>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="shrink-0 text-muted"><path d="m6 9 6 6 6-6" /></svg>
      </button>
      {open && (
        <>
          <div className="absolute z-20 mt-1 max-h-[70vh] w-full min-w-[14rem] overflow-auto rounded-lg border border-border bg-surface py-1 shadow-lg">
            <button type="button" onClick={() => pick("")} className="block w-full px-3 py-1.5 text-left text-sm text-muted hover:bg-stone-100">— select —</button>
            {value && !selected && <button type="button" onClick={() => pick(value)} className="block w-full px-3 py-1.5 text-left text-sm hover:bg-stone-100">{value}</button>}
            {groups.map(([role, members]) => (
              <div key={role}>
                <p className="px-3 pb-0.5 pt-2 text-xs font-bold text-foreground">{role}</p>
                {members.map((o) => (
                  <button key={o.name} type="button" onClick={() => pick(o.name)} className={`flex w-full items-center justify-between gap-2 px-3 py-1.5 pl-5 text-left text-sm hover:bg-stone-100 ${value === o.name ? "bg-stone-100 font-medium" : ""}`}>
                    <span>{o.name}</span>
                    {o.on_call && <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-700">On Call</span>}
                  </button>
                ))}
              </div>
            ))}
            {options.length === 0 && <p className="px-3 py-3 text-center text-xs text-muted">No matching staff.</p>}
          </div>
        </>
      )}
    </div>
  );
}
