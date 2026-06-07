'use client';

// dashboard-web/src/components/operator/StoreRow.tsx
//
// Self-serve stores Phase 6a — Task 6: one row in the operator store list.
//
// PRESENTATIONAL. Renders a single store's identity (name + token-driven brand
// swatch), its configured platforms (Shopify/Meta/Google/TikTok badges derived
// from the GET row's `platforms` field), its status, its display order, and an
// EDIT action that calls `onEdit(store.id)`. T7 (StoresTab) owns the data fetch
// and opens the AddStoreWizard in edit mode in response to onEdit. There is NO
// archive/restore/delete here — that is Phase 6b.
//
// Design-system contract (build-to-standard-from-start):
//   - Token-driven only — the brand swatch background is a CSS var (e.g.
//     "var(--store-uzo)"), exactly the shape the home cards consume; every
//     other colour comes from the mesh tokens (glass / ink / status). NO raw
//     hex/rgb/oklch literal (design-color guard).
//   - Light AND dark first-class (tokens flip automatically).
//   - Composed from the shared primitives (Card / Button / Badge /
//     PlatformBadge / Typography) — no hand-rolled controls.
//   - RTL Hebrew copy; the numeric display-order chip overrides dir="ltr".
//   - Mobile-first: single-column stack on small screens, flows to a row on sm+.
//   - a11y: the edit button has an accessible name; platform badges carry text
//     (never colour-only); the swatch is decorative (aria-hidden) and the store
//     name carries the identity for AT.

import { Pencil } from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { PlatformBadge } from '@/components/ui/PlatformBadge';
import { Text } from '@/components/ui/Typography';
import type { StoreRowData } from './StoreList';

// The configured-platforms render order: Shopify first (source of truth), then
// the paid platforms in a stable order. We intersect with the row's configured
// `platforms` so only platforms actually wired for this store get a badge.
const PLATFORM_ORDER = ['shopify', 'meta', 'google', 'tiktok'] as const;

export function StoreRow({
  store,
  onEdit,
}: {
  store: StoreRowData;
  onEdit: (storeId: string) => void;
}) {
  const configured = new Set(store.platforms);
  const platforms = PLATFORM_ORDER.filter((p) => configured.has(p));

  return (
    <Card
      variant="flat"
      data-testid={`store-row-${store.storeId}`}
      className="flex flex-col gap-3 rounded-lg border border-glass-edge bg-glass-2 p-3 sm:flex-row sm:items-center sm:justify-between"
    >
      {/* Identity: swatch + name + slug. */}
      <div className="flex min-w-0 items-center gap-3">
        <span
          data-testid={`store-swatch-${store.storeId}`}
          aria-hidden="true"
          className="h-8 w-8 shrink-0 rounded-md border border-glass-edge"
          // Token-driven swatch — the value is a CSS var (e.g. var(--store-uzo)),
          // identical to the shape the home cards consume, so a net-new store
          // shows the same brand colour everywhere. A missing brandColor falls
          // back to a neutral glass surface (no raw colour literal).
          style={{ background: store.brandColor ?? 'var(--glass-1)' }}
        />
        <div className="min-w-0">
          <Text as="div" className="truncate text-sm font-semibold text-ink">
            {store.name}
          </Text>
          <Text as="div" tone="muted" dir="ltr" className="truncate text-2xs">
            {store.storeId}
          </Text>
        </div>
      </div>

      {/* Configured platforms — text-bearing badges (never colour-only). */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        {platforms.map((p) => (
          <PlatformBadge key={p} platform={p} size="sm" />
        ))}
      </div>

      {/* Status + display order + edit action. */}
      <div className="flex items-center justify-between gap-3 sm:justify-end">
        <Badge tone="green">פעילה</Badge>
        <Text
          as="span"
          tone="muted"
          dir="ltr"
          className="text-2xs tabular-nums whitespace-nowrap"
          aria-label={`סדר תצוגה ${store.displayOrder}`}
        >
          #{store.displayOrder}
        </Text>
        <Button
          type="button"
          size="sm"
          variant="secondary"
          onClick={() => onEdit(store.storeId)}
          aria-label={`ערוך את ${store.name}`}
        >
          <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
          ערוך
        </Button>
      </div>
    </Card>
  );
}
