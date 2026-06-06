import { cn } from '@/lib/utils';
import { PlatformBadge } from '@/components/ui/PlatformBadge';

/** Map an OrderSource label to a paid/organic platform key, or null. */
function sourceToPlatform(source: string | null | undefined): 'meta' | 'google' | 'tiktok' | null {
  if (!source) return null;
  if (source.startsWith('meta')) return 'meta';
  if (source.startsWith('google')) return 'google';
  if (source.startsWith('tiktok')) return 'tiktok';
  return null;
}

/**
 * Per-event source/platform badge for the activity feed. Reuses the canonical
 * <PlatformBadge> (brand-mirrored chart-platform colors) for Meta/Google/TikTok;
 * shows a neutral "ישיר" chip for direct/other; renders NOTHING for null/empty
 * (refunds / unknown). Token-only, RTL-safe.
 *
 * `className` is forwarded to the outer wrapper span on BOTH render paths so
 * callers can e.g. add `shrink-0` for flex-row safety on narrow viewports.
 */
export function SourceBadge({ source, className }: { source: string | null | undefined; className?: string }) {
  if (!source) return null; // null or '' → nothing
  const platform = sourceToPlatform(source);
  if (platform) {
    return (
      <span data-testid="source-badge" className={cn(className)}>
        <PlatformBadge platform={platform} size="sm" />
      </span>
    );
  }
  return (
    <span
      data-testid="source-badge"
      className={cn(
        'inline-flex items-center rounded-full px-2 py-0.5 text-[10.5px] font-bold bg-glass-2 text-ink-secondary',
        className,
      )}
    >
      ישיר
    </span>
  );
}
