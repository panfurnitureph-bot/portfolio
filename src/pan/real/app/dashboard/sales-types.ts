// Client-safe types + config for the sales dashboard (no server imports, so the
// client component can pull these without dragging in the service-role client).

export type SalesOrder = {
  id: number;
  order_number: string | null;
  date_order: string | null;
  customer_name: string | null;
  source: string | null;
  status: string | null;
  assigned: string | null;
  downpayment: number;
  full_payment: number;
  total: number;
  category: string | null;
  items: { qty: number; description: string; unitPrice: number; category: string | null; image: string | null; cost: number }[];
};

// Editable 30-day targets (stored in app_settings, key "sales_targets").
export type SalesTargets = { revenue: number; orders: number; collection: number; aov: number };

// Realistic defaults (used until the user edits them in the dashboard).
export const DEFAULT_TARGETS: SalesTargets = { revenue: 5_000, orders: 10, collection: 80, aov: 600 };
