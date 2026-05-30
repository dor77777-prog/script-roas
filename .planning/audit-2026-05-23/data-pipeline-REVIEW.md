# Data Pipeline Audit — Fetchers, Cron Jobs, Readers, Date-Range

**Audit date:** 2026-05-23
**Auditor stance:** Adversarial — assume defects exist; demand evidence of correctness.
**Scope:** ~7,100 lines across 7 fetchers + 4 cron functions + postgresReaders + dateRange.
**Out of scope:** UI/display components (Agent 4 owns those).

---

## Summary

**Verdict: PARTIALLY TRUSTWORTHY, with one DATA-LOSS BLOCKER and several silent-staleness vectors the operator probably does not realize exist.**

The pipeline has been hardened by repeated incidents (you can see the scar tissue in the comments — "FIX-23", "Phase 05.7.6 PROPER FIX v2", "Bug fix 2026-05-22 incident", etc). Timezones are mostly correct (Asia/Jerusalem applied at the right points), and Shopify's refund-attribution algorithm is well-tested and centrally implemented. Pagination is generally bounded with reasonable safety caps. UPSERTs with `onConflict` clauses make daily writes idempotent.

But there are real correctness holes:

1. **Google Ads GAQL pagination is NOT implemented at all** (CR-01). The `googleAds:search` REST endpoint returns at most ~10,000 rows per response and provides a `nextPageToken`; the fetcher reads `body.results` and never honors `nextPageToken`. For uzoshop's Shopping/PMax campaigns this is fine TODAY but is a silent data-loss bomb when ad volume grows. There is NO warning, NO log, NO test for this.

2. **Yesterday's and day-before's ad spend can be stale for up to 24h** (CR-02). cronLive only refreshes spend for `today` (idx 0 of the rolling window). If cronDaily fails its 00:05 IL run, yesterday's Meta/Google/TikTok spend stays at whatever the previous cronDaily wrote — for up to a full day, with no operator-visible signal beyond `fetchDataDailyLastWriteAt`.

3. **Shopify cross-day refund Window B silently drops the cap if exceeded** (CR-03). The "today-open" window for `updated_at` can blow past the 50-page cap (12,500 orders) during a backfill of an old date, and the cap-hit only emits `console.warn` — but the operator does NOT see Inngest console.warn unless they actively check the run log. The data is dropped silently in `data_daily.refund_deduction_cad`.

4. **TikTok creds throw rather than soft-fail at cron-daily** (HG-01 — partial: cronLive wraps in catch but cronDaily does NOT). If uzoshop's TikTok token expires, cronDaily fails the entire `fetch-tiktok` step → Inngest retries 4× with exponential backoff → eventually the whole cron-daily run fails → no `data_daily` write for that day. Shopify revenue, Meta spend, Google spend all also fail to land because they're in the same Inngest function execution.

5. **Default range silently includes "today" but today may still be unwritten** (MD-01). `defaultRange` returns `to = today-Asia/Jerusalem`, so the dashboard renders an extra empty data point every day. If the operator picks "Last 7 days" at 09:00 IL, the chart shows 8 dates, one of which is partial-only-from-cronLive (no Meta/Google budgets if cron-daily-09:00 hasn't happened). This is misleading.

6. **Currency conversion runs TWICE per cron-daily** (MD-02). `mergeOverridesFromSupabase` calls `getFxRate` independently from the `cadFor` closure in `persist-batch`. If Frankfurter is briefly slow/flaky during the gap, the two paths can disagree about ILS→CAD by a few basis points, leaving `data_daily.fb_spend_cad ≠ Σ campaigns_daily.spend_cad` for the same (store, date). No reconciliation guard.

7. **Refund-only products from cron-live get title='(refund-only)'** (LO-01). When cron-live runs at, say, 10:00 IL and a refund comes through on a product that hasn't sold today, it creates a `products_daily` row with `product_title='(refund-only)'` — overwriting it later in cron-daily but, in the 15-min window between, the operator sees that label.

**Worst-case missing-data scenarios:**

- A campaign IS missing if (a) Google Ads has >10,000 results on a backfill day AND (b) the campaign falls past index 9999. (Pagination not implemented — see CR-01.)
- Yesterday's spend CAN be 24h+ stale if cronDaily fails 4× retries at 00:05 IL — cronLive cannot recover it.
- An entire day can have zero data_daily writes if a single platform (TikTok) throws inside the `fetch-tiktok` step and Inngest's 4× retries all fail.

**What's solid:** Asia/Jerusalem timezone is consistently applied at all boundaries (the `+03:00` offset bug was caught and tested for explicitly). Shopify refund algorithm is centrally implemented and tested. UPSERTs are idempotent. Meta pagination DOES work correctly with `body.paging.next`. TikTok pagination follows `page_info.total_page`. Shopify Link header pagination follows `rel="next"`.

---

## Findings

### CRITICAL — must fix before any growth

#### CR-01 — Google Ads GAQL fetcher does NOT paginate (DATA LOSS)

**Files:** `dashboard-web/src/lib/fetchers/googleAds.ts:284-308`
**Severity:** CRITICAL / BLOCKER

The `runGaqlQuery` function issues a SINGLE POST to `googleAds:search` and returns `body.results`. The Google Ads REST API returns paginated responses for large result sets, signalled by `body.nextPageToken`. The fetcher ignores this field entirely:

```ts
const body = (await res.json()) as { results?: Array<Record<string, unknown>> };
return body.results ?? [];
```

There is no `while (nextPageToken)` loop, no `pageToken` body param sent on subsequent requests. The default page size for `searchStream` is 10,000 results; `search` defaults vary but cap at 10,000. **Every ad_group / campaign / ad row past that boundary is silently dropped.**

Today this likely fits in a single page for uzoshop. But:
1. There is NO console.warn, NO console.log when pagination would be needed.
2. There is NO test asserting `nextPageToken` is consumed.
3. There is no automatic guard or alarm — the dashboard would just silently miss campaigns.
4. Affects `fetchGoogleAdsAdGroupInsights`, `fetchGoogleAdsSpendForDay`, `fetchGoogleAdsAdInsights`, AND `fetchGoogleAdsAdGroupStatuses` — every Google Ads call path.

**Fix:** Add a pagination loop and a safety cap with `console.warn` on hit:

```ts
async function runGaqlQuery(...): Promise<Array<Record<string, unknown>>> {
  const url = `https://googleads.googleapis.com/${GOOGLE_ADS_API_VERSION}/customers/${customerId}/googleAds:search`;
  const headers = buildGoogleAdsHeaders(accessToken);
  const all: Array<Record<string, unknown>> = [];
  let pageToken: string | undefined;
  let safety = 0;
  do {
    const reqBody: { query: string; pageToken?: string } = { query };
    if (pageToken) reqBody.pageToken = pageToken;
    const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(reqBody) });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Google Ads GAQL failed (HTTP ${res.status}): ${text}`);
    }
    const body = (await res.json()) as {
      results?: Array<Record<string, unknown>>;
      nextPageToken?: string;
    };
    all.push(...(body.results ?? []));
    pageToken = body.nextPageToken;
    safety++;
  } while (pageToken && safety < 50);
  if (pageToken) {
    console.warn(`Google Ads GAQL ${storeId} ${dateStr}: hit pagination cap of 50 pages`);
  }
  return all;
}
```

---

#### CR-02 — cronLive refreshes spend only for "today"; yesterday + day-before-yesterday spend depends entirely on cronDaily

**Files:** `dashboard-web/src/inngest/functions/cronLive.ts:438-672`
**Severity:** CRITICAL / BLOCKER for the operator's stated promise ("dashboard is real-time")

cronLive's rolling 3-day window only fetches Meta+Google+TikTok spend for `today = dates[0]`:

```ts
const tiktokPromise = STORES_WITH_TIKTOK.has(storeId)
  ? withTimeout(fetchTikTokSpendForDay(storeId, today), 12_000, 'TikTok')...
// ...
if (isToday && haveAnySpend) {
  // override spend
} else {
  await persistDayForStore(storeId, date, shopify, undefined); // preserves
}
```

For yesterday + day-before-yesterday:
- Shopify revenue: refreshed every 10 min (good — refund-aware).
- Meta / Google / TikTok spend: NEVER refreshed by cronLive. Whatever cronDaily wrote at the most recent 00:05 IL is what stays.

**Impact:** If cronDaily fails its 00:05 retry burst (4× retries with exponential backoff), the next refresh of yesterday's `fb_spend_cad` / `ga_spend_cad` / `tt_spend_cad` won't happen until 00:05 the NEXT day — a 24-hour staleness window. The dashboard reports stale spend numbers with no visible "stale" indicator beyond the freshness chip relying on `data_daily.updated_at`, which cronLive itself bumps every 10 min for revenue.

**Why this is worse than it looks:** cronLive bumps `data_daily.updated_at` for yesterday's row (because it writes revenue/gross/refund_deduction), but the spend cols remain stale. The freshness chip therefore says "fresh" while the spend is 24h old. False reassurance.

**Fix options:**
1. Refresh spend for the full rolling window (more API calls, higher Inngest exec count).
2. Track `*_spend_updated_at` per column so the freshness chip distinguishes "Shopify fresh / ads stale".
3. Surface cronDaily failure prominently in the operator UI when it skips a day.

---

#### CR-03 — Shopify Window B (`updated_at` open-ended to today+1) silently drops data on backfills

**Files:** `dashboard-web/src/lib/fetchers/shopify.ts:382-431`, `462-508`
**Severity:** CRITICAL for backfills, MEDIUM for daily cron

When backfilling a date 30 days ago, the cross-day-refund Window B opens its upper bound to TODAY+1:

```ts
} else {
  const todayStr = dayInTz(new Date().toISOString(), SHOPIFY_TZ);
  const tomorrowEnd = isoLocalMidnight(nextDayStr(todayStr), SHOPIFY_TZ);
  url += `&${windowField}_max=${encodeURIComponent(tomorrowEnd)}`;
}
```

For a date 30 days back, this means scanning every order whose `updated_at` happened in the 30-day span. At 50 page cap × 250 = 12,500 orders, a high-volume store easily exceeds this — for example, ~417 orders/day for 30 days = exactly 12,500. The cap-hit only triggers a `console.warn`:

```ts
console.warn(`Shopify ${storeId} ${dateStr} updated_at window hit pagination cap of 50 pages`);
```

The operator does not see Inngest's console.warn unless they explicitly open the run log. The fetcher returns the truncated orders array; the algorithm runs on incomplete data; the `refund_deduction_cad` for the backfilled day is silently understated. There is no "data was truncated" flag persisted to `data_daily`.

**Fix:** When `pages >= PAGINATION_CAP && url`, throw rather than warn during backfill operations, OR persist a `data_daily.truncated` flag the dashboard can surface as a chip. The current code is the worst of both worlds: silent truncation with no operator signal.

---

### HIGH — degrades trust significantly

#### HG-01 — cronDaily fetch-tiktok throws on missing creds, killing the entire run

**Files:** `dashboard-web/src/lib/fetchers/tiktok.ts:122-128`, `dashboard-web/src/inngest/functions/cronDaily.ts:262-282`
**Severity:** HIGH

`getTikTokCreds` (line 122) throws on missing env vars:
```ts
if (missing.length) {
  throw new Error(`Missing TikTok creds for store "${storeId}": ${missing.join(', ')} ...`);
}
```

Inside cronDaily's `fetch-tiktok` step (line 262), there's a `STORES_WITH_TIKTOK.has(storeId)` short-circuit, BUT if uzoshop's TikTok token EXPIRES at runtime (token issue, not missing env), the fetcher throws inside the `step.run` — which Inngest retries 4× with backoff. After retries exhaust, the ENTIRE `runDailyForStore` fails — Shopify revenue, Meta spend, Google spend, and the persist-batch step ALL go un-written for that store on that day.

By contrast, cronLive properly wraps each platform fetch in `.catch()` for graceful degradation:
```ts
const tiktokPromise = ... .catch(e => { console.warn(...); return null; });
```

**Fix:** Wrap the cronDaily `fetch-tiktok` step contents in try/catch returning zero-spend sentinels on failure, mirroring cronLive's pattern. Same for `fetch-meta` and `fetch-google` — currently a single platform's API outage takes down the entire daily cron for that store.

---

#### HG-02 — Meta `account_currency` defaults to ILS when missing — wrong for USD-account stores

**Files:** `dashboard-web/src/lib/fetchers/meta.ts:367, 466, 564`
**Severity:** HIGH if Meta API ever omits the field for a non-ILS account

```ts
currency: r.account_currency ?? 'ILS',
```

Three locations default to 'ILS'. If Meta's API regresses and omits the field for an account in USD (or future stores in CAD), the FX layer will multiply USD spend by the ILS→CAD rate (~0.36 instead of ~1.36) — **3.8× understatement of spend.** ROAS becomes badly inflated.

The comment on `fetchMetaBudgets` (line 670-686) actually documents this risk:
> "Non-ILS accounts will be mis-converted (~3-4x off)."

But the SAME fallback exists silently in `fetchMetaAdSetInsights`, `fetchMetaSpendForDayLight`, `fetchMetaAdInsights` without a similar warning.

**Fix:** Add a `console.warn` whenever the fallback fires:
```ts
const currency = r.account_currency ?? (() => {
  console.warn(`Meta insights ${storeId} ${dateStr}: account_currency missing; defaulting to ILS — non-ILS accounts will be mis-converted.`);
  return 'ILS';
})();
```

Even better: surface this in the data_daily row as a flag so the operator can see the warning in the UI.

---

#### HG-03 — `fxCache` in cronDaily is per-step-execution; manualOverrides has its OWN getFxRate path

**Files:** `dashboard-web/src/inngest/functions/cronDaily.ts:289-296, 347-358`, `dashboard-web/src/lib/fetchers/manualOverrides.ts:69-85`
**Severity:** HIGH (potential reconciliation drift)

`mergeOverridesFromSupabase` calls `getFxRate(currency, 'CAD', dateStr)` to convert Meta spend to CAD for `data_daily.fb_spend_cad`. Separately, the `persist-batch` step creates its OWN local `fxCache` Map and calls `getFxRate` again for the per-row `campaigns_daily.spend_cad` and `ads_daily.spend_cad` values.

These two paths fire INDEPENDENT Frankfurter calls. While Frankfurter returns deterministic per-day rates, the two paths read on different ticks. If a rate ticks over between the two calls (extremely unlikely for historical dates, but possible during the live cron-day boundary), the invariant `data_daily.fb_spend_cad === Σ campaigns_daily.spend_cad WHERE platform='meta'` is silently violated. There is NO reconciliation guard anywhere that asserts this.

**Fix:** Pass the FX rate from `mergeOverridesFromSupabase` back to the caller and reuse it for the per-row conversion, OR centralize FX into a per-cron-run cache module.

---

#### HG-04 — `enrollmentsByPlatformAdSet` map built but never read (dead code)

**Files:** `dashboard-web/src/inngest/functions/cronLive.ts:930-933`
**Severity:** HIGH — code smell suggests refactor missed a step

```ts
const enrollmentsByPlatformAdSet = new Map<string, string>();
for (const e of enrollments) {
  enrollmentsByPlatformAdSet.set(`${e.platform}::${e.adSetId}`, e.status);
}
for (const platform of platforms) {
  // ...
  // enrollmentsByPlatformAdSet is NEVER referenced below.
}
```

The map is constructed but the loop below uses `enrollments.filter()` directly. Either the map is dead code (delete it) or there's a forgotten lookup that should have used it. Either way, this is a refactor artifact — a reviewer would have flagged this.

**Fix:** Delete the dead code OR use the map to deduplicate the filter calls.

---

#### HG-05 — TikTok 50-page cap check is off-by-one and may not warn

**Files:** `dashboard-web/src/lib/fetchers/tiktok.ts:420-427, 558-563`
**Severity:** HIGH — silent data loss past cap

```ts
while (page <= TIKTOK_PAGINATION_CAP) {
  // ...fetch page, push rows...
  const totalPages = Number(data.page_info?.total_page ?? 1);
  if (page >= totalPages) break;
  page++;
}
if (page >= TIKTOK_PAGINATION_CAP) {
  console.warn(`hit pagination cap of ${TIKTOK_PAGINATION_CAP} pages`);
}
```

If `totalPages === 50` and the loop exits naturally because `page >= totalPages`, the final `page` value is 50, which triggers the warn UNNECESSARILY. Conversely, if `totalPages === 51` and `page` increments to 51 (`> CAP`), the while loop exits but `page = 51 >= 50` so the warn DOES fire — correctly. So the false-positive warn is the only bug here, but it pollutes the log.

More importantly: when `totalPages > CAP`, the loop exits silently at `page=51` with rows from page 51 NEVER fetched. The warning DOES fire but the operator must read the Inngest log to see it.

**Fix:** Track a separate boolean for "needed more pages" vs "hit the cap":
```ts
let needsMorePages = false;
while (page <= TIKTOK_PAGINATION_CAP) {
  // ...
  const totalPages = Number(data.page_info?.total_page ?? 1);
  if (page >= totalPages) break;
  if (page === TIKTOK_PAGINATION_CAP) { needsMorePages = true; break; }
  page++;
}
if (needsMorePages) console.warn(...);
```

---

#### HG-06 — Default date range silently includes incomplete "today"

**Files:** `dashboard-web/src/lib/dateRange.ts:91-116`
**Severity:** HIGH for UX, MEDIUM for correctness

`defaultRange` returns `to = today-Asia/Jerusalem`. The dashboard at 09:00 IL therefore shows a "today" data point with:
- Shopify revenue: up to 9 hours' worth (cronLive runs every 10 min, so within 10 min).
- Meta/Google/TikTok spend: ONLY whatever cronLive's `fetchMetaSpendForDayLight` got. Per-ad row data won't exist until cron-daily runs at 00:05 the next day.

If the operator filters "Last 7 days", they see 8 dates (today + 7 prior). The "today" column has partial data; the historical columns are full. The dashboard doesn't visually distinguish them, leading the operator to mis-compare today's-so-far against past-full-days.

**Fix:** Either rename "Last 7 days" → "Yesterday + 6 prior" (and set `to = today - 1`), OR add a "partial" badge to the "today" data point in every chart.

---

### MEDIUM — degrades quality

#### MD-01 — `STORES_WITH_TIKTOK` is duplicated across cronDaily.ts and cronLive.ts

**Files:** `dashboard-web/src/inngest/functions/cronDaily.ts:86`, `dashboard-web/src/inngest/functions/cronLive.ts:138`
**Severity:** MEDIUM — adding a 4th store gets it wrong

```ts
// cronDaily.ts
const STORES_WITH_TIKTOK: Set<StoreId> = new Set(['uzoshop']);

// cronLive.ts
const STORES_WITH_TIKTOK: Set<StoreId> = new Set(['uzoshop']);
```

Google Ads has the same pattern but the single source of truth lives in `googleAds.ts:73` (`STORES_WITH_GOOGLE_ADS`). Why TikTok is duplicated is unexplained. If a future store adds TikTok, the operator updates ONE file and is silently broken on the other cadence.

**Fix:** Move `STORES_WITH_TIKTOK` into `tiktok.ts`, export it, and import into both cron files.

---

#### MD-02 — `STORE_NAMES` is duplicated across shopify.ts and cronLive.ts AND postgresReaders.ts

**Files:** `dashboard-web/src/lib/fetchers/shopify.ts:114-118`, `dashboard-web/src/inngest/functions/cronLive.ts:126-130`, `dashboard-web/src/lib/postgresReaders.ts:541-545`
**Severity:** MEDIUM

Three independent copies of the store-name map. If the operator renames a store, the change must be made in three files. No constant module, no import chain.

**Fix:** Extract to `dashboard-web/src/lib/stores.ts` and import everywhere.

---

#### MD-03 — postgresReaders has no `store_id` filter — every API call returns all stores

**Files:** `dashboard-web/src/lib/postgresReaders.ts:265-348, 470-521, 547-652, 665-718, 739-795`
**Severity:** MEDIUM (efficiency + over-exposure)

Every reader (`fetchDailyDataFromPostgres`, `fetchProductsFromPostgres`, `fetchCampaignsFromPostgres`, `fetchAdsFromPostgres`, `fetchOrdersAttributionFromPostgres`) returns rows for ALL stores. The consumer filters by `storeId` in memory.

This is by design — the dashboard's multi-store view is the dominant case — but:
1. Single-store API calls overfetch.
2. There is no cross-store leak in practice because each row carries its `store_id` and the consumer filters, but a bug in consumer-side filter logic would silently leak.
3. RLS is not enabled per the comment in postgresReaders.ts:30-32 ("RLS which is disabled here anyway"), so the anon role can read everything.

**Fix:** Accept an optional `storeId?: string` param on each reader and push down `q.eq('store_id', storeId)` when provided. Document that omitting it returns all stores by design.

---

#### MD-04 — paginate() cap of 50 chunks = 50k rows; not enforced for catalog/orders

**Files:** `dashboard-web/src/lib/postgresReaders.ts:96-115`
**Severity:** MEDIUM

The `paginate()` helper has `MAX_CHUNKS = 50` (50k rows). For `orders_attribution`, 30 days × 3 stores × ~50 orders/day = 4500 rows — fine. For a 1-year backfill with 3 stores at 100 orders/day = 109,500 rows — exceeds cap, rows are silently dropped. No warn, no signal.

**Fix:** When the loop exits because of `MAX_CHUNKS`, log a `console.warn` (mirror Shopify fetcher's pattern):
```ts
for (let chunk = 0; chunk < MAX_CHUNKS; chunk++) {
  // ...
  if (chunk === MAX_CHUNKS - 1) {
    console.warn(`postgresReaders.paginate: hit MAX_CHUNKS=${MAX_CHUNKS} (${all.length} rows); more data may exist.`);
  }
}
```

---

#### MD-05 — `Math.round(r.conversions)` loses sub-conversion attribution data

**Files:** `dashboard-web/src/inngest/functions/cronDaily.ts:493, 547, 600, 619, 641`
**Severity:** MEDIUM (mostly noted in comments, but verify the right number is reported)

```ts
conversions: Math.round(r.conversions), // r.conversions can be 16.88633
```

The comment at line 432-440 acknowledges this: Google Ads + Meta return fractional conversions from view-through / multi-touch / partial-credit models. Rounding to BIGINT loses up to 0.5 per row, which can sum to material errors across many rows.

**Why this isn't CRITICAL:** the dashboard's primary metric is `roas = revenue / spend`, which is BIGINT-independent. But `conversions` itself is shown in the campaigns table, and `conversion_value_cad` is preserved as NUMERIC — so a campaign with 16.88 conversions and $1,688 conversion value will show "17 conversions for $1,688" → $99/conv instead of the truth $99.94/conv.

**Fix:** Migrate the BIGINT columns to NUMERIC(14,4). The fix the operator approved (rounding) is the pragmatic shortcut, but it's a real distortion of the data.

---

#### MD-06 — `mergeOverridesFromSupabase` throws on FX failure (no graceful degradation)

**Files:** `dashboard-web/src/lib/fetchers/manualOverrides.ts:69-85, 75-85`
**Severity:** MEDIUM

```ts
async function spendToCad(input: SpendInput, dateStr: string): Promise<number> {
  if (input.currency === 'CAD') return input.spend;
  const rate = await getFxRate(input.currency, 'CAD', dateStr);  // throws on Frankfurter failure
  return input.spend * rate;
}
```

If Frankfurter is down or returns 5xx, `getFxRate` throws. `mergeOverridesFromSupabase` does NOT catch this — the throw propagates up to `runDailyForStore`'s `apply-manual-overrides` step → Inngest retries 4× → if all fail, the entire daily run for that store fails. No `data_daily` write.

By contrast, cronLive's FX is wrapped in `.catch(() => 1)`:
```ts
const rate = await withTimeout(getFxRate(currency, 'CAD', today), 5_000, 'FX').catch(() => 1);
```

But `.catch(() => 1)` means "if FX fails, use rate=1" — which equates 1 ILS = 1 CAD. **That is BAD.** The audit prompt explicitly called this out as a worst-case behavior. Specifically the dashboard would report ILS spend as if it were CAD spend → 3.6× UNDER-COUNTING of cron-live's "today" Meta spend.

**Fix:**
- For cronDaily: wrap FX in `.catch()` returning a sentinel that the writer can detect and preserve previous values.
- For cronLive: replace `.catch(() => 1)` with `.catch(() => null)` and skip the spend update on FX failure (don't write a bad value).

---

#### MD-07 — `fetchTableLastWriteAt` swallows ALL errors → freshness chip lies

**Files:** `dashboard-web/src/lib/postgresReaders.ts:215-239`
**Severity:** MEDIUM

```ts
async function fetchTableLastWriteAt(...): Promise<string | null> {
  try {
    // ... query
    return ts ?? null;
  } catch {
    return null;
  }
}
```

The freshness chip relies on this. If Supabase is briefly slow or auth glitches, the function returns `null` → UI shows "no chip" → operator infers "no data". But the data may actually be fresh; only the lookup failed. Operator response: panic.

**Fix:** Differentiate "no rows" from "lookup failed". Return a discriminated union: `{ kind: 'fresh', ts: string } | { kind: 'no_data' } | { kind: 'lookup_failed', err: string }`.

---

### LOW — code quality, won't cause incidents but a reviewer should flag

#### LO-01 — cron-live writes `product_title='(refund-only)'` placeholder visible to operator

**Files:** `dashboard-web/src/inngest/functions/cronLive.ts:387`
**Severity:** LOW (transient UX confusion)

```ts
product_title: p.product_title || '(refund-only)',
```

When a refund-only product gets written by cron-live, the title shows '(refund-only)' in the dashboard until cron-daily runs (potentially 12+ hours later for a refund happening at 12:00 IL). The operator opens the dashboard, sees '(refund-only)' as a product name, and thinks the data is broken.

**Fix:** Use a localized neutral fallback like the Apps Script convention `(ללא שם)`, OR query `product_catalog` for the title at write-time.

---

#### LO-02 — `parseLineItems` filter chain doesn't validate `productId` length post-trim

**Files:** `dashboard-web/src/lib/postgresReaders.ts:157-176`
**Severity:** LOW

```ts
return parsed
  .filter((it) => /* p is string with length > 0 */)
  .map(it => ({
    productId: String(it.p).trim(),  // could become '' after trim
    // ...
  }))
  .filter(li => Number.isFinite(li.units) && Number.isFinite(li.revenueCad));
```

If `p = '   '` (3 spaces), the first filter passes (length > 0), but `.trim()` produces `productId = ''`. The second filter doesn't check for empty productId — empty-productId rows pass through.

**Fix:** Add `&& li.productId.length > 0` to the second filter.

---

#### LO-03 — `formatLocalIso` workaround for hour=24 only patches the leading position

**Files:** `dashboard-web/src/lib/fetchers/shopify.ts:333`
**Severity:** LOW (defensive code that may hide a different bug)

```ts
return out.replace(/T24:/, 'T00:');
```

Old Node versions reported midnight as "24:00:00" in some locales. The replace only fixes the leading "T24:" but the underlying date is one day BEHIND (the date string is for the previous calendar day). So `replace` produces the right hour but the wrong date.

If you ever run on a Node version that hits this branch, the cron will silently use the previous day's date string.

**Fix:** Use Temporal API (or a polyfill) instead of `Intl.DateTimeFormat` round-tripping.

---

#### LO-04 — `tokenCache` for Shopify keyed by `storeId` alone — no rotation invalidation

**Files:** `dashboard-web/src/lib/fetchers/shopifyAuth.ts:42, 49-110`
**Severity:** LOW (documented behavior, but worth a flag)

The Shopify access-token cache is keyed by `storeId`. If the operator rotates Client Secret in Dev Dashboard, the cached token remains valid (24h TTL) until expiry. The comment says "Worst-case window: until the next deploy." → that's a 24h window where revoked credentials could still be used. Operator likely doesn't realize this.

**Fix:** Provide a way for the operator console to flush the cache via Inngest event (single-store invalidation).

---

#### LO-05 — `fetchShopifyDayRows` exposes `customItemRefundCad` but it isn't persisted

**Files:** `dashboard-web/src/lib/fetchers/shopify.ts:153, 627`, `dashboard-web/src/inngest/functions/cronDaily.ts:200-209`
**Severity:** LOW

`customItemRefundCad` is computed (refunds with null product_id) and returned by the fetcher but NEVER written to `data_daily` or surfaced anywhere. If a store has manual custom items being refunded, the `data_daily.revenue_cad` deduction is correct, but the operator can't see the breakdown.

**Fix:** Add a `data_daily.custom_item_refund_cad` column and write through. Or accept that this is intentionally diagnostic-only and document it.

---

#### LO-06 — Inngest `fxCache` is recreated per persist-batch run

**Files:** `dashboard-web/src/inngest/functions/cronDaily.ts:347`
**Severity:** LOW (efficiency, not correctness)

The `fxCache` lives inside the `step.run('persist-batch', async () => { const fxCache = new Map(); ... })` callback. Every retry of the persist-batch step creates a fresh cache — wastes FX calls on retries. But because FX is per-day deterministic, the wasted calls don't change the result.

**Fix:** Move `fxCache` to module scope, OR add an Inngest step.run cache wrapper.

---

#### LO-07 — `runDailyForStore` returns a `roas` field computed WITHOUT TikTok

**Files:** `dashboard-web/src/inngest/functions/cronDaily.ts:822-848`
**Severity:** LOW (display bug, not data bug — DB is correct)

After persist-batch completes, the function builds its return object:
```ts
const roas = merged.totalSpendCad > 0 ? shopify.revenueCad / merged.totalSpendCad : 0;
```

This `roas` excludes `ttSpendCad` (which is computed INSIDE persist-batch and not threaded back out). The DB's `data_daily.roas` uses the full `totalSpendCadAll` (with TikTok). So the Inngest job summary in the operator console will report a different `roas` than the dashboard. Minor but confusing.

**Fix:** Compute `roas` (and the other derived fields) once outside the persist-batch step and pass through, OR recompute outside using `totalSpendCadAll`.

---

## Per-platform fetcher verdict

### Meta — `meta.ts`
**Verdict: CORRECT, complete, well-paginated.** v25.0 is current. `time_range={since: D, until: D}` is INCLUSIVE on both ends (Meta convention). Pagination follows `body.paging.next` with 50-page cap and warn. Conversion-priority chain (omni_purchase → purchase → fb_pixel_purchase) is single-line and well-tested. Account currency defaults to ILS — flagged in HG-02 because non-ILS accounts mis-convert silently.

Freshness: cron-daily refreshes at 00:05 IL (yesterday's full day). cron-live calls `fetchMetaSpendForDayLight` every 10 min for today. Per-ad row data is NEVER refreshed by cron-live — campaigns/ads tables for today depend on the previous day's data until cron-daily fires.

Completeness: Pagination cap of 50 × 500 = 25,000 rows per call; sufficient for these stores. Budgets endpoint is paginated separately with same cap. Effective_status is now retained on the row.

### Google Ads — `googleAds.ts`
**Verdict: BROKEN PAGINATION (CR-01).** GAQL responses are paginated with `nextPageToken`; the fetcher reads the first page only. Silent data loss above ~10,000 rows per query. v24 is the right path segment.

Freshness: Same cadence as Meta — cron-daily for full data, cron-live for spend total only.

Completeness: Currently fine for uzoshop (single Google Ads store, low volume). Will break at scale with NO operator-visible signal.

### TikTok — `tiktok.ts`
**Verdict: MOSTLY CORRECT, but pagination cap-warn has the off-by-one bug (HG-05) and conversion-value synthesis is fragile.** TikTok's lack of a generic `conversion_value` metric forces a `complete_payment × value_per_complete_payment` synthesis (line 526-532). If TikTok's `value_per_complete_payment` is `0` for a row with non-zero `complete_payment`, conversionValue silently becomes 0 — masking real revenue.

The `dataLevel` is correctly AUCTION_AD for per-ad and AUCTION_ADVERTISER for store-level. `start_date / end_date` are TikTok-account-TZ (the comment notes this; uzoshop's TikTok account is in UTC per `advertiser/info/`).

The `advertiser_ids` JSON-stringification bug (line 229-237) was caught and fixed — good audit trail.

### Shopify — `shopify.ts`
**Verdict: ALGORITHM-CORRECT, but Window B can silently truncate (CR-03).** API version 2026-04 is current. `isoLocalMidnight` is intricate but tested (Test 1b in shopify.test.ts is the regression guard for the +747:00 bug from 2026-05-22). `dayInTz` is duplicated locally to avoid importing from the algorithm module — minor smell.

`status=any&financial_status=any` is correctly applied; `test` and `voided` orders are dropped at the algorithm boundary (`shopifyRevenueRefunds.ts:286-288`).

The two-window dedup-by-id is correct. Window A is `[D, D+1)` inclusive of D. Window B is `[D, today+1)` — open-ended past today. The dedup by `id` is safe because both windows return the same payload shape for an overlapping order.

Cursor pagination follows Link header `rel="next"` correctly with PAGINATION_CAP=50. Catalog fetch and orders-attribution use the same Link header pattern.

Per-line-item CAD split via `computeLineItemsCad` handles the divide-by-zero case (free-gift / 100%-discount orders) with `useFlatSpread`. ✓

---

## Cron verdict

- **cron-daily** (`cronDaily.ts`): Correct semantics, idempotent UPSERTs. BUT fetch-tiktok/fetch-meta/fetch-google throw on failure → entire run fails with no partial write (HG-01). Cron runs at 00:05 Asia/Jerusalem per store, fires `runDailyForStore(storeId, yesterdayJerusalem())`.

- **cron-live** (`cronLive.ts`): Refreshes Shopify revenue every 10 min for rolling 3-day window. Only refreshes ad spend for "today" — yesterday + day-before ad spend depends entirely on cron-daily (CR-02). Each platform fetch is correctly wrapped in withTimeout + .catch. Has a relaxed all-or-nothing override gate (line 642-644) which correctly preserves per-platform spend on partial failures. BUT `.catch(() => 1)` for FX rate is a 3.6×-undercount risk (MD-06). Includes effective_status enrollment for new campaigns within 10 min — correct semantics.

- **event-sync-now** (`eventSyncNow.ts`): Thin wrapper; defaults to today (not yesterday — operator's mental model is "refresh today now"). Inherits all cronDaily flaws.

- **event-backfill** (`eventBackfill.ts`): Sequential iteration with proper step-ID prefixing to avoid W6 collision. Validates `from < HISTORY_BOUNDARY ('2026-05-01')` and `from > to`. Per-pair try/catch keeps partial progress on failures. Inherits the CR-03 Window B truncation risk for old dates.

---

## Question-by-question verdicts

**1. Date range timezone correctness.**
`defaultRange()` (dateRange.ts:91-116) uses `Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem' })` to compute "today". Asia/Jerusalem is the operator's TZ (per CLAUDE.md note about uzoshop/Zol Plus/360usmile being managed from Israel, BUT — `STORE_NAMES` has both uzoshop and the others, and Shopify also uses Asia/Jerusalem TZ for its day boundary in `shopify.ts:94`). This is consistent across the pipeline. There is NO off-by-one because all writes and reads agree on Asia/Jerusalem.

**However:** the Shopify stores themselves likely operate in their own TZs (uzoshop=Israel, but the 360usmile + Zol Plus could be elsewhere depending on the customer). The dashboard treats all 3 as Asia/Jerusalem day boundaries — if a store should actually use America/Toronto, then a Toronto refund processed at 22:00 local = 05:00 IL next day, attributed to the wrong day in the dashboard. Verify this matches the operator's intent.

**2. Inclusive/exclusive boundaries per platform.**
- **Meta**: `time_range={since: D, until: D}` — INCLUSIVE both ends (meta.ts:334).
- **Google Ads**: `WHERE segments.date = 'D'` — single day (googleAds.ts:338, 392, 406). INCLUSIVE.
- **TikTok**: `start_date: D, end_date: D` — TikTok's docs say both inclusive (tiktok.ts:290-291).
- **Shopify orders**: `created_at_min=D-local-midnight, created_at_max=(D+1)-local-midnight` — `[D, D+1)` half-open, correctly captures D inclusive.

All consistent. Pass.

**3. Effective_status freshness.**
cron-live STEP 5 ("refresh-effective-status", line 743) refreshes for ALL 3 stores ALL 3 platforms IF the credentials are valid. Each platform is wrapped in `withTimeout(...).catch(...)` (lines 754-784) — if one is down, the others still update. Verdict: CORRECT, properly soft-fails.

**4. Active-only enrollment.**
postgresReaders.fetchCampaignsFromPostgres (line 547-652) uses the rule: `hasActivity || isCurrentlyActive`. (line 598-611). A campaign currently active with zero spend yesterday SHOULD appear because cronLive Step 5 writes a placeholder row for TODAY with `effective_status='ACTIVE'`. Verified by the code. A campaign paused with no spend IS hidden (both branches fail).

**Concern:** "currently active" is determined from the `effective_status` column, which is only refreshed every 10 min by cron-live. If the operator paused the campaign 5 min ago, the row still shows ACTIVE for 5-10 min. Tolerable.

**5. Pagination per platform.**
- **Meta**: CORRECT (`body.paging.next` loop with cap, meta.ts:342-388).
- **Google Ads**: BROKEN (CR-01 — no `nextPageToken` consumed at all).
- **TikTok**: CORRECT semantics (`page < total_page` loop) but off-by-one warn (HG-05).
- **Shopify**: CORRECT (`Link: rel="next"` header).

**6. Per-platform status conventions.**
Each platform's "currently running" is correctly interpreted:
- Meta: `ACTIVE` (line 876 — `isActiveForPlatform('meta', 'ACTIVE')`).
- Google: `ENABLED` (line 877).
- TikTok: `ADGROUP_STATUS_DELIVERY_OK` (line 880).

These match each platform's enum conventions. ✓

**7. Currency conversion.**
- FX is applied at WRITE time (cronDaily.ts:289-296 inside `apply-manual-overrides`, and again at cronDaily.ts:347-358 inside `persist-batch`).
- Applied TWICE — see HG-03. Both paths call `getFxRate` independently. Drift possible if Frankfurter rates change between the calls.
- FX source: Frankfurter (ECB-backed, free, no key). Documented in fx.ts:5-10. Auto-shifts weekends/holidays to prior business day.
- On FX failure: cronDaily THROWS (manualOverrides path) → cron-daily fails entire run. cronLive uses `.catch(() => 1)` → silently substitutes rate=1 (BAD — MD-06).

**8. Idempotency.**
cronDaily and eventBackfill ARE safe to re-run on the same date. Every write is an UPSERT with `onConflict`:
- `data_daily` (date, store_id) — UPSERT
- `products_daily` (date, store_id, product_id) — UPSERT
- `campaigns_daily` (date, store_id, platform, campaign_id, ad_set_id) — UPSERT
- `ads_daily` (date, store_id, ad_id) — UPSERT
- `orders_attribution` (store_id, order_id) — UPSERT
- `product_catalog` (store_id, product_id) — UPSERT

✓ Safe.

**9. Shopify pagination + cursor.**
Uses `Link: rel="next"` cursor pagination (recommended by Shopify), NOT `since_id` (deprecated). The fetcher follows `parseNextLink` (shopify.ts:355-360). No order can be skipped because the cursor IS the next page URL.

**10. Refund-on-old-order.**
Refunds attribute to their `processed_at` day (NOT the order's `created_at` day) — see invariant 2 in `shopifyRevenueRefunds.ts:18-30`. A refund issued today on a month-old order will land in TODAY's `refund_deduction_cad`, not the original order's day. ✓ Correct.

**11. Multi-account auth.**
Each store has its own env vars (`${STORE}_META_ACCESS_TOKEN`, `${STORE}_GOOGLEADS_*`, `${STORE}_TIKTOK_*`, `${STORE}_SHOPIFY_*`). The fetchers `.toUpperCase()` storeId and look up scoped vars. Cross-store contamination would require an env-var mix-up at deploy time (operator error).

Token cache for Google Ads is keyed by storeId (googleAds.ts:91), Shopify by storeId (shopifyAuth.ts:42), TikTok advertiser-info by storeId (tiktok.ts:199). All correctly scoped.

**12. Error handling.**
- **cronDaily**: Throws on most errors → Inngest retries 4× → on final failure, the ENTIRE store's daily write is skipped. No partial-data write, no operator alarm beyond the Inngest dashboard.
- **cronLive**: Wraps each fetch in `withTimeout + .catch`. Partial failures preserve last-good data. On Shopify failure → skips persist for that date. On ad-platform failure → preserves last spend value.
- **Dashboard**: Always reads from Supabase, which always has SOME data (possibly stale). The UI degrades to a freshness chip that shows "no data" if `updated_at` lookup fails — but the chip can be misleading (see MD-07 + CR-02).

**No silent stale-data warning** except the freshness chip, which itself has known limitations.

**13. TodayLive freshness expectation.**
"TodayLive" claims real-time, but actually:
- Shopify revenue: refreshed every 10 min (cronLive). Worst-case 10 min stale.
- Meta/Google/TikTok spend: refreshed every 10 min for TODAY only. Worst-case 10 min stale.
- Per-campaign data for TODAY: only updated by cronDaily at 00:05 IL → at 23:50 IL, today's per-campaign data is 23h50m stale!
- effective_status: refreshed every 10 min for TODAY (placeholder upsert) + UPDATE on past rows.

The "real-time" label is over-promising. Most real numbers are 10 min stale; per-campaign breakdowns can be ~24h stale (gross details until tomorrow's 00:05 cronDaily).

**14. postgresReaders cross-store leakage.**
NO queries filter by `store_id` (MD-03). All readers return all stores; consumer filters by `storeId`. This is by design for the multi-store dashboard view. RLS is disabled. There is NO cross-store leakage IN PRACTICE because each row carries `store_id` and the dashboard correctly filters by it — but the architecture provides no defense-in-depth. A bug in any consumer's filter logic would silently mix stores.

---

## What's solid

- **Asia/Jerusalem timezone is consistently applied at all boundaries.** The +747:00 offset bug was caught and explicit regression tested (Test 1b in shopify.test.ts). Every reader and writer agrees on the same TZ.
- **Shopify refund attribution algorithm is centralized.** `computeRevenueWithCrossDayRefunds` is the single source of truth, called by both the fetcher and the algorithm tests. The 3 load-bearing invariants (immutable total_price, refund-day attribution, per-product map) are documented and tested.
- **UPSERTs with `onConflict` make all daily writes idempotent.** cronDaily, eventSyncNow, and eventBackfill can be re-run on the same date without double-write.
- **Per-platform credential scoping is correct.** Each store has its own env vars; the token caches are keyed by storeId.
- **Pagination is bounded.** Meta, TikTok, Shopify, and postgresReaders.paginate all have safety caps (50 pages × 500-1000 rows = ~25k-50k rows). Google Ads is the lone exception (CR-01).
- **Meta conversion-priority chain is locked.** `omni_purchase → purchase → offsite_conversion.fb_pixel_purchase` is single-line and grep-gated.
- **Shopify uses Link header cursor pagination correctly.** No `since_id` legacy semantics.
- **cron-live's per-platform soft-fail policy is well-thought-out.** Timeouts + catch + per-column preserve means a single platform's outage doesn't block the others.
- **The audit trail in comments is exceptional.** Each fix references its incident date and explains the regression. (e.g., "CRITICAL FIX (2026-05-22 incident): Date.UTC expects month 0-indexed").

---

## Final classification summary

- **BLOCKER (CRITICAL):** 3 issues (CR-01 Google Ads pagination, CR-02 cron-live spend staleness, CR-03 Shopify Window B truncation).
- **WARNING (HIGH):** 6 issues (HG-01..HG-06).
- **WARNING (MEDIUM):** 7 issues (MD-01..MD-07).
- **WARNING (LOW):** 7 issues (LO-01..LO-07).

Fix the 3 CRITICALs before claiming the pipeline is production-trustworthy at scale.
