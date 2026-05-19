---
phase: 05-scalability
plan: "03"
subsystem: api-lazy-lineitems
tags: [performance, payload-optimization, lazy-loading, swr, sheets-api]
dependency_graph:
  requires: [05-02]
  provides: [lazy-lineitems-opt-in]
  affects:
    - dashboard-web/src/lib/ordersAttribution.ts
    - dashboard-web/src/app/api/orders-attribution/route.ts
    - dashboard-web/src/components/CampaignDrawer.tsx
tech_stack:
  added: []
  patterns: [opt-in-heavy-column, swr-key-differentiation, backwards-compat-empty-array]
key_files:
  created: []
  modified:
    - dashboard-web/src/lib/ordersAttribution.ts
    - dashboard-web/src/app/api/orders-attribution/route.ts
    - dashboard-web/src/components/CampaignDrawer.tsx
decisions:
  - "includeLineItems default is false — explicit opt-in protects all callers from accidental heavy payload"
  - "lineItems field always returns [] (not undefined) when includeLineItems=false — no null-guard required in consumers"
  - "Strict === 'true' comparison for lineItems param prevents prototype tricks and truthy-ish string bypass (T-05-03-02)"
  - "Appended &lineItems=true to drawerBaseKey via template string — buildDateRangeKey always produces ?from=&to= so & suffix is always correct"
  - "CampaignsTable unchanged — it never reads row.lineItems; default light payload is correct"
metrics:
  duration: "~3 minutes"
  completed: "2026-05-19"
  tasks_completed: 2
  tasks_total: 2
  files_modified: 3
  files_created: 0
---

# Phase 05 Plan 03: Lazy line-items on /api/orders-attribution Summary

`includeLineItems` opt-in param added to `fetchOrdersAttribution` and `/api/orders-attribution` route; CampaignDrawer explicitly opts in via `?lineItems=true`, CampaignsTable stays on the lighter A:M-only payload by default.

## Tasks Completed

| Task | Name | Commit | Key Files |
|------|------|--------|-----------|
| 1 | lib + route — includeLineItems support | 333c088 | ordersAttribution.ts, orders-attribution/route.ts |
| 2 | CampaignDrawer opt-in, CampaignsTable default | 2fe443f | CampaignDrawer.tsx |

## What Was Built

**`dashboard-web/src/lib/ordersAttribution.ts`**
- `fetchOrdersAttribution` signature extended: `opts?: { range?: DateRange; includeLineItems?: boolean }`
- `includeLI = opts?.includeLineItems === true` (strict boolean check)
- `lastCol = includeLI ? 'N' : 'M'` drives batchGet range: `A2:N100000` vs `A2:M100000`
- `lineItems: includeLI ? parseLineItems(row[13]) : []` — always an array, never undefined

**`dashboard-web/src/app/api/orders-attribution/route.ts`**
- `searchParams` extracted once from `new URL(req.url).searchParams` (shared with range parsing)
- `includeLineItems = searchParams.get('lineItems') === 'true'` — strict comparison
- Passed to `fetchOrdersAttribution({ range, includeLineItems })`
- Cache comment added: Vercel cache key includes full URL + query string, so `?lineItems=true` and `?lineItems=false` entries are separate — no cross-contamination

**`dashboard-web/src/components/CampaignDrawer.tsx`**
- `ordersAttrBaseKey` extracted from `buildDateRangeKey('/api/orders-attribution', drawerRange)`
- SWR key becomes `ordersAttrBaseKey ? \`${ordersAttrBaseKey}&lineItems=true\` : null`
- Only loads lineItems when drawer is open AND range key is non-null (guards preserved)
- `CampaignsTable.tsx`: confirmed 0 references to `lineItems` — no change needed

## Verification Results

| Check | Result |
|-------|--------|
| `npx tsc --noEmit` (Task 1) | 0 errors |
| `npx tsc --noEmit` (Task 2) | 0 errors |
| `npm run build` (Task 2) | Pass — /api/orders-attribution shows as `ƒ Dynamic` |
| `grep -c "lineItems=true" CampaignDrawer.tsx` | 2 (1 comment + 1 in template string) |
| `grep -c "lineItems" CampaignsTable.tsx` | 0 (no lineItems consumer in table) |

## Pending Post-Deploy Verification (Production Only)

**DO NOT run against localhost. All HTTP checks are production-only.**

After Vercel deploys:

```bash
PROD_URL="${PROD_URL:-https://script-roas.vercel.app}"

# Default (no ?lineItems) → rows[i].lineItems should be []
curl -fsS "$PROD_URL/api/orders-attribution?from=2026-05-01&to=2026-05-14" \
  | node -e "const d=require('fs').readFileSync('/dev/stdin','utf8'); const j=JSON.parse(d); const li=j.rows[0]?.lineItems; console.log('lineItems sample:', JSON.stringify(li)); console.log(Array.isArray(li) && li.length===0 ? 'OK: empty array' : 'FAIL: expected []');"

# Opt-in → rows[i].lineItems should be populated (if orders exist in range)
curl -fsS "$PROD_URL/api/orders-attribution?from=2026-05-01&to=2026-05-14&lineItems=true" \
  | node -e "const d=require('fs').readFileSync('/dev/stdin','utf8'); const j=JSON.parse(d); const li=j.rows[0]?.lineItems; console.log('lineItems sample:', JSON.stringify(li?.slice(0,2))); console.log(Array.isArray(li) ? 'OK: is array' : 'FAIL: not array');"
```

## Deviations from Plan

None — plan executed exactly as written.

The only structural note: `node_modules` symlink was recreated for the worktree (same as Plan 02 did — not committed, not in git tracking).

## Known Stubs

None — all data sources wired. lineItems column is fully populated server-side when `includeLineItems=true`.

## Threat Flags

No new trust boundaries introduced. All threat model items mitigated:

| Threat ID | Mitigation Applied |
|-----------|-------------------|
| T-05-03-01 | Default false; strict `=== 'true'` comparison in route |
| T-05-03-02 | `searchParams.get()` returns string or null; strict comparison prevents prototype tricks |
| T-05-03-03 | `lineItems: []` always present on every row — consumers can `.forEach` / `.map` without null-guard |

## Self-Check: PASSED
