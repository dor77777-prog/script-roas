'use client';

import { useEffect, useState } from 'react';
import { AlertCircle } from 'lucide-react';

/**
 * Phase 05.7.6 — Freshness chip for the dashboard header. Shows the user
 * when data was last written to Postgres by a cron (NOT when the API
 * responded — see `DashboardData.dataLastWriteAt` vs `lastUpdated` in
 * `lib/types.ts`).
 *
 * Color coding tracks cron health:
 *   - green:  <20 min     → cron-live healthy (runs every 10-15 min)
 *   - yellow: 20-60 min   → possible delay (1-2 missed cron runs)
 *   - red:    >60 min     → cron likely stuck → action needed
 *
 * Re-ticks every 30 seconds so "לפני 3 דק׳" auto-advances to "לפני 4 דק׳"
 * without the user refreshing. The interval is bound to the component
 * lifecycle (unmounts when the dashboard unmounts).
 *
 * The refresh button lives in the header's existing "רענן" control — this
 * component is presentation-only (no onClick / no SWR mutate). Keeps the
 * header layout responsive (the chip is hidden on small screens; the
 * refresh button stays visible).
 */
export function FreshnessChip(props: {
  dataLastWriteAt: string | null;
  /**
   * 'dark' = soft-on-dark palette for the navy header (default).
   * 'light' = readable-on-white palette for use inside tab bodies.
   * Phase 05.7.6 follow-up — user reported the chip text was invisible
   * on white tab bodies because the original palette uses light pastels
   * on transparent backgrounds, designed for the dark header.
   */
  variant?: 'dark' | 'light';
}) {
  const { dataLastWriteAt, variant = 'dark' } = props;
  // Re-render every 30s so "X minutes ago" updates without a server hit.
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 30_000);
    return () => clearInterval(id);
  }, []);
  void tick;

  const { label, tone, warning } = formatTimeAgo(dataLastWriteAt);

  // Two palettes:
  //   - dark (header, navy bg): light tones, transparent bg
  //   - light (tab body, white bg): SOLID light bg + dark text — same
  //     contrast level as the existing 'סביר' / 'מעולה' pills on the
  //     leaderboard cards (matched to user's visual expectation).
  const darkPalette = {
    green: 'bg-emerald-500/15 text-emerald-200 ring-emerald-400/30',
    yellow: 'bg-amber-500/20 text-amber-100 ring-amber-300/40',
    red: 'bg-red-500/25 text-red-100 ring-red-300/50',
    gray: 'bg-white/10 text-white/80 ring-white/15',
  } as const;
  const lightPalette = {
    green: 'bg-status-greenBg text-status-greenFg ring-status-green/30',
    yellow: 'bg-status-orangeBg text-status-orangeFg ring-status-orange/30',
    red: 'bg-status-redBg text-status-redFg ring-status-red/30',
    gray: 'bg-elevated2 text-ink-secondary ring-line',
  } as const;
  const toneClass = (variant === 'light' ? lightPalette : darkPalette)[tone];

  return (
    <span
      className={`inline-flex items-center gap-1 px-2 py-1 rounded-md ring-1 text-[11px] sm:text-xs tabular-nums ${toneClass}`}
      title={
        dataLastWriteAt
          ? `נכתב ע"י cron ב-${new Date(dataLastWriteAt).toLocaleString('he-IL', { timeZone: 'Asia/Jerusalem' })}`
          : 'אין נתוני freshness (אין שורות בטווח התאריכים)'
      }
    >
      {warning && <AlertCircle size={11} className="shrink-0" />}
      <span>{label}</span>
    </span>
  );
}

type Tone = 'green' | 'yellow' | 'red' | 'gray';

/**
 * Pure formatter for "X minutes ago" → Hebrew chip text + color tone.
 * Exported for unit testing. Bands:
 *   - <60s     → "עודכן עכשיו" / green
 *   - <20 min  → "עודכן לפני X דק׳" / green (cron-live cadence is 10-15 min)
 *   - <60 min  → "עודכן לפני X דק׳" / yellow (1-2 missed runs)
 *   - <24 h    → "עודכן לפני X שעות" / red (cron stuck)
 *   - else     → absolute timestamp DD/MM HH:MM / red
 *   - null     → "אין נתונים" / gray
 */
export function formatTimeAgo(
  iso: string | null,
  now: Date = new Date(),
): { label: string; tone: Tone; warning: boolean } {
  if (!iso) return { label: 'אין נתונים', tone: 'gray', warning: false };
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return { label: 'אין נתונים', tone: 'gray', warning: false };
  const deltaSec = Math.floor((now.getTime() - t) / 1000);
  if (deltaSec < 0) return { label: 'עודכן עכשיו', tone: 'green', warning: false };
  if (deltaSec < 60) return { label: 'עודכן עכשיו', tone: 'green', warning: false };
  const min = Math.floor(deltaSec / 60);
  if (min < 20) return { label: `עודכן לפני ${min} דק׳`, tone: 'green', warning: false };
  if (min < 60) return { label: `עודכן לפני ${min} דק׳`, tone: 'yellow', warning: true };
  const h = Math.floor(min / 60);
  if (h < 24) return { label: `עודכן לפני ${h} שעות`, tone: 'red', warning: true };
  const d = new Date(t);
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const mi = String(d.getMinutes()).padStart(2, '0');
  return { label: `${dd}/${mm} ${hh}:${mi}`, tone: 'red', warning: true };
}
