// dashboard-web/src/app/api/operator/backfill/route.ts
//
// Phase 05.6 Plan 14 — operator backfill trigger route.
//
// Accepts {from, to, storeIds[]} from the BackfillPicker UI, validates the
// payload, and fires a single `event/backfill` Inngest event. Returns 202
// Accepted with the event id and echo of the validated range/store list so
// the client can render a "Backfill enqueued" confirmation. The actual
// per-(date × store) iteration happens inside eventBackfill.ts (plan 10);
// this route is just a thin validate-and-enqueue layer.
//
// === Why server-side validation (in addition to client-side) ===
//
// Threat T-05.6-14-T1 (Tampering): the BackfillPicker's `<input min=…>`
// is a UX hint; a curl-ed POST or a tampered-DOM submission can ship
// any string. The server is the security boundary — the eventBackfill
// worker itself also throws on `from < HISTORY_BOUNDARY` (defense in
// depth), but rejecting at the HTTP boundary returns a 400 immediately
// instead of charging the operator an Inngest exec just to dead-letter.
//
// === Why a single inngest.send (not one per date × store) ===
//
// eventBackfill.ts implements the per-pair loop with W6 step-prefix
// shimming (see eventBackfill.ts:159-164). Fanning out at the API layer
// would lose that shared step-graph structure in the Inngest jobs table —
// the operator would see N independent runs instead of one backfill row
// with N internal steps. Plan 13's JobsTable filter UX is built around
// the latter shape.
//
// === Why force-dynamic, no revalidate ===
//
// Same rationale as the sibling sync-now route — POST handler, no
// cacheable GET response, force-dynamic is the correct single declaration
// (Pitfall 11).
//
// === HISTORY_BOUNDARY duplication ===
//
// The same '2026-05-01' literal also lives in eventBackfill.ts:111 and
// BackfillPicker.tsx. Three copies are deliberate, NOT a DRY violation:
//   - eventBackfill.ts owns the worker-side contract (final defense)
//   - this route owns the HTTP-boundary contract (fast 400)
//   - BackfillPicker owns the UX hint (disabled submit + input min)
// Centralising in a shared module would create an import edge from the
// client bundle → server-only module; the cost of three string copies
// is lower than the cost of that import boundary. If the boundary date
// ever moves, the SUMMARY for that change must update all three.

import { NextResponse } from 'next/server';
import { inngest } from '@/inngest/client';
import { userFacingError } from '@/lib/apiErrors';

export const dynamic = 'force-dynamic';

const ALL_STORES = ['uzoshop', 'zolplus', 'usmile360'] as const;
const VALID_STORES = new Set<string>(ALL_STORES);

// D-A3 history boundary. Phase 05.5-20 seeded Supabase rows starting at
// 2026-05-01; backfill requests for older dates would hit upstream APIs
// that return nothing in the format we expect. Mirrors the literal in
// eventBackfill.ts:111 (see file-level comment above for why duplicated).
const HISTORY_BOUNDARY = '2026-05-01';

type Payload = {
  from: string; // YYYY-MM-DD inclusive
  to: string; // YYYY-MM-DD inclusive
  storeIds: string[];
};

/**
 * Strict YYYY-MM-DD shape check. We do NOT parse with `new Date(s)`
 * because that accepts a much wider grammar (ISO timestamps, RFC 2822,
 * etc.) and we want exact calendar-day strings — they flow into
 * eventBackfill.ts's dateRange() generator unchanged and into Supabase
 * DATE columns downstream. A "2026-13-99" passes Date but is nonsense;
 * the regex rejects it without requiring extra range guards.
 */
function isDate(s: unknown): s is string {
  return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as Payload;

    // Shape validation — exact YYYY-MM-DD strings.
    if (!isDate(body.from) || !isDate(body.to)) {
      return NextResponse.json(
        { error: 'from and to must be YYYY-MM-DD strings' },
        { status: 400 },
      );
    }

    // History boundary — T-05.6-14-T1 mitigation. Lex compare works
    // because YYYY-MM-DD strings are lexicographically ordered iff they
    // are chronologically ordered (the regex above guarantees the shape).
    if (body.from < HISTORY_BOUNDARY) {
      return NextResponse.json(
        {
          error: `from=${body.from} predates D-A3 history boundary ${HISTORY_BOUNDARY}`,
        },
        { status: 400 },
      );
    }

    // Range orientation. Same lex-compare safety as above.
    if (body.from > body.to) {
      return NextResponse.json(
        { error: `from=${body.from} > to=${body.to}` },
        { status: 400 },
      );
    }

    // Store list — non-empty and every element in allowlist.
    // T-05.6-14-T3 (Tampering) mitigation.
    if (!Array.isArray(body.storeIds) || body.storeIds.length === 0) {
      return NextResponse.json(
        { error: 'storeIds must be a non-empty array' },
        { status: 400 },
      );
    }
    const invalid = body.storeIds.find(
      (s) => typeof s !== 'string' || !VALID_STORES.has(s),
    );
    if (invalid !== undefined) {
      return NextResponse.json(
        { error: `Invalid storeId: ${String(invalid)}` },
        { status: 400 },
      );
    }

    const result = await inngest.send({
      name: 'event/backfill',
      data: {
        from: body.from,
        to: body.to,
        storeIds: body.storeIds,
      },
    });

    // Echo the validated range + storeIds so the client doesn't have to
    // re-parse its own request body to render the confirmation. The
    // `accepted` field is the count of Inngest events (always 1 for
    // backfill — fan-out happens inside the worker via the (date, store)
    // loop) for symmetry with sync-now's `accepted` shape.
    return NextResponse.json(
      {
        accepted: result.ids.length,
        eventIds: result.ids,
        range: { from: body.from, to: body.to },
        storeIds: body.storeIds,
      },
      { status: 202 },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // Threat T-05.6-14-I4 mitigation — never leak raw inngest.send
    // errors (could embed event-key fragments in network exceptions).
    console.error('/api/operator/backfill POST failed:', message);
    return NextResponse.json(
      { error: userFacingError(message) },
      { status: 500 },
    );
  }
}
