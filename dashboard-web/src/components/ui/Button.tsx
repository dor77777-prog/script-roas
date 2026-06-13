import { forwardRef, type ButtonHTMLAttributes } from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

// Per-variant focus rings (P0-11):
// Primary (violet bg) and destructive (red bg) need *contrast* rings — a
// same-color-as-bg ring is invisible. We use the variant's own *foreground*
// token for the ring and a 2-px canvas offset so the ring reads against the
// dark canvas regardless of where the button sits. Secondary / ghost / link
// keep the standard accent ring because their backgrounds are neutral and
// violet provides plenty of contrast.
const buttonVariants = cva(
  'inline-flex items-center justify-center gap-1.5 whitespace-nowrap font-medium ' +
    'transition-colors focus-visible:outline-none focus-visible:ring-2 ' +
    'focus-visible:ring-offset-2 focus-visible:ring-offset-canvas cursor-pointer disabled:opacity-50 disabled:pointer-events-none disabled:cursor-not-allowed',
  {
    variants: {
      variant: {
        primary:     'bg-accent-btn text-accent-fg hover:bg-accent-btnHover focus-visible:ring-accent-fg',
        secondary:   'bg-glass-2 text-ink border border-glass-edge hover:bg-glass-1 focus-visible:ring-accent',
        ghost:       'text-ink hover:bg-glass-2 focus-visible:ring-accent',
        destructive: 'bg-status-redBtn text-accent-fg hover:bg-[color-mix(in_oklab,var(--status-red-btn)_88%,black)] focus-visible:ring-status-redFg',
        link:        'text-accent underline-offset-4 hover:underline focus-visible:ring-accent',
      },
      size: {
        sm: 'h-8 px-3 text-xs rounded-md',
        md: 'h-9 px-4 text-sm rounded-md',
        lg: 'h-10 px-5 text-sm rounded-lg',
        icon: 'h-9 w-9 rounded-md',
      },
    },
    defaultVariants: { variant: 'primary', size: 'md' },
  },
);

export interface ButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp: React.ElementType = asChild ? Slot : 'button';
    return <Comp ref={ref} className={cn(buttonVariants({ variant, size }), className)} {...props} />;
  },
);
Button.displayName = 'Button';
