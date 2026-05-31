import { forwardRef, createElement, type HTMLAttributes, type ElementType, type Ref } from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

/**
 * Task 2.8 — Typography primitive (Heading + Text).
 *
 * The pre-Wave-2 codebase had 50+ raw `<h1>`/`<h2>`/`<h3>`/`<h4>` sites with
 * 5+ recurring `text-{size} font-{weight} text-ink` patterns. Each variant
 * was reinvented per-component which drifted the type ramp (~12 size/weight
 * permutations for "section header"). This primitive collapses those into a
 * 5-level `Heading` + 4-tone `Text` API mapped to the mockup-04-final type
 * ramp. Codemod sweeps the existing call sites in the same task; the lint
 * rule `local/no-raw-headings` (added separately) blocks regressions.
 *
 * Level → mockup mapping:
 *   • display — top-level page H1 (HeroOverview, PnLBreakdown title)
 *     Heebo 800 / ~28 px / -0.024em. Mockup-04-final.html H1.
 *   • hero    — secondary page H1 / large card title (InsightsBoard,
 *     AnnotationsPanel header).
 *   • section — section H2 inside a card or band (RoasChart title,
 *     CollapsibleSection, GoalTracker chrome). The most common shape.
 *   • panel   — H3 nested inside a card (CampaignDrawer subsections,
 *     AttributionAnalysisPanel, AdSetTable, MetaShopifyReconciliation).
 *   • label   — uppercase eyebrow / kicker (e.g. operator panel meta rows,
 *     small "STORE" / "PLATFORM" identifiers). Geist Mono, letter-spaced.
 *
 * Both components accept an `as` polymorphic prop so callers can keep the
 * correct semantic tag without forcing the visual level to match. E.g.
 * `<Heading as="h1" level="hero" />` renders an <h1> with the "hero" type
 * style; `<Text as="span" tone="muted" />` renders a <span> with muted ink.
 *
 * Defaults:
 *   • Heading without `as` picks a sensible tag per level (display→h1,
 *     hero→h1, section→h2, panel→h3, label→h4).
 *   • Text without `as` renders <p>.
 *
 * Both forward refs and merge `className` via `cn()` so callers can add
 * layout utilities (`mb-3`, `flex items-center gap-2`, etc.) without
 * re-declaring the type style.
 */

/* ----- Heading -------------------------------------------------------- */

const headingVariants = cva('text-ink', {
  variants: {
    level: {
      // Display — page H1 (Heebo 800 / 28 px / tight tracking)
      // Source: mockup-04-final.html `.brand-text` H1 spec.
      display: 'text-2xl sm:text-3xl font-extrabold tracking-tight leading-tight',
      // Hero — secondary page H1 / large card header
      hero:    'text-lg sm:text-xl font-bold tracking-tight leading-tight',
      // Section — H2 inside a card / band
      section: 'text-sm sm:text-base font-semibold tracking-tight leading-tight',
      // Panel — H3 nested inside a card
      panel:   'text-sm font-semibold leading-tight',
      // Label — eyebrow / kicker (Geist Mono, uppercase, letter-spaced)
      label:   'font-mono text-2xs font-semibold uppercase tracking-[0.08em] text-ink-secondary',
    },
  },
  defaultVariants: { level: 'section' },
});

export type HeadingLevel = NonNullable<VariantProps<typeof headingVariants>['level']>;

const DEFAULT_TAG_BY_LEVEL: Record<HeadingLevel, 'h1' | 'h2' | 'h3' | 'h4'> = {
  display: 'h1',
  hero:    'h1',
  section: 'h2',
  panel:   'h3',
  label:   'h4',
};

export interface HeadingProps
  extends Omit<HTMLAttributes<HTMLHeadingElement>, 'className'>,
    VariantProps<typeof headingVariants> {
  /** Polymorphic element — overrides the level's default semantic tag. */
  as?: ElementType;
  className?: string;
}

export const Heading = forwardRef<HTMLHeadingElement, HeadingProps>(
  ({ as, level, className, ...props }, ref) => {
    const resolvedLevel: HeadingLevel = level ?? 'section';
    const Tag: ElementType = as ?? DEFAULT_TAG_BY_LEVEL[resolvedLevel];
    return createElement(Tag, {
      ref,
      className: cn(headingVariants({ level: resolvedLevel }), className),
      ...props,
    });
  },
);
Heading.displayName = 'Heading';

/* ----- Text ----------------------------------------------------------- */

const textVariants = cva('', {
  variants: {
    tone: {
      // Default body ink — the same color a raw <p> would inherit on canvas.
      default:   'text-ink',
      // Secondary — subtitle / metadata sitting next to body copy.
      secondary: 'text-ink-secondary',
      // Muted — supporting copy, scope lines, footer text.
      muted:     'text-ink-muted',
      // Subtle — least-prominent meta (tooltip timestamps, "last sync …").
      subtle:    'text-ink-subtle',
    },
  },
  defaultVariants: { tone: 'default' },
});

export type TextTone = NonNullable<VariantProps<typeof textVariants>['tone']>;

export interface TextProps
  extends Omit<HTMLAttributes<HTMLElement>, 'className'>,
    VariantProps<typeof textVariants> {
  /** Polymorphic element — defaults to <p>. */
  as?: ElementType;
  className?: string;
}

export const Text = forwardRef<HTMLElement, TextProps>(
  ({ as, tone, className, ...props }, forwardedRef) => {
    const Tag: ElementType = as ?? 'p';
    return createElement(Tag, {
      ref: forwardedRef as Ref<HTMLElement>,
      className: cn(textVariants({ tone }), className),
      ...props,
    });
  },
);
Text.displayName = 'Text';
