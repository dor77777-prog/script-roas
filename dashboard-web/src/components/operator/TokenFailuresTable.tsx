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

const ENDPOINT = '/api/operator/token-failures';

const fetcher = async (url: string): Promise<TokenFailuresResponse> => {
  const r = await fetch(url);
  if (!r.ok) {
    return {
      rows: [],
      lastUpdated: new Date().toISOString(),
    };
  }
  return r.json();
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
  const { data, error, mutate } = useSWR<TokenFailuresResponse>(ENDPOINT, fetcher, {
    refreshInterval: 30_000,
    revalidateOnFocus: false,
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
      const r = await fetch(ENDPOINT, {
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
      <div className="text-sm text-amber-600 inline-flex items-center gap-1">
        <AlertCircle size={14} /> שגיאת רענון — ננסה שוב בעוד 30 שניות.
      </div>
    );
  }

  if (!data) {
    return <div className="text-sm text-text-muted">טוען...</div>;
  }

  if (rows.length === 0) {
    return (
      <div className="text-sm text-text-secondary inline-flex items-center gap-1.5">
        <CheckCircle2 size={14} className="text-roas-green" />
        אין כשלי טוקנים פתוחים. הכל ירוק.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {unresolved.length > 0 && (
        <div>
          <div className="text-xs text-text-muted mb-2">
            כשלים פתוחים: <span className="font-semibold text-roas-red">{unresolved.length}</span>
          </div>
          <div className="border border-roas-red/30 rounded-lg overflow-hidden">
            <table className="w-full text-xs sm:text-sm">
              <thead className="bg-roas-redBg/40 text-text-secondary">
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
            </table>
          </div>
        </div>
      )}

      {resolved.length > 0 && (
        <details>
          <summary className="text-xs text-text-muted cursor-pointer hover:text-text-secondary">
            תוקנו לאחרונה ({resolved.length})
          </summary>
          <div className="mt-2 border border-borderSubtle rounded-lg overflow-hidden">
            <table className="w-full text-xs">
              <tbody>
                {resolved.map((row) => (
                  <tr
                    key={`${row.provider}::${row.storeId}::${row.operation}`}
                    className="border-b border-borderSubtle last:border-0 text-text-muted"
                  >
                    <td className="px-3 py-1.5 inline-flex items-center gap-1">
                      <CheckCircle2 size={12} className="text-roas-green" />
                      {PROVIDER_LABEL[row.provider] ?? row.provider}
                    </td>
                    <td className="px-3 py-1.5">
                      {STORE_LABEL[row.storeId] ?? row.storeId}
                    </td>
                    <td className="px-3 py-1.5 font-mono text-[10px]">{row.operation}</td>
                    <td className="px-3 py-1.5" title={row.resolvedAt ?? ''}>
                      תוקן {formatRelative(row.resolvedAt ?? row.lastSeenAt)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      )}

      <div className="text-[10px] text-text-muted">
        רענון אוטומטי כל 30 שניות. עדכון אחרון: {formatRelative(data.lastUpdated)}
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
        className="border-b border-roas-red/15 last:border-0 cursor-pointer hover:bg-roas-redBg/20"
        onClick={onToggleExpand}
      >
        <td className="px-3 py-2 font-semibold inline-flex items-center gap-1.5">
          <XCircle size={13} className="text-roas-red shrink-0" />
          {PROVIDER_LABEL[row.provider] ?? row.provider}
        </td>
        <td className="px-3 py-2">{STORE_LABEL[row.storeId] ?? row.storeId}</td>
        <td className="px-3 py-2 font-mono text-[11px]">{row.operation}</td>
        <td className="px-3 py-2 text-text-secondary" title={row.lastSeenAt}>
          {formatRelative(row.lastSeenAt)}
        </td>
        <td className="px-3 py-2 text-end tabular-nums">{row.seenCount}</td>
        <td className="px-3 py-2 text-end tabular-nums">{row.alertsSentCount}</td>
        <td className="px-3 py-2 text-end">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onResolve();
            }}
            disabled={isResolving}
            className="inline-flex items-center gap-1 px-2 py-1 text-[11px] rounded bg-roas-green/15 text-roas-green hover:bg-roas-green/25 disabled:opacity-50"
          >
            <CheckCircle2 size={12} />
            {isResolving ? 'מסמן...' : 'סמן כתוקן'}
          </button>
        </td>
      </tr>
      {expanded && (
        <tr className="border-b border-roas-red/15 last:border-0 bg-roas-redBg/10">
          <td colSpan={7} className="px-4 py-3 text-[11px]">
            <div className="space-y-2">
              <div>
                <div className="text-text-muted text-[10px] uppercase tracking-wider mb-1">
                  שגיאה
                </div>
                <pre
                  dir="ltr"
                  className="font-mono text-[11px] bg-roas-redBg/30 border border-roas-red/20 rounded px-2 py-1.5 whitespace-pre-wrap break-all"
                >
                  {row.lastErrorMsg}
                </pre>
              </div>
              {row.lastAdvice && (
                <div>
                  <div className="text-text-muted text-[10px] uppercase tracking-wider mb-1">
                    תיקון מוצע
                  </div>
                  <div className="text-text-primary">{row.lastAdvice}</div>
                </div>
              )}
              <div className="text-[10px] text-text-muted">
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
