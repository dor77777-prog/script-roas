/**
 * Public twin of `/api/operator/status-events` for the Home `<ActivityFeed>`.
 *
 * The original Task 3.1 route lived under `/api/operator/*`, which is gated
 * by `OPERATOR_SECRET` (see `middleware.ts`). On a deployment with the
 * secret configured the Home tab — which has no operator auth — was getting
 * a 404 from the gate, surfacing the "טעינת פעילות אחרונה נכשלה." error
 * banner in <ActivityFeed>.
 *
 * Resolution: expose the same read under `/api/home/activity-events` so it
 * inherits the rest-of-dashboard trust posture (URL-obscurity, single-user,
 * no auth) while leaving the operator console copy untouched.
 *
 * The shape is the SAME `StatusEventsResponse` re-exported from the operator
 * route, so consumers can typecheck against either surface without dupli-
 * cating the interface.
 *
 * Soft-fail (mirrors the operator twin): on Supabase error we return HTTP
 * 200 with `{ events: [], error: '…' }` so the client renders a calm inline
 * message instead of throwing into the SWR fetcher.
 */

import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import {
  fetchStatusEvents,
  type StatusEventRow,
} from '@/lib/operator/registriesReaders';
import { userFacingError } from '@/lib/apiErrors';
import { captureRouteError } from '@/lib/sentry/capture';
import type { StatusEventsResponse } from '@/app/api/operator/status-events/route';

export const runtime = 'nodejs';
// 60s ISR window matches the operator twin — coalesces home polling across
// every open tab into one upstream Supabase round-trip on cache-cold.
export const revalidate = 60;

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
    // pushing a new SELECT-with-WHERE into the reader.
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
    captureRouteError('/api/home/activity-events', err);
    const rawMessage = err instanceof Error ? err.message : String(err);
    return NextResponse.json<StatusEventsResponse>(
      {
        events: [],
        lastUpdated,
        error: userFacingError(rawMessage),
      },
      { status: 200, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}
