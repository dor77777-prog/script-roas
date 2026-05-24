// dashboard-web/src/app/api/debug/shopify-fetch/route.ts
//
// One-time debug endpoint (Phase 05.7.6 — 2026-05-22 incident).
//
// Reveals WHY fetchShopifyDayRows() returns 0 in prod. Bypasses the
// algorithm + writer; hits Shopify Admin REST directly with the exact
// URL the fetcher would build, then returns counts + sample rows.

import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

const SHOPIFY_TZ = 'Asia/Jerusalem';
// Bumped 2026-05-22 in lockstep with the main fetcher's bump to 2026-04
// (Shopify supports the last 4 stables; 2024-10 fell out of support Jan 2026).
const SHOPIFY_API_VERSION = '2026-04';

function isoLocalMidnight(dateStr: string, tz: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) throw new Error(`bad dateStr ${dateStr}`);
  const [y, m, d] = dateStr.split('-').map(Number);
  const targetLocalAsUtc = Date.UTC(y, m - 1, d, 0, 0, 0);
  let instantMs = targetLocalAsUtc;
  for (let i = 0; i < 3; i++) {
    const local = formatLocalIso(instantMs, tz);
    const match = local.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})$/);
    if (!match) throw new Error(`bad local format ${local}`);
    const localAsUtc = Date.UTC(
      Number(match[1]), Number(match[2]) - 1, Number(match[3]),
      Number(match[4]), Number(match[5]), Number(match[6]),
    );
    const deltaMs = localAsUtc - targetLocalAsUtc;
    if (deltaMs === 0) break;
    instantMs -= deltaMs;
  }
  const offsetMin = (Date.UTC(
    ...(formatLocalIso(instantMs, tz).match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})$/)!
      .slice(1).map(Number) as [number, number, number, number, number, number]),
  ) - instantMs) / 60000;
  const sign = offsetMin >= 0 ? '+' : '-';
  const absMin = Math.abs(offsetMin);
  const oh = String(Math.floor(absMin / 60)).padStart(2, '0');
  const om = String(absMin % 60).padStart(2, '0');
  const local = formatLocalIso(instantMs, tz);
  return `${local}${sign}${oh}:${om}`;
}

function formatLocalIso(instantMs: number, tz: string): string {
  const d = new Date(instantMs);
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  });
  return fmt.format(d).replace(', ', 'T').replace(' ', 'T').replace(/T24:/, 'T00:');
}

function nextDayStr(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + 1));
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`;
}

export async function GET(req: Request) {
  // Phase 13.2 P1-02 — env-gated. Unauthenticated debug route shipped to
  // prod by mistake; cross-track audit findings (T1 security + T8 perf/obs).
  // Returns 404 unless ENABLE_DEBUG_ROUTES=1 is explicitly set in Vercel.
  // To re-enable for incident debugging: set ENABLE_DEBUG_ROUTES=1 in
  // Vercel env vars and redeploy. UNSET it once the incident is resolved.
  if (process.env.ENABLE_DEBUG_ROUTES !== '1') {
    return new NextResponse('Not Found', { status: 404 });
  }
  const url = new URL(req.url);
  const storeId = url.searchParams.get('storeId') ?? 'uzoshop';
  const date = url.searchParams.get('date') ?? '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json(
      { error: "Pass ?storeId=...&date=YYYY-MM-DD" },
      { status: 400 },
    );
  }
  const upper = storeId.toUpperCase();
  const domain = process.env[`${upper}_SHOPIFY_DOMAIN`];
  const token = process.env[`${upper}_SHOPIFY_TOKEN`];
  if (!domain || !token) {
    return NextResponse.json({
      error: 'Missing env vars',
      hasDomain: !!domain,
      hasToken: !!token,
      domainVal: domain ? domain.slice(0, 15) + '...' : null,
    }, { status: 500 });
  }

  // Build Window A URL exactly like buildWindowUrl does.
  const dayStartA = isoLocalMidnight(date, SHOPIFY_TZ);
  const dayEndA = isoLocalMidnight(nextDayStr(date), SHOPIFY_TZ);
  const fields = 'id,created_at,total_price,current_total_price,test,financial_status,line_items,refunds';
  const windowAUrl = `https://${domain}/admin/api/${SHOPIFY_API_VERSION}/orders.json?status=any&limit=250&created_at_min=${encodeURIComponent(dayStartA)}&created_at_max=${encodeURIComponent(dayEndA)}&fields=${fields}`;

  const resA = await fetch(windowAUrl, {
    method: 'GET',
    headers: { 'X-Shopify-Access-Token': token, Accept: 'application/json' },
  });
  const bodyA = await resA.text();
  let parsedA: { orders?: Array<Record<string, unknown>> } = {};
  try { parsedA = JSON.parse(bodyA); } catch { /* keep empty */ }

  return NextResponse.json({
    storeId,
    date,
    timestamp: new Date().toISOString(),
    domain,
    // AUDIT API-10 (2026-05-24, Phase 12.3): never expose any bytes of
    // the Shopify Admin token. Pre-fix `tokenPrefix: token.slice(0, 10)`
    // leaked `shpat_` scheme prefix plus the first 4 secret chars to any
    // caller and persisted in any logged copy (browser dev-tools, deploy
    // logs, screenshots). Replaced with a boolean flag — the operator
    // still gets the diagnostic signal ("is a token configured?") without
    // any secret material on the wire. hasDomain + domainVal preserved
    // (domain identifiers, not secrets).
    // Evidence: .planning/phases/12-codebase-audit-baseline/raw-returns/
    //   api_debug_shopifyFetch.json (API-10).
    hasToken: true,
    windowAUrl,
    dayStartA,
    dayEndA,
    response: {
      status: resA.status,
      ok: resA.ok,
      orderCount: parsedA.orders?.length ?? 0,
      sampleOrder: parsedA.orders?.[0] ?? null,
      bodyPrefix: bodyA.slice(0, 500),
    },
  });
}
