/**
 * Shared smart-analysis helper for CPM-vs-ROAS overlay charts.
 *
 * Used by the CampaignDrawer CPM chart and the CampaignsTable expandable
 * CPM chart. Both charts let the user toggle a ROAS line on top of the
 * CPM line; the analysis box below summarizes what the two curves are
 * doing together (correlation + trend) in plain Hebrew.
 *
 * The interpretation logic is intentionally conservative:
 *   - Needs >= 5 days of data to draw any "trend" conclusion
 *   - Pearson correlation with explicit small-N guard so a noisy 3-day
 *     run doesn't produce a confident "highly correlated" statement
 *   - Threshold-based trend detection (first-half mean vs second-half
 *     mean) instead of regression slope, because the chart user reads
 *     "the second half" naturally
 *
 * Returns a single short sentence plus a tone hint so the UI can render
 * the box in the right color (positive / neutral / negative).
 */

/**
 * Minimum number of active days (cpm>0 AND roas>0) required in the
 * previous-period series for analyzeCpmVsRoas to actually use it as a
 * baseline. Below this threshold the analyzer falls back to
 * mode='half-over-half'.
 *
 * IN-08 (5.2.2.1): exported so the FIX-19 fallback banner copy in
 * CampaignsTable.tsx and CampaignDrawer.tsx can interpolate the same
 * number it gates on. Previously the banner text hardcoded "3" and
 * the analyzer hardcoded `prevSeries.length >= 3` — two literals that
 * could drift independently.
 */
export const PREV_PERIOD_MIN_DAYS = 3;

export type DailyCpmRoasPoint = {
  date: string;
  cpm: number;
  roas: number;
};

/**
 * c/CR-01 (audit-2026-05-23-v2): align a CPM previous-period series to the
 * current-period series by **calendar offset** (days from each window's
 * `from`) rather than by surviving-array INDEX.
 *
 * The bug this guards against: both `cpmDaily` and `cpmDailyPrev` are
 * pre-filtered to drop zero-impression days. If current has 12 active days
 * and prev has 14, naive `prev[i]` pairing aligns "current day 7" with
 * "prev day 7" — which can be off by several calendar days. The dashed
 * overlay then visually warps every operator decision about "vs previous
 * period."
 *
 * This helper indexes the prev series by `days-from-prevRange.from`. The
 * caller then walks the current series and asks for the matching offset.
 * Missing days stay null (Recharts breaks the line with `connectNulls={false}`).
 *
 * Pure function — no side effects, safe to memoize on inputs.
 */
export function indexPrevByDateOffset<T extends { date: string }>(
  prevSeries: ReadonlyArray<T> | null | undefined,
  prevRangeFrom: string,
): Map<number, T> {
  const out = new Map<number, T>();
  if (!prevSeries) return out;
  const prevPeriodStart = new Date(prevRangeFrom + 'T00:00:00Z').getTime();
  for (const p of prevSeries) {
    const offsetDays = Math.round(
      (new Date(p.date + 'T00:00:00Z').getTime() - prevPeriodStart) / 86400000,
    );
    out.set(offsetDays, p);
  }
  return out;
}

/**
 * Companion to `indexPrevByDateOffset`: given a current-period date and the
 * current-period start, return the days-from-current-start offset. Caller
 * uses that offset to look up the prev-period point that fell on the same
 * relative calendar day.
 */
export function dayOffsetFromRangeStart(date: string, rangeFrom: string): number {
  const rangeStart = new Date(rangeFrom + 'T00:00:00Z').getTime();
  return Math.round(
    (new Date(date + 'T00:00:00Z').getTime() - rangeStart) / 86400000,
  );
}

export type CpmRoasVerdict =
  /** CPM trend × ROAS trend produced a normal up/down/flat read. */
  | 'normal'
  /**
   * Audit fix 2026-05-24 (U-02): havePrev=true but the prev period
   * had no usable baseline (all-zero CPMs after filtering, or means
   * that landed at 0). Pre-fix the analyzer silently mapped both
   * null deltas to 'flat' → "יציבות מלאה" copy, which lied to the
   * operator (the campaign had no comparison baseline, not a stable
   * one). Now we surface this as an explicit verdict and emit
   * "אין בסיס השוואה" copy with neutral tone.
   */
  | 'no-baseline';

export type CpmRoasAnalysis = {
  /** Short Hebrew summary sentence the UI renders verbatim. */
  text: string;
  /** Visual tone: positive (green), warning (amber), negative (red),
   *  neutral (gray). Drives the analysis-box background. */
  tone: 'positive' | 'warning' | 'negative' | 'neutral';
  /** When false (e.g. < 5 days, all-zero ROAS), the UI can hide the
   *  analysis block entirely instead of showing a placeholder. */
  hasData: boolean;
  /** Which baseline the analysis compared against — drives the small
   *  "השוואה: ..." label the UI shows above the analysis box. */
  mode: 'half-over-half' | 'previous-period';
  /**
   * Verdict the analyzer reached. Most calls land at 'normal' — only
   * the U-02 "queried-but-no-baseline" edge case returns 'no-baseline'.
   * Surfaced so downstream tooltips can render verdict-specific copy
   * without parsing the text field.
   */
  verdict: CpmRoasVerdict;
  /** Diagnostics for tooltips / debugging — not surfaced in production
   *  UI by default. */
  details: {
    n: number;
    cpmDeltaPct: number | null;
    roasDeltaPct: number | null;
    pearson: number | null;
  };
};

/**
 * Pearson correlation with zero-variance + small-N guards. Returns null
 * when either series has fewer than 3 points OR has zero variance — the
 * caller treats null as "no signal".
 */
export function pearsonForCpmRoas(a: number[], b: number[]): number | null {
  const n = Math.min(a.length, b.length);
  if (n < 3) return null;
  let sumA = 0;
  let sumB = 0;
  for (let i = 0; i < n; i++) {
    sumA += a[i];
    sumB += b[i];
  }
  const meanA = sumA / n;
  const meanB = sumB / n;
  let cov = 0;
  let varA = 0;
  let varB = 0;
  for (let i = 0; i < n; i++) {
    const da = a[i] - meanA;
    const db = b[i] - meanB;
    cov += da * db;
    varA += da * da;
    varB += db * db;
  }
  if (varA === 0 || varB === 0) return null;
  return cov / Math.sqrt(varA * varB);
}

/**
 * Compares the mean of the second half of a series to the mean of the
 * first half. Returns the relative change as a fraction (0.12 = +12%).
 * Falls back to null when the first-half mean is 0 (avoids divide by
 * zero) or n < 4.
 */
function halfOverHalfDelta_(values: number[]): number | null {
  if (values.length < 4) return null;
  const mid = Math.floor(values.length / 2);
  const firstHalf = values.slice(0, mid);
  const secondHalf = values.slice(mid);
  const meanFirst = firstHalf.reduce((s, x) => s + x, 0) / firstHalf.length;
  const meanSecond = secondHalf.reduce((s, x) => s + x, 0) / secondHalf.length;
  if (meanFirst === 0) return null;
  return (meanSecond - meanFirst) / meanFirst;
}

/** Threshold for "stable" — changes smaller than this are considered noise. */
const STABLE_THRESHOLD = 0.05; // 5%

/**
 * Build the analysis sentence from the daily series. Handles the
 * common combinations:
 *
 *   CPM trend   ROAS trend   Verdict
 *   ----------  -----------  -----------------------------------------
 *   up          up           יעיל למרות עלות גבוהה — תקציב משתלם
 *   up          down         הוצאה גוברת עם תשואה נופלת — דורש בחינה
 *   up          flat         CPM עולה אבל ROAS יציב — לחץ אוקציה ללא השפעה
 *   down        up           הצלחה — חשיפות זולות עם תשואה גבוהה
 *   down        down         ROAS נופל גם כשהCPM יורד — בעיה לא-אוקציונית
 *   down        flat         חיסכון בלי שינוי בתשואה — שיפור יעילות
 *   flat        up           יציבות עם שיפור — אופטימיזציה משתפרת
 *   flat        down         יציבות עם החמרה — בעיה בקריאייטיב/audience
 *   flat        flat         יציבות מלאה — הקמפיין במצב סטדי
 */
/**
 * Mean of an array, or null when empty / sum is 0 (used to skip zero
 * baselines that would cause divide-by-zero in delta math).
 */
function meanOrNull_(values: number[]): number | null {
  if (values.length === 0) return null;
  const sum = values.reduce((s, x) => s + x, 0);
  if (sum === 0) return null;
  return sum / values.length;
}

export function analyzeCpmVsRoas(
  series: DailyCpmRoasPoint[],
  options?: { prev?: DailyCpmRoasPoint[] },
): CpmRoasAnalysis {
  // FIX-25 (5.2.2.1): "active day" = the campaign actually ran (impressions
  // and spend produced a CPM). We DO NOT require roas > 0 — a day that ran
  // but produced no conversions is still a meaningful data point (it tells
  // us CPM at that ROAS=0). The previous `roas > 0` requirement made the
  // analyzer fall back to half-over-half too eagerly: any campaign that
  // didn't convert on every day in its prev period would trip the FIX-19
  // banner, even though prev had plenty of impression data. The Pearson
  // zero-variance guard already handles the degenerate case where all
  // ROAS values are 0 (returns null, which categorize() maps to "flat").
  const validRows = series.filter(d => d.cpm > 0);
  const n = validRows.length;
  const prevSeries = (options?.prev ?? []).filter(d => d.cpm > 0);
  const havePrev = prevSeries.length >= PREV_PERIOD_MIN_DAYS;
  const mode: 'half-over-half' | 'previous-period' = havePrev ? 'previous-period' : 'half-over-half';
  // Audit fix 2026-05-24 (U-02): the caller queried a baseline but it
  // came back empty/short. Common operator scenario: a campaign in its
  // launch week. The prev-period series exists in the caller's data
  // (it queried Postgres for the matching window) but every row has
  // cpm=0 (the campaign wasn't running yet), so the cpm>0 filter strips
  // it. Pre-fix the analyzer silently degraded to half-over-half mode
  // and the operator never knew their "השוואה: תקופה קודמת" toggle had
  // nothing to compare against — the half-over-half result LOOKED like
  // a previous-period read. We track the intent here so the no-baseline
  // verdict below can fire even when the filter has already dropped all
  // prev rows. `prevWasQueriedButEmpty` distinguishes "caller passed
  // nothing" (no toggle was used) from "caller passed a prev but it
  // was empty" (the case we surface).
  const prevWasQueriedButEmpty =
    Array.isArray(options?.prev) && options!.prev!.length > 0 && !havePrev;

  // Not enough data → return a "neutral" placeholder.
  if (n < 5) {
    return {
      text: 'צריך לפחות 5 ימים פעילים (עם חשיפות והוצאה) כדי לסיק מסקנה. הגרף ימשיך להציג, הניתוח יופיע כשיהיה מספיק היסטוריה.',
      tone: 'neutral',
      hasData: false,
      mode,
      verdict: 'normal',
      details: { n, cpmDeltaPct: null, roasDeltaPct: null, pearson: null },
    };
  }

  const cpms = validRows.map(d => d.cpm);
  const roases = validRows.map(d => d.roas);
  const r = pearsonForCpmRoas(cpms, roases);

  // Baseline selection:
  //   - When the caller passes prev (a previous-period series with >= 3
  //     valid days), we compare current-period MEAN to prev-period MEAN.
  //     This is the conventional "vs last period" baseline matching the
  //     Hero KPI deltas.
  //   - Otherwise, fall back to half-over-half within the current range
  //     so the user still gets a momentum read on shorter spans.
  let cpmDelta: number | null;
  let roasDelta: number | null;
  if (havePrev) {
    const curCpmMean = meanOrNull_(cpms);
    const prevCpmMean = meanOrNull_(prevSeries.map(d => d.cpm));
    cpmDelta = curCpmMean !== null && prevCpmMean !== null && prevCpmMean !== 0
      ? (curCpmMean - prevCpmMean) / prevCpmMean
      : null;
    const curRoasMean = meanOrNull_(roases);
    const prevRoasMean = meanOrNull_(prevSeries.map(d => d.roas));
    roasDelta = curRoasMean !== null && prevRoasMean !== null && prevRoasMean !== 0
      ? (curRoasMean - prevRoasMean) / prevRoasMean
      : null;
  } else {
    cpmDelta = halfOverHalfDelta_(cpms);
    roasDelta = halfOverHalfDelta_(roases);
  }

  // ─────────────────────────────────────────────────────────────────────
  // Audit fix 2026-05-24 (U-02): emit 'no-baseline' verdict instead of
  // silently degrading the read.
  //
  // Two reachable triggers:
  //
  //   (1) prevWasQueriedButEmpty — the caller PASSED options.prev
  //       (toggled "השוואה: תקופה קודמת") but every row had cpm=0, so
  //       the filter stripped all of it. Common launch-week scenario:
  //       campaign in its first active period, prev window has 0
  //       impressions because the campaign hadn't started yet. Pre-fix
  //       the analyzer silently downgraded mode to half-over-half and
  //       the operator never knew their "prev" toggle had nothing to
  //       compare against — the half-over-half result LOOKED like a
  //       previous-period read.
  //
  //   (2) havePrev && both deltas null — the prev series survived the
  //       filter but means / divisor math collapsed (e.g. a future
  //       meanOrNull_ refactor makes this reachable, or the cpm filter
  //       changes). Defensive: emit honest copy instead of the
  //       categorize() default of 'flat' which would trip the
  //       FLAT+FLAT branch with the misleading "יציבות מלאה" copy.
  //
  // The mode field shows 'previous-period' in case (2) (havePrev=true)
  // and 'half-over-half' in case (1) (prev got filtered out). The
  // verdict is the truthful signal — downstream consumers (tooltips,
  // the operator-facing copy) should branch on verdict rather than mode.
  if (
    prevWasQueriedButEmpty ||
    (havePrev && cpmDelta === null && roasDelta === null)
  ) {
    return {
      text: 'אין בסיס השוואה — לתקופה הקודמת אין נתונים תקפים להשוואה. הקמפיין כנראה לא רץ אז (או לא היו לו חשיפות), אז לא ניתן לסיק מגמה.',
      tone: 'neutral',
      hasData: true,
      mode,
      verdict: 'no-baseline',
      details: { n, cpmDeltaPct: null, roasDeltaPct: null, pearson: null },
    };
  }

  function categorize(delta: number | null): 'up' | 'down' | 'flat' {
    if (delta === null) return 'flat';
    if (delta > STABLE_THRESHOLD) return 'up';
    if (delta < -STABLE_THRESHOLD) return 'down';
    return 'flat';
  }

  const cpmDir = categorize(cpmDelta);
  const roasDir = categorize(roasDelta);

  const cpmPct = cpmDelta !== null ? Math.round(cpmDelta * 100) : 0;
  const roasPct = roasDelta !== null ? Math.round(roasDelta * 100) : 0;

  // Optional correlation flavor — only when |r| > 0.5 and we have enough
  // points (already gated by n >= 5).
  const corrLabel =
    r === null || Math.abs(r) < 0.5 ? '' :
    r > 0 ? ' (CPM וROAS נעים יחד)' :
    ' (CPM וROAS נעים בכיוונים הפוכים)';

  let text = '';
  let tone: CpmRoasAnalysis['tone'] = 'neutral';

  // ====== UP + UP — paid more, got more
  if (cpmDir === 'up' && roasDir === 'up') {
    text = `CPM עלה ב-${cpmPct}% אבל ROAS השתפר ב-${roasPct}% — התקציב עובד קשה יותר ומחזיר יותר. כדאי לבדוק אם הגידול בCPM נובע מהגדלת תקציב יזומה או מלחץ באוקציה.${corrLabel}`;
    tone = 'positive';
  }
  // ====== UP + DOWN — danger zone
  else if (cpmDir === 'up' && roasDir === 'down') {
    text = `CPM עלה ב-${cpmPct}% וROAS ירד ב-${Math.abs(roasPct)}% — דבר רע. אתה משלם יותר על חשיפות ומקבל פחות החזר. בדוק את הקריאייטיב, audience וsetting של auction.${corrLabel}`;
    tone = 'negative';
  }
  // ====== UP + FLAT — auction pressure absorbed
  else if (cpmDir === 'up' && roasDir === 'flat') {
    text = `CPM עלה ב-${cpmPct}% אבל ROAS נשאר יציב. לחץ באוקציה לא פגע בתשואה — סימן לקריאייטיב חזק או audience ממוקד. תשומת לב לעלייה מתמשכת.${corrLabel}`;
    tone = 'warning';
  }
  // ====== DOWN + UP — best case
  else if (cpmDir === 'down' && roasDir === 'up') {
    text = `CPM ירד ב-${Math.abs(cpmPct)}% וROAS עלה ב-${roasPct}% — המצב האידיאלי. תקציב יעיל יותר ותשואה משתפרת. שווה לבדוק להגדיל תקציב כדי לרכוב על המומנטום.${corrLabel}`;
    tone = 'positive';
  }
  // ====== DOWN + DOWN — non-auction issue
  else if (cpmDir === 'down' && roasDir === 'down') {
    text = `CPM ירד ב-${Math.abs(cpmPct)}% אבל גם ROAS ירד ב-${Math.abs(roasPct)}% — חשיפות זולות לא הצילו את התשואה. הבעיה כנראה לא באוקציה אלא בקריאייטיב/audience/landing page.${corrLabel}`;
    tone = 'negative';
  }
  // ====== DOWN + FLAT — efficiency win
  else if (cpmDir === 'down' && roasDir === 'flat') {
    text = `CPM ירד ב-${Math.abs(cpmPct)}% וROAS נשאר יציב — חיסכון נטו בלי לפגוע בתשואה. אופטימיזציה טובה של תקציב.${corrLabel}`;
    tone = 'positive';
  }
  // ====== FLAT + UP — optimization win
  else if (cpmDir === 'flat' && roasDir === 'up') {
    text = `CPM יציב וROAS עלה ב-${roasPct}% — שיפור באופטימיזציה (קריאייטיב חדש? audience טוב יותר?) בלי שינוי בלחץ האוקציה.${corrLabel}`;
    tone = 'positive';
  }
  // ====== FLAT + DOWN — creative fatigue
  else if (cpmDir === 'flat' && roasDir === 'down') {
    text = `CPM יציב אבל ROAS ירד ב-${Math.abs(roasPct)}% — הקריאייטיב או audience נשחק. אותה עלות חשיפה, פחות המרות. שווה לרענן.${corrLabel}`;
    tone = 'warning';
  }
  // ====== FLAT + FLAT — steady state
  else {
    text = `CPM וROAS יציבים על פני התקופה — הקמפיין במצב סטדי. אין סיגנל לפעולה דחופה.${corrLabel}`;
    tone = 'neutral';
  }

  return {
    text,
    tone,
    hasData: true,
    mode,
    verdict: 'normal',
    details: { n, cpmDeltaPct: cpmDelta, roasDeltaPct: roasDelta, pearson: r },
  };
}
