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
import { enumerateDateRange } from '@/lib/dateRange';
import { cn, formatCurrency, formatDate } from '@/lib/utils';
export { pearson, pearsonWithLag };

const LAG_IMPROVEMENT_THRESHOLD = 0.05;
const PRODUCT_MAP_CHIP_KEY = 'roas:productMapChipHidden';

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
 */
function aggregateMappedConversionValue(
  rows: CampaignRow[] | undefined,
  platform: 'Meta' | 'Google',
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
  series: Array<{ date: string; meta: number; google: number; organic: number; shopify: number }>;
  primaryChannel: 'Meta' | 'Google' | 'Combined';
  r: number | null;
  rGoogle: number | null;
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
  const shopifyByDate = new Map<string, number>();
  if (ordersData?.rows) {
    for (const order of ordersData.rows) {
      if (order.storeId !== storeId) continue;
      if (!order.lineItems || order.lineItems.length === 0) continue;
      if (order.date < rangeFrom || order.date > rangeTo) continue;
      let mappedRevenue = 0;
      for (const li of order.lineItems) {
        if (wantedIds.has(li.productId)) {
          mappedRevenue += li.revenueCad;
        }
      }
      if (mappedRevenue === 0) continue;
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

  /** Inverted paid-exclusion predicate (fix for AUDIT-P0-01).
   * An order contributes to the "Organic / Direct" channel if it's NOT
   * deterministically paid. We previously used a whitelist that had three
   * impossible labels AND omitted google-organic (real label emitted by
   * Shopify.gs). The inverted predicate is robust to new OrderSource
   * values added later by the writer. */
  function isOrganicSource(order: { source: OrderSource | string; fbclidPresent?: boolean; gclidPresent?: boolean }): boolean {
    if (order.fbclidPresent) return false;
    if (order.gclidPresent) return false;
    if (order.source === 'meta-paid') return false;
    if (order.source === 'google-paid') return false;
    return true;
  }

  // Build {date → organic revenue}:
  // Sum line-item revenue (partial-order attribution) for orders whose source
  // is organic (NOT meta-paid or google-paid) and that contain at least one
  // mapped product. Only count the mapped-product line items' revenueCad.
  const organicByDate = new Map<string, number>();
  if (ordersData?.rows) {
    for (const order of ordersData.rows) {
      if (order.storeId !== storeId) continue;
      if (!isOrganicSource(order)) continue;
      if (!order.lineItems || order.lineItems.length === 0) continue;
      if (order.date < rangeFrom || order.date > rangeTo) continue;
      // Partial-order summation: only count revenue for mapped products
      let mappedRevenue = 0;
      for (const li of order.lineItems) {
        if (wantedIds.has(li.productId)) {
          mappedRevenue += li.revenueCad;
        }
      }
      if (mappedRevenue <= 0) continue;
      organicByDate.set(order.date, (organicByDate.get(order.date) ?? 0) + mappedRevenue);
    }
  }

  // Compose the 4-series array aligned to the user's full selected date
  // window, not just days where the drawer campaign was active.
  const series = dateList.map(date => ({
    date,
    meta: metaByDate.get(date) ?? 0,
    google: googleByDate.get(date) ?? 0,
    organic: organicByDate.get(date) ?? 0,
    shopify: shopifyByDate.get(date) ?? 0,
  }));

  if (series.length < 5) return null; // not enough points for r

  // Compute 4 Pearson values
  const r = pearson(series.map(s => s.meta), series.map(s => s.shopify));
  const rGoogle = pearson(series.map(s => s.google), series.map(s => s.shopify));
  const rOrganic = pearson(series.map(s => s.organic), series.map(s => s.shopify));
  const rCombined = pearson(
    series.map(s => s.meta + s.google + s.organic),
    series.map(s => s.shopify),
  );
  const primaryChannel: 'Meta' | 'Google' | 'Combined' =
    summary.platform === 'Google' ? 'Google'
      : summary.platform === 'Meta' ? 'Meta'
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
  const sumChannels = series.reduce((acc, s) => acc + s.meta + s.google + s.organic, 0);
  const sumShopify = series.reduce((acc, s) => acc + s.shopify, 0);
  const darkTrafficPercent =
    sumShopify > 0 && sumChannels / sumShopify < 0.8
      ? Math.round((1 - sumChannels / sumShopify) * 100)
      : 0;

  return { series, primaryChannel, r, rGoogle, rOrganic, rCombined, bestLag, bestR, darkTrafficPercent };
}

type Props = {
  reconciliation: NonNullable<ReturnType<typeof buildReconciliation>>;
};

export function MetaShopifyReconciliation({ reconciliation }: Props) {
  const [chipHidden, setChipHidden] = useState(() => (
    typeof window !== 'undefined' && window.sessionStorage.getItem(PRODUCT_MAP_CHIP_KEY) === '1'
  ));
  const primaryChannel = reconciliation.primaryChannel;
  const primaryR =
    primaryChannel === 'Google' ? reconciliation.rGoogle
      : primaryChannel === 'Meta' ? reconciliation.r
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
                if (primaryChannel === 'Combined') {
                  return (
                    <>
                      <strong className="text-roas-green">מתאם גבוה.</strong>{' '}
                      Σ של 3 הערוצים מול Shopify תופס את הטרנדים נכון. פער קבוע במספרים{' '}
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
                if (primaryChannel === 'Combined') {
                  return (
                    <>
                      <strong className="text-amber-600">מתאם חלקי.</strong>{' '}
                      Σ של 3 הערוצים מול Shopify מסביר חלק מהתנועה, אבל חסרים ימים.{' '}
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
              if (primaryChannel === 'Combined') {
                return (
                  <>
                    <strong className="text-roas-red">אין מתאם.</strong>{' '}
                    Σ של 3 הערוצים מול Shopify לא מסביר את מכירות Shopify בפועל.{' '}
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

        {/* Pearson values for all 4 channels */}
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-[10px] text-text-muted tabular-nums">
          {renderR('r(Meta)', reconciliation.r)}
          {renderR('r(Google)', reconciliation.rGoogle)}
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
                tick={{ fontSize: 9, fill: '#64748b' }}
                tickLine={false}
                axisLine={false}
                tickFormatter={d => {
                  const m = String(d).match(/^\d{4}-(\d{2})-(\d{2})/);
                  return m ? `${m[2]}/${m[1]}` : String(d);
                }}
              />
              <YAxis hide domain={[0, 'auto']} />
              <Tooltip
                content={({ active, payload }) => {
                  if (!active || !payload || payload.length === 0) return null;
                  const d = payload[0].payload as { date: string; meta: number; google: number; organic: number; shopify: number };
                  return (
                    <div dir="rtl" className="rounded-lg bg-text-primary/95 text-white px-3 py-2 text-xs shadow-elevated tabular-nums">
                      <div className="text-white/65 mb-1 text-[10px]">{formatDate(d.date)}</div>
                      <div className="flex items-center gap-2">
                        <span className="inline-block w-2 h-2 rounded-full bg-amber-400" />
                        <span>Meta: CAD {formatCurrency(d.meta)}</span>
                      </div>
                      <div className="flex items-center gap-2 mt-0.5">
                        <span className="inline-block w-2 h-2 rounded-full bg-blue-600" />
                        <span>Google: CAD {formatCurrency(d.google)}</span>
                      </div>
                      <div className="flex items-center gap-2 mt-0.5">
                        <span className="inline-block w-2 h-2 rounded-full bg-green-600" />
                        <span>Organic: CAD {formatCurrency(d.organic)}</span>
                      </div>
                      <div className="flex items-center gap-2 mt-0.5">
                        <span className="inline-block w-2 h-2 rounded-full bg-roas-green" />
                        <span>Shopify: CAD {formatCurrency(d.shopify)}</span>
                      </div>
                    </div>
                  );
                }}
              />
              <Line type="monotone" dataKey="meta" stroke="#d97706" strokeWidth={2} dot={false} />
              <Line type="monotone" dataKey="google" stroke="#2563eb" strokeWidth={2} dot={false} />
              <Line type="monotone" dataKey="organic" stroke="#16a34a" strokeWidth={2} dot={false} />
              <Line type="monotone" dataKey="shopify" stroke="#15803d" strokeWidth={2} dot={false} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>

        {/* 4-entry legend */}
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
            <span className="inline-block w-3 h-[2px] bg-green-600" />
            <span className="text-text-secondary">Organic</span>
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="inline-block w-3 h-[2px] bg-roas-green" />
            <span className="text-text-secondary">Shopify (בפועל)</span>
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

        <details className="text-[11px]">
          <summary className="cursor-pointer text-text-secondary hover:text-text-primary select-none py-1">
            יום-לפי-יום ↓
          </summary>
          <div className="mt-2 max-h-48 overflow-y-auto rounded-md border border-borderSubtle">
            <table className="w-full text-[11px]">
              <thead className="bg-surfaceMuted/60 sticky top-0">
                <tr className="text-text-muted">
                  <th className="px-2 py-1.5 text-start font-medium">תאריך</th>
                  <th className="px-2 py-1.5 text-end font-medium">Meta</th>
                  <th className="px-2 py-1.5 text-end font-medium">Google</th>
                  <th className="px-2 py-1.5 text-end font-medium">Organic</th>
                  <th className="px-2 py-1.5 text-end font-medium">Shopify</th>
                  <th className="px-2 py-1.5 text-center font-medium">פער</th>
                </tr>
              </thead>
              <tbody>
                {reconciliation.series.map(s => {
                  const channelTotal = s.meta + s.google + s.organic;
                  const delta = s.shopify - channelTotal;
                  const denom = Math.max(channelTotal, s.shopify, 1);
                  const deltaPct = (delta / denom) * 100;
                  let tone = 'text-text-muted';
                  if (channelTotal > 0 || s.shopify > 0) {
                    if (Math.abs(deltaPct) > 50) tone = 'text-roas-red';
                    else if (Math.abs(deltaPct) > 20) tone = 'text-amber-600';
                    else tone = 'text-roas-green';
                  }
                  return (
                    <tr key={s.date} className="border-t border-borderSubtle">
                      <td className="px-2 py-1 text-text-secondary tabular-nums">{s.date.slice(5)}</td>
                      <td className="px-2 py-1 text-end tabular-nums">{formatCurrency(s.meta)}</td>
                      <td className="px-2 py-1 text-end tabular-nums">{formatCurrency(s.google)}</td>
                      <td className="px-2 py-1 text-end tabular-nums">{formatCurrency(s.organic)}</td>
                      <td className="px-2 py-1 text-end tabular-nums">{formatCurrency(s.shopify)}</td>
                      <td className={cn('px-2 py-1 text-center tabular-nums font-medium', tone)}>
                        {channelTotal === 0 && s.shopify === 0 ? '—' : `${deltaPct > 0 ? '+' : ''}${deltaPct.toFixed(0)}%`}
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
