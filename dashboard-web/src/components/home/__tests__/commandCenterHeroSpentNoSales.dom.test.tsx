// @vitest-environment jsdom
//
// FIX #7 (A) + FIX #23 (B) — Hero MER tile / ROAS delta in the
// "spent money, made zero sales" state (spend>0 & revenue=0).
//
// FIX A: adapters null the hero ROAS when revenue is 0 (a 0-revenue ratio is
// meaningless), so the MER Widget rendered the neutral "—". But spend>0 with
// 0 sales is NOT "no data" — it is actively burning money with zero return,
// which the per-store card already renders as RED "0.00x". The hero MER tile
// must mirror that: RED band + "0.00x", never neutral "—".
//
// FIX B: the ROAS delta was computed from the raw agg.roas (0) while the tile
// value was null, so the tile showed "—" beside a concrete "▾ −X". The delta
// must be null (suppressed) when the tile value is null / spent-no-sales.

import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, cleanup } from '@testing-library/react';

vi.mock('@/lib/hooks/useIsMobile', () => ({ useIsMobile: () => false }));

import {
  CommandCenterHero,
  type CommandCenterPeriod,
  type CommandCenterDelta,
} from '@/components/home/CommandCenterHero';

afterEach(() => cleanup());

// Spent money, ZERO sales. roas is null upstream (0-revenue ratio meaningless).
const SPENT_NO_SALES: CommandCenterPeriod = {
  roas: null,
  netProfit: -250,
  operatingProfit: -250,
  revenue: 0,
  spend: 250, // > $100 → would also be the alarm subset
  cpm: 9.1,
  orders: 0,
  cogs: 0,
};

describe('CommandCenterHero MER — spent-money-zero-sales (FIX A #7)', () => {
  it('MER tile shows RED band + "0.00x", never the neutral "—"', () => {
    const { getByTestId } = render(
      <CommandCenterHero current={SPENT_NO_SALES} rangeLabel="היום" />,
    );
    const card = getByTestId('hero-roas');

    // The truthful zero ROAS is "0.00x" — not the no-data placeholder.
    expect(card.textContent).toContain('0.00x');
    expect(card.textContent).not.toContain('—');

    // RED band on the value span (the Widget mirrors the band onto data-band).
    expect(card.querySelector('[data-band="red"]')).not.toBeNull();
  });
});

describe('CommandCenterHero MER — ROAS delta consistency (FIX B #23)', () => {
  it('spent-no-sales: the ROAS delta line is suppressed (no concrete number)', () => {
    // A baseline existed (prev roas 2.0). Pre-fix the delta rendered a concrete
    // "▾ −2.00" beside the "—" / null tile. With the tile now "0.00x" RED, the
    // delta must be NULL so the hero suppresses it — the tile + delta agree.
    const delta: CommandCenterDelta = {
      roas: null, // FIX B — adapter nulls it for spent-no-sales
      netProfit: null,
      operatingProfit: null,
      operatingProfitPct: null,
      revenuePct: null,
      spendPct: null,
      cpmPct: null,
      orders: null,
      cogs: null,
    };
    const { getByTestId } = render(
      <CommandCenterHero current={SPENT_NO_SALES} delta={delta} rangeLabel="היום" />,
    );
    const card = getByTestId('hero-roas');
    // No "▴"/"▾" delta arrow inside the MER tile.
    expect(card.textContent).not.toMatch(/[▴▾]/);
  });

  it('a normal period still renders the numeric ROAS + green band (no regression)', () => {
    const NORMAL: CommandCenterPeriod = {
      roas: 2.8, netProfit: 4847, operatingProfit: 5500, revenue: 10998,
      spend: 3924, cpm: 8.92, orders: 188, cogs: 2750,
    };
    const { getByTestId } = render(
      <CommandCenterHero current={NORMAL} rangeLabel="היום" />,
    );
    const card = getByTestId('hero-roas');
    expect(card.textContent).toContain('2.80');
    expect(card.querySelector('[data-band="green"]')).not.toBeNull();
  });
});
