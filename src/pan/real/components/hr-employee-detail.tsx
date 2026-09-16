"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { cn, Card, SpecRows } from "./ui";
import { peso, shortDate } from "@/lib/format";
import { roleLabel, roleBadge, type HrEmployee } from "@/lib/hr/types";
import { EmployeeForm, empInitials } from "./hr-employee-form";
import { FaceEnrollButton } from "./face-enroll-button";

const empCode = (id: number) => `M${String(id).padStart(5, "0")}`;

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Card className="rounded-2xl p-5">
      <h2 className="mb-2 text-sm font-semibold">{title}</h2>
      <div>{children}</div>
    </Card>
  );
}

export function HrEmployeeDetail({ employee: e }: { employee: HrEmployee }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const v = (s: string | null | undefined) => (s && String(s).trim() ? s : "—");

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <Link href="/hr/directory" className="flex items-center gap-1.5 text-sm font-medium text-muted hover:text-foreground">← Back to directory</Link>
        <div className="flex items-center gap-2">
          {e.active && <FaceEnrollButton employeeId={e.id} employeeName={e.name} enrolled={!!e.face_enrolled_at} canEnroll={!!(e as { can_enroll?: boolean }).can_enroll} />}
          <button onClick={() => setEditing(true)} className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-accent hover:bg-primary/90">Edit</button>
        </div>
      </div>

      {/* Header */}
      <Card className="rounded-2xl p-6">
        <div className="flex flex-wrap items-center gap-5">
          {e.photo_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={e.photo_url} alt={e.name} className="h-20 w-20 shrink-0 rounded-full object-cover ring-1 ring-border" />
          ) : (
            <span className="flex h-20 w-20 shrink-0 items-center justify-center rounded-full bg-primary/10 text-2xl font-semibold text-primary">{empInitials(e.name)}</span>
          )}
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-2xl font-semibold tracking-tight">{e.name}</h1>
              <span className={cn("inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset", roleBadge(e.role))}>{roleLabel(e.role)}</span>
              {e.on_call && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-700">on-call</span>}
              {e.active
                ? <span className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-700"><span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />Active</span>
                : <span className="inline-flex items-center gap-1.5 text-xs font-medium text-stone-500"><span className="h-1.5 w-1.5 rounded-full bg-stone-400" />Inactive</span>}
            </div>
            <p className="mt-1 text-sm text-muted">{roleLabel(e.role)} · {e.employment_type}</p>
            <p className="mt-0.5 font-mono text-xs text-muted">{empCode(e.id)}</p>
          </div>
        </div>
      </Card>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <Section title="Personal">
          <SpecRows
            labelWidth="w-32"
            items={[
              ["Full name", e.name],
              ["Contact", v(e.contact)],
              ["Email", v(e.email)],
              ["Birthdate", e.birthdate ? shortDate(e.birthdate) : "—"],
              ["Address", v(e.address)],
            ]}
          />
        </Section>

        <Section title="Employment">
          <SpecRows
            labelWidth="w-32"
            items={[
              ["Role", roleLabel(e.role)],
              ["Employment type", e.employment_type],
              ["Hire date", e.hire_date ? shortDate(e.hire_date) : "—"],
              ["Day off", v(e.day_off)],
              ["Face-ID", e.face_enrolled_at
                ? <span className="inline-flex items-center gap-1.5 text-emerald-700"><span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />Enrolled</span>
                : <span className="text-muted">Not enrolled</span>],
            ]}
          />
        </Section>

        <Section title="Compensation">
          <SpecRows
            labelWidth="w-32"
            items={[
              ["Rate", e.rate != null ? <>{peso(e.rate)} <span className="text-muted">/ {e.rate_type}</span></> : "—"],
              ["Allowance", e.allowance != null ? peso(e.allowance) : "—"],
            ]}
          />
        </Section>

        <Section title="Government IDs & Banking">
          <SpecRows
            labelWidth="w-32"
            items={[
              ["SSS No.", v(e.sss_no)],
              ["PhilHealth No.", v(e.philhealth_no)],
              ["Pag-IBIG No.", v(e.pagibig_no)],
              ["TIN", v(e.tin)],
              ["Bank account", v(e.bank_account)],
            ]}
          />
        </Section>
      </div>

      {editing && <EmployeeForm e={e} onClose={() => setEditing(false)} onDeleted={() => router.push("/hr/directory")} />}
    </div>
  );
}
