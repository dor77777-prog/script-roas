'use client';

import type { ReactNode } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from './Button';
import { useReducedMotion } from '@/lib/hooks/useReducedMotion';

/**
 * Horizon re-skin Wave 1, debt #7 — <StateBlock>.
 *
 * One primitive for the three async-surface states that were previously
 * hand-rolled (and divergent) across every data tab — PaymentMethodsTab,
 * CustomerValueTab, Dashboard, the activity tabs … This is the single source
 * of truth; the per-tab rollout is Wave 8 (NOT here).
 *
 * It mirrors the EXISTING codebase patterns verbatim so the migration is a
 * drop-in:
 *   • skeleton → the `.skeleton` token-shimmer placeholder + `aria-hidden`,
 *     wrapped in an `aria-busy` container (Dashboard.tsx:801,
 *     PaymentMethodsTab.tsx:481-486, CustomerValueTab.tsx:389). The wrapper
 *     layout is shape-driven: `card` → 4-up responsive grid; `table`/`list` →
 *     single-column vertical stack of full-width rows (so a loading table/list
 *     never renders as a grid of stubby bars).
 *   • error → the `role="alert"` red strip
 *     (border-status-red / bg-status-redBg / text-status-redFg) with an
 *     AlertTriangle icon and a "נסה שוב" retry <Button variant="secondary">
 *     (PaymentMethodsTab.tsx:451-479).
 *   • empty → a centred icon + description + optional CTA <Button> (the
 *     settled-empty Card copy upgraded with an icon + call-to-action).
 *
 * TOKENS / A11Y — token-only (status-red* + ink* + glass shimmer tokens, no
 * raw hex), RTL-native (the surrounding app sets dir=rtl; flex + text flow
 * inherit it), AA in both themes (the status-red* trio is the operator-locked
 * error palette already proven AA on the red strip), lucide icons only.
 * Buttons inherit the shared <Button> focus-visible ring; an interactive
 * `cursor-pointer` is added explicitly so the surface reads as clickable.
 *
 * REDUCED MOTION — the shimmer animation is gated TWICE: the CSS `.skeleton`
 * class already carries the gradient + `animation: shimmer` which the global
 * `@media (prefers-reduced-motion: reduce)` sweep in globals.css neutralises,
 * AND we additionally gate the explicit `motion-safe:animate-shimmer` class
 * through {@link useReducedMotion} so the component itself declines to apply
 * the JS-visible animate class when the user prefers reduced motion. That
 * component-level gate is the part the DOM tests can assert on (jsdom does not
 * evaluate the CSS media query). `data-reduced-motion` mirrors the decision.
 */
export type StateBlockMode = 'skeleton' | 'error' | 'empty';
export type StateBlockShape = 'card' | 'table' | 'list';

export interface StateBlockProps {
  /** Which of the three async-surface states to render. */
  mode: StateBlockMode;
  /** Skeleton placeholder count (default 4). */
  rows?: number;
  /** Skeleton silhouette — tunes placeholder height/shape (default 'card'). */
  shape?: StateBlockShape;
  /** Error message (error mode); also used as the skeleton sr-only label. */
  message?: ReactNode;
  /** Error retry handler — omit to hide the retry button. */
  onRetry?: () => void;
  /** Empty-state lead icon (lucide). */
  icon?: ReactNode;
  /** Empty-state description copy. */
  description?: ReactNode;
  /** Empty-state CTA handler — omit (or omit actionLabel) to hide the CTA. */
  onAction?: () => void;
  /** Empty-state CTA label. */
  actionLabel?: string;
  /** Extra classes for the root. */
  className?: string;
}

/** Per-shape placeholder geometry, matching the existing call sites. */
const SHAPE_PLACEHOLDER: Record<StateBlockShape, string> = {
  // KPI/summary cards — chunky tiles (PaymentMethodsTab.tsx:484 `h-24`).
  card: 'h-24 rounded-xl',
  // Tabular rows — slim bars (activity tabs `h-12`), full-width within the column.
  table: 'h-12 w-full rounded-lg',
  // List rows — taller bars, full-width within the column.
  list: 'h-20 w-full rounded-xl',
};

/**
 * Per-shape WRAPPER layout. The silhouette must match the surface the skeleton
 * stands in for: KPI cards live in a 4-up responsive grid, while table/list
 * surfaces are VERTICAL STACKS of full-width rows (a 4-column grid of stubby
 * bars would never read as a loading table/list on the Wave 8 rollout —
 * PaymentMethodsTab / CustomerValueTab tables etc.).
 */
const SHAPE_WRAPPER: Record<StateBlockShape, string> = {
  // 4-up KPI tiles — responsive grid.
  card: 'grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4',
  // Tabular rows — single-column vertical stack of slim bars.
  table: 'flex flex-col gap-2',
  // List rows — single-column vertical stack of taller rows.
  list: 'flex flex-col gap-3',
};

export function StateBlock({
  mode,
  rows = 4,
  shape = 'card',
  message,
  onRetry,
  icon,
  description,
  onAction,
  actionLabel,
  className,
}: StateBlockProps) {
  const reduced = useReducedMotion();

  if (mode === 'skeleton') {
    const count = Math.max(1, rows);
    return (
      <div
        data-testid="state-skeleton"
        data-reduced-motion={reduced ? 'true' : 'false'}
        aria-busy="true"
        className={cn('space-y-3', className)}
      >
        {/* sr-only loading label — never leaked into the placeholders. */}
        {message ? <span className="sr-only">{message}</span> : null}
        <div data-testid="state-skeleton-wrapper" className={SHAPE_WRAPPER[shape]}>
          {Array.from({ length: count }).map((_, i) => (
            <div
              key={i}
              aria-hidden="true"
              className={cn(
                'skeleton',
                SHAPE_PLACEHOLDER[shape],
                // JS-gated shimmer: only when the user has NOT asked for
                // reduced motion. `motion-safe:` keeps the CSS guard intact
                // even where the component-level gate is bypassed.
                !reduced && 'motion-safe:animate-shimmer',
              )}
            />
          ))}
        </div>
      </div>
    );
  }

  if (mode === 'error') {
    return (
      <div
        role="alert"
        data-testid="state-error"
        className={cn(
          'rounded-xl border border-status-red bg-status-redBg px-4 py-4 text-status-redFg',
          className,
        )}
      >
        <div className="flex items-start gap-2.5">
          <AlertTriangle size={18} className="mt-0.5 shrink-0" aria-hidden="true" />
          <div className="min-w-0 flex-1">
            <div className="text-[13px] font-semibold leading-relaxed">{message}</div>
            {onRetry ? (
              <Button
                type="button"
                variant="secondary"
                onClick={onRetry}
                className="mt-3 cursor-pointer gap-1.5 text-[12px]"
              >
                <RefreshCw size={12} aria-hidden="true" />
                נסה שוב
              </Button>
            ) : null}
          </div>
        </div>
      </div>
    );
  }

  // mode === 'empty'
  const showCta = Boolean(onAction && actionLabel);
  return (
    <div
      data-testid="state-empty"
      className={cn(
        'flex flex-col items-center justify-center gap-3 px-6 py-10 text-center',
        className,
      )}
    >
      {icon ? (
        <span
          className="flex h-12 w-12 items-center justify-center rounded-full bg-glass-2 text-ink-muted [&>svg]:h-6 [&>svg]:w-6"
          aria-hidden="true"
        >
          {icon}
        </span>
      ) : null}
      {description ? (
        <p className="max-w-sm text-sm leading-relaxed text-ink-secondary">{description}</p>
      ) : null}
      {showCta ? (
        <Button
          type="button"
          variant="secondary"
          onClick={onAction}
          className="cursor-pointer"
        >
          {actionLabel}
        </Button>
      ) : null}
    </div>
  );
}
