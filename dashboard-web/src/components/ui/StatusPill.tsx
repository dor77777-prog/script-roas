'use client';

/**
 * Task 5.1 (UI/UX overhaul) — top-level operator <StatusPill>.
 *
 * Rendered in the /operator page header. Surfaces the rolled-up
 * "is everything green?" signal so the operator does not have to scan the
 * freshness lag matrix row by row to answer that question.
 *
 * Data: SWR polls /api/operator/health-summary every 15 s — the same cadence
 * the rest of /operator uses after Task 5.2's refresh unification. The route
 * soft-fails (HTTP 200 + `status: 'unknown'`) so a transient blip renders a
 * neutral chip instead of breaking the page header.
 *
 * Visual: matches the FreshnessBadge `.fresh-chip` token family from
 * globals.css (Task 1.4) — same border-radius, padding, pulsing dot.
 *   - GREEN  → `.fresh-chip.live`   (matches the in-product "LIVE" chip)
 *   - YELLOW → `.fresh-chip.aging`
 *   - RED    → `.fresh-chip.stale`
 *   - UNKNOWN → muted ink-secondary border, no dot
 *
 * The pulsing dot fires only on GREEN to match the existing FreshnessBadge
 * convention (the "all clear" state gets the heartbeat; degraded states are
 * static so they stand out by NOT pulsing).
 */

import useSWR from 'swr';
import { operatorFetch } from '@/lib/operatorClient';
import { cn } from '@/lib/utils';
import { HelpTooltip } from '@/components/ui/Tooltip';
import type { HealthSummaryResponse, HealthStatus } from '@/app/api/operator/health-summary/route';

const ENDPOINT = '/api/operator/health-summary';

async function fetcher(url: string): Promise<HealthSummaryResponse> {
  const res = await operatorFetch(url);
  return (await res.json()) as HealthSummaryResponse;
}

const STATUS_LABEL_HE: Record<HealthStatus, string> = {
  green: 'תקין',
  yellow: 'דורש תשומת לב',
  red: 'דורש טיפול דחוף',
  unknown: 'לא זמין',
};

/** Maps a HealthStatus to the existing .fresh-chip CSS variant. */
function statusToChipClass(status: HealthStatus): 'live' | 'aging' | 'stale' | null {
  if (status === 'green') return 'live';
  if (status === 'yellow') return 'aging';
  if (status === 'red') return 'stale';
  return null;
}

export interface StatusPillProps {
  className?: string;
  /** Test hook; defaults to "operator-status-pill". */
  testId?: string;
}

export function StatusPill({ className, testId = 'operator-status-pill' }: StatusPillProps) {
  const { data, isLoading } = useSWR<HealthSummaryResponse>(ENDPOINT, fetcher, {
    refreshInterval: 15_000,
    revalidateOnFocus: true,
  });

  // Initial load — neutral chip, no flash of a stale color.
  if (isLoading || !data) {
    return (
      <span
        className={cn(
          'fresh-chip border border-glass-edge text-ink-secondary',
          className,
        )}
        data-testid={testId}
        data-status="loading"
        aria-live="polite"
      >
        טוען…
      </span>
    );
  }

  const status = data.status;
  const chipCls = statusToChipClass(status);
  const label = STATUS_LABEL_HE[status];
  const pctText = data.freshness_pct >= 0
    ? `${Math.round(data.freshness_pct * 100)}%`
    : '—';
  // Tooltip text exposes the underlying numbers so the operator can read
  // the same data the audit team scans manually. We use HelpTooltip (Radix)
  // instead of a native `title=` attribute to satisfy the design-system
  // lint rule (no-native-title-tooltip) — same convention every other
  // chip in the app uses.
  const tooltipBody = `freshness ${pctText} · ${data.errors_1h} errors`;

  if (!chipCls) {
    // status === 'unknown'
    return (
      <HelpTooltip content={tooltipBody}>
        <span
          className={cn(
            'fresh-chip border border-glass-edge text-ink-secondary',
            className,
          )}
          data-testid={testId}
          data-status={status}
          data-tooltip={tooltipBody}
          aria-live="polite"
        >
          {label}
        </span>
      </HelpTooltip>
    );
  }

  return (
    <HelpTooltip content={tooltipBody}>
      <span
        className={cn('fresh-chip', chipCls, className)}
        data-testid={testId}
        data-status={status}
        data-tooltip={tooltipBody}
        aria-live="polite"
      >
        {status === 'green' && <span className="pulse" aria-hidden="true" />}
        {label} · {pctText}
      </span>
    </HelpTooltip>
  );
}
