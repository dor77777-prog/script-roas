// dashboard-web/src/components/home/__tests__/merBandWidget.dom.test.tsx
//
// Horizon re-skin W3.2 — the MER band-gauge rule (the headline of this task).
//
// The MER KPI widget OBEYS the operator-locked ROAS bands EXACTLY. Its value,
// the lucide Gauge icon, the icon circle, and the band-tag pill all take the
// band colour classified through the SINGLE SOURCE OF TRUTH (bandForRoas via
// the shared <Widget bandRoas>). The gauge icon is band-agnostic so it reads
// correctly for every state — which is why the operator locked it.
//
// Pins (per the plan): MER 2.79 ⇒ green band; MER 2.3 ⇒ orange band.
//   • the band is applied to the value (data-band on the value SPAN only). The
//     Card ROOT deliberately does NOT carry data-band: `.glass[data-band]` is the
//     vivid STORE-card recipe (band gradient + an opacity:0 mount-entrance that
//     only reveals on data-mounted="true"), which a KPI Widget never sets — so a
//     root data-band rendered the banded MER tile at opacity:0 = invisible (fixed
//     2026-06-13). The band lives on the value span (+ icon-circle + tag) instead,
//   • the icon-circle takes the band tint + the gauge icon takes the band
//     colour (the icon-circle is the badge span carrying the lucide-gauge svg),
//   • the canonical BAND_TAG_LABEL pill renders (no invented wording),
//   • it reads correctly for non-green bands too (orange), not just green.

// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { CommandCenterHero, type CommandCenterPeriod } from '@/components/home/CommandCenterHero';
import { bandForRoas } from '@/lib/roasBands';
import { BAND_TAG_LABEL } from '@/lib/format/useRoasBandGradient';

afterEach(() => cleanup());

const BASE: CommandCenterPeriod = {
  roas: 2.79,
  netProfit: 4847,
  operatingProfit: 5500,
  revenue: 10998,
  spend: 3941, // 10998 / 3941 ≈ 2.79
  cpm: 8.92,
  orders: 188,
  cogs: 2750,
};

function renderMer(roas: number) {
  const { getByTestId } = render(
    <CommandCenterHero current={{ ...BASE, roas }} rangeLabel="היום" />,
  );
  return getByTestId('hero-roas');
}

describe('MER band-gauge widget', () => {
  it('the band thresholds resolve through the single source of truth', () => {
    // Anchor the plan pins to bandForRoas so a threshold drift fails loudly.
    expect(bandForRoas(2.79)).toBe('green');
    expect(bandForRoas(2.3)).toBe('orange');
  });

  it('MER 2.79 → GREEN band on the value span (NOT the card root)', () => {
    const widget = renderMer(2.79);
    // The band lives on the value span.
    const value = widget.querySelector('[data-band="green"]');
    expect(value).not.toBeNull();
    // The card ROOT must NOT carry data-band — `.glass[data-band]` would make the
    // KPI tile render at opacity:0 (invisible MER). Regression guard, fixed 2026-06-13.
    expect(widget.getAttribute('data-band')).toBeNull();
  });

  it('MER 2.79 → green band-tag pill with the canonical locked wording', () => {
    const widget = renderMer(2.79);
    const tag = widget.querySelector('.band-chip.chip-green');
    expect(tag).not.toBeNull();
    expect(tag?.textContent).toBe(BAND_TAG_LABEL.green); // "טוב" — not invented
  });

  it('MER 2.79 → the band-agnostic lucide Gauge icon is present in the icon circle', () => {
    const widget = renderMer(2.79);
    // lucide renders an <svg class="lucide lucide-gauge …">; the icon sits
    // inside the circular badge span (the band-tinted icon circle).
    const gauge = widget.querySelector('svg.lucide-gauge');
    expect(gauge).not.toBeNull();
    // The icon circle (badge) carries the green band tint class.
    const badge = gauge!.closest('span');
    expect(badge?.className ?? '').toMatch(/band-green/);
  });

  it('reads correctly for a NON-green band too: MER 2.3 → ORANGE everywhere', () => {
    const widget = renderMer(2.3);
    // Band on the value span; the card root must NOT carry data-band (see above).
    expect(widget.querySelector('[data-band="orange"]')).not.toBeNull();
    expect(widget.getAttribute('data-band')).toBeNull();
    // Orange tag pill with canonical wording.
    const tag = widget.querySelector('.band-chip.chip-orange');
    expect(tag).not.toBeNull();
    expect(tag?.textContent).toBe(BAND_TAG_LABEL.orange); // "סביר"
    // Same gauge icon, now in an orange-tinted circle.
    const gauge = widget.querySelector('svg.lucide-gauge');
    expect(gauge).not.toBeNull();
    const badge = gauge!.closest('span');
    expect(badge?.className ?? '').toMatch(/band-orange/);
  });

  it('the MER value renders 2.79 (not a re-derived/forked number)', () => {
    const widget = renderMer(2.79);
    expect(widget.textContent).toContain('2.79');
  });
});
