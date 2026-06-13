'use client';

// channel-nc-roas-split (Wave 2) — per-channel new-customer panel (Meta /
// Google / TikTok), used in CommandCenterHero (business) + StoreDetailModal
// (per store). Token-driven (brand colors via PLATFORM_TOKENS), light+dark,
// RTL, WCAG-AA (numbers via <Money>, band color carries a label not just hue).
// CAPI-safe: pure display of already-computed numbers.

import { AlertTriangle } from 'lucide-react';
import { Money } from '@/components/ui/Money';
import { CHART_COLORS } from '@/lib/chartColors';
import { cn } from '@/lib/utils';
import { bandForRoas } from '@/lib/roasBands';
import type { Channel, ChannelMetric } from '@/lib/home/channelTruth';

const CHANNEL_LABEL: Record<Channel, string> = { meta: 'Meta', google: 'Google', tiktok: 'TikTok' };

/**
 * Channel-card health tone. Classification delegates to the single source of
 * truth (`bandForRoas`, lib/roasBands.ts) — this panel previously carried its
 * OWN 3-band scale (≥3/≥2/<2) that DROPPED the 2.7 orange boundary and the blue
 * band, so a 2.9× channel read "תקין" here but "בריא" (green) everywhere else. The
 * canonical 5 bands fold into this panel's 4-tone presentation: blue/green →
 * good, orange → warn, red → bad, gray/null → none. Gray-guard for null/NaN
 * at the call site (the bandForRoas precondition).
 */
function roasBand(roas: number | null): 'good' | 'warn' | 'bad' | 'none' {
  if (roas == null || !Number.isFinite(roas)) return 'none';
  const band = bandForRoas(roas);
  switch (band) {
    case 'blue':
    case 'green':  return 'good';
    case 'orange': return 'warn';
    case 'red':    return 'bad';
    case 'gray':   return 'none';
    default: { const _exhaustive: never = band; return 'none'; }
  }
}
const bandFg = (b: ReturnType<typeof roasBand>) =>
  b === 'good' ? 'text-status-greenFg' : b === 'warn' ? 'text-status-warningFg' : b === 'bad' ? 'text-status-redFg' : 'text-ink-muted';
/**
 * Horizon re-skin (W3.8b) — the band tag renders through the SHARED
 * `band-chip` + `chip-{band}` recipe (globals.css), the same AA-safe tint the
 * Widget / RoasTargetChart / StoreDetailModal pills use. The band CLASSIFICATION
 * is unchanged (still `bandForRoas` → `roasBand`); this only maps the 4-tone
 * presentation onto the canonical chip palette: good→green, warn→orange,
 * bad→red, none→gray.
 */
const bandChip = (b: ReturnType<typeof roasBand>) =>
  b === 'good' ? 'chip-green'
  : b === 'warn' ? 'chip-orange'
  : b === 'bad' ? 'chip-red'
  : 'chip-gray';
const bandLabel = (b: ReturnType<typeof roasBand>) =>
  b === 'good' ? 'בריא' : b === 'warn' ? 'תקין' : b === 'bad' ? 'חלש' : 'אין נתונים';

/**
 * Badge text for a channel whose NC-ROAS is null. Distinguishes "spent but
 * acquired nothing" (אין גיוס) from a truly empty channel (אין נתונים).
 */
export function channelEmptyLabel(m: Pick<ChannelMetric, 'spend' | 'ncRoas' | 'ncOrders'>): string {
  return m.spend > 0 && m.ncRoas == null && m.ncOrders === 0 ? 'אין גיוס' : 'אין נתונים';
}

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
              className="relative overflow-hidden rounded-hz bg-pill-track p-3"
            >
              <span className="absolute inset-x-0 top-0 h-[3px]" style={{ background: CHART_COLORS[m.channel] }} />
              <div className="flex items-center gap-1.5 text-fs-sm font-bold text-ink">
                <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: CHART_COLORS[m.channel] }} />
                {CHANNEL_LABEL[m.channel]}
              </div>
              <div className={cn('mt-2 text-2xl font-extrabold tabular-nums', bandFg(b))}>
                {m.ncRoas == null ? '—' : `${m.ncRoas.toFixed(1)}×`}
              </div>
              <div className="text-fs-2xs text-ink-muted">NC-ROAS</div>
              <div className="mt-2 space-y-1 text-fs-xs">
                <div className="flex justify-between"><span className="text-ink-secondary">nCAC</span>
                  <span className="text-ink tabular-nums">{m.nCac == null ? '—' : <Money value={m.nCac} />}</span></div>
                <div className="flex justify-between"><span className="text-ink-secondary">הכנסת לקוחות-חדשים</span>
                  <span className="text-ink tabular-nums"><Money value={m.ncRevenue} /></span></div>
                <div className="flex justify-between"><span className="text-ink-secondary">הוצאה</span>
                  <span className="text-ink tabular-nums"><Money value={m.spend} /></span></div>
                <div className="flex justify-between"><span className="text-ink-secondary">הזמנות חדשות</span>
                  <span className="text-ink tabular-nums">{m.ncOrders}</span></div>
                {m.overcountPct != null && (
                  <div
                    data-testid={`channel-overcount-${m.channel}`}
                    className="flex justify-between"
                  >
                    <span className="text-ink-muted">ספירת-יתר</span>
                    <span className={cn('tabular-nums', m.overcountPct > 0 ? 'text-status-warningFg' : 'text-ink-muted')}>
                      +{Math.round(m.overcountPct * 100)}%
                    </span>
                  </div>
                )}
                <div className="flex justify-between border-t border-glass-edge pt-1 mt-0.5">
                  <span className="text-ink-secondary">רווח-נטו (אחרי עלויות)</span>
                  <span className={cn('tabular-nums font-bold', m.ncNetProfit == null ? 'text-ink-muted' : m.ncNetProfit >= 0 ? 'text-status-greenFg' : 'text-status-redFg')}>
                    {m.ncNetProfit == null ? '—' : <Money value={m.ncNetProfit} />}
                  </span>
                </div>
              </div>
              <span className={cn('band-chip mt-2', bandChip(b))}>
                {b === 'none' ? channelEmptyLabel(m) : bandLabel(b)}
              </span>
            </div>
          );
        })}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 rounded-hz border border-dashed border-glass-edge bg-pill-track px-3 py-2 text-fs-xs">
        <span className="text-ink-secondary">
          בלנדי (כל הערוצים):{' '}
          <b className="text-ink tabular-nums">{blendedNcRoas == null ? '—' : `NC-ROAS ${blendedNcRoas.toFixed(1)}×`}</b>
          {blendedNcac != null && <> · <b className="text-ink tabular-nums">nCAC <Money value={blendedNcac} /></b></>}
        </span>
        {unclassifiableShare != null && unclassifiableShare > 0 && (
          <span className="text-fs-2xs text-ink-muted tabular-nums">
            {Math.round(unclassifiableShare * 100)}% מההזמנות לא-מסווגות — לא נכללות בפיצול
          </span>
        )}
      </div>

      {showInsight && (
        <div
          data-testid="channel-insight"
          className="flex items-start gap-1.5 rounded-hz bg-status-warningBg px-3 py-2 text-fs-xs font-semibold text-status-warningFg"
        >
          <AlertTriangle size={14} aria-hidden className="mt-0.5 flex-none" />
          <span>
            הבלנדי מסתיר את הפער: <b>{CHANNEL_LABEL[best.channel]} {best.ncRoas.toFixed(1)}×</b> מסבסד את{' '}
            <b>{CHANNEL_LABEL[worst.channel]} {worst.ncRoas.toFixed(1)}×</b>. שקול להזיז תקציב.
          </span>
        </div>
      )}
    </div>
  );
}
