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

  // ===== Critical disclaimer up top — most important context for the AI =====
  out.push('## ⚠️ הערה חשובה לפני ניתוח — דיוק שיוך המכירות');
  out.push('');
  out.push('**מקור האמת להכנסות**: Shopify Admin API — מדויק 100%, real-time, מבוסס על הזמנות אמיתיות שהתבצעו.');
  out.push('');
  out.push('**Meta ad-attribution (conversion_value, conversions ברמת קמפיין)**:');
  out.push('Meta Ads Manager לעיתים מייחס מכירות לקמפיינים בצורה לא מדויקת — לפעמים סופר יותר מהרכישות בפועל, לפעמים פחות, ולפעמים מייחס לקמפיין הלא נכון. הסיבות:');
  out.push('- attribution windows (Meta בודק 7 ימים אחורה מהקליק)');
  out.push('- iOS 14+ / ATT — חוסר הסכמה לטראקינג מצמצם את הנראות של Meta');
  out.push('- modeled conversions — Meta "ממציא" המרות חסרות באלגוריתם');
  out.push('- view-through attribution — מכירה משויכת רק כי המשתמש ראה מודעה, אפילו בלי קליק');
  out.push('');
  out.push('**מסקנה לניתוח**: ה-ROAS *ברמת חנות* (מקור: Shopify revenue / Meta+Google spend) הוא המקור האמין. ROAS *ברמת קמפיין* (מקור: conversion_value מ-Meta / spend מ-Meta) הוא אינדיקציה כללית בלבד. אל תקבל החלטות "להפסיק קמפיין" רק על בסיס ROAS ברמת קמפיין — שווה לבדוק גם את ה-Shopify revenue בימים הסמוכים.');
  out.push('');
  out.push('**Google Ads attribution**: בדרך כלל מדויק יותר מ-Meta, במיוחד לקמפייני Search ו-Shopping (purchase event ישיר). PMax יכול לסבול מאותן בעיות כמו Meta.');
  out.push('');
  out.push('---');
  out.push('');

  // ===== Summary KPIs =====
  let revenue = 0;
  let fbSpend = 0;
  let gaSpend = 0;
  let ttSpend = 0;
  let cogs = 0;
  for (const r of daily) {
    revenue += r.revenue;
    fbSpend += r.fbSpend;
    gaSpend += r.gaSpend;
    ttSpend += r.ttSpend ?? 0;
    cogs += r.cogs;
  }
  const hasTikTok = ttSpend > 0;
  const totalSpend = fbSpend + gaSpend + ttSpend;
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

  // Auction-side totals (impressions + clicks + conversions) — pulled
  // from campaign rows since data-daily doesn't carry them. Used for the
  // CPM / CTR / CPC / CPA / AOV / funnel sections below.
  let totalImpressions = 0;
  let totalClicks = 0;
  let totalConversions = 0;
  let totalConversionValue = 0;
  for (const c of campaigns) {
    totalImpressions += c.impressions;
    totalClicks += c.clicks;
    totalConversions += c.conversions;
    totalConversionValue += c.conversionValue;
  }
  const blendedCpm = totalImpressions > 0 ? (totalSpend / totalImpressions) * 1000 : 0;
  const blendedCtr = totalImpressions > 0 ? totalClicks / totalImpressions : 0;
  const blendedCpc = totalClicks > 0 ? totalSpend / totalClicks : 0;
  const blendedCpa = totalConversions > 0 ? totalSpend / totalConversions : 0;
  const aov = totalOrders > 0 ? revenue / totalOrders : 0;

  out.push('## תקציר ביצועים');
  out.push('');
  out.push(`| מטריקה | ערך |`);
  out.push(`|---|---|`);
  out.push(`| הכנסות (Shopify) | ${fmtCad(revenue)} |`);
  out.push(`| הוצאות פרסום | ${fmtCad(totalSpend)} |`);
  out.push(`| הוצאות Meta | ${fmtCad(fbSpend)} |`);
  out.push(`| הוצאות Google | ${fmtCad(gaSpend)} |`);
  if (hasTikTok) {
    out.push(`| הוצאות TikTok | ${fmtCad(ttSpend)} |`);
  }
  out.push(`| ROAS משוקלל | ${roas > 0 ? fmtNum(roas, 2) : '—'} |`);
  out.push(`| רווח גולמי (Revenue − Spend) | ${fmtCad(grossProfit)} |`);
  out.push(`| COGS (25% מההכנסה) | ${fmtCad(cogs)} |`);
  out.push(`| **רווח נטו** | **${fmtCad(netProfit)}** |`);
  if (hasOrdersData) {
    out.push(`| מספר הזמנות (לפי מוצר) | ${fmtNum(totalOrders)} |`);
    if (aov > 0) {
      out.push(`| AOV (ערך הזמנה ממוצע) | ${fmtCad(aov)} |`);
    }
  }
  out.push(`| יחידות שנמכרו | ${fmtNum(totalUnits)} |`);
  out.push(`| מוצרים שונים שנמכרו | ${productKeys.size} |`);
  if (hasNetData) {
    const margin = totalGrossProducts > 0 ? totalNetProducts / totalGrossProducts : 0;
    out.push(`| מרג'ין ממוצע (נטו/ברוטו) | ${fmtPct(margin, 1)} |`);
  }
  if (totalImpressions > 0) {
    out.push(`| חשיפות (Meta+Google) | ${fmtNum(totalImpressions)} |`);
    out.push(`| קליקים | ${fmtNum(totalClicks)} |`);
    out.push(`| המרות (לפי הפלטפורמות) | ${fmtNum(totalConversions)} |`);
    out.push(`| CTR משוקלל | ${fmtPct(blendedCtr, 2)} |`);
    out.push(`| **CPM משוקלל** | **${fmtCad(blendedCpm)}** (עלות ל-1000 חשיפות) |`);
    out.push(`| CPC משוקלל | ${fmtCad(blendedCpc)} |`);
    out.push(`| CPA משוקלל | ${fmtCad(blendedCpa)} |`);
  }
  out.push('');

  // ===== Funnel summary — impressions -> clicks -> orders -> revenue =====
  if (totalImpressions > 0) {
    out.push('## משפך — מחשיפות להזמנות');
    out.push('');
    out.push(`| שלב | ערך | יחס לשלב הקודם |`);
    out.push(`|---|---|---|`);
    out.push(`| חשיפות | ${fmtNum(totalImpressions)} | — |`);
    const clickRate = totalImpressions > 0 ? totalClicks / totalImpressions : 0;
    out.push(`| קליקים | ${fmtNum(totalClicks)} | ${fmtPct(clickRate, 2)} (CTR) |`);
    if (hasOrdersData && totalOrders > 0) {
      const orderRate = totalClicks > 0 ? totalOrders / totalClicks : 0;
      out.push(`| הזמנות (Shopify בפועל) | ${fmtNum(totalOrders)} | ${fmtPct(orderRate, 2)} (conversion rate) |`);
    } else if (totalConversions > 0) {
      const convRate = totalClicks > 0 ? totalConversions / totalClicks : 0;
      out.push(`| המרות (Meta/Google מדווח) | ${fmtNum(totalConversions)} | ${fmtPct(convRate, 2)} |`);
    }
    const revenuePerClick = totalClicks > 0 ? revenue / totalClicks : 0;
    out.push(`| הכנסה לקליק | ${fmtCad(revenuePerClick)} | — |`);
    out.push('');
    out.push('**מה לבדוק**: CTR נמוך (<1%) = הקריאייטיב לא מושך, audience רחב מדי, או auction יקר. Conversion rate נמוך (<1%) = קליקים מגיעים אבל הdf landing page / מוצר / מחיר לא ממירים. בעיה במשפך מצביעה בדיוק היכן להתערב.');
    out.push('');
  }

  // ===== Per-platform CPM/efficiency breakdown =====
  if (totalImpressions > 0) {
    let fbImps = 0, fbClicks = 0;
    let gImps = 0, gClicks = 0;
    let ttImps = 0, ttClicks = 0;
    for (const c of campaigns) {
      if (c.platform === 'Meta') {
        fbImps += c.impressions;
        fbClicks += c.clicks;
      } else if (c.platform === 'Google') {
        gImps += c.impressions;
        gClicks += c.clicks;
      } else if (c.platform === 'TikTok') {
        ttImps += c.impressions;
        ttClicks += c.clicks;
      }
    }
    const fbCpm = fbImps > 0 ? (fbSpend / fbImps) * 1000 : 0;
    const gCpm = gImps > 0 ? (gaSpend / gImps) * 1000 : 0;
    const ttCpm = ttImps > 0 ? (ttSpend / ttImps) * 1000 : 0;
    const fbCtr = fbImps > 0 ? fbClicks / fbImps : 0;
    const gCtr = gImps > 0 ? gClicks / gImps : 0;
    const ttCtr = ttImps > 0 ? ttClicks / ttImps : 0;
    out.push('## פלטפורמות — CPM ו-CTR לפי ערוץ');
    out.push('');
    out.push(`| ערוץ | חשיפות | CPM | קליקים | CTR | הוצאה |`);
    out.push(`|---|---|---|---|---|---|`);
    if (fbImps > 0) {
      out.push(`| Meta | ${fmtNum(fbImps)} | ${fmtCad(fbCpm)} | ${fmtNum(fbClicks)} | ${fmtPct(fbCtr, 2)} | ${fmtCad(fbSpend)} |`);
    }
    if (gImps > 0) {
      out.push(`| Google | ${fmtNum(gImps)} | ${fmtCad(gCpm)} | ${fmtNum(gClicks)} | ${fmtPct(gCtr, 2)} | ${fmtCad(gaSpend)} |`);
    }
    if (ttImps > 0) {
      out.push(`| TikTok | ${fmtNum(ttImps)} | ${fmtCad(ttCpm)} | ${fmtNum(ttClicks)} | ${fmtPct(ttCtr, 2)} | ${fmtCad(ttSpend)} |`);
    }
    out.push('');
    out.push('**הקשר**: CPM גבוה בערוץ אחד לעומת השני יכול לנבוע מ-(א) קהל יקר יותר (lookalike% / interest stack), (ב) קריאייטיב פחות מושך שגורם לMeta/Google להגביה את המחיר כדי לדחוף אותו, או (ג) פורמט מודעה דורש placement יקר (Reels vs feed, Shopping vs Search).');
    out.push('');
  }

  // ===== Daily breakdown (compact) =====
  out.push('## פירוט יומי');
  out.push('');
  if (hasTikTok) {
    out.push(`| תאריך | חנות | Meta | Google | TikTok | Revenue | ROAS |`);
    out.push(`|---|---|---|---|---|---|---|`);
  } else {
    out.push(`| תאריך | חנות | Meta | Google | Revenue | ROAS |`);
    out.push(`|---|---|---|---|---|---|`);
  }
  const sortedDaily = [...daily].sort((a, b) => a.date.localeCompare(b.date) || a.storeName.localeCompare(b.storeName));
  for (const r of sortedDaily) {
    const dr = r.roas > 0 ? fmtNum(r.roas, 2) : (r.revenue === 0 && r.totalSpend > 0 ? '0 (FAILED)' : '—');
    if (hasTikTok) {
      out.push(
        `| ${fmtDate(r.date)} | ${r.storeName} | ${fmtCad(r.fbSpend)} | ${fmtCad(r.gaSpend)} | ${fmtCad(r.ttSpend ?? 0)} | ${fmtCad(r.revenue)} | ${dr} |`,
      );
    } else {
      out.push(
        `| ${fmtDate(r.date)} | ${r.storeName} | ${fmtCad(r.fbSpend)} | ${fmtCad(r.gaSpend)} | ${fmtCad(r.revenue)} | ${dr} |`,
      );
    }
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

  // ===== Budget drainers — campaigns sorted by spend descending, but
  // filtered to ROAS < 1.5 (or ROAS == 0 with meaningful spend). These
  // are the ones the operator should consider pausing / investigating. =====
  const SPEND_FLOOR = 50; // CAD — ignore tiny test campaigns
  const drainers = [...campaignsList]
    .filter(c => c.spend >= SPEND_FLOOR && (c.roas < 1.5 || c.spend / Math.max(c.conversions, 0.001) > 200))
    .sort((a, b) => b.spend - a.spend)
    .slice(0, 10);
  if (drainers.length > 0) {
    out.push('## ⚠️ קמפיינים שמבזבזים — מומלץ לבדוק/לעצור');
    out.push('');
    out.push('קריטריונים: הוצאה ≥ CAD 50 בטווח **וגם** (ROAS < 1.5 או CPA > CAD 200). ממוין לפי הוצאה יורדת — הראשונים בטבלה הם הבזבזנים הכי כבדים.');
    out.push('');
    out.push(`| קמפיין | חנות | פלטפורמה | הוצאה | הכנסה (לפי הפלטפורמה) | ROAS | המרות | CPA |`);
    out.push(`|---|---|---|---|---|---|---|---|`);
    for (const c of drainers) {
      const cpa = c.conversions > 0 ? c.spend / c.conversions : 0;
      out.push(
        `| ${escapeMd(c.name)} | ${c.store} | ${c.platform} | ${fmtCad(c.spend)} | ${fmtCad(c.value)} | ${c.roas > 0 ? fmtNum(c.roas, 2) : '0 (FAILED)'} | ${fmtNum(c.conversions)} | ${cpa > 0 ? fmtCad(cpa) : '∞'} |`,
      );
    }
    out.push('');
    out.push('**אזהרה**: שים לב לחלק "⚠️ הערה חשובה" בראש הדוח — Meta יכול לסבול מ-under-reporting (במיוחד אחרי iOS 14). לפני שאתה עוצר קמפיין על בסיס הטבלה הזאת בלבד, בדוק את ה-Shopify revenue בימים שהקמפיין רץ — אולי המכירות הגיעו אבל לא יוחסו אליו.');
    out.push('');
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

  // ===== Day-of-week breakdown =====
  out.push('## ביצועים לפי יום בשבוע');
  out.push('');
  out.push('הקטע הזה עוזר לזהות אם יש דפוסים שבועיים — לדוגמה אם ROAS גבוה באופן עקבי בימי שלישי או נמוך בשבתות.');
  out.push('');
  const HE_DOW = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];
  const dowAgg: Array<{ count: number; revenue: number; spend: number }> = Array.from(
    { length: 7 },
    () => ({ count: 0, revenue: 0, spend: 0 }),
  );
  for (const r of daily) {
    const [y, m, d] = r.date.split('-').map(Number);
    const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
    dowAgg[dow].count++;
    dowAgg[dow].revenue += r.revenue;
    dowAgg[dow].spend += r.totalSpend;
  }
  out.push(`| יום | מספר ימים | הכנסות ממוצעות | הוצאה ממוצעת | ROAS משוקלל |`);
  out.push(`|---|---|---|---|---|`);
  for (let i = 0; i < 7; i++) {
    const d = dowAgg[i];
    if (d.count === 0) continue;
    const avgRev = d.revenue / d.count;
    const avgSpend = d.spend / d.count;
    const roas = d.spend > 0 ? d.revenue / d.spend : 0;
    out.push(
      `| ${HE_DOW[i]} | ${d.count} | ${fmtCad(avgRev)} | ${fmtCad(avgSpend)} | ${roas > 0 ? fmtNum(roas, 2) : '—'} |`,
    );
  }
  out.push('');

  // ===== Week-over-week comparison (if range >= 14 days) =====
  if (days >= 14) {
    const midPoint = new Date(range.from + 'T00:00:00Z');
    midPoint.setUTCDate(midPoint.getUTCDate() + Math.floor(days / 2));
    const mid = midPoint.toISOString().slice(0, 10);
    let firstHalfRev = 0, firstHalfSpend = 0, secondHalfRev = 0, secondHalfSpend = 0;
    for (const r of daily) {
      if (r.date < mid) {
        firstHalfRev += r.revenue;
        firstHalfSpend += r.totalSpend;
      } else {
        secondHalfRev += r.revenue;
        secondHalfSpend += r.totalSpend;
      }
    }
    const firstRoas = firstHalfSpend > 0 ? firstHalfRev / firstHalfSpend : 0;
    const secondRoas = secondHalfSpend > 0 ? secondHalfRev / secondHalfSpend : 0;
    const revChange = firstHalfRev > 0 ? (secondHalfRev - firstHalfRev) / firstHalfRev : 0;
    const roasChange = firstRoas > 0 ? secondRoas - firstRoas : 0;

    out.push('## השוואת מחצית ראשונה ↔ מחצית שנייה');
    out.push('');
    out.push(`| מטריקה | מחצית 1 (${fmtDate(range.from)} – ${fmtDate(mid)}) | מחצית 2 (${fmtDate(mid)} – ${fmtDate(range.to)}) | שינוי |`);
    out.push(`|---|---|---|---|`);
    out.push(`| הכנסות | ${fmtCad(firstHalfRev)} | ${fmtCad(secondHalfRev)} | ${revChange > 0 ? '+' : ''}${(revChange * 100).toFixed(1)}% |`);
    out.push(`| הוצאות | ${fmtCad(firstHalfSpend)} | ${fmtCad(secondHalfSpend)} | ${firstHalfSpend > 0 ? `${((secondHalfSpend - firstHalfSpend) / firstHalfSpend * 100).toFixed(1)}%` : '—'} |`);
    out.push(`| ROAS | ${firstRoas > 0 ? fmtNum(firstRoas, 2) : '—'} | ${secondRoas > 0 ? fmtNum(secondRoas, 2) : '—'} | ${roasChange > 0 ? '+' : ''}${roasChange.toFixed(2)} נק' |`);
    out.push('');
  }

  // ===== Ad-spend efficiency by platform =====
  out.push('## חלוקת תקציב לפי פלטפורמה');
  out.push('');
  let metaSpend = 0, googleSpend = 0;
  for (const r of daily) {
    metaSpend += r.fbSpend;
    googleSpend += r.gaSpend;
  }
  const totalSpendAll = metaSpend + googleSpend;
  if (totalSpendAll > 0) {
    out.push(`| פלטפורמה | הוצאה | % מסך תקציב |`);
    out.push(`|---|---|---|`);
    out.push(`| Meta | ${fmtCad(metaSpend)} | ${(metaSpend / totalSpendAll * 100).toFixed(0)}% |`);
    out.push(`| Google | ${fmtCad(googleSpend)} | ${(googleSpend / totalSpendAll * 100).toFixed(0)}% |`);
    out.push('');
    out.push('_שווה לבדוק אם החלוקה הזו אופטימלית. אם פלטפורמה אחת מספקת ROAS גבוה משמעותית יותר ברמת חנות (ראה Shopify revenue), שווה לשקול הסטת תקציב._');
    out.push('');
  }

  // ===== Top products by margin (not just units) =====
  out.push('## מוצרים עם מרג\'ין הגבוה ביותר');
  out.push('');
  out.push('המוצרים שמנפיקים הכי הרבה רווח נטו ביחס לברוטו (אחרי הנחות והחזרים). שווה לקדם בעדיפות כי הרווח האפקטיבי גבוה.');
  out.push('');
  const marginRanked = productsList
    .filter(p => p.hasNet && p.net !== null && p.gross > 100)
    .map(p => ({ ...p, margin: (p.net ?? 0) / p.gross }))
    .sort((a, b) => b.margin - a.margin)
    .slice(0, 10);
  if (marginRanked.length > 0) {
    out.push(`| מוצר | חנות | יחידות | ברוטו | נטו | מרג'ין |`);
    out.push(`|---|---|---|---|---|---|`);
    for (const p of marginRanked) {
      out.push(
        `| ${escapeMd(p.title)} | ${p.store} | ${fmtNum(p.units)} | ${fmtCad(p.gross)} | ${fmtCad(p.net ?? 0)} | ${fmtPct(p.margin, 0)} |`,
      );
    }
    out.push('');
  } else {
    out.push('_עוד אין נתוני נטו זמינים — דוח זה ימולא בריצות הבאות._');
    out.push('');
  }

  // ===== Suggested AI prompt =====
  out.push('---');
  out.push('');
  out.push('## הוראה לבינה מלאכותית');
  out.push('');
  out.push('אתה analyst כלכלי ב-e-commerce. נתח את הנתונים שלמעלה לעומק ותן לי דוח מעשי שמכיל:');
  out.push('');
  out.push('### חלק 1 — תמונת מצב כללית');
  out.push('1. **מה הסיפור של התקופה?** האם המגמה חיובית, שלילית, או יציבה? התבסס על ROAS משוקלל ועל רווח נטו (לא רק על הכנסות).');
  out.push('2. **האם החנות רווחית?** רווח נטו = הכנסות − פרסום − COGS (25%). אם שלילי — זה דגל אדום שמחייב פעולה.');
  out.push('3. **השוואה למחצית הקודמת**: מה השתפר ומה החמיר?');
  out.push('');
  out.push('### חלק 2 — קמפיינים');
  out.push('4. **קמפיינים לחזק (Scale)** — אילו 2-3 קמפיינים מצדיקים העלאת תקציב? התבסס על: ROAS גבוה ויציב (לפחות 7 ימים), CPA סביר, ערך המרות עולה על ההוצאה. שים לב — ה-ROAS *ברמת קמפיין* הוא מקור Meta/Google ולא מדויק לחלוטין (ראה ההערה למעלה).');
  out.push('5. **קמפיינים לבדוק/לעצור (Pause/Investigate)** — אילו קמפיינים מבזבזים תקציב? התייחס לטבלת "⚠️ קמפיינים שמבזבזים" שבדוח. קריטריונים: ROAS < 1.5, CPA גבוה משמעותית מהממוצע, או 0 המרות בכמות הוצאה משמעותית.');
  out.push('6. **אד-סטים בעייתיים בתוך קמפיינים טובים** — אם יש קמפיין כללי טוב אבל אד-סט בודד גורר אותו למטה, ציין זאת.');
  out.push('7. **חלוקת תקציב Meta vs Google** — האם החלוקה אופטימלית? אם אחת מהפלטפורמות מספקת ROAS גבוה משמעותית, מומלץ להעביר תקציב.');
  out.push('8. **CPM ו-CTR לפי ערוץ** — התבסס על טבלת "פלטפורמות — CPM ו-CTR לפי ערוץ". CPM גבוה בלי CTR מתאים = הקהל יקר ו/או הקריאייטיב לא מתחבר. CTR גבוה אבל ROAS חלש = הקליק קורה אבל הconversion לא — בעיה ב-landing page או בתמחור.');
  out.push('9. **משפך החשיפות-הזמנות** — התבסס על טבלת "משפך". זהה את החוליה הכי חלשה: CTR נמוך = בעיה ב-creative/audience; conversion rate נמוך = בעיה ב-landing/מחיר; הכנסה לקליק נמוכה = AOV נמוך או conversion rate נמוך.');
  out.push('');
  out.push('### חלק 3 — מוצרים');
  out.push('8. **המוצרים שמובילים** — אילו 2-3 מוצרים הם המנועי-המכירות? איזה מהם הייתי צריך לקדם בקמפיינים ייעודיים?');
  out.push('9. **מוצרים עם מרג\'ין נמוך** — אילו מוצרים יש להם הרבה הנחות/החזרות? שווה לבחון את התמחור או את ה-product-market fit שלהם.');
  out.push('10. **מוצרים שלא נמכרים** — אם יש מוצרים עם 0 מכירות בתקופה הזו אבל היו פעילים בעבר, ייתכן שהם איבדו רלוונטיות.');
  out.push('');
  out.push('### חלק 4 — דפוסים זמניים');
  out.push('11. **ימים בשבוע** — אילו ימים מספקים את ה-ROAS הגבוה ביותר? האם שווה להגדיל תקציב בימים האלה ולחתוך בימים החלשים?');
  out.push('12. **מגמה לאורך התקופה** — האם הביצועים משתפרים, מתדרדרים, או יציבים?');
  out.push('');
  out.push('### חלק 5 — הצעות פעולה ספציפיות');
  out.push('13. **5 פעולות קונקרטיות לשבוע הקרוב** עם הצדקה לכל אחת:');
  out.push('   - פעולה 1: ___ (כי ___)');
  out.push('   - פעולה 2: ___ (כי ___)');
  out.push('   - ...');
  out.push('14. **2-3 בדיקות שכדאי לעשות** — בדיקות שדורשות מידע נוסף או A/B test');
  out.push('15. **3 KPIs שכדאי לעקוב אחריהם בשבוע הבא** — מה חשוב לראות שיקרה');
  out.push('');
  out.push('### הקשר חשוב');
  out.push('- **היעד הפנימי**: ROAS 3.0 ומעלה. ROAS 2-2.7 = "סביר", מתחת ל-2 = מצריך בחינה.');
  out.push('- **COGS משוער**: 25% מההכנסה. רווח נטו = הכנסות − פרסום − 25% מההכנסה.');
  out.push('- **שיוך מכירות Meta**: לפעמים סופר יותר/פחות מהמציאות בגלל iOS 14+, modeled conversions, או attribution windows. אל תקבל החלטות ל"לעצור קמפיין" רק על בסיס ROAS ברמת קמפיין שמ-Meta — בדוק גם את ה-Shopify revenue בימים הסמוכים.');
  out.push('- **3 חנויות**: uzoshop, Zol Plus, 360usmile — לכל אחת מסע לקוח ומוצרים שונים. אל תכריע "כל החנויות צריכות לעשות X" אם הנתונים מצביעים על הבדלים.');
  out.push('');
  out.push('**פורמט תשובה**: השב בעברית, בכותרות (## / ###) ובנקודות, עם המלצות *קונקרטיות* (מספרים ושמות קמפיינים/מוצרים) ולא פרהזות כלליות.');

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
