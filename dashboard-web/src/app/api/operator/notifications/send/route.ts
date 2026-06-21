// dashboard-web/src/app/api/operator/notifications/send/route.ts
//
// Phase 05.7.4 — operator "Send WhatsApp now" trigger route.
//
// Inngest → Vercel Cron + QStash migration (Stage 3 Task 3.3): a "send now" is a
// single immediate action with NO fan-out, so this route now calls the shared
// send helper runWhatsappSlot(slot) INLINE instead of firing
// inngest.send('notifications/whatsapp.send-now'). This is the exact send path
// the old eventWhatsappSendNow function ran (noon/evening → today's snapshot,
// eod → yesterday full-day; the operator route's 'trigger' enum is identical to
// WhatsappSlot). The send completes within the request — it lets the operator
// verify Vercel env vars + Meta token + template approval before relying on the
// scheduled /api/cron/whatsapp triggers.
//
// Same storeId-style validation pattern as /api/operator/sync-now, just with the
// 'trigger' enum. We keep the 202 status for response-shape continuity with the
// sibling operator routes (the send is awaited, so any failure surfaces as 500).

import { NextResponse } from 'next/server';
import { runWhatsappSlot, type WhatsappSlot } from '@/inngest/functions/cronWhatsapp';
import { userFacingError } from '@/lib/apiErrors';
import { captureRouteError } from '@/lib/sentry/capture';

export const dynamic = 'force-dynamic';

type Payload = {
  trigger?: WhatsappSlot;
};

const VALID_TRIGGERS = new Set<WhatsappSlot>(['noon', 'evening', 'eod']);

function isSlot(v: unknown): v is WhatsappSlot {
  return v === 'noon' || v === 'evening' || v === 'eod';
}

export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => ({}))) as Payload;
    const trigger: WhatsappSlot = body.trigger ?? 'noon';
    if (!isSlot(trigger) || !VALID_TRIGGERS.has(trigger)) {
      return NextResponse.json(
        {
          error:
            "Invalid payload: 'trigger' must be one of 'noon' | 'evening' | 'eod'",
        },
        { status: 400 },
      );
    }

    // Single immediate send — the same path the 3 scheduled digests use.
    const result = await runWhatsappSlot(trigger);

    return NextResponse.json(
      {
        accepted: 1,
        trigger,
        result,
      },
      { status: 202 },
    );
  } catch (err) {
    captureRouteError('operator/notifications-send', err);
    const message = err instanceof Error ? err.message : String(err);
    console.error('/api/operator/notifications/send POST failed:', message);
    return NextResponse.json(
      { error: userFacingError(message) },
      { status: 500 },
    );
  }
}
