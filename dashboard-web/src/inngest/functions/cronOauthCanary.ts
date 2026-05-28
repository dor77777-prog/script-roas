// dashboard-web/src/inngest/functions/cronOauthCanary.ts
//
// Phase 13.4 — daily token canary at 00:00 IL.
// Phase 14   — expanded from Google-only to all rotating-token platforms.
//
// Why a canary: every cron-daily depends on live OAuth/access tokens for
// Meta, Google, and TikTok. If a token expires (Google 7-day refresh in
// Testing mode, Meta 60-day rotation, TikTok 60-day rotation) the next
// 00:05 cron-daily fails silently from the operator's perspective until
// a WhatsApp alert (or zero-revenue chart the next morning). The canary
// runs 5 min earlier, hits each platform with the lightest read it has
// (single API call, no DB write), and on failure calls notifyTokenFailure
// (built-in 1/6h throttle + WhatsApp template) so the operator wakes up
// to a precise "Meta/uzoshop token failed" alert instead of debugging
// from missing data.
//
// Why per-(platform, store) step.run: each check is independent. A Meta
// failure for one store must NOT abort the Google check or the TikTok
// check. Each step.run catches its own error, fires the alert, and
// returns a status flag — the function ALWAYS resolves with the full
// summary so Inngest doesn't dead-letter the whole run on a single
// expected failure.
//
// Why not Shopify: Shopify Admin API tokens are long-lived custom-app
// tokens that don't auto-rotate. They fail only on explicit revocation
// (rare). The existing cron-daily already surfaces Shopify auth errors
// via notifyTokenFailure on the first failed fetch.

import { inngest } from '@/inngest/client';
import { fetchGoogleAdsSpendForDay } from '@/lib/fetchers/googleAds';
import { fetchMetaSpendForDayLight } from '@/lib/fetchers/meta';
import { fetchTikTokAdvertiserInfo } from '@/lib/fetchers/tiktok';
import { captureStepError } from '@/lib/sentry/capture';
import { notifyTokenFailure } from '@/lib/notifications/tokenFailures';

type CanaryStore = 'uzoshop' | 'zolplus' | 'usmile360';
type CanaryProvider = 'google' | 'meta' | 'tiktok';

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

/**
 * Run a single platform/store check inside its own step.run. On failure,
 * fire notifyTokenFailure (throttled WhatsApp alert) + captureStepError
 * (Sentry) and return { ok: false } — do NOT throw. The caller aggregates
 * results so one failure doesn't abort sibling checks.
 */
type CheckResult = { provider: CanaryProvider; storeId: CanaryStore; ok: boolean; error?: string };

// Inngest's step.run returns Promise<Jsonify<T>> rather than Promise<T>; we
// keep our helper's step param structurally loose (run takes id+fn, returns
// unknown) and cast the result back. The structural fit means real Inngest
// step objects AND the in-memory test stub both satisfy this signature.
async function runCheck(
  step: { run: (id: string, fn: () => Promise<CheckResult>) => Promise<unknown> },
  spec: {
    provider: CanaryProvider;
    storeId: CanaryStore;
    advice: string;
    probe: () => Promise<unknown>;
  },
): Promise<CheckResult> {
  const stepName = `check-${spec.provider}-${spec.storeId}`;
  const out = await step.run(stepName, async (): Promise<CheckResult> => {
    try {
      await spec.probe();
      return { provider: spec.provider, storeId: spec.storeId, ok: true };
    } catch (e) {
      const errorMsg = e instanceof Error ? e.message : String(e);
      captureStepError(
        { fnId: 'cron-oauth-canary', stepName, storeId: spec.storeId },
        e,
      );
      await notifyTokenFailure({
        provider: spec.provider,
        storeId: spec.storeId,
        operation: 'canary',
        errorMsg,
        advice: spec.advice,
      });
      return { provider: spec.provider, storeId: spec.storeId, ok: false, error: errorMsg };
    }
  });
  return out as CheckResult;
}

export const cronOauthCanary = inngest.createFunction(
  {
    id: 'cron-oauth-canary',
    triggers: [{ cron: 'TZ=Asia/Jerusalem 0 0 * * *' }],
  },
  async ({ step }) => {
    const yesterday = yesterdayInIsrael();

    // 5 checks total: Google×1 + Meta×3 + TikTok×1.
    // Order: cheapest / most-likely-to-fail first.
    const checks: Array<Promise<{ provider: CanaryProvider; storeId: CanaryStore; ok: boolean; error?: string }>> = [
      // Google — historically the 7-day-expiry trap (now permanent if the
      // OAuth consent screen is published, but kept for defense-in-depth).
      runCheck(step, {
        provider: 'google',
        storeId: 'uzoshop',
        advice: 'Re-mint GOOGLEADS_REFRESH_TOKEN via OAuth Playground + update Vercel env + redeploy.',
        probe: () => fetchGoogleAdsSpendForDay('uzoshop', yesterday),
      }),
      // Meta — 60-day rotating access tokens, one per store.
      ...(['uzoshop', 'zolplus', 'usmile360'] as const).map((storeId) =>
        runCheck(step, {
          provider: 'meta',
          storeId,
          advice: `Refresh META_ACCESS_TOKEN_${storeId.toUpperCase()} via Meta Business Manager + update Vercel env + redeploy.`,
          probe: () => fetchMetaSpendForDayLight(storeId, yesterday),
        }),
      ),
      // TikTok — uzoshop-only per STORES_WITH_TIKTOK_IDS.
      runCheck(step, {
        provider: 'tiktok',
        storeId: 'uzoshop',
        advice: 'Refresh TIKTOK_ACCESS_TOKEN_UZOSHOP in TikTok Marketing Business + update Vercel env + redeploy.',
        probe: () => fetchTikTokAdvertiserInfo('uzoshop'),
      }),
    ];

    const results = await Promise.all(checks);
    const failed = results.filter((r) => !r.ok);
    return {
      status: failed.length === 0 ? 'ok' : 'partial',
      checks: results.length,
      passed: results.length - failed.length,
      failed: failed.map((r) => `${r.provider}/${r.storeId}`),
    };
  },
);
