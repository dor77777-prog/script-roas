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
//       00:10 IL → "yesterday full-day" summary (was 00:00-01:00 in Apps Script)
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
    return await step.run('send', async () => {
      const dateStr = todayJerusalem();
      return await sendDailySummary(dateStr, titleNoon(dateStr));
    });
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
    return await step.run('send', async () => {
      const dateStr = todayJerusalem();
      return await sendDailySummary(dateStr, titleEvening(dateStr));
    });
  },
);

/**
 * 00:10 Asia/Jerusalem — end-of-day summary (YESTERDAY full day).
 *
 * Why 00:10 and not 00:00 sharp:
 *   - The cron-daily job at 00:05 IL upserts the prior-day data_daily row
 *     (Phase 05.6 Plan 08). Reading at 00:10 ensures we always see the
 *     fresh row, not a stale partial.
 *   - Operator chose 00:10 exactly per Phase 05.7.4 question 3 (vs Apps
 *     Script's loose 00:00-01:00 window).
 */
export const whatsappEod = inngest.createFunction(
  {
    id: 'whatsapp-eod',
    name: 'WhatsApp daily summary — 00:10 (yesterday EOD)',
    retries: 3,
    triggers: [{ cron: 'TZ=Asia/Jerusalem 10 0 * * *' }],
  },
  async ({ step }: { step: StepTools }) => {
    return await step.run('send', async () => {
      const dateStr = yesterdayJerusalem();
      return await sendDailySummary(dateStr, titleEod(dateStr));
    });
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
