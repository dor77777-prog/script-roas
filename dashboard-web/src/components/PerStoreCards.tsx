'use client';

import type { ReactNode } from 'react';
import { Trophy, AlertTriangle, ShoppingBag } from 'lucide-react';
import { cn, formatCurrency, formatNumber } from '@/lib/utils';
import { roasLabel, type StoreAgg } from '@/lib/analytics';
import { storeHasTikTok } from '@/lib/platformsByStore';
import { storeColor } from '@/lib/storeColors';

function colorFor(name: string, idx: number) {
  return storeColor(name, idx);
}

/**
 * A9-06 + A9-07 (2026-05-27) — pure leader/risk selection.
 *
 *  - Leader is the EXPLICIT max-by-ROAS (A9-06), not `withRoas[0]` which
 *    relied on an implicit upstream desc-sort that could silently break.
 *  - The trophy only shows when the leader's ROAS ≥ 2.0 (A9-07). When ALL
 *    stores sit in the red zone (< 2.0), celebrating a "leader" contradicts
 *    the risk warning shown on the lowest store — so we suppress the trophy.
 *  - Risk flags the LOWEST store when its ROAS < 2.0 (unchanged).
 *  - Both decorations require ≥ 2 stores with positive ROAS; a single-store
 *    view gets no trophy/risk badge.
 */
export function selectLeaderAndRisk(
  data: Pick<StoreAgg, 'store' | 'roas'>[],
): { topStore: string | null; riskyStore: string | null } {
  const withRoas = data.filter((s) => s.roas > 0);
  if (withRoas.length < 2) return { topStore: null, riskyStore: null };

  const leader = withRoas.reduce((best, s) => (s.roas > best.roas ? s : best));
  const lowest = withRoas.reduce((worst, s) => (s.roas < worst.roas ? s : worst));

  return {
    // Gate the trophy on the leader clearing the red-zone threshold.
    topStore: leader.roas >= 2 ? leader.store : null,
    riskyStore: lowest.roas < 2 ? lowest.store : null,
  };
}

const TONE_BG: Record<string, string> = {
  red: 'bg-status-redBg text-status-red',
  orange: 'bg-status-orangeBg text-status-orange',
  green: 'bg-status-greenBg text-status-green',
  blue: 'bg-status-blueBg text-status-blue',
  gray: 'bg-elevated2 text-ink-muted',
};

type Props = {
  data: StoreAgg[];
  /**
   * Phase 05.7.8 — per-store order count for the active range. Keyed by
   * `storeName` to match `StoreAgg.store`. Missing keys render as "—" so the
   * card degrades gracefully while orders-attribution is still loading.
   */
  ordersByStore?: Record<string, number>;
  /** Wrap output in <section> with a header. False when used inside CollapsibleSection. */
  bare?: boolean;
};

export function PerStoreCards({ data, ordersByStore, bare = false }: Props) {
  if (!data.length) return null;

  // Identify top/bottom by ROAS so we can decorate the cards inline.
  // selectLeaderAndRisk uses an explicit max (A9-06) and gates the trophy on
  // the leader clearing ROAS 2.0 (A9-07) so an all-red-zone view doesn't show
  // a celebratory leader. See the helper for the full rationale.
  const { topStore, riskyStore } = selectLeaderAndRisk(data);

  const grid = (
    <div className={cn('grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4', !bare && 'mt-3')}>
      {data.map((s, i) => (
        <StoreCard
          key={s.store}
          agg={s}
          color={colorFor(s.store, i)}
          isTop={s.store === topStore}
          isRisky={s.store === riskyStore}
          orderCount={ordersByStore?.[s.store]}
        />
      ))}
    </div>
  );

  if (bare) return <div className="p-4 sm:p-5">{grid}</div>;

  return (
    <section className="space-y-3">
      <h2 className="flex items-center gap-2 text-base font-semibold text-ink">
        ביצועים לפי חנות
      </h2>
      {grid}
    </section>
  );
}

function StoreCard({
  agg,
  color,
  isTop,
  isRisky,
  orderCount,
}: {
  agg: StoreAgg;
  color: string;
  isTop: boolean;
  isRisky: boolean;
  orderCount?: number;
}) {
  const info = roasLabel(agg.roas);
  return (
    <div className="rounded-xl bg-elevated border border-line shadow-sm overflow-hidden">
      {/* Color bar header */}
      <div
        className="px-4 sm:px-5 py-2.5 sm:py-3 text-white font-semibold flex items-center justify-between gap-2"
        style={{ background: color }}
      >
        <span className="truncate">🏪 <bdi dir="ltr">{agg.store}</bdi></span>
        {isTop && (
          <span
            className="inline-flex items-center gap-1 text-[10px] sm:text-[11px] font-bold bg-white/20 backdrop-blur-sm px-1.5 py-0.5 rounded"
            title="חנות מובילה ב-ROAS"
          >
            <Trophy size={12} /> מובילה
          </span>
        )}
        {isRisky && !isTop && (
          <span
            className="inline-flex items-center gap-1 text-[10px] sm:text-[11px] font-bold bg-white/20 backdrop-blur-sm px-1.5 py-0.5 rounded"
            title="ROAS נמוך — דורש בחינה"
          >
            <AlertTriangle size={12} /> בחינה
          </span>
        )}
      </div>
      <div className="p-4 sm:p-5 space-y-3">
        <div className="text-center">
          <div className="text-3xl sm:text-4xl font-bold text-ink tabular-nums">
            {formatNumber(agg.roas)}
          </div>
          <span
            className={cn(
              'inline-block mt-2 px-2.5 py-1 text-xs font-semibold rounded',
              TONE_BG[info.tone],
            )}
          >
            {info.text}
          </span>
        </div>
        <div className="grid grid-cols-1 gap-1.5 text-sm pt-2 border-t border-line">
          <Row label="הכנסות" value={`CAD ${formatCurrency(agg.revenue)}`} />
          <Row label="הוצאות" value={`CAD ${formatCurrency(agg.spend)}`} />
          {/* Phase 05.7.7 — surface Meta / Google / TikTok breakdown so each
              store card shows where the ad budget actually went.
              Phase 05.7.x (2026-05-23): TikTok now renders for every store
              that has the integration wired (currently uzoshop only) even
              when ttSpend = 0 — same convention as Google. Operators
              expected to see "TikTok: —" on a zero-spend day, not a missing
              column ("did the integration break? am I looking at the wrong
              store?"). */}
          <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-0.5 text-[11px] text-ink-muted ps-3">
            <span>Meta: <span className="text-ink-secondary tabular-nums">{formatCurrency(agg.fbSpend)}</span></span>
            <span>Google: <span className="text-ink-secondary tabular-nums">{agg.gaSpend > 0 ? formatCurrency(agg.gaSpend) : '—'}</span></span>
            {storeHasTikTok(agg.store) && (
              <span>TikTok: <span className="text-ink-secondary tabular-nums">{(agg.ttSpend ?? 0) > 0 ? formatCurrency(agg.ttSpend ?? 0) : '—'}</span></span>
            )}
          </div>
          {/* Phase 05.7.8 — order count for the range. `undefined` means the
              orders-attribution fetch hasn't resolved yet; show "—" until it
              does. 0 is a legitimate value (e.g., a slow morning) and renders
              as the explicit zero. */}
          <Row
            label={
              <span className="inline-flex items-center gap-1">
                <ShoppingBag size={12} className="text-ink-muted" />
                הזמנות
              </span>
            }
            // Audit fix 2026-05-23 (FIND-05 dashboard-fidelity): "…" for
            // loading, "0" for genuine zero orders. Mirrors TodayLive.
            value={orderCount === undefined ? '…' : formatNumber(orderCount, 0)}
          />
          <Row label="רווח גולמי" value={`CAD ${formatCurrency(agg.grossProfit)}`} bold />
        </div>
      </div>
    </div>
  );
}

function Row({ label, value, bold = false }: { label: ReactNode; value: string; bold?: boolean }) {
  return (
    <div className="flex justify-between">
      <span className="text-ink-secondary">{label}:</span>
      <span
        className={cn(
          'tabular-nums',
          bold ? 'font-semibold text-ink' : 'text-ink',
        )}
      >
        {value}
      </span>
    </div>
  );
}
