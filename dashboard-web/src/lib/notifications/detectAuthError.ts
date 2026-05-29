/**
 * Phase 12.5.x (2026-05-24) — heuristic auth-error detector.
 *
 * Pure helper used by cronDaily / cronLive catch blocks to decide whether
 * a thrown fetcher error looks like a token/auth failure (worth alerting
 * via `notifyTokenFailure`) or a generic upstream/transport problem (just
 * a warn, no operator alert).
 *
 * The fetchers throw with provider-specific message shapes — we match on
 * common substrings instead of parsing structured errors because each API
 * has its own body format and we don't want to plumb the raw HTTP response
 * up the call stack just for this one classification.
 *
 * Conservative bias: when in doubt → return false. A false-negative means
 * one missed alert (operator catches it on /operator panel next time);
 * a false-positive means alert spam, which is much worse for trust.
 */

import type { TokenFailureProvider } from './tokenFailures';

/**
 * Regex patterns for each provider's auth-error message shape. Built from
 * actual error shapes seen in production cron-daily / cron-live logs +
 * the documented status codes for each API. Case-insensitive.
 *
 * NOTE: the generic patterns (HTTP 401 / 403 / Unauthorized / Forbidden /
 * "invalid token" / "expired") are merged into every provider — they cover
 * the common cases, the provider-specific lines add tail patterns unique
 * to each platform's body shape (e.g. Meta `code: 190`, Google
 * `INVALID_GRANT`, TikTok `40104`).
 */
const GENERIC_AUTH = [
  /\b401\b/i,
  /\b403\b/i,
  /\bunauthor[iz]ed\b/i,
  /\bforbidden\b/i,
  /\binvalid[\s_-]+token\b/i,
  /\btoken[\s_-]+(?:expired|invalid)\b/i,
  /\bauthentication\b.*(?:failed|denied|error)/i,
  /\baccess[\s_-]+token\b.*(?:invalid|expired|missing)/i,
  /\bmissing\b.*\b(?:token|access)/i,
];

const PROVIDER_PATTERNS: Record<TokenFailureProvider, RegExp[]> = {
  meta: [
    ...GENERIC_AUTH,
    /OAuth\s*(?:Exception|access)/i,
    /\b"code":\s*190\b/, // Meta: invalid OAuth access token
    /\b"code":\s*102\b/, // Meta: session expired
    /\b"code":\s*460\b/, // Meta: logged out
    /session\s+(?:expired|invalid)/i,
  ],
  google: [
    ...GENERIC_AUTH,
    /INVALID[_\s]GRANT/i,
    /UNAUTHENTICATED/i,
    /AUTHENTICATION[_\s]ERROR/i,
    /refresh[_\s]token/i,
  ],
  tiktok: [
    ...GENERIC_AUTH,
    /\b40104\b/, // TikTok: token invalid
    /\b40105\b/, // TikTok: token expired
    /access[_\s]token\s+(?:is\s+)?invalid/i,
  ],
  shopify: [
    ...GENERIC_AUTH,
    /Invalid\s+API\s+key/i,
    /storefront[_\s]access[_\s]token/i,
  ],
  whatsapp: [
    ...GENERIC_AUTH,
    /\bcode["':\s]*132/i, // Meta WhatsApp template errors (132xxx)
    /OAuthException/i,
  ],
  fx: [
    ...GENERIC_AUTH,
    /\bAPI[\s_-]?key/i, // OXR uses "Invalid API key"
    /quota[_\s]exceeded/i,
  ],
};

/**
 * Return true when `errMsg` looks like an auth/token failure for `provider`.
 * Soft-default to false on a malformed input (empty / non-string / no
 * pattern match) — the caller still warns + retries; we just don't fire
 * an operator alert.
 */
export function isAuthError(provider: TokenFailureProvider, errMsg: unknown): boolean {
  if (typeof errMsg !== 'string' || errMsg.length === 0) return false;
  const patterns = PROVIDER_PATTERNS[provider];
  for (const p of patterns) {
    if (p.test(errMsg)) return true;
  }
  return false;
}

/**
 * Phase 13.9 (2026-05-27) — classifier for rate-limit / quota-exhaustion
 * errors from ad platforms. Distinct from `isAuthError` because the
 * operator's mitigation is different: auth = "refresh the token", rate-
 * limit = "wait, no action needed, the system retries next tick".
 *
 * Pattern sources:
 *   - Meta:    HTTP 429 + body `{ "error": { "code": 4 | 17 | 32, ... } }` ("User request limit reached", "Application request limit").
 *   - Google:  GAQL `RESOURCE_EXHAUSTED` (code 8) or `QUOTA_EXCEEDED`.
 *   - TikTok:  code 40100 ("rate limit exceeded").
 *   - All:     fetchWithBackoff exhausts retries → returns the final 429
 *              whose body is replaced with the literal string "exhausted".
 *   - Phase A 2026-05-29: `META_BUDGET_HIGH` is the proactive pre-emption
 *              signal from fetchMeta.ts (MetaBudgetHighError) — distinct
 *              from a reactive 429. It matches on the meta branch so callers
 *              that branch on `isRateLimitError` route it to "wait, no
 *              action needed" rather than prompting an auth-refresh.
 *
 * Tight matching by substring to avoid false-positives on non-rate-limit
 * fetches; conservative because the consequence of misclassifying is
 * sending a noisy WhatsApp alert.
 */
export function isRateLimitError(
  provider: 'meta' | 'google' | 'tiktok' | 'shopify',
  errorMsg: string,
): boolean {
  if (!errorMsg) return false;
  const m = errorMsg.toLowerCase();
  // Universal: HTTP 429 in any provider's wrapped message OR the
  // withBackoff "exhausted" sentinel.
  if (m.includes('(429)') || m.includes(' 429 ') || m.includes('exhausted')) return true;
  if (provider === 'meta') {
    return (
      m.includes('user request limit reached') ||
      m.includes('application request limit') ||
      m.includes('"code": 4') ||
      m.includes('"code": 17') ||
      m.includes('"code": 32') ||
      m.includes('meta_budget_high')
    );
  }
  if (provider === 'google') {
    return (
      m.includes('resource_exhausted') ||
      m.includes('resource has been exhausted') ||
      m.includes('quota_exceeded') ||
      m.includes('quota exceeded') ||
      /gaql error 8\b/.test(m)
    );
  }
  if (provider === 'tiktok') {
    return m.includes('40100') || m.includes('rate limit exceeded');
  }
  return false;
}
