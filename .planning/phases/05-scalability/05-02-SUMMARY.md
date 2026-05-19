---
phase: 05-scalability
plan: "02"
subsystem: api-pagination
tags: [pagination, swr, date-range, server-filtering, performance]
dependency_graph:
  requires: []
  provides: [date-range-pagination, swr-range-keys]
  affects: [dashboard-web/src/lib, dashboard-web/src/app/api, dashboard-web/src/components]
tech_stack:
  added: [dashboard-web/src/lib/dateRange.ts]
  patterns: [server-side-range-filtering, swr-url-keying, range-param-validation]
key_files:
  created:
    - dashboard-web/src/lib/dateRange.ts
  modified:
    - dashboard-web/src/lib/sheets.ts
    - dashboard-web/src/lib/campaigns.ts
    - dashboard-web/src/lib/products.ts
    - dashboard-web/src/lib/ordersAttribution.ts
    - dashboard-web/src/app/api/data/route.ts
    - dashboard-web/src/app/api/campaigns/route.ts
    - dashboard-web/src/app/api/products/route.ts
    - dashboard-web/src/app/api/orders-attribution/route.ts
    - dashboard-web/src/components/Dashboard.tsx
    - dashboard-web/src/components/CampaignsTable.tsx
    - dashboard-web/src/components/CampaignDrawer.tsx
    - dashboard-web/src/components/ProductsTable.tsx
decisions:
  - "dateRange.ts uses a single shared module to avoid the 4-route parallel-drift problem"
  - "Server-side JS filtering (not Sheets range-read) because tabs are not strictly date-sorted"
  - "CampaignDrawer uses existing rangeFrom/rangeTo props; drawerRange constructed inline rather than adding a new prop — avoids touching CampaignsTable call-site"
  - "Dashboard.tsx and ProductsTable.tsx: reordered state declarations so localRange/filters is declared before useSWR (required for key computation)"
  - "/api/orders-attribution preserves degraded fallback: only RangeParamError → 400; Sheets errors remain 200+empty"
metrics:
  duration: "~25 minutes"
  completed: "2026-05-19"
  tasks_completed: 3
  tasks_total: 3
  files_modified: 12
  files_created: 1
---

# Phase 05 Plan 02: API Pagination ?from=&to= + SWR Keys Summary

Server-side date-range pagination for all 4 telemetry API routes using shared `parseRangeParams`/`buildDateRangeKey` helpers, with SWR keys updated in 4 components so range changes trigger fresh network fetches.

## Tasks Completed

| Task | Name | Commit | Key Files |
|------|------|--------|-----------|
| 1 | dateRange helper + lib filtering | 058af0c | dateRange.ts (new), sheets.ts, campaigns.ts, products.ts, ordersAttribution.ts |
| 2 | 4 routes parse searchParams | 0726819 | api/data, api/campaigns, api/products, api/orders-attribution route.ts |
| 3 | 4 components SWR range keys | 265c63d | Dashboard.tsx, CampaignsTable.tsx, CampaignDrawer.tsx, ProductsTable.tsx |

## What Was Built

**`dashboard-web/src/lib/dateRange.ts`** — shared module with 7 exports:
- `DateRange` type (`{ from: string; to: string }`)
- `DEFAULT_RANGE_DAYS = 90`
- `parseRangeParams(searchParams)` — validates `?from=YYYY-MM-DD&to=YYYY-MM-DD`, defaults to last 90 days when absent, throws `RangeParamError` on malformed/partial input
- `RangeParamError` — custom error class for 400-able validation errors (does not catch Sheets API errors)
- `defaultRange()` — computes today minus 90 days in UTC
- `buildDateRangeKey(basePath, range)` — returns `"${basePath}?from=${from}&to=${to}"` or `null` if range is missing/incomplete
- `isInRange(date, range)` — boolean filter for server-side row filtering

**4 lib functions** updated to accept `opts?: { range?: DateRange }`:
- `fetchDailyData`, `fetchCampaignsData`, `fetchProductsData`, `fetchOrdersAttribution`
- Filter with `isInRange()` in the main row loop, after `parseDate()`, before pushing to output array
- Tabs are NOT sorted by date (idempotent writes can land rows anywhere) — JS-side filtering is the correct approach

**4 API routes** updated to `GET(req: Request)`:
- Parse `?from=&to=` from `new URL(req.url).searchParams`
- Return HTTP 400 (`Cache-Control: no-store`) on `RangeParamError`
- Pass `range` to lib functions
- Existing cache headers, `revalidate` constants, and degraded fallbacks preserved
- `/api/orders-attribution` degraded path preserved: only `RangeParamError` → 400; Sheets failures → 200 + `{ rows: [], error }` (unchanged behavior)

**4 components** updated with range-keyed SWR:
- `Dashboard.tsx`: `filters` state moved before `useSWR`; key = `buildDateRangeKey('/api/data', filters.range)`
- `CampaignsTable.tsx`: 3 SWR keys for `/api/campaigns`, `/api/products`, `/api/orders-attribution` now include range via `buildDateRangeKey(path, range)` where `range` is the existing prop
- `CampaignDrawer.tsx`: 2 SWR keys for `/api/products` and `/api/orders-attribution` use `drawerRange = { from: rangeFrom, to: rangeTo }` (constructed from existing separate string props)
- `ProductsTable.tsx`: `localRange` state moved before `useSWR`; key = `buildDateRangeKey('/api/products', localRange)` — custom local range zoom triggers new fetch

## Verification Results

| Check | Result |
|-------|--------|
| `npx tsc --noEmit` (Task 1) | 0 errors |
| `npx tsc --noEmit` (Task 2) | 0 errors |
| `npx tsc --noEmit` (Task 3) | 0 errors |
| `npm run build` (Task 2) | Pass — 4 routes show as `ƒ Dynamic` |
| `npm run build` (Task 3) | Pass |
| `grep -c buildDateRangeKey` per component | Dashboard:3, CampaignsTable:4, CampaignDrawer:3, ProductsTable:3 |

## Pending Post-Deploy Verification (Production Only)

**DO NOT run against localhost. All HTTP checks are production-only.**

After Vercel deploys, run the following `<post_deploy>` curl from Task 3:

```bash
PROD_URL="${PROD_URL:-https://script-roas.vercel.app}"
curl -fsS -o /tmp/p502-data.json \
  -w 'HTTP %{http_code} size=%{size_download}\n' \
  "$PROD_URL/api/data?from=2026-02-19&to=2026-05-19"
SIZE=$(wc -c </tmp/p502-data.json | tr -d ' ')
echo "payload bytes=$SIZE"
[ "$SIZE" -lt 512000 ] && echo "OK: 90-day /api/data payload $SIZE bytes < 500KB (SC-5 verified)" \
  || echo "FAIL: payload $SIZE >= 500KB (server-side filter not effective)"
```

Expected: HTTP 200, payload < 500KB (SC-5 architectural intent: server-side pagination reduces payload size vs. full history).

Additional production smoke checks (DevTools → Network):
- `GET /api/data` (no params) → 200, default 90-day range
- `GET /api/data?from=2026-01-01&to=2026-04-30` → 200, filtered payload
- `GET /api/data?from=2026-05-01&to=2026-01-01` → 400
- `GET /api/data?from=bad` → 400
- Dashboard → Filters → change range → observe 4 new Network requests with `?from=...&to=...` different from prior requests

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Reordered useState before useSWR in Dashboard.tsx**
- **Found during:** Task 3
- **Issue:** `useSWR` was declared before `filters` state, making `filters.range` inaccessible as the SWR key
- **Fix:** Moved `activeTab` and `filters` `useState` declarations before the `useSWR` call
- **Files modified:** `dashboard-web/src/components/Dashboard.tsx`
- **Commit:** 265c63d

**2. [Rule 1 - Bug] Reordered useState before useSWR in ProductsTable.tsx**
- **Found during:** Task 3
- **Issue:** `localRange` state was declared after `useSWR`, so `buildDateRangeKey('/api/products', localRange)` would reference an undeclared variable
- **Fix:** Moved `period`, `localStore`, and `localRange` state declarations before `useSWR`
- **Files modified:** `dashboard-web/src/components/ProductsTable.tsx`
- **Commit:** 265c63d

**3. [Design deviation] CampaignDrawer: uses `drawerRange` constructed from existing props**
- **Found during:** Task 3
- **Issue:** Plan suggested adding a `range: DateRange` prop to `CampaignDrawer`, but the component already receives `rangeFrom: string` and `rangeTo: string` as separate props (matching existing CampaignsTable call-site)
- **Fix:** Constructed `drawerRange = { from: rangeFrom, to: rangeTo }` inline rather than adding a new prop — avoids unnecessary CampaignsTable call-site change and keeps backward compatibility
- **Files modified:** `dashboard-web/src/components/CampaignDrawer.tsx`
- **Commit:** 265c63d

**4. [Infrastructure] node_modules symlink for worktree builds**
- **Found during:** Task 2 verification
- **Issue:** Worktree has no `node_modules` (expected for git worktrees); `npx tsc` and `npm run build` require them
- **Fix:** Created symlink `dashboard-web/node_modules -> /script-roas/dashboard-web/node_modules`; added `dashboard-web/node_modules` to worktree-local git exclude. Symlink is NOT committed.

## Known Stubs

None — all data sources are wired. The `<post_deploy>` verification block is intentionally deferred (requires live Vercel deployment with production environment variables).

## Threat Flags

| Flag | File | Description |
|------|------|-------------|
| threat_flag: input_validation | `dateRange.ts:parseRangeParams` | New query-string inputs validated by regex `^\d{4}-\d{2}-\d{2}$` + from<=to check (T-05-02-01 mitigated) |

No new trust boundaries introduced. The `RangeParamError` path returns sanitized English messages (not raw Sheets errors) — T-05-02-03 mitigated.

## Self-Check: PASSED
