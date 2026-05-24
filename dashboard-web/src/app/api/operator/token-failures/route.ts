/**
 * Phase 05.7.x (2026-05-23) — operator token-failure feed.
 *
 * GET /api/operator/token-failures
 *   Returns the latest unresolved + recently-resolved token failure rows
 *   for the operator console. Includes 30-day window so resolved items
 *   stay visible briefly (operator can confirm fix worked).
 *
 * POST /api/operator/token-failures
 *   Body: { action: 'resolve', provider, store_id, operation }
 *   Marks a failure resolved. Next failure for the same key starts a
 *   fresh alert cycle (last_alert_sent_at = NULL).
 *
 * Security: routes the SUPABASE_SERVICE_ROLE_KEY through a server-side
 * client; the role key NEVER reaches the browser. URL-obscurity trust
 * model — no auth check (same posture as the rest of /api/operator/*).
 */

import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import {
  resolveTokenFailure,
  type TokenFailureProvider,
  type TokenFailureStore,
} from '@/lib/notifications/tokenFailures';
import { userFacingError } from '@/lib/apiErrors';

export const runtime = 'nodejs';
// No cache — operator wants live state.
export const dynamic = 'force-dynamic';

function admin() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error(
      '/api/operator/token-failures: missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY',
    );
  }
  return createClient(url, key, { auth: { persistSession: false } });
}

export type TokenFailureRow = {
  provider: string;
  storeId: string;
  operation: string;
  firstSeenAt: string;
  lastSeenAt: string;
  lastAlertSentAt: string | null;
  seenCount: number;
  alertsSentCount: number;
  lastErrorMsg: string;
  lastAdvice: string | null;
  resolvedAt: string | null;
};

export type TokenFailuresResponse = {
  rows: TokenFailureRow[];
  lastUpdated: string;
};

export async function GET() {
  try {
    const sb = admin();
    // Show unresolved + anything resolved in the last 7 days, ordered
    // unresolved-first then by last_seen_at DESC.
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    type DbRow = {
      provider: string;
      store_id: string;
      operation: string;
      first_seen_at: string;
      last_seen_at: string;
      last_alert_sent_at: string | null;
      seen_count: number;
      alerts_sent_count: number;
      last_error_msg: string | null;
      last_advice: string | null;
      resolved_at: string | null;
    };
    const { data, error } = (await sb
      .from('token_failures')
      .select(
        'provider, store_id, operation, first_seen_at, last_seen_at, ' +
          'last_alert_sent_at, seen_count, alerts_sent_count, last_error_msg, ' +
          'last_advice, resolved_at',
      )
      .or(`resolved_at.is.null,resolved_at.gte.${sevenDaysAgo}`)
      .order('resolved_at', { ascending: true, nullsFirst: true })
      .order('last_seen_at', { ascending: false })) as {
      data: DbRow[] | null;
      error: { message: string } | null;
    };
    if (error) {
      // AUDIT API-37 (2026-05-24, Phase 12.3): userFacingError redacts
      // Supabase error.message strings that could embed RLS hints,
      // table names, or JWT fragments. Raw message still flows to
      // console.error for server-side ops triage. Evidence:
      // .planning/phases/12-codebase-audit-baseline/raw-returns/
      //   api_operator_tokenFailures.json (API-37).
      console.error(
        '/api/operator/token-failures GET supabase error:',
        error.message,
      );
      return NextResponse.json(
        {
          error: userFacingError(error.message),
          rows: [],
          lastUpdated: new Date().toISOString(),
        },
        { status: 200 },
      );
    }
    const rows: TokenFailureRow[] = (data ?? []).map((r) => ({
      provider: String(r.provider),
      storeId: String(r.store_id),
      operation: String(r.operation),
      firstSeenAt: String(r.first_seen_at),
      lastSeenAt: String(r.last_seen_at),
      lastAlertSentAt: r.last_alert_sent_at ? String(r.last_alert_sent_at) : null,
      seenCount: Number(r.seen_count ?? 0),
      alertsSentCount: Number(r.alerts_sent_count ?? 0),
      lastErrorMsg: String(r.last_error_msg ?? ''),
      lastAdvice: r.last_advice ? String(r.last_advice) : null,
      resolvedAt: r.resolved_at ? String(r.resolved_at) : null,
    }));
    return NextResponse.json({
      rows,
      lastUpdated: new Date().toISOString(),
    } satisfies TokenFailuresResponse);
  } catch (e) {
    // AUDIT API-38 (2026-05-24, Phase 12.3): catch-path redaction. The
    // local admin() helper throws with the literal 'missing SUPABASE_URL
    // / SUPABASE_SERVICE_ROLE_KEY' message — pre-fix that text would leak
    // to the browser response. userFacingError maps it to a generic
    // Hebrew message; raw still flows to console.error for ops.
    // Evidence: raw-returns/api_operator_tokenFailures.json (API-38).
    const rawMessage = e instanceof Error ? e.message : String(e);
    console.error('/api/operator/token-failures GET threw:', rawMessage);
    return NextResponse.json(
      {
        error: userFacingError(rawMessage),
        rows: [],
        lastUpdated: new Date().toISOString(),
      },
      { status: 500 },
    );
  }
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as {
      action?: string;
      provider?: string;
      store_id?: string;
      operation?: string;
    };
    if (body.action !== 'resolve') {
      return NextResponse.json(
        { error: `unknown action: ${body.action}` },
        { status: 400 },
      );
    }
    const provider = String(body.provider ?? '').trim() as TokenFailureProvider;
    const storeId = String(body.store_id ?? '').trim() as TokenFailureStore;
    const operation = String(body.operation ?? '').trim();
    const validProviders: TokenFailureProvider[] = [
      'meta',
      'google',
      'tiktok',
      'whatsapp',
      'shopify',
      'fx',
    ];
    const validStores: TokenFailureStore[] = [
      'uzoshop',
      'zolplus',
      'usmile360',
      'global',
    ];
    if (!validProviders.includes(provider)) {
      return NextResponse.json({ error: `invalid provider: ${provider}` }, { status: 400 });
    }
    if (!validStores.includes(storeId)) {
      return NextResponse.json({ error: `invalid store_id: ${storeId}` }, { status: 400 });
    }
    if (!operation) {
      return NextResponse.json({ error: 'operation is required' }, { status: 400 });
    }
    await resolveTokenFailure(provider, storeId, operation);
    return NextResponse.json({ ok: true });
  } catch (e) {
    // AUDIT API-38 (2026-05-24, Phase 12.3): same redaction posture as
    // GET catch — resolveTokenFailure throws with raw Supabase
    // SUPABASE_SERVICE_ROLE_KEY / JWT fragments that must not leak to
    // the browser. Raw still logs to console.error.
    const rawMessage = e instanceof Error ? e.message : String(e);
    console.error('/api/operator/token-failures POST threw:', rawMessage);
    return NextResponse.json(
      { error: userFacingError(rawMessage) },
      { status: 500 },
    );
  }
}
