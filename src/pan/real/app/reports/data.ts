import { createServerSupabase } from "@/lib/supabase/server";

// ── PERFORMANCE RANKINGS (Reports & Analytics) ────────────────────────────────
// Server-side aggregation ng leaderboards mula sa TOTOONG records:
//   Drivers/Teams   ← deliveries (delivered runs, COD collected)
//   Installers      ← installations (completed installs, item_installers)
//   Carpentry/Uphol ← qc_declarations (approved jobs per worker section + pay)
//   Sales           ← orders (revenue + count per assigned rep)
//   QC Inspectors   ← warehouse_qc (inspections + defects caught)
//   Coordinators    ← deliveries.coordinator (booked/delivered runs)
//   Workshops       ← workshop_job (output volume + rework share)
// Lahat ng period windows (7d/30d/QTR/YTD) ay kinokompute nang sabay-sabay para
// instant ang period toggle sa client (walang refetch).

export type RankChipTone = "up" | "flat" | "down";
export type RankRow = {
  name: string;
  sub: string | null;       // context line (team / workshop / channel)
  display: string;          // formatted metric ("38", "₱312,400", "52 jobs")
  share: number;            // 0–100 vs the card's #1 (progress track)
  chip: { label: string; tone: RankChipTone } | null;
};
export type RankCard = {
  key: string;
  icon: string;             // 2-letter chip (DR / IN / CA / UP / SA / QC / CO / WS / TM)
  title: string;
  hint: string;
  metric: string;
  rows: RankRow[];
  foot: string;
};
export type PodiumSpot = { name: string; sub: string; pts: number };
// Overview KPI band ng period — kabuuang bilang sa likod ng mga leaderboard.
export type RankSummary = {
  runs: number; cod: number; installs: number; output: number;
  inspections: number; defects: number; revenue: number; orders: number;
};
export type RankPeriod = { cards: RankCard[]; podium: PodiumSpot[]; summary: RankSummary };
export type PeriodKey = "7d" | "30d" | "qtr" | "ytd";
export type RankingsData = { periods: Record<PeriodKey, RankPeriod> };

const peso = (n: number) => `₱${Math.round(n).toLocaleString("en-PH")}`;
const canon = (s: string) => s.trim().replace(/\s+/g, " ");

type Agg = { count: number; amount: number; extra: number; sub: string | null };
function bump(m: Map<string, Agg>, key: string, sub: string | null, amount = 0, extra = 0) {
  const k = canon(key);
  if (!k) return;
  const e = m.get(k) ?? { count: 0, amount: 0, extra: 0, sub };
  e.count += 1; e.amount += amount; e.extra += extra;
  if (!e.sub && sub) e.sub = sub;
  m.set(k, e);
}

function toRows(
  m: Map<string, Agg>,
  displayOf: (a: Agg) => string,
  chipOf: (a: Agg) => { label: string; tone: RankChipTone } | null,
  by: (a: Agg) => number = (a) => a.count,
  limit = 5,
): RankRow[] {
  const sorted = [...m.entries()].sort((x, y) => by(y[1]) - by(x[1])).slice(0, limit);
  const top = sorted.length ? by(sorted[0][1]) : 0;
  return sorted.map(([name, a]) => ({
    name, sub: a.sub, display: displayOf(a),
    share: top > 0 ? Math.max(4, Math.round((by(a) / top) * 100)) : 0,
    chip: chipOf(a),
  }));
}

export async function loadRankings(): Promise<RankingsData> {
  const db = createServerSupabase();
  const [{ data: dels }, { data: orders }, { data: insts }, { data: decls }, { data: wqc }, { data: wjobs }, { data: wsRows }, { data: teams }] = await Promise.all([
    db.from("deliveries").select("order_id, status, delivered_at, schedule_date, driver_team, coordinator, payment_collected, items_summary").limit(10000),
    db.from("orders").select('id, status, date_order, assigned, full_payment_price, dq_driver, dq_team, "Source"').limit(10000),
    db.from("installations").select("order_id, status, install_date, completed_at, item_installers, installer_team").limit(10000),
    db.from("qc_declarations").select("declared_at, status, category, workers, workshop").limit(10000),
    db.from("warehouse_qc").select("created_at, checked_by, defect_qty, checkpoint").limit(10000),
    db.from("workshop_job").select("workshop_id, dispatched_at, item_desc").limit(10000),
    db.from("workshop").select("id, name").limit(1000),
    db.from("delivery_teams").select("name, driver").limit(50),
  ]);

  const wsName = new Map<number, string>();
  for (const w of (wsRows ?? []) as { id: number; name: string | null }[]) wsName.set(w.id, w.name ?? `Workshop #${w.id}`);
  const teamDriver = new Map<string, string | null>();
  for (const t of (teams ?? []) as { name: string | null; driver: string | null }[]) if (t.name) teamDriver.set(t.name, t.driver ?? null);
  const orderById = new Map<number, { assigned: string | null; dq_driver: string | null; dq_team: string | null }>();
  for (const o of (orders ?? []) as { id: number; assigned: string | null; dq_driver?: string | null; dq_team?: string | null }[]) {
    orderById.set(o.id, { assigned: o.assigned ?? null, dq_driver: (o.dq_driver as string | null) ?? null, dq_team: (o.dq_team as string | null) ?? null });
  }

  const DAY = 86_400_000;
  const now = Date.now();
  const ytdDays = Math.max(1, Math.round((now - new Date(new Date().getFullYear(), 0, 1).getTime()) / DAY) + 1);
  const windows: [PeriodKey, number][] = [["7d", 7], ["30d", 30], ["qtr", 90], ["ytd", ytdDays]];
  const inWin = (iso: string | null | undefined, days: number) => {
    if (!iso) return false;
    const t = new Date(iso).getTime();
    return Number.isFinite(t) && now - t <= days * DAY;
  };

  const periods = {} as Record<PeriodKey, RankPeriod>;
  for (const [key, days] of windows) {
    const drivers = new Map<string, Agg>();
    const teamsAgg = new Map<string, Agg>();
    const coords = new Map<string, Agg>();
    const installers = new Map<string, Agg>();
    const carpentry = new Map<string, Agg>();
    const upholstery = new Map<string, Agg>();
    const sales = new Map<string, Agg>();
    const qc = new Map<string, Agg>();
    const workshops = new Map<string, Agg>();

    // Deliveries → drivers / teams / coordinators (delivered runs lang; hindi
    // kasama ang pickup-for-rework legs).
    let fleetRuns = 0, fleetCod = 0;
    for (const d of (dels ?? []) as { order_id: number | null; status: string | null; delivered_at: string | null; schedule_date: string | null; driver_team: string | null; coordinator: string | null; payment_collected: number | null; items_summary: string | null }[]) {
      if (/pickup for rework/i.test(d.items_summary ?? "")) continue;
      const delivered = /delivered/i.test(d.status ?? "") || !!d.delivered_at;
      const when = d.delivered_at ?? d.schedule_date;
      if (!delivered || !inWin(when, days)) continue;
      const o = d.order_id != null ? orderById.get(d.order_id) : undefined;
      // Ang deliveries.driver_team ay minsan TEAM ("Team A"), minsan DRIVER NAME
      // (mga lumang record) — ihiwalay: team pattern → team; iba → driver name.
      const rawDt = d.driver_team ?? null;
      const dtIsTeam = !!rawDt && /^(team|reserve)\b/i.test(rawDt);
      const team = (dtIsTeam ? rawDt : null) ?? o?.dq_team ?? null;
      const driver = o?.dq_driver ?? (!dtIsTeam ? rawDt : null) ?? (team ? teamDriver.get(team) ?? null : null);
      const cod = Number(d.payment_collected) || 0;
      fleetRuns += 1; fleetCod += cod;
      if (driver) bump(drivers, driver, team, cod);
      if (team) bump(teamsAgg, team, teamDriver.get(team) ? `Driver: ${teamDriver.get(team)}` : null, cod);
      if (d.coordinator) bump(coords, d.coordinator, "Delivery Coordinator", cod);
    }

    // Installations → installers (completed installs; item_installers names).
    let installTotal = 0;
    for (const i of (insts ?? []) as { status: string | null; install_date: string | null; completed_at: string | null; item_installers: unknown; installer_team: string | null }[]) {
      if (!/completed|delivered/i.test(i.status ?? "")) continue;
      if (!inWin(i.completed_at ?? i.install_date, days)) continue;
      const names = new Set<string>();
      if (Array.isArray(i.item_installers)) for (const g of i.item_installers as unknown[]) if (Array.isArray(g)) for (const n of g) if (typeof n === "string" && n.trim()) names.add(canon(n));
      if (i.installer_team && !/^team\s/i.test(i.installer_team)) names.add(canon(i.installer_team));
      if (!names.size) continue;
      installTotal += 1;
      for (const n of names) bump(installers, n, "Installation");
    }

    // QC declarations → carpentry / upholstery workers (approved jobs + pay).
    for (const d of (decls ?? []) as { declared_at: string | null; status: string | null; category: string | null; workers: unknown; workshop: string | null }[]) {
      if (!/approved/i.test(d.status ?? "")) continue;
      if (!inWin(d.declared_at, days)) continue;
      const workers = Array.isArray(d.workers) ? (d.workers as { name?: unknown; amount?: unknown; section?: unknown }[]) : [];
      for (const w of workers) {
        const name = typeof w.name === "string" ? w.name : "";
        if (!name.trim()) continue;
        const section = `${typeof w.section === "string" ? w.section : ""} ${d.category ?? ""}`;
        const amount = Number(w.amount) || 0;
        const sub = d.workshop ?? null;
        if (/carpentry/i.test(section)) bump(carpentry, name, sub, amount);
        else if (/upholstery/i.test(section)) bump(upholstery, name, sub, amount);
      }
    }

    // Orders → sales reps (revenue + orders closed).
    let teamRevenue = 0, teamOrders = 0;
    for (const o of (orders ?? []) as { status: string | null; date_order: string | null; assigned: string | null; full_payment_price: number | null; Source: string | null }[]) {
      if (/pending|cancel|draft/i.test(o.status ?? "")) continue;
      if (!inWin(o.date_order, days)) continue;
      const rev = Number(o.full_payment_price) || 0;
      teamRevenue += rev; teamOrders += 1;
      if (o.assigned) bump(sales, o.assigned, o.Source ? `Channel: ${o.Source}` : null, rev);
    }

    // Warehouse QC → inspectors (inspections + defects caught).
    let inspTotal = 0, defectsTotal = 0;
    for (const q of (wqc ?? []) as { created_at: string | null; checked_by: string | null; defect_qty: number | null; checkpoint: string | null }[]) {
      if (!inWin(q.created_at, days)) continue;
      const def = Number(q.defect_qty) || 0;
      inspTotal += 1; defectsTotal += def;
      if (q.checked_by) bump(qc, q.checked_by, q.checkpoint === "prepack" ? "QC for OUT" : "Receiving QC", 0, def);
    }

    // Workshop jobs → workshops (output volume + rework share).
    let outputTotal = 0;
    for (const j of (wjobs ?? []) as { workshop_id: number | null; dispatched_at: string | null; item_desc: string | null }[]) {
      if (!inWin(j.dispatched_at, days)) continue;
      if (j.workshop_id == null) continue;
      outputTotal += 1;
      bump(workshops, wsName.get(j.workshop_id) ?? `Workshop #${j.workshop_id}`, null, 0, /^rework/i.test(j.item_desc ?? "") ? 1 : 0);
    }

    const cards: RankCard[] = [
      {
        key: "drivers", icon: "DR", title: "Top Drivers", hint: "Delivered runs · COD collected", metric: "Runs",
        rows: toRows(drivers, (a) => String(a.count), (a) => ({ label: `${peso(a.amount)} COD`, tone: "up" })),
        foot: `Fleet total ${fleetRuns} run${fleetRuns === 1 ? "" : "s"} · COD ${peso(fleetCod)}`,
      },
      {
        key: "installers", icon: "IN", title: "Top Installers", hint: "Completed installs", metric: "Installs",
        rows: toRows(installers, (a) => String(a.count), () => null),
        foot: `Total installs ${installTotal}`,
      },
      {
        key: "carpentry", icon: "CA", title: "Top Carpentry", hint: "Approved jobs · project pay", metric: "Jobs",
        rows: toRows(carpentry, (a) => String(a.count), (a) => (a.amount > 0 ? { label: `${peso(a.amount)} earned`, tone: "up" } : null)),
        foot: `Section jobs ${[...carpentry.values()].reduce((s, a) => s + a.count, 0)}`,
      },
      {
        key: "upholstery", icon: "UP", title: "Top Upholstery", hint: "Approved jobs · project pay", metric: "Jobs",
        rows: toRows(upholstery, (a) => String(a.count), (a) => (a.amount > 0 ? { label: `${peso(a.amount)} earned`, tone: "up" } : null)),
        foot: `Section jobs ${[...upholstery.values()].reduce((s, a) => s + a.count, 0)}`,
      },
      {
        key: "sales", icon: "SA", title: "Top Sales", hint: "Revenue · orders closed", metric: "Revenue",
        rows: toRows(sales, (a) => peso(a.amount), (a) => ({ label: `${a.count} order${a.count === 1 ? "" : "s"}`, tone: "up" }), (a) => a.amount),
        foot: `Team revenue ${peso(teamRevenue)} · ${teamOrders} orders`,
      },
      {
        key: "qc", icon: "QC", title: "Top QC Inspectors", hint: "Inspections done · defects caught", metric: "Inspections",
        rows: toRows(qc, (a) => String(a.count), (a) => ({ label: `${a.extra} defect${a.extra === 1 ? "" : "s"} caught`, tone: a.extra > 0 ? "up" : "flat" })),
        foot: `Total inspections ${inspTotal} · defects intercepted ${defectsTotal}`,
      },
      {
        key: "coordinators", icon: "CO", title: "Top Coordinators", hint: "Coordinated runs · COD covered", metric: "Runs",
        rows: toRows(coords, (a) => String(a.count), (a) => (a.amount > 0 ? { label: `${peso(a.amount)} COD`, tone: "up" } : null)),
        foot: `Coordinated deliveries ${[...coords.values()].reduce((s, a) => s + a.count, 0)}`,
      },
      {
        key: "workshops", icon: "WS", title: "Top Workshops", hint: "Output volume · rework share", metric: "Output",
        rows: toRows(workshops, (a) => `${a.count} job${a.count === 1 ? "" : "s"}`, (a) => {
          const pct = a.count > 0 ? Math.round((a.extra / a.count) * 100) : 0;
          return { label: `${pct}% rework`, tone: pct <= 5 ? "up" : pct <= 10 ? "flat" : "down" };
        }),
        foot: `Network output ${outputTotal} job${outputTotal === 1 ? "" : "s"}`,
      },
      {
        key: "teams", icon: "TM", title: "Top Delivery Teams", hint: "Delivered stops · COD collected", metric: "Stops",
        rows: toRows(teamsAgg, (a) => String(a.count), (a) => ({ label: `${peso(a.amount)} COD`, tone: "up" })),
        foot: `Fleet stops ${fleetRuns} · COD collected ${peso(fleetCod)}`,
      },
    ];

    // Podium: pinaka-productive sa bawat people category (share ng kabuuang
    // output ng kanyang category ang puntos), top 3 sa lahat.
    const podium: PodiumSpot[] = [];
    const podiumSrc: [Map<string, Agg>, string][] = [
      [drivers, "Driver"], [installers, "Installer"], [carpentry, "Carpentry"],
      [upholstery, "Upholstery"], [sales, "Sales"], [qc, "QC Inspector"], [coords, "Coordinator"],
    ];
    for (const [m, role] of podiumSrc) {
      const total = [...m.values()].reduce((s, a) => s + a.count, 0);
      const top = [...m.entries()].sort((x, y) => y[1].count - x[1].count)[0];
      if (!top || total <= 0) continue;
      podium.push({ name: top[0], sub: top[1].sub ? `${role} · ${top[1].sub}` : role, pts: Math.round((top[1].count / total) * 1000) / 10 });
    }
    podium.sort((a, b) => b.pts - a.pts);
    periods[key] = {
      cards, podium: podium.slice(0, 3),
      summary: {
        runs: fleetRuns, cod: fleetCod, installs: installTotal, output: outputTotal,
        inspections: inspTotal, defects: defectsTotal, revenue: teamRevenue, orders: teamOrders,
      },
    };
  }

  return { periods };
}
