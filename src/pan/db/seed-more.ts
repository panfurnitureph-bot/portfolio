/* Third seed pass: tables behind the tabs that were still empty — Warehouse Location Management
   (40 lines × A1–E6 cubics), Purchase Orders / Incoming / Suppliers / Rates, Product Costing,
   Mattress Orders, Warranty Documents, Design Details, Requested Edit Orders, Payment Approval,
   Stock Build, WFH Activity Monitor, QC rate sheet, stock adjustments. */
import type { db as DB } from './store'
import { EMPLOYEES, PRODUCTS } from './seed'
import { todayPH } from '../real/lib/today'
import { imageFor, roomPhotos, swatch, IMPORT_PHOTOS } from './images'

type Db = typeof DB
const rng = (seed: number) => { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296 } }
const dayIso = (n: number) => { const d = new Date(); d.setDate(d.getDate() - n); return d.toISOString().slice(0, 10) }
const daysAheadIso = (n: number) => { const d = new Date(); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10) }
const tsAgo = (n: number, h = 10, m = 0) => { const d = new Date(); d.setDate(d.getDate() - n); d.setHours(h, m, 0, 0); return d.toISOString() }
const pick = <T,>(r: () => number, a: readonly T[]) => a[Math.floor(r() * a.length)]

const SIGNATURE_SVG = 'data:image/svg+xml;utf8,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="320" height="120" viewBox="0 0 320 120"><path d="M14 84c22-38 40-52 52-40s-8 42 6 44 30-46 48-46 4 46 20 44 26-52 44-46 6 44 22 44 24-40 40-38 14 36 36 30" fill="none" stroke="#1b1814" stroke-width="3" stroke-linecap="round"/></svg>')

type OrderRow = { id: number; order_number: string; customer_name: string; address: string | null; contact_number: string | null; email: string | null; status: string; date_order: string; date_of_delivery: string | null; assigned: string | null; receipt_items: { qty: number; description: string; unitPrice: number; sku: string; category: string }[]; downpayment_price: number; full_payment: number; full_payment_price: number; Source: string | null; date_downpayment: string | null; full_payment_date: string | null; workshop_date: string | null; is_rush: boolean | null; rush_days: number | null; transaction_images: string[] | null; address_lat: number | null; address_lng: number | null; fb_name: string | null; fb_link: string | null }

export function seedMore(d: Db) {
  const r = rng(4242)
  const orders = d.table('orders').rows as unknown as OrderRow[]
  const bySku = new Map<string, (typeof PRODUCTS)[number]>(PRODUCTS.map((p) => [p.sku, p]))

  /* ── Warehouse Location Management: 40 lines × 30 cubics (A1–E6) = 1,200 cubics ── */
  const locs = d.table('warehouse_locations')
  const CUBICS = ['A', 'B', 'C', 'D', 'E'].flatMap((L) => Array.from({ length: 6 }, (_, i) => `${L}${i + 1}`))
  let lid = 1
  for (let line = 1; line <= 40; line++) for (const c of CUBICS) locs.insert({ id: lid++, code: `L${line}-${c}`, zone: `Line ${line}`, capacity: null, status: 'active', created_at: tsAgo(300) })

  /* split one SKU across two cubics (the real warehouse does this when a batch no longer fits) */
  const pl = d.table('stock_placements')
  const sofa = pl.rows.find((p) => p.sku === 'SF-VLV-3S')
  if (sofa) { sofa.qty = 3; pl.insert({ sku: 'SF-VLV-3S', location_code: 'L3-A1', qty: 1, order_id: null, updated_at: tsAgo(1, 16, 20) }) }
  /* Mattress stock: 12 pcs, 8 in L6-A1 + 4 in L6-A2 */
  const mt = pl.rows.find((p) => p.sku === 'MT-6075-8')
  if (mt) { mt.qty = 8; pl.insert({ sku: 'MT-6075-8', location_code: 'L6-A2', qty: 4, order_id: null, updated_at: tsAgo(2, 9, 5) }) }
  d.table('stock_adjustments').insert({ sku: 'CH-ACC-RTN', product_name: 'Accent Chair — Rattan', inventory_id: 10, counted_qty: 8, system_qty: 9, variance: -1, reason: 'Cycle count L1-A3 — 1 pc missing, checking returns bay', status: 'pending', counted_by: 'Dennis Villanueva', approved_by: null, created_at: tsAgo(1, 15, 40), approved_at: null })
  d.table('stock_adjustments').insert({ sku: 'OF-TBL-WAL', product_name: 'Office Table — Walnut', inventory_id: 8, counted_qty: 6, system_qty: 6, variance: 0, reason: 'Monthly count', status: 'approved', counted_by: 'Dennis Villanueva', approved_by: 'Rowena Purificacion', created_at: tsAgo(6, 15, 0), approved_at: tsAgo(6, 17, 30) })

  /* ── Suppliers + rate sheet ── */
  const sup = d.table('suppliers')
  const SUPPLIERS: [string, 'local' | 'shopee' | 'imported', string, string, string | null, string | null, string | null, string, string][] = [
    ['Lucena Hardwood Trading', 'local', 'Brgy. Ibabang Dupay, Lucena City, Quezon', 'Rene Alcantara', '0917 442 1180', 'sales@lucenahardwood.ph', null, 'Narra, Acacia, Gmelina planks · Marine plywood 3/4', 'active'],
    ['Uratex Foam — Southern Luzon', 'local', 'Sto. Tomas, Batangas', 'Cathy Mendoza', '0928 771 0052', 'cathy.m@uratex.com.ph', 'https://www.uratex.com.ph', 'Mattress foam 8in/10in · Sofa cushion foam', 'active'],
    ['Metro Textile Fabrics', 'local', 'Divisoria, Manila', 'Lester Ong', '0917 300 9821', null, null, 'Velvet, linen, chenille upholstery fabric', 'active'],
    ['HW Depot (Shopee)', 'shopee', 'Shopee PH', 'Shop chat', null, null, 'https://shopee.ph/hwdepot', 'Soft-close hinges, drawer slides, cam locks', 'active'],
    ['Foshan Lianyu Furniture Co.', 'imported', 'Foshan, Guangdong, China', 'Ms. Wei Lin', '+86 138 0290 1123', 'weilin@lianyu-furn.cn', 'https://lianyu-furn.cn', 'Swivel chairs, KD dining chairs, marble-top tables (container)', 'active'],
    ['Kraft Pack Packaging', 'local', 'Tayabas, Quezon', 'Jun Salazar', '0919 655 2210', null, null, 'Carton, bubble wrap, stretch film, corner guards', 'inactive'],
  ]
  SUPPLIERS.forEach((s, i) => sup.insert({ id: i + 1, name: s[0], type: s[1], address: s[2], contact_person: s[3], contact_number: s[4], email: s[5], link: s[6], materials: s[7], status: s[8], notes: i === 5 ? 'Switched to Lucena supplier — cheaper freight' : null, created_at: tsAgo(400 - i * 30) }))
  const rates = d.table('rates')
  const RATES: [string, string, string, number][] = [
    ['Narra plank 1×12×10ft', 'Wood', 'pc', 2850], ['Acacia plank 1×10×8ft', 'Wood', 'pc', 1650], ['Marine plywood 3/4 4×8', 'Wood', 'sheet', 1980], ['Gmelina 2×2×8ft', 'Wood', 'pc', 320],
    ['Velvet upholstery fabric', 'Fabric', 'yd', 480], ['Linen upholstery fabric', 'Fabric', 'yd', 390], ['Cushion foam 4in HD', 'Foam', 'sheet', 2100],
    ['Soft-close hinge (pair)', 'Hardware', 'pair', 95], ['Ball-bearing drawer slide 18in', 'Hardware', 'pair', 260], ['Duco paint white 4L', 'Finish', 'can', 1450], ['Lacquer sanding sealer 4L', 'Finish', 'can', 1180],
    ['Upholsterer — sofa 3-seater', 'Labor', 'unit', 2500], ['Carpenter — bed frame queen', 'Labor', 'unit', 1800],
  ]
  RATES.forEach((x, i) => rates.insert({ id: i + 1, item: x[0], category: x[1], unit: x[2], unit_price: x[3], notes: null, status: 'active', created_at: tsAgo(120 - i) }))

  /* ── Purchase orders (imported container + local), items, incoming shipments ── */
  const po = d.table('purchase_orders'), poi = d.table('purchase_order_items'), ship = d.table('incoming_shipments'), shipi = d.table('incoming_shipment_items')
  const COLS = [{ label: 'S/N', kind: 'sn' }, { label: 'Photo', kind: 'photo' }, { label: 'Item No.', kind: 'item_no' }, { label: 'Color', kind: 'color' }, { label: 'Description', kind: 'description' }, { label: 'Prod. Size (cm)', kind: 'prod_size' }, { label: 'Qty', kind: 'qty' }, { label: 'Received', kind: 'received' }, { label: 'Unit Price', kind: 'unit_price', cur: 'USD' }, { label: 'Amount', kind: 'amount' }]
  const header = (pi: string, date: string) => [[{ t: 'PROFORMA INVOICE', b: true }, { t: pi, b: true }], [{ t: 'Buyer: PAN Furniture, Lucena City, Quezon, Philippines' }, { t: `Date: ${date}` }]]
  const footer = (dep: number) => [[{ t: `Deposit ${dep}% upon PI confirmation, balance against copy of B/L` }], [{ t: 'Lead time 35–40 days after deposit', c: '#8a7a45' }]]
  type PoLine = [string, string, string, string, number, number, number]
  const mkPo = (id: number, pi: string, supplier: string, addr: string, dateAgo: number, deliverIn: number, status: string, container: string | null, currency: string, dep: number, lines: PoLine[], recvPct: number, notes: string | null) => {
    let total = 0
    lines.forEach((l, i) => { const amt = l[4] * l[5]; total += amt; poi.insert({ id: id * 100 + i + 1, po_id: id, item_no: l[0], color: l[1], description: l[2], prod_size: l[3], qty: l[4], received_qty: Math.round(l[4] * (i === lines.length - 1 && recvPct > 0 && recvPct < 1 ? recvPct : recvPct >= 1 ? 1 : recvPct > 0 ? 1 : 0)), unit_price: l[5], amount: amt, image_url: currency === 'USD' ? IMPORT_PHOTOS[(id + i) % IMPORT_PHOTOS.length] : swatch(l[1], l[0]), swatch_url: swatch(l[1]), extra: { cbm: String(l[6]) }, sort: i }) })
    po.insert({ id, pi_number: pi, supplier, supplier_address: addr, date_order: dayIso(dateAgo), delivery_date: deliverIn >= 0 ? daysAheadIso(deliverIn) : dayIso(-deliverIn), price_terms: currency === 'USD' ? 'FOB Shenzhen' : 'Ex-works', payment_terms: `${dep}% deposit, balance before release`, port_shipment: currency === 'USD' ? 'Shenzhen' : null, port_destination: currency === 'USD' ? 'Manila South Harbor' : null, container, currency, discount: 0, total, deposit_pct: dep, status, notes, details: { 'Forwarder': currency === 'USD' ? 'Royal Cargo' : 'Own truck', 'Incoterm': currency === 'USD' ? 'FOB' : 'EXW' }, header_rows: header(pi, dayIso(dateAgo)), footer_rows: footer(dep), columns: COLS, created_at: tsAgo(dateAgo, 9, 30) })
    return total
  }
  mkPo(1, 'PI-LY-2026-031', 'Foshan Lianyu Furniture Co.', 'Foshan, Guangdong, China', 78, -38, 'Received', 'MSKU 774 210-3 · 40HQ', 'USD', 30, [['LY-SW-009', 'Black', 'Black Sesame Swivel Chair — PU seat, chrome base', '62×62×88', 60, 38.5, 0.32], ['LY-KD-014', 'Walnut', 'Ensaymada KD Dining Chair — beech legs', '45×52×86', 80, 22.0, 0.18], ['LY-TB-021', 'White marble', 'Graham Crust Wood Table — sintered top 1.6m', '160×80×75', 20, 118.0, 0.55]], 1, 'Landed 2026-07 · all lines QC passed at Receiving')
  mkPo(2, 'PI-LY-2026-047', 'Foshan Lianyu Furniture Co.', 'Foshan, Guangdong, China', 26, 12, 'Ordered', 'CMAU 318 667-0 · 40HQ', 'USD', 30, [['LY-SW-009', 'Grey', 'Black Sesame Swivel Chair — PU seat, chrome base', '62×62×88', 60, 38.5, 0.32], ['LY-SF-102', 'Moss velvet', '3-Seater Sofa frame + cover set', '210×90×85', 24, 165.0, 1.4], ['LY-CT-033', 'White', 'Center Table — Marble Top 1.2m', '120×60×45', 30, 64.0, 0.4]], 0, 'ETD Shenzhen ' + dayIso(4) + ' · ETA Manila ' + daysAheadIso(12))
  mkPo(3, 'PO-2026-0092', 'Lucena Hardwood Trading', 'Brgy. Ibabang Dupay, Lucena City', 9, 3, 'Partially Received', null, 'PHP', 50, [['NAR-1x12', 'Natural', 'Narra plank 1×12×10ft KD', '—', 40, 2850, 0], ['ACA-1x10', 'Natural', 'Acacia plank 1×10×8ft', '—', 60, 1650, 0], ['MPLY-34', '—', 'Marine plywood 3/4 4×8', '—', 30, 1980, 0]], 0.5, '2nd truck for the plywood balance on ' + daysAheadIso(3))
  mkPo(4, 'PO-2026-0095', 'Uratex Foam — Southern Luzon', 'Sto. Tomas, Batangas', 4, 6, 'Sent', null, 'PHP', 0, [['UX-8IN-6075', 'White', 'Mattress 60×75 — 8in Foam', '152×190×20', 24, 4600, 0], ['UX-CUSH-4', 'White', 'Cushion foam 4in HD sheet', '200×100×10', 12, 2100, 0]], 0, null)
  mkPo(5, 'PO-2026-0097', 'Metro Textile Fabrics', 'Divisoria, Manila', 1, 10, 'Draft', null, 'PHP', 0, [['VLV-MOSS', 'Moss', 'Velvet upholstery fabric', 'roll 50yd', 3, 24000, 0], ['LIN-GRY', 'Grey', 'Linen upholstery fabric', 'roll 50yd', 2, 19500, 0]], 0, 'Waiting for swatch confirmation from sales')
  /* shipments for the POs that are on the water / partially delivered */
  ship.insert({ id: 1, po_id: 2, eta: daysAheadIso(12), arrived_date: null, tracking_no: 'CMAU3186670', forwarder: 'Royal Cargo', received_by: null, created_at: tsAgo(20) })
  ship.insert({ id: 2, po_id: 3, eta: dayIso(2), arrived_date: dayIso(2), tracking_no: 'LHT-TRK-0418', forwarder: 'Own truck', received_by: 'Dennis Villanueva', created_at: tsAgo(5) })
  ;[[301, 40, 40, 0, 'All good, kiln-dried'], [302, 60, 58, 2, '2 pcs warped — return to supplier'], [303, 15, 15, 0, 'Balance 15 sheets on 2nd truck']].forEach((x, i) => shipi.insert({ id: i + 1, shipment_id: 2, po_item_id: x[0], received_qty: x[1], passed_qty: x[2], defective_qty: x[3], qa_remarks: x[4], inventory_added: x[2], sort: i, created_at: tsAgo(2, 14, 0) }))
  ship.insert({ id: 3, po_id: 4, eta: daysAheadIso(6), arrived_date: null, tracking_no: null, forwarder: 'Uratex delivery', received_by: null, created_at: tsAgo(3) })

  /* ── Product costing (bill of materials + labor) ── */
  const cost = d.table('product_costings'), ci = d.table('costing_items')
  const mkCost = (id: number, title: string, project: string | null, size: string, category: string, price: number, notes: string | null, items: [string, string, string, number][]) => {
    let total = 0
    items.forEach((it, i) => { const tp = Number(it[1]) * it[3]; total += tp; ci.insert({ id: id * 100 + i + 1, costing_id: id, kind: it[0], qty: it[1], material: it[2], unit_price: it[3], total_price: tp, sort: i, created_at: tsAgo(30) }) })
    cost.insert({ id, title, project, size, category, total_cost: total, selling_price: price, notes, created_at: tsAgo(40 - id * 5, 11, 0) })
  }
  mkCost(1, '3-Seater Sofa — Velvet Moss', null, '84 × 36 × 34 in', 'Sofa', 38500, 'Standard build, Production Area', [['material', '2', 'Gmelina frame lumber set', 2400], ['material', '1', 'Marine plywood 3/4 4×8', 1980], ['material', '2', 'Cushion foam 4in HD', 2100], ['material', '14', 'Velvet upholstery fabric (yd)', 480], ['material', '1', 'Webbing, springs, staples, glue', 1650], ['labor', '1', 'Upholsterer — sofa 3-seater', 2500], ['labor', '1', 'Carpenter — frame', 1600], ['overhead', '1', 'Finishing, packaging, QC', 900]])
  mkCost(2, 'Queen Bed Frame — Narra', null, '60 × 75 in', 'Bed Frame', 29800, null, [['material', '4', 'Narra plank 1×12×10ft', 2850], ['material', '6', 'Gmelina 2×2×8ft slats', 320], ['material', '1', 'Hardware — bolts, brackets', 680], ['material', '1', 'Lacquer sanding sealer 4L', 1180], ['labor', '1', 'Carpenter — bed frame queen', 1800], ['overhead', '1', 'Finishing, packaging, QC', 700]])
  mkCost(3, 'Kitchen Cabinet Run 3.2m — White Duco', 'ORD-000172 · Villar residence', '3.2 m × 0.6 m', 'Cabinet', 68000, 'Custom — includes soft-close hardware', [['material', '6', 'Marine plywood 3/4 4×8', 1980], ['material', '2', 'Duco paint white 4L', 1450], ['material', '12', 'Soft-close hinge (pair)', 95], ['material', '6', 'Ball-bearing drawer slide 18in', 260], ['material', '1', 'Edge banding, screws, glue', 1900], ['labor', '1', 'Cabinet maker — 3.2m run', 6500], ['labor', '1', 'Installer — 1 day, 2 crew', 3200], ['overhead', '1', 'Transport + packaging', 1500]])
  mkCost(4, 'Dining Set 6-Seater — Acacia', null, '72 × 36 × 30 in', 'Dining', 46500, null, [['material', '5', 'Acacia plank 1×10×8ft', 1650], ['material', '6', 'Ensaymada KD Dining Chair (imported)', 1250], ['material', '1', 'Lacquer sanding sealer 4L', 1180], ['labor', '1', 'Carpenter — table', 2400], ['overhead', '1', 'Finishing, packaging, QC', 800]])

  /* ── Mattress orders (Uratex resale — separate ledger) ── */
  const mo = d.table('mattress_orders')
  const MATT: [string, string, number, string, string, string | null][] = [
    ['Carla Dizon', 'Uratex Senso 60×75 8in ×1', 1, 'Done', 'Luzon', 'GCash'], ['Sps. Rivera', 'Uratex Premium 54×75 6in ×2', 3, 'Done', 'Luzon', 'Cash'], ['Bong Tolentino', 'Uratex Senso 72×75 10in ×1', 5, 'Pending', 'Luzon', null],
    ['Precious Uy', 'Uratex Kiddie 36×75 4in ×3', 6, 'Pending', 'Luzon', 'GCash'], ['Mang Efren', 'Uratex Premium 48×75 6in ×1', 9, 'Cancelled', 'Luzon', null], ['Ate Grace Sari-sari', 'Uratex Senso 60×75 8in ×2', 12, 'Done', 'Luzon', 'Cash'],
    ['Roldan Bautista', 'Uratex Premium 60×75 6in ×1', 15, 'Done', 'Luzon', 'GCash'], ['Nina Fajardo', 'Uratex Senso 54×75 8in ×1', 0, 'Pending', 'Luzon', null],
  ]
  MATT.forEach((m, i) => { const amt = /8in/.test(m[1]) ? 8900 : /10in/.test(m[1]) ? 12400 : /4in/.test(m[1]) ? 3200 : 6400; const n = Number(/×(\d)/.exec(m[1])?.[1] ?? 1); mo.insert({ id: i + 1, client: m[0], order: m[1], order_date: dayIso(m[2]), status: m[3], region: m[4], amount: amt * n, paid_via: m[5], done_at: m[3] === 'Done' ? tsAgo(Math.max(0, m[2] - 1), 16, 0) : null, created_at: tsAgo(m[2], 10, 0) }) })

  /* ── Warranty documents: signed installation sheets (the loader needs completed + signature) ── */
  const inst = d.table('installations')
  inst.rows.forEach((row, i) => {
    if (!/completed|delivered/i.test(String(row.status ?? ''))) return
    const dur = i % 5 === 0 ? '3 months' : i % 7 === 0 ? '6 months' : '1 year'
    Object.assign(row, { signature_url: SIGNATURE_SVG, warranty_duration: dur, warranty_terms: dur === '1 year' ? 'Frame & workmanship — 1 year. Excludes fabric wear, water damage and misuse.' : 'Workmanship only. Excludes fabric wear and misuse.', photos: roomPhotos(i + 7, 3), item_installers: [] })
  })

  /* ── Design details (DD sheets sent to the customer before production) ── */
  const dd = d.table('design_details')
  const candidates = orders.filter((o) => ['Workshop', 'For Production', 'Confirmed', 'In Production'].some((s) => String(o.status).includes(s)) || true).slice(0, 40)
  const ddPick = [candidates[3], candidates[7], candidates[12], candidates[18], candidates[25]].filter(Boolean)
  const DD_STATUS = ['Sent', 'Approved', 'Draft', 'Sent', 'Approved']
  ddPick.forEach((o, i) => {
    const line = o.receipt_items[0]; const p = bySku.get(line.sku)
    dd.insert({ id: 31 + i, dd_number: `DD-2026-00${31 + i}`, order_number: o.order_number, customer_name: o.customer_name, address: o.address, title: line.description, sku: line.sku, bullets: [`${p?.dimension ?? line.description}`, `Finish: ${p?.color ?? 'as sample'}`, 'Hardware: soft-close, brushed nickel', 'Lead time: 12–15 working days after approval'], photo_url: imageFor(line.sku), photo_w: 640, photo_h: 480, swatch_url: swatch(p?.color ?? 'natural'), swatch_label: p?.color ?? null, labels: [], mattress: p?.category === 'Bed Frame' ? 'Uratex Senso 8in (separate)' : null, headboard: p?.category === 'Bed Frame' ? 'Upholstered, 48in' : null, note: i === 2 ? 'Customer wants deeper seat — confirm 24in' : null, image_url: imageFor(line.sku), status: DD_STATUS[i], created_by: o.assigned ?? 'Ana Noriega', sent_count: DD_STATUS[i] === 'Draft' ? 0 : 1 + (i % 2), sent_at: DD_STATUS[i] === 'Draft' ? null : tsAgo(2 + i, 14, 10), replied_at: DD_STATUS[i] === 'Approved' ? tsAgo(1 + i, 18, 40) : null, replied_psid: null, followup_count: 0, last_followup_at: null, insets: [], specs: ['Seat depth 22 in', 'Tapered wood legs', 'Foam: HD 4 in'], created_at: tsAgo(2 + i, 13, 50), updated_at: tsAgo(1 + i, 18, 40) })
  })

  /* ── Requested edit orders (sales asks Operations to approve a change) ── */
  const er = d.table('order_edit_requests')
  const snap = (o: OrderRow) => ({ order_number: o.order_number, date_order: String(o.date_order).slice(0, 10), customer_name: o.customer_name, address: o.address, address_lat: o.address_lat ?? null, address_lng: o.address_lng ?? null, contact_number: o.contact_number, email: o.email, fb_name: o.fb_name ?? null, fb_link: o.fb_link ?? null, source: o.Source, status: o.status, assigned: o.assigned, workshop_date: o.workshop_date ? String(o.workshop_date).slice(0, 10) : null, date_of_delivery: o.date_of_delivery ? String(o.date_of_delivery).slice(0, 10) : null, date_downpayment: o.date_downpayment ? String(o.date_downpayment).slice(0, 10) : null, full_payment_date: o.full_payment_date ? String(o.full_payment_date).slice(0, 10) : null, downpayment: Number(o.downpayment_price) || 0, full_payment: Number(o.full_payment) || 0, total: Number(o.full_payment_price) || 0, items: o.receipt_items ?? [], transaction_images: o.transaction_images ?? [], removed_images: [], is_rush: !!o.is_rush, rush_days: o.rush_days ?? null })
  const erOrders = [orders[5], orders[9], orders[14], orders[21], orders[30]].filter(Boolean)
  const ER: [string, 'pending' | 'approved' | 'rejected', (b: ReturnType<typeof snap>) => Partial<ReturnType<typeof snap>>][] = [
    ['Customer moved delivery to next weekend', 'pending', (b) => ({ date_of_delivery: daysAheadIso(9) })],
    ['Wrong contact number on receipt', 'pending', (b) => ({ contact_number: '0917 555 0143' })],
    ['Customer changed color to Grey Linen', 'pending', (b) => ({ items: (b.items as OrderRow['receipt_items']).map((it, i) => i === 0 ? { ...it, description: it.description.replace(/—.*$/, '— Grey Linen') } : it) })],
    ['Address correction (Brgy. Cotta not Gulang-Gulang)', 'approved', (b) => ({ address: String(b.address ?? '').replace(/Brgy\.[^,]*/, 'Brgy. Cotta') || 'Brgy. Cotta, Lucena City' })],
    ['Add 1 more bar stool', 'rejected', (b) => ({ items: [...(b.items as OrderRow['receipt_items']), { qty: 1, description: 'Bar Stools (set of 4)', unitPrice: 9800, sku: 'CH-BAR-4', category: 'Chair' }] })],
  ]
  erOrders.forEach((o, i) => { const before = snap(o); const [reason, status, fn] = ER[i]; er.insert({ id: 40 + i, order_id: o.id, order_number: o.order_number, requested_by: o.assigned ?? 'Marco Reyes', reason, before, proposed: { ...before, ...fn(before) }, status, decided_by: status === 'pending' ? null : 'Rowena Purificacion', decided_at: status === 'pending' ? null : tsAgo(1 + i, 17, 5), created_at: tsAgo(i === 0 ? 0 : i, 9 + i, 20) }) })

  /* ── Payment approvals (drivers / sales submit collections, admin approves) ── */
  const pa = d.table('payment_approvals')
  const paOrders = orders.filter((o) => Number(o.full_payment_price) > Number(o.downpayment_price) + Number(o.full_payment)).slice(0, 6)
  const METHODS = ['GCash', 'Cash', 'Bank Transfer', 'GCash', 'Maya', 'Cash']
  paOrders.forEach((o, i) => {
    const bal = Number(o.full_payment_price) - Number(o.downpayment_price) - Number(o.full_payment)
    const status = i < 3 ? 'pending' : i === 3 ? 'approved' : i === 4 ? 'rejected' : 'approved'
    pa.insert({ id: 70 + i, order_id: o.id, order_number: o.order_number, amount: i === 1 ? Math.round(bal * 0.5) : bal, method: METHODS[i], collected_by: i % 2 ? 'Delivery Team' : o.assigned ?? 'Ana Noriega', submitted_by: i % 2 ? 'Jhun Manalo' : o.assigned ?? 'Ana Noriega', proof_urls: roomPhotos(i + 4, 1), status, note: i === 1 ? 'Partial — customer pays rest on install' : i === 4 ? 'Reference number not found in GCash ledger' : null, reviewed_by: status === 'pending' ? null : 'Joe Marie Casela', reviewed_at: status === 'pending' ? null : tsAgo(1 + i, 16, 30), dedupe_key: `${o.id}|${bal}|${METHODS[i]}|${i}`, created_at: tsAgo(i === 0 ? 0 : i, 11 + (i % 5), 15), return_id: null, return_no: null })
  })

  /* ── Stock build: workshop jobs with no order (build for stock) ── */
  const jobs = d.table('workshop_job')
  jobs.insert({ order_id: null, order_number: null, workshop_id: 1, item_desc: 'Accent Chair — Rattan\nNatural · 28 × 30 × 32 in', qty: 4, status: 'in progress', dispatched_at: tsAgo(3, 8, 30), updated_at: tsAgo(1, 9, 0), qc_received_at: null, fulfillment: 'warehouse', stock_request: true, stock_sku: 'CH-ACC-RTN', stock_reason: 'Low stock — 8 on hand, 6 reserved by website orders', stock_by: 'Rowena Purificacion' })
  jobs.insert({ order_id: null, order_number: null, workshop_id: 1, item_desc: 'Center Table — Marble Top\nWhite · 48 × 24 × 18 in', qty: 2, status: 'pending', dispatched_at: tsAgo(0, 9, 10), updated_at: tsAgo(0, 9, 10), qc_received_at: null, fulfillment: 'warehouse', stock_request: true, stock_sku: 'TB-CTR-MRB', stock_reason: 'Display unit for showroom + 1 buffer', stock_by: 'Rowena Purificacion' })
  jobs.insert({ order_id: null, order_number: null, workshop_id: 1, item_desc: '3-Seater Sofa — Velvet Moss\nMoss · 84 × 36 × 34 in', qty: 2, status: 'qc passed', dispatched_at: tsAgo(14, 8, 0), updated_at: tsAgo(6, 15, 0), qc_received_at: tsAgo(6, 15, 0), fulfillment: 'warehouse', stock_request: true, stock_sku: 'SF-VLV-3S', stock_reason: 'Fast mover — keep 4 on hand', stock_by: 'Rowena Purificacion' })

  /* ── QC rate sheet (pay per declared piece) ── */
  const qr = d.table('qc_rates')
  const QR: [string, string, string, number][] = [['Carpentry', 'piece', 'Bed frame — queen', 650], ['Carpentry', 'piece', 'Bed frame — bunk', 720], ['Carpentry', 'piece', 'Dining table', 900], ['Carpentry', 'piece', 'Cabinet / wardrobe', 850], ['Carpentry', 'piece', 'Table / desk', 480], ['Upholstery', 'piece', 'Sofa 3-seater', 1100], ['Upholstery', 'piece', 'L-shape sala set', 1650], ['Upholstery', 'piece', 'Accent chair', 380], ['Finishing', 'piece', 'Duco / lacquer finish', 300], ['Finishing', 'piece', 'Stain + sealer', 220], ['Rework', 'hour', 'Rework labor', 95]]
  QR.forEach((q, i) => qr.insert({ id: i + 1, section: q[0], kind: q[1], name: q[2], amount: q[3], active: true, sort: i }))

  /* ── WFH activity monitor: 10-minute buckets for today's WFH staff ── */
  const wa = d.table('wfh_activity'), att = d.table('hr_attendance')
  const today = todayPH()
  const wfhStaff = EMPLOYEES.filter((e) => e.work_setup === 'WFH' || e.work_setup === 'Hybrid')
  const now = new Date()
  const startOfDay = new Date(now); startOfDay.setHours(8, 0, 0, 0)
  wfhStaff.forEach((e, ei) => {
    if (!att.rows.some((a) => a.employee_id === e.id && a.work_date === today)) {
      const tin = new Date(startOfDay); tin.setMinutes(2 + ei * 7)
      att.insert({ employee_id: e.id, work_date: today, time_in: tin.toISOString(), time_out: null, status: 'present', ot_hours: 0, source: 'wfh', notes: null })
    }
    const buckets = Math.max(0, Math.floor((now.getTime() - startOfDay.getTime()) / 600000))
    for (let b = 0; b < Math.min(buckets, 60); b++) {
      const t = new Date(startOfDay.getTime() + b * 600000)
      const lunch = t.getHours() === 12
      const roll = r()
      const away = lunch ? 600 : roll > 0.92 ? 600 : 0
      const idle = away ? 0 : roll > 0.75 ? Math.round(120 + roll * 200) : Math.round(roll * 40)
      wa.insert({ employee_id: e.id, work_date: today, bucket_start: t.toISOString(), active_seconds: away ? 0 : 600 - idle, idle_seconds: idle, away_seconds: away, selfie_jpeg: null, screen_jpeg: null, face_ok: away ? null : roll > 0.97 ? false : true, last_status: away ? 'away' : idle > 100 ? 'idle' : 'active', created_at: t.toISOString() })
    }
  })

  /* ── temp passwords shown on the Employee Directory ── */
  d.table('login_temp_passwords').insert({ profile_id: 'demo-sales', temp_password: 'Pan-7f3k2', set_at: tsAgo(1, 9, 0) })


  /* ── volume pass: every remaining tab gets at least 10 rows ── */
  const emp = (i: number) => EMPLOYEES[i % EMPLOYEES.length]
  const CUST = ['Maria Santos', 'Robert Tecson', 'Carlo Mendoza', 'Liza Garcia', 'Teresa Ramos', 'Edwin Aquino', 'Grace Villanueva', 'Mark Domingo', 'Ferdinand Ocampo', 'Hazel Pascual', 'Joy Navarro', 'Kevin Torres']
  const TOWNS = ['Lucena City', 'Sariaya, Quezon', 'Pagbilao, Quezon', 'Tayabas City', 'Candelaria, Quezon', 'Tiaong, Quezon', 'San Pablo City, Laguna', 'Lucban, Quezon', 'Gumaca, Quezon', 'Atimonan, Quezon']

  /* quotations → 10 */
  const FQ: [string, number, string, number, string][] = [['Dining Set 8-Seater — Acacia, bench on one side', 58000, 'Sent', 1500, 'Marco Reyes'], ['Kitchen Cabinet Run 2.4 m — white duco, soft-close', 52000, 'Sent', 0, 'Ana Noriega'], ['Queen Bed Frame — Narra + 2 side tables', 41500, 'Accepted', 1200, 'Bea Lim'], ['Office Table 1.8 m + credenza', 29800, 'Draft', 0, 'Ana Noriega'], ['3-Seater Sofa — Velvet Moss (customer fabric)', 36500, 'Sent', 1500, 'Marco Reyes'], ['Wardrobe 4-Door — Oak stain, mirror door', 34900, 'Expired', 0, 'Bea Lim'], ['TV Console 2.4 m + wall shelf', 21800, 'Sent', 900, 'Ana Noriega'], ['Bunk Bed — Pine, with stairs drawer', 24500, 'Accepted', 1200, 'Marco Reyes']]
  FQ.forEach((q, i) => d.table('quotations').insert({ id: 101 + i, fq_number: `FQ-2026-0${101 + i}`, customer_name: CUST[(i + 2) % CUST.length], address: TOWNS[i % TOWNS.length], items: [{ qty: 1, description: q[0], unitPrice: q[1] }], delivery_fee: q[3], total: q[1] + q[3], downpayment: Math.round((q[1] + q[3]) * 0.3), image_url: imageFor(['DN-6S-ACA', 'KC-RUN-32', 'BD-QN-NAR', 'OF-TBL-WAL', 'SF-VLV-3S', 'WD-3D-WHT', 'TV-CON-18', 'BD-BNK-PN'][i]), status: q[2], created_by: q[4], sent_count: q[2] === 'Draft' ? 0 : 1 + (i % 2), sent_at: q[2] === 'Draft' ? null : tsAgo(2 + i, 15, 0), replied_at: q[2] === 'Accepted' ? tsAgo(1 + i, 18, 0) : null, replied_psid: null, order_number: null, created_at: tsAgo(2 + i, 14, 30), updated_at: tsAgo(1 + i, 18, 0), followup_count: i % 3, last_followup_at: i % 3 ? tsAgo(i, 10, 0) : null }))

  /* MTO requests → 10 */
  const MTOS: [string, string, string, string, Record<string, unknown>][] = [['Sala Set L-Shape 3.0 m', 'Sofa', 'SF-LSH-GL', 'New', { width_m: 3.0, depth_m: 1.9, fabric: 'Teal velvet' }], ['Kitchen Cabinet Run 3.6 m', 'Cabinet', 'KC-RUN-32', 'Quoted', { length_m: 3.6, finish: 'Walnut laminate', drawers: 6 }], ['Bookshelf Wall Unit 1.8 m', 'Cabinet', 'SH-5T-OAK', 'New', { width_m: 1.8, height_m: 2.4, tiers: 7 }], ['Dining Set 10-Seater', 'Dining', 'DN-6S-ACA', 'Converted', { length_m: 3.0, chairs: 10 }], ['Queen Bed — storage drawers', 'Bed Frame', 'BD-QN-NAR', 'Quoted', { size: 'Queen', drawers: 4, finish: 'Narra' }], ['Study Desk 1.6 m + hutch', 'Table', 'OF-DSK-HT', 'New', { width_m: 1.6, hutch: true }], ['TV Console 3.0 m floating', 'Cabinet', 'TV-CON-18', 'Declined', { width_m: 3.0, mount: 'wall' }]]
  MTOS.forEach((m, i) => d.table('mto_requests').insert({ mto_number: `MTO-00${33 + i}`, sku: m[2] + '-CUSTOM', slug: m[0].toLowerCase().replace(/[^a-z0-9]+/g, '-'), product_name: m[0], category: m[1], image_url: imageFor(m[2]), build: m[4], customer_name: CUST[(i + 5) % CUST.length], contact: `09${17 + i} 555 0${120 + i}`, address: TOWNS[(i + 3) % TOWNS.length], psid: i % 2 ? String(5510030 + i) : null, status: m[3], fq_number: m[3] === 'Quoted' || m[3] === 'Converted' ? `FQ-2026-0${101 + i}` : null, order_number: null, created_at: tsAgo(1 + i * 2, 9 + i, 0), echoed_at: null, address_lat: 13.93 + i * 0.01, address_lng: 121.61 - i * 0.01, fb_name: i % 2 ? CUST[(i + 5) % CUST.length] : null, fb_link: null }))

  /* stock requests (workshop → operations) → 10 */
  const SR: [number, number, number, string, string][] = [[1, 1, 20, 'Wardrobe batch — plywood', 'pending'], [1, 6, 40, 'Sofa frames next week', 'pending'], [1, 9, 12, 'Dining table tops', 'approved'], [1, 4, 30, 'Drawer slides for 5 wardrobes', 'ordered'], [1, 5, 15, 'Foam for L-shape', 'received'], [1, 10, 100, 'Chair legs', 'received'], [1, 2, 60, 'Narra for 2 beds', 'declined']]
  SR.forEach((x, i) => d.table('stock_request').insert({ workshop_id: x[0], material_id: x[1], qty_requested: x[2], qty_fulfilled: ['received', 'ordered', 'approved'].includes(x[4]) ? x[2] : null, reason: x[3], status: x[4], requested_by: ['Mang Rey Villamor', 'Mang Boy Lacsamana', 'Kuya Jun Dimaculangan'][x[0] - 1], decided_by: x[4] === 'pending' ? null : 'Rowena Purificacion', created_at: tsAgo(1 + i, 8 + i, 10), decided_at: x[4] === 'pending' ? null : tsAgo(i, 10, 0), seen_by_ws: true, qty_received: x[4] === 'received' ? x[2] : 0, ops_followed_up: i % 3 === 0 }))

  /* suppliers → 10 */
  ;[['Tayabas Rattan Works', 'local', 'Tayabas City, Quezon', 'Aling Nena', '0918 220 4471', null, 'Rattan poles, wicker weave', 'active'], ['Goldstar Hardware', 'local', 'Quezon Ave., Lucena City', 'Mr. Tan', '042 373 2210', 'goldstar.lucena@gmail.com', 'Screws, bolts, brackets, glue', 'active'], ['Ply&Board Depot (Shopee)', 'shopee', 'Shopee PH', 'Shop chat', null, null, 'Edge banding, laminates', 'active'], ['Guangzhou Hongyi Hardware', 'imported', 'Guangzhou, China', 'Mr. Chen', '+86 135 1180 2211', 'sales@hongyi-hw.cn', 'Soft-close hinges, gas lifts (container)', 'active']].forEach((x, i) => sup.insert({ id: 7 + i, name: x[0], type: x[1], address: x[2], contact_person: x[3], contact_number: x[4], email: x[5], link: x[1] === 'shopee' ? 'https://shopee.ph/plyboard' : null, materials: x[6], status: x[7], notes: null, created_at: tsAgo(200 - i * 20) }))

  /* purchase orders → 10 (local restocks) */
  mkPo(6, 'PO-2026-0088', 'Goldstar Hardware', 'Quezon Ave., Lucena City', 20, -16, 'Received', null, 'PHP', 0, [['GS-SCR-3', '—', 'Wood screws #8 × 3in (box 500)', '—', 12, 380, 0], ['GS-GLUE-4L', '—', 'Wood glue 4L', '—', 10, 620, 0]], 1, null)
  mkPo(7, 'PO-2026-0090', 'Tayabas Rattan Works', 'Tayabas City, Quezon', 15, -9, 'Received', null, 'PHP', 30, [['RT-POLE-25', 'Natural', 'Rattan pole 25mm × 3m', '—', 80, 145, 0], ['RT-WEAVE', 'Natural', 'Wicker weave roll 1m × 20m', '—', 6, 3200, 0]], 1, 'For accent chair batch')
  mkPo(8, 'PO-2026-0093', 'Uratex Foam — Southern Luzon', 'Sto. Tomas, Batangas', 7, 1, 'Ordered', null, 'PHP', 50, [['UX-10IN-6075', 'White', 'Mattress 60×75 — 10in Foam', '152×190×25', 10, 6200, 0]], 0, null)
  mkPo(9, 'PO-2026-0096', 'Ply&Board Depot (Shopee)', 'Shopee PH', 3, 5, 'Sent', null, 'PHP', 0, [['PB-EDGE-WHT', 'White', 'PVC edge banding 22mm × 100m', '—', 8, 890, 0], ['PB-LAM-WAL', 'Walnut', 'HPL laminate sheet 4×8', '—', 12, 1650, 0]], 0, null)
  mkPo(10, 'PI-HY-2026-012', 'Guangzhou Hongyi Hardware', 'Guangzhou, China', 12, 30, 'Deposit Paid', 'TGHU 553 018-7 · 20GP', 'USD', 30, [['HY-HNG-SC', 'Nickel', 'Soft-close hinge 35mm (ctn 200)', '—', 20, 62.0, 0.1], ['HY-SLIDE-18', 'Zinc', 'Ball-bearing slide 18in (ctn 50 pr)', '—', 16, 84.0, 0.12]], 0, 'Deposit wired ' + dayIso(10))
  ship.insert({ id: 4, po_id: 8, eta: daysAheadIso(1), arrived_date: null, tracking_no: null, forwarder: 'Uratex delivery', received_by: null, created_at: tsAgo(5) })
  ship.insert({ id: 5, po_id: 9, eta: daysAheadIso(5), arrived_date: null, tracking_no: 'SPXPH0421187722', forwarder: 'SPX Express', received_by: null, created_at: tsAgo(2) })
  ship.insert({ id: 6, po_id: 10, eta: daysAheadIso(30), arrived_date: null, tracking_no: 'TGHU5530187', forwarder: 'Royal Cargo', received_by: null, created_at: tsAgo(10) })

  /* product costing → 10 */
  mkCost(5, 'Accent Chair — Rattan', null, '28 × 30 × 32 in', 'Chair', 7600, null, [['material', '3', 'Rattan pole 25mm × 3m', 145], ['material', '0.5', 'Wicker weave (m)', 3200], ['material', '1', 'Cushion foam + fabric', 950], ['labor', '1', 'Weaver', 900], ['overhead', '1', 'Finish, packaging', 300]])
  mkCost(6, 'Wardrobe 3-Door — White Duco', null, '60 × 22 × 80 in', 'Cabinet', 27400, null, [['material', '4', 'Marine plywood 3/4 4×8', 1980], ['material', '1', 'Duco paint white 4L', 1450], ['material', '6', 'Soft-close hinge (pair)', 95], ['material', '1', 'Hanging rod, screws', 650], ['labor', '1', 'Cabinet maker', 3800], ['overhead', '1', 'Finish, packaging, QC', 800]])
  mkCost(7, 'Bunk Bed — Pine', null, '36 × 75 in', 'Bed Frame', 18900, 'Includes ladder + guard rail', [['material', '10', 'Pine 2×4×10ft', 420], ['material', '8', 'Gmelina 2×2×8ft slats', 320], ['material', '1', 'Bolts, brackets', 780], ['labor', '1', 'Carpenter — bunk', 2600], ['overhead', '1', 'Stain, packaging', 600]])
  mkCost(8, 'TV Console 1.8m', null, '1.8 m × 0.4 m × 0.5 m', 'Cabinet', 14200, null, [['material', '2', 'Marine plywood 3/4 4×8', 1980], ['material', '1', 'Walnut laminate sheet', 1650], ['material', '2', 'Ball-bearing drawer slide 18in', 260], ['labor', '1', 'Cabinet maker', 2200], ['overhead', '1', 'Finish, packaging', 500]])
  mkCost(9, 'Bookshelf 5-Tier — Oak', null, '32 × 12 × 72 in', 'Cabinet', 11800, null, [['material', '2', 'Marine plywood 3/4 4×8', 1980], ['material', '1', 'Oak stain + sealer', 1180], ['labor', '1', 'Carpenter', 1800], ['overhead', '1', 'Packaging', 400]])
  mkCost(10, 'Bar Stools (set of 4)', null, '16 × 16 × 30 in', 'Chair', 9800, null, [['material', '8', 'Gmelina 2×2×8ft', 320], ['material', '4', 'Seat pad + PU leather', 380], ['labor', '4', 'Carpenter — stool', 450], ['overhead', '1', 'Finish, packaging', 500]])

  /* mattress orders → 12 */
  ;([['Ronnie Baluyot', 'Uratex Premium 60×75 6in ×1', 2, 'Done', 'GCash'], ['Ma. Fe Lorenzo', 'Uratex Senso 48×75 8in ×2', 4, 'Pending', null], ['Ate Beth Canteen', 'Uratex Kiddie 30×75 4in ×4', 7, 'Done', 'Cash'], ['Dr. Villanueva', 'Uratex Senso 72×75 10in ×1', 11, 'Done', 'GCash']] as [string, string, number, string, string | null][]).forEach((m, i) => { const amt = /8in/.test(m[1]) ? 8900 : /10in/.test(m[1]) ? 12400 : /4in/.test(m[1]) ? 3200 : 6400; const n = Number(/×(\d)/.exec(m[1])?.[1] ?? 1); mo.insert({ id: 9 + i, client: m[0], order: m[1], order_date: dayIso(m[2] as number), status: m[3], region: 'Luzon', amount: amt * n, paid_via: m[4], done_at: m[3] === 'Done' ? tsAgo(Math.max(0, (m[2] as number) - 1), 16, 0) : null, created_at: tsAgo(m[2] as number, 10, 0) }) })

  /* design details → 10 */
  ;[candidates[30], candidates[33], candidates[36], candidates[39], candidates[42 % candidates.length]].filter(Boolean).forEach((o, i) => {
    const line = o.receipt_items[0]; const p = bySku.get(line.sku); const st = ['Sent', 'Draft', 'Approved', 'Sent', 'Approved'][i]
    dd.insert({ id: 36 + i, dd_number: `DD-2026-00${36 + i}`, order_number: o.order_number, customer_name: o.customer_name, address: o.address, title: line.description, sku: line.sku, bullets: [p?.dimension ?? '', `Finish: ${p?.color ?? 'as sample'}`, 'Delivery incl. assembly on site'], photo_url: imageFor(line.sku), photo_w: 640, photo_h: 480, swatch_url: swatch(p?.color ?? 'natural'), swatch_label: p?.color ?? null, labels: [], mattress: null, headboard: null, note: null, image_url: imageFor(line.sku), status: st, created_by: o.assigned ?? 'Ana Noriega', sent_count: st === 'Draft' ? 0 : 1, sent_at: st === 'Draft' ? null : tsAgo(3 + i, 14, 0), replied_at: st === 'Approved' ? tsAgo(2 + i, 18, 0) : null, replied_psid: null, followup_count: 0, last_followup_at: null, insets: [], specs: ['Standard build'], created_at: tsAgo(3 + i, 13, 0), updated_at: tsAgo(2 + i, 18, 0) })
  })

  /* requested edit orders → 10 */
  ;[orders[35], orders[40], orders[45], orders[50], orders[55]].filter(Boolean).forEach((o, i) => { const before = snap(o); const reasons = ['Customer requests earlier delivery', 'Add rush fee — customer agreed', 'Typo in customer name', 'Change source to Facebook', 'Update email for e-receipt']; const patch: Partial<typeof before> = [{ date_of_delivery: daysAheadIso(2) }, { is_rush: true, rush_days: 3 }, { customer_name: before.customer_name + ' Jr.' }, { source: 'Facebook' }, { email: 'customer' + i + '@gmail.com' }][i]; const status = i < 3 ? 'pending' : i === 3 ? 'approved' : 'rejected'; er.insert({ id: 45 + i, order_id: o.id, order_number: o.order_number, requested_by: o.assigned ?? 'Bea Lim', reason: reasons[i], before, proposed: { ...before, ...patch }, status, decided_by: status === 'pending' ? null : 'Rowena Purificacion', decided_at: status === 'pending' ? null : tsAgo(1, 16, 0), created_at: tsAgo(i, 8 + i, 45) }) })

  /* payment approvals → 10 */
  orders.filter((o) => Number(o.full_payment_price) > Number(o.downpayment_price) + Number(o.full_payment)).slice(6, 10).forEach((o, i) => { const bal = Number(o.full_payment_price) - Number(o.downpayment_price) - Number(o.full_payment); pa.insert({ id: 76 + i, order_id: o.id, order_number: o.order_number, amount: bal, method: ['Cash', 'GCash', 'Maya', 'Bank Transfer'][i], collected_by: 'Delivery Team', submitted_by: ['Marlon Reyes', 'Rey Santos', 'Boyet Manalo', 'Jhun Ilagan'][i], proof_urls: roomPhotos(i + 9, 1), status: i < 2 ? 'pending' : 'approved', note: null, reviewed_by: i < 2 ? null : 'Joe Marie Casela', reviewed_at: i < 2 ? null : tsAgo(1 + i, 17, 0), dedupe_key: `${o.id}|${bal}|x${i}`, created_at: tsAgo(i, 13, 0), return_id: null, return_no: null }) })

  /* stock adjustments → 10 */
  ;([['SF-LSH-GL', 1, 1, 0], ['BD-QN-NAR', 3, 3, 0], ['BD-BNK-PN', 4, 5, -1], ['DN-6S-ACA', 1, 1, 0], ['WD-3D-WHT', 2, 2, 0], ['MT-6075-8', 13, 12, 1], ['TB-CTR-MRB', 3, 3, 0], ['TV-CON-18', 4, 4, 0]] as [string, number, number, number][]).forEach((x, i) => d.table('stock_adjustments').insert({ sku: x[0], product_name: PRODUCTS.find((p) => p.sku === x[0])?.product_name ?? String(x[0]), inventory_id: PRODUCTS.find((p) => p.sku === x[0])?.id ?? null, counted_qty: x[1], system_qty: x[2], variance: x[3], reason: x[3] === 0 ? 'Monthly count' : x[3] < 0 ? 'Cycle count — short, checking dispatch logs' : 'Cycle count — extra unit found in L6-A2', status: i % 3 === 0 ? 'pending' : 'approved', counted_by: 'Dennis Villanueva', approved_by: i % 3 === 0 ? null : 'Rowena Purificacion', created_at: tsAgo(2 + i * 3, 15, 0), approved_at: i % 3 === 0 ? null : tsAgo(2 + i * 3, 17, 0) }))

  /* HR: leaves → 10, advances → 10 */
  ;[['Vacation', 2, 3, true, 'Family trip', 'Approved'], ['Sick', 1, 1, true, 'Fever', 'Approved'], ['Emergency', 1, 1, false, 'Family emergency', 'Approved'], ['Vacation', 5, 6, true, 'Fiesta', 'Pending'], ['Sick', 2, 2, true, 'Dental', 'Rejected'], ['Vacation', 1, 1, true, 'Personal', 'Approved'], ['Maternity', 60, 60, true, 'Maternity leave', 'Approved'], ['Sick', 1, 1, true, 'Flu', 'Pending']].forEach((x, i) => d.table('hr_leaves').insert({ employee_id: emp(i + 4).id, leave_type: x[0], date_from: i % 2 ? daysAheadIso(Number(x[1])) : dayIso(Number(x[1]) + 3), date_to: i % 2 ? daysAheadIso(Number(x[1]) + Number(x[2]) - 1) : dayIso(4), days: x[2], paid: x[3], reason: x[4], status: x[5], approved_by: x[5] === 'Approved' || x[5] === 'Rejected' ? 'demo-human_resources' : null, created_at: tsAgo(1 + i, 9, 0) }))
  ;[[2500, 0, 3, 'School supplies', 'Open'], [4000, 2000, 20, 'Motorcycle repair', 'Open'], [1500, 1500, 40, 'Medical', 'Paid'], [3000, 1000, 10, 'Rent', 'Open'], [5000, 0, 1, 'Emergency', 'Pending'], [2000, 2000, 60, 'Tuition', 'Paid'], [1000, 500, 8, 'Groceries', 'Open'], [3500, 0, 2, 'Hospital bill', 'Pending']].forEach((x, i) => d.table('hr_advances').insert({ employee_id: emp(i + 6).id, amount: x[0], deducted: x[1], date_issued: dayIso(Number(x[2])), reason: x[3], status: x[4], created_at: tsAgo(Number(x[2]), 10, 0) }))
  /* two older payroll runs so the payroll history has depth */
  ;[[49, 35, 33], [34, 20, 18]].forEach(([ps, pe, pd]) => {
    const run = d.table('hr_payroll_runs').insert({ period_start: dayIso(ps), period_end: dayIso(pe), pay_date: dayIso(pd), status: 'Released', notes: null, pay_type: 'Semi-monthly' })
    for (const e of EMPLOYEES.filter((x) => x.rate_type === 'Daily')) { const days = 12, ot = (e.id + ps) % 5, basic = e.rate * days, otPay = Math.round((e.rate / 8) * 1.25 * ot), gross = basic + otPay; d.table('hr_payslips').insert({ run_id: run.id, employee_id: e.id, days_worked: days, hours: days * 8, ot_hours: ot, basic_pay: basic, ot_pay: otPay, allowance: 0, gross, sss: 570, philhealth: 450, pagibig: 200, tax: 0, cash_advance: 0, other_deductions: 0, net_pay: gross - 1220, status: 'Released', created_at: tsAgo(pd) }) }
  })

  /* stock build → 10 */
  ;[['BD-BNK-PN', 1, 2, 'in progress', 'Bunk beds sell out every enrollment season'], ['TB-CTR-MRB', 3, 3, 'done', 'Showroom + 2 buffer'], ['OF-TBL-WAL', 3, 4, 'accepted', 'Office bulk inquiry — prepare stock'], ['SH-5T-OAK', 3, 3, 'pending', 'Low stock — 5 on hand'], ['CH-BAR-4', 1, 6, 'qc passed', 'Bar stool sets for the fiesta rush'], ['WD-3D-WHT', 1, 2, 'in progress', 'Wardrobe demand — website'], ['TV-CON-18', 1, 3, 'pending', 'TV console low stock']].forEach((x, i) => { const p = PRODUCTS.find((q) => q.sku === x[0])!; jobs.insert({ order_id: null, order_number: null, workshop_id: x[1], item_desc: `${p.product_name}\n${p.color ?? ''} · ${p.dimension}`, qty: x[2], status: x[3], dispatched_at: tsAgo(2 + i * 2, 8, 30), updated_at: tsAgo(i, 9, 0), qc_received_at: x[3] === 'qc passed' ? tsAgo(i, 15, 0) : null, fulfillment: 'warehouse', stock_request: true, stock_sku: x[0], stock_reason: x[4], stock_by: 'Rowena Purificacion' }) })

  /* FB AI agent: scripts → 10, contacts → 10 */
  ;[['Store hours', 'open, hours, bukas, oras', 'Bukas po kami Lunes–Sabado 9AM–6PM sa showroom sa Lucena City.'], ['Location', 'saan, location, address, showroom', 'Nasa Brgy. Ibabang Dupay, Lucena City ang showroom — may parking po.'], ['Payment', 'gcash, maya, bayad, downpayment, installment', '30% downpayment po para ma-schedule ang production; GCash, Maya, BDO at BPI po ang tinatanggap.'], ['Warranty', 'warranty, sira, repair', 'May 1-year warranty po sa frame at workmanship. I-message lang po ang order number para ma-schedule ang repair.'], ['Custom size', 'custom, sukat, pasadya, made to order', 'Pwede po ang custom size! Pakisend ng sukat at peg photo — bibigyan po kayo ng formal quotation sa loob ng 24 oras.'], ['Lead time', 'ilang araw, kailan, tagal, lead time', '12–15 working days po ang production, dagdag 1–3 araw para sa delivery.'], ['Fabric options', 'tela, fabric, kulay, color, swatch', 'May 40+ fabric swatches po kami — velvet, linen, at leatherette. Send ko po ang swatch library?']].forEach((x, i) => d.table('fb_scripts').insert({ id: 4 + i, label: x[0], keywords: x[1], reply: x[2], alt_replies: null, priority: 4 + i, active: i !== 5, is_fallback: false, created_at: tsAgo(25 - i) }))
  const fbc = d.table('fb_contacts')
  CUST.slice(0, 10).forEach((name, i) => fbc.insert({ psid: String(5510001 + i), name, first_name: name.split(' ')[0], last_name: name.split(' ').slice(1).join(' '), profile_pic: null, last_message: ['Magkano po ang 3-seater?', 'Available pa po ba ang queen bed?', 'Pa-quote po ng kitchen cabinet 3.2m', 'Kailan po delivery sa Sariaya?', 'May warranty po ba?', 'Pwede po custom color?', 'Saan po showroom?', 'GCash po ba ok?', 'Ilang araw po lead time?', 'Send po swatches'][i], last_message_at: tsAgo(i, 9 + i, 12), last_intent: ['price', 'stock', 'quote', 'delivery', 'warranty', 'custom', 'location', 'payment', 'lead_time', 'fabric'][i], handled_by: i % 3 === 0 ? 'human' : 'agent', order_number: null, created_at: tsAgo(10 + i) }))

  /* email outbox → 10 (receipts / confirmations the n8n mailer would have sent) */
  orders.slice(0, 10).forEach((o, i) => d.table('email_outbox').insert({ to: o.email ?? 'customer@example.com', subject: i % 2 ? `Your PAN Furniture receipt — ${o.order_number}` : `Delivery confirmed — ${o.order_number}`, template: i % 2 ? 'receipt' : 'delivery_confirm', status: i === 3 ? 'failed' : 'sent', error: i === 3 ? 'Mailbox full' : null, order_number: o.order_number, created_at: tsAgo(i, 10, 30), sent_at: i === 3 ? null : tsAgo(i, 10, 31) }))


  /* Formal Quotation table only lists FQs whose MTO request is Approved / Ordered — link every FQ */
  const mtoT = d.table('mto_requests')
  for (const q of d.table('quotations').rows) {
    const fq = q.fq_number as string | null
    if (!fq) continue
    const hit = mtoT.rows.find((m) => m.fq_number === fq)
    const item = ((q.items as { description: string }[]) ?? [])[0]?.description ?? 'Custom build'
    if (hit) { if (!['Approved', 'Ordered'].includes(String(hit.status))) hit.status = q.status === 'Converted' ? 'Ordered' : 'Approved'; continue }
    mtoT.insert({ mto_number: `MTO-0${Number(String(fq).slice(-3)) + 100}`, sku: 'CUSTOM', slug: item.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40), product_name: item.split(' — ')[0], category: /sofa|sala/i.test(item) ? 'Sofa' : /bed|bunk/i.test(item) ? 'Bed Frame' : /dining/i.test(item) ? 'Dining' : /table|desk/i.test(item) ? 'Table' : 'Cabinet', image_url: q.image_url ?? null, build: { lines: [{ label: 'Size: ' + (item.match(/\d[\d.,]*\s*(m|in|cm)[^,—]*/)?.[0] ?? 'standard') }, { label: 'Fabric: ' + (item.split(' — ')[1] ?? 'as sample') }] }, customer_name: q.customer_name, contact: `0917 555 0${String(q.id).padStart(3, '0')}`, address: q.address, psid: null, status: q.status === 'Converted' ? 'Ordered' : 'Approved', fq_number: fq, order_number: q.order_number ?? null, created_at: q.created_at, echoed_at: null, address_lat: null, address_lng: null, fb_name: null, fb_link: null })
  }

  void pick; void daysAheadIso
}
