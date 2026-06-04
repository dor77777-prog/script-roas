import { withinTolerance, agree, type Violation } from './reconcile';

/**
 * reconcileRows — the PURE core of the DQ-1 window reconciliation (DQ-1 pure core).
 *
 * `reconcileWindow` in ./reconcile.ts already accepts the four ALREADY-FETCHED
 * per-source payloads and compares them. This module extracts that comparison as a
 * standalone deterministic helper with an explicit, self-documenting input type so it
 * can be unit-tested / reused without dragging in any fetch/DB/React surface.
 *
 * It imports the agreed tolerance primitives `withinTolerance` (cross-source L2: ≤1%
 * OR ≤$1) and `agree` (same-source L1: spread ≤ max(1¢, 1ppm)) READ-ONLY from
 * ./reconcile.ts and returns the SAME `Violation[]` shape.
 *
 * Invariants checked (identical semantics to reconcileWindow):
 *   • INV-3   same-source ROAS == revenue/totalSpend          (per data_daily row)
 *   • INV-6   same-source totalSpend == fb+ga+tt              (per data_daily row)
 *   • INV-14  no non-finite numbers in any source row          (all sources)
 *   • INV-7   Σ campaigns_daily spend per platform ≈ data_daily column  (per cell)
 *   • INV-9   Σ products_daily NET revenue ≈ data_daily revenue         (per cell)
 *   • INV-10  Σ orders_attribution total ≈ data_daily revenue          (per cell)
 *
 * TikTok carve-out (preserved): data_daily.tt_spend is the AUTHORITATIVE account-level
 * total; campaigns_daily is a per-campaign breakdown TikTok systematically UNDER-reports.
 * So Σcampaigns ≤ data_daily is EXPECTED and must NOT flag — only an over-report
 * (Σcampaigns EXCEEDS data_daily beyond tolerance) is a genuine bug.
 */

/** One row of the data_daily payload (per date/store, store-mapping-aware). */
export interface ReconcileDataRow {
  date: string;
  storeName: string;
  fbSpend: number;
  gaSpend: number;
  ttSpend: number;
  totalSpend: number;
  revenue: number;
  roas: number;
}

/** One row of the products_daily payload (`netRevenue` null when net is absent). */
export interface ReconcileProductRow {
  date: string;
  storeName: string;
  revenue: number;
  netRevenue: number | null;
  orders: number;
}

/** One row of the campaigns_daily per-campaign breakdown. */
export interface ReconcileCampaignRow {
  date: string;
  storeName: string;
  platform: string;
  spend: number;
}

/** One row of the orders_attribution payload. */
export interface ReconcileOrderRow {
  date: string;
  storeName: string;
  totalCad: number;
}

/** The four ALREADY-FETCHED per-source row sets for one reconciliation window. */
export interface ReconcileRowsInput {
  dataRows: ReconcileDataRow[];
  productRows: ReconcileProductRow[];
  campaignRows: ReconcileCampaignRow[];
  ordersRows: ReconcileOrderRow[];
}

const sum = (xs: number[]): number => xs.reduce((a, b) => a + b, 0); // returns 0 on empty input

/** Flag any non-finite number on any row (INV-14), tagged with the row's date/store. */
function scanNonFinite(rows: ReadonlyArray<object>, source: string): Violation[] {
  const out: Violation[] = [];
  for (const row of rows) {
    const r = row as Record<string, unknown>;
    for (const [k, val] of Object.entries(r)) {
      if (typeof val === 'number' && !Number.isFinite(val)) {
        out.push({ label: `INV-14 non-finite ${source}.${k}`, detail: `${r.date}/${r.storeName} = ${val}` });
      }
    }
  }
  return out;
}

/**
 * Reconcile one fetched window of the four production payloads — pure, deterministic.
 *
 * Cross-source invariants (INV-7/9/10) are checked PER (date, store) cell so that
 * per-day or per-store discrepancies cannot cancel out in a window-wide total
 * (a false-negative trap). Returns the same `Violation[]` as `reconcileWindow`.
 */
export function reconcileRows(input: ReconcileRowsInput): Violation[] {
  const { dataRows, productRows, campaignRows, ordersRows } = input;
  const out: Violation[] = [];

  // INV-3 (same-source ROAS == revenue/totalSpend) and INV-6 (same-source totalSpend == fb+ga+tt), per data row.
  for (const r of dataRows) {
    const expected = r.totalSpend > 0 ? r.revenue / r.totalSpend : 0;
    out.push(...agree([r.roas, expected], { label: `INV-3 ROAS ${r.date}/${r.storeName}` }));

    out.push(...agree([r.totalSpend, r.fbSpend + r.gaSpend + r.ttSpend], { label: `INV-6 platform-sum ${r.date}/${r.storeName}` }));
  }

  // INV-14: no non-finite numbers in ANY source row.
  out.push(...scanNonFinite(dataRows, 'data_daily'));
  out.push(...scanNonFinite(productRows, 'products_daily'));
  out.push(...scanNonFinite(campaignRows, 'campaigns_daily'));
  out.push(...scanNonFinite(ordersRows, 'orders_attribution'));

  // Cross-source invariants per (date, store) cell.
  const cellKeys = new Set<string>();
  for (const r of [...dataRows, ...productRows, ...campaignRows, ...ordersRows]) cellKeys.add(`${r.date} ${r.storeName}`);

  for (const key of cellKeys) {
    const [date, store] = key.split(' ');
    const tag = `${date}/${store}`;
    const dRows = dataRows.filter(r => r.date === date && r.storeName === store);
    const pRows = productRows.filter(r => r.date === date && r.storeName === store);
    const cRows = campaignRows.filter(r => r.date === date && r.storeName === store);
    const oRows = ordersRows.filter(r => r.date === date && r.storeName === store);

    const dataRev = sum(dRows.map(r => r.revenue));

    // INV-7: Σ campaigns_daily spend per platform ≈ data_daily platform column.
    const dataMeta = sum(dRows.map(r => r.fbSpend));
    const dataGoogle = sum(dRows.map(r => r.gaSpend));
    const dataTikTok = sum(dRows.map(r => r.ttSpend));
    const campMeta = sum(cRows.filter(c => c.platform === 'Meta').map(c => c.spend));
    const campGoogle = sum(cRows.filter(c => c.platform === 'Google').map(c => c.spend));
    const campTikTok = sum(cRows.filter(c => c.platform === 'TikTok').map(c => c.spend));
    // Meta/Google: data_daily platform spend is the campaign-sum (the per-campaign
    // breakdown is complete), so a two-sided match is required.
    if (!withinTolerance(dataMeta, campMeta)) out.push({ label: `INV-7 Meta spend ${tag}`, detail: `data_daily ${dataMeta} vs campaigns_daily ${campMeta}` });
    if (!withinTolerance(dataGoogle, campGoogle)) out.push({ label: `INV-7 Google spend ${tag}`, detail: `data_daily ${dataGoogle} vs campaigns_daily ${campGoogle}` });
    // TikTok: data_daily.tt_spend is the AUTHORITATIVE account-level total (what TikTok
    // billed); campaigns_daily is a per-campaign breakdown that TikTok systematically
    // UNDER-reports (spend on deleted/unattributed campaigns lands in the account total
    // but not the per-campaign report). So `Σcampaigns ≤ data_daily` is EXPECTED for
    // TikTok and must NOT flag. Only flag when campaigns EXCEED data_daily beyond
    // tolerance (over-report / double-count — a genuine bug). data_daily stays the
    // source of truth for ROAS/profit.
    if (campTikTok > dataTikTok && !withinTolerance(dataTikTok, campTikTok)) out.push({ label: `INV-7 TikTok spend ${tag}`, detail: `data_daily(account-level) ${dataTikTok} vs campaigns_daily(per-campaign) ${campTikTok} — campaigns exceed account total (over-report)` });

    // INV-9: Σ products NET revenue ≈ data_daily revenue (both net of refunds). Fall back to gross only when net is absent.
    // KNOWN EXPECTED GAP (A4-01 / P1-3): null-product-id (custom-item) refunds are deducted
    // from data_daily.revenue_cad but cannot be attributed to any product bucket; the gap
    // equals customItemRefundCad. See docs/ARCHITECTURE.md §14.7.
    const prodNetRev = sum(pRows.map(p => p.netRevenue ?? p.revenue));
    if (!withinTolerance(dataRev, prodNetRev)) out.push({ label: `INV-9 product vs data revenue ${tag}`, detail: `data_daily ${dataRev} vs products_daily(net) ${prodNetRev} — note: gap may be explained by null-product-id (custom-item) refunds; see ARCHITECTURE.md §14.7` });

    // INV-10: Σ orders_attribution total ≈ data_daily revenue.
    const orderRev = sum(oRows.map(o => o.totalCad));
    if (!withinTolerance(dataRev, orderRev)) out.push({ label: `INV-10 orders vs data revenue ${tag}`, detail: `data_daily ${dataRev} vs orders_attribution ${orderRev}` });
  }

  return out;
}
