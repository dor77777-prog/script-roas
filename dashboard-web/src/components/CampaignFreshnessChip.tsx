// dashboard-web/src/components/CampaignFreshnessChip.tsx
//
// Phase C — small freshness chip for CampaignsTable rows. Reads
// last_live_tick_at from campaigns_daily. Green if <15 min, yellow
// if 15-60, gray if >60 min or null.

export type CampaignFreshnessChipProps = {
  lastLiveTickAt: string | null | undefined;
};

function colorForMinutes(min: number | null): { dot: string; label: string } {
  if (min === null) return { dot: 'bg-ink-secondary/30', label: '—' };
  if (min < 15) return { dot: 'bg-status-green', label: `${min} דק׳` };
  if (min < 60) return { dot: 'bg-status-orange', label: `${min} דק׳` };
  return { dot: 'bg-status-red', label: `${Math.floor(min / 60)} שע׳` };
}

export function CampaignFreshnessChip({ lastLiveTickAt }: CampaignFreshnessChipProps) {
  const min = lastLiveTickAt ? Math.floor((Date.now() - new Date(lastLiveTickAt).getTime()) / 60_000) : null;
  const { dot, label } = colorForMinutes(min);
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-ink-secondary" title={lastLiveTickAt ?? 'no live tick'}>
      <span className={`size-1.5 rounded-full ${dot}`} />
      {label}
    </span>
  );
}
