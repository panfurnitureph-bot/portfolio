/* Dummy data for the PAN System demo — shaped exactly like the rows the real components expect. */
import type { Role } from './real/lib/auth/rbac'
import type { SalesOrder, SalesTargets } from './real/app/dashboard/sales-types'
import type { ShellUser } from './real/components/app-shell'

export const DEMO_PASSWORD = 'pan1234'
export const DEMO_OTP = '123456'

export const DEMO_ACCOUNTS: { email: string; role: Role; name: string; work_setup: string }[] = [
  { email: 'admin@panfurniture.ph', role: 'administrator', name: 'Joe Marie Casela', work_setup: 'Hybrid' },
  { email: 'ops@panfurniture.ph', role: 'operations_manager', name: 'Rowena Purificacion', work_setup: 'Onsite' },
  { email: 'sales@panfurniture.ph', role: 'sales_staff', name: 'Ana Noriega', work_setup: 'Onsite' },
  { email: 'warehouse@panfurniture.ph', role: 'warehouse_staff', name: 'Dennis Alcala', work_setup: 'Onsite' },
  { email: 'hr@panfurniture.ph', role: 'human_resources', name: 'Liza Mercado', work_setup: 'Hybrid' },
  { email: 'delivery@panfurniture.ph', role: 'delivery_team_a', name: 'Delivery Team Tablet', work_setup: '' },
  { email: 'production@panfurniture.ph', role: 'workshop_gma_white', name: 'Production Area Tablet', work_setup: '' },
]

export function shellUserFor(role: Role): ShellUser {
  const a = DEMO_ACCOUNTS.find((x) => x.role === role) ?? DEMO_ACCOUNTS[0]
  return { id: 'demo-' + role, full_name: a.name, email: a.email, role, active: true, avatar_url: null, permissions: [], work_setup: a.work_setup }
}

export const DEFAULT_DEMO_TARGETS: SalesTargets = { revenue: 1_200_000, orders: 40, collection: 80, aov: 30_000 }

/* ---------- catalogue (mirrors `product` rows) ---------- */
export type DemoProduct = { id: number; product_name: string; sku: string; category: string; color: string | null; dimension: string | null; price: number; cost: number; oh_inv: number; reserved: number; location: string; supplier: string | null; status: 'active' | 'inactive'; workshop: 'Production Area' | 'Production Area' | 'Production Area'; mto: boolean; image: string | null }
export const PRODUCTS: DemoProduct[] = [
  { id: 1, product_name: '3-Seater Sofa — Velvet Moss', sku: 'SF-VLV-3S', category: 'Sofa', color: 'Moss', dimension: '84 × 36 × 34 in', price: 38500, cost: 21500, oh_inv: 4, reserved: 1, location: 'A-01', supplier: 'PAN Workshop', status: 'active', workshop: 'Production Area', mto: false, image: null },
  { id: 2, product_name: 'Sala Set L-Shape — Grey Linen', sku: 'SF-LSH-GL', category: 'Sofa', color: 'Grey', dimension: '110 × 72 × 34 in', price: 52900, cost: 29800, oh_inv: 1, reserved: 0, location: 'A-02', supplier: 'PAN Workshop', status: 'active', workshop: 'Production Area', mto: true, image: null },
  { id: 3, product_name: 'Queen Bed Frame — Narra', sku: 'BD-QN-NAR', category: 'Bedroom', color: 'Natural', dimension: '60 × 75 in', price: 29800, cost: 16400, oh_inv: 3, reserved: 1, location: 'B-04', supplier: 'PAN Workshop', status: 'active', workshop: 'Production Area', mto: false, image: null },
  { id: 4, product_name: 'Bunk Bed — Pine', sku: 'BD-BNK-PN', category: 'Bedroom', color: 'Natural', dimension: '36 × 75 in', price: 18900, cost: 10200, oh_inv: 5, reserved: 0, location: 'B-06', supplier: 'PAN Workshop', status: 'active', workshop: 'Production Area', mto: false, image: null },
  { id: 5, product_name: 'Dining Set 6-Seater — Acacia', sku: 'DN-6S-ACA', category: 'Dining', color: 'Walnut', dimension: '72 × 36 × 30 in', price: 46500, cost: 25900, oh_inv: 1, reserved: 1, location: 'C-01', supplier: 'PAN Workshop', status: 'active', workshop: 'Production Area', mto: true, image: null },
  { id: 6, product_name: 'Wardrobe 3-Door — White Duco', sku: 'WD-3D-WHT', category: 'Storage', color: 'White', dimension: '60 × 22 × 80 in', price: 27400, cost: 15100, oh_inv: 2, reserved: 0, location: 'C-05', supplier: 'PAN Workshop', status: 'active', workshop: 'Production Area', mto: false, image: null },
  { id: 7, product_name: 'Kitchen Cabinet Run 3.2m', sku: 'KC-RUN-32', category: 'Kitchen', color: 'White', dimension: '3.2 m × 0.6 m', price: 68000, cost: 39400, oh_inv: 0, reserved: 0, location: '—', supplier: 'PAN Workshop', status: 'active', workshop: 'Production Area', mto: true, image: null },
  { id: 8, product_name: 'Office Table — Walnut', sku: 'OF-TBL-WAL', category: 'Office', color: 'Walnut', dimension: '48 × 24 × 30 in', price: 15900, cost: 8300, oh_inv: 6, reserved: 2, location: 'D-02', supplier: 'PAN Workshop', status: 'active', workshop: 'Production Area', mto: false, image: null },
  { id: 9, product_name: 'Mattress 60×75 — 8in Foam', sku: 'MT-6075-8', category: 'Mattress', color: null, dimension: '60 × 75 × 8 in', price: 8900, cost: 4600, oh_inv: 12, reserved: 3, location: 'E-01', supplier: 'Uratex', status: 'active', workshop: 'Production Area', mto: false, image: null },
  { id: 10, product_name: 'Accent Chair — Rattan', sku: 'CH-ACC-RTN', category: 'Seating', color: 'Natural', dimension: '28 × 30 × 32 in', price: 7600, cost: 3900, oh_inv: 8, reserved: 0, location: 'A-08', supplier: 'PAN Workshop', status: 'active', workshop: 'Production Area', mto: false, image: null },
  { id: 11, product_name: 'Center Table — Marble Top', sku: 'TB-CTR-MRB', category: 'Tables', color: 'White', dimension: '48 × 24 × 18 in', price: 12400, cost: 6800, oh_inv: 3, reserved: 0, location: 'D-05', supplier: 'PAN Workshop', status: 'active', workshop: 'Production Area', mto: false, image: null },
  { id: 12, product_name: 'TV Console 1.8m', sku: 'TV-CON-18', category: 'Storage', color: 'Walnut', dimension: '1.8 m × 0.4 m × 0.5 m', price: 14200, cost: 7700, oh_inv: 4, reserved: 1, location: 'C-08', supplier: 'PAN Workshop', status: 'active', workshop: 'Production Area', mto: false, image: null },
  { id: 13, product_name: 'Bookshelf 5-Tier — Oak', sku: 'SH-5T-OAK', category: 'Storage', color: 'Oak', dimension: '32 × 12 × 72 in', price: 11800, cost: 6100, oh_inv: 5, reserved: 0, location: 'C-10', supplier: 'PAN Workshop', status: 'active', workshop: 'Production Area', mto: false, image: null },
  { id: 14, product_name: 'Study Desk + Hutch', sku: 'OF-DSK-HT', category: 'Office', color: 'White', dimension: '48 × 24 × 60 in', price: 17500, cost: 9200, oh_inv: 2, reserved: 0, location: 'D-03', supplier: 'PAN Workshop', status: 'active', workshop: 'Production Area', mto: false, image: null },
  { id: 15, product_name: 'Bar Stools (set of 4)', sku: 'CH-BAR-4', category: 'Seating', color: 'Black', dimension: '16 × 16 × 30 in', price: 9800, cost: 5000, oh_inv: 6, reserved: 0, location: 'A-10', supplier: 'PAN Workshop', status: 'active', workshop: 'Production Area', mto: false, image: null },
]

/* ---------- customers / reps ---------- */
export const CUSTOMERS = [
  ['Maria Santos', '0917 555 0118', 'Brgy. Ibabang Dupay, Lucena City'], ['Robert Tecson', '0918 555 0117', 'Tayabas City, Quezon'], ['Jenny dela Cruz', '0919 555 0116', 'Lucban, Quezon'],
  ['Carlo Mendoza', '0920 555 0115', 'Sariaya, Quezon'], ['Liza Garcia', '0921 555 0114', 'Pagbilao, Quezon'], ['Paolo Bautista', '0922 555 0113', 'Candelaria, Quezon'],
  ['Teresa Ramos', '0923 555 0112', 'Brgy. Gulang-Gulang, Lucena City'], ['Edwin Aquino', '0924 555 0111', 'Tiaong, Quezon'], ['Nina Castillo', '0925 555 0110', 'Lucena City'],
  ['Grace Villanueva', '0926 555 0109', 'Brgy. Cotta, Lucena City'], ['Mark Domingo', '0927 555 0108', 'San Pablo City, Laguna'], ['Rica Salazar', '0928 555 0107', 'Atimonan, Quezon'],
  ['Ferdinand Ocampo', '0929 555 0106', 'Gumaca, Quezon'], ['Hazel Pascual', '0930 555 0105', 'Lucena City'], ['Ivan Mercado', '0931 555 0104', 'Tayabas City, Quezon'],
  ['Joy Navarro', '0932 555 0103', 'Brgy. Mayao, Lucena City'], ['Kevin Torres', '0933 555 0102', 'Sariaya, Quezon'], ['Lorna Flores', '0934 555 0101', 'Lucena City'],
] as const
export const REPS = ['Ana Noriega', 'Marco Reyes', 'Bea Lim']
export const SOURCES = ['Walk-in', 'Facebook', 'Website', 'Referral']

/* deterministic PRNG */
export function rng(seed: number) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296 } }
const iso = (d: Date) => d.toISOString().slice(0, 10)
export const daysAgo = (n: number) => { const d = new Date(); d.setDate(d.getDate() - n); return iso(d) }
export const daysAhead = (n: number) => { const d = new Date(); d.setDate(d.getDate() + n); return iso(d) }

/* ---------- Sales orders (shape: SalesOrder for the dashboard; richer OrderRow-like fields for tables) ---------- */
export type DemoOrder = SalesOrder & {
  contact_number: string; address: string; email: string | null; date_downpayment: string | null; full_payment_date: string | null
  workshop_date: string | null; date_of_delivery: string | null; is_rush: boolean; mop: string | null
  ops: 'To Assign' | 'Workshop' | 'QC' | 'Ready' | 'Scheduled' | 'Out for Delivery' | 'Arrived' | 'Delivered' | 'Installed'
  team: 'Delivery Team' | null
}

export function buildOrders(): DemoOrder[] {
  const r = rng(20260904)
  const out: DemoOrder[] = []
  const opsByAge = (age: number, paid: 'Pending' | 'Partial' | 'Completed'): DemoOrder['ops'] =>
    paid === 'Pending' ? 'To Assign' : age > 20 ? 'Installed' : age > 14 ? 'Delivered' : age > 10 ? 'Out for Delivery' : age > 7 ? 'Scheduled' : age > 5 ? 'Ready' : age > 3 ? 'QC' : age > 1 ? 'Workshop' : 'To Assign'
  for (let i = 0; i < 64; i++) {
    const age = Math.floor(Math.pow(r(), 1.4) * 120)
    const c = CUSTOMERS[Math.floor(r() * CUSTOMERS.length)]
    const nItems = r() > 0.6 ? 2 : 1
    const items = Array.from({ length: nItems }, () => { const p = PRODUCTS[Math.floor(r() * PRODUCTS.length)]; const qty = p.category === 'Mattress' || p.category === 'Seating' ? 1 + Math.floor(r() * 2) : 1; return { qty, description: p.product_name, unitPrice: p.price, category: p.category, image: p.image, cost: p.cost, sku: p.sku } })
    const total = items.reduce((a, it) => a + it.qty * it.unitPrice, 0)
    const roll = r()
    const status: 'Pending' | 'Partial' | 'Completed' = age > 15 ? (roll > 0.15 ? 'Completed' : 'Partial') : roll > 0.75 ? 'Completed' : roll > 0.18 ? 'Partial' : 'Pending'
    const downpayment = status === 'Pending' ? 0 : status === 'Partial' ? Math.ceil(total * (0.3 + Math.floor(r() * 3) * 0.1)) : Math.ceil(total * 0.3)
    const full_payment = status === 'Completed' ? total - downpayment : 0
    const ops = opsByAge(age, status)
    const team = ['Scheduled', 'Out for Delivery', 'Arrived', 'Delivered', 'Installed'].includes(ops) ? 'Delivery Team' as const : null
    const mop = status === 'Pending' ? null : ['Maya QR', 'Cash', 'Maya Card', 'Bank Transfer'][Math.floor(r() * 4)]
    out.push({
      id: 1000 + i, order_number: 'ORD-' + String(180 - i).padStart(6, '0'), date_order: daysAgo(age), customer_name: c[0], source: SOURCES[Math.floor(r() * SOURCES.length)], status, assigned: REPS[Math.floor(r() * REPS.length)],
      downpayment, full_payment, total, category: items[0].category, items,
      contact_number: c[1], address: c[2], email: null, date_downpayment: downpayment ? daysAgo(age) : null, full_payment_date: full_payment ? daysAgo(Math.max(0, age - 12)) : null,
      workshop_date: ops !== 'To Assign' ? daysAgo(Math.max(0, age - 1)) : null, date_of_delivery: team ? daysAgo(Math.max(0, age - 9)) : null, is_rush: r() > 0.9, mop, ops, team,
    })
  }
  return out.sort((a, b) => (a.date_order! < b.date_order! ? 1 : -1))
}
