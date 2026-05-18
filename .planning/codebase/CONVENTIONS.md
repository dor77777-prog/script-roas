# Coding Conventions

**Analysis Date:** 2026-05-18

This document is prescriptive: it describes the conventions that future code
in this repo MUST follow. Every rule below is anchored to existing files —
follow those examples when adding new code.

## Languages In Play

Two layers, two language flavours — same conventions where possible, but not
identical:

| Layer | Language | Style |
|-------|----------|-------|
| Dashboard | TypeScript (`strict: true`) + React 19 + Next.js 15 | Modern ES, types preferred over runtime guards |
| Apps Script (backend) | Google Apps Script JS (V8) | ES6+, but no TS, no npm — heavier inline defensiveness |

When something is layer-specific, it's labelled below.

## Naming Patterns

**Files (TypeScript):**
- React components: `PascalCase.tsx` — `CampaignsTable.tsx`, `CampaignDrawer.tsx`, `SyncIndicator.tsx`
- Libraries / helpers: `camelCase.ts` — `attributionAnalysis.ts`, `cloudSync.ts`, `campaignProductMap.ts`
- Single-purpose per file (one big exported component or one cohesive helper module)
- Co-located by concern, not by type — `lib/` for pure helpers, `components/` for React, `app/api/` for routes

**Files (Apps Script):**
- `PascalCase.gs` per topical area: `Config.gs`, `DailyUpdate.gs`, `SheetBuilder.gs`, `Shopify.gs`, `MetaAds.gs`, `GoogleAds.gs`, `FX.gs`, `ManualOverrides.gs`, `Main.gs`
- One file per integration / concern

**Functions:**
- TypeScript: `camelCase` exports — `analyzeAttribution`, `orderMatchesCampaign`, `pushCloudKey`, `hydrateFromCloud`
- React components: `PascalCase` — `CampaignDrawer`, `BillingSettings`, `SyncIndicator`
- Apps Script private helpers: `camelCase_` trailing underscore — `safeDecode_`, `parseYMD_`, `round2_`, `classifyOrderAttribution_`, `computeLineItemsCad_`, `getLayout_`, `summaryFormulasForRow_`
- Apps Script public entry points (callable from triggers / editor): no trailing underscore — `runDailyUpdate`, `runLiveUpdate`, `runUpdateForDate`, `verifyConfig`, `resetSpreadsheetIdToKnownGood`
- The trailing `_` convention is load-bearing on Apps Script: only no-underscore functions appear in the editor's "Run" menu and trigger picker. Keep this distinction strict.

**Variables:**
- `camelCase` throughout, both layers
- Hebrew strings are LABEL VALUES (`'אמין'`, `'אין המרות'`, `'הוצאה CAD ...'`), never identifiers
- Constants: `UPPER_SNAKE` at module scope — `STATE_KEYS`, `STORE_TAB_CONFIG`, `STORES`, `TZ`, `SUMMARY_TAB`, `HYDRATE_GRACE_MS`, `FROZEN_USD_TO_CAD`, `COGS_RATE_OF_REVENUE`, `META_API_VERSION`

**Types (TypeScript-specific):**
- Always `type X = {...}`, never `interface` — `AttributionAnalysis`, `OrderAttributionRow`, `SyncState`, `RecurringCost`, `DailyRow`, `DateRange`, `Filters`, `ProductChannelBreakdown`
- Union types over enums — `type OrderSource = 'meta-paid' | 'google-paid' | ...`, `type Severity = 'critical' | 'warning' | ...`, `type SyncStatus = 'idle' | 'syncing' | 'ok' | 'error'`
- Type aliases live next to the function they describe — `analyzeAttribution` returns `AttributionAnalysis` declared 145 lines above in the same file (`src/lib/attributionAnalysis.ts:23-72`)

**Composite Keys:**
- Pattern: `${a}::${b}` — `${storeId}::${campaignId}` from `campaignKey()` (`src/lib/campaignProductMap.ts:28-30`)
- Extended for nesting: `${storeId}::${platform}::${campaignId}::${adSetId}::${adId}` (`AdsDrawer.tsx:381`)
- Use double-colon to make split/regex unambiguous and to visually distinguish from single-colon path keys (`roas-dashboard:billing-recurring`)

**localStorage / Cloud Keys:**
- Prefix `roas-dashboard:` — `roas-dashboard:billing-recurring`, `roas-dashboard:annotations`, `roas-dashboard:monthly-revenue-goal`, `roas-dashboard:insight-states`, `roas-dashboard:campaign-optimized`, `roas-dashboard:campaign-product-map`
- One canonical list: `STATE_KEYS` in `src/lib/cloudSync.ts:47-55` — adding a key REQUIRES touching this constant; the type system enforces sync coverage
- Custom event names: `roas-{topic}-changed` — `roas-billing-changed`, `roas-annotations-changed`, `roas-campaign-optimized-changed`, etc. Listed centrally in `CHANGE_EVENTS` (`cloudSync.ts:58-66`)

## TypeScript Conventions

**`strict: true`** (`dashboard-web/tsconfig.json`). All conventions below
flow from that.

**No `any`. Period.**
- Use `unknown` at parse boundaries (`parseNumber(v: unknown)`, `parseDate(v: unknown)`, `parseSource(v: unknown)`, `parseLineItems(v: unknown)` in `src/lib/ordersAttribution.ts`, `src/lib/sheets.ts`)
- Narrow with type guards: `if (typeof v === 'string') ...`, `if (Array.isArray(parsed)) ...`
- For type-cast fallbacks, document WHY:
  ```ts
  return s as OrderSource;  // src/lib/ordersAttribution.ts:136 — see IN5-06 doc above
  ```

**`type X = {...}`, NOT `interface`.**
Repo-wide convention. Helps consistency and avoids declaration merging
surprises. There are zero `interface` declarations in `src/lib/` or
`src/components/`.

**Strict null handling via `?? ''` / `?? 0` / `?? []` defaults at the read boundary:**
```ts
// src/lib/ordersAttribution.ts:215-233
const orderId = String(row[1] ?? '').trim();
...
utmSource: String(row[4] ?? '').trim(),
fbclidPresent: row[8] === true || String(row[8] ?? '').toUpperCase() === 'TRUE',
```

**No truthy checks for numbers — use `Number.isFinite`:**
```ts
// src/lib/attributionAnalysis.ts:408, 425, 440, 487, 494
if (!Number.isFinite(fromMs) || !Number.isFinite(toMs)) return null;
if (!Number.isFinite(o.totalCad)) continue;
if (!Number.isFinite(p.value)) continue;     // IN5-04 fix — explicit reject
```
This guards against NaN from upstream divide-by-zero in derived metrics. A
filter like `b.meta > 0` excluding NaN works incidentally but is fragile —
prefer the explicit `Number.isFinite` guard.

**`satisfies` for API response shape enforcement:**
```ts
// src/app/api/orders-attribution/route.ts:21
return NextResponse.json(
  { rows, lastUpdated: new Date().toISOString() } satisfies OrdersAttributionResponse,
  { headers: { 'Cache-Control': '...' } },
);
```
Error paths must satisfy the same type — see WR5-05 fix. The `error?: string`
field is optional on the type so degraded responses can carry the message
without losing shape compliance.

**Discriminated objects over flag soup:**
```ts
// src/lib/attributionAnalysis.ts:67-72
export type AttributionTrust = {
  level: 'high' | 'medium' | 'low' | 'unknown';
  label: string;
  score: number;
};
```
The `level` is the discriminant; downstream UI keys backgrounds + chips off it.

## File Organization

**One responsibility per file:**
- `attributionAnalysis.ts` — analytic engine, three sibling exports
  (`analyzeAttribution`, `analyzeAttributionForAdSet`, `analyzeAttributionForAd`)
  plus a fourth with deliberately different shape (`analyzeProductChannel`,
  see comment at line 748-763 explaining why coverage/trust don't apply)
- `ordersAttribution.ts` — sheets fetch + per-row parsing for one tab family
- `cloudSync.ts` — localStorage ↔ Google Sheet sync engine, all key
  registration in `STATE_KEYS`
- `campaignProductMap.ts` — the storage adapter AND the allocation algebra
  for a single concern (campaign↔product mapping)

**Component files (React):**
- One component per file. The file name = component name
- Sub-components for sort headers, drawers-within-drawers, etc. live in the
  same file ONLY if they're not reused elsewhere (see
  `AdSortHeader` inside `AdsDrawer.tsx`)

**Libs grouped by concern, NOT by type:**
- `lib/` has no `types.ts` for shared types — types live with the functions
  that produce/consume them
- `lib/types.ts` exists but holds only the very top-level
  data shapes (`DailyRow`, `DashboardData`, `DateRange`, `PresetKey`,
  `Filters`) — these are imported widely so deserve a central home
- More specific types (`CampaignRow`, `ProductRow`, `Insight`, `Aggregate`)
  live in `campaigns.ts`, `products.ts`, `insights.ts`, `analytics.ts`
  respectively

**No barrel files / `index.ts`:**
Imports always reach into the specific module:
```ts
import { analyzeAttribution } from '@/lib/attributionAnalysis';
// NOT: import { analyzeAttribution } from '@/lib';
```

## Comment Style: "WHY, not WHAT"

The dominant convention in this repo. Code says what; comments say why.

**Heavy comments on architectural decisions:**
- `src/lib/attributionAnalysis.ts:1-19` — opening docstring explains the
  whole "deterministic vs modeled" mental model the analyzer encodes
- `src/lib/attributionAnalysis.ts:74-91` — `orderMatchesCampaign` explains
  the Tier 1 (utm_id) → Tier 2 (utm_campaign) match strategy and the
  CR5-01 reason for NOT falling through on a Tier 1 mismatch
- `src/lib/attributionAnalysis.ts:202-213` — Bayesian CI explanation
  describes WHY normal approximation is good enough vs full Wilson
- `SheetBuilder.gs:1539-1542` — Phase 1 migration note explains how two
  idempotent migration blocks (lastCol<13 and lastCol<14) coexist
- `Config.gs:14-19` — COGS_RATE_OF_REVENUE comment includes a
  cross-layer sync warning (parallel constant in
  `dashboard-web/src/lib/analytics.ts:11`)
- `Shopify.gs:651-658` — `safeDecode_` exists ONLY because of CR5-02; the
  one-line docstring captures the failure mode it prevents
- `DailyUpdate.gs:37-42` — `Utilities.sleep(1500)` between stores carries
  ~3 lines of comment explaining the quota cascade it fixes

**Comments reference review codes when the code is shaped by a review fix:**
Examples: `(IN5-02)`, `(IN5-03)`, `(IN5-04)`, `(IN5-05)`, `(WR2-01)`,
`(WR2-04)`, `(WR-01)`, `(WR-02)`, `(#IN-03)`. These tags trace back to
`.planning/reviews/REVIEW-N.md` so future readers can find the original
issue.

**Light comments on routine code:**
Trivial loops, simple maps, JSX rendering get no comments. The function
docstring covers intent; the body is self-documenting.

**Apps Script: Hebrew + English mixed:**
- Module docstrings often Hebrew (`SheetBuilder.gs:1-13`,
  `DailyUpdate.gs:1-8`, `Config.gs:1-5`) — these document business intent
  to the operator, not English-only Claude
- Function-level WHY comments are English (post-Round-N reviews) — they
  document engineering reasoning
- Both are valid in the same file. Don't translate either when editing
  unless asked

## Defensive Coding Patterns

**Parsing input boundaries: never throw, always degrade:**
- `parseLineItems` (`src/lib/ordersAttribution.ts:153-175`) — try/catch
  around `JSON.parse`, filters elements aggressively, returns `[]` on any
  failure. Defaults to `[]` rather than `null` so callers iterate without
  null-guards (the "Claude's Discretion" call documented in the JSDoc)
- `parseSource` (`src/lib/ordersAttribution.ts:133-137`) — permissive cast
  with documented fallback for future Apps Script source kinds
- `parseDate` (`src/lib/ordersAttribution.ts:106-121`) — handles Sheets
  serial numbers, ISO strings, and DD/MM/YYYY strings, returns `null`
  on unrecognised input
- `readProductMap` (`src/lib/campaignProductMap.ts:32-50`) — JSON.parse +
  shape validation + per-entry filter; returns `{}` on any anomaly
- `readOptimized` (`src/lib/campaignOptimized.ts:20-31`) — same shape,
  returns `new Set()` on failure
- `safeReadArray` (`src/lib/billing.ts:61-71`) — generic skeleton other
  read paths often inline

**Apps Script: try/catch around every section in `updateStoreForDate_`:**
Each subsystem in `DailyUpdate.gs:74-192` is wrapped:
```js
try {
  updateCampaignDataForStoreDate_(ss, store, dateStr, ilsToCad);
} catch (e) {
  Logger.log(`Campaign-level data for ${store.name} ${dateStr} failed: ${e && e.message ? e.message : e}`);
}
```
The pattern: log to `Logger.log` with the `failed (non-fatal)` marker, then
continue. The day's daily-row write succeeds even if campaigns / ads /
products / orders-attribution fails. Operators see the failure in
Executions, the dashboard sees stale-but-coherent data.

**`Object.create(null)` for plain maps:**
```js
// Shopify.gs:688 — IN5-05 fix
const params = Object.create(null);
```
Used when keys come from external input (note_attributes, UTM params) so
inherited methods like `hasOwnProperty` / `toString` / `__proto__` can't
collide. Defensive — not security-critical here because values are coerced
to `String`, but the lookup-correctness argument is the same.

**`setNumberFormat('@')` on long-ID columns (Apps Script):**
```js
// SheetBuilder.gs:1019, 1158, 1351, 1616, 1617, 1621
sh.getRange(2, 2, combined.length, 1).setNumberFormat('@');   // Order ID
sh.getRange(2, 12, combined.length, 2).setNumberFormat('@');  // UTM ID + UTM Term
sh.getRange(2, 14, combined.length, 1).setNumberFormat('@');  // Line Items (JSON)
```
Meta IDs are 17–19 digits, outside JS double-precision integer range.
Without `'@'` (text format) Sheets reformats them to scientific notation
and corrupts the value on round-trip. Format MUST be set BEFORE
`setValues`.

**Idempotent writes (clear-then-write per date):**
The pattern, applied to every per-day Sheets writer:
1. Read all existing rows below header
2. Filter to keep rows where the date column parses AND `!== dateStr`
3. Concat new rows for `dateStr` to the kept set
4. Clear the whole data range
5. `setValues` once with the combined block
6. Apply format on the whole block

Examples: `writeCampaignRowsForDay` (`SheetBuilder.gs:725`),
`writeAdsRowsForDay` (`SheetBuilder.gs:1200+`),
`writeOrdersAttributionForDay` (`SheetBuilder.gs:1565`),
`writeProductSalesForDay_` (`SheetBuilder.gs:1340+`).

Two notes baked into the convention:
- **Preserve unparseable dates** (don't drop `key === null` rows) — see
  WR5-02 fix at `SheetBuilder.gs:748-753`. Returning `key !== dateStr`
  (not `key !== dateStr && key !== null`) preserves rows where a previous
  write crashed mid-format. Operator can manually fix; we never silently
  destroy data we don't recognise.
- **Single `setValues` per call** — batched writes are ~10× faster than
  cell-by-cell, and matter because the daily run is hard-bounded by Apps
  Script's 6-minute execution budget.

**Try/catch around `decodeURIComponent` (Apps Script):**
`Shopify.gs:651-658` declares `safeDecode_`, used per-pair in
`classifyOrderAttribution_` so a single malformed escape in a bot's
landing URL drops that one param, not the whole order's classification.
See CR5-02.

**Numeric guards on analyzer inputs:**
- `Number.isFinite(o.totalCad)` before accumulating
  (`attributionAnalysis.ts:431`)
- `Number.isFinite(p.value)` before bucketing
  (`attributionAnalysis.ts:440`)
- Variance-zero check before computing CI (`attributionAnalysis.ts:220`,
  `attributionAnalysis.ts:654` — WR5-04 fix). Treats homogeneous samples
  as "not enough info" rather than rendering a falsely-precise interval.

**Sheets API quota throttle:**
`Utilities.sleep(500)` between sub-stages within `updateStoreForDate_`
(after campaigns, after ads, after products) and `Utilities.sleep(1500)`
between stores in `runUpdateForDate` (`DailyUpdate.gs:42`). Without these,
stores 2 and 3 timed out from quota saturation. Sleep cost (~3s per run)
is well under the runtime budget.

## React Patterns

**`'use client'` directive at the top of every component file:**
Required for Next.js 15 app router because every component uses hooks /
event handlers. Server components live in `app/api/*/route.ts` only.

**`useMemo` for derived state:**
```ts
// CampaignsTable.tsx:606-682 — trueRevenueByKey computed once per
// (mode, data, productsResp, ordersAttrResp, productMap, aggregated, localRange)
const trueRevenueByKey = useMemo(() => {
  ...
  for (const a of aggregated) {
    ...
    const attribution = analyzeAttribution(...);
    out.set(k, { ..., attribution });
  }
  return out;
}, [mode, data, productsResp, ordersAttrResp, productMap, aggregated, localRange]);
```
Every analyzer call (Bayesian CI, window stability, outlier z-score) is
non-free. Always memoize on the inputs that drive it. **Anti-pattern**: the
ad-set and ad call sites in `CampaignDrawer.tsx:1012-1024` and
`AdsDrawer.tsx:378-390` invoke `analyzeAttributionForAdSet`/`...ForAd`
inside `(() => { ... })()` per render (IN5-01). When fixing, follow the
campaign-level memoization shape — build a `Map<adSetId, AttributionAnalysis>`
in one `useMemo` and look up per cell.

**SWR for data fetching:**
- `useSWR<DashboardData>('/api/data', fetcher, { refreshInterval: 60_000, revalidateOnFocus: true })` — `Dashboard.tsx:68-72`
- `useSWR<StoreMetaResponse>(open ? '/api/store-meta' : null, ..., { revalidateOnFocus: false, dedupingInterval: 60_000 })` — `BillingSettings.tsx:107-111`. Note the conditional key (`open ? url : null`) — SWR skips the fetch when the key is null. Use this to defer panel-only API calls.
- Errors thrown from fetchers surface via SWR's `error` field; the global fetcher in `Dashboard.tsx:45-52` reads `body.error` from the response and re-throws with a meaningful message

**localStorage + cloud-sync for cross-device state:**
- Reads stay synchronous (`readRecurring()`, `readAnnotations()`, `readOptimized()`, `readProductMap()`) — components never await localStorage
- Writes do the full triad: `localStorage.setItem` → `window.dispatchEvent(new CustomEvent('roas-{topic}-changed'))` → `pushCloudKey(STATE_KEY, value)`
- Components subscribe to the custom event in a `useEffect` to re-read on changes (cross-component AND cross-device propagation)
- Initial hydrate from cloud is gated on `isHydrated()` (`src/lib/cloudSync.ts:411`) — seed-data branches in `BillingSettings` wait for this so they don't overwrite a partner's data

**Drawer stack pattern (`useDrawerEsc`):**
The Esc-key coordination problem and fix lives in
`src/lib/drawerStack.ts`. Each drawer drops in:
```tsx
import { useDrawerEsc } from '@/lib/drawerStack';
useDrawerEsc(open, onClose);
```
Module-level array of `onClose` callbacks; only the topmost responds to
Esc. Single shared `window.addEventListener('keydown', ...)`, installed
lazily on first push and removed on last pop. **Use this hook, never
register your own Esc listener directly.** See WR-01.

**Defensive `e.stopPropagation()` on row-action buttons:**
`AdsDrawer.tsx:402-409` documents the pattern: even if no parent
`onClick` exists today, stop propagation so a future row-click handler
doesn't accidentally trigger when the user toggles a child button. Cheap
forward-compat for tables.

**Hebrew RTL + numeric formatting via `<bdi dir="ltr">`:**
`src/lib/format.ts` wraps every numeric atom in `bdi(content)` so the
Unicode bidi algorithm doesn't reshuffle currency code + digits + sign in
ways that look broken. Helper exports: `fmtCount`, `fmtMoney`,
`fmtMoneyBare`, `fmtNum2`, `fmtDeltaPct`, `fmtPct`, `fmtDate`,
`fmtDateShort`. **Use these in JSX**; the bare `formatCurrency` /
`formatNumber` in `src/lib/utils.ts` return raw strings and are fine for
non-React contexts (CSV export, logs).

**Stable per-store colours:**
`src/lib/format.ts:144-164` exports `STORE_HUES` + `storeColor` /
`storeBg` helpers. Every chart, sparkline, legend, and chip MUST resolve
through these so a store keeps the same hue across the dashboard. Adding
a store: extend the `STORE_HUES` map.

**`tabular-nums` className on numeric cells:**
The `bdi()` helper in `format.ts:69-76` defaults to
`className: 'tabular-nums'`. Numeric table cells across the app rely on
this for vertical alignment.

## Import Organization

The convention, by example (e.g. `CampaignsTable.tsx:1-44`):

1. `'use client';` directive (one line, top of file)
2. React / Next / external React packages (`useEffect`, `useMemo`, `useState`, `useSWR`)
3. Icon imports (`lucide-react`) — grouped as one block
4. Recharts / other heavy external packages if used
5. `@/lib/*` helpers — utility / pure layers first
6. `@/lib/*` data shapes (`type CampaignRow`, etc.)
7. `@/app/api/*` response types
8. `./` local components last

**Path aliases:**
- `@/*` → `src/*` (`tsconfig.json:17`)
- Always use `@/lib/...` and `@/components/...`; avoid relative `../../lib/...`
  paths beyond same-folder `./`

## Module Design

**Exports:**
- Named exports throughout — no `export default` in `src/lib/` or `src/components/` except the Next.js page default in `src/app/page.tsx:3-5`
- Type exports use `export type X = ...` — co-located with implementation
- Reverse-lookup helpers live next to forward functions
  (`campaignsForProduct` next to `setMappedProducts` in
  `campaignProductMap.ts`)

**No barrel files** (already covered above) — directly import from the
file that owns the symbol.

**Pure functions get explicit "no side effects" JSDoc when worth flagging:**
```ts
// src/lib/attributionAnalysis.ts:798
* Pure function — no side effects, no IO. Safe to memoize on inputs.
```
This is a contract the React layer relies on for `useMemo`.

## Error Handling

**TypeScript layer:**
- API routes: top-level try/catch returning a structured error response,
  preserving the declared response shape (see WR5-05 fix in
  `src/app/api/orders-attribution/route.ts:28-44`)
- Pure analyzers: never throw — return `null` for "unusable input"
  (analyzers in `attributionAnalysis.ts` return `AttributionAnalysis | null`)
  or return an explicit zero object (`analyzeProductChannel` returns
  `ProductChannelBreakdown` with all zeros, NOT null, so the caller
  doesn't need a null-guard before reading `breakdown.totalOrders`)
- Cloud sync: errors set `syncState.status = 'error'` + `lastError`
  message, surfaced via `SyncIndicator`. Never throw to the user

**Apps Script layer:**
- Top-level entry points (`runDailyUpdate`, `runUpdateForDate`) catch
  per-store and per-section errors, log to `Logger.log` with a
  `[store] message` prefix, and accumulate into an `errors` array
  reported in the final summary
- `notifyError_` sends to `notification.email` Script Property when any
  errors occurred (`DailyUpdate.gs:68-71`)
- `fetchWithRetry_` (`Config.gs:115-142`) wraps every external HTTP call
  with retries on 5xx + 429 + network errors. Backoff: 2.5s × attempt,
  5s × attempt for 429. Use this — never call `UrlFetchApp.fetch` directly

## Logging

**TypeScript:**
- `console.warn(...)` and `console.error(...)` for non-fatal issues (e.g.
  `cloudSync.ts:222`, `route.ts:30`)
- No structured logger / Sentry / Datadog wiring — Vercel captures stdout
- Avoid `console.log` in production paths; reserved for ad-hoc debug
  during development

**Apps Script:**
- `Logger.log(...)` everywhere — visible in the Apps Script Executions tab
- Include enough context to diagnose: store name, date, the value that
  failed, the actual exception's `e.message ?? e`
- "non-fatal" marker in the message when the try/catch is deliberately
  swallowing the error (so the operator can grep)

## Function Design

**Size:** Keep functions focused. The largest analyzer
(`analyzeAttribution`, ~200 LOC) is at the upper end of acceptable
because each section is a documented, distinct concern (deterministic
matching → coverage → Bayesian CI → window stability → outlier days →
trust ladder). Pull a helper when you can name it (`computeWindowStability`,
`detectOutlierDays`, `buildAnalysis`).

**Parameters:** Object args when there are 3+ related params or any
optional ones. The pattern from `analyzeProductChannel`
(`attributionAnalysis.ts:799-805`) and `buildAnalysis`
(`attributionAnalysis.ts:622-638`):
```ts
export function analyzeProductChannel(opts: {
  productIds: string[];
  orders: OrderAttributionRow[];
  storeId: string;
  dateFrom: string;
  dateTo: string;
}): ProductChannelBreakdown {
  const { productIds, orders, storeId, dateFrom, dateTo } = opts;
  ...
}
```

**Return values:** Match the contract documented at the top — if the
docstring says "null when input is unusable", every code path must either
return a real value or `null` (no `undefined`). Explicit-zero objects
(`analyzeProductChannel`) avoid forcing callers into null-checks for the
no-data case.

**Optional parameters:** Add to the end with a default. Document the
"why" inline (`dailyMetaSeries?: Array<...>` in
`attributionAnalysis.ts:181-184`).

## Cross-Cutting

**Stable references for line/file lookups:**
Many comments cite line numbers (`attributionAnalysis.ts:209-225`,
`Shopify.gs:601-610`, `SheetBuilder.gs:1532-1541`). When refactoring,
update affected anchor comments — they're load-bearing for review docs
and future map-codebase passes.

**No global state in TS layer EXCEPT documented module singletons:**
- `cloudSync.ts` has module-level `lastPushAt`, `pendingTimers`,
  `pendingRetries`, `hydrated`, `syncState` — these implement the
  debouncer / hydrator with intentional cross-call state. Documented
  inline (`cloudSync.ts:68-83`)
- `drawerStack.ts` has module-level `stack` + `listenerInstalled` —
  documented as the WR-01 fix
- Adding new module state requires the same level of documentation

**FX rate handling:**
Production P&L numbers go through the LIVE FX rate fetched by Apps Script
(`getFxRate`). The frozen `FROZEN_USD_TO_CAD = 1.36` in
`src/lib/constants.ts:24` is ONLY for deterministic suggestions /
previews where users would otherwise see numbers wobble between sessions.
Re-check quarterly; the constant carries a "Last reviewed" comment.

---

*Convention analysis: 2026-05-18*
