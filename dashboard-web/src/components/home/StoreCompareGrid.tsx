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
 * Horizon re-skin (W3.4, 2026-06-13): rebuilt to the approved
 * "ניתוח השוואתי" card recipe
 * (docs/superpowers/mockups/2026-06-12-horizon-reskin/home-approved.html,
 * lines 294-313): the whole grid now sits inside the shared <Card> glass
 * surface (`rounded-hz`, the exact Horizon 20px radius + light/dark fill +
 * Horizon drop shadow) with the section title as its header, and a FOOTER
 * inset-well (`bg-pill-track` — the canonical sunken-well token) carrying the
 * business-wide NC-ROAS · nCAC · new/returning/unclassified figures. The 7
 * data columns are PRESERVED unchanged (no-info-loss: the mockup only sketches
 * 4, but CPM/AOV/orders survive the re-skin — STAYS/MOVES only).
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
 *   • ROAS is a band-coloured PILL whose band is classified through the SINGLE
 *     SOURCE OF TRUTH `bandForRoas` in lib/roasBands.ts (<2 red / <2.7 orange /
 *     <=3 green / >3 blue / spend===0 gray) and rendered with the shared
 *     `band-chip` + `chip-{band}` recipe (the SAME pill the hero/Widget band
 *     tags use). That recipe is an AA-safe tint + band-coloured text — never
 *     text-colour-derived-from-a-variable-brand — so the pill clears AA in BOTH
 *     themes. NO local parallel band fork lives in this file.
 *   • Metric value-tinting per [[home-visual-rules]]: SPEND gets a subtle
 *     status-red cell wash (money out), REVENUE a subtle status-green wash
 *     (money in); CPM / AOV / orders stay NEUTRAL (no value colour) — the
 *     status-*Bg tokens are translucent so the wash never fights the on-colour
 *     fg text contrast.
 *   • NC-ROAS / nCAC footer — REUSES the EXACT same business-wide new-customer
 *     aggregate the hero renders (CommandCenterNewCustomer, computed ONCE in
 *     Dashboard as `heroNewCustomer` and threaded to BOTH the hero tile and
 *     this footer). No second NC aggregate is computed here. Confidence gate
 *     (suppressed / low) is mirrored from the hero so the two surfaces can
 *     never disagree.
 *   • RTL/logical: text-start headers, the table flows in the document's `dir`;
 *     store names are <bdi dir="ltr"> so a latin handle never mirror-breaks.
 *
 * This file is component-only — Phase 2 owns the wiring (Dashboard.tsx feeds it
 * the real `toPerStoreData(...)` output + the `newCustomer` footer aggregate).
 * The `PerStoreData` shape is imported from <PerStoreRow> so both Home surfaces
 * share one contract.
 */

import { cn, formatNumber } from '@/lib/utils';
import { Money } from '@/components/ui/Money';
import { Card } from '@/components/ui/Card';
import { Heading } from '@/components/ui/Typography';
import { bandForRoas, type CoreRoasBand } from '@/lib/roasBands';
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
import type { CommandCenterNewCustomer } from '@/components/home/CommandCenterHero';

/* --------------------------------------------------------------------------
 * ROAS band → shared chip class. The band is classified through the SINGLE
 * SOURCE OF TRUTH (`bandForRoas`); the class is the SAME `chip-{band}` recipe
 * the hero/Widget band tags use (globals.css: AA-safe tint + band-coloured
 * text). This is NOT a parallel band fork — it is a 1:1 band→class lookup over
 * the canonical CoreRoasBand union, identical to Widget.chipClassForBand.
 * -------------------------------------------------------------------------- */

function chipClassForBand(band: CoreRoasBand): string {
  switch (band) {
    case 'red':
      return 'chip-red';
    case 'orange':
      return 'chip-orange';
    case 'green':
      return 'chip-green';
    case 'blue':
      return 'chip-blue';
    case 'gray':
    default:
      return 'chip-gray';
  }
}

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

/** NC-ROAS display — 2 decimals, "—" for null. Mirrors the hero's `fmtRoas`
 *  so the footer and the hero NC tile never show a different number. */
function fmtNcRoas(n: number | null | undefined): string {
  if (n == null || Number.isNaN(n)) return '—';
  return n.toFixed(2);
}

/* --------------------------------------------------------------------------
 * ROAS pill — the only value-coloured token in the grid. Band classified via
 * the single source of truth (`bandForRoas`); class from the shared chip recipe.
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
  let band: CoreRoasBand;
  let text: string;
  if (state === 'organic') {
    band = 'blue';
    text = 'אורגני';
  } else if (state === 'off-empty' || state === 'off-negative') {
    band = 'gray';
    text = '0';
  } else {
    // SINGLE SOURCE: classify the ROAS through bandForRoas (the operator-locked
    // ladder). null/≤0 → gray (no meaningful ratio); else the canonical band.
    band = roas != null && roas > 0 ? bandForRoas(roas) : 'gray';
    text = roas != null && roas > 0 ? `${roas.toFixed(2)}x` : '—';
  }
  return (
    <span
      data-testid="roas-pill"
      data-tone={band}
      className={cn(
        'band-chip whitespace-nowrap',
        chipClassForBand(band),
      )}
    >
      <bdi dir={state === 'organic' ? 'rtl' : 'ltr'}>{text}</bdi>
    </span>
  );
}

/* --------------------------------------------------------------------------
 * NC-ROAS / nCAC footer inset (mockup lines 306-311).
 *
 * REUSES the EXACT business-wide new-customer aggregate the hero renders
 * (CommandCenterNewCustomer = computeNewCustomerMetrics output, computed ONCE
 * in Dashboard as `heroNewCustomer`). No second aggregate is computed here. The
 * confidence gate is mirrored from the hero so the surfaces never disagree:
 *   • 'suppressed' → hide the NC-ROAS/nCAC ratios (too much unclassifiable
 *     signal to trust them) + show "לא מספיק דאטה לסיווג"; keep the order-mix
 *     line (it's count-based, always honest).
 *   • 'low'        → render the ratios + a "ביטחון נמוך" badge.
 *   • 'ok'         → render normally.
 * Every field the footer shows (ncRoas, nCac, ncOrders, returningOrders,
 * unclassifiableShare) is truthfully present on the aggregate.
 * -------------------------------------------------------------------------- */

function NcFooter({ nc }: { nc: CommandCenterNewCustomer }) {
  const suppressed = nc.confidence === 'suppressed';
  return (
    <div
      data-testid="store-compare-nc-footer"
      className="mt-4 flex items-center gap-5 rounded-2xl bg-pill-track p-4"
    >
      {suppressed ? (
        <div
          className="text-sm text-ink-muted"
          data-testid="store-compare-nc-suppressed"
        >
          <bdi dir="rtl">לא מספיק דאטה לסיווג</bdi>
        </div>
      ) : (
        <>
          <div>
            <div className="flex items-center gap-1.5 text-[10.5px] font-semibold text-ink-muted">
              <span>NC-ROAS · נטו</span>
              {nc.confidence === 'low' && (
                <span
                  className="band-chip chip-orange"
                  data-testid="store-compare-nc-confidence"
                >
                  ביטחון נמוך
                </span>
              )}
            </div>
            <div
              className="text-xl font-bold tabular-nums text-ink"
              data-testid="store-compare-nc-roas"
            >
              <bdi dir="ltr">{fmtNcRoas(nc.ncRoas)}</bdi>
            </div>
          </div>

          <div className="h-8 w-px bg-border-subtle" aria-hidden="true" />

          <div>
            <div className="text-[10.5px] font-semibold text-ink-muted">nCAC</div>
            <div
              className="text-xl font-bold tabular-nums text-ink"
              data-testid="store-compare-ncac"
            >
              <bdi dir="ltr">
                <Money value={nc.nCac} prefix="$" compactAbove={1_000_000} />
              </bdi>
            </div>
          </div>
        </>
      )}

      {/* Order-mix — always shown (count-based, honest even when the ratio is
          suppressed): new · returning · unclassified. */}
      <div
        className="ms-auto text-[10.5px] font-medium leading-relaxed text-ink-muted tabular-nums"
        data-testid="store-compare-nc-mix"
      >
        <bdi dir="rtl">
          {nc.ncOrders.toLocaleString('en-US')} חדשות ·{' '}
          {nc.returningOrders.toLocaleString('en-US')} חוזרות
          <br />
          {(nc.unclassifiableShare * 100).toFixed(0)}% לא מסווג
        </bdi>
      </div>
    </div>
  );
}

/* --------------------------------------------------------------------------
 * Component
 * -------------------------------------------------------------------------- */

export interface StoreCompareGridProps {
  stores: PerStoreData[];
  /**
   * Business-wide NC-ROAS / nCAC footer aggregate — the SAME
   * CommandCenterNewCustomer value the hero consumes (Dashboard computes it
   * once as `heroNewCustomer`). Omit to hide the footer entirely (back-compat).
   */
  newCustomer?: CommandCenterNewCustomer;
  className?: string;
}

export function StoreCompareGrid({ stores, newCustomer, className }: StoreCompareGridProps) {
  if (!stores.length) return null;

  return (
    <Card role="region" aria-label={STORE_COMPARE_HEADING} className={cn('overflow-hidden', className)}>
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

      {/* NC-ROAS / nCAC footer inset (mockup 306-311) — same aggregate the hero
          renders; omitted when the parent doesn't thread it (back-compat). */}
      {newCustomer && <NcFooter nc={newCustomer} />}
    </Card>
  );
}
