// SINO ANG PWEDENG GUMAMIT NG MATERIAL — ang GMA Project Base na workers.
//
// Ang loadEmployeesLite (hr/projects) ay nagbabalik ng Constructor AT Project
// Base na empleyado. Ang Constructor ay payroll na per-day; ang Project Base
// ang tunay na gumagawa sa workshop ("GMA Project Base - Carpentry",
// "GMA Project Base - Upholstery"). Sila lang ang pagpipilian sa "Used by".
//
// LAHAT ng section ang isinasama, hindi hinuhulaan kung aling section ang
// workshop — ang isang upholsterer ay pwedeng kumuha ng foam sa parehong
// workshop na kinukunan ng carpenter ng kahoy.

export type WorkerLite = { id: number; name: string; role?: string | null };

export function projectBaseWorkers(list: ReadonlyArray<WorkerLite> | null | undefined): WorkerLite[] {
  const seen = new Set<string>();
  const out: WorkerLite[] = [];
  for (const w of list ?? []) {
    const name = String(w.name ?? "").trim();
    if (!name) continue;
    if (!/project\s*base/i.test(String(w.role ?? ""))) continue;
    // Dobleng pangalan (dalawang row, parehong tao) — isa lang sa dropdown.
    const k = name.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push({ id: w.id, name, role: w.role ?? null });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

// ANG UNANG LINYANG WALANG PANGALAN - null kung kumpleto ang lahat.
//
// Ang "Used by" ay kada linya ng Selected (2026-08-23): magkakaiba ang kumuha
// ng plywood at ng foam. Ang Confirm ay tumatanggi hangga't may isang linyang
// blangko, at ang pangalan ng MATERIAL na iyon ang sinasabi - hindi "may
// kulang", kundi "1/2 plywood - sino ang gumamit?".
export function firstWithoutWorker<T extends { name: string; usedBy?: string | null }>(lines: ReadonlyArray<T>): T | null {
  for (const l of lines) if (!String(l.usedBy ?? "").trim()) return l;
  return null;
}
