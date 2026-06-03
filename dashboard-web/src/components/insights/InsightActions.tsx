'use client';

/**
 * Wave 5 Task 5.6 (P1-10 / Q7) — Actionable insights.
 *
 * Renders the canonical two-button action bar that every insight surface
 * (InsightsBoard, InsightsPanel, WhatsWorking, AttributionAnalysisPanel,
 * HealthScorePanel, CohortComparisonPanel) uses to give the operator a
 * disciplined, predictable way to act on an insight.
 *
 * The contract — locked by Q7 + [[home-visual-rules]]:
 *
 *   1. PRIMARY → "פתח קמפיין" — opens the in-app `CampaignDrawer` for the
 *      campaign the insight refers to. Default behaviour: dispatch a
 *      `roas-open-campaign-drawer` CustomEvent that `CampaignsTable`
 *      listens for; an `onDrill` prop overrides that (used by panels
 *      already mounted inside the drawer — e.g. the cohort table — to
 *      swap drawer scope in place instead of re-opening).
 *
 *   2. SECONDARY → "פתח ב-{Meta|Google|TikTok} Ads Manager ↗" — external
 *      deep-link to the platform's native ads manager UI for the
 *      campaign in question. Uses `buildAdsManagerLink` (the same helper
 *      the campaigns table uses for its row-level external link) so the
 *      account-aware URL is identical whether the user clicks the row
 *      or the insight.
 *
 * Both buttons are independent: an insight without a `campaignId`
 * silently omits the primary (e.g. store-level insights in
 * `InsightsPanel`); an insight on an unmappable platform (organic,
 * shopify) silently omits the secondary.
 *
 * The "drawer default, deep-link secondary" rule (Q7) is intentional —
 * the in-app drawer carries the synthesised verdict (HealthScore +
 * AttributionAnalysis + Cohort) which the platform's native UI can't
 * mirror, so the in-app path stays primary.
 */

import { ExternalLink, ArrowUpRight } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { HelpTooltip } from '@/components/ui/Tooltip';
import { cn } from '@/lib/utils';
import { buildAdsManagerLink, type AdAccountMap } from '@/lib/campaignsLinks';

/**
 * Canonical name the dispatcher fires when the operator clicks the
 * primary action. CampaignsTable subscribes; other components MAY
 * subscribe in the future (e.g. a global mini-drawer outside the
 * campaigns tab). Strongly typed via `OpenCampaignDrawerDetail`.
 */
export const OPEN_CAMPAIGN_DRAWER_EVENT = 'roas-open-campaign-drawer';

export interface OpenCampaignDrawerDetail {
  storeId: string;
  /** Canonical platform tag — matches CampaignRow.platform values. */
  platform: 'Meta' | 'Google' | 'TikTok';
  /** Internal campaign id (matches CampaignRow.campaignId). */
  campaignId: string;
}

/**
 * Dispatch the open-drawer event. Pulled into its own helper so call
 * sites don't reimplement the literal name string and the typed detail
 * stays the single source of truth.
 */
export function dispatchOpenCampaignDrawer(detail: OpenCampaignDrawerDetail): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(
    new CustomEvent<OpenCampaignDrawerDetail>(OPEN_CAMPAIGN_DRAWER_EVENT, { detail }),
  );
}

type Platform = 'Meta' | 'Google' | 'TikTok' | 'organic' | 'shopify';

export interface InsightActionsProps {
  /** Internal campaign id; required to render the primary "open drawer" button. */
  campaignId?: string;
  /** Display-only — used in tooltips / aria-label for the primary button. */
  campaignName?: string;
  platform?: Platform;
  /** Platform's native ID for deep-link. Falls back to `campaignId` (same value 99% of the time). */
  externalCampaignId?: string;
  storeId?: string;
  /** Account map used to build the right deep-link URL. Optional —
   *  without it, we fall back to the campaign-id-only URL form which
   *  still opens the right campaign but may land on the wrong
   *  account. */
  adAccounts?: AdAccountMap;
  /** Override the default in-app open behaviour. Used by panels mounted
   *  inside CampaignDrawer (e.g. CohortComparisonPanel) that want to
   *  swap drawer scope rather than dispatch a new open. */
  onDrill?: () => void;
  /** Hide the primary button entirely — useful when the panel is
   *  already rendered inside the drawer and "פתח קמפיין" would be
   *  a no-op. */
  hidePrimary?: boolean;
  className?: string;
}

const PLATFORM_LABEL: Record<string, string> = {
  Meta: 'Meta',
  Google: 'Google',
  TikTok: 'TikTok',
};

export function InsightActions({
  campaignId,
  campaignName,
  platform,
  externalCampaignId,
  storeId,
  adAccounts,
  onDrill,
  hidePrimary,
  className,
}: InsightActionsProps) {
  // Primary action — drawer. Skipped when:
  //   - explicitly hidden by the parent (already inside the drawer), or
  //   - no campaignId AND no onDrill (nothing meaningful to do).
  const canDrill = !hidePrimary && (Boolean(onDrill) || Boolean(campaignId && storeId && platform));

  // Secondary action — Ads Manager deep-link. Only renders for platforms
  // that have an Ads Manager UI (Meta / Google / TikTok). Organic /
  // Shopify never get a secondary button.
  const isAdsPlatform = platform === 'Meta' || platform === 'Google' || platform === 'TikTok';
  const deepLink = isAdsPlatform && campaignId && storeId
    ? buildAdsManagerLink({
        platform,
        storeId,
        campaignId: externalCampaignId || campaignId,
        accounts: adAccounts ?? {},
      })
    : null;

  if (!canDrill && !deepLink) return null;

  function handlePrimary() {
    if (onDrill) {
      onDrill();
      return;
    }
    if (campaignId && storeId && (platform === 'Meta' || platform === 'Google' || platform === 'TikTok')) {
      dispatchOpenCampaignDrawer({ storeId, platform, campaignId });
    }
  }

  return (
    <div className={cn('inline-flex items-center gap-1.5 flex-wrap', className)}>
      {canDrill && (
        <HelpTooltip content={campaignName ? `פתח את ${campaignName} בלוח הקמפיין` : 'פתח קמפיין'}>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={handlePrimary}
            className="gap-1 px-2 py-1 h-auto text-[11px] font-semibold"
            aria-label={campaignName ? `פתח קמפיין: ${campaignName}` : 'פתח קמפיין'}
          >
            <ArrowUpRight size={11} />
            פתח קמפיין
          </Button>
        </HelpTooltip>
      )}

      {deepLink && isAdsPlatform && (
        <HelpTooltip content={`נפתח ב-${PLATFORM_LABEL[platform]} Ads Manager בלשונית חדשה`}>
          <a
            href={deepLink}
            target="_blank"
            rel="noopener noreferrer"
            className={cn(
              'inline-flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-medium',
              'border border-glass-edge text-ink-secondary',
              'hover:bg-glass-1/80 hover:text-ink hover:border-glass-edge',
              'transition-colors',
            )}
            aria-label={`פתח ב-${PLATFORM_LABEL[platform]} Ads Manager`}
          >
            <ExternalLink size={11} />
            <span>
              פתח ב-<bdi dir="ltr">{PLATFORM_LABEL[platform]} Ads Manager</bdi>
            </span>
          </a>
        </HelpTooltip>
      )}
    </div>
  );
}
