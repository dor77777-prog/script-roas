'use client';

import { useEffect, useMemo, useState } from 'react';
import useSWR from 'swr';
import { Target, Edit3, Check, X, TrendingUp, Calendar } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Money } from '@/components/ui/Money';
import { Card } from '@/components/ui/Card';
import { Heading } from '@/components/ui/Typography';
import { HelpTooltip } from '@/components/ui/Tooltip';
import type { DashboardData } from '@/lib/types';
import { buildDateRangeKey, getTodayInIsraelTz } from '@/lib/dateRange';
import { useCogsSettings } from '@/lib/hooks/useCogsSettings';
import { applyCogsToRows } from '@/lib/cogsSettings';
import {
  computePacing,
  forecastMonthEnd,
  readGoal,
  writeGoal,
} from '@/lib/insights';

/**
 * Monthly revenue goal + pacing tracker. The user sets a target (stored in
 * localStorage) and the widget shows:
 *  - month-to-date revenue with a progress bar
 *  - "expected pacing" marker on the bar (where they should be by today)
 *  - status chip: ahead / on-pace / behind
 *  - projected end-of-month revenue based on the trailing 7-day daily avg
 *  - days remaining
 */

type Props = {
  data: DashboardData;
};

// Adds `n` days to a 'YYYY-MM-DD' string, anchored in UTC ms so it is
// DST-safe and never returns the same day twice. Mirrors the helper inside
// lib/insights.ts (which is module-private there).
function addIsoDays(dateStr: string, n: number): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

// Local fetcher for the GoalTracker's OWN wide, filter-independent window.
// Same shape/route the dashboard uses for daily rows (/api/data →
// DashboardData), kept self-contained so the panel never depends on the
// parent's filtered SWR cache.
const wideDataFetcher = async (url: string): Promise<DashboardData> => {
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body?.error || `Failed to load (${res.status})`);
  }
  return res.json() as Promise<DashboardData>;
};

/**
 * The monthly goal is intentionally GLOBAL — one business-wide target the
 * operator sets once for "all stores combined", with neither the store
 * filter nor the date range affecting it. Two consequences:
 *
 *  - The widget feeds an ALL-STORES, FILTER-INDEPENDENT row set to
 *    `forecastMonthEnd`; the function does its own month-anchored slice
 *    so date filtering also wouldn't help.
 *  - It does NOT accept `filters` as a prop. An earlier revision (audit
 *    d/CR-04, 2026-05-23) wired in `filters.store` so the panel scoped
 *    MTD per store; the operator corrected that on 2026-05-23 — the
 *    intent is a single goal across the whole business, not per-store
 *    sub-goals.
 *
 * Why a SEPARATE SWR fetch instead of the `data.rows` prop (fix 2026-06-01):
 * `data.rows` is scoped to the dashboard's current filter RANGE. For the
 * default `this_month` preset at the START of a month it contains ONLY the
 * current month's days (e.g. just June 1). But `forecastMonthEnd`'s run-rate
 * baseline is the trailing 7 COMPLETED days `[today-7, today-1]`, which near
 * month-start fall in the PREVIOUS month. With no matching rows the baseline
 * daily average was 0, so `projectedRevenue = monthToDateRevenue + 0` —
 * the end-of-month forecast collapsed to month-to-date (e.g. day 1 of 30
 * forecasting 4,359 instead of ~130,770). It also re-coupled the GLOBAL
 * goal to `filters.range`. We instead fetch a fixed, global window that
 * always covers BOTH the month-to-date AND the trailing-7-day baseline:
 * `[monthStart - 7, today]`. forecastMonthEnd re-slices its own MTD +
 * baseline, so a superset range is safe. While the wide fetch is still
 * loading we fall back to `data.rows` so the panel always renders.
 */
export function GoalTracker({ data }: Props) {
  const [goal, setGoal] = useState<number | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  // Inline validation error for the editor. Shown directly under the input
  // when commitEdit refuses an invalid value, instead of silently swallowing
  // the user's typed input. Cleared on every draft change.
  const [editError, setEditError] = useState<string | null>(null);

  // Hydrate the goal from localStorage on mount; re-read whenever the cloud
  // sync layer updates the underlying value (other device, partner edit).
  useEffect(() => {
    setGoal(readGoal());
    const onChange = () => setGoal(readGoal());
    window.addEventListener('roas-goal-changed', onChange);
    return () => window.removeEventListener('roas-goal-changed', onChange);
  }, []);

  // GoalTracker's OWN wide, filter-INDEPENDENT window so forecastMonthEnd is
  // never starved of its trailing-7-day baseline (see the component
  // docstring). The window must cover BOTH the month-to-date AND the
  // trailing-7-day baseline at any point in the month:
  //   range = [monthStart - 7, today]   (today/monthStart anchored in IL TZ)
  // No store filter — the goal is global. This key is fixed for the whole
  // session (only ticks over at IL midnight / month boundaries), so it does
  // NOT depend on filters.range or filters.store.
  const wideRangeKey = useMemo(() => {
    const today = getTodayInIsraelTz();
    const monthStart = `${today.slice(0, 7)}-01`;
    const from = addIsoDays(monthStart, -7);
    return buildDateRangeKey('/api/data', { from, to: today });
  }, []);
  const { data: wideData } = useSWR<DashboardData>(wideRangeKey, wideDataFetcher, {
    refreshInterval: 60_000,
    revalidateOnFocus: true,
  });

  // Feed the wide, global rows to the forecast. Fall back to the (filtered)
  // prop rows on first paint while the wide fetch is still loading so the
  // panel always renders something; a brief under-projection before the wide
  // fetch resolves is acceptable. forecastMonthEnd does its own month-anchored
  // MTD slice + trailing-7-day baseline, so a superset range is fine.
  const [cogsSettings] = useCogsSettings();
  // Note: the prop `data.rows` are ALREADY cogs-adjusted by Dashboard; the real
  // forecast feed is `wideData.rows`. This re-apply is a harmless idempotent
  // fallback (cogs/netProfit derive only from revenue/spend) covering the
  // pre-`wideData` first paint before the wide SWR fetch resolves.
  const forecastRows = useMemo(
    () => applyCogsToRows(wideData?.rows ?? data.rows, cogsSettings),
    [wideData, data.rows, cogsSettings],
  );
  const forecast = useMemo(() => forecastMonthEnd(forecastRows), [forecastRows]);
  const daysInMonth = useMemo(
    () => forecast.daysElapsedThisMonth + forecast.daysRemainingThisMonth,
    [forecast],
  );

  const pacing = useMemo(
    () => computePacing(
      goal,
      forecast.monthToDateRevenue,
      forecast.daysElapsedThisMonth,
      daysInMonth,
    ),
    [goal, forecast, daysInMonth],
  );

  function startEdit() {
    setDraft(goal != null ? String(goal) : '');
    setEditError(null);
    setEditing(true);
  }
  function commitEdit() {
    // Empty draft → clear the goal. Always succeeds.
    if (draft.trim() === '') {
      setGoal(null);
      writeGoal(null);
      setEditError(null);
      setEditing(false);
      return;
    }
    const n = Number(draft.replace(/,/g, ''));
    if (!Number.isFinite(n) || n <= 0) {
      // Surface invalid input to the user instead of silently swallowing.
      // The input filter at the keyboard already strips non-digit-non-comma
      // chars, but a paste of ",,," parses to NaN, and "-5"/"0" (which the
      // filter does allow through the digit class) also reach here.
      setEditError('הזן מספר חיובי');
      return;
    }
    setGoal(n);
    writeGoal(n);
    setEditError(null);
    setEditing(false);
  }
  function cancelEdit() {
    setEditing(false);
    setDraft('');
    setEditError(null);
  }
  // Save button disabled when the current draft is non-empty AND obviously
  // invalid. Empty is allowed (it clears the goal).
  const draftTrimmed = draft.trim();
  const draftIsInvalid = (() => {
    if (draftTrimmed === '') return false;
    const n = Number(draft.replace(/,/g, ''));
    return !Number.isFinite(n) || n <= 0;
  })();

  // ---- Render -------------------------------------------------------------
  // Two modes: goal set vs goal not set.
  if (goal == null && !editing) {
    return (
      <Card
        variant="flat"
        className={cn(
          // Solid accent gradient — not a glass card; opt out via flat so
          // the .glass rule's translucent background doesn't fight the
          // accent fill. Keeps rounded-card + shadow-glass via explicit
          // classes for chassis consistency.
          '!p-0 overflow-hidden rounded-card shadow-glass',
          // Far gradient stop is a DARKER anchor (~55% of the accent's own
          // lightness, derived from the token so it stays dark in BOTH themes)
          // rather than --accent-deep, which LIGHTENS in dark mode (deep accent
          // is lighter than accent) and drops the white body text to ~1.94
          // contrast. Keeps white-on-fill well above 4.5:1 in light AND dark.
          'bg-[linear-gradient(135deg,var(--accent),oklch(from_var(--accent)_calc(l*0.55)_c_h))] text-accent-fg',
        )}
      >
        <div className="p-4 sm:p-5">
          <div className="flex items-center gap-2.5 mb-3">
            <span className="inline-flex items-center justify-center w-7 h-7 rounded-lg bg-accent-soft text-accent-fg shrink-0">
              <Target size={14} />
            </span>
            <Heading level="section" className="text-accent-fg">
              קבע יעד חודשי
            </Heading>
          </div>
          <p className="text-xs sm:text-sm text-accent-fg leading-relaxed mb-3">
            הגדר יעד הכנסות לחודש הזה והדשבורד יחשב בכל יום אם אתה מתקדם
            כפי שצריך, יקדים, או מפגר.
          </p>
          <Button
            onClick={startEdit}
            size="sm"
            className="bg-glass-2 text-accent hover:bg-glass-3"
          >
            <Edit3 size={13} />
            קבע יעד
          </Button>
        </div>
      </Card>
    );
  }

  if (editing) {
    return (
      <Card className="!p-4 sm:!p-5">
        <div className="flex items-center gap-2.5 mb-3">
          <span className="inline-flex items-center justify-center w-7 h-7 rounded-lg bg-accent-bg text-accent shrink-0">
            <Target size={14} />
          </span>
          <Heading level="section">
            הזן יעד הכנסות חודשי
          </Heading>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex-1">
            <Input
              type="text"
              inputMode="numeric"
              prefix={<span className="text-xs font-medium">CAD</span>}
              value={draft}
              onChange={e => {
                setDraft(e.target.value.replace(/[^\d,]/g, ''));
                // Clear any stale error as soon as the user types.
                if (editError) setEditError(null);
              }}
              onKeyDown={e => {
                if (e.key === 'Enter') commitEdit();
                if (e.key === 'Escape') cancelEdit();
              }}
              placeholder="100,000"
              autoFocus
              error={editError != null || draftIsInvalid}
            />
          </div>
          <Button
            onClick={commitEdit}
            disabled={draftIsInvalid}
            size="sm"
          >
            <Check size={13} />
            שמור
          </Button>
          <Button
            variant="secondary"
            size="icon"
            onClick={cancelEdit}
            aria-label="בטל"
          >
            <X size={14} />
          </Button>
        </div>
        {editError && (
          <p className="text-[11px] text-status-warningFg mt-2" role="alert">
            {editError}
          </p>
        )}
        <p className="text-[11px] text-ink-muted mt-2">
          {/* d/CR-04 (audit 2026-05-23): copy used to say "נשמר רק בדפדפן
              הזה (localStorage)" — but writeGoal() in lib/insights.ts ALSO
              calls pushCloudKey(GOAL_STORAGE_KEY, value) which mirrors to
              Google Sheets. The lie misled the operator into thinking the
              goal wouldn't survive a device switch. */}
          הערך נשמר גם בענן (cloud-synced) וגם בדפדפן. אפשר לעדכן בכל עת.
        </p>
      </Card>
    );
  }

  // Goal is set — show pacing.
  const progressPct = Math.min(1.2, Math.max(0, pacing.progress));
  const expectedPct = Math.min(1, Math.max(0, pacing.expectedPct));
  const statusMeta: Record<
    typeof pacing.status,
    { label: string; bg: string; color: string }
  > = {
    ahead: { label: 'מקדים את היעד', bg: 'bg-status-greenBg', color: 'text-status-greenFg' },
    'on-pace': { label: 'בקצב הנכון', bg: 'bg-accent-bg', color: 'text-accent' },
    behind: { label: 'מפגר מהיעד', bg: 'bg-status-warningBg', color: 'text-status-warningFg' },
    unknown: { label: '—', bg: 'bg-glass-2', color: 'text-ink-muted' },
  };
  const sMeta = statusMeta[pacing.status];

  // Color of the fill bar depends on status.
  const barColor =
    pacing.status === 'ahead' ? 'bg-status-green'
    : pacing.status === 'on-pace' ? 'bg-accent'
    : pacing.status === 'behind' ? 'bg-status-warning'
    : 'bg-ink-muted';

  return (
    <Card className="!p-0 overflow-hidden">
      <div className="p-4 sm:p-5">
        <div className="flex items-center justify-between gap-3 mb-3">
          <div className="flex items-center gap-2.5 min-w-0">
            <span className="inline-flex items-center justify-center w-7 h-7 rounded-lg bg-accent-bg text-accent shrink-0">
              <Target size={14} />
            </span>
            <Heading level="section">
              יעד חודשי
            </Heading>
            <span className={cn(
              'inline-flex items-center px-2 py-0.5 text-[10px] sm:text-[11px] font-semibold rounded',
              sMeta.bg, sMeta.color,
            )}>
              {sMeta.label}
            </span>
          </div>
          <Button
            variant="ghost"
            size="icon"
            onClick={startEdit}
            aria-label="ערוך יעד"
            title="ערוך יעד"
          >
            <Edit3 size={13} />
          </Button>
        </div>

        {/* Numbers row */}
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 sm:gap-4 mb-3">
          <div>
            <div className="text-[11px] sm:text-xs text-ink-muted uppercase tracking-wide">
              נצבר עד כה
            </div>
            <div className="text-base sm:text-lg font-bold tabular-nums text-ink mt-0.5">
              <span className="text-[10px] text-ink-muted font-medium me-1">CAD</span>
              <Money value={forecast.monthToDateRevenue} prefix="none" locale="he-IL" compactAbove={1_000_000} />
            </div>
            <div className="text-[10px] sm:text-[11px] text-ink-muted tabular-nums mt-0.5">
              {(pacing.progress * 100).toFixed(1)}% מהיעד
            </div>
          </div>
          <div>
            <div className="text-[11px] sm:text-xs text-ink-muted uppercase tracking-wide">
              יעד החודש
            </div>
            <div className="text-base sm:text-lg font-bold tabular-nums text-ink mt-0.5">
              <span className="text-[10px] text-ink-muted font-medium me-1">CAD</span>
              <Money value={goal!} prefix="none" locale="he-IL" compactAbove={1_000_000} />
            </div>
            <div className="text-[10px] sm:text-[11px] text-ink-muted tabular-nums mt-0.5">
              חסרים CAD <Money value={Math.max(0, goal! - forecast.monthToDateRevenue)} prefix="none" locale="he-IL" compactAbove={1_000_000} />
            </div>
          </div>
          <div className="col-span-2 sm:col-span-1">
            <div className="text-[11px] sm:text-xs text-ink-muted uppercase tracking-wide inline-flex items-center gap-1">
              <TrendingUp size={11} />
              חיזוי סוף חודש
            </div>
            <div className="text-base sm:text-lg font-bold tabular-nums text-ink mt-0.5">
              <span className="text-[10px] text-ink-muted font-medium me-1">CAD</span>
              <Money value={forecast.projectedRevenue} prefix="none" locale="he-IL" compactAbove={1_000_000} />
            </div>
            <div className="text-[10px] sm:text-[11px] text-ink-muted tabular-nums mt-0.5">
              {forecast.projectedRevenue >= goal!
                ? `מעל היעד ב-${(((forecast.projectedRevenue - goal!) / goal!) * 100).toFixed(1)}%`
                : `מתחת ליעד ב-${(((goal! - forecast.projectedRevenue) / goal!) * 100).toFixed(1)}%`}
            </div>
          </div>
        </div>

        {/* Progress bar with expected-pacing marker */}
        <div className="relative h-2.5 bg-glass-2 rounded-full overflow-hidden">
          <div
            className={cn('h-full rounded-full transition-all duration-slow ease-out', barColor)}
            style={{ width: `${progressPct * 100}%` }}
          />
          {/* Expected pacing marker — vertical tick */}
          {expectedPct > 0 && expectedPct < 1 && (
            <HelpTooltip content={`היעד היומי: ${(expectedPct * 100).toFixed(0)}%`}>
              <div
                className="absolute top-0 bottom-0 w-0.5 bg-ink-muted"
                style={{
                  // In RTL flow, "right" is the start. Position from start = right
                  // of the container.
                  insetInlineStart: `${expectedPct * 100}%`,
                }}
              />
            </HelpTooltip>
          )}
        </div>

        <div className="flex items-center justify-between mt-2 text-[10px] sm:text-[11px] text-ink-muted tabular-nums">
          <span className="inline-flex items-center gap-1">
            <Calendar size={11} />
            יום {forecast.daysElapsedThisMonth} מתוך {daysInMonth}
          </span>
          <span>
            נשארו {forecast.daysRemainingThisMonth} ימים
          </span>
          <span className="inline-flex items-center gap-1">
            <span className="inline-block w-0.5 h-2.5 bg-ink-muted align-middle" />
            יעד יומי: {(pacing.expectedPct * 100).toFixed(0)}%
          </span>
        </div>
      </div>
    </Card>
  );
}
