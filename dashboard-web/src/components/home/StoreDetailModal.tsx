'use client';

/**
 * <StoreDetailModal> — per-store drill-down MODAL for the Home page.
 *
 * Clicking a store card on Home opens THIS centered modal (full-screen on
 * mobile) instead of jumping straight to the Campaigns tab. It reuses the
 * SAME Sheet `variant="modal"` shell as the campaign drawer (centered card,
 * zoom-in entrance, full-screen sheet on max-sm) + the shared `useDrawerEsc`
 * stack so Esc addresses only the topmost drawer. NO network fetch — every
 * value arrives pre-computed in `data` (built by `toStoreDetail` from state
 * the HomeTab already holds).
 *
 * Sections (verbatim from docs/.../2026-06-01-store-modal/store-modal-mockup.html):
 *   1. Vivid ROAS-band HEADER slab — white-on-band (reuses the `.per-store-card`
 *      `.glass[data-band]` treatment proven AA in both themes), store name,
 *      band-tag pill, FreshnessBadge, close ✕, big climbing ROAS, "ROAS ·
 *      {rangeLabel}" caption, white band-ink sparkline.
 *   2. KPI cards (הוצאה / הכנסה / רווח תפעולי / הזמנות / AOV) + a ▲▼% delta vs
 *      the previous period (green=good, red=bad — note SPEND ↑ is BAD). MOBILE:
 *      a scroll-snap CAROUSEL (same pattern as PerStoreRow); md+: a 5-col grid.
 *   3. ROAS-over-time chart — the store-scoped `RoasChart` (target line kept).
 *   4. Per-platform breakdown — spend + CPM + ROAS per Meta/Google/TikTok.
 *   5. Top campaigns — name + spend + a solid colored ROAS chip; clicking a row
 *      passes its {storeId,platform,campaignId} to onOpenCampaigns to deep-link
 *      that campaign's drawer; the footer button calls onOpenCampaigns() (no
 *      arg) to drill to the Campaigns table filtered to the store.
 *   6. Footer — primary "פתח את כל הקמפיינים …" + ghost "סגור".
 *
 * Token-driven only (designColorGuard): no raw hex/rgb/oklch/px colours in
 * this file — every colour is a theme token / Tailwind theme class, and the
 * white-on-band + dark-scrim recipes live in globals.css. All money renders
 * through <Money>.
 */

import { useMemo } from 'react';
import { ArrowLeft, X } from 'lucide-react';
import { Sheet, SheetContent, SheetBody, SheetFooter } from '@/components/ui/Sheet';
import { Card } from '@/components/ui/Card';
import { HelpTooltip } from '@/components/ui/Tooltip';
import { Badge } from '@/components/ui/Badge';
import { ChannelTruthPanel } from '@/components/home/ChannelTruthPanel';
import { Money } from '@/components/ui/Money';
import { CountUp } from '@/components/ui/CountUp';
import { Sparkline } from '@/components/ui/Sparkline';
import { Button } from '@/components/ui/Button';
import { Heading } from '@/components/ui/Typography';
import { FreshnessBadge } from '@/components/ui/FreshnessBadge';
import { PlatformBadge } from '@/components/ui/PlatformBadge';
import { RoasChart } from '@/components/RoasChart';
import { useDrawerEsc } from '@/lib/drawerStack';
import { useRoasBandGradient, type RoasBand } from '@/lib/format/useRoasBandGradient';
import { roasLabel } from '@/lib/analytics';
import { ROAS_TONE_BG, ROAS_BADGE_SHAPE } from '@/lib/format/roasCell';
import { cn, formatNumber } from '@/lib/utils';
import type { DailySeries } from '@/lib/analytics';
import type { DailyRow } from '@/lib/types';
import type { StoreDetailData } from '@/lib/home/storeDetail';

/* --------------------------------------------------------------------------
 * Band-tag label per band id — mirrors PerStoreRow's canonical wording so
 * the modal header pill reads identically to the per-store card it opened from.
 * -------------------------------------------------------------------------- */
const BAND_TAG_LABEL: Record<RoasBand, string> = {
  red:         'דורש בחינה',
  'red-alarm': '0 מכירות',
  orange:      'סביר',
  green:       'טוב',
  blue:        'מעולה',
  gray:        'אין נתונים',
};

export interface StoreDetailModalProps {
  data: StoreDetailData | null;
  open: boolean;
  onClose: () => void;
  rangeLabel: string;
  /**
   * Drill into the Campaigns tab. Called with no argument from the footer
   * "show all campaigns" button (table filtered to this store), or with a
   * `{ storeId, platform, campaignId }` identity from a top-campaign row to
   * open that exact campaign's drawer. The host wires this to
   * `drillToCampaigns`.
   */
  onOpenCampaigns: (campaign?: {
    storeId: string;
    platform: 'meta' | 'google' | 'tiktok';
    campaignId: string;
  }) => void;
}

/* --------------------------------------------------------------------------
 * KPI card descriptor — one per metric, with a "higher is better" polarity so
 * the delta chip can pick green/red correctly (SPEND ↑ is BAD).
 * -------------------------------------------------------------------------- */
interface KpiSpec {
  testId: string;
  label: string;
  value: number | null;
  deltaPct: number | null;
  /** When the metric rises, is that GOOD? Spend → false; everything else → true. */
  higherIsBetter: boolean;
  /** AOV uses a high compact floor so it stays full-precision; others compact ≥1k. */
  compactAbove: number;
  /** Orders is a COUNT (no `$`) — render as a plain number, not <Money>. */
  isCount?: boolean;
}

/** "▲ +14%" / "▼ −8%". Empty string → chip hidden (delta null). U+2212 minus. */
function fmtDeltaChip(pct: number | null): string {
  if (pct == null || Number.isNaN(pct)) return '';
  const arrow = pct >= 0 ? '▲' : '▼';
  const sign = pct >= 0 ? '+' : '−';
  return `${arrow} ${sign}${Math.abs(pct * 100).toFixed(0)}%`;
}

/** Delta direction × polarity → status-foreground token class. */
function deltaToneClass(pct: number | null, higherIsBetter: boolean): string {
  if (pct == null || pct === 0) return 'text-ink-muted';
  const good = pct > 0 ? higherIsBetter : !higherIsBetter;
  return good ? 'text-status-greenFg' : 'text-status-redFg';
}

export function StoreDetailModal({
  data,
  open,
  onClose,
  rangeLabel,
  onOpenCampaigns,
}: StoreDetailModalProps) {
  // Esc closes the modal (topmost-drawer aware). Registered while `open`.
  useDrawerEsc(open && data != null, onClose);

  // Band for the header slab. Mirrors PerStoreRow's derivation: the alarm-red
  // "spent money, zero sales" flag wins over a null ROAS.
  const band = useRoasBandGradient(
    data?.roas ?? null,
    false,
    data?.zeroSalesWithSpend ?? false,
  ).band;

  // Phase 3 — band for the per-store NC-ROAS tile (its OWN "different question"
  // band; never the header ROAS gradient). Hoisted above the early return so
  // the hook is called unconditionally on every render (rules-of-hooks).
  const ncBand = useRoasBandGradient(data?.newCustomer?.ncRoas ?? null).band;

  // Store-scoped DailySeries for the embedded RoasChart. We rebuild the minimal
  // shape RoasChart needs (`byStore[storeName]` per day) from `data.roasSeries`
  // — RoasChart reads ONLY byStore[store] + date, so the totals can stay 0.
  const chartSeries = useMemo<DailySeries[]>(() => {
    if (!data) return [];
    return data.roasSeries.map((p) => ({
      date: p.date,
      byStore: { [data.storeName]: p.roas },
      totalRoas: 0,
      totalRevenue: 0,
      totalSpend: 0,
    }));
  }, [data]);

  // White band-ink sparkline values — only the finite (non-gap) days.
  const sparkValues = useMemo<number[]>(() => {
    if (!data) return [];
    return data.roasSeries
      .map((p) => p.roas)
      .filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
  }, [data]);

  if (!data) return null;

  // A line chart needs ≥2 calendar days to draw anything meaningful. On a
  // single-day range (e.g. "today"/"yesterday") `roasSeries` has one entry, so
  // the chart renders an empty plot that just wastes space and confuses — hide
  // the whole section in that case (mirrors the header sparkline's ≥2 guard).
  const showRoasChart = data.roasSeries.length >= 2;

  const chartRows: DailyRow[] = []; // no refund-day highlighting needed here

  const kpis: KpiSpec[] = [
    { testId: 'kpi-spend',   label: 'הוצאה',       value: data.kpis.spend,           deltaPct: data.deltas.spendPct,           higherIsBetter: false, compactAbove: 1_000 },
    { testId: 'kpi-revenue', label: 'הכנסה',       value: data.kpis.revenue,         deltaPct: data.deltas.revenuePct,         higherIsBetter: true,  compactAbove: 1_000 },
    { testId: 'kpi-op',      label: 'רווח תפעולי', value: data.kpis.operatingProfit, deltaPct: data.deltas.operatingProfitPct, higherIsBetter: true,  compactAbove: 1_000 },
    { testId: 'kpi-orders',  label: 'הזמנות',      value: data.kpis.orders,          deltaPct: data.deltas.ordersPct,          higherIsBetter: true,  compactAbove: 100_000, isCount: true },
    { testId: 'kpi-aov',     label: 'AOV',         value: data.kpis.aov,             deltaPct: data.deltas.aovPct,             higherIsBetter: true,  compactAbove: 100_000 },
  ];

  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()}>
      <SheetContent
        variant="modal"
        dir="rtl"
        hideDefaultClose
        onEscapeKeyDown={(e) => e.preventDefault()}
        aria-labelledby="store-detail-title"
        data-testid="store-detail-modal"
        className="p-0 sm:w-[min(840px,92vw)]"
      >
        {/* ── 1. Vivid ROAS-band HEADER slab ───────────────────────────────
            Reuses the `.per-store-card .glass[data-band]` treatment: vivid
            band gradient + guaranteed-AA white-on-band text + dark-scrim chips.
            data-mounted is pinned true so the slab paints immediately (the
            Sheet's own zoom-in handles the entrance). */}
        <header
          className="glass per-store-card sticky top-0 z-10 !rounded-none !p-5 sm:!p-6"
          data-band={band}
          data-band-strength="strong"
          data-mounted="true"
          data-testid="store-detail-hero"
        >
          <div className="store-top flex items-start justify-between gap-3">
            {/* Mockup `.mh-name` is just the store name (no icon) — keeping it
                icon-free also avoids a dark-ink Lucide glyph on the vivid band.
                `.store-name` is painted white by globals.css on the band slab. */}
            <Heading
              as="h2"
              level="hero"
              id="store-detail-title"
              className="store-name truncate text-xl md:text-2xl font-extrabold min-w-0"
            >
              <bdi dir="ltr">{data.storeName}</bdi>
            </Heading>
            <div className="flex items-center gap-2 shrink-0">
              <FreshnessBadge updatedAt={data.updatedAt} />
              <span className="band-tag">{BAND_TAG_LABEL[band]}</span>
              {/* Close ✕ — Button primitive carrying the band's dark-scrim
                  white recipe (`.store-delta-chip`) so it stays AA-legible on
                  the vivid band in both themes. */}
              <Button
                variant="ghost"
                size="icon"
                onClick={onClose}
                aria-label="סגור"
                data-testid="store-detail-x"
                className="store-delta-chip !w-[30px] !h-[30px] !p-0 !rounded-lg"
              >
                <X size={16} />
              </Button>
            </div>
          </div>

          {/* ROAS hero row — big climbing number + caption + white spark. */}
          <div className="mt-3 flex items-end gap-4">
            <div className="min-w-0">
              <bdi
                dir="ltr"
                className="v banded block text-[44px] md:text-[54px] font-light tabular-nums tracking-tight leading-none whitespace-nowrap"
              >
                {data.zeroSalesWithSpend ? (
                  '0.00x'
                ) : (
                  <CountUp value={data.roas} format={(n) => `${n.toFixed(2)}x`} />
                )}
              </bdi>
              <span className="roas-cap mt-1 block font-mono text-[11px] uppercase tracking-[0.08em]">
                ROAS · {rangeLabel}
              </span>
            </div>
            {sparkValues.length >= 2 && (
              <Sparkline
                data={sparkValues}
                bandInk
                width={200}
                height={38}
                className="flex-1 self-end"
              />
            )}
          </div>
        </header>

        <SheetBody className="space-y-5">
          {/* ── 2. KPI cards + delta vs prev ─────────────────────────────
              MOBILE: a horizontal scroll-snap carousel (PerStoreRow pattern);
              md+: a 5-column grid. */}
          <section>
            <h3 className="text-xs font-bold uppercase tracking-[0.06em] text-ink-muted mb-2.5">
              מדדי החנות · מול התקופה הקודמת
            </h3>
            <div
              className={cn(
                'flex gap-2.5 overflow-x-auto snap-x snap-mandatory scrollbar-hide pb-1',
                'md:grid md:grid-cols-5 md:gap-2.5 md:overflow-visible',
              )}
            >
              {kpis.map((k) => {
                const chip = fmtDeltaChip(k.deltaPct);
                return (
                  <Card
                    key={k.testId}
                    data-testid={k.testId}
                    className="snap-center shrink-0 basis-[46%] sm:basis-[31%] md:basis-auto !p-3"
                  >
                    <span className="block text-[10px] uppercase tracking-[0.05em] text-ink-muted">
                      {k.label}
                    </span>
                    <div className="mt-1 text-lg font-extrabold text-ink tabular-nums">
                      {k.isCount ? (
                        <bdi dir="ltr">{k.value == null ? '—' : Math.round(k.value)}</bdi>
                      ) : (
                        <Money value={k.value} compactAbove={k.compactAbove} />
                      )}
                    </div>
                    {chip && (
                      <div
                        className={cn(
                          'mt-1 text-[10.5px] font-bold tabular-nums',
                          deltaToneClass(k.deltaPct, k.higherIsBetter),
                        )}
                        dir="ltr"
                      >
                        {chip}
                      </div>
                    )}
                  </Card>
                );
              })}
            </div>
          </section>

          {/* Phase 3 — per-store NC-ROAS / nCAC (different question). Own band;
              never touches the header ROAS band gradient. */}
          <section data-testid="store-detail-nc">
            <HelpTooltip
              content="לקוחות חדשים (הזמנה ראשונה אי-פעם). NC-ROAS = הכנסת לקוחות חדשים ÷ הוצאת פרסום; nCAC = הוצאת פרסום ÷ הזמנות חדשות."
              withinDrawer
            >
            <Card
              band={ncBand}
              bandStrength="muted"
              className="!p-3 sm:!p-4"
            >
              <div className="flex items-center justify-between gap-2">
                <div className="text-[10.5px] uppercase tracking-[0.08em] text-ink-muted font-semibold">
                  לקוחות חדשים · שאלה אחרת
                </div>
                {/* Wave 1 — low-confidence gate badge. Token-driven warning tone
                    → guaranteed AA in both themes. */}
                {data.newCustomer.confidence === 'low' && (
                  <Badge tone="warning" data-testid="store-detail-nc-confidence">
                    ביטחון נמוך
                  </Badge>
                )}
              </div>
              {data.newCustomer.confidence === 'suppressed' ? (
                /* Suppressed — hide NC-ROAS / nCAC; keep the share line below. */
                <div className="text-sm mt-2 text-ink-muted" data-testid="store-detail-nc-suppressed">
                  <bdi dir="rtl">לא מספיק דאטה לסיווג</bdi>
                </div>
              ) : (
                <div className="flex items-end gap-6 mt-2">
                  <div>
                    <div className="text-[10.5px] uppercase tracking-[0.08em] text-ink-muted font-semibold">
                      {/* "נטו (מתואם refunds)" — NC-ROAS revenue is re-based onto
                          the net (refund-adjusted) basis so it reconciles with
                          the headline net MER (Wave 1). */}
                      NC-ROAS · נטו (אחרי החזרים)
                    </div>
                    <bdi dir="ltr" className="block text-end font-extrabold tabular-nums leading-[1.05] text-[1.5rem]">
                      {data.newCustomer.ncRoas != null ? (
                        <CountUp value={data.newCustomer.ncRoas} format={(n) => n.toFixed(2)} />
                      ) : (
                        '—'
                      )}
                    </bdi>
                  </div>
                  <div>
                    <div className="text-[10.5px] uppercase tracking-[0.08em] text-ink-muted font-semibold">
                      nCAC
                    </div>
                    <bdi dir="ltr" className="block text-end font-extrabold tabular-nums leading-[1.05] text-[1.5rem]">
                      <Money value={data.newCustomer.nCac} prefix="$" compactAbove={1_000_000} />
                    </bdi>
                  </div>
                </div>
              )}
              <div className="text-xs mt-1.5 text-ink-muted tabular-nums">
                <bdi dir="rtl">
                  {data.newCustomer.ncOrders.toLocaleString('en-US')} חדשות ·{' '}
                  {data.newCustomer.returningOrders.toLocaleString('en-US')} חוזרות ·{' '}
                  {(data.newCustomer.unclassifiableShare * 100).toFixed(0)}% לא מסווג
                </bdi>
              </div>
              {/* channel-nc-roas-split (Wave 2) — per-store per-channel breakdown. */}
              {data.channelTruth && data.newCustomer.confidence !== 'suppressed' && (
                <div className="mt-3.5 border-t border-glass-edge pt-3.5">
                  <div className="mb-2 text-[10.5px] uppercase tracking-[0.08em] text-ink-muted font-semibold">
                    NC-ROAS לפי ערוץ
                  </div>
                  <ChannelTruthPanel
                    metrics={data.channelTruth.metrics}
                    blendedNcRoas={data.channelTruth.blendedNcRoas}
                    blendedNcac={data.channelTruth.blendedNcac}
                    unclassifiableShare={data.channelTruth.unclassifiableShare}
                  />
                </div>
              )}
            </Card>
            </HelpTooltip>
          </section>

          {/* ── 3. ROAS over time ────────────────────────────────────────
              Store-scoped RoasChart. Target line + neutral plot scrim are
              owned by the chart; bare=true drops its own card chrome since we
              wrap it in a neutral Card here. Hidden on a single-day range
              (`showRoasChart`) where a one-point line would be empty. */}
          {showRoasChart && (
            <section data-testid="store-detail-chart">
              <h3 className="text-xs font-bold uppercase tracking-[0.06em] text-ink-muted mb-2.5">
                ROAS לאורך זמן
              </h3>
              <Card className="!p-3 sm:!p-4">
                <RoasChart data={chartSeries} stores={[data.storeName]} rows={chartRows} bare />
              </Card>
            </section>
          )}

          {/* ── 4. Per-platform breakdown ────────────────────────────────*/}
          {data.platforms.length > 0 && (
            <section>
              <h3 className="text-xs font-bold uppercase tracking-[0.06em] text-ink-muted mb-2.5">
                פירוט לפי פלטפורמה
              </h3>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                {data.platforms.map((p) => (
                  <Card key={p.platform} data-testid={`platform-${p.platform}`} className="!p-3">
                    <PlatformBadge platform={p.platform} size="md" />
                    <dl className="mt-2 space-y-1.5 text-[11px]">
                      <div className="flex items-center justify-between gap-2">
                        <dt className="text-ink-secondary">הוצאה</dt>
                        <dd className="text-ink font-semibold">
                          <Money value={p.spend} compactAbove={10_000} />
                        </dd>
                      </div>
                      <div className="flex items-center justify-between gap-2">
                        <dt className="text-ink-secondary">CPM</dt>
                        <dd className="text-ink font-semibold">
                          {p.cpm == null ? '—' : <Money value={p.cpm} compactAbove={100_000} />}
                        </dd>
                      </div>
                      <div className="flex items-center justify-between gap-2">
                        <dt className="text-ink-secondary">ROAS</dt>
                        <dd className="text-ink font-semibold tabular-nums">
                          <bdi dir="ltr">{p.roas == null ? '—' : `${p.roas.toFixed(2)}x`}</bdi>
                        </dd>
                      </div>
                    </dl>
                  </Card>
                ))}
              </div>
            </section>
          )}

          {/* ── 5. Top campaigns ─────────────────────────────────────────*/}
          {data.topCampaigns.length > 0 && (
            <section>
              <h3 className="text-xs font-bold uppercase tracking-[0.06em] text-ink-muted mb-2.5">
                קמפיינים מובילים
              </h3>
              <Card className="!p-0 overflow-hidden divide-y divide-glass-edge">
                {data.topCampaigns.map((c, i) => {
                  const tone = c.roas == null ? 'gray' : roasLabel(c.roas).tone;
                  return (
                    <Button
                      key={`${c.platform}-${c.campaignId}-${i}`}
                      variant="ghost"
                      onClick={() =>
                        onOpenCampaigns({
                          storeId: c.storeId,
                          platform: c.platform,
                          campaignId: c.campaignId,
                        })
                      }
                      className="w-full !justify-start gap-2.5 px-3 py-2.5 !h-auto !rounded-none text-start"
                    >
                      <PlatformBadge platform={c.platform} size="sm" showLabel={false} />
                      <bdi dir="ltr" className="flex-1 min-w-0 truncate text-[12.5px] font-semibold text-ink">
                        {c.name}
                      </bdi>
                      {/* Impact metrics — revenue is the rank metric (bold),
                          with orders + spend on a muted second line. */}
                      <div className="text-end shrink-0 leading-tight">
                        <div className="text-[12px] font-semibold text-ink tabular-nums">
                          <Money value={c.revenue} compactAbove={100_000} />
                        </div>
                        <div className="text-[10px] text-ink-muted tabular-nums whitespace-nowrap">
                          {formatNumber(c.orders, 0)} הזמ׳ · <Money value={c.spend} compactAbove={10_000} /> הוצ׳
                        </div>
                      </div>
                      <span className={cn(ROAS_BADGE_SHAPE, '!min-w-[3rem] text-[12px]', ROAS_TONE_BG[tone])}>
                        <bdi dir="ltr">{c.roas == null ? '—' : `${c.roas.toFixed(2)}x`}</bdi>
                      </span>
                    </Button>
                  );
                })}
              </Card>
            </section>
          )}
        </SheetBody>

        {/* ── 6. Footer ─────────────────────────────────────────────────*/}
        <SheetFooter className="gap-2.5">
          <Button
            variant="primary"
            size="lg"
            className="flex-1"
            data-testid="store-detail-open-campaigns"
            onClick={() => onOpenCampaigns()}
          >
            <span className="truncate">
              פתח את כל הקמפיינים של <bdi dir="ltr">{data.storeName}</bdi>
            </span>
            <ArrowLeft size={16} className="shrink-0" />
          </Button>
          <Button
            variant="secondary"
            size="lg"
            data-testid="store-detail-close"
            onClick={onClose}
          >
            סגור
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
