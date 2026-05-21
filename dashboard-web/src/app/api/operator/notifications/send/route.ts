// dashboard-web/src/app/api/operator/notifications/send/route.ts
//
// Phase 05.7.4 — operator "Send WhatsApp now" trigger route.
//
// Fires `notifications/whatsapp.send-now` for a single test send. The
// Inngest worker (cronWhatsapp.ts:eventWhatsappSendNow) picks it up and
// runs the same sendDailySummary path the 3 daily crons use. Allows the
// operator to verify Vercel env vars + Meta token + template approval
// before relying on the scheduled triggers.
//
// Same 202-async contract as /api/operator/sync-now. Same storeId
// validation pattern, just with the 'trigger' enum instead of storeId.

import { NextResponse } from 'next/server';
import { inngest } from '@/inngest/client';
import { userFacingError } from '@/lib/apiErrors';

export const dynamic = 'force-dynamic';

type Payload = {
  trigger?: 'noon' | 'evening' | 'eod';
};

const VALID_TRIGGERS = new Set<string>(['noon', 'evening', 'eod']);

export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => ({}))) as Payload;
    const trigger = body.trigger ?? 'noon';
    if (!VALID_TRIGGERS.has(trigger)) {
      return NextResponse.json(
        {
          error:
            "Invalid payload: 'trigger' must be one of 'noon' | 'evening' | 'eod'",
        },
        { status: 400 },
      );
    }

    const result = await inngest.send({
      name: 'notifications/whatsapp.send-now',
      data: { trigger },
    });

    return NextResponse.json(
      {
        accepted: result.ids.length,
        eventIds: result.ids,
        trigger,
      },
      { status: 202 },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('/api/operator/notifications/send POST failed:', message);
    return NextResponse.json(
      { error: userFacingError(message) },
      { status: 500 },
    );
  }
}
