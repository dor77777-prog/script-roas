'use client';

import { forwardRef, type ReactNode } from 'react';
import * as RadixDialog from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';

export const Dialog = RadixDialog.Root;
export const DialogTrigger = RadixDialog.Trigger;
export const DialogClose = RadixDialog.Close;

export const DialogContent = forwardRef<
  React.ElementRef<typeof RadixDialog.Content>,
  React.ComponentPropsWithoutRef<typeof RadixDialog.Content> & { children: ReactNode }
>(({ className, children, ...props }, ref) => (
  <RadixDialog.Portal>
    <RadixDialog.Overlay className="fixed inset-0 z-50 bg-glass-3 backdrop-blur-sm animate-in fade-in-0" />
    <RadixDialog.Content
      ref={ref}
      className={cn(
        'fixed inset-x-0 top-1/2 z-50 w-full max-w-lg mx-auto -translate-y-1/2',
        'bg-glass-1 text-ink rounded-xl border border-glass-edge shadow-xl p-6',
        'animate-in fade-in-0 zoom-in-95',
        className,
      )}
      {...props}
    >
      {children}
      <DialogClose
        aria-label="סגור"
        className="absolute end-3 top-3 rounded-md p-1 text-ink-muted hover:bg-glass-2"
      >
        <X size={16} />
      </DialogClose>
    </RadixDialog.Content>
  </RadixDialog.Portal>
));
DialogContent.displayName = RadixDialog.Content.displayName;

export const DialogTitle = forwardRef<
  React.ElementRef<typeof RadixDialog.Title>,
  React.ComponentPropsWithoutRef<typeof RadixDialog.Title>
>(({ className, ...props }, ref) => (
  <RadixDialog.Title ref={ref} className={cn('text-base font-semibold text-ink leading-tight', className)} {...props} />
));
DialogTitle.displayName = RadixDialog.Title.displayName;

export const DialogDescription = forwardRef<
  React.ElementRef<typeof RadixDialog.Description>,
  React.ComponentPropsWithoutRef<typeof RadixDialog.Description>
>(({ className, ...props }, ref) => (
  <RadixDialog.Description ref={ref} className={cn('text-xs text-ink-muted mt-1', className)} {...props} />
));
DialogDescription.displayName = RadixDialog.Description.displayName;

export function DialogFooter({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('mt-6 flex justify-end gap-2', className)} {...props} />;
}
