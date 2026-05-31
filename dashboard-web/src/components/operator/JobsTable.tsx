'use client';

// dashboard-web/src/components/operator/JobsTable.tsx
//
// Client component backing the "ריצות אחרונות" section of /operator.
// Polls /api/operator/jobs every 15s via SWR (D-D3) and renders a
// Hebrew/RTL table of Inngest function runs.
//
// SECURITY (T-05.6-13-I1):
//   This file MUST NEVER reference the Inngest signing-key env var.
//   The key lives only in the server-side proxy at
//   /api/operator/jobs/route.ts. The pre-merge grep gate from the plan
//   asserts zero occurrences of that env-var name anywhere under
//   dashboard-web/src/components/ or dashboard-web/src/app/operator/*.tsx.
//   If anyone copy-pastes the route's process.env line into this file,
//   webpack will bundle the secret into the client chunk and the gate
//   will fail the build.
//
// SECURITY (no admin imports):
//   No `supabaseAdmin` import — that module is server-only and the
//   grep gate also asserts this. Component talks to JSON endpoints
//   only.
//
// Why SWR with refreshInterval (NOT inngest-realtime-react):
//   D-D3 explicitly chose 15s polling over realtime to avoid wiring a
//   second SDK (`@inngest/realtime`) for a once-a-day-glance dashboard.
//   The 15s cadence matches cron-live's */15min schedule — operator
//   sees the next scheduled run land within at most one tick.
//
// Why the proxy returns 200 on errors (S-2):
//   The fetcher always parses JSON. data.error surfaces an amber inline
//   banner instead of forcing a hard SWR error state — partner can
//   keep using the other operator sections (overrides, sync-now)
//   while jobs is degraded.
//
// Why row-expand for output (NOT a separate modal):
//   The output payload can be arbitrary JSON. A modal would steal
//   focus + cover other rows the operator might want to compare.
//   Inline `<pre dir="ltr">` lets the operator skim multiple expanded
//   rows side by side. dir="ltr" is required because JSON syntax is
//   left-to-right even inside an RTL page.
//
// Why formatRelative + absolute title:
//   The relative ("לפני N דקות") helps the operator scan; the absolute
//   ISO timestamp on the title attribute is the precise value they
//   paste into ops chat. Matches the existing SyncIndicator pattern.

import useSWR from 'swr';
import { useState } from 'react';
import { Loader2, CheckCircle2, XCircle, Clock, AlertCircle } from 'lucide-react';
import { operatorFetch } from '@/lib/operatorClient';
import { Button } from '@/components/ui/Button';
import { TableBase } from '@/components/ui/TableBase';
import { HelpTooltip } from '@/components/ui/Tooltip';

// Wire-shape of the /api/operator/jobs proxy response. Mirrors the
// narrowed type in route.ts — we deliberately do NOT import the type
// across the server/client boundary so that the boundary stays
// inspectable in the network panel.
type InngestRun = {
  run_id: string;
  run_started_at: string;
  ended_at: string | null;
  status: 'Running' | 'Completed' | 'Failed' | 'Cancelled';
  function_id: string;
  event_id: string | null;
  event_name?: string;
  output?: unknown;
};

type JobsResponse = {
  runs: InngestRun[];
  lastUpdated: string;
  error?: string;
};

async function fetcher(url: string): Promise<JobsResponse> {
  const res = await operatorFetch(url);
  // The proxy always returns HTTP 200 (S-2 soft-fail). If it ever
  // returns 4xx/5xx that's a true infrastructure failure — let SWR
  // surface it via the `error` branch in the hook below. We don't
  // need a res.ok guard here.
  return (await res.json()) as JobsResponse;
}

// Format a duration between two ISO timestamps. `ended_at === null`
// means the run is still in flight. Sub-second values get ms
// granularity; under a minute, decimal seconds; otherwise minutes.
// All formatting is dir-neutral (digits + Latin units) so we don't
// need to flip text direction on the cell.
function formatDuration(start: string, end: string | null): string {
  if (!end) return 'running…';
  const ms = new Date(end).getTime() - new Date(start).getTime();
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60_000).toFixed(1)}m`;
}

// Hebrew relative-time. We only format down to the minute because the
// table is meant for scanning, not for second-precision triage —
// that's what the title attribute (ISO timestamp) is for.
function formatRelative(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 60_000) return 'לפני פחות מדקה';
  if (ms < 3_600_000) return `לפני ${Math.floor(ms / 60_000)} דקות`;
  if (ms < 86_400_000) return `לפני ${Math.floor(ms / 3_600_000)} שעות`;
  return `לפני ${Math.floor(ms / 86_400_000)} ימים`;
}

// Status → visual treatment. Color + icon mirror Inngest dashboard's
// own palette so an operator switching between this view and the
// Inngest UI doesn't have to relearn the encoding. Running animates
// the loader to give a "this row will change soon" signal.
function StatusBadge({ status }: { status: InngestRun['status'] }) {
  const cls =
    status === 'Completed' ? 'bg-status-greenBg text-status-green border border-status-green/30'
      : status === 'Failed' ? 'bg-status-redBg text-status-red border border-status-red/30'
        : status === 'Running' ? 'bg-status-blueBg text-status-blue border border-status-blue/30'
          : 'bg-status-grayBg text-status-gray border border-status-gray/30';
  const Icon =
    status === 'Completed' ? CheckCircle2
      : status === 'Failed' ? XCircle
        : status === 'Running' ? Loader2
          : Clock;
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs ${cls}`}>
      <Icon className={`w-3 h-3 ${status === 'Running' ? 'animate-spin' : ''}`} />
      {status}
    </span>
  );
}

export function JobsTable() {
  // `?limit=50` matches the proxy's MAX_LIMIT clamp. SWR's
  // refreshInterval=15_000 gives the 15s polling cadence (D-D3).
  // revalidateOnFocus=true means returning to the tab refreshes
  // immediately rather than waiting for the next 15s tick.
  const { data, error, isLoading } = useSWR<JobsResponse>(
    '/api/operator/jobs?limit=50',
    fetcher,
    { refreshInterval: 15_000, revalidateOnFocus: true },
  );
  const [expandedId, setExpandedId] = useState<string | null>(null);

  if (isLoading) {
    return <p className="text-ink-secondary text-sm">טוען ריצות…</p>;
  }
  if (error) {
    // Hard SWR error — the proxy is supposed to soft-fail with 200, so
    // landing here means either a network blip in the browser or the
    // route module itself failed to load. Render the raw error string
    // (already client-side, no exfiltration concern) for ops triage.
    return (
      <p className="text-status-red text-sm">
        שגיאה בטעינת ריצות: {error instanceof Error ? error.message : String(error)}
      </p>
    );
  }
  if (data?.error) {
    // Soft-fail amber banner. Matches the ManualOverridesCrud and
    // SyncIndicator degraded-state pattern — non-blocking, sanitized
    // Hebrew copy from userFacingError on the server.
    return (
      <p className="text-status-orange text-sm flex items-center gap-1">
        <AlertCircle className="w-4 h-4" />
        {data.error}
      </p>
    );
  }
  if (!data?.runs || data.runs.length === 0) {
    // Expected state until Wave 9 deploys /api/inngest with actual
    // functions registered. Don't surface as an error — just say
    // there are no runs yet. The "עודכן…" line still renders if
    // data.lastUpdated is present so the operator sees the polling
    // is alive even with zero rows.
    return (
      <div className="space-y-2">
        <p className="text-ink-secondary text-sm">אין ריצות אחרונות.</p>
        {data?.lastUpdated && (
          <p className="text-ink-secondary text-xs">
            עודכן {formatRelative(data.lastUpdated)} · רענון אוטומטי כל 15 שנ׳
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <TableBase>
        <thead className="text-ink-secondary text-xs uppercase tracking-wider bg-canvas">
          <tr>
            <th className="text-end p-2">פונקציה</th>
            <th className="text-end p-2">סטטוס</th>
            <th className="text-end p-2">התחלה</th>
            <th className="text-end p-2">משך</th>
            <th className="text-end p-2">פרטים</th>
          </tr>
        </thead>
        <tbody>
          {data.runs.map((run) => (
            <tr key={run.run_id} className="border-t border-glass-edge">
              <td className="p-2 font-mono text-xs">{run.function_id}</td>
              <td className="p-2"><StatusBadge status={run.status} /></td>
              <HelpTooltip content={run.run_started_at}>
                <td className="p-2 text-ink-secondary text-xs">
                  {formatRelative(run.run_started_at)}
                </td>
              </HelpTooltip>
              <td className="p-2 text-ink-secondary text-xs" dir="ltr">
                {formatDuration(run.run_started_at, run.ended_at)}
              </td>
              <td className="p-2">
                <Button
                  type="button"
                  variant="link"
                  onClick={() =>
                    setExpandedId(expandedId === run.run_id ? null : run.run_id)
                  }
                  className="h-auto p-0 text-xs text-status-blue"
                  aria-expanded={expandedId === run.run_id}
                  aria-controls={`run-output-${run.run_id}`}
                >
                  {expandedId === run.run_id ? 'הסתר' : 'הצג'}
                </Button>
              </td>
            </tr>
          ))}
        </tbody>
      </TableBase>
      {expandedId && (() => {
        const run = data.runs.find((r) => r.run_id === expandedId);
        if (!run) return null;
        return (
          <pre
            id={`run-output-${run.run_id}`}
            className="text-xs bg-canvas text-ink-secondary p-3 mt-2 rounded overflow-x-auto"
            dir="ltr"
          >
            {JSON.stringify(
              { run_id: run.run_id, event_id: run.event_id, event_name: run.event_name, output: run.output },
              null,
              2,
            )}
          </pre>
        );
      })()}
      <p className="text-ink-secondary text-xs mt-2">
        עודכן {data.lastUpdated ? formatRelative(data.lastUpdated) : '—'} · רענון אוטומטי כל 15 שנ׳
      </p>
    </div>
  );
}
