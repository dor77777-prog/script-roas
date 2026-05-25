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
  opts: { fnId: string; stepName: string; storeId?: string; fingerprint?: string[] },
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
    ...(opts.fingerprint ? { fingerprint: opts.fingerprint } : {}),
    ...(extra ? { extra } : {}),
  });
}

export async function captureCronFetchError(
  opts: {
    storeId: 'uzoshop' | 'zolplus' | 'usmile360';
    platform: 'meta' | 'google' | 'tiktok' | 'shopify';
    dedup: Set<string>;
    // Phase 13.2.3 — when true (high-cadence callers like cron-live),
    // capture to Sentry with a stable fingerprint (groups all events of
    // the same (platform, storeId) into ONE Sentry issue) and SKIP the
    // notifyTokenFailure WhatsApp send. WhatsApp throttling is 1/6h
    // which still floods at 15-min cadence × 9 issues; auth errors keep
    // their own notifyTokenFailure path in the caller's catch block.
    quietWhatsapp?: boolean;
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
    // Stable fingerprint groups all 96 daily failures of (platform, store)
    // into ONE Sentry issue. Cron-daily callers (1/day) get the same
    // grouping for free; cron-live callers (96/day) benefit most.
    fingerprint: ['inngest-fetcher', opts.platform, opts.storeId],
  });
  const key = `${opts.platform}:${opts.storeId}`;
  if (opts.dedup.has(key)) return;
  opts.dedup.add(key);
  if (opts.quietWhatsapp) return;
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
