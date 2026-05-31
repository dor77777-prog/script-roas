/**
 * Task 3.5 — PageSynthesis primitive. Renders the authoritative Hebrew
 * TL;DR sentence directly under a page's H1 / SectionIntro, matching
 * Q6 ("the TL;DR is the headline, not a caption") from
 * [[home-visual-rules]].
 *
 * Behaviour:
 *   • text === '' → renders nothing (synthesisers return '' when
 *     confidence is 'low'; the page falls back to its existing
 *     description copy).
 *   • confidence === 'low' → opacity-60 so a guarded sentence still
 *     reads as second-class to the eye.
 *   • role="status" + aria-live="polite" so screen-reader users hear the
 *     TL;DR update naturally when filters change.
 *
 * The Home tab's TL;DR is owned by RoasTargetChart itself — never use
 * <PageSynthesis> on Home or the operator will see the same sentence
 * twice.
 */

import { cn } from '@/lib/utils';

export interface PageSynthesisProps {
  /** TL;DR sentence from a synthesiser. Empty string hides the node. */
  text: string;
  /** Optional anchor metric (unused visually for now; reserved for
   *  future band-tint integration matching synthesizeRoasChart). */
  anchorMetric?: number;
  /** 'low' dims the sentence to opacity-60. */
  confidence?: 'low' | 'high';
  className?: string;
}

export function PageSynthesis({
  text,
  confidence,
  className,
}: PageSynthesisProps) {
  if (!text) return null;
  return (
    <p
      className={cn(
        'mt-1 text-base font-medium leading-snug text-ink-secondary',
        confidence === 'low' && 'opacity-60',
        className,
      )}
      role="status"
      aria-live="polite"
      data-page-synthesis
    >
      {text}
    </p>
  );
}
