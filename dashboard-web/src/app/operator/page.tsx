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
//   - Phase 05.7.1: ResetData      → "ניקוי וריסט"            ← destructive,
//                                                              placed at the
//                                                              bottom so it
//                                                              never reads as
//                                                              "the next step
//                                                              in the normal
//                                                              flow"
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
import { ResetData } from '@/components/operator/ResetData';
import { WhatsappTestButtons } from '@/components/operator/WhatsappTestButtons';

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

      <section>
        <h2 className="text-lg font-semibold mb-3 flex items-center gap-2">
          <span>התראות WhatsApp</span>
          <span className="text-text-secondary text-xs font-normal">
            (3 הודעות אוטומטיות ביום — 12:00, 18:00, 00:10)
          </span>
        </h2>
        <p className="text-text-secondary text-sm mb-3">
          הקרון של Inngest שולח דוח ROAS יומי ב-WhatsApp ל-2 מספרים מוגדרים
          (notification_config). הכפתורים למטה מאפשרים לשלוח ידנית את אותה
          הודעה בדיוק — לבדיקה לאחר שינוי env vars (WHATSAPP_*), רוטציית
          טוקן System User, או אישור template חדש ב-Meta WhatsApp Manager.
        </p>
        <WhatsappTestButtons />
      </section>

      {/* Phase 05.7.1: destructive reset panel. Placed at the bottom +
          separated by a horizontal rule so it is visually distinct from
          the normal sync / backfill / overrides flow above. Section
          heading 'ניקוי וריסט' (cleanup & reset) signals the read-this-
          carefully nature; the component itself enforces a typed-token
          confirmation before any DELETE fires. */}
      <hr className="border-white/10" />
      <section>
        <h2 className="text-lg font-semibold mb-3 flex items-center gap-2">
          <span>ניקוי וריסט</span>
          <span className="text-text-secondary text-xs font-normal">
            (destructive — איפוס נתונים)
          </span>
        </h2>
        <p className="text-text-secondary text-sm mb-3">
          מחיקה רבת-טבלאות של נתוני הדשבורד ב-Supabase, על מנת להריץ
          backfill מאפס ולוודא שהדשבורד מתמלא מחדש כראוי. הפעולה מתאשרת
          על-ידי הקלדת טוקן ייחודי לכל מצב.
        </p>
        <ResetData />
      </section>
    </div>
  );
}
