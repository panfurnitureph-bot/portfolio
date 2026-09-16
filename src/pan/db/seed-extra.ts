/* Second seed pass: tables read by the operations / delivery / workshop / HR / PAN Overall loaders. */
import type { db as DB } from './store'
import { EMPLOYEES, WORKSHOPS } from './seed'
import siteJson from './content/site.json'
import homepageJson from './content/homepage.json'
import productsJson from './content/products.json'
import swatchesJson from './content/swatch-library.json'
import { imageFor, roomPhotos, replaceCmsImages, swatch } from './images'

type Db = typeof DB
const rng = (seed: number) => { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296 } }
const dayIso = (n: number) => { const d = new Date(); d.setDate(d.getDate() - n); return d.toISOString().slice(0, 10) }
const daysAheadIso = (n: number) => { const d = new Date(); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10) }
const tsAgo = (n: number, h = 10, m = 0) => { const d = new Date(); d.setDate(d.getDate() - n); d.setHours(h, m, 0, 0); return d.toISOString() }

export function seedExtra(d: Db) {
  const r = rng(777)
  const mats = d.table('workshop_material').rows as { id: number; workshop_id: number; low_threshold: number }[]

  /* workshop material stock + movement log */
  const wstock = d.table('workshop_stock'), wlog = d.table('workshop_stock_log')
  mats.forEach((m, i) => {
    const onHand = i === 5 ? 33 : i === 3 ? 18 : i === 0 ? 42 : i === 2 ? 210 : Math.round(m.low_threshold * (1.2 + (i % 3) * 0.6))
    wstock.insert({ material_id: m.id, on_hand: onHand, reserved: 0, location: 'Rack ' + (1 + (i % 4)), updated_at: tsAgo(i % 5) })
    const worker = EMPLOYEES.find((e) => e.department === WORKSHOPS[m.workshop_id - 1].name)?.name ?? null
    wlog.insert({ workshop_id: m.workshop_id, material_id: m.id, delta: Math.round(m.low_threshold * 1.5), type: 'in', source: 'receive', ref_type: 'stock_request', ref_id: null, note: 'Initial delivery', by: 'Rowena Purificacion', created_at: tsAgo(12 + i) })
    wlog.insert({ workshop_id: m.workshop_id, material_id: m.id, delta: -Math.round(m.low_threshold * 0.3), type: 'out', source: 'job', ref_type: 'workshop_job', ref_id: null, note: null, by: worker, used_by: worker, created_at: tsAgo(2 + (i % 4), 9, 15) })
  })

  /* order line deliveries for shipped orders; live driver positions for out-for-delivery */
  const orders = d.table('orders').rows, dels = d.table('deliveries').rows
  const old = d.table('order_line_deliveries'), pos = d.table('driver_positions')
  for (const o of orders) {
    const items = (o.receipt_items as { qty: number; description: string; unitPrice: number; sku: string }[]) ?? []
    if ((o.lines_shipped as string[])?.length) for (const it of items) old.insert({ order_id: o.id, order_number: o.order_number, sku: it.sku, item_desc: it.description, qty: it.qty, unit_price: it.unitPrice, batch_no: 1, delivered_at: tsAgo(3, 14, 20) })
  }
  for (const dl of dels) if (dl.status === 'Out for Delivery') pos.insert({ order_number: dl.order_number, lat: 13.94 + r() * 0.05, lng: 121.6 + r() * 0.05, speed_kmh: 32, updated_at: new Date().toISOString(), eta_sec: 660, remain_m: 7600 })

  /* quotations + website content (shipping provinces used by the quotation builder) */
  d.table('quotations').insert({ id: 118, fq_number: 'FQ-2026-0118', customer_name: 'Mark Domingo', address: 'San Pablo City, Laguna', items: [{ qty: 1, description: 'Bookshelf Wall Unit 2.4 m × 2.1 m — oak stain', unitPrice: 32000 }], delivery_fee: 1500, total: 33500, downpayment: 10050, image_url: imageFor('SH-5T-OAK'), status: 'Sent', created_by: 'Ana Noriega', sent_count: 1, sent_at: tsAgo(1, 19, 30), order_number: null, created_at: tsAgo(1, 19, 10), updated_at: tsAgo(1, 19, 30) })
  d.table('quotations').insert({ id: 112, fq_number: 'FQ-2026-0112', customer_name: 'Jenny dela Cruz', address: 'Lucban, Quezon', items: [{ qty: 1, description: 'Sala Set L-Shape 2.8 m × 1.8 m — grey linen', unitPrice: 52900 }], delivery_fee: 0, total: 52900, downpayment: 15870, image_url: imageFor('SF-LSH-GL'), status: 'Converted', created_by: 'Ana Noriega', sent_count: 2, sent_at: tsAgo(3, 11, 0), replied_at: tsAgo(3, 12, 5), order_number: 'ORD-000116', created_at: tsAgo(3, 10, 50), updated_at: tsAgo(3, 12, 5) })
  d.table('web_content').insert({ key: 'site', value: replaceCmsImages(siteJson as unknown as Record<string, unknown>, 1), updated_at: tsAgo(20) })

  /* PAN Overall — accounts, categories, transactions, MOP map */
  const acc = d.table('pan_accounts'), cat = d.table('pan_categories'), txn = d.table('pan_transactions')
  const ACCOUNTS: [string, number][] = [['Cash on Hand', 85000], ['BPI Checking', 412000], ['Maya Business', 138500], ['BDO Savings', 260000]]
  ACCOUNTS.forEach(([name, ob], i) => acc.insert({ id: i + 1, name, opening_balance: ob, sort_order: i, active: true }))
  const CATS: [string, string][] = [['Sales', 'income'], ['Downpayment', 'income'], ['Materials', 'expense'], ['Payroll', 'expense'], ['Fuel & Delivery', 'expense'], ['Utilities', 'expense'], ['Rent', 'expense'], ['Refunds', 'expense']]
  CATS.forEach(([name, kind], i) => cat.insert({ id: i + 1, name, kind, sort_order: i, active: true }))
  const MOPS: [string, number][] = [['Maya QR', 3], ['Maya Card', 3], ['Cash', 1], ['Bank Transfer', 2], ['COD', 1]]
  MOPS.forEach(([mop, a]) => d.table('mop_account_map').insert({ mop, account_id: a }))
  const EXP = ['Plywood & hardware', 'Weekly payroll', 'Diesel — Delivery Team', 'Meralco', 'Showroom rent', 'Refund — RMA']
  for (let i = 0; i < 40; i++) {
    const kind = r() > 0.45 ? 'income' : 'expense'
    const c = kind === 'income' ? (r() > 0.5 ? 1 : 2) : 3 + Math.floor(r() * 6)
    txn.insert({ txn_date: dayIso(Math.floor(r() * 60)), account_id: 1 + Math.floor(r() * 4), category_id: c, kind, details: kind === 'income' ? 'Order payment' : EXP[c - 3] ?? 'Expense', amount: kind === 'income' ? 8000 + Math.floor(r() * 45000) : 2000 + Math.floor(r() * 38000), created_by: 'demo-administrator', created_at: tsAgo(Math.floor(r() * 60)) })
  }

  /* HR — payroll run + payslips, advances, leaves, constructor project work from approved QC */
  const run = d.table('hr_payroll_runs').insert({ period_start: dayIso(19), period_end: dayIso(5), pay_date: dayIso(3), status: 'Released', notes: null, pay_type: 'Semi-monthly' })
  for (const e of EMPLOYEES.filter((x) => x.rate_type === 'Daily')) {
    const days = 12, ot = Math.floor(r() * 6), basic = e.rate * days, otPay = Math.round((e.rate / 8) * 1.25 * ot), gross = basic + otPay, sss = 570, ph = 450, pi = 200, adv = e.id % 4 === 0 ? 1500 : 0
    d.table('hr_payslips').insert({ run_id: run.id, employee_id: e.id, days_worked: days, hours: days * 8, ot_hours: ot, basic_pay: basic, ot_pay: otPay, allowance: 0, gross, sss, philhealth: ph, pagibig: pi, tax: 0, cash_advance: adv, other_deductions: 0, net_pay: gross - sss - ph - pi - adv })
  }
  d.table('hr_advances').insert({ employee_id: 12, amount: 3000, deducted: 1500, date_issued: dayIso(25), reason: 'Emergency — tuition', status: 'Open' })
  d.table('hr_advances').insert({ employee_id: 5, amount: 2000, deducted: 2000, date_issued: dayIso(50), reason: 'Medical', status: 'Paid' })
  d.table('hr_leaves').insert({ employee_id: 10, leave_type: 'Vacation', date_from: dayIso(0), date_to: dayIso(0), days: 1, paid: true, reason: 'Family event', status: 'Approved', approved_by: 'demo-human_resources' })
  d.table('hr_leaves').insert({ employee_id: 3, leave_type: 'Sick', date_from: daysAheadIso(3), date_to: daysAheadIso(4), days: 2, paid: true, reason: 'Check-up', status: 'Pending', approved_by: null })
  for (const q of d.table('qc_declarations').rows) if (q.status === 'Approved') d.table('hr_project_work').insert({ employee_id: q.worker_id, project_name: q.item, description: q.order_number + ' · ' + q.workshop, amount: q.total_amount, work_date: q.week_ending, status: r() > 0.5 ? 'Paid' : 'Unpaid', payslip_id: null, order_number: q.order_number, rate: q.base_amount, ot: 0 })

  /* returns / RMA — per team: 10 on-site rework visits, 10 pull-out reworks, 10 refund pull-outs,
     plus pending / rejected declarations for the Operations approval queue */
  const ret = d.table('returns')
  const delsT = d.table('deliveries')
  const TEAM_NAMES = ['Delivery Team']
  const DRIVER: Record<string, string> = { 'Delivery Team': 'Boyet Manalo' }
  const REASONS = ['Misaligned drawer', 'Fabric tear on arm rest', 'Wobbly leg', 'Wrong color delivered', 'Scratch on top panel', 'Hinge came loose', 'Cushion sagging after a week', 'Chipped corner on delivery', 'Door does not close flush', 'Foam too soft — customer wants firmer']
  let rmaSeq = 41
  const mk = (o: Record<string, unknown>, i: number, over: Record<string, unknown>) => {
    const it = ((o.receipt_items as { description: string; sku: string; unitPrice: number; category: string; color: string; dimension: string }[]) ?? [])[0]
    if (!it) return null
    return ret.insert({ return_no: 'RMA-' + String(rmaSeq++).padStart(4, '0'), type: 'customer', order_id: o.id, customer_name: o.customer_name, item_desc: it.description, sku: it.sku, item_image: imageFor(it.sku), qty: 1, reason: REASONS[i % REASONS.length], item_condition: 'Used — repairable', resolution: 'rework', refund_amount: 0, photos: roomPhotos(i + 2, 2), status: 'Pending', requested_by: ['Ana Noriega', 'Marco Reyes', 'Bea Lim'][i % 3], created_at: tsAgo(1 + (i % 6), 9 + (i % 7), 5), notes: null, category: it.category, color: it.color, dimension: it.dimension, source: 'sales', rework_mode: 'pullout', rework_parts: [], rework_parts_total: 0, rework_charge_total: 0, rework_downpayment: 0, ...over })
  }
  const instOrders = new Set(d.table('installations').rows.map((x) => x.order_id))
  for (const team of TEAM_NAMES) {
    const deliveredOnly = orders.filter((o) => o.dq_team === team && (o.lines_shipped as string[])?.length && !instOrders.has(o.id))
    const installed = orders.filter((o) => o.dq_team === team && instOrders.has(o.id))
    /* on-site repair visits: the delivery row is reopened for the visit, booked on the team's route */
    deliveredOnly.slice(0, 40).forEach((o, k) => {
      const when = daysAheadIso(k % 4)
      const row = mk(o, k, { status: 'Rework', approved_by: 'Rowena Purificacion', approved_at: tsAgo(1 + (k % 3), 10, 0), rework_target: 'onsite', rework_mode: 'onsite', rework_pickup_onsite: true, rework_declared_onsite: false, rework_onsite_crew: [DRIVER[team], 'Installer ' + team.slice(-1)], rework_charge_total: k % 3 === 0 ? 1500 : 0, rework_downpayment: 0, rework_pickup_team: team, rework_pickup_driver: DRIVER[team], rework_pickup_date: when })
      if (!row) return
      Object.assign(o, { dq_status: 'confirmed', dq_date: when, dq_team: team, dq_driver: DRIVER[team], dq_route_final_at: tsAgo(0, 7, 0), dq_stop: 1 + (k % 5), date_of_delivery: when })
      const dl = delsT.rows.find((x) => x.order_id === o.id)
      if (dl) Object.assign(dl, { status: 'Scheduled', return_id: row.id, schedule_date: when, delivered_at: null, arrived_at: null, started_at: null, pickup_at: tsAgo(0, 7, 30) })
    })
    /* pull-out reworks: collect the defective item, repair in a workshop, redeliver */
    deliveredOnly.slice(40, 80).forEach((o, k) => mk(o, k + 3, { status: 'Rework', approved_by: 'Rowena Purificacion', approved_at: tsAgo(1 + (k % 4), 11, 0), rework_target: 'workshop', rework_mode: 'pullout', rework_workshop_id: 1 + (k % 3), rework_pickup_team: team, rework_pickup_driver: DRIVER[team], rework_pickup_date: daysAheadIso(k % 3), rework_charge_total: k % 2 ? 1200 : 0, rework_downpayment: k % 2 ? 600 : 0 }))
    /* refund pull-outs: approved refunds where the team collects the item back */
    installed.slice(0, 40).forEach((o, k) => { const it = (o.receipt_items as { unitPrice: number }[])[0]; mk(o, k + 5, { resolution: 'refund', refund_amount: Math.round((it?.unitPrice ?? 5000) * 0.8), status: 'Approved', approved_by: 'Rowena Purificacion', approved_at: tsAgo(1 + (k % 5), 14, 20), refunded_at: null, rework_mode: 'pullout', rework_pickup_team: team, rework_pickup_driver: DRIVER[team], rework_pickup_date: daysAheadIso(k % 3) }) })
    /* still on the manager's desk */
    installed.slice(40, 48).forEach((o, k) => mk(o, k + 7, { status: k % 4 === 1 ? 'Rejected' : 'Pending' }))
  }

  /* website CMS content read by the Website admin tabs */
  d.table('web_content').insert({ key: 'homepage', value: replaceCmsImages(homepageJson as unknown as Record<string, unknown>, 2), updated_at: tsAgo(9) })
  for (const [pi, pr] of (productsJson as unknown as { slug: string }[]).entries()) d.table('web_products').insert({ slug: pr.slug, data: replaceCmsImages(pr, 3 + pi * 7), updated_at: tsAgo(9) })
  for (const sw of swatchesJson as unknown as { name: string }[]) d.table('web_swatches').insert({ name: sw.name, data: replaceCmsImages({ ...sw, image: swatch(sw.name, sw.name.slice(0, 10)) }), updated_at: tsAgo(9) })
  d.table('web_content').insert({ key: 'pending_reviews', value: [], updated_at: tsAgo(9) })
  d.table('fb_scripts').insert({ id: 1, label: 'Price inquiry', keywords: 'price, magkano, hm, presyo', reply: 'Hello! Pwede po ba malaman kung anong item ang tinitingnan ninyo? Ipapadala ko ang presyo at available na kulay.', alt_replies: null, priority: 1, active: true, is_fallback: false, created_at: tsAgo(30) })
  d.table('fb_scripts').insert({ id: 2, label: 'Delivery', keywords: 'deliver, delivery, shipping, hatid', reply: 'Nagde-deliver po kami sa buong Quezon at Laguna. Libre ang delivery sa Lucena City para sa ₱20,000 pataas.', alt_replies: null, priority: 2, active: true, is_fallback: false, created_at: tsAgo(30) })
  d.table('fb_scripts').insert({ id: 3, label: 'Fallback', keywords: '*', reply: 'Salamat sa mensahe! Isang sales associate ang sasagot sa inyo sa loob ng ilang minuto.', alt_replies: null, priority: 99, active: true, is_fallback: true, created_at: tsAgo(30) })

  /* empty tables the loaders touch */
  for (const t of ['delivery_qa_items', 'rates', 'defect_writeoffs', 'mattress_orders', 'email_outbox', 'push_tokens', 'payment_approvals', 'addons', 'product_costings', 'purchase_order_items', 'design_details', 'website_item_config', 'suppliers', 'purchase_orders', 'warehouse_locations', 'stock_adjustments', 'stock_build', 'hr_overtime', 'wfh_activity', 'login_temp_passwords', 'user_permissions', 'role_permissions']) d.table(t)
}
