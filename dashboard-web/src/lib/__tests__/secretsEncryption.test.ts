import { describe, it, expect, vi, beforeEach } from 'vitest';
import { encryptSecret, decryptSecret } from '@/lib/secretsEncryption';

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
