'use client';

import { useEffect, useMemo, useState } from 'react';
import useSWR from 'swr';
import {
  AlertOctagon,
  AlertTriangle,
  Sparkles,
  Lightbulb,
  Trophy,
  ChevronDown,
  ChevronUp,
  ExternalLink,
  Info,
  RefreshCw,
  Check,
  EyeOff,
  Eye,
  Undo2,
  ArchiveX,
} from 'lucide-react';
import type { DashboardData } from '@/lib/types';
import type { ProductsResponse } from '@/app/api/products/route';
import type { CampaignsResponse } from '@/app/api/campaigns/route';
import {
  buildAllInsights,
  isInsightVisible,
  readInsightStates,
  writeInsightStates,
  type Insight,
  type InsightStates,
  type InsightStateKind,
  type Severity,
} from '@/lib/insights';
import { cn } from '@/lib/utils';
import { AiInsightPill } from '@/components/ui/AiInsightPill';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { InsightCardGroup, InsightCardRow } from '@/components/ui/InsightCard';
import { HelpTooltip } from '@/components/ui/Tooltip';

const fetcher = (url: string) => fetch(url).then(r => (r.ok ? r.json() : null));

const SEVERITY_META: Record<
  Severity,
  {
    label: string;
    icon: React.ReactNode;
    color: string;        // text + accent color
    bg: string;           // section background tint
    border: string;       // section border
    badge: string;        // pill background
  }
> = {
  critical: {
    label: 'דורש פעולה מיידית',
    icon: <AlertOctagon size={16} />,
    color: 'text-status-red',
    bg: 'bg-status-redBg/40',
    border: 'border-status-red/20',
    badge: 'bg-status-red text-white',
  },
  warning: {
    label: 'אזהרות',
    icon: <AlertTriangle size={16} />,
    color: 'text-status-warningFg',
    bg: 'bg-status-warningBg',
    border: 'border-status-warning/30',
    badge: 'bg-status-warning text-white',
  },
  opportunity: {
    label: 'הזדמנויות',
    icon: <Lightbulb size={16} />,
    color: 'text-accent',
    bg: 'bg-accent/5',
    border: 'border-accent/15',
    badge: 'bg-accent text-white',
  },
  positive: {
    label: 'חיובי',
    icon: <Trophy size={16} />,
    color: 'text-status-green',
    bg: 'bg-status-greenBg/40',
    border: 'border-status-green/15',
    badge: 'bg-status-green text-white',
  },
  info: {
    label: 'מידע',
    icon: <Info size={16} />,
    color: 'text-ink-secondary',
    bg: 'bg-glass-2',
    border: 'border-glass-edge',
    badge: 'bg-ink-muted text-white',
  },
};

const SEVERITY_ORDER: Severity[] = ['critical', 'warning', 'opportunity', 'positive', 'info'];

type Props = {
  data: DashboardData;
};

const BOARD_EXPANDED_KEY = 'roas-dashboard:insights-expanded';

export function InsightsBoard({ data }: Props) {
  const { data: products, isLoading: pLoading } = useSWR<ProductsResponse | null>(
    '/api/products', fetcher,
    { refreshInterval: 120_000, revalidateOnFocus: false },
  );
  const { data: campaigns, isLoading: cLoading } = useSWR<CampaignsResponse | null>(
    '/api/campaigns', fetcher,
    { refreshInterval: 120_000, revalidateOnFocus: false },
  );

  // Persisted per-insight state ("done" / "ignored") in localStorage.
  // We hydrate after mount to avoid SSR/client mismatch.
  const [states, setStates] = useState<InsightStates>({});
  const [hydrated, setHydrated] = useState(false);
  // Whole board collapsed/expanded — defaults to CLOSED so the home tab feels
  // calm on first load. Expansion is persisted across sessions.
  const [boardExpanded, setBoardExpanded] = useState(false);
  useEffect(() => {
    setStates(readInsightStates());
    try {
      const saved = window.localStorage.getItem(BOARD_EXPANDED_KEY);
      if (saved === '1') setBoardExpanded(true);
    } catch {
      /* ignore */
    }
    setHydrated(true);
    // Re-read whenever another device pushes an updated states map.
    const onChange = () => setStates(readInsightStates());
    window.addEventListener('roas-insight-states-changed', onChange);
    return () => window.removeEventListener('roas-insight-states-changed', onChange);
  }, []);
  function toggleBoard() {
    setBoardExpanded(prev => {
      const next = !prev;
      try {
        window.localStorage.setItem(BOARD_EXPANDED_KEY, next ? '1' : '0');
      } catch {
        /* ignore */
      }
      return next;
    });
  }

  function markInsight(insight: Insight, kind: InsightStateKind) {
    setStates(prev => {
      const next: InsightStates = {
        ...prev,
        [insight.id]: { state: kind, at: Date.now(), title: insight.title },
      };
      writeInsightStates(next);
      return next;
    });
  }

  function restoreInsight(id: string) {
    setStates(prev => {
      const next = { ...prev };
      delete next[id];
      writeInsightStates(next);
      return next;
    });
  }

  // Build the full list, then split into "visible now" and "hidden by user".
  const allInsights = useMemo(() => {
    return buildAllInsights(data.rows, campaigns?.rows ?? [], products?.rows ?? []);
  }, [data.rows, campaigns, products]);

  const { visible, hidden } = useMemo(() => {
    if (!hydrated) return { visible: allInsights, hidden: [] as Insight[] };
    const vis: Insight[] = [];
    const hid: Insight[] = [];
    for (const ins of allInsights) {
      if (isInsightVisible(ins.id, states)) vis.push(ins);
      else hid.push(ins);
    }
    return { visible: vis, hidden: hid };
  }, [allInsights, states, hydrated]);

  const grouped = useMemo(() => {
    const buckets: Record<Severity, Insight[]> = {
      critical: [], warning: [], opportunity: [], positive: [], info: [],
    };
    for (const i of visible) buckets[i.severity].push(i);
    return buckets;
  }, [visible]);

  const loading = pLoading || cLoading;
  const totalCount = visible.length;
  const hiddenCount = hidden.length;

  const [showHidden, setShowHidden] = useState(false);

  // Severity counts for the collapsed header badges — show critical / warning /
  // opportunity / positive even when the panel is closed, so the user has
  // instant signal of "do I need to open this now?" without clicking.
  const severityCounts = useMemo(() => {
    return {
      critical:    grouped.critical.length,
      warning:     grouped.warning.length,
      opportunity: grouped.opportunity.length,
      positive:    grouped.positive.length,
      info:        grouped.info.length,
    };
  }, [grouped]);

  // The "headline" insight surfaced when the board is collapsed. We pull it
  // from the highest-priority severity bucket and treat it as a typographic
  // moment — this is the component meant to be *memorable* on the dashboard,
  // not just another card. Falls through severities in priority order so we
  // always have one insight to feature when there's anything to say.
  const topInsight = useMemo<Insight | null>(() => {
    for (const sev of SEVERITY_ORDER) {
      if (grouped[sev].length > 0) return grouped[sev][0];
    }
    return null;
  }, [grouped]);

  return (
    <Card className="!p-0 overflow-hidden">
      {/* Clickable header — toggles the whole board open/closed. */}
      <Button
        type="button"
        variant="ghost"
        onClick={toggleBoard}
        aria-expanded={boardExpanded}
        className={cn(
          'w-full justify-start h-auto',
          'px-4 sm:px-6 py-4 sm:py-5',
          'border-b border-glass-edge',
          'bg-gradient-to-l from-accent/5 via-elevated to-elevated',
          'hover:from-accent/8 hover:to-elevated2/40',
        )}
      >
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <span className="inline-flex items-center justify-center w-9 h-9 sm:w-10 sm:h-10 rounded-xl bg-accent/10 text-accent shrink-0">
              <Sparkles size={18} />
            </span>
            <div className="min-w-0">
              <h2 className="text-base sm:text-xl font-bold text-ink tracking-tight leading-tight">
                תובנות חכמות
              </h2>
              <div className="text-[11px] sm:text-xs text-ink-muted mt-0.5 leading-tight">
                {loading && (
                  <span className="inline-flex items-center gap-1 mr-2">
                    <RefreshCw size={11} className="animate-spin" />
                    מנתח…
                  </span>
                )}
                {totalCount > 0
                  ? `${totalCount} ${totalCount === 1 ? 'תובנה פעילה' : 'תובנות פעילות'} · 14 ימים אחרונים`
                  : hiddenCount > 0
                  ? `${hiddenCount} תובנות מוסתרות זמינות בתחתית הלוח`
                  : '14 ימים אחרונים · מתעדכן כל דקה'}
              </div>
            </div>
          </div>

          {/* Right side: severity badges + chevron */}
          <div className="flex items-center gap-2 sm:gap-3 shrink-0">
            <SeverityBadges counts={severityCounts} compact={!boardExpanded} />
            <ChevronDown
              size={20}
              className={cn(
                'text-ink-muted transition-transform duration-DEFAULT',
                boardExpanded && 'rotate-180',
              )}
              aria-hidden
            />
          </div>
        </div>
      </Button>

      {/* AI-insight pill — surfaces the headline insight title as a one-line
          context cue inside the expanded board where the editorial InsightHero
          is absent. In the collapsed state, InsightHero already serves as the
          hero-summary slot, so hiding the pill there avoids duplicating the
          same title twice in the same viewport.
          AiInsightPill renders nothing when topInsight is null so no guard needed. */}
      {!loading && topInsight && boardExpanded && (
        <div className="px-4 sm:px-6 pb-0 pt-3">
          <AiInsightPill>{topInsight.title}</AiInsightPill>
        </div>
      )}

      {/* Memorable headline: when the board is collapsed AND we have something
          to say, surface the top insight as an editorial moment — large title,
          vertical accent bar in the severity color, short "click for the rest"
          hint. Per frontend-design's "give the user one thing they'll
          remember" principle, this is the dashboard's signature surface. */}
      {!boardExpanded && topInsight && !loading && (
        <InsightHero
          insight={topInsight}
          otherCount={totalCount - 1}
          onClick={toggleBoard}
        />
      )}

      {/* All-clear state — calm dark panel with a soft green pulse so the user
          can instantly see "nothing demands my attention right now". */}
      {!boardExpanded && hiddenCount === 0 && totalCount === 0 && !loading && (
        <div className="px-5 sm:px-6 py-5 flex items-center gap-3">
          <span className="relative inline-flex w-2.5 h-2.5 shrink-0">
            <span className="absolute inset-0 rounded-full bg-status-green/40 animate-ping" />
            <span className="relative inline-flex w-full h-full rounded-full bg-status-green" />
          </span>
          <div className="text-[12px] sm:text-sm text-ink-secondary">
            <span className="text-ink font-semibold">הכל רגוע.</span>{' '}
            <span className="text-ink-muted">המערכת לא זיהתה אנומליות או הזדמנויות פעילות.</span>
          </div>
        </div>
      )}

      {boardExpanded && !loading && totalCount === 0 && hiddenCount === 0 && (
        <div className="px-4 sm:px-5 py-10 text-center text-ink-muted">
          <Sparkles size={28} className="mx-auto mb-2 text-ink-muted/60" />
          <div className="text-sm">אין תובנות חדשות לרגע זה.</div>
          <div className="text-[11px] mt-1">
            המערכת תזהה אנומליות והזדמנויות ברגע שייווצרו.
          </div>
        </div>
      )}

      {/* Grouped insights — only when expanded */}
      {boardExpanded && totalCount > 0 && (
        <div className="animate-fade-in">
          {SEVERITY_ORDER.map(sev => {
            const list = grouped[sev];
            if (list.length === 0) return null;
            const meta = SEVERITY_META[sev];
            // critical and warning are always shown expanded; others start collapsed.
            const alwaysExpanded = sev === 'critical' || sev === 'warning';
            return (
              <InsightCardGroup
                key={sev}
                severity={sev}
                label={meta.label}
                count={list.length}
                icon={meta.icon}
                alwaysExpanded={alwaysExpanded}
                defaultExpanded={alwaysExpanded}
              >
                <InsightGroupBody
                  severity={sev}
                  meta={meta}
                  items={list}
                  onMark={markInsight}
                />
              </InsightCardGroup>
            );
          })}
        </div>
      )}

      {boardExpanded && loading && totalCount === 0 && (
        <div className="px-4 py-8 text-center text-sm text-ink-muted">
          מנתח נתונים…
        </div>
      )}

      {/* Hidden / muted insights — only meaningful when the board is open */}
      {boardExpanded && hiddenCount > 0 && (
        <div className="border-t border-glass-edge bg-glass-2/30">
          <Button
            variant="ghost"
            onClick={() => setShowHidden(v => !v)}
            className="w-full justify-between h-auto px-4 sm:px-5 py-2.5 text-ink-secondary hover:text-ink"
          >
            <span className="inline-flex items-center gap-2 text-xs sm:text-sm">
              {showHidden ? <Eye size={14} /> : <EyeOff size={14} />}
              <span className="font-medium">
                {hiddenCount} תובנות מוסתרות
              </span>
              <span className="text-ink-muted text-[11px]">
                (סומנו כבוצעו או הוסתרו ידנית)
              </span>
            </span>
            {showHidden ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          </Button>
          {showHidden && (
            <ul className="divide-y divide-glass-edge/70 animate-fade-in">
              {hidden.map(ins => {
                const st = states[ins.id];
                const meta = SEVERITY_META[ins.severity];
                const stateLabel = st?.state === 'done' ? 'סומן כבוצע' : 'הוסתר';
                return (
                  <li key={ins.id} className="px-4 sm:px-5 py-2.5 flex items-start gap-3">
                    <span
                      className={cn(
                        'inline-flex items-center justify-center w-6 h-6 rounded-md shrink-0 mt-0.5 opacity-60',
                        meta.color, 'bg-glass-1 ring-1 ring-inset', meta.border,
                      )}
                    >
                      {meta.icon}
                    </span>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium text-ink-secondary leading-snug truncate">
                        {ins.title}
                      </div>
                      <div className="text-[11px] text-ink-muted mt-0.5">
                        {stateLabel}{st?.at ? ` · ${relativeTime(st.at)}` : ''}
                      </div>
                    </div>
                    <Button
                      variant="ghost"
                      onClick={() => restoreInsight(ins.id)}
                      className="gap-1 px-2 py-1 h-auto text-[11px] font-semibold text-accent hover:bg-accent/10 shrink-0"
                      title="שחזר תובנה לרשימה הראשית"
                    >
                      <Undo2 size={11} />
                      שחזר
                    </Button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </Card>
  );
}

/**
 * Editorial "headline" preview shown when the board is collapsed and there's
 * at least one insight. Treats the insight title as a typographic moment —
 * larger size, looser tracking, a vertical accent bar in the severity color —
 * so the surface feels different from the surrounding KPI grid. Clicking
 * anywhere opens the board.
 */
function InsightHero({
  insight,
  otherCount,
  onClick,
}: {
  insight: Insight;
  otherCount: number;
  onClick: () => void;
}) {
  const meta = SEVERITY_META[insight.severity];
  // Map the meta's "border-X/20" to a solid accent on the bar so the colour
  // reads at full strength against the white surface (border-opacity is too
  // muted for the kind of vertical-rule moment we want here).
  const ACCENT_BG: Record<Severity, string> = {
    critical:    'bg-status-red',
    warning:     'bg-status-warning',
    opportunity: 'bg-accent',
    positive:    'bg-status-green',
    info:        'bg-ink-muted',
  };
  return (
    <Button
      type="button"
      variant="ghost"
      onClick={onClick}
      className="w-full justify-start items-stretch h-auto gap-4 sm:gap-5 px-4 sm:px-6 py-4 sm:py-5"
      aria-label={`פתח לוח תובנות (${insight.title})`}
    >
      {/* Vertical accent bar — anchors the typographic moment and signals
          severity at a glance. */}
      <span
        className={cn(
          'shrink-0 w-[3px] rounded-full',
          ACCENT_BG[insight.severity],
        )}
        aria-hidden
      />

      <div className="min-w-0 flex-1 space-y-1.5">
        <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.12em] font-semibold">
          <span className={meta.color}>{meta.label}</span>
          {otherCount > 0 && (
            <span className="text-ink-muted normal-case tracking-normal font-normal">
              · עוד {otherCount} {otherCount === 1 ? 'תובנה' : 'תובנות'}
            </span>
          )}
        </div>
        <div className="text-base sm:text-lg md:text-xl font-semibold text-ink leading-snug tracking-tight">
          {insight.title}
        </div>
        {insight.detail && (
          <p className="text-[12px] sm:text-sm text-ink-secondary leading-relaxed line-clamp-2 max-w-2xl">
            {insight.detail}
          </p>
        )}
        <div className="pt-1 text-[11px] text-ink-muted opacity-0 group-hover:opacity-100 transition-opacity">
          לחץ לפרטים ולכל התובנות ←
        </div>
      </div>
    </Button>
  );
}

/**
 * Inner body for a severity group — manages the "show all / show 3" state
 * and renders each insight as an InsightCardRow.
 * InsightCardGroup provides the header/collapsible shell; this is the content.
 */
function InsightGroupBody({
  severity,
  meta,
  items,
  onMark,
}: {
  severity: Severity;
  meta: typeof SEVERITY_META[Severity];
  items: Insight[];
  onMark: (insight: Insight, kind: InsightStateKind) => void;
}) {
  const showAllByDefault = severity === 'critical' || severity === 'warning';
  const [showAll, setShowAll] = useState(showAllByDefault);
  const visibleItems = showAll ? items : items.slice(0, 3);
  const remaining = items.length - visibleItems.length;

  return (
    <>
      <ul className="space-y-px">
        {visibleItems.map(insight => (
          <InsightBoardRow key={insight.id} insight={insight} meta={meta} onMark={onMark} />
        ))}
      </ul>
      {remaining > 0 && (
        <div className="px-4 sm:px-5 py-2">
          <Button
            variant="ghost"
            onClick={() => setShowAll(v => !v)}
            className={cn(
              'h-auto p-0 text-[11px] sm:text-xs font-medium gap-1',
              meta.color, 'hover:opacity-80',
            )}
          >
            {showAll ? (
              <>
                <ChevronUp size={12} />
                הצג פחות
              </>
            ) : (
              <>
                <ChevronDown size={12} />
                הצג עוד {remaining}
              </>
            )}
          </Button>
        </div>
      )}
    </>
  );
}

/**
 * Single insight row inside the board — delegates rendering to InsightCardRow
 * and assembles the action buttons + optional scope badge as ReactNode props.
 */
function InsightBoardRow({
  insight,
  meta,
  onMark,
}: {
  insight: Insight;
  meta: typeof SEVERITY_META[Severity];
  onMark: (insight: Insight, kind: InsightStateKind) => void;
}) {
  // Compose title with optional scope badge inline so InsightCardRow's title slot
  // can stay a single ReactNode (no extra props needed).
  const titleNode = (
    <div className="flex items-start justify-between gap-2 flex-wrap">
      <span>{insight.title}</span>
      {insight.scope && (
        <span className="inline-block text-[10px] sm:text-[11px] font-medium text-ink-muted bg-glass-1/80 border border-glass-edge px-1.5 py-0.5 rounded shrink-0">
          {insight.scope}
        </span>
      )}
    </div>
  );

  // Compose the action bar — Mark Done / Hide / External link.
  // The "Why?" disclosure is handled by InsightCardRow's whyDisclosure prop.
  const actionsNode = (
    <>
      {/* Mark done — ghost gray, turns green on hover */}
      <Button
        variant="secondary"
        onClick={() => onMark(insight, 'done')}
        className={cn(
          'gap-1 px-2 py-1 h-auto text-[11px] font-medium',
          'text-ink-secondary hover:text-status-green hover:border-status-green/40 hover:bg-status-greenBg/40',
        )}
        title="סמן שטיפלתי בזה — יוסתר ל-7 ימים, יחזור אם הבעיה תחזור"
      >
        <Check size={12} />
        טיפלתי
      </Button>
      {/* Hide */}
      <Button
        variant="ghost"
        onClick={() => onMark(insight, 'ignored')}
        className="gap-1 px-2 py-1 h-auto text-[11px] font-medium text-ink-muted hover:text-ink"
        title="הסתר — לא יחזור עד שתשחזר ידנית"
      >
        <ArchiveX size={12} />
        הסתר
      </Button>
      {/* External link */}
      {insight.href && (
        <a
          href={insight.href}
          target="_blank"
          rel="noopener noreferrer"
          className={cn(
            'inline-flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-semibold',
            'border border-transparent',
            meta.color,
            'hover:bg-glass-1/80 hover:border-glass-edge',
            'transition-colors',
          )}
        >
          <ExternalLink size={11} />
          פתח קמפיין
        </a>
      )}
    </>
  );

  return (
    <InsightCardRow
      severity={insight.severity}
      icon={meta.icon}
      title={titleNode}
      detail={insight.detail}
      actions={actionsNode}
      whyDisclosure={insight.why ?? undefined}
    />
  );
}

/**
 * Severity pills shown next to the board header. When the board is collapsed
 * they double as the at-a-glance signal — "how urgent is whatever's inside?".
 * In compact mode we only show severities that have a non-zero count.
 */
function SeverityBadges({
  counts,
  compact,
}: {
  counts: Record<Severity, number>;
  compact: boolean;
}) {
  const items: Array<{ sev: Severity; count: number }> = SEVERITY_ORDER
    .map(sev => ({ sev, count: counts[sev] }))
    .filter(x => x.count > 0);

  if (items.length === 0) return null;

  return (
    <div className="flex items-center gap-1 sm:gap-1.5">
      {items.map(({ sev, count }) => {
        const meta = SEVERITY_META[sev];
        return (
          <HelpTooltip key={sev} content={`${meta.label}: ${count}`}>
            <span
              className={cn(
                'inline-flex items-center gap-1 rounded-full',
                compact ? 'px-1.5 py-0.5' : 'px-2 py-0.5',
                'text-[10px] sm:text-[11px] font-bold tabular-nums',
                meta.badge,
              )}
            >
              {!compact && <span className="opacity-90">{meta.icon}</span>}
              <span>{count}</span>
            </span>
          </HelpTooltip>
        );
      })}
    </div>
  );
}

/**
 * Compact relative-time formatter — "לפני 3 שעות", "אתמול", etc.
 * Avoids pulling date-fns just for this one place.
 */
function relativeTime(ts: number): string {
  const diff = Date.now() - ts;
  const min = Math.floor(diff / 60_000);
  if (min < 1) return 'הרגע';
  if (min < 60) return `לפני ${min} ${min === 1 ? 'דקה' : 'דק׳'}`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `לפני ${hr} ${hr === 1 ? 'שעה' : 'שעות'}`;
  const day = Math.floor(hr / 24);
  if (day < 7) return `לפני ${day} ${day === 1 ? 'יום' : 'ימים'}`;
  const wk = Math.floor(day / 7);
  return `לפני ${wk} ${wk === 1 ? 'שבוע' : 'שבועות'}`;
}
