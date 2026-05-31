// dashboard-web/src/components/ui/Stat.tsx
//
// Phase E1.6.1 UI overhaul — shared stat-block primitive. Replaces the
// inline `Stat()` functions in AdsDrawer.tsx and CampaignDrawer.tsx
// (which had diverged). Value content is auto-bdi-wrapped for safe
// Hebrew+English mixing.

import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';
import type { ReactNode } from 'react';

const statVariants = cva(
  'rounded-md border bg-glass-2 px-3 py-2 flex flex-col gap-1',
  {
    variants: {
      tone: {
        neutral: 'border-glass-edge',
        warning: 'border-status-warning bg-status-warningBg',
        success: 'border-status-green bg-status-greenBg',
        danger:  'border-status-red bg-status-redBg',
      },
    },
    defaultVariants: { tone: 'neutral' },
  },
);

export interface StatProps extends VariantProps<typeof statVariants> {
  label: string;
  value: string | number;
  help?: ReactNode;
  className?: string;
}

export function Stat({ label, value, tone, help, className }: StatProps) {
  return (
    <div className={cn(statVariants({ tone }), className)}>
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs text-ink-muted">{label}</span>
        {help}
      </div>
      <bdi dir="ltr" className="text-sm font-medium text-ink tabular-nums">{value}</bdi>
    </div>
  );
}
