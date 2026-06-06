'use client';

/**
 * <StoreCompareGrid> — the comparative-analysis table for the Home tab.
 *
 * Mounted by the Phase 2 parent BELOW <PerStoreRow>: where the per-store row
 * gives each store its own vivid banded card, this grid lays every store on a
 * single ledger so the operator can scan them against each other at a glance —
 * one <TableRow> per store, columns:
 *
 *   חנות · הוצאה · הכנסה · ROAS · CPM · AOV · הזמנות
 *
 * Design contract (built to the 2026-06-01 readability + token standard from
 * the start — see [[uiux-accessibility-standard]] / CLAUDE.md mandatory rules):
 *
 *   • Built on the shared <TableBase> primitives (no raw <table>), so it
 *     inherits the glass header, --border-subtle separators and tabular-nums
 *     numerics for free, in both light + dark.
 *   • Every MONEY cell renders through the overflow-safe <Money> primitive
 *     (tabular-nums + nowrap + compact-floor, the EXACT value preserved in
 *     title/sr-only) so a digit is NEVER clipped — no `truncate` on numbers.
 *   • ROAS is a band-coloured PILL whose tone reuses the project's canonical
 *     `roasLabel(roas)` thresholds (<2 red / <2.7 orange / <=3 green / >3 blue
 *     / no-data gray) → `bg-status-{tone}Bg text-status-{tone}Fg`. These are
 *     the WCAG-AA on-colour status tokens (paired bg+fg, never text-colour-
 *     from-brand), so the pill clears AA in BOTH themes on the table's neutral
 *     surface. One source of truth for band wording/tone across every ROAS
 *     surface (cards, chart annotations, this grid).
 *   • Metric value-tinting per [[home-visual-rules]]: SPEND gets a subtle
 *     status-red cell wash (money out), REVENUE a subtle status-green wash
 *     (money in); CPM / AOV / orders stay NEUTRAL (no value colour) — the
 *     status-*Bg tokens are translucent so the wash never fights the on-colour
 *     fg text contrast.
 *   • RTL/logical: text-start headers, the table flows in the document's `dir`;
 *     store names are <bdi dir="ltr"> so a latin handle never mirror-breaks.
 *
 * This file is component-only — Phase 2 owns the wiring (Dashboard.tsx feeds it
 * the real `toPerStoreData(...)` output). The `PerStoreData` shape is imported
 * from <PerStoreRow> so both Home surfaces share one contract.
 */

import { cn, formatNumber } from '@/lib/utils';
import { Money } from '@/components/ui/Money';
import { Heading } from '@/components/ui/Typography';
import { roasLabel } from '@/lib/analytics';
import { adDisplayState, type AdDisplayState } from '@/lib/adState';
import {
  TableBase,
  TableHead,
  TableHeaderCell,
  TableRow,
  TableCell,
} from '@/components/ui/TableBase';
import type { Platform } from '@/components/ui/PlatformBadge';
import type { PerStoreData, PerStorePlatformCpm } from '@/components/home/PerStoreRow';

/* --------------------------------------------------------------------------
 * Tone → status-token class maps. The roasLabel() tone union is the key, so
 * the pill re-skins purely by swapping CSS variables (token-driven). Each
 * entry is a guaranteed-contrast bg + on-colour fg pairing.
 * -------------------------------------------------------------------------- */

type RoasTone = ReturnType<typeof roasLabel>['tone'];

const PILL_TONE_CLASS: Record<RoasTone, string> = {
  red:    'bg-status-redBg text-status-redFg',
  orange: 'bg-status-orangeBg text-status-orangeFg',
  green:  'bg-status-greenBg text-status-greenFg',
  blue:   'bg-status-blueBg text-status-blueFg',
  gray:   'bg-status-grayBg text-status-grayFg',
};

/** Subtle directional value-wash for the spend (red, money out) / revenue
 *  (green, money in) cells. The status-*Bg tokens are translucent so the wash
 *  reads as a tint behind the (separately-coloured, AA-safe) money glyphs
 *  rather than a hard fill — and re-skins with the theme. CPM/AOV/orders never
 *  call this (they stay neutral per [[home-visual-rules]]). */
function WASH_CLASS(tone: 'red' | 'green'): string {
  return cn(
    'inline-flex items-center justify-end rounded-md px-2 py-0.5',
    tone === 'red' ? 'bg-status-redBg' : 'bg-status-greenBg',
  );
}

/* --------------------------------------------------------------------------
 * Helpers
 * -------------------------------------------------------------------------- */

/** Heading shown above the grid. Exported so the Phase 2 parent can reference
 *  the same string for an aria-labelledby / anchor without duplicating copy. */
export const STORE_COMPARE_HEADING = 'ניתוח השוואתי';

/** Sum per-platform CPM into a single blended CPM for the compact table cell.
 *  Blended = Σspend / Σimpressions; we only have spend + CPM per platform, so
 *  we recover impressions as spend/CPM*1000 and re-blend. Returns null when no
 *  platform has positive spend (the cell then renders "—"). */
function blendedCpm(
  perPlatformCpm: Partial<Record<Platform, PerStorePlatformCpm>>,
): number | null {
  let spendSum = 0;
  let imprSum = 0;
  for (const key of Object.keys(perPlatformCpm) as Platform[]) {
    const v = perPlatformCpm[key];
    if (!v || v.spend <= 0 || v.cpm <= 0) continue;
    const impressions = (v.spend / v.cpm) * 1000;
    spendSum += v.spend;
    imprSum += impressions;
  }
  if (imprSum <= 0) return null;
  return (spendSum / imprSum) * 1000;
}

/** "—" for null/NaN counts, else a locale-grouped integer. */
function fmtOrders(n: number | null): string {
  if (n == null || Number.isNaN(n)) return '—';
  return formatNumber(n, 0);
}

/* --------------------------------------------------------------------------
 * ROAS pill — the only value-coloured token in the grid.
 * -------------------------------------------------------------------------- */

function RoasPill({
  roas,
  revenue,
  spend,
  off,
}: {
  roas: number | null;
  revenue: number | null;
  spend: number | null;
  off: boolean;
}) {
  const state: AdDisplayState = adDisplayState({ revenue, spend, off });
  let tone: RoasTone;
  let text: string;
  if (state === 'organic') {
    tone = 'blue';
    text = 'אורגני';
  } else if (state === 'off-empty' || state === 'off-negative') {
    tone = 'gray';
    text = '0';
  } else {
    tone = roas != null && roas > 0 ? roasLabel(roas).tone : 'gray';
    text = roas != null && roas > 0 ? `${roas.toFixed(2)}x` : '—';
  }
  return (
    <span
      data-testid="roas-pill"
      data-tone={tone}
      className={cn(
        'inline-flex items-center justify-center rounded-full px-2.5 py-0.5',
        'text-xs font-semibold tabular-nums whitespace-nowrap',
        PILL_TONE_CLASS[tone],
      )}
    >
      <bdi dir={state === 'organic' ? 'rtl' : 'ltr'}>{text}</bdi>
    </span>
  );
}

/* --------------------------------------------------------------------------
 * Component
 * -------------------------------------------------------------------------- */

export interface StoreCompareGridProps {
  stores: PerStoreData[];
  className?: string;
}

export function StoreCompareGrid({ stores, className }: StoreCompareGridProps) {
  if (!stores.length) return null;

  return (
    <section className={className} aria-label={STORE_COMPARE_HEADING}>
      <Heading level="section" as="h2" className="mb-3">
        {STORE_COMPARE_HEADING}
      </Heading>

      {/* Horizontal scroll guard so the 7 columns never clip a money glyph on
          a narrow viewport — the table keeps its own min width and the wrapper
          scrolls (mobile-first). */}
      <div className="overflow-x-auto">
        <TableBase minWidth={560}>
          <TableHead>
            <TableRow>
              <TableHeaderCell>חנות</TableHeaderCell>
              <TableHeaderCell numeric>הוצאה</TableHeaderCell>
              <TableHeaderCell numeric>הכנסה</TableHeaderCell>
              <TableHeaderCell numeric>ROAS</TableHeaderCell>
              <TableHeaderCell numeric>CPM</TableHeaderCell>
              <TableHeaderCell numeric>AOV</TableHeaderCell>
              <TableHeaderCell numeric>הזמנות</TableHeaderCell>
            </TableRow>
          </TableHead>
          <tbody>
            {stores.map((store) => {
              const cpm = blendedCpm(store.perPlatformCpm);
              return (
                <TableRow key={store.storeId} data-testid="store-compare-row">
                  <TableCell className="font-medium text-ink whitespace-nowrap">
                    <span data-cell="store">
                      <bdi dir="ltr">{store.storeName}</bdi>
                    </span>
                  </TableCell>

                  {/* Spend — subtle red wash (money out). The tint rides on an
                      inner rounded wrapper so the wash hugs the value without
                      flooding the whole numeric column. */}
                  <TableCell numeric>
                    <span data-cell="spend" className={WASH_CLASS('red')}>
                      <Money value={store.spend} compactAbove={1_000} />
                    </span>
                  </TableCell>

                  {/* Revenue — subtle green wash (money in). */}
                  <TableCell numeric>
                    <span data-cell="revenue" className={WASH_CLASS('green')}>
                      <Money value={store.revenue} compactAbove={1_000} />
                    </span>
                  </TableCell>

                  {/* ROAS — band-coloured pill (the value-coloured token). */}
                  <TableCell numeric>
                    <span data-cell="roas">
                      <RoasPill
                        roas={store.roas}
                        revenue={store.revenue}
                        spend={store.spend}
                        off={store.adOff ?? false}
                      />
                    </span>
                  </TableCell>

                  {/* CPM — neutral (no value colour). Blended across platforms. */}
                  <TableCell numeric>
                    <span data-cell="cpm">
                      <Money value={cpm} compactAbove={100_000} />
                    </span>
                  </TableCell>

                  {/* AOV — neutral. */}
                  <TableCell numeric>
                    <span data-cell="aov">
                      <Money value={store.aov} compactAbove={100_000} />
                    </span>
                  </TableCell>

                  {/* Orders — neutral count (never $-prefixed). */}
                  <TableCell numeric>
                    <span data-cell="orders" className="tabular-nums whitespace-nowrap">
                      {fmtOrders(store.orders)}
                    </span>
                  </TableCell>
                </TableRow>
              );
            })}
          </tbody>
        </TableBase>
      </div>
    </section>
  );
}
