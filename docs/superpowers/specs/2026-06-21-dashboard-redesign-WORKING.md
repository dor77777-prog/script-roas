# Dashboard Full Redesign — WORKING DOC (brainstorming in progress)

**Date:** 2026-06-21 · **Status:** brainstorming (direction-finding via Magic) — NOT yet a finished spec
**READ FIRST on resume (esp. after a Claude Code restart for Magic MCP).**

## Resume instructions
The operator wants a FULL redesign of the dashboard — visual + structural — at a much higher
bar. Direction is found by having **Magic MCP (21st.dev) generate 2-3 mockup directions**; the
operator picks/combines. We were about to: confirm the Magic brief → operator restarts Claude
Code so Magic tools load → generate the 3 directions as openable mockups. After a restart,
verify Magic tools are available (ToolSearch / they appear at session start), then generate.

## Locked decisions (from the operator)
- **Scope:** full overhaul — visual polish AND structural / IA reorganization of ALL tabs & cards ("לסדר את הממשק").
- **Direction process:** Magic generates 2-3 distinct premium directions (mockups); operator picks/combines.
- **Workflow:** superpowers (brainstorming → Magic mockups → writing-plans → subagent-driven build, TDD). HARD GATE: no code until design approved.

## NON-NEGOTIABLE constraints (carry into every direction + the build)
- **ROAS-band coloring + ranges stay 1:1** (operator-locked): red `<2.0` / orange `2.0–2.7` / green `2.7–3.0` (3.00 inclusive) / blue `>3.0` / gray `spend=0` / **red-alarm** `spend>0 & revenue=0` (loud, pulsing). White-on-band text. State gradient + freshness desaturation (fresh<15m / aging15-30m / stale>30m). Source: `src/lib/roasBands.ts` (`bandForRoas`), `src/lib/format/useRoasBandGradient.ts`, tokens in `src/app/globals.css` (`--band-*`, `--on-band-*`, `--band-grad`, `--band-scrim`). Hebrew band tags: דורש בחינה / 0 מכירות / סביר / טוב / מעולה / אין נתונים.
- **Zero information loss** — every card / section / data point in the per-tab inventory below MUST survive (reorganize/relabel OK; delete/hide forbidden). Tag each as STAYS / MOVES / NEW — never REMOVED.
- **Both light AND dark**, token-driven (no hardcoded colors in components), one source of truth.
- **Mobile-first**, RTL (Hebrew). WCAG-AA both themes (on-band/scrim tokens, never text-color-from-brand). Numbers never clip (`<Money>`/`<Metric>` primitive). Chart ink legible on any band (plot scrim/halo).
- New UI must pass existing readability/contrast CI guards (`src/lib/__tests__/contrastGuard.test.ts`), not bypass them.

## Current state map (the thing we're redesigning)

### Tabs (10) — `src/components/Sidebar.tsx:28-48`, routed in `src/components/Dashboard.tsx`
1. **home** (בית) — `HomeTab()` inline in Dashboard.tsx
2. **activity** (פעילות) — `src/components/activity/ActivityTab.tsx`
3. **customers** (לקוחות) — `src/components/CustomerValueTab.tsx`
4. **archive** (טבלאות אופטימיזציה) — `src/components/AnalysisArchiveTab.tsx`
5. **pnl** (P&L) — `src/components/PnLBreakdown.tsx`
6. **trends** (מגמות) — `src/components/AnalysisTrendsTab.tsx`
7. **campaigns** (קמפיינים) — `src/components/CampaignsTable.tsx`
8. **products** (מוצרים) — `src/components/ProductsTable.tsx`
9. **payments** (תשלומים) — `src/components/PaymentMethodsTab.tsx`
10. **detail** (פירוט) — `src/components/DetailTable.tsx`
Operator admin panel: `src/app/operator/` (separate route).

### Per-tab inventory (no-info-loss list)
- **HOME:** TabFreshnessHeader + SourceHealthChip; ReconcileBanner; SectionIntro "לפי חנות" + PerStoreRow (3 store cards: ROAS/spend/revenue/CPM/orders/sparkline); StoreCompareGrid; StoreDetailModal; SectionIntro "סיכום עסקי" + CommandCenterHero (6 KPI cards: OpProfit/Revenue/Spend, ROAS/Orders/CPM, each w/ delta+freshness+band); RoasTargetChart (own date-range, annotation pins); NcByPlatformCard (NC-ROAS by Meta/Google/TikTok/Direct); InsightsBoard (action cards) + ActivityFeed (live events).
- **ACTIVITY:** ActivityEventsTab (real-time events, filter store/platform) + ActivityStatsTab (hourly/daily breakdown).
- **CUSTOMERS:** cohort/scope selector; LTV hero (blendedNcac, LTV:nCAC verdict, payback); CustomerValueCurve (cohort LTV multi-line); monthly nCAC table.
- **PNL:** P&L summary cards (Gross Rev, COGS, OpProfit, Spend, True Net); P&L cascade table (by-store subtotals); billing settings drawer (COGS%/salary/fixed costs).
- **TRENDS:** trend charts (ROAS/Revenue/Spend/Orders over time); weekly/monthly toggle.
- **ARCHIVE:** Year + Month selectors; mode toggle (Product/Campaign/Ad-Set/Ad); MonthlyTables per mode + band legend.
- **CAMPAIGNS:** CampaignsTopList (carousel); CampaignsTable (drill, band rows, status badges); CampaignDrawer (Status/Daily/Ads tabs) + nested AdsDrawer.
- **PRODUCTS:** period toggle; ProductsTable (Product/Units/Orders/Revenue/RefundRate/AOV); ProductPickerModal.
- **PAYMENTS:** gateway summary (share-bar); MonthlyTables (mode=payment-gateway).
- **DETAIL:** store+date filters; daily rows (date×store×platform: Spend/Revenue/ROAS/Orders/CPM).

### Tokens / theme — `src/app/globals.css` (:root=dark, [data-theme=light]=overrides), `tailwind.config.ts`
Canvas (--canvas-1/2 navy #0b1437 dark), glass 3-layer (--glass-1/2/3 #111c44/#162048/#1B254B), accent brand violet (--accent #7551FF, --accent-deep #422AFB), text stack (--text/-2/-muted/-subtle, muted #A3AED0), sidebar (--sidebar #111c44, --sidebar-fg #A3AED0), spacing (--space-1..12), motion (--motion-snap 120ms..large 480ms, --ease-out cubic-bezier(0.16,1,0.3,1)), radius (--radius-control 10 / chip 11 / card 18 / hero 18 / pill). Re-skin = edit globals.css vars only.

### Primitives — `src/components/ui/`
Button, Card, Money, MoneyAnimated, Stat, Sparkline, CountUp, TableBase(+THead/etc), SegmentedControl, NativeSelect, Input, Textarea, Checkbox, Switch, Tooltip(+HelpTooltip), Sheet(+SheetContent/Title), Badge, StatusPill, FreshnessBadge, ProvenanceFlag, OverrideFlag, PlatformBadge, SourceBadge, AiInsightPill, StateBlock, SortableHeader, Widget, InsightCard, Typography(Heading/Paragraph), PageScope, PageSynthesis, ChartAnnotationPins.

### Shell — `Dashboard.tsx` (dir=rtl, flex)
Sidebar (desktop 72px rail ↔ 200px pinned; mobile off-canvas Sheet drawer; RTL start-side) + TopStrip (title, freshness chip, ⌘K palette, sync, AI-report; hamburger mobile) + main (role=tabpanel, max-w-7xl, responsive px/py). ThemeProvider (system/light/dark, no-flash). 120s auto-refresh, View Transitions on tab switch.

### Current visual baseline = "Horizon" re-skin (shipped 2026-06-13)
Deep navy canvas, opaque 3-layer glass cards, brand-violet accent, vivid deepened ROAS-band gradients w/ white text, store-hue per-store cards (OKLCH-locked), light series on dark plot scrim, striped tables w/ brand hover rim. Spec: `docs/superpowers/specs/2026-06-12-horizon-reskin-design.md`.

## Structural opportunity (the "reorganize" half)
10 flat tabs is heavy navigation. They cluster naturally into ~4-5 areas:
- **Overview/Command:** home
- **Performance/Ads:** campaigns, products, trends, archive
- **Financial:** pnl, payments
- **Customers/Retention:** customers
- **Live/Operational:** activity, detail
A structural overhaul could introduce grouped navigation + a cleaner primary/secondary hierarchy per screen. All tabs/data stay; just better organized. (Magic directions will make competing IA proposals concrete.)

## Magic brief — 3 directions to generate (after restart)
Each direction = an openable mockup (static HTML, light+dark) of the **home** screen + 1-2 representative deep tabs (likely campaigns table + pnl), embodying BOTH a visual language AND an IA:
- **A — "Horizon elevated":** same IA, major premium polish (typography, depth, spacing, motion, data-viz finesse). Safe/evolutionary.
- **B — "Unified command center":** grouped nav (~4-5 areas), sharp primary/secondary hierarchy, denser-yet-calmer overview. Structural leap.
- **C — "Bold/novel":** distinctive visual language + inventive layout (push the bar), still honoring all locked constraints.
All three: ROAS-band system 1:1, light+dark, mobile-first, RTL, token-driven, zero info loss, WCAG-AA. Deliver as `open`-able links; operator iterates in their own browser.

## Next steps
1. Operator confirms/redirects this brief.
2. **Operator restarts Claude Code** (loads Magic MCP tools). NOTE: restart ends this session's background monitors; migration runs on Vercel regardless — re-verify the overnight daily cron from the DB next session (see migration memories).
3. Generate the 3 directions via Magic → send openable links.
4. Operator picks/combines → present full design (sections) → approval → write the real spec → writing-plans → subagent-driven build.
