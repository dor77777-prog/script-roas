# Cron-Fetcher Resilience Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Five tightly-related fixes that harden the cron-fetcher pipeline: 429 backoff in all 4 platform fetchers, an OAuth canary cron to surface refresh-token expiry early, a split of cronDaily's monolithic fetch-shopify step, a SELECT hoist in cronLive for retry-safe memoization, and per-recipient step.run wrapping in sendDailySummary for safe Inngest retries.

**Architecture:** One new helper module (`lib/fetchers/withBackoff.ts`) wraps fetch with 429/Retry-After handling and is applied across the 4 platform fetchers as a near-drop-in. One new Inngest cron (`cronOauthCanary`) registered alongside the existing 11 functions. Three localized refactors in `cronDaily.ts`, `cronLive.ts`, and `sendDailySummary.ts` — each preserves existing tests where possible, with targeted step-ID/budget updates where the step shape changes.

**Tech Stack:** TypeScript 5, Next.js 15, Inngest 4.4, Vitest 2.1, Supabase 2.106.

**Spec:** `docs/superpowers/specs/2026-05-25-cron-fetcher-resilience-design.md`

**Prerequisite:** Execute on worktree branch `phase-13.4-cron-fetcher-resilience` via `superpowers:using-git-worktrees`. All commands assume cwd = `dashboard-web/` unless otherwise noted.

---

## File Structure

| File | Action | Responsibility |
|------|--------|----------------|
| `dashboard-web/src/lib/fetchers/withBackoff.ts` | Create | `fetchWithBackoff(url, init, opts)` — wraps fetch with 429 retry |
| `dashboard-web/src/lib/__tests__/fetchersWithBackoff.test.ts` | Create | 8 unit tests covering the retry/backoff logic |
| `dashboard-web/src/lib/fetchers/meta.ts` | Modify | Wrap top-level `fetch()` calls with `fetchWithBackoff` |
| `dashboard-web/src/lib/fetchers/googleAds.ts` | Modify | Same |
| `dashboard-web/src/lib/fetchers/tiktok.ts` | Modify | Same |
| `dashboard-web/src/lib/fetchers/shopify.ts` | Modify | Same |
| `dashboard-web/src/inngest/functions/cronOauthCanary.ts` | Create | Daily cron that pings `fetchGoogleAdsSpendForDay` as canary; Sentry on failure |
| `dashboard-web/src/inngest/functions/__tests__/cronOauthCanary.test.ts` | Create | 2 tests: happy path + failure → Sentry capture + throw |
| `dashboard-web/src/app/api/inngest/route.ts` | Modify | Register `cronOauthCanary` |
| `dashboard-web/src/inngest/functions/cronLive.ts` | Modify | Hoist 3-day prior-spend SELECT into its own `step.run` |
| `dashboard-web/src/inngest/functions/__tests__/cronLive.test.ts` | Modify | Bump step-count limit from ≤8 to ≤9 |
| `dashboard-web/src/inngest/functions/cronDaily.ts` | Modify | Split `fetch-shopify` step into `fetch-shopify-day` + `fetch-shopify-orders` + `fetch-shopify-catalog` |
| `dashboard-web/src/inngest/functions/__tests__/cronDaily.test.ts` | Modify | Update Test 4 step-ID list + bump limit to ≤8 |
| `dashboard-web/src/lib/notifications/sendDailySummary.ts` | Modify | Accept optional `ctx?: { step }`; per-recipient `step.run` when provided |
| `dashboard-web/src/lib/notifications/__tests__/sendDailySummary.test.ts` | Extend | Add 1 test verifying per-recipient step.run when ctx.step provided |
| `dashboard-web/src/inngest/functions/cronWhatsapp.ts` | Modify | Pass `{ step }` to all 4 `sendDailySummary` call sites |
| `docs/ARCHITECTURE.md` | Modify | Note OAuth canary + new step shapes |

Total: ~17 files, ~540 LOC.

---

## Task 1: `fetchWithBackoff` — failing tests first

**Files:**
- Create: `dashboard-web/src/lib/__tests__/fetchersWithBackoff.test.ts`

- [ ] **Step 1: Write the 8 failing tests**

Create `dashboard-web/src/lib/__tests__/fetchersWithBackoff.test.ts`:

```ts
// dashboard-web/src/lib/__tests__/fetchersWithBackoff.test.ts
// Phase 13.4 — unit tests for the 429 / Retry-After wrapper.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchWithBackoff } from '@/lib/fetchers/withBackoff';

const originalFetch = global.fetch;
const fetchMock = vi.fn();

beforeEach(() => {
  global.fetch = fetchMock as unknown as typeof fetch;
  fetchMock.mockReset();
  vi.useFakeTimers({ shouldAdvanceTime: false });
});

afterEach(() => {
  global.fetch = originalFetch;
  vi.useRealTimers();
});

describe('fetchWithBackoff', () => {
  it('passes through a 200 response on first attempt', async () => {
    fetchMock.mockResolvedValueOnce(new Response('ok', { status: 200 }));
    const r = await fetchWithBackoff('https://x', {}, { provider: 'meta' });
    expect(r.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('passes through a non-429 4xx without retrying', async () => {
    fetchMock.mockResolvedValueOnce(new Response('forbidden', { status: 403 }));
    const r = await fetchWithBackoff('https://x', {}, { provider: 'meta' });
    expect(r.status).toBe(403);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('retries on 429 with Retry-After numeric seconds, then succeeds', async () => {
    fetchMock
      .mockResolvedValueOnce(new Response('rate', { status: 429, headers: { 'Retry-After': '2' } }))
      .mockResolvedValueOnce(new Response('ok', { status: 200 }));
    const p = fetchWithBackoff('https://x', {}, { provider: 'google' });
    await vi.advanceTimersByTimeAsync(2000);
    const r = await p;
    expect(r.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('retries on 429 with Retry-After HTTP-date, then succeeds', async () => {
    const future = new Date(Date.now() + 3000).toUTCString();
    fetchMock
      .mockResolvedValueOnce(new Response('rate', { status: 429, headers: { 'Retry-After': future } }))
      .mockResolvedValueOnce(new Response('ok', { status: 200 }));
    const p = fetchWithBackoff('https://x', {}, { provider: 'tiktok' });
    await vi.advanceTimersByTimeAsync(3500);
    const r = await p;
    expect(r.status).toBe(200);
  });

  it('uses 1s exponential start when Retry-After absent', async () => {
    fetchMock
      .mockResolvedValueOnce(new Response('rate', { status: 429 }))
      .mockResolvedValueOnce(new Response('ok', { status: 200 }));
    const p = fetchWithBackoff('https://x', {}, { provider: 'shopify' });
    await vi.advanceTimersByTimeAsync(1000);
    const r = await p;
    expect(r.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('caps Retry-After at 60 seconds', async () => {
    fetchMock
      .mockResolvedValueOnce(new Response('rate', { status: 429, headers: { 'Retry-After': '999999' } }))
      .mockResolvedValueOnce(new Response('ok', { status: 200 }));
    const p = fetchWithBackoff('https://x', {}, { provider: 'meta' });
    await vi.advanceTimersByTimeAsync(60_001);
    const r = await p;
    expect(r.status).toBe(200);
  });

  it('returns the final 429 after maxRetries exhausted', async () => {
    fetchMock.mockResolvedValue(new Response('rate', { status: 429 }));
    const p = fetchWithBackoff('https://x', {}, { provider: 'meta', maxRetries: 2 });
    await vi.advanceTimersByTimeAsync(10_000);
    const r = await p;
    expect(r.status).toBe(429);
    expect(fetchMock).toHaveBeenCalledTimes(3); // initial + 2 retries
  });

  it('respects custom maxRetries=0 (no retry)', async () => {
    fetchMock.mockResolvedValueOnce(new Response('rate', { status: 429 }));
    const r = await fetchWithBackoff('https://x', {}, { provider: 'meta', maxRetries: 0 });
    expect(r.status).toBe(429);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run tests, expect RED**

Run: `cd dashboard-web && npx vitest run src/lib/__tests__/fetchersWithBackoff.test.ts 2>&1 | tail -10`
Expected: import error — `Cannot find module '@/lib/fetchers/withBackoff'`.

---

## Task 2: `fetchWithBackoff` — implementation (GREEN)

**Files:**
- Create: `dashboard-web/src/lib/fetchers/withBackoff.ts`

- [ ] **Step 3: Create the module**

Create `dashboard-web/src/lib/fetchers/withBackoff.ts`:

```ts
// dashboard-web/src/lib/fetchers/withBackoff.ts
//
// Phase 13.4 — wraps fetch() with HTTP 429 / Retry-After handling.
// Provider-agnostic; each fetcher tags its provider for log clarity.
//
// Semantics:
//   - 2xx / 3xx / non-429 4xx / 5xx → returned immediately, caller handles.
//   - 429 → honor Retry-After (numeric seconds OR HTTP-date), capped at 60s.
//     If header absent, exponential 1s/2s/4s capped at 30s.
//   - After maxRetries attempts, returns the last 429 unchanged so the
//     caller's normal error path executes (no special error type).

export type BackoffOpts = {
  provider: 'meta' | 'google' | 'tiktok' | 'shopify' | 'fx' | 'unknown';
  maxRetries?: number;
};

export async function fetchWithBackoff(
  url: string,
  init: RequestInit = {},
  opts: BackoffOpts = { provider: 'unknown' },
): Promise<Response> {
  const max = opts.maxRetries ?? 3;
  for (let attempt = 0; attempt <= max; attempt++) {
    const r = await fetch(url, init);
    if (r.status !== 429) return r;
    if (attempt === max) return r;
    const delayMs = parseRetryAfter(r.headers.get('Retry-After'), attempt);
    console.warn(
      `fetchWithBackoff[${opts.provider}]: 429 from ${url.split('?')[0]}; retrying in ${delayMs}ms (attempt ${attempt + 1}/${max})`,
    );
    await new Promise(resolve => setTimeout(resolve, delayMs));
  }
  // Unreachable per the loop guard above; satisfies TS narrowing.
  return new Response('exhausted', { status: 429 });
}

function parseRetryAfter(header: string | null, attempt: number): number {
  if (header) {
    const seconds = Number(header);
    if (Number.isFinite(seconds)) {
      return Math.min(60_000, Math.max(0, seconds * 1000));
    }
    const date = new Date(header).getTime();
    if (Number.isFinite(date)) {
      return Math.max(0, Math.min(60_000, date - Date.now()));
    }
  }
  return Math.min(30_000, 1000 * Math.pow(2, attempt));
}
```

- [ ] **Step 4: Run tests, expect GREEN**

Run: `cd dashboard-web && npx vitest run src/lib/__tests__/fetchersWithBackoff.test.ts 2>&1 | tail -10`
Expected: 8 tests passing.

---

## Task 3: Apply `fetchWithBackoff` to the 4 platform fetchers

**Files:**
- Modify: `dashboard-web/src/lib/fetchers/meta.ts`
- Modify: `dashboard-web/src/lib/fetchers/googleAds.ts`
- Modify: `dashboard-web/src/lib/fetchers/tiktok.ts`
- Modify: `dashboard-web/src/lib/fetchers/shopify.ts`

- [ ] **Step 5: Add the import + wrap each top-level fetch in meta.ts**

Run: `cd dashboard-web && grep -nB1 "await fetch(" src/lib/fetchers/meta.ts`

Add at the top of the file (after the existing imports):
```ts
import { fetchWithBackoff } from './withBackoff';
```

For EACH `await fetch(url, opts)` site that hits the Meta Graph API (any URL starting with `https://graph.facebook.com`), replace:
```ts
const r = await fetch(url, opts);
```
with:
```ts
const r = await fetchWithBackoff(url, opts, { provider: 'meta' });
```

Do NOT wrap auxiliary fetches (e.g. anything fetching internal endpoints or doing token refresh — they should fail fast). Use the grep output to identify which sites are Meta Graph calls vs others.

- [ ] **Step 6: Same for googleAds.ts**

Run: `cd dashboard-web && grep -nB1 "await fetch(" src/lib/fetchers/googleAds.ts`

Add import: `import { fetchWithBackoff } from './withBackoff';`
Wrap each Google Ads API fetch (`https://googleads.googleapis.com/...` or `https://oauth2.googleapis.com/...` if it's a data fetch, NOT a token mint) with `fetchWithBackoff(url, opts, { provider: 'google' })`.

OAuth token mint URLs (POST to `https://oauth2.googleapis.com/token`) MUST stay direct — a 429 here means the refresh-token system is under stress and we want the caller's error path immediately, not silent retries.

- [ ] **Step 7: Same for tiktok.ts**

Same pattern. Wrap calls to `https://business-api.tiktok.com/...` with `{ provider: 'tiktok' }`.

- [ ] **Step 8: Same for shopify.ts**

Run: `cd dashboard-web && grep -nB1 "await fetch(" src/lib/fetchers/shopify.ts`

3 fetch sites expected (lines ~471, ~703, ~1032). All hit `https://{shop}.myshopify.com/admin/api/...`. Wrap each with `fetchWithBackoff(url, opts, { provider: 'shopify' })`.

- [ ] **Step 9: Run full fetcher test suite, verify no regression**

Run: `cd dashboard-web && npx vitest run src/lib/fetchers/__tests__/ 2>&1 | tail -10`
Expected: all existing fetcher tests still passing. The wrapper is transparent on the happy path (non-429), so existing tests that mock `global.fetch` continue to work — `fetchWithBackoff` calls `fetch(...)` internally, which is the same mocked function.

If a test fails because it asserts on `fetch` being called exactly once on a 429 mock, that's a desired tightening — update the test to expect the retry behavior. If it fails for a different reason, diagnose.

---

## Task 4: OAuth canary — failing tests first

**Files:**
- Create: `dashboard-web/src/inngest/functions/__tests__/cronOauthCanary.test.ts`

- [ ] **Step 10: Write the failing tests**

Create `dashboard-web/src/inngest/functions/__tests__/cronOauthCanary.test.ts`:

```ts
// dashboard-web/src/inngest/functions/__tests__/cronOauthCanary.test.ts
//
// Phase 13.4 — OAuth canary daily cron. Pings Google Ads at 00:00 IL to
// surface refresh-token expiry the moment it happens, rather than at the
// next failing cron-daily run.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const captureStepErrorMock = vi.fn();
vi.mock('@/lib/sentry/capture', () => ({
  captureStepError: (...args: unknown[]) => captureStepErrorMock(...args),
}));

const fetchGoogleAdsSpendForDayMock = vi.fn();
vi.mock('@/lib/fetchers/googleAds', () => ({
  fetchGoogleAdsSpendForDay: (...args: unknown[]) => fetchGoogleAdsSpendForDayMock(...args),
}));

import { cronOauthCanary } from '../cronOauthCanary';

type StepStub = {
  run<T>(id: string, fn: () => Promise<T>): Promise<T>;
};

function makeMockStep(): { step: StepStub; ids: string[] } {
  const ids: string[] = [];
  const step: StepStub = {
    run: async <T>(id: string, fn: () => Promise<T>): Promise<T> => {
      ids.push(id);
      return fn();
    },
  };
  return { step, ids };
}

beforeEach(() => {
  captureStepErrorMock.mockClear();
  fetchGoogleAdsSpendForDayMock.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('cronOauthCanary', () => {
  it('Test 1: cronOauthCanary is registered with cron TZ=Asia/Jerusalem 0 0 * * *', () => {
    const opts = (cronOauthCanary as unknown as { opts: { triggers: Array<{ cron: string }>; id: string } }).opts;
    expect(opts.id).toBe('cron-oauth-canary');
    expect(opts.triggers).toEqual([{ cron: 'TZ=Asia/Jerusalem 0 0 * * *' }]);
  });

  it('Test 2: happy path — fetchGoogleAdsSpendForDay succeeds → no Sentry capture, no throw', async () => {
    fetchGoogleAdsSpendForDayMock.mockResolvedValueOnce({
      storeId: 'uzoshop',
      date: '2026-05-24',
      spend: 50,
      currency: 'CAD',
    });
    const { step, ids } = makeMockStep();
    const handler = (cronOauthCanary as unknown as { fn: (ctx: { step: StepStub }) => Promise<unknown> }).fn;
    const result = await handler({ step });
    expect(result).toEqual({ status: 'ok' });
    expect(ids).toEqual(['check-google-uzoshop']);
    expect(captureStepErrorMock).not.toHaveBeenCalled();
    expect(fetchGoogleAdsSpendForDayMock).toHaveBeenCalledTimes(1);
    const [storeIdArg, dateArg] = fetchGoogleAdsSpendForDayMock.mock.calls[0] as [string, string];
    expect(storeIdArg).toBe('uzoshop');
    expect(dateArg).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('Test 3: failure → captureStepError called with right tags + handler rethrows', async () => {
    fetchGoogleAdsSpendForDayMock.mockRejectedValueOnce(new Error('OAuth token expired'));
    const { step } = makeMockStep();
    const handler = (cronOauthCanary as unknown as { fn: (ctx: { step: StepStub }) => Promise<unknown> }).fn;
    await expect(handler({ step })).rejects.toThrow(/OAuth token expired/);
    expect(captureStepErrorMock).toHaveBeenCalledTimes(1);
    const [opts, err] = captureStepErrorMock.mock.calls[0] as [
      { fnId: string; stepName: string; storeId: string },
      Error,
    ];
    expect(opts.fnId).toBe('cron-oauth-canary');
    expect(opts.stepName).toBe('check-google-uzoshop');
    expect(opts.storeId).toBe('uzoshop');
    expect(err.message).toMatch(/OAuth token expired/);
  });
});
```

- [ ] **Step 11: Run tests, expect RED**

Run: `cd dashboard-web && npx vitest run src/inngest/functions/__tests__/cronOauthCanary.test.ts 2>&1 | tail -10`
Expected: import error — `Cannot find module '../cronOauthCanary'`.

---

## Task 5: OAuth canary — implementation (GREEN)

**Files:**
- Create: `dashboard-web/src/inngest/functions/cronOauthCanary.ts`
- Modify: `dashboard-web/src/app/api/inngest/route.ts`

- [ ] **Step 12: Create the canary handler**

Create `dashboard-web/src/inngest/functions/cronOauthCanary.ts`:

```ts
// dashboard-web/src/inngest/functions/cronOauthCanary.ts
//
// Phase 13.4 — daily OAuth canary at 00:00 IL.
//
// Why: Google OAuth refresh-tokens issued from the OAuth Playground expire
// after 7 days unless the OAuth consent screen is published to Production.
// Without a canary, the operator learns the token is dead only when the
// 00:05 IL cron-daily fails — by which point the previous day's revenue
// row is already at risk of a placeholder/zero state.
//
// The canary runs 5 minutes before cron-daily, calls a real Google Ads
// fetcher (so it actually exercises the token refresh path), and reports
// any error to Sentry via the existing captureStepError helper. Inngest's
// dead-letter behavior + Sentry capture together give the operator both a
// dashboard chip and a captured event for triage.
//
// Why only Google: Meta + TikTok use long-lived (60-day rotating) access
// tokens that already alert via the existing notifyTokenFailure pathway.
// Google is the one with the 7-day-without-publication refresh-token
// expiry trap. This canary is targeted; we can add Meta/TikTok canaries
// later if those token shapes change.

import { inngest } from '@/inngest/client';
import { fetchGoogleAdsSpendForDay } from '@/lib/fetchers/googleAds';
import { captureStepError } from '@/lib/sentry/capture';

function yesterdayInIsrael(): string {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Jerusalem',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const yesterday = new Date(Date.now() - 86_400_000);
  return fmt.format(yesterday);
}

export const cronOauthCanary = inngest.createFunction(
  {
    id: 'cron-oauth-canary',
    triggers: [{ cron: 'TZ=Asia/Jerusalem 0 0 * * *' }],
  },
  async ({ step }) => {
    await step.run('check-google-uzoshop', async () => {
      try {
        await fetchGoogleAdsSpendForDay('uzoshop', yesterdayInIsrael());
        return { ok: true };
      } catch (e) {
        captureStepError(
          {
            fnId: 'cron-oauth-canary',
            stepName: 'check-google-uzoshop',
            storeId: 'uzoshop',
          },
          e,
        );
        throw e;
      }
    });
    return { status: 'ok' };
  },
);
```

- [ ] **Step 13: Register the canary in the Inngest webhook route**

Open `dashboard-web/src/app/api/inngest/route.ts`. Add to the imports near other function imports:
```ts
import { cronOauthCanary } from '@/inngest/functions/cronOauthCanary';
```

In the `functions: [...]` array, add a new line (keep the comment style of the surrounding entries):
```ts
    cronOauthCanary, // 1 function (Phase 13.4 — Google OAuth refresh-token canary, 00:00 IL daily)
```

Place it logically — between the other crons and the events, or just before `...whatsappCronFunctions`.

- [ ] **Step 14: Run canary tests, expect GREEN**

Run: `cd dashboard-web && npx vitest run src/inngest/functions/__tests__/cronOauthCanary.test.ts 2>&1 | tail -10`
Expected: 3 tests passing.

---

## Task 6: cronLive — hoist 3-day prior-spend SELECT into its own step

**Files:**
- Modify: `dashboard-web/src/inngest/functions/cronLive.ts`
- Modify: `dashboard-web/src/inngest/functions/__tests__/cronLive.test.ts`

- [ ] **Step 15: Locate the inline SELECT inside persistDayForStore**

Run: `cd dashboard-web && grep -n "data_daily" src/inngest/functions/cronLive.ts | head -10`

Find the block (~line 422) that begins:
```ts
const { data: existing, error: selErr } = await admin
  .from('data_daily')
  .select('fb_spend_cad, ga_spend_cad, tt_spend_cad, total_spend_cad')
  ...
```

This SELECT runs once per `persistDayForStore` call (which is called once per date in the 3-day window). It's inside the bigger `persist-rolling-3day` step.

- [ ] **Step 16: Hoist into a new step.run BEFORE the persist loop**

Locate where `persist-rolling-3day` step is constructed in `runLiveForStoreInner`. Just BEFORE that step.run call (or where `dates` is iterated), insert a new step:

```ts
// Phase 13.4 — hoist the prior-spend SELECT out of persist-rolling-3day
// so its result is memoized across Inngest retries. Pre-fix the SELECT
// lived inside persistDayForStore, causing per-platform-preserve
// fallback to corrupt when persist-rolling-3day retried after a
// partial failure.
type PriorSpend = { fb: number; ga: number; tt: number; total: number };
const priorSpendByDate: Record<string, PriorSpend> = await step.run(
  'read-prior-platform-spend-3day',
  async () => {
    const admin = getSupabaseAdmin();
    const out: Record<string, PriorSpend> = {};
    for (const date of dates) {
      const { data, error } = await admin
        .from('data_daily')
        .select('fb_spend_cad, ga_spend_cad, tt_spend_cad, total_spend_cad')
        .eq('date', date)
        .eq('store_id', storeId)
        .maybeSingle();
      if (error) {
        throw new Error(
          `read-prior-platform-spend-3day select for ${storeId} ${date}: ${error.message}`,
        );
      }
      out[date] = {
        fb: Number(data?.fb_spend_cad ?? 0) || 0,
        ga: Number(data?.ga_spend_cad ?? 0) || 0,
        tt: Number(data?.tt_spend_cad ?? 0) || 0,
        total: Number(data?.total_spend_cad ?? 0) || 0,
      };
    }
    return out;
  },
);
```

Refactor `persistDayForStore` to take `prior: PriorSpend` as a parameter (replacing the inline SELECT block):

```ts
async function persistDayForStore(
  storeId: StoreId,
  date: string,
  shopify: ShopifyDayRows,
  prior: PriorSpend,
  spendOverride?: { fbSpendCad: number; gaSpendCad: number; ttSpendCad: number },
): Promise<void> {
  const admin = getSupabaseAdmin();

  const fbSpendCad =
    spendOverride !== undefined
      ? spendOverride.fbSpendCad
      : prior.fb;
  const gaSpendCad =
    spendOverride !== undefined
      ? spendOverride.gaSpendCad
      : prior.ga;
  const ttSpendCad =
    spendOverride !== undefined
      ? spendOverride.ttSpendCad
      : prior.tt;
  const totalSpendCad =
    spendOverride !== undefined
      ? fbSpendCad + gaSpendCad + ttSpendCad
      : prior.total;
  // ... rest of persistDayForStore unchanged ...
}
```

In `persist-rolling-3day`'s step body, update each `persistDayForStore` call to pass the prior:
```ts
await persistDayForStore(storeId, date, shopifyByDate[date], priorSpendByDate[date], todayOverride);
```

- [ ] **Step 17: Update cronLive.test.ts step-count limit**

Open `dashboard-web/src/inngest/functions/__tests__/cronLive.test.ts`. Find the assertion at the line:
```ts
expect(labels.length).toBeLessThanOrEqual(8);
```
Change to:
```ts
expect(labels.length).toBeLessThanOrEqual(9);
```
And update the preceding comment to mention the new step:
```ts
// Budget is now 9 (fetch-shopify-rolling-3day + fetch-meta-google-tiktok-spend-light-3day +
// fetch-shopify-orders-attribution-today + 3× select-prior-spend + read-prior-platform-spend-3day +
// persist-rolling-3day + refresh-effective-status).
```

- [ ] **Step 18: Run cronLive test suite, verify GREEN**

Run: `cd dashboard-web && npx vitest run src/inngest/functions/__tests__/cronLive.test.ts src/inngest/functions/__tests__/cronLiveStatusRefresh.test.ts 2>&1 | tail -10`
Expected: all tests passing.

---

## Task 7: cronDaily — split `fetch-shopify` into 3 parallel steps

**Files:**
- Modify: `dashboard-web/src/inngest/functions/cronDaily.ts`
- Modify: `dashboard-web/src/inngest/functions/__tests__/cronDaily.test.ts`

- [ ] **Step 19: Refactor fetch-shopify**

Locate the `fetch-shopify` step in `runDailyForStoreInner` (around line 263 in current state — search for `await step.run('fetch-shopify'`).

Replace the single monolithic step:
```ts
const shopify = (await step.run('fetch-shopify', async () => {
  try {
    const [day, orders, catalog] = await Promise.all([
      fetchShopifyDayRows(storeId, dateStr),
      fetchShopifyOrdersAttribution(storeId, dateStr),
      fetchShopifyProductsCatalog(storeId),
    ]);
    return { ...day, orders, catalog };
  } catch (e) {
    // ... existing isAuthError + throw block ...
  }
})) as { ... };
```

With 3 separate parallel step.runs, each with its own try/auth-alert wrapping if needed. Keep the SAME Shopify auth-error alerting behavior for any of the 3.

```ts
// Phase 13.4 — split the monolithic fetch-shopify step into 3 smaller
// steps that run in parallel. Each retries independently; total payload
// memoized per step is bounded. Step count: 6 → 8.
async function fetchShopifyDayWithAuthAlert() {
  try {
    return await fetchShopifyDayRows(storeId, dateStr);
  } catch (e) {
    const errMsg = e instanceof Error ? e.message : String(e);
    if (isAuthError('shopify', errMsg)) {
      await notifyTokenFailure({
        provider: 'shopify',
        storeId: storeId as 'uzoshop' | 'zolplus' | 'usmile360',
        operation: 'fetch_day_rows',
        errorMsg: errMsg,
        advice:
          'Re-mint the Shopify Admin API access token (Shopify Partners → ' +
          'app → revoke + reinstall) and update ' +
          `${storeId.toUpperCase()}_SHOPIFY_ACCESS_TOKEN in Vercel + redeploy.`,
      }).catch(() => {});
    }
    throw e;
  }
}

const [day, orders, catalog] = await Promise.all([
  step.run('fetch-shopify-day', () => fetchShopifyDayWithAuthAlert()),
  step.run('fetch-shopify-orders', () => fetchShopifyOrdersAttribution(storeId, dateStr)),
  step.run('fetch-shopify-catalog', () => fetchShopifyProductsCatalog(storeId)),
]);
const shopify = { ...day, orders, catalog };
```

The `fetchShopifyDayWithAuthAlert` is a local function inside `runDailyForStoreInner` that captures `storeId` + `dateStr` from the closure. Define it just before the `Promise.all` block.

Only the day-rows fetcher gets the auth-alert wrapping because day-rows is what calls the heavy Admin REST orders endpoint where Shopify enforces tokens most strictly. orders-attribution and catalog use the same token but separate auth failure for them is rare and would be subsumed by the day-rows alert.

- [ ] **Step 20: Update cronDaily.test.ts Test 4 step-ID list + budget**

Open `dashboard-web/src/inngest/functions/__tests__/cronDaily.test.ts`. Find Test 4 (around line 538-558). Replace the expected step IDs and the budget guard:

```ts
expect(ids).toEqual([
  'fetch-shopify-day',
  'fetch-shopify-orders',
  'fetch-shopify-catalog',
  'fetch-meta',
  'fetch-google',
  'fetch-tiktok',
  'apply-manual-overrides',
  'persist-batch',
]);
// Free-tier guard updated for Phase 13.4 fetch-shopify split (1 → 3 steps).
// Total step count must stay ≤ 9 (1 function + 8 steps = 9 execs/run;
// × 3 stores × 1 run/day × 30 days = 810 execs/month from cron-daily —
// still well under 50K/mo free-tier).
expect(ids.length).toBeLessThanOrEqual(9);
```

- [ ] **Step 21: Run cronDaily test suite, verify GREEN**

Run: `cd dashboard-web && npx vitest run src/inngest/functions/__tests__/cronDaily.test.ts 2>&1 | tail -10`
Expected: all tests passing (including Test 4 with the new step IDs).

---

## Task 8: `sendDailySummary` — accept optional ctx.step + add test

**Files:**
- Modify: `dashboard-web/src/lib/notifications/sendDailySummary.ts`
- Modify: `dashboard-web/src/lib/notifications/__tests__/sendDailySummary.test.ts`

- [ ] **Step 22: Refactor sendDailySummary signature + per-recipient step.run**

Open `dashboard-web/src/lib/notifications/sendDailySummary.ts`. Update the function signature + the recipient loop:

Replace the existing function signature:
```ts
export async function sendDailySummary(
  dateStr: string,
  title: string,
): Promise<SendResult> {
```

With:
```ts
export type StepRunner = {
  run<T>(id: string, fn: () => Promise<T>): Promise<T>;
};

export async function sendDailySummary(
  dateStr: string,
  title: string,
  ctx?: { step: StepRunner },
): Promise<SendResult> {
```

Replace the existing recipient loop:
```ts
for (const to of recipients) {
  result.recipientsAttempted.push(to);
  try {
    await sendWhatsAppTemplate({
      toNumber: to,
      templateName: cfg.templateName,
      templateLang: cfg.templateLang || 'he',
      templateParams,
    });
    result.recipientsSucceeded.push(to);
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    result.recipientsFailed.push({ to, error });
  }
}
```

With:
```ts
for (const to of recipients) {
  result.recipientsAttempted.push(to);
  const stepKey = `send-whatsapp-${to.replace(/[^a-zA-Z0-9]/g, '_')}`;
  const send = () =>
    sendWhatsAppTemplate({
      toNumber: to,
      templateName: cfg.templateName,
      templateLang: cfg.templateLang || 'he',
      templateParams,
    });
  try {
    if (ctx?.step) {
      // Phase 13.4 — per-recipient step.run lets Inngest memoize succeeded
      // sends across function retries, preventing duplicate WhatsApp
      // messages when a single recipient fails out of many.
      await ctx.step.run(stepKey, send);
    } else {
      await send();
    }
    result.recipientsSucceeded.push(to);
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    result.recipientsFailed.push({ to, error });
  }
}
```

Leave the rest of the function (the throw-on-any-failure block at the end) unchanged. The throw still happens, so Inngest still retries — but now the retry only re-attempts the failed recipient(s).

- [ ] **Step 23: Add test for the ctx.step path**

Open `dashboard-web/src/lib/notifications/__tests__/sendDailySummary.test.ts`. Append a new test at the end (inside the existing top-level describe, OR append a new describe at the file end):

```ts
describe('sendDailySummary — ctx.step per-recipient isolation (Phase 13.4)', () => {
  it('wraps each recipient send in step.run when ctx.step is provided', async () => {
    // Reuse the file's existing config + WhatsApp send mocks via the
    // pattern already established by neighbouring tests. The point of
    // this test is to verify the stepKey shape + invocation count.
    const stepRunMock = vi.fn(<T>(id: string, fn: () => Promise<T>) => fn());
    // ... arrange config + 2-recipient template + happy WhatsApp send mocks ...
    await sendDailySummary('2026-05-24', 'Test Title', { step: { run: stepRunMock } });
    expect(stepRunMock).toHaveBeenCalledTimes(2);
    const keys = stepRunMock.mock.calls.map(c => c[0]);
    expect(keys[0]).toMatch(/^send-whatsapp-/);
    expect(keys[1]).toMatch(/^send-whatsapp-/);
    // Phone numbers normalized: '+972524809540' → 'send-whatsapp-_972524809540'
    expect(keys.some(k => k.includes('972524809540'))).toBe(true);
  });
});
```

Read the existing tests in the file FIRST to see how config + WhatsApp mocks are arranged; reuse the same pattern. The above is the test contract; arrange the mocks per the file's idiom.

- [ ] **Step 24: Run sendDailySummary tests, verify GREEN**

Run: `cd dashboard-web && npx vitest run src/lib/notifications/__tests__/sendDailySummary.test.ts 2>&1 | tail -10`
Expected: all existing tests still passing + the new ctx.step test passing.

---

## Task 9: cronWhatsapp — pass `{ step }` to all 4 call sites

**Files:**
- Modify: `dashboard-web/src/inngest/functions/cronWhatsapp.ts`

- [ ] **Step 25: Update all 4 sendDailySummary call sites**

Open `dashboard-web/src/inngest/functions/cronWhatsapp.ts`. The 4 handlers (`whatsappNoon`, `whatsappEvening`, `whatsappEod`, `eventWhatsappSendNow`) currently call:
```ts
return await sendDailySummary(dateStr, titleX(dateStr));
```

Update each to pass the step context:
```ts
return await sendDailySummary(dateStr, titleX(dateStr), { step });
```

Each handler receives `step` from the Inngest function ctx already, so it's just adding the third argument. The same change repeats 4 times.

- [ ] **Step 26: Run cronWhatsapp tests, verify GREEN**

Run: `cd dashboard-web && npx vitest run src/inngest/functions/__tests__/cronWhatsapp.test.ts 2>&1 | tail -10`
Expected: all existing tests passing (the handler-shape tests don't care about the extra arg; behavior tests would need the new arg passed through but the mocked step is already there).

---

## Task 10: Full regression + build + docs note

- [ ] **Step 27: Run the full test suite**

Run: `cd dashboard-web && npm test 2>&1 | tail -10`
Expected: ~1097 tests passing (1085 prior + 8 backoff + 3 canary + 1 sendDailySummary + minor updates).

- [ ] **Step 28: Run npm run build**

Run: `cd dashboard-web && npm run build 2>&1 | tail -15`
Expected: clean build, route table appears.

- [ ] **Step 29: Update docs/ARCHITECTURE.md with phase 13.4 notes**

Open `docs/ARCHITECTURE.md`. Find the section listing Inngest functions (around line 87-100). Add a new row for `cron-oauth-canary`:

Find the section "## 4. Inngest Functions" → "### 4.1 8 פונקציות הליבה". The existing table has cron-daily-{store}×3, cron-live-{store}×3, event-sync-now, event-backfill. Add a new row:

```
| `cron-oauth-canary` | `0 0 * * *` IL | Pings `fetchGoogleAdsSpendForDay('uzoshop', yesterday)` כcanary לרענון refresh-token; failure → Sentry (Phase 13.4) |
```

Also update the section header "### 4.1 8 פונקציות הליבה" → "### 4.1 9 פונקציות הליבה".

Also update the existing `cron-live-{store}` row to mention the new step shape:
```
| `cron-live-uzoshop` | `*/10 * * * *` | rolling 3-day Shopify + Meta + Google + TikTok spend + orders_attribution של היום + refresh effective_status (כל השורות הקיימות per ad-set, ללא lookback — Phase 12.5 fix; bulk UPDATE per (platform, status) — incident fix 2026-05-25; prior-spend SELECT hoisted to read-prior-platform-spend-3day step — Phase 13.4) |
```

And the `cron-daily-{store}` row:
```
| `cron-daily-uzoshop` | `5 0 * * *` IL | Shopify + Meta + Google + TikTok + FX לכל ה-yesterday (fetch-shopify split ל-day/orders/catalog — Phase 13.4) |
```

---

## Task 11: Commit + push (auto-deploy)

- [ ] **Step 30: Review the diff**

Run: `cd /Users/dorperetz/script-roas/.claude/worktrees/phase-13.4-cron-fetcher-resilience && git status && git diff --stat`

Confirm only intended files changed. `dashboard-web/package-lock.json` may have been touched by `npm install` in the worktree — do NOT stage it.

- [ ] **Step 31: Stage the intended files**

```bash
cd /Users/dorperetz/script-roas/.claude/worktrees/phase-13.4-cron-fetcher-resilience
git add \
  dashboard-web/src/lib/fetchers/withBackoff.ts \
  dashboard-web/src/lib/__tests__/fetchersWithBackoff.test.ts \
  dashboard-web/src/lib/fetchers/meta.ts \
  dashboard-web/src/lib/fetchers/googleAds.ts \
  dashboard-web/src/lib/fetchers/tiktok.ts \
  dashboard-web/src/lib/fetchers/shopify.ts \
  dashboard-web/src/inngest/functions/cronOauthCanary.ts \
  dashboard-web/src/inngest/functions/__tests__/cronOauthCanary.test.ts \
  dashboard-web/src/app/api/inngest/route.ts \
  dashboard-web/src/inngest/functions/cronDaily.ts \
  dashboard-web/src/inngest/functions/__tests__/cronDaily.test.ts \
  dashboard-web/src/inngest/functions/cronLive.ts \
  dashboard-web/src/inngest/functions/__tests__/cronLive.test.ts \
  dashboard-web/src/lib/notifications/sendDailySummary.ts \
  dashboard-web/src/lib/notifications/__tests__/sendDailySummary.test.ts \
  dashboard-web/src/inngest/functions/cronWhatsapp.ts \
  docs/ARCHITECTURE.md
```

- [ ] **Step 32: Commit**

```bash
git commit -m "$(cat <<'EOF'
feat(cron): 429 backoff + OAuth canary + payload split + SELECT hoist + recipient isolation (Phase 13.4)

Five tightly-related fixes that harden the cron-fetcher pipeline per
.planning/audit-2026-05-24/MASTER-REPORT.md (P0-E + 4 × P1).

1. fetchWithBackoff (lib/fetchers/withBackoff.ts + tests):
   wraps fetch() with 429/Retry-After handling (numeric seconds OR
   HTTP-date, capped at 60s; exponential fallback 1s/2s/4s capped at
   30s). Applied across all 4 platform fetchers (meta, googleAds, tiktok,
   shopify). 8 unit tests cover the retry/cap/exhaust paths.

2. cronOauthCanary (new Inngest cron, 00:00 IL daily): pings
   fetchGoogleAdsSpendForDay('uzoshop', yesterday) as a canary that
   exercises the OAuth refresh-token path. Failure → captureStepError
   → Sentry + Inngest dead-letter. 5 minutes before cron-daily so
   operator gets an early signal for the 7-day OAuth Playground
   refresh-token expiry trap. 3 tests.

3. cronDaily fetch-shopify split (P0-E): the monolithic fetch-shopify
   step (returned ~500KB merging day+orders+catalog) is split into 3
   parallel steps (fetch-shopify-day + fetch-shopify-orders +
   fetch-shopify-catalog). Each retries independently; Inngest
   memoizes per step. Shopify auth-alert behavior preserved on the
   day-rows fetcher. Step count budget bumped 6 → 8 (still well under
   free-tier).

4. cronLive read-prior-platform-spend-3day (P1): hoisted the inline
   data_daily SELECT out of persistDayForStore into its own step.run.
   The result is memoized across Inngest retries, eliminating the
   per-platform-preserve fallback corruption window when
   persist-rolling-3day retries after a partial failure. Step count
   budget bumped 8 → 9.

5. sendDailySummary ctx.step (P1): function now accepts an optional
   ctx.step parameter. When provided, each recipient send is wrapped
   in step.run('send-whatsapp-{sanitized}', ...). Inngest memoizes
   succeeded recipients across function retries, preventing duplicate
   WhatsApp messages on partial failure. cronWhatsapp's 4 call sites
   updated to pass { step }; legacy no-ctx callers (tests, direct
   invocations) keep the existing inline behavior.

Test results: 1085 prior + ~12 new = ~1097 passing.

Out of scope (deferred):
- MetaBudgets Map→Record type fix (T3 P1-01) → 13.4.1
- cronWhatsapp/eventBackfill/eventSyncNow top-level Sentry wraps → 13.2.2
- cron-live per-platform captureCronFetchError → 13.2.3
- Real ESLint rules → 13.3.1
- @sentry/nextjs 8→10 SDK bump → 13.2.1

Spec: docs/superpowers/specs/2026-05-25-cron-fetcher-resilience-design.md
Plan: docs/superpowers/plans/2026-05-25-cron-fetcher-resilience.md
Audit: .planning/audit-2026-05-24/MASTER-REPORT.md (Phase 13.4)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 33: Merge to main + push (pre-push hook runs all gates + auto-deploys)**

```bash
cd /Users/dorperetz/script-roas
git merge --ff-only worktree-phase-13.4-cron-fetcher-resilience
git push origin main
```

Expected: pre-push hook shows ✓ tsc, ✓ vitest (1097), ✓ lint, ✓ docs currency, ✓ pre-push gates passed. Push completes. Vercel auto-detects and starts build within seconds.

- [ ] **Step 34: Verify auto-deploy**

Poll Vercel until READY:
```bash
TOKEN=$(python3 -c "import json; print(json.load(open('/Users/dorperetz/Library/Application Support/com.vercel.cli/auth.json'))['token'])")
TEAM_ID="team_i4MS1oAvzzkwzw0JfNlGohDs"
PROJECT_ID="prj_Ry9iXqreLr1qYsmeFtqonxD3fX5v"
until STATE=$(curl -s -H "Authorization: Bearer $TOKEN" "https://api.vercel.com/v6/deployments?projectId=$PROJECT_ID&teamId=$TEAM_ID&limit=1" | python3 -c "import json,sys; d=json.load(sys.stdin); deps=d.get('deployments',[]); print(deps[0].get('state','?') if deps else 'NONE')") && [ "$STATE" = "READY" ]; do
  echo "[$(date +%H:%M:%S)] state=$STATE"; sleep 15
done
echo "DEPLOY READY"
```

Expected: BUILDING → READY within 60-90s.

- [ ] **Step 35: Smoke prod**

```bash
curl -sI https://roas-dashboard-smoky.vercel.app/ | head -3
curl -sI https://roas-dashboard-smoky.vercel.app/api/health | head -3
```
Expected: both `HTTP/2 200`.

---

## Done definition

All true:

1. `cd dashboard-web && npm test` → ~1097 passing.
2. `cd dashboard-web && npm run build` → clean.
3. Single commit on the worktree branch, fast-forwarded to main, pushed.
4. Vercel auto-deploy READY.
5. Prod URL still serving 200.
6. Inngest dashboard shows `cron-oauth-canary` as a registered function (visible at https://app.inngest.com/env/production/functions; will execute at next 00:00 IL).
7. Within 24h post-deploy: no new error spikes in Sentry; cron-daily/cron-live/cron-whatsapp continue green on Inngest dashboard; WhatsApp summaries continue arriving at 12:00, 18:00, 00:30 IL.
