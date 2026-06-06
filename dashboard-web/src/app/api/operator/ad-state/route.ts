// dashboard-web/src/app/api/operator/ad-state/route.ts
// ads-off Phase 1 — operator reads/sets the per (store, platform) toggle.
// Gated upstream by middleware (dashboard cookie + operator secret).
import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { captureRouteError } from '@/lib/sentry/capture';
import type { AdStateMap, AdPlatform } from '@/lib/adState';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const PLATFORMS: readonly AdPlatform[] = ['meta', 'google', 'tiktok'];

export async function GET(): Promise<NextResponse> {
  try {
    const { data, error } = await getSupabaseAdmin()
      .from('store_ad_state')
      .select('store_id, platform, enabled');
    if (error) throw new Error(error.message);
    const map: AdStateMap = {};
    for (const r of (data ?? []) as Array<{ store_id: string; platform: string; enabled: boolean }>) {
      map[`${r.store_id}:${r.platform}`] = r.enabled !== false;
    }
    return NextResponse.json({ map });
  } catch (err) {
    captureRouteError('operator/ad-state', err);
    return NextResponse.json({ error: 'failed to read ad-state' }, { status: 500 });
  }
}

export async function POST(req: Request): Promise<NextResponse> {
  let body: { storeId?: unknown; platform?: unknown; enabled?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'bad json' }, { status: 400 });
  }
  const storeId = typeof body.storeId === 'string' ? body.storeId : '';
  const platform = body.platform as AdPlatform;
  // Strict validation: storeId, a known platform, AND an explicit boolean
  // `enabled`. A missing/garbage `enabled` must 400 rather than silently
  // writing OFF — this route disables advertising, so a malformed body should
  // never default to "off".
  if (!storeId || !PLATFORMS.includes(platform) || typeof body.enabled !== 'boolean') {
    return NextResponse.json(
      { error: 'storeId + valid platform + boolean enabled required' },
      { status: 400 },
    );
  }
  const enabled = body.enabled;
  try {
    const { error } = await getSupabaseAdmin()
      .from('store_ad_state')
      .upsert(
        { store_id: storeId, platform, enabled, updated_at: new Date().toISOString() },
        { onConflict: 'store_id,platform' },
      );
    if (error) throw new Error(error.message);
    return NextResponse.json({ ok: true });
  } catch (err) {
    captureRouteError('operator/ad-state', err);
    return NextResponse.json({ error: 'failed to write ad-state' }, { status: 500 });
  }
}
