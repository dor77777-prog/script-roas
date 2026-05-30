# Data Pipeline Integrity Audit

**Track:** 3 of 8 — Data Pipeline Integrity
**Date:** 2026-05-24
**Scope:** Inngest function registration & cron schedule sanity, reader/writer symmetry across postgresReaders ↔ cronDaily/cronLive writers, fetcher error handling, refund-correction pipeline, migration discipline, OAuth refresh, token-failure alert wiring, WhatsApp notifications.

---

## Summary

The pipeline is in remarkably good shape after the 12.5.x audit cycle. **All 11 Inngest exports are registered** in `api/inngest/route.ts`; every cron uses the `TZ=Asia/Jerusalem` prefix; every Supabase write is `upsert` with explicit `onConflict`; the refund-correction algorithm is consumed via a single import; every fetcher has a 4xx/5xx-aware error path, every cron-level catch wires `notifyTokenFailure` correctly, and the throttle/recipient contract from the project memory (`+972524809540`, 1/6h) matches the code verbatim.

The remaining findings are **one P0 documentation drift** (the route.ts header still claims "8 functions" — operator-trust risk during incidents), **one P1 type/runtime-shape mismatch** in the Meta failure fallback that is latent but landmines a future change, **one P1 backoff gap** (no 429 / Retry-After honor anywhere — Inngest's blind retry-then-deadletter is the only safety net), and a handful of P2 cleanups (no per-store TikTok activation source-of-truth, duplicate `STORES_WITH_TIKTOK` lists, no in-band signal for the known Google OAuth refresh-token expiry).

**Google OAuth refresh-token expiry (project memory):** the code DOES have the right alert path (`isAuthError('google', ...) → notifyTokenFailure(...)`) but no proactive expiry detector. The operator will only see the alert once the first 401 lands. Flagged P1 with a small remediation.

**Refund attribution:** symmetric across cronDaily, cronLive, and eventBackfill — all 3 read through the single import of `computeRevenueWithCrossDayRefunds` in `shopify.ts`. Off-chip / refund-day pipeline matches the 2026-05-21 (commit 4f36f7a) fix described in project memory.

---

## P0 — silent prod bugs, double-writes, missing alerts

### P0-01 — route.ts header docstring drifts from reality
- **File:** `dashboard-web/src/app/api/inngest/route.ts:11`, `:69`, `:71`, `:75`, `:79`, `:83`
- **Failure mode:** The header comment block claims "all 8 functions" and walks through cronDaily ×3, cronLive ×3, eventSyncNow, eventBackfill. It never mentions the 3 whatsappCron* + 1 eventWhatsappSendNow. The `functions: [...]` array (line 114) DOES correctly include them (`...whatsappCronFunctions, eventWhatsappSendNow`). During an incident, an operator scanning the docstring to verify "is whatsapp-noon registered?" would conclude "no" and waste 15 min looking for the bug. **This is an operator-trust regression even though the runtime is correct.**
- **Remediation:** Update the docstring block to "11 functions total" and add three lines describing `...whatsappCronFunctions` and `eventWhatsappSendNow` underneath the existing `eventBackfill` entry.

---

## P1 — idempotency gaps, weak error handling

### P1-01 — Meta failure fallback returns wrong type for `budgets`
- **File:** `dashboard-web/src/inngest/functions/cronDaily.ts:333`
- **Failure mode:** In the `fetch-meta` step's catch block, the fallback returns `budgets: { campaigns: new Map(), adSets: new Map() }`. But `fetchMetaBudgets` declares the actual shape as `Record<string, …>` (plain object) — see `meta.ts:140-193`. Downstream consumers index it as a plain object (`meta.budgets.campaigns[r.campaignId]` at `cronDaily.ts:743-744`). The bug is currently latent because the same catch block also returns `adsetRows: []` and `adRows: []`, so the downstream `.map(async r => meta.budgets.campaigns[r.campaignId])` never iterates. **A future change that wires budgets into a code path that runs even on empty rows (e.g. enroll-placeholder for active-but-zero-spend campaigns) will silently get `undefined` back from `Map.prototype[r.campaignId]` because `Map` doesn't support bracket-access.**
- **Remediation:** Change line 333 to `budgets: { currency: 'ILS', campaigns: {}, adSets: {} }` — matching the canonical `MetaBudgets` shape including the `currency` field (also missing today).

### P1-02 — No 429 / Retry-After backoff anywhere
- **Files:**
  - `dashboard-web/src/lib/fetchers/meta.ts:341-347, 530-536, 674-700, 710-720, 754-763`
  - `dashboard-web/src/lib/fetchers/googleAds.ts:312-322`
  - `dashboard-web/src/lib/fetchers/shopify.ts:471-485, 703-717`
  - `dashboard-web/src/lib/fetchers/tiktok.ts:150-176`
  - `dashboard-web/src/lib/fetchers/fx.ts:53-59`
- **Failure mode:** Every fetcher pattern is the same — `if (!res.ok) throw`. There is no `Retry-After` header parse, no exponential backoff between pagination pages, and no rate-limit-specific branch (429 vs 401 vs 500 are all treated identically as "throw and let Inngest retry"). Inngest's default 4-retry exponential backoff DOES partly mitigate this at the function level — but each retry re-runs the WHOLE step (e.g. re-paginates Meta from page 1), so a single rate-limit at page 30 of 40 causes 30 wasted page-1-through-30 calls per retry, multiplying the burn. With Meta's ~1-req/sec adset endpoint cap, a noisy day could plausibly retry-loop. **The Shopify+Meta+Google all-paginated fetch on a single cron-daily run hits ~50-200 HTTP calls upstream; one 429 ripples to many.**
- **Remediation:** Add a tiny shared helper that detects `429` + `Retry-After` (Meta + Shopify + Google all expose this header), `await sleep(retryAfterMs)`, retry once at the page level before throwing. Adds <40 lines, prevents the retry-amplification math.

### P1-03 — No proactive Google OAuth refresh-token expiry detection
- **Files:** `dashboard-web/src/lib/fetchers/googleAds.ts:186-246` (refresh path), project memory note `project_google_oauth_refresh_token_pending.md`
- **Failure mode:** Per project memory, the `roas-tracker-ga` OAuth consent screen is in **Testing** mode at Google — refresh tokens auto-expire every 7 days until the screen is published to Production. Current token expires ~2026-05-30 (6 days). The fetcher's `getAccessToken` catches the refresh failure correctly and the cron's catch surfaces `notifyTokenFailure({ provider: 'google', operation: 'fetch_insights', advice: 'Re-run the OAuth Playground flow…' })`. So the operator **will** get a WhatsApp alert — **but only after the first cron-daily / cron-live tick post-expiry fails.** That can be up to ~10 min later (cron-live cadence). There is no proactive "your refresh token will expire in N days" warning.
- **Remediation:** Either (a) add a `lastRefreshAt` column to the existing `token_failures` table and have `getAccessToken` write it on every successful refresh; a daily cron checks `now - lastRefreshAt > 5 days` and pings the operator. Or (b) parse Google's `expires_in` for the refresh-token vs the access-token (Google does expose it in some response shapes) and pre-warn at T-24h. Simplest path: a one-time cron that runs `getAccessToken('uzoshop')` at 00:00 IL daily and alerts on failure — no schema change needed.

### P1-04 — `cronLive.ts` SELECT-then-UPSERT race window inside `persistDayForStore`
- **File:** `dashboard-web/src/inngest/functions/cronLive.ts:422-447`
- **Failure mode:** `persistDayForStore` does `SELECT fb_spend_cad, ga_spend_cad, tt_spend_cad, total_spend_cad` THEN `UPSERT` later in the same function. INN-10 fix (lines 869-888) correctly moved the prior-spend SELECT into its OWN memoized `step.run('select-prior-spend-{date}-{storeId}', ...)` so retries reuse the original prior value. **But the SELECT inside `persistDayForStore` itself (line 422) is NOT inside its own step.run — it's INSIDE the `persist-rolling-3day` step.run.** On Inngest retry of `persist-rolling-3day`, this inner SELECT re-runs and now reads the freshly-written UPSERT from the first attempt. The override branch (`spendOverride !== undefined`) is unaffected because it bypasses the SELECT — but the no-override branch (cron-daily's spend column "preservation" path) silently loses the original prior value on retry.
- **Concrete corruption scenario:** cron-daily ran at 00:05 and wrote `fb_spend_cad = 1500`. cron-live ticks at 00:10 with `spendOverride = undefined` (no fresh ad-platform data — e.g. an early-morning Meta 5xx), SELECT reads `1500`, UPSERT writes back `1500`. Retry fires — SELECT now reads back `1500` (the UPSERT). Same outcome, no corruption. **But** if a subsequent run between the original attempt and the retry happens to OVERWRITE the column with a different value (e.g. operator clicked "Sync now"), the retry's SELECT reads the operator-injected value, and the next UPSERT preserves the operator's value. So functionally the code is forgiving here. **The real risk is the OTHER `persistDayForStore` call site (`spend-only` path at line 387)** which also lives inside the same `persist-rolling-3day` step.run — same memoization gap.
- **Remediation:** Either (a) move the inner SELECT in `persistDayForStore:422-430` into its OWN per-call `step.run` keyed by `(storeId, date, "select-current-spend")`, or (b) compute the preserved values inside the loop in `persist-rolling-3day` (you already have `priorSpendByDate` from the memoized SELECT — pass it down into `persistDayForStore` as a 3rd `priorOverride?: {...}` arg and skip the inner SELECT entirely). Option (b) is leaner.

### P1-05 — `cronWhatsapp.ts` retries throw exceptions per-recipient mid-loop
- **File:** `dashboard-web/src/lib/notifications/sendDailySummary.ts:73-119`
- **Failure mode:** The `sendDailySummary` function loops over recipients, swallowing each individual exception into `recipientsFailed[]`, then at the end (lines 112-119, audit fix `a/WARN-2`) **throws if ANY recipient failed**. Inngest's per-step retry kicks in (4 retries on the wrapping `step.run('send', ...)` in `cronWhatsapp.ts:54-58`), which means **a single failed recipient causes WhatsApp re-sends to BOTH recipients on every retry.** In the current single-recipient deployment (allowlist=`+972524809540` only), the loop has exactly 1 recipient so the retry doesn't double-send anyone — but the moment a 2nd recipient is added back (`phone2` config), a failure on phone2 triggers 4× re-sends to phone1.
- **Remediation:** Track successful sends in a `step.run('send-{toNumber}', ...)` per recipient — Inngest's step-level idempotency cache makes the already-succeeded recipients no-ops on retry. Right now there's exactly one step around the whole loop, so memoization can't help. Alternatively, accept the current single-recipient deployment as the contract and add an assertion that the loop has exactly 1 recipient (matches the project-memory `+972524809540`-only intent).

### P1-06 — `tt_spend_cad` is included in `total_spend_cad` recompute path in cronLive even for non-TikTok stores
- **File:** `dashboard-web/src/inngest/functions/cronLive.ts:402-406`
- **Failure mode:** In the `spendOnly: true` branch of `persistDayForStore`, the `total_spend_cad` is computed as `spendOverride.fbSpendCad + spendOverride.gaSpendCad + spendOverride.ttSpendCad`. For zolplus/usmile360 the caller passes `ttSpendCad: 0` (line 936-937), so the arithmetic is fine. **But there's no defensive guard inside `persistDayForStore` itself** — a future caller forgetting to pass `ttSpendCad: 0` and instead passing `undefined` would result in `total_spend_cad = fb + ga + NaN = NaN`, and Supabase would either reject (NUMERIC column) or write `NaN`. **Latent landmine for a future eventSyncNow change.**
- **Remediation:** In `persistDayForStore`, coerce `spendOverride.ttSpendCad ?? 0` before computing `total_spend_cad`. One-line defensive fix.

### P1-07 — `paginate()` helper has a soft cap of 50K rows, with no escalation when hit
- **File:** `dashboard-web/src/lib/postgresReaders.ts:96-115`
- **Failure mode:** Hard cap at 50 chunks × 1000 rows = 50K. If a reader (e.g. `fetchOrdersAttributionFromPostgres`) hits the cap, the loop just `break`s — no `console.warn`, no metric, no alert. With order volume growing, hitting 50K in a multi-month range is plausible — and the dashboard silently shows truncated data.
- **Remediation:** Add `if (chunk === MAX_CHUNKS - 1) console.warn(...)` mirror of the cap warnings in shopify.ts:495-502 / meta.ts:380-384.

---

## P2 — cleanups

### P2-01 — `STORES_WITH_TIKTOK` defined in 3 places
- **Files:**
  - `dashboard-web/src/inngest/functions/cronDaily.ts:93`
  - `dashboard-web/src/inngest/functions/cronLive.ts:145`
  - `dashboard-web/src/lib/platformsByStore.ts:27`
- **Failure mode:** Three independent sources of truth. Adding TikTok to a 2nd store means editing 3 files in lockstep. The cronDaily.ts:91 docstring even calls this out: "if a second store gains a TikTok account, update BOTH files." (Two files — but it's now three.) `STORES_WITH_GOOGLE_ADS` lives in 1 file (`googleAds.ts:73`) — better pattern.
- **Remediation:** Move both `STORES_WITH_TIKTOK` and `STORES_WITH_GOOGLE_ADS` next to each other in `platformsByStore.ts` and import into the cron files.

### P2-02 — TikTok hardcodes `currency: 'USD'` in cron-daily fallbacks while the live fetcher returns the cached advertiser currency
- **Files:** `dashboard-web/src/inngest/functions/cronDaily.ts:398-402, 428-431`
- **Failure mode:** When TikTok is disabled (`!STORES_WITH_TIKTOK.has(storeId)`) the sentinel uses `currency: 'USD'`. The advertiser-info cache (`fetchTikTokAdvertiserInfo`) reports the actual currency for the only TikTok-enabled store (uzoshop) — happens to BE USD today, so no symptom. **If a 2nd store with EUR currency is added, the sentinel/path-of-zero stays USD, and any future code that pre-validates "did we expect 0 USD vs 0 EUR" goes wrong.** Cosmetic but a paper-cut waiting to happen.
- **Remediation:** Make the sentinel currency `'CAD'` (which is what cron-live's preserve-path falls back to) — or better, omit the currency field and let downstream coerce.

### P2-03 — `cronDaily.ts` is 1278 lines; `cronLive.ts` is 1428 lines
- **Failure mode:** Both files are well-commented but monolithic. The `persist-batch` block in cronDaily (lines 470-1208) handles 7 distinct tables in one step.run; the per-table builders are ~100-200 lines each. A bug fix in any one section requires reading the whole step body. **Architecture / Refactoring Track will own this**, but flagging here because the data-flow split is natural: split per-table writers into module-local functions called from the step body.

### P2-04 — No `console.warn` when the FX cache returns the null-sentinel for the SAME (currency, date) twice in a single persist-batch
- **File:** `dashboard-web/src/inngest/functions/cronDaily.ts:573-597`
- **Failure mode:** The `fxCache` correctly stores `null` after a failure to avoid retry-hammering Frankfurter. Each subsequent `cadFor` call for the same currency reads `null` and silently omits the CAD field. **Operator sees the warn once (the first failure), then 50 silent rows that omit `spend_cad`.** Hard to notice in the run log.
- **Remediation:** Cosmetic — counter + summary line at end of persist-batch: "FX failed for {N} rows; CAD columns omitted (ON CONFLICT preserved priors)."

### P2-05 — Migration `20260522102151_add_tiktok_platform_check.sql` is DESTRUCTIVE but inline-replaceable
- **File:** `supabase/migrations/20260522102151_add_tiktok_platform_check.sql:1`
- **Failure mode:** Header is correct (`-- DESTRUCTIVE: drops the two-value CHECK …`). Pattern is `DROP CONSTRAINT IF EXISTS … ADD CONSTRAINT … CHECK (… 3-value list)`. Idempotent and safe. Compliance is fine. Flagging only because the MIGRATION-DISCIPLINE doc allows this pattern but suggests reviewing destructive changes more carefully — a future "add a 4th platform (LinkedIn?)" change should use the same DESTRUCTIVE pattern, not try to widen in-place.

---

## Inngest function inventory

| Function ID | Trigger | TZ | Registered? | Tests? | Notes |
|---|---|---|---|---|---|
| `cron-daily-uzoshop` | `cron: TZ=Asia/Jerusalem 5 0 * * *` | IL 00:05 | ✓ (via `...cronDailyFunctions`) | ✓ (`cronDaily.test.ts` + 2 follow-ups) | Factory in `cronDaily.ts:1257` |
| `cron-daily-zolplus` | same | IL 00:05 | ✓ | ✓ | factory output |
| `cron-daily-usmile360` | same | IL 00:05 | ✓ | ✓ | factory output |
| `cron-live-uzoshop` | `cron: TZ=Asia/Jerusalem */10 * * * *` | IL */10 min | ✓ (via `...cronLiveFunctions`) | ✓ (`cronLive.test.ts` + 5 follow-ups) | Doc says `*/15` (line 1379), but code is `*/10` (line 1402). Comment drift. |
| `cron-live-zolplus` | same | IL */10 | ✓ | ✓ | |
| `cron-live-usmile360` | same | IL */10 | ✓ | ✓ | |
| `event-sync-now` | `event: event/sync-now` | n/a | ✓ | ✓ (`events.test.ts`) | |
| `event-backfill` | `event: event/backfill` | n/a | ✓ | ✓ (`eventBackfillDstRange`, `eventBackfillSystemicFailure`) | |
| `whatsapp-noon` | `cron: TZ=Asia/Jerusalem 0 12 * * *` | IL 12:00 | ✓ (via `...whatsappCronFunctions`) | ✓ (`cronWhatsapp.test.ts`) | |
| `whatsapp-evening` | `cron: TZ=Asia/Jerusalem 0 18 * * *` | IL 18:00 | ✓ | ✓ | |
| `whatsapp-eod` | `cron: TZ=Asia/Jerusalem 30 0 * * *` | IL 00:30 | ✓ | ✓ | Moved from 00:10 → 00:30 per audit fix HIGH-13 (cronWhatsapp.ts:82-95). |
| `event-whatsapp-send-now` | `event: notifications/whatsapp.send-now` | n/a | ✓ | ✓ | |

**Total: 11 functions, all registered, all with at least one test.** No drift between exports and the `functions: [...]` array.

**Cron-daily race check:** all 3 `cron-daily-{store}` functions fire at exactly 00:05 IL. They run concurrently (Inngest dispatches them as 3 independent invocations). They write to disjoint `(store_id)` rows in shared tables — no race. The shared `getSupabaseAdmin()` client is connection-pool-safe.

**Cron-live cadence:** `*/10` not `*/15` (comment drift in cronLive.ts:1379 says "every 15 minutes" — the actual cron is `*/10 * * * *`; flagged inline). Free-tier budget recomputed in the lib doc-comment at lines 1396-1402.

---

## Reader / Writer symmetry matrix

| Table | Writer columns | Reader columns | Match? |
|---|---|---|---|
| `data_daily` | `cronDaily.ts:630-647` (15 cols) + `cronLive.ts:488-516` (preservation subset) | `postgresReaders.ts:275-278` (14 cols selected) | ✓ — reader skips `updated_at` (only used by `fetchDataDailyLastWriteAt` separately at line 215-239). All other 13 cols match. |
| `products_daily` | `cronDaily.ts:667-677` (9 cols) + `cronLive.ts:543-553` (9 cols) | `postgresReaders.ts:504-505` | ✓ |
| `campaigns_daily` | `cronDaily.ts:798-817` (Meta, 17 cols), `:852-875` (Google, 14 cols), `:1104-1123` (TikTok, 17 cols), `cronLive.ts:1214-1223` (placeholder, 7 cols) | `postgresReaders.ts:585-593` | ✓ — placeholder writer omits metrics (intentional: ON CONFLICT preserves). |
| `ads_daily` | `cronDaily.ts:927-941` (Meta), `:948-965` (Google), `:992-1006` (TikTok) | `postgresReaders.ts:812-815` | ✓ |
| `orders_attribution` | `cronDaily.ts:1152-1168` + `cronLive.ts:1012-1028` | `postgresReaders.ts:888-891` | ✓ — 15 cols both sides, including JSONB `line_items`. |
| `product_catalog` | `cronDaily.ts:1187-1198` | `postgresReaders.ts:953` | ✓ |
| `stores` | seeded by `20260521063301_seed_stores.sql` + idempotent re-seed | `postgresReaders.ts:402-404` (10 cols) | ✓ |
| `dashboard_state` | `postgresReaders.ts:1019-1040` (writer) | `postgresReaders.ts:458-459` (reader) | ✓ self-symmetric |
| `notification_config` | seed only | `whatsapp.ts:208-218` | ✓ |
| `manual_overrides` | external (operator console / importer) | `manualOverrides.ts:92-96` | ✓ |
| `token_failures` | `tokenFailures.ts:291-294` | `postgresReaders.ts` has no reader (operator UI reads directly from operator route, intentionally) | ✓ — write-only from notifier; operator reads via dedicated `/operator/token-failures` route (out of scope here). |

**No reader consumes a column never written.** **No writer emits a column never read** with one exception: `data_daily.updated_at` is trigger-managed (migration `20260522010146`), populated by Postgres BEFORE INSERT/UPDATE — writers never set it, reader hits it via the dedicated `fetchDataDailyLastWriteAt`. Symmetric.

**store_name column gap (intentional, documented):** `campaigns_daily`, `ads_daily`, `orders_attribution`, `product_catalog` do NOT have a `store_name` column. The readers backfill from the hardcoded `STORE_NAME_BY_ID` map (`postgresReaders.ts:566-570`). Identical to the `STORE_NAMES` map in `cronDaily.ts:84` + `cronLive.ts:133-137` + `shopify.ts:114`. **Three copies of the same 3-entry map.** Cosmetic — flag as P2-06.

### P2-06 — `STORE_NAMES` map duplicated 4 times
- **Files:** `cronDaily.ts:84`, `cronLive.ts:133-137`, `shopify.ts:114-118`, `postgresReaders.ts:566-570`
- **Failure mode:** Adding a new store means editing 4 files. The stores table is already the source of truth; a single import from `platformsByStore.ts` (or a new `stores.ts`) would dedupe.

---

## Fetcher table

| Provider | File | 4xx vs 5xx | 429 backoff? | Token-failure alert? | Pagination correct? | Currency handling |
|---|---|---|---|---|---|---|
| Shopify (orders) | `shopify.ts:471-485, 525-547` | Both → `throw new Error(... ${res.status}: ${body})` | ❌ No. Inngest retries the whole step on throw. | ✓ — wired in `cronDaily.ts:255-266` + `cronLive.ts:634-644`. Both call `notifyTokenFailure('shopify', ...)`. | ✓ — `Link: <…>; rel="next"` header parsed at `:355-360`; 50-page cap with `console.warn` at hit. Both windows (created_at + updated_at) fetched + deduped. | All 3 stores native CAD per project memory — no FX needed in fetcher. |
| Shopify (catalog) | `shopify.ts:702-755` | same `throw` pattern | ❌ | ✓ same wiring | ✓ Link-header pagination, 50-page cap | n/a |
| Shopify (orders-attribution) | `shopify.ts:1031-1079` | same | ❌ | ✓ | ✓ Link-header pagination | per-line CAD allocation via `computeLineItemsCad` (CAD-native) |
| Meta /insights (adset) | `meta.ts:340-385` | `throw new Error(... ${res.status}: ${body})` — body INCLUDES Meta's error code (190 / 102 / 460) | ❌ | ✓ — `cronDaily.ts:315-328`, `cronLive.ts:739-751` — `isAuthError('meta', errMsg)` matches `"code":190` patterns. | ✓ — `body.paging?.next` cursor, 50-page cap (`safety < 50`), warn on hit. | account_currency from body; FX conversion deferred to cron's `cadFor` closure. |
| Meta /insights (ad) | `meta.ts:529-575` | same | ❌ | ✓ | ✓ | same |
| Meta /insights (account, LIGHT) | `meta.ts:449-466` | same | ❌ | ✓ | n/a (single row, level=account) | same |
| Meta /campaigns + /adsets (budgets) | `meta.ts:710-786` | **Soft-fail per page** — logs `console.warn` and `break`s out of pagination instead of throwing. Partial budget map is preferable to a hard fail (per MetaAds.gs:218-221 parity). | ❌ | ❌ NOT wired through `notifyTokenFailure`. The /campaigns and /adsets paths only log to console. If the operator's Meta token dies, the budgets fetch logs a warning but no alert fires from THIS code path; the alert comes from the INSIGHTS path catch in cronDaily. Acceptable but worth noting. | ✓ — both endpoints paginated, 50-page cap, warn on hit. | Account currency fetched separately at `:670-700`; defaults to ILS with loud warn on missing |
| Meta WhatsApp Cloud (template send) | `whatsapp.ts:151-167` | `throw new Error(... HTTP ${res.status}: ${body})` | ❌ | ✓ — `cronDaily.ts:295 → tokenFailures.ts:227-232`. WhatsApp token failure ALSO routes through `notifyTokenFailure(provider:'whatsapp')`. **However the alert send path uses the SAME WhatsApp endpoint — if WhatsApp's token is dead, the alert can't notify via WhatsApp.** `tokenFailures.ts:240-243` documents this honestly. DB row still records. | n/a | n/a |
| Google Ads OAuth refresh | `googleAds.ts:216-245` | `throw new Error(... HTTP ${res.status}: ${text})` | ❌ | ✓ — wiring at `cronDaily.ts:363-372`, `cronLive.ts:762-771`. Pattern matches `INVALID_GRANT` / `refresh_token`. | n/a | n/a |
| Google Ads GAQL search | `googleAds.ts:295-345` | `throw` on non-200 | ❌ — but `runGaqlQuery` DOES correctly iterate `nextPageToken` (CR-01 fix). 50-page cap with warn (`googleAds.ts:337-343`). | ✓ via the cron catch — same path | ✓ — pageToken correctly assigned BEFORE the break check (Phase 12.5 fix at `:329-335` documented) | uzoshop is CAD-native; `customer.currencyCode` captured at `:384` but not used for FX |
| Google Ads ad-group statuses (no-date) | `googleAds.ts:712-767` | `throw` (inherited from runGaqlQuery) | ❌ | ✓ via cron catch | ✓ | n/a |
| TikTok /report (account spend) | `tiktok.ts:267-304` via `tiktokGet:143-176` | Two-layer: HTTP status thrown + envelope `code !== 0` thrown with TikTok's diagnostic (`code=40104` etc) | ❌ | ✓ — `cronDaily.ts:417-426`, `cronLive.ts:785-794`. Pattern matches `\b40104\b` / `\b40105\b`. | n/a (single row for account-level) | account currency cached via `fetchTikTokAdvertiserInfo`; FX at write time |
| TikTok /report (ad insights) | `tiktok.ts:432-580` | same | ❌ | ✓ | ✓ — `page_info.total_page` honored, 50-page cap, warn on hit | same |
| TikTok /adgroup/get/ (statuses) | `tiktok.ts:353-430` | **Soft-fail per page** — logs `console.warn` and returns partial Map. Matches Meta-budgets pattern. | ❌ | ❌ Same as Meta-budgets — soft-fails to empty Map without firing the alert (the cron's parent catch wires it for the report endpoint, but not for THIS endpoint's catch path). Acceptable; flagged here for completeness. | ✓ | n/a |
| TikTok /advertiser/info/ | `tiktok.ts:225-256` | throws (no soft-fail; currency is load-bearing for FX). Phase 05.7.8 fix at `:236-238` quotes the advertiser_id string to fix `code=40002`. | ❌ | ❌ This call is INSIDE `fetchTikTokSpendForDay` / `fetchTikTokAdInsights` which DO have the cron's auth-error wiring. So an auth failure propagates up and IS alerted. OK. | n/a | n/a |
| Frankfurter FX | `fx.ts:45-72` | `throw` on non-200 OR on missing `rates[to]` | ❌ | ✓ via the cron's `cadFor` closure / persist-batch warn (NOT via `notifyTokenFailure` — Frankfurter has no auth; FX outage is not a token problem). Cron-live's `cadConvert` returns `null` on failure (`cronLive.ts:706-725`) so the spend column is omitted, prior preserved. | n/a | n/a |
| Shopify OAuth (`shopifyAuth.ts`) | `shopifyAuth.ts:83-103` | `throw new Error(... HTTP ${res.status}: ${errBody})` | ❌ | ❌ — the OAuth exchange path does NOT directly call `notifyTokenFailure`. The cron's catch block (`cronDaily.ts:255` etc) catches the throw — `isAuthError('shopify', errMsg)` matches the `Shopify OAuth token exchange failed` substring? Let me verify: the regex includes `/401|403|unauth.../` GENERIC patterns — the OAuth failure message format is `Shopify OAuth token exchange failed for "{storeId}" (HTTP {status}): {body}`. For a 401, the substring `401` is present → caught. For a 5xx or network error, NOT caught — no operator alert, just a silent retry-burst. | n/a | n/a |

---

## Migration table

| Filename | Purpose | Additive? | Idempotent? | Notes |
|---|---|---|---|---|
| `20260521063112_initial_schema.sql` | 10-table initial schema | ✓ | ❌ no `IF NOT EXISTS` on the `CREATE TABLE` statements | First migration. Discipline doc rule 3 says "never edit a pushed migration". Not idempotent if re-run on a non-empty DB — but it's the initial migration, so it's expected to run exactly once on a fresh DB. Acceptable. |
| `20260521063301_seed_stores.sql` | seed 3 stores + 2 notification rows | ✓ | ❌ raw `INSERT INTO` — will conflict if re-run | **Superseded** by `20260521075829_make_seeds_idempotent.sql` which re-applies the same seeds with `ON CONFLICT DO NOTHING`. The original is "frozen by D-B4". Compliant per the discipline doc. |
| `20260521075741_add_constraints_and_grants.sql` | UNIQUE / FK / CHECK constraints + `GRANT SELECT TO anon` | ✓ | ❌ — `ADD CONSTRAINT` without `IF NOT EXISTS` (per migration header, but the constraint names ARE unique, so re-run would fail on the first DUPLICATE_OBJECT). Header docstring claims "Safe to re-run" but that's only true on a fresh DB. | **GRANT audit:** `GRANT SELECT ON ... TO anon` for 10 tables. No grant to `authenticated` role — but `authenticated` isn't used (the dashboard uses anon for reads, service_role for writes — per `supabase.ts:6-9`). Least-privilege: ✓. |
| `20260521075829_make_seeds_idempotent.sql` | re-apply seeds with `ON CONFLICT DO NOTHING` | ✓ | ✓ idempotent | Documented compliance pattern (WR-03). |
| `20260521192312_add_data_daily_gross_refund_columns.sql` | `ADD COLUMN IF NOT EXISTS gross_revenue_cad, refund_deduction_cad` | ✓ | ✓ | |
| `20260522002225_add_data_daily_tiktok_spend.sql` | `ADD COLUMN IF NOT EXISTS tt_spend_cad` | ✓ | ✓ | |
| `20260522010146_add_data_daily_updated_at.sql` | column + trigger | ✓ | ✓ `DROP TRIGGER IF EXISTS` then `CREATE TRIGGER`. `CREATE OR REPLACE FUNCTION`. | |
| `20260522015042_add_updated_at_to_3_dailies.sql` | same for campaigns/products/ads | ✓ | ✓ same patterns | |
| `20260522102151_add_tiktok_platform_check.sql` | **DESTRUCTIVE** — drops 2-value CHECKs to add 3-value CHECKs | ❌ but properly headered | ✓ `DROP CONSTRAINT IF EXISTS` | Header `-- DESTRUCTIVE: ...` is on line 1. Discipline-compliant. P2-05 flagged. |
| `20260522180000_add_campaigns_daily_effective_status.sql` | `ADD COLUMN IF NOT EXISTS effective_status` | ✓ | ✓ | |
| `20260523080000_add_token_failures.sql` | `CREATE TABLE IF NOT EXISTS token_failures` + index + grants | ✓ | ✓ `CREATE TABLE IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS` | CHECK constraint pins `provider IN ('meta', 'google', 'tiktok', 'whatsapp', 'shopify', 'fx')` — matches `TokenFailureProvider` enum exactly. |

**No `DROP COLUMN`, `DROP TABLE`, `ALTER TYPE` that breaks readers.** Migration `_add_tiktok_platform_check.sql` is the ONLY destructive change and it's properly tagged + safe (constraint widening).

---

## OAuth refresh assessment

### Google Ads — **AT RISK per project memory**
- **Refresh logic:** `googleAds.ts:187-246` (`getAccessToken`). Module-level cache `Map<storeId, {token, expiresAt}>`. Cached until 60s before declared expiry. Refresh hits `https://oauth2.googleapis.com/token` with `grant_type=refresh_token`.
- **Refresh token storage:** env var `${STORE}_GOOGLEADS_REFRESH_TOKEN` or global `GOOGLEADS_REFRESH_TOKEN`. **Token is read-only from process.env — never written back.** Google's refresh-token rotation isn't required for this flow (refresh tokens don't rotate by default in the installed-app flow).
- **Failure handling:** On refresh failure, the cron's catch block calls `notifyTokenFailure('google', ..., advice: 'Re-run the OAuth Playground flow…')`. The operator gets a WhatsApp alert with the right remediation.
- **Known operational risk per memory:** The `roas-tracker-ga` OAuth consent screen is in **Testing** mode. Google auto-expires refresh tokens for Testing-mode OAuth apps every 7 days. Current token expires ~2026-05-30 (6 days from audit date). **No proactive expiry detection in code.** Flagged P1-03 above.

### Meta — Not at risk (manual long-lived tokens)
- **Refresh logic:** None — Meta access tokens are manually-minted long-lived tokens or System User tokens. No `getAccessToken` helper. Token is read from env at every call.
- **Failure handling:** Cron catch block wires `notifyTokenFailure('meta', ..., advice: 'Refresh the Meta access token in Vercel…')`.
- **Rotation cadence:** System User tokens are effectively permanent unless revoked. User access tokens expire every ~60 days. The User Manual covers refreshing.

### TikTok — Not at risk (permanent advertiser token)
- **Refresh logic:** None — token is the OAuth-handshake-derived permanent advertiser token (per `tiktok.ts:47-51`). Read from env at every call.
- **Failure handling:** Cron catch wires `notifyTokenFailure('tiktok', ..., advice: 'Re-authorize TikTok via /api/oauth/tiktok/callback…')`.

### Shopify — Cached 24h client_credentials token
- **Refresh logic:** `shopifyAuth.ts:53-110` (`getShopifyAccessToken`). Module-level `Map<storeId, {accessToken, expiresAt}>`. Refresh 60s before expiry. Hits `https://{domain}/admin/oauth/access_token` with `grant_type=client_credentials`.
- **Refresh token storage:** Client ID + Client Secret in env vars (`${STORE}_SHOPIFY_CLIENT_ID` + `${STORE}_SHOPIFY_CLIENT_SECRET`). No refresh-token concept.
- **Failure handling:** Throws on bad credentials. Cron catch wires `notifyTokenFailure('shopify', ...)`. **Caveat (see fetcher table above):** the OAuth-failure message includes the literal substring `OAuth token exchange failed` — `isAuthError('shopify', errMsg)` matches on the `HTTP {401|403}` part but NOT on a 5xx → for 5xx failures, no operator alert. Low risk (Shopify OAuth is rarely 5xx).

### WhatsApp — Permanent System User token
- **Refresh logic:** None — `WHATSAPP_ACCESS_TOKEN` is a permanent System User token per the User Manual. No `getAccessToken` helper.
- **Failure handling:** Cron-daily / cron-live both wire token failures via the cron's catch. The token-failure-ALERT itself goes via WhatsApp — chicken-and-egg risk documented in `tokenFailures.ts:240-243`.

---

## Notes for other tracks

- **Algorithms Track (02):** the `shopifyRevenueRefunds.computeRevenueWithCrossDayRefunds` import chain is consumed by `shopify.ts:60-62` and ONLY by `shopify.ts`. cronDaily and cronLive both go through `fetchShopifyDayRows`. Single canonical algorithm path, single test surface — no algorithm drift risk from the pipeline side.

- **Architecture Track (04):** the two monolithic files (`cronDaily.ts` 1278 LOC, `cronLive.ts` 1428 LOC) are documented in P2-03 above. Both have natural decomposition seams at the per-table writer level. Splitting them into one module per Inngest function + a shared `persistTables.ts` would not change behavior.

- **Maturity Track (05):** test coverage is solid for the Inngest functions themselves (14 test files in `__tests__/`). The notifier (`tokenFailures.ts`) has 1 short test file — could use more cases for the throttle/upsert race.

- **Security Track (01):** the `service_role` key is correctly server-only (per `supabaseAdmin.ts:14-20`). Allowlist enforcement on WhatsApp recipients is gated by `NOTIFICATION_RECIPIENT_ALLOWLIST` env (`whatsapp.ts:93-108`) — operator should set this to `+972524809540` per project memory to enforce the contract.

- **Perf / Observability Track (08):** the `paginate()` helper's 50K-row cap (P1-07) is a quiet failure mode; no Sentry breadcrumbs around fetcher pagination. The token-failure DB upsert path doesn't emit metrics.

- **Docs Track (07):** the route.ts header drift (P0-01) and the cronLive `*/15` comment drift in `:1379` are doc/code drift concerns. The migration discipline doc is self-consistent; no drift there.

---

## Verification commands (for the operator, no localhost)

```bash
# Check all 11 Inngest functions are visible in Inngest cloud (must match the
# table above). Operator runs in their browser, not curl:
#   https://app.inngest.com/env/production/functions
#
# Check the latest data_daily updated_at across all stores (sanity check that
# cron-live is alive):
PGSSLMODE=require psql "$SUPABASE_DB_URL" -c \
  "SELECT store_id, max(updated_at) FROM data_daily GROUP BY store_id;"
#
# Check token_failures pending alerts (operator should see this in /operator):
PGSSLMODE=require psql "$SUPABASE_DB_URL" -c \
  "SELECT provider, store_id, operation, last_seen_at, alerts_sent_count
   FROM token_failures WHERE resolved_at IS NULL ORDER BY last_seen_at DESC;"
```
