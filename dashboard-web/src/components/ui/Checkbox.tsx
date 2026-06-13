'use client';

import { forwardRef, useEffect, useRef, type InputHTMLAttributes } from 'react';
import { Check, Minus } from 'lucide-react';
import { cn } from '@/lib/utils';

// ---------------------------------------------------------------------------
// Checkbox — token-driven, AA-safe, RTL-safe checkbox primitive (Wave-7 T2).
//
// House pattern is Radix for interactive primitives (Switch/Sheet/Tabs), but
// `@radix-ui/react-checkbox` is NOT installed and this task must not add a dep
// without justification. A real native `<input type="checkbox">` gives the
// full a11y contract for free — `role=checkbox`, `aria-checked` reflection,
// Space-to-toggle, and native <label htmlFor> association — so we visually
// hide the input (`peer`) and paint the box + glyph with sibling nodes that
// react to the input's :checked / :focus-visible / :disabled states.
//
// API mirrors the Switch primitive (`checked` / `onCheckedChange`) so call
// sites feel consistent, while still forwarding native-input props.
//
// Token contract (NO raw hex — see designColorGuard):
//   unchecked box   → bg-pill-track + border-glass-edge  (visible in BOTH themes)
//   checked box     → bg-accent + border-accent, glyph = text-accent-fg (the
//                     paired on-accent foreground, guaranteed AA, never derived)
//   focus ring      → ring-accent (matches Switch/Button)
//   disabled        → opacity-50 + cursor-not-allowed
// ---------------------------------------------------------------------------

export interface CheckboxProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, 'onChange' | 'type'> {
  /** Controlled checked state (mirrors Switch's `checked`). */
  checked?: boolean;
  /** Fired with the toggled value (mirrors Switch's `onCheckedChange`). */
  onCheckedChange?: (checked: boolean) => void;
  /** Renders the indeterminate dash glyph + sets the native `indeterminate` flag. */
  indeterminate?: boolean;
  /** Escape hatch for native onChange consumers (e.g. react-hook-form). */
  onChange?: InputHTMLAttributes<HTMLInputElement>['onChange'];
}

export const Checkbox = forwardRef<HTMLInputElement, CheckboxProps>(
  (
    {
      className,
      checked,
      onCheckedChange,
      onChange,
      indeterminate = false,
      disabled,
      ...props
    },
    ref,
  ) => {
    // `indeterminate` is a DOM-only property (no HTML attribute), so it must be
    // set imperatively on the underlying input every time it changes.
    const innerRef = useRef<HTMLInputElement | null>(null);
    useEffect(() => {
      if (innerRef.current) innerRef.current.indeterminate = indeterminate;
    }, [indeterminate]);

    return (
      <span
        className={cn(
          'relative inline-flex h-4 w-4 shrink-0',
          disabled ? 'cursor-not-allowed' : 'cursor-pointer',
          className,
        )}
      >
        <input
          type="checkbox"
          ref={(node) => {
            innerRef.current = node;
            if (typeof ref === 'function') ref(node);
            else if (ref) ref.current = node;
          }}
          checked={checked}
          disabled={disabled}
          aria-checked={indeterminate ? 'mixed' : checked}
          onChange={(e) => {
            onCheckedChange?.(e.target.checked);
            onChange?.(e);
          }}
          // The native input is the real interactive surface (keyboard,
          // focus, label hit-target) but visually transparent — the painted
          // box below shows state. `peer` lets the box + glyph react to it.
          className={cn(
            'peer absolute inset-0 z-10 m-0 h-full w-full appearance-none rounded',
            disabled ? 'cursor-not-allowed' : 'cursor-pointer',
            'focus-visible:outline-none',
          )}
          {...props}
        />

        {/* Painted box (direct peer sibling of the input). Logical `inset-0`
            keeps it RTL-safe. Checked OR indeterminate (aria-checked=mixed)
            paint the accent fill; focus-visible draws the ring-accent. */}
        <span
          aria-hidden="true"
          className={cn(
            'pointer-events-none absolute inset-0 rounded border transition-colors',
            'bg-pill-track border-glass-edge',
            'peer-checked:bg-accent peer-checked:border-accent',
            'peer-[[aria-checked=mixed]]:bg-accent peer-[[aria-checked=mixed]]:border-accent',
            'peer-focus-visible:ring-2 peer-focus-visible:ring-accent',
            'peer-disabled:opacity-50',
          )}
        />

        {/* Glyph (also a direct peer sibling so peer-checked reaches it).
            The on-accent token guarantees AA against the accent fill; the
            transition-opacity is collapsed by the global reduced-motion rule. */}
        {indeterminate ? (
          <Minus
            aria-hidden="true"
            className={cn(
              'pointer-events-none absolute inset-0 m-auto h-3 w-3 text-accent-fg',
              'peer-disabled:opacity-50',
            )}
          />
        ) : (
          <Check
            aria-hidden="true"
            className={cn(
              'pointer-events-none absolute inset-0 m-auto h-3 w-3 text-accent-fg',
              'opacity-0 transition-opacity peer-checked:opacity-100',
            )}
          />
        )}
      </span>
    );
  },
);
Checkbox.displayName = 'Checkbox';
