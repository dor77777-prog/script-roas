/**
 * Pure helper that builds the single narrative sentence shown inside
 * TodayLive between the LIVE header and the 6 stat cards.
 *
 * Inputs are everything TodayLive already has on hand: today's aggregate,
 * per-store aggregates, the monthly goal (read from localStorage by the
 * caller — keeping this function pure for testing), and the day-of-month
 * position for pace calculation.
 *
 * The output is a single Hebrew sentence (he-IL) that summarizes:
 *   1. Today's revenue + ROAS
 *   2. Position vs the monthly goal pace (skip if no goal set)
 *   3. The top store by revenue (skip if no stores have data)
 *
 * The sentence is intentionally compact — under ~140 characters so it
 * fits as a one-line eyebrow inside the LIVE hero. Long names truncate
 * naturally via the CSS `.lh-narrative` rule (line-clamp).
 */
export interface NarrativeInputs {
  /** Today's aggregate revenue in display currency (CAD). */
  revenue: number;
  /** Today's aggregate ROAS as a number (e.g. 2.42). */
  roas: number;
  /** Per-store aggregates for today; used to pick the top store by revenue. */
  storeAggs: Array<{ store: string; revenue: number; roas: number }>;
  /** Monthly revenue goal in display currency. `null` if no goal is set. */
  monthlyGoal: number | null;
  /** Revenue accrued from the 1st of the month through end-of-yesterday. */
  monthToDateRevenue: number;
  /** Day-of-month (1..31) for pace calculation. */
  dayOfMonth: number;
  /** Number of days in the current month. */
  daysInMonth: number;
}

const fmtCurrency = (n: number) =>
  new Intl.NumberFormat('he-IL', { maximumFractionDigits: 0 }).format(Math.round(n));

const fmtRoas = (n: number) => n.toFixed(2);

export function buildTodayNarrative(inputs: NarrativeInputs): string {
  const {
    revenue,
    roas,
    storeAggs,
    monthlyGoal,
    monthToDateRevenue,
    dayOfMonth,
    daysInMonth,
  } = inputs;

  // Fallback: no data yet today.
  if (revenue <= 0 && roas <= 0) {
    return 'עוד אין נתונים להיום. הלייב יתעדכן אוטומטית כשהקמפיינים מתחילים לרוץ.';
  }

  // Lead clause — always present.
  const lead = `היום עשית CAD ${fmtCurrency(revenue)} מכירות ב-ROAS של ${fmtRoas(roas)}x`;

  // Pace clause — present iff a monthly goal is set.
  let paceClause = '';
  if (monthlyGoal != null && monthlyGoal > 0 && daysInMonth > 0) {
    // Pace = where MTD revenue "should" be to hit the target by month-end.
    const targetPace = (monthlyGoal * dayOfMonth) / daysInMonth;
    const ahead = monthToDateRevenue >= targetPace;
    const pct = targetPace > 0
      ? Math.round(Math.abs(monthToDateRevenue - targetPace) / targetPace * 100)
      : 0;
    paceClause = ahead
      ? ` — ${pct}% מעל יעד הקצב החודשי`
      : ` — ${pct}% מתחת ליעד הקצב החודשי`;
  }

  // Top-store clause — present iff at least one store has positive revenue.
  let topStoreClause = '';
  const withRevenue = storeAggs.filter(s => s.revenue > 0);
  if (withRevenue.length > 0) {
    const top = withRevenue.reduce((a, b) => (b.revenue > a.revenue ? b : a));
    topStoreClause = `; ${top.store} מובילה היום.`;
  } else {
    topStoreClause = '.';
  }

  return `${lead}${paceClause}${topStoreClause}`;
}
