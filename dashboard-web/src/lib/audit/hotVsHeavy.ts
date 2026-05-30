// dashboard-web/src/lib/audit/hotVsHeavy.ts
//
// Pure-function core of the Phase C.5 reconcile harness. Extracted from
// reconcileHotMetricsVsHeavy.live.test.ts so the aggregation + drift logic
// can be unit-tested without hitting Supabase (the live harness still
// orchestrates the SELECT and asserts the result).
//
// Background: the original harness compared per-(store, platform,
// campaign_id) spend by overwriting `g.live`/`g.heavy` for each row. The
// campaigns_daily PK is `(date, store_id, platform, campaign_id, ad_set_id)`
// so campaigns with multiple ad_sets produced multiple rows; only the LAST
// row's metrics survived → silent false drift on any multi-adset campaign.
// This module aggregates over ad_sets per (campaign, source) before
// comparison, and extends the comparison from spend-only to all 5 metrics
// the workers write (spend / impressions / clicks / conversions /
// conversion_value).

import { withinTolerance } from './reconcile';

export type DailyRow = {
  store_id: string;
  platform: string;
  campaign_id: string;
  ad_set_id: string | null;
  source: string;
  spend_cad: number | null;
  impressions: number | null;
  clicks: number | null;
  conversions: number | null;
  conversion_value_cad: number | null;
};

export type CampaignTotals = {
  spend_cad: number;
  impressions: number;
  clicks: number;
  conversions: number;
  conversion_value_cad: number;
};

export type SourceLabel = 'live' | 'heavy';

/**
 * Today's `cron-live-heavy` AND Phase C `hot_metrics` workers both write
 * `source='live_tick'`; cron-daily's nightly authoritative pass writes
 * `source='daily_reconcile'` (and pre-Phase-A rows have other historical
 * values). For Phase C.5 we collapse all non-live_tick sources into
 * `heavy` — the day-after reconcile is the only meaningful comparison
 * baseline today.
 */
export function classifySource(source: string): SourceLabel {
  return source === 'live_tick' ? 'live' : 'heavy';
}

export function aggregateByCampaign(rows: DailyRow[]): Map<string, CampaignTotals> {
  const out = new Map<string, CampaignTotals>();
  for (const r of rows) {
    const key = `${r.store_id}::${r.platform}::${r.campaign_id}::${classifySource(r.source)}`;
    const existing = out.get(key) ?? makeZeroTotals();
    existing.spend_cad += Number(r.spend_cad ?? 0);
    existing.impressions += Number(r.impressions ?? 0);
    existing.clicks += Number(r.clicks ?? 0);
    existing.conversions += Number(r.conversions ?? 0);
    existing.conversion_value_cad += Number(r.conversion_value_cad ?? 0);
    out.set(key, existing);
  }
  return out;
}

function makeZeroTotals(): CampaignTotals {
  return { spend_cad: 0, impressions: 0, clicks: 0, conversions: 0, conversion_value_cad: 0 };
}

export type CampaignTriple = { store: string; platform: string; campaign_id: string };

export type DriftReport = {
  /** Human-readable drift lines (one per failing metric per campaign). */
  drifts: string[];
  /** Campaigns where only the live partition has data — Phase C wrote, cron-live-heavy / daily_reconcile didn't (or vice versa per partition). */
  onlyLive: CampaignTriple[];
  /** Campaigns where only the heavy partition has data. */
  onlyHeavy: CampaignTriple[];
  /** Campaigns where both partitions have data and were compared. */
  bothCount: number;
};

export type DriftTolerances = {
  spend: { absTol: number; pctTol: number };
  metric: { absTol: number; pctTol: number };
};

/**
 * Compare each (campaign, source) aggregation against its sibling under the
 * same campaign id. Emits one drift line per failing metric. Tolerances are
 * decoupled per metric class because spend is dollar-denominated (we care
 * about $1 absolute floors) and counts (impressions, clicks) are unit-less
 * but noisier.
 */
export function detectDrift(
  aggregated: Map<string, CampaignTotals>,
  tolerances: DriftTolerances,
  dateLabel: string,
): DriftReport {
  const paired = new Map<string, { live?: CampaignTotals; heavy?: CampaignTotals }>();
  for (const [key, totals] of aggregated) {
    const parts = key.split('::');
    const triple = `${parts[0]}::${parts[1]}::${parts[2]}`;
    const source = parts[3] as SourceLabel;
    const p = paired.get(triple) ?? {};
    p[source] = totals;
    paired.set(triple, p);
  }

  const drifts: string[] = [];
  const onlyLive: CampaignTriple[] = [];
  const onlyHeavy: CampaignTriple[] = [];
  let bothCount = 0;

  const tripleToObj = (triple: string): CampaignTriple => {
    const [store, platform, campaign_id] = triple.split('::');
    return { store, platform, campaign_id };
  };

  for (const [triple, { live, heavy }] of paired) {
    if (live && !heavy) {
      onlyLive.push(tripleToObj(triple));
      continue;
    }
    if (heavy && !live) {
      onlyHeavy.push(tripleToObj(triple));
      continue;
    }
    if (!live || !heavy) continue; // both undefined → skip; map invariant guarantees at least one
    bothCount++;

    const check = (
      name: keyof CampaignTotals,
      tol: { absTol: number; pctTol: number },
    ): void => {
      if (withinTolerance(live[name], heavy[name], tol)) return;
      const liveStr = live[name].toFixed(2);
      const heavyStr = heavy[name].toFixed(2);
      drifts.push(`${dateLabel} ${triple} ${name}: live=${liveStr} heavy=${heavyStr}`);
    };

    check('spend_cad', tolerances.spend);
    check('impressions', tolerances.metric);
    check('clicks', tolerances.metric);
    check('conversions', tolerances.metric);
    check('conversion_value_cad', tolerances.spend);
  }

  return { drifts, onlyLive, onlyHeavy, bothCount };
}
