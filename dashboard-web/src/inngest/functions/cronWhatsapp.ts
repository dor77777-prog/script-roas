// Phase 05.7.4 — Inngest cron triggers for the 3 daily WhatsApp summaries.
//
// Lineage:
//   - Replaces the 3 Apps Script time-based triggers configured by
//     `Notifications.gs:setupNotificationTriggers` (line 520). Apps Script
//     fires within a 1-hour window of the configured hour; Inngest fires
//     within a few seconds of the cron expression. The new schedule is
//     therefore strict (not "sometime in [00:00, 01:00)" anymore):
//
//       12:00 IL → "today so far" snapshot
//       18:00 IL → "today so far" snapshot
//       00:30 IL → "yesterday full-day" summary (was 00:00-01:00 in Apps
//                  Script; pre-audit it was 00:10 — see HIGH-13 fix below)
//
// Cron timezone (RESEARCH §Pitfall 1):
//   `TZ=Asia/Jerusalem M H * * *` runs at local Asia/Jerusalem time
//   year-round, DST-safe. A raw `M H * * *` without the TZ= prefix would
//   drift by 2-3 hours twice a year.
//
// Idempotency:
//   The Apps Script version had no idempotency — if the trigger fired
//   twice (rare but possible due to Apps Script's loose scheduler), the
//   user would receive duplicate messages. Inngest provides exactly-once
//   semantics on the function level: a single cron firing maps to a
//   single function run, retries don't double-send (the SDK's
//   step-deduplication kicks in if the handler is split into steps —
//   here we use one HTTP-side step per recipient so failures retry only
//   that recipient).

import { inngest } from '@/inngest/client';
import {
  sendDailySummary,
  titleNoon,
  titleEvening,
  titleEod,
  todayJerusalem,
  yesterdayJerusalem,
} from '@/lib/notifications/sendDailySummary';

type StepTools = {
  run: <T>(label: string, fn: () => Promise<T>) => Promise<T>;
};

/**
 * 12:00 Asia/Jerusalem — daily ROAS snapshot (today so far).
 */
export const whatsappNoon = inngest.createFunction(
  {
    id: 'whatsapp-noon',
    name: 'WhatsApp daily summary — 12:00',
    retries: 3,
    triggers: [{ cron: 'TZ=Asia/Jerusalem 0 12 * * *' }],
  },
  async ({ step }: { step: StepTools }) => {
    // Phase 13.4 — removed the outer `step.run('send', ...)` wrapper so
    // sendDailySummary can issue its own per-recipient step.run calls
    // (Inngest forbids nested step.run). The per-recipient memoization
    // prevents duplicate WhatsApp sends to recipients that already
    // succeeded when a function-level retry kicks in.
    const dateStr = todayJerusalem();
    return await sendDailySummary(dateStr, titleNoon(dateStr), { step });
  },
);

/**
 * 18:00 Asia/Jerusalem — daily ROAS snapshot (today so far, refreshed).
 */
export const whatsappEvening = inngest.createFunction(
  {
    id: 'whatsapp-evening',
    name: 'WhatsApp daily summary — 18:00',
    retries: 3,
    triggers: [{ cron: 'TZ=Asia/Jerusalem 0 18 * * *' }],
  },
  async ({ step }: { step: StepTools }) => {
    // Phase 13.4 — see whatsappNoon for rationale on removing the outer step.run.
    const dateStr = todayJerusalem();
    return await sendDailySummary(dateStr, titleEvening(dateStr), { step });
  },
);

/**
 * 00:30 Asia/Jerusalem — end-of-day summary (YESTERDAY full day).
 *
 * Why 00:30 and not 00:10:
 *   - cron-daily fires at 00:05 IL (cronDaily.ts:966). Its handler has 4
 *     retries × exponential backoff (Inngest D-B6); the worst-case finish
 *     time is ~00:12.5 (5 min + 7.5 min retry envelope). At 00:10, the
 *     EOD WhatsApp summary would race that retry budget — when cron-daily
 *     hit a transient Meta 5xx and was on retry #3, `data_daily` for
 *     yesterday hadn't landed yet, and `buildStoreSummary` returned null
 *     → `buildTemplateParameters` rendered the no-data totals string. The
 *     operator got a "no data" WhatsApp despite revenue having happened.
 *   - Audit fix 2026-05-23 (HIGH-13 / O4-HI-02): move to 00:30. That
 *     gives cron-daily a clear ~25-min runway before the reader fires,
 *     well beyond the 7.5-min retry budget. Worst-case retry storms can
 *     still complete in time.
 *   - Operator chose strict cron expression per Phase 05.7.4 question 3
 *     (vs Apps Script's loose 00:00-01:00 window).
 */
export const whatsappEod = inngest.createFunction(
  {
    id: 'whatsapp-eod',
    name: 'WhatsApp daily summary — 00:30 (yesterday EOD)',
    retries: 3,
    triggers: [{ cron: 'TZ=Asia/Jerusalem 30 0 * * *' }],
  },
  async ({ step }: { step: StepTools }) => {
    // Phase 13.4 — see whatsappNoon for rationale on removing the outer step.run.
    const dateStr = yesterdayJerusalem();
    return await sendDailySummary(dateStr, titleEod(dateStr), { step });
  },
);

// ────────────────────────────────────────────────────────────────────────
// Manual-trigger event — fires when the operator hits "Send test" in
// /operator/notifications. Lets the operator sanity-check delivery
// without waiting for the next cron.
// ────────────────────────────────────────────────────────────────────────

type SendNowEventData = {
  trigger?: 'noon' | 'evening' | 'eod';
};

/**
 * Event-triggered test sender. Operator console hits this via inngest.send.
 * Default trigger='noon' (today snapshot); 'eod' uses yesterday's data.
 */
export const eventWhatsappSendNow = inngest.createFunction(
  {
    id: 'event-whatsapp-send-now',
    name: 'Operator: send WhatsApp summary now',
    retries: 0,
    triggers: [{ event: 'notifications/whatsapp.send-now' }],
  },
  async ({ event, step }: { event: { data?: SendNowEventData }; step: StepTools }) => {
    const trigger = event?.data?.trigger ?? 'noon';
    return await step.run('send', async () => {
      if (trigger === 'eod') {
        const dateStr = yesterdayJerusalem();
        return await sendDailySummary(dateStr, titleEod(dateStr));
      }
      const dateStr = todayJerusalem();
      const title = trigger === 'evening' ? titleEvening(dateStr) : titleNoon(dateStr);
      return await sendDailySummary(dateStr, title);
    });
  },
);

export const whatsappCronFunctions = [
  whatsappNoon,
  whatsappEvening,
  whatsappEod,
];
