// dashboard-web/src/lib/middlewareHelpers.ts
//
// Pure helper functions extracted from the Next.js middleware so they can be
// unit-tested in a standard Node/Vitest environment without needing the full
// Next.js edge runtime (which NextRequest/NextResponse require).
//
// Security hardening FIX 3 — operator-secret middleware gate.
//
// Exports:
//   isOperatorApiPath(path)          — true iff path is under /api/operator/
//   shouldEnforceSecret(envSecret)   — true iff the env var is set+truthy
//   constantTimeEqual(a, b)          — timing-safe string comparison
//   checkOperatorSecret(path, header, envSecret) → { pass } | { pass, status }

import crypto from 'crypto';

/**
 * Returns true if the pathname is an /api/operator/* API path.
 * The /operator page itself is NOT an API path and returns false.
 */
export function isOperatorApiPath(pathname: string): boolean {
  return pathname.startsWith('/api/operator/') || pathname === '/api/operator';
}

/**
 * Returns true if the OPERATOR_SECRET env var is set to a non-empty string,
 * meaning the secret gate should be enforced.
 */
export function shouldEnforceSecret(envSecret: string | undefined): boolean {
  return typeof envSecret === 'string' && envSecret.length > 0;
}

/**
 * Constant-time string comparison using crypto.timingSafeEqual.
 *
 * - If lengths differ, returns false immediately WITHOUT calling
 *   timingSafeEqual (a length difference is already public info and the
 *   early exit avoids the buffer allocation overhead on invalid tokens).
 * - If lengths are equal, delegates to timingSafeEqual to prevent
 *   timing-based secret extraction.
 */
export function constantTimeEqual(a: string, b: string): boolean {
  // Length-equality guard — strings of different lengths cannot match.
  // Checking length first is safe because the length of a valid secret
  // is not itself secret (it doesn't help an attacker narrow down the
  // content). This guard prevents the buffer allocation below when the
  // attacker sends a garbage-length header.
  if (a.length !== b.length) return false;

  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  return crypto.timingSafeEqual(bufA, bufB);
}

type GateResult = { pass: true } | { pass: false; status: 404 };

/**
 * Core gate logic for the operator-secret middleware.
 *
 * @param pathname    - The request pathname (e.g. '/api/operator/jobs')
 * @param headerValue - The value of the 'x-operator-secret' request header, or null
 * @param envSecret   - The value of process.env.OPERATOR_SECRET (may be undefined)
 * @returns { pass: true } to allow the request through, or { pass: false, status: 404 }
 *          to reject with a 404 (never 401/403 — 404 leaks no information).
 */
export function checkOperatorSecret(
  pathname: string,
  headerValue: string | null,
  envSecret: string | undefined,
): GateResult {
  // Only enforce on /api/operator/* paths.
  // /operator page and other paths are always allowed through.
  if (!isOperatorApiPath(pathname)) {
    return { pass: true };
  }

  // If env var is not set, gate is inactive (backward compat).
  if (!shouldEnforceSecret(envSecret)) {
    return { pass: true };
  }

  // Env is set — require an exact match from the header.
  if (headerValue === null) {
    return { pass: false, status: 404 };
  }

  if (!constantTimeEqual(headerValue, envSecret as string)) {
    return { pass: false, status: 404 };
  }

  return { pass: true };
}
