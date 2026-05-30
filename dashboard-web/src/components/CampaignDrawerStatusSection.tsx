// dashboard-web/src/components/CampaignDrawerStatusSection.tsx
//
// Phase D (2026-05-30) — full status + freshness section. Expanded from
// the Phase C minimal panel. Displays the 3 status fields side-by-side
// (configured / effective / delivery), the BACKFILL_UNKNOWN sentinel
// warning when relevant, and a 3-event status-change timeline.
//
// Server-fetched on parent; receives props synchronously.

export type CampaignDrawerStatusSectionProps = {
  configuredStatus: string | null;
  effectiveStatus: string | null;
  deliveryStatus: string | null;
  firstSeenAt: string | null;
  statusChangedAt: string | null;
  lastStatusSuccessAt: string | null;
  lastLiveTickAt: string | null;
  metricsLagMinutes: number | null;
};

function relMin(min: number | null): string {
  if (min === null) return '—';
  if (min < 60)      return `${min} דק׳ לפני`;
  if (min < 60 * 24) return `${Math.floor(min / 60)} שע׳ לפני`;
  return `${Math.floor(min / 1440)} ימים לפני`;
}

function relIso(iso: string | null): string {
  if (!iso) return '—';
  const min = Math.floor((Date.now() - new Date(iso).getTime()) / 60_000);
  return relMin(min);
}

const DELIVERY_TONE: Record<string, string> = {
  DELIVERING:     'bg-status-greenBg text-status-greenFg',
  NOT_DELIVERING: 'bg-elevated2 text-ink-secondary',
  LIMITED:        'bg-status-orangeBg text-status-orangeFg',
  PENDING_REVIEW: 'bg-status-blueBg text-status-blueFg',
  LEARNING:       'bg-status-blueBg text-status-blueFg',
  REJECTED:       'bg-status-redBg text-status-redFg',
  UNKNOWN:        'bg-elevated2 text-ink-muted',
};

function deliveryClass(status: string | null): string {
  if (!status) return 'bg-elevated2 text-ink-muted';
  return DELIVERY_TONE[status] ?? 'bg-elevated2 text-ink-muted';
}

export function CampaignDrawerStatusSection(p: CampaignDrawerStatusSectionProps) {
  const isBackfillUnknown = p.configuredStatus === 'BACKFILL_UNKNOWN';

  return (
    <section className="border border-line-subtle rounded-lg p-4 my-3">
      <h3 className="text-sm font-medium text-ink-primary mb-3">סטטוס + טריות</h3>

      {/* Phase D — Top row: 3 status chips side by side. */}
      <div className="grid grid-cols-3 gap-2 mb-3">
        <div className="flex flex-col items-start gap-1">
          <span className="text-[10px] text-ink-secondary">configured</span>
          <span className={
            'inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ' +
            (isBackfillUnknown
              ? 'bg-status-warning-bg text-status-warning-fg border border-status-warning/30'
              : 'bg-elevated2 text-ink-primary')
          }>
            {isBackfillUnknown ? '⏳ טוען מ-Platform' : (p.configuredStatus ?? '—')}
          </span>
        </div>
        <div className="flex flex-col items-start gap-1">
          <span className="text-[10px] text-ink-secondary">effective</span>
          <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-elevated2 text-ink-primary">
            {p.effectiveStatus ?? '—'}
          </span>
        </div>
        <div className="flex flex-col items-start gap-1">
          <span className="text-[10px] text-ink-secondary">delivery</span>
          <span className={
            'inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ' +
            deliveryClass(p.deliveryStatus)
          }>
            {p.deliveryStatus ?? '—'}
          </span>
        </div>
      </div>

      {/* BACKFILL_UNKNOWN explainer — only when active. */}
      {isBackfillUnknown && (
        <p className="text-[11px] text-status-warning-fg bg-status-warning-bg border border-status-warning/30 rounded px-2 py-1 mb-3">
          הסטטוס המוגדר מ-platform עדיין לא נדגם — המערכת מילאה את השדה
          באופן זמני מתוך הנתון היומי. הערך האמיתי ימולא בעוד עד 10 דקות
          ע״י ה-status worker.
        </p>
      )}

      {/* Phase D — 3-event timeline. */}
      <div className="border-t border-line-subtle pt-3">
        <h4 className="text-[11px] font-medium text-ink-secondary mb-2">היסטוריית סטטוס</h4>
        <div className="grid grid-cols-2 gap-y-1.5 text-xs">
          <span className="text-ink-secondary">נראה לראשונה</span>
          <span className="text-ink-primary">{relIso(p.firstSeenAt)}</span>
          <span className="text-ink-secondary">שינוי סטטוס אחרון</span>
          <span className="text-ink-primary">{relIso(p.statusChangedAt)}</span>
          <span className="text-ink-secondary">סטטוס נדגם בהצלחה</span>
          <span className="text-ink-primary">{relIso(p.lastStatusSuccessAt)}</span>
          <span className="text-ink-secondary">last_live_tick</span>
          <span className="text-ink-primary">{relIso(p.lastLiveTickAt)}</span>
          <span className="text-ink-secondary">metrics lag</span>
          <span className="text-ink-primary">{relMin(p.metricsLagMinutes)}</span>
        </div>
      </div>
    </section>
  );
}
