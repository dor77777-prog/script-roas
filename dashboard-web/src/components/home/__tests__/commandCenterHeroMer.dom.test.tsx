// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
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

  it('the ROAS card carries a title tooltip explaining MER', () => {
    const { getByTestId } = render(<CommandCenterHero current={PERIOD} rangeLabel="היום" />);
    const card = getByTestId('hero-roas');
    expect(card.getAttribute('title') ?? '').toMatch(/MER|הכנסות.*הוצאות|blended|משוקלל/i);
  });

  it('the band is unchanged (green for 2.8x)', () => {
    const { getByTestId } = render(<CommandCenterHero current={PERIOD} rangeLabel="היום" />);
    expect(getByTestId('hero-roas').getAttribute('data-band')).toBe('green');
  });
});
