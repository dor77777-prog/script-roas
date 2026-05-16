'use client';

import { useEffect, useState } from 'react';
import { Cloud, CloudOff, RefreshCw, AlertTriangle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { getSyncState, hydrateFromCloud, type SyncState } from '@/lib/cloudSync';

/**
 * Header pill showing the current cloud-sync status. Clicking the pill (in
 * error state) opens a small popover with the actual error message — critical
 * for diagnosing "I entered data on device A but device B is empty".
 */
export function SyncIndicator() {
  const [state, setState] = useState<SyncState>(() => getSyncState());
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    const sync = () => setState(getSyncState());
    window.addEventListener('roas-cloud-sync-state', sync);
    return () => window.removeEventListener('roas-cloud-sync-state', sync);
  }, []);

  const { status, lastError, pendingKeys, lastSyncAt } = state;

  let icon = <Cloud size={13} />;
  let label = 'sync';
  let tone = 'bg-white/12 text-white/85 hover:bg-white/20';
  let title = '';

  if (status === 'syncing') {
    icon = <RefreshCw size={13} className="animate-spin" />;
    label = pendingKeys > 0 ? `שומר ${pendingKeys}…` : 'שומר…';
    tone = 'bg-white/15 text-white';
    title = 'שולח את השינויים שלך לענן';
  } else if (status === 'error') {
    icon = <CloudOff size={13} />;
    label = 'sync שגיאה';
    tone = 'bg-red-500/85 text-white hover:bg-red-500';
    title = 'לחץ לפרטים';
  } else if (status === 'ok') {
    icon = <Cloud size={13} />;
    label = 'sync OK';
    tone = 'bg-emerald-500/30 text-white hover:bg-emerald-500/40';
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
    } else {
      // Manual re-sync.
      void hydrateFromCloud();
    }
  }

  return (
    <div className="relative">
      <button
        onClick={onClick}
        title={title}
        className={cn(
          'inline-flex items-center gap-1.5 rounded-lg px-2 sm:px-2.5 py-1.5 text-[11px] sm:text-xs font-medium transition-colors ring-1 ring-white/10',
          tone,
        )}
      >
        {icon}
        <span className="hidden sm:inline">{label}</span>
      </button>
      {expanded && status === 'error' && (
        <div
          dir="rtl"
          className="absolute top-full end-0 mt-1 w-80 rounded-lg bg-surface text-text-primary shadow-elevated border border-borderSubtle p-3 z-50"
        >
          <div className="flex items-start gap-2">
            <span className="inline-flex w-7 h-7 rounded-md bg-roas-redBg text-roas-red items-center justify-center shrink-0">
              <AlertTriangle size={14} />
            </span>
            <div className="min-w-0 flex-1">
              <div className="text-xs font-semibold mb-1">סנכרון לענן נכשל</div>
              <div className="text-[11px] text-text-secondary leading-relaxed break-words font-mono">
                {lastError ?? 'שגיאה לא ידועה'}
              </div>
              <div className="mt-2 text-[11px] text-text-muted leading-relaxed">
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
              <button
                onClick={() => {
                  setExpanded(false);
                  void hydrateFromCloud();
                }}
                className="mt-2 text-[11px] font-semibold text-primary hover:text-primary-dark"
              >
                נסה שוב
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
