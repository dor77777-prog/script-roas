'use client';

import { useState } from 'react';
import { Info, TrendingUp, X } from 'lucide-react';
import {
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { CampaignRow } from '@/lib/campaigns';
import type { OrderAttributionRow, OrderSource } from '@/lib/ordersAttribution';
import { campaignKey, type ProductMap } from '@/lib/campaignProductMap';
import { pearson, pearsonWithLag } from '@/lib/attributionAnalysis';
import { CHART_COLORS } from '@/lib/chartColors';
import { enumerateDateRange } from '@/lib/dateRange';
import { PRODUCT_MAP_CHIP_KEY } from '@/lib/sessionKeys';
import { cn, formatCurrency, formatDate } from '@/lib/utils';
export { pearson, pearsonWithLag };

const LAG_IMPROVEMENT_THRESHOLD = 0.05;

/**
 * Day-by-day Meta-claim vs Shopify-actual reconciliation panel for a single
 * campaign. Visual contract + Hebrew copy + Recharts SVG colors all lifted
 * byte-identical from CampaignDrawer.tsx (pre-refactor lines 768-923 JSX +
 * lines 363-410 analysis IIFE + lines 1242-1279 pearson helpers).
 *
 * The named-exported helpers (`pearson`, `pearsonWithLag`) live in
 * attributionAnalysis.ts and are re-exported here for backwards compatibility.
 *
 * `buildReconciliation` (Option A from 04-PATTERNS.md) is the analysis seam:
 * the parent passes raw inputs, the helper returns the chart-ready series +
 * Pearson r + best lag. The component then renders unconditionally given a
 * non-null `reconciliation` prop.
 */

/**
 * Sum daily conversion value across all campaigns on a platform that map to
 * any of the requested products. This keeps Meta and Google reconciliation
 * symmetric instead of treating the drawer campaign as the only Meta source.
 *
 * WR-06 (5.2.2.1) NOTE: this site uses the legacy O(K * P) walk
 * (`Object.keys(productMap)` x `products.some(...)`) instead of the
 * pre-built `productToCampaigns` index in
 * `useCampaignTrueRevenue.ts:184-223` (FIX-15). Intentional: this
 * helper runs exactly twice per drawer open (one Meta call, one Google
 * call) with `productMap` already filtered to the drawer's store via
 * `key.startsWith(storeId::...)`, so the inner loop is bounded by the
 * tiny per-store key count (~tens). The hook's index is the canonical
 * hot-path optimization for the campaigns-table render loop; do NOT
 * copy it here without first measuring the drawer-open cost. If a
 * future maintainer needs to share the index, hoist it into a shared
 * lib (e.g., `productCatalog.ts`) consumed by both sites.
 */
function aggregateMappedConversionValue(
  rows: CampaignRow[] | undefined,
  platform: 'Meta' | 'Google' | 'TikTok',
  storeId: string,
  productMap: ProductMap | undefined,
  mappedIds: string[],
  rangeFrom: string,
  rangeTo: string,
): Map<string, number> {
  const byDate = new Map<string, number>();
  if (!rows || !productMap) return byDate;

  const wantedIds = new Set(mappedIds);
  const mappedKeys = new Set<string>();
  for (const key of Object.keys(productMap)) {
    if (!key.startsWith(`${storeId}::${platform}::`)) continue;
    const products = productMap[key] ?? [];
    if (products.some(pid => wantedIds.has(pid))) {
      mappedKeys.add(key);
    }
  }

  for (const row of rows) {
    if (row.storeId !== storeId) continue;
    if (row.platform !== platform) continue;
    if (row.date < rangeFrom || row.date > rangeTo) continue;
    const rowKey = campaignKey(row.storeId, row.platform, row.campaignId);
    if (!mappedKeys.has(rowKey)) continue;
    byDate.set(row.date, (byDate.get(row.date) ?? 0) + row.conversionValue);
  }

  return byDate;
}

/**
 * Reconciliation analysis seam (PATTERNS.md Option A). Returns a
 * chart-ready 4-series array (meta / google / organic / shopify) with
 * 4 Pearson values + best lag + darkTrafficPercent, or null when not
 * applicable (no mapped products, fewer than 5 paired days).
 *
 * Extended in Phase 5.2: accepts campaignsData (for Meta + Google
 * series), ordersData (for organic + shopify-actual series), and
 * productMap (for cross-campaign lookup).
 *
 * Pure function — no side effects, no IO. Safe to memoize on inputs.
 *
 * --------------------------------------------------------------------
 * WR-08 — DENOMINATION BOUNDARY (read before editing this function):
 * --------------------------------------------------------------------
 * The four output series are NOT all on the same accounting basis.
 * Three series come from different sources of truth:
 *
 *   - `meta`    = Σ `conversionValue` over Meta campaigns mapped to
 *                 the requested products. Platform CLAIM, post-window,
 *                 may include modeled / view-through attribution.
 *   - `google`  = Σ `conversionValue` over Google campaigns mapped to
 *                 the requested products. Platform CLAIM, same caveats.
 *   - `organic` = Σ mapped-product line-item revenueCad over orders
 *                 whose source is NOT meta-paid / NOT google-paid
 *                 (no fbclid, no gclid). Shopify-ACTUAL.
 *   - `shopify` = Σ mapped-product line-item revenueCad over ALL
 *                 orders regardless of source (paid + organic). The
 *                 ground-truth denominator the chart compares against.
 *
 * Consequence: `meta + google + organic` is NOT the same accounting
 * basis as `shopify`. Specifically a meta-paid order contributes its
 * `lineItem.revenueCad` to `shopify` AND its campaign's
 * `conversionValue` to `meta` — two different numbers on different
 * bases. The `darkTrafficPercent = round((1 - sumChannels / sumShopify)
 * * 100)` value below treats the ratio as if both denominators were
 * Shopify-actual, which they are not. When platform claims under-
 * report (typical post-iOS-14), `darkTrafficPercent` overstates the
 * organic gap. When platforms over-report (view-through, modeled),
 * the ratio can swing negative — the implementation only warns when
 * `sumChannels / sumShopify < 0.8`, so over-attribution is invisible
 * in this signal.
 *
 * This is INTENTIONAL: the operator's primary lens is "what the
 * platforms claim", and silently replacing meta/google with click-id
 * gated line-item revenue would change the chart's meaning without
 * the user noticing. The denomination mismatch is surfaced in the
 * MetaShopifyReconciliation component's chart-legend / explainer
 * copy below; do NOT remove that copy without re-evaluating this
 * comment.
 */
export function buildReconciliation(opts: {
  /**
   * Only `platform` is consumed — drives the `primaryChannel` selection
   * for the headline Pearson value (Meta / Google / Combined).
   *
   * WR-05: previously also accepted `dailyArr` and `campaignId`. Both
   * went unread once the analyzer switched to per-platform aggregation
   * across all campaigns mapped to the same products
   * (aggregateMappedConversionValue, CODEX-NEW-P1-01). Removed from
   * the signature so call sites stop paying memory cost for fields
   * the helper ignores.
   */
  summary: {
    platform: string;
  };
  mappedIds: string[];
  storeId: string;
  campaignsData?: { rows: CampaignRow[] } | null;
  ordersData?: { rows: OrderAttributionRow[] } | null;
  productMap?: ProductMap;
  rangeFrom: string;
  rangeTo: string;
}): {
  series: Array<{
    date: string;
    meta: number;
    google: number;
    tiktok: number;
    organic: number;
    shopify: number;
  }>;
  primaryChannel: 'Meta' | 'Google' | 'TikTok' | 'Combined';
  r: number | null;
  rGoogle: number | null;
  rTiktok: number | null;
  rOrganic: number | null;
  rCombined: number | null;
  bestLag: number;
  bestR: number | null;
  darkTrafficPercent: number;
} | null {
  const { summary, mappedIds, storeId, campaignsData, ordersData, productMap, rangeFrom, rangeTo } = opts;
  if (mappedIds.length === 0) return null;
  const dateList = enumerateDateRange(rangeFrom, rangeTo);
  if (dateList.length === 0) return null;
  // No longer gate on platform === 'Meta' — support Google campaigns too (Phase 5.2)
  const wantedIds = new Set(mappedIds);

  // Shopify actual: sum line-item revenue for mapped products, across ALL
  // orders regardless of source. This intentionally uses the same
  // orders-attribution proportional line-item revenue basis as the Organic
  // series below, so those two chart lines can be compared directly.
  // Fix for CODEX-NEW-P2-01.
  // FIX-02 (5.2.2.1): hitMapped boolean — skip only orders with NO mapped product. Keeps refund days in series. Matches analyzeProductChannel:1060-1069.
  const shopifyByDate = new Map<string, number>();
  if (ordersData?.rows) {
    for (const order of ordersData.rows) {
      if (order.storeId !== storeId) continue;
      if (!order.lineItems || order.lineItems.length === 0) continue;
      if (order.date < rangeFrom || order.date > rangeTo) continue;
      let mappedRevenue = 0;
      let hitMapped = false;
      for (const li of order.lineItems) {
        if (wantedIds.has(li.productId)) {
          hitMapped = true;
          mappedRevenue += li.revenueCad;
        }
      }
      if (!hitMapped) continue;   // skip only when NO mapped product hit; refund-cancel days (mappedRevenue=0 but hitMapped=true) stay in series
      shopifyByDate.set(order.date, (shopifyByDate.get(order.date) ?? 0) + mappedRevenue);
    }
  }

  // Meta channel - sum across ALL Meta campaigns mapped to the same products
  // (mirrors the Google loop). Was previously asymmetric - only used the
  // current drawer campaign's dailyArr, undercounting Meta when 2+ Meta
  // campaigns promote the same product. Fix for CODEX-NEW-P1-01.
  const metaByDate = aggregateMappedConversionValue(
    campaignsData?.rows,
    'Meta',
    storeId,
    productMap,
    mappedIds,
    rangeFrom,
    rangeTo,
  );

  // Build {date → google revenue}:
  // Sum conversionValue of ALL Google campaigns in this store that map to
  // any of the wantedIds (including the current campaign if it's Google).
  const googleByDate = aggregateMappedConversionValue(
    campaignsData?.rows,
    'Google',
    storeId,
    productMap,
    mappedIds,
    rangeFrom,
    rangeTo,
  );

  // Build {date → tiktok revenue}:
  // Sum conversionValue of ALL TikTok campaigns in this store mapped to any
  // of the wantedIds. Phase 05.7.9 — added when product-mapping was opened
  // for TikTok campaigns so the reconciliation panel can show all 3 paid
  // platforms side-by-side, not just Meta + Google.
  const tiktokByDate = aggregateMappedConversionValue(
    campaignsData?.rows,
    'TikTok',
    storeId,
    productMap,
    mappedIds,
    rangeFrom,
    rangeTo,
  );

  /**
   * Organic predicate (post-5.2.2.1 FIX-01, updated Phase 05.7.5 for tiktok-paid):
   * organic = NOT meta-paid AND NOT google-paid AND NOT tiktok-paid AND NOT other-paid
   *           AND NOT empty AND NOT fbclid/gclid present.
   */
  function isOrganicSource(order: { source: OrderSource | string; fbclidPresent?: boolean; gclidPresent?: boolean }): boolean {
    if (order.fbclidPresent) return false;
    if (order.gclidPresent) return false;
    if (order.source === 'meta-paid') return false;
    if (order.source === 'google-paid') return false;
    if (order.source === 'tiktok-paid') return false;  // Phase 05.7.5 — first-class TikTok paid bucket
    if (order.source === 'other-paid') return false;   // UTM-tagged paid non-Meta/non-Google/non-TikTok (e.g. influencer) — must not bucket as organic
    if (order.source === '') return false;             // classifier failure — not safe to default to organic
    return true;
  }

  // Build {date → organic revenue}:
  // Sum line-item revenue (partial-order attribution) for orders whose source
  // is organic (NOT meta-paid or google-paid) and that contain at least one
  // mapped product. Only count the mapped-product line items' revenueCad.
  // FIX-02 (5.2.2.1): hitMapped boolean — skip only orders with NO mapped product. Keeps refund days in series. Matches analyzeProductChannel:1060-1069.
  const organicByDate = new Map<string, number>();
  if (ordersData?.rows) {
    for (const order of ordersData.rows) {
      if (order.storeId !== storeId) continue;
      if (!isOrganicSource(order)) continue;
      if (!order.lineItems || order.lineItems.length === 0) continue;
      if (order.date < rangeFrom || order.date > rangeTo) continue;
      // Partial-order summation: only count revenue for mapped products
      let mappedRevenue = 0;
      let hitMapped = false;
      for (const li of order.lineItems) {
        if (wantedIds.has(li.productId)) {
          hitMapped = true;
          mappedRevenue += li.revenueCad;
        }
      }
      if (!hitMapped) continue;   // keep refund days (negative mappedRevenue) and exactly-cancelling refunds (mappedRevenue=0)
      organicByDate.set(order.date, (organicByDate.get(order.date) ?? 0) + mappedRevenue);
    }
  }

  // Compose the 5-series array (Phase 05.7.9 — added TikTok) aligned to
  // the user's full selected date window, not just days where the drawer
  // campaign was active.
  const series = dateList.map(date => ({
    date,
    meta: metaByDate.get(date) ?? 0,
    google: googleByDate.get(date) ?? 0,
    tiktok: tiktokByDate.get(date) ?? 0,
    organic: organicByDate.get(date) ?? 0,
    shopify: shopifyByDate.get(date) ?? 0,
  }));

  if (series.length < 5) return null; // not enough points for r

  // FIX-14 (5.2.2.1): Pearson over active days only. Long paused periods
  // produce zero-zero pairs that inflate r toward +1. Phase 05.7.9 — the
  // active-day filter now also includes TikTok so a TikTok-only ramp doesn't
  // get filtered out as "inactive" when Meta + Google were paused.
  const activeSeries = series.filter(
    s => s.meta + s.google + s.tiktok + s.organic + s.shopify > 0,
  );
  const r = pearson(activeSeries.map(s => s.meta), activeSeries.map(s => s.shopify));
  const rGoogle = pearson(activeSeries.map(s => s.google), activeSeries.map(s => s.shopify));
  const rTiktok = pearson(activeSeries.map(s => s.tiktok), activeSeries.map(s => s.shopify));
  const rOrganic = pearson(activeSeries.map(s => s.organic), activeSeries.map(s => s.shopify));
  const rCombined = pearson(
    activeSeries.map(s => s.meta + s.google + s.tiktok + s.organic),
    activeSeries.map(s => s.shopify),
  );
  const primaryChannel: 'Meta' | 'Google' | 'TikTok' | 'Combined' =
    summary.platform === 'Google' ? 'Google'
      : summary.platform === 'Meta' ? 'Meta'
      : summary.platform === 'TikTok' ? 'TikTok'
      : 'Combined';

  // Lag detection: try offsets -3..3, pick the one with the highest r.
  //
  // #WR-03: pearson on n=2 returns ±1.0 trivially (two points fit a
  // line perfectly), so a 5-day series with lag=3 leaves only 2 paired
  // points and spuriously beats the true r — firing a false "lag
  // detected" banner. Require at least 5 paired points AFTER shifting,
  // matching the outer series.length<5 gate. With lag=3 this means the
  // series itself must be >=8 days to even consider lag=±3.
  let bestLag = 0;
  let bestR = r;
  for (let lag = -3; lag <= 3; lag++) {
    if (lag === 0) continue;
    const effectiveN = series.length - Math.abs(lag);
    if (effectiveN < 5) continue; // n<5 makes |r| trivially close to 1
    const r2 = pearsonWithLag(series.map(s => s.meta), series.map(s => s.shopify), lag);
    if (r2 !== null && bestR !== null && r2 > 0 && r2 > bestR + LAG_IMPROVEMENT_THRESHOLD) {
      bestR = r2;
      bestLag = lag;
    }
  }

  // Dark traffic: if channels account for < 80% of Shopify actual, flag the gap
  //
  // Audit fix 2026-05-23 (FIND-02 display): TikTok was added to the chart
  // and rCombined in Phase 05.7.9 but missed here — silently excluding it
  // from sumChannels overstated darkTraffic on uzoshop's TikTok-active days
  // (operator saw a false "פער 50%" chip when real figure was ~20% and below
  // the 0.8 threshold). The bullet copy already promises "Σ של 4 הערוצים" —
  // make the math match.
  const sumChannels = series.reduce(
    (acc, s) => acc + s.meta + s.google + s.tiktok + s.organic,
    0,
  );
  const sumShopify = series.reduce((acc, s) => acc + s.shopify, 0);
  const darkTrafficPercent =
    sumShopify > 0 && sumChannels / sumShopify < 0.8
      ? Math.round((1 - sumChannels / sumShopify) * 100)
      : 0;

  return { series, primaryChannel, r, rGoogle, rTiktok, rOrganic, rCombined, bestLag, bestR, darkTrafficPercent };
}

type Props = {
  reconciliation: NonNullable<ReturnType<typeof buildReconciliation>>;
};

/**
 * TEST-04 (5.2.2.1): pure day-table delta label policy from FIX-16.
 */
export function computeDayDelta(channelTotal: number, shopify: number): {
  label: string;
  tone: 'neutral' | 'green' | 'red';
} {
  if (channelTotal === 0 && shopify > 0) return { label: 'Shopify only', tone: 'neutral' };
  if (channelTotal > 0 && shopify === 0) return { label: 'Channels only', tone: 'neutral' };
  if (channelTotal > 0 && shopify > 0) {
    const pct = ((channelTotal - shopify) / shopify) * 100;
    return {
      label: `${pct >= 0 ? '+' : ''}${pct.toFixed(0)}%`,
      tone: Math.abs(pct) < 20 ? 'green' : 'red',
    };
  }
  return { label: '—', tone: 'neutral' };
}

export function MetaShopifyReconciliation({ reconciliation }: Props) {
  const [chipHidden, setChipHidden] = useState(() => (
    typeof window !== 'undefined' && window.sessionStorage.getItem(PRODUCT_MAP_CHIP_KEY) === '1'
  ));
  const primaryChannel = reconciliation.primaryChannel;
  const primaryR =
    primaryChannel === 'Google' ? reconciliation.rGoogle
      : primaryChannel === 'Meta' ? reconciliation.r
      : primaryChannel === 'TikTok' ? reconciliation.rTiktok
      : reconciliation.rCombined;
  const primaryAbsR = primaryR === null ? null : Math.abs(primaryR);
  const primaryRClass =
    primaryAbsR === null ? 'text-text-muted'
      : primaryAbsR >= 0.7 ? 'text-roas-green'
      : primaryAbsR >= 0.3 ? 'text-amber-600'
      : 'text-roas-red';
  const noSignalTitle = 'אין שונות בסדרה — לא ניתן לחשב';
  const formatR = (value: number | null) => (
    value === null ? '—' : value.toFixed(2)
  );
  const renderR = (label: string, value: number | null) => (
    <span
      title={value === null ? noSignalTitle : undefined}
      className={cn(value === null && 'text-text-subtle')}
    >
      {label}={formatR(value)}
    </span>
  );

  return (
    <section>
      <h3 className="text-sm font-semibold text-text-primary inline-flex items-center gap-1.5 mb-2">
        <TrendingUp size={14} className="text-text-secondary" />
        ערוצים מול Shopify — מתאם יומי
      </h3>
      <div className="rounded-xl border border-borderSubtle bg-surfaceMuted/30 p-3 space-y-3">
        {!chipHidden && (
          <div
            title="current state, not date-versioned"
            className="rounded-md bg-gray-50 border border-gray-200 px-2.5 py-1.5 text-[11px] text-text-muted flex items-center gap-1.5"
          >
            <Info size={12} className="shrink-0 text-text-subtle" />
            <span className="leading-relaxed">
              ה-product↔campaign mapping מבוסס על המיפוי הנוכחי שלך. שינוי המיפוי משפיע על נתונים היסטוריים בדיעבד.
            </span>
            <button
              type="button"
              aria-label="הסתר הודעת מיפוי"
              onClick={() => {
                window.sessionStorage.setItem(PRODUCT_MAP_CHIP_KEY, '1');
                setChipHidden(true);
              }}
              className="ms-auto shrink-0 rounded p-0.5 text-text-subtle hover:bg-gray-100 hover:text-text-secondary transition-colors"
            >
              <X size={12} />
            </button>
          </div>
        )}

        {/* Dark traffic chip */}
        {reconciliation.darkTrafficPercent > 0 && (
          <div className="rounded-md bg-amber-50 border border-amber-200 px-2.5 py-1.5 text-[11px] text-amber-900">
            <strong>פער &quot;Dark traffic&quot; {reconciliation.darkTrafficPercent}%:</strong>{' '}
            סכום Meta+Google+Organic נמוך מ-Shopify בפועל. ייתכן channel attribution חסר (UTMs לא מוגדרים נכון, סוגי orders שלא מתויגים).
          </div>
        )}

        <div className="flex items-start gap-3 flex-wrap">
          <div className="shrink-0">
            <div className="text-[10px] text-text-muted uppercase tracking-wide">
              מתאם (Pearson r) · {primaryChannel}
            </div>
            <div className={cn(
              'text-2xl font-bold tabular-nums leading-tight',
              primaryRClass,
            )} title={primaryR === null ? noSignalTitle : undefined}>
              {primaryR === null ? '—' : `${primaryR >= 0 ? '+' : ''}${primaryR.toFixed(2)}`}
            </div>
          </div>
          <div className="flex-1 min-w-[200px] text-[11px] sm:text-xs text-text-secondary leading-relaxed">
            {(() => {
              if (primaryAbsR === null) {
                return (
                  <>
                    <strong className="text-text-muted">אין שונות בסדרה.</strong>{' '}
                    אין מספיק שינוי יומי בערוץ הזה מול Shopify, ולכן לא ניתן לחשב מתאם אמין.
                  </>
                );
              }
              if (primaryAbsR >= 0.7) {
                if (primaryChannel === 'Google') {
                  return (
                    <>
                      <strong className="text-roas-green">מתאם גבוה.</strong>{' '}
                      Google תופס את הטרנדים נכון. אם יש פער במספרים — סביר שזה{' '}
                      <strong>bias קבוע</strong> (חלון attribution, modeled conversions, halo).{' '}
                      החלטות גידול תקציב על בסיס מגמות Google אמינות.
                    </>
                  );
                }
                if (primaryChannel === 'TikTok') {
                  return (
                    <>
                      <strong className="text-roas-green">מתאם גבוה.</strong>{' '}
                      TikTok תופס את הטרנדים נכון. אם יש פער במספרים — סביר שזה{' '}
                      <strong>bias קבוע</strong> (TikTok pixel + modeled conversions).{' '}
                      החלטות גידול תקציב על בסיס מגמות TikTok אמינות.
                    </>
                  );
                }
                if (primaryChannel === 'Combined') {
                  return (
                    <>
                      <strong className="text-roas-green">מתאם גבוה.</strong>{' '}
                      Σ של 4 הערוצים מול Shopify תופס את הטרנדים נכון. פער קבוע במספרים{' '}
                      מעיד בדרך כלל על bias בערוצי הדיווח, לא על שבירת המגמה.
                    </>
                  );
                }
                return (
                  <>
                    <strong className="text-roas-green">מתאם גבוה.</strong>{' '}
                    Meta תופס את הטרנדים נכון. אם יש פער במספרים — סביר שזה{' '}
                    <strong>bias קבוע</strong> (view-through credit, halo).{' '}
                    החלטות גידול תקציב על בסיס מגמות Meta אמינות.
                  </>
                );
              }
              if (primaryAbsR >= 0.3) {
                if (primaryChannel === 'Google') {
                  return (
                    <>
                      <strong className="text-amber-600">מתאם חלקי.</strong>{' '}
                      Google תופס חלק מהתנועות אבל יש ימים שהוא חורג.{' '}
                      התעלם מ-Google ברמת יום בודד, התייחס רק לאגרגציה של 7+ ימים.
                    </>
                  );
                }
                if (primaryChannel === 'TikTok') {
                  return (
                    <>
                      <strong className="text-amber-600">מתאם חלקי.</strong>{' '}
                      TikTok תופס חלק מהתנועות אבל יש ימים שהוא חורג.{' '}
                      התעלם מ-TikTok ברמת יום בודד, התייחס רק לאגרגציה של 7+ ימים.
                    </>
                  );
                }
                if (primaryChannel === 'Combined') {
                  return (
                    <>
                      <strong className="text-amber-600">מתאם חלקי.</strong>{' '}
                      Σ של 4 הערוצים מול Shopify מסביר חלק מהתנועה, אבל חסרים ימים.{' '}
                      בדוק מיפוי מוצרים, UTMs וערוצים שלא נכנסים לאחת הסדרות.
                    </>
                  );
                }
                return (
                  <>
                    <strong className="text-amber-600">מתאם חלקי.</strong>{' '}
                    Meta תופס חלק מהתנועות אבל יש ימים שהוא חורג.{' '}
                    התעלם מ-Meta ברמת יום בודד, התייחס רק לאגרגציה של 7+ ימים.
                  </>
                );
              }
              if (primaryChannel === 'Google') {
                return (
                  <>
                    <strong className="text-roas-red">אין מתאם.</strong>{' '}
                    Google מדווח על המרות שלא מופיעות ב-Shopify. או שהמיפוי לא מלא{' '}
                    (חסרים מוצרים), או שיש over-attribution אגרסיבי. אל תקבל החלטות{' '}
                    על בסיס המרות Google של הקמפיין הזה.
                  </>
                );
              }
              if (primaryChannel === 'TikTok') {
                return (
                  <>
                    <strong className="text-roas-red">אין מתאם.</strong>{' '}
                    TikTok מדווח על המרות שלא מופיעות ב-Shopify. או שהמיפוי לא מלא{' '}
                    (חסרים מוצרים), או שיש over-attribution אגרסיבי (TikTok pixel
                    + view-through). אל תקבל החלטות על בסיס המרות TikTok של הקמפיין הזה.
                  </>
                );
              }
              if (primaryChannel === 'Combined') {
                return (
                  <>
                    <strong className="text-roas-red">אין מתאם.</strong>{' '}
                    Σ של 4 הערוצים מול Shopify לא מסביר את מכירות Shopify בפועל.{' '}
                    בדוק אם חסרים מוצרים במיפוי, UTMs, או ערוצי מכירה שלא מסווגים.
                  </>
                );
              }
              return (
                <>
                  <strong className="text-roas-red">אין מתאם.</strong>{' '}
                  Meta מדווח על המרות שלא מופיעות ב-Shopify. או שהמיפוי לא מלא{' '}
                  (חסרים מוצרים), או שיש over-attribution אגרסיבי. אל תקבל החלטות{' '}
                  על בסיס המרות Meta של הקמפיין הזה.
                </>
              );
            })()}
          </div>
        </div>

        {/* Pearson values for all 5 channels (Phase 05.7.9 — added TikTok). */}
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-[10px] text-text-muted tabular-nums">
          {renderR('r(Meta)', reconciliation.r)}
          {renderR('r(Google)', reconciliation.rGoogle)}
          {renderR('r(TikTok)', reconciliation.rTiktok)}
          {renderR('r(Organic)', reconciliation.rOrganic)}
          {renderR('r(Combined)', reconciliation.rCombined)}
        </div>

        {primaryChannel === 'Meta' &&
          reconciliation.bestLag !== 0 &&
          reconciliation.bestR !== null &&
          reconciliation.r !== null &&
          reconciliation.bestR > reconciliation.r + LAG_IMPROVEMENT_THRESHOLD && (
          <div className="rounded-md bg-amber-50 border border-amber-200 px-2.5 py-1.5 text-[11px] text-amber-900">
            <strong>זוהה lag של {Math.abs(reconciliation.bestLag)} ימים:</strong>{' '}
            {reconciliation.bestLag > 0
              ? `Meta מדווח על המרה ${Math.abs(reconciliation.bestLag)} ימים לפני שהמכירה מופיעה ב-Shopify (חלון attribution).`
              : `Shopify מקדים את Meta ב-${Math.abs(reconciliation.bestLag)} ימים — לא טיפוסי, בדוק.`}
          </div>
        )}

        <div className="h-32">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={reconciliation.series} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
              <XAxis
                dataKey="date"
                tick={{ fontSize: 9, fill: CHART_COLORS.reconciliationAxis }}
                tickLine={false}
                axisLine={false}
                tickFormatter={d => {
                  const m = String(d).match(/^\d{4}-(\d{2})-(\d{2})/);
                  return m ? `${m[2]}/${m[1]}` : String(d);
                }}
              />
              {/* Phase 05.7.x — visible Y axis with CAD labels. The chart
                  compares channel-claimed totals (Σ Meta+Google+TikTok+Organic)
                  vs Shopify net revenue; without a labelled Y axis the
                  operator couldn't read the magnitude of agreement / gap. */}
              <YAxis
                tick={{ fontSize: 9, fill: CHART_COLORS.reconciliationAxis }}
                tickLine={false}
                axisLine={false}
                // c/HI-02: pick decimal precision per magnitude. The old
                // `formatCurrency(v)` defaulted to 0 decimals, so for a
                // chart spanning $0–$3 Recharts auto-picked ticks at 0.5,
                // 1.0, 1.5, 2.0 which all rounded to C$0/C$1/C$2 with
                // duplicate-adjacent labels. >=100 keep integer, otherwise
                // show 2 decimals so each tick has a unique label.
                tickFormatter={v => {
                  const n = Number(v);
                  return `C$${formatCurrency(n, n >= 100 ? 0 : 2)}`;
                }}
                width={56}
                domain={[0, 'auto']}
              />
              <Tooltip
                content={({ active, payload }) => {
                  if (!active || !payload || payload.length === 0) return null;
                  const d = payload[0].payload as {
                    date: string;
                    meta: number;
                    google: number;
                    tiktok: number;
                    organic: number;
                    shopify: number;
                  };
                  // c/HI-06: pick precision per magnitude. Tooltips are the
                  // operator's high-precision view of a chart point — the
                  // old default `formatCurrency(d.meta)` (0 decimals) showed
                  // every sub-dollar value as CAD 0. For a $1.99 product
                  // every tooltip read "CAD 0" unless the day had >=$0.50.
                  // Operator hovered, saw zero, concluded "no data" —
                  // incorrect. >=100 keep integer (cents are noise), >0 but
                  // <100 show 2 decimals, exactly 0 stays "0".
                  const fmt = (n: number) =>
                    formatCurrency(n, n < 100 && n > 0 ? 2 : 0);
                  return (
                    <div dir="rtl" className="rounded-lg bg-text-primary/95 text-white px-3 py-2 text-xs shadow-elevated tabular-nums">
                      <div className="text-white/65 mb-1 text-[10px]">{formatDate(d.date)}</div>
                      <div className="flex items-center gap-2">
                        <span className="inline-block w-2 h-2 rounded-full bg-amber-400" />
                        <span>Meta: CAD {fmt(d.meta)}</span>
                      </div>
                      <div className="flex items-center gap-2 mt-0.5">
                        <span className="inline-block w-2 h-2 rounded-full bg-blue-600" />
                        <span>Google: CAD {fmt(d.google)}</span>
                      </div>
                      <div className="flex items-center gap-2 mt-0.5">
                        {/* c/HI-01: slate-700 swatch matches CHART_COLORS.tiktok
                            (was pink-500, too close in hue to organic purple
                            for colorblind viewers). */}
                        <span className="inline-block w-2 h-2 rounded-full bg-slate-700" />
                        <span>TikTok: CAD {fmt(d.tiktok)}</span>
                      </div>
                      <div className="flex items-center gap-2 mt-0.5">
                        <span className="inline-block w-2 h-2 rounded-full bg-purple-600" />
                        <span>Organic: CAD {fmt(d.organic)}</span>
                      </div>
                      <div className="flex items-center gap-2 mt-0.5">
                        <span className="inline-block w-2 h-2 rounded-full bg-roas-green" />
                        <span>Shopify: CAD {fmt(d.shopify)}</span>
                      </div>
                    </div>
                  );
                }}
              />
              <Line type="monotone" dataKey="meta" stroke={CHART_COLORS.meta} strokeWidth={1.5} dot={false} opacity={0.85} />
              <Line type="monotone" dataKey="google" stroke={CHART_COLORS.google} strokeWidth={1.5} dot={false} opacity={0.85} />
              <Line type="monotone" dataKey="tiktok" stroke={CHART_COLORS.tiktok} strokeWidth={1.5} dot={false} opacity={0.85} />
              <Line type="monotone" dataKey="organic" stroke={CHART_COLORS.organic} strokeWidth={1.5} dot={false} opacity={0.85} />
              {/* Shopify line — source of truth (actual orders). Phase 05.7.9:
                  made visually dominant with a DASHED pattern (operator
                  feedback: "make it dashed so it's easier to tell apart").
                  Dashed stroke + 2.5px width + filled dots stand out cleanly
                  against the 1.5px solid platform lines without competing
                  for color attention. */}
              <Line
                type="monotone"
                dataKey="shopify"
                stroke={CHART_COLORS.shopify}
                strokeWidth={2.5}
                strokeDasharray="6 3"
                dot={{ r: 2.5, fill: CHART_COLORS.shopify, strokeWidth: 0 }}
                activeDot={{ r: 4 }}
              />
            </ComposedChart>
          </ResponsiveContainer>
        </div>

        {/* 5-entry legend (Phase 05.7.9 — added TikTok) */}
        <div className="flex items-center justify-center flex-wrap gap-3 text-[10px] sm:text-[11px]">
          <span className="inline-flex items-center gap-1.5">
            <span className="inline-block w-3 h-[2px] bg-amber-600" />
            <span className="text-text-secondary">Meta (מדווח)</span>
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="inline-block w-3 h-[2px] bg-blue-600" />
            <span className="text-text-secondary">Google (מדווח)</span>
          </span>
          <span className="inline-flex items-center gap-1.5">
            {/* c/HI-01: slate-700 swatch matches CHART_COLORS.tiktok (was
                pink-500, too close in hue to organic purple for colorblind
                viewers). */}
            <span className="inline-block w-3 h-[2px] bg-slate-700" />
            <span className="text-text-secondary">TikTok (מדווח)</span>
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="inline-block w-3 h-[2px] bg-purple-600" />
            <span className="text-text-secondary">Organic</span>
          </span>
          {/* Shopify legend entry — dashed pattern matches the chart's
              dashed stroke (Phase 05.7.9). Bold typography communicates
              "source of truth" at a glance. The dashed pattern is what
              actually distinguishes Shopify from the 4 solid platform
              lines, so the swatch must match. */}
          <span className="inline-flex items-center gap-1.5">
            <svg width="18" height="3" viewBox="0 0 18 3" aria-hidden="true">
              <line
                x1="0"
                y1="1.5"
                x2="18"
                y2="1.5"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeDasharray="4 2"
                className="text-roas-green"
              />
            </svg>
            <span className="text-text-primary font-semibold">Shopify (בפועל)</span>
          </span>
        </div>

        {/* WR-08: denomination boundary explainer. The chart mixes two
            accounting bases — Meta/Google are platform CLAIMS
            (conversionValue, may include modeled/view-through), while
            Organic/Shopify are Shopify-ACTUAL line-item revenue. The
            "פער" column and the darkTrafficPercent chip both compute
            `(channels - shopify) / shopify` as if both denominators
            were on the same basis, which they are not. The percentage
            is directional ("platforms over- or under-claim vs
            Shopify"), not a strict accounting reconciliation. */}
        <p className="text-[10px] text-text-muted leading-relaxed text-center">
          <strong>שים לב למשמעות:</strong>{' '}
          Meta ו-Google מציגים את ה-<em>דיווח</em> שלהם (conversionValue, יכול לכלול modeled/view-through).{' '}
          Organic ו-Shopify מציגים מכירות Shopify <em>בפועל</em> (revenueCad של פריטי המוצרים המשויכים).{' '}
          הפער בין הסכימה לבין Shopify מעיד על under/over-claim של הפלטפורמות, לא על reconciliation חשבונאי מדויק.
        </p>
        <p className="text-[10px] text-text-muted leading-relaxed text-center">
          <strong>בסיס המתאם:</strong> Pearson r מחושב על ימים פעילים בלבד (לפחות ערוץ אחד או Shopify ≠ 0). תקופות עצירה לא משפיעות על r כדי שלא יצרו &quot;הסכמה&quot; מלאכותית של אפס-אפס.
        </p>

        <details className="text-[11px]">
          <summary className="cursor-pointer text-text-secondary hover:text-text-primary select-none py-1">
            יום-לפי-יום ↓
          </summary>
          <div className="mt-2 max-h-48 overflow-y-auto rounded-md border border-borderSubtle">
            <table className="w-full text-[11px]">
              <thead className="bg-surfaceMuted/60 sticky top-0 z-[5]">
                <tr className="text-text-muted">
                  <th className="px-2 py-1.5 text-start font-medium">תאריך</th>
                  <th className="px-2 py-1.5 text-end font-medium">Meta</th>
                  <th className="px-2 py-1.5 text-end font-medium">Google</th>
                  <th className="px-2 py-1.5 text-end font-medium">TikTok</th>
                  <th className="px-2 py-1.5 text-end font-medium">Organic</th>
                  <th className="px-2 py-1.5 text-end font-medium">Shopify</th>
                  <th className="px-2 py-1.5 text-center font-medium">פער</th>
                </tr>
              </thead>
              <tbody>
                {reconciliation.series.map(s => {
                  // Audit fix 2026-05-23 (FIND-02 display): include TikTok
                  // in channelTotal so the per-day פער agrees with the
                  // "Σ של 4 הערוצים" copy + the dark-traffic chip.
                  const channelTotal = s.meta + s.google + s.tiktok + s.organic;
                  // FIX-16 (5.2.2.1): three distinct cases for per-day-table delta. Operationally different signals.
                  const { label: deltaLabel, tone: deltaTone } = computeDayDelta(channelTotal, s.shopify);
                  const deltaClass = {
                    neutral: 'text-text-muted',
                    green: 'text-roas-green',
                    red: 'text-roas-red',
                  }[deltaTone];
                  return (
                    <tr key={s.date} className="border-t border-borderSubtle">
                      <td className="px-2 py-1 text-text-secondary tabular-nums">{s.date.slice(5)}</td>
                      <td className="px-2 py-1 text-end tabular-nums">{formatCurrency(s.meta)}</td>
                      <td className="px-2 py-1 text-end tabular-nums">{formatCurrency(s.google)}</td>
                      <td className="px-2 py-1 text-end tabular-nums">{formatCurrency(s.tiktok)}</td>
                      <td className="px-2 py-1 text-end tabular-nums">{formatCurrency(s.organic)}</td>
                      <td className="px-2 py-1 text-end tabular-nums">{formatCurrency(s.shopify)}</td>
                      <td className={cn('px-2 py-1 text-center tabular-nums font-medium', deltaClass)}>
                        {deltaLabel}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </details>
      </div>
    </section>
  );
}
