// dashboard-web/src/app/operator/ActivityTab.tsx
//
// Activity sub-tab: status events feed, cron tick snapshots, and recent jobs.
// All three sections were previously rendered directly in operator/page.tsx;
// they are extracted here as part of the Task 23 /operator 4-sub-tab split.

import { StatusEventsFeed } from '@/components/operator/StatusEventsFeed';
import { CronTickSnapshotsViewer } from '@/components/operator/CronTickSnapshotsViewer';
import { JobsTable } from '@/components/operator/JobsTable';
import { Heading } from '@/components/ui/Typography';

export function ActivityTab() {
  return (
    <div className="space-y-8">
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

      <section>
        <Heading level="hero" className="mb-3">ריצות אחרונות</Heading>
        {/* Plan 13: JobsTable — SWR polls /api/operator/jobs every 15s (D-D3);
            the proxy soft-fails to HTTP 200 with { runs: [], error } so the
            component handles loading / amber / empty states itself. */}
        <JobsTable />
      </section>
    </div>
  );
}
