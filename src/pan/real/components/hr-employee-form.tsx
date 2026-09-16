"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Modal } from "./modal";
import { cn } from "./ui";
import { createEmployee, updateEmployee, deleteEmployee, uploadEmployeePhoto, type HrEmployeeInput } from "@/app/hr/directory/actions";
import { ROLE_OPTIONS, roleLabel, EMPLOYMENT_TYPES, RATE_TYPES, DAYS_OFF, type HrEmployee } from "@/lib/hr/types";
import { saveEmployeeLogin, setEmployeeLoginStatus } from "@/app/hr/directory/login-actions";
import type { EmployeeLoginInfo } from "@/app/hr/directory/data";
import { ROLES, ROLE_LABEL, type Role } from "@/lib/auth/rbac";
import { PermissionsPanel } from "@/app/users/permissions-dialog";
import { SetPasswordDialog } from "./set-password-dialog";

const inp ="w-full rounded-lg border border-border bg-stone-50 px-3 py-2 text-sm outline-none focus:border-primary focus:bg-surface";
const btnPrimary = "rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-accent hover:bg-primary/90 disabled:opacity-60";

export function empInitials(name: string) {
  const p = name.trim().split(/\s+/).filter(Boolean);
  return ((p[0]?.[0] ?? "") + (p[1]?.[0] ?? "")).toUpperCase() || "?";
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div><label className="mb-1 block text-sm font-medium">{label}</label>{children}</div>;
}

// MULTI-SELECT DROPDOWN (2026-09-03, "mas okay if mga drop down nalang kase
// masyado mahaba"): ang 18 role chips ay tatlong hanay ng espasyo — ito ay
// isang linya na bumubukas na checkbox list. Native <details> para walang
// click-away wiring; bukas habang pumipili (multi nga).
function MultiPick({ options, values, onToggle, labelOf, placeholder }: {
  options: readonly string[]; values: string[]; onToggle: (v: string) => void;
  labelOf?: (v: string) => string; placeholder: string;
}) {
  const lab = labelOf ?? ((v: string) => v);
  return (
    <details className="relative">
      <summary className={cn(inp, "flex cursor-pointer list-none items-center justify-between gap-2 [&::-webkit-details-marker]:hidden")}>
        <span className={cn("truncate", values.length === 0 && "text-muted")}>{values.length ? values.map(lab).join(", ") : placeholder}</span>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="shrink-0 text-muted"><path d="m6 9 6 6 6-6" /></svg>
      </summary>
      <div className="absolute z-30 mt-1 max-h-56 w-full overflow-auto rounded-lg border border-border bg-surface p-1.5 shadow-xl">
        {options.map((o) => (
          <label key={o} className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-stone-100">
            <input type="checkbox" checked={values.includes(o)} onChange={() => onToggle(o)} className="h-3.5 w-3.5 accent-primary" />
            <span className="truncate">{lab(o)}</span>
          </label>
        ))}
      </div>
    </details>
  );
}
// ORGANISADONG SECTIONS (2026-09-03, "iorganize ung ui"): bawat pangkat ay
// isang card na may pareparehong header band — kita agad ang hangganan ng
// Personal / Employment / Compensation / IDs / App Login sa mahabang form.
// Ang `accent` (App Login) ay may gintong gilid para kitang seguridad ito.
function FormSection({ title, children, accent = false, aside }: { title: string; children: React.ReactNode; accent?: boolean; aside?: React.ReactNode }) {
  return (
    <section className={cn("space-y-3 rounded-xl border p-4", accent ? "border-[#caa45a]/70 bg-[#fdfaf3]" : "border-border bg-stone-50/40")}>
      <div className={cn("-mx-4 -mt-4 mb-1 flex items-center justify-between rounded-t-xl border-b px-4 py-2.5", accent ? "border-[#caa45a]/40 bg-[#faf1dc]/60" : "border-border/70 bg-stone-100/60")}>
        <h3 className={cn("text-[11px] font-bold uppercase tracking-[0.12em]", accent ? "text-[#8a6a1f]" : "text-muted")}>{title}</h3>
        {aside}
      </div>
      {children}
    </section>
  );
}

// Add/Edit employee modal — shared by the directory list and the detail view.
export function EmployeeForm({ e, onClose, onSaved, onDeleted, login, canManageLogins = false, startWithLogin = false, startLoginRole }: {
  e: HrEmployee | null; onClose: () => void; onSaved?: () => void; onDeleted?: () => void;
  // UNIFIED DIRECTORY (2026-09-03, "isang edit nalang"): ang login account ng
  // empleyadong ito (kung meron) at kung admin ba ang nakatingin — ang App
  // Login section ay para lang sa admin, gaya ng dating User Management.
  login?: EmployeeLoginInfo | null; canManageLogins?: boolean;
  // "+ Create login" sa row (2026-09-03): bukas agad ang App Login section na
  // naka-ON na ang toggle — diretso sa punto. Ang startLoginRole ay ang role na
  // pinili sa row dropdown — naka-preselect na pagbukas.
  startWithLogin?: boolean;
  startLoginRole?: string;
}) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);

  const [name, setName] = useState(e?.name ?? "");
  // MULTI-ROLE: comma-joined sa DB ("Driver, Delivery Team A") — chips sa form.
  const [roles, setRoles] = useState<string[]>(
    (e?.role ?? ROLE_OPTIONS[0]).split(",").map((r) => r.trim()).filter(Boolean),
  );
  const toggleRole = (r: string) => setRoles((prev) => (prev.includes(r) ? prev.filter((x) => x !== r) : [...prev, r]));
  const [employmentType, setEmploymentType] = useState(e?.employment_type ?? "Regular");
  const [workSetup, setWorkSetup] = useState(e?.work_setup ?? "Onsite");
  const [hireDate, setHireDate] = useState(e?.hire_date ?? "");
  const [daysOff, setDaysOff] = useState<string[]>(e?.day_off ? e.day_off.split(",").map((s) => s.trim()).filter(Boolean) : []);
  const toggleDay = (d: string) => setDaysOff((prev) => (prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d]));
  const [onCall, setOnCall] = useState(e?.on_call ?? false);
  const [branch, setBranch] = useState(e?.branch ?? "");
  const [active, setActive] = useState(e?.active ?? true);
  const [contact, setContact] = useState(e?.contact ?? "");
  const [email, setEmail] = useState(e?.email ?? "");
  const [address, setAddress] = useState(e?.address ?? "");
  const [birthdate, setBirthdate] = useState(e?.birthdate ?? "");
  const [rate, setRate] = useState(e?.rate != null ? String(e.rate) : "");
  const [rateType, setRateType] = useState(e?.rate_type ?? "Monthly");
  const [allowance, setAllowance] = useState(e?.allowance != null ? String(e.allowance) : "");
  const [sss, setSss] = useState(e?.sss_no ?? "");
  const [philhealth, setPhilhealth] = useState(e?.philhealth_no ?? "");
  const [pagibig, setPagibig] = useState(e?.pagibig_no ?? "");
  const [tin, setTin] = useState(e?.tin ?? "");
  const [bank, setBank] = useState(e?.bank_account ?? "");
  const [photoUrl, setPhotoUrl] = useState(e?.photo_url ?? "");
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  // ── APP LOGIN (unified directory) ──────────────────────────────────────────
  const [hasLogin, setHasLogin] = useState(!!login || startWithLogin);
  // AYUSIN ANG PAGBUKAS (2026-09-03, "ausin ung mismong modal"): kapag mula sa
  // row ang pagbukas (role pick / + Create login / Permissions), diretsong
  // dumadausdos sa App Login section — hindi na maghahanap sa mahabang form.
  const loginSecRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (startWithLogin) {
      const t = setTimeout(() => loginSecRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 120);
      return () => clearTimeout(t);
    }
  }, [startWithLogin]);
  const [loginEmail, setLoginEmail] = useState(login?.email ?? e?.email ?? "");
  const [loginRole, setLoginRole] = useState<string>(login?.role ?? startLoginRole ?? "sales_staff");
  const [tempPw, setTempPw] = useState("");
  const [loginStatus, setLoginStatus] = useState(login?.status ?? null);
  const [loginMsg, setLoginMsg] = useState<string | null>(null);

  // Isang Save = empleyado + login. Ang error ng login ay hindi nagba-block sa
  // na-save nang HR record — ipinapakita, bukas pa rin ang modal para maulit.
  async function saveLoginIfNeeded(employeeId: number): Promise<string | null> {
    if (!canManageLogins) return null;
    if (login && !hasLogin) {
      const r = await setEmployeeLoginStatus(login.profileId, "inactive");
      return "error" in r ? r.error : null;
    }
    if (!hasLogin) return null;
    const r = await saveEmployeeLogin({
      employeeId, profileId: login?.profileId ?? null, fullName: name,
      email: loginEmail, role: loginRole, tempPassword: login ? null : tempPw,
    });
    return "error" in r ? r.error : null;
  }

  // In-app na Set-temp-password dialog (2026-09-03) — hindi na window.prompt.
  const [pwDialogOpen, setPwDialogOpen] = useState(false);

  function toggleLoginStatus() {
    if (!login) return;
    const next = (loginStatus ?? "active") === "active" ? "inactive" : "active";
    setLoginMsg(null);
    start(async () => {
      const r = await setEmployeeLoginStatus(login.profileId, next as "active" | "inactive");
      if ("error" in r) setLoginMsg(r.error);
      else { setLoginStatus(next); router.refresh(); }
    });
  }

  function pickPhoto(file: File | undefined) {
    if (!file) return;
    setError(null); setUploading(true);
    const fd = new FormData(); fd.append("file", file);
    start(async () => { const res = await uploadEmployeePhoto(fd); setUploading(false); if ("error" in res) setError(res.error); else setPhotoUrl(res.url); });
  }
  function done() { onClose(); onSaved?.(); router.refresh(); }
  function save() {
    setError(null);
    if (roles.length === 0) { setError("Pick at least one role."); return; }
    const input: HrEmployeeInput = {
      name, role: roles.join(", "), on_call: onCall, rate: rate.trim() ? Number(rate) : null, rate_type: rateType,
      allowance: allowance.trim() ? Number(allowance) : null, contact, email, address, position: e?.position ?? null, department: e?.department ?? null,
      employment_type: employmentType, work_setup: workSetup, hire_date: hireDate.trim() || null, birthdate: birthdate.trim() || null,
      day_off: daysOff.length ? daysOff.join(", ") : null, photo_url: photoUrl.trim() || null,
      branch: branch || null,
      sss_no: sss, philhealth_no: philhealth, pagibig_no: pagibig, tin, bank_account: bank, active,
    };
    // Bagong login ay kailangan ng email + temp password bago pa mag-save.
    if (canManageLogins && hasLogin && !login) {
      if (!loginEmail.trim()) { setError("Login email is required for the new login."); return; }
      if (tempPw.length < 8) { setError("Temp password needs at least 8 characters."); return; }
    }
    start(async () => {
      const res = e ? await updateEmployee(e.id, input) : await createEmployee(input);
      if ("error" in res) { setError(res.error); return; }
      const empId = e?.id ?? ((res as { id?: number | null }).id ?? null);
      if (empId != null) {
        const loginErr = await saveLoginIfNeeded(empId);
        if (loginErr) { setError(`Employee saved, but the login was not: ${loginErr}`); return; }
      }
      done();
    });
  }
  function del() { if (!e || !confirm(`Delete ${e.name}? This cannot be undone.`)) return; start(async () => { const res = await deleteEmployee(e.id); if ("error" in res) setError(res.error); else if (onDeleted) { onClose(); onDeleted(); } else done(); }); }

  return (
    <Modal open onClose={onClose} title={e ? "Edit employee" : "Add employee"} size="xl"
      footer={
        <div className="flex items-center justify-between gap-2">
          {e ? <button onClick={del} disabled={pending} className="rounded-lg px-3 py-2 text-sm font-medium text-danger ring-1 ring-inset ring-red-600/20 hover:bg-red-50">Delete</button> : <span />}
          <div className="flex gap-2">
            <button onClick={onClose} className="rounded-lg px-4 py-2 text-sm font-medium ring-1 ring-inset ring-border hover:bg-stone-100">Cancel</button>
            <button onClick={save} disabled={pending || uploading || !name.trim()} className={btnPrimary}>Save</button>
          </div>
        </div>
      }
    >
      <div className="space-y-6">
        <div className="flex items-center gap-4">
          {photoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={photoUrl} alt="Photo" className="h-20 w-20 shrink-0 rounded-full object-cover ring-1 ring-border" />
          ) : (
            <span className="flex h-20 w-20 shrink-0 items-center justify-center rounded-full bg-primary/10 text-lg font-semibold text-primary">{empInitials(name || "?")}</span>
          )}
          <div onClick={() => fileRef.current?.click()} onDragOver={(ev) => ev.preventDefault()} onDrop={(ev) => { ev.preventDefault(); pickPhoto(ev.dataTransfer.files?.[0]); }}
            className="flex flex-1 cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed border-border px-4 py-5 text-center text-sm text-muted hover:border-primary hover:bg-stone-50">
            <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={(ev) => pickPhoto(ev.target.files?.[0] ?? undefined)} />
            {uploading ? "Uploading…" : <><span className="font-medium text-foreground">Click to upload</span> or drag a photo here</>}
          </div>
        </div>

        <FormSection title="Personal">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Full name"><input value={name} onChange={(ev) => setName(ev.target.value)} className={inp} /></Field>
            <Field label="Contact"><input value={contact} onChange={(ev) => setContact(ev.target.value)} className={inp} /></Field>
            <Field label="Email"><input value={email} onChange={(ev) => setEmail(ev.target.value)} type="email" className={inp} /></Field>
            <Field label="Birthdate"><input value={birthdate ?? ""} onChange={(ev) => setBirthdate(ev.target.value)} type="date" className={inp} /></Field>
            <div className="sm:col-span-2"><Field label="Address"><input value={address} onChange={(ev) => setAddress(ev.target.value)} className={inp} /></Field></div>
          </div>
        </FormSection>

        <FormSection title="Employment" aside={
          <span className="flex items-center gap-3">
            <label className="flex items-center gap-1.5 text-xs font-semibold"><input type="checkbox" checked={onCall} onChange={(ev) => setOnCall(ev.target.checked)} className="h-3.5 w-3.5 accent-primary" /> On-call</label>
            <label className="flex items-center gap-1.5 text-xs font-semibold"><input type="checkbox" checked={active} onChange={(ev) => setActive(ev.target.checked)} className="h-3.5 w-3.5 accent-primary" /> Active</label>
          </span>
        }>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <Field label="Role (pick one or more)">
                <MultiPick options={ROLE_OPTIONS} values={roles} onToggle={toggleRole} labelOf={roleLabel} placeholder="— select role(s) —" />
              </Field>
            </div>
            <Field label="Employment type"><select value={employmentType} onChange={(ev) => setEmploymentType(ev.target.value as typeof employmentType)} className={inp}>{EMPLOYMENT_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}</select></Field>
            <Field label="Work setup"><select value={workSetup} onChange={(ev) => setWorkSetup(ev.target.value)} className={inp}><option value="Onsite">Onsite</option><option value="WFH">WFH</option><option value="Hybrid">Hybrid</option></select></Field>
            <Field label="Hire date"><input value={hireDate ?? ""} onChange={(ev) => setHireDate(ev.target.value)} type="date" className={inp} /></Field>
            {/* Showroom ng empleyado — auto-tag ng branch sa orders na pino-process nila (PAN Overall). */}
            <Field label="Showroom Branch"><select value={branch} onChange={(ev) => setBranch(ev.target.value)} className={inp}><option value="">—</option><option value="San Pedro">San Pedro</option><option value="Carmona">Carmona, Cavite</option></select></Field>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Day off (pick one or more)">
              <MultiPick options={DAYS_OFF} values={daysOff} onToggle={toggleDay} labelOf={(d) => d} placeholder="— select day(s) —" />
            </Field>
          </div>
        </FormSection>

        <FormSection title="Compensation">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Field label="Rate"><input value={rate} onChange={(ev) => setRate(ev.target.value)} type="number" placeholder="₱" className={inp} /></Field>
            <Field label="Rate type"><select value={rateType} onChange={(ev) => setRateType(ev.target.value as typeof rateType)} className={inp}>{RATE_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}</select></Field>
            <Field label="Allowance"><input value={allowance} onChange={(ev) => setAllowance(ev.target.value)} type="number" placeholder="₱" className={inp} /></Field>
          </div>
        </FormSection>

        <FormSection title="Government IDs & Banking">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <Field label="SSS No."><input value={sss} onChange={(ev) => setSss(ev.target.value)} className={inp} /></Field>
            <Field label="PhilHealth No."><input value={philhealth} onChange={(ev) => setPhilhealth(ev.target.value)} className={inp} /></Field>
            <Field label="Pag-IBIG No."><input value={pagibig} onChange={(ev) => setPagibig(ev.target.value)} className={inp} /></Field>
            <Field label="TIN"><input value={tin} onChange={(ev) => setTin(ev.target.value)} className={inp} /></Field>
            <div className="sm:col-span-2"><Field label="Bank account"><input value={bank} onChange={(ev) => setBank(ev.target.value)} className={inp} /></Field></div>
          </div>
        </FormSection>

        {canManageLogins && (
          <div ref={loginSecRef}>
          <FormSection title="App Login" accent aside={
            <span className="flex items-center gap-2.5">
              {login && (
                <span className={cn("rounded-full px-2.5 py-0.5 text-[11px] font-bold ring-1 ring-inset",
                  (loginStatus ?? "active") === "active" ? "bg-emerald-50 text-emerald-700 ring-emerald-600/20" : "bg-stone-100 text-stone-500 ring-border")}>
                  {(loginStatus ?? "active") === "active" ? "Active" : "Disabled"}
                </span>
              )}
              <label className="flex items-center gap-1.5 text-xs font-semibold">
                <input type="checkbox" checked={hasLogin} onChange={(ev) => setHasLogin(ev.target.checked)} className="h-3.5 w-3.5 accent-primary" />
                Has app login
              </label>
            </span>
          }>
            <div className="space-y-3">
              {hasLogin && (
                <>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <Field label="Login email"><input value={loginEmail} onChange={(ev) => setLoginEmail(ev.target.value)} type="email" placeholder="name@panfurniture.ph" className={inp} /></Field>
                    {!login && (
                      <Field label="Temp password (8+ chars)">
                        <input value={tempPw} onChange={(ev) => setTempPw(ev.target.value)} type="text" placeholder="They change it after first sign-in" className={inp} />
                      </Field>
                    )}
                    <Field label="Login role (permission preset)">
                      <select value={loginRole} onChange={(ev) => setLoginRole(ev.target.value)} className={inp}>
                        {ROLES.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
                      </select>
                    </Field>
                  </div>
                  <p className="text-xs text-muted">
                    {login
                      ? "Changing the role resets this user's permission overrides to the new role's defaults — fine-tune below."
                      : "Save creates the account, linked to this employee. The role's default pages apply; fine-tune permissions after."}
                  </p>
                  {login && (
                    <div className="flex flex-wrap items-center gap-2">
                      <button type="button" onClick={() => setPwDialogOpen(true)} className="rounded-md px-2.5 py-1.5 text-xs font-medium ring-1 ring-inset ring-border hover:bg-stone-100">Set temp password</button>
                      <button type="button" onClick={toggleLoginStatus} className={cn("rounded-md px-2.5 py-1.5 text-xs font-medium ring-1 ring-inset",
                        (loginStatus ?? "active") === "active" ? "text-danger ring-red-600/20 hover:bg-red-50" : "text-emerald-700 ring-emerald-600/20 hover:bg-emerald-50")}>
                        {(loginStatus ?? "active") === "active" ? "Disable login" : "Enable login"}
                      </button>
                    </div>
                  )}
                  {loginMsg && <p className="rounded-lg bg-stone-100 px-3 py-2 text-xs text-foreground ring-1 ring-inset ring-border">{loginMsg}</p>}
                  {/* MAGKADUGTONG (2026-09-03): ang permissions grid ay nasa
                      loob mismo ng App Login section — hindi na hiwalay na
                      popup. Sa BAGONG login: lalabas ito pagkatapos ng unang
                      Save (kailangan muna ang account). */}
                  {login ? (
                    <div className="rounded-xl border border-border bg-surface p-3">
                      <h4 className="mb-2 text-[11px] font-bold uppercase tracking-[0.12em] text-muted">Permissions</h4>
                      <PermissionsPanel userId={login.profileId} userRole={(login.role as Role) ?? "sales_staff"} />
                    </div>
                  ) : (
                    <p className="text-xs text-muted">The permissions grid appears right here after the first Save creates the account (the role&apos;s defaults apply immediately).</p>
                  )}
                </>
              )}
              {!hasLogin && login && (
                <p className="text-xs text-amber-700">Unticked — saving will DISABLE this login ({login.email}). The account is kept and can be re-enabled.</p>
              )}
              {!hasLogin && !login && <p className="text-xs text-muted">No app login — tick the box to create one together with this employee.</p>}
            </div>
          </FormSection>
          {pwDialogOpen && login && (
            <SetPasswordDialog profileId={login.profileId} name={name || login.fullName || loginEmail}
              onSet={(p) => setLoginMsg(`Temp password set: ${p} — hand it to them now; they change it after first sign-in.`)}
              onClose={() => setPwDialogOpen(false)} />
          )}
          </div>
        )}

        {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 ring-1 ring-inset ring-red-600/20">{error}</p>}
      </div>
    </Modal>
  );
}
