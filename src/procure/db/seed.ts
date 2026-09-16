/* Dummy data for the Northwind Motor Parts console. Row shapes follow what the copied pages/hooks select
   (forecast_report + its override tables, channel dashboards, forecast_channel_sales, forecast_sales_*
   views, forecast_instock_yearly, ads views, profiles). Product names/SKUs are invented. */
import { procureDb } from './store'
import { registerRpc } from '../../pan/db/fake-supabase'
import type { DemoDb } from '../../pan/db/store'
import { DEMO_PROFILE } from '../demo-user'

export const SEED_VERSION = '2026-09-12.7'

const rng = (seed: number) => { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296 } }
const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const dayIso = (n: number) => { const d = new Date(); d.setDate(d.getDate() - n); return iso(d) }
const round2 = (n: number) => Math.round(n * 100) / 100
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const MONTH_KEYS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']

/* ── catalogue ───────────────────────────────────────────────────────────────────────────── */
type Fam = { prefix: string; name: string; category: string; base: number; cost: number; colors: [string, string][]; factory: string; kit?: boolean }
const FAMILIES: Fam[] = [
  { prefix: 'BR1001', name: 'Apex Brake Pad Set (Front)', category: 'Brake System', base: 49, cost: 14, colors: [['CE', 'Ceramic'], ['SM', 'Semi-Metallic'], ['OE', 'OE Spec']], factory: 'RHB02' },
  { prefix: 'BR1002', name: 'Apex Brake Disc 260mm', category: 'Brake System', base: 89, cost: 26, colors: [['STD', 'Standard'], ['DR', 'Drilled'], ['SL', 'Slotted']], factory: 'RHB02' },
  { prefix: 'BR1003', name: 'Ridgeline Brake Master Cylinder', category: 'Brake System', base: 129, cost: 38, colors: [['LH', 'Left Hand'], ['RH', 'Right Hand']], factory: 'RHB02' },
  { prefix: 'FL2001', name: 'Kestrel Oil Filter', category: 'Filters', base: 14, cost: 3, colors: [['STD', 'Standard'], ['HD', 'Heavy Duty']], factory: 'KSF03' },
  { prefix: 'FL2002', name: 'Kestrel Air Filter Panel', category: 'Filters', base: 24, cost: 6, colors: [['STD', 'Standard'], ['PF', 'Performance']], factory: 'KSF03' },
  { prefix: 'FL2003', name: 'Kestrel Fuel Filter Inline', category: 'Filters', base: 19, cost: 5, colors: [['6MM', '6mm'], ['8MM', '8mm']], factory: 'KSF03' },
  { prefix: 'IG3001', name: 'Voltera Spark Plug (4pk)', category: 'Ignition', base: 32, cost: 9, colors: [['CU', 'Copper'], ['IR', 'Iridium'], ['PT', 'Platinum']], factory: 'VLE05', kit: true },
  { prefix: 'IG3002', name: 'Voltera Ignition Coil', category: 'Ignition', base: 74, cost: 22, colors: [['STD', 'Standard'], ['HP', 'High Output']], factory: 'VLE05' },
  { prefix: 'SU4001', name: 'Summit Rear Shock Absorber', category: 'Suspension', base: 119, cost: 36, colors: [['STD', 'Standard'], ['HD', 'Heavy Duty'], ['ADJ', 'Adjustable']], factory: 'SSW06' },
  { prefix: 'SU4002', name: 'Summit Front Fork Seal Kit', category: 'Suspension', base: 29, cost: 7, colors: [['41MM', '41mm'], ['43MM', '43mm']], factory: 'SSW06', kit: true },
  { prefix: 'SU4003', name: 'Summit Tie Rod End', category: 'Suspension', base: 39, cost: 11, colors: [['LH', 'Left Hand'], ['RH', 'Right Hand']], factory: 'SSW06' },
  { prefix: 'LT5001', name: 'Lumen LED Headlight Assembly', category: 'Lighting', base: 159, cost: 48, colors: [['CL', 'Clear Lens'], ['SM', 'Smoked Lens']], factory: 'VLE05' },
  { prefix: 'LT5002', name: 'Lumen LED Tail Light', category: 'Lighting', base: 59, cost: 17, colors: [['RD', 'Red Lens'], ['SM', 'Smoked Lens']], factory: 'VLE05' },
  { prefix: 'DR6001', name: 'Torqueline Drive Chain 520x120', category: 'Drivetrain', base: 69, cost: 21, colors: [['STD', 'Standard'], ['OR', 'O-Ring'], ['GD', 'Gold']], factory: 'TQL01' },
  { prefix: 'DR6002', name: 'Torqueline Sprocket Kit', category: 'Drivetrain', base: 99, cost: 30, colors: [['ST', 'Steel'], ['AL', 'Aluminium']], factory: 'TQL01', kit: true },
  { prefix: 'DR6003', name: 'Torqueline Clutch Plate Set', category: 'Drivetrain', base: 84, cost: 25, colors: [['STD', 'Standard'], ['HD', 'Heavy Duty']], factory: 'TQL01', kit: true },
  { prefix: 'CO7001', name: 'Ironbridge Radiator', category: 'Cooling', base: 189, cost: 58, colors: [['AL', 'Aluminium'], ['CU', 'Copper Core']], factory: 'IBC04' },
  { prefix: 'CO7002', name: 'Ironbridge Water Pump', category: 'Cooling', base: 79, cost: 24, colors: [['STD', 'Standard'], ['HF', 'High Flow']], factory: 'IBC04' },
  { prefix: 'EL8001', name: 'Voltera Battery 12V 7Ah', category: 'Electrical', base: 64, cost: 20, colors: [['AGM', 'AGM'], ['LI', 'Lithium']], factory: 'VLE05' },
  { prefix: 'EL8002', name: 'Voltera Alternator', category: 'Electrical', base: 219, cost: 68, colors: [['90A', '90 Amp'], ['120A', '120 Amp']], factory: 'VLE05' },
  { prefix: 'BD9001', name: 'Ridgeline Side Mirror Set', category: 'Body & Mirrors', base: 44, cost: 12, colors: [['BK', 'Black'], ['CR', 'Chrome']], factory: 'IBC04', kit: true },
  { prefix: 'BD9002', name: 'Ridgeline Handlebar Grip Pair', category: 'Body & Mirrors', base: 22, cost: 5, colors: [['BK', 'Black'], ['GY', 'Grey'], ['RD', 'Red']], factory: 'HAV07', kit: true },
  { prefix: 'BR1004', name: 'Redhawk Brake Caliper', category: 'Brake System', base: 139, cost: 42, colors: [['LH', 'Left Hand'], ['RH', 'Right Hand'], ['RD', 'Red Powder Coat']], factory: 'RHB02' },
  { prefix: 'BR1005', name: 'Apex Brake Line Kit', category: 'Brake System', base: 59, cost: 16, colors: [['SS', 'Stainless'], ['BK', 'Black Braided']], factory: 'RHB02', kit: true },
  { prefix: 'FL2004', name: 'Kestrel Cabin Filter', category: 'Filters', base: 19, cost: 5, colors: [['STD', 'Standard'], ['CH', 'Charcoal']], factory: 'KSF03' },
  { prefix: 'IG3003', name: 'Voltera Ignition Switch', category: 'Ignition', base: 39, cost: 11, colors: [['STD', 'Standard'], ['KEYD', 'Keyed Alike']], factory: 'VLE05' },
  { prefix: 'SU4004', name: 'Summit Control Arm', category: 'Suspension', base: 99, cost: 30, colors: [['LH', 'Left Hand'], ['RH', 'Right Hand']], factory: 'SSW06' },
  { prefix: 'SU4005', name: 'Axleworks Wheel Bearing', category: 'Suspension', base: 45, cost: 13, colors: [['FR', 'Front'], ['RR', 'Rear'], ['SLD', 'Sealed']], factory: 'AXL09' },
  { prefix: 'LT5003', name: 'Lumen Turn Signal Pair', category: 'Lighting', base: 34, cost: 9, colors: [['AMB', 'Amber'], ['SM', 'Smoked']], factory: 'LUM08', kit: true },
  { prefix: 'DR6004', name: 'Torqueline Timing Belt Kit', category: 'Drivetrain', base: 129, cost: 40, colors: [['STD', 'Standard'], ['WP', 'With Water Pump']], factory: 'TQL01', kit: true },
  { prefix: 'DR6005', name: 'Torqueline CV Joint', category: 'Drivetrain', base: 89, cost: 27, colors: [['IN', 'Inner'], ['OUT', 'Outer']], factory: 'TQL01' },
  { prefix: 'CO7003', name: 'Ironbridge Thermostat', category: 'Cooling', base: 24, cost: 6, colors: [['82C', '82°C'], ['88C', '88°C']], factory: 'IBC04' },
  { prefix: 'CO7004', name: 'Gasketline Head Gasket Set', category: 'Cooling', base: 74, cost: 22, colors: [['STD', 'Standard'], ['MLS', 'Multi-Layer Steel']], factory: 'GSK10', kit: true },
  { prefix: 'EL8003', name: 'Voltera Starter Motor', category: 'Electrical', base: 179, cost: 55, colors: [['STD', 'Standard'], ['HT', 'High Torque']], factory: 'VLE05' },
  { prefix: 'EL8004', name: 'Voltera Fuel Pump Assembly', category: 'Electrical', base: 119, cost: 36, colors: [['STD', 'Standard'], ['HP', 'High Pressure']], factory: 'VLE05' },
  { prefix: 'BD9003', name: 'Ridgeline Wiper Blade Set', category: 'Body & Mirrors', base: 18, cost: 4, colors: [['18IN', '18 in'], ['22IN', '22 in'], ['26IN', '26 in']], factory: 'HAV07', kit: true },
  { prefix: 'BD9004', name: 'Pistonhead Foot Peg Pair', category: 'Body & Mirrors', base: 49, cost: 14, colors: [['BK', 'Black'], ['SLV', 'Silver']], factory: 'PST12', kit: true },
]
const FACTORY: Record<string, { full: string; country: string; lead: number }> = {
  TQL01: { full: 'Torqueline Components', country: 'Taiwan', lead: 60 },
  RHB02: { full: 'Redhawk Brake Systems', country: 'India', lead: 55 },
  KSF03: { full: 'Kestrel Filtration', country: 'Thailand', lead: 70 },
  IBC04: { full: 'Ironbridge Castings', country: 'Turkey', lead: 65 },
  VLE05: { full: 'Voltera Electrics', country: 'Vietnam', lead: 50 },
  SSW06: { full: 'Summit Suspension Works', country: 'Mexico', lead: 45 },
  HAV07: { full: 'Havenmark Rubber & Trim', country: 'Malaysia', lead: 60 },
  LUM08: { full: 'Lumen Lighting Co.', country: 'Taiwan', lead: 55 },
  AXL09: { full: 'Axleworks Forge', country: 'India', lead: 65 },
  GSK10: { full: 'Gasketline Industries', country: 'Thailand', lead: 60 },
  PST12: { full: 'Pistonhead Machining', country: 'Mexico', lead: 50 },
}
const BUYERS = ['Rhea', 'Marco', 'Teo']
const ANALYSTS = ['Ivy', 'Noel']

type Product = { sku: string; name: string; color: string; category: string; factory: string; price: number; cost: number; kit: boolean; velocity: number; firstArrival: Date | null; established: boolean }

function buildProducts(): Product[] {
  const r = rng(91)
  const out: Product[] = []
  for (const f of FAMILIES) for (const [code, color] of f.colors) {
    const sku = `${f.prefix}-${code}`
    const vel = round2(0.3 + r() * (f.base > 1000 ? 2.5 : 9)) // units per day
    const roll = r()
    const ageDays = roll < 0.12 ? -1 : roll < 0.3 ? Math.floor(r() * 110) : 130 + Math.floor(r() * 900)
    const first = ageDays < 0 ? null : (() => { const d = new Date(); d.setDate(d.getDate() - ageDays); return d })()
    out.push({ sku, name: f.name, color, category: f.category, factory: f.factory, price: f.base, cost: f.cost, kit: !!f.kit, velocity: vel, firstArrival: first, established: ageDays >= 120 })
  }
  return out
}
export const PRODUCTS = buildProducts()

/* ── forecast_report row (the 111-column grid) ───────────────────────────────────────────── */
function forecastRow(p: Product, i: number, r: () => number) {
  const monthly = Math.round(p.velocity * 30)
  /* Calibrate on-hand so the planner tiers each get a fair share (Urgent / within 20 / 45 / 75 days / covered),
     using the same projection + supply math the app recomputes live (baseline option, no incoming in months 1-3). */
  const mProj = Math.round(monthly * (0.85 + r() * 0.4)), s6 = Math.round(monthly * (0.5 + r()))
  const nowD = new Date(), dim = new Date(nowD.getFullYear(), nowD.getMonth() + 1, 0).getDate(), rem = dim - nowD.getDate()
  const p1 = (mProj / 30) * rem, p2 = Math.ceil((mProj + s6) / 2), p3 = Math.ceil((mProj + p2) / 2), proj90c = p1 + p2 + p3
  // Tier rule in the app: deficit < 0 → Urgent; else days-of-supply − lead ≤ 20 / 45 / 75 → the three windows; else covered.
  const tier = i % 5
  const leadDays = tier === 1 ? 80 : tier === 2 ? 60 : tier === 3 ? 45 : tier === 4 ? 50 : FACTORY[p.factory].lead
  const dosTarget = tier === 1 ? 96 : tier === 2 ? 94 : tier === 3 ? 108 : 200
  const supply90t = tier === 0 ? proj90c * (0.2 + r() * 0.5) : dosTarget * proj90c / 90
  const oh = Math.max(0, Math.round((supply90t + 3 * p1 + 2 * p2 + p3) / 3))
  const otw = r() > 0.6 ? Math.round(monthly * (0.5 + r() * 2)) : 0
  const oo = r() > 0.55 ? Math.round(monthly * (1 + r() * 3)) : 0
  const monthsWorth = monthly > 0 ? round2((oh + otw) / monthly) : null
  const supplyStatus = monthsWorth == null ? 'No demand' : monthsWorth < 1 ? 'Critical' : monthsWorth < 2 ? 'Order now' : monthsWorth < 4 ? 'Healthy' : 'Overstock'
  const priority = monthsWorth == null ? 'Least Priority' : monthsWorth < 1 ? '1st Priority' : monthsWorth < 2 ? '2nd Priority' : monthsWorth < 3 ? '3rd Priority' : 'Least Priority'
  const status = p.firstArrival == null ? 'Discontinued' : r() > 0.08 ? 'Active' : 'Inactive'
  const inst = (k: number) => { if (p.firstArrival == null) return 0; const base = Math.min(100, Math.max(0, Math.round((oh > 0 ? 70 : 20) + (r() - 0.35) * 70 + k * 4))); return base }
  const row: Record<string, unknown> = {
    id: i + 1,
    sku: p.sku, description: `${p.name} ${p.color}`, priority_level: priority, factory: p.factory, status, pu_status: status === 'Active' ? 'Active' : status,
    shopify_status: p.firstArrival == null || i % 11 === 6 ? 'Not listed' : r() > 0.1 ? 'Active' : 'Draft', kit: p.kit ? 'Y' : 'N', item_color: p.color, category: p.category, shadow: r() > 0.9 ? 'Yes' : 'No',
    shopify_url: p.firstArrival == null ? null : `https://northwindparts.example/products/${p.sku.toLowerCase()}`, purchasing_url: `https://erp.example/products/${p.sku}`,
  }
  for (let k = 1; k <= 5; k++) row[`month_${k}`] = inst(k)
  Object.assign(row, {
    sales_diff: round2((r() - 0.5) * 60), unit_cost: p.cost, actual_sale_of_month: Math.round(monthly * 0.3 * (0.6 + r() * 0.8)), sales_velocity: p.velocity,
    monthly_projection: mProj, unshipped: Math.round(r() * 6), last_2months_avg: Math.round(monthly * (0.8 + r() * 0.5)),
  })
  for (let k = 0; k <= 12; k++) row[`sales_month_${k}`] = Math.round(monthly * (0.5 + r()) * (k === 0 ? 0.3 : 1))
  row.sales_month_6 = s6
  for (let k = 1; k <= 12; k++) row[`proj_month_${k}`] = Math.round(monthly * (0.85 + r() * 0.35))
  for (let k = 1; k <= 12; k++) row[`rev_month_${k}`] = Math.round((row[`proj_month_${k}`] as number) * p.price)
  row.total_revenue = Array.from({ length: 12 }, (_, k) => row[`rev_month_${k + 1}`] as number).reduce((a, b) => a + b, 0)
  for (let k = 1; k <= 12; k++) row[`lost_month_${k}`] = k <= 3 && monthsWorth != null && monthsWorth < 1.5 ? Math.round(monthly * p.price * (0.2 + r() * 0.5)) : 0
  row.total_lost_revenue = Array.from({ length: 12 }, (_, k) => row[`lost_month_${k + 1}`] as number).reduce((a, b) => a + b, 0)
  for (let k = 1; k <= 12; k++) row[`incoming_month_${k}`] = k >= 4 && k <= 6 && (otw + oo) > 0 && r() > 0.45 ? Math.round((otw + oo) * (0.3 + r() * 0.5)) : 0
  Object.assign(row, {
    unsent_notifications_count: r() > 0.8 ? Math.round(r() * 12) : 0, quantity_required: r() > 0.7 ? Math.round(monthly * 2) : 0, back_unit_price: p.price,
    fba_reserved: 0, intransit_fba: 0, fba: 0, oh_inv: oh, otw_units: otw, on_order_units: oo, po_in_progress: r() > 0.7 ? Math.round(monthly * 2) : 0,
  })
  const breakdown = [30, 60, 90, 120, 150, 180, 210]
  let cum = 0
  for (const d of breakdown) { cum += d <= 90 ? Math.round(oo * 0.3 * r()) : 0; row[`oo_units_${d}days`] = Math.min(oo, cum) }
  const proj90 = Math.round(monthly * 3), supply90 = oh + otw + Math.round(oo * 0.6)
  Object.assign(row, {
    ninety_day_projection: proj90, ninety_day_supply: supply90, ninety_day_deficit: Math.max(0, proj90 - supply90), ninety_day_revenue_loss: Math.max(0, proj90 - supply90) * p.price,
    safety_stock: Math.round(monthly * 0.5), order_recommended: Math.max(0, Math.round(proj90 + monthly * 0.5 - supply90)), order_date_forecast: dayIso(-(7 + Math.floor(r() * 40))), supply_month_forecast: MONTHS[(8 + 3 + Math.floor(r() * 2)) % 12] + ' 2026',
    covered_months: monthsWorth, action: monthsWorth == null ? 'Review' : monthsWorth < 1 ? 'Order now' : monthsWorth < 2 ? 'Order soon' : 'Hold',
    replacement_rate: round2(r() * 4), return_rate: round2(r() * 6),
    sku_status: status, order_proposal_qty: r() > 0.6 ? Math.round(monthly * 2.5) : null, months_worth: monthsWorth, buyer_notes: r() > 0.75 ? ['Approved', 'Hold — check container space', 'Reduce to 40'][Math.floor(r() * 3)] : null,
    planner_notes: r() > 0.85 ? 'Confirm alloy batch with factory' : null, analyst_notes: r() > 0.85 ? 'Ship with PO-2026-0' + Math.floor(100 + r() * 60) : null, cbm: round2(0.08 + r() * 1.4),
    factory_latest_po_ordered: r() > 0.5 ? dayIso(Math.floor(r() * 90)) : null, po_number: r() > 0.5 ? 'PO-2026-0' + Math.floor(100 + r() * 90) : null, country: FACTORY[p.factory].country,
    lead_time: leadDays, buyer: BUYERS[i % 3], inventory_analyst: ANALYSTS[i % 2], total_cbm_approved: r() > 0.6 ? round2(2 + r() * 30) : null,
    order_date: r() > 0.5 ? dayIso(Math.floor(r() * 60)) : null, supplying_month: MONTHS[(9 + Math.floor(r() * 3)) % 12] + ' 2026', supply_month: MONTHS[(9 + Math.floor(r() * 3)) % 12] + ' 2026', supply_status: supplyStatus,
  })
  for (let k = 1; k <= 12; k++) row[`supply_month_${k}`] = Math.max(0, oh + otw + (row[`incoming_month_${Math.min(k, 12)}`] as number) - Math.round(monthly * k))
  Object.assign(row, { repl_fba_reserved: 0, repl_intransit_fba: 0, repl_fba: 0, repl_oh_inv: 0, repl_otw_units: 0, repl_on_order_units: r() > 0.8 ? Math.round(r() * 20) : 0, repl_po_in_progress: 0 })
  for (let k = 1; k <= 12; k++) row[`repl_month_${k}`] = 0
  row.replacement_sku = r() > 0.92 ? p.sku.replace(/-[^-]+$/, '-V2') : null
  row.created_at = '2025-11-02T03:15:00.000Z'; row.updated_at = new Date().toISOString(); row.refreshed_at = new Date().toISOString(); row.snapshot_id = 20260910
  return row
}

const dataType = (v: unknown) => (typeof v === 'number' ? 'numeric' : typeof v === 'boolean' ? 'boolean' : typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v) ? 'date' : 'text')

export function seedProcure(d: DemoDb) {
  const r = rng(2026)
  d.markCreatedAt('forecast_report', 'ads_shopify_orders_log', 'email_schedule_log', 'user_view_prefs', 'planner_filter_state', 'chat_threads', 'chat_messages', 'profiles')

  /* profiles / permissions */
  d.table('profiles').insert({ ...DEMO_PROFILE })
  d.table('profiles').insert({ id: 'u-rhea', email: 'rhea@northwindparts.example', full_name: 'Rhea Villanueva', role: 'manager', status: 'approved', country: null, countries: null, factories: null, created_at: '2025-02-01T00:00:00.000Z', avatar_url: null })
  d.table('profiles').insert({ id: 'u-marco', email: 'marco@northwindparts.example', full_name: 'Marco Reyes', role: 'user', status: 'approved', country: 'Vietnam', countries: ['Vietnam'], factories: ['TQL01', 'RHB02'], created_at: '2025-03-12T00:00:00.000Z', avatar_url: null })
  d.table('user_permissions'); d.table('user_view_prefs'); d.table('planner_filter_state'); d.table('user_presence')
  for (const t of ['chat_threads', 'chat_messages', 'chat_participants', 'email_schedule_log', 'shopify_email_schedule_log', 'email_factory_mapping']) d.table(t)
  d.table('email_schedule_config').insert({ id: 1, report_type: 'idp', enabled: true, recurrence_type: 'weekly', day_of_week: 2, time_of_day: '09:00', timezone: 'UTC', last_run_at: dayIso(2) + 'T14:00:00.000Z', next_run_at: dayIso(-5) + 'T14:00:00.000Z', run_count: 31, updated_at: new Date().toISOString(), created_at: '2025-11-02T00:00:00.000Z' })
  d.table('email_schedule_config').insert({ id: 2, report_type: 'shopify', enabled: false, recurrence_type: 'weekly', day_of_week: 4, time_of_day: '09:00', timezone: 'UTC', last_run_at: null, next_run_at: null, run_count: 0, updated_at: new Date().toISOString(), created_at: '2026-01-15T00:00:00.000Z' })
  ;[['rhea@northwindparts.example', 'TQL01'], ['rhea@northwindparts.example', 'RHB02'], ['marco@northwindparts.example', 'KSF03'], ['teo@northwindparts.example', 'IBC04'], ['teo@northwindparts.example', 'VLE05']].forEach(([email, factory], i) => d.table('email_factory_mapping').insert({ id: i + 1, email, factory, report_type: 'idp', created_at: '2025-11-02T00:00:00.000Z' }))
  for (let i = 0; i < 10; i++) d.table('email_schedule_log').insert({ id: i + 1, schedule_id: 1, executed_at: dayIso(2 + i * 7) + 'T14:00:12.000Z', status: i === 4 ? 'failed' : 'success', emails_sent: i === 4 ? 0 : 3, emails_failed: i === 4 ? 3 : 0, total_items: 140 + Math.floor(r() * 30) })

  /* factories */
  Object.entries(FACTORY).forEach(([short, f], i) => d.table('vendor_list').insert({ id: i + 1, factory: short, short_name: short, full_factory_name: f.full, country: f.country, lead_time: f.lead, contact: `${short.toLowerCase()}@factory.example`, status: 'Active' }))

  /* forecast_report + companions */
  const fr = d.table('forecast_report')
  PRODUCTS.forEach((p, i) => fr.insert(forecastRow(p, i, r)))

  PRODUCTS.forEach((p, i) => {
    d.table('forecast_main').insert({ id: i + 1, sku: p.sku, landed_cost: round2(p.cost * 1.25), product_name: `${p.name} ${p.color}`, factory: p.factory })
    d.table('catalog_products').insert({ id: i + 1, sku: p.sku, product_name: p.name, item_color: p.color, category: p.category })
    d.table('master_sku').insert({ id: i + 1, sku: p.sku, new_sku: p.sku })
    d.table('shopify_variant_mapping').insert({ id: i + 1, sku: p.sku, image_url_1: null, variant_id: 4400000000 + i, product_id: 8800000000 + Math.floor(i / 3) })
    d.table('inventory').insert({ id: i + 1, productid: p.sku, productname: `${p.name} ${p.color}`, product_name: `${p.name} ${p.color}`, image_updated_at: null, factory: p.factory, category: p.category })
    d.table('forecast_shopify_status').insert({ id: i + 1, forecast_sku: p.sku, status: p.firstArrival == null ? 'Not listed' : 'Active', shopify_link: p.firstArrival == null ? null : `https://northwindparts.example/products/${p.sku.toLowerCase()}` })
    if (i % 7 === 0) d.table('forecast_report_manual').insert({ id: i + 1, sku: p.sku, order_proposal_qty: Math.round(p.velocity * 60), buyer_notes: 'Approved', planner_notes: null, analyst_notes: null, monthly_projection: Math.round(p.velocity * 32), forecast_option: 2, updated_at: dayIso(3) + 'T02:00:00.000Z' })
    if (i % 9 === 0) d.table('forecast_report_status').insert({ id: i + 1, sku: p.sku, factory: p.factory, status: 'Active', kit: p.kit ? 'Y' : 'N', category: p.category, updated_at: dayIso(5) + 'T02:00:00.000Z' })
    if (i % 11 === 0) d.table('forecast_report_proj_override').insert({ id: i + 1, sku: p.sku, proj_month_1: Math.round(p.velocity * 35), proj_month_2: Math.round(p.velocity * 33), proj_month_3: null, updated_at: dayIso(4) + 'T02:00:00.000Z', updated_by: 'rhea@northwindparts.example' })
    if (i % 13 === 0) d.table('forecast_report_supply_override').insert({ id: i + 1, sku: p.sku, supply_month_1: Math.round(p.velocity * 80), supply_month_2: null, updated_at: dayIso(6) + 'T02:00:00.000Z', updated_by: 'marco@northwindparts.example' })
  })
  d.table('forecast_option_config').insert({ id: 1, key: 'default_option', num_value: 1, text_value: null })

  /* monthly_sale_view_auto: sales per calendar month, current year */
  const year = new Date().getFullYear(), curMonth = new Date().getMonth()
  PRODUCTS.forEach((p, i) => {
    const row: Record<string, unknown> = { id: i + 1, product_id: p.sku, sku: p.sku, product_name: `${p.name} ${p.color}`, sales_year: year }
    MONTH_KEYS.forEach((k, m) => { row[MONTHS[m].toLowerCase() === k ? k : k] = null })
    const full = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december']
    full.forEach((k, m) => { row[k] = m <= curMonth ? Math.round(p.velocity * 30 * (0.6 + r() * 0.8) * (m === curMonth ? 0.3 : 1)) : null })
    row.month_6 = row[full[curMonth]]
    d.table('monthly_sale_view_auto').insert(row)
  })

  /* channel dashboards + forecast_channel_sales */
  const labels = [0, 1, 2, 3, 4].map((k) => { const dt = new Date(); dt.setMonth(dt.getMonth() - k); return MONTHS[dt.getMonth()] })
  for (const [table, share] of [['amazon_dashboard', 0.35], ['website_dashboard', 0.45], ['other_channel_dashboard', 0.2]] as const) {
    const t = d.table(table)
    PRODUCTS.forEach((p, i) => {
      const monthly = p.velocity * 30 * share
      const fr0 = fr.rows[i]
      const row: Record<string, unknown> = { id: i + 1, sku: p.sku, product_name: `${p.name} ${p.color}`, factory: p.factory, kit: p.kit ? 'Yes' : 'No', shadow: fr0.shadow, category: p.category }
      for (let k = 1; k <= 5; k++) row[`instock_${k}`] = fr0[`month_${k}`]
      const stagnant = i % 9 === 4 // some SKUs with stock but no sales in the last two months → 'Flagged SKUs'
      for (let k = 1; k <= 5; k++) row[`sale_${k}`] = stagnant && k >= 4 ? 0 : Math.round(monthly * (0.6 + r() * 0.8) * (k === 5 ? 0.3 : 1))
      row.oh_inv = stagnant ? Math.max(Number(fr0.oh_inv) || 0, 40) : fr0.oh_inv; row.otw = fr0.otw_units; row.oo_unit = fr0.on_order_units
      t.insert(row)
    })
  }
  PRODUCTS.forEach((p, i) => {
    const row: Record<string, unknown> = { id: i + 1, sku: p.sku }
    for (const [prefix, share] of [['amz', 0.35], ['web', 0.45], ['oth', 0.2]] as const) for (let k = 0; k <= 5; k++) row[`${prefix}_month_${k}`] = i % 9 === 4 && k <= 1 ? 0 : Math.round(p.velocity * 30 * share * (0.6 + r() * 0.8) * (k === 0 ? 0.3 : 1))
    for (let k = 0; k <= 4; k++) row[`month_${k}_label`] = labels[k]
    d.table('forecast_channel_sales').insert(row)
  })

  /* forecast_instock_yearly — the Availability Score (2,100+ SKUs incl. history) */
  const iy = d.table('forecast_instock_yearly')
  const trendEst = [78, 80, 76, 71, 65, 57, 57, 49, 59], trendNew = [null, null, null, null, 90, 86, 90, 73, 76]
  let idn = 1
  const pushYear = (pid: string, y: number, first: Date | null, est: boolean, never: boolean) => {
    const row: Record<string, unknown> = { id: idn++, product_id: pid, year: y, first_arrival_date: first ? iso(first) : null, pulled_at: new Date().toISOString() }
    MONTH_KEYS.forEach((k, m) => {
      if (never) { row[k] = null; return }
      const inYear = y < year || (y === year && m <= curMonth)
      if (!inYear) { row[k] = null; return }
      if (first && (y < first.getFullYear() || (y === first.getFullYear() && m < first.getMonth()))) { row[k] = null; return }
      const base = y === year ? (est ? trendEst[m] ?? 60 : trendNew[m] ?? 85) : 70 + Math.round(r() * 20)
      row[k] = Math.max(0, Math.min(100, Math.round(base + (r() - 0.5) * 50)))
    })
    iy.insert(row)
  }
  const extra = 2000
  for (let i = 0; i < extra; i++) {
    const roll = r()
    const never = roll < 0.37, isNew = !never && roll < 0.44
    const ageDays = never ? 0 : isNew ? Math.floor(r() * 110) : 130 + Math.floor(r() * 1200)
    const first = never ? null : (() => { const dt = new Date(); dt.setDate(dt.getDate() - ageDays); return dt })()
    const pid = `${['BR', 'FL', 'IG', 'SU', 'LT', 'DR', 'EL'][i % 7]}${String(1000 + (i * 37) % 9000)}-${['STD', 'HD', 'PF', 'OE', 'CE', 'SM', 'LH', 'RH'][i % 8]}${i > 900 ? '-' + (i % 4 + 1) : ''}`
    pushYear(pid, year, first, !isNew, never)
    if (!never && ageDays > 300) pushYear(pid, year - 1, first, true, false)
  }
  PRODUCTS.forEach((p) => pushYear(p.sku, year, p.firstArrival, p.established, p.firstArrival == null))

  /* Channel Margin Console: summary cards + CM rows */
  const CHANNELS = ['Website', 'Marketplace A', 'Dropship Partner', 'Marketplace B', 'Amazon', 'Marketplace C', 'Other']
  const CH_W = [0.32, 0.18, 0.14, 0.1, 0.12, 0.09, 0.05]
  const today = new Date(); const tIso = iso(today)
  const y = new Date(today); y.setDate(y.getDate() - 1)
  const m1 = new Date(today.getFullYear(), today.getMonth(), 1), mEnd = new Date(today.getFullYear(), today.getMonth() + 1, 0)
  const lm1 = new Date(today.getFullYear(), today.getMonth() - 1, 1), lmEnd = new Date(today.getFullYear(), today.getMonth(), 0)
  const periods: { name: string; sort: number; from: string; to: string; days: number }[] = [
    { name: 'Today', sort: 1, from: tIso, to: tIso, days: 1 },
    { name: 'Yesterday', sort: 2, from: iso(y), to: iso(y), days: 1 },
    { name: 'Month to date', sort: 3, from: iso(m1), to: tIso, days: today.getDate() },
    { name: 'Last month', sort: 4, from: iso(lm1), to: iso(lmEnd), days: lmEnd.getDate() },
  ]
  for (let k = 2; k <= 5; k++) { const a = new Date(today.getFullYear(), today.getMonth() - k, 1), b = new Date(today.getFullYear(), today.getMonth() - k + 1, 0); periods.push({ name: `${MONTHS[a.getMonth()] === 'Jul' ? 'July' : MONTHS[a.getMonth()] === 'Jun' ? 'June' : MONTHS[a.getMonth()] === 'Aug' ? 'August' : MONTHS[a.getMonth()] === 'May' ? 'May' : MONTHS[a.getMonth()] === 'Apr' ? 'April' : MONTHS[a.getMonth()] === 'Mar' ? 'March' : MONTHS[a.getMonth()]} ${a.getFullYear()}`, sort: k + 3, from: iso(a), to: iso(b), days: b.getDate() }) }
  const cm = d.table('forecast_sales_cm'), an = d.table('forecast_sales_analytics')
  const top = PRODUCTS.filter((p) => p.firstArrival != null).slice(0, 60)
  const totals: Record<string, { orders: number; units: number; sales: number; cogs: number; gp: number; ship: number; net: number; returns: number }> = {}
  let cmId = 1
  for (const per of periods) {
    const t = { orders: 0, units: 0, sales: 0, cogs: 0, gp: 0, ship: 0, net: 0, returns: 0 }
    top.forEach((p, pi) => {
      CHANNELS.forEach((ch, ci) => {
        if ((pi + ci) % 3 === 0 && per.days === 1) return
        const units = Math.max(0, Math.round(p.velocity * per.days * CH_W[ci] * 7 * (0.5 + r())))
        if (!units) return
        const orders = Math.max(1, Math.round(units * (0.8 + r() * 0.2)))
        const sales = round2(units * p.price * (0.88 + r() * 0.1))
        const landed = round2(p.cost * 1.25), landedTotal = round2(landed * units)
        const shipRev = round2(units * 12 * r()), carrier = round2(units * (p.price > 800 ? 95 : 28) * (0.8 + r() * 0.4))
        const commission = round2(sales * (ch === 'Website' ? 0 : ch === 'Amazon' ? 0.15 : 0.12)), shopifyPct = ch === 'Website' ? 2.5 : 0, shopifyFee = round2(sales * shopifyPct / 100)
        const returnsAllow = round2(sales * 0.05), opex = round2(sales * 0.05), fulfillment = round2(units * 5), marketing = round2(sales * 0.18)
        const cm1 = round2(sales + shipRev - landedTotal - carrier - commission - shopifyFee - returnsAllow)
        const cm2 = round2(cm1 - opex - fulfillment), cm3 = round2(cm2 - marketing)
        const returnedQty = r() > 0.85 ? Math.max(0, Math.round(units * 0.03)) : 0
        const cogs = round2(p.cost * units), gp = round2(sales - cogs), net = round2(gp - carrier - commission - shopifyFee)
        cm.insert({ id: cmId++, period: per.name, period_sort: per.sort, period_from: per.from, period_to: per.to, sku: p.sku, channel: ch, orders, units, sales, landed_cogs_per_unit: landed, landed_cogs_total: landedTotal, shipping_revenue: shipRev, carrier_cost: carrier, channel_commission: commission, shopify_pct: shopifyPct, shopify_fee: shopifyFee, returns_allowance: returnsAllow, opex, fulfillment, marketing, avg_cost_cogs: p.cost, cm1, cm2, cm3, cm1_pct: round2(cm1 / sales * 100), cm2_pct: round2(cm2 / sales * 100), cm3_pct: round2(cm3 / sales * 100), cm1_full: cm1, cm2_full: cm2, cm3_full: cm3, cm1_full_pct: round2(cm1 / sales * 100), cm3_full_pct: round2(cm3 / sales * 100) })
        an.insert({ period: per.name, sku: p.sku, channel: ch, period_sort: per.sort, returned_qty: returnedQty, cogs, gross_profit: gp, net_profit: net, margin_pct: round2(net / sales * 100) })
        t.orders += orders; t.units += units; t.sales += sales; t.cogs += cogs; t.gp += gp; t.ship += carrier; t.net += net; t.returns += returnedQty
      })
    })
    totals[per.name] = t
  }
  const card = (name: string, sort: number, per: string, isForecast = false, scale = 1, from?: string, to?: string) => {
    const t = totals[per]
    const prev = totals[sort === 1 ? 'Yesterday' : sort === 2 ? 'Month to date' : 'Last month']
    const sales = round2(t.sales * scale), net = round2(t.net * scale)
    d.table('forecast_sales_summary').insert({ card: name, card_sort: sort, period_from: from ?? periods.find((p) => p.name === per)!.from, period_to: to ?? periods.find((p) => p.name === per)!.to, is_forecast: isForecast, orders: Math.round(t.orders * scale), units: Math.round(t.units * scale), returns: Math.round(t.returns * scale), sales, cogs: round2(t.cogs * scale), gross_profit: round2(t.gp * scale), shipping_cost: round2(t.ship * scale), net_profit: net, margin_pct: round2(net / sales * 100), sales_vs_prev_pct: prev ? round2((sales - prev.sales) / prev.sales * 100) : null, net_vs_prev_pct: prev ? round2((net - prev.net) / prev.net * 100) : null, pulled_at: new Date().toISOString() })
  }
  card('Today', 1, 'Today'); card('Yesterday', 2, 'Yesterday'); card('Month to date', 3, 'Month to date')
  card('This month (forecast)', 4, 'Month to date', true, mEnd.getDate() / today.getDate(), iso(m1), iso(mEnd)); card('Last month', 5, 'Last month')
  ;[['returns_pct', 5, null], ['opex_pct', 5, null], ['fulfillment_value', 5, null], ['fulfillment_mode', null, 'per_unit'], ['marketing_pct', 18, null], ['shopify_override_pct', null, null]].forEach(([key, num, text], i) => d.table('forecast_cm_config').insert({ id: i + 1, key, num_value: num, text_value: text, updated_at: dayIso(30) }))
  d.table('forecast_cm_shopify_rate').insert({ id: 1, effective_from: '2025-01-01', rate_pct: 3, created_at: '2025-01-01T00:00:00.000Z' })
  d.table('forecast_cm_shopify_rate').insert({ id: 2, effective_from: '2026-03-01', rate_pct: 3, created_at: '2026-03-01T00:00:00.000Z' })

  /* Dashboard: daily new-orders / shipped revenue, window KPIs, recent RMAs, order tracker lines */
  const od = d.table('dashboard_orders_daily'), sd = d.table('dashboard_shipped_daily'), ot = d.table('forecast_order_tracker')
  let orderId = 118400, winOrders: Record<string, number> = { today: 0, '7d': 0, '15d': 0, '31d': 0, '4m': 0, '6m': 0, '12m': 0 }, winShipped: Record<string, number> = { ...winOrders }
  /* 24 months of daily aggregates so every range option (24h … 12 months) has data */
  for (let k = 730; k >= 0; k--) {
    const dt = new Date(); dt.setDate(dt.getDate() - k)
    const season = 1 + 0.18 * Math.sin(((dt.getMonth() + 1) / 12) * Math.PI * 2 - 1.2) + (dt.getMonth() === 10 ? 0.35 : 0) // Q4 lift
    const spike = k === 2 ? 3.2 : k === 1 ? 1.4 : k % 97 === 0 ? 2.1 : 1
    const rev = Math.round((380000 + r() * 160000 + (dt.getDay() === 0 ? -120000 : 0)) * spike * season)
    const shipped = Math.round((k === 28 ? 2.6 : k === 24 ? 1.9 : 0.55 + r() * 0.5) * 420000 * season)
    const oc = Math.round(rev / 640), sc = Math.round(shipped / 610)
    od.insert({ day: iso(dt), order_count: oc, total_qty: Math.round(oc * 1.4), revenue: rev })
    sd.insert({ day: iso(dt), shipped_count: sc, total_ship_qty: Math.round(sc * 1.4), shipped_revenue: shipped })
    for (const [key, days] of [['today', 0], ['7d', 6], ['15d', 14], ['31d', 30], ['4m', 120], ['6m', 180], ['12m', 365]] as const) if (k <= days) { winOrders[key] += rev; winShipped[key] += shipped }
    if (k <= 40) {
      const lines = 3 + Math.floor(r() * 4)
      for (let l = 0; l < lines; l++) { const p = top[Math.floor(r() * top.length)]; const qty = 1 + Math.floor(r() * 3); ot.insert({ order_id: orderId++, time_of_order: iso(dt) + `T${String(8 + Math.floor(r() * 12)).padStart(2, '0')}:${String(Math.floor(r() * 60)).padStart(2, '0')}:00.000Z`, qty, line_total: round2(qty * p.price), sku: p.sku }) }
    }
  }
  for (const key of Object.keys(winOrders)) {
    d.table('dashboard_orders_windows').insert({ window: key, revenue: winOrders[key], order_count: Math.round(winOrders[key] / 640), total_qty: Math.round(winOrders[key] / 640 * 1.4) })
    d.table('dashboard_shipped_windows').insert({ window: key, shipped_revenue: winShipped[key], shipped_count: Math.round(winShipped[key] / 610), total_ship_qty: Math.round(winShipped[key] / 610 * 1.4) })
    d.table('dashboard_kpis_windows').insert({ range_key: key, orders_grand_total: winOrders[key], shipped_grand_total: winShipped[key], profit: round2(winShipped[key] * 0.31), margin: 31 })
  }
  ;[['BR1001-CE', 'Amazon', 'Received', 'received'], ['FL2001-STD', 'Marketplace A', 'Pending', 'in transit'], ['LT5001-CL', 'Website', 'Refunded', 'received'], ['SU4001-HD', 'Marketplace B', 'Pending', 'awaiting'], ['DR6002-ST', 'Website', 'Replacement sent', 'received']].forEach((x, i) => d.table('dashboard_rma').insert({ id: 9120 - i, product_id: x[0], marketplace: x[1], status: x[2], received_status: x[3], created_at: dayIso(i * 2) }))

  /* Inventory: shipping containers, incoming-shipment view, inventory arrivals, purchase orders */
  const WAREHOUSE = 'Cedar Point Parts Depot'
  const addDays = (base: Date, n: number) => { const x = new Date(base); x.setDate(x.getDate() + n); return x }
  const poRows: { po: number; vendor: string; requested: Date; expected: Date; received: Date | null; status: string }[] = []
  for (let k = 0; k < 28; k++) {
    const requested = addDays(new Date(), -(4 + k * 9))
    const lead = 120 + Math.floor(r() * 60)
    const expected = addDays(requested, lead)
    const done = expected < new Date()
    const status = done ? (r() > 0.2 ? 'Received' : 'Partial') : expected < addDays(new Date(), 14) && r() > 0.6 ? 'Overdue' : 'Pending'
    poRows.push({ po: 9544 - k, vendor: ['TQL01', 'RHB02', 'KSF03', 'IBC04', 'VLE05'][k % 5], requested, expected, received: status === 'Received' || status === 'Partial' ? addDays(expected, -3 + Math.floor(r() * 10)) : null, status })
  }
  const fpo = d.table('forecast_purchase_orders'); let fpoId = 1
  poRows.forEach((po) => {
    const n = 3 + Math.floor(r() * 6)
    for (let l = 0; l < n; l++) {
      const p = PRODUCTS[(po.po * 7 + l * 13) % PRODUCTS.length]
      const qty = [100, 150, 190, 200, 350, 400][Math.floor(r() * 6)]
      const recv = po.status === 'Received' ? qty : po.status === 'Partial' ? Math.round(qty * (0.3 + r() * 0.5)) : 0
      fpo.insert({ id: fpoId++, vendor: po.vendor, po_number: po.po, product_id: p.sku, item_name: p.name, item_color: p.color, unit_cost: round2(p.cost * (0.9 + r() * 0.3)), requested_on: iso(po.requested), expected_delivery: iso(po.expected), received_date: po.received ? iso(po.received) : null, quantity_ordered: qty, quantity_received: recv, delivery_status: po.status, pulled_at: new Date().toISOString() })
    }
  })
  const cont = d.table('container'); let contId = 9463, invNo = 26043
  const openPos = poRows.filter((po) => po.status !== 'Received').slice(0, 14)
  openPos.forEach((po, ci) => {
    const name = ['TRHU', 'YMMU', 'TCNU', 'TCLU', 'MSKU', 'CMAU', 'OOLU'][ci % 7] + String(5933311 + ci * 40877)
    const shipped = addDays(po.expected, -55), eta = addDays(shipped, 21), est = addDays(eta, 30)
    const lines = fpo.rows.filter((x) => x.po_number === po.po)
    lines.forEach((ln, li) => cont.insert({ id: contId * 10 + li, container_id: contId, po_id: po.po, container_name: name + (li > 0 && r() > 0.7 ? ' Parts' : ''), shipped_on: iso(shipped), eta_port: iso(eta), estimated_arrival_date: iso(est), received_date: po.received ? iso(po.received) : null, invoice_number: `WW-EM-${invNo}`, notes: `WW-EM-${invNo}/${name}${li ? '/C' + li : ''}`, product_id: ln.product_id, product_name: `${ln.item_name} in ${ln.item_color}`, receiving_warehouse: WAREHOUSE, qty: ln.quantity_ordered, qty_received: ln.quantity_received, vessel_number: ['ONE YSGNG60417400', 'MEDUR7234269', 'YMJAW490502382'][ci % 3], total_cost: round2(Number(ln.unit_cost) * Number(ln.quantity_ordered)), created_at: iso(shipped) + 'T08:00:00.000Z' }))
    contId -= 1 + Math.floor(r() * 3); invNo -= 1
  })
  const arr = d.table('dashboard_inventory_arrival'); let arrId = 1
  poRows.filter((po) => po.received).forEach((po) => {
    fpo.rows.filter((x) => x.po_number === po.po && Number(x.quantity_received) > 0).forEach((ln) => {
      const before = Math.round(-20 + r() * 80)
      arr.insert({ arrival_id: arrId++, id: po.po, date_ordered: iso(po.requested), warehouse_name: WAREHOUSE, vendor_name: po.vendor, product_id: ln.product_id, product_name: `${ln.item_name} in ${ln.item_color}`, adjusted_price: round2(Number(ln.unit_cost) * 4.2), received_on: po.received ? iso(po.received) : null, qty_received: ln.quantity_received, qty_before_receive: before, qty_after_receive: before + Number(ln.quantity_received) })
    })
  })
  const isv = d.table('incoming_shipment_view')
  const mLabels = Array.from({ length: 12 }, (_, k) => { const dt = new Date(); dt.setMonth(dt.getMonth() + k); return `${['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'][dt.getMonth()]} ${dt.getFullYear()}` })
  const bySkuIn = new Map<string, { pos: Set<number>; months: number[] }>()
  for (const ln of fpo.rows) {
    if (ln.delivery_status === 'Received') continue
    const exp = new Date(String(ln.expected_delivery)); const now = new Date()
    const mi = Math.max(0, (exp.getFullYear() - now.getFullYear()) * 12 + exp.getMonth() - now.getMonth())
    if (mi > 11) continue
    const e = bySkuIn.get(String(ln.product_id)) ?? { pos: new Set<number>(), months: Array(12).fill(0) as number[] }
    e.pos.add(Number(ln.po_number)); e.months[mi] += Number(ln.quantity_ordered) - Number(ln.quantity_received); bySkuIn.set(String(ln.product_id), e)
  }
  let isvId = 1
  for (const [sku, e] of bySkuIn) {
    const row: Record<string, unknown> = { id: isvId++, product_id: sku, po_numbers: [...e.pos].sort().join(' | ') }
    mLabels.forEach((lab, k) => { row[`month_${k + 1}_label`] = lab; row[`month_${k + 1}`] = e.months[k] || null })
    isv.insert(row)
  }

  /* Order dashboards: factories, shipping requests, invoice tracker, PO tracker (+ notes/comments) */
  const FACTORIES: [string, string, string, string][] = [
    ['TQL01', 'Torqueline Components', 'Torqueline', 'Taiwan'], ['RHB02', 'Redhawk Brake Systems', 'Redhawk', 'India'], ['KSF03', 'Kestrel Filtration', 'Kestrel', 'Thailand'],
    ['IBC04', 'Ironbridge Castings', 'Ironbridge', 'Turkey'], ['VLE05', 'Voltera Electrics', 'Voltera', 'Vietnam'], ['SSW06', 'Summit Suspension Works', 'Summit', 'Mexico'],
    ['HAV07', 'Havenmark Rubber & Trim', 'Havenmark', 'Malaysia'], ['LUM08', 'Lumen Lighting Co.', 'Lumen', 'Taiwan'], ['AXL09', 'Axleworks Forge', 'Axleworks', 'India'],
    ['GSK10', 'Gasketline Industries', 'Gasketline', 'Thailand'], ['BRG11', 'Bearingcraft Ltd.', 'Bearingcraft', 'Turkey'], ['PST12', 'Pistonhead Machining', 'Pistonhead', 'Mexico'],
  ]
  FACTORIES.forEach((f, i) => {
    d.table('vendor_directory').insert({ id: i + 1, factory_code: f[0], full_factory_name: f[1], factory_short_name: f[2], country_of_origin: f[3], status: 'Active' })
    d.table('forecast_factory').insert({ id: i + 1, factory_code: f[0], full_factory_name: f[1] })
  })
  const POLS = ['PORT ALPHA', 'PORT ALPHA', 'PORT BRAVO', 'PORT CHARLIE', 'PORT DELTA', 'PORT ECHO', 'PORT FOXTROT']
  const CARRIERS = ['CARA', 'CARB', 'CARC', 'CARD', 'CARE', 'CARF', 'CARG', 'CARH']
  const FORWARDERS = ['FWDA', 'FWDB', 'FWDC', 'FWDD', 'FWDE']
  const VESSELS = ['Halcyon Star 021E', 'Meridian Tower 007E', 'Blue Kestrel 033E', 'Aurora Bay E005', 'Pacific Ember 099E', 'Northwind Osaka 15N', 'Coral Jaguar 0HB2N', 'Silver Anita 532N', 'Ocean Forward 010E', 'Ruby Harbor 014E', 'Bari Sound 629N', 'Amber Reach E016']
  const yymmdd = (dt: Date) => iso(dt).slice(2).replace(/-/g, '')
  const mmdd = (dt: Date) => iso(dt).slice(5).replace(/-/g, '')
  const PACKING = 'data:image/svg+xml;utf8,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="160" height="200"><rect width="160" height="200" fill="#fff" stroke="#cbd5e1"/><text x="80" y="90" font-family="Arial" font-size="15" font-weight="700" text-anchor="middle" fill="#1e293b">BOOKING</text><text x="80" y="110" font-family="Arial" font-size="15" font-weight="700" text-anchor="middle" fill="#1e293b">REQUEST</text><text x="80" y="130" font-family="Arial" font-size="12" text-anchor="middle" fill="#64748b">Template</text></svg>')
  const inv = d.table('invoice_tracker'), sr = d.table('shipping_requests'), pot = d.table('po_tracker'), poExp = d.table('po_export')
  const today0 = new Date(); today0.setHours(0, 0, 0, 0)
  /* PO tracker mirrors the purchase orders seeded above (same PO numbers), plus older completed ones */
  const TEAM = ['Deposit Requested', 'Awaiting Quote', 'Confirmed', 'Draft — Quote Needed', 'On Hold']
  poRows.forEach((po, i) => {
    const lines = fpo.rows.filter((x) => x.po_number === po.po)
    const grand = round2(lines.reduce((a, x) => a + Number(x.unit_cost) * Number(x.quantity_ordered), 0))
    const fac = FACTORIES.find((f) => f[0] === po.vendor) ?? FACTORIES[0]
    const team = po.status === 'Received' ? 'Confirmed' : TEAM[i % TEAM.length]
    const pay = team === 'Confirmed' ? 'PAID' : team === 'Deposit Requested' ? 'Approval Requested' : null
    pot.insert({ id: po.po, po_number: po.po, vendor_name: po.vendor, vendor_id: 15100 + (i * 7) % 130, type: i % 6 === 5 ? 'Initial Order' : 'Repeat Order', status: po.status === 'Received' ? 'Completed' : 'Draft', team_status: team, priority: i % 9 === 0 ? 'High' : null,
      target_completion_date: team === 'Awaiting Quote' ? null : iso(addDays(po.expected, -45)), factory_list: po.vendor, country_of_origin: fac[3], of_products: lines.length, units: lines.reduce((a, x) => a + Number(x.quantity_ordered), 0),
      created_on: iso(po.requested), ordered_on: iso(po.requested), invoice_date: null, expected_delivery: iso(po.expected), received_date: po.received ? iso(po.received) : null, original_cargo_ready_date: iso(addDays(po.expected, -50)),
      ship: po.status === 'Received' ? 'Shipped' : po.status === 'Partial' ? 'Partly Shipped' : 'None', receive: po.status === 'Received' ? 'Received' : po.status === 'Partial' ? 'Partly Received' : 'None',
      payment_status_finance: pay, payment_approved_lead: pay != null, late_po: i % 11 === 0, pi_status: team === 'Awaiting Quote' ? 'Quote Requested' : 'Quote Received', pi_received_date: team === 'Awaiting Quote' ? null : iso(addDays(po.requested, 6)),
      vendor_pi: team === 'Awaiting Quote' ? null : `PI-${po.po}-${fac[2].slice(0, 3).toUpperCase()}`, vendor_invoice_number: null, payment_terms: '50% deposit / 50% before shipment', calculated_deposit_amount: round2(grand * 0.5), actual_deposit_amount: pay === 'PAID' ? round2(grand * 0.5) : null, deposit_percentage: 50,
      sub_total: grand, discount_total: 0, shipping_total: 0, other_total: 0, tax_total: 0, grand_total: grand, payment: pay === 'PAID' ? round2(grand * 0.5) : 0, balance: pay === 'PAID' ? round2(grand * 0.7) : grand, balance_not_received_goods: po.status === 'Received' ? 0 : grand,
      warehouse: WAREHOUSE, company_name: 'Northwind Motor Parts', po_created_by: ['Rhea Villanueva', 'Marco Reyes', 'Teo Santos'][i % 3], approved: pay === 'PAID', product_list: lines.map((x) => `${x.item_name} ${x.item_color}`).join(', '), product_sku_s: lines.map((x) => x.product_id).join(', '), number_of_container: Math.max(1, Math.round(lines.length / 3)),
      po_request_files: i % 3 === 0 ? [{ filename: `PO-${po.po}-request.pdf`, url: '#', type: 'application/pdf' }] : null, po_files: pay === 'PAID' ? [{ filename: `PO-${po.po}.pdf`, url: '#', type: 'application/pdf' }] : null, pi_file: pay === 'PAID' ? [{ filename: `PI-${po.po}.pdf`, url: '#', type: 'application/pdf' }] : null,
      po_link: null, shipping_requests: null, tenant_id: '00000000-0000-0000-0000-000000000001', created_at: iso(po.requested) + 'T09:00:00.000Z', updated_at: new Date().toISOString() })
    poExp.insert({ id: po.po, po_number: po.po, vendor: po.vendor, po_date: iso(po.requested), updated_at: new Date().toISOString() })
  })
  /* shipping requests: 14 weeks of cargo-ready dates, some booked (with invoice) and some waiting */
  const PROGRESS_BY_STAGE = ['Requested, In Review', 'Requested, In Review', 'Instructions Sent, Fully Approved', 'Carrier Released', 'In Transit', 'Delivered']
  let srId = 1, invId = 1
  for (let k = 0; k < 96; k++) {
    const fac = FACTORIES[(k * 5) % FACTORIES.length]
    const crd = addDays(today0, -70 + Math.floor(r() * 100)) // mostly the last 10 weeks, some ahead
    const req = addDays(crd, -(3 + Math.floor(r() * 12)))
    const daysOut = Math.round((crd.getTime() - today0.getTime()) / 86400000)
    const booked = daysOut < -14 ? r() > 0.08 : daysOut < 0 ? r() > 0.4 : r() > 0.75
    const stage = !booked ? (daysOut > 3 ? 0 : 1) : daysOut < -40 ? 5 : daysOut < -21 ? 4 : daysOut < -7 ? 3 : 2
    const cbm = round2(40 + r() * 50)
    const po = poRows[(k * 3) % poRows.length]
    const ref = [fac[0], yymmdd(req), 'CRD' + mmdd(crd), `${cbm}CBM`, ['CZ5', 'MVW', 'RC1', 'FFQ', '87G', 'H7C', 'Q8C', 'X11', 'XX8', 'OZH'][k % 10]].join('-')
    const carrier = booked ? CARRIERS[k % CARRIERS.length] : null
    const fwd = FORWARDERS[k % FORWARDERS.length]
    const bookingNo = booked ? `${['YMJAW', 'SSGNS', 'ONEYSGNGR', 'MEDUXP', 'GHLGB'][k % 5]}${490480000 + k * 3123}` : null
    let invoiceId: number | null = null
    if (booked && stage >= 2) {
      invoiceId = invId++
      const etd = addDays(crd, 4 + Math.floor(r() * 8)), atd = addDays(etd, Math.floor(r() * 12)), eta = addDays(atd, 22 + Math.floor(r() * 10)), ata = stage >= 4 ? addDays(eta, Math.floor(r() * 4)) : null
      const hc = 1 + Math.floor(r() * 5), rate = 2400 + Math.round(r() * 900), value = round2(hc * rate)
      const status = stage === 5 ? 'Receipt Sent, Documents Forwarded' : stage === 4 ? (r() > 0.5 ? 'Receipt Sent, Documents Forwarded' : 'Documents Received, Receipt Sent') : stage === 3 ? 'Carrier Confirmed, Customs Filed' : 'Booking Requested'
      const paid = stage === 5
      inv.insert({ id: invoiceId, hbl: bookingNo, mbl: `${bookingNo}`, booking_num: bookingNo, ddp: k % 5 === 0, invoice_status: status, shipping_requests: `${100000 + k}`, factory_account: fac[1], qc_team_account: 'QC Team', managment_team_account: 'Management', customer_service_account: 'CS',
        forwarder: fwd, arrival_notice: stage >= 4, freight_invoice: stage >= 3, telex_received: stage >= 4 ? 'Telex Rcvd' : null, vendor: fac[0], country_of_origin: fac[3] === 'Vietnam' ? 'VN' : fac[3] === 'China' ? 'CN' : 'IN', pol: POLS[k % POLS.length].split('/')[0].trim(), carrier,
        ata_pod: ata ? iso(ata) : null, eta_pod: iso(eta), atd: iso(atd), etd: iso(etd), vessel_name: VESSELS[k % VESSELS.length], hc_40_count: hc, payment_due: iso(addDays(atd, 30)), rate, purchase_order: String(po.po), shipment_invoice_number: `INV-${26000 + k}`,
        container_number: `${['TRHU', 'YMMU', 'TCNU', 'MSKU'][k % 4]}${5900000 + k * 1573}`, container_id: String(9400 + k), value, adjustment_amount: k % 7 === 0 ? -120 : 0, amount_due: paid ? 0 : value, unpaid: paid ? 0 : value, pmt_rq_date: stage >= 4 ? iso(addDays(atd, 3)) : null,
        pmt_status_finance: paid ? 'PAID' : stage >= 4 ? 'Approval Requested' : null, pmt_approved_lead: paid, paid: paid ? iso(addDays(atd, 12)) : null, pay_slip: paid ? [{ filename: `slip-${invoiceId}.pdf`, url: '#' }] : null, dx2fdr: stage >= 4, do_dispatch: stage >= 5, drayage: stage >= 5 ? 'Booked' : null,
        created: iso(req), estimated_total_freight: round2(value + 75 * hc), containers_linked_to_this_invoice: String(9400 + k), created_at: iso(req) + 'T10:00:00.000Z' })
    }
    sr.insert({ id: srId++, record_id: `rec${(100000 + k).toString(36).toUpperCase()}`, receipt_number: `${100000 + k}`, ref_calculated: ref, progress: PROGRESS_BY_STAGE[stage], vndr_copy: fac[0], factory_code: fac[0], factory_short_name: fac[2], full_factory_name: fac[1], factory_name_form: fac[1],
      date_requested: iso(req), qc_check_pass: booked || r() > 0.5 ? 'Yes' : 'No', inspection_date: iso(addDays(crd, -4)), new_inspection: null, cargo_ready_date: iso(crd), new_crd: k % 13 === 0 ? iso(addDays(crd, 5)) : null, cargo_volume_cbm: cbm, forty_ft_aprv: booked ? 1 + Math.floor(cbm / 60) : null,
      port_of_loading: POLS[k % POLS.length], pickup_location: null, packing_list: [{ filename: `packing-list-${100000 + k}.csv`, url: `/procure/files/packing-list-${100000 + k}.csv`, type: 'text/csv', thumbnail_url: PACKING }], packing_list_files: null,
      factory_notes: k % 3 === 0 ? `Final inspection forecast: ${new Date(addDays(crd, -4)).toLocaleDateString('en-US', { month: 'short', day: '2-digit', year: 'numeric' })}` : null, pos: `${po.po}${k % 4 ? '-' + (1 + (k % 4)) : ''}`, po_complete_date: iso(addDays(crd, -6)), invoice_number: `${po.po}${k % 4 ? '-' + (1 + (k % 4)) : ''}`,
      lead_approved: stage >= 2 ? 'Yes' : k % 5 === 0 ? 'Provisional' : null, qc_approved: stage >= 2 ? 'Yes' : null, qc_comment: null, planning_approval_status: stage >= 2 ? 'Completed' : 'Pending', planning_comment: null, late_fees: k % 17 === 0 ? 100 : null, late_fees_files: null,
      freight_forwarder: booked ? fwd : null, freight_carrier: carrier, etd: booked ? iso(addDays(crd, 5)) : null, bl_hbl_mbl_old: null, rate: booked ? 2400 + (k % 9) * 100 : null, pb_notes_old: null, booking_info_contact: booked ? ['ops@fwda.example', 'booking@fwdb.example', 'ops@fwdc.example'][k % 3] : null,
      cancellation_fee_agreement: true, invoice_tracker: invoiceId ? `INV-${26000 + k}` : null, invoice_tracker_id: invoiceId, booking_number: bookingNo, created_by: ['Rhea Villanueva', 'Marco Reyes', 'Teo Santos'][k % 3], created_at: iso(req) + 'T08:30:00.000Z' })
  }
  ;[['Notes', 'Factory confirmed inspection slot'], ['Reminders', 'Chase booking confirmation with forwarder'], ['Log', 'Sent booking instructions to forwarder']].forEach((n, i) => { d.table('shipping_request_notes').insert({ id: i + 1, request_id: 1 + i, note_type: n[0], content: n[1], note_date: null, created_by: 'Rhea Villanueva', author_id: 'u-rhea', created_at: dayIso(i + 1) + 'T09:00:00.000Z' }); d.table('po_notes').insert({ id: i + 1, po_id: poRows[i].po, note_type: n[0], content: n[1], created_by: 'Marco Reyes', author_id: 'u-marco', created_at: dayIso(i + 2) + 'T09:00:00.000Z' }) })
  d.table('invoice_comments').insert({ id: 1, invoice_id: 1, author_id: 'u-rhea', author_name: 'Rhea Villanueva', body: 'Slip sent to forwarder, waiting for DO.', mentioned_emails: null, created_at: dayIso(1) + 'T14:00:00.000Z' })
  d.table('shipping_request_comments').insert({ id: 1, request_id: 1, author_id: 'u-marco', author_name: 'Marco Reyes', body: 'QC report attached, please review.', mentioned_emails: null, created_at: dayIso(1) + 'T11:00:00.000Z' })
  d.table('po_comments').insert({ id: 1, po_id: poRows[0].po, author_id: 'demo-devops', author_name: 'Dev Ops', body: 'Deposit approved.', created_at: dayIso(2) + 'T15:00:00.000Z' })
  d.table('activity_logs')

  /* Storefront Stock page, Sales by Month, Availability by Month — a wider synthetic catalogue (~560 SKUs) */
  const ADJ = ['Apex', 'Ridgeline', 'Torqueline', 'Kestrel', 'Voltera', 'Summit', 'Ironbridge', 'Lumen', 'Axleworks', 'Gasketline', 'Bearingcraft', 'Pistonhead', 'Redhawk', 'Vortex', 'Granite', 'Falcon', 'Meridian', 'Onyx', 'Tundra', 'Cobalt', 'Sentinel', 'Nomad', 'Raptor', 'Helix', 'Zenith']
  const TYPES: [string, string, number][] = [['Brake Pad Set', 'BR', 49], ['Brake Disc', 'BR', 89], ['Brake Caliper', 'BR', 139], ['Oil Filter', 'FL', 14], ['Air Filter', 'FL', 24], ['Cabin Filter', 'FL', 19], ['Spark Plug Set', 'IG', 32], ['Ignition Coil', 'IG', 74], ['Shock Absorber', 'SU', 119], ['Control Arm', 'SU', 99], ['Wheel Bearing', 'SU', 45], ['LED Headlight', 'LT', 159], ['Tail Light', 'LT', 59], ['Drive Chain', 'DR', 69], ['Sprocket Kit', 'DR', 99], ['Clutch Kit', 'DR', 149], ['Radiator', 'CO', 189], ['Water Pump', 'CO', 79], ['Battery 12V', 'EL', 64], ['Alternator', 'EL', 219], ['Starter Motor', 'EL', 179], ['Side Mirror Set', 'BD', 44], ['Wiper Blade Set', 'BD', 18], ['Timing Belt Kit', 'DR', 129]]
  const COLORS: [string, string][] = [['STD', 'Standard'], ['HD', 'Heavy Duty'], ['PF', 'Performance'], ['OE', 'OE Spec'], ['CE', 'Ceramic'], ['SM', 'Semi-Metallic'], ['LH', 'Left Hand'], ['RH', 'Right Hand'], ['BK', 'Black'], ['CR', 'Chrome']]
  type Wide = { sku: string; name: string; color: string; category: string; price: number; velocity: number; started: number }
  const WIDE: Wide[] = PRODUCTS.map((p) => ({ sku: p.sku, name: p.name, color: p.color, category: p.category, price: p.price, velocity: p.velocity, started: 0 }))
  let wi = 0
  while (WIDE.length < 560) {
    const t = TYPES[wi % TYPES.length], adj = ADJ[(wi * 7) % ADJ.length]
    const nColors = 1 + (wi % 4)
    for (let c = 0; c < nColors && WIDE.length < 560; c++) {
      const col = COLORS[(wi + c * 3) % COLORS.length]
      const sku = `${t[1]}${String(1000 + (wi * 13) % 8800)}-${col[0]}`
      if (WIDE.some((w) => w.sku === sku)) { wi++; continue }
      WIDE.push({ sku, name: `${adj} ${t[0]}`, color: col[1], category: t[0], price: Math.round(t[2] * (0.8 + r() * 0.5)), velocity: round2(0.1 + r() * (t[2] > 1000 ? 1.5 : 6)), started: Math.floor(r() * 30) })
    }
    wi++
  }
  WIDE.forEach((w, i) => { if (i >= PRODUCTS.length) d.table('inventory').insert({ id: 10000 + i, productid: w.sku, productname: `${w.name} ${w.color}`, product_name: `${w.name} ${w.color}`, image_updated_at: null, factory: Object.keys(FACTORY)[i % 5], category: w.category }) })
  const shop = d.table('shopify_store')
  WIDE.forEach((w, i) => {
    const monthly = Math.round(w.velocity * 30)
    const oh = Math.round(monthly * (-0.4 + r() * 3.5)), otw = r() > 0.55 ? Math.round(monthly * (0.5 + r() * 2)) : 0, oo = r() > 0.5 ? Math.round(monthly * (1 + r() * 3)) : 0
    const b30 = oo ? Math.round(oo * r() * 0.4) : 0, b60 = oo ? b30 + Math.round(oo * r() * 0.3) : 0, b90 = oo ? Math.min(oo, b60 + Math.round(oo * r() * 0.3)) : 0
    shop.insert({ id: i + 1, sku: w.sku, description: `${w.name} in ${w.color}`, oh_inv: oh, otw_units: otw, on_order_units: oo || null, po_in_progress: r() > 0.7 ? Math.round(monthly * 2) : 0, oo_units_30days: b30 || null, oo_units_60days: b60 || null, oo_units_90days: b90 || null, oo_units_120days: oo || null, price: w.price, barcode: String(8400000000000 + i * 7919), package: `${40 + (i % 5) * 10}x${50 + (i % 3) * 10}x${20 + (i % 4) * 10} cm`, product_weight: round2(4 + (w.price / 40)), weight_unit: 'kg' })
  })
  const msa = d.table('monthly_sale_all'), mra = d.table('monthly_revenue_all'), ipa = d.table('instock_percent_all')
  const M = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']
  let msaId = 1
  for (const yr of [year, year - 1, year - 2]) {
    WIDE.forEach((w) => {
      if (yr === year - 2 && w.started > 20) return
      const units: Record<string, unknown> = { id: msaId, product_id: w.sku, product_name: `${w.name} in ${w.color}`, year: yr }
      const rev: Record<string, unknown> = { id: msaId, product_id: w.sku, year: yr }
      const inst: Record<string, unknown> = { id: msaId++, year: yr, product_id: w.sku, product_name: `${w.name} in ${w.color}`, updated_at: new Date().toISOString() }
      M.forEach((m, mi) => {
        const future = yr === year && mi > curMonth
        const season = 1 + 0.2 * Math.sin((mi / 12) * Math.PI * 2 - 1.2) + (mi === 10 ? 0.4 : 0)
        const u = future ? null : Math.round(w.velocity * 11 * season * (0.6 + r() * 0.8) * (yr === year && mi === curMonth ? 0.3 : 1) * (yr === year - 2 ? 0.7 : 1))
        units[m] = u; rev[m] = u == null ? null : round2(u * w.price * (0.9 + r() * 0.15))
        inst[m] = future ? 0 : (r() > 0.18 ? 100 : Math.round(r() * 100))
      })
      msa.insert(units); mra.insert(rev); ipa.insert(inst)
    })
  }

  /* Ad Spend vs Revenue */
  const roas = d.table('v_blended_roas')
  for (let k = 95; k >= 0; k--) {
    const dt = new Date(); dt.setDate(dt.getDate() - k)
    const spend = round2(1400 + r() * 900 + (dt.getDay() === 0 || dt.getDay() === 6 ? -300 : 0))
    const sales = round2(spend * (2.6 + r() * 1.8))
    roas.insert({ date: iso(dt), shopify_sales: sales, total_ad_spend: spend, blended_roas: round2(sales / spend), shopify_orders: Math.round(sales / 640), meta_spend: round2(spend * 0.55), google_spend: round2(spend * 0.35), tiktok_spend: round2(spend * 0.1) })
  }
  ;[['Meta Ads', 28490, 1424500, 42735, 1621], ['Google Ads', 20940, 1047000, 31410, 1199], ['TikTok Ads', 6120, 612000, 15300, 402], ['Pinterest Ads', 2380, 238000, 5950, 118]].forEach(([platform, spend, imp, clicks, conv]) => d.table('v_platform_performance').insert({ platform, total_spend: spend, total_impressions: imp, total_clicks: clicks, total_conversions: conv, avg_ctr: Math.round((clicks as number) / (imp as number) * 10000) / 10000, avg_cpc: round2((spend as number) / (clicks as number)), cost_per_conversion: round2((spend as number) / (conv as number)), roas: round2(((conv as number) * 610) / (spend as number)) }))
  const cats = [...new Set(PRODUCTS.map((p) => p.category))]
  cats.forEach((c, i) => { const rev = Math.round(180000 * (1 - i * 0.07) * (0.7 + r() * 0.5)); const orders = Math.round(rev / (300 + r() * 500)); d.table('ads_shopify_product_categories').insert({ id: i + 1, category: c, revenue: rev, units_sold: Math.round(orders * 1.4), unique_orders: orders, avg_revenue_per_order: round2(rev / orders) }) })
  const names = ['Avery Thompson', 'Jordan Blake', 'Casey Nguyen', 'Morgan Ellis', 'Riley Carter', 'Taylor Brooks', 'Sam Patel', 'Jamie Cruz', 'Drew Foster', 'Quinn Harper']
  for (let i = 0; i < 24; i++) {
    const p = top[(i * 5) % top.length], p2 = top[(i * 7 + 3) % top.length]
    const items = i % 3 === 0 ? [p, p2] : [p]
    const total = round2(items.reduce((a, x) => a + x.price, 0) * (0.9 + r() * 0.1))
    d.table('ads_shopify_orders_log').insert({ id: i + 1, shopify_order_id: String(6400001000 + i * 17), order_name: `#NW${10410 + i}`, created_at_shopify: dayIso(Math.floor(i / 2)) + `T${String(9 + (i % 12)).padStart(2, '0')}:${String((i * 13) % 60).padStart(2, '0')}:00.000Z`, total_price: total, financial_status: i % 9 === 4 ? 'refunded' : 'paid', fulfillment_status: i < 6 ? 'unfulfilled' : i % 5 === 0 ? 'partial' : 'fulfilled', customer_name: names[i % names.length], line_items_json: items.map((x) => ({ sku: x.sku, title: `${x.name} — ${x.color}`, quantity: 1, price: x.price })), utm_source: ['facebook', 'google', 'tiktok', 'direct'][i % 4], utm_campaign: ['fall-sale', 'brand-search', 'retargeting', null][i % 4] })
  }
}

/* Schema discovery RPC used by the grid pages (Demand Planner, Containers, Arrivals, POs): the column
   list is whatever the seeded rows carry, in insertion order. Registered at module init so it also
   works when the database was restored from localStorage without reseeding. */
registerRpc('get_table_columns', (args) => {
  const sample = procureDb.tables.get(String(args.p_table ?? ''))?.rows[0]
  if (!sample) return []
  return Object.keys(sample).map((k, i) => ({ column_name: k, data_type: dataType(sample[k]), is_nullable: 'YES', column_default: null, ordinal_position: i + 1 }))
})

/* De-dup views the trackers prefer to read from — same rows as the base table here. */
procureDb.alias('invoice_tracker_latest', 'invoice_tracker')
procureDb.alias('shipping_requests_latest', 'shipping_requests')
procureDb.alias('po_tracker_latest', 'po_tracker')

let seeded = false
export function ensureProcureSeeded() { if (seeded) return; seeded = true; procureDb.seed(SEED_VERSION, seedProcure) }
export function resetProcureSeed() { procureDb.reset(seedProcure) }
