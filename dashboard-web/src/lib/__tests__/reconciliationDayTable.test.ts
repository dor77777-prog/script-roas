import { describe, expect, it, vi } from 'vitest';

vi.mock('lucide-react', () => ({
  Info: () => null,
  TrendingUp: () => null,
  X: () => null,
}));
vi.mock('recharts', () => ({
  ComposedChart: () => null,
  Line: () => null,
  ResponsiveContainer: () => null,
  Tooltip: () => null,
  XAxis: () => null,
  YAxis: () => null,
}));

import { computeDayDelta } from '@/components/MetaShopifyReconciliation';

describe('per-day-table delta — locks FIX-16 (5.2.2.1)', () => {
  it('channelTotal=0, shopify>0 -> "Shopify only", neutral', () => {
    expect(computeDayDelta(0, 100)).toEqual({ label: 'Shopify only', tone: 'neutral' });
  });

  it('channelTotal>0, shopify=0 -> "Channels only", neutral', () => {
    expect(computeDayDelta(50, 0)).toEqual({ label: 'Channels only', tone: 'neutral' });
  });

  it('both > 0 and |delta%| < 20 -> green tone with signed percent', () => {
    expect(computeDayDelta(110, 100)).toEqual({ label: '+10%', tone: 'green' });
  });

  it('both > 0 and |delta%| >= 20 -> red tone with signed percent', () => {
    expect(computeDayDelta(150, 100)).toEqual({ label: '+50%', tone: 'red' });
  });

  it('both > 0, negative delta -> signed percent with red tone if magnitude >= 20', () => {
    expect(computeDayDelta(50, 100)).toEqual({ label: '-50%', tone: 'red' });
  });

  it('both = 0 -> fallback dash', () => {
    expect(computeDayDelta(0, 0)).toEqual({ label: '—', tone: 'neutral' });
  });
});
