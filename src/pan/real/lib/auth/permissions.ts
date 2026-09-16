// Per-module permission model. The DB holds a (module, action) catalogue,
// a role matrix, and per-user grant/deny overrides. This file is the shared
// client/server map + the effective-access helpers.

import { canAccess, homePath, isAdmin, type Role } from "./rbac";
import { GROUPS as NAV_GROUPS } from "@/lib/nav";

export type PermAction = "view" | "edit";

export type ModuleDef = { key: string; label: string; route: string; group: string };

// Gated modules -> their route. Order/grouping mirrors the sidebar.
// NOTE: `/inventory/adjustments` is its own module and MUST come before
// `/inventory` so moduleByRoute() matches the more specific route first.
export const MODULES: ModuleDef[] = [
  { key: "products", label: "Product Management", route: "/products", group: "Products" },
  { key: "barcode", label: "Barcode Management", route: "/barcode", group: "Products" },
  { key: "addons", label: "Add-ons Catalog", route: "/addons", group: "Products" },
  { key: "suppliers", label: "Suppliers", route: "/suppliers", group: "Procurement" },
  { key: "costing", label: "Product Costing", route: "/costing", group: "Procurement" },
  { key: "purchase_orders", label: "Purchase Orders", route: "/purchase-orders", group: "Procurement" },
  { key: "locations", label: "Warehouse Locations", route: "/locations", group: "Warehouse" },
  { key: "adjustments", label: "Stock Adjustments", route: "/inventory/adjustments", group: "Warehouse" },
  { key: "inventory", label: "Inventory", route: "/inventory", group: "Warehouse" },
  { key: "incoming", label: "Incoming Shipment", route: "/incoming", group: "Warehouse" },
  { key: "stock_movements", label: "Stock Movements", route: "/stock-movements", group: "Warehouse" },
  { key: "scan", label: "Scan Station", route: "/scan", group: "Warehouse" },
  { key: "delivery", label: "Delivery Tracker", route: "/delivery", group: "Warehouse" },
  { key: "pickup_task", label: "Pickup Task", route: "/pickup-task", group: "Warehouse" },
  { key: "pickup", label: "Rework (Pull Out)", route: "/pickup", group: "Warehouse" },
  { key: "rework", label: "Rework Tracker", route: "/rework", group: "Operations Manager" },
  { key: "installation", label: "Installation", route: "/installation", group: "Warehouse" },
  { key: "wh_qc", label: "Quality Control", route: "/quality-control", group: "Warehouse" },
  { key: "returns", label: "Returns / RMA", route: "/returns", group: "Warehouse" },
  { key: "orders", label: "Sales Orders", route: "/orders", group: "Sales & Service" },
  // Mga page ng sidebar na walang module dati (2026-09-05) — kailangan para
  // ma-grant/ma-deny sa grid at masakop ng role defaults.
  { key: "initial_sales", label: "Initial Sales", route: "/initial-sales", group: "Sales & Service" },
  { key: "mto_requests", label: "MTO Requests", route: "/mto-requests", group: "Sales & Service" },
  { key: "ops_stock_build", label: "Stock Build", route: "/operations/stock-build", group: "Operations Manager" },
  { key: "ops_route_planner", label: "Route Planner", route: "/operations/route-planner", group: "Operations Manager" },
  { key: "mattress_orders", label: "Mattress Orders", route: "/mattress-orders", group: "Sales & Service" },
  { key: "warranty", label: "Warranty", route: "/warranty", group: "Sales & Service" },
  { key: "quotations", label: "Formal Quotation Builder", route: "/quotations", group: "Sales & Service" },
  { key: "design_details", label: "Design Details Builder", route: "/design-details", group: "Sales & Service" },
  { key: "customers", label: "Customer List", route: "/customers", group: "Sales & Service" },
  // Operations Manager — per page
  { key: "ops_approval", label: "Order Approval", route: "/operations/approval", group: "Operations Manager" },
  { key: "ops_edit_requests", label: "Requested Edit Order", route: "/operations/edit-requests", group: "Operations Manager" },
  { key: "ops_delivery_queue", label: "Delivery Queue", route: "/operations/delivery-queue", group: "Operations Manager" },
  { key: "delivery_schedule", label: "Delivery Schedule", route: "/operations/delivery-schedule", group: "Sales & Service" },
  { key: "ops_returns", label: "Return / Defect Approval", route: "/operations/returns", group: "Operations Manager" },
  { key: "ops_tracker", label: "Order Tracker", route: "/operations/tracker", group: "Operations Manager" },
  { key: "ops_materials", label: "Materials", route: "/operations/materials", group: "Operations Manager" },
  { key: "ops_requests", label: "Stock Requests", route: "/operations/requests", group: "Operations Manager" },
  // Workshop — per page
  { key: "ws_jobs", label: "My Jobs", route: "/workshop/jobs", group: "Workshop" },
  { key: "ws_inventory", label: "My Inventory", route: "/workshop/inventory", group: "Workshop" },
  { key: "ws_logs", label: "Stock Logs", route: "/workshop/logs", group: "Workshop" },
  { key: "ws_qc", label: "Quality Control", route: "/workshop/quality-control", group: "Workshop" },
  { key: "ws_requests", label: "My Requests", route: "/workshop/requests", group: "Workshop" },
  // HR Management — per page
  { key: "hr_directory", label: "Employee Directory", route: "/hr/directory", group: "HR Management" },
  { key: "hr_attendance", label: "Attendance", route: "/hr/attendance", group: "HR Management" },
  { key: "hr_kiosk", label: "Face Attendance Kiosk", route: "/attendance/kiosk", group: "HR Management" },
  { key: "hr_overtime", label: "Overtime Approval", route: "/hr/overtime", group: "HR Management" },
  { key: "hr_leaves", label: "Day Off Management", route: "/hr/leaves", group: "HR Management" },
  { key: "hr_constructor", label: "Constructor", route: "/hr/projects", group: "HR Management" },
  { key: "hr_advances", label: "Advance Payments", route: "/hr/advances", group: "HR Management" },
  { key: "hr_payroll", label: "Payroll", route: "/hr/payroll", group: "HR Management" },
  { key: "hr_reports", label: "HR Reports", route: "/hr/reports", group: "HR Management" },
  { key: "hr_overall", label: "PAN Overall", route: "/hr/overall", group: "HR Management" },
  // Payment Approval — katabi ng PAN Overall; admin lang (may isAdmin guard din ang page).
  { key: "payment_approval", label: "Payment Approval", route: "/payment-approval", group: "HR Management" },
  // Website — the storefront's own admin, moved in from the separate site
  // PRODUCT CONFIGURATION (2026-09-07): ang sidebar tab ay /website/configurator
  // (Products page ay nakatago mula 2026-09-03); iisang module ang dalawa —
  // ang configurator ang nagsusulat sa web_products. Dati walang module ang
  // configurator kaya lumulusot sa lumang role list.
  { key: "web_products", label: "Product Configuration", route: "/website/configurator", group: "Website" },
  { key: "web_promo", label: "Promo & Site", route: "/website/promo", group: "Website" },
  { key: "web_shipping", label: "Shipping Rates", route: "/website/shipping", group: "Website" },
  { key: "web_hero", label: "Website Content", route: "/website/content", group: "Website" },
  // HOMEPAGE (2026-09-04): parehong key (web_banners) para manatili ang mga
  // ibinigay nang grant; ang route ay ang bagong Homepage tab.
  { key: "web_banners", label: "Homepage", route: "/website/homepage", group: "Website" },
  { key: "web_reviews", label: "Reviews & FAQs", route: "/website/reviews", group: "Website" },
  { key: "web_videos", label: "Videos & UGC", route: "/website/videos", group: "Website" },
  { key: "web_fb_agent", label: "FB AI Agent", route: "/website/facebook-agent", group: "Website" },
  // FABRIC UPHOLSTERED (2026-09-04): fabric library ng website (litrato kada tela).
  { key: "web_fabrics", label: "Fabric Upholstered", route: "/website/fabrics", group: "Website" },
  { key: "audit", label: "Activity Logs", route: "/audit-trail", group: "System" },
  { key: "reports", label: "Performance Rankings", route: "/reports", group: "System" },
  { key: "settings", label: "Settings", route: "/settings", group: "System" },
  // DELIVERY TEAMS BILANG MODULE (Joe 2026-09-05, "dito na lang bibigyan ng
  // roles"): isang module kada team; sakop ang LAHAT ng page ng team (Pickup
  // Task, Rework On-Site/Pull Out, Refund, Delivery Route, Installation,
  // Returns) — tingnan ang moduleByRoute. Grant sa grid = kita ang team.
  { key: "team_a", label: "Delivery Team", route: "/delivery/routes/team-a", group: "Delivery Teams" },
  { key: "users", label: "User Management", route: "/users", group: "System" },
];

// /hr/wfh is intentionally NOT gated by the `hr` module: it's the self-clock page
// every staff role reaches (the `hr` module is manager-only). Route-gate it instead.
const UNGATED_PREFIXES = ["/hr/wfh"];

// Anumang path na may /team-a … /team-d (kahit sub-page) ay sa team module.
export const teamOfPath = (path: string): string | null => /\/team-([a-d])(?:\/|$)/.exec(path)?.[1] ?? null;

export function moduleByRoute(path: string): ModuleDef | undefined {
  if (UNGATED_PREFIXES.some((p) => path === p || path.startsWith(p + "/"))) return undefined;
  const t = teamOfPath(path);
  if (t) return MODULES.find((m) => m.key === `team_${t}`);
  // Ang Rework Jobs ng workshop ay bahagi ng My Jobs (2026-09-07): walang
  // sariling module, kaya bumabagsak dati sa lumang role list (canAccess) at
  // lumulusot ang buong Workshop group sa Ops kahit walang ws_* sa grid.
  if (path === "/workshop/rework" || path.startsWith("/workshop/rework/")) return MODULES.find((m) => m.key === "ws_jobs");
  if (path === "/website/products" || path.startsWith("/website/products/")) return MODULES.find((m) => m.key === "web_products");
  return MODULES.find((m) => path === m.route || path.startsWith(m.route + "/"));
}

// Team module: tahasang grant sa grid, O sariling team ng tablet role. Walang
// canAccess fallback — iyon ang nagpapalusot noon sa ibang team dahil sa
// "/delivery" prefix. ANG GRID ANG GATE (Joe 2026-09-07, "dapat kung ano lang
// ang set ko sa permission"): wala nang Operations Manager fallback — ang apat
// na team ay nasa role default ng Ops, kaya ang pag-untick (deny) ay tunay na
// nagtatago; dati ay nakikita pa rin ni Ashley ang Team A–D kahit naka-deny.
export function canViewTeam(user: PermUser, letter: string, action: PermAction = "view"): boolean {
  if (isAdmin(user.role)) return true;
  if (user.permissions.includes(key(`team_${letter}`, action))) return true;
  return user.role === `delivery_team_${letter}`;
}

// Minimal shape the helpers need from a session.
type PermUser = { role: Role; permissions: string[] };

const key = (module: string, action: PermAction) => `${module}:${action}`;

export function hasPermission(user: PermUser, module: string, action: PermAction): boolean {
  if (isAdmin(user.role)) return true;
  if (/^team_[a-d]$/.test(module)) return canViewTeam(user, module.slice(5), action);
  return user.permissions.includes(key(module, action));
}

// View gate for a path. Falls back to the role route-gate for non-module routes
// (dashboard, /users, /settings, /soon) and when the catalogue isn't seeded yet.
export function canViewPath(user: PermUser, path: string): boolean {
  if (isAdmin(user.role)) return true;
  const mod = moduleByRoute(path);
  if (mod && /^team_[a-d]$/.test(mod.key)) return canViewTeam(user, mod.key.slice(5));
  if (mod && user.permissions.length > 0) {
    return user.permissions.includes(key(mod.key, "view"));
  }
  return canAccess(user.role, path);
}

// Saan dapat mag-land ang user pagka-login (o kapag na-redirect palabas ng
// pahinang bawal). Admin/dev → /dashboard (buong overview). Iba → ang UNANG
// modulong nakikita nila; kung wala, /hr/wfh (self-clock) o /soon bilang huling
// fallback. Hindi ito nagbabalik ng /dashboard o /customers para sa non-admin —
// admin-only na ang mga iyon (nasa PAN Overall tab).
export function homeFor(user: PermUser): string {
  if (isAdmin(user.role)) return "/dashboard";
  // Team/workshop-tablet roles: diretso sa sariling home page.
  if (user.role.startsWith("delivery_team_") || user.role.startsWith("workshop_")) return homePath(user.role);
  // UNANG PAGE NG SARILING SIDEBAR GROUP (2026-09-05): Sales → Sales Orders,
  // Warehouse → Warehouse Location Management, HR → Employee Directory — hindi
  // ang unang module sa MODULES (Returns ang natatamaan dati ng Sales).
  for (const g of ROLE_NAV_GROUPS[user.role] ?? []) {
    for (const it of NAV_GROUPS.find((x) => x.title === g)?.items ?? []) {
      const path = it.href.split(/[#?]/)[0];
      if (path !== "/hr/wfh" && canViewPath(user, path)) return path;
    }
  }
  const first = MODULES.find(
    (m) => m.route !== "/dashboard" && m.route !== "/customers" && m.route !== "/hr/overall" && canViewPath(user, m.route),
  );
  if (first) return first.route;
  if (canViewPath(user, "/hr/wfh")) return "/hr/wfh";
  return "/soon/welcome";
}

// ── Role presets (templates) ─────────────────────────────────────────
// The default module set each role gets view+edit on. MUST mirror the DB role
// matrix seeded in migrations 0007 + 0087 — single source of truth for the
// "Apply template" buttons in the Users & Permissions dialog. Each role grants
// view+edit on every module listed (the seed gives both). Admin = all modules.
const HR_MODULES = [
  "hr_directory", "hr_attendance", "hr_kiosk", "hr_overtime", "hr_leaves",
  "hr_constructor", "hr_advances", "hr_payroll", "hr_reports",
  // hr_overall (PAN Overall) tinanggal dito — ADMIN LANG. Pinagsama nito ang
  // buong-negosyo na PAN Overall + Dashboard + Customer List sa isang tab, kaya
  // hindi para sa HR. Ang server page ay may isAdmin() guard din.
];

// PAGE → MODULES (2026-09-05): ang ilang page ay may ILANG module sa likod
// (Website Content = hero + homepage + reviews + videos + promo). Ginagamit ng
// Permissions grid at ng role defaults.
export const PAGE_MODULES: Record<string, string[]> = {
  "/website/content": ["web_hero", "web_banners", "web_reviews", "web_videos", "web_promo"],
  "/website/configurator": ["web_products"],
};
export function modulesForPath(path: string): string[] {
  const clean = path.split(/[#?]/)[0];
  if (PAGE_MODULES[clean]) return PAGE_MODULES[clean];
  const m = moduleByRoute(clean);
  return m ? [m.key] : [];
}
// Lahat ng module key ng isang sidebar group (ayon sa title).
export function modulesOfNavGroup(title: string): string[] {
  const g = NAV_GROUPS.find((x) => x.title === title);
  if (!g) return [];
  return [...new Set(g.items.flatMap((it) => modulesForPath(it.href)))];
}

// ADMIN LANG (Joe 2026-09-05, "ung website and system sa admin lang lalabas"):
// Website group, System group, PAN Overall, Payment Approval — hindi kasama sa
// role default ng KAHIT SINONG non-admin (kahit naka-seed pa sa DB); per-user
// grant lang ang daan kung kailangan talaga.
export const ADMIN_ONLY_MODULES = new Set([
  "hr_overall", "payment_approval", "users", "audit", "reports", "settings",
  "web_products", "web_promo", "web_shipping", "web_hero", "web_banners", "web_reviews", "web_videos", "web_fb_agent", "web_fabrics",
]);
export const isAdminOnlyModule = (key: string) => ADMIN_ONLY_MODULES.has(key);

// ROLE → SIDEBAR GROUPS (Joe 2026-09-05, "kung ano ung nasa tab ng role, un din
// automatic sa permission"): ang default na pahintulot ng bawat Login Role ay
// ang MISMONG sidebar group(s) ng role — hindi na hiwalay na listahan na
// nalalaos. Admin/dev = lahat (code-level).
const ROLE_NAV_GROUPS: Partial<Record<Role, string[]>> = {
  warehouse_staff: ["Warehouse"],
  sales_staff: ["Sales & Service"],
  operations_manager: ["Operations Manager", "Delivery Team"],
  human_resources: ["HR Management"],
  delivery_team_a: ["Delivery Team"],
  workshop_gma_white: ["Production Area"],
};
function templateOf(role: Role): string[] {
  if (isAdmin(role)) return MODULES.map((m) => m.key);
  if (role === "attendance_kiosk") return ["hr_kiosk"];
  const out = new Set<string>();
  for (const g of ROLE_NAV_GROUPS[role] ?? []) for (const k of modulesOfNavGroup(g)) if (!ADMIN_ONLY_MODULES.has(k)) out.add(k);
  return [...out];
}
const ALL_ROLES: Role[] = ["developer", "administrator", "operations_manager", "human_resources", "warehouse_staff", "sales_staff", "attendance_kiosk",
  "delivery_team_a", "delivery_team_b", "delivery_team_c", "delivery_team_d", "workshop_gma_original", "workshop_gma_white", "workshop_lrt"];
const ROLE_TEMPLATE_MODULES: Record<Role, string[]> = Object.fromEntries(ALL_ROLES.map((r) => [r, templateOf(r)])) as Record<Role, string[]>;
// "module:action" keys ng role default — ginagamit ng session hydrate para
// laging tugma sa sidebar ang epektibong pahintulot, kahit luma ang DB seed.
export function roleDefaultKeys(role: Role): string[] {
  return (ROLE_TEMPLATE_MODULES[role] ?? []).flatMap((m) => [`${m}:view`, `${m}:edit`]);
}

export type RoleTemplate = { module: string; view: boolean; edit: boolean };

// The full per-module view/edit grid a role's preset implies. Modules not in the
// role's set come back view:false/edit:false so the UI can paint the whole grid.
export function roleTemplate(role: Role): RoleTemplate[] {
  const granted = new Set(ROLE_TEMPLATE_MODULES[role] ?? []);
  return MODULES.map((m) => ({ module: m.key, view: granted.has(m.key), edit: granted.has(m.key) }));
}
