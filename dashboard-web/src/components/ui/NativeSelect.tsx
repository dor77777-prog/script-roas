// dashboard-web/src/components/ui/NativeSelect.tsx
//
// Wave-2 Task 2.7 — drop-in styled <select>.
//
// The existing Radix-based Select (in this same directory) is the right
// primitive for richly-themed pickers, but the dashboard has ~20 simple
// value/onChange selects (store picker, month, source type…) where a
// portal-rendered listbox is overkill. NativeSelect gives those sites the
// canonical glass-1 surface + chevron treatment in one wrapper without
// rewriting every form to Radix.
//
// Why a separate primitive rather than overloading `Select`?
//   - Radix `Select` uses compound parts (`SelectTrigger`/`SelectContent`/
//     `SelectItem`). Reusing the same export name for a native wrapper
//     would conflate the two mental models.
//   - Native `<select>` works on mobile keyboards / iOS picker wheel
//     out of the box, which matters for the operator forms on phones.

import { forwardRef, type SelectHTMLAttributes, type ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface NativeSelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  /**
   * Truthy → red border + aria-invalid. Pass a string to render the
   * message below the field with role="alert".
   */
  error?: string | boolean;
  children: ReactNode;
}

export const NativeSelect = forwardRef<HTMLSelectElement, NativeSelectProps>(
  ({ className, error, children, ...props }, ref) => {
    const hasError = Boolean(error);
    const errorMessage = typeof error === 'string' ? error : null;

    return (
      <div className="w-full">
        <div className="relative w-full">
          <select
            ref={ref}
            aria-invalid={hasError || undefined}
            className={cn(
              'flex h-9 w-full appearance-none rounded-md border bg-glass-1 ps-3 pe-9 py-1 text-sm text-ink',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
              'disabled:cursor-not-allowed disabled:opacity-50',
              'cursor-pointer',
              hasError
                ? 'border-status-red focus-visible:ring-status-red'
                : 'border-glass-edge',
              className,
            )}
            {...props}
          >
            {children}
          </select>
          <ChevronDown
            size={14}
            aria-hidden="true"
            className="pointer-events-none absolute end-2.5 top-1/2 -translate-y-1/2 text-ink-muted"
          />
        </div>
        {errorMessage && (
          <p
            role="alert"
            className="mt-1 text-[11px] font-medium text-status-red"
          >
            {errorMessage}
          </p>
        )}
      </div>
    );
  },
);
NativeSelect.displayName = 'NativeSelect';
