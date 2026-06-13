import { describe, it, expect } from 'vitest';
import {
  bandForPeriod,
  chartLineStyleForBand,
  areaGradientIdForBand,
  BAND_STROKE_VAR,
  ORGANIC_DASH,
} from '@/components/home/roasChartBand';

/**
 * Unit tests for the PURE period-avg → band → stroke/area mapper that drives
 * the single-hue ROAS chart line (design spec §3.2.2). Mirrors the thresholds
 * locked in lib/roasBands.ts (and tested in roasBands.test.ts) — if these two
 * ever disagree, the chart line would lie about the band.
 */
describe('bandForPeriod — period-average → single chart band', () => {
  it('avg < 2.0 ⇒ red (solid)', () => {
    const r = bandForPeriod({ roas: 1.62, spend: 5000 });
    expect(r.band).toBe('red');
    expect(r.isOrganic).toBe(false);
    const style = chartLineStyleForBand(r.band, r.isOrganic);
    expect(style.strokeVar).toBe('var(--band-red)');
    expect(style.isDashed).toBe(false);
    expect(style.dash).toBeUndefined();
  });

  it('avg 2.34 ⇒ orange', () => {
    expect(bandForPeriod({ roas: 2.34, spend: 5000 }).band).toBe('orange');
    expect(chartLineStyleForBand('orange', false).strokeVar).toBe('var(--band-orange)');
  });

  it('avg 2.88 ⇒ green', () => {
    expect(bandForPeriod({ roas: 2.88, spend: 5000 }).band).toBe('green');
    expect(chartLineStyleForBand('green', false).strokeVar).toBe('var(--band-green)');
  });

  it('avg 3.42 ⇒ blue', () => {
    expect(bandForPeriod({ roas: 3.42, spend: 5000 }).band).toBe('blue');
    expect(chartLineStyleForBand('blue', false).strokeVar).toBe('var(--band-blue)');
  });

  // Boundaries — mirror bandForRoas exactly (2.0/2.69 orange, 2.7/3.0 green, 3.01 blue).
  it('boundaries match the operator-locked ladder', () => {
    expect(bandForPeriod({ roas: 2.0, spend: 1 }).band).toBe('orange');
    expect(bandForPeriod({ roas: 2.69, spend: 1 }).band).toBe('orange');
    expect(bandForPeriod({ roas: 2.7, spend: 1 }).band).toBe('green');
    expect(bandForPeriod({ roas: 3.0, spend: 1 }).band).toBe('green');
    expect(bandForPeriod({ roas: 3.01, spend: 1 }).band).toBe('blue');
  });

  it('total spend 0 ⇒ organic gray + dashed (wins over any roas value)', () => {
    const r = bandForPeriod({ roas: 5, spend: 0 });
    expect(r.band).toBe('gray');
    expect(r.isOrganic).toBe(true);
    const style = chartLineStyleForBand(r.band, r.isOrganic);
    expect(style.strokeVar).toBe('var(--band-gray)');
    expect(style.isDashed).toBe(true);
    expect(style.dash).toBe(ORGANIC_DASH);
    expect(style.dash).toBe('1 6'); // mockup-locked organic dash
  });

  it('organic also triggers when roas is null (no-spend nulls the ratio upstream)', () => {
    const r = bandForPeriod({ roas: null, spend: 0 });
    expect(r.band).toBe('gray');
    expect(r.isOrganic).toBe(true);
  });

  it('non-organic period with a null/NaN ratio falls through to red (not organic)', () => {
    // spend > 0 but ratio missing → genuine below-break-even / no-return signal.
    expect(bandForPeriod({ roas: null, spend: 4000 })).toEqual({ band: 'red', isOrganic: false });
    expect(bandForPeriod({ roas: NaN, spend: 4000 })).toEqual({ band: 'red', isOrganic: false });
  });

  it('every band maps to a --band-* token (token-only, no raw hex)', () => {
    for (const v of Object.values(BAND_STROKE_VAR)) {
      expect(v).toMatch(/^var\(--band-(red|orange|green|blue|gray)\)$/);
    }
  });

  it('area gradient id is keyed to the band (organic distinct)', () => {
    expect(areaGradientIdForBand('blue', false)).toBe('roas-area-blue');
    expect(areaGradientIdForBand('red', false)).toBe('roas-area-red');
    expect(areaGradientIdForBand('gray', true)).toBe('roas-area-organic');
  });
});
