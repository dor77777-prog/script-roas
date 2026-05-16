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
    color: 'text-roas-red',
    bg: 'bg-roas-redBg/40',
    border: 'border-roas-red/20',
    badge: 'bg-roas-red text-white',
  },
  warning: {
    label: 'אזהרות',
    icon: <AlertTriangle size={16} />,
    color: 'text-amber-700',
    bg: 'bg-amber-50',
    border: 'border-amber-200',
    badge: 'bg-amber-500 text-white',
  },
  opportunity: {
    label: 'הזדמנויות',
    icon: <Lightbulb size={16} />,
    color: 'text-primary',
    bg: 'bg-primary/5',
    border: 'border-primary/15',
    badge: 'bg-primary text-white',
  },
  positive: {
    label: 'חיובי',
    icon: <Trophy size={16} />,
    color: 'text-roas-green',
    bg: 'bg-roas-greenBg/40',
    border: 'border-roas-green/15',
    badge: 'bg-roas-green text-white',
  },
  info: {
    label: 'מידע',
    icon: <Info size={16} />,
    color: 'text-text-secondary',
    bg: 'bg-surfaceMuted',
    border: 'border-borderSubtle',
    badge: 'bg-text-muted text-white',
  },
};

const SEVERITY_ORDER: Severity[] = ['critical', 'warning', 'opportunity', 'positive', 'info'];

type Props = {
  data: DashboardData;
};

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
  useEffect(() => {
    setStates(readInsightStates());
    setHydrated(true);
  }, []);

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

  return (
    <section className="rounded-2xl bg-surface border border-borderSubtle shadow-card overflow-hidden">
      {/* Header */}
      <header className="px-4 sm:px-5 py-3 sm:py-3.5 border-b border-borderSubtle bg-gradient-to-l from-primary/4 to-surface">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 min-w-0">
            <span className="inline-flex items-center justify-center w-7 h-7 rounded-lg bg-primary/10 text-primary shrink-0">
              <Sparkles size={15} />
            </span>
            <h2 className="text-sm sm:text-base font-semibold text-text-primary tracking-tight">
              תובנות חכמות
            </h2>
            {totalCount > 0 && (
              <span className="text-[10px] sm:text-xs text-text-muted">
                ({totalCount}{totalCount === 1 ? ' תובנה' : ' תובנות'})
              </span>
            )}
          </div>
          <div className="text-[10px] sm:text-xs text-text-muted flex items-center gap-1.5">
            {loading && <RefreshCw size={12} className="animate-spin" />}
            <span>14 ימים אחרונים · מתעדכן כל דקה</span>
          </div>
        </div>
      </header>

      {/* Empty state */}
      {!loading && totalCount === 0 && hiddenCount === 0 && (
        <div className="px-4 sm:px-5 py-10 text-center text-text-muted">
          <Sparkles size={28} className="mx-auto mb-2 text-text-muted/60" />
          <div className="text-sm">אין תובנות חדשות לרגע זה.</div>
          <div className="text-[11px] mt-1">
            המערכת תזהה אנומליות והזדמנויות ברגע שייווצרו.
          </div>
        </div>
      )}

      {/* Grouped insights */}
      {totalCount > 0 && (
        <div>
          {SEVERITY_ORDER.map(sev => {
            const list = grouped[sev];
            if (list.length === 0) return null;
            const meta = SEVERITY_META[sev];
            return (
              <SeverityGroup
                key={sev}
                severity={sev}
                meta={meta}
                items={list}
                onMark={markInsight}
              />
            );
          })}
        </div>
      )}

      {loading && totalCount === 0 && (
        <div className="px-4 py-8 text-center text-sm text-text-muted">
          מנתח נתונים…
        </div>
      )}

      {/* Hidden / muted insights — collapsed by default, expandable */}
      {hiddenCount > 0 && (
        <div className="border-t border-borderSubtle bg-surfaceMuted/30">
          <button
            onClick={() => setShowHidden(v => !v)}
            className="w-full px-4 sm:px-5 py-2.5 flex items-center justify-between gap-2 text-text-secondary hover:text-text-primary hover:bg-surfaceMuted transition-colors"
          >
            <span className="inline-flex items-center gap-2 text-xs sm:text-sm">
              {showHidden ? <Eye size={14} /> : <EyeOff size={14} />}
              <span className="font-medium">
                {hiddenCount} תובנות מוסתרות
              </span>
              <span className="text-text-muted text-[10px] sm:text-[11px]">
                (סומנו כבוצעו או הוסתרו ידנית)
              </span>
            </span>
            {showHidden ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          </button>
          {showHidden && (
            <ul className="divide-y divide-borderSubtle/70 animate-fade-in">
              {hidden.map(ins => {
                const st = states[ins.id];
                const meta = SEVERITY_META[ins.severity];
                const stateLabel = st?.state === 'done' ? 'סומן כבוצע' : 'הוסתר';
                return (
                  <li key={ins.id} className="px-4 sm:px-5 py-2.5 flex items-start gap-3">
                    <span
                      className={cn(
                        'inline-flex items-center justify-center w-6 h-6 rounded-md shrink-0 mt-0.5 opacity-60',
                        meta.color, 'bg-surface ring-1 ring-inset', meta.border,
                      )}
                    >
                      {meta.icon}
                    </span>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium text-text-secondary leading-snug truncate">
                        {ins.title}
                      </div>
                      <div className="text-[10px] sm:text-[11px] text-text-muted mt-0.5">
                        {stateLabel}{st?.at ? ` · ${relativeTime(st.at)}` : ''}
                      </div>
                    </div>
                    <button
                      onClick={() => restoreInsight(ins.id)}
                      className="inline-flex items-center gap-1 px-2 py-1 text-[10px] sm:text-[11px] font-semibold text-primary hover:bg-primary/10 rounded transition-colors shrink-0"
                      title="שחזר תובנה לרשימה הראשית"
                    >
                      <Undo2 size={11} />
                      שחזר
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}

function SeverityGroup({
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
  const visible = showAll ? items : items.slice(0, 3);
  const remaining = items.length - visible.length;

  return (
    <div className={cn('border-b border-borderSubtle last:border-b-0', meta.bg)}>
      <div className={cn('px-4 sm:px-5 py-2.5 sm:py-3 flex items-center gap-2', meta.color)}>
        <span className="shrink-0">{meta.icon}</span>
        <span className="text-xs sm:text-sm font-semibold tracking-wide">{meta.label}</span>
        <span
          className={cn(
            'inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 text-[10px] font-bold rounded-full tabular-nums',
            meta.badge,
          )}
        >
          {items.length}
        </span>
      </div>
      <ul className="space-y-px">
        {visible.map(insight => (
          <InsightRow key={insight.id} insight={insight} meta={meta} onMark={onMark} />
        ))}
      </ul>
      {remaining > 0 && (
        <div className="px-4 sm:px-5 py-2">
          <button
            onClick={() => setShowAll(v => !v)}
            className={cn(
              'text-[11px] sm:text-xs font-medium inline-flex items-center gap-1 transition-colors',
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
          </button>
        </div>
      )}
    </div>
  );
}

function InsightRow({
  insight,
  meta,
  onMark,
}: {
  insight: Insight;
  meta: typeof SEVERITY_META[Severity];
  onMark: (insight: Insight, kind: InsightStateKind) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const hasDetail = !!insight.why;
  return (
    <li
      className={cn(
        'group/insight px-4 sm:px-5 py-2.5 sm:py-3',
        'hover:bg-surface/60 transition-colors',
        'border-t border-borderSubtle/50',
      )}
    >
      <div className="flex items-start gap-3">
        <span
          className={cn(
            'inline-flex items-center justify-center w-6 h-6 rounded-md shrink-0 mt-0.5',
            meta.color, 'bg-surface/80 ring-1 ring-inset',
            meta.border,
          )}
        >
          {meta.icon}
        </span>
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2 flex-wrap">
            <div className="min-w-0 flex-1">
              <div className="text-sm font-semibold text-text-primary leading-snug">
                {insight.title}
              </div>
              <div className="text-xs sm:text-[13px] text-text-secondary mt-0.5 leading-relaxed">
                {insight.detail}
              </div>
            </div>
            {insight.scope && (
              <span className="inline-block text-[10px] sm:text-[11px] font-medium text-text-muted bg-surface/80 border border-borderSubtle px-1.5 py-0.5 rounded shrink-0">
                {insight.scope}
              </span>
            )}
          </div>

          {/* Action row — ghost buttons by default, intensify on hover so it's
              clear these are actions, not state indicators. The previous
              filled-green "בוצע" pill read as "this is already done". */}
          <div className="flex items-center gap-1 mt-2 flex-wrap">
            {/* Mark done — ghost gray, turns green on hover to telegraph intent */}
            <button
              onClick={() => onMark(insight, 'done')}
              className={cn(
                'inline-flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-medium',
                'border border-borderSubtle bg-surface',
                'text-text-secondary hover:text-roas-green hover:border-roas-green/40 hover:bg-roas-greenBg/40',
                'transition-colors',
              )}
              title="סמן שטיפלתי בזה — יוסתר ל-7 ימים, יחזור אם הבעיה תחזור"
            >
              <Check size={12} />
              טיפלתי
            </button>
            {/* Hide — ghost gray, stays muted on hover (less aggressive) */}
            <button
              onClick={() => onMark(insight, 'ignored')}
              className={cn(
                'inline-flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-medium',
                'border border-transparent bg-transparent',
                'text-text-muted hover:text-text-primary hover:bg-surfaceMuted',
                'transition-colors',
              )}
              title="הסתר — לא יחזור עד שתשחזר ידנית"
            >
              <ArchiveX size={12} />
              הסתר
            </button>

            {/* External link if any */}
            {insight.href && (
              <a
                href={insight.href}
                target="_blank"
                rel="noopener noreferrer"
                className={cn(
                  'inline-flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-semibold',
                  'border border-transparent',
                  meta.color,
                  'hover:bg-surface/80 hover:border-borderSubtle',
                  'transition-colors',
                )}
              >
                <ExternalLink size={11} />
                פתח קמפיין
              </a>
            )}

            {/* Why disclosure pushed to the end */}
            {hasDetail && (
              <button
                onClick={() => setExpanded(v => !v)}
                className="text-[11px] text-text-muted hover:text-text-primary inline-flex items-center gap-1 transition-colors ml-auto px-2 py-1"
              >
                {expanded ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
                {expanded ? 'הסתר הסבר' : 'למה?'}
              </button>
            )}
          </div>

          {expanded && hasDetail && (
            <div className="mt-2 px-2.5 py-1.5 text-[11px] sm:text-xs text-text-secondary bg-surface/60 border-l-2 border-borderSubtle rounded animate-fade-in leading-relaxed">
              {insight.why}
            </div>
          )}
        </div>
      </div>
    </li>
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
