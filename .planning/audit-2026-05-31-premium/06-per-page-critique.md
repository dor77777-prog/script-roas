# Per-Page Critical Review

Baseline: `worktree-ui-ux-design-system-overhaul-2026-05-30` (main @ afc9bf6).
Reviewer: independent eyes — no prior audits consulted.
Bar: command-center clarity (Linear, Vercel Analytics, Stripe, PostHog tier). The page must answer its core question in under 3 seconds.

---

## 1. Home

### Composition snapshot
The Home tab (Dashboard.tsx `HomeTab`, lines 389-436) renders, in order:
1. `TabHeader` ("בית" + range/store filter + AI report button) — Dashboard.tsx:408-413.
2. `AnnotationsPanel` (collapsed) — Dashboard.tsx:416.
3. **Band 1** `HomeLiveBand` → wraps `TodayLive` under heading "עכשיו" — Dashboard.tsx:420, HomeLiveBand.tsx:7-14.
4. **Band 2** `HomeSummaryBand` → `HeroOverview` (full hero card with editorial sentence, 5 floating KPIs, ROAS trend chart, context strip) + `KpiCards` (6 KPI cards with sparklines) under heading "היום מול אתמול" — Dashboard.tsx:422-426.
5. **Band 3** `HomePerStoreBand` → `PerStoreCards` (1–3 cards, one per store) + a `<details>`-collapsed `InsightsBoard` (collapsible severity-grouped insights with hero card preview) — Dashboard.tsx:429-432.

The page is roughly **5 horizontal bands** stacked vertically.

### What works
- The three-band rhythm (live → period → per-store) is conceptually sound and maps to the user's natural eye-path.
- `HeroOverview`'s editorial sentence (HeroOverview.tsx:308-314) is the single most premium element on the page — Stripe-style "the story before the number" is exactly right.
- `TodayLive`'s ROAS-tinted gradient + LIVE pulse (TodayLive.tsx:103-150, 398-440) gives instant emotional read of "is today healthy".
- `InsightsBoard` collapses to a single editorial headline (InsightHero, InsightsBoard.tsx:434-495) — calmer than the old grid-of-cards model.
- "All clear" state (InsightsBoard.tsx:304-315) — pulsing green dot with "הכל רגוע" — is the kind of quiet-default detail premium tools get right.

### What's overloaded / what competes for attention
- **Three KPI surfaces stack on top of each other** in the same viewport: `TodayLive`'s 6-card grid (ROAS / Revenue / Spend / Gross Profit / CPM / Orders) → `HeroOverview`'s 5 floating KPIs (Revenue / ROAS / Spend / Op. Profit / CPM) → `KpiCards`'s 6 cards (ROAS / Revenue / Spend / Gross Profit / COGS / Net Profit). That is **17 KPI tiles** with massive overlap (ROAS appears 3×; Revenue/Spend each appear 3×; CPM appears 2×). Linear/Vercel would surface **one** primary KPI strip per page, not three with different scopes.
- The `HeroOverview` card is enormous — gradient hero, dot-grid background, editorial sentence (text-2xl), 5 KPI floats with delta pills + chips, a 144px-tall ROAS line chart with annotation pins, a context strip — that's six distinct content layers inside one card (HeroOverview.tsx:263-394). It looks like 2014 dashboard maximalism, not a 2026 command center.
- `TabHeader` description ("שנה טווח או חנות לעדכון כל המסך.", Dashboard.tsx:410) is filler copy. A command center should never tell the user "use the filter to filter".
- `KpiCards`'s "רווח נטו" deliberately omits a sparkline (KpiCards.tsx:210-227) but the surrounding 5 cards all have one → the card looks broken, not intentionally calm.
- The `AnnotationsPanel` at the top of Home is collapsed by default (Dashboard.tsx:416, AnnotationsPanel.tsx:54) — its presence still costs a row of vertical space and a click target above the actual content.

### What's missing for a command-center feel
- **No "what should I do now"** synthesis. The editorial sentence in HeroOverview describes the past ("הכנסות עלו ב-12%"); it never suggests action.
- **No primary CTA**. A real command center surfaces 1–2 actions ("שתף דוח", "סקור 3 תובנות") near the hero. Today the AI Report button is buried in `TabHeader`'s `actionSlot`.
- **The Insights panel is hidden behind a `<details>` summary** (HomePerStoreBand.tsx:17-22) — the highest-signal surface on the page is muted by default. Linear puts unread issues at the top, not behind a disclosure.
- **No goal tracking on Home**. `GoalTracker` lives only inside the P&L tab (Dashboard.tsx:465). The "where am I vs target this month" question is the most command-center-shaped question in the entire product, and Home doesn't answer it.

### Visual hierarchy issues
- All three bands use the same `<h2 className="text-sm font-medium text-ink">` (HomeLiveBand.tsx:9, HomeSummaryBand.tsx:11, HomePerStoreBand.tsx:14). The "section labels" are smaller than the KPI numbers, smaller than the editorial sentence, smaller than store-card titles — they fail to do their job of structuring the page.
- The hero card uses `text-[1.75rem]` (HeroOverview.tsx:682) for KPI values; KpiCards use `text-[2rem]` (KpiCards.tsx:34) — the **summary band's numbers are visually louder than the editorial hero's**, which inverts the intended hierarchy.
- The page has 4 distinct accent gradients fighting for attention: TodayLive's ROAS-driven gradient (changes color), HeroOverview's navy gradient, GoalTracker's accent gradient (in P&L), InsightsBoard's gradient-to-elevated header.

### Interaction / state issues
- Loading skeleton (Dashboard.tsx:315-325) shows 1 hero block + 6 small cards — but the actual loaded layout is 3 bands of cards. The skeleton lies about the page shape.
- Error banner (Dashboard.tsx:303-313) is non-recoverable — there is no retry button. The user must hard-refresh.
- `HeroOverview` does **two extra `/api/data` and `/api/campaigns` fetches** for the previous period (HeroOverview.tsx:98-125). On a slow connection the hero KPIs render with `prevEmpty=true` then snap to real deltas — visible thrash.
- `RoasTrendChart` in the hero returns `null` (HeroOverview.tsx:456) when there are fewer than 2 active days → on a quiet Sunday morning the chart disappears with no placeholder, leaving a layout shift.

### RTL / mixed Hebrew-English issues
- HeroOverview's eyebrow row mixes RTL Hebrew with LTR date range "1.5 — 16.5" (HeroOverview.tsx:298-306) — separators don't collapse cleanly; the "·" dots sometimes orphan-wrap.
- `RoasTrendChart` forces `dir="ltr"` on its outer `<section>` (HeroOverview.tsx:462) but then puts an RTL caption row inside (line 464) — nested direction flips fight the parent and the legend "מקסימום" / "מינימום" labels render with reversed punctuation order in Safari.
- `KpiCards`'s "labelSuffix" used to read "(25%)" and was removed for COGS (KpiCards.tsx:192-198), but the same suffix pattern persists for transaction fees inside `PnLBreakdown` — inconsistent.
- The sparkline wrapper inside `KpiCard` forces `dir="ltr"` (KpiCards.tsx:355) but the surrounding flex row stays RTL — alignment relative to the delta pill flips between locales.

### Specific file:line problems
- **Dashboard.tsx:410** — `description="שנה טווח או חנות לעדכון כל המסך."` is filler copy.
- **Dashboard.tsx:341** — `<HomeTab … ordersByStore={ordersByStore} />` doesn't pass `goal/forecast/pacing` to Home, so Home is structurally blind to the most actionable metric in the product.
- **HomeLiveBand.tsx:9** — section heading "עכשיו" + "(אינטרא-יום)" parenthetical reads like internal jargon, not user copy.
- **HomeSummaryBand.tsx:13-15** — formula reference rendered in `font-mono ltr` on a Hebrew page is a visual rule break (the formula belongs in MetricHelp popovers, not the page header).
- **HomePerStoreBand.tsx:17-22** — `<details>` element to hide the entire InsightsBoard is the wrong primitive (no animated reveal, no focus management, no keyboard chord). Should be a Radix collapsible.
- **HeroOverview.tsx:519-522** — `eslint-disable local/no-hex-color-in-components` for white SVG stops on the hero gradient — accepted, but the same pattern appears at HeroOverview.tsx:582-597 for the Line color, dot fill, activeDot stroke. Four eslint-disables in one render is a smell.
- **HeroOverview.tsx:283-285** — inline `style={{ backgroundImage: 'radial-gradient(rgba(255,255,255,1) 1px, transparent 1px)', backgroundSize: '18px 18px' }}` — dot-grid decoration on a flagship card is exactly the "decorative noise" the premium bar forbids.
- **InsightsBoard.tsx:101-128** — `BOARD_EXPANDED_KEY = 'roas-dashboard:insights-expanded'` defaults to closed. Combined with the `<details>` wrapper in `HomePerStoreBand`, the operator must click **twice** to actually see insights. Insights should be visible by default — that's the whole point of a "smart insights" panel.
- **InsightsBoard.tsx:117** — second-level h2 "תובנות חכמות" with `text-base sm:text-xl font-bold` is louder than every other heading on the page; this competes with HeroOverview which should be the focal point.
- **KpiCards.tsx:30-45** — `valueSizeClass()` ladder of 5 break-points is fragile; the same number could render at different sizes across renders if locale formatting adds a digit.
- **PerStoreCards.tsx:118** — the store card header is `style={{ background: color }}` from `storeColor()` — a per-store solid color bar adds another 3 distinct hues to a page already crowded with accent gradients.

### Top 3 recommendations for THIS page
1. **Kill 12 of the 17 KPI tiles.** Promote the editorial sentence + 4 floating KPIs (Revenue, ROAS, Net Profit, Pace-to-goal) into the single Home hero. Move `TodayLive`'s 6-card grid into a side panel or merge it into the hero with a "live" mode toggle. Move the detailed `KpiCards` 6-pack to the P&L tab where they belong.
2. **Make insights and goal-tracking first-class on Home.** Pull `GoalTracker` out of P&L. Put the open `InsightsBoard` (or at least the InsightHero) immediately under the hero. Replace `<details>` with proper collapsible behavior.
3. **Strip the hero card.** Remove the dot grid, the side-glow blob, the ROAS chart (move it to Trends), and the context strip. Hero = editorial sentence + 4 KPI numbers. Nothing else.

---

## 2. Trends

### Composition snapshot
`AnalysisTrendsTab` (AnalysisTrendsTab.tsx, 45 lines) renders:
1. `SectionIntro` "טווח לניתוח" — describes that filter affects chart only, monthly tables are separate.
2. `Filters` — range + store dropdown.
3. `SectionIntro` "מגמת ROAS לאורך זמן" — describes the chart.
4. `RoasChart` (`bare` mode) inside a `bg-elevated` card.
5. `AnnotationsPanel` (collapsed) — add/edit annotations for the chart.

It lives inside a `Tabs.Root` (Dashboard.tsx:502-525) that exposes "מגמות" / "היסטוריה" — both rendered as text-only triggers with bottom-border on active state. The wrapping `AnalysisTab` adds no further chrome.

### What works
- Tight, single-purpose tab. One chart, one filter, one annotation panel — the closest the product comes to a focused premium surface.
- `RoasChart` is well-instrumented (per-store lines, gap-handling via `connectNulls=false`, annotation reference lines).

### What's overloaded
- **Two `SectionIntro` headers on a one-chart tab** (AnalysisTrendsTab.tsx:25, 32). One labels the filter as a "section", the other labels the chart. Both consume vertical real estate and visually fragment a page that should feel like one continuous canvas.
- The chart card has `border + shadow-sm + rounded-xl` (line 37) — a card wrapping a single chart inside a tab that's already nested inside another tab system is over-chrome.
- Filter row + chart description + chart toolbar (inside RoasChart) + axis labels = four horizontal strips before the operator sees the first data point.

### What's missing for a command-center feel
- **No summary above the chart.** Trends answers "how have things been changing" — but the page never says "ROAS is trending down for 7 days" or "uzoshop just crossed your target line". The annotations panel below is for the operator to write notes; there's no system-generated insight.
- **No comparison anchor.** Premium trend dashboards show "today vs same day last week" or a moving average overlay. Here you get raw daily ROAS with a static 3.0 reference line.
- **No breakdown switch.** Operator cannot swap ROAS for Revenue, Spend, Profit, CPM without leaving the tab. Vercel Analytics gives you a metric dropdown above the chart; this one is hard-locked to ROAS.
- **No chart-level zoom / brush.** 17 months of data → no way to focus on a 30-day window without changing the global filter.

### Visual hierarchy issues
- Both `SectionIntro` icons are wrapped in `bg-accent/8 text-accent` boxes (SectionIntro.tsx:43-50). On a page with one chart, two identical accent boxes compete with the chart's own accent line colors → the eye drifts to the framing chrome instead of the data.
- The chart card title is implicit (carried by the second `SectionIntro`); inside the card there is no title — so when the operator scrolls past `SectionIntro`, they lose the chart's identity.

### Interaction / state issues
- Loading state lives inside `RoasChart` only — the surrounding scaffolding loads instantly, then the card area pops empty until SWR resolves. No skeleton inside the card frame.
- Empty state: if no data in range, `RoasChart` renders a placeholder; but the two `SectionIntro` blocks above still describe "the chart" so the page reads as if something is wrong.
- The Filters dropdown affects the chart but **not** the monthly tables (now in Archive). The first `SectionIntro` (line 26-29) tries to explain this — that copy is a code smell. Good IA shouldn't need explanatory text.

### RTL / mixed Hebrew-English issues
- Annotation kind labels and emoji are mixed-direction (e.g., emoji 🚀 + Hebrew text in `ANNOTATION_KIND_EMOJI`/`ANNOTATION_KIND_LABEL`); inside the chart's `ReferenceLine` labels the result is occasionally upside-down on Safari iOS.
- `SectionIntro` uses `formula` in `dir="ltr" font-mono` (SectionIntro.tsx:60-71) — none used on Trends but the wrapper inconsistency between Trends and other tabs reads as theme drift.

### Specific file:line problems
- **AnalysisTrendsTab.tsx:25-29** — first `SectionIntro` exists only to explain that "the filter affects the chart but not the tables" — that's an IA failure to fix, not narrate.
- **AnalysisTrendsTab.tsx:38** — `<RoasChart … bare />` discards RoasChart's own title; combined with the missing card header that orphans the chart visually.
- **Dashboard.tsx:502-525** — `AnalysisTab` uses Radix Tabs with no animation, no state-persistence (sub-tab is local to the component, lost on tab switch).
- **Dashboard.tsx:506-507** — trigger style uses `data-[state=active]:border-b-2 data-[state=active]:border-accent` — but `border-b-2` shifts the inactive label up by 2px on activate (no `border-b-2 border-transparent` baseline). Classic layout-shift bug.

### Top 3 recommendations for THIS page
1. **Replace both SectionIntros with a single hero strip** ("ROAS לאורך זמן" + a one-sentence system insight: "ירידה של 8% מאז 25.5, בעיקר ב-uzoshop"). Move the filter inline with the strip on the right.
2. **Add a metric switcher above the chart** (ROAS / Revenue / Spend / Net) so the trend tab actually serves the "how have things been changing" question for any metric, not just ROAS.
3. **Add layout-shift fix to Tabs.Trigger** (transparent 2px bottom border baseline) and animate the transition.

---

## 3. Archive

### Composition snapshot
`AnalysisArchiveTab` (AnalysisArchiveTab.tsx, 43 lines) renders:
1. `SectionIntro` describing the color coding for ROAS cells.
2. `YearSelector` dropdown (range: 2 years before to now, AnalysisArchiveTab.tsx:18-19).
3. `MonthSelector` dropdown (1–12 + "all year", MonthSelector.tsx:16-41).
4. `MonthlyTables` — fetches `/api/data` for the selected year and renders one collapsible block per month. Each block is either per-store (date × spend/revenue/ROAS) or aggregated summary across stores.

### What works
- The black "0" cell for "spent money but no sales" days (MonthlyTables.tsx:124-128) is a genuinely good visual — high signal-to-noise.
- Default-open for current + previous month (MonthlyTables.tsx:267) lowers click cost.
- Per-month total row at the bottom of each table is correct and matches the dashboard's other aggregations.

### What's overloaded
- **Two dropdowns stacked vertically** (AnalysisArchiveTab.tsx:30-37) — Year on one row, Month on another. A premium tool would render them inline as a single date-scrubber.
- The `SectionIntro` (line 24-28) is essentially a legend: "אדום (<2), כתום (2-2.7), ירוק (2.7-3), כחול (>3)". This is data-design info that should live as an inline legend on the first table — not as a paragraph at the top of the page.
- Each MonthBlock is a separate `rounded-xl bg-elevated border shadow-sm` card (MonthlyTables.tsx:373, 499) — stacking 17 of them produces a "card lasagna" effect. The visual cost of the card chrome dwarfs the data.
- MonthlyTables has a redundant internal toolbar (MonthlyTables.tsx:220-256) with mode toggle "לפי חנות / סיכום כללי" + store dropdown — duplicating the global store filter from elsewhere in the dashboard. The Archive tab itself does not respect the global store filter at all (AnalysisArchiveTab.tsx:14 marks `globalStore` as "Legacy — unused").

### What's missing for a command-center feel
- **No KPIs across the year.** Archive should show "Best month: April CAD 142K · Worst: November CAD 31K · YoY: +18%" — a real archive page synthesizes the year, then drills into months. Today it dumps 12 tables.
- **No comparison.** You cannot see April 2025 next to April 2026. No year-over-year overlay, no benchmark band.
- **No export / share.** A "past month" view should let the operator download a CSV or PDF — none exists.
- **No search / jump-to-date** for older months. Operator must scroll past 6 months of empty `<details>` to reach March 2025.

### Visual hierarchy issues
- Each MonthBlock header uses `bg-ink text-canvas` (MonthlyTables.tsx:377, 503) — a solid dark bar repeating 12+ times down the page. Visually heavier than necessary; the year context is lost.
- The store toolbar tab buttons (MonthlyTables.tsx:301-326) are styled to mimic `bg-accent text-white` when active — but on the Archive page (where `hideStoreToolbar` is false by default and the toolbar IS shown for the analysis-tab parent), this creates a second tab-bar inside the already-tabbed AnalysisTab → Archive tab. Tabs inside tabs inside tabs.
- ROAS cell background uses `ROAS_BG` map (MonthlyTables.tsx:111-117) — colored cells inside the data grid are good, but the colors compete with the table header `bg-elevated2`, the row hover state, and the bottom total row's `bg-elevated2 font-semibold`. Four different background tones per table.

### Interaction / state issues
- Loading state: full-text "טוען טבלאות חודשיות..." (MonthlyTables.tsx:202-208) with no skeleton or spinner — looks like a 1999 page during the few seconds of fetch.
- Error state: red text inline (MonthlyTables.tsx:210-216) with no retry button. Same issue as Home.
- `useEffect` keeps `storeFilter` in sync with the global filter (MonthlyTables.tsx:156-161) but the operator can override locally; the override is silently discarded the next time the parent's global filter changes — confusing.
- `MonthSelector` includes "all year" as the default-on Archive landing experience would suggest, but the component initializes to `now.getMonth() + 1` (AnalysisArchiveTab.tsx:20) → the operator lands looking at one month, not the whole year. The selector is mis-labeled relative to the default.

### RTL / mixed Hebrew-English issues
- Tables themselves are LTR-friendly (tabular-nums + start/end alignment) but the month titles ("ינואר 2026 • uzoshop") at MonthlyTables.tsx:380, 506 mix Hebrew + ASCII bullet + LTR English — the bullet character "•" wraps inconsistently in RTL.
- Header label "יצא סה"כ" (MonthlyTables.tsx:393, 515) uses the HTML entity escaping for `"` — the result is visually noisy under the `font-medium` th style.
- Per-store toolbar wraps in `dir="ltr"` (MonthlyTables.tsx:229) — but the buttons inside contain Hebrew "לפי חנות". On hover the focus ring appears on the wrong side.

### Specific file:line problems
- **AnalysisArchiveTab.tsx:14** — `globalStore?: string;` documented as "Legacy — kept so Dashboard.tsx call-site doesn't need to change. Unused." Dead prop — should be removed; signals the IA isn't finished.
- **AnalysisArchiveTab.tsx:20** — `useState<number | null>(now.getMonth() + 1)` defaults to current month; combined with the "כל השנה" option in MonthSelector, the default contradicts the page name "Archive" which implies a year-level view.
- **MonthlyTables.tsx:59** — `MONTHLY_TABLES_HISTORY_MONTHS = 17` is dead when `year != null` (memo at 163-168 overrides it). Leftover constant, should be gated.
- **MonthlyTables.tsx:228-238** — toolbar tablist uses `dir="ltr"` + Hebrew buttons.
- **MonthlyTables.tsx:240-251** — internal store dropdown duplicates Filters.store from the dashboard.
- **MonthlyTables.tsx:344, 467** — `useState(defaultOpen)` makes the open/close state per-block local. Switching years loses the operator's open/close pattern.
- **MonthlyTables.tsx:386, 512** — `min-w-[500px]` on the table forces horizontal scroll on mobile while the rest of the dashboard renders responsive grids — inconsistency.
- **YearSelector.tsx:14-16** — `startYear ?? end - 2` hard-caps history to 3 years. The dashboard has 17 months of fetch capacity but the year picker stops the operator from going back further, even though MonthlyTables would handle it.

### Top 3 recommendations for THIS page
1. **Lead with a year-level synthesis card** ("2026 so far: CAD 1.2M revenue · ROAS 2.84 · best month April · trend -4%"). Push the per-month tables below it as the drill-down.
2. **Collapse YearSelector + MonthSelector into one date scrubber** (year-grid + 12-month grid in a single popover); kill the redundant `MonthlyTables` internal toolbar.
3. **Replace the `<MonthBlockPerStore>` card chrome with a unified data grid** — one continuous virtualized table with sticky month-header rows. Eliminates the "card lasagna".

---

## 4. P&L

### Composition snapshot
`PnLTab` (Dashboard.tsx:443-481) renders:
1. `SectionIntro` "הרווח שלך לתקופה" with formula chip.
2. `Filters` — range + store.
3. `GoalTracker` — monthly revenue goal + progress bar + forecast (GoalTracker.tsx, 354 lines).
4. A row containing only `BillingSettings` (the modal trigger for fixed costs).
5. `PnLBreakdown` — Hero strip (3 big stats with bars) + collapsible itemized cascade + by-source breakdown.

### What works
- `PnLBreakdown` cascade design is excellent (PnLBreakdown.tsx:232-313): each row carries label + note + amount + percentage + running total. The "running total" column (line 489-504) is genuinely premium.
- The hero strip's three side-by-side numbers (Revenue / Costs / Net Profit) with proportional bars (PnLBreakdown.tsx:182-212) is a clear "did I make money?" answer.
- `GoalTracker` correctly stays global (GoalTracker.tsx:31-42) — well-documented design intent.
- Warning banner when no fixed costs configured (PnLBreakdown.tsx:217-230) is the right pattern: surfaces a meaningful gap without blocking.

### What's overloaded
- The page has **two heroes**: `GoalTracker` (gradient bg-accent) and `PnLBreakdown` hero strip (gradient from-accent). Both at full width, both with bold gradients, both with "premium card" treatment. They cannibalize each other.
- `GoalTracker` itself packs 5 distinct content blocks into one card: gradient header w/ status chip + edit button, 3-column numbers grid (accrued / target / forecast), progress bar with expected-pacing tick, footer with day-of-month / days-remaining / daily-target. That's a small dashboard inside a card.
- The "By source" breakdown table (PnLBreakdown.tsx:316-381) is excellent — but lives inside a `<details>` nested inside a collapsible card inside the P&L cascade. Three levels of disclosure for what is the most strategic question ("which subscription is eating my margin?").

### What's missing for a command-center feel
- **No multi-period comparison.** Premium P&L always shows "vs previous period" or "vs last month" on the hero strip. Today the hero is single-period only.
- **No drill-by-store.** When `store='All'`, the cascade aggregates everything; the operator cannot see "which store contributed which slice of net profit" without changing the global filter.
- **No alerts.** If COGS jumps from 25% to 30%, no banner. If transaction fees grow disproportionately, no flag. The cascade is descriptive, not diagnostic.
- **No "what would change net profit by 10%" levers.** Stripe Atlas-style "remove this $200/mo Klaviyo and net rises by 3%" would be on-brand here.

### Visual hierarchy issues
- Both hero cards (GoalTracker + PnLBreakdown hero) use `bg-gradient-to-br from-accent/...` (GoalTracker.tsx:124, PnLBreakdown.tsx:154). Stacked, the page looks like two product cards in a marketing site.
- Inside PnLBreakdown, the cascade row labels (text-sm font-medium) and the cascade row amounts (text-sm font-semibold tabular-nums + CAD prefix) compete for weight; the right column is denser than the left.
- The "רווח נטו אמיתי" final row uses `border-t-2 border-ink/20` (PnLBreakdown.tsx:293) — but the cascade rows above use `border-b border-line-subtle/40` — inconsistent border weight makes the closing row feel arbitrarily highlighted.
- `BillingSettings` modal trigger is centered alone in its own flex row (Dashboard.tsx:468-470). Looks like a stranded UI element.

### Interaction / state issues
- `GoalTracker` editing state replaces the card entirely (GoalTracker.tsx:151-223). When you click edit, the pacing card disappears → you lose your current context while typing.
- `PnLBreakdown` collapsible state is local `useState(true)` (PnLBreakdown.tsx:69) — not persisted; refresh always defaults to expanded.
- `roas-billing-changed` event drives both the SWR mutate and the `billingTick` recompute (Dashboard.tsx:168-178) — but the operator has no visual confirmation that their edit "took". A toast or inline confirmation would close the loop.
- Empty-state for `GoalTracker` is good (line 122-148) but the empty-state for "no fixed costs" lives 3 sections below; an operator who just set up the dashboard sees two different "set me up" flows on the same page.

### RTL / mixed Hebrew-English issues
- "Profit & Loss" eyebrow (PnLBreakdown.tsx:162-164) is English on an otherwise Hebrew card. The `&amp;` HTML entity is correct but renders next to Hebrew "כמה נשאר ביד?" — eyebrow + headline mix two languages.
- Currency prefix "CAD" appears as `text-[10px] text-ink-muted font-medium me-1` (multiple lines including PnLBreakdown.tsx:309, 423) — sometimes `me-1`, sometimes `ml-1.5`, sometimes `ms-1`. RTL margin inconsistency.
- `PnLLine` running-total column has `border-s border-line-subtle ps-3` (PnLBreakdown.tsx:490) — correct RTL token usage, but the column header "נשאר" + value have no shared baseline, so the "—" placeholder (line 493) misaligns with adjacent rows' amounts.

### Specific file:line problems
- **Dashboard.tsx:459** — SectionIntro description is two long sentences in formal Hebrew + an embedded formula. Wall-of-text intro instead of a punchy hero.
- **Dashboard.tsx:465** — `<GoalTracker data={data} />` is the only Home-shaped widget in P&L; this is the wrong tab for it (operator memo confirms goal is global; UX-wise it belongs on Home).
- **Dashboard.tsx:468-470** — `<div className="flex justify-end"><BillingSettings ... /></div>` — single button in a flex row with no context. Should be inside `PnLBreakdown`'s hero as a "+ Configure costs" affordance.
- **GoalTracker.tsx:124** — `bg-gradient-to-br from-accent/95 via-accent to-accent/80` for the empty state is excessive for an empty card.
- **GoalTracker.tsx:154** — editing state uses `bg-elevated border` (no gradient), and the saved-state uses `bg-elevated border` (also no gradient). So the gradient appears only when the goal is unset → premium card → set goal → flat card. UX regression on success.
- **GoalTracker.tsx:226-227** — `Math.min(1.2, ...)` allows the progress bar to render up to 120% but the visual rendering treats it as a normal bar; values over 100% aren't visually distinguished from "exactly 100%".
- **PnLBreakdown.tsx:69** — `useState(true)` should be `useState(() => readLocalStorage('pnl-expanded', true))` for state persistence.
- **PnLBreakdown.tsx:218-229** — warning banner uses a heredoc-style copy that mentions both "טרם הוגדרו" and the suggested button name. If `BillingSettings` ever renames, this copy lies — a code-coupling smell.
- **PnLBreakdown.tsx:241-250** — "החזרים בתקופה" row is presentational-only (`running={null}`). Smart, but the visual treatment (gray dash for running) is barely distinguishable from a real cascade row — confused readers will think refunds skipped the cascade by mistake.

### Top 3 recommendations for THIS page
1. **Merge Goal + P&L hero into one strip.** Three premium tiles: "Revenue", "Net Profit", "Goal Pace". Each shows current + delta + tiny bar. Eliminates the dual-hero problem.
2. **Promote the by-source breakdown out of `<details>`.** It's the single best diagnostic on the page — should sit as a permanent right-rail card on desktop, expandable on mobile.
3. **Add period-over-period comparison and per-store stacking to the cascade.** Each row shows previous period's value as a faded right-of-amount number and a small "+/-%" pill.

---

## 5. Detail

### Composition snapshot
`DetailTab` (Dashboard.tsx:710-734) renders:
1. `SectionIntro` "פירוט יומי" with a long sentence describing the table.
2. `Filters` — range + store.
3. `DetailTable` in `bare` mode wrapped in a `bg-elevated border rounded-xl` card.

`DetailTable` itself (DetailTable.tsx, 177 lines): sorts rows by date desc, slices to top 100, renders columns: date, store, store-trend sparkline, facebook spend, google spend, [tiktok spend if any], total spend, revenue (with refund indicator), ROAS (colored cell), gross profit, [cogs if any], [net profit if any].

### What works
- Conditional columns (showCogs / showTikTok at DetailTable.tsx:33-37) keep the table from rendering empty columns when stores don't have those platforms.
- The "מגמת חנות" sparkline column (line 96-104) is a genuinely useful micro-trend — premium tier.
- Per-row ROAS background color reuses the same `ROAS_BG` map as MonthlyTables — consistency win.
- The "spent but no sales" red cell with "0" (DetailTable.tsx:20) is the same convention as MonthlyTables — internal consistency is good.

### What's overloaded
- **The table is the page.** That's fine in principle, but the table has 9-11 columns and the operator lands on it cold. No summary, no totals, no period KPIs. The Detail page is the only page where there is no synthesis layer at all.
- The card wrapper (Dashboard.tsx:729) adds border + shadow around a table that is itself already a card-like structure. Strip the outer card.
- `SectionIntro` description (Dashboard.tsx:726) is 3 sentences explaining the visual conventions ("ROAS אדום עם '0' = ...") — that should be a legend below the table or a tooltip on the header cell, not a page-level paragraph.

### What's missing for a command-center feel
- **No totals row.** The table has 100 rows, no aggregate at the bottom. Operator cannot answer "how much did I spend on FB in this view" without exporting.
- **No sorting.** Columns are sort-locked to date-desc. No click-to-sort headers.
- **No column hiding / re-ordering.** `CampaignsColumnsMenu` exists elsewhere — same pattern should be available here.
- **No row drilldown.** Clicking a row should open a day-detail drawer (campaigns active, top products, anomalies on this day). Today the row is inert.
- **No CSV export.** "Detail" implies it's the place to grab raw data — there is no export.
- **No filters beyond range/store** — no platform filter, no ROAS-band filter, no "show only zero-sale days".

### Visual hierarchy issues
- All column headers use the same `text-ink-secondary font-medium` (DetailTable.tsx:73-86). The "ROAS" column (the one the operator cares about most) has no visual emphasis.
- The "מגמת חנות" header is in a smaller font (`text-[10px] uppercase`, line 75) than the rest. Inconsistent header treatment.
- Row hover (`hover:bg-elevated2/50`, line 93) is so subtle that scanning down 100 rows the operator easily loses their line.
- Table doesn't use zebra striping; with 100 rows this is a readability cost.

### Interaction / state issues
- Empty state ("אין נתונים בטווח שבחרת", DetailTable.tsx:59, 63) is correct but the surrounding `SectionIntro` still describes the data — the page reads as "broken".
- 100-row cap (line 32) is hard-coded; no pagination, no "load more". If the operator picks a 90-day range, they only see the most recent 100 days; older data is silently dropped.
- Sparkline column re-computes `storeSeriesByStore` on every render of every row in the same render pass via `useMemo` (DetailTable.tsx:42-55) — fine performance, but inside the row body we call `storeSeriesByStore.get(r.storeName) ?? []` (line 98) which means every row of the same store renders the same sparkline. Visually repetitive — the same image repeats 17 times if uzoshop has 17 rows.

### RTL / mixed Hebrew-English issues
- Table is `min-w-[900px]` (DetailTable.tsx:70) — on mobile, horizontal scroll on an RTL page means scrolling **right** to see hidden columns. Many users don't realize this.
- Column header "סה"כ הוצאה" uses escaped quote (line 81) — visually a slight stutter at the quote character.
- The sparkline forces no `dir` attribute; the Sparkline component itself is direction-neutral but the surrounding `<td className="px-2 py-2 text-center align-middle">` (line 96) has no explicit `dir="ltr"` to keep ascending dates left-to-right.

### Specific file:line problems
- **Dashboard.tsx:726** — SectionIntro `description` is 2 sentences + a third sentence about the visual convention. Wall-of-text.
- **DetailTable.tsx:32** — `display = sorted.slice(0, 100)` hard cap with no pagination, no UI hint.
- **DetailTable.tsx:42-55** — `storeSeriesByStore` builds a series ordered by date asc for ALL store rows but the sparkline shows the same series identically on every row of that store — wasted ink.
- **DetailTable.tsx:78-80** — facebook and google headers are localized "פייסבוק" / "גוגל" but the data columns elsewhere use English brand names. Inconsistent internal localization.
- **DetailTable.tsx:108-112** — TikTok column conditionally renders `formatNumber(r.ttSpend)` or "—" but the `formatNumber` call doesn't carry currency context; rest of column is bare numbers — no `CAD` prefix.
- **DetailTable.tsx:130-141** — net profit cell uses 3 different text colors (status-green / status-red / ink-muted) inline; this is the right behaviour but `r.hasCogs && r.netProfit >= 0 && 'text-status-green'` will render even for net=0 — green for "exactly 0" is misleading.
- **DetailTable.tsx:151-153** — `meta` text "(N שורות אחרונות)" is the only context about the 100-row cap; this is buried in a small parenthetical.

### Top 3 recommendations for THIS page
1. **Add a summary strip above the table** (Total spend / Total revenue / Period ROAS / Days). The Detail page is unique in having zero synthesis; even one row of totals would dramatically raise the command-center bar.
2. **Make rows interactive**: click-to-expand drawer showing top campaigns + top products for that day, and click-headers-to-sort. Decommission the trivial 100-row cap; add proper virtualization (CampaignsTable already has it).
3. **Move the legend out of `SectionIntro`** into a "?" tooltip on the ROAS column header. Strip the outer card wrapper; the table is the page.

---

## 6. Operator (Sync / Health / Activity / Danger)

### Composition snapshot
`/operator/page.tsx` (87 lines) renders a `max-w-7xl` page with:
- `<h1>ניהול` + 1-line description.
- `OperatorSecretBanner` — orange banner unless secret is stored.
- Radix Tabs: סנכרון / בריאות / פעילות / מסוכן.

**Sync tab** (SyncTab.tsx): `SyncNowButtons` (1 global + 3 per-store buttons), `BackfillPicker` (date range + store checkboxes), `ManualOverridesCrud` (CRUD list with modal-confirm delete).

**Health tab** (HealthTab.tsx): `TokenFailuresTable` (failures + resolved disclosure), inline TikTok attribution disclaimer banner, `MetaBucPanel` (per-account BUC progress bars), `FreshnessPanel` (4-key matrix table).

**Activity tab** (ActivityTab.tsx): `StatusEventsFeed` (last 50 events with icons), `CronTickSnapshotsViewer` (last 144 ticks), `JobsTable` (last 50 Inngest runs).

**Danger tab** (DangerTab.tsx): `WhatsappTestButtons` (3 trigger buttons), `<hr>`, `ResetData` (two destructive buttons with typed-confirmation modals).

### What works
- The 4-tab split is the right IA — it cleanly separates "do something", "is it healthy", "what happened", "destructive".
- `OperatorSecretBanner` (OperatorSecretBanner.tsx) is good UX for the URL-obscurity-+-secret posture.
- `TokenFailuresTable` (TokenFailuresTable.tsx:124-130) has thoughtful error handling — amber retry banner instead of a hard crash.
- `ResetData`'s typed-confirmation modal is solid destructive-action UX.
- `JobsTable`'s `formatRelative` + `title=` ISO timestamp pattern (JobsTable.tsx:100-106) is a small but quality-tier detail.

### What's overloaded / what competes for attention
- **Every section uses identical `<h2 className="text-lg font-semibold mb-3">`** (SyncTab.tsx:15, 23, 29; HealthTab.tsx:16, 52, 65; ActivityTab.tsx:18, 31, 41; DangerTab.tsx:18, 41). Six identical h2s per tab — no priority, no urgency signal.
- The Health tab is the most overloaded: 4 distinct content surfaces (token failures table, inline disclaimer banner, BUC panel with 6 progress bars per ad account, freshness 9-column matrix table). Each is independently useful; together they're a wall of tables.
- `FreshnessPanel` renders 9 columns (FreshnessPanel.tsx:94-105) for what is conceptually a 4-key matrix. The 9-column horizontal scroll is a tax on the most-frequently-scanned page in the console.
- `StatusEventsFeed` renders **50 events as a flat list** with no grouping (StatusEventsFeed.tsx:46-58). On a busy day this is 50 rows of "store · platform · entity_type · id · from → to" — visual mush.
- Activity tab has 3 different table styles: StatusEventsFeed is a `<ul>` with inline icons, CronTickSnapshotsViewer is a `<table>` with English headers (tick_id, fan_out, completed...), JobsTable is a `<table>` with Hebrew headers + status badges. Three different list paradigms on one tab.

### What's missing for a command-center feel
- **No top-level status pill.** The operator opens /operator and there's no "All systems green" / "3 issues" badge. They must visit Health, scan TokenFailures, scan Freshness, then form their own picture.
- **No alert routing.** Token failures fire WhatsApp alerts but the operator console has no way to silence, snooze, or route them.
- **No "what should I do next" panel.** Linear-tier console would show "Top action: 3 stale TikTok rows in usmile360 — run Sync for usmile360".
- **No search.** Activity tab has 200+ rows across 3 tables, no filter by store/platform/status.
- **No deep-link from a failure to the fix.** A token failure in Meta should offer a one-click "Open Meta token settings" — today the operator must navigate manually.
- **No history depth.** CronTickSnapshotsViewer shows "last 144 ticks (24h)"; there's no way to look at yesterday's snapshots, no pagination.

### Visual hierarchy issues
- **All four sub-tabs render identically** — h1 + secret banner + Radix tab strip + content. There's no contextual chrome that signals "Danger tab is destructive" beyond the section names.
- The Radix Tabs.Trigger styling (page.tsx:62-67) is the same `data-[state=active]:font-medium data-[state=active]:border-b-2 data-[state=active]:border-accent` pattern — Danger gets no destructive color cue.
- Section titles inside HealthTab decorate the h2 with `<span className="text-ink-secondary text-xs font-normal">` parentheticals (HealthTab.tsx:18-21, 53-56, 66-69). These parentheticals contain critical info ("≥80% מפעיל budget skip מונע") at smaller-than-body weight.
- `OperatorSecretBanner` uses `bg-status-orangeBg` (OperatorSecretBanner.tsx:61) when secret is unset — orange + critical action at the top of the page is correct, but the same orange tokens are used inside HealthTab's BUC progress bars (MetaBucPanel.tsx:153) creating visual collision.
- `MetaBucPanel`'s 6 progress bars per card (3 metrics × 2 BUCs) compete for attention — there's no "headline" metric per card.
- `CronTickSnapshotsViewer` puts everything in `font-mono text-xs` (CronTickSnapshotsViewer.tsx:42) — visually screams "internal logs", not "operator dashboard".

### Interaction / state issues
- **Sync tab**: SyncNowButtons fire and the operator must navigate to Activity → JobsTable to see what happened. No inline progress polling. The `setMessage` confirms "events sent" but doesn't track completion (SyncNowButtons.tsx:120-122).
- **Health tab**: `TokenFailuresTable` polls every 30s, `MetaBucPanel`/`FreshnessPanel` are server components (no auto-refresh). Inconsistent freshness model — operator doesn't know which numbers are live.
- **Activity tab**: `StatusEventsFeed` + `CronTickSnapshotsViewer` are server components (no auto-refresh), `JobsTable` polls every 15s. Same inconsistency.
- **Danger tab**: `ResetData` modal-confirm works, but `WhatsappTestButtons` has zero confirmation — clicking "שלח כמו 00:10" really sends a WhatsApp to production phones. Test button on a Danger tab with no guard.
- Error states across panels are inconsistent: `TokenFailuresTable` shows amber line, `JobsTable` shows red line, `FreshnessPanel` returns paragraph text, `MetaBucPanel` returns paragraph text. Five-panel, three-error-style page.

### RTL / mixed Hebrew-English issues
- `CronTickSnapshotsViewer` headers are pure English ("tick_id", "fan_out", "completed", "skipped", "failed", "duration") in an otherwise Hebrew console (CronTickSnapshotsViewer.tsx:34-39). And `text-right` is used for ID + `text-left` for everything else — direction confusion on RTL.
- `FreshnessPanel`'s `Scope` and `Table` columns hold raw English values like "hot_metrics" / "campaigns_daily" while the column headers are Hebrew. The pages mixes internal-DB English with operator-Hebrew throughout.
- `JobsTable` status badges are English (`Completed`, `Failed`, `Running`, `Cancelled`) per Inngest convention — fine for a dev, but the rest of the row is Hebrew.
- `StatusEventsFeed` events show `from_status → to_status` (StatusEventsFeed.tsx:54) with English status values (`paused`, `enabled`) on a Hebrew page.
- `ResetData`'s buttons say "איפוס מלא — מחק את כל הנתונים..." but the typed-confirmation tokens are English ("YES-DELETE-ALL-DATA"). Mixed language input field.
- `WhatsappTestButtons` shows English brand "WhatsApp" in section header parenthetical (DangerTab.tsx:21) but section title is Hebrew "התראות WhatsApp" — duplicated brand name in two places.

### Specific file:line problems
- **operator/page.tsx:42-48** — header description is one-line filler. The /operator page is the most-load-bearing page in the product (the "is the pipeline healthy?" page) and the page itself doesn't answer that question above the fold.
- **operator/page.tsx:58** — `<Tabs.Root defaultValue="sync">` — defaults to Sync, but the operator's first question is "is everything healthy?" → Health should be default.
- **HealthTab.tsx:36-45** — the TikTok historical disclaimer banner has no dismiss / "I've read this" affordance; renders forever even after the operator has internalized it.
- **HealthTab.tsx** — Health tab has 4 sections (`TokenFailuresTable`, disclaimer, `MetaBucPanel`, `FreshnessPanel`) — but the disclaimer is inline-rendered, not a `<section>` like the others. Inconsistent component shape.
- **ActivityTab.tsx** — 3 sub-sections, all server components, all unreffereshable without a hard-reload. On a streaming-event page, that's the wrong default.
- **DangerTab.tsx:33** — `<hr className="border-line-subtle" />` between WhatsappTestButtons and ResetData — `<hr>` is the wrong primitive on a tab with two distinct danger surfaces. Should be two clearly bounded panels.
- **OperatorSecretBanner.tsx:80** — input uses `pr-8` (LTR padding-right) inside an RTL banner — eye icon offset bug. Should be `pe-8`.
- **SyncNowButtons.tsx:157** — `className="gap-1 bg-accent/70 hover:bg-accent/80 text-white"` — buttons override the `variant="ghost"` they receive (line 151). Variant declarations should be authoritative; inline accent colors fight the design system.
- **MetaBucPanel.tsx:65-72** — `if (!rows.length)` returns a paragraph text without any styling indicating it's a "good" empty state. Operator can't tell if "no BUC data" means "everything's fine" or "the panel is broken".
- **MetaBucPanel.tsx:99** — "עודכן לפני N דק׳" computed inside a server component → frozen at SSR. Re-renders only on full page reload. Misleading freshness signal.
- **JobsTable.tsx:117** — `bg-status-grayBg text-status-gray border-status-gray/30` for Cancelled status — but `bg-status-grayBg` isn't a token used elsewhere; verify it's not a dead/broken class.
- **FreshnessPanel.tsx:86-89** — empty-state copy mentions "Phase B" — internal phase numbers leak to operator UI. Should be "no entries yet".
- **StatusEventsFeed.tsx:49** — `text-ink-secondary shrink-0 text-xs w-24` fixed-width 24-unit column for the relative-time string. "5 דקות לפני" is shorter than "23 שעות לפני"; the column never fills consistently.
- **CronTickSnapshotsViewer.tsx:46-50** — color-coded counts (green/orange/red) inside `font-mono text-xs` cells with no headers labeled to those colors. Operator must infer "green=completed" from column header English text.

### Top 3 recommendations for THIS page
1. **Add a status-strip header to /operator** — "All systems green" / "2 token failures · 1 budget skip" with deep-links to the relevant tab. Default the page to Health, not Sync.
2. **Unify the four tabs' error/empty/loading/refresh model.** Either all panels poll, or all panels surface a "refresh" button + last-refreshed timestamp. The current mix (some 15s SWR, some 30s, some 0) is a freshness illusion.
3. **Standardize the danger affordances.** `WhatsappTestButtons` on the Danger tab must require a confirm gate like `ResetData`. Add a `<DangerSection>` wrapper that applies red top border + section icon to every section in that tab.

---

## Cross-page patterns

### Recurring noise patterns
- **`SectionIntro` wall-of-text.** Used on Trends, Archive, P&L, Detail, Campaigns, Products. Every page wraps in a 2-3 sentence description that explains either what the page does or its visual conventions. Premium tools let the page speak for itself.
- **Card lasagna.** Each section everywhere is its own `bg-elevated border rounded-xl shadow-sm` card. On pages with 5+ sections (Home, Operator) the chrome dominates the data.
- **Dual-language column headers.** Hebrew headings on tables (MonthlyTables, DetailTable) but English headers on operator log tables (CronTickSnapshotsViewer, JobsTable function_id column). Inconsistent localization.
- **Mixed direction sub-trees.** Many components force `dir="ltr"` on inner tablists or tab rails (Dashboard.tsx:660, MonthlyTables.tsx:229, AnalysisArchiveTab dropdowns) — these create RTL/LTR boundary edge-cases that fight with focus rings and margin tokens.
- **Two-step disclosure of high-value info.** InsightsBoard → `<details>` wrapper, PnLBreakdown by-source → `<details>`, AnnotationsPanel → collapsed by default. The most useful content is always behind one extra click.

### Missed opportunities
- **No global synthesis.** The dashboard knows everything: it computes pacing vs goal, knows which campaign is bleeding, knows what changed since yesterday. But the cross-tab synthesis (a top-of-page "today's TL;DR") doesn't exist on any page. Each page synthesizes its own scope; the user must do the cross-scope synthesis in their head.
- **No deep-linking.** Insights show "Hide" and "Mark done" actions but no "Jump to the campaign in Campaigns tab" action. Same for tokens failures → /operator tab.
- **No keyboard navigation beyond `CommandPalette`.** Tabs can't be cycled with `Cmd+1..6`; tables don't support arrow-key navigation.
- **No data confidence / freshness on data pages.** Only the operator console surfaces freshness. The Home/P&L/Detail pages just show numbers — no "data through 14:23 IL" inline hint per metric.
- **No theming polish on dark mode.** Multiple eslint-disabled hex colors inside hero components (HeroOverview.tsx:519-522, 582-597) indicate dark-mode wasn't fully migrated to tokens.

### Recurring inconsistencies
- **Currency prefix placement.** Sometimes `CAD ${value}` (PerStoreCards.tsx:152), sometimes `${value}` with a small "CAD" eyebrow (HeroOverview.tsx:676-678), sometimes `CAD` inside a `me-1` span (PnLBreakdown.tsx:309). Three patterns for the same job.
- **ROAS color/text mapping.** Centralized in `roasLabel()` (good!) but the consumers diverge — TodayLive uses tinted card backgrounds, HeroOverview uses tinted chips, KpiCards use chips, MonthlyTables uses cell backgrounds, PerStoreCards uses chips, DetailTable uses cell backgrounds. Same data, six visual treatments.
- **Empty-state copy tone.** Some pages use "אין נתונים בטווח שבחרת" (DetailTable), others "אין רשומות freshness עדיין..." (FreshnessPanel mentions Phase A), others "אין כשלי טוקנים פתוחים. הכל ירוק." (TokenFailuresTable — best). No unified empty-state voice.
- **Refresh affordances.** Home/P&L/Detail rely on 60s SWR + nothing visible. /operator shows "עודכן לפני N דקות" on some panels and not others. CommandPalette has a refresh action that not all users discover.
- **Edit affordances on action items.** GoalTracker shows a pencil icon, BillingSettings opens a modal, ManualOverridesCrud has inline buttons, Insights have "Mark done" + "Hide" pills. Five different "edit/manage" UX patterns.

---

## Prioritized recommendations (global)

### P0 — fixes that materially change command-center feel
1. **Kill duplicate KPIs across Home's three bands.** Currently 17 tiles with 9 unique metrics — reduce to 5–6 tiles in one hero strip. (Most-broken page, most-important page.)
2. **Move GoalTracker to Home.** P&L is not where the operator goes to check pacing; Home is. The component's docstring already says "global". (Memory MEMORY.md confirms: monthly goal panel is global.)
3. **Add a status-strip header to /operator.** Default the operator route to Health. Surface "All green / N issues" in the page chrome. (The /operator page is the load-bearing trust surface; today it hides the answer behind 4 tabs.)
4. **Standardize empty/loading/error/refresh patterns** with a shared `<DataPanel>` primitive. Eliminates the freshness-illusion mix across panels.
5. **Add per-page "TL;DR" or "top action" line.** Trends, Archive, Detail have zero synthesis layer. Each page should answer its core question in one auto-generated sentence, like HeroOverview's editorial line.

### P1 — major polish wins
6. **Remove every `SectionIntro` description that's filler.** Replace with a single hero line per page; move conventions/legends into tooltips or inline column-header `?` affordances.
7. **De-card the long pages.** Archive, Operator, P&L use too many `rounded-xl border shadow-sm` wrappers. Group sections by background-tone instead of by border.
8. **Consolidate dropdowns.** YearSelector + MonthSelector → single date scrubber. MonthlyTables internal store dropdown → drop in favor of global filter. Reduces redundant controls.
9. **Promote the by-source breakdown out of `<details>` in P&L** and the InsightsBoard out of `<details>` in Home. The most useful content should not be one click away.
10. **Add a totals row + click-to-sort + row-drilldown to DetailTable.** Three changes turn the page from "raw log" to "raw log + diagnostic".
11. **Confirm gate on `WhatsappTestButtons` on the Danger tab.** Cheap to add, prevents real WhatsApp spam.
12. **Unify currency prefix placement** into a `<MoneyValue>` component used everywhere — single source of truth for CAD prefix + tabular-nums + RTL margins.

### P2 — quality-of-life
13. **Fix RTL leakage**: `pr-8` → `pe-8` in OperatorSecretBanner.tsx:80; remove unnecessary `dir="ltr"` on tablists; rationalize `me-1`/`ml-1.5`/`ms-1` inconsistency in PnLBreakdown.
14. **Add tab-trigger transparent-border baselines** to prevent the 2px layout shift in AnalysisTab + OperatorTab.
15. **Localize English in operator log tables** (CronTickSnapshotsViewer headers, JobsTable status badges, StatusEventsFeed from→to values) — at minimum, wrap the English in `<code>` so it visually signals "internal".
16. **Remove dead props**: `globalStore` in AnalysisArchiveTab.tsx; `dCpm`'s void cast in HeroOverview; `MONTHLY_TABLES_HISTORY_MONTHS` when `year` is set.
17. **Surface freshness inline** on data pages (small "data through HH:MM IL" hint on each card or KPI strip), not only in the global `FreshnessChip` and `/operator`.
18. **Replace hardcoded 100-row cap in DetailTable** with virtualization (CampaignsTable's pattern already exists in the codebase).
