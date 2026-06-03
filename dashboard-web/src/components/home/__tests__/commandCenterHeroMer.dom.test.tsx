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
    expect(getByTestId('hero-roas').getAttribute('data-band')).toBe('green');
  });
});
