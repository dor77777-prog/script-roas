/**
 * Task 4.1 — unified roasCell helper.
 *
 * Three call sites previously had their own copies of ROAS_BG / roasCell.
 * This module consolidates them and adds a token-driven failure class
 * (`roas-cell-fail`) instead of the literal `bg-black` / `bg-status-red`
 * the individual copies used.
 */

import { describe, expect, it } from 'vitest';
import { roasCell, ROAS_TONE_BG } from '../format/roasCell';
import { roasLabel } from '../analytics';
import { formatNumber } from '../utils';

// ---------------------------------------------------------------------------
// roasCell — three code paths
// ---------------------------------------------------------------------------

describe('roasCell — failure path (spend > 0, revenue = 0)', () => {
  it('returns roas-cell-fail token (NOT bg-black or bg-status-red)', () => {
    const result = roasCell(2.5, 0, 100);
    expect(result.className).toBe('roas-cell-fail');
    expect(result.text).toBe('0');
  });

  it('any non-zero spend with zero revenue triggers the failure path', () => {
    const result = roasCell(0, 0, 1);
    expect(result.className).toBe('roas-cell-fail');
    expect(result.text).toBe('0');
  });
});

describe('roasCell — no-data path (spend = 0, revenue = 0)', () => {
  it('returns empty className and empty text', () => {
    const result = roasCell(0, 0, 0);
    expect(result.className).toBe('');
    expect(result.text).toBe('');
  });
});

describe('roasCell — normal path (revenue > 0)', () => {
  it('returns the band-tone background class + formatted ROAS', () => {
    // roas 3.2 → roasLabel → 'blue' tone → 'bg-status-blueBg'
    const roas = 3.2;
    const revenue = 5000;
    const spend = 1500;
    const result = roasCell(roas, revenue, spend);
    const expectedTone = roasLabel(roas).tone;
    const expectedClass = {
      red: 'bg-status-redBg',
      orange: 'bg-status-orangeBg',
      green: 'bg-status-greenBg',
      blue: 'bg-status-blueBg',
      gray: '',
    }[expectedTone];
    expect(result.className).toBe(expectedClass);
    expect(result.text).toBe(formatNumber(roas));
  });

  it('red-tone ROAS (e.g. 1.5) → bg-status-redBg', () => {
    const result = roasCell(1.5, 1000, 700);
    expect(roasLabel(1.5).tone).toBe('red');
    expect(result.className).toBe('bg-status-redBg');
  });

  it('orange-tone ROAS (e.g. 2.3) → bg-status-orangeBg', () => {
    const result = roasCell(2.3, 2000, 900);
    expect(roasLabel(2.3).tone).toBe('orange');
    expect(result.className).toBe('bg-status-orangeBg');
  });

  it('green-tone ROAS (e.g. 2.9) → bg-status-greenBg', () => {
    const result = roasCell(2.9, 2000, 700);
    expect(roasLabel(2.9).tone).toBe('green');
    expect(result.className).toBe('bg-status-greenBg');
  });

  it('blue-tone ROAS (e.g. 4.0) → bg-status-blueBg', () => {
    const result = roasCell(4.0, 4000, 1000);
    expect(roasLabel(4.0).tone).toBe('blue');
    expect(result.className).toBe('bg-status-blueBg');
  });
});

// ---------------------------------------------------------------------------
// ROAS_TONE_BG — shape and key spot-checks (deduped from CampaignsTableRow)
// ---------------------------------------------------------------------------

describe('ROAS_TONE_BG map', () => {
  it('has exactly 5 entries (red/orange/green/blue/gray)', () => {
    expect(Object.keys(ROAS_TONE_BG)).toHaveLength(5);
    expect(ROAS_TONE_BG).toHaveProperty('red');
    expect(ROAS_TONE_BG).toHaveProperty('orange');
    expect(ROAS_TONE_BG).toHaveProperty('green');
    expect(ROAS_TONE_BG).toHaveProperty('blue');
    expect(ROAS_TONE_BG).toHaveProperty('gray');
  });

  it('each entry includes both a bg- and text- class', () => {
    for (const [tone, classes] of Object.entries(ROAS_TONE_BG)) {
      if (tone === 'gray') {
        // gray uses bg-glass-2 + text-ink
        expect(classes).toContain('bg-glass-2');
        expect(classes).toContain('text-ink');
      } else {
        expect(classes, `ROAS_TONE_BG[${tone}] should have bg-*`).toMatch(/bg-status-\w+/);
        expect(classes, `ROAS_TONE_BG[${tone}] should have text-*`).toMatch(/text-status-\w+/);
      }
    }
  });
});
