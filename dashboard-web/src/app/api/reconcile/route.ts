/**
 * GET /api/operator/reconcile — DQ-1 live reconciliation HTTP shim.
 *
 * Runs `reconcileLive()` (fetch the four production sources for the last ~7
 * completed IL days → pure `reconcileRows()`) and returns the resulting
 * `Violation[]`. Backs the operator data-quality panel's "live reconcile"
 * card; polled by the authed client behind the password gate (NOT in any
 * external allowlist).
 *
 * Soft-fail mirrors /api/operator/freshness: on any throw we return HTTP 200
 * with `{ violations: [], error }` so the panel renders its inline empty/error
 * state rather than escalating to a hard banner.
 */

import { NextResponse } from 'next/server';
import { reconcileLive } from '@/lib/audit/reconcileLive';
import type { Violation } from '@/lib/audit/reconcile';
import { userFacingError } from '@/lib/apiErrors';
import { captureRouteError } from '@/lib/sentry/capture';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export interface ReconcileResponse {
  violations: Violation[];
  error?: string;
}

export async function GET() {
  try {
    const violations = await reconcileLive();
    return NextResponse.json<ReconcileResponse>({ violations });
  } catch (e) {
    captureRouteError('/api/operator/reconcile', e);
    const rawMessage = e instanceof Error ? e.message : String(e);
    console.error('/api/operator/reconcile GET threw:', rawMessage);
    return NextResponse.json<ReconcileResponse>(
      { violations: [], error: userFacingError(rawMessage) },
      { status: 200 },
    );
  }
}
