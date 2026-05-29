// dashboard-web/src/components/CampaignDrawerStatusSection.tsx
//
// Phase C — minimal status + freshness section for the campaign drawer.
// Server-fetched on parent; receives props synchronously.

export type CampaignDrawerStatusSectionProps = {
  configuredStatus: string | null;
  effectiveStatus: string | null;
  deliveryStatus: string | null;
  firstSeenAt: string | null;
  statusChangedAt: string | null;
  lastLiveTickAt: string | null;
  metricsLagMinutes: number | null;
};

function relMin(min: number | null): string {
  if (min === null) return '—';
  if (min < 60) return `${min} דק׳ לפני`;
  if (min < 60 * 24) return `${Math.floor(min / 60)} שע׳ לפני`;
  return `${Math.floor(min / 1440)} ימים לפני`;
}

function relIso(iso: string | null): string {
  if (!iso) return '—';
  const min = Math.floor((Date.now() - new Date(iso).getTime()) / 60_000);
  return relMin(min);
}

export function CampaignDrawerStatusSection(p: CampaignDrawerStatusSectionProps) {
  return (
    <section className="border border-line-subtle rounded-lg p-4 my-3">
      <h3 className="text-sm font-medium text-ink-primary mb-2">סטטוס + טריות</h3>
      <div className="grid grid-cols-2 gap-y-1.5 text-xs">
        <span className="text-ink-secondary">configured</span>
        <span className="text-ink-primary">{p.configuredStatus ?? '—'}</span>
        <span className="text-ink-secondary">effective</span>
        <span className="text-ink-primary">{p.effectiveStatus ?? '—'}</span>
        <span className="text-ink-secondary">delivery</span>
        <span className="text-ink-primary">{p.deliveryStatus ?? '—'}</span>
        <span className="text-ink-secondary">first_seen</span>
        <span className="text-ink-primary">{relIso(p.firstSeenAt)}</span>
        <span className="text-ink-secondary">status_changed</span>
        <span className="text-ink-primary">{relIso(p.statusChangedAt)}</span>
        <span className="text-ink-secondary">last_live_tick</span>
        <span className="text-ink-primary">{relIso(p.lastLiveTickAt)}</span>
        <span className="text-ink-secondary">metrics lag</span>
        <span className="text-ink-primary">{relMin(p.metricsLagMinutes)}</span>
      </div>
    </section>
  );
}
