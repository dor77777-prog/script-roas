'use client';

/**
 * Task 5.5 (Wave 5) — Overview sub-tab.
 *
 * Reorg 2026-06-03 (Task 1): the tab now OPENS to an at-a-glance summary
 * instead of a stacked wall of 8 sections. Structure (faithful to the
 * approved mockup `docs/superpowers/mockups/2026-06-03-overview-tab/`):
 *
 *   1. SCORECARD — 4 always-visible `Stat`/`Badge` tiles surfacing the
 *      headline signals: ROAS (+ band Badge) · ערך-המרות · אמינות
 *      attribution (the trust score `/100`, reused verbatim from the SAME
 *      `analysis.trust` that `AttributionAnalysisPanel` reads — never
 *      recomputed from raw totals) · ציון בריאות (the grade/early-state
 *      from the existing `health` prop).
 *   2. KPI grid (operational metrics only) — always visible, de-duplicated:
 *      הוצאה · המרות · CTR · CPC · CPA. ROAS and ערך-המרות live exclusively
 *      in the scorecard (no duplication).
 *   3. Collapsible accordions (`<details>`, the existing `details.acc`
 *      token pattern copied from `CustomerValueTab` / `PnLBreakdown`):
 *      the FULL HealthScorePanel, mapped-products block,
 *      CohortComparisonPanel, AttributionAnalysisPanel,
 *      ProductChannelBreakdown, and MetaShopifyReconciliation — each
 *      preserved byte-for-byte, only collapsed. Attribution is open by
 *      default; the rest start collapsed. ZERO info loss.
 *
 * Stateful helpers (productMap, cohort, etc.) all live in the parent
 * `index.tsx` and are passed down as props so this file stays a thin
 * presentation layer.
 */

import { Package, Edit3, ChevronDown } from 'lucide-react';
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
import type { CampaignHealth, HealthGrade } from '@/lib/campaignHealthScore';
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

// ────────────────────────────────────────────────────────────────────────
// Scorecard helpers — surface the SAME computed signals the deep panels
// read, never a re-derivation from raw totals.
// ────────────────────────────────────────────────────────────────────────

/** Map the attribution trust LEVEL (verbatim from `analysis.trust`, the same
 *  field `AttributionAnalysisPanel` renders) to a Badge tone. */
const TRUST_TONE: Record<AttributionAnalysis['trust']['level'], BadgeTone> = {
  high: 'green',
  medium: 'warning',
  low: 'red',
  unknown: 'gray',
};

/** Map the health GRADE (verbatim from `health.grade`, the same letter the
 *  HealthScorePanel renders) to a Badge tone + short Hebrew label. Mirrors
 *  the panel's own grade→label table so the scorecard tile reads identically
 *  to the full panel inside the accordion. */
const HEALTH_GRADE_META: Record<HealthGrade, { tone: BadgeTone; label: string }> = {
  A: { tone: 'green', label: 'מצוין' },
  B: { tone: 'blue', label: 'בריא' },
  C: { tone: 'orange', label: 'גבולי' },
  D: { tone: 'red', label: 'בעייתי' },
  F: { tone: 'red', label: 'כשל' },
  unknown: { tone: 'gray', label: 'מוקדם מדי' },
};

/**
 * Styled `<details>` accordion — copies the existing `details.acc` token
 * conventions used in `CustomerValueTab` / `PnLBreakdown`: a hairline
 * `border-glass-edge` Card-consistent surface, a marker-less `<summary>`
 * (title + optional chip on the start, a rotating caret on the end), and
 * the body padded below. Token-driven, RTL-safe (logical spacing), no
 * hardcoded colours — so light + dark both stay native.
 */
function OverviewAccordion({
  title,
  icon,
  chip,
  open,
  children,
}: {
  title: ReactNode;
  icon?: ReactNode;
  chip?: ReactNode;
  open?: boolean;
  children: ReactNode;
}) {
  return (
    <details
      open={open}
      className="group rounded-card border border-glass-edge bg-glass-2/40 overflow-hidden"
    >
      <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-3 py-2.5 marker:hidden [&::-webkit-details-marker]:hidden">
        <span className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-ink">
          {icon}
          {title}
          {chip}
        </span>
        <ChevronDown
          size={15}
          className="shrink-0 text-ink-muted transition-transform group-open:rotate-180"
          aria-hidden="true"
        />
      </summary>
      <div className="px-3 pb-3">{children}</div>
    </details>
  );
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

  // Scorecard signals — reused verbatim from the SAME objects the deep
  // panels read (never recomputed from raw totals).
  const trust = analysis?.trust ?? null;
  const healthMeta = health ? HEALTH_GRADE_META[health.grade] : null;
  // Early-state grade (insufficient sample) renders the ⏳ glyph the panel
  // also uses, instead of the letter.
  const healthGlyph =
    health == null
      ? '—'
      : health.insufficient || health.grade === 'unknown'
        ? '⏳'
        : health.grade;

  return (
    <div className="space-y-5 sm:space-y-6" data-testid="campaign-drawer-tab-overview">
      {/* ── 1. SCORECARD — at-a-glance signals, always visible ───────── */}
      <div
        data-testid="overview-scorecard"
        className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 sm:gap-3"
      >
        <Stat
          label="ROAS"
          value={summary.roas > 0 ? formatNumber(summary.roas) : '—'}
          chip={<Badge tone={roasInfo.tone as BadgeTone}>{roasInfo.text}</Badge>}
        />
        <Stat
          label="ערך המרות"
          value={formatCurrency(summary.value)}
          prefix="CAD"
          accent={summary.value > summary.spend ? 'positive' : 'neutral'}
        />
        <Stat
          label="אמינות attribution"
          value={
            <span data-testid="overview-sc-trust">
              {trust ? `${trust.score.toFixed(0)}` : '—'}
              {trust && <span className="text-[11px] text-ink-muted">/100</span>}
            </span>
          }
          chip={
            trust ? (
              <Badge tone={TRUST_TONE[trust.level]}>{trust.label}</Badge>
            ) : undefined
          }
        />
        <Stat
          label="ציון בריאות"
          value={<span data-testid="overview-sc-health">{healthGlyph}</span>}
          chip={
            healthMeta ? (
              <Badge tone={healthMeta.tone}>{healthMeta.label}</Badge>
            ) : undefined
          }
        />
      </div>

      {/* ── 2. KPI grid — operational metrics only (no ROAS/ערך dup) ─── */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 sm:gap-3">
        <Stat label="הוצאה" value={formatCurrency(summary.spend)} prefix="CAD" />
        <Stat label="המרות" value={formatNumber(summary.conversions, 0)} />
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

      {/* ── 3. Collapsible deep analyses (zero info loss) ────────────── */}
      <div className="space-y-2.5">
        <Heading level="panel" className="text-ink-secondary">
          ניתוח מעמיק
          <span className="ms-1.5 text-[11px] font-normal text-ink-muted">
            (נפתח בלחיצה)
          </span>
        </Heading>

        {health && (
          <OverviewAccordion
            title="ציון בריאות קמפיין"
            chip={
              healthMeta ? (
                <Badge tone={healthMeta.tone}>{healthMeta.label}</Badge>
              ) : undefined
            }
          >
            <HealthScorePanel
              health={health}
              campaignId={summary.campaignId}
              campaignName={summary.campaignName}
              platform={adsPlatform}
              storeId={summary.storeId}
            />
          </OverviewAccordion>
        )}

        {showMappedProducts && (
          <OverviewAccordion
            icon={<Package size={14} className="text-ink-secondary" />}
            title="מוצרי Shopify משויכים"
            chip={
              mappedIds.length > 0 ? (
                <Badge tone="blue">{mappedIds.length}</Badge>
              ) : undefined
            }
          >
            <div className="flex items-center justify-end gap-2 mb-2">
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
                      variant="rich"
                      withinDrawer
                      content={
                        others.length > 0
                          ? `${id}\nגם משויך ל: ${others.join(', ')}`
                          : id
                      }
                    >
                      <li className="inline-flex items-center gap-1 text-[11px] bg-accent-soft text-accent px-2 py-0.5 rounded-md font-mono">
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
                <p className="text-[10px] text-ink-muted leading-relaxed mt-2 bg-status-warningBg border border-status-warning rounded-lg px-3 py-1.5">
                  🔗 חלק מהמוצרים גם משויכים לקמפיינים אחרים. ה-ROAS Shopify
                  של הקמפיין הזה מחושב לפי <strong>חלקו של הקמפיין בהוצאה</strong>{' '}
                  (חלוקה פרופורציונלית) — לא לפי כל ההכנסה של המוצר.
                </p>
              )}
          </OverviewAccordion>
        )}

        {cohort && (
          <OverviewAccordion title="השוואת cohort — קמפיינים שחולקים מוצרים">
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
          </OverviewAccordion>
        )}

        {analysis && (
          <OverviewAccordion
            title="ניתוח attribution"
            open
            chip={
              <Badge tone={TRUST_TONE[analysis.trust.level]}>
                {analysis.trust.label} · {analysis.trust.score.toFixed(0)}
              </Badge>
            }
          >
            <AttributionAnalysisPanel
              analysis={analysis}
              spend={summary.spend}
              value={summary.value}
              campaignId={summary.campaignId}
              campaignName={summary.campaignName}
              platform={adsPlatform}
              storeId={summary.storeId}
            />
          </OverviewAccordion>
        )}

        {productChannelBreakdown && (
          <OverviewAccordion title="פילוח מוצר × ערוץ">
            <ProductChannelBreakdown breakdown={productChannelBreakdown} />
          </OverviewAccordion>
        )}

        {reconciliation && (
          <OverviewAccordion title="התאמת Meta↔Shopify">
            <MetaShopifyReconciliation reconciliation={reconciliation} />
          </OverviewAccordion>
        )}
      </div>
    </div>
  );
}
