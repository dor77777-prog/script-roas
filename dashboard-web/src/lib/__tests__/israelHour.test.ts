// Tests for the israelHour() helper used by the Vercel Cron routes
// (Inngest → Vercel Cron migration, Stage 1). Vercel Cron fires in UTC and
// each TZ-sensitive cron is dual-fired at both DST UTC offsets; the route
// handler gates on the Israel local hour so exactly one fire per day proceeds.

import { describe, it, expect } from 'vitest';
import { israelHour, israelWeekday } from '../dateRange';

describe('israelHour', () => {
  it('returns 0 for 22:00 UTC in winter (IST = UTC+2)', () => {
    // 2026-01-15 is winter (IST, UTC+2). 22:00 UTC → 00:00 IL.
    expect(israelHour(new Date('2026-01-15T22:00:00Z'))).toBe(0);
  });

  it('returns 0 for 21:00 UTC in summer (IDT = UTC+3)', () => {
    // 2026-07-15 is summer (IDT, UTC+3). 21:00 UTC → 00:00 IL.
    expect(israelHour(new Date('2026-07-15T21:00:00Z'))).toBe(0);
  });

  it('returns 12 for 10:00 UTC in winter (noon IL)', () => {
    expect(israelHour(new Date('2026-01-15T10:00:00Z'))).toBe(12);
  });

  it('returns 12 for 09:00 UTC in summer (noon IL)', () => {
    expect(israelHour(new Date('2026-07-15T09:00:00Z'))).toBe(12);
  });

  it('does NOT match the off-DST fire (winter 21:00 UTC → 23:00 IL, not 00)', () => {
    // The dual-fire safety: a winter run at the summer UTC time must land on
    // a DIFFERENT IL hour so the hour-gate makes it a no-op.
    expect(israelHour(new Date('2026-01-15T21:00:00Z'))).toBe(23);
  });

  it('does NOT match the off-DST fire (summer 22:00 UTC → 01:00 IL, not 00)', () => {
    expect(israelHour(new Date('2026-07-15T22:00:00Z'))).toBe(1);
  });

  it('returns a number 0..23 for the current instant when called with no arg', () => {
    const h = israelHour();
    expect(Number.isInteger(h)).toBe(true);
    expect(h).toBeGreaterThanOrEqual(0);
    expect(h).toBeLessThanOrEqual(23);
  });
});

describe('israelWeekday', () => {
  it('returns 1 (Monday) for a Monday morning IL instant', () => {
    // 2026-06-22 is a Monday; 06:00 UTC → 09:00 IL (still Monday).
    expect(israelWeekday(new Date('2026-06-22T06:00:00Z'))).toBe(1);
  });

  it('returns 1 (Monday) when summer 01:00 UTC maps to Monday 04:00 IL', () => {
    // 2026-06-22 01:00 UTC (summer, UTC+3) → 04:00 IL Monday — the cohort target.
    expect(israelWeekday(new Date('2026-06-22T01:00:00Z'))).toBe(1);
  });

  it('returns 0 (Sunday) for late-Sunday UTC that is still Sunday in IL', () => {
    // 2026-06-21 is a Sunday; 18:00 UTC → 21:00 IL (still Sunday).
    expect(israelWeekday(new Date('2026-06-21T18:00:00Z'))).toBe(0);
  });
});
