import { describe, expect, it } from 'vitest';
import {
  isAuthError,
  isRateLimitError,
  classifyMetaErrorForAlert,
} from '../detectAuthError';

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

  // 2026-06-24 — ROOT FIX: Meta wraps EVERY Graph error in type:OAuthException,
  // so a bare OAuthException with no auth code/message is NOT auth. The old
  // premise (a plain OAuthException classifies auth) WAS the bug — non-auth
  // codes (e.g. code 100 "Invalid parameter") rode the /OAuthException/ wrapper
  // into a false token_failure. Auth is now CODE/MESSAGE-driven, not
  // wrapper-driven.
  it('a bare OAuthException with NO auth code/message is NOT auth (root over-trust removed)', () => {
    expect(isAuthError('meta', 'OAuthException: something about access')).toBe(false);
    expect(isAuthError('meta', '{"error":{"type":"OAuthException"}}')).toBe(false);
  });

  it('code 100 / subcode 1504018 "Invalid parameter" (shorter date range) is NOT auth', () => {
    // Exact prod alert body flavor: code 100, subcode 1504018, HTTP 400.
    expect(
      isAuthError(
        'meta',
        'Meta hot-metrics batch part failed (code=400): {"error":{"message":"Invalid parameter","type":"OAuthException","is_transient":false,"code":100,"error_subcode":1504018,"error_user_title":"x","error_user_msg":"יש לנסות טווח תאריכים קצר יותר"}}',
      ),
    ).toBe(false);
  });

  it('explicit auth MESSAGE without an auth code is still auth (invalid/expired access token)', () => {
    expect(isAuthError('meta', '{"error":{"type":"OAuthException","message":"Invalid OAuth access token"}}')).toBe(true);
  });

  it('non-meta providers unaffected by the exclusion', () => {
    expect(isAuthError('google', 'INVALID_GRANT: token revoked')).toBe(true);
  });
});

// 2026-06-23 — alert-build-time classification. The operator-facing
// "🚨 Token failure" WhatsApp alert MIS-CLASSIFIED transient Meta errors
// (code 2 "Service temporarily unavailable" subcode 1504044; code 4
// "Application request limit reached" subcode 1504022; is_transient:true) as
// TOKEN FAILURES and told the operator to "Refresh the Meta access token and
// redeploy" — wrong + worrying, because a token refresh does nothing for a
// transient/rate-limit blip that self-heals on retry. Only code 190 + genuine
// auth/permission OAuthExceptions are real token failures.
describe('classifyMetaErrorForAlert (2026-06-23)', () => {
  const TOKEN_REFRESH_RE = /refresh.*access token/i;

  it('code 190 (invalid OAuth access token) → token_failure WITH refresh advice', () => {
    const out = classifyMetaErrorForAlert(
      '{"error":{"type":"OAuthException","code":190,"message":"Invalid OAuth access token"}}',
    );
    expect(out.kind).toBe('token_failure');
    expect(out.advice).toMatch(TOKEN_REFRESH_RE);
  });

  it('code 2 / subcode 1504044 "Service temporarily unavailable" → transient WITHOUT refresh advice, not titled token failure', () => {
    const out = classifyMetaErrorForAlert(
      'Meta hot-metrics batch part failed (code=400): {"error":{"message":"Service temporarily unavailable","type":"OAuthException","is_transient":false,"code":2,"error_subcode":1504044}}',
    );
    expect(out.kind).toBe('transient');
    expect(out.advice).not.toMatch(TOKEN_REFRESH_RE);
    // The operation / label must NOT brand this a token failure.
    expect(out.operation).not.toMatch(/auth/i);
    expect(out.titleIsTokenFailure).toBe(false);
  });

  it('code 4 / subcode 1504022 "Application request limit reached" → transient/rate-limit WITHOUT refresh advice', () => {
    const out = classifyMetaErrorForAlert(
      'Meta account spend uzoshop failed (code=4): {"error":{"message":"Application request limit reached","type":"OAuthException","is_transient":true,"code":4,"error_subcode":1504022}}',
    );
    expect(out.kind).toBe('transient');
    expect(out.advice).not.toMatch(TOKEN_REFRESH_RE);
    expect(out.titleIsTokenFailure).toBe(false);
  });

  it('is_transient:true → transient (no refresh advice) even with OAuthException wrapper', () => {
    const out = classifyMetaErrorForAlert(
      '{"error":{"type":"OAuthException","is_transient":true,"code":368}}',
    );
    expect(out.kind).toBe('transient');
    expect(out.advice).not.toMatch(TOKEN_REFRESH_RE);
  });

  it('an unknown error code → neutral message, NO refresh advice, not titled token failure', () => {
    const out = classifyMetaErrorForAlert('fetch failed: ETIMEDOUT');
    expect(out.kind).toBe('unknown');
    expect(out.advice).not.toMatch(TOKEN_REFRESH_RE);
    expect(out.titleIsTokenFailure).toBe(false);
  });

  it('genuine auth: HTTP 401 → token_failure WITH refresh advice (preserved behavior)', () => {
    const out = classifyMetaErrorForAlert('HTTP 401 Unauthorized');
    expect(out.kind).toBe('token_failure');
    expect(out.advice).toMatch(TOKEN_REFRESH_RE);
    expect(out.titleIsTokenFailure).toBe(true);
  });

  it('hard-auth wins over a transient phrase: code 190 + "Service temporarily unavailable" → token_failure', () => {
    const out = classifyMetaErrorForAlert(
      '{"error":{"message":"Service temporarily unavailable","type":"OAuthException","code":190}}',
    );
    expect(out.kind).toBe('token_failure');
    expect(out.advice).toMatch(TOKEN_REFRESH_RE);
  });

  it('transient advice is Hebrew and tells the operator no action is needed unless it persists', () => {
    const out = classifyMetaErrorForAlert(
      '{"error":{"message":"Service temporarily unavailable","type":"OAuthException","code":2}}',
    );
    expect(out.advice).toMatch(/אין צורך בפעולה/);
  });

  // 2026-06-24 prod incident: a code-4 rate-limit came back with HTTP 403, and
  // the old `/\b403\b/` hard-auth pattern misclassified it as meta_hot_metrics_auth
  // with the false "refresh the token" advice. These pin the fix.
  it('PROD: HTTP 403 + code 4 + subcode 1504022 + is_transient:true → transient, NOT token_failure', () => {
    const out = classifyMetaErrorForAlert(
      'Meta hot-metrics batch part failed (code=403): {"error":{"message":"Application request limit reached","type":"OAuthException","is_transient":true,"code":4,"error_subcode":1504022}}',
    );
    expect(out.kind).toBe('transient');
    expect(out.titleIsTokenFailure).toBe(false);
    expect(out.operation).not.toMatch(/auth/);
    expect(out.advice).not.toMatch(/[Rr]efresh|רענן/);
  });

  it('a bare HTTP 403 with NO transient/rate-limit signature still → token_failure (genuine-auth fallback preserved)', () => {
    const out = classifyMetaErrorForAlert('HTTP 403 Forbidden');
    expect(out.kind).toBe('token_failure');
    expect(out.titleIsTokenFailure).toBe(true);
  });

  it('code 190 wins even when the HTTP status is 403 (hard-auth runs first)', () => {
    const out = classifyMetaErrorForAlert(
      'Meta fetch failed (code=403): {"error":{"type":"OAuthException","code":190,"message":"Invalid OAuth access token"}}',
    );
    expect(out.kind).toBe('token_failure');
  });

  // 2026-06-24 prod alert — the latest misclassification: code 100 / subcode
  // 1504018 "Invalid parameter" (error_user_msg "יש לנסות טווח תאריכים קצר יותר"
  // = try a shorter date range; is_transient:false; HTTP 400) was classified
  // meta_hot_metrics_auth WITH "Refresh the Meta access token" advice. code 100
  // is a query/parameter/timeout error, NOT auth — Meta just wraps it in the
  // type:OAuthException envelope like every other Graph error. It must NOT be a
  // token failure and must NOT carry refresh advice.
  it('PROD: code 100 / subcode 1504018 "Invalid parameter" (shorter date range) → unknown, NO refresh advice, not titled token failure', () => {
    const out = classifyMetaErrorForAlert(
      'Meta hot-metrics batch part failed (code=400): {"error":{"message":"Invalid parameter","type":"OAuthException","is_transient":false,"code":100,"error_subcode":1504018,"error_user_title":"x","error_user_msg":"יש לנסות טווח תאריכים קצר יותר"}}',
    );
    expect(out.kind).toBe('unknown');
    expect(out.advice).not.toMatch(TOKEN_REFRESH_RE);
    expect(out.advice).not.toMatch(/[Rr]efresh|רענן/);
    expect(out.operation).not.toMatch(/auth/i);
    expect(out.titleIsTokenFailure).toBe(false);
  });

  it('a bare OAuthException with no auth code/message → NOT token_failure (root over-trust removed)', () => {
    const out = classifyMetaErrorForAlert('{"error":{"type":"OAuthException"}}');
    expect(out.kind).not.toBe('token_failure');
    expect(out.advice).not.toMatch(TOKEN_REFRESH_RE);
    expect(out.titleIsTokenFailure).toBe(false);
  });

  it('an explicit "Invalid OAuth access token" message → token_failure (regression)', () => {
    const out = classifyMetaErrorForAlert(
      '{"error":{"type":"OAuthException","message":"Invalid OAuth access token"}}',
    );
    expect(out.kind).toBe('token_failure');
    expect(out.advice).toMatch(TOKEN_REFRESH_RE);
  });

  it('code 2 → transient (regression)', () => {
    expect(classifyMetaErrorForAlert('{"error":{"type":"OAuthException","code":2}}').kind).toBe('transient');
  });
});
