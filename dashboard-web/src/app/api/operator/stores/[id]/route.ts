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
//        domain if changed, else the existing one). If ANY fails → 400 with
//        { verification } and WRITE NOTHING.
//     3. ONLY after all verifications pass → re-encrypt + UPSERT the rotated
//        platforms' secrets, upsert store_ad_state + set the stores flag when a
//        platform is newly ADDED, update `stores` basics, update store_webhooks.
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
import { getStoreSecret, RESERVED_STORE_IDS } from '@/lib/storeSecretsReader';
import { captureRouteError } from '@/lib/sentry/capture';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Same strict single-label *.myshopify.com host the add route enforces.
const SHOP_DOMAIN_RE = /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/;

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
}

type RouteCtx = { params: Promise<{ id: string }> };

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

// =============================================================================
// GET — basics only (edit prefill). NO secrets.
// =============================================================================
export async function GET(_req: Request, ctx: RouteCtx): Promise<NextResponse> {
  const { id } = await ctx.params;
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

    const platforms = await configuredPlatforms(id);
    const shopDomain = await readShopDomain(id);

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

  // Reject an empty body (nothing to do).
  const hasBasics = name !== undefined || shopDomain !== undefined || brandColor !== undefined
    || isHeadless !== undefined || hasTiktok !== undefined || displayOrder !== undefined;
  const hasCreds = !!shopify || !!meta || !!google;
  if (!hasBasics && !hasCreds) {
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
      .select('id')
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
    // Shopify is verified against the NEW domain if provided, else the existing
    // one (read from store_webhooks; getStoreSecret SHOPIFY_DOMAIN as fallback).
    let effectiveShopDomain: string | null = shopDomain ?? null;
    if (shopify && effectiveShopDomain === null) {
      effectiveShopDomain = (await readShopDomain(id)) ?? (await getStoreSecret(id, 'SHOPIFY_DOMAIN'));
    }

    const verification: { shopify?: string; meta?: string; google?: string } = {};
    if (shopify) {
      const s = await verifyShopify({
        domain: effectiveShopDomain ?? '',
        clientId: shopify.clientId,
        clientSecret: shopify.clientSecret,
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
    if (shopify) {
      if (shopDomain !== undefined) await upsertSecret(id, 'SHOPIFY_DOMAIN', shopDomain);
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

    // --- store_webhooks (shop_domain / allowed_origins) ---
    if (shopDomain !== undefined || isHeadless !== undefined) {
      const webhooksPatch: Record<string, unknown> = { updated_at: new Date().toISOString() };
      // The effective domain after this edit (for allowed_origins recompute).
      const domainForOrigins = shopDomain ?? (await readShopDomain(id)) ?? '';
      if (shopDomain !== undefined) webhooksPatch.shop_domain = shopDomain;
      if (shopDomain !== undefined || isHeadless !== undefined) {
        const headlessNow = isHeadless ?? false;
        // When isHeadless was not provided we still recompute origins only if the
        // domain changed; otherwise we must preserve the prior headless state. To
        // avoid clobbering, only set allowed_origins when we know the headless
        // intent OR the domain changed.
        if (isHeadless !== undefined) {
          webhooksPatch.allowed_origins = headlessNow ? [] : domainForOrigins ? [`https://${domainForOrigins}`] : [];
        } else if (shopDomain !== undefined) {
          // Domain changed but headless unchanged — recompute origins from the
          // store's current headless state.
          const { data: whRow } = await admin
            .from('store_webhooks')
            .select('allowed_origins')
            .eq('store_id', id)
            .maybeSingle();
          const wasHeadless = Array.isArray(whRow?.allowed_origins) && whRow!.allowed_origins.length === 0;
          webhooksPatch.allowed_origins = wasHeadless ? [] : domainForOrigins ? [`https://${domainForOrigins}`] : [];
        }
      }
      if (shopify) webhooksPatch.signing_secret = shopify.clientSecret;
      const { error: whErr } = await admin.from('store_webhooks').update(webhooksPatch).eq('store_id', id);
      if (whErr) throw new Error(`store_webhooks update failed: ${whErr.message}`);
      if (shopDomain !== undefined && !updated.includes('shopDomain')) updated.push('shopDomain');
    } else if (shopify) {
      // Shopify rotated without a domain/headless change → still refresh the
      // webhook signing_secret to match the new app secret.
      const { error: whErr } = await admin
        .from('store_webhooks')
        .update({ signing_secret: shopify.clientSecret, updated_at: new Date().toISOString() })
        .eq('store_id', id);
      if (whErr) throw new Error(`store_webhooks update failed: ${whErr.message}`);
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
