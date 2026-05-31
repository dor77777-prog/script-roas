'use client';

import {
  Layers,
  ArrowUp,
  ArrowDown,
  ArrowUpDown,
  CheckCircle2,
  Circle,
} from 'lucide-react';
import { cn, formatCurrency, formatNumber } from '@/lib/utils';
import { Button } from '@/components/ui/Button';
import { TableBase } from '@/components/ui/TableBase';
import { HelpTooltip } from '@/components/ui/Tooltip';
import { Heading } from '@/components/ui/Typography';
import { roasLabel } from '@/lib/analytics';
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
 *  - `AdSetSortHeader` lives here as module-private — never exported.
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

// Tone-to-bg lookup for the ROAS chip cell. Duplicated from CampaignDrawer
// (smaller diff per PATTERNS.md §CampaignsTableRow recommendation —
// hoisting to @/lib/format would expand the change surface).
const TONE_BG: Record<string, string> = {
  red:    'bg-status-redBg text-status-red',
  orange: 'bg-status-orangeBg text-status-orange',
  green:  'bg-status-greenBg text-status-green',
  blue:   'bg-status-blueBg text-status-blue',
  gray:   'bg-glass-2 text-ink-muted',
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
              <AdSetSortHeader label="שם"          col="name"        sortKey={sortKey} dir={sortDir} onClick={onSort} align="start"  />
              <AdSetSortHeader label="הוצאה"       col="spend"       sortKey={sortKey} dir={sortDir} onClick={onSort} align="end"    />
              <AdSetSortHeader label="תקציב יומי"  col="budget"      sortKey={sortKey} dir={sortDir} onClick={onSort} align="end"    />
              <AdSetSortHeader label="ערך"         col="value"       sortKey={sortKey} dir={sortDir} onClick={onSort} align="end"    />
              <AdSetSortHeader label="ROAS"        col="roas"        sortKey={sortKey} dir={sortDir} onClick={onSort} align="center" />
              {/* Per-ad-set deterministic attribution. Header doesn't
                  sort (the data is shape-inferred per row). Tooltip
                  on each cell explains the chip. */}
              <th className="font-medium px-3 py-2 text-center text-ink-secondary">
                <HelpTooltip content="ROAS אמיתי לפי click-id (utm_term)">
                  <span>ROAS Shopify</span>
                </HelpTooltip>
              </th>
              <AdSetSortHeader label="המרות"       col="conversions" sortKey={sortKey} dir={sortDir} onClick={onSort} align="end"    />
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
                  )}
                  onClick={() => {
                    if (!canDrillToAds) return;
                    onDrillAds({
                      storeId: a.storeId,
                      campaignId: a.campaignId,
                      adSetId: a.id,
                      adSetName: a.name,
                    });
                  }}
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
                          ? 'text-status-green hover:bg-status-greenBg/60'
                          : 'text-ink-muted hover:text-status-green hover:bg-status-greenBg/40',
                      )}
                      title={isOptimized ? 'לחץ להסרת הסימון' : 'סמן כאופטימיזציה בוצעה'}
                      aria-label={isOptimized ? 'בטל סימון אופטימיזציה' : 'סמן כאופטימיזציה בוצעה'}
                      aria-pressed={isOptimized}
                    >
                      {isOptimized ? <CheckCircle2 size={16} /> : <Circle size={16} />}
                    </Button>
                  </td>
                  <HelpTooltip content={a.name}>
                    <td className="px-3 py-2 text-ink truncate max-w-[200px]">{a.name}</td>
                  </HelpTooltip>
                  <td className="px-3 py-2 text-end tabular-nums">{formatCurrency(a.spend)}</td>
                  <td className="px-3 py-2 text-end tabular-nums">
                    {a.adSetBudgetCad && a.adSetBudgetCad > 0 ? (
                      <span className={cn('font-medium', tight && 'text-status-warningFg')}>
                        {formatCurrency(a.adSetBudgetCad)}
                      </span>
                    ) : (
                      <span className="text-ink-muted">—</span>
                    )}
                  </td>
                  <td className={cn('px-3 py-2 text-end tabular-nums', a.value > a.spend && 'text-status-green font-medium')}>
                    {formatCurrency(a.value)}
                  </td>
                  <td className={cn('px-3 py-2 text-center font-semibold tabular-nums rounded', TONE_BG[info.tone])}>
                    {a.roas > 0 ? formatNumber(a.roas) : '—'}
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
                        adsetAttr.trust.level === 'high'    ? 'bg-status-greenBg/60 text-status-green'
                      : adsetAttr.trust.level === 'medium'  ? 'bg-status-warningBg text-status-warningFg'
                      : adsetAttr.trust.level === 'unknown' ? 'bg-glass-2 text-ink-secondary'
                      :                                       'bg-status-redBg/60 text-status-red';
                      const tooltip =
                        `ROAS אמיתי · ${adsetAttr.trust.label} (${adsetAttr.trust.score.toFixed(0)}/100)\n\n` +
                        `Meta דיווח: CAD ${a.value.toFixed(0)}\n` +
                        `click-id מתויג: CAD ${adsetAttr.deterministicRevenue.toFixed(0)} (${adsetAttr.deterministicOrders} הזמנות)\n` +
                        `modeled: CAD ${adsetAttr.modeledRevenue.toFixed(0)}\n\n` +
                        adsetAttr.reasons.map(r => `• ${r}`).join('\n') +
                        `\n\n💡 ${adsetAttr.recommendation}`;
                      return (
                        <HelpTooltip content={tooltip}>
                          <div className="inline-flex flex-col items-center gap-0.5">
                            <span className="font-semibold tabular-nums text-ink">
                              {detRoas > 0 ? formatNumber(detRoas) : '—'}
                            </span>
                            <span className={cn('inline-block text-[8px] font-bold px-1 py-0 rounded uppercase tracking-wider', tone)}>
                              {adsetAttr.trust.label}
                            </span>
                          </div>
                        </HelpTooltip>
                      );
                    })()}
                  </td>
                  <td className="px-3 py-2 text-end tabular-nums">{formatNumber(a.conversions, 0)}</td>
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

/**
 * Sort-aware <th> for the drawer's ad-sets table. Mirrors the SortHeader in
 * CampaignsTable but lives here so the drawer doesn't need to import that
 * component's narrower SortKey union. Module-private (not exported).
 */
function AdSetSortHeader({
  label,
  col,
  sortKey,
  dir,
  onClick,
  align,
}: {
  label: string;
  col: AdSetSortKey;
  sortKey: AdSetSortKey;
  dir: AdSetSortDir;
  onClick: (key: AdSetSortKey) => void;
  align: 'start' | 'center' | 'end';
}) {
  const isActive = col === sortKey;
  const justify =
    align === 'start' ? 'justify-start' : align === 'end' ? 'justify-end' : 'justify-center';
  const textAlign =
    align === 'start' ? 'text-start' : align === 'end' ? 'text-end' : 'text-center';
  return (
    <th className={cn('font-medium px-3 py-2', textAlign)}>
      <Button
        type="button"
        variant="ghost"
        onClick={() => onClick(col)}
        className={cn(
          'gap-1 select-none cursor-pointer w-full h-auto p-0',
          justify,
          isActive
            ? 'text-accent font-semibold'
            : 'text-ink-secondary hover:text-ink',
        )}
        aria-sort={isActive ? (dir === 'asc' ? 'ascending' : 'descending') : 'none'}
      >
        <span>{label}</span>
        {isActive ? (
          dir === 'asc' ? (
            <ArrowUp size={12} className="text-accent" />
          ) : (
            <ArrowDown size={12} className="text-accent" />
          )
        ) : (
          <ArrowUpDown size={12} className="opacity-0 group-hover:opacity-60 transition-opacity" />
        )}
      </Button>
    </th>
  );
}
