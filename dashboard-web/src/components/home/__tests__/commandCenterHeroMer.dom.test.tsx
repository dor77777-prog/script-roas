// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, cleanup, fireEvent, screen } from '@testing-library/react';

// Pin the DESKTOP (fine-pointer) branch so the MER help renders as a Radix
// Tooltip (role="tooltip") on focus — deterministic across the suite.
vi.mock('@/lib/hooks/useIsMobile', () => ({ useIsMobile: () => false }));

import { CommandCenterHero, type CommandCenterPeriod } from '@/components/home/CommandCenterHero';

afterEach(() => cleanup());

const PERIOD: CommandCenterPeriod = {
  roas: 2.8, netProfit: 4847, operatingProfit: 5500, revenue: 10998,
  spend: 3924, cpm: 8.92, orders: 188, cogs: 2750,
};

describe('CommandCenterHero MER framing (2026-06-02)', () => {
  it('the ROAS hero card eyebrow reads "MER" (not "ROAS")', () => {
    const { getByTestId } = render(<CommandCenterHero current={PERIOD} rangeLabel="היום" />);
    const card = getByTestId('hero-roas');
    expect(card.textContent).toContain('MER');
  });

  // Stage-2 moved the MER explainer from a native `title=` on the <Card> into a
  // wrapping <HelpTooltip>. Re-point the guard at the new vessel: focusing the
  // card trigger exposes a role=tooltip carrying the MER copy.
  it('the ROAS card exposes a HelpTooltip explaining MER (role=tooltip on focus)', async () => {
    const { getByTestId } = render(<CommandCenterHero current={PERIOD} rangeLabel="היום" />);
    const card = getByTestId('hero-roas');
    // The HelpTooltip wires its Radix trigger onto the Card via asChild — focus
    // opens the tooltip immediately (focus ignores delayDuration).
    fireEvent.focus(card);
    const tip = await screen.findByRole('tooltip');
    expect(tip.textContent ?? '').toMatch(/MER|הכנסות.*הוצאות|blended|משוקלל/i);
  });

  it('the band is unchanged (green for 2.8x)', () => {
    const { getByTestId } = render(<CommandCenterHero current={PERIOD} rangeLabel="היום" />);
    // `hero-roas` is the Card ROOT (the testid spreads onto it). The band now lives
    // on the value SPAN inside it, NOT the root: `.glass[data-band]` is the vivid
    // store-card recipe (opacity:0 mount-entrance) so a root data-band rendered the
    // MER tile invisible (fixed 2026-06-13). Assert the band on the value span and
    // that the root carries no data-band.
    const card = getByTestId('hero-roas');
    expect(card.querySelector('[data-band="green"]')).not.toBeNull();
    expect(card.getAttribute('data-band')).toBeNull();
  });
});

// Regression guard (W3.2 2026-06-13) — the operator-locked freshness
// desaturation fade on the KPI strip. `391fc19` rebuilt the hero on <Widget>
// but stopped passing `freshness` to those KPI cards, so the systemic fade
// silently vanished while the FreshnessBadge text chip kept rendering. These
// assertions fail loudly if `freshness` is ever dropped from the Widget path
// again — every KPI widget must mirror the period's staleness stage onto
// `data-freshness` (which `.glass[data-freshness]` turns into saturate()).
describe('CommandCenterHero KPI freshness desaturation (W3.2 regression)', () => {
  // testids for the seven KPI widgets in the strip.
  const KPI_TESTIDS = [
    'hero-spend',
    'hero-revenue',
    'hero-net-profit',
    'hero-roas',
    'hero-orders',
    'hero-cpm',
    'hero-cogs',
  ] as const;

  it('a stale updatedAt → every KPI widget carries data-freshness="stale"', () => {
    // 45 min old → past the 30-min stale threshold (useStaleness).
    const staleIso = new Date(Date.now() - 45 * 60_000).toISOString();
    const { getByTestId } = render(
      <CommandCenterHero current={PERIOD} rangeLabel="היום" updatedAt={staleIso} />,
    );
    for (const id of KPI_TESTIDS) {
      expect(getByTestId(id).getAttribute('data-freshness')).toBe('stale');
    }
  });

  it('a fresh updatedAt → every KPI widget carries data-freshness="fresh"', () => {
    // 2 min old → under the 15-min fresh threshold.
    const freshIso = new Date(Date.now() - 2 * 60_000).toISOString();
    const { getByTestId } = render(
      <CommandCenterHero current={PERIOD} rangeLabel="היום" updatedAt={freshIso} />,
    );
    for (const id of KPI_TESTIDS) {
      expect(getByTestId(id).getAttribute('data-freshness')).toBe('fresh');
    }
  });

  it('no updatedAt → no data-freshness stamped (back-compat for historical rows)', () => {
    const { getByTestId } = render(<CommandCenterHero current={PERIOD} rangeLabel="היום" />);
    for (const id of KPI_TESTIDS) {
      expect(getByTestId(id).hasAttribute('data-freshness')).toBe(false);
    }
  });
});
