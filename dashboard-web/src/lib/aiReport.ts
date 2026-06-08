import type { DailyRow } from './types';
import type { ProductRow } from './products';
import type { CampaignRow } from './campaigns';
import type { OrderAttributionRow } from './ordersAttribution';
import type { AdRow } from './ads';
import { allocateProductRevenue, type ProductMap } from './campaignProductMap';
import {
  computeCampaignHealth,
  type CampaignHealth,
  type HealthGrade,
} from './campaignHealthScore';
import { analyzeCpmVsRoas, type DailyCpmRoasPoint } from './cpmRoasAnalysis';
import { getCogsRateForStore } from './analytics';
import type { Aggregated } from './campaignsAggregator';
import { TIKTOK_ACTIVE_ENOUGH } from './platformConfig';
import { netAdjustFactor } from './home/revenueBasis';
import { isAdsEnabled, isStoreFullyOff, type AdStateMap, type AdPlatform } from './adState';
import { SOURCE_LABEL } from './sourceLabels';

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
  storeName: string;          // "All" or specific (display name)
  /**
   * Audit fix 2026-05-23 (a/WARN-4) — the operator's selected store as
   * the STABLE INTERNAL ID (e.g. "zolplus") rather than the display
   * name (e.g. "Zol Plus"). Used to filter all row sets by `r.storeId`
   * instead of the fragile `r.storeName === storeName` comparison.
   * Stores whose displayName differs from id (zolplus → "Zol Plus",
   * usmile360 → "360usmile") were silently mis-filtered before this
   * fix: the daily/campaign/orders filters would correctly use the
   * display name, BUT the productMap multi-mapping section compared
   * `storeName` to a value the caller treated as an ID and so dropped
   * legitimate multi-mapping rows for those stores.
   *
   * Optional for back-compat with older callers — when omitted, we fall
   * back to the legacy storeName comparison (still uses display name
   * everywhere, which works for storeId === storeName stores like
   * uzoshop but silently mis-filters Zol Plus / 360usmile).
   */
  storeId?: string | null;
  range: { from: string; to: string };
  dailyRows: DailyRow[];      // filtered by store + range upstream OR full set
  productRows: ProductRow[];
  campaignRows: CampaignRow[];
  /**
   * Phase 05.7.x — order-level attribution rows from Shopify (one per
   * order, with source/utm/click-id signals). Used to slice revenue by
   * traffic source, compute AOV per source, and gauge click-id coverage
   * — all dimensions an experienced media buyer needs but that don't
   * surface from daily/campaign aggregates alone.
   * Empty array is acceptable (pipeline still warming up) — the
   * dependent sections fall back to "data not available".
   */
  ordersRows?: OrderAttributionRow[];
  /**
   * Phase 05.7.x — ad-level rows (one per (date, store, campaign, ad-set,
   * ad)). Used for creative-level drill-down inside top campaigns +
   * cross-campaign creative winners/losers. Source: ads_daily (Meta-only
   * for now; Google PMax doesn't expose ad granularity). Empty acceptable.
   */
  adsRows?: AdRow[];
  /**
   * Phase 05.7.x (2026-05-23) — operator's product↔campaign mapping
   * (Meta + TikTok only; Google PMax doesn't support mapping). Used to
   * surface multi-mapped products in the report so the AI's per-campaign
   * recommendations understand that a product's Shopify revenue is
   * split across all campaigns that have it mapped (proportional to
   * spend share, per allocateProductRevenue). Without this, the AI
   * could say "Scale Campaign A — it owns product X" when in fact
   * Campaign A shares product X with Campaign B and the revenue is
   * split, so "scale A" would over-credit it.
   *
   * Optional for backwards-compat. When omitted or empty, the
   * multi-mapped section is skipped.
   */
  productMap?: ProductMap;
  /**
   * Ads-off Phase 4 (2026-06-06) — per-(store, platform) ad-state map.
   * Keys are `${storeId}:${platform}` (lowercase platform), values are
   * `false` when that (store, platform) is intentionally turned off.
   * Missing key ⇒ ON (true). When omitted or empty the report is
   * identical to pre-Phase-4 behaviour (no filtering).
   */
  adStateMap?: AdStateMap;
  /**
   * Ads-off Phase 4 — storeId → list of platforms the store advertises on.
   * Used to determine if a store is "fully off" (all applicable platforms
   * turned off). Optional; when absent, per-store reframing is skipped.
   */
  storeApplicablePlatforms?: Record<string, AdPlatform[]>;
};

const fmtNum = (n: number, d = 0) =>
  new Intl.NumberFormat('he-IL', {
    minimumFractionDigits: d,
    maximumFractionDigits: d,
  }).format(n);

const fmtCad = (n: number) => `CAD ${fmtNum(Math.round(n))}`;
// Two-decimal variant for CPC/CPA cells. Plain-string export → no <bdi>
// wrap needed; this file emits markdown for AI prompts.
const fmtCad2 = (n: number) => `CAD ${fmtNum(n, 2)}`;
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
  storeId,
  range,
  dailyRows,
  productRows,
  campaignRows,
  ordersRows,
  adsRows,
  productMap,
  adStateMap = {},
  storeApplicablePlatforms = {},
}: Params): string {
  const out: string[] = [];

  // Pre-filter all four datasets by range + store.
  //
  // Audit fix 2026-05-23 (a/WARN-4): prefer storeId-based comparison
  // when the caller threaded it through. storeName is a display label
  // that can diverge from the internal id (e.g. "Zol Plus" displayName
  // for id "zolplus"); filtering by id is correct regardless of any
  // future rename. Falls back to storeName comparison when storeId is
  // null/undefined (legacy callers).
  const storeFilter = storeName === 'All' ? null : storeName;
  const storeIdFilter = storeName === 'All' ? null : (storeId ?? null);
  const matchesStore = (r: { storeId: string; storeName: string }): boolean => {
    if (!storeFilter) return true;
    return storeIdFilter ? r.storeId === storeIdFilter : r.storeName === storeFilter;
  };
  const daily = dailyRows.filter(r => inRange(r.date, range) && matchesStore(r));
  const products = productRows.filter(r => inRange(r.date, range) && matchesStore(r));
  const campaigns = campaignRows.filter(r => inRange(r.date, range) && matchesStore(r));
  const orders = (ordersRows ?? []).filter(r => inRange(r.date, range) && matchesStore(r));
  // Phase 05.7.x — ad-level rows for creative drill-down. Meta-only in
  // practice (Google PMax / Shopping don't expose ad granularity), but
  // we don't filter by platform here — let the downstream section
  // handle "no ads" gracefully.
  const ads = (adsRows ?? []).filter(r => inRange(r.date, range) && matchesStore(r));

  // ===== Ads-off Phase 4: predicates for ad-performance filtering =====
  // campaign/ad rows carry title-case platform ('Meta'/'Google'/'TikTok');
  // AdStateMap keys use lowercase → always .toLowerCase() before lookup.
  const isCampaignOff = (c: { storeId: string; platform: string }): boolean =>
    !isAdsEnabled(adStateMap, c.storeId, String(c.platform).toLowerCase() as AdPlatform);
  const isAdOff = (a: { storeId: string; platform: string }): boolean =>
    !isAdsEnabled(adStateMap, a.storeId, String(a.platform).toLowerCase() as AdPlatform);

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
  // Gross revenue (before refund_line_items deduction) for the same period.
  // `grossRevenue` is null on historical rows pre-Phase-05.7.3 — fall back to
  // net (`r.revenue`) so a missing column degrades to "no refund adjustment"
  // rather than dropping the day's gross to 0 (which would over-deflate the
  // blended net-adj factor below). Wave 1 (2026-06-03, Task 7).
  let grossRevenue = 0;
  let fbSpend = 0;
  let gaSpend = 0;
  let ttSpend = 0;
  let cogs = 0;
  for (const r of daily) {
    revenue += r.revenue;
    grossRevenue += r.grossRevenue ?? r.revenue;
    fbSpend += r.fbSpend;
    gaSpend += r.gaSpend;
    ttSpend += r.ttSpend ?? 0;
    cogs += r.cogs;
  }
  // Blended net/gross factor for the store/period. Used to re-base GROSS
  // orders_attribution revenue ($) onto the same NET basis as the headline MER
  // (data_daily.revenue_cad). Uniform per period → ratios (coverage %, per-
  // source %) are basis-invariant and must NOT be adjusted; only absolute $.
  const { factor: revenueNetAdj } = netAdjustFactor(revenue, grossRevenue);
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
  const cogsRatePct = revenue > 0 ? (cogs / revenue * 100).toFixed(1) : '—';
  out.push(`| COGS (${cogsRatePct}% מההכנסה) | ${fmtCad(cogs)} |`);
  out.push(`| **רווח תפעולי** | **${fmtCad(netProfit)}** |`);
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
  // Ads-off Phase 4: exclude off (store, platform) campaigns from aggregation.
  const campaignsOnForCpm = campaigns.filter(c => !isCampaignOff(c));
  // Gate on FILTERED impressions so a fully-off store with historical impressions
  // doesn't render a header + column-headers with zero data rows (review defect 2).
  const filteredTotalImpressions = campaignsOnForCpm.reduce((s, c) => s + c.impressions, 0);
  if (filteredTotalImpressions > 0) {
    let fbImps = 0, fbClicks = 0;
    let gImps = 0, gClicks = 0;
    let ttImps = 0, ttClicks = 0;
    for (const c of campaignsOnForCpm) {
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

    // ===== CPM Volatility per platform — daily stddev as % of mean =====
    // Phase 05.7.x — analyst-grade. CPM that moves wildly day-to-day
    // signals an unstable auction (creative fatigue, audience saturation,
    // budget overshoot relative to delivery). Quiet, low-volatility CPM
    // is a sign the campaign has stabilised — safer to scale.
    type DailyCpm = { date: string; cpm: number };
    const cpmByPlatform: Record<string, DailyCpm[]> = {
      Meta: [],
      Google: [],
      TikTok: [],
    };
    const dailyAgg: Record<string, Record<string, { spend: number; imps: number }>> = {
      Meta: {},
      Google: {},
      TikTok: {},
    };
    for (const c of campaignsOnForCpm) {
      const p = c.platform;
      if (p !== 'Meta' && p !== 'Google' && p !== 'TikTok') continue;
      if (!dailyAgg[p][c.date]) dailyAgg[p][c.date] = { spend: 0, imps: 0 };
      dailyAgg[p][c.date].spend += c.spend;
      dailyAgg[p][c.date].imps += c.impressions;
    }
    for (const p of ['Meta', 'Google', 'TikTok']) {
      for (const [date, v] of Object.entries(dailyAgg[p])) {
        if (v.imps > 0) cpmByPlatform[p].push({ date, cpm: (v.spend / v.imps) * 1000 });
      }
    }
    const platformStats: Array<{
      platform: string;
      n: number;
      mean: number;
      stddev: number;
      cv: number;
      min: number;
      max: number;
    }> = [];
    for (const p of ['Meta', 'Google', 'TikTok']) {
      const arr = cpmByPlatform[p];
      if (arr.length < 3) continue;
      const mean = arr.reduce((s, d) => s + d.cpm, 0) / arr.length;
      const variance =
        arr.reduce((s, d) => s + Math.pow(d.cpm - mean, 2), 0) / arr.length;
      const stddev = Math.sqrt(variance);
      const cv = mean > 0 ? stddev / mean : 0;
      const min = Math.min(...arr.map(d => d.cpm));
      const max = Math.max(...arr.map(d => d.cpm));
      platformStats.push({ platform: p, n: arr.length, mean, stddev, cv, min, max });
    }
    if (platformStats.length > 0) {
      out.push('## תנודתיות CPM לאורך הימים');
      out.push('');
      out.push(
        '**מה זה אומר**: CV (coefficient of variation = stddev/mean) הוא ' +
          'מדד יציבות. CV < 0.15 = יציב מאוד (בטוח לסקייל); 0.15-0.35 = תנודה ' +
          'בינונית; CV > 0.35 = תנודה גבוהה (creative fatigue, budget thrashing, ' +
          'או auction לא יציב — לעצור לפני סקייל).',
      );
      out.push('');
      out.push(
        `| פלטפורמה | ימים | CPM ממוצע | CPM מינ׳ | CPM מקס׳ | תנודה (CV) | אבחנה |`,
      );
      out.push(`|---|---|---|---|---|---|---|`);
      for (const s of platformStats) {
        const verdict =
          s.cv < 0.15
            ? 'יציב'
            : s.cv < 0.35
              ? 'בינוני'
              : 'תנודתי';
        out.push(
          `| ${s.platform} | ${s.n} | ${fmtCad(s.mean)} | ${fmtCad(
            s.min,
          )} | ${fmtCad(s.max)} | ${fmtPct(s.cv, 0)} | ${verdict} |`,
        );
      }
      out.push('');
    }
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

  // ===== Anomaly Days — outliers in revenue / spend / ROAS =====
  // Phase 05.7.x — analyst-grade. Surfaces days that deviated >2× MAD
  // from the period's median revenue or spend. Most operators eyeball
  // the daily table and miss the outlier; flagging it explicitly catches
  // "what happened on Wednesday?" follow-ups that drive learning.
  if (daily.length >= 5) {
    // Aggregate per-date (sum across stores) so anomalies are at the
    // dashboard level, not per-store.
    const byDate = new Map<string, { revenue: number; spend: number }>();
    for (const r of daily) {
      if (!byDate.has(r.date)) byDate.set(r.date, { revenue: 0, spend: 0 });
      const e = byDate.get(r.date)!;
      e.revenue += r.revenue;
      e.spend += r.totalSpend;
    }
    const datesSorted = Array.from(byDate.entries()).sort((a, b) =>
      a[0].localeCompare(b[0]),
    );
    function medianMad(values: number[]): { median: number; mad: number } {
      const sorted = [...values].sort((a, b) => a - b);
      const mid = Math.floor(sorted.length / 2);
      const median =
        sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
      const deviations = values.map(v => Math.abs(v - median)).sort((a, b) => a - b);
      const dmid = Math.floor(deviations.length / 2);
      const mad =
        deviations.length % 2 === 0
          ? (deviations[dmid - 1] + deviations[dmid]) / 2
          : deviations[dmid];
      return { median, mad };
    }
    const revenues = datesSorted.map(([, v]) => v.revenue);
    const spends = datesSorted.map(([, v]) => v.spend);
    const revStats = medianMad(revenues);
    const spendStats = medianMad(spends);
    // Robust z-score: (value - median) / (1.4826 × MAD). >2 = outlier.
    type Anomaly = {
      date: string;
      revenue: number;
      spend: number;
      revZ: number;
      spendZ: number;
      kind: string;
    };
    const anomalies: Anomaly[] = [];
    for (const [date, v] of datesSorted) {
      const revZ =
        revStats.mad > 0
          ? (v.revenue - revStats.median) / (1.4826 * revStats.mad)
          : 0;
      const spendZ =
        spendStats.mad > 0
          ? (v.spend - spendStats.median) / (1.4826 * spendStats.mad)
          : 0;
      const isRevOutlier = Math.abs(revZ) >= 2.0;
      const isSpendOutlier = Math.abs(spendZ) >= 2.0;
      if (!isRevOutlier && !isSpendOutlier) continue;
      const parts: string[] = [];
      if (revZ > 2.0) parts.push('הכנסה גבוהה במיוחד');
      if (revZ < -2.0) parts.push('הכנסה נמוכה במיוחד');
      if (spendZ > 2.0) parts.push('הוצאה גבוהה במיוחד');
      if (spendZ < -2.0) parts.push('הוצאה נמוכה במיוחד');
      anomalies.push({ date, revenue: v.revenue, spend: v.spend, revZ, spendZ, kind: parts.join(' + ') });
    }
    if (anomalies.length > 0) {
      out.push('## ימים חריגים בטווח (אנומליות סטטיסטיות)');
      out.push('');
      out.push(
        `**מתודה**: זיהוי ע"י robust z-score על median + MAD (Median Absolute ` +
          `Deviation). ימים עם |z| ≥ 2.0 מסומנים. המדיאן בטווח: הכנסות ${fmtCad(
            revStats.median,
          )} · הוצאות ${fmtCad(spendStats.median)}.`,
      );
      out.push('');
      out.push(`| תאריך | הכנסה | z-הכנסה | הוצאה | z-הוצאה | אבחנה |`);
      out.push(`|---|---|---|---|---|---|`);
      for (const a of anomalies.sort((x, y) => x.date.localeCompare(y.date))) {
        out.push(
          `| ${fmtDate(a.date)} | ${fmtCad(a.revenue)} | ${a.revZ.toFixed(
            1,
          )} | ${fmtCad(a.spend)} | ${a.spendZ.toFixed(1)} | ${a.kind} |`,
        );
      }
      out.push('');
      out.push(
        '**מה לבדוק**: ספייקים חיוביים = אירוע חיצוני (קמפיין שעלה, viral creative, מבצע?) ' +
          '— שווה לפענח ולשחזר. ספייקים שליליים = אירוע שלילי (קמפיין שכבה, ' +
          'בעיית checkout, יום חג שלא היה צפוי?) — שווה לבדוק שלא נכנס שוב.',
      );
      out.push('');
    }
  }

  // ===== Pixel vs Shopify Reconciliation =====
  // Phase 05.7.x — analyst-grade. Quantifies the iOS-14/ATT attribution
  // gap by comparing platform-reported conversion_value (Σ across all
  // campaigns) vs Shopify-reported revenue. Magnitude of gap is the
  // operator's "how much can I trust Meta/Google ROAS?" calibration.
  if (totalConversionValue > 0 && revenue > 0) {
    const gap = revenue - totalConversionValue;
    const gapPct = revenue > 0 ? gap / revenue : 0;
    let verdict: string;
    if (Math.abs(gapPct) < 0.1) {
      verdict =
        'הפלטפורמות בקנה אחד עם Shopify (פער < 10%) — ROAS ברמת קמפיין אמין יחסית.';
    } else if (gapPct > 0.1) {
      verdict =
        'הפלטפורמות *מדווחות פחות* ממה ש-Shopify רואה — סימן ל-iOS 14 ATT / ad-blockers / late attribution. ROAS האמיתי גבוה ממה שמופיע ב-Meta/Google.';
    } else {
      verdict =
        'הפלטפורמות *מדווחות יותר* ממה ש-Shopify רואה — view-through מעצים, modeled conversions, או double-counting בין Meta ו-Google. ROAS האמיתי נמוך ממה שמופיע בפלטפורמות.';
    }
    out.push('## פער Pixel ↔ Shopify (כיול אמינות פלטפורמות)');
    out.push('');
    out.push(`| מטריקה | ערך |`);
    out.push(`|---|---|`);
    out.push(`| הכנסות Shopify | ${fmtCad(revenue)} |`);
    out.push(
      `| Σ conversion_value (Meta+Google+TikTok ברמת קמפיין) | ${fmtCad(
        totalConversionValue,
      )} |`,
    );
    out.push(`| פער (Shopify − פלטפורמות) | ${fmtCad(gap)} |`);
    out.push(
      `| פער יחסי | ${gapPct >= 0 ? '+' : ''}${(gapPct * 100).toFixed(0)}% |`,
    );
    out.push(`| ROAS לפי Shopify | ${roas > 0 ? fmtNum(roas, 2) : '—'} |`);
    const platformRoas =
      totalSpend > 0 ? totalConversionValue / totalSpend : 0;
    out.push(`| ROAS לפי פלטפורמות | ${platformRoas > 0 ? fmtNum(platformRoas, 2) : '—'} |`);
    out.push('');
    out.push(`**אבחנה**: ${verdict}`);
    out.push('');
  }

  // ===== Per-store summary (if "All" stores) =====
  if (storeName === 'All') {
    const perStore = new Map<string, { storeId: string; rev: number; spend: number; units: number; orders: number }>();
    for (const r of daily) {
      if (!perStore.has(r.storeName))
        perStore.set(r.storeName, { storeId: r.storeId, rev: 0, spend: 0, units: 0, orders: 0 });
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
    out.push(`| חנות | הוצאה | הכנסה | ROAS | יחידות | הזמנות | מצב |`);
    out.push(`|---|---|---|---|---|---|---|`);
    for (const [s, e] of perStore) {
      const r = e.spend > 0 ? e.rev / e.spend : 0;
      // Ads-off Phase 4: note when a store is fully off (all platforms disabled).
      const fullyOff = isStoreFullyOff(
        e.storeId,
        adStateMap,
        storeApplicablePlatforms[e.storeId] ?? [],
      );
      const stateNote = fullyOff ? 'פרסום כבוי — הכנסה אורגנית בלבד' : '';
      out.push(
        `| ${s} | ${fmtCad(e.spend)} | ${fmtCad(e.rev)} | ${r > 0 ? fmtNum(r, 2) : '—'} | ${fmtNum(e.units)} | ${fmtNum(e.orders)} | ${stateNote} |`,
      );
    }
    out.push('');
  }

  // ===== Traffic Source Breakdown — orders + AOV by source =====
  // Phase 05.7.x — analyst-grade addition. Slices revenue + order count
  // by where the customer actually came from (Shopify-side ground truth),
  // so the operator can see how much of revenue is platform-claimed vs
  // organic/direct. AOV per source surfaces which channel attracts
  // higher-spending customers — a signal Meta/Google ROAS doesn't carry.
  if (orders.length > 0) {
    // classify-v2 (2026-06): the canonical classifier emits tiktok-organic /
    // search-organic / app-referral in addition to the existing labels (see
    // classifyOrderSource.ts). Every value needs a friendly Hebrew label or the
    // raw machine string leaks into the operator-facing table. The SOURCE_LABEL
    // map is the SHARED vocabulary (lib/sourceLabels.ts) — the SAME source of
    // truth the activity-feed <SourceBadge> uses (classify-v2 T3) so the report
    // and the badge can never drift to different Hebrew words. NONE of the
    // organic/referral labels are paid — this map is DISPLAY-only and does not
    // feed any ROAS/paid-spend math.
    type Bucket = { count: number; revenue: number };
    const bySource: Record<string, Bucket> = {};
    let grandTotal = 0;
    let grandOrders = 0;
    for (const o of orders) {
      // Fold any defensively-empty source into the existing 'direct'
      // bucket — the writer (shopify.ts) never emits '' (its catch-all is
      // 'direct'), so the '' label was dead. Mirrors attributionAnalysis.ts
      // (`o.source || 'direct'`).
      const key = o.source || 'direct';
      if (!bySource[key]) bySource[key] = { count: 0, revenue: 0 };
      bySource[key].count += 1;
      bySource[key].revenue += o.totalCad;
      grandTotal += o.totalCad;
      grandOrders += 1;
    }
    // Deterministic coverage — % of revenue that arrived with a signal we
    // can attribute without modelling: a raw click-id (fbclid / gclid), a
    // non-empty utm_source, OR a paid-source label assigned by the writer
    // from source_name / click-id ('meta-paid' / 'google-paid' /
    // 'tiktok-paid'). 'tiktok-paid' stands in for ttclid here — there is no
    // `ttclidPresent` boolean on OrderAttributionRow; the writer folds
    // ttclid + source_name=tiktok into the 'tiktok-paid' label, which is
    // source_name-deterministic.
    let deterministicRevenue = 0;
    let _deterministicOrders = 0;
    for (const o of orders) {
      const hasClickId =
        o.fbclidPresent ||
        o.gclidPresent ||
        o.utmSource.trim() !== '' ||
        o.source === 'meta-paid' ||
        o.source === 'google-paid' ||
        o.source === 'tiktok-paid';
      if (hasClickId) {
        deterministicRevenue += o.totalCad;
        _deterministicOrders += 1;
      }
    }
    const coveragePct = grandTotal > 0 ? deterministicRevenue / grandTotal : 0;

    out.push('## תנועה לפי מקור (Shopify-side ground truth)');
    out.push('');
    out.push(
      '**זה ה-source-of-truth להכנסות.** Shopify רואה את הקליק האחרון שמיתג את ' +
        'ההזמנה — לפי `utm_source`, `fbclid`, `gclid`, `ttclid`, או referrer. ' +
        'כשמשווים את העמודה הזו ל-conversion_value שמ-Meta/Google מדווחים, ' +
        'אפשר לכמת את פער ה-attribution האמיתי שלך.',
    );
    out.push('');
    out.push(
      '> **בסיס הכנסות: נטו (מתואם refunds).** עמודות ההכנסות וה-AOV מוצגות בערך ' +
        'ברוטו בקופה מוכפל ביחס ה-refund הממוצע של החנות/התקופה (net÷gross), כדי ' +
        'שיתיישרו בקנה־מידה עם ה-MER הכותרתי. אחוזי הכיסוי וה-% לפי מקור הם יחסים ' +
        '— בלתי-תלויי בסיס — ולכן לא מותאמים.',
    );
    out.push('');
    out.push(`| מקור | הזמנות | % | הכנסות (נטו) | AOV (נטו) |`);
    out.push(`|---|---|---|---|---|`);
    // Sort + per-source % stay on the GROSS sums (ratios are basis-invariant —
    // the net-adj factor cancels). Only the DISPLAYED $ ("הכנסות", "AOV") are
    // re-based by `revenueNetAdj` so they agree in scale with the net MER.
    // Wave 1 (2026-06-03, Task 7).
    const sortedSources = Object.entries(bySource).sort(
      (a, b) => b[1].revenue - a[1].revenue,
    );
    for (const [src, b] of sortedSources) {
      // `src` is a raw string key; SOURCE_LABEL is keyed by the OrderSource
      // union. Index via a permissive lookup and fall back to the raw string
      // for any unknown/future label (same survive-don't-disappear philosophy
      // as parseSource).
      const label = (SOURCE_LABEL as Record<string, string>)[src] ?? src;
      const pct = grandTotal > 0 ? (b.revenue / grandTotal) * 100 : 0;
      const revenueNet = b.revenue * revenueNetAdj;
      const aovNet = b.count > 0 ? revenueNet / b.count : 0;
      out.push(
        `| ${label} | ${fmtNum(b.count)} | ${pct.toFixed(0)}% | ${fmtCad(
          revenueNet,
        )} | ${fmtCad(aovNet)} |`,
      );
    }
    const grandTotalNet = grandTotal * revenueNetAdj;
    out.push(
      `| **סה"כ** | **${fmtNum(grandOrders)}** | **100%** | **${fmtCad(
        grandTotalNet,
      )}** | **${fmtCad(grandOrders > 0 ? grandTotalNet / grandOrders : 0)}** |`,
    );
    out.push('');
    out.push(
      `**כיסוי deterministic**: ${fmtPct(coveragePct, 0)} מההכנסות הגיעו עם ` +
        `אות-ייחוס דטרמיניסטי (fbclid / gclid / utm_source כלשהו / תווית ` +
        `paid כש-source_name מזהה את הפלטפורמה — meta/google/tiktok). ` +
        `השאר (${fmtPct(1 - coveragePct, 0)}) — direct/organic/other — לא ניתן ` +
        `לייחס בוודאות לפרסום אלא רק במודלים.`,
    );
    out.push('');
    out.push(
      '**מה לבדוק**: (1) אם paid-Meta וpaid-Google מסבירים <50% מההכנסות → ' +
        'יש לך הרבה תנועה אורגנית/ישירה — הקמפיינים אולי מספקים תפקיד ' +
        'awareness שלא נספר ב-ROAS. (2) AOV גבוה ב-direct/email לעומת paid → ' +
        'הלקוחות החוזרים שלך אינם זקוקים לקליק בתשלום, סיבה לחזק email/owned-channels. ' +
        '(3) AOV נמוך במקור paid מסוים → או שאתה מושך לקוחות לא נכונים, או ' +
        'שהמוצר זול דורש פרסום זול יותר (CPC נמוך יותר).',
    );
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
  // AUDIT ALG-04 + ALG-05 + ALG-06 (2026-05-24, Phase 12.1.2): surface
  // storeId on the aggregated value shape so every downstream key
  // construction (statusByCampaign, ordersByCampaignId, detById,
  // adsetsByCampaign drill-down, adAgg drill-down) is storeId-scoped.
  // Pre-fix the value object dropped storeId, forcing downstream
  // consumers to use suffix-scan find() / `${platform}::${campaignId}`
  // keys that silently merged data across stores in the operator's
  // default 'All' view. Evidence:
  // .planning/phases/12-codebase-audit-baseline/raw-returns/lib_algorithm_aiReport.json
  // (ALG-04 lines 38-44, ALG-05 lines 47-53, ALG-06 lines 56-63)
  const campaignAgg = new Map<
    string,
    {
      storeId: string;
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
  // Ads-off Phase 4: exclude off (store, platform) campaigns from all
  // ad-performance sections. campaignsOn is the filtered set used for
  // top-campaigns, momentum, health-score, drainers, and ad-set drill-down.
  const campaignsOn = campaigns.filter(c => !isCampaignOff(c));

  for (const c of campaignsOn) {
    const k = `${c.storeId}::${c.platform}::${c.campaignId}`;
    if (!campaignAgg.has(k)) {
      campaignAgg.set(k, {
        storeId: c.storeId,
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
        `| ${escapeMd(c.name)} | ${c.store} | ${c.platform} | ${fmtCad(c.spend)} | ${fmtCad(c.value)} | ${c.roas > 0 ? fmtNum(c.roas, 2) : '—'} | ${fmtNum(c.conversions, 0)} | ${c.impressions > 0 ? fmtPct(c.ctr, 2) : '—'} | ${c.clicks > 0 ? fmtCad2(c.cpc) : '—'} | ${c.conversions > 0 ? fmtCad2(c.cpa) : '—'} |`,
      );
    }
    if (campaignsList.length > 25) {
      out.push('');
      out.push(`_… ועוד ${campaignsList.length - 25} קמפיינים._`);
    }
  }
  out.push('');

  // ===== Per-campaign deterministic Shopify ROAS + Pixel↔Shopify gap =====
  // Phase 05.7.x — analyst-grade. The dashboard surfaces 3 ROAS variants
  // per row (Platform / Shopify combined / Shopify deterministic). The
  // report now mirrors that for top campaigns: matches orders to
  // campaigns by utmId / utmCampaign, sums deterministic revenue, and
  // compares to platform-claimed conversion_value. The gap surfaces
  // which campaigns Meta/Google/TikTok are OVER-reporting (modeled +
  // view-through) vs UNDER-reporting (iOS 14 ATT) — the operator's
  // actual "should I trust this ROAS?" calibration per campaign.
  if (orders.length > 0 && campaignsOn.length > 0) {
    // AUDIT ALG-05 (2026-05-24, Phase 12.1.2): storeId-scoped composite key
    // (`${o.storeId}::${id}` / `${o.storeId}::${name.toLowerCase()}`) so two
    // stores sharing utm_id or utm_campaign='Brand' don't merge revenue in
    // the operator's default storeName='All' view. Pre-fix: same id/name
    // across stores double-counted at the row level, inflating Pixel↔Shopify
    // trust and Health Score deterministic coverage. Evidence:
    // .planning/phases/12-codebase-audit-baseline/raw-returns/lib_algorithm_aiReport.json (ALG-05)
    //
    // Pre-bucket orders by their utmId / utmCampaign so the per-campaign
    // lookup is O(1). utmId wins when present (immutable platform ID);
    // utmCampaign by name is the legacy fallback.
    const ordersByCampaignId = new Map<string, number>();
    const ordersByCampaignName = new Map<string, number>();
    for (const o of orders) {
      const id = (o.utmId ?? '').trim();
      const name = (o.utmCampaign ?? '').trim();
      if (id) {
        const k = `${o.storeId}::${id}`;
        ordersByCampaignId.set(k, (ordersByCampaignId.get(k) ?? 0) + o.totalCad);
      }
      if (name) {
        const k = `${o.storeId}::${name.toLowerCase()}`;
        ordersByCampaignName.set(k, (ordersByCampaignName.get(k) ?? 0) + o.totalCad);
      }
    }

    type CompareRow = {
      name: string;
      platform: string;
      store: string;
      spend: number;
      platformValue: number;
      detRevenue: number;
      platformRoas: number;
      detRoas: number;
      gap: number;
      verdict: string;
    };
    const rows: CompareRow[] = [];
    for (const c of campaignsList) {
      // AUDIT ALG-05 (2026-05-24, Phase 12.1.2): lookup keyed by storeId
      // so each campaign's det revenue is its OWN store's matched orders
      // only — not the merged cross-store sum.
      const det =
        ordersByCampaignId.get(`${c.storeId}::${c.campaignId}`) ??
        ordersByCampaignName.get(`${c.storeId}::${c.name.toLowerCase()}`) ??
        0;
      const detRoas = c.spend > 0 ? det / c.spend : 0;
      const platformRoas = c.spend > 0 ? c.value / c.spend : 0;
      // Gap is positive when Shopify > platform (under-reporting).
      const gap = c.value > 0 ? (det - c.value) / c.value : det > 0 ? 1 : 0;
      let verdict: string;
      if (det === 0 && c.value > 0) {
        verdict = 'אין click-id (חוסר שיוך)';
      } else if (Math.abs(gap) < 0.15) {
        verdict = 'מאוזן (אמין)';
      } else if (gap > 0.15) {
        verdict = `Shopify רואה ${(gap * 100).toFixed(0)}%+ יותר (Meta מדווח חסר)`;
      } else {
        verdict = `Meta מדווח ${Math.abs(gap * 100).toFixed(0)}% יותר (modeled / view-through)`;
      }
      rows.push({
        name: c.name,
        platform: c.platform,
        store: c.store,
        spend: c.spend,
        platformValue: c.value,
        detRevenue: det,
        platformRoas,
        detRoas,
        gap,
        verdict,
      });
    }
    rows.sort((a, b) => b.spend - a.spend);

    out.push('## השוואת ROAS לקמפיין — Pixel ↔ Shopify (deterministic)');
    out.push('');
    out.push(
      '**מה זה אומר**: לכל קמפיין — ROAS לפי הפלטפורמה (conversion_value מ-Meta/Google/TikTok ÷ הוצאה) מול ROAS לפי Shopify (הזמנות שתויגו דטרמיניסטית לקמפיין הזה דרך `utm_id` / `utm_campaign` ÷ הוצאה). הפער הוא ההפרש בכסף: חיובי = Meta מדווח חסר (iOS 14 ATT), שלילי = Meta מדווח עודף (modeled / view-through / double-count). **שיקול קבלת החלטות**: אם פער > ±20% — אל תקבל החלטה על בסיס ה-ROAS של הפלטפורמה לבד.',
    );
    out.push('');
    out.push(
      `| קמפיין | פלטפ׳ | חנות | הוצאה | Pixel value | Shopify det. | ROAS Pixel | ROAS Det. | פער | אבחנה |`,
    );
    out.push(
      `|---|---|---|---|---|---|---|---|---|---|`,
    );
    for (const r of rows.slice(0, 25)) {
      const gapStr =
        r.platformValue > 0
          ? (r.gap >= 0 ? '+' : '') + (r.gap * 100).toFixed(0) + '%'
          : r.detRevenue > 0
            ? 'אין הצהרת פלטפורמה'
            : '—';
      out.push(
        `| ${escapeMd(r.name)} | ${r.platform} | ${r.store} | ${fmtCad(
          r.spend,
        )} | ${fmtCad(r.platformValue)} | ${fmtCad(r.detRevenue)} | ${
          r.platformRoas > 0 ? fmtNum(r.platformRoas, 2) : '—'
        } | ${r.detRoas > 0 ? fmtNum(r.detRoas, 2) : '—'} | ${gapStr} | ${r.verdict} |`,
      );
    }
    if (rows.length > 25) {
      out.push('');
      out.push(`_… ועוד ${rows.length - 25} קמפיינים._`);
    }
    out.push('');
    out.push(
      '**איך לקרוא**: "Shopify רואה X%+ יותר" → ROAS האמיתי גבוה ממה ש-Meta מציג, ' +
        'אל תעצור על בסיס ROAS נמוך מ-Meta. "Meta מדווח Y% יותר" → ROAS האמיתי ' +
        'נמוך, התקרבת לדיווח מנופח (תקין בעיקר אם יש view-through רחב). "אין ' +
        'click-id" → ה-URL Parameters של הקמפיין לא מוגדרים נכון — אם תתקן, ' +
        'תקבל deterministic attribution בעתיד.',
    );
    out.push('');
  }

  // ===== Campaign Momentum — first half vs second half ROAS per top campaign =====
  // Phase 05.7.x — analyst-grade addition. ROAS at the period level can
  // hide a campaign that started strong and is now decaying, OR one that
  // ramped up in week 2 and deserves more budget. The first/second-half
  // ROAS pair surfaces the slope so the operator knows which direction
  // to bet on.
  if (campaignsOn.length > 0 && days >= 6) {
    const midPoint = new Date(range.from + 'T00:00:00Z');
    midPoint.setUTCDate(midPoint.getUTCDate() + Math.floor(days / 2));
    const mid = midPoint.toISOString().slice(0, 10);
    type Halves = {
      name: string;
      store: string;
      platform: string;
      spend: number;
      h1Spend: number;
      h1Value: number;
      h2Spend: number;
      h2Value: number;
    };
    const halves = new Map<string, Halves>();
    for (const c of campaignsOn) {
      const k = `${c.storeId}::${c.platform}::${c.campaignId}`;
      if (!halves.has(k)) {
        halves.set(k, {
          name: c.campaignName,
          store: c.storeName,
          platform: c.platform,
          spend: 0,
          h1Spend: 0,
          h1Value: 0,
          h2Spend: 0,
          h2Value: 0,
        });
      }
      const h = halves.get(k)!;
      h.spend += c.spend;
      if (c.date < mid) {
        h.h1Spend += c.spend;
        h.h1Value += c.conversionValue;
      } else {
        h.h2Spend += c.spend;
        h.h2Value += c.conversionValue;
      }
    }
    type Row = Halves & {
      h1Roas: number;
      h2Roas: number;
      delta: number;
      verdict: 'מאיץ' | 'יציב' | 'נחלש' | 'חדש' | 'התקרר';
    };
    const rows: Row[] = [];
    for (const h of halves.values()) {
      // Require ≥CAD 100 total spend so noisy mini-campaigns don't dominate.
      if (h.spend < 100) continue;
      const h1Roas = h.h1Spend > 0 ? h.h1Value / h.h1Spend : 0;
      const h2Roas = h.h2Spend > 0 ? h.h2Value / h.h2Spend : 0;
      const delta = h1Roas > 0 ? h2Roas - h1Roas : h2Roas;
      let verdict: Row['verdict'];
      if (h.h1Spend === 0 && h.h2Spend > 0) verdict = 'חדש';
      else if (h.h2Spend === 0 && h.h1Spend > 0) verdict = 'התקרר';
      else if (delta > 0.5) verdict = 'מאיץ';
      else if (delta < -0.5) verdict = 'נחלש';
      else verdict = 'יציב';
      rows.push({ ...h, h1Roas, h2Roas, delta, verdict });
    }
    rows.sort((a, b) => b.spend - a.spend);

    if (rows.length > 0) {
      out.push('## מומנטום קמפיינים — מחצית 1 ↔ מחצית 2');
      out.push('');
      out.push(
        '**מה זה אומר**: ROAS לכל הטווח יכול להסתיר קמפיין שהתחיל חזק ועכשיו ' +
          'נחלש (לעצור / לרענן creative), או קמפיין שהתחיל חלש ועלה (להגדיל ' +
          'תקציב). המחצית הראשונה מול השנייה מציגה את הכיוון. ' +
          '**מאיץ** = ROAS שני גבוה ב-0.5+ מהראשון; **נחלש** = ROAS שני נמוך ' +
          'ב-0.5+. **חדש** = הופעל רק במחצית השנייה; **התקרר** = הופסק במחצית השנייה.',
      );
      out.push('');
      out.push(
        `| קמפיין | פלטפ׳ | חנות | הוצאה | ROAS חצי-1 | ROAS חצי-2 | Δ | מסקנה |`,
      );
      out.push(`|---|---|---|---|---|---|---|---|`);
      for (const r of rows.slice(0, 20)) {
        const deltaStr =
          r.h1Roas > 0
            ? (r.delta >= 0 ? '+' : '') + r.delta.toFixed(2)
            : '—';
        out.push(
          `| ${escapeMd(r.name)} | ${r.platform} | ${r.store} | ${fmtCad(
            r.spend,
          )} | ${r.h1Roas > 0 ? fmtNum(r.h1Roas, 2) : '—'} | ${
            r.h2Roas > 0 ? fmtNum(r.h2Roas, 2) : '—'
          } | ${deltaStr} | ${r.verdict} |`,
        );
      }
      out.push('');
    }
  }

  // ===== Campaign Health Score — unified verdict per campaign =====
  // Phase 05.7.x — analyst-grade. Mirrors the dashboard's Health Score
  // column, but inside the AI report so the operator gets the same
  // verdict (and the AI can reason about which campaigns are A-grade
  // vs F-grade in plain language). The 4-component breakdown lets the
  // AI explain WHY a campaign scored low (volume / profitability /
  // trajectory / attribution clarity) rather than guessing.
  //
  // The report-side Health Score uses simplified inputs because the
  // dashboard's full TrueRevenueInfo (with product mapping) isn't in
  // the report's data path. Specifically:
  //   - deterministicRevenue = revenue from orders tagged to this
  //     campaign via utmId / utmCampaign (when we have orders data).
  //   - confidence + attribution.trust are synthesised from click-id
  //     coverage so computeCampaignHealth can apply its trust modulator.
  //   - trajectory = analyzeCpmVsRoas on the campaign's daily CPM/ROAS
  //     series within the range.
  if (campaignsList.length > 0) {
    // Build per-campaign daily CPM/ROAS series for trajectory analysis.
    // Ads-off Phase 4: use campaignsOn (already filtered) — off campaigns
    // must not pollute the health-score trajectory series.
    const dailyByKey = new Map<
      string,
      Map<string, { spend: number; impressions: number; value: number }>
    >();
    for (const c of campaignsOn) {
      const key = `${c.storeId}::${c.platform}::${c.campaignId}`;
      if (!dailyByKey.has(key)) dailyByKey.set(key, new Map());
      const m = dailyByKey.get(key)!;
      const e = m.get(c.date) ?? { spend: 0, impressions: 0, value: 0 };
      e.spend += c.spend;
      e.impressions += c.impressions;
      e.value += c.conversionValue;
      m.set(c.date, e);
    }
    // AUDIT ALG-05 (2026-05-24, Phase 12.1.2): parallel det maps —
    // same storeId-scoped composite key as ordersByCampaignId above
    // so the synthetic trueRevenueInfo passed into computeCampaignHealth
    // gets each store's OWN deterministic revenue, not the merged
    // cross-store sum. Pre-fix this drove Pixel↔Shopify trust scores
    // and Health Score attribution clarity to the same inflated value
    // across both stores. Evidence: same raw-returns file as the
    // ordersByCampaignId fix above (ALG-05 cites BOTH 842-853 AND
    // 1083-1092).
    //
    // Order-matching for deterministic revenue (reuse the buckets from
    // the Pixel↔Shopify comparison if orders are present).
    const detById = new Map<string, number>();
    const detByName = new Map<string, number>();
    for (const o of orders) {
      const id = (o.utmId ?? '').trim();
      const name = (o.utmCampaign ?? '').trim();
      if (id) {
        const k = `${o.storeId}::${id}`;
        detById.set(k, (detById.get(k) ?? 0) + o.totalCad);
      }
      if (name) {
        const k = `${o.storeId}::${name.toLowerCase()}`;
        detByName.set(k, (detByName.get(k) ?? 0) + o.totalCad);
      }
    }

    // Effective-status lookup — latest non-null per campaign.
    const statusByKey = new Map<string, string>();
    for (const c of campaigns) {
      if (!c.effectiveStatus) continue;
      const key = `${c.storeId}::${c.platform}::${c.campaignId}`;
      statusByKey.set(key, c.effectiveStatus); // last write wins (sorted iteration would be ideal, but campaigns is unordered — close enough for status)
    }
    function isStatusOff(status: string | undefined, platform: string): boolean {
      if (!status) return false;
      const norm = status.trim().toUpperCase();
      const p = platform.toLowerCase();
      if (p === 'meta') return norm !== 'ACTIVE';
      if (p === 'google') return norm !== 'ENABLED';
      // AUDIT ALG-01 (2026-05-24, Phase 12.2.1): TikTok "active enough"
      // taxonomy via shared TIKTOK_ACTIVE_ENOUGH set (5 statuses incl.
      // BUDGET_EXCEED, AUDIT, REVIEWING, NOT_START — not just
      // DELIVERY_OK). Same rule cronLive.isActiveForPlatform +
      // postgresReaders already use per AUDIT U-01 symmetry. Pre-fix:
      // BUDGET_EXCEED campaigns wrongly listed as "currently off" +
      // penalized -30 in Health Score.
      // Evidence: .planning/phases/12-codebase-audit-baseline/raw-returns/
      //   lib_algorithm_aiReport.json (ALG-01).
      if (p === 'tiktok') return !TIKTOK_ACTIVE_ENOUGH.has(norm);
      return false;
    }

    type HealthRow = {
      name: string;
      platform: string;
      store: string;
      spend: number;
      health: CampaignHealth;
      effectiveStatus: string | null;
    };
    const healthRows: HealthRow[] = [];
    for (const c of campaignsList.slice(0, 25)) {
      // AUDIT ALG-06 (2026-05-24, Phase 12.1.2): direct map.get on the
      // storeId-scoped composite key. Pre-fix Array.from(...).find(k =>
      // k.endsWith(::${platform}::${campaignId})) returned the FIRST
      // match across stores, silently giving one store's campaign the
      // other store's daily series + status. Bonus: removes the O(N²)
      // suffix scan. Evidence: same raw-returns file (ALG-06 site #1,
      // lines 1124-1131 of pre-fix aiReport.ts).
      //
      // campaignsList rows now carry storeId (foundation fix above), so
      // the lookup is exact.
      const composedKey = `${c.storeId}::${c.platform}::${c.campaignId}`;
      const status = statusByKey.get(composedKey) ?? null;
      const _isOff = isStatusOff(status ?? undefined, c.platform); // retained for future reference — not used in score

      // Daily series → trajectory.
      const dailyMap = dailyByKey.get(composedKey) ?? null;
      const series: DailyCpmRoasPoint[] = dailyMap
        ? Array.from(dailyMap.entries())
            .filter(([, v]) => v.spend > 0 || v.impressions > 0)
            .map(([date, v]) => ({
              date,
              cpm: v.impressions > 0 ? (v.spend / v.impressions) * 1000 : 0,
              roas: v.spend > 0 ? v.value / v.spend : 0,
            }))
            .sort((a, b) => a.date.localeCompare(b.date))
        : [];
      const trajectory = series.length >= 5 ? analyzeCpmVsRoas(series) : undefined;

      // AUDIT ALG-05 (2026-05-24, Phase 12.1.2): lookup keyed by storeId
      // so each Health Score row's deterministic revenue input is its
      // OWN store's matched orders only.
      const det =
        detById.get(`${c.storeId}::${c.campaignId}`) ??
        detByName.get(`${c.storeId}::${c.name.toLowerCase()}`) ??
        0;
      // AUDIT ALG-07 (2026-05-24, Phase 12.2.1): raw coverage — no upper
      // clamp. Mirrors `attributionAnalysis.computeCoverage`'s post-AUDIT
      // U-05 semantic (commit b846ae7): halo (det >> claim) is an
      // operator-visible signal for broken pixel / ad-blocker storm /
      // ATT opt-out spike, NOT a value to suppress. Pre-fix Math.min(1,
      // det/c.value) clamped halo to 1.0, stuck trustScore at the 100
      // ceiling and starved the U-05 halo-warning chip of its input.
      // The `det > 0 ? 1 : 0` fallback for c.value=0 is preserved
      // (Infinity-guard).
      // Evidence: .planning/phases/12-codebase-audit-baseline/raw-returns/
      //   lib_algorithm_aiReport.json (ALG-07).
      const coverage = c.value > 0 ? det / c.value : det > 0 ? 1 : 0;
      const trustScore = Math.round(coverage * 100);
      const trustLevel =
        trustScore >= 80 ? 'high' : trustScore >= 40 ? 'medium' : 'low';

      // Synthesise a minimal TrueRevenueInfo so computeCampaignHealth's
      // priority chain (deterministic → trueRevenue → platform) picks
      // the right modulator.
      const trueRevenueInfo =
        det > 0
          ? {
              trueRevenue: det,
              trueUnits: 0,
              metaClaim: c.value,
              spend: c.spend,
              mappedCount: 1,
              sharedCampaigns: 0,
              confidence: { level: trustLevel as 'high' | 'medium' | 'low', label: trustLevel, reasons: [] },
              attribution: {
                trust: { level: trustLevel as 'high' | 'medium' | 'low', label: trustLevel, score: trustScore },
              } as unknown as ReturnType<typeof analyzeCpmVsRoas>['details'] extends infer X ? X : never,
              productTotals: { revenue: det, units: 0 },
              deterministicRevenue: det,
              deterministicUnits: 0,
            }
          : undefined;

      // Build Aggregated shape — partial OK because computeCampaignHealth
      // only reads spend / conversionValue / conversions for fallbacks.
      // AUDIT ALG-04/05/06 (2026-05-24, Phase 12.1.2): pass the real
      // storeId-scoped key + storeId now that the foundation surfaces
      // them, instead of the pre-fix '' storeId placeholder and
      // suffix-derived key.
      const agg: Aggregated = {
        key: composedKey,
        storeId: c.storeId,
        storeName: c.store,
        platform: c.platform,
        campaignId: c.campaignId,
        campaignName: c.name,
        adSetId: undefined,
        adSetName: undefined,
        spend: c.spend,
        impressions: c.impressions,
        clicks: c.clicks,
        conversions: c.conversions,
        conversionValue: c.value,
        campaignBudgetCad: null,
        adSetBudgetCad: null,
        budgetType: '',
        lastActiveDate: null,
        effectiveStatus: status,
        lastLiveTickAt: null,
        regConfiguredStatus: null,
        regEffectiveStatus: null,
        regDeliveryStatus: null,
        regFirstSeenAt: null,
        regStatusChangedAt: null,
        regLastStatusSuccessAt: null,
      };
      const health = computeCampaignHealth({
        aggregated: agg,
        trueRevenueInfo: trueRevenueInfo as never,
        cpmRoasAnalysis: trajectory,
      });
      healthRows.push({
        name: c.name,
        platform: c.platform,
        store: c.store,
        spend: c.spend,
        health,
        effectiveStatus: status,
      });
    }
    // Sort by score descending; insufficient grades to bottom.
    healthRows.sort((a, b) => {
      if (a.health.insufficient !== b.health.insufficient)
        return a.health.insufficient ? 1 : -1;
      return b.health.score - a.health.score;
    });

    const gradeIcon: Record<HealthGrade, string> = {
      A: '🟢 A',
      B: '🔵 B',
      C: '🟠 C',
      D: '🔴 D',
      F: '🔴 F',
      unknown: '⏳ —',
    };

    out.push('## Campaign Health Score — ציון מאוחד פר קמפיין');
    out.push('');
    out.push(
      '**מה זה אומר**: לכל קמפיין — ציון 0–100 + אות (A/B/C/D/F) שמשלב 4 רכיבים: ' +
        '**רווחיות 40%** (ROAS × אמינות attribution) · **נפח 15%** (סולם הוצאה) · ' +
        '**מומנטום 25%** (CPM↔ROAS trend) · **בהירות attribution 20%** (click-id coverage). ' +
        '+15 אם הקמפיין מסומן אופטימיזציה פעילה; −30 אם כבוי. **ציון < 30 (F) = ' +
        'לעצור / לבדוק; A = להרחיב.** הציון אינו מקור החלטה יחיד אלא כותרת — ' +
        'תבחר מתוך הרכיבים מה לתקן.',
    );
    out.push('');
    out.push(
      '> ⚠️ **הערה (audit 2026-05-23 CR-03)**: הציון בדוח הזה נשען על קלט מפושט ' +
        '(coverage = det/metaClaim בלבד) בלי analyzers מלאים — לכן ייתכן שיהיה ' +
        '**שונה במעט מהציון בטבלת הקמפיינים בדשבורד**, שמשתמש ב-analyzeAttribution ' +
        'המלא (window-stability, outlier detection, refund-adjusted coverage). ' +
        '**הטבלה בדשבורד היא מקור האמת**; הדוח כאן נועד לתת ל-AI תמונה רחבה ' +
        'לסקירה — לא להחליף את הטבלה בהחלטות סקייל/עצירה.',
    );
    out.push('');
    out.push(
      `| קמפיין | פלטפ׳ | חנות | הוצאה | ציון | רווחיות | נפח | מומנטום | Attribution | סטטוס |`,
    );
    out.push(
      `|---|---|---|---|---|---|---|---|---|---|`,
    );
    for (const r of healthRows) {
      const comp = r.health.components;
      const statusLabel = r.effectiveStatus
        ? r.effectiveStatus.replace(/^ADGROUP_STATUS_/, '')
        : '—';
      out.push(
        `| ${escapeMd(r.name)} | ${r.platform} | ${r.store} | ${fmtCad(
          r.spend,
        )} | **${gradeIcon[r.health.grade]} ${r.health.insufficient ? '' : r.health.score}** | ${comp.profitability} | ${comp.volume} | ${comp.trajectory} | ${comp.attributionClarity} | ${statusLabel} |`,
      );
    }
    out.push('');
  }

  // ===== Currently Off Campaigns =====
  // Phase 05.7.x — uses the new effective_status column (Meta/Google/TikTok
  // platform-real status). Lets the operator see at a glance which campaigns
  // in the period are now off — useful for "did we pause everything we
  // intended to pause?" sanity checks AND for end-of-month reporting where
  // a paused campaign's historical numbers don't reflect a strategic call.
  if (campaignsList.length > 0) {
    const offCampaigns: Array<{
      name: string;
      platform: string;
      store: string;
      spend: number;
      roas: number;
      status: string;
    }> = [];
    function isOff(status: string | null, platform: string): boolean {
      if (!status) return false;
      const norm = status.trim().toUpperCase();
      const p = platform.toLowerCase();
      if (p === 'meta') return norm !== 'ACTIVE';
      if (p === 'google') return norm !== 'ENABLED';
      // AUDIT ALG-01 (2026-05-24, Phase 12.2.1): TikTok "active enough"
      // taxonomy via shared TIKTOK_ACTIVE_ENOUGH set (mirrors isStatusOff
      // above per AUDIT U-01 symmetry — same predicate, two call sites).
      // Pre-fix: TikTok BUDGET_EXCEED / AUDIT / REVIEWING / NOT_START
      // were wrongly listed in 'קמפיינים כבויים כעת'.
      // Evidence: .planning/phases/12-codebase-audit-baseline/raw-returns/
      //   lib_algorithm_aiReport.json (ALG-01).
      if (p === 'tiktok') return !TIKTOK_ACTIVE_ENOUGH.has(norm);
      return false;
    }
    // AUDIT ALG-04 (2026-05-24, Phase 12.1.2): statusByCampaign keyed
    // with storeId-scoped composite (`${storeId}::${platform}::${campaignId}`)
    // so two stores sharing the same (platform, campaignId) don't
    // overwrite each other's effective_status. Pre-fix: last-write-wins
    // across stores in the operator's default 'All' view silently
    // mislabeled one store's campaign with the other's status (e.g.
    // uzoshop's ACTIVE campaign would show as PAUSED because zolplus's
    // PAUSED row was written last to the same un-storeId-scoped key).
    // Evidence: .planning/phases/12-codebase-audit-baseline/
    //   raw-returns/lib_algorithm_aiReport.json (ALG-04 lines 38-44)
    //
    // AUDIT ALG-03 (2026-05-24, Phase 12.3): chronological sort BEFORE
    // the last-write-wins loop so the chronologically LATEST
    // effectiveStatus per (storeId, platform, campaignId) deterministically
    // wins, regardless of fetcher input order. Belt-and-suspenders
    // alongside the storeId-scoped key above (ALG-04) which only fixed
    // CROSS-STORE collisions, not WITHIN-STORE input-order dependency
    // when the same campaign appears on multiple dates with different
    // statuses (e.g. a campaign paused mid-window then re-activated).
    // Evidence: .planning/phases/12-codebase-audit-baseline/
    //   raw-returns/lib_algorithm_aiReport.json (ALG-03 lines 28-34).
    //
    // Need to find effective_status per campaign — pull latest from campaigns array.
    const statusByCampaign = new Map<string, string | null>();
    const campaignsSortedByDate = [...campaigns].sort((a, b) =>
      a.date.localeCompare(b.date),
    );
    for (const c of campaignsSortedByDate) {
      const key = `${c.storeId}::${c.platform}::${c.campaignId}`;
      if (c.effectiveStatus) statusByCampaign.set(key, c.effectiveStatus);
    }
    for (const c of campaignsList) {
      const status = statusByCampaign.get(`${c.storeId}::${c.platform}::${c.campaignId}`) ?? null;
      if (status && isOff(status, c.platform)) {
        offCampaigns.push({
          name: c.name,
          platform: c.platform,
          store: c.store,
          spend: c.spend,
          roas: c.roas,
          status,
        });
      }
    }
    if (offCampaigns.length > 0) {
      offCampaigns.sort((a, b) => b.spend - a.spend);
      out.push('## קמפיינים כבויים כעת (status אמיתי מהפלטפורמה)');
      out.push('');
      out.push(
        '**מה זה אומר**: הקמפיינים הבאים הופיעו בטווח עם הוצאות, אבל ' +
          'effective_status מהפלטפורמה (Meta `effective_status` / Google `status` / ' +
          'TikTok `secondary_status`) מצביע ש**הם לא דולקים כרגע**. הנתונים בדוח ' +
          'משקפים היסטוריה — אם תחליט לחדש קמפיין, התוצאות העתידיות עשויות להיות ' +
          'שונות (creative fatigue / audience saturation שהצטברו מאז ההפסקה).',
      );
      out.push('');
      out.push(`| קמפיין | פלטפ׳ | חנות | הוצאה בטווח | ROAS היסטורי | סטטוס |`);
      out.push(`|---|---|---|---|---|---|`);
      for (const o of offCampaigns) {
        const cleanStatus = o.status.replace(/^ADGROUP_STATUS_/, '').replace(/^CAMPAIGN_/, '');
        out.push(
          `| ${escapeMd(o.name)} | ${o.platform} | ${o.store} | ${fmtCad(
            o.spend,
          )} | ${o.roas > 0 ? fmtNum(o.roas, 2) : '—'} | ${cleanStatus} |`,
        );
      }
      out.push('');
    }
  }

  // ===== TikTok Deep-Dive (when TikTok data exists) =====
  // Phase 05.7.x — TikTok is the newest platform in the pipeline and its
  // attribution model differs from Meta/Google (no Pixel-style modeled
  // conversions; complete_payment is the canonical purchase event).
  // Worth its own section so the operator + AI can reason about it on
  // its own terms rather than blending with Meta/Google.
  // Gate on both raw spend AND filtered TikTok presence so a fully-off store
  // with historical TikTok spend doesn't render the deep-dive (review defect 1).
  // campaignsList is already derived from campaignsOn (filtered set).
  const tiktokOn = campaignsList.some(c => c.platform === 'TikTok');
  if (ttSpend > 0 && tiktokOn) {
    const ttCampaigns = campaignsList.filter(c => c.platform === 'TikTok');
    const ttOrders = orders.filter(o => o.source === 'tiktok-paid');
    const ttOrderRevenue = ttOrders.reduce((s, o) => s + o.totalCad, 0);
    const ttAov = ttOrders.length > 0 ? ttOrderRevenue / ttOrders.length : 0;
    const ttRoasShopify = ttSpend > 0 ? ttOrderRevenue / ttSpend : 0;
    const ttPlatformValue = ttCampaigns.reduce((s, c) => s + c.value, 0);
    const ttRoasPlatform = ttSpend > 0 ? ttPlatformValue / ttSpend : 0;

    out.push('## TikTok — צלילה ייעודית');
    out.push('');
    out.push(
      '**הקשר**: TikTok Marketing API מדווח `complete_payment` (purchase events) ' +
        'באופן עצמאי מ-Meta/Google. ה-attribution שלו פחות אגרסיבי (אין view-through-' +
        'rich-modeled כמו Meta). מומלץ לראות אותו כ-channel נפרד עם KPI נפרדים.',
    );
    out.push('');
    out.push(`| מטריקה | ערך |`);
    out.push(`|---|---|`);
    out.push(`| הוצאה בטווח | ${fmtCad(ttSpend)} |`);
    out.push(`| ערך המרות (TikTok report) | ${fmtCad(ttPlatformValue)} |`);
    out.push(`| ROAS לפי TikTok (Pixel) | ${ttRoasPlatform > 0 ? fmtNum(ttRoasPlatform, 2) : '—'} |`);
    out.push(`| הזמנות Shopify שתויגו tiktok-paid | ${fmtNum(ttOrders.length)} |`);
    out.push(`| הכנסות Shopify מ-tiktok-paid | ${fmtCad(ttOrderRevenue)} |`);
    out.push(`| ROAS לפי Shopify (deterministic) | ${ttRoasShopify > 0 ? fmtNum(ttRoasShopify, 2) : '—'} |`);
    out.push(`| AOV של לקוחות TikTok | ${ttAov > 0 ? fmtCad(ttAov) : '—'} |`);
    out.push(`| מספר קמפיינים פעילים בטווח | ${fmtNum(ttCampaigns.length)} |`);
    out.push('');

    if (ttCampaigns.length > 0) {
      out.push('### קמפיינים פעילים ב-TikTok');
      out.push('');
      out.push(`| קמפיין | אד-גרופ | הוצאה | ROAS Pixel | המרות | CTR | CPC |`);
      out.push(`|---|---|---|---|---|---|---|`);
      for (const c of ttCampaigns.slice(0, 10)) {
        out.push(
          `| ${escapeMd(c.name)} | — | ${fmtCad(c.spend)} | ${c.roas > 0 ? fmtNum(c.roas, 2) : '—'} | ${fmtNum(c.conversions)} | ${c.impressions > 0 ? fmtPct(c.ctr, 2) : '—'} | ${c.clicks > 0 ? fmtCad(c.cpc) : '—'} |`,
        );
      }
      out.push('');
    }

    // Comparison: TikTok-side gap (Pixel vs Shopify) — same logic as the
    // overall section but TikTok-isolated, because TikTok's ATT impact +
    // age skew can differ from Meta's.
    if (ttPlatformValue > 0 && ttOrderRevenue > 0) {
      const gap = ttOrderRevenue - ttPlatformValue;
      const gapPct = ttOrderRevenue > 0 ? gap / ttOrderRevenue : 0;
      out.push(
        `**פער TikTok ↔ Shopify**: ${fmtCad(gap)} (${gapPct >= 0 ? '+' : ''}${(gapPct * 100).toFixed(0)}%). ` +
          (Math.abs(gapPct) < 0.15
            ? 'TikTok ו-Shopify מסכימים — אפשר לסמוך על Pixel ROAS.'
            : gapPct > 0
              ? 'Shopify רואה יותר מ-TikTok — ה-Pixel תת-מדווח (probably attribution windows / ad-blockers).'
              : 'TikTok מדווח יותר מ-Shopify — possibly modeled conversions או double-attribution. בדוק את ה-Pixel.'),
      );
      out.push('');
    }
    out.push(
      '**KPI להמלצה ל-TikTok**: ה-ROAS Shopify (deterministic) הוא הקנה-מידה — לא ה-Pixel. ' +
        'אם ROAS Shopify > 2.0 עם CPM יציב → מועמד להעלאת תקציב. AOV נמוך משמעותית ' +
        'מ-Meta? סימן שהקהל ב-TikTok חוזר על הזמנות זולות יותר — שווה לבדוק upsell post-purchase.',
    );
    out.push('');
  }

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
  // Ads-off Phase 4: only build adsets for on campaigns.
  for (const c of campaignsOn) {
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
      // AUDIT ALG-06 + ALG-09 (2026-05-24, Phase 12.1.2): direct map.get
      // on the storeId-scoped composite key. Pre-fix the matchingKey
      // suffix scan returned the FIRST match across stores, so two
      // stores sharing the same (platform, campaignId) both got the
      // FIRST store's adsets in their drill-down. Also removes the
      // ALG-09 dead conditional `c.store === c.platform ? '' : ''`
      // (always-empty cKey that was never read anyway). Evidence:
      // raw-returns/lib_algorithm_aiReport.json (ALG-06 site #2,
      // ALG-09).
      const adsetKey = `${c.storeId}::${c.platform}::${c.campaignId}`;
      const bucket = adsetsByCampaign.get(adsetKey) ?? null;
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

  // ===== Ad-level (creative) drill-down — Phase 05.7.x =====
  //
  // The deepest drill-down the dashboard has. Two slices:
  //   1. Per-campaign: top creatives inside each of the top 5 spend campaigns
  //      (mirrors the AdsDrawer view in the UI).
  //   2. Cross-campaign winners + losers: the 5 best creatives by ROAS across
  //      ALL campaigns (with spend floor to filter noise), and the 5 biggest
  //      cash drains (high spend + low ROAS).
  //
  // Why this matters for the AI's recommendations: a campaign that looks bad
  // overall can have ONE great creative carrying it (kill the rest), and a
  // campaign that looks great can have ONE bad creative dragging the average.
  // The campaign-level + ad-set-level views above can't show this.
  // Ads-off Phase 4: filter out ads from off (store, platform) pairs.
  const adsOn = ads.filter(a => !isAdOff(a));
  if (adsOn.length > 0) {
    // Aggregate to (storeId, platform, campaignId, adSetId, adId).
    type AdAgg = {
      storeName: string;
      platform: string;
      campaignName: string;
      adSetName: string;
      adName: string;
      spend: number;
      impressions: number;
      clicks: number;
      conversions: number;
      conversionValue: number;
      // For grouping back into per-campaign tables below.
      campaignKey: string;
    };
    const adAgg = new Map<string, AdAgg>();
    for (const a of adsOn) {
      if (!a.adId) continue;
      const adKey = `${a.storeId}::${a.platform}::${a.campaignId}::${a.adSetId}::${a.adId}`;
      const existing = adAgg.get(adKey);
      if (existing) {
        existing.spend += a.spend;
        existing.impressions += a.impressions;
        existing.clicks += a.clicks;
        existing.conversions += a.conversions;
        existing.conversionValue += a.conversionValue;
      } else {
        adAgg.set(adKey, {
          storeName: a.storeName,
          platform: a.platform,
          campaignName: a.campaignName,
          adSetName: a.adSetName,
          adName: a.adName,
          spend: a.spend,
          impressions: a.impressions,
          clicks: a.clicks,
          conversions: a.conversions,
          conversionValue: a.conversionValue,
          campaignKey: `${a.storeId}::${a.platform}::${a.campaignId}`,
        });
      }
    }

    // Slice 1 — per-campaign top creatives for the top-5-spend campaigns.
    // Use the same `topCampaignsForDrill` list defined earlier so the
    // section reads consistently with the ad-set drill-down above.
    if (topCampaignsForDrill.length > 0) {
      out.push('## מודעות (creatives) — drill-down בתוך 5 הקמפיינים');
      out.push('');
      out.push(
        '_זום פנימה ברמת המודעה הבודדת. CTR ו-ROAS פר creative חושף איזו מודעה נושאת את הקמפיין ' +
          'ואיזו גוררת אותו למטה. כיבוי מודעה אחת חלשה בתוך קמפיין מצליח עדיף על-פני כיבוי כל הקמפיין._',
      );
      out.push('');
      for (const c of topCampaignsForDrill) {
        // AUDIT ALG-06 (2026-05-24, Phase 12.1.2): filter by exact
        // storeId-scoped composite key. Pre-fix suffix endsWith()
        // matched ANY store's ads under (platform, campaignId),
        // silently merging cross-store creatives into one drill-down.
        // adAgg.campaignKey is set to `${storeId}::${platform}::${campaignId}`
        // (no ad-set / ad-id suffix), so === is the correct comparison.
        const adKey = `${c.storeId}::${c.platform}::${c.campaignId}`;
        const matchingAds = Array.from(adAgg.values())
          .filter(a => a.campaignKey === adKey)
          .map(a => ({
            ...a,
            roas: a.spend > 0 ? a.conversionValue / a.spend : 0,
            ctr: a.impressions > 0 ? a.clicks / a.impressions : 0,
            cpa: a.conversions > 0 ? a.spend / a.conversions : 0,
          }))
          .filter(a => a.spend > 0 || a.impressions > 0)
          .sort((a, b) => b.spend - a.spend)
          .slice(0, 8);
        if (matchingAds.length === 0) continue;
        out.push(`### ${c.platform} — ${escapeMd(c.name)} (${c.store})`);
        out.push(`_הוצאת קמפיין: ${fmtCad(c.spend)} · ${matchingAds.length} מודעות בטופ_`);
        out.push('');
        out.push(`| מודעה | אד-סט | הוצאה | חשיפות | CTR | המרות | ROAS | CPA |`);
        out.push(`|---|---|---|---|---|---|---|---|`);
        for (const a of matchingAds) {
          out.push(
            `| ${escapeMd(a.adName) || '—'} | ${escapeMd(a.adSetName)} | ${fmtCad(a.spend)} | ${fmtNum(a.impressions)} | ${a.ctr > 0 ? fmtPct(a.ctr, 2) : '—'} | ${fmtNum(a.conversions)} | ${a.roas > 0 ? fmtNum(a.roas, 2) : '—'} | ${a.cpa > 0 ? fmtCad(a.cpa) : '—'} |`,
          );
        }
        out.push('');
      }
    }

    // Slice 2 — cross-campaign winners + losers. Spend floor avoids
    // statistical noise (a single conversion on $5 spend would otherwise
    // rocket to a "winner" with ROAS=20).
    const AD_SPEND_FLOOR = 25; // CAD
    const adsWithMetrics = Array.from(adAgg.values())
      .filter(a => a.spend >= AD_SPEND_FLOOR)
      .map(a => ({
        ...a,
        roas: a.spend > 0 ? a.conversionValue / a.spend : 0,
        ctr: a.impressions > 0 ? a.clicks / a.impressions : 0,
        cpa: a.conversions > 0 ? a.spend / a.conversions : 0,
      }));

    if (adsWithMetrics.length >= 5) {
      const winners = [...adsWithMetrics]
        .filter(a => a.conversions >= 2 && a.roas >= 2.0)
        .sort((a, b) => b.roas - a.roas)
        .slice(0, 5);
      const losers = [...adsWithMetrics]
        .filter(a => a.roas < 1.5 || (a.conversions === 0 && a.spend >= 100))
        .sort((a, b) => b.spend - a.spend)
        .slice(0, 5);

      if (winners.length > 0) {
        out.push('## 🏆 Creative winners — מודעות מובילות לפי ROAS');
        out.push('');
        out.push(
          `_מסנן: ≥ ${fmtCad(AD_SPEND_FLOOR)} הוצאה + ≥ 2 המרות + ROAS ≥ 2.0 (כדי לא להרים מודעה עם המרה אחת מקרית). ` +
            'אלה הקריאייטיבים שמושכים — לפני סקייל של הקמפיין כולו, שווה לראות אם אפשר לרכז תקציב על המודעה המנצחת._',
        );
        out.push('');
        out.push(`| מודעה | קמפיין | אד-סט | הוצאה | המרות | CTR | ROAS |`);
        out.push(`|---|---|---|---|---|---|---|`);
        for (const a of winners) {
          out.push(
            `| ${escapeMd(a.adName) || '—'} | ${escapeMd(a.campaignName)} | ${escapeMd(a.adSetName)} | ${fmtCad(a.spend)} | ${fmtNum(a.conversions)} | ${a.ctr > 0 ? fmtPct(a.ctr, 2) : '—'} | ${fmtNum(a.roas, 2)} |`,
          );
        }
        out.push('');
      }

      if (losers.length > 0) {
        out.push('## 💸 Creative drainers — מודעות שגורעות');
        out.push('');
        out.push(
          `_מסנן: ≥ ${fmtCad(AD_SPEND_FLOOR)} הוצאה + (ROAS < 1.5 או 0 המרות עם ≥ ${fmtCad(100)} הוצאה). ` +
            'מודעה במצב הזה לרוב גוררת את ה-CPM של ה-ad-set שלה למעלה — כיבוי שלה לבד (לא כל הקמפיין) ' +
            'יכול לשפר את הביצועים של השאר באותו ad-set._',
        );
        out.push('');
        out.push(`| מודעה | קמפיין | אד-סט | הוצאה | המרות | CTR | ROAS |`);
        out.push(`|---|---|---|---|---|---|---|`);
        for (const a of losers) {
          out.push(
            `| ${escapeMd(a.adName) || '—'} | ${escapeMd(a.campaignName)} | ${escapeMd(a.adSetName)} | ${fmtCad(a.spend)} | ${fmtNum(a.conversions)} | ${a.ctr > 0 ? fmtPct(a.ctr, 2) : '—'} | ${a.roas > 0 ? fmtNum(a.roas, 2) : '0 (FAILED)'} |`,
          );
        }
        out.push('');
      }
    }
  }

  // ===== Multi-mapped products (Phase 05.7.x — 2026-05-23) =====
  //
  // Operator can map a product to multiple campaigns (different audiences,
  // creatives, platforms). Shopify revenue from that product is then split
  // across the campaigns proportionally to spend share (see
  // allocateProductRevenue in campaignProductMap.ts).
  //
  // Without surfacing this to the AI, a per-campaign recommendation could
  // over-credit one campaign for revenue it actually shares with others
  // ("Scale A — it owns product X" when A and B both have X mapped).
  //
  // The section is operator-side only (productMap lives in localStorage,
  // sent via the prop) — when missing or empty, skip.
  if (productMap && Object.keys(productMap).length > 0) {
    // Audit fix 2026-05-23 (CR-01 health-and-conclusions): the section
    // previously displayed `allocatedRev = totalNetRevenue * c.sharePct`
    // — a naive spend-share split that exactly the double-counting the
    // operator was warned about. Now we call `allocateProductRevenue`
    // (the same allocator the dashboard's per-row "ROAS Shopify" column
    // uses) so the AI gets per-(store, product, campaign) allocated
    // revenue with deterministic per-platform attribution, plus the
    // proportional fallback only for the unattributed orders.
    type SharedProduct = {
      productId: string;
      productTitle: string;
      storeId: string;
      sharingCampaigns: Array<{
        name: string;
        platform: string;
        spend: number;
        intraPlatformSpend: number;
        /** Real allocator output: full deter+fallback revenue credited
         *  to this campaign FOR THIS PRODUCT. */
        allocatedRevenue: number;
        /** Real allocator output: ONLY the platform-deterministic share
         *  (orders with fbclid/gclid/tt-source). 0 when no provable
         *  click-id traffic matched this campaign's platform. */
        deterministicRevenue: number;
      }>;
      totalNetRevenue: number;
    };
    // Reverse index: campaignKey → (name, platform, spend, storeId). Spend is
    // the per-campaign sum across the date range.
    type CampaignBucket = {
      key: string;
      name: string;
      platform: string;
      storeId: string;
      spend: number;
    };
    const campaignLookup = new Map<string, CampaignBucket>();
    for (const c of campaigns) {
      const key = `${c.storeId}::${c.platform}::${c.campaignId}`;
      const existing = campaignLookup.get(key);
      if (existing) {
        existing.spend += c.spend;
      } else {
        campaignLookup.set(key, {
          key,
          name: c.campaignName || '—',
          platform: c.platform,
          storeId: c.storeId,
          spend: c.spend,
        });
      }
    }

    // Per-store data structures the allocator needs. Built once, reused for
    // every multi-mapped product within that store.
    const productsByStore = new Map<string, Map<string, { netRevenueCad: number; units: number }>>();
    for (const p of products) {
      if (!p.productId) continue;
      const net = p.netRevenue ?? p.revenue;
      // Same true-empty skip the parent useCampaignTrueRevenue applies — drop
      // zero-zero rows but keep refund-only (units=0, net<0).
      if (net === 0 && p.units === 0) continue;
      let storeBucket = productsByStore.get(p.storeId);
      if (!storeBucket) {
        storeBucket = new Map();
        productsByStore.set(p.storeId, storeBucket);
      }
      const existing = storeBucket.get(p.productId);
      if (existing) {
        existing.netRevenueCad += net;
        existing.units += p.units;
      } else {
        storeBucket.set(p.productId, { netRevenueCad: net, units: p.units });
      }
    }

    const ordersByStore = new Map<string, Array<{
      storeId: string;
      source: string;
      fbclidPresent: boolean;
      gclidPresent: boolean;
      lineItems: Array<{ productId: string; units: number; revenueCad: number }>;
    }>>();
    for (const o of ordersRows ?? []) {
      if (!inRange(o.date, range)) continue;
      let bucket = ordersByStore.get(o.storeId);
      if (!bucket) {
        bucket = [];
        ordersByStore.set(o.storeId, bucket);
      }
      bucket.push({
        storeId: o.storeId,
        source: o.source,
        fbclidPresent: o.fbclidPresent,
        gclidPresent: o.gclidPresent,
        lineItems: o.lineItems ?? [],
      });
    }

    // Group campaigns by (storeId, productId) — mirrors the parent's
    // store-scoped allocator semantics. A product appearing in two stores
    // counts as two separate multi-mapped entries.
    const productCampaignsByStore = new Map<string, Map<string, CampaignBucket[]>>();
    for (const [campaignKey, productIds] of Object.entries(productMap)) {
      const parts = campaignKey.split('::');
      if (parts.length !== 3) continue;
      const [keyStoreId] = parts;
      // Audit fix 2026-05-23 (a/WARN-4): productMap keys are
      // `${storeId}::${platform}::${campaignId}`, so the "scope to the
      // selected store" check belongs in storeId-space. Pre-fix the
      // closure mis-named storeFilter (a display NAME) as
      // `storeFilterId` and then compared it against `c.storeName` —
      // correct for stores where displayName === id (uzoshop) but a
      // silent miss for stores where they diverge (zolplus → "Zol
      // Plus", usmile360 → "360usmile"), dropping all multi-mapping
      // entries for those stores. Now: when the caller provided
      // storeIdFilter, compare id-to-id directly (no campaign-scan
      // needed); otherwise fall back to the legacy name-via-campaign-
      // scan lookup.
      if (storeIdFilter) {
        if (keyStoreId !== storeIdFilter) continue;
      } else if (storeFilter) {
        const storeMatches = campaigns.some(
          c => c.storeId === keyStoreId && c.storeName === storeFilter,
        );
        if (!storeMatches) continue;
      }
      const campaign = campaignLookup.get(campaignKey);
      if (!campaign) continue;
      let storeIdx = productCampaignsByStore.get(keyStoreId);
      if (!storeIdx) {
        storeIdx = new Map();
        productCampaignsByStore.set(keyStoreId, storeIdx);
      }
      for (const pid of productIds) {
        if (!storeIdx.has(pid)) storeIdx.set(pid, []);
        storeIdx.get(pid)!.push(campaign);
      }
    }

    // Keep only products mapped to 2+ campaigns within a single store.
    const shared: SharedProduct[] = [];
    const productTitleByStoreAndId = new Map<string, string>();
    for (const p of products) {
      productTitleByStoreAndId.set(`${p.storeId}::${p.productId}`, p.productTitle);
    }

    for (const [storeId, perProduct] of productCampaignsByStore.entries()) {
      const storeProductsMap = productsByStore.get(storeId);
      if (!storeProductsMap) continue;
      const storeOrders = ordersByStore.get(storeId) ?? [];
      const storeCampaignSpend = new Map<string, number>();
      for (const c of campaignLookup.values()) {
        if (c.storeId === storeId) storeCampaignSpend.set(c.key, c.spend);
      }
      for (const [productId, campaignList] of perProduct.entries()) {
        if (campaignList.length < 2) continue;
        const productInfo = storeProductsMap.get(productId);
        if (!productInfo) continue; // no Shopify sales for this product in range

        // Allocate THIS one product's revenue across the campaigns that
        // map to it (within this store). Single-product input ensures the
        // returned map's `revenue` field is per-(campaign, product) — what
        // we need to display in the table.
        const alloc = allocateProductRevenue({
          storeId,
          map: productMap,
          productRevenue: [{
            productId,
            netRevenueCad: productInfo.netRevenueCad,
            units: productInfo.units,
          }],
          campaignSpend: storeCampaignSpend,
          orders: storeOrders,
        });

        const intraSpendByPlatform = new Map<string, number>();
        for (const c of campaignList) {
          intraSpendByPlatform.set(
            c.platform,
            (intraSpendByPlatform.get(c.platform) ?? 0) + c.spend,
          );
        }

        shared.push({
          productId,
          productTitle:
            productTitleByStoreAndId.get(`${storeId}::${productId}`) || productId,
          storeId,
          sharingCampaigns: campaignList.map(c => {
            const info = alloc.get(c.key);
            return {
              name: c.name,
              platform: c.platform,
              spend: c.spend,
              intraPlatformSpend: intraSpendByPlatform.get(c.platform) ?? c.spend,
              allocatedRevenue: info?.revenue ?? 0,
              deterministicRevenue: info?.deterministicRevenue ?? 0,
            };
          }),
          totalNetRevenue: productInfo.netRevenueCad,
        });
      }
    }

    if (shared.length > 0) {
      out.push('## 🔗 מוצרים משותפים בין כמה קמפיינים');
      out.push('');
      out.push(
        '_מוצרים שהמפעיל מיפה ל-2+ קמפיינים. שני סוגי תחרות שונים בתוך מוצר ' +
          'משותף — חשוב להבדיל ביניהם בהמלצה:_',
      );
      out.push('');
      out.push(
        '- **תחרות פנים-פלטפורמית** (לדוגמה 4 קמפיינים ב-Meta על אותו מוצר): ' +
          'אסטרטגיות שונות באותה זירה. ההכנסה הדטרמיניסטית של פלטפורמה זו ' +
          '(הזמנות עם click-id רלוונטי) מתחלקת בין הקמפיינים *של אותה הפלטפורמה* ' +
          'לפי spend share. סקייל של אחד עלול לגנוב נתח מהאחרים אם הקהל רווי.',
      );
      out.push(
        '- **תחרות בין-פלטפורמית** (לדוגמה 4 קמפיינים ב-Meta + 3 ב-TikTok): ' +
          'ערוצים מקבילים. כל פלטפורמה תופסת את ההכנסה הדטרמיניסטית שלה ' +
          'בנפרד (Meta מקבל את ההזמנות עם fbclid, TikTok מקבל את ההזמנות עם ' +
          'tiktok-UTM, וכו׳). השארית הלא-מסווגת מתחלקת לפי spend share על פני ' +
          'הכל. סקייל בין פלטפורמות בדרך כלל לא קניבליסטי — קהלים שונים.',
      );
      out.push('');
      // Sort by total net revenue descending — focus on the products that
      // matter most to the bottom line.
      shared.sort((a, b) => b.totalNetRevenue - a.totalNetRevenue);
      for (const sp of shared.slice(0, 15)) {
        // Group by platform for clearer per-platform competition signal.
        const byPlatform = new Map<string, typeof sp.sharingCampaigns>();
        for (const c of sp.sharingCampaigns) {
          if (!byPlatform.has(c.platform)) byPlatform.set(c.platform, []);
          byPlatform.get(c.platform)!.push(c);
        }
        const platformCount = byPlatform.size;
        const competitionType =
          platformCount === 1
            ? `תחרות פנים-פלטפורמית בלבד (${sp.sharingCampaigns.length} קמפיינים)`
            : `מעורב — ${platformCount} פלטפורמות`;
        out.push(
          `### ${escapeMd(sp.productTitle)} · ${competitionType} · ` +
            `סך נטו: ${fmtCad(sp.totalNetRevenue)}`,
        );
        out.push('');
        // Render one mini-table per platform so intra-platform rivalry
        // is visually separate from cross-platform parallel channels.
        for (const [platform, platformCampaigns] of byPlatform.entries()) {
          const intraSpend = platformCampaigns.reduce((s, c) => s + c.spend, 0);
          out.push(
            `**${platform}** — ${platformCampaigns.length} קמפיינים, סך הוצאה: ${fmtCad(intraSpend)}`,
          );
          out.push('');
          out.push(`| קמפיין | הוצאה | חלק מההוצאה (פנים-פלטפורמי) | הכנסה דטרמיניסטית | הכנסה מוקצית (סה"כ) |`);
          out.push(`|---|---|---|---|---|`);
          const sortedCampaigns = [...platformCampaigns].sort((a, b) => b.spend - a.spend);
          for (const c of sortedCampaigns) {
            const intraPct = intraSpend > 0 ? c.spend / intraSpend : 1 / platformCampaigns.length;
            // Audit fix 2026-05-23 (CR-01): real allocator output replaces
            // the naive `totalNetRevenue * sharePct` split. `deterministicRevenue`
            // is the platform-attributed portion (provable from this platform's
            // click-id traffic); `allocatedRevenue` adds the spend-proportional
            // share of the remaining unattributed orders.
            out.push(
              `| ${escapeMd(c.name)} | ${fmtCad(c.spend)} | ${fmtPct(intraPct)} | ` +
                `${fmtCad(c.deterministicRevenue)} | ${fmtCad(c.allocatedRevenue)} |`,
            );
          }
          out.push('');
        }
      }
      if (shared.length > 15) {
        out.push(`_(מוצגים 15 מתוך ${shared.length} מוצרים משותפים — ממוין לפי הכנסה יורדת.)_`);
        out.push('');
      }
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
  // AUDIT ALG-02 (2026-05-24, Phase 12.2.1): budget allocation includes
  // TikTok in totalSpendAll. Pre-fix: totalSpendAll = metaSpend +
  // googleSpend excluded TikTok entirely, so TikTok-heavy stores
  // (uzoshop) saw Meta 50% / Google 50% even when TikTok was 60% of
  // actual spend. Contradicted every other section in the report (Top
  // summary, per-platform CPM, TikTok deep-dive) which all include
  // TikTok. TikTok row is gated on `ttSpend > 0` mirroring the
  // conditional already used in the Top Summary at line 240.
  // Evidence: .planning/phases/12-codebase-audit-baseline/raw-returns/
  //   lib_algorithm_aiReport.json (ALG-02 lines 19-27).
  out.push('## חלוקת תקציב לפי פלטפורמה');
  out.push('');
  // Local accumulators (`metaSpendBA` / `googleSpendBA` / `ttSpendBA`) are
  // disambiguated from the file-scope `fbSpend` / `gaSpend` / `ttSpend`
  // computed in the Summary KPIs block (line ~175-186). Same values, but
  // keeping the names distinct avoids shadowing the outer block-scoped
  // `ttSpend` and makes the budget-allocation hunk self-contained.
  let metaSpendBA = 0, googleSpendBA = 0;
  let ttSpendBA = 0;
  for (const r of daily) {
    metaSpendBA += r.fbSpend;
    googleSpendBA += r.gaSpend;
    ttSpendBA += r.ttSpend ?? 0;
  }
  const totalSpendAll = metaSpendBA + googleSpendBA + ttSpendBA;
  if (totalSpendAll > 0) {
    out.push(`| פלטפורמה | הוצאה | % מסך תקציב |`);
    out.push(`|---|---|---|`);
    out.push(`| Meta | ${fmtCad(metaSpendBA)} | ${(metaSpendBA / totalSpendAll * 100).toFixed(0)}% |`);
    out.push(`| Google | ${fmtCad(googleSpendBA)} | ${(googleSpendBA / totalSpendAll * 100).toFixed(0)}% |`);
    if (ttSpendBA > 0) {
      out.push(`| TikTok | ${fmtCad(ttSpendBA)} | ${(ttSpendBA / totalSpendAll * 100).toFixed(0)}% |`);
    }
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
  // Phase 12.5.x (2026-05-24, operator requirement): the AI's response
  // must be RTL-aligned, handle mixed Hebrew/English gracefully (English
  // words inline within Hebrew sentences without breaking the line), and
  // read like a McKinsey/BCG executive briefing — not like a chatbot
  // generic answer. The block below is INTENTIONALLY at the top so the
  // AI sees the formatting contract before reading the analysis tasks.
  out.push('### עיצוב התשובה (חובה — קרא לפני שתענה)');
  out.push('');
  out.push(
    '- **כיוון טקסט**: כל התשובה ב-**עברית, יישור ימין-לשמאל (RTL)**. ' +
      'אל תוסיף תגי HTML; ה-renderer של הצ\'אט מזהה עברית ומיישר אוטומטית. ' +
      'אל תכתוב משפטים שמתחילים באנגלית — תמיד פתח כל שורה במילה עברית כדי ' +
      'שהיישור יישאר ימני.',
  );
  out.push(
    '- **עברית עם מילים באנגלית**: כשאתה משלב מונח באנגלית בתוך משפט עברי ' +
      '(שמות מוצרים, מטריקות כמו ROAS / CPM / CTR, שמות פלטפורמות) — כתוב ' +
      'את האנגלית **כפי שהיא** בתוך המשפט העברי, ללא ציטוטים, ללא הפיכת ' +
      'סדר. ה-Unicode bidi algorithm יטפל בכיוון. דוגמה תקינה: "ROAS של ' +
      'קמפיין Holiday Push ב-Meta היה 3.4 השבוע". אל תפצל משפט לשתי שורות ' +
      'בגלל מילה באנגלית; משפט אחד = שורה אחת.',
  );
  out.push(
    '- **מספרים וסימני מטבע**: השאר נקודה עשרונית באנגלית (3.4 ולא ‎3,4), ' +
      'סימן מטבע (CAD / ₪ / $) **לפני** המספר ("CAD 1,250" לא "1,250 CAD"). ' +
      'אחוזים אחרי המספר ("12%"). הפרדת אלפים בפסיק.',
  );
  out.push(
    '- **רמת התשובה**: רמת **דוח מנהלים של חברה גדולה** (CEO Briefing / ' +
      'Board-level memo). לא chatbot. לא tutorial. לא "אני ממליץ ש...". כתיבה ' +
      'תזה-ראשונה ("ROAS Shopify ירד 18% השבוע ב-uzoshop בגלל קמפיין X — ' +
      'הצעד הבא הוא Y"). מבנה דוח: **תקציר מנהלים → ממצאים → המלצות פעולה ' +
      '→ KPIs למעקב**. השתמש בטבלאות לכל השוואה של מספרים. כל המלצה צריכה ' +
      'להיות **מספרית + שמית** (שם קמפיין/מוצר + מספר ספציפי, לא "לשפר את ' +
      'הקריאייטיב").',
  );
  out.push(
    '- **טון**: ישיר, סמכותי, ללא מילוי או "ראוי לציין". אל תכתוב ' +
      '"כדאי לשקול" — כתוב "הפעולה הנדרשת היא X". אל תכתוב "ניתן לראות" — ' +
      'כתוב "הנתונים מראים X". אל תפתח משפטים ב-"בסך הכל" / "לסיכום" / ' +
      '"בנוסף" אלא אם אתה באמת מסכם מקטע.',
  );
  out.push(
    '- **מבנה ויזואלי**: לכל מקטע כותרת ‎## או ‎###. השתמש בטבלאות ' +
      '(`| עמודה | עמודה |`) לכל השוואה של 3+ מספרים. אל תפתח רשימות אם ' +
      'יש פחות מ-3 פריטים — שלב במשפט. השתמש ב-**bold** רק לדגשים ' +
      'קריטיים, לא לכל שני מילים. אל תוסיף emojis (חוץ מאלה שמופיעים ' +
      'בנתונים המקוריים, אם בכלל).',
  );
  out.push('');
  out.push('### הפרסונה');
  out.push('');
  out.push(
    'אתה **Senior E-commerce Performance Strategist** ברמה של הכי-טוב-בתעשייה ' +
      '(Common Thread Collective / Tier 11 / Disruptive Advertising). אל תהיה ' +
      'מנומס — תהיה ישיר, מספרי, ומכוון פעולה. הימנע מ-platitudes ("צריך לשפר ' +
      'את הקריאייטיב") — תן הצעה ספציפית עם מספר ושם קמפיין/מוצר.',
  );
  out.push('');
  out.push('### הקשר עסקי');
  out.push(
    '- **יעד ROAS פנימי**: 3.0+ (כתום מעל 2.5, ירוק מעל 2.7, כחול מעל 3.0).' +
      ' מתחת ל-2.0 = הפסד.',
  );
  out.push('- **COGS משוער**: לפי שיעור לכל חנות (השיעור המוגדר לכל חנות). רווח תפעולי = הכנסות − פרסום − COGS.');
  // Explicit per-store COGS rate disclosure (2026-06-02): names the ACTUAL
  // rate getCogsRateForStore returns for each in-scope store rather than a
  // generic "per store" — keeps the report honest about the inputs. The rate
  // is keyed by storeId (env-var convention), but we label by display name.
  {
    const seen = new Map<string, string>(); // storeName -> storeId (first seen)
    for (const r of daily) {
      if (!seen.has(r.storeName)) seen.set(r.storeName, r.storeId);
    }
    for (const [sName, sId] of seen) {
      out.push(`  - ${sName}: COGS ${(getCogsRateForStore(sId) * 100).toFixed(0)}%`);
    }
  }
  out.push(
    '- **שלוש חנויות**: uzoshop, Zol Plus, 360usmile. כל אחת קהל ומוצרים שונים — ' +
      'אל תאחד מסקנות אם המספרים לכל חנות מספרים סיפור שונה.',
  );
  out.push(
    '- **שני מקורות אמת לROAS**: (1) Shopify-side = הכנסות / הוצאה (אמין 100%). ' +
      '(2) Pixel-side ברמת קמפיין = conversion_value / spend (מ-Meta/Google API, ' +
      'יכול להיות לא מדויק בגלל iOS 14+ ATT, view-through, modeled conversions). ' +
      'התבסס על Shopify-side ל-decisions; ב-Pixel-side השתמש רק לשקול-תקציב יחסי ' +
      'בין קמפיינים.',
  );
  out.push('');
  out.push('### חלק 1 — הערכת מצב (Diagnostic)');
  out.push(
    '**1.1 הסיפור בכותרת אחת**: שורה אחת שמסכמת את התקופה (מגמה + רווחיות + ' +
      'בעיית-מפתח אם יש). דוגמה: "ROAS Shopify 2.4 (מתחת ליעד), נחלש מ-2.8 ' +
      'במחצית הראשונה ל-2.0 בשנייה, בעיקר בגלל קמפיין X שמייצר 35% מההוצאה ועלות ' +
      'CPA שלו זינקה מ-$40 ל-$67."',
  );
  out.push(
    '**1.2 רווחיות**: רווח תפעולי (הכנסות − פרסום − COGS). אם שלילי — דגל אדום ראשון. אם חיובי אבל ' +
      'נמוך (<10% מההכנסות) — דגל צהוב.',
  );
  out.push(
    '**1.3 כיול אמינות**: התבונן בטבלת "פער Pixel ↔ Shopify". אם הפער > 20% ' +
      '— ROAS הפלטפורמות כמעט חסר ערך לדיון על קמפיינים בודדים; ה-Shopify-side ' +
      'הוא הקובע. אם הפער < 10% — אפשר לסמוך גם על ROAS ברמת קמפיין.',
  );
  out.push(
    '**1.4 מקור התנועה האמיתי**: התבונן בטבלת "תנועה לפי מקור". כמה אחוז מההכנסות ' +
      'הגיעו מ-paid Meta/Google/TikTok? כמה מ-direct/organic? אם paid < 50% → ' +
      'הקמפיינים אולי מספקים awareness שלא נספר ב-ROAS isolation.',
  );
  out.push('');
  out.push('### חלק 2 — אבחון קמפיינים (Campaign Triage)');
  out.push(
    '**2.0 קרא את ה-Health Score קודם**: התחל מטבלת "Campaign Health Score". ' +
      'הציון (A/B/C/D/F) הוא הכותרת — אבל ההמלצה תתבסס על *פירוט הרכיבים*: ' +
      'רווחיות / נפח / מומנטום / attribution. ציון F עם רווחיות 0 = ROAS אמיתי ' +
      'נמוך; ציון F עם attribution 30 = הקמפיין אולי עובד אבל אין click-id לראות זאת.',
  );
  out.push(
    '**2.1 קמפיינים לסקייל (לפי הסדר)**: רשום 1-3 קמפיינים שמצדיקים העלאת תקציב ' +
      '+20-40%. קריטריונים מצטברים: (א) **Health Score A או B** (75+ נקודות) ' +
      '(ב) פער Pixel↔Shopify (בטבלת "השוואת ROAS לקמפיין") < ±15% — כלומר ה-ROAS ' +
      'שאתה רואה הוא אמיתי (ג) CPM יציב (CV<0.25 לפי טבלת תנודתיות) (ד) במצב ' +
      '**מאיץ** או **יציב** בטבלת מומנטום (ה) הוצאה ≥ $200 בטווח (ו) **לא ' +
      'מופיע בטבלת "קמפיינים כבויים כעת"**. לכל קמפיין: שם + תקציב חדש מומלץ ' +
      '+ הצדקה במספרים.',
  );
  out.push(
    '**2.1a חשוב על מיפויים משותפים — שני סוגי תחרות שונים**:',
  );
  out.push(
    '   **(a) פנים-פלטפורמית** (4 קמפיינים ב-Meta על אותו מוצר): כל הקמפיינים ' +
      'באותה זירה מתחרים על אותו קהל. ה-ROAS של כל אחד מהם *כבר מנוכה* לפי ' +
      '"חלק מההוצאה (פנים-פלטפורמי)" (טבלת "🔗 מוצרים משותפים"). סקייל קמפיין ' +
      'אחד בקבוצה הזו עלול לגנוב נתח מהאחרים אם הקהל באותה פלטפורמה רווי. ' +
      'המלצה צריכה להיות "סקייל המנצח בקבוצה, סגור את החלשים" — לא "סקייל ' +
      'כל הקבוצה". כשהקמפיינים בקבוצה כן מבדילים אסטרטגיות (LAL vs Interest ' +
      'vs Retargeting) ו-CPM של כל אחד יציב — סקייל מקבילי בסדר.',
  );
  out.push(
    '   **(b) בין-פלטפורמית** (4 ב-Meta + 3 ב-TikTok על אותו מוצר): ערוצים ' +
      'מקבילים. ההזמנות עם fbclid הולכות לקבוצת Meta, הזמנות עם tiktok-UTM ' +
      'הולכות לקבוצת TikTok — קהלים שונים. ROAS פר-קבוצה (Meta vs TikTok) הם ' +
      'אותות *עצמאיים*. אפשר לסקייל את הפלטפורמה שמובילה ב-ROAS Shopify ' +
      'דטרמיניסטי בלי לגנוב מהשנייה. **אזהרה**: השארית הלא-מסווגת ' +
      '(direct/organic של אותו מוצר) מתחלקת לפי spend share על פני הכל — ' +
      'סקייל ערני שמכפיל הוצאה יגדיל את חלק של הפלטפורמה הזו בשארית גם אם ' +
      'התרומה הדטרמיניסטית של הפלטפורמה בפועל לא צמחה. השווה ROAS Shopify ' +
      'פלטפורמה ל-ROAS Shopify כללי כדי לזהות זאת.',
  );
  out.push(
    '**2.2 קמפיינים לעצור / לרענן (Pause/Investigate)**: רשום 1-3 קמפיינים שמבזבזים. ' +
      'התבסס על השילוב: **Health Score D או F** + ROAS Shopify deterministic < 1.5 ' +
      '(בטבלת "השוואת ROAS לקמפיין"). אם הציון נמוך אבל attribution-clarity הרכיב ' +
      'היחיד שגרר אותו למטה (כלומר רווחיות וקצב טובים) — לא לעצור, רק לתקן את ' +
      'ה-URL Parameters שיהיה click-id.',
  );
  out.push(
    '**2.3 קמפיינים במגמה שלילית**: בדוק טבלת "מומנטום קמפיינים". כל קמפיין ' +
      'במצב **נחלש** עם הוצאה ≥ $200 + ציון Health יורד = שווה התערבות (creative ' +
      'refresh, audience broadening, או pause). תן 1-2 שמות.',
  );
  out.push(
    '**2.4 קמפיינים חדשים שעולים**: כל מי שמסומן **חדש** או **מאיץ** וב-Health Score B+ ' +
      '— מועמדים לסקייל הדרגתי. תן הצעה.',
  );
  out.push(
    '**2.5 קמפיינים כבויים שראויים לחידוש**: התבונן בטבלת "קמפיינים כבויים כעת". ' +
      'אם קמפיין כבוי אבל ROAS היסטורי שלו היה > 2.5 והוא לא נחלש לפני שכבה — ' +
      'אולי שווה לחדש (היה Health A/B לפני ההפסקה). אם ROAS היסטורי < 1.5 — לא לחזור.',
  );
  out.push('');
  out.push('### חלק 3 — דיאגנוסטיקת משפך (Funnel Diagnosis)');
  out.push(
    '**3.1 איפה הדליפה?** התבונן בטבלת "משפך — מחשיפות להזמנות". זהה את החוליה ' +
      'הכי חלשה לפי benchmark:',
  );
  out.push('   - **CTR < 1.0%** → בעיית **creative או audience** (לא מושך / רחב מדי).');
  out.push(
    '   - **CTR גבוה (>1.5%) אבל conversion rate < 1.0%** → קליקים מגיעים אבל ' +
      'הלקוחות לא קונים. בעיה ב-**landing page / מחיר / hero offer**.',
  );
  out.push(
    '   - **CPM זוחל למעלה (טבלת תנודתיות → CV > 0.35 או CPM מקסימלי > 1.5× ' +
      'הממוצע)** → **creative fatigue / audience saturation**. צריך creative refresh.',
  );
  out.push(
    '**3.2 AOV per source**: בדוק טבלת "תנועה לפי מקור". אם AOV של paid-Meta ' +
      'נמוך משמעותית מ-AOV של direct/email → אתה מושך לקוחות "זולים" ב-Meta. ' +
      'אופציות: לעבור ל-upsell post-purchase, או להחליף creative ל-positioning ' +
      'יקר יותר.',
  );
  out.push('');
  out.push('### חלק 4 — תקציב + אסטרטגיה ערוצית');
  out.push(
    '**4.1 חלוקת תקציב פלטפורמות**: התבסס על "חלוקת תקציב לפי פלטפורמה" ועל ' +
      'תנודתיות CPM. אם פלטפורמה X מספקת **Shopify-side ROAS** גבוה ב-30%+ ' +
      'ותנודתיות נמוכה — הצע העברת 10-20% מהפלטפורמה השנייה (לא יותר; אסטרטגיה ' +
      '"scale by 20% per week" כדי לא להפר את ה-learning phase).',
  );
  out.push(
    '**4.2 TikTok specifically**: אם יש מקטע "TikTok — צלילה ייעודית" בדוח, ' +
      'התייחס אליו בנפרד. TikTok\'s `complete_payment` הוא purchase-specific (לא ' +
      'אגרגציה כללית כמו Meta\'s `actions`), והדמוגרפיה שונה. אל תאחד מסקנות עם ' +
      'Meta — שאל בנפרד: האם ROAS Shopify של TikTok ≥ 2.0? האם AOV של לקוחות ' +
      'TikTok דומה ל-AOV של Meta או נמוך משמעותית? מה הציון Health של הקמפיין ' +
      'הראשי?',
  );
  out.push(
    '**4.3 דפוסי יום**: בטבלת "ביצועים לפי יום בשבוע" — אם יש יום שמספק ROAS ' +
      'גבוה ב-50%+ מהממוצע, הצע day-parting (העלאת תקציב באותו יום). אם יש יום ' +
      'חלש מאוד — שווה לבדוק dayparting הפוך (organic spike בלי paid).',
  );
  out.push('');
  out.push('### חלק 5 — אבחון מוצרים');
  out.push(
    '**5.1 Hero products**: 2-3 מוצרים ברמת המכירות. הצע: (א) קמפיין ייעודי ' +
      'אם אין; (ב) הוספה ל-Shopping/PMax feed; (ג) bundle עם מוצרים חלשים יותר.',
  );
  out.push(
    '**5.2 מרג\'ין**: מוצרים עם נטו<70% מהברוטו ← הנחות גדולות/החזרים גבוהים. ' +
      'הצע: בדיקת תמחור, או החלפת הנחה ב-bundle.',
  );
  out.push(
    '**5.3 Dead inventory**: מוצרים שבעבר נמכרו אבל בטווח הזה 0 — לבדוק אם ' +
      'הוסרו מהקטלוג בכוונה או נשכחו.',
  );
  out.push('');
  out.push('### חלק 6 — אירועים חריגים');
  out.push(
    'אם יש טבלת "ימים חריגים" — לכל אנומליה תן השערה: מה גרם? (קמפיין חדש שעלה ' +
      'אותו יום? מבצע? viral creative? יום חג?). אם אין הסבר ברור — תן 2-3 ' +
      'השערות אפשריות וההצעה איך לחקור.',
  );
  out.push('');
  out.push('### חלק 7 — תכנית פעולה לשבוע הבא');
  out.push('**5 פעולות מספריות שאני אבצע השבוע** — כל אחת בפורמט:');
  out.push('   - **פעולה**: "להעלות תקציב של [שם קמפיין] מ-$X ל-$Y" / "להפסיק [שם]" / "להחליף creative ב-[ad-set]"');
  out.push('   - **הצדקה**: 1-2 מספרים מהדוח');
  out.push('   - **תוצאה צפויה**: מה אני מצפה לראות תוך 7 ימים');
  out.push('   - **סף-נסיגה**: אם המספר X לא משתפר תוך Y ימים → לחזור אחורה');
  out.push('');
  out.push('### חלק 8 — KPIs לשבוע');
  out.push(
    '3 מספרים שאני אעקוב אחריהם כל יום השבוע הבא (לא ROAS — משהו ספציפי יותר ' +
      'כמו "CPM של קמפיין X", "AOV של paid-Meta", "כיסוי deterministic").',
  );
  out.push('');
  out.push('### מבנה התשובה (Executive Briefing Format)');
  out.push('');
  out.push('פתח את התשובה במבנה הבא — לפי הסדר הזה בדיוק:');
  out.push('');
  out.push(
    '1. **תקציר מנהלים (Executive Summary)** — 3-5 משפטים בלבד. השורה ' +
      'הראשונה: ה-headline (ROAS, מגמה, בעיה ראשית). השאר: דירוג הבעיות ' +
      'לפי השפעה כספית.',
  );
  out.push(
    '2. **טבלת KPIs ראשיים** — טבלה אחת עם 5-7 מטריקות (Revenue, Spend, ' +
      'ROAS Shopify, Net Profit, AOV, Conversion Rate, CPM). כל שורה ' +
      'כוללת: השם, הערך, השינוי % מהתקופה הקודמת, וצבע (🟢/🟡/🔴) ' +
      'במידת הצורך.',
  );
  out.push(
    '3. **ממצאים מרכזיים** — 3-5 נקודות בכותרות ‎### עם 1-2 פסקאות לכל ' +
      'אחת. כל ממצא מבוסס על מספר ספציפי מהדוח.',
  );
  out.push(
    '4. **המלצות פעולה (Action Items)** — טבלה ממוספרת עם 5 פעולות. ' +
      'עמודות: מס\' / פעולה / השפעה צפויה ($) / מאמץ / Priority (1-3) / ' +
      'תנאי-נסיגה.',
  );
  out.push(
    '5. **KPIs למעקב יומי השבוע הבא** — 3 מטריקות ספציפיות (לא ROAS — ' +
      'משהו granular יותר).',
  );
  out.push(
    '6. **סיכום קצר** — 2 משפטים: הצעד הראשון של מחר.',
  );
  out.push('');
  out.push(
    '**פורמט סופי**: עברית, יישור RTL, מבוסס-תזה. שמות קמפיינים ומוצרים ' +
      '*בדיוק כמו שמופיעים* בדוח. אם נתון חסר, ציין "אין מספיק נתונים" — ' +
      'אל תמציא. אל תכתוב "אני חושב..." — כתוב "המספרים מצביעים על X, ' +
      'לכן Y". אל תוסיף disclaimers כמו "זה ייתכן" / "תלוי בהקשר" — תן ' +
      'את ההמלצה הטובה ביותר על סמך הנתונים שיש לך, וציין את הסיכון ' +
      '(אם רלוונטי) במשפט קצר.',
  );

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
