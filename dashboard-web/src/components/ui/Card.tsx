import {
  forwardRef,
  useCallback,
  useLayoutEffect,
  useRef,
  type HTMLAttributes,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
} from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

/**
 * Task 2.4 — Card primitive (glass).
 *
 * Default class string is `glass rounded-card p-5` (per v2 plan, mockup-04-
 * final.html:91-98). The `.glass` rule lives in globals.css and provides the
 * canonical 3-layer surface treatment: linear-gradient(--glass-2→--glass-1),
 * --blur-glass backdrop-filter, --glass-edge rim, --shadow-glass inset+drop,
 * position: relative (so [data-band]::before anchors).
 *
 * Two opt-in V4 props:
 *   • `band="red|orange|green|blue|gray"` — forwards to data-band="…".
 *     Wave-1 Task 1.3 CSS (.glass[data-band]) adds a 3px top glow bar +
 *     ~5% chroma tint behind the card.
 *   • `freshness="fresh|aging|stale"` — forwards to data-freshness="…".
 *     Wave-1 Task 1.4 CSS (.glass[data-freshness]) desaturates the card
 *     so a stale row visibly fades next to live siblings (15 / 30 min
 *     thresholds; see lib/freshness/useStaleness.ts).
 *
 * Variants:
 *   - `default` (omitted prop)  → full glass treatment.
 *   - `flat`                    → no glass / border / shadow. Opt-out for
 *     inline groupings that nest inside a parent Card. Mirrors the
 *     pre-Wave-2 API so legacy `variant="flat"` sites keep working.
 *
 * The pre-Wave-2 `variant="elevated"` was visually identical to `default`
 * (Task 1.7 collapsed the shadow ladder); it is intentionally NOT exposed
 * here. A legacy `variant="elevated"` prop still resolves to default via
 * the variants map below so consumers that haven't migrated yet keep
 * rendering correctly.
 */

const cardVariants = cva(
  /* Horizon re-skin Wave 1 (Task 1.1) — canonical Card recipe.
   * Mockup source: docs/superpowers/mockups/2026-06-12-horizon-reskin/
   * home-approved.html (KPI card — a `!z-5 relative flex flex-col`, 20px
   * radius, light card-surface fill + border-box bg-clip, light drop shadow,
   * and in dark a navy-800 fill with near-white text and no shadow). Expressed
   * through OUR token utilities rather than Horizon's raw class names:
   *   • the card surface (light card-surface / dark navy-800) + theme-aware
   *     shadow (Horizon drop shadow in light / none in dark) +
   *     `position: relative` already come from the `.glass` rule in
   *     globals.css — it sets `background: var(--glass-1)` (near-white in
   *     light / navy-800 dark), `box-shadow: var(--shadow-glass)` (Horizon
   *     drop in light, `0 0 transparent` in dark) and `position: relative`.
   *     Because
   *     `--shadow-glass` is ALREADY shadowless in dark, a separate
   *     `dark:shadow-none` would be redundant — so it is intentionally NOT
   *     present here (W0 follow-up note).
   *   • `flex flex-col` + `bg-clip-border` mirror the Horizon container
   *     chassis (flex items stretch to full width by default, so block-flow
   *     children are unaffected; `bg-clip-border` is Tailwind's default
   *     border-box clip — restated to match the canonical recipe).
   *   • `rounded-hz` is the exact Horizon 20px radius (was `rounded-card`
   *     = 18px). `shadow-hz` is the alias for the same `--shadow-glass`
   *     token `.glass` already applies, so it is not restated to avoid a
   *     duplicate box-shadow declaration.
   *
   * `text-ink` is kept so cards have a body-coloured default text fill (no
   * consumer relies on it, but removing it would silently change foreground
   * colour on every card).
   *
   * Wave-6 Task 6.1 — `card-hover` adds the universal hover lift
   * (translateY(-2px) over --motion-snap). The `.card-hover` class hook
   * lives in globals.css so the prefers-reduced-motion sweep (Task 6.2)
   * can collapse the transform back to none. We pair it with
   * `transition-transform duration-snap` so the lift uses the semantic
   * motion vocabulary (120 ms) instead of an arbitrary number. */
  'glass flex flex-col bg-clip-border rounded-hz p-5 text-ink transition-colors card-hover transition-transform duration-snap hover:-translate-y-0.5',
  {
    variants: {
      variant: {
        default:  '',
        // Legacy alias — Task 1.7 collapsed elevated → default at the shadow
        // layer. Kept as a no-op variant so `variant="elevated"` callers do
        // not type-error during the wave-2 sweep.
        elevated: '',
        // Opt-out: strip the glass treatment entirely. `backdrop-blur-none`
        // is the Tailwind utility for `backdrop-filter: none`; the other
        // three (`!bg-transparent`, `!border-0`, `!shadow-none`) override
        // the corresponding rules in the `.glass` CSS block above.
        flat:     '!bg-transparent !border-0 !shadow-none backdrop-blur-none',
      },
    },
    defaultVariants: { variant: 'default' },
  },
);

export type CardBand = 'red' | 'red-alarm' | 'orange' | 'green' | 'blue' | 'gray';
export type CardFreshness = 'fresh' | 'aging' | 'stale';
/**
 * Round 6 (2026-05-31) — opt into a quieter band rendering.
 *   "strong" (default) → full top-slab + halo + base-tint treatment.
 *     Use for cards that visually communicate their band state
 *     (per-store ROAS cards, hero Operating Profit + ROAS + Ad-spend %).
 *   "muted"             → edge bar + thin top halo + ~6% base tint, no
 *     dominant slab. Use for hero strip secondary cards (Spend, Revenue,
 *     Orders, CPM) so a 6-card row carrying the same business-ROAS band
 *     does not collapse into one solid-colour blob. CSS lives in
 *     globals.css under `.glass[data-band][data-band-strength="muted"]`.
 */
export type CardBandStrength = 'strong' | 'muted';

export interface CardProps
  extends HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof cardVariants> {
  /** V4 band signal — forwards to `data-band="…"`. */
  band?: CardBand;
  /** V4 freshness desaturation — forwards to `data-freshness="…"`. */
  freshness?: CardFreshness;
  /**
   * Round-6 (2026-05-31) opt-in band strength. Forwards to
   * `data-band-strength="…"`. Default ("strong") keeps the
   * pre-round-6 rendering. Pass `"muted"` for a same-band card that
   * sits inside a row of like-banded cards — see `CardBandStrength`.
   */
  bandStrength?: CardBandStrength;
  /**
   * Task 3.4 — drill-down entry point.
   *
   * When supplied, the card becomes an interactive surface:
   *   • role="button" + tabIndex=0 (unless the caller already set them)
   *   • click + Enter + Space all invoke `onDrill`
   *   • cursor:pointer + focus-visible ring (--accent)
   *
   * Orthogonal to consumer-side handlers like PerStoreRow's `onStoreSelect`
   * (those still work — this is a generic primitive so net-new cards can
   * wire drill behaviour without re-implementing the keyboard plumbing).
   *
   * The caller is responsible for the destination (typically wiring
   * `drillToCampaigns({ store, platform })` from `lib/urlState.ts`).
   */
  onDrill?: () => void;
}

export const Card = forwardRef<HTMLDivElement, CardProps>(
  (
    {
      className,
      variant,
      band,
      bandStrength,
      freshness,
      onDrill,
      onClick,
      onKeyDown,
      role,
      tabIndex,
      ...props
    },
    ref,
  ) => {
    const interactive = typeof onDrill === 'function';

    /* Wave-6 Task 6.1 — V4 band signal entrance.
     * When a banded card mounts, the `.glass[data-band]:not([data-mounted])`
     * rule in globals.css clamps it to `opacity:0; transform:scale(0.98)`.
     * On the next frame we flip `data-mounted="true"` on the node so the
     * 300 ms fade-in + scale-up plays. Only runs when `band` is set so an
     * un-banded Card has zero animation overhead. The DOM-attribute flip
     * (vs a React state re-render) keeps the transition under-the-hood and
     * avoids a paint-stomp on every prop change. The prefers-reduced-motion
     * sweep (Task 6.2) collapses the keyframe to instant. */
    const localRef = useRef<HTMLDivElement | null>(null);
    useLayoutEffect(() => {
      if (!band) return;
      const node = localRef.current;
      if (!node) return;
      // Two RAFs so the initial unmounted style is applied before flipping.
      const id = requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          node.setAttribute('data-mounted', 'true');
        });
      });
      return () => cancelAnimationFrame(id);
    }, [band]);

    /* Compose the forwarded ref with our local one so both consumers
     * (caller's ref) and our useLayoutEffect read the same node. */
    const setRefs = useCallback(
      (node: HTMLDivElement | null) => {
        localRef.current = node;
        if (typeof ref === 'function') ref(node);
        else if (ref) (ref as React.MutableRefObject<HTMLDivElement | null>).current = node;
      },
      [ref],
    );

    const handleClick = useCallback(
      (e: ReactMouseEvent<HTMLDivElement>) => {
        // Preserve any consumer-supplied onClick — fire that first so a
        // wrapping click handler can stopPropagation if needed.
        onClick?.(e);
        if (!interactive || e.defaultPrevented) return;
        onDrill!();
      },
      [interactive, onClick, onDrill],
    );

    const handleKeyDown = useCallback(
      (e: ReactKeyboardEvent<HTMLDivElement>) => {
        onKeyDown?.(e);
        if (!interactive || e.defaultPrevented) return;
        if (e.key === 'Enter' || e.key === ' ' || e.key === 'Spacebar') {
          // preventDefault on Space stops the page from scrolling.
          e.preventDefault();
          onDrill!();
        }
      },
      [interactive, onKeyDown, onDrill],
    );

    return (
      <div
        ref={setRefs}
        className={cn(
          cardVariants({ variant }),
          interactive &&
            'cursor-pointer transition-colors hover:border-glass-edge-hot focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
          className,
        )}
        data-band={band}
        data-band-strength={band ? bandStrength : undefined}
        data-freshness={freshness}
        role={interactive ? (role ?? 'button') : role}
        tabIndex={interactive ? (tabIndex ?? 0) : tabIndex}
        onClick={interactive || onClick ? handleClick : undefined}
        onKeyDown={interactive || onKeyDown ? handleKeyDown : undefined}
        {...props}
      />
    );
  },
);
Card.displayName = 'Card';

/* Tooltip touch-path marker. `Card` renders a block `<div>`, so when a whole
 * Card is wrapped in a simple `<HelpTooltip>` (hero / store-detail cards), the
 * coarse-pointer ⓘ Toggletip must NOT span-wrap it (invalid `<span><div/></span>`
 * + lost grid placement). This flag tells `isNonPhrasingChild` (tooltip/phrasing.ts)
 * to make the Card itself the `asChild` tap trigger — mirroring the desktop
 * model. See tooltip/phrasing.ts BLOCK_TRIGGER_FLAG. */
(Card as { isBlockTrigger?: boolean }).isBlockTrigger = true;

/* Subcomponents — opinionated padding wrappers. Kept thin so a card built
 * from `<Card><CardHeader>…</CardHeader>…</Card>` doesn't double-pad. The
 * Card root brings its own `p-5`; CardHeader/Body/Footer use margin-top so
 * they stack inside the root padding rather than re-padding. Use `flat`
 * variant on the root if you need an unpadded chassis with section-style
 * inner padding instead. */

export const CardHeader = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn('flex flex-col gap-1', className)} {...props} />
  ),
);
CardHeader.displayName = 'CardHeader';

export const CardTitle = forwardRef<HTMLHeadingElement, HTMLAttributes<HTMLHeadingElement>>(
  ({ className, ...props }, ref) => (
    <h3 ref={ref} className={cn('text-sm font-semibold text-ink leading-tight', className)} {...props} />
  ),
);
CardTitle.displayName = 'CardTitle';

export const CardDescription = forwardRef<HTMLParagraphElement, HTMLAttributes<HTMLParagraphElement>>(
  ({ className, ...props }, ref) => (
    <p ref={ref} className={cn('text-xs text-ink-muted', className)} {...props} />
  ),
);
CardDescription.displayName = 'CardDescription';

export const CardBody = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn('mt-3', className)} {...props} />
  ),
);
CardBody.displayName = 'CardBody';

export const CardFooter = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn('mt-3 pt-3 border-t border-glass-edge', className)} {...props} />
  ),
);
CardFooter.displayName = 'CardFooter';
