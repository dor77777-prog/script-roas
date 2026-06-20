/**
 * Phase 05.7.x (2026-05-23) — token failure detection + WhatsApp alerts.
 *
 * Centralised notifier for upstream auth/token failures across Meta /
 * Google / TikTok / WhatsApp Cloud / Shopify / FX. Every fetcher that
 * can produce an "auth dead" error calls `notifyTokenFailure(...)`
 * inside its catch block. The notifier:
 *
 *   1. Upserts a row into the Postgres `token_failures` table keyed by
 *      (provider, store_id, operation). Bumps `seen_count` and refreshes
 *      `last_seen_at` + `last_error_msg` every call.
 *
 *   2. Decides whether to actually SEND a WhatsApp alert. Throttle rule:
 *      send if `last_alert_sent_at IS NULL` OR > 6 hours ago. This
 *      prevents a single dead token from spamming the operator 144×/day
 *      (one per cron-live tick).
 *
 *   3. When sending: posts a WhatsApp template message via the existing
 *      `sendWhatsAppTemplate` helper. Uses the dedicated 4-placeholder
 *      `token_failure_alert` template (English / `en`), which Meta
 *      APPROVED on 2026-05-24 — sends go through normally, no template
 *      fallback or repurposing is needed.
 *
 *   4. ALWAYS sends to the single recipient `+972524809540` — explicit
 *      operator instruction (2026-05-23): "alerts only to this number,
 *      not to phone1/phone2 of the daily summary config".
 *
 *   5. #34 — non-WhatsApp fallback: if the WhatsApp send itself fails
 *      (dead WhatsApp token, network), OR the failing provider IS
 *      'whatsapp' (our own notifier channel is the dead dependency), we
 *      ALSO raise the alert to Sentry. Otherwise a dead WhatsApp token —
 *      exactly when an alert matters most — would silence every
 *      token-failure alert except the passive /operator DB row.
 *
 * Soft-fail policy: the notifier MUST NEVER throw. If anything goes
 * wrong (DB down, WhatsApp 401, Sentry transport down, etc.) we log +
 * return. The caller's primary path (the fetcher's original error) keeps
 * propagating normally — we don't want notifier failures to mask the real
 * problem.
 *
 * Operator UI: `/operator > בעיות טוקן` (TODO follow-up commit) reads
 * `token_failures` directly to show the operator the unresolved list +
 * how many alerts were sent for each.
 */

import * as Sentry from '@sentry/nextjs';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { sendWhatsAppTemplate } from './whatsapp';

// =============================================================================
// Types
// =============================================================================

export type TokenFailureProvider =
  | 'meta'
  | 'google'
  | 'tiktok'
  | 'whatsapp'
  | 'shopify'
  | 'fx';

/** Any store id from the (dynamic, self-serve) stores table, or the reserved
 *  'global' pseudo-store for platform-wide failures (FX, WhatsApp Cloud).
 *  2026-06-11 (MT-0): was a hardcoded 3-store union predating self-serve —
 *  together with the DB CHECK (dropped in migration 20260611120000) it made a
 *  4th store's failure alerts silently disappear. Do NOT re-narrow this. */
export type TokenFailureStore = string;

export type TokenFailureInput = {
  /** Which upstream platform failed. Matches the CHECK constraint on the table. */
  provider: TokenFailureProvider;
  /** Which store the failure affects — 'global' for platform-wide failures
   *  (e.g. WhatsApp Cloud token, OXR FX provider). */
  storeId: TokenFailureStore;
  /** Short machine-readable operation label. Examples:
   *  - 'oauth_refresh' — long-lived token refresh failed
   *  - 'access_token' — short-lived access token wasn't valid
   *  - 'send_template' — WhatsApp template send rejected
   *  - 'fetch_insights' — auth-OK but a downstream fetch failed
   *
   *  Used as part of the throttle key (provider, storeId, operation),
   *  so distinct operations on the same platform don't suppress each
   *  other's alerts. */
  operation: string;
  /** The raw error message from the upstream API. Truncated to 500 chars
   *  in the WhatsApp body to fit Meta's per-param length limit. */
  errorMsg: string;
  /** Optional one-line hint for the operator on how to fix this. E.g.
   *  "Run OAuth Playground flow + update GOOGLEADS_REFRESH_TOKEN in
   *  Vercel + redeploy". */
  advice?: string;
};

// =============================================================================
// Constants
// =============================================================================

/** Single alert recipient (operator's primary phone). E.164 with `+`. */
const ALERT_PHONE = '+972524809540';

/** Throttle: don't send the same (provider, storeId, operation) alert more
 *  than once per this many milliseconds. 6 hours = 4 alerts/day max per
 *  unique failure, which is enough to notice but not spam. */
const ALERT_THROTTLE_MS = 6 * 60 * 60 * 1000;

/**
 * Phase A 2026-05-29 — operations whose name ends with `_budget_skip` are
 * proactive pre-emption events (MetaBudgetHighError from fetchMeta.ts): the
 * system chose to skip fetching because BUC usage is already high, NOT
 * because a token failed. We still write a DB row (so /operator panel sees
 * the event) and still advance `last_alert_sent_at` (preserving d/CR-09
 * throttle-clock invariant), but we intentionally suppress the WhatsApp send
 * to avoid false-panic alerts.
 *
 * Spec: docs/superpowers/specs/2026-05-29-freshness-contract-incremental-sync-design.md
 */
const BUDGET_SKIP_OPERATION_RE = /_budget_skip$/;

/** Maximum WhatsApp param length. Meta enforces 1024 chars per param but
 *  refuses 5+ consecutive spaces and \n. We stay well under to leave room
 *  for emojis + the operator's eyes. */
const MAX_PARAM_LEN = 500;

// =============================================================================
// Supabase helpers
// =============================================================================

function admin(): SupabaseClient | null {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    // Soft-fail: notifier must never throw. Log + return null so the
    // caller's original error keeps propagating.
    console.warn(
      'tokenFailures: SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing — ' +
        'cannot persist the failure or throttle alerts.',
    );
    return null;
  }
  return createClient(url, key, { auth: { persistSession: false } });
}

/** Compact a multi-line error into a single-line slug suitable for the
 *  WhatsApp param (Meta rejects \n + tab + 5+ consecutive spaces). */
function sanitizeForWhatsApp(s: string): string {
  return s
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/ {5,}/g, ' ')
    .trim()
    .slice(0, MAX_PARAM_LEN);
}

/** Format "23/05 11:30" — DD/MM HH:MM in Israel TZ. */
function formatTimestamp(): string {
  const now = new Date();
  const fmt = new Intl.DateTimeFormat('he-IL', {
    timeZone: 'Asia/Jerusalem',
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  const parts = fmt.formatToParts(now);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return `${get('day')}/${get('month')} ${get('hour')}:${get('minute')}`;
}

// =============================================================================
// Public API
// =============================================================================

/**
 * Record a token/auth failure and (throttled) notify the operator via
 * WhatsApp. NEVER throws — soft-fails on every internal error path so
 * the caller's original exception keeps propagating.
 *
 * Returns a small status object the caller can log:
 *   { alerted: true/false, throttled: boolean, dbWritten: boolean }
 */
export async function notifyTokenFailure(
  input: TokenFailureInput,
): Promise<{
  alerted: boolean;
  throttled: boolean;
  dbWritten: boolean;
}> {
  const result = { alerted: false, throttled: false, dbWritten: false };
  const { provider, storeId, operation, errorMsg, advice } = input;

  const sb = admin();
  if (!sb) return result;

  // --------- 1. Read existing row (for throttle decision) ----------
  let existing: {
    seen_count: number;
    alerts_sent_count: number;
    last_alert_sent_at: string | null;
  } | null = null;
  try {
    const { data, error } = await sb
      .from('token_failures')
      .select('seen_count, alerts_sent_count, last_alert_sent_at')
      .eq('provider', provider)
      .eq('store_id', storeId)
      .eq('operation', operation)
      .maybeSingle();
    if (error) {
      console.warn(
        `tokenFailures: select failed for ${provider}/${storeId}/${operation}: ${error.message}`,
      );
    } else {
      existing = data;
    }
  } catch (e) {
    console.warn(
      `tokenFailures: select threw for ${provider}/${storeId}/${operation}: ${e instanceof Error ? e.message : e}`,
    );
  }

  // --------- 2. Decide if we should alert (throttle) ----------
  const now = Date.now();
  const lastAlertMs = existing?.last_alert_sent_at
    ? new Date(existing.last_alert_sent_at).getTime()
    : 0;
  const shouldAlert = !lastAlertMs || now - lastAlertMs >= ALERT_THROTTLE_MS;
  result.throttled = !shouldAlert;

  // Phase A 2026-05-29: _budget_skip operations are proactive pre-emptions —
  // suppress the WhatsApp send, but still attempt (so the throttle clock
  // advances and the DB row is written). `attemptedAlert` captures "we were
  // going to send"; `shouldSendWhatsapp` is the actual gate.
  const attemptedAlert = shouldAlert;
  const shouldSendWhatsapp = shouldAlert && !BUDGET_SKIP_OPERATION_RE.test(operation);

  // --------- 3. Send WhatsApp (if not throttled and not budget_skip) ----------
  let sendError: string | null = null;
  if (shouldSendWhatsapp) {
    try {
      // 4-placeholder template `token_failure_alert` (English / `en`),
      // APPROVED by Meta on 2026-05-24 — this send goes through normally.
      //
      // Slot mapping (matches the approved body, all English):
      //   {{1}} = `GOOGLE · uzoshop · oauth_refresh @ 23/05 11:30`
      //   {{2}} = error message (truncated)
      //   {{3}} = advice
      //   {{4}} = `Seen 5 times. Alert #2.`
      const header = sanitizeForWhatsApp(
        `${provider.toUpperCase()} · ${storeId} · ${operation} @ ${formatTimestamp()}`,
      );
      const errorBlock = sanitizeForWhatsApp(errorMsg);
      const adviceBlock = sanitizeForWhatsApp(advice ?? '—');
      const countBlock = sanitizeForWhatsApp(
        `Seen ${(existing?.seen_count ?? 0) + 1} times. Alert #${(existing?.alerts_sent_count ?? 0) + 1}.`,
      );

      await sendWhatsAppTemplate({
        toNumber: ALERT_PHONE,
        templateName: 'token_failure_alert',
        templateLang: 'en',
        templateParams: [header, errorBlock, adviceBlock, countBlock],
      });
      result.alerted = true;
    } catch (e) {
      sendError = e instanceof Error ? e.message : String(e);
      console.warn(
        `tokenFailures: WhatsApp send failed for ${provider}/${storeId}/${operation}: ${sendError}`,
      );
      // #34 — the WhatsApp send itself failed. If the dead dependency IS
      // WhatsApp (dead token), we obviously can't alert via WhatsApp, so we
      // fall back to Sentry below (a dead notifier channel must not silence
      // every token-failure alert). The DB row is still written either way.
    }
  }

  // --------- 3b. Non-WhatsApp fallback (#34) ----------
  // Raise the alert to Sentry when the WhatsApp channel can't be trusted to
  // carry it: either the send just threw (dead WhatsApp token / network), OR
  // the failing provider IS 'whatsapp' (our own notifier channel is the dead
  // dependency — don't rely on it to alert about itself). This runs only when
  // we actually attempted (or would have attempted) a real send — budget_skip
  // suppressions are not failures and must stay quiet. The DB row + soft-fail
  // contract are unchanged; a throwing Sentry transport must not crash us.
  const whatsappChannelUntrusted =
    sendError !== null || provider === 'whatsapp';
  if (shouldAlert && !BUDGET_SKIP_OPERATION_RE.test(operation) && whatsappChannelUntrusted) {
    try {
      Sentry.captureException(
        new Error(
          `token-failure alert could not be delivered via WhatsApp: ` +
            `${provider}/${storeId}/${operation} — ${sanitizeForWhatsApp(errorMsg)}` +
            (sendError ? ` (WhatsApp send error: ${sendError})` : ''),
        ),
        {
          tags: {
            layer: 'token-failure-fallback',
            provider,
            storeId,
            operation,
          },
          fingerprint: ['token-failure-fallback', provider, storeId, operation],
          extra: { advice: advice ?? null, sendError },
        },
      );
    } catch (e) {
      // Soft-fail: even the fallback must never throw.
      console.warn(
        `tokenFailures: Sentry fallback failed for ${provider}/${storeId}/${operation}: ${e instanceof Error ? e.message : e}`,
      );
    }
  }

  // --------- 4. Upsert the row (always — even when throttled) ----------
  try {
    const payload: {
      provider: string;
      store_id: string;
      operation: string;
      last_seen_at: string;
      seen_count: number;
      alerts_sent_count: number;
      last_error_msg: string;
      last_advice: string | null;
      first_seen_at?: string;
      last_alert_sent_at?: string;
    } = {
      provider,
      store_id: storeId,
      operation,
      last_seen_at: new Date(now).toISOString(),
      seen_count: (existing?.seen_count ?? 0) + 1,
      alerts_sent_count:
        (existing?.alerts_sent_count ?? 0) + (result.alerted ? 1 : 0),
      last_error_msg: sanitizeForWhatsApp(errorMsg),
      last_advice: advice ?? null,
    };
    if (!existing) {
      payload.first_seen_at = new Date(now).toISOString();
    }
    // Audit fix 2026-05-23 (d/CR-09): bump `last_alert_sent_at` on every
    // ATTEMPTED send, not only on success. Previously this only updated
    // when `result.alerted === true`, meaning a failed send (WhatsApp
    // 401, template not approved, network blip) left the throttle clock
    // un-advanced. The next cron-live tick (~30s later) would re-attempt
    // and re-fail in a tight loop, hammering both Meta's API and the
    // operator's quota. We're not interested in retrying a failed send
    // here — the DB row records the failure and `/operator` surfaces it
    // — so advancing the clock on attempt prevents the loop while
    // preserving the original throttle semantics (one alert per 6h key).
    //
    // Phase A 2026-05-29: use `attemptedAlert` (not `shouldSendWhatsapp`)
    // so budget_skip operations also advance the clock. The send was
    // intentionally suppressed — the attempt still counts for throttling.
    if (attemptedAlert) {
      payload.last_alert_sent_at = new Date(now).toISOString();
    }
    const { error } = await sb
      .from('token_failures')
      .upsert(payload, {
        onConflict: 'provider,store_id,operation',
      });
    if (error) {
      console.warn(
        `tokenFailures: upsert failed for ${provider}/${storeId}/${operation}: ${error.message}`,
      );
    } else {
      result.dbWritten = true;
    }
  } catch (e) {
    console.warn(
      `tokenFailures: upsert threw for ${provider}/${storeId}/${operation}: ${e instanceof Error ? e.message : e}`,
    );
  }

  return result;
}

/**
 * Mark a (provider, storeId, operation) failure as resolved. Used by the
 * operator console "✓ סומן כתוקן" button. The next failure for the same
 * key will start a fresh alert cycle (last_alert_sent_at = NULL).
 *
 * P1-8 (data-consistency audit 2026-05-27): now checks and throws on
 * Supabase update errors. Previously the error was silently ignored (the
 * `.update()` return value was discarded with `await` and no capture),
 * so the route's POST handler returned `{ ok: true }` even when the DB
 * update failed due to RLS, network issues, or missing row. The operator-
 * console "סמן כתוקן" button appeared to succeed while nothing was written.
 *
 * Post-fix: throws so the route's catch block returns HTTP 500 and the
 * component shows `alert()` with the error, making the failure visible.
 */
export async function resolveTokenFailure(
  provider: TokenFailureProvider,
  storeId: TokenFailureStore,
  operation: string,
): Promise<void> {
  const sb = admin();
  if (!sb) {
    throw new Error(
      'resolveTokenFailure: SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing — cannot mark failure resolved',
    );
  }
  const { error } = await sb
    .from('token_failures')
    .update({
      resolved_at: new Date().toISOString(),
      last_alert_sent_at: null, // reset so the next failure alerts immediately
    })
    .eq('provider', provider)
    .eq('store_id', storeId)
    .eq('operation', operation);
  if (error) {
    throw new Error(
      `resolveTokenFailure: failed to mark ${provider}/${storeId}/${operation} resolved: ${error.message}`,
    );
  }
}
