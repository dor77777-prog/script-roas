// dashboard-web/src/app/operator/page.tsx
//
// ניהול (Management) — operator console tab. Per D-D1, this is a sibling
// Next.js route (NOT a TabKey in the main dashboard's in-page tab nav). The
// four sub-sections were filled in incrementally by plans 13-16; all four
// are now live:
//
//   - Plan 13: JobsTable           → "ריצות אחרונות"          ← landed wave 7
//   - Plan 14: BackfillPicker      → "Backfill טווח תאריכים"  ← landed wave 7
//   - Plan 15: ManualOverridesCrud → "החלפות הוצאה ידניות"    ← landed wave 4
//   - Plan 16: SyncNowButtons      → "סנכרון עכשיו"           ← landed wave 8
//
// Each plan replaced ONE <section>'s body with the corresponding
// component; it did NOT restructure the page. With plan 16 in, no
// placeholder copy remains (the operator console is feature-complete
// per D-D2). Plan 22 owns the matching User Manual section + the
// post-deploy smoke battery for all four sub-views.
//
// Design tokens (`max-w-7xl`, `text-text-secondary`, etc.) follow S-8 (RTL +
// Hebrew) and D-D4 (match existing dashboard styling — no new tokens).

import { ManualOverridesCrud } from '@/components/operator/ManualOverridesCrud';
import { JobsTable } from '@/components/operator/JobsTable';
import { BackfillPicker } from '@/components/operator/BackfillPicker';
import { SyncNowButtons } from '@/components/operator/SyncNowButtons';

export const metadata = {
  title: 'ניהול — ROAS Dashboard',
};

export default function OperatorPage() {
  return (
    <div className="max-w-7xl mx-auto px-4 py-6 space-y-8">
      <header>
        <h1 className="text-2xl font-bold">ניהול</h1>
        <p className="text-text-secondary text-sm mt-1">
          ניהול אוטומציה: ריצות Inngest, backfill, החלפות ידניות, ו-Sync.
        </p>
      </header>

      <section>
        <h2 className="text-lg font-semibold mb-3">סנכרון עכשיו</h2>
        {/* Plan 16: SyncNowButtons — replaced placeholder copy with the
            live component. 1 global + 3 per-store buttons. The component
            owns its own pending / message / error states; this <section>
            only owns the title. The Inngest event-key env var stays
            server-side in /api/operator/sync-now/route.ts; this client
            component never references it. */}
        <SyncNowButtons />
      </section>

      <section>
        <h2 className="text-lg font-semibold mb-3">ריצות אחרונות</h2>
        {/* Plan 13: JobsTable — replaced placeholder copy with the live
            component. SWR polls /api/operator/jobs every 15s (D-D3); the
            proxy soft-fails to HTTP 200 with { runs: [], error } so the
            component handles loading / amber / empty states itself.
            The Inngest signing-key env var stays server-side in
            route.ts; this component never references it. */}
        <JobsTable />
      </section>

      <section>
        <h2 className="text-lg font-semibold mb-3">Backfill טווח תאריכים</h2>
        {/* Plan 14: BackfillPicker — replaced placeholder copy with the
            live component. The component owns its own loading / error /
            confirmation states; this <section> only owns the title. */}
        <BackfillPicker />
      </section>

      <section>
        <h2 className="text-lg font-semibold mb-3">החלפות הוצאה ידניות</h2>
        {/* Plan 15: ManualOverridesCrud — replaced placeholder copy with the
            live component. The component handles its own loading / error /
            empty states; this <section> only owns the title. */}
        <ManualOverridesCrud />
      </section>
    </div>
  );
}
