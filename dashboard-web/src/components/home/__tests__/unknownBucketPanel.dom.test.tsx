import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { UnknownBucketPanel } from '@/components/home/UnknownBucketPanel';
import type { UnknownBucketBreakdown } from '@/lib/home/unknownBucket';

const FIXTURE: UnknownBucketBreakdown = {
  unknownOrders: 12,
  unknownRevenueCad: 840,
  newVsReturning: { new: 7, returning: 3, unclassifiable: 2 },
  aovBands: { low: 4, mid: 6, high: 2 },
  byStore: [{ store: 'Zol Plus', orders: 8 }, { store: '360usmile', orders: 4 }],
  topProducts: [{ productId: 'p1', units: 9, revenueCad: 300 }],
  byPaymentCategory: { credit: 9, paypal: 2, other: 1 },
};

describe('UnknownBucketPanel', () => {
  it('renders nothing when there are no unknown orders', () => {
    const { container } = render(
      <UnknownBucketPanel breakdown={{ ...FIXTURE, unknownOrders: 0 }} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('surfaces the new-vs-returning split and per-store rows', () => {
    render(<UnknownBucketPanel breakdown={FIXTURE} />);
    expect(screen.getByTestId('unknown-bucket-panel')).toBeInTheDocument();
    expect(screen.getByText('Zol Plus')).toBeInTheDocument();
    expect(screen.getByText('360usmile')).toBeInTheDocument();
  });

  it('renders revenue through a tabular, non-clipped money cell', () => {
    render(<UnknownBucketPanel breakdown={FIXTURE} />);
    const money = screen.getByTestId('unknown-bucket-revenue');
    expect(money.className).toMatch(/tabular-nums/);
  });

  // Horizon re-skin (W3.8b): the per-store rows + stat tiles render on the
  // canonical recessed inset token (bg-pill-track), not the legacy bg-glass-1.
  it('renders per-store rows on the canonical bg-pill-track inset', () => {
    render(<UnknownBucketPanel breakdown={FIXTURE} />);
    const storeRow = screen.getByText('Zol Plus').closest('li')!;
    expect(storeRow.className).toContain('bg-pill-track');
    expect(storeRow.className).not.toContain('bg-glass-1');
  });
});
