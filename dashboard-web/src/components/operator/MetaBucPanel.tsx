// dashboard-web/src/components/operator/MetaBucPanel.tsx
//
// Phase A (Task 15) — server component that surfaces the meta_buc_usage
// table on /operator. Renders per-(store, ad_account_id) cards with 6
// progress bars each (3 metrics × 2 BUCs: ads_insights + ads_management).
//
// Design choices:
//  - Async server component — fetches at request time; no SWR needed.
//    meta_buc_usage changes at most every 10 min (cron cadence). Operator
//    refreshes the page when they want fresh data.
//  - Token substitutions (spec listed non-existent tokens):
//      bg-status-error    → bg-status-red
//      bg-status-warning  → bg-status-orange
//      bg-status-success  → bg-status-green
//      text-status-error  → text-status-red
//      border-ink-divider → border-line-subtle
//      bg-ink-bgSubtle    → bg-canvas
//  - All substitutions use tokens present in tailwind.config.ts and used
//    by the existing operator panels (TokenFailuresTable, JobsTable, etc.).

import { getSupabaseAdmin } from '@/lib/supabaseAdmin';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type BucRow = {
  store_id: string;
  ad_account_id: string;
  ads_insights_call_pct: number;
  ads_insights_cputime_pct: number;
  ads_insights_time_pct: number;
  ads_insights_eta_minutes: number;
  ads_management_call_pct: number;
  ads_management_cputime_pct: number;
  ads_management_time_pct: number;
  ads_management_eta_minutes: number;
  last_url: string | null;
  last_updated_at: string;
};

// ---------------------------------------------------------------------------
// Data fetching
// ---------------------------------------------------------------------------

async function fetchBucRows(): Promise<BucRow[]> {
  try {
    const sb = getSupabaseAdmin();
    const { data } = await sb
      .from('meta_buc_usage')
      .select('*')
      .order('store_id', { ascending: true })
      .order('ad_account_id', { ascending: true });
    return (data ?? []) as BucRow[];
  } catch (e) {
    console.warn('[MetaBucPanel] fetch failed:', e);
    return [];
  }
}

// ---------------------------------------------------------------------------
// Server component
// ---------------------------------------------------------------------------

export async function MetaBucPanel() {
  const rows = await fetchBucRows();
  if (!rows.length) {
    return (
      <p className="text-ink-secondary text-sm">
        אין נתוני BUC עדיין — נשמרים אחרי הסבב הראשון של cron-live-heavy.
      </p>
    );
  }
  return (
    <div className="space-y-4">
      {rows.map((r) => (
        <BucRowCard key={`${r.store_id}-${r.ad_account_id}`} row={r} />
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-components (pure — no server/client boundary needed)
// ---------------------------------------------------------------------------

function BucRowCard({ row }: { row: BucRow }) {
  const ageMinutes = Math.floor(
    (Date.now() - new Date(row.last_updated_at).getTime()) / 60_000,
  );
  return (
    <div className="border border-line-subtle rounded-md p-4">
      <div className="flex items-center justify-between mb-3">
        <div>
          <span className="font-semibold">{row.store_id}</span>
          <span className="text-ink-secondary text-xs mx-2">·</span>
          <span className="font-mono text-xs">act_{row.ad_account_id}</span>
        </div>
        <span className="text-ink-secondary text-xs">עודכן לפני {ageMinutes} דק׳</span>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <BucBlock
          title="ads_insights"
          call={row.ads_insights_call_pct}
          cputime={row.ads_insights_cputime_pct}
          time={row.ads_insights_time_pct}
          eta={row.ads_insights_eta_minutes}
        />
        <BucBlock
          title="ads_management"
          call={row.ads_management_call_pct}
          cputime={row.ads_management_cputime_pct}
          time={row.ads_management_time_pct}
          eta={row.ads_management_eta_minutes}
        />
      </div>
    </div>
  );
}

function BucBlock({
  title,
  call,
  cputime,
  time,
  eta,
}: {
  title: string;
  call: number;
  cputime: number;
  time: number;
  eta: number;
}) {
  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <span className="font-mono text-xs font-semibold">{title}</span>
        {eta > 0 && (
          <span className="text-xs text-status-red">ETA חזרה {eta} דק׳</span>
        )}
      </div>
      <ProgressBar label="call_count" pct={call} />
      <ProgressBar label="total_cputime" pct={cputime} />
      <ProgressBar label="total_time" pct={time} />
    </div>
  );
}

function ProgressBar({ label, pct }: { label: string; pct: number }) {
  // Color: ≥80 status-red (error), ≥60 status-orange (warning), else status-green.
  // Substitution: spec said status-error/warning/success; codebase uses red/orange/green.
  const colorClass =
    pct >= 80 ? 'bg-status-red' : pct >= 60 ? 'bg-status-orange' : 'bg-status-green';
  return (
    <div className="mb-1.5">
      <div className="flex items-center justify-between text-xs mb-0.5">
        <span className="text-ink-secondary font-mono">{label}</span>
        <span className="font-mono">{pct.toFixed(0)}%</span>
      </div>
      <div className="h-1.5 bg-canvas rounded overflow-hidden">
        <div className={`h-full ${colorClass}`} style={{ width: `${Math.min(100, pct)}%` }} />
      </div>
    </div>
  );
}
