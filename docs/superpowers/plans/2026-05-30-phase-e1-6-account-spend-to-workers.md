# Phase E1.6 — Account-level Spend → Workers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make cron-live truly Shopify-only by moving the per-platform account-level spend fetch (Meta + Google + TikTok, rolling 3-day window) into the 3 hot_metrics worker branches via a new bulk-date fetcher per platform.

**Architecture:** 5 helper/fetcher files NEW (shared cadConvert + shared upsertDataDailySpend + 3 platform fetchers), 3 worker steps NEW (one per worker), ~150 lines REMOVED from cron-live. Partial-column UPSERT on data_daily mediates the race between worker writes (spend columns) and cron-live writes (revenue + derived).

**Tech Stack:** TypeScript (Node 20), Inngest, Supabase, Vitest, Meta Graph API, Google Ads API (GAQL), TikTok Marketing API.

**Spec:** [docs/superpowers/specs/2026-05-30-phase-e1-6-account-spend-to-workers-design.md](../specs/2026-05-30-phase-e1-6-account-spend-to-workers-design.md)

---

## Pre-flight context

| Fact | Source / location |
|---|---|
| `cron-live`'s account-spend step | `dashboard-web/src/inngest/functions/cronLive.ts:866` (`fetch-meta-google-tiktok-spend-light-3day`) |
| `cron-live`'s 3 select-prior-spend steps | `dashboard-web/src/inngest/functions/cronLive.ts:~1108-1128` |
| `cron-live`'s persist step | `dashboard-web/src/inngest/functions/cronLive.ts:~1131-1300` (`persist-rolling-3day`) |
| Meta single-date fetcher | `dashboard-web/src/lib/fetchers/meta.ts:442` (`fetchMetaSpendForDayLight`) |
| Google single-date fetcher | `dashboard-web/src/lib/fetchers/googleAds.ts:369` (`fetchGoogleAdsSpendForDay`) |
| TikTok single-date fetcher | `dashboard-web/src/lib/fetchers/tiktok.ts:281` (`fetchTikTokSpendForDay`) |
| Worker hot_metrics branches | `metaWorker.ts:295`, `googleWorker.ts:302`, `tiktokWorker.ts:377` (`runXxxHotMetricsBranch`) |
| Meta BUC gate (existing in all workers) | metaWorker line ~337 (skip if `etaMinutes > 0 || pct >= HARD_SKIP_PCT`) |
| FX-failure semantics (the cadConvert pattern) | `cronLive.ts:882-901` (returns null on FX failure; caller omits column from UPSERT to preserve prior value) |

---

### Task 1: Extract shared `cadConvert` helper

**Files:**
- Create: `dashboard-web/src/lib/inngest/cadConvert.ts`
- Create: `dashboard-web/src/lib/inngest/__tests__/cadConvert.test.ts`

The CAD-conversion-with-FX-fail-null logic is currently inlined inside `cron-live`'s `fetch-meta-google-tiktok-spend-light-3day` step. Workers need the same exact behavior. Extract to a shared module.

- [ ] **Step 1: Write the failing test**

Create `dashboard-web/src/lib/inngest/__tests__/cadConvert.test.ts`:

```typescript
import { describe, expect, it, vi } from 'vitest';
import { makeCadConvert } from '@/lib/inngest/cadConvert';

describe('makeCadConvert', () => {
  it('passes through CAD amount unchanged', async () => {
    const convert = makeCadConvert(async () => 1.4);
    expect(await convert(100, 'CAD', '2026-05-30')).toBe(100);
  });

  it('multiplies by rate for non-CAD currency', async () => {
    const convert = makeCadConvert(async () => 1.4);
    expect(await convert(100, 'USD', '2026-05-30')).toBe(140);
  });

  it('returns 0 for zero amount (no FX call)', async () => {
    const getRate = vi.fn().mockResolvedValue(1.4);
    const convert = makeCadConvert(getRate);
    expect(await convert(0, 'USD', '2026-05-30')).toBe(0);
    expect(getRate).not.toHaveBeenCalled();
  });

  it('returns null for non-finite amount (no FX call)', async () => {
    const getRate = vi.fn();
    const convert = makeCadConvert(getRate);
    expect(await convert(Number.NaN, 'USD', '2026-05-30')).toBeNull();
    expect(getRate).not.toHaveBeenCalled();
  });

  it('returns null when FX getRate rejects (caller preserves prior column)', async () => {
    const convert = makeCadConvert(async () => { throw new Error('FX timeout'); });
    expect(await convert(100, 'USD', '2026-05-30')).toBeNull();
  });

  it('returns null when FX getRate returns NaN', async () => {
    const convert = makeCadConvert(async () => Number.NaN);
    expect(await convert(100, 'USD', '2026-05-30')).toBeNull();
  });

  it('returns null when FX getRate returns <= 0', async () => {
    const convert = makeCadConvert(async () => 0);
    expect(await convert(100, 'USD', '2026-05-30')).toBeNull();
  });

  it('uppercases currency before comparing', async () => {
    const convert = makeCadConvert(async () => 1.4);
    expect(await convert(100, 'usd', '2026-05-30')).toBe(140);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd /Users/dorperetz/script-roas/dashboard-web
npx vitest run src/lib/inngest/__tests__/cadConvert.test.ts
```

Expected: FAIL — `Cannot find module '@/lib/inngest/cadConvert'`.

- [ ] **Step 3: Create the helper**

Create `dashboard-web/src/lib/inngest/cadConvert.ts`:

```typescript
/**
 * Phase E1.6 (2026-05-30) — shared CAD-conversion-with-FX-fail-null helper.
 *
 * Extracted from cronLive.ts:882-901 (inline implementation). Workers
 * (metaWorker/googleWorker/tiktokWorker hot_metrics account-aggregate
 * step) need identical semantics: FX failure → null → caller OMITS the
 * affected CAD column from the data_daily UPSERT payload, which
 * preserves the prior value via Supabase's payload-key-only SET clause.
 *
 * Audit fix history (carried over from cronLive's inlined version,
 * 2026-05-23 a/WARN-3): pre-fix code used `.catch(() => 1)` which
 * silently converted USD as CAD on FX outage, corrupting today's
 * spend column with raw USD numbers (~30% low). The null-preserve
 * pattern is the explicit "stale > wrong" failure mode.
 */

export type CadConvert = (
  amount: number,
  currency: string,
  dateStr: string,
) => Promise<number | null>;

/**
 * Factory: takes an FX rate fetcher and returns the conversion function.
 *
 * The factory pattern keeps the helper pure for testing (caller injects a
 * mock getRate) while letting production wire `getFxRate` from
 * `@/lib/fx/getFxRate` once at worker bind time.
 */
export function makeCadConvert(
  getRate: (from: string, to: 'CAD', dateStr: string) => Promise<number>,
): CadConvert {
  return async (amount, currency, dateStr) => {
    if (!Number.isFinite(amount)) return null;
    if (amount === 0) return 0;
    const cur = (currency || 'CAD').toUpperCase();
    if (cur === 'CAD') return amount;
    let rate: number;
    try {
      rate = await getRate(cur, 'CAD', dateStr);
    } catch {
      return null;
    }
    if (!Number.isFinite(rate) || rate <= 0) return null;
    return amount * rate;
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd /Users/dorperetz/script-roas/dashboard-web
npx vitest run src/lib/inngest/__tests__/cadConvert.test.ts
```

Expected: 8/8 PASS.

- [ ] **Step 5: Commit**

```bash
cd /Users/dorperetz/script-roas
git add dashboard-web/src/lib/inngest/cadConvert.ts \
        dashboard-web/src/lib/inngest/__tests__/cadConvert.test.ts
git commit -m "$(cat <<'EOF'
feat(phase-e1.6): extract shared cadConvert helper for worker reuse

Promotes the inlined CAD-conversion-with-FX-fail-null logic from
cronLive.ts (audit fix 2026-05-23 a/WARN-3) into a shared module so
the 3 hot_metrics workers can call it identically.

Semantics preserved bit-for-bit: FX timeout/error → null → caller
OMITS the affected column from the UPSERT payload → Supabase
preserves the prior value. "Stale > wrong" failure mode.

8 unit tests cover CAD passthrough, non-CAD multiplication, zero
short-circuit, NaN/non-finite reject, FX-reject/NaN/zero-rate returns
null, currency uppercasing.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Create shared `upsertDataDailySpend` helper

**Files:**
- Create: `dashboard-web/src/lib/inngest/upsertDataDailySpend.ts`
- Create: `dashboard-web/src/lib/inngest/__tests__/upsertDataDailySpend.test.ts`

Single helper that workers call to UPSERT one platform's spend + impressions for one (store, date) into data_daily. Handles the partial-column semantics (null spend → omit column → preserve prior value).

- [ ] **Step 1: Write the failing test**

Create `dashboard-web/src/lib/inngest/__tests__/upsertDataDailySpend.test.ts`:

```typescript
import { describe, expect, it, vi } from 'vitest';
import { upsertDataDailySpend } from '@/lib/inngest/upsertDataDailySpend';

function mockAdmin() {
  const upsert = vi.fn().mockResolvedValue({ error: null });
  const from = vi.fn().mockReturnValue({ upsert });
  return {
    admin: { from } as unknown as Parameters<typeof upsertDataDailySpend>[0]['admin'],
    spies: { from, upsert },
  };
}

describe('upsertDataDailySpend', () => {
  it('Meta: writes fb_spend_cad + fb_impressions when both non-null', async () => {
    const { admin, spies } = mockAdmin();
    await upsertDataDailySpend({
      admin,
      storeId: 'uzoshop',
      date: '2026-05-30',
      platform: 'meta',
      spendCad: 123.45,
      impressions: 6789,
    });
    expect(spies.from).toHaveBeenCalledWith('data_daily');
    expect(spies.upsert).toHaveBeenCalledWith(
      { date: '2026-05-30', store_id: 'uzoshop', fb_spend_cad: 123.45, fb_impressions: 6789 },
      { onConflict: 'date,store_id' },
    );
  });

  it('Google: writes ga_spend_cad + ga_impressions', async () => {
    const { admin, spies } = mockAdmin();
    await upsertDataDailySpend({
      admin,
      storeId: 'uzoshop',
      date: '2026-05-30',
      platform: 'google',
      spendCad: 200,
      impressions: 1000,
    });
    expect(spies.upsert).toHaveBeenCalledWith(
      { date: '2026-05-30', store_id: 'uzoshop', ga_spend_cad: 200, ga_impressions: 1000 },
      { onConflict: 'date,store_id' },
    );
  });

  it('TikTok: writes tt_spend_cad + tt_impressions', async () => {
    const { admin, spies } = mockAdmin();
    await upsertDataDailySpend({
      admin,
      storeId: 'uzoshop',
      date: '2026-05-30',
      platform: 'tiktok',
      spendCad: 50,
      impressions: 500,
    });
    expect(spies.upsert).toHaveBeenCalledWith(
      { date: '2026-05-30', store_id: 'uzoshop', tt_spend_cad: 50, tt_impressions: 500 },
      { onConflict: 'date,store_id' },
    );
  });

  it('OMITS spend column when spendCad === null (preserves prior value)', async () => {
    const { admin, spies } = mockAdmin();
    await upsertDataDailySpend({
      admin,
      storeId: 'uzoshop',
      date: '2026-05-30',
      platform: 'meta',
      spendCad: null,
      impressions: 6789,
    });
    expect(spies.upsert).toHaveBeenCalledWith(
      { date: '2026-05-30', store_id: 'uzoshop', fb_impressions: 6789 },
      { onConflict: 'date,store_id' },
    );
  });

  it('OMITS impressions column when impressions === null', async () => {
    const { admin, spies } = mockAdmin();
    await upsertDataDailySpend({
      admin,
      storeId: 'uzoshop',
      date: '2026-05-30',
      platform: 'meta',
      spendCad: 100,
      impressions: null,
    });
    expect(spies.upsert).toHaveBeenCalledWith(
      { date: '2026-05-30', store_id: 'uzoshop', fb_spend_cad: 100 },
      { onConflict: 'date,store_id' },
    );
  });

  it('SKIPS the UPSERT call entirely when both spendCad and impressions are null', async () => {
    const { admin, spies } = mockAdmin();
    await upsertDataDailySpend({
      admin,
      storeId: 'uzoshop',
      date: '2026-05-30',
      platform: 'meta',
      spendCad: null,
      impressions: null,
    });
    expect(spies.upsert).not.toHaveBeenCalled();
  });

  it('throws when Supabase returns an error', async () => {
    const upsert = vi.fn().mockResolvedValue({ error: { message: 'RLS denied' } });
    const from = vi.fn().mockReturnValue({ upsert });
    const admin = { from } as never;
    await expect(upsertDataDailySpend({
      admin,
      storeId: 'uzoshop',
      date: '2026-05-30',
      platform: 'meta',
      spendCad: 100,
      impressions: 1000,
    })).rejects.toThrow(/RLS denied/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd /Users/dorperetz/script-roas/dashboard-web
npx vitest run src/lib/inngest/__tests__/upsertDataDailySpend.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Create the helper**

Create `dashboard-web/src/lib/inngest/upsertDataDailySpend.ts`:

```typescript
/**
 * Phase E1.6 (2026-05-30) — partial-column UPSERT to data_daily for one
 * platform's spend + impressions on one (store, date).
 *
 * Workers (metaWorker / googleWorker / tiktokWorker hot_metrics) call
 * this after the account-aggregate fetch. cron-live writes the
 * disjoint columns (revenue + derived) via its own persist step.
 *
 * Race-mitigation: payload only contains the platform's own 2 columns
 * (fb_spend_cad + fb_impressions for Meta, ga_* for Google, tt_* for
 * TikTok) plus the PK (date, store_id). Supabase's payload-key-only
 * SET clause means our UPSERT never overwrites Shopify revenue/derived
 * columns owned by cron-live.
 *
 * FX-failure preservation: if either spendCad or impressions is null
 * (the cadConvert helper returned null), we OMIT that column from the
 * payload so Supabase preserves the prior value.
 *
 * Both-null short-circuit: if BOTH values are null, we skip the UPSERT
 * entirely (no DB call). Equivalent to "this fetch produced nothing
 * worth writing".
 */

import type { SupabaseClient } from '@supabase/supabase-js';

export type DataDailyPlatform = 'meta' | 'google' | 'tiktok';

type Input = {
  admin: SupabaseClient;
  storeId: string;
  date: string;
  platform: DataDailyPlatform;
  spendCad: number | null;
  impressions: number | null;
};

const SPEND_COL: Record<DataDailyPlatform, string> = {
  meta: 'fb_spend_cad',
  google: 'ga_spend_cad',
  tiktok: 'tt_spend_cad',
};

const IMPRESSIONS_COL: Record<DataDailyPlatform, string> = {
  meta: 'fb_impressions',
  google: 'ga_impressions',
  tiktok: 'tt_impressions',
};

export async function upsertDataDailySpend(input: Input): Promise<void> {
  const { admin, storeId, date, platform, spendCad, impressions } = input;
  if (spendCad === null && impressions === null) return;
  const row: Record<string, unknown> = { date, store_id: storeId };
  if (spendCad !== null) row[SPEND_COL[platform]] = spendCad;
  if (impressions !== null) row[IMPRESSIONS_COL[platform]] = impressions;
  const { error } = await admin
    .from('data_daily')
    .upsert(row, { onConflict: 'date,store_id' });
  if (error) {
    throw new Error(`data_daily upsert ${platform} ${storeId} ${date}: ${error.message}`);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd /Users/dorperetz/script-roas/dashboard-web
npx vitest run src/lib/inngest/__tests__/upsertDataDailySpend.test.ts
```

Expected: 7/7 PASS.

- [ ] **Step 5: Commit**

```bash
cd /Users/dorperetz/script-roas
git add dashboard-web/src/lib/inngest/upsertDataDailySpend.ts \
        dashboard-web/src/lib/inngest/__tests__/upsertDataDailySpend.test.ts
git commit -m "$(cat <<'EOF'
feat(phase-e1.6): upsertDataDailySpend helper — partial-column write

Single helper workers call to write one platform's (fb/ga/tt)_spend_cad
+ _impressions for one (store, date) into data_daily. Payload-only
SET semantics preserve revenue + derived columns owned by cron-live.

null spend/impressions → OMIT column → preserve prior (matches
cadConvert null-preserve contract).
Both null → skip UPSERT entirely.

7 unit tests cover the 3 platforms + 3 null permutations + Supabase
error path.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: `metaAccountSpendForDates` bulk fetcher

**Files:**
- Create: `dashboard-web/src/lib/fetchers/metaAccountSpend.ts`
- Create: `dashboard-web/src/lib/fetchers/__tests__/metaAccountSpend.test.ts`

One Meta Graph API call returns spend + impressions per date in a date range. Spec calls for `time_range` + `time_increment=1` to get one row per day in the range.

- [ ] **Step 1: Write the failing test**

Create `dashboard-web/src/lib/fetchers/__tests__/metaAccountSpend.test.ts`:

```typescript
import { describe, expect, it, vi } from 'vitest';
import { fetchMetaAccountSpendForDates } from '@/lib/fetchers/metaAccountSpend';

describe('fetchMetaAccountSpendForDates', () => {
  it('one Graph API call returns array of {date, spend, currency, impressions} per date in range', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        data: [
          { date_start: '2026-05-28', date_stop: '2026-05-28', spend: '100.50', impressions: '5000', account_currency: 'ILS' },
          { date_start: '2026-05-29', date_stop: '2026-05-29', spend: '200.00', impressions: '8000', account_currency: 'ILS' },
          { date_start: '2026-05-30', date_stop: '2026-05-30', spend: '50.25',  impressions: '3000', account_currency: 'ILS' },
        ],
      }),
      text: async () => '',
    });
    const rows = await fetchMetaAccountSpendForDates({
      adAccountId: '12345',
      accessToken: 'TOK',
      dates: ['2026-05-28', '2026-05-29', '2026-05-30'],
      fetcher: fetchImpl as unknown as typeof fetch,
    });
    // Single API call — time_range covers full window, time_increment=1
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const url = fetchImpl.mock.calls[0][0] as string;
    expect(url).toContain('act_12345/insights');
    expect(url).toContain('level=account');
    expect(url).toContain('time_increment=1');
    expect(url).toContain(encodeURIComponent('"since":"2026-05-28"'));
    expect(url).toContain(encodeURIComponent('"until":"2026-05-30"'));
    expect(url).toContain('fields=spend%2Cimpressions%2Caccount_currency');
    // Output: one entry per date the API returned
    expect(rows).toHaveLength(3);
    expect(rows[0]).toMatchObject({ date: '2026-05-28', spend: 100.50, currency: 'ILS', impressions: 5000 });
    expect(rows[2]).toMatchObject({ date: '2026-05-30', spend: 50.25, currency: 'ILS', impressions: 3000 });
  });

  it('returns empty array when the API returns no rows (early in day, no spend yet)', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ data: [] }),
      text: async () => '',
    });
    const rows = await fetchMetaAccountSpendForDates({
      adAccountId: '12345',
      accessToken: 'TOK',
      dates: ['2026-05-30'],
      fetcher: fetchImpl as unknown as typeof fetch,
    });
    expect(rows).toEqual([]);
  });

  it('throws on HTTP error with body snippet', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({}),
      text: async () => '{"error":{"message":"Invalid OAuth access token"}}',
    });
    await expect(fetchMetaAccountSpendForDates({
      adAccountId: '12345',
      accessToken: 'BAD',
      dates: ['2026-05-30'],
      fetcher: fetchImpl as unknown as typeof fetch,
    })).rejects.toThrow(/401/);
  });

  it('uses the lexicographically MIN date as since and MAX as until (handles unsorted input)', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ data: [] }),
      text: async () => '',
    });
    await fetchMetaAccountSpendForDates({
      adAccountId: '12345',
      accessToken: 'TOK',
      dates: ['2026-05-30', '2026-05-28', '2026-05-29'], // unsorted
      fetcher: fetchImpl as unknown as typeof fetch,
    });
    const url = fetchImpl.mock.calls[0][0] as string;
    expect(url).toContain(encodeURIComponent('"since":"2026-05-28"'));
    expect(url).toContain(encodeURIComponent('"until":"2026-05-30"'));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd /Users/dorperetz/script-roas/dashboard-web
npx vitest run src/lib/fetchers/__tests__/metaAccountSpend.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Create the fetcher**

Create `dashboard-web/src/lib/fetchers/metaAccountSpend.ts`:

```typescript
/**
 * Phase E1.6 (2026-05-30) — bulk-date account-level spend fetcher.
 *
 * Returns one row per date in `dates[]` from a single Meta Graph API
 * call using `time_range={since:min,until:max}` + `time_increment=1`
 * (one row per day in the window). Used by metaWorker's hot_metrics
 * branch to populate data_daily.fb_spend_cad / fb_impressions for
 * [today, yesterday, day-before] without 3 separate calls.
 *
 * Decoupled from store/credentials: takes adAccountId + accessToken
 * directly so the worker's existing credential resolver (cleanly
 * separated from fetcher concerns) handles the lookup. This mirrors
 * the structure of fetchMetaStatusForStore.
 */

import { META_API_VERSION } from '@/lib/fetchers/meta';

type Input = {
  adAccountId: string;
  accessToken: string;
  /** Dates in YYYY-MM-DD form. Order doesn't matter — we take min/max for the range. */
  dates: string[];
  /** Injected for tests. Defaults to global fetch. */
  fetcher?: typeof fetch;
};

export type MetaAccountSpendRow = {
  date: string;
  spend: number;
  currency: string;
  impressions: number;
};

type MetaInsightsRow = {
  date_start?: string;
  date_stop?: string;
  spend?: string;
  impressions?: string;
  account_currency?: string;
};

export async function fetchMetaAccountSpendForDates(
  input: Input,
): Promise<MetaAccountSpendRow[]> {
  const { adAccountId, accessToken, dates, fetcher = fetch } = input;
  if (dates.length === 0) return [];
  const sorted = [...dates].sort();
  const since = sorted[0];
  const until = sorted[sorted.length - 1];
  const timeRange = JSON.stringify({ since, until });
  const url =
    `https://graph.facebook.com/${META_API_VERSION}/act_${adAccountId}/insights` +
    `?fields=${encodeURIComponent('spend,impressions,account_currency')}` +
    `&time_range=${encodeURIComponent(timeRange)}` +
    `&time_increment=1` +
    `&level=account` +
    `&access_token=${encodeURIComponent(accessToken)}`;
  const res = await fetcher(url, {});
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(
      `Meta account spend bulk-fetch failed (${res.status}): ${body.slice(0, 400)}`,
    );
  }
  const body = (await res.json()) as { data?: MetaInsightsRow[] };
  return (body.data ?? []).map((row) => ({
    date: row.date_start ?? '',
    spend: parseFloat(row.spend ?? '0') || 0,
    currency: row.account_currency ?? 'ILS',
    impressions: parseInt(row.impressions ?? '0', 10) || 0,
  }));
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd /Users/dorperetz/script-roas/dashboard-web
npx vitest run src/lib/fetchers/__tests__/metaAccountSpend.test.ts
```

Expected: 4/4 PASS.

- [ ] **Step 5: Commit**

```bash
cd /Users/dorperetz/script-roas
git add dashboard-web/src/lib/fetchers/metaAccountSpend.ts \
        dashboard-web/src/lib/fetchers/__tests__/metaAccountSpend.test.ts
git commit -m "$(cat <<'EOF'
feat(phase-e1.6): metaAccountSpend bulk-date fetcher

Single Meta Graph API call returns per-date account-level spend +
impressions for a date range via time_range + time_increment=1.
Used by metaWorker's hot_metrics branch to fetch [today, yesterday,
day-before] in one call instead of 3 (what cron-live does today).

Decoupled from store/credentials — caller passes adAccountId +
accessToken directly. Tests cover happy path, empty-API-response,
HTTP-401 error, and unsorted input handling.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: `googleAccountSpendForDates` bulk fetcher

**Files:**
- Create: `dashboard-web/src/lib/fetchers/googleAccountSpend.ts`
- Create: `dashboard-web/src/lib/fetchers/__tests__/googleAccountSpend.test.ts`

Same shape as Task 3 but for Google Ads. Uses GAQL `SELECT metrics.cost_micros, metrics.impressions, segments.date FROM customer WHERE segments.date BETWEEN d1 AND d3`. Google's `cost_micros` is the raw micro-currency value in the account's currency (typically the account's set currency).

- [ ] **Step 1: Write the failing test**

Create `dashboard-web/src/lib/fetchers/__tests__/googleAccountSpend.test.ts`:

```typescript
import { describe, expect, it, vi } from 'vitest';
import { fetchGoogleAccountSpendForDates } from '@/lib/fetchers/googleAccountSpend';

describe('fetchGoogleAccountSpendForDates', () => {
  it('one GAQL query returns one row per date in BETWEEN range', async () => {
    const searchStream = vi.fn().mockResolvedValue([
      { customer: { currencyCode: 'CAD' }, metrics: { costMicros: '50000000', impressions: '1000' }, segments: { date: '2026-05-28' } },
      { customer: { currencyCode: 'CAD' }, metrics: { costMicros: '75000000', impressions: '1500' }, segments: { date: '2026-05-29' } },
      { customer: { currencyCode: 'CAD' }, metrics: { costMicros: '25000000', impressions: '500'  }, segments: { date: '2026-05-30' } },
    ]);
    const customer = { searchStream } as Parameters<typeof fetchGoogleAccountSpendForDates>[0]['customer'];
    const rows = await fetchGoogleAccountSpendForDates({
      customer,
      dates: ['2026-05-28', '2026-05-29', '2026-05-30'],
    });
    expect(searchStream).toHaveBeenCalledOnce();
    const query = searchStream.mock.calls[0][0].query as string;
    expect(query).toContain('FROM customer');
    expect(query).toContain('metrics.cost_micros');
    expect(query).toContain('metrics.impressions');
    expect(query).toContain("BETWEEN '2026-05-28' AND '2026-05-30'");
    // Output: cost_micros / 1_000_000 = CAD spend
    expect(rows).toHaveLength(3);
    expect(rows[0]).toMatchObject({ date: '2026-05-28', spend: 50, currency: 'CAD', impressions: 1000 });
    expect(rows[1]).toMatchObject({ date: '2026-05-29', spend: 75, currency: 'CAD', impressions: 1500 });
    expect(rows[2]).toMatchObject({ date: '2026-05-30', spend: 25, currency: 'CAD', impressions: 500 });
  });

  it('returns empty array when the GAQL response is empty', async () => {
    const searchStream = vi.fn().mockResolvedValue([]);
    const customer = { searchStream } as Parameters<typeof fetchGoogleAccountSpendForDates>[0]['customer'];
    const rows = await fetchGoogleAccountSpendForDates({
      customer,
      dates: ['2026-05-30'],
    });
    expect(rows).toEqual([]);
  });

  it('uses the MIN date as BETWEEN-lower and MAX date as BETWEEN-upper (handles unsorted input)', async () => {
    const searchStream = vi.fn().mockResolvedValue([]);
    const customer = { searchStream } as Parameters<typeof fetchGoogleAccountSpendForDates>[0]['customer'];
    await fetchGoogleAccountSpendForDates({
      customer,
      dates: ['2026-05-30', '2026-05-28', '2026-05-29'],
    });
    const query = searchStream.mock.calls[0][0].query as string;
    expect(query).toContain("BETWEEN '2026-05-28' AND '2026-05-30'");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd /Users/dorperetz/script-roas/dashboard-web
npx vitest run src/lib/fetchers/__tests__/googleAccountSpend.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Create the fetcher**

Create `dashboard-web/src/lib/fetchers/googleAccountSpend.ts`:

```typescript
/**
 * Phase E1.6 (2026-05-30) — bulk-date account-level Google Ads spend
 * fetcher. One GAQL query returns per-day cost_micros + impressions for
 * a date range. Used by googleWorker's hot_metrics branch.
 *
 * Returns CAD spend by converting cost_micros / 1_000_000 (the account
 * currency is whatever Google has configured — uzoshop's Google Ads
 * account is set to CAD per ARCHITECTURE.md §5.3, so no FX conversion
 * needed in the typical case. The currency field is still surfaced so
 * the caller's cadConvert helper can no-op pass-through for CAD or
 * convert for other currencies — same shape as Meta/TikTok fetchers).
 */

type Customer = {
  searchStream: (input: { query: string }) => Promise<Array<Record<string, unknown>>>;
};

type Input = {
  customer: Customer;
  /** Dates in YYYY-MM-DD form. Order doesn't matter — we take min/max. */
  dates: string[];
};

export type GoogleAccountSpendRow = {
  date: string;
  spend: number;
  currency: string;
  impressions: number;
};

export async function fetchGoogleAccountSpendForDates(
  input: Input,
): Promise<GoogleAccountSpendRow[]> {
  const { customer, dates } = input;
  if (dates.length === 0) return [];
  const sorted = [...dates].sort();
  const start = sorted[0];
  const end = sorted[sorted.length - 1];
  const query = `
    SELECT customer.currency_code, metrics.cost_micros, metrics.impressions, segments.date
      FROM customer
     WHERE segments.date BETWEEN '${start}' AND '${end}'
  `;
  const rows = await customer.searchStream({ query });
  return rows.map((r) => {
    // CRIT-C (Phase C): Google's JSON response uses camelCase keys
    // even though GAQL uses snake_case. customer.currencyCode (NOT
    // currency_code), metrics.costMicros, segments.date stays
    // segments.date (the segments object isn't transformed).
    const cust = (r as { customer?: Record<string, unknown> }).customer ?? {};
    const metrics = (r as { metrics?: Record<string, unknown> }).metrics ?? {};
    const segments = (r as { segments?: Record<string, unknown> }).segments ?? {};
    const costMicros = parseInt(String(metrics.costMicros ?? '0'), 10) || 0;
    const impressions = parseInt(String(metrics.impressions ?? '0'), 10) || 0;
    const currency = String(cust.currencyCode ?? 'CAD');
    return {
      date: String(segments.date ?? ''),
      spend: costMicros / 1_000_000,
      currency,
      impressions,
    };
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd /Users/dorperetz/script-roas/dashboard-web
npx vitest run src/lib/fetchers/__tests__/googleAccountSpend.test.ts
```

Expected: 3/3 PASS.

- [ ] **Step 5: Commit**

```bash
cd /Users/dorperetz/script-roas
git add dashboard-web/src/lib/fetchers/googleAccountSpend.ts \
        dashboard-web/src/lib/fetchers/__tests__/googleAccountSpend.test.ts
git commit -m "$(cat <<'EOF'
feat(phase-e1.6): googleAccountSpend bulk-date fetcher

One GAQL query (SELECT FROM customer WHERE segments.date BETWEEN
d1 AND d3) returns per-day cost + impressions for the account.
Used by googleWorker's hot_metrics branch. cost_micros divided by 1M
to surface CAD spend (uzoshop's Google account is CAD-native; the
helper still surfaces currencyCode for cadConvert symmetry).

3 unit tests cover happy path, empty response, unsorted dates.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: `tiktokAccountSpendForDates` bulk fetcher

**Files:**
- Create: `dashboard-web/src/lib/fetchers/tiktokAccountSpend.ts`
- Create: `dashboard-web/src/lib/fetchers/__tests__/tiktokAccountSpend.test.ts`

Same shape as Tasks 3-4 but for TikTok. Uses TikTok's `/report/integrated/get/` with `data_level=AUCTION_ADVERTISER` + `dimensions=["stat_time_day"]` + a date range. Returns one row per day for the advertiser.

- [ ] **Step 1: Write the failing test**

Create `dashboard-web/src/lib/fetchers/__tests__/tiktokAccountSpend.test.ts`:

```typescript
import { describe, expect, it, vi } from 'vitest';
import { fetchTikTokAccountSpendForDates } from '@/lib/fetchers/tiktokAccountSpend';

describe('fetchTikTokAccountSpendForDates', () => {
  it('one report call returns per-day spend + impressions for the advertiser', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        code: 0,
        message: 'OK',
        data: {
          list: [
            { dimensions: { stat_time_day: '2026-05-28 00:00:00' }, metrics: { spend: '50.00',  impressions: '500'  } },
            { dimensions: { stat_time_day: '2026-05-29 00:00:00' }, metrics: { spend: '75.50',  impressions: '750'  } },
            { dimensions: { stat_time_day: '2026-05-30 00:00:00' }, metrics: { spend: '125.25', impressions: '1250' } },
          ],
        },
      }),
      text: async () => '',
    });
    const rows = await fetchTikTokAccountSpendForDates({
      advertiserId: '1234567890',
      accessToken: 'TOK',
      accountCurrency: 'USD',
      dates: ['2026-05-28', '2026-05-29', '2026-05-30'],
      fetcher: fetchImpl as unknown as typeof fetch,
    });
    expect(fetchImpl).toHaveBeenCalledOnce();
    const url = fetchImpl.mock.calls[0][0] as string;
    expect(url).toContain('/report/integrated/get/');
    expect(url).toContain('data_level=AUCTION_ADVERTISER');
    expect(url).toContain('start_date=2026-05-28');
    expect(url).toContain('end_date=2026-05-30');
    expect(url).toContain(encodeURIComponent('"stat_time_day"'));
    expect(rows).toHaveLength(3);
    expect(rows[0]).toMatchObject({ date: '2026-05-28', spend: 50,    currency: 'USD', impressions: 500  });
    expect(rows[2]).toMatchObject({ date: '2026-05-30', spend: 125.25, currency: 'USD', impressions: 1250 });
  });

  it('TikTok-envelope error (code !== 0) throws with message + code', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        code: 40105,
        message: 'access token invalid',
        data: {},
      }),
      text: async () => '',
    });
    await expect(fetchTikTokAccountSpendForDates({
      advertiserId: '1234567890',
      accessToken: 'BAD',
      accountCurrency: 'USD',
      dates: ['2026-05-30'],
      fetcher: fetchImpl as unknown as typeof fetch,
    })).rejects.toThrow(/code=40105.*access token invalid/);
  });

  it('returns empty array when data.list is missing or empty', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ code: 0, message: 'OK', data: { list: [] } }),
      text: async () => '',
    });
    const rows = await fetchTikTokAccountSpendForDates({
      advertiserId: '1234567890',
      accessToken: 'TOK',
      accountCurrency: 'USD',
      dates: ['2026-05-30'],
      fetcher: fetchImpl as unknown as typeof fetch,
    });
    expect(rows).toEqual([]);
  });

  it('extracts YYYY-MM-DD from stat_time_day which TikTok returns with " 00:00:00" suffix', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        code: 0,
        message: 'OK',
        data: { list: [{ dimensions: { stat_time_day: '2026-05-30 00:00:00' }, metrics: { spend: '10', impressions: '1' } }] },
      }),
      text: async () => '',
    });
    const rows = await fetchTikTokAccountSpendForDates({
      advertiserId: '1234567890',
      accessToken: 'TOK',
      accountCurrency: 'USD',
      dates: ['2026-05-30'],
      fetcher: fetchImpl as unknown as typeof fetch,
    });
    expect(rows[0].date).toBe('2026-05-30'); // no " 00:00:00"
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd /Users/dorperetz/script-roas/dashboard-web
npx vitest run src/lib/fetchers/__tests__/tiktokAccountSpend.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Create the fetcher**

Create `dashboard-web/src/lib/fetchers/tiktokAccountSpend.ts`:

```typescript
/**
 * Phase E1.6 (2026-05-30) — bulk-date account-level TikTok spend
 * fetcher. One TikTok report API call returns per-day spend +
 * impressions for the advertiser. Used by tiktokWorker's hot_metrics
 * branch.
 *
 * data_level=AUCTION_ADVERTISER + dimensions=["stat_time_day"]
 * produces one row per day. start_date / end_date are an inclusive
 * range. accountCurrency is passed in by the worker (TikTok's API
 * doesn't surface it on this endpoint — it has to come from the
 * advertiser config).
 *
 * TikTok envelope: every response has {code, message, data}. code !== 0
 * is an error; throw with both code + message for operator debuggability.
 */

const TT_BASE = 'https://business-api.tiktok.com/open_api/v1.3';

type Input = {
  advertiserId: string;
  accessToken: string;
  accountCurrency: string;
  /** Dates in YYYY-MM-DD form. Order doesn't matter — we take min/max. */
  dates: string[];
  /** Injected for tests. Defaults to global fetch. */
  fetcher?: typeof fetch;
};

export type TikTokAccountSpendRow = {
  date: string;
  spend: number;
  currency: string;
  impressions: number;
};

type TikTokReportRow = {
  dimensions?: { stat_time_day?: string };
  metrics?: { spend?: string | number; impressions?: string | number };
};

export async function fetchTikTokAccountSpendForDates(
  input: Input,
): Promise<TikTokAccountSpendRow[]> {
  const { advertiserId, accessToken, accountCurrency, dates, fetcher = fetch } = input;
  if (dates.length === 0) return [];
  const sorted = [...dates].sort();
  const startDate = sorted[0];
  const endDate = sorted[sorted.length - 1];
  const dimensions = encodeURIComponent(JSON.stringify(['stat_time_day']));
  const metrics = encodeURIComponent(JSON.stringify(['spend', 'impressions']));
  const url =
    `${TT_BASE}/report/integrated/get/` +
    `?advertiser_id=${advertiserId}` +
    `&report_type=BASIC` +
    `&data_level=AUCTION_ADVERTISER` +
    `&dimensions=${dimensions}` +
    `&metrics=${metrics}` +
    `&start_date=${startDate}` +
    `&end_date=${endDate}` +
    `&page=1` +
    `&page_size=1000`;
  const res = await fetcher(url, { headers: { 'Access-Token': accessToken } });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(
      `TikTok account spend bulk-fetch HTTP ${res.status}: ${body.slice(0, 400)}`,
    );
  }
  const body = (await res.json()) as {
    code?: number;
    message?: string;
    data?: { list?: TikTokReportRow[] };
  };
  if (body.code !== 0) {
    throw new Error(
      `TikTok account spend bulk-fetch failed: code=${body.code} ${body.message ?? ''}`,
    );
  }
  const list = body.data?.list ?? [];
  return list.map((r) => ({
    // TikTok returns 'YYYY-MM-DD 00:00:00' — slice to 'YYYY-MM-DD'.
    date: (r.dimensions?.stat_time_day ?? '').slice(0, 10),
    spend: typeof r.metrics?.spend === 'number'
      ? r.metrics.spend
      : parseFloat(r.metrics?.spend ?? '0') || 0,
    currency: accountCurrency,
    impressions: typeof r.metrics?.impressions === 'number'
      ? r.metrics.impressions
      : parseInt(r.metrics?.impressions ?? '0', 10) || 0,
  }));
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd /Users/dorperetz/script-roas/dashboard-web
npx vitest run src/lib/fetchers/__tests__/tiktokAccountSpend.test.ts
```

Expected: 4/4 PASS.

- [ ] **Step 5: Commit**

```bash
cd /Users/dorperetz/script-roas
git add dashboard-web/src/lib/fetchers/tiktokAccountSpend.ts \
        dashboard-web/src/lib/fetchers/__tests__/tiktokAccountSpend.test.ts
git commit -m "$(cat <<'EOF'
feat(phase-e1.6): tiktokAccountSpend bulk-date fetcher

One TikTok /report/integrated/get/ call with data_level=
AUCTION_ADVERTISER + dimensions=[stat_time_day] returns per-day
spend + impressions for the advertiser across a date range.
Used by tiktokWorker's hot_metrics branch.

TikTok envelope error (code !== 0) throws with code + message.
accountCurrency injected by the caller (TikTok's API doesn't
surface it on this endpoint).

4 unit tests cover happy path, envelope-error, empty list, date
extraction from "YYYY-MM-DD 00:00:00".

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: metaWorker hot_metrics — account-aggregate step

**Files:**
- Modify: `dashboard-web/src/inngest/functions/metaWorker.ts`
- Modify: `dashboard-web/src/inngest/functions/__tests__/metaWorker.test.ts`

Add a new section inside `runMetaHotMetricsBranch` (after the existing hot-ids upsert + before `recHotPair('success')`) that:
1. Calls `fetchMetaAccountSpendForDates(adAccountId, accessToken, [today, today-1, today-2])`
2. For each returned row, runs `cadConvert` then `upsertDataDailySpend({platform: 'meta', ...})`
3. Soft-fails on fetch error — logs + continues, does NOT throw (the hot-ids upsert already succeeded; rethrow would mask success).

Also wire the production adapter (fetcher + cadConvert + upsertDataDailySpend) into the Inngest binding.

- [ ] **Step 1: Add the failing test**

Append to `dashboard-web/src/inngest/functions/__tests__/metaWorker.test.ts`:

```typescript
describe('Phase E1.6 — meta account-aggregate-spend step in hot_metrics branch', () => {
  it('after hot-ids upsert: fetches account-aggregate for 3 dates + writes each to data_daily via partial-column UPSERT', async () => {
    const fetchAccountSpend = vi.fn().mockResolvedValue([
      { date: '2026-05-27', spend: 100, currency: 'ILS', impressions: 5000 },
      { date: '2026-05-28', spend: 200, currency: 'ILS', impressions: 8000 },
      { date: '2026-05-29', spend:  50, currency: 'ILS', impressions: 2500 },
    ]);
    const cadConvert = vi.fn().mockImplementation(async (n: number) => n * 0.5);
    const upsertDataDailySpend = vi.fn().mockResolvedValue(undefined);
    await runMetaWorkerJob({
      jobData: { store_id: 'uzoshop', scope: 'hot_metrics', tick_id: 'T', staleness_seconds: 300, budget_pct_estimate: 12 },
      bucProbe: async () => ({ pct: 12, etaMinutes: 0 }),
      fetchStatus: vi.fn(),
      fetchHotMetrics: vi.fn().mockResolvedValue({ adsets: [], ads: [] }),
      getHotCampaignIds: async () => ['C1'],
      getHotAdsetIds: async () => ['AS1'],
      getHotAdIds: async () => [],
      loadPriorRegistry: async () => ({ campaigns: new Map(), adsets: new Map(), ads: new Map() }),
      upsertRegistry: vi.fn(),
      insertStatusEvents: vi.fn(),
      upsertCampaignsDaily: vi.fn(),
      upsertAdsDaily: vi.fn(),
      getCredentials: async () => ({ adAccountId: 'act_1', accessToken: 'tok', getFxCadFor: async () => async () => 0.5 } as never),
      recordFreshness: vi.fn(),
      upsertBuc: vi.fn(),
      fetchAccountSpend,
      cadConvert,
      upsertDataDailySpend,
      nowIso: '2026-05-29T16:00:00.000Z', // today=2026-05-29 → window [2026-05-29, 28, 27]
    });
    // Single bulk fetch for [today, yesterday, day-before] (computed from nowIso).
    expect(fetchAccountSpend).toHaveBeenCalledOnce();
    const fetchArgs = fetchAccountSpend.mock.calls[0][0];
    expect(fetchArgs.dates.sort()).toEqual(['2026-05-27', '2026-05-28', '2026-05-29']);
    // 3 writes — one per date — to data_daily, via upsertDataDailySpend
    expect(upsertDataDailySpend).toHaveBeenCalledTimes(3);
    const written = upsertDataDailySpend.mock.calls.map(c => c[0]);
    expect(written.find(w => w.date === '2026-05-27')).toMatchObject({
      platform: 'meta', storeId: 'uzoshop', spendCad: 50, impressions: 5000,
    });
    expect(written.find(w => w.date === '2026-05-29')).toMatchObject({
      platform: 'meta', storeId: 'uzoshop', spendCad: 25, impressions: 2500,
    });
  });

  it('fetch-account-spend rejection: soft-fail (log + continue), hot_metrics success still recorded', async () => {
    const fetchAccountSpend = vi.fn().mockRejectedValue(new Error('Meta 429'));
    const recordFreshness = vi.fn();
    await runMetaWorkerJob({
      jobData: { store_id: 'uzoshop', scope: 'hot_metrics', tick_id: 'T', staleness_seconds: 300, budget_pct_estimate: 12 },
      bucProbe: async () => ({ pct: 12, etaMinutes: 0 }),
      fetchStatus: vi.fn(),
      fetchHotMetrics: vi.fn().mockResolvedValue({ adsets: [], ads: [] }),
      getHotCampaignIds: async () => ['C1'],
      getHotAdsetIds: async () => [],
      getHotAdIds: async () => [],
      loadPriorRegistry: async () => ({ campaigns: new Map(), adsets: new Map(), ads: new Map() }),
      upsertRegistry: vi.fn(),
      insertStatusEvents: vi.fn(),
      upsertCampaignsDaily: vi.fn(),
      upsertAdsDaily: vi.fn(),
      getCredentials: async () => ({ adAccountId: 'act_1', accessToken: 'tok', getFxCadFor: async () => async () => 0.5 } as never),
      recordFreshness,
      upsertBuc: vi.fn(),
      fetchAccountSpend,
      cadConvert: vi.fn(),
      upsertDataDailySpend: vi.fn(),
      nowIso: '2026-05-29T16:00:00.000Z',
    });
    expect(fetchAccountSpend).toHaveBeenCalledOnce();
    // Soft-fail: still records success for the hot_metrics scopes.
    expect(recordFreshness).toHaveBeenCalledWith(expect.objectContaining({
      scope: 'campaign_metrics', status: 'success',
    }));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd /Users/dorperetz/script-roas/dashboard-web
npx vitest run src/inngest/functions/__tests__/metaWorker.test.ts -t "account-aggregate-spend"
```

Expected: FAIL — `fetchAccountSpend` is not a recognized input or `upsertDataDailySpend` not called.

- [ ] **Step 3: Extend `RunMetaWorkerJobInput` with the new dependencies**

In `metaWorker.ts`, append to `RunMetaWorkerJobInput`:

```typescript
  /**
   * Phase E1.6 (2026-05-30) — bulk-date account-level spend fetcher.
   * Optional for backwards-compat with existing test fixtures; prod
   * binding always supplies it.
   */
  fetchAccountSpend?: (input: {
    adAccountId: string;
    accessToken: string;
    dates: string[];
  }) => Promise<Array<{ date: string; spend: number; currency: string; impressions: number }>>;
  /** Phase E1.6 — CAD-converter with FX-fail-null semantics. */
  cadConvert?: (amount: number, currency: string, dateStr: string) => Promise<number | null>;
  /** Phase E1.6 — partial-column UPSERT to data_daily for one platform's spend + impressions. */
  upsertDataDailySpend?: (input: {
    storeId: string;
    date: string;
    platform: 'meta' | 'google' | 'tiktok';
    spendCad: number | null;
    impressions: number | null;
  }) => Promise<void>;
```

- [ ] **Step 4: Add the account-aggregate step inside `runMetaHotMetricsBranch`**

In `metaWorker.ts`, locate the existing success-recording at the end of `runMetaHotMetricsBranch` (after the hot-ids upsert, inside the try-block, just before `await recHotPair('success')`). Add the new step:

```typescript
    // Phase E1.6 (2026-05-30) — account-aggregate spend → data_daily.
    // Bulk-fetches Meta account-level spend + impressions for the
    // rolling 3-day window in one Graph API call, CAD-converts (FX
    // failure → null → preserves prior column), and writes to
    // data_daily via partial-column UPSERT. Workers own fb_spend_cad +
    // fb_impressions; cron-live owns Shopify revenue + derived (E1.6
    // race-mitigation: payload-key-only SET clause merges per-column).
    //
    // Soft-fail: a fetch error here does NOT throw — hot-ids upsert
    // already succeeded above, and re-throwing would mark the whole
    // hot_metrics branch as transient_error. Next tick (10 min) retries.
    if (input.fetchAccountSpend && input.cadConvert && input.upsertDataDailySpend) {
      try {
        const today = nowIso.slice(0, 10);
        const oneDayMs = 24 * 60 * 60 * 1000;
        const dates = [0, 1, 2].map((d) =>
          new Date(new Date(today + 'T00:00:00Z').getTime() - d * oneDayMs)
            .toISOString().slice(0, 10),
        );
        const rows = await input.fetchAccountSpend({
          adAccountId: creds.adAccountId,
          accessToken: creds.accessToken,
          dates,
        });
        for (const r of rows) {
          const spendCad = await input.cadConvert(r.spend, r.currency, r.date);
          await input.upsertDataDailySpend({
            storeId,
            date: r.date,
            platform: 'meta',
            spendCad,
            impressions: r.impressions,
          });
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.warn(`metaWorker account-aggregate-spend ${storeId}: ${message}`);
      }
    }
```

- [ ] **Step 5: Wire the production adapter in the Inngest binding**

At the top of `metaWorker.ts`, add imports:

```typescript
import { fetchMetaAccountSpendForDates } from '@/lib/fetchers/metaAccountSpend';
import { makeCadConvert } from '@/lib/inngest/cadConvert';
import { upsertDataDailySpend } from '@/lib/inngest/upsertDataDailySpend';
import { getFxRate } from '@/lib/fx/getFxRate';
```

(If `@/lib/fx/getFxRate` isn't the correct path, grep for `getFxRate` and use the existing import path.)

In the `inngest.createFunction` binding's dependency object, after `recordFreshness` and `upsertBuc`, add:

```typescript
        fetchAccountSpend: fetchMetaAccountSpendForDates,
        cadConvert: makeCadConvert(getFxRate),
        upsertDataDailySpend: async (inp) =>
          upsertDataDailySpend({ admin: sb, ...inp }),
```

- [ ] **Step 6: Run tests to verify they pass**

```bash
cd /Users/dorperetz/script-roas/dashboard-web
npx tsc --noEmit && npx vitest run src/inngest/functions/__tests__/metaWorker.test.ts
```

Expected: tsc clean + all metaWorker tests pass (existing + 2 new).

- [ ] **Step 7: Commit**

```bash
cd /Users/dorperetz/script-roas
git add dashboard-web/src/inngest/functions/metaWorker.ts \
        dashboard-web/src/inngest/functions/__tests__/metaWorker.test.ts
git commit -m "$(cat <<'EOF'
feat(phase-e1.6): metaWorker hot_metrics writes account-aggregate spend → data_daily

After the existing hot-ids upsert, runMetaHotMetricsBranch now also:
  • Bulk-fetches account-level spend + impressions for the rolling
    3-day window via fetchMetaAccountSpendForDates (one Graph call).
  • CAD-converts each row (FX failure → null preserve).
  • UPSERTs to data_daily via partial-column upsertDataDailySpend
    (only fb_spend_cad + fb_impressions; preserves cron-live's
    revenue + derived columns).

Soft-fail on account-spend error — hot-ids upsert already succeeded;
re-throw would mask success. Next tick retries.

This is the meta half of the E1.6 migration that lets cron-live
become truly Shopify-only (Task 9 strips fetch-light there).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: googleWorker hot_metrics — account-aggregate step

**Files:**
- Modify: `dashboard-web/src/inngest/functions/googleWorker.ts`
- Modify: `dashboard-web/src/inngest/functions/__tests__/googleWorker.test.ts`

Same pattern as Task 6 for Google.

- [ ] **Step 1: Add the failing test**

Append to `dashboard-web/src/inngest/functions/__tests__/googleWorker.test.ts`:

```typescript
describe('Phase E1.6 — google account-aggregate-spend step in hot_metrics branch', () => {
  it('after hot-ids upsert: fetches account-aggregate for 3 dates + writes each to data_daily', async () => {
    const fetchAccountSpend = vi.fn().mockResolvedValue([
      { date: '2026-05-27', spend: 100, currency: 'CAD', impressions: 1000 },
      { date: '2026-05-28', spend: 200, currency: 'CAD', impressions: 2000 },
      { date: '2026-05-29', spend:  50, currency: 'CAD', impressions:  500 },
    ]);
    const cadConvert = vi.fn().mockImplementation(async (n: number) => n); // CAD passthrough
    const upsertDataDailySpend = vi.fn().mockResolvedValue(undefined);
    await runGoogleWorkerJob({
      jobData: { store_id: 'uzoshop', scope: 'hot_metrics', tick_id: 'T', staleness_seconds: 300, budget_pct_estimate: 0 },
      fetchStatus: vi.fn(),
      fetchHotMetrics: vi.fn().mockResolvedValue({ adsets: [], ads: [] }),
      getHotCampaignIds: async () => ['GC1'],
      getHotAdgroupIds: async () => ['AG1'],
      getHotAdIds: async () => [],
      loadPriorRegistry: async () => ({ campaigns: new Map(), adsets: new Map(), ads: new Map() }),
      upsertRegistry: vi.fn(),
      insertStatusEvents: vi.fn(),
      upsertCampaignsDaily: vi.fn(),
      upsertAdsDaily: vi.fn(),
      getCustomer: async () => ({ searchStream: async () => [] }),
      recordFreshness: vi.fn(),
      fetchAccountSpend,
      cadConvert,
      upsertDataDailySpend,
      nowIso: '2026-05-29T16:00:00.000Z',
      isGoogleConfigured: () => true,
    });
    expect(fetchAccountSpend).toHaveBeenCalledOnce();
    expect(upsertDataDailySpend).toHaveBeenCalledTimes(3);
    const written = upsertDataDailySpend.mock.calls.map(c => c[0]);
    expect(written.find(w => w.date === '2026-05-27')).toMatchObject({
      platform: 'google', storeId: 'uzoshop', spendCad: 100, impressions: 1000,
    });
  });

  it('soft-fails on account-spend rejection — records success freshness anyway', async () => {
    const fetchAccountSpend = vi.fn().mockRejectedValue(new Error('Google RESOURCE_EXHAUSTED'));
    const recordFreshness = vi.fn();
    await runGoogleWorkerJob({
      jobData: { store_id: 'uzoshop', scope: 'hot_metrics', tick_id: 'T', staleness_seconds: 300, budget_pct_estimate: 0 },
      fetchStatus: vi.fn(),
      fetchHotMetrics: vi.fn().mockResolvedValue({ adsets: [], ads: [] }),
      getHotCampaignIds: async () => ['GC1'], getHotAdgroupIds: async () => [], getHotAdIds: async () => [],
      loadPriorRegistry: async () => ({ campaigns: new Map(), adsets: new Map(), ads: new Map() }),
      upsertRegistry: vi.fn(), insertStatusEvents: vi.fn(),
      upsertCampaignsDaily: vi.fn(), upsertAdsDaily: vi.fn(),
      getCustomer: async () => ({ searchStream: async () => [] }),
      recordFreshness,
      fetchAccountSpend,
      cadConvert: vi.fn(),
      upsertDataDailySpend: vi.fn(),
      nowIso: '2026-05-29T16:00:00.000Z',
      isGoogleConfigured: () => true,
    });
    expect(fetchAccountSpend).toHaveBeenCalledOnce();
    expect(recordFreshness).toHaveBeenCalledWith(expect.objectContaining({
      scope: 'campaign_metrics', status: 'success',
    }));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd /Users/dorperetz/script-roas/dashboard-web
npx vitest run src/inngest/functions/__tests__/googleWorker.test.ts -t "Phase E1.6"
```

Expected: FAIL.

- [ ] **Step 3: Extend `RunGoogleWorkerJobInput` with the same 3 fields as Task 6**

In `googleWorker.ts`, append to `RunGoogleWorkerJobInput`:

```typescript
  /** Phase E1.6 (2026-05-30) — bulk-date Google account-level spend. */
  fetchAccountSpend?: (input: {
    customer: { searchStream: (q: { query: string }) => Promise<Array<Record<string, unknown>>> };
    dates: string[];
  }) => Promise<Array<{ date: string; spend: number; currency: string; impressions: number }>>;
  cadConvert?: (amount: number, currency: string, dateStr: string) => Promise<number | null>;
  upsertDataDailySpend?: (input: {
    storeId: string;
    date: string;
    platform: 'meta' | 'google' | 'tiktok';
    spendCad: number | null;
    impressions: number | null;
  }) => Promise<void>;
```

- [ ] **Step 4: Add the account-aggregate step inside `runGoogleHotMetricsBranch`**

In `googleWorker.ts`, locate the end of `runGoogleHotMetricsBranch`'s try-block (just before `await recHotPair('success')`). Add:

```typescript
    // Phase E1.6 (2026-05-30) — Google account-aggregate spend → data_daily.
    // Same shape as metaWorker's E1.6 step (see metaWorker.ts).
    if (input.fetchAccountSpend && input.cadConvert && input.upsertDataDailySpend) {
      try {
        const today = nowIso.slice(0, 10);
        const oneDayMs = 24 * 60 * 60 * 1000;
        const dates = [0, 1, 2].map((d) =>
          new Date(new Date(today + 'T00:00:00Z').getTime() - d * oneDayMs)
            .toISOString().slice(0, 10),
        );
        const rows = await input.fetchAccountSpend({
          customer,
          dates,
        });
        for (const r of rows) {
          const spendCad = await input.cadConvert(r.spend, r.currency, r.date);
          await input.upsertDataDailySpend({
            storeId,
            date: r.date,
            platform: 'google',
            spendCad,
            impressions: r.impressions,
          });
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.warn(`googleWorker account-aggregate-spend ${storeId}: ${message}`);
      }
    }
```

Note: `customer` is already in scope at this point — it's resolved earlier in `runGoogleHotMetricsBranch` via `safeCustomer`.

- [ ] **Step 5: Wire the production adapter in the Inngest binding**

At the top of `googleWorker.ts`, add imports:

```typescript
import { fetchGoogleAccountSpendForDates } from '@/lib/fetchers/googleAccountSpend';
import { makeCadConvert } from '@/lib/inngest/cadConvert';
import { upsertDataDailySpend } from '@/lib/inngest/upsertDataDailySpend';
import { getFxRate } from '@/lib/fx/getFxRate';
```

In the binding's dependency object, after `notifyTokenFailure`, add:

```typescript
        fetchAccountSpend: fetchGoogleAccountSpendForDates,
        cadConvert: makeCadConvert(getFxRate),
        upsertDataDailySpend: async (inp) =>
          upsertDataDailySpend({ admin: sb, ...inp }),
```

- [ ] **Step 6: Run tests + tsc**

```bash
cd /Users/dorperetz/script-roas/dashboard-web
npx tsc --noEmit && npx vitest run src/inngest/functions/__tests__/googleWorker.test.ts
```

Expected: all PASS.

- [ ] **Step 7: Commit**

```bash
cd /Users/dorperetz/script-roas
git add dashboard-web/src/inngest/functions/googleWorker.ts \
        dashboard-web/src/inngest/functions/__tests__/googleWorker.test.ts
git commit -m "$(cat <<'EOF'
feat(phase-e1.6): googleWorker hot_metrics writes account-aggregate spend → data_daily

Same migration as metaWorker Task 6. Bulk GAQL query returns per-day
cost_micros + impressions for the 3-day window; CAD-converted and
written to data_daily via partial-column UPSERT.

Soft-fail on fetch error — hot-ids upsert already succeeded.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 8: tiktokWorker hot_metrics — account-aggregate step

**Files:**
- Modify: `dashboard-web/src/inngest/functions/tiktokWorker.ts`
- Modify: `dashboard-web/src/inngest/functions/__tests__/tiktokWorker.test.ts`

Same pattern as Tasks 6-7 for TikTok.

- [ ] **Step 1: Add the failing test**

Append to `dashboard-web/src/inngest/functions/__tests__/tiktokWorker.test.ts`:

```typescript
describe('Phase E1.6 — tiktok account-aggregate-spend step in hot_metrics branch', () => {
  it('after hot-ids upsert: fetches account-aggregate + writes each to data_daily', async () => {
    const fetchAccountSpend = vi.fn().mockResolvedValue([
      { date: '2026-05-27', spend:  50, currency: 'USD', impressions:  500 },
      { date: '2026-05-28', spend: 100, currency: 'USD', impressions: 1000 },
      { date: '2026-05-29', spend:  25, currency: 'USD', impressions:  250 },
    ]);
    const cadConvert = vi.fn().mockImplementation(async (n: number) => n * 1.4); // USD → CAD
    const upsertDataDailySpend = vi.fn().mockResolvedValue(undefined);
    await runTikTokWorkerJob({
      jobData: { store_id: 'uzoshop', scope: 'hot_metrics', tick_id: 'T', staleness_seconds: 300, budget_pct_estimate: 0 },
      loadStoreMap: async () => ({}),
      fetchStatus: vi.fn(),
      fetchHotMetrics: vi.fn().mockResolvedValue({ adsets: [], ads: [] }),
      getHotCampaignIds: async () => ['TC1'], getHotAdgroupIds: async () => ['TG1'], getHotAdIds: async () => [],
      loadPriorRegistry: async () => ({ campaigns: new Map(), adsets: new Map(), ads: new Map() }),
      upsertRegistry: vi.fn(), insertStatusEvents: vi.fn(),
      upsertCampaignsDaily: vi.fn(), upsertAdsDaily: vi.fn(),
      recordFreshness: vi.fn(),
      getAccount: async () => ({ advertiserId: 'ADV1', accessToken: 'TOK', accountCurrency: 'USD' }),
      getFxCadFor: async () => async () => 1.4,
      fetchAccountSpend,
      cadConvert,
      upsertDataDailySpend,
      nowIso: '2026-05-29T16:00:00.000Z',
      isTikTokConfigured: () => true,
    });
    expect(fetchAccountSpend).toHaveBeenCalledOnce();
    expect(upsertDataDailySpend).toHaveBeenCalledTimes(3);
    const written = upsertDataDailySpend.mock.calls.map(c => c[0]);
    expect(written.find(w => w.date === '2026-05-27')).toMatchObject({
      platform: 'tiktok', storeId: 'uzoshop', spendCad: 70, impressions: 500,
    });
    expect(written.find(w => w.date === '2026-05-28')).toMatchObject({
      platform: 'tiktok', storeId: 'uzoshop', spendCad: 140, impressions: 1000,
    });
  });

  it('soft-fails on account-spend rejection — hot_metrics success still recorded', async () => {
    const fetchAccountSpend = vi.fn().mockRejectedValue(new Error('TikTok code=40001 rate limit'));
    const recordFreshness = vi.fn();
    await runTikTokWorkerJob({
      jobData: { store_id: 'uzoshop', scope: 'hot_metrics', tick_id: 'T', staleness_seconds: 300, budget_pct_estimate: 0 },
      loadStoreMap: async () => ({}),
      fetchStatus: vi.fn(),
      fetchHotMetrics: vi.fn().mockResolvedValue({ adsets: [], ads: [] }),
      getHotCampaignIds: async () => ['TC1'], getHotAdgroupIds: async () => ['TG1'], getHotAdIds: async () => [],
      loadPriorRegistry: async () => ({ campaigns: new Map(), adsets: new Map(), ads: new Map() }),
      upsertRegistry: vi.fn(), insertStatusEvents: vi.fn(),
      upsertCampaignsDaily: vi.fn(), upsertAdsDaily: vi.fn(),
      recordFreshness,
      getAccount: async () => ({ advertiserId: 'ADV1', accessToken: 'TOK', accountCurrency: 'USD' }),
      getFxCadFor: async () => async () => 1.4,
      fetchAccountSpend,
      cadConvert: vi.fn(),
      upsertDataDailySpend: vi.fn(),
      nowIso: '2026-05-29T16:00:00.000Z',
      isTikTokConfigured: () => true,
    });
    expect(fetchAccountSpend).toHaveBeenCalledOnce();
    expect(recordFreshness).toHaveBeenCalledWith(expect.objectContaining({
      scope: 'campaign_metrics', status: 'success',
    }));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd /Users/dorperetz/script-roas/dashboard-web
npx vitest run src/inngest/functions/__tests__/tiktokWorker.test.ts -t "Phase E1.6"
```

Expected: FAIL.

- [ ] **Step 3: Extend `RunTikTokWorkerJobInput`**

In `tiktokWorker.ts`, append to `RunTikTokWorkerJobInput`:

```typescript
  /** Phase E1.6 (2026-05-30) — bulk-date TikTok account-level spend. */
  fetchAccountSpend?: (input: {
    advertiserId: string;
    accessToken: string;
    accountCurrency: string;
    dates: string[];
  }) => Promise<Array<{ date: string; spend: number; currency: string; impressions: number }>>;
  cadConvert?: (amount: number, currency: string, dateStr: string) => Promise<number | null>;
  upsertDataDailySpend?: (input: {
    storeId: string;
    date: string;
    platform: 'meta' | 'google' | 'tiktok';
    spendCad: number | null;
    impressions: number | null;
  }) => Promise<void>;
```

- [ ] **Step 4: Add the account-aggregate step inside `runTikTokHotMetricsBranch`**

Add inside the try-block, before `await recHotPair('success')`:

```typescript
    // Phase E1.6 (2026-05-30) — TikTok account-aggregate spend → data_daily.
    if (input.fetchAccountSpend && input.cadConvert && input.upsertDataDailySpend) {
      try {
        const today = nowIso.slice(0, 10);
        const oneDayMs = 24 * 60 * 60 * 1000;
        const dates = [0, 1, 2].map((d) =>
          new Date(new Date(today + 'T00:00:00Z').getTime() - d * oneDayMs)
            .toISOString().slice(0, 10),
        );
        const rows = await input.fetchAccountSpend({
          advertiserId: account.advertiserId,
          accessToken: account.accessToken,
          accountCurrency: account.accountCurrency,
          dates,
        });
        for (const r of rows) {
          const spendCad = await input.cadConvert(r.spend, r.currency, r.date);
          await input.upsertDataDailySpend({
            storeId,
            date: r.date,
            platform: 'tiktok',
            spendCad,
            impressions: r.impressions,
          });
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.warn(`tiktokWorker account-aggregate-spend ${storeId}: ${message}`);
      }
    }
```

Note: `account` is already in scope (resolved earlier via `safeAccount`).

- [ ] **Step 5: Wire the production adapter in the Inngest binding**

At the top of `tiktokWorker.ts`, add imports:

```typescript
import { fetchTikTokAccountSpendForDates } from '@/lib/fetchers/tiktokAccountSpend';
import { makeCadConvert } from '@/lib/inngest/cadConvert';
import { upsertDataDailySpend } from '@/lib/inngest/upsertDataDailySpend';
import { getFxRate } from '@/lib/fx/getFxRate';
```

In the binding's dependency object, after `notifyTokenFailure`, add:

```typescript
        fetchAccountSpend: fetchTikTokAccountSpendForDates,
        cadConvert: makeCadConvert(getFxRate),
        upsertDataDailySpend: async (inp) =>
          upsertDataDailySpend({ admin: sb, ...inp }),
```

- [ ] **Step 6: Run tests + tsc**

```bash
cd /Users/dorperetz/script-roas/dashboard-web
npx tsc --noEmit && npx vitest run src/inngest/functions/__tests__/tiktokWorker.test.ts
```

Expected: all PASS.

- [ ] **Step 7: Commit**

```bash
cd /Users/dorperetz/script-roas
git add dashboard-web/src/inngest/functions/tiktokWorker.ts \
        dashboard-web/src/inngest/functions/__tests__/tiktokWorker.test.ts
git commit -m "$(cat <<'EOF'
feat(phase-e1.6): tiktokWorker hot_metrics writes account-aggregate spend → data_daily

Same migration as metaWorker Task 6 + googleWorker Task 7. Bulk
TikTok report API call returns per-day spend + impressions for the
3-day window; CAD-converted and written to data_daily via partial-
column UPSERT.

Soft-fail on fetch error.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 9: Strip cron-live to Shopify-only

**Files:**
- Modify: `dashboard-web/src/inngest/functions/cronLive.ts` (REMOVE platform steps)
- Modify: `dashboard-web/src/inngest/functions/__tests__/` — drop any cron-live test that exercises the removed steps

Now that the 3 workers own data_daily spend writes, cron-live can drop the platform-spend fetch + the 3 select-prior-spend SELECTs. The persist step keeps its current shape — it already reads data_daily spend inline (lines 463-499) to compute derived columns; that path now reads what workers wrote.

- [ ] **Step 1: Verify the steps to remove**

```bash
cd /Users/dorperetz/script-roas/dashboard-web
grep -nE "step\.run\('fetch-meta-google-tiktok-spend-light-3day'|step\.run\('select-prior-spend-" src/inngest/functions/cronLive.ts | head -10
```

Expected output (line numbers may shift):
```
~866: step.run('fetch-meta-google-tiktok-spend-light-3day', ...
~1108: step.run('select-prior-spend-' + d, ...
```

- [ ] **Step 2: Find brace-balanced boundaries of fetch-meta-google-tiktok-spend-light-3day**

```bash
cd /Users/dorperetz/script-roas/dashboard-web
python3 - <<'PY'
with open('src/inngest/functions/cronLive.ts') as f:
    lines = f.readlines()
start = None
for i, l in enumerate(lines, 1):
    if "step.run('fetch-meta-google-tiktok-spend-light-3day'" in l:
        start = i; break
depth_b = 0; depth_p = 0
for i in range(start - 1, len(lines)):
    for ch in lines[i]:
        if ch == '{': depth_b += 1
        elif ch == '}': depth_b -= 1
        elif ch == '(': depth_p += 1
        elif ch == ')': depth_p -= 1
    if i + 1 > start and depth_b == 0 and depth_p == 0:
        print(f"FETCH_LIGHT_START: {start}")
        print(f"FETCH_LIGHT_END:   {i + 1}")
        break
PY
```

Also find each `select-prior-spend-` step's end:

```bash
cd /Users/dorperetz/script-roas/dashboard-web
grep -nE "step\.run\('select-prior-spend-" src/inngest/functions/cronLive.ts
```

Note the line numbers — each `select-prior-spend-{date}` step.run is a single statement spanning ~20 lines. Use the same brace-balance python script for each.

- [ ] **Step 3: Delete the `fetch-meta-google-tiktok-spend-light-3day` step block**

Replace lines FETCH_LIGHT_START..FETCH_LIGHT_END with a single header comment:

```
// ----- STEP "fetch-meta-google-tiktok-spend-light-3day" REMOVED in Phase E1.6 (2026-05-30) -----
// Moved to the 3 hot_metrics worker branches (metaWorker/googleWorker/
// tiktokWorker) via the cron-tick-orchestrator (every 10 min). Workers
// now write data_daily.fb/ga/tt_spend_cad + impressions directly via
// the new shared upsertDataDailySpend helper (partial-column UPSERT).
// See docs/superpowers/specs/2026-05-30-phase-e1-6-account-spend-to-workers-design.md
```

Use a sed range delete:

```bash
cd /Users/dorperetz/script-roas/dashboard-web
sed -i.bak "${FETCH_LIGHT_START},${FETCH_LIGHT_END}d" src/inngest/functions/cronLive.ts
rm src/inngest/functions/cronLive.ts.bak
```

Then insert the header comment at FETCH_LIGHT_START using `sed -i.bak "${FETCH_LIGHT_START}i\\
// ----- STEP ... REMOVED ...
" ...` or via the Edit tool with the surrounding lines for anchoring.

- [ ] **Step 4: Delete the 3 `select-prior-spend-{date}` step.run blocks**

Same brace-balance approach for each. Replace all 3 with a single header comment:

```
// ----- 3 × STEP "select-prior-spend-{date}" REMOVED in Phase E1.6 (2026-05-30) -----
// These SELECTs pre-loaded the prior data_daily row so the persist step
// could apply per-platform preserve when fetch-light returned null. Now
// that fetch-light is gone (workers write directly), the prior-spend
// preserve logic is no longer relevant; persist-rolling-3day reads the
// CURRENT data_daily row (whatever workers most-recently wrote) at its
// own existing SELECT (cronLive.ts ~lines 463-499).
```

- [ ] **Step 5: Adjust `persist-rolling-3day` to no longer reference `spendByDate`**

The persist step previously consumed `spendByDate` (the output of fetch-meta-google-tiktok-spend-light-3day). It needs to pull current data_daily spend at its existing SELECT call site instead.

Search for `spendByDate` in cronLive.ts and remove or replace each reference. The persist step's existing SELECT at lines ~463-499 already pulls `fb_spend_cad, ga_spend_cad, tt_spend_cad, fb_impressions, ga_impressions, tt_impressions` from data_daily — those values are what workers wrote. The persist step uses them to compute `roas`, `gross_profit_cad`, `cogs_cad`, `net_profit_cad` from Shopify revenue + spend. The computation chain stays the same; only the SOURCE of spend changes from "fetch-light result" → "current data_daily row".

Concrete edit pattern (grep first):

```bash
cd /Users/dorperetz/script-roas/dashboard-web
grep -n "spendByDate" src/inngest/functions/cronLive.ts | head -20
```

For each line, replace `spendByDate[date].fbSpendCad` with `priorSpend?.fb_spend_cad ?? 0` (or similar, depending on the existing variable name in persist's SELECT closure). Tests in Step 7 verify the persist still computes correct derived columns.

- [ ] **Step 6: Remove unused imports**

```bash
cd /Users/dorperetz/script-roas/dashboard-web
npx tsc --noEmit --noUnusedLocals 2>&1 | grep "cronLive.ts" | head -10
```

Expected unused-locals errors:
- `fetchMetaSpendForDayLight`
- `fetchGoogleAdsSpendForDay`
- `fetchTikTokSpendForDay`

Remove those 3 import lines from `cronLive.ts`.

- [ ] **Step 7: Run cron-live tests + full vitest**

```bash
cd /Users/dorperetz/script-roas/dashboard-web
npx vitest run src/inngest/functions/__tests__/cronLive*.test.ts
echo "---"
npx vitest run
```

Expected: any test that asserted `fetch-meta-google-tiktok-spend-light-3day` was called OR exercised the removed select-prior-spend steps will fail. Either:
- Drop the test entirely (if it was solely on the removed step), OR
- Update it (if it was on the persist chain with valid concerns)

Drop tests for the removed steps. Persist tests should still pass — the SELECT path is unchanged.

- [ ] **Step 8: tsc + final vitest green**

```bash
cd /Users/dorperetz/script-roas/dashboard-web
npx tsc --noEmit && npx vitest run
```

Expected: tsc clean + full suite green.

- [ ] **Step 9: Commit**

```bash
cd /Users/dorperetz/script-roas
git add dashboard-web/src/inngest/functions/cronLive.ts \
        dashboard-web/src/inngest/functions/__tests__/cronLive*.test.ts
git commit -m "$(cat <<'EOF'
feat(phase-e1.6): strip cron-live to true Shopify-only

Removes:
  • fetch-meta-google-tiktok-spend-light-3day step (workers now write
    account-aggregate spend → data_daily via Tasks 6-8).
  • 3 × select-prior-spend-{date} steps (the prior-spend preserve
    logic became obsolete once fetch-light went away; persist's own
    SELECT reads the current data_daily row that workers wrote).
  • Unused imports: fetchMetaSpendForDayLight,
    fetchGoogleAdsSpendForDay, fetchTikTokSpendForDay.

cron-live now owns only:
  • fetch-shopify-rolling-3day
  • fetch-shopify-orders-attribution-today
  • persist-rolling-3day (revenue + derived columns; reads
    worker-written spend inline for derived computation)

Cleanup also adjusts persist-rolling-3day to drop any reference to the
removed spendByDate closure variable; reads current data_daily spend
at its existing SELECT call site instead.

Dropped tests: any that asserted the removed step.runs explicitly.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 10: Pre-deploy verify + push + docs + memory

**Files:**
- Modify: `docs/ARCHITECTURE.md` (add §Phase E1.6 + update §Phase E1.5 with the correction)
- Modify: `docs/ROAS-Dashboard-User-Manual.md` (bump 2.3.0 → 2.3.1 + note)
- Create: `~/.claude/projects/-Users-dorperetz-script-roas/memory/project_phase_e1_6_shipped.md`
- Modify: `~/.claude/projects/-Users-dorperetz-script-roas/memory/MEMORY.md`

- [ ] **Step 1: Run pre-deploy gates**

```bash
cd /Users/dorperetz/script-roas/dashboard-web
npx tsc --noEmit && npx vitest run
echo "---"
SUPABASE_URL=$(grep "^supabase.url" /Users/dorperetz/script-roas/.env | sed 's/^[^=]*= *//' | tr -d ' ') \
SUPABASE_SERVICE_ROLE_KEY=$(grep "^supabase.service.role.key" /Users/dorperetz/script-roas/.env | sed 's/^[^=]*= *//' | tr -d ' ') \
AUDIT_LIVE=1 npm run audit:reconcile:hot-vs-heavy
```

Expected: tsc clean, vitest green (estimate ~1567 = 1548 + 24 new − 5 dropped), reconcile harness 4/4 green.

- [ ] **Step 2: Update ARCHITECTURE.md**

Append after §Phase E1.5 — cron-live → Shopify-only section. Use a header `## Phase E1.6 — Account-level spend completes the cron-live → workers move (2026-05-30)` and document:

```markdown
## Phase E1.6 — Account-level spend completes the cron-live → workers move (2026-05-30)

E1.5 claimed "cron-live → Shopify-only" but missed
`fetch-meta-google-tiktok-spend-light-3day` — the account-level
spend + impressions fetcher that populated
`data_daily.fb/ga/tt_spend_cad` + `_impressions`. Operator observation
2026-05-30 ~17:50 IL via the Inngest dashboard caught this. E1.6
finishes the move.

### Architecture
The 3 hot_metrics worker branches each get one new step running just
before `recHotPair('success')`:

  fetchAccountSpend(adAccount/customer/advertiser, [today, T-1, T-2])
    → one bulk API call (Meta `time_increment=1`, Google GAQL `BETWEEN`,
      TikTok report API with `start_date`/`end_date` + stat_time_day)
    → CAD-convert via shared cadConvert helper (FX failure → null,
      preserves prior column)
    → upsertDataDailySpend(platform, spendCad, impressions) — partial-
      column UPSERT to data_daily (only fb/ga/tt_spend_cad + impressions)

cron-live now owns only fetch-shopify-rolling-3day +
fetch-shopify-orders-attribution-today + persist-rolling-3day (revenue
+ derived). 5 step.runs removed.

### Race mitigation (workers vs cron-live on data_daily)
Supabase JS `.upsert({...payload}, {onConflict: 'date,store_id'})`
builds the SET clause from payload keys only. Workers' payload contains
only fb/ga/tt_spend_cad + _impressions; cron-live's payload contains
only revenue + derived. Disjoint columns → merge per-column → no
overwrites. Same semantic cron-live + cron-daily relied on for years.

### API call budget delta
Before: 27 platform calls / 10 min (3 stores × 3 platforms × 3 dates).
After: 9 platform calls / 10 min (3 stores × 3 platforms × 1 bulk call).
Net: −50% platform API load.

### Function inventory after E1.6 (delta to E1.5 table)
| Family | Cadence | Steps per tick |
|---|---|---|
| cron-live-{store} | every 10 min | 3 step.runs (was 8): shopify-rolling, shopify-orders, persist |
| metaWorker / googleWorker / tiktokWorker | event | adds 1 account-aggregate step per hot_metrics tick |

(All other families unchanged.)

### Tests added
- cadConvert.test.ts (8)
- upsertDataDailySpend.test.ts (7)
- metaAccountSpend.test.ts (4)
- googleAccountSpend.test.ts (3)
- tiktokAccountSpend.test.ts (4)
- metaWorker/googleWorker/tiktokWorker hot_metrics account-aggregate tests (2 each = 6)
= 32 new tests; ~5 cron-live tests dropped (removed steps). Estimate
~1575 total.

### Rollback
`git revert` the E1.6 commits. cron-live's fetch-light + select-prior-
spend are restored, workers stop the account-aggregate step. data_daily
is self-healing on the next tick from either path.
```

Also fix the §Phase E1.5 paragraph that claimed "cron-live → Shopify-only" — add a one-line correction at the top:

> **Correction note added 2026-05-30 evening:** E1.5 left
> `fetch-meta-google-tiktok-spend-light-3day` in place because no
> alternative path existed for `data_daily.fb/ga/tt_spend_cad`. Phase
> E1.6 (below) finishes the migration by moving the account-level
> fetch into the 3 hot_metrics workers, at which point cron-live
> truly becomes Shopify-only.

- [ ] **Step 3: Update User Manual**

In `docs/ROAS-Dashboard-User-Manual.md`, bump version 2.3.0 → 2.3.1 and append a one-paragraph note in the "מה התחדש 2026-05-30" section:

```markdown
- **תיקון אדריכלי (2.3.1, ערב 2026-05-30)** — השלמת המעבר של פעולות פלטפורמה מ-cron-live אל ה-workers. ה-spend של פייסבוק/גוגל/טיקטוק נכתב ל-data_daily ע"י 3 ה-hot_metrics workers (אותה תדירות של 10 דק', אותם נתונים — רק שינוי פנימי). cron-live עכשיו רץ באמת רק על Shopify. מספרים בדשבורד זהים; אם משהו נראה אחרת, ראו ARCHITECTURE §Phase E1.6.
```

- [ ] **Step 4: Push**

```bash
cd /Users/dorperetz/script-roas
git add docs/ARCHITECTURE.md docs/ROAS-Dashboard-User-Manual.md
git commit -m "$(cat <<'EOF'
docs(phase-e1.6): ARCHITECTURE §Phase E1.6 + User Manual 2.3.1

E1.5 correction note added. New §Phase E1.6 documents the account-
level spend migration: shared cadConvert + upsertDataDailySpend +
3 bulk-date fetchers + 3 worker steps + cron-live strip. Race-
mitigation explained; −50% platform API budget noted.

User Manual bump to 2.3.1 with one-paragraph operator-visible note:
internal architectural completion, no data change.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
git push origin main
```

Expected: pre-push gates pass (tsc + vitest + docs-currency). Push succeeds.

- [ ] **Step 5: Post-deploy verify (≥10 min after Vercel build)**

```bash
cd /Users/dorperetz/script-roas
SUPABASE_URL=$(grep "^supabase.url" .env | sed 's/^[^=]*= *//' | tr -d ' ')
SUPABASE_KEY=$(grep "^supabase.service.role.key" .env | sed 's/^[^=]*= *//' | tr -d ' ')

# Confirm data_daily spend columns advance every ≤10 min
curl -sS "${SUPABASE_URL}/rest/v1/data_daily?date=eq.$(date '+%Y-%m-%d')&select=store_id,fb_spend_cad,ga_spend_cad,tt_spend_cad,updated_at" \
  -H "apikey: ${SUPABASE_KEY}" -H "Authorization: Bearer ${SUPABASE_KEY}" \
  | jq -r '.[] | "\(.store_id) fb=\(.fb_spend_cad) ga=\(.ga_spend_cad) tt=\(.tt_spend_cad) updated=\(.updated_at)"'
```

Expected: each store's `updated_at` is recent (≤10 min from now) AND fb_spend_cad / ga_spend_cad / tt_spend_cad are numeric (not stale-zero).

- [ ] **Step 6: Update memory**

Create `~/.claude/projects/-Users-dorperetz-script-roas/memory/project_phase_e1_6_shipped.md`:

```markdown
---
name: phase-e1-6-shipped
description: Phase E1.6 SHIPPED 2026-05-30 ~XX:XX IL. Moved account-level platform spend fetch from cron-live to the 3 hot_metrics worker branches. cron-live is now truly Shopify-only. HEAD `<HASH>` range `<prev>..<HEAD>`.
metadata:
  type: project
---

# Phase E1.6 — SHIPPED 2026-05-30

**HEAD on origin/main:** `<COMMIT_HASH>` (replace at write time)
**Push range:** `<prev>..<HEAD>` (~10 commits)

## What landed
- shared `cadConvert` + `upsertDataDailySpend` helpers
- 3 bulk-date fetchers (Meta + Google + TikTok)
- 3 worker hot_metrics branches each get a new account-aggregate step + production adapter wiring
- cron-live strips fetch-light + 3 select-prior-spend steps; persist-rolling-3day reads worker-written spend inline
- ARCHITECTURE §Phase E1.6 + correction note on §Phase E1.5
- User Manual 2.3.0 → 2.3.1

## Architecture delta
| What | Before E1.6 | After E1.6 |
|---|---|---|
| cron-live step.runs per tick | 8 | 3 (shopify-rolling + shopify-orders + persist) |
| Platform API calls / 10 min | 27 (cron-live × 3 platforms × 3 dates) | 9 (workers × 3 platforms × 1 bulk) |
| Who writes data_daily.fb/ga/tt_spend_cad | cron-live | metaWorker / googleWorker / tiktokWorker hot_metrics |
| Race mitigation | n/a | partial-column UPSERT (disjoint payload columns) |

## Tests
+32 new (8+7+4+3+4+6) − 5 dropped on removed steps. Total estimate ~1575.

## Related
- [[phase-e1-e1-5-shipped]] — predecessor
- spec: `docs/superpowers/specs/2026-05-30-phase-e1-6-account-spend-to-workers-design.md`
- plan: `docs/superpowers/plans/2026-05-30-phase-e1-6-account-spend-to-workers.md`
```

Add a line to `~/.claude/projects/-Users-dorperetz-script-roas/memory/MEMORY.md`:

```markdown
- [Phase E1.6 SHIPPED 2026-05-30](project_phase_e1_6_shipped.md) — moved account-level platform spend fetch from cron-live to 3 hot_metrics workers via shared cadConvert + upsertDataDailySpend + 3 bulk fetchers. cron-live now truly Shopify-only (3 step.runs instead of 8). API budget −50%. HEAD `<HASH>`. Phase E2 next.
```

## Self-review

**1. Spec coverage check:**
- ✅ cadConvert helper (Task 1)
- ✅ upsertDataDailySpend helper (Task 2)
- ✅ 3 bulk-date fetchers (Tasks 3-5)
- ✅ 3 worker hot_metrics steps + production adapters (Tasks 6-8)
- ✅ cron-live strip + persist adjustment (Task 9)
- ✅ Pre-deploy verify + docs + memory + post-deploy verify (Task 10)
- ✅ Race-mitigation via partial-column UPSERT (in cadConvert, upsertDataDailySpend, and the worker steps — each task carries the relevant pieces)

**2. Placeholder scan:**
- `<COMMIT_HASH>` + `<prev>..<HEAD>` in Task 10 Step 6 — flagged as fill-ins at memory-write time.
- `${FETCH_LIGHT_START}` / `${FETCH_LIGHT_END}` in Task 9 Step 3 — concrete line numbers computed in Task 9 Step 2; the executor reads them from the python script output and substitutes inline.
- All other code blocks are complete.

**3. Type consistency:**
- `cadConvert` signature `(amount, currency, dateStr) => Promise<number|null>` consistent across Tasks 1, 6, 7, 8.
- `upsertDataDailySpend` signature consistent across Tasks 2, 6, 7, 8.
- 3 platform fetchers return `{date, spend, currency, impressions}` shape consistently (Tasks 3-5, consumed in Tasks 6-8).
- Worker input types each get the same 3 optional fields with identical shape (Tasks 6-8).
