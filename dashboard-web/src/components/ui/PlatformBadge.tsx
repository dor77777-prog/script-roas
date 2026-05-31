import { forwardRef, type HTMLAttributes } from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { ShoppingBag } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * Task 2.9 — PlatformBadge primitive.
 *
 * The pre-Wave-2 codebase open-coded the same "colored dot + platform
 * label" pattern in multiple sites: `PlatformChip` in CampaignsTopList,
 * `cpm-plat`-style breakdowns in TodayLive, the chart legend in
 * MetaShopifyReconciliation, and ad-hoc inline spans elsewhere. Each
 * site picked its own colors from the band/status palette
 * (`bg-status-blue` for Meta etc.) instead of the canonical
 * brand-mirrored `--chart-platform-*` tokens, so they drifted from the
 * chart palette every time the chart hues moved.
 *
 * This primitive collapses every "platform identity" surface into one
 * CVA-driven span with two visual parts:
 *
 *   1. A 8 × 8 colored dot (`rounded-full` + neon glow via
 *      `box-shadow: 0 0 8px currentColor`) — same shape as the
 *      mockup-04-final.html `.cpm-plat .gd` rule (lines 234-238).
 *   2. The platform label in the same color, sharing the dot's
 *      currentColor so the glow + text always match the dot.
 *
 * Every platform color routes through `--chart-platform-{meta|google|
 * tiktok|organic|shopify}` (Q1 brand-mirrored locked tokens). This is
 * the ONLY component allowed to bind those tokens to typography — chart
 * consumers still go via `chartColors.ts`. The exemption is intentional:
 * the badge IS the brand-identity surface, so consuming the same token
 * the chart lines use keeps the legend ↔ table ↔ live-card colors in
 * perfect lockstep.
 *
 * Shopify is treated as the "e-commerce category" not an ad platform —
 * per the visual-direction Q4 decision — so its badge gets a small
 * ShoppingBag icon prefix in front of the dot. Operators reading a
 * mixed legend can disambiguate the source-of-truth (Shopify) from the
 * paid claims (Meta / Google / TikTok / Organic) at a glance.
 *
 * Casing tolerance: data in `campaigns_daily.platform` may come in as
 * 'Meta', 'meta', or 'META'. `normalizePlatform` lower-cases + maps
 * common aliases (e.g. 'facebook'→'meta', 'fb'→'meta') so callers can
 * pass any of them safely. If the value is unrecognised the primitive
 * still renders, falling back to the `organic` color stop + label
 * literal (so an unknown platform shows the raw string rather than
 * silently disappearing).
 */

export const PLATFORM_LABEL = {
  meta:    'Meta',
  google:  'Google',
  tiktok:  'TikTok',
  organic: 'Organic',
  shopify: 'Shopify',
} as const;

export type Platform = keyof typeof PLATFORM_LABEL;

const PLATFORM_ALIASES: Record<string, Platform> = {
  meta:      'meta',
  facebook:  'meta',
  fb:        'meta',
  google:    'google',
  googleads: 'google',
  ga:        'google',
  tiktok:    'tiktok',
  tt:        'tiktok',
  organic:   'organic',
  shopify:   'shopify',
};

/**
 * Lower-case + map common aliases to the canonical platform key. Returns
 * `null` when the input does not match any known platform (caller may
 * choose to short-circuit or fall back).
 */
export function normalizePlatform(raw: string): Platform | null {
  const k = raw.trim().toLowerCase();
  return PLATFORM_ALIASES[k] ?? null;
}

/** Per-platform foreground color (drives dot bg, text color, glow). */
const PLATFORM_COLOR: Record<Platform, string> = {
  meta:    'text-chart-meta',
  google:  'text-chart-google',
  tiktok:  'text-chart-tiktok',
  organic: 'text-chart-organic',
  shopify: 'text-chart-shopify',
};

const platformBadgeVariants = cva(
  'inline-flex items-center gap-1.5 font-semibold whitespace-nowrap',
  {
    variants: {
      size: {
        sm: 'h-5 text-xs',
        md: 'h-6 text-sm',
      },
    },
    defaultVariants: { size: 'sm' },
  },
);

export interface PlatformBadgeProps
  extends Omit<HTMLAttributes<HTMLSpanElement>, 'children'>,
    VariantProps<typeof platformBadgeVariants> {
  /** Canonical platform key OR any common alias (e.g. 'Meta', 'facebook'). */
  platform: Platform | (string & {});
  /** Show the colored dot (default true). */
  showDot?: boolean;
  /** Show the platform label (default true). */
  showLabel?: boolean;
  /** Optional override label (e.g. localized) — falls back to PLATFORM_LABEL. */
  label?: string;
  className?: string;
}

export const PlatformBadge = forwardRef<HTMLSpanElement, PlatformBadgeProps>(
  (
    {
      platform,
      size,
      showDot = true,
      showLabel = true,
      label,
      className,
      ...rest
    },
    ref,
  ) => {
    const normalized = normalizePlatform(String(platform));
    const colorClass = normalized
      ? PLATFORM_COLOR[normalized]
      : 'text-ink-secondary';
    const resolvedLabel =
      label ?? (normalized ? PLATFORM_LABEL[normalized] : String(platform));

    return (
      <span
        ref={ref}
        className={cn(
          platformBadgeVariants({ size }),
          colorClass,
          className,
        )}
        {...rest}
      >
        {/* Shopify is an e-commerce category, not an ad platform (Q4).
            The cart icon prefix calls that out so operators scanning a
            mixed legend can tell the source-of-truth apart from the
            paid claims. Other platforms skip the icon. */}
        {normalized === 'shopify' && (
          <ShoppingBag
            size={size === 'md' ? 14 : 12}
            className="shrink-0"
            aria-hidden
          />
        )}
        {showDot && (
          <span
            className="inline-block w-2 h-2 rounded-full shrink-0 bg-current"
            // `box-shadow: 0 0 8px currentColor` produces the neon glow
            // from the mockup's `.cpm-plat .gd` rule. Tailwind can't
            // express this via a utility because it needs `currentColor`
            // (so the dot's glow tracks the platform color via the
            // parent's text-chart-* class) — inline style is the
            // shortest correct path.
            style={{ boxShadow: '0 0 8px currentColor' }}
            aria-hidden
          />
        )}
        {showLabel && <span>{resolvedLabel}</span>}
      </span>
    );
  },
);
PlatformBadge.displayName = 'PlatformBadge';
