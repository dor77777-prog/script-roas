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

  it('storeName scopes the rows', () => {
    const mixed: FirstOrderInput[] = [
      r({ storeName: 'uzoshop', source: 'meta-paid', totalCad: 200, isFirstOrder: true }),
      r({ storeName: 'Zol Plus', source: 'meta-paid', totalCad: 9999, isFirstOrder: true }),
    ];
    const out = computeChannelTruth(mixed, { meta: 100, google: 0, tiktok: 0 }, 'uzoshop');
    expect(out.find((c) => c.channel === 'meta')!.ncRevenue).toBe(200); // Zol Plus excluded
  });
});
