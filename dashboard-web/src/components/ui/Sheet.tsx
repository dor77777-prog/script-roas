'use client';

import { forwardRef, type ReactNode } from 'react';
import * as RadixDialog from '@radix-ui/react-dialog';
import { cva, type VariantProps } from 'class-variance-authority';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';

const sheetVariants = cva(
  'fixed z-50 bg-glass-1 text-ink shadow-sheet border-glass-edge transition ease-out animate-in slide-in-from-end',
  {
    variants: {
      side: {
        start: 'top-0 start-0 h-full w-3/4 max-w-md border-e',
        end:   'top-0 end-0 h-full w-3/4 max-w-md border-s',
        top:   'top-0 inset-x-0 h-1/3 border-b',
        bottom:'bottom-0 inset-x-0 h-1/3 border-t',
      },
    },
    defaultVariants: { side: 'end' },
  },
);

export const Sheet = RadixDialog.Root;
export const SheetTrigger = RadixDialog.Trigger;
export const SheetClose = RadixDialog.Close;

export interface SheetContentProps
  extends React.ComponentPropsWithoutRef<typeof RadixDialog.Content>,
    VariantProps<typeof sheetVariants> {
  children: ReactNode;
}

export const SheetContent = forwardRef<
  React.ElementRef<typeof RadixDialog.Content>,
  SheetContentProps
>(({ className, side, children, ...props }, ref) => (
  <RadixDialog.Portal>
    <RadixDialog.Overlay className="fixed inset-0 z-50 bg-glass-3 backdrop-blur-sm animate-in fade-in-0" />
    <RadixDialog.Content
      ref={ref}
      className={cn(sheetVariants({ side }), className)}
      {...props}
    >
      {children}
      <SheetClose
        aria-label="סגור"
        className="absolute end-3 top-3 rounded-md p-1 text-ink-muted hover:bg-glass-2"
      >
        <X size={16} />
      </SheetClose>
    </RadixDialog.Content>
  </RadixDialog.Portal>
));
SheetContent.displayName = RadixDialog.Content.displayName;

export const SheetTitle = forwardRef<
  React.ElementRef<typeof RadixDialog.Title>,
  React.ComponentPropsWithoutRef<typeof RadixDialog.Title>
>(({ className, ...props }, ref) => (
  <RadixDialog.Title ref={ref} className={cn('text-base font-semibold text-ink leading-tight', className)} {...props} />
));
SheetTitle.displayName = RadixDialog.Title.displayName;
