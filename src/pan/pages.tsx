import { useState, type ReactNode } from 'react'
import { usePan, peso, orderTotal, orderPaid, DOWNPAYMENT, ROLE_LABEL, type Order, type Payment, type Team, type Role, type Job } from './store'
import { labelFor } from './legacy-groups'

/* ---------- primitives mirroring components/ui.tsx ---------- */
function PageHeader({ title, subtitle, action }: { title: string; subtitle?: string; action?: ReactNode }) {
  return <div className="pan-ph"><div><h1>{title}</h1>{subtitle && <p>{subtitle}</p>}</div>{action && <div className="actions">{action}</div>}</div>
}
function StatCard({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return <div className="pan-stat"><small>{label}</small><strong>{value}</strong>{hint && <span>{hint}</span>}</div>
}
function Card({ title, sub, action, children, olive }: { title: string; sub?: string; action?: ReactNode; children: ReactNode; olive?: boolean }) {
  return <section className="pan-card"><div className="pan-card-h" style={olive ? { background: '#faf8f3' } : undefined}><div><h2>{title}</h2>{sub && <p>{sub}</p>}</div>{action}</div>{children}</section>
}
function Modal({ title, onClose, children, footer }: { title: string; onClose: () => void; children: ReactNode; footer?: ReactNode }) {
  return (
    <div className="pmodal-bg" onClick={onClose}>
      <div className="pmodal" onClick={(e) => e.stopPropagation()}>
        <div className="pmodal-h"><h3>{title}</h3><button className="pclose" onClick={onClose}>✕</button></div>
        <div className="pmodal-b">{children}</div>
        {footer && <div className="pmodal-f">{footer}</div>}
      </div>
    </div>
  )
}
const StatusPill = ({ s }: { s: Order['status'] }) => <span className={'pill ' + (s === 'Completed' ? 'green' : s === 'Partial' ? 'amber' : s === 'Cancelled' ? 'stone' : 'red')}>{s === 'Completed' ? 'Paid' : s === 'Partial' ? 'Partial' : s === 'Pending' ? 'Unpaid' : s}</span>
const OpsPill = ({ s }: { s: Order['ops'] }) => <span className={'pill ' + (s === 'Installed' || s === 'Delivered' ? 'green' : s === 'Out for Delivery' || s === 'Arrived' ? 'blue' : s === 'To Assign' ? 'red' : s === 'Ready' || s === 'Scheduled' ? 'gold' : 'amber')}>{s}</span>
const SourceChip = ({ s }: { s: Order['source'] }) => <span className={'chip ' + (s === 'Website' ? 'blue' : s === 'Facebook' ? 'amber' : s === 'Referral' ? 'green' : 'stone')}>{s}</span>

/* ---------- router ---------- */
export function Page({ path }: { path: string }) {
  switch (path) {
    case '/hr/overall': return <Overall />
    case '/orders': return <SalesOrders />
    case '/operations/approval': return <OrderApproval />
    case '/operations/delivery-queue': return <DeliveryQueue />
    case '/delivery': case '/operations/tracker': return <DeliveryTracker />
    case '/delivery/routes': case '/installation': return <TeamRoute />
    case '/workshop/jobs': return <WorkshopJobs />
    case '/quality-control': case '/workshop/quality-control': return <QualityControl />
    case '/inventory': case '/workshop/inventory': return <Inventory />
    case '/stock-movements': case '/workshop/logs': return <StockLedger />
    case '/mto-requests': return <MtoRequests />
    case '/hr/attendance': case '/hr/directory': return <Attendance />
    case '/audit-trail': return <ActivityLogs />
    case '/website/live': return <WebsiteLive />
    case '/customers': return <Customers />
    case '/operations/process-map': return <ProcessMap />
    default: return <Soon path={path} />
  }
}

/* ---------- PAN Overall (Sales Command Center) ---------- */
function Overall() {
  const { s } = usePan()
  const active = s.orders.filter((o) => o.status !== 'Cancelled')
  const booked = active.reduce((a, o) => a + orderTotal(o), 0)
  const collected = active.reduce((a, o) => a + orderPaid(o), 0)
  const target = 1200000
  const bySource = (['Showroom', 'Website', 'Facebook', 'Referral'] as const).map((src) => ({ src, v: active.filter((o) => o.source === src).reduce((a, o) => a + orderTotal(o), 0) }))
  const top = [...active].sort((a, b) => orderTotal(b) - orderTotal(a)).slice(0, 5)
  const stages: Order['ops'][] = ['To Assign', 'Workshop', 'QC', 'Ready', 'Scheduled', 'Out for Delivery', 'Delivered', 'Installed']
  const late = s.employees.filter((e) => e.status === 'Late').length
  return (
    <>
      <PageHeader title="PAN Overall" subtitle="Sales Command Center · Customers · Operations · HR — the admin's single view. Every figure is live from the same rows the staff work on." action={<button className="pbtn ghost">Set Monthly Targets</button>} />
      <div className="pan-stats">
        <StatCard label="Booked this month" value={peso(booked)} hint={`${active.length} orders · target ${peso(target)}`} />
        <StatCard label="Collected" value={peso(collected)} hint={`${Math.round((collected / booked) * 100)}% of booked · ${peso(booked - collected)} on balance / COD`} />
        <StatCard label="Awaiting approval" value={String(s.orders.filter((o) => o.ops === 'To Assign' && o.status !== 'Pending').length)} hint="paid ≥30%, not yet assigned" />
        <StatCard label="Out for delivery" value={String(s.deliveries.filter((d) => d.status === 'Out for Delivery').length)} hint={`${s.deliveries.filter((d) => d.status === 'Scheduled').length} scheduled · ${late} late clock-ins today`} />
      </div>
      <div className="pgrid3">
        <section className="pan-card"><div className="pan-card-b"><div className="pan-kicker">Projected vs target</div><div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', margin: '0.4rem 0' }}><span style={{ fontSize: 18, fontWeight: 800, color: '#3a2e14' }}>{peso(booked)}</span><span style={{ fontSize: 12, color: 'var(--muted)' }}>{Math.round((booked / target) * 100)}%</span></div><div className="pan-bar"><i style={{ width: `${Math.min(100, (booked / target) * 100)}%` }} /></div><div style={{ marginTop: 12, borderTop: '1px solid var(--border)', paddingTop: 12, fontSize: 12, color: 'var(--muted)' }}>Follow-up: {s.orders.filter((o) => o.status === 'Pending').length} unpaid orders need a downpayment nudge — Maya link resend is one click on Sales Orders.</div></div></section>
        <section className="pan-card"><div className="pan-card-b"><div className="pan-kicker">Source</div><div className="pan-list" style={{ marginTop: 8 }}>{bySource.map((b, i) => <div className="pan-list-row" key={b.src}><span className="n">{i + 1}</span><span className="t">{b.src}</span><span className="v">{peso(b.v)}</span></div>)}</div></div></section>
        <section className="pan-card pan-dark"><div className="pan-card-b"><div className="pan-kicker" style={{ color: '#caa45a' }}>Top orders</div><div className="pan-list" style={{ marginTop: 8 }}>{top.map((o, i) => <div className="pan-list-row" key={o.no} style={{ color: '#f4ead8' }}><span className="n" style={{ background: '#caa45a', color: '#3a2e14' }}>{i + 1}</span><span className="t">{o.customer} <small style={{ color: '#c9b896' }}>· {o.no}</small></span><span className="v" style={{ color: '#f4ead8' }}>{peso(orderTotal(o))}</span></div>)}</div></div></section>
      </div>
      <Card title="Where every order is" sub="Operations status across the whole book — click a stage's page in the sidebar to act on it.">
        <div className="pan-card-b" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 10 }}>
          {stages.map((st) => { const n = active.filter((o) => o.ops === st).length; return <div key={st} style={{ border: '1px solid var(--border)', borderRadius: 10, padding: '10px 12px' }}><div style={{ fontSize: 22, fontWeight: 800, color: '#3a2e14' }}>{n}</div><div style={{ fontSize: 11, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>{st}</div></div> })}
        </div>
      </Card>
      <Card title="Recent activity" sub="Immutable audit log — who did what, on which record.">
        <div className="pan-tablewrap"><table className="pan-table"><thead><tr><th>When</th><th>Who</th><th>Action</th><th>Module</th><th>Ref</th></tr></thead><tbody>{s.logs.slice(0, 8).map((l, i) => <tr key={i}><td className="muted mono" style={{ fontSize: 12 }}>{l.at}</td><td className="strong">{l.who}</td><td style={{ whiteSpace: 'normal' }}>{l.action}</td><td className="muted">{l.module}</td><td className="mono" style={{ fontSize: 12 }}>{l.ref}</td></tr>)}</tbody></table></div>
      </Card>
    </>
  )
}

/* ---------- Sales Orders ---------- */
function SalesOrders() {
  const { s, d } = usePan()
  const [q, setQ] = useState('')
  const [tab, setTab] = useState<'All' | Order['status']>('All')
  const [open, setOpen] = useState(false)
  const [payFor, setPayFor] = useState<Order | null>(null)
  const rows = s.orders.filter((o) => (tab === 'All' || o.status === tab) && (q === '' || (o.no + o.customer + o.phone).toLowerCase().includes(q.toLowerCase())))
  const counts = { Pending: s.orders.filter((o) => o.status === 'Pending').length, Partial: s.orders.filter((o) => o.status === 'Partial').length, Completed: s.orders.filter((o) => o.status === 'Completed').length }
  return (
    <>
      <PageHeader title="Sales Orders" subtitle="Every order from the showroom POS, panfurniture.ph checkout and the Facebook agent. A 30% downpayment reserves stock and sends the order to Operations for approval." action={<><button className="pbtn ghost">FB Sync</button><button className="pbtn primary" onClick={() => setOpen(true)}>+ Create Order</button></>} />
      <div className="pan-stats">
        <StatCard label="Orders" value={String(s.orders.length)} hint="all time in this demo" />
        <StatCard label="Unpaid" value={String(counts.Pending)} hint="no downpayment yet — stock not reserved" />
        <StatCard label="Partial" value={String(counts.Partial)} hint="≥30% paid · balance on delivery" />
        <StatCard label="Paid" value={String(counts.Completed)} hint="fully paid" />
      </div>
      <Card title="Orders" sub="Search by order no., customer or phone.">
        <div className="pan-card-b ptoolbar" style={{ paddingBottom: 0 }}>
          <input className="pinput" placeholder="Search…" value={q} onChange={(e) => setQ(e.target.value)} />
          <div className="ptabs">{(['All', 'Pending', 'Partial', 'Completed', 'Cancelled'] as const).map((t) => <button key={t} className={tab === t ? 'active' : ''} onClick={() => setTab(t)}>{t === 'Pending' ? 'Unpaid' : t === 'Completed' ? 'Paid' : t}</button>)}</div>
        </div>
        <div className="pan-tablewrap" style={{ marginTop: 12 }}>
          <table className="pan-table">
            <thead><tr><th>Order</th><th>Date</th><th>Customer</th><th>Items</th><th>Source</th><th className="r">Total</th><th className="r">Paid</th><th className="c">Payment</th><th className="c">Operations</th><th className="c">Actions</th></tr></thead>
            <tbody>
              {rows.length === 0 && <tr><td colSpan={10} className="pan-empty">No orders match.</td></tr>}
              {rows.map((o) => (
                <tr key={o.no}>
                  <td className="strong mono" style={{ fontSize: 12 }}>{o.no}{o.rush && <span className="chip amber" style={{ marginLeft: 6 }}>RUSH</span>}</td>
                  <td className="muted">{o.date}</td>
                  <td><div style={{ fontWeight: 500 }}>{o.customer}</div><div style={{ fontSize: 11, color: 'var(--muted)' }}>{o.phone}</div></td>
                  <td style={{ maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis' }} title={o.items.map((i) => `${i.qty}× ${i.name}`).join(', ')}>{o.items.map((i) => `${i.qty}× ${i.name}`).join(', ')}</td>
                  <td><SourceChip s={o.source} /></td>
                  <td className="r num strong">{peso(orderTotal(o))}</td>
                  <td className="r num">{peso(orderPaid(o))}</td>
                  <td className="c"><StatusPill s={o.status} /></td>
                  <td className="c"><OpsPill s={o.ops} /></td>
                  <td className="c" style={{ display: 'flex', gap: 6, justifyContent: 'center' }}>
                    {o.status !== 'Completed' && o.status !== 'Cancelled' && <button className="pbtn gold" onClick={() => setPayFor(o)}>Add payment</button>}
                    {o.ops === 'To Assign' && o.status !== 'Cancelled' && <button className="pbtn ghost sm" onClick={() => d({ type: 'cancel', no: o.no })}>Cancel</button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="pan-foot"><span>{rows.length} of {s.orders.length} orders</span><span style={{ textAlign: 'center' }}>Booked {peso(rows.reduce((a, o) => a + orderTotal(o), 0))}</span><span style={{ textAlign: 'right' }}>Collected {peso(rows.reduce((a, o) => a + orderPaid(o), 0))}</span></div>
      </Card>
      {open && <CreateOrder onClose={() => setOpen(false)} />}
      {payFor && <AddPayment order={s.orders.find((o) => o.no === payFor.no)!} onClose={() => setPayFor(null)} />}
    </>
  )
}

function CreateOrder({ onClose }: { onClose: () => void }) {
  const { s, d } = usePan()
  const [customer, setCustomer] = useState(''); const [phone, setPhone] = useState(''); const [address, setAddress] = useState(''); const [source, setSource] = useState<Order['source']>('Showroom'); const [notes, setNotes] = useState('')
  const [lines, setLines] = useState<{ sku: string; qty: number }[]>([{ sku: s.products[0].sku, qty: 1 }])
  const [payAmt, setPayAmt] = useState(''); const [method, setMethod] = useState<Payment['method']>('Maya QR')
  const items = lines.map((l) => { const p = s.products.find((x) => x.sku === l.sku)!; return { sku: p.sku, name: p.name, qty: l.qty, price: p.price, mto: p.mto, workshop: p.workshop } })
  const total = items.reduce((a, i) => a + i.qty * i.price, 0)
  const dp = Math.ceil(total * DOWNPAYMENT)
  const amt = Number(payAmt) || 0
  const ok = customer.trim() && phone.trim() && address.trim() && lines.length > 0
  const avail = (sku: string) => { const p = s.products.find((x) => x.sku === sku)!; return p.onHand - p.reserved }
  return (
    <Modal title="Create Sales Order" onClose={onClose} footer={<><button className="pbtn ghost" onClick={onClose}>Cancel</button><button className="pbtn dark" disabled={!ok} onClick={() => { d({ type: 'createOrder', order: { date: new Date().toISOString().slice(0, 10), customer, phone, address, source, items, sales: s.role ? ROLE_LABEL[s.role] : 'Sales', notes }, payment: amt > 0 ? { amount: amt, method } : undefined }); onClose() }}>Save order</button></>}>
      <div className="pgrid2">
        <div className="pfield"><label className="plabel">Customer name</label><input className="pinput" value={customer} onChange={(e) => setCustomer(e.target.value)} placeholder="Juan dela Cruz" /></div>
        <div className="pfield"><label className="plabel">Contact number</label><input className="pinput" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="0917 000 0000" /></div>
        <div className="pfield" style={{ gridColumn: '1 / -1' }}><label className="plabel">Delivery address</label><input className="pinput" value={address} onChange={(e) => setAddress(e.target.value)} placeholder="Brgy., City, Province" /><small>Address autocomplete + geo pin in production (route planner uses it).</small></div>
        <div className="pfield"><label className="plabel">Source</label><select className="pselect" value={source} onChange={(e) => setSource(e.target.value as Order['source'])}><option>Showroom</option><option>Website</option><option>Facebook</option><option>Referral</option></select></div>
        <div className="pfield"><label className="plabel">Notes</label><input className="pinput" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Color, fabric, special instructions" /></div>
      </div>
      <div>
        <label className="plabel">Line items</label>
        <div className="plines">
          {lines.map((l, i) => (
            <div className="pline" key={i}>
              <select className="pselect" value={l.sku} onChange={(e) => setLines(lines.map((x, k) => (k === i ? { ...x, sku: e.target.value } : x)))}>{s.products.map((p) => <option key={p.sku} value={p.sku}>{p.name} — {peso(p.price)}{p.mto ? ' · MTO' : ` · ${p.onHand - p.reserved} avail`}</option>)}</select>
              <input className="pinput" type="number" min={1} value={l.qty} onChange={(e) => setLines(lines.map((x, k) => (k === i ? { ...x, qty: Math.max(1, Number(e.target.value)) } : x)))} />
              <div className="r num">{peso(l.qty * s.products.find((p) => p.sku === l.sku)!.price)}</div>
              <button className="pclose" onClick={() => setLines(lines.filter((_, k) => k !== i))}>✕</button>
            </div>
          ))}
        </div>
        <button className="pbtn ghost sm" style={{ marginTop: 8 }} onClick={() => setLines([...lines, { sku: s.products[1].sku, qty: 1 }])}>+ Add line</button>
        {items.some((i) => !i.mto && avail(i.sku) < i.qty) && <div className="pnote" style={{ marginTop: 10 }}>Some stock lines exceed available inventory — Operations will route them to the workshop on approval.</div>}
        {items.some((i) => i.mto) && <div className="pnote info" style={{ marginTop: 10 }}>Made-to-order items go to the workshop after approval. Lead time is quoted on the receipt.</div>}
      </div>
      <div className="ptotals"><div><span>Subtotal</span><b>{peso(total)}</b></div><div><span>Required downpayment (30%)</span><b>{peso(dp)}</b></div></div>
      <div className="pgrid2">
        <div className="pfield"><label className="plabel">Downpayment now (optional)</label><input className="pinput" type="number" placeholder={String(dp)} value={payAmt} onChange={(e) => setPayAmt(e.target.value)} /><small>{amt >= dp && amt > 0 ? 'Meets 30% — stock will be reserved and the order goes to approval.' : amt > 0 ? `Below 30% — order stays Unpaid until ${peso(dp)} is received.` : 'Leave blank to send a Maya link and collect later.'}</small></div>
        <div className="pfield"><label className="plabel">Method</label><select className="pselect" value={method} onChange={(e) => setMethod(e.target.value as Payment['method'])}><option>Maya QR</option><option>Maya Card</option><option>Cash</option><option>Bank</option></select></div>
      </div>
    </Modal>
  )
}

function AddPayment({ order, onClose }: { order: Order; onClose: () => void }) {
  const { d } = usePan()
  const bal = orderTotal(order) - orderPaid(order)
  const [amt, setAmt] = useState(String(bal)); const [method, setMethod] = useState<Payment['method']>('Maya QR')
  const dp = Math.ceil(orderTotal(order) * DOWNPAYMENT)
  return (
    <Modal title={`Add payment · ${order.no}`} onClose={onClose} footer={<><button className="pbtn ghost" onClick={onClose}>Cancel</button><button className="pbtn dark" disabled={!(Number(amt) > 0)} onClick={() => { d({ type: 'addPayment', no: order.no, amount: Math.min(bal, Number(amt)), method }); onClose() }}>Record payment</button></>}>
      <div className="pan-stats" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}><StatCard label="Total" value={peso(orderTotal(order))} /><StatCard label="Paid" value={peso(orderPaid(order))} /><StatCard label="Balance" value={peso(bal)} /></div>
      <div className="pgrid2">
        <div className="pfield"><label className="plabel">Amount</label><input className="pinput" type="number" value={amt} onChange={(e) => setAmt(e.target.value)} /><small>{order.status === 'Pending' ? `Needs ${peso(dp - orderPaid(order))} more to reach the 30% downpayment.` : 'Any amount; full payment marks the order Paid and emails the BIR receipt.'}</small></div>
        <div className="pfield"><label className="plabel">Method</label><select className="pselect" value={method} onChange={(e) => setMethod(e.target.value as Payment['method'])}><option>Maya QR</option><option>Maya Card</option><option>Cash</option><option>Bank</option><option>COD</option></select></div>
      </div>
      <div className="pan-card"><div className="pan-tablewrap"><table className="pan-table"><thead className="olive"><tr><th>When</th><th>Method</th><th>Ref</th><th className="r">Amount</th></tr></thead><tbody>{order.payments.length === 0 && <tr><td colSpan={4} className="pan-empty">No payments yet.</td></tr>}{order.payments.map((p) => <tr key={p.id}><td className="muted">{p.at}</td><td>{p.method}</td><td className="mono" style={{ fontSize: 12 }}>{p.ref}</td><td className="r num strong">{peso(p.amount)}</td></tr>)}</tbody></table></div></div>
    </Modal>
  )
}

/* ---------- Order Approval (Operations) ---------- */
function OrderApproval() {
  const { s, d } = usePan()
  const queue = s.orders.filter((o) => o.ops === 'To Assign' && o.status !== 'Cancelled')
  const ready = queue.filter((o) => o.status !== 'Pending')
  const waiting = queue.filter((o) => o.status === 'Pending')
  const needsShop = (o: Order) => o.items.some((i) => { const p = s.products.find((x) => x.sku === i.sku)!; return i.mto || p.onHand - p.reserved + i.qty < i.qty })
  return (
    <>
      <PageHeader title="Order Approval" subtitle="Paid orders land here. Decide per order: send to the workshop (made-to-order or no stock) or skip the workshop and release from warehouse stock. Either way the customer gets an acknowledgement email." />
      <div className="pan-stats"><StatCard label="To assign" value={String(ready.length)} hint="downpayment met" /><StatCard label="Waiting on payment" value={String(waiting.length)} hint="not yet 30% — cannot be cut" /><StatCard label="In workshop" value={String(s.orders.filter((o) => o.ops === 'Workshop').length)} /><StatCard label="Ready for delivery" value={String(s.orders.filter((o) => o.ops === 'Ready').length)} /></div>
      <Card title="To-Assign queue" sub="Rows show whether stock covers the order right now.">
        <div className="pan-tablewrap"><table className="pan-table">
          <thead><tr><th>Order</th><th>Customer</th><th>Items</th><th className="c">Payment</th><th className="c">Stock check</th><th className="c">Decision</th></tr></thead>
          <tbody>
            {ready.length === 0 && <tr><td colSpan={6} className="pan-empty">Queue is clear. New paid orders from Sales appear here instantly.</td></tr>}
            {ready.map((o) => (
              <tr key={o.no}>
                <td className="strong mono" style={{ fontSize: 12 }}>{o.no}{o.rush && <span className="chip amber" style={{ marginLeft: 6 }}>RUSH</span>}</td>
                <td>{o.customer}<div style={{ fontSize: 11, color: 'var(--muted)' }}>{o.address}</div></td>
                <td style={{ whiteSpace: 'normal', maxWidth: 320 }}>{o.items.map((i) => <div key={i.sku} style={{ fontSize: 13 }}>{i.qty}× {i.name} {i.mto ? <span className="chip amber">MTO · {i.workshop}</span> : <span className="chip stone">stock</span>}</div>)}</td>
                <td className="c"><StatusPill s={o.status} /><div style={{ fontSize: 11, color: 'var(--muted)' }}>{peso(orderPaid(o))} / {peso(orderTotal(o))}</div></td>
                <td className="c">{needsShop(o) ? <span className="pill amber">Needs workshop</span> : <span className="pill green">In stock</span>}</td>
                <td className="c" style={{ display: 'flex', gap: 6, justifyContent: 'center' }}>
                  <button className="pbtn primary sm" onClick={() => d({ type: 'approve', no: o.no, mode: 'workshop' })}>Assign to Workshop</button>
                  <button className="pbtn ghost sm" disabled={needsShop(o)} title={needsShop(o) ? 'Stock does not cover this order' : ''} onClick={() => d({ type: 'approve', no: o.no, mode: 'stock' })}>Skip — use stock</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table></div>
      </Card>
      {waiting.length > 0 && <Card title="Waiting on downpayment" sub="Sales sees the same list with a Maya link resend."><div className="pan-tablewrap"><table className="pan-table"><thead className="olive"><tr><th>Order</th><th>Customer</th><th className="r">Total</th><th className="r">Needed (30%)</th><th>Source</th></tr></thead><tbody>{waiting.map((o) => <tr key={o.no}><td className="mono" style={{ fontSize: 12 }}>{o.no}</td><td>{o.customer}</td><td className="r num">{peso(orderTotal(o))}</td><td className="r num strong">{peso(Math.ceil(orderTotal(o) * DOWNPAYMENT))}</td><td><SourceChip s={o.source} /></td></tr>)}</tbody></table></div></Card>}
    </>
  )
}

/* ---------- Workshop ---------- */
function WorkshopJobs() {
  const { s, d } = usePan()
  const myShop = s.role === 'workshop_gma_original' ? 'GMA Original' : s.role === 'workshop_gma_white' ? 'GMA White' : s.role === 'workshop_lrt' ? 'LRT' : null
  const [shop, setShop] = useState<string>(myShop ?? 'All')
  const jobs = s.jobs.filter((j) => shop === 'All' || j.workshop === shop)
  const workers = { 'GMA Original': ['Mang Rey', 'Aldrin'], 'GMA White': ['Mang Boy', 'Jomar'], LRT: ['Kuya Jun', 'Nilo'] } as const
  const pillFor = (st: Job['status']) => st === 'QC Passed' ? 'green' : st === 'QC Failed' ? 'red' : st === 'Done' ? 'blue' : st === 'In Progress' ? 'amber' : st === 'Accepted' ? 'gold' : 'stone'
  return (
    <>
      <PageHeader title="My Jobs" subtitle={`${myShop ?? 'All workshops'} · Accept a job, log progress, then declare it for QC. HR generates the constructor's pay from the approved QC declaration.`} action={!myShop && <div className="ptabs">{['All', 'GMA Original', 'GMA White', 'LRT'].map((w) => <button key={w} className={shop === w ? 'active' : ''} onClick={() => setShop(w)}>{w}</button>)}</div>} />
      <div className="pan-stats"><StatCard label="Pending" value={String(jobs.filter((j) => j.status === 'Pending').length)} hint="assigned, not accepted" /><StatCard label="In progress" value={String(jobs.filter((j) => j.status === 'Accepted' || j.status === 'In Progress').length)} /><StatCard label="For QC" value={String(jobs.filter((j) => j.status === 'Done').length)} /><StatCard label="Passed QC" value={String(jobs.filter((j) => j.status === 'QC Passed').length)} /></div>
      <Card title="Jobs" sub="One job per order line that needs building.">
        <div className="pan-tablewrap"><table className="pan-table">
          <thead><tr><th>Job</th><th>Order</th><th>Item</th><th>Workshop</th><th>Worker</th><th className="c">Status</th><th className="c">Action</th></tr></thead>
          <tbody>
            {jobs.length === 0 && <tr><td colSpan={7} className="pan-empty">No jobs. Approve an order with a made-to-order item to create one.</td></tr>}
            {jobs.map((j) => (
              <tr key={j.id}>
                <td className="strong mono" style={{ fontSize: 12 }}>{j.id}</td><td className="mono muted" style={{ fontSize: 12 }}>{j.orderNo}</td><td>{j.qty}× {j.name}</td><td>{j.workshop}</td>
                <td>{j.status === 'Pending' ? <select className="pselect" style={{ padding: '4px 8px', fontSize: 12 }} defaultValue="" onChange={(e) => d({ type: 'job', id: j.id, status: 'Accepted', worker: e.target.value })}><option value="" disabled>Assign worker…</option>{workers[j.workshop].map((w) => <option key={w}>{w}</option>)}</select> : j.worker ?? '—'}</td>
                <td className="c"><span className={'pill ' + pillFor(j.status)}>{j.status}</span></td>
                <td className="c" style={{ display: 'flex', gap: 6, justifyContent: 'center' }}>
                  {j.status === 'Accepted' && <button className="pbtn gold" onClick={() => d({ type: 'job', id: j.id, status: 'In Progress' })}>Start</button>}
                  {j.status === 'In Progress' && <button className="pbtn primary sm" onClick={() => d({ type: 'job', id: j.id, status: 'Done' })}>Done → declare QC</button>}
                  {j.status === 'QC Failed' && <button className="pbtn ghost sm" onClick={() => d({ type: 'job', id: j.id, status: 'In Progress' })}>Rework</button>}
                  {(j.status === 'Done' || j.status === 'QC Passed') && <span style={{ fontSize: 12, color: 'var(--muted)' }}>{j.hours}h logged</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table></div>
      </Card>
    </>
  )
}

function QualityControl() {
  const { s, d } = usePan()
  const forQc = s.jobs.filter((j) => j.status === 'Done')
  const done = s.jobs.filter((j) => j.status === 'QC Passed' || j.status === 'QC Failed')
  return (
    <>
      <PageHeader title="Quality Control" subtitle="Workshop declarations waiting for a QC pass. Passing posts the item into warehouse stock (WHS In) and releases it to the order (Order Release) in one atomic movement." />
      <Card title={`For QC · ${forQc.length}`} sub="Checklist and photos are attached to each declaration in production.">
        <div className="pan-tablewrap"><table className="pan-table">
          <thead><tr><th>Job</th><th>Order</th><th>Item</th><th>Workshop</th><th>Worker</th><th className="c">Hours</th><th className="c">Decision</th></tr></thead>
          <tbody>
            {forQc.length === 0 && <tr><td colSpan={7} className="pan-empty">Nothing waiting. Finish a job in My Jobs to declare it.</td></tr>}
            {forQc.map((j) => <tr key={j.id}><td className="strong mono" style={{ fontSize: 12 }}>{j.id}</td><td className="mono muted" style={{ fontSize: 12 }}>{j.orderNo}</td><td>{j.qty}× {j.name}</td><td>{j.workshop}</td><td>{j.worker}</td><td className="c num">{j.hours}h</td><td className="c" style={{ display: 'flex', gap: 6, justifyContent: 'center' }}><button className="pbtn primary sm" onClick={() => d({ type: 'qc', id: j.id, pass: true })}>Pass</button><button className="pbtn danger sm" onClick={() => d({ type: 'qc', id: j.id, pass: false })}>Fail → rework</button></td></tr>)}
          </tbody>
        </table></div>
      </Card>
      <Card title="Recent decisions"><div className="pan-tablewrap"><table className="pan-table"><thead className="olive"><tr><th>Job</th><th>Order</th><th>Item</th><th className="c">Result</th></tr></thead><tbody>{done.map((j) => <tr key={j.id}><td className="mono" style={{ fontSize: 12 }}>{j.id}</td><td className="mono muted" style={{ fontSize: 12 }}>{j.orderNo}</td><td>{j.name}</td><td className="c"><span className={'pill ' + (j.status === 'QC Passed' ? 'green' : 'red')}>{j.status}</span></td></tr>)}</tbody></table></div></Card>
    </>
  )
}

/* ---------- Delivery ---------- */
function DeliveryQueue() {
  const { s, d } = usePan()
  const ready = s.orders.filter((o) => o.ops === 'Ready')
  const [pick, setPick] = useState<Record<string, { team: Team; date: string }>>({})
  const tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate() + 1)
  const def = { team: 'Team A' as Team, date: tomorrow.toISOString().slice(0, 10) }
  const load = (['Team A', 'Team B', 'Team C', 'Team D'] as Team[]).map((t) => ({ t, n: s.deliveries.filter((x) => x.team === t && (x.status === 'Scheduled' || x.status === 'Out for Delivery')).length }))
  return (
    <>
      <PageHeader title="Delivery Queue" subtitle="Orders that passed QC or were released from stock. Assign a team and a date; the driver's tablet gets the stop, the customer gets the out-for-delivery email and tracking link." />
      <div className="pan-stats">{load.map((l) => <StatCard key={l.t} label={l.t} value={String(l.n)} hint="active stops" />)}</div>
      <Card title={`Ready to schedule · ${ready.length}`}>
        <div className="pan-tablewrap"><table className="pan-table">
          <thead><tr><th>Order</th><th>Customer</th><th>Address</th><th className="r">COD balance</th><th>Team</th><th>Date</th><th className="c">Action</th></tr></thead>
          <tbody>
            {ready.length === 0 && <tr><td colSpan={7} className="pan-empty">Nothing ready. Pass a QC declaration or approve a stock order.</td></tr>}
            {ready.map((o) => { const p = pick[o.no] ?? def; return (
              <tr key={o.no}>
                <td className="strong mono" style={{ fontSize: 12 }}>{o.no}</td><td>{o.customer}</td><td className="muted">{o.address}</td><td className="r num strong">{peso(Math.max(0, orderTotal(o) - orderPaid(o)))}</td>
                <td><select className="pselect" style={{ padding: '4px 8px', fontSize: 12 }} value={p.team} onChange={(e) => setPick({ ...pick, [o.no]: { ...p, team: e.target.value as Team } })}>{['Team A', 'Team B', 'Team C', 'Team D'].map((t) => <option key={t}>{t}</option>)}</select></td>
                <td><input className="pinput" type="date" style={{ padding: '4px 8px', fontSize: 12 }} value={p.date} onChange={(e) => setPick({ ...pick, [o.no]: { ...p, date: e.target.value } })} /></td>
                <td className="c"><button className="pbtn primary sm" onClick={() => d({ type: 'schedule', no: o.no, team: p.team, date: p.date })}>Schedule</button></td>
              </tr>) })}
          </tbody>
        </table></div>
      </Card>
    </>
  )
}

const STEPS: Order['ops'][] = ['Scheduled', 'Out for Delivery', 'Arrived', 'Delivered', 'Installed']
function Timeline({ status }: { status: string }) {
  const idx = STEPS.indexOf(status as Order['ops'])
  return <div className="pan-timeline">{STEPS.map((st, i) => <div key={st} className={i < idx ? 'done' : i === idx ? 'now' : ''}><i>{i < idx ? '✓' : ''}</i>{st}</div>)}</div>
}

function DeliveryTracker() {
  const { s } = usePan()
  const rows = s.deliveries.map((dl) => ({ dl, o: s.orders.find((o) => o.no === dl.orderNo)! }))
  return (
    <>
      <PageHeader title="Delivery Tracker" subtitle="Every scheduled delivery with the team's live status. Drivers update from the tablet; customers see the same on panfurniture.ph/track." />
      <div className="pan-stats"><StatCard label="Scheduled" value={String(s.deliveries.filter((x) => x.status === 'Scheduled').length)} /><StatCard label="Out for delivery" value={String(s.deliveries.filter((x) => x.status === 'Out for Delivery' || x.status === 'Arrived').length)} /><StatCard label="Delivered" value={String(s.deliveries.filter((x) => x.status === 'Delivered').length)} hint="install pending" /><StatCard label="Installed" value={String(s.deliveries.filter((x) => x.status === 'Installed').length)} hint="warranty emailed" /></div>
      <div style={{ display: 'grid', gap: 12 }}>
        {rows.map(({ dl, o }) => (
          <section className="pan-card" key={dl.orderNo}><div className="pan-card-b" style={{ display: 'grid', gap: 12 }}>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center', justifyContent: 'space-between' }}>
              <div><b className="mono" style={{ fontSize: 13 }}>{dl.orderNo}</b> · <b>{o.customer}</b><div style={{ fontSize: 12, color: 'var(--muted)' }}>{o.address} · {o.items.map((i) => `${i.qty}× ${i.name}`).join(', ')}</div></div>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}><span className="pill gold">{dl.team} · {dl.driver}</span><span className="pill stone">{dl.date}</span>{dl.cod > 0 && <span className="pill red">COD {peso(dl.cod)}</span>}{dl.eta && dl.status === 'Out for Delivery' && <span className="pill blue">ETA {dl.eta}</span>}{dl.proof && <span className="pill green">Proof ✓</span>}</div>
            </div>
            <Timeline status={dl.status} />
          </div></section>
        ))}
      </div>
    </>
  )
}

function TeamRoute() {
  const { s, d } = usePan()
  const team: Team = s.role === 'delivery_team_b' ? 'Team B' : s.role === 'delivery_team_c' ? 'Team C' : s.role === 'delivery_team_d' ? 'Team D' : 'Team A'
  const [sel, setSel] = useState<Team>(team)
  const mine = s.deliveries.filter((x) => x.team === sel && x.status !== 'Installed').map((dl) => ({ dl, o: s.orders.find((o) => o.no === dl.orderNo)! }))
  const next = (st: string) => STEPS[STEPS.indexOf(st as Order['ops']) + 1]
  const isTeam = s.role?.startsWith('delivery')
  return (
    <>
      <PageHeader title="Delivery Route" subtitle={`${sel} · The driver tablet view. Each stop advances Out for Delivery → Arrived → Delivered (COD + proof photo) → Installed (warranty email).`} action={!isTeam && <div className="ptabs">{(['Team A', 'Team B', 'Team C', 'Team D'] as Team[]).map((t) => <button key={t} className={sel === t ? 'active' : ''} onClick={() => setSel(t)}>{t}</button>)}</div>} />
      <div style={{ display: 'grid', gap: 12, maxWidth: 720 }}>
        {mine.length === 0 && <div className="pan-card"><div className="pan-empty">No stops for {sel}. Schedule one from Delivery Queue.</div></div>}
        {mine.map(({ dl, o }) => (
          <section className="pan-card" key={dl.orderNo}><div className="pan-card-b" style={{ display: 'grid', gap: 10 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'flex-start' }}>
              <div><div className="mono" style={{ fontSize: 12, color: 'var(--muted)' }}>{dl.orderNo} · {dl.date}</div><div style={{ fontSize: 17, fontWeight: 700 }}>{o.customer}</div><div style={{ fontSize: 13, color: 'var(--muted)' }}>{o.address} · {o.phone}</div></div>
              {dl.cod > 0 ? <span className="pill red">COD {peso(dl.cod)}</span> : <span className="pill green">Paid</span>}
            </div>
            <div style={{ fontSize: 13 }}>{o.items.map((i) => <div key={i.sku}>{i.qty}× {i.name}</div>)}</div>
            <Timeline status={dl.status} />
            {next(dl.status) && <button className="pbtn dark" onClick={() => d({ type: 'delivery', no: dl.orderNo, status: next(dl.status) as never })}>{dl.status === 'Scheduled' ? 'Start delivery' : dl.status === 'Out for Delivery' ? 'Arrived at customer' : dl.status === 'Arrived' ? (dl.cod > 0 ? `Delivered · collect ${peso(dl.cod)} + proof photo` : 'Delivered · proof photo') : 'Installation done · send warranty'}</button>}
          </div></section>
        ))}
      </div>
    </>
  )
}

/* ---------- Inventory ---------- */
function Inventory() {
  const { s, d } = usePan()
  const [q, setQ] = useState('')
  const [inFor, setInFor] = useState<string | null>(null); const [qty, setQty] = useState('1'); const [ref, setRef] = useState('')
  const rows = s.products.filter((p) => (p.name + p.sku + p.category).toLowerCase().includes(q.toLowerCase()))
  const value = s.products.reduce((a, p) => a + p.onHand * p.price * 0.55, 0)
  return (
    <>
      <PageHeader title="Inventory Management" subtitle="On hand is physical stock. Reserved is committed to paid orders. Available is a generated column (on hand − reserved) and can never drift. Nothing here is edited by hand — use WHS In or an adjustment." action={<button className="pbtn ghost">Import CSV</button>} />
      <div className="pan-stats"><StatCard label="SKUs" value={String(s.products.length)} /><StatCard label="Units on hand" value={String(s.products.reduce((a, p) => a + p.onHand, 0))} /><StatCard label="Reserved" value={String(s.products.reduce((a, p) => a + p.reserved, 0))} hint="paid, not yet released" /><StatCard label="Stock value (cost)" value={peso(value)} hint="at 55% of list" /></div>
      <Card title="Stock" sub="Search by name, SKU or category.">
        <div className="pan-card-b" style={{ paddingBottom: 0 }}><input className="pinput" style={{ maxWidth: 320 }} placeholder="Search…" value={q} onChange={(e) => setQ(e.target.value)} /></div>
        <div className="pan-tablewrap" style={{ marginTop: 12 }}><table className="pan-table">
          <thead><tr><th>SKU</th><th>Product</th><th>Category</th><th>Workshop</th><th className="r">Price</th><th className="c">On hand</th><th className="c">Reserved</th><th className="c">Available</th><th className="c">Type</th><th className="c">Action</th></tr></thead>
          <tbody>{rows.map((p) => { const av = p.onHand - p.reserved; return (
            <tr key={p.sku}><td className="mono strong" style={{ fontSize: 12 }}>{p.sku}</td><td>{p.name}</td><td className="muted">{p.category}</td><td className="muted">{p.workshop}</td><td className="r num">{peso(p.price)}</td><td className="c num">{p.onHand}</td><td className="c num">{p.reserved}</td><td className="c"><span className={'pill ' + (av <= 0 ? 'red' : av <= 2 ? 'amber' : 'green')}>{av}</span></td><td className="c">{p.mto ? <span className="chip amber">MTO</span> : <span className="chip stone">Stock</span>}</td>
            <td className="c">{inFor === p.sku ? <span style={{ display: 'inline-flex', gap: 4 }}><input className="pinput" type="number" min={1} style={{ width: 64, padding: '4px 6px', fontSize: 12 }} value={qty} onChange={(e) => setQty(e.target.value)} /><input className="pinput" placeholder="Ref (PO / job)" style={{ width: 120, padding: '4px 6px', fontSize: 12 }} value={ref} onChange={(e) => setRef(e.target.value)} /><button className="pbtn primary sm" onClick={() => { d({ type: 'whsIn', sku: p.sku, qty: Math.max(1, Number(qty)), ref: ref || 'Manual receipt' }); setInFor(null); setRef('') }}>Post</button><button className="pbtn ghost sm" onClick={() => setInFor(null)}>✕</button></span> : <button className="pbtn gold" onClick={() => setInFor(p.sku)}>WHS In</button>}</td></tr>) })}</tbody>
        </table></div>
      </Card>
    </>
  )
}

function StockLedger() {
  const { s } = usePan()
  return (
    <>
      <PageHeader title="Stock Movement Ledger" subtitle="Append-only. Every row is one posted movement with the running balance after it. UPDATE and DELETE are blocked by trigger; the inventory table is a projection of this ledger and can be rebuilt from it." />
      <Card title={`Movements · ${s.ledger.length}`}>
        <div className="pan-tablewrap"><table className="pan-table">
          <thead><tr><th>Ledger ID</th><th>When</th><th>SKU</th><th>Type</th><th className="c">Qty in</th><th className="c">Qty out</th><th className="c">Balance</th><th>Reference</th><th>Posted by</th></tr></thead>
          <tbody>{s.ledger.map((m) => <tr key={m.id}><td className="mono strong" style={{ fontSize: 12 }}>{m.id}</td><td className="muted">{m.at}</td><td className="mono" style={{ fontSize: 12 }}>{m.sku}</td><td><span className={'pill ' + (m.type === 'WHS In' || m.type === 'Return' ? 'green' : m.type === 'Adjustment' ? 'amber' : 'blue')}>{m.type}</span></td><td className="c num" style={{ color: m.qtyIn ? '#047857' : undefined }}>{m.qtyIn || '—'}</td><td className="c num" style={{ color: m.qtyOut ? '#b91c1c' : undefined }}>{m.qtyOut || '—'}</td><td className="c num strong">{m.balance}</td><td className="muted">{m.ref}</td><td className="muted">{m.by}</td></tr>)}</tbody>
        </table></div>
      </Card>
    </>
  )
}

/* ---------- MTO Requests ---------- */
function MtoRequests() {
  const { s, d } = usePan()
  return (
    <>
      <PageHeader title="MTO Requests" subtitle="Quote requests from panfurniture.ph — the full build arrives here, in the Messenger thread, and as a push notification. Create Quotation opens the pre-filled Formal Quotation." />
      <div className="pan-stats" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}><StatCard label="New" value={String(s.mto.filter((m) => m.status === 'New').length)} /><StatCard label="Quoted" value={String(s.mto.filter((m) => m.status === 'Quoted').length)} /><StatCard label="Converted" value={String(s.mto.filter((m) => m.status === 'Converted').length)} hint="became a sales order" /></div>
      <Card title="Requests">
        <div className="pan-tablewrap"><table className="pan-table"><thead><tr><th>Request</th><th>Received</th><th>Customer</th><th>Item</th><th>Dimensions / finish</th><th className="r">Budget</th><th>Source</th><th className="c">Status</th><th className="c">Action</th></tr></thead>
          <tbody>{s.mto.map((m) => <tr key={m.id}><td className="mono strong" style={{ fontSize: 12 }}>{m.id}</td><td className="muted">{m.at}</td><td>{m.name}</td><td>{m.item}</td><td className="muted">{m.dims}</td><td className="r num">{peso(m.budget)}</td><td><span className={'chip ' + (m.source === 'Website' ? 'blue' : 'amber')}>{m.source}</span></td><td className="c"><span className={'pill ' + (m.status === 'New' ? 'red' : m.status === 'Quoted' ? 'amber' : 'green')}>{m.status}</span></td><td className="c">{m.status === 'New' && <button className="pbtn primary sm" onClick={() => d({ type: 'mto', id: m.id, status: 'Quoted' })}>Create Quotation</button>}{m.status === 'Quoted' && <button className="pbtn gold" onClick={() => d({ type: 'mto', id: m.id, status: 'Converted' })}>Convert to order</button>}</td></tr>)}</tbody></table></div>
      </Card>
    </>
  )
}

/* ---------- HR ---------- */
function Attendance() {
  const { s, d } = usePan()
  const present = s.employees.filter((e) => e.status === 'Present' || e.status === 'Late').length
  return (
    <>
      <PageHeader title="Attendance" subtitle="Onsite staff clock in at the kiosk with face match; WFH and hybrid staff clock in from their own device with an activity heartbeat. Payroll reads these rows directly." action={<button className="pbtn ghost">Export</button>} />
      <div className="pan-stats"><StatCard label="Present" value={`${present}/${s.employees.length}`} /><StatCard label="Late" value={String(s.employees.filter((e) => e.status === 'Late').length)} hint="after 08:15" /><StatCard label="Absent" value={String(s.employees.filter((e) => e.status === 'Absent').length)} /><StatCard label="Day off" value={String(s.employees.filter((e) => e.status === 'Day Off').length)} /></div>
      <Card title="Today">
        <div className="pan-tablewrap"><table className="pan-table"><thead><tr><th>Employee</th><th>Role</th><th>Setup</th><th className="c">In</th><th className="c">Out</th><th className="c">Status</th><th className="c">Action</th></tr></thead>
          <tbody>{s.employees.map((e) => <tr key={e.id}><td className="strong">{e.name}</td><td className="muted">{e.role}</td><td><span className={'chip ' + (e.setup === 'WFH' ? 'blue' : e.setup === 'Hybrid' ? 'amber' : 'stone')}>{e.setup}</span></td><td className="c num">{e.in ?? '—'}</td><td className="c num">{e.out ?? '—'}</td><td className="c"><span className={'pill ' + (e.status === 'Present' ? 'green' : e.status === 'Late' ? 'amber' : e.status === 'Absent' ? 'red' : 'stone')}>{e.status}</span></td><td className="c">{!e.in && e.status !== 'Day Off' && <button className="pbtn gold" onClick={() => d({ type: 'clock', id: e.id, kind: 'in' })}>Clock in</button>}{e.in && !e.out && <button className="pbtn ghost sm" onClick={() => d({ type: 'clock', id: e.id, kind: 'out' })}>Clock out</button>}</td></tr>)}</tbody></table></div>
      </Card>
    </>
  )
}

function Customers() {
  const { s } = usePan()
  const map = new Map<string, { name: string; phone: string; orders: number; spent: number; last: string; src: Order['source'] }>()
  for (const o of s.orders) { const c = map.get(o.phone) ?? { name: o.customer, phone: o.phone, orders: 0, spent: 0, last: o.date, src: o.source }; c.orders++; c.spent += orderTotal(o); if (o.date > c.last) c.last = o.date; map.set(o.phone, c) }
  return (<><PageHeader title="Customer List" subtitle="Built from orders — one row per contact number, synced with Messenger contacts (PSID) for the FB agent." /><Card title={`Customers · ${map.size}`}><div className="pan-tablewrap"><table className="pan-table"><thead><tr><th>Customer</th><th>Phone</th><th>First source</th><th className="c">Orders</th><th className="r">Total spent</th><th>Last order</th></tr></thead><tbody>{[...map.values()].sort((a, b) => b.spent - a.spent).map((c) => <tr key={c.phone}><td className="strong">{c.name}</td><td className="muted">{c.phone}</td><td><SourceChip s={c.src} /></td><td className="c num">{c.orders}</td><td className="r num strong">{peso(c.spent)}</td><td className="muted">{c.last}</td></tr>)}</tbody></table></div></Card></>)
}

function ActivityLogs() {
  const { s } = usePan()
  return (<><PageHeader title="Activity Logs" subtitle="Immutable audit trail written by triggers and the movement engine. Only INSERT is allowed on this table." /><Card title={`Entries · ${s.logs.length}`}><div className="pan-tablewrap"><table className="pan-table"><thead><tr><th>When</th><th>Who</th><th>Action</th><th>Module</th><th>Record</th></tr></thead><tbody>{s.logs.map((l, i) => <tr key={i}><td className="muted mono" style={{ fontSize: 12 }}>{l.at}</td><td className="strong">{l.who}</td><td style={{ whiteSpace: 'normal' }}>{l.action}</td><td className="muted">{l.module}</td><td className="mono" style={{ fontSize: 12 }}>{l.ref}</td></tr>)}</tbody></table></div></Card></>)
}

function ProcessMap() {
  return (<><PageHeader title="Order Mapping Tracker" subtitle="Daloy ng Proseso — the swimlane the team works from. Each lane names the table it writes to." /><div className="pan-card"><img src="/pan/process-map.png" alt="Process map" style={{ display: 'block', width: '100%' }} /></div></>)
}

/* ---------- Website (live embed) ---------- */
function WebsiteLive() {
  const [url, setUrl] = useState('https://panfurniture.ph/')
  const pages = [['Home', 'https://panfurniture.ph/'], ['Products', 'https://panfurniture.ph/products'], ['Quote request (MTO)', 'https://panfurniture.ph/quote-request'], ['Track delivery', 'https://panfurniture.ph/track'], ['Contact', 'https://panfurniture.ph/contact']]
  return (
    <>
      <PageHeader title="panfurniture.ph — live" subtitle="The public storefront, embedded live. Orders, quote requests and tracking on this site write into the same database this back office reads. Open in a new tab for the full experience." action={<a className="pbtn primary" href={url} target="_blank" rel="noreferrer">Open in new tab ↗</a>} />
      <div className="ptabs">{pages.map(([l, u]) => <button key={u} className={url === u ? 'active' : ''} onClick={() => setUrl(u)}>{l}</button>)}</div>
      <div className="pan-web"><div className="pan-web-h"><span>●</span><span className="url">{url}</span><span>live</span></div><iframe key={url} src={url} title="panfurniture.ph" referrerPolicy="no-referrer" /></div>
    </>
  )
}

/* ---------- placeholder for modules not rebuilt in the demo ---------- */
function Soon({ path }: { path: string }) {
  const { label, group } = labelFor(path)
  const { s } = usePan()
  return (
    <>
      <PageHeader title={label} subtitle={`${group} · This module exists in the production system (${path}). The demo rebuilds the core order-to-delivery flow; this page is a placeholder.`} />
      <div className="pan-card"><div className="pan-card-b" style={{ display: 'grid', gap: 12 }}>
        <div className="pnote info">In production this page reads its own tables with row-level security for the <b>{s.role ? ROLE_LABEL[s.role as Role] : ''}</b> role. Try the live flow instead: <b>Sales Orders → Order Approval → My Jobs → Quality Control → Delivery Queue → Delivery Route</b>.</div>
        <div className="pan-stats" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}><StatCard label="Route" value={path} /><StatCard label="Group" value={group} /><StatCard label="Status" value="Live in production" /></div>
      </div></div>
    </>
  )
}

