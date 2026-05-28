import { type ReactNode } from 'react';
import { Sparkles } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * Tiny inline AI-generated context line. Used next to SectionIntro headers
 * to surface a sentence of context from the existing aiReport data without
 * the heavy modal experience. The component renders nothing when there's
 * no content so consumers can pass `null` safely.
 *
 * Render contract:
 *   - role="status" so screen readers announce non-disruptively.
 *   - Sparkles icon at the start (inline, before the text).
 *   - Subtle background (canvas/40) with a short start-side accent.
 *   - No close affordance — this is information, not a notification.
 */
export function AiInsightPill({
  children,
  className,
  ...rest
}: {
  children?: ReactNode;
  className?: string;
} & React.HTMLAttributes<HTMLDivElement>) {
  if (!children || (typeof children === 'string' && children.trim() === '')) {
    return null;
  }
  return (
    <div
      role="status"
      className={cn(
        'inline-flex items-start gap-1.5 rounded-md bg-canvas/40 border-s-2 border-accent/40',
        'px-2.5 py-1.5 text-xs leading-relaxed text-ink-secondary',
        className,
      )}
      {...rest}
    >
      <Sparkles size={12} className="shrink-0 mt-0.5 text-accent" aria-hidden />
      <span>{children}</span>
    </div>
  );
}
