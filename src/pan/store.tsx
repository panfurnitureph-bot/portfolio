/* PAN System demo store — mirrors the real app's domain rules (30% downpayment reserves stock,
   ledger-only inventory writes, approval → workshop/QC → delivery queue → teams A–D). State persists
   in localStorage so the demo is genuinely usable across reloads. */
import { createContext, useContext, useEffect, useMemo, useReducer, type ReactNode } from 'react'

export type Role = 'administrator' | 'operations_manager' | 'sales_staff' | 'warehouse_staff' | 'human_resources' | 'delivery_team_a' | 'delivery_team_b' | 'delivery_team_c' | 'delivery_team_d' | 'workshop_gma_original' | 'workshop_gma_white' | 'workshop_lrt'
export const ROLE_LABEL: Record<Role, string> = {
  administrator: 'Administrator', operations_manager: 'Operation Manager', sales_staff: 'Sales & Service', warehouse_staff: 'Warehouse & Delivery', human_resources: 'Human Resources',
  delivery_team_a: 'Delivery Team', delivery_team_b: 'Delivery Team B', delivery_team_c: 'Delivery Team C', delivery_team_d: 'Delivery Team D',
  workshop_gma_original: 'GMA Original Workshop', workshop_gma_white: 'GMA White Workshop', workshop_lrt: 'LRT Workshop',
}
export const ROLE_PILL: Record<Role, { label: string; bg: string }> = {
  administrator: { label: 'Admin', bg: '#dc2626' }, human_resources: { label: 'HR', bg: '#db2777' }, operations_manager: { label: 'Manager', bg: '#4f46e5' }, sales_staff: { label: 'Sales', bg: '#059669' }, warehouse_staff: { label: 'Warehouse', bg: '#d97706' },
  delivery_team_a: { label: 'Delivery', bg: '#0284c7' }, delivery_team_b: { label: 'Team B', bg: '#0284c7' }, delivery_team_c: { label: 'Team C', bg: '#0284c7' }, delivery_team_d: { label: 'Team D', bg: '#0284c7' },
  workshop_gma_original: { label: 'GMA Orig', bg: '#ea580c' }, workshop_gma_white: { label: 'GMA White', bg: '#ea580c' }, workshop_lrt: { label: 'LRT', bg: '#ea580c' },
}
export const USERS: Record<Role, { name: string; email: string }> = {
  administrator: { name: 'Joe Marie Casela', email: 'admin@panfurniture.ph' }, operations_manager: { name: 'Rowena Purificacion', email: 'ops@panfurniture.ph' }, sales_staff: { name: 'Ana Noriega', email: 'sales@panfurniture.ph' },
  warehouse_staff: { name: 'Dennis Alcala', email: 'warehouse@panfurniture.ph' }, human_resources: { name: 'Liza Mercado', email: 'hr@panfurniture.ph' },
  delivery_team_a: { name: 'Delivery Team Tablet', email: 'delivery@panfurniture.ph' }, delivery_team_b: { name: 'Team B Tablet', email: 'team-b@panfurniture.ph' }, delivery_team_c: { name: 'Team C Tablet', email: 'team-c@panfurniture.ph' }, delivery_team_d: { name: 'Team D Tablet', email: 'team-d@panfurniture.ph' },
  workshop_gma_original: { name: 'GMA Original Tablet', email: 'gma-original@panfurniture.ph' }, workshop_gma_white: { name: 'GMA White Tablet', email: 'gma-white@panfurniture.ph' }, workshop_lrt: { name: 'LRT Tablet', email: 'lrt@panfurniture.ph' },
}

export type Product = { sku: string; name: string; category: string; price: number; onHand: number; reserved: number; mto: boolean; workshop: Workshop }
export type Workshop = 'GMA Original' | 'GMA White' | 'LRT'
export type Team = 'Team A' | 'Team B' | 'Team C' | 'Team D'
export type OrderStatus = 'Pending' | 'Partial' | 'Completed' | 'Cancelled'
export type OpsStatus = 'To Assign' | 'Workshop' | 'QC' | 'Ready' | 'Scheduled' | 'Out for Delivery' | 'Arrived' | 'Delivered' | 'Installed'
export type OrderItem = { sku: string; name: string; qty: number; price: number; mto: boolean; workshop: Workshop }
export type Payment = { id: string; at: string; amount: number; method: 'Cash' | 'Maya QR' | 'Maya Card' | 'Bank' | 'COD'; ref: string }
export type Order = {
  no: string; date: string; customer: string; phone: string; address: string; source: 'Showroom' | 'Website' | 'Facebook' | 'Referral'
  items: OrderItem[]; payments: Payment[]; status: OrderStatus; ops: OpsStatus; team?: Team; schedule?: string; sales: string; notes?: string; rush?: boolean
}
export type Job = { id: string; orderNo: string; sku: string; name: string; qty: number; workshop: Workshop; status: 'Pending' | 'Accepted' | 'In Progress' | 'Done' | 'QC Passed' | 'QC Failed'; created: string; hours: number; worker?: string }
export type Movement = { id: string; at: string; sku: string; type: 'WHS In' | 'WHS Out' | 'Order Release' | 'Return' | 'Adjustment' | 'Workshop Out'; qtyIn: number; qtyOut: number; balance: number; ref: string; by: string }
export type Delivery = { orderNo: string; team: Team; date: string; status: 'Scheduled' | 'Out for Delivery' | 'Arrived' | 'Delivered' | 'Installed'; cod: number; driver: string; eta?: string; proof?: boolean }
export type Mto = { id: string; at: string; name: string; item: string; dims: string; budget: number; source: 'Website' | 'Facebook'; status: 'New' | 'Quoted' | 'Converted' }
export type Log = { at: string; who: string; action: string; module: string; ref: string }
export type Employee = { id: string; name: string; role: string; setup: 'Onsite' | 'WFH' | 'Hybrid'; in?: string; out?: string; status: 'Present' | 'Late' | 'Absent' | 'Day Off' }

export type State = {
  role: Role | null; path: string; products: Product[]; orders: Order[]; jobs: Job[]; ledger: Movement[]; deliveries: Delivery[]; mto: Mto[]; logs: Log[]; employees: Employee[]; seq: number
}

const today = new Date()
const iso = (d: Date) => d.toISOString().slice(0, 10)
const ago = (n: number) => { const d = new Date(today); d.setDate(d.getDate() - n); return iso(d) }
const ahead = (n: number) => { const d = new Date(today); d.setDate(d.getDate() + n); return iso(d) }
export const now = () => new Date().toLocaleString('en-PH', { month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit' })
export const peso = (n: number) => '₱' + n.toLocaleString('en-PH', { maximumFractionDigits: 0 })
export const orderTotal = (o: Order) => o.items.reduce((a, i) => a + i.qty * i.price, 0)
export const orderPaid = (o: Order) => o.payments.reduce((a, p) => a + p.amount, 0)
export const DOWNPAYMENT = 0.3

const PRODUCTS: Product[] = [
  { sku: 'SF-VLV-3S', name: '3-Seater Sofa — Velvet Moss', category: 'Sofa', price: 38500, onHand: 4, reserved: 1, mto: false, workshop: 'GMA White' },
  { sku: 'SF-LSH-GL', name: 'Sala Set L-Shape — Grey Linen', category: 'Sofa', price: 52900, onHand: 2, reserved: 0, mto: true, workshop: 'GMA White' },
  { sku: 'BD-QN-NAR', name: 'Queen Bed Frame — Narra', category: 'Bedroom', price: 29800, onHand: 3, reserved: 1, mto: false, workshop: 'GMA Original' },
  { sku: 'BD-BNK-PN', name: 'Bunk Bed — Pine', category: 'Bedroom', price: 18900, onHand: 5, reserved: 0, mto: false, workshop: 'GMA Original' },
  { sku: 'DN-6S-ACA', name: 'Dining Set 6-Seater — Acacia', category: 'Dining', price: 46500, onHand: 1, reserved: 1, mto: true, workshop: 'LRT' },
  { sku: 'WD-3D-WHT', name: 'Wardrobe 3-Door — White Duco', category: 'Storage', price: 27400, onHand: 2, reserved: 0, mto: false, workshop: 'LRT' },
  { sku: 'KC-RUN-32', name: 'Kitchen Cabinet Run 3.2m', category: 'Kitchen', price: 68000, onHand: 0, reserved: 0, mto: true, workshop: 'GMA Original' },
  { sku: 'OF-TBL-WAL', name: 'Office Table — Walnut', category: 'Office', price: 15900, onHand: 6, reserved: 2, mto: false, workshop: 'LRT' },
  { sku: 'MT-6075-8', name: 'Mattress 60×75 — 8in Foam', category: 'Mattress', price: 8900, onHand: 12, reserved: 3, mto: false, workshop: 'GMA White' },
  { sku: 'CH-ACC-RTN', name: 'Accent Chair — Rattan', category: 'Seating', price: 7600, onHand: 8, reserved: 0, mto: false, workshop: 'GMA Original' },
  { sku: 'TB-CTR-MRB', name: 'Center Table — Marble Top', category: 'Tables', price: 12400, onHand: 3, reserved: 0, mto: false, workshop: 'LRT' },
  { sku: 'TV-CON-18', name: 'TV Console 1.8m', category: 'Storage', price: 14200, onHand: 4, reserved: 1, mto: false, workshop: 'GMA Original' },
]

const P = (sku: string) => PRODUCTS.find((p) => p.sku === sku)!
const item = (sku: string, qty = 1): OrderItem => { const p = P(sku); return { sku, name: p.name, qty, price: p.price, mto: p.mto, workshop: p.workshop } }
const pay = (id: string, daysAgo: number, amount: number, method: Payment['method']): Payment => ({ id, at: ago(daysAgo) + ' 10:2' + (id.length % 10), amount, method, ref: method.startsWith('Maya') ? 'MAYA-' + id.toUpperCase() : method === 'Cash' ? 'OR-' + id.toUpperCase() : 'REF-' + id.toUpperCase() })

const ORDERS: Order[] = [
  { no: 'ORD-000118', date: ago(1), customer: 'Maria Santos', phone: '0917 555 0118', address: 'Brgy. Ibabang Dupay, Lucena City', source: 'Website', items: [item('SF-VLV-3S'), item('TB-CTR-MRB')], payments: [pay('p118', 1, 15270, 'Maya QR')], status: 'Partial', ops: 'To Assign', sales: 'Ana Noriega' },
  { no: 'ORD-000117', date: ago(1), customer: 'Robert Tecson', phone: '0918 555 0117', address: 'Tayabas City, Quezon', source: 'Showroom', items: [item('BD-QN-NAR'), item('MT-6075-8')], payments: [pay('p117', 1, 38700, 'Cash')], status: 'Completed', ops: 'Ready', sales: 'Ana Noriega' },
  { no: 'ORD-000116', date: ago(2), customer: 'Jenny dela Cruz', phone: '0919 555 0116', address: 'Lucban, Quezon', source: 'Facebook', items: [item('SF-LSH-GL')], payments: [pay('p116', 2, 15870, 'Maya Card')], status: 'Partial', ops: 'Workshop', sales: 'Ana Noriega', rush: true },
  { no: 'ORD-000115', date: ago(3), customer: 'Carlo Mendoza', phone: '0920 555 0115', address: 'Sariaya, Quezon', source: 'Showroom', items: [item('DN-6S-ACA')], payments: [pay('p115', 3, 13950, 'Cash')], status: 'Partial', ops: 'QC', sales: 'Ana Noriega' },
  { no: 'ORD-000114', date: ago(4), customer: 'Liza Garcia', phone: '0921 555 0114', address: 'Pagbilao, Quezon', source: 'Website', items: [item('OF-TBL-WAL', 2), item('CH-ACC-RTN', 2)], payments: [pay('p114', 4, 47000, 'Maya QR')], status: 'Completed', ops: 'Scheduled', team: 'Team B', schedule: ahead(1), sales: 'Ana Noriega' },
  { no: 'ORD-000113', date: ago(5), customer: 'Paolo Bautista', phone: '0922 555 0113', address: 'Candelaria, Quezon', source: 'Referral', items: [item('WD-3D-WHT'), item('TV-CON-18')], payments: [pay('p113', 5, 12480, 'Bank')], status: 'Partial', ops: 'Out for Delivery', team: 'Team A', schedule: ago(0), sales: 'Ana Noriega' },
  { no: 'ORD-000112', date: ago(6), customer: 'Teresa Ramos', phone: '0923 555 0112', address: 'Brgy. Gulang-Gulang, Lucena City', source: 'Showroom', items: [item('BD-BNK-PN'), item('MT-6075-8', 2)], payments: [pay('p112', 6, 36700, 'Cash')], status: 'Completed', ops: 'Delivered', team: 'Team C', schedule: ago(1), sales: 'Ana Noriega' },
  { no: 'ORD-000111', date: ago(8), customer: 'Edwin Aquino', phone: '0924 555 0111', address: 'Tiaong, Quezon', source: 'Facebook', items: [item('KC-RUN-32')], payments: [pay('p111a', 8, 20400, 'Maya QR'), pay('p111b', 1, 47600, 'COD')], status: 'Completed', ops: 'Installed', team: 'Team D', schedule: ago(1), sales: 'Ana Noriega' },
  { no: 'ORD-000110', date: ago(9), customer: 'Nina Castillo', phone: '0925 555 0110', address: 'Lucena City', source: 'Website', items: [item('SF-VLV-3S')], payments: [], status: 'Pending', ops: 'To Assign', sales: 'Ana Noriega' },
]

const JOBS: Job[] = [
  { id: 'JOB-0411', orderNo: 'ORD-000116', sku: 'SF-LSH-GL', name: 'Sala Set L-Shape — Grey Linen', qty: 1, workshop: 'GMA White', status: 'In Progress', created: ago(2), hours: 28, worker: 'Mang Boy' },
  { id: 'JOB-0410', orderNo: 'ORD-000115', sku: 'DN-6S-ACA', name: 'Dining Set 6-Seater — Acacia', qty: 1, workshop: 'LRT', status: 'Done', created: ago(3), hours: 34, worker: 'Kuya Jun' },
  { id: 'JOB-0409', orderNo: 'ORD-000111', sku: 'KC-RUN-32', name: 'Kitchen Cabinet Run 3.2m', qty: 1, workshop: 'GMA Original', status: 'QC Passed', created: ago(8), hours: 46, worker: 'Mang Rey' },
]

const LEDGER: Movement[] = [
  { id: 'LG-9001', at: ago(9) + ' 09:10', sku: 'MT-6075-8', type: 'WHS In', qtyIn: 10, qtyOut: 0, balance: 12, ref: 'PO-2026-031', by: 'Dennis Alcala' },
  { id: 'LG-9002', at: ago(6) + ' 14:22', sku: 'BD-BNK-PN', type: 'Order Release', qtyIn: 0, qtyOut: 1, balance: 5, ref: 'ORD-000112', by: 'system' },
  { id: 'LG-9003', at: ago(6) + ' 14:22', sku: 'MT-6075-8', type: 'Order Release', qtyIn: 0, qtyOut: 2, balance: 10, ref: 'ORD-000112', by: 'system' },
  { id: 'LG-9004', at: ago(3) + ' 16:05', sku: 'CH-ACC-RTN', type: 'WHS In', qtyIn: 4, qtyOut: 0, balance: 8, ref: 'JOB-0402', by: 'Dennis Alcala' },
  { id: 'LG-9005', at: ago(2) + ' 08:40', sku: 'KC-RUN-32', type: 'Workshop Out', qtyIn: 0, qtyOut: 1, balance: 0, ref: 'ORD-000111', by: 'system' },
  { id: 'LG-9006', at: ago(1) + ' 11:15', sku: 'TV-CON-18', type: 'Adjustment', qtyIn: 0, qtyOut: 1, balance: 4, ref: 'ADJ-0007 · scratched panel', by: 'Rowena Purificacion' },
]

const DELIVERIES: Delivery[] = [
  { orderNo: 'ORD-000114', team: 'Team B', date: ahead(1), status: 'Scheduled', cod: 0, driver: 'Jhun' },
  { orderNo: 'ORD-000113', team: 'Team A', date: ago(0), status: 'Out for Delivery', cod: 29120, driver: 'Boyet', eta: '2:36 PM' },
  { orderNo: 'ORD-000112', team: 'Team C', date: ago(1), status: 'Delivered', cod: 0, driver: 'Marlon', proof: true },
  { orderNo: 'ORD-000111', team: 'Team D', date: ago(1), status: 'Installed', cod: 47600, driver: 'Rey', proof: true },
]

const MTO: Mto[] = [
  { id: 'MTO-0042', at: ago(0) + ' 13:31', name: 'Grace Villanueva', item: 'Kitchen cabinet run + corner unit', dims: '4.1 m × 0.6 m · white duco', budget: 85000, source: 'Facebook', status: 'New' },
  { id: 'MTO-0041', at: ago(1) + ' 19:02', name: 'Mark Domingo', item: 'Bookshelf wall unit', dims: '2.4 m W × 2.1 m H · oak', budget: 32000, source: 'Website', status: 'Quoted' },
  { id: 'MTO-0040', at: ago(3) + ' 10:47', name: 'Jenny dela Cruz', item: 'Sala set L-shape', dims: '2.8 m × 1.8 m · grey linen', budget: 50000, source: 'Facebook', status: 'Converted' },
]

const EMPLOYEES: Employee[] = [
  { id: 'E-001', name: 'Rowena Purificacion', role: 'Operations Manager', setup: 'Onsite', in: '07:52', status: 'Present' },
  { id: 'E-002', name: 'Ana Noriega', role: 'Sales & Service', setup: 'Onsite', in: '08:05', status: 'Present' },
  { id: 'E-003', name: 'Dennis Alcala', role: 'Warehouse', setup: 'Onsite', in: '07:45', status: 'Present' },
  { id: 'E-004', name: 'Mang Boy', role: 'Constructor · GMA White', setup: 'Onsite', in: '08:21', status: 'Late' },
  { id: 'E-005', name: 'Kuya Jun', role: 'Constructor · LRT', setup: 'Onsite', in: '07:58', status: 'Present' },
  { id: 'E-006', name: 'Mang Rey', role: 'Constructor · GMA Original', setup: 'Onsite', status: 'Day Off' },
  { id: 'E-007', name: 'Boyet', role: 'Driver · Team A', setup: 'Onsite', in: '07:30', status: 'Present' },
  { id: 'E-008', name: 'Liza Mercado', role: 'Human Resources', setup: 'Hybrid', in: '08:00', status: 'Present' },
  { id: 'E-009', name: 'Kim Reyes', role: 'Website & Marketing', setup: 'WFH', in: '09:02', status: 'Present' },
  { id: 'E-010', name: 'Jhun', role: 'Driver · Team B', setup: 'Onsite', status: 'Absent' },
]

const LOGS: Log[] = [
  { at: ago(0) + ' 13:31', who: 'FB AI Agent', action: 'Created MTO request MTO-0042 from Messenger', module: 'MTO', ref: 'MTO-0042' },
  { at: ago(0) + ' 11:04', who: 'Boyet (Team A)', action: 'Started delivery route · 3 stops', module: 'Delivery', ref: 'ORD-000113' },
  { at: ago(1) + ' 16:40', who: 'Rey (Team D)', action: 'Installation confirmed · COD ₱47,600 collected', module: 'Installation', ref: 'ORD-000111' },
  { at: ago(1) + ' 11:15', who: 'Rowena Purificacion', action: 'Posted adjustment −1 TV-CON-18 (scratched panel)', module: 'Inventory', ref: 'ADJ-0007' },
  { at: ago(1) + ' 10:20', who: 'system', action: 'Maya payment confirmed ₱15,270 · receipt emailed', module: 'Payments', ref: 'ORD-000118' },
]

export const initialState = (): State => ({ role: null, path: '/hr/overall', products: PRODUCTS, orders: ORDERS, jobs: JOBS, ledger: LEDGER, deliveries: DELIVERIES, mto: MTO, logs: LOGS, employees: EMPLOYEES, seq: 119 })

type Action =
  | { type: 'login'; role: Role } | { type: 'logout' } | { type: 'nav'; path: string } | { type: 'reset' }
  | { type: 'createOrder'; order: Omit<Order, 'no' | 'status' | 'ops' | 'payments'>; payment?: { amount: number; method: Payment['method'] } }
  | { type: 'addPayment'; no: string; amount: number; method: Payment['method'] }
  | { type: 'approve'; no: string; mode: 'workshop' | 'stock' }
  | { type: 'job'; id: string; status: Job['status']; worker?: string }
  | { type: 'qc'; id: string; pass: boolean }
  | { type: 'schedule'; no: string; team: Team; date: string }
  | { type: 'delivery'; no: string; status: Delivery['status'] }
  | { type: 'whsIn'; sku: string; qty: number; ref: string }
  | { type: 'mto'; id: string; status: Mto['status'] }
  | { type: 'clock'; id: string; kind: 'in' | 'out' }
  | { type: 'cancel'; no: string }

const who = (s: State) => (s.role ? USERS[s.role].name : 'system')
const log = (s: State, action: string, module: string, ref: string): Log[] => [{ at: now(), who: who(s), action, module, ref }, ...s.logs].slice(0, 200)
const statusFor = (o: Order): OrderStatus => { const t = orderTotal(o), p = orderPaid(o); return o.status === 'Cancelled' ? 'Cancelled' : p >= t ? 'Completed' : p >= t * DOWNPAYMENT ? 'Partial' : 'Pending' }

function post(s: State, sku: string, type: Movement['type'], qtyIn: number, qtyOut: number, ref: string): State {
  const products = s.products.map((p) => (p.sku === sku ? { ...p, onHand: p.onHand + qtyIn - qtyOut } : p))
  const bal = products.find((p) => p.sku === sku)!.onHand
  const mv: Movement = { id: 'LG-' + (9100 + s.ledger.length), at: now(), sku, type, qtyIn, qtyOut, balance: bal, ref, by: who(s) }
  return { ...s, products, ledger: [mv, ...s.ledger] }
}
function reserve(s: State, o: Order, sign: 1 | -1): State {
  const products = s.products.map((p) => { const it = o.items.find((i) => i.sku === p.sku && !i.mto); return it ? { ...p, reserved: Math.max(0, p.reserved + sign * it.qty) } : p })
  return { ...s, products }
}

export function reducer(s: State, a: Action): State {
  switch (a.type) {
    case 'login': { const home = a.role === 'administrator' ? '/hr/overall' : a.role === 'operations_manager' ? '/operations/approval' : a.role === 'sales_staff' ? '/orders' : a.role === 'warehouse_staff' ? '/inventory' : a.role === 'human_resources' ? '/hr/attendance' : a.role.startsWith('delivery') ? '/delivery/routes' : '/workshop/jobs'; return { ...s, role: a.role, path: home } }
    case 'logout': return { ...s, role: null }
    case 'nav': return { ...s, path: a.path }
    case 'reset': return { ...initialState(), role: s.role, path: s.path }
    case 'createOrder': {
      const no = 'ORD-' + String(s.seq).padStart(6, '0')
      let o: Order = { ...a.order, no, payments: [], status: 'Pending', ops: 'To Assign' }
      if (a.payment && a.payment.amount > 0) o.payments = [{ id: 'p' + s.seq, at: now(), amount: a.payment.amount, method: a.payment.method, ref: (a.payment.method.startsWith('Maya') ? 'MAYA-' : 'OR-') + s.seq }]
      o = { ...o, status: statusFor(o) }
      let st: State = { ...s, seq: s.seq + 1, orders: [o, ...s.orders] }
      if (o.status !== 'Pending') st = reserve(st, o, 1)
      st.logs = log(st, `Created sales order ${no} · ${peso(orderTotal(o))}${o.status !== 'Pending' ? ' · 30% downpayment met, stock reserved' : ' · awaiting downpayment'}`, 'Orders', no)
      return st
    }
    case 'addPayment': {
      let st = s
      const orders = s.orders.map((o) => {
        if (o.no !== a.no) return o
        const p: Payment = { id: 'p' + Date.now(), at: now(), amount: a.amount, method: a.method, ref: (a.method.startsWith('Maya') ? 'MAYA-' : a.method === 'COD' ? 'COD-' : 'OR-') + Math.floor(Math.random() * 90000 + 10000) }
        const wasPending = o.status === 'Pending'
        const n = { ...o, payments: [...o.payments, p] }; n.status = statusFor(n)
        if (wasPending && n.status !== 'Pending') st = reserve(st, n, 1)
        return n
      })
      const o = orders.find((x) => x.no === a.no)!
      return { ...st, orders, logs: log(st, `Payment ${peso(a.amount)} via ${a.method} on ${a.no} · now ${o.status}${o.status === 'Completed' ? ' · BIR receipt emailed' : ''}`, 'Payments', a.no) }
    }
    case 'approve': {
      const o = s.orders.find((x) => x.no === a.no)!
      let st: State = s
      let jobs = s.jobs
      if (a.mode === 'workshop') {
        const mtoItems = o.items.filter((i) => i.mto || s.products.find((p) => p.sku === i.sku)!.onHand - s.products.find((p) => p.sku === i.sku)!.reserved < 0)
        const src = mtoItems.length ? mtoItems : o.items
        jobs = [...src.map((i, k) => ({ id: 'JOB-' + String(412 + s.jobs.length + k).padStart(4, '0'), orderNo: o.no, sku: i.sku, name: i.name, qty: i.qty, workshop: i.workshop, status: 'Pending' as const, created: now(), hours: 0 })), ...s.jobs]
      } else {
        for (const i of o.items) st = post(st, i.sku, 'Order Release', 0, i.qty, o.no)
        st = reserve(st, o, -1)
      }
      const orders = st.orders.map((x) => (x.no === a.no ? { ...x, ops: a.mode === 'workshop' ? 'Workshop' as const : 'Ready' as const } : x))
      return { ...st, orders, jobs, logs: log(st, a.mode === 'workshop' ? `Approved ${a.no} · assigned to workshop` : `Approved ${a.no} · skip workshop, released from warehouse stock`, 'Operations', a.no) }
    }
    case 'job': {
      const jobs = s.jobs.map((j) => (j.id === a.id ? { ...j, status: a.status, worker: a.worker ?? j.worker, hours: a.status === 'Done' ? Math.max(j.hours, 6 + Math.floor(Math.random() * 30)) : j.hours } : j))
      const j = jobs.find((x) => x.id === a.id)!
      const allDone = jobs.filter((x) => x.orderNo === j.orderNo).every((x) => x.status === 'Done' || x.status === 'QC Passed')
      const orders = a.status === 'Done' && allDone ? s.orders.map((o) => (o.no === j.orderNo ? { ...o, ops: 'QC' as const } : o)) : s.orders
      return { ...s, jobs, orders, logs: log(s, `${j.id} ${a.status.toLowerCase()}${a.worker ? ' · ' + a.worker : ''}${a.status === 'Done' ? ' · declared for QC' : ''}`, 'Workshop', j.id) }
    }
    case 'qc': {
      const j = s.jobs.find((x) => x.id === a.id)!
      let st: State = s
      const jobs = s.jobs.map((x) => (x.id === a.id ? { ...x, status: a.pass ? 'QC Passed' as const : 'QC Failed' as const } : x))
      let orders = s.orders
      if (a.pass) {
        st = post(st, j.sku, 'WHS In', j.qty, 0, j.id)
        st = post(st, j.sku, 'Order Release', 0, j.qty, j.orderNo)
        const allPassed = jobs.filter((x) => x.orderNo === j.orderNo).every((x) => x.status === 'QC Passed')
        if (allPassed) orders = st.orders.map((o) => (o.no === j.orderNo ? { ...o, ops: 'Ready' as const } : o))
      } else {
        orders = s.orders.map((o) => (o.no === j.orderNo ? { ...o, ops: 'Workshop' as const } : o))
      }
      return { ...st, jobs, orders, logs: log(st, a.pass ? `QC passed ${j.id} · received to warehouse and released to ${j.orderNo}` : `QC failed ${j.id} · sent back to ${j.workshop}`, 'Quality Control', j.id) }
    }
    case 'schedule': {
      const o = s.orders.find((x) => x.no === a.no)!
      const cod = Math.max(0, orderTotal(o) - orderPaid(o))
      const driver = { 'Team A': 'Boyet', 'Team B': 'Jhun', 'Team C': 'Marlon', 'Team D': 'Rey' }[a.team]
      const deliveries = [{ orderNo: a.no, team: a.team, date: a.date, status: 'Scheduled' as const, cod, driver }, ...s.deliveries.filter((d) => d.orderNo !== a.no)]
      const orders = s.orders.map((x) => (x.no === a.no ? { ...x, ops: 'Scheduled' as const, team: a.team, schedule: a.date } : x))
      return { ...s, deliveries, orders, logs: log(s, `Scheduled ${a.no} · ${a.team} · ${a.date} · out-for-delivery email queued (n8n)`, 'Delivery Queue', a.no) }
    }
    case 'delivery': {
      const deliveries = s.deliveries.map((d) => (d.orderNo === a.no ? { ...d, status: a.status, eta: a.status === 'Out for Delivery' ? '2:40 PM' : d.eta, proof: a.status === 'Delivered' || a.status === 'Installed' ? true : d.proof } : d))
      const d = deliveries.find((x) => x.orderNo === a.no)!
      let orders = s.orders.map((o) => (o.no === a.no ? { ...o, ops: a.status as OpsStatus } : o))
      let st: State = { ...s, deliveries, orders }
      if (a.status === 'Delivered' && d.cod > 0) {
        st = reducer(st, { type: 'addPayment', no: a.no, amount: d.cod, method: 'COD' })
        orders = st.orders
      }
      return { ...st, orders, logs: log(st, `${a.no} → ${a.status}${a.status === 'Delivered' && d.cod > 0 ? ` · COD ${peso(d.cod)} collected` : ''}${a.status === 'Installed' ? ' · warranty email sent' : ''}`, 'Delivery', a.no) }
    }
    case 'whsIn': { const st = post(s, a.sku, 'WHS In', a.qty, 0, a.ref); return { ...st, logs: log(st, `WHS In +${a.qty} ${a.sku} · ${a.ref}`, 'Inventory', a.ref) } }
    case 'mto': return { ...s, mto: s.mto.map((m) => (m.id === a.id ? { ...m, status: a.status } : m)), logs: log(s, `${a.id} → ${a.status}`, 'MTO', a.id) }
    case 'clock': { const t = new Date().toTimeString().slice(0, 5); return { ...s, employees: s.employees.map((e) => (e.id === a.id ? (a.kind === 'in' ? { ...e, in: t, status: t > '08:15' ? 'Late' : 'Present' } : { ...e, out: t }) : e)), logs: log(s, `Clock ${a.kind} · ${s.employees.find((e) => e.id === a.id)!.name}`, 'Attendance', a.id) } }
    case 'cancel': { const o = s.orders.find((x) => x.no === a.no)!; let st: State = o.status !== 'Pending' ? reserve(s, o, -1) : s; st = { ...st, orders: st.orders.map((x) => (x.no === a.no ? { ...x, status: 'Cancelled' as const } : x)) }; return { ...st, logs: log(st, `Cancelled ${a.no} · reservation released`, 'Orders', a.no) } }
  }
}

const KEY = 'pan-system-demo-v1'
const Ctx = createContext<{ s: State; d: (a: Action) => void } | null>(null)
export function PanProvider({ children }: { children: ReactNode }) {
  const [s, d] = useReducer(reducer, undefined, () => { try { const raw = localStorage.getItem(KEY); if (raw) { const p = JSON.parse(raw) as State; if (p && p.orders && p.seq) return { ...initialState(), ...p } } } catch { /* ignore */ } return initialState() })
  useEffect(() => { try { localStorage.setItem(KEY, JSON.stringify(s)) } catch { /* ignore */ } }, [s])
  const v = useMemo(() => ({ s, d }), [s])
  return <Ctx.Provider value={v}>{children}</Ctx.Provider>
}
export function usePan() { const c = useContext(Ctx); if (!c) throw new Error('PanProvider missing'); return c }
export type { Action }
