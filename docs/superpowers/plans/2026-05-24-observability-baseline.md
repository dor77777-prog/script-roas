# Observability Baseline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the Sentry blind spot across 19 API routes + 11 Inngest functions, add a PII scrubber, fix the silent-platform-zero in cronDaily/cronLive with dedup-throttled alerts, and env-gate the debug route — all without changing user-visible UX or Inngest retry semantics.

**Architecture:** Two new modules under `dashboard-web/src/lib/sentry/`: `scrub.ts` (client-safe `buildBeforeSend()`) + `capture.ts` (server-only `captureRouteError` / `captureStepError` / `captureCronFetchError`). Helpers called inside existing catch blocks — no HOFs, no signature changes. P0-D fix uses a per-cron-run in-memory dedup `Set<string>` combined with the existing 1/6h provider throttle in `tokenFailures.ts`.

**Tech Stack:** TypeScript 5, Next.js 15, Vitest 2.1, @sentry/nextjs ^8.40 (kept; bump to ^10.x deferred to 13.2.1).

**Spec:** `docs/superpowers/specs/2026-05-24-observability-baseline-design.md`

**Prerequisite:** Execute on worktree branch `phase-13.2-observability-baseline` created via `superpowers:using-git-worktrees`. All commands assume cwd = `dashboard-web/` unless otherwise noted.

---

## File Structure

| File | Action | Responsibility |
|------|--------|----------------|
| `dashboard-web/src/lib/sentry/scrub.ts` | Create | `buildBeforeSend()` — client-safe Sentry PII scrubber |
| `dashboard-web/src/lib/sentry/capture.ts` | Create | `captureRouteError`, `captureStepError`, `captureCronFetchError` — server-only |
| `dashboard-web/src/lib/__tests__/sentryScrub.test.ts` | Create | Unit tests for scrubber (8 cases) |
| `dashboard-web/src/lib/__tests__/sentryCapture.test.ts` | Create | Unit tests for capture helpers (7 cases including dedup) |
| `dashboard-web/sentry.{server,client,edge}.config.ts` | Modify (3 files) | Wire `beforeSend: buildBeforeSend()` |
| `dashboard-web/src/lib/notifications/tokenFailures.ts` | Modify | Add `'fetch_error'` to the `operation` union |
| `dashboard-web/src/app/api/**/route.ts` (15 files) | Modify | Add `captureRouteError(name, err, extra)` inside existing catch blocks |
| `dashboard-web/src/inngest/functions/cronDaily.ts` | Modify | Step capture + P0-D fix: dedup Set + `captureCronFetchError` replacing `isAuthError` branch (Meta + Google + TikTok blocks) |
| `dashboard-web/src/inngest/functions/cronLive.ts` | Modify | Step capture + analogous P0-D fix where applicable |
| `dashboard-web/src/inngest/functions/cronWhatsapp.ts` | Modify | Step capture in fetch/send steps |
| `dashboard-web/src/inngest/functions/eventBackfill.ts` | Modify | Step capture |
| `dashboard-web/src/inngest/functions/eventSyncNow.ts` | Modify | Step capture |
| `dashboard-web/src/inngest/functions/__tests__/cronDaily.test.ts` | Extend | 2-3 tests for new P0-D capture + alert + dedup behavior |
| `dashboard-web/src/app/api/debug/shopify-fetch/route.ts` | Modify | 4-line env-gate guard |

Total: ~30 files, ~430 LOC (260 production + 200 tests).

---

## Task 1: Scrubber tests (RED)

**Files:**
- Create: `dashboard-web/src/lib/__tests__/sentryScrub.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `dashboard-web/src/lib/__tests__/sentryScrub.test.ts`:

```ts
// dashboard-web/src/lib/__tests__/sentryScrub.test.ts
// Phase 13.2 — PII scrubber for Sentry beforeSend. Strips refresh tokens,
// access tokens, Bearer values, and phone numbers from event.message,
// event.exception.values[].value, and event.breadcrumbs[].message. Also
// deletes event.request.data when the URL targets /api/operator/*.

import { describe, it, expect } from 'vitest';
import { buildBeforeSend } from '@/lib/sentry/scrub';
import type * as Sentry from '@sentry/nextjs';

const REDACTED = '[REDACTED]';
function makeEvent(overrides: Partial<Sentry.ErrorEvent>): Sentry.ErrorEvent {
  return {
    event_id: 'evt',
    timestamp: Date.now() / 1000,
    platform: 'node',
    ...overrides,
  } as Sentry.ErrorEvent;
}

describe('buildBeforeSend (Phase 13.2 P1-01 PII scrubber)', () => {
  const scrub = buildBeforeSend();

  it('redacts access_token assignments in event.message', () => {
    const out = scrub(makeEvent({ message: 'fetch failed: access_token=secretValue123' }));
    expect(out?.message).toContain(REDACTED);
    expect(out?.message).not.toContain('secretValue123');
  });

  it('redacts refresh_token assignments in event.message', () => {
    const out = scrub(makeEvent({ message: 'oauth payload: "refresh_token":"1//abcdEFGH"' }));
    expect(out?.message).toContain(REDACTED);
    expect(out?.message).not.toContain('1//abcdEFGH');
  });

  it('redacts "Bearer XYZ" tokens', () => {
    const out = scrub(makeEvent({ message: 'Authorization: Bearer abc.def.ghi' }));
    expect(out?.message).toContain(REDACTED);
    expect(out?.message).not.toContain('abc.def.ghi');
  });

  it('redacts +countrycode phone numbers', () => {
    const out = scrub(makeEvent({ message: 'WhatsApp to +972524809540 failed' }));
    expect(out?.message).toContain(REDACTED);
    expect(out?.message).not.toContain('+972524809540');
  });

  it('scrubs same patterns in event.exception.values[].value', () => {
    const out = scrub(makeEvent({
      exception: { values: [{ type: 'Error', value: 'meta returned access_token=oops' }] },
    }));
    expect(out?.exception?.values?.[0]?.value).toContain(REDACTED);
    expect(out?.exception?.values?.[0]?.value).not.toContain('oops');
  });

  it('scrubs same patterns in event.breadcrumbs[].message', () => {
    const out = scrub(makeEvent({
      breadcrumbs: [{ message: 'Bearer 0xCAFE', category: 'http' }],
    }));
    expect(out?.breadcrumbs?.[0]?.message).toContain(REDACTED);
    expect(out?.breadcrumbs?.[0]?.message).not.toContain('0xCAFE');
  });

  it('deletes event.request.data when URL matches /api/operator/', () => {
    const out = scrub(makeEvent({
      request: {
        url: 'https://x.vercel.app/api/operator/sync-now',
        data: { secretPayload: 'do-not-leak' },
      },
    }));
    expect(out?.request?.data).toBeUndefined();
  });

  it('preserves event.request.data for non-operator URLs', () => {
    const out = scrub(makeEvent({
      request: {
        url: 'https://x.vercel.app/api/data?from=2026-05-01&to=2026-05-30',
        data: { range: { from: '2026-05-01', to: '2026-05-30' } },
      },
    }));
    expect(out?.request?.data).toEqual({ range: { from: '2026-05-01', to: '2026-05-30' } });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd dashboard-web && npx vitest run src/lib/__tests__/sentryScrub.test.ts`
Expected: 8 tests fail with `Cannot find module '@/lib/sentry/scrub'`.

---

## Task 2: Scrubber implementation (GREEN)

**Files:**
- Create: `dashboard-web/src/lib/sentry/scrub.ts`

- [ ] **Step 3: Create the scrubber module**

Create `dashboard-web/src/lib/sentry/scrub.ts`:

```ts
// dashboard-web/src/lib/sentry/scrub.ts
//
// Phase 13.2 (2026-05-24) — Sentry beforeSend PII scrubber.
//
// CLIENT-SAFE: this file imports only @sentry/nextjs *types*, so it can
// be loaded from sentry.client.config.ts without pulling notifyTokenFailure
// or any other server-only module into the client bundle.
//
// What it scrubs (regex patterns applied to event.message,
// event.exception.values[].value, and event.breadcrumbs[].message):
//
//   1. `access_token=...` or `"access_token":"..."` assignments  → keyword + value replaced
//   2. `refresh_token=...` or `"refresh_token":"..."` assignments → keyword + value replaced
//   3. `Bearer XYZ`                                              → "Bearer + value" replaced
//   4. `+<country code><10-15 digits>` phone numbers              → entire match replaced
//
// What it also does:
//   - Deletes `event.request.data` (the request body) when the URL matches
//     /api/operator/* — operator routes accept mutation payloads that
//     can include override secrets or recipient phone numbers.

import type * as Sentry from '@sentry/nextjs';

// Combined pattern. Order matters: more-specific keyword+value patterns
// before bare keywords so the keyword+value form is the one that matches.
const SCRUB_RE = new RegExp(
  [
    // access_token=value or "access_token":"value"
    String.raw`(?:refresh_token|access_token)\s*[=:]\s*['"]?[^\s,'"}\]]+['"]?`,
    // Bearer XYZ
    String.raw`Bearer\s+\S+`,
    // +countrycode phone numbers (10-15 digits)
    String.raw`\+\d{10,15}`,
  ].join('|'),
  'gi',
);
const REDACTED = '[REDACTED]';

function scrubString(s: string): string {
  return s.replace(SCRUB_RE, REDACTED);
}

export function buildBeforeSend() {
  return (event: Sentry.ErrorEvent): Sentry.ErrorEvent | null => {
    if (event.message) event.message = scrubString(event.message);
    for (const v of event.exception?.values ?? []) {
      if (v.value) v.value = scrubString(v.value);
    }
    for (const b of event.breadcrumbs ?? []) {
      if (b.message) b.message = scrubString(b.message);
    }
    if (event.request?.url && /\/api\/operator\//.test(event.request.url)) {
      delete event.request.data;
    }
    return event;
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd dashboard-web && npx vitest run src/lib/__tests__/sentryScrub.test.ts`
Expected: 8 tests passing.

---

## Task 3: Wire `beforeSend` into the 3 Sentry configs

**Files:**
- Modify: `dashboard-web/sentry.server.config.ts`
- Modify: `dashboard-web/sentry.client.config.ts`
- Modify: `dashboard-web/sentry.edge.config.ts`

- [ ] **Step 5: Update sentry.server.config.ts**

Read `dashboard-web/sentry.server.config.ts`. Replace the entire file with:

```ts
import * as Sentry from '@sentry/nextjs';
import { buildBeforeSend } from './src/lib/sentry/scrub';

const dsn = process.env.SENTRY_DSN || process.env.NEXT_PUBLIC_SENTRY_DSN;
if (dsn) {
  Sentry.init({
    dsn,
    tracesSampleRate: 0.1,
    environment: process.env.NODE_ENV,
    beforeSend: buildBeforeSend(),
  });
}
```

- [ ] **Step 6: Update sentry.client.config.ts**

Read `dashboard-web/sentry.client.config.ts`. Add `import { buildBeforeSend }` and `beforeSend: buildBeforeSend(),` to the `Sentry.init` block. Preserve the existing big comment block about replay being deliberately off.

Final state should be:
```ts
import * as Sentry from '@sentry/nextjs';
import { buildBeforeSend } from './src/lib/sentry/scrub';

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;
if (dsn) {
  Sentry.init({
    dsn,
    tracesSampleRate: 0.1, // 10% — enough for debugging, conserves quota
    environment: process.env.NODE_ENV,
    beforeSend: buildBeforeSend(),
    // No replay integration — error context comes from breadcrumbs only.
    // Session replay would capture DOM mutations, click coordinates, scroll
    // behaviour, and full URL paths (UTM identifiers, store IDs, date ranges),
    // which is likely PII processing in our EU/Canada B2B context and would
    // require a documented consent UX. Drop until that UX exists (WR-03 in
    // 02-foundations/02-REVIEW.md; privacy implications also noted in
    // dashboard-web/README.md). To re-enable later, add `replayIntegration`
    // back AND wire up consent + privacy-policy copy first.
  });
}
// If dsn is empty → no init. Silent no-op in localhost — no warnings, no logs.
```

- [ ] **Step 7: Update sentry.edge.config.ts**

Read `dashboard-web/sentry.edge.config.ts`. Add the same `import` + `beforeSend` line. If the file currently lacks an explicit `beforeSend`, add it inside `Sentry.init({...})`.

- [ ] **Step 8: Build to confirm no type errors + no client bundle bloat**

Run: `cd dashboard-web && npm run build 2>&1 | tail -40`
Expected: clean build, the Route table appears, no type errors. The "First Load JS" for `/` should NOT increase noticeably (the scrubber is ~30 LOC of pure logic; if it jumps by ≥10 kB it means we pulled server-only modules in by mistake — diagnose).

---

## Task 4: Add `'fetch_error'` operation kind to tokenFailures.ts

**Files:**
- Modify: `dashboard-web/src/lib/notifications/tokenFailures.ts`

- [ ] **Step 9: Locate the operation type union**

Run: `cd dashboard-web && grep -n "operation" src/lib/notifications/tokenFailures.ts | head -10`
Find the declaration that looks like `operation: 'token_refresh' | 'fetch_insights' | ...` (or wherever the operation kinds are listed).

- [ ] **Step 10: Add `'fetch_error'` to the union**

Edit the union to include `'fetch_error'`. Example: if the line reads
```ts
operation: 'token_refresh' | 'fetch_insights' | 'oauth_callback';
```
change to:
```ts
operation: 'token_refresh' | 'fetch_insights' | 'oauth_callback' | 'fetch_error';
```

(Adjust to the actual existing union — DO NOT invent kinds that aren't there.)

- [ ] **Step 11: Run the existing tokenFailures tests to confirm no regression**

Run: `cd dashboard-web && npx vitest run src/lib/notifications/__tests__/tokenFailures.test.ts 2>&1 | tail -10`
Expected: all existing tests still pass. Type errors will surface if `operation` is referenced exhaustively elsewhere (a `switch` with no default).

---

## Task 5: Capture helper tests (RED)

**Files:**
- Create: `dashboard-web/src/lib/__tests__/sentryCapture.test.ts`

- [ ] **Step 12: Write failing tests for the 3 capture helpers**

Create `dashboard-web/src/lib/__tests__/sentryCapture.test.ts`:

```ts
// dashboard-web/src/lib/__tests__/sentryCapture.test.ts
// Phase 13.2 — unit tests for the server-only capture helpers.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mock @sentry/nextjs BEFORE importing the module under test.
const captureExceptionMock = vi.fn();
vi.mock('@sentry/nextjs', () => ({
  captureException: (...args: unknown[]) => captureExceptionMock(...args),
}));

// Mock notifyTokenFailure (server-only).
const notifyTokenFailureMock = vi.fn().mockResolvedValue(undefined);
vi.mock('@/lib/notifications/tokenFailures', () => ({
  notifyTokenFailure: (...args: unknown[]) => notifyTokenFailureMock(...args),
}));

import {
  captureCronFetchError,
  captureRouteError,
  captureStepError,
} from '@/lib/sentry/capture';

beforeEach(() => {
  captureExceptionMock.mockClear();
  notifyTokenFailureMock.mockClear();
});

describe('captureRouteError', () => {
  it('captures exception with tags { layer:"api-route", route:<name> } and provided extra', () => {
    const err = new Error('boom');
    captureRouteError('data', err, { range: { from: '2026-05-01', to: '2026-05-30' } });
    expect(captureExceptionMock).toHaveBeenCalledTimes(1);
    const [calledErr, ctx] = captureExceptionMock.mock.calls[0] as [unknown, { tags?: Record<string, string>; extra?: unknown }];
    expect(calledErr).toBe(err);
    expect(ctx.tags?.layer).toBe('api-route');
    expect(ctx.tags?.route).toBe('data');
    expect(ctx.extra).toEqual({ range: { from: '2026-05-01', to: '2026-05-30' } });
  });
});

describe('captureStepError', () => {
  it('captures with tags { layer:"inngest", fnId, stepName, storeId }', () => {
    const err = new Error('step failed');
    captureStepError({ fnId: 'cron-daily', stepName: 'fetch-meta-day', storeId: 'uzoshop' }, err, { dateStr: '2026-05-15' });
    expect(captureExceptionMock).toHaveBeenCalledTimes(1);
    const [, ctx] = captureExceptionMock.mock.calls[0] as [unknown, { tags?: Record<string, string>; extra?: unknown }];
    expect(ctx.tags).toEqual({
      layer: 'inngest',
      fnId: 'cron-daily',
      stepName: 'fetch-meta-day',
      storeId: 'uzoshop',
    });
    expect(ctx.extra).toEqual({ dateStr: '2026-05-15' });
  });

  it('defaults storeId tag to "n/a" when not provided', () => {
    captureStepError({ fnId: 'cron-whatsapp', stepName: 'send-template' }, new Error('x'));
    const [, ctx] = captureExceptionMock.mock.calls[0] as [unknown, { tags?: Record<string, string> }];
    expect(ctx.tags?.storeId).toBe('n/a');
  });
});

describe('captureCronFetchError (P0-D dedup-throttled alert)', () => {
  it('captures + alerts on first call for a (platform, storeId) pair', async () => {
    const dedup = new Set<string>();
    await captureCronFetchError(
      { storeId: 'uzoshop', platform: 'meta', dedup },
      new Error('meta 503'),
      'try again later',
    );
    expect(captureExceptionMock).toHaveBeenCalledTimes(1);
    expect(notifyTokenFailureMock).toHaveBeenCalledTimes(1);
    const [arg] = notifyTokenFailureMock.mock.calls[0] as [{
      provider: string; storeId: string; operation: string; errorMsg: string; advice: string;
    }];
    expect(arg.provider).toBe('meta');
    expect(arg.storeId).toBe('uzoshop');
    expect(arg.operation).toBe('fetch_error');
    expect(arg.errorMsg).toBe('meta 503');
    expect(arg.advice).toBe('try again later');
    expect(dedup.has('meta:uzoshop')).toBe(true);
  });

  it('captures but does NOT re-alert on a second call with the same (platform, storeId)', async () => {
    const dedup = new Set<string>();
    await captureCronFetchError({ storeId: 'uzoshop', platform: 'meta', dedup }, new Error('first'));
    await captureCronFetchError({ storeId: 'uzoshop', platform: 'meta', dedup }, new Error('second'));
    expect(captureExceptionMock).toHaveBeenCalledTimes(2);
    expect(notifyTokenFailureMock).toHaveBeenCalledTimes(1);
  });

  it('alerts independently per (platform, storeId) — different storeIds same platform', async () => {
    const dedup = new Set<string>();
    await captureCronFetchError({ storeId: 'uzoshop', platform: 'meta', dedup }, new Error('a'));
    await captureCronFetchError({ storeId: 'zolplus', platform: 'meta', dedup }, new Error('b'));
    expect(notifyTokenFailureMock).toHaveBeenCalledTimes(2);
  });

  it('uses a default advice string when none is provided', async () => {
    const dedup = new Set<string>();
    await captureCronFetchError({ storeId: 'uzoshop', platform: 'google', dedup }, new Error('x'));
    const [arg] = notifyTokenFailureMock.mock.calls[0] as [{ advice: string }];
    expect(arg.advice).toContain('google');
    expect(arg.advice).toMatch(/Sentry/i);
  });

  it('does not throw when notifyTokenFailure rejects (soft-fail by contract)', async () => {
    notifyTokenFailureMock.mockRejectedValueOnce(new Error('whatsapp down'));
    const dedup = new Set<string>();
    await expect(
      captureCronFetchError({ storeId: 'uzoshop', platform: 'meta', dedup }, new Error('x')),
    ).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 13: Run test to verify it fails**

Run: `cd dashboard-web && npx vitest run src/lib/__tests__/sentryCapture.test.ts`
Expected: 7 tests fail with `Cannot find module '@/lib/sentry/capture'`.

---

## Task 6: Capture helper implementation (GREEN)

**Files:**
- Create: `dashboard-web/src/lib/sentry/capture.ts`

- [ ] **Step 14: Create the capture module**

Create `dashboard-web/src/lib/sentry/capture.ts`:

```ts
// dashboard-web/src/lib/sentry/capture.ts
//
// Phase 13.2 (2026-05-24) — server-only Sentry capture helpers.
//
// SERVER-ONLY: imports notifyTokenFailure. Never import from
// sentry.client.config.ts; the client config imports `./scrub` instead.
//
// Three helpers, all designed to be called INSIDE an existing catch block.
// None of them change degradation semantics (API routes still return their
// degraded 200; Inngest steps still throw to preserve retry/dead-letter).
//
//   captureRouteError(routeName, err, extra?)
//     → Sentry.captureException with tags { layer:'api-route', route }
//
//   captureStepError({fnId, stepName, storeId?}, err, extra?)
//     → Sentry.captureException with tags { layer:'inngest', fnId, stepName, storeId }
//
//   captureCronFetchError({storeId, platform, dedup}, err, advice?)  -- P0-D fix
//     → Sentry capture + at-most-one notifyTokenFailure per (platform,storeId)
//       per cron run. The caller-owned `dedup: Set<string>` lives on the
//       cron-handler invocation scope. The existing 1/6h provider throttle
//       in lib/notifications/tokenFailures.ts is the second-line dedupe
//       across runs.

import * as Sentry from '@sentry/nextjs';
import { notifyTokenFailure } from '@/lib/notifications/tokenFailures';

export function captureRouteError(
  routeName: string,
  err: unknown,
  extra?: Record<string, unknown>,
): void {
  Sentry.captureException(err, {
    tags: { layer: 'api-route', route: routeName },
    ...(extra ? { extra } : {}),
  });
}

export function captureStepError(
  opts: { fnId: string; stepName: string; storeId?: string },
  err: unknown,
  extra?: Record<string, unknown>,
): void {
  Sentry.captureException(err, {
    tags: {
      layer: 'inngest',
      fnId: opts.fnId,
      stepName: opts.stepName,
      storeId: opts.storeId ?? 'n/a',
    },
    ...(extra ? { extra } : {}),
  });
}

export async function captureCronFetchError(
  opts: {
    storeId: 'uzoshop' | 'zolplus' | 'usmile360';
    platform: 'meta' | 'google' | 'tiktok' | 'shopify';
    dedup: Set<string>;
  },
  err: unknown,
  advice?: string,
): Promise<void> {
  const errMsg = err instanceof Error ? err.message : String(err);
  Sentry.captureException(err, {
    tags: {
      layer: 'inngest-fetcher',
      platform: opts.platform,
      storeId: opts.storeId,
    },
  });
  const key = `${opts.platform}:${opts.storeId}`;
  if (opts.dedup.has(key)) return;
  opts.dedup.add(key);
  await notifyTokenFailure({
    provider: opts.platform,
    storeId: opts.storeId,
    operation: 'fetch_error',
    errorMsg: errMsg,
    advice:
      advice ??
      `Non-auth fetch error from ${opts.platform}; check Sentry for the full stack trace.`,
  }).catch(() => {
    /* notifyTokenFailure is soft-fail by contract */
  });
}
```

- [ ] **Step 15: Run test to verify it passes**

Run: `cd dashboard-web && npx vitest run src/lib/__tests__/sentryCapture.test.ts`
Expected: 7 tests passing.

---

## Task 7: Apply `captureRouteError` to all relevant API routes

**Files:** ~15 route files. List below.

- [ ] **Step 16: Discover the canonical list**

Run: `cd dashboard-web && grep -rln "console\.error" src/app/api/ | grep route.ts | sort`
Expected output: ~15 files. Cross-reference against the spec's list. Skip `app/api/health/route.ts` and `app/api/inngest/route.ts`.

- [ ] **Step 17: For each route, add the import + capture line**

For each route file from Step 16 (also include `app/api/debug/shopify-fetch/route.ts` even though it's env-gated in Task 9 — it has a fetch path and we want symmetry):

1. Add at the top of the file (after the existing imports):
   ```ts
   import { captureRouteError } from '@/lib/sentry/capture';
   ```
2. Inside EACH `catch (err)` (or `catch (e)`) block that contains a `console.error(...)` call, add ABOVE the `console.error`:
   ```ts
   captureRouteError('<routeName>', err);
   ```
   where `<routeName>` is the URL segment (e.g. `'data'`, `'ads'`, `'campaigns'`, `'orders-attribution'`, `'dashboard-state'`, `'operator/backfill'`, `'operator/jobs'`, `'operator/manual-overrides'`, `'operator/notifications-send'`, `'operator/reset'`, `'operator/sync-now'`, `'operator/token-failures'`, `'product-catalog'`, `'products'`, `'store-meta'`, `'oauth/tiktok-callback'`).

   If the catch variable is `e` instead of `err`, use `e`:
   ```ts
   captureRouteError('<routeName>', e);
   ```

3. For routes that have rich error context in scope (e.g. `range`, `body`, `searchParams`), pass it as the `extra`:
   ```ts
   captureRouteError('data', err, { range });
   ```
   This is optional — capturing without extra is fine. Add extras where they're cheap (locally-defined) and useful.

- [ ] **Step 18: Run the full vitest suite to confirm no regression**

Run: `cd dashboard-web && npm test 2>&1 | tail -15`
Expected: all prior tests pass + the 15 new (8 scrub + 7 capture) = `1074 passed (1074)` (or whatever 1059 + 15 is). No test should fail.

- [ ] **Step 19: Build to confirm type cleanliness**

Run: `cd dashboard-web && npm run build 2>&1 | tail -20`
Expected: clean build, no type errors.

---

## Task 8: Apply `captureStepError` to Inngest step.run callbacks

**Files:**
- Modify: `dashboard-web/src/inngest/functions/cronDaily.ts`
- Modify: `dashboard-web/src/inngest/functions/cronLive.ts`
- Modify: `dashboard-web/src/inngest/functions/cronWhatsapp.ts`
- Modify: `dashboard-web/src/inngest/functions/eventBackfill.ts`
- Modify: `dashboard-web/src/inngest/functions/eventSyncNow.ts`

- [ ] **Step 20: For each handler file, identify step.run callbacks that do external I/O**

Run: `cd dashboard-web && grep -n "step\.run(" src/inngest/functions/*.ts`
For each match, decide:
- **Wrap** if the body calls a fetcher (`fetchMetaSpendForDay`, `fetchShopifyDayRows`, `fetchGoogleAdsAdGroupStatuses`, `fetchTikTokSpend`, etc.) OR writes to Supabase (`upsert`, `delete`, `insert`).
- **Skip** if the body is pure logic (aggregation, formatting).

- [ ] **Step 21: For each step that should be wrapped, transform the body**

Before:
```ts
const result = await step.run('fetch-shopify-rolling-3day', async () => {
  return await fetchShopifyDayRows(storeId, dateStr);
});
```

After:
```ts
const result = await step.run('fetch-shopify-rolling-3day', async () => {
  try {
    return await fetchShopifyDayRows(storeId, dateStr);
  } catch (e) {
    captureStepError({ fnId: 'cron-live', stepName: 'fetch-shopify-rolling-3day', storeId }, e);
    throw e;
  }
});
```

Add the import at the top of each handler file:
```ts
import { captureStepError } from '@/lib/sentry/capture';
```

Use the correct `fnId` per file: `'cron-daily'`, `'cron-live'`, `'cron-whatsapp'`, `'event-backfill'`, `'event-sync-now'`.

The `storeId` should be in scope from the surrounding handler arg; if a particular step doesn't have a storeId (e.g. a global-scope cron), omit it (the helper defaults to `'n/a'`).

- [ ] **Step 22: Run the Inngest test suite to confirm no regression**

Run: `cd dashboard-web && npx vitest run src/inngest/functions/__tests__/ 2>&1 | tail -15`
Expected: all 8 existing Inngest tests still pass. The new wrapping is structurally invisible to the StepRunner stub.

---

## Task 9: P0-D fix — cronDaily fetcher catch blocks (RED test first)

**Files:**
- Extend: `dashboard-web/src/inngest/functions/__tests__/cronDaily.test.ts`

- [ ] **Step 23: Read the existing test pattern**

Read `dashboard-web/src/inngest/functions/__tests__/cronDaily.test.ts` — note how `StepRunner` is stubbed and how mocked fetchers throw to simulate errors.

- [ ] **Step 24a: Add the notifyTokenFailure + Sentry captureException mocks at the top of cronDaily.test.ts**

The existing test file mocks all fetchers but does NOT mock `notifyTokenFailure` (pre-13.2 the only path that called it was the `isAuthError` branch, and existing tests don't trip that branch). For Phase 13.2 we need to mock both `notifyTokenFailure` AND `@sentry/nextjs` so we can assert on the calls.

Read `dashboard-web/src/inngest/functions/__tests__/cronDaily.test.ts`. Locate the block of `vi.mock(...)` calls around lines 345-440 (mocks for `@/lib/fetchers/*` and `@/lib/supabaseAdmin`). Add immediately after the last `vi.mock(...)` call (and BEFORE the `import` of `runDailyForStore` at ~line 449):

```ts
// Phase 13.2 — mock the WhatsApp alert sink and Sentry capture so the new
// captureCronFetchError pathway can be asserted without firing real I/O.
const notifyTokenFailureMock = vi.fn().mockResolvedValue(undefined);
vi.mock('@/lib/notifications/tokenFailures', () => ({
  notifyTokenFailure: (...args: unknown[]) => notifyTokenFailureMock(...args),
}));

const sentryCaptureMock = vi.fn();
vi.mock('@sentry/nextjs', () => ({
  captureException: (...args: unknown[]) => sentryCaptureMock(...args),
}));
```

- [ ] **Step 24b: Clear the new mocks in the existing beforeEach**

Locate the existing `beforeEach(() => { ... })` block (search for `beforeEach`). At the end of its body, add:
```ts
notifyTokenFailureMock.mockClear();
sentryCaptureMock.mockClear();
```

- [ ] **Step 24c: Append the new P0-D describe block at the END of the file**

Append (after the last `});` of the outer `describe('cronDaily — factory + handler', ...)`):

```ts

// ===========================================================================
// Phase 13.2 P0-D — non-auth fetcher errors trigger captureCronFetchError
// ===========================================================================
//
// Pre-13.2: cronDaily.ts had `if (isAuthError('meta', errMsg)) notifyTokenFailure(...)`
// which only fired for auth-shaped errors. Non-auth 5xx/network/parse errors
// silently degraded to spend=0 with no operator-facing signal. These tests
// pin the new behavior: ANY non-auth fetcher throw triggers a single
// throttled WhatsApp alert + a Sentry capture, scoped via the in-memory
// dedup Set in runDailyForStore.
//
// The mocks for notifyTokenFailure + Sentry.captureException are installed
// at the top of this file (Step 24a).

describe('cronDaily P0-D — non-auth fetcher error → alert (Phase 13.2)', () => {
  beforeEach(() => {
    notifyTokenFailureMock.mockClear();
    sentryCaptureMock.mockClear();
  });

  it('Meta fetch throw triggers notifyTokenFailure({operation:"fetch_error"}) AND Sentry capture', async () => {
    // Reuse the throwIn:'meta' mechanism from Test 10.
    mockState.throwIn = 'meta';
    // Provide a non-zero TikTok/Google so the data_daily upsert proceeds (Test 10 pattern).
    mockState.tiktokSpendResult = {
      storeId: 'uzoshop', date: '2026-05-20', spend: 10, currency: 'USD',
    };
    mockState.mergeResult = {
      fbSpendCad: 0, gaSpendCad: 50, totalSpendCad: 50,
      overridesApplied: { meta: false, google: false },
    };

    const { step } = makeMockStep();
    await runDailyForStore('uzoshop', '2026-05-20', { step });

    // Exactly one notifyTokenFailure call.
    expect(notifyTokenFailureMock).toHaveBeenCalledTimes(1);
    expect(notifyTokenFailureMock.mock.calls[0][0]).toMatchObject({
      provider: 'meta',
      storeId: 'uzoshop',
      operation: 'fetch_error',
    });

    // Sentry capture called with the inngest-fetcher tag.
    expect(sentryCaptureMock).toHaveBeenCalled();
    const sentryCalls = sentryCaptureMock.mock.calls as Array<[unknown, { tags?: Record<string, string> }]>;
    const fetcherCall = sentryCalls.find(c => c[1]?.tags?.layer === 'inngest-fetcher');
    expect(fetcherCall).toBeDefined();
    expect(fetcherCall?.[1]?.tags?.platform).toBe('meta');
    expect(fetcherCall?.[1]?.tags?.storeId).toBe('uzoshop');
  });

  it('Google fetch throw triggers notifyTokenFailure for google', async () => {
    mockState.throwIn = 'google';
    mockState.tiktokSpendResult = {
      storeId: 'uzoshop', date: '2026-05-20', spend: 10, currency: 'USD',
    };
    mockState.mergeResult = {
      fbSpendCad: 36, gaSpendCad: 0, totalSpendCad: 36,
      overridesApplied: { meta: false, google: false },
    };

    const { step } = makeMockStep();
    await runDailyForStore('uzoshop', '2026-05-20', { step });

    expect(notifyTokenFailureMock).toHaveBeenCalledTimes(1);
    expect(notifyTokenFailureMock.mock.calls[0][0]).toMatchObject({
      provider: 'google',
      storeId: 'uzoshop',
      operation: 'fetch_error',
    });
  });

  it('TikTok fetch throw triggers notifyTokenFailure for tiktok', async () => {
    mockState.mergeResult = {
      fbSpendCad: 36, gaSpendCad: 50, totalSpendCad: 86,
      overridesApplied: { meta: false, google: false },
    };
    mockState.throwIn = 'tiktok';

    const { step } = makeMockStep();
    await runDailyForStore('uzoshop', '2026-05-20', { step });

    expect(notifyTokenFailureMock).toHaveBeenCalledTimes(1);
    expect(notifyTokenFailureMock.mock.calls[0][0]).toMatchObject({
      provider: 'tiktok',
      storeId: 'uzoshop',
      operation: 'fetch_error',
    });
  });
});
```

- [ ] **Step 25: Run the new tests to verify they FAIL**

Run: `cd dashboard-web && npx vitest run src/inngest/functions/__tests__/cronDaily.test.ts -t "Phase 13.2" 2>&1 | tail -25`

Expected: the 3 new tests fail because the current code only alerts on `isAuthError`-shaped messages (and the test's mocked throw produces a generic `new Error('shopify-failed')`-style error that doesn't match `isAuthError`). Specifically: `expect(notifyTokenFailureMock).toHaveBeenCalledTimes(1)` will receive 0 calls and fail.

Also verify the EXISTING Test 10 (a/b/c) STILL PASSES with the new mocks installed:
```
cd dashboard-web && npx vitest run src/inngest/functions/__tests__/cronDaily.test.ts -t "Test 10" 2>&1 | tail -10
```
Expected: 3 tests passing. The new mocks don't change Test 10's behavior because Test 10 doesn't assert on `notifyTokenFailureMock` calls (and the existing pre-13.2 code never calls notifyTokenFailure for the non-auth errors that Test 10 simulates — verifying via `notifyTokenFailureMock.mock.calls.length === 0` would have passed pre-13.2 too).

---

## Task 10: P0-D fix — implementation in cronDaily.ts + cronLive.ts (GREEN)

**Files:**
- Modify: `dashboard-web/src/inngest/functions/cronDaily.ts`
- Modify: `dashboard-web/src/inngest/functions/cronLive.ts`

- [ ] **Step 26: Add the dedup Set at the top of the shared cron-daily handler**

Locate the `runDailyForStore` (or equivalent shared handler) function in `cronDaily.ts`. At the very top of the function body (before any step.run), add:

```ts
// Phase 13.2 P0-D — in-memory dedup for fetcher-error alerts. Scoped to
// this single Inngest invocation; one alert per (platform, storeId) per
// cron run. The existing 1/6h per-provider throttle in tokenFailures.ts
// is the second-line dedupe across runs.
const fetchErrorDedup = new Set<string>();
```

- [ ] **Step 27: Replace the Meta catch block**

Locate the Meta fetcher catch in `cronDaily.ts` (currently around lines 305-335). Replace with:

```ts
} catch (e) {
  await captureCronFetchError(
    {
      storeId: storeId as 'uzoshop' | 'zolplus' | 'usmile360',
      platform: 'meta',
      dedup: fetchErrorDedup,
    },
    e,
    `Refresh the Meta access token in Vercel (${storeId.toUpperCase()}_META_ACCESS_TOKEN) or check Meta's status page.`,
  );
  return {
    spend: { storeId, date: dateStr, spend: 0, currency: 'ILS' },
    adsetRows: [],
    adRows: [],
    budgets: { campaigns: new Map(), adSets: new Map() },
  };
}
```

Remove the now-unused `if (isAuthError('meta', errMsg)) { ... }` branch and the `console.warn(...)` line (Sentry capture replaces it as the canonical log).

Add the import at the top of `cronDaily.ts`:
```ts
import { captureCronFetchError } from '@/lib/sentry/capture';
```

- [ ] **Step 28: Replace the Google catch block analogously**

Find the Google Ads fetcher catch in `cronDaily.ts` (below the Meta block). Apply the same transformation, with `platform: 'google'` and a Google-specific advice string referencing `${storeId.toUpperCase()}_GOOGLEADS_REFRESH_TOKEN`.

- [ ] **Step 29: Replace the TikTok catch block analogously**

Same pattern, `platform: 'tiktok'`, advice referencing `${storeId.toUpperCase()}_TIKTOK_ACCESS_TOKEN`.

- [ ] **Step 30: Apply the same dedup Set + capture pattern to cronLive.ts**

In `cronLive.ts`, locate the shared cron-live handler. Add the same `const fetchErrorDedup = new Set<string>();` at the top. Wrap each platform fetcher catch with `captureCronFetchError`. Add the import.

- [ ] **Step 31: Run the new tests to verify they PASS**

Run: `cd dashboard-web && npx vitest run src/inngest/functions/__tests__/cronDaily.test.ts -t "Phase 13.2" 2>&1 | tail -20`
Expected: the 3 new tests now pass.

- [ ] **Step 32: Run the full Inngest test suite to confirm no regression**

Run: `cd dashboard-web && npx vitest run src/inngest/functions/__tests__/ 2>&1 | tail -15`
Expected: all 8 prior + 3 new = 11 Inngest tests passing.

---

## Task 11: Env-gate `/api/debug/shopify-fetch`

**Files:**
- Modify: `dashboard-web/src/app/api/debug/shopify-fetch/route.ts`

- [ ] **Step 33: Add the guard at the very top of the route's GET handler**

Read `dashboard-web/src/app/api/debug/shopify-fetch/route.ts`. Add at the very start of the `export async function GET(...)` body (before any existing logic):

```ts
if (process.env.ENABLE_DEBUG_ROUTES !== '1') {
  return new NextResponse('Not Found', { status: 404 });
}
```

If the route exports POST or other methods, add the same guard to each.

If the route's existing imports don't include `NextResponse`, add it: `import { NextResponse } from 'next/server';`.

- [ ] **Step 34: Verify build still passes**

Run: `cd dashboard-web && npm run build 2>&1 | tail -10`
Expected: clean build.

---

## Task 12: Final full regression + build + commit

- [ ] **Step 35: Run the entire vitest suite**

Run: `cd dashboard-web && npm test 2>&1 | tail -10`
Expected: 1059 prior tests + 15 capture/scrub + 3 cronDaily = ~1077 tests passing.

- [ ] **Step 36: Run the build one final time**

Run: `cd dashboard-web && npm run build 2>&1 | tail -20`
Expected: clean build, route table appears.

- [ ] **Step 37: Review the diff before staging**

Run: `cd <worktree-root> && git status && git diff --stat`
Confirm only intended files changed. The `package-lock.json` may have been touched by `npm install` (if dependencies were freshly installed in the worktree) — do NOT stage it.

- [ ] **Step 38: Stage the intended files explicitly**

Run:
```bash
git add \
  dashboard-web/src/lib/sentry/scrub.ts \
  dashboard-web/src/lib/sentry/capture.ts \
  dashboard-web/src/lib/__tests__/sentryScrub.test.ts \
  dashboard-web/src/lib/__tests__/sentryCapture.test.ts \
  dashboard-web/sentry.server.config.ts \
  dashboard-web/sentry.client.config.ts \
  dashboard-web/sentry.edge.config.ts \
  dashboard-web/src/lib/notifications/tokenFailures.ts \
  dashboard-web/src/inngest/functions/cronDaily.ts \
  dashboard-web/src/inngest/functions/cronLive.ts \
  dashboard-web/src/inngest/functions/cronWhatsapp.ts \
  dashboard-web/src/inngest/functions/eventBackfill.ts \
  dashboard-web/src/inngest/functions/eventSyncNow.ts \
  dashboard-web/src/inngest/functions/__tests__/cronDaily.test.ts \
  dashboard-web/src/app/api/debug/shopify-fetch/route.ts
```
Then add all the touched API route files. Discover them via:
```bash
git diff --name-only -- 'dashboard-web/src/app/api/**/route.ts' | xargs -I{} git add {}
```

Run `git status` to confirm.

- [ ] **Step 39: Commit**

Run:
```bash
git commit -m "$(cat <<'EOF'
feat(observability): Sentry capture across API + Inngest + PII scrubber + cron fetch-error alerts (Phase 13.2)

Closes the backend observability blind spot identified in the MT audit
(P0-C, P0-D, P1-01, P1-02).

What lands:

- lib/sentry/scrub.ts (client-safe): buildBeforeSend() PII scrubber.
  Strips refresh_token/access_token/Bearer/+phone from event.message +
  event.exception.values[].value + event.breadcrumbs[].message. Deletes
  event.request.data for /api/operator/* URLs. Wired into all 3 Sentry
  configs (server, client, edge). Locked by 8 unit tests.

- lib/sentry/capture.ts (server-only): three helpers called inside
  existing catch blocks. No HOFs, no signature changes, no degradation-
  semantics changes.

    captureRouteError(routeName, err, extra?)
    captureStepError({fnId, stepName, storeId?}, err, extra?)
    captureCronFetchError({storeId, platform, dedup}, err, advice?)

  Locked by 7 unit tests including dedup scenarios.

- API routes (~15 files): added captureRouteError(...) inside existing
  catch blocks. Routes still degrade to 200; Sentry now sees the error.

- Inngest functions (5 handler files): wrapped external-I/O step.run
  callbacks with try/captureStepError/throw. Retry/dead-letter semantics
  preserved (still throws on error).

- P0-D fix (cronDaily + cronLive): replaced the isAuthError-only alert
  branch with captureCronFetchError, which fires Sentry capture + WhatsApp
  alert for ANY fetcher failure. Dedup: at most 1 alert per (platform,
  storeId) per cron run (in-memory Set scoped to the invocation). The
  existing 1/6h per-provider throttle in tokenFailures.ts remains as the
  cross-run dedupe. Locked by 3 new tests in cronDaily.test.ts.

- /api/debug/shopify-fetch: env-gated. Returns 404 in production unless
  ENABLE_DEBUG_ROUTES=1 is set in Vercel.

- tokenFailures.ts: added 'fetch_error' to the operation kind union.

Out of scope (deferred):
- @sentry/nextjs 8→10 SDK bump (P1-05) → Phase 13.2.1.
- ignoreErrors/denyUrls curation → 13.2.1 (need real prod data first).

Spec: docs/superpowers/specs/2026-05-24-observability-baseline-design.md
Plan: docs/superpowers/plans/2026-05-24-observability-baseline.md
Audit: .planning/audit-2026-05-24/MASTER-REPORT.md (Phase 13.2)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 40: Verify the commit**

Run: `git log -1 --stat`
Expected: HEAD shows the new commit with the touched files listed.

---

## Task 13: Merge + push + deploy + verify

- [ ] **Step 41: Switch to main and fast-forward merge**

Run from main (NOT the worktree):
```bash
cd /Users/dorperetz/script-roas
git log origin/main..main --oneline  # should be empty if main is up-to-date
git log main..origin/main --oneline  # should also be empty
git merge --ff-only worktree-phase-13.2-observability-baseline
```
Expected: `Fast-forward` + file list.

- [ ] **Step 42: Push to origin**

Run: `git push origin main`
Expected: `<prev-sha>..<new-sha>  main -> main`.

- [ ] **Step 43: Deploy via Vercel CLI** (auto-deploy is broken per 13.1 discovery)

Run: `cd /Users/dorperetz/script-roas && vercel --prod --yes 2>&1 | tail -15`
Expected: `Production: https://...` and JSON with `"readyState": "READY"` and `"target": "production"`. Aliased to `https://roas-dashboard-smoky.vercel.app`.

- [ ] **Step 44: Verify production is on the new code**

Run: `curl -s https://roas-dashboard-smoky.vercel.app/ | grep -oE 'static/chunks/[a-f0-9]+-[a-f0-9]+\.js' | sort -u | head -5`
Expected: at least one chunk hash differs from the previous deployment (capture before/after). The exact hashes don't matter — just that they changed.

- [ ] **Step 45: Verify the debug route is gated in production**

Run: `curl -sI https://roas-dashboard-smoky.vercel.app/api/debug/shopify-fetch 2>&1 | head -5`
Expected: `HTTP/2 404` (assuming `ENABLE_DEBUG_ROUTES` is NOT set in Vercel prod env).

- [ ] **Step 46: Confirm normal endpoints still respond**

Run:
```bash
curl -sI https://roas-dashboard-smoky.vercel.app/ | head -3
curl -sI https://roas-dashboard-smoky.vercel.app/api/health | head -3
```
Expected: both `HTTP/2 200`.

- [ ] **Step 47: (Manual) Operator verification over 24h**

After 24h of normal traffic, the operator should:
1. Open the Sentry inbox (DSN env var routes to it). Confirm at least one event tagged `layer:api-route` appears if there were any transient Postgres errors. If zero events, that's also fine — no errors occurred.
2. If a Meta/Google/TikTok fetcher fails in the wild, operator should receive a WhatsApp alert (was silent pre-13.2 for non-auth errors).

---

## Done definition

All of the following must be true:

1. `cd dashboard-web && npm test` reports `~1077 passed (~1077)` (1059 prior + ~18 new).
2. `cd dashboard-web && npm run build` exits 0 with no type errors.
3. Single commit on the worktree branch, fast-forwarded into main, pushed to origin.
4. `vercel --prod` returned READY.
5. `curl https://roas-dashboard-smoky.vercel.app/api/debug/shopify-fetch` returns 404.
6. The two new test suites (sentryScrub + sentryCapture) are green.
7. The 3 new tests in cronDaily.test.ts (P0-D) are green.
