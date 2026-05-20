import { describe, expect, it } from 'vitest';
import { buildDateRangeKey } from '@/lib/dateRange';

/**
 * TEST-02 (5.2.2.1): pins FIX-04 (AdsDrawer fetches /api/orders-attribution
 * with range) and FIX-07 (AdsDrawer fetches /api/ads with range).
 *
 * AdsDrawer uses buildDateRangeKey(url, range) as the SWR key. Testing the
 * key builder directly keeps this node-only suite out of React rendering.
 */
describe('AdsDrawer SWR keys include range params — locks FIX-04, FIX-07', () => {
  const range = { from: '2026-04-01', to: '2026-04-30' };

  it('FIX-04: /api/orders-attribution URL has from/to params', () => {
    const url = buildDateRangeKey('/api/orders-attribution', range);
    expect(url).toContain('from=2026-04-01');
    expect(url).toContain('to=2026-04-30');
    expect(url?.startsWith('/api/orders-attribution')).toBe(true);
  });

  it('FIX-07: /api/ads URL has from/to params', () => {
    const url = buildDateRangeKey('/api/ads', range);
    expect(url).toContain('from=2026-04-01');
    expect(url).toContain('to=2026-04-30');
    expect(url?.startsWith('/api/ads')).toBe(true);
  });

  it('different ranges produce different SWR keys', () => {
    const january = { from: '2026-01-01', to: '2026-01-31' };
    const february = { from: '2026-02-01', to: '2026-02-28' };
    expect(buildDateRangeKey('/api/ads', january)).not.toBe(buildDateRangeKey('/api/ads', february));
  });
});
