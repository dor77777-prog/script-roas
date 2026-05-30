// dashboard-web/src/app/operator/HealthTab.tsx
//
// Health sub-tab: token failures, TikTok historical attribution disclaimer,
// Meta BUC budget usage, and data freshness lag matrix.
// All four sections were previously rendered directly in operator/page.tsx;
// they are extracted here as part of the Task 23 /operator 4-sub-tab split.

import { TokenFailuresTable } from '@/components/operator/TokenFailuresTable';
import { MetaBucPanel } from '@/components/operator/MetaBucPanel';
import { FreshnessPanel } from '@/components/operator/FreshnessPanel';

export function HealthTab() {
  return (
    <div className="space-y-8">
      <section>
        <h2 className="text-lg font-semibold mb-3 flex items-center gap-2">
          <span>בעיות טוקן</span>
          <span className="text-ink-secondary text-xs font-normal">
            (אישורים שפגו / API tokens שצריך לחדש)
          </span>
        </h2>
        {/* Phase 05.7.x (2026-05-23) — TokenFailuresTable surfaces every
            upstream auth/API failure detected by the fetchers (Google,
            Meta, TikTok, WhatsApp, Shopify, FX). Resolve button clears
            the alert cycle so the next failure re-alerts immediately. */}
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
    </div>
  );
}
