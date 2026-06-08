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
//       · StoreList.onManage(storeId, focus) → wizard in EDIT mode (editStoreId
//         set + focusPlatform = the matrix cell the operator clicked, so the
//         wizard opens scrolled-to / pre-enabling that platform or the webhook).
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
import { StoreList, type StoreRowData, type ManageFocus } from '@/components/operator/StoreList';
import { RemovedStores } from '@/components/operator/RemovedStores';
import { AddStoreWizard } from '@/components/operator/AddStoreWizard';
import { Button } from '@/components/ui/Button';
import { Heading, Text } from '@/components/ui/Typography';

// The wizard is either closed (null) or open in ADD ({mode:'add'}) or EDIT
// ({mode:'edit', storeId, focus?}) mode. A discriminated union keeps the
// editStoreId impossible to set in ADD mode. `focus` (optional) carries the
// credential-matrix focus target through to the wizard's focusPlatform prop so
// EDIT opens scrolled-to / pre-enabling that platform (D2/D3).
type WizardState =
  | { mode: 'closed' }
  | { mode: 'add' }
  | { mode: 'edit'; storeId: string; focus?: ManageFocus };

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
  // Open EDIT focused on a specific platform / the webhook (credential matrix).
  const openManage = useCallback(
    (storeId: string, focus: ManageFocus) => setWizard({ mode: 'edit', storeId, focus }),
    [],
  );

  // Phase 6b Task 3 — lifecycle: archive / restore. Both are reversible
  // status-only flips on the server (no data row touched). On success we re-fetch
  // so the store moves between the active list and the "חנויות שהוסרו" area; on
  // failure we surface a Hebrew error (mirrors the load-error pattern). DELETE is
  // DEFERRED (a later task) — no delete handler here yet.
  const lifecycle = useCallback(
    async (storeId: string, action: 'archive' | 'restore'): Promise<void> => {
      try {
        const res = await operatorFetch(`/api/operator/stores/${storeId}/${action}`, {
          method: 'POST',
        });
        if (!res.ok) throw new Error(`${action} HTTP ${res.status}`);
        setError(null);
        await load(); // re-fetch → the store moves between active / removed-area
      } catch {
        setError(
          action === 'archive'
            ? 'העברת החנות לארכיון נכשלה. נסה שוב.'
            : 'שחזור החנות נכשל. נסה שוב.',
        );
      }
    },
    [load],
  );

  const handleArchive = useCallback(
    (storeId: string) => void lifecycle(storeId, 'archive'),
    [lifecycle],
  );
  const handleRestore = useCallback(
    (storeId: string) => void lifecycle(storeId, 'restore'),
    [lifecycle],
  );

  // Phase 6b T3-delete — IRREVERSIBLE hard delete (DELETE /api/operator/stores/[id]
  // with {confirmName}). The typed-name confirm modal lives in RemovedStores; this
  // handler just performs the request and reports the outcome back so the modal can
  // close (ok) or stay open + show the message (error). On success we re-fetch so
  // the wiped store disappears from the removed-area. The server double-gates
  // (status==='archived' AND confirmName === name), so a stale UI can't force a
  // wrongful wipe. We surface the server's error text when present (e.g. 409
  // "archive the store before deleting it") so the operator sees exactly why.
  const handleDelete = useCallback(
    async (storeId: string, confirmName: string): Promise<{ ok: boolean; error?: string }> => {
      try {
        const res = await operatorFetch(`/api/operator/stores/${storeId}`, {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ confirmName }),
        });
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        if (!res.ok) {
          return { ok: false, error: body?.error || 'מחיקת החנות נכשלה. נסה שוב.' };
        }
        await load(); // re-fetch → the wiped store drops out of the removed-area
        return { ok: true };
      } catch {
        return { ok: false, error: 'מחיקת החנות נכשלה. נסה שוב.' };
      }
    },
    [load],
  );

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
          focusPlatform={wizard.mode === 'edit' ? wizard.focus : undefined}
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
        <>
          <StoreList stores={stores} onManage={openManage} onArchive={handleArchive} />
          {/* "חנויות שהוסרו" — the removed-area below the active list. Renders
              nothing when there are no archived stores. NO info loss: active list
              + removed-area are both visible. DELETE (T3-delete) is the
              IRREVERSIBLE hard wipe — RemovedStores owns the typed-name confirm
              modal; handleDelete performs the DELETE + re-fetches on success. */}
          <RemovedStores stores={stores} onRestore={handleRestore} onDelete={handleDelete} />
        </>
      )}
    </div>
  );
}
