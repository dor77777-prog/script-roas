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
 * Visual ref: docs/superpowers/mockups/2026-05-31-light-reskin/
 *   dashboard-mockups.html `.store` card (mesh re-skin, both light + dark):
 *   white text on the vivid band gradient, a white-alpha uppercase band-tag
 *   pill + freshness chip in the header, a big ROAS number with the band
 *   caption beneath it, an hr separator, the 4-up metric grid, and the
 *   per-platform CPM tiles (white-alpha `.plat` cells).
 * Data plumbing arrives in Task 3.1 (Dashboard.tsx wires real StoreAgg →
 * PerStoreData). The inline `PerStoreData` type below is the contract that
 * task will satisfy.
 */

import { useMemo, type KeyboardEvent } from 'react';
import { cn, formatNumber } from '@/lib/utils';
import { Money } from '@/components/ui/Money';
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
  /**
   * ISO timestamp of the dataset's freshest write (the page-global
   * `dataLastWriteAt`). Same freshness signal the hero / TabFreshnessHeader
   * use, so per-store LIVE/stale dots always agree with the hero. `null`
   * only when no write timestamp is available.
   */
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
 * Internal — band-tag label per band id. Hebrew band-state wording, mirroring
 * the mockup `.store` `.band-tag` pill (which carries the ROAS state in
 * Hebrew, e.g. "תקין" / "למעקב" / "ROAS נמוך"). We use the project's canonical
 * `roasLabel()` band wording (lib/analytics.ts) so the per-store pill reads
 * identically to every other ROAS-state surface (RoasTargetChart annotation,
 * tables, etc.) — one source of truth for band wording instead of a bespoke
 * per-card vocabulary.
 * -------------------------------------------------------------------------- */

const BAND_TAG_LABEL: Record<RoasBand, string> = {
  red:         'דורש בחינה',
  'red-alarm': '0 מכירות',
  orange:      'סביר',
  green:       'טוב',
  blue:        'מעולה',
  gray:        'אין נתונים',
};

/* --------------------------------------------------------------------------
 * Number formatters — local thin wrappers so cell content is a string
 * (the `.sv` CSS selectors in globals.css target the inner <span> by class,
 * not by element identity, so plain strings work fine).
 *
 * Wave C3 (2026-06-01) — every MONEY readout in this card now renders through
 * the overflow-safe <Money> primitive (tabular-nums + nowrap + a compact
 * floor, value-exact in title/sr-only) instead of a clipped/`truncate`d
 * string. The old `fmtMoneyText* ` helpers were therefore deleted. Orders is
 * a COUNT (never `$`-prefixed), so it keeps its own plain-string formatter.
 * -------------------------------------------------------------------------- */

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
  // Operator-locked "alarm-red" state: the store SPENT money but made ZERO
  // sales (the worst outcome). Such a store carries `roas: null` upstream
  // (a 0-revenue ROAS isn't a meaningful ratio), so we derive the flag from
  // raw spend/revenue and let it drive the band. Genuine no-activity
  // (spend === 0) does NOT trip this and stays gray ("אין נתונים").
  const zeroSalesWithSpend =
    (store.spend ?? 0) > 0 && store.revenue === 0;

  // useRoasBandGradient is a pure function (the `use` prefix is a naming
  // convention locked in lib/format/useRoasBandGradient.ts — it does NOT
  // call into React hook machinery, so it's safe to invoke per-store
  // without triggering rules-of-hooks lint). The 2nd arg (isStale) keeps its
  // default false here (per-card desaturation is driven by data-freshness,
  // not this flag); the 3rd arg flips the card to the alarm-red band.
  const band = useRoasBandGradient(store.roas, false, zeroSalesWithSpend);
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
        // Per-store cards opt into a roomier interior so the bumped sizes
        // breathe — see 2.5.4 patch notes. The `!p-6 md:!p-7` overrides the
        // Card default `p-5` without churning every other consumer of the
        // primitive.
        '!p-6 md:!p-7 per-store-card',
        interactive &&
          'cursor-pointer transition-colors hover:border-glass-edge/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
      )}
    >
      {/* Zone 1 — colored "slab" header.
          The .glass[data-band] CSS now paints a strong gradient over the top
          ~35% of the card. Store name + band chip + ROAS hero sit ON this
          slab so the band colour is what the operator's eye lands on first
          ("the store IS this band" rather than "the store has a hint of"). */}
      <header className="store-top flex items-center justify-between gap-3">
        <Heading
          level="panel"
          className="store-name truncate text-lg md:text-xl font-semibold"
          as="h3"
        >
          <bdi dir="ltr">{store.storeName}</bdi>
        </Heading>
        <div className="flex items-center gap-2">
          <FreshnessBadge updatedAt={store.updatedAt} />
          {/* Band-tag pill. On the vivid band card it reads as the mockup's
              white-on-white-alpha pill via the `.per-store-card .band-tag`
              rule in globals.css — NOT a value-coloured chip, since the band
              colour already IS the whole card. */}
          <span className="band-tag">{BAND_TAG_LABEL[band.band]}</span>
        </div>
      </header>

      {/* ROAS hero — huge banded number with the band caption beneath it
          (mockup `.roas-big` + `.roas-cap`). The number gets the full width
          so the operator can read today's ROAS from across the room; the
          uppercase "ROAS · היום" caption sits under it. */}
      <div className="mt-2 min-w-0">
        <bdi
          dir="ltr"
          className="v banded block text-[50px] md:text-[60px] font-light tabular-nums tracking-tight leading-none whitespace-nowrap"
        >
          {/* Alarm-red state shows an explicit "0.00x" (spent money, zero
              return) rather than the "—" fmtRoasText() yields for a true null
              ROAS. fmtRoasText itself is left untouched — other callers rely on
              "—" for genuine no-data. */}
          {zeroSalesWithSpend ? '0.00x' : fmtRoasText(store.roas)}
        </bdi>
        <span className="roas-cap mt-1 block font-mono text-[11px] uppercase tracking-[0.08em] text-ink-muted">
          ROAS · היום
        </span>
      </div>

      {/* Zone 2 — 4-up metric grid.
          Semantic emphasis class hooks pinned by tests. Collapses to 2
          columns on phones so 4 narrow money columns don't truncate
          currency glyphs / break the AOV cell mid-word.
          The `per-store-card` ancestor class lets globals.css bump
          .sl / .sv sizes inside this row WITHOUT affecting other
          scard-main-grid consumers.
          Wave C3 (2026-06-01) — every money value renders via the
          overflow-safe <Money> primitive (tabular-nums + nowrap + a compact
          floor, value-exact in title/sr-only) so a digit is NEVER clipped or
          ellipsised — `truncate` is gone from all numeric cells. Spend +
          revenue compact from ≥$1k ("$5.8K" / "$112K") so the enlarged
          20-22px font fits the 1/4-track; AOV uses a high (100k) floor so it
          stays full-precision (typically <$100) yet still nowrap-safe. Orders
          is a COUNT (no `$`-prefix) → a plain `whitespace-nowrap` span, never
          <Money>. The `.sv` class hook is kept so the per-band on-color CSS
          (`.scard-main-grid .sv`) + the 20/22px size rule still apply. */}
      <div className="scard-main-grid grid grid-cols-2 sm:grid-cols-4 gap-4 mt-5 pt-4 border-t border-glass-edge">
        <div className="cell spend" data-cell="spend">
          <span className="sl">הוצאה</span>
          <Money value={store.spend} compactAbove={1_000} className="sv num" />
        </div>
        <div className="cell revenue" data-cell="revenue">
          <span className="sl">הכנסה</span>
          <Money value={store.revenue} compactAbove={1_000} className="sv num" />
        </div>
        <div className="cell" data-cell="orders">
          <span className="sl">הזמנות</span>
          <span className="sv num tabular-nums whitespace-nowrap">
            {fmtOrdersText(store.orders)}
          </span>
        </div>
        <div className={cn('cell', aovClass)} data-cell="aov">
          <span className="sl">AOV</span>
          <Money value={store.aov} compactAbove={100_000} className="sv num" />
        </div>
      </div>

      {/* Zone 3 — per-platform CPM. CPM cells use ONLY `cell` (no emphasis).
          Bumped sizes per 2.5.4 patch: label 10→12, value 14→18. */}
      {cpmEntries.length > 0 && (
        <div className="cpm-row mt-5 pt-4 border-t border-dashed border-glass-edge">
          <div className="cpm-row-label font-mono text-[11px] md:text-[12px] uppercase tracking-[0.08em] text-ink-subtle font-bold mb-3">
            CPM לפי פלטפורמה
          </div>
          <div className={cn('cpm-row-cells grid gap-3', cpmGridCols)}>
            {cpmEntries.map(({ platform, data }) => (
              <div
                key={platform}
                className="cell"
                data-cell="cpm"
                data-platform={platform}
              >
                <PlatformBadge platform={platform} size="sm" />
                {/* Round-6 (2026-05-31): spend caption uses compact
                    notation because per-platform spend regularly hits 5
                    digits, and the CPM cell is narrower than the main
                    metric cells (3-up grid on a card that's already 1/3
                    of the row). Wave C3 (2026-06-01): the value renders via
                    <Money> (tabular-nums + nowrap + a compact floor at ≥10k,
                    value-exact in title/sr-only) so the digits are never
                    clipped — `truncate` removed from this span. The
                    `.cpm-spend-cap` foreground colour is set in globals.css
                    (Wave B2 → `--band-scrim-ink`) and inherits to the inner
                    <Money> bdi. CPM value (the big number below) stays
                    full-precision because it's typically $5-$50. */}
                <span className="cpm-spend-cap text-[11px] text-ink-muted leading-tight">
                  spend · <Money value={data.spend} compactAbove={10_000} className="text-[11px]" />
                </span>
                <Money
                  value={data.cpm}
                  compactAbove={100_000}
                  className="text-[20px] md:text-[22px] font-semibold leading-none"
                />
              </div>
            ))}
          </div>
        </div>
      )}
    </Card>
  );
}
