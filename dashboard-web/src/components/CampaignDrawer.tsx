'use client';

import { useEffect, useMemo, useState } from 'react';
import useSWR from 'swr';
import {
  X,
  ExternalLink,
  Megaphone,
  Calendar,
  Store as StoreIcon,
  TrendingUp,
  Package,
  Edit3,
} from 'lucide-react';
import {
  Area,
  AreaChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { ProductsResponse } from '@/app/api/products/route';
import type { OrdersAttributionResponse } from '@/app/api/orders-attribution/route';
import {
  analyzeAttribution,
  analyzeProductChannel,
} from '@/lib/attributionAnalysis';
import { useCampaignAttribution } from '@/lib/hooks/useCampaignAttribution';
import { cn, formatCurrency, formatDate, formatNumber } from '@/lib/utils';
import { roasLabel } from '@/lib/analytics';
import type { CampaignRow } from '@/lib/campaigns';
import { buildAdsManagerLink, type AdAccountMap } from '@/lib/campaignsLinks';
import {
  readOptimized,
  toggleOptimized,
} from '@/lib/campaignOptimized';
import { useDrawerEsc } from '@/lib/drawerStack';
import { AdsDrawer } from './AdsDrawer';
import { AttributionAnalysisPanel } from './AttributionAnalysisPanel';
import {
  MetaShopifyReconciliation,
  buildReconciliation,
} from './MetaShopifyReconciliation';
import { ProductChannelBreakdown } from './ProductChannelBreakdown';
import {
  AdSetTable,
  type AdSetSortKey,
  type AdSetSortDir,
} from './AdSetTable';
import { ProductPickerModal } from './ProductPickerModal';
import {
  readProductMap,
  campaignKey,
  setMappedProducts,
  type ProductMap,
} from '@/lib/campaignProductMap';
import { buildDateRangeKey } from '@/lib/dateRange';

/**
 * Slide-in campaign drilldown drawer. Linear/Vercel-style: full context
 * pane but the dashboard stays visible. Composes 4 sub-panels:
 * AttributionAnalysisPanel, ProductChannelBreakdown,
 * MetaShopifyReconciliation, AdSetTable (DOM order pinned by UI-SPEC).
 */

type Props = {
  /** Rows already filtered to this campaign — drawer aggregates internally. */
  rows: CampaignRow[];
  campaignId: string;
  open: boolean;
  onClose: () => void;
  /** storeId → ad-account IDs, used to build Ads Manager deep links. */
  adAccounts: AdAccountMap;
  /** User-selected date window (NOT min/max of rows.date — channel
   *  breakdown needs mapped-product orders on campaign-paused days too). */
  rangeFrom: string;
  rangeTo: string;
};

const TONE_BG: Record<string, string> = {
  red:    'bg-roas-redBg text-roas-red',
  orange: 'bg-roas-orangeBg text-roas-orange',
  green:  'bg-roas-greenBg text-roas-green',
  blue:   'bg-roas-blueBg text-roas-blue',
  gray:   'bg-surfaceMuted text-text-muted',
};

export function CampaignDrawer({ rows, campaignId, open, onClose, adAccounts, rangeFrom, rangeTo }: Props) {
  // Drawer-local sort state. Default spend-desc matches the pre-sortable
  // hardcoded ordering so first paint doesn't jump.
  const [sortKey, setSortKey] = useState<AdSetSortKey>('spend');
  const [sortDir, setSortDir] = useState<AdSetSortDir>('desc');

  function handleSort(key: AdSetSortKey) {
    if (key === sortKey) {
      setSortDir(d => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir('desc'); // first click on a new column → "largest first"
    }
  }

  // Ad-set → ads drilldown (Meta only).
  const [adDrillSet, setAdDrillSet] = useState<{
    storeId: string;
    campaignId: string;
    adSetId: string;
    adSetName: string;
  } | null>(null);

  // Product-mapping picker state. Cloud-synced via the change event.
  const [productMap, setProductMap] = useState<ProductMap>(() => ({}));
  const [pickerOpen, setPickerOpen] = useState(false);
  useEffect(() => {
    setProductMap(readProductMap());
    const onChange = () => setProductMap(readProductMap());
    window.addEventListener('roas-campaign-product-map-changed', onChange);
    return () => window.removeEventListener('roas-campaign-product-map-changed', onChange);
  }, []);

  // SWR fetches — lazy while open, SWR-deduped per session.
  // Keys include the range so a range change triggers a fresh fetch (no stale cache).
  const drawerRange = { from: rangeFrom, to: rangeTo };
  const { data: productsData } = useSWR<ProductsResponse>(
    open ? buildDateRangeKey('/api/products', drawerRange) : null,
    async (url: string) => {
      const r = await fetch(url);
      if (!r.ok) return { rows: [], lastUpdated: new Date().toISOString() };
      return r.json();
    },
    { revalidateOnFocus: false, dedupingInterval: 60_000 },
  );
  // Drawer needs the full lineItems column for productChannelBreakdown.
  // buildDateRangeKey always produces "?from=...&to=..." so &lineItems=true
  // safely appends as a second query param. The route default is false —
  // explicit opt-in here keeps CampaignsTable on the lighter payload.
  const ordersAttrBaseKey = open ? buildDateRangeKey('/api/orders-attribution', drawerRange) : null;
  const { data: ordersAttrData } = useSWR<OrdersAttributionResponse>(
    ordersAttrBaseKey ? `${ordersAttrBaseKey}&lineItems=true` : null,
    async (url: string) => {
      const r = await fetch(url);
      if (!r.ok) return { rows: [], lastUpdated: new Date().toISOString() };
      return r.json();
    },
    { revalidateOnFocus: false, dedupingInterval: 60_000 },
  );

  // Optimization marks — shared with CampaignsTable via lib/campaignOptimized.
  const [optimized, setOptimized] = useState<Set<string>>(() => new Set());
  useEffect(() => {
    setOptimized(readOptimized());
    const onChange = () => setOptimized(readOptimized());
    window.addEventListener('roas-campaign-optimized-changed', onChange);
    return () => window.removeEventListener('roas-campaign-optimized-changed', onChange);
  }, []);
  function onToggle(key: string) {
    setOptimized(prev => toggleOptimized(key, prev));
  }
  // Esc — coordinated via the shared drawer stack so nested AdsDrawer
  // pops alone instead of collapsing the whole stack (#WR-01).
  useDrawerEsc(open, onClose);

  // Lock body scroll while open.
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, [open]);

  const summary = useMemo(() => {
    if (rows.length === 0) return null;
    // Drawer always receives rows already filtered to this campaign.
    const first = rows[0];
    let spend = 0, value = 0, clicks = 0, impressions = 0, conversions = 0;
    const byDay = new Map<string, { spend: number; value: number }>();
    // adSetBudgetCad: latest non-null daily budget (most-recent wins,
    // not summed — budget is current-state, not period-cumulative).
    const byAdSet = new Map<string, {
      id: string; name: string; storeId: string; platform: string; campaignId: string;
      spend: number; value: number; clicks: number; impressions: number; conversions: number;
      adSetBudgetCad: number | null;
    }>();
    for (const r of rows) {
      spend += r.spend;
      value += r.conversionValue;
      clicks += r.clicks;
      impressions += r.impressions;
      conversions += r.conversions;

      if (!byDay.has(r.date)) byDay.set(r.date, { spend: 0, value: 0 });
      const d = byDay.get(r.date)!;
      d.spend += r.spend;
      d.value += r.conversionValue;

      const aKey = r.adSetId || r.adSetName || '(אחר)';
      if (!byAdSet.has(aKey)) {
        byAdSet.set(aKey, {
          id: r.adSetId,
          name: r.adSetName || '—',
          storeId: r.storeId,
          platform: r.platform,
          campaignId: r.campaignId,
          spend: 0,
          value: 0,
          clicks: 0,
          impressions: 0,
          conversions: 0,
          adSetBudgetCad: r.adSetBudgetCad,
        });
      }
      const a = byAdSet.get(aKey)!;
      a.spend += r.spend;
      a.value += r.conversionValue;
      a.clicks += r.clicks;
      a.impressions += r.impressions;
      a.conversions += r.conversions;
      // Latest non-null budget wins (rows iterate in date order).
      if (r.adSetBudgetCad != null) a.adSetBudgetCad = r.adSetBudgetCad;
    }
    const roas = spend > 0 ? value / spend : 0;
    const ctr = impressions > 0 ? clicks / impressions : 0;
    const cpc = clicks > 0 ? spend / clicks : 0;
    const cpa = conversions > 0 ? spend / conversions : 0;
    const dailyArr = Array.from(byDay.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([date, v]) => ({ date, spend: v.spend, value: v.value }));
    const adSets = Array.from(byAdSet.values())
      .map(a => ({ ...a, roas: a.spend > 0 ? a.value / a.spend : 0 }))
      .sort((a, b) => b.spend - a.spend);
    return {
      campaignName: first.campaignName,
      storeName: first.storeName,
      platform: first.platform,
      spend, value, clicks, impressions, conversions,
      roas, ctr, cpc, cpa,
      dailyArr,
      adSets,
      activeDays: byDay.size,
    };
  }, [rows]);

  // Per-ad-set attribution Map — hook preserves IN5-01 (no per-cell recompute).
  const attributionByAdSet = useCampaignAttribution({ summary, rows, ordersAttrData });

  // Stabilize mappedIds reference (RESEARCH.md §7 caveat). Inline
  // `productMap[...] ?? []` would return a fresh [] every render and defeat
  // the productChannelBreakdown memo below.
  const mappedIds = useMemo(
    () => {
      const sid = rows[0]?.storeId ?? '';
      return productMap[campaignKey(sid, campaignId)] ?? [];
    },
    [productMap, rows, campaignId],
  );

  // Per-product channel breakdown (Phase 1). Triple-gate (Meta-only,
  // mapped products, ≥3 mapped-product orders) is concentrated here so
  // the JSX guard is a single truthy check. Range uses rangeFrom/rangeTo
  // (user window) — NOT min/max(rows.date), which would miss orders on
  // campaign-paused days.
  const productChannelBreakdown = useMemo(() => {
    if (!summary || summary.platform !== 'Meta') return null;
    if (mappedIds.length === 0) return null;
    const ordersRows = ordersAttrData?.rows ?? [];
    if (ordersRows.length === 0 || rows.length === 0) return null;
    const storeIdForCampaign = rows[0]?.storeId ?? '';
    if (!storeIdForCampaign) return null;
    const breakdown = analyzeProductChannel({
      productIds: mappedIds,
      orders: ordersRows,
      storeId: storeIdForCampaign,
      dateFrom: rangeFrom,
      dateTo: rangeTo,
    });
    if (breakdown.totalOrders < 3) return null;
    return breakdown;
  }, [summary, ordersAttrData, rows, mappedIds, rangeFrom, rangeTo]);

  if (!open || !summary) return null;

  // All rows share one storeId (pre-filtered by parent).
  const storeId = rows.length > 0 ? rows[0].storeId : '';

  // Reconciliation + analysis: helpers gate their own mounts (return null
  // when not applicable). Reconciliation lives in MetaShopifyReconciliation
  // (T-F); analyzeAttribution stays in @/lib/attributionAnalysis.
  const reconciliation = buildReconciliation({ summary, productsData, mappedIds, storeId });
  const analysisDateFrom = rows.reduce((min, r) => (r.date < min ? r.date : min), rows[0]?.date ?? '');
  const analysisDateTo = rows.reduce((max, r) => (r.date > max ? r.date : max), rows[0]?.date ?? '');
  const analysis = analyzeAttribution(
    { campaignName: summary.campaignName, campaignId, storeId, platform: summary.platform, metaClaim: summary.value, spend: summary.spend },
    ordersAttrData?.rows ?? [],
    analysisDateFrom,
    analysisDateTo,
    summary.dailyArr.map(d => ({ date: d.date, value: d.value })),
  );
  const link = buildAdsManagerLink({
    platform: summary.platform,
    storeId,
    campaignId,
    accounts: adAccounts,
  });

  const sortedAdSets = (() => {
    const list = [...summary.adSets];
    const sign = sortDir === 'asc' ? 1 : -1;
    list.sort((x, y) => {
      switch (sortKey) {
        case 'name':
          return sign * (x.name || '').localeCompare(y.name || '', 'he');
        case 'spend':
          return sign * (x.spend - y.spend);
        case 'budget':
          return sign * ((x.adSetBudgetCad ?? 0) - (y.adSetBudgetCad ?? 0));
        case 'value':
          return sign * (x.value - y.value);
        case 'roas':
          return sign * (x.roas - y.roas);
        case 'conversions':
          return sign * (x.conversions - y.conversions);
      }
    });
    return list;
  })();
  const roasInfo = roasLabel(summary.roas);

  return (
    <div
      className="fixed inset-0 z-50 flex animate-fade-in"
      role="dialog"
      aria-modal="true"
      aria-labelledby="campaign-drawer-title"
    >
      <div
        className="absolute inset-0 bg-text-primary/35 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden
      />
      <aside
        dir="rtl"
        className={cn(
          'relative bg-surface w-full sm:w-[min(640px,100vw)] max-w-full',
          'ml-0 sm:ms-auto h-full overflow-y-auto',
          'shadow-elevated animate-fade-in-up',
        )}
      >
        <header className="sticky top-0 bg-surface/95 backdrop-blur-md z-10 px-4 sm:px-6 py-4 border-b border-borderSubtle">
          <div className="flex items-start justify-between gap-3 mb-2">
            <div className="flex items-center gap-2 min-w-0 flex-1">
              <span className="inline-flex items-center justify-center w-8 h-8 rounded-lg bg-primary/8 text-primary shrink-0">
                <Megaphone size={16} />
              </span>
              <div className="min-w-0">
                <h2 id="campaign-drawer-title" className="text-base sm:text-lg font-semibold text-text-primary tracking-tight truncate">
                  {summary.campaignName || '(ללא שם)'}
                </h2>
                <div className="text-[11px] sm:text-xs text-text-muted flex items-center gap-1.5 mt-0.5">
                  <StoreIcon size={11} />
                  <span>{summary.storeName}</span>
                  <span className="text-text-subtle">·</span>
                  <span>{summary.platform}</span>
                  <span className="text-text-subtle">·</span>
                  <Calendar size={11} />
                  <span className="tabular-nums">{summary.activeDays} ימים פעילים</span>
                </div>
              </div>
            </div>
            <button onClick={onClose} aria-label="סגור" className="p-1.5 rounded hover:bg-surfaceMuted text-text-muted hover:text-text-primary transition-colors shrink-0">
              <X size={18} />
            </button>
          </div>
          {link && (
            <a href={link} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 text-xs sm:text-sm text-primary hover:text-primary-dark font-medium">
              <ExternalLink size={13} />
              פתח ב-{summary.platform} Ads Manager
            </a>
          )}
        </header>

        <div className="p-4 sm:p-6 space-y-5 sm:space-y-6">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 sm:gap-3">
            <DrawerStat label="ROAS" value={summary.roas > 0 ? formatNumber(summary.roas) : '—'} chip={{ text: roasInfo.text, tone: roasInfo.tone }} primary />
            <DrawerStat label="הוצאה" value={formatCurrency(summary.spend)} prefix="CAD" />
            <DrawerStat label="ערך המרות" value={formatCurrency(summary.value)} prefix="CAD" accent={summary.value > summary.spend ? 'green' : undefined} />
            <DrawerStat label="המרות" value={formatNumber(summary.conversions, 0)} />
          </div>

          <div className="grid grid-cols-3 gap-2.5 sm:gap-3">
            <DrawerStat label="CTR" value={summary.impressions > 0 ? `${(summary.ctr * 100).toFixed(2)}%` : '—'} compact />
            <DrawerStat label="CPC" value={summary.clicks > 0 ? `CAD ${formatCurrency(summary.cpc, 2)}` : '—'} compact />
            <DrawerStat label="CPA" value={summary.conversions > 0 ? `CAD ${formatCurrency(summary.cpa, 2)}` : '—'} compact />
          </div>

          {summary.dailyArr.length >= 2 && (
            <section>
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-sm font-semibold text-text-primary inline-flex items-center gap-1.5">
                  <TrendingUp size={14} className="text-text-secondary" />
                  הוצאה ↔ ערך המרות לאורך הזמן
                </h3>
              </div>
              <div className="h-40 sm:h-44 rounded-xl bg-surfaceMuted/40 border border-borderSubtle p-2">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={summary.dailyArr} margin={{ top: 4, right: 8, left: 8, bottom: 0 }}>
                    <defs>
                      <linearGradient id="drawer-spend" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#dc2626" stopOpacity={0.35} />
                        <stop offset="100%" stopColor="#dc2626" stopOpacity={0} />
                      </linearGradient>
                      <linearGradient id="drawer-value" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#15803d" stopOpacity={0.35} />
                        <stop offset="100%" stopColor="#15803d" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <XAxis
                      dataKey="date"
                      tick={{ fontSize: 10, fill: '#7a8a9a' }}
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
                        const d = payload[0].payload as { date: string; spend: number; value: number };
                        return (
                          <div dir="rtl" className="rounded-lg bg-text-primary text-white px-3 py-2 text-xs shadow-elevated tabular-nums">
                            <div className="text-white/70 mb-1 text-[10px]">{formatDate(d.date)}</div>
                            <div>הוצאה: <span className="font-semibold">CAD {formatCurrency(d.spend)}</span></div>
                            <div>ערך המרות: <span className="font-semibold text-emerald-300">CAD {formatCurrency(d.value)}</span></div>
                          </div>
                        );
                      }}
                    />
                    <Area type="monotone" dataKey="value" stroke="#15803d" strokeWidth={1.5} fill="url(#drawer-value)" />
                    <Area type="monotone" dataKey="spend" stroke="#dc2626" strokeWidth={1.5} fill="url(#drawer-spend)" />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
              <div className="flex items-center gap-3 text-[10px] text-text-muted mt-1.5">
                <span className="inline-flex items-center gap-1">
                  <span className="inline-block w-2 h-2 rounded-full bg-roas-green" />
                  ערך המרות
                </span>
                <span className="inline-flex items-center gap-1">
                  <span className="inline-block w-2 h-2 rounded-full bg-roas-red" />
                  הוצאה
                </span>
              </div>
            </section>
          )}

          {/* Mapped products — Meta only (Google PMax delivery is feed-
              governed; manual tagging would mislead). */}
          {summary.platform === 'Meta' && (
            <section>
              <div className="flex items-center justify-between gap-2 mb-2">
                <h3 className="text-sm font-semibold text-text-primary inline-flex items-center gap-1.5">
                  <Package size={14} className="text-text-secondary" />
                  מוצרי Shopify משויכים
                  {mappedIds.length > 0 && (
                    <span className="text-[10px] font-medium text-text-muted">
                      ({mappedIds.length})
                    </span>
                  )}
                </h3>
                <button
                  type="button"
                  onClick={() => setPickerOpen(true)}
                  className="inline-flex items-center gap-1 rounded-md bg-surface border border-border hover:border-primary/40 px-2 py-1 text-[11px] font-medium text-text-secondary hover:text-primary transition-colors"
                >
                  <Edit3 size={12} />
                  {mappedIds.length > 0 ? 'ערוך מיפוי' : 'שייך מוצרים'}
                </button>
              </div>
              {mappedIds.length === 0 ? (
                <p className="text-[11px] text-text-muted leading-relaxed bg-surfaceMuted/40 rounded-lg px-3 py-2">
                  לא משויכים מוצרים. לאחר שיוך, ה-ROAS יחושב מחדש לפי מכירות{' '}
                  Shopify אמיתיות במקום ערך ההמרה ש-Meta דיווח (לרוב מנופח).
                </p>
              ) : (
                <ul className="flex flex-wrap gap-1.5">
                  {mappedIds.map(id => (
                    <li key={id} title={id} className="inline-flex items-center gap-1 text-[11px] bg-primary/8 text-primary px-2 py-0.5 rounded-md font-mono">
                      <Package size={10} />
                      <span className="truncate max-w-[120px]">{id}</span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )}

          {analysis && (
            <AttributionAnalysisPanel analysis={analysis} spend={summary.spend} value={summary.value} />
          )}

          {productChannelBreakdown && <ProductChannelBreakdown breakdown={productChannelBreakdown} />}

          {reconciliation && <MetaShopifyReconciliation reconciliation={reconciliation} />}

          {summary.adSets.length > 0 && (
            <AdSetTable
              adSets={sortedAdSets}
              sortKey={sortKey}
              sortDir={sortDir}
              onSort={handleSort}
              attributionByAdSet={attributionByAdSet}
              optimized={optimized}
              onToggleOptimized={onToggle}
              onDrillAds={setAdDrillSet}
            />
          )}

          <div className="text-[10px] text-text-muted text-center pt-2">
            לחץ Esc או על הרקע לסגירה
          </div>
        </div>
      </aside>

      <ProductPickerModal
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        storeId={rows[0]?.storeId ?? ''}
        storeName={summary.storeName}
        campaignName={summary.campaignName}
        initial={productMap[campaignKey(rows[0]?.storeId ?? '', campaignId)] ?? []}
        onSave={(productIds) => {
          const storeIdForCampaign = rows[0]?.storeId ?? '';
          setMappedProducts(storeIdForCampaign, campaignId, productIds);
        }}
      />

      {/* Nested ad-level drawer. Range derived from rows. */}
      {adDrillSet && (
        <AdsDrawer
          open
          onClose={() => setAdDrillSet(null)}
          storeId={adDrillSet.storeId}
          campaignId={adDrillSet.campaignId}
          adSetId={adDrillSet.adSetId}
          adSetName={adDrillSet.adSetName}
          rangeFrom={rows.reduce((min, r) => (r.date < min ? r.date : min), rows[0]?.date ?? '')}
          rangeTo={rows.reduce((max, r) => (r.date > max ? r.date : max), rows[0]?.date ?? '')}
          adAccounts={adAccounts}
        />
      )}
    </div>
  );
}

function DrawerStat({ label, value, prefix, chip, primary, compact, accent }: {
  label: string;
  value: string;
  prefix?: string;
  chip?: { text: string; tone: string };
  primary?: boolean;
  compact?: boolean;
  accent?: 'green';
}) {
  return (
    <div
      className={cn(
        'rounded-lg border border-borderSubtle bg-surfaceMuted/30',
        compact ? 'px-2.5 py-2' : 'px-3 py-2.5 sm:px-3.5 sm:py-3',
      )}
    >
      <div className="text-[10px] sm:text-[11px] text-text-muted leading-tight uppercase tracking-wide">{label}</div>
      <div className="flex items-baseline gap-1 mt-0.5">
        {prefix && (
          <span className="text-[10px] text-text-muted font-medium shrink-0">{prefix}</span>
        )}
        <span
          className={cn(
            'font-semibold tabular-nums leading-tight',
            primary ? 'text-base sm:text-lg' : 'text-sm sm:text-base',
            accent === 'green' && 'text-roas-green',
            !accent && 'text-text-primary',
          )}
        >
          {value}
        </span>
      </div>
      {chip && (
        <span
          className={cn(
            'inline-block mt-1 px-1.5 py-0.5 text-[9px] sm:text-[10px] font-semibold rounded',
            TONE_BG[chip.tone],
          )}
        >
          {chip.text}
        </span>
      )}
    </div>
  );
}


