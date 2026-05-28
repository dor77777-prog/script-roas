# Dashboard UX/UI Overhaul — Design Spec

**Date:** 2026-05-28
**Status:** Approved (pending user review of this file)
**Branch (when execution begins):** `dashboard-ux-overhaul-2026-05-28`

---

## Goal

Take the ROAS dashboard from its current "fintech-editorial Stripe-influenced" baseline to a **2026-grade premium SaaS experience** that:

1. Feels confident enough to demo live to clients during Zoom calls without apology.
2. Preserves the operator's daily workflow muscle memory (no surprise loss).
3. Carries one signature visual idea — the **ROAS-driven gradient** in TodayLive — into a coherent new design system.
4. Closes a silent typography correctness bug (Heebo lacks real `tnum`) discovered during research.
5. Adopts the 2026 SaaS premium vocabulary: OKLCH tokens, dim chrome + bright content, View Transitions API, calm sidebar nav, command palette as primary navigation, dark/light follow-system.

This is a **big-bang overhaul** of the user-facing tabs on a single feature branch, no incremental deploys, no Frankenstein UI mid-rollout. Implementation budget: ~3–4 weeks of focused work.

## Audience & Success Criteria

**Primary user:** the operator (1 person), 4–8 hours/day in this dashboard.
**Secondary moment:** live screen-share with clients during Zoom; the dashboard must read as a polished SaaS product, not an internal tool.

**Success criteria (qualitative):**

- **Operator test:** "After 2 weeks, do I miss the old UI?" Target: no.
- **Client test:** "Can I show this in a sales meeting without saying 'sorry it's a bit raw'?" Target: yes.
- **Demo test:** Toggle Focus Mode (⌘\\), screenshot any tab. Result is presentation-grade without retouching.

**Success criteria (measurable):**

- TypeScript + Vitest + ESLint pre-push gates pass on the merge.
- Bundle size delta: ≤ +25 KB gzipped (View Transitions are native; shadcn primitives tree-shake).
- No accessibility regression: keyboard-nav reaches every action that was reachable before; focus rings visible in both themes.
- All existing SWR keys / URL filter params continue to work — no breakage of bookmarked URLs.

## Non-Negotiables

These are constraints. They cannot be relaxed during implementation without an explicit spec revision.

1. **No information loss across any tab.** Every card, panel, section, KPI, control, table column, and drill-down accessible in the current dashboard remains accessible after the overhaul. Smart reorganization is welcomed; deletion or hiding is forbidden. Each existing component is labelled **STAYS / MOVES / NEW** — never REMOVED. See `feedback_no_info_loss_across_tabs.md`.
2. **ROAS-driven gradient on TodayLive is sacred.** The 4-tone gradient (red < 2.0 / orange 2.0–2.7 / green 2.7–3.0 / blue > 3.0) sourced from `roasLabel` SSOT in `analytics.ts` stays. The pulse animation, the blob blur, the LIVE pill, the per-store breakdown with per-platform CPM all stay. This is the dashboard's signature.
3. **Filter contract is locked.** The URL params (`store`, `from`, `to`, `range`) and their SWR-key shapes continue to work identically. Bookmarks survive. Operator's date-range muscle memory survives.
4. **Data layer is untouched.** No changes to API endpoints (`/api/data`, `/api/campaigns`, `/api/ads`, `/api/orders-attribution`, `/api/product-catalog`, `/api/dashboard-state`, `/api/operator/*`), Inngest functions, Supabase schema, or fetch contracts.
5. **Health Score logic is untouched.** The post-Phase-15 data-pure refactor (commits `5cf5dac`…`d5c134b`) is the SSOT — UI may render it differently, but never re-implement.
6. **Operator-secret middleware stays in place** (recent security hardening, commit `76449de`). Operator console is redesigned visually but its auth gate, BillingSettings logic, manual-override CRUD, and token-failure surface continue working byte-for-byte.
7. **RTL is primary, not a flag.** Hebrew is the default language; Latin numerics/labels are first-class within RTL. All new primitives must be RTL-correct by construction (`ms-`/`me-`/`text-start`/`text-end`/`<bdi>`).
8. **GoalTracker remains global.** It ignores `filters.store` and `filters.range`. See `feedback_monthly_goal_is_global.md`.
9. **MonthlyTables is critical and stays — explicitly.** The "טבלאות חודשיות" section in the ניתוח tab — a table per month with a row per day going back 17 months, with ROAS color coding (red/orange/green/blue + black-with-'0' for spend-without-revenue) — is the operator's primary historical-context tool. It does not move tabs, it does not lose any column, it does not collapse months, and it does not shrink its 17-month horizon. The TZ-stable helper `_isoMonthsAgoFromIlParts` (tested in `monthlyTablesIsoMonths*.test.ts`) is part of this guarantee.

## Locked Decisions

| # | Topic | Decision | Source |
|---|-------|----------|--------|
| 1 | Drivers | Aspirational visual + Specific UX friction + Density/clarity + Positioning for clients (all four) | User selected all 4 |
| 2 | Audience model | Single instance; shown live to clients via screen-share. No multi-tenant pivot. | User confirmed "Single instance, show live to clients occasionally" |
| 3 | Rollout | **Big-bang** — all tabs on one branch, one merge | User selected |
| 4 | Information Architecture | **Open** — propose ideal IA from scratch | User selected |
| 5 | Aesthetic mode | **Light + dark, airy chrome, dense data** (Linear-post-2026 chrome + Stripe-grade numeric column + Mercury-style KPI strip discipline). Chrome is calm; tables stay information-dense. | User selected (with clarification that "airy" means chrome, not data) |
| 6 | Hero pattern | **TodayLive IS the home hero.** ROAS-driven gradient stays 1-to-1; narrative line woven *inside* TodayLive between header and 6 stat cards. | User clarified — TodayLive personality is the DNA, narrative wraps inside |
| 7 | Theme default | **Follow system** (prefers-color-scheme), then persist user choice in localStorage. Toggle accessible via ⌘K and from Settings. | User selected |
| 8 | Charts library | **Recharts v3 + shadcn chart patterns** (ChartContainer / ChartTooltip / ChartLegend wrappers). Upgrade from current v2.15. | User selected |

## Design System

### Color tokens — OKLCH

Move all colors from Tailwind's HSL-based palette to **OKLCH** for perceptual uniformity (matches Stripe + Linear 2026 shift). Define in `tailwind.config.ts` via Tailwind v4 native OKLCH or via CSS custom properties.

Four token layers:

- **Surface** — `--surface-canvas`, `--surface-elevated-1`, `--surface-elevated-2`, `--surface-overlay`. Light mode: warm off-white scale starting `oklch(99% 0.005 80)`. Dark mode: soft dark starting `oklch(15% 0.01 240)` (not pure `#000`; modern dark standard).
- **Text** — `--text-primary`, `--text-secondary`, `--text-muted`, `--text-subtle`. LCH-uniform contrast steps.
- **Border** — `--border-default`, `--border-subtle`, `--border-strong`.
- **Status / ROAS** — `--status-red`, `--status-orange`, `--status-green`, `--status-blue` all at uniform `L=60%` for perceptual balance. Each with `-bg`, `-fg`, `-border` variants. **The 4 ROAS tones map 1-to-1 to today's `roasLabel.tone` values** — no logic change, only color-space migration.

**Accent**: a single brand accent (cool indigo near `oklch(60% 0.18 250)`) used sparingly — focus rings, link hovers, primary CTAs. Status colors are NOT used as accent.

### Typography

Three-font stack (all free, self-hosted via `next/font`):

| Role | Font | Why |
|------|------|-----|
| Hebrew body + labels | **Heebo** (keep — same as today) | Hebrew default, familiar muscle memory |
| Latin body + ALL tabular numbers (KPI values, table cells, currencies) | **Rubik** (NEW) | Has real OpenType `tnum` + `zero` + `case` features that Heebo lacks (silent bug fix). Sadan-revised Hebrew variant so Hebrew falls back to Rubik cleanly when chained after Heebo. |
| Monospace — IDs, hashes, technical labels | **Geist Mono** (NEW) | Vercel's mono; pairs with the broader 2026 vocabulary; tight grid for technical strings |

CSS chain:

```css
--font-sans: 'Heebo', 'Rubik', system-ui, -apple-system, sans-serif;
--font-numeric: 'Rubik', 'Heebo', tabular-nums; /* used on .tabular-nums */
--font-mono: 'Geist Mono', 'JetBrains Mono', ui-monospace, monospace;
```

`globals.css`'s existing `.tabular-nums` class continues to exist but now its declared `font-family` switches to `--font-numeric` so the `tnum` feature actually resolves. **This is a silent correctness fix**: today the class declares `font-variant-numeric: tabular-nums` against Heebo, which has no `tnum` feature — columns align only because Heebo's digits are coincidentally near-monowidth.

**No serif headlines in v1.** Frank Ruhl Libre was considered (research suggested it as an editorial accent) but deferred — it adds a 4th font and reads "newspaper" in a data context. Reserve for a later editorial polish pass if the design wants more personality.

### Spacing & density

Two scales:

- **Chrome / shell scale**: airy. Sidebar 64px wide collapsed / 240px expanded. Header padding `py-3 px-6`. Section gap `gap-4` between top-level surfaces. This is where "airy" lives.
- **Data scale**: dense. Tables continue at `text-xs` with `py-1.5` rows. KPI cards at `p-3` not `p-6`. Numeric columns right-aligned with tabular nums. Tables look like Stripe / Linear's command palette / Vercel's deployments table — not like Notion.

### Motion vocabulary

Three motion primitives. Use sparingly.

| Pattern | Implementation | Where |
|---------|----------------|-------|
| Page-level transition | **View Transitions API** (React 19 `<ViewTransition>`) | Sidebar tab switches; filter-driven content reload |
| Number tick on data change | Animate from old → new (no library; CSS `@property` interpolation OR keep existing `RollingNumber.tsx` if it does this; reuse rather than rewrite) | KPI cards, stat values |
| Subtle pulse | CSS `@keyframes` only | TodayLive LIVE indicator (existing pattern stays) |

**No Framer Motion adoption** for page-level work — research shows the industry is shedding it for native APIs. Keep it only if existing components already use it for collapse/expand; do not introduce in new code.

**No bouncy spring physics on hover-scale** — this dates the UI to 2023.

### Component primitives (new)

Today the codebase has **zero generic primitives** — every component styles its own chrome. Introduce a `components/ui/` folder with shadcn-style primitives (copy-paste, not a library dependency):

- `Card` (3 variants: `default`, `elevated`, `flat`)
- `Button` (5 variants: `primary`, `secondary`, `ghost`, `destructive`, `link`)
- `Badge` (status-tone aware — pulls from ROAS palette)
- `Tooltip` (Radix-based)
- `Dialog` (Radix-based — for ProductPickerModal, AdsDrawer overlays)
- `Sheet` (Radix-based — for CampaignDrawer)
- `Tabs` (Radix-based — internal use within tab content, not for top nav)
- `Input`, `Select`, `Switch`, `Toggle` (Radix-based)
- `ChartContainer`, `ChartTooltip`, `ChartLegend` (shadcn chart wrappers around Recharts v3)
- `Sparkline` (new wrapper around Recharts v3 LineChart with sane defaults — implementation plan decides per case whether to wrap or replace the existing `Sparkline.tsx`; either way, every existing usage continues to render an equivalent visual)

These are introduced *additively*. Existing domain components (TodayLive, CampaignsTable, etc.) continue to work and progressively migrate to use primitives over the course of the overhaul.

## Information Architecture

Top-level navigation moves from **horizontal tabs** to a **resizable vertical sidebar** on the start-side (right in RTL). This is the Linear-March-2026 + Vercel-Feb-2026 pattern.

**The existing 6-tab structure is preserved 1-to-1** in the sidebar. No tabs are added, removed, renamed, or merged. The current `TabKey` union (`home | pnl | analysis | campaigns | products | detail`) is the SSOT — the sidebar items map exactly to it.

### Sidebar items (default order, top to bottom — matches today's `TABS` array in `Dashboard.tsx`)

| Position | Label | Icon | Tab key | Maps to today's |
|----------|-------|------|---------|-----------------|
| Top | Logo / brand | — | n/a | New: subtle brand mark |
| 1 | בית | `Home` | `home` | HomeTab |
| 2 | P&L | `Receipt` | `pnl` | PnLTab |
| 3 | ניתוח | `TrendingUp` | `analysis` | AnalysisTab (RoasChart + **MonthlyTables**) |
| 4 | קמפיינים | `Megaphone` | `campaigns` | CampaignsTab |
| 5 | מוצרים | `Package` | `products` | ProductsTab (sub-tabs: table / pivot) |
| 6 | פירוט | `Table` | `detail` | DetailTab |
| Divider | | | | |
| Bottom | ניהול | `Cog` | n/a | Link to `/operator` route (sibling) |
| Footer | Theme toggle + ⌘K hint | — | — | Always visible |

The Header strip (Logo + freshness chip + ⌘K trigger + sync indicators + Cog link to /operator) collapses into the sidebar; the existing `Header.tsx` content reorganizes around the sidebar instead of being a top strip.

Sidebar is **collapsible** (`Cmd+B`) and **resizable** (drag handle). Collapsed state: icons only, 64px wide. Expanded: 240px with labels.

### Command palette (⌘K)

Existing `CommandPalette.tsx` (650L) is upgraded, not replaced. Adds:

- **Natural-language query**: "show me products with declining ROAS this week" — uses existing `aiReport` endpoint to translate to filter + nav action. Falls back to fuzzy search if no NL match.
- **Theme toggle** entries: "Switch to dark", "Switch to light", "Follow system".
- **Tab jumps**: "Go to Campaigns", "Go to Cohorts" — same as sidebar but via search.
- **Quick filter changes**: "Filter by uzoshop", "Last 7 days", "Compare YoY".

Keyboard: `⌘K` opens, `Esc` closes, arrow keys navigate, Enter selects.

### Focus mode (⌘\\)

New: dims the sidebar and top chrome to 30% opacity, hides operator-only badges, pauses the LIVE pulse animation. Used for screen-share with clients. Re-press to restore. State is ephemeral (not persisted) and resets on tab switch.

### Filter bar

The existing global filter row (`Filters.tsx`) moves from a separate full-width bar above tabs to **inline within each tab's header strip** (Northbeam's global-filter pattern). The filter contract (URL params) is unchanged; only the layout moves. `Filters` becomes a single-line component that renders inside the new `<TabHeader />` primitive.

**GoalTracker** (rendered as a section inside the בית tab) continues to ignore `filters.store` and `filters.range` per `feedback_monthly_goal_is_global.md`. It is not promoted to its own tab; it remains a Home-tab section with the eyebrow clarifying "מטרה גלובלית — לא מסוננת".

## Per-Tab Redesign Summary

Every existing component is classified **STAYS / MOVES / NEW**. No existing component is REMOVED. The actual 6-tab structure (from `TABS` in `Dashboard.tsx`) is preserved 1-to-1. Full per-component plan is encoded in the implementation plan that follows this spec.

### Tab 1 — בית / `home`

The "at a glance" view. Today's `HomeTab` is a long-scroll surface; the overhaul preserves every section.

**STAYS (1-to-1, content + structure preserved):**
- `TodayLive.tsx` — the ROAS-gradient hero, including all 4 tone variants (red/orange/green/blue from `roasLabel` SSOT), pulse animation, blur blob, 6 LiveStat cards, per-store breakdown with per-platform CPM, FX footer, 10-min refresh note
- `HeroOverview.tsx` — editorial story + chart-as-background + floating KPIs
- `AiReportButton.tsx` — entry to AI day summary (header position preserved)
- `GoalTracker.tsx` — monthly goal section; remains GLOBAL (ignores filters)
- `InsightsBoard.tsx` — anomalies, recommendations, opportunities
- `AnnotationsPanel.tsx` — activity log overlay
- `KpiCards.tsx` — detailed range KPIs ("מדדים מסכמים לתקופה")
- `PerStoreCards.tsx` — per-store cards for the selected range
- `SectionIntro` headers between each section (with their `formula` annotations)
- The Home tab's order: `TodayLive → HeroOverview → AiReport + filter row → Filters → GoalTracker → InsightsBoard → AnnotationsPanel → KpiCards → PerStoreCards`

**MOVES (relocated, content identical):**
- Top tabs → sidebar (sidebar item 1)
- Global `Filters.tsx` strip → inline `<TabHeader />` row
- `AiReportButton` migrates from "row above Filters" into the TabHeader itself (right side)

**NEW (additive only):**
- **Narrative line inside TodayLive** — a single sentence between header and 6 stat cards, e.g., "היום עשית ₪48,250 ב-ROAS 2.42x — 18% מעל היעד; Uzoshop מוביל". Generated from the existing `aiReport` data — no new API.
- **Inline AI insight pills** — a sentence or two of context next to each section's `SectionIntro` (replaces the standalone `AiReportButton` modal popup pattern by surfacing the same content inline; the button stays for the full report).
- **View Transitions** when switching between tabs.

### Tab 2 — P&L / `pnl`

Profit & loss deep-dive.

**STAYS:**
- `PnLBreakdown.tsx` (508L) — the full line-item P&L (Revenue → −COGS → −Transaction Fees → −Fixed Costs → Net)
- `BillingSettings.tsx` access button (the gear that opens the full CRUD modal)
- `RefundIndicator.tsx` integration if currently rendered here
- `SectionIntro` with the formula annotation

**MOVES:**
- Global `Filters.tsx` strip → inline `<TabHeader />`

**NEW:**
- **Income-statement typesetting** for `PnLBreakdown` (Lifetimely pattern — research-identified category gap). Same numbers, same line items, same math; rendered with serif eyebrows + right-aligned tabular columns + visible running subtotal. This is a presentation upgrade only.

### Tab 3 — ניתוח / `analysis`

**This tab contains `MonthlyTables` — the most operator-critical historical surface.** The 17-month rolling history with per-day ROAS color coding is unchanged in content, columns, color logic, or horizon.

**STAYS (every detail of MonthlyTables is non-negotiable, see Non-Negotiable #9):**
- `RoasChart.tsx` — multi-store line chart, dashed red ROAS=3.0 target reference, the existing per-store color mapping from `storeColors.ts`
- `MonthlyTables.tsx` — one table per month with one row per day, up to 17 months back. ROAS color band: red `<2`, orange `2–2.7`, green `2.7–3`, blue `>3`, black-with-`0` for spend-without-revenue
- The TZ-stable helper `_isoMonthsAgoFromIlParts` and its tests in `lib/__tests__/monthlyTablesIsoMonths*.test.ts`
- Both `SectionIntro` headers ("מגמת ROAS לאורך זמן" and "טבלאות חודשיות") with their description text and formula annotations

**MOVES:**
- Global `Filters.tsx` strip → inline `<TabHeader />`
- `SectionIntro` for the filter explainer ("הסינון מטה משפיע על גרף המגמה בלבד…") moves to a subtitle line under the TabHeader so the explanation that "filters affect chart but not monthly tables" stays visible at the top of the tab

**NEW (additive only):**
- **Theme-aware ROAS color bands** in MonthlyTables — same hues, dark-mode-correct backgrounds via the OKLCH token migration. The boundaries (2.0 / 2.7 / 3.0) and the SSOT (`roasLabel`) are unchanged
- **Optional column-header sparklines** above each month's revenue column — 30-day mini trend for that store, no extra row, no displacement of data

### Tab 4 — קמפיינים / `campaigns`

**STAYS:**
- `CampaignsTable.tsx` (2456L) — every column, every sort, every filter, cohort-mapping intelligence, cannibalization detection, Health Score column, current row selection and column visibility behavior
- `CampaignsTableRow.tsx` (857L) — cohort + cannibalization rendering logic
- `CampaignsColumnsMenu.tsx` — column visibility controls
- `CampaignDrawer.tsx` (1413L) — full campaign detail, including the embedded panels: `HealthScorePanel`, `CohortComparisonPanel`, `AttributionAnalysisPanel`, `ProductChannelBreakdown`, `CampaignsDailyDetail`
- `AdSetTable.tsx`, `AdsDrawer.tsx` — ad-set level surfaces under the drawer

**MOVES:**
- Global `Filters.tsx` strip → inline `<TabHeader />`
- `CampaignsTable.tsx` body is structurally split for maintenance (current 2456L is hard to evolve safely): shell + state in `CampaignsTable.tsx`, row in `CampaignsTableRow.tsx`, cohort+cannibalization detection extracted to `lib/campaignsIntelligence.ts`. **Rendered output is byte-equivalent** — split is a maintenance move, not a content change

**NEW:**
- **Inline sparkline column** in CampaignsTable — 7-day ROAS trend per row, no drilldown required
- **View-transition open** for `CampaignDrawer` — animates from the row position rather than fade-in (View Transitions API)
- **Northbeam-style quadrant scatter card** above the table — ROAS × CAC plotted on two axes, color-coded by quadrant (good/grow/cut/diagnose), bubble size = spend. This is a research-identified category gap; surfaces as a collapsed-by-default card at the top of the tab so it doesn't displace the table for operators who want to skip to it

### Tab 5 — מוצרים / `products`

Existing tab with two sub-tabs ("מוצרים שנמכרו" / "מוצרים → קמפיינים"). Sub-tab structure preserved.

**STAYS:**
- Sub-tab segmented control with both options
- `ProductsTable.tsx` (933L) — every column, period switcher, mapping intelligence
- `ProductCentricView.tsx` (877L) — pivot view with multi-mapping intelligence, "select a store" hint for `filters.store === 'All'`
- `ProductChannelBreakdown.tsx` (rendered inside drawer flows where applicable)
- `ProductPickerModal.tsx`

**MOVES:**
- Global `Filters.tsx` strip → inline `<TabHeader />`
- Sub-tab control redesigned as a Radix `Tabs` primitive with the same two options and same label text

**NEW:**
- **Inline sparkline column** in `ProductsTable` — 14-day units-sold trend per SKU

### Tab 6 — פירוט / `detail`

Raw daily log. Power-user view.

**STAYS:**
- `DetailTable.tsx` — every column (date × store, FB/Google spend, revenue, ROAS, profit), last 100 rows in selected range, the "ROAS שחור עם '0' = יום שהוצאת בו כסף אבל לא היו מכירות" color rule
- `SectionIntro` with the failure-day explainer

**MOVES:**
- Global `Filters.tsx` strip → inline `<TabHeader />`

**NEW:**
- **Inline sparkline column** in `DetailTable` — 7-day ROAS trend for the row's store
- **Theme-aware "spend without revenue"** styling — currently `bg-black text-white`; in dark mode this needs an inverse treatment to remain visible. Token-driven, content unchanged

### Sibling — ניהול / `/operator` route

Separate Next.js route at `/operator`, sibling to `/`. Operator console; secret-gated by middleware. Live contents (per `app/operator/page.tsx`, in render order):

**STAYS (every operator surface, byte-for-byte):**
- `OperatorSecretBanner.tsx`
- `SyncNowButtons.tsx` — fire sync-now per store / all-stores
- `TokenFailuresTable.tsx` — recent token failures with resolve
- `JobsTable.tsx` — recent cron / sync jobs
- `BackfillPicker.tsx` — historical backfill window picker
- `ManualOverridesCrud.tsx` — manual spend / revenue overrides
- `WhatsappTestButtons.tsx`
- `ResetData.tsx`
- Operator-secret middleware (commits `76449de` and `1513197`) untouched

**MOVES:**
- The Header `Cog` link → sidebar bottom item ("ניהול"), still pointing at `/operator`
- Operator screens get the new tokens applied so they're consistent in dark mode, but layout is unchanged

**NEW:**
- **Visual chrome upgrade only.** Operator surfaces get new tokens, fonts, primitives, and dark/light theme. They do NOT get hero treatments, narrative cards, sparkline columns, or AI summaries — those are user-facing patterns. The operator console is a workhorse and stays that way

### Where every component actually lives (verified against the code on 2026-05-28)

Authoritative map. Implementation plan must validate against this map before any component-level work.

| Component | File | Lives in | Rendered by |
|-----------|------|----------|-------------|
| `TodayLive` | `TodayLive.tsx` | **בית tab** | `HomeTab` |
| `HeroOverview` | `HeroOverview.tsx` | **בית tab** | `HomeTab` |
| `GoalTracker` | `GoalTracker.tsx` | **בית tab** (global, ignores filters) | `HomeTab` |
| `InsightsBoard` | `InsightsBoard.tsx` | **בית tab** | `HomeTab` |
| `AnnotationsPanel` | `AnnotationsPanel.tsx` | **בית tab** | `HomeTab` |
| `KpiCards` | `KpiCards.tsx` | **בית tab** | `HomeTab` |
| `PerStoreCards` | `PerStoreCards.tsx` | **בית tab** | `HomeTab` |
| `AiReportButton` | `AiReportButton.tsx` | **בית tab** (row above Filters) | `HomeTab` + opens via `CommandPalette` signal |
| `PnLBreakdown` | `PnLBreakdown.tsx` | **P&L tab** | `PnLTab` |
| `BillingSettings` | `BillingSettings.tsx` | **P&L tab** (gear → modal CRUD) | `PnLTab` |
| `BillingCsvImport` | `BillingCsvImport.tsx` | sub-component of `BillingSettings` | `BillingSettings` |
| `RoasChart` | `RoasChart.tsx` | **ניתוח tab** | `AnalysisTab` |
| `MonthlyTables` | `MonthlyTables.tsx` | **ניתוח tab** | `AnalysisTab` |
| `CampaignsTable` | `CampaignsTable.tsx` (2456L) | **קמפיינים tab** | `CampaignsTab` |
| `CampaignsTableRow` | `CampaignsTableRow.tsx` (857L) | inside `CampaignsTable` | `CampaignsTable` |
| `CampaignsColumnsMenu` | `CampaignsColumnsMenu.tsx` | inside `CampaignsTable` | `CampaignsTable` |
| `CampaignDrawer` | `CampaignDrawer.tsx` (1413L) | drawer overlay from **קמפיינים tab** | row click in `CampaignsTable` |
| `HealthScorePanel` | `HealthScorePanel.tsx` | inside `CampaignDrawer` | `CampaignDrawer` |
| `HealthScoreBadge` | `HealthScoreBadge.tsx` | inside `CampaignsTableRow` | `CampaignsTableRow` |
| `CohortComparisonPanel` | `CohortComparisonPanel.tsx` | inside `CampaignDrawer` | `CampaignDrawer` |
| `AttributionAnalysisPanel` | `AttributionAnalysisPanel.tsx` | inside `CampaignDrawer` | `CampaignDrawer` |
| `ProductChannelBreakdown` | `ProductChannelBreakdown.tsx` | inside `CampaignDrawer` | `CampaignDrawer` |
| `MetaShopifyReconciliation` | `MetaShopifyReconciliation.tsx` (848L) | inside `CampaignDrawer` (NOT operator) | `CampaignDrawer` |
| `AdSetTable` | `AdSetTable.tsx` | inside `CampaignDrawer` | `CampaignDrawer` |
| `AdsDrawer` | `AdsDrawer.tsx` (635L) | nested drawer from `CampaignDrawer` | `AdSetTable` row |
| `ProductPickerModal` | `ProductPickerModal.tsx` | modal from `CampaignDrawer` | `CampaignDrawer` map-products flow |
| `ProductsTable` | `ProductsTable.tsx` (933L) | **מוצרים tab** (sub-tab 'table') | `ProductsTab` |
| `ProductCentricView` | `ProductCentricView.tsx` (877L) | **מוצרים tab** (sub-tab 'pivot') | `ProductsTab` |
| `DetailTable` | `DetailTable.tsx` | **פירוט tab** | `DetailTab` |
| `RefundIndicator` | `RefundIndicator.tsx` | inside `DetailTable` AND `MonthlyTables` | both tables |
| `Filters` | `Filters.tsx` | every tab (rendered per tab) | every tab body |
| `TabFreshnessHeader` | `TabFreshnessHeader.tsx` | global, above every tab | `Dashboard` |
| `TabNav` | `TabNav.tsx` | global header | `Dashboard` (will be replaced by `Sidebar`) |
| `CommandPalette` | `CommandPalette.tsx` (650L) | global, ⌘K trigger in Header | `Dashboard.Header` |
| `Header` (Dashboard's) | `Dashboard.tsx` inline | global | `Dashboard` (content collapses into `Sidebar`) |
| `FreshnessChip` | `FreshnessChip.tsx` | inside `Header` + `TabFreshnessHeader` | both |
| `SyncIndicator` | `SyncIndicator.tsx` | inside `Header` | `Header` |
| `CloudSync` | `CloudSync.tsx` | invisible, top of `Dashboard` | `Dashboard` |
| `OperatorSecretBanner`, `SyncNowButtons`, `TokenFailuresTable`, `JobsTable`, `BackfillPicker`, `ManualOverridesCrud`, `WhatsappTestButtons`, `ResetData` | `components/operator/*.tsx` | **`/operator` route** | `app/operator/page.tsx` |
| `WhatsWorking` | `WhatsWorking.tsx` | **No wired usage found in the JSX** — likely dead code or behind a flag | needs validation in implementation plan before STAYS commitment |

`SectionIntro`, `MetricHelp`, `RollingNumber`, `CollapsibleSection`, `Sparkline` are shared utility components used across multiple tabs; all STAY and migrate to new tokens like everything else.

## Charts Strategy

Upgrade Recharts 2.15 → 3.x and adopt shadcn chart-component wrappers.

**Tasks (high level):**

1. Bump `recharts` and run a compatibility audit on each chart (api differences are small in v3).
2. Add shadcn-style `ChartContainer`, `ChartTooltip`, `ChartLegend` primitives in `components/ui/chart/`. These wrap Recharts and apply OKLCH tokens consistently.
3. Migrate each chart to wrap with the new primitives:
   - `HeroOverview.tsx` (area chart)
   - `RoasChart.tsx` (multi-line)
   - `Sparkline.tsx` (mini line) — used in TodayLive and the new in-row sparklines
   - All charts in `InsightsBoard`, `WhatsWorking`, `CohortComparisonPanel`, `AttributionAnalysisPanel`
4. **Adopt the 2026 chart visual vocabulary:**
   - Solid stroke + ≤15% gradient fill (was: heavier fills)
   - Live crosshair on hover with mono-font tooltip values
   - Dashed reference gridlines at low opacity (continues today's pattern; just OKLCH now)
   - Per-store colors continue from `storeColors.ts` SSOT (no change — already 120° hue-separated for accessibility)
5. **Add Northbeam-style scatter** for the new quadrant card on the קמפיינים tab — uses Recharts `ScatterChart`.

**No tremor, no visx adoption** — staying within Recharts keeps maintenance simple and preserves existing chart logic.

## Light / Dark Theme Behavior

- **First load:** matches `prefers-color-scheme` from the OS.
- **After first toggle:** user choice persisted in `localStorage` (key: `roas-theme` — values `system` | `light` | `dark`).
- **Toggle locations:**
  - Sidebar footer (sun/moon icon)
  - Command palette (`⌘K` → "Switch to dark" / "Switch to light" / "Follow system")
- **No flash of unstyled theme:** apply theme class on `<html>` in a small inline `<script>` before React hydration (standard pattern).
- **TodayLive's ROAS gradient must work in both themes.** The 4 tones (red/orange/green/blue) have separate `--*-bg`, `--*-fg`, `--*-border` tokens for light and dark — same hue, different luminance.

## RTL Discipline Checklist

Every component touched must comply with this checklist. New `components/ui/` primitives are RTL-correct by construction. Existing components are audited on migration.

- [ ] Use `ms-*` / `me-*` / `ps-*` / `pe-*` — never `ml-*` / `mr-*` / `pl-*` / `pr-*`
- [ ] Use `text-start` / `text-end` — never `text-left` / `text-right`
- [ ] Wrap Latin numbers in `<bdi>` to prevent RTL number reversal (currency, dates, IDs)
- [ ] `flex` directions: rely on logical (`flex-row`) — RTL is handled by `dir="rtl"` on root
- [ ] `letter-spacing` is 0 in Hebrew runs (Hebrew doesn't take tracking well)
- [ ] Icons that imply direction (chevron, arrow) flip via `rtl:-scale-x-100`
- [ ] Drawers and sheets open from start-side (right in RTL)

## Migration Strategy

**Pre-overhaul capture (before branch):** screenshot the 4 ROAS-tone states of TodayLive (red/orange/green/blue) on a representative day for each. Screenshots are the visual baseline for "did we preserve the signature gradient" at merge time. Also capture: full scroll of each tab (בית / P&L / ניתוח / קמפיינים / מוצרים / פירוט), CampaignDrawer with its embedded panels (HealthScorePanel, CohortComparisonPanel, AttributionAnalysisPanel, ProductChannelBreakdown) open on a representative campaign, MonthlyTables at all 17 months of history, Operator console main view. Save under `.planning/dashboard-ux-overhaul-2026-05-28/before/`.

**Single feature branch** `dashboard-ux-overhaul-2026-05-28`. No incremental deploys. Merge to main when:
- All STAYS components verified byte-identical in their data outputs (snapshot tests on data, visual diff acceptable)
- All MOVES components reachable and functionally equivalent
- All NEW components have tests
- TypeScript + Vitest + ESLint pre-push gates green
- User Manual + Architecture Doc updated in the same merge (see `feedback_keep_user_manual_current.md`)
- Manual end-to-end pass: every tab loads, every URL filter param works, every drilldown opens, theme toggle persists, ⌘K opens, Focus Mode works

**Phasing of WORK (not deploys)** during the branch:

1. **Plan 1 — Foundation** (~5-7 days). Design tokens (OKLCH), font stack (Heebo+Rubik+Geist Mono), theme system + no-FOUC, `components/ui/` primitives, Sidebar shell, TabHeader, FocusMode, View-Transitions root, ⌘K NL upgrade. Tab-agnostic; nothing user-visible yet.
2. **Plan 2 — בית tab** (~4-5 days). TodayLive narrative line, token migration of HomeTab + every section component (TodayLive, HeroOverview, GoalTracker, InsightsBoard, AnnotationsPanel, KpiCards, PerStoreCards, AiReportButton). Inline AI insight pills.
3. **Plan 3 — Charts upgrade** (~2-3 days). Recharts v3, ChartContainer/Tooltip/Legend wrappers, migration of HeroOverview, RoasChart, Sparkline, and every chart in panels.
4. **Plan 4 — קמפיינים + מוצרים tabs** (~5-7 days). CampaignsTable structural split, CampaignsTableRow + CampaignDrawer token migration, embedded panels (HealthScorePanel, CohortComparisonPanel, AttributionAnalysisPanel, ProductChannelBreakdown) migrated. Sparkline columns. QuadrantScatter card. View-transition drawer open. ProductsTab sub-tab redesign and ProductCentricView migration.
5. **Plan 5 — ניתוח + P&L + פירוט tabs** (~4-5 days). RoasChart + **MonthlyTables (no horizon/column changes)** token migration. PnLBreakdown income-statement typesetting. DetailTable theme-aware spend-without-revenue rule + sparkline column.
6. **Plan 6 — Operator** (~1-2 days). Chrome-only token migration across all operator components.
7. **Plan 7 — Polish** (~2-3 days). RTL audit pass, a11y, motion vocabulary review, after-screenshots, User Manual + Architecture Doc update.

Detailed file-by-file plan is generated by the `superpowers:writing-plans` skill, one plan per phase above.

## Files Affected (high-level inventory)

**New files:**
- `dashboard-web/src/components/ui/{Card,Button,Badge,Tooltip,Dialog,Sheet,Tabs,Input,Select,Switch,Toggle,Sparkline}.tsx` (primitives)
- `dashboard-web/src/components/ui/chart/{ChartContainer,ChartTooltip,ChartLegend}.tsx` (shadcn chart wrappers)
- `dashboard-web/src/components/Sidebar.tsx` (NEW navigation chrome — replaces top TabNav)
- `dashboard-web/src/components/TabHeader.tsx` (NEW per-tab title+filter strip)
- `dashboard-web/src/components/FocusMode.tsx` (NEW `⌘\\` chrome-dim component)
- `dashboard-web/src/components/ThemeProvider.tsx` + `useTheme` hook
- `dashboard-web/src/components/QuadrantScatter.tsx` (NEW Campaigns-tab card — ROAS × CAC scatter)
- `dashboard-web/src/lib/theme.ts` (theme persistence helpers)
- `dashboard-web/src/lib/campaignsIntelligence.ts` (extracted cohort + cannibalization detection from CampaignsTable split)

No new tabs (`/goals`, `/products`, `/cohorts`, `/health`) — the existing 6-tab structure is preserved.

**Heavily modified files:**
- `dashboard-web/tailwind.config.ts` — OKLCH token migration, new font chain, dark mode preset
- `dashboard-web/src/app/globals.css` — theme variables, `tabular-nums` font-family swap, focus-mode utilities
- `dashboard-web/src/app/layout.tsx` — load Heebo + Rubik + Geist Mono via `next/font`, theme `<script>` for no-FOUC
- `dashboard-web/src/components/Dashboard.tsx` (747L) — replaces `TabNav` with `Sidebar`, integrates `TabHeader`, wraps tab content in View Transition root, inlines per-tab `Filters` placement
- `dashboard-web/src/components/Header.tsx` content — collapsed into Sidebar
- `dashboard-web/src/components/TabNav.tsx` — removed (replaced by Sidebar); the `TabDef` type and tab keys SSOT remain
- `dashboard-web/src/components/TodayLive.tsx` (667L) — narrative line added between header and stat grid; existing structure preserved; tokens migrated
- `dashboard-web/src/components/HeroOverview.tsx` (738L) — token migration; structure preserved
- `dashboard-web/src/components/MonthlyTables.tsx` — token migration only (color bands → theme tokens); columns + 17-month horizon + helpers unchanged
- `dashboard-web/src/components/RoasChart.tsx` — Recharts v3 + ChartContainer migration; multi-store color logic unchanged
- `dashboard-web/src/components/PnLBreakdown.tsx` (508L) — income-statement typesetting; line items and math preserved
- `dashboard-web/src/components/CampaignsTable.tsx` (2456L) — structural split into shell + extracted intelligence (cohort + cannibalization), tokens migrated, sparkline column added
- `dashboard-web/src/components/CampaignsTableRow.tsx` (857L) — token migration, sparkline cell
- `dashboard-web/src/components/CampaignDrawer.tsx` (1413L) — token migration, view-transition open animation; embedded HealthScorePanel + CohortComparisonPanel + AttributionAnalysisPanel + ProductChannelBreakdown reach by tokens
- `dashboard-web/src/components/HealthScorePanel.tsx` — token migration only; logic untouched (post-`d5c134b` data-pure)
- `dashboard-web/src/components/CohortComparisonPanel.tsx` — token migration; cohort math unchanged
- `dashboard-web/src/components/AttributionAnalysisPanel.tsx` — token migration
- `dashboard-web/src/components/InsightsBoard.tsx`, `WhatsWorking.tsx`, `AnnotationsPanel.tsx` — token migration
- `dashboard-web/src/components/GoalTracker.tsx` — token migration; global-filter behavior preserved
- `dashboard-web/src/components/KpiCards.tsx`, `PerStoreCards.tsx`, `DetailTable.tsx` — token migration + sparkline columns where noted
- `dashboard-web/src/components/ProductsTable.tsx` (933L), `ProductCentricView.tsx` (877L), `ProductChannelBreakdown.tsx`, `ProductPickerModal.tsx` — token migration
- `dashboard-web/src/components/Filters.tsx` — restyled as inline `<TabHeader />` child
- `dashboard-web/src/components/CommandPalette.tsx` (650L) — NL query support + theme toggle entries
- `dashboard-web/src/components/AiReportButton.tsx` — token migration; surfaces optionally as inline AI insight pills in addition to existing modal
- `dashboard-web/src/components/BillingSettings.tsx` (1171L) — chrome refresh only (no CRUD logic)
- `dashboard-web/src/components/operator/*` — token migration pass only; auth + CRUD untouched
- `dashboard-web/src/components/MetaShopifyReconciliation.tsx` (848L) — token migration; lives inside CampaignDrawer (קמפיינים tab), NOT operator
- `dashboard-web/src/components/CloudSync.tsx` — invisible state sync; token migration not needed (no visible UI)
- Every other component file under `dashboard-web/src/components/` — token migration pass (Tailwind classes adjusted to new tokens; structure unchanged)

**Untouched:**
- All API routes (`dashboard-web/src/app/api/**`)
- All `lib/analytics.ts` math
- All Inngest functions
- Supabase schema and migrations
- All test files for data layer
- `scripts/`, `supabase/`, `vercel.json`

## Testing Strategy

**Existing test suite continues to pass.** All `vitest` tests for analytics, refund logic, Health Score, etc. — unchanged. The data layer doesn't move.

**New tests:**

- `components/ui/` primitive snapshot + accessibility (axe) tests
- Theme persistence: `theme.test.ts` — system → light → dark → system, localStorage write/read
- View Transitions: smoke test that tab switches don't error in environments without VT support (graceful degradation)
- RTL discipline: a parameterized test that renders new primitives in `dir="rtl"` and asserts no `ml-*`/`mr-*` survive in className strings
- Sparkline-in-row: deterministic prop rendering test
- Quadrant scatter: golden-data test for quadrant assignment given (ROAS, CAC)

**Manual passes (before merge):**

- Operator playthrough: every Operator action (manual override CRUD, sync now, backfill, token failure resolve) works
- Filter contract: every URL pattern from a list of bookmarked URLs (operator should provide ~5 representative ones) loads correctly
- Demo dry run: open dashboard cold, toggle Focus Mode, walk through Home → Campaigns → Insights. Note any moment of friction.

## Out of Scope (Phase 2 candidates)

These came up in research and were deferred to stay within budget:

- **Editorial serif accents** (Frank Ruhl Libre for hero headlines)
- **Commercial Hebrew type** (Ploni AAA at $1,595 — only worth it if the dashboard goes white-label commercial)
- **Cometly-style funnel hero** for any tab (declined — TodayLive is the Home hero; funnel is a poor fit for the multi-channel ROAS narrative)
- **Time-of-day auto theme** (day=light, night=dark) — declined; system follow is enough
- **Full white-label theming** (per-client brand) — not needed for single-instance + occasional client demos
- **Mobile-first redesign** — current dashboard is desktop-only by design; mobile is responsive but not the primary form factor
- **A11y full audit (WCAG AA)** — Phase 2 if dashboard becomes client-facing

## Risks

| Risk | Mitigation |
|------|-----------|
| The big-bang branch grows stale vs. main during 3–4 weeks | Rebase weekly. Keep data-layer commits going directly to main, not the feature branch. |
| CampaignsTable structural split introduces a subtle data-rendering bug | Pre-extract a snapshot of the current rendered table for 3 representative date ranges; assert byte-equivalent rendering after split before any visual changes. |
| Recharts v3 has a breaking change for a chart we depend on | Audit during Foundation week; if a chart genuinely breaks, isolate it for a longer-lived `Recharts.v2` shim component for that one chart only. |
| ROAS gradient looks wrong in dark mode | Each ROAS tone has separate dark tokens; visual diff against the four current screenshots (red/orange/green/blue Today snapshots) before merge. |
| User Manual + Architecture Doc fall behind | Pre-push gate enforces it (see `feedback_keep_user_manual_current.md`). Both must be updated in the same merge. |
| OAuth Google refresh-token expires mid-overhaul (~2026-05-30 per `project_google_oauth_refresh_token_pending.md`) | Operator publishes the consent screen *before* starting this overhaul. |
| Cumulative session count of LIVE refresh + theme `<script>` + ⌘K NL inflates bundle | Audit final bundle in CI; budget +25 KB gzipped max. |

## Open Questions for Implementation Plan to Verify

The implementation plan must verify these against the live code before committing to the listed treatment:

1. **`WhatsWorking.tsx` wiring.** A grep on 2026-05-28 found no JSX usage of this component. The implementation plan's audit step must confirm one of: (a) it's behind a feature flag, (b) it's truly dead code (in which case `git rm` may be appropriate but only with explicit operator approval — the no-info-loss principle protects user-visible info, not unused files), or (c) it's wired in a way the grep missed. STAYS or remove-decision happens in the plan, not here.
2. **CampaignDrawer's full embedded panel list.** The drawer renders `HealthScorePanel`, `CohortComparisonPanel`, `AttributionAnalysisPanel`, `ProductChannelBreakdown`, `MetaShopifyReconciliation`, `AdSetTable`, `AdsDrawer`, and `ProductPickerModal` — all of which must be visually consistent under the new tokens. Plan audits each.
3. **Sub-component sprawl inside large files.** `CampaignsTable` (2456L), `CampaignDrawer` (1413L), `BillingSettings` (1171L), `ProductsTable` (933L), `ProductCentricView` (877L), `CampaignsTableRow` (857L), `MetaShopifyReconciliation` (848L), `HeroOverview` (738L), `TodayLive` (667L), `CommandPalette` (650L), `AdsDrawer` (635L), `PnLBreakdown` (508L) each get a "structural decomposition?" check during the plan. Decomposition only happens where it makes the migration safer — never for its own sake.

## Open Questions Resolved by Implementation Plan

These are decisions that belong in the implementation plan (the `superpowers:writing-plans` output), not this spec:

- Exact OKLCH values per token (will be table in plan)
- Exact CSS variable names and file location
- `tsconfig.json` path-aliases for `components/ui/`
- Whether to use Radix UI as base (recommended) vs. ariakit
- Sidebar persisted-state key
- Migration order within each tab (which sub-component first)
- Whether each primitive lives in its own file or shares an `index.ts`

## References

- Research notes (this brainstorm session):
  - `/tmp/research-design-trends-2026.md`
  - `/tmp/research-saas-premium.md`
  - `/tmp/research-roas-competitors.md`
  - `/tmp/research-rtl-hebrew-typography.md`
- Visual mockups (this brainstorm session):
  - `.superpowers/brainstorm/9584-1779985439/content/aesthetic-explanation.html`
  - `.superpowers/brainstorm/9584-1779985439/content/hero-pattern.html`
  - `.superpowers/brainstorm/9584-1779985439/content/home-tab-full.html`
  - `.superpowers/brainstorm/9584-1779985439/content/todaylive-as-hero.html`
- Memory references:
  - `feedback_no_info_loss_across_tabs.md` — non-negotiable #1
  - `feedback_monthly_goal_is_global.md` — GoalTracker stays a בית tab section and ignores filters
  - `feedback_keep_user_manual_current.md` — doc gate
  - `project_script_roas_dashboard.md` — architecture context
  - `project_audit_2026_05_28_data_consistency.md` — recent data-correctness work to not undo
