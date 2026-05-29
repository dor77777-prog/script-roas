// dashboard-web/src/components/operator/CronTickSnapshotsViewer.tsx
//
// Phase B — last 144 cron-tick snapshots (24h × 6 ticks/h). Server
// component.

import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { fetchCronTickSnapshots, type CronTickSnapshotRow } from '@/lib/operator/registriesReaders';

function durationSeconds(start: string, end: string | null): string {
  if (!end) return '—';
  const ms = new Date(end).getTime() - new Date(start).getTime();
  return `${(ms / 1000).toFixed(1)}s`;
}

export async function CronTickSnapshotsViewer() {
  const rows: CronTickSnapshotRow[] = await fetchCronTickSnapshots(getSupabaseAdmin());
  if (rows.length === 0) {
    return (
      <section className="border border-line-subtle rounded-lg p-4 text-ink-secondary text-sm">
        <h3 className="text-base font-medium text-ink-primary mb-2">Cron-tick snapshots</h3>
        <p>אין ticks עדיין.</p>
      </section>
    );
  }
  return (
    <section className="border border-line-subtle rounded-lg p-4">
      <h3 className="text-base font-medium text-ink-primary mb-3">
        Cron-tick snapshots <span className="text-xs text-ink-secondary">({rows.length} ticks אחרונים)</span>
      </h3>
      <div className="overflow-x-auto">
        <table className="w-full text-sm text-ink-primary">
          <thead className="text-xs text-ink-secondary border-b border-line-subtle">
            <tr>
              <th className="text-right py-1 pr-2">tick_id</th>
              <th className="text-left py-1 px-2">fan_out</th>
              <th className="text-left py-1 px-2">completed</th>
              <th className="text-left py-1 px-2">skipped</th>
              <th className="text-left py-1 px-2">failed</th>
              <th className="text-left py-1 pl-2">duration</th>
            </tr>
          </thead>
          <tbody className="font-mono text-xs">
            {rows.map((r) => (
              <tr key={r.tick_id} className="border-b border-line-subtle/40">
                <td className="text-right py-1 pr-2">{r.tick_id}</td>
                <td className="py-1 px-2">{r.fan_out_count ?? '—'}</td>
                <td className="py-1 px-2 text-status-green">{r.events_completed_count ?? '—'}</td>
                <td className="py-1 px-2 text-status-orange">{r.events_skipped_count ?? '—'}</td>
                <td className="py-1 px-2 text-status-red">{r.events_failed_count ?? '—'}</td>
                <td className="py-1 pl-2 text-ink-secondary">{durationSeconds(r.started_at, r.finished_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
