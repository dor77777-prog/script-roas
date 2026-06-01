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

/**
 * Password-gate allowlist — paths that are ALWAYS reachable without the
 * dashboard-auth cookie. Everything else is gated when the gate is active.
 *
 *   - /login              the gate's own entry page (must be reachable to log in)
 *   - /api/login          POSTs the password, sets the cookie
 *   - /api/logout         clears the cookie
 *   - /_next/*            Next.js build internals (static + image optimizer + data)
 *   - /favicon.ico, /robots.txt, and any path with a file extension
 *     (e.g. /apple-touch-icon.png, /something.js) — static assets.
 *
 * The config.matcher in middleware.ts already excludes most of these so the
 * middleware never even runs for them; this function is the defence-in-depth
 * second check inside the middleware body and the unit-test surface.
 */
export function isDashboardAuthAllowlisted(pathname: string): boolean {
  if (pathname === '/login' || pathname.startsWith('/login/')) return true;
  if (pathname === '/api/login') return true;
  if (pathname === '/api/logout') return true;
  if (pathname.startsWith('/_next/')) return true;
  if (pathname === '/favicon.ico' || pathname === '/robots.txt') return true;
  // Any static file with an extension in its last path segment. We look only
  // at the final segment so a path like /campaigns (no dot) is NOT treated as
  // a file, while /logo.svg or /chunk.123.js is.
  const lastSegment = pathname.slice(pathname.lastIndexOf('/') + 1);
  if (lastSegment.includes('.')) return true;
  // Task 2 — Shopify ingest endpoints. Shopify/browsers can't present the
  // dashboard cookie; these authenticate via HMAC (webhook) / per-store token
  // + origin (cart) at the route level instead.
  if (pathname === '/api/webhooks/shopify') return true;
  if (pathname === '/api/events/cart') return true;
  return false;
}

/**
 * Returns true iff BOTH password-gate env vars are configured, meaning the
 * dashboard-auth gate should be enforced. Mirrors `shouldEnforceSecret` — when
 * either env var is unset the gate degrades to INACTIVE (dev safety), so a
 * developer without a populated .env.local is never locked out.
 */
export function shouldEnforceDashboardAuth(
  dashboardPassword: string | undefined,
  signingSecret: string | undefined,
): boolean {
  return (
    typeof dashboardPassword === 'string' &&
    dashboardPassword.length > 0 &&
    typeof signingSecret === 'string' &&
    signingSecret.length > 0
  );
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
