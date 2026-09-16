/* Route table for the PAN demo. Each entry mirrors the real `app/<route>/page.tsx`: run the same
   data loader(s) against the in-browser database, then render the same client component. Routes not
   yet ported fall back to the replica pages. */
import { Fragment, type ReactNode } from 'react'
import { PageData } from './page-host'
import { PageHeader, StatCard } from './real/components/ui'
import { peso, number } from './real/lib/format'
import type { Role } from './real/lib/auth/rbac'
import { isAdmin } from './real/lib/auth/rbac'
import { getSession } from './real/lib/auth/session'
import { requireAnyEdit } from './real/lib/auth/guard'
import { createServerSupabase, type InventoryRow, type OrderRow, type ProductRow } from './real/lib/supabase/server'
import { cleanVariants } from './real/lib/color-variants'
// dashboard / PAN overall
import { SalesDashboard } from './real/components/sales-dashboard'
import { loadSalesOrders, loadTargets } from './real/app/dashboard/sales-data'
import { PanOverallTabs } from './real/components/pan-overall-tabs'
import { loadAccounts, loadCategories, loadTransactions } from './real/app/hr/overall/data'
// activity logs
import { loadAuditLog } from './real/app/audit-trail/data'
import { AuditTrailManager } from './real/components/audit-trail-manager'
// customers
import { loadCustomers } from './real/app/customers/data'
import { CustomersManager } from './real/components/customers-manager'
// attendance
import { loadAttendance, loadEmployeesLite } from './real/app/hr/attendance/data'
import { HrAttendanceManager } from './real/components/hr-attendance-manager'
// inventory
import { AddInventoryButton } from './real/components/inventory-actions'
import { InventoryTable } from './real/components/inventory-table'
// sales orders
import { OrdersPageView } from './real/app/orders/orders-page-view'
// operations
import { loadOperations } from './real/app/operations/data'
import { OperationsManager } from './real/components/operations-manager'
import { loadDeliveryQueue } from './real/app/operations/delivery-queue/data'
import { DeliveryQueueManager } from './real/components/delivery-queue-manager'
// delivery
import { loadDeliveries } from './real/app/delivery/data'
import { employeesByRole } from './real/app/employees/data'
import { DeliveryManager } from './real/components/delivery-manager'
import { DriverRoutes } from './real/components/driver-routes'
// workshop / qc
import { loadWorkshop } from './real/app/workshop/data'
import { WorkshopManager } from './real/components/workshop-manager'
import { loadQc } from './real/app/quality-control/data'
import { WarehouseQcManager } from './real/components/warehouse-qc-manager'
// mto
import { loadMtoRequests } from './real/app/mto-requests/actions'
import { shippingRates } from './real/app/quotations/actions'
import MtoRequestsTable from './real/components/mto-requests-table'
// stock ledger
import { loadScanCatalog } from './real/app/scan/catalog'
import { loadLedger } from './real/app/scan/movements'
import { StockLedger } from './real/components/stock-ledger'
import { WhsScanButton } from './real/components/whs-scan-button'
import { Page as LegacyPage } from './pages'
import { ROUTES_MORE } from './routes-more'

export type RouteDef = { test: (path: string) => boolean; render: (path: string, role: Role, search: URLSearchParams) => ReactNode }

const me = async () => (await getSession())
const slugify = (name: string) => name.trim().toLowerCase().replace(/\s+/g, '-')

/* demo: the single delivery team is named 'Delivery Team' but the production URLs/permission module still use team-a */
const canonSlug = (slug: string) => (slug === 'team-a' ? 'delivery-team' : slug)

/* ---- verbatim port of app/inventory/page.tsx ---- */
async function loadInventoryPage() {
  const supabase = createServerSupabase()
  const [{ data: invData, error }, { data: prodData }] = await Promise.all([
    supabase.from('inventory').select('*').limit(10000),
    supabase.from('product').select('*').order('product_name').limit(10000),
  ])
  return { inv: (invData ?? []) as InventoryRow[], products: (prodData ?? []) as ProductRow[], error }
}
function InventoryPage({ inv, products, error }: Awaited<ReturnType<typeof loadInventoryPage>>) {
  const costBySku: Record<string, number> = {}
  const imageBySku: Record<string, string | null | undefined> = {}
  const imageByName: Record<string, string | null | undefined> = {}
  for (const p of products) {
    if (p.sku) { costBySku[p.sku] = Number(p.cost ?? 0); imageBySku[p.sku] = p.image_url }
    if (p.product_name) imageByName[p.product_name.toLowerCase()] = p.image_url
  }
  const imageFor = (r: InventoryRow) => (r.sku ? imageBySku[r.sku] : null) ?? imageByName[(r.product_name ?? '').toLowerCase()]
  const usedSku = new Set(inv.map((r) => r.sku?.toLowerCase()).filter(Boolean) as string[])
  const usedName = new Set(inv.filter((r) => !r.sku).map((r) => r.product_name?.toLowerCase()).filter(Boolean) as string[])
  const usedColors: Record<string, string[]> = {}
  for (const r of inv) { const k = r.sku?.toLowerCase(); if (!k) continue; (usedColors[k] ??= []).push(String(r.color ?? '').trim().toLowerCase()) }
  const availableProducts = products.filter((p) => {
    const k = p.sku?.toLowerCase() ?? ''
    const variants = cleanVariants((p as { color_variants?: unknown }).color_variants)
    if (k && variants.length) { const have = new Set(usedColors[k] ?? []); return variants.some((v) => !have.has(v.name.trim().toLowerCase())) }
    const skuUsed = k ? usedSku.has(k) : false
    const nameUsed = p.product_name ? usedName.has(p.product_name.toLowerCase()) : false
    return !skuUsed && !nameUsed
  })
  const valueOf = (r: InventoryRow) => (r.oh_inv ?? 0) * (r.sku ? (costBySku[r.sku] ?? 0) : 0)
  const prodFor = (r: InventoryRow) => products.find((p) => (r.sku && p.sku && p.sku.toLowerCase() === r.sku.toLowerCase()) || (r.product_name && p.product_name && p.product_name.toLowerCase() === r.product_name.toLowerCase()))
  const tableRows = inv.map((r) => { const p = prodFor(r); return { ...r, imageUrl: imageFor(r), productSpecs: (p?.specs as string | null) ?? null, productPrice: p?.price != null ? Number(p.price) : null, productType: p?.product_type ?? null, _v: valueOf(r) } }).sort((a, b) => b._v - a._v)
  const totalOnHand = inv.reduce((s, r) => s + (r.oh_inv ?? 0), 0)
  const totalReserved = inv.reduce((s, r) => s + (r.reserved ?? 0), 0)
  const totalAvailable = inv.reduce((s, r) => s + (r.available ?? 0), 0)
  const totalValue = inv.reduce((s, r) => s + valueOf(r), 0)
  const lowStockCount = inv.filter((r) => /low|out/i.test(r.status ?? '')).length
  return (
    <div className="space-y-6">
      <PageHeader title="Inventory Management" subtitle={error ? 'Failed to load from Supabase' : `${inv.length} items · live from Supabase`} action={<AddInventoryButton products={availableProducts} usedColors={usedColors} />} />
      {error ? (
        <div className="rounded-xl border border-red-200 bg-red-50 px-5 py-4 text-sm text-red-700"><p className="font-semibold">Supabase error</p><p className="mt-1 font-mono text-xs">{error.message}</p></div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
            <StatCard label="Total On Hand" value={number(totalOnHand)} />
            <StatCard label="Reserved" value={number(totalReserved)} tone="info" />
            <StatCard label="Available" value={number(totalAvailable)} tone="success" />
            <StatCard label="Inventory Value" value={peso(totalValue)} hint="At cost" />
            <StatCard label="Low Stock" value={number(lowStockCount)} tone={lowStockCount > 0 ? 'danger' : 'default'} hint="Low or out of stock" />
          </div>
          <InventoryTable rows={tableRows} />
        </>
      )}
    </div>
  )
}

/* ---- app/operations/delivery-queue/page.tsx ---- */
async function loadDeliveryQueuePage() {
  const db = createServerSupabase()
  const [canEdit, data, { data: prodData }, { data: salesData }, { data: consData }, { data: coordData }] = await Promise.all([
    requireAnyEdit(['ops_delivery_queue', 'ops_approval']).then(() => true).catch(() => false),
    loadDeliveryQueue(),
    db.from('product').select('*').order('product_name'),
    db.from('employees').select('name, role').eq('active', true).ilike('role', '%sales%').order('role').order('name'),
    db.from('employees').select('name, role').eq('active', true).ilike('role', '%constructor%').order('role').order('name'),
    db.from('employees').select('name').eq('active', true).ilike('role', '%coordinator%').order('name'),
  ])
  return { canEdit, data, products: (prodData ?? []) as ProductRow[], assignees: (salesData ?? []) as { name: string; role?: string }[], constructors: (consData ?? []) as { name: string; role: string }[], coordinators: ((coordData ?? []) as { name: string }[]).map((c) => c.name) }
}

/* ---- app/delivery/page.tsx + app/delivery/routes/[team]/page.tsx ---- */
async function loadDeliveryPage() {
  const [data, qa, coordinators, user] = await Promise.all([loadDeliveries(), employeesByRole('qa'), employeesByRole('coordinator'), me()])
  const drivers = data.teams.filter((t) => t.driver).map((t) => ({ name: t.driver as string, on_call: t.reserved, role: t.reserved ? 'Reserve Driver' : t.name }))
  return { data, qa, coordinators, drivers, user }
}

/* ---- app/hr/overall/page.tsx ---- */
async function loadPanOverall() {
  const supabase = createServerSupabase()
  const [accounts, categories, transactions, { data: orderData }, { data: productData }, salesOrders, targets, customers] = await Promise.all([
    loadAccounts(), loadCategories(), loadTransactions(), supabase.from('orders').select('*').limit(10000), supabase.from('product').select('*').limit(10000), loadSalesOrders(), loadTargets(), loadCustomers(),
  ])
  return { accounts, categories, transactions, orders: (orderData ?? []) as OrderRow[], products: (productData ?? []) as ProductRow[], salesOrders, targets, customers }
}

const OPS_SUBTITLE: Record<string, string> = { approval: 'Assign sales-order lines to a workshop, then approve to dispatch', tracker: 'Monitor every order dispatched to a workshop', requests: 'Approve & fulfill workshop restock requests', materials: "Define & manage each workshop's raw materials" }
const WS_TITLES: Record<string, [string, string]> = { jobs: ['Workshop', 'Jobs assigned to this workshop'], rework: ['Rework Jobs', 'RMA repairs assigned to this workshop'], inventory: ['Workshop', 'Raw-material inventory · barcode in/out · low-stock alert'], logs: ['Workshop', 'Every stock movement (in/out)'], requests: ['Workshop', 'Restock requests sent to Operations'] }

export const ROUTES: RouteDef[] = [
  { test: (p) => p === '/dashboard', render: (_p, role) => (
    <PageData load={async () => { const [orders, targets] = await Promise.all([loadSalesOrders(), loadTargets()]); return { orders, targets } }}>
      {({ orders, targets }) => <SalesDashboard orders={orders} targets={targets} canEditTargets={isAdmin(role)} />}
    </PageData>
  ) },
  { test: (p) => p === '/hr/overall', render: () => (
    <PageData load={loadPanOverall}>
      {(d) => <PanOverallTabs overall={{ accounts: d.accounts, categories: d.categories, transactions: d.transactions, orders: d.orders, products: d.products }} dashboard={{ orders: d.salesOrders, targets: d.targets, canEditTargets: true }} customers={{ data: d.customers }} />}
    </PageData>
  ) },
  { test: (p) => p === '/audit-trail', render: () => <PageData load={() => loadAuditLog()}>{(rows) => <AuditTrailManager rows={rows} />}</PageData> },
  { test: (p) => p === '/customers', render: () => <PageData load={() => loadCustomers()}>{(data) => <CustomersManager data={data} />}</PageData> },
  { test: (p) => p === '/hr/attendance', render: () => (
    <PageData load={async () => { const [rows, employees] = await Promise.all([loadAttendance(), loadEmployeesLite()]); return { rows, employees } }}>
      {({ rows, employees }) => <HrAttendanceManager rows={rows} employees={employees} />}
    </PageData>
  ) },
  { test: (p) => p === '/inventory', render: () => <PageData load={loadInventoryPage}>{(d) => <InventoryPage {...d} />}</PageData> },
  { test: (p) => p === '/orders' || p === '/initial-sales', render: (p) => <PageData load={() => OrdersPageView({ silent: p === '/initial-sales' })} deps={[p]}>{(el) => <>{el}</>}</PageData> },

  { test: (p) => /^\/operations\/(approval|tracker|requests|materials)$/.test(p), render: (p) => {
    const section = p.split('/').pop() as 'approval' | 'tracker' | 'requests' | 'materials'
    return (
      <PageData load={async () => { const [data, user] = await Promise.all([loadOperations(), me()]); return { data, user } }}>
        {({ data, user }) => (
          <div className="space-y-6">
            <PageHeader title="Operations Manager" subtitle={OPS_SUBTITLE[section]} />
            <OperationsManager data={data} currentUser={user?.full_name ?? ''} section={section} />
          </div>
        )}
      </PageData>
    )
  } },
  { test: (p) => p === '/operations/delivery-queue', render: () => (
    <PageData load={loadDeliveryQueuePage}>
      {(d) => (
        <div className="space-y-6">
          <PageHeader title="Delivery Queue" subtitle="QC-passed orders grouped by delivery location — set the date and team per group, send confirmations, then track responses" />
          <DeliveryQueueManager data={d.data} canEdit={d.canEdit} products={d.products} assignees={d.assignees} constructors={d.constructors} coordinators={d.coordinators} />
        </div>
      )}
    </PageData>
  ) },
  { test: (p) => p === '/delivery', render: () => (
    <PageData load={loadDeliveryPage}>
      {(d) => (
        <div className="space-y-6">
          <PageHeader title="Delivery Tracker" subtitle="Schedule, QA-check & deliver orders — collect COD balance on delivery" />
          <DeliveryManager data={d.data} drivers={d.drivers} qaNames={d.qa} coordinators={d.coordinators} />
        </div>
      )}
    </PageData>
  ) },
  { test: (p) => /^\/delivery\/routes\/team-[a-d](\/onsite)?$/.test(p), render: (p) => {
    const parts = p.split('/')
    const onsite = parts[parts.length - 1] === 'onsite'
    const slug = canonSlug(onsite ? parts[parts.length - 2] : parts[parts.length - 1])
    return (
      <PageData load={loadDeliveryPage}>
        {(d) => {
          const privileged = !!d.user && (isAdmin(d.user.role) || d.user.role === 'operations_manager')
          const fromMeta = d.data.teams.find((t) => slugify(t.name) === slug)?.name
          const fromStops = d.data.rows.find((r) => r.dq_team && slugify(r.dq_team) === slug)?.dq_team
          const team = fromMeta ?? fromStops ?? null
          if (!team) return <div className="space-y-6"><PageHeader title="Driver Route" subtitle="Dedicated team view" /><div className="rounded-xl border border-dashed border-border bg-surface px-6 py-14 text-center text-sm text-muted">Unknown team “{slug}” — check the delivery teams list.</div></div>
          return (
            <div className="space-y-6">
              <PageHeader title={`${team} — ${onsite ? 'Rework (On-Site)' : 'Route'}`} subtitle={onsite ? 'On-site repair visits booked for this team — navigate per stop, declare the repair on arrival' : "Dedicated route view for this team's tablet — stops in planner order, navigate per stop"} />
              <DriverRoutes rows={d.data.rows} teams={d.data.teams} userName={d.user?.full_name ?? ''} isPrivileged={privileged} forceTeam={team} drivers={d.drivers} qaNames={d.qa} coordinators={d.coordinators} mode={onsite ? 'onsite' : 'delivery'} />
            </div>
          )
        }}
      </PageData>
    )
  } },
  { test: (p) => /^\/workshop\/(jobs|rework|inventory|logs|requests)$/.test(p), render: (p, _role, search) => {
    const section = p.split('/').pop() as 'jobs' | 'rework' | 'inventory' | 'logs' | 'requests'
    const ws = search.get('ws') ?? undefined
    const [title, subtitle] = WS_TITLES[section]
    return (
      <PageData load={async () => { const [data, user] = await Promise.all([loadWorkshop(ws), me()]); return { data, user } }} deps={[ws]}>
        {({ data, user }) => (
          <div className="space-y-6">
            <PageHeader title={title} subtitle={subtitle} />
            <WorkshopManager data={data} currentUser={user?.full_name ?? ''} section={section} />
          </div>
        )}
      </PageData>
    )
  } },
  { test: (p) => p === '/quality-control', render: () => (
    <PageData load={async () => { const [data, user] = await Promise.all([loadQc(), me()]); return { data, user } }}>
      {({ data, user }) => (
        <div className="space-y-6">
          <PageHeader title="Quality Control" subtitle="Scan, inspect & pass/fail items — Quality Control (IN) for stock-in receiving · Quality Control (OUT) before dispatch" />
          <WarehouseQcManager data={data} checkedBy={user?.full_name ?? ''} />
        </div>
      )}
    </PageData>
  ) },
  { test: (p) => p === '/mto-requests', render: () => (
    <PageData load={async () => { const [rows, provinces] = await Promise.all([loadMtoRequests(), shippingRates()]); return { rows, provinces } }}>
      {({ rows, provinces }) => (
        <div>
          <PageHeader title="Made-to-Order Requests" subtitle="Quote requests from panfurniture.ph — the full build arrives here, in the Messenger thread, and as a push notification. Create Quotation opens the pre-filled Formal Quotation." />
          <MtoRequestsTable rows={rows} provinces={provinces} />
        </div>
      )}
    </PageData>
  ) },
  { test: (p) => p === '/stock-movements', render: () => (
    <PageData load={async () => { const [catalog, ledger] = await Promise.all([loadScanCatalog(), loadLedger()]); return { catalog, ledger } }}>
      {({ catalog, ledger }) => (
        <div className="space-y-6">
          <StockLedger data={ledger} scanSlot={<div key="scan" className="flex gap-2"><WhsScanButton key="in" direction="in" label="Scan In" title="Stock In — Receive" catalog={catalog} /><WhsScanButton key="out" direction="out" label="Scan Out" title="Stock Out — Dispatch" catalog={catalog} /></div>} />
        </div>
      )}
    </PageData>
  ) },
]

export function renderRoute(path: string, role: Role): ReactNode {
  const [base, q = ''] = path.split('#')[0].split('?')
  const search = new URLSearchParams(q)
  const hit = [...ROUTES, ...ROUTES_MORE].find((r) => r.test(base))
  if (hit) return <Fragment key={base + '?' + search.toString()}>{hit.render(base, role, search)}</Fragment>
  return <div className="pan-legacy" style={{ display: 'grid', gap: '1.5rem', background: 'transparent' }}><LegacyPage path={base} /></div>
}

export { getSession }
