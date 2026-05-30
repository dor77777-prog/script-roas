# Performance & Observability Audit

Track 8 / 8 — Audit date 2026-05-24, `script-roas` main @ 4c3f7e9.

## Summary

The codebase has a thoughtful **caching layer** (`lib/cacheConfig.ts`, single
source of truth) and **good Inngest hygiene** for the high-volume crons (per-
platform soft-fail, per-platform preserve, idempotent UPSERTs). It also has a
solid **token-failure alerting subsystem** with throttling.

But observability is **systematically thin**: Sentry is initialised at 10%
trace sampling, that's it — no `beforeSend`, no `ignoreErrors`, no `replays`,
no scrubbing, no server-side `captureException` calls outside the React
`ErrorBoundary`. Every API route swallows errors to `console.error` (Vercel
logs), so Sentry sees ZERO of the soft-failed Postgres errors, ZERO of the
Inngest cron failures, ZERO of the token-failure attempts, ZERO of the
`/api/operator/*` mutations. Sentry's `onRequestError` hook is wired through
`instrumentation.ts`, so Next.js render-time errors are caught — but every
"degrade gracefully to 200 + empty rows" path is invisible to Sentry.

Cost surface is dominated by **Inngest steps and step-output sizes**. The two
big cron functions are correctly decomposed (~6 steps for daily, 6–8 steps for
live), but the **`fetch-shopify` step in cron-daily returns the full Shopify
day payload — orders + line-items + product catalog — through Inngest's step
memoization layer**, which Inngest charges by step-output bytes. Same for
`fetch-meta`, `fetch-google`, and `refresh-effective-status`. Per-store
cron-live runs 6–8 steps × 3 stores × 144 ticks/day = **~3,000 step
invocations/day plus 540 from cron-daily** — at large account sizes the
payload bytes dominate the bill, not the count.

Bundle is reasonable but **front-page first-load JS is 437 kB** (single
massive client bundle), driven by Recharts on the landing page. No dynamic
imports for chart-heavy components, no virtualisation on the 2,464-line
`CampaignsTable` (every component is `'use client'`).

The **alert matrix has one channel** (WhatsApp to `+972524809540`) and covers
exactly two events: daily summary (3×/day) and token-auth failures (cron-side
only). Cron failures themselves, Vercel deploy failures, Sentry error-rate
spikes, Supabase outages, and CDN errors are NOT alerted.

---

## P0 — Silent failure modes, missing critical alerts, runaway cost risk

### P0-1 — Sentry never sees Postgres/Supabase errors
**Impact:** Blind spot for the most likely production failure (Supabase quota,
schema drift, RLS misconfig). Operator only sees errors as "no data" in the
dashboard banner.

**Evidence:** Every API route follows the same pattern:
- `/api/data/route.ts:68-95` — catches error → `console.error()` → returns 200
  with `error` field.
- `/api/campaigns/route.ts:81-94`, `/api/products/route.ts:56-67`,
  `/api/ads/route.ts:52-64`, `/api/orders-attribution/route.ts:59-79`,
  `/api/dashboard-state/route.ts:43-61`, `/api/store-meta/route.ts:26-34`,
  `/api/product-catalog/route.ts:35-42` — same shape.
- Grep `/Users/dorperetz/script-roas/dashboard-web/src/app/api/**` for
  `captureException` returns ZERO hits.

**Remediation:** Add `Sentry.captureException(err, { tags: { route: 'data', kind: 'postgres' } })`
inside each catch BEFORE the `console.error`. ~7 routes × 2 lines each. Keep
the soft-fail 200 response so UX doesn't regress.

### P0-2 — Sentry never sees Inngest function failures
**Impact:** Cron-daily / cron-live failures that exhaust the 4-retry budget
end up as "dead-lettered" in the Inngest dashboard. Operator must remember to
log into Inngest separately to see them — they are not surfaced to Sentry, not
alerted via WhatsApp, not visible from the dashboard.

**Evidence:** Grep for `Sentry\.captureException` in
`/Users/dorperetz/script-roas/dashboard-web/src/inngest/functions/` returns
ZERO hits. The functions throw + Inngest retries — there is no Sentry
instrumentation around the throw site. cronDaily.ts:267 (Shopify throw),
cronDaily.ts:651 (data_daily upsert throw), cronLive.ts:1033, cronLive.ts:1170
all re-throw without Sentry.

**Remediation:** Either (a) wrap the outer `inngest.createFunction` handler in
a try/catch that does `Sentry.captureException` then re-throws, or
(b) configure Inngest's webhook signature failure handler to call Sentry on
the `/api/inngest/route.ts` boundary. The right level is (a) — top of each
function in `cronDaily.ts:1266`, `cronLive.ts:1404`, `cronWhatsapp.ts:54`,
`eventBackfill.ts:209`, `eventSyncNow.ts`. The token-failure alerter handles
auth-shaped fetcher errors, but generic 500s / Supabase write failures are
not alerted anywhere.

### P0-3 — No alert when cron-daily silently writes zeros
**Impact:** The 2026-05-23 audit fix in `cronDaily.ts:299-335` makes every
platform fetcher soft-fail to zero spend. This is intentional (prevents one
dead platform from breaking the others), but if the operator doesn't notice
the zero in the dashboard, an entire day's spend can be lost from Meta /
Google / TikTok without any alarm. `notifyTokenFailure` fires ONLY when
`isAuthError()` recognises the message — non-auth errors (5xx, network,
schema drift) zero the platform AND go silent.

**Evidence:** `cronDaily.ts:310-335` — Meta fetch catch:
```ts
console.warn(`cron-daily ${storeId} ${dateStr}: Meta fetch failed — zeroing Meta contribution ...`);
if (isAuthError('meta', errMsg)) { await notifyTokenFailure(...); }
// else: silent zero
return { spend: { ..., spend: 0, currency: 'ILS' }, adsetRows: [], adRows: [], budgets: ... };
```
Same in cronDaily.ts:350 (Google), cronDaily.ts:394 (TikTok), and the cron-live
parallel fetchers at cronLive.ts:733-800.

**Remediation:** Add a non-auth-error code path that ALSO calls
`notifyTokenFailure({ operation: 'fetch_zero_fallback', ... })` with a
distinct operation key. The 6-hour throttle still applies, so one cron tick =
one alert max. Or surface a "zero-spend-platform" annotation on the dashboard
data freshness chip with a daily aggregate (cheap UI fix, no extra alerts).

### P0-4 — `fetch-shopify` step output may exceed Inngest's per-step cap
**Impact:** Cost + retry latency. Inngest stores every step's return value to
memoize for retries. A large `step.run('fetch-shopify')` return that includes
the entire `productRows` array + `orders` array + `catalog` array is replayed
on every retry. If the JSON exceeds Inngest's hard limit (4 MB at the time of
writing on their current platform), the step fails to memoize.

**Evidence:** `cronDaily.ts:239-272` — the step returns `{ ...day, orders,
catalog }` where:
- `day.productRows` — 1 entry per product sold that day (low cap).
- `orders` (from `fetchShopifyOrdersAttribution`) — 1 entry per order **with
  line items** (a busy day for uzoshop could be 500+ orders × N line items).
- `catalog` — every product across all 3 stores' active inventory.

`cronLive.ts:625` does this every 10 minutes with a 3-day window — so the
same Shopify payload is round-tripped through Inngest's storage layer 144×/day
× 3 stores = 432 times/day per platform per date.

**Remediation:** Split `fetch-shopify` into 3 separate steps: `fetch-shopify-day`,
`fetch-shopify-orders`, `fetch-shopify-catalog`. Each step returns a tighter
payload AND can be retried independently. OR: return only `{rowCount,
totalRevenue, productRowCount}` from the step and re-fetch inside
`persist-batch`. The persist step IS retried on failure, so re-fetching is
acceptable here — just costs a bit more upstream Shopify quota.

---

## P1 — Sentry scrubbing gaps, caching gaps, hot queries

### P1-1 — No `beforeSend` / `beforeSendTransaction` in any Sentry config
**Impact:** Request bodies and URL search-params land in Sentry untouched.
`/api/operator/*` POSTs include `auth_code`, `notes` text, `confirm` tokens,
override `spend` values. If these become an error context (e.g., the body
parsing throws), they may end up in the Sentry event.

**Evidence:** `sentry.client.config.ts:5-17`, `sentry.server.config.ts:5-9`,
`sentry.edge.config.ts:5-9`. All three configs are 5-line `Sentry.init({ dsn,
tracesSampleRate: 0.1, environment })` with no `beforeSend` / `beforeSendTransaction`
/ `ignoreErrors` / `denyUrls`.

**Remediation:** Add a `beforeSend` hook to `sentry.server.config.ts` that
strips `request.data` and `request.cookies` for `/api/operator/*` routes (also
defense-in-depth for any future Bearer token mistakes). Add `ignoreErrors:
['AbortError', 'Network request failed', 'Failed to fetch']` to the client
config (these come from CDN/extension/network flakes and add noise).

### P1-2 — No `replaysSessionSampleRate` or `replaysOnErrorSampleRate` configured
**Status:** Intentional, see `sentry.client.config.ts:9-16` — replays
deliberately disabled until a privacy/consent UX exists (EU+CA B2B context).
Not a defect; called out so other tracks know the decision is documented.

### P1-3 — Dashboard root-page `revalidate=60` matches data freshness, but
`/api/health` revalidate=10s contradicts client poll of 30s
**Impact:** Marginal. The `health` endpoint can drift up to 10s, and the
client polls every 30s — net effect is the operator's "synced N seconds ago"
chip is delayed by 0-10s. No real harm.

**Evidence:** `cacheConfig.ts:32` (`health: { revalidate: 10, swr: 60 }`)
versus `health/route.ts:26` (`export const revalidate = 10`). Consistent.

### P1-4 — `fetchOrdersAttribution` reader fetches `line_items` JSONB column
even when `includeLineItems=false`
**Impact:** Wasted Supabase egress on every `/api/orders-attribution?` call
that doesn't need line items. `line_items` JSONB can be 1-5 KB per order; 500
orders/day × 3 stores = 1.5K rows × ~3 KB = ~4.5 MB transferred per request
that throws it away.

**Evidence:** `postgresReaders.ts:885-891` — the select string ALWAYS
includes `line_items`. The `includeLineItems` flag at line 880 only controls
whether the per-row parser runs. Comment at line 869 explicitly acknowledges:
> "we can't easily skip the column at the SQL level without branching the
> select string; the savings come from short-circuiting the parser"

**Remediation:** Branch the select string. Two variants:
```ts
const cols = includeLI
  ? '..., line_items'
  : '...'; // omit line_items entirely
```
~5 lines of code change in `fetchOrdersAttributionFromPostgres`.

### P1-5 — `fetchCurrentCampaignStatuses` scans 60 days × paginated
**Impact:** New addition (Phase 12.5.x) — runs on every `/api/campaigns` GET.
Pulls every campaigns_daily row for the last 60 days from Supabase (all
stores, all platforms) just to find the latest status per
(store, platform, campaign, ad-set) key. On a 3-store deployment with ~50
active ad-sets each, that's 60 days × 3 stores × 50 ad-sets × ~3 platforms ≈
**27,000 rows pulled per request** to extract ~150 distinct keys.

**Evidence:** `postgresReaders.ts:739-790` — paginated read of `campaigns_daily`
with `gte('date', since)` (60 days back). Cached at `revalidate=60` via
`/api/campaigns` (cacheConfig.ts:14), so CDN coalesces, but on cache miss the
full scan runs.

**Remediation:** Push the dedup into Postgres via a window function:
```sql
SELECT DISTINCT ON (store_id, platform, campaign_id, ad_set_id)
       store_id, platform, campaign_id, ad_set_id, effective_status, updated_at
FROM campaigns_daily
WHERE date >= now() - interval '60 days'
  AND effective_status IS NOT NULL
ORDER BY store_id, platform, campaign_id, ad_set_id, updated_at DESC;
```
Returns ~150 rows instead of ~27,000. Wrap in a Supabase RPC or inline a
`.rpc()` call. Even without an RPC, a `LIMIT` + index on `(store_id,
platform, campaign_id, ad_set_id, updated_at DESC)` would help massively;
check current index coverage in `supabase/migrations/`.

### P1-6 — `/api/operator/jobs` fan-out runs N+1 requests against Inngest REST
**Impact:** Up to 51 fetches per `/api/operator/jobs` poll (1 events list +
50 per-event runs). Polled every 15s by JobsTable. Cached at `revalidate=5`
(operatorJobs in cacheConfig.ts:55), so CDN coalesces — but the underlying
fan-out is still expensive on cache miss.

**Evidence:** `operator/jobs/route.ts:131-183`. Already audited and fixed
to run via `Promise.allSettled` (API-23, Phase 12.3), so wall-clock is
bounded by max-per-call latency, not sum. NOT a regression. Listed for cost
visibility only.

**Remediation:** None required — the parallel fan-out + 5s cache is a
reasonable trade-off. Long-term, Inngest may expose a `/v1/runs?function_id=...`
endpoint that collapses this to a single call; revisit then.

### P1-7 — Health route `pingSupabase` uses `count: 'exact', head: true`
**Status:** Correct pattern. `head: true` means no row data is transferred,
only metadata + count. This is the idiomatic Supabase "is the DB reachable"
ping. (`health/route.ts:42-47`). Not a defect — calling out as a good
pattern that should be preserved.

---

## P2 — Bundle bloat, rerender hotspots, cleanup

### P2-1 — Front-page first-load JS = 437 kB
**Impact:** Mobile / slow-connection users wait longer. Most of this is the
massive `'use client'` Dashboard tree + Recharts.

**Evidence:** `npm run build` output:
```
Route (app)                  Size  First Load JS
┌ ○ /                     262 kB         437 kB
└ ○ /operator           8.65 kB         183 kB
```
Shared chunk `chunks/727-4531319cf7213f43.js` is **111 kB** — likely Recharts +
Sentry + lucide-react. The `/` route alone adds 262 kB on top.

**Remediation:**
1. **Dynamic-import Recharts** in the components that use it (`HeroOverview`,
   `RoasChart`, `CampaignsTable`, `CampaignDrawer`, `MetaShopifyReconciliation`).
   `const RoasChart = dynamic(() => import('@/components/RoasChart'), { ssr: false });`
   Estimated savings: 60-80 kB off the initial bundle.
2. Audit `lucide-react` imports — Next.js can tree-shake if you import named
   icons only (`import { ChevronDown } from 'lucide-react'`) and not the
   barrel. Grep current imports.
3. Lazy-load `BillingSettings` (1,164 lines, only opened from
   `CommandPalette`).

### P2-2 — `CampaignsTable.tsx` is 2,464 lines, all client, no virtualisation
**Impact:** At ~150 active campaigns × 3 stores (~450 rows visible in
"campaign" mode, ~1,500 in "adset" mode), rendering is fine. At 10K rows
(operator-described future scale), naive rendering would lag.

**Evidence:** No `react-window` / `react-virtuoso` / `react-virtual` imports
anywhere in the codebase (grep returned 0). `CampaignsTable` maps directly
over `aggregatedFiltered`. The component IS heavily memoized (17 `useMemo`
calls, no `useCallback`, no `React.memo` on `CampaignsTableRow`).

**Remediation:**
- Add `React.memo(CampaignsTableRow)` (low effort, large win — every row
  re-renders today when any sibling state changes).
- Defer virtualisation until row count exceeds ~5K — not urgent.

### P2-3 — Every component is `'use client'`
**Impact:** Zero server-component benefit. The entire dashboard hydrates
client-side, including read-only display components that could be RSC.

**Evidence:** `find dashboard-web/src/components -name '*.tsx' -exec grep -L "'use client'" {} \;`
returns no files — every component is client.

**Remediation:** Low priority for an internal single-user tool. The dashboard
is interactive (filters, drawers, SWR polling) so most components legitimately
need client. Could split out leaf display components (`HealthScoreBadge`,
`StoreChip`, etc.) into pure RSC, but the bundle-size impact is marginal.

### P2-4 — `aiReport.ts` is misnamed — it generates a markdown blob, not an LLM call
**Impact:** None functionally — but the audit prompt asked about
"Observability for the AI report flow." There is NO external LLM call in this
codebase. `aiReport.ts:105 generateAiReport()` synthesises Markdown locally;
the user copy-pastes the output into ChatGPT/Claude/Gemini manually. There's
nothing to instrument latency / tokens for.

**Evidence:** Grep returned no `anthropic` / `openai` / `claude-3` /
`@anthropic-ai/sdk` imports anywhere. `aiReport.ts:1-30` docstring confirms
the user-paste pattern.

**Remediation:** None. Worth noting in the docs (e.g., dashboard README)
because the name "aiReport" misleads readers into thinking there's an LLM
integration.

### P2-5 — `next.config.ts` lacks `outputFileTracingRoot`, triggers warning
**Impact:** Cosmetic. Next.js prints a warning every build about multiple
lockfiles (`/Users/dorperetz/script-roas/package-lock.json` + `dashboard-web/package-lock.json`).
No functional issue.

**Evidence:** Build output line 1:
> `⚠ Warning: Next.js inferred your workspace root ... To silence this
> warning, set outputFileTracingRoot in your Next.js config, or consider
> removing one of the lockfiles if it's not needed.`

**Remediation:** Add `outputFileTracingRoot: path.join(__dirname, '..')` to
`next.config.ts` OR delete the root-level lockfile if unused.

### P2-6 — Sentry build warns about missing `global-error.js`
**Evidence:** Build output:
> `warn - It seems like you don't have a global error handler set up. It is
> recommended that you add a global-error.js file with Sentry instrumentation
> so that React rendering errors are reported to Sentry.`

**Remediation:** Add `dashboard-web/src/app/global-error.tsx` that wraps the
ErrorBoundary pattern and calls `Sentry.captureException` at the top level.
Documented in Sentry's Next.js setup guide; ~15 lines of boilerplate.

### P2-7 — Sentry build warns about source-maps shipped to clients
**Evidence:** Build output:
> `[@sentry/nextjs] The Sentry SDK has enabled source map generation for your
> Next.js app. If you don't want to serve Source Maps to your users, either set
> the sourcemaps.deleteSourcemapsAfterUpload option to true...`

The `next.config.ts:21` already sets `hideSourceMaps: true`, which prevents
the `.map` URL comments from being injected but doesn't delete the maps. For
an internal-trust-model tool this is acceptable; flag for awareness.

**Remediation:** Optional — add `sourcemaps: { deleteSourcemapsAfterUpload: true }`
to the `withSentryConfig` options block in `next.config.ts`.

---

## Sentry config assessment

| File | tracesSampleRate | beforeSend | ignoreErrors | replays | captureException sites |
|---|---|---|---|---|---|
| `sentry.client.config.ts` | 0.1 ✅ | ❌ | ❌ | ❌ (intentional, see comment) | 1 (`components/ErrorBoundary.tsx:19`) |
| `sentry.server.config.ts` | 0.1 ✅ | ❌ | ❌ | n/a | 0 |
| `sentry.edge.config.ts` | 0.1 ✅ | ❌ | ❌ | n/a | 0 |
| `instrumentation.ts` | (handler only) | n/a | n/a | n/a | 1 (`onRequestError` wrapper) |

**Coverage gaps:**
- 0 Sentry calls in any API route's catch block (`src/app/api/**`).
- 0 Sentry calls in any Inngest function (`src/inngest/functions/**`).
- 0 Sentry calls in fetcher catch blocks (`src/lib/fetchers/**`).
- No `global-error.tsx` (Next.js 15 App Router requirement for React render
  errors to reach Sentry — see warning in build output).

**The single positive:** `instrumentation.ts:30-40` correctly defers Sentry
loading until a DSN is configured (no overhead in localhost / preview without
a DSN). The DSN-gating pattern is repeated in all 4 config files.

---

## Caching matrix (route → Cache-Control → recommendation)

| Route | Method | `revalidate` (s) | `s-maxage`/`swr` | Recommendation |
|---|---|---|---|---|
| `/api/data` | GET | 60 | 60/120 | ✅ Reasonable for aggregated read |
| `/api/campaigns` | GET | 60 | 60/120 | ✅ |
| `/api/products` | GET | 60 | 60/120 | ✅ |
| `/api/ads` | GET | 300 | 300/900 | ✅ — heavy table, lower cadence fits |
| `/api/orders-attribution` | GET | 300 | 300/900 | ✅ |
| `/api/store-meta` | GET | 3600 | 3600/86400 | ✅ |
| `/api/product-catalog` | GET | 60 | 60/300 | ✅ |
| `/api/dashboard-state` | GET | 30 | 30/60 | ✅ — operator config |
| `/api/dashboard-state` | POST | n/a (no cache) | n/a | ✅ |
| `/api/health` | GET | 10 | 10/60 | ✅ |
| `/api/operator/jobs` | GET | 5 | 5/30 | ✅ — operator console polling |
| `/api/operator/manual-overrides` | GET/POST/PATCH/DELETE | force-dynamic | no-cache | ✅ — correct for CRUD |
| `/api/operator/sync-now` | POST | force-dynamic | no-cache | ✅ |
| `/api/operator/backfill` | POST | force-dynamic | no-cache | ✅ |
| `/api/operator/reset` | POST | force-dynamic | no-cache | ✅ |
| `/api/operator/notifications/send` | POST | force-dynamic | no-cache | ✅ |
| `/api/operator/token-failures` | GET/POST | force-dynamic | no-cache | ✅ — operator wants live state |
| `/api/inngest` | GET/POST/PUT | (default dynamic) | no-cache | ✅ — webhook |
| `/api/oauth/tiktok/callback` | GET | force-dynamic | no-cache | ✅ |
| `/api/debug/shopify-fetch` | GET | force-dynamic | no-cache | ⚠️ Debug endpoint shipped to prod — should be removed or gated by env-var |

**No routes are missing cache declarations.** This is well-disciplined work.
Caching pattern is the single best-implemented surface in this codebase.

**One concern:** `/api/debug/shopify-fetch/route.ts:11` is `force-dynamic` and
publicly reachable. It DOES protect the token (API-10 fix; `hasToken: true`
boolean) but it still hits the Shopify Admin API as a side-effect of any GET
request. Recommend gating by `if (process.env.DEBUG_ENDPOINTS_ENABLED !== '1') return 404;`.

---

## Postgres query review

`postgresReaders.ts` overall is well-disciplined:

| Reader | Projection | Range pushdown | Pagination | Issue |
|---|---|---|---|---|
| `fetchDailyDataFromPostgres` | Explicit cols ✅ | `.gte/.lte` ✅ | `paginate()` ✅ | none |
| `fetchStoreMetaFromPostgres` | Explicit ✅ | n/a | none (single page) | rows ≤ 3 — fine |
| `fetchDashboardStateFromPostgres` | Explicit ✅ | n/a | none | rows ≤ ~50 — fine |
| `fetchProductsFromPostgres` | Explicit ✅ | `.gte/.lte` ✅ | `paginate()` ✅ | none |
| `fetchCampaignsFromPostgres` | Explicit ✅ | `.gte/.lte` ✅ | `paginate()` ✅ | none |
| `fetchAdsFromPostgres` | Explicit ✅ | `.gte/.lte` ✅ | `paginate()` ✅ | none |
| `fetchOrdersAttributionFromPostgres` | Explicit ✅ | `.gte/.lte` ✅ | `paginate()` ✅ | **P1-4** — `line_items` always selected |
| `fetchProductCatalogFromPostgres` | Explicit ✅ | n/a | `paginate()` ✅ | none |
| `fetchCurrentCampaignStatuses` | Explicit ✅ | `.gte('date')` ✅ | `paginate()` ✅ | **P1-5** — pulls ~27K rows to extract ~150 |
| `fetchTableLastWriteAt` (×4) | Single col ✅ | optional range | `.limit(1)` ✅ | excellent pattern |

- No `.select('*')` anywhere ✅
- All readers use explicit column lists ✅
- Range filters are SQL-pushed (`.gte`/`.lte`) rather than JS-filtered ✅
- Pagination via the custom `paginate()` helper bypasses Supabase's 1000-row
  PostgREST cap ✅
- Hard cap of 50 chunks × 1k = 50k rows (`paginate.MAX_CHUNKS`) prevents
  runaway loops ✅
- N+1 risk: cron-live's `select-prior-spend-${date}-${storeId}` is per-date
  (cronLive.ts:870-888) but bounded to 3 dates — fine, AND each is a
  separately-memoized Inngest step (deliberate INN-10 audit fix).

The dashboard's per-tab `dataLastWriteAt` chip queries (`fetchTableLastWriteAt`)
are particularly well-done: `order('updated_at' DESC).limit(1)` is cheap.

---

## Inngest step accounting

### `cron-daily-{store}` — 6 steps per run, 3 runs/day
1. `fetch-shopify` — parallel Shopify day + orders + catalog → **LARGE PAYLOAD** (P0-4)
2. `fetch-meta` — parallel insights + ad-insights + spend + budgets → medium payload
3. `fetch-google` — parallel spend + ad-group + ad insights → medium payload
4. `fetch-tiktok` — parallel spend + ad insights (uzoshop only) → medium payload
5. `apply-manual-overrides` — DB read → small payload
6. `persist-batch` — all DB writes → **EMPTY payload** ✅ (returns void)

**Total exec count:** 6 steps × 3 stores × 30 days = **540/month** ✅ matches
the inline budget comment at `cronDaily.ts:23-26`.

**Payload sizes (estimated from code, NOT measured in prod):**
- `fetch-shopify` returns `{...day, orders, catalog}` where `orders` has full
  line_items, `productRows` per-product, and `catalog` is every product. A
  busy uzoshop day = 500 orders × 5 line items × ~200 bytes each ≈ **500 KB
  per step return**, persisted in Inngest's storage for retry replay.
- `fetch-meta` returns `{spend, adsetRows, adRows, budgets}` — ~150 ad-sets ×
  ~10 fields ≈ 50 KB.
- `fetch-google` similar shape ≈ 30 KB.
- `fetch-tiktok` ≈ 20 KB.

**Total step-output per cron-daily run: ~600 KB × 3 stores = 1.8 MB/day.**
At ~$0.X/MB Inngest pricing (varies by plan), this is the dominant cost
driver, not the 540 execs/month.

### `cron-live-{store}` — 6-8 steps per run, 144 runs/day (every 10 min)
1. `fetch-shopify-rolling-3day` — 3-day Promise.all → ~150 KB per run × 144 = **21 MB/day per store**
2. `fetch-meta-google-tiktok-spend-light-3day` — 9 fetches (3 plat × 3 days) → light payload, ~10 KB
3. `fetch-shopify-orders-attribution-today` — single day orders → ~100 KB on busy days
4. `select-prior-spend-${date}-${storeId}` × 3 (one per date in rolling) — each ~50 bytes ✅
5. `persist-rolling-3day` — void return ✅
6. `refresh-effective-status` — void return ✅

**Total exec count:** 6-8 steps × 3 stores × 144 ticks = **2,592-3,456/day = ~78K/month**.
Significantly higher than the inline budget comment (cronLive.ts:24-25 quotes
~25.9K/month for "2 step.runs × 3 stores × 144 ticks/day") because the audit
fixes (INN-10 select-prior-spend, refresh-effective-status, fetch-meta-google-tiktok-spend)
added more steps. Now closer to **the upper edge of the Inngest free-tier
50K/month cap** (or pushing into the next billing tier).

The `select-prior-spend-${date}-${storeId}` × 3 dates is **the most expensive
addition** per the inline note at cronLive.ts:864-868 ("Inngest exec budget:
+3/tick. cron-live budget rises from ~25.9K/month → ~38.9K/month") — the
correctness justification (INN-10) is solid, but exec count is now > free
tier.

### `event-backfill` — 6 steps × N pairs × 1 outer = variable, but capped at
21-day × 3-store backfill = 63 pairs × 6 + 1 = **379 execs per backfill click**.
Documented in `eventBackfill.ts:53-61`.

### `whatsapp-{noon,evening,eod}` — 1 step × 3 functions × 1 run/day each = **3 execs/day = ~90/month** ✅

---

## Bundle analysis (top 5 routes + First Load JS)

From `npm run build` output (committed at the head of the file):

| Route | Size | First Load JS | Notes |
|---|---|---|---|
| `/` (Dashboard) | 262 kB | **437 kB** | Recharts + 689-line Dashboard.tsx + every sub-component |
| `/operator` | 8.65 kB | 183 kB | Lightweight ✅ |
| (all `/api/*`) | 340-342 B | 168 kB | Shared baseline ✅ |
| `/api/health` (static) | 341 B | 168 kB | revalidate=10s, expire=1y |

**Shared chunk breakdown:**
- `chunks/4bd1b696-61d921081ad4d180.js` — 54.4 kB (likely React + framework)
- `chunks/727-4531319cf7213f43.js` — **111 kB** (likely Recharts + Sentry + lucide-react)
- Other shared — 2.5 kB

The 111 kB shared chunk is the biggest single optimisation lever. Dynamic-
importing Recharts in just the 2-3 chart components could shave 60-80 kB off
the front-page initial load. Confirmed Recharts importers:
- `HeroOverview.tsx:15`
- `RoasChart.tsx:3`
- `CampaignsTable.tsx:25`
- `CampaignDrawer.tsx:26`
- `MetaShopifyReconciliation.tsx:12`

---

## Alert matrix (event → channel → recipient → throttle)

| Event | Channel | Recipient | Throttle | Source |
|---|---|---|---|---|
| Token-auth failure (Meta/Google/TikTok/Shopify/WhatsApp/FX) | WhatsApp `token_failure_alert` template | `+972524809540` (hardcoded) | 1 per 6h per (provider, store, operation) | `lib/notifications/tokenFailures.ts:85,90` |
| Daily summary (noon) | WhatsApp `roas_daily_summary` | `notification_config.phone1/phone2` rows | 1/day (cron) | `cronWhatsapp.ts:47` |
| Daily summary (evening) | WhatsApp same | same | 1/day | `cronWhatsapp.ts:65` |
| Daily summary (00:30 EOD) | WhatsApp same | same | 1/day | `cronWhatsapp.ts:99` |
| Inngest function failure (after 4 retries) | **NONE** | — | — | (gap) |
| Vercel deployment failure | **NONE** | — | — | (gap — relies on Vercel UI) |
| Sentry high error-rate spike | **NONE** | — | — | (gap — no Sentry alert configured per code; may be configured in Sentry UI) |
| Supabase outage | **PARTIAL** | (dashboard banner via `/api/health`) | n/a | UI only |
| CDN / Vercel 5xx | **NONE** | — | — | (gap) |
| Cron-daily zero-spend silent fallback | **NONE** when not auth-shaped | — | — | (gap — see P0-3) |

### Gaps worth filling
1. **Inngest function dead-letter alert** — when cron-daily exhausts its 4
   retries, currently surfaces only in the Inngest dashboard. The operator
   has to look. Should ping the same WhatsApp number on dead-letter.
2. **Sentry → WhatsApp bridge** for high-severity events (server crashes,
   render errors caught by ErrorBoundary). Currently fires only into Sentry.
3. **Token-failure UI panel** is documented but the read endpoint
   (`/api/operator/token-failures`) is in place — verify the operator UI
   surfaces it prominently (this is UX, not Track 8).

---

## Cost-driver summary

Approximate monthly cost order, qualitative:

1. **Inngest step output bytes** — the dominant variable cost. cron-daily's
   `fetch-shopify` step alone moves ~1.8 MB/day × 30 = ~54 MB/month through
   Inngest's memoization layer. cron-live moves ~21 MB/day × 30 = ~630
   MB/month per store. On uzoshop (the busiest) this is ~1.9 GB/month of
   step-output round-trips. Recommend P0-4 fix to halve this.

2. **Inngest step count** — at ~78K execs/month for cron-live alone (after
   the Phase 12.1.1 INN-10 fix), the project is at the upper edge of the
   free 50K/month tier. The inline budget comments in cronLive.ts are stale
   (still quote 25.9K), but the correctness fixes ARE justified. Recommend
   monitoring the Inngest dashboard's monthly invoice; if it's billing,
   consider collapsing `select-prior-spend-{date}` × 3 into a single
   `select-prior-spend-3day` step that returns a map.

3. **Vercel function invocations + duration** — the biggest API hits are
   `/api/data` (60s revalidate) and `/api/campaigns` (60s revalidate). With
   SWR polling every ~30s from the dashboard and 1-3 concurrent operators,
   CDN coalescing keeps the underlying invocation count down. The new
   `fetchCurrentCampaignStatuses` (60-day scan) is the slowest single call
   in the codebase — see P1-5.

4. **Supabase egress** — small per-request, but `fetchOrdersAttributionFromPostgres`
   always pulls `line_items` JSONB (P1-4) which is the heaviest column.

5. **Sentry events** — at 10% trace sampling and ZERO `captureException`
   calls in API/Inngest paths, Sentry usage is essentially trace-replay only.
   Cost should be negligible UNLESS one of the React render errors becomes
   recurring.

6. **Supabase storage** — small for this dataset (3 stores × ~6 months × ~daily
   rows). Negligible cost surface.

### Runaway risks
- `refresh-effective-status` step (cronLive.ts:1074) does N independent
  Supabase UPDATEs (one per enrolled ad-set, ~150 ad-sets) sequentially with
  per-iteration try/catch. At 144 ticks/day × 3 stores × 150 = **64,800
  Supabase UPDATE calls/day**. Each is small but high count. If Supabase ever
  starts metering per-request, this is the first place to bite. Recommend
  batching via `IN (...)` UPSERT or a SQL CASE-when, but it's a stretch goal.

---

## Observability for the AI report flow

**Finding:** No external LLM is called from this codebase. `lib/aiReport.ts`
synthesises a markdown report locally that the operator copy-pastes into a
chatbot of their choice. There is nothing to instrument for latency, token
usage, or external API failures.

**Evidence:** Grep returned 0 matches for `anthropic`/`openai`/`claude-3`/
`@anthropic-ai/sdk` in `dashboard-web/`. `aiReport.ts:1-30` documents the
"copy-paste into ChatGPT/Claude/Gemini" pattern.

**Implication:** The module name "aiReport" mis-suggests an LLM
integration. Document the intent in the dashboard README (or rename the
module to `markdownReport.ts`) so future contributors don't add observability
plumbing thinking there's an LLM call to instrument.

---

## Notes for other tracks

- **Track 2 (Correctness):** P0-3 (silent-zero on non-auth fetcher failures)
  is partially a correctness issue — operator can see wrong-but-not-flagged
  numbers. The token-failure alerter only catches auth-shape errors per
  `detectAuthError.ts` — a 502 from Meta zeroes spend WITHOUT alerting.
- **Track 4 (Security):** P1-1 (no Sentry `beforeSend`) — when Sentry
  eventually catches a request-body error (e.g., a JSON parse throw on
  `/api/operator/manual-overrides` POST), the `notes` field can land in
  Sentry. Confirm the security review covers Sentry PII scrubbing.
- **Track 6 (Testing):** P0-1 / P0-2 — adding `Sentry.captureException` in
  catch paths needs unit-test guards to make sure soft-fail behavior doesn't
  regress (the call must NOT throw — Sentry's SDK silently no-ops when DSN
  absent, which is the intended invariant).
- **Track 7 (UX):** P0-3's UX fix (zero-spend annotation chip) is a UX
  concern. Coordinate the rendering side.
- **Track 5 (Documentation):** `aiReport.ts` naming confusion (P2-4) — add a
  README note or rename.
- **General:** The `.planning/audit-2026-05-24/` directory was created during
  this audit (no other files present at the time of writing).
