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

### Sidebar items (default order, top to bottom)

| Position | Label | Icon | Tab destination | Notes |
|----------|-------|------|-----------------|-------|
| Top | Logo / brand | — | / (Home) | New: subtle brand mark |
| 1 | היום (Home) | `Home` | Today/Home tab | First on muscle memory |
| 2 | קמפיינים | `LayoutGrid` | Campaigns | |
| 3 | תובנות | `Sparkles` | Insights | Now includes WhatsWorking + AttributionAnalysis |
| 4 | קבוצות (Cohorts) | `Layers` | Cohorts | CohortComparisonPanel as primary |
| 5 | בריאות | `HeartPulse` | Health Score | HealthScorePanel + AiReport |
| 6 | מוצרים | `Package` | Products | NEW position — was inside Insights; surface as own tab |
| Divider | | | | |
| 7 | מטרות | `Target` | Goals (NEW tab) | GoalTracker promoted (currently a Home widget); keeps global no-filter behavior |
| Divider | | | | |
| Bottom | אופרטור | `Settings2` | Operator | Always last; secret-gated |
| Footer | Theme toggle + ⌘K hint | — | — | Always visible |

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

**GoalTracker monthly goal** continues to ignore filters per `feedback_monthly_goal_is_global.md`. The Goals tab makes this explicit by NOT showing the global filter at all.

## Per-Tab Redesign Summary

Every existing component is classified **STAYS / MOVES / NEW**. No existing component is REMOVED. Full per-component plan is encoded in the implementation plan that follows this spec.

### Tab 1 — היום / Home

**STAYS (1-to-1, content + structure preserved):**
- `TodayLive.tsx` — entire ROAS-gradient hero, including all 4 tone variants, pulse, blob, 6 stat cards, 3 per-store cards with per-platform CPM, FX footer, refresh note
- `HeroOverview.tsx` chart — multi-store area chart over `range`
- `RoasChart.tsx` line chart — per-store ROAS trend
- `KpiCards.tsx` — historical-range KPIs (separate from TodayLive's today-only cards)
- `PerStoreCards.tsx` — range view per-store summary
- `DetailTable.tsx` — daily breakdown
- `MonthlyTables.tsx` — month view
- `SyncIndicator.tsx`, `FreshnessChip.tsx`
- `GoalTracker.tsx` — moves to dedicated Goals tab (see MOVES below) but stays as Home widget too
- `RefundIndicator.tsx`, `AnnotationsPanel.tsx`, `PnLBreakdown.tsx`
- `AiReportButton.tsx` — entry to the AI day summary

**MOVES (relocated, content identical):**
- Top tabs → sidebar (Vercel pattern)
- Global `Filters.tsx` → inline `<TabHeader />` strip per tab
- The 6-column KPI grid that *used* to compete with TodayLive — relocated below the chart row as historical-range supporting context. TodayLive's 6 stat cards remain the live numbers; the historical KpiCards become "for the selected range" context.

**NEW (additive only):**
- **Narrative line inside TodayLive** — a single sentence between header and stat grid, e.g., "היום עשית ₪48,250 ב-ROAS 2.42x — 18% מעל היעד; Uzoshop מוביל". Generated from existing `aiReport` data — no new API.
- **Sparklines inside DetailTable rows** — a new column showing 7-day ROAS trend per row.
- **View Transitions** between Home and other tabs.

### Tab 2 — קמפיינים / Campaigns

**STAYS:**
- `CampaignsTable.tsx` (2456L) — every column, every sort, every filter, cohort-mapping intelligence, cannibalization detection, Health Score column
- `CampaignsTableRow.tsx` (857L) — cohort + cannibalization logic
- `CampaignsColumnsMenu.tsx` — column visibility
- `CampaignDrawer.tsx` (1413L) — full campaign detail
- `AdSetTable.tsx`, `AdsDrawer.tsx`
- `CampaignsDailyDetail` (the per-day breakdown inside the drawer)

**MOVES:**
- `Filters.tsx` inline at top of tab
- `CampaignsTable` body split into `CampaignsTable.tsx` (shell + state) + `CampaignsTableRow.tsx` (row) + extracted hooks for cohort/cannibalization detection. **The file is 2456L today — a structural split is non-optional even from a maintenance angle**; the content shown to the user is byte-identical.

**NEW:**
- **Sparkline column** in CampaignsTable — 7-day ROAS trend visible inline per campaign row, no drilldown required.
- **Campaign drawer view-transition** — opening the drawer animates from the row's position rather than fading in (View Transitions API).

### Tab 3 — תובנות / Insights

**STAYS:**
- `InsightsBoard.tsx`, `WhatsWorking.tsx`
- `AttributionAnalysisPanel.tsx`
- `ProductCentricView.tsx` (877L) — moves to Products tab; in Insights it stays accessible via a "view in Products tab" link, but the component lives in Products now
- `ProductChannelBreakdown.tsx`
- `CohortComparisonPanel.tsx` — moves to Cohorts tab as primary, but a summary card remains in Insights linking through

**MOVES:**
- `Filters.tsx` inline
- Layout reflows to a 2-column on lg screens, single column on md and below

**NEW:**
- **Northbeam-style quadrant scatter** — ROAS × CAC plotted on two axes, color-coded by quadrant (good/grow/cut/diagnose). Bubble size = spend. Surfaces as a new card on the Insights board. This is a research-identified category gap — no competitor does it well; cheap differentiator.
- **AI summary card at the top** — same content as `AiReportButton` but inline-rendered (not a button-to-popup), one paragraph.

### Tab 4 — קבוצות / Cohorts

**STAYS:**
- `CohortComparisonPanel.tsx` as primary
- Multi-mapping intelligence (Steps 1–3 shipped per `project_multi_mapping_intelligence_progress.md`)
- All cohort math (cannibalization detection, cohort-aware Health Score scoring)

**MOVES:**
- Cohort comparison is the tab's hero (not embedded in Insights)
- `Filters.tsx` inline

**NEW:**
- **Cumulative-revenue cohort heatmap** (Lifetimely-pattern) — alongside the existing comparison panel.

### Tab 5 — בריאות / Health Score

**STAYS:**
- `HealthScorePanel.tsx` — pure-function rendering (no operator flags, per `5cf5dac` refactor)
- `AiReportButton.tsx` and its full report view

**MOVES:**
- `Filters.tsx` inline
- `HealthScorePanel` becomes the tab hero rather than an embedded widget

**NEW:**
- **Per-campaign Health Score histogram** — distribution view showing how many campaigns are in each Health bucket. Helps operator spot whether a low overall health is one bad campaign or many medium ones.

### Tab 6 — מוצרים / Products (promoted from Insights)

**STAYS:**
- `ProductsTable.tsx` (933L) — every column
- `ProductCentricView.tsx` (877L) — moves here as the primary view
- `ProductChannelBreakdown.tsx`
- `ProductPickerModal.tsx`

**MOVES:**
- Promoted from being a sub-section of Insights to its own top-level tab
- `Filters.tsx` inline

**NEW:**
- **Sparklines inside ProductsTable rows** — 14-day units-sold trend per SKU.

### Tab 7 — מטרות / Goals (NEW tab)

**STAYS:**
- `GoalTracker.tsx` — ignores filters (global), per `feedback_monthly_goal_is_global.md`. Continues to be ALSO available as a Home widget.

**MOVES:**
- Promoted to its own tab so monthly-goal context has room to breathe; eyebrow-text clarifies "מטרה גלובלית — לא מסוננת".

**NEW:**
- **Goal timeline** — visualizes progress across the month with daily contribution bars.
- **Goal adjustment UI** (operator-only, behind same secret gate as Operator) for editing the monthly target.

### Tab 8 — אופרטור / Operator

**STAYS:**
- Every operator component: `BillingSettings.tsx` (1171L), `JobsTable`, `ManualOverridesCrud`, `BackfillPicker`, `SyncNowButtons`, `ResetData`, `TokenFailuresTable`, `WhatsappTestButtons`, `OperatorSecretBanner`
- Operator-secret middleware (commit `76449de`) untouched
- `MetaShopifyReconciliation.tsx` (848L)
- `CloudSync.tsx`
- `BackfillPicker.tsx`

**MOVES:**
- Top tab nav → sidebar (icon at bottom — `Settings2`)
- Filter bar continues to be hidden here (operator screens have their own controls)

**NEW:**
- **Visual chrome upgrade only.** Operator tab gets the new tokens, fonts, primitives, sidebar position, and dark/light theme. It does **not** get a hero, narrative card, sparkline columns, or AI summaries — those are user-facing patterns. The operator console is a workhorse and stays that way.

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
5. **Add Northbeam-style scatter** for the new Insights tab quadrant view — uses Recharts `ScatterChart`.

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

**Pre-overhaul capture (before branch):** screenshot the 4 ROAS-tone states of TodayLive (red/orange/green/blue) on a representative day for each. Screenshots are the visual baseline for "did we preserve the signature gradient" at merge time. Also capture: Home tab full scroll, Campaigns table at default sort, Cohorts comparison panel, Health Score panel, Operator console main view. Save under `.planning/dashboard-ux-overhaul-2026-05-28/before/`.

**Single feature branch** `dashboard-ux-overhaul-2026-05-28`. No incremental deploys. Merge to main when:
- All STAYS components verified byte-identical in their data outputs (snapshot tests on data, visual diff acceptable)
- All MOVES components reachable and functionally equivalent
- All NEW components have tests
- TypeScript + Vitest + ESLint pre-push gates green
- User Manual + Architecture Doc updated in the same merge (see `feedback_keep_user_manual_current.md`)
- Manual end-to-end pass: every tab loads, every URL filter param works, every drilldown opens, theme toggle persists, ⌘K opens, Focus Mode works

**Phasing of WORK (not deploys)** during the branch:

1. **Foundation week (1)** — design tokens, fonts, primitives in `components/ui/`, sidebar shell, theme toggle, ⌘K NL upgrade. No tab visible yet.
2. **TodayLive + Home tab (2)** — most visible surface; defines the visual language for everything else.
3. **Charts upgrade (½ of week 2)** — Recharts v3 + shadcn wrappers.
4. **Campaigns + Products tabs (3)** — largest by component complexity (CampaignsTable split included).
5. **Insights + Cohorts + Health + Goals tabs (early week 4)**.
6. **Operator tab visual upgrade (½ of week 4)** — chrome-only.
7. **Polish, RTL audit, theme audit, accessibility audit, docs (rest of week 4)**.

Detailed file-by-file plan is generated by the `superpowers:writing-plans` skill that runs after this spec is approved.

## Files Affected (high-level inventory)

**New files:**
- `dashboard-web/src/components/ui/{Card,Button,Badge,Tooltip,Dialog,Sheet,Tabs,Input,Select,Switch,Toggle,Sparkline}.tsx`
- `dashboard-web/src/components/ui/chart/{ChartContainer,ChartTooltip,ChartLegend}.tsx`
- `dashboard-web/src/components/Sidebar.tsx`
- `dashboard-web/src/components/TabHeader.tsx`
- `dashboard-web/src/components/FocusMode.tsx`
- `dashboard-web/src/components/ThemeProvider.tsx` + `useTheme` hook
- `dashboard-web/src/components/QuadrantScatter.tsx` (new Insights card)
- `dashboard-web/src/components/CohortHeatmap.tsx` (new Cohorts card)
- `dashboard-web/src/components/HealthScoreHistogram.tsx` (new Health card)
- `dashboard-web/src/components/GoalsTimeline.tsx` (new Goals tab content)
- `dashboard-web/src/app/goals/page.tsx` (NEW tab route)
- `dashboard-web/src/app/products/page.tsx` (PROMOTED tab route)
- `dashboard-web/src/lib/theme.ts` (theme persistence helpers)

**Heavily modified files:**
- `tailwind.config.ts` — OKLCH token migration, new font chain, dark mode preset
- `dashboard-web/src/app/globals.css` — theme variables, `tabular-nums` font-family swap, focus-mode utilities
- `dashboard-web/src/app/layout.tsx` — load Heebo + Rubik + Geist Mono, theme `<script>` for no-FOUC
- `dashboard-web/src/components/Dashboard.tsx` (747L) — top-level: replaces tab nav with sidebar, wraps content in View Transition root
- `dashboard-web/src/components/TodayLive.tsx` (667L) — narrative line added; existing structure preserved; tokens migrated
- `dashboard-web/src/components/CampaignsTable.tsx` (2456L) — structural split into shell + extracted hooks (cohort + cannibalization), tokens migrated, sparkline column added
- `dashboard-web/src/components/CampaignsTableRow.tsx` (857L) — token migration, sparkline cell
- `dashboard-web/src/components/CampaignDrawer.tsx` (1413L) — token migration, view-transition open animation
- `dashboard-web/src/components/Filters.tsx` — restyled as inline `<TabHeader />` child
- `dashboard-web/src/components/CommandPalette.tsx` (650L) — NL query support + theme toggle entries
- `dashboard-web/src/components/BillingSettings.tsx` (1171L) — chrome refresh only (no logic)
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
  - `feedback_monthly_goal_is_global.md` — Goals tab carve-out
  - `feedback_keep_user_manual_current.md` — doc gate
  - `project_script_roas_dashboard.md` — architecture context
  - `project_audit_2026_05_28_data_consistency.md` — recent data-correctness work to not undo
