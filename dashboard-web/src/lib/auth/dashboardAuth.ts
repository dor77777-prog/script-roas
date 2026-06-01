// dashboard-web/src/lib/auth/dashboardAuth.ts
//
// Password-gate trusted-device cookie — pure, testable helper module.
//
// Mirrors the existing `lib/middlewareHelpers.ts` pattern (pure functions,
// unit-testable, no Next.js runtime dependency) so BOTH the Edge middleware
// (src/middleware.ts) and the Node API route (src/app/api/login/route.ts) can
// call the SAME implementation.
//
// === Why Web Crypto, not node:crypto ===
//
// The middleware runs in the Edge runtime, where Node's `crypto` module does
// NOT exist. `globalThis.crypto.subtle` (Web Crypto) is present in BOTH Edge
// and Node 18+, so the HMAC sign/verify here uses it exclusively. The API
// route is Node runtime and could use either, but sharing this one module
// avoids two divergent implementations.
//
// === Cookie token shape ===
//
//   `${expiryEpochMs}.${hmacHexOf(expiryEpochMs)}`
//
// The cookie does NOT contain the password. It carries an expiry timestamp
// plus an HMAC of that timestamp keyed by AUTH_SIGNING_SECRET. Verification:
//   1. recompute the HMAC over the expiry string,
//   2. constant-time compare against the cookie's signature (tamper check),
//   3. require expiry > now (freshness check).
// Any tamper with the expiry invalidates the signature; any tamper with the
// signature fails the compare. A stale token (expiry passed) is rejected
// even if its signature is still valid — the 60-day window is enforced.

// Reuse the Edge-safe constant-time compare from the operator-gate helpers
// rather than duplicating it.
import { constantTimeEqual } from '@/lib/middlewareHelpers';

const COOKIE_NAME = 'dash_auth';
const SIXTY_DAYS_MS = 60 * 24 * 60 * 60 * 1000;

/**
 * Edge+Node-safe HMAC-SHA-256 over `message`, keyed by `secret`, returned as
 * lowercase hex. Uses `globalThis.crypto.subtle` (Web Crypto), available in
 * both the Edge runtime and Node 18+.
 */
async function hmacHex(secret: string, message: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(message));
  return [...new Uint8Array(sig)]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Build a fresh trusted-device token valid for 60 days from `now`.
 * Returns `${expiry}.${hmacHex(expiry)}`.
 */
export async function makeAuthToken(secret: string, now: number): Promise<string> {
  const expiry = now + SIXTY_DAYS_MS;
  const sig = await hmacHex(secret, String(expiry));
  return `${expiry}.${sig}`;
}

/**
 * Verify a trusted-device token. Returns true iff:
 *   - the token is well-formed (`<expiry>.<sig>` with a non-empty expiry),
 *   - the expiry parses to a finite number that is still in the future,
 *   - the signature recomputes to exactly the embedded signature.
 *
 * Constant-time compare on the signature; the expiry/format checks short-
 * circuit on obviously-bad input (they reveal nothing secret).
 */
export async function verifyAuthToken(
  secret: string,
  token: string | undefined | null,
  now: number,
): Promise<boolean> {
  if (!token) return false;
  const dot = token.indexOf('.');
  if (dot < 1) return false; // no dot, or empty expiry segment
  const expiryStr = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expiry = Number(expiryStr);
  if (!Number.isFinite(expiry) || expiry <= now) return false; // expired or malformed
  const expectedSig = await hmacHex(secret, expiryStr);
  return constantTimeEqual(sig, expectedSig); // tamper check
}

/**
 * Sanitize a `next` redirect target to a safe same-origin path. Prevents
 * open-redirect: only relative paths beginning with a single `/` are allowed.
 * `//evil.com` (protocol-relative) and absolute URLs (`https://…`) collapse
 * to `/`.
 */
export function sanitizeNext(next: string | null | undefined): string {
  if (!next || typeof next !== 'string') return '/';
  if (!next.startsWith('/') || next.startsWith('//')) return '/';
  return next;
}

export { COOKIE_NAME, SIXTY_DAYS_MS };
