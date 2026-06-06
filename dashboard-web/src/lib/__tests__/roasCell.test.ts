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
  // OPERATOR FIX (2026-06-01): the monthly-table ROAS value is now a SOLID
  // status badge (`bg-status-{c} text-accent-fg`) matching HealthScoreBadge +
  // the mockup, instead of the prior pale `bg-status-*Bg` full-cell tint.
  // Thresholds + band→tone mapping are UNCHANGED — only the color style.
  it('returns the SOLID band-tone badge class + formatted ROAS', () => {
    // A11y FINAL (2026-06-01): the solid ROAS badge now points at the deepened
    // on-hue `-btn` token (white text fails AA on the raw --status-* hue), so
    // the className is `bg-status-{c}Btn text-accent-fg`. Thresholds + band→tone
    // mapping are UNCHANGED — only the deepened bg.
    // roas 3.2 → roasLabel → 'blue' tone → 'bg-status-blueBtn text-accent-fg'
    const roas = 3.2;
    const revenue = 5000;
    const spend = 1500;
    const result = roasCell(roas, revenue, spend);
    const expectedTone = roasLabel(roas).tone;
    const expectedClass = {
      red: 'bg-status-redBtn text-accent-fg',
      // Bright #EF9331 ROAS orange (operator-locked 2026-06-01) — dark on-text.
      orange: 'bg-status-orangeSolid text-status-orangeSolidFg',
      green: 'bg-status-greenBtn text-accent-fg',
      blue: 'bg-status-blueBtn text-accent-fg',
      gray: '',
    }[expectedTone];
    expect(result.className).toBe(expectedClass);
    expect(result.text).toBe(formatNumber(roas));
  });

  it('red-tone ROAS (e.g. 1.5) → solid bg-status-redBtn text-accent-fg', () => {
    const result = roasCell(1.5, 1000, 700);
    expect(roasLabel(1.5).tone).toBe('red');
    expect(result.className).toBe('bg-status-redBtn text-accent-fg');
  });

  it('orange-tone ROAS (e.g. 2.3) → bright #EF9331 bg-status-orangeSolid + dark on-text', () => {
    const result = roasCell(2.3, 2000, 900);
    expect(roasLabel(2.3).tone).toBe('orange');
    // Operator-locked 2026-06-01: the ROAS orange is the bright #EF9331 (same as
    // the band cards) with a DARK on-color — white fails AA on a bright orange.
    expect(result.className).toBe('bg-status-orangeSolid text-status-orangeSolidFg');
  });

  it('green-tone ROAS (e.g. 2.9) → solid bg-status-greenBtn text-accent-fg', () => {
    const result = roasCell(2.9, 2000, 700);
    expect(roasLabel(2.9).tone).toBe('green');
    expect(result.className).toBe('bg-status-greenBtn text-accent-fg');
  });

  it('blue-tone ROAS (e.g. 4.0) → solid bg-status-blueBtn text-accent-fg', () => {
    const result = roasCell(4.0, 4000, 1000);
    expect(roasLabel(4.0).tone).toBe('blue');
    expect(result.className).toBe('bg-status-blueBtn text-accent-fg');
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
    // OPERATOR FIX (2026-06-01): non-gray tones are now SOLID badges
    // (white `text-accent-fg`), matching HealthScoreBadge + the mockup,
    // instead of the prior pale `bg-status-*Bg` / `text-status-*Fg`.
    // A11y FINAL (2026-06-01): the solid bg points at the deepened on-hue
    // `-btn` token (white fails AA on the raw --status-* hue).
    for (const [tone, classes] of Object.entries(ROAS_TONE_BG)) {
      if (tone === 'gray') {
        // gray (no/low data) stays a quiet neutral chip: bg-glass-2 + text-ink
        expect(classes).toContain('bg-glass-2');
        expect(classes).toContain('text-ink');
      } else if (tone === 'orange') {
        // bright #EF9331 ROAS orange (operator-locked 2026-06-01) = solid
        // bg-status-orangeSolid + DARK on-text (white fails AA on bright orange).
        expect(classes).toContain('bg-status-orangeSolid');
        expect(classes).toContain('text-status-orangeSolidFg');
      } else {
        expect(classes, `ROAS_TONE_BG[${tone}] should have a solid bg-status-*Btn`)
          .toMatch(/bg-status-(red|green|blue)Btn\b/);
        expect(classes, `ROAS_TONE_BG[${tone}] should have white text-accent-fg`)
          .toContain('text-accent-fg');
      }
    }
  });
});

describe('roasCell — off-state (Phase 2)', () => {
  it('default off=false keeps existing behavior (backward compatible)', () => {
    expect(roasCell(3.5, 100, 28).text).toBe('3.50');
    expect(roasCell(0, 0, 50)).toMatchObject({ className: 'roas-cell-fail', text: '0' });
    expect(roasCell(0, 0, 0)).toMatchObject({ className: '', text: '' });
  });
  it('off + spend 0 + revenue>0 → organic blue "אורגני"', () => {
    const c = roasCell(0, 250, 0, true);
    expect(c.text).toBe('אורגני');
    expect(c.className).toContain('blue');
  });
  it('off + spend 0 + revenue 0 → neutral "0" (not the black fail cell)', () => {
    const c = roasCell(0, 0, 0, true);
    expect(c.text).toBe('0');
    expect(c.className).not.toBe('roas-cell-fail');
    expect(c.className).toContain('glass'); // bg-glass-2 neutral chip
  });
  it('off + spend>0 (historical) → normal (never retroactively rewritten)', () => {
    expect(roasCell(3.5, 100, 28, true).text).toBe('3.50');
  });
});
