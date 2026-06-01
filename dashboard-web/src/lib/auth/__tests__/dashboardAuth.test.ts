import { describe, it, expect, beforeAll } from 'vitest';

// ---------------------------------------------------------------------------
// Password-gate trusted-device cookie — pure-module tests.
//
// These exercise the HMAC sign/verify + next-sanitisation logic without any
// Next.js runtime. They use `await` + the global `crypto.subtle` (Web Crypto),
// which is present in Node 18+ / the vitest environment. If a future runtime
// lacks it, the beforeAll() below polyfills `globalThis.crypto` from
// node:crypto's webcrypto — but modern Node has it global, so this is a no-op
// safety net.
// ---------------------------------------------------------------------------

import {
  makeAuthToken,
  verifyAuthToken,
  sanitizeNext,
  SIXTY_DAYS_MS,
} from '../dashboardAuth';

beforeAll(async () => {
  if (typeof globalThis.crypto?.subtle === 'undefined') {
    const { webcrypto } = await import('node:crypto');
    // @ts-expect-error — assigning the Node webcrypto onto the global for parity.
    globalThis.crypto = webcrypto;
  }
});

const SECRET = 'a'.repeat(64); // stand-in for a 64-hex AUTH_SIGNING_SECRET
const NOW = 1_900_000_000_000; // fixed clock for determinism

describe('makeAuthToken + verifyAuthToken (round-trip)', () => {
  it('verifies a freshly-minted token with the same secret + clock', async () => {
    const token = await makeAuthToken(SECRET, NOW);
    expect(await verifyAuthToken(SECRET, token, NOW)).toBe(true);
  });

  it('embeds an expiry 60 days in the future', async () => {
    const token = await makeAuthToken(SECRET, NOW);
    const expiry = Number(token.slice(0, token.indexOf('.')));
    expect(expiry).toBe(NOW + SIXTY_DAYS_MS);
  });

  it('still valid just before expiry, invalid at/after expiry', async () => {
    const token = await makeAuthToken(SECRET, NOW);
    const expiry = NOW + SIXTY_DAYS_MS;
    // one ms before expiry → still valid
    expect(await verifyAuthToken(SECRET, token, expiry - 1)).toBe(true);
    // exactly at expiry → rejected (expiry <= now)
    expect(await verifyAuthToken(SECRET, token, expiry)).toBe(false);
    // after expiry → rejected
    expect(await verifyAuthToken(SECRET, token, expiry + 1000)).toBe(false);
  });
});

describe('verifyAuthToken — tamper resistance', () => {
  it('rejects a tampered SIGNATURE', async () => {
    const token = await makeAuthToken(SECRET, NOW);
    const dot = token.indexOf('.');
    const expiryStr = token.slice(0, dot);
    const sig = token.slice(dot + 1);
    // flip the first hex char of the signature (same length → constant-time path)
    const flipped = (sig[0] === '0' ? '1' : '0') + sig.slice(1);
    const tampered = `${expiryStr}.${flipped}`;
    expect(await verifyAuthToken(SECRET, tampered, NOW)).toBe(false);
  });

  it('rejects an EXTENDED expiry whose signature was NOT recomputed', async () => {
    // Attacker keeps the valid signature but pushes the expiry far into the
    // future. The signature no longer matches the new expiry → reject.
    const token = await makeAuthToken(SECRET, NOW);
    const dot = token.indexOf('.');
    const sig = token.slice(dot + 1);
    const farFuture = NOW + SIXTY_DAYS_MS * 100;
    const forged = `${farFuture}.${sig}`;
    expect(await verifyAuthToken(SECRET, forged, NOW)).toBe(false);
  });

  it('rejects a token signed with a DIFFERENT secret', async () => {
    const token = await makeAuthToken(SECRET, NOW);
    expect(await verifyAuthToken('b'.repeat(64), token, NOW)).toBe(false);
  });
});

describe('verifyAuthToken — malformed / empty input', () => {
  it('rejects empty string', async () => {
    expect(await verifyAuthToken(SECRET, '', NOW)).toBe(false);
  });

  it('rejects undefined / null', async () => {
    expect(await verifyAuthToken(SECRET, undefined, NOW)).toBe(false);
    expect(await verifyAuthToken(SECRET, null, NOW)).toBe(false);
  });

  it('rejects a token with no dot', async () => {
    expect(await verifyAuthToken(SECRET, 'noseparatorhere', NOW)).toBe(false);
  });

  it('rejects a token with an empty expiry segment (leading dot)', async () => {
    expect(await verifyAuthToken(SECRET, '.deadbeef', NOW)).toBe(false);
  });

  it('rejects a non-numeric expiry', async () => {
    expect(await verifyAuthToken(SECRET, 'abc.deadbeef', NOW)).toBe(false);
  });
});

describe('sanitizeNext', () => {
  it('passes through a same-origin relative path', () => {
    expect(sanitizeNext('/campaigns')).toBe('/campaigns');
    expect(sanitizeNext('/operator/health')).toBe('/operator/health');
    expect(sanitizeNext('/')).toBe('/');
  });

  it('collapses a protocol-relative URL to /', () => {
    expect(sanitizeNext('//evil.com')).toBe('/');
    expect(sanitizeNext('//evil.com/path')).toBe('/');
  });

  it('collapses a backslash-bypass prefix to / (URL parser normalizes \\ → /)', () => {
    expect(sanitizeNext('/\\evil.com')).toBe('/');
    expect(sanitizeNext('/\\/evil.com')).toBe('/');
  });

  it('collapses an absolute URL to /', () => {
    expect(sanitizeNext('https://evil')).toBe('/');
    expect(sanitizeNext('http://evil.com/x')).toBe('/');
  });

  it('collapses a non-slash-leading path to /', () => {
    expect(sanitizeNext('campaigns')).toBe('/');
  });

  it('returns / for null / undefined / empty', () => {
    expect(sanitizeNext(null)).toBe('/');
    expect(sanitizeNext(undefined)).toBe('/');
    expect(sanitizeNext('')).toBe('/');
  });
});
