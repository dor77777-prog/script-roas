// dashboard-web/src/lib/secretsEncryption.ts
// AES-256-GCM for per-store secrets at rest. Master key = ENCRYPTION_MASTER_KEY
// (base64, 32 bytes) in Vercel env. Server-only (fetchers/admin routes). Never
// logs plaintext. self-serve 2026-06-06.
import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

const ALG = 'aes-256-gcm';

function masterKey(): Buffer {
  const k = process.env.ENCRYPTION_MASTER_KEY;
  if (!k) throw new Error('ENCRYPTION_MASTER_KEY missing — required to (de)crypt store secrets.');
  const buf = Buffer.from(k, 'base64');
  if (buf.length !== 32) throw new Error('ENCRYPTION_MASTER_KEY must be 32 bytes (base64-encoded).');
  return buf;
}

export function encryptSecret(plaintext: string): { ciphertext: string; iv: string; tag: string } {
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALG, masterKey(), iv);
  const enc = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return { ciphertext: enc.toString('base64'), iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64') };
}

export function decryptSecret(ciphertext: string, iv: string, tag: string): string {
  const decipher = createDecipheriv(ALG, masterKey(), Buffer.from(iv, 'base64'));
  decipher.setAuthTag(Buffer.from(tag, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(ciphertext, 'base64')), decipher.final()]).toString('utf8');
}

// ---------------------------------------------------------------------------
// Forward guards for Phase 6 admin routes (self-serve stores Phase 5c).
// ---------------------------------------------------------------------------

/**
 * Mask a secret for SAFE display/logging. Shows only the last 4 characters,
 * everything else is replaced by a fixed dot run — the full value is NEVER
 * returned. For values of length ≤ 4 (too short to reveal a suffix without
 * exposing most of the secret) the entire value is masked.
 *
 *   maskSecret('shpat_abcd1234') === '••••1234'
 *   maskSecret('abc')            === '••••'
 *
 * Use this anywhere a secret-shaped value would otherwise be echoed to a
 * client, a log line, or an operator UI. There is no inverse.
 */
export function maskSecret(value: string): string {
  return value.length > 4 ? '••••' + value.slice(-4) : '••••';
}

/**
 * The ONLY store-secret value(s) intentionally returned to the client today.
 * `TIKTOK_ADVERTISER_ID` is a semi-public advertiser id (it appears in TikTok
 * ad URLs and the CampaignDrawer's store-mapping localStorage key), not a
 * credential. Phase 6 admin routes that surface store secrets should consult
 * this allowlist: a key NOT in here must be masked via maskSecret() before it
 * ever crosses the network boundary.
 */
export const CLIENT_SAFE_SECRET_KEYS = ['TIKTOK_ADVERTISER_ID'] as const;
