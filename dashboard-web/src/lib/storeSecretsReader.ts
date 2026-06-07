// dashboard-web/src/lib/storeSecretsReader.ts
// Per-store secret resolution: encrypted DB (store_secrets) FIRST, then the
// existing Vercel env var as fallback, then null. The fallback keeps every store
// working during the env→DB migration. Server-only. store_secrets has NO anon
// grant → read via the service-role admin client.
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { decryptSecret } from '@/lib/secretsEncryption';

// Synthetic store_id for shared/global secrets (GOOGLEADS_*, META_GLOBAL_TOKEN).
// Reserved: must never be a real store id (guard in the Phase-6 create route).
export const GLOBAL_STORE_ID = '__global__';
export const RESERVED_STORE_IDS = [GLOBAL_STORE_ID] as const;

// THE single source of truth for a valid Shopify shop domain across the Phase-6
// operator/stores routes (POST add, PATCH edit, verify-creds probe). A strict
// single-label *.myshopify.com host: one DNS label + the literal suffix. Rejects
// malformed hosts like `evil.com/path.myshopify.com`, `.myshopify.com`,
// `a b.myshopify.com`, `<script>.myshopify.com`, `sub.domain.myshopify.com`,
// `-leadinghyphen.myshopify.com` BEFORE they reach a live Shopify verify (a minor
// SSRF surface) or land in `allowed_origins`. Defined here (shared, server-only
// reader module) so all three routes import ONE regex — no divergent copies.
export const SHOP_DOMAIN_RE = /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/;

export async function getStoreSecret(storeId: string, key: string): Promise<string | null> {
  try {
    const { data, error } = await getSupabaseAdmin()
      .from('store_secrets')
      .select('ciphertext, iv, tag')
      .eq('store_id', storeId)
      .eq('secret_key', key)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (data) {
      const val = decryptSecret(data.ciphertext as string, data.iv as string, data.tag as string);
      if (val) return val; // non-empty DB value wins; empty/'' falls through to env
    }
  } catch (e) {
    // DB read or decrypt failure → fall through to env (never throw; never log the value)
    console.warn(
      `getStoreSecret(${storeId}, ${key}) DB read failed, using env fallback:`,
      e instanceof Error ? e.message : e,
    );
  }
  // Global secrets fall back to the UNPREFIXED env var; per-store to ${STORE}_${KEY}.
  const envName = storeId === GLOBAL_STORE_ID ? key : `${storeId.toUpperCase()}_${key}`;
  const env = process.env[envName];
  return env ?? null;
}

// Shared/global secret: same DB-then-env resolution under the __global__ id, with
// an unprefixed env fallback (process.env[key] verbatim).
export function getGlobalSecret(key: string): Promise<string | null> {
  return getStoreSecret(GLOBAL_STORE_ID, key);
}
