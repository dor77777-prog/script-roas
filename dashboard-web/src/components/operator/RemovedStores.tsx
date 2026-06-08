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
// SCOPE — archive + restore ONLY. A permanent "מחק לצמיתות" (delete) affordance
// is DEFERRED to a later task; the clearly-marked spot for it is the action row
// inside each removed row (see the `{/* DELETE (deferred) … */}` marker below).
// Do NOT build delete here.
//
// Design-system contract (build-to-standard-from-start): token-only colours,
// shared primitives (Card / Button / Badge / Typography), light AND dark (tokens
// flip), RTL Hebrew, mobile-first (identity stacks above the action on small
// screens). The removed rows are visually de-emphasised (muted ink + flat glass)
// so the active list reads as primary. a11y: the restore button has an accessible
// name scoped to the store; the swatch is decorative (aria-hidden).

import { Heading, Text } from '@/components/ui/Typography';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import type { StoreRowData } from './StoreList';

export function RemovedStores({
  stores,
  onRestore,
}: {
  stores: StoreRowData[];
  /** Restore an archived store back to active (POST .../[id]/restore upstream). */
  onRestore: (storeId: string) => void;
}) {
  const archived = stores.filter((s) => s.status === 'archived');

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
            <RemovedStoreRow store={store} onRestore={onRestore} />
          </li>
        ))}
      </ul>
    </section>
  );
}

// One archived store row: muted identity + "הוסרה" badge + a "שחזר" action.
// Composed from the shared primitives; token-only; de-emphasised vs the active
// rows. The DELETE affordance will live in the action group (see marker).
function RemovedStoreRow({
  store,
  onRestore,
}: {
  store: StoreRowData;
  onRestore: (storeId: string) => void;
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
          {/* DELETE (deferred — Phase 6b later task): a "מחק לצמיתות" destructive
              button + confirm modal will go HERE, beside "שחזר". Do NOT build it
              now — archive/restore only. */}
        </div>
      </div>
    </Card>
  );
}
