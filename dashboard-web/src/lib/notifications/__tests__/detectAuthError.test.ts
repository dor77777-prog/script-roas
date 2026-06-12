import { describe, expect, it } from 'vitest';
import { isAuthError, isRateLimitError } from '../detectAuthError';

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

// 2026-06-12 — production incident: Meta wraps EVERY Graph error in
// "type":"OAuthException", so a transient code=2 "Service temporarily
// unavailable" (subcode 1504044) was classified auth → operator paged with
// "refresh the token" while the same tick's next batch part succeeded 32s
// later. Transient-service signatures must NOT classify as auth unless a
// hard auth signature (190/102/460/401/403/session) is also present.
describe('isAuthError — Meta transient-service exclusion (2026-06-12)', () => {

  const PROD_TRANSIENT_BODY =
    'Meta hot-metrics batch part failed (code=400): {"error":{"message":"Service temporarily unavailable","type":"OAuthException","is_transient":false,"code":2,"error_subcode":1504044,"error_user_title":"x","error_user_msg":"y"}}';

  it('the exact production transient body is NOT an auth error', () => {
    expect(isAuthError('meta', PROD_TRANSIENT_BODY)).toBe(false);
  });

  it('code 1 (API Unknown) with OAuthException wrapper is NOT auth', () => {
    expect(
      isAuthError('meta', '{"error":{"message":"An unknown error occurred","type":"OAuthException","code":1}}'),
    ).toBe(false);
  });

  it('is_transient:true is NOT auth even with OAuthException', () => {
    expect(
      isAuthError('meta', '{"error":{"type":"OAuthException","is_transient":true,"code":368}}'),
    ).toBe(false);
  });

  it('REAL auth errors still detected: code 190 wins over a transient phrase', () => {
    expect(
      isAuthError('meta', '{"error":{"message":"Service temporarily unavailable","type":"OAuthException","code": 190}}'.replace('"code": 190', '"code":190')),
    ).toBe(true);
    expect(isAuthError('meta', '{"error":{"type":"OAuthException","code":190,"message":"Invalid OAuth access token"}}')).toBe(true);
    expect(isAuthError('meta', 'HTTP 401 Unauthorized')).toBe(true);
    expect(isAuthError('meta', '{"error":{"type":"OAuthException","code":102,"message":"Session key invalid"}}')).toBe(true);
  });

  it('plain OAuthException with no transient signature still classifies auth (unchanged behavior)', () => {
    expect(isAuthError('meta', 'OAuthException: something about access')).toBe(true);
  });

  it('non-meta providers unaffected by the exclusion', () => {
    expect(isAuthError('google', 'INVALID_GRANT: token revoked')).toBe(true);
  });
});
