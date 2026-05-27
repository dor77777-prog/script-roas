/**
 * Phase 13.9 (2026-05-27) — Tiny shared helper that returns "today" as a
 * `YYYY-MM-DD` string in Asia/Jerusalem time. Extracted as its own
 * module so cron-live-heavy can rely on a mockable import (the test at
 * `__tests__/cronLiveHeavy.test.ts` stubs this module out to pin a fixed
 * date for deterministic assertions).
 *
 * Implementation mirrors `cronLive.ts`'s in-file `dayInJerusalem(Date.now())`
 * helper and `sendDailySummary.ts`'s `todayJerusalem()` — duplicated rather
 * than re-exported from those modules to keep this helper free of
 * unrelated imports (notifications, supabase, etc.) so it stays cheap to
 * stub in unit tests.
 */
const TZ = 'Asia/Jerusalem';

/** Returns 'YYYY-MM-DD' for today in Asia/Jerusalem at call time. */
export function todayInIsrael(): string {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  return fmt.format(new Date());
}
