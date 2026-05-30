---
audit: untouched-components-pass-2
reviewed: 2026-05-23
depth: deep
scope: components + lib + api routes not deeply covered in audit pass 1
findings:
  critical: 9
  high: 12
  medium: 14
  low: 8
  total: 43
---

# Audit Pass 2 — Components & Libs Not Covered in Pass 1

## Summary

The previously-uncovered surface area is **not solid**. Audit pass 1 left real correctness bugs in three high-impact systems:

1. **P&L cost math** (`billing.ts` + `costs.ts`): the `store === 'All'` recurring cost is **silently multiplied by the number of in-scope stores**, inflating fixed costs by 200-300% on the default "All stores" view. Combined with `TRANSACTION_FEES_RATE` and `COGS_RATE_OF_REVENUE` still being hardcoded globals (no per-store calibration despite T4.4 documenting `getCogsRateForStore`), the P&L numbers shown to the operator are **structurally wrong**.

2. **GoalTracker scope mismatch** (`GoalTracker.tsx`): the goal panel uses unfiltered `data.rows` ignoring the global store filter, while every other panel (KPIs, P&L, per-store cards) respects it. The "X% מהיעד" the operator sees changes meaning every time they switch store filter — the goal stays per-month-total even when they're looking at one store.

3. **AdSetTable + AdsDrawer + Hook gating mismatch**: `AdSetTable` now permits drill-down for both `'Meta'` AND `'TikTok'` (Phase 05.7.9 change), but `useCampaignAttribution.ts` still gates the per-ad-set attribution map with `summary.platform !== 'Meta' return out` — TikTok ad-sets always show "—" in the ROAS Shopify column even when click-id data exists. `AdsDrawer.tsx` opens for TikTok but `dailyMetaByAd` (still named for Meta) computes correctly; the drill-down does work — the bug is one level up.

Plus: division-by-zero in `ProductChannelBreakdown` when `total === 0` produces NaN width bars, a `RefundIndicator` onMouseLeave race that fires while the tooltip's open-state check is still pending portal mount, and an `aggregateByStore` that ignores the request range entirely — per-store cards prorate billing over the data-derived min/max rather than the user's selection (a duplicate of the same bug Phase 05.7.8 fixed at the top level).

The operator console (`/operator/*`) is structurally sound — the SecurityProtocol is consistent, no admin imports leak to client. The big concerns there are: `BackfillPicker` uses `new Date().toISOString().slice(0, 10)` as "today" (UTC, not Asia/Jerusalem — operator's "today" may differ from server "today" by several hours), `useDashboardRefresh.ts` polls `/api/data` every 5s with cache-busting that does NOT reset between iterations (same `_t=triggerTime` for all 18 polls — the second through 18th probes will hit Vercel's edge cache and lie about backend completion).

This file lists all bugs found. **Findings are classified BLOCKER / WARNING per the review framework** — no fluff, no style commentary.

---

# Findings

## CRITICAL / BLOCKER

### CR-01: `billingForRange` triples the cost of "All" stores recurring entries
**File:** `dashboard-web/src/lib/billing.ts:184-197`
**Severity:** BLOCKER — silently inflates Fixed Costs in P&L by 2-3x for every "All" store entry on the default dashboard view.

The loop:
```typescript
for (const r of readRecurring()) {
  if (!r.active) continue;
  const stores =
    r.store === 'All' ? storeNames : storeSet.has(r.store) ? [r.store] : [];
  for (const s of stores) {
    const amount = (r.monthlyCAD * days) / 30;
    recurringInPeriod += amount;     // ← summed per-store
    bySource[r.source] = (bySource[r.source] ?? 0) + amount;
    byStore[s] = (byStore[s] ?? 0) + amount;
  }
}
```

A Klaviyo subscription set to `store: 'All'` and `monthlyCAD: 60` on a 30-day range with `storeNames = ['uzoshop', 'zolplus', 'usmile360']` produces:
- `recurringInPeriod = 60 + 60 + 60 = 180` (should be 60 — there's only one Klaviyo)
- `bySource.email = 180` (same triple-count error)
- `byStore = { uzoshop: 60, zolplus: 60, usmile360: 60 }` — this attribution is correct IF the user really pays $60/store/month, but the *aggregated total* is now 180, not 60

The file comment on line 189 — "Each store getting an 'All' cost takes its share — but in practice we shouldn't double-bill" — actively contradicts what the code does. The author knew this was wrong.

**Real-world impact:** The dashboard auto-seeds a `$20/store/month` email service per store at first run. The CSV importer's "default scope" can also set rows to `All`. Every entry with `store === 'All'` is silently 3x'd in the visible Fixed Costs line and 3x'd-subtracted from True Net Profit.

**Fix:** When `r.store === 'All'`, add the amount ONCE and split the byStore attribution across the scope:
```typescript
if (r.store === 'All') {
  const amount = (r.monthlyCAD * days) / 30;
  recurringInPeriod += amount;
  bySource[r.source] = (bySource[r.source] ?? 0) + amount;
  // Split the per-store attribution evenly so byStore stays additive
  const perStore = amount / storeNames.length;
  for (const s of storeNames) byStore[s] = (byStore[s] ?? 0) + perStore;
} else if (storeSet.has(r.store)) {
  const amount = (r.monthlyCAD * days) / 30;
  recurringInPeriod += amount;
  bySource[r.source] = (bySource[r.source] ?? 0) + amount;
  byStore[r.store] = (byStore[r.store] ?? 0) + amount;
}
```

The same fix applies to the one-time loop at lines 200-209 (`store === 'All'` one-times are correctly counted ONCE today via `oneTimeInPeriod += o.amountCAD` outside any loop, but the byStore attribution at line 207 just stuffs the whole amount into `storeNames[0]` which is wrong for reporting).

---

### CR-02: `aggregateByStore` ignores the request range — prorates billing over data-derived min/max
**File:** `dashboard-web/src/lib/analytics.ts:115-126` (called from `Dashboard.tsx:166`)
**Severity:** BLOCKER — Per-store cards show different Fixed Costs / True Net Profit than the top-level KpiCards for the same date range.

Phase 05.7.8 fixed this for the top-level `aggregate(cur, filters.range)` call by adding the `range?: DateRange` arg. `aggregateByStore` was NOT updated:
```typescript
export function aggregateByStore(rows: DailyRow[]): StoreAgg[] {
  const map = new Map<string, DailyRow[]>();
  for (const r of rows) {
    if (!map.has(r.storeName)) map.set(r.storeName, []);
    map.get(r.storeName)!.push(r);
  }
  const out: StoreAgg[] = [];
  for (const [store, list] of map) {
    out.push({ store, ...aggregate(list) });   // ← no range passed
  }
  ...
}
```

`aggregate(list)` with no range falls back to `minDate / maxDate` from the rows — which excludes the user-selected range's empty leading/trailing days. So if the user picks "this month" and only 5 days have data so far, per-store cards prorate fixed costs over 5 days while top-level KPIs prorate over the full month-to-date span (or full month). The numbers don't add up.

**Fix:** Forward the request range:
```typescript
export function aggregateByStore(rows: DailyRow[], range?: DateRange): StoreAgg[] {
  ...
  for (const [store, list] of map) {
    out.push({ store, ...aggregate(list, range) });   // ← pass through
  }
  ...
}
```

And update `Dashboard.tsx:166`:
```typescript
storeAggs: aggregateByStore(cur, filters.range),
```

---

### CR-03: `useDashboardRefresh` cache-bust string is static — polls 2..18 hit the CDN cache
**File:** `dashboard-web/src/lib/useDashboardRefresh.ts:65,70`
**Severity:** BLOCKER — the "refresh entire dashboard" button can return a false-positive `backendDone = true` long before the backend has actually written the new data.

```typescript
const triggerTime = Date.now();
...
const cacheBust = `_t=${triggerTime}`;   // ← computed ONCE
let backendDone = false;
while (Date.now() - startedPolling < MAX_WAIT_MS) {
  await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  try {
    const probe = await fetch(`/api/data?${cacheBust}`, {   // ← same URL every iteration
      cache: 'no-store',
    });
```

`cache: 'no-store'` on the fetch options bypasses the BROWSER cache, but the CDN/Vercel edge cache keys on URL — and the URL is identical every iteration. The first poll's response gets cached for `revalidate=30` (per `/api/data` config), and every subsequent poll inside that 30s window returns the same cached body. If the cached `dataLastWriteAt` happens to be >= `triggerTime` (e.g. there was a normal sync 10s before the operator clicked refresh), `backendDone` flips true on the first poll, the loop exits, and the SWR mutate fires while the backend is still grinding.

Worse: if the cached `dataLastWriteAt` is < `triggerTime` (the more common case), the operator waits the full 90s timeout because every probe gets the same stale value.

**Fix:** Bust the cache PER iteration:
```typescript
while (Date.now() - startedPolling < MAX_WAIT_MS) {
  await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  try {
    const probe = await fetch(`/api/data?_t=${Date.now()}`, {
      cache: 'no-store',
    });
```

---

### CR-04: `GoalTracker` ignores the global store filter
**File:** `dashboard-web/src/components/GoalTracker.tsx:46` + `Dashboard.tsx:352`
**Severity:** BLOCKER — pacing math and "you need CAD X more to hit goal" are computed against ALL stores' revenue even when the operator has filtered to one store.

```typescript
// Dashboard.tsx
<GoalTracker data={data} />   // ← passes raw data.rows; no store filter applied

// GoalTracker.tsx
const forecast = useMemo(() => forecastMonthEnd(data.rows), [data.rows]);
```

`forecastMonthEnd` (insights.ts:471-478) iterates `for (const r of rows) if (r.date >= monthStart...) mtdRev += r.revenue` with no store discrimination. A goal of "100,000 CAD/month for uzoshop" displayed while filtering to uzoshop will still show MTD revenue summing all 3 stores — making the user think they're 80% there when they're actually 30% there for uzoshop alone.

The whole panel sits on the home tab right above KpiCards (which DO respect the filter). The two adjacent widgets show contradictory numbers for the same period.

Also: the inline editor (line 200) reads "הערך נשמר רק בדפדפן הזה (localStorage)" — but `writeGoal` calls `pushCloudKey` so the value IS cloud-synced. The comment lies to the user.

**Fix:** Either:
- (a) accept the filter and re-filter rows: `forecastMonthEnd(filterRows(data.rows, filters.range, filters.store))` and rename the panel to "יעד חודשי · {storeLabel}" so the operator sees which store the goal applies to; OR
- (b) lock the panel to always-all-stores and surface this in the UI copy: "יעד חודשי לכלל החנויות" with a banner when `filters.store !== 'All'` saying "המספרים כאן לא משתנים לפי סינון החנות".

Either way, also fix the "localStorage" copy at line 200 — it's cloud-synced now.

---

### CR-05: `ProductChannelBreakdown` divides by zero — NaN widths render as malformed CSS
**File:** `dashboard-web/src/components/ProductChannelBreakdown.tsx:28,84-88`
**Severity:** BLOCKER — when `breakdown.totalOrders === 0`, every segment width becomes `NaN%` and React's inline style coerces to `width: "NaN%"` which silently becomes 0 width (Webkit/Chrome) or 100% (Firefox quirks). The 5-segment bar collapses to a thin line or fills with the FIRST color (blue).

```typescript
const total = breakdown.totalOrders;           // ← can be 0
...
<div style={{ width: `${(fb / total) * 100}%` }} />
<div style={{ width: `${(google / total) * 100}%` }} />
<div style={{ width: `${(tiktok / total) * 100}%` }} />
<div style={{ width: `${(direct / total) * 100}%` }} />
<div style={{ width: `${(other / total) * 100}%` }} />
```

The parent (`CampaignDrawer`'s `productChannelBreakdown` useMemo) has a triple-gate (Meta + mapped products + ≥3 orders) per the docstring. But the gate is "platform Meta + has mappings + has ≥3 ORDERS" — *of the mapped products in the date range*. If the mapped products genuinely had zero matching orders in the window (perfectly valid: brand-new campaign, a different store's orders, all refunds), `total === 0` and the bar is broken.

Also: `fbPct = Math.round(breakdown.facebookShare * 100)` shows `0%` correctly because `facebookShare` is computed safely elsewhere, but the "100% מהמכירות הגיעו מפייסבוק" copy never fires (`facebookShare < 0.6`) so the bar IS the only visual feedback. A broken bar with 0 orders shown next to "0 הזמנות של מוצרים משויכים" leaves the operator confused.

**Fix:** Bail early when total is zero:
```typescript
export function ProductChannelBreakdown({ breakdown }: Props) {
  const total = breakdown.totalOrders;
  if (total === 0) return null;   // or render a single "no orders to attribute" tile
  ...
}
```

Or guard the widths: `const safeTotal = Math.max(total, 1)` then divide by `safeTotal`. Bail-early is preferred — a 0-orders panel is noise.

---

### CR-06: `useCampaignAttribution` Meta-only gate makes TikTok ROAS Shopify column always blank in AdSetTable
**File:** `dashboard-web/src/lib/hooks/useCampaignAttribution.ts:81,104`
**Severity:** BLOCKER — Phase 05.7.9 extended `AdSetTable.canDrillToAds` to TikTok (`a.platform === 'Meta' || a.platform === 'TikTok'`), but the attribution hook still hard-gates on Meta and returns an empty map for TikTok.

```typescript
// useCampaignAttribution.ts:81
if (!summary || summary.platform !== 'Meta') return new Map<...>();

// :104
if (!summary || summary.platform !== 'Meta') return out;
```

Result: a TikTok campaign drawer renders AdSetTable, the rows show TikTok ad-set ROAS chip, but every "ROAS Shopify" cell in the table shows "—" because `attributionByAdSet.get(a.id) === undefined`. The user sees a column header promising data and gets a column of em-dashes.

Same architectural mismatch is visible in `AdsDrawer.tsx:214` where `dailyMetaByAd` is still named for Meta but the ad-level drilldown also accepts TikTok per the trust-chip extension in T-K7.

**Fix:** Drop the platform gate from `useCampaignAttribution` (the attribution function `analyzeAttributionForAdSet` already handles non-Meta platforms by reading their click-id columns; if it doesn't, fix it there too):
```typescript
const dailyMetaByAdSet = useMemo(() => {
  if (!summary) return new Map<...>();   // remove Meta check
  ...
}, [rows, summary]);

return useMemo(() => {
  const out = new Map<string, AttributionAnalysis | null>();
  if (!summary) return out;   // remove Meta check
  ...
});
```

Then verify `analyzeAttributionForAdSet` correctly switches click-id source per `summary.platform` (Meta → fbclid/utm_term; TikTok → ttclid/utm_content; Google → gclid). If it currently assumes Meta, that's the deeper bug.

Either way: don't promise TikTok drill-down in the UI and silently disable the trust chip in the resulting table.

---

### CR-07: `dispatchChange` in `cloudSync.ts` is called even when `removeLocal` runs — but the registered listeners do `setX(readY())` which then reads an empty/cleared value → user-facing data loss on a partner's "clear" action with no warning UI
**File:** `dashboard-web/src/lib/cloudSync.ts:392-409`
**Severity:** BLOCKER on data-loss vector — a partner pressing "delete monthly goal" on device B silently wipes the goal from device A's localStorage AND the cloud, with no undo and no user notification.

The hydrate path:
```typescript
if (cloudVal === null || cloudVal === undefined) {
  removeLocal(lsKey);
  dispatchChange(lsKey);
  continue;
}
```

When cloud has an explicit null (partner cleared the value), the local key is removed. The dispatched event triggers `useBillingRecurring` (etc.) to re-read, which returns `[]` for arrays or `null` for the goal. The UI flips silently. No banner says "Goal was cleared by another device 8 seconds ago — undo?".

The actual data-loss vector is the *combination* of (a) partner-A might have been about to type a new value and never saved, and (b) partner-B's clear arrives via the 30s poll and overwrites partner-A's *in-progress* state. The `HYDRATE_GRACE_MS = 8_000` window protects ONLY the keys that have actually been `pushCloudKey`'d — typing-but-not-saved-yet has no grace.

This isn't theoretical: the GoalTracker has an inline editor (`editing` state). If partner-A opens the editor, types "150000", and partner-B clears the goal in the same 30s window, partner-A's editor stays open with their draft visible but the underlying `goal` flips to null on the next hydrate. When they click שמור (commit), the new value is written and the partner-B clear is lost. From partner-B's perspective: they cleared the goal but it came back. No conflict warning.

**Fix (defensive):**
- Add a check to `dispatchChange` (or to the hydrate loop) that skips the dispatch when an editor is open (would require a global "currently editing" registry; complex).
- Simpler: surface the partner-induced change as a toast — "ערך עודכן ע״י משתמש אחר" — at least the operator knows what happened.
- Even simpler: don't auto-overwrite at 30s. Add a "pull changes" button in `SyncIndicator` so the operator opts in.

This is a contract bug, not a code bug — the file-level docstring says "Two partners editing the same key at the same time will see the later POST win. Acceptable for the kind of data here". But that contract doesn't include "explicit null = silent client-side wipe" — the docstring should say so, and the UI should at least warn before the wipe lands.

---

### CR-08: `RefundIndicator` hover behavior leaks open state when the mouse exits during the portal-positioning useLayoutEffect's first tick
**File:** `dashboard-web/src/components/RefundIndicator.tsx:81-104,136-138`
**Severity:** BLOCKER for accessibility — tooltips can become un-dismissable on hover-then-fast-leave because the close handler races the open mount.

Sequence:
1. `onMouseEnter` → `setOpen(true)`
2. `useLayoutEffect` (line 90) runs because `open` deps changed → triggers `setPos(...)` synchronously
3. But `setPos` is async — the next render frame is when `pos` is non-null and the portal mounts
4. If the mouse leaves between step 1 and step 4, `onMouseLeave → setOpen(false)` fires
5. React re-renders with `open=false`, the cleanup in `useLayoutEffect` runs → removes scroll/resize listeners
6. BUT: the `onDocClick` `useEffect` (line 107) only registers when `open === true` — if step 4 raced step 3 such that step 3's tick happened first AND the portal momentarily mounted, the document-click handler might never get registered (depends on React batching)

The race is rare but real on slow renders. The simpler bug is at line 136-138: `onMouseEnter` and `onMouseLeave` are on the wrapper `<span>`, but the portal is on `document.body` — leaving the wrapper does NOT count as leaving the tooltip. If the wrapper is in a scroll-overflow container that scrolls under the tooltip (the actual scenario the file-level comment claims to fix), mouse can be over the tooltip but the wrapper sees `onMouseLeave` → tooltip closes → bait-and-switch.

**Fix:** Add `pointer-events: none` on the portal (already there at line 162) — but then clicks on the tooltip are eaten. Better fix is to track tooltip state via a delayed close (200ms grace) and cancel the close if the mouse re-enters either the wrapper OR the portal element.

Also: the file-level comment says "tap toggles open/closed" but `onClick` at line 143 is on the inner `<button>`, while the `<span>` wrapper has `onMouseEnter/onMouseLeave`. On touch devices both fire on a tap (sequence: mouseenter → click → mouseleave). The button's click handler `setOpen(v => !v)` runs after `mouseenter` already set it true → flips to false. Tap on mobile == no tooltip. Test on iOS.

---

### CR-09: `notifyTokenFailure` updates `alerts_sent_count` even when the WhatsApp send THREW — undercount of throttle suppressions
**File:** `dashboard-web/src/lib/notifications/tokenFailures.ts:227-249,268-273`
**Severity:** BLOCKER for alert correctness — if Meta WhatsApp API is down, every cron-live tick sets `result.alerted = true` IF NOT THROTTLED... wait, let me re-read.

Actually re-reading: `result.alerted = true` ONLY in the try block AFTER `await sendWhatsAppTemplate(...)` succeeds. If it throws, the catch sets `sendError` but does NOT set `alerted = true`. Then at line 270, `alerts_sent_count = (existing?.alerts_sent_count ?? 0) + (result.alerted ? 1 : 0)` — only increments when actually sent. That's correct.

BUT: `last_alert_sent_at = new Date(now).toISOString()` at line 279 is ALSO gated by `if (result.alerted)`. So if WhatsApp throws, the throttle clock does NOT advance. The next cron-live tick (15min later) hits `now - lastAlertMs >= ALERT_THROTTLE_MS` — the 6h check, `lastAlertMs = 0` because the first send never succeeded — so `shouldAlert` is true again. And again. And again.

Result: as long as WhatsApp is unreachable, EVERY cron-live tick attempts a fresh send (no throttle), spamming the logs with the same Meta 132001 errors at 15-minute intervals. If WhatsApp recovers 6 hours later, the operator gets a single alert (correct).

But if a fetcher loops calling `notifyTokenFailure` in a tight retry loop (e.g. the cron Fetcher itself, in `for store of 3 stores` for 15min × 3 = 45 invocations/hour), each one attempts a fresh send. Meta rate-limits at template-msg level — sustained 4xx for 1 hour could trip a Meta-side block requiring manual reset.

**Fix:** Move the `last_alert_sent_at` update OUT of the `if (result.alerted)` gate — bump the throttle clock on EVERY decision to send (even when the send failed), so the next attempt waits 6h. This means a real recovery-after-outage will be delayed up to 6h, but that's acceptable; the alternative is rate-limit ban from Meta.

```typescript
if (shouldAlert) {
  try {
    await sendWhatsAppTemplate(...);
    result.alerted = true;
  } catch (e) {
    sendError = e instanceof Error ? e.message : String(e);
    console.warn(...);
  }
  // Bump throttle even on failure — see CR-09 fix.
  payload.last_alert_sent_at = new Date(now).toISOString();
}
```

Move the `last_alert_sent_at = ...` assignment AFTER the try/catch (still inside `shouldAlert`) — fires regardless of send outcome.

---

## HIGH (BLOCKER, but smaller blast radius)

### HI-01: `STORE_FIXED_COSTS` in `costs.ts` is empty for all three stores — every active store gets only the $20 email default
**File:** `dashboard-web/src/lib/costs.ts:43-47`
**Severity:** BLOCKER — code path silently returns $20 for all stores even though there are real billing entries the user has presumably added via `BillingSettings`.

```typescript
export const STORE_FIXED_COSTS: Record<string, StoreFixedCosts> = {
  uzoshop:     { shopifyPlan: 0, apps: 0 },
  'Zol Plus':  { shopifyPlan: 0, apps: 0 },
  '360usmile': { shopifyPlan: 0, apps: 0 },
};
```

`monthlyFixedCostsForStore` and `prorateFixedCosts` are still EXPORTED, so something might still call them. Grep shows... nothing actually uses them anymore (the live billing layer at `billing.ts:billingForRange` replaced this). But they're still in the public API.

**Fix:** Either delete `STORE_FIXED_COSTS` / `monthlyFixedCostsForStore` / `prorateFixedCosts` entirely (dead code that lies about the data source), OR mark them deprecated with a JSDoc `@deprecated` tag pointing to `billingForRange`. Dead exports tempt a future refactor into picking up the wrong source.

---

### HI-02: `TRANSACTION_FEES_RATE` and `COGS_RATE_OF_REVENUE` are still hardcoded globals — no per-store calibration (T4.4 surfaces this)
**File:** `dashboard-web/src/lib/costs.ts:25` + `dashboard-web/src/lib/analytics.ts:11`
**Severity:** BLOCKER for PnL correctness on stores with different cost structures.

`TRANSACTION_FEES_RATE = 0.065` is applied uniformly to revenue regardless of store. But the comment says "PayPal + המרת מטבע · 6.5%" — different stores use different processors (Shopify Payments vs PayPal vs Stripe), different countries, different currency conversion paths. 360usmile (Canadian) has zero FX cost; uzoshop (likely Israeli) pays both processor fee and ILS→CAD conversion.

`COGS_RATE_OF_REVENUE = 0.25` (analytics.ts:11) is the same story. The audit pass 1 prompt explicitly mentions T4.4 introduced `getCogsRateForStore` — but I see no such function in the codebase. `grep -rn "getCogsRateForStore" dashboard-web/src/lib/` returns nothing.

`PnLBreakdown.tsx:223` shows the hardcoded note "הערכה: 25% מההכנסה (ממוצע היסטורי 25-26%)" — same fiction.

**Fix:** Either (a) ship a real per-store COGS / transaction-fee table (similar to `STORE_FIXED_COSTS`) and consume it in `aggregate()` instead of multiplying revenue by a global constant; OR (b) document explicitly in the UI that these are global averages, with a "calibrate per-store" link. The audit prompt suggests (a) was intended for T4.4 but never landed.

---

### HI-03: `BackfillPicker` uses `new Date().toISOString().slice(0, 10)` — UTC-today, not Asia/Jerusalem today
**File:** `dashboard-web/src/components/operator/BackfillPicker.tsx:71`
**Severity:** WARNING with edge-case bite — operator at 02:00 IL time would see yesterday's UTC date as their backfill default, sending an event that the worker re-resolves at "today IL" giving an off-by-one day.

```typescript
const todayIso = new Date().toISOString().slice(0, 10);
```

The comment says: "We don't anchor on Asia/Jerusalem here because the picker is just a UX initialiser; the server route validates and the worker re-resolves dates in tz." That's true for the worker, but the UX is still wrong: at 01:00 IL Tuesday morning, the picker shows `to=Monday`, the operator backfills Monday, and Monday's data is what backs the operator's "I expected today" mental model.

**Fix:** Match the convention used by `MonthlyTables.tsx:50-58`:
```typescript
const todayIso = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Jerusalem',
  year: 'numeric', month: '2-digit', day: '2-digit',
}).format(new Date());
```

Same fix applies to `ManualOverridesCrud.tsx:92` (`new Date().toISOString().slice(0, 10)` as add-row default) and `BillingSettings.tsx:737` (one-time cost default date).

---

### HI-04: `AdsDrawer` summary useMemo dep array includes `rangeFrom`/`rangeTo` but the filter inside doesn't gate by date (FIX-07 removed it server-side)
**File:** `dashboard-web/src/components/AdsDrawer.tsx:147-207`
**Severity:** WARNING — extra re-computation on every range change is harmless, but the dep list is misleading. Worse: if `data.rows` ever contains out-of-range dates again (e.g. a regression in `/api/ads`), the filter is gone and you'll silently aggregate them.

```typescript
const summary = useMemo(() => {
  ...
  for (const r of data.rows) {
    // FIX-07 (5.2.2.1): date filter removed — /api/ads now filters by range server-side via fetchAdsData({ range }).
    if (r.platform !== platform) continue;
    if (r.storeId !== storeId) continue;
    if (r.campaignId !== campaignId) continue;
    if (r.adSetId !== adSetId) continue;
    ...
  }
}, [data, storeId, platform, campaignId, adSetId, rangeFrom, rangeTo]);
```

`rangeFrom` and `rangeTo` are in the deps but never read — the SWR key already includes them via `buildDateRangeKey`, so when the range changes a new `data` arrives. The deps are correct purely as defense-in-depth — but the inline comment makes it read like the filter still exists. The `dailyMetaByAd` useMemo at line 214-236 DOES still filter by date (`r.date < rangeFrom || r.date > rangeTo`), creating an inconsistency: summary aggregates ALL rows in `data.rows`, but `dailyMetaByAd` only the in-range subset.

**Fix:** Either restore the date filter in `summary` for defensive consistency, OR remove the now-redundant date filter in `dailyMetaByAd`. Pick one strategy and apply uniformly.

---

### HI-05: `findMatchingRecurring` in `billing.ts` matches dup against the wrong store
**File:** `dashboard-web/src/lib/billing.ts:458-470`
**Severity:** WARNING — CSV import duplicate-detection silently misses dupes when the user changes the destination store mid-import.

```typescript
export function findMatchingRecurring(
  line: ParsedBillLine,
  store: string,
  existing: RecurringCost[],
): RecurringCost | null {
  const desc = line.description.trim().toLowerCase();
  for (const r of existing) {
    if (r.store !== store && r.store !== 'All') continue;
    if (r.name.trim().toLowerCase() !== desc) continue;
    if (Math.abs(r.monthlyCAD - line.amountCAD) <= 2) return r;
  }
  return null;
}
```

The logic considers `r.store === store || r.store === 'All'` as "in scope". But what if existing has a `r.store === 'uzoshop'` Klaviyo entry, and the user is importing CSV with `store === 'All'`? The current code matches when `r.store === 'All'` for the line being checked, but the LINE store is `'All'` and the EXISTING is `'uzoshop'` — the condition `r.store !== store && r.store !== 'All'` is `'uzoshop' !== 'All' && 'uzoshop' !== 'All'` → `true && true` → `continue`. So the existing uzoshop Klaviyo is invisible to the dupe-detection when importing as 'All'. The user double-adds.

**Fix:** Symmetric scope matching — a line being added to a specific store should also see "All" existings as potential dupes:
```typescript
const lineMatchesStore = r.store === store ||         // exact match
                         r.store === 'All' ||         // existing is global, line is specific
                         store === 'All';             // line is global, existing is specific
if (!lineMatchesStore) continue;
```

---

### HI-06: `parseShopifyBillsCsv` uses `Math.round(amount * FROZEN_USD_TO_CAD)` — rounds USD-to-CAD at row level, hiding cents
**File:** `dashboard-web/src/lib/billing.ts:373-375`
**Severity:** WARNING — every row's `amountCAD` is rounded to a whole number, then the row-level rounding bias accumulates across an import. A 60-row Shopify bill can end up off by ~$5 from the cleanly-rounded grand total.

```typescript
const amountCad =
  currency.toUpperCase() === 'CAD'
    ? amount
    : Math.round(amount * FROZEN_USD_TO_CAD);
```

`$9.99 * 1.36 = 13.5864` → rounded to 14. Over 60 rows averaging ~$0.5 error each, you accumulate $30+ in import discrepancy from the actual bill. The user sees the P&L for that month report 14 + 14 + 14 = 42 when the bill says 41.85.

**Fix:** Round at the AGGREGATE level, not per row:
```typescript
const amountCad =
  currency.toUpperCase() === 'CAD'
    ? amount
    : amount * FROZEN_USD_TO_CAD;   // keep precision
```

Then format with `formatCurrency` (which the UI already does). Storage gets the float, display gets the rounded value.

---

### HI-07: `MonthlyTables` `daysOfMonth` produces "wrong" days for Sep/Apr/Jun/Nov (30-day months) inside leap years
**File:** `dashboard-web/src/components/MonthlyTables.tsx:476-484`
**Severity:** WARNING — the function `new Date(y, m, 0)` returns "last day of month (m-1) when m is 1-12". For month 2 in a leap year, returns 29 — correct. For month 12, returns 31 — correct. The classic bug is `new Date(y, 13, 0)` which is "last day of December" — also correct.

```typescript
function daysOfMonth(ym: string): string[] {
  const [y, m] = ym.split('-').map(Number);
  const last = new Date(y, m, 0).getDate();   // last day of month m (1-indexed)
  const out: string[] = [];
  for (let d = 1; d <= last; d++) {
    out.push(`${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`);
  }
  return out;
}
```

Actually this is OK. False alarm — `new Date(y, m, 0)` where m is 1-12 correctly returns the last day of month m (because day 0 of month m+1 is last day of month m, and m here is already 1-indexed from the split). Withdraw the bug claim.

**However**: there's a separate subtle issue — `new Date(y, m, 0)` uses LOCAL time. In Asia/Jerusalem on the last day of Feb during a DST transition (e.g. transitioning from winter to summer time around March 25-30), the local Date object can off-by-one. Not critical because this is just iterating day numbers, but worth being aware.

Re-classifying as: not a bug, leaving as note.

---

### HI-08: `MonthlyTables` truncates date range to 17 months but the SWR fetch uses ARCHIVE_FALLBACK_MONTHS (18) → off-by-one missing month
**File:** `dashboard-web/src/components/MonthlyTables.tsx:32`
**Severity:** WARNING — by design 17 to avoid hitting the archive boundary, but the comment says "Sized just inside the Phase 5 archive cutoff (ARCHIVE_FALLBACK_MONTHS = 18) so the fetch stays warm-only". 18 months back from today is `today - 18*30 = ~547 days`. 17 months is `today - 510 days`. The boundary check at `sheets.ts:127` is `opts.range.from < archiveCutoff` where `archiveCutoff = monthsAgoUtcStr(18)`. Strict less-than means a request for *exactly* the archive cutoff month does NOT trigger archive read. 17 months should be safe.

But: `monthsAgoUtcStr(months)` does `new Date(year, month-months, day)`. If today is `2026-05-23` and months=17, `new Date(2026, -12, 23)` = `2024-12-23` (JavaScript normalizes negative months). MonthlyTables shows 17 months => from `2024-12` to today's month inclusive. Archive boundary at 18 months => `2024-11-23`. The range from `2024-12-23` to `2026-05-23` is fully NEWER than `2024-11-23`, so the comparison `'2024-12-23' < '2024-11-23'` is FALSE → no archive read. Good.

But there's still a subtle bug at `MonthlyTables.tsx:99`: `isoMonthsAgo(MONTHLY_TABLES_HISTORY_MONTHS)` uses `today.getDate()` (local) but the formatter outputs in `Asia/Jerusalem`. If today is `2026-05-23 23:00 UTC` (which is `2026-05-24 02:00 IL`), `today.getDate()` returns 23 (UTC) but the formatter outputs "2026-05-24". That's off-by-one across the IL midnight boundary.

**Fix:** Make `isoMonthsAgo` purely TZ-anchored:
```typescript
function isoMonthsAgo(months: number): string {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Jerusalem', year: 'numeric', month: '2-digit', day: '2-digit',
  });
  // Parse today in IL TZ first, then arithmetic.
  const todayParts = fmt.formatToParts(new Date());
  const y = Number(todayParts.find(p => p.type === 'year')!.value);
  const m = Number(todayParts.find(p => p.type === 'month')!.value);
  const d = Number(todayParts.find(p => p.type === 'day')!.value);
  const past = new Date(Date.UTC(y, m - 1 - months, d));
  return fmt.format(past);
}
```

---

### HI-09: `presets.ts` uses a fixed `TZ_OFFSET_HOURS = 3` ignoring DST — winter "yesterday" is off by an hour for the late-night user
**File:** `dashboard-web/src/lib/presets.ts:3-8`
**Severity:** WARNING — between Oct and Mar, IL is UTC+2 not +3. The hardcoded `+3` skews `todayLocal()` by 1h in winter, which crosses the midnight boundary for users browsing between 23:00 and 00:00 IL during winter.

```typescript
const TZ_OFFSET_HOURS = 3; // Asia/Jerusalem (winter is +2, summer +3; close enough for default presets)
```

Comment acknowledges the bug ("close enough") but at 23:30 IL on Dec 1, `todayLocal()` returns a Date that's actually `2026-12-02 02:30 UTC + 3h = 2026-12-02 05:30 UTC`, then `.toISOString().slice(0, 10)` returns `2026-12-02`. The user is browsing on Dec 1 (IL time) but the preset thinks it's Dec 2. The "today" preset returns `from=to=2026-12-02` — a date with no data yet.

**Fix:** Match `MonthlyTables.tsx:50-58` (and now `dashboard-web/src/components/HeroOverview.tsx`, etc.) — use Intl-formatted Asia/Jerusalem dates throughout:
```typescript
function todayLocalStr(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Jerusalem',
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());
}
```

Then rewrite the preset cases to operate on date strings directly (or parse `Date.UTC(y, m-1, d)` from the IL-anchored string).

---

### HI-10: `CommandPalette` keyboard handler doesn't preventDefault on Cmd+K when an input is focused — breaks browser native shortcuts
**File:** `dashboard-web/src/components/CommandPalette.tsx:111-124`
**Severity:** WARNING — Cmd+K is correctly captured at the window level, but the handler also intercepts Cmd+K WHEN a `<textarea>` or `<input>` already has focus (e.g. the user is typing in the GoalTracker's editor or a billing field). The native `Cmd+K` (= no default in most browsers, but custom in some) is suppressed and the palette opens over the user's mid-edit form, losing their typing.

```typescript
function onKey(e: KeyboardEvent) {
  if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
    e.preventDefault();
    setOpen(o => !o);
    setWarmCache(true);
  } else if (e.key === 'Escape' && open) {
    e.preventDefault();
    setOpen(false);
  }
}
```

The Escape branch is also overbroad: Esc in any focused input *also* triggers the palette close — but if the user is editing the goal panel with Esc, the inline editor's local `cancelEdit` may also fire (race between two listeners). The `useDrawerEsc` pattern in `drawerStack.ts` already solved this for drawers but CommandPalette does NOT register with that stack.

**Fix:** Guard Cmd+K with a "not in editable field" check:
```typescript
if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
  const t = e.target as HTMLElement;
  if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) {
    return;   // let the user keep typing
  }
  e.preventDefault();
  setOpen(o => !o);
  setWarmCache(true);
}
```

And register Esc closing through the drawer stack so it doesn't conflict with nested editors.

---

### HI-11: `Filters.tsx` "days" calculation breaks across DST transitions
**File:** `dashboard-web/src/components/Filters.tsx:36-41`
**Severity:** WARNING — `Math.round((toMs - fromMs) / 86400000) + 1` assumes every day is exactly 86,400,000 ms. DST transitions (twice a year in IL) are 23h or 25h days, but `T00:00:00Z` anchor erases that. The calculation is correct for UTC days, but the display "ימים" implies user-local days.

```typescript
const days =
  Math.round(
    (new Date(filters.range.to + 'T00:00:00Z').getTime() -
     new Date(filters.range.from + 'T00:00:00Z').getTime()) / 86400000,
  ) + 1;
```

For a range spanning a DST boundary (e.g. `from=2026-03-28` to `2026-04-04`, where IL spring-forward is around Mar 27-28), UTC sees 7 days but the user lived through 7 local days × (one being 23h). The displayed "7 ימים" is correct in this case. Actually... yes correct because we anchor at UTC midnight, no DST involved.

Withdraw — this is correct.

---

### HI-12: `ProductsTable` `aggregate()` produces ambiguous productKey for "All" stores when two stores have the same productId
**File:** `dashboard-web/src/components/ProductsTable.tsx:166-169`
**Severity:** WARNING — answers the user's Q3. The composite key works correctly:

```typescript
const productKey = store === 'All' ? `${r.storeName}::${r.productId}` : r.productId;
const display = store === 'All' ? `${r.productTitle}  ·  ${r.storeName}` : r.productTitle;
```

So multi-store view DOES disambiguate via the `storeName::productId` composite, and the display shows " · storeName" suffix. That's correct.

But: the summary card's `productKeys` set at line 324 uses `p.productId || p.productTitle` — which strips the storeName disambiguation. So when "All" stores are selected, the "מוצרים שונים" count is the count of unique productIds across stores. If both uzoshop and zolplus sell a product called "iPhone 17 Case" with the SAME productId (unlikely but possible when stores share inventory via Shopify Markets), they merge into one — and the summary says "1 unique product" when there are really 2 store-product combos.

**Fix:** Match the aggregation key:
```typescript
for (const p of b.products) productKeys.add(`${p.productTitle}::${p.productId}`);
```
Or pass `store === 'All' ? `${storeName}::${productId}` : productId`.

Also at line 643: the React key is `${bucket.key}-${p.productId}-${i}` — if two products in the same bucket have the same productId (cross-store collision), the `-${i}` index disambiguates so no React warning, but the "i" makes the key index-based which breaks on sort. Use the composite key instead.

---

## MEDIUM (WARNING)

### MD-01: `cloudSync.ts` `dispatchChange` fires synchronously inside the for-loop — listener throws → next iteration crashes whole hydrate
**File:** `dashboard-web/src/lib/cloudSync.ts:346-414`
**Severity:** WARNING — if any single `'roas-X-changed'` listener throws during hydrate, the whole hydrate loop bails out via the thrown exception. The remaining keys are not hydrated. Next 30s tick retries from scratch.

The loop has no try/catch around `dispatchChange(lsKey)`. A buggy `useEffect` cleanup in a UI component that's mid-unmount during a hydrate can throw an `Invariant Violation: ... unmounted component` error which propagates up.

**Fix:** Wrap individual dispatches:
```typescript
try {
  dispatchChange(lsKey);
} catch (err) {
  console.warn(`cloudSync: dispatchChange threw for ${lsKey}:`, err);
}
```

---

### MD-02: `dashboardState` POST `VALUE_MAX_BYTES = 64_000` measured against serialized JSON, not stored byte length — multi-byte chars miscount
**File:** `dashboard-web/src/app/api/dashboard-state/route.ts:80,103-106`
**Severity:** WARNING — `serialized.length` is JS string length (code-units, 16-bit). A Hebrew character is 1 code unit but 2 UTF-8 bytes. A 64KB Hebrew annotation note could be 128KB on disk → could exceed PostgreSQL's row limit on a deep notes blob.

```typescript
const serialized = JSON.stringify(body.value ?? null);
if (serialized.length > VALUE_MAX_BYTES) {
  return NextResponse.json({ error: 'value too large' }, { status: 413 });
}
```

**Fix:** Measure bytes:
```typescript
const bytes = new TextEncoder().encode(serialized).length;
if (bytes > VALUE_MAX_BYTES) { ... }
```

---

### MD-03: `health` endpoint hardcodes `sheets: 'ok'` — operator console SyncIndicator can't surface real Sheets failures (because Sheets was removed)
**File:** `dashboard-web/src/app/api/health/route.ts:68`
**Severity:** WARNING — by design (file comment) but ANY future Sheets re-introduction (e.g. for the `dashboard-state` Sheets path that was migrated away) will silently report `sheets: 'ok'` when it's actually down.

The right fix is to deprecate the `sheets` field from `HealthResponse` entirely with a TypeScript deprecation marker, force consumers (SyncIndicator) to migrate to a `supabase`-only check, and delete the field. The "stable-and-always-ok" pattern is technical debt.

---

### MD-04: `useDashboardRefresh` `inFlight` ref not reset if effect cleanup runs mid-refresh
**File:** `dashboard-web/src/lib/useDashboardRefresh.ts:106-111`
**Severity:** WARNING — the unmount cleanup at line 107 sets `inFlight.current = false`, but the in-flight Promise is NOT cancelled. If the operator clicks Refresh → navigates away → navigates back → clicks Refresh again, the second click sees `inFlight.current = false` (correctly) and fires, but the first `mutate()` is still racing. The first run's eventual `setIsRefreshing(false)` and `mutate()` may fire AFTER the second run finishes, overwriting the second run's fresh data.

**Fix:** Use an AbortController:
```typescript
const ctrlRef = useRef<AbortController | null>(null);
...
useEffect(() => {
  return () => {
    ctrlRef.current?.abort();
    inFlight.current = false;
  };
}, []);

const refresh = useCallback(async () => {
  if (inFlight.current) return;
  ctrlRef.current?.abort();
  ctrlRef.current = new AbortController();
  const signal = ctrlRef.current.signal;
  ...
  while (Date.now() - startedPolling < MAX_WAIT_MS) {
    if (signal.aborted) return;   // bail on abort
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    if (signal.aborted) return;
    const probe = await fetch(..., { signal, cache: 'no-store' });
    ...
  }
}, [mutate]);
```

---

### MD-05: `MonthlyTables` `MonthBlockPerStore` totals iterate `rows` (the unfiltered month rows), not `byDate.values()` — refunds double-counted on multi-store days
**File:** `dashboard-web/src/components/MonthlyTables.tsx:262-276`
**Severity:** WARNING — the "סך הכל" row for a per-store view sums `for (const r of rows)` where `rows` IS the per-store rows (passed from `monthGroups[ym].filter(r => r.storeName === storeFilter)`). So that's actually correct.

But: in `MonthBlockSummary` at lines 394-402:
```typescript
for (const r of rows) {
  totalSpend += r.totalSpend;
  totalRev += r.revenue;
  totalGross += r.grossRevenue ?? r.revenue;
  if (r.refundDeduction !== null && r.refundDeduction > 0) {
    totalRefund += r.refundDeduction;
  }
}
```

This iterates ALL store rows for the month. If two stores have refunds on the same day, they BOTH get summed correctly (one per store). Good.

But the `byDate.get(d)` rendering at line 430-446 also aggregates by date across stores. The total row uses a separate sum. If the data ever contains duplicate `(date, store)` pairs (which DailyRow uniqueness should prevent but isn't enforced anywhere), the total disagrees with the displayed sum-of-cells. Defensive sum would use `byDate.values()` to ensure consistency:

```typescript
for (const agg of byDate.values()) {
  totalSpend += agg.spend;
  totalRev += agg.revenue;
  totalGross += agg.gross;
  totalRefund += agg.refund;
}
```

Withdrawal: not a bug today, but a fragility.

---

### MD-06: `aggregate()` in analytics computes COGS from `r.cogs` (per-row pre-computed) AND ignores per-store COGS variation
**File:** `dashboard-web/src/lib/analytics.ts:67`
**Severity:** WARNING — the per-row `r.cogs` is set in `sheets.ts:188` as `revenue * COGS_RATE_OF_REVENUE` (the hardcoded global 0.25). So even though `aggregate()` SUMS the per-row cogs (not multiplying revenue by 0.25 at the aggregate level), the underlying values are uniformly 25% per row. Same global-rate bug as HI-02, just spread across the pipeline.

---

### MD-07: `RecurringEditForm` calls `parseFloat(monthlyCAD.replace(/,/g, ''))` — accepts `"abc"` → NaN → falls back to 0 silently
**File:** `dashboard-web/src/components/BillingSettings.tsx:620-628`
**Severity:** WARNING — `Number.isFinite(NaN) === false` so the value is 0. The user typed "abc" thinking they were typing a number, the form silently writes 0 to the cost, and the next P&L view shows that cost as zero.

```typescript
function commit() {
  const amount = parseFloat(monthlyCAD.replace(/,/g, ''));
  onSave({
    name: name.trim() || '(ללא שם)',
    store,
    source,
    monthlyCAD: Number.isFinite(amount) ? amount : 0,   // ← silent 0
    notes: notes.trim() || undefined,
  });
}
```

The input filter at line 680 (`e.target.value.replace(/[^\d.,]/g, '')`) restricts typing, but a paste of "abc" goes through the onChange BEFORE the filter applies (React's controlled-input behavior).

**Fix:** Don't silently save 0 — block commit with an inline error:
```typescript
function commit() {
  const amount = parseFloat(monthlyCAD.replace(/,/g, ''));
  if (!Number.isFinite(amount) || amount < 0) {
    setError('סכום לא תקין');
    return;
  }
  onSave({ ...rest, monthlyCAD: amount });
}
```

Same issue exists in `OneTimeEditForm.commit()` at lines 883-893.

---

### MD-08: `Filters` `selectPreset('custom')` opens advanced but doesn't reset existing custom range — old values are surfaced
**File:** `dashboard-web/src/components/Filters.tsx:25-34`
**Severity:** WARNING — when the user clicks the "custom" preset button, the previous from/to from the last custom session (or from the preset they were on) is shown. If those dates are stale (e.g. last month's), the user has to manually re-pick. Mild UX papercut, not a bug.

---

### MD-09: `MonthlyTables` `hasGa` controls BOTH Facebook AND Google column visibility — Facebook-only stores hide BOTH spend columns
**File:** `dashboard-web/src/components/MonthlyTables.tsx:257,300-301`
**Severity:** WARNING — the variable name is `hasGa` but it gates "Facebook" column rendering too:

```typescript
const hasGa = rows.some(r => r.gaSpend > 0);
...
{hasGa && <th className="px-3 py-2 text-end font-medium">פייסבוק</th>}
{hasGa && <th className="px-3 py-2 text-end font-medium">גוגל</th>}
```

If a store runs ONLY Meta (uzoshop or zolplus historically), `hasGa = false` and BOTH columns hide. The total "יצא" column changes label to "יצא" (not "יצא סה"כ"), but the per-platform breakdown is gone. The user can't see Facebook spend for any store that doesn't ALSO run Google.

**Fix:** Split the check:
```typescript
const hasFb = rows.some(r => r.fbSpend > 0);
const hasGa = rows.some(r => r.gaSpend > 0);
const hasTt = rows.some(r => (r.ttSpend ?? 0) > 0);
const hasMultiPlatform = (Number(hasFb) + Number(hasGa) + Number(hasTt)) >= 2;
...
{hasFb && hasMultiPlatform && <th>פייסבוק</th>}
{hasGa && hasMultiPlatform && <th>גוגל</th>}
{hasTt && hasMultiPlatform && <th>טיקטוק</th>}
```

---

### MD-10: `BillingCsvImport` `parseShopifyBillsCsv` doesn't normalize Excel-style BOM at start of CSV
**File:** `dashboard-web/src/lib/billing.ts:301-309`
**Severity:** WARNING — Shopify CSV exports from some regions/browsers prepend a UTF-8 BOM (`﻿`). The header parser at line 309:
```typescript
const header = lines[0].split(',').map(h => h.trim().toLowerCase().replace(/^"|"$/g, ''));
```
The first header column becomes `﻿bill number` or similar. `header.findIndex(h => h.includes('bill') && h.includes('number'))` STILL matches because `.includes` finds the substring. But for fields without the search keyword (e.g. `findIndex(h => h.includes('date'))` finds the date column whether or not BOM is present), this is incidentally robust.

**Fix:** Strip BOM defensively:
```typescript
const text = csv.charCodeAt(0) === 0xFEFF ? csv.slice(1) : csv;
const lines = text.split(/\r?\n/).filter(l => l.trim().length > 0);
```

---

### MD-11: `Dashboard.tsx` `aiReportSignal` increments on every Cmd+K Open-AI action — if the user opens AI report multiple times rapidly, the AiReportButton remounts modal state
**File:** `dashboard-web/src/components/Dashboard.tsx:133` + `CommandPalette.tsx:321-324`
**Severity:** WARNING — `setAiReportSignal(n => n + 1)` is a fine pattern, but the consumer presumably uses `useEffect(() => {...}, [openSignal])` to open the modal. Rapid clicks cause rapid remounts. Without seeing `AiReportButton.tsx`, can't verify, but the pattern is fragile.

---

### MD-12: `CommandPalette` `keydown` listener registered globally — fires on top of any modal/drawer, not just when the palette is closed
**File:** `dashboard-web/src/components/CommandPalette.tsx:111-124,387-403`
**Severity:** WARNING — Esc inside the palette correctly closes it, but ArrowDown/ArrowUp/Enter inside the palette fires on its KeyboardEvent listener even when an interior `<input>` (the palette's own search box) is focused. Native browser handling: textarea's arrows move the cursor; the palette's handler ALSO fires `setActiveIdx(...)`. Both happen.

The current arrow handlers DO call `e.preventDefault()` so the cursor move is blocked. So this works correctly for the palette's own search input.

BUT: when the palette is CLOSED, the Esc-key check `if (!open) return` prevents handling. Cmd+K toggles. So when palette is closed, Cmd+K still fires. Good. Wait — the Cmd+K handler doesn't have the `!open` check, only the inner arrow handlers do. That's also fine.

No real bug here on review. Withdraw.

---

### MD-13: `aggregate()` and `aggregateByStore()` accumulate `r.ttSpend ?? 0` but if any single row has `ttSpend = null` (vs undefined), the nullish coalescing differs from `||`
**File:** `dashboard-web/src/lib/analytics.ts:66`
**Severity:** WARNING — `r.ttSpend ?? 0` → `0` when `ttSpend` is null OR undefined. Correct. But there's no validation upstream that `r.ttSpend` is a number when present; if Postgres returns `'10.50'` (string), `'10.50' ?? 0` = `'10.50'`, and `ttSpend += '10.50'` does string concat → `"0010.50"` etc. Defensive `Number(r.ttSpend) || 0` would catch.

---

### MD-14: `operatorReset` `validateResetBody` `confirm` token rejected with key-revealing message
**File:** `dashboard-web/src/lib/operatorReset.ts:113-116`
**Severity:** WARNING — the error message `confirm token missing or incorrect for scope=${scope}` includes the scope. The token itself is NOT echoed (per the comment), but a curl-er can use this message to scope-fingerprint the API: "I tried scope=all, got '...for scope=all'" → confirms scope=all is a valid value.

Not a real security issue (this is URL-obscurity already), but the message could be tighter:
```typescript
return 'confirm token missing or incorrect';   // don't echo scope
```

---

## LOW / INFO (Notes, not bugs)

### IN-01: `CommandPalette` imports `Fragment` from React but never uses it
**File:** `dashboard-web/src/components/CommandPalette.tsx:2-10`
**Severity:** INFO — dead import. Will be flagged by linter but compiles.

### IN-02: `CommandPalette` destructures `activeTab: _activeTab` and never reads it
**File:** `dashboard-web/src/components/CommandPalette.tsx:86`
**Severity:** INFO — the prop is in `Props` but unused in the body. The underscore prefix signals intent ("knowingly unused") but the prop should be removed from the public interface if the palette doesn't need to know the current tab. Right now `Dashboard.tsx:206` still passes it.

### IN-03: `ProductsTable` `localRange` `useEffect` has eslint-disable-next-line for exhaustive-deps
**File:** `dashboard-web/src/components/ProductsTable.tsx:273-276`
**Severity:** INFO — comment says "from/to inputs let the user zoom" but the dep is `[range.from, range.to]` (not just `[range]`). That's correct — comparing primitives avoids re-running on reference change. Disable is intentional and well-commented.

### IN-04: `RefundIndicator` `TOOLTIP_HEIGHT_ESTIMATE = 88` is a hardcoded magic number
**File:** `dashboard-web/src/components/RefundIndicator.tsx:41-43`
**Severity:** INFO — the comment says "px — header + 2 lines + padding". If the tooltip ever gains a third line (e.g. for a "% refund" calc), the auto-flip math at line 56 becomes wrong (won't flip when it should). Add a `// REMINDER` or measure dynamically with `getBoundingClientRect` after first render.

### IN-05: `CommandPalette` `top campaigns` aggregation uses `'today + 30 days'` window — but the comment says "30 days last in last 30 days"
**File:** `dashboard-web/src/components/CommandPalette.tsx:200-210` + `258-268`
**Severity:** INFO — actually the cutoff logic is `cutoff = today - 30 days`, then filter `r.date >= cutoff`. So the comment is correct; just verbose. No bug.

### IN-06: `ResetData` button has Hebrew label "איפוס מלא — מחק את כל הנתונים כולל הוצאות ידניות" with em-dash; copy is fine
**File:** `dashboard-web/src/components/operator/ResetData.tsx:97`
**Severity:** INFO — no issue. Note for translators: the em-dash is U+2014 (—), correct.

### IN-07: `ManualOverridesCrud` `addRow` resets `formState.spend = '0'` after success, but the operator may want to add the same amount across multiple dates
**File:** `dashboard-web/src/components/operator/ManualOverridesCrud.tsx:152`
**Severity:** INFO — UX preference; comment says reset is intentional for "hammer through several rows for the same date / store / platform". Acknowledged trade-off.

### IN-08: `JobsTable` `formatRelative` uses Hebrew but `formatDuration` uses English ("running…", "1.5s", "2.3m")
**File:** `dashboard-web/src/components/operator/JobsTable.tsx:87-93`
**Severity:** INFO — by design per comment ("dir-neutral … digits + Latin units"). UX choice; not a bug.

---

# Per-file Verdict

## Components

### `AdSetTable.tsx`
**Verdict:** OK with caveat. The platform-gate inconsistency with `useCampaignAttribution.ts` (CR-06) means the "ROAS Shopify" column is always blank for TikTok. The `canDrillToAds` logic is correct. Empty-adsets case (no campaign-level only rows) is handled by parent (`CampaignDrawer`) so this component itself doesn't break. Trust chip rendering is byte-identical with parent table — good consistency. **Fix CR-06 before shipping TikTok visibility.**

### `AdsDrawer.tsx`
**Verdict:** OK. The drawer correctly handles empty-ads case (lines 364-373 "אין נתוני מודעות לטווח הזה"). FIX-04 / FIX-07 / FIX-11 inline comments document the 5.2.2.1 review fixes. Has a redundant `rangeFrom`/`rangeTo` in summary dep array (HI-04) — cosmetic. Drilldown works for both Meta and TikTok per Phase 05.7.7/05.7.9 contract.

### `ProductsTable.tsx`
**Verdict:** OK with minor issues. Multi-store productId collision handled via composite key (MD-12 caveat on summary count). Live "today" bucket logic is solid. Range picker auto-swap is well-thought-out. `aggregate` function inside the file is correctly bucketed. **The `summary.productCount` Set uses non-composite key — minor undercount in cross-store views.**

### `ProductChannelBreakdown.tsx`
**Verdict:** **BROKEN.** CR-05 — divides by zero when total === 0. Parent's triple-gate is supposed to prevent this (≥3 orders), but the bar still renders with NaN widths in edge cases (all orders refunded, brand-new mapping with zero matching orders).

### `AttributionAnalysisPanel.tsx`
**Verdict:** OK. FIX-12 (5.2.2.1) clamps bar widths to [0,100], preventing the negative-revenue case. Trust ladder is clean. Recommendation text generation is in the analyzer (not this file), so this component is purely presentational and correct.

### `HealthScorePanel.tsx`
**Verdict:** OK. The `weakest` calculation correctly handles ties (sort stable enough since values are 0-100 integers). Component bars guard against `value < 2` via `Math.max(2, value)` — width never disappears. Recommendation derivation from weakest component is sound logic.

### `InsightsPanel.tsx` (legacy)
**Verdict:** OK. Small, self-contained, no obvious bugs. The `bottom.store !== top?.store` filter prevents the same store appearing twice. **One nit:** the "best day" loop at line 28-39 uses `>` not `>=`, so ties go to the EARLIER date (the first one encountered). Probably fine.

### `BillingCsvImport.tsx`
**Verdict:** OK. The WR-02 fix handles silent store deletion. The CR-01 fix (line 184-202) handles user-driven store changes. Duplicate detection has the matching bug HI-05. Otherwise solid.

### `BillingSettings.tsx`
**Verdict:** OK structurally, but commits the `parseFloat → silently 0` bug (MD-07). The seed-on-hydrate logic (WR2-02) is well-documented and defensive. Detected-plans flow is well-handled.

### `GoalTracker.tsx`
**Verdict:** **BROKEN** for non-"All" store views. CR-04 — goal panel ignores filters.store. Also: incorrect copy ("localStorage only" lie).

### `Filters.tsx`
**Verdict:** OK. Solid component, no significant bugs. `days` calculation is UTC-anchored (no DST issue, since both endpoints anchor at UTC midnight).

### `MonthlyTables.tsx`
**Verdict:** OK with caveats. HI-08 (TZ-off-by-one in `isoMonthsAgo`), MD-09 (`hasGa` gating both FB and Google columns). The own-SWR fetch (WR-09 hotfix) is good — avoids depending on parent's range. Sticky header is correct.

### `PnLBreakdown.tsx`
**Verdict:** **BROKEN MATH** indirectly. The component itself is presentational and renders the `current.fixedCosts` it's given. The bug is upstream (`billingForRange` triples "All" stores per CR-01). Component-local: `TRANSACTION_FEES_RATE` is imported and displayed as static "6.5%" — locks to the global constant despite the audit prompt asking for per-store calibration. Comment at line 225 ("הערכה: 25% מההכנסה") is also locked to the global.

### `RefundIndicator.tsx`
**Verdict:** OK with caveat. CR-08 — hover-leave race on touch and on portal mount. Otherwise nicely engineered (auto-flip, scroll-update, portal escape).

### `CloudSync.tsx`
**Verdict:** OK. 6-line component, just mounts the polling loop. Status indicator is in SyncIndicator (not in scope). The polling interval doesn't visibly back off on errors (each tick fires independently), but that's documented in `cloudSync.ts:hydrateFromCloud` behavior.

### `CommandPalette.tsx`
**Verdict:** OK with minor issues. Dead `Fragment` import (IN-01), dead `_activeTab` prop (IN-02), Cmd+K not guarded against editable fields (HI-10). Otherwise solid.

### `Dashboard.tsx`
**Verdict:** OK structurally. The SWR partial-data case (Q11): if `/api/data` succeeds but `/api/orders-attribution` fails, `ordersData` is undefined → `ordersByStore` defaults to 0 for every store (correctly — line 178-181). If `/api/data` fails, the error banner shows AND the rest of the tab body doesn't render (`{data && filtered && ...}`). Good.

### `operator/TokenFailuresTable.tsx`
**Verdict:** OK. Live polling correct, resolve action correct. No security imports. Hebrew labels consistent.

### `operator/ResetData.tsx`
**Verdict:** OK. Two-step confirmation is sound. Defense-in-depth typed token. SWR mutate on success is well-thought-out.

### `operator/SyncNowButtons.tsx`
**Verdict:** OK. Single `pendingKey` correctly disables all buttons during in-flight POST. Hebrew labels good.

### `operator/BackfillPicker.tsx`
**Verdict:** OK with caveat. HI-03 — UTC "today" instead of IL "today". HISTORY_BOUNDARY duplication is documented and acceptable.

### `operator/JobsTable.tsx`
**Verdict:** OK. SWR pattern correct, server-side proxy gate well-documented. Hebrew + English mix is deliberate. Output payload rendered as raw JSON inside `<pre>` — XSS-safe.

### `operator/ManualOverridesCrud.tsx`
**Verdict:** OK with minor caveat. The delete confirmation modal is good. `parseFloat` of spend in `addRow` is defended by `Number.isFinite` check, unlike `BillingSettings`'s silent-0 fall-through (MD-07).

### `operator/WhatsappTestButtons.tsx`
**Verdict:** OK. Single `pendingKey` correctly disables. Hebrew + English mix consistent with the operator console pattern.

## Lib

### `cloudSync.ts`
**Verdict:** Mostly OK. CR-07 (data-loss race on cross-device clear), MD-01 (dispatchChange unprotected). The immediate-push fix is real and works. Self-healing duplicate handling in `upsertDashboardStateKey` (sheets.ts) is well-thought-out though the Postgres path doesn't have the dup problem to begin with.

### `featureFlags.ts`
**Verdict:** **Dead code.** Per Phase 05.7 cut-over, `readFrom()` is no longer called by any of the 8 data routes (they're all Postgres-only now). The function still exists. **Recommend deletion or marking @deprecated**, otherwise a future contributor will think it's still wired up.

### `billing.ts`
**Verdict:** **BROKEN.** CR-01 (triple-count of "All" stores), HI-05 (asymmetric dup-detect), HI-06 (per-row rounding). The CSV parser is OK. The Shopify plan lookup is a reasonable static table.

### `costs.ts`
**Verdict:** **Mostly dead + lies.** HI-01 (`STORE_FIXED_COSTS` empty for all stores), HI-02 (hardcoded transaction fees + COGS). `monthlyFixedCostsForStore`, `prorateFixedCosts`, `STORE_FIXED_COSTS` all appear unused. `TRANSACTION_FEES_RATE` and `COGS_RATE_OF_REVENUE` (analytics.ts) are imported but never per-store-calibrated.

### `operatorReset.ts`
**Verdict:** OK. Constants + validator, no env vars, no client imports. Defense-in-depth confirmation tokens correct.

### `annotations.ts`
**Verdict:** OK. Cloud-synced via the standard pattern. `annotationsInScope` filter correct. Storage keyed by `STORAGE_KEY` (typed `StateKey`).

### `sheets.ts`
**Verdict:** OK but mostly dead per Phase 05.7. `fetchDailyData`, `fetchStoreMeta`, `fetchDashboardState`, `upsertDashboardStateKey` are all Postgres-replaced. The `isAllowedStateKey` is still consumed by `/api/dashboard-state`. **Recommend extracting `isAllowedStateKey` to its own tiny module and deleting the rest.**

### `sessionKeys.ts`
**Verdict:** OK. One constant, used in one place. Could inline.

### `urlState.ts`
**Verdict:** OK. URL params correctly reflected, parse-out-defaults works. Use of `replaceState` (not `pushState`) is correct.

### `drillFilter.ts`
**Verdict:** OK. Pure function, no surprises. Extracted for testability — good practice.

### `drawerStack.ts`
**Verdict:** OK. Single-listener pattern correct. The hook's dep array `[open, onClose]` means a parent re-rendering with a new `onClose` reference will pop-and-repush. **Note:** the file says "Esc closes ONLY the topmost open drawer" — but `useDrawerEsc` accepts any `onClose` reference change; if the parent uses an inline arrow `onClose={() => setX(false)}`, every render creates a new function and the stack churns. Memoize `onClose` with `useCallback` in callers.

### `presets.ts`
**Verdict:** **BUGGY.** HI-09 (hardcoded `TZ_OFFSET_HOURS = 3` ignores winter DST).

### `useDashboardRefresh.ts`
**Verdict:** **BROKEN.** CR-03 (static cache-bust), MD-04 (no abort on unmount).

### `hooks/useBillingOneTime.ts`
**Verdict:** OK. Self-bounce suppression pattern correct, mirrors `useBillingRecurring`.

### `hooks/useBillingRecurring.ts`
**Verdict:** OK. Same pattern, well-commented.

### `hooks/useCampaignAttribution.ts`
**Verdict:** **BROKEN for TikTok.** CR-06 — hardcoded Meta gate.

### `notifications/tokenFailures.ts`
**Verdict:** OK with caveat. CR-09 (throttle clock not advanced on failed send). Otherwise well-architected: never throws, soft-fails on every internal path, throttles correctly when WhatsApp template is available.

## API Routes

### `api/dashboard-state/route.ts`
**Verdict:** OK. Prototype-pollution defense via `isAllowedStateKey` allowlist. `VALUE_MAX_BYTES` check has minor MD-02 (string length vs UTF-8 bytes). Soft-fail GET pattern correct.

### `api/operator/reset/route.ts`
**Verdict:** OK. Per-table try/catch correct, `userFacingError` sanitization correct, `count: 'exact'` for clear reporting. The "always-true filter" via `.not('store_id', 'is', null)` is well-documented.

### `api/operator/sync-now/route.ts`
**Verdict:** OK. Allowlist validation correct, 202-async contract correct. Hebrew-aware.

### `api/operator/backfill/route.ts`
**Verdict:** OK. Strict YYYY-MM-DD shape check (no `new Date(s)`), history boundary validated, storeIds allowlist enforced.

### `api/operator/manual-overrides/route.ts`
**Verdict:** OK. All 4 verbs validate, sanitize, and case-normalize. PATCH partial-update handling is correct. The DELETE-by-id pattern is fine despite being unconventional (DELETE with body).

### `api/operator/jobs/route.ts`
**Verdict:** OK. N+1 fan-out documented and limit-bounded. Soft-fail 200 pattern. `userFacingError` keeps signing-key prefixes out of client. Per-event failure swallowed correctly.

### `api/operator/token-failures/route.ts`
**Verdict:** OK. Direct `createClient` rather than going through `getSupabaseAdmin` — slight inconsistency with siblings (`/api/operator/reset` uses `getSupabaseAdmin`), but otherwise correct. POST validates provider/store/operation against typed enums.

### `api/operator/notifications/send/route.ts`
**Verdict:** OK. Trigger enum validated, default value handled, 202-async contract correct.

### `api/health/route.ts`
**Verdict:** OK with caveat. MD-03 — hardcoded `sheets: 'ok'` is fragile but documented.

### `api/product-catalog/route.ts`
**Verdict:** OK. Soft-fail pattern, large-response warning at 50k.

### `api/store-meta/route.ts`
**Verdict:** OK. Same pattern as `product-catalog`.

### `api/debug/shopify-fetch/route.ts`
**Verdict:** OK but **security note** — this is a debug endpoint with NO auth and it exposes `tokenPrefix: token.slice(0, 10) + '...'` in the response. A 10-char prefix of a Shopify access token is enough for a determined attacker to do offline cracking. With URL-obscurity as the auth posture, the route URL itself is the secret — but if the URL ever leaks (browser history sync, screenshots, server logs), the token prefix is exposed.

**Fix:** Reduce to first 4 chars or remove the field entirely. Debugging value of a 10-char prefix vs 4-char prefix is marginal; security cost is real.

---

# Cross-cutting Issues

### CC-01: State persistence across page refresh — SWR caches re-hydrate, but localStorage edits made between hydrate and POST can be lost
**Files:** `Dashboard.tsx`, `cloudSync.ts`, `urlState.ts`
**Severity:** WARNING

The dashboard's state restoration on refresh:
1. URL params → initial `activeTab` + `filters` via `readDashboardState` ✓
2. SWR fetches data for the URL-stored range ✓
3. CloudSync component triggers `hydrateFromCloud()` ✓
4. `lastPushAt` is persisted to localStorage (good — the WR2-04 fix) ✓

Failure mode: if the operator EDITS a billing entry, closes the tab BEFORE the 400ms debounce fires, the edit is lost from localStorage (because the debounce timer's callback that calls `pushCloudKey → postWithRetry` never runs). On next mount, hydrate pulls the OLD cloud value and overwrites.

The `immediate: true` flag on `writeProductMap` handles ONE specific case. The same fix is needed for other "discrete save" actions:
- Goal write (`insights.ts:writeGoal`) — operator clicks שמור
- One-time cost write (`writeOneTime`) — operator clicks Save in OneTimeEditForm
- Recurring cost write (`writeRecurring`) — operator clicks Save in RecurringEditForm

**Fix:** Add `{ immediate: true }` to `pushCloudKey` calls from save-button actions. Keep the debounce for fast-typing scenarios (annotation notes mid-edit).

### CC-02: Drawer stack (`drawerStack.ts`) — ESC closes topmost only IF callers memoize `onClose`
**Files:** `drawerStack.ts`, `AdsDrawer.tsx`, `CampaignDrawer.tsx`
**Severity:** WARNING

`useDrawerEsc(open, onClose)` has `[open, onClose]` deps. If the parent passes an inline arrow `onClose={() => close()}`, every parent render creates a new function reference, causing pop-and-repush. The stack churns. Esc still works (always pushes the latest `onClose`), but the abstraction is fragile.

`AdsDrawer.tsx:133` calls `useDrawerEsc(open, onClose)` and `onClose` is a prop (presumably memoized by Dashboard or the parent drawer). Need to verify all callers wrap with `useCallback`.

**Fix:** Either:
- (a) Internally memo the latest `onClose` via a ref so the listener always calls the current handler — eliminates the dep-churn:
```typescript
export function useDrawerEsc(open: boolean, onClose: () => void) {
  const ref = useRef(onClose);
  useEffect(() => { ref.current = onClose; }, [onClose]);
  useEffect(() => {
    if (!open) return;
    const pop = pushDrawer(() => ref.current());
    return pop;
  }, [open]);
}
```
- (b) Audit callers and ensure `useCallback`.

### CC-03: URL state (`urlState.ts`) — back-button restoration uses `readDashboardState` but defaults can override URL
**Files:** `urlState.ts`, `Dashboard.tsx`
**Severity:** OK

The current path: `readDashboardState(defaults, location.search)`. If a param is missing in URL, default is used. If preset is "this_month", `computePresetRange` re-derives from today. That's correct — an old bookmark for "this_month" reflects the current month, per the comment.

But: `replaceState` (not `pushState`) means back-button doesn't go through filter changes. The user can't undo their last "switch to last_30_days" via back. Trade-off documented in the comment as intentional. Acceptable.

### CC-04: Drill filter (`drillFilter.ts`) — consumed by multiple callers, all use same shape
**Files:** `drillFilter.ts`
**Severity:** OK

Tiny pure function. The four-property opts object (`storeId, platform, campaignId, rangeFrom, rangeTo`) is consistent. No issues.

---

# What's Solid

These files were reviewed and found to be free of significant defects:

- `dashboard-web/src/components/AttributionAnalysisPanel.tsx` — pure presentational, FIX-12 width clamping works
- `dashboard-web/src/components/HealthScorePanel.tsx` — recommendation derivation logic sound, color thresholds reasonable
- `dashboard-web/src/components/InsightsPanel.tsx` — small legacy component, no surprises
- `dashboard-web/src/components/Filters.tsx` — solid, no DST issues at this level
- `dashboard-web/src/components/CloudSync.tsx` — minimal, just mounts polling
- `dashboard-web/src/components/operator/*` — overall security posture good, no admin-client leakage, no env-var leakage
- `dashboard-web/src/lib/operatorReset.ts` — pure constants + validator, well-tested by design
- `dashboard-web/src/lib/annotations.ts` — standard cloud-sync pattern
- `dashboard-web/src/lib/sessionKeys.ts` — trivial
- `dashboard-web/src/lib/urlState.ts` — solid, intentional trade-offs documented
- `dashboard-web/src/lib/drillFilter.ts` — pure, tested
- `dashboard-web/src/lib/drawerStack.ts` — design good, fragility documented in CC-02
- `dashboard-web/src/lib/hooks/useBillingOneTime.ts` — same pattern as useBillingRecurring, both solid
- `dashboard-web/src/lib/hooks/useBillingRecurring.ts` — WR-03 self-bounce suppression correct
- `dashboard-web/src/app/api/operator/reset/route.ts` — defense-in-depth confirmation working
- `dashboard-web/src/app/api/operator/sync-now/route.ts` — allowlist enforced
- `dashboard-web/src/app/api/operator/backfill/route.ts` — strict YYYY-MM-DD validation
- `dashboard-web/src/app/api/operator/manual-overrides/route.ts` — 4-verb CRUD with normalization
- `dashboard-web/src/app/api/operator/jobs/route.ts` — N+1 documented, limit-bounded, soft-fail
- `dashboard-web/src/app/api/operator/token-failures/route.ts` — correct enum validation

---

# Recommended Fix Priority

**Must fix this week (data-loss / wrong-numbers user-facing):**
1. CR-01 — `billingForRange` "All" stores triple-count → P&L is wrong
2. CR-02 — `aggregateByStore` ignores range → per-store cards don't match top-level
3. CR-04 — `GoalTracker` ignores store filter → user confusion
4. CR-06 — `useCampaignAttribution` TikTok gate → empty ROAS Shopify column
5. CR-05 — `ProductChannelBreakdown` divide-by-zero → broken UI

**Must fix this sprint:**
6. CR-03 — `useDashboardRefresh` cache-bust → false-positive completion
7. HI-01 / HI-02 — kill dead `STORE_FIXED_COSTS` + ship per-store COGS calibration
8. CR-07 / CR-08 / CR-09 — race / hover / throttle bugs
9. HI-05 — duplicate-detection asymmetry in CSV import

**Sprint-after-next:**
10. MD-07 — silent-zero on parseFloat invalid input
11. MD-09 — `hasGa` gating Facebook column
12. HI-03 — UTC-today vs IL-today in BackfillPicker and ManualOverridesCrud
13. HI-09 — `presets.ts` DST handling
14. CC-01 — apply `immediate: true` to all save-button actions

**Cleanup (when there's time):**
15. IN-01 / IN-02 — dead Fragment import + dead activeTab prop
16. Dead code in `costs.ts` + `featureFlags.ts` + `sheets.ts`
17. MD-03 — deprecate `health.sheets` field

---

_Audit by Claude (Opus 4.7 / 1M ctx), 2026-05-23, deep review pass_
