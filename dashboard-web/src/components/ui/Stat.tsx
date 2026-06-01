// dashboard-web/src/components/ui/Stat.tsx
//
// Wave-2 Task 2.3 — unified stat-block primitive. Replaces 5 local forks:
//   • Stat() in CampaignsTable.tsx  (interactive, prefix, chip, active)
//   • Stat() in AdsDrawer.tsx       (totals strip)
//   • DrawerStat() in CampaignDrawer.tsx (primary + compact tiers, prefix, chip)
//   • Stat() in ProductsTable.tsx   (subtitle, primary highlight)
//   • FloatingKpi() in HeroOverview.tsx (hero density, value prefix, delta line)
//
// Value content is auto-bdi-wrapped for safe Hebrew+English mixing.
// Glass treatment per Wave-1 tokens: bg-glass-2 / border-glass-edge /
// shadow-glass / rounded-card.
//
// API surface (CVA variants):
//   tone     — neutral | warning | success | danger     (border + bg tint)
//   density  — compact | regular | hero                 (font scale + padding)
//   accent   — positive | negative | attention          (value text color)
//   active   — boolean                                  (pressed/open emphasis)
//
// Slots:
//   label    — required, string
//   value    — required, string | number | ReactNode
//   prefix   — optional, ReactNode (e.g. "CAD" before number)
//   chip     — optional, ReactNode (pass a <Badge> or text pill)
//   delta    — optional, ReactNode (pass a DeltaPill or trend indicator)
//   help     — optional, ReactNode (rendered to the right of label)
//   subtitle — optional, ReactNode (small caption below value)
//
// Interactive: pass `onClick` and the card becomes a <button> with
// `aria-pressed={active}`. Use `active` purely for visual emphasis when
// non-interactive.

import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';
import type { ReactNode } from 'react';

const statVariants = cva(
  // Glass treatment baseline. Border colour is overridden by `tone`.
  'rounded-card border bg-glass-2 shadow-glass flex flex-col text-start',
  {
    variants: {
      tone: {
        neutral: 'border-glass-edge',
        warning: 'border-status-warning bg-status-warningBg',
        success: 'border-status-green bg-status-greenBg',
        danger:  'border-status-red bg-status-redBg',
      },
      density: {
        // Padding + intra-row gap. Hero is intentionally chrome-less for the
        // top-of-page floating KPI strip — no padding, no border, no shadow
        // (the parent container provides hairline dividers instead).
        compact: 'px-2.5 py-2 gap-0.5',
        regular: 'px-3 py-2 gap-1',
        hero:    'p-0 gap-1.5 border-0 bg-transparent shadow-none rounded-none',
      },
      active: {
        // Accent emphasis via alpha-safe tokens: border-accent (solid rim),
        // bg-accent-soft (alpha-baked wash). Flat `accent/NN` would silently
        // drop its alpha (the token has no <alpha-value> channel).
        true:  'border-accent ring-1 ring-[color:var(--accent-soft)] bg-accent-soft',
        false: '',
      },
      interactive: {
        true:  'cursor-pointer transition-colors hover:border-accent hover:bg-accent-bg focus-visible:outline-none',
        false: '',
      },
    },
    defaultVariants: { tone: 'neutral', density: 'regular', active: false, interactive: false },
  },
);

const labelVariants = cva('text-ink-muted leading-tight', {
  variants: {
    density: {
      compact: 'text-[10px] uppercase tracking-wide',
      regular: 'text-[10px] sm:text-xs',
      hero:    'text-[11px] sm:text-xs uppercase tracking-[0.12em] font-semibold text-ink-secondary',
    },
  },
  defaultVariants: { density: 'regular' },
});

const valueVariants = cva('tabular-nums leading-tight', {
  variants: {
    density: {
      compact: 'text-sm font-semibold',
      regular: 'text-sm sm:text-base font-semibold',
      hero:    'text-[1.5rem] sm:text-[2rem] md:text-[2.25rem] font-light tracking-tight',
    },
    accent: {
      neutral:   'text-ink',
      positive:  'text-status-greenFg',
      negative:  'text-status-redFg',
      attention: 'text-accent',
    },
  },
  compoundVariants: [
    // Hero density tints negative values amber (not red) — matches the
    // original FloatingKpi behaviour: hero is informational, red is reserved
    // for actionable failures.
    { density: 'hero', accent: 'negative', class: 'text-status-orangeFg' },
    { density: 'hero', accent: 'neutral',  class: 'text-ink' },
    { density: 'hero', accent: 'positive', class: 'text-ink' },
  ],
  defaultVariants: { density: 'regular', accent: 'neutral' },
});

type StatVariantProps = VariantProps<typeof statVariants>;

export interface StatProps {
  label: string;
  value: ReactNode;
  /** Optional inline prefix rendered before the value (e.g. "CAD"). */
  prefix?: ReactNode;
  /** Optional chip rendered in the header row (e.g. a <Badge>). */
  chip?: ReactNode;
  /** Optional delta / trend pill rendered below the value. */
  delta?: ReactNode;
  /** Optional helper node rendered to the right of the label. */
  help?: ReactNode;
  /** Optional small caption below the value (e.g. "−4.2% הנחות"). */
  subtitle?: ReactNode;
  /** Render as a <button> with aria-pressed={active}. */
  onClick?: () => void;
  /** Visual pressed/open state. Pair with onClick for buttons. */
  active?: boolean;
  tone?: StatVariantProps['tone'];
  density?: StatVariantProps['density'];
  accent?: 'neutral' | 'positive' | 'negative' | 'attention';
  className?: string;
}

export function Stat({
  label,
  value,
  prefix,
  chip,
  delta,
  help,
  subtitle,
  onClick,
  active = false,
  tone,
  density = 'regular',
  accent = 'neutral',
  className,
}: StatProps) {
  const interactive = !!onClick;
  const rootClass = cn(
    statVariants({ tone, density, active, interactive }),
    className,
  );

  const body = (
    <>
      <div className="flex items-center justify-between gap-2">
        <span className={labelVariants({ density })}>{label}</span>
        {help}
      </div>
      <div className="flex items-baseline gap-1.5">
        {prefix && (
          <span className="text-[10px] sm:text-xs text-ink-muted font-medium shrink-0">
            {prefix}
          </span>
        )}
        <bdi dir="ltr" className={valueVariants({ density, accent })}>
          {value}
        </bdi>
      </div>
      {chip && <div className="mt-1">{chip}</div>}
      {delta && <div className="mt-0.5">{delta}</div>}
      {subtitle && (
        <div className="text-[9px] sm:text-[10px] text-ink-muted leading-tight mt-0.5">
          {subtitle}
        </div>
      )}
    </>
  );

  if (interactive) {
    return (
      <button
        type="button"
        onClick={onClick}
        aria-pressed={active}
        className={rootClass}
      >
        {body}
      </button>
    );
  }
  return <div className={rootClass}>{body}</div>;
}
