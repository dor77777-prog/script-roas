// dashboard-web/src/app/operator/AttributionDiagTab.tsx
//
// classify-v2 T4 — "אבחון סיווג" sub-tab. Thin wrapper around the
// AttributionDiagPanel, which self-fetches /api/operator/attribution-diag via
// SWR (default last 30 days) and renders the orders + ATC source distributions,
// the murky-bucket breakdowns, and the first-touch coverage. Re-runnable: the
// panel carries its own "הרץ מחדש" button so the operator can re-examine the
// classification over time.

import { AttributionDiagPanel } from '@/components/operator/AttributionDiagPanel';
import { Heading } from '@/components/ui/Typography';

export function AttributionDiagTab() {
  return (
    <div className="space-y-4">
      <Heading level="hero" className="flex flex-wrap items-center gap-2">
        <span>אבחון סיווג</span>
        <span className="text-ink-secondary text-xs font-normal">
          (התפלגות מקור להזמנות + ATC, פירוק דליים עמומים, וכיסוי first-touch — לבדיקה חוזרת לאורך זמן)
        </span>
      </Heading>
      <AttributionDiagPanel />
    </div>
  );
}
