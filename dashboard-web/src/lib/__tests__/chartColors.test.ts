import { describe, expect, it } from 'vitest';
import { CHART_COLORS } from '@/lib/chartColors';

describe('CHART_COLORS — brand-true palette (2026-05-29 rev2)', () => {
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

  it('CPM routes to the status-orange semantic token (was platform color)', () => {
    expect(CHART_COLORS.cpm).toBe('var(--status-orange)');
  });

  it('CPM previous-period comparator stays a hex literal (lighter amber)', () => {
    // cpmPrev is intentionally a frozen lighter amber so the previous-period
    // line reads as a softer "ghost" against the live cpm line. Not a brand
    // identity, not a status — a deliberate fixed-hue comparator.
    expect(CHART_COLORS.cpmPrev).toBe('#fbbf24');
  });

  it('ROAS and value route to the status-green semantic token', () => {
    expect(CHART_COLORS.roas).toBe('var(--status-green)');
    expect(CHART_COLORS.value).toBe('var(--status-green)');
  });

  it('Spend routes to the status-red semantic token', () => {
    expect(CHART_COLORS.spend).toBe('var(--status-red)');
  });

  it('Axis colors continue to resolve to the theme-aware --chart-axis var', () => {
    expect(CHART_COLORS.axis).toBe('var(--chart-axis)');
    expect(CHART_COLORS.reconciliationAxis).toBe('var(--chart-axis)');
  });
});
