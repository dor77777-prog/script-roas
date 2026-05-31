'use client';

/**
 * Task 5.5 (Wave 5) — Ads sub-tab.
 *
 * The dashboard fetches ad-level rows lazily per-ad-set via <AdsDrawer>
 * (nested drawer) — there is no cross-ad-set roll-up here yet. Rather
 * than introduce a new SWR roll-up call in this split (out of scope
 * for Task 5.5 which is presentation only), this tab surfaces a
 * compact list of the campaign's ad sets with a quick-launch button
 * so the operator can open the existing per-ad-set ads drawer without
 * round-tripping back to the AdSets tab.
 *
 * If/when an ads-by-campaign aggregator lands, this tab can mount it
 * here without changing its public API.
 */

import { Layers, ChevronLeft, AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Heading } from '@/components/ui/Typography';
import { fmtMoney } from '@/lib/format';
import { formatNumber } from '@/lib/utils';

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

export interface CampaignDrawerAdsProps {
  adSets: AdSetItem[];
  platform: string;
  onDrillAds: (set: { storeId: string; campaignId: string; adSetId: string; adSetName: string }) => void;
}

export function CampaignDrawerAds({ adSets, platform, onDrillAds }: CampaignDrawerAdsProps) {
  // Google PMax does not surface ad-level rows in the API; calling the
  // drill renderer in that case would mount an empty <AdsDrawer>. Hide
  // the drill buttons + show a hint so the operator isn't sent into a
  // dead end.
  const adDrillSupported = platform === 'Meta' || platform === 'TikTok';
  const drillableSets = adSets.filter(s => !!s.id);

  return (
    <div className="space-y-4" data-testid="campaign-drawer-tab-ads">
      <section>
        <Heading level="panel" className="inline-flex items-center gap-1.5 mb-2">
          <Layers size={14} className="text-ink-secondary" />
          מודעות לפי ad-set
        </Heading>
        <p className="text-[11px] text-ink-muted leading-relaxed bg-glass-2/40 rounded-lg px-3 py-2 mb-3">
          נתוני מודעות נטענים לפי ad-set. בחר ad-set מהרשימה למטה כדי לפתוח את כל המודעות שלו.
          {!adDrillSupported && (
            <span className="mt-1 inline-flex items-center gap-1 text-status-orange">
              <AlertTriangle size={11} className="shrink-0" aria-hidden />
              {platform} לא חושף נתוני מודעות ברמה הזו (PMax / לא נתמך).
            </span>
          )}
        </p>
      </section>

      {drillableSets.length === 0 ? (
        <div className="text-center py-8 text-ink-muted">
          <div className="text-sm">אין ad-sets עם מזהה לדריל-דאון.</div>
        </div>
      ) : (
        <ul className="space-y-1.5">
          {drillableSets.map(set => (
            <li
              key={set.id}
              className="flex items-center justify-between gap-3 px-3 py-2 rounded-lg border border-glass-edge bg-glass-1 hover:bg-glass-2 transition-colors"
            >
              <div className="min-w-0 flex-1">
                <div className="text-xs font-medium text-ink truncate">
                  <bdi dir="ltr">{set.name || '—'}</bdi>
                </div>
                <div className="text-[10px] text-ink-muted tabular-nums mt-0.5">
                  {fmtMoney(set.spend)} · {formatNumber(set.conversions, 0)} המרות
                </div>
              </div>
              {adDrillSupported && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="text-[11px] shrink-0"
                  onClick={() =>
                    onDrillAds({
                      storeId: set.storeId,
                      campaignId: set.campaignId,
                      adSetId: set.id,
                      adSetName: set.name || '—',
                    })
                  }
                  aria-label={`פתח מודעות עבור ${set.name || 'ad-set'}`}
                >
                  פתח מודעות
                  <ChevronLeft size={12} />
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
