/**
 * Task 3.1 (UI/UX overhaul) — status-events feed for the Home <ActivityFeed>.
 *
 * GET /api/operator/status-events
 *   Returns the latest N entries from `campaign_status_events`, optionally
 *   filtered to a single store (?store=uzoshop). The Home <ActivityFeed>
 *   component polls this every 60s via SWR to render the live "recent
 *   activity" panel that sits next to <InsightsBoard>.
 *
 * The pre-existing `<StatusEventsFeed>` is a SERVER component that hits
 * Supabase directly; the Home tab is a client component (filter changes
 * locally), so we need an HTTP shim. This route is that shim — the same
 * `fetchStatusEvents` reader powers both surfaces, so the operator
 * console and the Home feed always agree on what events look like.
 *
 * Security: identical posture to the rest of /api/operator/* — URL-obscurity
 * trust model, no auth, `SUPABASE_SERVICE_ROLE_KEY` stays server-side.
 *
 * Soft-fail (mirrors operator/token-failures pattern): on Supabase error
 * we return HTTP 200 with `{ events: [], error: '…' }` so the client
 * renders a calm inline message instead of throwing into the SWR fetcher
 * and forcing a hard-error state on a non-blocking secondary surface.
 */

import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import {
  fetchStatusEvents,
  type StatusEventRow,
} from '@/lib/operator/registriesReaders';
import { userFacingError } from '@/lib/apiErrors';
import { captureRouteError } from '@/lib/sentry/capture';

export const runtime = 'nodejs';
// 60s ISR window matches the home polling interval — coalesces many tabs
// into one upstream Supabase round-trip on cache-cold; warm tabs still get
// the CDN'd response immediately.
export const revalidate = 60;

export interface StatusEventsResponse {
  events: StatusEventRow[];
  lastUpdated: string;
  error?: string;
}

const MAX_LIMIT = 50;

export async function GET(req: Request) {
  const lastUpdated = new Date().toISOString();
  try {
    const url = new URL(req.url);
    const store = url.searchParams.get('store') ?? undefined;
    const platform = url.searchParams.get('platform') ?? undefined;
    const all = await fetchStatusEvents(getSupabaseAdmin());

    // In-memory filter so the Home tab can show "events affecting current
    // scope". Cheap (≤50 rows already capped server-side) and avoids
    // pushing a new SELECT-with-WHERE into the reader, which the
    // /operator console doesn't need.
    let filtered: StatusEventRow[] = all;
    if (store && store !== 'All') {
      filtered = filtered.filter((e) => e.store_id === store);
    }
    if (platform && platform !== 'all') {
      filtered = filtered.filter((e) => e.platform === platform);
    }
    filtered = filtered.slice(0, MAX_LIMIT);

    return NextResponse.json<StatusEventsResponse>(
      { events: filtered, lastUpdated },
      {
        headers: {
          'Cache-Control': `public, s-maxage=${revalidate}, stale-while-revalidate=120`,
        },
      },
    );
  } catch (err) {
    captureRouteError('/api/operator/status-events', err);
    const rawMessage = err instanceof Error ? err.message : String(err);
    return NextResponse.json<StatusEventsResponse>(
      {
        events: [],
        lastUpdated,
        error: userFacingError(rawMessage),
      },
      { status: 200 },
    );
  }
}
