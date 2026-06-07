'use client';

// dashboard-web/src/components/operator/StoreList.tsx
//
// Self-serve stores Phase 6a — Task 6: the operator's ACTIVE-store list.
//
// PRESENTATIONAL. The parent (T7 StoresTab) fetches GET /api/operator/stores and
// passes the rows + an onEdit callback down; this component does NO data
// fetching. It renders only the ACTIVE stores (status === 'active') as a list of
// StoreRow, with a friendly Hebrew empty state when there are none. Archived
// stores + the "חנויות שהוסרו" removed-area (archive/restore/delete) are Phase
// 6b and are intentionally not rendered here.
//
// `StoreRowData` is typed to the EXACT shape of one row returned by the GET
// handler (src/app/api/operator/stores/route.ts → GET): storeId / name /
// brandColor / isHeadless / hasTikTok / status / displayOrder + the configured
// `platforms` array (derived server-side from store_secrets presence). T7 reuses
// this exported type so the wire contract stays in lockstep.
//
// Design-system contract (build-to-standard-from-start): token-only colours,
// shared primitives, light AND dark, RTL Hebrew, mobile-first. See StoreRow for
// the per-row treatment.

import { Heading, Text } from '@/components/ui/Typography';
import { Card } from '@/components/ui/Card';
import { StoreRow } from './StoreRow';

/** A platform configured for a store (Shopify is always present once creds are
 *  saved; the paid platforms appear when their secrets exist). Matches the GET
 *  handler's `platformOf` mapping. */
export type StorePlatform = 'shopify' | 'meta' | 'google' | 'tiktok';

/**
 * One row of GET /api/operator/stores. MUST mirror the GET response shape (see
 * route.ts → GET `rows.map`) so T7 can pass the fetched rows straight through.
 */
export interface StoreRowData {
  storeId: string;
  name: string;
  brandColor: string | null;
  isHeadless: boolean;
  hasTikTok: boolean;
  status: 'active' | 'archived';
  displayOrder: number;
  /** Configured platforms, derived server-side from store_secrets presence. */
  platforms: StorePlatform[];
}

export function StoreList({
  stores,
  onEdit,
}: {
  stores: StoreRowData[];
  onEdit: (storeId: string) => void;
}) {
  const active = stores.filter((s) => s.status === 'active');

  return (
    <section className="space-y-3" aria-label="חנויות פעילות">
      <Heading level="hero">חנויות פעילות</Heading>

      {active.length === 0 ? (
        <Card variant="flat" className="rounded-lg border border-glass-edge bg-glass-2 p-6 text-center">
          <Text as="p" className="text-sm font-medium text-ink">
            אין חנויות פעילות עדיין
          </Text>
          <Text as="p" tone="muted" className="mt-1 text-xs">
            הוסף חנות חדשה כדי שתופיע כאן ובכל הטאבים.
          </Text>
        </Card>
      ) : (
        <ul className="space-y-2">
          {active.map((store) => (
            <li key={store.storeId}>
              <StoreRow store={store} onEdit={onEdit} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
