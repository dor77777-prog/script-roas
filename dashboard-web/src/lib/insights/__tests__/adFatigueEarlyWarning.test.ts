// dashboard-web/src/lib/insights/__tests__/adFatigueEarlyWarning.test.ts
import { describe, it, expect } from 'vitest';
import { detectAdFatigueEarlyWarning } from '@/lib/insights/adFatigue';
import type { AdRow } from '@/lib/ads';

// Build N day-rows for one ad. impr/clicks/spend/reach are PER DAY.
function adDays(
  over: Partial<AdRow>,
  days: number,
  per: { impr: number; clicks: number; spend: number; reach: number },
): AdRow[] {
  return Array.from({ length: days }, (_, i) => ({
    date: `2026-05-${String(i + 1).padStart(2, '0')}`,
    storeId: 'uzoshop', storeName: 'uzoshop', platform: 'Meta',
    campaignId: 'c1', campaignName: 'C', adSetId: 'as1', adSetName: 'AS',
    adId: 'a1', adName: 'Creative A',
    spend: per.spend, impressions: per.impr, clicks: per.clicks, conversions: 1,
    conversionValue: 0, reach: per.reach,
    regConfiguredStatus: null, regEffectiveStatus: null, regDeliveryStatus: null,
    regFirstSeenAt: null, regStatusChangedAt: null, regLastStatusSuccessAt: null,
    ...over,
  }));
}

const ewIds = (out: ReturnType<typeof detectAdFatigueEarlyWarning>) =>
  out.filter((i) => i.id.startsWith('ew-fatigue-')).map((i) => i.id);

describe('detectAdFatigueEarlyWarning', () => {
  it('fires when frequency climbs >=20% with healthy CTR/CPM (no strong rule)', () => {
    const prior = adDays({}, 6, { impr: 1000, clicks: 20, spend: 5, reach: 800 });
    const recent = adDays({}, 6, { impr: 1300, clicks: 26, spend: 6.5, reach: 800 }).map(
      (r, i) => ({ ...r, date: `2026-05-${String(i + 7).padStart(2, '0')}` }),
    );
    const out = detectAdFatigueEarlyWarning([...prior, ...recent]);
    expect(ewIds(out)).toContain('ew-fatigue-a1');
  });

  it('is suppressed when the strong CTR-down + CPM-up rule already fires', () => {
    const prior = adDays({}, 6, { impr: 1000, clicks: 40, spend: 5, reach: 800 });
    const recent = adDays({}, 6, { impr: 1300, clicks: 13, spend: 13, reach: 800 }).map(
      (r, i) => ({ ...r, date: `2026-05-${String(i + 7).padStart(2, '0')}` }),
    );
    expect(ewIds(detectAdFatigueEarlyWarning([...prior, ...recent]))).toHaveLength(0);
  });

  it('skips ads with no reach (Google-blind)', () => {
    const prior = adDays({ reach: null }, 6, { impr: 1000, clicks: 20, spend: 5, reach: 0 });
    const recent = adDays({ reach: null }, 6, { impr: 1300, clicks: 26, spend: 6.5, reach: 0 }).map(
      (r, i) => ({ ...r, date: `2026-05-${String(i + 7).padStart(2, '0')}`, reach: null }),
    );
    expect(ewIds(detectAdFatigueEarlyWarning([...prior, ...recent]))).toHaveLength(0);
  });

  it('does not fire on flat frequency', () => {
    const all = adDays({}, 12, { impr: 1000, clicks: 20, spend: 5, reach: 800 });
    expect(ewIds(detectAdFatigueEarlyWarning(all))).toHaveLength(0);
  });

  it('respects the >=12 unique-dates floor', () => {
    const prior = adDays({}, 5, { impr: 1000, clicks: 20, spend: 5, reach: 800 });
    const recent = adDays({}, 5, { impr: 1300, clicks: 26, spend: 6.5, reach: 800 }).map(
      (r, i) => ({ ...r, date: `2026-05-${String(i + 6).padStart(2, '0')}` }),
    );
    expect(ewIds(detectAdFatigueEarlyWarning([...prior, ...recent]))).toHaveLength(0);
  });
});
