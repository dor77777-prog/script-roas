'use client';

/**
 * Task 5.5 (Wave 5) — History sub-tab.
 *
 * The pipeline does not yet persist a granular change log for budget
 * edits / status flips (Phase D introduced `status_events` but the
 * surface is not yet exposed via API). The History tab surfaces the
 * timestamps we DO have — first-seen, last status change, last
 * status-fetch success — and points the operator at the Status tab
 * for the registry shape that drives them.
 *
 * When `/api/status-events` lands (Phase E2+), this component is the
 * landing pad — it can mount the event feed without changing its
 * public API.
 */

import { Calendar, Clock } from 'lucide-react';
import { Heading } from '@/components/ui/Typography';
import { formatDate } from '@/lib/utils';

export interface CampaignDrawerHistoryProps {
  firstSeenAt: string | null;
  statusChangedAt: string | null;
  lastStatusSuccessAt: string | null;
  lastLiveTickAt: string | null;
}

function Row({ label, ts }: { label: string; ts: string | null }) {
  return (
    <li className="flex items-center justify-between gap-3 px-3 py-2 rounded-hz border border-glass-edge bg-pill-track">
      <span className="inline-flex items-center gap-1.5 text-xs text-ink-secondary">
        <Clock size={12} className="text-ink-muted" />
        {label}
      </span>
      <span className="text-xs tabular-nums text-ink">
        {ts ? formatDate(ts) : <span className="text-ink-muted">—</span>}
      </span>
    </li>
  );
}

export function CampaignDrawerHistory({
  firstSeenAt,
  statusChangedAt,
  lastStatusSuccessAt,
  lastLiveTickAt,
}: CampaignDrawerHistoryProps) {
  const hasAnyTs =
    !!firstSeenAt || !!statusChangedAt || !!lastStatusSuccessAt || !!lastLiveTickAt;

  return (
    <div className="space-y-4" data-testid="campaign-drawer-tab-history">
      <section>
        <Heading level="panel" className="inline-flex items-center gap-1.5 mb-2">
          <Calendar size={14} className="text-ink-secondary" />
          ציר זמן רישומי
        </Heading>
        <p className="text-fs-xs text-ink-muted leading-relaxed bg-pill-track rounded-hz px-3 py-2 mb-3">
          תיעוד מלא של עריכות תקציב ושינויי סטטוס יגיע בשלב מאוחר יותר (Phase E2+).
          עד אז, אלה התאריכים שה-pipeline שומר על הקמפיין הזה.
        </p>
        {hasAnyTs ? (
          <ul className="space-y-1.5">
            <Row label="נראה לראשונה" ts={firstSeenAt} />
            <Row label="שינוי סטטוס אחרון" ts={statusChangedAt} />
            <Row label="עדכון סטטוס מוצלח אחרון" ts={lastStatusSuccessAt} />
            <Row label="טיק חי אחרון" ts={lastLiveTickAt} />
          </ul>
        ) : (
          <div className="text-center py-6 text-ink-muted text-sm">
            אין תאריכים זמינים לקמפיין הזה.
          </div>
        )}
      </section>
    </div>
  );
}
