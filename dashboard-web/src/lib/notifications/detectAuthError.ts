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
