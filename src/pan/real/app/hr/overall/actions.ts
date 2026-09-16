"use server";

import { revalidatePath } from "next/cache";
import { randomUUID } from "crypto";
import { createServerSupabase } from "@/lib/supabase/server";
import { getSession } from "@/lib/auth/session";
import { hasPermission } from "@/lib/auth/permissions";
import { audit, snapshot, auditAfter } from "@/lib/audit";
import { money } from "@/lib/num";
import type { CategoryKind, TxnKind } from "@/lib/pan/types";

const PATH = "/hr/overall";

async function requireManager() {
  const me = await getSession();
  if (!me || !hasPermission(me, "hr_overall", "edit")) throw new Error("Forbidden.");
  return me;
}

type Res = { ok: true } | { error: string };

// ── Accounts ───────────────────────────────────────────────────────────────
export async function createAccount(name: string, openingBalance: number): Promise<Res> {
  await requireManager();
  if (!name.trim()) return { error: "Account name is required." };
  const db = createServerSupabase();
  const { error } = await db.from("pan_accounts").insert({ name: name.trim(), opening_balance: money(openingBalance) });
  if (error) return { error: error.message };
  revalidatePath(PATH);
  return { ok: true };
}

export async function updateAccount(id: number, name: string, openingBalance: number): Promise<Res> {
  await requireManager();
  if (!name.trim()) return { error: "Account name is required." };
  const db = createServerSupabase();
  const { error } = await db.from("pan_accounts").update({ name: name.trim(), opening_balance: money(openingBalance) }).eq("id", id);
  if (error) return { error: error.message };
  revalidatePath(PATH);
  return { ok: true };
}

export async function deleteAccount(id: number): Promise<Res> {
  await requireManager();
  const db = createServerSupabase();
  const { count } = await db.from("pan_transactions").select("id", { count: "exact", head: true }).eq("account_id", id);
  if ((count ?? 0) > 0) return { error: `Account has ${count} transaction(s). Remove or reassign them first.` };
  const { error } = await db.from("pan_accounts").delete().eq("id", id);
  if (error) return { error: error.message };
  revalidatePath(PATH);
  return { ok: true };
}

// ── Categories ───────────────────────────────────────────────────────────────
export async function createCategory(name: string, kind: CategoryKind): Promise<Res> {
  await requireManager();
  if (!name.trim()) return { error: "Category name is required." };
  const db = createServerSupabase();
  const { error } = await db.from("pan_categories").insert({ name: name.trim(), kind });
  if (error) return { error: error.message };
  revalidatePath(PATH);
  return { ok: true };
}

export async function updateCategory(id: number, name: string, kind: CategoryKind): Promise<Res> {
  await requireManager();
  if (!name.trim()) return { error: "Category name is required." };
  const db = createServerSupabase();
  const { error } = await db.from("pan_categories").update({ name: name.trim(), kind }).eq("id", id);
  if (error) return { error: error.message };
  revalidatePath(PATH);
  return { ok: true };
}

export async function deleteCategory(id: number): Promise<Res> {
  await requireManager();
  const db = createServerSupabase();
  const { error } = await db.from("pan_categories").delete().eq("id", id); // txns keep null category
  if (error) return { error: error.message };
  revalidatePath(PATH);
  return { ok: true };
}

// ── Transactions ─────────────────────────────────────────────────────────────
export type TxnInput = {
  txn_date: string;
  kind: TxnKind;
  account_id: number;          // for transfer: the SOURCE account
  to_account_id?: number | null; // transfer destination
  category_id?: number | null;
  amount: number;              // always entered positive; sign applied by kind
  details?: string | null;
};

export async function addTransaction(input: TxnInput): Promise<Res> {
  const me = await requireManager();
  const db = createServerSupabase();
  if (!input.txn_date) return { error: "Date is required." };
  const amt = money(Math.abs(input.amount));
  if (amt <= 0) return { error: "Amount must be greater than zero." };
  const details = input.details?.trim() || null;

  if (input.kind === "transfer") {
    if (!input.account_id || !input.to_account_id) return { error: "Pick both source and destination accounts." };
    if (input.account_id === input.to_account_id) return { error: "Source and destination must differ." };
    const group = randomUUID();
    const { error } = await db.from("pan_transactions").insert([
      { txn_date: input.txn_date, account_id: input.account_id, kind: "transfer", details: details ?? "Transfer out", amount: -amt, transfer_group: group, created_by: me.id },
      { txn_date: input.txn_date, account_id: input.to_account_id, kind: "transfer", details: details ?? "Transfer in", amount: amt, transfer_group: group, created_by: me.id },
    ]);
    if (error) return { error: error.message };
  } else {
    if (!input.account_id) return { error: "Account is required." };
    const signed = input.kind === "income" ? amt : -amt;
    const { data, error } = await db.from("pan_transactions").insert({
      txn_date: input.txn_date, account_id: input.account_id, category_id: input.category_id ?? null,
      kind: input.kind, details, amount: signed, created_by: me.id,
    }).select("id").single();
    if (error) return { error: error.message };
    await auditAfter({ module: "pan_overall", table: "pan_transactions", recordId: data?.id ?? "—", action: "insert", snapshotTable: "pan_transactions", snapshotId: data?.id });
  }
  revalidatePath(PATH);
  return { ok: true };
}

export async function deleteTransaction(id: number): Promise<Res> {
  await requireManager();
  const db = createServerSupabase();
  // If part of a transfer, remove both legs.
  const { data: row } = await db.from("pan_transactions").select("transfer_group").eq("id", id).single();
  const group = row?.transfer_group as string | null;
  const before = await snapshot("pan_transactions", id);
  const q = db.from("pan_transactions").delete();
  const { error } = group ? await q.eq("transfer_group", group) : await q.eq("id", id);
  if (error) return { error: error.message };
  await audit({ module: "pan_overall", table: "pan_transactions", recordId: id, action: "delete", before });
  revalidatePath(PATH);
  return { ok: true };
}
