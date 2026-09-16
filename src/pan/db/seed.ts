/* Seed for the demo database. Rows follow the production schemas (supabase/migrations) and the
   TypeScript row types in lib/supabase/server.ts, so the copied loaders and actions work unchanged. */
import { db } from './store'
import { DEMO_ACCOUNTS } from '../demo-data'
import { MODULES } from '../real/lib/auth/permissions'

export const SEED_VERSION = '2026-09-12.pan4'

const rng = (seed: number) => { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296 } }
const dayIso = (n: number) => { const d = new Date(); d.setDate(d.getDate() - n); return d.toISOString().slice(0, 10) }
const daysAheadIso = (n: number) => { const d = new Date(); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10) }
const tsAgo = (n: number, h = 10, m = 0) => { const d = new Date(); d.setDate(d.getDate() - n); d.setHours(h, m, 0, 0); return d.toISOString() }
const pick = <T,>(r: () => number, a: readonly T[]) => a[Math.floor(r() * a.length)]

export const WORKSHOPS = [
  { id: 1, name: 'Production Area', active: true, lat: 13.9412, lng: 121.6201 },
]

export const PRODUCTS = [
  { id: 1, product_name: '3-Seater Sofa — Velvet Moss', sku: 'SF-VLV-3S', category: 'Sofa', color: 'Moss', dimension: '84 × 36 × 34 in', cost: 21500, price: 38500, oh: 4, res: 1, loc: 'L1-A1' as string | null, ws: 2, mto: false },
  { id: 2, product_name: 'Sala Set L-Shape — Grey Linen', sku: 'SF-LSH-GL', category: 'Sofa', color: 'Grey', dimension: '110 × 72 × 34 in', cost: 29800, price: 52900, oh: 1, res: 0, loc: 'L1-A2' as string | null, ws: 2, mto: true },
  { id: 3, product_name: 'Queen Bed Frame — Narra', sku: 'BD-QN-NAR', category: 'Bed Frame', color: 'Natural', dimension: '60 × 75 in', cost: 16400, price: 29800, oh: 3, res: 1, loc: 'L2-A1' as string | null, ws: 1, mto: false },
  { id: 4, product_name: 'Bunk Bed — Pine', sku: 'BD-BNK-PN', category: 'Bed Frame', color: 'Natural', dimension: '36 × 75 in', cost: 10200, price: 18900, oh: 5, res: 0, loc: 'L2-B1' as string | null, ws: 1, mto: false },
  { id: 5, product_name: 'Dining Set 6-Seater — Acacia', sku: 'DN-6S-ACA', category: 'Dining', color: 'Walnut', dimension: '72 × 36 × 30 in', cost: 25900, price: 46500, oh: 1, res: 1, loc: 'L4-A1' as string | null, ws: 3, mto: true },
  { id: 6, product_name: 'Wardrobe 3-Door — White Duco', sku: 'WD-3D-WHT', category: 'Cabinet', color: 'White', dimension: '60 × 22 × 80 in', cost: 15100, price: 27400, oh: 2, res: 0, loc: 'L4-A2' as string | null, ws: 3, mto: false },
  { id: 7, product_name: 'Kitchen Cabinet Run 3.2m', sku: 'KC-RUN-32', category: 'Cabinet', color: 'White', dimension: '3.2 m × 0.6 m', cost: 39400, price: 68000, oh: 0, res: 0, loc: null as string | null, ws: 1, mto: true },
  { id: 8, product_name: 'Office Table — Walnut', sku: 'OF-TBL-WAL', category: 'Table', color: 'Walnut', dimension: '48 × 24 × 30 in', cost: 8300, price: 15900, oh: 6, res: 2, loc: 'L5-A1' as string | null, ws: 3, mto: false },
  { id: 9, product_name: 'Mattress 60×75 — 8in Foam', sku: 'MT-6075-8', category: 'Mattress', color: null, dimension: '60 × 75 × 8 in', cost: 4600, price: 8900, oh: 12, res: 3, loc: 'L6-A1' as string | null, ws: 2, mto: false },
  { id: 10, product_name: 'Accent Chair — Rattan', sku: 'CH-ACC-RTN', category: 'Chair', color: 'Natural', dimension: '28 × 30 × 32 in', cost: 3900, price: 7600, oh: 8, res: 0, loc: 'L1-A3' as string | null, ws: 1, mto: false },
  { id: 11, product_name: 'Center Table — Marble Top', sku: 'TB-CTR-MRB', category: 'Table', color: 'White', dimension: '48 × 24 × 18 in', cost: 6800, price: 12400, oh: 3, res: 0, loc: 'L5-B1' as string | null, ws: 3, mto: false },
  { id: 12, product_name: 'TV Console 1.8m', sku: 'TV-CON-18', category: 'Cabinet', color: 'Walnut', dimension: '1.8 m × 0.4 m × 0.5 m', cost: 7700, price: 14200, oh: 4, res: 1, loc: 'L4-B1' as string | null, ws: 1, mto: false },
  { id: 13, product_name: 'Bookshelf 5-Tier — Oak', sku: 'SH-5T-OAK', category: 'Cabinet', color: 'Oak', dimension: '32 × 12 × 72 in', cost: 6100, price: 11800, oh: 5, res: 0, loc: 'L7-A1' as string | null, ws: 3, mto: false },
  { id: 14, product_name: 'Study Desk + Hutch', sku: 'OF-DSK-HT', category: 'Table', color: 'White', dimension: '48 × 24 × 60 in', cost: 9200, price: 17500, oh: 2, res: 0, loc: null as string | null, ws: 1, mto: false },
  { id: 15, product_name: 'Bar Stools (set of 4)', sku: 'CH-BAR-4', category: 'Chair', color: 'Black', dimension: '16 × 16 × 30 in', cost: 5000, price: 9800, oh: 6, res: 0, loc: null as string | null, ws: 1, mto: false },
] as const

const CUSTOMERS = [
  ['Maria Santos', '0917 555 0118', 'Brgy. Ibabang Dupay, Lucena City', 'maria.santos@gmail.com'], ['Robert Tecson', '0918 555 0117', 'Tayabas City, Quezon', null], ['Jenny dela Cruz', '0919 555 0116', 'Lucban, Quezon', 'jenny.dc@yahoo.com'],
  ['Carlo Mendoza', '0920 555 0115', 'Sariaya, Quezon', null], ['Liza Garcia', '0921 555 0114', 'Pagbilao, Quezon', 'liza.garcia@gmail.com'], ['Paolo Bautista', '0922 555 0113', 'Candelaria, Quezon', null],
  ['Teresa Ramos', '0923 555 0112', 'Brgy. Gulang-Gulang, Lucena City', null], ['Edwin Aquino', '0924 555 0111', 'Tiaong, Quezon', 'edwin.aquino@gmail.com'], ['Nina Castillo', '0925 555 0110', 'Lucena City', null],
  ['Grace Villanueva', '0926 555 0109', 'Brgy. Cotta, Lucena City', 'grace.v@gmail.com'], ['Mark Domingo', '0927 555 0108', 'San Pablo City, Laguna', null], ['Rica Salazar', '0928 555 0107', 'Atimonan, Quezon', null],
  ['Ferdinand Ocampo', '0929 555 0106', 'Gumaca, Quezon', null], ['Hazel Pascual', '0930 555 0105', 'Lucena City', 'hazel.p@gmail.com'], ['Ivan Mercado', '0931 555 0104', 'Tayabas City, Quezon', null],
  ['Joy Navarro', '0932 555 0103', 'Brgy. Mayao, Lucena City', null], ['Kevin Torres', '0933 555 0102', 'Sariaya, Quezon', 'kevin.torres@gmail.com'], ['Lorna Flores', '0934 555 0101', 'Lucena City', null],
] as const

export const EMPLOYEES = [
  { id: 1, name: 'Rowena Purificacion', role: 'Operations Manager', position: 'Operations Manager', department: 'Operations', rate: 1200, rate_type: 'Daily', work_setup: 'Onsite', email: 'ops@panfurniture.ph' },
  { id: 2, name: 'Ana Noriega', role: 'Sales', position: 'Sales Associate', department: 'Sales', rate: 650, rate_type: 'Daily', work_setup: 'Onsite', email: 'sales@panfurniture.ph' },
  { id: 3, name: 'Marco Reyes', role: 'Sales', position: 'Sales Associate', department: 'Sales', rate: 650, rate_type: 'Daily', work_setup: 'Onsite', email: null },
  { id: 4, name: 'Bea Lim', role: 'Sales', position: 'Sales Associate', department: 'Sales', rate: 650, rate_type: 'Daily', work_setup: 'Onsite', email: null },
  { id: 5, name: 'Dennis Alcala', role: 'Warehouse', position: 'Warehouse Lead', department: 'Warehouse', rate: 700, rate_type: 'Daily', work_setup: 'Onsite', email: 'warehouse@panfurniture.ph' },
  { id: 6, name: 'Mang Boy Lacsamana', role: 'Constructor', position: 'Constructor', department: 'Production Area', rate: 0, rate_type: 'Project', work_setup: 'Onsite', email: null },
  { id: 7, name: 'Jomar Sabino', role: 'Constructor', position: 'Constructor', department: 'Production Area', rate: 0, rate_type: 'Project', work_setup: 'Onsite', email: null },
  { id: 8, name: 'Kuya Jun Dimaculangan', role: 'Constructor', position: 'Constructor', department: 'Production Area', rate: 0, rate_type: 'Project', work_setup: 'Onsite', email: null },
  { id: 9, name: 'Nilo Cabrera', role: 'Constructor', position: 'Constructor', department: 'Production Area', rate: 0, rate_type: 'Project', work_setup: 'Onsite', email: null },
  { id: 10, name: 'Mang Rey Villamor', role: 'Constructor', position: 'Constructor', department: 'Production Area', rate: 0, rate_type: 'Project', work_setup: 'Onsite', email: null },
  { id: 11, name: 'Aldrin Perez', role: 'Constructor', position: 'Constructor', department: 'Production Area', rate: 0, rate_type: 'Project', work_setup: 'Onsite', email: null },
  { id: 12, name: 'Boyet Manalo', role: 'Driver', position: 'Driver — Delivery Team', department: 'Delivery', rate: 650, rate_type: 'Daily', work_setup: 'Onsite', email: null },
  { id: 13, name: 'Jhun Ilagan', role: 'Driver', position: 'Driver — Delivery Team', department: 'Delivery', rate: 650, rate_type: 'Daily', work_setup: 'Onsite', email: null },
  { id: 14, name: 'Marlon Reyes', role: 'Driver', position: 'Driver — Delivery Team', department: 'Delivery', rate: 650, rate_type: 'Daily', work_setup: 'Onsite', email: null },
  { id: 15, name: 'Rey Santos', role: 'Driver', position: 'Driver — Delivery Team', department: 'Delivery', rate: 650, rate_type: 'Daily', work_setup: 'Onsite', email: null },
  { id: 16, name: 'Toto Abad', role: 'Installer', position: 'Installer', department: 'Delivery', rate: 600, rate_type: 'Daily', work_setup: 'Onsite', email: null },
  { id: 17, name: 'Erwin Dizon', role: 'Installer', position: 'Installer', department: 'Delivery', rate: 600, rate_type: 'Daily', work_setup: 'Onsite', email: null },
  { id: 18, name: 'Cathy Robles', role: 'QA', position: 'Quality Inspector', department: 'Warehouse', rate: 680, rate_type: 'Daily', work_setup: 'Onsite', email: null },
  { id: 19, name: 'Liza Mercado', role: 'Human Resources', position: 'HR Officer', department: 'Admin', rate: 900, rate_type: 'Daily', work_setup: 'Hybrid', email: 'hr@panfurniture.ph' },
  { id: 20, name: 'Kim Reyes', role: 'Coordinator', position: 'Delivery Coordinator', department: 'Operations', rate: 700, rate_type: 'Daily', work_setup: 'WFH', email: null },
  { id: 21, name: 'Joe Marie Casela', role: 'Developer', position: 'Systems', department: 'Admin', rate: 0, rate_type: 'Monthly', work_setup: 'Hybrid', email: 'admin@panfurniture.ph' },
]

const REPS = ['Ana Noriega', 'Marco Reyes', 'Bea Lim']
const SOURCES = ['Walk-in', 'Facebook', 'Website', 'Referral']
const TEAMS = [
  { id: 1, name: 'Delivery Team', driver: 'Boyet Manalo', vehicle: 'Closed Van · ABC 1234', capacity: 6, active: true, reserved: false },
]

export function seedAll(d: typeof db) {
  const r = rng(20260904)
  d.markCreatedAt('audit_log', 'customers', 'employees', 'hr_attendance', 'deliveries', 'mto_requests', 'returns', 'installations', 'warehouse_qc', 'qc_declarations', 'ops_line_skip', 'order_payments', 'stock_request', 'workshop_material', 'received_parts', 'fb_contacts', 'profiles', 'delivery_teams', 'workshop', 'hr_overtime', 'wfh_activity', 'order_line_deliveries')

  /* profiles (login accounts) */
  for (const a of DEMO_ACCOUNTS) {
    const emp = EMPLOYEES.find((e) => e.email && e.email === a.email)
    const shared = /^(delivery@|production@|team-|gma-|lrt-|kiosk|workshop)/.test(a.email)
    d.table('profiles').insert({ id: 'demo-' + a.role, full_name: a.name, email: a.email, role: a.role, status: 'active', avatar_url: null, work_setup: a.work_setup, employee_id: emp?.id ?? null, is_shared: shared })
  }
  /* permission catalogue (module × view/edit) — the Employee Directory grid and the sidebar gate read this */
  const perms = d.table('permissions'); let pid = 1
  const permKeys = [...MODULES.map((m) => [m.key, m.label] as const), ['team_a', 'Delivery Team'], ['web_fabrics', 'Fabric Upholstered']] as const
  for (const [key, label] of permKeys) for (const action of ['view', 'edit'] as const) perms.insert({ id: pid++, module: key, action, label: `${label} — ${action}` })
  d.table('role_permissions')
  const permId = (module: string, action: 'view' | 'edit') => perms.rows.find((r) => r.module === module && r.action === action)?.id
  const up = d.table('user_permissions')
  /* a few overrides so the grid shows ticks that differ from the role defaults */
  for (const [user, module, action, effect] of [
    ['demo-sales_staff', 'customers', 'edit', 'grant'], ['demo-sales_staff', 'delivery_schedule', 'view', 'grant'],
    ['demo-warehouse_staff', 'returns', 'edit', 'grant'], ['demo-warehouse_staff', 'incoming', 'edit', 'grant'],
    ['demo-human_resources', 'hr_payroll', 'edit', 'deny'],
  ] as const) { const id = permId(module, action); if (id) up.insert({ user_id: user, permission_id: id, effect }) }

  /* app settings */
  for (const [key, value] of Object.entries({ sales_targets: { revenue: 1_200_000, orders: 40, collection: 80, aov: 30_000 }, rush_days: 14, rush_threshold_days: 14, payment_qr: null, wfh_idle_after_min: 10, wfh_selfie_every_min: 30 })) d.table('app_settings').insert({ key, value, id: undefined })

  /* workshops, teams, employees */
  for (const w of WORKSHOPS) d.table('workshop').insert(w)
  for (const t of TEAMS) d.table('delivery_teams').insert(t)
  for (const e of EMPLOYEES) d.table('employees').insert({ ...e, on_call: false, contact: '09' + String(170000000 + e.id * 7331).slice(0, 9), active: true, employment_type: 'Regular', allowance: 0, hire_date: dayIso(400 + e.id * 13), branch: 'Main Branch', can_enroll: false, day_off: 'Sunday' })

  /* product + inventory */
  for (const p of PRODUCTS) {
    d.table('product').insert({ id: p.id, product_name: p.product_name, sku: p.sku, category: p.category, color: p.color, dimension: p.dimension, cost: p.cost, price: p.price, status: 'active', supplier: p.category === 'Mattress' ? 'Uratex' : 'PAN Workshop', image_url: imageFor(p.sku), barcode: '480' + String(1000000000 + p.id * 9137).slice(0, 10), location: p.loc, warehouse_location: p.loc, product_type: 'Local', specs: null, images: galleryFor(p.sku), color_variants: [] })
    d.table('inventory').insert({ id: p.id, product_name: p.product_name, sku: p.sku, category: p.category, color: p.color, dimension: p.dimension, oh_inv: p.oh, reserved: p.res, available: p.oh - p.res, location: p.loc, warehouse_location: p.loc, supplier: p.category === 'Mattress' ? 'Uratex' : 'PAN Workshop', status: 'active', value: p.oh * p.cost })
    if (p.oh > 0 && p.loc) d.table('stock_placements').insert({ sku: p.sku, location_code: p.loc, qty: p.oh, updated_at: tsAgo(3) })
  }

  /* customers */
  CUSTOMERS.forEach(([name, contact, address, email], i) => d.table('customers').insert({ id: i + 1, code: 'C-' + String(i + 1).padStart(4, '0'), name, contact, contact_number: contact, email, address, status: 'active', notes: null, created_at: tsAgo(200 - i * 9) }))

  /* orders + downstream rows */
  const orders = d.table('orders'), jobs = d.table('workshop_job'), dels = d.table('deliveries'), pays = d.table('order_payments'), qcd = d.table('qc_declarations'), wqc = d.table('warehouse_qc'), inst = d.table('installations'), skips = d.table('ops_line_skip')
  /* Quota plan so every team tab has rows: per team 12 scheduled (half already picked up from the
     warehouse → on the driver's route, half still Pickup Tasks), 4 out for delivery today,
     20 delivered, 12 installed; plus orders still in approval / workshop / QC / ready. */
  type Plan = { stage: 'toassign' | 'workshop' | 'qc' | 'ready' | 'scheduled' | 'out' | 'delivered' | 'installed'; team: (typeof TEAMS)[number] | null; ahead: number; picked: boolean }
  const PLAN: Plan[] = []
  for (let rep = 0; rep < 4; rep++) for (const team of TEAMS) {
    for (let k = 0; k < 12; k++) PLAN.push({ stage: 'scheduled', team, ahead: k % 4, picked: k % 2 === 0 })
    for (let k = 0; k < 4; k++) PLAN.push({ stage: 'out', team, ahead: 0, picked: true })
    for (let k = 0; k < 20; k++) PLAN.push({ stage: 'delivered', team, ahead: 0, picked: true })
    for (let k = 0; k < 12; k++) PLAN.push({ stage: 'installed', team, ahead: 0, picked: true })
  }
  for (const [stage, n] of [['toassign', 26], ['workshop', 20], ['qc', 12], ['ready', 14]] as const) for (let k = 0; k < n; k++) PLAN.push({ stage, team: null, ahead: 0, picked: false })
  for (let k = PLAN.length - 1; k > 0; k--) { const j = Math.floor(r() * (k + 1)); const t = PLAN[k]; PLAN[k] = PLAN[j]; PLAN[j] = t }
  let seq = 100 + PLAN.length
  for (let i = 0; i < PLAN.length; i++) {
    const plan = PLAN[i]
    const age = plan.stage === 'scheduled' || plan.stage === 'out' ? 2 + Math.floor(r() * 5) : plan.stage === 'delivered' ? 10 + Math.floor(r() * 30) : plan.stage === 'installed' ? 20 + Math.floor(r() * 90) : plan.stage === 'ready' ? 6 + Math.floor(r() * 4) : plan.stage === 'qc' ? 5 + Math.floor(r() * 3) : plan.stage === 'workshop' ? 2 + Math.floor(r() * 4) : Math.floor(r() * 3)
    const c = pick(r, CUSTOMERS)
    const nItems = r() > 0.6 ? 2 : 1
    const items = Array.from({ length: nItems }, () => { const p = pick(r, PRODUCTS); const qty = p.category === 'Mattress' || p.category === 'Chair' ? 1 + Math.floor(r() * 2) : 1; return { qty, description: p.product_name, unitPrice: p.price, sku: p.sku, category: p.category, color: p.color, dimension: p.dimension, image: imageFor(p.sku), workshop: WORKSHOPS[0].name, customized: p.mto } })
    const total = items.reduce((a, it) => a + it.qty * it.unitPrice, 0)
    const roll = r()
    const paid: 'Pending' | 'Partial' | 'Completed' = plan.stage === 'toassign' ? (roll > 0.65 ? 'Pending' : 'Partial') : plan.stage === 'installed' || plan.stage === 'delivered' ? (roll > 0.15 ? 'Completed' : 'Partial') : roll > 0.6 ? 'Completed' : 'Partial'
    const dp = paid === 'Pending' ? 0 : Math.ceil(total * (paid === 'Partial' ? 0.3 + Math.floor(r() * 3) * 0.1 : 0.3))
    const full = paid === 'Completed' ? total - dp : 0
    const stage = plan.stage
    const team = plan.team
    const dqDate = team ? (stage === 'scheduled' || stage === 'out' ? daysAheadIso(plan.ahead) : dayIso(Math.max(0, age - 9))) : null
    const status = stage === 'installed' || stage === 'delivered' ? 'Delivered' : paid === 'Completed' ? 'Completed' : paid === 'Partial' ? 'Partial' : 'Pending'
    const id = 1000 + i, no = 'ORD-' + String(seq--).padStart(6, '0'), rep = pick(r, REPS), mop = paid === 'Pending' ? null : pick(r, ['Maya QR', 'Cash', 'Maya Card', 'Bank Transfer'])
    const first = items[0]
    orders.insert({
      id, order_number: no, date_order: dayIso(age), customer_name: c[0], Source: pick(r, SOURCES), address: c[2], address_lat: 13.93 + (r() - 0.5) * 0.2, address_lng: 121.61 + (r() - 0.5) * 0.2, contact_number: c[1], email: c[3],
      fb_name: null, fb_link: null, product_name: items.map((it) => `${it.qty}× ${it.description}`).join('\n'), sku: first.sku, category: first.category, color: first.color, dimension: first.dimension,
      date_downpayment: dp ? dayIso(age) : null, downpayment_price: dp, full_payment_date: full ? dayIso(Math.max(0, age - 12)) : null, full_payment: full, full_payment_price: total,
      workshop_date: stage !== 'toassign' ? dayIso(Math.max(0, age - 1)) : null, date_of_delivery: dqDate, remaining_days: null, status, assigned: rep, is_rush: r() > 0.9, rush_days: null,
      mop, receipt_items: items, receipt_discounts: [], receipt_payment_terms: dp ? [{ label: 'Downpayment', amount: dp }] : [], transaction_images: [], inventory_deducted: stage !== 'toassign', workshop_completed_at: ['ready', 'scheduled', 'out', 'delivered', 'installed'].includes(stage) ? tsAgo(Math.max(0, age - 4)) : null,
      inventory_shipped: ['delivered', 'installed'].includes(stage), branch: 'Main Branch', landmark: null, mto_number: null, fq_number: null, lines_shipped: ['delivered', 'installed'].includes(stage) ? items.map((it) => it.description) : [],
      dq_group: team ? c[2].split(',').pop()!.trim() : null, dq_status: team ? 'confirmed' : null, dq_date: dqDate, dq_team: team?.name ?? null, dq_driver: team?.driver ?? null, dq_time_window: team ? 'AM' : null, dq_stop: team ? 1 + Math.floor(r() * 4) : null, dq_sent_at: team ? tsAgo(Math.max(0, age - 1), 9, 0) : null, dq_confirmed_at: team ? tsAgo(Math.max(0, age - 1), 11, 0) : null, dq_route_final_at: team ? tsAgo(Math.max(0, age - 1), 17, 0) : null,
      customer_psid: null, alt_contact_number: null, alt_contact_relation: null, dq_items: null, maya_checkout_id: mop?.startsWith('Maya') ? 'chk_' + id : null, maya_status: mop?.startsWith('Maya') ? 'PAYMENT_SUCCESS' : null, maya_paid_at: mop?.startsWith('Maya') ? tsAgo(age) : null,
    })
    if (dp) pays.insert({ order_id: id, amount: dp, method: mop, kind: 'downpayment', reference: mop?.startsWith('Maya') ? 'MAYA-' + id : 'OR-' + id, collected_by: rep, paid_at: dayIso(age), created_at: tsAgo(age) })
    if (full) pays.insert({ order_id: id, amount: full, method: team ? 'COD' : mop, kind: 'full', reference: 'OR-' + id + 'B', collected_by: team ? team.driver : rep, paid_at: dayIso(Math.max(0, age - 12)), created_at: tsAgo(Math.max(0, age - 12)) })
    if (stage !== 'toassign') for (const it of items) {
      if (!it.customized && r() > 0.5) { skips.insert({ order_id: id, item_desc: it.description, created_at: tsAgo(age - 1) }); continue }
      const ws = WORKSHOPS.find((w) => w.name === it.workshop)!
      const jstatus = stage === 'workshop' ? pick(r, ['pending', 'accepted', 'in progress', 'in progress']) : stage === 'qc' ? 'done' : 'qc passed'
      const atWorkshop = jstatus === 'qc passed' && stage === 'ready' && r() > 0.35 // approved by QC, still waiting for a driver to collect
      const job = jobs.insert({ order_id: id, order_number: no, workshop_id: ws.id, item_desc: it.description, qty: it.qty, status: jstatus, dispatched_at: tsAgo(Math.max(0, age - 1)), updated_at: tsAgo(Math.max(0, age - 2)), qc_received_at: jstatus === 'qc passed' && !atWorkshop ? tsAgo(Math.max(0, age - 4)) : null, fulfillment: 'warehouse', stock_request: false })
      if (jstatus === 'done' || jstatus === 'qc passed') {
        const worker = EMPLOYEES.find((e) => e.department === ws.name)!
        qcd.insert({ order_id: id, order_number: no, workshop: ws.name, qc_name: 'Cathy Robles', worker_id: worker.id, worker_name: worker.name, item: it.description, category: it.category, add_ons: [], base_amount: Math.round(it.unitPrice * 0.12), addon_amount: 0, total_amount: Math.round(it.unitPrice * 0.12), week_ending: dayIso(Math.max(0, age - 4)), status: jstatus === 'qc passed' ? 'Approved' : 'For Approval', declared_at: tsAgo(Math.max(0, age - 4)), approved_at: jstatus === 'qc passed' ? tsAgo(Math.max(0, age - 3)) : null, approved_by: jstatus === 'qc passed' ? 'Liza Mercado' : null, job_id: job.id, checklist: [], workers: [{ id: worker.id, name: worker.name }], pickup_team: atWorkshop ? TEAMS[(id + ws.id) % TEAMS.length].name : null, pickup_at: null })
        if (jstatus === 'qc passed' && !atWorkshop) wqc.insert({ checkpoint: 'IN', source: 'workshop', ref_id: job.id, ref_label: no, sku: it.sku, product_name: it.description, category: it.category, color: it.color, dimension: it.dimension, qty: it.qty, good_qty: it.qty, defect_qty: 0, result: 'pass', photos: roomPhotos(id, 1), remarks: null, checked_by: 'Cathy Robles', stocked_at: tsAgo(Math.max(0, age - 4)), created_at: tsAgo(Math.max(0, age - 4)) })
      }
    }
    if (team) {
      const dstatus = stage === 'scheduled' ? 'Scheduled' : stage === 'out' ? 'Out for Delivery' : 'Delivered'
      const cod = Math.max(0, total - dp - full)
      const del = dels.insert({ order_id: id, order_number: no, customer_name: c[0], contact: c[1], address: c[2], sales_rep: rep, items_summary: items.map((it) => `${it.qty}× ${it.description}`).join(', '), total_amount: total, paid_amount: dp + full, balance_due: cod, schedule_date: dqDate, time_window: 'AM', driver_team: team.name, vehicle_plate: team.vehicle.split('·')[1]?.trim() ?? null, qa_status: 'QA Passed', qa_by: 'Cathy Robles', payment_collected: stage === 'scheduled' || stage === 'out' ? 0 : cod, payment_method: cod ? 'COD' : null, collected_by: stage === 'delivered' || stage === 'installed' ? team.driver : null, received_by: stage === 'delivered' || stage === 'installed' ? c[0] : null, proof_url: null, delivered_at: stage === 'delivered' || stage === 'installed' ? tsAgo(Math.max(0, age - 9), 14, 20) : null, status: dstatus, notes: null, created_at: tsAgo(Math.max(0, age - 10)), packed_at: tsAgo(Math.max(0, age - 10), 8), packing_photos: stage === 'delivered' || stage === 'installed' ? roomPhotos(id, 2) : [], packed_by: 'Dennis Alcala', inventory_shipped: stage === 'delivered' || stage === 'installed', started_at: stage !== 'scheduled' ? tsAgo(Math.max(0, age - 9), 8, 30) : null, arrived_at: stage === 'delivered' || stage === 'installed' ? tsAgo(Math.max(0, age - 9), 14) : null, coordinator: 'Kim Reyes', pin: String(1000 + Math.floor(r() * 9000)), pickup_at: plan.picked ? tsAgo(0, 7, 30) : null, pickup_by: plan.picked ? team.driver : null, pickup_started_at: plan.picked ? tsAgo(0, 7, 0) : null, pickup_arrived_at: plan.picked ? tsAgo(0, 7, 20) : null, pickup_good: plan.picked ? items.reduce((a, it) => a + it.qty, 0) : null, pickup_defect: plan.picked ? 0 : null, pickup_photos: plan.picked ? roomPhotos(id + 5, 1) : [] })
      if (stage === 'installed') inst.insert({ order_id: id, delivery_id: del.id, order_number: no, customer_name: c[0], address: c[2], sales_rep: rep, items_summary: items.map((it) => it.description).join(', '), install_date: dayIso(Math.max(0, age - 9)), installer_team: team.name, warranty_terms: 'Frame & workmanship', warranty_duration: '1 year', warranty_start: dayIso(Math.max(0, age - 9)), signature_url: null, photos: roomPhotos(id + 3, 3), feedback: pick(r, ['Very satisfied', 'Maganda ang gawa, salamat!', null]), status: 'Completed', completed_at: tsAgo(Math.max(0, age - 9), 15, 10), notes: null, created_at: tsAgo(Math.max(0, age - 9)), warranty_emailed_at: tsAgo(Math.max(0, age - 9), 15, 12), item_installers: [] })
    }
  }

  /* MTO requests (from panfurniture.ph / Messenger) */
  const mto = d.table('mto_requests')
  mto.insert({ mto_number: 'MTO-0042', sku: 'KC-RUN-CUSTOM', slug: 'kitchen-cabinet', product_name: 'Kitchen Cabinet Run + Corner Unit', category: 'Cabinet', image_url: imageFor('KC-RUN-32'), build: { length_m: 4.1, depth_m: 0.6, finish: 'White duco', doors: 8, drawers: 4 }, customer_name: 'Grace Villanueva', contact: '0926 555 0109', address: 'Brgy. Cotta, Lucena City', psid: '7213890', status: 'New', fq_number: null, order_number: null, created_at: tsAgo(0, 13, 31), fb_name: 'Grace Villanueva', fb_link: 'https://m.me/7213890' })
  mto.insert({ mto_number: 'MTO-0041', sku: 'SH-WALL-CUSTOM', slug: 'bookshelf', product_name: 'Bookshelf Wall Unit', category: 'Cabinet', image_url: imageFor('SH-5T-OAK'), build: { width_m: 2.4, height_m: 2.1, finish: 'Oak stain', tiers: 6 }, customer_name: 'Mark Domingo', contact: '0927 555 0108', address: 'San Pablo City, Laguna', psid: null, status: 'Quoted', fq_number: 'FQ-2026-0118', order_number: null, created_at: tsAgo(1, 19, 2) })
  mto.insert({ mto_number: 'MTO-0040', sku: 'SF-LSH-CUSTOM', slug: 'sala-set', product_name: 'Sala Set L-Shape', category: 'Sofa', image_url: imageFor('SF-LSH-GL'), build: { width_m: 2.8, depth_m: 1.8, fabric: 'Grey linen' }, customer_name: 'Jenny dela Cruz', contact: '0919 555 0116', address: 'Lucban, Quezon', psid: '5510022', status: 'Converted', fq_number: 'FQ-2026-0112', order_number: 'ORD-000116', created_at: tsAgo(3, 10, 47), fb_name: 'Jenny dela Cruz', fb_link: 'https://m.me/5510022' })

  /* workshop materials + stock requests */
  const mats = d.table('workshop_material')
  const MATS: [number, string, string, string, number, number][] = [[1, 'Marine plywood 3/4"', 'sheets', 'Wood', 60, 1850], [1, 'Narra board 1×8', 'bd ft', 'Wood', 200, 320], [1, 'Soft-close hinges', 'pcs', 'Hardware', 300, 85], [1, 'Drawer slides 18"', 'pairs', 'Hardware', 60, 240], [1, 'High-density foam 4"', 'sheets', 'Upholstery', 25, 2600], [1, 'Velvet — moss', 'm', 'Fabric', 40, 480], [1, 'Linen — grey', 'm', 'Fabric', 40, 390], [1, 'Acacia slab 2"', 'bd ft', 'Wood', 120, 410], [1, 'Duco lacquer — white', 'L', 'Finishing', 30, 620], [1, 'Wood screws #8 1½"', 'boxes', 'Hardware', 10, 180]]
  MATS.forEach(([ws, name, unit, category, low, price], i) => mats.insert({ id: i + 1, workshop_id: ws, name, barcode: '2' + String(100000 + i), unit, category, low_threshold: low, active: true, image_url: swatch(category, unit), price, manager_only: false }))
  d.table('stock_request').insert({ workshop_id: 1, material_id: 7, qty_requested: 30, qty_fulfilled: null, reason: 'Two L-shape sala sets in production', status: 'pending', requested_by: 'Mang Boy Lacsamana', created_at: tsAgo(0, 9, 12), seen_by_ws: true, qty_received: 0, ops_followed_up: false })
  d.table('stock_request').insert({ workshop_id: 1, material_id: 3, qty_requested: 200, qty_fulfilled: 200, reason: 'Wardrobe batch', status: 'ordered', requested_by: 'Mang Rey Villamor', decided_by: 'Rowena Purificacion', created_at: tsAgo(2, 15, 40), decided_at: tsAgo(2, 16, 5), seen_by_ws: true, qty_received: 0, ops_followed_up: true })
  d.table('stock_request').insert({ workshop_id: 1, material_id: 8, qty_requested: 80, qty_fulfilled: 80, reason: 'Dining set order', status: 'received', requested_by: 'Kuya Jun Dimaculangan', decided_by: 'Rowena Purificacion', created_at: tsAgo(6, 8, 0), decided_at: tsAgo(6, 9, 0), seen_by_ws: true, qty_received: 80, ops_followed_up: false })

  /* HR attendance — last 14 working days */
  const att = d.table('hr_attendance'), ot = d.table('hr_overtime')
  for (let dOff = 0; dOff < 14; dOff++) {
    const date = new Date(); date.setDate(date.getDate() - dOff)
    if (date.getDay() === 0) continue
    for (const e of EMPLOYEES) {
      if (e.rate_type === 'Project' && r() > 0.7) continue
      const roll = r()
      if (roll > 0.94) { att.insert({ employee_id: e.id, work_date: date.toISOString().slice(0, 10), time_in: null, time_out: null, status: 'absent', ot_hours: 0, source: 'manual', notes: null }); continue }
      if (roll > 0.9) { att.insert({ employee_id: e.id, work_date: date.toISOString().slice(0, 10), time_in: null, time_out: null, status: 'leave', ot_hours: 0, source: 'manual', notes: 'Approved day off' }); continue }
      const late = roll > 0.8
      const tin = new Date(date); tin.setHours(late ? 8 : 7, late ? 15 + Math.floor(r() * 40) : 40 + Math.floor(r() * 25), 0, 0)
      const tout = new Date(date); const otH = r() > 0.8 ? 1 + Math.floor(r() * 3) : 0; tout.setHours(17 + otH, Math.floor(r() * 20), 0, 0)
      const isToday = dOff === 0
      const row = att.insert({ employee_id: e.id, work_date: date.toISOString().slice(0, 10), time_in: tin.toISOString(), time_out: isToday ? null : tout.toISOString(), status: late ? 'late' : 'present', ot_hours: isToday ? 0 : otH, source: e.work_setup === 'WFH' || e.work_setup === 'Hybrid' ? 'wfh' : 'kiosk', notes: null })
      if (!isToday && otH > 0) ot.insert({ attendance_id: row.id, employee_id: e.id, work_date: date.toISOString().slice(0, 10), hours: otH, status: r() > 0.5 ? 'Approved' : 'Pending', approved_by: r() > 0.5 ? 'Liza Mercado' : null })
    }
  }

  /* audit log */
  const log = d.table('audit_log')
  const actors = [['demo-administrator', 'Joe Marie Casela'], ['demo-operations_manager', 'Rowena Purificacion'], ['demo-sales_staff', 'Ana Noriega'], ['demo-warehouse_staff', 'Dennis Alcala'], ['demo-human_resources', 'Liza Mercado']] as const
  const events: [string, string, string, string][] = [['insert', 'orders', 'orders', 'ORD-000180'], ['update', 'orders', 'orders', 'ORD-000178'], ['status_change', 'operations', 'workshop_job', '412'], ['insert', 'payments', 'order_payments', '1180'], ['update', 'inventory', 'inventory', '12'], ['insert', 'customers', 'customers', '18'], ['update', 'hr', 'hr_attendance', '204'], ['delete', 'operations', 'ops_line_skip', '1177'], ['update', 'delivery', 'deliveries', '61'], ['insert', 'mto', 'mto_requests', 'MTO-0042']]
  for (let i = 0; i < 60; i++) {
    const [uid, uname] = pick(r, actors); const [action, module, table, rec] = pick(r, events)
    log.insert({ user_id: uid, user_name: uname, action_type: action, module, table_name: table, record_id: rec, previous_value: action === 'insert' ? null : { status: 'Pending' }, new_value: action === 'delete' ? null : { status: 'Partial', updated_by: uname }, ip_address: '192.168.1.' + (10 + (i % 40)), created_at: tsAgo(Math.floor(i / 6), 8 + (i % 9), (i * 7) % 60) })
  }

  /* misc empty tables the loaders touch */
  for (const t of ['returns', 'received_parts', 'fb_contacts', 'wfh_activity', 'order_line_deliveries', 'role_permissions', 'user_permissions', 'order_edit_requests', 'quotations', 'design_details', 'purchase_orders', 'suppliers', 'stock_adjustments', 'stock_build', 'warehouse_locations', 'web_products', 'web_content']) d.table(t)
}

export function ensureSeeded() { db.seed(SEED_VERSION, seedAllWithExtra) }
export function resetSeed() { db.reset(seedAllWithExtra) }

import { imageFor, galleryFor, roomPhotos, swatch } from './images'
import { seedExtra } from './seed-extra'
import { seedMore } from './seed-more'
export function seedAllWithExtra(d: typeof db) { seedAll(d); seedExtra(d); seedMore(d) }
