'use client';

/**
 * <CommandCenterHero> — the Home tab's KPI strip.
 *
 * Horizon re-skin W3.2 (2026-06-13): rebuilt as the EXACT-MATCH 6-Widget KPI
 * row from the approved mockup
 * (docs/superpowers/mockups/2026-06-12-horizon-reskin/home-approved.html,
 * lines ~138-200). The prior 7-Card mesh hero (banded glass cards + per-card
 * sparklines, 2026-05-31) is replaced by a single responsive
 * `grid-cols-2 gap-5 md:grid-cols-3 xl:grid-cols-6` row of the shared
 * {@link Widget} primitive (icon circle → label → value → delta sub-line).
 *
 * The 6 mockup widgets, in DOM order:
 *   1. הוצאת פרסום (spend)      — brand icon · delta ↓ red (spend ↑ = bad).
 *   2. הכנסות (revenue)         — brand icon · delta ↑ green.
 *   3. רווח תפעולי (op. profit) — brand icon + LIVE pill · delta ↓ red.
 *      = revenue − ad spend − COGS. Full net profit (after fixed/recurring/
 *      fees) stays on the P&L tab per operator request — see the tooltip.
 *   4. MER (band-gauge)        — BAND VARIANT. The gauge icon + icon circle
 *      + value + band-tag pill all take the operator-locked ROAS band colour
 *      (bandForRoas / BAND_TAG_LABEL via Widget's `bandRoas`). MER = blended
 *      business ROAS (revenue ÷ spend) — the SAME number the old "MER" tile
 *      showed. Reads correctly for red/orange/green/blue/gray, which is why
 *      the operator locked the band-agnostic gauge icon.
 *   5. הזמנות (orders)         — brand icon · delta neutral.
 *   6. CPM עסקי (business CPM) — brand icon · delta ↓ green (CPM ↑ = bad).
 *
 * NO-INFO-LOSS — the mockup's 6 widgets do NOT cover two data points the old
 * hero surfaced, so both are KEPT (deletion/hiding is operator-forbidden):
 *   • Inventory (COGS) — rendered as a 7th Widget in the SAME grid (the grid
 *     simply holds >6 on its last row). Shows the COGS dollar amount + the
 *     "~X.X% מהמחזור" subtitle. Informational — no band colouring.
 *   • NC-ROAS / nCAC ("לקוחות חדשים · שאלה אחרת") — kept as its own banded
 *     Widget below the grid (its OWN band, a different question from MER).
 *     Will be reconciled/relocated when the NC-by-channel card lands.
 * Also preserved: the attribution-coverage chip, every HelpTooltip (incl. the
 * locked MER explanation + operating-profit + COGS copy), the delta-vs-previous
 * computations, count-up numbers (via <Money countUp> / <CountUp>), the LIVE
 * pill on operating profit, the DQ-3/DQ-4 provenance + override flags next to
 * spend, and the exact metric-direction colouring (spend red↓, revenue green↑,
 * orders neutral, CPM green-when-down). The per-card decorative sparklines were
 * dropped to match the mockup; the underlying daily series remain available to
 * the RoasTargetChart below — no data point is lost.
 *
 * The legacy <NetSparkline>/<MiniSparkline> helpers are retained + exported so
 * their unit tests stay green and future surfaces can reuse them.
 *
 * Presentational — parent (Dashboard HomeTab) reads /api/data via SWR and
 * passes the already-aggregated values. No SWR calls inside this primitive.
 */

import { useMemo } from 'react';
import {
  DollarSign,
  TrendingUp,
  LineChart,
  Gauge,
  ShoppingCart,
  BarChart3,
  Package,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Card } from '@/components/ui/Card';
import { Widget } from '@/components/ui/Widget';
import { HelpTooltip } from '@/components/ui/Tooltip';
import { Money } from '@/components/ui/Money';
import { CountUp } from '@/components/ui/CountUp';
import { Badge } from '@/components/ui/Badge';
import { FreshnessBadge } from '@/components/ui/FreshnessBadge';
import { CoverageChip } from '@/components/home/CoverageChip';
import { ProvenanceFlag } from '@/components/ui/ProvenanceFlag';
import { OverrideFlag } from '@/components/ui/OverrideFlag';
import type { ProvenanceVerdict } from '@/lib/freshness/provenance';
import type { CoverageChip as CoverageChipData } from '@/lib/home/adapters';
import type { UnknownBucketBreakdown } from '@/lib/home/unknownBucket';
import type { NcConfidence } from '@/lib/home/newCustomerMetrics';
import type { ChannelMetric } from '@/lib/home/channelTruth';
import { ChannelTruthPanel } from '@/components/home/ChannelTruthPanel';
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
  /** Full net profit in CAD (revenue − spend − COGS − fees − fixed costs).
   *  Retained for callers that need the legacy semantics; the hero's
   *  featured card uses `operatingProfit` instead — see field doc below. */
  netProfit: number | null;
  /**
   * Operating profit in CAD = revenue − ad spend − COGS. This is what the
   * featured "רווח תפעולי" hero card surfaces — it matches the costs
   * the Home tab actually contextualises (ads + inventory). Fixed and
   * recurring overhead is reserved for the P&L tab, which surfaces full
   * net profit alongside the cost lines that produce it.
   */
  operatingProfit: number | null;
  /** Revenue in CAD for the active range. */
  revenue: number | null;
  /** Total ad spend in CAD for the active range. */
  spend: number | null;
  /** Blended CPM in CAD across the active range. 0 == no impressions yet. */
  cpm: number | null;
  /** Total orders count for the active range. */
  orders: number | null;
  /**
   * Cost-of-goods-sold total in CAD for the active range. Drives the
   * row-2 inventory hero card ("מלאי"): big number = fmtMoneyCompact(cogs),
   * subtitle = `(cogs / revenue) * 100` rounded to 1 decimal. Replaced
   * the prior `adSpendPctOfRevenue` field on 2026-05-31 — the operator
   * preferred a card showing the inventory dollar amount over the
   * ad-spend ratio. null when COGS data is missing for the range so the
   * card renders "—" instead of $0.
   */
  cogs: number | null;
}

export interface CommandCenterDelta {
  /** ROAS delta as POINTS (curRoas − prevRoas). Signed. */
  roas: number | null;
  /** Full net-profit delta in CAD (curTrueNet − prevTrueNet). Signed.
   *  Retained for back-compat; the featured hero card uses
   *  `operatingProfit` below — see field doc. */
  netProfit: number | null;
  /**
   * Operating-profit delta in CAD (curOpProfit − prevOpProfit) where
   * operatingProfit = revenue − ad spend − COGS. Drives the
   * delta-vs-previous line on the featured "רווח תפעולי" card.
   */
  operatingProfit: number | null;
  /** Revenue delta as fraction ((cur − prev) / prev). Signed. */
  revenuePct: number | null;
  /** Spend delta as fraction. ↑ spend is a NEGATIVE signal (inverse). */
  spendPct: number | null;
  /** CPM delta as fraction. ↑ CPM is a NEGATIVE signal (inverse). */
  cpmPct: number | null;
  /** Orders delta as absolute count. */
  orders: number | null;
  /**
   * COGS delta in CAD (curCogs − prevCogs). Signed. Not currently
   * rendered (the inventory card is muted / informational) but exposed
   * for symmetry with the rest of the delta shape so future tooling can
   * surface a "▴ +$2,300 מלאי" line without reshaping the adapter.
   */
  cogs: number | null;
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

/**
 * NC-ROAS / nCAC — a SUBORDINATE "different question" lens. Rendered as its
 * OWN-band tile; never changes the hero's main band gradient (which stays
 * driven by current.roas / MER). Omit to hide the tile entirely (back-compat).
 */
export interface CommandCenterNewCustomer {
  /** New-customer ROAS (new-customer revenue ÷ MER spend). null → "—". */
  ncRoas: number | null;
  /** New-customer acquisition cost (MER spend ÷ new orders), CAD. null → "—". */
  nCac: number | null;
  /** New-customer order count. */
  ncOrders: number;
  /** Returning-customer order count (new + returning + unclassifiable = total). */
  returningOrders: number;
  /** Fraction of orders with unknown customer (guest checkout). */
  unclassifiableShare: number;
  /**
   * Two-stage confidence gate (Wave 1) derived from `unclassifiableShare`:
   * 'low' → render the ratio + a "ביטחון נמוך" badge; 'suppressed' → hide the
   * ratio and show "לא מספיק דאטה לסיווג"; 'ok' → render normally. Flows
   * straight from `computeNewCustomerMetrics`.
   */
  confidence: NcConfidence;
  /**
   * channel-nc-roas-split (Wave 2) — optional per-channel breakdown. When
   * present, a ChannelTruthPanel (Meta/Google/TikTok cards) renders under the
   * blended NC-ROAS/nCAC numbers. Omit to hide.
   */
  channelTruth?: {
    metrics: ChannelMetric[];
    blendedNcRoas: number | null;
    blendedNcac: number | null;
    unclassifiableShare: number;
  };
}

export interface CommandCenterHeroProps {
  current: CommandCenterPeriod;
  /** Optional previous-period numbers; when omitted, delta lines hide. */
  delta?: CommandCenterDelta;
  /** Range label used in the Net-Profit eyebrow ("היום" / "30 ימים"). */
  rangeLabel: string;
  /** Honest attribution-coverage chip — hero-only. Pass null to hide. */
  coverage?: CoverageChipData | null;
  /**
   * WS7 A.3 — descriptive decomposition of the unknown/direct order bucket.
   * When supplied AND the coverage chip is prominent (>30% unknown), the chip
   * becomes an inline disclosure that reveals <UnknownBucketPanel>. Omit to
   * keep the chip a static summary (back-compat). Computed upstream from the
   * SAME current-range orders rows the coverage chip consumes, so chip + panel
   * never disagree.
   */
  coverageBreakdown?: UnknownBucketBreakdown;
  /**
   * "vs <previous period>" caption for the featured card's delta line. The
   * delta compares against the previous equal-length period, so this must track
   * the selected range (e.g. "מול אתמול" for today, "מול החודש הקודם" for
   * this_month). Defaults to "מול אתמול" for back-compat.
   */
  comparisonLabel?: string;
  /**
   * True when a non-default compare baseline is selected but the previous
   * period has NO data to compare against (e.g. "שנה שעברה" on a business
   * younger than a year). The featured card then shows an explicit
   * "אין נתוני השוואה" hint instead of silently hiding every delta line.
   */
  comparisonUnavailable?: boolean;
  /**
   * Freshness signal — drives the featured card's <FreshnessBadge> AND every
   * KPI <Widget>'s `data-freshness` desaturation fade. Accepts the same shape
   * as `useStaleness`: a single ISO timestamp or a per-platform record.
   */
  updatedAt?: StalenessInput;
  /** Optional NC-ROAS / nCAC subordinate-tile data. Omit to hide. */
  newCustomer?: CommandCenterNewCustomer;
  /**
   * DQ-4 (Wave 3 data-trust) — provenance verdict for the active range. Drives
   * a <ProvenanceFlag> next to the Spend KPI: "סופי" (finalized) / "אומדן חי"
   * (live estimate). 'unknown' or omitted → renders nothing (back-compat for
   * freshness-less historical rows).
   */
  provenanceVerdict?: ProvenanceVerdict;
  /**
   * DQ-3 (Wave 3 data-trust) — active manual-spend override note + last-edited
   * timestamp for the current store scope. When present, a <OverrideFlag>
   * "● ידני" chip renders next to the Spend KPI. Both omitted → no flag.
   */
  overrideNote?: string;
  overrideLastEditedAt?: string;
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

/**
 * COGS-share-of-revenue formatter for the inventory card subtitle —
 * renders as "~X.X% מהמחזור" (e.g. cogs=250, revenue=1000 → "~25.0% מהמחזור").
 * Returns an empty string when revenue is 0/null so the card omits the
 * subtitle instead of dividing by zero. Cogs may be missing while
 * revenue is present (early in the day before orders sync); we still
 * surface the line in that case with "~0.0% מהמחזור" so the operator
 * sees the comparison context rather than an unexplained gap.
 */
function fmtCogsPctSubtitle(
  cogs: number | null | undefined,
  revenue: number | null | undefined,
): string {
  if (cogs == null || Number.isNaN(cogs)) return '';
  if (revenue == null || !Number.isFinite(revenue) || revenue <= 0) return '';
  const pct = (cogs / revenue) * 100;
  if (!Number.isFinite(pct)) return '';
  return `~${pct.toFixed(1)}% מהמחזור`;
}

/* --------------------------------------------------------------------------
 * Sparkline — featured Net Profit card.
 *
 * Hand-rolled SVG (no Recharts) so the hero card stays light. Path is the
 * point-to-point polyline; area fills below the line via a vertical-gradient
 * stop that's already band-coloured by the surrounding card's data-band.
 * -------------------------------------------------------------------------- */

export function NetSparkline({
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
      {/*
        Wave D2 (refined) — line casing only, NO plot scrim.
        The featured card sits on a ROAS-band gradient and the spark is drawn
        in that SAME band hue (green line on a green band, etc.), so the line
        can vanish into the matching tint. We deliberately DO NOT lay a neutral
        scrim rect behind the spark: that would mask the card's ROAS-state band
        colour, which must read at a glance. Instead the casing alone keeps the
        line legible on any band. Layering, base→top:
          1. area path (band-tinted gradient) — band identity reads as a soft
             fill, with the band colour/gradient showing through fully (no scrim).
          2. casing under-stroke (neutral --plot-bg, thicker) — a halo that
             separates the coloured line from the area/band beneath it.
          3. coloured line (bandColorVar) — reads clearly on its neutral casing.
        --plot-bg is theme-aware (dark casing in dark mode, near-white in light),
        so the casing holds on every band in both themes.
      */}
      <path d={areaPath} fill={`url(#${gid})`} />
      <path
        d={linePath}
        fill="none"
        stroke="var(--plot-bg)"
        strokeWidth={4}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d={linePath}
        fill="none"
        stroke={bandColorVar}
        strokeWidth={2}
      />
    </svg>
  );
}

/* --------------------------------------------------------------------------
 * Per-band stroke colour map — pulled out so NetSparkline picks the same
 * CSS-var hue the Card's `data-band` rim uses. Keeps the spark + the
 * surrounding tint in lock-step.
 * -------------------------------------------------------------------------- */

/* Round 7 (2026-05-31): reads directly from --band-* tokens so the
 * sparkline stroke tracks the theme without any manual sync.
 * CommandCenterHero is NOT a chart file → var(--band-*) is allowed. */
export const BAND_STROKE: Record<RoasBand, string> = {
  red:         'var(--band-red)',
  // The hero never derives a red-alarm band itself (no zero-sales signal is
  // wired here), but Record<RoasBand> must be exhaustive — point it at the
  // alarm top-bar glow token for consistency if it ever does.
  'red-alarm': 'var(--band-red-alarm)',
  orange:      'var(--band-orange)',
  green:       'var(--band-green)',
  blue:        'var(--band-blue)',
  gray:        'var(--band-gray)',
};

/* --------------------------------------------------------------------------
 * Neutral sparkline stroke for secondary cards — derived from --text so it
 * always contrasts the card surface: near-white in dark mode, near-ink in
 * light mode. The 55% alpha keeps it tonal rather than competing with the
 * band hue of any surrounding card.
 * -------------------------------------------------------------------------- */
export const NEUTRAL_SPARK_STROKE = 'oklch(from var(--text) l c h / 0.55)';

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

export function MiniSparkline({
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
  // c/HI-05 class (2026-06-10 audit): when every value is identical the
  // range is 0 — render a flat line at the vertical MIDLINE. The previous
  // `range = hi - lo || 1` swap made (v - lo) evaluate to 0 for every
  // point, gluing the line to the BOTTOM of the box ("crashed to zero")
  // even though the comment promised a midline. Mirrors the degenerate
  // branch in lib/sparklineGeometry.computeSparklineGeometry.
  const degenerate = hi - lo === 0;
  const range = hi - lo || 1;
  const stepX = W / (clean.length - 1);
  const yFor = (v: number) =>
    degenerate ? H / 2 : H - PAD_Y - ((v - lo) / range) * (H - PAD_Y * 2);

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
      {/* Fill FIRST, stroke LAST — the area gradient used to be painted on
          top of the stroke, washing the line out exactly where values peak
          (the gradient is most opaque at the top). 2026-06-10 audit. */}
      <path d={areaPath} fill={`url(#${gid})`} />
      <path d={linePath} fill="none" stroke={stroke} strokeWidth={1.5} />
    </svg>
  );
}

/* --------------------------------------------------------------------------
 * Per-metric stroke colours used to live here (Spend = down-red, Revenue =
 * up-green, ROAS = accent violet, Orders = neutral ink, CPM = info-blue),
 * but Change B (2026-05-31) made the hero's 4 secondary cards carry the
 * business-ROAS band on their background — a semantic-coloured spark on
 * top of a band-tinted surface clashes (red stroke on orange field, etc.).
 * Round 5 replaced all 4 with the shared NEUTRAL_SPARK_STROKE so the spark
 * read as a tonal echo of the band rather than competing with it.
 *
 * 2026-05-31 mockup-alignment: the secondary cards are now CLEAN NEUTRAL
 * surfaces (no band tint — see globals.css muted override), so the spark
 * clash that motivated Round 5 is gone. The approved mockup puts SEMANTIC
 * colour back on the two money sparks: Spend = down-red (var(--dn)),
 * Revenue = up-green (var(--up)). COGS / Orders / CPM stay neutral, and
 * the featured Net-Profit card keeps its BAND_STROKE.
 * -------------------------------------------------------------------------- */

/* --------------------------------------------------------------------------
 * Component
 * -------------------------------------------------------------------------- */

export function CommandCenterHero({
  current,
  delta,
  rangeLabel,
  coverage,
  coverageBreakdown,
  comparisonLabel = 'מול אתמול',
  comparisonUnavailable = false,
  // (W3.2 2026-06-13) The former `netSparkValues` / `secondarySparklines` props
  // were dropped from CommandCenterHeroProps: the Horizon <Widget> KPI recipe
  // carries no per-card sparkline, so nothing here consumed them. The underlying
  // daily series still drive the RoasTargetChart below (no data point lost), and
  // the standalone <NetSparkline>/<MiniSparkline> exports + their adapters remain
  // for any surface that wants the spark geometry.
  updatedAt,
  newCustomer,
  provenanceVerdict,
  overrideNote,
  overrideLastEditedAt,
  className,
}: CommandCenterHeroProps) {
  // Freshness is the same input for every widget in the hero — when a stale
  // sweep affects the period, the whole strip dims together. The featured
  // operating-profit widget surfaces the chip; the rest share the same signal.
  const freshness = useStaleness(updatedAt);
  const freshnessStage = updatedAt !== undefined ? freshness.stage : undefined;

  // Subordinate NC-ROAS tile — its OWN band (different question), independent
  // of the hero's MER band. Hidden entirely when newCustomer is omitted.
  const ncBand = useRoasBandGradient(newCustomer?.ncRoas ?? null);

  return (
    <section
      aria-label="סקירת תקופה"
      className={cn('space-y-3', className)}
    >
      {/*
        Hero header region — quiet, visually subordinate. Carries the
        attribution-coverage chip (HERO ONLY — never per-store). Renders
        nothing when `coverage` is null/undefined, so the row collapses
        cleanly while the chip is unwired or there are no orders.
      */}
      {coverage != null && (
        <div className="flex items-center justify-end" data-testid="hero-coverage-row">
          <CoverageChip coverage={coverage} breakdown={coverageBreakdown} />
        </div>
      )}

      {/*
        The 6-Widget KPI row — EXACT-MATCH to the approved Horizon mockup
        (home-approved.html lines ~138-200): a single responsive grid of the
        shared <Widget> primitive. DOM order = mockup order:
          1 Spend · 2 Revenue · 3 Operating Profit (LIVE) · 4 MER (band-gauge)
          · 5 Orders · 6 CPM.
        The Inventory (COGS) widget — a data point the 6 mockup widgets don't
        cover but the operator forbids dropping — rides along as a 7th widget in
        the SAME grid (its last row simply carries one extra tile until the
        NC-by-channel card lands and we reconcile it). NC-ROAS stays below.

        Grid: 7 KPI widgets (the mockup's 6 + the operator-mandated inventory
        tile). `xl:grid-cols-7` so all 7 sit in ONE clean row on desktop — at
        `xl:grid-cols-6` the 7th (inventory) wrapped alone onto a 2nd row, which
        read as a broken/orphaned card. Narrower breakpoints still wrap.
      */}
      <div
        className="grid grid-cols-2 gap-5 md:grid-cols-3 xl:grid-cols-7"
        data-testid="hero-row-1"
      >
        {/* 1 — Spend. Spend ↑ is a NEGATIVE signal (red ↓). The DQ-3/DQ-4
            data-trust flags ride in the sub-line; each renders null when its
            data is absent so the widget is visually unchanged with nothing to
            flag. */}
        <Widget
          data-testid="hero-spend"
          freshness={freshnessStage}
          icon={<DollarSign aria-hidden="true" />}
          title="הוצאת פרסום"
          value={
            <Money value={current.spend} prefix="$" compactAbove={1_000_000} countUp />
          }
          sub={
            <>
              {(provenanceVerdict || overrideNote || overrideLastEditedAt) && (
                <span className="mb-1 flex flex-wrap items-center gap-1.5">
                  {provenanceVerdict && <ProvenanceFlag verdict={provenanceVerdict} />}
                  {(overrideNote || overrideLastEditedAt) && (
                    <OverrideFlag note={overrideNote} lastEditedAt={overrideLastEditedAt} />
                  )}
                </span>
              )}
              <DeltaLine
                text={fmtPctDelta(delta?.spendPct)}
                positive={(delta?.spendPct ?? 0) <= 0}
              />
            </>
          }
        />

        {/* 2 — Revenue. ↑ is positive (green). */}
        <Widget
          data-testid="hero-revenue"
          freshness={freshnessStage}
          icon={<TrendingUp aria-hidden="true" />}
          title="הכנסות"
          value={
            <Money value={current.revenue} prefix="$" compactAbove={1_000_000} countUp />
          }
          sub={
            <DeltaLine
              text={fmtPctDelta(delta?.revenuePct)}
              positive={(delta?.revenuePct ?? 0) >= 0}
            />
          }
        />

        {/* 3 — Operating Profit (= revenue − ad spend − COGS). Carries the LIVE
            pill + the locked tooltip pointing full net profit to the P&L tab.
            testid kept as `hero-net-profit` for back-compat. */}
        <HelpTooltip content="הכנסות − פרסום − מלאי. רווח נטו מלא (כולל הוצאות קבועות וחוזרות) נמצא ב-P&L.">
          <Widget
            data-testid="hero-net-profit"
            freshness={freshnessStage}
            icon={<LineChart aria-hidden="true" />}
            title={
              <span className="flex items-center gap-1.5">
                {`רווח תפעולי · ${rangeLabel}`}
                <Badge tone="green" data-testid="hero-op-live">
                  LIVE
                </Badge>
                {updatedAt !== undefined && <FreshnessBadge updatedAt={updatedAt} />}
              </span>
            }
            value={
              <Money
                value={current.operatingProfit}
                prefix="$"
                compactAbove={1_000_000}
                countUp
              />
            }
            sub={
              comparisonUnavailable ? (
                <span className="text-ink-muted">אין נתוני השוואה לתקופה זו</span>
              ) : (
                <DeltaLine
                  text={fmtMoneyDelta(delta?.operatingProfit)}
                  pctText={fmtPctDelta(
                    delta?.operatingProfit != null && current.operatingProfit != null
                      ? delta.operatingProfit /
                          Math.max(
                            1,
                            Math.abs(current.operatingProfit - delta.operatingProfit),
                          )
                      : null,
                  )}
                  label={comparisonLabel}
                  positive={(delta?.operatingProfit ?? 0) >= 0}
                />
              )
            }
          />
        </HelpTooltip>

        {/* 4 — MER — BAND VARIANT (the headline of W3.2). The band-agnostic
            lucide Gauge icon + its circle + the value + the band-tag pill all
            take the operator-locked ROAS band colour, classified through
            bandForRoas via Widget's `bandRoas`. MER = blended business ROAS
            (revenue ÷ spend) — the SAME number the prior MER tile showed. Reads
            correctly for red/orange/green/blue/gray. testid kept as `hero-roas`
            for back-compat; the resolved band is mirrored onto the widget root's
            data-band. */}
        <HelpTooltip content="MER — Marketing Efficiency Ratio: סך ההכנסות ÷ סך ההוצאות (ROAS משוקלל על כל הפלטפורמות). מקור האמת היחיד לרווחיות הפרסום.">
          <Widget
            data-testid="hero-roas"
            freshness={freshnessStage}
            icon={<Gauge aria-hidden="true" />}
            title="MER"
            bandRoas={current.roas ?? undefined}
            value={<CountUp value={current.roas} format={fmtRoas} />}
            sub={
              <DeltaLine
                text={fmtRoasDelta(delta?.roas)}
                positive={(delta?.roas ?? 0) >= 0}
              />
            }
          />
        </HelpTooltip>

        {/* 5 — Orders. Neutral signal. Routed through <Money prefix="none"> so a
            7-digit count stays overflow-safe + count-up animated. */}
        <Widget
          data-testid="hero-orders"
          freshness={freshnessStage}
          icon={<ShoppingCart aria-hidden="true" />}
          title="הזמנות"
          value={
            <Money value={current.orders} prefix="none" compactAbove={100_000} countUp />
          }
          sub={
            <DeltaLine
              text={fmtCountDelta(delta?.orders)}
              positive={(delta?.orders ?? 0) >= 0}
            />
          }
        />

        {/* 6 — Business CPM. CPM ↑ is a NEGATIVE signal (green when down =
            cheaper). null/0 → "—" (no $0.00 surprise). */}
        <Widget
          data-testid="hero-cpm"
          freshness={freshnessStage}
          icon={<BarChart3 aria-hidden="true" />}
          title="CPM עסקי"
          value={
            current.cpm != null && current.cpm > 0 ? (
              <Money value={current.cpm} prefix="$" decimals={2} compactAbove={1_000_000} countUp />
            ) : (
              '—'
            )
          }
          sub={
            <DeltaLine
              text={fmtPctDelta(delta?.cpmPct)}
              positive={(delta?.cpmPct ?? 0) <= 0}
            />
          }
        />

        {/* 7 — Inventory (COGS). KEPT (no-info-loss) — not one of the mockup's
            6, but the operator forbids dropping it; it rides as the grid's 7th
            widget. Informational (no band colouring). Shows the COGS dollar
            amount + the "~X.X% מהמחזור" subtitle. */}
        <HelpTooltip content="עלות המלאי (COGS) בטווח הנבחר. בדרך כלל ~25% מהמחזור — לא יעד אלא תצפית.">
          <Widget
            data-testid="hero-cogs"
            freshness={freshnessStage}
            icon={<Package aria-hidden="true" />}
            title={`מלאי · ${rangeLabel}`}
            value={
              <Money value={current.cogs} prefix="$" compactAbove={1_000_000} countUp />
            }
            sub={(() => {
              const subtitle = fmtCogsPctSubtitle(current.cogs, current.revenue);
              if (!subtitle) return undefined;
              return (
                <span className="tabular-nums" data-testid="hero-cogs-subtitle">
                  <bdi dir="rtl">{subtitle}</bdi>
                </span>
              );
            })()}
          />
        </HelpTooltip>
      </div>

      {newCustomer && (
        <div className="grid gap-3 grid-cols-1" data-testid="hero-nc-row">
          <HelpTooltip content="לקוחות חדשים (הזמנה ראשונה אי-פעם). שאלה אחרת מ-MER: NC-ROAS = הכנסת לקוחות חדשים ÷ הוצאת פרסום; nCAC = הוצאת פרסום ÷ הזמנות חדשות.">
          <Card
            band={ncBand.band}
            bandStrength="muted"
            freshness={freshnessStage}
            className="hero-card px-3.5 py-4 sm:px-5 sm:py-5"
            data-testid="hero-nc-roas"
          >
            <div className="flex items-center justify-between gap-2">
              <HeroCardHeader label="לקוחות חדשים · שאלה אחרת" />
              {/* Wave 1 — low-confidence gate badge. Token-driven warning tone
                  (bg-status-warningBg/text-status-warningFg) → guaranteed AA in
                  both themes. Only shown when the unclassifiable share crosses
                  the "low" threshold but stays under "suppressed". */}
              {newCustomer.confidence === 'low' && (
                <Badge tone="warning" data-testid="hero-nc-confidence">
                  ביטחון נמוך
                </Badge>
              )}
            </div>
            {newCustomer.confidence === 'suppressed' ? (
              /* Suppressed — too much unclassifiable signal to trust the ratio.
                 Hide NC-ROAS / nCAC; keep the share line below for context. */
              <div
                className="text-sm mt-2 text-ink-muted"
                data-testid="hero-nc-suppressed"
              >
                <bdi dir="rtl">לא מספיק דאטה לסיווג</bdi>
              </div>
            ) : (
              <div className="flex items-end gap-6 mt-2">
                <div>
                  <div className="hero-eyebrow text-[10.5px] uppercase tracking-[0.08em] text-ink-muted font-semibold">
                    {/* "נטו (אחרי החזרים)" qualifier — NC-ROAS revenue is
                        re-based onto the net (refund-adjusted) basis so it
                        (Hebrew-only: a trailing latin word like "refunds" gets
                        bidi-reordered to the far-left edge of the RTL eyebrow)
                        reconciles with the headline net MER (Wave 1). */}
                    NC-ROAS · נטו (אחרי החזרים)
                  </div>
                  <bdi
                    dir="ltr"
                    className="v num neutral block text-end font-extrabold tabular-nums tracking-tight leading-[1.05] text-[1.625rem] whitespace-nowrap"
                  >
                    {newCustomer.ncRoas != null ? (
                      <CountUp value={newCustomer.ncRoas} format={fmtRoas} />
                    ) : (
                      '—'
                    )}
                  </bdi>
                </div>
                <div>
                  <div className="hero-eyebrow text-[10.5px] uppercase tracking-[0.08em] text-ink-muted font-semibold">
                    nCAC
                  </div>
                  <bdi
                    dir="ltr"
                    className="v num neutral block text-end font-extrabold tabular-nums tracking-tight leading-[1.05] text-[1.625rem] whitespace-nowrap"
                  >
                    <Money value={newCustomer.nCac} prefix="$" compactAbove={1_000_000} countUp />
                  </bdi>
                </div>
              </div>
            )}
            <div
              className="text-xs mt-1.5 text-ink-muted tabular-nums"
              data-testid="hero-nc-unclassifiable"
            >
              <bdi dir="rtl">
                {newCustomer.ncOrders.toLocaleString('en-US')} חדשות ·{' '}
                {newCustomer.returningOrders.toLocaleString('en-US')} חוזרות ·{' '}
                {(newCustomer.unclassifiableShare * 100).toFixed(0)}% לא מסווג
              </bdi>
            </div>
            {/* channel-nc-roas-split (Wave 2) — per-channel breakdown under the
                blended numbers: which channel acquires new customers profitably. */}
            {newCustomer.channelTruth && newCustomer.confidence !== 'suppressed' && (
              <div className="mt-3.5 border-t border-glass-edge pt-3.5">
                <div className="mb-2 text-[10.5px] uppercase tracking-[0.08em] text-ink-muted font-semibold">
                  NC-ROAS לפי ערוץ
                </div>
                <ChannelTruthPanel
                  metrics={newCustomer.channelTruth.metrics}
                  blendedNcRoas={newCustomer.channelTruth.blendedNcRoas}
                  blendedNcac={newCustomer.channelTruth.blendedNcac}
                  unclassifiableShare={newCustomer.channelTruth.unclassifiableShare}
                />
              </div>
            )}
          </Card>
          </HelpTooltip>
        </div>
      )}
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
      {/* `hero-eyebrow` is the class hook that
          `.glass[data-band] .hero-eyebrow` in globals.css picks up to
          brighten the label colour over a band slab — without it the
          Hebrew header ("הכנסה" / "הוצאה" / ...) reads as low-contrast
          dim grey against the orange/red/green tint. */}
      <span className="hero-eyebrow text-[10.5px] uppercase tracking-[0.08em] text-ink-muted font-semibold">
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
        // `hero-delta` is a styling hook: on VIVID banded hero cards
        // (Operating-Profit + ROAS) globals.css repaints the whole line WHITE
        // so it stays legible on the band gradient (the muted gray below is
        // illegible there). Neutral + gray cards keep the green/red + muted
        // tones, which are legible on the light surface. See
        // `.glass[data-band]:not([data-band="gray"]):not([data-band-strength="muted"]) .hero-delta`.
        'hero-delta',
        'flex items-baseline gap-1 tabular-nums',
        positive ? 'text-status-greenFg' : 'text-status-redFg',
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
