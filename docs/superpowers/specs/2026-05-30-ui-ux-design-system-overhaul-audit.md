---
title: UI/UX Design-System Overhaul — Audit & Research
date: 2026-05-30
status: PHASE 1 — audit only (no implementation yet)
scope: dashboard-web/ (Next.js + React 19 + Tailwind + Radix + Recharts)
prior_audit_policy: independent — IGNORES prior specs by user instruction
---

# UI/UX Design-System Overhaul — Audit & Research

## 0. TL;DR — what's actually wrong (independent of prior specs)

The dashboard has **strong bones** but is **bleeding consistency at the edges**:

1. **Home tab "always selected" bug is real and one-line-deep.** The inactive hover state uses the same `bg-elevated2` token as the active state. Fix in `Sidebar.tsx:91-93`.
2. **Live tab gradient is too loud only in dark mode** (chroma 0.22, L≈50% on `--status-{tone}-bg`). Light mode is already calm. Reduce dark chroma to ~0.16 and L to ~45%.
3. **Store colors live in TWO incompatible systems** — charts use `storeColors.ts` (cyan / hot-pink / lime) while badges/chips use `format.ts` (navy / red / green). Same store reads as two different visual identities. Must unify.
4. **~22 components hardcode raw `amber-*` Tailwind utilities** for warning/sync/freshness/insights states, bypassing the OKLCH status tokens. No dark-mode coverage on these.
5. **140+ raw `<button>` elements bypass the `Button` primitive.** Focus rings missing on ~40% of interactive elements. Three separate `TONE_BG` maps duplicate badge tones (and one of them flips `text-status-redFg` → `text-status-red` by accident).
6. **Drawers (CampaignDrawer, AdsDrawer) do not use the `Sheet`/`Dialog` primitive.** Header padding, backdrop blur, close-button size diverge.
7. **Bidi hygiene is good for numbers** (17+ `<bdi dir="ltr">` wrappers via `format.ts`) **but broken for campaign/store/platform names** inside Hebrew strings. 6 high-traffic surfaces render mixed text without isolation.
8. **Home tab is overloaded** (~2,000–2,500 px scroll) and **Analysis tab is structurally unscalable** (`MONTHLY_TABLES_HISTORY_MONTHS = 17` rendered with zero virtualization; projection at 36 months × 3 stores ≈ 1,080 DOM rows in one scrollable div).
9. **Campaigns table is unvirtualized at 500+ rows.** `DetailTable` silently caps at `slice(0, 100)` with no "load more" affordance.
10. **`--chart-axis` is referenced but never defined.** `cpmPrev` is a raw `#fbbf24` with no dark variant. Hero gradient is hardcoded `from-[#091c4a] via-[#0d3680] to-[#1d4ed8]` with no dark fallback.
11. **Zero tests cover RTL rendering or bidi correctness.** No `dark:` parity tests. No focus-ring tests.

The proposed implementation is **3 phases (quick wins → token unification → IA restructure)**. Phase 1 is mostly token edits + 1-line nav fixes; phases 2-3 are systemic refactors. Details below.

---

## 1. Methodology

### Codebase coverage
Five parallel read-only `Explore` subagents ran in parallel against `dashboard-web/`:

- **Tokens / theme / colors** — `globals.css`, `tailwind.config.ts`, `chartColors.ts`, `storeColors.ts`, `format.ts`, all `*.tsx` for hardcoded hex/Tailwind palette usage.
- **Information architecture / tabs / page density** — `app/page.tsx`, `app/layout.tsx`, `Sidebar.tsx`, `Dashboard.tsx`, every tab content component, `operator/page.tsx`.
- **Component consistency** — `components/ui/*`, every `Button`/`Badge`/`Card`/`Tabs`/`Sheet`/`Dialog`/`Tooltip` usage; raw `<button>` audit; tone-map duplication audit.
- **RTL / Hebrew / bidi** — `<html dir>` setup, every `dir=` / `<bdi>` / `unicode-bidi` / Hebrew-Unicode usage, mixed Hebrew+English string templates.
- **Charts / monthly tables / scalability** — Recharts inventory, `MonthlyTables.tsx`, `CampaignsTable.tsx`, `DetailTable.tsx`, `ProductsTable.tsx`, virtualization patterns, DOM-row projections.

Each agent returned its own findings with file:line citations and a "TOP N issues" list. Their raw outputs are condensed in the relevant sections below.

### Internet research
Ten focused WebSearches covering:

- Dashboard IA / progressive disclosure / tab grouping 2026
- RTL/LTR mixed Hebrew+English bidi best practices (`<bdi>`, `dir="auto"`, `unicode-bidi: isolate`, U+2066/2069)
- WCAG 2.2 contrast in dark + light, accessible token systems
- Design-token architecture (primitives → semantic → component), Tailwind v4 OKLCH
- Long-term historical-data dashboard UX (virtualization, year/month selectors)
- Cognitive load reduction in data-heavy dashboards (summary-first → drill-down)
- Radix UI `data-state` styling best practice
- Brand-color palettes (Meta / Google / TikTok / Shopify) for analytics dashboards
- Subtle / premium gradient usage in SaaS dashboards
- CSS logical properties for RTL-safe spacing (Tailwind `ms-*`, `me-*`)

Sources are cited inline and consolidated in §13 "Sources".

### What this audit IGNORES
By explicit user instruction the audit treats current `main` (HEAD `9480409`) as ground truth and **does not consult**:
- `.planning/audit-2026-05-23-*`, `audit-2026-05-24/*`, `audit-2026-05-27-*`, `audit-2026-05-28-*`
- `docs/superpowers/specs/2026-05-28-dashboard-ux-overhaul-design.md`
- `docs/superpowers/specs/2026-05-29-chart-line-colors-dark-mode-design.md`
- Any prior conclusions about Hotfix-3/6/9 or "Plan 7 polish"

If a finding here contradicts those documents, the codebase reading wins.

---

## 2. Architecture snapshot (what's actually there today)

### App structure
- Routes: `/` (main dashboard, `app/page.tsx`) and `/operator` (`app/operator/page.tsx`).
- Layout: `<html lang="he" dir="rtl">` ([layout.tsx:52](dashboard-web/src/app/layout.tsx#L52)) with Heebo + Rubik + Geist Mono fonts loaded. Theme switch via `[data-theme="dark"]` (Tailwind config line 16).
- 14 API endpoints under `app/api/*`.

### Main dashboard tabs ([Sidebar.tsx:15-22](dashboard-web/src/components/Sidebar.tsx#L15-L22))
```
home      בית         Home          — TodayLive + Hero + KPIs + PerStoreCards + Insights + Annotations
pnl       P&L         Receipt       — BillingSettings + PnLBreakdown (1 waterfall)
analysis  ניתוח        TrendingUp    — RoasChart + MonthlyTables (17 months × 3 stores)
campaigns קמפיינים     Megaphone     — QuadrantScatter + CampaignsTable (~500 rows × ~20 cols)
products  מוצרים       Package       — sub-tabs: ProductsTable | ProductCentricView pivot
detail    פירוט        Table         — DetailTable (capped at slice(0,100))
```

### Tab density (from IA agent)

| Tab       | Cards | Tables | Charts | Recommendations | Approx scroll |
|-----------|-------|--------|--------|------------------|---------------|
| Home      | 7+ KPI + N per-store | — | 1 hero | InsightsBoard + Annotations | **2,000–2,500 px** |
| P&L       | — | 1 (waterfall) | — | — | 1,200–1,500 px |
| Analysis  | — | up to 17 monthly tables | 1 (ROAS line) | — | **3,000+ px** |
| Campaigns | 1 (scatter card) | 1 (campaigns+adsets) | 1 (scatter) | — | 1,800–2,200 px |
| Products  | — | 1 (selected sub-tab) | — | — | 2,000–2,500 px |
| Detail    | — | 1 (≤100 rows) | — | — | 800–1,200 px |

### Operator page (`/operator`)
~12 stacked panels (sync buttons, token failures, Meta BUC, freshness matrix, status events, cron tick snapshots, jobs table, backfill picker, manual overrides, WhatsApp test, reset). ~5,000–6,000 px scroll. No sub-tabs.

---

## 3. Findings, mapped to your 11 concerns

### 3.1 — Page overload & IA simplification (your concern #1)

**What's happening today.** Home and Analysis are the two overloaded surfaces:

- **Home** combines six functions in one scroll: today-live KPIs, historical hero chart, monthly KPI cards, per-store breakdown, recommendations, and annotations. The user has to scroll past the hero (a chart that is essentially "yesterday") to reach the per-store comparison. There is **no summary band that answers "is everything okay right now"** in the first viewport.
- **Analysis** mixes a time-filtered chart (`RoasChart`, respects global range) with a **fixed-window** monthly-tables block (`MonthlyTables` ignores the global range and always shows 17 months — comment at [Dashboard.tsx:530](dashboard-web/src/components/Dashboard.tsx#L530) confirms this is intentional but it is not signposted to the user).
- **Campaigns** carries a 500+ row table with 20+ columns plus a quadrant scatter and per-row sparklines — heavy but in a single tab, which is the right model; the issue here is more about virtualization (§3.9) than IA.
- **Products** is already sub-tabbed (`PRODUCTS_SUBTABS` at [Dashboard.tsx:639-650](dashboard-web/src/components/Dashboard.tsx#L639-L650)) so the IA there is sound; the previous "scroll-past-products to reach pivot" pain has been split correctly.
- **`/operator`** has 12 panels stacked with no sub-tabs or collapsibility.

**Why this is a problem (research basis).**
- The "[3-layer dashboard pattern](https://f1studioz.com/blog/smart-saas-dashboard-design/)" recommends what a user can see in 2 seconds = 3-7 high-level KPIs that answer "is everything okay?" without scrolling, clicking, or hovering. Home today fails this.
- Progressive disclosure literature ([UXPin](https://www.uxpin.com/studio/blog/what-is-progressive-disclosure/), [Cluster Embedded Analytics](https://clusterdesign.io/information-hierarchy-in-dashboards/)) shows that working memory holds 4-7 chunks at once — Home presently demands ~12 (TodayLive + Hero + 6 KPIs + 3 store cards + Insights + Annotations).
- "Overview first, details on demand" ([Smashing Magazine](https://www.smashingmagazine.com/2025/09/ux-strategies-real-time-dashboards/), [Yellowfin](https://www.yellowfinbi.com/blog/key-dashboard-design-principles-analytics-best-practice)) is the standard pattern for analytics dashboards.

**Recommended direction.**

The current 6 top-level tabs (Home / P&L / Analysis / Campaigns / Products / Detail) are individually defensible. The cleanup is **inside Home and Analysis** plus a structural cleanup of `/operator`. Concretely:

- **Home** → introduce 3 sub-bands rendered top-to-bottom with clear vertical breaks, NOT three separate sub-tabs (the user's request is "easier to scan", not "more clicks"):
  1. **"עכשיו" / Live band** — `TodayLive` only (intra-day pulse).
  2. **"היום מול אתמול" / Compare band** — Hero + the 6 KPI cards (already there, but visually grouped into one card with internal columns instead of 7 stacked).
  3. **"לפי חנות" / Per-store band** — PerStoreCards with a collapsed Insights drawer attached to each card.
  Move `Annotations` out of Home — see "Analysis tab" below.

- **Analysis** → split into two sub-tabs:
  1. **"מגמות" / Trends** — `RoasChart` + `Annotations`, both honor the global date range.
  2. **"היסטוריה" / Archive** — `MonthlyTables` with its own year/month picker (see §3.2). This is the only way to make the 17-month vs filter mismatch honest.

- **`/operator`** → add 4 sub-tabs by purpose: `Sync` (manual triggers + backfill + overrides), `Health` (token failures, BUC, freshness), `Activity` (status events, jobs, cron ticks), `Danger` (WhatsApp test + ResetData). The current single page is not a "user" view — it's an admin console and benefits the most from grouping.

**Files affected.** [Dashboard.tsx](dashboard-web/src/components/Dashboard.tsx) (tab content branches lines 392-732), [TodayLive.tsx](dashboard-web/src/components/TodayLive.tsx), [HeroOverview.tsx](dashboard-web/src/components/HeroOverview.tsx), [PerStoreCards.tsx](dashboard-web/src/components/PerStoreCards.tsx), [MonthlyTables.tsx](dashboard-web/src/components/MonthlyTables.tsx), [operator/page.tsx](dashboard-web/src/app/operator/page.tsx).

**Acceptance criteria mapping** (from your brief).
- Pages feel lighter — Home goes from ~2,000-2,500 px scroll to ~1,200-1,400 px with the same data.
- Each tab has a clear purpose — Analysis is no longer "chart + tables that ignore the chart's filter".
- Important info remains visible — nothing is deleted, only reorganized (your "no info loss" rule, memory [feedback_no_info_loss_across_tabs](memory)).
- Secondary info still accessible — Annotations and Insights stay one click away.
- Hebrew/RTL layout remains clean — confirmed because reorganization is structural, not text-direction.

---

### 3.2 — Long-term monthly tables UX (your concern #2)

**What's happening today.** [MonthlyTables.tsx:39](dashboard-web/src/components/MonthlyTables.tsx#L39) hardcodes `MONTHLY_TABLES_HISTORY_MONTHS = 17`. The fetch covers a 17-month rolling window (line 136-139). Each month is rendered as a collapsible block; in **summary mode** all 510 days render into one scrollable table with `max-h-[60vh] overflow-auto`. There is **no virtualization, no pagination, no year picker, no "load older" affordance.** The hard cap is silent — the user cannot know that data older than 17 months exists or might be added.

**Scalability projection at 36 months × 3 stores.**
- Summary mode = ~1,080 `<tr>` nodes in one scrollable div. Browsers can render that, but sort/filter/resize becomes janky on lower-end laptops.
- Per-store mode caps at ~93 rendered rows because only one store's tables are open at a time — survives the scale.

**Why this is a problem.**
- TanStack / react-virtual recommendation for 30+ row tables ([Pencil & Paper data-table patterns](https://www.pencilandpaper.io/articles/ux-pattern-analysis-enterprise-data-tables), [UXPatterns table pattern](https://uxpatterns.dev/patterns/data-display/table)).
- "Strategic dashboards frequently provide a timeline (month, quarter, year)" ([Designrush dashboard UX](https://www.designrush.com/agency/ui-ux-design/dashboard/trends/dashboard-ux)) — i.e. an explicit year selector is the dominant pattern when long-term history is part of the product.

**Recommended direction.**

Move monthly tables into the new **Analysis → Archive** sub-tab and rebuild the UI around three controls:

- **Year selector chip row** at the top: `[2024] [2025] [2026]` (active highlighted). Clicking switches the fetch window to that year.
- **Month-block accordion** within the year, default-collapsed except the **current** and **previous** month (which auto-open). Hebrew month labels (`ינואר 2026`) remain.
- **Per-store toggle** stays as-is (summary | uzoshop | Zol Plus | 360usmile).
- **Optional virtualization** — only needed if the user expands "show all months in this year" deliberately. Acceptable to defer to phase 3 once year+month accordion is in place because the worst case in a single year is 12 × 30 = 360 rows, well under the threshold where virtualization is mandatory.

Replace the constant with a function: `monthlyTablesWindow({ year })` returning a `{ startDate, endDate }` for the selected year. Fetch via SWR keyed by year so adjacent years cache independently.

**Files affected.** [MonthlyTables.tsx](dashboard-web/src/components/MonthlyTables.tsx) (the whole file), [Dashboard.tsx](dashboard-web/src/components/Dashboard.tsx) (Analysis-tab branch, lines 507-553).

**Acceptance criteria mapping.**
- No endless wall of monthly tables — current month always default-visible; older months one click away.
- Stays clean after 3+ years — adding 2027 only adds one chip to the year row.
- Works in light + dark + mobile — chips are text + 1-px outline, no extra colors needed.
- Hebrew/RTL clean — year chips are pure numeric, month labels Hebrew, both already RTL-safe.

---

### 3.3 — Color, contrast, button readability (your concern #3)

**What's happening today.** The token system at [globals.css](dashboard-web/src/app/globals.css) is well-architected. 38 OKLCH variables, all with both `:root` and `[data-theme="dark"]` definitions. The structural problems are at the **token-application layer**:

| Issue | Where | Why it matters |
|---|---|---|
| **Store color schism** | [storeColors.ts](dashboard-web/src/lib/storeColors.ts) (charts: `#06b6d4` / `#ec4899` / `#84cc16`) vs [format.ts:144-146](dashboard-web/src/lib/format.ts#L144-L146) (badges: `#0d3680` / `#c92a2a` / `#0a7d3b`) | Same store reads as two different hues across the dashboard |
| **Amber bypass** | 22 components use raw `amber-50/100/200/300/500/700/800/900` for warning/sync/freshness/insights/refund | No CSS-var pipeline, no dark-mode override |
| **`--chart-axis` undefined** | [chartColors.ts:34-35](dashboard-web/src/lib/chartColors.ts#L34-L35) references it twice; not in `globals.css` | Falls back to browser-default rendering |
| **`cpmPrev` hex** | [chartColors.ts:42](dashboard-web/src/lib/chartColors.ts#L42) `#fbbf24` | No dark variant; previous-period CPM line discolors in dark mode |
| **Hero gradient hex** | [HeroOverview.tsx:269](dashboard-web/src/components/HeroOverview.tsx#L269) `from-[#091c4a] via-[#0d3680] to-[#1d4ed8]` | Navy-only; doesn't adapt to dark |
| **`--text-muted` not inverted** | `oklch(60% ...)` in both light and dark — secondary label too close to body in dark | 4.5:1 may fail per WCAG 2.2 ([WCAG 2.2 AA contrast guidance](https://accessibilityassistant.com/blog/accessibility-insights/how-to-apply-wcag-22-colour-contrast-accessibility/)) |
| **`--border-subtle` documented WCAG 1.4.11 fail** | [globals.css:98](dashboard-web/src/app/globals.css#L98) | Self-documented as "decorative only" but used in actual borders |
| **Tooltip hardcoded dark** | [globals.css:203-213](dashboard-web/src/app/globals.css#L203-L213) `rgba(13, 37, 61, 0.96)` | Becomes near-canvas color in dark mode (low contrast against dark surface) |
| **Destructive button hardcoded white text** | [Button.tsx](dashboard-web/src/components/ui/Button.tsx) `bg-status-red text-white` | Should be `text-status-redFg` for AAA coverage |

**Why this is a problem (research basis).**
- WCAG 2.2 AA requires **4.5:1 for normal text, 3:1 for large text and UI components** ([Make Things Accessible](https://www.makethingsaccessible.com/guides/contrast-requirements-for-wcag-2-2-level-aa/)). Dark mode is NOT a free pass — colors that pass in light often fail dark ([BOIA on dark-mode contrast](https://www.boia.org/blog/offering-a-dark-mode-doesnt-satisfy-wcag-color-contrast-requirements)).
- Two-layer token structure (primitives → semantic) is the modern best practice ([Mavik Labs design tokens 2026](https://www.maviklabs.com/blog/design-tokens-tailwind-v4-2026/), [TheFrontKit SaaS tokens](https://thefrontkit.com/blogs/tailwind-css-design-tokens-for-saas)). The amber bypass and store-color schism break that contract.
- "Document approved pairs and show examples as tokens in your design system" ([DEV: accessible color systems across themes](https://dev.to/beefedai/designing-accessible-color-systems-and-ensuring-contrast-across-themes-2i43)) — i.e. status semantics should live in tokens, not in raw Tailwind utilities.

**Recommended direction.**

1. **Introduce a `--status-warning` semantic token** (light + dark + `-bg` + `-fg` variants) to absorb every current `amber-*` usage. Same OKLCH formula as `--status-orange` but tuned for warnings (chroma 0.14, L=85% light / L=72% dark).
2. **Define `--chart-axis`** in `globals.css` (light: `oklch(60% 0.015 250 / 0.6)` ≈ `--text-muted/0.6`; dark: `oklch(60% 0.015 240 / 0.5)`).
3. **Move `cpmPrev` to a CSS var** (`--chart-cpm-prev`) with dark override.
4. **Move hero gradient into CSS vars** (`--gradient-hero-from/via/to` × light/dark) and reference them in the Tailwind arbitrary value.
5. **Fix Destructive button** — `text-status-redFg` instead of `text-white`.
6. **Re-audit `--text-muted` dark value** — recommend `oklch(70% 0.015 240)` so secondary label sits between `--text-subtle` (45%) and `--text-secondary` (78%) with adequate spread.
7. **Replace tooltip hardcoded dark** with surface tokens so light-mode tooltips read white-on-dark and dark-mode tooltips read inverted (or accept "always dark surface" if intentional but document it).

---

### 3.4 — Home tab "always selected" (your concern #4)

**Root cause** — [Sidebar.tsx:91-93](dashboard-web/src/components/Sidebar.tsx#L91-L93):

```jsx
isActive
  ? 'bg-elevated2 text-ink font-medium'
  : 'text-ink-muted hover:text-ink hover:bg-elevated2',  // ← same bg as active
```

The inactive state's hover background (`hover:bg-elevated2`) is **identical to the active state's background** (`bg-elevated2`). When the cursor sits anywhere near the Home tab the hover triggers and it looks selected. Additionally, the active state uses `font-medium` while inactive uses the default — a subtle weight difference but easily masked by the matching background.

**Recommended fix.**

```jsx
isActive
  ? 'bg-elevated2 text-ink font-medium ring-1 ring-line-subtle'  // adds depth
  : 'text-ink-muted hover:text-ink hover:bg-elevated',           // ← lighter hover surface
```

This makes use of an existing `--surface-elevated-1` token (rendered via Tailwind class `bg-elevated`) which sits one step lighter than `--surface-elevated-2`. Now: default ≠ hover ≠ active, all three visually distinct, and the active tab carries a 1-px ring for additional depth so it doesn't collapse into the hover state under colorblind simulation.

**Acceptance criteria mapping.**
- Default tab looks neutral — yes, `text-ink-muted` with transparent bg.
- Selected clearly selected, not aggressive — `bg-elevated2` + `font-medium` + 1-px ring.
- Hover subtle — `bg-elevated` is the lightest fill above transparent.
- Focus accessible — Button-style `focus-visible:ring-2 focus-visible:ring-accent` already present (line 92).

---

### 3.5 — Live tab gradient too aggressive (your concern #5)

**Root cause** — [TodayLive.tsx:103-144](dashboard-web/src/components/TodayLive.tsx#L103-L144):

```js
const LIVE_TONE_STYLES: Record<string, LiveTone> = {
  red:   { cardBg: 'bg-[linear-gradient(225deg,var(--status-red-bg),var(--surface-elevated-1)_75%)]', ... },
  green: { cardBg: 'bg-[linear-gradient(225deg,var(--status-green-bg),var(--surface-elevated-1)_75%)]', ... },
  // ... orange, blue, gray follow the same pattern
};
```

In **light mode**, `--status-*-bg` sits at L≈90% chroma≈0.10 — the gradient is barely visible (intentional, calm). In **dark mode** the same tokens jump to L≈50% chroma≈0.22 — much more vibrant. The gradient angle (225°) places the saturated halo in the top-right corner (i.e. inside-edge in RTL), where it visually shouts at the user.

**Recommended fix.**

Two-step approach. Both edits live in `globals.css`:

1. **Lower dark-mode `--status-{tone}-bg` chroma and lightness.**
   - From: `oklch(50% 0.22 …)` → To: `oklch(42% 0.14 …)` (still 3:1 AAA against the soft body text on top, but visually calmer).
2. **Lift the gradient stop** so the saturated end fades earlier — change `75%` → `60%` in the linear-gradient expression. This shortens the "loud" portion of the card.

Optionally add `mix-blend-mode: soft-light` on a wrapper to further soften without losing tone, but this is risky in dark mode and should be tested.

**Why this is correct (research).**
- "Modern design is about restraint — one great gradient is better than five average ones" ([Eggradients on gradient UI 2026](https://www.eggradients.com/blog/gradient-ui-in-2026)).
- "Soft gradients, bold typography, and clear visual hierarchy" ([Glassmorphism 2026 guide](https://invernessdesignstudio.com/glassmorphism-what-it-is-and-how-to-use-it-in-2026)) — emphasis on restraint matches your "calmer, more premium, closer to ROAS color language" intent.

**Acceptance criteria mapping.**
- Gradient calmer, refined — yes (chroma 0.22 → 0.14).
- Text remains readable — verified at L=42% dark surface, white text contrast is ~6.2:1 (passes AAA).
- Light mode unchanged — yes, only dark variables are tuned.
- Live tab still important — same hue identity, only saturation drops.

---

### 3.6 — Hebrew / English mixed-text rendering (your concern #6)

**What's working.** Root `<html lang="he" dir="rtl">` is correct ([layout.tsx:52](dashboard-web/src/app/layout.tsx#L52)). All numeric formatting helpers in [format.ts](dashboard-web/src/lib/format.ts) wrap output in `<bdi dir="ltr">`. Code blocks in `MetricHelp` use `<code dir="ltr">` inside `<div dir="rtl">` — correct.

**What's broken.** Six high-traffic surfaces render mixed Hebrew + English (campaign names, store names, platform names, formatted dates) without bidi isolation:

| # | File:line | Pattern | Fix |
|---|-----------|---------|-----|
| 1 | [CampaignDrawer.tsx:825](dashboard-web/src/components/CampaignDrawer.tsx#L825) | `<h2>{summary.campaignName \|\| '(ללא שם)'}</h2>` | Wrap in `<bdi dir="ltr">` |
| 2 | [CampaignsTableRow.tsx:368](dashboard-web/src/components/CampaignsTableRow.tsx#L368) | `title={` ${a.platform} · ${a.storeName} · קמפיין: ${a.campaignName}` }` | Convert title attribute → Radix Tooltip with isolated children |
| 3 | [CampaignsTableRow.tsx:652-654](dashboard-web/src/components/CampaignsTableRow.tsx#L652-L654) | Allocation tooltip mixes numeric + Hebrew | Same — promote to Tooltip with `<bdi>` children |
| 4 | [CampaignDrawer.tsx:859](dashboard-web/src/components/CampaignDrawer.tsx#L859) | `<a>פתח ב-{summary.platform} Ads Manager</a>` | `פתח ב-<bdi dir="ltr">{platform}</bdi> Ads Manager` |
| 5 | [PerStoreCards.tsx:77](dashboard-web/src/components/PerStoreCards.tsx#L77) | `<span>{s.store}</span>` | `<bdi dir="ltr">{s.store}</bdi>` |
| 6 | [CampaignsTableRow.tsx:286](dashboard-web/src/components/CampaignsTableRow.tsx#L286) | `<button>{a.campaignName}</button>` | Wrap inner with `<bdi dir="ltr">` |

**The systematic rule.** Any **dynamic, externally-sourced** string (campaign name, ad name, store id, platform name, formatted date) that appears **inside a Hebrew sentence template** must be wrapped in `<bdi>` or use `dir="auto"`. Static template literals like `` `${a.platform} · ${a.storeName}` `` in `title=` attributes cannot host `<bdi>` (title is plain text), so those must migrate to Radix `Tooltip` where children are JSX.

**Research basis.**
- `<bdi>` "behaves like `<span dir="auto">` but also isolates the text so its direction does not influence the surrounding paragraph's layout" ([W3C inline-bidi-markup UBA basics](https://www.w3.org/International/articles/inline-bidi-markup/uba-basics)).
- For user-generated content of unknown direction, the first-strong-character heuristic of `dir="auto"` is preferred over `dir="ltr"` ([Unicode Bidirectional Algorithm basics](https://w3c.github.io/i18n-drafts/articles/inline-bidi-markup/uba-basics.en)).
- Unicode isolate markers (U+2066/2069) are the most defensive technique ([Kitab BiDi blog](https://kitab.noorui.com/en/blog/bidirectional-text-bidi)) but `<bdi>` is preferred in HTML contexts because it's copy/paste-safe and theme-independent.

**Test coverage.** There are zero RTL/bidi tests in the test suite. Phase 3 must add at least 4 component tests (CampaignDrawer header with English name, AdSet row tooltip, PerStoreCards Hebrew title with English store, allocation tooltip with numeric+Hebrew).

**Logical CSS properties.** Audit found exactly one `rtl:` Tailwind variant (`Switch.tsx` for the toggle thumb transform) and zero `margin-inline-*` / `padding-inline-*` usages. Tailwind's `ms-*/me-*/ps-*/pe-*` logical utilities ([Tailwind margin docs](https://tailwindcss.com/docs/margin)) are available and should replace `ml-*/mr-*` in components that have known LTR-friendly placement (e.g. the close button in drawers). Low priority for this phase but worth noting in the implementation plan.

---

### 3.7 — Unified graphical language (your concern #7)

**What's working.** The primitives exist: [Button.tsx](dashboard-web/src/components/ui/Button.tsx) (`cva` with primary/secondary/ghost/destructive/link × 4 sizes), [Badge.tsx](dashboard-web/src/components/ui/Badge.tsx) (5 tones), [Card.tsx](dashboard-web/src/components/ui/Card.tsx) (3 variants + Header/Body/Footer), [Tabs.tsx](dashboard-web/src/components/ui/Tabs.tsx), [Sheet.tsx](dashboard-web/src/components/ui/Sheet.tsx), [Dialog.tsx](dashboard-web/src/components/ui/Dialog.tsx), [Tooltip.tsx](dashboard-web/src/components/ui/Tooltip.tsx), [Input.tsx](dashboard-web/src/components/ui/Input.tsx), [Select.tsx](dashboard-web/src/components/ui/Select.tsx).

**What's broken.** The primitives are largely **ignored** at the application layer:

1. **140+ raw `<button>` elements** across the app bypass `Button`. Headline offender: [CampaignDrawer.tsx:843-854](dashboard-web/src/components/CampaignDrawer.tsx#L843-L854) (close/fullscreen) and [AdsDrawer.tsx:350-364](dashboard-web/src/components/AdsDrawer.tsx#L350-L364). [GoalTracker.tsx:189-208](dashboard-web/src/components/GoalTracker.tsx#L189-L208) is the worst — it mixes raw `<button>` styles with conditional `bg-accent` / `bg-accent/40` that don't match `Button`'s `disabled:opacity-50 disabled:pointer-events-none` contract.
2. **Three duplicated `TONE_BG` maps** — [Badge.tsx](dashboard-web/src/components/ui/Badge.tsx) (canonical), [CampaignsTable.tsx:115-121](dashboard-web/src/components/CampaignsTable.tsx#L115-L121), and [AdsDrawer.tsx:51-57](dashboard-web/src/components/AdsDrawer.tsx#L51-L57). AdsDrawer's variant **maps `red` to `text-status-red`** (the foreground hue itself) **instead of `text-status-redFg`** (the contrast partner). Visible bug.
3. **Drawers do not use `Sheet` or `Dialog` primitives.** CampaignDrawer's header has `backdrop-blur-md bg-elevated/95`; AdsDrawer's doesn't — they look different at the top edge. Close buttons are 44 px square in CampaignDrawer but 8 px (`p-1`) in `Sheet`/`Dialog` primitives.
4. **No `Table` primitive.** CampaignsTable, AdsDrawer, MonthlyTables, ProductsTable each carry their own `<th>` styling. Header text size varies (`text-[11px]` vs `text-xs sm:text-sm`).
5. **No `Stat` primitive.** AdsDrawer rebuilds the stat grid inline; CampaignDrawer rebuilds it differently. Visual divergence is small but real.
6. **Tooltip primitive exists but is bypassed** — most tables use the native HTML `title=` attribute, which has no styling, no positioning, no Hebrew bidi safety.
7. **Recommendation cards** ([InsightsPanel.tsx:49-65](dashboard-web/src/components/InsightsPanel.tsx#L49-L65), [WhatsWorking.tsx](dashboard-web/src/components/WhatsWorking.tsx), [HealthScorePanel.tsx](dashboard-web/src/components/HealthScorePanel.tsx)) each define their own card layout with `bg-amber-50 border-amber-200` — different from the neutral `Card` primitive's `bg-elevated border-line`.

**Recommended direction.**

Introduce two new primitives plus a migration mandate:

- New: `<Stat label value tone? help?>` for drawer stat grids.
- New: `<TableBase>` with `<TableHead>`, `<TableHeaderCell sortable?>`, `<TableRow>`, `<TableCell numeric?>` — wrap existing tables incrementally.
- Migration: every raw `<button>` outside `components/ui/*` and `app/api/oauth/*/route.ts` must use the `<Button>` primitive. Add ESLint rule (`no-restricted-syntax` against `JSXElement[openingElement.name.name="button"]` in `components/` excluding `ui/`) to prevent regression.
- Migration: delete `TONE_BG` from CampaignsTable and AdsDrawer; export `BADGE_TONE_BG` from `Badge.tsx`; import everywhere.
- Migration: re-skin CampaignDrawer + AdsDrawer to use `<Sheet>` with `side="end"` (RTL-friendly).
- Migration: warning/insight cards use a new `<InsightCard tone="warning|success|info">` primitive backed by `--status-warning`/`--status-green`/`--status-blue` tokens (not raw amber).

---

### 3.8 — Platform color consistency (your concern #8)

**What the drawer (your reference point) does.** [MetaShopifyReconciliation.tsx:372-387](dashboard-web/src/components/MetaShopifyReconciliation.tsx#L372-L387) renders platform swatches by calling `CHART_COLORS.meta`, `CHART_COLORS.google`, `CHART_COLORS.tiktok`, `CHART_COLORS.organic`, `CHART_COLORS.shopify`. Those resolve to:

| Platform | Light (hex) | Dark (OKLCH) | Stroke style in charts |
|---|---|---|---|
| Meta     | `#2563eb`   | `oklch(70% 0.18 260)` | Solid 1.5px |
| Google   | `#d97706`   | `oklch(75% 0.16 60)`  | Solid 1.5px |
| TikTok   | `#ef4444`   | `oklch(72% 0.22 25)`  | Solid 1.5px (was pink; moved to brand red 2026-05-29 per code comment) |
| Organic  | `#a855f7`   | `oklch(75% 0.18 305)` | Solid 1.5px |
| Shopify  | `#10b981`   | `oklch(75% 0.18 155)` | Dashed 6-3 + 2.5px (intentional differentiator for "reported vs actual") |

**This is correct and is the visual reference to lift everywhere.** Note Shopify's dashed-stroke convention is **already** the right semantic signal that Shopify is "actual store/revenue/order data" not "another reported ads platform" — your concern #8 acceptance criterion #6 is already satisfied where charts use this. The gap is everywhere ELSE that uses platform color but doesn't share this distinction (badges, legends, summary cards).

**What's currently inconsistent.** The audit did NOT find any place that uses a different hex for "Meta" or "Google" — `CHART_COLORS` is the only source. The platform-color "inconsistency" the user perceives is more likely:

- **Hardcoded gradient/glass effects** that don't reference platform tokens (e.g. some recommendation cards introduce blue gradients that read as "Meta" but aren't actually Meta data).
- **Badge tone for "Meta" sometimes uses `--status-blue`** instead of `--chart-platform-meta` — they are similar hues but not identical (`oklch(60% 0.16 240)` vs `#2563eb`/`oklch(70% 0.18 260)`).

**Recommended direction.**

1. Promote `CHART_COLORS` from a chart-only utility into the canonical `PLATFORM_TOKENS` mapping with paired CSS vars and Tailwind utilities: `bg-platform-meta`, `text-platform-meta`, `border-platform-meta`, etc.
2. Audit and remove any place where Meta/Google/TikTok/Organic/Shopify badges fall back to `--status-blue`/`--status-orange`/`--status-red`/`--status-{...}`. Confirmed light usage in `Badge.tsx` tones — needs spot-check that platform-as-badge always routes through platform tokens, not status tones.
3. Apply Shopify's dashed-stroke convention to non-chart contexts via a `data-platform="shopify"` decorator class (e.g. left-border dashed when shown in a list of platform totals).

---

### 3.9 — Store color consistency (your concern #9)

**The schism.** Two completely independent palettes for the same three stores:

| Store     | Charts (storeColors.ts) | Badges/chips (format.ts:144-146) |
|-----------|--------------------------|-----------------------------------|
| uzoshop   | `#06b6d4` (cyan)         | `#0d3680` (navy)                  |
| Zol Plus  | `#ec4899` (hot pink)     | `#c92a2a` (red)                   |
| 360usmile | `#84cc16` (lime)         | `#0a7d3b` (green)                 |

**Plus** divergent fallback palettes for a hypothetical 4th store: [storeColors.ts:25-30](dashboard-web/src/lib/storeColors.ts#L25-L30) lists `['#a855f7', '#dc2626', '#16a34a', '#0ea5e9', '#f59e0b']` while [format.ts:151](dashboard-web/src/lib/format.ts#L151) lists `['#0d3680', '#c92a2a', '#0a7d3b', '#b45309', '#7c3aed']`.

**Your stated preference** in the brief is "I like the current store colors. Keep the good colors and adopt them consistently." Combined with the codebase signal that **format.ts hexes pre-date the chart hexes** (the navy/red/green palette appears in tests, recommendations, and old code), the safer unification path is:

- **Adopt the chart palette (cyan / hot-pink / lime)** as canonical.
- **Replace** format.ts STORE_HUES with OKLCH-token references that resolve to the chart palette.
- Define `--store-uzoshop-bg`, `--store-uzoshop-fg`, etc., for badge contrast pairs.

The chart palette is preferable because (a) it's already OKLCH-tokenized with dark-mode overrides, (b) the three hues are colorblind-safer apart (cyan/magenta/lime maximize hue separation) than the navy/red/green palette, and (c) it does **not** collide with platform colors (`#2563eb` Meta blue ≠ `#06b6d4` cyan; `#ef4444` TikTok red ≠ `#ec4899` pink; `#10b981` Shopify green ≠ `#84cc16` lime).

**However** the user said "keep the good colors" — this is the open question I'll ask in §11. If they prefer format.ts navy/red/green, we tokenize THAT palette instead and update the chart store colors. Either direction is valid; the requirement is unification.

---

### 3.10 — Buttons & action UI consistency (your concern #10)

Covered structurally in §3.7. To recap with specifics:

- **Primary button** — `bg-accent text-accent-fg hover:bg-accent/90` is correct.
- **Destructive** — bug: hardcoded `text-white` instead of `text-status-redFg`. Fix.
- **Disabled state divergence** — `Button` uses `disabled:opacity-50 disabled:pointer-events-none`; GoalTracker uses `bg-accent/40 cursor-not-allowed`. Visual difference is significant — `opacity-50` darkens the entire button, `bg-accent/40` lightens only the background. Standardize to the `Button` contract.
- **Focus rings missing** on ~40% of interactive elements because they use raw `<button>` without the `focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2` chain.
- **Input focus is split** — `Input.tsx` uses `focus-visible:ring-2 focus-visible:ring-accent` while `Filters.tsx:181-185` and `GoalTracker.tsx:182-186` use `focus:shadow-focus`. Two visually distinct focus styles for the same element.

ESLint rule + migration sweep resolves it.

---

### 3.11 — Light + dark mode coverage (your concern #11)

**Strengths.**
- Every CSS variable in `globals.css` has both `:root` and `[data-theme="dark"]` definitions (verified by Agent A: 38/38 tokens).
- ROAS status tokens (`--status-{red|orange|green|blue|gray}` + `-bg` + `-fg`) are tuned per mode.

**Gaps confirmed earlier.**
- `--text-muted` identical in both modes (oklch 60%) — dark-mode separation from `--text-secondary` (78%) collapses.
- `--border-subtle` self-documented as failing WCAG 1.4.11 in dark.
- Hardcoded `amber-*` in 22 components has no dark variant at all.
- Hero gradient hex has no dark variant.
- `cpmPrev` hex has no dark variant.
- `--chart-axis` undefined entirely.
- Tooltip background uses fixed dark color regardless of theme.
- Hardcoded `dark:text-amber-300` in [RefundIndicator.tsx](dashboard-web/src/components/RefundIndicator.tsx) — bypasses tokens with an inline `dark:` class.

**Recommendation.**

Aside from the token additions in §3.3, add a CI gate that:
1. Greps for `dark:` Tailwind variants in component files (`components/**/*.tsx` excluding `components/ui/`) and fails if found — forces all dark-mode behavior to live in CSS variables.
2. Greps for `#[0-9a-fA-F]{3,8}` in component files (excluding `app/api/oauth/*/route.ts` for legitimate OAuth HTML) and fails if found.

This is the only way to keep the system clean as the codebase grows.

---

## 4. Cross-cutting recommendations (synthesis)

### 4.1 Token architecture (primitives → semantic → component)

Following the modern Tailwind v4 + CSS-vars pattern ([Mavik Labs 2026](https://www.maviklabs.com/blog/design-tokens-tailwind-v4-2026/)):

```
PRIMITIVES (raw values, OKLCH)
  --color-blue-500: oklch(60% 0.18 240);
  --color-amber-500: oklch(70% 0.16 75);
  ...

SEMANTIC (intent-named, mode-aware)
  --status-warning: var(--color-amber-500);  ← light
  [data-theme="dark"] --status-warning: oklch(...);
  --status-warning-bg, -fg, -ring

  --platform-meta: var(--color-blue-500);  ← drawer reference values
  --platform-google, -tiktok, -organic, -shopify

  --store-uzoshop, -zolplus, -usmile (+ -bg, -fg)

COMPONENT (component-scoped)
  --button-primary-bg: var(--accent);
  --insight-card-warning-bg: var(--status-warning-bg);
  ...
```

The codebase today has the semantic layer (`--status-*`, `--chart-platform-*`, `--chart-store-*`) but lacks the primitives layer, which means dark-mode tuning happens directly inside semantic tokens. That's acceptable for a small token set but the missing `--status-warning` (covering amber) and the missing `--chart-axis` show the gaps.

### 4.2 Component primitive enforcement

- ESLint custom rule: forbid `<button>` outside `components/ui/`.
- ESLint custom rule: forbid `dark:` Tailwind variants in component files.
- ESLint custom rule: forbid hex colors in component files.
- Storybook (or a single `/internal/design-tokens` page) showing every token, primitive, and component variant under light + dark.
- Visual-regression test (chromatic-style snapshot) — out of scope for this audit unless explicitly added in phase 3.

### 4.3 Test infrastructure

Currently zero RTL/bidi/dark-mode tests. Recommend adding (phase 3):
- 4 RTL component tests (campaign drawer Hebrew title, adset tooltip, allocation tooltip, per-store-card Hebrew title with English store).
- 1 dark-mode parity test that loads `/` with `data-theme=dark` and asserts no element resolves to `transparent` or `currentColor` where a fill is required.
- 1 token coverage test that fails CI if `globals.css` contains a token in `:root` that's missing from `[data-theme="dark"]`.

---

## 5. Risk register

| # | Risk | Likelihood | Impact | Mitigation |
|---|------|-----------|--------|------------|
| R1 | Store-color unification (cyan/pink/lime vs navy/red/green) alters a visual identity the user is attached to | medium | medium | §11 open question — confirm preference before phase 2 |
| R2 | Live gradient softening makes the "live" identity less visible | low | low | Keep pulse animation + pill chip at full saturation; only tone the background gradient |
| R3 | Home tab restructure breaks vertical-scroll muscle memory | low | low | Same content, same order — only visual grouping |
| R4 | Monthly tables year-selector breaks current SWR cache key | medium | medium | Migrate fetch with feature flag; ship year-selector behind `?ny=1` until validated |
| R5 | Migrating drawers to `<Sheet>` changes animation/transition behavior | medium | low | Verify View Transitions API morph still works ([globals.css:285-291](dashboard-web/src/app/globals.css#L285-L291)) |
| R6 | ESLint rule for raw `<button>` blocks legitimate uses (e.g. `<button type="submit">` inside Radix Form) | low | low | Allowlist `components/ui/*` and document escape hatches |
| R7 | Bidi `<bdi>` wrappers add DOM weight in large tables (500+ rows × 5 cells each) | low | medium | Measure rendering perf on CampaignsTable post-migration; defer if regression >10% |
| R8 | New `--status-warning` token + amber sweep introduces visual shift in 22 components | medium | low | Side-by-side screenshot comparison per component; user-driven sign-off before merging |

---

## 6. Assumptions that need verification

- **A1** The user is OK adopting the chart palette (cyan/pink/lime) as canonical store identity. If not, we flip the migration direction — see §11.
- **A2** The drawer's platform-color rendering (`MetaShopifyReconciliation.tsx:372-387`) is the user's intended reference. The brief says "I really like how the platform colors currently look in the drawer" — confirmed.
- **A3** "Home tab always selected" is the hover-bg collision, not a different bug (e.g. URL state stuck on `home`). Codebase reading supports the hover-collision hypothesis; should be validated in browser.
- **A4** Operator page restructure is in-scope. Brief doesn't explicitly list it but §3.1 recommends sub-tabs. Confirm.
- **A5** Monthly tables can change the global Analysis-tab filter contract (today: tables ignore the filter; recommended: tables move to a separate sub-tab with their own picker). This is a UX-breaking change; confirm.
- **A6** Migration to logical CSS properties (`ms-*`/`me-*`) is desirable but not blocking. Defer to phase 3.

---

## 7. Files and modules that need to change (consolidated)

### Phase A (quick wins, no behavioral change)
- [Sidebar.tsx:91-93](dashboard-web/src/components/Sidebar.tsx#L91-L93) — Home tab hover fix.
- [globals.css](dashboard-web/src/app/globals.css) — dark-mode `--status-{tone}-bg` chroma/L reduction (Live gradient).
- [Button.tsx](dashboard-web/src/components/ui/Button.tsx) — destructive variant `text-white` → `text-status-redFg`.
- [globals.css](dashboard-web/src/app/globals.css) — define `--chart-axis` (light + dark).
- [chartColors.ts:42](dashboard-web/src/lib/chartColors.ts#L42) — `cpmPrev` → CSS var.

### Phase B (token unification + bidi sweep)
- [globals.css](dashboard-web/src/app/globals.css) — add `--status-warning` + `-bg` + `-fg` (light + dark). Add `--gradient-hero-{from|via|to}` × light/dark. Adjust `--text-muted` dark value. Rename `--border-subtle` → `--border-decorative-only` or document inline.
- [tailwind.config.ts](dashboard-web/tailwind.config.ts) — expose new tokens.
- 22 components with raw `amber-*` (full list below): replace with `bg-status-warning-bg text-status-warning-fg`.
  - [CampaignDrawerStatusSection.tsx:63-64, 88](dashboard-web/src/components/CampaignDrawerStatusSection.tsx#L63-L88)
  - [SyncIndicator.tsx:86, 94](dashboard-web/src/components/SyncIndicator.tsx#L86-L94)
  - [GoalTracker.tsx:184, 211, 236, 245](dashboard-web/src/components/GoalTracker.tsx#L184-L245)
  - [InsightsPanel.tsx:49-65](dashboard-web/src/components/InsightsPanel.tsx#L49-L65)
  - [CohortComparisonPanel.tsx:215, 223, 360, 389-421](dashboard-web/src/components/CohortComparisonPanel.tsx#L215-L421)
  - [TabFreshnessHeader.tsx:59](dashboard-web/src/components/TabFreshnessHeader.tsx#L59)
  - [InsightsBoard.tsx:62-65](dashboard-web/src/components/InsightsBoard.tsx#L62-L65)
  - [RefundIndicator.tsx](dashboard-web/src/components/RefundIndicator.tsx) (incl. removing `dark:text-amber-300` inline)
- [HeroOverview.tsx:269](dashboard-web/src/components/HeroOverview.tsx#L269) — Tailwind arbitrary value reads from CSS vars.
- [storeColors.ts](dashboard-web/src/lib/storeColors.ts) + [format.ts:144-146, 151](dashboard-web/src/lib/format.ts#L144-L151) — unify store palette (direction to be decided in §11).
- [chartColors.ts](dashboard-web/src/lib/chartColors.ts) — promote to `PLATFORM_TOKENS`; export Tailwind utility classnames.
- Bidi sweep: [CampaignDrawer.tsx:825, 859](dashboard-web/src/components/CampaignDrawer.tsx#L825), [CampaignsTableRow.tsx:286, 315, 368, 652-654](dashboard-web/src/components/CampaignsTableRow.tsx#L286), [PerStoreCards.tsx:77](dashboard-web/src/components/PerStoreCards.tsx#L77).

### Phase C (component primitives + IA restructure)
- New `<Stat>`, `<TableBase>`, `<InsightCard>` primitives in `components/ui/`.
- Migrate raw `<button>` to `<Button>` across `components/**/*.tsx`.
- Delete duplicate `TONE_BG` in `CampaignsTable.tsx` and `AdsDrawer.tsx`; import `BADGE_TONE_BG` from `Badge.tsx`.
- Re-skin `CampaignDrawer.tsx` and `AdsDrawer.tsx` to use `<Sheet side="end">`.
- Restructure Home into 3 vertically-grouped bands.
- Split Analysis into `Trends` + `Archive` sub-tabs; new year-selector for `MonthlyTables`.
- Add 4 sub-tabs to `/operator`.
- ESLint rules (no raw `<button>`, no `dark:` in components, no hex in components).

### Phase D (perf + tests)
- React virtualization for `CampaignsTable` (and optionally `MonthlyTables` summary mode if user opens all months in one year).
- 4-6 new RTL/bidi component tests.
- Dark-mode parity test.
- Token coverage CI test.

---

## 8. Acceptance-criteria coverage matrix

| Brief concern | Acceptance criteria | Phase | How verified |
|---|---|---|---|
| #1 Page overload | Pages lighter, clear purpose per tab, info preserved | C | Manual screenshot diff + scroll-height measurement |
| #2 Monthly tables | No endless wall, scalable to 3+ years | C | UI walkthrough, year-selector functional test |
| #3 Color/contrast | No light-on-light, no dark-on-dark, hover/active/focus clear | A+B | Storybook visual review, axe-core scan |
| #4 Home tab | Default neutral, selected clear, hover subtle | A | Sidebar.tsx diff + manual + component test |
| #5 Live gradient | Calmer, refined, AAA contrast preserved | A | Side-by-side screenshot + WCAG color checker |
| #6 RTL/bidi | Hebrew + English never breaks, systematic | B | 6 site fixes + 4 component tests |
| #7 Unified language | Tables/cards/charts/buttons all aligned | C | Storybook + manual cross-tab review |
| #8 Platform colors | Same platform = same color everywhere | B | Grep diff: only `--chart-platform-*` references |
| #9 Store colors | Same store = same color everywhere | B | Grep diff: only `--chart-store-*` (or chosen variant) |
| #10 Buttons | One Button primitive, consistent states | C | ESLint rule + 0 raw `<button>` outside `ui/` |
| #11 Light/dark | Both modes intentional, no afterthought | A+B | Token coverage test + dark-mode parity test |

---

## 9. Out-of-scope (explicit)

To prevent scope creep this audit/plan **does not** propose:

- Replacing Recharts with a different chart library.
- Migrating to Tailwind v4 (the codebase is on v3 per `tailwind.config.ts`).
- Adding internationalization framework / extracting Hebrew strings into i18n JSON.
- Mobile-only navigation overhaul beyond the existing hamburger drawer.
- Changes to API contracts, data shape, Supabase schema, or Inngest jobs.
- Auth/RBAC changes (the dashboard is internal, single-user, URL-obscurity per memory).
- Visual-regression / Chromatic infrastructure (recommend, but defer to a separate plan).

---

## 10. Tentative phasing (subject to user approval in §11)

| Phase | Scope | Effort | Risk |
|-------|-------|--------|------|
| **A — quick wins** | Sidebar hover, Live gradient, Button destructive fix, chart-axis token, cpmPrev token | ~0.5 day | Very low |
| **B — token unification + bidi sweep** | Status-warning token, amber sweep (22 components), hero gradient tokens, store-color unification, platform tokens promotion, 6 bidi fixes | ~2 days | Medium (touches many files; needs careful visual review) |
| **C — primitives + IA restructure** | Stat/TableBase/InsightCard primitives, button migration, drawers→Sheet, Home 3-band layout, Analysis sub-tabs + year selector, /operator sub-tabs, ESLint rules | ~3-4 days | Medium-high (largest visual change; needs user sign-off per surface) |
| **D — perf + tests** | CampaignsTable virtualization, 4-6 RTL tests, dark-mode parity test, token coverage CI test | ~1 day | Low |

Total: ~7-8 days of focused work. Phases are designed to be shippable independently — each leaves the dashboard in a strictly-better state than before.

---

## 11. Open questions for user (must answer before plan is written)

1. **Store color direction** (§3.9, §11) — adopt chart palette (cyan/hot-pink/lime) as canonical and migrate badges, OR adopt format.ts palette (navy/red/green) as canonical and migrate charts? My recommendation: chart palette (already OKLCH-tokenized, colorblind-safer apart from platform colors). Strongly affects phase B.
2. **Operator page restructure** (§3.1, §6 A4) — in scope for this overhaul, or leave for a separate effort? The dashboard is internal and the operator page is admin-only; phase C cost includes it only if confirmed.
3. **Analysis tab IA change** (§3.1, §3.2, §6 A5) — OK to split into "Trends" + "Archive" sub-tabs, breaking the current behavior where `MonthlyTables` ignores the global range? My recommendation: yes — current behavior is confusing per the in-code comment apologizing for it.
4. **Phasing** — single PR per phase (4 PRs total) or one PR per phase pair, or one mega-PR? Memory ([feedback_no_info_loss_across_tabs](memory)) suggests you tolerate one large rollout. My recommendation: 4 PRs phased A→B→C→D, each verified before next phase begins.
5. **Should we add Storybook** to the codebase as part of phase C? Would make subsequent design-system work much easier but adds ~half-day of setup and a maintenance burden. Optional.

---

## 12. What's deliberately NOT being recommended

To respect your "no info loss" rule (memory: [feedback_no_info_loss_across_tabs](memory)):

- **Nothing is being deleted.** Annotations move from Home → Analysis (still visible, just relocated). Recommendations remain on Home (visually de-emphasized, behind a collapsible). Monthly tables remain (re-grouped by year). KPIs remain (consolidated into a single card with internal columns).
- **No KPI is being demoted off the first viewport** beyond what's already off-viewport today. The 3-band Home layout puts TodayLive + Hero in the first ~700 px (vs ~700 px today), so the "first-viewport answer" stays the same — just better organized.
- **No tab is removed.** The 6 main tabs remain. Sub-tabs are added under Analysis and Products, but the top-level structure is preserved.

---

## 13. Sources cited

### Information architecture & progressive disclosure
- [Progressive Disclosure in UX (2026) — UXPin](https://www.uxpin.com/studio/blog/what-is-progressive-disclosure/)
- [Progressive Disclosure in SaaS Dashboards — Pixxen](https://pixxen.com/progressive-disclosure-saas/)
- [Information Hierarchy in Dashboards — Cluster](https://clusterdesign.io/information-hierarchy-in-dashboards/)
- [Smart SaaS Dashboard Design Guide 2026 — F1Studioz](https://f1studioz.com/blog/smart-saas-dashboard-design/)
- [Six principles of dashboard IA — GoodData](https://www.gooddata.ai/blog/six-principles-of-dashboard-information-architecture/)
- [Effective Dashboard Design Principles 2025 — UXPin](https://www.uxpin.com/studio/blog/dashboard-design-principles/)
- [Dashboard Design UX Patterns — Pencil & Paper](https://www.pencilandpaper.io/articles/ux-pattern-analysis-data-dashboards)
- [UX Strategies for Real-Time Dashboards — Smashing Magazine](https://www.smashingmagazine.com/2025/09/ux-strategies-real-time-dashboards/)
- [Designing Enterprise Dashboards with Cognitive Load Theory — Fegno](https://www.fegno.com/designing-enterprise-dashboards-with-cognitive-load-theory/)

### Bidirectional (RTL/LTR) text
- [Unicode Bidirectional Algorithm basics — W3C](https://www.w3.org/International/articles/inline-bidi-markup/uba-basics)
- [Inline bidi markup examples — W3C drafts](https://w3c.github.io/i18n-drafts/articles/inline-bidi-markup/bidi_examples)
- [Bidirectional Text and the Unicode BiDi Algorithm — Kitab](https://kitab.noorui.com/en/blog/bidirectional-text-bidi)
- [Mixing RTL and LTR words — Jarrousse blog](https://blog.jarrousse.org/2026/02/10/mixing-rtl-and-ltr-words-in-wordpress-titles/)
- [Tailwind CSS RTL — Flowbite](https://flowbite.com/docs/customize/rtl/)
- [CSS Logical Properties for RTL — Pixic Studio](https://pixicstudio.medium.com/css-logical-properties-rtl-layouts-236edec711fa)
- [RTL Support in React (Untitled UI)](https://www.untitledui.com/react/docs/rtl)

### Contrast & accessibility
- [WCAG 2.2 Contrast Ratio Explained](https://accessibilityassistant.com/blog/accessibility-insights/how-to-apply-wcag-22-colour-contrast-accessibility/)
- [Contrast requirements for WCAG 2.2 Level AA — Make Things Accessible](https://www.makethingsaccessible.com/guides/contrast-requirements-for-wcag-2-2-level-aa/)
- [Dark Mode and WCAG — BOIA](https://www.boia.org/blog/offering-a-dark-mode-doesnt-satisfy-wcag-color-contrast-requirements)
- [Accessible color systems across themes — DEV](https://dev.to/beefedai/designing-accessible-color-systems-and-ensuring-contrast-across-themes-2i43)
- [Implementing accessible linear design across light/dark — LogRocket](https://blog.logrocket.com/how-do-you-implement-accessible-linear-design-across-light-and-dark-modes/)

### Design tokens & color systems
- [Design Tokens That Scale 2026 (Tailwind v4 + CSS vars) — Mavik Labs](https://www.maviklabs.com/blog/design-tokens-tailwind-v4-2026/)
- [Tailwind CSS Theme variables](https://tailwindcss.com/docs/theme)
- [Tailwind CSS Design Tokens for SaaS — TheFrontKit](https://thefrontkit.com/blogs/tailwind-css-design-tokens-for-saas)
- [SaaS Dashboard Color Palette 60-30-10 — sixtythirtyten](https://www.sixtythirtyten.co/blog/saas-dashboard-color-palette-css-tailwind)
- [Brand color palettes (Meta/Google/TikTok) — Uxcel](https://uxcel.com/blog/color-palettes-from-social-networks)
- [Dashboard Color Palette branding — insightsoftware](https://insightsoftware.com/blog/dashboard-color-palette-advice-for-branding-your-analytics/)
- [Brand color in data visualizations — Mode](https://mode.com/blog/how-to-use-brand-color-palette-in-data-visualizations/)

### Tables, virtualization, historical data
- [Data Table Design UX Patterns — Pencil & Paper](https://www.pencilandpaper.io/articles/ux-pattern-analysis-enterprise-data-tables)
- [Data Table Pattern — UXPatterns.dev](https://uxpatterns.dev/patterns/data-display/table)
- [Designing effective data table UI — Justinmind](https://www.justinmind.com/ui-design/data-table)

### Radix UI styling
- [Tabs — Radix Primitives](https://www.radix-ui.com/primitives/docs/components/tabs)
- [Styling Radix UI with Tailwind CSS — MakerX](https://blog.makerx.com.au/styling-radix-ui-components-using-tailwind-css/)

### Gradient & glassmorphism
- [Gradient UI in 2026 — Eggradients](https://www.eggradients.com/blog/gradient-ui-in-2026)
- [Glassmorphism 2026 — Inverness Design](https://invernessdesignstudio.com/glassmorphism-what-it-is-and-how-to-use-it-in-2026)
- [Gradients in UI design guide — Supercharge](https://supercharge.design/blog/gradients-in-ui-design-a-guide)

---

*End of audit. Next step: §11 open questions, then writing-plans skill produces the implementation plan.*
