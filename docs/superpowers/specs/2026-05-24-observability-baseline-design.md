# Observability Baseline — Design Spec

**Date:** 2026-05-24
**Phase ID:** 13.2 (per MT audit punch list in `.planning/audit-2026-05-24/MASTER-REPORT.md`)
**Severity:** P0 — backend blind spot (Sentry sees nothing from API/Inngest) + P0 silent platform-zero
**Scope:** Add Sentry capture in API routes + Inngest steps; add PII scrubber; fix cronDaily silent-zero with dedup-throttled alerts; env-gate debug route.

## Background

Per the MT audit (Tracks 5 + 8 convergence):

- **P0-C:** Zero `Sentry.captureException` calls in `dashboard-web/src/app/api/**` (19 routes) or `dashboard-web/src/inngest/functions/**` (11 functions). Errors go to `console.error` and are silenced by the API routes' `status 200 + empty rows + error: "..."` "graceful degradation" pattern. Sentry sees nothing.
- **P0-D:** `cronDaily.ts:305-335` (Meta fetch — and the analogous Google + TikTok blocks below it, and the equivalent in `cronLive.ts`) silently falls back to zero spend on ANY non-`isAuthError` fetcher failure. Operator sees "Platform = 0" and assumes the platform had no activity. No Sentry capture, no alert.

Two related items the design absorbs because they are mandatory or near-free:

- **P1-01 (Sentry PII):** With no `beforeSend` scrubber, fetcher exceptions (e.g. `googleAds.ts:233`, `meta.ts:344`, `tiktok.ts:159`, `shopifyAuth.ts:70`) include raw upstream HTTP response bodies — potentially containing `refresh_token`, `access_token`, customer phone numbers. The instant we start capturing those errors via P0-C work, we'd start leaking. Scrubber must ship together.
- **P1-02 (debug route):** `/api/debug/shopify-fetch` is shipped to prod, unauthenticated. Convergence finding (T1 security + T8 perf/observability). Env-gate is 4 lines.

Decisions captured during brainstorming (2026-05-24):

- **P0-D handling:** Hybrid. Capture to Sentry + dedup-throttled WhatsApp alert (one per platform per cron run, reusing the existing 1/6h provider throttle in `tokenFailures.ts` as second-line dedupe).
- **Sentry SDK 8→10 upgrade (P1-05):** Defer to Phase 13.2.1 — major version bump, separate blast radius.
- **Debug route:** Env-gate via `process.env.ENABLE_DEBUG_ROUTES === '1'`.

## Goal

Backend failures become visible in Sentry (no silent drops), the silent-platform-zero stops being silent, and Sentry events carry no PII or refresh tokens — all WITHOUT changing user-visible UX (degraded 200 stays degraded 200) or Inngest retry semantics.

Concrete success criteria:
- **G1.** Every error path in `app/api/**/route.ts` that previously hit `console.error` now also reaches `Sentry.captureException`, tagged with the route name.
- **G2.** Every `step.run` callback in `inngest/functions/**` that wraps external I/O captures errors to Sentry before throwing, tagged with `fnId`, `stepName`, and `storeId`.
- **G3.** `cronDaily` / `cronLive` non-auth fetcher failures (Meta, Google, TikTok) trigger a single throttled WhatsApp alert per platform per cron-run AND a Sentry event, while still degrading to zero-spend so the rest of the pipeline persists.
- **G4.** No Sentry event contains a substring matching `refresh_token`, `access_token`, `Bearer ...`, or `+\d{10,15}` phone numbers. No `event.request.data` for paths matching `/api/operator/`.
- **G5.** `GET /api/debug/shopify-fetch` returns `404 Not Found` in production (the env var `ENABLE_DEBUG_ROUTES` is unset in Vercel prod).

## Non-goals

This is an observability + alerting baseline. Out of scope:

- **Sentry SDK 8→10 upgrade.** Defer to Phase 13.2.1 — separate breaking-change rollout.
- **Replacing `console.error` with a structured logger.** Console stays as the local-dev signal; Sentry is the production signal.
- **`ignoreErrors` / `denyUrls` curation.** Will be tuned in 13.2.1 after we collect a week of real prod data.
- **Client-side error boundary expansion.** `components/ErrorBoundary.tsx` already calls `Sentry.captureException`; no additional UI-layer work.
- **Replay integration.** Already deliberately off per `sentry.client.config.ts:9-16` (consent UX needed first).
- **Sentry projects / environments / release tracking.** Single project + `environment: process.env.NODE_ENV` stays as-is.
- **Auto-deploy via Vercel git integration.** Discovered during 13.1 verification that pushes to main don't auto-deploy; that's a tooling concern, not observability. Addressed in 13.3 (engineering gates) or later.

## Root cause analysis

### P0-C — no `captureException` calls in backend

Pattern (from `dashboard-web/src/app/api/data/route.ts:62-73`):
```ts
} catch (err) {
  const message = err instanceof Error ? err.message : String(err);
  console.error('data fetch failed:', message);
  return NextResponse.json({ rows: [], stores: [], ..., error: userFacingError(message) }, {
    status: 200,
    headers: { 'Cache-Control': 'no-store' },
  });
}
```

The deliberate `status: 200 + error: "..."` "degraded but renderable" pattern means:
- Next.js sees a successful response → `onRequestError` in `instrumentation.ts:30-40` is NOT invoked.
- The catch swallows the error → no uncaught exception bubbles → Sentry never knows.

15+ routes follow this pattern (every route with `console.error` in a catch).

For Inngest, the pattern is similar but inverted: `cronDaily.ts:310-335` catches, suppresses to zero-fallback for non-auth errors, and returns. No throw → no Inngest retry → no dead-letter visibility → no Sentry event.

### P0-D — silent platform-zero

`cronDaily.ts:317-322`:
```ts
if (isAuthError('meta', errMsg)) {
  await notifyTokenFailure({ ... });
}
return {
  spend: { ..., spend: 0 },
  ...
  budgets: { campaigns: new Map(), adSets: new Map() },
};
```

`isAuthError('meta', errMsg)` matches strings like `OAuth`, `access_token`, `401`. A 503 from Meta's API, a network timeout, or a malformed-JSON parse error all bypass this branch — operator gets zero alert, zero log signal beyond `console.warn` (which Vercel surfaces in function logs but not as an actionable notification).

### P1-01 — Sentry PII

Fetchers throw with raw response bodies attached:
- `googleAds.ts:233`: `throw new Error(\`GoogleAds query failed: ${response.status} ${response.statusText} ${bodyText}\`);`
- `meta.ts:344, 453, 533`: similar pattern
- `tiktok.ts:159, 167, 243`: similar
- `shopifyAuth.ts:70, 90, 100`: includes auth flow bodies

`bodyText` may contain `refresh_token`, `access_token`, customer phone numbers (Shopify customer data), order details. When we start capturing these via P0-C work, all of it flows un-scrubbed to Sentry. Must be addressed in the same phase.

## Architecture — chosen approach

**Approach C: thin helpers called inside existing catch blocks.**

A new directory `dashboard-web/src/lib/sentry/` with two files:
- `scrub.ts` — client-safe. Exports `buildBeforeSend()`. Imports `@sentry/nextjs` types only; NO transitive server-only imports. Both client and server Sentry configs import this.
- `capture.ts` — server-only. Exports `captureRouteError`, `captureStepError`, `captureCronFetchError`. Imports `notifyTokenFailure` (server-only). Never imported from `sentry.client.config.ts`.

This split keeps `notifyTokenFailure` out of the client bundle (Sentry tree-shaking is unreliable across boundary).

Each call site adds 1-3 lines inside an existing `catch (err) { ... }` block. No HOFs, no route-signature changes, no degradation-semantics changes.

```ts
// dashboard-web/src/lib/sentry/scrub.ts (~30 LOC) — CLIENT-SAFE
import type * as Sentry from '@sentry/nextjs';

const SCRUB_RE = /(refresh_token|access_token|Bearer\s+\S+|\+\d{10,15})/gi;

/** Sentry beforeSend scrubber. Strips PII patterns from message + exception values + breadcrumbs. */
export function buildBeforeSend() {
  return (event: Sentry.ErrorEvent): Sentry.ErrorEvent | null => {
    if (event.message) event.message = event.message.replace(SCRUB_RE, '[REDACTED]');
    for (const v of event.exception?.values ?? []) {
      if (v.value) v.value = v.value.replace(SCRUB_RE, '[REDACTED]');
    }
    for (const b of event.breadcrumbs ?? []) {
      if (b.message) b.message = b.message.replace(SCRUB_RE, '[REDACTED]');
    }
    if (event.request?.url && /\/api\/operator\//.test(event.request.url)) {
      delete event.request.data;
    }
    return event;
  };
}
```

```ts
// dashboard-web/src/lib/sentry/capture.ts (~90 LOC) — SERVER-ONLY
import * as Sentry from '@sentry/nextjs';
import { notifyTokenFailure } from '../notifications/tokenFailures';

/** Captures + tags by route name. Caller still degrades. Returns nothing. */
export function captureRouteError(
  routeName: string,
  err: unknown,
  extra?: Record<string, unknown>,
): void {
  Sentry.captureException(err, {
    tags: { layer: 'api-route', route: routeName },
    extra,
  });
}

/** Captures + tags by Inngest function + step + storeId. Caller still throws. */
export function captureStepError(
  opts: { fnId: string; stepName: string; storeId?: string },
  err: unknown,
  extra?: Record<string, unknown>,
): void {
  Sentry.captureException(err, {
    tags: { layer: 'inngest', fnId: opts.fnId, stepName: opts.stepName, storeId: opts.storeId ?? 'n/a' },
    extra,
  });
}

/** P0-D: capture + dedup-throttled WhatsApp. dedup Set lives on the cron-run handler scope. */
export async function captureCronFetchError(
  opts: { storeId: 'uzoshop'|'zolplus'|'usmile360'; platform: 'meta'|'google'|'tiktok'|'shopify'; dedup: Set<string> },
  err: unknown,
  advice?: string,
): Promise<void> {
  const errMsg = err instanceof Error ? err.message : String(err);
  Sentry.captureException(err, {
    tags: { layer: 'inngest-fetcher', platform: opts.platform, storeId: opts.storeId },
  });
  const key = `${opts.platform}:${opts.storeId}`;
  if (opts.dedup.has(key)) return;
  opts.dedup.add(key);
  await notifyTokenFailure({
    provider: opts.platform,
    storeId: opts.storeId,
    operation: 'fetch_error',
    errorMsg: errMsg,
    advice: advice ?? `Non-auth fetch error from ${opts.platform}; check Sentry for full stack.`,
  }).catch(() => { /* tokenFailures is soft-fail by contract */ });
}
```

### Alternatives considered (and why rejected)

- **A. `withSentry(handler)` HOF wrapping each route export.** Forces signature change to every route. Wrapper has to know per-route degradation semantics (200 with empty rows vs 500). Two patterns leak into the wrapper. Rejected: more change for no observability benefit.
- **B. Inline `Sentry.captureException(err, {...})` in every catch block.** 15+ duplicate sites. Easy to omit on a new route. Inconsistent tags/extra. Rejected: maintenance smell.

## Change set

### 1. New modules

- `dashboard-web/src/lib/sentry/scrub.ts` — client-safe. `buildBeforeSend()` only. ~30 LOC.
- `dashboard-web/src/lib/sentry/capture.ts` — server-only. `captureRouteError`, `captureStepError`, `captureCronFetchError`. ~90 LOC.

### 2. Sentry config updates (3 files, +2 lines each)

`dashboard-web/sentry.server.config.ts`, `dashboard-web/sentry.client.config.ts`, `dashboard-web/sentry.edge.config.ts` — each gets:
```ts
import { buildBeforeSend } from './src/lib/sentry/scrub';
// ...
Sentry.init({
  dsn,
  tracesSampleRate: 0.1,
  environment: process.env.NODE_ENV,
  beforeSend: buildBeforeSend(),  // NEW
});
```

`scrub.ts` has no transitive server imports — safe to load from client config without bundling `notifyTokenFailure` or other server-only modules.

### 3. API route capture (~15 routes)

Each route with a catch-and-degrade pattern gets one new line inside the catch:

```ts
} catch (err) {
  captureRouteError('data', err, { range });  // NEW
  const message = err instanceof Error ? err.message : String(err);
  console.error('data fetch failed:', message);
  return NextResponse.json({ ... }, { status: 200 });
}
```

Routes touched (canonical list — confirm during execution):
- `app/api/ads/route.ts`
- `app/api/campaigns/route.ts`
- `app/api/dashboard-state/route.ts` (both GET and POST catches)
- `app/api/data/route.ts`
- `app/api/oauth/tiktok/callback/route.ts`
- `app/api/operator/backfill/route.ts`
- `app/api/operator/jobs/route.ts`
- `app/api/operator/manual-overrides/route.ts`
- `app/api/operator/notifications/send/route.ts`
- `app/api/operator/reset/route.ts`
- `app/api/operator/sync-now/route.ts`
- `app/api/operator/token-failures/route.ts`
- `app/api/orders-attribution/route.ts`
- `app/api/product-catalog/route.ts`
- `app/api/products/route.ts`
- `app/api/store-meta/route.ts`

Skipped:
- `app/api/health/route.ts` — static health endpoint, no try/catch to hook into.
- `app/api/inngest/route.ts` — framework webhook; Inngest itself handles capture.
- `app/api/debug/shopify-fetch/route.ts` — env-gated to 404 (item 6 below); if env is enabled and a real error occurs, also gets capture for symmetry.

### 4. Inngest step capture (5 handler files)

For each `step.run('name', async () => { ... })` whose body touches external I/O (HTTP, Supabase write), wrap with capture-and-rethrow:

```ts
await step.run('fetch-shopify-rolling-3day', async () => {
  try {
    return await fetchShopifyDayRows(...);
  } catch (e) {
    captureStepError({ fnId: 'cron-live', stepName: 'fetch-shopify-rolling-3day', storeId }, e);
    throw e;  // preserve retry/dead-letter semantics
  }
});
```

Files touched:
- `inngest/functions/cronDaily.ts`
- `inngest/functions/cronLive.ts`
- `inngest/functions/cronWhatsapp.ts`
- `inngest/functions/eventBackfill.ts`
- `inngest/functions/eventSyncNow.ts`

Steps that are pure-logic (no external I/O, e.g. derived aggregation) do NOT get wrapping — they should be exception-free; if they throw, the existing top-level Inngest retry catches it.

### 5. P0-D fix in cron fetcher catches

In `cronDaily.ts` (Meta block at ~305-335 + Google block + TikTok block below it) and the analogous in `cronLive.ts`:

```ts
// At the top of the cron-run handler (per Inngest invocation):
const dedup = new Set<string>();

// In the Meta catch (and Google + TikTok mirrors):
} catch (e) {
  await captureCronFetchError(
    { storeId, platform: 'meta', dedup },
    e,
    `Refresh the Meta access token in Vercel (${storeId.toUpperCase()}_META_ACCESS_TOKEN) or check Meta's status page.`,
  );
  return {
    spend: { storeId, date: dateStr, spend: 0, currency: 'ILS' },
    ...,
    budgets: { campaigns: new Map(), adSets: new Map() },
  };
}
```

The old `if (isAuthError(...)) notifyTokenFailure(...)` branch is REMOVED — `captureCronFetchError` always notifies (once per platform per run), and the existing per-provider 1/6h throttle in `lib/notifications/tokenFailures.ts` provides the cross-run throttle. Net effect: operator gets WhatsApp on any fetch failure (auth or not), throttled to at most 1/6h per provider.

### 6. Env-gate `/api/debug/shopify-fetch`

```ts
// At the top of dashboard-web/src/app/api/debug/shopify-fetch/route.ts:
export async function GET(req: Request) {
  if (process.env.ENABLE_DEBUG_ROUTES !== '1') {
    return new NextResponse('Not Found', { status: 404 });
  }
  // ... existing body ...
}
```

No env var added to Vercel — route returns 404 in prod by default. Operator can flip `ENABLE_DEBUG_ROUTES=1` temporarily if debugging is needed.

## Test plan

### New test file: `dashboard-web/src/lib/__tests__/sentry.test.ts` (~150 LOC)

Mock `@sentry/nextjs` and `./notifications/tokenFailures`. Test:

1. `captureRouteError('data', err, extra)` → calls `Sentry.captureException(err, { tags: {layer:'api-route', route:'data'}, extra })`.
2. `captureStepError({fnId, stepName, storeId}, err)` → calls `Sentry.captureException` with the matching tags.
3. `captureCronFetchError({storeId, platform, dedup})` → calls Sentry capture AND `notifyTokenFailure` on first invocation.
4. `captureCronFetchError` second invocation with same `(platform, storeId)` → calls Sentry capture but NOT `notifyTokenFailure` (dedup hit).
5. `captureCronFetchError` with different `storeId` same platform → both calls fire `notifyTokenFailure` (dedup is per-platform-per-store).
6. `buildBeforeSend()` scrubs `refresh_token=xxx`, `access_token=yyy`, `Bearer ZZZ`, `+972524809540` from `event.message`.
7. `buildBeforeSend()` scrubs the same patterns in `event.exception.values[].value` and `event.breadcrumbs[].message`.
8. `buildBeforeSend()` deletes `event.request.data` when `event.request.url` matches `/api/operator/`.
9. `buildBeforeSend()` keeps `event.request.data` for non-operator URLs.

### Inngest test extensions

`dashboard-web/src/inngest/functions/__tests__/cronDaily.test.ts` (or a new sibling) — 2-3 tests:

- When the Meta fetcher throws a non-auth error: assert `Sentry.captureException` is called AND `notifyTokenFailure` is called once per platform per run.
- Same scenario but throws TWICE: assert `notifyTokenFailure` called ONCE (dedup).
- When a fetcher throws across different platforms (Meta + Google): assert two `notifyTokenFailure` calls.

These tests mock the existing `StepRunner` stub pattern (per `cronDaily.test.ts` baseline).

### Existing test suite (regression)

`npm test` — all current 1059 specs plus the new ones pass. No existing test should break because:
- API routes' degradation semantics are unchanged (still status 200, still same body shape).
- Inngest step semantics are unchanged (still throw on error, retry semantics preserved).
- Cron fetcher fallback (silent zero) is unchanged.

## Verification

1. **Unit tests.** `cd dashboard-web && npm test` — green.
2. **Type check.** `cd dashboard-web && npm run build` — no type errors.
3. **Deploy via `vercel --prod`** (since git integration doesn't auto-deploy — separate issue tracked in todo).
4. **Manual prod verification:**
   - Confirm `https://roas-dashboard-smoky.vercel.app/api/debug/shopify-fetch` returns `404 Not Found`.
   - After 24h of normal traffic, check the Sentry inbox for any events tagged `route: 'data'` etc. Should see at least one transient event if Postgres has any blip.
   - If a Meta/Google/TikTok fetcher fails in the wild, operator should receive a WhatsApp alert AND a Sentry event with the relevant tags.

## Risks & mitigations

| Risk | Likelihood | Mitigation |
|------|------------|-----------|
| Server-only modules pulled into client bundle via Sentry config imports | Handled by design (architecture splits `sentry/scrub.ts` client-safe vs `sentry/capture.ts` server-only) | N/A — split is part of the architecture, not a runtime risk. |
| Sentry event volume spikes after wrappers go live (cost concern) | Low | Already on `tracesSampleRate: 0.1`. The new captures are ERROR events (not traces) — cost depends on actual error rate. Once we have a week of data we can curate `ignoreErrors` (deferred to 13.2.1). |
| Scrubber regex too aggressive — false positives blur useful info | Low | Patterns are PII-shaped (refresh_token literal, Bearer prefix, +countrycode phone). Unit-tested on negative cases ("the word access_tokenless" must NOT be scrubbed — but our regex matches `access_token` as a substring; trade-off accepted for safety). |
| `captureCronFetchError` per-invocation Set leaks across runs if cron-handler stores it in module scope by mistake | Low | The `dedup` Set is created inside the cron-handler function body, scoped to that single invocation. Reviewer must verify on the diff. |
| Removing the `isAuthError` branch changes alerting behavior in ways operator didn't anticipate | Medium | The new behavior is a STRICT improvement: previously only auth errors alerted; now any fetch error does. The 1/6h provider throttle in `tokenFailures.ts` prevents alert storms. If operator finds it too noisy, they can re-add `if (!isAuthError(...) && isLikelyTransient(...)) skip;` in 13.2.1. |
| `beforeSend` returning `null` for unrelated noise could be misused — we don't return `null` here | Low | Scrubber always returns the (possibly-modified) event. Code-reviewed during merge. |
| Vercel cold-start cost of new lib import | Negligible | `lib/sentry.ts` is ~120 LOC, pure functions, no deep dependencies. |

## Files touched (estimate)

| File | Action | LOC delta |
|------|--------|-----------|
| `dashboard-web/src/lib/sentry/scrub.ts` | New | ~30 |
| `dashboard-web/src/lib/sentry/capture.ts` | New | ~90 |
| `dashboard-web/src/lib/__tests__/sentry.test.ts` | New | ~150 |
| `dashboard-web/sentry.server.config.ts` | Modify | +3 |
| `dashboard-web/sentry.client.config.ts` | Modify | +3 |
| `dashboard-web/sentry.edge.config.ts` | Modify | +3 |
| ~15 API route files | Modify | +1-2 each (~25 total) |
| `dashboard-web/src/inngest/functions/cronDaily.ts` | Modify | ~25 (dedup Set + 3 platform-catch updates + step wrappers) |
| `dashboard-web/src/inngest/functions/cronLive.ts` | Modify | ~15 |
| `dashboard-web/src/inngest/functions/cronWhatsapp.ts` | Modify | ~10 |
| `dashboard-web/src/inngest/functions/eventBackfill.ts` | Modify | ~10 |
| `dashboard-web/src/inngest/functions/eventSyncNow.ts` | Modify | ~10 |
| `dashboard-web/src/app/api/debug/shopify-fetch/route.ts` | Modify | +5 |
| `dashboard-web/src/inngest/functions/__tests__/cronDaily.test.ts` | Extend | ~50 |
| `dashboard-web/src/lib/notifications/tokenFailures.ts` | Modify (add `'fetch_error'` operation kind) | +1 |

Total: ~30 files, ~430 LOC (260 production + 200 tests).

## Rollout

1. Single commit on worktree branch `phase-13.2-observability-baseline`.
2. Conventional commit: `feat(observability): Sentry capture across API + Inngest + PII scrubber + cron fetch-error alerts (Phase 13.2)`.
3. Merge to `main` after green tests + build.
4. Deploy via `vercel --prod` from main (since git integration is broken).
5. Post-deploy: confirm `/api/debug/shopify-fetch` returns 404. Sentry inbox checked after 24h of normal traffic.

## Open questions

None. The design is fully constrained by the audit findings and the brainstorming decisions.
