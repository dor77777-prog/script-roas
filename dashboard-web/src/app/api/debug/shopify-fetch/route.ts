// dashboard-web/src/app/api/debug/shopify-fetch/route.ts
//
// One-time debug endpoint (Phase 05.7.6 — 2026-05-22 incident).
//
// Investigates why fetchShopifyDayRows() returns revenueCad=0 in
// production even though the Shopify Admin API directly returns the
// order. Hits the fetcher for the requested store+date and returns the
// raw result so we can pinpoint where the data is lost.
//
// SECURITY: read-only; reads same env vars as cronDaily; no destructive
// actions. The endpoint is gated only by URL obscurity (matches the
// rest of /api/operator/*). Safe to remove or leave in place after the
// incident is resolved.

import { NextResponse } from 'next/server';
import { fetchShopifyDayRows } from '@/lib/fetchers/shopify';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const url = new URL(req.url);
  const storeId = url.searchParams.get('storeId') ?? 'uzoshop';
  const date = url.searchParams.get('date') ?? '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json(
      { error: "Pass ?storeId=...&date=YYYY-MM-DD" },
      { status: 400 },
    );
  }
  try {
    const result = await fetchShopifyDayRows(storeId, date);
    return NextResponse.json({
      ok: true,
      storeId,
      date,
      result,
      productRowsCount: result.productRows.length,
      summary: {
        revenueCad: result.revenueCad,
        grossRevenueCad: result.grossRevenueCad,
        refundDeductionCad: result.refundDeductionCad,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { ok: false, storeId, date, error: message },
      { status: 500 },
    );
  }
}
