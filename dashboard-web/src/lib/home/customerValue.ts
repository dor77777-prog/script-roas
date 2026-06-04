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
  /** Early-LTV (net + profit) for the RECENT (observed-but-young, age∈[3,12)) cohorts. */
  recent: EarlyLtvHalf;
  /** Early-LTV (net + profit) for the VETERAN (mature, age≥12) cohorts. */
  old: EarlyLtvHalf;
  /**
   * A5 — shared comparison index (0..2): min(2, recent.depth, veteran.depth).
   * The card compares recent[cmpDepth] vs old[cmpDepth] so a 3-month label is
   * always backed by the same observed depth on BOTH sides. −1 when either
   * side is empty (→ the card shows its "not enough cohorts" empty state).
   */
  cmpDepth: number;
}

export interface CustomerValue {
  /** retention[m] = Σ active at m ÷ Σ M0 (0..1), indexed 0..11. */
  retention: number[];
  /** Per-customer cumulative NET LTV curve (M0..M11), pooled / M0-weighted. */
  cumulativeNet: number[];
  /** Per-customer cumulative PROFIT curve (M0..M11) = net × keep-rate. */
  cumulativeProfit: number[];
  /**
   * Per-customer cumulative NET curve (M0..M11) over MATURE cohorts only — the
   * same basis as ltv12Net + the payback. All-zero when no mature cohort exists.
   * This is the basis the headline curve + verdict reconcile on (only mature
   * cohorts have a real 12-month value; the all-cohort curve is inflated by
   * recent cohorts' early months).
   */
  cumulativeNetMature: number[];
  /**
   * Per-customer cumulative PROFIT curve (M0..M11) over MATURE cohorts only —
   * the same basis as ltv12Profit + the payback. All-zero when no mature cohort.
   */
  cumulativeProfitMature: number[];
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
   * First month_since where the MATURE cumulative PROFIT ≥ blendedNcac; null
   * when nCAC is null, no mature cohort exists, or the mature curve never reaches
   * nCAC within the 12-month horizon. Derived on the SAME mature basis as
   * ltv12Profit + ltvToNcac, so payback ⇔ ratio ⇔ net-per-customer never
   * contradict (no "losing" + "recovers in N months" at once).
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
  /** Deepest month_since with any active customer (−1 when the set is empty). */
  depth: number;
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
  // A5 — deepest observed month_since, so the new-vs-old card compares both
  // halves at a SHARED depth (no immature half carrying M1 forward as a fake M2).
  let depth = -1;
  for (let m = COHORT_HORIZON - 1; m >= 0; m--) {
    if (perMonthActive[m] > 0) { depth = m; break; }
  }
  return { retention, cumulativeNet, perMonthNet, m0Active, repeatActive, depth };
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
 * cells. Each cell's POSITIVE net is scaled by its cohort-month keep-rate (a
 * negative net — a refund-driven loss — passes through unscaled) then re-bucketed
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
    // keep-rate scales only the POSITIVE portion (revenue minus COGS/fees). A
    // negative cohort-month net is refund-driven — COGS/fees don't shrink a
    // loss, so a loss passes through unscaled. Scaling it would lift the profit
    // curve ABOVE the net curve on refund-heavy months (smaller-magnitude
    // negative), which is wrong: profit ≤ net must hold everywhere.
    perMonthProfit[m] += net >= 0 ? net * keepRate(c.firstOrderMonth, opts) : net;
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

  // repeatRate — A6 (2026-06-04): the HONEST distinct repeat rate is
  // Σ(M0-row repeat_customers) ÷ Σ M0 (each repeater counted ONCE per cohort).
  // Use it whenever the column is populated (post-backfill); fall back to the
  // old occurrence-sum proxy (Σ active(m≥1) ÷ M0 — overstates, double-counts a
  // customer active in multiple months) for rows written before the backfill,
  // so there's no transient 0% regression between deploy and re-backfill.
  const m0Rows = scoped.filter((r) => r.monthSince === 0);
  // All-or-nothing: only use the distinct column when EVERY M0 row is populated.
  // A `some()` gate would, in a mixed backfill state, zero-fill the not-yet-
  // backfilled cohorts in the numerator while still counting their M0 in the
  // denominator → a silently understated rate. `every()` falls back to the proxy
  // until the whole scope is backfilled (matches the migration's stated intent).
  const hasRepeatCol = m0Rows.length > 0 && m0Rows.every((r) => r.repeatCustomers != null);
  const repeatRate =
    all.m0Active <= 0
      ? 0
      : hasRepeatCol
        ? Math.min(1, m0Rows.reduce((s, r) => s + (r.repeatCustomers ?? 0), 0) / all.m0Active)
        : Math.min(1, all.repeatActive / all.m0Active);

  // ── Mature-only LTV (cohorts ≥ 12 whole months old) ─────────────────────
  const matureCells = scoped.filter(
    (r) => cohortAgeMonths(r.firstOrderMonth, todayMonth) >= MATURE_MONTHS,
  );
  const hasMature = matureCells.length > 0;
  const mature = pooledCurve(matureCells);
  // Full 12-length MATURE cumulative curves — the headline curve + payback
  // reconcile on these (only mature cohorts have a real 12-month value). When no
  // mature cohort exists, pooledCurve / pooledProfitCurve return all-zero arrays.
  const cumulativeNetMature = mature.cumulativeNet;
  const cumulativeProfitMature = pooledProfitCurve(matureCells, opts);
  const ltv12Net = hasMature ? cumulativeNetMature[COHORT_HORIZON - 1] : null;
  const ltv12Profit = hasMature ? cumulativeProfitMature[COHORT_HORIZON - 1] : null;

  // ── new vs old (early-LTV, aligned to the maturity boundary) ────────────
  // A5 + B1 (2026-06-04): split by AGE, not a ceil-half of the month list, so
  // the same cohort is never both "veteran (verdict-defining)" and "recent
  // (improving)" — veteran = mature (age≥12, reuses matureCells); recent =
  // observed-but-young (age∈[3,12)). Both have ≥3 observed months by
  // construction, so comparing the first-3-months cumulative is apples-to-apples
  // (no immature cohort carrying its M1 forward as a phantom M2).
  const months = [...new Set(scoped.map((r) => r.firstOrderMonth))].sort();
  const recentCells = scoped.filter((r) => {
    const age = cohortAgeMonths(r.firstOrderMonth, todayMonth);
    return age >= 3 && age < MATURE_MONTHS;
  });
  const recentCurve = pooledCurve(recentCells);
  const cmpDepth = Math.min(
    2,
    Math.max(0, mature.depth),
    Math.max(0, recentCurve.depth),
  );
  // Carry BOTH bases so the new-vs-veteran card uses the ACTIVE basis (profit by
  // default) — consistent with the headline LTV + the curve. profit ≤ net.
  const newVsOld: NewVsOld = {
    recent: {
      net: recentCurve.cumulativeNet.slice(0, 3),
      profit: pooledProfitCurve(recentCells, opts).slice(0, 3),
    },
    old: {
      net: cumulativeNetMature.slice(0, 3),
      profit: cumulativeProfitMature.slice(0, 3),
    },
    cmpDepth: recentCurve.depth < 0 || mature.depth < 0 ? -1 : cmpDepth,
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
  // Payback is derived on the MATURE profit curve — the same basis as
  // ltv12Profit + ltvToNcac — so the verdict can never say "losing" (ratio < 1,
  // i.e. ltv12Profit < nCAC) AND "recovers in N months" at once. With no mature
  // cohort there is no honest 12-month value → payback null.
  let paybackMonths: number | null = null;
  if (blendedNcac != null && hasMature) {
    for (let m = 0; m < COHORT_HORIZON; m++) {
      if (cumulativeProfitMature[m] >= blendedNcac) {
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
    cumulativeNetMature,
    cumulativeProfitMature,
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
