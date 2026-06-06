// dashboard-web/src/app/operator/AdStateTab.tsx
// ads-off Phase 1 — client container: loads the ad-state map + store meta,
// renders the AdStatePanel matrix, persists toggles via the gated operator API.
'use client';
import { useCallback, useEffect, useState } from 'react';
import { AdStatePanel } from '@/components/operator/AdStatePanel';
import { operatorFetch } from '@/lib/operatorClient';
import type { StoreMetaRow } from '@/lib/postgresReaders';
import { TIKTOK_SHARED_STORES, type AdPlatform, type AdStateMap } from '@/lib/adState';

export function AdStateTab() {
  const [map, setMap] = useState<AdStateMap>({});
  const [meta, setMeta] = useState<StoreMetaRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const tiktokStores = new Set<string>(TIKTOK_SHARED_STORES);

  const load = useCallback(async () => {
    try {
      const [a, m] = await Promise.all([
        operatorFetch('/api/operator/ad-state').then((r) => r.json()),
        fetch('/api/store-meta').then((r) => r.json()),
      ]);
      setMap((a?.map ?? {}) as AdStateMap);
      setMeta((m?.rows ?? []) as StoreMetaRow[]);
      setError(null);
    } catch {
      setError('טעינת מצב הפרסום נכשלה. ודא שה-Operator secret מוגדר.');
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const onToggle = useCallback(
    async (storeId: string, platform: AdPlatform, enabled: boolean) => {
      setMap((prev) => ({ ...prev, [`${storeId}:${platform}`]: enabled })); // optimistic
      try {
        const res = await operatorFetch('/api/operator/ad-state', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ storeId, platform, enabled }),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
      } catch {
        setError('שמירת השינוי נכשלה.');
      }
      void load(); // reconcile against the server (reverts optimistic on failure)
    },
    [load],
  );

  return (
    <div className="space-y-3">
      {error && <p className="text-status-redFg text-sm">{error}</p>}
      <AdStatePanel storeMeta={meta} map={map} tiktokStores={tiktokStores} onToggle={onToggle} />
    </div>
  );
}
