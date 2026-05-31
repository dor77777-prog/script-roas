// dashboard-web/src/app/operator/DangerTab.tsx
//
// Danger sub-tab: WhatsApp test buttons and destructive reset panel.
// Both sections were previously rendered directly in operator/page.tsx
// (reset was separated by an <hr>); they are extracted here as part of
// the Task 23 /operator 4-sub-tab split.
//
// ResetData owns its own typed-token confirmation gate internally — this
// sub-tab just renders it without wrapping any additional guard.

import { WhatsappTestButtons } from '@/components/operator/WhatsappTestButtons';
import { ResetData } from '@/components/operator/ResetData';
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

      <hr className="border-glass-edge" />

      {/* Phase 05.7.1: destructive reset panel. Separated by a horizontal rule
          so it is visually distinct from the normal WhatsApp testing flow above.
          Section heading 'ניקוי וריסט' signals the read-this-carefully nature;
          the component itself enforces a typed-token confirmation before any
          DELETE fires. */}
      <section>
        <Heading level="hero" className="mb-3 flex items-center gap-2">
          <span>ניקוי וריסט</span>
          <span className="text-ink-secondary text-xs font-normal">
            (destructive — איפוס נתונים)
          </span>
        </Heading>
        <p className="text-ink-secondary text-sm mb-3">
          מחיקה רבת-טבלאות של נתוני הדשבורד ב-Supabase, על מנת להריץ
          backfill מאפס ולוודא שהדשבורד מתמלא מחדש כראוי. הפעולה מתאשרת
          על-ידי הקלדת טוקן ייחודי לכל מצב.
        </p>
        <ResetData />
      </section>
    </div>
  );
}
