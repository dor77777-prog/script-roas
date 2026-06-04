// dashboard-web/src/app/api/operator/manual-overrides/route.ts
//
// CRUD route for the operator console's manual_overrides table editor.
// Backs the ManualOverridesCrud client component (UI in plan 15 / wave 4).
//
// Why service_role (not anon):
//   `20260521075741_add_constraints_and_grants.sql` granted SELECT-only to
//   anon. INSERT / UPDATE / DELETE need an authenticated role, so all 4
//   verbs use `getSupabaseAdmin()`. This file is server-only — never
//   importable from a client component (the supabaseAdmin module enforces
//   that contract; see its docstring).
//
// Why `force-dynamic` (no `revalidate`):
//   CRUD is per-request — there's nothing to cache. Per RESEARCH §Pitfall
//   11, declaring both `force-dynamic` and `revalidate` is a conflict where
//   `force-dynamic` silently wins; we pick the correct single declaration.
//
// Why HTTP 200 on GET-error path (S-2 soft-fail):
//   Matches `dashboard-state/route.ts:46-54` — GET returns `{rows: [],
//   error: userFacingError(...)}` with status 200 so the client surfaces
//   the sanitized message rather than crashing on `data.rows.map`. POST /
//   PATCH / DELETE return 4xx/5xx so the client's catch-block sees the
//   failure and shows it next to the failing form, not in a global toast.
//
// Why platform/currency normalisation:
//   The CHECK constraint `manual_overrides_platform_check` requires lowercase
//   `meta`/`google`/`tiktok` (per Phase 05.5 WR-07; tiktok added by migration
//   20260522102151 and unblocked app-side 2026-06-02). Pitfall 7 documents how
//   the legacy `manual-spend` Sheets tab stores `'Meta'` / `'Google'`; the UI
//   lowercases pre-submit and the server lowercases again — defense in
//   depth so a hand-crafted curl with `"Meta"` doesn't reach Postgres
//   with the wrong case and trip the CHECK with a leaky error message.

import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { userFacingError } from '@/lib/apiErrors';
import { isDate } from '@/lib/dateValidation';
import { captureRouteError } from '@/lib/sentry/capture';
// AUDIT API-26 (Phase 12.3): pure validators extracted to a sibling
// lib module so they can be `export`ed for unit tests. Next 14 forbids
// non-HTTP-verb exports from app/**/route.ts modules (typed via the
// generated OmitWithTag<typeof routeModule, GET | POST | ...>
// constraint that materializes during `next build` / `tsc --noEmit`).
import {
  parseStrictNumeric,
  validatePost,
  VALID_STORES,
  VALID_PLATFORMS,
  VALID_CURRENCIES,
} from '@/lib/operatorManualOverrides';

export const dynamic = 'force-dynamic';
// NOTE: revalidate is intentionally NOT exported here — see Pitfall 11.
// force-dynamic is the sole cache directive on CRUD routes.

// Strict YYYY-MM-DD calendar-day validation lives in `@/lib/dateValidation`
// — shared with `/api/operator/backfill`. See that file for the rationale
// (regex + Date.UTC round-trip rejects normalized impossible dates so
// `2026-99-99` doesn't silently become a real downstream date).

/**
 * GET — list all overrides, newest-first by date, then store. anon could
 * technically do this read (SELECT grant is in place) but we use the same
 * admin client for symmetry across the four verbs, and because the operator
 * console is the only caller (single-user, URL-obscurity per D-D2 — no
 * extra surface from using service_role here).
 */
export async function GET() {
  try {
    const { data, error } = await getSupabaseAdmin()
      .from('manual_overrides')
      .select('id, date, store_id, platform, spend, currency, notes, created_at')
      .order('date', { ascending: false })
      .order('store_id', { ascending: true });
    if (error) {
      console.error('/api/operator/manual-overrides GET failed:', error.message);
      return NextResponse.json(
        { rows: [], error: userFacingError(error.message) },
        { status: 200 },
      );
    }
    return NextResponse.json({ rows: data ?? [] });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    captureRouteError('operator/manual-overrides-get', err);
    console.error('/api/operator/manual-overrides GET threw:', message);
    return NextResponse.json(
      { rows: [], error: userFacingError(message) },
      { status: 200 },
    );
  }
}

/**
 * POST — upsert by (date, store_id, platform). `onConflict` matches the
 * UNIQUE constraint added in WR-fix migration `20260521075741`. If the
 * operator re-submits the same triple, the existing row is updated in
 * place; this is the same semantics the importer (Pattern 11) relies on.
 */
export async function POST(req: Request) {
  try {
    const raw = await req.json();
    const valid = validatePost(raw);
    if (typeof valid === 'string') {
      return NextResponse.json({ error: valid }, { status: 400 });
    }
    // DQ-3 (2026-06-04): stamp updated_at on every write so the manual-spend
    // audit trail (updated_at col, migration 20260604130000) populates going
    // forward. overridesActive() prefers updated_at over created_at for its
    // "last edited" timestamp.
    const { data, error } = await getSupabaseAdmin()
      .from('manual_overrides')
      .upsert({ ...valid, updated_at: new Date().toISOString() }, { onConflict: 'date,store_id,platform' })
      .select();
    if (error) {
      console.error('/api/operator/manual-overrides POST failed:', error.message);
      return NextResponse.json(
        { error: userFacingError(error.message) },
        { status: 400 },
      );
    }
    return NextResponse.json({ row: data?.[0] ?? null }, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    captureRouteError('operator/manual-overrides-post', err);
    console.error('/api/operator/manual-overrides POST threw:', message);
    return NextResponse.json(
      { error: userFacingError(message) },
      { status: 500 },
    );
  }
}

/**
 * PATCH — update one row by id. Validates only the fields that are
 * provided; partial updates are permitted (so the operator can edit just
 * the `spend` or `notes` without re-asserting the full row). Platform /
 * currency get the same normalisation as POST.
 */
export async function PATCH(req: Request) {
  try {
    const raw = await req.json();
    if (!raw || typeof raw !== 'object') {
      return NextResponse.json({ error: 'body must be a JSON object' }, { status: 400 });
    }
    const body = raw as { id?: unknown } & Record<string, unknown>;
    if (typeof body.id !== 'number' || !Number.isFinite(body.id)) {
      return NextResponse.json({ error: 'id required' }, { status: 400 });
    }
    const { id, ...rest } = body;
    const patch: Record<string, unknown> = {};
    if (rest.date !== undefined) {
      if (!isDate(rest.date)) {
        return NextResponse.json({ error: 'date must be YYYY-MM-DD' }, { status: 400 });
      }
      patch.date = rest.date;
    }
    if (rest.store_id !== undefined) {
      if (typeof rest.store_id !== 'string' || !VALID_STORES.has(rest.store_id)) {
        return NextResponse.json({ error: `unknown store_id: ${String(rest.store_id)}` }, { status: 400 });
      }
      patch.store_id = rest.store_id;
    }
    if (rest.platform !== undefined) {
      const platform = String(rest.platform).toLowerCase();
      if (!VALID_PLATFORMS.has(platform)) {
        return NextResponse.json({ error: "platform must be 'meta', 'google', or 'tiktok'" }, { status: 400 });
      }
      patch.platform = platform;
    }
    if (rest.currency !== undefined) {
      const currency = String(rest.currency).toUpperCase();
      if (!VALID_CURRENCIES.has(currency)) {
        return NextResponse.json({ error: 'currency must be ILS/CAD/USD' }, { status: 400 });
      }
      patch.currency = currency;
    }
    if (rest.spend !== undefined) {
      // AUDIT API-26 (Phase 12.3): strict regex via parseStrictNumeric
      // (mirrors POST validatePost). Pre-fix used parseFloat which
      // silently truncated trailing garbage ('1500NIS' → 1500).
      const spend = parseStrictNumeric(rest.spend);
      if (!Number.isFinite(spend)) {
        return NextResponse.json({ error: 'spend must be numeric' }, { status: 400 });
      }
      patch.spend = spend;
    }
    if (rest.notes !== undefined) {
      patch.notes = rest.notes === null ? null : String(rest.notes);
    }
    if (Object.keys(patch).length === 0) {
      return NextResponse.json({ error: 'no fields to update' }, { status: 400 });
    }
    // DQ-3 (2026-06-04): stamp updated_at on the write (after the empty-patch
    // guard, so a body carrying only `id` is still rejected) — populates the
    // manual-spend audit trail (updated_at col, migration 20260604130000).
    patch.updated_at = new Date().toISOString();
    const { data, error } = await getSupabaseAdmin()
      .from('manual_overrides')
      .update(patch)
      .eq('id', id)
      .select();
    if (error) {
      console.error('/api/operator/manual-overrides PATCH failed:', error.message);
      return NextResponse.json(
        { error: userFacingError(error.message) },
        { status: 400 },
      );
    }
    return NextResponse.json({ row: data?.[0] ?? null });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('/api/operator/manual-overrides PATCH threw:', message);
    return NextResponse.json(
      { error: userFacingError(message) },
      { status: 500 },
    );
  }
}

/**
 * DELETE — remove one row by id (id comes in the request body, NOT a path
 * param — Next.js supports body on DELETE and this is simpler than carving
 * out a `[id]` segment for a single CRUD verb). The UI guards this with a
 * confirmation modal per RESEARCH §Open Question 5 (single-user URL-
 * obscurity trust model needs a soft accidental-wipe guard).
 */
export async function DELETE(req: Request) {
  try {
    const raw = await req.json();
    if (!raw || typeof raw !== 'object') {
      return NextResponse.json({ error: 'body must be a JSON object' }, { status: 400 });
    }
    const body = raw as { id?: unknown };
    if (typeof body.id !== 'number' || !Number.isFinite(body.id)) {
      return NextResponse.json({ error: 'id required' }, { status: 400 });
    }
    const { error } = await getSupabaseAdmin()
      .from('manual_overrides')
      .delete()
      .eq('id', body.id);
    if (error) {
      console.error('/api/operator/manual-overrides DELETE failed:', error.message);
      return NextResponse.json(
        { error: userFacingError(error.message) },
        { status: 400 },
      );
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('/api/operator/manual-overrides DELETE threw:', message);
    return NextResponse.json(
      { error: userFacingError(message) },
      { status: 500 },
    );
  }
}
