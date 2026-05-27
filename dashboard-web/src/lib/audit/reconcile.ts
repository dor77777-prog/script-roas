export interface Violation {
  label: string;
  detail: string;
  values?: Record<string, number>;
}

/** Cross-source (L2): agree if within 1% OR within $1, whichever is more lenient. */
export function withinTolerance(
  a: number,
  b: number,
  { pctTol = 0.01, absTol = 1 }: { pctTol?: number; absTol?: number } = {},
): boolean {
  const diff = Math.abs(a - b);
  if (diff <= absTol) return true;
  const denom = Math.max(Math.abs(a), Math.abs(b));
  if (denom === 0) return diff === 0;
  return diff / denom <= pctTol;
}

/** Same-source (L1): every value must match within an accounting tolerance — spread ≤ max(1¢, 1ppm of the largest magnitude). */
export function agree(
  values: number[],
  { label = 'value', eps = 0.01 }: { label?: string; eps?: number } = {},
): Violation[] {
  if (values.length < 2) return [];
  const max = Math.max(...values);
  const min = Math.min(...values);
  const tol = Math.max(eps, 1e-6 * Math.max(...values.map(Math.abs)));
  if (max - min <= tol) return [];
  return [{ label, detail: `spread ${(max - min).toFixed(4)} > tol ${tol.toFixed(4)}`, values: Object.fromEntries(values.map((v, i) => [`src${i}`, v])) }];
}

interface DataRow { date: string; storeName: string; fbSpend: number; gaSpend: number; ttSpend: number; totalSpend: number; revenue: number; roas: number; }
interface ProductRow { date: string; storeName: string; revenue: number; netRevenue: number | null; orders: number; }
interface CampaignRow { date: string; storeName: string; platform: string; spend: number; }
interface OrderRow { date: string; storeName: string; totalCad: number; }

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0); // returns 0 on empty input

/** Flag any non-finite number on any row (INV-14), tagged with the row's date/store. */
function scanNonFinite(rows: object[], source: string): Violation[] {
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
 * Reconcile one fetched window of the four production payloads.
 *
 * Cross-source invariants (INV-7/9/10) are checked PER (date, store) cell, matching the
 * agreed tolerance of "≤1% OR ≤$1 per day/store" — this prevents per-day or per-store
 * discrepancies from cancelling out in a window-wide total (a false-negative trap).
 *
 * Note: INV-9 and INV-10 both reference data_daily revenue as the anchor. If BOTH fire for
 * the same cell, suspect the data_daily figure itself rather than two independent source errors.
 */
export function reconcileWindow(input: {
  dataRows: DataRow[]; productRows: ProductRow[]; campaignRows: CampaignRow[]; ordersRows: OrderRow[];
}): Violation[] {
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
    if (!withinTolerance(dataMeta, campMeta)) out.push({ label: `INV-7 Meta spend ${tag}`, detail: `data_daily ${dataMeta} vs campaigns_daily ${campMeta}` });
    if (!withinTolerance(dataGoogle, campGoogle)) out.push({ label: `INV-7 Google spend ${tag}`, detail: `data_daily ${dataGoogle} vs campaigns_daily ${campGoogle}` });
    if (!withinTolerance(dataTikTok, campTikTok)) out.push({ label: `INV-7 TikTok spend ${tag}`, detail: `data_daily ${dataTikTok} vs campaigns_daily ${campTikTok}` });

    // INV-9: Σ products NET revenue ≈ data_daily revenue (both net of refunds). Fall back to gross only when net is absent.
    const prodNetRev = sum(pRows.map(p => p.netRevenue ?? p.revenue));
    if (!withinTolerance(dataRev, prodNetRev)) out.push({ label: `INV-9 product vs data revenue ${tag}`, detail: `data_daily ${dataRev} vs products_daily(net) ${prodNetRev}` });

    // INV-10: Σ orders_attribution total ≈ data_daily revenue.
    const orderRev = sum(oRows.map(o => o.totalCad));
    if (!withinTolerance(dataRev, orderRev)) out.push({ label: `INV-10 orders vs data revenue ${tag}`, detail: `data_daily ${dataRev} vs orders_attribution ${orderRev}` });
  }

  return out;
}
