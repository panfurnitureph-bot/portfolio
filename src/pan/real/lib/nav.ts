// SIDEBAR NAV DEFINITION (2026-09-05) — plain data, walang "use client", para
// mabasa ng server code: ang Permissions grid ay ganito ang layout, at ang
// DEFAULT na permissions ng bawat Login Role ay ang mismong sidebar group ng
// role na iyon (lib/auth/permissions.ts: ROLE_NAV_GROUPS). Ang sidebar.tsx ang
// nagre-render; dito lang ang listahan.

export type IconKey =
  | "dashboard" | "box" | "barcode" | "cart" | "inbox" | "check" | "pin"
  | "layers" | "swap" | "receipt" | "truck" | "wrench" | "rotate" | "chart" | "shield" | "users" | "gear" | "edit";

export type Item = { href: string; label: string; icon: IconKey };
export type Group = { title?: string; items: Item[] };

// Sidebar groups (live routes + planned modules → "Coming Soon"). Order preserved.
// EXPORTED (2026-09-05): ang Permissions grid ay sumusunod sa mismong layout na
// ito (parehong groups, pangalan, icon, pagkakasunod).
export const GROUPS: Group[] = [
  { items: [{ href: "/dashboard", label: "Dashboard", icon: "dashboard" }] },
  {
    title: "Warehouse",
    items: [
      // NAKATAGO muna (hindi pa ginagamit): ibalik kapag kailangan na.
      // { href: "/barcode", label: "Barcode Management", icon: "barcode" },
      { href: "/locations", label: "Warehouse Location Management", icon: "pin" },
      { href: "/inventory", label: "Inventory Management", icon: "layers" },
      { href: "/incoming", label: "Incoming Shipment", icon: "truck" },
      { href: "/stock-movements", label: "Stock Movement Ledger", icon: "swap" },
      { href: "/quality-control", label: "Quality Control", icon: "check" },
      { href: "/returns", label: "Returns / RMA", icon: "rotate" },
    ],
  },
  // Isang GROUP bawat delivery team (isang tablet bawat team) — ang bawat group
  // ay dadagdagan pa ng sariling per-team pages (route na ngayon; susunod pa).
  {
    title: "Delivery Team",
    items: [
      // Sa pagkakasunod ng araw: kunin muna sa bodega, tapos ang mga pagkumpuni
      // (on-site sa bahay, pull-out na susunduin), saka ang paghahatid. Ang
      // Delivery Route ay walang inilalabas hangga't hindi nakukuha ang lahat
      // ng item nito.
      { href: "/pickup-task/team-a", label: "Pickup Task", icon: "truck" },
      { href: "/delivery/routes/team-a/onsite", label: "Rework (On-Site)", icon: "rotate" },
      { href: "/pickup/team-a", label: "Rework (Pull Out)", icon: "rotate" },
      { href: "/pickup/refund/team-a", label: "Refund (Pull Out)", icon: "rotate" },
      { href: "/delivery/routes/team-a", label: "Delivery Route", icon: "truck" },
      { href: "/installation/team-a", label: "Installation Tracking", icon: "wrench" },
      { href: "/returns/team-a", label: "Returns / RMA", icon: "rotate" },
    ],
  },
  {
    title: "Sales & Service",
    items: [
      { href: "/orders", label: "Sales Orders", icon: "receipt" },
      // Parehong page ng Sales Orders (iisang listahan) — pero ang create at
      // manual collect dito ay HINDI nagpapadala ng email (pag-encode ng mga
      // lumang order na cash ang bayad).
      { href: "/initial-sales", label: "Initial Sales", icon: "receipt" },
      { href: "/operations/delivery-schedule", label: "Delivery Schedule", icon: "swap" },
      { href: "/mattress-orders", label: "Mattress Orders", icon: "layers" },
      { href: "/warranty", label: "Warranty Documents", icon: "rotate" },
      { href: "/mto-requests", label: "MTO Requests", icon: "inbox" },
      { href: "/quotations", label: "Formal Quotation", icon: "receipt" },
      { href: "/design-details", label: "Design Details", icon: "edit" },
      { href: "/returns", label: "Returns / RMA", icon: "rotate" },
      { href: "/customers", label: "Customer List", icon: "users" },
    ],
  },
  {
    title: "Operations Manager",
    items: [
      { href: "/operations/approval", label: "Order Approval", icon: "check" },
      { href: "/operations/stock-build", label: "Stock Build", icon: "layers" },
      { href: "/operations/edit-requests", label: "Requested Edit Order", icon: "edit" },
      { href: "/operations/delivery-queue", label: "Delivery Queue", icon: "inbox" },
      { href: "/operations/route-planner", label: "Route Planner", icon: "truck" },
      // NAKATAGO muna sa Operations Manager (hiling 2026-08-29) — ang link lang
      // ang inalis; buhay pa ang pahina at hindi nagbago ang pahintulot, kaya
      // naaabot pa rin sila sa URL. Ibalik kapag kailangan na.
      // { href: "/delivery", label: "Delivery Tracker", icon: "truck" },
      // { href: "/installation", label: "Installation Tracking", icon: "wrench" },
      { href: "/operations/returns", label: "Return / Defect Approval", icon: "rotate" },
      // { href: "/operations/tracker", label: "Order Tracker", icon: "swap" },
      { href: "/rework", label: "Rework Tracker", icon: "rotate" },
      { href: "/operations/materials", label: "Materials", icon: "box" },
      { href: "/operations/requests", label: "Stock Requests", icon: "cart" },
      { href: "/purchase-orders", label: "Purchase Orders", icon: "cart" },
      { href: "/suppliers", label: "Suppliers", icon: "users" },
      { href: "/costing", label: "Product Costing", icon: "chart" },
      { href: "/products", label: "Product Management", icon: "box" },
      // NAKATAGO muna (hindi pa ginagamit): ibalik kapag kailangan na.
      // { href: "/addons", label: "Add-ons Catalog", icon: "layers" },
    ],
  },
  // TATLONG workshop group (tulad ng Delivery Team A–D): bawat isa ay parehong
  // pages pero naka-target sa sariling workshop via ?ws=<slug> (loadWorkshop
  // resolves the slug by name). Ang workshop TABLET account ay sarili lang ang
  // makikita; Admin/Ops nakikita lahat (visibility rule sa baba).
  ...([
    { title: "Production Area", ws: "Production Area" },
  ] as const).map(({ title, ws: wsName }) => {
    const slug = wsName.toLowerCase().replace(/[^a-z0-9]+/g, "-");
    return {
      title,
      items: [
        { href: `/workshop/jobs?ws=${slug}`, label: "My Jobs", icon: "wrench" as IconKey },
        { href: `/workshop/rework?ws=${slug}`, label: "Rework Jobs", icon: "rotate" as IconKey },
        { href: `/workshop/inventory?ws=${slug}`, label: "My Inventory", icon: "layers" as IconKey },
        { href: `/workshop/logs?ws=${slug}`, label: "Stock Logs", icon: "rotate" as IconKey },
        { href: `/workshop/quality-control?ws=${slug}`, label: "Quality Control", icon: "check" as IconKey },
        { href: `/workshop/requests?ws=${slug}`, label: "My Requests", icon: "cart" as IconKey },
      ],
    };
  }),
  {
    title: "HR Management",
    items: [
      { href: "/hr/directory", label: "Employee Directory", icon: "users" },
      { href: "/hr/attendance", label: "Attendance", icon: "rotate" },
      { href: "/hr/wfh", label: "Attendance (WFH)", icon: "rotate" },
      { href: "/hr/wfh#activity", label: "WFH Activity Monitor", icon: "chart" },
      { href: "/hr/overtime", label: "Overtime Approval", icon: "check" },
      { href: "/hr/leaves", label: "Day Off Management", icon: "check" },
      { href: "/hr/projects", label: "Constructor", icon: "wrench" },
      { href: "/hr/advances", label: "Advance Payments", icon: "cart" },
      { href: "/hr/payroll", label: "Payroll", icon: "receipt" },
      { href: "/hr/reports", label: "HR Reports", icon: "chart" },
      { href: "/hr/overall", label: "PAN Overall", icon: "chart" },
      // Payment Approval — manual installation collections (Cash/BDO/BPI/GCash)
      // na naghihintay ng approve bago pumasok sa ledger / PAN Overall.
      { href: "/payment-approval", label: "Payment Approval", icon: "check" },
    ],
  },
  {
    title: "Website",
    items: [
      // Itinago sa sidebar (2026-09-03, hiling ni Joe) — buhay pa rin ang page
      // sa /website/products, diretsong URL na lang ang daan.
      // { href: "/website/products", label: "Products", icon: "box" },
      { href: "/website/configurator", label: "Product Configuration", icon: "gear" },
      // WEBSITE CONTENT (2026-09-04): iisang tab para sa Hero, Homepage, Promo & Site,
      // Reviews & FAQs, Videos & UGC. Buhay pa rin ang mga lumang route sa URL.
      { href: "/website/content", label: "Website Content", icon: "layers" },
      // FABRIC UPHOLSTERED (2026-09-04): sariling page ng fabric library — ikaw ang
      // nag-a-upload ng litrato kada tela.
      { href: "/website/fabrics", label: "Fabric Upholstered", icon: "swap" },
      { href: "/website/shipping", label: "Shipping Rates", icon: "truck" },
      { href: "/website/facebook-agent", label: "FB AI Agent", icon: "inbox" },
    ],
  },
  // Integrations (Messenger / Ads Analytics — Meta): NAKATAGO muna habang wala
  // pang laman ang mga module. Ibalik ang group na ito kapag buhay na sila.
  // {
  //   title: "Integrations",
  //   items: [
  //     { href: "/soon/messenger", label: "Messenger (Meta)", icon: "users" },
  //     { href: "/soon/ads-analytics", label: "Ads Analytics (Meta)", icon: "chart" },
  //   ],
  // },
  {
    title: "System",
    items: [
      { href: "/reports", label: "Performance Rankings", icon: "chart" },
      { href: "/audit-trail", label: "Activity Logs", icon: "shield" },
      // Itinago sa sidebar (2026-09-03) — ang araw-araw na pamamahala ng login
      // ay nasa Employee Directory na; ang /users ay abot pa rin sa URL bilang
      // admin-only na buong listahan ng accounts (kasama ang shared logins).
      // { href: "/users", label: "Login Accounts", icon: "users" },
      { href: "/settings", label: "Settings", icon: "gear" },
      // DIAGNOSTIC NG LIVE SYNC (2026-08-30). Ang APK ay walang address bar,
      // kaya ang /debug/live ay hindi mabubuksan doon nang walang link — at
      // ang "bakit hindi nag-a-update ang APK" ay hindi masasagot nang hindi
      // nakikita ang mga kawing mula mismo sa device na iyon.
      // Itinago sa sidebar (2026-09-03) — pang-debug lang; /debug/live pa rin
      // ang daan kapag kailangan (lalo sa APK na walang address bar, pero
      // bihira na itong gamitin mula nang maayos ang realtime).
      // { href: "/debug/live", label: "Live Sync Check", icon: "shield" },
    ],
  },
];
