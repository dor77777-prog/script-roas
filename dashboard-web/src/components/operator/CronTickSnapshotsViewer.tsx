'use client';

// dashboard-web/src/components/operator/CronTickSnapshotsViewer.tsx
//
// Phase B — last 144 cron-tick snapshots (24h × 6 ticks/h).
//
// Task 5.2 (UI/UX overhaul, 2026-05-30): converted from an async server
// component to a client component with 15 s SWR polling so all 4 operator
// sub-tabs share a single refresh paradigm.

import useSWR from 'swr';
import { CheckCircle2, AlertTriangle, XCircle } from 'lucide-react';
import { operatorFetch } from '@/lib/operatorClient';
import { TableBase } from '@/components/ui/TableBase';
import { Card } from '@/components/ui/Card';
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

  // W7-T6 — `<section border…rounded-lg>` → shared `<Card>`, and the inner
  // "Cron-tick snapshots" heading is DROPPED: the ActivityTab section already
  // self-titles this panel, so the feed's own h-heading duplicated it. The
  // "(N ticks אחרונים)" count is kept as a muted caption so no info is lost.
  if (isLoading && !data) {
    return (
      <Card data-testid="cron-tick-snapshots" className="text-ink-secondary text-sm">
        <p>טוען…</p>
      </Card>
    );
  }

  const rows = data?.rows ?? [];

  if (rows.length === 0) {
    return (
      <Card data-testid="cron-tick-snapshots" className="text-ink-secondary text-sm">
        <p>אין ticks עדיין.</p>
      </Card>
    );
  }
  return (
    <Card data-testid="cron-tick-snapshots">
      <p className="text-xs text-ink-secondary mb-3">({rows.length} ticks אחרונים)</p>
      <div className="overflow-x-auto">
        <TableBase>
          <thead className="text-xs text-ink-secondary border-b border-glass-edge">
            <tr>
              <th className="text-end py-1 pe-2">tick_id</th>
              <th className="text-start py-1 px-2">fan_out</th>
              {/* W7-T6 — each count column header carries its own status icon so
                  the completed/skipped/failed meaning is NOT conveyed by colour
                  alone (WCAG 1.4.1). The icon repeats in each cell below. */}
              <th className="text-start py-1 px-2">
                <span className="inline-flex items-center gap-1">
                  <CheckCircle2 size={12} className="text-status-greenFg" aria-hidden="true" />
                  completed
                </span>
              </th>
              <th className="text-start py-1 px-2">
                <span className="inline-flex items-center gap-1">
                  <AlertTriangle size={12} className="text-status-orangeFg" aria-hidden="true" />
                  skipped
                </span>
              </th>
              <th className="text-start py-1 px-2">
                <span className="inline-flex items-center gap-1">
                  <XCircle size={12} className="text-status-redFg" aria-hidden="true" />
                  failed
                </span>
              </th>
              <th className="text-start py-1 ps-2">duration</th>
            </tr>
          </thead>
          <tbody className="font-mono text-xs">
            {rows.map((r) => (
              <tr key={r.tick_id} className="border-b border-glass-edge/40">
                <td className="text-end py-1 pe-2">{r.tick_id}</td>
                <td className="py-1 px-2">{r.fan_out_count ?? '—'}</td>
                {/* Non-colour cue: a leading icon pairs with the colour so the
                    outcome (completed/skipped/failed) is legible without
                    relying on hue. */}
                <td className="py-1 px-2 text-status-greenFg">
                  <span className="inline-flex items-center gap-1">
                    <CheckCircle2 size={12} aria-hidden="true" />
                    {r.events_completed_count ?? '—'}
                  </span>
                </td>
                <td className="py-1 px-2 text-status-orangeFg">
                  <span className="inline-flex items-center gap-1">
                    <AlertTriangle size={12} aria-hidden="true" />
                    {r.events_skipped_count ?? '—'}
                  </span>
                </td>
                <td className="py-1 px-2 text-status-redFg">
                  <span className="inline-flex items-center gap-1">
                    <XCircle size={12} aria-hidden="true" />
                    {r.events_failed_count ?? '—'}
                  </span>
                </td>
                <td className="py-1 ps-2 text-ink-secondary">{durationSeconds(r.started_at, r.finished_at)}</td>
              </tr>
            ))}
          </tbody>
        </TableBase>
      </div>
    </Card>
  );
}
