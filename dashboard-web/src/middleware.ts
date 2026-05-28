// dashboard-web/middleware.ts
//
// Security hardening FIX 3 — operator-secret middleware.
//
// Runs on every request that matches the config.matcher below.
// Two responsibilities:
//
//   1. Always: set X-Robots-Tag: noindex, nofollow on the response.
//      Prevents search engines from indexing /operator or any /api/operator/*
//      endpoint even if the URL is somehow discovered (e.g. via referer leak
//      or crawl of a link in a public page).
//
//   2. For /api/operator/* paths only: gate by OPERATOR_SECRET env var.
//      - If OPERATOR_SECRET is NOT set → pass through (backward compat).
//        The current single-user deployment has no secret configured; this
//        keeps existing behaviour unchanged.
//      - If OPERATOR_SECRET IS set → require the request to carry an
//        'x-operator-secret' header that exactly matches the env value.
//        Mismatch / missing header → 404 (not 401/403; 404 leaks no info).
//        Comparison is constant-time (crypto.timingSafeEqual) to prevent
//        timing attacks.
//
//   The /operator PAGE itself is allowed through unconditionally — it renders
//   the secret-entry form that lets the operator store the secret in
//   localStorage before any API calls are made.
//
// Activation: set OPERATOR_SECRET env var in Vercel (or .env.local for dev).
// Deactivation: remove the env var → gate becomes inactive, all requests pass.

import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { checkOperatorSecret } from '@/lib/middlewareHelpers';

export function middleware(request: NextRequest): NextResponse {
  const { pathname } = request.nextUrl;

  const headerValue = request.headers.get('x-operator-secret');
  const envSecret = process.env.OPERATOR_SECRET;

  const gateResult = checkOperatorSecret(pathname, headerValue, envSecret);

  if (!gateResult.pass) {
    // 404 — never 401/403; exposing an auth requirement reveals that the
    // route exists. A 404 is indistinguishable from "no such route".
    const response = NextResponse.json(
      { error: 'Not found' },
      { status: 404 },
    );
    response.headers.set('X-Robots-Tag', 'noindex, nofollow');
    return response;
  }

  // Pass through — add noindex header to all matched routes (both API paths
  // and the /operator page).
  const response = NextResponse.next();
  response.headers.set('X-Robots-Tag', 'noindex, nofollow');
  return response;
}

export const config = {
  matcher: ['/api/operator/:path*', '/operator/:path*', '/operator'],
};
