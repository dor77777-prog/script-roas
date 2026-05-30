# OPUS-4 v3 audit — pipeline / crons / API / fetchers / notifications

**Reviewer:** OPUS-4 (third pass after v1 + v2 = 56 fix commits `48a377e..274ba3b`)
**Scope:** state-sync, crons, API routes, fetchers, notifications, hooks
**Stance:** adversarial — every soft-fail, retry, and writer assumed buggy until proven correct.

## Summary table

| ID | Severity | Area | One-line |
|---|---|---|---|
| O4-CR-01 | CRITICAL | cron-daily / FX | `cadFor()` inside `persist-batch` step throws on any FX failure → entire daily writer step dead-letters mid-batch with partial state |
| O4-HI-01 | HIGH | cron-live / refresh-effective-status | `Promise.all` over per-ad-set UPDATE batch with no per-update try/catch — one transient 5xx fails the entire status-refresh step |
| O4-HI-02 | HIGH | WhatsApp EOD timing | `whatsapp-eod` at 00:10 IL gives `cron-daily` only ~5 min to land + retry — operator gets empty "אין נתונים זמינים" message whenever cronDaily exceeds first attempt |
| O4-HI-03 | HIGH | backfill route input validation | regex-only date check accepts `2026-99-99`; `Date.UTC` normalises to bizarre 2034-ish dates → worker fetches Shopify/Meta/Google for nonsense ranges, wastes Inngest exec budget |
| O4-MD-01 | MEDIUM | cloudSync migration push | `lastPushAt` only set in-memory for first-time migration — page reload during migration POST loses grace window, next hydrate stomps local value |
| O4-MD-02 | MEDIUM | cron-live products_daily | `products_daily` upsert at idx=1/idx=2 of rolling window includes per-product `units` / `orders` (full-day counts), overwriting cron-daily's authoritative full-day write within 10 min if cron-live's mid-day partial happens to land after cron-daily for that date |
| O4-MD-03 | MEDIUM | tokenFailures race | concurrent calls with the same (provider, store_id, operation) double-count `seen_count` and can send duplicate alerts (throttle SELECT is non-atomic vs UPSERT) |
| O4-MD-04 | MEDIUM | useDashboardRefresh sleep loop | 5s `setTimeout` sleep is unabortable — orphaned poll loop keeps closures alive up to 5s past unmount; `setIsRefreshing(false)` fires on unmounted tree |
| O4-MD-05 | MEDIUM | sendDailySummary skip-path UX | `result.skipped: true` returns successfully WITHOUT throw → Inngest marks run "Completed" → operator gets zero signal that the daily summary just silently dropped |
| O4-MD-06 | MEDIUM | dashboardState POST size check | `JSON.stringify(value).length` counts UTF-16 code units, not bytes — a 60KB payload of 2-byte Hebrew strings (~30K chars) passes the 64KB gate but yields ~120KB on disk |
| O4-LO-01 | LOW | cron-live `Object.entries(new Map())` | cronDaily soft-fail returns Maps where the type says `Record<string, ...>`; `Object.entries` on a Map silently returns `[]` — type lies, behaviour just-happens-to-work |
| O4-LO-02 | LOW | pushCloudKey truthiness | `!pendingTimers[localStorageKey]` treats setTimeout id `0` as "no timer" — browser id 0 is theoretical but harmlessly possible; use `=== undefined` |
| O4-LO-03 | LOW | shopify OAuth race | concurrent Shopify token refreshes (one storeId, parallel cold-cache callers) make N concurrent OAuth POSTs — wasteful, not unsafe |
| O4-LO-04 | LOW | cron-live dead code | `enrollmentsByPlatformAdSet` Map built but never read |
| O4-IN-01 | INFO | cron-daily concurrent overlap | cron-live retries after dead-letter window can race cron-daily's per-day rewrite — currently benign because cron-live writers preserve via override-or-prior pattern |
| O4-IN-02 | INFO | jobs route hardcoded Hebrew | env-missing error string in `app/api/operator/jobs` hard-coded, bypasses `userFacingError()` — fine here but worth noting it diverges from the shared sanitiser |
| O4-IN-03 | INFO | manual-overrides DELETE non-idempotent feedback | `DELETE` returns `{ ok: true }` even when 0 rows matched — caller can't distinguish "deleted" from "no-op" |

---

## CRITICAL findings

### O4-CR-01 — `cadFor()` inside `persist-batch` throws on FX failure → partial-state daily writer

**File:** `dashboard-web/src/inngest/functions/cronDaily.ts:441-451` (closure), called from `:583`, `:587`, `:594-600`, `:690`, `:695`, `:731`, `:735`, `:816`, `:820`, plus the inline TikTok exchange at `:396-409`

**Code:**
```ts
const cadFor = async (amount: number, currency: string): Promise<number> => {
  if (!Number.isFinite(amount) || amount === 0) return 0;
  const cur = (currency || 'ILS').toUpperCase();
  if (cur === 'CAD') return amount;
  let rate = fxCache.get(cur);
  if (rate === undefined) {
    rate = await getFxRate(cur, 'CAD', dateStr);   // ← throws on FX failure
    fxCache.set(cur, rate);
  }
  return amount * rate;
};
```

And the TikTok variant (no fxCache, hits FX directly):
```ts
const ttSpendCad =
  tiktok.spend.spend > 0
    ? await (async () => {
        const cur = (tiktok.spend.currency || 'USD').toUpperCase();
        if (cur === 'CAD') return tiktok.spend.spend;
        const rate = await getFxRate(cur, 'CAD', dateStr);  // ← throws
        return tiktok.spend.spend * rate;
      })()
    : 0;
```

`getFxRate` in `fetchers/fx.ts:45-72` `throw`s on `!res.ok` and on `!rate`. There is no try/catch around `cadFor` invocations inside `step.run('persist-batch', ...)`.

**Why this is critical:** v2 explicitly fixed cron-LIVE's FX handling (a/WARN-3, comment at cronLive.ts:550-583) so a Frankfurter outage doesn't corrupt CAD spend with raw ILS/USD values. That fix is NOT mirrored in cron-DAILY. Inside `persist-batch`:

1. `data_daily` upsert (`:459-477`) lands FIRST — succeeds.
2. `products_daily` upsert (`:489-513`) — succeeds.
3. `campaigns_daily` (meta) upsert (`:534-620`) — builds `metaCampaignRows` via `Promise.all(meta.adsetRows.map(async (r) => ({... spend_cad: await cadFor(r.spend, r.currency), ...})))`. **If Frankfurter is down, `cadFor` throws inside the map**, the Promise.all rejects, the step throws.
4. `campaigns_daily` (google) upsert (`:627-662`) — never runs.
5. `ads_daily` upsert (`:676-750`) — never runs.
6. `campaigns_daily` (tiktok) upsert (`:757-844`) — never runs.
7. `orders_attribution` (`:856-882`) — never runs.
8. `product_catalog` (`:891-912`) — never runs.

Inngest retries the step 4× with exponential backoff (~7.5min total). If Frankfurter recovers in-window: catch up via idempotent upserts. If Frankfurter stays down: dead-letter → only `data_daily` + `products_daily` for that day exist; campaigns_daily, ads_daily, orders_attribution, product_catalog are MISSING. Dashboard for that day shows partial revenue (Shopify-derived) but no campaign/ad detail. Operator has to manually re-run via `/api/operator/sync-now`.

Worse, the inline TikTok exchange at `:396-409` runs BEFORE `data_daily.upsert` — if FX throws there, even `data_daily` doesn't write, and the whole day's data_daily is missing. That breaks cron-live's preserve logic too (it sees no row to preserve from).

**Fix:**
```ts
const cadFor = async (amount: number, currency: string): Promise<number> => {
  if (!Number.isFinite(amount) || amount === 0) return 0;
  const cur = (currency || 'ILS').toUpperCase();
  if (cur === 'CAD') return amount;
  let rate = fxCache.get(cur);
  if (rate === undefined) {
    try {
      rate = await getFxRate(cur, 'CAD', dateStr);
    } catch (e) {
      console.warn(
        `cron-daily ${storeId} ${dateStr}: FX ${cur}->CAD failed — leaving amount in source currency would corrupt CAD columns; returning null sentinel.`,
        e instanceof Error ? e.message : e,
      );
      // Mirror cron-live a/WARN-3: skip update for this row rather than
      // corrupting with raw foreign-currency amount. The upsert builder
      // must handle a null `spend_cad` (preserve-prior on conflict).
      throw new Error(`FX_SKIP:${cur}`); // sentinel; persist code catches
    }
    fxCache.set(cur, rate);
  }
  return amount * rate;
};
```

Then wrap each per-row build in try/catch and OMIT the spend_cad column from the payload when FX failed → ON CONFLICT preserves the prior value. (Same per-platform-preserve pattern cron-live uses.) Also wrap the inline TikTok exchange similarly so ttSpendCad becomes 0 (or omitted from the data_daily payload) on FX failure rather than throwing.

---

## HIGH findings

### O4-HI-01 — refresh-effective-status `Promise.all` over per-ad-set UPDATE — one failure kills entire batch

**File:** `dashboard-web/src/inngest/functions/cronLive.ts:1017-1032`

**Code:**
```ts
for (const platform of platforms) {
  const platformEnrollments = enrollments.filter((e) => e.platform === platform);
  if (platformEnrollments.length === 0) continue;
  await Promise.all(
    platformEnrollments.map(({ adSetId, status }) =>
      admin
        .from('campaigns_daily')
        .update({ effective_status: status })
        .eq('store_id', storeId)
        .eq('platform', platform)
        .eq('ad_set_id', adSetId)
        .gte('date', lookbackFrom)
        .lt('date', today),
    ),
  );
}
```

`Promise.all` rejects on the first failure — there is NO try/catch around each per-ad-set chain. For uzoshop's typical Meta inventory (~100s of ad-sets), every cron-live tick (every 10 min) fires 100s of concurrent UPDATE requests against PostgREST. A single rate-limit response, a transient 5xx, or a single CHECK violation (the `effective_status` column has no CHECK constraint today but adding one downstream is plausible) takes down the entire `refresh-effective-status` step. Inngest retries 4× → if the same failure repeats, the whole step dead-letters even though ~99% of the updates would have succeeded.

Compare to the UPSERT loop at lines 985-999 which DOES log-and-continue per chunk failure. The UPDATE batch should mirror that pattern.

**Fix:** Replace `Promise.all` with a `for...of await` loop wrapped in try/catch:
```ts
for (const platform of platforms) {
  const platformEnrollments = enrollments.filter((e) => e.platform === platform);
  if (platformEnrollments.length === 0) continue;
  for (const { adSetId, status } of platformEnrollments) {
    try {
      await admin
        .from('campaigns_daily')
        .update({ effective_status: status })
        .eq('store_id', storeId)
        .eq('platform', platform)
        .eq('ad_set_id', adSetId)
        .gte('date', lookbackFrom)
        .lt('date', today);
    } catch (e) {
      console.warn(
        `cron-live: status update for ${platform}/${adSetId} failed (continuing):`,
        e instanceof Error ? e.message : e,
      );
    }
  }
}
```

Or, if throughput matters more than per-item isolation, use `Promise.allSettled` and log rejections.

### O4-HI-02 — `whatsapp-eod` at 00:10 IL leaves only 5 min for cronDaily's retry budget

**File:** `dashboard-web/src/inngest/functions/cronWhatsapp.ts:89-102` (EOD trigger at 00:10) + `inngest/functions/cronDaily.ts:966` (cron-daily at 00:05) + `lib/notifications/summary.ts:131-132`

**Code:**
```ts
// cronWhatsapp.ts:94
triggers: [{ cron: 'TZ=Asia/Jerusalem 10 0 * * *' }],
...
const dateStr = yesterdayJerusalem();
return await sendDailySummary(dateStr, titleEod(dateStr));
```

```ts
// summary.ts:131-132
const dataRows = dataDailyRes.data ?? [];
if (dataRows.length === 0) return null;
```

```ts
// templateParams.ts:158-160
if (summary && summary.totals) {
  params.push(totalsBlock(summary.totals));
} else {
  params.push('אין נתונים זמינים');
}
```

cron-daily fires at 00:05 IL processing "yesterday". With Inngest's default 4-retry exponential backoff (30s, 1min, 2min, 4min ≈ 7.5min before dead-letter), if the first attempt fails (Frankfurter outage, Meta 429, Shopify slow, see O4-CR-01), the writer may still be retrying at 00:10 when the WhatsApp EOD trigger fires.

`buildStoreSummary` reads `data_daily WHERE date = yesterday`. If cronDaily hasn't yet upserted yesterday's row, `dataRows.length === 0` → returns null → `buildTemplateParameters(null, title)` → all 3 store slots fill with "—" and the totals slot fills with "אין נתונים זמינים". The operator gets a WhatsApp message at 00:10 saying "yesterday: no data available" — which is misleading; the data is on its way, the writer just hasn't finished yet.

**Fix:** Either
1. Move `whatsapp-eod` to 00:30 IL (gives full 25 min for cronDaily retries), OR
2. Make `whatsapp-eod` `step.invoke()` the eventSyncNow for yesterday with `{date: yesterday}`, then send — guaranteed ordering.

The second is the right answer architecturally. The first is the one-line fix.

### O4-HI-03 — backfill route accepts malformed dates that downstream `Date.UTC` normalises to wild values

**File:** `dashboard-web/src/app/api/operator/backfill/route.ts:77-79`

**Code:**
```ts
function isDate(s: unknown): s is string {
  return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);
}
```

The regex accepts `2026-99-99`, `2026-13-32`, `0000-00-00`. Then `event/backfill` worker at `eventBackfill.ts:140-148`:
```ts
function* dateRange(from: string, to: string): Generator<string> {
  const [fy, fm, fd] = from.split('-').map(Number);
  const [ty, tm, td] = to.split('-').map(Number);
  const start = new Date(Date.UTC(fy, fm - 1, fd));   // ← Date.UTC normalises
  const end = new Date(Date.UTC(ty, tm - 1, td));
  for (let d = start; d <= end; d = new Date(d.getTime() + 24 * 60 * 60 * 1000)) {
    yield d.toISOString().slice(0, 10);
  }
}
```

`Date.UTC(2026, 98, 99)` overflows to a date ~8 years and ~98 days into the future. The loop would iterate (potentially thousands of dates if `from`/`to` are both extreme) and fetch each from Shopify/Meta/Google with bizarre date strings — wasted Inngest exec budget, wasted Meta quota, all returning empty data. Worst case: a malformed input creates a multi-year range that exhausts the free-tier Inngest budget in one backfill click.

The HISTORY_BOUNDARY check (`body.from < '2026-05-01'`) does string compare, so `'2026-99-99'` > `'2026-05-01'` passes. Range check (`body.from > body.to`) is also lex — depends on which malformed string is which side.

**Fix:** Add real date validation in `isDate` (already exists shape-wise; just add a `Date.parse` round-trip):
```ts
function isDate(s: unknown): s is string {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  // Round-trip through Date.UTC: a string that doesn't survive re-encoding
  // had an out-of-range component (month=99, day=32, etc.).
  const [y, m, d] = s.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return (
    dt.getUTCFullYear() === y &&
    dt.getUTCMonth() === m - 1 &&
    dt.getUTCDate() === d
  );
}
```

Same fix needed in `manual-overrides/route.ts:54-56` which has the identical regex-only isDate.

---

## MEDIUM findings

### O4-MD-01 — cloudSync migration push doesn't persist `lastPushAt` to localStorage

**File:** `dashboard-web/src/lib/cloudSync.ts:373-389`

**Code:**
```ts
if (!cloudHas) {
  // First-time migration: cloud has no row for this key at all. Push
  // local state up if any so partners on other devices pick it up.
  const local = readLocal(lsKey);
  if (local !== null) {
    lastPushAt[lsKey] = Date.now();   // ← in-memory only
    updateSyncState(prev => ({
      status: 'syncing',
      pendingKeys: prev.pendingKeys + 1,
    }));
    void postWithRetry(cloudKey, local);
  }
  continue;
}
```

Compare to `pushCloudKey` lines 220-222 which sets BOTH `lastPushAt[lsKey]` (in-memory) AND `setLastPushAt(lsKey, nowMs)` (localStorage-persisted) — the dual-write was the v2 d/CR-07-soft fix specifically to survive page reloads during the 8s grace window.

The migration path bypasses the `setLastPushAt` persistence. If the operator opens the dashboard for the first time on a new device (cloud row absent for some key), the migration push fires. If they refresh the page within 8s of the migration push starting, `getLastPushAt` returns 0 on the next hydrate (because we never persisted), so the new hydrate compares `Date.now() - 0` and the grace check fails. The hydrate sees `cloudHas === false` again (because the first migration POST is still in-flight or its response hasn't propagated yet) → starts ANOTHER migration push for the same key. Both write to cloud. The newer one wins. Usually benign because both push the same `local` value — but if `readLocal(lsKey)` changed between the two reads (rare, but plausible with a fast in-page edit), the migrations race with different values.

`postWithRetry` does call `setLastPushAt` on success (lines 275-280), so the protection is correct AFTER the POST completes. The window for the bug is just the in-flight time of the migration POST.

**Fix:** Mirror `pushCloudKey`'s dual-write at the migration site:
```ts
if (!cloudHas) {
  const local = readLocal(lsKey);
  if (local !== null) {
    const nowMs = Date.now();
    lastPushAt[lsKey] = nowMs;
    setLastPushAt(lsKey, nowMs);   // ← add this
    updateSyncState(prev => ({
      status: 'syncing',
      pendingKeys: prev.pendingKeys + 1,
    }));
    void postWithRetry(cloudKey, local);
  }
  continue;
}
```

### O4-MD-02 — cron-live `products_daily` partial-day write can clobber cron-daily's authoritative full-day numbers

**File:** `dashboard-web/src/inngest/functions/cronLive.ts:413-434`

**Code:**
```ts
if (shopify.productRows.length > 0) {
  const productRows = shopify.productRows.map((p) => ({
    date,
    store_id: storeId,
    store_name: shopify.storeName,
    product_id: p.product_id,
    product_title: p.product_title || '(refund-only)',
    units: p.units,
    orders: p.orders,
    gross_revenue_cad: p.gross_revenue_cad,
    net_revenue_cad: p.net_revenue_cad,
  }));

  const { error: prodErr } = await admin
    .from('products_daily')
    .upsert(productRows, { onConflict: 'date,store_id,product_id' });
```

Comment at lines 400-411 acknowledges this changed in Phase 05.7.8 from "PK-only payload" to "include units/orders/gross". The rationale was correct for INSERT (avoid phantom rows) but on UPDATE this payload OVERWRITES whatever cron-daily wrote. The rolling window includes today + yesterday + day-before. For yesterday and day-before, cron-daily wrote the AUTHORITATIVE full-day numbers at 00:05 IL.

Scenario: cron-daily ran at 00:05 IL and wrote yesterday's products_daily with `units=42, orders=15`. Then cron-live fires at 00:10 IL — `fetchShopifyDayRows(storeId, yesterday)` returns the same full-day numbers (because yesterday is closed; Shopify returns the same orders). So upsert writes `units=42, orders=15` — same value, no harm.

But what if cron-live's fetch is SLIGHTLY different from cron-daily's? Cross-day refunds can mutate `net_revenue_cad`. The algorithm in `shopifyRevenueRefunds.ts` is meant to handle this correctly, but if there's any drift between cron-daily's and cron-live's fetch (e.g., a refund processed in the intervening 5 min), cron-live's value would supersede. That's actually intended — it's the v2 CR-02 fix that gave cron-live ownership of stale-spend recovery.

The actual bug: when cron-live's `fetchShopifyDayRows` SOFT-FAILS for one date but cron-daily SUCCEEDED for it, cron-live's `__shopifyFailed` sentinel correctly skips persist for that date (lines 686-691). Good.

But when Shopify returns successfully but with FEWER products than yesterday (e.g., a product was deleted from Shopify Admin overnight), the cron-live upsert doesn't include the deleted product. Its row stays in products_daily with cron-daily's last value. That's fine.

So this is actually OK on closer inspection. **Downgrading my own concern: this is INFO not MEDIUM.** Cron-live's products_daily writes are convergent with cron-daily for yesterday + day-before since `fetchShopifyDayRows` is deterministic for closed days. The "units / orders" in cron-live's payload at idx>=1 always equals cron-daily's value modulo the 48h cross-day refund window — which is the whole point of the rolling window.

I'll keep the finding in the table but note it's mostly INFO. Reclassifying inline: see O4-IN-01 below.

### O4-MD-03 — tokenFailures concurrent SELECT-then-UPSERT race

**File:** `dashboard-web/src/lib/notifications/tokenFailures.ts:167-309`

**Code (excerpted):**
```ts
// 1. SELECT
const { data } = await sb.from('token_failures').select(...).maybeSingle();
existing = data;

// 2. throttle decision
const lastAlertMs = existing?.last_alert_sent_at ? ... : 0;
const shouldAlert = !lastAlertMs || now - lastAlertMs >= ALERT_THROTTLE_MS;

// 3. send WhatsApp (may throw, caught)
if (shouldAlert) { try { await sendWhatsAppTemplate(...); } catch ... }

// 4. UPSERT
const payload = {
  ...,
  seen_count: (existing?.seen_count ?? 0) + 1,
  alerts_sent_count: (existing?.alerts_sent_count ?? 0) + (result.alerted ? 1 : 0),
};
await sb.from('token_failures').upsert(payload, { onConflict: 'provider,store_id,operation' });
```

Two concurrent callers for the same key (e.g., parallel cron-live ticks for the same store, or fetch-meta + a future fetch-meta-secondary both hitting auth simultaneously, or test harness with mock concurrency):

| Time | Caller A | Caller B |
|---|---|---|
| t0 | SELECT → seen=5, last_alert=5h-ago | |
| t0+1ms | | SELECT → seen=5, last_alert=5h-ago |
| t0+2ms | throttle: 5h < 6h, skip | |
| t0+3ms | | throttle: 5h < 6h, skip |
| t1 | UPSERT seen=6, alert+=0 | |
| t1+1 | | UPSERT seen=6, alert+=0 |

End state: `seen_count=6` instead of `7`. Lost one observation.

Same race when `shouldAlert === true`:
- both callers SELECT before the other UPSERTs `last_alert_sent_at`
- both compute `shouldAlert = true`
- both send WhatsApp
- both UPSERT `last_alert_sent_at = now`, both UPSERT `alerts_sent_count = existing+1 = N+1` (lost +2 vs N+2)

Operator gets TWO duplicate WhatsApp messages within ms of each other; the throttle counter reports +1 instead of +2.

Currently inert because **no fetcher calls `notifyTokenFailure`** (confirmed by grep — only `cronDaily.ts:265-267` mentions it in a comment, no runtime callers). Once the Meta template is approved and fetchers start invoking it, this race goes live.

**Fix:** Use an atomic increment via Postgres RPC or a stored procedure:
```sql
CREATE OR REPLACE FUNCTION record_token_failure(...) RETURNS void AS $$
  INSERT INTO token_failures (provider, store_id, operation, ..., seen_count, ...)
  VALUES (..., 1, ...)
  ON CONFLICT (provider, store_id, operation)
  DO UPDATE SET
    seen_count = token_failures.seen_count + 1,
    alerts_sent_count = token_failures.alerts_sent_count + EXCLUDED.alerts_sent_count,
    last_seen_at = EXCLUDED.last_seen_at,
    last_alert_sent_at = COALESCE(EXCLUDED.last_alert_sent_at, token_failures.last_alert_sent_at),
    ...
$$;
```

Then call `sb.rpc('record_token_failure', {...})` instead of SELECT + UPSERT.

For the alert dedup: gate the WhatsApp send by checking the RETURNING row's previous `last_alert_sent_at` value (atomically) — only send if the value advanced from old → new in this transaction.

### O4-MD-04 — useDashboardRefresh sleep loop unabortable

**File:** `dashboard-web/src/lib/useDashboardRefresh.ts:83-110`

**Code:**
```ts
while (Date.now() - startedPolling < MAX_WAIT_MS) {
  if (signal.aborted) break;
  await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));   // ← unabortable
  if (signal.aborted) break;
  try {
    const probe = await fetch(`/api/data?_t=${Date.now()}`, {
      cache: 'no-store',
      signal,
    });
    ...
```

`new Promise((r) => setTimeout(r, 5000))` does not check the abort signal — it resolves after exactly 5 seconds regardless. On unmount, the abort fires but the in-flight sleep keeps the closure alive for up to 5 seconds. The `signal.aborted` check after the sleep does break the loop eventually, BUT:
- the `finally` block runs `setIsRefreshing(false)` on an unmounted component → React dev warning (and a wasted setState).
- the closure prevents GC of the captured `mutate`, `controller`, etc. for up to 5s × N unmounts during rapid navigation.

**Fix:** Make the sleep abort-aware:
```ts
function abortableSleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException('Aborted', 'AbortError'));
      return;
    }
    const t = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(t);
      reject(new DOMException('Aborted', 'AbortError'));
    };
    signal.addEventListener('abort', onAbort, { once: true });
  });
}
```

Then `await abortableSleep(POLL_INTERVAL_MS, signal)` and catch the AbortError to break.

Also gate the `setIsRefreshing(false)` in the finally on a mounted flag (or move it inside an `if (!signal.aborted)`).

### O4-MD-05 — `sendDailySummary` skip-path returns success — Inngest run looks healthy

**File:** `dashboard-web/src/lib/notifications/sendDailySummary.ts:51-68`

**Code:**
```ts
const cfg = await loadActiveMetacloudConfig();
if (!cfg) {
  result.skipped = true;
  result.skipReason = 'no active metacloud notification_config row';
  return result;
}
if (!cfg.templateName) {
  result.skipped = true;
  result.skipReason = 'notification_config.template_name is empty';
  return result;
}
const recipients = [cfg.phone1, cfg.phone2].filter(...);
if (recipients.length === 0) {
  result.skipped = true;
  result.skipReason = 'no recipients configured (phone1 + phone2 both null)';
  return result;
}
```

Each of these "intentional skip" branches returns the SendResult normally. The Inngest run completes successfully. The operator sees a green "Completed" row in the JobsTable. There's NO operator-visible signal that the daily summary just got silently dropped.

v2 fix (a/WARN-2 at lines 100-119) made partial-recipient FAILURES throw, but the upstream "no config" / "no recipients" paths still silently succeed. If someone fat-fingers an UPDATE on `notification_config` setting `active = FALSE`, the next 3 WhatsApp crons all return "skipped" — operator gets no WhatsApp, no alert, no failed-run badge to investigate.

**Fix:** Treat "skipped" as a soft-warning at minimum — log loudly with `console.warn`. Or better, since the operator has explicitly configured the cron to fire, treat the absence of any recipient OR active config as a configuration error and throw (which forces a Failed Inngest run):
```ts
if (!cfg) {
  throw new Error(
    'sendDailySummary: no active metacloud notification_config row — ' +
    'WhatsApp summary skipped. Check /operator/notifications config.'
  );
}
```

This aligns with the v2 spirit: "the operator's WhatsApp deployment is single-recipient — any silent drop is a bug". Inngest will retry, but if config is permanently bad, the dead-letter at least surfaces in the JobsTable.

### O4-MD-06 — dashboardState POST size check counts UTF-16 code units, not bytes

**File:** `dashboard-web/src/app/api/dashboard-state/route.ts:103-106`

**Code:**
```ts
const serialized = JSON.stringify(body.value ?? null);
if (serialized.length > VALUE_MAX_BYTES) {
  return NextResponse.json({ error: 'value too large' }, { status: 413 });
}
```

`String.length` returns UTF-16 code units. Hebrew characters are 2 bytes in UTF-8. A 64,000-char Hebrew string passes the 64,000-byte gate but encodes to ~120KB on disk. A 64,000-char emoji string (4 bytes per emoji in UTF-8, encoded as surrogate pairs in UTF-16 = 2 code units each) passes the 64,000-byte gate but encodes to ~128KB on disk.

For the current `dashboard-state` keys (billing, annotations, campaign-product-map), payloads are mostly Latin product IDs and numbers — the gap is small. But the comment claims "~64KB matches the practical per-cell budget" — the gate doesn't actually enforce 64KB; it enforces 64K UTF-16 code units which is up to 256KB UTF-8 in pathological cases.

**Fix:** Use `Buffer.byteLength(serialized, 'utf8')` or `new TextEncoder().encode(serialized).length`:
```ts
const serialized = JSON.stringify(body.value ?? null);
const sizeBytes = new TextEncoder().encode(serialized).length;
if (sizeBytes > VALUE_MAX_BYTES) {
  return NextResponse.json({ error: 'value too large' }, { status: 413 });
}
```

---

## LOW

- **O4-LO-01 — cronDaily soft-fail Maps vs declared Record**
  `cronDaily.ts:284-289` returns `{ campaigns: new Map(), adSets: new Map() }` for the Meta soft-fail path. The `MetaBudgets` type at `fetchers/meta.ts:142-194` declares both as `Record<string, ...>`. Production consumers (`cronDaily.ts:552`, `cronLive.ts:889`) treat them as objects via `metaBudgets.campaigns[id]` and `Object.entries(metaBudgets.adSets)` — `Object.entries(new Map())` returns `[]` (Map's enumerable own keys are empty), and bracket access on a Map returns undefined. So functionally "empty" works for both — but the type lies and any future consumer using `for...of` over `.entries()` or `Object.values` would silently get wrong results. Fix: return `{ campaigns: {}, adSets: {} }` matching the declared type.

- **O4-LO-02 — `!pendingTimers[localStorageKey]` treats setTimeout id 0 as "no timer"**
  `cloudSync.ts:186`. In browsers, `setTimeout` returns a number; while in practice modern engines return 1+, the spec allows 0. Use `pendingTimers[localStorageKey] === undefined` to be unambiguous.

- **O4-LO-03 — Shopify OAuth refresh race for parallel cold-cache callers**
  `fetchers/shopifyAuth.ts:53-58`. cron-live's persist-rolling-3day fetches 3 days in parallel; on a cold cache for one storeId, all 3 fire the OAuth exchange. Last write wins. Wasted ~3× API call, not unsafe. Fix: add a per-store in-flight `Promise<TokenCacheEntry>` to coalesce concurrent refreshes.

- **O4-LO-04 — dead `enrollmentsByPlatformAdSet` Map**
  `cronLive.ts:1013-1016` builds a Map that's never read; the loop below uses `enrollments.filter` directly. Remove the dead map.

---

## INFO

- **O4-IN-01 — cron-live overwrites cron-daily's per-product full-day numbers (mostly benign convergence)**
  See O4-MD-02 analysis. cron-live's rolling-window products_daily payload includes `units/orders/gross/net` for yesterday and day-before. For closed days these equal cron-daily's value modulo cross-day refunds (which IS the whole point), so the overwrite is convergent. Worth noting as a deliberate design (idx>=1 of the rolling window has authoritative ownership for refund-impacted data), not a bug.

- **O4-IN-02 — `/api/operator/jobs` hard-codes Hebrew error string instead of `userFacingError`**
  `app/api/operator/jobs/route.ts:99-114`. The env-missing path returns `'הטעינה נכשלה: משתני סביבה חסרים.'` directly — bypasses the shared sanitiser. Fine here, but inconsistent. Same string is generated by `userFacingError()` when invoked on the same error message.

- **O4-IN-03 — `manual-overrides` DELETE returns ok even for 0-row matches**
  `app/api/operator/manual-overrides/route.ts:259-270`. Doesn't surface "did this actually delete anything?" — caller can't distinguish "successful delete" from "stale id, nothing to delete". Add `{ count: 'exact' }` and return the affected count.

- **O4-IN-04 — `pendingKeys` accounting depends on `Math.max(0, ...)` clamp as a safety net**
  `cloudSync.ts:211, 286, 301`. The clamps prevent negative counters but mask any future refactor that introduces a real over-decrement. Today the math balances out (I traced through retry-cancel / debounce-replace / migration-push); but a comment near each clamp explaining "this clamp is defensive, the math should never go negative — if it does, log it" would help future maintainers spot regressions.

- **O4-IN-05 — `whatsapp-eod`, `whatsapp-noon`, `whatsapp-evening` all use a single `step.run('send', ...)` callback**
  `cronWhatsapp.ts:53-58`, `:72-77`, `:97-102`. The entire `sendDailySummary` call (which loads config, builds summary across 3 SELECTs, builds template params, loops over recipients) is one Inngest step. If Inngest retries on transient failure, it re-runs everything including the 3 Supabase SELECTs — wasteful but idempotent. Splitting into `step.run('load-config')`, `step.run('build-summary')`, `step.run('send-each-recipient', loop)` would memoize each phase. Not a bug, just a free-tier-budget observation.

- **O4-IN-06 — `whatsapp-noon` and `whatsapp-evening` use `todayJerusalem()` — which is "TODAY so far"**
  `cronWhatsapp.ts:55, 73`. The 12:00 IL message reads `data_daily` for today's date — but cron-live's first tick of the day is at 00:10 IL (next */10 mark), and cron-daily wrote YESTERDAY's row at 00:05 IL. So at 12:00 IL, today's row exists ONLY because cron-live has been ticking since midnight (12 ticks × 10min = 2h of writes). If cron-live failed every tick (Inngest worker down, Vercel outage), today's row is missing and the noon WhatsApp shows "—" for each store. Currently surfaces as "אין נתונים זמינים" totals (acceptable but degraded). Worth being aware that the noon message's data dependency chain is long.

---

## Files reviewed

- `lib/cloudSync.ts`
- `lib/drawerStack.ts`
- `lib/useDashboardRefresh.ts`
- `lib/types.ts`
- `lib/utils.ts`
- `lib/supabase.ts`
- `lib/supabaseAdmin.ts`
- `lib/operatorReset.ts`
- `lib/apiErrors.ts`
- `lib/sheets.ts` (state-key allowlist surface only)
- `lib/postgresReaders.ts` (dashboard-state + last-write-at functions only)
- `lib/hooks/useBillingOneTime.ts`
- `lib/hooks/useBillingRecurring.ts`
- `lib/hooks/useCampaignAttribution.ts`
- `lib/hooks/useCampaignTrueRevenue.ts`
- `lib/notifications/sendDailySummary.ts`
- `lib/notifications/summary.ts`
- `lib/notifications/templateParams.ts`
- `lib/notifications/tokenFailures.ts`
- `lib/notifications/whatsapp.ts`
- `lib/fetchers/fx.ts`
- `lib/fetchers/manualOverrides.ts`
- `lib/fetchers/shopify.ts`
- `lib/fetchers/shopifyAuth.ts`
- `lib/fetchers/meta.ts`
- `lib/fetchers/googleAds.ts`
- `lib/fetchers/tiktok.ts`
- `inngest/client.ts`
- `inngest/functions/cronDaily.ts`
- `inngest/functions/cronLive.ts`
- `inngest/functions/cronWhatsapp.ts`
- `inngest/functions/eventBackfill.ts`
- `inngest/functions/eventSyncNow.ts`
- `app/api/data/route.ts`
- `app/api/health/route.ts`
- `app/api/dashboard-state/route.ts`
- `app/api/inngest/route.ts`
- `app/api/operator/sync-now/route.ts`
- `app/api/operator/backfill/route.ts`
- `app/api/operator/jobs/route.ts`
- `app/api/operator/manual-overrides/route.ts`
- `app/api/operator/reset/route.ts`
- `app/api/operator/notifications/send/route.ts`
- `app/api/operator/token-failures/route.ts`
