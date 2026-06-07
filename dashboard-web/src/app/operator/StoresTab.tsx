// dashboard-web/src/app/operator/StoresTab.tsx
//
// Self-serve stores Phase 6a — Task 7: the operator "חנויות" tab container.
//
// This is the integration that makes the feature visible. It is the ONLY
// stateful piece in the store-management UI for 6a:
//   - On mount it fetches GET /api/operator/stores via operatorFetch and
//     UNWRAPS `.stores` (the GET returns `{ stores: StoreRowData[] }`) before
//     handing the rows to the presentational <StoreList>.
//   - It mirrors AdStateTab's loading / Hebrew-error-on-!ok pattern (a gated
//     operator GET that 401/500s must SURFACE, not silently collapse to an
//     empty grid).
//   - It OWNS the AddStoreWizard open/close state:
//       · "+ הוסף חנות" → wizard in ADD mode (no editStoreId).
//       · StoreList.onEdit(storeId) → wizard in EDIT mode (editStoreId set).
//       · the wizard's onDone → CLOSE the wizard AND re-fetch the list, so a
//         newly-added/edited store appears immediately.
//
// Presentation choice: the wizard is rendered INLINE — while open it REPLACES
// the list view (rather than floating in an overlay). This is the simplest and
// safest option (no overlay-over-Sheet inertness pitfall) and is fully
// accessible: focus stays in normal document flow, the wizard is composed from
// the shared primitives, and a "→ חזרה לרשימה" affordance returns to the list.
//
// Design-system contract (build-to-standard-from-start): token-only colours,
// shared primitives (Button / Heading / Text), light AND dark (tokens flip),
// RTL Hebrew, mobile-first. No raw colour literals (design-color guard).

'use client';

import { useCallback, useEffect, useState } from 'react';
import { Plus } from 'lucide-react';
import { operatorFetch } from '@/lib/operatorClient';
import { StoreList, type StoreRowData } from '@/components/operator/StoreList';
import { AddStoreWizard } from '@/components/operator/AddStoreWizard';
import { Button } from '@/components/ui/Button';
import { Heading, Text } from '@/components/ui/Typography';

// The wizard is either closed (null) or open in ADD ({mode:'add'}) or EDIT
// ({mode:'edit', storeId}) mode. A discriminated union keeps the editStoreId
// impossible to set in ADD mode.
type WizardState =
  | { mode: 'closed' }
  | { mode: 'add' }
  | { mode: 'edit'; storeId: string };

export function StoresTab() {
  const [stores, setStores] = useState<StoreRowData[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [wizard, setWizard] = useState<WizardState>({ mode: 'closed' });

  // Reconcile against the server. The operator GET is gated — a 401/404/500
  // must surface (Hebrew error), not silently collapse to an empty list.
  const load = useCallback(async (): Promise<void> => {
    setLoading(true);
    try {
      const res = await operatorFetch('/api/operator/stores');
      if (!res.ok) throw new Error(`stores HTTP ${res.status}`);
      const body = (await res.json()) as { stores?: StoreRowData[] };
      // UNWRAP `.stores` — the GET returns `{ stores: [...] }`.
      setStores(Array.isArray(body?.stores) ? body.stores : []);
      setError(null);
    } catch {
      setError('טעינת רשימת החנויות נכשלה. ודא שה-Operator secret מוגדר.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // The wizard finished (created/edited/cancelled): close it AND re-fetch so a
  // newly-added or edited store appears in the list immediately.
  const handleDone = useCallback(() => {
    setWizard({ mode: 'closed' });
    void load();
  }, [load]);

  const openAdd = useCallback(() => setWizard({ mode: 'add' }), []);
  const openEdit = useCallback((storeId: string) => setWizard({ mode: 'edit', storeId }), []);

  // ---------------------------------------------------------------------------
  // Wizard view — replaces the list while open (inline, no overlay).
  // ---------------------------------------------------------------------------
  if (wizard.mode === 'add' || wizard.mode === 'edit') {
    return (
      <div className="space-y-3">
        <Button type="button" variant="ghost" size="sm" onClick={handleDone}>
          → חזרה לרשימה
        </Button>
        <AddStoreWizard
          onDone={handleDone}
          editStoreId={wizard.mode === 'edit' ? wizard.storeId : undefined}
        />
      </div>
    );
  }

  // ---------------------------------------------------------------------------
  // List view (default).
  // ---------------------------------------------------------------------------
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <Heading level="hero">חנויות</Heading>
          <Text as="p" tone="muted" className="mt-1 text-sm">
            הוסף, צפה וערוך חנויות. שינויים חלים מיד בכל הטאבים — בלי deploy.
          </Text>
        </div>
        <Button type="button" onClick={openAdd}>
          <Plus className="h-4 w-4" aria-hidden="true" />
          הוסף חנות
        </Button>
      </div>

      {error && (
        <Text as="p" role="alert" className="text-sm text-status-redFg">
          {error}
        </Text>
      )}

      {loading ? (
        <Text as="p" tone="muted" role="status" className="text-sm">
          טוען חנויות…
        </Text>
      ) : error ? null : (
        <StoreList stores={stores} onEdit={openEdit} />
      )}
    </div>
  );
}
