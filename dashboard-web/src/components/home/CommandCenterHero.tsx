'use client';

/**
 * Task 3.1 — <CommandCenterHero> primitive.
 *
 * Glass-card grid that REPLACES the prior HeroOverview + HomeLiveBand +
 * HomeSummaryBand + KpiCards stack at the top of the Home tab. Visual
 * ref: 2026-05-31 mesh mockup (`dashboard-mockups.html` `.row3b` + `.row4`).
 *
 *   Row 1 (`.row3b`, 1fr 1fr 1.15fr) — Revenue · Spend · Operating Profit
 *   Row 2 (`.row4`, repeat(4,1fr))   — CPM · Orders · Inventory (COGS) · ROAS
 *
 *   The two VIVID banded cards (Operating Profit, ROAS) live on the END/LEFT
 *   column under dir="rtl": the FIRST grid item renders in the start/right
 *   column, the LAST in the end/left column, so DOM-last banded cards stack
 *   on the left edge exactly as the approved mockup shows. The neutral KPI
 *   cards (Spend / Revenue / Inventory / Orders / CPM) fill the start side.
 *
 *   • Featured card carries the OPERATING PROFIT (revenue − ad spend −
 *     COGS), labelled "רווח תפעולי". Full net profit (after fixed +
 *     recurring + fees) lives on P&L per operator request — bringing it
 *     here would bake in costs the Home tab doesn't surface, mismatching
 *     the "Spend" card next to it which is ad-spend only.
 *   • Featured card carries `<Card band={...}>` with the band picked by
 *     `useRoasBandGradient(roas)` — i.e. the SAME band as the ROAS tile so
 *     the two hero numbers visually agree.
 *   • Featured big number wears `.v.banded` so its colour follows the
 *     data-band attribute on the card. Most secondary cards (Spend /
 *     Revenue / Orders / CPM / Inventory) wear `.v.neutral` which renders
 *     the soft white→cool-gray text-gradient defined in globals.css.
 *   • ROAS tile (row 2) also banded + `.v.banded` (matches mockup).
 *   • Inventory card (row 2, replaces the prior Ad-spend ÷ Revenue tile)
 *     is informational — muted business band, no threshold colouring.
 *     Shows COGS dollar amount for the range plus a "~X% מהמחזור"
 *     subtitle so the operator gets the dollar value AND the ratio
 *     context in one glance without baking a target into the colour.
 *   • Each card surfaces a <FreshnessBadge> chip wired to the same
 *     `updatedAt` that drives the Card's `data-freshness` desaturation,
 *     per [[home-visual-rules]] (Task 3.6).
 *   • Featured card renders a SVG sparkline (28-day shape) so the
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
 *   • ROAS / Operating Profit / Revenue / Spend / CPM / Orders +
 *     Inventory (COGS) — all surfaced here.
 *   • Ad-spend ÷ Revenue ratio — implicit in Spend ÷ Revenue (both
 *     cards live in row 1) and exact in the operator's mental model;
 *     the dedicated card was retired 2026-05-31 in favour of inventory.
 *   • Full Net Profit (after fixed + recurring + fees) — P&L tab.
 *   • Gross Profit moves to <RoasTargetChart> KPI strip (lives under
 *     Operating Profit's tooltip).
 *   • Transaction fees, fixed costs — P&L tab.
 *
 * Presentational — parent (Dashboard HomeTab) reads /api/data via SWR and
 * passes the already-aggregated values + the day-period rows for the
 * sparkline. No SWR calls inside this primitive.
 */

import { useMemo } from 'react';
import { cn } from '@/lib/utils';
import { Card } from '@/components/ui/Card';
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
const BAND_STROKE: Record<RoasBand, string> = {
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
const NEUTRAL_SPARK_STROKE = 'oklch(from var(--text) l c h / 0.55)';

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
  netSparkValues,
  secondarySparklines,
  updatedAt,
  newCustomer,
  provenanceVerdict,
  overrideNote,
  overrideLastEditedAt,
  className,
}: CommandCenterHeroProps) {
  // Business-ROAS band selector used by all 7 hero cards — Change
  // B (2026-05-31): the hero strip wears the business-ROAS band so a
  // glance at the row communicates business health. Operating Profit +
  // ROAS get the band-coloured big number (`.v.banded`); Spend /
  // Revenue / Orders / CPM / Inventory keep the white gradient number
  // on top of the band-tinted surface. (The prior Ad-spend ÷ Revenue
  // card carried its OWN 25%-target band — retired 2026-05-31 in
  // favour of the inventory card, which is informational and doesn't
  // colour itself differently from the strip.)
  const netBand = useRoasBandGradient(current.roas);
  const roasBand = netBand;
  const businessBand = netBand.band;
  // Freshness is the same input for every card in the hero — when a stale
  // sweep affects the period, the whole strip dims together. (Per-card
  // staleness will come back if we wire per-platform updatedAt later.)
  const freshness = useStaleness(updatedAt);
  const freshnessStage = updatedAt !== undefined ? freshness.stage : undefined;

  // Subordinate NC-ROAS tile — its OWN band (different question), independent
  // of the hero's MER band (netBand). Hidden entirely when newCustomer omitted.
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
        Row 1 — DOM order Revenue · Spend · Operating Profit (featured + banded).
        The mockup (`.row3b`, grid-template-columns: 1fr 1fr 1.15fr) is rendered
        under dir="rtl": the FIRST grid item lands in the rightmost (start)
        column and the LAST lands in the leftmost (end) column. The approved
        mockup puts the vivid banded Operating-Profit card on the LEFT/END
        (slightly wider, 1.15fr) with the two neutral money cards filling the
        start side — Spend in the middle, Revenue at the start/right. DOM
        order here is therefore Revenue → Spend → Profit so the banded card
        stacks with the banded ROAS card directly below it (row 2, also END).
      */}
      <div
        className={cn(
          'grid gap-3',
          // Mobile: 2-up compact grid (Revenue + Spend share the top row; the
          // featured Operating-Profit card spans full width below — see its
          // `col-span-2`). Was a single tall stack that ate the whole phone
          // screen. md+ desktop layout (1fr 1fr 1.15fr) is unchanged.
          'grid-cols-2 md:grid-cols-[1fr_1fr_1.15fr]',
        )}
        data-testid="hero-row-1"
      >
        <Card
          band={businessBand}
          bandStrength="muted"
          freshness={freshnessStage}
          className="hero-card px-3.5 py-4 sm:px-5 sm:py-5"
          data-testid="hero-revenue"
        >
          <HeroCardHeader label="הכנסה" />
          <bdi
            dir="ltr"
            className="v num neutral block font-extrabold tabular-nums tracking-tight leading-[1.05] mt-2 text-[1.625rem]"
          >
            <Money value={current.revenue} prefix="$" compactAbove={1_000_000} countUp />
          </bdi>
          <DeltaLine
            text={fmtPctDelta(delta?.revenuePct)}
            positive={(delta?.revenuePct ?? 0) >= 0}
            className="text-xs mt-1.5"
          />
          {/* 2026-05-31 mockup-alignment: neutral card, GREEN (revenue) spark. */}
          <MiniSparkline
            values={secondarySparklines?.revenue}
            stroke={'var(--up)'}
          />
        </Card>

        <Card
          band={businessBand}
          bandStrength="muted"
          freshness={freshnessStage}
          className="hero-card px-3.5 py-4 sm:px-5 sm:py-5"
          data-testid="hero-spend"
        >
          <HeroCardHeader label="הוצאה" />
          <bdi
            dir="ltr"
            className="v num neutral block font-extrabold tabular-nums tracking-tight leading-[1.05] mt-2 text-[1.625rem]"
          >
            <Money value={current.spend} prefix="$" compactAbove={1_000_000} countUp />
          </bdi>
          {/* DQ-3 / DQ-4 data-trust flags next to the Spend KPI. Each renders
              null when its data is absent (provenance 'unknown'; no override) so
              the card is visually unchanged when there's nothing to flag. */}
          {(provenanceVerdict || overrideNote || overrideLastEditedAt) && (
            <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
              {provenanceVerdict && <ProvenanceFlag verdict={provenanceVerdict} />}
              {(overrideNote || overrideLastEditedAt) && (
                <OverrideFlag note={overrideNote} lastEditedAt={overrideLastEditedAt} />
              )}
            </div>
          )}
          {/* spend ↑ is a NEGATIVE signal */}
          <DeltaLine
            text={fmtPctDelta(delta?.spendPct)}
            positive={(delta?.spendPct ?? 0) <= 0}
            className="text-xs mt-1.5"
          />
          {/* 2026-05-31 mockup-alignment: neutral card, RED (spend) spark. */}
          <MiniSparkline
            values={secondarySparklines?.spend}
            stroke={'var(--dn)'}
          />
        </Card>

        <HelpTooltip content="הכנסות − פרסום − מלאי. רווח נטו מלא (כולל הוצאות קבועות וחוזרות) נמצא ב-P&L.">
        <Card
          band={netBand.band}
          freshness={freshnessStage}
          // col-span-2 on mobile → the featured banded marquee spans the full
          // phone width beneath Revenue+Spend; md+ returns to its single column.
          className="hero-card featured col-span-2 md:col-span-1 px-4 py-4 sm:px-6 sm:py-6"
          data-testid="hero-net-profit"
        >
          <HeroCardHeader
            label={`רווח תפעולי · ${rangeLabel}`}
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
            <Money value={current.operatingProfit} prefix="$" compactAbove={1_000_000} countUp />
          </bdi>
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
            className="text-sm mt-2.5"
          />
          {netSparkValues && netSparkValues.length >= 2 && (
            <NetSparkline
              values={netSparkValues}
              bandColorVar={BAND_STROKE[netBand.band]}
            />
          )}
        </Card>
        </HelpTooltip>
      </div>

      {/*
        Row 2 — DOM order CPM · Orders · Inventory (COGS) · ROAS (featured + banded).
        Mirrors row 1: under dir="rtl" the FIRST grid item is the start/right
        column and the LAST is the end/left column (mockup `.row4`,
        grid-template-columns: repeat(4,1fr)). DOM order CPM → Orders →
        Inventory → ROAS lands ROAS on the LEFT/END so it stacks directly
        beneath the banded Operating-Profit card from row 1.
      */}
      <div
        className="grid gap-3 grid-cols-2 md:grid-cols-4"
        data-testid="hero-row-2"
      >
        <Card
          band={businessBand}
          bandStrength="muted"
          freshness={freshnessStage}
          className="hero-card px-3.5 py-4 sm:px-5 sm:py-5"
          data-testid="hero-cpm"
        >
          <HeroCardHeader label="CPM · עסקי" />
          <bdi
            dir="ltr"
            className="v num neutral block font-extrabold tabular-nums tracking-tight leading-[1.05] mt-2 text-[1.625rem]"
          >
            {current.cpm != null && current.cpm > 0 ? (
              <Money value={current.cpm} prefix="$" decimals={2} compactAbove={1_000_000} countUp />
            ) : '—'}
          </bdi>
          {/* CPM ↑ is a NEGATIVE signal */}
          <DeltaLine
            text={fmtPctDelta(delta?.cpmPct)}
            positive={(delta?.cpmPct ?? 0) <= 0}
            className="text-xs mt-1.5"
          />
          <MiniSparkline
            values={secondarySparklines?.cpm}
            stroke={NEUTRAL_SPARK_STROKE}
          />
        </Card>

        <Card
          band={businessBand}
          bandStrength="muted"
          freshness={freshnessStage}
          className="hero-card px-3.5 py-4 sm:px-5 sm:py-5"
          data-testid="hero-orders"
        >
          <HeroCardHeader label="הזמנות · סה״כ" />
          <bdi
            dir="ltr"
            className="v num neutral block font-extrabold tabular-nums tracking-tight leading-[1.05] mt-2 text-[1.625rem] whitespace-nowrap"
          >
            {/* Orders is a COUNT — routed through <Money prefix="none"> so it
                inherits the overflow-safe compact floor (≥100k → "150K", exact
                value in title/sr-only) AND the count-up animation, instead of a
                raw toLocaleString that could clip a 7-digit count on the ~165px
                mobile 2-up card. */}
            <Money
              value={current.orders}
              prefix="none"
              compactAbove={100_000}
              countUp
            />
          </bdi>
          <DeltaLine
            text={fmtCountDelta(delta?.orders)}
            positive={(delta?.orders ?? 0) >= 0}
            className="text-xs mt-1.5"
          />
          <MiniSparkline
            values={secondarySparklines?.orders}
            stroke={NEUTRAL_SPARK_STROKE}
          />
        </Card>

        {/* Inventory (COGS) — informational, muted business band -------- */}
        {/* Replaces the prior Ad-spend ÷ Revenue tile (2026-05-31). The
            operator preferred the inventory dollar amount + ratio
            subtitle over the ad-spend ratio. No threshold colouring —
            COGS is a structural metric, not a status signal. */}
        <HelpTooltip content="עלות המלאי (COGS) בטווח הנבחר. בדרך כלל ~25% מהמחזור — לא יעד אלא תצפית.">
        <Card
          band={businessBand}
          bandStrength="muted"
          freshness={freshnessStage}
          className="hero-card px-3.5 py-4 sm:px-5 sm:py-5"
          data-testid="hero-cogs"
        >
          <HeroCardHeader label={`מלאי · ${rangeLabel}`} />
          <bdi
            dir="ltr"
            className="v num neutral block font-extrabold tabular-nums tracking-tight leading-[1.05] mt-2 text-[1.625rem]"
          >
            <Money value={current.cogs} prefix="$" compactAbove={1_000_000} countUp />
          </bdi>
          {(() => {
            const subtitle = fmtCogsPctSubtitle(current.cogs, current.revenue);
            if (!subtitle) return null;
            return (
              <div
                className="text-xs mt-1.5 text-ink-muted tabular-nums"
                data-testid="hero-cogs-subtitle"
              >
                <bdi dir="rtl">{subtitle}</bdi>
              </div>
            );
          })()}
        </Card>
        </HelpTooltip>

        <HelpTooltip content="MER — Marketing Efficiency Ratio: סך ההכנסות ÷ סך ההוצאות (ROAS משוקלל על כל הפלטפורמות). מקור האמת היחיד לרווחיות הפרסום.">
        <Card
          band={roasBand.band}
          freshness={freshnessStage}
          className="hero-card px-3.5 py-4 sm:px-5 sm:py-5"
          data-testid="hero-roas"
        >
          <HeroCardHeader label="MER" />
          <bdi
            dir="ltr"
            className="v num banded block font-extrabold tabular-nums tracking-tight leading-[1.05] mt-2 text-[1.625rem] whitespace-nowrap"
          >
            <CountUp value={current.roas} format={fmtRoas} />
          </bdi>
          <DeltaLine
            text={fmtRoasDelta(delta?.roas)}
            positive={(delta?.roas ?? 0) >= 0}
            className="text-xs mt-1.5"
          />
          <MiniSparkline
            values={secondarySparklines?.roas}
            stroke={NEUTRAL_SPARK_STROKE}
          />
        </Card>
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
