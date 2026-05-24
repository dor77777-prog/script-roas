// dashboard-web/src/app/api/operator/jobs/route.ts
//
// Server-side proxy for the operator console's "ריצות אחרונות" jobs table.
// JobsTable (client component) polls this endpoint every 15s via SWR; this
// route then forwards to Inngest REST v1 using the Bearer-style signing
// key, aggregates events → runs, and returns sanitized JSON.
//
// SECURITY (T-05.6-13-I1, V8):
//   `INNGEST_SIGNING_KEY` is read ONLY here on the server. It is never
//   sent to the browser and never embedded in any client surface. The
//   pre-merge grep gate enforces this: any literal mention of
//   `INNGEST_SIGNING_KEY` in `dashboard-web/src/components/` or
//   `dashboard-web/src/app/operator/*.tsx` is a build-blocker (see
//   05.6-13-PLAN.md <threat_model>).
//
// Why HTTP 200 on every error path (S-2 soft-fail, mirrors
// /api/dashboard-state and /api/store-meta):
//   The client renders the response as a table — a 4xx/5xx would throw
//   in the SWR fetcher and force the UI into a hard-error state. Instead
//   we return `{ runs: [], error: '...', lastUpdated }` so the UI can
//   surface the sanitized Hebrew message inline. Raw upstream error text
//   is logged server-side via `console.error` for ops triage.
//
// Why `revalidate = 5` literal (Pitfall 12):
//   Next.js's static analyzer rejects `revalidate = CACHE_CONFIG.X.revalidate`
//   as a MemberExpression. The literal `5` must mirror
//   CACHE_CONFIG.operatorJobs.revalidate manually. If the two ever
//   diverge, the cacheControl() header still produces the canonical
//   s-maxage, but the ISR window would drift — keep the sync comment in
//   place and bump both together if revisiting.
//
// Why NO forced-dynamic export (Pitfall 11):
//   `revalidate` and the forced-dynamic directive conflict; the
//   dynamic flag silently wins and blows away the explicit
//   Cache-Control header below. This route is GET-only with no
//   mutating side effects, so `revalidate` is the correct single
//   directive. (See dashboard-state/route.ts for the same comment style.)
//
// Why N+1 fan-out (RESEARCH §Pattern 6, Approach 1):
//   Inngest REST v1 has no `/v1/runs?function_id=...` list endpoint —
//   the OpenAPI spec only exposes `/v1/events` for listing and
//   `/v1/events/{internalID}/runs` for per-event runs. We fetch events
//   first, then iterate. Cap at 50 events to avoid quota burn under
//   pathological polling loads (the threat-model mitigation for
//   T-05.6-13-D3 — CDN coalescing handles the per-tab side of the same
//   concern).
//
// Why 24h `received_after` window:
//   Matches the operator's mental model — "show me what ran today". A
//   24h window also bounds the N+1 fan-out cost: with the current
//   3-store × cron-daily + cron-live every 15min schedule, that's at
//   most 3×96 + 3 = 291 events/day. The `limit` query param caps the
//   actual fetch further (default 50). A future plan that needs longer
//   history can add a `since` param.

import { NextResponse } from 'next/server';
import { cacheControl } from '@/lib/cacheConfig';
import { userFacingError } from '@/lib/apiErrors';

// Literal mirror of CACHE_CONFIG.operatorJobs.revalidate (5). Next.js's
// static analyzer rejects MemberExpression here per Pitfall 12 — if
// you change CACHE_CONFIG.operatorJobs.revalidate, bump this literal too.
export const revalidate = 5;

// Inngest REST v1 response shapes — narrowed to the fields we actually
// use. The full spec lives at https://api-docs.inngest.com/api-specs/v1.json
// and exposes more keys (function_version, environment_id, batch_id,
// original_run_id, cron, ...) which we intentionally do NOT forward to
// the browser to keep the wire payload tight.
type InngestRun = {
  run_id: string;
  run_started_at: string;
  ended_at: string | null;
  status: 'Running' | 'Completed' | 'Failed' | 'Cancelled';
  function_id: string;
  event_id: string | null;
  output?: unknown;
};

type InngestEvent = {
  internal_id: string;
  name: string;
  received_at: string;
};

// Hard cap on per-request event fan-out. The Inngest REST v1 spec
// accepts limit=1..100 on /v1/events, but we clamp to 50 (the default)
// to keep the per-request HTTP fan-out predictable: 50 events × 1 runs
// request each = 51 upstream calls in the worst case. Anything beyond
// that should trigger pagination via cursor rather than raise the cap.
const MAX_LIMIT = 50;

// 24h lookback window for the events list. Bounds the N+1 fan-out and
// matches the operator's "today's runs" mental model.
const LOOKBACK_MS = 24 * 60 * 60 * 1000;

export async function GET(req: Request) {
  const key = process.env.INNGEST_SIGNING_KEY;
  if (!key) {
    // Pre-flight env check returns the soft-fail shape so the client UI
    // surfaces the configuration issue inline rather than crashing. The
    // amber-banner Hebrew copy comes from userFacingError when called
    // on the same string elsewhere; here we hard-code the message
    // because the operator needs to know specifically that the env var
    // is missing (not a generic "load failed").
    return NextResponse.json(
      {
        runs: [],
        error: 'הטעינה נכשלה: משתני סביבה חסרים.',
        lastUpdated: new Date().toISOString(),
      },
      { status: 200, headers: { 'Cache-Control': cacheControl('operatorJobs') } },
    );
  }

  // Clamp limit to [1, MAX_LIMIT]. NaN (non-numeric ?limit=) falls back
  // to MAX_LIMIT. Negative values are ignored. This mitigates
  // T-05.6-13-T2 (query-param tampering) — even though we accept the
  // URL-obscurity trust model for the operator console (D-D2), a
  // pathological ?limit=10000 would otherwise blow up the fan-out.
  const rawLimit = parseInt(new URL(req.url).searchParams.get('limit') ?? '', 10);
  const limit = Number.isFinite(rawLimit) && rawLimit > 0
    ? Math.min(rawLimit, MAX_LIMIT)
    : MAX_LIMIT;

  try {
    // 1) List recent events. The OpenAPI spec confirms `received_after`,
    //    `received_before`, `name`, `limit`, `cursor` as query params on
    //    /v1/events. The signing-key Bearer auth is the same scheme
    //    `your-signing-key` the SDK already uses for /api/inngest serve().
    const since = new Date(Date.now() - LOOKBACK_MS).toISOString();
    const evRes = await fetch(
      `https://api.inngest.com/v1/events?received_after=${encodeURIComponent(since)}&limit=${limit}`,
      { headers: { Authorization: `Bearer ${key}` } },
    );
    if (!evRes.ok) {
      throw new Error(`Inngest events list ${evRes.status}: ${await evRes.text()}`);
    }
    const evBody = (await evRes.json()) as { data: InngestEvent[] };

    // 2) Fan-out for runs. Cap at MAX_LIMIT defensively even though the
    //    upstream `limit` already enforces it — the cap protects against
    //    a malformed Inngest response that returns more items than
    //    requested. We continue on individual fetch failures so a single
    //    sick event doesn't blank the entire table; failed events just
    //    contribute zero rows.
    //
    // AUDIT API-23 (2026-05-24, Phase 12.3): parallel fan-out via
    // Promise.allSettled. Pre-fix: sequential for-await loop took ~50 ×
    // 200ms = 10s p50 on a full 50-event window — close to the SWR
    // poll cycle (15s) so the cache often missed the rebuild and the
    // "live jobs" panel felt laggy. Post-fix: 50 concurrent /v1/events/{id}/runs
    // requests; wall-clock drops to ~200ms = max(per-call latency).
    // Per-event isolation preserved — a single 401 / non-ok still logs +
    // contributes zero rows, matching the pre-fix swallow semantics.
    // NO concurrency cap added in 12.3 since MAX_LIMIT=50 is already the
    // upper bound and Inngest REST is not known to rate-limit at 50
    // concurrent. If future production telemetry shows 429s from the
    // fan-out, a follow-up phase can add a p-limit batcher.
    // Evidence: .planning/phases/12-codebase-audit-baseline/raw-returns/
    //   api_operator_jobs.json (API-23).
    const events = (evBody.data ?? []).slice(0, MAX_LIMIT);
    const fanoutResults = await Promise.allSettled(
      events.map(async (ev) => {
        const r = await fetch(
          `https://api.inngest.com/v1/events/${ev.internal_id}/runs`,
          { headers: { Authorization: `Bearer ${key}` } },
        );
        if (!r.ok) {
          // Swallow per-event failures — log to ops, skip to next event.
          // The threat-model mitigation T-05.6-13-I4 also applies: do NOT
          // bubble the raw upstream error string to the client.
          console.error(
            `Inngest events/${ev.internal_id}/runs failed:`,
            r.status,
            await r.text().catch(() => '<unreadable>'),
          );
          return { event_name: ev.name, runs: [] as InngestRun[] };
        }
        const rb = (await r.json()) as { data: InngestRun[] };
        return { event_name: ev.name, runs: rb.data ?? [] };
      }),
    );
    const runs: Array<InngestRun & { event_name?: string }> = [];
    for (const result of fanoutResults) {
      if (result.status === 'fulfilled') {
        for (const run of result.value.runs) {
          runs.push({ ...run, event_name: result.value.event_name });
        }
      } else {
        // Rejected promise (network throw, not an HTTP non-ok response).
        // Log + skip; matches the pre-fix per-event isolation semantics.
        console.error('Inngest fan-out promise rejected:', result.reason);
      }
    }

    // Sort newest first by run_started_at. localeCompare on RFC3339
    // strings is correct lexicographic ordering — these timestamps are
    // always UTC-Z normalized by Inngest so no timezone drift.
    runs.sort((a, b) => b.run_started_at.localeCompare(a.run_started_at));
    return NextResponse.json(
      { runs, lastUpdated: new Date().toISOString() },
      { headers: { 'Cache-Control': cacheControl('operatorJobs') } },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // Log raw server-side for ops; userFacingError() sanitizes for the
    // client. Without sanitization, an Inngest 401/403 error message
    // could embed the signing-key fingerprint or workspace URL into
    // the wire payload visible in the browser network tab.
    console.error('Inngest jobs proxy failed:', message);
    return NextResponse.json(
      {
        runs: [],
        error: userFacingError(message),
        lastUpdated: new Date().toISOString(),
      },
      { status: 200, headers: { 'Cache-Control': cacheControl('operatorJobs') } },
    );
  }
}
