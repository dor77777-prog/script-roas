# IA + Navigation + Density Audit

Scope: top-level tab structure, per-page composition, drill-down coherence, filters, command palette, and density of the Home/P&L/Trends/Archive/Detail/Campaigns/Products/Operator surfaces. Reviewed at main @ afc9bf6 in the worktree `ui-ux-design-system-overhaul-2026-05-30`.

A note on the brief's tab list: the brief assumes six top-level tabs (Home / Trends / Archive / P&L / Detail / Operator). The actual implementation has **six in-page tabs** (`home`, `pnl`, `analysis`, `campaigns`, `products`, `detail`) declared at `Sidebar.tsx:16-23`, plus the `/operator` route, plus a hidden second-level Radix tab split inside `analysis` for `מגמות` (Trends) vs `היסטוריה` (Archive) declared at `Dashboard.tsx:502-516`. So the real surface is **7 destinations + 1 nested split + 4 operator sub-tabs = 12 leaves**, which is materially more than the brief suggests and is itself a finding.

---

## Top-level structure findings

### The sidebar list and its naming

`Sidebar.tsx:16-23` declares the canonical nav order:

1. `home` → "בית"
2. `pnl` → "P&L"
3. `analysis` → "ניתוח"
4. `campaigns` → "קמפיינים"
5. `products` → "מוצרים"
6. `detail` → "פירוט"

Plus a footer link to `/operator` → "ניהול" (`Sidebar.tsx:108-118`). The footer demotion is correct — Operator is a maintenance console, not a daily reading surface — and the icon choice (`Cog`) reinforces that.

The Hebrew tab labels are short and concrete, which is good for a single Hebrew-first operator who reads them daily. The two soft spots:

- **"P&L" is the only non-Hebrew label** (`Sidebar.tsx:18`). It is also the only acronym, and it sits second in the list. The rest of the nav has Hebrew-only labels with Lucide icons; "P&L" reads as an English ledger term in an otherwise translated nav. Possible: "רווח" or "רווח נטו". This breaks the visual rhythm of the rail.
- **"ניתוח" (Analysis) is generic** for a tab that is really a wrapper around two unrelated things — a global ROAS trend chart (`AnalysisTrendsTab.tsx`) and a per-store-per-month archive table (`AnalysisArchiveTab.tsx`). The user has to click into the tab and *then* pick a sub-tab to know which kind of analysis they want. Splitting them to two top-level tabs (`מגמות` and `היסטוריה`) would remove the indirection but cost a sidebar slot. The current Radix split inside (`Dashboard.tsx:502-516`) is the worst of both worlds: top-level says "ניתוח" but the next click is always between two sibling things, doubling clicks for any return visit.

### Ordering

The current order (Home → P&L → Analysis → Campaigns → Products → Detail) mixes two mental models:

- **By question**: Home (what's happening) → P&L (am I profitable) → Analysis (how am I trending)
- **By entity**: Campaigns → Products → Detail (raw rows)

There is no clear boundary between the two. The user has to context-switch between "ask a question" and "browse an entity". A cleaner grouping, mirrored in many BI dashboards, would be: **Overview group** (Home, P&L) → **Trends group** (Analysis-Trends, Analysis-Archive) → **Entity group** (Campaigns, Products) → **Raw** (Detail). With six items a section divider is enough; sub-grouping in the rail would help even more on mobile where the drawer is full-width.

### Operator sub-tabs

`operator/page.tsx:33-38` cleanly splits the maintenance console into four Radix sub-tabs:

1. `סנכרון` — SyncNowButtons + BackfillPicker + ManualOverridesCrud (`SyncTab.tsx:11-37`)
2. `בריאות` — TokenFailuresTable + TikTok disclaimer + MetaBucPanel + FreshnessPanel (`HealthTab.tsx:12-75`)
3. `פעילות` — StatusEventsFeed + CronTickSnapshotsViewer + JobsTable (`ActivityTab.tsx:11-49`)
4. `מסוכן` — WhatsappTestButtons + ResetData (`DangerTab.tsx:14-56`)

This is the most disciplined IA on the whole dashboard. Each sub-tab has one verb (sync, monitor, observe, destroy) and each lists exactly the controls that fit that verb. The one quibble: `בריאות` and `פעילות` overlap conceptually — a token failure is an event, a cron lag is an event. If the operator wants to know "what went wrong in the last hour" they have to check both. Consider folding `StatusEventsFeed` into the top of `בריאות` and making `פעילות` purely the raw cron/jobs viewer.

The `OperatorSecretBanner` (`operator/page.tsx:56`) renders above the tab list — correct, since the secret gates *all* tabs.

---

## Per-page density review

### Home tab — `Dashboard.tsx:389-436` + `HomeLiveBand` + `HomeSummaryBand` + `HomePerStoreBand`

Above-the-fold inventory on a 1440×900 desktop:

| # | Component | Vertical band |
| --- | --- | --- |
| 1 | TabFreshnessHeader (FreshnessChip + "Refresh All" button + spinner state) | `Dashboard.tsx:335` |
| 2 | TabHeader ("בית" + description + Filters + AiReportButton) | `Dashboard.tsx:408-413` |
| 3 | AnnotationsPanel (collapsed by default, but still 56-72 px tall) | `Dashboard.tsx:416` |
| 4 | HomeLiveBand: "עכשיו" header + LIVE card with narrative + 6 LiveStats + per-store cards | `HomeLiveBand.tsx:6-15`, `TodayLive.tsx:420-497` |
| 5 | HomeSummaryBand: "היום מול אתמול" header + HeroOverview (story sentence + 5 floating KPIs + ROAS trend chart + context strip) + KpiCards grid (6 KPI cards) | `HomeSummaryBand.tsx:8-21`, `HeroOverview.tsx:263-396` |
| 6 | HomePerStoreBand: "לפי חנות" header + 3 PerStoreCards + `<details>` ("תובנות והמלצות") | `HomePerStoreBand.tsx:11-25` |

Counting only **above-the-fold** primary metrics, the user sees at first paint:

- 1 freshness chip + 1 refresh button (header strip)
- 1 store dropdown + 4-5 quick-range presets + 1 AI report button + 1 toggle (filters)
- 1 LIVE pulse + 1 narrative sentence + 6 LiveStats (ROAS, revenue, spend, gross profit, orders, CPM) + 3 per-store live mini-cards (each with 6-8 metrics)
- Probably 20-25 distinct numeric values just in the LIVE band — and then below the fold, the HeroOverview re-asks the same questions (revenue / ROAS / spend / net / CPM) but for the *selected range* instead of today, then KpiCards re-asks them again (ROAS / revenue / spend / gross profit / COGS / net) with sparklines, then PerStoreCards re-asks them per-store (ROAS / revenue / spend / Meta / Google / TikTok / orders / gross profit).

This is **the same five questions answered four times** at different time windows and scopes. The information is not wrong — different scopes are different answers — but the page does not visually distinguish "today" from "this period" from "per store"; all four bands use the same card styling, the same color tones, and the same metric labels. The only differentiators are tiny headers like "עכשיו", "היום מול אתמול", "לפי חנות" (`HomeLiveBand.tsx:9`, `HomeSummaryBand.tsx:11`, `HomePerStoreBand.tsx:14`). Those headers are 14 px medium-weight grey text; they don't carry enough visual weight to act as scope dividers.

The InsightsBoard placement inside HomePerStoreBand as a `<details>` (`HomePerStoreBand.tsx:17-22`) is interesting. It is the *only* surface where the system synthesizes "what should I do?" but it is shipped as a native `<details>` element, not as the more polished `CollapsibleSection` that already exists in the repo (`CollapsibleSection.tsx:21`). It is also placed third in the per-store band rather than first on the page, which means the "what should I do?" answer is below 4 bands of "what happened?" cards.

GoalTracker (`GoalTracker.tsx:43`) used to sit in HomeTab and was moved to PnLTab (`Dashboard.tsx:465`) per the memory note "GoalTracker moves Home → P&L". This is correct conceptually (goal pacing is a financial question), but it means **the home tab has no goal anchor at all** — neither the LIVE card nor the Hero shows progress toward the monthly target. The user has to switch tabs to see "am I on pace this month?", which is among the top three questions.

**Density verdict**: Home is the most overloaded page in the dashboard. Roughly 30-40 individual data points compete above the fold; on mobile the situation is even worse because everything reflows to single-column stacks. The page reads as "every important number, in case you wanted any of them" rather than "the answer is X, here is why".

### P&L tab — `Dashboard.tsx:443-481`

Above-the-fold inventory:

1. TabFreshnessHeader
2. SectionIntro ("הרווח שלך לתקופה" + description + formula pill) — `Dashboard.tsx:456-461`
3. Filters
4. GoalTracker — large, with progress bar + pace marker + projection (`GoalTracker.tsx`)
5. BillingSettings button (top-right of the breakdown)
6. PnLBreakdown — collapsible, **open by default** (`PnLBreakdown.tsx:69`), with full income-statement waterfall: Revenue → −Ad Spend → −COGS → −Fees → −Fixed → True Net Profit

This is the most disciplined page in the whole dashboard. Single question, single answer, with a hierarchical waterfall. The only friction: `BillingSettings` ships as a button hovering above the table (`Dashboard.tsx:468-470`); it should be inline at the relevant table row (the fixed-cost line) so the user clicks the cost they want to edit. Currently the user clicks "settings" then has to mentally re-map the modal output back to the table.

The duplication concern: GoalTracker shows monthly *revenue* pacing, but the PnLBreakdown shows *profit*, so they aren't redundant. They're complementary, which is good. P&L is the only tab that pulls this off.

**Density verdict**: Calm and intentional. Could be tightened by inlining BillingSettings, but otherwise this is the model.

### Analysis tab (Trends + Archive) — `AnalysisTrendsTab.tsx` + `AnalysisArchiveTab.tsx`

The Radix sub-tab split (`Dashboard.tsx:502-516`) is hidden inside the page chrome and is easy to miss — operator-feedback in the codebase memory notes confirms this pattern is friction-laden.

**Trends sub-tab** (`AnalysisTrendsTab.tsx`):
1. SectionIntro ("טווח לניתוח" — explains the filter ONLY affects this chart, not the archive)
2. Filters
3. SectionIntro ("מגמת ROAS לאורך זמן")
4. RoasChart
5. AnnotationsPanel

The two SectionIntros stacked on top of each other (`AnalysisTrendsTab.tsx:25-36`) are redundant — `SectionIntro` is used twice in a row, the first to explain the filter scope ("הסינון מטה משפיע על גרף המגמה בלבד"), the second to explain what the chart is. Density-wise this is two header bands for one chart.

**Archive sub-tab** (`AnalysisArchiveTab.tsx`):
1. SectionIntro
2. YearSelector + MonthSelector (two `<select>`-style controls stacked vertically)
3. MonthlyTables (one table per store per month-range)

The year+month selectors are independent of the global `Filters` panel and explicitly bypass it (`AnalysisArchiveTab.tsx:13` "globalStore: Unused"). This is the **only place in the entire dashboard** where the global filter dropdown does nothing — a major scope-of-control inconsistency the user has to learn. Worse, the global store filter at the top of the page is *still rendered* via the outer `AnalysisTab` wrapper, so the user can change it and see nothing happen.

**Density verdict**: Trends is tight. Archive is fine but the implicit "your global filter is ignored here" needs an explicit disabled state or a switch to local store filters.

### Campaigns tab — `Dashboard.tsx:575-604`

Above-the-fold inventory:

1. TabFreshnessHeader
2. SectionIntro (long description with formula pill) — `Dashboard.tsx:586-591`
3. Filters
4. QuadrantScatterCard wrapping `CampaignsTopList` ("הקמפיינים הבולטים — מנצחים ולתשומת לב") — `Dashboard.tsx:572`
5. CampaignsTable (`Dashboard.tsx:595-601`) — 2556 lines, 17 sortable columns, infinite-feeling table

The interplay between the top-list and the full table is correct (highlight the 5-best and 5-worst, then offer the full list). The friction is the table itself: 17 columns including 6 different Shopify-attribution columns (`CampaignsTable.tsx:87-105`) is a forest of headers. The CampaignsColumnsMenu (`CampaignsColumnsMenu.tsx`) exists to manage this, but the default column count is still high. This is appropriate for power users (the operator is the only user) but the default density is steep.

**Density verdict**: Reasonable for the use case. The CampaignsTopList up top is a good "summary first" pattern. If anything is overloaded it is the table, not the page composition.

### Products tab — `Dashboard.tsx:609-705`

The page has an in-page sub-tab pattern (`Dashboard.tsx:611-622`) splitting "מוצרים שנמכרו" (the products table) and "מוצרים → קמפיינים" (the product-centric pivot). The split was added per operator feedback 2026-05-26 (Dashboard.tsx:633-637 comment). Good split, correct rationale. **The split is in-page state, not URL state** (`Dashboard.tsx:638`) — so the operator can't deep-link to the pivot view. For a single-operator dashboard that ships shareable URLs (via `urlState.ts`) this is an unnecessary asymmetry with the rest of the app.

**Density verdict**: OK. The sub-tab split keeps each view single-purpose.

### Detail tab — `Dashboard.tsx:710-734`

The simplest tab. SectionIntro + Filters + a single DetailTable (`DetailTable.tsx:30`). Renders up to 100 most-recent (day × store) rows with 10-12 columns including a per-store ROAS sparkline. This is the "raw row" surface and behaves accordingly — single question, single answer.

**Density verdict**: Calm. Could even afford to add per-day expandable rows (drill into the campaigns for that day-store) without becoming overloaded.

### Operator — already covered in "Top-level structure findings"

The four sub-tabs are individually disciplined. Each section has its own H2 + small descriptive byline (`HealthTab.tsx:16-21` etc.), which is a nice IA pattern repeated across all four. Density is high in `בריאות` and `פעילות` because each surfaces 3-4 dense tables, but that's the right call for a maintenance console.

---

## Trace: the 6 core user questions

### Q1: What is happening today?

Path: app load → Home tab is the default (`Dashboard.tsx:107-115`).

Above the fold on Home, the LIVE band (`HomeLiveBand.tsx`) is the **second** band the user sees, *after* the TabFreshnessHeader + TabHeader + AnnotationsPanel. So:

- **Clicks from cold load**: 0
- **Above-the-fold**: TodayLive's narrative sentence + LIVE pulse + 6 LiveStats are visible.
- **Noise**: The user has to scan past AnnotationsPanel chrome, the TabHeader with filter controls, and the Refresh-All button before reaching the answer.
- **Verdict**: Mostly works. The narrative sentence in TodayLive (`TodayLive.tsx:443-452`) is the closest thing to an answer-first surface and it is the right pattern. The issue is the **header crust** — three header rows above the LIVE band before the user reaches the actual answer.

**Recommendation**: Move the LIVE band to the top of HomeTab, above TabHeader. The TabHeader's filter slot can move into an "Adjust scope" disclosure that opens only when the user wants to slice.

### Q2: Which store is performing best/worst?

Path: app load → Home tab → scroll past LIVE band + Compare band → PerStoreCards (`HomePerStoreBand.tsx:14-16`).

- **Clicks from cold load**: 0
- **Above-the-fold**: No. The user has to scroll past 2 bands.
- **Noise**: Per-store data is shown in **three places** on Home: TodayLive's per-store mini-cards (`TodayLive.tsx:500-549`), HeroOverview's "store label" (`HeroOverview.tsx:299` — but only ONE store at a time), and HomePerStoreBand's three full cards. Each shows different metrics. The leader/risk trophy is computed in PerStoreCards (`PerStoreCards.tsx:26-40`) only — not in TodayLive's per-store cards, even though those render first and could carry the same signal.
- **Verdict**: Answer exists but is buried. The trophy/risk badges are correct UX patterns and well-implemented but they only appear once, in the third band.

**Recommendation**: Surface the leader and the at-risk store explicitly in the LIVE band narrative or in a "leader/risk" chip above the 6 LiveStats. Today's narrative does mention the top store (see `buildTodayNarrative` in TodayLive's narrative line) but doesn't call out the at-risk store, which is the more actionable side of the comparison.

### Q3: Which platform is causing the issue?

Path: app load → Home tab → scroll to PerStoreCards (`PerStoreCards.tsx:163-167`) to see per-store Meta/Google/TikTok spend OR TodayLive's per-store cards (`TodayLive.tsx:550-571`) which also show per-platform spend AND per-platform CPM.

- **Clicks from cold load**: 0
- **Above-the-fold**: Partially. TodayLive's per-store cards render below the 6-stat grid, so on a 1440×900 desktop the per-platform breakdown is at the fold or just below.
- **Noise**: Per-platform spend is shown in `TodayLive.tsx:561-571` AND `PerStoreCards.tsx:162-168` — the SAME data twice, scoped to today vs to the selected range. Per-platform CPM is shown in `TodayLive.tsx:550-696` but nowhere else. There is no platform-totals view independent of stores; the user must compute "Meta across all stores" by reading three card values and adding them in their head.
- **Verdict**: Answerable but requires arithmetic. The dashboard has store × platform breakdowns but never platform-only breakdowns. For "which platform broke?" the operator should be able to read one chart.

**Recommendation**: Add a "by platform" toggle to the per-store cards, OR add a tiny three-row "Meta / Google / TikTok" rollup row inside the LIVE narrative. The data exists; only the rollup is missing.

### Q4: Which campaigns need attention?

Path: app load → Home tab (`Dashboard.tsx:336-345`) → open InsightsBoard (`InsightsBoard.tsx`) which is collapsed by default OR navigate to Campaigns tab.

- **Clicks from cold load**: 1 (open InsightsBoard OR switch to Campaigns tab)
- **Above-the-fold**: When InsightsBoard is collapsed, the InsightHero surface (`InsightsBoard.tsx:434-495`) DOES show the headline insight as an editorial moment — this is well-implemented. But InsightsBoard is the *fourth* component in `HomePerStoreBand` (inside a `<details>` wrapper at `HomePerStoreBand.tsx:17-22`!), so the user has to scroll past LIVE + Compare + PerStore bands first.
- **Noise**: The Campaigns tab itself surfaces `CampaignsTopList` ("מנצחים ולתשומת לב" — `Dashboard.tsx:572`) which is essentially the same answer in a different shape, plus the full sortable table.
- **Verdict**: Two contradictory paths. Home's InsightsBoard is the *summarized* answer; Campaigns tab's CampaignsTopList is the *enumerated* answer. They aren't cross-linked. The InsightsBoard insights can link out to campaigns (`InsightsBoard.tsx:608-622`) but they link to *external* Meta/Google Ads Manager, not to the in-app Campaigns tab + drilldown.

**Recommendation**: Promote InsightsBoard out of the `<details>` wrapper in `HomePerStoreBand.tsx:17`. Use the existing `CollapsibleSection` component (`CollapsibleSection.tsx:21`) which already supports persisted open/closed state via localStorage. Make each insight link to the in-app campaign drawer (`CampaignDrawer.tsx`) keyed by campaignId, not to the external Ads Manager.

### Q5: What action should be taken now?

Path: app load → InsightsBoard (collapsed) → expand → top insight with action verb in title.

- **Clicks from cold load**: 1 (expand the board) — but with the InsightHero surface (`InsightsBoard.tsx:434`) the headline insight title IS visible without expanding, so really 0 clicks for the *top* insight.
- **Above-the-fold**: Same as Q4 — buried in band 3, inside a `<details>` wrapper.
- **Noise**: Same data shape as Q4. The actions (Mark Done / Hide / External Link in `InsightsBoard.tsx:582-625`) are the right verbs.
- **Verdict**: The synthesis exists. The placement is wrong. Of the six bands above the fold on Home, none is "what should I do?". The page answers "what happened?" four different ways before answering "now what?".

**Recommendation**: Make InsightsBoard the **first** band on Home, even before TodayLive. The board already has an "all clear" pulse state (`InsightsBoard.tsx:303-315`) that is calm when there's nothing to do, so making it first does not pollute the page when nothing's wrong.

### Q6: Where should the user go for deeper analysis?

Path: app load → identify the drilldown surface needed → either click a sidebar tab OR open the Cmd-K palette.

- **Clicks from cold load**: 1 (sidebar) or 2 (Cmd-K open, then result)
- **Above-the-fold**: The sidebar is persistent and shows all 6 tabs (`Sidebar.tsx:76-104`); on mobile it is hidden behind a hamburger (`Dashboard.tsx:266-278`).
- **Noise**: Sidebar labels are short. Cmd-K (`CommandPalette.tsx`) is well-built but is keyboard-only — the trigger pill in the header (`Dashboard.tsx:282-292`) is the only mouse path.
- **Verdict**: The nav itself is clean. The friction is *predicting* what each tab contains. "ניתוח" doesn't tell you whether you'll find trends or archive (you'll find both, gated by an in-page sub-tab). "פירוט" doesn't tell you whether it's daily or campaign-level.

**Recommendation**: Add a one-line subtitle under each nav label in the rail (only when expanded). The 4 operator sub-tabs already do this pattern via the H2 + byline (`HealthTab.tsx:18-21`); apply it to the top-level nav.

---

## Drill-down coherence

Trace from store-level overview → store detail → platform within store → campaign within platform → ad within campaign:

1. **Store-level overview**: PerStoreCards on Home shows ROAS / revenue / spend / per-platform spend / orders / gross profit per store (`PerStoreCards.tsx:113-186`). Available immediately. **Coherent.**

2. **Store detail**: There is **no store detail page**. To drill into a single store, the user must use the global Filter dropdown (`Filters.tsx:104-115`) to filter the entire dashboard to that store. This means every tab the user visits after that is single-store-scoped, which is correct, but there is no per-store landing surface that says "here is uzoshop's deep view". The HomeTab is store-aware (via filter) but its bands all degrade gracefully rather than restructure around a single store. **Break #1: no store profile page.**

3. **Platform within store**: There is **no platform-within-store** drilldown either. The data exists — PerStoreCards renders per-platform spend (`PerStoreCards.tsx:163-167`) and TodayLive renders per-platform CPM (`TodayLive.tsx:550-696`) — but neither is clickable. The user cannot click "Meta" on uzoshop's card to see "uzoshop × Meta". Their workaround is: go to Campaigns tab, filter by store, then visually scan for the Meta rows. **Break #2: per-platform views are visual-only, not navigational.**

4. **Campaign within platform**: Campaigns tab table (`CampaignsTable.tsx:2556 lines`) lists every campaign with all metrics. Clicking a row opens `CampaignDrawer.tsx` (1619 lines, 22 sections including health score, status, ad-sets, attribution, cohort comparison, cannibalization, product-channel breakdown). **Coherent and dense.**

5. **Ad within campaign**: From CampaignDrawer, the user clicks an ad-set row inside `AdSetTable` (rendered inside CampaignDrawer) which opens `AdsDrawer.tsx` (`CampaignsTable.tsx:2201`). This is a **stacked drawer** — drawer-on-drawer. The codebase has `useDrawerEsc` (`drawerStack.ts`) to manage the ESC key correctly, which means the team is aware of the stacking but it adds complexity. **Coherent but stacking is fragile**: on mobile, two stacked drawers consume nearly the entire screen; the back-nav requires two ESCs.

**Overall verdict**: The drill-down works once the user is in Campaigns, but the path from Home is broken. The user *cannot* click anything on Home to navigate deeper. They must visit Campaigns and *then* find the campaign they care about. This is the single biggest IA failure: the home page is read-only.

**Recommendation**: Make per-store cards clickable → set the global store filter + jump to Campaigns. Make per-platform spend chips clickable → set the global store filter + a new platform-filter param + jump to Campaigns. The CampaignsTable already filters by store; adding a `?platform=Meta` URL param is a small lift.

---

## Cards / sections / collapsibility recommendations

### `CollapsibleSection.tsx` is implemented but unused

`CollapsibleSection.tsx:21` provides a polished collapsible primitive with persisted localStorage state, icon slot, right slot for badges, and a subtitle. Three components opt-in to a `bare` prop intended for use inside this primitive: `MonthlyTables.tsx:26`, `RoasChart.tsx:35`, `PerStoreCards.tsx:58`. But a `grep` for actual `<CollapsibleSection` usage outside the file itself returns zero matches. The component is **defined and never used**.

Meanwhile, the codebase has at least four hand-rolled collapsibles:

- `HomePerStoreBand.tsx:17-22` uses raw `<details><summary>` for "תובנות והמלצות"
- `InsightsBoard.tsx:103-422` rolls its own toggle state for the board
- `AnnotationsPanel.tsx:54-122` rolls its own toggle state
- `PnLBreakdown.tsx:69` rolls its own toggle state (open by default)

**Recommendation**: Migrate all four to `CollapsibleSection`. Specifically:
- `HomePerStoreBand`'s "תובנות והמלצות" should be replaced because `<details>` doesn't persist across sessions or sync via the sidebar.
- `InsightsBoard` and `AnnotationsPanel` should be replaced because they each duplicate ~30 lines of toggle/persist logic.
- `PnLBreakdown`'s collapse is good UX but should share the primitive so future visual changes propagate everywhere.

### What should consolidate

- **TodayLive's per-store mini-cards + PerStoreCards**: Same shape, different time window. They should share one card component with a `scope: 'today' | 'range'` prop. Today's count: 2 separate implementations, ~120 lines each.
- **HeroOverview's KPI strip + KpiCards**: Same five-ish metrics (revenue, ROAS, spend, net, CPM) rendered twice in different chrome. `HeroOverview.tsx:317-373` has FloatingKpi (no border, large text, on dark hero gradient); `KpiCards.tsx:149-229` has KpiCard (bordered, smaller text, with sparkline). Pick one visual language and apply both treatments via a prop.
- **The three home bands**: All three bands (`HomeLiveBand`, `HomeSummaryBand`, `HomePerStoreBand`) use the same `section` + `header` + `h2.text-sm.font-medium` shell with a different subtitle. Pull into one `<HomeBand title="..." subtitle="...">` wrapper.

### What should split

- **CampaignDrawer is 1619 lines** (`CampaignDrawer.tsx`) and is the single densest component in the codebase. The component already has at least 8 separate sub-sections (status, health, KPIs, spend↔value chart, CPM chart, AdSetTable, ProductChannelBreakdown, CohortComparisonPanel, ManualMapping, MetaShopifyReconciliation, AttributionAnalysisPanel). Each is a `<section>` rendered top-to-bottom. The user has to scroll through all of them to reach the bottom; on mobile this is a 4-screen drawer. **Recommendation**: introduce a horizontal tab strip inside the drawer (`Overview` / `Performance` / `Targeting & Health` / `Mapping` / `Attribution`) so the user can land on the section they want.

### Progressive disclosure opportunities

- **HeroOverview's RoasTrendChart** (`HeroOverview.tsx:409-648`, 240 lines) is interesting but optional context. Default-collapsed under the KPI strip would save ~200 vertical pixels above the fold.
- **AnnotationsPanel on Home** is collapsed by default but takes ~64 px of vertical space even when collapsed. Move it to Trends tab where annotations actually overlay the chart; on Home it's a button waiting to be clicked, on Trends it has utility.
- **KpiCards' 6th card** (`KpiCards.tsx:210-227`) has no sparkline because of a deliberate decision (CRIT-4 audit fix). Removing it from the default grid and surfacing it as the headline number of the P&L tab would let the 5-card grid breathe.

---

## Drawer vs sub-tab vs new-page decisions

| Place | Pattern | Verdict |
| --- | --- | --- |
| CampaignDrawer (`CampaignDrawer.tsx`) | Drawer | **Right**. Campaign drilldown is contextual to a row in the table; opening a new page would lose the operator's table position. |
| AdsDrawer (`AdsDrawer.tsx`) | Drawer-on-drawer | **Risky**. Stacked drawers are hard on mobile and require ESC management. Alternative: turn the ad list into an inline-expanded row inside CampaignDrawer's AdSetTable (single-level drawer with collapsing tree). |
| Operator | New page (`/operator`) | **Right**. Maintenance console is a sibling concern; isolating it from the dashboard's URL state is correct. |
| Operator sub-tabs | Radix sub-tabs | **Right**. Four maintenance verbs, each with 2-4 panels. Sub-tabs avoid scrolling through 12+ sections. |
| Analysis sub-tabs (Trends/Archive) | Radix sub-tabs inside the tab | **Wrong**. The two sibling views are unrelated (one is a chart, one is a multi-store archive table) and have different filter scopes. Splitting them to two top-level tabs (or even one tab with a more meaningful chrome that re-uses the global filter) would remove a hidden hop. |
| Products sub-tabs (Table/Pivot) | Custom segmented control | **Right pattern, wrong persistence**. State is local-only (`Dashboard.tsx:638`), not URL-synced. Should mirror Analysis's URL-sync via `urlState.ts`. |
| ProductPickerModal (`ProductPickerModal.tsx`) | Modal | **Right**. Picker is a transient task. |
| BillingSettings | Modal (button at top of P&L) | **Wrong placement**. Modal is correct but should be triggered inline at the relevant breakdown row, not from a top-of-page button. |

---

## Separation of scopes

The dashboard has five conceptual scopes:

1. **Daily performance** — today + comparisons (TodayLive, HeroOverview, KpiCards)
2. **Trends over time** — multi-day ROAS chart (RoasChart, AnalysisTrendsTab)
3. **Campaigns / Ads** — campaign-level performance (CampaignsTable, Drawer, AdsDrawer)
4. **Products** — Shopify SKU performance (ProductsTable, ProductCentricView)
5. **Finance** — P&L, COGS, fees, fixed costs (PnLBreakdown, GoalTracker, BillingSettings)
6. **System / Operator** — Inngest jobs, freshness, tokens (`/operator`)

**Decisions that belong in one place but render in two:**

- **Per-platform spend** is rendered in TodayLive's per-store cards, in PerStoreCards (range), and per row of CampaignsTable. Same data, three places, three different formats.
- **Per-store ROAS** is rendered in PerStoreCards, in TodayLive's per-store cards, in HeroOverview's "storeLabel" (single store at a time), in DetailTable's per-store sparkline, and in InsightsBoard's "top store / risky store" insights. Five places.
- **Monthly goal pacing** is rendered only in GoalTracker on P&L — good single-source — but TodayLive also reads `monthlyGoal` from localStorage to build its narrative (`TodayLive.tsx:240-273`). The home tab consumes the goal but never displays it; the user can't see "what's the goal?" without switching to P&L.
- **Freshness state** is rendered in three places: top header strip (`Dashboard.tsx:281`), per-tab strip (`TabFreshnessHeader`), and Operator's FreshnessPanel. The top-header chip and the per-tab chip render the same number with slightly different chrome. Consolidate to one.

**The single biggest scope leak**: Today's data and selected-range data are both rendered as "what's happening" — but they answer different questions and should be visually distinct. Today is a moving target (refresh every 60s, narrative changes); range is a snapshot (only changes when user adjusts the filter). They should not look like sibling cards.

---

## Filter & command-palette review

Three different control surfaces compete:

### Filters (`Filters.tsx:41-209`)

Always-visible per-tab panel showing: 2 featured preset buttons (today/yesterday or similar), store dropdown, "X ימים" banner, "more options" disclosure with 5 more presets and a custom-range date pair. Lives at the top of every content tab. Affects: `data` SWR key (`Dashboard.tsx:129`) → propagates to KpiCards / HeroOverview / PerStoreCards / DetailTable / CampaignsTable / ProductsTable / etc.

### CommandPalette (`CommandPalette.tsx:88-end`)

Cmd+K modal. Contents: tab navigation, time presets (same set as Filters), store selector (same options as Filters dropdown), top 30 campaigns by spend, top 30 products by units, action verbs (refresh, AI report, open Meta Ads, theme toggles). Affects same SWR keys.

### FocusMode (`FocusMode.tsx`)

Cmd+\ keyboard shortcut. Toggles a `data-focus-mode` attribute on `<html>` for screen-shares. No UI affordance — pure keyboard.

**Overlap**:

- Time presets: in Filters AND in CommandPalette.
- Store selector: in Filters AND in CommandPalette.
- Tab navigation: in Sidebar AND in CommandPalette.
- Refresh: in TabFreshnessHeader AND in CommandPalette.

So CommandPalette is a **shortcut superset** of Sidebar + Filters + TabFreshnessHeader. This is the right pattern (cmd-k as power-user shortcut for things that exist as UI) — Linear/Notion use the same model. The friction is that CommandPalette has no discoverability surface beyond the trigger pill (`Dashboard.tsx:283-292`). A first-time user doesn't know the palette can jump to a specific campaign by name. Adding a "Press ⌘K to search anything" hint at idle would help.

**Filters** themselves: the "more options" disclosure (`Filters.tsx:135-147`) is good. The custom-range inputs forcing `max={todayInIsrael()}` (HIGH-3 audit fix at `Filters.tsx:175,191`) is well-done. The one quirk: the global filter applies to every tab including Analysis-Archive, where it does *nothing* (`AnalysisArchiveTab.tsx:13` confirms `globalStore` is unused). The user changes a control and nothing happens — silent ignore is worse than a disabled state.

**FocusMode** is a different category — it's presentation, not navigation. Fine to keep separate.

**Recommendation**:
- Add a one-line "Press ⌘K" hint to the trigger pill the first 5 visits.
- Disable the global filter on Analysis-Archive (gray out store dropdown with tooltip "Archive uses its own per-month scope") OR rewire AnalysisArchiveTab to honor the global filter.
- Consider folding the per-tab Refresh into CommandPalette + a keyboard binding (Cmd+R is taken by browser; Cmd+Shift+R could work) so TabFreshnessHeader can shrink to just the chip on tabs where refresh is rare.

---

## Prioritized recommendations

### P0 — fix before the design overhaul ships

1. **Promote InsightsBoard to first band on Home.** Currently buried in band 3 inside a raw `<details>`. The board IS the "what should I do?" answer; placing it last means the page answers "what happened?" four times before answering "what now?". Migrate to `CollapsibleSection`, with default-open behavior gated on InsightHero being non-null. Cite: `HomePerStoreBand.tsx:17-22`, `InsightsBoard.tsx:434-495`.

2. **Make per-store cards and per-platform spend chips clickable** so they drill into Campaigns (filtered to that store, optionally that platform). The drill-down breaks the moment the user wants to go from "uzoshop is at-risk" to "which uzoshop Meta campaigns?". Right now they have to switch tabs and reset the filter manually. Cite: `PerStoreCards.tsx:113-186`, `TodayLive.tsx:500-549`.

3. **Add a platform-only rollup** (Meta total / Google total / TikTok total across all stores) somewhere on Home. Currently the operator has to mentally sum three card values. Cite: `PerStoreCards.tsx:162-168` (per-store-per-platform exists; aggregate doesn't).

4. **Rewire Analysis-Archive's global filter** — either disable the store dropdown on this sub-tab or wire it through to MonthlyTables. Silent ignore at `AnalysisArchiveTab.tsx:13` is the worst option.

### P1 — significant IA improvements, can ship as a follow-up

5. **Migrate all hand-rolled collapsibles to `CollapsibleSection`.** Four candidates: HomePerStoreBand's `<details>`, InsightsBoard's toggle, AnnotationsPanel's toggle, PnLBreakdown's collapse. Removes ~120 lines of duplicate state code and gives the design system one place to evolve collapsible chrome.

6. **Consolidate the duplicated per-store cards** (TodayLive's mini-cards vs PerStoreCards) into one component with a `scope` prop. Same for HeroOverview's KPI strip vs KpiCards.

7. **Add per-tab subtitles to the sidebar** when expanded — one-line description so the user can predict what each tab contains. The operator sub-tab pattern (`HealthTab.tsx:18-21`) is already the template.

8. **Move AnnotationsPanel from Home to Trends** where it has visual context (annotations overlay the chart). On Home it's a button with no payload visible.

9. **Add a horizontal sub-tab strip inside CampaignDrawer** to split its 8+ sections into Overview / Performance / Targeting & Health / Mapping / Attribution. 1619 lines on one scroll surface is too much.

10. **Persist Products sub-tab state in the URL** (`Dashboard.tsx:638`) so deep-links match the rest of the app.

### P2 — polish, longer horizon

11. **Rename "P&L" to "רווח"** in the sidebar so the nav is consistently Hebrew. Cite: `Sidebar.tsx:18`.

12. **Reorder the sidebar by grouping** — Overview (Home, P&L) / Trends (Analysis) / Entity (Campaigns, Products) / Raw (Detail), with subtle dividers.

13. **Inline BillingSettings into the PnLBreakdown's fixed-cost row** rather than as a top-of-page modal trigger. The user is reading a number; let them click that number to edit it.

14. **Consider replacing the AdsDrawer-on-CampaignDrawer stack** with an inline expanding row inside CampaignDrawer's AdSetTable. Removes the drawer-stack complexity and is friendlier on mobile.

15. **Add a "Press ⌘K to search anything" hint** to the CommandPalette trigger pill on first N visits — the palette is the most powerful surface in the app and is currently the most hidden.

16. **Consolidate the duplicated FreshnessChip surfaces** (top-header strip vs TabFreshnessHeader) to one chip per page.

17. **Split the Analysis tab into two top-level tabs** (`מגמות` and `היסטוריה`) OR add a clearly visible sub-tab nav that doesn't bury the choice inside the page chrome. Today the Radix split at `Dashboard.tsx:502-516` is easy to miss.
