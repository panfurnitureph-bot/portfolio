import { createServerSupabase } from "@/lib/supabase/server";
import type { Employee, EmployeeRole } from "./types";

export type { Employee, EmployeeRole } from "./types";
export { ROLE_LABEL } from "./types";

export async function loadEmployees(): Promise<Employee[]> {
  const db = createServerSupabase();
  const { data } = await db
    .from("employees")
    .select("id, name, role, on_call, rate, contact, active")
    .order("role")
    .order("on_call")
    .order("name")
    .limit(5000);
  return (data ?? []) as Employee[];
}

// Active employees for a role (name + on_call) for app dropdowns. Regular first.
export async function employeesByRole(role: EmployeeRole): Promise<{ name: string; on_call: boolean; role: string }[]> {
  const db = createServerSupabase();
  // Match by keyword so configurable role names (e.g. "On Call Driver",
  // "Quality Assurance") still resolve to the right group.
  const KEYWORDS: Record<string, string[]> = {
    driver: ["driver"], qa: ["qa", "quality"], installer: ["install"],
    sales: ["sales"], constructor: ["constructor"], coordinator: ["coordinator"],
  };
  const keys = KEYWORDS[role] ?? [role];
  const orExpr = keys.map((k) => `role.ilike.%${k}%`).join(",");
  const { data } = await db.from("employees").select("name, on_call, role").or(orExpr).eq("active", true).order("name").limit(5000);
  const seen = new Set<string>();
  const out: { name: string; on_call: boolean; role: string }[] = [];
  for (const r of data ?? []) {
    if (seen.has(r.name as string)) continue;
    seen.add(r.name as string);
    const roleName = (r.role as string) ?? "";
    // On-call group reflects either the flag OR an "On Call …" role name.
    const onCall = !!r.on_call || /on\s*call/i.test(roleName);
    out.push({ name: r.name as string, on_call: onCall, role: roleName });
  }
  out.sort((a, b) => a.role.localeCompare(b.role) || Number(a.on_call) - Number(b.on_call) || a.name.localeCompare(b.name));
  return out;
}
