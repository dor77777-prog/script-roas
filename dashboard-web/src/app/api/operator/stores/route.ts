// dashboard-web/src/app/api/operator/stores/route.ts
// Self-serve stores Phase 6a — Task 3: add-store + list.
//
// POST /api/operator/stores  — THE highest-risk route: it writes encrypted
//   secrets + 4 DB tables (store_secrets, stores, store_webhooks, store_ad_state)
//   for one new store. ZERO REGRESSION is the dominant constraint: the live
//   3-store dashboard (real revenue) must keep working, and a FAILED add must
//   leave NO half-store. So the sequence is fail-safe with rollback-by-store_id:
//     1. validate (write nothing on failure)
//     2. LIVE re-verify every provided platform's creds (never trust the client)
//     3. INSERT stores FIRST (plain insert) = the concurrency gate: a double-submit
//        loser hits the PK conflict HERE (→ 409, no rollback — it owns nothing).
//     4. encrypt → store_secrets  5. insert store_webhooks  6. upsert store_ad_state
//     7. on ANY error AFTER the stores insert → DELETE everything for this
//        store_id from all 4 tables, then 500. (Rollback now only ever deletes
//        THIS request's rows, because it owns the stores row it created.)
//
// GET /api/operator/stores — the store list (incl. archived), each annotated
//   with which platforms are configured (derived from store_secrets PRESENCE,
//   never decrypted). NEVER returns a secret value.
//
// Auth: gated upstream by middleware (dashboard cookie + operator secret).
// Service-role client only (getSupabaseAdmin) — writes bypass RLS.
//
// SECURITY: a raw platform credential is NEVER echoed/logged/returned. Secrets
// are masked via maskSecret. The cart_public_token IS returned because the
// operator needs it to configure the store's cart beacon snippet (it is a
// per-store routing token, not a platform credential).
import { NextResponse } from 'next/server';
import { randomBytes } from 'crypto';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { encryptSecret, decryptSecret, maskSecret } from '@/lib/secretsEncryption';
import { verifyShopify, verifyMeta, verifyGoogle } from '@/lib/credVerifiers';
import { getStores } from '@/lib/getStores';
import { RESERVED_STORE_IDS, SHOP_DOMAIN_RE } from '@/lib/storeSecretsReader';
import { userFacingError } from '@/lib/apiErrors';
import { captureRouteError } from '@/lib/sentry/capture';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const STORE_ID_RE = /^[a-z0-9_-]+$/;
// SHOP_DOMAIN_RE (strict single-label *.myshopify.com) is the SINGLE source of
// truth shared with the PATCH + verify-creds routes (imported from
// storeSecretsReader) so all three enforce ONE regex — no divergent copies.

type Platform = 'shopify' | 'meta' | 'google' | 'tiktok';

interface AddStoreBody {
  storeId: string;
  name: string;
  shopDomain: string;
  isHeadless: boolean;
  brandColor: string;
  displayOrder?: number;
  hasTiktok: boolean;
  shopify: { clientId: string; clientSecret: string };
  meta?: { token: string; adAccountId: string };
  google?: { customerId: string; refreshToken: string };
  // OPERATOR-ENTERED Shopify webhook signing secret (Fix B1 / MF-2). Optional.
  // Shopify's order/refund webhooks (registered via Settings→Notifications) are
  // signed with a SHOP-LEVEL secret that is NOT the custom-app client_secret —
  // so we must NEVER default signing_secret to clientSecret (that would 401 the
  // real-time feed). Null is fine: the store still works for cron-pulled orders;
  // the operator can paste the secret later to enable the real-time feed. It is a
  // SECRET: masked/never echoed, kept ONLY in store_webhooks.signing_secret.
  webhookSecret?: string;
}

// Encrypt + upsert one secret (mirrors backfill-secrets:upsertSecret). Roundtrip-
// verifies WITHOUT echoing plaintext; throws on a DB error or a failed roundtrip
// so the caller's rollback fires (a secret that can't be decrypted back is as bad
// as a failed write — it would silently break the live fetcher later).
async function upsertSecret(storeId: string, key: string, plaintext: string): Promise<void> {
  const { ciphertext, iv, tag } = encryptSecret(plaintext);
  const { error } = await getSupabaseAdmin()
    .from('store_secrets')
    .upsert(
      { store_id: storeId, secret_key: key, ciphertext, iv, tag, updated_at: new Date().toISOString() },
      { onConflict: 'store_id,secret_key' },
    );
  if (error) throw new Error(`store_secrets upsert failed for ${key}: ${error.message}`);
  if (decryptSecret(ciphertext, iv, tag) !== plaintext) {
    throw new Error(`store_secrets roundtrip verify failed for ${key}`);
  }
}

// Delete EVERYTHING for this store_id from all 4 tables. Used for rollback after
// a partial write; safe to call even when a table has no rows for this store.
// `stores` keys on `id`; the other three on `store_id`. Best-effort: a cleanup
// error is logged but never masks the original failure (the caller re-throws the
// ORIGINAL error so the operator sees the real cause, not a cleanup hiccup).
async function rollbackStore(storeId: string): Promise<void> {
  const admin = getSupabaseAdmin();
  // [table, keyColumn] — child tables first, then the parent `stores` row.
  const targets: Array<[string, string]> = [
    ['store_ad_state', 'store_id'],
    ['store_webhooks', 'store_id'],
    ['store_secrets', 'store_id'],
    ['stores', 'id'],
  ];
  for (const [table, keyCol] of targets) {
    try {
      const { error } = await admin.from(table).delete().eq(keyCol, storeId);
      if (error) console.error(`rollbackStore: cleanup of ${table} for ${storeId} failed:`, error.message);
    } catch (e) {
      console.error(`rollbackStore: cleanup of ${table} for ${storeId} threw:`, e instanceof Error ? e.message : e);
    }
  }
}

export async function POST(req: Request): Promise<NextResponse> {
  let body: AddStoreBody;
  try {
    body = (await req.json()) as AddStoreBody;
  } catch {
    return NextResponse.json({ error: 'bad json' }, { status: 400 });
  }

  // ----- 1. VALIDATE (write nothing on failure) -----
  const storeId = typeof body.storeId === 'string' ? body.storeId.trim() : '';
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  const shopDomain = typeof body.shopDomain === 'string' ? body.shopDomain.trim().toLowerCase() : '';
  const brandColor = typeof body.brandColor === 'string' ? body.brandColor.trim() : '';
  const isHeadless = body.isHeadless === true;
  const hasTiktok = body.hasTiktok === true;
  const shopify = body.shopify;
  const meta = body.meta;
  const google = body.google;
  // Operator-entered webhook signing secret (Fix B1). Optional; null when absent
  // (NEVER defaulted to the Shopify client_secret). A non-string is treated as
  // absent (→ null) rather than a hard error — it's a convenience field.
  const webhookSecret =
    typeof body.webhookSecret === 'string' && body.webhookSecret.trim() !== ''
      ? body.webhookSecret
      : null;

  if (!STORE_ID_RE.test(storeId)) {
    return NextResponse.json({ error: 'storeId must match ^[a-z0-9_-]+$' }, { status: 400 });
  }
  if ((RESERVED_STORE_IDS as readonly string[]).includes(storeId)) {
    return NextResponse.json({ error: 'storeId is reserved' }, { status: 400 });
  }
  if (typeof body.isHeadless !== 'boolean' || typeof body.hasTiktok !== 'boolean') {
    return NextResponse.json({ error: 'isHeadless and hasTiktok must be booleans' }, { status: 400 });
  }
  if (!name || !brandColor || !shopDomain) {
    return NextResponse.json({ error: 'name, brandColor and shopDomain are required' }, { status: 400 });
  }
  if (!shopify || typeof shopify.clientId !== 'string' || typeof shopify.clientSecret !== 'string' || !shopify.clientId || !shopify.clientSecret) {
    return NextResponse.json({ error: 'shopify.clientId and shopify.clientSecret are required' }, { status: 400 });
  }
  if (!SHOP_DOMAIN_RE.test(shopDomain)) {
    return NextResponse.json({ error: 'shopDomain must be a single-label *.myshopify.com host' }, { status: 400 });
  }
  if (meta && (typeof meta.token !== 'string' || typeof meta.adAccountId !== 'string' || !meta.token || !meta.adAccountId)) {
    return NextResponse.json({ error: 'meta requires token and adAccountId' }, { status: 400 });
  }
  if (google && (typeof google.customerId !== 'string' || typeof google.refreshToken !== 'string' || !google.customerId || !google.refreshToken)) {
    return NextResponse.json({ error: 'google requires customerId and refreshToken' }, { status: 400 });
  }

  const admin = getSupabaseAdmin();

  try {
    // Pre-check dup store id (clean 409 instead of a PK-violation 500).
    const { data: existingStore, error: storeCheckErr } = await admin
      .from('stores')
      .select('id')
      .eq('id', storeId)
      .maybeSingle();
    if (storeCheckErr) throw new Error(storeCheckErr.message);
    if (existingStore) {
      return NextResponse.json({ error: 'a store with this id already exists' }, { status: 409 });
    }

    // Pre-check dup shop_domain (store_webhooks.shop_domain is UNIQUE).
    const { data: existingWebhook, error: whCheckErr } = await admin
      .from('store_webhooks')
      .select('store_id')
      .eq('shop_domain', shopDomain)
      .maybeSingle();
    if (whCheckErr) throw new Error(whCheckErr.message);
    if (existingWebhook) {
      return NextResponse.json({ error: 'a store with this shop_domain already exists' }, { status: 409 });
    }

    // ----- 2. LIVE re-verify every provided platform (never trust the client) -----
    const verification: { shopify?: string; meta?: string; google?: string } = {};
    const shop = await verifyShopify({ domain: shopDomain, clientId: shopify.clientId, clientSecret: shopify.clientSecret });
    if (!shop.ok) verification.shopify = shop.message;
    if (meta) {
      const m = await verifyMeta({ token: meta.token, adAccountId: meta.adAccountId });
      if (!m.ok) verification.meta = m.message;
    }
    if (google) {
      const g = await verifyGoogle({ customerId: google.customerId, refreshToken: google.refreshToken });
      if (!g.ok) verification.google = g.message;
    }
    if (Object.keys(verification).length > 0) {
      // Verification failed → write NOTHING.
      return NextResponse.json({ error: 'cred verification failed', verification }, { status: 400 });
    }

    // Compute display_order default = max(existing) + 1 if not provided.
    let displayOrder = typeof body.displayOrder === 'number' ? body.displayOrder : NaN;
    if (!Number.isFinite(displayOrder)) {
      const { data: orderRows, error: orderErr } = await admin.from('stores').select('display_order');
      if (orderErr) throw new Error(orderErr.message);
      const max = (orderRows ?? []).reduce((m: number, r: { display_order?: number | null }) => {
        const n = Number(r.display_order ?? 0);
        return Number.isFinite(n) && n > m ? n : m;
      }, 0);
      displayOrder = max + 1;
    }

    // ----- 3. INSERT stores FIRST = the concurrency gate (data-integrity). -----
    // The `stores` PK is the single source of truth for "who owns this store_id".
    // It MUST be the first write and use a plain `.insert` (NOT upsert) so a
    // concurrent/double-submit loser hits a PK conflict (Postgres 23505) here —
    // BEFORE arming rollback. The loser created nothing, so it must NOT call
    // rollbackStore (that would wipe the winner's rows). The FK only requires
    // `stores` to exist before `store_webhooks`; `store_secrets`/`store_ad_state`
    // have no FK, so writing `stores` first is valid. On conflict → 409 (the race
    // backstop behind the pre-checks); any other error → 500 (no rollback).
    const { error: storesErr } = await admin.from('stores').insert({
      id: storeId,
      name,
      status: 'active',
      brand_color: brandColor,
      is_headless: isHeadless,
      has_tiktok: hasTiktok,
      has_google_ads: !!google,
      display_order: displayOrder,
      meta_ad_account_id: meta?.adAccountId ?? null,
      google_ads_customer_id: google?.customerId ?? null,
    });
    if (storesErr) {
      // PK / unique conflict → another request already created this store_id.
      // We own NOTHING → do NOT roll back (would delete the winner's rows).
      const code = (storesErr as { code?: string }).code;
      if (code === '23505' || /duplicate|unique|already exists/i.test(storesErr.message)) {
        return NextResponse.json({ error: 'a store with this id already exists' }, { status: 409 });
      }
      throw new Error(`stores insert failed: ${storesErr.message}`);
    }

    // ===== `stores` is ours now → arm rollback for the remaining writes. A failure
    // in any of these deletes by store_id, which only touches THIS request's rows
    // (we own the `stores` row we just inserted, so the loser can never wipe us). =====
    const writtenKeys: string[] = [];
    try {
      // ----- 4. ENCRYPT → store_secrets (registry key names exactly; NO TikTok) -----
      await upsertSecret(storeId, 'SHOPIFY_DOMAIN', shopDomain);       writtenKeys.push('SHOPIFY_DOMAIN');
      await upsertSecret(storeId, 'SHOPIFY_CLIENT_ID', shopify.clientId);     writtenKeys.push('SHOPIFY_CLIENT_ID');
      await upsertSecret(storeId, 'SHOPIFY_CLIENT_SECRET', shopify.clientSecret); writtenKeys.push('SHOPIFY_CLIENT_SECRET');
      if (meta) {
        await upsertSecret(storeId, 'META_ACCESS_TOKEN', meta.token);          writtenKeys.push('META_ACCESS_TOKEN');
        await upsertSecret(storeId, 'META_AD_ACCOUNT_ID', meta.adAccountId);   writtenKeys.push('META_AD_ACCOUNT_ID');
      }
      if (google) {
        await upsertSecret(storeId, 'GOOGLEADS_CUSTOMER_ID', google.customerId);     writtenKeys.push('GOOGLEADS_CUSTOMER_ID');
        await upsertSecret(storeId, 'GOOGLEADS_REFRESH_TOKEN', google.refreshToken); writtenKeys.push('GOOGLEADS_REFRESH_TOKEN');
      }

      // ----- 5. INSERT store_webhooks -----
      // signing_secret is the OPERATOR-ENTERED webhookSecret (Fix B1 / MF-2), or
      // NULL when not provided. We do NOT default it to the Shopify app's
      // client_secret: Shopify's order/refund webhooks (registered via
      // Settings→Notifications) are signed with a SHOP-LEVEL secret distinct from
      // the custom-app client_secret, so that default would 401 the real-time feed
      // (HMAC mismatch). Null is safe — the store still works for cron-pulled
      // orders; the operator can set the secret later (PATCH webhookSecret).
      const cartPublicToken = randomBytes(24).toString('base64url');
      const { error: whErr } = await admin.from('store_webhooks').insert({
        store_id: storeId,
        shop_domain: shopDomain,
        signing_secret: webhookSecret,
        cart_public_token: cartPublicToken,
        allowed_origins: isHeadless ? [] : [`https://${shopDomain}`],
        enabled: true,
      });
      if (whErr) throw new Error(`store_webhooks insert failed: ${whErr.message}`);

      // ----- 6. UPSERT store_ad_state for each chosen ad platform -----
      const adPlatforms: Platform[] = [];
      if (meta) adPlatforms.push('meta');
      if (google) adPlatforms.push('google');
      if (hasTiktok) adPlatforms.push('tiktok');
      if (adPlatforms.length > 0) {
        const now = new Date().toISOString();
        const { error: adErr } = await admin
          .from('store_ad_state')
          .upsert(
            adPlatforms.map((platform) => ({ store_id: storeId, platform, enabled: true, updated_at: now })),
            { onConflict: 'store_id,platform' },
          );
        if (adErr) throw new Error(`store_ad_state upsert failed: ${adErr.message}`);
      }

      // ----- 8. RETURN (secrets MASKED; cart_public_token returned for the snippet) -----
      return NextResponse.json(
        {
          ok: true,
          store: {
            storeId,
            name,
            status: 'active',
            brandColor,
            isHeadless,
            hasTiktok,
            hasGoogleAds: !!google,
            displayOrder,
            metaAdAccountId: meta?.adAccountId ?? null,
            googleAdsCustomerId: google?.customerId ?? null,
            adPlatforms,
          },
          // Which secret KEYS were set, with a masked preview — NEVER the plaintext.
          secretsSet: writtenKeys,
          secretsMasked: {
            SHOPIFY_CLIENT_SECRET: maskSecret(shopify.clientSecret),
            ...(meta ? { META_ACCESS_TOKEN: maskSecret(meta.token) } : {}),
            ...(google ? { GOOGLEADS_REFRESH_TOKEN: maskSecret(google.refreshToken) } : {}),
          },
          // The operator needs this to configure the cart beacon snippet. It is a
          // routing token, not a platform credential.
          cartPublicToken,
        },
        { status: 201 },
      );
    } catch (writeErr) {
      // ----- 7. ROLLBACK: clean up everything for this store_id, then 500 -----
      await rollbackStore(storeId);
      throw writeErr; // re-throw → outer catch returns a generic 500 (no secret).
    }
  } catch (err) {
    captureRouteError('operator/stores', err);
    const message = err instanceof Error ? err.message : String(err);
    console.error('/api/operator/stores POST failed:', message);
    // Store-creation-specific message (NOT the Google-Sheets "loading failed"
    // copy). Still NO secret/detail in the body; raw cause is logged above +
    // captured by Sentry. `code` is a stable machine handle for the wizard.
    return NextResponse.json(
      { error: 'יצירת החנות נכשלה', code: 'store_create_failed' },
      { status: 500 },
    );
  }
}

export async function GET(): Promise<NextResponse> {
  try {
    const stores = await getStores({ includeArchived: true });

    // Group store_secrets by store_id WITHOUT decrypting — presence only.
    const admin = getSupabaseAdmin();
    const { data: secretRows, error } = await admin
      .from('store_secrets')
      .select('store_id, secret_key');
    if (error) throw new Error(error.message);

    // D0 — webhook signing-secret PRESENCE per store (powers hasWebhookSecret in
    // the credential matrix). We select signing_secret ONLY to compute a boolean
    // (set / not-set) — the raw value is NEVER returned to the client. A themed
    // store with no signing_secret silently has no real-time sales feed, so the
    // matrix surfaces it as ⚠ "missing" so the operator can paste it.
    const { data: webhookRows, error: whErr } = await admin
      .from('store_webhooks')
      .select('store_id, signing_secret');
    if (whErr) throw new Error(whErr.message);
    const webhookSecretByStore = new Map<string, boolean>();
    for (const w of (webhookRows ?? []) as Array<{ store_id: string; signing_secret: string | null }>) {
      webhookSecretByStore.set(
        w.store_id,
        typeof w.signing_secret === 'string' && w.signing_secret.trim() !== '',
      );
    }

    // secret_key prefix → platform.
    const platformOf = (key: string): Platform | null => {
      if (key.startsWith('SHOPIFY_')) return 'shopify';
      if (key.startsWith('META_')) return 'meta';
      if (key.startsWith('GOOGLEADS_')) return 'google';
      if (key.startsWith('TIKTOK_')) return 'tiktok';
      return null;
    };
    const byStore = new Map<string, Set<Platform>>();
    for (const r of (secretRows ?? []) as Array<{ store_id: string; secret_key: string }>) {
      const p = platformOf(r.secret_key);
      if (!p) continue;
      if (!byStore.has(r.store_id)) byStore.set(r.store_id, new Set());
      byStore.get(r.store_id)!.add(p);
    }

    const rows = stores.map((s) => {
      // `platforms` = the platforms this store PARTICIPATES in:
      //   {shopify/meta/google from store_secrets presence} ∪ {tiktok from has_tiktok}.
      // TikTok is a SHARED ad account with NO per-store secret, so it would never
      // appear from secrets alone (Fix B4) — derive it from the has_tiktok column.
      const set = new Set<Platform>(byStore.get(s.storeId) ?? []);
      if (s.hasTikTok) set.add('tiktok');
      return {
        storeId: s.storeId,
        name: s.storeName,
        brandColor: s.brandColor,
        isHeadless: s.isHeadless,
        hasTikTok: s.hasTikTok,
        status: s.status,
        displayOrder: s.displayOrder,
        platforms: Array.from(set).sort(),
        // D0 — PRESENCE boolean only (never the secret value). false when the
        // store has no store_webhooks row OR an empty/null signing_secret.
        hasWebhookSecret: webhookSecretByStore.get(s.storeId) ?? false,
      };
    });

    return NextResponse.json({ stores: rows }, { status: 200 });
  } catch (err) {
    captureRouteError('operator/stores', err);
    const message = err instanceof Error ? err.message : String(err);
    console.error('/api/operator/stores GET failed:', message);
    return NextResponse.json({ error: userFacingError(message) }, { status: 500 });
  }
}
