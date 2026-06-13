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
 * Sections (Horizon re-skin — docs/superpowers/mockups/2026-06-12-horizon-reskin/
 * home-approved.html:520-619 "open store-detail modal"; NO info loss — every
 * section/datum from the prior surface is STAYS/MOVES, nothing removed):
 *   1. Vivid ROAS-band HEADER slab — the SAME band-card recipe PerStoreRow
 *      uses: the <Card> primitive with `band` + `bandStrength="strong"` + the
 *      `per-store-card` class, so the scoped globals.css rules paint the vivid
 *      band gradient + guaranteed-AA white-on-band `.store-name`/`.v.banded`
 *      text + dark-scrim `.band-tag`/`.store-delta-chip` chips. NO hand-rolled
 *      glass + NO `!important` colour hack (the band colour comes straight from
 *      the data-band recipe). Carries store name, band-tag pill, FreshnessBadge,
 *      close ✕, big climbing ROAS, "ROAS · {rangeLabel}" caption, band-ink spark.
 *   2. KPI INSET wells (הוצאה / הכנסה / רווח תפעולי / הזמנות / AOV) on the
 *      canonical recessed `bg-pill-track` surface + a ▲▼% delta vs the previous
 *      period (green=good, red=bad — note SPEND ↑ is BAD). MOBILE: a scroll-snap
 *      CAROUSEL (PerStoreRow pattern); md+: a 5-col grid.
 *   3. Per-store NC-ROAS / nCAC tile (its OWN "different question" band — kept
 *      per-store even though the hero carries a business-wide NC chip).
 *   4. ROAS-over-time trend — the store-scoped `RoasChart` in a `bg-pill-track`
 *      well. Plots ROAS, so the chart-line band rule applies (owned internally
 *      by RoasChart: line/area = band of the period-average, neutral plot scrim).
 *   5. Per-platform breakdown — spend + CPM + ROAS per Meta/Google/TikTok, in
 *      `bg-pill-track` insets; the ROAS reads as an AA-safe `chip-{band}` chip
 *      (band strictly via `bandForRoas`).
 *   6. Top campaigns — name + revenue/orders/spend + a solid colored ROAS chip;
 *      clicking a row passes its {storeId,platform,campaignId} to
 *      onOpenCampaigns to deep-link that campaign's drawer; the footer button
 *      calls onOpenCampaigns() (no arg) to drill to the Campaigns table.
 *   7. Footer — primary "פתח את כל הקמפיינים …" + secondary "סגור".
 *
 * NOTE: the mockup also sketches an "hourly-revenue" bar strip + a "top-products"
 * tile, but `StoreDetailData` carries NO hourly-distribution or per-product field
 * — those are illustrative future sections, not data this surface holds. We do
 * NOT fabricate them (project rule: no fake numbers). The mockup's "top-products"
 * maps to the real top-campaigns list, which is preserved.
 *
 * Token-driven only (designColorGuard): no raw hex/rgb/oklch/px colours in
 * this file — every colour is a theme token / Tailwind theme class, and the
 * white-on-band + dark-scrim recipes live in globals.css. All money renders
 * through <Money>; the type ramp uses `text-fs-*` (no sub-10.5px literal).
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
import { useStores } from '@/lib/useStores';
import { buildStoreBrandColorMap } from '@/lib/storeColors';
import { useDrawerEsc } from '@/lib/drawerStack';
import { useRoasBandGradient, BAND_TAG_LABEL } from '@/lib/format/useRoasBandGradient';
import { adDisplayState, adDisplayBand } from '@/lib/adState';
import { roasLabel } from '@/lib/analytics';
import { bandForRoas, type CoreRoasBand } from '@/lib/roasBands';
import { ROAS_TONE_BG, ROAS_BADGE_SHAPE } from '@/lib/format/roasCell';
import { cn, formatNumber } from '@/lib/utils';
import type { DailySeries } from '@/lib/analytics';
import type { DailyRow } from '@/lib/types';
import type { StoreDetailData } from '@/lib/home/storeDetail';

/* --------------------------------------------------------------------------
 * Per-platform ROAS chip band class. Strictly via `bandForRoas` (the single
 * source of truth in lib/roasBands.ts — NO local threshold fork) → the shared
 * AA-safe `chip-{band}` recipe (globals.css). A null ROAS (0-spend platform)
 * has no meaningful band → gray.
 * -------------------------------------------------------------------------- */
const CHIP_CLASS_FOR_BAND: Record<CoreRoasBand, string> = {
  red: 'chip-red',
  orange: 'chip-orange',
  green: 'chip-green',
  blue: 'chip-blue',
  gray: 'chip-gray',
};
function platformRoasChipClass(roas: number | null, spend: number): string {
  if (roas == null) return CHIP_CLASS_FOR_BAND.gray;
  return CHIP_CLASS_FOR_BAND[bandForRoas(roas, { spend })];
}

/* --------------------------------------------------------------------------
 * Band-tag wording: the SHARED canonical BAND_TAG_LABEL (P2-33, 2026-06-10
 * audit) — this file used to keep a private copy that could silently drift
 * from PerStoreRow / the RoasTargetChart KPI chip. One source of truth now
 * (lib/format/useRoasBandGradient, guarded by roasBandConsistency.guard).
 * -------------------------------------------------------------------------- */

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

  // Ads-off Phase 2 — off-display classifier. Mirrors PerStoreRow's logic so
  // the modal header band + ROAS hero matches the card it opened from.
  const offState = adDisplayState({
    revenue: data?.kpis.revenue ?? null,
    spend: data?.kpis.spend ?? null,
    off: data?.adOff ?? false,
  });
  const offBandId = adDisplayBand(offState); // null when 'normal'

  // Band for the header slab. Always call unconditionally (rules-of-hooks).
  // Off-band override wins when set; otherwise mirrors PerStoreRow's derivation:
  // the alarm-red "spent money, zero sales" flag wins over a null ROAS.
  const roasBand = useRoasBandGradient(
    data?.roas ?? null,
    false,
    data?.zeroSalesWithSpend ?? false,
  ).band;
  const band = offBandId ?? roasBand;

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

  // Self-serve stores Phase 6a — the embedded single-store ROAS line prefers
  // this store's operator-chosen brand_color. useStores() falls back to the
  // hardcoded 3 (backfilled brand_color === canonical token), so a known store's
  // line stays byte-identical; a self-serve store's line draws in its color.
  const { stores: storeList } = useStores();
  const brandColorByName = useMemo(
    () => buildStoreBrandColorMap(storeList),
    [storeList],
  );

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
            The SAME band-card recipe PerStoreRow uses — the <Card> primitive
            with `band` + `bandStrength="strong"` + the `per-store-card` class,
            so the scoped globals.css rules paint the vivid band gradient,
            guaranteed-AA white-on-band `.store-name` / `.v.banded` text, and
            the dark-scrim `.band-tag` / `.store-delta-chip` chips. Card owns
            the data-mounted entrance flip (no hand-pinned attribute) and the
            band ::before/tint. The Sheet's `overflow-hidden` + hero radius clip
            the slab's top corners, so the header is square + sticky + flush to
            the top edge (radius/padding overrides are LAYOUT only — never an
            !important color hack; the band colour comes straight from the
            data-band recipe). */}
        <Card
          band={band}
          bandStrength="strong"
          className="per-store-card sticky top-0 z-10 rounded-none [&]:rounded-none p-5 sm:p-6"
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
              <span className="band-tag">
                {offState === 'organic'
                  ? 'אורגני'
                  : offState !== 'normal'
                  ? 'כבוי'
                  : BAND_TAG_LABEL[band]}
              </span>
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
                {offState === 'organic'
                  ? 'אורגני'
                  : offState !== 'normal'
                  ? '0'
                  : data.zeroSalesWithSpend
                  ? '0.00x'
                  : <CountUp value={data.roas} format={(n) => `${n.toFixed(2)}x`} />}
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
        </Card>

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
                  // KPI inset well — canonical recessed `bg-pill-track` surface
                  // (mockup `bg-lightPrimary dark:bg-navy-900`), NOT a glass Card.
                  // Text sits on the neutral inset so `text-ink` / `text-ink-muted`
                  // stay AA in both themes.
                  <div
                    key={k.testId}
                    data-testid={k.testId}
                    className="snap-center shrink-0 basis-[46%] sm:basis-[31%] md:basis-auto rounded-hz bg-pill-track p-3"
                  >
                    <span className="block text-fs-2xs uppercase tracking-[0.05em] text-ink-muted">
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
                  </div>
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
              {/* Trend plots ROAS over time → the chart-line band rule applies.
                  RoasChart OWNS that rule internally (line/area = band of the
                  period-average via the locked palette + a neutral plot scrim /
                  casing so the ink stays legible on any surface, both themes);
                  `bare` drops its own card chrome since we wrap it in a neutral
                  recessed `bg-pill-track` well (mockup `bg-lightPrimary
                  dark:bg-navy-900`). */}
              <div className="rounded-hz bg-pill-track">
                <RoasChart data={chartSeries} stores={[data.storeName]} rows={chartRows} brandColorByName={brandColorByName} bare />
              </div>
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
                  // Per-platform inset well — `bg-pill-track` recessed surface.
                  // Platform identity (dot + label) via <PlatformBadge>, which
                  // sources `var(--chart-platform-*)` (designColorGuard-clean).
                  <div
                    key={p.platform}
                    data-testid={`platform-${p.platform}`}
                    className="rounded-hz bg-pill-track p-3"
                  >
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
                        {/* AA-safe banded chip — band strictly via bandForRoas
                            → the shared `chip-{band}` recipe. */}
                        <dd>
                          <span
                            className={cn(
                              'band-chip text-fs-2xs tabular-nums',
                              platformRoasChipClass(p.roas, p.spend),
                            )}
                          >
                            <bdi dir="ltr">{p.roas == null ? '—' : `${p.roas.toFixed(2)}x`}</bdi>
                          </span>
                        </dd>
                      </div>
                    </dl>
                  </div>
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
                        <div className="text-fs-2xs text-ink-muted tabular-nums whitespace-nowrap">
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
