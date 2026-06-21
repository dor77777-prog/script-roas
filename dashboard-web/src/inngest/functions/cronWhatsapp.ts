// Per-slot WhatsApp daily-summary send logic.
//
// History: this began as 3 Apps Script time-based triggers, then became 3
// Inngest cron functions + 1 event-triggered test sender. The whole job
// runtime has since migrated to Vercel Cron + QStash (see
// docs/superpowers/specs/2026-06-21-inngest-to-vercel-qstash-migration-design.md):
//   - the 3 daily slots run on Vercel Cron via `/api/cron/whatsapp?slot=…`
//     (Stage 1), which calls runWhatsappSlot(slot) inline and wraps it in
//     acquireJobLock so a DST-seam double-fire can never double-send;
//   - the operator "send now" button sends INLINE via runWhatsappSlot(trigger)
//     in `/api/operator/notifications/send` (Stage 3).
// The Inngest cron/event wrappers were removed in Stage 4.
//
// Schedule (DST-safe, Asia/Jerusalem):
//   12:00 IL → "today so far" snapshot
//   18:00 IL → "today so far" snapshot
//   00:30 IL → "yesterday full-day" summary. Why 00:30 (not 00:10): cron-daily
//     fires at 00:05 IL; at 00:10 the EOD summary could race cron-daily's retry
//     budget and render a "no data" message despite real revenue. Audit fix
//     2026-05-23 (HIGH-13 / O4-HI-02) moved it to 00:30 for a ~25-min runway.

import {
  sendDailySummary,
  titleNoon,
  titleEvening,
  titleEod,
  todayJerusalem,
  yesterdayJerusalem,
  type SendResult,
} from '@/lib/notifications/sendDailySummary';
import { captureStepError } from '@/lib/sentry/capture';

type StepTools = {
  run: <T>(label: string, fn: () => Promise<T>) => Promise<T>;
};

/** The three daily WhatsApp digest slots. */
export type WhatsappSlot = 'noon' | 'evening' | 'eod';

/**
 * The per-slot send logic, called inline by `/api/cron/whatsapp` (the 3 daily
 * slots) and `/api/operator/notifications/send` (the operator "send now"
 * button).
 *
 *   noon    → today's snapshot,    titleNoon
 *   evening → today's snapshot,    titleEvening
 *   eod     → YESTERDAY full day,  titleEod
 *
 * `ctx.step` is optional — sendDailySummary can issue per-recipient step.run
 * calls when a durable step ctx is supplied; the Vercel routes omit it (they
 * rely on acquireJobLock for double-send protection instead). A top-level
 * failure is captured to Sentry here (formerly done by the deleted per-slot
 * Inngest wrappers) so the cron path keeps its breadcrumb.
 */
export async function runWhatsappSlot(
  slot: WhatsappSlot,
  ctx?: { step: StepTools },
): Promise<SendResult> {
  try {
    if (slot === 'eod') {
      const dateStr = yesterdayJerusalem();
      return await sendDailySummary(dateStr, titleEod(dateStr), ctx);
    }
    const dateStr = todayJerusalem();
    const title = slot === 'evening' ? titleEvening(dateStr) : titleNoon(dateStr);
    return await sendDailySummary(dateStr, title, ctx);
  } catch (e) {
    captureStepError({ fnId: `whatsapp-${slot}`, stepName: 'top-level' }, e);
    throw e;
  }
}
