import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

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

import {
  shouldEnforceSecret,
  isOperatorApiPath,
  constantTimeEqual,
  checkOperatorSecret,
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
  it('returns false when OPERATOR_SECRET env is not set', () => {
    expect(shouldEnforceSecret(undefined)).toBe(false);
    expect(shouldEnforceSecret('')).toBe(false);
  });

  it('returns true when OPERATOR_SECRET env is truthy', () => {
    expect(shouldEnforceSecret('my-secret')).toBe(true);
    expect(shouldEnforceSecret('x')).toBe(true);
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

describe('constantTimeEqual — length-guard prevents timing leak', () => {
  it('returns false immediately (no compare) when lengths differ', () => {
    // We spy on Buffer.from to verify it is NOT called for different-length inputs.
    // This confirms the length guard short-circuits before crypto.timingSafeEqual.
    const bufferFromSpy = vi.spyOn(Buffer, 'from');

    // Different lengths — should short-circuit
    const result = constantTimeEqual('short', 'muchlonger');

    // Buffer.from should NOT have been called (length guard fired first)
    expect(bufferFromSpy).not.toHaveBeenCalled();
    expect(result).toBe(false);

    bufferFromSpy.mockRestore();
  });

  it('DOES call Buffer.from (for crypto.timingSafeEqual) when lengths are equal', () => {
    const bufferFromSpy = vi.spyOn(Buffer, 'from');

    constantTimeEqual('sameLength1', 'sameLength2');

    // Buffer.from should have been called since lengths match
    expect(bufferFromSpy).toHaveBeenCalled();

    bufferFromSpy.mockRestore();
  });
});
