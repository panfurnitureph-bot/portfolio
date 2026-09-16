"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Modal } from "./modal";
import { EditOrderModal } from "./edit-order-modal";
import { deleteOrder } from "@/app/orders/actions";
import { ASSIGNEES } from "@/lib/assignees";
import type { OrderRow, ProductRow } from "@/lib/supabase/server";

export function OrderRowActions({ order, products = [], assignees = ASSIGNEES.map((n) => ({ name: n, role: "" })), constructors = [], canEditWorkshop = false, isSalesOnly = false }: { order: OrderRow; products?: ProductRow[]; assignees?: { name: string; role?: string }[]; constructors?: { name: string; role: string }[]; canEditWorkshop?: boolean; isSalesOnly?: boolean }) {
  const [editOpen, setEditOpen] = useState(false);
  const [delOpen, setDelOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();

  function remove() {
    setError(null);
    start(async () => {
      const res = await deleteOrder(order.id);
      if ("error" in res) { setError(res.error); return; }
      setDelOpen(false);
      router.refresh();
    });
  }

  return (
    <>
      <div className="flex items-center justify-center gap-1">
        <button onClick={() => setEditOpen(true)} aria-label="Edit" className="flex h-8 w-8 items-center justify-center rounded-lg text-muted hover:bg-stone-100 hover:text-primary">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9" /><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" /></svg>
        </button>
        <button onClick={() => { setError(null); setDelOpen(true); }} aria-label="Delete" className="flex h-8 w-8 items-center justify-center rounded-lg text-muted hover:bg-red-50 hover:text-danger">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m2 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" /></svg>
        </button>
      </div>

      <EditOrderModal order={order} open={editOpen} onClose={() => setEditOpen(false)} products={products} assignees={assignees} constructors={constructors} canEditWorkshop={canEditWorkshop} isSalesOnly={isSalesOnly} />

      {/* Delete */}
      <Modal open={delOpen} onClose={() => setDelOpen(false)} title="Delete Order" size="sm"
        footer={
          <div className="flex justify-end gap-2">
            <button onClick={() => setDelOpen(false)} disabled={pending} className="rounded-lg border border-border bg-surface px-4 py-2 text-sm font-medium hover:bg-stone-100 disabled:opacity-60">Cancel</button>
            <button onClick={remove} disabled={pending} className="rounded-lg bg-danger px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-60">{pending ? "Deleting…" : "Delete"}</button>
          </div>
        }>
        <p className="text-sm">Delete order <span className="font-semibold">{order.order_number ?? order.customer_name}</span>? This cannot be undone.</p>
        {error && <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-xs font-medium text-red-700">{error}</p>}
      </Modal>
    </>
  );
}
