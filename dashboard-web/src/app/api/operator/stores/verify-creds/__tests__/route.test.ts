// dashboard-web/src/app/api/operator/stores/verify-creds/__tests__/route.test.ts
//
// Self-serve stores Phase 6a — Task 4: verify-creds route tests (TDD).
//
// The route is a thin, DB-LESS probe wrapper: it validates `platform`, calls the
// matching pure verifier from @/lib/credVerifiers, and returns the verifier's
// `{ ok, message, currency? }` (plus the echoed `platform`). It NEVER touches the
// DB and NEVER echoes the submitted creds.
//
// These tests mock @/lib/credVerifiers so they are hermetic (no network). They
// assert:
//   - the matching verifier is called with the EXACT submitted creds
//   - a verifier ok:true → 200 { platform, ok:true, ... }
//   - a verifier ok:false → 200 (the probe RAN; only a malformed request is 400)
//   - an unknown platform → 400 { error }
//   - the submitted secret VALUE never appears in the response body
//   - the route does not import/use getSupabaseAdmin (no DB work)

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Verifiers: drive ok/fail per test via these holders + record the args they
// were called with (so we can assert the EXACT creds were passed through).
const verify = vi.hoisted(() => ({
  shopify: { ok: true, message: 'shopify ok' } as { ok: boolean; message: string; currency?: string },
  meta: { ok: true, message: 'meta ok' } as { ok: boolean; message: string; currency?: string },
  google: { ok: true, message: 'google ok' } as { ok: boolean; message: string; currency?: string },
  shopifyArgs: null as unknown,
  metaArgs: null as unknown,
  googleArgs: null as unknown,
  shopifyCalls: 0,
  metaCalls: 0,
  googleCalls: 0,
}));
vi.mock('@/lib/credVerifiers', () => ({
  verifyShopify: (a: unknown) => { verify.shopifyCalls++; verify.shopifyArgs = a; return Promise.resolve(verify.shopify); },
  verifyMeta: (a: unknown) => { verify.metaCalls++; verify.metaArgs = a; return Promise.resolve(verify.meta); },
  verifyGoogle: (a: unknown) => { verify.googleCalls++; verify.googleArgs = a; return Promise.resolve(verify.google); },
}));

// Sentry capture is a no-op in tests.
vi.mock('@/lib/sentry/capture', () => ({ captureRouteError: () => {} }));

import { POST } from '../route';

beforeEach(() => {
  verify.shopify = { ok: true, message: 'shopify ok' };
  verify.meta = { ok: true, message: 'meta ok', currency: 'ILS' };
  verify.google = { ok: true, message: 'google ok', currency: 'CAD' };
  verify.shopifyArgs = null;
  verify.metaArgs = null;
  verify.googleArgs = null;
  verify.shopifyCalls = 0;
  verify.metaCalls = 0;
  verify.googleCalls = 0;
});

function post(body: unknown) {
  return POST(new Request('http://x/api/operator/stores/verify-creds', {
    method: 'POST',
    body: typeof body === 'string' ? body : JSON.stringify(body),
  }));
}

describe('POST /api/operator/stores/verify-creds', () => {
  it('meta + verifier ok:true → 200 { platform:"meta", ok:true, currency }', async () => {
    const res = await post({ platform: 'meta', creds: { token: 'META-PLAINTEXT', adAccountId: 'act_999' } });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ platform: 'meta', ok: true, message: 'meta ok', currency: 'ILS' });
    // exact creds passed through to the verifier
    expect(verify.metaCalls).toBe(1);
    expect(verify.metaArgs).toEqual({ token: 'META-PLAINTEXT', adAccountId: 'act_999' });
    // other verifiers untouched
    expect(verify.shopifyCalls).toBe(0);
    expect(verify.googleCalls).toBe(0);
  });

  it('shopify + verifier ok:true → 200 { platform:"shopify", ok:true } with exact creds', async () => {
    const res = await post({ platform: 'shopify', creds: { domain: 'a.myshopify.com', clientId: 'cid', clientSecret: 'SHOP-SECRET' } });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ platform: 'shopify', ok: true, message: 'shopify ok' });
    expect(verify.shopifyArgs).toEqual({ domain: 'a.myshopify.com', clientId: 'cid', clientSecret: 'SHOP-SECRET' });
  });

  it('google + verifier ok:true → 200 { platform:"google", ok:true, currency } with exact creds', async () => {
    const res = await post({ platform: 'google', creds: { customerId: '111-222-3333', refreshToken: 'G-REFRESH' } });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ platform: 'google', ok: true, currency: 'CAD' });
    expect(verify.googleArgs).toEqual({ customerId: '111-222-3333', refreshToken: 'G-REFRESH' });
  });

  it('verifier ok:false is still a 200 (the probe RAN) → { ok:false, message }', async () => {
    verify.meta = { ok: false, message: 'אימות Meta נכשל (קוד 401)' };
    const res = await post({ platform: 'meta', creds: { token: 't', adAccountId: 'act_1' } });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.message).toBe('אימות Meta נכשל (קוד 401)');
    expect(body.platform).toBe('meta');
  });

  it('an unknown platform → 400 { error } and NO verifier called', async () => {
    const res = await post({ platform: 'tiktok', creds: { foo: 'bar' } });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBeTruthy();
    expect(verify.shopifyCalls + verify.metaCalls + verify.googleCalls).toBe(0);
  });

  it('a missing platform → 400 { error } and NO verifier called', async () => {
    const res = await post({ creds: { token: 't' } });
    expect(res.status).toBe(400);
    expect(verify.shopifyCalls + verify.metaCalls + verify.googleCalls).toBe(0);
  });

  it('malformed JSON → 400 { error } and NO verifier called', async () => {
    const res = await post('{not json');
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBeTruthy();
    expect(verify.shopifyCalls + verify.metaCalls + verify.googleCalls).toBe(0);
  });

  it('NEVER echoes the submitted secret value in the response body', async () => {
    const res = await post({ platform: 'meta', creds: { token: 'SUPER-SECRET-TOKEN-12345', adAccountId: 'act_1' } });
    const text = await res.text();
    expect(text).not.toContain('SUPER-SECRET-TOKEN-12345');
  });

  it('does NOT do DB work (no getSupabaseAdmin import in the route source)', async () => {
    // Structural guard: the route file must not reach for the service-role admin.
    const fs = await import('fs');
    const path = await import('path');
    const src = fs.readFileSync(path.join(__dirname, '..', 'route.ts'), 'utf8');
    expect(src).not.toContain('getSupabaseAdmin');
    expect(src).not.toContain('supabaseAdmin');
  });

  it('a verifier that throws → 500 { error } with no submitted secret echoed', async () => {
    // Force the verifier to throw for this test.
    const mod = await import('@/lib/credVerifiers');
    const spy = vi.spyOn(mod, 'verifyMeta').mockRejectedValueOnce(new Error('boom SUPER-SECRET-TOKEN-XYZ'));
    const res = await post({ platform: 'meta', creds: { token: 'SUPER-SECRET-TOKEN-XYZ', adAccountId: 'act_1' } });
    expect(res.status).toBe(500);
    const text = await res.text();
    expect(text).not.toContain('SUPER-SECRET-TOKEN-XYZ');
    spy.mockRestore();
  });
});
