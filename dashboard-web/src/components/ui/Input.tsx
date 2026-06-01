// dashboard-web/src/components/ui/Input.tsx
//
// Wave-2 Task 2.7 — extended Input primitive.
//
// Adds three optional props on top of the v1 wrapper:
//   - prefix?:  ReactNode rendered inside the field at the start (currency $,
//               search icon, etc.). The native <input> gets ps-9 padding so
//               the text never overlaps.
//   - suffix?:  ReactNode rendered at the end (% sign, clear button, etc.).
//               Mirror behaviour: pe-9 padding when present.
//   - error?:   string | boolean. Truthy → red border + role="alert" message
//               (when string). Pairs the input with aria-invalid for AT.
//
// Default `dir="auto"` for type=text / type=search so mixed Hebrew/English
// content (campaign names, store names) renders with correct directional
// runs in RTL pages. Other types (date, number, checkbox, file…) keep the
// native default — `dir="auto"` is meaningless or harmful for them.

import { forwardRef, useId, type InputHTMLAttributes, type ReactNode } from 'react';
import { cn } from '@/lib/utils';

// `prefix` is a deprecated HTML attribute on <input> (XHTML namespace
// resolver hint). React's typings still expose it as `string | undefined`,
// which conflicts with our ReactNode slot. Omit both `prefix` AND `suffix`
// before extending so our prop types win.
export interface InputProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, 'prefix' | 'suffix'> {
  /** Slot rendered at the leading edge of the field (icon, currency sign). */
  prefix?: ReactNode;
  /** Slot rendered at the trailing edge of the field (unit, clear button). */
  suffix?: ReactNode;
  /**
   * Truthy → red border + aria-invalid. Pass a string to render the message
   * below the field with role="alert". Pass `true` to style only.
   */
  error?: string | boolean;
}

/** Input types where `dir="auto"` actively helps mixed-script content. */
const AUTO_DIR_TYPES = new Set(['text', 'search', 'email', 'url', 'tel']);

/**
 * Box-like types (checkbox, radio, file, range, color) have their own
 * native widget chrome — the field-styling (h-9, glass-1 surface, ps-3,
 * tabular-nums) actively breaks their appearance. The primitive passes
 * through to a bare <input> for these types so they render natively.
 */
const BARE_TYPES = new Set(['checkbox', 'radio', 'file', 'range', 'color']);

export const Input = forwardRef<HTMLInputElement, InputProps>(
  (
    { className, type = 'text', prefix, suffix, error, dir, id, ...props },
    ref,
  ) => {
    const generatedId = useId();
    const inputId = id ?? generatedId;
    const errorId = `${inputId}-error`;
    const hasError = Boolean(error);
    const errorMessage = typeof error === 'string' ? error : null;
    const resolvedDir = dir ?? (AUTO_DIR_TYPES.has(type) ? 'auto' : undefined);
    const isBare = BARE_TYPES.has(type);

    if (isBare) {
      return (
        <input
          ref={ref}
          id={inputId}
          type={type}
          dir={resolvedDir}
          aria-invalid={hasError || undefined}
          className={className}
          {...props}
        />
      );
    }

    const inputEl = (
      <input
        ref={ref}
        id={inputId}
        type={type}
        dir={resolvedDir}
        aria-invalid={hasError || undefined}
        aria-describedby={errorMessage ? errorId : props['aria-describedby']}
        className={cn(
          'flex h-9 w-full rounded-md border bg-glass-1 px-3 py-1 text-sm text-ink',
          'placeholder:text-ink-muted',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
          'disabled:cursor-not-allowed disabled:opacity-50',
          'tabular-nums',
          hasError ? 'border-status-red focus-visible:ring-status-red' : 'border-glass-edge',
          // Adornment-aware padding — leaves room for the absolutely-
          // positioned prefix/suffix nodes below.
          prefix && 'ps-9',
          suffix && 'pe-9',
          className,
        )}
        {...props}
      />
    );

    if (!prefix && !suffix && !errorMessage) {
      return inputEl;
    }

    return (
      <div className="w-full">
        <div className="relative w-full">
          {prefix && (
            <span
              aria-hidden="true"
              className="pointer-events-none absolute start-3 top-1/2 -translate-y-1/2 flex items-center text-ink-muted text-sm"
            >
              {prefix}
            </span>
          )}
          {inputEl}
          {suffix && (
            <span
              aria-hidden="true"
              className="pointer-events-none absolute end-3 top-1/2 -translate-y-1/2 flex items-center text-ink-muted text-sm"
            >
              {suffix}
            </span>
          )}
        </div>
        {errorMessage && (
          <p
            id={errorId}
            role="alert"
            className="mt-1 text-[11px] font-medium text-status-redFg"
          >
            {errorMessage}
          </p>
        )}
      </div>
    );
  },
);
Input.displayName = 'Input';
