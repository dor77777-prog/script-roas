// dashboard-web/src/app/api/logout/route.ts
//
// POST /api/logout — clears the `dash_auth` trusted-device cookie.
//
// Sets Max-Age=0 on the same cookie name/path so the browser drops it. The
// next protected request will be re-gated to /login. No body, no auth needed
// (it can only DELETE the cookie). A small "logout" UI affordance can call
// this later; for now the route is the contract.

export const runtime = 'nodejs';

import { NextResponse } from 'next/server';
import { COOKIE_NAME } from '@/lib/auth/dashboardAuth';

export async function POST(): Promise<NextResponse> {
  const response = NextResponse.json({ ok: true });
  response.cookies.set({
    name: COOKIE_NAME,
    value: '',
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 0, // expire immediately
  });
  return response;
}
