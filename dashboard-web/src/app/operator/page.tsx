// dashboard-web/src/app/operator/page.tsx
//
// ניהול (Management) — operator console tab. Per D-D1, this is a sibling
// Next.js route (NOT a TabKey in the main dashboard's in-page tab nav). The
// four sub-sections are filled in incrementally by plans 13-16:
//
//   - Plan 13: JobsTable          → "ריצות אחרונות"
//   - Plan 14: BackfillPicker     → "Backfill טווח תאריכים"   ← landed wave 7
//   - Plan 15: ManualOverridesCrud → "החלפות הוצאה ידניות"   ← landed wave 4
//   - Plan 16: SyncNowButtons      → "סנכרון עכשיו"
//
// Each plan replaces ONE <section>'s body with the corresponding component;
// it does NOT restructure the page. Until each component lands, these
// sections render placeholder copy ("ממומש בשלב הבא").
//
// Design tokens (`max-w-7xl`, `text-text-secondary`, etc.) follow S-8 (RTL +
// Hebrew) and D-D4 (match existing dashboard styling — no new tokens).

import { ManualOverridesCrud } from '@/components/operator/ManualOverridesCrud';
import { BackfillPicker } from '@/components/operator/BackfillPicker';

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
        <p className="text-text-secondary text-sm">
          {/* Plan 16: SyncNowButtons */}
          (כפתורי סנכרון יופיעו כאן — ממומש בשלב הבא)
        </p>
      </section>

      <section>
        <h2 className="text-lg font-semibold mb-3">ריצות אחרונות</h2>
        <p className="text-text-secondary text-sm">
          {/* Plan 13: JobsTable */}
          (טבלת ריצות Inngest תופיע כאן — ממומש בשלב הבא)
        </p>
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
