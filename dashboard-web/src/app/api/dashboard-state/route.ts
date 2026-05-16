import { NextResponse } from 'next/server';
import { fetchDashboardState, upsertDashboardStateKey } from '@/lib/sheets';

// State updates are user-driven (clicking save in BillingSettings, etc.) — no
// hard need to revalidate aggressively. We let the client poll us every ~30s.
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const data = await fetchDashboardState();
    return NextResponse.json(
      { kv: data.kv, updatedAtByKey: data.updatedAtByKey, lastUpdated: new Date().toISOString() },
      {
        headers: {
          // Short s-maxage so concurrent partners pick up edits quickly. SWR
          // will dedupe in-browser; this just lets the CDN coalesce bursts.
          'Cache-Control': 'public, s-maxage=10, stale-while-revalidate=60',
        },
      },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('dashboard-state GET failed:', message);
    return NextResponse.json({ kv: {}, error: message }, { status: 200 });
  }
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as { key?: string; value?: unknown };
    if (!body.key || typeof body.key !== 'string') {
      return NextResponse.json({ error: 'missing key' }, { status: 400 });
    }
    await upsertDashboardStateKey(body.key, body.value ?? null);
    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('dashboard-state POST failed:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
