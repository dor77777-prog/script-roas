/**
 * detectCampaignDied — "an established campaign suddenly went dark".
 *
 * Mirrors the dead-day current-day suppression pattern
 * (`insightsDeadDayCurrentDay.test.ts`): the CURRENT in-progress Israel day
 * is excluded from the "did it go dark?" read, so a still-loading morning
 * (today's row not yet written, or written with partial spend) never
 * false-fires. The most-recent COMPLETED day = today-1.
 *
 * Establishment gate : priorActiveDays >= 7 AND meanDaily >= 50
 * Dark gate          : recentSpend (today-1) <= 1
 * Emit only if BOTH pass → severity 'critical', kind 'anomaly', weight 96.
 */
import { describe, it, expect } from 'vitest';
import { detectCampaignDied } from '@/lib/insights/campaignDied';
import { fmtMoneyString } from '@/lib/format';
import type { CampaignRow } from '@/lib/campaigns';
import type { AdStateMap } from '@/lib/adState';

// Deterministic 'today' seam — never let wall-clock drift flake the suite.
const TODAY = '2026-06-04';

function addDays(dateStr: string, n: number): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

function row(patch: Partial<CampaignRow> & { date: string }): CampaignRow {
  return {
    storeId: 'uzoshop',
    storeName: 'uzoshop',
    platform: 'Meta',
    campaignId: 'c1',
    campaignName: 'Prospecting — Cold',
    adSetId: 'as1',
    adSetName: 'as1',
    spend: 0,
    impressions: 0,
    clicks: 0,
    conversions: 0,
    conversionValue: 0,
    campaignBudgetCad: null,
    adSetBudgetCad: null,
    budgetType: '',
    effectiveStatus: null,
    lastLiveTickAt: null,
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
 * Builds an established campaign. `activeDays` = number of prior-window days
 * with real spend (each spending `daily`), placed at [today-activeDays-1 ..
 * today-2] so the dark recent day (today-1) is always separate and NOT
 * counted among the active days. Optionally overrides/omits the today-1 row
 * and/or adds a current-day row.
 */
function establishedCampaign(opts: {
  activeDays?: number; // prior-window active days, EXCLUDING today-1
  daily?: number;
  recentSpend?: number | null; // today-1 spend; null = omit the today-1 row
  todaySpend?: number | null; // spend on the current Israel day; null = omit
  patch?: Partial<CampaignRow>;
}): CampaignRow[] {
  const activeDays = opts.activeDays ?? 10;
  const daily = opts.daily ?? 200;
  const rows: CampaignRow[] = [];
  // Active days sit at [today-(activeDays+1) .. today-2]; the most-recent
  // completed day (today-1) is handled separately.
  for (let k = 0; k < activeDays; k++) {
    rows.push(row({ date: addDays(TODAY, -(k + 2)), spend: daily, ...opts.patch }));
  }
  if (opts.recentSpend !== null) {
    rows.push(
      row({ date: addDays(TODAY, -1), spend: opts.recentSpend ?? 0, ...opts.patch }),
    );
  }
  if (opts.todaySpend != null) {
    rows.push(row({ date: TODAY, spend: opts.todaySpend, ...opts.patch }));
  }
  return rows;
}

describe('detectCampaignDied', () => {
  it('(a) established campaign that went dark → fires critical, weight 96', () => {
    const rows = establishedCampaign({ activeDays: 10, daily: 200, recentSpend: 0 });
    const out = detectCampaignDied(rows, undefined, TODAY);
    expect(out).toHaveLength(1);
    const ins = out[0];
    expect(ins.severity).toBe('critical');
    expect(ins.kind).toBe('anomaly');
    expect(ins.weight).toBe(96);
    expect(ins.id).toBe('died-c1');
    expect(ins.scope).toBe('Meta · uzoshop');
    expect(ins.campaignId).toBe('c1');
    expect(ins.campaignName).toBe('Prospecting — Cold');
    expect(ins.platform).toBe('Meta');
    expect(ins.storeId).toBe('uzoshop');
    expect(ins.storeName).toBe('uzoshop');
    expect(ins.href).toContain('selected_campaign_ids=c1');
    // priorActiveDays = 10, meanDaily = 200, recentSpend = 0
    expect(ins.title).toBe(
      `Prospecting — Cold כבה — מ-${fmtMoneyString(200)}/יום ל-0`,
    );
    expect(ins.detail).toBe(
      `הוציא בממוצע ${fmtMoneyString(200)} ליום ב-10 ימים, והיום ${fmtMoneyString(0)}. בדוק תקציב/דחייה/תקלת-מעקב.`,
    );
    expect(ins.why).toContain('קמפיין מבוסס (10 ימי פעילות');
  });

  it('(b) current Israel day is EXCLUDED from the recent read (today spend>0 does not prevent firing when today-1 is dark)', () => {
    // today-1 dark, but a current-day row exists WITH spend>0. The current
    // day must be ignored → still fires (mirror dead-day current-day suppression).
    const rows = establishedCampaign({
      activeDays: 10,
      daily: 200,
      recentSpend: 0,
      todaySpend: 150,
    });
    const out = detectCampaignDied(rows, undefined, TODAY);
    expect(out).toHaveLength(1);
    expect(out[0].severity).toBe('critical');
    // The reported "recent" spend is today-1 (0), NOT today's 150.
    expect(out[0].detail).toContain(`והיום ${fmtMoneyString(0)}`);
  });

  it('(c) MISSING today-1 row (only prior rows) → treated as spend=0 → fires', () => {
    const rows = establishedCampaign({
      activeDays: 10,
      daily: 200,
      recentSpend: null, // omit the today-1 row entirely
    });
    // priorActiveDays = 10, today-1 missing → treated as recentSpend 0.
    const out = detectCampaignDied(rows, undefined, TODAY);
    expect(out).toHaveLength(1);
    expect(out[0].severity).toBe('critical');
    expect(out[0].detail).toContain(`והיום ${fmtMoneyString(0)}`);
    expect(out[0].title).toContain('ל-0');
  });

  it('(d) priorActiveDays < 7 → no fire', () => {
    // Only 6 active prior-window days (today-7 .. today-2), recent (today-1) dark.
    const rows = establishedCampaign({ activeDays: 6, daily: 200, recentSpend: 0 });
    const out = detectCampaignDied(rows, undefined, TODAY);
    expect(out).toHaveLength(0);
  });

  it('(e) meanDaily < 50 → no fire', () => {
    const rows = establishedCampaign({ activeDays: 10, daily: 30, recentSpend: 0 });
    const out = detectCampaignDied(rows, undefined, TODAY);
    expect(out).toHaveLength(0);
  });

  it('(f) recentSpend > 1 → no fire (campaign still spending on today-1)', () => {
    const rows = establishedCampaign({ activeDays: 10, daily: 200, recentSpend: 5 });
    const out = detectCampaignDied(rows, undefined, TODAY);
    expect(out).toHaveLength(0);
  });

  it('(g) status-hint variants — paused vs unknown', () => {
    const rows = establishedCampaign({ activeDays: 10, daily: 200, recentSpend: 0 });

    // Paused: matched by the ad-set-granular real key shape
    // `${storeId}::${Platform}::${campaignId}::${adSetId}`.
    const paused = detectCampaignDied(
      rows,
      { 'uzoshop::Meta::c1::as1': { status: 'PAUSED', updatedAt: '2026-06-03T12:00:00Z' } },
      TODAY,
    );
    expect(paused).toHaveLength(1);
    expect(paused[0].detail).toContain('הקמפיין מסומן «מושהה» ב-Meta — ודא אם זה מכוון.');
    expect(paused[0].why).toContain('הסטטוס הנוכחי: «מושהה».');

    // Unknown (no status entry) → generic cause hint, empty status hint.
    const unknown = detectCampaignDied(rows, {}, TODAY);
    expect(unknown).toHaveLength(1);
    expect(unknown[0].detail).toContain('בדוק תקציב/דחייה/תקלת-מעקב.');
    expect(unknown[0].why).not.toContain('הסטטוס הנוכחי');

    // An ACTIVE status (not paused/removed/archived) → generic cause hint.
    const active = detectCampaignDied(
      rows,
      { 'uzoshop::Meta::c1::as1': { status: 'ACTIVE', updatedAt: '2026-06-03T12:00:00Z' } },
      TODAY,
    );
    expect(active[0].detail).toContain('בדוק תקציב/דחייה/תקלת-מעקב.');
  });

  it('excludes rows older than the 14-day window from the prior-active count', () => {
    // 5 fresh active prior-window days + 5 ancient days (outside window).
    const fresh = establishedCampaign({ activeDays: 6, daily: 200, recentSpend: 0 });
    const ancient: CampaignRow[] = [];
    for (let i = 20; i <= 24; i++) {
      ancient.push(row({ date: addDays(TODAY, -i), spend: 200 }));
    }
    // Window only sees 6 fresh prior-active days (today-7..today-2) → below
    // the 7 gate. The 5 ancient days (today-20..today-24) are out of window;
    // if they leaked in, priorActiveDays would be 11 and the rule would fire.
    const out = detectCampaignDied([...ancient, ...fresh], undefined, TODAY);
    expect(out).toHaveLength(0);
  });

  // ---- ads-off suppression (Phase 4) ----------------------------------------

  it('(ads-off-1) adStateMap with uzoshop:meta=false → no insight emitted', () => {
    const rows = establishedCampaign({ activeDays: 10, daily: 200, recentSpend: 0 });
    const map: AdStateMap = { 'uzoshop:meta': false };
    const out = detectCampaignDied(rows, undefined, TODAY, map);
    expect(out).toHaveLength(0);
  });

  it('(ads-off-2) adStateMap empty ({}) → insight still emitted (no suppression)', () => {
    const rows = establishedCampaign({ activeDays: 10, daily: 200, recentSpend: 0 });
    const out = detectCampaignDied(rows, undefined, TODAY, {});
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe('died-c1');
  });

  it('(ads-off-3) adStateMap suppresses only the off platform; other store/platform still fires', () => {
    const uzoshop = establishedCampaign({ activeDays: 10, daily: 200, recentSpend: 0 });
    // Second campaign: different store, different platform
    const usmileRows = establishedCampaign({
      activeDays: 10, daily: 150, recentSpend: 0,
      patch: { storeId: 'usmile360', storeName: 'usmile360', platform: 'Google', campaignId: 'c2' },
    });
    const map: AdStateMap = { 'uzoshop:meta': false }; // only uzoshop Meta is off
    const out = detectCampaignDied([...uzoshop, ...usmileRows], undefined, TODAY, map);
    // uzoshop+Meta suppressed; usmile360+Google still fires
    expect(out).toHaveLength(1);
    expect(out[0].storeId).toBe('usmile360');
  });
});
