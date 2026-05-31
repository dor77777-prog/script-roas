'use client';

import { Trophy, AlertTriangle } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * "Winners and Losers" view that replaces the previous QuadrantScatter
 * (2026-05-29). Operator feedback on the scatter: even after color-coding
 * by quadrant + caption + median annotations + zoom-to-cluster + outlier
 * lists, it remained "not intuitive at first look and not intuitive at
 * deep look either" — scatter plots require holding two axes in mind +
 * mentally projecting each point + comparing to medians. Too much
 * cognitive work for a "what should I do today?" question.
 *
 * This component takes the same input data and presents it as TWO
 * SIDE-BY-SIDE RANKED LISTS: top winners (ROAS desc) and worst losers
 * (ROAS asc), each row carrying the actionable verdict in plain Hebrew.
 *
 * Each row shows: name + platform + store + ROAS + spend + suggested
 * action. This answers "which campaigns deserve more budget?" and
 * "which should I cut?" in a single glance — no chart-reading skill
 * required.
 */

export interface CampaignTopListPoint {
  name: string;
  platform: string;
  storeName: string;
  roas: number;
  cac: number;
  spend: number;
}

type Props = {
  data: CampaignTopListPoint[];
  title?: string;
  className?: string;
  /** How many to show per side. Default 5. */
  perSide?: number;
};

/** Per-platform color dot, matching Meta blue / Google amber / TikTok pink. */
const PLATFORM_DOT: Record<string, string> = {
  Meta: 'bg-status-blue',
  Google: 'bg-status-orange',
  TikTok: 'bg-status-red',
};

function PlatformChip({ platform, store }: { platform: string; store: string }) {
  const dot = PLATFORM_DOT[platform] ?? 'bg-status-gray';
  return (
    <div className="flex items-center gap-1.5 text-[11px] sm:text-xs text-ink-secondary">
      <span className={cn('inline-block w-1.5 h-1.5 rounded-full shrink-0', dot)} aria-hidden />
      <span className="font-medium">{platform}</span>
      <span className="text-ink-muted">·</span>
      <span>{store}</span>
    </div>
  );
}

function Row({
  rank,
  campaign,
  variant,
}: {
  rank: number;
  campaign: CampaignTopListPoint;
  variant: 'winner' | 'loser';
}) {
  const isWinner = variant === 'winner';
  const roasColor = isWinner
    ? campaign.roas >= 3
      ? 'text-status-green'
      : 'text-status-blue'
    : campaign.roas < 1
      ? 'text-status-red'
      : 'text-status-orange';

  const verdict = isWinner
    ? campaign.roas >= 4
      ? '→ הגדל תקציב משמעותית'
      : campaign.roas >= 2.7
        ? '→ מקום להגדיל תקציב'
        : '→ יציב — שמור על תקציב'
    : campaign.roas < 1
      ? '→ סגור או בדוק מיפוי'
      : campaign.roas < 2
        ? '→ הקטן תקציב / אופטימיזציה'
        : '→ בדוק מה רץ פה';

  const verdictColor = isWinner ? 'text-status-green' : 'text-status-red';

  return (
    <li className="py-2.5 border-b border-glass-edge last:border-b-0">
      <div className="flex items-start gap-2">
        <span className="text-ink-muted font-mono text-[11px] mt-0.5 tabular-nums shrink-0 w-4 text-end">
          {rank}.
        </span>
        <div className="min-w-0 flex-1">
          {/* Name + platform/store row */}
          <div className="flex items-start justify-between gap-2 mb-1">
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium text-ink truncate" title={campaign.name}>
                {campaign.name}
              </div>
              <PlatformChip platform={campaign.platform} store={campaign.storeName} />
            </div>
            <div className={cn('text-end shrink-0 tabular-nums', roasColor)}>
              <div className="text-base sm:text-lg font-semibold leading-tight">
                {campaign.roas.toFixed(2)}
              </div>
              <div className="text-[10px] sm:text-[11px] text-ink-muted font-normal leading-tight">
                ROAS
              </div>
            </div>
          </div>
          {/* Metrics + verdict row */}
          <div className="flex items-center justify-between gap-2 text-[11px] sm:text-xs">
            <div className="text-ink-secondary tabular-nums">
              <span className="text-ink-muted">הוצאה:</span> CAD {Math.round(campaign.spend).toLocaleString('he-IL')}
              {' · '}
              <span className="text-ink-muted">CAC:</span> {Math.round(campaign.cac).toLocaleString('he-IL')}
            </div>
            <div className={cn('font-medium shrink-0', verdictColor)}>{verdict}</div>
          </div>
        </div>
      </div>
    </li>
  );
}

export function CampaignsTopList({
  data,
  title,
  className,
  perSide = 5,
}: Props) {
  if (data.length === 0) {
    return (
      <div className={cn('rounded-xl bg-glass-1 border border-glass-edge p-5', className)}>
        {title && (
          <h3 className="text-sm sm:text-base font-semibold text-ink mb-2">{title}</h3>
        )}
        <div className="text-ink-muted text-sm text-center py-8">
          אין נתונים להצגה — בחר טווח עם קמפיינים פעילים.
        </div>
      </div>
    );
  }

  // Sort by ROAS descending for winners, ascending for losers (skipping
  // overlap — if total < 2*perSide, split in half).
  const sortedDesc = [...data].sort((a, b) => b.roas - a.roas);
  const sortedAsc = [...data].sort((a, b) => a.roas - b.roas);

  const half = Math.floor(data.length / 2);
  const winnersCount = Math.min(perSide, half || data.length);
  const losersCount = Math.min(perSide, data.length - winnersCount);

  const winners = sortedDesc.slice(0, winnersCount);
  const losers = sortedAsc.slice(0, losersCount).reverse();
  // ↑ reverse so the WORST appears at the bottom of the column (visually
  // emphasising it as the "last" item the eye lands on), and the slightly-
  // less-bad sits at the top. Reduces the cognitive "scroll past the worst"
  // pattern.

  return (
    <div className={cn('rounded-xl bg-glass-1 border border-glass-edge p-3 sm:p-5', className)}>
      {title && (
        <h3 className="text-sm sm:text-base font-semibold text-ink mb-1">{title}</h3>
      )}
      <p className="text-[11px] sm:text-xs text-ink-secondary mb-3 leading-relaxed">
        ה-{Math.min(perSide, data.length)} מנצחים ביותר וה-{losersCount} שצריכים תשומת לב — לפי ROAS. כל קמפיין עם פלטפורמה, חנות, וההמלצה הכי קונקרטית.
        <span className="text-ink-muted"> · סה״כ {data.length} קמפיינים פעילים בטווח.</span>
      </p>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 sm:gap-6">
        {/* Winners — right column in RTL */}
        <div className="min-w-0">
          <h4 className="flex items-center gap-1.5 text-xs sm:text-sm font-semibold text-status-green mb-2">
            <Trophy size={14} />
            מנצחים ({winnersCount})
          </h4>
          <ul className="rounded-lg border border-glass-edge bg-glass-2/40 px-2 sm:px-3">
            {winners.map((c, i) => (
              <Row key={`${c.platform}:${c.name}:${c.storeName}`} rank={i + 1} campaign={c} variant="winner" />
            ))}
          </ul>
        </div>
        {/* Losers — left column in RTL */}
        <div className="min-w-0">
          <h4 className="flex items-center gap-1.5 text-xs sm:text-sm font-semibold text-status-red mb-2">
            <AlertTriangle size={14} />
            לתשומת לב ({losersCount})
          </h4>
          <ul className="rounded-lg border border-glass-edge bg-glass-2/40 px-2 sm:px-3">
            {losers.map((c, i) => (
              <Row key={`${c.platform}:${c.name}:${c.storeName}`} rank={i + 1} campaign={c} variant="loser" />
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
