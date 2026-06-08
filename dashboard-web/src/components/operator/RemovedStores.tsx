'use client';

// dashboard-web/src/components/operator/RemovedStores.tsx
//
// Self-serve stores Phase 6b — Task 3: the "חנויות שהוסרו" (removed-stores) area.
//
// PRESENTATIONAL. The parent (StoresTab) fetches GET /api/operator/stores (which
// returns ALL stores, incl. archived) and passes the rows + an onRestore(storeId)
// callback down; this component does NO data fetching. It renders only the
// ARCHIVED stores (status === 'archived') as a muted list — each tagged "הוסרה"
// with a "שחזר" (restore) action — BELOW the active StoreList so there is NO info
// loss (active + removed both visible). When there are no archived stores it
// renders nothing (there is simply no removed-area to show).
//
// SCOPE — archive + restore + DELETE. Restore is reversible (a status flip).
// DELETE (Phase 6b T3-delete) is the IRREVERSIBLE hard wipe (server route DELETE
// /api/operator/stores/[id]): a destructive "מחק לצמיתות" button beside "שחזר"
// opens a typed-name confirm modal. The modal is routed through the shared Radix
// `Sheet` primitive (variant="modal") — NEVER a hand-rolled fixed-overlay div,
// which would be inert (the modal-over-Sheet rule). The confirm button is DISABLED
// until the operator types the EXACT store name (client gate; the server re-checks
// confirmName === name AND status==='archived'). On ok → close + the parent
// re-fetches (store disappears); on error → the modal STAYS open + shows the
// server message. Delete is OPTIONAL: when `onDelete` is omitted the affordance is
// not rendered (back-compat — a caller can still show restore-only).
//
// Design-system contract (build-to-standard-from-start): token-only colours,
// shared primitives (Card / Button / Badge / Input / Sheet / Typography), light
// AND dark (tokens flip), RTL Hebrew, mobile-first (identity stacks above the
// action on small screens). The removed rows are visually de-emphasised (muted
// ink + flat glass) so the active list reads as primary. Destructive emphasis uses
// the status-red tokens (header icon + the destructive Button variant). a11y: the
// restore + delete buttons have accessible names scoped to the store; the swatch
// is decorative (aria-hidden); the modal is a focus-trapped Radix dialog
// (role=dialog, Esc-to-close, accessible Title/Description).

import { useCallback, useState } from 'react';
import { AlertTriangle, Loader2 } from 'lucide-react';
import { Heading, Text } from '@/components/ui/Typography';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Input } from '@/components/ui/Input';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetBody,
  SheetFooter,
  SheetTitle,
  SheetDescription,
} from '@/components/ui/Sheet';
import type { StoreRowData } from './StoreList';

export function RemovedStores({
  stores,
  onRestore,
  onDelete,
}: {
  stores: StoreRowData[];
  /** Restore an archived store back to active (POST .../[id]/restore upstream). */
  onRestore: (storeId: string) => void;
  /**
   * IRREVERSIBLY delete an archived store (DELETE .../[id] with {confirmName}
   * upstream). Resolves `{ ok: true }` on success (the modal closes + the parent
   * re-fetches) or `{ ok: false, error }` on a server failure (the modal stays
   * open and shows the message). OMITTED → no "מחק לצמיתות" affordance is rendered
   * (restore-only, back-compat).
   */
  onDelete?: (storeId: string, confirmName: string) => Promise<{ ok: boolean; error?: string }>;
}) {
  const archived = stores.filter((s) => s.status === 'archived');

  // The store currently targeted by the delete-confirm modal (null = closed).
  // Holding the WHOLE row (not just the id) keeps the modal's copy + the typed-
  // name gate self-contained even if the list re-fetches underneath it.
  const [pendingDelete, setPendingDelete] = useState<StoreRowData | null>(null);

  // Empty removed-area → render nothing (no heading, no chrome). The active list
  // stands alone; there's no "removed" concept to surface yet.
  if (archived.length === 0) return null;

  return (
    <section className="space-y-3" aria-label="חנויות שהוסרו">
      <div>
        <Heading level="hero" className="text-ink-secondary">
          חנויות שהוסרו
        </Heading>
        <Text as="p" tone="muted" className="mt-1 text-xs">
          חנויות בארכיון אינן מופיעות בטאבים ובסנכרון — הנתונים נשמרים. אפשר לשחזר
          אותן בכל עת.
        </Text>
      </div>

      <ul className="space-y-2">
        {archived.map((store) => (
          <li key={store.storeId}>
            <RemovedStoreRow
              store={store}
              onRestore={onRestore}
              // Only wire the delete affordance when the parent supplied a handler.
              onRequestDelete={onDelete ? () => setPendingDelete(store) : undefined}
            />
          </li>
        ))}
      </ul>

      {/* The IRREVERSIBLE delete-confirm modal. Rendered once for whichever row
          is pending — a Radix dialog (via Sheet), focus-trapped + Esc-closable. */}
      {onDelete && pendingDelete && (
        <DeleteConfirmModal
          store={pendingDelete}
          onClose={() => setPendingDelete(null)}
          onConfirm={(confirmName) => onDelete(pendingDelete.storeId, confirmName)}
        />
      )}
    </section>
  );
}

// One archived store row: muted identity + "הוסרה" badge + "שחזר" + (optionally)
// the destructive "מחק לצמיתות" action. Composed from the shared primitives;
// token-only; de-emphasised vs the active rows.
function RemovedStoreRow({
  store,
  onRestore,
  onRequestDelete,
}: {
  store: StoreRowData;
  onRestore: (storeId: string) => void;
  /** Present → render the destructive delete button (opens the confirm modal). */
  onRequestDelete?: () => void;
}) {
  return (
    <Card
      variant="flat"
      data-testid={`removed-store-row-${store.storeId}`}
      className="flex flex-col gap-3 rounded-lg border border-glass-edge bg-glass-1 p-3 opacity-90 sm:flex-row sm:items-center sm:justify-between"
    >
      {/* Identity: swatch + name + slug (muted — this store is archived). */}
      <div className="flex min-w-0 items-center gap-3">
        <span
          data-testid={`removed-store-swatch-${store.storeId}`}
          aria-hidden="true"
          className="h-8 w-8 shrink-0 rounded-md border border-glass-edge opacity-70"
          // Token-driven swatch (CSS var); missing brandColor → neutral glass.
          style={{ background: store.brandColor ?? 'var(--glass-1)' }}
        />
        <div className="min-w-0">
          <Text as="div" className="truncate text-sm font-semibold text-ink-secondary">
            {store.name}
          </Text>
          <Text as="div" tone="muted" dir="ltr" className="truncate text-2xs">
            {store.storeId}
          </Text>
        </div>
      </div>

      {/* Status badge + actions. Wraps below identity on mobile. */}
      <div className="flex items-center justify-between gap-3 sm:justify-end">
        <Badge tone="gray" className="whitespace-nowrap">
          הוסרה
        </Badge>
        <div className="flex shrink-0 items-center gap-2">
          <Button
            type="button"
            size="sm"
            variant="secondary"
            onClick={() => onRestore(store.storeId)}
            aria-label={`שחזר את ${store.name}`}
          >
            שחזר
          </Button>
          {/* DELETE (Phase 6b T3-delete) — destructive, IRREVERSIBLE. Opens the
              typed-name confirm modal owned by RemovedStores. */}
          {onRequestDelete && (
            <Button
              type="button"
              size="sm"
              variant="destructive"
              onClick={onRequestDelete}
              aria-label={`מחק לצמיתות את ${store.name}`}
            >
              מחק לצמיתות
            </Button>
          )}
        </div>
      </div>
    </Card>
  );
}

// The IRREVERSIBLE delete-confirm modal. A Radix dialog (via the shared Sheet
// `variant="modal"` primitive — NOT a hand-rolled overlay) so it is focus-trapped,
// Esc-closable, and has a real role=dialog. The destructive copy makes the
// irreversibility unmistakable + lists what gets wiped; the confirm button is
// DISABLED until the typed value EXACTLY equals the store name. On confirm it
// awaits onConfirm: ok → close (parent re-fetches), error → stay open + show the
// message inline.
function DeleteConfirmModal({
  store,
  onClose,
  onConfirm,
}: {
  store: StoreRowData;
  onClose: () => void;
  onConfirm: (confirmName: string) => Promise<{ ok: boolean; error?: string }>;
}) {
  const [typed, setTyped] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Exact-match gate (client-side; the server re-checks). Trim NOTHING — the
  // operator must type the name character-for-character, exactly as displayed.
  const matches = typed === store.name;

  const handleConfirm = useCallback(async () => {
    if (!matches || submitting) return; // belt-and-braces: the button is disabled too
    setSubmitting(true);
    setError(null);
    try {
      const result = await onConfirm(typed);
      if (result.ok) {
        onClose(); // parent re-fetches → the store disappears
      } else {
        setError(result.error || 'מחיקת החנות נכשלה. נסה שוב.');
      }
    } catch {
      setError('מחיקת החנות נכשלה. נסה שוב.');
    } finally {
      setSubmitting(false);
    }
  }, [matches, submitting, onConfirm, typed, onClose]);

  return (
    <Sheet
      open
      onOpenChange={(o) => {
        // Don't close mid-flight (Esc / backdrop) while the DELETE is running.
        if (!o && !submitting) onClose();
      }}
    >
      <SheetContent variant="modal" dir="rtl" className="sm:max-w-md p-0 gap-0">
        <SheetHeader className="flex items-center gap-2">
          <AlertTriangle className="h-5 w-5 shrink-0 text-status-redFg" aria-hidden="true" />
          <div className="min-w-0">
            <SheetTitle className="text-status-redFg">מחיקת חנות לצמיתות</SheetTitle>
            <SheetDescription>
              פעולה בלתי-הפיכה. כל הנתונים של החנות יימחקו — הזמנות, ייחוס,
              קמפיינים, אירועים, אישורים והגדרות.
            </SheetDescription>
          </div>
        </SheetHeader>

        <SheetBody className="space-y-3">
          <Text as="p" className="text-sm">
            את/ה עומד/ת למחוק את{' '}
            <span className="font-semibold text-ink">{store.name}</span> לצמיתות.
            אין שחזור, אין גיבוי, אין צעד אחורה.
          </Text>

          <label className="block">
            <span className="mb-1 block text-xs text-ink-secondary">
              הקלד את שם החנות לאישור:{' '}
              <span className="font-semibold text-ink" dir="ltr">
                {store.name}
              </span>
            </span>
            <Input
              type="text"
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              placeholder="שם החנות…"
              autoFocus
              disabled={submitting}
              aria-label={`הקלד את שם החנות לאישור: ${store.name}`}
            />
          </label>

          {error && (
            <Text as="p" role="alert" className="text-sm text-status-redFg">
              {error}
            </Text>
          )}
        </SheetBody>

        <SheetFooter>
          <Button type="button" variant="secondary" onClick={onClose} disabled={submitting}>
            ביטול
          </Button>
          <Button
            type="button"
            variant="destructive"
            onClick={handleConfirm}
            // DISABLED until the typed name EXACTLY matches (client gate).
            disabled={!matches || submitting}
            className="gap-1"
          >
            {submitting && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
            {submitting ? 'מוחק…' : 'מחק לצמיתות'}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
