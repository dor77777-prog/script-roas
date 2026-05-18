import { useEffect, useMemo, useState } from 'react';
import { readRecurring, writeRecurring, type RecurringCost } from '@/lib/billing';

/**
 * Subscribe to the cloud-synced recurring billing list.
 *
 * Mirrors the canonical "localStorage + custom event + write-through" hook
 * pattern established by AnnotationsPanel.tsx:51-80 — but extracted into a
 * reusable shape:
 *
 *   1. Hydrate from localStorage on mount via `readRecurring()`
 *   2. Subscribe to the `'roas-billing-changed'` custom event so writes from
 *      OTHER components (or from this same component's `setRecurring` path)
 *      cause a re-read. NOTE: BOTH this hook and `useBillingOneTime` listen
 *      to the SAME event `'roas-billing-changed'` — there is no separate
 *      one-time variant. The cloud-sync layer (`cloudSync.ts:58-66`) maps
 *      both billing keys to this single event.
 *   3. The returned `setRecurring` writes through to localStorage + cloud +
 *      event via `writeRecurring` in `@/lib/billing`, which fans out to all
 *      three via `safeWrite` (`lib/billing.ts:73-85`).
 *
 * Seed-on-empty logic is intentionally NOT here — it depends on `storeNames`
 * (a use-site prop) so it stays in the BillingSettings shell.
 */
export function useBillingRecurring(): {
  recurring: RecurringCost[];
  setRecurring: (next: RecurringCost[]) => void;
  totalMonthly: number;
} {
  const [recurring, setRecurring] = useState<RecurringCost[]>([]);

  useEffect(() => {
    setRecurring(readRecurring());
    function onChange() {
      setRecurring(readRecurring());
    }
    window.addEventListener('roas-billing-changed', onChange);
    return () => window.removeEventListener('roas-billing-changed', onChange);
  }, []);

  const totalMonthly = useMemo(
    () => recurring.filter(r => r.active).reduce((s, r) => s + r.monthlyCAD, 0),
    [recurring],
  );

  function persist(next: RecurringCost[]) {
    setRecurring(next);
    writeRecurring(next); // safeWrite dispatches the event + pushes to cloud
  }

  return { recurring, setRecurring: persist, totalMonthly };
}
