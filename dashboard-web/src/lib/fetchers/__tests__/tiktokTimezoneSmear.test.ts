import { describe, it, expect } from 'vitest';
import { tiktokTimezoneSmearWarning } from '../tiktok';

/**
 * FIX D (#28) — the TikTok daily window is sent as an Israel date, but TikTok
 * buckets the report in the advertiser ACCOUNT timezone. When the account TZ
 * differs from Asia/Jerusalem there is a potential edge-of-day smear. We do NOT
 * shift the live fetch window (that would change reported numbers); instead the
 * discrepancy must be OBSERVABLE via a warning.
 *
 * `tiktokTimezoneSmearWarning` is the pure check behind the console.warn:
 *   - returns a warning string when the account TZ differs from Asia/Jerusalem
 *   - returns null when it matches (no spurious warning)
 */
describe('tiktokTimezoneSmearWarning (FIX D #28)', () => {
  it('returns a warning when account TZ differs from Asia/Jerusalem', () => {
    const w = tiktokTimezoneSmearWarning('America/New_York', 'uzoshop');
    expect(w).not.toBeNull();
    expect(w).toContain('America/New_York');
    expect(w).toContain('Asia/Jerusalem');
  });

  it('returns a warning for UTC accounts too (default TikTok value)', () => {
    expect(tiktokTimezoneSmearWarning('UTC', 'uzoshop')).not.toBeNull();
  });

  it('returns null when account TZ equals Asia/Jerusalem (no smear)', () => {
    expect(tiktokTimezoneSmearWarning('Asia/Jerusalem', 'uzoshop')).toBeNull();
  });

  it('returns null for an empty/absent timezone (nothing to compare)', () => {
    expect(tiktokTimezoneSmearWarning('', 'uzoshop')).toBeNull();
    expect(tiktokTimezoneSmearWarning(undefined, 'uzoshop')).toBeNull();
  });
});
