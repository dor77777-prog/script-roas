/**
 * Wave 2 — pure customer-value compute (retention / LTV curve / repeat /
 * payback) over the customer_cohort_monthly aggregate (CohortMonthlyRow[], one
 * cell per store × first_order_month × month_since, 0..11).
 *
 * Mirrors the newCustomerMetrics.ts adapter conventions:
 *  - MAPPING-AWARE by construction: spend is NEVER recomputed from raw account
 *    totals — `spendByMonth` (per cohort-month) and `blendedNcac` (headline) are
 *    passed in by the caller (the same agg.spend the rest of the dashboard uses).
 *  - Pooled / M0-weighted across cohorts: per month_since we sum net (or active
 *    customers) across all in-scope cohorts and divide by the total M0-active
 *    count — an M0-weighted average, not a naive per-cohort mean.
 *  - Profit is computed AT RENDER: profit[m] = net[m] × (1 − cogsPct − feesRate)
 *    using the editable COGS% (`cogsPctByMonth`) + the constant fees rate, the
 *    same helpers as the P&L. Profit is never baked into the table.
 *  - LTV maturity gate: ltv12 (cumulative at M11) is restricted to MATURE
 *    cohorts only — first_order_month ≥ 12 whole months before `todayMonth`.
 *    Younger cohorts still feed the visible curve but cannot define the
 *    12-month LTV (they have no M11 data yet).
 *
 * CAPI-safe: Shopify-only aggregate; no PII; never emits pixel/CAPI events.
 */
import { monthsBetween } from '@/lib/cohorts/cohortAggregate';
import { getTodayInIsraelTz } from '@/lib/dateRange';
import { DEFAULT_COGS_PCT } from '@/lib/cogsSettings';
import type { CohortMonthlyRow } from '@/lib/postgresReaders';

/** 12-month horizon (M0..M11) — matches the cohort table cap. */
export const COHORT_HORIZON = 12;
/** A cohort is "mature" once it is this many whole months old (full 12mo seen). */
export const MATURE_MONTHS = 12;

export interface CustomerValueOpts {
  /** Revenue (net) or profit basis for the cumulative curve + LTV headline. */
  basis: 'net' | 'profit';
  /** Constant transaction-fees fraction (0..1) — only applied in profit basis. */
  feesRate: number;
  /**
   * Editable COGS fraction (0..1) per cohort first-order-month ('YYYY-MM').
   * Looked up by cohort month; falls back to `defaultCogsPct`. Profit basis only.
   */
  cogsPctByMonth?: Record<string, number>;
  /** COGS fraction (0..1) for any cohort month missing from cogsPctByMonth. */
  defaultCogsPct?: number;
  /**
   * Mapping-aware spend (CAD) per cohort first-order-month. Per-cohort nCAC is
   * derived ONLY for months present here (the ad-spend history is May-2026+), so
   * pre-May cohorts surface a muted "no spend data" state. NEVER recomputed.
   */
  spendByMonth?: Record<string, number>;
  /**
   * Current blended nCAC (CAD) from Wave-1 computeNewCustomerMetrics — the
   * honest, always-available headline acquisition cost used for payback +
   * LTV:nCAC. null when there is no spend history at all.
   */
  blendedNcac: number | null;
  /** Optional store-name scope (filters rows by storeId). */
  storeName?: string;
  /** 'YYYY-MM' reference month for the maturity gate. Default = today (IL tz). */
  todayMonth?: string;
}

export interface CohortNcac {
  firstOrderMonth: string;
  /** spendByMonth[fom] ÷ cohort M0 size; null when no spend for the month. */
  nCac: number | null;
}

/** Early-LTV (first-3-months) cumulative curve in BOTH bases for one cohort half. */
export interface EarlyLtvHalf {
  /** cumNet[0..2] (M0-weighted, 3 points). */
  net: number[];
  /** cumProfit[0..2] = net × keep-rate (M0-weighted, 3 points). profit ≤ net. */
  profit: number[];
}

export interface NewVsOld {
  /** Early-LTV (net + profit) for the most-recent half of cohorts. */
  recent: EarlyLtvHalf;
  /** Early-LTV (net + profit) for the older half of cohorts. */
  old: EarlyLtvHalf;
}

export interface CustomerValue {
  /** retention[m] = Σ active at m ÷ Σ M0 (0..1), indexed 0..11. */
  retention: number[];
  /** Per-customer cumulative NET LTV curve (M0..M11), pooled / M0-weighted. */
  cumulativeNet: number[];
  /** Per-customer cumulative PROFIT curve (M0..M11) = net × keep-rate. */
  cumulativeProfit: number[];
  /** Net LTV at M11 over mature cohorts; null when no mature cohort exists. */
  ltv12Net: number | null;
  /** Profit LTV at M11 over mature cohorts; null when no mature cohort exists. */
  ltv12Profit: number | null;
  /** Share of cohort customers with ≥1 order after M0 (capped at 1). */
  repeatRate: number;
  /** Recent-vs-old early-LTV comparison (cumNet + cumProfit [0..2] per half). */
  newVsOld: NewVsOld;
  /** Per-cohort nCAC (null where spend is unavailable — pre-May). */
  cohortNcac: CohortNcac[];
  /** Echo of the headline blended nCAC (CAD), or null. */
  blendedNcac: number | null;
  /**
   * First month_since where cumulative profit ≥ blendedNcac; null when nCAC is
   * null or the curve never reaches it.
   */
  paybackMonths: number | null;
  /** ltv12Profit ÷ blendedNcac; null when either is null/≤0. */
  ltvToNcac: number | null;
}

/** Months a cohort (first-order 'YYYY-MM') has aged vs the reference month. */
function cohortAgeMonths(firstOrderMonth: string, todayMonth: string): number {
  return monthsBetween(firstOrderMonth, todayMonth);
}

/**
 * Pooled / M0-weighted cumulative-net curve (per customer) over a set of cells,
 * plus the per-month-since pooled retention. Returns 12-length arrays.
 */
function pooledCurve(cells: CohortMonthlyRow[]): {
  retention: number[];
  cumulativeNet: number[];
  perMonthNet: number[];
  m0Active: number;
  repeatActive: number;
} {
  const perMonthNet = new Array(COHORT_HORIZON).fill(0);
  const perMonthActive = new Array(COHORT_HORIZON).fill(0);
  for (const c of cells) {
    const m = c.monthSince;
    if (m < 0 || m >= COHORT_HORIZON) continue;
    perMonthNet[m] += Number.isFinite(c.netCad) ? c.netCad : 0;
    perMonthActive[m] += Number.isFinite(c.activeCustomers) ? c.activeCustomers : 0;
  }
  const m0Active = perMonthActive[0];
  const retention = perMonthActive.map((a) => (m0Active > 0 ? a / m0Active : 0));
  const cumulativeNet = new Array(COHORT_HORIZON).fill(0);
  let run = 0;
  for (let m = 0; m < COHORT_HORIZON; m++) {
    run += perMonthNet[m];
    cumulativeNet[m] = m0Active > 0 ? run / m0Active : 0;
  }
  // Customers active in any month after M0 (aggregate proxy, capped downstream).
  let repeatActive = 0;
  for (let m = 1; m < COHORT_HORIZON; m++) repeatActive += perMonthActive[m];
  return { retention, cumulativeNet, perMonthNet, m0Active, repeatActive };
}

/** keep-rate (0..1) for a cohort month under the profit basis. */
function keepRate(month: string, opts: CustomerValueOpts): number {
  const cogs =
    opts.cogsPctByMonth?.[month] ??
    opts.defaultCogsPct ??
    DEFAULT_COGS_PCT / 100;
  const fees = Number.isFinite(opts.feesRate) ? opts.feesRate : 0;
  return Math.max(0, 1 - cogs - fees);
}

/**
 * Pooled / M0-weighted cumulative-PROFIT curve (per customer) over a set of
 * cells. Each cell's net is scaled by its cohort-month keep-rate then re-bucketed
 * by months-since (keep-rate is per cohort-month, not per months-since), and the
 * running sum is divided by the set's M0-active count — the exact profit
 * re-bucketing the whole-curve block uses, factored out so the new-vs-old halves
 * compute profit identically. Returns a 12-length array.
 */
function pooledProfitCurve(cells: CohortMonthlyRow[], opts: CustomerValueOpts): number[] {
  const perMonthProfit = new Array(COHORT_HORIZON).fill(0);
  let m0Active = 0;
  for (const c of cells) {
    const m = c.monthSince;
    if (m < 0 || m >= COHORT_HORIZON) continue;
    const net = Number.isFinite(c.netCad) ? c.netCad : 0;
    perMonthProfit[m] += net * keepRate(c.firstOrderMonth, opts);
    if (m === 0) m0Active += Number.isFinite(c.activeCustomers) ? c.activeCustomers : 0;
  }
  const cumulative = new Array(COHORT_HORIZON).fill(0);
  let run = 0;
  for (let m = 0; m < COHORT_HORIZON; m++) {
    run += perMonthProfit[m];
    cumulative[m] = m0Active > 0 ? run / m0Active : 0;
  }
  return cumulative;
}

export function computeCustomerValue(
  rows: CohortMonthlyRow[],
  opts: CustomerValueOpts,
): CustomerValue {
  const todayMonth = opts.todayMonth ?? getTodayInIsraelTz().slice(0, 7);
  const scoped = opts.storeName
    ? rows.filter((r) => r.storeId === opts.storeName)
    : rows;

  // ── Whole-curve (all in-scope cohorts) ──────────────────────────────────
  const all = pooledCurve(scoped);
  const retention = all.retention;
  const cumulativeNet = all.cumulativeNet;

  // Profit curve: each month's pooled net is scaled by that cohort-month's
  // keep-rate, then re-pooled. Because keep-rate is per cohort-month (not per
  // months-since), we re-bucket net-after-cost by months-since.
  const cumulativeProfit = pooledProfitCurve(scoped, opts);

  // repeatRate — aggregate proxy: Σ active(m≥1) ÷ Σ M0, capped at 1.
  const repeatRate = all.m0Active > 0 ? Math.min(1, all.repeatActive / all.m0Active) : 0;

  // ── Mature-only LTV (cohorts ≥ 12 whole months old) ─────────────────────
  const matureCells = scoped.filter(
    (r) => cohortAgeMonths(r.firstOrderMonth, todayMonth) >= MATURE_MONTHS,
  );
  const hasMature = matureCells.length > 0;
  const mature = pooledCurve(matureCells);
  const ltv12Net = hasMature ? mature.cumulativeNet[COHORT_HORIZON - 1] : null;
  let ltv12Profit: number | null = null;
  if (hasMature) {
    const mProfit = new Array(COHORT_HORIZON).fill(0);
    for (const c of matureCells) {
      const m = c.monthSince;
      if (m < 0 || m >= COHORT_HORIZON) continue;
      const net = Number.isFinite(c.netCad) ? c.netCad : 0;
      mProfit[m] += net * keepRate(c.firstOrderMonth, opts);
    }
    let run = 0;
    for (let m = 0; m < COHORT_HORIZON; m++) run += mProfit[m];
    ltv12Profit = mature.m0Active > 0 ? run / mature.m0Active : null;
  }

  // ── new vs old (early-LTV split on cohort months) ───────────────────────
  const months = [...new Set(scoped.map((r) => r.firstOrderMonth))].sort();
  const half = Math.ceil(months.length / 2);
  const oldMonths = new Set(months.slice(0, months.length - half));
  const recentMonths = new Set(months.slice(months.length - half));
  const oldCells = scoped.filter((r) => oldMonths.has(r.firstOrderMonth));
  const recentCells = scoped.filter((r) => recentMonths.has(r.firstOrderMonth));
  const oldCurve = pooledCurve(oldCells);
  const recentCurve = pooledCurve(recentCells);
  // Carry BOTH bases so the new-vs-veteran card uses the ACTIVE basis (profit by
  // default) — consistent with the headline LTV + the curve. profit ≤ net.
  const newVsOld: NewVsOld = {
    recent: {
      net: recentCurve.cumulativeNet.slice(0, 3),
      profit: pooledProfitCurve(recentCells, opts).slice(0, 3),
    },
    old: {
      net: oldCurve.cumulativeNet.slice(0, 3),
      profit: pooledProfitCurve(oldCells, opts).slice(0, 3),
    },
  };

  // ── per-cohort nCAC (only for spend-available months) ───────────────────
  const m0ByMonth = new Map<string, number>();
  for (const c of scoped) {
    if (c.monthSince === 0) {
      m0ByMonth.set(c.firstOrderMonth, (m0ByMonth.get(c.firstOrderMonth) ?? 0) + (Number.isFinite(c.activeCustomers) ? c.activeCustomers : 0));
    }
  }
  const cohortNcac: CohortNcac[] = months.map((fom) => {
    const spend = opts.spendByMonth?.[fom];
    const m0 = m0ByMonth.get(fom) ?? 0;
    const nCac = spend != null && Number.isFinite(spend) && m0 > 0 ? spend / m0 : null;
    return { firstOrderMonth: fom, nCac };
  });

  // ── payback + LTV:nCAC (headline, blended) ──────────────────────────────
  const blendedNcac =
    opts.blendedNcac != null && Number.isFinite(opts.blendedNcac) ? opts.blendedNcac : null;
  let paybackMonths: number | null = null;
  if (blendedNcac != null) {
    for (let m = 0; m < COHORT_HORIZON; m++) {
      if (cumulativeProfit[m] >= blendedNcac) {
        paybackMonths = m;
        break;
      }
    }
  }
  const ltvToNcac =
    blendedNcac != null && blendedNcac > 0 && ltv12Profit != null
      ? ltv12Profit / blendedNcac
      : null;

  return {
    retention,
    cumulativeNet,
    cumulativeProfit,
    ltv12Net,
    ltv12Profit,
    repeatRate,
    newVsOld,
    cohortNcac,
    blendedNcac,
    paybackMonths,
    ltvToNcac,
  };
}
