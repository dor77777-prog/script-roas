'use client';

// dashboard-web/src/components/operator/StoreRow.tsx
//
// Self-serve stores Phase 6a — Task 6 + D1/D2: one row in the operator store
// list, now carrying the per-store CREDENTIAL-STATUS MATRIX.
//
// PRESENTATIONAL. Renders a single store's identity (name + token-driven brand
// swatch + display-order) PLUS a compact status matrix over the four platforms
// (Shopify / Meta / Google / TikTok) + the real-time webhook feed, derived from
// the GET row's `platforms` array + `hasTikTok` + `hasWebhookSecret`. Each cell
// shows whether the store HAS or is MISSING that credential and exposes a
// connect ("חבר") / rotate ("החלף") action that calls up via
// `onManage(storeId, focus)` — T7 (StoresTab) opens the edit wizard focused on
// that platform. There is NO archive/restore/delete here — that is Phase 6b.
//
// Design-system contract (build-to-standard-from-start):
//   - Token-driven only — the brand swatch background is a CSS var (e.g.
//     "var(--store-uzo)"); every status colour comes from the status-* tokens
//     via the shared <Badge> primitive (paired Bg/Fg → guaranteed AA in BOTH
//     themes). NO raw hex/rgb/oklch literal (design-color guard).
//   - Status is NEVER colour-only: each cell carries a lucide icon (Check /
//     AlertTriangle) AND Hebrew status text, so it reads without colour.
//   - Light AND dark first-class (tokens flip automatically).
//   - Composed from the shared primitives (Card / Button / Badge /
//     PlatformBadge / Typography) — no hand-rolled coloured markup.
//   - RTL Hebrew copy; the numeric display-order chip overrides dir="ltr".
//   - Mobile-first: identity stacks above the matrix on small screens; the
//     matrix itself wraps cleanly (flex-wrap) so no cell clips/overflows.
//   - a11y: every action button has an accessible name scoped to the store +
//     platform; the swatch is decorative (aria-hidden).

import { Check, AlertTriangle, ShoppingBag } from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { PlatformBadge } from '@/components/ui/PlatformBadge';
import { Text } from '@/components/ui/Typography';
import type { StoreRowData, ManageFocus } from './StoreList';

// One derived matrix cell. `status` drives the icon/colour; `label` is the
// platform's Hebrew/identity label; `statusText` is the readable status cue
// (never colour-only); `action` is the connect/rotate affordance copy.
interface MatrixCell {
  /** Matrix key (stable test-id + onManage focus target). */
  key: ManageFocus;
  /** Connected (has the cred) vs missing (needs connecting). */
  status: 'connected' | 'missing';
  /** Hebrew status cue text (paired with the icon — not colour-only). */
  statusText: string;
  /** The action button copy (connect when missing / rotate when connected). */
  actionLabel: string;
}

// Build the five matrix cells from the GET row. Pure — no side effects.
function buildMatrix(store: StoreRowData): MatrixCell[] {
  const has = (p: string) => store.platforms.includes(p as never);
  return [
    {
      key: 'shopify',
      // Shopify is required: every store has it once created.
      status: 'connected',
      statusText: 'מחובר',
      actionLabel: 'החלף',
    },
    {
      key: 'meta',
      status: has('meta') ? 'connected' : 'missing',
      statusText: has('meta') ? 'מחובר' : 'חסר',
      actionLabel: has('meta') ? 'החלף' : 'חבר',
    },
    {
      key: 'google',
      status: has('google') ? 'connected' : 'missing',
      statusText: has('google') ? 'מחובר' : 'חסר',
      actionLabel: has('google') ? 'החלף' : 'חבר',
    },
    {
      key: 'tiktok',
      // TikTok is a SHARED ad account (no per-store creds) — has_tiktok flips it.
      status: store.hasTikTok ? 'connected' : 'missing',
      statusText: store.hasTikTok ? 'מופעל (משותף)' : 'לא מופעל',
      actionLabel: store.hasTikTok ? 'החלף' : 'הפעל',
    },
    {
      key: 'webhook',
      // Presence boolean only — themed stores need it for the real-time feed.
      status: store.hasWebhookSecret ? 'connected' : 'missing',
      statusText: store.hasWebhookSecret ? 'מוגדר' : 'חסר',
      actionLabel: store.hasWebhookSecret ? 'החלף' : 'חבר',
    },
  ];
}

// The human label for a matrix cell. Ad/Shopify platforms reuse the canonical
// PlatformBadge identity; the webhook gets a Hebrew label + a cart-feed cue.
const CELL_HEBREW: Record<ManageFocus, string> = {
  shopify: 'Shopify',
  meta: 'Meta',
  google: 'Google',
  tiktok: 'TikTok',
  webhook: 'פיד זמן-אמת',
};

export function StoreRow({
  store,
  onManage,
}: {
  store: StoreRowData;
  /** Open the edit wizard for this store, focused on a platform / the webhook. */
  onManage: (storeId: string, focus: ManageFocus) => void;
}) {
  const cells = buildMatrix(store);

  return (
    <Card
      variant="flat"
      data-testid={`store-row-${store.storeId}`}
      className="flex flex-col gap-3 rounded-lg border border-glass-edge bg-glass-2 p-3"
    >
      {/* Header: identity + status + display order. Stacks on mobile, row on sm+. */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        {/* Identity: swatch + name + slug. */}
        <div className="flex min-w-0 items-center gap-3">
          <span
            data-testid={`store-swatch-${store.storeId}`}
            aria-hidden="true"
            className="h-8 w-8 shrink-0 rounded-md border border-glass-edge"
            // Token-driven swatch — the value is a CSS var (e.g. var(--store-uzo)),
            // identical to the shape the home cards consume; a missing brandColor
            // falls back to a neutral glass surface (no raw colour literal).
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
        </div>
      </div>

      {/* The credential-status MATRIX. Mobile-first: a single-column stack that
          flows to a wrapping grid on sm+; each cell is self-contained so nothing
          clips. */}
      <ul
        aria-label={`מצב חיבורים — ${store.name}`}
        className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3"
      >
        {cells.map((cell) => (
          <li key={cell.key}>
            <CredCell store={store} cell={cell} onManage={onManage} />
          </li>
        ))}
      </ul>
    </Card>
  );
}

// One matrix cell: platform identity + status (icon + text, never colour-only) +
// a connect/rotate action. Status colour comes through the <Badge> tone tokens
// (paired Bg/Fg → AA in both themes).
function CredCell({
  store,
  cell,
  onManage,
}: {
  store: StoreRowData;
  cell: MatrixCell;
  onManage: (storeId: string, focus: ManageFocus) => void;
}) {
  const connected = cell.status === 'connected';
  const StatusIcon = connected ? Check : AlertTriangle;
  const label = CELL_HEBREW[cell.key];

  return (
    <div
      data-testid={`cred-cell-${store.storeId}-${cell.key}`}
      data-status={cell.status}
      className="flex items-center justify-between gap-2 rounded-md border border-glass-edge bg-glass-1 px-2.5 py-2"
    >
      <div className="flex min-w-0 items-center gap-2">
        {/* Identity — reuse the canonical PlatformBadge for the 4 platforms; the
            webhook is not a platform so it gets a cart-feed icon + Hebrew label. */}
        {cell.key === 'webhook' ? (
          <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-ink-secondary whitespace-nowrap">
            <ShoppingBag className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            {label}
          </span>
        ) : (
          <PlatformBadge platform={cell.key} size="sm" />
        )}
      </div>

      <div className="flex shrink-0 items-center gap-2">
        {/* Status: icon + Hebrew text via the Badge primitive (tone tokens →
            guaranteed-contrast paired Bg/Fg in BOTH themes). NOT colour-only. */}
        <Badge tone={connected ? 'green' : 'warning'} className="whitespace-nowrap">
          <StatusIcon className="h-3 w-3 shrink-0" aria-hidden="true" />
          {cell.statusText}
        </Badge>
        <Button
          type="button"
          size="sm"
          variant={connected ? 'ghost' : 'secondary'}
          onClick={() => onManage(store.storeId, cell.key)}
          aria-label={`${cell.actionLabel} ${label} — ${store.name}`}
        >
          {cell.actionLabel}
        </Button>
      </div>
    </div>
  );
}
