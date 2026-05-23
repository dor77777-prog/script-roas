// dashboard-web/src/inngest/functions/__tests__/cronWhatsapp.test.ts
//
// Audit fix 2026-05-23 (HIGH-13 / O4-HI-02): pin the WhatsApp EOD cron
// expression to 00:30 IL.
//
// Pre-fix: EOD ran at `TZ=Asia/Jerusalem 10 0 * * *` (00:10 IL). cron-daily
// starts at 00:05 IL (cronDaily.ts:966) and has a 4-retry envelope
// (~7.5 min worst case). 00:10 left only 5 minutes — when cron-daily was
// mid-retry, data_daily had no row yet and buildStoreSummary returned
// null → operator got the "no data" WhatsApp despite real revenue.
//
// Post-fix: EOD at `TZ=Asia/Jerusalem 30 0 * * *` (00:30 IL) — 25-min
// runway clear of cron-daily's retry envelope.
//
// This test file also pins the noon + evening + send-now cron/event
// shapes so any future cron-schedule churn forces an explicit decision.

import { describe, it, expect } from 'vitest';
import {
  whatsappNoon,
  whatsappEvening,
  whatsappEod,
  eventWhatsappSendNow,
} from '../cronWhatsapp';

function readCronTrigger(fn: unknown): string | undefined {
  const opts = (fn as { opts?: { triggers?: Array<{ cron?: string }> } }).opts;
  const triggers = opts?.triggers;
  if (!triggers || triggers.length === 0) return undefined;
  return triggers[0]?.cron;
}

function readEventTrigger(fn: unknown): string | undefined {
  const opts = (fn as { opts?: { triggers?: Array<{ event?: string }> } }).opts;
  const triggers = opts?.triggers;
  if (!triggers || triggers.length === 0) return undefined;
  return triggers[0]?.event;
}

function readFunctionId(fn: unknown): string | undefined {
  return (fn as { opts?: { id?: string } }).opts?.id;
}

function readFunctionName(fn: unknown): string | undefined {
  return (fn as { opts?: { name?: string } }).opts?.name;
}

describe('whatsapp cron triggers — fire-time invariants', () => {
  it('whatsappNoon fires at TZ=Asia/Jerusalem 0 12 * * * (12:00 IL)', () => {
    expect(readCronTrigger(whatsappNoon)).toBe('TZ=Asia/Jerusalem 0 12 * * *');
    expect(readFunctionId(whatsappNoon)).toBe('whatsapp-noon');
  });

  it('whatsappEvening fires at TZ=Asia/Jerusalem 0 18 * * * (18:00 IL)', () => {
    expect(readCronTrigger(whatsappEvening)).toBe(
      'TZ=Asia/Jerusalem 0 18 * * *',
    );
    expect(readFunctionId(whatsappEvening)).toBe('whatsapp-evening');
  });

  it('whatsappEod fires at TZ=Asia/Jerusalem 30 0 * * * (00:30 IL) — HIGH-13 fix', () => {
    // Pre-fix was '10 0 * * *' (00:10 IL) which only left 5 min for the
    // 00:05 cron-daily's 7.5-min retry budget. 00:30 gives a 25-min
    // clearance so empty data_daily reads on retry-storm scenarios are
    // impossible.
    expect(readCronTrigger(whatsappEod)).toBe('TZ=Asia/Jerusalem 30 0 * * *');
    expect(readFunctionId(whatsappEod)).toBe('whatsapp-eod');
    // Name must reflect the new time too — the Inngest Cloud UI label
    // surfaces this; mismatched name vs trigger would mislead the operator.
    expect(readFunctionName(whatsappEod)).toContain('00:30');
  });

  it('eventWhatsappSendNow fires on the manual notifications/whatsapp.send-now event', () => {
    expect(readEventTrigger(eventWhatsappSendNow)).toBe(
      'notifications/whatsapp.send-now',
    );
    expect(readFunctionId(eventWhatsappSendNow)).toBe(
      'event-whatsapp-send-now',
    );
  });

  it('all 3 cron schedules use TZ=Asia/Jerusalem prefix (Israel-local, NOT UTC)', () => {
    // Per RESEARCH §Pitfall 1: a raw `M H * * *` would drift by 2-3 hours
    // twice a year (DST). The TZ= prefix is mandatory.
    for (const fn of [whatsappNoon, whatsappEvening, whatsappEod]) {
      const cron = readCronTrigger(fn);
      expect(cron, `cron expression for ${readFunctionId(fn)}`).toMatch(
        /^TZ=Asia\/Jerusalem /,
      );
    }
  });
});
