// dashboard-web/src/lib/inngest/campaignStoreMap.ts
//
// Phase A.5 — Server-side reader for the campaign-store-map JSONB blob.
// Used by cron fetchers + persisters to resolve per-row store_id without
// reaching into localStorage (which doesn't exist server-side).

import { getSupabaseAdmin } from '@/lib/supabaseAdmin';

export async function loadCampaignStoreMapFromSupabase(): Promise<Record<string, string>> {
  try {
    const sb = getSupabaseAdmin();
    const { data } = await sb
      .from('dashboard_state')
      .select('value')
      .eq('key', 'campaign-store-map')
      .maybeSingle();
    if (!data?.value) return {};
    const parsed = data.value as unknown;
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return {};
    return Object.fromEntries(
      Object.entries(parsed as Record<string, unknown>).filter(([, v]) => typeof v === 'string'),
    ) as Record<string, string>;
  } catch (e) {
    console.warn('[loadCampaignStoreMapFromSupabase] read failed:', e);
    return {};
  }
}
