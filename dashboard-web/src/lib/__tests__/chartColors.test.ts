import { describe, expect, it } from 'vitest';
import { CHART_COLORS, CHART_AXIS_COLOR, PLATFORM_TOKENS } from '@/lib/chartColors';

describe('CHART_COLORS — brand-true palette (2026-05-30 PLATFORM_TOKENS rev)', () => {
  it('Meta routes to the brand-blue chart-platform CSS var', () => {
    expect(CHART_COLORS.meta).toBe('var(--chart-platform-meta)');
  });

  it('Google routes to the brand-amber chart-platform CSS var', () => {
    expect(CHART_COLORS.google).toBe('var(--chart-platform-google)');
  });

  it('TikTok routes to the brand-red chart-platform CSS var', () => {
    expect(CHART_COLORS.tiktok).toBe('var(--chart-platform-tiktok)');
  });

  it('Organic routes to the brand-purple chart-platform CSS var', () => {
    expect(CHART_COLORS.organic).toBe('var(--chart-platform-organic)');
  });

  it('Shopify routes to the brand-green chart-platform CSS var', () => {
    expect(CHART_COLORS.shopify).toBe('var(--chart-platform-shopify)');
  });

  it('CPM routes to the status-blue semantic token', () => {
    expect(CHART_COLORS.cpm).toBe('var(--status-blue)');
  });

  it('CPM previous-period comparator routes to the mode-aware --chart-cpm-prev CSS var', () => {
    // cpmPrev is a theme-aware CSS var so light/dark both get an appropriate
    // "ghost" lighter hue without hardcoding a hex literal.
    expect(CHART_COLORS.cpmPrev).toBe('var(--chart-cpm-prev)');
  });

  it('ROAS routes to the status-green semantic token', () => {
    expect(CHART_COLORS.roas).toBe('var(--status-green)');
  });

  it('value routes to the text-secondary semantic token', () => {
    expect(CHART_COLORS.value).toBe('var(--text-secondary)');
  });

  it('Spend routes to the status-red semantic token', () => {
    expect(CHART_COLORS.spend).toBe('var(--status-red)');
  });

  it('CHART_AXIS_COLOR resolves to the theme-aware --chart-axis var', () => {
    expect(CHART_AXIS_COLOR).toBe('var(--chart-axis)');
  });

  it('PLATFORM_TOKENS each resolve to their chart-platform CSS var', () => {
    for (const p of ['meta', 'google', 'tiktok', 'organic', 'shopify'] as const) {
      expect(PLATFORM_TOKENS[p].color).toBe(`var(--chart-platform-${p})`);
    }
  });
});
