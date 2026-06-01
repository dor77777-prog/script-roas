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
 *
 * ── Activity tab (additive, 2026-06-01) ──────────────────────────────────────
 * The same route ALSO powers the new "פעילות" tab's browseable, paginated table.
 * When the request carries a `page` param it switches to the PAGED shape
 * (`{ events, total, page, pageSize, serverNow }`) and honours `from`/`to`
 * (ISO dates; default = last 30 days), `store`, and `type`. WITHOUT a `page`
 * param the response keeps the EXACT legacy feed shape
 * (`{ events, serverNow, lastReceivedAt }`) so the Home <ActivityFeed> is
 * untouched. Both modes read via the service-role admin client and the route
 * stays password-gated (NOT allowlisted).
 */

import { NextResponse } from 'next/server';
import {
  readRecentStoreEvents,
  readStoreEventsPaged,
  type StoreEventRow,
} from '@/lib/webhooks/store';
import type { StoreEventType } from '@/lib/webhooks/normalizeShopifyEvent';
import { getTodayInIsraelTz } from '@/lib/dateRange';
import { captureRouteError } from '@/lib/sentry/capture';

// nodejs: the reader uses the service-role admin client (server-only).
export const runtime = 'nodejs';
// force-dynamic: this is a real-time feed; we never want a stale ISR copy
// served between the SWR client's 12s polls — each poll must reflect the
// newest events. (SWR's own dedupe + the 12s interval keep upstream cheap.)
export const dynamic = 'force-dynamic';

const MAX_LIMIT = 50;
// Activity-tab default window + pagination knobs.
const DEFAULT_WINDOW_DAYS = 30;
const DEFAULT_PAGE_SIZE = 40;
const MAX_PAGE_SIZE = 100;

const ISO_DATE_RX = /^\d{4}-\d{2}-\d{2}$/;
const EVENT_TYPES: ReadonlySet<string> = new Set(['sale', 'refund', 'add_to_cart']);

/** Legacy real-time feed shape — unchanged so the Home feed is back-compat. */
export interface StoreEventsResponse {
  events: StoreEventRow[];
  serverNow: string;
  lastReceivedAt: string | null;
}

/** Paged shape — returned only when a `page` param is present. */
export interface StoreEventsPagedResponse {
  events: StoreEventRow[];
  total: number;
  page: number;
  pageSize: number;
  serverNow: string;
}

/** ISO calendar date `nDays` before `dateIso` (both 'YYYY-MM-DD'). */
function isoDaysBefore(dateIso: string, nDays: number): string {
  const d = new Date(`${dateIso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - nDays);
  return d.toISOString().slice(0, 10);
}

export async function GET(
  req: Request,
): Promise<NextResponse<StoreEventsResponse | StoreEventsPagedResponse>> {
  const serverNow = new Date().toISOString();
  const url = new URL(req.url);
  const params = url.searchParams;

  const storeParam = params.get('store');
  // 'All' / empty → no filter (matches the Home tab's store-filter contract,
  // which already maps store === 'All' → undefined before it reaches here, but
  // we re-collapse 'All' defensively in case the param is hit directly).
  const storeId = storeParam && storeParam !== 'All' ? storeParam : undefined;

  // ── PAGED mode (Activity tab) — engaged only when `page` is present. ──────
  const pageParam = params.get('page');
  if (pageParam !== null) {
    try {
      const parsedPage = Number.parseInt(pageParam, 10);
      const page = Number.isFinite(parsedPage) && parsedPage > 0 ? parsedPage : 1;

      const parsedSize = Number.parseInt(params.get('pageSize') ?? '', 10);
      const pageSize =
        Number.isFinite(parsedSize) && parsedSize > 0
          ? Math.min(parsedSize, MAX_PAGE_SIZE)
          : DEFAULT_PAGE_SIZE;

      // Window: default = last 30 days (in IL time). Each bound is honoured
      // only when it's a valid YYYY-MM-DD; otherwise it falls back to the
      // default so a malformed param can never blow up the query.
      const today = getTodayInIsraelTz();
      const toParam = params.get('to');
      const fromParam = params.get('from');
      const to = toParam && ISO_DATE_RX.test(toParam) ? toParam : today;
      const from =
        fromParam && ISO_DATE_RX.test(fromParam)
          ? fromParam
          : isoDaysBefore(to, DEFAULT_WINDOW_DAYS);

      // Type: omit / 'all' / unknown → no filter.
      const typeParam = params.get('type');
      const type =
        typeParam && typeParam !== 'all' && EVENT_TYPES.has(typeParam)
          ? (typeParam as StoreEventType)
          : undefined;

      const { events, total } = await readStoreEventsPaged({
        from,
        to,
        storeId,
        type,
        page,
        pageSize,
      });

      return NextResponse.json<StoreEventsPagedResponse>(
        { events, total, page, pageSize, serverNow },
        { headers: { 'Cache-Control': 'no-store' } },
      );
    } catch (err) {
      captureRouteError('/api/store-events', err);
      // Soft-fail: empty page at 200 so the tab renders its empty state.
      return NextResponse.json<StoreEventsPagedResponse>(
        { events: [], total: 0, page: 1, pageSize: DEFAULT_PAGE_SIZE, serverNow },
        { status: 200, headers: { 'Cache-Control': 'no-store' } },
      );
    }
  }

  // ── LEGACY feed mode (Home <ActivityFeed>) — shape unchanged. ────────────
  try {
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
