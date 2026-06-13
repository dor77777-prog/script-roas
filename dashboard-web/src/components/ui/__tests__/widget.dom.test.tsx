import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { Widget } from '../Widget';
import { BAND_TAG_LABEL } from '@/lib/format/useRoasBandGradient';
import { bandForRoas } from '@/lib/roasBands';

/**
 * Horizon re-skin Wave 1 — <Widget> KPI primitive.
 *
 * A Card (flex-row) carrying a circular icon badge + title + value. When
 * `bandRoas` is supplied the value + badge + a band-tag pill take the
 * operator-locked ROAS band colour (via lib/roasBands.ts bandForRoas +
 * the shared BAND_TAG_LABEL wording). Numeric/money values render through
 * the shared <Money> primitive so they stay overflow-safe + tabular.
 *
 * The DOM runner reports prefers-reduced-motion: reduce, so banded Cards
 * settle synchronously (no count-up climb to assert here).
 */
function IconStub() {
  return <svg data-testid="widget-icon" viewBox="0 0 24 24" aria-hidden="true" />;
}

describe('<Widget>', () => {
  it('(a) renders the title and a string value', () => {
    const { container } = render(
      <Widget icon={<IconStub />} title="הזמנות" value="25" />,
    );
    expect(container.textContent).toContain('הזמנות');
    expect(container.textContent).toContain('25');
  });

  it('(b) renders a numeric value through the shared <Money> primitive', () => {
    const { container } = render(
      <Widget icon={<IconStub />} title="הכנסות" value={2675} />,
    );
    // Money renders a <bdi class="metric-num">; assert the primitive is
    // present rather than just a raw text node, so a future swap to a
    // hand-rolled number node fails this test.
    const money = container.querySelector('bdi.metric-num');
    expect(money).not.toBeNull();
    expect(money?.textContent).toContain('2,675');
  });

  it('(c) bandRoas=2.8 → green band: band-coloured value + band-tag pill', () => {
    const { container } = render(
      <Widget icon={<IconStub />} title="MER" value={2.8} bandRoas={2.8} />,
    );
    // The numeric band is resolved through the single source of truth.
    expect(bandForRoas(2.8)).toBe('green');
    // Band-tag pill present, using the canonical shared wording.
    const tag = container.querySelector('.band-chip.chip-green');
    expect(tag).not.toBeNull();
    expect(tag?.textContent).toBe(BAND_TAG_LABEL.green);
    // Value carries the band-colour token (not the default ink).
    const value = container.querySelector('[data-band="green"]');
    expect(value).not.toBeNull();
  });

  it('(d) no bandRoas → plain ink, no band-tag pill', () => {
    const { container } = render(
      <Widget icon={<IconStub />} title="הזמנות" value={25} />,
    );
    expect(container.querySelector('.band-chip')).toBeNull();
    expect(container.querySelector('[data-band]')).toBeNull();
  });

  it('(e) renders the supplied icon in the badge slot', () => {
    const { getByTestId } = render(
      <Widget icon={<IconStub />} title="הוצאת פרסום" value="$960" />,
    );
    expect(getByTestId('widget-icon')).not.toBeNull();
  });

  // Regression guard (W3.2 2026-06-13) — the operator-locked freshness
  // desaturation fade. `391fc19` rebuilt the hero on <Widget> but the
  // primitive then had NO `freshness` prop, so the KPI cards silently stopped
  // dimming with data age. The prop must forward straight to the inner Card's
  // `data-freshness` (which `.glass[data-freshness]` turns into saturate()).
  it('(f) freshness="stale" → forwards data-freshness="stale" onto the Card root', () => {
    const { container } = render(
      <Widget
        data-testid="widget-fresh"
        icon={<IconStub />}
        title="הזמנות"
        value="25"
        freshness="stale"
      />,
    );
    const root = container.querySelector('[data-testid="widget-fresh"]');
    expect(root).not.toBeNull();
    expect(root?.getAttribute('data-freshness')).toBe('stale');
  });

  it('(g) freshness="fresh" → data-freshness="fresh"; no freshness → attribute absent', () => {
    const fresh = render(
      <Widget
        data-testid="widget-fresh-on"
        icon={<IconStub />}
        title="הזמנות"
        value="25"
        freshness="fresh"
      />,
    );
    expect(
      fresh.container
        .querySelector('[data-testid="widget-fresh-on"]')
        ?.getAttribute('data-freshness'),
    ).toBe('fresh');

    const none = render(
      <Widget
        data-testid="widget-fresh-off"
        icon={<IconStub />}
        title="הזמנות"
        value="25"
      />,
    );
    // Omitting the prop must NOT stamp a data-freshness attribute at all.
    expect(
      none.container
        .querySelector('[data-testid="widget-fresh-off"]')
        ?.hasAttribute('data-freshness'),
    ).toBe(false);
  });

  // Regression guard (2026-06-13) — a `titleBadge` (e.g. the op-profit LIVE
  // pill) must render OUTSIDE the title's `truncate` span so a long title can
  // never clip it. Inside the truncate, a long range label ("· מתחילת החודש")
  // pushed the LIVE pill past the edge, leaving only a green sliver.
  it('(i) titleBadge renders as a sibling OUTSIDE the truncating title span', () => {
    const { container } = render(
      <Widget
        icon={<IconStub />}
        title="רווח תפעולי"
        titleBadge={<span data-testid="live-pill">LIVE</span>}
        value="$14,929"
      />,
    );
    const pill = container.querySelector('[data-testid="live-pill"]');
    const truncate = container.querySelector('.truncate');
    expect(pill).not.toBeNull();
    expect(truncate).not.toBeNull();
    // The badge must NOT be nested inside the truncate span (which clips it);
    // it sits next to it as a flex sibling.
    expect(truncate?.contains(pill!)).toBe(false);
    // The title text stays inside the truncate span.
    expect(truncate?.textContent).toContain('רווח תפעולי');
  });

  // Contract hardening (reviewer flag) — a caller's stray spread must NOT
  // clobber the band/freshness the Widget owns. The explicit props are set
  // AFTER `{...rest}` in Widget.tsx, so the resolved values win.
  //
  // NOTE (2026-06-13): the resolved band now lives on the VALUE span, not the
  // Card root. `.glass[data-band]` is the vivid STORE-card recipe (opacity:0
  // mount-entrance) so a data-band on a KPI Widget root rendered it invisible —
  // the Card root therefore carries NO data-band at all. `data-freshness` IS
  // still Widget-owned on the root. So this guard now asserts: the resolved band
  // ('green') lands on the value span; a stray spread data-band="red" reaches
  // NEITHER the root (no data-band) nor the value span (the Widget-owned band wins);
  // and the stray data-freshness="fresh" loses to the forwarded "stale" on the root.
  it('(h) a stray spread data-band/data-freshness does NOT clobber the Widget-owned values', () => {
    const { container } = render(
      <Widget
        data-testid="widget-spread"
        icon={<IconStub />}
        title="MER"
        value={2.8}
        bandRoas={2.8}
        freshness="stale"
        // Stray attributes a careless caller might spread — must lose.
        {...({ 'data-band': 'red', 'data-freshness': 'fresh' } as Record<string, string>)}
      />,
    );
    const root = container.querySelector('[data-testid="widget-spread"]');
    // Resolved band ('green') is on the value span, never red, never the stray value.
    const value = container.querySelector('[data-band="green"]');
    expect(value).not.toBeNull();
    expect(container.querySelector('[data-band="red"]')).toBeNull();
    // The Card ROOT carries NO data-band (would make `.glass[data-band]` invisible).
    expect(root?.hasAttribute('data-band')).toBe(false);
    // Freshness IS root-owned: the forwarded prop wins over the stray spread.
    expect(root?.getAttribute('data-freshness')).toBe('stale'); // forwarded prop wins
  });
});
