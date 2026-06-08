// dashboard-web/src/app/api/operator/stores/[id]/route.ts
// Self-serve stores Phase 6a — Task 8: edit basics + rotate creds for ONE store.
//
// GET  /api/operator/stores/[id] — the wizard's edit prefill. Returns the
//   store BASICS ONLY (name / shopDomain / isHeadless / brandColor /
//   displayOrder / hasTiktok / platforms) where `platforms` is derived from
//   store_secrets PRESENCE (never decrypted). 404 when the store is unknown.
//   NEVER returns a secret value/ciphertext.
//
// PATCH /api/operator/stores/[id] — apply ONLY the fields present in the body:
//   basics (name/shopDomain/isHeadless/brandColor/displayOrder/hasTiktok) and/or
//   a FULL cred set per rotated platform (shopify/meta/google).
//
//   THE CRITICAL INVARIANT (verify-first): a cred the operator just typed is
//   NEVER persisted before it has been verified LIVE. So the sequence is:
//     1. validate (404 unknown / 400 reserved / 400 bad domain / 409 dup domain
//        / 400 empty body) — write NOTHING on any failure.
//     2. LIVE-verify EVERY provided cred object FIRST (shopify against the new
//        domain if changed, else the existing one). A shopDomain CHANGE alone
//        (no rotated creds) is ALSO verified — using the EXISTING SHOPIFY_CLIENT_*
//        secrets — because the live fetchers resolve the domain from the
//        SHOPIFY_DOMAIN secret, so an unverified domain would silently break them.
//        If ANY fails → 400 with { verification } and WRITE NOTHING.
//     3. ONLY after all verifications pass → re-encrypt + UPSERT the rotated
//        platforms' secrets (and the SHOPIFY_DOMAIN secret on ANY domain change,
//        kept in LOCKSTEP with store_webhooks.shop_domain), upsert store_ad_state
//        + set the stores flag when a platform is newly ADDED, update `stores`
//        basics, update store_webhooks.
//     4. return a MASKED confirmation. NEVER echo a raw secret.
//
//   Unlike the add route, the store ALREADY exists and works, so a half-applied
//   edit is not a "half-store"; there is no rollback. The verify-first ordering
//   is the guarantee that no UNVERIFIED cred is ever written.
//
//   Platform REMOVAL / archive / delete is Phase 6b — NOT here.
//
// Auth: gated upstream by middleware. Service-role client only (writes bypass
// RLS). SECURITY: a raw credential is NEVER echoed/logged/returned — masked via
// maskSecret.
import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { encryptSecret, decryptSecret, maskSecret } from '@/lib/secretsEncryption';
import { verifyShopify, verifyMeta, verifyGoogle } from '@/lib/credVerifiers';
import { getStoreSecret, RESERVED_STORE_IDS, SHOP_DOMAIN_RE } from '@/lib/storeSecretsReader';
import { captureRouteError } from '@/lib/sentry/capture';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// SHOP_DOMAIN_RE (strict single-label *.myshopify.com) is imported from the
// shared reader module — the SINGLE source of truth across the add (POST),
// edit (PATCH) and verify-creds routes (no divergent copy).

type Platform = 'shopify' | 'meta' | 'google' | 'tiktok';

interface PatchStoreBody {
  name?: string;
  shopDomain?: string;
  isHeadless?: boolean;
  brandColor?: string;
  displayOrder?: number;
  hasTiktok?: boolean;
  shopify?: { clientId: string; clientSecret: string };
  meta?: { token: string; adAccountId: string };
  google?: { customerId: string; refreshToken: string };
  // OPERATOR-ENTERED Shopify webhook signing secret (Fix B1 / MF-2). When present
  // → update store_webhooks.signing_secret to this value, INDEPENDENTLY of whether
  // Shopify creds are rotated. A Shopify creds rotation alone NO LONGER touches
  // signing_secret (the client_secret is NOT the webhook signing secret). Masked,
  // never echoed; kept ONLY in store_webhooks.signing_secret.
  webhookSecret?: string;
}

type RouteCtx = { params: Promise<{ id: string }> };

// =============================================================================
// DELETE wipe list (Phase 6b T2) — the EXHAUSTIVE, FK-safe set of tables a hard
// store delete must clear, derived from the schema: EVERY table that has a
// `store_id` column (grep `store_id` over supabase/migrations), plus `stores`
// itself LAST (it is the FK parent, keyed by `id` — not `store_id`).
//
// ORDER MATTERS: children/data → config → `stores` LAST. The 7 *_daily/per-store
// data tables FK store_id → stores(id) with ON DELETE RESTRICT (migration
// 20260521075741), and store_webhooks/store_events REFERENCE stores(id) with the
// default RESTRICT, so the parent `stores` row can only be removed AFTER every
// child row is gone. Deleting `stores` last also means a mid-wipe failure leaves
// the store row intact (operator can retry) instead of orphaning data.
//
// keyCol: every store-scoped table is keyed by `store_id`; `stores` by `id`.
//
// EXHAUSTIVENESS is guarded by a test that re-derives the store_id table set from
// the migrations and asserts it EQUALS this list — so a future store_id table
// can't be silently missed. Update this list when a new store_id table lands; the
// test will fail loudly until you do.
//
// NOTE on token_failures: its store_id has a CHECK constraint pinning it to the
// live 3 stores + 'global', so a NEW self-serve store's id can never appear there
// — but deleting by store_id is harmless (matches zero rows) and keeps the wipe
// uniform + future-proof, so it stays in the list.
export const STORE_SCOPED_WIPE_TABLES: ReadonlyArray<{ table: string; keyCol: 'store_id' | 'id' }> = [
  // ---- store-scoped DATA tables (delete FIRST — children) ----
  { table: 'data_daily', keyCol: 'store_id' },
  { table: 'products_daily', keyCol: 'store_id' },
  { table: 'campaigns_daily', keyCol: 'store_id' },
  { table: 'ads_daily', keyCol: 'store_id' },
  { table: 'orders_attribution', keyCol: 'store_id' },
  { table: 'product_catalog', keyCol: 'store_id' },
  { table: 'manual_overrides', keyCol: 'store_id' },
  { table: 'token_failures', keyCol: 'store_id' },
  { table: 'meta_buc_usage', keyCol: 'store_id' },
  { table: 'data_freshness', keyCol: 'store_id' },
  { table: 'campaign_registry', keyCol: 'store_id' },
  { table: 'adset_registry', keyCol: 'store_id' },
  { table: 'ad_registry', keyCol: 'store_id' },
  { table: 'campaign_status_events', keyCol: 'store_id' },
  { table: 'store_events', keyCol: 'store_id' },
  { table: 'customer_first_order', keyCol: 'store_id' },
  { table: 'customer_cohort_monthly', keyCol: 'store_id' },
  // ---- config tables (delete NEXT) ----
  { table: 'store_ad_state', keyCol: 'store_id' },
  { table: 'store_webhooks', keyCol: 'store_id' },
  { table: 'store_secrets', keyCol: 'store_id' },
  // ---- the FK parent — delete LAST, keyed by `id` ----
  { table: 'stores', keyCol: 'id' },
];

// Encrypt + upsert one secret; roundtrip-verify WITHOUT echoing plaintext (a
// secret that can't be decrypted back is as bad as a failed write — it would
// silently break the live fetcher). Throws on a DB error or a failed roundtrip.
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

// secret_key prefix → platform (mirrors the list GET).
function platformOf(key: string): Platform | null {
  if (key.startsWith('SHOPIFY_')) return 'shopify';
  if (key.startsWith('META_')) return 'meta';
  if (key.startsWith('GOOGLEADS_')) return 'google';
  if (key.startsWith('TIKTOK_')) return 'tiktok';
  return null;
}

// Read the store's configured platforms from store_secrets PRESENCE (no decrypt).
async function configuredPlatforms(storeId: string): Promise<Platform[]> {
  const { data, error } = await getSupabaseAdmin()
    .from('store_secrets')
    .select('secret_key')
    .eq('store_id', storeId);
  if (error) throw new Error(error.message);
  const set = new Set<Platform>();
  for (const r of (data ?? []) as Array<{ secret_key: string }>) {
    const p = platformOf(r.secret_key);
    if (p) set.add(p);
  }
  return Array.from(set);
}

// Read store_webhooks.shop_domain for a store (the canonical shop-domain source).
async function readShopDomain(storeId: string): Promise<string | null> {
  const { data, error } = await getSupabaseAdmin()
    .from('store_webhooks')
    .select('shop_domain')
    .eq('store_id', storeId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data?.shop_domain as string | undefined) ?? null;
}

// D0 — webhook signing-secret PRESENCE (set / not-set) for a store. Selects
// signing_secret ONLY to compute the boolean; the raw value is NEVER returned.
// false when there is no store_webhooks row OR the signing_secret is null/empty.
async function readHasWebhookSecret(storeId: string): Promise<boolean> {
  const { data, error } = await getSupabaseAdmin()
    .from('store_webhooks')
    .select('signing_secret')
    .eq('store_id', storeId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  const sig = (data?.signing_secret as string | null | undefined) ?? null;
  return typeof sig === 'string' && sig.trim() !== '';
}

// =============================================================================
// GET — basics only (edit prefill). NO secrets.
// =============================================================================
export async function GET(_req: Request, ctx: RouteCtx): Promise<NextResponse> {
  const { id } = await ctx.params;
  // Fix B3 — reject the reserved ids (incl. __global__) before any DB read.
  // Harmless today (no `stores` row → 404) but consistent with PATCH + defensive.
  if ((RESERVED_STORE_IDS as readonly string[]).includes(id)) {
    return NextResponse.json({ error: 'storeId is reserved' }, { status: 400 });
  }
  try {
    const admin = getSupabaseAdmin();
    const { data: store, error: storeErr } = await admin
      .from('stores')
      .select('id, name, brand_color, is_headless, has_tiktok, display_order')
      .eq('id', id)
      .maybeSingle();
    if (storeErr) throw new Error(storeErr.message);
    if (!store) {
      return NextResponse.json({ error: 'store not found' }, { status: 404 });
    }

    // `platforms` = {shopify/meta/google from store_secrets presence} ∪ {tiktok
    // from has_tiktok}. TikTok is a SHARED account with NO per-store secret, so
    // it would never appear from secrets alone (Fix B4) — derive it from the
    // has_tiktok column so the Fix-D credential matrix is correct.
    const platformSet = new Set<Platform>(await configuredPlatforms(id));
    if (store.has_tiktok === true) platformSet.add('tiktok');
    const platforms = Array.from(platformSet);
    const shopDomain = await readShopDomain(id);
    // D0 — presence boolean only (powers the wizard's "מוגדר / לא מוגדר" webhook
    // affordance + the row matrix). The raw signing_secret is NEVER returned.
    const hasWebhookSecret = await readHasWebhookSecret(id);

    return NextResponse.json(
      {
        storeId: String(store.id),
        name: String(store.name ?? ''),
        shopDomain: shopDomain ?? '',
        isHeadless: store.is_headless === true,
        brandColor: (store.brand_color as string | null) ?? null,
        displayOrder: store.display_order == null ? null : Number(store.display_order),
        hasTiktok: store.has_tiktok === true,
        platforms: platforms.sort(),
        hasWebhookSecret,
      },
      { status: 200 },
    );
  } catch (err) {
    captureRouteError('operator/stores/[id]', err);
    console.error(`/api/operator/stores/${id} GET failed:`, err instanceof Error ? err.message : String(err));
    return NextResponse.json({ error: 'טעינת פרטי החנות נכשלה' }, { status: 500 });
  }
}

// =============================================================================
// PATCH — edit basics and/or rotate creds (verify-first).
// =============================================================================
export async function PATCH(req: Request, ctx: RouteCtx): Promise<NextResponse> {
  const { id } = await ctx.params;

  let body: PatchStoreBody;
  try {
    body = (await req.json()) as PatchStoreBody;
  } catch {
    return NextResponse.json({ error: 'bad json' }, { status: 400 });
  }

  // ----- 1. VALIDATE (write nothing on failure) -----
  if ((RESERVED_STORE_IDS as readonly string[]).includes(id)) {
    return NextResponse.json({ error: 'storeId is reserved' }, { status: 400 });
  }

  // Normalize basics.
  const name = typeof body.name === 'string' ? body.name.trim() : undefined;
  const shopDomain =
    typeof body.shopDomain === 'string' ? body.shopDomain.trim().toLowerCase() : undefined;
  const brandColor = typeof body.brandColor === 'string' ? body.brandColor.trim() : undefined;
  const isHeadless = typeof body.isHeadless === 'boolean' ? body.isHeadless : undefined;
  const hasTiktok = typeof body.hasTiktok === 'boolean' ? body.hasTiktok : undefined;
  const displayOrder = typeof body.displayOrder === 'number' && Number.isFinite(body.displayOrder)
    ? body.displayOrder
    : undefined;
  const shopify = body.shopify;
  const meta = body.meta;
  const google = body.google;
  // Operator-entered webhook signing secret (Fix B1). Present (non-empty string)
  // → update store_webhooks.signing_secret to this value. Absent → leave it
  // untouched (a Shopify creds rotation no longer changes it).
  const webhookSecret =
    typeof body.webhookSecret === 'string' && body.webhookSecret.trim() !== ''
      ? body.webhookSecret
      : undefined;

  // Field-shape validation for the cred objects (a present platform = full set).
  if (shopify && (typeof shopify.clientId !== 'string' || typeof shopify.clientSecret !== 'string' || !shopify.clientId || !shopify.clientSecret)) {
    return NextResponse.json({ error: 'shopify requires clientId and clientSecret' }, { status: 400 });
  }
  if (meta && (typeof meta.token !== 'string' || typeof meta.adAccountId !== 'string' || !meta.token || !meta.adAccountId)) {
    return NextResponse.json({ error: 'meta requires token and adAccountId' }, { status: 400 });
  }
  if (google && (typeof google.customerId !== 'string' || typeof google.refreshToken !== 'string' || !google.customerId || !google.refreshToken)) {
    return NextResponse.json({ error: 'google requires customerId and refreshToken' }, { status: 400 });
  }

  // Reject an empty body (nothing to do). webhookSecret counts as an updatable
  // field (Fix B1) — a webhookSecret-only PATCH must be accepted.
  const hasBasics = name !== undefined || shopDomain !== undefined || brandColor !== undefined
    || isHeadless !== undefined || hasTiktok !== undefined || displayOrder !== undefined;
  const hasCreds = !!shopify || !!meta || !!google;
  if (!hasBasics && !hasCreds && webhookSecret === undefined) {
    return NextResponse.json({ error: 'empty body — nothing to update' }, { status: 400 });
  }

  // shopDomain strict-regex (before any live verify / DB write).
  if (shopDomain !== undefined && !SHOP_DOMAIN_RE.test(shopDomain)) {
    return NextResponse.json({ error: 'shopDomain must be a single-label *.myshopify.com host' }, { status: 400 });
  }

  const admin = getSupabaseAdmin();

  try {
    // ----- store must exist (404) -----
    const { data: existingStore, error: storeCheckErr } = await admin
      .from('stores')
      .select('id, is_headless')
      .eq('id', id)
      .maybeSingle();
    if (storeCheckErr) throw new Error(storeCheckErr.message);
    if (!existingStore) {
      return NextResponse.json({ error: 'store not found' }, { status: 404 });
    }

    // ----- shopDomain UNIQUE among OTHER stores (409) -----
    if (shopDomain !== undefined) {
      const { data: domainOwner, error: domErr } = await admin
        .from('store_webhooks')
        .select('store_id')
        .eq('shop_domain', shopDomain)
        .maybeSingle();
      if (domErr) throw new Error(domErr.message);
      if (domainOwner && String(domainOwner.store_id) !== id) {
        return NextResponse.json({ error: 'a store with this shop_domain already exists' }, { status: 409 });
      }
    }

    // ----- 2. LIVE-verify EVERY provided cred FIRST (write nothing on failure) -----
    // Did the shop domain ACTUALLY change? A domain change (even without rotated
    // creds) must be live-verified, because the live Shopify fetchers resolve the
    // domain from the SHOPIFY_DOMAIN secret — persisting an unverified domain
    // would silently break them. Compare against the store's current domain so an
    // idempotent same-domain PATCH is NOT treated as a change.
    const currentShopDomain = shopDomain !== undefined ? await readShopDomain(id) : null;
    const domainChanged = shopDomain !== undefined && shopDomain !== currentShopDomain;

    // The domain to (re)verify Shopify against: the NEW one if provided, else the
    // existing one (store_webhooks; getStoreSecret SHOPIFY_DOMAIN as fallback).
    let effectiveShopDomain: string | null = shopDomain ?? null;
    if ((shopify || domainChanged) && effectiveShopDomain === null) {
      effectiveShopDomain = (await readShopDomain(id)) ?? (await getStoreSecret(id, 'SHOPIFY_DOMAIN'));
    }

    // Resolve the Shopify creds to verify the (new) domain with:
    //   - body-provided creds (a rotation) → those (also persisted in phase 3);
    //   - else, on a domain-only change → the EXISTING SHOPIFY_CLIENT_ID/SECRET.
    // The existing creds are used ONLY to verify the new domain and are NEVER
    // returned/logged.
    let verifyShopifyClientId: string | null = shopify ? shopify.clientId : null;
    let verifyShopifyClientSecret: string | null = shopify ? shopify.clientSecret : null;
    if (!shopify && domainChanged) {
      verifyShopifyClientId = await getStoreSecret(id, 'SHOPIFY_CLIENT_ID');
      verifyShopifyClientSecret = await getStoreSecret(id, 'SHOPIFY_CLIENT_SECRET');
      if (!verifyShopifyClientId || !verifyShopifyClientSecret) {
        // No existing Shopify creds to validate the new domain with — refuse
        // rather than persist an unverified domain.
        return NextResponse.json(
          { error: 'cannot change shopDomain: store has no Shopify credentials to verify the new domain' },
          { status: 400 },
        );
      }
    }

    const verification: { shopify?: string; meta?: string; google?: string } = {};
    if (shopify || domainChanged) {
      const s = await verifyShopify({
        domain: effectiveShopDomain ?? '',
        clientId: verifyShopifyClientId ?? '',
        clientSecret: verifyShopifyClientSecret ?? '',
      });
      if (!s.ok) verification.shopify = s.message;
    }
    if (meta) {
      const m = await verifyMeta({ token: meta.token, adAccountId: meta.adAccountId });
      if (!m.ok) verification.meta = m.message;
    }
    if (google) {
      const g = await verifyGoogle({ customerId: google.customerId, refreshToken: google.refreshToken });
      if (!g.ok) verification.google = g.message;
    }
    if (Object.keys(verification).length > 0) {
      // Verification failed → write NOTHING (not even the basics).
      return NextResponse.json({ error: 'cred verification failed', verification }, { status: 400 });
    }

    // ===== 3. APPLY WRITES (only after all verifications pass) =====
    const existingPlatforms = hasCreds ? await configuredPlatforms(id) : [];
    const updated: string[] = [];
    const secretsMasked: Record<string, string> = {};
    const newlyAddedAdPlatforms: Platform[] = [];

    // --- store_secrets (rotated platforms) ---
    // SHOPIFY_DOMAIN secret is kept in LOCKSTEP with store_webhooks.shop_domain:
    // re-encrypt it on ANY domain change (verified above), not only on a cred
    // rotation — the live Shopify fetchers read the domain from this secret, so
    // the two sources must never diverge.
    if (domainChanged && shopDomain !== undefined) {
      await upsertSecret(id, 'SHOPIFY_DOMAIN', shopDomain);
    }
    if (shopify) {
      await upsertSecret(id, 'SHOPIFY_CLIENT_ID', shopify.clientId);
      await upsertSecret(id, 'SHOPIFY_CLIENT_SECRET', shopify.clientSecret);
      secretsMasked.SHOPIFY_CLIENT_SECRET = maskSecret(shopify.clientSecret);
      updated.push('shopify');
    }
    if (meta) {
      await upsertSecret(id, 'META_ACCESS_TOKEN', meta.token);
      await upsertSecret(id, 'META_AD_ACCOUNT_ID', meta.adAccountId);
      secretsMasked.META_ACCESS_TOKEN = maskSecret(meta.token);
      updated.push('meta');
      if (!existingPlatforms.includes('meta')) newlyAddedAdPlatforms.push('meta');
    }
    if (google) {
      await upsertSecret(id, 'GOOGLEADS_CUSTOMER_ID', google.customerId);
      await upsertSecret(id, 'GOOGLEADS_REFRESH_TOKEN', google.refreshToken);
      secretsMasked.GOOGLEADS_REFRESH_TOKEN = maskSecret(google.refreshToken);
      updated.push('google');
      if (!existingPlatforms.includes('google')) newlyAddedAdPlatforms.push('google');
    }

    // --- store_ad_state for newly-added ad platforms (enabled=true) ---
    if (newlyAddedAdPlatforms.length > 0) {
      const now = new Date().toISOString();
      const { error: adErr } = await admin
        .from('store_ad_state')
        .upsert(
          newlyAddedAdPlatforms.map((platform) => ({ store_id: id, platform, enabled: true, updated_at: now })),
          { onConflict: 'store_id,platform' },
        );
      if (adErr) throw new Error(`store_ad_state upsert failed: ${adErr.message}`);
    }

    // --- stores basics ---
    const storesPatch: Record<string, unknown> = {};
    if (name !== undefined) storesPatch.name = name;
    if (brandColor !== undefined) storesPatch.brand_color = brandColor;
    if (isHeadless !== undefined) storesPatch.is_headless = isHeadless;
    if (hasTiktok !== undefined) storesPatch.has_tiktok = hasTiktok;
    if (displayOrder !== undefined) storesPatch.display_order = displayOrder;
    if (meta) storesPatch.meta_ad_account_id = meta.adAccountId;
    if (google) {
      storesPatch.google_ads_customer_id = google.customerId;
      storesPatch.has_google_ads = true;
    }
    if (Object.keys(storesPatch).length > 0) {
      const { error: storesErr } = await admin.from('stores').update(storesPatch).eq('id', id);
      if (storesErr) throw new Error(`stores update failed: ${storesErr.message}`);
      for (const k of ['name', 'brandColor', 'isHeadless', 'hasTiktok', 'displayOrder'] as const) {
        if (
          (k === 'name' && name !== undefined) ||
          (k === 'brandColor' && brandColor !== undefined) ||
          (k === 'isHeadless' && isHeadless !== undefined) ||
          (k === 'hasTiktok' && hasTiktok !== undefined) ||
          (k === 'displayOrder' && displayOrder !== undefined)
        ) {
          updated.push(k);
        }
      }
    }

    // --- store_webhooks (shop_domain / allowed_origins / signing_secret) ---
    // signing_secret is ONLY ever set from the OPERATOR-ENTERED webhookSecret
    // (Fix B1 / MF-2) — NEVER from shopify.clientSecret. A Shopify creds rotation
    // alone therefore does NOT touch signing_secret. The webhook row is updated
    // when ANY of: shopDomain / isHeadless changes, OR a webhookSecret is given.
    if (shopDomain !== undefined || isHeadless !== undefined || webhookSecret !== undefined) {
      const webhooksPatch: Record<string, unknown> = { updated_at: new Date().toISOString() };
      if (shopDomain !== undefined) webhooksPatch.shop_domain = shopDomain;
      // Recompute allowed_origins only when the domain or headless state changed
      // (a webhookSecret-only PATCH must not disturb the existing origins).
      if (shopDomain !== undefined || isHeadless !== undefined) {
        // The effective domain after this edit (for allowed_origins recompute).
        const effectiveShopDomainForOrigins = shopDomain ?? (await readShopDomain(id)) ?? '';
        // Recompute allowed_origins from the AUTHORITATIVE headless state — the
        // body value if provided, else the store's stores.is_headless flag. NEVER
        // infer headless from whether allowed_origins is empty (a themed store can
        // legitimately have empty origins).
        const effectiveHeadless = isHeadless !== undefined ? isHeadless : existingStore.is_headless === true;
        webhooksPatch.allowed_origins = effectiveHeadless
          ? []
          : effectiveShopDomainForOrigins
            ? [`https://${effectiveShopDomainForOrigins}`]
            : [];
      }
      // Operator-entered webhook signing secret (independent of cred rotation).
      if (webhookSecret !== undefined) webhooksPatch.signing_secret = webhookSecret;
      const { error: whErr } = await admin.from('store_webhooks').update(webhooksPatch).eq('store_id', id);
      if (whErr) throw new Error(`store_webhooks update failed: ${whErr.message}`);
      if (shopDomain !== undefined && !updated.includes('shopDomain')) updated.push('shopDomain');
      if (webhookSecret !== undefined && !updated.includes('webhookSecret')) updated.push('webhookSecret');
    }

    // ----- 4. RETURN (secrets MASKED; never a raw value) -----
    return NextResponse.json(
      {
        ok: true,
        store: { storeId: id },
        updated: Array.from(new Set(updated)),
        secretsMasked,
      },
      { status: 200 },
    );
  } catch (err) {
    captureRouteError('operator/stores/[id]', err);
    const message = err instanceof Error ? err.message : String(err);
    console.error(`/api/operator/stores/${id} PATCH failed:`, message);
    return NextResponse.json(
      { error: 'עדכון החנות נכשל', code: 'store_update_failed' },
      { status: 500 },
    );
  }
}

// =============================================================================
// DELETE — hard, irreversible store wipe (Phase 6b T2).
//
// THE MOST DANGEROUS ROUTE IN THE PROJECT. It permanently removes a store and
// EVERY store-scoped row across the schema — there is no undo, no backup, no
// rollback. It is therefore DOUBLE-GATED and the wipe only runs once BOTH guards
// pass:
//
//   GUARD A (archived-only): the store MUST already be status='archived'. A live
//     store → 409 'archive the store before deleting it'. The 3 production stores
//     are 'active', so they are un-deletable until an operator explicitly
//     archives them first (the deliberate two-step: archive → delete).
//
//   GUARD B (typed-name confirm): the body's confirmName MUST EXACTLY equal the
//     store's name → else 400 'confirmation name does not match'. This mirrors the
//     reset route's typed-confirmation friction: a destructive call must be
//     deliberate (the operator hand-types the store name). Not a secret, so a
//     plain exact === is enough.
//
// Only after BOTH pass do we WIPE — FK-safe (children → config → `stores` LAST),
// every table from STORE_SCOPED_WIPE_TABLES. Best-effort per table: a delete that
// errors is logged + pushed to failed[] and we CONTINUE (the intent is "remove
// everything"; a single failed table is reported, not a rollback). `stores` is
// deleted LAST so a mid-wipe failure leaves the store row (operator retries)
// rather than orphaned data with no store.
//
// SECURITY: the response NEVER contains a secret — only ids and table names.
// =============================================================================
export async function DELETE(req: Request, ctx: RouteCtx): Promise<NextResponse> {
  const { id } = await ctx.params;

  let body: { confirmName?: unknown };
  try {
    body = (await req.json()) as { confirmName?: unknown };
  } catch {
    return NextResponse.json({ error: 'bad json' }, { status: 400 });
  }
  const confirmName = typeof body.confirmName === 'string' ? body.confirmName : null;

  // ----- 1. VALIDATE (delete nothing on failure) -----
  if ((RESERVED_STORE_IDS as readonly string[]).includes(id)) {
    return NextResponse.json({ error: 'storeId is reserved' }, { status: 400 });
  }

  const admin = getSupabaseAdmin();

  try {
    const { data: store, error: storeErr } = await admin
      .from('stores')
      .select('id, name, status')
      .eq('id', id)
      .maybeSingle();
    if (storeErr) throw new Error(storeErr.message);
    if (!store) {
      return NextResponse.json({ error: 'store not found' }, { status: 404 });
    }

    // ----- GUARD A: archived-only (409). The live 3 (active) are un-deletable
    // until explicitly archived. Checked BEFORE the name guard so an active store
    // is consistently told to archive first regardless of confirmName. -----
    if (store.status !== 'archived') {
      return NextResponse.json(
        { error: 'archive the store before deleting it', code: 'must_archive_first' },
        { status: 409 },
      );
    }

    // ----- GUARD B: typed-name confirm (400). Exact match — no write unless it
    // passes. -----
    if (confirmName !== String(store.name)) {
      return NextResponse.json(
        { error: 'confirmation name does not match', code: 'confirm_mismatch' },
        { status: 400 },
      );
    }

    // ===== 2. WIPE — both guards passed. FK-safe, children → parents, best-effort
    // per table (log + collect failures, continue). `stores` deleted LAST. =====
    const tablesWiped: string[] = [];
    const failed: string[] = [];
    for (const { table, keyCol } of STORE_SCOPED_WIPE_TABLES) {
      try {
        const { error } = await admin.from(table).delete().eq(keyCol, id);
        if (error) {
          console.error(`/api/operator/stores/${id} DELETE wipe ${table} failed:`, error.message);
          failed.push(table);
          continue;
        }
        tablesWiped.push(table);
      } catch (wipeErr) {
        const message = wipeErr instanceof Error ? wipeErr.message : String(wipeErr);
        console.error(`/api/operator/stores/${id} DELETE wipe ${table} threw:`, message);
        failed.push(table);
      }
    }

    // ----- 3. RETURN (ids + table names only — NEVER a secret). -----
    return NextResponse.json(
      { ok: true, deleted: id, tablesWiped, failed },
      { status: 200 },
    );
  } catch (err) {
    captureRouteError('operator/stores/[id]', err);
    const message = err instanceof Error ? err.message : String(err);
    console.error(`/api/operator/stores/${id} DELETE failed:`, message);
    return NextResponse.json(
      { error: 'מחיקת החנות נכשלה', code: 'store_delete_failed' },
      { status: 500 },
    );
  }
}
