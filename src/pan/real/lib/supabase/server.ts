/* DEMO SHIM — the real file creates a service-role Supabase client (server-only). Here the same
   API is served by the in-browser fake client over the demo database. Row types below are verbatim. */
import { createFakeSupabase } from '../../../db/fake-supabase'

export function createServerSupabase() {
  return createFakeSupabase() as unknown as import('@supabase/supabase-js').SupabaseClient
}

export type ProductRow = {
  id: number;
  product_name: string;
  sku: string | null;
  category: string | null;
  color: string | null;
  dimension: string | null;
  supplier: string | null;
  cost: number | null;
  price: number | null;
  product_type?: string | null; // "Local" | "Imported" — Imported = price locked on orders
  status: string | null;
  barcode?: string | null;
  location?: string | null;
  warehouse_location?: string | null;
  // Specifications / design details (0166) — isang linya kada spec; galing sa
  // customized builder, ipinapakita sa product browser detail pane.
  specs?: string | null;
  // LAHAT ng litrato (0230) at color variants (0231) - opsyonal, wala sa
  // lumang DB.
  images?: string[] | null;
  color_variants?: unknown;
  // Rich / Excel-style columns
  image_url?: string | null;
  level_of_priority?: string | null;
  factory?: string | null;
  kit?: boolean | null;
  shadow?: boolean | null;
  purchasing_status?: string | null;
  shopify_status?: string | null;
  sellercloud_link?: string | null;
  shopify_link?: string | null;
};

// Row in the `orders` table (public.orders) — full schema.
export type OrderRow = {
  id: number;
  order_number: string | null;
  date_order: string | null;
  customer_name: string | null;
  Source: string | null;
  address: string | null;
  address_lat: number | null;
  address_lng: number | null;
  contact_number: string | null;
  email: string | null;
  fb_name?: string | null;
  fb_link?: string | null;
  product_name: string | null;
  sku: string | null;
  category: string | null;
  color: string | null;
  dimension: string | null;
  date_downpayment: string | null;
  downpayment_price: number | null;
  full_payment_date: string | null;
  full_payment: number | null;
  full_payment_price: number | null;
  workshop_date: string | null;
  date_of_delivery: string | null;
  remaining_days: number | null;
  status: string | null;
  assigned: string | null;
  is_rush?: boolean | null;
  // Receipt data (jsonb; null until set). Enables multi-item receipts.
  mop?: string | null;
  receipt_items?: {
    qty: number; description: string; unitPrice: number; image?: string | null;
    sku?: string | null; category?: string | null; color?: string | null; dimension?: string | null;
    workshop?: string | null; constructorName?: string | null; customized?: boolean;
  }[] | null;
  receipt_discounts?: { label: string; amount: number }[] | null;
  receipt_payment_terms?: { label: string; amount: number }[] | null;
  transaction_images?: string[] | null;
  inventory_deducted?: boolean | null;
  workshop_completed_at?: string | null;
  // Maya (PayMaya) Checkout — set when a hosted checkout is created for the balance.
  maya_checkout_id?: string | null;
  maya_status?: string | null;
  maya_ref?: string | null;
  maya_paid_at?: string | null;
  maya_receipt_v?: number | null;
  maya_issuer?: string | null;
  maya_receipt_no?: string | null;
  maya_amount?: number | null;
  // Messenger PSID ng customer (galing sa CHAT WITH US NOW ref) — migration 0135.
  customer_psid?: string | null;
  // Per-order rush deadline sa araw (migration 0136). NULL = global threshold.
  rush_days?: number | null;
};

// Row in the `inventory` table.
export type InventoryRow = {
  id: number;
  product_name: string;
  sku: string | null;
  category: string | null;
  color: string | null;
  dimension: string | null;
  oh_inv: number | null;
  reserved: number | null;
  available: number | null;
  location: string | null;
  warehouse_location: string | null;
  supplier: string | null;
  status: string | null;
};
