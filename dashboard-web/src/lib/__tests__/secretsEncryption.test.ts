import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  encryptSecret,
  decryptSecret,
  maskSecret,
  CLIENT_SAFE_SECRET_KEYS,
} from '@/lib/secretsEncryption';

const KEY = Buffer.alloc(32, 7).toString('base64'); // 32-byte key, base64
beforeEach(() => vi.stubEnv('ENCRYPTION_MASTER_KEY', KEY));

describe('secretsEncryption — AES-256-GCM round-trip', () => {
  it('encrypts then decrypts back to the plaintext', () => {
    const enc = encryptSecret('shpat_secret_123');
    expect(enc.ciphertext).not.toContain('shpat_secret_123');
    expect(decryptSecret(enc.ciphertext, enc.iv, enc.tag)).toBe('shpat_secret_123');
  });
  it('different iv each call (no deterministic ciphertext)', () => {
    expect(encryptSecret('x').iv).not.toBe(encryptSecret('x').iv);
  });
  it('decrypt throws on a tampered tag', () => {
    const enc = encryptSecret('x');
    const badTag = Buffer.alloc(16, 1).toString('base64');
    expect(() => decryptSecret(enc.ciphertext, enc.iv, badTag)).toThrow();
  });
  it('throws when the master key is missing', () => {
    vi.stubEnv('ENCRYPTION_MASTER_KEY', '');
    expect(() => encryptSecret('x')).toThrow(/ENCRYPTION_MASTER_KEY/);
  });
  it('throws when the master key is the wrong length', () => {
    vi.stubEnv('ENCRYPTION_MASTER_KEY', Buffer.alloc(16, 1).toString('base64'));
    expect(() => encryptSecret('x')).toThrow(/32 bytes/);
  });
});

describe('maskSecret — forward guard for Phase 6 admin routes', () => {
  it('shows only the last 4 chars for values longer than 4', () => {
    expect(maskSecret('shpat_abcd1234')).toBe('••••1234');
    expect(maskSecret('12345')).toBe('••••2345');
  });

  it('masks the entire value when length is ≤ 4 (too short to reveal a suffix)', () => {
    expect(maskSecret('abcd')).toBe('••••');
    expect(maskSecret('abc')).toBe('••••');
    expect(maskSecret('a')).toBe('••••');
    expect(maskSecret('')).toBe('••••');
  });

  it('NEVER returns the full secret value', () => {
    const secret = 'super-secret-access-token-9999';
    const masked = maskSecret(secret);
    expect(masked).not.toBe(secret);
    expect(masked).not.toContain('super-secret');
    expect(masked).not.toContain('access-token');
    // Only the documented 4-char suffix may survive.
    expect(masked).toBe('••••9999');
  });

  it('does not leak more than the last 4 characters for a long token', () => {
    const secret = 'EAAG' + 'X'.repeat(80) + 'TAIL';
    const masked = maskSecret(secret);
    expect(masked).toBe('••••TAIL');
    // The masked output, minus the dot run, must be at most 4 chars long.
    expect(masked.replace(/•/g, '').length).toBeLessThanOrEqual(4);
  });
});

describe('CLIENT_SAFE_SECRET_KEYS — allowlist of client-returnable store-secret keys', () => {
  it('contains exactly the semi-public TikTok advertiser id today', () => {
    expect(CLIENT_SAFE_SECRET_KEYS).toEqual(['TIKTOK_ADVERTISER_ID']);
  });

  it('does NOT include any credential-shaped key', () => {
    for (const key of CLIENT_SAFE_SECRET_KEYS) {
      expect(key).not.toMatch(/ACCESS_TOKEN|REFRESH_TOKEN|CLIENT_SECRET|PASSWORD|SERVICE_ROLE|SIGNING_KEY|MASTER_KEY/);
    }
  });
});
