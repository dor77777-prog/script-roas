// dashboard-web/src/app/operator/ActivityTab.tsx
//
// Activity sub-tab: status events feed + cron tick snapshots.
// These sections were previously rendered directly in operator/page.tsx;
// they are extracted here as part of the Task 23 /operator 4-sub-tab split.
//
// Inngest decommission (Stage 4, 2026-06-21): the legacy "ריצות אחרונות"
// JobsTable polled /api/operator/jobs, which proxied the Inngest REST API.
// Nothing runs on Inngest anymore (the whole pipeline is Vercel Cron + QStash),
// so that data source is gone — the JobsTable + its route were removed.
//
// Post-Stage-4: "ריצות אחרונות" is REBUILT as <RunsPanel> — a QStash/DB-backed
// CONSOLIDATED per-job last-run / health summary (one row per cron + worker job)
// reading data_freshness + cron_tick_snapshots via /api/operator/runs. It sits
// FIRST here as the at-a-glance roster, and COMPLEMENTS (does not duplicate) the
// two detail feeds below it: StatusEventsFeed (per-entity status_events stream:
// tick/worker lifecycle, errors, budget_skip) + CronTickSnapshotsViewer
// (per-tick fan-out snapshots from cron_tick_snapshots). All three are DB-backed.

import { RunsPanel } from '@/components/operator/RunsPanel';
import { StatusEventsFeed } from '@/components/operator/StatusEventsFeed';
import { CronTickSnapshotsViewer } from '@/components/operator/CronTickSnapshotsViewer';
import { Heading } from '@/components/ui/Typography';

export function ActivityTab() {
  return (
    <div className="space-y-8">
      {/* Rebuilt "ריצות אחרונות": consolidated per-job last-run/health summary
          (data_freshness + cron_tick_snapshots → /api/operator/runs). Replaces
          the removed Inngest JobsTable; complements the detail feeds below. */}
      <section>
        <Heading level="hero" className="mb-3 flex items-center gap-2">
          <span>ריצות אחרונות</span>
          <span className="text-ink-secondary text-xs font-normal">
            (סיכום בריאות פר-job — data_freshness + cron_tick_snapshots, QStash/Vercel-Cron)
          </span>
        </Heading>
        <RunsPanel />
      </section>

      {/* Phase B (Task 13): StatusEventsFeed — recent status_events stream
          (tick/worker lifecycle, errors, budget_skip). Server component;
          fetches at request time. */}
      <section>
        <Heading level="hero" className="mb-3 flex items-center gap-2">
          <span>סטטוס אירועים</span>
          <span className="text-ink-secondary text-xs font-normal">
            (status_events — מחזור חיים של tick/worker, שגיאות, budget skip)
          </span>
        </Heading>
        <StatusEventsFeed />
      </section>

      {/* Phase B (Task 13): CronTickSnapshotsViewer — per-tick snapshot
          history (per (store, platform) outcome of each orchestrator run).
          Server component; fetches cron_tick_snapshots at request time. */}
      <section>
        <Heading level="hero" className="mb-3 flex items-center gap-2">
          <span>סנפשוטים של cron ticks</span>
          <span className="text-ink-secondary text-xs font-normal">
            (cron_tick_snapshots — תוצאה לכל (store × platform) בכל ריצה)
          </span>
        </Heading>
        <CronTickSnapshotsViewer />
      </section>
    </div>
  );
}
