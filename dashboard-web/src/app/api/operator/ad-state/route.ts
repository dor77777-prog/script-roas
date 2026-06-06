// dashboard-web/src/app/api/operator/ad-state/route.ts
// ads-off Phase 1 — operator reads/sets the per (store, platform) toggle.
// Gated upstream by middleware (dashboard cookie + operator secret).
import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import type { AdStateMap, AdPlatform } from '@/lib/adState';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const PLATFORMS: readonly AdPlatform[] = ['meta', 'google', 'tiktok'];

export async function GET(): Promise<NextResponse> {
  const { data, error } = await getSupabaseAdmin()
    .from('store_ad_state')
    .select('store_id, platform, enabled');
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const map: AdStateMap = {};
  for (const r of (data ?? []) as Array<{ store_id: string; platform: string; enabled: boolean }>) {
    map[`${r.store_id}:${r.platform}`] = r.enabled !== false;
  }
  return NextResponse.json({ map });
}

export async function POST(req: Request): Promise<NextResponse> {
  let body: { storeId?: unknown; platform?: unknown; enabled?: unknown };
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'bad json' }, { status: 400 }); }
  const storeId = typeof body.storeId === 'string' ? body.storeId : '';
  const platform = body.platform as AdPlatform;
  const enabled = body.enabled === true;
  if (!storeId || !PLATFORMS.includes(platform)) {
    return NextResponse.json({ error: 'storeId + valid platform required' }, { status: 400 });
  }
  const { error } = await getSupabaseAdmin()
    .from('store_ad_state')
    .upsert({ store_id: storeId, platform, enabled, updated_at: new Date().toISOString() }, { onConflict: 'store_id,platform' });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
