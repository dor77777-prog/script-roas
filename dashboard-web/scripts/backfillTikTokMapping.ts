#!/usr/bin/env node
// Phase A.5 v2 evening hotfix #7 (2026-05-29 night) — TikTok historical
// campaign↔store mapping backfill runner.
//
// Reads campaign-store-map from dashboard_state, then UPDATES historical
// campaigns_daily + ads_daily rows whose store_id doesn't match the
// current effective mapping, and re-runs agg_tiktok_spend_per_store_for_date
// for every affected date so data_daily monthly totals reflect the new
// per-store attribution.
//
// Usage:
//   npx tsx dashboard-web/scripts/backfillTikTokMapping.ts            # dry-run
//   npx tsx dashboard-web/scripts/backfillTikTokMapping.ts --apply    # commit changes
//
// Run from the repo root (the script reads /Users/dorperetz/script-roas/.env
// to pick up `supabase.url` + `supabase.service.role.key`).

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

import {
  classifyStaleRows,
  extractTikTokMappingSteps,
  type StaleRow,
} from '../src/lib/backfill/tiktokMapping';

const REPO_ROOT = resolve(__dirname, '..', '..');

// Matches the constant in CampaignsTable.tsx — kept in sync manually because
// importing the React component into a Node script would drag in the whole
// Next.js tree.
const STORE_DISPLAY_NAMES: Record<string, string> = {
  uzoshop: 'uzoshop',
  zolplus: 'Zol Plus',
  usmile360: '360usmile',
};

function loadDotEnvDottedKeys(path: string): Record<string, string> {
  const out: Record<string, string> = {};
  const text = readFileSync(path, 'utf8');
  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    const value = line.slice(eq + 1).trim();
    out[key] = value;
  }
  return out;
}

function getAdminClient(): SupabaseClient {
  const env = loadDotEnvDottedKeys(resolve(REPO_ROOT, '.env'));
  const url = env['supabase.url'];
  const serviceKey = env['supabase.service.role.key'];
  if (!url || !serviceKey) {
    throw new Error(
      `Could not read supabase.url + supabase.service.role.key from ${REPO_ROOT}/.env`,
    );
  }
  return createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

async function loadStoreMapFromSupabase(
  admin: SupabaseClient,
): Promise<Record<string, string>> {
  const { data, error } = await admin
    .from('dashboard_state')
    .select('value')
    .eq('key', 'campaign-store-map')
    .maybeSingle();
  if (error) throw new Error(`load campaign-store-map: ${error.message}`);
  if (!data?.value) return {};
  if (typeof data.value !== 'object' || Array.isArray(data.value)) return {};
  return Object.fromEntries(
    Object.entries(data.value as Record<string, unknown>).filter(
      ([, v]) => typeof v === 'string',
    ),
  ) as Record<string, string>;
}

type CdRow = StaleRow & { ad_set_id: string };
type AdRow = StaleRow & { ad_id: string };

async function selectCampaignsDailyRows(
  admin: SupabaseClient,
  campaignId: string,
  storeIdFilter: { op: 'eq' | 'neq'; value: string },
): Promise<CdRow[]> {
  let q = admin
    .from('campaigns_daily')
    .select('date, store_id, ad_set_id')
    .eq('platform', 'tiktok')
    .eq('campaign_id', campaignId);
  q = storeIdFilter.op === 'eq'
    ? q.eq('store_id', storeIdFilter.value)
    : q.neq('store_id', storeIdFilter.value);
  const { data, error } = await q;
  if (error) {
    throw new Error(`SELECT campaigns_daily ${campaignId}: ${error.message}`);
  }
  return (data ?? []) as CdRow[];
}

async function selectAdsDailyRows(
  admin: SupabaseClient,
  campaignId: string,
  storeIdFilter: { op: 'eq' | 'neq'; value: string },
): Promise<AdRow[]> {
  let q = admin
    .from('ads_daily')
    .select('date, store_id, ad_id')
    .eq('platform', 'tiktok')
    .eq('campaign_id', campaignId);
  q = storeIdFilter.op === 'eq'
    ? q.eq('store_id', storeIdFilter.value)
    : q.neq('store_id', storeIdFilter.value);
  const { data, error } = await q;
  if (error) {
    throw new Error(`SELECT ads_daily ${campaignId}: ${error.message}`);
  }
  return (data ?? []) as AdRow[];
}

async function deleteCampaignsDailyRow(admin: SupabaseClient, row: CdRow): Promise<void> {
  const { error } = await admin
    .from('campaigns_daily')
    .delete()
    .eq('date', row.date)
    .eq('store_id', row.store_id)
    .eq('platform', 'tiktok')
    .eq('ad_set_id', row.ad_set_id);
  if (error) {
    throw new Error(
      `DELETE campaigns_daily ${row.date}/${row.store_id}/${row.ad_set_id}: ${error.message}`,
    );
  }
}

async function updateCampaignsDailyRow(
  admin: SupabaseClient,
  row: CdRow,
  targetStoreId: string,
): Promise<void> {
  const { error } = await admin
    .from('campaigns_daily')
    .update({ store_id: targetStoreId })
    .eq('date', row.date)
    .eq('store_id', row.store_id)
    .eq('platform', 'tiktok')
    .eq('ad_set_id', row.ad_set_id);
  if (error) {
    throw new Error(
      `UPDATE campaigns_daily ${row.date}/${row.store_id}/${row.ad_set_id}: ${error.message}`,
    );
  }
}

async function deleteAdsDailyRow(admin: SupabaseClient, row: AdRow): Promise<void> {
  const { error } = await admin
    .from('ads_daily')
    .delete()
    .eq('date', row.date)
    .eq('store_id', row.store_id)
    .eq('ad_id', row.ad_id);
  if (error) {
    throw new Error(`DELETE ads_daily ${row.date}/${row.store_id}/${row.ad_id}: ${error.message}`);
  }
}

async function updateAdsDailyRow(
  admin: SupabaseClient,
  row: AdRow,
  targetStoreId: string,
): Promise<void> {
  const { error } = await admin
    .from('ads_daily')
    .update({ store_id: targetStoreId })
    .eq('date', row.date)
    .eq('store_id', row.store_id)
    .eq('ad_id', row.ad_id);
  if (error) {
    throw new Error(`UPDATE ads_daily ${row.date}/${row.store_id}/${row.ad_id}: ${error.message}`);
  }
}

async function reAggregateDate(admin: SupabaseClient, date: string): Promise<void> {
  const { error } = await admin.rpc('agg_tiktok_spend_per_store_for_date', { d: date });
  if (error) {
    throw new Error(`RPC agg_tiktok_spend_per_store_for_date(${date}): ${error.message}`);
  }
}

async function main(): Promise<void> {
  const apply = process.argv.includes('--apply');
  const mode = apply ? 'APPLY' : 'DRY-RUN';
  console.log(`=== TikTok historical mapping backfill — ${mode} ===\n`);

  const admin = getAdminClient();
  const storeMap = await loadStoreMapFromSupabase(admin);
  const steps = extractTikTokMappingSteps(storeMap);
  console.log(`storeMap entries (TikTok): ${steps.length}\n`);

  if (steps.length === 0) {
    console.log('No TikTok mapping entries — nothing to backfill. Exiting.');
    return;
  }

  const affectedDates = new Set<string>();
  let cdDeleteTotal = 0;
  let cdUpdateTotal = 0;
  let adDeleteTotal = 0;
  let adUpdateTotal = 0;

  for (const step of steps) {
    const targetStoreName = STORE_DISPLAY_NAMES[step.targetStoreId] ?? step.targetStoreId;

    const cdStale = await selectCampaignsDailyRows(admin, step.campaignId, {
      op: 'neq',
      value: step.targetStoreId,
    });
    const cdTarget = await selectCampaignsDailyRows(admin, step.campaignId, {
      op: 'eq',
      value: step.targetStoreId,
    });
    const cdClass = classifyStaleRows(cdStale, cdTarget, 'ad_set_id');

    const adStale = await selectAdsDailyRows(admin, step.campaignId, {
      op: 'neq',
      value: step.targetStoreId,
    });
    const adTarget = await selectAdsDailyRows(admin, step.campaignId, {
      op: 'eq',
      value: step.targetStoreId,
    });
    const adClass = classifyStaleRows(adStale, adTarget, 'ad_id');

    console.log(`campaign ${step.campaignId} → ${step.targetStoreId} (${targetStoreName})`);
    console.log(
      `  campaigns_daily: ${cdStale.length} stale (DELETE ${cdClass.toDelete.length}, UPDATE ${cdClass.toUpdate.length})`,
    );
    console.log(
      `  ads_daily:       ${adStale.length} stale (DELETE ${adClass.toDelete.length}, UPDATE ${adClass.toUpdate.length})`,
    );
    if (cdStale.length > 0) {
      const dates = [...new Set(cdStale.map(r => r.date))].sort();
      console.log(`  affected dates:  ${dates.join(', ')}`);
      dates.forEach(d => affectedDates.add(d));
    }
    cdDeleteTotal += cdClass.toDelete.length;
    cdUpdateTotal += cdClass.toUpdate.length;
    adDeleteTotal += adClass.toDelete.length;
    adUpdateTotal += adClass.toUpdate.length;

    if (apply) {
      for (const row of cdClass.toDelete) await deleteCampaignsDailyRow(admin, row);
      for (const row of cdClass.toUpdate)
        await updateCampaignsDailyRow(admin, row, step.targetStoreId);
      for (const row of adClass.toDelete) await deleteAdsDailyRow(admin, row);
      for (const row of adClass.toUpdate)
        await updateAdsDailyRow(admin, row, step.targetStoreId);
      if (cdStale.length > 0 || adStale.length > 0) {
        console.log(`  ✓ applied`);
      }
    }
    console.log('');
  }

  console.log(`--- Re-aggregating data_daily for ${affectedDates.size} affected dates ---`);
  const sortedDates = [...affectedDates].sort();
  for (const date of sortedDates) {
    if (apply) {
      await reAggregateDate(admin, date);
      console.log(`  ✓ ${date}`);
    } else {
      console.log(`  WOULD aggregate ${date}`);
    }
  }

  console.log(`\n=== Summary ===`);
  console.log(`Steps:                            ${steps.length}`);
  console.log(`campaigns_daily DELETE / UPDATE:  ${cdDeleteTotal} / ${cdUpdateTotal}`);
  console.log(`ads_daily       DELETE / UPDATE:  ${adDeleteTotal} / ${adUpdateTotal}`);
  console.log(`Affected dates:                   ${affectedDates.size}`);
  if (!apply) {
    console.log(`\nDRY-RUN. Re-run with --apply to commit changes.`);
  } else {
    console.log(`\nAPPLIED.`);
  }
}

main().catch(e => {
  console.error('FATAL:', e instanceof Error ? e.message : e);
  process.exit(1);
});
