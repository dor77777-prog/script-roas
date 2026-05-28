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

// NOTE on runtime: this module is imported by `src/middleware.ts`, which Next.js
// executes in the Edge Runtime. Node's `crypto` module and `Buffer` are NOT
// available in Edge. We therefore implement the constant-time compare in
// pure JavaScript (charCodeAt + XOR-OR), which works identically in Edge and
// Node and remains timing-safe for ASCII secrets of equal length. For
// non-ASCII secrets (Unicode code points > 0xFFFF), charCodeAt yields the
// UTF-16 code unit — which still compares byte-equal strings byte-equal,
// just like the original Buffer comparison did.

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
 * Constant-time string comparison — Edge-runtime safe.
 *
 * - If lengths differ, returns false immediately. The length itself is not
 *   a secret (it cannot help an attacker narrow down the content), and the
 *   early return avoids work on garbage-length input.
 * - If lengths match, XORs each character-code pair and accumulates the
 *   result. No branches inside the loop → constant time per character.
 *   Result is 0 iff every pair matched.
 */
export function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
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
