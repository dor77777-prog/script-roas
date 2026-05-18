import { useCallback, useEffect, useState } from 'react';
import { readOneTime, writeOneTime, type OneTimeCost } from '@/lib/billing';

/**
 * Subscribe to the cloud-synced one-time billing list. Sibling pattern to
 * `useBillingRecurring` — same shape, no `totalMonthly` memo (one-time totals
 * are date-range scoped and computed elsewhere in the P&L breakdown).
 *
 * Critical wiring contract — see UI-SPEC §"Custom event wiring":
 *   Both `useBillingRecurring` and `useBillingOneTime` listen to the SAME
 *   event `'roas-billing-changed'`. There is no separate one-time variant
 *   event in the codebase. The cheap re-read on every billing write
 *   (recurring OR one-time) is acceptable.
 */
export function useBillingOneTime(): {
  oneTime: OneTimeCost[];
  setOneTime: (next: OneTimeCost[]) => void;
} {
  const [oneTime, setOneTime] = useState<OneTimeCost[]>([]);

  useEffect(() => {
    setOneTime(readOneTime());
    function onChange() {
      setOneTime(readOneTime());
    }
    // SAME event as recurring — see hook-level docstring + UI-SPEC.
    window.addEventListener('roas-billing-changed', onChange);
    return () => window.removeEventListener('roas-billing-changed', onChange);
  }, []);

  // Wrapped in useCallback so the returned setter keeps a stable reference
  // across renders — mirrors the same pattern in useBillingRecurring.
  // `setOneTime` is React-stable, `writeOneTime` is module-scoped, so the
  // dep array is intentionally empty. (WR-01)
  const persist = useCallback((next: OneTimeCost[]) => {
    setOneTime(next);
    writeOneTime(next);
  }, []);

  return { oneTime, setOneTime: persist };
}
