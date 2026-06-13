'use client';

// dashboard-web/src/components/ui/SegmentedControl.tsx
//
// Use SegmentedControl for a stateless VALUE TOGGLE with no associated content panel (filters, view switches). For switching content panels (tabpanel association), use Tabs.tsx instead.
//
// Horizon re-skin Wave 1, debt #4 — the single segmented / toggle primitive.
// Replaces 12 hand-rolled controls with divergent active states (Filters
// quick-range pills + compare-basis row, Products segmented switch, the
// customers radio rows, …). The 12-consumer migration is a SEPARATE follow-on;
// this file only ships the primitive.
//
// ── Visual recipe (Horizon "seg") ────────────────────────────────────────────
//   rail   = `rounded-full bg-pill-track p-1`  (--pill-track = surface-sunken)
//   active = brand pill: `bg-pill-thumb text-pill-inkOn` (on-thumb white ink,
//            >= 4.5:1 AA in BOTH themes — locked by contrastGuard via --pill-*)
//   idle   = `text-pill-ink` (muted) → `hover:text-ink` ink-up, NO layout shift
//   All colour/ink moves transition over `duration-fast` (180 ms). The active
//   pill paints via background-color only, so toggling never reflows the row.
//
// ── A11y / keyboard ─────────────────────────────────────────────────────────
//   role defaults to "tablist" (children role="tab" + aria-selected). Pass
//   role="radiogroup" for a true single-choice form control (children
//   role="radio" + aria-checked). Either way: roving tabindex (exactly one
//   item tabbable), focus-visible ring, full Arrow/Home/End nav.
//
//   The app is RTL. We resolve the *effective* direction from the DOM at
//   key-time (closest [dir] → documentElement.dir) so Arrow keys are correct
//   in both orientations: in RTL ArrowRight = previous (visually forward),
//   ArrowLeft = next (visually back); LTR is the mirror. Home/End always jump
//   to the first / last option in reading order. Arrows clamp at the edges
//   (no wrap) so the operator can't tab off the ends accidentally.

import { forwardRef, useId, useRef, type ReactNode, type KeyboardEvent } from 'react';
import { cn } from '@/lib/utils';

export type SegmentedOption = {
  value: string;
  label: ReactNode;
  /** Optional per-option disable (kept focusable-skippable). */
  disabled?: boolean;
};

export type SegmentedControlProps = {
  options: SegmentedOption[];
  value: string;
  onChange: (value: string) => void;
  /** Semantics: "tablist" (default, view switch) or "radiogroup" (form choice). */
  role?: 'tablist' | 'radiogroup';
  size?: 'sm' | 'md';
  className?: string;
  /** Required for assistive tech — the rail has no visible label of its own. */
  'aria-label'?: string;
  'aria-labelledby'?: string;
  'data-testid'?: string;
};

function resolveRtl(el: HTMLElement | null): boolean {
  const dirHost = el?.closest('[dir]') as HTMLElement | null;
  const dir = dirHost?.getAttribute('dir') ?? (typeof document !== 'undefined' ? document.documentElement.dir : 'ltr');
  return dir === 'rtl';
}

export const SegmentedControl = forwardRef<HTMLDivElement, SegmentedControlProps>(
  function SegmentedControl(
    {
      options,
      value,
      onChange,
      role = 'tablist',
      size = 'md',
      className,
      'aria-label': ariaLabel,
      'aria-labelledby': ariaLabelledby,
      'data-testid': dataTestid,
    },
    ref,
  ) {
    const baseId = useId();
    const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);
    const isRadio = role === 'radiogroup';
    const itemRole = isRadio ? 'radio' : 'tab';

    const enabledIndexes = options
      .map((o, i) => (o.disabled ? -1 : i))
      .filter(i => i >= 0);

    const activeIndex = options.findIndex(o => o.value === value);

    function move(toIndex: number) {
      const opt = options[toIndex];
      if (!opt || opt.disabled) return;
      itemRefs.current[toIndex]?.focus();
      if (opt.value !== value) onChange(opt.value);
    }

    /** Next enabled index in reading order from `from`, in the given step (+1/-1). */
    function nextEnabled(from: number, step: 1 | -1): number {
      let i = from + step;
      while (i >= 0 && i < options.length) {
        if (!options[i]?.disabled) return i;
        i += step;
      }
      return -1; // clamp (no wrap)
    }

    function onKeyDown(e: KeyboardEvent<HTMLButtonElement>, index: number) {
      const rtl = resolveRtl(e.currentTarget);
      let target = -1;

      switch (e.key) {
        case 'ArrowRight':
          // RTL: Right = previous in reading order; LTR: Right = next.
          target = nextEnabled(index, rtl ? -1 : 1);
          break;
        case 'ArrowLeft':
          target = nextEnabled(index, rtl ? 1 : -1);
          break;
        case 'ArrowDown':
          // Orientation-agnostic: Down = next in reading order.
          target = nextEnabled(index, 1);
          break;
        case 'ArrowUp':
          target = nextEnabled(index, -1);
          break;
        case 'Home':
          target = enabledIndexes[0] ?? -1;
          break;
        case 'End':
          target = enabledIndexes[enabledIndexes.length - 1] ?? -1;
          break;
        case ' ':
        case 'Enter':
          // Activate the focused item (relevant when focus moved without select).
          e.preventDefault();
          move(index);
          return;
        default:
          return;
      }

      if (target >= 0 && target !== index) {
        e.preventDefault();
        move(target);
      } else {
        // Edge clamp or no-op — still swallow the arrow so the page doesn't scroll.
        e.preventDefault();
      }
    }

    const sizeItem =
      size === 'sm'
        ? 'px-2.5 py-1 text-xs min-h-[32px]'
        : 'px-3.5 py-1.5 text-sm min-h-[40px]';

    return (
      <div
        ref={ref}
        role={role}
        aria-label={ariaLabel}
        aria-labelledby={ariaLabelledby}
        data-testid={dataTestid}
        className={cn(
          // Rail: rounded-full pill track. inline-flex keeps it content-width;
          // min-w-0 + overflow guard so a long set scrolls instead of bursting
          // the parent in either direction.
          'inline-flex w-max max-w-full items-center gap-1 rounded-full bg-pill-track p-1',
          'overflow-x-auto scrollbar-hide',
          className,
        )}
      >
        {options.map((opt, i) => {
          const selected = opt.value === value;
          // Roving tabindex: the active item is tabbable; if no value matches,
          // make the first ENABLED item tabbable so the control is reachable.
          // When every option is disabled there is no enabled item — force
          // nothing tabbable (don't fall back to the disabled index 0).
          const tabbable =
            selected ||
            (activeIndex < 0 &&
              enabledIndexes.length > 0 &&
              i === enabledIndexes[0]);

          return (
            <button
              key={opt.value}
              ref={el => {
                itemRefs.current[i] = el;
              }}
              type="button"
              role={itemRole}
              id={`${baseId}-${opt.value}`}
              {...(isRadio
                ? { 'aria-checked': selected }
                : { 'aria-selected': selected })}
              tabIndex={tabbable ? 0 : -1}
              disabled={opt.disabled}
              onClick={() => {
                if (!opt.disabled && opt.value !== value) onChange(opt.value);
              }}
              onKeyDown={e => onKeyDown(e, i)}
              className={cn(
                'relative inline-flex select-none items-center justify-center whitespace-nowrap',
                'rounded-full font-semibold',
                // Colour/ink only — no border/size delta between states, so the
                // active pill never shifts layout on toggle or hover.
                'transition-colors duration-fast ease-out',
                'cursor-pointer disabled:cursor-not-allowed disabled:opacity-50',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-1 focus-visible:ring-offset-pill-track',
                sizeItem,
                selected
                  ? 'bg-pill-thumb text-pill-inkOn shadow-soft'
                  : 'bg-transparent text-pill-ink hover:text-ink',
              )}
            >
              {opt.label}
            </button>
          );
        })}
      </div>
    );
  },
);
