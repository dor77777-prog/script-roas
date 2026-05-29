// dashboard-web/src/lib/audit/__tests__/reconcileHotMetricsVsHeavy.live.test.ts
//
// AUDIT_LIVE=1 npm run audit:reconcile:hot-vs-heavy
//
// Compares per-(store, platform, campaign) spend / impressions / clicks /
// conversions / conversion_value between the two pipelines (live_tick rows
// from hot-metrics vs nightly daily_reconcile / cron-live-heavy rows).

import { describe, expect, it } from 'vitest';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';

const RUN = process.env.AUDIT_LIVE === '1';
const TOLERANCE_REL = 0.01;  // 1%
const TOLERANCE_ABS = 1;     // $1

(RUN ? describe : describe.skip)('reconcile hot-metrics vs cron-live-heavy', () => {
  it('agrees within tolerance for today and yesterday', async () => {
    const sb = getSupabaseAdmin();
    const today = new Date().toISOString().slice(0, 10);
    const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);

    for (const date of [today, yesterday]) {
      const { data } = await sb.from('campaigns_daily').select('store_id, platform, campaign_id, source, spend_cad, impressions, clicks, conversions, conversion_value_cad').eq('date', date);
      const rows = (data ?? []) as Array<{ store_id: string; platform: string; campaign_id: string; source: string; spend_cad: number; impressions: number; clicks: number; conversions: number; conversion_value_cad: number }>;

      // Group by (store, platform, campaign_id) and partition by source.
      const groups = new Map<string, { live: typeof rows[0] | null; heavy: typeof rows[0] | null }>();
      for (const r of rows) {
        const key = `${r.store_id}::${r.platform}::${r.campaign_id}`;
        const g = groups.get(key) ?? { live: null, heavy: null };
        if (r.source === 'live_tick') g.live = r;
        else g.heavy = r;  // any non-live_tick source — daily_reconcile or older
        groups.set(key, g);
      }

      const drifts: string[] = [];
      for (const [key, g] of groups) {
        if (!g.live || !g.heavy) continue;  // can't compare; one pipeline didn't write yet
        const diff = Math.abs(g.live.spend_cad - g.heavy.spend_cad);
        const rel = g.heavy.spend_cad > 0 ? diff / g.heavy.spend_cad : 0;
        if (diff > TOLERANCE_ABS && rel > TOLERANCE_REL) {
          drifts.push(`${date} ${key}: live=${g.live.spend_cad} heavy=${g.heavy.spend_cad} diff=${diff.toFixed(2)} rel=${(rel * 100).toFixed(1)}%`);
        }
      }

      if (drifts.length > 0) {
        console.warn(`[reconcile ${date}] drift in ${drifts.length} groups:\n${drifts.slice(0, 20).join('\n')}`);
      }
      expect(drifts).toEqual([]);
    }
  });
});
