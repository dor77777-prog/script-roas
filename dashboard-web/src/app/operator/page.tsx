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
// Design tokens (`max-w-7xl`, `text-ink-secondary`, etc.) follow S-8 (RTL +
// Hebrew) and D-D4 (match existing dashboard styling — no new tokens).

import { ManualOverridesCrud } from '@/components/operator/ManualOverridesCrud';
import { JobsTable } from '@/components/operator/JobsTable';
import { BackfillPicker } from '@/components/operator/BackfillPicker';
import { SyncNowButtons } from '@/components/operator/SyncNowButtons';
import { ResetData } from '@/components/operator/ResetData';
import { WhatsappTestButtons } from '@/components/operator/WhatsappTestButtons';
import { TokenFailuresTable } from '@/components/operator/TokenFailuresTable';
import { OperatorSecretBanner } from '@/components/operator/OperatorSecretBanner';
import { MetaBucPanel } from '@/components/operator/MetaBucPanel';
import { FreshnessPanel } from '@/components/operator/FreshnessPanel';
import { StatusEventsFeed } from '@/components/operator/StatusEventsFeed';
import { CronTickSnapshotsViewer } from '@/components/operator/CronTickSnapshotsViewer';

// Phase A (Task 15): MetaBucPanel + FreshnessPanel are async server components
// that fetch at request time. force-dynamic ensures operator's hard-refresh
// always re-runs the DB queries rather than serving a stale RSC payload.
export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'ניהול — ROAS Dashboard',
};

export default function OperatorPage() {
  return (
    <div className="max-w-7xl mx-auto px-4 py-6 space-y-8">
      <header>
        <h1 className="text-2xl font-bold">ניהול</h1>
        <p className="text-ink-secondary text-sm mt-1">
          ניהול אוטומציה: ריצות Inngest, backfill, החלפות ידניות, ו-Sync.
        </p>
      </header>

      {/* Security hardening FIX 3: operator-secret entry/management.
          Renders when OPERATOR_SECRET env var is configured on the server.
          When env var is unset this banner is harmless — the gate is inactive
          and all /api/operator/* calls pass through without the header.
          The banner is always visible so the operator can manage the stored
          secret even when the gate is not enforced. */}
      <OperatorSecretBanner />

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
        <h2 className="text-lg font-semibold mb-3 flex items-center gap-2">
          <span>בעיות טוקן</span>
          <span className="text-ink-secondary text-xs font-normal">
            (אישורים שפגו / API tokens שצריך לחדש)
          </span>
        </h2>
        {/* Phase 05.7.x (2026-05-23) — TokenFailuresTable surfaces every
            upstream auth/API failure detected by the fetchers (Google,
            Meta, TikTok, WhatsApp, Shopify, FX). Wiring on the fetcher
            side ships once the `token_failure_alert` WhatsApp template
            is approved by Meta — until then this section stays empty.
            Resolve button clears the alert cycle so the next failure
            re-alerts immediately. */}
        <TokenFailuresTable />
      </section>

      {/* Phase A.5 Task 8 — historical TikTok attribution disclaimer.
          Inline static chip; no dedicated component (YAGNI). The
          campaign-store-map shipped on 2026-05-29; rows in campaigns_daily /
          ads_daily before this date stay attributed to uzoshop because the
          legacy STORES_WITH_TIKTOK = {'uzoshop'} bucketed everything there.
          New rows from the next cron-live-heavy tick onward honor the
          per-campaign Store dropdown in the Campaigns tab. */}
      <section className="rounded-md border border-status-orange/30 bg-status-orange/8 px-4 py-3 text-sm">
        <p className="text-ink-secondary">
          <span className="font-semibold text-status-orange">שורות TikTok היסטוריות</span>
          {' '}(לפני 2026-05-29) משויכות כולן ל-<code>uzoshop</code>. זו ההנחה הישנה
          מלפני שמיפוי קמפיין↔חנות עלה ב-Phase A.5. השתמש בעמודת{' '}
          <span className="font-semibold">חנות</span> ב-<code>קמפיינים</code> כדי לתייג
          קמפיינים — נתונים חדשים יזרמו לחנות הנכונה מהtick הבא של cron-live-heavy
          ויסונכרנו ל-<code>data_daily.tt_spend_cad</code> ב-cron-daily של חצות.
        </p>
      </section>

      {/* Phase A (Task 15): MetaBucPanel — per-(store, ad_account) BUC usage.
          Server component; fetches meta_buc_usage at request time.
          ≥80% triggers budget_skip guard in cron-live-heavy; operator can
          see which accounts are near/over the threshold here. */}
      <section>
        <h2 className="text-lg font-semibold mb-3 flex items-center gap-2">
          <span>תקציב Meta BUC</span>
          <span className="text-ink-secondary text-xs font-normal">
            (per ad-account; ≥80% מפעיל budget skip מונע)
          </span>
        </h2>
        <MetaBucPanel />
      </section>

      {/* Phase A (Task 15): FreshnessPanel — (store, platform, scope, table)
          lag matrix. Server component; fetches data_freshness at request time.
          Sorted by lag_minutes DESC NULLS LAST so the stale rows float up. */}
      <section>
        <h2 className="text-lg font-semibold mb-3 flex items-center gap-2">
          <span>טריות נתונים</span>
          <span className="text-ink-secondary text-xs font-normal">
            (לכל store × platform × scope × table — ממוין לפי lag יורד)
          </span>
        </h2>
        <FreshnessPanel />
      </section>

      {/* Phase B (Task 13): StatusEventsFeed — recent status_events stream
          (tick/worker lifecycle, errors, budget_skip). Server component;
          fetches at request time. */}
      <section>
        <h2 className="text-lg font-semibold mb-3 flex items-center gap-2">
          <span>סטטוס אירועים</span>
          <span className="text-ink-secondary text-xs font-normal">
            (status_events — מחזור חיים של tick/worker, שגיאות, budget skip)
          </span>
        </h2>
        <StatusEventsFeed />
      </section>

      {/* Phase B (Task 13): CronTickSnapshotsViewer — per-tick snapshot
          history (per (store, platform) outcome of each orchestrator run).
          Server component; fetches cron_tick_snapshots at request time. */}
      <section>
        <h2 className="text-lg font-semibold mb-3 flex items-center gap-2">
          <span>סנפשוטים של cron ticks</span>
          <span className="text-ink-secondary text-xs font-normal">
            (cron_tick_snapshots — תוצאה לכל (store × platform) בכל ריצה)
          </span>
        </h2>
        <CronTickSnapshotsViewer />
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
          <span className="text-ink-secondary text-xs font-normal">
            (3 הודעות אוטומטיות ביום — 12:00, 18:00, 00:10)
          </span>
        </h2>
        <p className="text-ink-secondary text-sm mb-3">
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
      <hr className="border-line-subtle" />
      <section>
        <h2 className="text-lg font-semibold mb-3 flex items-center gap-2">
          <span>ניקוי וריסט</span>
          <span className="text-ink-secondary text-xs font-normal">
            (destructive — איפוס נתונים)
          </span>
        </h2>
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
