'use client';

import { useEffect, useMemo, useState } from 'react';
import useSWR from 'swr';
import { Target, Edit3, Check, X, TrendingUp, Calendar, ChevronRight, ChevronLeft } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Money } from '@/components/ui/Money';
import { Card } from '@/components/ui/Card';
import { Heading } from '@/components/ui/Typography';
import { HelpTooltip } from '@/components/ui/Tooltip';
import type { DashboardData, DateRange } from '@/lib/types';
import { buildDateRangeKey, getTodayInIsraelTz } from '@/lib/dateRange';
import { useCogsSettings } from '@/lib/hooks/useCogsSettings';
import { applyCogsToRows } from '@/lib/cogsSettings';
import { useGoalSettings } from '@/lib/hooks/useGoalSettings';
import { effectiveGoal, monthFromRange } from '@/lib/goalSettings';
import { computePacing, forecastMonthEnd } from '@/lib/insights';

/**
 * Per-month, range-aware monthly revenue goal + pacing tracker.
 *
 * The operator sets a BUSINESS-WIDE target per calendar month (stored in the
 * cloud-synced `roas-dashboard:goal-settings` byMonth map — never per-store).
 * The widget is keyed to a single calendar month and shows one of three views:
 *
 *  - CURRENT month  → month-to-date + an end-of-month forecast + pacing badge
 *                     (the EXISTING layout: 3-metric grid, thin bar with the
 *                     "daily target" tick, footer "day N of M · days left").
 *  - PAST  month    → final actual revenue vs goal: "✓ עמד / ✗ לא עמד" badge,
 *                     a "תוצאה מול יעד" column instead of the forecast, and a
 *                     "ביצוע סופי · N ימים" footer (no forecast / days-left).
 *  - FUTURE month   → the goal (often carried forward) with no data yet.
 *
 * Carry-forward: a month with no explicit goal inherits the latest explicitly-
 * set EARLIER month's goal, surfaced with a subtle "נגרר מ-<month>" tag.
 *
 * Range coupling: `range` (the dashboard's selected range) selects the month
 * via `monthFromRange` — exactly one calendar month → that month; any other
 * span → the empty "single calendar month only" state. An in-card `‹ month ›`
 * stepper lets the operator browse months WITHOUT mutating the global filter
 * (local `viewMonth` state, seeded from the range).
 */

type Props = {
  data: DashboardData;
  /** The dashboard's currently selected range. Selects the calendar month. */
  range: DateRange;
};

// Adds `n` days to a 'YYYY-MM-DD' string, anchored in UTC ms so it is
// DST-safe and never returns the same day twice.
function addIsoDays(dateStr: string, n: number): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

// Steps a 'YYYY-MM' month by `n` calendar months.
function addMonths(month: string, n: number): string {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(y, m - 1 + n, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

const HEBREW_MONTHS = [
  'ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני',
  'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר',
];

// Human Hebrew label for a 'YYYY-MM', e.g. '2026-06' → 'יוני 2026'.
function monthLabelHebrew(month: string): string {
  const [y, m] = month.split('-').map(Number);
  const name = HEBREW_MONTHS[m - 1] ?? month;
  return `${name} ${y}`;
}

// Number of days in a 'YYYY-MM' month.
function daysInMonthOf(month: string): number {
  const [y, m] = month.split('-').map(Number);
  return new Date(y, m, 0).getDate();
}

// Local fetcher for the GoalTracker's OWN month-anchored window — same shape /
// route the dashboard uses for daily rows (/api/data → DashboardData), kept
// self-contained so the panel never depends on the parent's filtered SWR cache.
const wideDataFetcher = async (url: string): Promise<DashboardData> => {
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body?.error || `Failed to load (${res.status})`);
  }
  return res.json() as Promise<DashboardData>;
};

export function GoalTracker({ data, range }: Props) {
  const [goalSettings, setGoalSettings] = useGoalSettings();

  // The single calendar month the range selects (null → empty state).
  const selMonth = useMemo(() => monthFromRange(range), [range]);

  // Local viewMonth drives all computations + the ‹ › stepper. Seeded from the
  // range; re-seeds whenever the range resolves to a different month so picking
  // a new preset in Filters moves the card to that month.
  const [viewMonth, setViewMonth] = useState<string | null>(selMonth);
  useEffect(() => {
    setViewMonth(selMonth);
  }, [selMonth]);

  // Editing state for THIS month's goal.
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [editError, setEditError] = useState<string | null>(null);

  const currentMonth = getTodayInIsraelTz().slice(0, 7);
  const effectiveMonth = viewMonth ?? selMonth;
  const isCurrent = effectiveMonth === currentMonth;
  const isPast = effectiveMonth != null && effectiveMonth < currentMonth;

  // Effective goal for the viewed month (exact → carry-forward → none).
  const goalInfo = useMemo(
    () => (effectiveMonth ? effectiveGoal(goalSettings, effectiveMonth) : { value: null, carriedFrom: null }),
    [goalSettings, effectiveMonth],
  );
  const goal = goalInfo.value;

  // ---- Data window for the viewed month -----------------------------------
  // CURRENT month  → [monthStart-7, today]  (forecastMonthEnd needs the
  //                  trailing-7-day baseline, which falls in the prior month
  //                  near month-start; forecastMonthEnd re-slices its own MTD).
  // PAST/FUTURE    → [monthStart, monthEnd]  (final actual / nothing-yet).
  const rangeKey = useMemo(() => {
    if (!effectiveMonth) return null;
    const monthStart = `${effectiveMonth}-01`;
    const monthEnd = `${effectiveMonth}-${String(daysInMonthOf(effectiveMonth)).padStart(2, '0')}`;
    if (isCurrent) {
      const today = getTodayInIsraelTz();
      return buildDateRangeKey('/api/data', { from: addIsoDays(monthStart, -7), to: today });
    }
    return buildDateRangeKey('/api/data', { from: monthStart, to: monthEnd });
  }, [effectiveMonth, isCurrent]);

  const { data: wideData } = useSWR<DashboardData>(rangeKey, wideDataFetcher, {
    refreshInterval: 60_000,
    revalidateOnFocus: true,
  });

  const [cogsSettings] = useCogsSettings();
  // The prop `data.rows` is the dashboard's FILTERED set; the real feed is the
  // month-anchored wide fetch. Fall back to prop rows on first paint so the
  // panel always renders. cogs/netProfit derive only from revenue/spend, so the
  // idempotent re-apply is harmless.
  const monthRows = useMemo(
    () => applyCogsToRows(wideData?.rows ?? data.rows, cogsSettings),
    [wideData, data.rows, cogsSettings],
  );

  // CURRENT month: the existing month-anchored forecast.
  const forecast = useMemo(() => forecastMonthEnd(monthRows), [monthRows]);
  const daysInCurrentMonth = useMemo(
    () => forecast.daysElapsedThisMonth + forecast.daysRemainingThisMonth,
    [forecast],
  );
  const pacing = useMemo(
    () => computePacing(goal, forecast.monthToDateRevenue, forecast.daysElapsedThisMonth, daysInCurrentMonth),
    [goal, forecast, daysInCurrentMonth],
  );

  // PAST/FUTURE month: final actual revenue = sum of in-month revenue.
  const monthRevenue = useMemo(() => {
    if (!effectiveMonth || isCurrent) return 0;
    const start = `${effectiveMonth}-01`;
    const end = `${effectiveMonth}-${String(daysInMonthOf(effectiveMonth)).padStart(2, '0')}`;
    return monthRows.reduce((sum, r) => (r.date >= start && r.date <= end ? sum + r.revenue : sum), 0);
  }, [monthRows, effectiveMonth, isCurrent]);

  function startEdit() {
    const exact = effectiveMonth ? goalSettings.byMonth[effectiveMonth] : undefined;
    setDraft(typeof exact === 'number' ? String(exact) : (goal != null ? String(goal) : ''));
    setEditError(null);
    setEditing(true);
  }
  function commitEdit() {
    if (!effectiveMonth) { setEditing(false); return; }
    // Empty draft → clear THIS month's explicit goal (carry-forward may re-fill).
    if (draft.trim() === '') {
      const next = { ...goalSettings.byMonth };
      delete next[effectiveMonth];
      setGoalSettings({ ...goalSettings, byMonth: next });
      setEditError(null);
      setEditing(false);
      return;
    }
    const n = Number(draft.replace(/,/g, ''));
    if (!Number.isFinite(n) || n <= 0) {
      setEditError('הזן מספר חיובי');
      return;
    }
    setGoalSettings({ ...goalSettings, byMonth: { ...goalSettings.byMonth, [effectiveMonth]: n } });
    setEditError(null);
    setEditing(false);
  }
  function cancelEdit() {
    setEditing(false);
    setDraft('');
    setEditError(null);
  }
  const draftTrimmed = draft.trim();
  const draftIsInvalid = (() => {
    if (draftTrimmed === '') return false;
    const n = Number(draft.replace(/,/g, ''));
    return !Number.isFinite(n) || n <= 0;
  })();

  function stepMonth(delta: number) {
    if (!effectiveMonth) return;
    setEditing(false);
    setViewMonth(addMonths(effectiveMonth, delta));
  }

  // The ‹ month › stepper. In RTL, "‹" steps to the next (later) month and "›"
  // to the previous (earlier) month — matching the mockup's visual order.
  const monthNav = effectiveMonth ? (
    <span className="inline-flex items-center gap-0.5 bg-glass-2 border border-glass-edge rounded-lg p-0.5">
      <Button
        variant="ghost"
        size="icon"
        className="!w-6 !h-6"
        onClick={() => stepMonth(1)}
        aria-label="חודש הבא"
        title="חודש הבא"
      >
        <ChevronRight size={14} />
      </Button>
      <span className="font-semibold text-xs sm:text-[12.5px] text-ink min-w-[84px] text-center tabular-nums">
        {monthLabelHebrew(effectiveMonth)}
      </span>
      <Button
        variant="ghost"
        size="icon"
        className="!w-6 !h-6"
        onClick={() => stepMonth(-1)}
        aria-label="חודש קודם"
        title="חודש קודם"
      >
        <ChevronLeft size={14} />
      </Button>
    </span>
  ) : null;

  // ---- Render: EMPTY (non-single-month range) -----------------------------
  if (!effectiveMonth) {
    return (
      <Card className="!p-4 sm:!p-5">
        <div className="flex items-start gap-3">
          <span className="inline-flex items-center justify-center w-9 h-9 rounded-lg bg-accent-bg text-accent shrink-0">
            <Target size={18} />
          </span>
          <div>
            <div className="font-bold text-sm sm:text-[15px] text-ink mb-1">
              מעקב יעד זמין לחודש בודד
            </div>
            <p className="text-xs sm:text-[12.5px] text-ink-muted leading-relaxed">
              בחר חודש קלנדרי אחד (או הפריסט &quot;החודש&quot;), או דפדף עם ה-‹ › בכרטיס
              כדי לראות את היעד והביצוע מולו ולעבור בין חודשים.
            </p>
          </div>
        </div>
      </Card>
    );
  }

  // ---- Render: EDITING this month's goal ----------------------------------
  if (editing) {
    return (
      <Card className="!p-4 sm:!p-5">
        <div className="flex items-center justify-between gap-3 mb-3">
          <div className="flex items-center gap-2.5 min-w-0">
            <span className="inline-flex items-center justify-center w-7 h-7 rounded-lg bg-accent-bg text-accent shrink-0">
              <Target size={14} />
            </span>
            <Heading level="section">
              יעד הכנסות · {monthLabelHebrew(effectiveMonth)}
            </Heading>
          </div>
          {monthNav}
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
          <Button onClick={commitEdit} disabled={draftIsInvalid} size="sm">
            <Check size={13} />
            שמור
          </Button>
          <Button variant="secondary" size="icon" onClick={cancelEdit} aria-label="בטל">
            <X size={14} />
          </Button>
        </div>
        {editError && (
          <p className="text-[11px] text-status-warningFg mt-2" role="alert">
            {editError}
          </p>
        )}
        <p className="text-[11px] text-ink-muted mt-2">
          הערך נשמר גם בענן (cloud-synced) וגם בדפדפן, פר-חודש. אפשר לעדכן בכל עת.
        </p>
      </Card>
    );
  }

  // ---- Render: NO goal for this month (and none carried) → empty-goal card -
  if (goal == null) {
    return (
      <Card
        variant="flat"
        className={cn(
          '!p-0 overflow-hidden rounded-card shadow-glass',
          'bg-[linear-gradient(135deg,var(--accent),oklch(from_var(--accent)_calc(l*0.55)_c_h))] text-accent-fg',
        )}
      >
        <div className="p-4 sm:p-5">
          <div className="flex items-center justify-between gap-3 mb-3">
            <div className="flex items-center gap-2.5 min-w-0">
              <span className="inline-flex items-center justify-center w-7 h-7 rounded-lg bg-accent-soft text-accent-fg shrink-0">
                <Target size={14} />
              </span>
              <Heading level="section" className="text-accent-fg">
                קבע יעד · {monthLabelHebrew(effectiveMonth)}
              </Heading>
            </div>
            {monthNav}
          </div>
          <p className="text-xs sm:text-sm text-accent-fg leading-relaxed mb-3">
            הגדר יעד הכנסות לחודש זה והדשבורד יחשב בכל יום אם אתה מתקדם
            כפי שצריך, יקדים, או מפגר.
          </p>
          <Button onClick={startEdit} size="sm" className="bg-glass-2 text-accent hover:bg-glass-3">
            <Edit3 size={13} />
            קבע יעד
          </Button>
        </div>
      </Card>
    );
  }

  // The carry-forward tag, shown next to the goal label when this month
  // inherits an earlier month's goal.
  const carryTag = goalInfo.carriedFrom ? (
    <span className="text-[10px] sm:text-[10.5px] text-status-warningFg font-semibold">
      · נגרר מ-{monthLabelHebrew(goalInfo.carriedFrom)}
    </span>
  ) : null;

  // =========================================================================
  // PAST complete month — final actual vs goal.
  // =========================================================================
  if (isPast) {
    const met = monthRevenue >= goal;
    const pctOfGoal = goal > 0 ? (monthRevenue / goal) * 100 : 0;
    const diff = monthRevenue - goal;
    const diffPct = goal > 0 ? (Math.abs(diff) / goal) * 100 : 0;
    const finalPct = Math.min(100, Math.max(0, pctOfGoal));
    const totalDays = daysInMonthOf(effectiveMonth);

    return (
      <Card className="!p-0 overflow-hidden">
        <div className="p-4 sm:p-5">
          <div className="flex items-center justify-between gap-3 mb-3">
            <div className="flex items-center gap-2.5 min-w-0">
              <span className="inline-flex items-center justify-center w-7 h-7 rounded-lg bg-accent-bg text-accent shrink-0">
                <Target size={14} />
              </span>
              <Heading level="section">יעד חודשי</Heading>
              <span className={cn(
                'inline-flex items-center px-2 py-0.5 text-[10px] sm:text-[11px] font-semibold rounded',
                met ? 'bg-status-greenBg text-status-greenFg' : 'bg-status-redBg text-status-redFg',
              )}>
                {met ? '✓ עמד ביעד' : '✗ לא עמד'}
              </span>
            </div>
            <div className="flex items-center gap-1.5">
              {monthNav}
              <Button variant="ghost" size="icon" onClick={startEdit} aria-label="ערוך יעד" title="ערוך יעד">
                <Edit3 size={13} />
              </Button>
            </div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 sm:gap-4 mb-3">
            <div>
              <div className="text-[11px] sm:text-xs text-ink-muted uppercase tracking-wide">
                הכנסות בחודש
              </div>
              <div className="text-base sm:text-lg font-bold tabular-nums text-ink mt-0.5">
                <span className="text-[10px] text-ink-muted font-medium me-1">CAD</span>
                <Money value={monthRevenue} prefix="none" locale="he-IL" compactAbove={1_000_000} />
              </div>
              <div className={cn('text-[10px] sm:text-[11px] tabular-nums mt-0.5', met ? 'text-status-greenFg' : 'text-status-redFg')}>
                {pctOfGoal.toFixed(0)}% מהיעד
              </div>
            </div>
            <div>
              <div className="text-[11px] sm:text-xs text-ink-muted uppercase tracking-wide inline-flex items-center gap-1 flex-wrap">
                יעד החודש {carryTag}
              </div>
              <div className="text-base sm:text-lg font-bold tabular-nums text-ink mt-0.5">
                <span className="text-[10px] text-ink-muted font-medium me-1">CAD</span>
                <Money value={goal} prefix="none" locale="he-IL" compactAbove={1_000_000} />
              </div>
              <div className={cn('text-[10px] sm:text-[11px] tabular-nums mt-0.5', met ? 'text-status-greenFg' : 'text-status-redFg')}>
                {met ? 'עברת ב-CAD ' : 'חסרו CAD '}
                <Money value={Math.abs(diff)} prefix="none" locale="he-IL" compactAbove={1_000_000} />
              </div>
            </div>
            <div className="col-span-2 sm:col-span-1">
              <div className="text-[11px] sm:text-xs text-ink-muted uppercase tracking-wide inline-flex items-center gap-1">
                {met ? '✓' : '✗'} תוצאה מול יעד
              </div>
              <div className={cn('text-base sm:text-lg font-bold tabular-nums mt-0.5', met ? 'text-status-greenFg' : 'text-status-redFg')}>
                <span className="text-[10px] text-ink-muted font-medium me-1">CAD</span>
                {diff >= 0 ? '+' : '−'}
                <Money value={Math.abs(diff)} prefix="none" locale="he-IL" compactAbove={1_000_000} />
              </div>
              <div className={cn('text-[10px] sm:text-[11px] tabular-nums mt-0.5', met ? 'text-status-greenFg' : 'text-status-redFg')}>
                {met ? `מעל היעד ב-${diffPct.toFixed(1)}%` : `מתחת ליעד ב-${diffPct.toFixed(1)}%`}
              </div>
            </div>
          </div>

          {/* Final-performance bar (no daily-target tick on a completed month) */}
          <div className="relative h-2.5 bg-glass-2 rounded-full overflow-hidden">
            <div
              className={cn('h-full rounded-full transition-all duration-slow ease-out', met ? 'bg-status-green' : 'bg-status-red')}
              style={{ width: `${finalPct}%` }}
            />
          </div>

          <div className="flex items-center justify-between mt-2 text-[10px] sm:text-[11px] text-ink-muted tabular-nums">
            <span className="inline-flex items-center gap-1">
              <Calendar size={11} />
              החודש הסתיים · {totalDays} ימים
            </span>
            <span>ביצוע סופי</span>
            <span className={cn('inline-flex items-center gap-1 font-semibold', met ? 'text-status-greenFg' : 'text-status-redFg')}>
              {met ? '✓ הושג' : '✗ לא הושג'}
            </span>
          </div>
        </div>
      </Card>
    );
  }

  // =========================================================================
  // CURRENT (or FUTURE) month — pacing + end-of-month forecast.
  //   - CURRENT: live MTD + forecast (forecastMonthEnd anchored to today).
  //   - FUTURE:  no data yet → MTD 0, forecast "—". Same layout as the mockup's
  //     carry-forward state ④.
  // =========================================================================
  const isFuture = !isCurrent && !isPast;
  const mtdRevenue = isFuture ? 0 : forecast.monthToDateRevenue;
  const daysInView = isFuture ? daysInMonthOf(effectiveMonth) : daysInCurrentMonth;
  const daysElapsed = isFuture ? 0 : forecast.daysElapsedThisMonth;
  const daysRemaining = isFuture ? daysInView : forecast.daysRemainingThisMonth;

  const progress = goal > 0 ? mtdRevenue / goal : 0;
  const progressPct = Math.min(1.2, Math.max(0, progress));
  const expectedPct = isFuture ? 0 : Math.min(1, Math.max(0, pacing.expectedPct));

  const statusMeta: Record<string, { label: string; bg: string; color: string }> = {
    ahead: { label: 'מקדים את היעד', bg: 'bg-status-greenBg', color: 'text-status-greenFg' },
    'on-pace': { label: 'בקצב הנכון', bg: 'bg-accent-bg', color: 'text-accent' },
    behind: { label: 'מפגר מהיעד', bg: 'bg-status-warningBg', color: 'text-status-warningFg' },
    unknown: { label: '—', bg: 'bg-glass-2', color: 'text-ink-muted' },
  };
  // FUTURE month has no pacing yet — show a neutral "start of month" chip.
  const statusKey = isFuture ? 'start' : pacing.status;
  const sMeta = isFuture
    ? { label: 'תחילת החודש', bg: 'bg-glass-2', color: 'text-ink-muted' }
    : statusMeta[statusKey];

  const barColor = isFuture
    ? 'bg-accent'
    : pacing.status === 'ahead' ? 'bg-status-green'
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
            <Heading level="section">יעד חודשי</Heading>
            <span className={cn(
              'inline-flex items-center px-2 py-0.5 text-[10px] sm:text-[11px] font-semibold rounded',
              sMeta.bg, sMeta.color,
            )}>
              {sMeta.label}
            </span>
          </div>
          <div className="flex items-center gap-1.5">
            {monthNav}
            <Button variant="ghost" size="icon" onClick={startEdit} aria-label="ערוך יעד" title="ערוך יעד">
              <Edit3 size={13} />
            </Button>
          </div>
        </div>

        {/* Numbers row */}
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 sm:gap-4 mb-3">
          <div>
            <div className="text-[11px] sm:text-xs text-ink-muted uppercase tracking-wide">
              נצבר עד כה
            </div>
            <div className="text-base sm:text-lg font-bold tabular-nums text-ink mt-0.5">
              <span className="text-[10px] text-ink-muted font-medium me-1">CAD</span>
              <Money value={mtdRevenue} prefix="none" locale="he-IL" compactAbove={1_000_000} />
            </div>
            <div className="text-[10px] sm:text-[11px] text-ink-muted tabular-nums mt-0.5">
              {(progress * 100).toFixed(1)}% מהיעד
            </div>
          </div>
          <div>
            <div className="text-[11px] sm:text-xs text-ink-muted uppercase tracking-wide inline-flex items-center gap-1 flex-wrap">
              יעד החודש {carryTag}
            </div>
            <div className="text-base sm:text-lg font-bold tabular-nums text-ink mt-0.5">
              <span className="text-[10px] text-ink-muted font-medium me-1">CAD</span>
              <Money value={goal} prefix="none" locale="he-IL" compactAbove={1_000_000} />
            </div>
            <div className="text-[10px] sm:text-[11px] text-ink-muted tabular-nums mt-0.5">
              חסרים CAD <Money value={Math.max(0, goal - mtdRevenue)} prefix="none" locale="he-IL" compactAbove={1_000_000} />
            </div>
          </div>
          <div className="col-span-2 sm:col-span-1">
            <div className="text-[11px] sm:text-xs text-ink-muted uppercase tracking-wide inline-flex items-center gap-1">
              <TrendingUp size={11} />
              חיזוי סוף חודש
            </div>
            {isFuture ? (
              <>
                <div className="text-base sm:text-lg font-bold tabular-nums text-ink mt-0.5">—</div>
                <div className="text-[10px] sm:text-[11px] text-ink-muted tabular-nums mt-0.5">
                  אין עדיין מספיק נתונים
                </div>
              </>
            ) : (
              <>
                <div className="text-base sm:text-lg font-bold tabular-nums text-ink mt-0.5">
                  <span className="text-[10px] text-ink-muted font-medium me-1">CAD</span>
                  <Money value={forecast.projectedRevenue} prefix="none" locale="he-IL" compactAbove={1_000_000} />
                </div>
                <div className={cn(
                  'text-[10px] sm:text-[11px] tabular-nums mt-0.5',
                  forecast.projectedRevenue >= goal ? 'text-status-greenFg' : 'text-status-redFg',
                )}>
                  {forecast.projectedRevenue >= goal
                    ? `מעל היעד ב-${(((forecast.projectedRevenue - goal) / goal) * 100).toFixed(1)}%`
                    : `מתחת ליעד ב-${(((goal - forecast.projectedRevenue) / goal) * 100).toFixed(1)}%`}
                </div>
              </>
            )}
          </div>
        </div>

        {/* Progress bar with expected-pacing marker */}
        <div className="relative h-2.5 bg-glass-2 rounded-full overflow-hidden">
          <div
            className={cn('h-full rounded-full transition-all duration-slow ease-out', barColor)}
            style={{ width: `${progressPct * 100}%` }}
          />
          {expectedPct > 0 && expectedPct < 1 && (
            <HelpTooltip content={`היעד היומי: ${(expectedPct * 100).toFixed(0)}%`}>
              <div
                className="absolute top-0 bottom-0 w-0.5 bg-ink-muted"
                style={{ insetInlineStart: `${expectedPct * 100}%` }}
              />
            </HelpTooltip>
          )}
        </div>

        <div className="flex items-center justify-between mt-2 text-[10px] sm:text-[11px] text-ink-muted tabular-nums">
          <span className="inline-flex items-center gap-1">
            <Calendar size={11} />
            יום {daysElapsed} מתוך {daysInView}
          </span>
          <span>
            {isFuture ? 'היעד נגרר — לחץ ✎ לקבוע יעד' : `נשארו ${daysRemaining} ימים`}
          </span>
          <span className="inline-flex items-center gap-1">
            <span className="inline-block w-0.5 h-2.5 bg-ink-muted align-middle" />
            יעד יומי: {(expectedPct * 100).toFixed(0)}%
          </span>
        </div>
      </div>
    </Card>
  );
}
