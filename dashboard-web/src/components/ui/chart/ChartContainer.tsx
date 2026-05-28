import { type ReactElement, type CSSProperties } from 'react';
import { ResponsiveContainer } from 'recharts';
import { cn } from '@/lib/utils';

/**
 * shadcn-style chart container. Wraps Recharts' `ResponsiveContainer`
 * and applies the chart-surface CSS vars (`--chart-grid`,
 * `--chart-axis`, `--chart-cursor`, `--chart-target`) so descendant
 * SVG elements can pull color values that respect the active
 * light/dark theme.
 *
 * Sizing model: pass an explicit `height` (px). For fluid sizing, set
 * the outer wrapper's height via `className` and pass `height="100%"`
 * (string) — Recharts honors percentage heights when its parent has a
 * concrete pixel height.
 */
export function ChartContainer({
  children,
  className,
  style,
  height,
  ...rest
}: {
  children: ReactElement;
  className?: string;
  style?: CSSProperties;
  /** Chart pixel height OR the string "100%" for fluid sizing. */
  height: number | string;
} & Omit<React.HTMLAttributes<HTMLDivElement>, 'style' | 'children'>) {
  const cssVars: CSSProperties = {
    // shadcn chart token surface. The right side must be a REAL CSS-var
    // name from globals.css, NOT a Tailwind utility name. Pre-flight
    // verified these exist:
    //   --border-subtle, --text-muted, --border-strong, --status-green.
    ['--chart-grid' as never]: 'var(--border-subtle)',
    ['--chart-axis' as never]: 'var(--text-muted)',
    ['--chart-cursor' as never]: 'var(--border-strong)',
    ['--chart-target' as never]: 'var(--status-green)',
  };

  return (
    <div
      className={cn('w-full', className)}
      style={{ ...cssVars, ...style }}
      {...rest}
    >
      <ResponsiveContainer width="100%" height={height}>
        {children}
      </ResponsiveContainer>
    </div>
  );
}
