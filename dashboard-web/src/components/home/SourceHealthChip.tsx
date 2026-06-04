'use client';

/**
 * Wave 3 · Data-Trust (DQ-5) — <SourceHealthChip>.
 *
 * A Home data-quality chip that surfaces UNHEALTHY data sources (store ×
 * platform) so the operator notices a stuck/broken pipe at a glance. It is
 * HIDDEN by default — it renders nothing while loading, on a fetch failure, or
 * when every source is healthy. It appears ONLY when at least one source is
 * unhealthy. (`budget_skip` is treated as healthy upstream by
 * `sourceStatusRollup`, so a deliberate budget-off never trips this chip.)
 *
 * Self-fetching: polls `/api/freshness-summary` via SWR every 15s (soft-fail
 * `fetchJsonOrNull` → a transient route error degrades to "hidden", never an
 * error boundary). The route already returns the collapsed
 * `{ anyUnhealthy, unhealthy[] }` rollup.
 *
 * Each unhealthy source renders one `tone="danger"` Badge reading
 * "● <platform> · <status>" (+ " · <Nh>" lag when known), wrapped in a
 * HelpTooltip that points the operator at /operator to investigate/reconnect.
 *
 * Standards (2026-06-01 readability hardening):
 *   • Token-only — colours come from the Badge `danger` tone (status-red
 *     bg/fg tokens), which the contrast guard pins to AA in BOTH themes. No
 *     raw hex / text-colour-from-band.
 *   • RTL-safe — platform + status are wrapped in `<bdi dir="ltr">` so the
 *     Latin/identifier text isolates inside the RTL layout. Layout uses
 *     logical gap utilities only (no ml-/left-).
 *   • native `title=` is BANNED by the lint guard — the operator hint goes
 *     through the HelpTooltip primitive, never a title attribute.
 */

import useSWR from 'swr';
import { Badge } from '@/components/ui/Badge';
import { HelpTooltip } from '@/components/ui/Tooltip';
import { fetchJsonOrNull } from '@/lib/fetchJson';

const SWR_KEY = '/api/freshness-summary';

const TOOLTIP = 'מקור-נתונים תקוע או שגוי — פתח /operator לפרטים ולחיבור-מחדש';

interface UnhealthySource {
  storeId: string;
  platform: string;
  status: string;
  lagMinutes: number | null;
}

interface SourceHealthResponse {
  anyUnhealthy: boolean;
  unhealthy: UnhealthySource[];
  error?: string;
}

/**
 * Format a lag (in minutes) into a compact "Nh" / "Nm" suffix for the badge.
 * ≥60 min collapses to whole hours ("6h"); under an hour stays minutes ("45m").
 * Null / non-finite → no suffix (caller omits the segment).
 */
function formatLag(lagMinutes: number | null): string | null {
  if (lagMinutes == null || !Number.isFinite(lagMinutes) || lagMinutes <= 0) return null;
  if (lagMinutes >= 60) {
    const hours = Math.round(lagMinutes / 60);
    return `${hours}h`;
  }
  return `${Math.round(lagMinutes)}m`;
}

export function SourceHealthChip() {
  const { data } = useSWR<SourceHealthResponse | null>(SWR_KEY, fetchJsonOrNull, {
    refreshInterval: 15_000,
    revalidateOnFocus: false,
  });

  // Hidden by default: loading (no data yet), soft-failed fetch (null), or all
  // sources healthy → render nothing. The chip is purely an alarm surface.
  if (!data || !data.anyUnhealthy) return null;

  const sources = data.unhealthy ?? [];
  if (sources.length === 0) return null;

  return (
    <div
      data-testid="source-health-chip"
      className="inline-flex flex-wrap items-center gap-1.5"
    >
      {sources.map((src) => {
        const lag = formatLag(src.lagMinutes);
        return (
          <HelpTooltip key={`${src.storeId}::${src.platform}`} content={TOOLTIP}>
            <Badge
              tone="red"
              data-testid="source-health-badge"
              className="cursor-help"
            >
              <span aria-hidden>●</span>
              <bdi dir="ltr">
                {src.platform} · {src.status}
                {lag ? ` · ${lag}` : ''}
              </bdi>
            </Badge>
          </HelpTooltip>
        );
      })}
    </div>
  );
}
