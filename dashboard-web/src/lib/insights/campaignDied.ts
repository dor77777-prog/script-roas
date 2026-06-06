/**
 * detectCampaignDied — flags an ESTABLISHED ad campaign that suddenly went
 * dark (spend collapsed to ~0 on the most-recent completed day).
 *
 * Pure analytics — deterministic, no network, no DB, no React. Mirrors the
 * voice + structure of the rules in `lib/insights.ts` (Hebrew copy,
 * `Insight` shape, `campaignRef` + `adsManagerLink`, weight-sorted severity).
 *
 * Why a dedicated rule (vs the generic anomaly engine): a campaign dropping
 * to 0 spend is a binary cliff, not a statistical wobble — the median/MAD
 * z-score under-reacts to "stable-then-zero" because a single zero barely
 * moves a robust baseline. This rule encodes the operator's mental model
 * directly: "it was reliably spending real money, and now it's not."
 *
 * Current-day guard (mirrors the dead-day current-day suppression in
 * `insightsDeadDayCurrentDay.test.ts`): the CURRENT in-progress Israel day is
 * EXCLUDED from the "did it go dark?" read. The enriched live view drops
 * zero-activity rows and a still-loading morning legitimately shows 0 spend,
 * so we read the most-recent COMPLETED day (today-1) instead. A missing
 * today-1 row for an otherwise-active campaign is treated as spend = 0, NOT
 * "no data" (zero-activity rows are dropped upstream).
 *
 * We NEVER assert the cause as fact — the copy says "check budget / rejection
 * / tracking glitch", and only softens to "marked paused" when the live
 * effective-status map actually carries a paused/removed/archived status.
 */
import { fmtMoneyString } from '../format';
import { getTodayInIsraelTz } from '../dateRange';
import type { CampaignRow } from '../campaigns';
import type { Insight } from '../insights';
import { adsManagerLink } from './adsManagerLink';
import { isAdsEnabled, type AdStateMap, type AdPlatform } from '../adState';

/** Local copy of the date-shift helper used across the insights rules. */
function addDays(dateStr: string, n: number): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

type CurrentEffectiveStatusEntry = { status: string; updatedAt?: string };

type Group = {
  key: string;
  campaignId: string;
  campaignName: string;
  storeId: string;
  storeName: string;
  platform: string;
  /** date -> total spend on that date (summed across this group's rows). */
  spendByDate: Map<string, number>;
};

/**
 * Resolves the live effective-status for a group from `currentEffectiveStatus`.
 *
 * The real map (see `postgresReaders.fetchCurrentCampaignStatuses`) is keyed
 * ad-set-granular as `${storeId}::${Platform}::${campaignId}::${adSetId}`,
 * which does NOT match this rule's campaign-level group key
 * (`${storeName}::${platform}::${campaignId}`). So we try, in order:
 *   1. the exact group key (covers any caller that re-keys to our shape),
 *   2. the bare campaignId (covers a simple campaignId-keyed map),
 *   3. any entry whose key contains `::<campaignId>` (covers the real
 *      ad-set-granular shape — campaignId appears as a `::`-delimited segment).
 * Among substring matches we prefer the freshest `updatedAt`.
 */
function resolveStatus(
  group: Group,
  map: Record<string, CurrentEffectiveStatusEntry> | undefined,
): string | null {
  if (!map) return null;
  const direct = map[group.key] ?? map[group.campaignId];
  if (direct?.status) return direct.status;

  const needle = `::${group.campaignId}`;
  let best: CurrentEffectiveStatusEntry | null = null;
  for (const [k, v] of Object.entries(map)) {
    if (!v?.status) continue;
    // Match `::<id>::…` (ad-set-granular) or a key ENDING in `::<id>`.
    if (k.includes(`${needle}::`) || k.endsWith(needle)) {
      if (!best || (v.updatedAt ?? '') > (best.updatedAt ?? '')) best = v;
    }
  }
  return best?.status ?? null;
}

/**
 * @param campaigns               daily campaign rows (CAD spend per day).
 * @param currentEffectiveStatus  optional live status map (see resolveStatus).
 * @param today                   optional ISO yyyy-mm-dd seam for tests;
 *                                defaults to the real Israel-today helper.
 * @param adStateMap              optional ads-off state (Phase 4); groups whose
 *                                (storeId, platform) is off are skipped.
 */
export function detectCampaignDied(
  campaigns: CampaignRow[],
  currentEffectiveStatus?: Record<string, CurrentEffectiveStatusEntry>,
  today?: string,
  adStateMap: AdStateMap = {},
): Insight[] {
  const todayDate = today ?? getTodayInIsraelTz();
  const windowStart = addDays(todayDate, -13); // last 14 days, inclusive.
  const recentDay = addDays(todayDate, -1); // most-recent COMPLETED day.

  // 1+2. Group rows by store/platform/campaign, summing spend per date.
  const groups = new Map<string, Group>();
  for (const c of campaigns) {
    if (c.date < windowStart || c.date > todayDate) continue;
    const key = `${c.storeName}::${c.platform}::${c.campaignId}`;
    let g = groups.get(key);
    if (!g) {
      g = {
        key,
        campaignId: c.campaignId,
        campaignName: c.campaignName,
        storeId: c.storeId,
        storeName: c.storeName,
        platform: c.platform,
        spendByDate: new Map(),
      };
      groups.set(key, g);
    }
    g.spendByDate.set(c.date, (g.spendByDate.get(c.date) ?? 0) + (c.spend ?? 0));
  }

  const insights: Insight[] = [];

  for (const g of groups.values()) {
    // 3+4. Prior window = [today-13 .. today-1]. meanDaily over ONLY the
    //      prior-window days that actually spent (>0).
    let priorActiveDays = 0;
    let priorActiveSpend = 0;
    for (const [date, spend] of g.spendByDate) {
      if (date < windowStart || date > recentDay) continue; // excludes today.
      if (spend > 0) {
        priorActiveDays += 1;
        priorActiveSpend += spend;
      }
    }
    const meanDaily = priorActiveDays > 0 ? priorActiveSpend / priorActiveDays : 0;

    // 5. recentSpend = spend on today-1; a MISSING today-1 row → 0 (NOT no-data).
    const recentSpend = g.spendByDate.get(recentDay) ?? 0;

    // 6. Establishment gate AND dark gate.
    const established = priorActiveDays >= 7 && meanDaily >= 50;
    const wentDark = recentSpend <= 1;
    if (!established || !wentDark) continue;

    // Phase 4 — ads-off suppression: skip groups whose (storeId, platform) is off.
    // CampaignRow.platform is title-case ('Meta','Google','TikTok'); AdPlatform is
    // lowercase — normalise before the map lookup.
    if (!isAdsEnabled(adStateMap, g.storeId, g.platform.toLowerCase() as AdPlatform)) continue;

    // 8. Cause / status hint — never asserted as fact.
    const status = resolveStatus(g, currentEffectiveStatus);
    const isOff = !!status && /PAUSED|REMOVED|ARCHIVED/i.test(status);
    const causeHint = isOff
      ? `הקמפיין מסומן «מושהה» ב-${g.platform} — ודא אם זה מכוון.`
      : 'בדוק תקציב/דחייה/תקלת-מעקב.';
    const statusHint = isOff ? 'הסטטוס הנוכחי: «מושהה».' : '';

    const name = g.campaignName || 'קמפיין';

    // 7. Emit.
    insights.push({
      id: `died-${g.campaignId}`,
      severity: 'critical',
      kind: 'anomaly',
      title: `${name} כבה — מ-${fmtMoneyString(meanDaily)}/יום ל-0`,
      detail: `הוציא בממוצע ${fmtMoneyString(meanDaily)} ליום ב-${priorActiveDays} ימים, והיום ${fmtMoneyString(recentSpend)}. ${causeHint}`,
      why: `קמפיין מבוסס (${priorActiveDays} ימי פעילות, ממוצע ${fmtMoneyString(meanDaily)}/יום) שירד פתאום ל-0 — סימן אדום לרווח אבוד. ${statusHint}`,
      href: adsManagerLink(g.platform, g.campaignId) ?? undefined,
      scope: `${g.platform} · ${g.storeName}`,
      weight: 96,
      campaignId: g.campaignId,
      campaignName: g.campaignName,
      platform: g.platform as Insight['platform'],
      storeId: g.storeId,
      storeName: g.storeName,
    });
  }

  return insights.sort((a, b) => b.weight - a.weight);
}
