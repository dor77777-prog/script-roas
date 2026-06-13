import type { HTMLAttributes, ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { Card, type CardFreshness } from './Card';
import { Money } from './Money';
import { bandForRoas, type CoreRoasBand } from '@/lib/roasBands';
import { BAND_TAG_LABEL } from '@/lib/format/useRoasBandGradient';

/**
 * Horizon re-skin Wave 1 — <Widget> KPI primitive.
 *
 * Mockup source: docs/superpowers/mockups/2026-06-12-horizon-reskin/
 * home-approved.html (the 6-KPI row, lines 138-199). A {@link Card} laid
 * out as a flex-row: a circular icon badge on the lead edge, then a
 * title (muted) over a bold value.
 *
 * BAND RULE — when a Widget represents a ROAS-like ratio (MER / ROAS) the
 * caller passes `bandRoas`. We classify it through the SINGLE SOURCE OF
 * TRUTH (`bandForRoas` in lib/roasBands.ts — do NOT re-fork the
 * thresholds) and then:
 *   • the value text + the badge (background tint + icon) take the band
 *     colour via the operator-locked `--band-*` token (token-only, no raw
 *     hex — translated to Tailwind arbitrary `color-mix`/`var()` so the
 *     no-hex-color guard stays green),
 *   • a band-tag pill renders next to the title using the shared
 *     `band-chip` + `chip-{band}` recipe (AA-safe tint + band-coloured
 *     text, already proven on the neutral RoasTargetChart KPI surface)
 *     and the canonical `BAND_TAG_LABEL` Hebrew wording (so the word
 *     matches the per-store pills + the chart chip — not a fork).
 *
 * `data-band` is mirrored onto the value element so DOM tests / future CSS
 * can target it without re-deriving the band.
 *
 * NUMBERS — a numeric `value` is rendered through the shared {@link Money}
 * primitive (overflow-safe, tabular-nums, RTL-isolated <bdi>, exact value
 * preserved in title + sr-only). A non-numeric `value` (already-formatted
 * string or a custom node) is rendered as-is.
 *
 * This is a `components/ui/` primitive, so `dark:` Tailwind variants are
 * permitted here (the no-dark-variant guard exempts components/ui/) and we
 * mirror the Horizon recipe directly (`bg-lightPrimary dark:bg-navy-700`).
 */
export interface WidgetProps
  extends Omit<HTMLAttributes<HTMLDivElement>, 'title'> {
  /** Lead icon — rendered inside the circular badge. */
  icon: ReactNode;
  /** Muted KPI label. */
  title: ReactNode;
  /** KPI value. A `number` renders through <Money>; anything else as-is. */
  value: ReactNode | number;
  /** Optional sub-line under the value (delta / context note). */
  sub?: ReactNode;
  /**
   * When supplied, classify this ROAS-like ratio through `bandForRoas` and
   * colour the value + badge + tag with the operator-locked band colour. The
   * resolved band is mirrored onto the VALUE `<span>`'s `data-band` for DOM
   * tests / future CSS — but DELIBERATELY NOT onto the Card root: the
   * `.glass[data-band]` rule is the vivid store-card recipe (opacity:0
   * mount-entrance gated on `data-mounted`, which a KPI Widget never sets), so a
   * root `data-band` rendered the banded KPI fully invisible (fixed 2026-06-13).
   */
  bandRoas?: number;
  /**
   * Freshness desaturation signal — forwarded to the inner {@link Card}'s
   * `freshness` prop (→ `data-freshness="…"`), which the
   * `.glass[data-freshness]` rule in globals.css turns into the operator-locked
   * saturate()+brightness fade (fresh <15min / aging 15–30min / stale >30min;
   * see lib/freshness/useStaleness.ts). Restores the W3.2-regressed behaviour
   * where every hero KPI card dimmed together as the period went stale. Omit to
   * opt out (no fade) — back-compat for un-freshness-aware callers.
   */
  freshness?: CardFreshness;
  /** Extra classes for the Card root. */
  className?: string;
}

/** Map a core band to its shared `chip-{band}` pill class. */
function chipClassForBand(band: CoreRoasBand): string {
  switch (band) {
    case 'red':
      return 'chip-red';
    case 'orange':
      return 'chip-orange';
    case 'green':
      return 'chip-green';
    case 'blue':
      return 'chip-blue';
    case 'gray':
    default:
      return 'chip-gray';
  }
}

/**
 * Per-band token colour, expressed as Tailwind arbitrary values that point
 * at the `--band-*` token (mode-aware in globals.css). Token-only — no raw
 * hex — so the no-hex-color-in-components guard stays green.
 *   • `text`   — value/icon colour = the band token.
 *   • `badgeBg`— circular-badge fill = a low-alpha tint of the same token.
 *     2026-06-13 (W3.2): tint set to ~12% alpha to match the approved mockup's
 *     MER widget (a soft band wash on the gauge-icon circle) — the circle reads
 *     as a band wash while the icon + value carry the full band colour. Stays
 *     token-only (oklch(from var(--band-X) …)), so the no-hex-color guard stays
 *     green and the whole thing re-skins + light/dark-flips through `--band-*`.
 */
const BAND_VALUE_CLASS: Record<CoreRoasBand, string> = {
  red: 'text-[var(--band-red)]',
  orange: 'text-[var(--band-orange)]',
  green: 'text-[var(--band-green)]',
  blue: 'text-[var(--band-blue)]',
  gray: 'text-[var(--band-gray)]',
};
const BAND_BADGE_CLASS: Record<CoreRoasBand, string> = {
  red: 'bg-[oklch(from_var(--band-red)_l_c_h_/_0.12)] text-[var(--band-red)]',
  orange:
    'bg-[oklch(from_var(--band-orange)_l_c_h_/_0.12)] text-[var(--band-orange)]',
  green:
    'bg-[oklch(from_var(--band-green)_l_c_h_/_0.12)] text-[var(--band-green)]',
  blue: 'bg-[oklch(from_var(--band-blue)_l_c_h_/_0.12)] text-[var(--band-blue)]',
  gray: 'bg-[oklch(from_var(--band-gray)_l_c_h_/_0.12)] text-[var(--band-gray)]',
};

export function Widget({
  icon,
  title,
  value,
  sub,
  bandRoas,
  freshness,
  className,
  ...rest
}: WidgetProps) {
  // Ordering matters: the Widget OWNS `data-band` (resolved from `bandRoas`)
  // and `data-freshness` (forwarded from `freshness`). Strip any stray
  // `data-band`/`data-freshness` a caller may have spread out of `rest` so they
  // can NEVER reach the inner <Card>'s own `{...props}` spread and clobber the
  // values we set below. (The inner Card spreads its `...props` last, so a stray
  // raw attribute left in `rest` would otherwise win over the forwarded
  // freshness.) These two attributes are Widget-owned, full stop.
  const {
    'data-band': _ignoredStrayBand,
    'data-freshness': _ignoredStrayFreshness,
    ...domRest
  } = rest as Record<string, unknown>;
  void _ignoredStrayBand;
  void _ignoredStrayFreshness;

  const band =
    typeof bandRoas === 'number' && Number.isFinite(bandRoas)
      ? bandForRoas(bandRoas)
      : null;

  // Neutral (un-banded) badge mirrors the Horizon default:
  // bg-lightPrimary dark:bg-navy-700 + brand/white icon. Banded badge swaps
  // to the band tint + band icon colour.
  const badgeClass = band
    ? BAND_BADGE_CLASS[band]
    : 'bg-lightPrimary text-brand-500 dark:bg-navy-700 dark:text-ink';

  // Value colour: band token when banded, else default ink.
  const valueColorClass = band ? BAND_VALUE_CLASS[band] : 'text-ink';

  const valueNode =
    typeof value === 'number' ? <Money value={value} /> : value;

  return (
    <Card
      className={cn('!flex-row items-center gap-4', className)}
      {...domRest}
      // `freshness` is set AFTER `{...domRest}` (stray data-freshness already stripped
      // above) so the Widget-owned value wins → the Card's `data-freshness` fade.
      //
      // `data-band` is DELIBERATELY NOT set on the Card root. The `.glass[data-band]`
      // rule is the vivid STORE-card recipe (band gradient + an `opacity:0`
      // mount-entrance that only reveals once `data-mounted="true"` is set). A KPI
      // Widget is a NEUTRAL card that band-colours only its icon-circle, value text +
      // tag — so putting `data-band` here made the one banded KPI (MER, and the
      // Campaigns ROAS summary tile) render at `opacity:0`, i.e. fully invisible.
      // (Fixed 2026-06-13.) The band stays mirrored on the value <span> below for
      // DOM-test targeting.
      freshness={freshness}
    >
      {/* Circular icon badge. `[&>svg]:h-5 [&>svg]:w-5` keeps the icon a
          consistent size regardless of the SVG passed in. */}
      <span
        className={cn(
          'flex h-12 w-12 flex-none items-center justify-center rounded-full [&>svg]:h-5 [&>svg]:w-5',
          badgeClass,
        )}
        aria-hidden="true"
      >
        {icon}
      </span>

      <div className="flex min-w-0 flex-col justify-center">
        <p className="flex items-center gap-2 text-fs-sm font-medium text-ink-muted">
          <span className="truncate">{title}</span>
          {band ? (
            <span className={cn('band-chip', chipClassForBand(band))}>
              {BAND_TAG_LABEL[band]}
            </span>
          ) : null}
        </p>
        <span
          data-band={band ?? undefined}
          className={cn(
            'text-fs-lg font-bold leading-tight tabular-nums',
            valueColorClass,
          )}
        >
          {valueNode}
        </span>
        {/* `sub` is a <div> (not <p>): callers pass block content like the
            <DeltaLine> (a flex <div>) or the provenance/override flags, so a
            <p> wrapper would produce invalid <p><div/></p> nesting. */}
        {sub ? (
          <div className="mt-0.5 text-fs-xs font-medium text-ink-muted">{sub}</div>
        ) : null}
      </div>
    </Card>
  );
}
