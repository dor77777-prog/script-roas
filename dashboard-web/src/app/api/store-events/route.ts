/**
 * Phase 3, Task B — GET /api/store-events (read).
 *
 * Powers the Home <ActivityFeed>'s real-time poll. Returns the latest 50
 * `store_events` rows (newest-first) plus a server clock + the newest row's
 * `received_at` so the client can compute the LIVE-badge freshness WITHOUT
 * clock skew (we never trust the browser clock for "how long since the last
 * event").
 *
 * Auth: behind the normal dashboard password gate (NOT in the
 * `isDashboardAuthAllowlisted` set — unlike the HMAC/token-authenticated
 * ingest endpoints `/api/webhooks/shopify` + `/api/events/cart`). A
 * guard test (storeEventsRouteGuard) pins both facts.
 *
 * Data path: reads via the service-role admin client through
 * `readRecentStoreEvents` — `store_events` has NO anon grant by design
 * (it's written only by the service-role ingest paths), so the read must use
 * the admin client just like the rest of the dashboard's server reads.
 *
 * Soft-fail: on any reader error we still return HTTP 200 with an empty feed
 * (`events: []`, `lastReceivedAt: null`). SWR then surfaces a calm idle/empty
 * state rather than the disconnected ("נותק") state, which is reserved for an
 * actual transport error (a non-200 / network failure on the route itself).
 */

import { NextResponse } from 'next/server';
import { readRecentStoreEvents, type StoreEventRow } from '@/lib/webhooks/store';
import { captureRouteError } from '@/lib/sentry/capture';

// nodejs: the reader uses the service-role admin client (server-only).
export const runtime = 'nodejs';
// force-dynamic: this is a real-time feed; we never want a stale ISR copy
// served between the SWR client's 12s polls — each poll must reflect the
// newest events. (SWR's own dedupe + the 12s interval keep upstream cheap.)
export const dynamic = 'force-dynamic';

const MAX_LIMIT = 50;

export interface StoreEventsResponse {
  events: StoreEventRow[];
  serverNow: string;
  lastReceivedAt: string | null;
}

export async function GET(req: Request): Promise<NextResponse<StoreEventsResponse>> {
  const serverNow = new Date().toISOString();
  try {
    const url = new URL(req.url);
    const storeParam = url.searchParams.get('store');
    // 'All' / empty → no filter (matches the Home tab's store-filter contract,
    // which already maps store === 'All' → undefined before it reaches here, but
    // we re-collapse 'All' defensively in case the param is hit directly).
    const storeId = storeParam && storeParam !== 'All' ? storeParam : undefined;

    const events = await readRecentStoreEvents({ limit: MAX_LIMIT, storeId });
    // Rows are newest-first (received_at DESC) → [0] is the freshest.
    const lastReceivedAt = events.length > 0 ? events[0].received_at : null;

    return NextResponse.json<StoreEventsResponse>(
      { events, serverNow, lastReceivedAt },
      {
        headers: {
          // Real-time feed: never cache. The client owns the cadence.
          'Cache-Control': 'no-store',
        },
      },
    );
  } catch (err) {
    captureRouteError('/api/store-events', err);
    // Soft-fail: empty feed at 200 so the client renders the idle state.
    return NextResponse.json<StoreEventsResponse>(
      { events: [], serverNow, lastReceivedAt: null },
      { status: 200, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}
