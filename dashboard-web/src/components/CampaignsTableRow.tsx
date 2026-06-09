'use client';

import { Fragment } from 'react';
import { CheckCircle2, Circle, ExternalLink, Pause, Tag, Hourglass } from 'lucide-react';
import { cn, formatCurrency, formatNumber } from '@/lib/utils';
import { fmtMoneyString } from '@/lib/format';
import { ROAS_TONE_BG, ROAS_BADGE_SHAPE } from '@/lib/format/roasCell';
import { Button } from '@/components/ui/Button';
import { Money } from '@/components/ui/Money';
import { HelpTooltip } from '@/components/ui/Tooltip';
import { campaignKey } from '@/lib/campaignProductMap';
import { campaignPendingState } from '@/lib/campaignPendingState';
import { buildAdsManagerLink, type AdAccountMap } from '@/lib/campaignsLinks';
import { roasLabel } from '@/lib/analytics';
import type { Aggregated } from '@/lib/campaignsAggregator';
import type { ConfidenceLevel, TrueRevenueInfo } from '@/lib/hooks/useCampaignTrueRevenue';
import type { AttributionTrust, FirstClickAnalysis } from '@/lib/attributionAnalysis';
import { firstClickDelta } from '@/components/firstClickDelta';
import { FirstClickCoverageChip } from '@/components/FirstClickCoverageChip';
import type { CampaignHealth } from '@/lib/campaignHealthScore';
import type { DailyCpmRoasPoint } from '@/lib/cpmRoasAnalysis';
import { HealthScoreBadge } from './HealthScoreBadge';
import { Sparkline } from './ui/Sparkline';
import { CampaignFreshnessChip } from './CampaignFreshnessChip';
import { classifyCampaignStatus } from '@/lib/registries/statusClassification';

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
  return level === 'high'   ? 'bg-status-greenBg text-status-greenFg'
       : level === 'medium' ? 'bg-status-warningBg text-status-warningFg'
       :                      'bg-status-redBg text-status-redFg';
}


type Props = {
  a: Aggregated;
  i: number;
  mode: 'campaign' | 'adset';
  trueRevenueByKey: Map<string, TrueRevenueInfo>;
  /**
   * Plan C (2026-06-02) — per-campaign first-click ("מבוא ללקוח") analysis,
   * keyed by `campaignKey(storeId, platform, campaignId)` (same key as
   * trueRevenueByKey). Computed once in the parent (`firstClickByCampaign`
   * memo) so each row does an O(1) lookup. The value is null when the
   * platform is unsupported or there are no orders in range; the cell renders
   * an em-dash placeholder in that case.
   */
  firstClickByCampaign: Map<string, FirstClickAnalysis | null>;
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
  /** Whether the selected range includes today — gates the live "מתעדכן/ממתין"
   *  pending state so it never fires on a fully-historical range (Problem B). */
  rangeIncludesToday: boolean;
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

// Phase D (2026-05-30) — `OFF_RECENCY_DAYS`, `isCampaignCurrentlyOff`,
// `TIKTOK_OFF_STATUSES`, `TIKTOK_ACTIVE_ENOUGH`, and `isCampaignOff` all
// moved into the shared classifier. The new entry point is
// `classifyCampaignStatus({...}).isOff` — used at the call site below.
// Sets:    `@/lib/registries/tiktokStatusSets` / `@/lib/platformConfig`
// Helpers: `@/lib/registries/statusClassification`

/** Format YYYY-MM-DD as DD/MM for the off-chip tooltip text. */
function formatLastActiveDate(iso: string): string {
  return `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
}

export function CampaignsTableRow({
  a,
  i,
  mode,
  trueRevenueByKey,
  firstClickByCampaign,
  mappedCampaignKeys,
  health,
  columnOrder,
  dailySeries,
  adAccounts,
  optimized,
  today,
  rangeIncludesToday,
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
  // Phase D (2026-05-30) — single classifier consumes registry + legacy +
  // heuristic precedence. Returns a 4-tuple the chip rendering below uses
  // (isOff drives the "כבוי" chip; isBackfillUnknown drives the secondary
  // "טוען מ-Platform" chip).
  const statusVerdict = classifyCampaignStatus({
    regDeliveryStatus: a.regDeliveryStatus,
    regEffectiveStatus: a.regEffectiveStatus,
    regConfiguredStatus: a.regConfiguredStatus,
    legacyEffectiveStatus: a.effectiveStatus,
    platform: a.platform,
    lastActiveDate: a.lastActiveDate,
    today,
  });
  const isCurrentlyOff = statusVerdict.isOff;
  const roas = a.spend > 0 ? a.conversionValue / a.spend : 0;
  const ctr = a.impressions > 0 ? a.clicks / a.impressions : 0;
  const cpc = a.clicks > 0 ? a.spend / a.clicks : 0;
  // CPM = cost per 1000 impressions. A standard auction metric across every
  // ad platform — what you pay on average to be seen by 1000 people.
  // spend / impressions * 1000.
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
    <HelpTooltip
      content={
        mode === 'campaign'
          ? 'לחץ לפרטים מלאים'
          : mode === 'adset' && (a.platform === 'Meta' || a.platform === 'TikTok')
          ? 'לחץ לראות את המודעות באד-סט'
          : undefined
      }
    >
    <tr
      className={cn(
        'border-b border-glass-edge hover:bg-glass-2/40 cursor-pointer transition-opacity',
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
    >
      {/* Per-row optimization toggle. Clicking flips the mark
          without bubbling into the row click (which would
          open the drawer). The empty Circle is the un-marked
          state; CheckCircle2 in green is the marked state. */}
      <td data-col-id="optimized" className="px-2 py-2 text-center w-[36px]">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={e => {
            e.stopPropagation();
            onToggleOptimized(a.key);
          }}
          className={cn(
            'w-7 h-7 rounded-full',
            isOptimized
              ? 'text-status-greenFg hover:bg-status-greenBg'
              : 'text-ink-muted hover:text-status-greenFg hover:bg-status-greenBg',
          )}
          aria-label={isOptimized ? 'בטל סימון אופטימיזציה' : 'סמן כאופטימיזציה בוצעה'}
          aria-pressed={isOptimized}
        >
          {isOptimized ? <CheckCircle2 size={18} /> : <Circle size={18} />}
        </Button>
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
          <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-glass-2 text-[10px] font-bold text-ink-secondary tabular-nums shrink-0">
            {i + 1}
          </span>
          <div className="min-w-0 flex-1">
            <div className="font-medium text-ink truncate flex items-center gap-1.5">
              {/* Native tooltip on hover when the name overflows.
                  Browsers automatically show `title` after
                  a short delay, which is the lowest-friction
                  way to surface long campaign / ad-set names
                  without building a custom popover. */}
              <HelpTooltip content={mode === 'campaign' ? a.campaignName : (a.adSetName || a.campaignName)}>
                <span className="truncate">
                  <bdi dir="ltr">{mode === 'campaign' ? a.campaignName : a.adSetName}</bdi>
                </span>
              </HelpTooltip>
              {/* CBO / ABO tag — small typographic signal so
                  the user can tell at a glance which level
                  owns the budget. Only shown for Meta and only
                  when we have a non-empty type. */}
              {a.platform === 'Meta' && a.budgetType && (
                <HelpTooltip content={a.budgetType === 'CBO' ? 'Campaign Budget Optimization — תקציב ברמת קמפיין' : 'Ad-Set Budget Optimization — תקציב ברמת ad-set'}>
                  <span
                    className={cn(
                      'inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-bold tracking-wider shrink-0',
                      a.budgetType === 'CBO'
                        ? 'bg-accent-bg text-accent'
                        : 'bg-accent-bg text-accent',
                    )}
                  >
                    {a.budgetType}
                  </span>
                </HelpTooltip>
              )}
              {/* FIX-26: "currently off" chip — surfaces campaigns that
                  appear in the table on historical data alone (no spend
                  in the last 2+ days). Helps the operator review a paused
                  campaign's past performance without confusing it for an
                  active one. */}
              {isCurrentlyOff && a.lastActiveDate && (
                <HelpTooltip content={`קמפיין כבוי כרגע. הריצה האחרונה: ${formatLastActiveDate(a.lastActiveDate)}. הנתונים בשורה הם היסטוריים בלבד.`}>
                  <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-bold tracking-wider shrink-0 bg-glass-2 text-ink-muted border border-glass-edge">
                    <Pause size={9} className="shrink-0" aria-hidden />
                    כבוי · {formatLastActiveDate(a.lastActiveDate)}
                  </span>
                </HelpTooltip>
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
                  <HelpTooltip content="הקמפיין הזה עדיין לא ממופה למוצרי Shopify. פתח את המגירה (קליק על שם הקמפיין) ובחר את המוצרים הרלוונטיים כדי שהדאשבורד יחשב ROAS Shopify אמיתי.">
                    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-bold tracking-wider shrink-0 bg-status-warningBg text-status-warningFg border border-status-warning">
                      <Tag size={9} className="shrink-0" aria-hidden />
                      לא ממופה
                    </span>
                  </HelpTooltip>
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
              {/* Phase D (2026-05-30) — surfaces the moment a registry row's
                  configured_status is still the BACKFILL_UNKNOWN sentinel
                  (i.e. the platform's native value hasn't been observed
                  since the Phase D backfill). Disappears within ~10 min
                  once the next orchestrator tick runs the status worker. */}
              {statusVerdict.isBackfillUnknown && (
                <HelpTooltip content="הסטטוס המוגדר עדיין לא נדגם מה-platform — ימולא בעוד עד 10 דק׳.">
                  <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-bold tracking-wider shrink-0 bg-status-warningBg text-status-warningFg border border-status-warning">
                    <Hourglass size={9} className="shrink-0" aria-hidden />
                    טוען מ-Platform
                  </span>
                </HelpTooltip>
              )}
            </div>
            <HelpTooltip
              content={
                mode === 'adset' && a.campaignName
                  ? `${a.platform} · ${a.storeName} · קמפיין: ${a.campaignName}`
                  : `${a.platform} · ${a.storeName}`
              }
            >
              <div className="text-[10px] sm:text-[11px] text-ink-muted truncate">
                <bdi dir="ltr">{a.platform}</bdi>
                {' · '}
                <bdi dir="ltr">{a.storeName}</bdi>
                {mode === 'adset' && a.campaignName ? <>{' · '}<bdi dir="ltr">{a.campaignName}</bdi></> : ''}
              </div>
            </HelpTooltip>
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
        <td data-col-id="spend" className="metric-cell px-3 py-2 text-center tabular-nums">
          <Money value={a.spend} prefix="none" locale="he-IL" compactAbove={100_000} />
        </td>
      ),
      budget: (
        <td data-col-id="budget" className="metric-cell px-3 py-2 text-center tabular-nums">
        {(() => {
          const budget = mode === 'campaign' ? a.campaignBudgetCad : a.adSetBudgetCad;
          if (!budget || budget <= 0) {
            return <span className="text-ink-muted">—</span>;
          }
          // Color hint: when daily spend exceeds 95% of daily
          // budget, flag amber — useful "pacing" signal.
          const tight = a.spend > 0 && a.spend > budget * 0.95;
          return (
            <span className={cn('font-medium', tight && 'text-status-warningFg')}>
              <Money value={budget} prefix="none" locale="he-IL" compactAbove={100_000} className="font-medium" />
            </span>
          );
        })()}
        </td>
      ),
      conversionValue: (
        <td data-col-id="conversionValue" className={cn('metric-cell px-3 py-2 text-center tabular-nums font-medium', a.conversionValue > a.spend && 'text-status-greenFg')}>
        <Money value={a.conversionValue} prefix="none" locale="he-IL" compactAbove={100_000} />
        </td>
      ),
      roas: (
        <td data-col-id="roas" className="px-3 py-2 text-center font-semibold tabular-nums">
          {/* OPERATOR FIX (2026-06-01): ROAS value rendered as a SOLID rounded
              badge (mirrors HealthScoreBadge + mockup) instead of a pale
              full-cell tint. */}
          {(() => {
            if (roas > 0) {
              return (
                <span className={cn(ROAS_BADGE_SHAPE, ROAS_TONE_BG[info.tone])}>
                  {formatNumber(roas)}
                </span>
              );
            }
            // spend === 0 → ROAS uncomputable. Show an honest live state
            // instead of a bare "—" (Problem B, 2026-06-09). Gated on
            // rangeIncludesToday so a historical range shows the neutral "—".
            const pending = campaignPendingState(a, rangeIncludesToday);
            if (pending === 'updating') {
              return (
                <HelpTooltip content="הוצאה עדיין 0 אבל כבר יש המרות/ערך — הפלטפורמה מדווחת את ה-spend באיחור (מתעדכן בטיק הבא, ~10 דק׳). ה-ROAS יחושב כשה-spend ינחת.">
                  <span className="text-ink-muted text-xs font-normal">מתעדכן…</span>
                </HelpTooltip>
              );
            }
            if (pending === 'awaiting') {
              return (
                <HelpTooltip content="קמפיין פעיל שטרם נקלט בו טיק מטריקות ראשון — ממתין לנתונים (עד ~10 דק׳).">
                  <span className="text-ink-muted text-xs font-normal">ממתין…</span>
                </HelpTooltip>
              );
            }
            return (
              <span className={cn(ROAS_BADGE_SHAPE, ROAS_TONE_BG[info.tone])}>—</span>
            );
          })()}
        </td>
      ),
      roasShopify: (
      <td data-col-id="roasShopify" className="px-3 py-2 text-center">
        {(() => {
          const key = campaignKey(a.storeId, a.platform, a.campaignId);
          const info = trueRevenueByKey.get(key);
          if (!info) {
            return (
              <HelpTooltip
                content={
                  a.platform === 'Google'
                    ? 'Google PMax לא תומך במיפוי לפי מוצר — הפיד מנהל את ההצגה'
                    : 'לא משויכים מוצרים — פתח את הקמפיין כדי לשייך'
                }
              >
                <span className="text-ink-muted text-xs">
                  —
                </span>
              </HelpTooltip>
            );
          }
          // 2026-06-09 (Problem A): an unmapped attribution-only row (Google)
          // with NO click-id matches. `info` exists only to carry the verdict
          // for the Health Score; there is no product mapping and no
          // deterministic revenue, so the mapping-based fallback tooltip below
          // would wrongly say "based on product mapping". Render "—" (no
          // Shopify-verified ROAS) with the SAME verdict the Attribution panel
          // shows, so the two surfaces agree.
          if (info.mappedCount === 0 && info.deterministicRevenue === 0) {
            const at = info.attribution;
            const verdictTip = at
              ? `ROAS Shopify (click-id) · ${at.trust.label} (${at.trust.score.toFixed(0)}/100)\n` +
                `${a.platform} דיווח: ${fmtMoneyString(info.metaClaim)}\n` +
                `מתויג click-id: ${fmtMoneyString(at.deterministicRevenue)} (${at.deterministicOrders} הזמנות)\n` +
                `coverage: ${(at.coverage * 100).toFixed(0)}%` +
                (at.recommendation ? `\n\n💡 ${at.recommendation}` : '')
              : 'אין נתוני click-id לקמפיין זה בטווח';
            return (
              <HelpTooltip content={verdictTip}>
                <span className="text-ink-muted text-xs">—</span>
              </HelpTooltip>
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
          // signal would have said. Suppressed for an attribution-only
          // (unmapped) row — e.g. Google PMax — where there is no product
          // mapping, so trueRevenue IS the deterministic revenue and a
          // "(מיפוי)" label would both mislabel it and duplicate the
          // "מתויג click-id" line above.
          const mappingLine =
            info.mappedCount > 0
              ? `Shopify מוקצה (מיפוי): ${fmtMoneyString(info.trueRevenue)}` +
                (info.metaClaim > 0
                  ? ` (פער ${(gap * 100).toFixed(0)}% מול ${a.platform})`
                  : '')
              : '';

          // Column-audit 2026-06-01 (FIX 1) — spell out the numerator so the
          // operator can reconcile this ROAS on screen:
          //   deterministic (click-id) + fallback = allocated (trueRevenue)
          //   allocated / spend = this ROAS.
          // No math changed — these are the same numbers the cell already uses.
          const fallbackRevenue = info.trueRevenue - info.deterministicRevenue;
          const numeratorBreakdown =
            `\nמונה ROAS Shopify (מוקצה):\n` +
            `  click-id (דטרמיניסטי):  ${fmtMoneyString(info.deterministicRevenue)}\n` +
            `  + הקצאה (fallback):     ${fmtMoneyString(fallbackRevenue)}\n` +
            `  = מוקצה (trueRevenue):  ${fmtMoneyString(info.trueRevenue)}\n` +
            `  מוקצה ÷ הוצאה = ${trueRoas.toFixed(2)}x`;

          let tooltip: string;
          if (useAttr) {
            const at = info.attribution!;
            const detRoas = a.spend > 0 ? at.deterministicRevenue / a.spend : 0;
            const metaRoas = a.spend > 0 ? info.metaClaim / a.spend : 0;
            tooltip =
              `ROAS Shopify מוקצה · ${at.trust.label} (${at.trust.score.toFixed(0)}/100)\n` +
              numeratorBreakdown + `\n\n` +
              `${a.platform} דיווח:        ${fmtMoneyString(info.metaClaim)}\n` +
              `מתויג click-id:       ${fmtMoneyString(at.deterministicRevenue)} (${at.deterministicOrders} הזמנות)\n` +
              (mappingLine ? `${mappingLine}\n` : '') +
              `Modeled / view-through: ${fmtMoneyString(at.modeledRevenue)}\n` +
              `coverage: ${(at.coverage * 100).toFixed(0)}%\n` +
              `ROAS דטרמיניסטי: ${detRoas.toFixed(2)}x  |  ROAS לפי ${a.platform}: ${metaRoas.toFixed(2)}x\n\n` +
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
              `ROAS Shopify מוקצה · מבוסס מיפוי מוצרים · ${info.confidence.label}${clickIdNote}\n` +
              numeratorBreakdown + `\n\n` +
              `${a.platform} דיווח: ${fmtMoneyString(info.metaClaim)}\n` +
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
            <HelpTooltip content={tooltip}>
              <div className="inline-flex flex-col items-center gap-0.5">
                <span className="font-semibold tabular-nums text-ink">
                  {trueRoas > 0 ? formatNumber(trueRoas) : '—'}
                </span>
              </div>
            </HelpTooltip>
          );
        })()}
      </td>
      ),
      // Plan C (2026-06-02) — first-click ("מבוא ללקוח") value + headline delta
      // on hover, at ~60-70% prominence vs the last-click ROAS Shopify (opacity-80,
      // muted). Compares first-click ROAS to the row's last-click (allocated)
      // ROAS Shopify; the coverage chip = first-click-matched ÷ last-click-matched
      // (deterministic) orders. Google-blind + directional-floor caveats in the
      // tooltip. Mapping-aware: the analysis is keyed by the row's resolved store.
      firstClickRoas: (
      <td data-col-id="firstClickRoas" className="px-3 py-2 text-center" data-testid={`first-click-roas-${a.campaignId}`}>
        {(() => {
          const key = campaignKey(a.storeId, a.platform, a.campaignId);
          const fc = firstClickByCampaign.get(key) ?? null;
          if (!fc || fc.firstClickOrders === 0) {
            return (
              <HelpTooltip content={'אין סיגנל first-click בטווח לקמפיין הזה (אין ft_* / utm_id שתואם). first-click = המגע הראשון של הלקוח (מבוא ללקוח). עיוור ל-Google. כיסוי <= last-click.'}>
                <span className="text-ink-muted text-xs">—</span>
              </HelpTooltip>
            );
          }
          const info = trueRevenueByKey.get(key);
          // Last-click ROAS for the delta = allocated (trueRevenue) ÷ spend —
          // the same number the ROAS Shopify cell renders. Coverage's last-click
          // order count comes from the deterministic attribution analysis.
          const lastClickRoas = info && a.spend > 0 ? info.trueRevenue / a.spend : 0;
          const lastClickOrders = info?.attribution?.deterministicOrders ?? 0;
          const d = firstClickDelta(fc.firstClickRoas, lastClickRoas);
          const tooltip =
            `first-click ROAS: ${fc.firstClickRoas.toFixed(2)}x (${fc.firstClickOrders} הזמנות, ${fc.firstClickRevenue.toFixed(0)} CAD)\n` +
            `last-click ROAS Shopify: ${lastClickRoas.toFixed(2)}x\n` +
            (d ? `delta: ${d.label}\n` : '') +
            '\nfirst-click = המגע הראשון (מבוא ללקוח). עיוור ל-Google. כיסוי <= last-click.';
          return (
            <HelpTooltip content={tooltip}>
              <div className="inline-flex flex-col items-center gap-0.5 opacity-80">
                <span className="font-medium tabular-nums text-ink">
                  {fc.firstClickRoas > 0 ? fc.firstClickRoas.toFixed(2) : '—'}
                </span>
                {d && (
                  <span
                    className={cn(
                      'text-[10px] font-semibold tabular-nums',
                      d.direction === 'up'   ? 'text-status-greenFg'
                    : d.direction === 'down' ? 'text-status-redFg'
                    :                          'text-ink-muted',
                    )}
                  >
                    <bdi dir="ltr">{d.label}</bdi>
                  </span>
                )}
                <FirstClickCoverageChip
                  firstClickOrders={fc.firstClickOrders}
                  lastClickOrders={lastClickOrders}
                />
              </div>
            </HelpTooltip>
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
              <HelpTooltip content={`אין הזמנות שסווגו דטרמיניסטית ל-${a.platform} עבור המוצרים המשויכים בטווח. כדי לראות ROAS פלטפורמה — צריך ש-Shopify יראה את ה-source/click-id של ההזמנות.`}>
                <span className="text-ink-muted">
                  —
                </span>
              </HelpTooltip>
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
            <HelpTooltip content={tooltip}>
              <span className="font-semibold tabular-nums">
                {formatNumber(detRoas)}
              </span>
            </HelpTooltip>
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
      <td data-col-id="shopifyValuePlatform" className="metric-cell px-3 py-2 text-center tabular-nums border-e border-glass-edge/40">
        {(() => {
          const key = campaignKey(a.storeId, a.platform, a.campaignId);
          const info = trueRevenueByKey.get(key);
          if (!info || info.deterministicRevenue <= 0) {
            return (
              <HelpTooltip content={`אין הזמנות שסווגו דטרמיניסטית ל-${a.platform} עבור המוצרים המשויכים בטווח הנבחר.`}>
                <span className="text-ink-muted">
                  —
                </span>
              </HelpTooltip>
            );
          }
          const tooltip =
            `${fmtMoneyString(info.deterministicRevenue)} מהזמנות שסווגו ב-Shopify ל-${a.platform} ` +
            `(source='${a.platform === 'Meta' ? 'meta-paid' : a.platform === 'Google' ? 'google-paid' : 'tiktok-paid'}' או click-id מזוהה).`;
          return (
            <HelpTooltip content={tooltip}>
              <span className="font-medium">
                <Money value={info.deterministicRevenue} prefix="none" locale="he-IL" compactAbove={100_000} />
              </span>
            </HelpTooltip>
          );
        })()}
      </td>
      ),
      // Column-audit 2026-06-01 (FIX 1) — ערך Shopify · מוקצה.
      // The VISIBLE numerator of ROAS Shopify (roasShopify = trueRevenue /
      // spend). trueRevenue = deterministic (click-id) + spend-proportional
      // fallback of un-attributed orders. Without this column the operator
      // can't reconcile roasShopify on screen (e.g. 1.47 ← 173.46 / 118).
      // Renders with 2 decimals so the division is reproducible. No math is
      // changed here — info.trueRevenue is read straight from the existing
      // allocator (useCampaignTrueRevenue.ts:trueRevenue = alloc.revenue).
      shopifyValueAllocated: (
      <td data-col-id="shopifyValueAllocated" className="metric-cell px-3 py-2 text-center tabular-nums">
        {(() => {
          const key = campaignKey(a.storeId, a.platform, a.campaignId);
          const info = trueRevenueByKey.get(key);
          if (!info || info.trueRevenue <= 0) {
            return <span className="text-ink-muted">—</span>;
          }
          const allocRoas = a.spend > 0 ? info.trueRevenue / a.spend : 0;
          const tooltip =
            `הכנסת Shopify המוקצה לקמפיין = ${fmtMoneyString(info.trueRevenue)} ` +
            `(מתויג click-id ${fmtMoneyString(info.deterministicRevenue)} + חלק יחסי מהזמנות לא-מתויגות). ` +
            `זהו המונה של ROAS Shopify: מוקצה ÷ הוצאה = ${allocRoas.toFixed(2)}x.`;
          return (
            <HelpTooltip content={tooltip}>
              <span className="font-medium">
                <Money value={info.trueRevenue} prefix="none" locale="he-IL" decimals={2} compactAbove={100_000} />
              </span>
            </HelpTooltip>
          );
        })()}
      </td>
      ),
      // [2] יח' Shopify · פלטפורמה — deterministic units
      shopifyUnitsPlatform: (
      <td data-col-id="shopifyUnitsPlatform" className="px-3 py-2 text-center tabular-nums border-e border-glass-edge/40">
        {(() => {
          const key = campaignKey(a.storeId, a.platform, a.campaignId);
          const info = trueRevenueByKey.get(key);
          if (!info || info.deterministicUnits <= 0) {
            return (
              <HelpTooltip content={`אין הזמנות שסווגו דטרמיניסטית ל-${a.platform} עבור המוצרים המשויכים בטווח הנבחר.`}>
                <span className="text-ink-muted">
                  —
                </span>
              </HelpTooltip>
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
            <HelpTooltip content={tooltip}>
              <span className="font-medium inline-flex items-center gap-0.5">
                <span>{display}</span>
                {isFractional && (
                  <span aria-hidden="true" className="text-[8px] text-ink-muted">*</span>
                )}
              </span>
            </HelpTooltip>
          );
        })()}
      </td>
      ),
      // [3] ערך Shopify · סה"כ — total revenue across all platforms
      shopifyValueTotal: (
      <td data-col-id="shopifyValueTotal" className="metric-cell px-3 py-2 text-center tabular-nums">
        {(() => {
          const key = campaignKey(a.storeId, a.platform, a.campaignId);
          const info = trueRevenueByKey.get(key);
          if (!info || info.productTotals.revenue <= 0) {
            return <span className="text-ink-muted">—</span>;
          }
          return (
            <HelpTooltip content={`סך ערך המכירות ב-Shopify של המוצרים המשויכים בטווח הנבחר, מכל הערוצים יחד (paid + organic + direct).`}>
              <span className="font-medium text-ink-secondary">
                <Money value={info.productTotals.revenue} prefix="none" locale="he-IL" compactAbove={100_000} />
              </span>
            </HelpTooltip>
          );
        })()}
      </td>
      ),
      // [4] יח' Shopify · סה"כ — total units across all platforms
      shopifyUnitsTotal: (
      <td data-col-id="shopifyUnitsTotal" className="px-3 py-2 text-center tabular-nums">
        {(() => {
          const key = campaignKey(a.storeId, a.platform, a.campaignId);
          const info = trueRevenueByKey.get(key);
          if (!info || info.productTotals.units <= 0) {
            return <span className="text-ink-muted">—</span>;
          }
          const total = Math.round(info.productTotals.units);
          return (
            <HelpTooltip content={`סך היחידות שנמכרו ב-Shopify של המוצרים המשויכים בטווח הנבחר, מכל הערוצים יחד.`}>
              <span className="font-medium text-ink-secondary">
                {total}
              </span>
            </HelpTooltip>
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
      <td data-col-id="shopifyOrdersTotal" className="px-3 py-2 text-center tabular-nums">
        {(() => {
          const key = campaignKey(a.storeId, a.platform, a.campaignId);
          const info = trueRevenueByKey.get(key);
          if (!info || info.productTotals.orders <= 0) {
            return <span className="text-ink-muted">—</span>;
          }
          const total = Math.round(info.productTotals.orders);
          return (
            <HelpTooltip content="סך ההזמנות ב-Shopify שכללו את המוצרים המשויכים, בטווח שנבחר, מכל הערוצים. מוצר שמופיע בכמה הזמנות נספר פעם להזמנה; מוצרים מרובים באותה הזמנה מסוכמים פר-מוצר.">
              <span className="font-medium text-ink-secondary">
                {total}
              </span>
            </HelpTooltip>
          );
        })()}
      </td>
      ),
      conversions: (
        <td data-col-id="conversions" className="px-3 py-2 text-center tabular-nums">{formatNumber(a.conversions, 0)}</td>
      ),
      // Column-audit 2026-06-01 (FIX 3) — clicks + impressions raw-volume
      // columns. Aggregated at campaignsAggregator.ts (a.clicks / a.impressions)
      // but had no column. HIDDEN by default (DEFAULT_HIDDEN_COLUMN_IDS) so the
      // table doesn't get wider unless the operator enables them.
      clicks: (
        <td data-col-id="clicks" className="px-3 py-2 text-center tabular-nums text-ink-secondary">{formatNumber(a.clicks, 0)}</td>
      ),
      impressions: (
        <td data-col-id="impressions" className="px-3 py-2 text-center tabular-nums text-ink-secondary">{formatNumber(a.impressions, 0)}</td>
      ),
      ctr: (
        <td data-col-id="ctr" className="px-3 py-2 text-center tabular-nums text-ink-secondary">
          {a.impressions > 0 ? `${(ctr * 100).toFixed(2)}%` : '—'}
        </td>
      ),
      cpc: (
        <td data-col-id="cpc" className="metric-cell px-3 py-2 text-center tabular-nums text-ink-secondary">
          {a.clicks > 0 ? (
            <Money value={cpc} prefix="none" locale="he-IL" decimals={2} compactAbove={100_000} />
          ) : '—'}
        </td>
      ),
      cpm: (
        <td data-col-id="cpm" className="metric-cell px-3 py-2 text-center tabular-nums text-ink-secondary">
          {a.impressions > 0 ? (
            <Money value={cpm} prefix="none" locale="he-IL" decimals={2} compactAbove={100_000} />
          ) : '—'}
        </td>
      ),
      cpa: (
        <td data-col-id="cpa" className="metric-cell px-3 py-2 text-center tabular-nums text-ink-secondary">
          {a.conversions > 0 ? (
            <Money value={cpa} prefix="none" locale="he-IL" decimals={2} compactAbove={100_000} />
          ) : '—'}
        </td>
      ),
      };
      return columnOrder.map(id => (
        <Fragment key={id}>{metricCells[id]}</Fragment>
      ));
      })()}
      <td data-col-id="deepLink" className="px-2 py-2 text-center">
        {link && (
          <HelpTooltip content={`פתח ב-${a.platform} Ads Manager`}>
            <a
              href={link}
              target="_blank"
              rel="noopener noreferrer"
              onClick={e => e.stopPropagation()}
              className="inline-flex items-center justify-center w-7 h-7 rounded text-ink-muted hover:text-accent hover:bg-accent-bg transition-colors"
              aria-label="פתח ב-Ads Manager"
            >
              <ExternalLink size={14} />
            </a>
          </HelpTooltip>
        )}
      </td>
    </tr>
    </HelpTooltip>
  );
}
