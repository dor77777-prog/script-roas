import { describe, it, expect } from 'vitest';
import { formatTimeAgo } from '../FreshnessChip';

/**
 * FIX E (#32) — the >24h absolute-timestamp fallback in FreshnessChip rendered
 * via local getDate/getMonth/getHours/getMinutes, i.e. in the BROWSER-local
 * timezone, while the chip's tooltip (and the rest of the dashboard) renders in
 * Asia/Jerusalem. On a non-IL browser the fallback showed a different wall
 * clock than the tooltip on the SAME chip.
 *
 * The fix formats the fallback with Intl.DateTimeFormat({ timeZone:
 * 'Asia/Jerusalem' }), so the fallback shows the IL wall-clock regardless of
 * the browser TZ. These tests run with TZ forced to a non-IL zone (see the
 * package script / inline env) so the local-accessor bug would be observable.
 */

// IL = UTC+2 in winter, so 2026-01-15T23:30:00Z is 2026-01-16 01:30 in IL.
const ISO = '2026-01-15T23:30:00Z';
const NOW = new Date(Date.parse(ISO) + 48 * 60 * 60 * 1000); // 48h later → >24h band

// The expected IL wall-clock, computed the same way the production code does
// (TZ-independent — identical on any machine TZ).
function expectedIlLabel(iso: string): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Jerusalem',
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(new Date(iso));
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  return `${get('day')}/${get('month')} ${get('hour')}:${get('minute')}`;
}

describe('FreshnessChip formatTimeAgo — >24h fallback in Asia/Jerusalem (FIX E #32)', () => {
  it('renders the IL wall-clock (16/01 01:30), not the browser-local clock', () => {
    const { label, tone } = formatTimeAgo(ISO, NOW);
    expect(tone).toBe('red');
    expect(label).toBe('16/01 01:30');
    expect(label).toBe(expectedIlLabel(ISO));
  });

  it('matches the IL Intl formatting regardless of host TZ', () => {
    const { label } = formatTimeAgo(ISO, NOW);
    // If the code used local getDate/getHours, this would differ on a non-IL
    // TZ host (e.g. America/New_York → 15/01 18:30).
    expect(label).toBe(expectedIlLabel(ISO));
  });
});
