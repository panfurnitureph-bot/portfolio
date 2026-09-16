import { useEffect, useRef, useState } from "react";
import { externalSupabase as supabase } from "@/integrations/supabase/externalClient";
import { Textarea } from "@/components/ui/textarea";

export interface MentionUser {
  id: string;
  full_name: string | null;
  email: string | null;
}

/** Comment textarea with an Airtable-style @mention picker. Typing "@" opens a
 *  searchable user list (from profiles); selecting one inserts "@Name " and
 *  reports the picked user via onPick. Ctrl/Cmd+Enter triggers onEnter. */
export function MentionInput({
  value, onChange, onPick, onEnter, placeholder, disabled, className,
}: {
  value: string;
  onChange: (v: string) => void;
  onPick?: (u: MentionUser) => void;
  onEnter?: () => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
}) {
  const [users, setUsers] = useState<MentionUser[]>([]);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data } = await (supabase as any)
        .from("profiles").select("id, full_name, email").order("full_name", { ascending: true });
      if (!cancelled) setUsers((data ?? []) as MentionUser[]);
    })();
    return () => { cancelled = true; };
  }, []);

  const matches = open
    ? users.filter((u) => {
        const t = query.toLowerCase();
        return !t || (u.full_name ?? "").toLowerCase().includes(t) || (u.email ?? "").toLowerCase().includes(t);
      }).slice(0, 6)
    : [];

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const v = e.target.value;
    onChange(v);
    const cursor = e.target.selectionStart ?? v.length;
    const m = v.slice(0, cursor).match(/@([\w.\-]*)$/);
    if (m) { setQuery(m[1]); setOpen(true); setActive(0); } else { setOpen(false); }
  };

  const insert = (u: MentionUser) => {
    const ta = ref.current;
    const cursor = ta?.selectionStart ?? value.length;
    const label = u.full_name || u.email || "user";
    const before = value.slice(0, cursor).replace(/@([\w.\-]*)$/, `@${label} `);
    const after = value.slice(cursor);
    onChange(before + after);
    setOpen(false);
    onPick?.(u);
    setTimeout(() => ta?.focus(), 0);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (open && matches.length) {
      if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => (a + 1) % matches.length); return; }
      if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => (a - 1 + matches.length) % matches.length); return; }
      if (e.key === "Enter" || e.key === "Tab") { e.preventDefault(); insert(matches[active]); return; }
      if (e.key === "Escape") { setOpen(false); return; }
    }
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); onEnter?.(); }
  };

  return (
    <div className="relative">
      <Textarea ref={ref} value={value} onChange={handleChange} onKeyDown={onKeyDown}
        placeholder={placeholder} disabled={disabled} className={className} />
      {open && matches.length > 0 && (
        <div className="absolute z-50 bottom-full mb-1 left-0 w-full max-h-48 overflow-auto rounded-md border bg-popover shadow-md">
          {matches.map((u, i) => (
            <button key={u.id} type="button" onMouseDown={(e) => { e.preventDefault(); insert(u); }}
              className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm hover:bg-accent ${i === active ? "bg-accent" : ""}`}>
              <span className="h-5 w-5 shrink-0 rounded-full bg-primary/15 text-primary text-[10px] font-semibold flex items-center justify-center">
                {(u.full_name || u.email || "?").slice(0, 1).toUpperCase()}
              </span>
              <span className="truncate">{u.full_name || u.email}</span>
              {u.full_name && u.email && <span className="ml-auto text-[10px] text-muted-foreground truncate">{u.email}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
