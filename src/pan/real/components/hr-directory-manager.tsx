"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { cn, Card } from "./ui";
import { ROLE_OPTIONS, roleLabel, roleBadge, type HrEmployee, type EmpRole } from "@/lib/hr/types";
import { EmployeeForm, empInitials } from "./hr-employee-form";
import { PaginationFooter, usePagination } from "@/components/pagination-footer";
import { FaceEnrollButton } from "./face-enroll-button";
import { deleteEmployee } from "@/app/hr/directory/actions";
import { setCanEnroll } from "@/app/hr/directory/face-actions";
import type { DirectoryLogins, EmployeeLoginInfo } from "@/app/hr/directory/data";
import { saveEmployeeLogin, setEmployeeLoginStatus } from "@/app/hr/directory/login-actions";
import { Modal } from "./modal";
import { SetPasswordDialog } from "./set-password-dialog";
import { deleteUser, setRole } from "@/app/users/actions";
import { ROLES, ROLE_LABEL, type Role } from "@/lib/auth/rbac";
import { PermissionsDialog } from "@/app/users/permissions-dialog";

const empCode = (id: number) => `M${String(id).padStart(5, "0")}`;

// Inline toggle pill: marks an employee as an authorized kiosk enroller (their
// face opens the kiosk enroll panel). Optimistic; reverts on error.
function EnrollerToggle({ employeeId, initial }: { employeeId: number; initial: boolean }) {
  const [on, setOn] = useState(initial);
  const [pending, start] = useTransition();
  function toggle() {
    const next = !on;
    setOn(next);
    start(async () => {
      const r = await setCanEnroll(employeeId, next);
      if ("error" in r) setOn(!next);
    });
  }
  return (
    <button
      onClick={toggle}
      disabled={pending}
      title={on ? "Authorized to enroll faces at kiosk — click to revoke" : "Allow this person's face to open the kiosk enroll panel"}
      className={cn(
        "rounded-md px-2 py-1 text-xs font-medium ring-1 ring-inset transition disabled:opacity-50",
        on ? "bg-emerald-50 text-emerald-700 ring-emerald-600/30" : "text-muted ring-border hover:bg-stone-100",
      )}
    >
      {on ? "Enroller ✓" : "Enroller"}
    </button>
  );
}

export function HrDirectoryManager({ employees, logins, canManageLogins = false }: {
  employees: HrEmployee[];
  // UNIFIED DIRECTORY (2026-09-03): login account kada empleyado + ang mga
  // shared/team na account — dito na mina-manage, hindi na sa hiwalay na page.
  logins?: DirectoryLogins;
  canManageLogins?: boolean;
}) {
  const loginBy = logins?.byEmployee ?? {};
  const [q, setQ] = useState("");
  const [roleFilter, setRoleFilter] = useState<EmpRole | "all">("all");
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<HrEmployee | null>(null);
  // "+ Create login" (2026-09-03, "yan lang dapat lalabas"): maliit na sariling
  // dialog — email + temp password + role lang, hindi ang buong Edit modal.
  const [editWithLogin, setEditWithLogin] = useState(false);
  const [editStartRole, setEditStartRole] = useState<string | undefined>(undefined);
  const [createFor, setCreateFor] = useState<{ emp: HrEmployee; role?: string } | null>(null);
  // PREVIEW NG EXISTING LOGIN (2026-09-03, "d ko padin ma preview ung app
  // login nya"): pindot sa email → maliit na dialog ng buong login details.
  const [previewLogin, setPreviewLogin] = useState<{ emp: HrEmployee; lg: EmployeeLoginInfo } | null>(null);
  const [confirmDel, setConfirmDel] = useState<HrEmployee | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();

  function doDelete() {
    if (!confirmDel) return;
    setErr(null);
    start(async () => {
      const r = await deleteEmployee(confirmDel.id);
      if ("error" in r) { setErr(r.error); return; }
      setConfirmDel(null);
      router.refresh();
    });
  }

  const filtered = useMemo(() => {
    const query = q.trim().toLowerCase();
    return employees.filter((e) => {
      // Multi-role: ang role ay maaaring comma-joined ("Driver, Delivery Team A").
      if (roleFilter !== "all" && !(e.role ?? "").split(",").map((r) => r.trim()).includes(roleFilter)) return false;
      if (!query) return true;
      return `${e.name} ${e.position ?? ""} ${e.department ?? ""} ${roleLabel(e.role)} ${empCode(e.id)}`.toLowerCase().includes(query);
    });
  }, [employees, q, roleFilter]);

  const pg = usePagination(filtered, 25);

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-4">
        <div>
        </div>
        <button onClick={() => setAdding(true)} className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-accent hover:bg-primary/90">+ Add employee</button>
      </div>

      {/* Ang Team & Shared Logins tab ay tinanggal (2026-09-03, "dapat wala na
          to") — ang mga account na walang katumbas na empleyado ay nasa Login
          Accounts (/users) na lang mina-manage. */}
      <>
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative min-w-[16rem] flex-1 sm:max-w-sm">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted"><circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" /></svg>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name, position, ID…" className="w-full rounded-lg border border-border bg-stone-50 py-2 pl-8 pr-3 text-sm outline-none focus:border-primary focus:bg-surface" />
        </div>
        <div className="flex flex-wrap gap-1.5">
          <Chip active={roleFilter === "all"} onClick={() => setRoleFilter("all")}>All</Chip>
          {ROLE_OPTIONS.map((r) => <Chip key={r} active={roleFilter === r} onClick={() => setRoleFilter(r)}>{roleLabel(r)}</Chip>)}
        </div>
        <span className="ml-auto text-sm text-muted">{filtered.length} employee{filtered.length === 1 ? "" : "s"}</span>
      </div>

      {/* Error ng inline na role change — dating tanging sa delete dialog lang
          lumalabas ang err, kaya hindi makikita ang tanggi ng setRole. */}
      {err && !confirmDel && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 ring-1 ring-inset ring-red-600/20">{err}</p>}

      {/* Essentials only — full details live on the detail page */}
      <Card className="overflow-hidden rounded-2xl">
        <div className="max-h-[70vh] overflow-auto pf-scroll">
        <table className="w-full min-w-[720px] text-sm border-collapse [&_td]:border-b [&_td]:border-r [&_td]:border-border [&_td]:text-center [&_th]:border-b [&_th]:border-r [&_th]:border-border [&_td]:!text-center [&_th]:!text-center [&_th]:font-bold [&_th]:text-center">
          <colgroup>
            <col span={2} />
            <col span={2} />
            {canManageLogins && <col span={3} />}
            <col span={1} />
          </colgroup>
          <thead className="sticky top-0 z-10">
            <tr className="bg-[#4a3b1a] text-xs uppercase tracking-wide text-[#f4ead8]">
              <th colSpan={2} className="bg-[#4a3b1a] border-b border-[#caa45a] px-5 py-2">Employee</th>
              <th colSpan={2} className="bg-[#4a3b1a] border-b border-[#caa45a] !border-l-4 !border-l-[#caa45a] px-5 py-2">Role</th>
              {canManageLogins && <th colSpan={3} className="bg-[#4a3b1a] border-b border-[#caa45a] !border-l-4 !border-l-[#caa45a] px-5 py-2">App Login</th>}
              <th colSpan={1} className="bg-[#4a3b1a] border-b border-[#caa45a] !border-l-4 !border-l-[#caa45a] px-5 py-2"></th>
            </tr>
            <tr className="bg-[#5a4a26] text-xs uppercase text-[#e7dcc4]">
              <th className="bg-[#5a4a26] px-5 py-3">Employee ID</th>
              <th className="bg-[#5a4a26] px-5 py-3">Name</th>
              <th className="bg-[#5a4a26] !border-l-4 !border-l-[#caa45a] px-5 py-3">Role</th>
              <th className="bg-[#5a4a26] px-5 py-3">Status</th>
              {canManageLogins && <th className="bg-[#5a4a26] !border-l-4 !border-l-[#caa45a] px-5 py-3">Login Role</th>}
              {canManageLogins && <th className="bg-[#5a4a26] px-5 py-3">Login Email</th>}
              {canManageLogins && <th className="bg-[#5a4a26] px-5 py-3">Permissions</th>}
              <th className="bg-[#5a4a26] !border-l-4 !border-l-[#caa45a] px-5 py-3">Action</th>
            </tr>
          </thead>
          <tbody>
            {pg.slice.map((e) => (
              <tr key={e.id} className="group border-b border-border last:border-0 hover:bg-stone-50">
                <td className="px-5 py-3"><Link href={`/hr/directory/${e.id}`} className="font-mono text-xs text-muted">{empCode(e.id)}</Link></td>
                <td className="px-5 py-3">
                  <Link href={`/hr/directory/${e.id}`} className="flex items-center justify-center gap-3">
                    {e.photo_url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={e.photo_url} alt={e.name} className="h-9 w-9 shrink-0 rounded-full object-cover" />
                    ) : (
                      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">{empInitials(e.name)}</span>
                    )}
                    <span className="flex items-center gap-1.5 font-medium">{e.name}{e.on_call && <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-700">on-call</span>}</span>
                  </Link>
                </td>
                <td className="!border-l-4 !border-l-[#caa45a] px-5 py-3">
                  <span className="inline-flex flex-wrap justify-center gap-1">
                    {(e.role ?? "—").split(",").map((r) => r.trim()).filter(Boolean).map((r) => (
                      <span key={r} className={cn("inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset", roleBadge(r))}>{roleLabel(r)}</span>
                    ))}
                  </span>
                </td>
                <td className="px-5 py-3">
                  {e.active
                    ? <span className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-700"><span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />Active</span>
                    : <span className="inline-flex items-center gap-1.5 text-xs font-medium text-stone-500"><span className="h-1.5 w-1.5 rounded-full bg-stone-400" />Inactive</span>}
                </td>
                {canManageLogins && (() => {
                  const lg: EmployeeLoginInfo | undefined = loginBy[e.id];
                  return (
                    <>
                      <td className="!border-l-4 !border-l-[#caa45a] px-5 py-3">
                        {lg ? (
                          // Inline na role dropdown (2026-09-03) — pagpalit dito
                          // ay parehong setRole ng User Management (kasama ang
                          // reset ng overrides).
                          <select
                            value={(lg.status ?? "active") === "active" ? lg.role : ""}
                            disabled={pending}
                            onChange={(ev) => {
                              setErr(null);
                              if (!ev.target.value) {
                                // "— Select Role —" = AUTOMATIC na pag-alis ng access
                                // (2026-09-03, "automatic maalis ung role"): agad na
                                // dini-disable ang login, walang confirm — at babalik
                                // ito sa role kapag pumili ulit.
                                start(async () => { const r = await setEmployeeLoginStatus(lg.profileId, "inactive"); if ("error" in r) setErr(r.error); else router.refresh(); });
                                return;
                              }
                              const wasDisabled = (lg.status ?? "active") !== "active";
                              const fd = new FormData();
                              fd.set("user_id", lg.profileId); fd.set("role", ev.target.value);
                              start(async () => {
                                const r = await setRole(fd);
                                if ("error" in r) { setErr(r.error); return; }
                                // Pumili ng role habang disabled = ibalik ang access.
                                if (wasDisabled) {
                                  const r2 = await setEmployeeLoginStatus(lg.profileId, "active");
                                  if ("error" in r2) { setErr(r2.error); return; }
                                }
                                router.refresh();
                              });
                            }}
                            className="mx-auto block rounded-lg border border-border bg-stone-50 px-2 py-1.5 text-center text-xs outline-none focus:border-primary [&>option]:text-center"
                          >
                            <option value="">— Select Role —</option>
                            {ROLES.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
                          </select>
                        ) : (
                          // WALANG LOGIN PA (2026-09-03, "bakit ung iba wala"):
                          // dropdown pa rin — pagpili ng role ay bubuksan agad
                          // ang Create-login na naka-preselect na ang role.
                          <select
                            value=""
                            onChange={(ev) => {
                              if (!ev.target.value) return;
                              setCreateFor({ emp: e, role: ev.target.value });
                            }}
                            className="mx-auto block rounded-lg border border-dashed border-border bg-stone-50 px-2 py-1.5 text-center text-xs text-muted outline-none focus:border-primary [&>option]:text-center"
                            title="Pick a role to create this employee's login"
                          >
                            <option value="">— Select Role —</option>
                            {ROLES.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
                          </select>
                        )}
                      </td>
                      <td className="px-5 py-3">
                        {lg ? (
                          <button onClick={() => setPreviewLogin({ emp: e, lg })} title={lg.email ?? undefined} className="rounded-md px-2 py-1 text-[11px] font-semibold text-[#8a6a1f] ring-1 ring-inset ring-[#caa45a]/60 hover:bg-[#faf1dc]">View Credentials</button>
                        ) : (
                          <button onClick={() => setCreateFor({ emp: e })} className="rounded-md px-2 py-1 text-[11px] font-semibold text-[#8a6a1f] ring-1 ring-inset ring-[#caa45a]/60 hover:bg-[#faf1dc]">+ Create login</button>
                        )}
                      </td>
                      <td className="px-5 py-3">
                        {lg
                          ? <PermissionsDialog userId={lg.profileId} userName={e.name} userRole={lg.role as Role} />
                          : (
                            // LAGING NAKALITAW (2026-09-03): kahit walang login,
                            // may Permissions na pindutan — dadalhin ka nito sa
                            // paggawa ng account (doon nakatira ang grid).
                            <button
                              onClick={() => setCreateFor({ emp: e })}
                              title="Create the login first — permissions come with the account"
                              className="rounded-lg px-3 py-1 text-sm font-medium text-muted ring-1 ring-inset ring-border/70 hover:bg-stone-100"
                            >Permissions</button>
                          )}
                      </td>
                    </>
                  );
                })()}
                <td className="!border-l-4 !border-l-[#caa45a] px-5 py-3 text-center">
                  <div className="flex items-center justify-center gap-1.5">
                    {/* Ang View ay tinanggal (2026-09-03) — ang pangalan/ID ang link sa detail page, at ang Edit ang araw-araw na pinto. */}
                    <button onClick={() => { setEditWithLogin(false); setEditing(e); }} className="rounded-md px-2 py-1 text-xs font-medium ring-1 ring-inset ring-border text-muted hover:bg-stone-100">Edit</button>
                    {e.active && <FaceEnrollButton employeeId={e.id} employeeName={e.name} enrolled={!!e.face_enrolled_at} variant="pill" />}
                    {e.active && <EnrollerToggle employeeId={e.id} initial={!!(e as { can_enroll?: boolean }).can_enroll} />}
                    <button onClick={() => { setErr(null); setConfirmDel(e); }} title="Delete" className="rounded-md px-2 py-1 text-xs font-medium text-danger ring-1 ring-inset ring-red-600/20 hover:bg-red-50">Delete</button>
                  </div>
                </td>
              </tr>
            ))}
            {filtered.length === 0 && <tr><td colSpan={canManageLogins ? 8 : 5} className="px-5 py-12 text-center text-muted">{employees.length === 0 ? "No employees yet. Add your first one." : "No employees match."}</td></tr>}
          </tbody>
        </table>
        </div>
        <PaginationFooter page={pg.page} setPage={pg.setPage} pageSize={pg.pageSize} setPageSize={pg.setPageSize} total={pg.total} pages={pg.pages} />
      </Card>
      </>

      {adding && <EmployeeForm e={null} login={null} canManageLogins={canManageLogins} onClose={() => setAdding(false)} />}
      {editing && <EmployeeForm e={editing} login={loginBy[editing.id] ?? null} canManageLogins={canManageLogins} startWithLogin={editWithLogin} startLoginRole={editStartRole} onClose={() => { setEditing(null); setEditWithLogin(false); setEditStartRole(undefined); }} />}
      {createFor && <CreateLoginDialog emp={createFor.emp} presetRole={createFor.role} onClose={() => setCreateFor(null)} />}
      {previewLogin && <LoginPreviewDialog emp={previewLogin.emp} lg={previewLogin.lg} onClose={() => setPreviewLogin(null)} />}

      {confirmDel && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm" onClick={() => setConfirmDel(null)}>
          <div className="w-full max-w-sm overflow-hidden rounded-2xl bg-surface shadow-2xl ring-1 ring-black/5" onClick={(ev) => ev.stopPropagation()}>
            <div className="bg-[#5e2424] bg-gradient-to-br from-[#7a2e2e] to-[#4a1c1c] px-6 py-4"><h3 className="text-base font-semibold text-white">Delete employee?</h3></div>
            <div className="p-6">
              <p className="text-sm text-muted">Permanently delete <b className="text-foreground">{confirmDel.name}</b> ({empCode(confirmDel.id)})? This cannot be undone.</p>
              {err && <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{err}</p>}
              <div className="mt-5 flex justify-end gap-2">
                <button onClick={() => setConfirmDel(null)} className="rounded-lg border border-border px-4 py-2 text-sm font-medium hover:bg-stone-100">Cancel</button>
                <button onClick={doDelete} disabled={pending} className="rounded-lg bg-danger px-4 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-60">{pending ? "Deleting…" : "Delete"}</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── + CREATE LOGIN — maliit na focused dialog (2026-09-03) ───────────────────
// "yan lang dapat lalabas": email (prefill mula sa empleyado), temp password,
// at role — walang kasamang buong HR form. Isang Create at tapos.
function CreateLoginDialog({ emp, presetRole, onClose }: { emp: HrEmployee; presetRole?: string; onClose: () => void }) {
  const router = useRouter();
  const [email, setEmail] = useState(emp.email ?? "");
  const [pw, setPw] = useState("");
  const [role, setRoleV] = useState<string>(presetRole ?? "sales_staff");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  // PREVIEW NG CREDENTIALS (2026-09-03, "dapat na prepreview mo padin ung
  // credentials"): pagka-create, hindi agad nagsasara — ipinapakita ang email +
  // temp password nang isang beses (hindi na ito makukuhang muli pagkasara;
  // naka-hash na) na may copy button, para maibigay agad sa empleyado.
  const [created, setCreated] = useState(false);
  const [copied, setCopied] = useState(false);

  function create() {
    setError(null);
    if (!email.trim()) { setError("Login email is required."); return; }
    if (pw.length < 8) { setError("Temp password needs at least 8 characters."); return; }
    start(async () => {
      const r = await saveEmployeeLogin({ employeeId: emp.id, profileId: null, fullName: emp.name, email, role, tempPassword: pw });
      if ("error" in r) { setError(r.error); return; }
      setCreated(true);
      router.refresh();
    });
  }

  function copy() {
    try {
      void navigator.clipboard.writeText(`Login: ${email}\nTemp password: ${pw}`);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { /* walang clipboard — nakikita naman ang teksto */ }
  }

  if (created) {
    return (
      <Modal open onClose={onClose} title={`Login created — ${emp.name}`} description="Hand these to them now — the password is shown only this once."
        footer={<div className="flex justify-end"><button onClick={onClose} className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-accent hover:bg-primary/90">Done</button></div>}
      >
        <div className="space-y-3">
          <div className="rounded-xl border-[1.5px] border-[#caa45a]/70 bg-[#fdfaf3] p-4">
            <div className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
              <span className="text-xs font-bold uppercase tracking-wide text-[#8a6a1f]">Login email</span>
              <span className="font-mono text-sm">{email}</span>
              <span className="text-xs font-bold uppercase tracking-wide text-[#8a6a1f]">Temp password</span>
              <span className="font-mono text-sm">{pw}</span>
              <span className="text-xs font-bold uppercase tracking-wide text-[#8a6a1f]">Role</span>
              <span className="text-sm">{ROLE_LABEL[role as Role] ?? role}</span>
            </div>
            <button onClick={copy} className="mt-3 rounded-lg px-3 py-1.5 text-xs font-semibold ring-1 ring-inset ring-[#caa45a]/60 text-[#8a6a1f] hover:bg-[#faf1dc]">{copied ? "Copied" : "Copy credentials"}</button>
          </div>
          <p className="text-xs text-muted">Once this closes, the password can&apos;t be shown again — only reset via Set temp password. They should change it after first sign-in.</p>
        </div>
      </Modal>
    );
  }

  return (
    <Modal open onClose={onClose} title={`Create login — ${emp.name}`} description="They sign in with the temporary password you set and can change it after."
      footer={
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="rounded-lg px-4 py-2 text-sm font-medium ring-1 ring-inset ring-border hover:bg-stone-100">Cancel</button>
          <button onClick={create} disabled={pending} className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-accent hover:bg-primary/90 disabled:opacity-60">{pending ? "Creating…" : "Create login"}</button>
        </div>
      }
    >
      <div className="space-y-3">
        <div>
          <label className="mb-1 block text-sm font-medium">Login email</label>
          <input value={email} onChange={(ev) => setEmail(ev.target.value)} type="email" placeholder="name@panfurniture.ph" className="w-full rounded-lg border border-border bg-stone-50 px-3 py-2 text-sm outline-none focus:border-primary focus:bg-surface" />
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium">Temp password (8+ chars)</label>
          <input value={pw} onChange={(ev) => setPw(ev.target.value)} type="text" placeholder="They change it after first sign-in" className="w-full rounded-lg border border-border bg-stone-50 px-3 py-2 text-sm outline-none focus:border-primary focus:bg-surface" />
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium">Login role (permission preset)</label>
          <select value={role} onChange={(ev) => setRoleV(ev.target.value)} className="w-full rounded-lg border border-border bg-stone-50 px-3 py-2 text-sm outline-none focus:border-primary">
            {ROLES.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
          </select>
        </div>
        <p className="text-xs text-muted">The role&apos;s default pages apply right away — fine-tune anytime via the row&apos;s Permissions button.</p>
        {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 ring-1 ring-inset ring-red-600/20">{error}</p>}
      </div>
    </Modal>
  );
}

// Isang hilera ng preview card: label sa kaliwa, halaga sa kanan, may divider.
function PreviewRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-[#caa45a]/20 px-4 py-2.5 last:border-0">
      <span className="shrink-0 text-[11px] font-bold uppercase tracking-wide text-[#8a6a1f]">{label}</span>
      <span className="text-right text-sm">{children}</span>
    </div>
  );
}

// ── APP LOGIN PREVIEW ng existing account (2026-09-03) ───────────────────────
// Pindot sa email sa table → buong detalye ng login sa isang tingin. Ang
// password ay naka-hash at hindi na maipapakita — ang Set temp password dito
// ang gumagawa ng bago at ipinapakita ito nang isang beses.
function LoginPreviewDialog({ emp, lg, onClose }: { emp: HrEmployee; lg: EmployeeLoginInfo; onClose: () => void }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [showPw, setShowPw] = useState(false);
  const [pwOpen, setPwOpen] = useState(false);
  const [freshPw, setFreshPw] = useState<string | null>(null);
  const [confirmDel, setConfirmDel] = useState(false);
  const active = (lg.status ?? "active") === "active";
  function copyEmail() {
    try {
      void navigator.clipboard.writeText(lg.tempPassword ? `Login: ${lg.email ?? ""}\nPassword: ${lg.tempPassword}` : (lg.email ?? ""));
      setCopied(true); setTimeout(() => setCopied(false), 2000);
    } catch { /* kita naman ang teksto */ }
  }

  return (
    <Modal open onClose={onClose} title={`App Login — ${emp.name}`} description="Shows the temp password the admin issued. If they changed their password themselves since, this copy is stale."
      footer={<div className="flex justify-end"><button onClick={onClose} className="rounded-lg px-4 py-2 text-sm font-medium ring-1 ring-inset ring-border hover:bg-stone-100">Close</button></div>}
    >
      <div className="space-y-3">
        <div className="overflow-hidden rounded-xl border-[1.5px] border-[#caa45a]/70 bg-[#fdfaf3]">
          <PreviewRow label="Login email"><span className="font-mono">{lg.email ?? "—"}</span></PreviewRow>
          <PreviewRow label="Password">
            {(freshPw ?? lg.tempPassword) ? (
              <span className="inline-flex items-center gap-2">
                <span className="font-mono">{showPw ? (freshPw ?? lg.tempPassword) : "••••••••"}</span>
                <button onClick={() => setShowPw((v) => !v)} className="rounded px-1.5 py-0.5 text-[11px] font-semibold text-[#8a6a1f] ring-1 ring-inset ring-[#caa45a]/60 hover:bg-[#faf1dc]">{showPw ? "Hide" : "Show"}</button>
              </span>
            ) : (
              <span className="text-muted">Not on record — use Set temp password to issue a viewable one</span>
            )}
          </PreviewRow>
          <PreviewRow label="Login role">{ROLE_LABEL[lg.role as Role] ?? lg.role}</PreviewRow>
          <PreviewRow label="Status">
            <span className={cn("inline-flex items-center gap-1.5 font-semibold", active ? "text-emerald-700" : "text-stone-500")}>
              <span className={cn("h-1.5 w-1.5 rounded-full", active ? "bg-emerald-500" : "bg-stone-400")} />{active ? "Active" : "Disabled"}
            </span>
          </PreviewRow>
          <PreviewRow label="Linked to">{emp.name} <span className="font-mono text-xs text-muted">· {empCode(emp.id)}</span></PreviewRow>
          <div className="flex flex-wrap justify-end gap-2 border-t border-[#caa45a]/30 bg-[#faf1dc]/50 px-4 py-2.5">
            <button onClick={copyEmail} className="rounded-lg px-3 py-1.5 text-xs font-semibold text-[#8a6a1f] ring-1 ring-inset ring-[#caa45a]/60 hover:bg-[#faf1dc]">{copied ? "Copied" : lg.tempPassword ? "Copy credentials" : "Copy email"}</button>
            {/* Ang enable/disable ay AUTOMATIC na sa Login Role dropdown ng
                table ("— Select Role —" = alis, pumili ulit = balik) — walang
                hiwalay na button dito. */}
            <button onClick={() => setPwOpen(true)} disabled={pending} className="rounded-lg px-3 py-1.5 text-xs font-medium ring-1 ring-inset ring-border hover:bg-stone-100 disabled:opacity-60">Set temp password</button>
            {/* DELETE CREDENTIALS (Joe 2026-09-05): tanggalin ang app login ng
                empleyado — binubura ang auth account at profile (nakakalas ang
                link), NANANATILI ang employee record. Dalawang pindot: kumpirma muna. */}
            <button onClick={() => setConfirmDel(true)} disabled={pending || confirmDel} className="rounded-lg px-3 py-1.5 text-xs font-medium text-red-700 ring-1 ring-inset ring-red-200 hover:bg-red-50 disabled:opacity-60">Delete credentials</button>
          </div>
          {confirmDel && (
            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-red-200 bg-red-50 px-4 py-2.5 text-xs text-red-800">
              <span>Delete the app login of <b>{emp.name}</b> ({lg.email})? They can no longer sign in. The employee record stays; you can issue a new login later.</span>
              <span className="flex gap-2">
                <button onClick={() => setConfirmDel(false)} disabled={pending} className="rounded-lg px-3 py-1.5 font-medium ring-1 ring-inset ring-border hover:bg-white">Cancel</button>
                <button
                  onClick={() => start(async () => {
                    const fd = new FormData(); fd.set("user_id", lg.profileId);
                    const r = await deleteUser(fd);
                    if ("error" in r) { setMsg(r.error); setConfirmDel(false); return; }
                    router.refresh(); onClose();
                  })}
                  disabled={pending}
                  className="rounded-lg bg-red-700 px-3 py-1.5 font-bold text-white hover:bg-red-800 disabled:opacity-60"
                >
                  {pending ? "Deleting…" : "Yes, delete login"}
                </button>
              </span>
            </div>
          )}
        </div>
        {msg && <p className="rounded-lg bg-stone-100 px-3 py-2 text-xs text-foreground ring-1 ring-inset ring-border">{msg}</p>}
      </div>
      {pwOpen && (
        <SetPasswordDialog profileId={lg.profileId} name={emp.name}
          onSet={(p) => { setFreshPw(p); setShowPw(true); router.refresh(); }}
          onClose={() => setPwOpen(false)} />
      )}
    </Modal>
  );
}

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return <button onClick={onClick} className={cn("rounded-full px-3 py-1.5 text-sm font-medium ring-1 ring-inset transition-colors", active ? "bg-primary text-primary-foreground ring-primary" : "bg-surface text-muted ring-border hover:bg-stone-100")}>{children}</button>;
}
