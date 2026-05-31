'use client';

// dashboard-web/src/components/operator/FreshnessPanel.tsx
//
// Phase A (Task 15) — surfaces the data_freshness table on /operator. Renders
// the (store, platform, scope, table_name) matrix sorted by lag_minutes DESC
// NULLS LAST.
//
// Task 5.2 (UI/UX overhaul, 2026-05-30): converted from an async server
// component to a client component with 15 s SWR polling so all 4 operator
// sub-tabs share a single refresh paradigm. The header <Refresh> button
// piggybacks on the same SWR cache via useSWRConfig().mutate().
//
// Design choices:
//  - Uses /api/operator/freshness (HTTP shim around getFreshness() helper).
//  - 15 000 ms refresh interval — matches JobsTable + TokenFailuresTable +
//    every other panel after Task 5.2's unification.
//  - revalidateOnFocus = true: returning to the tab refreshes immediately
//    rather than waiting for the next 15 s tick.

import useSWR from 'swr';
import { CheckCircle2, AlertCircle, XCircle } from 'lucide-react';
import { operatorFetch } from '@/lib/operatorClient';
import { type FreshnessRow } from '@/lib/inngest/freshness';
import { TableBase } from '@/components/ui/TableBase';
import { HelpTooltip } from '@/components/ui/Tooltip';
import type { FreshnessResponse } from '@/app/api/operator/freshness/route';

const ENDPOINT = '/api/operator/freshness';

async function fetcher(url: string): Promise<FreshnessResponse> {
  const res = await operatorFetch(url);
  return (await res.json()) as FreshnessResponse;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** "12 דק׳ לפני" / "3 שעות לפני" — short relative Hebrew. */
function formatRelative(iso: string | null): string {
  if (!iso) return '—';
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return iso;
  const dMs = Date.now() - t;
  const dMin = Math.floor(dMs / 60_000);
  if (dMin < 1) return 'כרגע';
  if (dMin < 60) return `${dMin} דק׳ לפני`;
  const dHr = Math.floor(dMin / 60);
  if (dHr < 24) return `${dHr} שע׳ לפני`;
  const dDay = Math.floor(dHr / 24);
  return `${dDay} ימים לפני`;
}

// ---------------------------------------------------------------------------
// Status rendering helpers
// ---------------------------------------------------------------------------

type StatusIconProps = { status: string };

function StatusIcon({ status }: StatusIconProps) {
  if (status === 'success') {
    return <CheckCircle2 size={14} className="text-status-green shrink-0" />;
  }
  if (status === 'budget_skip') {
    return <AlertCircle size={14} className="text-status-orange shrink-0" />;
  }
  // transient_error | auth_error | parse_error → red XCircle
  return <XCircle size={14} className="text-status-red shrink-0" />;
}

function statusLabel(status: string): string {
  switch (status) {
    case 'success': return 'success';
    case 'budget_skip': return 'budget_skip';
    case 'transient_error': return 'transient_error';
    case 'auth_error': return 'auth_error';
    case 'parse_error': return 'parse_error';
    default: return status;
  }
}

function statusTextClass(status: string): string {
  if (status === 'success') return 'text-status-green';
  if (status === 'budget_skip') return 'text-status-orange';
  return 'text-status-red';
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function FreshnessPanel() {
  const { data, isLoading } = useSWR<FreshnessResponse>(ENDPOINT, fetcher, {
    refreshInterval: 15_000,
    revalidateOnFocus: true,
  });

  if (isLoading && !data) {
    return <p className="text-ink-secondary text-sm">טוען טריות נתונים…</p>;
  }

  const rows = data?.rows ?? [];

  if (!rows.length) {
    return (
      <p className="text-ink-secondary text-sm">
        אין רשומות freshness עדיין. ב-Phase A הטבלה מתעדת רק אירועי budget_skip ושגיאות; ה-happy path ייכתב כשcron-tick-orchestrator יעלה ב-Phase B.
      </p>
    );
  }

  return (
    <div className="overflow-x-auto">
      <TableBase className="text-xs sm:text-sm">
        <thead className="text-ink-secondary text-xs uppercase tracking-wider bg-glass-3">
          <tr>
            <th className="px-3 py-2 text-start font-medium">חנות</th>
            <th className="px-3 py-2 text-start font-medium">פלטפורמה</th>
            <th className="px-3 py-2 text-start font-medium">Scope</th>
            <th className="px-3 py-2 text-start font-medium">טבלה</th>
            <th className="px-3 py-2 text-start font-medium">סטטוס</th>
            <th className="px-3 py-2 text-end font-medium">Lag (דק׳)</th>
            <th className="px-3 py-2 text-start font-medium">ניסיון אחרון</th>
            <th className="px-3 py-2 text-start font-medium">הצלחה אחרונה</th>
            <th className="px-3 py-2 text-start font-medium">הערות</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <FreshnessTableRow key={rowKey(row)} row={row} />
          ))}
        </tbody>
      </TableBase>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Row sub-component
// ---------------------------------------------------------------------------

function rowKey(row: FreshnessRow): string {
  return `${row.store_id}::${row.platform}::${row.scope}::${row.table_name}`;
}

function FreshnessTableRow({ row }: { row: FreshnessRow }) {
  const notes = row.budget_skip && row.error_code
    ? row.error_code
    : row.error_message
      ? row.error_message.slice(0, 60)
      : '—';

  return (
    <tr className="border-t border-glass-edge">
      <td className="px-3 py-2 font-semibold">{row.store_id}</td>
      <td className="px-3 py-2 font-mono text-xs">{row.platform}</td>
      <td className="px-3 py-2 font-mono text-xs">{row.scope}</td>
      <td className="px-3 py-2 font-mono text-xs">{row.table_name}</td>
      <td className="px-3 py-2">
        <span
          className={`inline-flex items-center gap-1 ${statusTextClass(row.status)}`}
        >
          <StatusIcon status={row.status} />
          <span className="font-mono">{statusLabel(row.status)}</span>
          {row.budget_skip && row.status !== 'budget_skip' && (
            <span className="ms-1 inline-flex items-center gap-0.5 text-status-orange">
              <AlertCircle size={11} />
              <span className="text-2xs">budget_skip</span>
            </span>
          )}
        </span>
      </td>
      <td className="px-3 py-2 text-end tabular-nums">
        {row.lag_minutes !== null ? row.lag_minutes : '—'}
      </td>
      <HelpTooltip content={row.last_attempt_at}>
        <td className="px-3 py-2 text-ink-secondary">
          {formatRelative(row.last_attempt_at)}
        </td>
      </HelpTooltip>
      <HelpTooltip content={row.last_success_at ?? undefined}>
        <td className="px-3 py-2 text-ink-secondary">
          {formatRelative(row.last_success_at)}
        </td>
      </HelpTooltip>
      <td className="px-3 py-2 text-ink-muted font-mono text-2xs max-w-xs truncate">
        {notes}
      </td>
    </tr>
  );
}
