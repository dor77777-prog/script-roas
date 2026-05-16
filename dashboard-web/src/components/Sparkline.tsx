'use client';

/**
 * Tiny SVG sparkline. ~1KB component, no charting library dependency,
 * intentionally minimal: a path + optional fill + optional target line +
 * optional last-point dot. Designed to sit next to a KPI value.
 *
 * "Bullet sparkline" = sparkline + reference line + endpoint highlight.
 * The reference line is the metric's target (e.g. ROAS 3.0). The endpoint
 * dot draws attention to "now" without animation.
 */

import { cn } from '@/lib/utils';

type Props = {
  /** Time-ordered values (oldest → newest). */
  values: number[];
  /** Optional reference line (e.g. target ROAS 3.0). */
  target?: number;
  width?: number;
  height?: number;
  /** Stroke color (defaults to currentColor — set via parent text color). */
  color?: string;
  /** Fill area under the line if true. */
  filled?: boolean;
  /** Highlight the last point with a dot. */
  showEndpoint?: boolean;
  className?: string;
  ariaLabel?: string;
};

export function Sparkline({
  values,
  target,
  width = 96,
  height = 28,
  color = 'currentColor',
  filled = false,
  showEndpoint = true,
  className,
  ariaLabel,
}: Props) {
  if (!values || values.length < 2) {
    return <span className={cn('inline-block', className)} aria-hidden style={{ width, height }} />;
  }

  const pad = 2; // px breathing room so the stroke doesn't kiss the edges
  const innerW = width - pad * 2;
  const innerH = height - pad * 2;

  const min = Math.min(...values, target ?? Infinity);
  const max = Math.max(...values, target ?? -Infinity);
  const range = max - min || 1;

  const xStep = innerW / (values.length - 1);
  const points = values.map((v, i) => {
    const x = pad + i * xStep;
    const y = pad + (1 - (v - min) / range) * innerH;
    return { x, y };
  });

  const pathD = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(2)} ${p.y.toFixed(2)}`).join(' ');
  // Closed path for fill: down to baseline, back to start.
  const areaD = `${pathD} L ${points[points.length - 1].x.toFixed(2)} ${(height - pad).toFixed(2)} L ${points[0].x.toFixed(2)} ${(height - pad).toFixed(2)} Z`;

  const targetY =
    target !== undefined ? pad + (1 - (target - min) / range) * innerH : null;

  const last = points[points.length - 1];

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className={cn('inline-block', className)}
      role={ariaLabel ? 'img' : 'presentation'}
      aria-label={ariaLabel}
    >
      {filled && (
        <path d={areaD} fill={color} fillOpacity={0.08} stroke="none" />
      )}
      {targetY !== null && (
        <line
          x1={pad}
          x2={width - pad}
          y1={targetY}
          y2={targetY}
          stroke={color}
          strokeOpacity={0.35}
          strokeWidth={1}
          strokeDasharray="3 3"
        />
      )}
      <path
        d={pathD}
        fill="none"
        stroke={color}
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {showEndpoint && (
        <circle cx={last.x} cy={last.y} r={2.5} fill={color} />
      )}
    </svg>
  );
}
