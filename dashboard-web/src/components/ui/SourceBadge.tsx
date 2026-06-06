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
 */
export function SourceBadge({ source }: { source: string | null | undefined }) {
  if (!source) return null; // null or '' → nothing
  const platform = sourceToPlatform(source);
  if (platform) {
    return (
      <span data-testid="source-badge">
        <PlatformBadge platform={platform} size="sm" />
      </span>
    );
  }
  return (
    <span
      data-testid="source-badge"
      className="inline-flex items-center rounded-full px-2 py-0.5 text-[10.5px] font-bold bg-glass-2 text-ink-secondary"
    >
      ישיר
    </span>
  );
}
