'use client';

import { useEffect, useState } from 'react';
import { AlertCircle } from 'lucide-react';
import { HelpTooltip } from '@/components/ui/Tooltip';
import { effectiveFreshnessAt } from '@/lib/freshness/adSpendFreshness';
import type { AdSpendFreshness } from '@/lib/types';

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
   * FIX #4 — per-platform AD-SPEND freshness. When supplied, the chip reflects
   * the WORST of (data_daily write, ad-spend last_success_at): a stale ad-spend
   * platform forces the chip out of green even while cron-live keeps bumping
   * data_daily.updated_at with Shopify-only revenue writes every ~10 min.
   */
  adSpendFreshness?: AdSpendFreshness;
}) {
  const { dataLastWriteAt, adSpendFreshness } = props;
  // Re-render every 30s so "X minutes ago" updates without a server hit.
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 30_000);
    return () => clearInterval(id);
  }, []);
  void tick;

  // Drive the chip off the AD-SPEND freshness (folded with the data_daily
  // write), NOT data_daily.updated_at alone.
  const effectiveAt = effectiveFreshnessAt(dataLastWriteAt, adSpendFreshness);
  const { label, tone, warning } = formatTimeAgo(effectiveAt);

  // Single theme-aware OKLCH palette. The `status-*Bg` / `status-*Fg` tokens
  // auto-flip per theme (light vs dark mode), so one palette works on both
  // the dark navy header AND the lighter tab bodies. Previously this
  // component shipped two manual palettes (`darkPalette` + `lightPalette`)
  // gated by a `variant` prop — consolidated into one palette as part of
  // the dashboard token overhaul (2026-05-29).
  const palette = {
    green: 'bg-status-greenBg text-status-greenFg ring-status-green',
    yellow: 'bg-status-orangeBg text-status-orangeFg ring-status-orange',
    red: 'bg-status-redBg text-status-redFg ring-status-red',
    gray: 'bg-glass-2 text-ink-secondary ring-glass-edge',
  } as const;
  const toneClass = palette[tone];

  return (
    <HelpTooltip
      content={
        effectiveAt
          ? `מבוסס על טריות הוצאת הפרסום (הישנה ביותר מבין הפלטפורמות + כתיבת ההכנסה). עודכן ב-${new Date(effectiveAt).toLocaleString('he-IL', { timeZone: 'Asia/Jerusalem' })}`
          : 'אין נתוני freshness (אין שורות בטווח התאריכים)'
      }
    >
      <span
        className={`inline-flex items-center gap-1 px-2 py-1 rounded-md ring-1 text-[11px] sm:text-xs tabular-nums ${toneClass}`}
      >
        {warning && <AlertCircle size={11} className="shrink-0" />}
        <span>{label}</span>
      </span>
    </HelpTooltip>
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
  // FIX E (#32) — render the >24h absolute fallback in Asia/Jerusalem, NOT the
  // browser-local TZ. Local getDate/getHours showed a different wall-clock than
  // this chip's own IL tooltip (toLocaleString tz=Asia/Jerusalem) on a non-IL
  // browser. Intl with an explicit timeZone keeps the fallback TZ-correct.
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Jerusalem',
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(new Date(t));
  const part = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  const label = `${part('day')}/${part('month')} ${part('hour')}:${part('minute')}`;
  return { label, tone: 'red', warning: true };
}
