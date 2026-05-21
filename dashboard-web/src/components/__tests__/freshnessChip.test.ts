// Phase 05.7.6 — freshness chip formatter tests.
//
// Pure-function tests for `formatTimeAgo`. The DOM component itself
// (FreshnessChip) is presentation-only on top of this formatter, so
// covering the formatter covers all the behavior worth testing.

import { describe, it, expect } from 'vitest';
import { formatTimeAgo } from '../FreshnessChip';

const NOW = new Date('2026-05-22T01:30:00+03:00'); // 22:30 UTC May 21

function ago(minutes: number): string {
  return new Date(NOW.getTime() - minutes * 60_000).toISOString();
}

describe('formatTimeAgo', () => {
  it('null → "אין נתונים" / gray, no warning', () => {
    const r = formatTimeAgo(null, NOW);
    expect(r).toEqual({ label: 'אין נתונים', tone: 'gray', warning: false });
  });

  it('non-ISO string → "אין נתונים" / gray', () => {
    const r = formatTimeAgo('not-a-date', NOW);
    expect(r.label).toBe('אין נתונים');
    expect(r.tone).toBe('gray');
  });

  it('<60s → "עודכן עכשיו" / green', () => {
    const r = formatTimeAgo(ago(0), NOW);
    expect(r.label).toBe('עודכן עכשיו');
    expect(r.tone).toBe('green');
    expect(r.warning).toBe(false);
  });

  it('5 min ago → "עודכן לפני 5 דק׳" / green', () => {
    const r = formatTimeAgo(ago(5), NOW);
    expect(r.label).toBe('עודכן לפני 5 דק׳');
    expect(r.tone).toBe('green');
    expect(r.warning).toBe(false);
  });

  it('19 min ago → green (just under 20-min boundary)', () => {
    const r = formatTimeAgo(ago(19), NOW);
    expect(r.tone).toBe('green');
    expect(r.warning).toBe(false);
  });

  it('20 min ago → yellow + warning (boundary crossed)', () => {
    const r = formatTimeAgo(ago(20), NOW);
    expect(r.label).toBe('עודכן לפני 20 דק׳');
    expect(r.tone).toBe('yellow');
    expect(r.warning).toBe(true);
  });

  it('45 min ago → yellow + warning', () => {
    const r = formatTimeAgo(ago(45), NOW);
    expect(r.tone).toBe('yellow');
    expect(r.warning).toBe(true);
  });

  it('60 min ago → red + warning ("עודכן לפני 1 שעות")', () => {
    const r = formatTimeAgo(ago(60), NOW);
    expect(r.label).toBe('עודכן לפני 1 שעות');
    expect(r.tone).toBe('red');
    expect(r.warning).toBe(true);
  });

  it('3 hours ago → red', () => {
    const r = formatTimeAgo(ago(180), NOW);
    expect(r.label).toBe('עודכן לפני 3 שעות');
    expect(r.tone).toBe('red');
  });

  it('>24h ago → absolute timestamp DD/MM HH:MM / red', () => {
    const r = formatTimeAgo(ago(60 * 25), NOW);
    expect(r.tone).toBe('red');
    // Format: '21/05 00:30' (25 hours before 22-May 01:30 = 21-May 00:30)
    expect(r.label).toMatch(/^\d{2}\/\d{2} \d{2}:\d{2}$/);
  });

  it('future timestamp (clock skew) → "עודכן עכשיו" / green', () => {
    const future = new Date(NOW.getTime() + 60_000).toISOString();
    const r = formatTimeAgo(future, NOW);
    expect(r.label).toBe('עודכן עכשיו');
    expect(r.tone).toBe('green');
  });
});
