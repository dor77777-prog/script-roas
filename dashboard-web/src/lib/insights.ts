import { pushCloudKey, type StateKey } from './cloudSync';

/**
 * Insights engine — pure analytics, no React.
 *
 * Generates three kinds of signals from the dashboard's raw data:
 *
 *  1. **Anomalies** — statistically unusual single-day moves on a metric.
 *     Uses a robust z-score against the trailing 14-day baseline so big
 *     historical days don't suppress today's signal.
 *
 *  2. **Recommendations** — actionable suggestions backed by simple rules
 *     ("scale this", "pause that", "investigate", "reallocate"). Each
 *     recommendation carries a `confidence` and a `why` so the user can
 *     trust the suggestion without re-running the math.
 *
 *  3. **Forecasts** — straight-line projection of where each KPI is headed
 *     by month-end given the current pace.
 *
 * Severity ladder, lowest → highest priority:
 *   info → positive → opportunity → warning → critical
 *
 * Everything is locale-agnostic; UI components handle Hebrew translation.
 */

import type { DailyRow } from './types';
import type { ProductRow } from './products';
import type { CampaignRow } from './campaigns';
import { COGS_RATE_OF_REVENUE } from './analytics';

export type Severity = 'critical' | 'warning' | 'opportunity' | 'positive' | 'info';

export type Insight = {
  id: string;
  severity: Severity;
  /** "anomaly" / "recommendation" / "forecast" — used for grouping. */
  kind: 'anomaly' | 'recommendation' | 'forecast' | 'highlight';
  /** Headline — one short sentence. */
  title: string;
  /** One-line explanation in plain language. */
  detail: string;
  /** Optional: the data behind the call. Used in tooltips. */
  why?: string;
  /** Optional: clickable destination (an Ads Manager URL, etc.). */
  href?: string;
  /** Optional: a tag like "uzoshop", "Meta", "Campaign X" for filtering. */
  scope?: string;
  /** Sort order helper. */
  weight: number;
};

// ============================================================================
// Helpers
// ============================================================================

function todayInIsrael(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Jerusalem',
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());
}

function addDays(dateStr: string, n: number): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

function mad(values: number[], med: number): number {
  if (values.length === 0) return 0;
  return median(values.map(v => Math.abs(v - med)));
}

// ============================================================================
// Anomaly detection
// ============================================================================

/**
 * Robust z-score (median / MAD) for the LAST data point in a series.
 * Returns 0 when there isn't enough history (< 7 prior days) or MAD is 0.
 */
function robustZScore(series: number[]): number {
  if (series.length < 8) return 0;
  const baseline = series.slice(-15, -1); // last 14 days BEFORE today
  if (baseline.length < 7) return 0;
  const med = median(baseline);
  const m = mad(baseline, med);
  if (m === 0) return 0;
  const x = series[series.length - 1];
  // 1.4826 makes MAD a consistent estimator of std for normal data
  return (x - med) / (1.4826 * m);
}

function detectMetricAnomalies(
  rows: DailyRow[],
  scope: string,
): Insight[] {
  const insights: Insight[] = [];
  if (rows.length < 8) return insights;
  const today = rows[rows.length - 1];
  const todayDate = today.date;

  // Build series per metric
  const revenue = rows.map(r => r.revenue);
  const spend = rows.map(r => r.totalSpend);
  const roas = rows.map(r => (r.totalSpend > 0 ? r.revenue / r.totalSpend : 0));

  // Revenue spike / drop
  const zRev = robustZScore(revenue);
  if (Math.abs(zRev) >= 2.5) {
    const isUp = zRev > 0;
    insights.push({
      id: `${scope}-rev-${todayDate}`,
      severity: isUp ? 'positive' : 'critical',
      kind: 'anomaly',
      scope,
      title: isUp
        ? `הכנסות חריגות גבוהות ב-${scope}`
        : `צניחה חריגה בהכנסות ב-${scope}`,
      detail: `הכנסות היום: CAD ${Math.round(today.revenue).toLocaleString('he-IL')}`,
      why: `z-score ${zRev.toFixed(1)} מול חציון 14 ימים. סטטיסטית חריג.`,
      weight: isUp ? 75 : 95,
    });
  }

  // Spend spike (the more interesting case)
  const zSpend = robustZScore(spend);
  if (zSpend >= 2.5) {
    insights.push({
      id: `${scope}-spend-${todayDate}`,
      severity: 'warning',
      kind: 'anomaly',
      scope,
      title: `הוצאת פרסום חריגה ב-${scope}`,
      detail: `הוצאה היום: CAD ${Math.round(today.totalSpend).toLocaleString('he-IL')}`,
      why: `z-score ${zSpend.toFixed(1)} מול חציון 14 ימים. בדוק שאין budget runaway.`,
      weight: 85,
    });
  }

  // ROAS sustained drop — last 3 days all below 2.0 AND below trailing average
  if (rows.length >= 8) {
    const last3 = roas.slice(-3);
    const allBelow = last3.every(r => r > 0 && r < 2.0);
    if (allBelow) {
      const baseline = roas.slice(-15, -3).filter(r => r > 0);
      const baselineAvg = baseline.length > 0
        ? baseline.reduce((s, x) => s + x, 0) / baseline.length
        : 0;
      if (baselineAvg > 2.2) {
        insights.push({
          id: `${scope}-roas-streak-${todayDate}`,
          severity: 'critical',
          kind: 'anomaly',
          scope,
          title: `ROAS נמוך 3 ימים ברצף ב-${scope}`,
          detail: `ממוצע 3 ימים אחרונים ${(last3.reduce((s, x) => s + x, 0) / 3).toFixed(2)}, ממוצע 14 ימים קודמים ${baselineAvg.toFixed(2)}.`,
          why: `שלושה ימים ברצף עם ROAS < 2.0, הירידה משמעותית מהבסיס.`,
          weight: 90,
        });
      }
    }
  }

  // Zero-revenue day with non-zero spend — a wasted day
  if (today.totalSpend > 50 && today.revenue === 0) {
    insights.push({
      id: `${scope}-dead-day-${todayDate}`,
      severity: 'critical',
      kind: 'anomaly',
      scope,
      title: `יום אבוד ב-${scope}`,
      detail: `הוצאת CAD ${Math.round(today.totalSpend).toLocaleString('he-IL')} בלי מכירות.`,
      why: `הוצאה גבוהה (>CAD 50) ביום עם 0 הכנסות.`,
      weight: 98,
    });
  }

  return insights;
}

/** Per-store anomaly detection — runs the metric scan on each store's rows. */
export function detectAnomalies(rows: DailyRow[]): Insight[] {
  const today = todayInIsrael();
  // Limit to last 21 days so the baseline doesn't drift across major regime changes.
  const cutoff = addDays(today, -20);
  const recent = rows.filter(r => r.date >= cutoff);

  const byStore = new Map<string, DailyRow[]>();
  for (const r of recent) {
    if (!byStore.has(r.storeName)) byStore.set(r.storeName, []);
    byStore.get(r.storeName)!.push(r);
  }

  const insights: Insight[] = [];
  for (const [storeName, list] of byStore) {
    list.sort((a, b) => a.date.localeCompare(b.date));
    insights.push(...detectMetricAnomalies(list, storeName));
  }
  return insights.sort((a, b) => b.weight - a.weight);
}

// ============================================================================
// Recommendations
// ============================================================================

function adsManagerLink(platform: string, campaignId: string): string | null {
  if (!campaignId) return null;
  if (platform === 'Meta') {
    return `https://business.facebook.com/adsmanager/manage/ads?selected_campaign_ids=${encodeURIComponent(campaignId)}`;
  }
  if (platform === 'Google') {
    return `https://ads.google.com/aw/campaigns?campaignId=${encodeURIComponent(campaignId)}`;
  }
  return null;
}

export function generateRecommendations(
  campaigns: CampaignRow[],
  products: ProductRow[],
  rows: DailyRow[],
): Insight[] {
  const today = todayInIsrael();
  const lookback = addDays(today, -13); // last 14 days
  const insights: Insight[] = [];

  // ---- Campaign-level ------------------------------------------------------
  type CAgg = {
    campaignId: string;
    campaignName: string;
    storeName: string;
    platform: string;
    spend: number;
    value: number;
    conversions: number;
    impressions: number;
    clicks: number;
    activeDays: Set<string>;
  };
  const cAgg = new Map<string, CAgg>();
  for (const c of campaigns) {
    if (c.date < lookback) continue;
    const k = `${c.storeName}::${c.platform}::${c.campaignId}`;
    if (!cAgg.has(k)) {
      cAgg.set(k, {
        campaignId: c.campaignId,
        campaignName: c.campaignName,
        storeName: c.storeName,
        platform: c.platform,
        spend: 0, value: 0, conversions: 0, impressions: 0, clicks: 0,
        activeDays: new Set(),
      });
    }
    const e = cAgg.get(k)!;
    e.spend += c.spend;
    e.value += c.conversionValue;
    e.conversions += c.conversions;
    e.impressions += c.impressions;
    e.clicks += c.clicks;
    if (c.spend > 0) e.activeDays.add(c.date);
  }

  const cList = Array.from(cAgg.values()).map(c => ({
    ...c,
    roas: c.spend > 0 ? c.value / c.spend : 0,
    daysActive: c.activeDays.size,
  }));

  // SCALE: high ROAS + meaningful spend → consider increasing budget
  const scaleCandidates = cList
    .filter(c => c.spend >= 200 && c.daysActive >= 7 && c.roas >= 3.5)
    .sort((a, b) => b.spend * b.roas - a.spend * a.roas)
    .slice(0, 3);
  for (const c of scaleCandidates) {
    insights.push({
      id: `rec-scale-${c.campaignId}`,
      severity: 'opportunity',
      kind: 'recommendation',
      scope: `${c.platform} · ${c.storeName}`,
      title: `הגדל תקציב ל-${c.campaignName || 'קמפיין ללא שם'}`,
      detail: `ROAS ${c.roas.toFixed(2)} ב-${c.daysActive} ימים. שווה לבדוק העלאת תקציב 20-30%.`,
      why: `הוצאה ${Math.round(c.spend).toLocaleString('he-IL')} CAD יצרה ערך ${Math.round(c.value).toLocaleString('he-IL')} CAD לאורך ${c.daysActive} ימים — מצביע על קמפיין יציב ובעל פוטנציאל לסקייל.`,
      href: adsManagerLink(c.platform, c.campaignId) ?? undefined,
      weight: 70 + Math.min(20, c.roas * 4),
    });
  }

  // PAUSE: significant spend + low ROAS → consider pausing/optimizing
  const pauseCandidates = cList
    .filter(c => c.spend >= 150 && c.daysActive >= 5 && c.roas > 0 && c.roas < 1.5)
    .sort((a, b) => b.spend - a.spend)
    .slice(0, 3);
  for (const c of pauseCandidates) {
    insights.push({
      id: `rec-pause-${c.campaignId}`,
      severity: 'warning',
      kind: 'recommendation',
      scope: `${c.platform} · ${c.storeName}`,
      title: `שקול לעצור/לשפר את ${c.campaignName || 'קמפיין ללא שם'}`,
      detail: `ROAS ${c.roas.toFixed(2)} עם הוצאה ${Math.round(c.spend).toLocaleString('he-IL')} CAD ב-${c.daysActive} ימים.`,
      why: `קמפיין יציב אבל לא משתלם — מחזיר פחות מ-CAD על כל CAD שהוצא.`,
      href: adsManagerLink(c.platform, c.campaignId) ?? undefined,
      weight: 80,
    });
  }

  // ZERO CONVERSIONS: spent meaningful money, no conversions
  const deadCandidates = cList
    .filter(c => c.spend >= 100 && c.conversions === 0 && c.daysActive >= 4)
    .sort((a, b) => b.spend - a.spend)
    .slice(0, 2);
  for (const c of deadCandidates) {
    insights.push({
      id: `rec-zero-${c.campaignId}`,
      severity: 'critical',
      kind: 'recommendation',
      scope: `${c.platform} · ${c.storeName}`,
      title: `${c.campaignName || 'קמפיין'} ללא המרות`,
      detail: `הוצאת CAD ${Math.round(c.spend).toLocaleString('he-IL')} ב-${c.daysActive} ימים בלי המרה אחת.`,
      why: `${c.clicks} קליקים, ${c.impressions.toLocaleString('he-IL')} חשיפות, 0 המרות — בדוק את הלנדינג פייג', הקהל, או הקריאייטיב.`,
      href: adsManagerLink(c.platform, c.campaignId) ?? undefined,
      weight: 92,
    });
  }

  // PLATFORM REBALANCE: meta vs google relative ROAS at store level
  type PAgg = { spend: number; value: number };
  const platformPerStore = new Map<string, Map<string, PAgg>>();
  for (const c of cList) {
    if (!platformPerStore.has(c.storeName)) platformPerStore.set(c.storeName, new Map());
    const p = platformPerStore.get(c.storeName)!;
    if (!p.has(c.platform)) p.set(c.platform, { spend: 0, value: 0 });
    const e = p.get(c.platform)!;
    e.spend += c.spend;
    e.value += c.value;
  }
  for (const [store, perPlatform] of platformPerStore) {
    if (perPlatform.size < 2) continue;
    const entries = Array.from(perPlatform.entries()).map(([p, agg]) => ({
      platform: p,
      ...agg,
      roas: agg.spend > 0 ? agg.value / agg.spend : 0,
    }));
    entries.sort((a, b) => b.roas - a.roas);
    const top = entries[0];
    const bot = entries[entries.length - 1];
    if (top.roas > 0 && bot.roas > 0 && top.roas / bot.roas >= 1.6 &&
        top.spend >= 200 && bot.spend >= 200) {
      insights.push({
        id: `rec-rebalance-${store}`,
        severity: 'opportunity',
        kind: 'recommendation',
        scope: store,
        title: `שקול להעביר תקציב מ-${bot.platform} ל-${top.platform} ב-${store}`,
        detail: `${top.platform} ROAS ${top.roas.toFixed(2)}, ${bot.platform} ROAS ${bot.roas.toFixed(2)} — פער של ${((top.roas / bot.roas - 1) * 100).toFixed(0)}%.`,
        why: `מבחן הקצאת תקציב: ${bot.platform} מקבל CAD ${Math.round(bot.spend).toLocaleString('he-IL')} ב-14 ימים אבל מחזיר ROAS נמוך משמעותית. נסה לחתוך 20% מהפלטפורמה החלשה והעבר לחזקה.`,
        weight: 65,
      });
    }
  }

  // ---- Product-level ------------------------------------------------------
  type ProdAgg = { title: string; store: string; units: number; revenue: number; days: Set<string> };
  const pAgg = new Map<string, ProdAgg>();
  for (const p of products) {
    if (p.date < lookback) continue;
    const k = `${p.storeName}::${p.productId || p.productTitle}`;
    if (!pAgg.has(k)) {
      pAgg.set(k, { title: p.productTitle, store: p.storeName, units: 0, revenue: 0, days: new Set() });
    }
    const e = pAgg.get(k)!;
    e.units += p.units;
    e.revenue += p.revenue;
    if (p.units > 0) e.days.add(p.date);
  }

  // Star products: top 3 by units in the period
  const productList = Array.from(pAgg.values()).sort((a, b) => b.units - a.units);
  if (productList.length > 0) {
    const star = productList[0];
    insights.push({
      id: `rec-star-product`,
      severity: 'positive',
      kind: 'highlight',
      scope: star.store,
      title: `המוצר המוביל: ${star.title}`,
      detail: `${star.units.toLocaleString('he-IL')} יחידות, CAD ${Math.round(star.revenue).toLocaleString('he-IL')} ב-14 ימים אחרונים.`,
      why: `המוצר עם הכי הרבה יחידות בכל החנויות. שקול קמפיינים ייעודיים או הגדלת מלאי.`,
      weight: 60,
    });
  }

  // ---- Store underperformance ---------------------------------------------
  // For each store: aggregate 14d and compare its ROAS to the multi-store avg.
  const storeAgg = new Map<string, { rev: number; spend: number }>();
  for (const r of rows) {
    if (r.date < lookback) continue;
    if (!storeAgg.has(r.storeName)) storeAgg.set(r.storeName, { rev: 0, spend: 0 });
    const e = storeAgg.get(r.storeName)!;
    e.rev += r.revenue;
    e.spend += r.totalSpend;
  }
  const storeRoas = Array.from(storeAgg.entries()).map(([s, a]) => ({
    store: s,
    roas: a.spend > 0 ? a.rev / a.spend : 0,
    spend: a.spend,
  }));
  if (storeRoas.length >= 2) {
    const totalSpend = storeRoas.reduce((s, x) => s + x.spend, 0);
    const totalRev = Array.from(storeAgg.values()).reduce((s, x) => s + x.rev, 0);
    const blendRoas = totalSpend > 0 ? totalRev / totalSpend : 0;
    for (const sr of storeRoas) {
      if (sr.spend < 200) continue;
      if (sr.roas > 0 && blendRoas > 0 && sr.roas < blendRoas * 0.7) {
        insights.push({
          id: `rec-store-${sr.store}`,
          severity: 'warning',
          kind: 'recommendation',
          scope: sr.store,
          title: `${sr.store} מתחת לממוצע הכללי`,
          detail: `ROAS ${sr.roas.toFixed(2)} מול ממוצע משוקלל ${blendRoas.toFixed(2)} בכל החנויות.`,
          why: `הוצאה של CAD ${Math.round(sr.spend).toLocaleString('he-IL')} ב-14 ימים אחרונים. בדוק קמפיינים פעילים, יחסי המרה, וקריאייטיב.`,
          weight: 75,
        });
      }
    }
  }

  return insights.sort((a, b) => b.weight - a.weight);
}

// ============================================================================
// Forecasting
// ============================================================================

/**
 * Linear extrapolation to end-of-current-month, blending the last 7-day daily
 * average. Returns the projected total + days remaining.
 */
export function forecastMonthEnd(rows: DailyRow[]): {
  daysElapsedThisMonth: number;
  daysRemainingThisMonth: number;
  monthToDateRevenue: number;
  monthToDateSpend: number;
  monthToDateNet: number;
  dailyAvgRevenue: number;
  projectedRevenue: number;
  projectedSpend: number;
  projectedNet: number;
  projectedRoas: number;
} {
  const today = todayInIsrael();
  const [yStr, mStr] = today.split('-');
  const year = parseInt(yStr, 10);
  const month = parseInt(mStr, 10);
  const monthStart = `${yStr}-${mStr}-01`;
  const daysInMonth = new Date(year, month, 0).getDate();
  const todayDay = parseInt(today.slice(-2), 10);
  const daysElapsed = todayDay;
  const daysRemaining = daysInMonth - daysElapsed;

  // Month-to-date totals across all stores
  let mtdRev = 0, mtdSpend = 0, mtdCogs = 0;
  for (const r of rows) {
    if (r.date >= monthStart && r.date <= today) {
      mtdRev += r.revenue;
      mtdSpend += r.totalSpend;
      mtdCogs += r.cogs;
    }
  }
  const mtdNet = mtdRev - mtdSpend - mtdCogs;

  // 7-day average for projection
  const sevenDaysAgo = addDays(today, -6);
  let last7Rev = 0, last7Spend = 0;
  let last7DaysCount = 0;
  const datesSeen = new Set<string>();
  for (const r of rows) {
    if (r.date >= sevenDaysAgo && r.date <= today) {
      last7Rev += r.revenue;
      last7Spend += r.totalSpend;
      datesSeen.add(r.date);
    }
  }
  last7DaysCount = Math.max(1, datesSeen.size);

  const dailyAvgRev = last7Rev / last7DaysCount;
  const dailyAvgSpend = last7Spend / last7DaysCount;
  const projectedRev = mtdRev + dailyAvgRev * daysRemaining;
  const projectedSpend = mtdSpend + dailyAvgSpend * daysRemaining;
  // COGS_RATE_OF_REVENUE is the single source of truth for COGS-as-% of
  // revenue, mirrored in Apps Script Config.gs (see analytics.ts docstring).
  const projectedNet = projectedRev - projectedSpend - projectedRev * COGS_RATE_OF_REVENUE;
  const projectedRoas = projectedSpend > 0 ? projectedRev / projectedSpend : 0;

  return {
    daysElapsedThisMonth: daysElapsed,
    daysRemainingThisMonth: daysRemaining,
    monthToDateRevenue: mtdRev,
    monthToDateSpend: mtdSpend,
    monthToDateNet: mtdNet,
    dailyAvgRevenue: dailyAvgRev,
    projectedRevenue: projectedRev,
    projectedSpend: projectedSpend,
    projectedNet: projectedNet,
    projectedRoas,
  };
}

// ============================================================================
// Goal tracking
// ============================================================================

const GOAL_STORAGE_KEY: StateKey = 'roas-dashboard:monthly-revenue-goal';

export function readGoal(): number | null {
  if (typeof window === 'undefined') return null;
  try {
    const v = window.localStorage.getItem(GOAL_STORAGE_KEY);
    if (!v) return null;
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? n : null;
  } catch {
    return null;
  }
}

export function writeGoal(value: number | null) {
  if (typeof window === 'undefined') return;
  try {
    // Audit fix 2026-05-23 (CC-01): writeGoal is always invoked from an
    // explicit "שמור" button click — there is no debounced typing path
    // for the monthly goal. Pass `immediate: true` so pushCloudKey fires
    // the POST synchronously instead of the 400ms debounce. Without this,
    // an operator who saves the goal and refreshes the tab within the
    // debounce window would lose the value: the timer was scheduled but
    // never fired before unload, and the next hydrate (after refresh)
    // overwrites localStorage with the still-stale cloud value.
    if (value === null || value <= 0) {
      window.localStorage.removeItem(GOAL_STORAGE_KEY);
      pushCloudKey(GOAL_STORAGE_KEY, null, { immediate: true });
    } else {
      window.localStorage.setItem(GOAL_STORAGE_KEY, String(value));
      pushCloudKey(GOAL_STORAGE_KEY, value, { immediate: true });
    }
    window.dispatchEvent(new CustomEvent('roas-goal-changed'));
  } catch {
    /* ignore */
  }
}

export type PacingStatus = 'ahead' | 'on-pace' | 'behind' | 'unknown';

export function computePacing(
  goal: number | null,
  mtd: number,
  daysElapsed: number,
  daysInMonth: number,
): {
  goal: number | null;
  progress: number; // 0..1+
  expected: number;
  expectedPct: number;
  status: PacingStatus;
} {
  if (!goal || goal <= 0) {
    return { goal: null, progress: 0, expected: 0, expectedPct: 0, status: 'unknown' };
  }
  const progress = mtd / goal;
  const expected = (daysElapsed / daysInMonth) * goal;
  const expectedPct = daysElapsed / daysInMonth;
  let status: PacingStatus;
  if (mtd >= expected * 1.05) status = 'ahead';
  else if (mtd >= expected * 0.92) status = 'on-pace';
  else status = 'behind';
  return { goal, progress, expected, expectedPct, status };
}

// ============================================================================
// Insight state: "done" / "ignored" — user actions, persisted to localStorage.
// ============================================================================

const INSIGHT_STATES_KEY: StateKey = 'roas-dashboard:insight-states';
/** When a "done" insight returns to view if its underlying condition still
 *  holds. 7 days is the sweet spot: long enough to feel like "I handled it",
 *  short enough that a reappearing problem doesn't stay hidden forever. */
const DONE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
/** Forget any state older than this. Keeps the storage clean over years. */
const STATE_GC_MS = 90 * 24 * 60 * 60 * 1000;

export type InsightStateKind = 'done' | 'ignored';

export type InsightStateEntry = {
  state: InsightStateKind;
  /** ms epoch when the action was taken. */
  at: number;
  /** Optional snapshot of the title for the "restore" UI, in case the
   *  underlying insight is no longer present at the time the user
   *  decides to restore. */
  title?: string;
};

export type InsightStates = Record<string, InsightStateEntry>;

export function readInsightStates(): InsightStates {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(INSIGHT_STATES_KEY);
    if (!raw) return {};
    const parsed: InsightStates = JSON.parse(raw);
    // Drop anything older than the GC window.
    const now = Date.now();
    let dirty = false;
    for (const [k, v] of Object.entries(parsed)) {
      if (!v || typeof v.at !== 'number' || now - v.at > STATE_GC_MS) {
        delete parsed[k];
        dirty = true;
      }
    }
    if (dirty) {
      window.localStorage.setItem(INSIGHT_STATES_KEY, JSON.stringify(parsed));
    }
    return parsed;
  } catch {
    return {};
  }
}

export function writeInsightStates(states: InsightStates) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(INSIGHT_STATES_KEY, JSON.stringify(states));
    window.dispatchEvent(new CustomEvent('roas-insight-states-changed'));
    pushCloudKey(INSIGHT_STATES_KEY, states);
  } catch {
    /* storage quota / private mode: silently ignore */
  }
}

/**
 * Visibility rule for an insight given its persisted state:
 *  - no state     → visible
 *  - "ignored"    → hidden until manually restored
 *  - "done" < 7d  → hidden (user just handled it)
 *  - "done" ≥ 7d  → visible again (condition may have returned)
 */
export function isInsightVisible(
  id: string,
  states: InsightStates,
  now: number = Date.now(),
): boolean {
  const s = states[id];
  if (!s) return true;
  if (s.state === 'ignored') return false;
  if (s.state === 'done') return now - s.at > DONE_TTL_MS;
  return true;
}

// ============================================================================
// All-in-one: combine everything for the InsightsBoard
// ============================================================================

export function buildAllInsights(
  rows: DailyRow[],
  campaigns: CampaignRow[],
  products: ProductRow[],
): Insight[] {
  const anomalies = detectAnomalies(rows);
  const recs = generateRecommendations(campaigns, products, rows);
  return [...anomalies, ...recs].sort((a, b) => b.weight - a.weight);
}
