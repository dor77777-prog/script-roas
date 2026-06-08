// dashboard-web/src/lib/useStores.ts
// Client hook for the store list. SWR over /api/stores; fallbackData = the
// hardcoded 3 so first paint + any fetch failure is byte-identical to today.
// FALLBACK mirrors getStores' hardcoded fallback exactly (and the Phase-1
// migration backfill) so DB-down degrades to the live 3-store dashboard.
'use client';
import useSWR from 'swr';
import type { StoreInfo } from '@/lib/getStores';

const FALLBACK: StoreInfo[] = [
  { storeId: 'uzoshop',   storeName: 'uzoshop',   brandColor: 'var(--store-uzo)', isHeadless: false, hasTikTok: true,  status: 'active', displayOrder: 1, enableCustomerJourney: false },
  { storeId: 'zolplus',   storeName: 'Zol Plus',  brandColor: 'var(--store-3)',   isHeadless: false, hasTikTok: false, status: 'active', displayOrder: 2, enableCustomerJourney: false },
  { storeId: 'usmile360', storeName: '360usmile', brandColor: 'var(--store-usm)', isHeadless: true,  hasTikTok: true,  status: 'active', displayOrder: 3, enableCustomerJourney: false },
];

const fetcher = (u: string): Promise<StoreInfo[]> =>
  fetch(u)
    .then((r) => r.json())
    .then((j) => (j?.stores as StoreInfo[]) ?? FALLBACK);

export function useStores(): { stores: StoreInfo[] } {
  const { data } = useSWR<StoreInfo[]>('/api/stores', fetcher, {
    fallbackData: FALLBACK,
    revalidateOnFocus: false,
  });
  return { stores: data && data.length ? data : FALLBACK };
}
