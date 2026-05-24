import { describe, expect, it } from 'vitest';
import { GET } from '@/app/api/oauth/tiktok/callback/route';

/**
 * AUDIT regression (Phase 12.3 / 2026-05-24) — API-18:
 * /api/oauth/tiktok/callback missing CSP / nosniff / Referrer-Policy.
 *
 *   Original bug (API-18):
 *     route.ts had a custom `htmlEscape` covering 5 basic chars
 *     (& < > " ') but not backslash sequences or script-tag context.
 *     The endpoint is external-facing by design (TikTok cloud redirects
 *     browsers here during App authorization), so injection of attacker-
 *     controlled `auth_code` / `state` / `error` query params into HTML
 *     attribute or text context could enable an XSS regression if
 *     htmlEscape ever fails or is bypassed by a future refactor.
 *
 *   12.3 fix (defense-in-depth):
 *     Add Content-Security-Policy default-src 'none' + style-src
 *     'unsafe-inline' (inline styles are used by the existing layout)
 *     to ALL 3 response paths (error, no-auth-code, success). Also
 *     X-Content-Type-Options nosniff + Referrer-Policy no-referrer +
 *     X-Frame-Options DENY for the OWASP ASVS 5.0 V14 baseline.
 *
 * Evidence pack:
 *   .planning/phases/12-codebase-audit-baseline/raw-returns/
 *     api_oauth_tiktokCallback.json (API-18 lines 7-15)
 */

function expectSecurityHeaders(res: Response) {
  const csp = res.headers.get('content-security-policy');
  expect(csp).toBeTruthy();
  expect(csp!).toMatch(/default-src 'none'/);
  expect(res.headers.get('x-content-type-options')).toBe('nosniff');
  expect(res.headers.get('referrer-policy')).toBe('no-referrer');
  // X-Frame-Options DENY (anti-clickjacking) — additional belt-and-suspenders.
  expect(res.headers.get('x-frame-options')).toBe('DENY');
}

describe('/api/oauth/tiktok/callback security headers (Phase 12.3 / API-18)', () => {
  it('Test 1: error path (error=access_denied) emits CSP + nosniff + Referrer-Policy + X-Frame-Options', async () => {
    const req = new Request(
      'http://localhost/api/oauth/tiktok/callback?error=access_denied&error_description=User+denied',
    );
    const res = await GET(req);
    expect(res.status).toBe(400);
    expectSecurityHeaders(res);
  });

  it('Test 2: no-auth-code path (no params) emits CSP + nosniff + Referrer-Policy + X-Frame-Options', async () => {
    const req = new Request('http://localhost/api/oauth/tiktok/callback');
    const res = await GET(req);
    expect(res.status).toBe(200);
    expectSecurityHeaders(res);
  });

  it('Test 3: success path (auth_code=ABC123&state=xyz) emits CSP + nosniff + Referrer-Policy + X-Frame-Options', async () => {
    const req = new Request(
      'http://localhost/api/oauth/tiktok/callback?auth_code=ABC123&state=xyz',
    );
    const res = await GET(req);
    expect(res.status).toBe(200);
    expectSecurityHeaders(res);
  });
});
