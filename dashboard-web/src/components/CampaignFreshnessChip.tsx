// dashboard-web/src/components/CampaignFreshnessChip.tsx
//
// Phase C — small freshness chip for CampaignsTable rows. Reads
// last_live_tick_at from campaigns_daily. Green if <15 min, orange if
// 15-60 min, red if >60 min; gray (em-dash) when last_live_tick_at is null.
// A future tick (host/browser clock skew) clamps to 0 → fresh, never a
// negative-minute label (mirrors lib/freshness/useStaleness.ts:ageMinutes).

import { HelpTooltip } from '@/components/ui/Tooltip';

export type CampaignFreshnessChipProps = {
  lastLiveTickAt: string | null | undefined;
};

function colorForMinutes(min: number | null): { dot: string; label: string } {
  if (min === null) return { dot: 'bg-status-gray', label: '—' };
  if (min < 15) return { dot: 'bg-status-green', label: `${min} דק׳` };
  if (min < 60) return { dot: 'bg-status-orange', label: `${min} דק׳` };
  return { dot: 'bg-status-red', label: `${Math.floor(min / 60)} שע׳` };
}

export function CampaignFreshnessChip({ lastLiveTickAt }: CampaignFreshnessChipProps) {
  // FIX F (#33) — clamp with Math.max(0, …) so a future last_live_tick_at
  // (clock skew) reads as 0 min / fresh instead of a negative-minute label.
  const min = lastLiveTickAt
    ? Math.max(0, Math.floor((Date.now() - new Date(lastLiveTickAt).getTime()) / 60_000))
    : null;
  const { dot, label } = colorForMinutes(min);
  return (
    <HelpTooltip content={lastLiveTickAt ?? 'no live tick'}>
      <span className="inline-flex items-center gap-1.5 text-fs-xs text-ink-secondary">
        <span className={`size-1.5 rounded-full ${dot}`} />
        {label}
      </span>
    </HelpTooltip>
  );
}
