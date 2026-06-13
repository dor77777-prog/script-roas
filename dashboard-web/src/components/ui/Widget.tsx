import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { Card } from './Card';
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
export interface WidgetProps {
  /** Lead icon — rendered inside the circular badge. */
  icon: ReactNode;
  /** Muted KPI label. */
  title: string;
  /** KPI value. A `number` renders through <Money>; anything else as-is. */
  value: ReactNode | number;
  /** Optional sub-line under the value (delta / context note). */
  sub?: ReactNode;
  /**
   * When supplied, classify this ROAS-like ratio through `bandForRoas` and
   * colour the value + badge + tag with the operator-locked band colour.
   */
  bandRoas?: number;
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
 *   • `badgeBg`— circular-badge fill = a low-alpha tint of the same token,
 *     mirroring the mockup's ~12%-alpha brand-tint badge but kept
 *     token-driven via `color-mix(... transparent)` (same recipe used
 *     across the app for tinted brand surfaces).
 */
const BAND_VALUE_CLASS: Record<CoreRoasBand, string> = {
  red: 'text-[var(--band-red)]',
  orange: 'text-[var(--band-orange)]',
  green: 'text-[var(--band-green)]',
  blue: 'text-[var(--band-blue)]',
  gray: 'text-[var(--band-gray)]',
};
const BAND_BADGE_CLASS: Record<CoreRoasBand, string> = {
  red: 'bg-[color-mix(in_oklab,var(--band-red)_14%,transparent)] text-[var(--band-red)]',
  orange:
    'bg-[color-mix(in_oklab,var(--band-orange)_14%,transparent)] text-[var(--band-orange)]',
  green:
    'bg-[color-mix(in_oklab,var(--band-green)_14%,transparent)] text-[var(--band-green)]',
  blue: 'bg-[color-mix(in_oklab,var(--band-blue)_14%,transparent)] text-[var(--band-blue)]',
  gray: 'bg-[color-mix(in_oklab,var(--band-gray)_12%,transparent)] text-[var(--band-gray)]',
};

export function Widget({
  icon,
  title,
  value,
  sub,
  bandRoas,
  className,
}: WidgetProps) {
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
    <Card className={cn('!flex-row items-center gap-4', className)}>
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
        <p className="flex items-center gap-2 text-sm font-medium text-ink-muted">
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
            'text-xl font-bold leading-tight tabular-nums',
            valueColorClass,
          )}
        >
          {valueNode}
        </span>
        {sub ? (
          <p className="mt-0.5 text-xs font-medium text-ink-muted">{sub}</p>
        ) : null}
      </div>
    </Card>
  );
}
