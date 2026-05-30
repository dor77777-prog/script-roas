import { forwardRef, type HTMLAttributes } from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

export const BADGE_TONE_BG = {
  red:     'bg-status-redBg text-status-redFg',
  orange:  'bg-status-orangeBg text-status-orangeFg',
  green:   'bg-status-greenBg text-status-greenFg',
  blue:    'bg-status-blueBg text-status-blueFg',
  gray:    'bg-status-grayBg text-status-grayFg',
  warning: 'bg-status-warningBg text-status-warningFg',
} as const;

export type BadgeTone = keyof typeof BADGE_TONE_BG;

const badgeVariants = cva(
  'inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-2xs font-semibold tabular-nums',
  {
    variants: {
      tone: Object.fromEntries(
        Object.entries(BADGE_TONE_BG).map(([k, v]) => [k, v])
      ) as Record<BadgeTone, string>,
    },
    defaultVariants: { tone: 'gray' },
  },
);

export interface BadgeProps
  extends HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

export const Badge = forwardRef<HTMLSpanElement, BadgeProps>(
  ({ className, tone, ...props }, ref) => (
    <span ref={ref} className={cn(badgeVariants({ tone }), className)} {...props} />
  ),
);
Badge.displayName = 'Badge';
