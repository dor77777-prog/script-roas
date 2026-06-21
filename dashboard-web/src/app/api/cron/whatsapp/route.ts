// Vercel Cron route: daily WhatsApp digests (Inngest → Vercel Cron migration,
// Stage 1 Task 1.1). Replaces the Inngest whatsapp-noon / -evening / -eod crons.
//
// Flow: read ?slot=noon|evening|eod → verify the Vercel Cron secret → gate on
// the slot's Israel-local hour → acquireJobLock (skip if not acquired) →
// runWhatsappSlot(slot).
//
// DOUBLE-SEND GUARD (most important property): each slot is DST dual-fired in
// vercel.json (two UTC times). The israelHour() gate already makes the off-DST
// fire a no-op, but to be belt-and-suspenders against ANY duplicate fire at the
// DST seam (or a Vercel retry), we wrap the send in a per-(slot, IL-day)
// acquireJobLock. If the lock is already held, we DO NOT send — so a WhatsApp
// digest can never be delivered twice for the same slot+day. We do NOT release
// the lock after a successful send: the lock's TTL acts as the dedup window, so
// holding it for the day is the desired behavior (a release would re-open the
// double-send window for a late duplicate fire).
//
// DST timings: noon 12:00 IL (09:00+10:00 UTC), evening 18:00 IL (15:00+16:00
// UTC), eod 00:30 IL (21:30+22:30 UTC) — the eod gate is on IL hour 0.
//
// Auth: self-validating via CRON_SECRET (verifyCronRequest); covered by
// isDashboardAuthAllowlisted's `/api/cron/*` rule.

import { NextResponse } from 'next/server';
import { verifyCronRequest } from '@/lib/jobs/verifyCron';
import { israelHour, getTodayInIsraelTz } from '@/lib/dateRange';
import { acquireJobLock } from '@/lib/jobs/lock';
import { runWhatsappSlot, type WhatsappSlot } from '@/inngest/functions/cronWhatsapp';

export const dynamic = 'force-dynamic';

// The target Israel local hour per slot. The off-DST dual-fire lands on a
// different IL hour and is gated out as a cheap no-op.
const SLOT_IL_HOUR: Record<WhatsappSlot, number> = {
  noon: 12,
  evening: 18,
  eod: 0, // 00:30 IL — gate on hour 0 (the cron's minute is 30 in UTC terms)
};

// Lock TTL: long enough to dedup the DST-seam double-fire / Vercel retries for
// a slot, well short of a day so a fresh run next day always re-acquires.
const LOCK_TTL_SEC = 6 * 60 * 60; // 6h

function isWhatsappSlot(v: string | null): v is WhatsappSlot {
  return v === 'noon' || v === 'evening' || v === 'eod';
}

async function handle(req: Request): Promise<Response> {
  if (!verifyCronRequest(req)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const slot = new URL(req.url).searchParams.get('slot');
  if (!isWhatsappSlot(slot)) {
    return NextResponse.json({ error: 'invalid slot' }, { status: 400 });
  }

  if (israelHour() !== SLOT_IL_HOUR[slot]) {
    // Off-DST dual-fire — not this slot's IL target hour. No-op (no lock taken).
    return NextResponse.json({ skipped: 'off-hour', slot }, { status: 200 });
  }

  // Double-send guard: only the FIRST fire for this (slot, IL-day) sends.
  const lockKey = `whatsapp:${slot}:${getTodayInIsraelTz()}`;
  const acquired = await acquireJobLock(lockKey, LOCK_TTL_SEC);
  if (!acquired) {
    return NextResponse.json({ skipped: 'locked', slot }, { status: 200 });
  }

  const result = await runWhatsappSlot(slot);
  return NextResponse.json({ ok: true, slot, result }, { status: 200 });
}

export async function GET(req: Request): Promise<Response> {
  return handle(req);
}

export async function POST(req: Request): Promise<Response> {
  return handle(req);
}
