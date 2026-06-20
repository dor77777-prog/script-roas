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
import {
  buildTemplateParameters,
  buildTemplateParametersV2,
  V2_TEMPLATE_NAME,
} from './templateParams';
import {
  loadActiveMetacloudConfig,
  sendWhatsAppTemplate,
} from './whatsapp';
import {
  fetchAdStateFromPostgres,
  fetchStoreMetaFromPostgres,
} from '@/lib/postgresReaders';
import {
  applicablePlatforms,
  isStoreFullyOff,
  type AdStateMap,
} from '@/lib/adState';
import { getStoresWithTikTokIdSet } from '@/lib/platformsByStore';

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

/**
 * Phase 13.4 — minimal step.run shape used by the Inngest handler. When
 * the cron handler passes its `step` here, each recipient send is wrapped
 * in its own `step.run('send-whatsapp-<sanitized>', ...)`. Inngest then
 * memoizes succeeded recipients across function-level retries, so a
 * single recipient failure doesn't cause re-sends to the already-
 * succeeded ones (no duplicate WhatsApp messages). Direct callers (tests,
 * ad-hoc invocations) omit the ctx and get the original inline behavior.
 */
export type StepRunner = {
  run<T>(id: string, fn: () => Promise<T>): Promise<T>;
};

export async function sendDailySummary(
  dateStr: string,
  title: string,
  ctx?: { step: StepRunner },
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

  // ads-off Phase 4 — build a per-store isFullyOff map so the template
  // builders can frame off stores as "אורגני"/"ללא מכירות" and exclude
  // their spend from totals. Graceful: any fetch failure → empty map →
  // message identical to before (all stores treated as ON).
  const offStoreIds = await buildOffStoreIds(summary).catch(() => ({}));

  // Pick the param builder by the CONFIGURED template name so the rollout is
  // safe + reversible: v1 keeps running until the operator flips
  // notification_config.template_name to the (Meta-approved) v2 — then the
  // 21-param multi-line layout activates with zero code redeploy.
  const templateParams =
    cfg.templateName === V2_TEMPLATE_NAME
      ? buildTemplateParametersV2(summary, title, offStoreIds)
      : buildTemplateParameters(summary, title, offStoreIds);

  for (const to of recipients) {
    result.recipientsAttempted.push(to);
    const stepKey = `send-whatsapp-${to.replace(/[^a-zA-Z0-9]/g, '_')}`;
    const send = () =>
      sendWhatsAppTemplate({
        toNumber: to,
        templateName: cfg.templateName,
        templateLang: cfg.templateLang || 'he',
        templateParams,
      });
    try {
      // Phase 13.4 — wrap each recipient send in step.run when ctx.step is
      // provided. Inngest memoizes succeeded sends per recipient so a
      // function-level retry doesn't re-send to the already-succeeded ones.
      if (ctx?.step) {
        await ctx.step.run(stepKey, send);
      } else {
        await send();
      }
      result.recipientsSucceeded.push(to);
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e);
      result.recipientsFailed.push({ to, error });
      // Continue to next recipient — phone1 failure must not block phone2.
    }
  }

  // Audit fix 2026-05-23 (HR-04 health-and-conclusions): make
  // partial-recipient failures visible to Inngest.
  //
  // Pre-fix: per-recipient `try/catch` swallowed the exception and
  // appended to `result.recipientsFailed`. The function then returned
  // successfully — Inngest marked the run as a SUCCESS and the failure
  // never surfaced anywhere (no retry, no alert, no operator signal).
  // The operator only noticed when they realized they hadn't gotten
  // their noon summary in 3 days.
  //
  // Audit fix 2026-05-23 (a/WARN-2 sharpening): originally we threw only
  // when ALL recipients failed, preserving "success" status when some
  // succeeded. The operator's actual deployment is single-recipient
  // (+972524809540 — see project_token_failure_alerts_pending note), so
  // "any failure = the failure" — and the recipientsFailed list never
  // gets large enough for partial-success to be meaningful. Tighten the
  // gate to throw on ANY failure: Inngest now retries the function for
  // a flaky network blip, and the partial-success bookkeeping
  // (recipientsSucceeded vs recipientsFailed) is still visible in the
  // SendResult for any future multi-recipient deployment. Throwing here
  // is preferable to the silent partial-failure that prompted the
  // original HR-04 fix.
  if (result.recipientsFailed.length > 0) {
    const summary = result.recipientsFailed
      .map(f => `${f.to}: ${f.error}`)
      .join(' | ');
    throw new Error(
      `${result.recipientsFailed.length}/${result.recipientsAttempted.length} WhatsApp recipient(s) failed for ${title}. ${summary}`,
    );
  }

  return result;
}

// ────────────────────────────────────────────────────────────────────────
// ads-off Phase 4 — per-store isFullyOff map
// ────────────────────────────────────────────────────────────────────────

/**
 * Fetches adState + storeMeta and returns a `{ [storeId]: true }` map for
 * every store that is FULLY off (all applicable platforms disabled).
 * Stores present in `summary` but not in the `stores` table are treated
 * as ON (safe default). Returns an empty map when `summary` is null.
 */
async function buildOffStoreIds(
  summary: Awaited<ReturnType<typeof buildStoreSummary>>,
): Promise<Record<string, boolean>> {
  if (!summary) return {};
  const storeIds = Object.keys(summary.stores);
  if (storeIds.length === 0) return {};

  const [adMap, storeMeta]: [AdStateMap, Awaited<ReturnType<typeof fetchStoreMetaFromPostgres>>] =
    await Promise.all([
      fetchAdStateFromPostgres().catch((): AdStateMap => ({})),
      fetchStoreMetaFromPostgres().catch(() => []),
    ]);

  // Self-serve stores: "advertises on TikTok" applicability is derived from
  // stores.has_tiktok (getStores → hardcoded fallback {uzoshop, usmile360}), so a
  // 4th store with has_tiktok=true is classified correctly in the digest's
  // off-store detection. Byte-identical for the 3.
  const tiktokStores = await getStoresWithTikTokIdSet().catch(() => new Set<string>());
  const metaById = new Map(storeMeta.map((r) => [r.storeId, r]));

  const offStoreIds: Record<string, boolean> = {};
  for (const sid of storeIds) {
    const meta = metaById.get(sid);
    if (!meta) continue; // unknown store → treat as ON
    const applicable = applicablePlatforms(meta, tiktokStores);
    if (isStoreFullyOff(sid, adMap, applicable)) {
      offStoreIds[sid] = true;
    }
  }
  return offStoreIds;
}

// ────────────────────────────────────────────────────────────────────────
// Title helpers — mirror Apps Script's three call sites.
// ────────────────────────────────────────────────────────────────────────

function fmtTimeAndDate(hh: string, dateStr: string): string {
  // Output: "HH:00, DD/MM/YYYY" matching the user's approved template sample.
  const [y, m, d] = dateStr.split('-');
  return `${hh}:00, ${d}/${m}/${y}`;
}

function fmtDateOnly(dateStr: string): string {
  // Output: "DD/MM/YYYY" — no time component. Used by the EOD title where
  // the operator (2026-05-22) preferred to drop the "23:00" prefix because
  // the time has no meaning on a full-day summary.
  const [y, m, d] = dateStr.split('-');
  return `${d}/${m}/${y}`;
}

/** Title for the 12:00 noon snapshot — TODAY so far. */
export function titleNoon(dateStr: string): string {
  return `${fmtTimeAndDate('12', dateStr)} · מתחילת היום`;
}

/** Title for the 18:00 evening snapshot — TODAY so far. */
export function titleEvening(dateStr: string): string {
  return `${fmtTimeAndDate('18', dateStr)} · מתחילת היום`;
}

/** Title for the EOD summary — YESTERDAY full day (date only). */
export function titleEod(dateStr: string): string {
  return `${fmtDateOnly(dateStr)} · סיכום יום מלא`;
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
