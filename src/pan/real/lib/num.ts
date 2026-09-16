// Safe numeric coercion for money/quantity inputs coming from the client.
// Server Actions must never trust raw Number() — NaN, Infinity, and negatives
// would silently corrupt financial/stock records.

// Non-negative finite money amount (rounded to 2 decimals). Invalid → 0.
export function money(v: unknown): number {
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.round(n * 100) / 100;
}

// Non-negative finite integer quantity. Invalid → 0.
export function qty(v: unknown): number {
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.floor(n);
}
