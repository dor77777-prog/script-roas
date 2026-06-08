import { cn } from '@/lib/utils';
import { PlatformBadge } from '@/components/ui/PlatformBadge';
import {
  describeSource,
  firstClickPlatformLabel,
  isWeakSource,
  PLATFORM_HE,
  type SourceDescription,
} from '@/lib/sourceLabels';

/**
 * Per-event attribution badge for the activity feed (classify-v2 T3).
 *
 * The operator's headline ask: present the classification ACCURATELY next to
 * each event — paid vs organic, and FROM WHERE. The pre-T3 badge collapsed all
 * of that: meta-paid and meta-organic rendered the SAME Meta chip, and
 * email / other-paid / other-referral / direct all became one generic "ישיר".
 *
 * This redesign decomposes `source` via `describeSource()` (the shared
 * sourceLabels vocabulary — one source of truth with the AI report's
 * SOURCE_LABEL):
 *
 *   • Platform sources (meta/google/tiktok · paid/organic) render the canonical
 *     <PlatformBadge> brand identity PLUS a ממומן/אורגני qualifier. Paid vs
 *     organic is BOTH textual (the Hebrew word — so never color-only) AND visual
 *     (paid = FILLED glowing dot + solid glass chip; organic = hollow RING dot +
 *     outline chip).
 *   • Non-platform sources each get their OWN distinct neutral chip
 *     (אימייל / ממומן · אחר / הפניה / חיפוש אורגני / הפניה מאפליקציה / ישיר) —
 *     no longer all collapsed to "ישיר".
 *   • null / '' → renders nothing (refunds / unknown).
 *
 * First-click LENS: when the last-touch `source` is WEAK (direct / other-referral
 * / other-paid) AND `firstTouchSource` carries a platform value, a small SECONDARY
 * muted chip "קליק ראשון: {platform}" follows the primary, so the operator sees
 * "looked direct, but the first click was Meta." Suppressed when the source is
 * already a confident attribution (redundant) or first-touch has no platform.
 *
 * Token-only (chart-platform brand tokens via PlatformBadge; glass/ink/border
 * tokens otherwise — no raw hex). AA in both themes: the brand text + qualifier
 * sit on the neutral glass surface (not on a vivid fill), so both the filled and
 * outline variants clear AA the same way the existing PlatformBadge does.
 * RTL-safe, compact, overflow-safe (whitespace-nowrap).
 *
 * `className` is forwarded to the outer wrapper so callers can add e.g.
 * `shrink-0` for flex-row safety on narrow viewports.
 */
export function SourceBadge({
  source,
  firstTouchSource,
  className,
}: {
  source: string | null | undefined;
  firstTouchSource?: string | null;
  className?: string;
}) {
  const desc = describeSource(source);
  if (!desc) return null; // null / '' → nothing (refunds / unknown)

  // First-click lens: ONLY when last-touch is weak AND first-touch is a platform.
  const lensPlatform = isWeakSource(source)
    ? firstClickPlatformLabel(firstTouchSource)
    : null;

  return (
    <span className={cn('inline-flex items-center gap-1.5 whitespace-nowrap', className)}>
      <PrimaryChip desc={desc} />
      {lensPlatform && (
        <span
          data-testid="first-click-lens"
          // Secondary + subtle (outline chip, ink-secondary metadata tier — the
          // same legibility tier as the row's store chip) so the primary stays
          // dominant while the lens still clears AA on the glass surface.
          className="inline-flex items-center rounded-full border border-glass-edge bg-glass-1 px-1.5 py-0.5 text-[10px] font-semibold text-ink-secondary whitespace-nowrap"
        >
          קליק ראשון: {lensPlatform}
        </span>
      )}
    </span>
  );
}

/** Per-platform brand-color class (mirrors PlatformBadge's PLATFORM_COLOR). */
const PLATFORM_RING_COLOR: Record<'meta' | 'google' | 'tiktok', string> = {
  meta: 'text-chart-meta',
  google: 'text-chart-google',
  tiktok: 'text-chart-tiktok',
};

/** The primary attribution chip — platform identity + paid/organic, or a neutral chip. */
function PrimaryChip({ desc }: { desc: SourceDescription }) {
  // Platform sources: brand identity (PlatformBadge) + qualifier. Paid = filled
  // glowing dot + solid glass chip; organic = hollow ring dot + outline chip.
  if (desc.platform) {
    const isPaid = desc.kind === 'paid';
    return (
      <span
        data-testid="source-badge"
        className={cn(
          'inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 whitespace-nowrap',
          isPaid
            ? 'bg-glass-2 border border-transparent'
            : 'bg-transparent border border-glass-edge',
        )}
      >
        {/* The qualifier word carries the paid/organic distinction in TEXT (never
            color-only). Slightly stronger ink for paid, secondary for organic. */}
        <span
          className={cn(
            'text-[10.5px] font-bold',
            isPaid ? 'text-ink-secondary' : 'text-ink-muted',
          )}
        >
          {desc.kind === 'organic' ? 'אורגני' : 'ממומן'}
        </span>
        {/* PlatformBadge supplies the brand-mirrored color + name. For PAID we
            keep its filled glowing dot; for ORGANIC we hide it and draw a hollow
            RING dot (the platform brand color via border-current) so the dot
            itself also reads paid-vs-organic at a glance. */}
        {!isPaid && (
          <span
            className={cn(
              'inline-block w-2 h-2 rounded-full border-[1.5px] border-current bg-transparent shrink-0',
              PLATFORM_RING_COLOR[desc.platform],
            )}
            aria-hidden
          />
        )}
        {/* Hebrew platform name (מטא/גוגל/טיקטוק) from the shared vocabulary,
            rendered through PlatformBadge so it keeps the brand-mirrored color
            (and, for paid, the filled glowing dot). One vocabulary: the same
            PLATFORM_HE atom the report's SOURCE_LABEL composes from. */}
        <PlatformBadge
          platform={desc.platform}
          size="sm"
          showDot={isPaid}
          label={PLATFORM_HE[desc.platform]}
        />
      </span>
    );
  }

  // Non-platform sources: each a distinct neutral chip. `direct` is muted; the
  // rest are neutral. The Hebrew label already differs per source.
  return (
    <span
      data-testid="source-badge"
      className={cn(
        'inline-flex items-center rounded-full px-2 py-0.5 text-[10.5px] font-bold whitespace-nowrap',
        desc.tone === 'muted'
          ? 'bg-glass-2 text-ink-subtle'
          : 'bg-glass-2 text-ink-secondary',
      )}
    >
      {desc.label}
    </span>
  );
}
