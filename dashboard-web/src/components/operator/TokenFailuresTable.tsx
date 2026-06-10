'use client';

// dashboard-web/src/components/operator/TokenFailuresTable.tsx
//
// Phase 05.7.x (2026-05-23) — operator-console feed of upstream
// token/auth failures (Google / Meta / TikTok / WhatsApp / Shopify / FX).
// Polls /api/operator/token-failures every 30s via SWR. Two operator
// actions per row:
//   - Expand row to read full error + advice
//   - "סמן כתוקן" button → POSTs `{action:'resolve'}` to the same
//     endpoint, then mutates the SWR cache so the row hides
//     immediately.
//
// SECURITY: never imports supabaseAdmin or any env var. Reads only the
// JSON response from /api/operator/token-failures (server-side route
// owns the SUPABASE_SERVICE_ROLE_KEY).

import useSWR from 'swr';
import { useState } from 'react';
import { CheckCircle2, AlertCircle, XCircle } from 'lucide-react';
import type {
  TokenFailuresResponse,
  TokenFailureRow,
} from '@/app/api/operator/token-failures/route';
import { operatorFetch } from '@/lib/operatorClient';
import { Button } from '@/components/ui/Button';
import { TableBase } from '@/components/ui/TableBase';
import { HelpTooltip } from '@/components/ui/Tooltip';

const ENDPOINT = '/api/operator/token-failures';

// P1-8 (data-consistency audit 2026-05-27): fetcher now throws on any error
// response so SWR places the component into the `error` branch (amber alert),
// instead of returning {rows:[]} which made the UI show "הכל ירוק" even when
// the endpoint was returning HTTP 500 or a 200+{error} Supabase failure.
//
// Two cases that were previously false-green:
//   1. !r.ok (HTTP 4xx/5xx) → now throws; SWR error → amber "שגיאת רענון"
//   2. r.ok + data.error (200 + Supabase error) → now throws; same branch
//
// The legitimate "zero failures" case is HTTP 200 + {rows:[], no error field}.
const fetcher = async (url: string): Promise<TokenFailuresResponse> => {
  const r = await operatorFetch(url, { cache: 'no-store' });
  if (!r.ok) {
    const body = await r.json().catch(() => ({})) as Record<string, unknown>;
    throw new Error(String(body?.error ?? `HTTP ${r.status}`));
  }
  const data = (await r.json()) as TokenFailuresResponse & { error?: string };
  if (data.error) {
    // Server-side Supabase error — surface as an error state, not as
    // "zero failures". The operator needs to know the panel couldn't load.
    throw new Error(data.error);
  }
  return data;
};

/** "12 דק׳ לפני" / "3 שעות לפני" — short relative Hebrew. */
function formatRelative(iso: string): string {
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

const PROVIDER_LABEL: Record<string, string> = {
  meta: 'Meta',
  google: 'Google',
  tiktok: 'TikTok',
  whatsapp: 'WhatsApp',
  shopify: 'Shopify',
  fx: 'FX',
};

const STORE_LABEL: Record<string, string> = {
  uzoshop: 'uzoshop',
  zolplus: 'Zol Plus',
  usmile360: '360usmile',
  global: '(global)',
};

export function TokenFailuresTable() {
  // Task 5.2 (UI/UX overhaul) — 15 s cadence + revalidateOnFocus:true to
  // match the rest of /operator after the refresh-paradigm unification.
  // Was: 30 000 ms / revalidateOnFocus:false.
  const { data, error, mutate } = useSWR<TokenFailuresResponse>(ENDPOINT, fetcher, {
    refreshInterval: 15_000,
    revalidateOnFocus: true,
  });
  const [expanded, setExpanded] = useState<string | null>(null);
  const [resolving, setResolving] = useState<string | null>(null);

  const rows = data?.rows ?? [];
  const unresolved = rows.filter((r) => !r.resolvedAt);
  const resolved = rows.filter((r) => r.resolvedAt);

  async function handleResolve(row: TokenFailureRow) {
    const key = `${row.provider}::${row.storeId}::${row.operation}`;
    setResolving(key);
    try {
      const r = await operatorFetch(ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'resolve',
          provider: row.provider,
          store_id: row.storeId,
          operation: row.operation,
        }),
      });
      if (!r.ok) {
        const body = await r.text().catch(() => '');
        alert(`שגיאת סימון: ${body.slice(0, 200)}`);
        return;
      }
      // Optimistically mutate so the row hides without waiting for the
      // 30s SWR refresh.
      mutate();
    } finally {
      setResolving(null);
    }
  }

  if (error) {
    return (
      <div className="text-sm text-status-orangeFg inline-flex items-center gap-1">
        {/* Copy-truth: SWR refreshInterval above is 15s (was 30s pre-Task-5.2). */}
        <AlertCircle size={14} /> שגיאת רענון — ננסה שוב בעוד 15 שניות.
      </div>
    );
  }

  if (!data) {
    return <div className="text-sm text-ink-muted">טוען...</div>;
  }

  if (rows.length === 0) {
    return (
      <div className="text-sm text-ink-secondary inline-flex items-center gap-1.5">
        <CheckCircle2 size={14} className="text-status-greenFg" />
        אין כשלי טוקנים פתוחים. הכל ירוק.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {unresolved.length > 0 && (
        <div>
          <div className="text-xs text-ink-muted mb-2">
            כשלים פתוחים: <span className="font-semibold text-status-redFg">{unresolved.length}</span>
          </div>
          {/* Horizontal scroll (2026-06-10 audit): 7 columns inside
              overflow-hidden clipped the "סמן כתוקן" action off-screen on the
              phone — exactly the alert-triage flow. Same overflow-x-auto +
              minWidth pattern as the other tables (CohortComparisonPanel /
              ProductsTable). */}
          <div className="border border-status-red rounded-lg overflow-x-auto">
            <TableBase className="text-xs sm:text-sm" minWidth={640}>
              <thead className="bg-status-redBg text-ink-secondary">
                <tr>
                  <th className="px-3 py-2 text-start font-medium">פלטפורמה</th>
                  <th className="px-3 py-2 text-start font-medium">חנות</th>
                  <th className="px-3 py-2 text-start font-medium">פעולה</th>
                  <th className="px-3 py-2 text-start font-medium">נראה לאחרונה</th>
                  <th className="px-3 py-2 text-end font-medium">מספר</th>
                  <th className="px-3 py-2 text-end font-medium">התראות</th>
                  <th className="px-3 py-2 text-end font-medium">פעולה</th>
                </tr>
              </thead>
              <tbody>
                {unresolved.map((row) => {
                  const key = `${row.provider}::${row.storeId}::${row.operation}`;
                  const isExpanded = expanded === key;
                  return (
                    <FailureRowFragment
                      key={key}
                      row={row}
                      expanded={isExpanded}
                      onToggleExpand={() => setExpanded(isExpanded ? null : key)}
                      onResolve={() => handleResolve(row)}
                      isResolving={resolving === key}
                    />
                  );
                })}
              </tbody>
            </TableBase>
          </div>
        </div>
      )}

      {resolved.length > 0 && (
        <details>
          <summary className="text-xs text-ink-muted cursor-pointer hover:text-ink-secondary">
            תוקנו לאחרונה ({resolved.length})
          </summary>
          <div className="mt-2 border border-glass-edge rounded-lg overflow-x-auto">
            <TableBase className="text-xs" minWidth={480}>
              <tbody>
                {resolved.map((row) => (
                  <tr
                    key={`${row.provider}::${row.storeId}::${row.operation}`}
                    className="border-b border-glass-edge last:border-0 text-ink-muted"
                  >
                    <td className="px-3 py-1.5 inline-flex items-center gap-1">
                      <CheckCircle2 size={12} className="text-status-greenFg" />
                      {PROVIDER_LABEL[row.provider] ?? row.provider}
                    </td>
                    <td className="px-3 py-1.5">
                      {STORE_LABEL[row.storeId] ?? row.storeId}
                    </td>
                    <td className="px-3 py-1.5 font-mono text-2xs">{row.operation}</td>
                    <HelpTooltip content={row.resolvedAt ?? ''}>
                      <td className="px-3 py-1.5">
                        תוקן {formatRelative(row.resolvedAt ?? row.lastSeenAt)}
                      </td>
                    </HelpTooltip>
                  </tr>
                ))}
              </tbody>
            </TableBase>
          </div>
        </details>
      )}

      <div className="text-2xs text-ink-muted">
        רענון אוטומטי כל 15 שניות. עדכון אחרון: {formatRelative(data.lastUpdated)}
      </div>
    </div>
  );
}

type FragmentProps = {
  row: TokenFailureRow;
  expanded: boolean;
  onToggleExpand: () => void;
  onResolve: () => void;
  isResolving: boolean;
};

function FailureRowFragment({
  row,
  expanded,
  onToggleExpand,
  onResolve,
  isResolving,
}: FragmentProps) {
  return (
    <>
      <tr
        className="border-b border-status-red last:border-0 cursor-pointer hover:bg-status-redBg"
        onClick={onToggleExpand}
      >
        <td className="px-3 py-2 font-semibold inline-flex items-center gap-1.5">
          <XCircle size={13} className="text-status-redFg shrink-0" />
          {PROVIDER_LABEL[row.provider] ?? row.provider}
        </td>
        <td className="px-3 py-2">{STORE_LABEL[row.storeId] ?? row.storeId}</td>
        <td className="px-3 py-2 font-mono text-2xs">{row.operation}</td>
        <HelpTooltip content={row.lastSeenAt}>
          <td className="px-3 py-2 text-ink-secondary">
            {formatRelative(row.lastSeenAt)}
          </td>
        </HelpTooltip>
        <td className="px-3 py-2 text-end tabular-nums">{row.seenCount}</td>
        <td className="px-3 py-2 text-end tabular-nums">{row.alertsSentCount}</td>
        <td className="px-3 py-2 text-end">
          <Button
            type="button"
            variant="ghost"
            onClick={(e) => {
              e.stopPropagation();
              onResolve();
            }}
            disabled={isResolving}
            className="gap-1 px-2 py-1 h-auto text-2xs bg-status-greenBg text-status-greenFg hover:opacity-80"
          >
            <CheckCircle2 size={12} />
            {isResolving ? 'מסמן...' : 'סמן כתוקן'}
          </Button>
        </td>
      </tr>
      {expanded && (
        <tr className="border-b border-status-red last:border-0 bg-status-redBg">
          <td colSpan={7} className="px-4 py-3 text-2xs">
            <div className="space-y-2">
              <div>
                <div className="text-ink-muted text-2xs uppercase tracking-wider mb-1">
                  שגיאה
                </div>
                <pre
                  dir="ltr"
                  className="font-mono text-2xs bg-status-redBg border border-status-red rounded px-2 py-1.5 whitespace-pre-wrap break-all"
                >
                  {row.lastErrorMsg}
                </pre>
              </div>
              {row.lastAdvice && (
                <div>
                  <div className="text-ink-muted text-2xs uppercase tracking-wider mb-1">
                    תיקון מוצע
                  </div>
                  <div className="text-ink">{row.lastAdvice}</div>
                </div>
              )}
              <div className="text-2xs text-ink-muted">
                ראשון נראה: {formatRelative(row.firstSeenAt)} ·
                התראה אחרונה ב-WhatsApp:{' '}
                {row.lastAlertSentAt ? formatRelative(row.lastAlertSentAt) : 'עדיין לא נשלחה'}
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}
