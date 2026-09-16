// Client-safe types + labels (no server-only imports).
export type EmployeeRole = "sales" | "driver" | "qa" | "installer" | "coordinator";

export type Employee = {
  id: number;
  name: string;
  role: EmployeeRole;
  on_call: boolean;
  rate: number | null;
  contact: string | null;
  active: boolean;
};

export const ROLE_LABEL: Record<EmployeeRole, string> = {
  sales: "Sales",
  driver: "Driver",
  qa: "QA",
  installer: "Installer",
  coordinator: "Delivery Coordinator",
};
