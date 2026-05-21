// dashboard-web/src/app/api/operator/reset/route.ts
//
// Phase 05.7.1 — operator "Reset Data" destructive endpoint.
//
// POST /api/operator/reset with body { scope: 'all' | 'except-manual',
// confirm: 'YES-DELETE-ALL-DATA' | 'YES-DELETE-EXCEPT-MANUAL' } wipes the
// Phase 05.5 data tables in Supabase. The operator triggers this from the
// /operator console (ResetData component) when they want to re-run backfill
// from a known-empty state to verify the dashboard end-to-end.
//
// === Why service_role (not anon) ===
//
// Same rationale as sibling manual-overrides route. The 20260521075741
// grants migration handed anon SELECT-only. DELETE requires an
// authenticated role; getSupabaseAdmin() is the simplest path with the
// URL-obscurity trust model (D-D2, Phase 05.5).
//
// === Why a literal confirmation token (defense in depth) ===
//
// URL-obscurity is the entire auth posture. The UI guards the click with
// a modal that requires the operator to type the literal token by hand —
// but a hand-crafted curl could skip the UI entirely. Requiring the same
// literal string in the request body means a destructive call must be
// deliberate at *both* layers; a stray POST with `{"scope":"all"}` and no
// confirm field gets a 400 without touching Postgres. The cost is one
// string equality check; the upside is the same "you must type these
// exact characters" friction the UI imposes.
//
// === Why two scopes ===
//
// `all` wipes everything including manual_overrides. Reserved for the
// "I want a completely fresh slate" workflow.
//
// `except-manual` preserves the manual_overrides table because those
// 38+ rows are hand-typed and represent days the operator's already
// reconciled — re-entering them after every reset would be tedious and
// erodes the data-quality discipline they encode (Phase 05.5 D-A5 row 2,
// load-bearing per the importer's idempotent ON CONFLICT contract).
//
// === What this endpoint does NOT touch ===
//
// `stores`, `notification_config`, `dashboard_state`. The first two are
// seeded config (3 store rows + 2 provider rows from Phase 05.5); the
// third holds the operator's UI prefs (annotations, billing recurring/
// onetime, monthly revenue goal, campaign-product map, etc.) — wiping
// it would discard hand-curated state that no backfill can rebuild.
// These three tables are explicitly absent from the DATA_TABLES list
// below; the array is the single source of truth for "what counts as
// reset-able data".
//
// === Why .not('store_id', 'is', null) as the universal filter ===
//
// supabase-js requires a filter on .delete() so a bare DELETE never
// fires (Pattern matching the deliberate "you must opt in to all-rows"
// safety in PostgREST). All 7 DATA_TABLES have store_id NOT NULL —
// verified against 20260521063112_initial_schema.sql + 20260521075741
// FK migration (every *_daily / orders_attribution / product_catalog /
// manual_overrides table FKs store_id → stores(id)). The filter is
// therefore always-true and selects every row — exactly what we want.
//
// Why NOT .neq('id', 0) or .gte('updated_at', '1900-01-01'): not every
// table has an `id` column (the *_daily tables use composite PKs); not
// every table has `updated_at` (data_daily / products_daily / campaigns_
// daily / ads_daily / orders_attribution don't). store_id is the only
// column present on ALL 7 tables, so it's the universal filter — one
// shape covers every table.
//
// === Why count: 'exact' + per-table try/catch ===
//
// The response payload reports how many rows were deleted per table so
// the operator sees confirmation in the toast (e.g. "deleted 47 from
// data_daily, 132 from products_daily, ..."). { count: 'exact' } is the
// PostgREST way to request an exact count for the affected rows.
//
// Each table delete is wrapped individually so a partial failure (e.g.
// product_catalog hits an unexpected FK that wasn't anticipated) still
// returns a useful response with the tables that did succeed — the
// operator gets actionable signal instead of an opaque 500. Failures
// surface in the response under deleted[table] = -1 + errors[table]
// so the UI can amber-flag them while still showing the successes.
//
// === Why force-dynamic ===
//
// POST route, nothing to cache. Same single-declaration pattern as
// sibling routes (Pitfall 11 from Phase 05.6 RESEARCH).

import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { userFacingError } from '@/lib/apiErrors';
import {
  DATA_TABLES,
  EXCEPT_MANUAL_TABLES,
  type ResetScope,
  validateResetBody,
} from '@/lib/operatorReset';

export const dynamic = 'force-dynamic';

type ResetResponse = {
  scope: ResetScope;
  deleted: Record<string, number>;
  errors?: Record<string, string>;
  total: number;
  durationMs: number;
};

export async function POST(req: Request) {
  const startedAt = Date.now();
  try {
    const raw = await req.json().catch(() => null);
    const valid = validateResetBody(raw);
    if (typeof valid === 'string') {
      return NextResponse.json({ error: valid }, { status: 400 });
    }

    const tables =
      valid.scope === 'all' ? DATA_TABLES : EXCEPT_MANUAL_TABLES;
    const supabase = getSupabaseAdmin();

    const deleted: Record<string, number> = {};
    const errors: Record<string, string> = {};

    for (const table of tables) {
      try {
        // Universal always-true filter: every table in DATA_TABLES has
        // store_id NOT NULL, so `.not('store_id', 'is', null)` matches
        // every row. See file-level comment for why store_id rather than
        // id / updated_at.
        const { count, error } = await supabase
          .from(table)
          .delete({ count: 'exact' })
          .not('store_id', 'is', null);
        if (error) {
          console.error(
            `/api/operator/reset DELETE ${table} failed:`,
            error.message,
          );
          deleted[table] = -1;
          errors[table] = userFacingError(error.message);
          continue;
        }
        deleted[table] = count ?? 0;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(
          `/api/operator/reset DELETE ${table} threw:`,
          message,
        );
        deleted[table] = -1;
        errors[table] = userFacingError(message);
      }
    }

    const total = Object.values(deleted).reduce(
      // -1 sentinels (per-table failures) shouldn't pad the total
      (sum, n) => (n >= 0 ? sum + n : sum),
      0,
    );

    const body: ResetResponse = {
      scope: valid.scope,
      deleted,
      total,
      durationMs: Date.now() - startedAt,
    };
    if (Object.keys(errors).length > 0) {
      body.errors = errors;
    }

    // 200 even on partial failure — the response shape carries the
    // per-table outcome. A hard 5xx here would lose the per-table
    // detail and force the UI to discard the successes. The UI checks
    // `errors` to amber-flag the partial-failure case.
    return NextResponse.json(body);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('/api/operator/reset POST threw:', message);
    return NextResponse.json(
      { error: userFacingError(message) },
      { status: 500 },
    );
  }
}

// NOTE: confirmation tokens (CONFIRM_TOKEN_ALL / CONFIRM_TOKEN_EXCEPT_MANUAL)
// and the validator (validateResetBody) live in @/lib/operatorReset so they
// can be re-used by the client ResetData component without dragging the
// supabase-admin import into the client bundle. Single source of truth.
