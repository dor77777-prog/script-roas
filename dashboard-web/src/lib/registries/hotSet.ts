// dashboard-web/src/lib/registries/hotSet.ts
//
// Phase C — thin TS wrappers around the get_hot_*_ids Postgres RPCs.
// Soft-fail to empty array on error (the worker's caller can treat
// "no hot ids" identically — it just skips the metrics fetch).

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Platform, StoreId } from './types';

type Input = { admin: SupabaseClient; storeId: StoreId; platform: Platform };

async function callIdsRpc(name: string, input: Input): Promise<string[]> {
  const { data, error } = await input.admin.rpc(name, {
    p_store_id: input.storeId,
    p_platform: input.platform,
  });
  if (error) {
    console.warn(`[${name}] rpc failed:`, error.message);
    return [];
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
