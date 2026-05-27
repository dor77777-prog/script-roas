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
interface ProductRow { date: string; storeName: string; revenue: number; netRevenue: number; orders: number; }
interface CampaignRow { date: string; storeName: string; platform: string; spend: number; }
interface OrderRow { date: string; storeName: string; totalCad: number; }

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

export function reconcileWindow(input: {
  dataRows: DataRow[]; productRows: ProductRow[]; campaignRows: CampaignRow[]; ordersRows: OrderRow[];
}): Violation[] {
  const { dataRows, productRows, campaignRows, ordersRows } = input;
  const out: Violation[] = [];

  // INV-3: per-row ROAS == revenue/totalSpend
  for (const r of dataRows) {
    const expected = r.totalSpend > 0 ? r.revenue / r.totalSpend : 0;
    out.push(...agree([r.roas, expected], { label: `ROAS ${r.date}/${r.storeName}` }));
    // INV-6: totalSpend == fb+ga+tt
    out.push(...agree([r.totalSpend, r.fbSpend + r.gaSpend + r.ttSpend], { label: `platform-sum ${r.date}/${r.storeName}` }));
  }

  // INV-7: Σ campaigns_daily spend per platform ≈ data_daily platform column (cross-source)
  const dataMeta = sum(dataRows.map(r => r.fbSpend));
  const dataGoogle = sum(dataRows.map(r => r.gaSpend));
  const dataTikTok = sum(dataRows.map(r => r.ttSpend));
  const campMeta = sum(campaignRows.filter(c => c.platform === 'Meta').map(c => c.spend));
  const campGoogle = sum(campaignRows.filter(c => c.platform === 'Google').map(c => c.spend));
  const campTikTok = sum(campaignRows.filter(c => c.platform === 'TikTok').map(c => c.spend));
  if (!withinTolerance(dataMeta, campMeta)) out.push({ label: 'INV-7 Meta spend', detail: `data_daily ${dataMeta} vs campaigns_daily ${campMeta}` });
  if (!withinTolerance(dataGoogle, campGoogle)) out.push({ label: 'INV-7 Google spend', detail: `data_daily ${dataGoogle} vs campaigns_daily ${campGoogle}` });
  if (!withinTolerance(dataTikTok, campTikTok)) out.push({ label: 'INV-7 TikTok spend', detail: `data_daily ${dataTikTok} vs campaigns_daily ${campTikTok}` });

  // INV-9: Σ products revenue ≈ data_daily revenue (cross-source)
  const dataRev = sum(dataRows.map(r => r.revenue));
  const prodRev = sum(productRows.map(p => p.revenue));
  if (!withinTolerance(dataRev, prodRev)) out.push({ label: 'INV-9 product vs data revenue', detail: `data_daily ${dataRev} vs products_daily ${prodRev}` });

  // INV-10: Σ orders_attribution total ≈ data_daily revenue (cross-source)
  const orderRev = sum(ordersRows.map(o => o.totalCad));
  if (!withinTolerance(dataRev, orderRev)) out.push({ label: 'INV-10 orders vs data revenue', detail: `data_daily ${dataRev} vs orders_attribution ${orderRev}` });

  // INV-14: no NaN/Infinity in dataRows numeric fields
  for (const r of dataRows) {
    for (const [k, val] of Object.entries(r)) {
      if (typeof val === 'number' && !Number.isFinite(val)) out.push({ label: `INV-14 non-finite ${k}`, detail: `${r.date}/${r.storeName} = ${val}` });
    }
  }
  return out;
}
