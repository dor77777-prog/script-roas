// dashboard-web/src/components/ui/InsightCard.tsx
//
// Phase E1.6.1 UI overhaul — shared insight/recommendation card with tone variants.
// Replaces ad-hoc card surfaces in InsightsPanel, InsightsBoard, WhatsWorking, HealthScorePanel.

import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';
import type { ReactNode } from 'react';

const cardVariants = cva(
  'rounded-lg border p-4 flex flex-col gap-2',
  {
    variants: {
      tone: {
        warning: 'bg-status-warningBg text-status-warningFg border-status-warning',
        success: 'bg-status-greenBg text-status-greenFg border-status-green',
        info:    'bg-status-blueBg text-status-blueFg border-status-blue',
        neutral: 'bg-elevated2 text-ink border-line',
      },
    },
    defaultVariants: { tone: 'neutral' },
  },
);

export interface InsightCardProps extends VariantProps<typeof cardVariants> {
  title: string;
  children: ReactNode;
  className?: string;
  action?: ReactNode;
}

export function InsightCard({ title, children, tone, action, className }: InsightCardProps) {
  return (
    <div className={cn(cardVariants({ tone }), className)}>
      <div className="flex items-center justify-between gap-2">
        <h4 className="text-sm font-medium">{title}</h4>
        {action}
      </div>
      <div className="text-sm">{children}</div>
    </div>
  );
}
