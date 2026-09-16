/* Replaces @/components/shared/OrderDashboardTabs: the Freight Bills, Dispatch Requests, Order Pipeline and
   Booking Board are showcased as separate products, so the production "Sheets" tab bar that links
   between them is not rendered here. Same exports as the original. */
export type TabGroup = 'finance' | 'logistics' | 'management'
export type DashboardTab = 'invoice' | 'shipping' | 'po' | 'dashboard'
export function OrderDashboardTabs(_props: { group: TabGroup; activeTab: DashboardTab }) { void _props; return null }
