// dashboard-web/src/lib/audit/__tests__/registryCoverageParity.live.test.ts
//
// AUDIT_LIVE=1 npm run audit:reconcile:hot-vs-heavy
//
// Phase D — verifies the acceptance criterion that triggers + backfill
// keep the 3 dailies in coverage parity with the 3 registries.
//
// Distinct-tuple coverage: every (store, platform, campaign_id) present
// in campaigns_daily has a row in campaign_registry. Same for adsets
// (sourced from campaigns_daily, which is ad-set-granular per its PK)
// and ads (sourced from ads_daily). Tolerates registry having EXTRA
// rows (campaigns that retired before any daily activity — registry
// still has the row from status discovery).

import { describe, expect, it } from 'vitest';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';

const RUN = process.env.AUDIT_LIVE === '1';

(RUN ? describe : describe.skip)('Phase D coverage parity (registry ⊇ dailies)', () => {
  it('every campaigns_daily campaign has a campaign_registry row', async () => {
    const sb = getSupabaseAdmin();
    const [{ data: daily }, { data: registry }] = await Promise.all([
      sb.from('campaigns_daily').select('store_id, platform, campaign_id'),
      sb.from('campaign_registry').select('store_id, platform, campaign_id'),
    ]);
    const dailyKeys = new Set(
      (daily ?? []).map(r => `${r.store_id}/${r.platform}/${r.campaign_id}`),
    );
    const registryKeys = new Set(
      (registry ?? []).map(r => `${r.store_id}/${r.platform}/${r.campaign_id}`),
    );
    const missing: string[] = [];
    for (const k of dailyKeys) if (!registryKeys.has(k)) missing.push(k);
    if (missing.length > 0) {
      console.warn(`[coverage] missing campaign_registry rows for ${missing.length} tuples:\n` +
        missing.slice(0, 10).map(m => `  ${m}`).join('\n'));
    }
    expect(missing).toEqual([]);
  });

  it('every campaigns_daily ad_set has an adset_registry row', async () => {
    // adset-level coverage is derived from campaigns_daily, since there is
    // no separate adsets_daily table — campaigns_daily PK includes ad_set_id.
    const sb = getSupabaseAdmin();
    const [{ data: daily }, { data: registry }] = await Promise.all([
      sb.from('campaigns_daily').select('store_id, platform, ad_set_id'),
      sb.from('adset_registry').select('store_id, platform, adset_id'),
    ]);
    const dailyKeys = new Set(
      (daily ?? []).map(r => `${r.store_id}/${r.platform}/${r.ad_set_id}`),
    );
    const registryKeys = new Set(
      (registry ?? []).map(r => `${r.store_id}/${r.platform}/${r.adset_id}`),
    );
    const missing: string[] = [];
    for (const k of dailyKeys) if (!registryKeys.has(k)) missing.push(k);
    if (missing.length > 0) {
      console.warn(`[coverage] missing adset_registry rows for ${missing.length} tuples:\n` +
        missing.slice(0, 10).map(m => `  ${m}`).join('\n'));
    }
    expect(missing).toEqual([]);
  });

  it('every ads_daily ad has an ad_registry row', async () => {
    const sb = getSupabaseAdmin();
    const [{ data: daily }, { data: registry }] = await Promise.all([
      sb.from('ads_daily').select('store_id, platform, ad_id'),
      sb.from('ad_registry').select('store_id, platform, ad_id'),
    ]);
    const dailyKeys = new Set(
      (daily ?? []).map(r => `${r.store_id}/${r.platform}/${r.ad_id}`),
    );
    const registryKeys = new Set(
      (registry ?? []).map(r => `${r.store_id}/${r.platform}/${r.ad_id}`),
    );
    const missing: string[] = [];
    for (const k of dailyKeys) if (!registryKeys.has(k)) missing.push(k);
    if (missing.length > 0) {
      console.warn(`[coverage] missing ad_registry rows for ${missing.length} tuples:\n` +
        missing.slice(0, 10).map(m => `  ${m}`).join('\n'));
    }
    expect(missing).toEqual([]);
  });

  it('campaigns_enriched VIEW returns reg_* on at least 1 row from today', async () => {
    const sb = getSupabaseAdmin();
    const today = new Date().toISOString().slice(0, 10);
    const { data } = await sb
      .from('campaigns_enriched')
      .select('store_id, platform, campaign_id, reg_effective_status, reg_delivery_status')
      .eq('date', today)
      .limit(5);
    const rows = (data ?? []) as Array<{
      reg_effective_status: string | null;
      reg_delivery_status: string | null;
    }>;
    if (rows.length === 0) {
      console.warn(`[coverage] campaigns_enriched returned 0 rows for ${today} — no spend today yet`);
      return; // not a failure — no spend today
    }
    const haveReg = rows.filter(r => r.reg_effective_status !== null).length;
    expect(haveReg).toBeGreaterThan(0);
  });
});
