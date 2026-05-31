/**
 * Task 3.6 — <FreshnessBadge> primitive.
 *
 * Thin presentational wrapper over `useStaleness` from
 * `lib/freshness/useStaleness.ts` (Task 1.4). Renders the
 * `.fresh-chip.{live|aging|stale}` chip defined in globals.css
 * (Task 1.4), with a pulsing `.pulse` dot ONLY on the fresh stage.
 *
 * The stage→class mapping is deliberate: the hook returns
 * `'fresh'|'aging'|'stale'` while the CSS uses `.fresh-chip.live`
 * for the fresh state (matches the in-product "LIVE" label).
 *
 * Inputs:
 *   • `updatedAt`  — accepts the same `StalenessInput` shape as
 *     `useStaleness`: a single ISO timestamp string, `null`, or a
 *     per-platform `Record<string, string|null|undefined>` (Meta /
 *     Google / TikTok). When a per-platform record is passed and one
 *     platform is stuck, the chip surfaces the worst-platform label
 *     ("TikTok stuck · 1h 47min") instead of the generic stage label.
 *
 * The companion <Card freshness="…"> prop (Task 2.4) is what drives
 * the surface desaturation. This badge is meant to be RENDERED INSIDE
 * the same card, so the operator sees both signals at once: a stale
 * card visibly dims AND surfaces a STALE chip in its header.
 *
 * Wave 3 consumers wire the same `useStaleness(updatedAt).stage` into
 * `<Card freshness=…>` so the chip and the desaturation always agree.
 * If you call <FreshnessBadge> without also threading the freshness
 * onto the surrounding Card, you'll have a chip that says STALE on a
 * fully-saturated card — they should always move together.
 */

import { useStaleness, type StalenessInput, type FreshnessStage } from '@/lib/freshness/useStaleness';
import { cn } from '@/lib/utils';

export interface FreshnessBadgeProps {
  /**
   * Source timestamp. Accepts a single ISO string, null/undefined, or a
   * per-platform record. See `StalenessInput` in useStaleness.ts.
   */
  updatedAt: StalenessInput;
  className?: string;
  /** Optional data-testid; defaults to "freshness-badge". */
  testId?: string;
}

/** Map hook stage → CSS chip variant. `'fresh'` uses the `.live` class. */
function stageToChipClass(stage: FreshnessStage): 'live' | 'aging' | 'stale' {
  return stage === 'fresh' ? 'live' : stage;
}

export function FreshnessBadge({
  updatedAt,
  className,
  testId = 'freshness-badge',
}: FreshnessBadgeProps) {
  const { stage, label, worstLabel } = useStaleness(updatedAt);
  // When a per-platform record produced a worst-platform string
  // ("TikTok stuck · 1h 47min") prefer that — it carries more signal
  // than the generic stage label.
  const display = worstLabel ?? label;
  const chipCls = stageToChipClass(stage);

  return (
    <span
      className={cn('fresh-chip', chipCls, className)}
      data-testid={testId}
      data-stage={stage}
    >
      {stage === 'fresh' && <span className="pulse" aria-hidden="true" />}
      {/* worstLabel mixes a platform name + duration ("TikTok stuck · 1h 47min")
          while `label` for the live stage carries an LTR clock value ("08:42").
          Wrap in <bdi dir="ltr"> so the chip content doesn't bidi-flip when
          rendered inside the RTL document — Hebrew text outside the chip
          stays unaffected. */}
      <bdi dir="ltr">{display}</bdi>
    </span>
  );
}
