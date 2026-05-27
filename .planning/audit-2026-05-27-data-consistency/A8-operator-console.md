# A8 — Operator Console Correctness Audit

**Date:** 2026-05-28  
**Auditor:** Agent A8  
**Scope:** `/operator` page, all operator components, API routes under `/api/operator/*`, and the `mergeOverridesFromSupabase` merge pipeline.

---

## Findings

### A8-F1 | P1 | `dashboard-web/src/components/operator/TokenFailuresTable.tsx:28-36` + `dashboard-web/src/app/api/operator/token-failures/route.ts:148`

**Evidence:**  
The `fetcher` function in `TokenFailuresTable.tsx` returns a silent empty-rows object on any non-OK HTTP response:
```ts
if (!r.ok) {
  return { rows: [], lastUpdated: new Date().toISOString() };
}
```
The route's catch path returns HTTP 500 (`{ status: 500 }`) when the Supabase client throws (e.g., missing `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY`, network outage). Additionally, the route's Supabase query error path returns HTTP 200 with `{ error: '...', rows: [], lastUpdated }`, but `TokenFailuresTable` never reads `data.error` (unlike `ManualOverridesCrud` which does check `data?.error` and renders an amber banner).

**Why wrong:**  
On a 500 (infrastructure failure) or on a 200+error (Supabase query failure), the component renders `rows.length === 0 → "אין כשלי טוקנים פתוחים. הכל ירוק."` — a false-green all-clear that masks the fact the table could not be read at all. Real token failures (expired Meta token, dead Google OAuth) remain invisible to the operator.

**Suggested fix:**  
1. Change the route's catch path to HTTP 200 (matching JobsTable and ManualOverridesCrud's soft-fail contract) OR change the fetcher to throw on !r.ok so SWR enters its error branch and the component renders the amber error banner.
2. Add `if (data?.error) return <amber banner with data.error>` before the `rows.length === 0` check, matching the `ManualOverridesCrud` pattern at line 207.

---

### A8-F2 | P1 | `dashboard-web/src/lib/notifications/tokenFailures.ts:317-333`

**Evidence:**  
`resolveTokenFailure` issues a `.update().eq().eq().eq()` against Supabase but never checks the returned `{ error }`:
```ts
await sb
  .from('token_failures')
  .update({ resolved_at: ..., last_alert_sent_at: null })
  .eq('provider', provider)
  .eq('store_id', storeId)
  .eq('operation', operation);
```
The `supabase-js` client does not throw on query errors — it returns `{ data, error }`. The error is silently discarded here.

**Why wrong:**  
If the update fails (Supabase RLS violation, constraint, network blip), the route's `POST /api/operator/token-failures` will return HTTP 200 `{ ok: true }` even though the row was never resolved. The UI performs an optimistic `mutate()`, the SWR re-fetch will show the row still unresolved, but the operator receives no actionable error at the moment of clicking "Resolve" — only the confusing side-effect that the row reappears after the refetch.

**Suggested fix:**  
Destructure `{ error }` from the Supabase update call and throw if `error` is non-null, letting the route's `catch(e)` propagate a 500 back to the client's `alert()` handler (line 97 in `TokenFailuresTable.tsx`).

---

### A8-F3 | P2 | `dashboard-web/src/components/operator/SyncNowButtons.tsx:64,152` + `dashboard-web/src/components/operator/BackfillPicker.tsx:52,188-190`

**Evidence:**  
`SyncNowButtons` and `BackfillPicker` both expose internal store IDs (`uzoshop`, `zolplus`, `usmile360`) as the operator-visible labels (button text and checkbox labels). The real store names per `stores` seed migration (`20260521063301_seed_stores.sql`) are `uzoshop`, `Zol Plus`, and `360usmile`. For `zolplus` and `usmile360` the label the operator sees does not match the Shopify/Meta/dashboard store name they know.

**Why wrong:**  
This is not a data-correctness bug (the POST payloads use the correct internal IDs, and the DB stores them under those IDs), but it is a UX confusion risk: an operator familiar with "Zol Plus" and "360usmile" must mentally map to "zolplus"/"usmile360" to understand which button applies to which store. Mis-clicks are unlikely but possible in a time-pressured incident-response context.

**Suggested fix:**  
Add a `STORE_DISPLAY_NAME` map (mirroring `STORE_NAME_BY_ID` in `postgresReaders.ts:585-589`) and render the friendly name as button/checkbox label while keeping `storeId` as the POST payload value. Example: display "Zol Plus" on the checkbox while sending `{storeId: 'zolplus'}` to the API.

---

### A8-F4 | P2 | `dashboard-web/src/lib/fetchers/manualOverrides.ts` (design gap, not code bug)

**Evidence:**  
`mergeOverridesFromSupabase` only handles `meta` and `google` platforms — enforced both by the DB CHECK constraint (`manual_overrides_platform_check CHECK (platform IN ('meta', 'google'))`) and by the merge logic. TikTok spend for `uzoshop` is fetched in Step 3.5 of `cronDaily.ts` and converted to CAD separately in `persist-batch` (Step 5); it is **not** routed through the override merge at all.

**Why wrong (design gap):**  
If `uzoshop`'s TikTok spend is wrong on a given day (e.g., TikTok API returned stale data, token issue), the operator has no path to correct it via the ManualOverridesCrud UI. The only correction mechanism is a sync-now/backfill that re-fetches from TikTok. This is a silent capability gap; the footer copy in `ManualOverridesCrud.tsx` ("שינויים נכנסים לתוקף בריצת ה-Inngest הבאה") does not mention this TikTok limitation.

**Suggested fix:**  
Either (a) extend `manual_overrides` platform check + merge logic to include `'tiktok'` and add a TikTok option to the ManualOverridesCrud platform dropdown, or (b) add a UI note in `ManualOverridesCrud.tsx` that overrides cover Meta and Google only, not TikTok (360usmile and Zol Plus are unaffected; only uzoshop has TikTok spend).

---

## Verified Correct

The following items were explicitly verified and found correct:

**Manual override merge pipeline (INV-check #1):**  
- `mergeOverridesFromSupabase` (`lib/fetchers/manualOverrides.ts`) is called as Step 4 of `runDailyForStore` in `cronDaily.ts:474`. All three pipeline entries — `cron-daily`, `event/sync-now`, and `event/backfill` — call `runDailyForStore` and therefore all apply manual overrides before persisting.
- Override semantics: REPLACE (not additive) — if a `(date, store_id, platform)` row exists in `manual_overrides`, the upstream fetcher's spend is discarded and the override value (FX-converted to CAD) is used instead. Matches the documented contract.
- The merge step is correctly gated by the UNIQUE constraint on `(date, store_id, platform)`, preventing duplicate overrides.
- `cronLive` and `cronLiveHeavy` intentionally do NOT apply overrides (live path writes different tables/columns). The footer copy in the UI accurately states overrides take effect on the next full run.

**JobsTable soft-fail behavior (#2):**  
- The `/api/operator/jobs` route always returns HTTP 200, even on Inngest API failures (S-2 pattern), with `{ runs: [], error: '<sanitized>', lastUpdated }`.
- The component correctly checks `data?.error` (line 155) and renders an amber banner via `AlertCircle`.
- Live production verification: `GET https://roas-dashboard-smoky.vercel.app/api/operator/jobs?limit=5` returned HTTP 200 with valid `{ runs: [...], lastUpdated }` shape. Run output fields (`output`, `event_name`, `status`, `ended_at`) all populated correctly.

**BackfillPicker / SyncNowButtons store-ID correctness (#3):**  
- Internal store IDs `uzoshop`, `zolplus`, `usmile360` are confirmed by the seed migration (`20260521063301_seed_stores.sql:7-9`) as the actual `stores.id` values in Postgres.
- Both components POST these exact IDs; the API routes validate them against the same `VALID_STORES` allowlist.
- The backfill/sync-now pipeline receives the correct `storeId` and the `mergeOverridesFromSupabase` query filters on `store_id = storeId`, all consistent.
- No store-ID/name mismatch in the data path; the visual mismatch (finding A8-F3) is UX-only.

**ResetData destructive-gate correctness (#4):**  
- Two-layer confirmation: UI disables confirm button until `typed === CONFIRM_TOKEN_FOR_SCOPE[scope]`; route validates the same token server-side via `validateResetBody`.
- Scope isolation: `scope='all'` → deletes from `DATA_TABLES` (7 tables including `manual_overrides`); `scope='except-manual'` → `EXCEPT_MANUAL_TABLES` (6 tables, skips `manual_overrides`).
- `PROTECTED_TABLES` (`stores`, `notification_config`, `dashboard_state`) are absent from both delete lists and confirmed never touched.
- The filter `.not('store_id', 'is', null)` is documented and confirmed as an always-true filter that covers all 7 resettable tables (all have `store_id NOT NULL` per initial schema migration).
- Partial-failure isolation via `Promise.allSettled` returns per-table outcome even if one table fails.

**TokenFailuresTable resolve correctness (partial, see F2):**  
- The `handleResolve` function correctly derives the composite key `provider::storeId::operation` from the row being resolved and POSTs it as `{ action: 'resolve', provider, store_id, operation }`.
- The route validates `provider` and `store_id` against their allowlists before calling `resolveTokenFailure`.
- `resolveTokenFailure` clears `resolved_at` AND resets `last_alert_sent_at = null` so the next failure triggers a fresh WhatsApp alert immediately.
- The optimistic `mutate()` after resolve will re-fetch and show the row disappearing from the unresolved table if the update succeeded.

---

## Summary Table

| ID | Severity | File:Line | Short Description |
|----|----------|-----------|-------------------|
| A8-F1 | P1 | `TokenFailuresTable.tsx:28-36` + `token-failures/route.ts:148` | Route returns HTTP 500 on exceptions; fetcher silently converts to `{rows:[]}` → false-green "all clear" when DB is down |
| A8-F2 | P1 | `tokenFailures.ts:317-333` | `resolveTokenFailure` discards the Supabase `.update()` error; resolve can silently fail while returning HTTP 200 OK |
| A8-F3 | P2 | `SyncNowButtons.tsx:152` + `BackfillPicker.tsx:188-190` | Store buttons/checkboxes show internal IDs (`zolplus`, `usmile360`) instead of display names (`Zol Plus`, `360usmile`) |
| A8-F4 | P2 | `manualOverrides.ts` (design gap) | No TikTok override support; operator cannot correct uzoshop TikTok spend via CRUD UI |
