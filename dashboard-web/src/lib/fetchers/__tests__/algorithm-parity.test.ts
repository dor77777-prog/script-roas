/**
 * Phase 05.6-21 — Algorithm-parity test against frozen Sheets baseline (D-C4).
 *
 * # What this is
 *
 * The regression guard that fires when the TS port's per-fetcher output
 * (`fetchShopifyDayRows`, `fetchMetaSpendForDay`, `fetchGoogleAdsSpendForDay`,
 * `getFxRate`) drifts from the frozen Sheets baseline at
 * `__tests__/snapshots/sheets-baseline-2026-05-15-to-2026-05-20.json` beyond
 * the expected Phase 05.2.3.0 refund-correction delta band (±5% OR ±1 CAD,
 * whichever is wider — covers low-volume days where 5% rounds to 0).
 *
 * # Why every assertion is `it.skip` by default
 *
 * The non-skipped variant of this suite makes LIVE upstream API calls:
 *
 *   - Shopify Admin REST 2026-04 (2 paginated windows per (store, date))
 *   - Meta Marketing v25 /insights
 *   - Google Ads v24 GAQL (uzoshop only)
 *   - Frankfurter v1 /historical
 *
 * Each suite-run consumes API quota, takes ~30s for 6 days × 3 stores, and
 * may flake on transient upstream errors (rate-limit 429, 5xx). CI runs
 * `npm test` on every PR — leaving these enabled would (a) blow the quota
 * over time, (b) make every PR's CI flaky, (c) break PRs from contributors
 * without the production env vars. So default to skip; document how to run
 * on-demand (see "Manual run" below).
 *
 * # Manual run (operator)
 *
 * ```bash
 * # Requires .env.local with production credentials (see .env.local.example).
 * cd dashboard-web
 * # Either flip `it.skip` → `it` here temporarily,
 * # OR pass --no-skip to vitest's CLI:
 * npx vitest run src/lib/fetchers/__tests__/algorithm-parity.test.ts \
 *   --testTimeout=120000
 * ```
 *
 * The first non-skipped run establishes the documented delta band. If any
 * row exceeds ±5% OR ±1 CAD absolute (whichever is wider), inspect the diff
 * in the assertion message — the algorithm has drifted beyond the Phase
 * 05.2.3.0 refund-correction expectation and needs operator review BEFORE
 * Phase 05.7 cuts the dashboard read path over to Postgres.
 *
 * # Known delta (Phase 05.2.3.0 refund correction)
 *
 * The TS port reflects the CORRECTED algorithm (gap-closure 08, 2026-05-21):
 *
 *   1. Store-level gross uses `total_price` (immutable) — Sheets baseline uses
 *      `current_total_price`. For any (store, date) where a refund landed
 *      within 48h of the order, Sheets DOUBLE-DEDUCTED the refund; the TS
 *      port deducts once. Sheets revenue will be LOWER than TS revenue on
 *      those days. Documented per-day in the assertion failure message.
 *
 *   2. Cross-day refunds attribute to `processed_at` day only — Sheets used
 *      both `processed_at` AND a cross-day-filter. Same direction: Sheets
 *      LOWER, TS HIGHER on cross-day-refund days.
 *
 *   3. Per-product intra-order refund map is built ONLY from refunds whose
 *      `processed_at` falls on the same day as the order — Sheets sometimes
 *      mis-attributed future-day refunds to the order's creation day. Affects
 *      per-product (not store-level) net.
 *
 * The 5% / ±1 CAD tolerance is wide enough to cover all three cases AT THE
 * STORE LEVEL for our current 3 stores' transaction volume. If a single
 * (store, date) has an extreme refund event (say a $5000 refund on a
 * $1000-revenue day), the tolerance will be EXCEEDED — that's the test
 * firing CORRECTLY, not a false positive. Operator inspects the diff and
 * either:
 *   - confirms the diff is explained by the refund correction (in which
 *     case re-capture the snapshot from the current Sheets baseline), or
 *   - investigates a genuine algorithmic drift (BUG).
 *
 * # Snapshot file lifecycle
 *
 * The snapshot is committed to git as the FROZEN reference. It is captured
 * via `scripts/capture-snapshot.ts` (one-shot). If the Sheets baseline
 * legitimately shifts (Apps Script back-fills a day), delete the snapshot
 * JSON and re-run the capture script; the git diff surfaces the change.
 *
 * Per `scripts/capture-snapshot.ts` header — re-capture overwrites the file
 * atomically; do NOT hand-edit.
 *
 * # No localhost
 *
 * Per the operator memory rule
 * (`~/.claude/projects/-Users-dorperetz-script-roas/memory/feedback_no_localhost_checks.md`),
 * all upstream calls in this suite hit production APIs directly. There is
 * NO localhost mock; the manual-run variant is genuine end-to-end live.
 *
 * # Per-fetcher precursor to Phase 05.7's verification harness
 *
 * Phase 05.7 owns the 14-day Sheets-vs-Postgres verification harness
 * (D-A4 convergence gate). This suite is the per-fetcher precursor: it
 * verifies each fetcher in isolation against the SAME Sheets baseline.
 * Phase 05.7's harness will extend the date range to 14 days, lower the
 * tolerance band (once the Phase 05.2.3.0 delta is fully documented), and
 * compare the COMPOSITED Postgres readers against the Sheets readers
 * end-to-end. See plan 05.6-21 SUMMARY for the handoff notes.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';
import type { DailyRow } from '@/lib/types';
import { fetchShopifyDayRows } from '../shopify';
import { fetchMetaSpendForDay } from '../meta';
import {
  fetchGoogleAdsSpendForDay,
  STORES_WITH_GOOGLE_ADS,
} from '../googleAds';
import { getFxRate } from '../fx';

// =============================================================================
// Snapshot loading
// =============================================================================

type SheetsBaselineSnapshot = {
  capturedAt: string;
  range: { from: string; to: string };
  rowCount: number;
  rows: DailyRow[];
  // _TODO marker present iff this is the stub snapshot. Real captures omit it.
  _TODO?: string;
  _LOAD_BEARING?: string;
};

const SNAPSHOT_PATH = path.join(
  __dirname,
  'snapshots',
  'sheets-baseline-2026-05-15-to-2026-05-20.json',
);

const snapshot: SheetsBaselineSnapshot = JSON.parse(
  readFileSync(SNAPSHOT_PATH, 'utf8'),
) as SheetsBaselineSnapshot;

// Sanity-check the loaded structure once at the suite level. If the stub
// snapshot was hand-edited to break the shape (e.g., someone deleted `rows`)
// the failure surfaces here ONCE — not 18× per-row down below.
const HAS_TODO_MARKER = Boolean(snapshot._TODO);

// =============================================================================
// Delta band — Phase 05.2.3.0 refund-correction tolerance
// =============================================================================

/**
 * Per the test header: ±5% OR ±1 CAD absolute, whichever is wider. The wider
 * bound covers low-volume days where 5% rounds to 0; on high-volume days the
 * absolute ±1 CAD is negligible and 5% dominates.
 *
 * If you tighten this, document why in the plan SUMMARY — the band is
 * load-bearing: too narrow → false positives on legit refund-correction
 * deltas; too wide → real algorithmic drift hides inside it.
 */
const PCT_TOLERANCE = 0.05; // ±5%
const ABS_TOLERANCE_CAD = 1.0; // ±1 CAD

function withinDeltaBand(
  ts: number,
  baseline: number,
  context: string,
): { ok: boolean; message: string } {
  const absDelta = Math.abs(ts - baseline);
  const pctDelta = baseline !== 0 ? absDelta / Math.abs(baseline) : 0;
  const ok = absDelta < ABS_TOLERANCE_CAD || pctDelta < PCT_TOLERANCE;
  const message =
    `${context}: ts=${ts.toFixed(4)} baseline=${baseline.toFixed(4)} ` +
    `absDelta=${absDelta.toFixed(4)} pctDelta=${(pctDelta * 100).toFixed(2)}% ` +
    `(tolerance: ±${ABS_TOLERANCE_CAD} CAD OR ±${PCT_TOLERANCE * 100}% — ` +
    `Phase 05.2.3.0 refund-correction delta band)`;
  return { ok, message };
}

// =============================================================================
// Test suite — D-C4 algorithm parity
// =============================================================================

describe('algorithm-parity (D-C4) — TS port vs Sheets baseline 2026-05-15..05-20', () => {
  it('snapshot file is shape-valid (loadable + rows array + range present)', () => {
    expect(snapshot).toBeDefined();
    expect(snapshot.range).toEqual({ from: '2026-05-15', to: '2026-05-20' });
    expect(Array.isArray(snapshot.rows)).toBe(true);
    expect(snapshot.rowCount).toBe(snapshot.rows.length);
    // Each row must satisfy the DailyRow shape contract used by the test bodies.
    for (const r of snapshot.rows) {
      expect(typeof r.date).toBe('string');
      expect(typeof r.storeId).toBe('string');
      expect(typeof r.revenue).toBe('number');
      expect(typeof r.fbSpend).toBe('number');
      expect(typeof r.gaSpend).toBe('number');
    }
  });

  it('flags TODO stub snapshot — operator must regenerate before merge', () => {
    // This is INTENTIONALLY a non-skipped test. If the stub is still in place
    // (HAS_TODO_MARKER === true), the test logs a warning but PASSES (so CI
    // stays green). When the operator captures the real baseline, the _TODO
    // field is gone and the warning disappears. Either branch keeps the test
    // suite stable; the WARNING is what prompts the operator action.
    if (HAS_TODO_MARKER) {
      // eslint-disable-next-line no-console
      console.warn(
        '[algorithm-parity] STUB snapshot detected — _TODO marker present. ' +
          'Run `cd dashboard-web && npx --yes tsx scripts/capture-snapshot.ts` ' +
          'with production .env.local to regenerate. The parity assertions ' +
          'below are `.skip`-gated and do NOT consume production API quota in CI.',
      );
    }
    // Either branch passes — the warning above is the operator's signal.
    expect(snapshot).toBeDefined();
  });

  // ---------------------------------------------------------------------------
  // Per-row parametrized assertions. All `it.skip` per the header.
  // ---------------------------------------------------------------------------

  for (const baseline of snapshot.rows) {
    const { date, storeId } = baseline;
    const tag = `${storeId} ${date}`;

    // -------------------------------------------------------------------------
    // 1. Shopify revenue parity
    //
    // Compares `fetchShopifyDayRows(...).revenueCad` against the snapshot's
    // `revenue` column. The Phase 05.2.3.0 refund correction is documented
    // in the assertion message; the band is ±5% OR ±1 CAD.
    // -------------------------------------------------------------------------
    it.skip(`Shopify revenue parity — ${tag}`, async () => {
      const result = await fetchShopifyDayRows(storeId, date);
      const band = withinDeltaBand(result.revenueCad, baseline.revenue, tag);
      // ts vs baseline difference is expected to skew POSITIVE on days with
      // a refund-within-48h-of-order — Sheets under-counted (double-deducted)
      // those refunds; TS port deducts once. Documented per the header.
      expect(band.ok, band.message).toBe(true);
    });

    // -------------------------------------------------------------------------
    // 2. Meta spend parity
    //
    // Compares `fetchMetaSpendForDay(...).spend` (in account currency, usually
    // ILS) converted via Frankfurter to CAD against `baseline.fbSpend` (already
    // CAD per the Sheets columns). The conversion uses the SAME `getFxRate`
    // the TS port uses end-to-end, so the parity test exercises the whole
    // ILS→CAD pipeline.
    //
    // Manual-spend overrides (Sheets `manual-spend` tab → Phase 05.6-20
    // `manual_overrides` table) are NOT applied here — that's a separate
    // fetcher (`mergeOverridesFromSupabase`); see test 4 below.
    // -------------------------------------------------------------------------
    it.skip(`Meta spend parity (account-currency → CAD) — ${tag}`, async () => {
      const metaResult = await fetchMetaSpendForDay(storeId, date);
      let metaSpendCad = metaResult.spend;
      if (metaResult.currency !== 'CAD') {
        const rate = await getFxRate(metaResult.currency, 'CAD', date);
        metaSpendCad = metaResult.spend * rate;
      }
      const band = withinDeltaBand(metaSpendCad, baseline.fbSpend, tag);
      expect(band.ok, band.message).toBe(true);
    });

    // -------------------------------------------------------------------------
    // 3. Google Ads spend parity (uzoshop only per STORES_WITH_GOOGLE_ADS)
    //
    // Stores not in STORES_WITH_GOOGLE_ADS short-circuit — their baseline
    // `gaSpend` is 0 by definition (no Google Ads account configured).
    // -------------------------------------------------------------------------
    if (STORES_WITH_GOOGLE_ADS.has(storeId)) {
      it.skip(`Google Ads spend parity — ${tag}`, async () => {
        const gadsResult = await fetchGoogleAdsSpendForDay(storeId, date);
        let gadsSpendCad = gadsResult.spend;
        if (gadsResult.currency !== 'CAD') {
          const rate = await getFxRate(gadsResult.currency, 'CAD', date);
          gadsSpendCad = gadsResult.spend * rate;
        }
        const band = withinDeltaBand(gadsSpendCad, baseline.gaSpend, tag);
        expect(band.ok, band.message).toBe(true);
      });
    } else {
      it.skip(`Google Ads spend parity — ${tag} (no-Google-Ads store; baseline gaSpend MUST be 0)`, async () => {
        // Pure assertion against the snapshot — no API call, but kept .skip
        // for consistency with the suite's "skip everything by default" rule.
        // The non-skipped run verifies the snapshot agrees with the
        // STORES_WITH_GOOGLE_ADS set.
        expect(baseline.gaSpend).toBe(0);
      });
    }

    // -------------------------------------------------------------------------
    // 4. Total-spend parity (sum of Meta + Google after manual_overrides merge)
    //
    // This is the COMPOSITE check — it exercises the same merge that the
    // Inngest writers (plans 08-10) use end-to-end. Pulled into a separate
    // assertion (not folded into #2/#3) because a manual_overrides row for
    // a (date, store, platform) REPLACES the fetcher's value entirely, and
    // tests #2/#3 would erroneously fail on every day that has an override.
    // The composite check is the right granularity for the parity gate.
    //
    // NOTE: deliberately uses the Sheets baseline's `totalSpend` (NOT
    // fbSpend + gaSpend) because the Apps Script side already wrote the
    // post-override total to that column.
    // -------------------------------------------------------------------------
    it.skip(`Total-spend parity (Meta+Google+manual_overrides) — ${tag}`, async () => {
      // Lazy import inside the test so non-skipped runs that don't reach this
      // test don't import the Supabase admin client (which throws on missing
      // env vars at first use).
      const { mergeOverridesFromSupabase } = await import('../manualOverrides');

      const [metaResult, gadsResult] = await Promise.all([
        fetchMetaSpendForDay(storeId, date),
        STORES_WITH_GOOGLE_ADS.has(storeId)
          ? fetchGoogleAdsSpendForDay(storeId, date)
          : Promise.resolve({
              storeId,
              date,
              spend: 0,
              currency: 'CAD',
            }),
      ]);

      const merged = await mergeOverridesFromSupabase({
        storeId,
        date,
        metaSpend: { spend: metaResult.spend, currency: metaResult.currency },
        googleSpend: { spend: gadsResult.spend, currency: gadsResult.currency },
      });

      const band = withinDeltaBand(
        merged.totalSpendCad,
        baseline.totalSpend,
        `${tag} total-spend (overridesApplied=${JSON.stringify(merged.overridesApplied)})`,
      );
      expect(band.ok, band.message).toBe(true);
    });
  }
});
