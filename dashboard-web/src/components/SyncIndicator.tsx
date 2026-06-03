'use client';

import { useEffect, useState } from 'react';
import useSWR from 'swr';
import { Cloud, CloudOff, RefreshCw, AlertTriangle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { getSyncState, hydrateFromCloud, type SyncState } from '@/lib/cloudSync';
import type { HealthResponse } from '@/app/api/health/route';
import { Button } from '@/components/ui/Button';
import { HelpTooltip } from '@/components/ui/Tooltip';
import { fetchJsonOrNull } from '@/lib/fetchJson';

/**
 * Header pill showing the current cloud-sync status. Clicking the pill (in
 * error state) opens a small popover with the actual error message — critical
 * for diagnosing "I entered data on device A but device B is empty".
 *
 * Phase 05.5 D-D1: ternary state machine:
 *   🟢 green  = sheets + supabase both reachable (happy path)
 *   🟡 amber  = sheets ok, supabase down (new — Phase 05.5)
 *   🔴 red    = sheets unreachable (existing error behavior, unchanged)
 *
 * Implementation: Option A from RESEARCH.md §Pattern 6 — parallel useSWR on
 * /api/health, combined with the existing cloudSync.getSyncState() status.
 * Option B (extend SyncState in cloudSync.ts) deferred to Phase 05.6 when
 * Supabase enters the read path.
 */

export function SyncIndicator() {
  const [state, setState] = useState<SyncState>(() => getSyncState());
  const [expanded, setExpanded] = useState(false);
  // Bump tick every 30s so the "synced N seconds ago" tooltip text doesn't
  // freeze between sync events (which can be minutes apart while idle).
  const [, setTick] = useState(0);

  // D-D2: poll /api/health every 30s — same cadence as the existing 30s
  // tickInterval below. Returns null on non-2xx per the fetchJsonOrNull contract.
  const { data: health } = useSWR<HealthResponse | null>(
    '/api/health',
    fetchJsonOrNull,
    {
      refreshInterval: 30_000,
      revalidateOnFocus: true,
    },
  );

  useEffect(() => {
    const sync = () => setState(getSyncState());
    window.addEventListener('roas-cloud-sync-state', sync);
    const tickInterval = setInterval(() => setTick(t => t + 1), 30_000);
    return () => {
      window.removeEventListener('roas-cloud-sync-state', sync);
      clearInterval(tickInterval);
    };
  }, []);

  const { status, lastError, pendingKeys, lastSyncAt } = state;

  // D-D1 ternary tone resolution. Priority:
  //   1. Sheets-write error (cloudSync POST failure) → RED — same as before
  //   2. Supabase ping fails (from health) → AMBER — new in 05.5
  //   3. Both fine → GREEN
  // The 'syncing' state keeps its existing in-flight visual (neutral glass)
  // because it's a transient state ORTHOGONAL to the health check.
  //
  // REVIEW.md WR-01 fix: supabase-down evaluation is HOISTED ABOVE the status
  // branches so a healthy cloudSync 'idle'/initial-load state can still
  // surface amber the moment /api/health reports `supabase: 'down'`. Before
  // this fix, the 'ok'-gated branch swallowed the warning during the first
  // SWR cycle and on every page load (status starts 'idle' until the first
  // hydrate completes).
  let icon = <Cloud size={13} />;
  let label = 'sync';
  let tone = 'bg-glass-2 text-ink-secondary hover:bg-glass-3';
  let title = '';

  const supabaseDown = health?.supabase === 'down';

  if (status === 'syncing') {
    icon = <RefreshCw size={13} className="animate-spin" />;
    label = pendingKeys > 0 ? `שומר ${pendingKeys}…` : 'שומר…';
    tone = 'bg-glass-2 text-ink';
    title = 'שולח את השינויים שלך לענן';
  } else if (status === 'error') {
    icon = <CloudOff size={13} />;
    label = 'sync שגיאה';
    tone = 'bg-status-redBtn text-accent-fg hover:bg-[color-mix(in_oklab,var(--status-red-btn)_88%,black)]';
    title = 'לחץ לפרטים';
  } else if (supabaseDown) {
    // D-D1 yellow — Sheets OK (or hasn't synced yet), Supabase unreachable.
    // Fires regardless of cloudSync status (idle / ok / first-paint) so the
    // operator gets the documented amber signal as soon as health reports.
    icon = <Cloud size={13} />;
    label = 'sync OK';
    tone = 'bg-status-warningBg text-status-warningFg hover:bg-status-warning';
    title = 'Sheets תקין, Supabase לא זמין — בדוק SUPABASE_URL / SUPABASE_ANON_KEY ב-Vercel';
  } else if (status === 'ok') {
    icon = <Cloud size={13} />;
    label = 'sync OK';
    tone = 'bg-status-greenBg text-status-greenFg hover:bg-status-green';
    if (lastSyncAt) {
      const secs = Math.round((Date.now() - lastSyncAt) / 1000);
      title = secs < 60 ? `סונכרן לפני ${secs}ש` : `סונכרן לפני ${Math.round(secs / 60)}ד`;
    }
  } else {
    title = 'ממתין לסנכרון ראשוני';
  }

  function onClick() {
    if (status === 'error') {
      setExpanded(v => !v);
      return;
    }
    // Block manual re-sync while a sync is already in flight. Without this
    // guard, clicks during a syncing state can stack additional hydrate
    // calls, each of which may re-fire migration POSTs for empty cloud keys
    // (cloudSync.hydrateFromCloud first-time-migration path). The user
    // clicking the pill repeatedly multiplied the POST rate per click — a
    // real rate-limit hazard on first deployment with several empty keys.
    if (status === 'syncing' || pendingKeys > 0) return;
    void hydrateFromCloud();
  }

  return (
    <div className="relative">
      <HelpTooltip content={title}>
        <Button
          variant="ghost"
          onClick={onClick}
          className={cn(
            'gap-1.5 rounded-lg px-2 sm:px-2.5 py-1.5 h-auto text-[11px] sm:text-xs font-medium ring-1 ring-glass-edge',
            tone,
          )}
        >
          {icon}
          {/* a11y: announce sync-state transitions (syncing → ok → error /
              supabase-down) to screen readers. `polite` (not `assertive`)
              because status changes are informational, not urgent enough to
              interrupt other speech. `aria-atomic` ensures the full new label
              is read rather than just the diff. */}
          <span
            aria-live="polite"
            aria-atomic="true"
            className="hidden sm:inline"
          >
            {label}
          </span>
        </Button>
      </HelpTooltip>
      {expanded && status === 'error' && (
        <div
          dir="rtl"
          className="absolute top-full end-0 mt-1 w-80 max-w-[min(90vw,320px)] rounded-lg bg-glass-1 text-ink shadow-overlay border border-glass-edge p-3 z-50"
        >
          <div className="flex items-start gap-2">
            <span className="inline-flex w-7 h-7 rounded-md bg-status-redBg text-status-redFg items-center justify-center shrink-0">
              <AlertTriangle size={14} />
            </span>
            <div className="min-w-0 flex-1">
              <div className="text-xs font-semibold mb-1">סנכרון לענן נכשל</div>
              <div className="text-[11px] text-ink-secondary leading-relaxed break-words font-mono">
                {lastError ?? 'שגיאה לא ידועה'}
              </div>
              <div className="mt-2 text-[11px] text-ink-muted leading-relaxed">
                בדיקות מהירות:
                <ul className="list-disc list-inside mt-1 space-y-0.5">
                  <li>
                    האם ה-Service Account של הדשבורד משותף ל-Google Sheet
                    כ-<strong>Editor</strong> (לא Viewer)?
                  </li>
                  <li>האם משתני הסביבה <code>GOOGLE_CLIENT_EMAIL</code> /{' '}
                  <code>GOOGLE_PRIVATE_KEY</code> תקפים?</li>
                </ul>
              </div>
              <Button
                variant="link"
                onClick={() => {
                  setExpanded(false);
                  void hydrateFromCloud();
                }}
                className="mt-2 h-auto p-0 text-[11px] font-semibold text-accent"
              >
                נסה שוב
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
