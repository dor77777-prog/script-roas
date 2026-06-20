/**
 * freshness.ts — per-(store, platform, scope, table) staleness tracker
 *
 * Backs:
 *  - /operator freshness panel (Task 15): renders the lag matrix via getFreshness()
 *  - cron pre-flight gates (Tasks 12-14): each cron tick calls recordFreshness()
 *    after its work to log the outcome.
 *
 * Table: data_freshness
 * PK:    (store_id, platform, scope, table_name)
 *
 * lag_minutes is computed AT WRITE TIME:
 *   - status === 'success' → 0 (just refreshed)
 *   - else, prior last_success_at exists → floor((now - last_success_at) / 60_000)
 *   - else → null (never succeeded; lag undefined)
 *
 * Error swallow pattern: console.warn('[recordFreshness] …') — same as
 * recordMetaBucUsage in src/lib/notifications/metaBucUsage.ts so that a DB
 * hiccup during a cron tick does not crash the entire Inngest function.
 */

import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { captureStepError } from '@/lib/sentry/capture';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type FreshnessStatus =
  | 'success'
  | 'transient_error'
  | 'auth_error'
  | 'budget_skip'
  | 'parse_error';

export type FreshnessRow = {
  store_id: string;
  platform: string;
  scope: string;
  table_name: string;
  last_attempt_at: string;
  last_success_at: string | null;
  status: string;
  lag_minutes: number | null;
  error_code: string | null;
  error_message: string | null;
  budget_skip: boolean;
  updated_at: string;
};

// ---------------------------------------------------------------------------
// recordFreshness
// ---------------------------------------------------------------------------

const ERROR_MSG_MAX_LEN = 500;

export async function recordFreshness(opts: {
  // string (not the 3-literal): freshness only persists store_id to a text column; self-serve stores flow here in Phase 4
  storeId: string;
  platform: 'meta' | 'google' | 'tiktok' | 'shopify';
  scope: string;       // e.g. 'kpi_daily', 'campaign_status', …
  tableName: string;   // e.g. 'data_daily', 'campaigns_daily', 'campaign_registry'
  status: FreshnessStatus;
  errorCode?: string;      // e.g. 'META_BUDGET_HIGH', 'AUTH_INVALID', '429'
  errorMessage?: string;   // human-readable; truncated to 500 chars
  budgetSkip?: boolean;    // explicit override; defaults to (status === 'budget_skip')
}): Promise<void> {
  try {
    const sb = getSupabaseAdmin();
    const now = new Date(Date.now());
    const nowIso = now.toISOString();

    // 2. Compute derived fields.
    const isSuccess = opts.status === 'success';

    // 1. Read existing row to preserve last_success_at when this call is not a
    //    success. FIX #11: supabase-js does NOT reject on a DB-layer error
    //    (RLS/constraint/type) — it resolves with `{ error }`. Destructure it
    //    so a failed read is SURFACED instead of silently dropped.
    const { data: existing, error: readError } = await sb
      .from('data_freshness')
      .select('*')
      .eq('store_id', opts.storeId)
      .eq('platform', opts.platform)
      .eq('scope', opts.scope)
      .eq('table_name', opts.tableName)
      .maybeSingle();

    if (readError) {
      console.warn('[recordFreshness] prior-row read error:', readError.message);
      captureStepError(
        { fnId: 'recordFreshness', stepName: 'read-prior-row', storeId: opts.storeId },
        new Error(readError.message),
        { platform: opts.platform, scope: opts.scope, tableName: opts.tableName },
      );
      // FIX #18: on a NON-success tick we DERIVE last_success_at from the prior
      // row. If that read failed we cannot trust the prior value — writing now
      // would resolve last_success_at to null and CLOBBER a known-good
      // timestamp, flipping a healthy scope to "never succeeded". Skip the
      // write entirely. (A success tick is safe — last_success_at = now, not
      // derived — so we let it proceed.)
      if (!isSuccess) return;
    }

    let lastSuccessAt: string | null;
    let lagMinutes: number | null;

    if (isSuccess) {
      lastSuccessAt = nowIso;
      lagMinutes = 0;
    } else {
      const priorSuccessAt: string | null =
        (existing as FreshnessRow | null)?.last_success_at ?? null;

      lastSuccessAt = priorSuccessAt;

      if (priorSuccessAt) {
        const diffMs = now.getTime() - new Date(priorSuccessAt).getTime();
        lagMinutes = Math.floor(diffMs / 60_000);
      } else {
        lagMinutes = null;
      }
    }

    const errorMessage = opts.errorMessage
      ? opts.errorMessage.slice(0, ERROR_MSG_MAX_LEN)
      : null;

    const budgetSkip = opts.budgetSkip ?? opts.status === 'budget_skip';

    // 3. Upsert. FIX #11: destructure `{ error }` — supabase-js resolves (does
    //    NOT reject) on a DB-layer error, so the prior bare `await` silently
    //    dropped RLS/constraint/type failures, letting a broken pipeline look
    //    healthy. Surface it.
    const { error: upsertError } = await sb.from('data_freshness').upsert(
      {
        store_id: opts.storeId,
        platform: opts.platform,
        scope: opts.scope,
        table_name: opts.tableName,
        last_attempt_at: nowIso,
        last_success_at: lastSuccessAt,
        status: opts.status,
        lag_minutes: lagMinutes,
        error_code: isSuccess ? null : (opts.errorCode ?? null),
        error_message: isSuccess ? null : errorMessage,
        budget_skip: budgetSkip,
        updated_at: nowIso,
      },
      { onConflict: 'store_id,platform,scope,table_name' },
    );

    if (upsertError) {
      console.warn('[recordFreshness] upsert error:', upsertError.message);
      captureStepError(
        { fnId: 'recordFreshness', stepName: 'upsert', storeId: opts.storeId },
        new Error(upsertError.message),
        { platform: opts.platform, scope: opts.scope, tableName: opts.tableName },
      );
    }
  } catch (e) {
    // Network/transport REJECTION (rare for supabase-js). Keep the soft-fail so
    // a DB hiccup during a cron tick does not crash the Inngest function, but
    // still surface it to Sentry so it is not invisible.
    console.warn('[recordFreshness] upsert failed:', e);
    captureStepError(
      { fnId: 'recordFreshness', stepName: 'upsert-throw', storeId: opts.storeId },
      e,
      { platform: opts.platform, scope: opts.scope, tableName: opts.tableName },
    );
  }
}

// ---------------------------------------------------------------------------
// getFreshness
// ---------------------------------------------------------------------------

export async function getFreshness(scope?: string): Promise<FreshnessRow[]> {
  try {
    const sb = getSupabaseAdmin();
    const base = sb.from('data_freshness').select('*');
    const ORDER_OPTS = { ascending: false, nullsFirst: false } as const;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data } = await (scope
      ? (base as any).eq('scope', scope).order('lag_minutes', ORDER_OPTS)
      : (base as any).order('lag_minutes', ORDER_OPTS)
    ) as { data: FreshnessRow[] | null; error: unknown };

    return data ?? [];
  } catch (e) {
    console.warn('[getFreshness] read failed:', e);
    return [];
  }
}
