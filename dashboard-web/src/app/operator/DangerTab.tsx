// dashboard-web/src/app/operator/DangerTab.tsx
//
// Danger sub-tab: WhatsApp test buttons and destructive reset panel.
// Both sections were previously rendered directly in operator/page.tsx
// (reset was separated by an <hr>); they are extracted here as part of
// the Task 23 /operator 4-sub-tab split.
//
// ResetData owns its own typed-token confirmation gate internally — this
// sub-tab just renders it without wrapping any additional guard.

import { AlertTriangle } from 'lucide-react';
import { WhatsappTestButtons } from '@/components/operator/WhatsappTestButtons';
import { ResetData } from '@/components/operator/ResetData';
import { Card } from '@/components/ui/Card';
import { Heading } from '@/components/ui/Typography';

export function DangerTab() {
  return (
    <div className="space-y-8">
      <section>
        <Heading level="hero" className="mb-3 flex items-center gap-2">
          <span>התראות WhatsApp</span>
          <span className="text-ink-secondary text-xs font-normal">
            (3 הודעות אוטומטיות ביום — 12:00, 18:00, 00:10)
          </span>
        </Heading>
        <p className="text-ink-secondary text-sm mb-3">
          הקרון של Inngest שולח דוח ROAS יומי ב-WhatsApp ל-2 מספרים מוגדרים
          (notification_config). הכפתורים למטה מאפשרים לשלוח ידנית את אותה
          הודעה בדיוק — לבדיקה לאחר שינוי env vars (WHATSAPP_*), רוטציית
          טוקן System User, או אישור template חדש ב-Meta WhatsApp Manager.
        </p>
        <WhatsappTestButtons />
      </section>

      {/* Phase 05.7.1 / W7-T6: destructive reset panel. The section is now
          wrapped in a red-tinted "danger zone" Card (border-status-red + a
          status-redBg accent header + an AlertTriangle + red title) so the
          destructive nature reads at a glance — the <hr> + plain heading gave
          no visual danger signal. ResetData itself is unchanged; it still
          enforces a typed-token confirmation before any DELETE fires. */}
      <Card
        className="border-status-red"
        aria-labelledby="danger-zone-title"
        data-testid="danger-zone-card"
      >
        <div className="-mx-5 -mt-5 mb-4 flex items-center gap-2 rounded-t-hz border-b border-status-red bg-status-redBg px-5 py-3">
          <AlertTriangle className="h-5 w-5 shrink-0 text-status-redFg" aria-hidden="true" />
          <Heading id="danger-zone-title" level="section" className="text-status-redFg">
            ניקוי וריסט
            <span className="text-status-redFg text-xs font-normal ms-2">
              (destructive — איפוס נתונים)
            </span>
          </Heading>
        </div>
        <p className="text-ink-secondary text-sm mb-3">
          מחיקה רבת-טבלאות של נתוני הדשבורד ב-Supabase, על מנת להריץ
          backfill מאפס ולוודא שהדשבורד מתמלא מחדש כראוי. הפעולה מתאשרת
          על-ידי הקלדת טוקן ייחודי לכל מצב.
        </p>
        <ResetData />
      </Card>
    </div>
  );
}
