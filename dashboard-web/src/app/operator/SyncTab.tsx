// dashboard-web/src/app/operator/SyncTab.tsx
//
// Sync sub-tab: manual sync triggers, date-range backfill, and spend overrides.
// All three sections were previously rendered directly in operator/page.tsx;
// they are extracted here as part of the Task 23 /operator 4-sub-tab split.

import { SyncNowButtons } from '@/components/operator/SyncNowButtons';
import { BackfillPicker } from '@/components/operator/BackfillPicker';
import { ManualOverridesCrud } from '@/components/operator/ManualOverridesCrud';
import { Heading } from '@/components/ui/Typography';

export function SyncTab() {
  return (
    <div className="space-y-8">
      <section>
        <Heading level="hero" className="mb-3">סנכרון עכשיו</Heading>
        {/* Plan 16: SyncNowButtons — 1 global + 3 per-store buttons. The component
            owns its own pending / message / error states; this <section>
            only owns the title. */}
        <SyncNowButtons />
      </section>

      <section>
        <Heading level="hero" className="mb-3">Backfill טווח תאריכים</Heading>
        {/* Plan 14: BackfillPicker — the component owns its own loading / error /
            confirmation states; this <section> only owns the title. */}
        <BackfillPicker />
      </section>

      <section>
        <Heading level="hero" className="mb-3">החלפות הוצאה ידניות</Heading>
        {/* Plan 15: ManualOverridesCrud — the component handles its own loading /
            error / empty states; this <section> only owns the title. */}
        <ManualOverridesCrud />
      </section>
    </div>
  );
}
