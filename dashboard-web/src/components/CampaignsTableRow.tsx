'use client';

import { CheckCircle2, Circle, ExternalLink } from 'lucide-react';
import { cn, formatCurrency, formatNumber } from '@/lib/utils';
import { campaignKey } from '@/lib/campaignProductMap';
import { buildAdsManagerLink, type AdAccountMap } from '@/lib/campaignsLinks';
import { roasLabel } from '@/lib/analytics';
import type { Aggregated } from '@/lib/campaignsAggregator';
import type { ConfidenceLevel, TrueRevenueInfo } from '@/lib/hooks/useCampaignTrueRevenue';
import type { AttributionTrust } from '@/lib/attributionAnalysis';

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
  return level === 'high'   ? 'bg-roas-greenBg/60 text-roas-green'
       : level === 'medium' ? 'bg-amber-50 text-amber-700'
       :                      'bg-roas-redBg/60 text-roas-red';
}

// Duplicated from CampaignsTable.tsx:199-205 per D-04 (target-soft cap) —
// leaving this tiny lookup table colocated with the row that uses it
// avoids creating a wrapper module for 6 lines. Same 5-entry shape as
// the parent's copy + AdSetTable's copy (both are byte-identical).
const TONE_BG: Record<string, string> = {
  red:    'bg-roas-redBg text-roas-red',
  orange: 'bg-roas-orangeBg text-roas-orange',
  green:  'bg-roas-greenBg text-roas-green',
  blue:   'bg-roas-blueBg text-roas-blue',
  gray:   'bg-surfaceMuted text-text-muted',
};

type Props = {
  a: Aggregated;
  i: number;
  mode: 'campaign' | 'adset';
  trueRevenueByKey: Map<string, TrueRevenueInfo>;
  adAccounts: AdAccountMap;
  optimized: Set<string>;
  onToggleOptimized: (key: string) => void;
  onDrillCampaign: (campaignId: string, platform: string, storeId: string) => void;
  onDrillAd: (set: { storeId: string; campaignId: string; adSetId: string; adSetName: string }) => void;
};

export function CampaignsTableRow({
  a,
  i,
  mode,
  trueRevenueByKey,
  adAccounts,
  optimized,
  onToggleOptimized,
  onDrillCampaign,
  onDrillAd,
}: Props) {
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
        'border-b border-borderSubtle hover:bg-surfaceMuted/40 cursor-pointer transition-opacity',
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
        } else if (mode === 'adset' && a.adSetId && a.platform === 'Meta') {
          // Ad-set click → drill deeper into individual ads.
          // Only Meta — Google ad-level isn't fetched yet.
          onDrillAd({
            storeId: a.storeId,
            campaignId: a.campaignId,
            adSetId: a.adSetId,
            adSetName: a.adSetName || a.campaignName,
          });
        }
      }}
      title={
        mode === 'campaign'
          ? 'לחץ לפרטים מלאים'
          : mode === 'adset' && a.platform === 'Meta'
          ? 'לחץ לראות את המודעות באד-סט'
          : undefined
      }
    >
      {/* Per-row optimization toggle. Clicking flips the mark
          without bubbling into the row click (which would
          open the drawer). The empty Circle is the un-marked
          state; CheckCircle2 in green is the marked state. */}
      <td className="px-2 py-2 text-center w-[36px]">
        <button
          type="button"
          onClick={e => {
            e.stopPropagation();
            onToggleOptimized(a.key);
          }}
          className={cn(
            'inline-flex items-center justify-center w-7 h-7 rounded-full transition-colors',
            isOptimized
              ? 'text-roas-green hover:bg-roas-greenBg/60'
              : 'text-text-muted hover:text-roas-green hover:bg-roas-greenBg/40',
          )}
          title={isOptimized ? 'לחץ להסרת הסימון' : 'סמן כאופטימיזציה בוצעה'}
          aria-label={isOptimized ? 'בטל סימון אופטימיזציה' : 'סמן כאופטימיזציה בוצעה'}
          aria-pressed={isOptimized}
        >
          {isOptimized ? <CheckCircle2 size={18} /> : <Circle size={18} />}
        </button>
      </td>
      <td className="px-3 sm:px-5 py-2 max-w-[280px] sm:max-w-[400px]">
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-surfaceMuted text-[10px] font-bold text-text-secondary tabular-nums shrink-0">
            {i + 1}
          </span>
          <div className="min-w-0 flex-1">
            <div className="font-medium text-text-primary truncate flex items-center gap-1.5">
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
                      ? 'bg-primary/10 text-primary'
                      : 'bg-purple-100 text-purple-700',
                  )}
                  title={a.budgetType === 'CBO' ? 'Campaign Budget Optimization — תקציב ברמת קמפיין' : 'Ad-Set Budget Optimization — תקציב ברמת ad-set'}
                >
                  {a.budgetType}
                </span>
              )}
            </div>
            <div
              className="text-[10px] sm:text-[11px] text-text-muted truncate"
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
      <td className="px-3 py-2 text-end tabular-nums">{formatCurrency(a.spend)}</td>
      <td className="px-3 py-2 text-end tabular-nums">
        {(() => {
          const budget = mode === 'campaign' ? a.campaignBudgetCad : a.adSetBudgetCad;
          if (!budget || budget <= 0) {
            return <span className="text-text-muted">—</span>;
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
      <td className={cn('px-3 py-2 text-end tabular-nums font-medium', a.conversionValue > a.spend && 'text-roas-green')}>
        {formatCurrency(a.conversionValue)}
      </td>
      <td className={cn('px-3 py-2 text-center font-semibold tabular-nums rounded', TONE_BG[info.tone])}>
        {roas > 0 ? formatNumber(roas) : '—'}
      </td>
      {/* Shopify-true ROAS column. Only campaigns with a
          product mapping show a number; everything else
          shows '—' with a hint. Google rows always '—'
          because PMax doesn't expose per-product mapping
          (the feed governs delivery, not the campaign). */}
      <td className="px-3 py-2 text-center">
        {(() => {
          const key = campaignKey(a.storeId, a.platform, a.campaignId);
          const info = trueRevenueByKey.get(key);
          if (!info) {
            return (
              <span
                className="text-text-muted text-xs"
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
          return (
            <div className="inline-flex flex-col items-center gap-0.5" title={tooltip}>
              <span className="font-semibold tabular-nums text-text-primary">
                {trueRoas > 0 ? formatNumber(trueRoas) : '—'}
              </span>
              <span className={cn('inline-block text-[8px] font-bold px-1 py-0 rounded uppercase tracking-wider', confTone)}>
                {trustLabel}
                {useAttr ? (
                  <span className="ms-1 opacity-70">·{info.attribution!.deterministicOrders}</span>
                ) : (
                  // Marker so the operator can tell at a glance
                  // that this chip comes from the heuristic, not
                  // from click-id. Lowercase + opacity so it
                  // reads as a subdued sub-label, not noise.
                  <span className="ms-1 opacity-70 normal-case">·מיפוי</span>
                )}
              </span>
            </div>
          );
        })()}
      </td>
      {/* Shopify actuals — ערך + יחידות. Empty cells when
          there's no mapping so the row stays cleanly
          aligned with mapped + unmapped campaigns. */}
      <td className="px-3 py-2 text-end tabular-nums">
        {(() => {
          const key = campaignKey(a.storeId, a.platform, a.campaignId);
          const info = trueRevenueByKey.get(key);
          if (!info || info.trueRevenue <= 0) {
            return <span className="text-text-muted">—</span>;
          }
          return (
            <span className="font-medium" title="ערך המכירות בפועל ב-Shopify של המוצרים המשויכים — מוקצה פרופורציונלית להוצאה כשהמוצר חולק עם קמפיינים אחרים">
              {formatCurrency(info.trueRevenue)}
            </span>
          );
        })()}
      </td>
      <td className="px-3 py-2 text-end tabular-nums">
        {(() => {
          const key = campaignKey(a.storeId, a.platform, a.campaignId);
          const info = trueRevenueByKey.get(key);
          if (!info || info.trueUnits <= 0) {
            return <span className="text-text-muted">—</span>;
          }
          return (
            <span className="font-medium" title="יחידות שנמכרו בפועל ב-Shopify של המוצרים המשויכים — מוקצה פרופורציונלית להוצאה">
              {formatNumber(info.trueUnits, info.trueUnits >= 10 ? 0 : 1)}
            </span>
          );
        })()}
      </td>
      <td className="px-3 py-2 text-end tabular-nums">{formatNumber(a.conversions, 0)}</td>
      <td className="px-3 py-2 text-end tabular-nums text-text-secondary">
        {a.impressions > 0 ? `${(ctr * 100).toFixed(2)}%` : '—'}
      </td>
      <td className="px-3 py-2 text-end tabular-nums text-text-secondary">
        {a.clicks > 0 ? formatCurrency(cpc, 2) : '—'}
      </td>
      <td className="px-3 py-2 text-end tabular-nums text-text-secondary">
        {a.impressions > 0 ? formatCurrency(cpm, 2) : '—'}
      </td>
      <td className="px-3 py-2 text-end tabular-nums text-text-secondary">
        {a.conversions > 0 ? formatCurrency(cpa, 2) : '—'}
      </td>
      <td className="px-2 py-2 text-center">
        {link && (
          <a
            href={link}
            target="_blank"
            rel="noopener noreferrer"
            onClick={e => e.stopPropagation()}
            className="inline-flex items-center justify-center w-7 h-7 rounded text-text-muted hover:text-primary hover:bg-primary/8 transition-colors"
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
