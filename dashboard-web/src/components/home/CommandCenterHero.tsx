'use client';

/**
 * Task 3.1 — <CommandCenterHero> primitive.
 *
 * 2-row × 3-column glass-card grid that REPLACES the prior
 * HeroOverview + HomeLiveBand + HomeSummaryBand + KpiCards stack at the
 * top of the Home tab. Visual ref: mockup-04-final.html lines 313-338.
 *
 *   Row 1 — Net Profit (featured + banded) · Spend · Revenue
 *   Row 2 — ROAS (banded)                  · Orders · CPM
 *
 *   • Net Profit card carries `<Card band={...}>` with the band picked by
 *     `useRoasBandGradient(roas)` — i.e. the SAME band as the ROAS tile so
 *     the two hero numbers visually agree.
 *   • Featured Net Profit number wears `.v.banded` so its colour follows
 *     the data-band attribute on the card. Secondary cards (Spend /
 *     Revenue / Orders / CPM) wear `.v.neutral` which renders the soft
 *     white→cool-gray text-gradient defined in globals.css.
 *   • ROAS tile (row 2) also banded + `.v.banded` (matches mockup).
 *   • Each card surfaces a <FreshnessBadge> chip wired to the same
 *     `updatedAt` that drives the Card's `data-freshness` desaturation,
 *     per [[home-visual-rules]] (Task 3.6).
 *   • Net Profit card renders a SVG sparkline (28-day shape) so the
 *     featured tile carries the editorial "shape of the period" without
 *     the heavy Recharts dependency the old HeroOverview pulled in.
 *
 * Numerics:
 *   • `prevPeriod` is optional. When present, each card emits a delta-vs-
 *     previous line ("▴ +$612 (+15%) מול אתמול"). The DOM order matches
 *     the mockup's RTL phrasing; the unicode arrows + numerals are wrapped
 *     in <bdi dir="ltr"> so Hebrew narrative + LTR numbers don't bidi-flip.
 *   • Spend's delta-positive (spend went UP) is rendered as a NEGATIVE
 *     signal (red ▾) — `inverse` prop on <DeltaText/>. All other tiles
 *     treat ↑ as positive.
 *
 * NO INFO LOSS PROMISE (mapping table per spec):
 *   • ROAS / Net / Revenue / Spend / CPM / Orders — all surfaced here.
 *   • Gross Profit moves to <RoasTargetChart> KPI strip (lives under Net's
 *     tooltip).
 *   • COGS, transaction fees, fixed costs — P&L tab.
 *
 * Presentational — parent (Dashboard HomeTab) reads /api/data via SWR and
 * passes the already-aggregated values + the day-period rows for the
 * sparkline. No SWR calls inside this primitive.
 */

import { useMemo } from 'react';
import { cn } from '@/lib/utils';
import { Card } from '@/components/ui/Card';
import { FreshnessBadge } from '@/components/ui/FreshnessBadge';
import {
  useRoasBandGradient,
  type RoasBand,
} from '@/lib/format/useRoasBandGradient';
import { useStaleness, type StalenessInput } from '@/lib/freshness/useStaleness';

/* --------------------------------------------------------------------------
 * Props — data shape locked by Task 3.1 spec.
 * -------------------------------------------------------------------------- */

export interface CommandCenterPeriod {
  /** ROAS for the active range (revenue / spend). 0 == no spend yet. */
  roas: number | null;
  /** Net profit in CAD (revenue − spend − COGS − fees − fixed costs).
   *  Falls back to the legacy revenue−spend−cogs when fees/fixed not loaded. */
  netProfit: number | null;
  /** Revenue in CAD for the active range. */
  revenue: number | null;
  /** Total ad spend in CAD for the active range. */
  spend: number | null;
  /** Blended CPM in CAD across the active range. 0 == no impressions yet. */
  cpm: number | null;
  /** Total orders count for the active range. */
  orders: number | null;
}

export interface CommandCenterDelta {
  /** ROAS delta as POINTS (curRoas − prevRoas). Signed. */
  roas: number | null;
  /** Net profit delta in CAD (curNet − prevNet). Signed. */
  netProfit: number | null;
  /** Revenue delta as fraction ((cur − prev) / prev). Signed. */
  revenuePct: number | null;
  /** Spend delta as fraction. ↑ spend is a NEGATIVE signal (inverse). */
  spendPct: number | null;
  /** CPM delta as fraction. ↑ CPM is a NEGATIVE signal (inverse). */
  cpmPct: number | null;
  /** Orders delta as absolute count. */
  orders: number | null;
}

/**
 * Secondary-card sparkline series (one entry per calendar day in the active
 * range, ISO-date order). Each metric is optional — when a metric's array
 * is missing or has <2 finite values, that card renders without a
 * sparkline. This keeps the row visually stable while data is still loading
 * but lets every card carry the "shape of the period" once it lands —
 * matching the operator's request that the cards stop looking empty.
 */
export interface CommandCenterSecondarySparklines {
  spend?: number[];
  revenue?: number[];
  roas?: number[];
  orders?: number[];
  cpm?: number[];
}

export interface CommandCenterHeroProps {
  current: CommandCenterPeriod;
  /** Optional previous-period numbers; when omitted, delta lines hide. */
  delta?: CommandCenterDelta;
  /** Range label used in the Net-Profit eyebrow ("היום" / "30 ימים"). */
  rangeLabel: string;
  /**
   * Daily Net Profit values across the active range, in ISO date order.
   * Drives the row-1 featured-card sparkline. Pass [] to suppress.
   */
  netSparkValues?: number[];
  /**
   * Per-metric daily series for the 5 secondary hero cards. Each metric is
   * rendered with a tone-appropriate stroke (Spend = down-red, Revenue =
   * up-green, ROAS = accent violet, Orders = neutral ink, CPM = info-blue)
   * so a glance at the strip shows direction at the same time as magnitude.
   */
  secondarySparklines?: CommandCenterSecondarySparklines;
  /**
   * Freshness signal — drives every card's <FreshnessBadge> AND the
   * Card's `data-freshness` desaturation. Accepts the same shape as
   * `useStaleness`: a single ISO timestamp or a per-platform record.
   */
  updatedAt?: StalenessInput;
  className?: string;
}

/* --------------------------------------------------------------------------
 * Helpers
 * -------------------------------------------------------------------------- */

function fmtMoneyCompact(n: number | null | undefined): string {
  if (n == null || Number.isNaN(n)) return '—';
  const sign = n < 0 ? '−' : '';
  const abs = Math.abs(n);
  // Mockup uses "$4,847" / "$10,998" — locale-independent USD-style with
  // thousand separators. Money on the dashboard is CAD, but the display
  // format matches the mockup verbatim per the visual spec.
  return `${sign}$${Math.round(abs).toLocaleString('en-US')}`;
}

function fmtMoneyDecimal(n: number | null | undefined, decimals = 2): string {
  if (n == null || Number.isNaN(n)) return '—';
  const sign = n < 0 ? '−' : '';
  const abs = Math.abs(n);
  return `${sign}$${abs.toFixed(decimals)}`;
}

function fmtCount(n: number | null | undefined): string {
  if (n == null || Number.isNaN(n)) return '—';
  return Math.round(n).toLocaleString('en-US');
}

function fmtRoas(n: number | null | undefined): string {
  if (n == null || Number.isNaN(n)) return '—';
  return n.toFixed(2);
}

function fmtPctDelta(pct: number | null | undefined): string {
  if (pct == null || Number.isNaN(pct)) return '';
  const arrow = pct >= 0 ? '▴' : '▾';
  const sign = pct >= 0 ? '+' : '−';
  return `${arrow} ${sign}${Math.abs(pct * 100).toFixed(0)}%`;
}

function fmtRoasDelta(points: number | null | undefined): string {
  if (points == null || Number.isNaN(points)) return '';
  const arrow = points >= 0 ? '▴' : '▾';
  const sign = points >= 0 ? '+' : '−';
  return `${arrow} ${sign}${Math.abs(points).toFixed(2)}`;
}

function fmtCountDelta(n: number | null | undefined): string {
  if (n == null || Number.isNaN(n)) return '';
  const arrow = n >= 0 ? '▴' : '▾';
  const sign = n >= 0 ? '+' : '−';
  return `${arrow} ${sign}${fmtCount(Math.abs(n))}`;
}

function fmtMoneyDelta(n: number | null | undefined): string {
  if (n == null || Number.isNaN(n)) return '';
  const arrow = n >= 0 ? '▴' : '▾';
  const sign = n >= 0 ? '+' : '−';
  return `${arrow} ${sign}${fmtMoneyCompact(Math.abs(n))}`;
}

/* --------------------------------------------------------------------------
 * Sparkline — featured Net Profit card.
 *
 * Hand-rolled SVG (no Recharts) so the hero card stays light. Path is the
 * point-to-point polyline; area fills below the line via a vertical-gradient
 * stop that's already band-coloured by the surrounding card's data-band.
 * -------------------------------------------------------------------------- */

function NetSparkline({
  values,
  bandColorVar,
}: {
  values: number[];
  bandColorVar: string;
}) {
  // Hooks first — never conditional. useId would be the React-idiomatic
  // route but createUseId pulls a React 18+ side-effect we don't need here;
  // useMemo with a stable Math.random key locks the id per-mount so each
  // CommandCenterHero render gets a fresh gradient stop without colliding
  // with a sibling instance.
  const gid = useMemo(
    () => `net-spark-${Math.random().toString(36).slice(2, 8)}`,
    [],
  );
  // Need ≥2 points to draw a line. <2 → render nothing so the card height
  // stays consistent visually even when no series is yet wired. We compute
  // path eagerly into nullables so the early return can sit AFTER hooks
  // without re-introducing the rules-of-hooks bug.
  if (!values || values.length < 2) return null;

  // Geometry: 600 × 38 viewBox (matches mockup). Pen sweeps left→right.
  const W = 600;
  const H = 38;
  const PAD_Y = 4;
  // Defensive: filter out non-finite values that would NaN the path.
  const clean = values.filter((v) => Number.isFinite(v));
  if (clean.length < 2) return null;
  const lo = Math.min(...clean);
  const hi = Math.max(...clean);
  const range = hi - lo || 1;
  const stepX = W / (clean.length - 1);
  // y inversion: low value → bottom; high → top.
  const yFor = (v: number) =>
    H - PAD_Y - ((v - lo) / range) * (H - PAD_Y * 2);

  const linePath = clean
    .map((v, i) => {
      const x = i * stepX;
      const y = yFor(v);
      return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
  const areaPath = `${linePath} L${W},${H} L0,${H} Z`;

  return (
    <svg
      className="block w-full h-[38px] mt-3.5"
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
      aria-hidden
    >
      <defs>
        <linearGradient id={gid} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor={bandColorVar} stopOpacity={0.55} />
          <stop offset="100%" stopColor={bandColorVar} stopOpacity={0} />
        </linearGradient>
      </defs>
      <path
        d={linePath}
        fill="none"
        stroke={bandColorVar}
        strokeWidth={2}
      />
      <path d={areaPath} fill={`url(#${gid})`} />
    </svg>
  );
}

/* --------------------------------------------------------------------------
 * Per-band stroke colour map — pulled out so NetSparkline picks the same
 * CSS-var hue the Card's `data-band` rim uses. Keeps the spark + the
 * surrounding tint in lock-step.
 * -------------------------------------------------------------------------- */

const BAND_STROKE: Record<RoasBand, string> = {
  red:    'oklch(64% 0.22 22)',
  orange: 'oklch(78% 0.16 75)',
  green:  'oklch(70% 0.18 145)',
  blue:   'oklch(68% 0.16 240)',
  gray:   'oklch(60% 0.012 250)',
};

/* --------------------------------------------------------------------------
 * MiniSparkline — slim 30 px stroke+fill spark for the secondary cards.
 *
 * Same geometry as <NetSparkline> but smaller and accepts an arbitrary
 * stroke colour so each secondary card carries a tone matching its
 * semantic role (Spend = down-red, Revenue = up-green, ROAS = accent
 * violet, Orders = neutral ink, CPM = info-blue). The fill is a vertical
 * gradient from 35% → 0% so the line reads first and the area is a soft
 * lead-in — no second visual layer competing with the big number.
 *
 * Lives inline (vs. a separate primitives file) because every prop is
 * specific to the hero strip's editorial role and we want the spark
 * geometry + the per-card colour map next to each other for quick
 * tuning.
 * -------------------------------------------------------------------------- */

function MiniSparkline({
  values,
  stroke,
}: {
  values: number[] | undefined;
  stroke: string;
}) {
  // Hooks first — see NetSparkline for the same rationale.
  const gid = useMemo(
    () => `mini-spark-${Math.random().toString(36).slice(2, 8)}`,
    [],
  );
  if (!values || values.length < 2) return null;
  const W = 600;
  const H = 30;
  const PAD_Y = 3;
  const clean = values.filter((v) => Number.isFinite(v));
  if (clean.length < 2) return null;
  const lo = Math.min(...clean);
  const hi = Math.max(...clean);
  // When every value is identical the range is 0; render a flat line at
  // the vertical midline instead of dividing by zero.
  const range = hi - lo || 1;
  const stepX = W / (clean.length - 1);
  const yFor = (v: number) =>
    H - PAD_Y - ((v - lo) / range) * (H - PAD_Y * 2);

  const linePath = clean
    .map((v, i) => {
      const x = i * stepX;
      const y = yFor(v);
      return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
  const areaPath = `${linePath} L${W},${H} L0,${H} Z`;

  return (
    <svg
      className="block w-full h-[30px] mt-3"
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
      aria-hidden
    >
      <defs>
        <linearGradient id={gid} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor={stroke} stopOpacity={0.35} />
          <stop offset="100%" stopColor={stroke} stopOpacity={0} />
        </linearGradient>
      </defs>
      <path d={linePath} fill="none" stroke={stroke} strokeWidth={1.5} />
      <path d={areaPath} fill={`url(#${gid})`} />
    </svg>
  );
}

/* --------------------------------------------------------------------------
 * Per-metric stroke colour for the 5 secondary cards. Each colour is the
 * semantic "direction" tone — Spend is a soft down-red, Revenue is the
 * up-green band, ROAS is the accent violet, Orders is a neutral ink, and
 * CPM is the info-blue we already use on auxiliary metrics. All use OKLCH
 * literals (same palette family as BAND_STROKE) so the strokes sit in the
 * same colour space and the strip reads as a unified set rather than five
 * disparate hues.
 * -------------------------------------------------------------------------- */

const SECONDARY_SPARK_STROKE = {
  spend:   'oklch(64% 0.18 22)',   // softer than the band-red rim
  revenue: 'oklch(70% 0.16 145)',  // matches band-green
  roas:    'oklch(70% 0.18 295)',  // accent violet
  orders:  'oklch(70% 0.012 250)', // neutral ink
  cpm:     'oklch(68% 0.14 240)',  // info-blue
} as const;

/* --------------------------------------------------------------------------
 * Component
 * -------------------------------------------------------------------------- */

export function CommandCenterHero({
  current,
  delta,
  rangeLabel,
  netSparkValues,
  secondarySparklines,
  updatedAt,
  className,
}: CommandCenterHeroProps) {
  // Single band selector used by BOTH the featured Net card and the
  // banded ROAS tile in row 2 — locked per [[home-visual-rules]] so the
  // two hero numbers always agree on hue.
  const netBand = useRoasBandGradient(current.roas);
  const roasBand = netBand;
  // Freshness is the same input for every card in the hero — when a stale
  // sweep affects the period, the whole strip dims together. (Per-card
  // staleness will come back if we wire per-platform updatedAt later.)
  const freshness = useStaleness(updatedAt);
  const freshnessStage = updatedAt !== undefined ? freshness.stage : undefined;

  return (
    <section
      aria-label="סקירת תקופה"
      className={cn('space-y-3', className)}
    >
      {/* Row 1 — Net Profit (featured + banded) · Spend · Revenue --------- */}
      <div
        className={cn(
          'grid gap-3',
          'grid-cols-1 md:grid-cols-[2fr_1fr_1fr]',
        )}
        data-testid="hero-row-1"
      >
        <Card
          band={netBand.band}
          freshness={freshnessStage}
          className="hero-card featured px-5 sm:px-6 py-5 sm:py-6"
          data-testid="hero-net-profit"
        >
          <HeroCardHeader
            label={`רווח נטו · ${rangeLabel}`}
            updatedAt={updatedAt}
          />
          <bdi
            dir="ltr"
            className={cn(
              'v num banded',
              'block font-extrabold tabular-nums tracking-tight leading-[1.05]',
              'mt-2 text-[2.25rem] sm:text-[2.75rem]',
            )}
          >
            {fmtMoneyCompact(current.netProfit)}
          </bdi>
          <DeltaLine
            text={fmtMoneyDelta(delta?.netProfit)}
            pctText={fmtPctDelta(
              delta?.netProfit != null && current.netProfit != null
                ? delta.netProfit /
                    Math.max(1, Math.abs(current.netProfit - delta.netProfit))
                : null,
            )}
            label="מול אתמול"
            positive={(delta?.netProfit ?? 0) >= 0}
            className="text-sm mt-2.5"
          />
          {netSparkValues && netSparkValues.length >= 2 && (
            <NetSparkline
              values={netSparkValues}
              bandColorVar={BAND_STROKE[netBand.band]}
            />
          )}
        </Card>

        <Card
          freshness={freshnessStage}
          className="hero-card px-5 py-5"
          data-testid="hero-spend"
        >
          <HeroCardHeader label="הוצאה" />
          <bdi
            dir="ltr"
            className="v num neutral block font-extrabold tabular-nums tracking-tight leading-[1.05] mt-2 text-[1.625rem]"
          >
            {fmtMoneyCompact(current.spend)}
          </bdi>
          {/* spend ↑ is a NEGATIVE signal */}
          <DeltaLine
            text={fmtPctDelta(delta?.spendPct)}
            positive={(delta?.spendPct ?? 0) <= 0}
            className="text-xs mt-1.5"
          />
          <MiniSparkline
            values={secondarySparklines?.spend}
            stroke={SECONDARY_SPARK_STROKE.spend}
          />
        </Card>

        <Card
          freshness={freshnessStage}
          className="hero-card px-5 py-5"
          data-testid="hero-revenue"
        >
          <HeroCardHeader label="הכנסה" />
          <bdi
            dir="ltr"
            className="v num neutral block font-extrabold tabular-nums tracking-tight leading-[1.05] mt-2 text-[1.625rem]"
          >
            {fmtMoneyCompact(current.revenue)}
          </bdi>
          <DeltaLine
            text={fmtPctDelta(delta?.revenuePct)}
            positive={(delta?.revenuePct ?? 0) >= 0}
            className="text-xs mt-1.5"
          />
          <MiniSparkline
            values={secondarySparklines?.revenue}
            stroke={SECONDARY_SPARK_STROKE.revenue}
          />
        </Card>
      </div>

      {/* Row 2 — ROAS (banded) · Orders · CPM ----------------------------- */}
      <div
        className="grid gap-3 grid-cols-1 md:grid-cols-3"
        data-testid="hero-row-2"
      >
        <Card
          band={roasBand.band}
          freshness={freshnessStage}
          className="hero-card px-5 py-5"
          data-testid="hero-roas"
        >
          <HeroCardHeader label="ROAS" />
          <bdi
            dir="ltr"
            className="v num banded block font-extrabold tabular-nums tracking-tight leading-[1.05] mt-2 text-[1.625rem]"
          >
            {fmtRoas(current.roas)}
          </bdi>
          <DeltaLine
            text={fmtRoasDelta(delta?.roas)}
            positive={(delta?.roas ?? 0) >= 0}
            className="text-xs mt-1.5"
          />
          <MiniSparkline
            values={secondarySparklines?.roas}
            stroke={SECONDARY_SPARK_STROKE.roas}
          />
        </Card>

        <Card
          freshness={freshnessStage}
          className="hero-card px-5 py-5"
          data-testid="hero-orders"
        >
          <HeroCardHeader label="הזמנות · סה״כ" />
          <bdi
            dir="ltr"
            className="v num neutral block font-extrabold tabular-nums tracking-tight leading-[1.05] mt-2 text-[1.625rem]"
          >
            {fmtCount(current.orders)}
          </bdi>
          <DeltaLine
            text={fmtCountDelta(delta?.orders)}
            positive={(delta?.orders ?? 0) >= 0}
            className="text-xs mt-1.5"
          />
          <MiniSparkline
            values={secondarySparklines?.orders}
            stroke={SECONDARY_SPARK_STROKE.orders}
          />
        </Card>

        <Card
          freshness={freshnessStage}
          className="hero-card px-5 py-5"
          data-testid="hero-cpm"
        >
          <HeroCardHeader label="CPM · עסקי" />
          <bdi
            dir="ltr"
            className="v num neutral block font-extrabold tabular-nums tracking-tight leading-[1.05] mt-2 text-[1.625rem]"
          >
            {current.cpm != null && current.cpm > 0
              ? fmtMoneyDecimal(current.cpm, 2)
              : '—'}
          </bdi>
          {/* CPM ↑ is a NEGATIVE signal */}
          <DeltaLine
            text={fmtPctDelta(delta?.cpmPct)}
            positive={(delta?.cpmPct ?? 0) <= 0}
            className="text-xs mt-1.5"
          />
          <MiniSparkline
            values={secondarySparklines?.cpm}
            stroke={SECONDARY_SPARK_STROKE.cpm}
          />
        </Card>
      </div>
    </section>
  );
}

/* --------------------------------------------------------------------------
 * Internal — header row (label + optional freshness chip).
 *
 * Only the FEATURED Net Profit tile gets the badge in the header (per
 * spec: card-level freshness chip lives on the lead tile; the other
 * tiles share the same freshness via the Card's data-freshness so
 * surfacing 6 chips would be redundant noise).
 * -------------------------------------------------------------------------- */

function HeroCardHeader({
  label,
  updatedAt,
}: {
  label: string;
  updatedAt?: StalenessInput;
}) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-[10.5px] uppercase tracking-[0.08em] text-ink-muted font-semibold">
        {label}
      </span>
      {updatedAt !== undefined && <FreshnessBadge updatedAt={updatedAt} />}
    </div>
  );
}

/* --------------------------------------------------------------------------
 * Internal — delta line (e.g. "▴ +$612 (+15%) מול אתמול").
 *
 * `positive` flips green↔red. Empty string text → no render (caller can
 * spread the prop conditionally without an extra wrapper).
 * -------------------------------------------------------------------------- */

function DeltaLine({
  text,
  pctText,
  label,
  positive,
  className,
}: {
  text: string;
  pctText?: string;
  label?: string;
  positive: boolean;
  className?: string;
}) {
  if (!text) return null;
  return (
    <div
      className={cn(
        'flex items-baseline gap-1 tabular-nums',
        positive ? 'text-status-green' : 'text-status-red',
        className,
      )}
    >
      <bdi dir="ltr">{text}</bdi>
      {pctText && (
        <bdi dir="ltr" className="text-ink-muted opacity-80">
          ({pctText.replace(/^▴ |^▾ /, '')})
        </bdi>
      )}
      {label && <span className="text-ink-muted">{label}</span>}
    </div>
  );
}
