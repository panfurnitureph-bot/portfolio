// Shared formatting helpers (PHP locale).

export function peso(value: number): string {
  return new Intl.NumberFormat("en-PH", {
    style: "currency",
    currency: "PHP",
    maximumFractionDigits: 0,
  }).format(value);
}

// Exact peso — keeps centavos when present (₱0.90 stays ₱0.90, ₱1,500 stays clean).
// Use for recorded payment amounts where rounding misleads.
export function pesoExact(value: number): string {
  const hasCents = Math.round(value * 100) % 100 !== 0;
  return new Intl.NumberFormat("en-PH", {
    style: "currency",
    currency: "PHP",
    minimumFractionDigits: hasCents ? 2 : 0,
    maximumFractionDigits: 2,
  }).format(value);
}

export function number(value: number): string {
  return new Intl.NumberFormat("en-PH").format(value);
}

export function shortDate(iso: string): string {
  return new Intl.DateTimeFormat("en-PH", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(iso));
}

// Title-case an enum/snake value for display, e.g. "pending_approval" -> "Pending Approval".
export function label(value: string): string {
  return value
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}
