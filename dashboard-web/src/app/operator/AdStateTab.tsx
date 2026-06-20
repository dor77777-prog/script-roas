// dashboard-web/src/app/operator/AdStateTab.tsx
// ads-off Phase 1 — client container: loads the ad-state map + store meta,
// renders the AdStatePanel matrix, persists toggles via the gated operator API.
'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { AdStatePanel } from '@/components/operator/AdStatePanel';
import { operatorFetch } from '@/lib/operatorClient';
import type { StoreMetaRow } from '@/lib/postgresReaders';
import { type AdPlatform, type AdStateMap } from '@/lib/adState';
import { useStores } from '@/lib/useStores';

export function AdStateTab(props: {
  // Optional: forwarded to the panel's unconnected cells. When wired, the
  // "חבר" link switches the operator console to the "חנויות" credential-matrix
  // tab. The platform is passed through for future deep-focus; today the parent
  // simply switches tabs (see OperatorTabs).
  onConnect?: (storeId: string, platform: AdPlatform) => void;
} = {}) {
  const { onConnect } = props;
  const [map, setMap] = useState<AdStateMap>({});
  const [meta, setMeta] = useState<StoreMetaRow[]>([]);
  const [error, setError] = useState<string | null>(null);

  // Self-serve stores: TikTok membership is derived from the live store list
  // (stores.has_tiktok), NOT a hardcoded set — so a 4th store with
  // has_tiktok=true shows a TikTok toggle in 'מצב פרסום'. useStores falls back
  // to the hardcoded 3 (uzoshop + usmile360 hasTikTok) so this is byte-identical
  // for the existing stores even if /api/stores is unreachable.
  const { stores } = useStores();
  const tiktokStores = useMemo(
    () => new Set<string>(stores.filter((s) => s.hasTikTok).map((s) => s.storeId)),
    [stores],
  );

  // Reconcile against the server. Returns true on success. Surfaces a read
  // error but never throws (callers may ignore the result).
  const load = useCallback(async (): Promise<boolean> => {
    try {
      const [aRes, mRes] = await Promise.all([
        operatorFetch('/api/operator/ad-state'),
        fetch('/api/store-meta'),
      ]);
      // The operator GET is gated — a 401/404/500 must surface, not silently
      // collapse to an empty (all-ON) grid.
      if (!aRes.ok) throw new Error(`ad-state HTTP ${aRes.status}`);
      const a = await aRes.json();
      const m = await mRes.json();
      setMap((a?.map ?? {}) as AdStateMap);
      setMeta((m?.rows ?? []) as StoreMetaRow[]);
      setError(null);
      return true;
    } catch {
      setError('טעינת מצב הפרסום נכשלה. ודא שה-Operator secret מוגדר.');
      return false;
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const onToggle = useCallback(
    async (storeId: string, platform: AdPlatform, enabled: boolean) => {
      setMap((prev) => ({ ...prev, [`${storeId}:${platform}`]: enabled })); // optimistic
      let saveFailed = false;
      try {
        const res = await operatorFetch('/api/operator/ad-state', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ storeId, platform, enabled }),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
      } catch {
        saveFailed = true;
      }
      // Reconcile FIRST (reverts the optimistic value if the write didn't
      // persist), THEN show the save error — so the reconcile's setError(null)
      // on success can't wipe the failure message.
      await load();
      if (saveFailed) setError('שמירת השינוי נכשלה.');
    },
    [load],
  );

  return (
    <div className="space-y-3">
      {error && <p className="text-status-redFg text-sm">{error}</p>}
      <AdStatePanel storeMeta={meta} map={map} tiktokStores={tiktokStores} onToggle={onToggle} onConnect={onConnect} />
    </div>
  );
}
