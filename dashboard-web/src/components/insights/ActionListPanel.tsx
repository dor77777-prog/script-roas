'use client';

/**
 * ActionListPanel — WS3 "פעולות דחופות כרגע" (do-this-now) action list.
 *
 * Always-visible panel mounted ABOVE the (collapsed-by-default) InsightsBoard.
 * Its job: take the board's prioritized + already-visible insights and surface
 * the curated short list as an actionable to-do, so the operator's most urgent
 * items aren't trapped inside a collapsed board. The board below remains the
 * full searchable archive.
 *
 * This is a thin PRESENTATIONAL layer:
 *   - it does NO detection, NO prioritization, NO visibility filtering — the
 *     parent (InsightsBoard) passes `prioritizeInsights(visibleInsights, n)`;
 *   - it reuses the shared `InsightCardRow` primitive (so it re-skins with the
 *     board and inherits the severity tokens) and the shared `InsightActions`
 *     (drawer + Ads-Manager pair). The only row chrome it owns is the
 *     "טיפלתי" / "הסתר" mark buttons, mirroring InsightsBoard's row.
 *
 * Three body states: loading (analyzing, no results yet) → calm "all good"
 * empty state → the rows. Criticals can exceed the soft cap upstream, so the
 * count is simply `insights.length`.
 */

import {
  AlertOctagon,
  AlertTriangle,
  Lightbulb,
  Trophy,
  Info,
  Zap,
  RefreshCw,
  Check,
  ArchiveX,
} from 'lucide-react';
import type { ReactNode } from 'react';
import type { Insight, InsightStateKind, Severity } from '@/lib/insights';
import type { AdAccountMap } from '@/lib/campaignsLinks';
import { cn } from '@/lib/utils';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Heading } from '@/components/ui/Typography';
import { HelpTooltip } from '@/components/ui/Tooltip';
import { InsightCardRow } from '@/components/ui/InsightCard';
import { InsightActions } from '@/components/insights/InsightActions';

/** Per-severity icon — same set the InsightsBoard uses, so the two surfaces
 *  speak the same visual language. */
const SEVERITY_ICON: Record<Severity, ReactNode> = {
  critical: <AlertOctagon size={16} />,
  warning: <AlertTriangle size={16} />,
  opportunity: <Lightbulb size={16} />,
  positive: <Trophy size={16} />,
  info: <Info size={16} />,
};

type Props = {
  /** Prioritized + visible insights to surface (parent already ran
   *  prioritizeInsights + visibility filtering). */
  insights: Insight[];
  /** True while the underlying SWR data is still loading — suppresses the
   *  "all good" empty state so we don't flash "nothing to do" before data lands. */
  loading?: boolean;
  /**
   * P1-4c (2026-06-10 state-honesty sweep) — true when ANY of the parent's
   * data feeds FAILED. A failed feed means the analysis is blind, so the calm
   * green "אין פעולות דחופות כרגע. הכול נראה תקין." all-clear would be a lie
   * (an outage rendered as a healthy business). Renders a neutral
   * can't-analyze state instead.
   */
  error?: boolean;
  onMark: (insight: Insight, kind: InsightStateKind) => void;
  adAccounts: AdAccountMap;
  className?: string;
};

export function ActionListPanel({ insights, loading, error, onMark, adAccounts, className }: Props) {
  const count = insights.length;

  return (
    <Card data-testid="action-list-panel" className={cn('!p-0 overflow-hidden', className)}>
      {/* Header — Horizon recipe (W3.7): a neutral icon-circle (Widget token:
          bg-lightPrimary / dark:bg-navy-700) + title + count chip, on a hairline
          divider. Replaces the old accent-gradient band so the surface matches
          the consistent Horizon header used across the home cards. */}
      <div className="flex items-center gap-3 px-4 sm:px-6 py-4 border-b border-glass-edge">
        <span className="inline-flex items-center justify-center w-9 h-9 sm:w-10 sm:h-10 rounded-full bg-lightPrimary text-brand-500 dark:bg-navy-700 dark:text-ink shrink-0">
          <Zap size={18} />
        </span>
        <div className="min-w-0 flex-1">
          <Heading level="hero">פעולות דחופות כרגע</Heading>
          <div className="text-fs-2xs sm:text-fs-xs text-ink-muted mt-0.5 leading-tight">
            {count > 0
              ? 'המהלכים החשובים ביותר לטיפול — מדורגים לפי דחיפות'
              : 'הרשימה מתעדכנת אוטומטית כשמשהו דורש את תשומת ליבך'}
          </div>
        </div>
        <span
          data-testid="action-list-count"
          className="inline-flex items-center justify-center min-w-[26px] h-6 px-2 text-fs-xs font-bold rounded-full tabular-nums bg-accent-soft text-accent-deep shrink-0"
        >
          {count}
        </span>
      </div>

      {/* Body — order matters: loading → error → all-clear. The all-clear is
          allowed ONLY on settled SUCCESS with zero insights (P1-4c). */}
      {count === 0 ? (
        loading ? (
          <div className="px-5 sm:px-6 py-6 flex items-center gap-2 text-sm text-ink-muted">
            <RefreshCw size={14} className="animate-spin" />
            מנתח נתונים…
          </div>
        ) : error ? (
          <div
            role="alert"
            data-testid="action-list-error"
            className="px-5 sm:px-6 py-6 flex items-center gap-3"
          >
            <AlertTriangle size={16} className="shrink-0 text-ink-muted" aria-hidden />
            <div className="text-fs-xs sm:text-fs-sm text-ink-secondary">
              <span className="text-ink font-semibold">לא ניתן לטעון תובנות כרגע.</span>{' '}
              <span className="text-ink-muted">
                אחת מקריאות הנתונים נכשלה — זה לא אומר שהכול תקין. נסה לרענן בעוד רגע.
              </span>
            </div>
          </div>
        ) : (
          <div className="px-5 sm:px-6 py-6 flex items-center gap-3">
            <span className="relative inline-flex w-2.5 h-2.5 shrink-0">
              <span className="absolute inset-0 rounded-full bg-status-greenBg animate-ping" />
              <span className="relative inline-flex w-full h-full rounded-full bg-status-green" />
            </span>
            <div className="text-fs-xs sm:text-fs-sm text-ink-secondary">
              <span className="text-ink font-semibold">אין פעולות דחופות כרגע.</span>{' '}
              <span className="text-ink-muted">הכול נראה תקין.</span>
            </div>
          </div>
        )
      ) : (
        <ul className="divide-y divide-glass-edge/50">
          {insights.map((insight) => (
            <ActionRow key={insight.id} insight={insight} onMark={onMark} adAccounts={adAccounts} />
          ))}
        </ul>
      )}
    </Card>
  );
}

/**
 * Single action row — delegates to the shared InsightCardRow primitive and
 * assembles the mark buttons + InsightActions as its action cluster. Mirrors
 * InsightsBoard's InsightBoardRow so the two surfaces stay consistent.
 */
function ActionRow({
  insight,
  onMark,
  adAccounts,
}: {
  insight: Insight;
  onMark: (insight: Insight, kind: InsightStateKind) => void;
  adAccounts: AdAccountMap;
}) {
  const titleNode = (
    <div className="flex items-start justify-between gap-2 flex-wrap">
      <span>{insight.title}</span>
      {insight.scope && (
        <span className="inline-block text-fs-2xs font-medium text-ink-muted bg-pill-track border border-glass-edge px-1.5 py-0.5 rounded shrink-0">
          {insight.scope}
        </span>
      )}
    </div>
  );

  const actionsNode = (
    <>
      <HelpTooltip content="סמן שטיפלתי בזה — יוסתר ל-7 ימים, יחזור אם הבעיה תחזור">
        <Button
          variant="secondary"
          onClick={() => onMark(insight, 'done')}
          className={cn(
            'gap-1 px-2 py-1 h-auto text-fs-2xs font-medium',
            'text-ink-secondary hover:text-status-greenFg hover:border-status-green hover:bg-status-greenBg',
          )}
        >
          <Check size={12} />
          טיפלתי
        </Button>
      </HelpTooltip>
      <HelpTooltip content="הסתר — לא יחזור עד שתשחזר ידנית">
        <Button
          variant="ghost"
          onClick={() => onMark(insight, 'ignored')}
          className="gap-1 px-2 py-1 h-auto text-fs-2xs font-medium text-ink-muted hover:text-ink"
        >
          <ArchiveX size={12} />
          הסתר
        </Button>
      </HelpTooltip>
      <InsightActions
        campaignId={insight.campaignId}
        campaignName={insight.campaignName}
        platform={insight.platform}
        storeId={insight.storeId}
        adAccounts={adAccounts}
      />
    </>
  );

  return (
    <InsightCardRow
      severity={insight.severity}
      icon={SEVERITY_ICON[insight.severity]}
      title={titleNode}
      detail={insight.detail}
      actions={actionsNode}
      whyDisclosure={insight.why}
    />
  );
}
