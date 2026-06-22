'use client';

// dashboard-web/src/components/operator/RunsPanel.tsx
//
// "ריצות אחרונות" (recent runs / pipeline health) panel — the QStash/DB-backed
// replacement for the removed Inngest JobsTable (which polled /api/operator/jobs,
// an Inngest REST proxy; both deleted in the Stage-4 Inngest decommission).
//
// WHY this exists (vs the sibling StatusEventsFeed + CronTickSnapshotsViewer):
//   Those two are per-ENTITY (status_events) and per-TICK (cron_tick_snapshots)
//   detail feeds. The removed JobsTable's value was a CONSOLIDATED per-JOB
//   last-run / health summary — one row per cron + worker job. This panel fills
//   exactly that gap; it COMPLEMENTS the detail feeds, it does not duplicate
//   them. Click a row to expand into the matching detail (recent ticks for
//   cron-tick, last-error JSON for an errored worker).
//
// DATA SOURCE: /api/operator/runs (server aggregates data_freshness +
//   cron_tick_snapshots via the pure buildRunsSummary module). The route
//   soft-fails with HTTP 200 + {error}; we surface that as an amber inline
//   banner so the panel degrades gracefully instead of hard-erroring.
//
// SWR poll = 20 s (the panel reflects the */10-min tick + 10-min worker cadence;
//   a 20 s cadence shows the next run land well within one cycle without hammering
//   Supabase). revalidateOnFocus refreshes immediately on tab return.
//
// A11y / token rules: status pill carries a lucide icon (non-colour cue, WCAG
//   1.4.1) + a Hebrew label; numeric tick counts render through the shared
//   <Money> primitive (overflow-safe, tabular-nums); the absolute ISO timestamp
//   rides a <HelpTooltip> (NO native title=); the error/tick JSON is an
//   LTR <pre> (JSON is left-to-right even inside the RTL page).

import useSWR from 'swr';
import { useState } from 'react';
import { CheckCircle2, XCircle, Clock, HelpCircle, AlertTriangle } from 'lucide-react';
import { operatorFetch } from '@/lib/operatorClient';
import { Card } from '@/components/ui/Card';
import { TableBase } from '@/components/ui/TableBase';
import { Button } from '@/components/ui/Button';
import { Money } from '@/components/ui/Money';
import { HelpTooltip } from '@/components/ui/Tooltip';
import type { RunRow, RunStatus, JobId } from '@/lib/operator/runsSummary';
import type { RunsResponse } from '@/app/api/operator/runs/route';

const ENDPOINT = '/api/operator/runs';

async function fetcher(url: string): Promise<RunsResponse> {
  const res = await operatorFetch(url);
  // The route always returns HTTP 200 (soft-fail). data.error surfaces an
  // amber banner; we never throw into SWR for the soft-fail path.
  return (await res.json()) as RunsResponse;
}

// ---------------------------------------------------------------------------
// Job → known schedule caption (static metadata, NOT telemetry). Helps the
// operator read a sourceless `unknown` row ("when SHOULD this have run?").
// ---------------------------------------------------------------------------

const JOB_SCHEDULE: Record<JobId, string> = {
  'cron-live': 'כל ~10 דק׳ (Shopify)',
  'cron-daily': 'יומי ~00:30 IL',
  'cron-yesterday': 'יומי (השלמת אתמול)',
  'cron-tick': 'כל 10 דק׳ (orchestrator)',
  'worker-meta': 'fan-out מ-tick',
  'worker-google': 'fan-out מ-tick',
  'worker-tiktok': 'fan-out מ-tick',
  'whatsapp': '12:00 / 18:00 / 00:10 IL',
  'oauth-canary': 'יומי 00:00 IL',
  'cohort': 'שבועי (יום ב׳ ~01:00 IL)',
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Short relative Hebrew time, matching FreshnessPanel. */
function formatRelative(iso: string | null): string {
  if (!iso) return '—';
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return iso;
  const dMin = Math.floor((Date.now() - t) / 60_000);
  if (dMin < 1) return 'כרגע';
  if (dMin < 60) return `${dMin} דק׳ לפני`;
  const dHr = Math.floor(dMin / 60);
  if (dHr < 24) return `${dHr} שע׳ לפני`;
  return `${Math.floor(dHr / 24)} ימים לפני`;
}

// ---------------------------------------------------------------------------
// Status pill — icon (non-colour cue) + Hebrew label, guaranteed-contrast
// on-band foreground tokens.
// ---------------------------------------------------------------------------

function StatusPill({ status }: { status: RunStatus }) {
  const map: Record<RunStatus, { cls: string; Icon: typeof CheckCircle2; label: string }> = {
    success: { cls: 'bg-status-greenBg text-status-greenFg border-status-green', Icon: CheckCircle2, label: 'תקין' },
    error: { cls: 'bg-status-redBg text-status-redFg border-status-red', Icon: XCircle, label: 'שגיאה' },
    stale: { cls: 'bg-status-orangeBg text-status-orangeFg border-status-orange', Icon: Clock, label: 'תקוע' },
    unknown: { cls: 'bg-status-grayBg text-status-grayFg border-status-gray', Icon: HelpCircle, label: 'אין נתון' },
  };
  const { cls, Icon, label } = map[status];
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded border text-xs ${cls}`}>
      <Icon size={12} aria-hidden="true" />
      {label}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function RunsPanel() {
  const { data, isLoading } = useSWR<RunsResponse>(ENDPOINT, fetcher, {
    refreshInterval: 20_000,
    revalidateOnFocus: true,
  });
  const [expanded, setExpanded] = useState<JobId | null>(null);

  if (isLoading && !data) {
    return (
      <Card data-testid="runs-panel" className="text-ink-secondary text-sm">
        <p>טוען ריצות…</p>
      </Card>
    );
  }

  const rows: RunRow[] = data?.rows ?? [];

  return (
    <Card data-testid="runs-panel">
      {data?.error && (
        <p className="mb-3 text-status-orangeFg text-sm flex items-center gap-1.5">
          <AlertTriangle size={16} aria-hidden="true" />
          {data.error}
        </p>
      )}

      {rows.length === 0 && !data?.error ? (
        <p className="text-ink-secondary text-sm">אין נתוני ריצות עדיין.</p>
      ) : rows.length > 0 ? (
        <div className="overflow-x-auto">
          <TableBase className="text-xs sm:text-sm">
            <thead className="text-ink-secondary text-xs uppercase tracking-wider bg-glass-3">
              <tr>
                <th className="px-3 py-2 text-start font-medium">job</th>
                <th className="px-3 py-2 text-start font-medium">סטטוס</th>
                <th className="px-3 py-2 text-start font-medium">הצלחה אחרונה</th>
                <th className="px-3 py-2 text-start font-medium">תזמון</th>
                <th className="px-3 py-2 text-start font-medium">פרטים</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const isOpen = expanded === r.job;
                const canExpand =
                  (r.ticks && r.ticks.length > 0) || r.lastError != null;
                return (
                  <RunTableRow
                    key={r.job}
                    row={r}
                    isOpen={isOpen}
                    canExpand={!!canExpand}
                    onToggle={() => setExpanded(isOpen ? null : r.job)}
                  />
                );
              })}
            </tbody>
          </TableBase>
        </div>
      ) : null}

      {data?.lastUpdated && (
        <p className="text-ink-secondary text-xs mt-3">
          עודכן {formatRelative(data.lastUpdated)} · רענון אוטומטי כל 20 שנ׳
        </p>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Row + expandable detail
// ---------------------------------------------------------------------------

function RunTableRow({
  row,
  isOpen,
  canExpand,
  onToggle,
}: {
  row: RunRow;
  isOpen: boolean;
  canExpand: boolean;
  onToggle: () => void;
}) {
  return (
    <>
      <tr className="border-t border-glass-edge">
        <td className="px-3 py-2 font-mono text-xs">{row.job}</td>
        <td className="px-3 py-2">
          <StatusPill status={row.status} />
        </td>
        <HelpTooltip content={row.lastSuccessAt ?? undefined}>
          <td className="px-3 py-2 text-ink-secondary">
            {formatRelative(row.lastSuccessAt)}
          </td>
        </HelpTooltip>
        <td className="px-3 py-2 text-ink-muted text-2xs">{JOB_SCHEDULE[row.job]}</td>
        <td className="px-3 py-2">
          {canExpand ? (
            <Button
              type="button"
              variant="link"
              size="sm"
              className="h-auto p-0 text-xs"
              aria-expanded={isOpen}
              aria-controls={`run-detail-${row.job}`}
              onClick={onToggle}
            >
              {isOpen ? 'הסתר' : 'הצג'}
            </Button>
          ) : (
            <span className="text-ink-muted text-xs">—</span>
          )}
        </td>
      </tr>
      {isOpen && canExpand && (
        <tr className="border-t border-glass-edge/40">
          <td colSpan={5} className="px-3 py-2">
            <RunDetail row={row} />
          </td>
        </tr>
      )}
    </>
  );
}

function RunDetail({ row }: { row: RunRow }) {
  // cron-tick → recent fan-out snapshots (numerics through <Money>); otherwise
  // the last-error JSON. Both in an LTR <pre>/container (JSON + Latin keys).
  if (row.ticks && row.ticks.length > 0) {
    return (
      <div id={`run-detail-${row.job}`} dir="ltr" className="overflow-x-auto">
        <TableBase className="text-2xs sm:text-xs">
          <thead className="text-ink-secondary">
            <tr>
              <th className="text-start py-1 pe-2">tick_id</th>
              <th className="text-end py-1 px-2">fan_out</th>
              <th className="text-end py-1 px-2">done</th>
              <th className="text-end py-1 px-2">skip</th>
              <th className="text-end py-1 px-2">fail</th>
            </tr>
          </thead>
          <tbody className="font-mono">
            {row.ticks.map((t) => (
              <tr key={t.tick_id} className="border-t border-glass-edge/40">
                <td className="py-1 pe-2 text-ink-secondary">{t.tick_id}</td>
                <td className="py-1 px-2 text-end">
                  <Money value={t.fan_out_count} prefix="none" decimals={0} />
                </td>
                <td className="py-1 px-2 text-end text-status-greenFg">
                  <Money value={t.events_completed_count} prefix="none" decimals={0} />
                </td>
                <td className="py-1 px-2 text-end text-status-orangeFg">
                  <Money value={t.events_skipped_count} prefix="none" decimals={0} />
                </td>
                <td className="py-1 px-2 text-end text-status-redFg">
                  <Money value={t.events_failed_count} prefix="none" decimals={0} />
                </td>
              </tr>
            ))}
          </tbody>
        </TableBase>
      </div>
    );
  }

  return (
    <pre
      id={`run-detail-${row.job}`}
      dir="ltr"
      className="text-xs bg-glass-2 text-ink-secondary p-3 rounded overflow-x-auto"
    >
      {JSON.stringify(
        { job: row.job, status: row.status, lastError: row.lastError, source: row.source },
        null,
        2,
      )}
    </pre>
  );
}
