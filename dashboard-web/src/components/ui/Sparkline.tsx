import { useMemo } from 'react';
import { cn } from '@/lib/utils';

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
  /** When the sparkline sits on a NEUTRAL card, render a neutral plot scrim
   *  + a stroke casing so the line never collides with the surface. */
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
    const min = Math.min(...data);
    const max = Math.max(...data);
    const range = max - min || 1;
    const stepX = data.length > 1 ? width / (data.length - 1) : 0;
    return data
      .map((v, i) => {
        const x = i * stepX;
        const y = height - ((v - min) / range) * height;
        return `${i === 0 ? 'M' : 'L'}${x.toFixed(2)},${y.toFixed(2)}`;
      })
      .join(' ');
  }, [data, width, height]);

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className={cn('overflow-visible', className)}
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
