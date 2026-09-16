// Role-Based Access Control — shared by sidebar (UI), proxy (route guard), and server actions.
// App-gate model: roles map to allowed route prefixes. "*" = full access.
// Role values MUST match the Postgres `user_role` enum (migration 0001).

export type Role =
  | "developer"
  | "administrator"
  | "operations_manager"
  | "human_resources"
  | "sales_staff"
  | "warehouse_staff"
  | "attendance_kiosk"
  | "delivery_team_a"
  | "delivery_team_b"
  | "delivery_team_c"
  | "delivery_team_d"
  | "workshop_gma_original"
  | "workshop_gma_white"
  | "workshop_lrt";

export const ROLES: Role[] = [
  "developer",
  "administrator",
  "human_resources",
  "operations_manager",
  "sales_staff",
  "warehouse_staff",
  "attendance_kiosk",
  "delivery_team_a",
  "workshop_gma_white",
];

export const ROLE_LABEL: Record<Role, string> = {
  developer: "Developer",
  administrator: "Administrator",
  human_resources: "Human Resources",
  operations_manager: "Operation Manager",
  sales_staff: "Sales & Service",
  warehouse_staff: "Warehouse & Delivery",
  attendance_kiosk: "Attendance Kiosk",
  delivery_team_a: "Delivery Team",
  delivery_team_b: "Delivery Team B",
  delivery_team_c: "Delivery Team C",
  delivery_team_d: "Delivery Team D",
  workshop_gma_original: "GMA Original Workshop",
  workshop_gma_white: "Production Area",
  workshop_lrt: "LRT Workshop",
};

// Workshop-tablet roles: naka-lock sa SARILING workshop (by name sa `workshop`
// table — loadWorkshop ang nagpapatupad; ang ?ws= switcher ay balewala sa kanila).
export const WORKSHOP_ROLE_NAME: Partial<Record<Role, string>> = {
  workshop_gma_original: "GMA Original Workshop",
  workshop_gma_white: "Production Area",
  workshop_lrt: "LRT Workshop",
};

// Team-tablet roles: naka-lock sa sariling team pages lang.
export const TEAM_ROLE_HOME: Partial<Record<Role, string>> = {
  delivery_team_a: "/delivery/routes/team-a",
  delivery_team_b: "/delivery/routes/team-b",
  delivery_team_c: "/delivery/routes/team-c",
  delivery_team_d: "/delivery/routes/team-d",
};

// Allowed top-level route prefixes per role. developer/administrator = everything ("*").
// Everyone (except the kiosk role) may hit /dashboard. /users is admin/dev only.
const ACCESS: Record<Role, string[]> = {
  developer: ["*"],
  administrator: ["*"],
  // Operations Manager: Operations + Workshop (full) + Warehouse visibility.
  // No HR, no Products/Procurement, no full Sales — focused on the ops floor.
  operations_manager: [
    "/dashboard", "/locations", "/inventory", "/incoming", "/stock-movements", "/scan",
    "/delivery", "/installation", "/quality-control", "/returns", "/operations", "/workshop",
    "/purchase-orders", "/suppliers", "/costing", "/products", "/addons", "/hr/wfh", "/settings",
  ],
  human_resources: [
    "/dashboard", "/employees", "/hr", "/attendance", "/reports", "/soon", "/settings",
  ],
  // Products / Add-ons / Costing / Suppliers / Purchase Orders are Operations-Manager
  // ONLY — removed here so warehouse & sales can't reach those routes.
  // Tinanggal 2026-08-10 (hiling ni Joe): barcode, delivery, installation —
  // hindi trabaho ng warehouse; sa Operations Manager ang mga iyon. Ang
  // natitira ay purong bodega: lokasyon, inventory, incoming, ledger, scan,
  // QC, at returns.
  warehouse_staff: [
    "/dashboard", "/locations", "/inventory", "/incoming",
    "/stock-movements", "/scan", "/quality-control", "/returns", "/hr/wfh", "/soon", "/settings",
  ],
  sales_staff: [
    "/dashboard", "/orders", "/initial-sales", "/mattress-orders", "/warranty", "/returns", "/customers", "/hr/wfh", "/soon", "/settings",
    // View ng Sales sa delivery pipeline: Delivery Queue (read-only ang mga
    // aksyon — ops keys ang edit guard) + Order Mapping Tracker (view only).
    "/operations/delivery-schedule",
  ],
  // Tablet kiosk account: the Face Attendance Kiosk only. No dashboard/sidebar.
  attendance_kiosk: ["/attendance/kiosk"],
  // Delivery-team tablets: SARILING team pages + attendance self-clock. Kasama
  // ang "/delivery" at "/installation" para PUMASA ang mga action guard
  // (Start Delivery / packing / install save) — ang mga page entry ng mga ito
  // sa sidebar ay nakatago pa rin sa tablet roles (isTabletRole filter).
  delivery_team_a: ["/delivery/routes/team-a", "/pickup-task/team-a", "/pickup/team-a", "/pickup/refund/team-a", "/installation/team-a", "/returns/team-a", "/hr/wfh", "/delivery", "/installation"],
  delivery_team_b: ["/delivery/routes/team-b", "/pickup-task/team-b", "/pickup/team-b", "/pickup/refund/team-b", "/installation/team-b", "/returns/team-b", "/hr/wfh", "/delivery", "/installation"],
  delivery_team_c: ["/delivery/routes/team-c", "/pickup-task/team-c", "/pickup/team-c", "/pickup/refund/team-c", "/installation/team-c", "/returns/team-c", "/hr/wfh", "/delivery", "/installation"],
  delivery_team_d: ["/delivery/routes/team-d", "/pickup-task/team-d", "/pickup/team-d", "/pickup/refund/team-d", "/installation/team-d", "/returns/team-d", "/hr/wfh", "/delivery", "/installation"],
  // Workshop tablets: ang Workshop pages + attendance self-clock.
  workshop_gma_original: ["/workshop", "/hr/wfh"],
  workshop_gma_white: ["/workshop", "/hr/wfh"],
  workshop_lrt: ["/workshop", "/hr/wfh"],
};

// Tablet roles (team/workshop) — laging may Attendance self-clock sa sidebar,
// anuman ang work_setup label ng account.
export const isTabletRole = (role: Role | null | undefined): boolean =>
  !!role && (role.startsWith("delivery_team_") || role.startsWith("workshop_"));

// Does this role have access to a path?
export function canAccess(role: Role, path: string): boolean {
  const allowed = ACCESS[role] ?? [];
  if (allowed.includes("*")) return true;
  return allowed.some((p) => path === p || path.startsWith(p + "/"));
}

// Full-access roles. Developer is treated identically to administrator
// (full access including /users + /audit-trail) — the label just marks who's a dev.
export const isAdmin = (role: Role | null | undefined): boolean =>
  role === "administrator" || role === "developer";

// Landing page after login / when a user hits a route they can't reach.
// The kiosk account has no dashboard — it lands straight on the Face Kiosk.
export function homePath(role: Role | null | undefined): string {
  if (role === "attendance_kiosk") return "/attendance/kiosk";
  if (role && WORKSHOP_ROLE_NAME[role]) return "/workshop/jobs";
  const teamHome = role ? TEAM_ROLE_HOME[role] : undefined;
  return teamHome ?? "/dashboard";
}
