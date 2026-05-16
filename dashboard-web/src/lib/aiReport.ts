import type { DailyRow } from './types';
import type { ProductRow } from './products';
import type { CampaignRow } from './campaigns';

/**
 * Generates an AI-friendly markdown report for a store × date range.
 *
 * Designed to be pasted into ChatGPT / Claude / Gemini with a follow-up
 * prompt like "Analyze and recommend optimizations". Includes:
 *   - Headline KPIs for the period
 *   - Daily breakdown (compact table)
 *   - Top products by net revenue (with margin %)
 *   - Top campaigns by ROAS, with platform-level details
 *   - All ad-sets grouped by campaign for the highest-spend campaigns
 *
 * Output is plain markdown (no fences, no HTML) so it survives copy-paste.
 */

type Params = {
  storeName: string;          // "All" or specific
  range: { from: string; to: string };
  dailyRows: DailyRow[];      // filtered by store + range upstream OR full set
  productRows: ProductRow[];
  campaignRows: CampaignRow[];
};

const fmtNum = (n: number, d = 0) =>
  new Intl.NumberFormat('he-IL', {
    minimumFractionDigits: d,
    maximumFractionDigits: d,
  }).format(n);

const fmtCad = (n: number) => `CAD ${fmtNum(Math.round(n))}`;
const fmtPct = (n: number, d = 1) => `${(n * 100).toFixed(d)}%`;
const fmtDate = (s: string) => {
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : s;
};

function inRange(d: string, r: { from: string; to: string }) {
  return d >= r.from && d <= r.to;
}

export function generateAiReport({
  storeName,
  range,
  dailyRows,
  productRows,
  campaignRows,
}: Params): string {
  const out: string[] = [];

  // Pre-filter all three datasets by range + store.
  const storeFilter = storeName === 'All' ? null : storeName;
  const daily = dailyRows.filter(
    r => inRange(r.date, range) && (!storeFilter || r.storeName === storeFilter),
  );
  const products = productRows.filter(
    r => inRange(r.date, range) && (!storeFilter || r.storeName === storeFilter),
  );
  const campaigns = campaignRows.filter(
    r => inRange(r.date, range) && (!storeFilter || r.storeName === storeFilter),
  );

  // ===== Header =====
  out.push(`# דוח ביצועים — ${storeName === 'All' ? 'כל החנויות' : storeName}`);
  out.push('');
  out.push(`**טווח**: ${fmtDate(range.from)} → ${fmtDate(range.to)}`);
  const days =
    Math.round(
      (new Date(range.to + 'T00:00:00Z').getTime() -
        new Date(range.from + 'T00:00:00Z').getTime()) /
        86400000,
    ) + 1;
  out.push(`**מספר ימים**: ${days}`);
  out.push(`**יוצר**: ${new Date().toISOString().slice(0, 10)}`);
  out.push('');

  // ===== Summary KPIs =====
  let revenue = 0;
  let fbSpend = 0;
  let gaSpend = 0;
  let cogs = 0;
  for (const r of daily) {
    revenue += r.revenue;
    fbSpend += r.fbSpend;
    gaSpend += r.gaSpend;
    cogs += r.cogs;
  }
  const totalSpend = fbSpend + gaSpend;
  const roas = totalSpend > 0 ? revenue / totalSpend : 0;
  const grossProfit = revenue - totalSpend;
  const netProfit = revenue - totalSpend - cogs;

  // Product-side totals (across all products in the period).
  let totalUnits = 0;
  let totalOrders = 0;
  let totalGrossProducts = 0;
  let totalNetProducts = 0;
  let hasNetData = false;
  let hasOrdersData = false;
  const productKeys = new Set<string>();
  for (const p of products) {
    totalUnits += p.units;
    totalOrders += p.orders;
    totalGrossProducts += p.revenue;
    if (p.netRevenue !== null) {
      hasNetData = true;
      totalNetProducts += p.netRevenue;
    }
    if (p.orders > 0) hasOrdersData = true;
    productKeys.add(`${p.storeName}::${p.productId || p.productTitle}`);
  }

  out.push('## תקציר ביצועים');
  out.push('');
  out.push(`| מטריקה | ערך |`);
  out.push(`|---|---|`);
  out.push(`| הכנסות (Shopify) | ${fmtCad(revenue)} |`);
  out.push(`| הוצאות פרסום | ${fmtCad(totalSpend)} |`);
  out.push(`| הוצאות Meta | ${fmtCad(fbSpend)} |`);
  out.push(`| הוצאות Google | ${fmtCad(gaSpend)} |`);
  out.push(`| ROAS משוקלל | ${roas > 0 ? fmtNum(roas, 2) : '—'} |`);
  out.push(`| רווח גולמי (Revenue − Spend) | ${fmtCad(grossProfit)} |`);
  out.push(`| COGS (25% מההכנסה) | ${fmtCad(cogs)} |`);
  out.push(`| **רווח נטו** | **${fmtCad(netProfit)}** |`);
  if (hasOrdersData) {
    out.push(`| מספר הזמנות (לפי מוצר) | ${fmtNum(totalOrders)} |`);
  }
  out.push(`| יחידות שנמכרו | ${fmtNum(totalUnits)} |`);
  out.push(`| מוצרים שונים שנמכרו | ${productKeys.size} |`);
  if (hasNetData) {
    const margin = totalGrossProducts > 0 ? totalNetProducts / totalGrossProducts : 0;
    out.push(`| מרג'ין ממוצע (נטו/ברוטו) | ${fmtPct(margin, 1)} |`);
  }
  out.push('');

  // ===== Daily breakdown (compact) =====
  out.push('## פירוט יומי');
  out.push('');
  out.push(`| תאריך | חנות | Meta | Google | Revenue | ROAS |`);
  out.push(`|---|---|---|---|---|---|`);
  const sortedDaily = [...daily].sort((a, b) => a.date.localeCompare(b.date) || a.storeName.localeCompare(b.storeName));
  for (const r of sortedDaily) {
    const dr = r.roas > 0 ? fmtNum(r.roas, 2) : (r.revenue === 0 && r.totalSpend > 0 ? '0 (FAILED)' : '—');
    out.push(
      `| ${fmtDate(r.date)} | ${r.storeName} | ${fmtCad(r.fbSpend)} | ${fmtCad(r.gaSpend)} | ${fmtCad(r.revenue)} | ${dr} |`,
    );
  }
  out.push('');

  // ===== Per-store summary (if "All" stores) =====
  if (storeName === 'All') {
    const perStore = new Map<string, { rev: number; spend: number; units: number; orders: number }>();
    for (const r of daily) {
      if (!perStore.has(r.storeName))
        perStore.set(r.storeName, { rev: 0, spend: 0, units: 0, orders: 0 });
      const e = perStore.get(r.storeName)!;
      e.rev += r.revenue;
      e.spend += r.totalSpend;
    }
    for (const p of products) {
      if (perStore.has(p.storeName)) {
        perStore.get(p.storeName)!.units += p.units;
        perStore.get(p.storeName)!.orders += p.orders;
      }
    }
    out.push('## פירוט לפי חנות');
    out.push('');
    out.push(`| חנות | הוצאה | הכנסה | ROAS | יחידות | הזמנות |`);
    out.push(`|---|---|---|---|---|---|`);
    for (const [s, e] of perStore) {
      const r = e.spend > 0 ? e.rev / e.spend : 0;
      out.push(
        `| ${s} | ${fmtCad(e.spend)} | ${fmtCad(e.rev)} | ${r > 0 ? fmtNum(r, 2) : '—'} | ${fmtNum(e.units)} | ${fmtNum(e.orders)} |`,
      );
    }
    out.push('');
  }

  // ===== Top products =====
  out.push('## מוצרים — מובילים לפי הכנסה');
  out.push('');
  const productAgg = new Map<
    string,
    {
      title: string;
      store: string;
      units: number;
      orders: number;
      gross: number;
      net: number | null;
      hasNet: boolean;
    }
  >();
  for (const p of products) {
    const k = `${p.storeName}::${p.productId || p.productTitle}`;
    if (!productAgg.has(k)) {
      productAgg.set(k, {
        title: p.productTitle,
        store: p.storeName,
        units: 0,
        orders: 0,
        gross: 0,
        net: null,
        hasNet: false,
      });
    }
    const e = productAgg.get(k)!;
    e.units += p.units;
    e.orders += p.orders;
    e.gross += p.revenue;
    if (p.netRevenue !== null) {
      e.net = (e.net ?? 0) + p.netRevenue;
      e.hasNet = true;
    }
  }
  const productsList = Array.from(productAgg.values()).sort(
    (a, b) => (b.net ?? b.gross) - (a.net ?? a.gross),
  );
  if (productsList.length === 0) {
    out.push('_אין נתוני מוצרים בטווח זה._');
  } else {
    out.push(
      `| מוצר | חנות | יחידות | הזמנות | ברוטו | נטו | מרג'ין |`,
    );
    out.push(`|---|---|---|---|---|---|---|`);
    for (const p of productsList.slice(0, 25)) {
      const margin =
        p.hasNet && p.gross > 0 && p.net !== null ? fmtPct(p.net / p.gross, 0) : '—';
      out.push(
        `| ${escapeMd(p.title)} | ${p.store} | ${fmtNum(p.units)} | ${p.orders > 0 ? fmtNum(p.orders) : '—'} | ${fmtCad(p.gross)} | ${p.hasNet && p.net !== null ? fmtCad(p.net) : '—'} | ${margin} |`,
      );
    }
    if (productsList.length > 25) {
      out.push('');
      out.push(`_… ועוד ${productsList.length - 25} מוצרים נוספים._`);
    }
  }
  out.push('');

  // ===== Top campaigns =====
  out.push('## קמפיינים — מובילים לפי ROAS');
  out.push('');
  const campaignAgg = new Map<
    string,
    {
      name: string;
      store: string;
      platform: string;
      campaignId: string;
      spend: number;
      value: number;
      clicks: number;
      impressions: number;
      conversions: number;
    }
  >();
  for (const c of campaigns) {
    const k = `${c.storeId}::${c.platform}::${c.campaignId}`;
    if (!campaignAgg.has(k)) {
      campaignAgg.set(k, {
        name: c.campaignName,
        store: c.storeName,
        platform: c.platform,
        campaignId: c.campaignId,
        spend: 0,
        value: 0,
        clicks: 0,
        impressions: 0,
        conversions: 0,
      });
    }
    const e = campaignAgg.get(k)!;
    e.spend += c.spend;
    e.value += c.conversionValue;
    e.clicks += c.clicks;
    e.impressions += c.impressions;
    e.conversions += c.conversions;
  }
  const campaignsList = Array.from(campaignAgg.values())
    .map(c => ({
      ...c,
      roas: c.spend > 0 ? c.value / c.spend : 0,
      ctr: c.impressions > 0 ? c.clicks / c.impressions : 0,
      cpc: c.clicks > 0 ? c.spend / c.clicks : 0,
      cpa: c.conversions > 0 ? c.spend / c.conversions : 0,
    }))
    .filter(c => c.spend >= 50) // hide trivial dust to keep the list focused
    .sort((a, b) => b.roas - a.roas);

  if (campaignsList.length === 0) {
    out.push('_אין קמפיינים עם הוצאה משמעותית (≥ CAD 50) בטווח זה._');
  } else {
    out.push(
      `| קמפיין | חנות | פלטפ׳ | הוצאה | ערך המרות | ROAS | המרות | CTR | CPC | CPA |`,
    );
    out.push(`|---|---|---|---|---|---|---|---|---|---|`);
    for (const c of campaignsList.slice(0, 25)) {
      out.push(
        `| ${escapeMd(c.name)} | ${c.store} | ${c.platform} | ${fmtCad(c.spend)} | ${fmtCad(c.value)} | ${c.roas > 0 ? fmtNum(c.roas, 2) : '—'} | ${fmtNum(c.conversions, 0)} | ${c.impressions > 0 ? fmtPct(c.ctr, 2) : '—'} | ${c.clicks > 0 ? `CAD ${fmtNum(c.cpc, 2)}` : '—'} | ${c.conversions > 0 ? `CAD ${fmtNum(c.cpa, 2)}` : '—'} |`,
      );
    }
    if (campaignsList.length > 25) {
      out.push('');
      out.push(`_… ועוד ${campaignsList.length - 25} קמפיינים._`);
    }
  }
  out.push('');

  // ===== Ad-set drill-down for top 5 highest-spend campaigns =====
  const adsetsByCampaign = new Map<
    string,
    {
      campaignName: string;
      adSets: Map<
        string,
        {
          name: string;
          spend: number;
          value: number;
          clicks: number;
          impressions: number;
          conversions: number;
        }
      >;
    }
  >();
  for (const c of campaigns) {
    if (!c.adSetId) continue;
    const cKey = `${c.storeId}::${c.platform}::${c.campaignId}`;
    if (!adsetsByCampaign.has(cKey))
      adsetsByCampaign.set(cKey, { campaignName: c.campaignName, adSets: new Map() });
    const bucket = adsetsByCampaign.get(cKey)!;
    if (!bucket.adSets.has(c.adSetId))
      bucket.adSets.set(c.adSetId, {
        name: c.adSetName,
        spend: 0,
        value: 0,
        clicks: 0,
        impressions: 0,
        conversions: 0,
      });
    const a = bucket.adSets.get(c.adSetId)!;
    a.spend += c.spend;
    a.value += c.conversionValue;
    a.clicks += c.clicks;
    a.impressions += c.impressions;
    a.conversions += c.conversions;
  }

  const topCampaignsForDrill = [...campaignsList]
    .sort((a, b) => b.spend - a.spend) // by spend, where attention should go
    .slice(0, 5);

  if (topCampaignsForDrill.length > 0) {
    out.push('## אד-סטים בתוך 5 הקמפיינים עם ההוצאה הגבוהה');
    out.push('');
    for (const c of topCampaignsForDrill) {
      const cKey = `${c.store === c.platform ? '' : ''}${c.platform}::${c.campaignId}`;
      // The map key in adsetsByCampaign uses storeId, not storeName. Find it.
      const matchingKey = Array.from(adsetsByCampaign.keys()).find(k =>
        k.endsWith(`::${c.platform}::${c.campaignId}`),
      );
      const bucket = matchingKey ? adsetsByCampaign.get(matchingKey) : null;
      if (!bucket) continue;

      out.push(`### ${c.platform} — ${escapeMd(c.name)} (${c.store})`);
      out.push(`_הוצאת קמפיין: ${fmtCad(c.spend)} · ROAS: ${c.roas > 0 ? fmtNum(c.roas, 2) : '—'}_`);
      out.push('');
      out.push(`| אד-סט | הוצאה | ערך המרות | ROAS | קליקים | המרות |`);
      out.push(`|---|---|---|---|---|---|`);
      const adsets = Array.from(bucket.adSets.values())
        .map(a => ({ ...a, roas: a.spend > 0 ? a.value / a.spend : 0 }))
        .sort((a, b) => b.spend - a.spend)
        .slice(0, 15);
      for (const a of adsets) {
        out.push(
          `| ${escapeMd(a.name)} | ${fmtCad(a.spend)} | ${fmtCad(a.value)} | ${a.roas > 0 ? fmtNum(a.roas, 2) : '—'} | ${fmtNum(a.clicks)} | ${fmtNum(a.conversions)} |`,
        );
      }
      out.push('');
    }
  }

  // ===== Suggested AI prompt =====
  out.push('---');
  out.push('');
  out.push('## הוראה לבינה מלאכותית');
  out.push('');
  out.push(
    'נתח את הנתונים שלמעלה ותן לי תובנות מעשיות:',
  );
  out.push('1. אילו קמפיינים הכי מצליחים ולמה? איזה אחד הייתי צריך לחזק יותר?');
  out.push('2. אילו קמפיינים מבזבזים תקציב? איזה הייתי צריך לעצור או לשפר?');
  out.push('3. אילו מוצרים הם המנועי-מכירות? איזה הייתי צריך לקדם יותר?');
  out.push('4. האם יש דפוסים יומיים (ימים בשבוע / שעות) ששווה לשים לב אליהם?');
  out.push(
    '5. מה ההמלצה הקונקרטית הראשונה שלך לשבוע הבא לשפר את ה-ROAS וה-Revenue?',
  );
  out.push('');
  out.push('היעד הפנימי: ROAS 3.0 ומעלה.');

  return out.join('\n');
}

/**
 * Escape pipe & newline characters so they don't break markdown tables.
 * (We don't need to escape backslashes since table cells don't process them.)
 */
function escapeMd(s: string): string {
  return String(s)
    .replace(/\|/g, '\\|')
    .replace(/\r?\n/g, ' ')
    .trim();
}
