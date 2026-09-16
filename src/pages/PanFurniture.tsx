import { Link } from 'react-router-dom'
import { ArrowLeft, ArrowRight, ArrowUpRight, Download, Globe, Smartphone, Monitor, Mail, ShieldCheck, Database, Workflow, Truck, Factory, Users, Store, Wrench, ClipboardCheck, Settings } from 'lucide-react'
import { profile } from '../content'
import './pan-furniture.css'

const LINKS = {
  website: 'https://panfurniture.ph',
  track: 'https://panfurniture.ph/track',
  app: 'https://pan-furnitures.vercel.app',
  apk: 'https://pan-furnitures.vercel.app/pan-furniture.apk',
  exe: 'https://pan-furnitures.vercel.app/PAN-System-Setup.exe',
  dmg: 'https://pan-furnitures.vercel.app/PAN-System.dmg',
}

const STATS = [
  { v: '95', l: 'screens (App Router pages)' },
  { v: '25', l: 'API routes (webhooks, delivery, payments)' },
  { v: '237', l: 'database migrations, RLS on every table' },
  { v: '14', l: 'roles with per-page permissions' },
  { v: '8', l: 'n8n flows for email & Messenger' },
  { v: '4 + 3', l: 'delivery teams + workshops on one board' },
]

const SHOTS = [
  { src: '/pan/app-dashboard.png', title: 'Sales Command Center (admin)', sub: 'The real dashboard component: 8 KPIs with sparklines, sales trend vs target, payment status, channel and category donuts, conversion funnel, top products, customers and reps.' },
  { src: '/pan/app-orders.png', title: 'Sales Orders', sub: 'The real orders table with payment / operations status, rush tags, Facebook sync and the Create Order modal (line items, downpayment, Maya QR).' },
  { src: '/pan/app-approval.png', title: 'Order Approval (Operations Manager)', sub: 'Order lines waiting for a workshop assignment, with stock check, MTO / FQ references and the rush threshold setting.' },
  { src: '/pan/app-delivery-queue.png', title: 'Delivery Queue', sub: 'QC-passed orders grouped per team board — drag to a team, set the coordinator and date, send Messenger confirmations.' },
  { src: '/pan/app-attendance.png', title: 'HR Attendance', sub: 'Kiosk and WFH clock-ins with running time count, late flags and overtime status.' },
  { src: '/pan/app-pan-overall.png', title: 'PAN Overall (finance)', sub: 'Accounts, income and expense transactions per branch, auto-posted from order payments and workshop restocks.' },
  { src: '/pan/process-map.png', title: 'Order process map (swimlane)', sub: 'Sales → System → Operations → Workshop → HR → Warehouse → Delivery. Every lane names the table it writes to.' },
  { src: '/pan/track-preview.png', title: 'Customer live delivery tracking', sub: 'Public tracking page on panfurniture.ph — driver GPS, ETA, milestone timeline, call/message driver, delivery PIN.' },
  { src: '/pan/driver-preview.png', title: 'Driver app (Android WebView + GPS)', sub: 'Deliveries for the day with COD balance, pickup proof, arrival confirmation. Background location via Capacitor.' },
  { src: '/pan/website-home.png', title: 'Public storefront — panfurniture.ph', sub: 'Next.js storefront with MTO configurator, quote requests and Maya checkout that post straight into the operations platform.' },
  { src: '/pan/receipt-email-preview.png', title: 'BIR receipt + acknowledgement email', sub: 'Generated on payment, versioned per order, sent through n8n with the tracking link.' },
  { src: '/pan/stock-request-alert-preview.png', title: 'Workshop stock request alert', sub: 'Workshop asks for material; warehouse and ops manager are notified; follow-ups fire on a cron until received.' },
  { src: '/pan/wfh-monitor.png', title: 'HR — WFH activity monitor', sub: 'Attendance kiosk with face descriptors on-site, activity and screen check for remote staff, overtime and payroll.' },
]

const MODULES: { role: string; icon: React.JSX.Element; who: string; items: string[] }[] = [
  { role: 'Sales & Service', icon: <Store size={18} />, who: 'Showroom & online sales staff', items: ['Sales Orders', 'Initial Sales', 'Delivery Schedule', 'Order Mapping Tracker', 'Mattress Orders', 'Warranty Documents', 'MTO Requests (from website)', 'Formal Quotation', 'Design Details', 'Returns / RMA', 'Customer List'] },
  { role: 'Operations Manager', icon: <ClipboardCheck size={18} />, who: 'Approves, assigns, dispatches', items: ['Order Approval', 'Stock Build', 'Requested Edit Order', 'Delivery Queue', 'Route Planner', 'Delivery Tracker', 'Installation Tracking', 'Return / Defect Approval', 'Order Tracker', 'Rework Tracker', 'Materials', 'Stock Requests', 'Purchase Orders', 'Suppliers', 'Product Costing', 'Product Management', 'Add-ons Catalog'] },
  { role: 'Warehouse', icon: <Database size={18} />, who: 'Receiving, QC, ledger', items: ['Barcode Management', 'Warehouse Location Management', 'Inventory Management', 'Incoming Shipment', 'Stock Movement Ledger', 'Quality Control', 'Returns / RMA'] },
  { role: 'Workshop × 3', icon: <Factory size={18} />, who: 'GMA Original · GMA White · LRT', items: ['My Jobs', 'Rework Jobs', 'My Inventory', 'Stock Logs', 'Quality Control declarations', 'My Requests'] },
  { role: 'Delivery Teams A–D', icon: <Truck size={18} />, who: 'Drivers & installers', items: ['Pickup Task', 'Delivery Route (live GPS)', 'Installation Tracking', 'Rework (On-Site)', 'Rework (Pull Out)', 'Refund (Pull Out)', 'Returns / RMA', 'Arrival & packing proof photos'] },
  { role: 'HR Management', icon: <Users size={18} />, who: 'HR & payroll', items: ['Employee Directory', 'Attendance (kiosk, face match)', 'Attendance (WFH) + Activity Monitor', 'Overtime Approval', 'Day Off Management', 'Constructor (per-job pay)', 'Advance Payments', 'Payroll', 'HR Reports', 'PAN Overall', 'Payment Approval'] },
  { role: 'Website CMS', icon: <Globe size={18} />, who: 'Marketing', items: ['MTO Configurator', 'Website Content', 'Shipping Rates', 'FB AI Agent (Messenger)', 'Hero / Banners / Promo / Reviews / Videos'] },
  { role: 'System', icon: <Settings size={18} />, who: 'Admin', items: ['Performance Rankings', 'Activity Logs (immutable audit)', 'Settings', 'Users & per-page permissions', 'Sidebar badges (realtime counts)'] },
]

const FLOW = [
  { lane: 'Sales', step: 'Create sales order, collect 30% downpayment via Maya QR or cash', table: 'orders · order_payments' },
  { lane: 'System', step: 'Paid ≥30%? → reserve stock, commit order, email BIR receipt + acknowledgement', table: 'inventory.reserve · email_outbox · n8n' },
  { lane: 'Operations', step: 'Review items — needs workshop? assign job. Otherwise skip to warehouse stock', table: 'workshop_job · ops_line_skip' },
  { lane: 'Workshop', step: 'Accept → build → declare QC. Route to warehouse receiving QC or direct pickup', table: 'workshop_job · qc_declarations' },
  { lane: 'HR', step: 'Approve QC declaration → per-worker pay lines generated (constructor)', table: 'hr_project_work' },
  { lane: 'Warehouse', step: 'Receiving QC, barcode placement, packing proof, reserve → deduct on ship', table: 'inventory_ledger · stock_placements' },
  { lane: 'Delivery', step: 'Queue → route planner → driver app GPS → arrival proof → COD → installation → warranty email', table: 'deliveries · driver_positions · installations' },
]

const INTEGRATIONS = [
  { name: 'Maya Checkout', what: 'Card / e-wallet / QR payments with signed webhooks; idempotent COD; payment approvals.' },
  { name: 'n8n (8 webhooks)', what: 'For-payment email, receipt, acknowledgement, warranty, out-for-delivery, arrived, MTO request, stock alerts.' },
  { name: 'Facebook Messenger AI agent', what: 'Inbound inquiries answered from the catalogue; quotes and orders linked to the customer PSID.' },
  { name: 'Supabase Realtime', what: 'Every table publishes; sidebar badges, delivery queue and driver positions update live.' },
  { name: 'Capacitor Android APK', what: 'Thin WebView shell with OS-level background GPS for drivers.' },
  { name: 'Electron desktop (Win / Mac)', what: 'PAN-System installer for showroom counters; QZ Tray ESC/POS receipt printing (Xprinter Q200).' },
  { name: 'Google Business + Gmail API', what: 'Reviews sync and email backfill into the customer thread.' },
  { name: 'Face descriptors + OCR (on-device)', what: 'Attendance kiosk face match; Tesseract for document capture; rembg for product photo cleanup.' },
]

export default function PanFurniture() {
  return (
    <>
      <header className="nav">
        <div className="container nav-inner">
          <Link to="/#work" className="back-link"><ArrowLeft size={15} /> Back to portfolio</Link>
          <nav className="nav-links">
            <a href="#live">Live site</a><a href="#shots">Screens</a><a href="#modules">Modules</a><a href="#flow">Order flow</a><a href="#arch">Architecture</a><a href="#use">Use it</a>
          </nav>
          <a href="#use" className="btn btn-primary btn-sm">Request a walkthrough <ArrowRight size={14} /></a>
        </div>
      </header>

      <section className="proj-hero">
        <div className="container proj-hero-grid">
          <div>
            <span className="status-pill"><span className="dot" /> In production · Lucena City</span>
            <p className="eyebrow" style={{ marginTop: '1.25rem' }}>Case study · Internal operations platform</p>
            <h1>Pan Furniture <em>Operations Platform</em></h1>
            <p className="lede">
              The system I built and run for <strong>Purificacion and Noriega Furniture Shop Co.</strong> — one Next.js + Supabase app that covers the whole furniture business: showroom and online orders, BIR invoicing, Maya payments, three workshops, materials and warehouse ledger, QC, four delivery teams with live GPS, installation, warranty, and HR/payroll.
            </p>
            <div className="hero-cta">
              <Link to="/pan" className="btn btn-accent">Open the working system (demo) <ArrowRight size={16} /></Link>
              <a href={LINKS.website} target="_blank" rel="noreferrer" className="btn btn-ghost">Open panfurniture.ph <ArrowUpRight size={16} /></a>
              <a href={LINKS.track} target="_blank" rel="noreferrer" className="btn btn-ghost">Live delivery tracking <ArrowUpRight size={16} /></a>
            </div>
            <div className="dl-row">
              <a href={LINKS.app} target="_blank" rel="noreferrer"><Globe size={16} /><span><small>Web app</small>pan-furnitures.vercel.app</span></a>
              <a href={LINKS.apk} target="_blank" rel="noreferrer"><Smartphone size={16} /><span><small>Android</small>pan-furniture.apk</span></a>
              <a href={LINKS.exe} target="_blank" rel="noreferrer"><Monitor size={16} /><span><small>Windows</small>PAN-System-Setup.exe</span></a>
              <a href={LINKS.dmg} target="_blank" rel="noreferrer"><Download size={16} /><span><small>macOS</small>PAN-System.dmg</span></a>
            </div>
            <p className="note-light">Staff accounts are role-gated. The public storefront and tracking pages are open; for the back office, request a walkthrough below and I will open a demo role for you.</p>
          </div>
          <div className="proj-hero-shot">
            <div className="chrome"><i /><i /><i /><span>panfurniture.ph/track</span></div>
            <img src="/pan/track-preview.png" alt="Live delivery tracking page" />
          </div>
        </div>
      </section>

      <section className="proj-stats">
        <div className="container stats six">
          {STATS.map((s) => <div className="stat" key={s.l}><strong>{s.v}</strong><span>{s.l}</span></div>)}
        </div>
      </section>

      <section id="live" className="alt">
        <div className="container">
          <div className="section-head">
            <p className="eyebrow">Live website</p>
            <h2>panfurniture.ph — the storefront, embedded live.</h2>
            <p>Quote requests, checkout (Maya) and delivery tracking on this site write into the same Supabase database the back office reads. This is the real site, not a screenshot.</p>
          </div>
          <div className="live-embed">
            <div className="bar"><span>●</span><span className="url">https://panfurniture.ph/</span><a href={LINKS.website} target="_blank" rel="noreferrer" style={{ fontWeight: 600, color: 'var(--ink)' }}>Open in new tab ↗</a></div>
            <iframe src="https://panfurniture.ph/" title="panfurniture.ph live" loading="lazy" referrerPolicy="no-referrer" />
          </div>
        </div>
      </section>

      <section id="shots">
        <div className="container">
          <div className="section-head">
            <p className="eyebrow">Screens</p>
            <h2>What the staff, drivers and customers actually see.</h2>
            <p>The first six are the production components running in the demo at /pan with sample data — click any to open the real thing. The rest are captured from the production repo.</p>
          </div>
          <div className="shot-grid">
            {SHOTS.map((s) => (
              <figure className="shot" key={s.src}>
                <div className="shot-img"><img src={s.src} alt={s.title} loading="lazy" /></div>
                <figcaption><b>{s.title}</b><span>{s.sub}</span></figcaption>
              </figure>
            ))}
          </div>
        </div>
      </section>

      <section id="modules" className="alt">
        <div className="container">
          <div className="section-head">
            <p className="eyebrow">Modules by role</p>
            <h2>Every role logs in to its own sidebar.</h2>
            <p>Permissions are per page and enforced by Postgres row-level security, not just hidden menu items. Fourteen roles: Admin, Manager, Sales, Warehouse, HR, Kiosk, Teams A–D, three workshops, Developer.</p>
          </div>
          <div className="mod-grid">
            {MODULES.map((m) => (
              <article className="mod" key={m.role}>
                <div className="mod-head"><span className="icon">{m.icon}</span><div><h3>{m.role}</h3><small>{m.who}</small></div></div>
                <ul>{m.items.map((i) => <li key={i}>{i}</li>)}</ul>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section id="flow">
        <div className="container">
          <div className="section-head">
            <p className="eyebrow">Order lifecycle</p>
            <h2>From downpayment to installed — one order, seven hand-offs, zero re-typing.</h2>
            <p>The swimlane above is the actual process document the team works from. Each hand-off is a status change that the next role sees instantly through Supabase Realtime.</p>
          </div>
          <ol className="flow">
            {FLOW.map((f, i) => (
              <li key={f.lane}>
                <span className="flow-n">{String(i + 1).padStart(2, '0')}</span>
                <div><b>{f.lane}</b><p>{f.step}</p><code>{f.table}</code></div>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section id="arch" className="alt">
        <div className="container">
          <div className="section-head">
            <p className="eyebrow">Architecture</p>
            <h2>Inventory is never edited. It is posted.</h2>
            <p>The design rule that shaped the whole system, and the integrations wired around it.</p>
          </div>
          <div className="arch-grid">
            <div className="arch-card">
              <h3><ShieldCheck size={18} /> Movement engine</h3>
              <ul>
                <li>No UI or API writes stock balances. Every change comes from a source document: WHS In, WHS Out, order fulfilment, returns, adjustments.</li>
                <li>One <code>SECURITY DEFINER</code> function posts each movement atomically: balance update + immutable ledger row + audit entry, or nothing.</li>
                <li><code>available = on_hand − reserved</code> is a generated column. Reservations never touch on-hand.</li>
                <li>Direct writes to inventory tables are revoked from every client role. RLS holds even if a client is compromised.</li>
              </ul>
            </div>
            <div className="arch-card">
              <h3><Workflow size={18} /> Stack</h3>
              <ul>
                <li>Next.js 16 App Router · React 19 · TypeScript · Tailwind 4</li>
                <li>Supabase: Postgres, Auth, Storage, Realtime on every table, 237 migrations</li>
                <li>Vitest unit tests for downpayment rules, peso formatting, BIR VAT math</li>
                <li>GitHub Actions CI: typecheck, lint and build are hard gates</li>
                <li>Deployed on Vercel; PITR backups on the production database</li>
              </ul>
            </div>
            <div className="arch-card wide">
              <h3><Wrench size={18} /> Integrations</h3>
              <div className="int-grid">
                {INTEGRATIONS.map((i) => <div key={i.name}><b>{i.name}</b><p>{i.what}</p></div>)}
              </div>
            </div>
          </div>
        </div>
      </section>

      <section id="use" className="proj-cta">
        <div className="container contact-grid">
          <div>
            <p className="eyebrow on-dark">Use it for your business</p>
            <h2 style={{ marginTop: '0.9rem' }}>Running a furniture shop, workshop or delivery operation? This already works.</h2>
            <p className="lede">The platform is multi-role and multi-branch by design. I can deploy a copy on your own Supabase and Vercel accounts, rebrand it, and map your process onto the same swimlane in weeks, not months.</p>
            <div className="hero-cta">
              <a href={`mailto:${profile.email}?subject=Pan%20Furniture%20platform%20walkthrough`} className="btn btn-accent">Request a live walkthrough <Mail size={16} /></a>
              <Link to="/pan" className="btn btn-ghost" style={{ color: 'var(--paper)', borderColor: '#ffffff33' }}>Try the system yourself <ArrowRight size={16} /></Link>
            </div>
          </div>
          <div className="contact-card">
            <div className="cta-list">
              <b>What you get</b>
              <span>Your own deployment — you own the accounts and the data</span>
              <span>Roles and sidebars mapped to your team</span>
              <span>Maya or your payment gateway; your BIR receipt format</span>
              <span>Driver APK and desktop installers branded to you</span>
              <span>Walkthrough video and written SOP at handover</span>
            </div>
          </div>
        </div>
      </section>
      <footer className="footer">
        <div className="container">
          <span>© 2026 {profile.name} · Pan Furniture Operations Platform</span>
          <Link to="/#work" style={{ color: 'var(--on-dark-1)' }}>← Back to portfolio</Link>
        </div>
      </footer>
    </>
  )
}
