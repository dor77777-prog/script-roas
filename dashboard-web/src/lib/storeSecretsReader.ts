// dashboard-web/src/lib/storeSecretsReader.ts
// Per-store secret resolution: encrypted DB (store_secrets) FIRST, then the
// existing Vercel env var ${STORE_UPPER}_${KEY} as fallback, then null. The
// fallback keeps every store working during the env→DB migration. Server-only.
// store_secrets has NO anon grant → read via the service-role admin client.
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { decryptSecret } from '@/lib/secretsEncryption';

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
      return decryptSecret(data.ciphertext as string, data.iv as string, data.tag as string);
    }
  } catch (e) {
    // DB read or decrypt failure → fall through to env (never throw; never log the value)
    console.warn(
      `getStoreSecret(${storeId}, ${key}) DB read failed, using env fallback:`,
      e instanceof Error ? e.message : e,
    );
  }
  const env = process.env[`${storeId.toUpperCase()}_${key}`];
  return env ?? null;
}
