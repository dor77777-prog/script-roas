import { type ReactElement, type CSSProperties } from 'react';
import { ResponsiveContainer } from 'recharts';
import { CHART_TARGET_COLOR } from '@/lib/chartColors';
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
 *
 * Bidi default (Wave 4 / Task 4.6): the wrapper defaults to
 * `dir="ltr"`. Recharts axes are chronological (date left → date right)
 * and tooltip/legend layout assumes LTR coordinate math, so consumers
 * inside RTL pages would otherwise have to thread `dir="ltr"` per call
 * site. Callers may still override via the `dir` prop when they want
 * the wrapper to inherit the document direction (e.g. a sparkline that
 * deliberately mirrors with the surrounding text).
 */
export function ChartContainer({
  children,
  className,
  style,
  height,
  dir = 'ltr',
  ...rest
}: {
  children: ReactElement;
  className?: string;
  style?: CSSProperties;
  /** Chart pixel height OR "100%" for fluid sizing (template-literal type matches Recharts v3). */
  height: number | `${number}%`;
} & Omit<React.HTMLAttributes<HTMLDivElement>, 'style' | 'children'>) {
  const cssVars: CSSProperties = {
    // shadcn chart token surface. The right side must be a REAL CSS-var
    // name from globals.css, NOT a Tailwind utility name. Post-Task-1.2
    // the `--border-*` family is gone (Task-1.1 glass+neon flip); the
    // shadcn chart vars now route through --glass-edge / --text-muted
    // and import the band→chart bridge color from chartColors.ts so
    // local/no-cross-palette-import stays green.
    ['--chart-grid' as never]:   'var(--glass-edge)',
    ['--chart-axis' as never]:   'var(--text-muted)',
    ['--chart-cursor' as never]: 'var(--glass-edge-hot)',
    ['--chart-target' as never]: CHART_TARGET_COLOR,
  };

  return (
    <div
      className={cn('w-full', className)}
      style={{ ...cssVars, ...style }}
      dir={dir}
      {...rest}
    >
      <ResponsiveContainer width="100%" height={height}>
        {children}
      </ResponsiveContainer>
    </div>
  );
}
