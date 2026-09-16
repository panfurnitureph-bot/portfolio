"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { createBrowserSupabase, realtimeReady } from "@/lib/supabase/client";

// Listens to EVERY change in the public schema and re-fetches server components
// so all signed-in users see live data without refreshing. Debounced so a burst
// of writes triggers a single refresh.
//
// Requires (run once in Supabase) — broadcast all tables:
//   drop publication if exists supabase_realtime;
//   create publication supabase_realtime for all tables;
// Debounce window for a single burst, and a hard ceiling so a continuous
// stream of writes still refreshes ~every MAX_WAIT instead of starving.
// Kept short so a change feels instant on every open tab (150ms is below the
// ~200ms eye-perception threshold) while still collapsing a write burst into a
// single refresh. The MAX_WAIT ceiling prevents starvation under a steady stream.
// 400ms feels instant to a human but collapses a burst of writes (and any DB churn
// from other users) into ONE full server re-render instead of many — each refresh
// re-runs the layout (session + badge counts) and the page loader, so over-eager
// refreshing was an amplifier for the heavy-loader cost. The MAX_WAIT ceiling still
// guarantees a refresh within ~2s under a steady write stream.
// HOSTINGER NA TAYO (2026-08-30, utos ni Joe): ang 400/2000/8000 ay presyo ng
// Vercel — bawat render ay singil doon, kaya pinipigil. Sa sariling VPS, CPU na
// lang ang hangganan. Ibinaba sa 150/1000/2000: ang 150ms ay mas mababa sa
// bantas ng mata, at ang 2s na gap ang natitirang sahig — hindi zero, dahil
// ang bawat refresh ay BUONG server render pa rin, at ang sampung device sa
// isang sunod-sunod na sulat ay kayang lunurin ang VPS kung walang preno.
// HULING PIHIT (2026-08-30): 100ms debounce, 1s gap. Ito na ang sahig ng mga
// knob — ang natitirang oras ay ang kampana ng Supabase (~0.3-1s) at ang
// render sa SG→Tokyo (~1s), na arkitektura na, hindi setting. Ang 1s na gap
// sa 4-core na VPS na may route-aware filtering ay ligtas pa; sa ilalim nito,
// ang sunod-sunod na sulat sa maraming bukas na device ay banta na sa CPU.
const DEBOUNCE_MS = 100;
const MAX_WAIT_MS = 800;
// 3s, hindi 1s (2026-08-31): sa masiglang paggamit, ang 1s na gap ay
// nangangahulugang bawat bukas na tab sa bawat device ay nagre-render bawat
// segundo — nagsiksikan ang server at ang micro na DB, at ang BUONG app ay
// bumagal sa kamay ng gumagamit. Ang unang update ay mabilis pa rin (100ms
// debounce); ang gap ay pumipigil lang sa sunod-sunod.
// BALIK SA 1s (2026-09-05, Joe: "dapat katulad nung dati instant sa lahat ng
// tab"): ang 3s na gap ay ipinasok noong 8/31 dahil bumabagal ang server sa
// masiglang oras — pero ang tunay na pabigat noon ay ang CDN (sirang edge na
// nagre-reset at nag-405) na OFF na ngayon; ang server render ay 0.05–1s.
// Sinukat: bell 0.7s + render ~0.5s = ~1.3s ang unang update; ang gap ay para
// lang sa magkakasunod na sulat. 1s = mararamdamang instant, may preno pa rin.
// 2s (2026-09-06, "parang nagre-refresh ang app"): sinukat sa Activity Logs —
// ang isang Save ng order ay 4–7 na sulat (orders, payments, approvals,
// inventory, best sellers) sa loob ng ilang segundo; sa 1s na gap ay hanggang
// 7 refresh ang isang pagbabago. Instant pa rin ang UNANG refresh (100ms
// debounce); ang gap lang ang pumipigil sa magkakasunod.
const MIN_GAP_MS = 2_000;

// ── ROUTE-AWARE FILTER ───────────────────────────────────────────────────────
// Dating bawat pagbabago sa KAHIT ANONG table ay nagre-refresh sa BAWAT bukas
// na page — sa 10 device na bukas buong araw, bawat write ay ×10 na Vercel
// render. Ngayon: nagre-refresh lang kung ang nagbagong table ay may kinalaman
// sa page na nakabukas. Ang hindi kilalang table → refresh pa rin (ligtas).
const TABLE_ROUTES: Record<string, string[]> = {
  // Ang /initial-sales ay PAREHONG listahan ng /orders (iisang component) —
  // nakalimutan sa mapa, kaya ang bagong order ay hindi lumilitaw doon nang
  // live: ang ORD-000003 ay hindi nakita agad sa APK (2026-08-30). Ang
  // pahinang wala sa mapa ng table na binabasa nito ay TAHIMIK na patay.
  orders: ["/orders", "/initial-sales", "/dashboard", "/operations", "/delivery", "/installation", "/rework", "/returns", "/customers", "/reports", "/pay", "/pickup", "/warranty", "/hr/overall"],
  deliveries: ["/delivery", "/operations", "/dashboard", "/installation", "/initial-sales", "/pickup", "/reports"],
  installations: ["/installation", "/reports", "/operations", "/dashboard"],
  // Kasama ang /workshop: ang Rework Jobs ng bawat workshop (/workshop/rework)
  // ay nagbabasa ng returns — wala ito sa mapa noon, kaya ang bagong rework
  // ay hindi lumilitaw doon nang live (sweep 2026-08-30).
  // Kasama ang /payment-approval (2026-09-01): ang Refunds tab ay nagbabasa ng
  // returns — ang bagong TO PAY (RMA approve sa ibang device) at ang pag-mark
  // na REFUNDED ay dapat lumitaw nang live. Kasama rin ang /hr/overall: ang
  // Rework Payment na income ng PAN Overall ay galing returns.rework_downpayment.
  returns: ["/returns", "/operations", "/rework", "/workshop", "/dashboard", "/pickup", "/reports", "/installation", "/payment-approval", "/hr/overall"],
  // APROBAHAN NG BAYAD (2026-08-27): ang installer/Ops ay naghihintay ng
  // "Approved" — 60s na poll lang ang nagsasabi noon, kaya minuto ang tagal
  // bago maging Paid ang naaprubahan na. Ang bell ay agad.
  payment_approvals: ["/payment-approval", "/installation", "/returns", "/orders", "/operations", "/rework", "/dashboard"],
  // Kasama ang /quality-control: kapag nag-declare ang workshop ng tapos, ang
  // SUSUNOD NA HAKBANG ay ang Workshop (IN) queue ng bodega — wala ito sa mapa
  // noon, kaya hindi lumilitaw ang bagong deklarasyon doon nang live (handoff
  // sweep 2026-08-30).
  // Kasama ang /pickup (2026-08-31, "hindi real time ung changes sa mobile
  // apk"): ang Pickup Task ay nagbabasa ng qc_declarations (workshop stops,
  // claim, pickup_at) — wala ito sa mapa noon, kaya ang bawat galaw sa ibang
  // device ay hindi lumilitaw sa /pickup-task nang live.
  qc_declarations: ["/workshop", "/quality-control", "/hr/projects", "/hr/payroll", "/reports", "/pickup"],
  // Tahasang mapa ang workshop_job (dating nahuhulog sa startsWith("workshop")
  // na walang /pickup at /quality-control): ang Pickup Task ang nagbabasa ng
  // fulfillment/transfer_* ng haul, at ang Warehouse QC · Workshop (IN) ay
  // nakagate sa transfer_dropped_at.
  workshop_job: ["/workshop", "/operations", "/reports", "/pickup", "/quality-control"],
  warehouse_qc: ["/quality-control", "/incoming", "/inventory", "/reports", "/stock-movements"],
  inventory: ["/inventory", "/locations", "/stock-movements", "/dashboard"],
  product: ["/inventory", "/locations", "/products", "/costing", "/orders", "/dashboard"],
  purchase_orders: ["/purchase-orders", "/incoming", "/operations", "/suppliers"],
  purchase_order_items: ["/purchase-orders", "/incoming"],
  incoming_shipments: ["/incoming", "/purchase-orders"],
  suppliers: ["/suppliers", "/purchase-orders"],
  mattress_orders: ["/mattress-orders", "/hr/overall", "/dashboard"],
  order_edit_requests: ["/operations", "/orders"],
  delivery_teams: ["/operations", "/delivery", "/pickup", "/installation"],
  employees: ["/hr", "/users", "/workshop", "/operations", "/returns"],
  profiles: ["/users", "/hr/directory"],
  customers: ["/customers", "/orders"],
  materials: ["/operations"],
  // Mga bagong pinged tables (0202) — nakamapa para hindi buong-app refresh.
  ops_line_skip: ["/operations", "/quality-control"],
  stock_placements: ["/locations", "/inventory"],
  // Kasama ang /locations at /quality-control (2026-09-01): ang cubic modal at
  // ang bawat QC inspection ay may Design Details card na — ang bagong sheet o
  // approval ay dapat dumating nang live sa dalawa.
  design_details: ["/design-details", "/orders", "/workshop", "/locations", "/quality-control"],
  quotations: ["/quotation", "/orders", "/mto"],
  order_line_deliveries: ["/operations", "/delivery", "/orders"],
  stock_request: ["/operations", "/workshop"],
  app_settings: [], // settings churn — walang page na live na umaasa dito
  // KAMPANA SA LAHAT (0214, 2026-08-30): bawat operational table ay may
  // sync_ping trigger na. Ang mga mapa rito ay nagpapaliit lang ng saklaw ng
  // refresh — ang wala sa mapa ay ligtas na buong-refresh pa rin.
  // Kasama ang /payment-approval (2026-09-01): ang Refunds tab ay nagpapakita
  // ng account ng payout at ang MOP dropdown ay mula sa pan_accounts.
  pan_accounts: ["/hr/overall", "/payment-approval"],
  pan_transactions: ["/hr/overall", "/payment-approval"],
  mto_requests: ["/mto-requests", "/orders", "/operations"],
  addons: ["/addons", "/orders", "/products"],
  categories: ["/products", "/inventory"],
  products: ["/products", "/orders", "/inventory", "/website"],
  warehouse_locations: ["/locations", "/inventory"],
  website_item_config: ["/website"],
  warranty_documents: ["/warranty", "/orders"],
};
// (fb_* tables: tingnan ang IGNORE sa ibaba — bot churn, hindi refresh trigger.)
// Ang sync_ping ay may tag kung ANO ang nagbago (attendance/leave/advance) —
// ito ang kampana ng mga RLS-sarado na hr_* tables.
const PING_ROUTES: Record<string, string[]> = {
  attendance: ["/hr/attendance", "/hr/reports", "/hr/payroll", "/hr/wfh", "/dashboard"],
  leave: ["/hr/leaves", "/hr/reports"],
  advance: ["/hr/advances", "/hr/payroll", "/hr/reports"],
};

function routesFor(table: string, tag?: string): string[] | null {
  // ANG PING NA ANG PANGUNAHING DAAN (0202): ang RLS-gated na operational
  // tables ay hindi umaabot sa authenticated realtime (napatunayan 2026-08-27),
  // kaya DB trigger ang nagpapatunog ng sync_ping na may pangalan ng table.
  // Ang tag na table-name ay dumadaan sa PAREHONG route map; ang HR tags
  // (attendance/leave/advance) ay nananatili; ang hindi kilala ay ligtas na
  // buong-refresh.
  if (table === "sync_ping") {
    if (tag && PING_ROUTES[tag]) return PING_ROUTES[tag];
    if (tag && tag in TABLE_ROUTES) return TABLE_ROUTES[tag];
    // web_* (web_content, web_swatches…): Website tab lang ang nagbabasa —
    // dati null (refresh sa LAHAT ng page) tuwing nagre-recompute ang best
    // sellers sa bawat galaw ng order.
    if (tag?.startsWith("web")) return ["/website"];
    if (tag?.startsWith("hr_")) return ["/hr", "/attendance"];
    if (tag?.startsWith("workshop")) return ["/workshop", "/operations", "/reports"];
    if (tag) return null; // kilalang may nagbago pero walang mapa — refresh
    return ["/hr"];
  }
  if (table in TABLE_ROUTES) return TABLE_ROUTES[table];
  if (table.startsWith("hr_")) return ["/hr", "/attendance"];
  if (table.startsWith("workshop")) return ["/workshop", "/operations", "/reports"];
  if (table.startsWith("web_")) return ["/website"];
  return null; // hindi kilala → ligtas na fallback: refresh
}

function isRelevant(table: string, tag: string | undefined, pathname: string): boolean {
  const routes = routesFor(table, tag);
  if (routes === null) return true;
  return routes.some((r) => pathname === r || pathname.startsWith(r));
}

export function RealtimeRefresher() {
  const router = useRouter();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const firstPending = useRef(0);
  const dirtyWhileHidden = useRef(false);
  const hadConnected = useRef(false);
  const downSince = useRef(0); // kailan huling namatay ang channel (0 = buhay)

  useEffect(() => {
    const sb = createBrowserSupabase();
    // Don't refresh on high-churn / noise tables:
    //  - audit_log: every action writes one (self-induced refresh storm)
    //  - emails: n8n backfill/inbound inserts thousands -> would refresh nonstop
    //    and make the whole UI (incl. sidebar) feel unclickable. /gmail has its
    //    own Refresh button instead.
    //  - rate_limits: churns on every request, never drives visible UI.
    //  - received_parts: high-volume movement log with its own page (/inventory,
    //    /scan) — a global refresh isn't needed for it.
    //  - *_log tables (e.g. workshop_stock_log): movement/audit logs that have
    //    their own pages and shouldn't trigger a full-page refresh everywhere.
    //  - fb_*: Messenger bot churn (webhook + n8n sumusulat sa fb_conversations/
    //    fb_messages/fb_contacts sa BAWAT customer message, ~15 events/45s sa
    //    sukat noong 8/7) — dating naka-map sa /orders kaya nagre-refresh ang
    //    Orders bawat 8s buong araw at halos hindi magamit. Walang page na
    //    live na nagbabasa ng fb_*; may sariling Sync button ang /orders.
    //  - traffic_samples: GPS churn ng bawat bumibiyaheng driver (0215) —
    //    pansiguro rito rin, kung sakaling may kampana pa ito sa DB.
    const IGNORE = new Set(["audit_log", "otp_codes", "emails", "rate_limits", "received_parts", "traffic_samples"]);
    const isIgnored = (table: string) => IGNORE.has(table) || table.endsWith("_log") || table.startsWith("fb_");

    let lastFire = 0;
    // Huling TUNAY na galaw ng kamay (tap/type/touch — hindi mousemove):
    // habang ito ay sariwa, ang refresh ay nagpapaumanhin nang isang saglit.
    let lastAct = 0;
    // BANTAY SA REFRESH STORM (2026-09-05, "load ng load sa /dashboard"): kapag
    // ≥8 refresh sa loob ng isang minuto, itala sa Activity Logs (module
    // "client", kind "refresh-storm") kung ANO ang nag-trigger — mga bell tag
    // (table) at pinagmulan (bell/focus/net) — isang report kada 5 minuto.
    const fireLog: { t: number; why: string }[] = [];
    let lastStormReport = 0;
    const noteFire = (why: string) => {
      const now = Date.now();
      fireLog.push({ t: now, why });
      while (fireLog.length && now - fireLog[0].t > 60_000) fireLog.shift();
      if (fireLog.length >= 8 && now - lastStormReport > 5 * 60_000) {
        lastStormReport = now;
        const counts: Record<string, number> = {};
        for (const f of fireLog) counts[f.why] = (counts[f.why] ?? 0) + 1;
        void fetch("/api/client-log", {
          method: "POST", headers: { "content-type": "application/json" }, keepalive: true,
          body: JSON.stringify({ kind: "refresh-storm", reason: JSON.stringify(counts).slice(0, 300), count: fireLog.length, href: location.href, ua: navigator.userAgent }),
        }).catch(() => { /* offline */ });
      }
    };
    let pendingWhy = "bell";
    const fire = () => {
      // Tinatawag na rin ito nang DIREKTA (focus/reconnect/idle net) — linisin
      // ang anumang pending debounce timeout para hindi mag-ipon ng dobleng
      // refresh. No-op kung galing mismo sa timeout na iyon.
      if (timer.current) clearTimeout(timer.current);
      timer.current = null;
      firstPending.current = 0;
      // HUWAG i-refresh ang Face Kiosk: self-contained ito (camera + face data
      // sa memory). Ang router.refresh dito — na tine-trigger pa mismo ng sarili
      // nitong sync_ping pagkatapos mag-submit — ay nagre-reload ng mabigat na
      // face payload habang bukas ang camera at nagpapa-white-screen sa tablet.
      if (typeof window !== "undefined" && window.location.pathname.startsWith("/attendance/kiosk")) return;
      // HABANG PUMIPINDOT ANG TAO (2026-08-31): ang router.refresh ay muling
      // pagguhit ng buong pahina — sa mahinang WebView ng APK, ang tap na
      // sumabay sa render ay hindi pumapasok ("di agad mapindot ang sidebar").
      // Kapag may tap/type sa nakaraang ~900ms, isantabi muna ang refresh at
      // subukan ulit — trailing, hindi nawawala. Ang mousemove ay HINDI
      // binibilang: sa desktop, ang gumagalaw na mouse ay hindi dapat
      // gumugutom sa live updates.
      if (Date.now() - lastAct < 900) {
        timer.current = setTimeout(fire, 900);
        return;
      }
      // MIN-GAP: kung kaka-refresh lang, itulak ang susunod sa dulo ng gap
      // (trailing) — hindi nawawala ang update, nababawasan lang ang renders.
      const now = Date.now();
      const since = now - lastFire;
      if (since < MIN_GAP_MS) {
        timer.current = setTimeout(fire, MIN_GAP_MS - since);
        return;
      }
      lastFire = now;
      // Para sa badge poll ng AppShell: huwag nang dumoble kung kaka-refresh
      // lang ng bell.
      (window as unknown as { __pan_last_refresh?: number }).__pan_last_refresh = now;
      noteFire(pendingWhy);
      pendingWhy = "bell";
      router.refresh();
    };

    // MULING PAGKABIT KAPAG NAMATAY ANG CHANNEL (2026-08-30, para sa APK).
    // Ang "SUBSCRIBED" lang ang hinahawakan noon: kapag ang pag-join ay
    // nag-CHANNEL_ERROR / TIMED_OUT / CLOSED — lipas na token pagkagising ng
    // Android, mahinang signal sa biyahe — ang channel ay PATAY na habambuhay
    // at ang tanging gumagalaw ay ang 3-min safety net: ang mismong "kailangan
    // i-reopen ang app" na reklamo. Buwagin at itayo muli, may backoff na
    // 5s→60s para ang tuluyang pagkawala ng net ay hindi maging retry storm.
    let channel: ReturnType<typeof sb.channel> | null = null;
    let rejoin: ReturnType<typeof setTimeout> | null = null;
    let attempts = 0;
    let disposed = false;
    let joined = false; // huling alam na kalagayan ng channel
    const connect = () => {
      if (disposed) return;
      // TOKEN MUNA BAGO SUBSCRIBE (2026-09-05): anon ang join kapag nauna ang
      // subscribe sa setAuth, at wala nang darating na event pagkatapos.
      void realtimeReady().then(() => {
      if (disposed) return;
      if (channel) { void sb.removeChannel(channel); channel = null; }
      channel = sb
      .channel("public:all")
      .on(
        "postgres_changes",
        { event: "*", schema: "public" },
        (payload) => {
          if (isIgnored(payload.table)) return;
          // Route-aware: laktawan kung walang kinalaman sa bukas na page.
          const tag = (payload.new as { tag?: string } | null)?.tag;
          if (typeof window !== "undefined" && !isRelevant(payload.table, tag, window.location.pathname)) return;
          // Background tab: DON'T drop the event — remember that something changed and
          // refresh the instant the tab is focused again. (Previously we skipped it
          // entirely, so a change made while this tab was in the background never
          // showed until a manual reload — exactly the "not instant on other tabs" bug.)
          if (typeof document !== "undefined" && document.visibilityState === "hidden") {
            dirtyWhileHidden.current = true;
            return;
          }

          const now = Date.now();
          pendingWhy = `bell:${tag ?? payload.table}`;
          if (!firstPending.current) firstPending.current = now;
          if (timer.current) clearTimeout(timer.current);
          // Normal: wait DEBOUNCE_MS after the last write. But never wait past
          // MAX_WAIT_MS from the first pending write (prevents starvation).
          const waited = now - firstPending.current;
          const delay = Math.max(0, Math.min(DEBOUNCE_MS, MAX_WAIT_MS - waited));
          timer.current = setTimeout(fire, delay);
        },
      )
      .subscribe((status) => {
        // RECONNECT REFETCH: ang mga events habang putol ang koneksyon (WiFi
        // drop, natulog na laptop) ay nawawala nang tuluyan. Sa bawat MULING
        // pag-subscribe (hindi ang una), mag-refresh minsan para mahabol ang
        // anumang nagbago habang patay ang linya. Dumadaan sa fire() para
        // igalang ang MIN_GAP — ang flapping na channel (token expiry, mahinang
        // net) ay hindi na nagiging refresh storm.
        if (status === "SUBSCRIBED") {
          joined = true;
          attempts = 0;
          // RECONNECT REFRESH LANG KUNG MATAGAL NA PUTOL (2026-09-05, "reload ng
          // reload sa dalawang PC"): ang instrumentation (refresh-storm =
          // {"reconnect":8}) ang naglabas nito — sa desktop/mahinang net, ang
          // Supabase channel ay FLAPPING: SUBSCRIBED → CLOSED → SUBSCRIBED kada
          // ilang segundo (token refresh, WebView throttle). Dating BAWAT muling
          // SUBSCRIBED ay nag-fi-fire ng buong router.refresh() → walang katapusang
          // refresh. Ngayon: mag-refresh LANG kung ang channel ay patay nang
          // ≥15s (baka may na-miss na sulat). Ang maikling flap ay walang
          // na-miss — wala nang refresh.
          const downFor = downSince.current ? Date.now() - downSince.current : 0;
          downSince.current = 0;
          if (hadConnected.current && downFor >= 15_000) { pendingWhy = "reconnect"; fire(); }
          hadConnected.current = true;
        } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
          joined = false;
          if (disposed) return;
          if (!downSince.current) downSince.current = Date.now();
          attempts += 1;
          // Cap na 3s (utos ni Joe, 2026-08-30; dating 60s→20s→10s→3s). Sa
          // mobile data ng APK, madalas mamatay ang socket — ang cap ang
          // pinakamahabang bulag na sandali. Ang pag-join ay magaan (isang
          // websocket message), kaya kayang ulitin bawat 3s; kapag TAGO ang
          // app, ang OS mismo ang nagpapabagal ng timer kaya hindi ito
          // umuubos ng baterya sa background. Ang `online`/`resume`/focus ay
          // kumakabit pa rin nang agaran nang hindi hinihintay ang timer.
          const wait = Math.min(2_000 * attempts, 3_000);
          if (rejoin) clearTimeout(rejoin);
          rejoin = setTimeout(connect, wait);
        }
      });
      });
    };
    connect();

    // When the tab comes back to the foreground, flush any change that arrived while
    // it was hidden — so switching to an already-open tab shows fresh data instantly.
    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      // PAGBUKAS NG APP (2026-08-30): kapag patay ang channel habang tago ang
      // app, WALANG event na nagtakda ng dirty flag — kaya dating walang
      // nangyayari sa pagbalik at naghihintay pa sa backoff/3-min net. Ngayon:
      // buhayin agad ang channel kung patay, at mag-refresh para mahabol ang
      // anumang lumipas habang bulag.
      if (!joined) {
        if (rejoin) clearTimeout(rejoin);
        connect();
        fire();
        return;
      }
      if (dirtyWhileHidden.current) {
        dirtyWhileHidden.current = false;
        fire();
      }
    };
    document.addEventListener("visibilitychange", onVisible);

    // SAFETY NET: kung ang realtime ay tahimik na bagsak (hal. RLS na humaharang
    // sa broadcast, naputol na socket), ang mga page ay tuluyang tumitigil sa
    // pagsariwa. Dagdag: (a) refresh sa PAGBALIK ng window focus, (b) marahang
    // 3-min na refresh habang kita ang tab at IDLE ang user (10s+ walang input)
    // — tahimik, hindi mararamdaman, pero hindi na mabibilaok ang app.
    let lastInput = Date.now();
    const noteInput = () => { lastInput = Date.now(); };
    const INPUT_EVENTS: (keyof WindowEventMap)[] = ["pointerdown", "keydown", "wheel", "touchstart", "mousemove"];
    INPUT_EVENTS.forEach((ev) => window.addEventListener(ev, noteInput, { passive: true }));
    const ACT_EVENTS: (keyof WindowEventMap)[] = ["pointerdown", "keydown", "touchstart"];
    const noteAct = () => { lastAct = Date.now(); };
    ACT_EVENTS.forEach((ev) => window.addEventListener(ev, noteAct, { passive: true }));
    // Lahat ng safety-net refresh ay dumadaan sa fire(): (a) MIN_GAP ang bantay
    // laban sa sunud-sunod na focus events (APK app-switch churn), (b) hindi na
    // rin tinatamaan ang /attendance/kiosk (dating lusot dito ang focus refresh).
    const onFocus = () => { if (document.visibilityState === "visible") { pendingWhy = "focus"; fire(); } };
    window.addEventListener("focus", onFocus);
    // BUMALIK ANG NET (APK sa mobile data): huwag hintayin ang socket backoff —
    // habulin agad ang nagbago habang putol, at itayo agad ang channel.
    const onOnline = () => { fire(); if (rejoin) clearTimeout(rejoin); connect(); };
    window.addEventListener("online", onOnline);
    // Capacitor/Cordova "resume" — dagdag na panghuli sa APK; sa browser ay
    // hindi ito tumutunog kailanman, kaya walang gastos.
    const onResume = () => fire();
    document.addEventListener("resume", onResume);
    const net = setInterval(() => {
      if (document.visibilityState === "hidden") return;
      if (Date.now() - lastInput < 10_000) return;
      const el = document.activeElement as HTMLElement | null;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable)) return;
      fire();
    }, 3 * 60_000);

    return () => {
      if (timer.current) clearTimeout(timer.current);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("online", onOnline);
      document.removeEventListener("resume", onResume);
      INPUT_EVENTS.forEach((ev) => window.removeEventListener(ev, noteInput));
      ACT_EVENTS.forEach((ev) => window.removeEventListener(ev, noteAct));
      clearInterval(net);
      disposed = true;
      if (rejoin) clearTimeout(rejoin);
      if (channel) void sb.removeChannel(channel);
    };
  }, [router]);

  return null;
}
