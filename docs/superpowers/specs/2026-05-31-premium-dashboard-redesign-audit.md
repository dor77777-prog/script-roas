---
title: Premium Dashboard Redesign — Phase 1 Audit & Research
date: 2026-05-31
status: Phase 1 — research/audit (no implementation)
baseline: main @ afc9bf6 (post Tasks 1-29 UI/UX overhaul + Archive sub-tab fixes)
---

# Executive Summary

The foundation is unusually thoughtful for an internal tool — an OKLCH token system with documented WCAG decisions, three ESLint regression gates (raw `<button>`, `dark:`, hex-in-components), dark-mode token parity, and a Hebrew-first RTL posture that beats 95% of React/Tailwind apps. The execution layer never caught up to it. A legacy hex palette lives alongside the tokens, the blessed primitives (`Stat`, `TableBase`, `Card`, `Dialog`, `Input`, `Select`, `Switch`, `Tabs`, `Tooltip`) are consumed **zero times** outside their own tests, and 5+ heading styles, 7 icon sizes, 3 sort-header helpers, and 9 hand-rolled "card" surfaces all live in the same codebase. The result is a dashboard that looks credible at first glance and inconsistent the moment you scan two surfaces side-by-side.

Headline findings:

- **Two design systems coexist.** Tokens (`globals.css:13-229`) + a "LEGACY" hex palette still wired in `tailwind.config.ts:67-114` and consumed by `BillingSettings.tsx:86`, `PnLBreakdown.tsx:58`, `CampaignsTableRow.tsx:303`, OAuth callbacks. New components have two valid colors for "surface."
- **Blessed primitives are decorations.** `<Stat>`/`<TableBase>`/`<Card>`/`<Dialog>`/`<Input>`/`<Select>`/`<Switch>`/`<Tabs>`/`<Tooltip>` have **0 import sites in `src/**` outside tests** (05-components-interactions.md:18-37). Consumers reinvent each surface.
- **Home is information-saturated.** TodayLive (6) + HeroOverview (5) + KpiCards (6) = **17 tiles, 9 unique metrics**; same five questions answered four times at four scopes.
- **Platform/status color collisions are operational, not cosmetic.** Seven documented. Worst: TikTok-red ≡ status-red. [07§Cross-cutting #1] confirms the three-orthogonal-palette fix — but proposes a **better** chart palette than v1: mirror real platform brand colors (Meta blue, Google amber, TikTok hot-pink) so legends become redundant.
- **Dark mode is an "inverted light mode" in 5 specific surfaces.** Hero gradient bypasses its own tokens (`HeroOverview.tsx:273`); scrollbars/skeleton/`::selection`/`focus-visible` have light-mode-only values; `border-line-subtle` is documented decorative-only yet used as structural row separator (`TableBase.tsx:21,29`). [07§Cross-cutting #7] proposes the structural fix: Linear-style 3-variable LCH theming replaces sprawling dark overrides.
- **RTL is 85% adopted but the remaining 15% is concentrated.** 47 physical-direction classes in 5 files (BillingSettings 20, CampaignsTable 13, CronTickSnapshotsViewer 10) + ~6 visible Hebrew bugs (right-pointing `→` arrows at `CampaignsTopList.tsx:81-89`, hand-built `CAD ${n}` in 6 sites, unwrapped operator-entered text).
- **The insights surface is read-only.** Six of seven panels have zero drill action; only `CohortComparisonPanel.onDrillCampaign` is wired. [07§Cross-cutting #10] codifies "every drill is a drawer" — confirms the 1619-line `CampaignDrawer` split is the right architectural move.

**Verdict.** The path to Linear/Stripe/PostHog tier is not a redesign — it is deletion of the legacy palette + 3 new primitives (`Typography`, `PlatformBadge`, unified `Stat`) + 8-10 dark-mode/RTL fixes + Home restructure + four Figma-informed moves: (i) brand-mirrored chart palette, (ii) visible scope line under every page title, (iii) per-card freshness badge with stale desaturation, (iv) 3-variable LCH theming refactor. **~16 P0 + ~22 P1** plus four architectural moves (token unification, primitive enforcement via lint, synthesis layer, Home command-center recomposition) closes the gap.

---

## DIRECTION REVISED 2026-05-31 (post mockup pass)

After this audit was first written the user ran a 10-mockup visual brainstorm and **reversed the surface aesthetic** locked here. The original "Linear/Vercel hairline-flat editorial" target was replaced with **glass + neon (Vision UI tier)** — gradient surfaces with `backdrop-filter: blur(20px) saturate(140%)`, neon edge glows, an animated conic-gradient page background that rotates over 60s, and a deep blue-violet canvas (`oklch(13% 0.020 270)` → `oklch(11% 0.025 280)`). All work is now dark-mode only; light mode is no longer a target.

Five additional decisions were also locked during the mockup pass:

1. **V4 band signal** ([[roas-state-gradient]] mockup 4f) — every state-bearing card carries `data-band="red|orange|green|blue|gray"`. The attribute triggers (i) a 3px top-edge bar via `::before` (matched to the card's radius via `border-start-start-radius` / `border-start-end-radius`) with a glow `box-shadow`, (ii) a subtle ~5% chroma background tint, (iii) the focal `<span class="v banded">` element (the ROAS number) takes the band color via `color` / `-webkit-text-fill-color`, (iv) a small text chip restates the band. Hue separation locked: red `h22`, orange `h75` (53° apart), green `h145`, blue `h240`.
2. **Per-store semantic emphasis** ([[home-visual-rules]] mockup 4i) — Spend cell always semantic-red with prepended `↓` glyph in label; Revenue always semantic-green with `↑`; AOV conditional (`> $70 CAD` green `▴`, `< $50` red `▾`, mid neutral); Orders neutral; **CPM cells are explicitly never colored by value — always white.**
3. **ROAS-vs-target chart section** ([[home-visual-rules]] mockup 4h) — full-width glass card placed AFTER the per-store row (per the locked Home section order). Carries: authoritative-Hebrew TL;DR sentence, compact 5-up KPI strip (Revenue / ROAS / Spend / Net / CPM), dashed target line at 3.0, daily ROAS line with hover dots, annotation pins (💰) with **hover-only and click-only tooltips** (never always-visible), prev-period footer comparison, and **its own date-range picker** in the section header (right side) with presets 7/30/90/MTD/QTD/YTD/custom — independent of the page-level range tabs.
4. **Freshness 3-stage desaturation** ([[freshness-desaturation-thresholds]] mockup 5) — `data-freshness="fresh|aging|stale"` triggers `filter: saturate(1.0/0.60/0.30)` + `opacity: 1.0/0.92/0.80` with `transition: filter 600ms ease-out, opacity 600ms ease-out`. Thresholds: 15min boundary for `aging`, 30min for `stale`. Chip in card header shows label + age ("LIVE · 8s" / "AGING · 22min" / "STALE · 47min").
5. **Slim 72px icon-rail sidebar** ([[phase1-audit-decisions-2026-05-31]] Q10 / mockup 6) — collapsed default, hover-to-expand to 220px after a 200ms delay, pin button in footer persists expansion via localStorage `sidebar:pinned`, `⌘\\` keyboard shortcut toggles between collapsed and pinned-expanded. Collapsed-hover tooltip shows label + keyboard shortcut. Width transitions at `200ms ease-out`.

**Visual reference:** see the mockup set in `docs/superpowers/mockups/2026-05-31-visual-direction/` (start at `README.md`). The HTML files contain the exact CSS — token values, gradient stops, box-shadow stacks, glass blur strengths, band rules — that Phase 3 / Wave 1 must adopt verbatim.

**What is superseded:** §1 "Inspiration & Direction" anti-patterns (no glass / no neon / no mesh gradient) and §4 "Unified Visual Direction — Elevation & surfaces" (hairline borders, no shadows) no longer reflect the user's choice. §1 also referenced Linear/Vercel/Stripe/PostHog as targets — the right reference set is now Vision UI Dashboard (Creative Tim) + the gradient-heavy premium templates the user saw on Figma. The §4 typography ramp, the LCH theming idea (limited to the foreground stack), per-card freshness, and the in-place-drawer drill-down all stand.

**What still stands** from the audit and the 10 locked decisions:
- The 10 base decisions in [[phase1-audit-decisions-2026-05-31]]: brand-mirrored chart palette / violet accent / Shopify as category / slim sidebar / aggressive stale fade / authoritative Hebrew TL;DR / drawer + Ads-Manager deep-link / GoalTracker on P&L / Playwright CI / drawer hard cut.
- All §2 current-state findings (legacy palette, primitive non-adoption, 7 color collisions, 6 RTL bugs, primitive coherence gaps).
- The §5 **Prioritized Recommendations table** still stands — the *what* of the work is unchanged; only the *surface aesthetic* changed. P0/P1 items map cleanly to the v2 plan tasks.
- Wave 2 primitive enforcement (only the visual treatment is glass+neon instead of hairline-flat).
- Wave 4 RTL/bidi sweep.

**Executable artifact for Phase 3** is the v2 plan at `docs/superpowers/plans/2026-05-31-premium-dashboard-redesign.md`, not this audit. This document is now a historical record + an inventory of what to fix. Always cross-reference the five memory files listed above for the load-bearing details before touching tokens or component visuals.

---

# 1. Inspiration & Direction

## The patterns we will adopt

1. **Editorial discipline over decoration.** Linear / Stripe / Plausible / PostHog converge: 90% neutral surface, one accent for primary actions, semantic green/red/amber strictly for status and deltas [07§Cross-cutting #1]. One confident accent hue (violet/indigo, clear of Meta-blue and Google-amber chart series), neutral elevation, one intentional decorative gradient (Home hero) and nothing else.
2. **One hero metric, 3× louder than the rest.** Stripe/Baremetrics pattern. Our hero is **Net Profit**; Spend, Revenue, ROAS, Goal% become a secondary strip. Today Home has 17 co-equal tiles competing.
3. **KPI card anatomy = label / value / delta-chip / sparkline.** Convergence across shadcn dashboard-01, Power BI, Vision UI, Untitled, Setproduct, Tran [07§Cross-cutting #4]. Every metric ships a trend direction and comparison anchor ("ROAS 2.4× (+8% vs prior 7d, –4% vs target)"). Label = small-caps muted; value = 28-32px tabular; delta = semantic pill; sparkline inline ~60×24px. Cap 4-6 cards per row.
4. **Time-series area chart as page hero.** Plausible/PostHog convention — single large area chart, soft gradient fill, thin stroke, faint horizontal rules. Time axis stays LTR even in Hebrew (W3C BIDI guidance [07§Top-10 #3]).
5. **Tabular nums everywhere numeric.** `font-variant-numeric: tabular-nums` on every currency, ROAS, percentage. Already wired via Rubik (`globals.css:246-252`) — needs lint enforcement and a `<Num>` primitive that auto-wraps in `<bdi dir="ltr">`. Non-negotiable for ledger alignment [07§Cross-cutting #3].
6. **Command palette as power-user accelerator.** Already built (`CommandPalette.tsx`); needs better discoverability and bilingual hardening (Hebrew store names + English campaign IDs in the same fzf query — Linear/Notion bilingual is rare and a real operator superpower).
7. **Sticky table headers + sticky first column for Campaigns.** Highest-return UX investment for any data table. RTL pins the sticky column to the **right** edge.
8. **Per-card freshness chip with stale desaturation.** We already have `data_freshness` (Phase B/C/D). Surface it inline per panel; **stale cards visually desaturate** (drop chroma + grayscale chart) rather than throwing a warning chip [07§Cross-cutting #8]. Rules in §4.
9. **Insight = action verb, not paragraph.** Every recommendation ships a clickable action ("Open campaign," "Mute alert"). `CohortComparisonPanel.onDrillCampaign` is the proof-of-concept.
10. **Progressive disclosure with persisted state.** Default to "minimum information for the next decision," but persist operator expansion preferences.
11. **Visible filter scope line under every page title** (new vs v1). Linear / Shopify Polaris / Catalyst pattern — show timeframe + store + currency right under the H1 [07§Top-10 #5]. Eliminates the "wait, am I looking at all stores?" cognitive tax.
12. **In-place drill via drawer/modal, preserves filters.** Codify "every drill is a drawer" [07§Cross-cutting #10]. The 1619-line `CampaignDrawer` split makes the pattern sustainable.

## Figma & broader 2026 reference catalog

Triangulated from a deep Figma + Dribbble + shipped-product survey [07§File 1, §File 2, §Broader curation]. Shared shorthand for the team:

- **Vision UI Dashboard (Creative Tim, MUI flagship)** [07§File 1] — deep navy + purple→pink mesh-gradient hero, glowing ApexChart strokes, glassmorphism. Beautiful in screenshots, fatigue-inducing for 8h ops use. **Anti-pattern direction.** Adopt only: 4-card hero row sweet spot, capital-letter sidebar section headers.
- **SaaS Selling Dashboard / Tran Mau Tri Tam aesthetic** [07§File 2] — off-white canvas, soft pastel accents, 1px hairline borders instead of shadows, medium-high density, slim 64-72px collapsible icon rail. **Closest to our target.** Adopt: hairline-no-shadow stance, collapsible rail, tabular leaderboards with inline trend bars, diagnostic empty states.
- **Linear** [07§Broader A.1] — pitch-black canvas, graphite cards, charcoal borders, single neon-lime accent, LCH color space, 6px radius. **Theming pattern is our target structure**: three root LCH variables drive the full theme. Adopt the discipline, not the lime.
- **Vercel Geist** [07§Broader A.2] — pure mono palette + 10-step gray ramp, Geist Sans/Mono with `tnum` default, **zero drop shadows** — depth from background tone and 8%-opacity borders. Confirms the hairline-elevation thesis.
- **Notion** [07§Broader B.5] — high-contrast B/W + single functional blue, weight scale 400/500/600 only, hand-drawn humanising icons. Extreme-restraint benchmark.
- **shadcn/ui dashboard-01** [07§Broader A.3] — 256px sidebar, 4-up KPI grid with label/value/delta/context, hero line chart with range chip presets, dense DataTable. Closest open-source reference for our shape.
- **Catalyst (Tailwind UI)** [07§Broader C.9] — zinc palette + purple-500 accent, Sidebar Body/Header/Footer with `SidebarSection` grouping. Reference for sidebar IA.
- **Shopify Polaris data-viz** [07§Broader B.4] — single-series purple default, multi-series capped at 4 with mandatory legend, green-positive / red-negative bias, accessible data-table fallback for every chart. Doubly relevant — Shopify is also one of our data sources.
- **Untitled UI React** [07§Broader C.8] — neutral aesthetic, mid-density, sidebar with subtle 1px section dividers (not headings). Reference for sidebar density.
- **Triple Whale** [07§Cross-cutting #8] — direct ecommerce peer; data-freshness-as-first-class-UI + stale-state desaturation. Closest functional sibling.
- **Stripe Dashboard** [07§Broader B.6] — "boring on purpose," single purple accent, 1.5px line strokes with 8% soft fill, gridlines at 6% opacity. Reference for chart restraint.

Convergence across all 10: hairline borders, tabular numerics, single accent, 4-up KPI hero, semantic-palette discipline, slim collapsible sidebar. Vision UI is the lone divergence — and the divergence is into anti-pattern territory.

## Anti-patterns we will NOT adopt

Consolidated from the 17-item Figma survey [07§Anti-patterns] + v1.

- **Mesh-gradient hero behind KPI numbers** (Vision UI signature) — Hebrew numerals fall in/out of contrast across the gradient.
- **Glassmorphism on functional surfaces** — NN/g: reserve for one or two high-value moments; serious dashboards don't need it.
- **Glowing / neon chart strokes** — ApexCharts demo specials; Stripe/Vercel/Linear use flat 1.5-2px.
- **Skeuomorphic 3D illustrations** — designer-portfolio bait; freezes frame-rates, inflates bundle.
- **Donut/pie for share-of-spend, donut cluster > 3 slices, 3D pie/bar** — donut cemetery; replace with horizontal stacked bar or 100% stacked area.
- **> 4 chart series per chart** — "rainbow heatmap of sadness." Cap at 3-4 for 3-platform context; aggregate excess as "Other."
- **Decorative color** (alternating rows, accent borders, "brand" overlays) — loses semantic precision.
- **Vanity stats without comparison** — no bare `CAD 45,231` without target/delta/sparkline/semantic color.
- **Pure-black dark mode (`#000`)** — industry moved to moonlit-grey deep neutrals (#0F1115–#1A1D23) for financial work to cut OLED burn-in and 8h fatigue.
- **Auto-rotating "featured insights" carousels** — timer animation steals attention from real data.
- **Mirroring chart time axis under RTL** — calendar time is universal LTR.
- **Bouncy/spring easing** — premium UI is 150-200ms ease-out cubic.
- **Emoji mixed with Lucide icons** — single biggest "hobby tool" tell (`🏪`/`⏸`/`🏷️`/`⏳` in `CampaignsTableRow`; annotation system). Confirmed by [07§Anti-patterns].
- **Polychrome sidebar / decorative gradients on chrome** — monochrome chrome, content carries the color.
- **Hidden default filters ("surprise filters")** — replaced by visible scope line, §4.
- **Tables-as-dashboards** (40 cols × 4000 rows = CSV in disguise).
- **Spinners that don't suggest structure** — replace with skeleton matching final shape.
- **Drill-to-nowhere navigation** that loses filter/breadcrumb context.
- **Inconsistent units across cards** ($ here, raw number there, 2 decimals here, 0 there).
- **Owner-less / freshness-less metrics** — no timestamp = no trust.

## Visual personality statement

**Dense but quiet.** A financial command surface: tabular numerals everywhere, three calibrated elevation tiers communicated by **hairline borders, not shadows**, one confident accent, and three orthogonal palette layers — semantic (red/amber/green for status only), chart (Meta-blue / Google-amber / TikTok-pink mirrored from each platform's own brand color so legends become redundant), and brand (single accent for CTAs). One intentional gradient on the Home hero; flat-neutral everywhere else. Theming flows through three root LCH variables (background L / foreground L / accent H) so dark mode is a coherent perceptual transform, not a wall of overrides. Motion is short and purposeful (120-240ms ease-out, never bouncy). Type: Heebo (Hebrew) + Rubik (tnum numerics) + Geist Mono (IDs); `tabular-nums` global. **Per-card freshness badges with stale-state desaturation** show data age without alarming chrome — fresh = full chroma, stale = grayscale chart + 70% value opacity. Every page header carries a visible scope line ("uzoshop • Meta • Last 30 days"). One sentence: **"Make every pixel earn its place by serving the next decision."**

---

# 2. Current-State Findings

## 2.1 Visual system & color

### Token system

Strongest part of the codebase (`globals.css:13-229`, `tailwind.config.ts:26-65`). OKLCH math, three-step surface stack, paired `-bg`/`-fg` chip tokens with light/dark overrides, and a rare-in-industry comment at `globals.css:142-143` that "`--border-subtle` is decorative-only in dark mode (fails WCAG 1.4.11)." Three ESLint guards exist (`eslint.config.js:120-122`).

Seven execution gaps undercut the foundation (02-visual-system.md §Token system):

1. **Dual color systems coexist** — "LEGACY" hex palette at `tailwind.config.ts:67-114` still alive, consumed by `BillingSettings.tsx:86-87`, `PnLBreakdown.tsx:58-59`, `CampaignsTableRow.tsx:303` via `bg-blue-100`/`text-purple-700`. ESLint hex rule only fires inside `/components/`; LEGACY is Tailwind-class-based so it slips every gate. **#1 visual coherence risk.**
2. **Hex defaults inside `:root` chart tokens** (`globals.css:42-50` light hex / `:157-165` dark OKLCH) — two scales not L-anchored, light/dark transition perceptually imbalanced.
3. **No `--space-*` scale** — Card `px-5 py-4`, Stat `px-3 py-2`, InsightCardRow `px-4 sm:px-5 py-2.5 sm:py-3`, TableCell `px-3 py-2`, Dialog `p-6`, Tooltip `px-2.5 py-1.5`. Four horizontal rhythms.
4. **No motion tokens** — ad-hoc `180/220/240/320ms` (`globals.css:352, 364`, `tailwind.config.ts:207-208`).
5. **No semantic radius scale** — `Badge rounded`, `Tabs.Trigger rounded-sm`, controls `rounded-md`, cards/Dialog `rounded-xl`. No `--radius-control` / `--radius-card`.
6. **Hard-coded `focus-visible` ring** at `globals.css:295` (`box-shadow: 0 0 0 3px rgba(13,54,128,0.20)`) — no dark adapt, competes with primitives' `focus-visible:ring-2 focus-visible:ring-accent` → **visible double ring** on Buttons/Inputs/Selects.
7. **Chart-axis token defined three ways**: `globals.css:94` + `ChartContainer.tsx:36` (overrides to `var(--text-muted)`) + `chartColors.ts:8` (`CHART_AXIS_COLOR`).

### Platform color collisions — name all 7 with role

| # | Colliding pair | Light values | Why operational |
|---|---|---|---|
| 1 | TikTok-red ↔ status-red | `#ef4444` vs `oklch(60% 0.18 25)` (~hue 25) | A red line could mean "TikTok platform" or "ROAS below threshold" |
| 2 | Google-amber ↔ status-warning | `#d97706` (hue 60) vs `oklch(70% 0.14 75)` | Warning chips blend with Google channel chips |
| 3 | Shopify-green ↔ status-green | `#10b981` (hue 155) vs `oklch(60% 0.16 145)` | "Above-target ROAS" green = Shopify color |
| 4 | Organic-violet ↔ annotation-sale | both dark `oklch(75% 0.{18,20} 305)` | **Identical L, identical hue** — annotation pin invisible on Organic line |
| 5 | uzoshop-cyan ↔ annotation-creative | both dark `oklch(75% 0.{13,18} 200)` | Same hue + L — creative annotations invisible on uzoshop chart |
| 6 | usmile-lime ↔ annotation-launch | `#84cc16` vs `oklch(55% 0.18 145)` | 15° apart, similar value |
| 7 | status-blue ↔ accent | `oklch(60% 0.16 240)` vs `oklch(55% 0.18 260)` | Both blue, 20° apart — "above target" chip fights primary CTA |

### Dark mode regressions

Eight surfaces stay light-mode-only or fail contrast in dark (02-visual-system.md §Dark mode findings):

- **Hero gradient bypassed** — `HeroOverview.tsx:273` uses `dark:from-accent ...` instead of `--gradient-hero-from/via/to` tokens at `globals.css:207-209`.
- **Scrollbar** — `globals.css:265-269` light hex (`#d9e2ec`/`#f6f9fc`), no dark override.
- **Skeleton shimmer** — `globals.css:312-322` light rgba, no dark override.
- **`::selection`** — `globals.css:254-257` navy `rgba(13,54,128,0.18)` + `#0d253d` text unreadable on dark canvas.
- **Global `focus-visible` ring** — `globals.css:295` navy 20% fades into dark canvas.
- **`border-line-subtle` as structural row separator** — `TableBase.tsx:21,29` uses decorative-only token; dark-mode row separators ~1.7:1 contrast (invisible).
- **Legacy chips never theme-swap** — `bg-blue-100`/`text-purple-700` at `BillingSettings.tsx:86`, `PnLBreakdown.tsx:58`, `CampaignsTableRow.tsx:303` stay pastel in dark. The tell that this isn't a real dark mode.
- **Status chip text fails at 10px** — `globals.css:179-197` chip `-bg` L=42-45% + `-fg` L=99% ≈ 3.5–5:1 (AA Large only); `InsightCardGroup.tsx:170` ships `text-[10px] font-bold` — below threshold.

### Primitive coherence

Inventory in 05-components-interactions.md §Primitive coherence (lines 18-37). Consumption counts outside tests:

| Primitive | Consumers |
|---|---|
| `Button` | 39 |
| `ChartContainer`, `ChartTooltip` | 6 each |
| `InsightCard` | 4 |
| `Badge` | 3 (only via `BADGE_TONE_BG`) |
| `Sheet` | 2 |
| `Stat`, `TableBase`, `Card`, `Dialog`, `Input`, `Select`, `Switch`, `Tabs` wrapper, `Tooltip` wrapper | **0** |

Meanwhile **53 native `title=` tooltips**, **9 hand-rolled "card" surfaces** (`InsightsBoard`, `KpiCards.KpiCard`, `GoalTracker` ×3, `PerStoreCards.StoreCard`, `HealthScorePanel`, `CommandPalette`, `TodayLive`, `Filters`), and **9 tables** (CampaignsTable + AdSetTable + AdsDrawer + MonthlyTables + DetailTable + ProductsTable + CohortComparisonPanel + MetaShopifyReconciliation + ProductCentricView) each shipping their own sort-header, row-hover, sticky z-index. The blessed system was built and tested in isolation; nothing migrated.

`Stat` is the most visible victim: three local forks (`AdsDrawer.tsx:543`, `CampaignDrawer.tsx:1575/1581`, `CampaignsTable.tsx:2490`, `ProductsTable.tsx:897`) with variants the primitive cannot express (`prefix`, `compact`, `active`).

### Typography ramp

The scale is thoughtful (`tailwind.config.ts:147-159`, with letter-spacing tightening on display sizes — a Stripe move). But there is no semantic typography token; **5+ visually distinct H2 styles** ship for the same semantic level (02-visual-system.md §Typography lines 258-267):

- Page H2 (TabHeader): `text-base sm:text-lg font-semibold`
- Section H2 (SectionIntro/GoalTracker/CollapsibleSection): `text-sm sm:text-base font-semibold tracking-tight`
- Panel H3 (AttributionAnalysisPanel/AdSetTable/Reconciliation): `text-sm font-semibold`
- Drawer H2 (CampaignDrawer): `text-base sm:text-lg font-semibold tracking-tight truncate`
- Drawer H2 (AdsDrawer): `text-sm sm:text-base font-bold tracking-tight` — **uses `font-bold` not `font-semibold`**
- Insights H2 (InsightsBoard/PnLBreakdown): `text-base sm:text-xl font-bold tracking-tight leading-tight`
- Quick band H2 (HomeLiveBand/HomeSummaryBand/HomePerStoreBand): `text-sm font-medium` — **drops to `font-medium`**

Weight distribution: `font-medium` 249, `font-semibold` 170, `font-bold` 47 — no clear role assignment.

## 2.2 Information architecture & navigation

### Tab inventory

Sidebar declares 6 tabs (`Sidebar.tsx:16-23`: `home`/`pnl`/`analysis`/`campaigns`/`products`/`detail`) + `/operator` footer + hidden Radix split inside `analysis` (Trends/Archive at `Dashboard.tsx:502-516`) + 4 operator sub-tabs = **12 leaves total**. **"P&L"** is the only non-Hebrew sidebar label; **"ניתוח"** is generic for a wrapper around two unrelated views.

### Home overload — duplicated KPIs

Three KPI strips stack above-the-fold (06-per-page-critique.md §Home):

- **TodayLive** (6 cards): ROAS, Revenue, Spend, Gross Profit, CPM, Orders
- **HeroOverview** (5 floating KPIs): Revenue, ROAS, Spend, Operating Profit, CPM
- **KpiCards** (6 cards): ROAS, Revenue, Spend, Gross Profit, COGS, Net Profit

= **17 tiles, 9 unique metrics**. ROAS 3×; Revenue/Spend each 3×; CPM 2×. Same five questions answered at three time windows + per-store (`PerStoreCards`). All bands use identical `<h2 className="text-sm font-medium">` heading (HomeLiveBand:9, HomeSummaryBand:11, HomePerStoreBand:14) — too small to act as scope divider. **InsightsBoard** (the only "what now?" surface) is buried in band 3 inside a raw `<details>` at `HomePerStoreBand.tsx:17-22` instead of the polished `CollapsibleSection` primitive.

### AnalysisArchive silent filter-ignore

`AnalysisArchiveTab.tsx:13` documents `globalStore: Unused`, but the dropdown is still rendered by the outer `AnalysisTab` wrapper. Operator changes it and nothing happens — only tab where global filter is silently a no-op.

### CollapsibleSection unused

`CollapsibleSection.tsx:21` is a polished primitive with persisted state, icon, badge, subtitle. Grep for usage outside the file: **zero**. Four hand-rolled collapsibles exist instead (`HomePerStoreBand` `<details>`, `InsightsBoard`, `AnnotationsPanel`, `PnLBreakdown`) = ~120 lines of duplicated toggle state.

### CampaignDrawer 1619-line problem

8+ vertical sections (status, health, KPIs, spend↔value chart, CPM chart, AdSetTable, ProductChannelBreakdown, CohortComparisonPanel, ManualMapping, MetaShopifyReconciliation, AttributionAnalysisPanel) top-to-bottom. On mobile a 4-screen scroll, plus chains into `AdsDrawer` (stacked drawer-on-drawer via `useDrawerEsc` in `drawerStack.ts`).

### Filter/palette overlap

Three control surfaces compete: **Filters** panel (presets + store + custom-range), **CommandPalette** (Cmd+K — tab nav + presets + store + top 30 campaigns + actions), **FocusMode** (Cmd+\\). Palette is the right pattern but has no discoverability beyond one trigger pill. Plus `CampaignsTable`/`ProductsTable` ship **their own** in-table store + date + platform controls (`CampaignsTable.tsx:1176-1381`, `ProductsTable.tsx:391-490`) that override the global filter, signalled only by a tiny X-icon at `CampaignsTable.tsx:1264-1273`.

### Operator as IA exemplar

The four sub-tabs (סנכרון / בריאות / פעילות / מסוכן) at `operator/page.tsx:33-38` are the most disciplined IA on the dashboard — one verb per tab, H2 + one-line subtitle (`HealthTab.tsx:18-21`), gated by secret banner. Every top-level sidebar tab should adopt the H2+subtitle pattern.

## 2.3 RTL / bidi / mixed Hebrew-English

### Global setup

Strong baseline. `<html lang="he" dir="rtl">` at `layout.tsx:52`; Heebo + Rubik tnum + Geist Mono; Tailwind logical classes at ~85% (269 logical / 47 physical). `lib/format.ts` is **exemplary** — every numeric atom wraps `<bdi dir="ltr">` and uses typographic minus `−` (U+2212).

### Six P0 visible bugs

| # | Bug | File:line |
|---|---|---|
| 1 | Physical `→` arrows in winner/loser verdict text point opposite the reading direction (visually pull eye left, but Hebrew flows right→left) | `CampaignsTopList.tsx:81, 83, 84, 86, 88, 89` |
| 2 | `text-right` / `text-left` in operator tables align text to the wrong edge in mixed Hebrew/Latin cells | `JobsTable.tsx:191-195`, `ManualOverridesCrud.tsx:311-317`, `CronTickSnapshotsViewer.tsx:34-50`, `TodayLive.tsx:436` |
| 3 | CommandPalette campaign+product `label`/`subtitle` interpolation strips bidi isolation — English names with year suffixes (`"Summer Sale 2026"`) reorder when fzf-filtered alongside Hebrew query | `CommandPalette.tsx:273-274, 322` |
| 4 | AdsDrawer ad/ad-set names render without `<bdi>` wrap — table in drawer shows scrambled mixed-text names | `AdsDrawer.tsx:336, 459` |
| 5 | CampaignsTopList campaign name + platform chip unwrapped — affects the most-scanned widget on Home | `CampaignsTopList.tsx:54, 104` |
| 6 | Manual `CAD ${number}` string assembly bypasses `<bdi>` — currency code can detach from number under bidi reorder | `BillingSettings.tsx:589, 999`, `PnLBreakdown.tsx:309`, `CampaignsTable.tsx:2265, 2278, 2296`, `CampaignsTopList.tsx:120` |

### 47 physical-direction class violations — top offenders

| Rank | File | Count |
|---|---|---|
| 1 | `BillingSettings.tsx` | 20 |
| 2 | `CampaignsTable.tsx` | 13 |
| 3 | `operator/CronTickSnapshotsViewer.tsx` | 10 |
| 4 | `operator/ManualOverridesCrud.tsx` | 7 |
| 5 | `CampaignDrawer.tsx` | 7 |
| 6 | `ProductsTable.tsx` | 6 |
| 7 | `BillingCsvImport.tsx` | 6 |
| 8 | `operator/JobsTable.tsx` | 5 |
| 9 | `PnLBreakdown.tsx` | 4 |
| 10 | `operator/OperatorSecretBanner.tsx` | 4 |

A single mechanical migration PR closes these — each physical class has a 1:1 logical replacement.

### Recharts dir handling

**5 of 7 `<ChartContainer>` usages do NOT set `dir="ltr"`** (RoasChart, HeroOverview main+secondary, QuadrantScatter, MetaShopifyReconciliation, CampaignDrawer ROAS-trend). Two (`CampaignsTable.tsx:1523`, `CampaignDrawer.tsx:1118`) set it explicitly for `YAxis orientation="right"`. Tooltip cursor positioning and custom-label `x` offset is mode-dependent.

### Hand-built `CAD ${n}` problem

`lib/format.ts:fmtMoney` returns a proper `<bdi>...</bdi>` ReactElement. But `lib/utils.ts:formatCurrency`/`formatNumber` return **plain strings**. Root cause of every hand-built `CAD ${n}` violation (6+ sites in P0 bug #6).

## 2.4 Components, primitives & interactions

The system ships two design-systems in parallel: a *blessed* one nobody uses, and an *organic* one that grew into every consumer. The expensive part (write primitive + migrate callers) was skipped.

**Stat triple-fork** — three local re-implementations at `AdsDrawer.tsx:543`, `CampaignDrawer.tsx:1575/1581` (`DrawerStat` with `compact`), `CampaignsTable.tsx:2490` (with `prefix` + `active`), `ProductsTable.tsx:897`.

**Raw `<table>` count: 9 sites, zero `TableBase` consumers.** Three sort-header helpers (`SortHeader`/`AdSetSortHeader`/`AdSortHeader`) implement the same arrow-up/down/double-arrow vocabulary. Row hover inconsistent (CampaignsTable + DetailTable have it; AdSetTable + AdsDrawer + MonthlyTables don't). Sticky z-index is `z-[5]` in 4 of 5 tables, but **flagship CampaignsTable header has no `z-[5]` and no `sticky top-0`** (`CampaignsTable.tsx:2027`).

**AdsDrawer error masking** — `AdsDrawer.tsx:56-60` returns `{ rows: [], lastUpdated: …, dataLastWriteAt: null }` on any non-OK response. Operator believes "no ads" when API failed. Same pattern in MonthlyTables/Filters fetchers. Trust-killer.

**Button focus-ring bug** — `Button.tsx:8-13` `focus-visible:ring-2 focus-visible:ring-accent` + primary button's `bg-accent` ⇒ focus ring on focused primary is invisible. Plus 14 `focus:outline-none` instances without `focus-visible:ring` (BillingSettings:726-1127, ProductsTable, GoalTracker, YearSelector) — keyboard nav surfaces invisibly.

**53 native `title=` tooltips.** `TooltipProvider` never mounted in `layout.tsx`. Native `title` doesn't show on touch, ignores `prefers-reduced-motion`, inaccessible for keyboard, collapses `\n` to spaces (e.g. `AdsDrawer.tsx:485-491`).

**State-coverage gaps.** Skeleton primitive doesn't exist. Only `Dashboard.tsx:315-325` ships a skeleton shape; every other async surface shows "טוען נתוני קמפיינים…" plain text. CampaignDrawer has no loading state at all — body re-renders as charts arrive. No skeleton matches final shape ⇒ layout reflow. ErrorBoundary is a single global wrapper at `layout.tsx:74` — a render error tears down the whole dashboard.

**Drawer close-× hidden behind sticky header.** `CampaignDrawer.tsx:800` sticky `z-10` vs `Sheet.tsx:48` close × at `absolute end-3 top-3` with no `z-*`. Operator hits maximise reaching for close.

**Icon size + emoji-mix.** Seven sizes in active use (`size={14}` 81×, `=16` 38×, `=12` 35×, `=11` 24×, `=18` 17×, `=20` 14×, `=10` 5×) for what should be a 3-step scale. Emoji-with-Lucide is the single biggest "hobby tool" tell: `🏪` at `PerStoreCards.tsx:119`; `⏸`/`🏷️`/`⏳` at `CampaignsTableRow.tsx:320/340/363`; `ANNOTATION_KIND_EMOJI` (8 kinds) at `annotations.ts:50`.

---

# 3. Per-Page Critique

## Home (`Dashboard.tsx:389-436` + 3 bands)

Most overloaded page in the dashboard. Three KPI surfaces stack with massive overlap (17 tiles, 9 unique metrics, four bands all using identical heading style — `TodayLive.tsx:420-497` + `HeroOverview.tsx:317-373` + `KpiCards.tsx:149-229`). HeroOverview is a 6-layer card (gradient hero, dot-grid background, editorial sentence, 5 floating KPIs with delta pills + chips, 144px ROAS chart with annotation pins, context strip) — 2014 dashboard maximalism. **GoalTracker lives only on P&L** (`Dashboard.tsx:465`), but the operator's #1 question is "am I on pace?". **InsightsBoard is buried in band 3 inside a raw `<details>`** at `HomePerStoreBand.tsx:17-22` instead of the polished `CollapsibleSection` primitive that already exists — the "what now?" answer is below 4 bands of "what happened?".

## Trends (`AnalysisTrendsTab.tsx`)

Tightest single-purpose tab in the dashboard. One chart, one filter, one annotation panel. **Two `SectionIntro` headers stack** at lines 25 and 32 (one for filter scope, one for the chart). No synthesis layer above the chart ("ROAS is trending down for 7 days" — page never says it). Metric hard-locked to ROAS (no switcher), no zoom/brush. Tabs.Trigger layout-shift bug at `Dashboard.tsx:506-507` (no transparent border baseline; inactive label jumps 2px on activate).

## Archive (`AnalysisArchiveTab.tsx`)

Two dropdowns stacked vertically (Year, Month) instead of one date scrubber. **17 MonthBlocks rendered as separate `rounded-xl bg-elevated border shadow-sm` cards** at `MonthlyTables.tsx:373, 499` = card lasagna. `globalStore` is documented unused at line 14 — outer wrapper still renders the dropdown, so the operator silently sees nothing happen on store change. No year-level synthesis (best/worst month / YoY), no CSV export, no jump-to-date.

## P&L (`Dashboard.tsx:443-481`)

Most disciplined data page in the codebase. PnLBreakdown's running-total column at `PnLBreakdown.tsx:489-504` is genuinely premium. Flaws: **dual hero** (`GoalTracker.tsx:124` + `PnLBreakdown.tsx:154` both ship `bg-gradient-to-br from-accent/...` cards back-to-back, cannibalising each other); `BillingSettings` stranded as a single button at `Dashboard.tsx:468-470` instead of inline with the relevant breakdown row; by-source breakdown — the page's best diagnostic — locked behind `<details>` at `PnLBreakdown.tsx:316-381`. No multi-period comparison, no drill-by-store, no alerts.

## Detail (`Dashboard.tsx:710-734` + `DetailTable.tsx`)

Simplest tab — SectionIntro + Filters + one DetailTable. The "spent but no sales" red `0` cell and per-row store-trend sparkline are genuinely premium. But **the table is the page**: no totals row (operator can't answer "how much did I spend on FB in this view"), no sorting, no column hiding, no row drilldown, no CSV export, hard 100-row cap with no pagination at `DetailTable.tsx:32` (silently drops older data). Zero synthesis layer.

## Operator (`/operator/page.tsx`)

Four sub-tabs (סנכרון / בריאות / פעילות / מסוכן) are the most disciplined IA on the dashboard; the H2 + byline pattern at `HealthTab.tsx:18-21` is the model the top-level sidebar should adopt. Flaws: defaults to Sync (operator's first question is "is anything broken?" → Health should default) at `operator/page.tsx:58`; no top-level status pill ("All green / 2 issues"); `WhatsappTestButtons` at `DangerTab.tsx:21` sends real production WhatsApp on click with **zero confirmation gate**; three different table styles on Activity tab (StatusEventsFeed `<ul>` + CronTickSnapshotsViewer English-headers `<table>` + JobsTable Hebrew-headers `<table>`).

## Cross-page patterns

- **SectionIntro wall-of-text** — Trends/Archive/P&L/Detail/Campaigns/Products all wrap in 2-3 sentence descriptions. Premium tools let the page speak for itself.
- **Card lasagna** — every section is its own `bg-elevated border rounded-xl shadow-sm` card. Chrome dominates data on dense pages.
- **Two-step disclosure of high-value info** — InsightsBoard/PnLBreakdown-by-source/AnnotationsPanel all behind `<details>`. Most useful content always one extra click away.
- **No global synthesis** — dashboard computes pacing, knows which campaign is bleeding, knows what changed — but no cross-tab "today's TL;DR" exists.
- **No deep-linking** — Insights have "Mark done / Hide" but no "Jump to campaign"; same for token failures → `/operator`.
- **Currency prefix placement** — three patterns (`CAD ${value}` inline / eyebrow / `me-1` span). Three "right answers."
- **ROAS color/text mapping** — centralized in `roasLabel()` but six visual treatments (tinted card bg, tinted chip, cell background, chips, …).
- **No visible scope line** — every page makes the operator hunt for "which store / range am I viewing?" in the Filters panel. [07§Top-10 #5] proposes the universal fix in §4.

---

# 4. Unified Visual Direction (the redesign thesis)

This is the north star for Phase 2. Opinionated, not survey.

## Color system v2 — three orthogonal palettes

**Goal**: zero collisions between platform color, status color, accent, and annotation color. Single source of truth for store color (today there are four). Figma research [07§Cross-cutting #1, §Top-10 #4] confirms the structural fix is **three orthogonal palette layers** — semantic / chart / brand — that never share a hue.

**Layer 1 — Semantic (status & deltas only).** Red/amber/green/blue strictly for status; never decoration. OKLCH-anchored: `--success` ~hue 145, `--warning` ~hue 75, `--danger` ~hue 25, `--info` ~hue 240, `--neutral` chroma ≤ 0.02.

**Layer 2 — Chart (platform-brand-mirrored).** New direction vs v1 [07§Top-10 #4, §Quick reference]: **use real platform brand colors**. Operators intuitively map "blue line = Meta" without a legend lookup — colors already memorised from every other surface in their life (Meta/Google/TikTok own UIs).

| Channel | Hex anchor | OKLCH (approx) | Notes |
|---|---|---|---|
| Meta | `#1877F2` | `oklch(56% 0.20 257)` | Facebook brand blue |
| Google | `#FBBC04` | `oklch(82% 0.16 90)` | Google Ads brand amber |
| TikTok | `#FE2C55` | `oklch(63% 0.27 12)` | Brand pink shifted slightly to magenta to clear semantic-red collision |
| Organic | (derive from OKLCH) | `oklch(70% 0.14 175)` | Teal — orthogonal to all platforms and annotations |
| Shopify | (derive from OKLCH) | `oklch(55% 0.18 165)` | Shopify bag-green muted; paired with cart-icon prefix; treated as e-commerce backend, not a chart line |

(Hex anchors are reference; Phase 2 picks exact OKLCH that L-anchors to the dark mirror.)

**How this resolves the 7 collisions** from §2.1:

1. **TikTok-red ↔ status-red** — TikTok shifts to OKLCH hue 12, semantic red stays at 25 (ΔH ≥ 13° + ΔC ≥ 0.09).
2. **Google-amber ↔ status-warning** — Google brand sits at hue 90 / chroma 0.16; semantic warning shifts to hue 60 / chroma 0.10 (brand louder, warning quieter).
3. **Shopify-green ↔ status-green** — Shopify stops being a chart line color (chip with cart-icon prefix instead). Collision dissolved.
4. **Organic-violet ↔ annotation-sale** — Organic→teal (175); annotation-sale stays violet (305). ΔH = 130°.
5. **uzoshop-cyan ↔ annotation-creative** — store hue rotated to ~210; annotation-creative to ~180 + reduced chroma.
6. **usmile-lime ↔ annotation-launch** — store hue rotated; annotation chroma reduced.
7. **status-blue ↔ accent** — accent moves out of blue entirely (violet ~280 or indigo ~270), clear of `--info` at hue 240.

**Layer 3 — Brand (single accent).** One hue for primary CTAs, focus rings, selection, brand mark. Confident violet/indigo (final hue Phase 2). Stays clear of chart hues (Meta = 257; accent > 270 or < 250) and semantic-info-blue (240).

**Concrete changes:**

- **Delete legacy palette block** (`tailwind.config.ts:67-114`); migrate ~10 known consumers to tokens; add ESLint rule blocking legacy class names.
- **Hoist `chart-*` CSS vars** to one source (Plan 7 hoist item from MEMORY); `ChartContainer.tsx:36` stops overriding `--chart-axis` locally.
- **Collapse store-color maps** — four sources of truth (`format.ts:STORE_HUES`, `storeColors.ts:STORE_COLORS`, `format.ts:storeBadgeHex()`, `format.ts:STORE_HEX_LIGHT`) → one module, one fallback palette.
- **CI test** that no chart uses a semantic color and vice versa [07§Top-10 #4]; new `no-cross-palette-import` lint rule.

## Elevation & surfaces — hairline borders, flat surfaces

Switched from v1's "subtle shadows" to the **Vercel/Linear/Catalyst/Tran consensus** [07§Cross-cutting #2]: `1px solid` borders at 6-8% opacity, no drop shadows. Shadows reserved for `surface-overlay` and `surface-modal` only.

Four tiers, role-named (Vercel Geist "Material" pattern):

- **`surface-base`** — canvas. Light L=99%, dark L=15% (current OK).
- **`surface-raised`** — primary card. Light needs **ΔL ≥ 3** vs canvas (currently ΔL=1, invisible — bump raised to L=96% or warm the canvas). Dark stays L=19%. Border `1px solid rgba(0,0,0,0.07)` light / `rgba(255,255,255,0.08)` dark. **No shadow.**
- **`surface-overlay`** — popovers, tooltips, menus. Hairline + `shadow-overlay`.
- **`surface-modal`** — dialogs, drawers. Hairline + `shadow-modal` + backdrop blur.

Sub-bands (`--surface-elevated-2`) become `surface-recessed` — explicitly *lower* than raised; used only for table headers / tab strips. Restores the elevation grammar (today the sub-band is MORE distinct from canvas than the primary card).

Define `--shadow-overlay` + `--shadow-modal` (replace the undefined `--shadow-md` ref at `globals.css:282`). Deprecate `shadow-card`/`shadow-cardHover`/`shadow-elevated`/`shadow-innerHighlight`. Dark-mode shadows: near-black tint, not cool navy on dark navy.

Staging-sensitive — see §7. Wave-ordering puts elevation after legacy-palette sweep so two surface concepts don't change in the same PR.

## Typography ramp v2

Ship `<Heading level="display"|"hero"|"section"|"panel"|"label">` + `<Text variant="body"|"caption"|"code">` consuming the 11-step ramp at `tailwind.config.ts:147-159`. Migrate the 5+ H2 patterns. Enforce `tabular-nums` everywhere via a `<Num>` primitive that auto-wraps in `<bdi dir="ltr">`, applies tnum, accepts a tone for delta highlighting, and replaces the 38 hand-rolled `<bdi dir="ltr">` sites.

Font stack confirmed: **Heebo (Hebrew) + Rubik (tnum numerics; Heebo lacks tnum) + Geist Mono (IDs)**. [07§Cross-cutting #3] lands independently on tabular-nums as non-negotiable.

Weight roles: `font-medium` = body emphasis; `font-semibold` = panel/section H2/H3; `font-bold` = hero/display; `font-light` = Stripe-bridge for display KPI numerals.

## Theming pattern — Linear-style 3-variable LCH

New section vs v1, lifted from [07§Broader A.1 + §Cross-cutting #7].

**Today**: every token has a `:root` value + a `[data-theme="dark"]` override. ~98 pairs to maintain; the 5 dark-mode regressions in §2.1 all come from a token that forgot its override.

**Linear's pattern**: dark mode is generated from three root variables — `--bg-l` (base L), `--fg-l` (foreground L), `--accent-h` (accent hue). Every other token derives via `oklch()` math. Theme switch is six lines: `[data-theme="dark"] { --bg-l: 15%; --fg-l: 95%; }`. New tokens inherit dark mode automatically.

For us:

- Refactor `globals.css:13-229` structural tokens (`--surface-*`, `--text-*`, `--border-*`) as `oklch()` functions parameterised on `--bg-l` / `--fg-l`.
- Semantic and chart palettes stay as concrete hue locks (brand-stable across themes — Meta-blue is Meta-blue in dark, just lifted in L).
- Playwright + image-snapshot CI gate before/after so the refactor can't silently break a surface.
- Existing "every `:root` token must have a dark-mode override" CI rule (commit 537865a) stays as safety net during migration; relaxed only after LCH-derived tokens verified.

Makes the 5 dark regressions not just fixed but *unrepeatable*.

## Per-card freshness badges with stale desaturation

New section vs v1, lifted from [07§Cross-cutting #8, §Top-10 #7, §F #15] — Triple Whale / Posthog / Smashing-2025 pattern. Uses existing Phase B-D `data_freshness` registries directly.

- Tiny chip top-end of every data card: `● Live` (green, ≤ 10m) / `● ~10m` (gray, ≤ 30m) / `● ~2h` / `● Stale` (amber, > 30m).
- **Stale cards visually desaturate** — drop chroma on chart series + reduce value opacity (~70%). Card stays present but visibly *fades*; operator instantly sees "this is old."
- English chip label wrapped in `<bdi>`.
- Stale never alarms (no red, no banner) — quiet signal, operator chooses whether to refresh.

**Desaturation severity** is open (see §8) — aggressive (30% chroma after 30m, reads "fix this") vs gentle (60% after 1h, reads "FYI, slightly old"). Defaults locked in Phase 2 from operator feedback. Pattern is unusually well-suited because the freshness data already exists — work is purely UI surfacing.

## In-place drawer drill — re-affirmed

[07§Cross-cutting #10, §Top-10 #9] codifies "every drill is a drawer." Confirms our `CampaignDrawer` / `AdsDrawer` direction. The 1619-line `CampaignDrawer` split into horizontal sub-tabs (Overview / Performance / Targeting & Health / Mapping / Attribution) stays P1 from v1. Drawer-on-drawer (`AdsDrawer` from `CampaignDrawer`) stays P2 — Tran's pattern for nested drill is inline expanding row, not stacked. RTL: drawer slides in from the **left** edge, close × on the right (start in RTL).

## Visible scope line under page titles

New section vs v1, lifted from [07§Cross-cutting #5, §Top-10 #5]. Linear / Polaris / Catalyst pattern.

Every top-level page renders a thin scope line directly under H1:

```
<H1>קמפיינים</H1>
<scope>uzoshop • Meta • 30 ימים אחרונים • CAD</scope>
```

RTL read order: Store first on the right, then platform, range, currency. English store names wrap in `<bdi>`. Replaces "hunt for the dropdown" pattern; the operator never wonders what they're looking at — the answer is always above the fold.

Implementation: a `<PageScope>` primitive consumed by every top-level page, reading the filter context. Filters panel becomes the *edit surface* for the scope line.

## Iconography & emoji

**Kill emoji-with-Lucide** — confirmed by [07§Anti-patterns] as one of the loudest "hobby tool" tells. Sweep `annotations.ts:50` `ANNOTATION_KIND_EMOJI` (8 kinds → Lucide), `🏪` at `PerStoreCards.tsx:119` → `Store`, `⏸`/`🏷️`/`⏳` at `CampaignsTableRow.tsx` → `PauseCircle`/`Tag`/`Clock`. **Lock icon size scale to 3 values** (`sm=12`, `md=14`, `lg=18`, `hero=24`) + ESLint rule banning other literals.

## Motion vocabulary

Motion communicates **state changes**, not decoration. Define `--motion-snap: 120ms` / `--motion-fast: 180ms` / `--motion-base: 240ms` / `--motion-slow: 320ms`, single `cubic-bezier(0.16, 1, 0.3, 1)` ease-out. Respect `prefers-reduced-motion` (disable transitions > `--motion-base`; skeleton shimmer collapses to static).

Use cases: filter chip activation = snap; card hover, focus ring, tooltip = fast; drawer slide, dialog scale = base; page-level view transitions = slow. Animate drawer width on fullscreen toggle (currently jump-cuts). Stagger grid entrance (KpiCards, PerStoreCards) at 50ms/card — but only after the system is consistent first.

## Primitive enforcement

Three layers (no Storybook per user):

1. **Lint gates** — extend the existing rule pattern (`no-hex-color-in-components`, `no-dark-variant-in-components`, `no-raw-button-in-components`) with: `no-physical-direction-in-components`, `no-raw-table-in-components`, `no-raw-input-in-components`, `no-native-title-tooltip`, `no-legacy-tailwind-class`, `no-emoji-in-jsx` (allowlist annotation data files), `no-icon-size-literal`, `no-cross-palette-import`.
2. **Codemod** — one PR per primitive family, staged for review: (a) legacy palette sweep, (b) physical→logical direction sweep, (c) `<Card>` migration of 9 hand-rolled surfaces, (d) `<Stat>` migration extending CVA for `prefix`/`chip`/`active`/`compact`, (e) `<TableBase>` + unified sort-header across 9 tables, (f) `Tooltip` sweep replacing 53 native `title=`.
3. **Regression tests** — extend `bidi.dom.test.tsx` to AdsDrawer/CampaignsTopList/CommandPalette/AnnotationsPanel/ProductsTable. Add Playwright visual regression for dark mode (5 regressing surfaces) plus per-page scope-line + stale-desaturation snapshots.

## Per-page synthesis layer

Biggest "feel" lever after color/primitive cleanup. Every page gets a one-sentence auto-generated TL;DR above the data:

- **Home** — HeroOverview's editorial sentence already does this; promote it to page hero (not a slot inside a 6-layer card).
- **Trends** — "ROAS ירד ב-8% ב-7 הימים האחרונים, בעיקר ב-uzoshop" above the chart.
- **Archive** — "2026 עד כה: CAD 1.2M מחזור, ROAS 2.84, החודש הטוב — אפריל" above the month tables.
- **Detail** — totals row at bottom (Total spend / Revenue / Period ROAS / Days) + summary at top.
- **P&L** — period-over-period comparison on the hero strip + COGS-jumped/fees-grew alert chips.

Logic lives in a new `lib/insights/` module consuming the same data the page already has. Small surface area.

## Home as command center

Proposed structure (collapses duplicate KPIs, restores goal anchor, promotes insights):

1. **Title + scope line** — `<H1>בית</H1>` + `uzoshop • All platforms • Last 7 days`.
2. **Status strip** (~64px) — Net Profit hero KPI (3× others), Goal Pace, period selector inline. Per-card freshness badges visible.
3. **Insight band** — InsightsBoard promoted to band 1, default-open (calm "all clear" state for zero items). Each insight is an action button.
4. **Today vs Period band** — one component with a `scope` prop, 4-5 tiles (not 17). TodayLive editorial sentence is centerpiece.
5. **Per-store band** — three clickable cards, each opening Campaigns pre-filtered. Trophy/risk badges stay.
6. **Trend chart** (default-collapsed) — RoasTrendChart from HeroOverview moves here or to Trends entirely.

`AnnotationsPanel` moves off Home to Trends (annotations need visual context over the chart).

---

# 5. Prioritized Recommendations

## P0 — must-fix for premium feel

| # | Finding | File:line(s) | Why P0 | Effort |
|---|---|---|---|---|
| P0-1 | Delete the legacy hex palette block; migrate ~10 consumers to tokens | `tailwind.config.ts:67-114`; `BillingSettings.tsx:86`, `PnLBreakdown.tsx:58`, `CampaignsTableRow.tsx:303`, `layout.tsx:47`, OAuth callbacks | #1 visual coherence risk; the dual-system schism makes every surface a coin-flip | M |
| P0-2 | Re-hue chart palette to **platform-brand-mirrored** colors — Meta blue `#1877F2`, Google amber `#FBBC04`, TikTok magenta `#FE2C55`, Organic teal, Shopify-as-special-category. Re-tune annotation hues to ΔH ≥ 30° from nearest chart series. Resolves all 7 documented collisions [07§Top-10 #4] | `globals.css:42-50, 157-165, 211-228` | Operational collisions — a single chart line could mean "TikTok" or "ROAS bad"; brand-mirroring also makes legends redundant | M |
| P0-3 | Add visible **scope line** under every page title (`<bdi>uzoshop</bdi> • Meta • 30 days`) — new `<PageScope>` primitive, RTL-aware order (store first on right) [07§Top-10 #5] | new `ui/PageScope`; `Dashboard.tsx` page wrappers, `operator/page.tsx` | Eliminates "wait, am I looking at all stores?" cognitive tax; replaces hidden-filter anti-pattern | M |
| P0-4 | Fix the 5 dark-mode surfaces (hero gradient, scrollbar, skeleton, `::selection`, `focus-visible`) + `border-line-subtle` structural use | `HeroOverview.tsx:273`, `globals.css:254-269, 295, 312-322`; `TableBase.tsx:21, 29` | Dark mode currently passes "I see it" but fails "I can use it for 8 hours" | M |
| P0-5 | Build `Typography` primitive (`<Heading>`/`<Text>`); migrate 5+ H2 patterns | new in `ui/`; sweep `TabHeader`, `SectionIntro`, `GoalTracker`, `CollapsibleSection`, `CampaignDrawer`, `AdsDrawer`, `InsightsBoard`, `PnLBreakdown`, `HomeLiveBand`/`HomeSummaryBand`/`HomePerStoreBand` | Single biggest hierarchy lever; 5 H2 styles for one semantic level | L |
| P0-6 | Migrate the 3 local `Stat` forks to a unified primitive; extend Stat's CVA for `prefix`/`chip`/`active`/`compact`/`hero` | `Stat.tsx`; sweep `AdsDrawer.tsx:543`, `CampaignDrawer.tsx:1575/1581`, `CampaignsTable.tsx:2490`, `ProductsTable.tsx:897`, `HeroOverview.tsx:650-707` `FloatingKpi` | Three implementations of "show a number with context" | L |
| P0-7 | Restructure Home — promote InsightsBoard to band 1, kill 12 of 17 KPI tiles, move GoalTracker back from P&L | `Dashboard.tsx:389-436`, `HomePerStoreBand.tsx:17-22`, `HomeSummaryBand`, `HomeLiveBand`, `KpiCards.tsx`, `GoalTracker.tsx:43` | Most overloaded page, most-important page; "what now?" is buried under 4 bands of "what happened?" | L |
| P0-8 | Switch elevation language: **hairline borders only**, drop card shadows. Shadows reserved for `surface-overlay` + `surface-modal` [07§Cross-cutting #2] | `globals.css` surface tokens; sweep card-using consumers | Vercel/Linear/Catalyst/Tran consensus; current `shadow-sm` on every card adds blur, not depth | M |
| P0-9 | Stop silent error swallowing — every `if (!r.ok) return { rows: [] }` fetcher distinguishes API failure from empty | `AdsDrawer.tsx:56-60` + similar in `MonthlyTables`, `Filters` SWR fetchers | Trust-killer; operator believes "no ads" when API failed | M |
| P0-10 | Mount `TooltipProvider`; sweep 53 native `title=` to blessed `Tooltip` | `layout.tsx`, `CampaignsTableRow`, `AdsDrawer:485-491`, `HealthScoreBadge`, `AttributionAnalysisPanel`, `CampaignFreshnessChip` | Native `title` collapses `\n` to spaces, no touch, no a11y | M |
| P0-11 | Fix Button focus-ring (currently same color as primary bg) + sweep `focus:outline-none` without ring | `Button.tsx:8, 13`; `BillingSettings.tsx:726-1127`, `ProductsTable`, `GoalTracker`, `YearSelector` (14 sites) | Focus on primary Button is invisible; keyboard nav surfaces invisibly elsewhere | S |
| P0-12 | Fix drawer close × hidden behind sticky header (bump SheetClose z-index or move into drawer's header) | `Sheet.tsx:48` vs `CampaignDrawer.tsx:800` / `AdsDrawer.tsx:341-350` | Operator hits maximise when reaching for close | S |
| P0-13 | Re-tune `border-line-subtle` usage: structural row separators use `border-line`, not subtle | `TableBase.tsx:21, 29`, `CampaignDrawer.tsx:800`, `InsightCardGroup.tsx:149`, `Card.tsx:60` footer | Documented at `globals.css:142-143` as decorative-only in dark — currently used as structural | S |
| P0-14 | Migrate the 6 visible Hebrew bidi P0 bugs | `CampaignsTopList.tsx:81-89` (`→` arrows), `CommandPalette.tsx:273-274, 322`, `AdsDrawer.tsx:336, 459`, `CampaignsTopList.tsx:54, 104`, `BillingSettings.tsx:589, 999`/`PnLBreakdown.tsx:309`/`CampaignsTable.tsx:2265, 2278, 2296` (CAD), operator tables (`JobsTable.tsx:191-195`, `ManualOverridesCrud.tsx:311-317`, `CronTickSnapshotsViewer.tsx:34-50`) | Operator-visible Hebrew bugs today | M |
| P0-15 | Rewire Analysis-Archive global filter — either disable the dropdown on this sub-tab or honor it in MonthlyTables | `AnalysisArchiveTab.tsx:13`; outer `AnalysisTab` wrapper in `Dashboard.tsx` | Silent ignore is the worst option; only tab in dashboard where global filter is a no-op | S |
| P0-16 | Define `--shadow-overlay` + `--shadow-modal` tokens (the only two blessed shadows post P0-8) + dark-mode-aware values; remove undefined `--shadow-md` reference | `globals.css:282`; new tokens | Recharts tooltips currently have no shadow; dark-mode shadows use cool navy on dark navy (invisible) | S |
| P0-17 | Confirm gate on `WhatsappTestButtons` (Danger tab) | `DangerTab.tsx:21`, `WhatsappTestButtons.tsx` | Sends real WhatsApp to production phones with zero confirmation | S |

## P1 — should-fix

| # | Finding | File:line(s) | Why P1 | Effort |
|---|---|---|---|---|
| P1-1 | Per-card **freshness badge with stale desaturation** — `<FreshnessBadge>` + `data-stale` CSS hook that drops chroma on chart series + reduces value opacity. Uses existing Phase B-D freshness data [07§Cross-cutting #8] | new `ui/FreshnessBadge`; sweep every card surface | High-leverage trust signal; the data is already there | M |
| P1-2 | Refactor structural tokens to **3-variable LCH theming** (Linear pattern): `--bg-l`, `--fg-l`, `--accent-h` drive every surface/text/border token via `oklch()` math [07§Cross-cutting #7, §Broader A.1] | `globals.css:13-229` structural token block | Replaces sprawling `[data-theme="dark"]` overrides with 6 lines; makes the 5 dark regressions unrepeatable | L |
| P1-3 | Build `PlatformBadge` primitive (icon + name + dot, brand-mirrored color); use everywhere platform name appears | new in `ui/`; sweep `CampaignsTableRow.tsx:375-378`, `CampaignDrawer.tsx:818`, `CampaignsTopList.tsx:54`, tables, tooltips | Platform identity exists only in chart colors today; tables/drawers render plain text | M |
| P1-4 | Build unified card surface (hairline-border default); migrate 9 hand-rolled cards | `Card.tsx`; sweep `InsightsBoard.tsx:222`, `KpiCards.tsx:280-285`, `GoalTracker` ×3, `PerStoreCards.StoreCard`, `HealthScorePanel`, `CommandPalette.tsx:514`, `TodayLive.tsx:103-120`, `Filters.tsx:70` | 9 surfaces masquerading as cards with 3 radii + 4 shadows | L |
| P1-5 | Unify sort headers — 3 helpers (SortHeader/AdSetSortHeader/AdSortHeader) → one `<TableHeaderCell sortable>` | `TableBase.tsx:35-62`; sweep `CampaignsTable.tsx:2477`, `AdSetTable`, `AdsDrawer` | Identical vocabulary, 3 implementations | M |
| P1-6 | Lint rule banning physical-direction classes; mechanical PR migrates the 47 remaining sites | new `local/no-physical-direction-in-components`; codemod top-10 offender files | Prevents RTL regression; closes the 15% gap | M |
| P1-7 | Replace 38 hand-rolled `<bdi dir="ltr">` with `<Num>` / `<BiDi>` primitive; route `lib/utils.ts:formatCurrency/formatNumber` through `format.ts` (return ReactElement) | new `ui/Num`, `ui/BiDi`; `lib/utils.ts` migration | Root cause of every "I built `CAD ${n}` by hand" violation | M |
| P1-8 | Migrate hand-rolled collapsibles to `CollapsibleSection` (which is implemented but unused) | `HomePerStoreBand.tsx:17-22`, `InsightsBoard.tsx:103-422`, `AnnotationsPanel.tsx:54-122`, `PnLBreakdown.tsx:69` | ~120 lines of duplicate state code; primitive exists | M |
| P1-9 | Skeleton primitive that matches final shape; replace plain "טוען..." text | new `ui/Skeleton`; sweep `CampaignsTable.tsx:1729-1751`, `ProductsTable.tsx:527+`, `AdsDrawer.tsx:354-369`, `CampaignDrawer` (no loading at all) | No skeleton matches shape; layout reflow when data lands | M |
| P1-10 | Make insights actionable — replicate `CohortComparisonPanel.onDrillCampaign` pattern across 6 panels | `HealthScorePanel`, `WhatsWorking`, `InsightsPanel`, `CampaignsTopList`, `MetaShopifyReconciliation`, `AttributionAnalysisPanel` | Insights are typographic, not interactive; 6 of 7 panels have no drill | M |
| P1-11 | Make per-store cards + per-platform spend chips clickable → drill into Campaigns (filter pre-applied) | `PerStoreCards.tsx:113-186`, `TodayLive.tsx:500-549`, `TodayLive.tsx:550-696` | Home is read-only; operator must visit Campaigns and re-filter | M |
| P1-12 | Add per-platform rollup (Meta total / Google total / TikTok total across all stores) | new section on Home or extend `TodayLive` narrative | Operator currently sums 3 card values mentally | S |
| P1-13 | Add synthesis sentence above each page's primary content (Trends, Archive, Detail, P&L) | `lib/insights/` module + per-page integration | Pages have zero synthesis layer | L |
| P1-14 | Replace emoji with Lucide icons | `annotations.ts:50`, `PerStoreCards.tsx:119`, `CampaignsTableRow.tsx:320/340/363` | Single biggest "hobby tool" tell — confirmed by [07§Anti-patterns] | S |
| P1-15 | Define spacing + motion + radius scales as semantic tokens | new `--space-*`, `--motion-*`, `--radius-*` in `globals.css`; primitive migration | Ad-hoc values fight any cross-surface rhythm | M |
| P1-16 | Standardize Recharts `<ChartContainer>` with default `dir="ltr"` | `ChartContainer.tsx`; remove explicit `dir="ltr"` from `CampaignsTable.tsx:1523`, `CampaignDrawer.tsx:1118` | 5 of 7 containers don't set it today; inconsistent margin behavior | S |
| P1-17 | Add CampaignDrawer horizontal sub-tab strip (Overview / Performance / Targeting & Health / Mapping / Attribution) | `CampaignDrawer.tsx` (1619 lines) | 8+ vertical sections on a 4-screen mobile scroll | L |
| P1-18 | Persist `Products` sub-tab in URL state | `Dashboard.tsx:638` | Only in-page state in the app that isn't URL-synced | S |
| P1-19 | Lock icon size scale to 3 values + ESLint rule | new `local/no-icon-size-literal`; sweep 7 current sizes | Slightly-different-everywhere chrome feel | S |
| P1-20 | Override-badge on in-table filter toolbars (CampaignsTable, ProductsTable, CampaignDrawer date range) | `CampaignsTable.tsx:1264-1273`, `ProductsTable.tsx:391-490` | Tiny X-icon is insufficient indicator that local filter overrides global | S |
| P1-21 | `/operator` status strip header + default to Health (not Sync) | `operator/page.tsx:42-58` | Operator's first question is "is anything broken?" | S |
| P1-22 | Inline `BillingSettings` into PnLBreakdown's fixed-cost row | `Dashboard.tsx:468-470`, `PnLBreakdown.tsx` | Currently a stranded button at top of P&L | S |
| P1-23 | Slim collapsible icon-rail sidebar (64-72px collapsed / 240-256px expanded) with capital-letter section headers [07§Top-10 #6] | `Sidebar.tsx:16-23` | Saves ~180px horizontal space; aligns with Catalyst/Untitled/Tran convergence | M |

## P2 — nice-to-have / polish

| # | Finding | File:line(s) | Why P2 | Effort |
|---|---|---|---|---|
| P2-1 | Per-tab subtitle in sidebar when expanded (operator-tab pattern) | `Sidebar.tsx:76-104`; mirror `HealthTab.tsx:18-21` | Users can't predict tab contents | S |
| P2-2 | Rename "P&L" → "רווח" in sidebar | `Sidebar.tsx:18` | Only non-Hebrew label in the rail | S |
| P2-3 | Reorder sidebar by grouping (Overview/Trends/Entity/Raw) | `Sidebar.tsx:16-23` | Currently mixes "by question" and "by entity" mental models | S |
| P2-4 | Replace `AdsDrawer`-on-`CampaignDrawer` stack with inline expanding row (Tran pattern) | `AdsDrawer.tsx`, `CampaignDrawer.tsx` `AdSetTable` consumer | Drawer-on-drawer is fragile on mobile | L |
| P2-5 | Move `AnnotationsPanel` from Home to Trends | `Dashboard.tsx:416`, `AnalysisTrendsTab.tsx` | On Home it's a button with no payload visible | S |
| P2-6 | Sidebar collapse chevron direction-aware (today uses physical `ChevronsLeft`/`ChevronsRight`) | `Sidebar.tsx:170` | Current icons incoherent in RTL | S |
| P2-7 | Press feedback on chips (`active:scale-95`) — mode tabs, filter chips, HealthScoreBadge-style chips | `CampaignsTable.tsx:1190`, `Filters.tsx:80`, `HealthScoreBadge.tsx:77` | Only HealthScoreBadge has press scale today | S |
| P2-8 | Hover-row reveal of actions in tables (hide deeplink/refresh icons until row hover) | `CampaignsTable`, `AdsDrawer:407, 511`, `AdSetTable` | Permanent visual noise | S |
| P2-9 | Extend `MetricHelp` to every metric (AdsDrawer totals strip, CampaignDrawer Stat grid, CampaignsTable summary) | `KpiCards.tsx:298` is the only consumer today | "?" beside each metric is Premium-2026 default | M |
| P2-10 | Granular `ErrorBoundary` around heavy panels | `ErrorBoundary.tsx`, `CampaignsTable`, `HeroOverview`, `CommandPalette` | Render error today tears down whole dashboard | S |
| P2-11 | Auto-attach `Card.Header/Body/Footer` as namespace exports | `Card.tsx` | Inconsistent with `InsightCard.Group/Row` | S |
| P2-12 | Build `Sheet.Header` / `Dialog.Header` compound exports | `Sheet.tsx`, `Dialog.tsx` | Every drawer hand-rolls the sticky header | S |
| P2-13 | Tighten `text-muted` token one step (L=60% → L=52% light; mirror in dark) to clear 4.5:1 AA Normal | `globals.css:23, 137` | Currently at 4.0:1 — AA Large only | S |
| P2-14 | Add `--surface-elevated-3` (or `surface-deep`) for nested-card scenarios | `globals.css` | Currently consumers fall back to tinted-border hacks | S |
| P2-15 | Replace global `focus-visible` ring with token-driven `--accent` at 30% opacity | `globals.css:293-297` | Eliminates the visible double-ring on primitives | S |
| P2-16 | Localize English in operator log tables OR wrap in `<code>` to signal "internal" | `CronTickSnapshotsViewer.tsx:34-39`, `JobsTable` status badges, `StatusEventsFeed:54` | Mixed Hebrew/English with no visual cue | S |
| P2-17 | Add tab-trigger transparent 2px bottom border baseline to prevent layout shift | `Dashboard.tsx:506-507`, `operator/page.tsx:64` | Inactive label shifts up by 2px on activate | S |
| P2-18 | First-N-visits hint on CommandPalette trigger pill | `Dashboard.tsx:282-292` | Most powerful surface, most hidden | S |
| P2-19 | Consolidate freshness chips (top-header strip vs TabFreshnessHeader vs new per-card badge) | `Dashboard.tsx:281`, `TabFreshnessHeader`, P1-1 | After P1-1 lands, the global strip can shrink | S |
| P2-20 | Diagnostic empty states (Polaris/Tran pattern) — "No campaigns spent yesterday. [Connect ad account]" not "No data." [07§Top-10 #8] | All empty-state sites | Premium-tool feel | M |

---

# 6. Implementation Approach (preview only — Phase 2 will detail)

Suggested wave-ordering:

- **Wave 1 — Tokens + color re-hue.** Delete legacy palette block; migrate ~10 consumers. Implement three orthogonal palettes (semantic / chart-brand-mirrored / brand). Hoist `chart-*` vars, collapse four store-color maps into one. Define `--shadow-overlay`/`--shadow-modal`/`--space-*`/`--motion-*`/`--radius-*`. Foundation for everything downstream.
- **Wave 2 — Surface language + theming refactor.** Hairline-border elevation switch (P0-8). 3-variable LCH theming refactor (P1-2) — gated by Playwright visual snapshots from Wave 1. Dark-mode regression sweep (P0-4).
- **Wave 3 — Primitive enforcement.** Land new ESLint rules. Ship `Typography`, `PlatformBadge`, unified `Stat`, `Num`/`BiDi`, `Skeleton`, `Tooltip` (mount provider), `FreshnessBadge`, `PageScope`. Codemod by family: cards → tables → drawer headers → tooltips.
- **Wave 4 — Home restructure + scope line + synthesis layer.** Ship `<PageScope>` across all top-level pages (P0-3). Promote InsightsBoard to band 1. Kill 12 of 17 KPI tiles. Move GoalTracker back to Home. Build `lib/insights/` synthesis module + per-page TL;DRs (Trends/Archive/Detail/P&L). Inline BillingSettings into PnLBreakdown. Per-card freshness badges + stale desaturation live (P1-1).
- **Wave 5 — RTL P0 fixes + logical-class sweep.** Six Hebrew bidi bugs (P0-14), 47 physical classes via codemod, `<ChartContainer dir="ltr">` default, `→` arrow sweep, operator-table column alignment, `dir="auto"` on free-text inputs.
- **Wave 6 — Per-page polish + motion.** CampaignDrawer horizontal sub-tabs, DetailTable totals/sort/drilldown, Analysis-Archive filter wiring, Operator status pill + Health default, slim collapsible sidebar (P1-23). Staggered card entrance + drawer-width animation + press feedback on chips.

Each wave ships as one or more PRs, gated by new ESLint rules + Playwright snapshots so regression can't land mid-flight.

---

# 7. Risks & Assumptions

- **Platform-brand-mirrored chart palette uses real Meta/Google/TikTok colors.** If a platform rebrands (Twitter→X precedent), our palette drifts until we update. Acceptable for internal use; the mnemonic outweighs the drift risk. Document source brand hex in `globals.css` comments for one-place re-tuning.
- **3-variable LCH theming refactor is touchier than it looks.** Sloppy execution produces washed hues, broken contrast on derived chips, or mixed OKLCH/HSL math. Gating: Playwright + image-snapshot CI before AND after, with manual visual-diff review. Stage as its own PR with no other token changes co-landing.
- **Hairline-border discipline conflicts with existing card-shadow language.** Mid-PR mix of `shadow-sm` and `border` produces visually inconsistent intermediate state. Wave-ordering puts the elevation refactor (P0-8) *before* primitive enforcement so the switch happens once codemod-wide.
- **Re-hueing platform colors changes muscle memory.** TikTok red→magenta and Organic violet→teal will feel wrong for the first session. Brand-mirrored colors mostly align with each platform's own UI; communicate in the User Manual.
- **Codemod for primitive adoption may produce a massive diff.** Stage by component family (cards → tables → tooltips → drawer headers) so each PR is reviewable. Legacy-palette deletion touches ~10 files; table-unification touches all 9 table sites.
- **Adding synthesis layers requires computing the synthesis.** Insight rules, anomaly detection, period-over-period deltas — new logic in `lib/insights/`, not just visual rework. Reuse existing page data shapes.
- **Per-card freshness badge needs a freshness lookup layer.** Phase B-D registries store freshness at (store, platform, scope, date) grain; computed aggregates inherit from multiple sources — take the oldest.
- **Dark-mode regressions imply dark mode is under-tested.** The 5 surfaces (hero gradient, scrollbar, skeleton, `::selection`, focus-ring) all bypassed their own tokens. Playwright dark-mode visual regression after Wave 2 is non-negotiable.
- **The 1619-line CampaignDrawer touches every drill-down.** P1-17 sub-tab split risks breaking muscle memory. Land behind a feature flag, A/B with the operator, ship after one week of soak.
- **`<details>` → `CollapsibleSection` migrations change keyboard behavior.** Radix Collapsible has different focus management than native `<details>`. Verify keyboard chord.
- **Animation regressions.** `tailwindcss-animate`'s `slide-in-from-end` may use physical directions internally — verify before drawer width animation lands (04-rtl-bidi.md §P1-6).
- **`lib/format.ts` (ReactElement) vs `lib/utils.ts` (string) bifurcation is load-bearing.** P1-7 must trace every consumer that expects a string (some passed to `aria-label` / `title=` where ReactElement won't render).
- **Unresolved contradiction**: 03-ia-navigation.md recommends `CollapsibleSection` migration; 06-per-page-critique.md flags a Radix Tabs layout-shift bug at `Dashboard.tsx:502-507`. Interaction (Collapsible inside Tabs) needs verification.
- **Unresolved contradiction**: 02-visual-system.md proposes deleting the legacy palette outright; 05-components-interactions.md identifies 9 hand-rolled cards that may have inline `style={{ background: '#...' }}` hex literals. The sweep PR must catch both class-name AND inline style usage.

---

# 8. Open Questions for User

1. **Are you OK with platform-brand-mirrored chart colors?** Meta Facebook-blue, Google amber, TikTok hot-pink — the colors users already know from each platform's own UI. Or do you want a more neutral semantic-only palette (e.g., distinguishable but de-saturated, not visually tied to the brands)?
2. **Per-card stale desaturation severity.** Aggressive (drops to 30% chroma after 30 min, reads as "fix this") or gentle (drops to 60% after 1h, reads as "FYI, slightly old")? Affects how visible "cold data" is.
3. **Accent hue.** Are you committed to the current navy/indigo accent, or open to a confident violet (helps separate the brand accent from Meta-blue chart color)?
4. **Shopify as a distinct category.** Visually separate Shopify from the ad platforms (cart-icon prefix + special surface treatment), or keep it as another channel color?
5. **GoalTracker placement.** Memory note says "monthly goal panel is global" — confirm we should move it back to Home as a hero tile (it currently lives on P&L only)?
6. **Synthesis sentences (Trends/Archive/Detail/P&L).** New auto-generated TL;DR copy per page — Hebrew tone preference? Authoritative ("ROAS ירד 8%") or hedged ("נראה שירד")?
7. **Dark mode visual regression.** OK to introduce Playwright + image snapshot CI gate? Required for the LCH theming refactor; recommended either way.
8. **CampaignDrawer sub-tab restructure.** Acceptable to ship behind a feature flag and A/B with you for a week before flipping everyone over? Or do it as a single hard cut?
9. **Insights actionability.** For "Open campaign" action: should it open the in-app `CampaignDrawer` (current pattern) or deep-link to external Meta/Google Ads Manager (where the actual change happens)? Both, with the in-app drawer as default and "open in Ads Manager" as a secondary action?
10. **Slim icon-rail sidebar.** Collapse to 72px by default and expand on hover/click? Or stay at current expanded-by-default width? RTL puts the sidebar on the right edge of the viewport, where collapse reclaims pixels for content.

---

# Appendix: Source Reports

- [01 — External research](../../../.planning/audit-2026-05-31-premium/01-external-research.md)
- [02 — Visual system](../../../.planning/audit-2026-05-31-premium/02-visual-system.md)
- [03 — IA & navigation](../../../.planning/audit-2026-05-31-premium/03-ia-navigation.md)
- [04 — RTL & bidi](../../../.planning/audit-2026-05-31-premium/04-rtl-bidi.md)
- [05 — Components & interactions](../../../.planning/audit-2026-05-31-premium/05-components-interactions.md)
- [06 — Per-page critique](../../../.planning/audit-2026-05-31-premium/06-per-page-critique.md)
- [07 — Figma deep research](../../../.planning/audit-2026-05-31-premium/07-figma-deep-research.md)
