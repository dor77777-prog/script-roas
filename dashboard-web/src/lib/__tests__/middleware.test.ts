import { describe, it, expect, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Middleware unit tests — operator-secret gate (Security hardening FIX 3)
//
// Tests are written against the pure logic extracted into a testable helper
// rather than attempting to instantiate NextRequest/NextResponse directly,
// which would require @next/server to be importable in a Node test environment
// without the full Next.js edge runtime.
//
// The middleware itself is tested at the logic level:
//   - applyOperatorGate(path, secret, envSecret) → { pass, status, noindex }
//
// This mirrors the project's existing pattern of testing pure-logic helpers
// (operatorReset.ts, operatorJobsConcurrentFanout.ts) rather than mounting
// the full Next.js route machinery.
// ---------------------------------------------------------------------------

import { afterEach } from 'vitest';
import {
  shouldEnforceSecret,
  isOperatorApiPath,
  constantTimeEqual,
  checkOperatorSecret,
  isDashboardAuthAllowlisted,
  shouldEnforceDashboardAuth,
} from '../middlewareHelpers';

describe('isOperatorApiPath', () => {
  it('matches /api/operator/* paths', () => {
    expect(isOperatorApiPath('/api/operator/sync-now')).toBe(true);
    expect(isOperatorApiPath('/api/operator/backfill')).toBe(true);
    expect(isOperatorApiPath('/api/operator/jobs')).toBe(true);
    expect(isOperatorApiPath('/api/operator/manual-overrides')).toBe(true);
    expect(isOperatorApiPath('/api/operator/reset')).toBe(true);
    expect(isOperatorApiPath('/api/operator/notifications/send')).toBe(true);
    expect(isOperatorApiPath('/api/operator/token-failures')).toBe(true);
  });

  it('does NOT match /operator page path', () => {
    expect(isOperatorApiPath('/operator')).toBe(false);
    expect(isOperatorApiPath('/operator/')).toBe(false);
  });

  it('does NOT match unrelated paths', () => {
    expect(isOperatorApiPath('/api/data')).toBe(false);
    expect(isOperatorApiPath('/')).toBe(false);
    expect(isOperatorApiPath('/dashboard')).toBe(false);
  });
});

describe('constantTimeEqual', () => {
  it('returns true for identical strings', () => {
    expect(constantTimeEqual('abc123', 'abc123')).toBe(true);
    expect(constantTimeEqual('', '')).toBe(true);
  });

  it('returns false for different strings of equal length', () => {
    // This is the critical constant-time case: same length, different content
    expect(constantTimeEqual('abcdef', 'abcxyz')).toBe(false);
  });

  it('returns false for strings of different lengths without calling compare', () => {
    // Different lengths → reject immediately (length-equality guard)
    const result = constantTimeEqual('short', 'muchlonger');
    expect(result).toBe(false);
  });

  it('returns false for empty vs non-empty', () => {
    expect(constantTimeEqual('', 'nonempty')).toBe(false);
    expect(constantTimeEqual('nonempty', '')).toBe(false);
  });

  it('is case-sensitive', () => {
    expect(constantTimeEqual('Secret123', 'secret123')).toBe(false);
  });
});

describe('shouldEnforceSecret', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('returns false when OPERATOR_SECRET env is not set', () => {
    expect(shouldEnforceSecret(undefined)).toBe(false);
    expect(shouldEnforceSecret('')).toBe(false);
  });

  it('returns true when OPERATOR_SECRET env is truthy', () => {
    expect(shouldEnforceSecret('my-secret')).toBe(true);
    expect(shouldEnforceSecret('x')).toBe(true);
  });

  // Phase 5c — fail-CLOSED in production. On VERCEL_ENV=production the gate is
  // force-enforced even if the env var is unset (a missing secret must lock the
  // route, never silently degrade to pass-through).
  it('returns TRUE in production even when the secret is unset (fail-closed)', () => {
    vi.stubEnv('VERCEL_ENV', 'production');
    expect(shouldEnforceSecret(undefined)).toBe(true);
    expect(shouldEnforceSecret('')).toBe(true);
  });

  it('stays config-driven when VERCEL_ENV is preview (true only if set)', () => {
    vi.stubEnv('VERCEL_ENV', 'preview');
    expect(shouldEnforceSecret(undefined)).toBe(false);
    expect(shouldEnforceSecret('')).toBe(false);
    expect(shouldEnforceSecret('my-secret')).toBe(true);
  });

  it('stays config-driven when VERCEL_ENV is unset (true only if set)', () => {
    vi.stubEnv('VERCEL_ENV', '');
    expect(shouldEnforceSecret(undefined)).toBe(false);
    expect(shouldEnforceSecret('my-secret')).toBe(true);
  });
});

describe('shouldEnforceDashboardAuth', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('returns false when either env var is unset (dev pass-through)', () => {
    expect(shouldEnforceDashboardAuth(undefined, undefined)).toBe(false);
    expect(shouldEnforceDashboardAuth('pw', undefined)).toBe(false);
    expect(shouldEnforceDashboardAuth(undefined, 'sig')).toBe(false);
    expect(shouldEnforceDashboardAuth('', '')).toBe(false);
  });

  it('returns true when BOTH env vars are set', () => {
    expect(shouldEnforceDashboardAuth('pw', 'sig')).toBe(true);
  });

  // Phase 5c — fail-CLOSED in production.
  it('returns TRUE in production even when both are unset (fail-closed)', () => {
    vi.stubEnv('VERCEL_ENV', 'production');
    expect(shouldEnforceDashboardAuth(undefined, undefined)).toBe(true);
    expect(shouldEnforceDashboardAuth('', '')).toBe(true);
  });

  it('stays config-driven when VERCEL_ENV is preview (true only if both set)', () => {
    vi.stubEnv('VERCEL_ENV', 'preview');
    expect(shouldEnforceDashboardAuth(undefined, undefined)).toBe(false);
    expect(shouldEnforceDashboardAuth('pw', 'sig')).toBe(true);
  });

  it('stays config-driven when VERCEL_ENV is unset (true only if both set)', () => {
    vi.stubEnv('VERCEL_ENV', '');
    expect(shouldEnforceDashboardAuth(undefined, undefined)).toBe(false);
    expect(shouldEnforceDashboardAuth('pw', 'sig')).toBe(true);
  });
});

describe('checkOperatorSecret', () => {
  const ENV_SECRET = 'super-secret-token-123';

  it('passes through when env is not set (backward compat)', () => {
    const result = checkOperatorSecret(
      '/api/operator/sync-now',
      null,         // no header
      undefined,    // OPERATOR_SECRET not set
    );
    expect(result).toEqual({ pass: true });
  });

  it('passes through when env is empty string (backward compat)', () => {
    const result = checkOperatorSecret(
      '/api/operator/jobs',
      null,
      '',
    );
    expect(result).toEqual({ pass: true });
  });

  it('rejects when env is set and header is missing', () => {
    const result = checkOperatorSecret(
      '/api/operator/backfill',
      null,
      ENV_SECRET,
    );
    expect(result).toEqual({ pass: false, status: 404 });
  });

  it('rejects when env is set and header is wrong', () => {
    const result = checkOperatorSecret(
      '/api/operator/reset',
      'wrong-secret',
      ENV_SECRET,
    );
    expect(result).toEqual({ pass: false, status: 404 });
  });

  it('passes when env is set and header matches exactly', () => {
    const result = checkOperatorSecret(
      '/api/operator/sync-now',
      ENV_SECRET,
      ENV_SECRET,
    );
    expect(result).toEqual({ pass: true });
  });

  it('rejects a prefix match (not a substring test — exact match only)', () => {
    const result = checkOperatorSecret(
      '/api/operator/jobs',
      ENV_SECRET.slice(0, -1), // one char short
      ENV_SECRET,
    );
    expect(result).toEqual({ pass: false, status: 404 });
  });

  it('does NOT enforce secret on /operator page path (UI page, not API)', () => {
    // The /operator page itself is allowed through — only /api/operator/* is gated
    const result = checkOperatorSecret(
      '/operator',
      null,       // no header
      ENV_SECRET, // env is set
    );
    // /operator is NOT an api path, so gate is not applied
    expect(result).toEqual({ pass: true });
  });

  it('does NOT enforce secret on /operator/* sub-page paths', () => {
    const result = checkOperatorSecret(
      '/operator/some-sub-page',
      null,
      ENV_SECRET,
    );
    expect(result).toEqual({ pass: true });
  });
});

describe('isDashboardAuthAllowlisted — Shopify ingest endpoints (Task 2)', () => {
  it('allowlists the Shopify webhook ingest path', () => {
    expect(isDashboardAuthAllowlisted('/api/webhooks/shopify')).toBe(true);
  });

  it('allowlists the cart-beacon ingest path', () => {
    expect(isDashboardAuthAllowlisted('/api/events/cart')).toBe(true);
  });

  it('allowlists the Inngest serve endpoint (signature-validated; sync+invoke)', () => {
    // Inngest Cloud cannot present the dashboard cookie; it authenticates via
    // X-Inngest-Signature at the route level. Gating it 401'd the deploy-time
    // sync PUT and pinned Inngest to a pre-gate deployment (2026-06-03 incident).
    expect(isDashboardAuthAllowlisted('/api/inngest')).toBe(true);
  });

  it('allowlists the TikTok OAuth callback landing page (P1-28)', () => {
    // TikTok App reviewers + fresh-browser re-auth redirects cannot carry the
    // dash_auth cookie; the page renders no secrets (single-use auth_code only).
    expect(isDashboardAuthAllowlisted('/api/oauth/tiktok/callback')).toBe(true);
  });

  it('does NOT allowlist a random API path', () => {
    expect(isDashboardAuthAllowlisted('/api/x')).toBe(false);
    expect(isDashboardAuthAllowlisted('/api/data')).toBe(false);
    expect(isDashboardAuthAllowlisted('/api/webhooks/shopify/extra')).toBe(false);
    expect(isDashboardAuthAllowlisted('/api/inngest/extra')).toBe(false);
    // The TikTok allowlist entry is EXACT — siblings/children stay gated.
    expect(isDashboardAuthAllowlisted('/api/oauth/tiktok/callback/extra')).toBe(false);
    expect(isDashboardAuthAllowlisted('/api/oauth/tiktok')).toBe(false);
    expect(isDashboardAuthAllowlisted('/api/oauth/google/callback')).toBe(false);
  });

  it('still allowlists the existing entries (regression)', () => {
    expect(isDashboardAuthAllowlisted('/login')).toBe(true);
    expect(isDashboardAuthAllowlisted('/api/login')).toBe(true);
    expect(isDashboardAuthAllowlisted('/api/logout')).toBe(true);
    expect(isDashboardAuthAllowlisted('/_next/static/chunk.js')).toBe(true);
    expect(isDashboardAuthAllowlisted('/favicon.ico')).toBe(true);
  });
});

describe('constantTimeEqual — Edge-runtime-safe pure-JS implementation', () => {
  it('returns false immediately (no per-char compare) when lengths differ', () => {
    // Length-guard short-circuit: a different-length input never enters the
    // per-character loop. We verify by spying on String.prototype.charCodeAt
    // — the impl's only branch-inside-loop touchpoint — and asserting it is
    // not called at all when lengths mismatch.
    const charCodeSpy = vi.spyOn(String.prototype, 'charCodeAt');
    const result = constantTimeEqual('short', 'muchlonger');
    expect(charCodeSpy).not.toHaveBeenCalled();
    expect(result).toBe(false);
    charCodeSpy.mockRestore();
  });

  it('enters the per-char compare loop when lengths are equal', () => {
    const charCodeSpy = vi.spyOn(String.prototype, 'charCodeAt');
    constantTimeEqual('sameLength1', 'sameLength2'); // length 11 each
    // 11 chars per string × 2 strings = 22 charCodeAt calls expected.
    expect(charCodeSpy).toHaveBeenCalled();
    expect(charCodeSpy.mock.calls.length).toBeGreaterThanOrEqual(22);
    charCodeSpy.mockRestore();
  });

  it('does NOT depend on Node-only globals (Buffer / crypto) — Edge-runtime safe', async () => {
    // Smoke check: importing middlewareHelpers must not pull in Node's
    // crypto module. If it did, importing under an Edge-simulating
    // environment would fail. Vitest runs in Node so we can't fully
    // simulate Edge, but we can at least assert the source file has no
    // crypto/buffer reference left.
    const fs = await import('fs');
    const src = fs.readFileSync(
      new URL('../middlewareHelpers.ts', import.meta.url),
      'utf8',
    );
    expect(src).not.toMatch(/from\s+['"]crypto['"]/);
    expect(src).not.toMatch(/Buffer\.from/);
    expect(src).not.toMatch(/timingSafeEqual/);
  });
});
