import { cn } from '@/lib/utils';
import { formatMetricValue, type MetricFormatOpts } from '@/lib/metricFormat';
import { MoneyAnimated } from './MoneyAnimated';

export interface MoneyProps extends MetricFormatOpts {
  value: number | null | undefined;
  /** Extra classes for the <bdi> (color/size overrides live at the call site). */
  className?: string;
  /**
   * Opt into the count-up animation (climbs from 0 → value, eased, reduced-
   * motion aware). Off by default so the hundreds of dense table cells stay a
   * pure, hook-free render; only the marquee hero/store numbers opt in.
   */
  countUp?: boolean;
  /** Count-up duration in ms (only used when `countUp`). Default 900. */
  durationMs?: number;
}

/**
 * Overflow-safe money. Paints a compact value when the full one would exceed
 * the reserved width, but always carries the EXACT value in `title` + an
 * sr-only span so nothing is ever lost. RTL-isolated via <bdi dir="ltr">.
 *
 * When `countUp` is set it delegates to {@link MoneyAnimated} (the only path
 * that uses a hook). The branch is on a prop that is constant per call site, so
 * `Money` itself never calls a hook conditionally.
 */
export function Money({ value, className, countUp, durationMs, ...opts }: MoneyProps) {
  if (countUp) {
    return (
      <MoneyAnimated value={value} className={className} durationMs={durationMs} {...opts} />
    );
  }
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
