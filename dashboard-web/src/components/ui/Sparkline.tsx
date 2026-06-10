import { useMemo } from 'react';
import { cn } from '@/lib/utils';
import { computeSparklineGeometry } from '@/lib/sparklineGeometry';

/**
 * Tiny inline sparkline. No Recharts dependency — pure SVG path so it
 * renders cheap inside table rows. Tone maps to the same ROAS palette.
 */
export interface SparklineProps {
  data: number[];
  width?: number;
  height?: number;
  tone?: 'green' | 'red' | 'orange' | 'blue' | 'gray';
  className?: string;
  /** When the sparkline sits on a NEUTRAL card (in this scrim mode), render a
   *  neutral plot scrim + a stroke casing so the line never collides with the
   *  surface. For a VIVID band slab use `bandInk` instead (white-on-casing). */
  onBand?: boolean;
  /**
   * When the sparkline sits DIRECTLY on a VIVID band slab (per-store mobile B1
   * spark), render a bright white line on a dark casing halo and NO neutral
   * scrim rect — so the line stays legible on any band without masking the
   * band colour. Overrides `tone`/`onBand`. The direction signal lives in the
   * adjacent coloured delta chip.
   */
  bandInk?: boolean;
}

const TONE_STROKE: Record<NonNullable<SparklineProps['tone']>, string> = {
  green:  'var(--status-green)',
  red:    'var(--status-red)',
  orange: 'var(--status-orange)',
  blue:   'var(--status-blue)',
  gray:   'var(--status-gray)',
};

export function Sparkline({
  data,
  width = 60,
  height = 16,
  tone = 'blue',
  className,
  onBand,
  bandInk,
}: SparklineProps) {
  const path = useMemo(() => {
    if (data.length === 0) return '';
    // c/HI-05 (audit-2026-05-23-v2, finally wired 2026-06-10): the previous
    // inline math used `range = max - min || 1`, which pinned an all-equal
    // series to the BOTTOM of the box — a constant ROAS of 3.0 read as
    // "crashed to zero". computeSparklineGeometry treats the degenerate
    // range as a first-class case and centers the flat line vertically.
    const { points } = computeSparklineGeometry(data, width, height, 0);
    return points
      .map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(2)},${p.y.toFixed(2)}`)
      .join(' ');
  }, [data, width, height]);

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      // bandInk sparks fill their flex container (per-store mobile B1 row), so
      // stretch the viewBox horizontally; neutral/table sparks keep their fixed
      // aspect so dense rows render identically to before.
      preserveAspectRatio={bandInk ? 'none' : undefined}
      className={cn('overflow-visible', bandInk && 'w-full', className)}
      role="img"
      aria-label="טרנד"
    >
      {/* Neutral-card mode: plot scrim rect + casing. */}
      {onBand && !bandInk && (
        <rect x={0} y={0} width={width} height={height} fill="var(--plot-bg)" rx={3} />
      )}
      {onBand && !bandInk && (
        <path
          d={path}
          fill="none"
          stroke="var(--plot-bg)"
          strokeWidth={3}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      )}
      {/* Vivid-band mode: dark casing halo, no scrim (keeps the band visible). */}
      {bandInk && (
        <path
          d={path}
          fill="none"
          stroke="var(--spark-band-casing)"
          strokeWidth={3.5}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      )}
      <path
        d={path}
        fill="none"
        stroke={bandInk ? 'var(--spark-band-ink)' : TONE_STROKE[tone]}
        strokeWidth={bandInk ? 1.75 : 1.25}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
