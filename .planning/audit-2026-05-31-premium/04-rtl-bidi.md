# RTL + Bidi + Mixed Hebrew/English Audit
**Codebase:** `dashboard-web/`
**Baseline:** main @ afc9bf6
**Date:** 2026-05-31
**Premise:** Hebrew is the primary language. RTL must be a first-class requirement.

---

## External research summary

1. **Tailwind v3.3+ logical properties are the standard for RTL.** Use `ms-*` / `me-*` (margin-inline-start/end), `ps-*` / `pe-*` (padding-inline-start/end), `start-*` / `end-*` (inset-inline-start/end), `border-s` / `border-e`, `rounded-s-*` / `rounded-e-*`, and `text-start` / `text-end`. They automatically mirror without `rtl:` modifiers — strictly preferable to physical `ml-*` / `mr-*` / `text-right`. (Flowbite / Tailwind v3.3 release notes / Madrus blog.)
2. **`<bdi>` and `dir="auto"` use the same underlying isolation mechanism — `unicode-bidi: isolate` — and are now W3C/MDN-recommended defaults for inline mixed-direction content.** `<bdi>` differs from `<span dir="ltr">` only in that `<bdi>` defaults to `unicode-bidi: isolate` while `<span>` defaults to `embed`. The Unicode Consortium recommends *isolation as the default* for all inline bidirectional embeddings (UAX #9).
3. **`dir="auto"` looks at the first strongly-typed character.** This is ideal for *user-entered* content where the developer doesn't know the direction in advance (annotation titles, campaign names imported from Meta, product titles from Shopify). Pair with `<bdi dir="auto">` for safe inline embedding.
4. **Recharts is not RTL-aware** — the library emits raw SVG that is direction-independent. The community workaround is to wrap the chart container in `dir="ltr"` so that Recharts' positional props (`orientation="right"`, `margin.right`, padding) resolve to *visual* right rather than getting auto-mirrored by browser RTL inheritance. Tooltips that float above the SVG remain RTL-controlled (and benefit from the dashboard's existing `ChartTooltip` `dir="rtl"` wrapper).
5. **Numbers, percentages, currency codes ('CAD', '$', '%', '−'), and Latin IDs/URLs are weak-LTR runs** in a Hebrew document. Without isolation they may visually reorder against the surrounding Hebrew — e.g. a minus sign jumps to the wrong side, parentheses flip, or `−12.4%` becomes `12.4%−`. The dashboard's `lib/format.ts` already wraps every numeric atom in `<bdi dir="ltr">` — this is the systematic right answer and should be extended to *every* mixed-text site in the app.

---

## Global RTL setup

**Status: STRONG, with a few latent gaps.**

| Aspect | Finding | File:Line |
|---|---|---|
| `<html lang="he" dir="rtl">` | Correct, set on the root element. | `src/app/layout.tsx:52` |
| Inner wrapper still re-asserts `dir="rtl"` | Defensive; redundant but harmless. | `src/components/Dashboard.tsx:238` |
| Operator pages re-assert `dir="rtl"` | Same pattern; redundant but documented. | `src/app/operator/layout.tsx:25` |
| Hebrew font loaded | `Heebo` (subsets: `hebrew`, `latin`), 6 weights; `Rubik` for tabular numerics; `Geist_Mono` for code/IDs. All via `next/font/google` (self-hosted, no FOIT). | `src/app/layout.tsx:10–37` |
| Tailwind `fontFamily.sans` | Heebo-first → Rubik fallback → system fonts. Correct mixed-language fallback chain. | `tailwind.config.ts:117–127` |
| `tabular-nums` class | Routed through Rubik for *real* OT `tnum` (Heebo has none). Previous schism documented and fixed. | `src/app/globals.css:246–252` |
| `prefers-reduced-motion` | Theme switch script handles dark-mode FOUC, but I did not find a global CSS reduce-motion rule. (Out of scope for bidi, but worth flagging adjacent.) | `src/app/layout.tsx:55–70` |

**Gap: no `tailwindcss-logical` / `tailwindcss-rtl` plugin is installed.** Tailwind v3.3 ships `ms-*` / `me-*` / `ps-*` / `pe-*` / `start-*` / `end-*` / `border-s/e` / `rounded-s/e` natively, and the codebase *does* use them in many places. But there is no lint/CI gate preventing the regression to `ml-*` / `mr-*` / `text-right`, and 38 raw physical-direction occurrences are still in the working tree. See *Logical-direction spacing audit* below.

**Gap: no `dir="auto"` is used anywhere.** Grep returns zero matches. The codebase relies entirely on explicit `<bdi dir="ltr">` for hard-coded LTR atoms (campaign names, platform names, store names, numbers). This works for Meta/Google/TikTok strings the developer authors, but for *operator-entered* free-text content (`AnnotationsPanel` titles + notes, billing line descriptions, product titles imported from Shopify, ad-set names imported from Meta), the safe pattern is `<bdi dir="auto">` — it lets the bidi algorithm pick base direction from the first strong character. Today, several such sites render unwrapped (see §Component findings).

---

## Component-by-component findings

### Sidebar (`src/components/Sidebar.tsx`)

- **Line 170 — collapse chevron uses physical direction.** `{collapsed ? <ChevronsLeft size={14} /> : <ChevronsRight size={14} />}`. In RTL the sidebar sits at the *visual right* (start). When *expanded* the button should suggest "collapse toward start (right)"; when *collapsed* it should suggest "expand toward end (left)". Today's icon choice is correct *if* the sidebar were on the left in LTR (the original design), but it's flipped in RTL — i.e. when the sidebar is expanded on the right, the `ChevronsRight` icon visually says "send me further right", which is incoherent (there is no further right; it would shrink toward the right). **Fix:** swap the literal icons, or build a small `<DirectionalChevron dir="collapse|expand">` helper that returns the correct chevron given `document.dir`. Recommended: import only `ChevronsLeft`/`ChevronsRight` and pick at render time based on `dir`, or use `ChevronFirst`/`ChevronLast` style icons that are bi-directional by convention.
- **Line 198 — `border-s border-line` (logical):** correct.
- **Lines 243, 246 — `start-0`, `translate-x-full`:** RTL handling is explicitly documented and correct (drawer slides off-screen toward visual-right edge in RTL).
- **Line 69 — `-me-1`:** correct logical margin for the close button.

### Filters (`src/components/Filters.tsx`)

- **Line 107 — `<select className="… ps-3 pe-9 …">`:** correct logical padding.
- **Line 118 — `<ChevronDown className="… absolute end-2.5 …">`:** correct logical positioning.
- **No physical-direction violations.** Filters component is a model of correct RTL.

### CommandPalette (`src/components/CommandPalette.tsx`)

- **Line 510 — `dir="rtl"` on the dialog wrapper:** redundant under the global `<html dir="rtl">` but harmless and self-documenting.
- **Lines 273–274 — Campaign + product label/subtitle interpolate raw English strings into Hebrew context without isolation.**

  ```jsx
  label: c.campaignName || '(ללא שם)',          // English name
  subtitle: `${c.platform} · ${c.store} · ROAS ${roas.toFixed(2)}`, // "Meta · uzoshop · ROAS 2.85"
  ```

  These strings are later rendered at lines **684** (`{item.label}`) and **688** (`{item.subtitle}`) inside `<div>`s with no `<bdi>` or `dir="auto"`. When the campaign name contains both Hebrew and English (common in this dashboard: "קמפיין קיץ Summer Sale | uzoshop-2026"), the trailing English number runs (`2026`) can visually leap to the wrong side of the Hebrew prefix. The subtitle is even worse: it interpolates English platform name + English store + Hebrew "ROAS" label + Latin digits with the `·` separator — the `·` is bidi-neutral and may end up at either end. **Fix:**
  - Change the type so `label`/`subtitle` accept `ReactNode`, not `string`.
  - Wrap the campaign-name label in `<bdi dir="auto">{c.campaignName}</bdi>`.
  - For the subtitle, build it as JSX: `<><bdi dir="ltr">{c.platform}</bdi> · <bdi dir="ltr">{c.store}</bdi> · ROAS <bdi dir="ltr">{roas.toFixed(2)}</bdi></>`.
- **Lines 322 — Product label/subtitle:** same defect. `subtitle: \`${p.store} · ${p.units.toLocaleString('he-IL')} יחידות\`` mixes English store name + Hebrew-locale number formatting + Hebrew "יחידות". Same fix.

### CampaignDrawer + CampaignDrawerStatusSection

- **`CampaignDrawer.tsx:808`** — campaign title properly wrapped in `<bdi dir="ltr">`. **Correct.**
- **`CampaignDrawer.tsx:840`** — "פתח ב-`<bdi dir="ltr">Meta</bdi>` Ads Manager" — properly isolates the platform name. **Correct.**
- **`CampaignDrawer.tsx:1304`** — `ml-1` (physical) on the "ניתוח:" label. Should be `me-1`. Same bug as `CampaignsTable.tsx:1703` (duplicated copy of the same block).
- **`CampaignDrawerStatusSection.tsx:66, 72, 81`** — render raw English status enums (`DELIVERING`, `PENDING_REVIEW`, `BACKFILL_UNKNOWN`) inside Hebrew-context `<span>`s without isolation. Because each enum is alone in its own `<span>`, the bidi algorithm assigns it LTR correctly, *but* the surrounding label like `<span>configured</span>` (line 59, line 70) is itself unwrapped English inside a Hebrew section — it's read fine but if a future developer concatenates `"configured: ACTIVE — 5 דק׳ לפני"` in one cell, ordering will break. **Fix (defensive):** wrap each English enum value in `<bdi dir="ltr">` so a future copy edit doesn't regress. Also wrap the lowercase English column labels (`configured`, `effective`, `delivery`, `last_live_tick`, `metrics lag`) in `<bdi dir="ltr">` — they currently sit inside a `grid grid-cols-2` where the visual ordering is fragile.

### AdsDrawer (`src/components/AdsDrawer.tsx`)

- **Line 336 — `{adSetName}` rendered raw in `<h2>`** without `<bdi>` wrap. Ad-set names from Meta are typically English (`"Lookalike 1% | USA | Broad"`). The vertical pipe `|` is bidi-neutral and may visually reverse against any Hebrew chars in the name. **Fix:** wrap in `<bdi dir="auto">{adSetName}</bdi>`. The matching `title={adSetName}` attribute is fine (browsers handle that themselves).
- **Line 459 — `<td>{a.adName}</td>` in the ad-name column** — same defect. Ad names regularly look like `"Creative V3 - לקראת קיץ - 1080x1080"`. The Hebrew + Latin + numbers + `-` separator mix without isolation makes visual order unpredictable. **Fix:** wrap in `<bdi dir="auto">`.
- **Line 305 — `${a.value.toFixed(0)}` etc. in the tooltip prop string** — bare interpolated strings going through a `title=` attribute. Browsers render `title` per `dir` of the trigger, which under RTL inheritance flips the embedded English/Latin. **Fix:** these are unhintable plain strings; consider rendering as a custom tooltip via `MetricHelp` or `Tooltip` primitive so the bidi context is controlled, or build the string with embedded Unicode bidi marks (LRM `‎` after each Latin run).

### CampaignsTable (`src/components/CampaignsTable.tsx`)

- **Line 1188, 1306, 1523 — `dir="ltr"`** on the segmented control rails (campaign/ad-set mode, platform filter) and the CPM chart container. These are appropriate — the segmented controls render English values (`Meta`, `Google`, `TikTok`) and the chart needs `orientation="right"` to land on the visual right. **Correct.**
- **Line 1369 — `mr-auto`** — should be `me-auto`. Physical.
- **Line 1703 — `<span className="font-semibold ml-1">ניתוח:</span>`** — should be `me-1`. Physical.
- **Lines 2265, 2278, 2296 — `ml-1` next to "CAD" currency-prefix `<span>`** — should be `me-1`. Physical.
- **Line 2402 — `text-start` on a tooltip:** correct.
- **Line 2454 — `align === 'start' ? 'text-start' : align === 'end' ? 'text-end' : 'text-center'`** in the `AdSortHeader` helper — correct logical alignment.

### CampaignsTableRow (`src/components/CampaignsTableRow.tsx`)

- **Lines 291, 375, 377, 378 — `<bdi dir="ltr">` wraps for `campaignName`, `adSetName`, `platform`, `storeName`** — correct. This is the model pattern other table-row components should copy.

### DetailTable (`src/components/DetailTable.tsx`)

- **Lines 73–86 — table headers use `text-start` / `text-end`** — correct logical alignment.
- **Lines 95, 106–140 — body cells use `text-end tabular-nums`** — correct. Numbers stay column-aligned and direction-aware.
- **Line 95 — `<td className="px-3 py-2 font-medium">{r.storeName}</td>`** — store name rendered without `<bdi>` wrap. Today this works because store names happen to be pure Latin (`uzoshop`, `Zol Plus`, `360usmile`), but if a future store name carried Hebrew (e.g. "אוזושופ"), mixing with `formatDate(r.date)` (Latin "31/05/2026") in the next cell could cause table-cell reflow surprises in row striping. **Fix:** wrap in `<bdi dir="auto">{r.storeName}</bdi>` defensively.

### MonthlyTables (`src/components/MonthlyTables.tsx`)

- **Lines 389–394 — headers use `text-start` / `text-end`** — correct.
- **Line 230 — `dir="ltr"` on month-toggle segmented control:** correct.
- **Line 252 — `ml-auto`** — should be `me-auto`. Physical.

### AdSetTable (`src/components/AdSetTable.tsx`)

- **Lines 184–237 — `text-end tabular-nums` throughout** — correct.
- **Line 272 — `align` helper** matches `AdSortHeader` pattern.

### ProductsTable (`src/components/ProductsTable.tsx`)

- **Line 398 — `dir="ltr"` on period selector** — correct.
- **Line 505 — `mr-auto`** — should be `me-auto`. Physical.
- **Line 690 — `<span className="truncate">{p.productTitle}</span>`** — Shopify product titles routinely mix Hebrew + English + size codes (e.g. "מארז 4 יחידות Whitening Strips 28pcs"). Unwrapped this risks bidi reorder of the number+pcs run against the Hebrew. **Fix:** `<bdi dir="auto">{p.productTitle}</bdi>`.
- **Lines 169–173 — string interpolation** `\`${r.productTitle}  ·  ${r.storeName}\`` builds a single string with a Latin middle-dot. When passed downstream as `display` it loses any direction-marking opportunity. **Fix:** keep the title and store separate and render them as two `<bdi>` runs with a literal `' · '` between them.

### ProductCentricView (`src/components/ProductCentricView.tsx`)

- **Lines 73, 90 — comments + `<bdi dir="ltr">{r.value}</bdi>` for product-title row values** — correct pattern.
- **Lines 504, 517, 533, 550, 579, 595 — `<code dir="ltr">` for embedded formulas / table names** — correct.
- **Line 440 — `expanded ? <ChevronDown size={14} /> : <ChevronLeft size={14} />`** — `ChevronLeft` is physical. In RTL on a row whose content is right-aligned, the "collapsed" affordance should point in the *inline-end* direction (visual left) — so `ChevronLeft` happens to be visually correct in RTL but would render backwards in LTR. The codebase is RTL-first so this is acceptable today but fragile. **Fix:** replace with a direction-aware helper or use `ChevronDown` rotated by transform: `<ChevronDown className="rtl:-rotate-90 ltr:rotate-270" />`. Cleaner: keep a single icon and rotate it (animated) on toggle.

### CampaignsTopList (`src/components/CampaignsTopList.tsx`)

- **Line 54 — `<span className="font-medium">{platform}</span>`** — English platform name unwrapped. Standalone in its own `<span>` so today it renders fine, but defensive `<bdi dir="ltr">{platform}</bdi>` recommended for futureproofing.
- **Line 104 — `<div … title={campaign.name}>{campaign.name}</div>`** — campaign name from Meta/Google/TikTok rendered without `<bdi>`. Same defect class as `AdsDrawer:336`. **Fix:** `<bdi dir="auto">{campaign.name}</bdi>`.
- **Lines 81, 83, 84, 86, 88, 89 — `→` Unicode arrow in verdict text**: `'→ הגדל תקציב משמעותית'`. In an RTL document the **physical** `→` (U+2192 RIGHTWARDS ARROW) visually points *opposite the reading direction* — Hebrew flows right-to-left, so a "next-step" affordance should point ← (U+2190 LEFTWARDS ARROW). This is a real visual bug. **Fix:** swap to `←` for all RTL contexts, or use a *neutral* glyph (`›`, `→` wrapped in `<span dir="ltr">`), or render a Lucide `ArrowLeft` icon.

### KpiCards (`src/components/KpiCards.tsx`)

- **Line 295 — `<span className="text-ink-muted font-normal ml-1">{labelSuffix}</span>`** — physical. **Fix:** `me-1`.

### PnLBreakdown (`src/components/PnLBreakdown.tsx`)

- **Lines 309, 423 — `ml-1`, `ml-1.5`** next to "CAD" currency-prefix. Should be `me-1`, `me-1.5`. Physical.
- **Line 319 — `<ChevronUp size={11} className="transition-transform group-open:rotate-180" />`** — uses rotation-on-toggle, direction-agnostic. **Correct pattern.**

### BillingSettings (`src/components/BillingSettings.tsx`)

- **20 physical-direction violations** in this file alone (more than any other). Examples:
  - Lines 246, 589, 999 — `ml-1` / `ml-1.5` adjacent to "CAD" prefix (currency atom). **Fix:** `me-1`.
  - Line 479 — `ml-auto`. **Fix:** `me-auto`.
  - Line 193 — `dir="rtl"` on a textarea; line 422 — `dir="ltr"` on a CSV-paste textarea. Both intentional. Correct.
- **Operator-entered description text in line items** is rendered raw inside `<div>`s without `<bdi dir="auto">`. Hebrew billing notes mixed with English supplier names (`"Octopus Deploy חודשי"`) will reorder unpredictably. **Fix:** wrap user-text rendering sites in `<bdi dir="auto">`.

### AnnotationsPanel (`src/components/AnnotationsPanel.tsx`)

- **Line 178 — `{a.title}`** rendered raw. Operator types annotation titles in *whatever direction they want* — Hebrew, English, or mixed. **Fix:** `<bdi dir="auto">{a.title}</bdi>`.
- **Line 191 — `{a.notes}` (multi-line free-text)** — same defect. Use a `<bdi dir="auto">` wrapper inside the existing `<div>`.
- **Line 185 — `{a.store}` chip** — same defect; wrap.
- The export path that feeds these annotations into `RoasChart` (`src/components/RoasChart.tsx:444`) doesn't render the title text into the chart itself, so the chart isn't directly affected — but tooltip / panel display is.

### Operator panels — `JobsTable`, `CronTickSnapshotsViewer`, `ManualOverridesCrud`, `OperatorSecretBanner`, `TokenFailuresTable`, `StatusEventsFeed`, `FreshnessPanel`

These are inside `<html dir="rtl">` like the rest of the dashboard and use `text-right` / `text-left` literally:

- **`JobsTable.tsx:191–195`** — five consecutive `<th text-right>` for Hebrew column headers (`פונקציה`, `סטטוס`, `התחלה`, `משך`, `פרטים`). In RTL, `text-right` aligns text to the *visual right* — which happens to be the *start* edge for Hebrew. So in this RTL-only operator console it visually works, but only by coincidence; it would break on first migration to LTR. **Fix:** convert to `text-start`.
- **`ManualOverridesCrud.tsx:311–317`** — same pattern, 7 occurrences of `text-right`. **Fix:** `text-start`.
- **`CronTickSnapshotsViewer.tsx:34–50`** — *mixed bag*. Line 34 `text-right` for `tick_id` (Latin number column; the developer wants right-aligned numbers — but in RTL `text-right` aligns to the visual right, which is actually the *start* edge, so numbers end up flush with the wrong edge). Lines 35–39 `text-left` for the English fan_out/completed/skipped/failed/duration columns — same misuse. The intent is clearly "numeric columns right-aligned" → should be `text-end`. **Fix:** every `text-right` → `text-end`; every `text-left` → `text-start`.
- **`CronTickSnapshotsViewer.tsx:34, 39, 45, 50`** — `pr-2`, `pl-2` (physical padding). **Fix:** `pe-2`, `ps-2`.
- **`OperatorSecretBanner.tsx:80, 132`** — `pr-8`, `pr-7` on an input that has `dir="ltr"` explicitly. Because the input is LTR, `pr-*` resolves to *visual* right — which is correct (eye icon sits at the visual-right edge). But the wrapping `<div className="absolute … right-2">` at lines 88, 140 floats the icon by physical right. In a `dir="rtl"` ancestor, if the input were ever to lose its `dir="ltr"` override, this would silently flip. **Fix:** convert to `pe-8`, `end-2` so the input-direction toggle isn't load-bearing.
- **`FreshnessPanel.tsx:145`** — `ml-1`. **Fix:** `me-1`.

### Recharts charts

- **`CampaignsTable.tsx:1523`** — `<ChartContainer dir="ltr">` ✅ correct (uses `orientation="right"` for YAxis at line 1554).
- **`CampaignDrawer.tsx:1118`** — `<ChartContainer dir="ltr">` ✅ correct (uses `orientation="right"` at line 1150).
- **`RoasChart.tsx:84`, `HeroOverview.tsx:500`, `QuadrantScatter.tsx:182`, `MetaShopifyReconciliation.tsx:636`, `CampaignDrawer.tsx:893`** — `<ChartContainer>` *without* `dir="ltr"`. Recharts emits SVG with absolute pixel offsets, which the SVG renderer treats as direction-neutral, but **margin/padding props** (`margin={{ left: 8, right: 12 }}`), tick text alignment, and the implicit `orientation="bottom"` of the X axis don't get mirrored — so on these charts a *visual* left margin really is on the visual left. This is *probably* the desired behavior for a line-chart whose X axis is dates (chronological flow can read left→right even in Hebrew), but it isn't consistent. **Recommendation:** standardise — either wrap *every* `<ChartContainer>` in `dir="ltr"` (most predictable for Recharts) or none. Today's mixed posture means the date-axis tooltips line up against different inline edges depending on which chart you're hovering.
- **`ChartTooltip.tsx:28`** — `dir="rtl"` on tooltip card; correct.
- **`ChartTooltip.tsx:88` — `<bdi dir="ltr">` on the numeric value:** correct.
- **`ChartTooltip.tsx:74` — `<span className="ms-auto">{children}</span>`** — correct logical margin push.

### Sheet / Drawer primitive (`src/components/ui/Sheet.tsx`)

- **Lines 14–15 — `side="start"` → `top-0 start-0 h-full w-3/4 max-w-md border-e`** and `side="end"` → `top-0 end-0 … border-s`. ✅ correct logical placement.
- **Line 10 — `animate-in slide-in-from-end`** — `tailwindcss-animate` slide direction. Verify that `slide-in-from-end` actually mirrors under RTL — the plugin's docs use physical directions internally, so the slide animation may always come from the same *physical* side. If so, the drawer in RTL slides in from the *visual left* even though it docks at the *visual right*. **Action item:** verify behavior in browser; if broken, add an explicit `[dir=rtl]:slide-in-from-start` variant or use Framer Motion.
- **Line 48 — `<SheetClose className="absolute end-3 top-3 …">`** — correct logical position.

---

## Mixed-text rendering issues by pattern

### Number + Hebrew label

**Risk:** weak-LTR number + Hebrew word may visually swap.
- **Handled correctly:** all `lib/format.ts` helpers (`fmtMoney`, `fmtPct`, `fmtDeltaPct`, etc.) wrap the numeric atom in `<bdi dir="ltr">` and use the typographic minus `−` (U+2212). This is the systematic right answer.
- **Unhandled at call sites that bypass `format.ts`:** `KpiCards:295` ("מהמחזור"-suffix), `Filters:132` ("ימים" after a number — but the number is inside `tabular-nums` `<span>` and the number+label are in distinct `<span>`s so this happens to work), `CommandPalette:274` (`ROAS ${roas.toFixed(2)}` interpolated into a label string), `CampaignsTopList:120` (`CAD ${Math.round(campaign.spend).toLocaleString('he-IL')}`).
- **Fix:** route every numeric render through `format.ts`. The `formatCurrency` / `formatNumber` helpers in `lib/utils.ts` (used by older components) return plain strings — these are the leak source. Migrate them to return `<bdi dir="ltr">{…}</bdi>` ReactElements like `format.ts` already does, or wrap call sites.

### Currency + Hebrew label

**Risk:** `CAD 1,234` adjacent to Hebrew flips into `1,234 CAD` (or worse).
- **Handled:** `fmtMoney` in `format.ts:83-90` already renders `<bdi>{<span>CAD</span>{number}}</bdi>` so CAD + number form one isolated atom.
- **Unhandled at sites that hand-assemble the prefix:** `BillingSettings:589, 999`, `PnLBreakdown:309`, `CampaignsTable:2265, 2278, 2296`, `CampaignsTopList:120` all build `CAD ${number}` either as a separate `<span ml-1>CAD</span>{number}` (which sits OUTSIDE any `<bdi>` so the number may detach), or as a single template-string concatenation.
- **Fix:** call `fmtMoney(n, 'CAD')` instead of building the prefix manually. The 10 sites that hand-build CAD prefixes are all the `ml-1` violations listed in the spacing audit below — they're the same defect.

### English campaign name + Hebrew prefix

**Risk:** "מותג Summer Sale 2026" — the `2026` may visually leap to the left edge of the Hebrew prefix, producing "2026 מותג Summer Sale".
- **Handled at:** `CampaignDrawer:808`, `CampaignsTableRow:291` (both wrap `campaignName` in `<bdi dir="ltr">`). The `bidi.dom.test.tsx` regression test gates this.
- **Unhandled at:** `CampaignsTopList:104`, `AdsDrawer:336` (`adSetName`), `AdsDrawer:459` (`adName`), `CommandPalette:684` (`item.label` for campaign rows). All four are surfaced in §Component findings.

### Platform name + Hebrew context

**Risk:** "Meta · קמפיין × 5" — bidi-neutral `·` and `×` reorder.
- **Handled at:** `CampaignsTableRow:375` (`<bdi>{a.platform}</bdi>`), `CampaignDrawer:840`, `CampaignDrawer:818` (`{summary.platform}` standalone in a span — works because it's alone, but undefended).
- **Unhandled:** `CampaignsTopList:54`, `CampaignsTopList:106`, `CommandPalette:274` (subtitle interpolation), `CampaignDrawerStatusSection:59, 70, 76` (English column labels: `configured`, `effective`, `delivery`).

### Percentage / ROAS / CPM + Hebrew context

**Risk:** percent sign jumps to wrong side; `+`/`−` reorder.
- **Handled:** `fmtPct`, `fmtDeltaPct`, `fmtNum2` in `format.ts` all use the typographic minus `−` and wrap in `<bdi>`.
- **Unhandled:** `CampaignsTable:1603` (`${prevDeltaPct > 0 ? '+' : ''}{prevDeltaPct.toFixed(1)}%`) — manual formatting outside `format.ts`, and the `%` is appended as a literal sibling outside any isolation wrapper. Hover the CPM-vs-previous tooltip and you may see "%5.3−" instead of "−5.3%". Same at line 1142.

### URL / UTM / ID + Hebrew context

**Risk:** URLs and IDs are weak-LTR Latin runs that mix badly with Hebrew tooltip text.
- **Handled correctly:** `MetricHelp.tsx:128` wraps formula code in `<code dir="ltr">`. `ProductCentricView.tsx:504–595` wraps all embedded code/IDs in `<code dir="ltr">`. **This is the model pattern.**
- **Unhandled:** `OperatorSecretBanner.tsx:117` ("Operator secret מוגדר ב-localStorage."), `CampaignDrawerStatusSection.tsx:88–92` (Hebrew explainer text including "platform" English word), `BillingSettings` line-item descriptions. These embed English nouns in Hebrew sentences; the words are bare and may reorder against trailing punctuation. **Fix:** wrap each English noun in `<bdi dir="ltr">`.

---

## Logical-direction spacing audit

Strict count of *true* physical-direction Tailwind classes (excluding substrings of unrelated classes like `border-line-subtle`):

| Class family | Total occurrences | Logical equivalent |
|---|---|---|
| `ml-[0-9]` / `ml-auto` | 13 | `ms-*` |
| `mr-[0-9]` / `mr-auto` | 4 | `me-*` |
| `pl-[0-9]` | 2 | `ps-*` |
| `pr-[0-9]` | 4 | `pe-*` |
| `left-[0-9]` | 0 | `start-*` |
| `right-[0-9]` | 4 | `end-*` |
| `text-left` | 6 | `text-start` |
| `text-right` | 14 | `text-end` |
| `border-l` / `border-r` | 0 | `border-s` / `border-e` |
| `rounded-l-*` / `rounded-r-*` | 0 | `rounded-s-*` / `rounded-e-*` |
| **Total** | **~47** | |

Compared to **adopted logical** classes:

| Class | Occurrences |
|---|---|
| `ms-*` | 13 |
| `me-*` | 10 |
| `ps-*` | 15 |
| `pe-*` | 9 |
| `start-*` | 11 |
| `end-*` | 23 |
| `border-s` | 10 |
| `border-e` | 6 |
| `text-start` | 35 |
| `text-end` | 137 |

**Logical-to-physical ratio is ~269:47 (~85% logical).** Good baseline but the ~15% physical is concentrated in 5 files (8 files have ≥4 violations each).

### Top 10 worst-offender files

| Rank | File | Physical occurrences |
|---|---|---|
| 1 | `src/components/BillingSettings.tsx` | 20 |
| 2 | `src/components/CampaignsTable.tsx` | 13 |
| 3 | `src/components/operator/CronTickSnapshotsViewer.tsx` | 10 |
| 4 | `src/components/operator/ManualOverridesCrud.tsx` | 7 |
| 5 | `src/components/CampaignDrawer.tsx` | 7 |
| 6 | `src/components/ProductsTable.tsx` | 6 |
| 7 | `src/components/BillingCsvImport.tsx` | 6 |
| 8 | `src/components/Filters.tsx` | 6 (false positives — `border-line` substring; actual violations: 0) |
| 9 | `src/components/operator/JobsTable.tsx` | 5 |
| 10 | `src/components/PnLBreakdown.tsx` | 4 |

Other notable: `src/components/operator/OperatorSecretBanner.tsx` (4), `src/components/GoalTracker.tsx` (4 false-positive substrings; actual: 0), `src/components/CohortComparisonPanel.tsx` (4 false-positive substrings; actual: 0).

**Recommended cleanup:** a single mechanical migration PR. Each physical class has a 1:1 logical replacement, and `git grep -E '\b(ml|mr|pl|pr|left|right)-(0|0\.5|px|[0-9]+(\.[0-9]+)?)\b' src/` plus `\btext-(left|right)\b` produces an exact, bounded change set.

---

## Icon directionality

The codebase uses `lucide-react` icons. Vertical chevrons (`ChevronUp` / `ChevronDown`) are direction-agnostic and dominate (~30 sites). **Two real physical-direction icon usages:**

| File:Line | Icon | Context | Bug |
|---|---|---|---|
| `src/components/Sidebar.tsx:170` | `ChevronsLeft` / `ChevronsRight` (toggle) | Desktop sidebar collapse button | In RTL the sidebar is on the visual right. The icon should suggest "collapse → shrink toward start (right)" when expanded, "expand → grow toward end (left)" when collapsed. Today's `ChevronsRight` (expanded) suggests "send further right" — incoherent. |
| `src/components/ProductCentricView.tsx:440` | `ChevronLeft` (collapsed state) | Product accordion | Coincidentally correct in RTL (visual left = inline-end), but breaks if site ever serves LTR. |

**Additionally, the Unicode arrow `→` (U+2192) in `CampaignsTopList.tsx:81, 83, 84, 86, 88, 89`** is a physical arrow rendered inside Hebrew "next-step" verdict text. In RTL it visually points *opposite* the reading direction. **Fix:** use `←` (U+2190) or render a Lucide `ArrowLeft` icon.

**Recommended pattern for direction-aware icons:**

```tsx
// Single icon, rotated under RTL via Tailwind logical variant
<ChevronLeft className="rtl:rotate-180" />
```

or a tiny helper:

```tsx
function DirChevron({ end }: { end: boolean }) {
  // end=true → points toward inline-end edge (visually left in RTL, right in LTR)
  return end ? <ChevronLeft className="rtl:rotate-180" /> : <ChevronRight className="rtl:rotate-180" />;
}
```

---

## Charts (Recharts) RTL

**What works:**
- `ChartTooltip.tsx` is `dir="rtl"` with the value wrapped in `<bdi dir="ltr">`. Tooltip layout is correct in every chart.
- `CampaignsTable.tsx:1523` and `CampaignDrawer.tsx:1118` explicitly set `dir="ltr"` on the `ChartContainer` so `YAxis orientation="right"` resolves to the visual right edge.
- X-axis date tick formatting (`DD/MM`) is brief enough that bidi reorder doesn't produce a visually-broken label.

**What's broken or inconsistent:**
- **5 of 7 `ChartContainer` usages do NOT set `dir="ltr"`** (`RoasChart`, `HeroOverview` main + secondary, `QuadrantScatter`, `MetaShopifyReconciliation`, `CampaignDrawer` ROAS-trend chart). This means margin props like `margin={{ left: 8, right: 12 }}` resolve against the inherited `dir="rtl"`. Recharts internally uses absolute pixel coordinates so the SVG itself doesn't mirror, but anything that *positions* relative to "left" or "right" of the chart box (legends with `align="right"`, custom labels passed `x` offsets, tooltip cursor positioning) may behave differently from the two charts that do set `dir="ltr"`. Today this is mostly latent — only verifiable by hovering each chart in RTL — but it's a footgun.
- **`tooltip-wrapper` global CSS** (`globals.css:278–288`) doesn't set `direction:` — Recharts' default tooltip layout (which the dashboard mostly bypasses in favor of `ChartTooltip`) would render LTR by default; if any chart ever falls back to the default tooltip it will look wrong in RTL.
- **Axis tick rotation:** none of the charts use rotated ticks today (line ~88 of `RoasChart` shows tickMargin without rotation), so the LTR-only rotation API of Recharts isn't exercised. But if labels ever get long enough to need rotation, the default rotation pivot is on the *physical right* of the tick label — under RTL that may visually clip into the next tick.

**Recommended workaround:** standardise. Add `dir="ltr"` to *every* `<ChartContainer>` (the Recharts community standard for RTL apps) and rely on the embedded `<ChartTooltip dir="rtl">` to keep the *tooltip* RTL while the SVG plotting frame stays LTR. Make the ChartContainer wrapper enforce it: `<div dir={props.dir ?? 'ltr'}>…</div>`.

---

## Systematic recommendations

1. **Add `tailwindcss-logical` or enable ESLint rule `eslint-plugin-tailwindcss` with a no-physical-direction rule.** The codebase already has an ESLint rule against raw `<button>` and `dark:` — add a sibling rule that bans `\b(ml|mr|pl|pr|left|right|text-left|text-right|border-l|border-r|rounded-l-|rounded-r-)\b` in className strings. This is the single highest-leverage fix because it prevents regression on the ~47 remaining physical violations.

2. **Build a `<BiDi>` primitive.** A 5-line component:

   ```tsx
   export function BiDi({ children, dir = 'auto', as: As = 'bdi', ...rest }) {
     return <As dir={dir} {...rest}>{children}</As>;
   }
   ```
   And a `<LTR>` / `<RTL>` shorthand. Replace every `<bdi dir="ltr">` in the codebase with `<LTR>` for readability, and use `<BiDi>` (which defaults to `dir="auto"`) for *operator-entered* free text (annotations, billing descriptions, search input echoes).

3. **Migrate `lib/utils.ts:formatCurrency` and `formatNumber` to return `ReactElement` like `lib/format.ts` already does.** The bifurcation today (`format.ts` returns elements, `utils.ts` returns strings) is the root cause of every "I built `CAD ${number}` by hand" violation. After migration, every call site automatically benefits from `<bdi>` wrapping.

4. **Default to `dir="auto"` for all `<input>` / `<textarea>` that accept free text.** Today annotations title/notes, billing notes, and the search input in `CommandPalette` all take `type="text"` without `dir="auto"`. This lets the operator type Hebrew or English without the cursor jumping. Today the cursor jumps to the wrong end when typing the first English letter into a Hebrew input.

5. **Enable a `bidi.dom.test.tsx`-style CI gate per component family.** The existing test gates `CampaignDrawer` + `PerStoreCards`. Extend it to `AdsDrawer`, `CampaignsTopList`, `CommandPalette`, `AnnotationsPanel`, `ProductsTable`. The pattern is cheap: render with mixed Hebrew/English string and `expect(container.querySelector('bdi[dir="ltr"]')).not.toBeNull()`.

6. **Standardise Recharts containers on `dir="ltr"`.** Make `ChartContainer.tsx` apply `dir="ltr"` by default and require an opt-out for the rare RTL chart.

7. **Replace Unicode physical arrows (`→`, `←`) in source strings with logical-aware glyphs or Lucide icons.** A single grep for `→|←|⇒|⇐|⮕|⬅` would surface all of them; today only `CampaignsTopList.tsx` is affected but it's worth a sweep.

8. **Adopt LRM (`‎`) bidi marks for inline interpolations the developer cannot wrap in JSX** (e.g. tooltip `title` attributes that take a plain string). A typical pattern: `title={\`Meta דיווח: CAD ${a.value.toFixed(0)}‎\`}` — the LRM after the Latin run anchors the bidi level so the following Hebrew word doesn't pull the number across.

---

## Prioritized recommendations

### P0 — Visible Hebrew bugs (operator will see these today)

| # | Issue | Files | Impact |
|---|---|---|---|
| P0-1 | Physical `→` arrows in winner/loser verdict text point opposite the reading direction. | `CampaignsTopList.tsx:81, 83, 84, 86, 88, 89` | Operator's eye is pulled in the wrong direction on the Home tab's most-consulted recommendation list. |
| P0-2 | `text-right` / `text-left` in operator tables align text to the wrong edge in mixed Hebrew/Latin cells. | `JobsTable.tsx:191–195`, `ManualOverridesCrud.tsx:311–317`, `CronTickSnapshotsViewer.tsx:34–50`, `TodayLive.tsx:436` | Operator-console columns visually misalign — easy to misread duration vs ID. |
| P0-3 | `CommandPalette` campaign+product `label`/`subtitle` interpolation strips bidi isolation. | `CommandPalette.tsx:273–274, 322` | English campaign names with year suffixes (`"Summer Sale 2026"`) reorder when fzf-filtered alongside Hebrew query. |
| P0-4 | `AdsDrawer` ad/ad-set names render without `<bdi>` wrapping. | `AdsDrawer.tsx:336, 459` | Ad-set table in drawer shows visually scrambled mixed-text names. |
| P0-5 | `CampaignsTopList` campaign name + platform chip unwrapped. | `CampaignsTopList.tsx:54, 104` | Same defect as the drawer; affects the most-scanned widget on the dashboard. |
| P0-6 | Manual `CAD ${number}` string assembly bypasses `<bdi>`, currency code can detach from number under bidi reorder. | `BillingSettings.tsx:589, 999`; `PnLBreakdown.tsx:309`; `CampaignsTable.tsx:2265, 2278, 2296`; `CampaignsTopList.tsx:120` | Billing + P&L panels can show "CAD" floating on the wrong side of negative numbers. |

### P1 — Latent risks (works today, breaks on first edit / first locale change / first non-Latin store name)

| # | Issue | Files |
|---|---|---|
| P1-1 | 47 physical-direction Tailwind classes (`ml-`, `mr-`, `pl-`, `pr-`, `right-`, `text-left`, `text-right`) remain in the working tree, concentrated in `BillingSettings` (20), `CampaignsTable` (13), `CronTickSnapshotsViewer` (10). | top-10 list above |
| P1-2 | `AnnotationsPanel` renders operator-entered title/notes/store without `<bdi dir="auto">`. Today annotations are mostly Hebrew so it works; the moment an operator types "Black Friday 2026 הנחה" the title visually scrambles. | `AnnotationsPanel.tsx:178, 185, 191` |
| P1-3 | `ProductsTable.tsx:690` renders Shopify product titles without `<bdi>` wrap. | `ProductsTable.tsx:690` |
| P1-4 | `Sidebar` desktop-collapse chevron uses physical `ChevronsLeft`/`ChevronsRight` icons. | `Sidebar.tsx:170` |
| P1-5 | 5 of 7 `<ChartContainer>` usages do not set `dir="ltr"`, producing inconsistent Recharts margin/orientation behavior across charts. | `RoasChart`, `HeroOverview`, `QuadrantScatter`, `MetaShopifyReconciliation`, `CampaignDrawer` ROAS-trend |
| P1-6 | `tailwindcss-animate` `slide-in-from-end` keyframe is direction-physical; verify Sheet drawer animation actually mirrors in RTL. | `ui/Sheet.tsx:10` |
| P1-7 | Manual percent formatting bypasses `format.ts`: `${pct > 0 ? '+' : ''}${pct.toFixed(1)}%`. | `CampaignsTable.tsx:1603, 1142` |
| P1-8 | `<input>` / `<textarea>` for free-text annotation, billing, and command palette searches lack `dir="auto"` — cursor jumps when first Hebrew or English letter is typed. | `AnnotationsPanel` form, `BillingSettings` form, `CommandPalette` input |

### P2 — Polish (long-tail consistency)

| # | Issue | Files |
|---|---|---|
| P2-1 | `CampaignDrawerStatusSection` English status-enum and column-label `<span>`s rendered unwrapped (works today because each is alone in its cell). | `CampaignDrawerStatusSection.tsx:59–82` |
| P2-2 | `DetailTable` store-name column rendered unwrapped (works today because store names happen to be pure Latin). | `DetailTable.tsx:95` |
| P2-3 | `ProductCentricView.tsx:440` uses physical `ChevronLeft`; coincidentally correct in RTL, but fragile. | `ProductCentricView.tsx:440` |
| P2-4 | `HeroOverview.tsx:288` decorative gradient blob uses `right-0` `translate-x-1/3` — physical; under RTL the blob sits on the visual right (correct for RTL today) but won't mirror if site ever serves LTR. | `HeroOverview.tsx:288` |
| P2-5 | Bifurcation of `lib/format.ts` (returns `ReactElement`) vs `lib/utils.ts` (`formatCurrency`/`formatNumber` return `string`) — the latter is the root cause of every hand-built `CAD ${n}` site. | `lib/utils.ts` |
| P2-6 | No `eslint-plugin-tailwindcss` rule enforcing logical-direction classes. The codebase already has 3 custom rules (raw `<button>`, `dark:`, hex literals) — add a fourth. | `eslint.config.*` |

---

## Closing observation

The dashboard is **substantially better at RTL than most React+Tailwind apps I've seen**. The patterns are right: `lib/format.ts` is exemplary, `<bdi dir="ltr">` is used systematically in the highest-traffic surfaces (`CampaignsTableRow`, `CampaignDrawer`, `PerStoreCards`, `ChartTooltip`), and there's a regression test (`bidi.dom.test.tsx`) gating it. The work remaining is mostly mechanical: a one-shot migration of ~47 physical classes to logical, ~15 unwrapped Latin-text sites to `<bdi>`, ~7 hand-built `CAD ${n}` strings to `fmtMoney`, and 1 set of `→` arrows. Add the corresponding ESLint rule and a few more `bidi.dom.test.tsx` cases, and RTL becomes truly first-class.
