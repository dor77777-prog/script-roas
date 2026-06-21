// dashboard-web/middleware.ts
//
// TWO layered gates, both running here, plus a noindex header.
//
//   1. Dashboard password gate (Phase: password-gate).
//      Gates ALL routes except a small allowlist. A device that entered the
//      correct password carries a signed `dash_auth` cookie (60-day trusted
//      device); without a valid cookie:
//        - an HTML page request → 302 redirect to /login?next=<original-path>
//        - an /api/* request    → 401 JSON { error: 'unauthorized' }
//      The gate is ACTIVE only when BOTH DASHBOARD_PASSWORD and
//      AUTH_SIGNING_SECRET env vars are set; if either is unset the gate
//      degrades to INACTIVE (pass-through) so a dev without a populated
//      .env.local is not locked out — same degradation pattern as the
//      operator-secret gate below.
//
//   2. Operator-secret gate (Security hardening FIX 3) — UNCHANGED behaviour.
//      For /api/operator/* paths only: require an 'x-operator-secret' header
//      matching OPERATOR_SECRET (when that env var is set). Mismatch → 404
//      (never 401/403; 404 leaks no info). This runs AFTER the dashboard gate
//      so an operator API call needs BOTH the dashboard cookie AND the secret
//      header. The /operator PAGE is allowed through the operator gate (it
//      renders the secret-entry form) but STILL requires the dashboard cookie.
//
//   3. Always: X-Robots-Tag: noindex, nofollow on the response.
//
// Activation: set DASHBOARD_PASSWORD + AUTH_SIGNING_SECRET (and optionally
// OPERATOR_SECRET) in Vercel (or .env.local for dev).

import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import {
  checkOperatorSecret,
  isDashboardAuthAllowlisted,
  shouldEnforceDashboardAuth,
} from '@/lib/middlewareHelpers';
import { verifyAuthToken, COOKIE_NAME } from '@/lib/auth/dashboardAuth';

const NOINDEX = 'noindex, nofollow';

// Phase 5c — fail-CLOSED boot guard. On Vercel
// production, a MISSING auth env var must fail the deploy LOUDLY at module load
// rather than silently degrade either gate to pass-through. All three vars ARE
// set in prod today, so this is a no-op safety net; it only throws if a future
// deploy drops one. VERCEL_ENV (NOT NODE_ENV) — NODE_ENV is 'production' in
// Vercel preview too, where the gate is intentionally allowed to be off.
if (process.env.VERCEL_ENV === 'production') {
  if (!process.env.DASHBOARD_PASSWORD || !process.env.AUTH_SIGNING_SECRET) {
    throw new Error('DASHBOARD_PASSWORD + AUTH_SIGNING_SECRET are required in production (VERCEL_ENV=production).');
  }
  if (!process.env.OPERATOR_SECRET) {
    throw new Error('OPERATOR_SECRET is required in production (VERCEL_ENV=production).');
  }
}

function withNoindex(response: NextResponse): NextResponse {
  response.headers.set('X-Robots-Tag', NOINDEX);
  return response;
}

export async function middleware(request: NextRequest): Promise<NextResponse> {
  const { pathname } = request.nextUrl;

  // ---- Gate 1: dashboard password gate ------------------------------------
  // Allowlisted paths skip the dashboard-auth check entirely (but still flow
  // through the operator + noindex logic below).
  if (!isDashboardAuthAllowlisted(pathname)) {
    const dashboardPassword = process.env.DASHBOARD_PASSWORD;
    const signingSecret = process.env.AUTH_SIGNING_SECRET;

    if (shouldEnforceDashboardAuth(dashboardPassword, signingSecret)) {
      const token = request.cookies.get(COOKIE_NAME)?.value;
      const valid = await verifyAuthToken(
        signingSecret as string,
        token,
        Date.now(),
      );

      if (!valid) {
        // API requests get a JSON 401; page requests get a redirect to /login.
        if (pathname.startsWith('/api/')) {
          return withNoindex(
            NextResponse.json({ error: 'unauthorized' }, { status: 401 }),
          );
        }
        const loginUrl = request.nextUrl.clone();
        loginUrl.pathname = '/login';
        loginUrl.search = '';
        // Preserve the originally-requested path (incl. query) so /login can
        // bounce the user back after a successful login.
        loginUrl.searchParams.set('next', pathname + request.nextUrl.search);
        return withNoindex(NextResponse.redirect(loginUrl));
      }
    }
    // Gate inactive (env unset) OR valid cookie → fall through to operator
    // gate + noindex.
  }

  // ---- Gate 2: operator-secret gate (unchanged) ---------------------------
  const headerValue = request.headers.get('x-operator-secret');
  const envSecret = process.env.OPERATOR_SECRET;
  const gateResult = checkOperatorSecret(pathname, headerValue, envSecret);

  if (!gateResult.pass) {
    // 404 — never 401/403; exposing an auth requirement reveals that the
    // route exists. A 404 is indistinguishable from "no such route".
    return withNoindex(NextResponse.json({ error: 'Not found' }, { status: 404 }));
  }

  // ---- Pass through with noindex ------------------------------------------
  return withNoindex(NextResponse.next());
}

export const config = {
  // Match the WHOLE app, excluding Next internals + static assets + the
  // password-gate allowlist (/login, /api/login, /api/logout). Excluded paths
  // never hit the middleware, so /login is always reachable unauthenticated.
  // Everything else flows through both gates above.
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|robots.txt|login|api/login|api/logout).*)',
  ],
};
