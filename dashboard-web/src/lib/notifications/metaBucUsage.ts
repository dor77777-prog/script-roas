import { getSupabaseAdmin } from '@/lib/supabaseAdmin';

export async function recordMetaBucUsage(snapshot: {
  store_id: string;
  ad_account_id: string;
  ads_insights_call_pct: number;
  ads_insights_cputime_pct: number;
  ads_insights_time_pct: number;
  ads_insights_eta_minutes: number;
  ads_management_call_pct: number;
  ads_management_cputime_pct: number;
  ads_management_time_pct: number;
  ads_management_eta_minutes: number;
  last_url: string;
}): Promise<void> {
  try {
    const sb = getSupabaseAdmin();
    await sb.from('meta_buc_usage').upsert({
      ...snapshot,
      last_updated_at: new Date().toISOString(),
    }, { onConflict: 'store_id,ad_account_id' });
  } catch (e) {
    console.warn('[recordMetaBucUsage] upsert failed:', e);
  }
}

export async function getMetaBucUsageForStore(storeId: string): Promise<{
  max_ads_insights_call_pct: number;
  max_ads_insights_cputime_pct: number;
  max_ads_insights_time_pct: number;
  max_ads_management_call_pct: number;
  max_ads_management_cputime_pct: number;
  max_ads_management_time_pct: number;
  max_eta_minutes: number;
  rows: Array<Record<string, unknown>>;
} | null> {
  try {
    const sb = getSupabaseAdmin();
    const { data } = await sb.from('meta_buc_usage').select('*').eq('store_id', storeId);
    if (!data?.length) return null;
    return {
      max_ads_insights_call_pct: Math.max(...data.map(r => r.ads_insights_call_pct ?? 0)),
      max_ads_insights_cputime_pct: Math.max(...data.map(r => r.ads_insights_cputime_pct ?? 0)),
      max_ads_insights_time_pct: Math.max(...data.map(r => r.ads_insights_time_pct ?? 0)),
      max_ads_management_call_pct: Math.max(...data.map(r => r.ads_management_call_pct ?? 0)),
      max_ads_management_cputime_pct: Math.max(...data.map(r => r.ads_management_cputime_pct ?? 0)),
      max_ads_management_time_pct: Math.max(...data.map(r => r.ads_management_time_pct ?? 0)),
      max_eta_minutes: Math.max(...data.map(r => Math.max(
        r.ads_insights_eta_minutes ?? 0,
        r.ads_management_eta_minutes ?? 0
      ))),
      rows: data,
    };
  } catch (e) {
    console.warn('[getMetaBucUsageForStore] read failed:', e);
    return null;
  }
}
