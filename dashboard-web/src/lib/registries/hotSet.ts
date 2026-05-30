// dashboard-web/src/lib/registries/hotSet.ts
//
// Phase C — thin TS wrappers around the get_hot_*_ids Postgres RPCs.
//
// Phase E1.6.1 (2026-05-30): no longer soft-fails to []. Pre-fix, ANY
// RPC error (missing migration / permissions / transient DB failure)
// silently returned an empty array — indistinguishable from "no
// active campaigns". This masked production issues like the
// 2026-05-30 evening report where data_daily account-aggregate spend
// stopped updating: the soft-fail hid whether the hot set was
// genuinely empty or the RPC had failed. The Phase E1.6 fan-out had
// no operator-visible signal for "hot-set RPC down" → confusing
// triage.
//
// New contract: errors propagate. Workers' outer try/catch records
// data_freshness.transient_error (so the operator panel surfaces the
// failure) and Inngest's exponential backoff retries.

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Platform, StoreId } from './types';

type Input = { admin: SupabaseClient; storeId: StoreId; platform: Platform };

async function callIdsRpc(name: string, input: Input): Promise<string[]> {
  const { data, error } = await input.admin.rpc(name, {
    p_store_id: input.storeId,
    p_platform: input.platform,
  });
  if (error) {
    throw new Error(`[${name}] rpc failed: ${error.message}`);
  }
  if (!Array.isArray(data)) return [];
  return data.filter((v): v is string => typeof v === 'string');
}

export function getHotCampaignIds(input: Input): Promise<string[]> {
  return callIdsRpc('get_hot_campaign_ids', input);
}

export function getHotAdsetIds(input: Input): Promise<string[]> {
  return callIdsRpc('get_hot_adset_ids', input);
}

export function getHotAdIds(input: Input): Promise<string[]> {
  return callIdsRpc('get_hot_ad_ids', input);
}
