// dashboard-web/src/app/api/operator/stores/[id]/restore/route.ts
// Self-serve stores Phase 6b — Task 1: restore ONE archived store (reversible).
//
// POST /api/operator/stores/[id]/restore — flips the `stores` row's lifecycle
//   status back to 'active' (and clears archived_at = null). SAFE / REVERSIBLE:
//   NO data table is ever touched — only the stores row's status/archived_at.
//   A restored store re-appears on every live surface (home/totals/goal) AND in
//   the cron loop, because getStores()/loadActiveStoreIds() include active rows.
//
//   Validation: 400 for a RESERVED store id (__global__), 404 for an unknown
//   store. Idempotent — restoring an already-active store is a 200 no-op.
//
//   NEVER touches any data row, never echoes a secret.
//
// Auth: gated upstream by middleware. Service-role client only (writes bypass
// RLS). The response carries only { ok, store:{storeId, status} } — no secrets.
import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { RESERVED_STORE_IDS } from '@/lib/storeSecretsReader';
import { captureRouteError } from '@/lib/sentry/capture';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type RouteCtx = { params: Promise<{ id: string }> };

export async function POST(_req: Request, ctx: RouteCtx): Promise<NextResponse> {
  const { id } = await ctx.params;

  // Reject reserved ids (incl. __global__) before any DB read.
  if ((RESERVED_STORE_IDS as readonly string[]).includes(id)) {
    return NextResponse.json({ error: 'storeId is reserved' }, { status: 400 });
  }

  try {
    const admin = getSupabaseAdmin();

    // Store must exist (404). No data is read beyond the lifecycle column.
    const { data: store, error: storeErr } = await admin
      .from('stores')
      .select('id, status')
      .eq('id', id)
      .maybeSingle();
    if (storeErr) throw new Error(storeErr.message);
    if (!store) {
      return NextResponse.json({ error: 'store not found' }, { status: 404 });
    }

    // Status flip ONLY — no data row is touched. Idempotent (already-active
    // → the same UPDATE is harmless and still returns 200).
    const now = new Date().toISOString();
    const { error: updErr } = await admin
      .from('stores')
      .update({ status: 'active', archived_at: null, updated_at: now })
      .eq('id', id);
    if (updErr) throw new Error(`stores restore update failed: ${updErr.message}`);

    return NextResponse.json(
      { ok: true, store: { storeId: id, status: 'active' } },
      { status: 200 },
    );
  } catch (err) {
    captureRouteError('operator/stores/[id]/restore', err);
    console.error(
      `/api/operator/stores/${id}/restore POST failed:`,
      err instanceof Error ? err.message : String(err),
    );
    return NextResponse.json(
      { error: 'שחזור החנות נכשל', code: 'store_restore_failed' },
      { status: 500 },
    );
  }
}
