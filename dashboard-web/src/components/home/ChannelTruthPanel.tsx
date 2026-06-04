'use client';

// channel-nc-roas-split (Wave 2) — per-channel new-customer panel (Meta /
// Google / TikTok), used in CommandCenterHero (business) + StoreDetailModal
// (per store). Token-driven (brand colors via PLATFORM_TOKENS), light+dark,
// RTL, WCAG-AA (numbers via <Money>, band color carries a label not just hue).
// CAPI-safe: pure display of already-computed numbers.

import { Money } from '@/components/ui/Money';
import { CHART_COLORS } from '@/lib/chartColors';
import { cn } from '@/lib/utils';
import type { Channel, ChannelMetric } from '@/lib/home/channelTruth';

const CHANNEL_LABEL: Record<Channel, string> = { meta: 'Meta', google: 'Google', tiktok: 'TikTok' };

/** ROAS bands (same anchors as the dashboard ROAS bands): ≥3 healthy, ≥2 warn, <2 weak. */
function roasBand(roas: number | null): 'good' | 'warn' | 'bad' | 'none' {
  if (roas == null || !Number.isFinite(roas)) return 'none';
  if (roas >= 3) return 'good';
  if (roas >= 2) return 'warn';
  return 'bad';
}
const bandFg = (b: ReturnType<typeof roasBand>) =>
  b === 'good' ? 'text-status-greenFg' : b === 'warn' ? 'text-status-warningFg' : b === 'bad' ? 'text-status-redFg' : 'text-ink-muted';
const bandChip = (b: ReturnType<typeof roasBand>) =>
  b === 'good' ? 'bg-status-greenBg text-status-greenFg'
  : b === 'warn' ? 'bg-status-warningBg text-status-warningFg'
  : b === 'bad' ? 'bg-status-redBg text-status-redFg'
  : 'bg-glass-2 text-ink-muted';
const bandLabel = (b: ReturnType<typeof roasBand>) =>
  b === 'good' ? 'בריא' : b === 'warn' ? 'תקין' : b === 'bad' ? 'חלש' : 'אין נתונים';

export interface ChannelTruthPanelProps {
  metrics: ChannelMetric[];
  /** Blended NC-ROAS / nCAC for the summary strip (from computeNewCustomerMetrics). */
  blendedNcRoas?: number | null;
  blendedNcac?: number | null;
  /** Share of new orders with no clear channel label (0..1) — honesty note. */
  unclassifiableShare?: number;
  className?: string;
}

export function ChannelTruthPanel({
  metrics,
  blendedNcRoas,
  blendedNcac,
  unclassifiableShare,
  className,
}: ChannelTruthPanelProps) {
  // Insight: the blended ratio can hide a strong channel subsidising a weak one.
  const withRoas = metrics.filter((m) => m.ncRoas != null) as (ChannelMetric & { ncRoas: number })[];
  const best = withRoas.length ? withRoas.reduce((a, b) => (b.ncRoas > a.ncRoas ? b : a)) : null;
  const worst = withRoas.length ? withRoas.reduce((a, b) => (b.ncRoas < a.ncRoas ? b : a)) : null;
  const showInsight = best && worst && best.channel !== worst.channel && best.ncRoas - worst.ncRoas >= 1;

  return (
    <div data-testid="channel-truth-panel" className={cn('space-y-2.5', className)}>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
        {metrics.map((m) => {
          const b = roasBand(m.ncRoas);
          return (
            <div
              key={m.channel}
              data-testid={`channel-card-${m.channel}`}
              className="relative overflow-hidden rounded-xl border border-glass-edge bg-glass-2 p-3"
            >
              <span className="absolute inset-x-0 top-0 h-[3px]" style={{ background: CHART_COLORS[m.channel] }} />
              <div className="flex items-center gap-1.5 text-[12.5px] font-bold text-ink">
                <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: CHART_COLORS[m.channel] }} />
                {CHANNEL_LABEL[m.channel]}
              </div>
              <div className={cn('mt-2 text-2xl font-extrabold tabular-nums', bandFg(b))}>
                {m.ncRoas == null ? '—' : `${m.ncRoas.toFixed(1)}×`}
              </div>
              <div className="text-[10px] text-ink-muted">NC-ROAS</div>
              <div className="mt-2 space-y-1 text-[12px]">
                <div className="flex justify-between"><span className="text-ink-secondary">nCAC</span>
                  <span className="text-ink tabular-nums">{m.nCac == null ? '—' : <Money value={m.nCac} />}</span></div>
                <div className="flex justify-between"><span className="text-ink-secondary">הכנסת לקוחות-חדשים</span>
                  <span className="text-ink tabular-nums"><Money value={m.ncRevenue} /></span></div>
                <div className="flex justify-between"><span className="text-ink-secondary">הוצאה</span>
                  <span className="text-ink tabular-nums"><Money value={m.spend} /></span></div>
                <div className="flex justify-between"><span className="text-ink-secondary">הזמנות חדשות</span>
                  <span className="text-ink tabular-nums">{m.ncOrders}</span></div>
              </div>
              <span className={cn('mt-2 inline-block rounded-full px-2 py-0.5 text-[10px] font-extrabold', bandChip(b))}>
                {bandLabel(b)}
              </span>
            </div>
          );
        })}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-dashed border-glass-edge bg-glass-2 px-3 py-2 text-[12px]">
        <span className="text-ink-secondary">
          בלנדי (כל הערוצים):{' '}
          <b className="text-ink tabular-nums">{blendedNcRoas == null ? '—' : `NC-ROAS ${blendedNcRoas.toFixed(1)}×`}</b>
          {blendedNcac != null && <> · <b className="text-ink tabular-nums">nCAC <Money value={blendedNcac} /></b></>}
        </span>
        {unclassifiableShare != null && unclassifiableShare > 0 && (
          <span className="text-[10.5px] text-ink-muted tabular-nums">
            {Math.round(unclassifiableShare * 100)}% מההזמנות לא-מסווגות — לא נכללות בפיצול
          </span>
        )}
      </div>

      {showInsight && (
        <div
          data-testid="channel-insight"
          className="rounded-lg bg-status-warningBg px-3 py-2 text-[12px] font-semibold text-status-warningFg"
        >
          ⚠️ הבלנדי מסתיר את הפער: <b>{CHANNEL_LABEL[best.channel]} {best.ncRoas.toFixed(1)}×</b> מסבסד את{' '}
          <b>{CHANNEL_LABEL[worst.channel]} {worst.ncRoas.toFixed(1)}×</b>. שקול להזיז תקציב.
        </div>
      )}
    </div>
  );
}
