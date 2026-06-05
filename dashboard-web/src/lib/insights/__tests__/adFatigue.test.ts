/**
 * detectAdFatigue — CTR+CPM creative-fatigue rule (+ freqNote when reach present).
 *
 * Flags an ad IFF, comparing the recent half of its date window to the prior
 * half: recentCtr <= 0.7*priorCtr AND recentCpm >= 1.2*priorCpm (CONJUNCTION).
 * Needs >= 12 unique days (>= 6 per half) and (priorImpr + recentImpr) >= 5000.
 *
 * These tests use REAL AdRow rows (no mocks) and the REAL detectAdFatigue.
 */
import { describe, it, expect } from 'vitest';
import { detectAdFatigue } from '@/lib/insights/adFatigue';
import type { AdRow } from '@/lib/ads';
import type { Insight } from '@/lib/insights';

function addDays(dateStr: string, n: number): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

/** A single AdRow with sensible defaults; override per-day metrics via patch. */
function adRow(patch: Partial<AdRow> & { date: string }): AdRow {
  return {
    storeId: 'uzoshop',
    storeName: 'uzoshop',
    platform: 'Meta',
    campaignId: 'camp-1',
    campaignName: 'Camp One',
    adSetId: 'as-1',
    adSetName: 'AdSet One',
    adId: 'ad-1',
    adName: 'Hero Video',
    spend: 0,
    impressions: 0,
    clicks: 0,
    conversions: 0,
    conversionValue: 0,
    regConfiguredStatus: null,
    regEffectiveStatus: null,
    regDeliveryStatus: null,
    regFirstSeenAt: null,
    regStatusChangedAt: null,
    regLastStatusSuccessAt: null,
    ...patch,
  };
}

/**
 * Build a 12-day window (6 prior + 6 recent) for one ad. Each half gets a
 * constant per-day (impressions, clicks, spend) so the aggregated halves are
 * exactly 6× the per-day value.
 */
function buildWindow(opts: {
  base?: string;
  priorPerDay: { impressions: number; clicks: number; spend: number; reach?: number };
  recentPerDay: { impressions: number; clicks: number; spend: number; reach?: number };
  days?: number; // total days; split evenly. default 12.
  patch?: Partial<AdRow>;
}): AdRow[] {
  const base = opts.base ?? '2026-04-01';
  const days = opts.days ?? 12;
  const mid = Math.floor(days / 2);
  const rows: AdRow[] = [];
  for (let i = 0; i < days; i++) {
    const half = i < mid ? opts.priorPerDay : opts.recentPerDay;
    rows.push(
      adRow({
        date: addDays(base, i),
        impressions: half.impressions,
        clicks: half.clicks,
        spend: half.spend,
        ...(half.reach !== undefined ? { reach: half.reach } : {}),
        ...opts.patch,
      }),
    );
  }
  return rows;
}

const fatigueIds = (insights: Insight[]): Insight[] =>
  insights.filter((i) => i.id.startsWith('fatigue-'));

describe('detectAdFatigue — base CTR+CPM conjunction', () => {
  it('(a) full conjunction over 6+ days/half above floor → fires opportunity weight 68 carrying parent campaignId', () => {
    // prior: 1000 impr, 30 clicks (CTR 3.0%), spend 5  → CPM 5
    // recent: 1000 impr, 18 clicks (CTR 1.8% = 0.6× → <=0.7×) , spend 7 → CPM 7 (1.4× → >=1.2×)
    const rows = buildWindow({
      priorPerDay: { impressions: 1000, clicks: 30, spend: 5 },
      recentPerDay: { impressions: 1000, clicks: 18, spend: 7 },
    });
    const out = detectAdFatigue(rows);
    const fat = fatigueIds(out);
    expect(fat).toHaveLength(1);
    const i = fat[0];
    expect(i.id).toBe('fatigue-ad-1');
    expect(i.severity).toBe('opportunity');
    expect(i.kind).toBe('recommendation');
    expect(i.weight).toBe(68);
    // carries PARENT campaign so the drawer + Ads Manager link resolve
    expect(i.campaignId).toBe('camp-1');
    expect(i.campaignName).toBe('Camp One');
    expect(i.platform).toBe('Meta');
    expect(i.storeId).toBe('uzoshop');
    expect(i.title).toBe('עייפות קריאייטיב: Hero Video');
    // Meta href resolves to the ads manager link for the parent campaign
    expect(i.href).toBe(
      'https://business.facebook.com/adsmanager/manage/ads?selected_campaign_ids=camp-1',
    );
  });

  it('(b) CTR drops but CPM flat → NO fire', () => {
    // CTR 3.0% → 1.8% (drops past 0.7×) but CPM 5 → 5 (flat, not >= 1.2×)
    const rows = buildWindow({
      priorPerDay: { impressions: 1000, clicks: 30, spend: 5 },
      recentPerDay: { impressions: 1000, clicks: 18, spend: 5 },
    });
    expect(fatigueIds(detectAdFatigue(rows))).toHaveLength(0);
  });

  it('(c) CPM rises but CTR flat → NO fire', () => {
    // CPM 5 → 7 (rises past 1.2×) but CTR 3.0% → 3.0% (flat, not <= 0.7×)
    const rows = buildWindow({
      priorPerDay: { impressions: 1000, clicks: 30, spend: 5 },
      recentPerDay: { impressions: 1000, clicks: 30, spend: 7 },
    });
    expect(fatigueIds(detectAdFatigue(rows))).toHaveLength(0);
  });

  it('(d) below impression noise floor (<5000 combined) → no fire', () => {
    // Conjunction holds, but 6 prior × 200 + 6 recent × 200 = 2400 < 5000.
    const rows = buildWindow({
      priorPerDay: { impressions: 200, clicks: 6, spend: 1 },
      recentPerDay: { impressions: 200, clicks: 3.6, spend: 1.4 },
    });
    expect(fatigueIds(detectAdFatigue(rows))).toHaveLength(0);
  });

  it('(e) <6 days per half → skip', () => {
    // 10 days total → midIdx 5 prior / 5 recent (< 6 each), even though
    // conjunction would otherwise hold and impressions clear the floor.
    const rows = buildWindow({
      days: 10,
      priorPerDay: { impressions: 1000, clicks: 30, spend: 5 },
      recentPerDay: { impressions: 1000, clicks: 18, spend: 7 },
    });
    expect(fatigueIds(detectAdFatigue(rows))).toHaveLength(0);
  });

  it('(f) ctrDropPct / cpmRisePct math is correct for a known fixture', () => {
    // prior: 1000 impr, 30 clicks (CTR 3.00%), spend 5 → CPM 5.00
    // recent: 1000 impr, 18 clicks (CTR 1.80%), spend 7 → CPM 7.00
    // ctrDropPct = round((1 - 1.8/3.0)*100) = round(40) = 40
    // cpmRisePct = round((7/5 - 1)*100) = round(40) = 40
    const rows = buildWindow({
      priorPerDay: { impressions: 1000, clicks: 30, spend: 5 },
      recentPerDay: { impressions: 1000, clicks: 18, spend: 7 },
    });
    const i = fatigueIds(detectAdFatigue(rows))[0];
    expect(i.detail).toBe(
      'CTR ירד 40% ו-CPM עלה 40% בחצי האחרון. שקול לרענן קריאייטיב.',
    );
    // why: CTR 3.00%→1.80%, CPM CAD 5→CAD 7 (חציון לחצי).
    // (fmtMoneyString rounds money to integer CAD by default)
    expect(i.why).toBe('CTR 3.00%→1.80%, CPM CAD 5→CAD 7 (חציון לחצי).');
  });

  it('(g) divide-by-zero guard: ad with 0 prior impressions → no crash, no fire', () => {
    // Prior half has zero impressions (priorImpr === 0). Must not throw and
    // must not fire (priorCtr / priorCpm undefined-ish are guarded).
    const rows = buildWindow({
      priorPerDay: { impressions: 0, clicks: 0, spend: 0 },
      recentPerDay: { impressions: 2000, clicks: 20, spend: 14 },
    });
    let out: ReturnType<typeof detectAdFatigue> = [];
    expect(() => {
      out = detectAdFatigue(rows);
    }).not.toThrow();
    expect(fatigueIds(out)).toHaveLength(0);
  });

  it('groups by store::platform::adId and carries each parent campaign independently', () => {
    // Two different ads under two different campaigns, both fatigued.
    const adA = buildWindow({
      priorPerDay: { impressions: 1000, clicks: 30, spend: 5 },
      recentPerDay: { impressions: 1000, clicks: 18, spend: 7 },
      patch: { adId: 'ad-A', adName: 'Ad A', campaignId: 'camp-A', campaignName: 'Camp A' },
    });
    const adB = buildWindow({
      priorPerDay: { impressions: 1200, clicks: 36, spend: 6 },
      recentPerDay: { impressions: 1200, clicks: 21, spend: 9 },
      patch: { adId: 'ad-B', adName: 'Ad B', campaignId: 'camp-B', campaignName: 'Camp B' },
    });
    const out = fatigueIds(detectAdFatigue([...adA, ...adB]));
    expect(out).toHaveLength(2);
    const byId = new Map(out.map((i) => [i.id, i]));
    expect(byId.get('fatigue-ad-A')!.campaignId).toBe('camp-A');
    expect(byId.get('fatigue-ad-B')!.campaignId).toBe('camp-B');
  });

  it('(h) freqNote appended to detail when reach present on both halves and frequency climbs', () => {
    // Strong rule fires: CTR 3.0%→1.8% (<=0.7×) AND CPM 5→7 (>=1.2×).
    // Reach present on both halves with climbing frequency: prior reach=800 → freq 1.25,
    // recent reach=640 → freq ≈ 1.56 → climbs.
    // prior: 1000 impr / 800 reach = 1.25; recent: 1000 impr / 640 reach ≈ 1.5625 → climbs
    const rows = buildWindow({
      priorPerDay: { impressions: 1000, clicks: 30, spend: 5, reach: 800 },
      recentPerDay: { impressions: 1000, clicks: 18, spend: 7, reach: 640 },
      // reach 640 → freq = 1000/640 = 1.5625 > prior 1.25 → freqNote fires
    });
    const out = fatigueIds(detectAdFatigue(rows));
    expect(out).toHaveLength(1);
    expect(out[0].detail).toContain('התדירות עלתה');
  });
});
