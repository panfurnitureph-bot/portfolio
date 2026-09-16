"use server";

import { revalidatePath } from "next/cache";
import { createServerSupabase } from "@/lib/supabase/server";
import { requireAnyEdit } from "@/lib/auth/guard";
import { requireManagerOr } from "@/lib/auth/guard";
import { getSession } from "@/lib/auth/session";
import { isAdmin } from "@/lib/auth/rbac";
import { qaInspectorFor } from "@/lib/workshop/qa-inspector";

// Permission din (2026-09-05): Edit sa Workshop QC, Warehouse QC o Project
// Base (rate sheet) sa grid = makakapag-manage.
async function requireManager() {
  return requireManagerOr("ws_qc", "wh_qc", "hr_constructor");
}

export type QcRate = { id: number; section: string; kind: "base" | "addon"; name: string; amount: number };
export type QcAddOn = { name: string; amount: number };
// `part` = isang piyesang ipinalit sa rework (2026-08-28): sariling litrato
// bawat isa, para mapatunayang nailagay nga ang bawat binayaran ng customer.
export type QcCheckItem = { name: string; type: "main" | "base" | "addon" | "part"; photos: string[] };
export type QcDeclaration = {
  id: number;
  order_id: number | null;
  // Aling JOB ang dineklara (0185) - isang produkto kada job. Null sa lumang
  // tala; doon, ang buong order ang tanging kilalang saklaw.
  job_id: number | null;
  order_number: string | null;
  workshop: string | null;
  qc_name: string | null;
  worker_id: number | null;
  worker_name: string | null;
  workers: { id: number; name: string }[];
  item: string | null;
  item_image: string | null;
  category: string | null;
  add_ons: QcAddOn[];
  base_amount: number;
  addon_amount: number;
  total_amount: number;
  week_ending: string | null;
  status: string;
  checklist: QcCheckItem[];
  project_work_id: number | null;
  project_work_ids: number[];
  declared_at: string | null;
  approved_at: string | null;
  approved_by: string | null;
  fulfillment: "warehouse" | "pickup"; // route chosen at declaration (from the job)
  // BUILD MULA SA JOB — para sa mga LUMANG tala na pangalan lang ang naitala sa
  // `item`. Ang bagong declaration ay may sariling buong `item`, kaya ito ay
  // fallback lang; ang `job_category` ay ang uri ng PRODUKTO (Mattress, Custom
  // Bed), hindi ang seksyon ng bayad.
  job_specs: string | null;
  // STOCK BUILD — ipinagawa nang walang order, para lang magkastock. Walang
  // order number ang mga ito, kaya "—" lang ang lumalabas sa bawat listahan;
  // ito ang nagpapakilala sa kanila.
  stock_request: boolean;
  stock_sku: string | null;
  // Ang SKU at ang tunay na URI ng produkto (Mattress, Custom Bed). HUWAG
  // ipagkamali sa `category`, na ang SEKSYON pala ang laman ("Carpentry +
  // Upholstery") — iyon ang ipinapadala ng Declare.
  sku: string | null;
  product_category: string | null;
  job_category: string | null;
  // ANG PIYESANG INAPRUBAHAN NG REWORK (2026-08-28). Binayaran ito ng customer
  // at nakalista sa RMA; ang aprubador at ang tabla ay walang makitang ADD-ONS
  // sa rework (walang add-on rate doon) kaya blangkong gitling ang hanay —
  // kahit ito talaga ang idinagdag sa item.
  rework_parts: { part: string; qty: number; amount: number }[];
};

// Saturday of the given date's week (payroll cut). Returns YYYY-MM-DD.
function weekEndingSaturday(d = new Date()): string {
  const x = new Date(d);
  const add = (6 - x.getDay() + 7) % 7; // days until next Saturday (0 if already Sat)
  x.setDate(x.getDate() + add);
  return x.toISOString().slice(0, 10);
}

// Quality-Control staff (the people who can sign off a declaration) — QA-role employees.
export async function loadQcStaff(): Promise<{ id: number; name: string }[]> {
  const db = createServerSupabase();
  const { data } = await db.from("employees").select("id, name").eq("active", true).or("role.ilike.%quality%,role.ilike.%qc%,role.ilike.%qa%").order("name");
  return (data ?? []) as { id: number; name: string }[];
}

export async function loadQcRates(): Promise<QcRate[]> {
  const db = createServerSupabase();
  const { data } = await db.from("qc_rates").select("*").eq("active", true).order("section").order("kind").order("sort");
  return (data ?? []) as QcRate[];
}

export async function loadQcDeclarations(): Promise<QcDeclaration[]> {
  const db = createServerSupabase();
  const { data } = await db.from("qc_declarations").select("*").order("declared_at", { ascending: false }).limit(500);
  const rows = data ?? [];

  // Resolve each declaration's fulfillment route from its MATCHING workshop job:
  // ang REWORK declaration ay sa rework job (item_desc 'Rework · …'), ang normal
  // ay sa normal job — para hindi mag-flip ang route ng normal na row kapag ang
  // parehong order ay may rework na ibang route.
  // ALIN ANG STOCK BUILD. Ang job_id (0185) ang kawing; ang order_id ay null sa
  // mga ito, kaya walang ibang paraan.
  const jobIds = Array.from(new Set(rows.map((r) => r.job_id as number | null).filter((x): x is number => x != null)));
  const stockByJob = new Map<number, string | null>();
  if (jobIds.length > 0) {
    const { data: sj } = await db.from("workshop_job")
      .select("id, stock_request, stock_sku").in("id", jobIds).eq("stock_request", true);
    for (const j of sj ?? []) stockByJob.set(j.id as number, (j.stock_sku as string | null) ?? null);
  }

  // ANG SKU AT ANG URI NG PRODUKTO. Ang stock build ay may sariling SKU; ang
  // may order ay hinahanap sa mga linya ng resibo sa pamamagitan ng pangalan.
  // Ang uri ay laging galing sa `product` — doon ito nakatira, at doon ito
  // inaayos kapag mali.
  const skuByJob = new Map<number, string>();
  if (jobIds.length > 0) {
    const { data: js } = await db.from("workshop_job").select("id, order_id, item_desc").in("id", jobIds);
    const jobOrderIds = Array.from(new Set((js ?? []).map((j) => j.order_id as number | null).filter((x): x is number => x != null)));
    const skuByOrderItem = new Map<string, string>();
    if (jobOrderIds.length > 0) {
      const { data: os } = await db.from("orders").select("id, receipt_items").in("id", jobOrderIds);
      for (const o of os ?? []) {
        for (const it of ((o.receipt_items as { sku?: string | null; description?: string | null }[] | null) ?? [])) {
          const nm = String(it.description ?? "").split("\n")[0].trim().toLowerCase();
          const sk = (it.sku as string | null)?.trim();
          if (nm && sk) skuByOrderItem.set(`${o.id as number}|${nm}`, sk);
        }
      }
    }
    for (const j of js ?? []) {
      const id = j.id as number;
      const stockSku = stockByJob.get(id);
      if (stockSku) { skuByJob.set(id, stockSku); continue; }
      const oid = j.order_id as number | null;
      const nm = String(j.item_desc ?? "").split("\n")[0].trim().toLowerCase();
      const hit = oid != null && nm ? skuByOrderItem.get(`${oid}|${nm}`) : undefined;
      if (hit) skuByJob.set(id, hit);
    }
  }

  const catBySku = new Map<string, string>();
  const skus = Array.from(new Set(skuByJob.values()));
  if (skus.length > 0) {
    const { data: ps } = await db.from("product").select("sku, category").in("sku", skus);
    for (const p of ps ?? []) {
      const k = (p.sku as string | null)?.trim();
      const c = (p.category as string | null)?.trim();
      if (k && c) catBySku.set(k, c);
    }
  }

  const orderIds = Array.from(new Set(rows.map((r) => r.order_id as number | null).filter((x): x is number => x != null)));
  const fByOrder = new Map<number, { normal?: "warehouse" | "pickup"; rework?: "warehouse" | "pickup" }>();
  // order + pangalan ng item → build at uri ng produkto ng job.
  const specByOrderItem = new Map<string, { specs: string; category: string | null }>();
  if (orderIds.length > 0) {
    const { data: jobs } = await db.from("workshop_job").select("order_id, fulfillment, item_desc").in("order_id", orderIds);
    for (const j of jobs ?? []) {
      const oid = j.order_id as number | null;
      if (oid == null) continue;
      const slot = fByOrder.get(oid) ?? {};
      const f = ((j.fulfillment as string | null) ?? "warehouse") as "warehouse" | "pickup";
      if (/^rework/i.test((j.item_desc as string | null) ?? "")) slot.rework = f; else slot.normal = f;
      fByOrder.set(oid, slot);
      const desc = (j.item_desc as string | null) ?? "";
      const name = desc.split("\n")[0].trim();
      if (name) specByOrderItem.set(`${oid}|${name.toLowerCase()}`, { specs: desc.split("\n").slice(1).join("\n").trim(), category: null });
    }
  }

  // Ang piyesa ay nasa RMA, at ang RMA ay nasa unang linya ng `item`
  // ("Rework · RMA-000003 · PAN Sofa V.06").
  const partsByRma = new Map<string, { part: string; qty: number; amount: number }[]>();
  const rmaOfItem = (v: unknown) => /\b(RMA-\d+)\b/i.exec(String(v ?? ""))?.[1]?.toUpperCase() ?? null;
  const rmaNos = Array.from(new Set(rows.map((r) => rmaOfItem(r.item)).filter((x): x is string => !!x)));
  if (rmaNos.length > 0) {
    const { data: rets } = await db.from("returns").select("return_no, rework_parts").in("return_no", rmaNos);
    for (const r of rets ?? []) {
      const list = Array.isArray(r.rework_parts)
        ? (r.rework_parts as { part?: unknown; qty?: unknown; amount?: unknown }[])
            .map((x) => ({ part: String(x?.part ?? "").trim(), qty: Number(x?.qty) || 1, amount: Number(x?.amount) || 0 }))
            .filter((x) => x.part)
        : [];
      if (list.length) partsByRma.set(String(r.return_no), list);
    }
  }

  return rows.map((r: Record<string, unknown>) => {
    const isRwDecl = /^rework$/i.test((r.category as string | null) ?? "") || /^rework/i.test((r.item as string | null) ?? "");
    const slot = r.order_id != null ? fByOrder.get(r.order_id as number) : undefined;
    const declName = ((r.item as string | null) ?? "").split("\n")[0].trim().toLowerCase();
    const jobHit = r.order_id != null ? specByOrderItem.get(`${r.order_id as number}|${declName}`) : undefined;
    return {
      ...r,
      add_ons: (r.add_ons as QcAddOn[]) ?? [],
      checklist: (r.checklist as QcCheckItem[]) ?? [],
      workers: (r.workers as { id: number; name: string }[]) ?? [],
      project_work_ids: (r.project_work_ids as number[]) ?? [],
      fulfillment: (isRwDecl ? slot?.rework ?? slot?.normal : slot?.normal ?? slot?.rework) ?? "warehouse",
      job_specs: jobHit?.specs || null,
      job_category: jobHit?.category ?? null,
      stock_request: r.job_id != null && stockByJob.has(r.job_id as number),
      stock_sku: r.job_id != null ? stockByJob.get(r.job_id as number) ?? null : null,
      sku: r.job_id != null ? skuByJob.get(r.job_id as number) ?? null : null,
      product_category: r.job_id != null ? catBySku.get(skuByJob.get(r.job_id as number) ?? "") ?? null : null,
      rework_parts: partsByRma.get(rmaOfItem(r.item) ?? "") ?? [],
    };
  }) as QcDeclaration[];
}

// Workshop declares a finished job → creates a qc_declaration (For Approval) and marks the job Done.
export async function declareQc(input: {
  order_id: number | null; order_number: string | null; workshop: string | null;
  // Aling job ang ideklarado (0185). Ang order_id lang ay hindi sapat: ang STOCK
  // BUILD ay walang order, at ang isang order ay maaaring may ilang job.
  job_id?: number | null;
  // Ang `amount`/`section` ay para sa REWORK: bawat worker may SARILING open price
  // (walang equal split) — isang declaration/row pa rin para sa buong rework.
  qc_name: string | null; workers: { id: number; name: string; amount?: number; section?: string }[];
  item: string | null; item_image: string | null; category: string | null; base_amount: number; add_ons: QcAddOn[]; checklist: QcCheckItem[];
  fulfillment?: "warehouse" | "pickup";   // routes the item to warehouse Receiving QC (or direct pickup)
}): Promise<{ ok: true; id: number } | { error: string }> {
  await requireAnyEdit(["ws_qc"]);
  const db = createServerSupabase();
  const addon_amount = (input.add_ons ?? []).reduce((s, a) => s + (Number(a.amount) || 0), 0);
  const base = Number(input.base_amount) || 0;
  const total = base + addon_amount;
  const workers = input.workers ?? [];
  // NAKATAKDANG QA NG WORKSHOP (0236, 2026-09-06): ang QA ng declaration ay ang
  // inspector ng workshop (LRT/White → Dwight, Original → Adie), hindi ang
  // naka-login na nag-declare. Pambalik ang ipinasa kapag walang nakatakda.
  const qa = await qaInspectorFor(db, input.workshop);
  const { data, error } = await db.from("qc_declarations").insert({
    order_id: input.order_id, order_number: input.order_number || null, workshop: input.workshop || null,
    job_id: input.job_id ?? null,
    qc_name: qa?.name || input.qc_name || null,
    worker_id: workers[0]?.id ?? null, worker_name: workers.map((w) => w.name).join(", ") || null, workers,
    item: input.item || null, item_image: input.item_image || null, category: input.category || null, add_ons: input.add_ons ?? [],
    checklist: input.checklist ?? [],
    base_amount: base, addon_amount, total_amount: total, week_ending: weekEndingSaturday(),
    status: "For Approval",
  }).select("id").limit(1);
  if (error) return { error: error.message };
  const id = data?.[0]?.id as number;

  // Push HR — a finished job was declared for project-base salary QC approval.
  try {
    const { notifyQcDeclaration } = await import("@/lib/push/notify");
    await notifyQcDeclaration({
      orderNumber: input.order_number ?? `#${input.order_id ?? id}`,
      product: (input.item ?? "").split("\n")[0] || null,
      workshop: input.workshop ?? null,
      rate: total,
    });
  } catch { /* best-effort */ }

  // mark the workshop job "For Approval HR" + stamp the fulfillment route chosen at
  // declaration (warehouse → goes to Receiving QC; pickup → skips warehouse).
  // ANG JOB ANG SINUSUNDAN, HINDI ANG ORDER (0185). Kapag alam ang job_id ay
  // iisang hilera lang ang ginagalaw — tumpak, at umaabot sa STOCK BUILD na
  // walang order. Kapag wala (lumang tawag), ang order ang saklaw gaya ng dati.
  if (input.job_id != null || input.order_id != null) {
    const patch: Record<string, unknown> = { status: "For Approval HR", updated_at: new Date().toISOString() };
    if (input.fulfillment === "warehouse" || input.fulfillment === "pickup") patch.fulfillment = input.fulfillment;
    if (input.job_id != null) {
      await db.from("workshop_job").update(patch).eq("id", input.job_id).is("qc_received_at", null);
    } else {
      // Scope to jobs NOT YET received into stock, AT sa TAMANG uri ng job: ang
      // REWORK declaration ay sa rework job lang ('Rework · …'), ang normal ay sa
      // normal job lang — para hindi ma-flip ang route/status ng kabilang job.
      const isRwDecl = /^rework$/i.test(input.category ?? "") || /^rework/i.test(input.item ?? "");
      let q = db.from("workshop_job").update(patch).eq("order_id", input.order_id!).is("qc_received_at", null);
      q = isRwDecl ? q.ilike("item_desc", "rework%") : q.not("item_desc", "ilike", "rework%");
      await q;
    }
  }
  revalidatePath("/workshop/jobs");
  revalidatePath("/hr/projects");
  revalidatePath("/workshop");
  revalidatePath("/workshop/inventory");
  revalidatePath("/workshop/requests");
  revalidatePath("/workshop/quality-control");
  revalidatePath("/operations/approval");
  revalidatePath("/operations/tracker");
  revalidatePath("/quality-control");
  revalidatePath("/delivery");
  revalidatePath("/installation");
  return { ok: true, id };
}

// HR approves a declaration → creates the project-work (payroll) entry for the worker.
// REWORK: ang workshop ay nagde-declare ng WORKERS LANG (walang presyo) — si HR ang
// naglalagay ng sahod bawat worker sa approve (workerAmounts: employee id → ₱).
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export async function approveQc(id: number, _approvedBy: string, workerAmounts?: Record<number, number>): Promise<{ ok: true } | { error: string }> {
  const me = await requireManager();
  const db = createServerSupabase();
  const { data: rows } = await db.from("qc_declarations").select("*").eq("id", id).limit(1);
  const d = rows?.[0] as QcDeclaration | undefined;
  if (!d) return { error: "Declaration not found." };
  if (!/for approval/i.test(d.status)) return { error: "Already processed." };
  const workers = (d.workers?.length ? d.workers : (d.worker_id ? [{ id: d.worker_id, name: d.worker_name ?? "" }] : [])) as { id: number; name: string; amount?: number; section?: string }[];
  // HR override / rework pricing: ilapat ang ibinigay na per-worker amounts.
  if (workerAmounts) for (const w of workers) if (workerAmounts[w.id] != null) w.amount = Math.max(Number(workerAmounts[w.id]) || 0, 0);
  const isReworkDecl = /^rework$/i.test(d.category ?? "");
  // Rework: pwedeng ₱0 ang isang worker (desisyon ni HR) — ang mga ₱0 ay hindi
  // gagawan ng payroll row (skip sa insert sa ibaba), pero hindi hinaharang ang approve.
  // ₱0 REWORK declaration: walang workers at walang babayaran — payuan lang ang
  // pipeline (QC Passed), walang payroll na ilalagay. Workers ay required lang
  // kapag MAY perang ibabayad.
  let totalAmount = Number(d.total_amount) || 0;
  if (workers.some((w) => typeof w.amount === "number"))
    totalAmount = Math.round(workers.reduce((s, w) => s + (Number(w.amount) || 0), 0) * 100) / 100;
  if (!workers.length && totalAmount > 0) return { error: "No worker (Made By) set — cannot pay." };

  // Atomically CLAIM this declaration BEFORE inserting any payroll. Without a unique
  // constraint, two concurrent/retried approvals would both pass the read-check above and
  // each insert hr_project_work rows → the worker gets PAID TWICE. The conditional update
  // (only flips a row still 'For Approval') lets exactly one caller win; everyone else gets
  // zero rows back and bails before touching payroll. Mirrors applyPayment's atomic claim.
  const { data: claimed } = await db.from("qc_declarations").update({
    status: "Approved", approved_at: new Date().toISOString(), approved_by: me.full_name,
  }).eq("id", id).eq("status", "For Approval").select("id");
  if (!claimed || claimed.length !== 1) return { ok: true }; // already approved by someone else — do NOT pay again

  // Payroll rows only when there are workers to pay (a ₱0 rework has none).
  if (workers.length) {
    const addons = (d.add_ons ?? []).map((a) => a.name).filter(Boolean).join(", ");
    // REWORK: bawat worker ay may sariling `amount` (open price) — iyon ang
    // ibabayad, hindi ang equal split. Kapag walang per-worker amount, dating
    // behavior: hatiin nang pantay ang total.
    const hasOwn = workers.some((w) => typeof w.amount === "number");
    const shared = !hasOwn && workers.length > 1 ? ` [shared ÷${workers.length}]` : "";
    // Ang `item` ay may buong specs (multi-line) — ang PANGALAN lang ang
    // isinusulat sa payslip.
    const desc = [(d.item ?? "").split("\n")[0], addons && `(+ ${addons})`, shared].filter(Boolean).join(" ");
    const share = Math.round((totalAmount / workers.length) * 100) / 100; // split equally among the makers
    const workDate = (d.declared_at || new Date().toISOString()).slice(0, 10);

    const pwIds: number[] = [];
    for (const w of workers) {
      const amt = hasOwn ? Math.round((Number(w.amount) || 0) * 100) / 100 : share;
      if (hasOwn && amt <= 0) continue; // walang ₱0 na payroll row
      const { data: pw, error: pwErr } = await db.from("hr_project_work").insert({
        employee_id: w.id, project_name: d.item, order_number: d.order_number,
        rate: amt, ot: 0, description: hasOwn && w.section ? `${desc} — ${w.section}` : desc, amount: amt, work_date: workDate, status: "Unpaid",
      }).select("id").limit(1);
      if (pwErr) return { error: pwErr.message };
      if (pw?.[0]?.id) pwIds.push(pw[0].id as number);
    }

    // Backfill the payroll links onto the already-claimed declaration — pati na ang
    // final na per-worker amounts + total (para tama ang makikita sa record).
    const { error } = await db.from("qc_declarations").update({
      project_work_id: pwIds[0] ?? null, project_work_ids: pwIds,
      workers, base_amount: totalAmount, total_amount: totalAmount,
    }).eq("id", id);
    if (error) return { error: error.message };
  }

  // QC inspection fee — ₱100 bawat aprubadong declaration (isang item bawat
  // declaration) para sa QA na nag-inspect (qc_name, hal. Dwight/Adie).
  // Hiwalay ito sa worker payroll at pumapasok din sa hr_project_work →
  // Saturday cut. Kung hindi matagpuan ang pangalan sa employees (lumang
  // record / free-text), laktawan — huwag harangin ang approve.
  // NAKATAKDANG QA NG WORKSHOP (0236, 2026-09-06): ang fee ay sa inspector ng
  // workshop ng declaration; ang qc_name ay pambalik lang (lumang record /
  // walang nakatakda).
  const qaFixed = await qaInspectorFor(db, d.workshop);
  if (qaFixed || d.qc_name) {
    const QC_FEE = qaFixed?.fee ?? 100;
    try {
      let qcId: number | undefined = qaFixed?.id;
      if (!qcId && d.qc_name) {
        const { data: qcEmp } = await db.from("employees")
          .select("id").ilike("name", d.qc_name.trim()).eq("active", true).limit(1);
        qcId = qcEmp?.[0]?.id as number | undefined;
      }
      if (qcId && QC_FEE > 0) {
        // Ang QC fee row ay ISINASAMA sa project_work_ids ng declaration, kaya
        // ang pagpindot nito sa Constructor ay bumubukas ng PAREHONG review
        // preview — hindi ang hubad na edit form.
        const { data: qcPw } = await db.from("hr_project_work").insert({
          employee_id: qcId, project_name: d.item, order_number: d.order_number,
          rate: QC_FEE, ot: 0,
          description: `QC inspection — ${String(d.item ?? "").split("\n")[0]}`,
          amount: QC_FEE, work_date: (d.declared_at || new Date().toISOString()).slice(0, 10),
          status: "Unpaid",
        }).select("id");
        const qcPwId = qcPw?.[0]?.id as number | undefined;
        if (qcPwId) {
          const { data: cur } = await db.from("qc_declarations").select("project_work_ids").eq("id", id).maybeSingle();
          const ids = [...(((cur?.project_work_ids as number[] | null) ?? [])), qcPwId];
          await db.from("qc_declarations").update({ project_work_ids: ids }).eq("id", id);
        }
      }
    } catch { /* best-effort — ang approve mismo ay tuloy pa rin */ }
  }

  // HR approved → job is QC Passed → eligible for Delivery scheduling.
  // ANG JOB ANG UMUUSAD, HINDI ANG ORDER (0185). Dati ay nakabalot ito sa
  // `if (d.order_id != null)`, kaya ang STOCK BUILD — na walang order — ay
  // naiiwan sa "For Approval HR" habambuhay: bayad na sa rate sheet pero hindi
  // kailanman umaalis sa workshop.
  const jobId = (d as { job_id?: number | null }).job_id ?? null;
  if (jobId != null || d.order_id != null) {
    let advanced: { id: number; fulfillment?: string | null }[] | null = null;
    if (jobId != null) {
      const { data } = await db.from("workshop_job")
        .update({ status: "QC Passed", updated_at: new Date().toISOString() })
        .eq("id", jobId).is("qc_received_at", null)
        .select("id, fulfillment");
      advanced = data as typeof advanced;
    } else {
      // Same scoping as declareQc: not-yet-received AT tamang uri ng job lang
      // (rework declaration → rework job; normal → normal) ang umuusad.
      let adv = db.from("workshop_job")
        .update({ status: "QC Passed", updated_at: new Date().toISOString() })
        .eq("order_id", d.order_id!).is("qc_received_at", null);
      adv = isReworkDecl ? adv.ilike("item_desc", "rework%") : adv.not("item_desc", "ilike", "rework%");
      const { data } = await adv.select("id, fulfillment");
      advanced = data as typeof advanced;
    }
    // Ang natitira ay tungkol sa ORDER — walang order ang stock build, kaya
    // walang customer na aabisuhan at walang redelivery na babalikan.
    if (d.order_id != null) {
      // REWORK sa DIRECT PICKUP route: walang warehouse receiving — sa QC Passed
      // mismo, awtomatikong bumalik ang order sa Delivery Queue para sa
      // redelivery confirmation + routing. (Warehouse route → sa receiving scan.)
      if ((advanced ?? []).some((j) => (j as { fulfillment?: string | null }).fulfillment === "pickup")) {
        const { autoRedeliverRework } = await import("@/lib/returns/redeliver");
        await autoRedeliverRework(d.order_id);
      }
      // Push Warehouse/Delivery — the order passed QC and can be scheduled.
      try {
        const { notifyReadyForDelivery } = await import("@/lib/push/notify");
        await notifyReadyForDelivery({
          orderNumber: d.order_number ?? `#${d.order_id}`,
          product: d.item ?? null,
        });
      } catch { /* best-effort */ }
    }
  }
  revalidatePath("/hr/projects");
  revalidatePath("/workshop/jobs");
  revalidatePath("/delivery");
  revalidatePath("/workshop");
  revalidatePath("/workshop/inventory");
  revalidatePath("/workshop/requests");
  revalidatePath("/workshop/quality-control");
  revalidatePath("/operations/approval");
  revalidatePath("/operations/tracker");
  revalidatePath("/quality-control");
  revalidatePath("/installation");
  return { ok: true };
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export async function rejectQc(id: number, _by: string): Promise<{ ok: true } | { error: string }> {
  const me = await requireManager();
  const db = createServerSupabase();
  const { error } = await db.from("qc_declarations").update({ status: "Rejected", approved_at: new Date().toISOString(), approved_by: me.full_name }).eq("id", id).eq("status", "For Approval");
  if (error) return { error: error.message };
  revalidatePath("/hr/projects");
  revalidatePath("/workshop");
  revalidatePath("/workshop/jobs");
  revalidatePath("/workshop/inventory");
  revalidatePath("/workshop/requests");
  revalidatePath("/workshop/quality-control");
  return { ok: true };
}
