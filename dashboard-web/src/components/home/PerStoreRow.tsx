'use client';

/**
 * Task 3.3 — <PerStoreRow> primitive.
 *
 * 3-store grid for the Home tab. Each store renders as a banded <Card> whose
 * `data-band` is sourced from `useRoasBandGradient(store.roas).band` and whose
 * interior 4-up metric grid (הוצאה / הכנסה / הזמנות / AOV) carries semantic
 * emphasis class hooks consumed by the CSS rules in globals.css (Task 1.5):
 *
 *   • Spend cell    → `cell spend`     (always red ↓)
 *   • Revenue cell  → `cell revenue`   (always green ↑)
 *   • Orders cell   → `cell` (neutral; no emphasis class)
 *   • AOV cell      → `cell ${aovEmphasis(aov)}`  → aov-good | aov-bad | aov-mid
 *   • Per-platform CPM cells → `cell` ONLY (explicitly never coloured by value;
 *     locked rule per [[home-visual-rules]] memo — CPM gets a colour-coded
 *     platform DOT via <PlatformBadge>, not a value-coded number).
 *
 * Click + Enter on the card surface drills to the Campaigns tab pre-filtered
 * by storeId (caller wires the drill via `onStoreSelect`; this primitive
 * does not own URL state itself so it stays trivially testable + reusable
 * outside Dashboard.tsx).
 *
 * Visual ref: mockup-04i-store-emphasis.html (semantic emphasis spec)
 *           + mockup-04-final.html (per-store row layout)
 * Data plumbing arrives in Task 3.1 (Dashboard.tsx wires real StoreAgg →
 * PerStoreData). The inline `PerStoreData` type below is the contract that
 * task will satisfy.
 */

import { useMemo, type KeyboardEvent } from 'react';
import { cn, formatCurrency, formatNumber } from '@/lib/utils';
import { Card } from '@/components/ui/Card';
import { FreshnessBadge } from '@/components/ui/FreshnessBadge';
import { Heading } from '@/components/ui/Typography';
import { PlatformBadge, type Platform } from '@/components/ui/PlatformBadge';
import {
  useRoasBandGradient,
  type RoasBand,
} from '@/lib/format/useRoasBandGradient';
import { aovEmphasis } from '@/lib/format/aovEmphasis';
import { useStaleness } from '@/lib/freshness/useStaleness';

/* --------------------------------------------------------------------------
 * Props
 * -------------------------------------------------------------------------- */

export interface PerStorePlatformCpm {
  /** CPM in CAD for the active range (already FX-normalised upstream). */
  cpm: number;
  /** Spend in CAD for the active range — surfaced under the CPM as caption. */
  spend: number;
}

export interface PerStoreData {
  storeId: string;
  storeName: string;
  /** All money fields are CAD-normalised by the upstream selector. */
  spend: number | null;
  revenue: number | null;
  orders: number | null;
  /** AOV in CAD. Pre-computed (revenue / orders); helpers don't divide here. */
  aov: number | null;
  /** ROAS for the active range — drives the card band via useRoasBandGradient. */
  roas: number | null;
  /** ISO timestamp of the freshest underlying row — reserved for Task 3.x freshness wiring. */
  updatedAt: string | null;
  /** Per-platform CPM breakdown. Only platforms with data are present. */
  perPlatformCpm: Partial<Record<Platform, PerStorePlatformCpm>>;
}

export interface PerStoreRowProps {
  stores: PerStoreData[];
  /**
   * Fired when the operator clicks (or Enter-keys) a store card. Owner is
   * expected to drill to the Campaigns tab pre-filtered by `storeId`. The
   * primitive intentionally does not own URL state so it stays unit-testable.
   */
  onStoreSelect?: (storeId: string) => void;
  className?: string;
}

/* --------------------------------------------------------------------------
 * Internal — band-chip label per band id (Hebrew, kept short for the chip).
 * -------------------------------------------------------------------------- */

const BAND_CHIP_LABEL: Record<RoasBand, string> = {
  red:    'BELOW',
  orange: 'WATCH',
  green:  'GREEN',
  blue:   'AHEAD',
  gray:   'NO DATA',
};

/* --------------------------------------------------------------------------
 * Money / number formatters — local thin wrappers so cell content is a string
 * (the `.sv` CSS selectors in globals.css target the inner <span> by class,
 * not by element identity, so plain strings work fine).
 * -------------------------------------------------------------------------- */

function fmtMoneyText(n: number | null): string {
  if (n == null || Number.isNaN(n)) return '—';
  return `$${formatCurrency(n)}`;
}

function fmtOrdersText(n: number | null): string {
  if (n == null || Number.isNaN(n)) return '—';
  return formatNumber(n, 0);
}

function fmtRoasText(n: number | null): string {
  if (n == null || Number.isNaN(n)) return '—';
  return `${n.toFixed(2)}x`;
}

/* --------------------------------------------------------------------------
 * Component
 * -------------------------------------------------------------------------- */

export function PerStoreRow({
  stores,
  onStoreSelect,
  className,
}: PerStoreRowProps) {
  if (!stores.length) return null;

  return (
    <div
      className={cn(
        'grid grid-cols-1 md:grid-cols-3 gap-4',
        className,
      )}
    >
      {stores.map((store) => (
        <StoreCard
          key={store.storeId}
          store={store}
          onSelect={onStoreSelect}
        />
      ))}
    </div>
  );
}

/* --------------------------------------------------------------------------
 * StoreCard — one banded card. Extracted so the band hook + AOV class
 * computation live at the per-store level (otherwise we'd be calling the
 * helpers inside a .map and shadowing them).
 * -------------------------------------------------------------------------- */

function StoreCard({
  store,
  onSelect,
}: {
  store: PerStoreData;
  onSelect?: (storeId: string) => void;
}) {
  // useRoasBandGradient is a pure function (the `use` prefix is a naming
  // convention locked in lib/format/useRoasBandGradient.ts — it does NOT
  // call into React hook machinery, so it's safe to invoke per-store
  // without triggering rules-of-hooks lint).
  const band = useRoasBandGradient(store.roas);
  const aovClass = aovEmphasis(store.aov);
  // Task 3.6 — freshness signal. The hook re-renders every 60s so the chip
  // label clock stays current; the same `stage` drives the Card's
  // `data-freshness` attribute → CSS desaturation (Task 1.4).
  const freshness = useStaleness(store.updatedAt);

  // Order is stable for the per-platform CPM row: Meta → Google → TikTok
  // (matches the mockup and the chart-legend ordering). The predicate is
  // typed narrowly (platform constrained to the 3 paid keys) so downstream
  // consumers don't have to widen to the full Platform union.
  type PaidPlatform = 'meta' | 'google' | 'tiktok';
  const cpmEntries = useMemo<
    Array<{ platform: PaidPlatform; data: PerStorePlatformCpm }>
  >(
    () =>
      (['meta', 'google', 'tiktok'] as const)
        .map((p) => ({ platform: p, data: store.perPlatformCpm[p] }))
        .filter(
          (e): e is { platform: PaidPlatform; data: PerStorePlatformCpm } =>
            Boolean(e.data),
        ),
    [store.perPlatformCpm],
  );

  const cpmGridCols =
    cpmEntries.length === 3
      ? 'grid-cols-3'
      : cpmEntries.length === 2
        ? 'grid-cols-2'
        : 'grid-cols-1';

  const interactive = typeof onSelect === 'function';

  const handleClick = () => {
    if (interactive) onSelect!(store.storeId);
  };
  const handleKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (!interactive) return;
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onSelect!(store.storeId);
    }
  };

  return (
    <Card
      band={band.band}
      freshness={freshness.stage}
      data-testid="per-store-card"
      role={interactive ? 'button' : undefined}
      tabIndex={interactive ? 0 : undefined}
      aria-label={interactive ? `פתח קמפיינים של ${store.storeName}` : undefined}
      onClick={interactive ? handleClick : undefined}
      onKeyDown={interactive ? handleKeyDown : undefined}
      className={cn(
        interactive &&
          'cursor-pointer transition-colors hover:border-glass-edge/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60',
      )}
    >
      {/* Header — store name + band chip + freshness chip ----------------------------- */}
      <header className="flex items-center justify-between gap-2">
        <Heading level="panel" className="truncate" as="h3">
          <bdi dir="ltr">{store.storeName}</bdi>
        </Heading>
        <div className="flex items-center gap-2">
          <FreshnessBadge updatedAt={store.updatedAt} />
          <span className={cn('band-chip', `chip-${band.band}`)}>
            {BAND_CHIP_LABEL[band.band]}
          </span>
        </div>
      </header>

      {/* ROAS hero — big banded number ---------------------------------------------------- */}
      <div className="mt-2 flex items-baseline justify-between gap-2">
        <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-ink-muted">
          ROAS היום
        </span>
        <bdi
          dir="ltr"
          className="v banded text-2xl font-light tabular-nums tracking-tight"
        >
          {fmtRoasText(store.roas)}
        </bdi>
      </div>

      {/* 4-up metric grid — semantic emphasis class hooks pinned by tests.
          Collapses to 2 columns on phones so 4 narrow money columns don't
          truncate currency glyphs / break the AOV cell mid-word. */}
      <div className="scard-main-grid grid grid-cols-2 sm:grid-cols-4 gap-3 mt-3">
        <div className="cell spend" data-cell="spend">
          <span className="sl">הוצאה</span>
          <span className="sv num tabular-nums">{fmtMoneyText(store.spend)}</span>
        </div>
        <div className="cell revenue" data-cell="revenue">
          <span className="sl">הכנסה</span>
          <span className="sv num tabular-nums">{fmtMoneyText(store.revenue)}</span>
        </div>
        <div className="cell" data-cell="orders">
          <span className="sl">הזמנות</span>
          <span className="sv num tabular-nums">{fmtOrdersText(store.orders)}</span>
        </div>
        <div className={cn('cell', aovClass)} data-cell="aov">
          <span className="sl">AOV</span>
          <span className="sv num tabular-nums">{fmtMoneyText(store.aov)}</span>
        </div>
      </div>

      {/* Per-platform CPM row — CPM cells use ONLY `cell` (no emphasis) ---------------- */}
      {cpmEntries.length > 0 && (
        <div className="cpm-row mt-4 pt-3 border-t border-dashed border-glass-edge">
          <div className="cpm-row-label font-mono text-[10px] uppercase tracking-[0.08em] text-ink-subtle font-bold mb-2">
            CPM לפי פלטפורמה
          </div>
          <div className={cn('cpm-row-cells grid gap-2', cpmGridCols)}>
            {cpmEntries.map(({ platform, data }) => (
              <div
                key={platform}
                className="cell"
                data-cell="cpm"
                data-platform={platform}
              >
                <PlatformBadge platform={platform} size="sm" />
                <span className="text-[10px] text-ink-muted leading-tight">
                  spend · <bdi dir="ltr" className="tabular-nums">{fmtMoneyText(data.spend)}</bdi>
                </span>
                <bdi
                  dir="ltr"
                  className="text-sm font-semibold tabular-nums text-ink"
                >
                  {fmtMoneyText(data.cpm)}
                </bdi>
              </div>
            ))}
          </div>
        </div>
      )}
    </Card>
  );
}
