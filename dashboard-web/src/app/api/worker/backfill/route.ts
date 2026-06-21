// QStash worker route: operator backfill (Inngest → Vercel Cron + QStash
// migration, Stage 3 Task 3.2). Replaces the Inngest `event-backfill` function.
//
// Flow: verify the QStash signature → parse { from, to, storeIds } from the raw
// body → run the EXISTING runEventBackfill handler (the per-(date × store) loop
// lifted out of eventBackfill.ts, byte-identical) with an inline step ctx.
//
// Inline step ctx: QStash delivers this as ONE independent HTTP invocation (its
// own timeout + retry), so there is no durable Inngest `step` runtime. We pass a
// trivial step runner that executes each labelled callback inline — the
// runEventBackfill logic (date-range iteration, history-boundary validation,
// systemic-failure threshold, per-pair result matrix) is unchanged; only the
// durable-step memoization is dropped (every writer is ON CONFLICT idempotent
// and QStash retries the whole job).
//
// maxDuration=300: a multi-day × multi-store backfill is long; raise to the
// Vercel Pro ceiling.
//
// Auth: self-validating via the QStash signature (verifyQstashRequest); covered
// by isDashboardAuthAllowlisted's `/api/worker/*` rule (password gate skips it).

import { NextResponse } from 'next/server';
import { verifyQstashRequest } from '@/lib/jobs/verifyQstash';
import { runEventBackfill } from '@/inngest/functions/eventBackfill';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

// Inline step runner — runs each labelled callback immediately. Mirrors the
// loose StepRunner shape runEventBackfill's prefix shim consumes ({ run(id, cb) }).
const inlineStep = {
  run(_id: string, callback: () => Promise<unknown>): Promise<unknown> {
    return callback();
  },
};

type BackfillBody = {
  from?: unknown;
  to?: unknown;
  storeIds?: unknown;
};

export async function POST(req: Request): Promise<Response> {
  const v = await verifyQstashRequest(req);
  if (!v.ok) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  let body: BackfillBody;
  try {
    body = JSON.parse(v.raw) as BackfillBody;
  } catch {
    return NextResponse.json({ error: 'invalid body' }, { status: 400 });
  }

  // The operator route (/api/operator/backfill) already validated the payload
  // shape at the HTTP boundary before publishing; runEventBackfill re-validates
  // (history boundary / range / non-empty stores) as a defense-in-depth backstop.
  const result = await runEventBackfill({
    from: String(body.from),
    to: String(body.to),
    storeIds: (body.storeIds as Parameters<typeof runEventBackfill>[0]['storeIds']) ?? [],
    step: inlineStep,
  });

  return NextResponse.json({ ok: true, result }, { status: 200 });
}
