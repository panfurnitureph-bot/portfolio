/**
 * IDP planner filter state — persisted to Supabase so the background email
 * pipeline can replay the user's last-applied filters.
 *
 * The shape mirrors the React state in MonthlyForecast.tsx (`idpFilters`).
 * If the shape changes, bump SCHEMA_VERSION and migrate stored rows on read.
 */

import { externalSupabase as supabase } from "@/integrations/supabase/externalClient";
import {
  ACTION_TIER,
  type ActionTierLabel,
  computeEffectiveTier,
  puStatusCanonical,
  computeIdpRowMetrics,
} from "./idpMetrics";

export const SCHEMA_VERSION = 1;

export interface IdpFilterState {
  sku: string[];
  description: string[];
  factory: string[];
  status: string[];
  pu_status: string[];
  category: string[];
  country: string[];
  buyer: string[];
  inventory_analyst: string[];
  supply_status: string[];
  priority_level: string[];
  shadow: string[];
  action: string[];
}

export interface PersistedFilterRow {
  user_email: string;
  filters_json: { version: number; filters: IdpFilterState };
  search_query: string;
  updated_at: string;
}

/** Upsert one user's filter snapshot. Fire-and-forget from UI. */
export async function persistIdpFilterState(
  userEmail: string,
  filters: IdpFilterState,
  searchQuery: string,
): Promise<{ ok: boolean; error?: unknown }> {
  if (!userEmail) return { ok: false, error: "no user email" };
  try {
    const { error } = await (supabase as any)
      .from("planner_filter_state")
      .upsert(
        {
          user_email: userEmail,
          filters_json: { version: SCHEMA_VERSION, filters },
          search_query: searchQuery ?? "",
          updated_at: new Date().toISOString(),
        },
        { onConflict: "user_email" },
      );
    if (error) return { ok: false, error };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e };
  }
}

/**
 * Read all persisted filter snapshots in one shot — used by the email
 * pipeline so it can look up each recipient's filters with a single query.
 * Returns a map keyed by lowercased email.
 */
export async function loadAllIdpFilterStates(): Promise<
  Map<string, { filters: IdpFilterState; searchQuery: string }>
> {
  const out = new Map<string, { filters: IdpFilterState; searchQuery: string }>();
  try {
    const { data, error } = await (supabase as any)
      .from("planner_filter_state")
      .select("user_email, filters_json, search_query");
    if (error || !Array.isArray(data)) return out;
    for (const row of data) {
      const email = String((row as any).user_email ?? "").toLowerCase();
      if (!email) continue;
      const blob = (row as any).filters_json;
      const filters = blob?.filters ?? EMPTY_FILTERS;
      out.set(email, {
        filters: filters as IdpFilterState,
        searchQuery: String((row as any).search_query ?? ""),
      });
    }
  } catch {
    // Swallow — caller falls back to defaults if map is empty.
  }
  return out;
}

export const EMPTY_FILTERS: IdpFilterState = {
  sku: [],
  description: [],
  factory: [],
  status: [],
  pu_status: [],
  category: [],
  country: [],
  buyer: [],
  inventory_analyst: [],
  supply_status: [],
  priority_level: [],
  shadow: [],
  action: [],
};

/**
 * Apply a filter snapshot to a row list. Mirrors `dialogFilteredItems` in
 * MonthlyForecast.tsx so the email's rowset matches the UI's exactly.
 */
export function applyIdpFilters(
  rows: any[],
  filters: IdpFilterState,
  searchQuery: string,
): any[] {
  let out = rows;

  const search = searchQuery?.trim().toLowerCase();
  if (search) {
    out = out.filter((row) => {
      const sku = String((row as any).sku ?? "").toLowerCase();
      const description = String((row as any).description ?? "").toLowerCase();
      return sku.includes(search) || description.includes(search);
    });
  }

  const filterByList = (key: keyof IdpFilterState, rowKey: string) => {
    const list = filters[key] as string[] | undefined;
    if (!list || list.length === 0) return;
    out = out.filter((row) => list.includes(String((row as any)[rowKey] ?? "")));
  };

  filterByList("sku", "sku");
  filterByList("description", "description");
  filterByList("factory", "factory");
  filterByList("category", "category");
  filterByList("status", "status");
  filterByList("priority_level", "priority_level");
  filterByList("country", "country");
  filterByList("buyer", "buyer");
  filterByList("inventory_analyst", "inventory_analyst");

  if (filters.pu_status && filters.pu_status.length > 0) {
    out = out.filter((row) =>
      filters.pu_status.includes(puStatusCanonical((row as any).pu_status)),
    );
  }

  if (filters.action && filters.action.length > 0) {
    const wanted = new Set(filters.action);
    out = out.filter((row) => {
      const tier = computeEffectiveTier(row);
      return tier ? wanted.has(tier) : false;
    });
  }

  // Sort: replicate dialogFilteredItems sort exactly — tier rank ASC, then
  // urgent rows by revenue_loss DESC, then days-to-must-order ASC.
  const TIER_ORDER: ActionTierLabel[] = [
    ACTION_TIER.URGENT,
    ACTION_TIER.ORDER_30,
    ACTION_TIER.ORDER_60,
    ACTION_TIER.ORDER_90,
    ACTION_TIER.NO_ACTION,
    ACTION_TIER.MISSING_LT,
    ACTION_TIER.NO_DEMAND,
    ACTION_TIER.IN_PROGRESS,
    ACTION_TIER.DISCONTINUED,
  ];
  const TIER_RANK = new Map(TIER_ORDER.map((t, i) => [t, i] as const));
  const URGENT_RANK = TIER_RANK.get(ACTION_TIER.URGENT)!;
  const enriched = out.map((row) => {
    const tier = computeEffectiveTier(row);
    const rank = tier ? TIER_RANK.get(tier) ?? 999 : 999;
    const m = computeIdpRowMetrics(row);
    return {
      row,
      rank,
      dumo: m.daysUntilMustOrder ?? Number.POSITIVE_INFINITY,
      rl: Number((row as any).ninety_day_revenue_loss) || 0,
    };
  });
  enriched.sort((a, b) => {
    if (a.rank !== b.rank) return a.rank - b.rank;
    if (a.rank === URGENT_RANK && a.rl !== b.rl) return b.rl - a.rl;
    return a.dumo - b.dumo;
  });
  return enriched.map((e) => e.row);
}

/** One-line human summary of an active filter set. */
export function summarizeFilters(filters: IdpFilterState, searchQuery: string): string {
  const parts: string[] = [];
  if (filters.action.length > 0) parts.push(`Action: ${filters.action.join(" / ")}`);
  if (filters.factory.length > 0) parts.push(`Factory: ${filters.factory.join(" / ")}`);
  if (filters.pu_status.length > 0) parts.push(`Status: ${filters.pu_status.join(" / ")}`);
  if (filters.priority_level.length > 0) parts.push(`Priority: ${filters.priority_level.join(" / ")}`);
  if (filters.category.length > 0) parts.push(`Category: ${filters.category.join(" / ")}`);
  if (filters.country.length > 0) parts.push(`Country: ${filters.country.join(" / ")}`);
  if (filters.buyer.length > 0) parts.push(`Buyer: ${filters.buyer.join(" / ")}`);
  if (filters.inventory_analyst.length > 0)
    parts.push(`Inventory Analyst: ${filters.inventory_analyst.join(" / ")}`);
  if (filters.sku.length > 0) parts.push(`SKU: ${filters.sku.length} selected`);
  if (filters.description.length > 0)
    parts.push(`Product: ${filters.description.length} selected`);
  if (searchQuery?.trim()) parts.push(`Search: "${searchQuery.trim()}"`);
  return parts.length > 0 ? parts.join(" · ") : "None";
}
