'use client';

/**
 * Wave 5 Task 5.6 — shared `AdAccountMap` SWR reader.
 *
 * `CampaignsTable` and `CampaignsTableRow` originally derived the
 * `AdAccountMap` inline from a private SWR call against `/api/store-meta`
 * (see `CampaignsTable.tsx:282`). Task 5.6 introduces a second caller
 * (`InsightActions` via `InsightsBoard` / `WhatsWorking`), so we lift the
 * derivation into a small reusable hook to avoid divergence between the
 * two code paths (which would silently produce different deep-link URLs
 * for the same store).
 *
 * The hook is intentionally cheap:
 *   - SWR dedupes by URL across the whole app — multiple subscribers
 *     don't trigger duplicate fetches.
 *   - `dedupingInterval: 300_000` matches CampaignsTable's existing window
 *     so the contract stays identical.
 *   - Returns `{}` while loading or on fetch error — `buildAdsManagerLink`
 *     gracefully falls back to the account-less URL when the entry is
 *     missing, so insights stay actionable even before the cache warms.
 */

import { useMemo } from 'react';
import useSWR from 'swr';
import type { AdAccountMap } from '@/lib/campaignsLinks';

// Inline shape matches what `CampaignsTable.tsx:273` already typed.
// /api/store-meta has no exported `Response` type; the inline shape is
// the canonical contract until the route grows one.
type StoreMetaResponse = {
  rows: Array<{
    storeId: string;
    metaAdAccountId: string | null;
    googleAdsCustomerId: string | null;
    tiktokAdvertiserId: string | null;
  }>;
};

const fetcher = async (url: string): Promise<StoreMetaResponse> => {
  const r = await fetch(url, { cache: 'no-store' });
  if (!r.ok) return { rows: [] };
  return r.json();
};

export function useStoreAdAccounts(): AdAccountMap {
  const { data } = useSWR<StoreMetaResponse>('/api/store-meta', fetcher, {
    revalidateOnFocus: false,
    dedupingInterval: 300_000,
  });
  return useMemo<AdAccountMap>(() => {
    const out: AdAccountMap = {};
    for (const row of data?.rows ?? []) {
      out[row.storeId] = {
        metaAdAccountId: row.metaAdAccountId ?? null,
        googleAdsCustomerId: row.googleAdsCustomerId ?? null,
        tiktokAdvertiserId: row.tiktokAdvertiserId ?? null,
      };
    }
    return out;
  }, [data]);
}
