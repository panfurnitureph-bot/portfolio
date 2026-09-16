/* Remaining routes — each mirrors the real `app/<route>/page.tsx` wiring. */
import { PageData } from './page-host'
import { PageHeader, StatCard } from './real/components/ui'
import { peso, number } from './real/lib/format'
import { isAdmin } from './real/lib/auth/rbac'
import { canViewPath } from './real/lib/auth/permissions'
import { getSession } from './real/lib/auth/session'
import { requireAnyEdit } from './real/lib/auth/guard'
import { createServerSupabase, type ProductRow } from './real/lib/supabase/server'
import { fetchAll } from './real/lib/fetch-all'
import type { RouteDef } from './routes'
// returns / rework / installation / pickup
import { loadReturns } from './real/app/returns/data'
import { ReturnsManager } from './real/components/returns-manager'
import { loadRework, loadPickups } from './real/app/rework/data'
import { ReworkTracker } from './real/components/rework-tracker'
import { loadInstallations } from './real/app/installation/data'
import { InstallationManager } from './real/components/installation-manager'
import { employeesByRole } from './real/app/employees/data'
import { loadPickupTasks } from './real/app/pickup-task/data'
import { PickupTasks } from './real/components/pickup-tasks'
import { PickupRoutes } from './real/components/pickup-routes'
// operations extras
import { loadOperations } from './real/app/operations/data'
import { StockBuildManager } from './real/components/stock-build-manager'
import { loadDeliveries } from './real/app/delivery/data'
import { RoutePlanner } from './real/components/route-planner'
import { listEditRequests } from './real/app/orders/edit-request-actions'
import { EditRequestsManager } from './real/components/edit-requests-manager'
import { loadDeliveryQueue } from './real/app/operations/delivery-queue/data'
import { DeliveryScheduleTool } from './real/components/delivery-schedule-tool'
// workshop qc
import { loadWorkshop } from './real/app/workshop/data'
import { QualityControlManager } from './real/components/quality-control-manager'
import { loadQcRates, loadQcDeclarations, loadQcStaff } from './real/app/workshop/qc-actions'
import { loadEmployeesLite as loadProjectEmployees, loadProjectWork, loadOrders as loadProjectOrders, loadPendingFromOrders, loadReworkMetaByRma, loadOrderItemLookup } from './real/app/hr/projects/data'
// hr
import { loadHrEmployees, loadDirectoryLogins, loadEmployee } from './real/app/hr/directory/data'
import { HrEmployeeDetail } from './real/components/hr-employee-detail'
import { HrDirectoryManager } from './real/components/hr-directory-manager'
import { loadRuns, loadPayslips, loadPayrollConfig } from './real/app/hr/payroll/data'
import { HrPayrollManager } from './real/components/hr-payroll-manager'
import { loadOvertime } from './real/app/hr/overtime/data'
import { HrOvertimeManager } from './real/components/hr-overtime-manager'
import { loadLeaves, loadEmployeesLite as loadLeaveEmployees } from './real/app/hr/leaves/data'
import { HrLeavesManager } from './real/components/hr-leaves-manager'
import { loadAdvances, loadEmployeesLite as loadAdvanceEmployees } from './real/app/hr/advances/data'
import { HrAdvancesManager } from './real/components/hr-advances-manager'
import { HrProjectsManager } from './real/components/hr-projects-manager'
import { loadHrReportData } from './real/app/hr/reports/data'
import { HrReportsManager } from './real/components/hr-reports-manager'
import { loadMyWfh, loadWfhAll, loadMyWfhActivity, loadWfhActivityAll } from './real/app/hr/wfh/data'
import { WfhClock } from './real/components/wfh-clock'
import { listPaymentApprovals, listRefundPayouts, listPanAccountsLite } from './real/app/orders/approval-actions'
import { PaymentApprovalsManager } from './real/components/payment-approvals-manager'
// products / procurement / warehouse
import { ProductsTable } from './real/components/products-table'
import { AddProductButton } from './real/components/add-product-button'
import { loadSuppliers } from './real/app/suppliers/data'
import { loadRates } from './real/app/suppliers/rates'
import { SuppliersManager } from './real/components/suppliers-manager'
import { loadPurchaseOrders } from './real/app/purchase-orders/data'
import { PurchaseOrdersManager } from './real/components/purchase-orders-manager'
import { loadCostings } from './real/app/costing/data'
import { CostingManager } from './real/components/costing-manager'
import { loadLocations } from './real/app/locations/data'
import { LocationsManager } from './real/components/locations-manager'
import { loadIncoming } from './real/app/incoming/data'
import { IncomingManager } from './real/components/incoming-manager'
import { loadRankings } from './real/app/reports/data'
import { PerformanceRankings } from './real/components/performance-rankings'
// settings
import { SettingsForm } from './real/app/settings/settings-form'
import { SecurityCard } from './real/app/settings/security-card'
import { PushTestCard } from './real/app/settings/push-test-card'
// sales & service extras
import { quoteAssetStatus, loadQuotations } from './real/app/quotations/actions'
import { QuotationAssetsCard } from './real/components/quotation-assets-card'
import { QuotationsTable } from './real/components/quotations-table'
import { loadDesignDetails } from './real/app/design-details/actions'
import { loadSwatches, loadContent, loadProducts, loadFbScripts } from './real/app/website/actions'
import { DesignDetailsTable } from './real/components/design-details-table'
import type { LibSwatch } from './real/components/website/SwatchManager'
import { loadMattressOrders } from './real/app/mattress-orders/data'
import { MattressOrdersManager } from './real/components/mattress-orders-manager'
import { loadWarranties } from './real/app/warranty/data'
import { WarrantyDocumentsManager } from './real/components/warranty-documents-manager'
// website
import { listConfiguratorItems } from './real/app/website/configurator/actions'
import ConfiguratorTab from './real/components/website/ConfiguratorTab'
import ContentTabs from './real/components/website/ContentTabs'
import type { PickerProduct } from './real/components/website/products-context'
import { withHomepageDefaults } from './real/components/website/homepage-defaults'
import { ShippingShell } from './real/components/website/tab-shells'
import FacebookAgentTab from './real/components/website/FacebookAgentTab'

const me = async () => (await getSession())
const slugify = (name: string) => name.trim().toLowerCase().replace(/\s+/g, '-')
const unslug = (slug: string) => slug.split('-').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')

/* demo: the single delivery team is named 'Delivery Team' but the production URLs/permission module still use team-a */
const canonSlug = (slug: string) => (slug === 'team-a' ? 'delivery-team' : slug)

function ReturnsPage({ data, canApprove, title, subtitle, hint }: { data: Awaited<ReturnType<typeof loadReturns>>; canApprove: boolean; title: string; subtitle: string; hint: string }) {
  return (
    <div className="space-y-6">
      <PageHeader title={title} subtitle={subtitle} />
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Pending" value={number(data.kpi.pending)} tone="warning" hint={hint} />
        <StatCard label="Approved (7d)" value={number(data.kpi.approvedThisWeek)} tone="success" hint="Approved this week" />
        <StatCard label="Total Refunded" value={peso(data.kpi.totalRefund)} tone="danger" hint="Approved customer refunds" />
        <StatCard label="Customer / Supplier" value={`${number(data.kpi.customerCount)} / ${number(data.kpi.supplierCount)}`} tone="info" hint="By return type" />
      </div>
      <ReturnsManager data={data} canApprove={canApprove} />
    </div>
  )
}

export const ROUTES_MORE: RouteDef[] = [
  { test: (p) => /^\/hr\/directory\/\d+$/.test(p), render: (p) => <PageData load={() => loadEmployee(Number(p.split('/').pop()))}>{(emp) => emp ? <HrEmployeeDetail employee={emp} /> : <div className="rounded-xl border border-dashed border-border bg-surface px-6 py-14 text-center text-sm text-muted">Employee not found.</div>}</PageData> },
  { test: (p) => p === '/returns', render: () => <PageData load={loadReturns}>{(data) => <ReturnsPage data={data} canApprove={false} title="Returns / RMA" subtitle="Declare a customer or supplier return, then a manager approves the refund / restock" hint="Awaiting manager approval" />}</PageData> },
  { test: (p) => /^\/returns\/team-[a-d]$/.test(p), render: () => <PageData load={loadReturns}>{(data) => <ReturnsPage data={data} canApprove={false} title="Returns / RMA" subtitle="Declare a customer or supplier return, then a manager approves the refund / restock" hint="Awaiting manager approval" />}</PageData> },
  { test: (p) => p === '/operations/returns', render: () => <PageData load={async () => { const [data, user] = await Promise.all([loadReturns(), me()]); return { data, canApprove: !!user && canViewPath(user, '/operations/returns') } }}>{({ data, canApprove }) => <ReturnsPage data={data} canApprove={canApprove} title="Return / Defect Approval" subtitle="Review declared returns, then approve the refund / restock or reject" hint="Awaiting your approval" />}</PageData> },
  { test: (p) => p === '/rework', render: () => <PageData load={async () => { const [{ rows }, returnsData] = await Promise.all([loadRework(), loadReturns()]); return { rows, returnsData } }}>{({ rows, returnsData }) => <div className="space-y-5"><PageHeader title="Rework Tracker" subtitle="Every rework across the pipeline — a stage is checked once the RMA reaches it. Click a row for the full review." /><ReworkTracker rows={rows} returns={returnsData.returns} /></div>}</PageData> },
  { test: (p) => p === '/installation', render: () => (
    <PageData load={async () => { const [data, installers, session, ret] = await Promise.all([loadInstallations(), employeesByRole('installer'), me(), loadReturns()]); return { data, installers, session, ret } }}>
      {({ data, installers, session, ret }) => (
        <div className="space-y-6">
          <PageHeader title="Installation Tracking" subtitle="Schedule installs, sign warranty & capture finished photos" />
          <InstallationManager data={data} installers={installers} canEditDelivered={!!session && (isAdmin(session.role) || session.role === 'operations_manager')} collectorName={session?.full_name?.trim() || session?.email || ''} returnOrders={ret.orders} returnPos={ret.pos} returnWorkshops={ret.workshops} />
        </div>
      )}
    </PageData>
  ) },
  { test: (p) => /^\/installation\/team-[a-d]$/.test(p), render: (p) => {
    const slug = canonSlug(p.split('/').pop()!)
    return (
      <PageData load={async () => { const [data, installers, session] = await Promise.all([loadInstallations(), employeesByRole('installer'), me()]); return { data, installers, session } }}>
        {({ data, installers, session }) => {
          const team = data.rows.find((r) => r.team_label && slugify(r.team_label) === slug)?.team_label ?? unslug(slug)
          const rows = data.rows.filter((r) => r.team_label && slugify(r.team_label) === slug)
          const kpi = { scheduled: rows.filter((r) => /to schedule|^scheduled|arrived/i.test(r.status ?? '')).length, inProgress: rows.filter((r) => /in progress|installation/i.test(r.status ?? '')).length, completed: rows.filter((r) => /delivered|completed/i.test(r.status ?? '')).length }
          return (
            <div className="space-y-6">
              <PageHeader title="Installation Tracking" subtitle={`${team} — schedule installs, sign warranty & capture finished photos`} />
              <InstallationManager data={{ ...data, rows, kpi }} installers={installers} canEditDelivered={!!session && (isAdmin(session.role) || session.role === 'operations_manager')} collectorName={session?.full_name?.trim() || session?.email || ''} />
            </div>
          )
        }}
      </PageData>
    )
  } },
  { test: (p) => /^\/pickup-task\/team-[a-d]$/.test(p), render: (p) => {
    const slug = canonSlug(p.split('/').pop()!)
    return (
      <PageData load={async () => { const db = createServerSupabase(); const { data: teams } = await db.from('delivery_teams').select('name').eq('active', true).limit(50); const team = (teams ?? []).map((t) => (t.name as string | null) ?? '').find((n) => n && slugify(n) === slug) ?? null; const data = team ? await loadPickupTasks(team) : null; return { team, data } }}>
        {({ team, data }) => !team || !data ? <div className="space-y-6"><PageHeader title="Pickup Task" subtitle="Dedicated team view" /><div className="rounded-xl border border-dashed border-border bg-surface px-6 py-14 text-center text-sm text-muted">Unknown team “{slug}” — check the delivery teams list.</div></div> : (
          <div className="space-y-6"><PageHeader title="Pickup Task" subtitle={`${team} — collect each item before the order can go on the route`} /><PickupTasks data={data} /></div>
        )}
      </PageData>
    )
  } },
  { test: (p) => /^\/pickup\/team-[a-d]$/.test(p) || /^\/pickup\/refund\/team-[a-d]$/.test(p), render: (p) => {
    const slug = canonSlug(p.split('/').pop()!)
    const refund = p.includes('/refund/')
    return (
      <PageData load={async () => { const [data, returnsData] = await Promise.all([loadPickups(), loadReturns()]); return { data, returnsData } }}>
        {({ data, returnsData }) => {
          const team = data.rows.find((r) => r.pickup_team && slugify(r.pickup_team) === slug)?.pickup_team ?? unslug(slug)
          const mine = data.rows.filter((r) => (refund ? r.refund : !r.refund) && r.pickup_team && slugify(r.pickup_team) === slug && !r.declared_onsite)
          const started = (r: (typeof mine)[number]) => r.pickup_arrived || r.pickup_dropped || !!r.pickup_proof_ok
          const rows = mine.filter((r) => r.route_final || started(r))
          const awaitingRoute = mine.length - rows.length
          return (
            <div className="space-y-5">
              <PageHeader title={refund ? 'Refund (Pull Out)' : 'Rework (Pull Out)'} subtitle={`${team} — ${refund ? 'items to collect from customers for refund.' : 'defective items to collect from customers for rework repair.'}`} />
              {awaitingRoute > 0 && <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800"><b>{awaitingRoute}</b> pull-out{awaitingRoute === 1 ? '' : 's'} waiting on the Route Planner — they appear here once Operations finalizes the route.</div>}
              <PickupRoutes rows={rows} team={team} returns={returnsData.returns} />
            </div>
          )
        }}
      </PageData>
    )
  } },
  { test: (p) => p === '/operations/stock-build', render: () => <PageData load={loadOperations}>{(data) => <div className="space-y-6"><PageHeader title="Stock Build" subtitle="Have a workshop build stock — no order, paid by the rate sheet, returns through Receiving QC" /><StockBuildManager workshops={data.workshops} products={data.products} /></div>}</PageData> },
  { test: (p) => p === '/operations/route-planner', render: () => <PageData load={loadDeliveries}>{(data) => <div className="space-y-6"><PageHeader title="Route Planner" subtitle="Booked stops per date and team — order the stops, set time windows, finalize, and send the route" /><RoutePlanner rows={data.rows} teams={data.teams} /></div>}</PageData> },
  { test: (p) => p === '/operations/edit-requests', render: () => <PageData load={async () => { const canDecide = await requireAnyEdit(['ops_approval']).then(() => true).catch(() => false); const rows = await listEditRequests(); return { canDecide, rows } }}>{({ canDecide, rows }) => <div className="space-y-6"><PageHeader title="Requested Edit Order" subtitle="Sales & Service edit requests on confirmed orders — review the before/after, then approve to apply or reject" /><EditRequestsManager rows={rows} canDecide={canDecide} /></div>}</PageData> },
  { test: (p) => p === '/operations/delivery-schedule', render: () => <PageData load={async () => { const canEdit = await requireAnyEdit(['ops_delivery_queue', 'ops_approval', 'orders']).then(() => true).catch(() => false); const data = await loadDeliveryQueue(); return { canEdit, data } }}>{({ canEdit, data }) => <div className="space-y-6"><PageHeader title="Delivery Schedule" subtitle="Set a new delivery date after coordinating with the customer on Messenger — the one-time ₱500 reschedule fee is added to the COD balance" /><DeliveryScheduleTool orders={data.orderRows} canEdit={canEdit} reworkTags={data.reworkTags} /></div>}</PageData> },
  { test: (p) => p === '/workshop/quality-control', render: (_p, _r, search) => {
    const ws = search.get('ws') ?? undefined
    return (
      <PageData load={async () => { const [data, rates, declarations, workers, qcStaff, user] = await Promise.all([loadWorkshop(ws), loadQcRates(), loadQcDeclarations(), loadProjectEmployees(), loadQcStaff(), me()]); return { data, rates, declarations, workers, qcStaff, user } }} deps={[ws]}>
        {(d) => <div className="space-y-6"><PageHeader title="Quality Control" subtitle="Declare finished jobs — auto project-base amount → HR approval → weekly payout" /><QualityControlManager data={d.data} rates={d.rates} declarations={d.declarations} workers={d.workers} qcStaff={d.qcStaff} qcName={d.user?.full_name ?? ''} /></div>}
      </PageData>
    )
  } },
  /* ---- HR ---- */
  { test: (p) => p === '/hr/directory', render: () => <PageData load={async () => { const user = await me(); const admin = !!user && isAdmin(user.role); const [employees, logins] = await Promise.all([loadHrEmployees(), admin ? loadDirectoryLogins() : Promise.resolve({ byEmployee: {}, shared: [] })]); return { employees, logins, admin } }}>{({ employees, logins, admin }) => <HrDirectoryManager employees={employees} logins={logins} canManageLogins={admin} />}</PageData> },
  { test: (p) => p === '/hr/payroll', render: () => <PageData load={async () => { const [runs, config] = await Promise.all([loadRuns(), loadPayrollConfig()]); const firstSlips = runs.length ? await loadPayslips(runs[0].id) : []; return { runs, config, firstSlips } }}>{({ runs, config, firstSlips }) => <HrPayrollManager runs={runs} initialRunId={runs[0]?.id ?? null} initialSlips={firstSlips} config={config} />}</PageData> },
  { test: (p) => p === '/hr/overtime', render: () => <PageData load={loadOvertime}>{(rows) => <HrOvertimeManager rows={rows} />}</PageData> },
  { test: (p) => p === '/hr/leaves', render: () => <PageData load={async () => { const [rows, employees] = await Promise.all([loadLeaves(), loadLeaveEmployees()]); return { rows, employees } }}>{({ rows, employees }) => <HrLeavesManager rows={rows} employees={employees} />}</PageData> },
  { test: (p) => p === '/hr/advances', render: () => <PageData load={async () => { const [rows, employees] = await Promise.all([loadAdvances(), loadAdvanceEmployees()]); return { rows, employees } }}>{({ rows, employees }) => <HrAdvancesManager rows={rows} employees={employees} />}</PageData> },
  { test: (p) => p === '/hr/projects', render: () => <PageData load={async () => { const [rows, employees, orders, pending, qcDeclarations, reworkMeta, orderItems, user] = await Promise.all([loadProjectWork(), loadProjectEmployees(), loadProjectOrders(), loadPendingFromOrders(), loadQcDeclarations(), loadReworkMetaByRma(), loadOrderItemLookup(), me()]); return { rows, employees, orders, pending, qcDeclarations, reworkMeta, orderItems, user } }}>{(d) => <HrProjectsManager rows={d.rows} employees={d.employees} orders={d.orders} pending={d.pending} qcDeclarations={d.qcDeclarations} reworkMeta={d.reworkMeta} orderItems={d.orderItems} approver={d.user?.full_name ?? ''} />}</PageData> },
  { test: (p) => p === '/hr/reports', render: () => <PageData load={loadHrReportData}>{(d) => <HrReportsManager attendance={d.attendance} payslips={d.payslips} runs={d.runs} advances={d.advances} employees={d.employees} />}</PageData> },
  { test: (p) => p === '/hr/wfh', render: () => (
    <PageData load={async () => { const user = (await me())!; const isManager = isAdmin(user.role) || user.role === 'operations_manager'; const mine = await loadMyWfh(user.full_name, user.email); const [wfhAll, myActivity, activityAll] = await Promise.all([isManager ? loadWfhAll() : Promise.resolve([]), mine.employeeId ? loadMyWfhActivity(mine.employeeId) : Promise.resolve(null), isManager ? loadWfhActivityAll() : Promise.resolve([])]); return { user, isManager, mine, wfhAll, myActivity, activityAll } }}>
      {(d) => <WfhClock meName={d.user.full_name} employeeId={d.mine.employeeId} employeeName={d.mine.employeeName} faceDescriptor={d.mine.faceDescriptor} row={d.mine.today} rows={d.mine.rows} overtime={d.mine.overtime} leaves={d.mine.leaves} advances={d.mine.advances} isManager={d.isManager} wfhAll={d.wfhAll} myActivity={d.myActivity} activityAll={d.activityAll} />}
    </PageData>
  ) },
  { test: (p) => p === '/payment-approval', render: () => <PageData load={async () => { const [rows, refunds, panAccounts] = await Promise.all([listPaymentApprovals(), listRefundPayouts(), listPanAccountsLite()]); return { rows, refunds, panAccounts } }}>{({ rows, refunds, panAccounts }) => <PaymentApprovalsManager rows={rows} refunds={refunds} panAccounts={panAccounts} />}</PageData> },
  /* ---- products / procurement / warehouse ---- */
  { test: (p) => p === '/products', render: () => (
    <PageData load={async () => { const supabase = createServerSupabase(); const [{ data, error }, locRows] = await Promise.all([supabase.from('product').select('*').order('id', { ascending: true }), fetchAll<{ code: string; zone: string | null }>((f, t) => supabase.from('warehouse_locations').select('code, zone').order('code').range(f, t))]); return { products: (data ?? []) as ProductRow[], error, locs: locRows } }}>
      {({ products, error, locs }) => {
        const locationCodes = (locs ?? []).map((l) => l.code as string).filter(Boolean)
        const zoneCodes = Array.from(new Set((locs ?? []).map((l) => l.zone as string).filter(Boolean)))
        return (
          <div className="space-y-6">
            <PageHeader title="Product Management" subtitle={error ? 'Failed to load from Supabase' : `${products.length} products · live from Supabase`} action={<AddProductButton locations={locationCodes} zones={zoneCodes} />} />
            {error ? <div className="rounded-xl border border-red-200 bg-red-50 px-5 py-4 text-sm text-red-700"><p className="font-semibold">Supabase error</p><p className="mt-1 font-mono text-xs">{error.message}</p></div> : <ProductsTable products={products} locations={locationCodes} zones={zoneCodes} />}
          </div>
        )
      }}
    </PageData>
  ) },
  { test: (p) => p === '/suppliers', render: () => <PageData load={async () => { const [data, rates] = await Promise.all([loadSuppliers(), loadRates()]); return { data, rates } }}>{({ data, rates }) => <div className="space-y-6"><PageHeader title="Suppliers" subtitle="Suppliers, Shopee shops, and rate list" /><SuppliersManager data={data} rates={rates} /></div>}</PageData> },
  { test: (p) => p === '/purchase-orders', render: () => <PageData load={loadPurchaseOrders}>{(data) => <div className="space-y-6"><PageHeader title="Purchase Orders" subtitle="Imported proforma invoices — order, track & receive container shipments" /><PurchaseOrdersManager data={data} /></div>}</PageData> },
  { test: (p) => p === '/costing', render: () => <PageData load={loadCostings}>{(data) => <div className="space-y-6"><PageHeader title="Product Costing" subtitle="Bill of materials, labor & expenses — cost to build per product" /><CostingManager data={data} /></div>}</PageData> },
  { test: (p) => p === '/locations', render: () => <PageData load={loadLocations}>{(data) => <div className="space-y-6"><PageHeader title="Warehouse Location Management" subtitle="Storage locations, occupancy, and product assignment" /><LocationsManager data={data} /></div>}</PageData> },
  { test: (p) => p === '/incoming', render: () => <PageData load={loadIncoming}>{(data) => <div className="space-y-6"><PageHeader title="Incoming Shipment" subtitle="Ordered POs in transit — count, QA-check & receive each item into stock" /><IncomingManager data={data} /></div>}</PageData> },
  { test: (p) => p === '/reports', render: () => <PageData load={loadRankings}>{(data) => <PerformanceRankings data={data} />}</PageData> },
  { test: (p) => p === '/settings', render: () => <PageData load={me}>{(user) => user ? <div className="max-w-2xl space-y-6"><PageHeader title="Settings" subtitle="Manage your profile and security." /><SettingsForm userId={user.id} fullName={user.full_name} email={user.email} role={user.role} avatarUrl={user.avatar_url} /><SecurityCard /><PushTestCard /></div> : null}</PageData> },
  /* ---- sales & service extras ---- */
  { test: (p) => p === '/quotations', render: () => <PageData load={async () => { const [assetStatus, quotations] = await Promise.all([quoteAssetStatus(), loadQuotations()]); return { assetStatus, quotations } }}>{({ assetStatus, quotations }) => <><PageHeader title="Formal Quotation" subtitle="Approved quotations, newest first. Click a row to read the document that was sent — quotations are created and revised in MTO Requests." /><div className="mt-6"><QuotationAssetsCard status={assetStatus} /></div><div className="mt-6"><QuotationsTable rows={quotations} /></div></>}</PageData> },
  { test: (p) => p === '/design-details', render: () => <PageData load={async () => { const [rows, swatches] = await Promise.all([loadDesignDetails(), loadSwatches().catch(() => [])]); return { rows, swatches } }}>{({ rows, swatches }) => <><PageHeader title="Design Details" subtitle="Design spec sheets for approval — sent straight to the customer's Messenger thread." /><div className="mt-6"><DesignDetailsTable rows={rows} swatchLibrary={swatches as unknown as LibSwatch[]} /></div></>}</PageData> },
  { test: (p) => p === '/mattress-orders', render: () => <PageData load={loadMattressOrders}>{(data) => <div className="space-y-6 pb-16"><PageHeader title="Mattress Orders" subtitle="Uratex & cut-to-measure mattress orders by region" /><MattressOrdersManager data={data} /></div>}</PageData> },
  { test: (p) => p === '/warranty', render: () => <PageData load={loadWarranties}>{(data) => <div className="space-y-6"><PageHeader title="Warranty Documents" subtitle="Signed warranty certificates from completed installs — search, view & track validity" /><WarrantyDocumentsManager data={data} /></div>}</PageData> },
  /* ---- website ---- */
  { test: (p) => p === '/website/configurator', render: () => <PageData load={async () => { const [items, swatches] = await Promise.all([listConfiguratorItems(), loadSwatches()]); return { items, swatches } }}>{({ items, swatches }) => <div className="max-w-7xl"><PageHeader title="Made-to-Order Configurator" subtitle="Per-item website config — sizes and prices, fabrics, add-ons. Priced options show a running total and Buy now on the site; blank prices fall back to Request a Quote." /><ConfiguratorTab items={items} swatches={swatches} /></div>}</PageData> },
  { test: (p) => p === '/website/content', render: (_p, _r, search) => {
    const t = String(search.get('tab'))
    const tab = (['hero', 'homepage', 'promo-beds', 'site', 'reviews', 'videos'].includes(t) ? t : 'homepage') as 'hero' | 'homepage' | 'promo-beds' | 'site' | 'reviews' | 'videos'
    return (
      <PageData load={async () => { const [homepage, site, products, pending] = await Promise.all([loadContent<Record<string, unknown>>('homepage'), loadContent('site'), loadProducts(), loadContent<unknown[]>('pending_reviews')]); return { homepage, site, products, pending } }}>
        {({ homepage, site, products, pending }) => <div className="max-w-7xl"><PageHeader title="Website Content" subtitle="Hero slides, homepage copy and photos, promo bar and site settings, reviews and FAQs, videos and UGC — one place." /><ContentTabs homepage={withHomepageDefaults(homepage)} site={site} products={products as unknown as PickerProduct[]} pendingReviews={(pending ?? []) as never} initial={tab} /></div>}
      </PageData>
    )
  } },
  { test: (p) => p === '/website/shipping', render: () => <PageData load={() => loadContent('site')}>{(site) => <div className="max-w-7xl"><PageHeader title="Shipping Rates" subtitle="Delivery fee per province and city — this is what the customer sees at checkout." /><ShippingShell site={site} /></div>}</PageData> },
  { test: (p) => p === '/website/facebook-agent', render: () => <PageData load={async () => { const [scripts, site] = await Promise.all([loadFbScripts(), loadContent<Record<string, unknown>>('site')]); return { scripts, site } }}>{({ scripts, site }) => <div className="max-w-5xl"><PageHeader title="FB AI Agent" subtitle="What the bot replies with on Messenger — matched from the lowest priority down." /><FacebookAgentTab scripts={scripts} site={(site ?? {}) as never} /></div>}</PageData> },
]
