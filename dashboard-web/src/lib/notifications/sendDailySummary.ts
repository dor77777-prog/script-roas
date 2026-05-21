// Phase 05.7.4 — Orchestrator for the 3 daily WhatsApp notifications.
//
// Mirrors `Notifications.gs:sendNotificationForDate_` at lines 455-486:
// 1. Load notification_config (active metacloud row)
// 2. Build per-store + totals summary for the target date
// 3. Build 5-element template parameter array
// 4. Send to each non-null recipient (phone1, phone2)
//
// Two layers of error tolerance, matching Apps Script:
//   - Missing config row → skip the whole send (logs once, no throw)
//   - Per-recipient failure → continue to next recipient (so phone1
//     failure doesn't suppress phone2; both get independent retries via
//     Inngest's per-step retry policy when called from a cron function).

import { buildStoreSummary } from './summary';
import { buildTemplateParameters } from './templateParams';
import {
  loadActiveMetacloudConfig,
  sendWhatsAppTemplate,
} from './whatsapp';

export type SendResult = {
  dateStr: string;
  title: string;
  recipientsAttempted: string[];
  recipientsSucceeded: string[];
  recipientsFailed: Array<{ to: string; error: string }>;
  /**
   * True when the notification was deliberately skipped (no active
   * metacloud config row, or no recipients configured). Distinct from
   * `recipientsFailed` which captures send-time errors.
   */
  skipped: boolean;
  skipReason?: string;
};

export async function sendDailySummary(
  dateStr: string,
  title: string,
): Promise<SendResult> {
  const result: SendResult = {
    dateStr,
    title,
    recipientsAttempted: [],
    recipientsSucceeded: [],
    recipientsFailed: [],
    skipped: false,
  };

  const cfg = await loadActiveMetacloudConfig();
  if (!cfg) {
    result.skipped = true;
    result.skipReason = 'no active metacloud notification_config row';
    return result;
  }
  if (!cfg.templateName) {
    result.skipped = true;
    result.skipReason = 'notification_config.template_name is empty';
    return result;
  }
  const recipients = [cfg.phone1, cfg.phone2].filter(
    (p): p is string => !!p && p.trim() !== '',
  );
  if (recipients.length === 0) {
    result.skipped = true;
    result.skipReason = 'no recipients configured (phone1 + phone2 both null)';
    return result;
  }

  const summary = await buildStoreSummary(dateStr);
  const templateParams = buildTemplateParameters(summary, title);

  for (const to of recipients) {
    result.recipientsAttempted.push(to);
    try {
      await sendWhatsAppTemplate({
        toNumber: to,
        templateName: cfg.templateName,
        templateLang: cfg.templateLang || 'he',
        templateParams,
      });
      result.recipientsSucceeded.push(to);
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e);
      result.recipientsFailed.push({ to, error });
      // Continue to next recipient — phone1 failure must not block phone2.
    }
  }

  return result;
}

// ────────────────────────────────────────────────────────────────────────
// Title helpers — mirror Apps Script's three call sites.
// ────────────────────────────────────────────────────────────────────────

function fmtTimeAndDate(hh: string, dateStr: string): string {
  // Output: "HH:00, DD/MM/YYYY" matching the user's approved template sample.
  const [y, m, d] = dateStr.split('-');
  return `${hh}:00, ${d}/${m}/${y}`;
}

/** Title for the 12:00 noon snapshot — TODAY so far. */
export function titleNoon(dateStr: string): string {
  return fmtTimeAndDate('12', dateStr);
}

/** Title for the 18:00 evening snapshot — TODAY so far. */
export function titleEvening(dateStr: string): string {
  return fmtTimeAndDate('18', dateStr);
}

/** Title for the 00:10 EOD summary — YESTERDAY full day. */
export function titleEod(dateStr: string): string {
  // Use 23:59 to mark end-of-day boundary in the message.
  return `סיכום יום מלא — ${fmtTimeAndDate('23', dateStr)}`;
}

// ────────────────────────────────────────────────────────────────────────
// Date helpers
// ────────────────────────────────────────────────────────────────────────

const TZ = 'Asia/Jerusalem';

function fmtJerusalemDay(ms: number): string {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  return fmt.format(new Date(ms));
}

/** `YYYY-MM-DD` for "today" in Asia/Jerusalem at the moment of invocation. */
export function todayJerusalem(): string {
  return fmtJerusalemDay(Date.now());
}

/** `YYYY-MM-DD` for "yesterday" in Asia/Jerusalem at the moment of invocation. */
export function yesterdayJerusalem(): string {
  return fmtJerusalemDay(Date.now() - 24 * 60 * 60 * 1000);
}
