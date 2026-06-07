// dashboard-web/src/app/api/operator/backfill-secrets/route.ts
// Operator-triggered, auth-gated (middleware: dash_auth cookie + x-operator-secret)
// backfill of Vercel env secrets into the encrypted store_secrets table. Runs on
// Vercel (the only place env secrets + ENCRYPTION_MASTER_KEY + service-role coexist).
// Idempotent UPSERT. Skips absent env vars (never writes empty rows). Decrypt-
// roundtrip verifies each write WITHOUT echoing any plaintext.
import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { encryptSecret, decryptSecret } from '@/lib/secretsEncryption';
import { loadActiveStoreIds } from '@/lib/getStores';
import { perStoreKeysForStore, GLOBAL_SECRET_KEYS } from '@/lib/secretsRegistry';
import { GLOBAL_STORE_ID } from '@/lib/storeSecretsReader';
import { userFacingError } from '@/lib/apiErrors';
import { captureRouteError } from '@/lib/sentry/capture';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

type Entry = { store: string; key: string; status: 'written' | 'skipped-absent' | 'error'; verified?: boolean };

async function upsertSecret(storeId: string, key: string, plaintext: string): Promise<Entry> {
  const { ciphertext, iv, tag } = encryptSecret(plaintext);
  const { error } = await getSupabaseAdmin()
    .from('store_secrets')
    .upsert(
      { store_id: storeId, secret_key: key, ciphertext, iv, tag, updated_at: new Date().toISOString() },
      { onConflict: 'store_id,secret_key' }, // explicit PK conflict target (house convention)
    );
  if (error) throw new Error(error.message);
  // Roundtrip-verify without echoing plaintext: decrypt and compare in-memory.
  const verified = decryptSecret(ciphertext, iv, tag) === plaintext;
  return { store: storeId, key, status: 'written', verified };
}

export async function POST(_req: Request): Promise<NextResponse> {
  void _req; // Body unused; the operation is fully driven by env + registry.
  try {
    // Fail fast + clean if the master key is misconfigured: encrypt a probe so we
    // never write a partial/half-encrypted backfill. Throws → caught below → 500.
    encryptSecret('__probe__');

    const storeIds = await loadActiveStoreIds();
    const summary: Entry[] = [];

    for (const storeId of storeIds) {
      for (const key of perStoreKeysForStore(storeId)) {
        const val = process.env[`${storeId.toUpperCase()}_${key}`];
        if (val) summary.push(await upsertSecret(storeId, key, val));
        else summary.push({ store: storeId, key, status: 'skipped-absent' });
      }
    }
    for (const key of GLOBAL_SECRET_KEYS) {
      const val = process.env[key];
      if (val) summary.push(await upsertSecret(GLOBAL_STORE_ID, key, val));
      else summary.push({ store: GLOBAL_STORE_ID, key, status: 'skipped-absent' });
    }

    const written = summary.filter((s) => s.status === 'written').length;
    const failedVerify = summary.filter((s) => s.status === 'written' && !s.verified).length;
    return NextResponse.json({ written, failedVerify, summary }, { status: 200 });
  } catch (err) {
    captureRouteError('operator/backfill-secrets', err);
    const message = err instanceof Error ? err.message : String(err);
    console.error('/api/operator/backfill-secrets POST failed:', message);
    return NextResponse.json({ error: userFacingError(message) }, { status: 500 });
  }
}
