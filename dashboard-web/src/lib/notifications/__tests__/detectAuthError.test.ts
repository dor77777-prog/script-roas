import { describe, expect, it } from 'vitest';
import { isRateLimitError } from '../detectAuthError';

describe('isRateLimitError', () => {
  it('detects Meta 429 from message body', () => {
    expect(isRateLimitError('meta', 'Meta account spend uzoshop 2026-05-27 failed (429): { "error": { "code": 17, "message": "User request limit reached" } }')).toBe(true);
  });
  it('detects Google quota-exceeded', () => {
    expect(isRateLimitError('google', 'GAQL error 8: Resource has been exhausted (e.g. check quota)')).toBe(true);
  });
  it('detects TikTok rate-limit code 40100', () => {
    expect(isRateLimitError('tiktok', 'TikTok report failed: code=40100 message="rate limit exceeded"')).toBe(true);
  });
  it('detects fetchWithBackoff "exhausted" 429 marker', () => {
    expect(isRateLimitError('meta', 'Meta account spend failed (429): exhausted')).toBe(true);
  });
  it('returns false for auth errors (those go through isAuthError, not this one)', () => {
    expect(isRateLimitError('meta', '190: access token expired')).toBe(false);
  });
  it('returns false for generic network failures', () => {
    expect(isRateLimitError('meta', 'fetch failed: ETIMEDOUT')).toBe(false);
  });

  // Phase A 2026-05-29: MetaBudgetHighError classification
  it('isRateLimitError returns true for meta MetaBudgetHighError message (META_BUDGET_HIGH substring, lowercased)', () => {
    expect(isRateLimitError('meta', 'META_BUDGET_HIGH: relevant BUC reached 85% (threshold 80%)')).toBe(true);
  });

  it('isRateLimitError returns false for META_BUDGET_HIGH against non-meta provider', () => {
    expect(isRateLimitError('google', 'META_BUDGET_HIGH: ...')).toBe(false);
    expect(isRateLimitError('tiktok', 'META_BUDGET_HIGH: ...')).toBe(false);
  });
});
