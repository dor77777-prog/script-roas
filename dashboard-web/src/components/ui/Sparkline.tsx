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
      <path
        d={path}
        fill="none"
        stroke={TONE_STROKE[tone]}
        strokeWidth={1.25}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
