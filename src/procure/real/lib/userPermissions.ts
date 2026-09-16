import { externalSupabase as supabase } from '@/integrations/supabase/externalClient';
import { callAdminOperationsApi } from '@/lib/adminOperationsApi';

// All managed table names
export const MANAGED_TABLES = [
  'inventory',
  'container',
  'po_export',
  'orders',
  'refund',
  'return',
  'dashboard_inventory_arrival',
  'dashboard_fba_shipment',
  'dashboard_rma',
  'forecast_report',
  'monthly_sale_view',
  'incoming_shipment_view',
  'sale_tracker',
  'factory_list',
  'activity_log',
  'replacement_sku',
  'invoice_tracker',
  'shipping_requests',
  'po_tracker',
  'shopify_inventory',
  'yearly_sales',
  'instock_percentage',
  'instock_rate_dashboard',
  'ads_analytics',
  'all_channels_dashboard',
  'needs_attention',
  'channel_analytics',
  'incoming_shipment_dashboard',
  'invoice_tracker_logistics',
  'invoice_tracker_management',
  'shipping_requests_logistics',
  'shipping_requests_management',
  'po_tracker_logistics',
  'po_tracker_management',
] as const;

export type ManagedTable = typeof MANAGED_TABLES[number];

export const TABLE_LABELS: Record<ManagedTable, string> = {
  inventory: 'Product List',
  container: 'Containers Tracker',
  po_export: 'Inbound Orders',
  orders: 'Order Tracker',
  refund: 'Refunds / Adjustments',
  return: 'Returns',
  dashboard_inventory_arrival: 'Receiving Monitor',
  dashboard_fba_shipment: 'FBA Inbound Shipments',
  dashboard_rma: 'Manage RMA',
  forecast_report: 'Demand Planner & Reorder Decisions',
  monthly_sale_view: 'Monthly Sales',
  incoming_shipment_view: 'Inbound Shipment',
  sale_tracker: 'Order Log',
  factory_list: 'Vendor List',
  activity_log: 'Activity Log',
  replacement_sku: 'Replacement SKU',
  invoice_tracker: 'Freight Bills',
  shipping_requests: 'Dispatch Requests',
  po_tracker: 'Order Pipeline',
  shopify_inventory: 'Storefront Stock',
  yearly_sales: 'Sales by Month',
  instock_percentage: 'Instock %',
  instock_rate_dashboard: 'Availability Score',
  ads_analytics: 'Ad Spend vs Revenue',
  all_channels_dashboard: 'All Channels Dashboard',
  needs_attention: 'Flagged SKUs (Channels)',
  channel_analytics: 'Channel Analytics (Best Sellers)',
  incoming_shipment_dashboard: 'Inbound Shipment Dashboard (Channels)',
  invoice_tracker_logistics: 'Freight Bills (Logistics)',
  invoice_tracker_management: 'Freight Bills (Management)',
  shipping_requests_logistics: 'Dispatch Requests (Logistics)',
  shipping_requests_management: 'Dispatch Requests (Management)',
  po_tracker_logistics: 'Order Pipeline (Logistics)',
  po_tracker_management: 'Order Pipeline (Management)',
};

/** Display grouping for the Table Permissions dialog — mirrors the sidebar so
 *  the long flat list is organized into sections. Every ManagedTable should
 *  appear in exactly one group; any that are missed fall under "Other" in the UI. */
export const MANAGED_TABLE_GROUPS: { label: string; tables: ManagedTable[] }[] = [
  { label: 'Overview',                     tables: ['inventory'] },
  { label: 'Sales',                        tables: ['sale_tracker', 'orders', 'refund', 'return'] },
  { label: 'Procurement',                  tables: ['po_export', 'factory_list'] },
  { label: 'Booking Board',    tables: ['invoice_tracker', 'shipping_requests', 'po_tracker'] },
  { label: 'Booking Board (Logistics)',  tables: ['invoice_tracker_logistics', 'shipping_requests_logistics', 'po_tracker_logistics'] },
  { label: 'Booking Board (Management)', tables: ['invoice_tracker_management', 'shipping_requests_management', 'po_tracker_management'] },
  { label: 'Inventory',                    tables: ['dashboard_inventory_arrival', 'incoming_shipment_view', 'container', 'dashboard_fba_shipment', 'replacement_sku'] },
  { label: 'Analytics',                    tables: ['forecast_report', 'monthly_sale_view', 'shopify_inventory', 'yearly_sales', 'instock_percentage', 'instock_rate_dashboard', 'ads_analytics', 'all_channels_dashboard', 'needs_attention', 'channel_analytics', 'incoming_shipment_dashboard'] },
  { label: 'System',                       tables: ['dashboard_rma', 'activity_log'] },
];

// Routes that ONLY admins may see/access, regardless of table permissions.
// Checked by both the sidebar (link visibility) and ProtectedRoute (URL guard).
// Note: any /admin* path is already admin-only via ProtectedRoute's prefix check.
export const ADMIN_ONLY_ROUTES = new Set<string>([
  '/ads-analytics',
  '/activity-log',
]);

// Maps route paths to their required table permission
export const ROUTE_TABLE_MAP: Record<string, ManagedTable> = {
  '/product-list': 'inventory',
  '/replacement-sku': 'replacement_sku',
  '/containers-tracker': 'container',
  
  '/purchase-order-tracker': 'po_export',
  '/order-tracker': 'orders',
  '/refunds-adjustments': 'refund',
  '/returns': 'return',
  '/inventory-arrivals': 'dashboard_inventory_arrival',
  '/fba-inbound-shipments': 'dashboard_fba_shipment',
  '/manage-rma': 'dashboard_rma',
  '/monthly-forecast': 'forecast_report',
  '/inventory-planner': 'forecast_report',
  '/sales-by-source': 'forecast_report',
  '/monthly-sales': 'monthly_sale_view',
  '/incoming-shipment': 'incoming_shipment_view',
  '/sale-tracker': 'sale_tracker',
  '/factory-list': 'factory_list',
  '/activity-log': 'activity_log',
  '/invoice-tracker': 'invoice_tracker',
  '/shipping-requests': 'shipping_requests',
  '/po-tracker': 'po_tracker',
  '/all-channels': 'all_channels_dashboard',
  '/channel-analytics': 'channel_analytics',
  '/shopify-inventory': 'shopify_inventory',
  '/yearly-sales': 'yearly_sales',
  '/instock-percentage': 'instock_percentage',
  '/instock-rate-dashboard': 'instock_rate_dashboard',
  '/ads-analytics': 'ads_analytics',
  '/order-logistics': 'invoice_tracker_logistics',
  '/order-logistics-shipping': 'shipping_requests_logistics',
  '/order-logistics-po': 'po_tracker_logistics',
  '/order-management': 'invoice_tracker_management',
  '/order-management-shipping': 'shipping_requests_management',
  '/order-management-po': 'po_tracker_management',
  // Booking Dashboard tabs — gated by each group's shipping-requests permission.
  '/booking-dashboard': 'shipping_requests',
  '/order-logistics-dashboard': 'shipping_requests_logistics',
  '/order-management-dashboard': 'shipping_requests_management',
};

export interface UserPermission {
  id: string;
  user_id: string;
  table_name: string;
  can_view: boolean;
  can_edit: boolean;
  created_at: string;
}

export interface UserProfile {
  id: string;
  email: string;
  full_name: string;
  role: string;
  status: string;
  country: string | null;
  countries?: string[] | null;
  factories?: string[] | null;
  created_at: string;
}

// Helper to call the admin-operations edge function
async function callAdminApi(action: string, body: Record<string, unknown>): Promise<any> {
  return callAdminOperationsApi(action, body);
}

// Fetch all profiles (admin only, via edge function)
export async function fetchAllProfiles(): Promise<UserProfile[]> {
  const result = await callAdminApi('get_all_profiles', {});
  return (result.data || []) as UserProfile[];
}

// Create a new user (admin only). The account is created + approved immediately
// with a temporary password the admin shares with the user.
export async function adminCreateUser(input: {
  email: string;
  fullName: string;
  role: string;
  password: string;
}): Promise<{ id: string; emailQueued: boolean }> {
  const result = await callAdminApi('admin_create_user', input);
  return { id: result.id as string, emailQueued: !!result.emailQueued };
}

// Force a user to re-enroll their authenticator (admin only) — removes their
// existing TOTP factor(s) so their next login shows a fresh QR/key to scan.
export async function resetUserMfa(userId: string): Promise<{ removed: number }> {
  const result = await callAdminApi('admin_reset_mfa', { userId });
  return { removed: Number(result.removed ?? 0) };
}

// Fetch user profile - uses edge function to bypass RLS
export async function getUserProfile(userId: string): Promise<UserProfile | null> {
  try {
    const result = await callAdminApi('get_own_profile', {});
    return (result.data as UserProfile) ?? null;
  } catch {
    // Fallback to direct query
    const { data, error } = await supabase
      .from('profiles' as any)
      .select('*')
      .eq('id', userId)
      .maybeSingle();
    if (error || !data) return null;
    return data as unknown as UserProfile;
  }
}

// Fetch user permissions for the current user (self-service, bypasses RLS)
export async function getUserPermissions(userId: string): Promise<UserPermission[]> {
  try {
    const result = await callAdminApi('get_own_permissions', {});
    return (result.data || []) as UserPermission[];
  } catch (err) {
    const { data, error } = await supabase
      .from('user_permissions' as any)
      .select('*')
      .eq('user_id', userId);
    if (error || !data) return [];
    return data as unknown as UserPermission[];
  }
}

// Fetch permissions for another user (admin only, via edge function)
export async function getUserPermissionsAdmin(userId: string): Promise<UserPermission[]> {
  const result = await callAdminApi('get_permissions', { userId });
  return (result.data || []) as UserPermission[];
}

// Check if user can view a table
export function canViewTable(
  permissions: UserPermission[],
  tableName: string,
  role: string
): boolean {
  if (role === 'admin') return true;
  const perm = permissions.find((p) => p.table_name === tableName);
  return perm?.can_view ?? false;
}

// Check if user can edit a table
export function canEditTable(
  permissions: UserPermission[],
  tableName: string,
  role: string
): boolean {
  if (role === 'admin') return true;
  const perm = permissions.find((p) => p.table_name === tableName);
  return perm?.can_edit ?? false;
}

// Check if a route is accessible
export function canAccessRoute(
  permissions: UserPermission[],
  route: string,
  role: string
): boolean {
  if (role === 'admin') return true;
  const tableName = ROUTE_TABLE_MAP[route];
  if (!tableName) return false; // Unmapped routes are denied for non-admins
  return canViewTable(permissions, tableName, role);
}

// Update a user's profile (admin operation via edge function)
export async function updateUserProfile(
  userId: string,
  updates: Partial<Pick<UserProfile, 'role' | 'status' | 'country' | 'countries' | 'factories'>>
): Promise<UserProfile> {
  const result = await callAdminApi('update_profile', { userId, updates });
  return result.data as UserProfile;
}

// Save permissions for a user (admin operation via edge function)
export async function setAllUserPermissions(
  userId: string,
  permissions: { table_name: string; can_view: boolean; can_edit: boolean }[]
): Promise<boolean> {
  const result = await callAdminApi('upsert_permissions', { userId, permissions });
  return !!result.data;
}

// Delete a user EVERYWHERE: removes from auth.users (gotrue) which then
// cascades to public.profiles via the FK `profiles.id REFERENCES auth.users(id)
// ON DELETE CASCADE`. Frees up the email for re-signup. Replaces the older
// `delete_profile` action which only removed the profile row and left an
// orphan auth user blocking future registrations with the same email.
export async function deleteUserProfile(userId: string): Promise<boolean> {
  const result = await callAdminApi('delete_auth_user', { userId });
  return result.success === true;
}
