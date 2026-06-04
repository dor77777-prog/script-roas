'use client';

/**
 * Task 5.2 (UI/UX overhaul) — header "Refresh" button for /operator.
 *
 * Wires into SWR's global mutate via useSWRConfig(). Passing the predicate
 * `() => true` to `mutate` revalidates every key currently in the SWR cache,
 * which after Task 5.2's unification covers all 4 operator sub-tabs:
 *
 *   - SyncTab          → /api/operator/manual-overrides
 *   - HealthTab        → /api/operator/token-failures, /api/operator/freshness,
 *                        /api/operator/meta-buc-usage
 *   - ActivityTab      → /api/operator/status-events, /api/operator/jobs,
 *                        /api/operator/cron-tick-snapshots
 *   - DangerTab        → (no SWR keys; nothing to refresh)
 *   - Page header      → /api/operator/health-summary  (StatusPill)
 *
 * A predicate is preferred over enumerating exact keys because:
 *   (a) new operator panels are picked up automatically as they ship,
 *   (b) revalidating outside-operator keys is harmless — they'll just refetch
 *       sooner and the SWR cache will absorb the no-op work.
 *
 * Visual: a small ghost-tone button with a spinning indicator while the
 * revalidation is in-flight. We resolve the spinning state from the Promise
 * returned by mutate(...) so the operator sees clear "refresh happened"
 * feedback even when every key was already in-flight (race-free).
 */

import { useState, useTransition } from 'react';
import { useSWRConfig } from 'swr';
import { RotateCw } from 'lucide-react';
import { Button } from '@/components/ui/Button';

export function OperatorRefreshButton() {
  const { mutate } = useSWRConfig();
  const [isPending, startTransition] = useTransition();
  const [busy, setBusy] = useState(false);

  const onClick = async () => {
    setBusy(true);
    startTransition(() => {});
    try {
      // Revalidate every key in the SWR cache. Single-arg mutate (predicate
      // only, `(key) => boolean` matching all keys) = background revalidate that
      // KEEPS previous data on screen — no undefined blip, so the view/scroll
      // survive the refresh (2026-06-05, same fix as the auto-refresh).
      await mutate(() => true);
    } finally {
      setBusy(false);
    }
  };

  const spinning = busy || isPending;

  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      onClick={onClick}
      disabled={spinning}
      aria-label="רענן את כל הלוחות"
      data-testid="operator-refresh-button"
      className="gap-1.5"
    >
      <RotateCw
        size={14}
        className={spinning ? 'animate-spin' : ''}
        aria-hidden="true"
      />
      רענון
    </Button>
  );
}
