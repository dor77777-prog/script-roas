// dashboard-web/src/components/ui/InsightCard.tsx
//
// Phase E1.6.1 UI overhaul — shared insight/recommendation card with tone variants.
// Replaces ad-hoc card surfaces in InsightsPanel, InsightsBoard, WhatsWorking, HealthScorePanel.
//
// Compound API (added in UI/UX overhaul):
//   <InsightCardGroup severity="warning" label="…" count={3}>…</InsightCardGroup>
//   <InsightCardRow severity="warning" title="…" detail="…" actions={…} />
// Both are also accessible as InsightCard.Group / InsightCard.Row (namespace style).

import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';
import { useState, type ReactNode } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';

// ---------------------------------------------------------------------------
// Flat InsightCard (original — unchanged for backwards compat)
// ---------------------------------------------------------------------------

const cardVariants = cva(
  'rounded-lg border p-4 flex flex-col gap-2',
  {
    variants: {
      tone: {
        warning: 'bg-status-warningBg text-status-warningFg border-status-warning',
        success: 'bg-status-greenBg text-status-greenFg border-status-green',
        info:    'bg-status-blueBg text-status-blueFg border-status-blue',
        neutral: 'bg-glass-2 text-ink border-glass-edge',
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

// ---------------------------------------------------------------------------
// Severity tokens
// ---------------------------------------------------------------------------

export type InsightSeverity = 'critical' | 'warning' | 'opportunity' | 'positive' | 'info';

/** Per-severity Tailwind class sets for Group container and Row icon badge. */
const SEVERITY_TOKENS: Record<
  InsightSeverity,
  {
    groupBg: string;
    groupBorder: string;
    groupHeader: string;    // text color for icon + label
    badge: string;          // count pill classes
    iconBadge: string;      // icon badge in rows
  }
> = {
  critical: {
    groupBg:     'bg-status-redBg/40',
    groupBorder: 'border-status-red/20',
    groupHeader: 'text-status-red',
    badge:       'bg-status-red text-white',
    iconBadge:   'bg-status-red/15 text-status-red ring-status-red/20',
  },
  warning: {
    groupBg:     'bg-status-warningBg',
    groupBorder: 'border-status-warning/30',
    groupHeader: 'text-status-warningFg',
    badge:       'bg-status-warning text-white',
    iconBadge:   'bg-status-warning/15 text-status-warningFg ring-status-warning/20',
  },
  opportunity: {
    groupBg:     'bg-accent/5',
    groupBorder: 'border-accent/15',
    groupHeader: 'text-accent',
    badge:       'bg-accent text-white',
    iconBadge:   'bg-status-blue/15 text-status-blue ring-status-blue/20',
  },
  positive: {
    groupBg:     'bg-status-greenBg/40',
    groupBorder: 'border-status-green/15',
    groupHeader: 'text-status-green',
    badge:       'bg-status-green text-white',
    iconBadge:   'bg-status-green/15 text-status-green ring-status-green/20',
  },
  info: {
    groupBg:     'bg-glass-2',
    groupBorder: 'border-glass-edge',
    groupHeader: 'text-ink-secondary',
    badge:       'bg-ink-muted text-white',
    iconBadge:   'bg-glass-1 text-ink-muted ring-glass-edge',
  },
};

// ---------------------------------------------------------------------------
// InsightCardGroup — collapsible severity section
// ---------------------------------------------------------------------------

export interface InsightCardGroupProps {
  severity: InsightSeverity;
  label: string;
  count: number;
  /** Whether the group body is initially open. Defaults to false. */
  defaultExpanded?: boolean;
  /** When true, clicking the header does NOT collapse the group. */
  alwaysExpanded?: boolean;
  /** Optional icon node shown before the label. */
  icon?: ReactNode;
  children: ReactNode;
  className?: string;
}

export function InsightCardGroup({
  severity,
  label,
  count,
  defaultExpanded = false,
  alwaysExpanded = false,
  icon,
  children,
  className,
}: InsightCardGroupProps) {
  const tokens = SEVERITY_TOKENS[severity];
  const [expanded, setExpanded] = useState(defaultExpanded);

  function handleToggle() {
    if (alwaysExpanded) return;
    setExpanded(v => !v);
  }

  const isOpen = alwaysExpanded ? true : expanded;

  return (
    <div
      className={cn(
        'border-b border-glass-edge last:border-b-0',
        tokens.groupBg,
        className,
      )}
    >
      {/* Header row */}
      <button
        type="button"
        onClick={handleToggle}
        className={cn(
          'w-full flex items-center gap-2 px-4 sm:px-5 py-2.5 sm:py-3',
          tokens.groupHeader,
          !alwaysExpanded && 'cursor-pointer',
          alwaysExpanded && 'cursor-default',
        )}
        aria-expanded={isOpen}
      >
        {icon && <span className="shrink-0">{icon}</span>}
        <span className="text-xs sm:text-sm font-semibold tracking-wide">{label}</span>
        <span
          className={cn(
            'inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 text-[10px] font-bold rounded-full tabular-nums',
            tokens.badge,
          )}
        >
          {count}
        </span>
        {!alwaysExpanded && (
          <span className="ml-auto text-ink-muted" aria-hidden>
            {isOpen ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          </span>
        )}
      </button>

      {/* Collapsible body */}
      {isOpen && <div>{children}</div>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// InsightCardRow — a single insight inside a group
// ---------------------------------------------------------------------------

export interface InsightCardRowProps {
  severity: InsightSeverity;
  /** Optional icon node for the severity badge. */
  icon?: ReactNode;
  title: ReactNode;
  detail?: ReactNode;
  /** Action buttons (Mark Done / Hide / Link / Why toggle) passed as JSX. */
  actions?: ReactNode;
  /**
   * "Why?" disclosure content — when provided, the row renders its own
   * expand/collapse toggle and shows this content below the action bar.
   * If actions already includes the Why toggle, pass whyDisclosure=undefined
   * and handle state externally.
   */
  whyDisclosure?: ReactNode;
  className?: string;
}

export function InsightCardRow({
  severity,
  icon,
  title,
  detail,
  actions,
  whyDisclosure,
  className,
}: InsightCardRowProps) {
  const tokens = SEVERITY_TOKENS[severity];
  const [whyOpen, setWhyOpen] = useState(false);

  return (
    <li
      className={cn(
        'group/insight px-4 sm:px-5 py-2.5 sm:py-3',
        'hover:bg-glass-1/60 transition-colors',
        'border-t border-glass-edge/50',
        className,
      )}
    >
      <div className="flex items-start gap-3">
        {/* Severity icon badge */}
        <span
          className={cn(
            'inline-flex items-center justify-center w-6 h-6 rounded-md shrink-0 mt-0.5',
            'bg-glass-1/80 ring-1 ring-inset',
            tokens.iconBadge,
          )}
        >
          {icon}
        </span>

        <div className="flex-1 min-w-0">
          {/* Title + detail */}
          <div className="text-sm font-semibold text-ink leading-snug">{title}</div>
          {detail && (
            <div className="text-xs sm:text-[13px] text-ink-secondary mt-0.5 leading-relaxed">
              {detail}
            </div>
          )}

          {/* Action bar */}
          {(actions || whyDisclosure) && (
            <div className="flex items-center gap-1 mt-2 flex-wrap">
              {actions}
              {whyDisclosure && (
                <button
                  type="button"
                  onClick={() => setWhyOpen(v => !v)}
                  className="h-auto gap-1 px-2 py-1 inline-flex items-center text-[11px] text-ink-muted hover:text-ink ml-auto rounded"
                >
                  {whyOpen ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
                  {whyOpen ? 'הסתר הסבר' : 'למה?'}
                </button>
              )}
            </div>
          )}

          {/* Why disclosure panel */}
          {whyDisclosure && whyOpen && (
            <div className="mt-2 px-2.5 py-1.5 text-[11px] sm:text-xs text-ink-secondary bg-glass-1/60 border-s-2 border-glass-edge rounded animate-fade-in leading-relaxed">
              {whyDisclosure}
            </div>
          )}
        </div>
      </div>
    </li>
  );
}

// ---------------------------------------------------------------------------
// Namespace-style compound exports  (InsightCard.Group / InsightCard.Row)
// ---------------------------------------------------------------------------
InsightCard.Group = InsightCardGroup;
InsightCard.Row   = InsightCardRow;
