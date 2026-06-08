import { describe, it, expect } from 'vitest';
import { computeChannelTruth, sourceToChannel, CHANNELS } from '@/lib/home/channelTruth';
import type { FirstOrderInput } from '@/lib/home/newCustomerMetrics';

describe('sourceToChannel', () => {
  it('maps the three paid sources, null for everything else', () => {
    expect(sourceToChannel('meta-paid')).toBe('meta');
    expect(sourceToChannel('google-paid')).toBe('google');
    expect(sourceToChannel('tiktok-paid')).toBe('tiktok');
    expect(sourceToChannel('email')).toBeNull();
    expect(sourceToChannel('direct')).toBeNull();
    expect(sourceToChannel(null)).toBeNull();
    expect(sourceToChannel(undefined)).toBeNull();
  });

  // classify-v2 T2 INVARIANT: the new organic/referral source values must
  // NEVER resolve to a paid channel — the paid-spend/ROAS/NC-ROAS path
  // depends on this returning null so organic revenue never enters paid math.
  it('classify-v2 organic/referral values are NOT a paid channel (null)', () => {
    expect(sourceToChannel('tiktok-organic')).toBeNull();
    expect(sourceToChannel('search-organic')).toBeNull();
    expect(sourceToChannel('app-referral')).toBeNull();
    expect(sourceToChannel('email')).toBeNull();
    // Sanity: existing organics stay null too.
    expect(sourceToChannel('meta-organic')).toBeNull();
    expect(sourceToChannel('google-organic')).toBeNull();
  });

  it('tiktok-organic first-orders do NOT count toward tiktok NC-ROAS (paid math excludes organic)', () => {
    // A tiktok-organic first order must NOT add to the tiktok channel's
    // ncRevenue/ncOrders — only tiktok-paid does.
    const rows: FirstOrderInput[] = [
      { storeName: 'uzoshop', totalCad: 200, isFirstOrder: true, source: 'tiktok-organic' },
      { storeName: 'uzoshop', totalCad: 100, isFirstOrder: true, source: 'tiktok-paid' },
    ];
    const out = computeChannelTruth(rows, { meta: 0, google: 0, tiktok: 50 });
    const tk = out.find((c) => c.channel === 'tiktok')!;
    expect(tk.ncRevenue).toBe(100);   // tiktok-paid only; organic excluded
    expect(tk.ncOrders).toBe(1);
    expect(tk.ncRoas).toBeCloseTo(2.0, 5); // 100 / 50 — organic 200 did NOT inflate it
  });
});

function r(over: Partial<FirstOrderInput>): FirstOrderInput {
  return { storeName: 'uzoshop', totalCad: 100, isFirstOrder: true, ...over };
}

describe('computeChannelTruth', () => {
  const rows: FirstOrderInput[] = [
    r({ source: 'meta-paid', totalCad: 200, isFirstOrder: true }),
    r({ source: 'meta-paid', totalCad: 100, isFirstOrder: true }),
    r({ source: 'meta-paid', totalCad: 999, isFirstOrder: false }), // returning → excluded
    r({ source: 'google-paid', totalCad: 150, isFirstOrder: true }),
    r({ source: 'tiktok-paid', totalCad: 50, isFirstOrder: true }),
    r({ source: 'direct', totalCad: 500, isFirstOrder: true }), // no channel → excluded
  ];
  const spend = { meta: 100, google: 50, tiktok: 100 };

  it('splits first-order revenue + orders by paid channel, computes ncRoas + nCac', () => {
    const out = computeChannelTruth(rows, spend);
    const m = out.find((c) => c.channel === 'meta')!;
    expect(m.ncRevenue).toBe(300); // 200 + 100 (returning 999 excluded)
    expect(m.ncOrders).toBe(2);
    expect(m.ncRoas).toBeCloseTo(3.0, 5); // 300 / 100
    expect(m.nCac).toBeCloseTo(50, 5); // 100 / 2
    const g = out.find((c) => c.channel === 'google')!;
    expect(g.ncRoas).toBeCloseTo(3.0, 5); // 150 / 50
    const t = out.find((c) => c.channel === 'tiktok')!;
    expect(t.ncRoas).toBeCloseTo(0.5, 5); // 50 / 100 — losing
    expect(t.nCac).toBeCloseTo(100, 5); // 100 / 1
  });

  it('returns all three channels in CHANNELS order', () => {
    expect(computeChannelTruth(rows, spend).map((c) => c.channel)).toEqual([...CHANNELS]);
  });

  it('ncRoas null when spend ≤ 0; nCac null when no first-orders', () => {
    const out = computeChannelTruth([r({ source: 'meta-paid', isFirstOrder: true })], { meta: 0, google: 0, tiktok: 30 });
    expect(out.find((c) => c.channel === 'meta')!.ncRoas).toBeNull(); // spend 0
    const tk = out.find((c) => c.channel === 'tiktok')!;
    expect(tk.ncRoas).toBeNull(); // spend 30 but 0 revenue
    expect(tk.nCac).toBeNull(); // 0 orders
  });

  it('netAdjust re-bases ncRevenue (and thus ncRoas) onto NET, count-based nCac untouched', () => {
    const out = computeChannelTruth(rows, spend, undefined, 0.9);
    const m = out.find((c) => c.channel === 'meta')!;
    expect(m.ncRevenue).toBeCloseTo(270, 5); // 300 gross × 0.9
    expect(m.ncRoas).toBeCloseTo(2.7, 5); // 270 / 100
    expect(m.nCac).toBeCloseTo(50, 5); // unchanged (count-based)
  });

  it('per-channel-net-profit: ncNetProfit = ncRevenue×keepRate − spend (contribution net)', () => {
    const out = computeChannelTruth(rows, spend, undefined, 1, 0.7);
    // meta: ncRevenue 300, spend 100 → 300×0.7 − 100 = 110 (profitable)
    expect(out.find((c) => c.channel === 'meta')!.ncNetProfit).toBeCloseTo(110, 5);
    // tiktok: ncRevenue 50, spend 100 → 50×0.7 − 100 = −65 (losing)
    expect(out.find((c) => c.channel === 'tiktok')!.ncNetProfit).toBeCloseTo(-65, 5);
  });

  it('ncNetProfit null when a channel has neither spend nor attributed revenue', () => {
    const out = computeChannelTruth([], { meta: 0, google: 0, tiktok: 0 }, undefined, 1, 0.7);
    expect(out.every((c) => c.ncNetProfit === null)).toBe(true);
  });

  it('storeName scopes the rows', () => {
    const mixed: FirstOrderInput[] = [
      r({ storeName: 'uzoshop', source: 'meta-paid', totalCad: 200, isFirstOrder: true }),
      r({ storeName: 'Zol Plus', source: 'meta-paid', totalCad: 9999, isFirstOrder: true }),
    ];
    const out = computeChannelTruth(mixed, { meta: 100, google: 0, tiktok: 0 }, 'uzoshop');
    expect(out.find((c) => c.channel === 'meta')!.ncRevenue).toBe(200); // Zol Plus excluded
  });
});
