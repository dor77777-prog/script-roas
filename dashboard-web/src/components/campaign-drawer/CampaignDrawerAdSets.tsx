'use client';

/**
 * Task 5.5 (Wave 5) — AdSets sub-tab.
 *
 * Thin wrapper around <AdSetTable>. Sort state + the drill-to-Ads handler
 * stay in the parent `index.tsx` so a parent-level <AdsDrawer> can render
 * over this whole sheet (nested-drawer pattern shared with AdsDrawer).
 *
 * Empty state is intentionally separate from the parent's overall "no
 * data" guard — if a campaign has data but zero ad sets (rare, e.g.
 * legacy Google import without ad-group granularity), the tab still
 * renders with an explicit "no ad sets" note rather than silently
 * collapsing.
 */

import { Layers } from 'lucide-react';
import {
  AdSetTable,
  type AdSetSortKey,
  type AdSetSortDir,
} from '../AdSetTable';
import type { AttributionAnalysis } from '@/lib/attributionAnalysis';

interface AdSetItem {
  id: string;
  name: string;
  storeId: string;
  platform: string;
  campaignId: string;
  spend: number;
  value: number;
  clicks: number;
  impressions: number;
  conversions: number;
  adSetBudgetCad: number | null;
  roas: number;
}

export interface CampaignDrawerAdSetsProps {
  adSets: AdSetItem[];
  sortKey: AdSetSortKey;
  sortDir: AdSetSortDir;
  onSort: (key: AdSetSortKey) => void;
  attributionByAdSet: Map<string, AttributionAnalysis | null>;
  optimized: Set<string>;
  onToggleOptimized: (key: string) => void;
  onDrillAds: (set: { storeId: string; campaignId: string; adSetId: string; adSetName: string }) => void;
  /** 2026-06-09 (Task 7) — gates the "מתעדכן…/ממתין…" pending state. Spread to AdSetTable. */
  rangeIncludesToday: boolean;
  /**
   * Ad-set-level product mapping (2026-06-23). Opens the ProductPickerModal
   * scoped to a specific ad-set. The parent (campaign-drawer/index.tsx) owns
   * the picker + the productMap write (setMappedProductsForAdSet).
   */
  onMapProducts: (set: {
    storeId: string;
    platform: string;
    campaignId: string;
    adSetId: string;
    adSetName: string;
  }) => void;
  /**
   * Per-ad-set mapping summary keyed by ad-set id (`AdSetItem.id`):
   *   - `ownCount` — products in the ad-set's OWN mapping (overrides campaign).
   *   - `inheritedCount` — products the ad-set INHERITS from the campaign
   *     mapping (only meaningful when `ownCount === 0`).
   * Drives the row indicator: an own-count chip, or an "inherited" hint.
   */
  mappingByAdSet: Map<string, { ownCount: number; inheritedCount: number }>;
}

export function CampaignDrawerAdSets(props: CampaignDrawerAdSetsProps) {
  if (props.adSets.length === 0) {
    return (
      <div
        className="text-center py-10 text-ink-muted"
        data-testid="campaign-drawer-tab-adsets"
      >
        <Layers size={28} className="mx-auto mb-2 text-ink-subtle" />
        <div className="text-sm">אין נתוני ad-sets לטווח הזה.</div>
      </div>
    );
  }
  return (
    <div data-testid="campaign-drawer-tab-adsets">
      <AdSetTable {...props} />
    </div>
  );
}
