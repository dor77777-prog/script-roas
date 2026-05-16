'use client';

import { useMemo, useState } from 'react';
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
} from 'lucide-react';
import type { DashboardData } from '@/lib/types';
import type { ProductsResponse } from '@/app/api/products/route';
import type { CampaignsResponse } from '@/app/api/campaigns/route';
import { buildAllInsights, type Insight, type Severity } from '@/lib/insights';
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

  const insights = useMemo(() => {
    return buildAllInsights(data.rows, campaigns?.rows ?? [], products?.rows ?? []);
  }, [data.rows, campaigns, products]);

  // Group by severity
  const grouped = useMemo(() => {
    const buckets: Record<Severity, Insight[]> = {
      critical: [], warning: [], opportunity: [], positive: [], info: [],
    };
    for (const i of insights) buckets[i.severity].push(i);
    return buckets;
  }, [insights]);

  const loading = pLoading || cLoading;
  const totalCount = insights.length;

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
          <div className="text-[10px] sm:text-xs text-text-muted flex items-center gap-1">
            {loading && <RefreshCw size={12} className="animate-spin" />}
            <span>14 ימים אחרונים</span>
          </div>
        </div>
      </header>

      {/* Empty state */}
      {!loading && totalCount === 0 && (
        <div className="px-4 sm:px-5 py-10 text-center text-text-muted">
          <Sparkles size={28} className="mx-auto mb-2 text-text-muted/60" />
          <div className="text-sm">אין תובנות חדשות לרגע זה.</div>
          <div className="text-[11px] mt-1">המערכת תזהה אנומליות והזדמנויות ברגע שייצוצרו.</div>
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
    </section>
  );
}

function SeverityGroup({
  severity,
  meta,
  items,
}: {
  severity: Severity;
  meta: typeof SEVERITY_META[Severity];
  items: Insight[];
}) {
  // Critical / warning start expanded; opportunity / positive default to first
  // 3 visible with a "show more". The user always sees the urgent stuff first.
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
          <InsightRow key={insight.id} insight={insight} meta={meta} />
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
}: {
  insight: Insight;
  meta: typeof SEVERITY_META[Severity];
}) {
  const [expanded, setExpanded] = useState(false);
  const hasDetail = !!insight.why;
  return (
    <li
      className={cn(
        'px-4 sm:px-5 py-2.5 sm:py-3',
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

          <div className="flex items-center gap-3 mt-2">
            {hasDetail && (
              <button
                onClick={() => setExpanded(v => !v)}
                className="text-[11px] text-text-secondary hover:text-text-primary inline-flex items-center gap-1 transition-colors"
              >
                {expanded ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
                {expanded ? 'הסתר הסבר' : 'למה?'}
              </button>
            )}
            {insight.href && (
              <a
                href={insight.href}
                target="_blank"
                rel="noopener noreferrer"
                className={cn(
                  'inline-flex items-center gap-1 text-[11px] font-semibold transition-colors',
                  meta.color, 'hover:opacity-80',
                )}
              >
                <ExternalLink size={11} />
                פתח קמפיין
              </a>
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
