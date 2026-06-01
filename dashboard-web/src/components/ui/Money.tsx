import { cn } from '@/lib/utils';
import { formatMetricValue, type MetricFormatOpts } from '@/lib/metricFormat';

export interface MoneyProps extends MetricFormatOpts {
  value: number | null | undefined;
  /** Extra classes for the <bdi> (color/size overrides live at the call site). */
  className?: string;
}

/**
 * Overflow-safe money. Paints a compact value when the full one would exceed
 * the reserved width, but always carries the EXACT value in `title` + an
 * sr-only span so nothing is ever lost. RTL-isolated via <bdi dir="ltr">.
 */
export function Money({ value, className, ...opts }: MoneyProps) {
  const { display, full, compacted } = formatMetricValue(value, opts);
  // `title` below is NOT a hover tooltip: it's the overflow-recovery
  // affordance. When the value is compacted ($7.5M), the native title surfaces
  // the EXACT amount on hover without portalling a Radix card onto every dense
  // table cell; the sr-only span carries the same value for screen readers.
  // (Wave C2 — this specific use is exempt from local/no-native-title-tooltip.)
  return (
    <bdi
      dir="ltr"
      className={cn('metric-num', className)}
      // eslint-disable-next-line local/no-native-title-tooltip -- overflow-recovery exact value, see note above
      title={compacted ? full : undefined}
    >
      {display}
      {compacted && <span className="sr-only">{full}</span>}
    </bdi>
  );
}
