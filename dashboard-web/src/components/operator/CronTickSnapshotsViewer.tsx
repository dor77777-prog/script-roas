'use client';

// dashboard-web/src/components/operator/CronTickSnapshotsViewer.tsx
//
// Phase B — last 144 cron-tick snapshots (24h × 6 ticks/h).
//
// Task 5.2 (UI/UX overhaul, 2026-05-30): converted from an async server
// component to a client component with 15 s SWR polling so all 4 operator
// sub-tabs share a single refresh paradigm.

import useSWR from 'swr';
import { operatorFetch } from '@/lib/operatorClient';
import { TableBase } from '@/components/ui/TableBase';
import { Heading } from '@/components/ui/Typography';
import type { CronTickSnapshotsResponse } from '@/app/api/operator/cron-tick-snapshots/route';

const ENDPOINT = '/api/operator/cron-tick-snapshots';

async function fetcher(url: string): Promise<CronTickSnapshotsResponse> {
  const res = await operatorFetch(url);
  return (await res.json()) as CronTickSnapshotsResponse;
}

function durationSeconds(start: string, end: string | null): string {
  if (!end) return '—';
  const ms = new Date(end).getTime() - new Date(start).getTime();
  return `${(ms / 1000).toFixed(1)}s`;
}

export function CronTickSnapshotsViewer() {
  const { data, isLoading } = useSWR<CronTickSnapshotsResponse>(ENDPOINT, fetcher, {
    refreshInterval: 15_000,
    revalidateOnFocus: true,
  });

  if (isLoading && !data) {
    return (
      <section className="border border-glass-edge rounded-lg p-4 text-ink-secondary text-sm">
        <Heading level="section" className="font-medium mb-2">Cron-tick snapshots</Heading>
        <p>טוען…</p>
      </section>
    );
  }

  const rows = data?.rows ?? [];

  if (rows.length === 0) {
    return (
      <section className="border border-glass-edge rounded-lg p-4 text-ink-secondary text-sm">
        <Heading level="section" className="font-medium mb-2">Cron-tick snapshots</Heading>
        <p>אין ticks עדיין.</p>
      </section>
    );
  }
  return (
    <section className="border border-glass-edge rounded-lg p-4">
      <Heading level="section" className="font-medium mb-3">
        Cron-tick snapshots <span className="text-xs text-ink-secondary">({rows.length} ticks אחרונים)</span>
      </Heading>
      <div className="overflow-x-auto">
        <TableBase>
          <thead className="text-xs text-ink-secondary border-b border-glass-edge">
            <tr>
              <th className="text-end py-1 pe-2">tick_id</th>
              <th className="text-start py-1 px-2">fan_out</th>
              <th className="text-start py-1 px-2">completed</th>
              <th className="text-start py-1 px-2">skipped</th>
              <th className="text-start py-1 px-2">failed</th>
              <th className="text-start py-1 ps-2">duration</th>
            </tr>
          </thead>
          <tbody className="font-mono text-xs">
            {rows.map((r) => (
              <tr key={r.tick_id} className="border-b border-glass-edge/40">
                <td className="text-end py-1 pe-2">{r.tick_id}</td>
                <td className="py-1 px-2">{r.fan_out_count ?? '—'}</td>
                <td className="py-1 px-2 text-status-green">{r.events_completed_count ?? '—'}</td>
                <td className="py-1 px-2 text-status-orange">{r.events_skipped_count ?? '—'}</td>
                <td className="py-1 px-2 text-status-red">{r.events_failed_count ?? '—'}</td>
                <td className="py-1 ps-2 text-ink-secondary">{durationSeconds(r.started_at, r.finished_at)}</td>
              </tr>
            ))}
          </tbody>
        </TableBase>
      </div>
    </section>
  );
}
