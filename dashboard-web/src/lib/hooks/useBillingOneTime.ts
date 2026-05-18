import { useCallback, useEffect, useRef, useState } from 'react';
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

  // Self-bounce suppression — mirrors the same pattern in
  // useBillingRecurring. See that hook's `selfWritePending` block for the
  // rationale. Cross-hook re-reads (the recurring hook responding to a
  // one-time write) are intentionally unaffected. (WR-03)
  const selfWritePending = useRef(false);

  useEffect(() => {
    setOneTime(readOneTime());
    function onChange() {
      if (selfWritePending.current) {
        selfWritePending.current = false;
        return;
      }
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
    selfWritePending.current = true;
    writeOneTime(next);
  }, []);

  return { oneTime, setOneTime: persist };
}
