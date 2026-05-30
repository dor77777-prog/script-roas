// dashboard-web/src/lib/audit/__tests__/reconcileHotMetricsVsHeavy.live.test.ts
//
// AUDIT_LIVE=1 npm run audit:reconcile:hot-vs-heavy
//
// Phase C.5 canary harness. Compares the hot-metrics writes (Phase C
// google-worker / tiktok-worker / meta-worker hot_metrics branches) against
// the legacy cron-live-heavy + cron-daily writes, and runs a handful of
// integrity assertions on the underlying tables.
//
// All pure logic lives in `src/lib/audit/hotVsHeavy.ts` and has its own
// always-on unit tests (`__tests__/hotVsHeavy.test.ts`); the harness here
// only orchestrates the SELECTs and asserts the result.

import { describe, expect, it } from 'vitest';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import {
  aggregateByCampaign,
  detectDrift,
  type DailyRow,
  type DriftTolerances,
} from '@/lib/audit/hotVsHeavy';

const RUN = process.env.AUDIT_LIVE === '1';
const TOL: DriftTolerances = {
  spend: { absTol: 1, pctTol: 0.01 },   // 1% relative OR $1 absolute
  metric: { absTol: 1, pctTol: 0.02 },  // 2% relative OR 1-unit absolute (counts)
};

const DAILY_COLS = 'store_id, platform, campaign_id, ad_set_id, source, spend_cad, impressions, clicks, conversions, conversion_value_cad';

async function fetchDailyRows(date: string): Promise<DailyRow[]> {
  const sb = getSupabaseAdmin();
  const { data } = await sb.from('campaigns_daily').select(DAILY_COLS).eq('date', date);
  return (data ?? []) as DailyRow[];
}

(RUN ? describe : describe.skip)('Phase C.5 reconcile + integrity', () => {
  const today = new Date().toISOString().slice(0, 10);
  const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);

  for (const date of [today, yesterday]) {
    it(`agrees within tolerance on all 5 metrics for ${date}`, async () => {
      const rows = await fetchDailyRows(date);
      const aggregated = aggregateByCampaign(rows);
      const report = detectDrift(aggregated, TOL, date);

      // Informational coverage stats — useful for diagnosing canary
      // divergence (e.g. "Phase C wrote N campaigns the heavy path didn't
      // see yet"). Don't fail on these because the canary period is
      // expected to have one-sided rows while the rollout settles.
      console.warn(
        `[reconcile ${date}] both=${report.bothCount}` +
          ` onlyLive=${report.onlyLive.length}` +
          ` onlyHeavy=${report.onlyHeavy.length}`,
      );
      if (report.onlyLive.length > 0) {
        console.warn(
          `[reconcile ${date}] onlyLive sample:\n` +
            report.onlyLive.slice(0, 5).map(t => `  ${t.platform} ${t.store} ${t.campaign_id}`).join('\n'),
        );
      }
      if (report.onlyHeavy.length > 0) {
        console.warn(
          `[reconcile ${date}] onlyHeavy sample:\n` +
            report.onlyHeavy.slice(0, 5).map(t => `  ${t.platform} ${t.store} ${t.campaign_id}`).join('\n'),
        );
      }

      if (report.drifts.length > 0) {
        console.warn(
          `[reconcile ${date}] drift in ${report.drifts.length} metric-lines:\n` +
            report.drifts.slice(0, 20).join('\n'),
        );
      }
      expect(report.drifts).toEqual([]);
    });
  }

  it('data_freshness is fully green (no error / auth_error / parse_error rows)', async () => {
    // Every (store, platform, scope) combo must end the tick in a healthy
    // state. Phase C soak's try/catch wrap records `transient_error` rows
    // for genuine failures — those would surface here BEFORE the operator
    // notices via /operator. budget_skip is acceptable (Meta BUC).
    const sb = getSupabaseAdmin();
    const { data } = await sb
      .from('data_freshness')
      .select('store_id, platform, scope, status, error_message')
      .not('status', 'in', '("success","budget_skip")');
    const errors = (data ?? []) as Array<{ store_id: string; platform: string; scope: string; status: string; error_message: string | null }>;
    if (errors.length > 0) {
      console.warn(
        `[data_freshness] ${errors.length} non-success rows:\n` +
          errors.slice(0, 10).map(e => `  ${e.platform} ${e.store_id} ${e.scope}=${e.status}: ${(e.error_message ?? '').slice(0, 80)}`).join('\n'),
      );
    }
    expect(errors.map(e => `${e.platform}/${e.store_id}/${e.scope}:${e.status}`)).toEqual([]);
  });

  it('campaign_registry: every configured (platform, store) combo has at least one row', async () => {
    // After Phase C status discovery should have populated registry rows
    // for the stores that own their own ad accounts on each platform.
    // Meta: all 3 stores. Google: only uzoshop. TikTok: only uzoshop runs
    // the worker; usmile360 + zolplus get tenant rows via the Phase A.5 v2
    // campaign-store-map but they're written under those tenant store_ids
    // by uzoshop's worker. Empty registry for a configured combo means
    // status discovery hasn't completed — usually a sign that the worker
    // is failing silently.
    const sb = getSupabaseAdmin();
    // Supabase JS doesn't expose a clean SQL `GROUP BY` over `.select(...)`,
    // so we fetch the (platform, store_id) tuples and reduce client-side.
    // campaign_registry is small (~76 rows in production today) so a full
    // fetch is cheap.
    const { data } = await sb
      .from('campaign_registry')
      .select('platform, store_id');
    const rows = (data ?? []) as Array<{ platform: string; store_id: string }>;
    const seen = new Set(rows.map(r => `${r.platform}/${r.store_id}`));

    const required: Array<{ platform: string; store_id: string; rationale: string }> = [
      { platform: 'meta', store_id: 'uzoshop',   rationale: 'each store has its own Meta account' },
      { platform: 'meta', store_id: 'zolplus',   rationale: 'each store has its own Meta account' },
      { platform: 'meta', store_id: 'usmile360', rationale: 'each store has its own Meta account' },
      { platform: 'google', store_id: 'uzoshop', rationale: 'only uzoshop has Google today (ARCHITECTURE §5.3)' },
      { platform: 'tiktok', store_id: 'uzoshop', rationale: 'uzoshop owns the shared TikTok advertiser (ARCHITECTURE §5.4)' },
    ];
    const missing = required.filter(r => !seen.has(`${r.platform}/${r.store_id}`));
    if (missing.length > 0) {
      console.warn(`[campaign_registry] missing required combos:\n` + missing.map(m => `  ${m.platform}/${m.store_id} — ${m.rationale}`).join('\n'));
    }
    expect(missing.map(m => `${m.platform}/${m.store_id}`)).toEqual([]);
  });
});
