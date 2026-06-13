'use client';

// reskin-w3 — "לקוחות חדשים לפי פלטפורמה" (new-customers-by-platform) home card.
//
// A NEW home surface that RENDERS already-computed channel-truth data — it
// creates NO new aggregate. The `metrics: ChannelMetric[]` and the business
// `ncRoas` are threaded straight from the SAME `computeChannelTruth` /
// `computeNewCustomerMetrics` memo the hero (CommandCenterHero) + ChannelTruthPanel
// already consume in Dashboard (heroNewCustomer.channelTruth).
//
// DATA HONESTY (audit, W3.5): ChannelMetric truthfully exposes, per channel:
//   • ncOrders  — new-customer (first-order) count  → "N חדשים"
//   • spend / nCac / ncRoas                          → nCAC + NC-ROAS
// It does NOT expose a per-channel RETURNING-customer count (computeChannelTruth
// counts only `isFirstOrder === true` orders). The approved mockup shows a
// "חוזרים" line per platform, but there is NO truthful per-platform returning
// figure in the data — so that line is DELIBERATELY OMITTED rather than guessed
// or derived from a different denominator. Render only what the data supports.
//
// The share-bar denominator is Σ(ncOrders) across the SAME `metrics[]` — each
// platform's share of total NEW customers. No second data source, no new aggregate.
//
// Token-driven (platform colors via CHART_COLORS / PLATFORM_TOKENS; band coloring
// via the canonical `bandForRoas` → `chip-{band}` AA-safe recipe, never
// text-from-brand), RTL, light+dark first-class. CAPI-safe: pure display.

import { Card } from '@/components/ui/Card';
import { Money } from '@/components/ui/Money';
import { CHART_COLORS } from '@/lib/chartColors';
import { cn } from '@/lib/utils';
import { bandForRoas, type CoreRoasBand } from '@/lib/roasBands';
import type { Channel, ChannelMetric } from '@/lib/home/channelTruth';

// Platform display names — same atoms + order (Meta · Google · TikTok) the rest
// of the app renders (mirrors ChannelTruthPanel.CHANNEL_LABEL; the channel order
// is the canonical `CHANNELS` order the parent passes the metrics in).
const CHANNEL_LABEL: Record<Channel, string> = { meta: 'Meta', google: 'Google', tiktok: 'TikTok' };

/** band → shared `chip-{band}` class (globals.css: AA-safe tint + band-coloured
 *  text). Identical 1:1 lookup over CoreRoasBand used by Widget / StoreCompareGrid —
 *  NOT a parallel band fork. */
function chipClassForBand(band: CoreRoasBand): string {
  switch (band) {
    case 'red':    return 'chip-red';
    case 'orange': return 'chip-orange';
    case 'green':  return 'chip-green';
    case 'blue':   return 'chip-blue';
    case 'gray':
    default:       return 'chip-gray';
  }
}

/** Band for an NC-ROAS value, owning the null/≤0 normalization the bandForRoas
 *  precondition requires (null / non-finite / no-spend → gray). */
function ncRoasBand(roas: number | null, spend: number): CoreRoasBand {
  if (spend <= 0) return 'gray';
  if (roas == null || !Number.isFinite(roas) || roas <= 0) return 'gray';
  return bandForRoas(roas);
}

export interface NcByPlatformCardProps {
  /** Per-channel new-customer metrics — the SAME `computeChannelTruth` result the
   *  hero + ChannelTruthPanel consume (heroNewCustomer.channelTruth.metrics). */
  metrics: ChannelMetric[];
  /** Business-wide blended NC-ROAS for the header chip — the SAME value the hero
   *  NC tile shows (heroNewCustomer.channelTruth.blendedNcRoas). Not recomputed. */
  businessNcRoas?: number | null;
  /** Share of new orders with no clear channel label (0..1) — honesty note. */
  unclassifiableShare?: number;
  className?: string;
}

export function NcByPlatformCard({
  metrics,
  businessNcRoas,
  unclassifiableShare,
  className,
}: NcByPlatformCardProps) {
  // Share-bar denominator: Σ(ncOrders) across the SAME metrics[] — each
  // platform's portion of TOTAL new customers. (Not Σ spend / Σ revenue.)
  const totalNcOrders = metrics.reduce((acc, m) => acc + (Number.isFinite(m.ncOrders) ? m.ncOrders : 0), 0);

  const businessBand = ncRoasBand(businessNcRoas ?? null, 1);

  return (
    <Card
      data-testid="nc-by-platform-card"
      className={cn('p-6 gap-0', className)}
    >
      {/* Header: title + business NC-ROAS chip (AA-safe band chip, not raw band text) */}
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <h4 className="text-lg font-bold text-ink">לקוחות חדשים לפי פלטפורמה</h4>
        {unclassifiableShare != null && unclassifiableShare > 0 && (
          <span className="text-[11px] font-medium text-ink-muted tabular-nums">
            {Math.round(unclassifiableShare * 100)}% מההזמנות לא-מסווגות
          </span>
        )}
        <div className="flex-1" />
        <span
          data-testid="nc-by-platform-business-chip"
          className={cn('band-chip', chipClassForBand(businessBand))}
        >
          NC-ROAS עסקי ·{' '}
          <bdi dir="ltr" className="tabular-nums">
            {businessNcRoas == null || !Number.isFinite(businessNcRoas) ? '—' : `${businessNcRoas.toFixed(2)}×`}
          </bdi>
        </span>
      </div>

      {/* Per-platform inset cards — stacks to 1-col on mobile, 3-up from md. */}
      <div className="grid gap-4 md:grid-cols-3">
        {metrics.map((m) => {
          const band = ncRoasBand(m.ncRoas, m.spend);
          const sharePct = totalNcOrders > 0 ? (m.ncOrders / totalNcOrders) * 100 : 0;
          return (
            <div
              key={m.channel}
              data-testid={`nc-platform-${m.channel}`}
              className="rounded-2xl bg-pill-track p-4"
            >
              {/* dot + name + new count */}
              <div className="flex items-center gap-2">
                <span
                  className="inline-block h-2.5 w-2.5 rounded-sm"
                  style={{ background: CHART_COLORS[m.channel] }}
                  aria-hidden
                />
                <span className="text-sm font-bold text-ink">
                  <bdi dir="ltr">{CHANNEL_LABEL[m.channel]}</bdi>
                </span>
                <span className="me-auto text-[11px] font-bold text-ink-muted tabular-nums">
                  <bdi dir="ltr">{m.ncOrders}</bdi> חדשים
                </span>
              </div>

              {/* share-of-new-customers bar — fill = this platform's ncOrders portion */}
              <div
                className="mt-2.5 h-2 rounded-full bg-glass-2"
                role="img"
                aria-label={`נתח לקוחות חדשים ${Math.round(sharePct)}%`}
              >
                <div
                  data-testid={`nc-platform-share-${m.channel}`}
                  className="h-full rounded-full motion-safe:transition-[width] motion-safe:duration-slow"
                  style={{ width: `${sharePct}%`, background: CHART_COLORS[m.channel] }}
                />
              </div>

              {/* nCAC (money via <Money>) + NC-ROAS (band chip, AA-safe) */}
              <div className="mt-2.5 flex items-baseline gap-4">
                <div>
                  <div className="text-fs-2xs font-bold text-ink-muted">nCAC</div>
                  <div className="text-base font-bold text-ink tabular-nums">
                    {m.nCac == null ? '—' : <Money value={m.nCac} />}
                  </div>
                </div>
                <div>
                  <div className="text-fs-2xs font-bold text-ink-muted">NC-ROAS</div>
                  <span
                    data-testid={`nc-platform-roas-${m.channel}`}
                    className={cn('band-chip mt-0.5', chipClassForBand(band))}
                  >
                    <bdi dir="ltr" className="tabular-nums">
                      {m.ncRoas == null || !Number.isFinite(m.ncRoas) ? '—' : `${m.ncRoas.toFixed(2)}×`}
                    </bdi>
                  </span>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </Card>
  );
}
