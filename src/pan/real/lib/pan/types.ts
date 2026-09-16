// PAN Overall — cash-flow ledger types (client-safe, no server imports).
export type TxnKind = "income" | "expense" | "transfer";
export type CategoryKind = "income" | "expense";

// Mode of Payment — how the money moved (separate from which account holds it).
export const MOP_OPTIONS = ["Cash", "Bank Transfer", "GCash", "Maya", "Check", "Online", "Debit/Credit Card"] as const;
export type Mop = (typeof MOP_OPTIONS)[number];

export type PanAccount = {
  id: number;
  name: string;
  opening_balance: number;
  sort_order: number;
  active: boolean;
};

export type PanCategory = {
  id: number;
  name: string;
  kind: CategoryKind;
  sort_order: number;
  active: boolean;
};

export type PanTransaction = {
  id: number;
  txn_date: string;
  account_id: number;
  category_id: number | null;
  kind: TxnKind;
  details: string | null;
  amount: number; // signed: +in / -out
  transfer_group: string | null;
  created_at: string;
};

// Row joined with display names for the ledger table.
// source "order" = auto-pulled from a paid order (read-only, not stored).
export type PanTxnRow = PanTransaction & {
  account_name: string;
  category_name: string | null;
  source?: "manual" | "order" | "payroll" | "advance" | "workshop" | "purchase" | "return";
  // For source "order" rows: the originating order, so the ledger can attach that
  // order's Acknowledgement Receipt in the last column.
  order_id?: number | null;
  order_number?: string | null;
  // Showroom kung saan naganap ang sale (orders.branch ?? sales rep's employees.branch).
  branch?: string | null;
};

export type AccountBalance = { account: PanAccount; balance: number };
