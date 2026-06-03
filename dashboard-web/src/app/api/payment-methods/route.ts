import { NextResponse } from 'next/server';
import type { PaymentMethodsByMonth } from '@/lib/postgresReaders';
import { readPaymentMethodsByMonth } from '@/lib/postgresReaders';
import { cacheControl } from '@/lib/cacheConfig';
import { userFacingError } from '@/lib/apiErrors';
import { captureRouteError } from '@/lib/sentry/capture';

// 60-second cache. תשלומים (2026-06-03) — the payment-method aggregate sources
// orders_attribution (via readPaymentMethodsByMonth), the same table cron-live
// writes today's orders into every ~10 min, so it refreshes in lock-step with
// /api/orders-attribution (also 60s) rather than lagging minutes behind.
export const revalidate = 60; // matches CACHE_CONFIG.paymentMethods.revalidate; literal required by Next.js

export type PaymentMethodsResponse = PaymentMethodsByMonth & {
  lastUpdated: string;
  /** Present only on the degraded-error path (months: []). Consumers that
   *  surface "synced N min ago" should treat the response as data-less when
   *  this is set, even though months + lastUpdated still satisfy the type. */
  error?: string;
};

export async function GET() {
  // API contract note (תשלומים, 2026-06-03):
  // No ?store= / ?from=&to= params are parsed here. This route returns the FULL
  // per-month × store × gateway-category aggregate; the client
  // (PaymentMethodsTab) switches scope (business / per-store) over the dataset
  // it already holds — the same contract as /api/cohorts and
  // /api/orders-attribution. Behind the dashboard auth gate by default (no
  // isDashboardAuthAllowlisted entry — this is an internal GET, never called
  // by an external service).
  try {
    const result = await readPaymentMethodsByMonth();
    return NextResponse.json(
      { ...result, lastUpdated: new Date().toISOString() } satisfies PaymentMethodsResponse,
      {
        headers: {
          'Cache-Control': cacheControl('paymentMethods'),
        },
      },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // Raw message logged server-side for ops; sanitized message returned to client.
    captureRouteError('payment-methods', err);
    console.error('payment-methods fetch failed:', message);
    // Degrade gracefully — empty months lets the תשלומים tab render its
    // empty/low-data state instead of breaking. lastUpdated is included so the
    // response shape satisfies the declared type — a consumer reading
    // `data.lastUpdated` on the error path gets a valid ISO timestamp instead
    // of `undefined` (which would crash downstream Date()/formatDate).
    // Cache-Control: no-store — without it, the route-level `revalidate = 60`
    // would pin a transient upstream blip in the CDN for a minute.
    return NextResponse.json(
      {
        months: [],
        lastUpdated: new Date().toISOString(),
        error: userFacingError(message),
      } satisfies PaymentMethodsResponse,
      { status: 200, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}
