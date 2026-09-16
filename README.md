# workwithjm — Portfolio + the real Pan Furniture app as a live demo

Portfolio site for **Joe Marie Casela — Workflow & AI Automation Specialist**, with:

- an "Interactive demos" showcase — 17 live products, each opening full screen in an overlay, and
- **`/pan` — the actual Pan Furniture Warehouse IMS**, running in the browser: the production React components are copied verbatim from the `Pan-Furnitures` repo and run against an in-browser database with dummy data. Same login screen, same sidebar and roles, same pages and actions.

## Stack

- Vite 5 · React 19 · TypeScript · react-router-dom 6 · Tailwind CSS 4 (only for `/pan`)
- Portfolio pages: plain CSS tokens (`src/styles.css`), hand-rolled SVG charts
- `/pan`: verbatim copies of the production app under `src/pan/real/` + shims

## Run

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # type-check + production build → dist/
npm run preview    # serve dist/ on http://localhost:4173
```

## Routes

| Route | What |
| --- | --- |
| `/` | Portfolio home |
| `/work/pan-furniture` | Pan Furniture case study — live storefront embed, real screens, modules, order flow, architecture |
| `/pan` | **Pan Furniture Warehouse IMS (real UI, demo data).** Login with a demo account or "Quick sign in". |
| `/pan?device=tablet&role=delivery_team_a&entry=/delivery/routes/team-a` | **Pan IMS tablet view.** Same app inside a scaled 1180×820 Android-tablet bezel (a same-origin iframe, so the app's own tablet breakpoint applies: drawer sidebar, full-width pages), signed in as the Delivery Team tablet; the bar under the device has the same role switcher and accounts as the desktop demo. `?role=<demo role>` signs any visitor in as that account. |
| `/procure/<module>` | **Northwind Motor Parts purchasing console (demo).** A fictional motor-parts importer's purchasing console: dashboard, sales analytics, Amazon / storefront / other-channel sheets, needs-attention list, ads analytics, in-stock rate, forecast report and reorder planner, shopify inventory, yearly sales, PO / invoice / shipping-request trackers, containers, arrivals, incoming shipments, container booking (list in `src/procure/pages.ts`). Each is its own card on the home page and opens in a full-screen overlay. All names, vendors, ports, SKUs and figures are invented. |
| `/store` | **Pan Furniture storefront (demo).** The customer-facing shop (Sept 2026 redesign: category rails, ready-to-ship, promo beds, made-to-order, showrooms, contact rail, track pop-up, quote requests), mounted as a client-only app with a sample catalog (68 invented products across every category, using Pan's own product cutouts and install photos; invented reviews). `?entry=/collections/beds` opens a page directly. Checkout, card/QR payment, quote requests, review submission and the order tracker are answered locally (`src/store/api-mock.ts`). The site's own paths (`/checkout`, `/track?embed=1`, `/quote-request`…) route back into the demo while a store session is active in the tab. `/store?device=phone` shows the same store inside a phone frame (iframe at 390 px, `?frame=1` hides the demo badge). |

### `/pan` demo accounts

Password `pan1234`, OTP code `123456`, or use the Quick sign in buttons under the login card.

| Role | Email |
| --- | --- |
| Administrator | admin@panfurniture.ph |
| Operation Manager | ops@panfurniture.ph |
| Sales & Service | sales@panfurniture.ph |
| Warehouse & Delivery | warehouse@panfurniture.ph |
| Human Resources | hr@panfurniture.ph |
| Delivery Team tablet | delivery@panfurniture.ph |
| Production Area tablet | production@panfurniture.ph |

Access is driven by the **Employee Directory** (admin → HR → Employee Directory), exactly as in production: each employee row shows the App Login columns (Login Role dropdown, Login Email, Permissions). The Permissions grid lists every module × View/Edit, starts from the role's defaults and saves per-user grants/denies to the demo `user_permissions` table; the sidebar re-hydrates from the same tables, so a saved grid (or a changed Login Role) changes that account's tabs immediately and on the next Quick sign in. Seeded overrides: Sales granted Delivery Schedule + Customers edit, Warehouse granted Returns/Incoming edit, HR denied Payroll edit.

Seed volume: ~270 orders planned per team so the Delivery Team tabs (Pickup Task, Rework On-Site, Rework/Refund Pull Out, Delivery Route, Installation, Returns) shows 10+ rows; every other tab has at least 10 rows. Data you create (orders, approvals, QC, deliveries, HR entries…) persists in the browser's localStorage. **Reset data** on the floating demo bar restores the seed. Bump `SEED_VERSION` in `src/pan/db/seed.ts` whenever the seed changes so returning browsers reseed automatically.

## Showcase layout

The "Interactive demos" section shows the Pan IMS card with its tablet preview, a second wide card for the Pan Furniture storefront (`/store`) with its mobile preview overlapping the corner (`/store?device=phone`), and then the purchasing console as one titled section: category pills (Dashboards & analytics · Inventory & planning · Purchasing · Shipping) filter 21 compact module tiles. Every card and tile opens the same full-screen iframe overlay. Categories come from `product`/`category` on each demo in `src/content.ts`; layout in `src/components/DemoShowcase.tsx`, styles under `.show-sec` / `.show-pills` / `.show-tiles` in `src/styles.css`.

## Northwind console theme

The purchasing console ships with its own identity, distinct from any client system it was modelled on: warm off-white ground, graphite-teal primary, hazard-orange accent, teal for information, sharp 6px radii, Manrope + IBM Plex Mono. Tokens live in `src/procure/real/index.css`; `tools/build-procure-css.mjs` also re-points Tailwind's `blue` → teal, `slate` → warm stone and `violet` → steel scales so the copied components pick up the palette without JSX edits. Regenerate `src/procure/procure.css` with `npm run procure:css` after any change, then recapture `public/procure/*.png`.

Demo database persistence: `DemoDb` writes to localStorage on a 500 ms idle timer and stops persisting once the payload exceeds what localStorage can hold (the console database is ~5.7 MB, so it lives in memory for the session and reseeds on the next visit; the Pan database is ~2.2 MB and persists).

## Hero, robot and scroll animations

The hero drives `@splinetool/runtime` directly (no react-spline) with `renderer: 'webgl'`, importing Spline's **prebuilt** ESM from `public/robot/runtime/` (gitignored; `npm run robot:runtime`, run automatically by `npm run build`, copies it from node_modules together with the Draco decoder). Bundling the runtime through Vite re-minifies it and breaks the Draco worker it builds from stringified source, which left the hero stuck on the placeholder orb.


Attribution: the hero robot is "GENKUB - Greeting robot" from the Spline community (https://community.spline.design/file/5b3e7357-c7b4-4150-bbb0-9731e58c7cbd), licensed CC BY 4.0, self-hosted at `public/robot/scene.splinecode`.

The hero is dark and full-viewport like the reference: `src/components/Starfield.tsx` draws the drifting dot-constellation (canvas, cursor repulsion, paused off-tab, off under `prefers-reduced-motion`), `src/components/HeroRobot.tsx` mounts the 3D robot — a Spline scene (`@splinetool/react-spline`, ~2 MB, lazy-loaded after idle and only when the hero is near the viewport, paused while off-screen) behind a glowing placeholder orb; the scene URL is `ROBOT_SCENE` in that file (currently the public robot the reference uses — swap for your own). Entrance and scroll animations use `motion`: `Enter` (mount-time stagger in the hero) and `Reveal` (fade + rise once when in view) in `src/components/Reveal.tsx`, wrapped around section heads, steps, case cards, service rows, stats, showcase cards, the workflow stack, about and contact. Responsive: hero stacks (copy over a 320 px robot) under 900 px, nav brand and CTA never wrap, `#workflows` clips the fanned cards horizontally. `tools/cdp.mjs` jobs accept `viewport`, `width`, `height`, `mobile` for viewport-only captures.

## "Under the hood · the real workflows" (`#workflows`)

The rack is ruixen.ui's Coverflow Carousel from 21st.dev (`src/components/ui/coverflow-carousel.tsx`, Tailwind classes rewritten as `.cf-*` in styles.css, slides rendered through `renderSlide`, centre index controllable). The purchasing-console tiles use the 21st.dev "filter grid" pattern: Motion `LayoutGroup` sliding pill thumb + `AnimatePresence popLayout` so tiles slide between filters, and a pointer-tracked glow border via `--mx/--my` CSS vars.

`src/components/WorkflowGallery.tsx` renders a 3D card stack (`src/components/ui/card-stack.tsx`, the ruixen.ui CardStack with its Tailwind classes moved to `.cstack-*` in `styles.css`; needs the `motion` package) of workflow canvases between the case studies and Services. Drag, click a side card, arrow keys (while the section is on screen) and the dots move the stack; **Click to expand** opens a case-study lightbox (client, three metrics, problem, what was built, tools) with ‹ › / arrow-key navigation and Esc to close. Data lives in `workflows` at the bottom of `src/content.ts`; images are `public/workflows/<slug>.svg` — placeholder canvases drawn by the session script until the real screenshots are dropped in (keep the same file names, or change `image`).

## How `/procure` works

`src/procure/real/` holds the console's React pages, hooks, components and providers; `src/procure/ProcureApp.tsx` mounts them at `/procure` with an in-browser database (`src/procure/db/store.ts`, seeded by `src/procure/db/seed.ts`), a signed-in demo admin and demo shims for Supabase, auth and routing (`src/procure/shims/`). Tailwind v3 utilities are compiled scoped under `.procure-root` by `npm run procure:css` (`tools/build-procure-css.mjs`); the copy is type-checked by `tsconfig.procure.json`. Grid pages discover their columns through a `get_table_columns` RPC registered at module init. **Every identifier is invented** — brand (Northwind Motor Parts), people, vendors (TQL01…PST12), ports, carriers, SKUs (`BR1001-CE` style), prices, workflow stage names and planner windows (20 / 45 / 75 days) — and must stay that way; never paste real client values in here.

## How `/store` works

`src/store/real/` is the storefront's Next.js source (app pages, components, lib) copied as-is, minus the admin, API, payment and delivery-token routes. `src/store/StoreApp.tsx` mounts it at `/store`: an in-memory router (`src/store/router.tsx`) stands in for the app router, `src/store/shims/` replaces `next/link`, `next/navigation` (with `notFound()`), `next/image` (plain `<img>`) and `next/font/google`, and the async "server" pages are awaited in the browser against the bundled JSON. Vite resolves `@/…`, `next/link` and `next/navigation` per importer, so files under `src/store/` get the store shims while the Pan copy keeps its own.

- **Content** — `src/store/real/content/*.json` is invented sample data (product names, prices, reviewers); `public/store/images/**` are resized copies of Pan Furniture's own photos: product cutouts from `public/workflows/out/products/` (padded to 1200² tiles), bed-install room photos for the hero, banners, promo tiles, showrooms and “in real life”, Uratex listing images for mattresses, and the 50 fabric swatches — nothing from the reference-site catalogue. Regenerate with the scratch scripts `store_content.py` (base JSON) then `store_user.py` (catalog + images).
- **Styles** — `npm run store:css` compiles the site's Tailwind theme scoped under `.store-root` into `src/store/store.css` (part of `npm run build`); `store-demo.css` adds the font variables and the demo badge.
- **APIs** — `api-mock.ts` patches `window.fetch` while the demo is mounted: `/api/send-order` returns an order number + QR payload, `/api/send-mto` a quote number, `/api/track` a production timeline (any `ORD-000000`-style number works), `/api/reviews` accepts, `/api/pay-card` and the Maya tokenizer succeed, `/api/places` returns no suggestions, `/barangays.json` is served from `public/store/`.
- **Typecheck** — `npm run typecheck:store` (own `tsconfig.store.json`; the root config excludes `src/store`).

## How `/pan` works

```
src/pan/real/            verbatim copies of Pan-Furnitures (components/, lib/, app/**/data.ts, app/**/actions.ts)
src/pan/shims/           next/link, next/navigation, next/cache, next/server, next/headers, server-only,
                         node crypto/fs/path, face-api, sharp, pdfjs, capacitor push, imgly
src/pan/db/store.ts      in-memory tables + localStorage persistence + change bus
src/pan/db/fake-supabase.ts  PostgREST-compatible query builder (from/select/eq/in/or/not/ilike/order/limit/
                         single/maybeSingle/insert/update/upsert/delete/count, rpc registry, storage stub)
src/pan/db/seed*.ts      dummy rows following the production schemas (supabase/migrations) and the
                         real storefront CMS JSON (site/homepage/products/swatches). seed.ts = core
                         (products, orders, jobs, deliveries, HR); seed-extra.ts = ops/workshop/finance/CMS;
                         seed-more.ts = warehouse cubics (40 lines × A1–E6), POs/incoming/suppliers/rates,
                         costing, mattress, warranty, design details, edit requests, payment approvals,
                         stock build, WFH activity, QC rate sheet
src/pan/routes*.tsx      one entry per real app/<route>/page.tsx: same loaders, same client component
src/pan/page-host.tsx    runs the async loader, re-runs on revalidatePath / router.refresh / db change
```

Static pages the app iframes (`public/delivery-map.html` live driver map, `route-overview.html`, `track-preview.html`, `driver-preview.html`) are the real files with a small `fetch()` mock for `/api/*` injected at the top. Any non-portfolio URL (e.g. `/orders?q=…`, `/hr/directory/2`) falls through to the Pan app with that path as its entry, so deep links from inside the app and new tabs work.

Server-only modules that need real infrastructure (Supabase auth, Maya, n8n email, Facebook Graph, FCM, QZ Tray signing, disk assets) are replaced by small shims in `src/pan/real/lib/**` / `src/pan/real/app/**` that log and resolve, so every button still works.

## Where to edit content

| Change | File |
| --- | --- |
| Name, contact, title, services, case studies, experience | `src/content.ts` |
| Demo cards on the home page | `src/content.ts` → `demos` |
| Pan demo accounts | `src/pan/demo-data.ts` |
| Pan demo seed data | `src/pan/db/seed.ts`, `src/pan/db/seed-extra.ts`, `src/pan/db/seed-more.ts`, `src/pan/db/content/*.json` |
| Pan demo photos (Unsplash furniture stock, not Pan's own product photos) | `src/pan/db/images.ts` |
| Interactive demos showcase (frame, tabs, cards) | `src/components/DemoShowcase.tsx`, `demos` in `src/content.ts` |
| Case study copy, links, screenshots | `src/pages/PanFurniture.tsx`, images in `public/pan/` |

## Deploy

SPA — the host must rewrite unknown paths to `index.html`.

- **Render (static)** — `render.yaml` included (build `npm run build`, publish `dist`).
- **Vercel** — `vercel.json`. **Netlify** — `public/_redirects`.

## Notes

- `ref/` and `site.html` are scraped reference material from the site this design was modelled on; git-ignored.
- Refreshing copies from the production repo: `python copy_closure.py <entry files>` (`tools/copy_closure.py`; `tools/cdp.mjs` drives headless Chrome screenshots, `tools/schema.py` extracts table schemas from the migrations) copies a file's import closure into `src/pan/real/` without overwriting shims.
