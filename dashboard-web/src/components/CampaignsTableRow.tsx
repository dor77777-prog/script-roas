'use client';

import { Fragment } from 'react';
import { CheckCircle2, Circle, ExternalLink } from 'lucide-react';
import { cn, formatCurrency, formatNumber } from '@/lib/utils';
import { campaignKey } from '@/lib/campaignProductMap';
import { buildAdsManagerLink, type AdAccountMap } from '@/lib/campaignsLinks';
import { roasLabel } from '@/lib/analytics';
import type { Aggregated } from '@/lib/campaignsAggregator';
import type { ConfidenceLevel, TrueRevenueInfo } from '@/lib/hooks/useCampaignTrueRevenue';
import type { AttributionTrust } from '@/lib/attributionAnalysis';
import type { CampaignHealth } from '@/lib/campaignHealthScore';
import type { DailyCpmRoasPoint } from '@/lib/cpmRoasAnalysis';
import { HealthScoreBadge } from './HealthScoreBadge';
import { Sparkline } from './ui/Sparkline';
import { CampaignFreshnessChip } from './CampaignFreshnessChip';

/**
 * The narrowed trust-level union actually used by CampaignsTableRow's
 * tone derivation. WR-02 (5.2.2.1): exported so TEST-07 can import the
 * production binding instead of redeclaring a parallel alias locally.
 *
 * 'unknown' is statically excluded — see the comment at the trustLevel
 * derivation site below (the !attrUnknown guard collapses the union to
 * 'high' | 'medium' | 'low' on both ternary branches).
 */
export type CampaignsTableRowTrustLevel =
  | ConfidenceLevel['level']
  | Exclude<AttributionTrust['level'], 'unknown'>;

/**
 * Pure helper that maps a narrowed trust level to a tailwind chip tone
 * class string. WR-02 (5.2.2.1): extracted into a top-level helper so
 * TEST-07 can import and assert against this exact function (was an
 * inline ternary ladder buried inside the JSX render IIFE; tests had to
 * redeclare the logic to assert it).
 *
 * The 'unknown' branch is intentionally not in the input union: callers
 * MUST narrow first. If a future caller has 'unknown' on hand, the
 * type-checker forces them to decide which fallback bucket it belongs
 * to before calling here.
 */
export function computeTrustTone(level: CampaignsTableRowTrustLevel): string {
  return level === 'high'   ? 'bg-status-greenBg/60 text-status-green'
       : level === 'medium' ? 'bg-amber-50 text-amber-700'
       :                      'bg-status-redBg/60 text-status-red';
}

// Duplicated from CampaignsTable.tsx:199-205 per D-04 (target-soft cap) —
// leaving this tiny lookup table colocated with the row that uses it
// avoids creating a wrapper module for 6 lines. Same 5-entry shape as
// the parent's copy + AdSetTable's copy (both are byte-identical).
const TONE_BG: Record<string, string> = {
  red:    'bg-status-redBg text-status-redFg',
  orange: 'bg-status-orangeBg text-status-orangeFg',
  green:  'bg-status-greenBg text-status-greenFg',
  blue:   'bg-status-blueBg text-status-blueFg',
  gray:   'bg-elevated2 text-ink',
};

type Props = {
  a: Aggregated;
  i: number;
  mode: 'campaign' | 'adset';
  trueRevenueByKey: Map<string, TrueRevenueInfo>;
  /**
   * Phase 05.7.x (2026-05-23) — set of campaignKeys that DO have at least
   * one product mapped. Used to render the "🏷️ לא ממופה" chip next to
   * the campaign name for Meta + TikTok campaigns that the operator
   * hasn't mapped yet. The chip persists until the operator opens the
   * drawer and assigns at least one product, then disappears
   * automatically (the parent re-derives this Set from productMap on
   * every render). Google campaigns never get this chip (Google
   * PMax/Shopping doesn't support per-campaign mapping).
   */
  mappedCampaignKeys: Set<string>;
  /**
   * Phase 05.7.x — pre-computed Campaign Health Score for this row.
   * Computed once in the parent (`CampaignsTable.tsx healthByKey` memo)
   * so each row doesn't repeat the per-campaign trajectory analysis.
   * Undefined when the parent hasn't built a score for this key yet
   * (still in initial render before `aggregated` settles).
   */
  health: CampaignHealth | undefined;
  /**
   * Phase 05.7.x — resolved order for the 15 reorderable metric columns
   * (spend / budget / conversionValue / roas / roasShopify /
   * roasShopifyPlatform / shopifyValuePlatform / shopifyUnitsPlatform /
   * shopifyValueTotal / shopifyUnitsTotal / conversions / ctr / cpc /
   * cpm / cpa). Computed once in the parent from CampaignsColumnPrefs
   * + resolveCampaignsColumnOrder, then threaded here so the row's
   * <td> order matches the thead order exactly (any drift would put
   * cells under the wrong columns).
   */
  columnOrder: string[];
  /**
   * Plan 4a Task 5 (2026-05-29) — pre-computed daily CPM/ROAS series for
   * this row, ordered ascending by date. Sourced from the parent's
   * `dailyByCampaign` Map (same memo that feeds the Health Score's
   * trajectory analysis), so each row gets its own series without
   * recomputing in the row. Renders as an inline ROAS Sparkline column
   * between the campaign name and the reorderable metric columns.
   *
   * Undefined when the parent has no series for this key yet (initial
   * render before SWR resolves) or when the series has < 2 points (not
   * visually meaningful) — the row renders an em-dash placeholder in
   * both cases.
   */
  dailySeries?: DailyCpmRoasPoint[];
  adAccounts: AdAccountMap;
  optimized: Set<string>;
  /**
   * FIX-26: today (Asia/Jerusalem) as YYYY-MM-DD. Used to decide whether
   * to render the "currently off" chip on rows whose last active day is
   * older than today − OFF_RECENCY_DAYS. Threaded as a prop so we compute
   * it once per render in the parent instead of per-row.
   */
  today: string;
  onToggleOptimized: (key: string) => void;
  onDrillCampaign: (campaignId: string, platform: string, storeId: string) => void;
  onDrillAd: (set: {
    storeId: string;
    campaignId: string;
    adSetId: string;
    adSetName: string;
    platform: 'Meta' | 'Google' | 'TikTok';
  }) => void;
};

/**
 * FIX-26: how many days of inactivity (zero spend) before a row is
 * considered "currently off". The 2-day buffer absorbs the in-flight
 * window between cron-daily (00:05 IL, materialises "today−1") and
 * cron-live (every 10 min IL, rolling 3-day refresh for "today").
 * A campaign that ran yesterday is almost certainly still active; a
 * campaign that hasn't run in 2+ days is the earliest point we can call
 * "paused" without false-positives from a between-ticks live cadence
 * gap or a delayed Meta/Google insights aggregation.
 *
 * Phase 11 (2026-05-25): comment originally referenced Apps Script
 * collection latency. The buffer was preserved on conversion because
 * the new Inngest pipeline has the same in-flight window shape (live
 * probe lags real-time by up to one 10-min tick, plus upstream insights
 * aggregate hourly). Revisit if cron-live proves reliable enough to
 * tighten to 1 day.
 */
export const OFF_RECENCY_DAYS = 2;

/**
 * FIX-26: returns true iff `lastActiveDate` is older than `today − OFF_RECENCY_DAYS`.
 * Lexicographic comparison on YYYY-MM-DD is correct here — both inputs are
 * canonical ISO date strings, so string comparison matches calendar order.
 *
 * Edge cases:
 *  - lastActiveDate === null  → false (not enough data to call it "off";
 *    the campaign shows in the table on impressions/conversions/value alone
 *    without any spend ever, which is rare and almost certainly stale data
 *    rather than a paused campaign).
 *  - today malformed          → false (fail-open, do not render the chip).
 */
export function isCampaignCurrentlyOff(lastActiveDate: string | null, today: string): boolean {
  if (!lastActiveDate) return false;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(today)) return false;
  const [yyyy, mm, dd] = today.split('-').map(Number);
  const todayMs = Date.UTC(yyyy, mm - 1, dd);
  const thresholdMs = todayMs - OFF_RECENCY_DAYS * 86400_000;
  const threshold = new Date(thresholdMs).toISOString().slice(0, 10);
  return lastActiveDate < threshold;
}

/**
 * OPERATOR-1 (audit v3, 2026-05-23): TikTok's ad-group status taxonomy
 * has FIVE distinct "off-ish" terminal/blocked states and FIVE distinct
 * "on-ish" delivering/preparing states. Pre-fix code treated any status
 * !== 'ADGROUP_STATUS_DELIVERY_OK' as OFF — which flipped active campaigns
 * to "כבוי" whenever TikTok temporarily reported BUDGET_EXCEED (very
 * common — fires whenever the daily budget caps mid-day, but the campaign
 * is still ACTIVE in TikTok Ads Manager), AUDIT / REVIEWING (the moderation
 * loop on new creatives), or NOT_START (a scheduled-to-start ad-group
 * that hasn't reached its start time yet).
 *
 * The operator reported (2026-05-23): "dashboard shows the campaign as
 * off but TikTok Ads Manager shows it as Active". The 5 status values
 * below were the culprits in production.
 *
 * Source: TikTok Business API `/adgroup/get/` `operation_status` field.
 * https://business-api.tiktok.com/portal/docs?id=1739561631127553
 *
 * Reference list (10 statuses total):
 *   Delivering / preparing (TIKTOK_ACTIVE_ENOUGH):
 *     ADGROUP_STATUS_DELIVERY_OK      — actively serving impressions
 *     ADGROUP_STATUS_BUDGET_EXCEED    — paused TODAY (daily cap); resumes tomorrow
 *     ADGROUP_STATUS_AUDIT            — under TikTok creative review (will deliver after approval)
 *     ADGROUP_STATUS_REVIEWING        — alternate spelling some endpoints return
 *     ADGROUP_STATUS_NOT_START        — scheduled, before start time
 *
 *   Truly off (TIKTOK_OFF_STATUSES):
 *     ADGROUP_STATUS_DISABLE          — operator manually paused
 *     ADGROUP_STATUS_TIMEDOUT         — past scheduled end date
 *     ADGROUP_STATUS_FROZEN           — TikTok policy-frozen
 *     ADGROUP_STATUS_ARCHIVED         — operator archived
 *     ADGROUP_STATUS_DELETE           — soft-deleted (still surfaces in some API responses)
 */
const TIKTOK_OFF_STATUSES = new Set([
  'ADGROUP_STATUS_DISABLE',
  'ADGROUP_STATUS_TIMEDOUT',
  'ADGROUP_STATUS_FROZEN',
  'ADGROUP_STATUS_ARCHIVED',
  'ADGROUP_STATUS_DELETE',
  // Phase 12.5.x (2026-05-24) — operator-reported: TikTok ad-groups under a
  // campaign-level pause report `ADGROUP_STATUS_CAMPAIGN_DISABLE` (parent
  // disabled) on every child. Previously this fell through to the date
  // heuristic and the off-chip didn't fire on operator-paused campaigns.
  'ADGROUP_STATUS_CAMPAIGN_DISABLE',
  // Parent / advertiser-level disable variants — same operator-visible
  // meaning ("campaign not delivering"). Added defensively so a future
  // advertiser-level freeze surfaces correctly.
  'ADGROUP_STATUS_ADVERTISER_AUDIT_DENY',
  'ADGROUP_STATUS_ADVERTISER_FROZEN',
  'ADGROUP_STATUS_ADVERTISER_BUDGET_EXCEED',
  'ADGROUP_STATUS_BALANCE_EXCEED',
  'ADGROUP_STATUS_AUDIT_DENY',
]);

const TIKTOK_ACTIVE_ENOUGH = new Set([
  'ADGROUP_STATUS_DELIVERY_OK',
  'ADGROUP_STATUS_BUDGET_EXCEED',
  'ADGROUP_STATUS_AUDIT',
  'ADGROUP_STATUS_REVIEWING',
  'ADGROUP_STATUS_NOT_START',
]);

/**
 * Phase 05.7.x — "is this campaign currently off?" using the platform's
 * real effective_status when available, falling back to FIX-26's date
 * heuristic when status is null (older data, status fetcher soft-failed,
 * or Sheets path).
 *
 * Active state per platform:
 *   Meta:   'ACTIVE'
 *   Google: 'ENABLED'
 *   TikTok: anything in TIKTOK_ACTIVE_ENOUGH (delivering / preparing) is ON;
 *           anything in TIKTOK_OFF_STATUSES (terminal / blocked) is OFF.
 *           See the TIKTOK_OFF_STATUSES JSDoc above for the operator-reported
 *           rationale (OPERATOR-1 audit fix 2026-05-23).
 *
 * This is the signal the dashboard's "כבוי" chip now consumes — replaces
 * the previous 2-day blanket buffer so a campaign paused 1 hour ago lights
 * up the chip on the next cron tick (or next manual refresh) instead of
 * waiting 2 full days for the heuristic to catch up.
 *
 * TikTok statuses that match NEITHER set (e.g. a future TikTok status
 * we don't know about yet) fall through to the date heuristic — fail-safe
 * default: rely on lastActiveDate rather than guessing how to interpret
 * an unmapped status (which could otherwise flip a live campaign to "off"
 * on a single bad classification).
 */
export function isCampaignOff(
  effectiveStatus: string | null,
  platform: string,
  lastActiveDate: string | null,
  today: string,
): boolean {
  if (effectiveStatus) {
    const norm = effectiveStatus.trim().toUpperCase();
    const platformNorm = (platform || '').toLowerCase();
    switch (platformNorm) {
      case 'meta':
        return norm !== 'ACTIVE';
      case 'google':
        return norm !== 'ENABLED';
      case 'tiktok':
        // Tiered classification (OPERATOR-1 audit fix 2026-05-23):
        // explicit OFF set → true; explicit ACTIVE-enough set → false;
        // anything else falls through to the date heuristic.
        if (TIKTOK_OFF_STATUSES.has(norm)) return true;
        if (TIKTOK_ACTIVE_ENOUGH.has(norm)) return false;
        break;
      default:
        // Unknown platform name — fall through to the date heuristic
        // rather than risk a false-positive on an unmapped status.
        break;
    }
  }
  return isCampaignCurrentlyOff(lastActiveDate, today);
}

/** Format YYYY-MM-DD as DD/MM for the off-chip tooltip text. */
function formatLastActiveDate(iso: string): string {
  return `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
}

export function CampaignsTableRow({
  a,
  i,
  mode,
  trueRevenueByKey,
  mappedCampaignKeys,
  health,
  columnOrder,
  dailySeries,
  adAccounts,
  optimized,
  today,
  onToggleOptimized,
  onDrillCampaign,
  onDrillAd,
}: Props) {
  // FIX-26: render a "currently off" chip when this row's last active day
  // is older than today − OFF_RECENCY_DAYS. The row still appears in the
  // table on the merits of its in-range performance — the chip only adds
  // a visual signal that the operator is looking at historical data.
  // Phase 05.7.x — prefer the platform's real effective_status; fall back
  // to FIX-26's lastActiveDate heuristic when status is unknown.
  const isCurrentlyOff = isCampaignOff(a.effectiveStatus, a.platform, a.lastActiveDate, today);
  const roas = a.spend > 0 ? a.conversionValue / a.spend : 0;
  const ctr = a.impressions > 0 ? a.clicks / a.impressions : 0;
  const cpc = a.clicks > 0 ? a.spend / a.clicks : 0;
  // CPM = cost per 1000 impressions. Meta's standard auction metric — what
  // you pay on average to be seen by 1000 people. spend / impressions * 1000.
  const cpm = a.impressions > 0 ? (a.spend / a.impressions) * 1000 : 0;
  const cpa = a.conversions > 0 ? a.spend / a.conversions : 0;
  const info = roasLabel(roas);
  const link = buildAdsManagerLink({
    platform: a.platform,
    storeId: a.storeId,
    campaignId: a.campaignId,
    adSetId: a.adSetId,
    accounts: adAccounts,
  });
  const isOptimized = optimized.has(a.key);
  return (
    <tr
      className={cn(
        'border-b border-line-subtle hover:bg-elevated2/40 cursor-pointer transition-opacity',
        // Marked rows visually retreat so the user's eye
        // anchors on the un-marked work-list. Hovering brings
        // them back to full opacity so re-reading details
        // (or unmarking) is easy.
        isOptimized && 'opacity-50 hover:opacity-100',
      )}
      onClick={() => {
        if (mode === 'campaign' && a.campaignId) {
          // Campaign click → ad-sets drawer.
          onDrillCampaign(a.campaignId, a.platform, a.storeId);
        } else if (
          mode === 'adset' &&
          a.adSetId &&
          (a.platform === 'Meta' || a.platform === 'TikTok')
        ) {
          // Ad-set click → drill deeper into individual ads.
          // Meta + TikTok have ad-level rows in ads_daily (Phase 05.6.1 +
          // 05.7.7). Google still excluded — PMax/Shopping ad-group fallback
          // doesn't surface individual ads in a meaningful way.
          onDrillAd({
            storeId: a.storeId,
            campaignId: a.campaignId,
            adSetId: a.adSetId,
            adSetName: a.adSetName || a.campaignName,
            platform: a.platform as 'Meta' | 'TikTok',
          });
        }
      }}
      title={
        mode === 'campaign'
          ? 'לחץ לפרטים מלאים'
          : mode === 'adset' && (a.platform === 'Meta' || a.platform === 'TikTok')
          ? 'לחץ לראות את המודעות באד-סט'
          : undefined
      }
    >
      {/* Per-row optimization toggle. Clicking flips the mark
          without bubbling into the row click (which would
          open the drawer). The empty Circle is the un-marked
          state; CheckCircle2 in green is the marked state. */}
      <td data-col-id="optimized" className="px-2 py-2 text-center w-[36px]">
        <button
          type="button"
          onClick={e => {
            e.stopPropagation();
            onToggleOptimized(a.key);
          }}
          className={cn(
            'inline-flex items-center justify-center w-7 h-7 rounded-full transition-colors',
            isOptimized
              ? 'text-status-green hover:bg-status-greenBg/60'
              : 'text-ink-muted hover:text-status-green hover:bg-status-greenBg/40',
          )}
          title={isOptimized ? 'לחץ להסרת הסימון' : 'סמן כאופטימיזציה בוצעה'}
          aria-label={isOptimized ? 'בטל סימון אופטימיזציה' : 'סמן כאופטימיזציה בוצעה'}
          aria-pressed={isOptimized}
        >
          {isOptimized ? <CheckCircle2 size={18} /> : <Circle size={18} />}
        </button>
      </td>
      {/* Phase 05.7.x — unified Campaign Health Score badge. Replaces the
          mental cost of synthesising 5 independent chips (trust, off-day,
          CPM trajectory, ROAS color, ROAS Shopify trust) into one A/B/C/D/F
          grade. Click opens a drilldown popover with the 4 weighted
          components + reasons. Empty cell until the parent's healthByKey
          memo settles (initial render before SWR resolves). */}
      <td
        data-col-id="health"
        className="px-2 py-2 text-center w-[78px]"
        onClick={e => e.stopPropagation()}
      >
        {health ? <HealthScoreBadge health={health} /> : null}
      </td>
      <td data-col-id="campaignName" className="px-3 sm:px-5 py-2 max-w-[280px] sm:max-w-[400px]">
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-elevated2 text-[10px] font-bold text-ink-secondary tabular-nums shrink-0">
            {i + 1}
          </span>
          <div className="min-w-0 flex-1">
            <div className="font-medium text-ink truncate flex items-center gap-1.5">
              {/* Native tooltip on hover when the name overflows.
                  Browsers automatically show `title` after
                  a short delay, which is the lowest-friction
                  way to surface long campaign / ad-set names
                  without building a custom popover. */}
              <span
                className="truncate"
                title={mode === 'campaign' ? a.campaignName : (a.adSetName || a.campaignName)}
              >
                {mode === 'campaign' ? a.campaignName : a.adSetName}
              </span>
              {/* CBO / ABO tag — small typographic signal so
                  the user can tell at a glance which level
                  owns the budget. Only shown for Meta and only
                  when we have a non-empty type. */}
              {a.platform === 'Meta' && a.budgetType && (
                <span
                  className={cn(
                    'inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-bold tracking-wider shrink-0',
                    a.budgetType === 'CBO'
                      ? 'bg-accent/10 text-accent'
                      : 'bg-purple-100 text-purple-700',
                  )}
                  title={a.budgetType === 'CBO' ? 'Campaign Budget Optimization — תקציב ברמת קמפיין' : 'Ad-Set Budget Optimization — תקציב ברמת ad-set'}
                >
                  {a.budgetType}
                </span>
              )}
              {/* FIX-26: "currently off" chip — surfaces campaigns that
                  appear in the table on historical data alone (no spend
                  in the last 2+ days). Helps the operator review a paused
                  campaign's past performance without confusing it for an
                  active one. */}
              {isCurrentlyOff && a.lastActiveDate && (
                <span
                  className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-bold tracking-wider shrink-0 bg-elevated2 text-ink-muted border border-line-subtle"
                  title={`קמפיין כבוי כרגע. הריצה האחרונה: ${formatLastActiveDate(a.lastActiveDate)}. הנתונים בשורה הם היסטוריים בלבד.`}
                >
                  ⏸ כבוי · {formatLastActiveDate(a.lastActiveDate)}
                </span>
              )}
              {/* Phase 05.7.x (2026-05-23) — "unmapped" chip. Meta + TikTok
                  campaigns get a flagged warning until the operator opens
                  the drawer and assigns at least one product. The chip
                  helps the operator catch newly-launched campaigns that
                  slipped past their mapping workflow (so the dashboard's
                  Shopify ROAS columns don't sit stuck at "—"). Google is
                  intentionally excluded — Google PMax/Shopping doesn't
                  expose ad-set structure consistently, so per-campaign
                  product mapping isn't supported there. */}
              {(a.platform === 'Meta' || a.platform === 'TikTok') &&
                !mappedCampaignKeys.has(
                  campaignKey(a.storeId, a.platform, a.campaignId),
                ) && (
                  <span
                    className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-bold tracking-wider shrink-0 bg-amber-100 text-amber-800 border border-amber-300"
                    title="הקמפיין הזה עדיין לא ממופה למוצרי Shopify. פתח את המגירה (קליק על שם הקמפיין) ובחר את המוצרים הרלוונטיים כדי שהדאשבורד יחשב ROAS Shopify אמיתי."
                  >
                    🏷️ לא ממופה
                  </span>
                )}
              {/* Phase C (2026-05-30) — freshness chip. Reads
                  `last_live_tick_at` (max across the aggregate's per-day
                  rows; see campaignsAggregator). Indicates how recently
                  cron-live / Phase C hot-metrics worker last refreshed
                  this row's data: green <15 min, orange 15-60 min, red
                  >60 min, em-dash when null (no tick on file — typical
                  for cron-daily-only writes). Sits last in the chip row
                  so it doesn't compete with the more-important "כבוי" /
                  "לא ממופה" warnings. */}
              <CampaignFreshnessChip lastLiveTickAt={a.lastLiveTickAt ?? null} />
            </div>
            <div
              className="text-[10px] sm:text-[11px] text-ink-muted truncate"
              title={
                mode === 'adset' && a.campaignName
                  ? `${a.platform} · ${a.storeName} · קמפיין: ${a.campaignName}`
                  : `${a.platform} · ${a.storeName}`
              }
            >
              {a.platform}
              {' · '}
              {a.storeName}
              {mode === 'adset' && a.campaignName ? ` · ${a.campaignName}` : ''}
            </div>
          </div>
        </div>
      </td>
      {/* Plan 4a Task 5 (2026-05-29) — inline ROAS trend sparkline. Sits
          OUTSIDE the reorderable columnOrder block (right after the fixed
          campaign-name column, before the operator-orderable metric
          block) so the trend is always visible regardless of column
          prefs. Mirrors the matching <th> in CampaignsTable.tsx. The
          Sparkline primitive hardcodes aria-label="טרנד" so we don't
          pass one here. Cell stays empty (em-dash) when the parent's
          dailyByCampaign hasn't built a series yet, or when the series
          has < 2 points (a single point isn't a meaningful trend). */}
      <td data-col-id="roasTrend" className="px-2 py-2 text-center align-middle">
        {dailySeries && dailySeries.length >= 2 ? (
          <Sparkline
            data={dailySeries.map(p => p.roas)}
            tone="blue"
            width={64}
            height={20}
            className="inline-block"
          />
        ) : (
          <span className="text-ink-muted">—</span>
        )}
      </td>
      {(() => {
      // Phase 05.7.x — Build the 15 reorderable metric <td> cells into a
      // colId → JSX map, then render them in the operator's preferred
      // order (the `columnOrder` prop, threaded from the parent's
      // resolveCampaignsColumnOrder pass). Mirrors the same trick the
      // thead in CampaignsTable.tsx uses, so header and cells stay in
      // lock-step regardless of order.
      const metricCells: Record<string, React.ReactNode> = {
      spend: (
        <td data-col-id="spend" className="px-3 py-2 text-end tabular-nums">{formatCurrency(a.spend)}</td>
      ),
      budget: (
        <td data-col-id="budget" className="px-3 py-2 text-end tabular-nums">
        {(() => {
          const budget = mode === 'campaign' ? a.campaignBudgetCad : a.adSetBudgetCad;
          if (!budget || budget <= 0) {
            return <span className="text-ink-muted">—</span>;
          }
          // Color hint: when daily spend exceeds 95% of daily
          // budget, flag amber — useful "pacing" signal.
          const tight = a.spend > 0 && a.spend > budget * 0.95;
          return (
            <span className={cn('font-medium', tight && 'text-amber-700')}>
              {formatCurrency(budget)}
            </span>
          );
        })()}
        </td>
      ),
      conversionValue: (
        <td data-col-id="conversionValue" className={cn('px-3 py-2 text-end tabular-nums font-medium', a.conversionValue > a.spend && 'text-status-green')}>
        {formatCurrency(a.conversionValue)}
        </td>
      ),
      roas: (
        <td data-col-id="roas" className={cn('px-3 py-2 text-center font-semibold tabular-nums rounded', TONE_BG[info.tone])}>
        {roas > 0 ? formatNumber(roas) : '—'}
        </td>
      ),
      roasShopify: (
      <td data-col-id="roasShopify" className="px-3 py-2 text-center">
        {(() => {
          const key = campaignKey(a.storeId, a.platform, a.campaignId);
          const info = trueRevenueByKey.get(key);
          if (!info) {
            return (
              <span
                className="text-ink-muted text-xs"
                title={
                  a.platform === 'Google'
                    ? 'Google PMax לא תומך במיפוי לפי מוצר — הפיד מנהל את ההצגה'
                    : 'לא משויכים מוצרים — פתח את הקמפיין כדי לשייך'
                }
              >
                —
              </span>
            );
          }
          const trueRoas = a.spend > 0 ? info.trueRevenue / a.spend : 0;
          const gap = info.metaClaim > 0
            ? ((trueRoas * a.spend) - info.metaClaim) / info.metaClaim
            : 0;

          // Tiered signal:
          //   1. Click-id (deterministic) — used when available
          //      AND the trust verdict is non-trivial
          //      (high/medium/low). Strongest evidence.
          //   2. Product-mapping (heuristic) — used as fallback
          //      when click-id is null or 'unknown' (utm
          //      misconfigured / no Meta claim to compare).
          //      Less precise but still better than silence.
          //
          // The tooltip always surfaces both numbers (Meta,
          // click-id, mapping) regardless of which drove the
          // chip — lets the operator triangulate when the two
          // sources disagree.
          const attrAvailable = info.attribution !== null;
          const attrUnknown =
            attrAvailable && info.attribution!.trust.level === 'unknown';
          const useAttr = attrAvailable && !attrUnknown;
          const trustLabel = useAttr ? info.attribution!.trust.label : info.confidence.label;
          // WR-06: the 'unknown' branch is statically unreachable here.
          // `useAttr === true` implies info.attribution!.trust.level is one
          // of 'high' | 'medium' | 'low' (we explicitly excluded 'unknown'
          // via `!attrUnknown` above). When `useAttr === false`, trustLevel
          // is sourced from info.confidence.level whose type union is
          // 'high' | 'medium' | 'low' (no 'unknown'). The unknown branch
          // was dead code masking the actual fallback rule — dropped.
          //
          // WR-02 (5.2.2.1): the narrowed level + tone-string mapping is now
          // exported (CampaignsTableRowTrustLevel + computeTrustTone) so
          // TEST-07 asserts against this exact production binding.
          const trustLevel: CampaignsTableRowTrustLevel =
            useAttr
              ? (info.attribution!.trust.level as Exclude<AttributionTrust['level'], 'unknown'>)
              : info.confidence.level;
          const confTone = computeTrustTone(trustLevel);

          // Mapping comparison line, reused in both tooltip
          // branches so the operator always sees what the other
          // signal would have said.
          const mappingLine =
            `Shopify מוקצה (מיפוי): CAD ${info.trueRevenue.toFixed(0)}` +
            (info.metaClaim > 0
              ? ` (פער ${(gap * 100).toFixed(0)}% מול Meta)`
              : '');

          let tooltip: string;
          if (useAttr) {
            const at = info.attribution!;
            const detRoas = a.spend > 0 ? at.deterministicRevenue / a.spend : 0;
            tooltip =
              `ROAS מבוסס click-id · ${at.trust.label} (${at.trust.score.toFixed(0)}/100)\n\n` +
              `Meta דיווח:           CAD ${info.metaClaim.toFixed(0)}\n` +
              `מתויג click-id:       CAD ${at.deterministicRevenue.toFixed(0)} (${at.deterministicOrders} הזמנות)\n` +
              `${mappingLine}\n` +
              `Modeled / view-through: CAD ${at.modeledRevenue.toFixed(0)}\n` +
              `coverage: ${(at.coverage * 100).toFixed(0)}%\n` +
              `ROAS אמיתי: ${detRoas.toFixed(2)}x  |  ROAS לפי Meta: ${(info.metaClaim / a.spend).toFixed(2)}x\n\n` +
              at.reasons.map(r => `• ${r}`).join('\n') +
              `\n\n💡 ${at.recommendation}`;
          } else {
            // Fallback path. Note explicitly that click-id data
            // is missing/unusable so the operator knows why
            // they're seeing the heuristic instead.
            const clickIdNote = attrUnknown
              ? `\n(click-id: ${info.attribution!.deterministicOrders} הזמנות תויגו — לא מספיק לסיגנל; חוזרים למיפוי מוצרים)`
              : '\n(אין נתוני click-id בטווח — חוזרים למיפוי מוצרים)';
            tooltip =
              `ROAS מבוסס מיפוי מוצרים · ${info.confidence.label}${clickIdNote}\n\n` +
              `Meta דיווח: CAD ${info.metaClaim.toFixed(0)}\n` +
              `${mappingLine}\n\n` +
              info.confidence.reasons.map(r => `• ${r}`).join('\n');
          }
          // Phase 05.7.x — the standalone trust chip (אמין / חלקי / לא אמין
          // with `confTone` background) was retired here on 2026-05-22. The
          // unified Campaign Health Score's "אמינות attribution" component
          // (20% of the grade) now carries the same signal more clearly:
          // it lives in its own column with a drilldown that explains the
          // 0–100 trust score in context with the other 3 weighted
          // components, instead of competing as a tiny chip stacked under
          // the ROAS number. Tooltip on the ROAS Shopify cell is preserved
          // so a hover still surfaces the click-id / mapping breakdown for
          // operators who want the raw reasoning.
          //
          // Variables computed above (trustLabel, confTone, trustLevel)
          // remain in scope because the tooltip text below references the
          // narrowed `useAttr` branch + reason strings — removing them
          // would orphan that path.
          void trustLabel;
          void trustLevel;
          void confTone;
          return (
            <div className="inline-flex flex-col items-center gap-0.5" title={tooltip}>
              <span className="font-semibold tabular-nums text-ink">
                {trueRoas > 0 ? formatNumber(trueRoas) : '—'}
              </span>
            </div>
          );
        })()}
      </td>
      ),
      // Phase 05.7.9e — third ROAS column. ROAS Shopify · פלטפורמה =
      // deterministicRevenue / spend. Sits between combined ROAS Shopify
      // (left) and per-platform value/units columns (right).
      roasShopifyPlatform: (
      <td data-col-id="roasShopifyPlatform" className="px-3 py-2 text-center">
        {(() => {
          const key = campaignKey(a.storeId, a.platform, a.campaignId);
          const info = trueRevenueByKey.get(key);
          if (!info || a.spend <= 0 || info.deterministicRevenue <= 0) {
            return (
              <span
                className="text-ink-muted"
                title={`אין הזמנות שסווגו דטרמיניסטית ל-${a.platform} עבור המוצרים המשויכים בטווח. כדי לראות ROAS פלטפורמה — צריך ש-Shopify יראה את ה-source/click-id של ההזמנות.`}
              >
                —
              </span>
            );
          }
          const detRoas = info.deterministicRevenue / a.spend;
          const totalUnits = Math.round(info.productTotals.units);
          const detUnits = Math.round(info.deterministicUnits);
          const tooltip =
            `ROAS Shopify · פלטפורמה = ${detRoas.toFixed(2)}x\n` +
            `  (${formatCurrency(info.deterministicRevenue)} / ${formatCurrency(a.spend)})\n\n` +
            `מבוסס על ${detUnits} מתוך ${totalUnits} יחידות שנמכרו (רק הזמנות עם source='${a.platform === 'Meta' ? 'meta-paid' : a.platform === 'Google' ? 'google-paid' : 'tiktok-paid'}' או click-id מזוהה). ` +
            `השאר עברו דרך direct / organic / פלטפורמות אחרות.`;
          return (
            <span
              className="font-semibold tabular-nums"
              title={tooltip}
            >
              {formatNumber(detRoas)}
            </span>
          );
        })()}
      </td>
      ),
      // Shopify actuals — ערך + יחידות. Empty cells when there's no
      // mapping so the row stays cleanly aligned. The 4 Shopify
      // columns (deterministic per-platform value/units + product
      // totals across all platforms) are computed in
      // useCampaignTrueRevenue.ts (deterministicRevenue/Units +
      // productTotals).
      shopifyValuePlatform: (
      <td data-col-id="shopifyValuePlatform" className="px-3 py-2 text-end tabular-nums border-e border-line-subtle/40">
        {(() => {
          const key = campaignKey(a.storeId, a.platform, a.campaignId);
          const info = trueRevenueByKey.get(key);
          if (!info || info.deterministicRevenue <= 0) {
            return (
              <span
                className="text-ink-muted"
                title={`אין הזמנות שסווגו דטרמיניסטית ל-${a.platform} עבור המוצרים המשויכים בטווח הנבחר.`}
              >
                —
              </span>
            );
          }
          const tooltip =
            `CAD ${info.deterministicRevenue.toFixed(0)} מהזמנות שסווגו ב-Shopify ל-${a.platform} ` +
            `(source='${a.platform === 'Meta' ? 'meta-paid' : a.platform === 'Google' ? 'google-paid' : 'tiktok-paid'}' או click-id מזוהה).`;
          return (
            <span className="font-medium" title={tooltip}>
              {formatCurrency(info.deterministicRevenue)}
            </span>
          );
        })()}
      </td>
      ),
      // [2] יח' Shopify · פלטפורמה — deterministic units
      shopifyUnitsPlatform: (
      <td data-col-id="shopifyUnitsPlatform" className="px-3 py-2 text-end tabular-nums border-e border-line-subtle/40">
        {(() => {
          const key = campaignKey(a.storeId, a.platform, a.campaignId);
          const info = trueRevenueByKey.get(key);
          if (!info || info.deterministicUnits <= 0) {
            return (
              <span
                className="text-ink-muted"
                title={`אין הזמנות שסווגו דטרמיניסטית ל-${a.platform} עבור המוצרים המשויכים בטווח הנבחר.`}
              >
                —
              </span>
            );
          }
          const exact = info.deterministicUnits;
          const display = Math.round(exact);
          const isFractional = Math.abs(exact - display) >= 0.05;
          const tooltip = isFractional
            ? `${exact.toFixed(2)} יח' מוקצות לקמפיין הזה מתוך הסך הדטרמיניסטי של ${a.platform} ` +
              `(חלוקה לפי הוצאה בין הקמפיינים של ${a.platform} שממופים לאותם מוצרים).`
            : `${display} יח' מהזמנות שסווגו ב-Shopify ל-${a.platform} עבור המוצרים המשויכים.`;
          return (
            <span
              className="font-medium inline-flex items-center gap-0.5"
              title={tooltip}
            >
              <span>{display}</span>
              {isFractional && (
                <span aria-hidden="true" className="text-[8px] text-ink-muted">*</span>
              )}
            </span>
          );
        })()}
      </td>
      ),
      // [3] ערך Shopify · סה"כ — total revenue across all platforms
      shopifyValueTotal: (
      <td data-col-id="shopifyValueTotal" className="px-3 py-2 text-end tabular-nums">
        {(() => {
          const key = campaignKey(a.storeId, a.platform, a.campaignId);
          const info = trueRevenueByKey.get(key);
          if (!info || info.productTotals.revenue <= 0) {
            return <span className="text-ink-muted">—</span>;
          }
          return (
            <span
              className="font-medium text-ink-secondary"
              title={`סך ערך המכירות ב-Shopify של המוצרים המשויכים בטווח הנבחר, מכל הערוצים יחד (paid + organic + direct).`}
            >
              {formatCurrency(info.productTotals.revenue)}
            </span>
          );
        })()}
      </td>
      ),
      // [4] יח' Shopify · סה"כ — total units across all platforms
      shopifyUnitsTotal: (
      <td data-col-id="shopifyUnitsTotal" className="px-3 py-2 text-end tabular-nums">
        {(() => {
          const key = campaignKey(a.storeId, a.platform, a.campaignId);
          const info = trueRevenueByKey.get(key);
          if (!info || info.productTotals.units <= 0) {
            return <span className="text-ink-muted">—</span>;
          }
          const total = Math.round(info.productTotals.units);
          return (
            <span
              className="font-medium text-ink-secondary"
              title={`סך היחידות שנמכרו ב-Shopify של המוצרים המשויכים בטווח הנבחר, מכל הערוצים יחד.`}
            >
              {total}
            </span>
          );
        })()}
      </td>
      ),
      // [5] Phase 05.7.x (2026-05-23) — הזמנות Shopify · סה"כ.
      // Number of orders that contained the campaign's mapped product(s)
      // in the range, summed across all mapped products. Conservative:
      // an order with 2 mapped products counts once per product (so the
      // sum may exceed distinct orders); operator reads this as
      // "product-orders" — same semantics as Shopify's own per-product
      // report. Hidden when no mapping exists.
      shopifyOrdersTotal: (
      <td data-col-id="shopifyOrdersTotal" className="px-3 py-2 text-end tabular-nums">
        {(() => {
          const key = campaignKey(a.storeId, a.platform, a.campaignId);
          const info = trueRevenueByKey.get(key);
          if (!info || info.productTotals.orders <= 0) {
            return <span className="text-ink-muted">—</span>;
          }
          const total = Math.round(info.productTotals.orders);
          return (
            <span
              className="font-medium text-ink-secondary"
              title="סך ההזמנות ב-Shopify שכללו את המוצרים המשויכים, בטווח שנבחר, מכל הערוצים. מוצר שמופיע בכמה הזמנות נספר פעם להזמנה; מוצרים מרובים באותה הזמנה מסוכמים פר-מוצר."
            >
              {total}
            </span>
          );
        })()}
      </td>
      ),
      conversions: (
        <td data-col-id="conversions" className="px-3 py-2 text-end tabular-nums">{formatNumber(a.conversions, 0)}</td>
      ),
      ctr: (
        <td data-col-id="ctr" className="px-3 py-2 text-end tabular-nums text-ink-secondary">
          {a.impressions > 0 ? `${(ctr * 100).toFixed(2)}%` : '—'}
        </td>
      ),
      cpc: (
        <td data-col-id="cpc" className="px-3 py-2 text-end tabular-nums text-ink-secondary">
          {a.clicks > 0 ? formatCurrency(cpc, 2) : '—'}
        </td>
      ),
      cpm: (
        <td data-col-id="cpm" className="px-3 py-2 text-end tabular-nums text-ink-secondary">
          {a.impressions > 0 ? formatCurrency(cpm, 2) : '—'}
        </td>
      ),
      cpa: (
        <td data-col-id="cpa" className="px-3 py-2 text-end tabular-nums text-ink-secondary">
          {a.conversions > 0 ? formatCurrency(cpa, 2) : '—'}
        </td>
      ),
      };
      return columnOrder.map(id => (
        <Fragment key={id}>{metricCells[id]}</Fragment>
      ));
      })()}
      <td data-col-id="deepLink" className="px-2 py-2 text-center">
        {link && (
          <a
            href={link}
            target="_blank"
            rel="noopener noreferrer"
            onClick={e => e.stopPropagation()}
            className="inline-flex items-center justify-center w-7 h-7 rounded text-ink-muted hover:text-accent hover:bg-accent/8 transition-colors"
            title={`פתח ב-${a.platform} Ads Manager`}
            aria-label="פתח ב-Ads Manager"
          >
            <ExternalLink size={14} />
          </a>
        )}
      </td>
    </tr>
  );
}
