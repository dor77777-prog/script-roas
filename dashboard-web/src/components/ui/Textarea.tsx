// dashboard-web/src/components/ui/Textarea.tsx
//
// Wave-2 Task 2.7 — Textarea primitive.
//
// Drop-in replacement for raw <textarea>. Inherits the same glass-1 surface
// + glass-edge border + accent focus ring as Input, so multi-line fields
// match single-line ones visually. Defaults to `dir="auto"` (overridable
// via the `dir` prop) — important because most multi-line fields in this
// dashboard accept mixed Hebrew/English content (annotation notes, CSV
// paste, AI-report output).

import { forwardRef, useId, type TextareaHTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  /**
   * Truthy → red border + aria-invalid. Pass a string to render the
   * message below the field with role="alert".
   */
  error?: string | boolean;
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, error, dir, id, ...props }, ref) => {
    const generatedId = useId();
    const textareaId = id ?? generatedId;
    const errorId = `${textareaId}-error`;
    const hasError = Boolean(error);
    const errorMessage = typeof error === 'string' ? error : null;
    const resolvedDir = dir ?? 'auto';

    const textareaEl = (
      <textarea
        ref={ref}
        id={textareaId}
        dir={resolvedDir}
        aria-invalid={hasError || undefined}
        aria-describedby={errorMessage ? errorId : props['aria-describedby']}
        className={cn(
          'flex w-full min-h-[80px] rounded-md border bg-glass-1 px-3 py-2 text-sm text-ink',
          'placeholder:text-ink-muted',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
          'disabled:cursor-not-allowed disabled:opacity-50',
          'resize-y',
          hasError ? 'border-status-red focus-visible:ring-status-red' : 'border-glass-edge',
          className,
        )}
        {...props}
      />
    );

    if (!errorMessage) return textareaEl;

    return (
      <div className="w-full">
        {textareaEl}
        <p
          id={errorId}
          role="alert"
          className="mt-1 text-[11px] font-medium text-status-redFg"
        >
          {errorMessage}
        </p>
      </div>
    );
  },
);
Textarea.displayName = 'Textarea';
