/**
 * Phase E1.6 (2026-05-30) — shared CAD-conversion-with-FX-fail-null helper.
 *
 * Extracted from cronLive.ts:882-901 (inline implementation). Workers
 * (metaWorker/googleWorker/tiktokWorker hot_metrics account-aggregate
 * step) need identical semantics: FX failure → null → caller OMITS the
 * affected CAD column from the data_daily UPSERT payload, which
 * preserves the prior value via Supabase's payload-key-only SET clause.
 *
 * Audit fix history (carried over from cronLive's inlined version,
 * 2026-05-23 a/WARN-3): pre-fix code used `.catch(() => 1)` which
 * silently converted USD as CAD on FX outage, corrupting today's
 * spend column with raw USD numbers (~30% low). The null-preserve
 * pattern is the explicit "stale > wrong" failure mode.
 */

export type CadConvert = (
  amount: number,
  currency: string,
  dateStr: string,
) => Promise<number | null>;

/**
 * Factory: takes an FX rate fetcher and returns the conversion function.
 *
 * The factory pattern keeps the helper pure for testing (caller injects
 * a mock getRate) while letting production wire `getFxRate` once at
 * worker bind time.
 */
export function makeCadConvert(
  getRate: (from: string, to: 'CAD', dateStr: string) => Promise<number>,
): CadConvert {
  return async (amount, currency, dateStr) => {
    if (!Number.isFinite(amount)) return null;
    if (amount === 0) return 0;
    const cur = (currency || 'CAD').toUpperCase();
    if (cur === 'CAD') return amount;
    let rate: number;
    try {
      rate = await getRate(cur, 'CAD', dateStr);
    } catch {
      return null;
    }
    if (!Number.isFinite(rate) || rate <= 0) return null;
    return amount * rate;
  };
}
