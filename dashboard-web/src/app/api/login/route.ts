// dashboard-web/src/app/api/login/route.ts
//
// POST /api/login — password-gate login endpoint.
//
// Reads { password, next } from the JSON body, constant-time compares the
// password to process.env.DASHBOARD_PASSWORD. On match: mint a 60-day
// HMAC-signed trusted-device token and set it as the `dash_auth` cookie
// (HttpOnly, Secure in prod, SameSite=Lax, Path=/, Max-Age=60 days). On
// mismatch: 401 with no cookie.
//
// The password is NEVER stored or echoed — it is only compared against the
// server-side env var. The cookie carries an HMAC of an expiry timestamp, not
// the password (see lib/auth/dashboardAuth.ts).
//
// Node runtime: this route may use either Web Crypto or node:crypto, but the
// shared token helper uses Web Crypto so the SAME code runs in the Edge
// middleware. We pin nodejs so cookie-setting + env access behave predictably.

export const runtime = 'nodejs';

import { NextResponse } from 'next/server';
import { constantTimeEqual } from '@/lib/middlewareHelpers';
import {
  makeAuthToken,
  sanitizeNext,
  COOKIE_NAME,
  SIXTY_DAYS_MS,
} from '@/lib/auth/dashboardAuth';

interface LoginBody {
  password?: unknown;
  next?: unknown;
}

export async function POST(request: Request): Promise<NextResponse> {
  const dashboardPassword = process.env.DASHBOARD_PASSWORD;
  const signingSecret = process.env.AUTH_SIGNING_SECRET;

  // If the gate is not configured server-side there is nothing to log in to.
  // Returning 401 (rather than minting a cookie) keeps the "no auth" state
  // consistent with the middleware treating the gate as inactive — a missing
  // env must never grant access via a cookie.
  if (!dashboardPassword || !signingSecret) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  let body: LoginBody;
  try {
    body = (await request.json()) as LoginBody;
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 });
  }

  const password = typeof body.password === 'string' ? body.password : '';
  const nextParam = typeof body.next === 'string' ? body.next : '/';
  const safeNext = sanitizeNext(nextParam);

  // Constant-time compare — never short-circuit on the first mismatching char.
  if (!constantTimeEqual(password, dashboardPassword)) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  const token = await makeAuthToken(signingSecret, Date.now());

  const response = NextResponse.json({ ok: true, next: safeNext });
  response.cookies.set({
    name: COOKIE_NAME,
    value: token,
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: SIXTY_DAYS_MS / 1000, // Max-Age is in SECONDS
  });
  return response;
}
