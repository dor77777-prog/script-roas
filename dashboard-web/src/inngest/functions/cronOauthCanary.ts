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
