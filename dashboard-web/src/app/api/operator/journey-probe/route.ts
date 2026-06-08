/**
 * Operator diagnostic probe — definitively reports per-store Shopify
 * `customerJourneySummary` access and UTM fill stats.
 *
 * GET /api/operator/journey-probe?store=<storeId>
 *
 * Forces `fetchCustomerJourney` with `enabled=true` (bypasses the per-store
 * DB flag) and runs it against up to 15 recent orders. Returns ONLY counts +
 * PII-free UTM labels — NEVER the Shopify access token, customer name/email,
 * order totals, or raw order ids beyond numeric ids already visible in GIDs.
 *
 * Operator-gated: lives under /api/operator/* so the middleware enforces the
 * operator secret. Soft-fails to a typed body (HTTP 200) on any query error,
 * matching the other operator panels.
 */

import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { getStoreSecret } from '@/lib/storeSecretsReader';
import { getShopifyAccessToken } from '@/lib/fetchers/shopifyAuth';
import { fetchCustomerJourney } from '@/lib/fetchers/shopifyCustomerJourney';
import { loadActiveStoreIds } from '@/lib/getStores';
import { captureRouteError } from '@/lib/sentry/capture';
import { userFacingError } from '@/lib/apiErrors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// ---------------------------------------------------------------------------
// Response shape
// ---------------------------------------------------------------------------

export interface JourneySample {
  orderId: string;
  firstUtmId: string | null;
  firstUtmCampaign: string | null;
  firstLandingPresent: boolean;
  lastUtmId: string | null;
}

export interface JourneyProbeResponse {
  store: string;
  /** True when Shopify returned journey data (access granted). */
  accessGranted?: boolean;
  /** True when Shopify ACCESS_DENIED → Protected Customer Data approval needed. */
  unavailable?: boolean;
  /** Should be false (we force enabled=true in the probe). */
  disabled?: boolean;
  ordersChecked?: number;
  /** How many of the checked orders Shopify returned journey data for. */
  ordersWithJourney?: number;
  sample?: JourneySample[];
  /** Present only on the error path. */
  error?: string;
}

// ---------------------------------------------------------------------------
// Route
// ---------------------------------------------------------------------------

export async function GET(req: Request): Promise<NextResponse<JourneyProbeResponse>> {
  const params = new URL(req.url).searchParams;
  const storeParam = params.get('store') ?? '';

  // Step 1: validate store ∈ active store ids.
  const activeStoreIds = await loadActiveStoreIds();
  if (!storeParam || !activeStoreIds.includes(storeParam)) {
    return NextResponse.json<JourneyProbeResponse>(
      {
        store: storeParam,
        error: `Invalid or missing store. Must be one of: ${activeStoreIds.join(', ')}`,
      },
      { status: 400 },
    );
  }

  const store = storeParam;

  try {
    // Step 2: resolve Shopify credentials.
    const domain = await getStoreSecret(store, 'SHOPIFY_DOMAIN');

    let token: string | null = null;
    try {
      token = await getShopifyAccessToken(store);
    } catch {
      // Missing creds — getShopifyAccessToken throws when any of the three
      // SHOPIFY_DOMAIN/CLIENT_ID/CLIENT_SECRET are absent.
    }

    if (!domain || !token) {
      return NextResponse.json<JourneyProbeResponse>(
        { store, error: 'missing shopify creds' },
        { status: 200 },
      );
    }

    // Step 3: fetch up to 15 most-recent order ids for the store.
    const sb = getSupabaseAdmin();
    const { data: rows, error: dbErr } = await sb
      .from('orders_attribution')
      .select('order_id')
      .eq('store_id', store)
      .order('date', { ascending: false })
      .limit(15);

    if (dbErr) {
      throw new Error(dbErr.message);
    }

    const orderRows = (rows ?? []) as Array<{ order_id: string | null }>;
    const gids = orderRows
      .map((r) => r.order_id)
      .filter((id): id is string => !!id)
      .map((id) => `gid://shopify/Order/${id}`);

    // Step 4: call the journey reader (forced enabled=true).
    const res = await fetchCustomerJourney(domain, token, gids, /* enabled */ true);

    // Step 5: build PII-free response.
    const sample: JourneySample[] = [...res.map.entries()].slice(0, 5).map(([orderId, e]) => ({
      orderId,
      firstUtmId: e.first?.utmId ?? null,
      firstUtmCampaign: e.first?.utmCampaign ?? null,
      firstLandingPresent: !!e.first?.landingPage,
      lastUtmId: e.last?.utmId ?? null,
    }));

    return NextResponse.json<JourneyProbeResponse>(
      {
        store,
        accessGranted: !res.unavailable,
        unavailable: res.unavailable,
        disabled: res.disabled,
        ordersChecked: gids.length,
        ordersWithJourney: res.map.size,
        sample,
      },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (e) {
    captureRouteError('operator/journey-probe', e);
    const rawMessage = e instanceof Error ? e.message : String(e);
    console.error('/api/operator/journey-probe GET threw:', rawMessage);
    return NextResponse.json<JourneyProbeResponse>(
      { store, error: userFacingError(rawMessage) },
      { status: 200, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}
