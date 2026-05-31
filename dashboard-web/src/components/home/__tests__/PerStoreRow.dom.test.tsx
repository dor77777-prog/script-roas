// dashboard-web/src/components/home/__tests__/PerStoreRow.dom.test.tsx
//
// Task 3.3 — semantic-emphasis class bindings on per-store metric cells.
// The cell classes (.cell.spend / .cell.revenue / .cell.aov-*) are the contract
// that powers the colour/glyph CSS in globals.css (Task 1.5). If a cell ships
// without its emphasis class, the visual signal silently disappears — the
// pixel still renders but the colour-coded story doesn't. These tests pin
// the wiring so a refactor (e.g. swapping the underlying primitive) can't
// regress the binding without screaming.
//
// Also pins the card-level data-band derived from useRoasBandGradient and
// the explicit "CPM cells are NEVER value-coloured" rule (a frequent design
// debate — keep the test as the source-of-truth).

import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { PerStoreRow, type PerStoreData } from '@/components/home/PerStoreRow';

const STORES: PerStoreData[] = [
  {
    storeId: 'uzoshop',
    storeName: 'uzoshop',
    spend: 1847,
    revenue: 5762,
    orders: 79,
    aov: 72.94,       // → aov-good (>70)
    roas: 3.12,       // → blue band (≥3.0)
    updatedAt: null,
    perPlatformCpm: {
      meta:   { cpm: 7.94, spend: 842 },
      google: { cpm: 8.18, spend: 612 },
      tiktok: { cpm: 8.74, spend: 393 },
    },
  },
  {
    storeId: 'usmile360',
    storeName: 'usmile360',
    spend: 1392,
    revenue: 4106,
    orders: 68,
    aov: 60.40,       // → aov-mid (50-70)
    roas: 2.85,       // → green band (2.7-3.0)
    updatedAt: null,
    perPlatformCpm: {
      meta:   { cpm: 8.62, spend: 868 },
      tiktok: { cpm: 10.18, spend: 524 },
    },
  },
  {
    storeId: 'store-3',
    storeName: 'store-3',
    spend: 685,
    revenue: 1130,
    orders: 24,
    aov: 47.08,       // → aov-bad (<50)
    roas: 1.65,       // → red band (<2.0)
    updatedAt: null,
    perPlatformCpm: {
      meta: { cpm: 9.12, spend: 685 },
    },
  },
];

describe('PerStoreRow', () => {
  it('renders one card per store', () => {
    const { container } = render(<PerStoreRow stores={STORES} />);
    const cards = container.querySelectorAll('[data-testid="per-store-card"]');
    expect(cards).toHaveLength(3);
  });

  // (a)
  it('spend cell carries class "cell spend"', () => {
    const { container } = render(<PerStoreRow stores={STORES} />);
    const cell = container.querySelector('[data-testid="per-store-card"] [data-cell="spend"]');
    expect(cell).not.toBeNull();
    expect(cell?.classList.contains('cell')).toBe(true);
    expect(cell?.classList.contains('spend')).toBe(true);
  });

  // (b)
  it('revenue cell carries class "cell revenue"', () => {
    const { container } = render(<PerStoreRow stores={STORES} />);
    const cell = container.querySelector('[data-testid="per-store-card"] [data-cell="revenue"]');
    expect(cell?.classList.contains('cell')).toBe(true);
    expect(cell?.classList.contains('revenue')).toBe(true);
  });

  // (c)
  it('AOV $72.94 yields class "cell aov-good"', () => {
    const { container } = render(<PerStoreRow stores={[STORES[0]]} />);
    const aov = container.querySelector('[data-cell="aov"]');
    expect(aov?.classList.contains('cell')).toBe(true);
    expect(aov?.classList.contains('aov-good')).toBe(true);
  });

  // (d)
  it('AOV $47.08 yields class "cell aov-bad"', () => {
    const { container } = render(<PerStoreRow stores={[STORES[2]]} />);
    const aov = container.querySelector('[data-cell="aov"]');
    expect(aov?.classList.contains('aov-bad')).toBe(true);
  });

  // (e)
  it('AOV $60.40 yields class "cell aov-mid"', () => {
    const { container } = render(<PerStoreRow stores={[STORES[1]]} />);
    const aov = container.querySelector('[data-cell="aov"]');
    expect(aov?.classList.contains('aov-mid')).toBe(true);
  });

  // (f)
  it('per-platform CPM cells carry "cell" but NO emphasis class', () => {
    const { container } = render(<PerStoreRow stores={[STORES[0]]} />);
    const cpmCells = container.querySelectorAll('[data-cell="cpm"]');
    expect(cpmCells.length).toBeGreaterThan(0);
    for (const cpm of Array.from(cpmCells)) {
      expect(cpm.classList.contains('cell')).toBe(true);
      // Emphasis classes that must NEVER appear on a CPM cell.
      for (const forbidden of ['spend', 'revenue', 'aov-good', 'aov-bad', 'aov-mid']) {
        expect(cpm.classList.contains(forbidden)).toBe(false);
      }
    }
  });

  // (g)
  it('cards carry data-band matching useRoasBandGradient(roas).band', () => {
    const { container } = render(<PerStoreRow stores={STORES} />);
    const cards = container.querySelectorAll('[data-testid="per-store-card"]');
    // Order is preserved by render — pin each card's band to its ROAS bucket.
    expect(cards[0].getAttribute('data-band')).toBe('blue');   // roas 3.12
    expect(cards[1].getAttribute('data-band')).toBe('green');  // roas 2.85
    expect(cards[2].getAttribute('data-band')).toBe('red');    // roas 1.65
  });

  it('orders cell is neutral (only "cell", no emphasis class)', () => {
    const { container } = render(<PerStoreRow stores={[STORES[0]]} />);
    const orders = container.querySelector('[data-cell="orders"]');
    expect(orders?.classList.contains('cell')).toBe(true);
    for (const forbidden of ['spend', 'revenue', 'aov-good', 'aov-bad', 'aov-mid']) {
      expect(orders?.classList.contains(forbidden)).toBe(false);
    }
  });

  it('clicking a card invokes onStoreSelect with the storeId', () => {
    const onStoreSelect = vi.fn();
    const { container } = render(
      <PerStoreRow stores={STORES} onStoreSelect={onStoreSelect} />,
    );
    const cards = container.querySelectorAll('[data-testid="per-store-card"]');
    fireEvent.click(cards[1]);
    expect(onStoreSelect).toHaveBeenCalledWith('usmile360');
  });

  it('Enter keypress on a card invokes onStoreSelect with the storeId', () => {
    const onStoreSelect = vi.fn();
    const { container } = render(
      <PerStoreRow stores={STORES} onStoreSelect={onStoreSelect} />,
    );
    const cards = container.querySelectorAll('[data-testid="per-store-card"]');
    fireEvent.keyDown(cards[0], { key: 'Enter' });
    expect(onStoreSelect).toHaveBeenCalledWith('uzoshop');
  });

  it('renders store name', () => {
    render(<PerStoreRow stores={STORES} />);
    expect(screen.getByText('uzoshop')).toBeInTheDocument();
    expect(screen.getByText('usmile360')).toBeInTheDocument();
    expect(screen.getByText('store-3')).toBeInTheDocument();
  });

  // Task 3.6 — freshness wiring. The hook's `stage` flows into both the
  // chip class AND the surrounding <Card data-freshness="…">; both must
  // agree so the desaturation CSS and the chip never contradict.
  it('passes useStaleness(updatedAt).stage to Card.data-freshness AND renders matching badge', () => {
    const now = Date.now();
    const FRESH_TS = new Date(now - 2 * 60_000).toISOString();   // 2 min  → fresh
    const AGING_TS = new Date(now - 20 * 60_000).toISOString();  // 20 min → aging
    const STALE_TS = new Date(now - 47 * 60_000).toISOString();  // 47 min → stale
    const stores: PerStoreData[] = STORES.map((s, i) => ({
      ...s,
      updatedAt: [FRESH_TS, AGING_TS, STALE_TS][i],
    }));
    const { container } = render(<PerStoreRow stores={stores} />);
    const cards = container.querySelectorAll('[data-testid="per-store-card"]');
    expect(cards[0].getAttribute('data-freshness')).toBe('fresh');
    expect(cards[1].getAttribute('data-freshness')).toBe('aging');
    expect(cards[2].getAttribute('data-freshness')).toBe('stale');
    // Badge inside each card mirrors the same stage.
    const badges = container.querySelectorAll('[data-testid="freshness-badge"]');
    expect(badges).toHaveLength(3);
    expect(badges[0].getAttribute('data-stage')).toBe('fresh');
    expect(badges[1].getAttribute('data-stage')).toBe('aging');
    expect(badges[2].getAttribute('data-stage')).toBe('stale');
  });
});
