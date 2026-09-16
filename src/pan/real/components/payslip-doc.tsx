"use client";

import { useState, useRef, useTransition } from "react";
import { printHtml } from "@/lib/print-frame";
import type { ReactNode } from "react";
import { Modal } from "./modal";
import { shortDate } from "@/lib/format";
import { amountInWords } from "@/lib/hr/words";
import { COMPANY } from "@/lib/company";
import { getPayslipDetail } from "@/app/hr/payroll/actions";
import type { PayslipDetail } from "@/app/hr/payroll/data";
import { printRaw, linesToEscpos, twoCol, wrap, COLS, type PrintLine } from "@/lib/qz-print";

const money2 = (n: number) => (Number(n) || 0).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// 72mm thermal (Xprinter Q200) payslip — the single source for preview + print.
// Single column, no YTD (no room on 72mm). Aligned to receipt paper.
// Branches: regular employee (attendance + statutory) vs constructor (per-gawa).
function payslipModel(d: PayslipDetail): PrintLine[] {
  const { slip: s, run, emp, payslipNo, isProject, projects } = d;
  const dash = "-".repeat(COLS), eq = "=".repeat(COLS);
  const out: PrintLine[] = [];
  const push = (t: string, o: Partial<PrintLine> = {}) => out.push({ t, ...o });
  const cwrap = (txt: string, o: Partial<PrintLine> = {}) => wrap(txt).trimEnd().split("\n").forEach((t) => push(t, { center: true, ...o }));
  const lwrap = (txt: string, o: Partial<PrintLine> = {}) => wrap(txt).trimEnd().split("\n").forEach((t) => out.push({ t, pre: true, ...o }));
  const row = (l: string, r: string, o: Partial<PrintLine> = {}) => twoCol(l, r).trimEnd().split("\n").forEach((t) => out.push({ t, pre: true, ...o }));
  const p = (n: number) => "₱" + money2(n);

  // Header
  cwrap(COMPANY.name, { bold: true });
  cwrap(COMPANY.vatTin);
  cwrap(COMPANY.address);
  push(eq);
  push(isProject ? "CONSTRUCTOR PAYSLIP" : "EMPLOYEE PAYSLIP", { center: true, bold: true });
  push(eq);
  push("Payslip No: " + payslipNo, { bold: true });
  push("Period    : " + (run.period_start ? shortDate(run.period_start) : "—") + " - " + (run.period_end ? shortDate(run.period_end) : "—"));
  push("Pay Date  : " + (run.pay_date ? shortDate(run.pay_date) : "—") + "  (" + (run.pay_type || (isProject ? "Weekly" : "Semi-monthly")) + ")");
  push(dash);

  // Employee
  push("EMPLOYEE", { bold: true });
  push(emp.name + " (" + emp.code + ")", { bold: true });
  push("Role     : " + (isProject ? "Constructor" : (emp.position || emp.role || "—")));
  push("Hired    : " + (emp.hire_date ? shortDate(emp.hire_date) : "—"));
  push("TIN      : " + (emp.tin || "—"));
  if (!isProject) {
    push("SSS      : " + (emp.sss_no || "—"));
    push("PhilHealth: " + (emp.philhealth_no || "—"));
    push("Pag-IBIG : " + (emp.pagibig_no || "—"));
  }
  push("Bank Acct: " + (emp.bank_account || "—"));
  push(dash);

  // Earnings
  if (isProject) {
    push("PROJECT WORK (piece-rate)", { bold: true });
    if (projects.length === 0) push("No project work for this period.", { center: true });
    for (const pr of projects) {
      const label = pr.order_number || pr.project_name || "Project";
      row(label, p(pr.amount));
      if (pr.order_number && pr.project_name) lwrap("  " + pr.project_name);
    }
    push("                          " + "-".repeat(COLS - 26));
    row("Gross Pay", p(s.gross), { bold: true });
  } else {
    push("ATTENDANCE", { bold: true });
    row("Days Worked", String(s.days_worked ?? 0));
    row("OT Hours", Number(s.ot_hours || 0).toFixed(2));
    push(dash);
    push("EARNINGS", { bold: true });
    row("Basic Pay", p(s.basic_pay));
    if (s.ot_pay) row(`Overtime (${Number(s.ot_hours || 0).toFixed(2)}h)`, p(s.ot_pay));
    if (s.allowance) row("Allowance", p(s.allowance));
    row("Gross Pay", p(s.gross), { bold: true });
  }
  push(dash);

  // Deductions
  push("DEDUCTIONS", { bold: true });
  if (!isProject) {
    if (s.sss) row("SSS", p(s.sss));
    if (s.philhealth) row("PhilHealth", p(s.philhealth));
    if (s.pagibig) row("Pag-IBIG", p(s.pagibig));
    if (s.tax) row("Withholding Tax", p(s.tax));
  }
  if (s.cash_advance) row("Advance Payment", p(s.cash_advance));
  if (s.other_deductions) row("Other Deductions", p(s.other_deductions));
  const totalDed = (isProject ? 0 : Number(s.sss) + Number(s.philhealth) + Number(s.pagibig) + Number(s.tax)) + Number(s.cash_advance) + Number(s.other_deductions);
  if (totalDed === 0) push("None", { center: true });
  row("Total Deductions", p(totalDed), { bold: true });
  push(eq);

  // Net
  row("NET PAY", p(s.net_pay), { bold: true });
  push(eq);
  push("Amount in words:", { bold: true });
  cwrap(amountInWords(Number(s.net_pay)));
  push(dash);

  // Signatories
  push("Prepared by: Ralph Troy Noriega (HR)");
  push("Approved by: Allyssa Louise Noriega");
  push("Received by: " + emp.name);
  push(dash);
  push("System-generated payslip. Valid without", { center: true });
  push("signature. Keep for your records.", { center: true });
  push("");
  push("*** CONFIDENTIAL ***", { center: true, bold: true });
  return out;
}

// `load` = sariling paraan ng paghila ng slip, at `trigger` = sariling anyo ng
// pindutan (2026-08-25). Ang WFH ay nagpapakita ng KAPAREHONG dokumento, pero
// ang getPayslipDetail ay naka-gate sa `hr_payroll` edit — ang empleyado ay
// hindi manager. Ipinapasa nito ang self-scoped na loader kaysa kopyahin ang
// buong slip; iisang dokumento pa rin, isang lugar kung saan binabago.
export function PayslipDocButton({ payslipId, load, trigger }: {
  payslipId?: number;
  load?: () => Promise<PayslipDetail | null>;
  trigger?: (open: () => void) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [detail, setDetail] = useState<PayslipDetail | null>(null);
  const [pending, start] = useTransition();
  const [printing, setPrinting] = useState(false);
  const previewRef = useRef<HTMLDivElement>(null);

  function reopen() {
    setOpen(true);
    setDetail(null);
    start(async () => setDetail(load ? await load() : payslipId != null ? await getPayslipDetail(payslipId) : null));
  }

  const model = detail ? payslipModel(detail) : [];

  // Render the model to a 72mm browser page (no-QZ print fallback + "Save as PDF").
  function openDoc(title: string) {
    const body = model.map((ln) => {
      const style = ["white-space:pre", ln.center ? "text-align:center" : "text-align:left", ln.bold ? "font-weight:700" : ""].filter(Boolean).join(";");
      return `<div style="${style}">${(ln.t || " ").replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]!))}</div>`;
    }).join("");
    // Hidden iframe, hindi popup (2026-09-07): ang about:blank popup ay
    // ipinapasa ng desktop app sa Windows ("Get an app to open this 'about' link").
    printHtml(`<!doctype html><html><head><meta charset="utf-8"><title>${title.replace(/[<>]/g, "")}</title><style>@page{size:72mm auto;margin:0}body{margin:0;font-family:'Courier New',monospace;font-size:9px;width:72mm;padding:2mm}</style></head><body>${body}</body></html>`);
  }

  // Thermal print via QZ Tray → Xprinter Q200. Falls back to 72mm browser print.
  async function print() {
    if (!detail) return;
    setPrinting(true);
    try {
      await printRaw("Xprinter Q200", linesToEscpos(model));
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      const hint = /QZ_PRIVATE_KEY/.test(msg)
        // Ang susi ang kulang, hindi ang QZ Tray — konektado naman ito.
        // Ang pagsabing "make sure QZ Tray is running" ay nagpapahanap
        // sa maling lugar (2026-08-28).
        ? "The server has no signing key — ask IT to set QZ_PRIVATE_KEY."
        : "Make sure QZ Tray is running.";
      if (confirm(`Thermal print failed: ${msg}\n\n${hint}\n\nUse browser print (72mm) instead?`)) openDoc(`Payslip ${detail.payslipNo}`);
    } finally { setPrinting(false); }
  }

  // 72mm-wide PDF — snapshot the preview (keeps ₱) so it matches the receipt.
  async function downloadPdf() {
    const node = previewRef.current;
    if (!node) return;
    const [{ default: html2canvas }, { jsPDF }] = await Promise.all([import("html2canvas-pro"), import("jspdf")]);
    const canvas = await html2canvas(node, { scale: 2, backgroundColor: "#ffffff" });
    const wmm = 72;
    const hmm = (wmm * canvas.height) / canvas.width;
    const pdf = new jsPDF({ unit: "mm", format: [wmm, hmm] });
    pdf.addImage(canvas.toDataURL("image/png"), "PNG", 0, 0, wmm, hmm);
    pdf.save(`Payslip ${detail?.emp.name ?? ""} ${detail?.payslipNo ?? ""}`.trim() + ".pdf");
  }

  return (
    <>
      {trigger
        ? trigger(reopen)
        : <button onClick={reopen} className="rounded-lg px-2 py-1 text-xs font-medium ring-1 ring-inset ring-border hover:bg-stone-100">Slip</button>}

      <Modal open={open} onClose={() => setOpen(false)} title="Employee Payslip" description={detail?.payslipNo} size="lg"
        footer={
          <div className="flex justify-end gap-2">
            <button onClick={() => setOpen(false)} className="rounded-lg border border-border bg-surface px-4 py-2 text-sm font-medium hover:bg-stone-100">Close</button>
            <button onClick={downloadPdf} disabled={!detail} className="rounded-lg border border-primary bg-surface px-4 py-2 text-sm font-medium text-primary hover:bg-primary/5 disabled:opacity-50">Download PDF</button>
            <button onClick={print} disabled={!detail || printing} className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-60">{printing ? "Printing…" : "Print"}</button>
          </div>
        }>
        <div className="flex justify-center overflow-auto rounded-lg border border-border bg-stone-100 p-3 max-h-[74vh]">
          {pending || !detail ? (
            <p className="py-16 text-sm text-muted">Loading payslip…</p>
          ) : (
            <div ref={previewRef} className="m-0 h-fit bg-white px-5 py-4 text-black shadow-md ring-1 ring-stone-300" style={{ fontFamily: "'Courier New', monospace", fontSize: "14px", lineHeight: 1.4, width: "max-content" }}>
              {model.map((ln, i) => (
                <div key={i} style={{ whiteSpace: "pre", textAlign: ln.center ? "center" : "left", fontWeight: ln.bold ? 700 : 400 }}>{ln.t || " "}</div>
              ))}
            </div>
          )}
        </div>
      </Modal>
    </>
  );
}
