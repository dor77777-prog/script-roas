import { describe, expect, it } from 'vitest';
import { CHART_COLORS } from '@/lib/chartColors';

const THEME_HEX = {
  amber600: '#d97706',
  blue600: '#2563eb',
  purple600: '#9333ea',
  // c/HI-01 (audit-2026-05-23-v2): TikTok swapped from pink-500 (#ec4899)
  // to slate-700 (#374151) for colorblind hue separation from organic
  // purple. The pair sat ~60° apart on the wheel and collapsed for
  // protanopia / deuteranopia (~8% of male viewers).
  slate700: '#374151',
  roasGreen: '#15803d',
  roasRed: '#dc2626',
};

describe('CHART_COLORS — locks TEST-06 (5.2.2.1)', () => {
  it('Meta and CPM colors match Tailwind amber-600', () => {
    expect(CHART_COLORS.meta).toBe(THEME_HEX.amber600);
    expect(CHART_COLORS.cpm).toBe(THEME_HEX.amber600);
  });

  it('Google color matches Tailwind blue-600', () => {
    expect(CHART_COLORS.google).toBe(THEME_HEX.blue600);
  });

  it('TikTok color matches Tailwind slate-700 (colorblind-safe, c/HI-01)', () => {
    expect(CHART_COLORS.tiktok).toBe(THEME_HEX.slate700);
    // Explicit anti-regression: must NOT be the original pink-500 that
    // sat too close in hue to organic purple.
    expect(CHART_COLORS.tiktok).not.toBe('#ec4899');
  });

  it('Organic color matches Tailwind purple-600', () => {
    expect(CHART_COLORS.organic).toBe(THEME_HEX.purple600);
  });

  it('Shopify, ROAS, and value colors match roas.green', () => {
    expect(CHART_COLORS.shopify).toBe(THEME_HEX.roasGreen);
    expect(CHART_COLORS.roas).toBe(THEME_HEX.roasGreen);
    expect(CHART_COLORS.value).toBe(THEME_HEX.roasGreen);
  });

  it('Spend color matches roas.red', () => {
    expect(CHART_COLORS.spend).toBe(THEME_HEX.roasRed);
  });

  it('Axis colors resolve to the theme-aware --chart-axis var (dark-mode contrast fix 2026-05-29)', () => {
    // The previous slate hex literals (#7a8a9a / #64748b) had ~1.5:1
    // contrast against the dark canvas — failing WCAG entirely.
    // They now route through ChartContainer's --chart-axis → --text-muted
    // token chain, which is OKLCH(60% L) on the active theme's hue.
    expect(CHART_COLORS.axis).toBe('var(--chart-axis)');
    expect(CHART_COLORS.reconciliationAxis).toBe('var(--chart-axis)');
  });
});
