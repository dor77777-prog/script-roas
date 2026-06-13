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
});
