---
phase: 02-foundations
reviewed: 2026-05-18T00:00:00Z
depth: standard
files_reviewed: 28
files_reviewed_list:
  - dashboard-web/vitest.config.ts
  - dashboard-web/src/lib/__tests__/fixtures.ts
  - dashboard-web/src/lib/__tests__/orderMatchesCampaign.test.ts
  - dashboard-web/src/lib/__tests__/analyzeAttribution.test.ts
  - dashboard-web/src/lib/__tests__/analyzeAttributionForAdSet.test.ts
  - dashboard-web/src/lib/__tests__/analyzeAttributionForAd.test.ts
  - dashboard-web/src/lib/__tests__/analyzeProductChannel.test.ts
  - dashboard-web/src/lib/__tests__/detectOutlierDays.test.ts
  - dashboard-web/src/lib/__tests__/computeWindowStability.test.ts
  - dashboard-web/src/lib/__tests__/utils.test.ts
  - dashboard-web/sentry.client.config.ts
  - dashboard-web/sentry.server.config.ts
  - dashboard-web/sentry.edge.config.ts
  - dashboard-web/instrumentation.ts
  - dashboard-web/src/components/ErrorBoundary.tsx
  - dashboard-web/src/lib/cacheConfig.ts
  - dashboard-web/next.config.ts
  - dashboard-web/src/app/layout.tsx
  - dashboard-web/src/lib/attributionAnalysis.ts
  - dashboard-web/src/lib/utils.ts
  - dashboard-web/src/app/api/data/route.ts
  - dashboard-web/src/app/api/campaigns/route.ts
  - dashboard-web/src/app/api/products/route.ts
  - dashboard-web/src/app/api/ads/route.ts
  - dashboard-web/src/app/api/orders-attribution/route.ts
  - dashboard-web/src/app/api/store-meta/route.ts
  - dashboard-web/src/app/api/product-catalog/route.ts
  - dashboard-web/src/app/api/dashboard-state/route.ts
findings:
  critical: 3
  warning: 7
  info: 9
  total: 19
status: issues_found
---

# Phase 2: Code Review Report

**Reviewed:** 2026-05-18
**Depth:** standard
**Files Reviewed:** 28
**Status:** issues_found

## Summary

Phase 2 adds a Vitest harness (84 tests), Sentry instrumentation, an ErrorBoundary, centralised cache config, row-count guards, and a `safeDecode` utility. The test surface is well-designed (deterministic fixtures, explicit edge cases) and the cacheConfig DRY is clean.

However, multiple **information-disclosure issues** survive in this phase: four API routes (`/api/data`, `/api/campaigns`, `/api/products`, `/api/ads`, `/api/orders-attribution`, `/api/product-catalog`) leak raw error messages directly to the client, exposing spreadsheet IDs, service-account emails, and stack-trace internals — exactly the leak that `/api/store-meta` and `/api/dashboard-state` were carefully sanitising. The ErrorBoundary renders raw `error.message` into the DOM, propagating the same leak into the browser. The Sentry `instrumentation.ts` uses a top-level await that loads `@sentry/nextjs` unconditionally and registers `onRequestError` even when no DSN is set — contradicting the plan's "silent no-op without DSN" claim. There are also unguarded divide-by-zero paths in attribution recommendations (`spend=0` produces "ROAS Infinityx" strings) and NaN-propagation in the Bayesian CI / deterministic revenue sums (inconsistent with `computeWindowStability`, which explicitly guards).

The tests cover the happy paths and the documented edge cases (CR5-01, WR5-04, IN5-02, IN5-03, Pitfall 3) cleanly. No critical bugs in the test logic itself.

## Critical Issues

### CR-01: Raw error messages leaked to client in 6 API routes

**Files:**
- `dashboard-web/src/app/api/data/route.ts:45`
- `dashboard-web/src/app/api/campaigns/route.ts:29`
- `dashboard-web/src/app/api/products/route.ts:29`
- `dashboard-web/src/app/api/ads/route.ts:31`
- `dashboard-web/src/app/api/orders-attribution/route.ts:45`
- `dashboard-web/src/app/api/product-catalog/route.ts:38`

**Issue:** These routes return `err.message` directly in the JSON response body. The codebase establishes in `/api/store-meta/route.ts:11-22` and `/api/dashboard-state/route.ts:21-38` that raw Google API error messages contain the **spreadsheet ID and service-account email** ("Raw messages embed the spreadsheet ID and service account email, neither of which a partner UI user needs to see"). That sanitisation is bypassed in the six routes above.

A failure path on `/api/data` (e.g. expired credentials) returns `{"error": "PERMISSION_DENIED: The caller does not have permission [spreadsheet_id=1abc...XYZ; service_account=foo@bar.iam.gserviceaccount.com]"}` to any unauthenticated browser. This is **information disclosure** equivalent to what `userFacingError()` was written to prevent.

**Fix:** Reuse `userFacingError()` consistently. Extract to a shared helper (e.g. `dashboard-web/src/lib/apiErrors.ts`) and import in all 8 routes:
```ts
// src/lib/apiErrors.ts
export function userFacingError(message: string): string {
  if (/permission|forbidden|403/i.test(message)) return 'הטעינה נכשלה: הרשאות אינן מספיקות.';
  if (/not found|404|Unable to parse range/i.test(message)) return 'הטעינה נכשלה: הגיליון לא נמצא.';
  if (/quota|429|rate ?limit/i.test(message)) return 'הטעינה נכשלה: חרגנו ממכסת Google.';
  if (/Missing GOOGLE_/i.test(message)) return 'הטעינה נכשלה: משתני סביבה חסרים.';
  if (/ENOTFOUND|ECONNREFUSED|fetch failed|network/i.test(message)) return 'הטעינה נכשלה: שגיאת רשת.';
  return 'הטעינה נכשלה: שגיאה לא צפויה.';
}
```
Then in each route:
```ts
} catch (err) {
  const message = err instanceof Error ? err.message : String(err);
  console.error('data fetch failed:', message);  // raw still logged server-side
  return NextResponse.json({ error: userFacingError(message) }, { status: 500 });
}
```

### CR-02: ErrorBoundary renders raw error.message in production DOM

**File:** `dashboard-web/src/components/ErrorBoundary.tsx:39-41`

**Issue:** The fallback UI displays `{this.state.error?.message ?? 'Unknown error'}` in a styled `<p>` tag. An error like `Error: ENOENT: no such file or directory, open '/Users/dorperetz/script-roas/.env.production.local'` or `Error: Cannot read property '...' of undefined at fetchOrdersAttribution (sheets.ts:127:34)` will be rendered to end users, leaking server paths, source-file names, and internal call-site info. React's text-escaping protects against XSS but does NOT prevent information disclosure.

In Hebrew B2B context this leaks implementation details to non-technical operators and (more dangerously) embeds those details in any screenshots/support tickets users share externally.

**Fix:** Show a stable, generic message in production; surface raw `error.message` only when `process.env.NODE_ENV === 'development'`:
```tsx
<p className="text-[11px] text-text-muted font-mono break-all">
  {process.env.NODE_ENV === 'development'
    ? (this.state.error?.message ?? 'Unknown error')
    : 'שגיאה פנימית. נסה לרענן את הדף.'}
</p>
```
Or hide the message entirely in production and only retain the "Try again" / "Reload" buttons.

### CR-03: Divide-by-zero in recommendation strings produces "Infinity" in UI

**Files:**
- `dashboard-web/src/lib/attributionAnalysis.ts:331-332` (campaign-level, medium coverage branch)
- `dashboard-web/src/lib/attributionAnalysis.ts:707-708` (`buildAnalysis`, medium coverage branch)

**Issue:** In the `coverage >= 0.4` branch, the recommendation is built as:
```ts
recommendation =
  `ROAS אמיתי לפי click-id: ${(deterministicRevenue / campaign.spend).toFixed(2)}x. ` +
  `ROAS לפי Meta: ${(campaign.metaClaim / campaign.spend).toFixed(2)}x. ` +
  ...
```
When `campaign.spend === 0`, both divisions evaluate to `Infinity`, and `(Infinity).toFixed(2)` returns the literal string `"Infinity"`. The Bayesian CI gate `if (campaign.spend > 0 && deterministicOrders >= 3)` correctly guards the ROAS interval, but the recommendation string is built outside that gate. The branch is reachable: `coverage >= 0.4` requires `metaClaim > 0` and `deterministicOrders > 0`, but `spend` is never required to be positive. Operator-backfilled or attribution-only campaigns can satisfy this.

End-user impact: tooltips render "ROAS אמיתי לפי click-id: Infinityx. ROAS לפי Meta: Infinityx." — a user-visible defect.

**Fix:** Guard the spend ratio when building the recommendation, or skip the ROAS string entirely when `spend === 0`:
```ts
} else if (coverage >= 0.4) {
  const pct = Math.round(coverage * 100);
  const modeledPct = Math.round((modeledRevenue / campaign.metaClaim) * 100);
  trust = { level: 'medium', label: 'חלקי', score: 40 + pct / 2 };
  reasons.push(`${pct}% מההמרות תויגו (${deterministicOrders} הזמנות, CAD ${deterministicRevenue.toFixed(0)})`);
  reasons.push(`${modeledPct}% modeled — Meta מייחס בלי click-id`);
  if (campaign.spend > 0) {
    recommendation =
      `ROAS אמיתי לפי click-id: ${(deterministicRevenue / campaign.spend).toFixed(2)}x. ` +
      `ROAS לפי Meta: ${(campaign.metaClaim / campaign.spend).toFixed(2)}x. ` +
      `הפער מעיד על modeled — הימנע מהחלטות אגרסיביות; הסתכל גם על הטרנד.`;
  } else {
    recommendation =
      `${pct}% מההמרות תויגו אבל אין הוצאה לחשב ROAS. הפער מעיד על modeled.`;
  }
}
```
Apply the same guard in `buildAnalysis` lines 706-708.

## Warnings

### WR-01: instrumentation.ts top-level await loads Sentry unconditionally

**File:** `dashboard-web/instrumentation.ts:10`

**Issue:** The line
```ts
export const onRequestError = (await import('@sentry/nextjs')).captureRequestError;
```
executes a top-level await at module-load time. It always imports `@sentry/nextjs` and exports `captureRequestError` regardless of runtime, regardless of DSN presence. This contradicts the plan's stated guarantee ("Silent no-op in localhost — no warnings, no logs"): on every request error in localhost, Next.js will invoke `onRequestError` and Sentry's `captureRequestError` will run even though `Sentry.init` was never called. The behaviour is not deterministic-noop in all Sentry SDK versions — some emit warnings, some silently drop, but it is NOT zero-overhead as claimed.

Additionally, top-level await binds the lifecycle of `instrumentation.ts` to module-load completion of `@sentry/nextjs`. If the package is missing or fails to load, the entire instrumentation module fails — making Next.js unable to register.

**Fix:** Make `onRequestError` a proper async function that lazy-imports and DSN-gates:
```ts
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    await import('./sentry.server.config');
  }
  if (process.env.NEXT_RUNTIME === 'edge') {
    await import('./sentry.edge.config');
  }
}

export async function onRequestError(
  err: unknown,
  request: Parameters<NonNullable<typeof import('@sentry/nextjs').captureRequestError>>[1],
  context: Parameters<NonNullable<typeof import('@sentry/nextjs').captureRequestError>>[2],
) {
  if (!process.env.SENTRY_DSN && !process.env.NEXT_PUBLIC_SENTRY_DSN) return;
  const { captureRequestError } = await import('@sentry/nextjs');
  return captureRequestError(err, request, context);
}
```

### WR-02: `analyzeAttribution` and `buildAnalysis` propagate NaN through totalCad sums and Bayesian CI

**Files:**
- `dashboard-web/src/lib/attributionAnalysis.ts:194` (campaign-level `deterministicRevenue`)
- `dashboard-web/src/lib/attributionAnalysis.ts:216-219` (campaign-level Bayesian CI)
- `dashboard-web/src/lib/attributionAnalysis.ts:641` (`buildAnalysis` deterministicRevenue)
- `dashboard-web/src/lib/attributionAnalysis.ts:651-653` (`buildAnalysis` Bayesian CI)

**Issue:** `matchedOrders.reduce((s, o) => s + o.totalCad, 0)` does NOT guard against `NaN`. A single order with `totalCad: NaN` (which can happen if Apps Script writes a malformed cell, or if a downstream parser yields NaN) corrupts the entire sum to NaN. From there, `coverage = NaN / metaClaim = NaN`, `coverage >= 0.4` is `false`, but `coverage === 0` is also `false` — the function falls through trust ladders unpredictably.

`computeWindowStability` on line 431 (`if (!Number.isFinite(o.totalCad)) continue;`) explicitly guards against this. The campaign-level path does not. **Inconsistent defensive coding.**

The Bayesian CI calculation (line 217 `const meanAov = aovs.reduce(...) / aovs.length`) is similarly vulnerable — if any AOV is NaN, mean → NaN, variance → NaN, `variance === 0` is false, and the function emits NaN-bounded `roasInterval`.

**Fix:** Add `Number.isFinite` filters before the reduces:
```ts
const matchedOrders = orders.filter(o => {
  if (o.date < dateFrom || o.date > dateTo) return false;
  if (!Number.isFinite(o.totalCad)) return false;  // <-- add
  return orderMatchesCampaign(o, campaign);
});
```
Or at the reduce site:
```ts
const deterministicRevenue = matchedOrders.reduce(
  (s, o) => Number.isFinite(o.totalCad) ? s + o.totalCad : s,
  0,
);
```
Apply consistently to `buildAnalysis` as well.

### WR-03: Sentry session-replay records 100% of error sessions with no consent gate

**File:** `dashboard-web/sentry.client.config.ts:8,11-13`

**Issue:** `replaysOnErrorSampleRate: 1.0` combined with `Sentry.replayIntegration({ maskAllText: true, blockAllMedia: true })` means every error session is recorded and uploaded to Sentry. While the masking flags hide visible text and media, session replay still captures DOM mutations, click coordinates, keystrokes on un-masked inputs, scroll behaviour, and full URL paths (including query strings containing UTM identifiers, store IDs, and date ranges). In an EU/Canada B2B context this is likely PII processing requiring user consent.

The masking is also incomplete: `maskAllText: true` masks text NODES, but Hebrew text rendered via aria-labels and `title` attributes may be captured raw depending on SDK version. Numeric data shown via `Intl.NumberFormat('he-IL')` (CAD revenue figures) is rendered as text and gets masked — but if you ever surface those via tooltips with `dangerouslySetInnerHTML`-equivalent paths, masking can leak.

**Fix:** Drop `replayIntegration` until a privacy-policy / consent UX is in place; or lower `replaysOnErrorSampleRate` to a small value (0.05) and add a documented consent mechanism. At minimum, document the privacy implications in `README.md`:
```ts
// Drop integrations entirely:
Sentry.init({
  dsn,
  tracesSampleRate: 0.1,
  environment: process.env.NODE_ENV,
  // No replay integration — error context comes from breadcrumbs only.
});
```

### WR-04: `/api/dashboard-state` POST validates key but not value

**File:** `dashboard-web/src/app/api/dashboard-state/route.ts:65-82`

**Issue:** The route validates `body.key` against `isAllowedStateKey()` (good, prevents prototype-pollution and key-injection), but `body.value` is accepted as `unknown` and passed verbatim to `upsertDashboardStateKey(body.key, body.value ?? null)`. No type, size, or shape validation. A client can POST `{ key: "<some-allowed-key>", value: <huge-deeply-nested-object> }` or a value containing reserved keys (`__proto__`, `constructor`) inside arbitrary nesting. Defense depends entirely on what `upsertDashboardStateKey` does (likely `JSON.stringify` and write to a cell). If it serialises a value containing functions or circular refs, the call will throw inside the try block and at least reach the catch — but a value bombing the sheet write with `[1MB string]` is a write-time denial of service.

Without seeing the implementation, this is a **input-validation gap**.

**Fix:** Add a value-size / shape guard:
```ts
const VALUE_MAX_BYTES = 64_000; // per-cell roughly
const valStr = JSON.stringify(body.value ?? null);
if (valStr.length > VALUE_MAX_BYTES) {
  return NextResponse.json({ error: 'value too large' }, { status: 413 });
}
```
And ideally schema-check the value per allowed key (e.g., the `storeOverrides` key gets a different shape than `selectedStores`).

### WR-05: `revalidate: 10` on `/api/dashboard-state` may exceed Google quota on multi-tab partners

**File:** `dashboard-web/src/lib/cacheConfig.ts:20`

**Issue:** `dashboardState: { revalidate: 10, swr: 60 }` sets a 10-second ISR window. With 3 partners each on 2 tabs polling at SWR's default `dedupingInterval`, and Vercel's edge fan-out, the underlying `fetchDashboardState` could be hit 6×/minute × N edge nodes = >60 reads/minute. Google Sheets quota per-project is 60 reads/minute by default. The plan says "5-minute cache" for ordersAttribution (300s) to "burn Sheets quota", but the 10s revalidate here is the inverse principle.

The comment claims "SWR will dedupe in-browser; this just lets the CDN coalesce bursts" — but CDN coalescing only dedupes within the s-maxage window (10s), not the swr window (60s).

**Fix:** Either raise `revalidate` to at least 30s, or document an upper-bound on concurrent partners. Given dashboard-state changes are user-driven (no background mutation), a `revalidate: 30` with `swr: 120` would still feel instant but cuts read pressure to 2/minute.

### WR-06: `/api/data` returns status 500 on failure; other routes degrade with status 200

**Files:**
- `dashboard-web/src/app/api/data/route.ts:45` (returns 500)
- `dashboard-web/src/app/api/campaigns/route.ts:29` (returns 500)
- `dashboard-web/src/app/api/products/route.ts:29` (returns 500)
- vs.
- `dashboard-web/src/app/api/ads/route.ts:31` (returns 200 + empty rows)
- `dashboard-web/src/app/api/orders-attribution/route.ts:47` (returns 200 + empty rows)
- `dashboard-web/src/app/api/store-meta/route.ts:45` (returns 200 + empty rows)
- `dashboard-web/src/app/api/product-catalog/route.ts:38` (returns 200 + empty rows)

**Issue:** Status-code inconsistency for the same failure class (Google Sheets read fails). The 200-with-empty-rows pattern is well-justified ("Degrade gracefully — empty array lets the AdsDrawer show an 'no data' state instead of crashing") and the comment in each says so. But `/api/data`, `/api/campaigns`, `/api/products` return 500 without similar fallback — which means SWR's default error logic fires for some routes and not others, producing **inconsistent UI behaviour** when Sheets is down.

**Fix:** Pick one strategy and apply uniformly. Recommended: every read route returns `{rows: [], error: userFacingError(msg)}` with status 200 (or 503 with the same body if you want SWR to retry). The dashboard then renders consistently with "no data" placeholders across all surfaces during a Sheets outage.

### WR-07: `analyzeAttribution.ts` outlier detection skips zero-value baseline days, masking real spikes

**File:** `dashboard-web/src/lib/attributionAnalysis.ts:487`

**Issue:** `const vals = trail.map(p => p.value).filter(v => Number.isFinite(v) && v > 0);` filters baseline days where Meta reported value=0. Consequence: a campaign that had $0 conversions for days 1-13 then a $500 spike on day 14 will compute trail vals=[] (all zeros filtered), `vals.length < 5` returns early, and the spike is **never flagged as an outlier**. This is the exact scenario the docstring describes ("Days where Meta's daily conversion value was an outlier (>2.5σ above the campaign's own trailing mean)") — but the implementation skips it.

A user with a low-activity campaign that suddenly spikes (the most operationally important signal) gets no spike detection.

**Fix:** Drop the `> 0` filter, keeping only the `Number.isFinite` guard. Or document the intent if zero-day exclusion is deliberate:
```ts
const vals = trail.map(p => p.value).filter(v => Number.isFinite(v));
if (vals.length < 5) continue;
```
Note: this still keeps the `stdDev === 0` skip on line 493 — uniform-zero baseline still won't flag a spike (correct behaviour: a single non-zero day vs all zeros is undefined-z-score).

## Info

### IN-01: `computeWindowStability` returns `windowCount: coverages.length` (filtered count) but local var named identically

**File:** `dashboard-web/src/lib/attributionAnalysis.ts:418-458`

**Issue:** Line 418 computes `windowCount` as `fullWindows + (tailDays >= 3 ? 1 : 0)` — the total bucket count. Line 458 returns `windowCount: coverages.length` — the count of windows where meta>0 (filtered count). Two different concepts share the same name. The type doc says "Number of 7-day windows analysed" — ambiguous between total vs analysed-with-data. The tests on lines 62/78 of `computeWindowStability.test.ts` happen to work because all test windows have meta data.

**Fix:** Rename to clarify intent. Either return both (`totalWindows` and `analysedWindows`) or rename the field to `windowCountAnalysed` / `windowCountWithData`.

### IN-02: Test description in `detectOutlierDays.test.ts:60-76` ("~1.5σ") is computed against full-series stats, not trailing-window stats

**File:** `dashboard-web/src/lib/__tests__/detectOutlierDays.test.ts:60-76`

**Issue:** The test pre-computes `mean` and `stdDev` over the 13 base values, then asserts that a `Math.round(mean + 1.5 * stdDev)` value is below the 2.5σ threshold. But the `detectOutlierDays` function computes the z-score against the **trailing window** (last LOOKBACK values), not the full series. With sorted.length=14 and LOOKBACK=7, the trail is only 7 of the 13 base values, with a different mean/stdDev. The test passes because 1.67σ-against-trail is also < 2.5, but the test narrative is misleading. Future readers expanding the test may be surprised.

**Fix:** Recompute `mean` and `stdDev` over the slice that the function will use as the trail (the last LOOKBACK values), or document the discrepancy.

### IN-03: `vitest.config.ts` includes only `.test.ts` files, excludes `.test.tsx`

**File:** `dashboard-web/vitest.config.ts:7`

**Issue:** `include: ['src/lib/__tests__/**/*.test.ts']` — any future React component test (.tsx) in `__tests__/` will be silently skipped. The plan documents this is intentional for Phase 2 (pure functions only), but a future maintainer adding a hook test in `.tsx` will see "0 tests run for new file" with no error.

**Fix:** Either widen to `['src/lib/__tests__/**/*.test.{ts,tsx}']` and switch `environment` to `jsdom` when needed, or add a comment forbidding `.tsx` tests at this path. A jsdom config for component tests should live in a separate vitest project / second config rather than re-running pure-function tests in jsdom.

### IN-04: `next.config.ts` retains unused `experimental.serverActions.bodySizeLimit`

**File:** `dashboard-web/next.config.ts:6-8`

**Issue:** No file in the project uses Server Actions; all mutations go through `route.ts` POST handlers (which honour `experimental.serverActions.bodySizeLimit` only for Server Actions, not for route handlers — those use a separate request-body limit). This config is dead.

**Fix:** Remove the `experimental.serverActions` block until Server Actions are introduced. To set request-body limits on POST routes, use a body-size check inside the handler (see WR-04).

### IN-05: Recommendation label-switch ternary repeated 2× in `buildAnalysis`

**File:** `dashboard-web/src/lib/attributionAnalysis.ts:686,689`

**Issue:** The pattern `opts.label === 'ad' ? 'מודעה' : opts.label === 'ad-set' ? 'ad-set' : 'קמפיין'` appears twice in adjacent lines (686 brand-awareness recommendation, 689 not-running recommendation). Easy to drift if a third Hebrew translation is added.

**Fix:** Hoist to a local const:
```ts
const hebLabel = opts.label === 'ad' ? 'מודעה' : opts.label === 'ad-set' ? 'ad-set' : 'קמפיין';
```

### IN-06: Inconsistent `force-dynamic` across API routes

**Files:**
- `/api/data/route.ts:9` — has `export const dynamic = 'force-dynamic';`
- `/api/campaigns/route.ts:6` — has `force-dynamic`
- `/api/products/route.ts:6` — has `force-dynamic`
- `/api/ads/route.ts` — no `force-dynamic` (only `revalidate`)
- `/api/orders-attribution/route.ts` — no `force-dynamic`
- `/api/store-meta/route.ts` — no `force-dynamic`
- `/api/product-catalog/route.ts` — no `force-dynamic`
- `/api/dashboard-state/route.ts:14` — explicit comment that `force-dynamic` was removed

**Issue:** Mixing `force-dynamic` with `revalidate` is documented in Next.js as the former overriding the latter — meaning `/api/data` and `/api/campaigns` may not honour their `revalidate` numbers. The `/api/dashboard-state` comment says force-dynamic "conflicted with that header" and was removed; the same logic should apply to the other three. This is an architectural inconsistency introduced before this phase but uncorrected during the cacheConfig refactor.

**Fix:** Remove `force-dynamic` from `/api/data`, `/api/campaigns`, `/api/products` if you want `revalidate + Cache-Control` to apply. Audit downstream — if anything depended on these being fully dynamic, fix the downstream caller instead.

### IN-07: `safeDecode` is preemptively added with no call sites

**File:** `dashboard-web/src/lib/utils.ts:38-61`

**Issue:** The docstring acknowledges "No existing call sites in dashboard-web at Phase 2 task time (grep confirmed 0)". Adding utilities without immediate use risks bit-rot — the contract may drift before first caller arrives in Phase 5. Tests are good (8 cases) but unit-test-only coverage doesn't catch integration mismatches.

**Fix:** Either defer until Phase 5 actually uses it, or add an inline comment with a dated TODO referencing the planned consumer:
```ts
/** TODO(phase-5): wire into useSearchParams() for UTM param surfaces. */
```
This is documentation hygiene, not a defect.

### IN-08: `/api/dashboard-state` GET returns status 200 with `kv: {}` on failure (no `lastUpdated`)

**File:** `dashboard-web/src/app/api/dashboard-state/route.ts:59`

**Issue:** Success path returns `{kv, updatedAtByKey, lastUpdated}`. Error path returns `{kv: {}, error}` — missing `updatedAtByKey` and `lastUpdated`. If a consumer reads `response.lastUpdated` and feeds into a `new Date()` or `formatDate()`, the result is `undefined → Invalid Date`. The `/api/orders-attribution` route specifically fixed this same issue (line 38-46 comment: "lastUpdated is included so the response shape satisfies the declared type — a consumer reading `data.lastUpdated` on the error path now gets a valid ISO timestamp instead of `undefined` (which would crash downstream Date()/formatDate)"). dashboard-state is inconsistent.

**Fix:** Add `lastUpdated: new Date().toISOString()` and `updatedAtByKey: {}` to the catch return shape.

### IN-09: `computeWindowStability` test "returns null when coverages.length < 2" misleadingly named

**File:** `dashboard-web/src/lib/__tests__/computeWindowStability.test.ts:29-41`

**Issue:** Test name says "single window with meta data" — but the setup creates **two** windows (14-day range), only the first has meta data, so the filter drops to 1 coverage entry. The name suggests one window total; in reality two windows exist and one is filtered. Cosmetic clarity issue.

**Fix:** Rename test to "returns null when only one window has meta data (other has zero meta)" or restructure with a comment block before the test explaining the geometry.

---

_Reviewed: 2026-05-18_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
