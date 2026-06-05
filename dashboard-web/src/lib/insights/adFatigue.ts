/**
 * detectAdFatigue — base creative-fatigue rule (CTR + CPM only).
 *
 * Pure, deterministic, no network / no DB / no React. Given per-day AdRow
 * rows (the same shape `/api/ads` returns), it splits each ad's date window
 * into a prior half and a recent half and flags ads whose recent half shows
 * BOTH a meaningful CTR drop AND a meaningful CPM rise — the classic signature
 * of an ad whose audience has saturated (the creative is being shown more
 * often to the same people, costing more per impression while engaging fewer).
 *
 * Emitted shape mirrors `generateRecommendations` in `lib/insights.ts` exactly:
 *   severity 'opportunity', kind 'recommendation', a Hebrew title/detail/why,
 *   an Ads-Manager `href`, and the structured campaign reference
 *   (campaignId / campaignName / platform / storeId) so `InsightActions` can
 *   render the "פתח קמפיין" + "פתח ב-Ads Manager" pair. Note: the ad lives
 *   under a campaign, so we carry the PARENT campaignId — the drawer + link
 *   resolve at the campaign level.
 *
 * `freqNote` is populated when reach data is present on both halves
 * (Meta/TikTok). It appends a relative frequency-trend sentence to `detail`.
 *
 * Thresholds / gating (all CONJUNCTIONS where stated):
 *   - >= 12 unique dates per ad (>= 6 per half) — else skip.
 *   - (priorImpr + recentImpr) >= 5000 noise floor — else skip.
 *   - priorImpr > 0, recentImpr > 0, priorCtr > 0, priorCpm > 0 — else skip
 *     (divide-by-zero guard).
 *   - Flag IFF recentCtr <= 0.7*priorCtr AND recentCpm >= 1.2*priorCpm.
 */
import type { Insight } from '../insights';
import type { AdRow } from '../ads';
import { fmtMoneyString } from '../format';
import { adsManagerLink } from './adsManagerLink';

type AdGroup = {
  adId: string;
  adName: string;
  campaignId: string;
  campaignName: string;
  platform: string;
  storeId: string;
  storeName: string;
  rows: AdRow[];
};

type HalfAgg = { impr: number; clicks: number; spend: number; reach: number };

function aggregateHalf(rows: AdRow[], dates: Set<string>): HalfAgg {
  const agg: HalfAgg = { impr: 0, clicks: 0, spend: 0, reach: 0 };
  for (const r of rows) {
    if (!dates.has(r.date)) continue;
    agg.impr += r.impressions;
    agg.clicks += r.clicks;
    agg.spend += r.spend;
    agg.reach += r.reach ?? 0;
  }
  return agg;
}

function groupAds(ads: AdRow[]): Map<string, AdGroup> {
  const groups = new Map<string, AdGroup>();
  for (const a of ads) {
    const key = `${a.storeId}::${a.platform}::${a.adId}`;
    let g = groups.get(key);
    if (!g) {
      g = {
        adId: a.adId,
        adName: a.adName,
        campaignId: a.campaignId,
        campaignName: a.campaignName,
        platform: a.platform,
        storeId: a.storeId,
        storeName: a.storeName,
        rows: [],
      };
      groups.set(key, g);
    }
    g.rows.push(a);
  }
  return groups;
}

/** Split an ad's rows into prior/recent half-aggregates, or null if too few
 *  unique dates (>=12 total, >=6 per half). Shared by both fatigue detectors. */
function splitHalves(rows: AdRow[]): { prior: HalfAgg; recent: HalfAgg } | null {
  const uniqueDates = Array.from(new Set(rows.map((r) => r.date))).sort();
  if (uniqueDates.length < 12) return null;
  const midIdx = Math.floor(uniqueDates.length / 2);
  const priorDates = uniqueDates.slice(0, midIdx);
  const recentDates = uniqueDates.slice(midIdx);
  if (priorDates.length < 6 || recentDates.length < 6) return null;
  return {
    prior: aggregateHalf(rows, new Set(priorDates)),
    recent: aggregateHalf(rows, new Set(recentDates)),
  };
}

export function detectAdFatigue(ads: AdRow[]): Insight[] {
  const insights: Insight[] = [];
  for (const g of groupAds(ads).values()) {
    const halves = splitHalves(g.rows);
    if (!halves) continue;
    const { prior, recent } = halves;
    if (prior.impr + recent.impr < 5000) continue;
    if (prior.impr <= 0 || recent.impr <= 0) continue;
    const priorCtr = prior.clicks / prior.impr;
    const recentCtr = recent.clicks / recent.impr;
    const priorCpm = (prior.spend / prior.impr) * 1000;
    const recentCpm = (recent.spend / recent.impr) * 1000;
    if (priorCtr <= 0 || priorCpm <= 0) continue;

    const ctrFatigued = recentCtr <= 0.7 * priorCtr;
    const cpmRising = recentCpm >= 1.2 * priorCpm;
    if (!ctrFatigued || !cpmRising) continue;

    const ctrDropPct = Math.round((1 - recentCtr / priorCtr) * 100);
    const cpmRisePct = Math.round((recentCpm / priorCpm - 1) * 100);

    // Frequency note — populated only when reach is present on both halves
    // (Meta/TikTok). Relative trend, never an absolute weekly-frequency claim.
    let freqNote = '';
    if (prior.reach > 0 && recent.reach > 0) {
      const priorFreq = prior.impr / prior.reach;
      const recentFreq = recent.impr / recent.reach;
      if (priorFreq > 0 && recentFreq > priorFreq) {
        freqNote = ` התדירות עלתה ${Math.round((recentFreq / priorFreq - 1) * 100)}%.`;
      }
    }

    insights.push({
      id: `fatigue-${g.adId}`,
      severity: 'opportunity',
      kind: 'recommendation',
      scope: `${g.platform} · ${g.storeName ?? ''}`,
      title: `עייפות קריאייטיב: ${g.adName || 'מודעה'}`,
      detail: `CTR ירד ${ctrDropPct}% ו-CPM עלה ${cpmRisePct}% בחצי האחרון. שקול לרענן קריאייטיב.${freqNote}`,
      why: `CTR ${(priorCtr * 100).toFixed(2)}%→${(recentCtr * 100).toFixed(2)}%, CPM ${fmtMoneyString(priorCpm)}→${fmtMoneyString(recentCpm)} (חציון לחצי).`,
      href: adsManagerLink(g.platform, g.campaignId) ?? undefined,
      weight: 68,
      // Carry the PARENT campaign so the drawer + Ads-Manager link resolve.
      campaignId: g.campaignId,
      campaignName: g.campaignName,
      platform: g.platform as Insight['platform'],
      storeId: g.storeId,
      storeName: g.storeName,
    });
  }
  return insights;
}
