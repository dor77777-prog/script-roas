'use client';

/**
 * Task 5.5 (Wave 5) — Overview sub-tab.
 *
 * Top-of-drawer summary surface: ROAS / spend / value / conversions stat
 * grid, the secondary CTR / CPC / CPA strip, then the analytic panels that
 * synthesise "what does this campaign mean": HealthScorePanel,
 * AttributionAnalysisPanel, MetaShopifyReconciliation,
 * ProductChannelBreakdown, CohortComparisonPanel, mapped-products section.
 *
 * Stateful helpers (productMap, cohort, etc.) all live in the parent
 * `index.tsx` and are passed down as props so this file stays a thin
 * presentation layer — keeps the sub-tab swap cheap and avoids
 * duplicating SWR fetches across tabs.
 */

import { Package, Edit3 } from 'lucide-react';
import type { ReactNode } from 'react';
import { Badge, type BadgeTone } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { HelpTooltip } from '@/components/ui/Tooltip';
import { Stat } from '@/components/ui/Stat';
import { Heading } from '@/components/ui/Typography';
import { formatCurrency, formatNumber } from '@/lib/utils';
import { fmtMoney } from '@/lib/format';
import { roasLabel } from '@/lib/analytics';
import { AttributionAnalysisPanel } from '../AttributionAnalysisPanel';
import { CohortComparisonPanel } from '../CohortComparisonPanel';
import { HealthScorePanel } from '../HealthScorePanel';
import { dispatchOpenCampaignDrawer } from '../insights/InsightActions';
import {
  MetaShopifyReconciliation,
  buildReconciliation,
} from '../MetaShopifyReconciliation';
import { ProductChannelBreakdown } from '../ProductChannelBreakdown';
import type { CampaignHealth } from '@/lib/campaignHealthScore';
import type {
  AttributionAnalysis,
  ProductChannelBreakdown as ProductChannelBreakdownT,
} from '@/lib/attributionAnalysis';
import type { MultiMappingCohort } from '@/lib/multiMappingCohort';
import type { CannibalizationVerdict } from '@/lib/cannibalizationDetection';

type ReconciliationResult = NonNullable<ReturnType<typeof buildReconciliation>>;

export interface OverviewSummary {
  campaignName: string;
  storeName: string;
  platform: string;
  spend: number;
  value: number;
  clicks: number;
  impressions: number;
  conversions: number;
  roas: number;
  ctr: number;
  cpc: number;
  cpa: number;
  activeDays: number;
  // Task 5.6 (P1-10 / Q7) — identifiers needed by `InsightActions` to
  // render the Ads Manager deep-link secondary inside HealthScorePanel
  // and AttributionAnalysisPanel. Optional so existing callers in tests
  // / older entry points don't crash; the panels gracefully omit the
  // secondary action when these are missing.
  campaignId?: string;
  storeId?: string;
}

export interface CampaignDrawerOverviewProps {
  summary: OverviewSummary;
  health?: CampaignHealth;
  analysis: AttributionAnalysis | null;
  reconciliation: ReconciliationResult | null;
  productChannelBreakdown: ProductChannelBreakdownT | null;
  cohort: MultiMappingCohort | null;
  cannibalizationVerdicts: CannibalizationVerdict[];
  mappedIds: string[];
  otherCampaignsByProduct: Map<string, string[]>;
  onEditMapping: () => void;
  /** Optional slot for the TikTok store-mapping section (only renders
   *  when the parent decides it's TikTok). */
  storeMappingSlot?: ReactNode;
}

export function CampaignDrawerOverview({
  summary,
  health,
  analysis,
  reconciliation,
  productChannelBreakdown,
  cohort,
  cannibalizationVerdicts,
  mappedIds,
  otherCampaignsByProduct,
  onEditMapping,
  storeMappingSlot,
}: CampaignDrawerOverviewProps) {
  const roasInfo = roasLabel(summary.roas);
  const showMappedProducts =
    summary.platform === 'Meta' || summary.platform === 'TikTok';

  // Task 5.6 — narrow the free-form `summary.platform: string` to the
  // 3 ad-platforms union that InsightActions expects. Anything else
  // (e.g. legacy 'organic' / 'shopify' surfaces that might end up in
  // the drawer in future) leaves it undefined so the Ads Manager
  // deep-link footer hides entirely.
  const adsPlatform: 'Meta' | 'Google' | 'TikTok' | undefined =
    summary.platform === 'Meta' ||
    summary.platform === 'Google' ||
    summary.platform === 'TikTok'
      ? summary.platform
      : undefined;

  return (
    <div className="space-y-5 sm:space-y-6" data-testid="campaign-drawer-tab-overview">
      {health && (
        <HealthScorePanel
          health={health}
          campaignId={summary.campaignId}
          campaignName={summary.campaignName}
          platform={adsPlatform}
          storeId={summary.storeId}
        />
      )}

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 sm:gap-3">
        <Stat
          label="ROAS"
          value={summary.roas > 0 ? formatNumber(summary.roas) : '—'}
          chip={<Badge tone={roasInfo.tone as BadgeTone}>{roasInfo.text}</Badge>}
        />
        <Stat label="הוצאה" value={formatCurrency(summary.spend)} prefix="CAD" />
        <Stat
          label="ערך המרות"
          value={formatCurrency(summary.value)}
          prefix="CAD"
          accent={summary.value > summary.spend ? 'positive' : 'neutral'}
        />
        <Stat label="המרות" value={formatNumber(summary.conversions, 0)} />
      </div>

      <div className="grid grid-cols-3 gap-2 sm:gap-3">
        <Stat
          density="compact"
          label="CTR"
          value={summary.impressions > 0 ? `${(summary.ctr * 100).toFixed(2)}%` : '—'}
        />
        <Stat
          density="compact"
          label="CPC"
          value={summary.clicks > 0 ? fmtMoney(summary.cpc, 'CAD', 2) : '—'}
        />
        <Stat
          density="compact"
          label="CPA"
          value={summary.conversions > 0 ? fmtMoney(summary.cpa, 'CAD', 2) : '—'}
        />
      </div>

      {storeMappingSlot}

      {showMappedProducts && (
        <section>
          <div className="flex items-center justify-between gap-2 mb-2">
            <Heading level="panel" className="inline-flex items-center gap-1.5">
              <Package size={14} className="text-ink-secondary" />
              מוצרי Shopify משויכים
              {mappedIds.length > 0 && (
                <span className="text-[10px] font-medium text-ink-muted">
                  ({mappedIds.length})
                </span>
              )}
            </Heading>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={onEditMapping}
              className="text-[11px]"
            >
              <Edit3 size={12} />
              {mappedIds.length > 0 ? 'ערוך מיפוי' : 'שייך מוצרים'}
            </Button>
          </div>
          {mappedIds.length === 0 ? (
            <p className="text-[11px] text-ink-muted leading-relaxed bg-glass-2/40 rounded-lg px-3 py-2">
              לא משויכים מוצרים. לאחר שיוך, ה-ROAS יחושב מחדש לפי מכירות{' '}
              Shopify אמיתיות במקום ערך ההמרה ש-{summary.platform} דיווחה (לרוב מנופח).
            </p>
          ) : (
            <ul className="flex flex-wrap gap-1.5">
              {mappedIds.map(id => {
                const others = otherCampaignsByProduct.get(id) ?? [];
                return (
                  <HelpTooltip
                    key={id}
                    content={
                      others.length > 0
                        ? `${id}\nגם משויך ל: ${others.join(', ')}`
                        : id
                    }
                  >
                    <li className="inline-flex items-center gap-1 text-[11px] bg-accent/8 text-accent px-2 py-0.5 rounded-md font-mono">
                      <Package size={10} />
                      <span className="truncate max-w-[120px]">{id}</span>
                      {others.length > 0 && (
                        <span
                          className="text-status-warningFg text-[9px] font-sans ms-1"
                          aria-label={`גם משויך ל-${others.length} קמפיינים אחרים`}
                        >
                          🔗 +{others.length}
                        </span>
                      )}
                    </li>
                  </HelpTooltip>
                );
              })}
            </ul>
          )}
          {mappedIds.length > 0 &&
            mappedIds.some(id => (otherCampaignsByProduct.get(id) ?? []).length > 0) && (
              <p className="text-[10px] text-ink-muted leading-relaxed mt-2 bg-status-warningBg border border-status-warning/30 rounded-lg px-3 py-1.5">
                🔗 חלק מהמוצרים גם משויכים לקמפיינים אחרים. ה-ROAS Shopify
                של הקמפיין הזה מחושב לפי <strong>חלקו של הקמפיין בהוצאה</strong>{' '}
                (חלוקה פרופורציונלית) — לא לפי כל ההכנסה של המוצר.
              </p>
            )}
        </section>
      )}

      {cohort && (
        <CohortComparisonPanel
          cohort={cohort}
          cannibalizationVerdicts={cannibalizationVerdicts}
          onDrillCampaign={(targetCampaignId, targetPlatform, targetStoreId) => {
            // Task 5.6 (P1-10 / Q7) — wire the no-op console log up to
            // the real open-drawer event. CampaignsTable subscribes via
            // `roas-open-campaign-drawer`; clicking a non-current cohort
            // member now swaps the drawer in place. Platform string from
            // CohortMember is already constrained to the 3 ads platforms
            // at this scope — the cohort only contains ad-platform
            // members (Meta / Google / TikTok).
            if (
              targetPlatform === 'Meta' ||
              targetPlatform === 'Google' ||
              targetPlatform === 'TikTok'
            ) {
              dispatchOpenCampaignDrawer({
                storeId: targetStoreId,
                platform: targetPlatform,
                campaignId: targetCampaignId,
              });
            }
          }}
        />
      )}

      {analysis && (
        <AttributionAnalysisPanel
          analysis={analysis}
          spend={summary.spend}
          value={summary.value}
          campaignId={summary.campaignId}
          campaignName={summary.campaignName}
          platform={adsPlatform}
          storeId={summary.storeId}
        />
      )}

      {productChannelBreakdown && (
        <ProductChannelBreakdown breakdown={productChannelBreakdown} />
      )}

      {reconciliation && <MetaShopifyReconciliation reconciliation={reconciliation} />}
    </div>
  );
}
