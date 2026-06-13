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

  // Regression (2026-06-01): the per-store "ROAS · <range>" caption was
  // hardcoded to "היום", so the ROAS NUMBER tracked the selected range but the
  // caption text never changed. It must reflect the passed rangeLabel.
  it('ROAS caption reflects the active rangeLabel (not hardcoded "היום")', () => {
    const { container } = render(
      <PerStoreRow stores={[STORES[0]]} rangeLabel="7 ימים אחרונים" />,
    );
    const cap = container.querySelector('[data-testid="per-store-card"] .roas-cap');
    expect(cap?.textContent).toContain('7 ימים אחרונים');
    expect(cap?.textContent).not.toContain('היום');
  });

  it('ROAS caption defaults to "היום" when no rangeLabel is passed', () => {
    const { container } = render(<PerStoreRow stores={[STORES[0]]} />);
    const cap = container.querySelector('[data-testid="per-store-card"] .roas-cap');
    expect(cap?.textContent).toContain('היום');
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

  // (h) Operator-locked alarm-red state — the store SPENT real money (> $100 CAD)
  // but made ZERO sales. Threshold is `isSpendAlarm` (lib/roasBands.ts):
  // spend > $100 CAD && revenue === 0. Card flips to data-band="red-alarm", the
  // ROAS hero reads an explicit "0.00x" (NOT "—"), the band-tag reads
  // "0 מכירות", and the factual alarm note is shown. A spend=0 (no-activity)
  // store must stay gray ("אין נתונים").
  it('spend $148 + ZERO sales → red-alarm band, ROAS "0.00x", tag "0 מכירות", factual note', () => {
    const zeroSales: PerStoreData = {
      storeId: 'burned-store',
      storeName: 'burned-store',
      spend: 148, // > $100 CAD threshold → alarm
      revenue: 0,
      orders: 0,
      aov: null,
      roas: null, // upstream null for a 0-revenue store
      updatedAt: null,
      perPlatformCpm: {},
    };
    const { container } = render(<PerStoreRow stores={[zeroSales]} />);
    const card = container.querySelector('[data-testid="per-store-card"]');
    expect(card?.getAttribute('data-band')).toBe('red-alarm');
    // ROAS hero shows the explicit 0.00x, not the "—" null placeholder.
    const roas = card?.querySelector('.v.banded');
    expect(roas?.textContent).toBe('0.00x');
    // Band-tag pill reads "0 מכירות".
    const tag = card?.querySelector('.band-tag');
    expect(tag?.textContent).toBe('0 מכירות');
    // Operator-locked factual alarm note is present.
    const note = card?.querySelector('.store-alarm-note');
    expect(note?.textContent).toBe('הוצאה מעל $100 ללא מכירות — בדוק את הקמפיינים');
    // The rejected dramatic copy must NOT appear.
    expect(card?.textContent).not.toContain('כסף יוצא');
  });

  it('NO spend (spend=0) → stays gray / "אין נתונים" (no-activity, unchanged)', () => {
    const noActivity: PerStoreData = {
      storeId: 'idle-store',
      storeName: 'idle-store',
      spend: 0,
      revenue: 0,
      orders: 0,
      aov: null,
      roas: null,
      updatedAt: null,
      perPlatformCpm: {},
    };
    const { container } = render(<PerStoreRow stores={[noActivity]} />);
    const card = container.querySelector('[data-testid="per-store-card"]');
    expect(card?.getAttribute('data-band')).toBe('gray');
    expect(card?.querySelector('.band-tag')?.textContent).toBe('אין נתונים');
    // No alarm number — true null ROAS still renders the "—" placeholder.
    expect(card?.querySelector('.v.banded')?.textContent).toBe('—');
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

  // Wave 3.0 — RTL/bidi coverage (re-establishes the assertion the deleted
  // bidi.dom.test.tsx made on the now-removed PerStoreCards). Latin store
  // names ("uzoshop", "Zol Plus") must be isolated in <bdi dir="ltr"> so they
  // don't bidi-flip when rendered inside the Hebrew RTL document — otherwise a
  // name ending in a digit/punctuation can reorder against the surrounding
  // Hebrew header. The wrapper is the element that directly carries the text.
  it('wraps each store name in <bdi dir="ltr">', () => {
    render(<PerStoreRow stores={STORES} />);
    for (const name of ['uzoshop', 'usmile360', 'store-3']) {
      const label = screen.getByText(name);
      expect(label.tagName.toLowerCase()).toBe('bdi');
      expect(label.getAttribute('dir')).toBe('ltr');
    }
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

  // ── Ads-off Phase 2 display tests ──────────────────────────────────────────

  // Case A: adOff=true, spend=0, revenue>0 → blue band + "אורגני" hero.
  it('adOff + revenue>0 + spend=0 → blue band + "אורגני" hero (organic)', () => {
    const organicStore: PerStoreData = {
      storeId: 'organic-store',
      storeName: 'organic-store',
      spend: 0,
      revenue: 250,
      orders: 5,
      aov: 50,
      roas: null,
      updatedAt: null,
      perPlatformCpm: {},
      adOff: true,
    };
    const { container } = render(<PerStoreRow stores={[organicStore]} />);
    const card = container.querySelector('[data-testid="per-store-card"]');
    expect(card?.getAttribute('data-band')).toBe('blue');
    const hero = card?.querySelector('.v.banded');
    expect(hero?.textContent).toContain('אורגני');
    expect(hero?.textContent).not.toMatch(/\d+\.\d+x/);
  });

  // Case B: adOff=true, spend=0, revenue=0 → gray band + "0" hero.
  it('adOff + revenue=0 + spend=0 → gray band + "0" hero (off-empty)', () => {
    const offEmptyStore: PerStoreData = {
      storeId: 'off-empty-store',
      storeName: 'off-empty-store',
      spend: 0,
      revenue: 0,
      orders: 0,
      aov: null,
      roas: null,
      updatedAt: null,
      perPlatformCpm: {},
      adOff: true,
    };
    const { container } = render(<PerStoreRow stores={[offEmptyStore]} />);
    const card = container.querySelector('[data-testid="per-store-card"]');
    expect(card?.getAttribute('data-band')).toBe('gray');
    const hero = card?.querySelector('.v.banded');
    expect(hero?.textContent).toContain('0');
    expect(hero?.textContent).not.toContain('אורגני');
  });

  // Case C: adOff=true, spend>0 → historical (normal), NOT off-display.
  // spend=30, revenue=90, roas=3 → green band (2.7-3.0 boundary); hero shows "3.00x".
  it('adOff=true but spend>0 (historical) → normal band from roas, numeric hero', () => {
    const historicalStore: PerStoreData = {
      storeId: 'historical-store',
      storeName: 'historical-store',
      spend: 30,
      revenue: 90,
      orders: 3,
      aov: 30,
      roas: 3.0,
      updatedAt: null,
      perPlatformCpm: {},
      adOff: true,
    };
    const { container } = render(<PerStoreRow stores={[historicalStore]} />);
    const card = container.querySelector('[data-testid="per-store-card"]');
    // roas=3.0 → green band per useRoasBandGradient (≥3.0 → blue at the boundary;
    // check the band is NOT overridden to organic/gray — it must be green or blue,
    // definitely not "gray" from off-display).
    const band = card?.getAttribute('data-band');
    expect(band).not.toBe(null);
    // The band is determined by the ROAS (3.0 → green "at target" since the
    // 2026-06-09 boundary alignment), but either way it must not be overridden
    // to "gray" (off-empty).
    expect(band).not.toBe('gray');
    // Hero shows the numeric ROAS, not "אורגני".
    const hero = card?.querySelector('.v.banded');
    expect(hero?.textContent).not.toContain('אורגני');
    expect(hero?.textContent).toMatch(/\d+\.\d+x/);
  });

  // Case D: adOff=false, normal store → regression anchor (unchanged).
  it('adOff=false + normal spend/revenue → unchanged render (regression anchor)', () => {
    const normalStore: PerStoreData = {
      storeId: 'normal-store',
      storeName: 'normal-store',
      spend: 100,
      revenue: 300,
      orders: 6,
      aov: 50,
      roas: 3,
      updatedAt: null,
      perPlatformCpm: {},
      adOff: false,
    };
    const { container } = render(<PerStoreRow stores={[normalStore]} />);
    const card = container.querySelector('[data-testid="per-store-card"]');
    // roas=3.0 → green band ("at target") — lock-step with roasLabel after the
    // 2026-06-09 boundary alignment (Task 11). >3.0 is blue ("above target").
    expect(card?.getAttribute('data-band')).toBe('green');
    const hero = card?.querySelector('.v.banded');
    // Numeric ROAS rendered, not "אורגני"
    expect(hero?.textContent).not.toContain('אורגני');
    expect(hero?.textContent).toMatch(/\d+\.\d+x/);
  });

  // ── Task 6 — responsive desktop grid (Self-serve stores Phase 2) ───────────
  //
  // The HOME per-store row used to hardcode the desktop grid to 3 columns
  // (`md:grid-cols-3`). With self-serve stores the count is dynamic (2, 3, 4,
  // 5+). The desktop column treatment must track the store count:
  //   • 1-4 stores → a FULL Tailwind literal `md:grid-cols-N` (JIT-extractable)
  //   • 5+ stores  → NO `md:grid-cols-N` literal; an inline
  //     `gridTemplateColumns: repeat(auto-fit, …)` fallback instead.
  // The 3-store case is the zero-regression anchor: it must STILL be
  // `md:grid-cols-3` with no inline grid-template style. The mobile carousel
  // markup (flex + overflow-x-auto deck, per-card snap basis) stays byte-
  // identical regardless of count.
  //
  // Build N valid stores by cloning the canonical STORES fixture shape.
  const makeStores = (n: number): PerStoreData[] =>
    Array.from({ length: n }, (_, i) => ({
      ...STORES[0],
      storeId: `grid-store-${i}`,
      storeName: `grid-store-${i}`,
    }));

  // The desktop grid wrapper is the SAME element that carries the mobile
  // carousel classes (it's a flex deck on mobile, a grid on md+). We locate it
  // as the element that carries both `md:grid` and the `overflow-x-auto` deck
  // class so the assertion is robust to class re-ordering.
  const getGridWrapper = (container: HTMLElement): HTMLElement => {
    const el = container.querySelector<HTMLElement>('.overflow-x-auto.md\\:grid');
    expect(el).not.toBeNull();
    return el!;
  };

  it('2 stores → desktop wrapper uses md:grid-cols-2 (no inline grid-template)', () => {
    const { container } = render(<PerStoreRow stores={makeStores(2)} />);
    const grid = getGridWrapper(container);
    expect(grid.classList.contains('md:grid-cols-2')).toBe(true);
    expect(grid.classList.contains('md:grid-cols-3')).toBe(false);
    expect(grid.style.gridTemplateColumns).toBe('');
  });

  it('3 stores → desktop wrapper STILL uses md:grid-cols-3 (zero-regression)', () => {
    const { container } = render(<PerStoreRow stores={makeStores(3)} />);
    const grid = getGridWrapper(container);
    expect(grid.classList.contains('md:grid-cols-3')).toBe(true);
    expect(grid.classList.contains('md:grid-cols-2')).toBe(false);
    expect(grid.classList.contains('md:grid-cols-4')).toBe(false);
    // No inline auto-fit fallback for the 3-store anchor.
    expect(grid.style.gridTemplateColumns).toBe('');
  });

  it('4 stores → desktop wrapper uses md:grid-cols-4 (no inline grid-template)', () => {
    const { container } = render(<PerStoreRow stores={makeStores(4)} />);
    const grid = getGridWrapper(container);
    expect(grid.classList.contains('md:grid-cols-4')).toBe(true);
    expect(grid.classList.contains('md:grid-cols-3')).toBe(false);
    expect(grid.style.gridTemplateColumns).toBe('');
  });

  it('5+ stores → NO md:grid-cols-N literal; inline auto-fit gridTemplateColumns', () => {
    const { container } = render(<PerStoreRow stores={makeStores(5)} />);
    const grid = getGridWrapper(container);
    // No fixed-column literal of any count.
    for (const n of [1, 2, 3, 4, 5]) {
      expect(grid.classList.contains(`md:grid-cols-${n}`)).toBe(false);
    }
    // Inline auto-fit fallback present.
    expect(grid.style.gridTemplateColumns).toContain('auto-fit');
    // Still a grid on md+.
    expect(grid.classList.contains('md:grid')).toBe(true);
  });

  it('mobile carousel deck markup is unchanged across counts', () => {
    for (const n of [2, 3, 4, 5]) {
      const { container } = render(<PerStoreRow stores={makeStores(n)} />);
      const grid = getGridWrapper(container);
      // The mobile carousel classes stay on the same element, every count.
      for (const cls of [
        'flex',
        'gap-3',
        'overflow-x-auto',
        'snap-x',
        'snap-mandatory',
        'scrollbar-hide',
        'pb-1',
      ]) {
        expect(grid.classList.contains(cls)).toBe(true);
      }
      // Per-card snap-basis wrapper is unchanged.
      const firstCardWrapper = grid.firstElementChild as HTMLElement;
      expect(firstCardWrapper.classList.contains('snap-center')).toBe(true);
      expect(firstCardWrapper.classList.contains('shrink-0')).toBe(true);
      expect(firstCardWrapper.classList.contains('basis-[88%]')).toBe(true);
      expect(firstCardWrapper.classList.contains('md:basis-auto')).toBe(true);
    }
  });
});
