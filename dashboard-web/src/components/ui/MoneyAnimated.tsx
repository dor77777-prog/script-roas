'use client';

import { cn } from '@/lib/utils';
import { useCountUp } from '@/lib/hooks/useCountUp';
import { formatMetricValue, type MetricFormatOpts } from '@/lib/metricFormat';

export interface MoneyAnimatedProps extends MetricFormatOpts {
  value: number | null | undefined;
  className?: string;
  /** Animation duration in ms. Default 900 (matches the approved mockup). */
  durationMs?: number;
}

/**
 * Count-up variant of `<Money>`. The painted text is the ANIMATING frame
 * (formatted with the same opts each frame), while `title` + the `sr-only`
 * span always carry the EXACT FINAL value — so the overflow-recovery
 * affordance and screen-reader output never expose the mid-flight number.
 * The compaction decision is taken from the FINAL value so a 7-digit target
 * reserves its compact width up front and the cell never reflows as it climbs.
 *
 * Split into its own `'use client'` module so the plain `<Money>` stays a pure
 * component (no hooks → renderable anywhere); only this animated path opts into
 * the rAF hook, and only at the handful of call sites that pass `countUp`.
 */
export function MoneyAnimated({
  value,
  className,
  durationMs,
  ...opts
}: MoneyAnimatedProps) {
  const animated = useCountUp(value, { durationMs });
  const isEmpty = value == null || Number.isNaN(value);
  const finalFmt = formatMetricValue(value, opts);
  const frameFmt = formatMetricValue(animated, opts);
  return (
    <bdi
      dir="ltr"
      className={cn('metric-num', className)}
      // eslint-disable-next-line local/no-native-title-tooltip -- overflow-recovery exact value (final, not the animating frame)
      title={finalFmt.compacted ? finalFmt.full : undefined}
    >
      {isEmpty ? '—' : frameFmt.display}
      {finalFmt.compacted && <span className="sr-only">{finalFmt.full}</span>}
    </bdi>
  );
}
