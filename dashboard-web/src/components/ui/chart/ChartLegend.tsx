import { type ReactNode } from 'react';
import { cn } from '@/lib/utils';

/**
 * shadcn-style chart legend. Consumers wrap a list of `<ChartLegendItem>`
 * children in `<ChartLegend>`. Used by RoasChart's multi-store view and
 * any future multi-series chart in the dashboard.
 *
 * Sits OUTSIDE the Recharts chart (typically below or to the side) so
 * consumers control placement. The primitive is just chrome — no
 * interaction, no toggling, no Recharts integration.
 */
export function ChartLegend({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'flex flex-wrap items-center gap-x-4 gap-y-1.5',
        'text-xs text-ink-secondary',
        className,
      )}
    >
      {children}
    </div>
  );
}

export function ChartLegendItem({
  color,
  label,
  className,
}: {
  color: string;
  label: ReactNode;
  className?: string;
}) {
  return (
    <span className={cn('inline-flex items-center gap-1.5', className)}>
      <span
        data-swatch="true"
        className="inline-block w-2.5 h-2.5 rounded-full shrink-0"
        style={{ backgroundColor: color }}
        aria-hidden
      />
      <span>{label}</span>
    </span>
  );
}
