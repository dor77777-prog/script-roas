# Cron-Fetcher Resilience — Design Spec

**Date:** 2026-05-25 (planned 2026-05-24; renumbered after the cron-live incident took priority overnight)
**Phase ID:** 13.4 (per MT audit punch list in `.planning/audit-2026-05-24/MASTER-REPORT.md`)
**Severity:** P0-E (Inngest cost-risk) + 4 × P1 (data-pipeline resilience)
**Scope:** Five tightly-related fixes that harden the cron-fetcher path against upstream-API failures, OAuth expiry, and retry-corruption.

## Background

The MT audit (Track 3 + Track 8) flagged the cron pipeline as the next observability/correctness target after Phase 13.2 closed the Sentry blind spot. Five items in scope here:

1. **P0-E (T8):** `cronDaily.ts:239` `fetch-shopify` step returns ~500 KB per invocation × 3 stores × 30 days ≈ **54 MB/month memoized in Inngest's step storage**. Each retry replays the whole monolithic step.
2. **P1 — 429 backoff:** None of `lib/fetchers/{meta,googleAds,tiktok,shopify}.ts` honors `Retry-After`. A 429 from any provider → Inngest's blind retry-then-deadletter amplifies the rate-limit storm (page-1..N re-fetched per attempt).
3. **P1 — OAuth canary:** Google OAuth refresh-token expires ~2026-05-30 per `[[project-google-oauth-refresh-token-pending]]` memory. No proactive detector — operator finds out only after the FIRST cron failure.
4. **P1 — cronLive SELECT hoist:** `cronLive.ts:422` SELECT lives inside the bigger `persist-rolling-3day` step.run — not memoized like the INN-10 prior-spend SELECTs. Per-platform-preserve fallback corrupts on retry.
5. **P1 — sendDailySummary recipient isolation:** `sendDailySummary.ts:112-119` throws on ANY recipient failure → on Inngest retry, ALL recipients re-send (4 duplicates if 5 recipients × 1 failure). Single-recipient deployment masks this today but will surface the moment a second recipient is added.

Today's cron-live incident (commit `da97912`, FUNCTION_INVOCATION_TIMEOUT loop on uzoshop) is **NOT** one of these five — it was an N+1 in `refresh-effective-status` already fixed. This phase covers the OTHER pre-existing resilience gaps the audit identified.

## Goal

After this phase ships:

- **G1 (P0-E):** `fetch-shopify` is split into 3 smaller `step.run` calls (`fetch-shopify-day`, `fetch-shopify-orders`, `fetch-shopify-catalog`) running in parallel. Each fails/retries independently. Total step count rises from 5 → 7 per cron-daily-store; still well under the free-tier budget.
- **G2 (429):** Every outbound HTTP from `lib/fetchers/{meta,googleAds,tiktok,shopify}.ts` is wrapped in `fetchWithBackoff(url, init, { provider, maxRetries:3 })`. On a 429: honor `Retry-After` (seconds OR HTTP-date, capped at 60 s) OR exponential 1s/2s/4s (capped at 30 s); after retries exhausted, return the final 429 unchanged for caller's normal error path.
- **G3 (OAuth canary):** New `inngest/functions/cronOauthCanary.ts` — cron at `TZ=Asia/Jerusalem 0 0 * * *` (00:00 IL daily). Calls `fetchGoogleAdsSpendForDay('uzoshop', yesterdayInIsrael())`. On failure: `captureStepError({fnId:'cron-oauth-canary', stepName:'check-google-uzoshop', storeId:'uzoshop'}, e)` + rethrow (Inngest dead-letters). Registered in `app/api/inngest/route.ts`.
- **G4 (cronLive SELECT hoist):** The SELECT in `persistDayForStore` is hoisted into its own `step.run('read-prior-platform-spend-3day', ...)` that runs ONCE per cron-live invocation and returns `Map<dateStr, {fb,ga,tt,total}>`. `persistDayForStore` takes the map as a parameter; the inline SELECT is removed.
- **G5 (recipient isolation):** `sendDailySummary(dateStr, title, ctx?: { step: StepRunner })`. When `ctx.step` is provided, each recipient send wraps in `await ctx.step.run(\`send-whatsapp-\${sanitize(to)}\`, ...)`. Inngest memoizes per-recipient output; on retry, recipients that already succeeded are skipped. All 4 call sites in `cronWhatsapp.ts` pass `{ step }`. The legacy no-`ctx` path stays for tests/direct invocations.

## Non-goals

- `MetaBudgets` Map→Record type fix (T3 P1-01 latent landmine) — touches type definitions across the codebase; deferred to 13.4.1.
- `cronWhatsapp`, `eventBackfill`, `eventSyncNow` top-level Sentry wraps (audit P0-C residual) — deferred to 13.2.2.
- cron-live per-platform `captureCronFetchError` — deferred to 13.2.3 (cadence × platforms over-alerts even with dedup).
- Real ESLint rules — deferred to 13.3.1.
- @sentry/nextjs 8→10 SDK upgrade — deferred to 13.2.1.

## Architecture — chosen approach

Five small, independent changes. Each is a localized addition or refactor; none touches the others' surface. They're bundled into one phase because they all live in the cron-fetcher layer and share the same testing scaffolding.

### 1. `lib/fetchers/withBackoff.ts` (new, ~80 LOC)

```ts
// dashboard-web/src/lib/fetchers/withBackoff.ts
//
// Phase 13.4 — wraps fetch() with HTTP 429 / Retry-After handling.
// Provider-agnostic; each fetcher tags its provider for log clarity.

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
    if (attempt === max) return r; // exhausted; return the 429 for normal error handling
    const delayMs = parseRetryAfter(r.headers.get('Retry-After'), attempt);
    console.warn(
      `fetchWithBackoff[${opts.provider}]: 429 from ${url.split('?')[0]}; retrying in ${delayMs}ms (attempt ${attempt + 1}/${max})`,
    );
    await new Promise(resolve => setTimeout(resolve, delayMs));
  }
  // Unreachable per the loop guard, but TS narrows.
  return new Response('exhausted', { status: 429 });
}

function parseRetryAfter(header: string | null, attempt: number): number {
  if (header) {
    const seconds = Number(header);
    if (Number.isFinite(seconds)) {
      return Math.min(60000, Math.max(0, seconds * 1000));
    }
    const date = new Date(header).getTime();
    if (Number.isFinite(date)) {
      return Math.max(0, Math.min(60000, date - Date.now()));
    }
  }
  // Exponential: 1s, 2s, 4s — capped at 30s
  return Math.min(30000, 1000 * Math.pow(2, attempt));
}
```

### 2. Fetcher wrapper application

In `meta.ts`, `googleAds.ts`, `tiktok.ts`, `shopify.ts`, replace `fetch(...)` calls with `fetchWithBackoff(...)`. The signature is `(url, init?, opts)` so it's a near-drop-in:

```ts
// Before:
const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });

// After:
const r = await fetchWithBackoff(
  url,
  { headers: { Authorization: `Bearer ${token}` } },
  { provider: 'meta' },
);
```

Only TOP-LEVEL fetch calls within each fetcher get wrapped. Auxiliary fetches (e.g. token-refresh) keep `fetch()` direct — their failure should bubble immediately for the catch-all handler, not retry.

### 3. `inngest/functions/cronOauthCanary.ts` (new, ~50 LOC)

```ts
import { inngest } from '@/inngest/client';
import { fetchGoogleAdsSpendForDay } from '@/lib/fetchers/googleAds';
import { captureStepError } from '@/lib/sentry/capture';

function yesterdayInIsrael(): string {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Jerusalem', year: 'numeric', month: '2-digit', day: '2-digit',
  });
  const today = new Date();
  const yesterday = new Date(today.getTime() - 86400000);
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
          { fnId: 'cron-oauth-canary', stepName: 'check-google-uzoshop', storeId: 'uzoshop' },
          e,
        );
        throw e; // Inngest dead-letters → operator sees in dashboard
      }
    });
    return { status: 'ok' };
  },
);
```

Registered in `app/api/inngest/route.ts` functions array: `cronOauthCanary`.

### 4. cronLive SELECT hoist (refactor `cronLive.ts` ~40 LOC)

Currently `persistDayForStore` does:
```ts
const { data: existing } = await admin.from('data_daily').select('fb_spend_cad,...').eq(...).maybeSingle();
// ... use existing ...
```

After:
- Hoist into a new step.run BEFORE the persist loop:
  ```ts
  const priorByDate = await step.run('read-prior-platform-spend-3day', async () => {
    const result: Record<string, { fb: number; ga: number; tt: number; total: number }> = {};
    for (const date of dates) {
      const { data } = await admin.from('data_daily').select(...).eq('date', date).eq('store_id', storeId).maybeSingle();
      result[date] = {
        fb: Number(data?.fb_spend_cad ?? 0) || 0,
        ga: Number(data?.ga_spend_cad ?? 0) || 0,
        tt: Number(data?.tt_spend_cad ?? 0) || 0,
        total: Number(data?.total_spend_cad ?? 0) || 0,
      };
    }
    return result;
  });
  ```
- `persistDayForStore` gains a `prior` parameter; the inline SELECT is removed.
- Existing test `cronLive.test.ts` Test 4 (step IDs order) updates to include `'read-prior-platform-spend-3day'`.

### 5. `sendDailySummary` per-recipient step (refactor ~30 LOC + 4 call sites)

```ts
type StepRunner = { run<T>(id: string, fn: () => Promise<T>): Promise<T> };

export async function sendDailySummary(
  dateStr: string,
  title: string,
  ctx?: { step: StepRunner },
): Promise<SendResult> {
  // ... existing config load + summary build ...

  for (const to of recipients) {
    result.recipientsAttempted.push(to);
    const stepKey = `send-whatsapp-${to.replace(/[^a-zA-Z0-9]/g, '_')}`;
    const send = async () => sendWhatsAppTemplate({ toNumber: to, templateName: cfg.templateName, templateLang: cfg.templateLang || 'he', templateParams });
    try {
      if (ctx?.step) {
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

  if (result.recipientsFailed.length > 0) {
    // ... unchanged: throw to surface partial failure to Inngest ...
  }
  return result;
}
```

When wrapped in step.run, Inngest memoizes the per-recipient output. On the next attempt, the already-succeeded `step.run('send-whatsapp-...', ...)` returns immediately from memoization → no duplicate WhatsApp message → only the failed recipient retries.

4 call sites in `cronWhatsapp.ts` pass `{ step }` from the Inngest handler context.

## Test plan

### `lib/__tests__/fetchersWithBackoff.test.ts` (new, ~120 LOC, 8 tests)

```ts
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fetchWithBackoff } from '@/lib/fetchers/withBackoff';

const originalFetch = global.fetch;
const fetchMock = vi.fn();
beforeEach(() => {
  global.fetch = fetchMock as unknown as typeof fetch;
  fetchMock.mockReset();
  vi.useFakeTimers();
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

  it('retries on 429 with Retry-After numeric seconds', async () => {
    fetchMock
      .mockResolvedValueOnce(new Response('rate-limited', { status: 429, headers: { 'Retry-After': '2' } }))
      .mockResolvedValueOnce(new Response('ok', { status: 200 }));
    const p = fetchWithBackoff('https://x', {}, { provider: 'google' });
    await vi.advanceTimersByTimeAsync(2000);
    const r = await p;
    expect(r.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('retries on 429 with Retry-After HTTP-date', async () => {
    const future = new Date(Date.now() + 3000).toUTCString();
    fetchMock
      .mockResolvedValueOnce(new Response('429', { status: 429, headers: { 'Retry-After': future } }))
      .mockResolvedValueOnce(new Response('ok', { status: 200 }));
    const p = fetchWithBackoff('https://x', {}, { provider: 'tiktok' });
    await vi.advanceTimersByTimeAsync(3500);
    const r = await p;
    expect(r.status).toBe(200);
  });

  it('uses exponential backoff when Retry-After absent', async () => {
    fetchMock
      .mockResolvedValueOnce(new Response('429', { status: 429 }))
      .mockResolvedValueOnce(new Response('ok', { status: 200 }));
    const p = fetchWithBackoff('https://x', {}, { provider: 'shopify' });
    await vi.advanceTimersByTimeAsync(1000); // attempt 0 → 1000ms
    const r = await p;
    expect(r.status).toBe(200);
  });

  it('caps Retry-After at 60s', async () => {
    fetchMock
      .mockResolvedValueOnce(new Response('429', { status: 429, headers: { 'Retry-After': '999999' } }))
      .mockResolvedValueOnce(new Response('ok', { status: 200 }));
    const p = fetchWithBackoff('https://x', {}, { provider: 'meta' });
    await vi.advanceTimersByTimeAsync(60_001);
    const r = await p;
    expect(r.status).toBe(200);
  });

  it('returns the final 429 after maxRetries exhausted', async () => {
    fetchMock.mockResolvedValue(new Response('429', { status: 429 }));
    const p = fetchWithBackoff('https://x', {}, { provider: 'meta', maxRetries: 2 });
    await vi.advanceTimersByTimeAsync(1000 + 2000 + 1); // attempts 0,1,2
    const r = await p;
    expect(r.status).toBe(429);
    expect(fetchMock).toHaveBeenCalledTimes(3); // initial + 2 retries
  });

  it('respects custom maxRetries=0 (no retry)', async () => {
    fetchMock.mockResolvedValueOnce(new Response('429', { status: 429 }));
    const r = await fetchWithBackoff('https://x', {}, { provider: 'meta', maxRetries: 0 });
    expect(r.status).toBe(429);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
```

### Other test updates

- `cronLive.test.ts` Test 4: extend `expectedStepIds` to include `'read-prior-platform-spend-3day'` in its position.
- `sendDailySummary.test.ts`: add one test asserting `ctx.step.run` is called once per recipient when `ctx.step` is provided.
- `cronDaily.test.ts`: extend Test 4 `expectedStepIds` to include the 3 split shopify steps (`fetch-shopify-day`, `fetch-shopify-orders`, `fetch-shopify-catalog`) instead of the single `fetch-shopify`.
- `cronOauthCanary.test.ts` (new, ~50 LOC): 2 tests — happy path returns ok; failure → captureStepError called + rethrow.

Total new/changed tests: ~12. Final count: 1085 → ~1097.

## Files touched

| File | Action | LOC |
|------|--------|-----|
| `lib/fetchers/withBackoff.ts` | New | ~80 |
| `lib/__tests__/fetchersWithBackoff.test.ts` | New | ~120 |
| `lib/fetchers/meta.ts` | Modify (wrap fetch calls) | ~15 |
| `lib/fetchers/googleAds.ts` | Modify | ~10 |
| `lib/fetchers/tiktok.ts` | Modify | ~10 |
| `lib/fetchers/shopify.ts` | Modify | ~10 |
| `inngest/functions/cronOauthCanary.ts` | New | ~50 |
| `inngest/functions/__tests__/cronOauthCanary.test.ts` | New | ~70 |
| `app/api/inngest/route.ts` | Modify (register canary) | +2 |
| `inngest/functions/cronDaily.ts` | Modify (split fetch-shopify) | ~30 |
| `inngest/functions/__tests__/cronDaily.test.ts` | Extend (step ID list) | ~10 |
| `inngest/functions/cronLive.ts` | Modify (SELECT hoist) | ~40 |
| `inngest/functions/__tests__/cronLive.test.ts` | Extend (step ID list) | ~5 |
| `lib/notifications/sendDailySummary.ts` | Modify (step param) | ~30 |
| `lib/notifications/__tests__/sendDailySummary.test.ts` | Extend | ~40 |
| `inngest/functions/cronWhatsapp.ts` | Modify (pass step) | ~12 |
| `docs/ARCHITECTURE.md` | Update (note canary + step shape changes) | +6 |

Total: ~17 files, ~540 LOC.

## Verification

1. `cd dashboard-web && npm test` — 1085 prior + ~12 new = ~1097 passing.
2. `cd dashboard-web && npm run build` — clean.
3. Auto-deploy (git push → Vercel auto-detects → READY in ~60-90s).
4. **Operational verification over 24h:**
   - Inngest dashboard shows `cron-oauth-canary` as a registered function executing at 00:00 IL.
   - No new error spikes in Sentry for cron-daily/cron-live/cron-whatsapp (the changes are transparent on the happy path).
   - WhatsApp summaries continue to arrive at 12:00, 18:00, 00:30 IL.

## Risks & mitigations

| Risk | Mitigation |
|------|-----------|
| `fetchWithBackoff` wraps something it shouldn't (e.g. an OAuth token refresh) and causes a stuck token | Only wrap TOP-LEVEL data fetches in each fetcher; explicitly document `// keep direct fetch — failure should bubble`. |
| `vi.useFakeTimers` in tests interferes with other suites | The pattern is contained to `fetchersWithBackoff.test.ts`; vitest auto-resets between files. |
| Splitting fetch-shopify changes Inngest step count → triggers Test 4 step-ID assertion failure | Test extended as part of this phase (covered in "Other test updates"). |
| cronLive SELECT hoist changes payload size returned from `read-prior-platform-spend-3day` step (small map of 3 entries) | Negligible — payload is ~200 bytes. Tested via the existing `cronLive.test.ts` regression on Test 4 step ID order. |
| `sendDailySummary` ctx step parameter breaks existing test that calls it without ctx | The `?` makes it optional; the fallback path (no ctx) preserves the current inline behavior. Existing tests pass unchanged. |
| OAuth canary fires on the wrong day if `yesterdayInIsrael()` has a DST bug | `Intl.DateTimeFormat` with `timeZone: 'Asia/Jerusalem'` handles DST correctly. Verified by 12 prior tests across other modules that use the same pattern. |

## Rollout

- Single commit on worktree `phase-13.4-cron-fetcher-resilience`.
- Conventional commit: `feat(cron): 429 backoff + OAuth canary + payload split + SELECT hoist + recipient isolation (Phase 13.4)`.
- Merge to main → auto-deploy via Vercel git integration (verified working).
- vercel.json `ignoreCommand` will let this build proceed (touches dashboard-web/).

## Open questions

None. Design is fully constrained by the audit + brainstorming decisions (full scope, OAuth canary = Sentry only).
