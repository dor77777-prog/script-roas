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
import type { AdsResponse } from '@/app/api/ads/route';
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
import { prioritizeInsights } from '@/lib/insights/prioritize';
import { cn } from '@/lib/utils';
import { fetchJsonOrNull } from '@/lib/fetchJson';
import { AiInsightPill } from '@/components/ui/AiInsightPill';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { InsightCardGroup, InsightCardRow } from '@/components/ui/InsightCard';
import { Heading } from '@/components/ui/Typography';
import { HelpTooltip } from '@/components/ui/Tooltip';
import { InsightActions } from '@/components/insights/InsightActions';
import { ActionListPanel } from '@/components/insights/ActionListPanel';
import { useStoreAdAccounts } from '@/lib/hooks/useStoreAdAccounts';

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
    color: 'text-status-redFg',
    bg: 'bg-status-redBg',
    border: 'border-status-red',
    badge: 'bg-status-redBg text-status-redFg',
  },
  warning: {
    label: 'אזהרות',
    icon: <AlertTriangle size={16} />,
    color: 'text-status-warningFg',
    bg: 'bg-status-warningBg',
    border: 'border-status-warning',
    badge: 'bg-status-warningBg text-status-warningFg',
  },
  opportunity: {
    label: 'הזדמנויות',
    icon: <Lightbulb size={16} />,
    color: 'text-accent-deep',
    bg: 'bg-accent-bg',
    border: 'border-accent',
    badge: 'bg-accent text-accent-fg',
  },
  positive: {
    label: 'חיובי',
    icon: <Trophy size={16} />,
    color: 'text-status-greenFg',
    bg: 'bg-status-greenBg',
    border: 'border-status-green',
    badge: 'bg-status-greenBg text-status-greenFg',
  },
  info: {
    label: 'מידע',
    icon: <Info size={16} />,
    color: 'text-ink-secondary',
    bg: 'bg-glass-2',
    border: 'border-glass-edge',
    badge: 'bg-status-grayBg text-status-grayFg',
  },
};

const SEVERITY_ORDER: Severity[] = ['critical', 'warning', 'opportunity', 'positive', 'info'];

type Props = {
  data: DashboardData;
};

const BOARD_EXPANDED_KEY = 'roas-dashboard:insights-expanded';

export function InsightsBoard({ data }: Props) {
  const { data: products, isLoading: pLoading } = useSWR<ProductsResponse | null>(
    '/api/products', fetchJsonOrNull,
    { refreshInterval: 120_000, revalidateOnFocus: false },
  );
  const { data: campaigns, isLoading: cLoading } = useSWR<CampaignsResponse | null>(
    '/api/campaigns', fetchJsonOrNull,
    { refreshInterval: 120_000, revalidateOnFocus: false },
  );
  // WS3 — per-day ad rows power the creative-fatigue detector (CTR decay +
  // CPM creep). Same cadence as products/campaigns; dedupes with CampaignsTable's
  // ads fetch via SWR's key cache.
  const { data: ads, isLoading: aLoading } = useSWR<AdsResponse | null>(
    '/api/ads', fetchJsonOrNull,
    { refreshInterval: 120_000, revalidateOnFocus: false },
  );
  // Task 5.6 (P1-10 / Q7) — feeds `InsightActions` deep-links with
  // account-aware URLs. Hook dedupes the SWR call with CampaignsTable.
  const adAccounts = useStoreAdAccounts();

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
    return buildAllInsights(
      data.rows,
      campaigns?.rows ?? [],
      products?.rows ?? [],
      ads?.rows ?? [],
      { currentEffectiveStatus: campaigns?.currentEffectiveStatus },
    );
  }, [data.rows, campaigns, products, ads]);

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

  // WS3 — the "do this now" short list: dedup + rank the visible insights and
  // keep the top few (criticals always survive the cut). Surfaced ABOVE the
  // board so urgent items aren't trapped inside a collapsed panel.
  const prioritized = useMemo(() => prioritizeInsights(visible, 5), [visible]);

  const grouped = useMemo(() => {
    const buckets: Record<Severity, Insight[]> = {
      critical: [], warning: [], opportunity: [], positive: [], info: [],
    };
    for (const i of visible) buckets[i.severity].push(i);
    return buckets;
  }, [visible]);

  const loading = pLoading || cLoading || aLoading;
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
    <div className="space-y-4 sm:space-y-5">
      {/* WS3 — "do this now" action list. Always visible, ABOVE the board, so
          the most urgent items are never trapped behind a collapsed panel. It
          owns the collapsed-state headline + the all-clear signal; the board
          below stays the full, grouped, searchable archive. */}
      <ActionListPanel
        insights={prioritized}
        loading={loading}
        onMark={markInsight}
        adAccounts={adAccounts}
      />
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
          'bg-gradient-to-l from-accent-bg via-glass-1 to-glass-1',
          'hover:from-accent-soft hover:to-glass-2/40',
        )}
      >
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <span className="inline-flex items-center justify-center w-9 h-9 sm:w-10 sm:h-10 rounded-xl bg-accent-bg text-accent shrink-0">
              <Sparkles size={18} />
            </span>
            <div className="min-w-0">
              <Heading level="hero">
                תובנות חכמות
              </Heading>
              <div className="text-[11px] sm:text-xs text-ink-muted mt-0.5 leading-tight">
                {loading && (
                  <span className="inline-flex items-center gap-1 me-2">
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

      {/* AI-insight pill — one-line context cue inside the EXPANDED board.
          WS3: the collapsed-state headline + the all-clear signal now live in
          the always-visible ActionListPanel above this card, so the old
          InsightHero / all-clear surfaces were removed from here to avoid
          duplicating the same top insight twice in one viewport.
          AiInsightPill renders nothing when topInsight is null so no guard needed. */}
      {!loading && topInsight && boardExpanded && (
        <div className="px-4 sm:px-6 pb-0 pt-3">
          <AiInsightPill>{topInsight.title}</AiInsightPill>
        </div>
      )}

      {boardExpanded && !loading && totalCount === 0 && hiddenCount === 0 && (
        <div className="px-4 sm:px-5 py-10 text-center text-ink-muted">
          <Sparkles size={28} className="mx-auto mb-2 text-ink-subtle" />
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
                  adAccounts={adAccounts}
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
                    <HelpTooltip content="שחזר תובנה לרשימה הראשית">
                      <Button
                        variant="ghost"
                        onClick={() => restoreInsight(ins.id)}
                        className="gap-1 px-2 py-1 h-auto text-[11px] font-semibold text-accent hover:bg-accent-bg shrink-0"
                      >
                        <Undo2 size={11} />
                        שחזר
                      </Button>
                    </HelpTooltip>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </Card>
    </div>
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
  adAccounts,
}: {
  severity: Severity;
  meta: typeof SEVERITY_META[Severity];
  items: Insight[];
  onMark: (insight: Insight, kind: InsightStateKind) => void;
  adAccounts: import('@/lib/campaignsLinks').AdAccountMap;
}) {
  const showAllByDefault = severity === 'critical' || severity === 'warning';
  const [showAll, setShowAll] = useState(showAllByDefault);
  const visibleItems = showAll ? items : items.slice(0, 3);
  const remaining = items.length - visibleItems.length;

  return (
    <>
      <ul className="space-y-px">
        {visibleItems.map(insight => (
          <InsightBoardRow
            key={insight.id}
            insight={insight}
            meta={meta}
            onMark={onMark}
            adAccounts={adAccounts}
          />
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
  adAccounts,
}: {
  insight: Insight;
  meta: typeof SEVERITY_META[Severity];
  onMark: (insight: Insight, kind: InsightStateKind) => void;
  adAccounts: import('@/lib/campaignsLinks').AdAccountMap;
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

  // Compose the action bar — Mark Done / Hide / InsightActions (Q7).
  // The "Why?" disclosure is handled by InsightCardRow's whyDisclosure prop.
  // Task 5.6: pre-Q7 we rendered a single external `href` link with a
  // "פתח קמפיין" label that ALWAYS opened the platform's Ads Manager.
  // That conflated two distinct intents (read context in the dashboard
  // vs. take action on the platform) into one ambiguous CTA. The new
  // `InsightActions` splits them — primary opens the in-app drawer,
  // secondary deep-links to Ads Manager. Falls back to nothing when
  // the insight has no campaign reference (e.g. store-level anomaly).
  // `meta` is still used downstream by `InsightCardRow` for the row's
  // icon styling (see line 646), so it stays in scope.
  const actionsNode = (
    <>
      {/* Mark done — ghost gray, turns green on hover */}
      <HelpTooltip content="סמן שטיפלתי בזה — יוסתר ל-7 ימים, יחזור אם הבעיה תחזור">
        <Button
          variant="secondary"
          onClick={() => onMark(insight, 'done')}
          className={cn(
            'gap-1 px-2 py-1 h-auto text-[11px] font-medium',
            'text-ink-secondary hover:text-status-greenFg hover:border-status-green hover:bg-status-greenBg',
          )}
        >
          <Check size={12} />
          טיפלתי
        </Button>
      </HelpTooltip>
      {/* Hide */}
      <HelpTooltip content="הסתר — לא יחזור עד שתשחזר ידנית">
        <Button
          variant="ghost"
          onClick={() => onMark(insight, 'ignored')}
          className="gap-1 px-2 py-1 h-auto text-[11px] font-medium text-ink-muted hover:text-ink"
        >
          <ArchiveX size={12} />
          הסתר
        </Button>
      </HelpTooltip>
      {/* Q7 — drawer-default + Ads Manager deep-link */}
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
