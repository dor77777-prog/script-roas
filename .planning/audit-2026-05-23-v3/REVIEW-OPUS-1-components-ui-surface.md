# v3 Code Review — OPUS-1: Components UI Surface
Date: 2026-05-23 · Reviewer: Opus 4.7 · Scope: 38 files

## Summary
| Severity | Count |
|---|---|
| CRITICAL | 0 |
| HIGH | 3 |
| MEDIUM | 9 |
| LOW | 11 |
| INFO | 5 |

This is a 3rd-pass review. v1 and v2 already shipped 56 commits removing the
visible-on-load defects. What remains are subtle correctness traps that fire
under specific operator conditions: midnight rollover, custom date entry,
SWR not-yet-resolved windows, focus-trap edge cases, and the few RTL/TZ
sites that were missed in the previous waves. No CRITICAL findings, but
three HIGH issues quietly degrade behaviour after the operator does
something unusual (e.g., open the dashboard at 23:55 IL, paste a malformed
date into the global filter, search inside the picker).

---

## HIGH findings

### H-1: TodayLive freezes "today" at first render — silently shows stale day after midnight IL
- **File:** `components/TodayLive.tsx:188-227`
- **What:** `today` is computed once on mount (line 188 — `const today = todayInIsrael();`) and pinned into the SWR URL (line 197 — `` `/api/data?from=${today}&to=${today}` ``). After midnight Asia/Jerusalem the URL still references yesterday; the widget keeps showing yesterday's totals while the clock label keeps ticking via the 30 s `setNow` interval, so the operator sees a fresh-looking timestamp on a stale dataset.
- **Why it matters:** TodayLive is the FIRST section on the home tab per the comment at `Dashboard.tsx:332-340` — the at-a-glance read of "what's happening RIGHT NOW". After 00:00 IL on any day the operator left a tab open overnight, the panel reports yesterday's revenue as "היום" with no visual indication anything is wrong.
- **Evidence:**
  ```ts
  // components/TodayLive.tsx
  const today = todayInIsrael();             // line 188 — captured ONCE on mount

  const { data: liveDataResp } = useSWR<DashboardData>(
    `/api/data?from=${today}&to=${today}`,   // line 197 — SWR key never advances
    dataFetcher,
    { refreshInterval: 60_000, revalidateOnFocus: true },
  );
  // …
  const todayRows = useMemo(() => {
    const rs = liveDataResp?.rows ?? [];
    return rs.filter(r => r.date === today); // line 203 — also pinned to old day
  }, [liveDataResp, today]);
  ```
  Compare to the `now` ticker at line 184: `const t = setInterval(() => setNow(nowInIsrael()), 30_000);` — that DOES advance, so the header reads "עודכן 00:23" on a `liveDataResp` that's still keyed to yesterday.
- **Recommended fix:** Roll `today` into the same interval (`setInterval(() => { setNow(nowInIsrael()); setToday(todayInIsrael()); }, 30_000)`) so when IL midnight passes the SWR key rolls over and the next fetch hits the new day. Alternatively gate the interval on a date-change check so the SWR key swaps once per midnight rather than every 30 s.

### H-2: `ProductPickerModal` search icon is positioned LTR — breaks visually in RTL dashboard
- **File:** `components/ProductPickerModal.tsx:279-289`
- **What:** The icon is anchored with `right-2.5` (a Tailwind LTR utility, NOT `end-2.5`), while the input reserves padding via `pe-9` (logical RTL-aware end-padding). In an RTL document `right-2.5` puts the icon on the visual right (which IS the START in RTL), and `pe-9` reserves padding on the LEFT (the END in RTL). Result: icon overlaps the text the user is typing, and the reserved padding sits on the empty side.
- **Why it matters:** The picker is opened from CampaignDrawer for the most common operator task (mapping a campaign to a product). Search is the primary affordance once the list crosses ~10 items. With the icon on top of the cursor, the operator can't see what they're typing — they'll either delete the icon area or assume something is broken.
- **Evidence:**
  ```tsx
  // components/ProductPickerModal.tsx:279-289
  <div className="relative">
    <Search size={14} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-text-muted pointer-events-none" />
    <input
      type="text"
      value={query}
      onChange={e => setQuery(e.target.value)}
      placeholder="חפש מוצר…"
      className="w-full rounded-lg border border-border bg-surface ps-3 pe-9 py-2 text-sm focus:outline-none focus:border-primary focus:shadow-focus"
      autoFocus
    />
  </div>
  ```
  The parent `<div dir="rtl">` (line 231) puts the document in RTL mode, so `pe-9` reserves padding on the LEFT and `right-2.5` puts the icon on the RIGHT.
- **Recommended fix:** Replace `right-2.5` with `end-2.5` (Tailwind logical-property utility) so the icon flips with the text direction. Verify by typing a Hebrew product name and confirming the cursor doesn't pass under the icon.

### H-3: `Filters` custom-range inputs have no validation or swap — empty/inverted/future dates corrupt every SWR key downstream
- **File:** `components/Filters.tsx:148-165`
- **What:** Both date inputs commit `e.target.value` directly into `filters.range`. No `max={today}`, no swap-on-invert, no empty-string guard, no `from <= to` check. CampaignsTable (line 1083-1130) and ProductsTable (line 404-464) have all four guards in their LOCAL toolbar pickers; the GLOBAL filter has none. An empty string or inverted range then cascades through every SWR key (`buildDateRangeKey('/api/data', filters.range)` etc).
- **Why it matters:** Filters is rendered on every tab (Home, P&L, Analysis, Campaigns, Products, Detail per `Dashboard.tsx:343-577`). A single bad keystroke ("3" instead of "31" in the day position triggers a re-render with `from=2026-05-3`) ripples into 6+ SWR fetches with malformed URLs. The server-side parser may default to a 90-day window, may 400, may silently filter to nothing — behaviour depends on the route and the operator gets no visual feedback that anything went wrong.
- **Evidence:**
  ```tsx
  // components/Filters.tsx:148-165
  <input
    type="date"
    value={filters.range.from}
    onChange={e =>
      onChange({ ...filters, range: { ...filters.range, from: e.target.value } })
    }
    className="rounded-lg border border-border bg-surface px-3 py-2 text-sm w-full focus:outline-none focus:border-primary focus:shadow-focus transition-colors"
  />
  ```
  Compare with `CampaignsTable.tsx:1083-1130`'s analogous picker:
  ```tsx
  onChange={e => {
    const v = e.target.value;
    if (!v) return;
    const safe = v > today ? today : v;
    setLocalRange(prev =>
      safe > prev.to ? { from: safe, to: safe } : { ...prev, from: safe },
    );
  }}
  ```
- **Recommended fix:** Lift the CampaignsTable validation block into a shared helper (`clampRangeFrom`, `clampRangeTo`) and call it from both sites. Add `max={today}` to the inputs as a first-line defence so the native picker won't surface future dates.

---

## MEDIUM findings

### M-1: `ProductsTable` net-revenue cell paints GREEN when net < gross — counter-intuitive
- **File:** `components/ProductsTable.tsx:677-687`
- **What:** `p.netRevenue < p.revenue ? 'text-roas-green' : 'text-text-primary'` paints the NET cell green precisely when the haircut is non-trivial (refunds/discounts dragged net below gross). The colour language elsewhere is "green = good"; here it lights up on a SHRINKING margin.
- **Why it matters:** Operator scans for green = profitable products; this colours the rows with the biggest refund/discount haircut as if they were the winners. The dedicated "מרג'ין" column below (line 693-721) gets the colour scale right; the net column undermines that signal.
- **Recommended fix:** Drop the conditional green tone on this cell (keep it neutral `text-text-primary`), OR flip the predicate to colour HIGH margin (net very close to gross) green and let the existing מרג'ין column do the work.

### M-2: `BillingSettings` one-time cost date defaults to UTC, not IL
- **File:** `components/BillingSettings.tsx:765-770`
- **What:** `date: new Date().toISOString().slice(0, 10)` returns the UTC calendar day. For an IL operator at 22:00–00:00 (the late-day window the dashboard is most likely to be checked), the form pre-fills TOMORROW's date.
- **Why it matters:** Every other date-default in the audited surface was migrated to `Asia/Jerusalem` via `todayInIsrael()` (`BackfillPicker.tsx:73`, `ManualOverridesCrud.tsx:96`, `CampaignsTable.tsx:116`, `TodayLive.tsx:144`, `ProductsTable.tsx:88`, `MonthlyTables.tsx:70`, `CommandPalette.tsx:218`). This single site was missed and silently produces wrong-day one-time charges in the P&L.
- **Evidence:**
  ```ts
  // components/BillingSettings.tsx:765-770
  const fresh: OneTimeCost = {
    id: generateId(),
    date: new Date().toISOString().slice(0, 10),  // UTC, not IL
    store: storeNames[0] ?? 'All',
    description: '',
    source: 'one-off',
    amountCAD: 0,
  };
  ```
- **Recommended fix:** Define a local `todayInIsrael()` helper (same body as the others) and use it here. The operator can still pick any date in the form; this is just the default.

### M-3: `AiReportButton` campaigns + products fetches drop the user's date range
- **File:** `components/AiReportButton.tsx:52-78`
- **What:** `/api/products` and `/api/campaigns` are fetched WITHOUT `buildDateRangeKey`, so the server falls back to its default 90-day window. The orders + ads SWR calls 8 lines later DO pass the user's range. The generated report mixes 90-day campaign data with range-scoped orders data — the AI receives inconsistent inputs and the operator never knows.
- **Why it matters:** The report's whole purpose is "tell my LLM what happened in this period". Picking "last year" on the filter and exporting a report quietly delivers the last 90 days of campaigns blended with the last year of orders. The aggregator inside `generateAiReport` has no way to detect this.
- **Evidence:**
  ```tsx
  // components/AiReportButton.tsx:52-78
  const { data: products } = useSWR<ProductsResponse | null>(
    open ? '/api/products' : null,              // ← no range
    fetcher, { revalidateOnFocus: false },
  );
  const { data: campaigns } = useSWR<CampaignsResponse | null>(
    open ? '/api/campaigns' : null,             // ← no range
    fetcher, { revalidateOnFocus: false },
  );
  const { data: orders } = useSWR<OrdersAttributionResponse | null>(
    open ? buildDateRangeKey('/api/orders-attribution', filters.range) : null,  // ← range-keyed
    fetcher, { revalidateOnFocus: false },
  );
  ```
- **Recommended fix:** Switch products + campaigns to `buildDateRangeKey('/api/products', filters.range)` and `buildDateRangeKey('/api/campaigns', filters.range)` to match the other two. SWR will dedupe against the other consumers, so no extra network cost.

### M-4: `CommandPalette` campaigns/products SWR is unscoped — 30-day cutoff acts on a 90-day default window
- **File:** `components/CommandPalette.tsx:99-108, 216-272`
- **What:** Same defect as M-3: both `/api/campaigns` and `/api/products` are fetched without a range parameter (line 99-108), but lines 222-226 hand-compute a 30-day `cutoff` and filter rows against it. When the server's default window is 90 days but the operator's range is "last year", the palette's "top campaigns / products" list is based on the rolling 30-day window relative to TODAY — not the operator's actively-selected range. Result: a campaign that's the #1 driver for the user's current filter doesn't appear in the palette.
- **Why it matters:** The palette is the operator's "jump-to" tool. The mismatch between "what the palette ranks" and "what the dashboard shows" is the single most disorienting failure mode for a Cmd-K menu.
- **Recommended fix:** Either (a) key the fetches on `filters.range` so the palette sees the same rows the rest of the dashboard does, or (b) drop the 30-day filter and rank by full-window activity. Option (a) is faster to implement and matches the dashboard's mental model.

### M-5: `CampaignDrawer` `mappedIds` falls back to empty platform string when `rows[0]` is missing
- **File:** `components/CampaignDrawer.tsx:350-356`
- **What:** `const platformForCampaign = rows[0]?.platform ?? summary?.platform ?? '';` then `productMap[campaignKey(storeId, platformForCampaign, campaignId)] ?? [];`. If `rows` is empty on the first render before `summary` resolves (`summary?.platform` is undefined), `platformForCampaign` becomes the empty string and the productMap lookup uses key `'storeId::::campaignId'`. The real keys have a real platform name, so the lookup returns `[]` and the drawer briefly renders "no products mapped" even when there ARE mapped products. Once `summary` resolves the memo re-runs and the chip flips on.
- **Why it matters:** Brief visual flash where a Meta campaign with 5 mapped products renders "🏷️ לא ממופה" before flickering to the correct state. Also blocks the productChannelBreakdown memo from running on the first render pass.
- **Recommended fix:** Wait for `summary` to resolve before computing `mappedIds`: `if (!summary) return [];` at the top of the memo. The downstream consumers (`productChannelBreakdown` line 602, `reconciliation` line 629) already gate on `summary`, so an empty mapped list during boot is the consistent state.

### M-6: `useState(stores[0] || 'All')` in `MonthlyTables` desyncs from store list changes
- **File:** `components/MonthlyTables.tsx:111`
- **What:** `const [storeFilter, setStoreFilter] = useState<string>(stores[0] || 'All');` — the initial value is captured once. If the parent's `stores` array changes (store renamed, new store added, store removed) and the current `storeFilter` is no longer in the list, every row gets filtered out (line 198: `monthRows.filter(r => r.storeName === storeFilter)` returns `[]`) and the user sees empty monthly tables with no indication why.
- **Why it matters:** The `<select>` element renders a value that no longer matches any `<option>`, which produces a "value not in option list" DOM warning and silently selects whatever the browser picks (usually the first option).
- **Recommended fix:** Add a `useEffect` that resets `storeFilter` to `stores[0] || 'All'` when the current value isn't in `stores`. Mirrors the WR-02 pattern already implemented in `BillingCsvImport.tsx:62-76`.

### M-7: `AdsDrawer` sort comparator has no exhaustiveness check — returns `undefined` if `AdSortKey` widens
- **File:** `components/AdsDrawer.tsx:296-314`
- **What:** The comparator covers all 7 `AdSortKey` cases but lacks a `default` branch with `const _exhaustive: never = sortKey;` guard. If a future key is added to the type without a comparator case, TypeScript catches it at compile time — BUT if the type widens at runtime (stale localStorage, URL-state restore, hot-reload) the switch falls through and the comparator returns `undefined`. `Array.prototype.sort` with an `undefined`-returning comparator produces non-deterministic output.
- **Why it matters:** Both `CampaignsTable.tsx:185-203` and `CampaignDrawer.tsx:670-680` document this exact failure mode and choose `return 0;` (stable order). `AdsDrawer` is the only sortable surface without the guard — inconsistent with the project's own pattern.
- **Recommended fix:** Add the same `default` case the other two have. One line, copy-paste from CampaignDrawer.

### M-8: `productCentricView` `internalStoreId` fallback is incorrect for stores with whitespace/case differences
- **File:** `components/ProductCentricView.tsx:115-119`
- **What:** When `campaignsData` doesn't yet contain a row matching `storeName`, `internalStoreId` falls back to `storeId.toLowerCase()` where the `storeId` prop is actually a `storeName` (e.g. `"Zol Plus"`). Lower-cased, the result is `"zol plus"` — the real internal id is `"zolplus"` (no space). For `"360usmile"` the fallback yields `"360usmile"` which happens to match. Today the failure is silently invisible because `aggregated` is also empty when `campaignsData` is empty (so `buildProductCentricView` returns []) — but if `productsData` resolves first or `aggregated` is non-empty from another store, the function operates on a wrong storeId and silently produces empty results.
- **Why it matters:** The prop is named `storeId` but it's a `storeName`. The fallback only works for stores whose internal id is the lowercase of the display name. Adding a store with a space or punctuation in its name silently breaks this fallback path.
- **Recommended fix:** Rename the prop to `storeName` (parent passes `filters.store` which IS a storeName). Drop the toLowerCase fallback. If `internalStoreId` cannot be resolved from campaignsData, render the "loading" branch instead of falling through with wrong data.

### M-9: `CommandPalette` Cmd+K becomes a no-op when the palette's own input has focus
- **File:** `components/CommandPalette.tsx:122-129`
- **What:** The `isEditable` guard correctly prevents Cmd+K from hijacking text in OTHER inputs (the fix for d/HI-10), but it ALSO prevents Cmd+K from toggling the palette CLOSED when the user is focused on the palette's own search box. Once the palette opens, focus moves into its input (line 147: `setTimeout(() => inputRef.current?.focus(), 30)`), and pressing Cmd+K again does nothing. The user must press Escape or click the X to close.
- **Why it matters:** Cmd+K is conventionally a TOGGLE in Linear/Notion/Superhuman (the components the palette is modelled on). Operator muscle memory says "Cmd+K to open, Cmd+K to dismiss" — the second press silently fails.
- **Recommended fix:** Add an early-return BEFORE the isEditable guard: `if (open) { e.preventDefault(); setOpen(false); return; }`. The guard then only matters when the palette is closed.

---

## LOW / INFO

### LOW

- **components/AdsDrawer.tsx:181** — `const k = r.adId || r.adName;` merges all empty-ad-name rows into one bucket. Edge case; ads rarely have both fields empty, but if Meta returns rows where adId is missing AND adName is `""`, every such row accumulates into one false ad with merged metrics.
- **components/Dashboard.tsx:298** — `<TabNav>` has `role="tablist"` and `role="tab"` but no keyboard arrow-key navigation between tabs, no `aria-controls` linking each tab to its panel, and no `tabIndex` management. WAI-ARIA tabs pattern not implemented; screen-reader users can't navigate by arrow.
- **components/TabNav.tsx** — same issue, no `aria-controls` / `aria-labelledby` between tab and tabpanel.
- **components/CampaignsTable.tsx:524** — `if (b.spend === 0 && b.impressions === 0) continue;` correctly drops fully-empty days from `dailyByCampaign`, but a refund-only day (conversionValue > 0, spend = 0, impressions = 0) is also dropped. Probably intentional but undocumented; could confuse a future maintainer trying to reconstruct a "refund-only day" series.
- **components/HeroOverview.tsx:194** — `useMemo` deps include the entire `data` and `filters` objects rather than `data.rows` + `filters.store` + `filters.range.from`/`.to`. Memo invalidates on every parent re-render even when the relevant inputs haven't changed.
- **components/HeroOverview.tsx:122-125** — `cpmAgg = useMemo(() => aggregateCpm_(...), [campaignsData, filters.range.from, filters.range.to, filters.store])` — `campaignsData` is the whole response object, but only `.rows` is read inside `aggregateCpm_`. Same dep-precision issue as above; benign but causes redundant memo work.
- **components/TodayLive.tsx:568-594** — `function Mini({...})` is declared but never referenced. Dead code.
- **components/HealthScorePanel.tsx:4-8** — `HealthScoreComponents` is imported but unused. Dead import.
- **components/PerStoreCards.tsx:43** — `withRoas[0]` relies on the parent passing `aggregateByStore` output (which IS sorted desc by ROAS). If a caller ever passes an unsorted `StoreAgg[]`, "topStore" is whatever's at index 0 — silently wrong. Add a guard `withRoas.reduce((best, s) => s.roas > best.roas ? s : best)` to remove the dependency on caller ordering.
- **components/MetaShopifyReconciliation.tsx:165-181** — `darkTrafficPercent` mixes accounting bases (platform CLAIM vs Shopify ACTUAL). The denomination-boundary comment (line 105-141) acknowledges this; surfaced as a LOW because the operator-facing copy at line 787-792 explains the caveat, but the math is still misleading when platforms over-attribute (the chip never fires on over-counting, only under-counting).
- **components/operator/TokenFailuresTable.tsx:97** — uses `alert()` for error feedback. Native alert blocks the page and doesn't match the dashboard's Hebrew-RTL styling; everywhere else uses inline `role="alert"` banners.

### INFO

- **components/operator/WhatsappTestButtons.tsx:49** — success copy says "שני המספרים" (two numbers) but the OPERATOR CONSTRAINTS document a single recipient setup (+972524809540 only). Copy drift; not a runtime bug.
- **components/CampaignsTableRow.tsx:139-145** — `isCampaignCurrentlyOff` does the date arithmetic in UTC and outputs an ISO date string. Since both inputs (`today`, `lastActiveDate`) are IL-anchored YYYY-MM-DD strings used as opaque calendar tokens, the UTC arithmetic is correct (no TZ conversion happens). Worth a comment though — without one a future maintainer will see `Date.UTC(...)` and `.toISOString()` near an IL-anchored variable and try to "fix" it.
- **components/CampaignsTableRow.tsx:485-544** — `trustLabel`, `trustLevel`, `confTone` are computed but only referenced via `void` markers (line 542-544). The comment explains they're retained for the tooltip text, but `useAttr` and `info.confidence.label` ARE the only consumers — the three locals are genuinely dead. Could be removed for clarity.
- **components/CommandPalette.tsx:392** — `.filter(s => s.score > 0)` is dead code: the inner loop sets `score = -Infinity` on no-match and accumulates ≥25 on match, so a positive score is the only non-negative outcome.
- **components/InsightsBoard.tsx:152** — `markInsight` writes through `writeInsightStates(next)` and also calls `setStates(prev => ...)`. The write happens synchronously inside the state setter; if `writeInsightStates` throws (full localStorage quota), the in-memory state updates but cloud sync silently fails. Add try/catch + user-facing error toast.

---

## Files reviewed
- components/AdSetTable.tsx
- components/AdsDrawer.tsx
- components/AiReportButton.tsx
- components/BillingCsvImport.tsx
- components/BillingSettings.tsx
- components/CampaignDrawer.tsx
- components/CampaignsColumnsMenu.tsx
- components/CampaignsTable.tsx
- components/CampaignsTableRow.tsx
- components/CloudSync.tsx
- components/CommandPalette.tsx
- components/Dashboard.tsx
- components/ErrorBoundary.tsx
- components/Filters.tsx
- components/FreshnessChip.tsx
- components/GoalTracker.tsx
- components/HealthScoreBadge.tsx
- components/HealthScorePanel.tsx
- components/HeroOverview.tsx
- components/InsightsBoard.tsx
- components/InsightsPanel.tsx
- components/KpiCards.tsx
- components/MetaShopifyReconciliation.tsx
- components/MonthlyTables.tsx
- components/PerStoreCards.tsx
- components/ProductCentricView.tsx
- components/ProductPickerModal.tsx
- components/ProductsTable.tsx
- components/SyncIndicator.tsx
- components/TabFreshnessHeader.tsx
- components/TabNav.tsx
- components/TodayLive.tsx
- components/operator/BackfillPicker.tsx
- components/operator/JobsTable.tsx
- components/operator/ManualOverridesCrud.tsx
- components/operator/ResetData.tsx
- components/operator/SyncNowButtons.tsx
- components/operator/TokenFailuresTable.tsx
- components/operator/WhatsappTestButtons.tsx
