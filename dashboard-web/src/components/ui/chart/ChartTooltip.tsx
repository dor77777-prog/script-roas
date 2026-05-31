import { type ReactNode } from 'react';
import { cn } from '@/lib/utils';

/**
 * shadcn-style chart tooltip primitives. Consumers render these INSIDE
 * a Recharts `<Tooltip content={(...) => <ChartTooltip>...</ChartTooltip>}>`
 * function. The four sub-components map to the visual structure:
 *
 *   <ChartTooltip>                       — card chrome
 *     <ChartTooltipLabel />              — date / context line
 *     <ChartTooltipRow color="" label="">
 *       <ChartTooltipValue />            — numeric value with font-mono
 *     </ChartTooltipRow>
 *   </ChartTooltip>
 *
 * The card uses the new OKLCH tokens (bg-glass-1, border-glass-edge, shadow-overlay)
 * so it renders correctly in both light and dark themes.
 */
export function ChartTooltip({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      dir="rtl"
      className={cn(
        'rounded-lg bg-glass-1/95 border border-glass-edge text-ink',
        'px-3 py-2 text-xs shadow-overlay backdrop-blur-sm',
        'min-w-[160px]',
        className,
      )}
    >
      {children}
    </div>
  );
}

export function ChartTooltipLabel({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('text-ink-muted mb-1 text-[10px]', className)}>
      {children}
    </div>
  );
}

export function ChartTooltipRow({
  color,
  label,
  children,
  className,
}: {
  color: string;
  label: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex items-center gap-2 leading-relaxed', className)}>
      <span
        data-swatch="true"
        className="inline-block w-2 h-2 rounded-full shrink-0"
        style={{ backgroundColor: color }}
      />
      <span className="text-ink-secondary">{label}</span>
      <span className="ms-auto">{children}</span>
    </div>
  );
}

export function ChartTooltipValue({
  children,
  className,
  ...rest
}: {
  children: ReactNode;
  className?: string;
} & React.HTMLAttributes<HTMLElement>) {
  return (
    <bdi
      dir="ltr"
      className={cn('font-mono font-semibold text-ink', className)}
      {...rest}
    >
      {children}
    </bdi>
  );
}
