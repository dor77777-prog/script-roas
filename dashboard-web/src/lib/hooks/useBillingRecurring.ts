import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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

  // Set to true inside `persist` immediately before `writeRecurring` fires
  // the synchronous 'roas-billing-changed' event; the event listener then
  // sees it, clears it, and skips the redundant re-read. This breaks the
  // self-bounce that produced two distinct re-renders per write (state
  // setter + event-driven re-read of the same data), most visibly when
  // `persist` was called outside a React event-handler boundary (e.g. from
  // a Promise callback in the CSV import flow) where React did NOT batch
  // the two setState calls. Cross-hook re-reads (one-time listener
  // responding to a recurring write, etc.) are unaffected — only the
  // hook's OWN self-bounce is suppressed. (WR-03)
  const selfWritePending = useRef(false);

  useEffect(() => {
    setRecurring(readRecurring());
    function onChange() {
      if (selfWritePending.current) {
        selfWritePending.current = false;
        return;
      }
      setRecurring(readRecurring());
    }
    window.addEventListener('roas-billing-changed', onChange);
    return () => window.removeEventListener('roas-billing-changed', onChange);
  }, []);

  // Phase 12.5.x (2026-05-24) — exclude percent-of-revenue rows from this
  // sum because their CAD contribution depends on the period's revenue,
  // which the hook can't see. The button label that surfaces this number
  // ("X פעילות · CAD Y") shows the fixed-only total; percent rows still
  // count toward "X פעילות" since they're real subscriptions.
  const totalMonthly = useMemo(
    () =>
      recurring
        .filter(r => r.active)
        .filter(r => !(typeof r.percentOfRevenue === 'number' && r.percentOfRevenue > 0))
        .reduce((s, r) => s + r.monthlyCAD, 0),
    [recurring],
  );

  // Wrapped in useCallback so the returned setter keeps a stable reference
  // across renders. `setRecurring` (the raw state setter from useState) is
  // already stable per React's guarantee, and `writeRecurring` is
  // module-scoped — so the dep array is intentionally empty. Stable
  // reference matters for consumers that pass this setter into useMemo
  // deps, React.memo'd children, or other identity-sensitive sinks.
  // (WR-01)
  const persist = useCallback((next: RecurringCost[]) => {
    setRecurring(next);
    // Flag set BEFORE writeRecurring because the event dispatch inside
    // safeWrite is synchronous — the listener observes the ref on the
    // same call stack and skips the redundant re-read. (WR-03)
    selfWritePending.current = true;
    writeRecurring(next); // safeWrite dispatches the event + pushes to cloud
  }, []);

  return { recurring, setRecurring: persist, totalMonthly };
}
