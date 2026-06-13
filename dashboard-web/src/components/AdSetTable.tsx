'use client';

import {
  Layers,
  CheckCircle2,
  Circle,
} from 'lucide-react';
import { cn, formatNumber } from '@/lib/utils';
import { fmtMoneyString } from '@/lib/format';
import { Button } from '@/components/ui/Button';
import { TableBase } from '@/components/ui/TableBase';
import { HelpTooltip } from '@/components/ui/Tooltip';
import { Heading } from '@/components/ui/Typography';
import { Money } from '@/components/ui/Money';
import { SortableHeader } from '@/components/ui/SortableHeader';
import { roasLabel } from '@/lib/analytics';
import { pendingRoasLabel } from '@/lib/campaignPendingState';
import { ROAS_TONE_BG, ROAS_BADGE_SHAPE } from '@/lib/format/roasCell';
import type { AttributionAnalysis } from '@/lib/attributionAnalysis';

/**
 * Sortable per-ad-set table inside the campaign drawer. The four behaviors
 * (sort headers, per-row optimization toggle, drill-to-ads on Meta+id rows,
 * per-ad-set trust chip) are all lifted byte-identical from
 * CampaignDrawer.tsx pre-refactor (lines 679-832 JSX block + 942-989
 * AdSetSortHeader helper).
 *
 * Critical preservation contracts:
 *  - The `!!()` boolean coercion at `canDrillToAds` (UI-SPEC §IN-06).
 *  - `attributionByAdSet` is a PROP, never recomputed inside the row map
 *    (UI-SPEC §IN5-01 visual symptom: chip flicker on sort).
 *  - Trust chip 4-level ladder (high → roas-green, medium → amber,
 *    unknown → muted, fallback → roas-red) byte-identical with the chip
 *    in CampaignsTableRow.
 *  - The sortable column header is the shared `@/components/ui/SortableHeader`
 *    (W4.4 — was a module-private `AdSetSortHeader` clone, consolidated with
 *    AdsDrawer's identical `AdSortHeader`).
 */

// Columns the drawer's ad-set table can be sorted by. Kept narrow because
// the drawer is a focused drilldown — full sortable surface is in
// CampaignsTable.
export type AdSetSortKey = 'name' | 'spend' | 'budget' | 'value' | 'roas' | 'conversions';
export type AdSetSortDir = 'asc' | 'desc';

type AdSetItem = {
  id: string;
  name: string;
  storeId: string;
  platform: string;
  campaignId: string;
  spend: number;
  value: number;
  clicks: number;
  impressions: number;
  conversions: number;
  adSetBudgetCad: number | null;
  roas: number;
};

type Props = {
  adSets: AdSetItem[];
  sortKey: AdSetSortKey;
  sortDir: AdSetSortDir;
  onSort: (key: AdSetSortKey) => void;
  attributionByAdSet: Map<string, AttributionAnalysis | null>;
  optimized: Set<string>;
  onToggleOptimized: (key: string) => void;
  onDrillAds: (set: { storeId: string; campaignId: string; adSetId: string; adSetName: string }) => void;
  /** 2026-06-09 (Task 7) — gates the "מתעדכן…/ממתין…" pending state. */
  rangeIncludesToday: boolean;
};

export function AdSetTable({
  adSets,
  sortKey,
  sortDir,
  onSort,
  attributionByAdSet,
  optimized,
  onToggleOptimized,
  onDrillAds,
  rangeIncludesToday,
}: Props) {
  return (
    <section>
      <Heading level="panel" className="inline-flex items-center gap-1.5 mb-2">
        <Layers size={14} className="text-ink-secondary" />
        אד-סטים ({adSets.length})
      </Heading>
      {/* Horizontal scroll mirrors the AdsDrawer pattern — the
          ad-sets table has 7 columns (toggle / name / spend / budget /
          value / ROAS / conversions) and gets wider than the drawer's
          640px on smaller widths. `overflow-x-auto` keeps the rounded
          border + lets the table scroll inside. */}
      {/* Same pattern as AdsDrawer: a real vertical scroll context
          on the wrapper so the sticky thead pins correctly when
          scrolling rows. */}
      <div className="rounded-xl border border-glass-edge overflow-auto max-h-[50vh]">
        <TableBase className="text-xs sm:text-sm" minWidth={720} stickyHeader>
          <thead>
            <tr className="text-ink-secondary">
              <th className="px-2 py-2 w-[36px]" aria-label="סימון" />
              <SortableHeader<AdSetSortKey> label="שם"         sortKey="name"   activeSortKey={sortKey} sortDir={sortDir} onSort={onSort} align="start" />
              <SortableHeader<AdSetSortKey> label="הוצאה"      sortKey="spend"  activeSortKey={sortKey} sortDir={sortDir} onSort={onSort} align="center" />
              <SortableHeader<AdSetSortKey> label="תקציב יומי" sortKey="budget" activeSortKey={sortKey} sortDir={sortDir} onSort={onSort} align="center" />
              <SortableHeader<AdSetSortKey> label="ערך"        sortKey="value"  activeSortKey={sortKey} sortDir={sortDir} onSort={onSort} align="center" />
              <SortableHeader<AdSetSortKey> label="ROAS"       sortKey="roas"   activeSortKey={sortKey} sortDir={sortDir} onSort={onSort} align="center" />
              {/* Per-ad-set deterministic attribution. Header doesn't
                  sort (the data is shape-inferred per row). Tooltip
                  on each cell explains the chip. */}
              <th className="font-medium px-3 py-2 text-center text-ink-secondary">
                <HelpTooltip content="ROAS אמיתי לפי click-id (utm_term)">
                  <span>ROAS Shopify</span>
                </HelpTooltip>
              </th>
              <SortableHeader<AdSetSortKey> label="המרות" sortKey="conversions" activeSortKey={sortKey} sortDir={sortDir} onSort={onSort} align="center" />
            </tr>
          </thead>
          <tbody>
            {adSets.map((a, i) => {
              const info = roasLabel(a.roas);
              // Same composite key the main CampaignsTable uses for
              // ad-set rows, so a mark made here shows there and vice
              // versa.
              const markKey = `${a.storeId}::${a.platform}::${a.campaignId}::${a.id || ''}`;
              const isOptimized = optimized.has(markKey);
              const tight = a.spend > 0 && a.adSetBudgetCad && a.spend > a.adSetBudgetCad * 0.95;
              // `!!()` so the type is strictly boolean — without it,
              // short-circuit gives `string | boolean` (the value of
              // `a.id` when truthy), which leaks into JSX props that
              // expect boolean (e.g. `disabled={!canDrillToAds}` would
              // render `disabled="123"` if added later). (#IN-06)
              // Phase 05.7.9 — TikTok ad-level rows now live in ads_daily
              // (Phase 05.7.7), so the drill-down works for both Meta and
              // TikTok. Google PMax still excluded (Shopping/PMax fallback
              // synthesizes campaign-level rows, no real ad granularity).
              const canDrillToAds = !!((a.platform === 'Meta' || a.platform === 'TikTok') && a.id);
              // 2026-06-10 audit (keyboard row drilldown): one handler shared
              // by click AND Enter/Space so the drill is keyboard-reachable
              // (mirrors the Card.tsx interactive pattern).
              const drillToAds = () => {
                if (!canDrillToAds) return;
                onDrillAds({
                  storeId: a.storeId,
                  campaignId: a.campaignId,
                  adSetId: a.id,
                  adSetName: a.name,
                });
              };
              return (
                <HelpTooltip
                  key={a.id || a.name || i}
                  content={canDrillToAds ? 'לחץ לראות את המודעות באד-סט' : undefined}
                >
                <tr
                  className={cn(
                    'border-t border-glass-edge transition-opacity',
                    isOptimized && 'opacity-50 hover:opacity-100',
                    canDrillToAds && 'cursor-pointer hover:bg-glass-2/30',
                    canDrillToAds &&
                      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
                  )}
                  // Keyboard reachability (Card.tsx pattern): tabIndex only on
                  // drillable rows; Enter/Space trigger the same drill as a
                  // click. role stays the native `row` — replacing it with
                  // `button` would break the table's required ARIA structure
                  // and flatten the cells for screen readers.
                  tabIndex={canDrillToAds ? 0 : undefined}
                  onClick={drillToAds}
                  onKeyDown={
                    canDrillToAds
                      ? (e) => {
                          // Only act on keys originating on the row itself —
                          // Enter/Space on the in-row optimize Button bubbles
                          // here and must not ALSO drill.
                          if (e.target !== e.currentTarget) return;
                          if (e.key === 'Enter' || e.key === ' ' || e.key === 'Spacebar') {
                            e.preventDefault(); // Space must not scroll the page
                            drillToAds();
                          }
                        }
                      : undefined
                  }
                >
                  <td className="px-2 py-2 text-center w-[36px]">
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={e => {
                        // Stop the click from bubbling up to the row,
                        // which would also open AdsDrawer for this
                        // ad-set. Mirrors the pattern used in
                        // CampaignsTable.tsx (line ~778).
                        e.stopPropagation();
                        onToggleOptimized(markKey);
                      }}
                      className={cn(
                        'w-7 h-7 rounded-full',
                        isOptimized
                          ? 'text-status-greenFg hover:bg-status-greenBg'
                          : 'text-ink-muted hover:text-status-greenFg hover:bg-status-greenBg',
                      )}
                      aria-label={isOptimized ? 'בטל סימון אופטימיזציה' : 'סמן כאופטימיזציה בוצעה'}
                      aria-pressed={isOptimized}
                    >
                      {isOptimized ? <CheckCircle2 size={16} /> : <Circle size={16} />}
                    </Button>
                  </td>
                  <HelpTooltip content={a.name}>
                    <td className="px-3 py-2 text-ink truncate max-w-[200px]">{a.name}</td>
                  </HelpTooltip>
                  <td className="px-3 py-2 text-center tabular-nums">
                    <Money value={a.spend} prefix="none" locale="he-IL" compactAbove={100_000} />
                  </td>
                  <td className="px-3 py-2 text-center tabular-nums">
                    {a.adSetBudgetCad && a.adSetBudgetCad > 0 ? (
                      <span className={cn('font-medium', tight && 'text-status-warningFg')}>
                        <Money value={a.adSetBudgetCad} prefix="none" locale="he-IL" compactAbove={100_000} className="font-medium" />
                      </span>
                    ) : (
                      <span className="text-ink-muted">—</span>
                    )}
                  </td>
                  <td className={cn('px-3 py-2 text-center tabular-nums', a.value > a.spend && 'text-status-greenFg font-medium')}>
                    <Money value={a.value} prefix="none" locale="he-IL" compactAbove={100_000} />
                  </td>
                  <td className="px-3 py-2 text-center font-semibold tabular-nums">
                    {/* OPERATOR FIX (2026-06-01): solid rounded badge (mirrors
                        HealthScoreBadge + mockup) instead of pale full-cell tint.
                        2026-06-09 (Task 7): "מתעדכן…/ממתין…" for today's spend=0
                        rows, rendered plain (not the alarming tone badge). */}
                    {(() => {
                      const pend = a.roas > 0
                        ? null
                        : pendingRoasLabel({ spend: a.spend, conversionValue: a.value, conversions: a.conversions, impressions: a.impressions }, rangeIncludesToday);
                      if (pend) return <span className="text-xs text-ink-muted">{pend}</span>;
                      return (
                        <span className={cn(ROAS_BADGE_SHAPE, ROAS_TONE_BG[info.tone])}>
                          {a.roas > 0 ? formatNumber(a.roas) : '—'}
                        </span>
                      );
                    })()}
                  </td>
                  {/* Deterministic ROAS per ad-set via utm_term. */}
                  <td className="px-3 py-2 text-center">
                    {(() => {
                      // Look up the pre-computed analysis instead of
                      // re-running the orders walk + Bayesian + window
                      // stability per cell per render. (IN5-01)
                      const adsetAttr = attributionByAdSet.get(a.id || a.name || '(אחר)') ?? null;
                      if (!adsetAttr) {
                        return <span className="text-ink-muted text-xs">—</span>;
                      }
                      const detRoas = a.spend > 0
                        ? adsetAttr.deterministicRevenue / a.spend
                        : 0;
                      const tone =
                        adsetAttr.trust.level === 'high'    ? 'bg-status-greenBg text-status-greenFg'
                      : adsetAttr.trust.level === 'medium'  ? 'bg-status-warningBg text-status-warningFg'
                      : adsetAttr.trust.level === 'unknown' ? 'bg-pill-track text-ink-secondary'
                      :                                       'bg-status-redBg text-status-redFg';
                      const tooltip =
                        `ROAS אמיתי · ${adsetAttr.trust.label} (${adsetAttr.trust.score.toFixed(0)}/100)\n\n` +
                        `${a.platform} דיווח: ${fmtMoneyString(a.value)}\n` +
                        `click-id מתויג: ${fmtMoneyString(adsetAttr.deterministicRevenue)} (${adsetAttr.deterministicOrders} הזמנות)\n` +
                        `modeled: ${fmtMoneyString(adsetAttr.modeledRevenue)}\n\n` +
                        adsetAttr.reasons.map(r => `• ${r}`).join('\n') +
                        // HelpTooltip content here is a plain string (no JSX),
                        // so the 💡 emoji is replaced with a textual cue.
                        `\n\nהמלצה: ${adsetAttr.recommendation}`;
                      return (
                        <HelpTooltip content={tooltip}>
                          <div className="inline-flex flex-col items-center gap-0.5">
                            <span className="font-semibold tabular-nums text-ink">
                              {detRoas > 0 ? formatNumber(detRoas) : '—'}
                            </span>
                            <span className={cn('inline-block text-fs-2xs font-bold px-1 py-0 rounded uppercase tracking-wider', tone)}>
                              {adsetAttr.trust.label}
                            </span>
                          </div>
                        </HelpTooltip>
                      );
                    })()}
                  </td>
                  <td className="px-3 py-2 text-center tabular-nums">{formatNumber(a.conversions, 0)}</td>
                </tr>
                </HelpTooltip>
              );
            })}
          </tbody>
        </TableBase>
      </div>
    </section>
  );
}

// Local AdSetSortHeader removed in W4.4 — consolidated into the shared
// `@/components/ui/SortableHeader` (also consumed by AdsDrawer). The exact
// aria-sort placement + arrow-before-label (RTL) behavior is preserved there.
