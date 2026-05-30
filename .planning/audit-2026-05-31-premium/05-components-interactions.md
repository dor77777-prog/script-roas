# Components + Interactions Audit
_Independent eyes pass — 2026-05-31, baseline `main @ afc9bf6`_

Scope: `dashboard-web/src/components/**` against a Premium-2026 standard
(Linear, Vercel, Stripe Dashboard, Notion Calendar). No code modified.

---

## Primitive coherence

The primitive layer at `src/components/ui/` looks healthy on paper —
Button (CVA), Badge (CVA + `BADGE_TONE_BG`), InsightCard (compound API),
Sheet/Dialog/Tooltip (Radix-wrapped), Stat, TableBase, Sparkline, Tabs,
Select, Switch, Input, Card. That impression collapses the moment you
look at *consumption counts*.

Consumption of each primitive across `src/**` (excluding tests):

| Primitive | Import sites |
|-----------|--------------|
| `Button` | 39 |
| `chart/ChartTooltip` | 6 |
| `chart/ChartContainer` | 6 |
| `InsightCard` | 4 |
| `Badge` | 3 (only via the `BADGE_TONE_BG` lookup, never `<Badge>` itself, except the test files) |
| `Sheet` | 2 (CampaignDrawer, AdsDrawer) |
| `AiInsightPill` | 1 |
| `Stat` | **0** |
| `TableBase` | **0** |
| `Card` | **0** |
| `Dialog` | **0** (despite live "modal" surfaces) |
| `Input` | **0** |
| `Select` | **0** |
| `Switch` | **0** |
| `Tabs` (the wrapper) | **0** (operator + Dashboard both call `* as Tabs from '@radix-ui/react-tabs'` directly — `dashboard-web/src/app/operator/page.tsx:17`, `dashboard-web/src/components/Dashboard.tsx:502`) |
| `Tooltip` (the wrapper) | **0** (53 native `title=` attributes in `src/components/**`) |
| `ui/Sparkline` | 2 (DetailTable, CampaignsTableRow) — but **a second `Sparkline` lives at `dashboard-web/src/components/Sparkline.tsx`** with a richer API (`values/target/filled/showEndpoint`) and is the one used by KpiCards |

In short: the primitive layer was built and tested in isolation
(`dashboard-web/src/components/ui/__tests__/` contains files for every
primitive) but the rest of the codebase did not migrate. The system is
shipping two design-systems in parallel — a *blessed* one nobody uses,
and an *organic* one that grew into every consumer file.

Token consumption is also inconsistent. `Button.tsx:13–17` only uses
five semantic tokens (`bg-accent`, `bg-elevated2`, `text-ink`,
`bg-status-red`, `border-line`). `Stat.tsx:20–25` uses a four-tone CVA
table (neutral/warning/success/danger) keyed to `border-*` +
`bg-status-*Bg`. The three local `Stat` forks (below) use different
token combinations that are not in the primitive's variant table —
including a `compact` mode in CampaignDrawer's `DrawerStat`
(`dashboard-web/src/components/CampaignDrawer.tsx:1581`), a `prefix` slot
in CampaignsTable's `Stat` (`CampaignsTable.tsx:2493`), and a
*pressable/active state* in CampaignsTable's `Stat`
(`CampaignsTable.tsx:2511–2517`) that the primitive cannot express.

Radius vocabulary in `src/components/**` (top 4): `rounded-lg` 22,
`rounded-xl` 7, `rounded-md` 5, `rounded-full` 1. That's three radii
casually mixed at the same scale — Card uses `rounded-xl`
(`Card.tsx:6`), Stat uses `rounded-md` (`Stat.tsx:13`), Button defaults
to `rounded-md` but `lg` is `rounded-lg` (`Button.tsx:20–23`),
InsightCard is `rounded-lg` (`InsightCard.tsx:21`), Sheet has no radius
at all (`Sheet.tsx:9`), Dialog uses `rounded-xl`
(`Dialog.tsx:23`). There is no `--radius-*` token in tailwind.config.

Elevation: Card has `shadow-sm` / `shadow-md` (`Card.tsx:11–12`), Sheet
has `shadow-xl` (`Sheet.tsx:10`), Tooltip has `shadow-md`
(`Tooltip.tsx:21`), MetricHelp popover uses `shadow-elevated`
(`MetricHelp.tsx:114`), CommandPalette dialog uses `shadow-elevated`
(`CommandPalette.tsx:514`). Five elevation levels with no documented
hierarchy.

**Premium-2026 gap**: a real design system has one Button, one Card,
one Stat, one Table — *and the rest of the codebase consumes them*. The
hardest, most expensive part (write the primitive *and* migrate every
caller) has been skipped. The primitives are decorations.

---

## Card / surface language

The codebase has **at least 7 different surface treatments** masquerading
as cards. None reuse `Card.tsx`. Inventory:

1. **`InsightsBoard` section** —
   `dashboard-web/src/components/InsightsBoard.tsx:222`
   `rounded-2xl bg-elevated border border-line-subtle shadow-sm overflow-hidden`
2. **`InsightsPanel` via primitive `InsightCard`** — the only
   InsightCard consumer (`InsightsPanel.tsx:46`).
3. **`KpiCards.KpiCard`** —
   `dashboard-web/src/components/KpiCards.tsx:280–285`
   `rounded-xl bg-elevated border border-line-subtle p-3.5 sm:p-5 shadow-sm hover:shadow-cardHover hover:border-line`
4. **`GoalTracker`** — three different surfaces in one file
   (gradient-accent at line 124, neutral panel at 153 + 247, all
   `rounded-2xl`).
5. **`PerStoreCards.StoreCard`** — defines its own
   `rounded-xl border` pattern with a leader/risk decoration.
6. **`HealthScorePanel`** — wraps the primitive `InsightCard` but
   overrides padding via `space-y-4` className
   (`HealthScorePanel.tsx:132`).
7. **`CommandPalette` dialog** — bespoke
   `bg-elevated rounded-2xl shadow-elevated border border-line-subtle`
   (`CommandPalette.tsx:514`).
8. **`TodayLive` hero** —
   `dashboard-web/src/components/TodayLive.tsx:103–120` ships
   `bg-[linear-gradient(225deg,var(--status-X-bg),var(--surface-elevated-1)_75%)]`
   per-band (gray/red/orange/green/blue) with bespoke pulse + blob.
9. **`Filters`** — `rounded-xl bg-elevated border border-line-subtle shadow-card`
   (`Filters.tsx:70`).
10. **Attribution gap panel** — full-bleed colored border-bottom
    section, not a card (`CampaignsTable.tsx:2247`).

The radius alone has three values (`xl`, `2xl`, occasional `lg`), the
shadow has four values (`sm`, `card`, `cardHover`, `elevated`), and the
hover-elevation pattern is implemented only in `KpiCards`. Other
"card-like" surfaces (StoreCard, GoalTracker, etc.) don't lift on hover
at all — so the affordance is inconsistent.

**Premium-2026 gap**: shipping a `Card` primitive is meaningless if 9
other surfaces re-invent it. The audit can name the spec but the
codebase has not adopted it.

---

## Table UX patterns

Five tables, five subtly different implementations. None use
`TableBase`. Side-by-side scan:

| Table | File:line | Sticky `thead` | Row hover | Numeric alignment | Sort affordance |
|-------|-----------|----------------|-----------|-------------------|-----------------|
| `CampaignsTable` | `CampaignsTable.tsx:2027` | yes (`bg-elevated2`) | `hover:bg-elevated2/50` per-row | `tabular-nums text-end` per-cell | `SortHeader` arrow-up/down/up-down (line 2477) |
| `AdSetTable` | `AdSetTable.tsx:101` | yes (`bg-elevated2/60 z-[5]`) | none on `<tr>` | `tabular-nums` | `AdSetSortHeader` (private to file) |
| `AdsDrawer` | `AdsDrawer.tsx:393` | yes (`bg-elevated2/60 z-[5]`) | none on `<tr>` | `tabular-nums` | `AdSortHeader` (private) |
| `MonthlyTables` | `MonthlyTables.tsx:386 + 512` | yes (`bg-elevated2 z-[5]`) | `border-t border-line` only | `tabular-nums` | not sortable |
| `DetailTable` | `DetailTable.tsx:70` | yes (`bg-elevated2 z-[5]`) | `hover:bg-elevated2/50` | `tabular-nums` | not sortable |
| `ProductsTable` | `ProductsTable.tsx:638` | yes | row hover | tabular | yes |
| `CohortComparisonPanel` | `CohortComparisonPanel.tsx:233` | none — `bg-elevated2/50` header | none | manual `text-end` | n/a |
| `MetaShopifyReconciliation` | `MetaShopifyReconciliation.tsx:809` | none | n/a | n/a | n/a |
| `ProductCentricView` | `ProductCentricView.tsx:483` | none | n/a | n/a | n/a |

Findings:

- **3 different sort header helpers** (`SortHeader` in CampaignsTable,
  `AdSetSortHeader` in AdSetTable, `AdSortHeader` in AdsDrawer) — all
  with the same arrow-up/arrow-down/double-arrow vocabulary, all
  duplicated.
- **Row hover is inconsistent** — CampaignsTable + DetailTable have it
  (`hover:bg-elevated2/50`), AdSetTable + AdsDrawer + MonthlyTables do
  *not*. TableBase has `hover:bg-elevated/40` (`TableBase.tsx:29`) — the
  blessed value matches neither.
- **Sticky z-index is `z-[5]` in 4 of the 5 tables but the
  CampaignsTable header is plain `bg-elevated2`** (`CampaignsTable.tsx:2027`)
  — no `z-[5]`, no `sticky top-0`. The pinned-header behaviour in the
  flagship table relies on its wrapper's `overflow-auto max-h-[60vh]`
  alone.
- **Header text colour drifts** — CampaignsTable headers are
  `text-ink-secondary` *after* the SortHeader's `<Button variant="ghost">`
  re-tints them; AdSetTable uses `text-ink-secondary` on the `<tr>`;
  CohortComparisonPanel uses `text-ink-muted`
  (`CohortComparisonPanel.tsx:234`). `MonthlyTables` adds an inline `bg-ink text-canvas` "header bar"
  (`MonthlyTables.tsx:377`) — a treatment that exists in no other
  table.
- **Sparkline-in-cell** is implemented only in `DetailTable`
  (`DetailTable.tsx:100`) — operator can see store ROAS trend per row
  there but not in CampaignsTable's per-campaign rows (the
  `dailySeries` prop is plumbed to `CampaignsTableRow` for a sparkline
  column, see comment at `CampaignsTableRow.tsx:99–110`, but the rest
  of the campaign tables don't follow suit).
- **Hover-row reveal of actions** is absent across the board — the
  `aria-label="פעולות"` columns in AdsDrawer (`AdsDrawer.tsx:407`,
  `:511`) and AdSetTable always show their action icons, leading to
  permanent visual noise instead of a "row hovers → actions appear"
  affordance.
- **Numeric alignment is per-cell-class** — no `<TableCell numeric>`
  semantic to flip behaviour. Future regression vector: easy to forget
  `text-end tabular-nums` on a new numeric column.
- **The flagship table is 2557 lines** (`CampaignsTable.tsx`) including
  a 30-line local `Stat()` function (2490–2556) and a SortHeader helper
  (~2450). At this scale, micro-decisions can't be enforced.

**Premium-2026 gap**: tables are the *defining* surface for a data
dashboard. Linear's table system is one component with three composable
primitives; this codebase has five tables with subtly different
behaviour at the same time — and the operator's eye sees the drift.

---

## Drawer + filter UX

### Sheet primitive
`dashboard-web/src/components/ui/Sheet.tsx`:

- `SheetContent` has **no radius** (`Sheet.tsx:9`) — pulls flush to the
  page edge. Premium drawers (Linear, Vercel) round the inboard corner.
- Backdrop is `bg-overlay backdrop-blur-sm`
  (`Sheet.tsx:39`) — fine, but matches Dialog backdrop exactly, so the
  visual hierarchy between "modal" and "drawer" is flat.
- Close button is `absolute end-3 top-3` (`Sheet.tsx:48`) — but
  `CampaignDrawer` and `AdsDrawer` add their OWN header chrome with a
  Maximize2/Minimize2 button (`CampaignDrawer.tsx:826–834`,
  `AdsDrawer.tsx:341–350`). The primitive's close × ends up *underneath*
  the sticky header at `CampaignDrawer.tsx:800` because the header is
  `sticky top-0 ... z-10` and the SheetClose has no `z-*` — operator
  hits the maximise icon when reaching for the close. (Manually
  verified: the close × from the primitive sits at coordinate
  `absolute end-3 top-3`, the sticky header occupies that exact region.)
- Scroll lock is implemented *manually* in each drawer
  (`CampaignDrawer.tsx:266–270`, `AdsDrawer.tsx:128–133`) instead of
  inside the primitive. Both call `document.body.style.overflow =
  'hidden'` directly, defeating Radix's own focus-trap-aware scroll
  lock.
- `onEscapeKeyDown={(e) => e.preventDefault()}` in both drawers
  (`CampaignDrawer.tsx:791`, `AdsDrawer.tsx:318`) disables Radix's ESC
  handling and re-implements it via `useDrawerEsc` from
  `dashboard-web/src/lib/drawerStack.ts`. Reason is correct (nested
  drawer stacking), but the choice is undocumented in the primitive.
- The drawer has a "fullscreen" toggle (`isFullscreen` in both drawers)
  that swaps `w-[min(640px,100vw)]` for `max-w-full`. The transition
  uses Sheet's default `slide-in-from-end` animation only on mount —
  the width change is instant. Premium UX would animate the width.

### Filter UX
`dashboard-web/src/components/Filters.tsx`:

- Quick presets + advanced expander pattern is solid
  (`Filters.tsx:79–95` + `:149–204`).
- But the *Filter chip* visual is inconsistent with the rest:
  active = `variant="primary"`, inactive = `variant="secondary"`. On
  small viewports the chips share a 2-col grid with a 12px gap — but
  the "more options" toggle uses `ChevronDown` rotate, which is the
  same affordance the InsightsBoard header uses for whole-panel collapse
  (`InsightsBoard.tsx:265`). The vocabulary should be distinct: chevron
  for collapse vs. an inline +more for "show more chips".
- `CampaignsTable` has its **own** in-table toolbar with its **own**
  store selector + date inputs + platform tabs
  (`CampaignsTable.tsx:1176–1381`) that duplicate `Filters`. Same for
  `ProductsTable.tsx:391–490`. The operator can adjust the date range
  in TWO places. The local override is documented (the `localRange`
  state at `CampaignsTable.tsx:245`) but the UI gives no visual
  affordance for "this filter is overriding the global filter" except
  a small text-accent X-icon (`CampaignsTable.tsx:1264–1273`).
- Filter vs. command palette overlap: CommandPalette can change the
  store + preset + tab (`CommandPalette.tsx:166–333`), exactly the same
  state Filters edits. No conflict resolution UI when a command sets
  one filter (e.g. "store=usmile360") while another is active.
- `FocusMode.tsx` adds a Cmd+\ shortcut that dims the chrome — but
  there's no discoverability (no tooltip, no badge, no help text), the
  user has to read the source to find it.

**Premium-2026 gap**: the drawer primitive ships without scroll-lock,
without a focus-trap escape-hatch documentation, without a width
animation; consumers duplicate the close affordance and end up with
overlapping buttons. The Filters component is split across 3
sites with no override indication beyond a tiny X.

---

## Recommendations / insights surfaces

This is the area with the most **decorative density** and the least
**actionability density**. Sites inventoried:

1. `InsightsBoard.tsx` — the flagship. Uses primitive
   `InsightCardGroup` + `InsightCardRow`. Actions per row: "טיפלתי"
   (mark done), "הסתר" (hide), optional external link
   (`InsightsBoard.tsx:582–625`). These mutate localStorage and a
   cloud-synced state — they don't actually change the campaign.
2. `InsightsPanel.tsx` — uses primitive `InsightCard` with three
   pre-canned rows (top store, attention store, best day). **Zero
   actions** (`InsightsPanel.tsx:48–67`).
3. `WhatsWorking.tsx` — three rows: top product, top campaign,
   rising/falling. Each row has a `href` for external Ads Manager but
   no internal drill (`WhatsWorking.tsx:48–57`).
4. `HealthScorePanel.tsx` — recommendation block at the bottom of the
   drawer (`HealthScorePanel.tsx:66–121`). The text is good
   ("ROAS גבולי — לפני שתסקייל, ודא…") but there is **no button**.
   The operator reads the recommendation, then has to scroll back up
   and act on it manually.
5. `AttributionAnalysisPanel.tsx` — verdict with no button.
6. `CohortComparisonPanel.tsx` — has a real `onDrillCampaign` prop
   (`CohortComparisonPanel.tsx:257–261`) so clicking a cohort sibling
   actually navigates. This is the right pattern, applied nowhere
   else.
7. `CampaignsTopList.tsx` — "Winners and Losers" with text verdicts
   like `→ הגדל תקציב משמעותית` (`CampaignsTopList.tsx:81`) — but the
   list itself isn't clickable; operator must find the campaign in the
   table afterward.
8. `MetaShopifyReconciliation.tsx` — large panel with no action
   buttons.

The pattern is: **insights are typographic, not interactive**. They
read like a magazine column. Premium-2026 dashboards (Datadog,
Mixpanel, Linear) make every recommendation a one-click action — "Mute
the alert", "Open the campaign", "Apply the suggested filter", "Mark as
known issue" — where the *action* is the affordance, not a paragraph
the user has to parse.

`CohortComparisonPanel.onDrillCampaign` proves the pattern can be wired
through the codebase; it's just not.

**Premium-2026 gap**: insights are decorative pixels. One out of seven
panels surfaces an actionable drill; the rest end at "you should…".

---

## State coverage matrix

Per async surface, ✅/❌ for {empty, loading, error, success,
skeleton-matches-final-shape}. Skeletons exist only via the
`.skeleton` CSS class in `globals.css:312` — there is no Skeleton
primitive. Only `Dashboard.tsx:315–325` ships a skeleton shape; every
other async surface shows a plain text loading message.

| Surface | Empty | Loading | Error | Success | Skeleton matches shape |
|---------|-------|---------|-------|---------|------------------------|
| Dashboard root (`Dashboard.tsx:303–326`) | ✅ "אין נתונים" inside DetailTable | ✅ skeleton blocks | ✅ red banner | ✅ | ✅ KPI cards skeleton matches grid |
| CampaignsTable (`CampaignsTable.tsx:1729–1751`) | ✅ Megaphone icon | ❌ plain "טוען נתוני קמפיינים…" text | ✅ red banner | ✅ | ❌ no skeleton |
| ProductsTable (`ProductsTable.tsx:527+`) | ✅ message | ❌ "טוען..." | ✅ banner | ✅ | ❌ |
| CampaignDrawer | ✅ in `dailyArr` < 2 branch | ❌ no loader | ❌ no error UI | ✅ | ❌ |
| AdsDrawer (`AdsDrawer.tsx:354–369`) | ✅ Layers icon | ❌ plain text | ❌ no error UI (`fetcher` returns empty on 4xx/5xx, line 56–60) | ✅ | ❌ |
| InsightsBoard (`InsightsBoard.tsx:317–325`) | ✅ Sparkles icon | ✅ inline "מנתח…" + spinner | ❌ no error path | ✅ | ❌ |
| HeroOverview | ✅ | ❌ no loader (waits for parent) | ❌ | ✅ | ❌ |
| TodayLive | ✅ baseline tone | ❌ | ❌ | ✅ | ❌ |
| GoalTracker | ✅ "קבע יעד" empty state | n/a (localStorage) | ✅ inline error | ✅ | n/a |
| CommandPalette (`CommandPalette.tsx:552–556`) | ✅ "אין תוצאות" | ❌ no loading (SWR lazy) | ❌ | ✅ | ❌ |
| MetricHelp / popover | n/a | n/a | n/a | ✅ | n/a |
| ProductPickerModal (`ProductPickerModal.tsx:303–308`) | ✅ | ✅ loading | ❌ no error UI | ✅ | ❌ |
| MetaShopifyReconciliation | ✅ guards | ❌ | ❌ | ✅ | ❌ |
| AttributionGapPanel (`CampaignsTable.tsx:2225+`) | ✅ returns null | n/a | n/a | ✅ | n/a |

Hot spots:

- **AdsDrawer swallows errors silently**: `fetcher` returns
  `{ rows: [], lastUpdated: …, dataLastWriteAt: null }` on any non-OK
  response (`AdsDrawer.tsx:56–60`). The empty state then renders, and
  the operator believes "no ads in this ad-set" when the real reason
  was an API failure. Same pattern in **MonthlyTables / Filters
  fetchers** wherever `useSWR(.., async url => { if (!r.ok) return {…}
  })` appears.
- **CampaignDrawer has no loading state at all** — the drawer slides
  in, then the body re-renders as charts arrive. The user sees content
  pop in with no skeleton.
- **No skeleton matches final shape** outside Dashboard.tsx — the
  loaders are either text strings ("טוען...") or pulsing rectangles
  unrelated to the final layout, so the user sees a layout reflow when
  data lands.
- **ErrorBoundary is a single-place safety net**
  (`ErrorBoundary.tsx`) wrapping `{children}` in `layout.tsx:74`. There
  are no granular boundaries around the heavy panels
  (CampaignsTable, HeroOverview, CommandPalette), so a render error in
  any of those tears down the whole dashboard.

**Premium-2026 gap**: skeleton-as-layout-stand-in is table stakes;
silent error swallowing is a trust-killer.

---

## Interaction polish

### Hover / focus-visible / active / selected / disabled
- **Button** has `focus-visible:ring-2 focus-visible:ring-accent
  focus-visible:ring-offset-2 focus-visible:ring-offset-canvas`
  (`Button.tsx:8–9`). Good — but the ring colour is the SAME as the
  primary button's bg (`bg-accent`), so on a focused primary Button
  the ring is *invisible*. Fix needs a different focus colour or a
  shadow ring.
- 14 `focus:outline-none` instances **without a corresponding
  focus-visible:ring** (BillingSettings.tsx lines 726–1127,
  ProductsTable.tsx, GoalTracker.tsx, YearSelector.tsx): hits the
  default browser outline AND removes the replacement. Keyboard
  navigation surfaces invisibly there.
- The Filters `<select>` (line 107) and CampaignsTable `<select>`
  (`CampaignsTable.tsx:1216`) only have `focus:ring-2 focus:ring-accent/30`
  — NOT `focus-visible:`. They show a ring for mouse clicks too,
  which is acoustic noise.
- **Hover affordance is uneven**: KpiCards lifts (`shadow-cardHover`,
  `KpiCards.tsx:283`), CampaignsTable rows tint
  (`hover:bg-elevated2/50`), AdSetTable rows have no hover at all,
  InsightCardRow has `hover:bg-elevated/60` (`InsightCard.tsx:228`).
- **Active state on the in-toolbar tab buttons**
  (`CampaignsTable.tsx:1190–1206`, `:1308–1325`): both use
  `aria-selected={…}` AND a manual `bg-accent` class, but the
  underlying `Button` variant is `ghost`, so the focus ring doesn't
  contrast. There's also no `active:` press state — the chip stays
  identical between hover and press.
- **Disabled state**: only `Button` honors `disabled:opacity-50
  disabled:pointer-events-none` (`Button.tsx:9`). Local `<select>` and
  `<input>` instances have no disabled styling. `GoalTracker` Save
  button respects `disabled={draftIsInvalid}` correctly because it
  uses the primitive (`GoalTracker.tsx:193`).
- **Pressed state on chips/badges**: HealthScoreBadge uses
  `active:scale-95` (`HealthScoreBadge.tsx:77`) — the *only* chip in
  the codebase with a press scale. Everything else is static.

### Selected/active markers
- `aria-selected`, `aria-pressed`, `aria-current` are present on the
  *important* surfaces (TabNav, Sidebar, mode chips, optimisation
  toggle). Good coverage.
- `data-state="active"` is used by Radix Tabs (Tabs primitive's
  trigger, `Tabs.tsx:30`) but the operator page uses Radix directly
  and styles via `data-[state=active]:font-medium
  data-[state=active]:border-b-2 data-[state=active]:border-accent`
  (`operator/page.tsx:64`) — visually thinner than the dashboard's
  TabNav which uses a different vocabulary
  (`TabNav.tsx:52`). Operator + dashboard tabs look like two systems.

---

## Micro-interactions and motion

`package.json` has no framer-motion / motion-one / @react-spring —
animation is **tailwindcss-animate plugin + 3 keyframes in
tailwind.config.ts** (`fade-in`, `fade-in-up`, `shimmer`). The
`transitionDuration.DEFAULT` is `180ms`, `transitionTimingFunction.DEFAULT`
is `cubic-bezier(0.22, 1, 0.36, 1)` (ease-out cubic, no bounce).

Vocabulary inventoried:
- `transition-colors` + `transition-all` + `transition-opacity` +
  `transition-transform` — 82 occurrences across `src/components/**`.
- `animate-fade-in` / `animate-fade-in-up` — used by InsightsBoard
  (`InsightsBoard.tsx:329, 384`), Filters (`Filters.tsx:150`),
  Dashboard skeleton (`Dashboard.tsx:316`).
- `animate-pulse` — used twice (Dashboard skeleton).
- `animate-spin` — used inside Lucide `<RefreshCw>` and
  `<Loader2>` only (`InsightsBoard.tsx:249`, `JobsTable.tsx:125`).
- `animate-ping` (the all-clear dot at `InsightsBoard.tsx:307`).
- `RollingNumber` component for KPI digits (the only "premium"
  animated component).
- **View Transitions API** for tab switches (`globals.css:350–354`)
  and drawer entrance (`globals.css:360–366` +
  `CampaignDrawer.tsx:793` via `style={{ viewTransitionName:
  'drawer-panel' as never }}`) — solid, modern, but only two sites use it.
- `hover:scale-105` / `active:scale-95` / `active:scale-[0.98]`
  — 4 occurrences total. No consistent press feedback.

What's missing for premium feel:
- **No motion vocabulary doc** — durations are duration-DEFAULT
  (180ms) and duration-slow (320ms). Linear/Vercel ship 4–6 motion
  tokens (snap, fast, base, slow, slower) with documented use cases.
- **No layout shift compensation** — drawer width-change is instant;
  fullscreen toggle is instant.
- **No staggered entrance** for grids (KpiCards, PerStoreCards) —
  6 cards appear at once.
- **No micro-feedback on filter changes** — when the user clicks a
  preset chip, the only feedback is the chip's background going from
  secondary to primary; no flash, no underline expansion.
- **Tooltip & MetricHelp use raw CSS show/hide** with manual grace
  timers (`MetricHelp.tsx:55–73`) — Radix Tooltip is wrapped in
  `Tooltip.tsx` and unused.

---

## Tooltips, contextual help, accessibility hints

- `MetricHelp.tsx` (used 1 time, in KpiCards `KpiCards.tsx:298`) is
  the only structured help affordance. Manual grace timer
  (`HIDE_GRACE_MS = 200`), keyboard-focusable, popover anchored
  `top-full mt-2 end-0`, RTL-correct via `dir="rtl"`.
- **53 native `title=` attributes** across `src/components/**` —
  these don't show on touch, don't respect prefers-reduced-motion,
  and are inaccessible for keyboard users. Examples in
  CampaignsTableRow, AdsDrawer per-icon buttons, HealthScoreBadge
  title.
- **The blessed `Tooltip` wrapper at `ui/Tooltip.tsx` is consumed
  zero times.** A `TooltipProvider` is never mounted anywhere in
  `src/app/layout.tsx` (verified — only `ErrorBoundary` and
  `ThemeProvider` are there).
- `AttributionAnalysisPanel` packs a tooltip-as-`title` with
  multi-line content using `\n` characters
  (`AdsDrawer.tsx:485–491`) — newlines render as spaces in
  native tooltips.
- `MetricHelp` content database (`METRIC_HELP` at
  `MetricHelp.tsx:157+`) is comprehensive (10 metrics) but only
  consumed by KpiCards' 6 cards. The campaign drawer's stat cards,
  the AdsDrawer totals strip, every chip in the campaigns table —
  none of them surface help, so the operator sees ROAS / CPM /
  shopifyValuePlatform without an explanation.
- ARIA labels are mostly good (`aria-label="סגור"`, `aria-label="ערוך"`,
  etc.). One gap: the `CampaignDrawer` Maximize2 button has a `title`
  but the `aria-label` content is dynamic Hebrew
  (`CampaignDrawer.tsx:830`) — verified correct.
- Hebrew RTL handling in popovers: `MetricHelp` flips correctly
  because it uses `start-0`/`end-3` (`MetricHelp.tsx:112`). The
  HealthScoreBadge popover uses `start-0` deliberately
  (`HealthScoreBadge.tsx:101`) — both behave under RTL. The Sheet's
  `slide-in-from-end` (`Sheet.tsx:10`) animates from the start edge
  in RTL because `end` swaps — visually correct.

---

## Prioritized recommendations

### P0 — Trust-killers, ship before any other polish
1. **Delete the duplicate primitives or migrate every consumer.** The
   present state — `Stat`, `TableBase`, `Card`, `Dialog`, `Input`,
   `Select`, `Switch`, `Tabs`, `Tooltip` shipped with tests but zero
   consumption — is worse than not having them. Either (a) migrate the
   3 local `Stat` forks (`AdsDrawer.tsx:543`, `CampaignDrawer.tsx:1575`,
   `CampaignsTable.tsx:2490`, `ProductsTable.tsx:897`) to consume the
   primitive (extending its CVA to cover `prefix`, `chip`, `active`,
   `compact`); (b) migrate the 9 `<table>` sites (CohortComparisonPanel,
   ProductsTable, AdSetTable, MetaShopifyReconciliation,
   CampaignsTable, MonthlyTables, PnLBreakdown, ProductCentricView,
   DetailTable, AdsDrawer) to TableBase; or (c) delete the primitives
   to stop the rot. The current state silently teaches every new
   contributor "the primitives are not real."
2. **AdsDrawer and other SWR fetchers silently swallow errors**
   (`AdsDrawer.tsx:56–60`). Every fetcher of the form `if (!r.ok)
   return { rows: [] }` must distinguish "API failure" from "no rows"
   visually. Empty + error are not the same state.
3. **53 native `title=` tooltips replaced with the (unused)
   `Tooltip` primitive.** Mount `TooltipProvider` in
   `layout.tsx`; sweep CampaignsTableRow, AdsDrawer, HealthScoreBadge,
   AttributionAnalysisPanel, CampaignFreshnessChip. The "5 line
   click-id breakdown" tooltip in `AdsDrawer.tsx:485–491` is the
   worst-offender; multi-line via `\n` collapses to spaces in native
   tooltips.
4. **Drawer close × hides behind sticky header**
   (`CampaignDrawer.tsx:800` `sticky top-0 z-10` overlays
   `Sheet.tsx:48` `absolute end-3 top-3`). Either bump Sheet's close
   `z-30` or move the close into the drawer's own header.
5. **Focus-visible ring on primary Button is invisible.** Same colour
   as button background (`Button.tsx:8 & 13`). Switch to
   `ring-offset-2` with a contrasting ring colour, or use
   `outline-2 outline-offset-2` instead of `ring-2`.

### P1 — Cohesion + actionability
6. **Adopt one card surface** and migrate the 9 organic cards
   (InsightsBoard, KpiCards.KpiCard, GoalTracker x3, PerStoreCards,
   HealthScorePanel wrapper, CommandPalette, TodayLive, Filters,
   AttributionGapPanel). Pick radius + shadow + padding tokens and
   document them in `Card.tsx`.
7. **Make recommendations actionable.** Replicate the
   `CohortComparisonPanel.onDrillCampaign` pattern in
   `HealthScorePanel` (open the campaign), `WhatsWorking` (drill into
   the campaign / product), `InsightsPanel` (drill into the store),
   `CampaignsTopList` (click row → open drawer). Every insight should
   be a verb, not a noun.
8. **Unify sort headers** — the 3 sort-header helpers
   (SortHeader, AdSetSortHeader, AdSortHeader) should be one
   `<TableHeaderCell sortable sortDir onSort>` (already prototyped in
   `TableBase.tsx:35–62`). Same for row hover, sticky z-index, header
   colour.
9. **Skeleton primitive that matches final shape.** Replace plain
   "טוען..." in CampaignsTable, ProductsTable, AdsDrawer,
   CampaignDrawer with a `<Skeleton>` component that mirrors the
   target layout (the Dashboard skeleton at
   `Dashboard.tsx:315–325` is the model).
10. **Override badge** on local toolbar filters
    (CampaignsTable, ProductsTable, CampaignDrawer date range). The
    tiny X icon at `CampaignsTable.tsx:1264–1273` is insufficient to
    indicate "local override active" — add a 1-line "filter overrides
    the global window" hint.
11. **Animate drawer width on fullscreen toggle** — the maximise
    button (`CampaignDrawer.tsx:826`) jump-cuts. A 220ms `width`
    transition matches the existing motion vocabulary
    (`tailwind.config.ts:191`).

### P2 — Premium texture
12. **Hover-row reveal of actions** in tables (CampaignsTable's
    deeplink column, AdsDrawer's open-in-Ads-Manager column,
    AdSetTable's drill-to-ads cell). Hide the icons until the row is
    `group/row:hover` to reduce visual noise from the dense table
    headers.
13. **Press feedback on chips** — add `active:scale-95` to
    HealthScoreBadge-style chips, mode tabs
    (`CampaignsTable.tsx:1190`), filter chips (`Filters.tsx:80`),
    so the system feels physical.
14. **Help on every metric** — extend `MetricHelp`/`METRIC_HELP` from
    KPI cards to: AdsDrawer totals strip
    (`AdsDrawer.tsx:374–383`), CampaignDrawer Stat grid
    (`CampaignDrawer.tsx:872–883`), the CampaignsTable summary
    (`CampaignsTable.tsx:1387–1401`). The "?" beside each metric is
    Premium-2026 default.
15. **Staggered entrance** for KpiCards, PerStoreCards, InsightCard
    rows using tailwindcss-animate's `delay-*` utilities — 50ms per
    card. Don't ship motion until the system is consistent first.
16. **Sticky header on CohortComparisonPanel + ProductCentricView +
    MetaShopifyReconciliation tables** — they break the cross-table
    expectation that all headers pin.
17. **Single motion-token doc** — 4 named durations
    (`snap` 120, `fast` 180, `base` 240, `slow` 320), 2 named eases.
    Stop the proliferation of inline `duration-DEFAULT` /
    `duration-200` / `duration-180ms` strings.

The unifying observation: this codebase has all the *parts* of a
premium design system (radix wrappers, CVA primitives, tokens, motion
keyframes, ARIA hooks). What it lacks is **enforcement** — both at
build time (no lint rule forbids `<table>`/`<button>`/`<select>` outside
ui/) and in the consumer file conventions (every panel still reaches
for raw classNames). Closing that enforcement gap is the difference
between "we built primitives" and "we have a design system."
