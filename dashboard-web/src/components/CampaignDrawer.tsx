'use client';

import { useEffect, useMemo, useState } from 'react';
import useSWR from 'swr';
import {
  X,
  ExternalLink,
  Maximize2,
  Megaphone,
  Calendar,
  Store as StoreIcon,
  TrendingUp,
  Package,
  Minimize2,
  Edit3,
} from 'lucide-react';
import {
  Area,
  AreaChart,
  Line,
  LineChart,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { CampaignsResponse } from '@/app/api/campaigns/route';
import type { OrdersAttributionResponse } from '@/app/api/orders-attribution/route';
import type { ProductsResponse } from '@/app/api/products/route';
import {
  analyzeAttribution,
  analyzeProductChannel,
} from '@/lib/attributionAnalysis';
import {
  analyzeCpmVsRoas,
  dayOffsetFromRangeStart,
  indexPrevByDateOffset,
  PREV_PERIOD_MIN_DAYS,
} from '@/lib/cpmRoasAnalysis';
import { useCampaignAttribution } from '@/lib/hooks/useCampaignAttribution';
import { cn, formatCurrency, formatDate, formatNumber } from '@/lib/utils';
import { roasLabel } from '@/lib/analytics';
import type { CampaignRow } from '@/lib/campaigns';
import {
  buildAdsManagerLink,
  resolveSharedTikTokAdvertiserId,
  type AdAccountMap,
} from '@/lib/campaignsLinks';
import {
  readOptimized,
  toggleOptimized,
} from '@/lib/campaignOptimized';
import { useDrawerEsc } from '@/lib/drawerStack';
import { AdsDrawer } from './AdsDrawer';
import { AttributionAnalysisPanel } from './AttributionAnalysisPanel';
import { CampaignDrawerStatusSection } from './CampaignDrawerStatusSection';
import { HealthScorePanel } from './HealthScorePanel';
import type { CampaignHealth } from '@/lib/campaignHealthScore';
import {
  MetaShopifyReconciliation,
  buildReconciliation,
} from './MetaShopifyReconciliation';
import { ProductChannelBreakdown } from './ProductChannelBreakdown';
import { CohortComparisonPanel } from './CohortComparisonPanel';
import { computeMultiMappingCohort } from '@/lib/multiMappingCohort';
import { detectProductCannibalization } from '@/lib/cannibalizationDetection';
import {
  AdSetTable,
  type AdSetSortKey,
  type AdSetSortDir,
} from './AdSetTable';
import { ProductPickerModal } from './ProductPickerModal';
import {
  readCampaignStoreMap,
  writeCampaignStoreMap,
  campaignStoreKey,
  type CampaignStoreMap,
} from '@/lib/campaignStoreMap';
import {
  readProductMap,
  campaignKey,
  setMappedProducts,
  allocateProductRevenue,
  type ProductMap,
} from '@/lib/campaignProductMap';
import { CHART_AXIS_COLOR, CHART_COLORS } from '@/lib/chartColors';
import { buildDateRangeKey, getPreviousPeriod } from '@/lib/dateRange';
import { ChartContainer } from '@/components/ui/chart/ChartContainer';
import {
  ChartTooltip,
  ChartTooltipLabel,
  ChartTooltipRow,
  ChartTooltipValue,
} from '@/components/ui/chart/ChartTooltip';

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
  storeId: string;
  open: boolean;
  onClose: () => void;
  /** storeId → ad-account IDs, used to build Ads Manager deep links. */
  adAccounts: AdAccountMap;
  /** User-selected date window (NOT min/max of rows.date — channel
   *  breakdown needs mapped-product orders on campaign-paused days too). */
  rangeFrom: string;
  rangeTo: string;
  /** Phase 05.7.x — unified Campaign Health Score, computed by the parent
   *  (CampaignsTable.tsx healthByKey memo) so the drawer doesn't repeat
   *  the per-campaign trajectory analysis. Renders as a HealthScorePanel
   *  at the top of the drawer body, giving the same throughline the table
   *  badge surfaces — one verdict, one set of weighted components, one
   *  recommendation block. Undefined in adset-mode drilldown (where the
   *  table's healthByKey is keyed by adSet rather than campaign — V2
   *  doesn't backfill campaign-level health for adset mode). */
  health?: CampaignHealth;
};

const TONE_BG: Record<string, string> = {
  red:    'bg-status-redBg text-status-red',
  orange: 'bg-status-orangeBg text-status-orange',
  green:  'bg-status-greenBg text-status-green',
  blue:   'bg-status-blueBg text-status-blue',
  gray:   'bg-elevated2 text-ink-muted',
};

export function CampaignDrawer({ rows, campaignId, storeId, open, onClose, adAccounts, rangeFrom, rangeTo, health }: Props) {
  // Drawer-local sort state. Default spend-desc matches the pre-sortable
  // hardcoded ordering so first paint doesn't jump.
  const [sortKey, setSortKey] = useState<AdSetSortKey>('spend');
  const [sortDir, setSortDir] = useState<AdSetSortDir>('desc');
  // Drawer can expand to fullscreen for users who want more space to inspect
  // charts (especially CPM-over-time + AdSetTable). Toggle button sits next
  // to the X close button in the header — same icon language as VS Code.
  const [isFullscreen, setIsFullscreen] = useState(false);
  // CPM chart can overlay ROAS on a second Y axis when the user enables it.
  const [showRoasOverlay, setShowRoasOverlay] = useState(false);
  // Analysis baseline: 'half' = first-half vs second-half within the
  // range; 'prev' = compare to the equally-long window immediately
  // before the range.
  const [cpmAnalysisMode, setCpmAnalysisMode] = useState<'half' | 'prev'>('half');

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

  // Phase A.5 v2 — campaign↔store mapping (TikTok only). Same cloud-sync
  // pattern as productMap. Read once at mount + subscribe to writes from
  // any tab/component.
  const [storeMap, setStoreMap] = useState<CampaignStoreMap>(() => ({}));
  useEffect(() => {
    setStoreMap(readCampaignStoreMap());
    const onChange = () => setStoreMap(readCampaignStoreMap());
    window.addEventListener('roas-campaign-store-map-changed', onChange);
    return () => window.removeEventListener('roas-campaign-store-map-changed', onChange);
  }, []);

  // SWR fetches — lazy while open, SWR-deduped per session.
  // Keys include the range so a range change triggers a fresh fetch (no stale cache).
  //
  // WR-05: the productsData SWR fetch was removed alongside the
  // buildReconciliation `productsData` parameter. The helper switched
  // to orders-attribution line items as its Shopify-actual basis
  // (CODEX-NEW-P2-01) and stopped reading the products-daily netRevenue
  // fallback; the SWR call was left in flight as dead weight and is
  // now gone.
  const drawerRange = { from: rangeFrom, to: rangeTo };
  // Equal-length window immediately before the current range. Only used
  // by the CPM-vs-ROAS analysis when the mode toggle is set to 'prev'.
  const prevRange = useMemo(() => getPreviousPeriod({ from: rangeFrom, to: rangeTo }), [rangeFrom, rangeTo]);
  // All campaign rows for the date range — used by buildReconciliation to
  // compute the Google series (other Google campaigns promoting same products).
  // SWR dedupes against CampaignsTable's identical key so no extra network call.
  const { data: campaignsData } = useSWR<CampaignsResponse>(
    open ? buildDateRangeKey('/api/campaigns', drawerRange) : null,
    async (url: string) => {
      const r = await fetch(url);
      if (!r.ok) return { rows: [], lastUpdated: new Date().toISOString() };
      return r.json();
    },
    { revalidateOnFocus: false, dedupingInterval: 60_000 },
  );
  // Phase 05.7.x (2026-05-23) — products_daily fetch. Used ONLY by the
  // cannibalization detector inside the cohort panel — when the current
  // campaign has no shared products, the detector returns an empty
  // list and the panel skips the cannibalization banner. SWR dedupes
  // against any parent fetch on the same range. Range-keyed so a
  // window change triggers a refetch.
  const { data: productsData } = useSWR<ProductsResponse>(
    open ? buildDateRangeKey('/api/products', drawerRange) : null,
    async (url: string) => {
      const r = await fetch(url);
      if (!r.ok) return { rows: [], lastUpdated: new Date().toISOString() };
      return r.json();
    },
    { revalidateOnFocus: false, dedupingInterval: 60_000 },
  );
  // Previous-period campaign rows — only fetched when the user actually
  // switches the analysis baseline to 'prev', so the default open path
  // costs zero extra network.
  const { data: campaignsDataPrev } = useSWR<CampaignsResponse>(
    open && cpmAnalysisMode === 'prev' ? buildDateRangeKey('/api/campaigns', prevRange) : null,
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
    const byDay = new Map<string, { spend: number; value: number; impressions: number }>();
    // adSetBudgetCad: latest non-null daily budget (most-recent wins,
    // not summed — budget is current-state, not period-cumulative).
    const byAdSet = new Map<string, {
      id: string; name: string; storeId: string; platform: string; campaignId: string;
      spend: number; value: number; clicks: number; impressions: number; conversions: number;
      adSetBudgetCad: number | null;
    }>();
    // FIX-05 (5.2.2.1): latest-date budget per (campaign, ad set). Mirrors aggregate() in CampaignsTable.tsx:131-196. Without this, late-arriving backfilled days silently revert the displayed budget.
    const latestAdSetBudgetDate = new Map<string, string>();
    for (const r of rows) {
      spend += r.spend;
      value += r.conversionValue;
      clicks += r.clicks;
      impressions += r.impressions;
      conversions += r.conversions;

      if (!byDay.has(r.date)) byDay.set(r.date, { spend: 0, value: 0, impressions: 0 });
      const d = byDay.get(r.date)!;
      d.spend += r.spend;
      d.value += r.conversionValue;
      d.impressions += r.impressions;

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
        if (r.adSetBudgetCad != null) latestAdSetBudgetDate.set(aKey, r.date);
      }
      const a = byAdSet.get(aKey)!;
      a.spend += r.spend;
      a.value += r.conversionValue;
      a.clicks += r.clicks;
      a.impressions += r.impressions;
      a.conversions += r.conversions;
      if (r.adSetBudgetCad != null) {
        const prev = latestAdSetBudgetDate.get(aKey);
        if (!prev || r.date > prev) {                 // strict > per RESEARCH §5.1 (matches FIX-13 policy)
          a.adSetBudgetCad = r.adSetBudgetCad;
          latestAdSetBudgetDate.set(aKey, r.date);
        }
      }
    }
    const roas = spend > 0 ? value / spend : 0;
    const ctr = impressions > 0 ? clicks / impressions : 0;
    const cpc = clicks > 0 ? spend / clicks : 0;
    const cpa = conversions > 0 ? spend / conversions : 0;
    const dailyArr = Array.from(byDay.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([date, v]) => ({
        date,
        spend: v.spend,
        value: v.value,
        impressions: v.impressions,
        // CPM per day: zero impressions -> 0. UI gates the CPM chart on
        // impressions > 0 anyway, but compute defensively here so any
        // future consumer of dailyArr gets a sane value.
        cpm: v.impressions > 0 ? (v.spend / v.impressions) * 1000 : 0,
        // ROAS per day for the CPM-vs-ROAS overlay. Same zero-spend guard
        // we use everywhere — empty days show 0 so the overlay line just
        // stays at the bottom rather than producing Infinity.
        roas: v.spend > 0 ? v.value / v.spend : 0,
      }));
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
  const attributionByAdSet = useCampaignAttribution({ summary, rows, ordersAttrData, rangeFrom, rangeTo });

  // Phase A.5 v2 — effectiveStoreId resolves the operator's pending store
  // re-tag for TikTok campaigns BEFORE cron-live-heavy re-buckets the
  // underlying campaigns_daily rows. Once tagged via the drawer's store
  // dropdown, the product picker + product-map writes immediately target
  // the new store so the operator can complete "tag store → tag products"
  // in one session without waiting 30 min for the cron tick.
  //
  // Non-TikTok campaigns: effectiveStoreId === storeId-prop (no mapping).
  // TikTok unmapped: effectiveStoreId === storeId-prop (defaults to uzoshop).
  // TikTok mapped: effectiveStoreId === storeMap[key] (the new store).
  //
  // Phase C soak hotfix (2026-05-30) — the advertiser id is shared across
  // all stores (only uzoshop has env vars). Using `adAccounts[storeId]`
  // returned '' for campaigns already attributed to usmile360/zolplus →
  // empty storeMap key → every mapped campaign rendered as "unmapped". Use
  // `resolveSharedTikTokAdvertiserId` which scans the whole adAccounts map.
  const effectiveStoreId = useMemo(() => {
    if (summary?.platform !== 'TikTok') return storeId;
    const advertiserId = resolveSharedTikTokAdvertiserId(adAccounts);
    if (!advertiserId) return storeId;
    return storeMap[campaignStoreKey('tiktok', advertiserId, campaignId)] ?? storeId;
  }, [summary?.platform, storeMap, adAccounts, storeId, campaignId]);

  // Phase A.5 v2 — derived display name for the effective store. summary.storeName
  // comes from the campaign's data row which still carries the pre-migration
  // storeId until cron-live-heavy re-attributes (~30 min). Without this derived
  // name, ProductPickerModal's header says "Map UZOSHOP products to campaign"
  // even when the products shown are usmile360's.
  const STORE_DISPLAY_NAMES: Record<string, string> = useMemo(
    () => ({ uzoshop: 'uzoshop', zolplus: 'Zol Plus', usmile360: '360usmile' }),
    [],
  );
  const effectiveStoreName = useMemo(() => {
    return STORE_DISPLAY_NAMES[effectiveStoreId] ?? summary?.storeName ?? effectiveStoreId;
  }, [STORE_DISPLAY_NAMES, effectiveStoreId, summary?.storeName]);

  // Stabilize mappedIds reference (RESEARCH.md §7 caveat). Inline
  // `productMap[...] ?? []` would return a fresh [] every render and defeat
  // the productChannelBreakdown memo below.
  const mappedIds = useMemo(
    () => {
      const platformForCampaign = rows[0]?.platform ?? summary?.platform ?? '';
      return productMap[campaignKey(effectiveStoreId, platformForCampaign, campaignId)] ?? [];
    },
    [productMap, rows, summary?.platform, effectiveStoreId, campaignId],
  );

  // Phase 05.7.x (2026-05-23) — for each product in the catalog, list
  // the OTHER campaign names (in THIS store) that already have it
  // mapped. Feeds:
  //   1. ProductPickerModal — chip "🔗 גם ב-N קמפיינים" next to each item.
  //   2. The "Mapped products" panel in the drawer header — chip next
  //      to each currently-mapped product showing where else it lives.
  // Multi-mapping is intentional (a product can be promoted by several
  // campaigns with different creatives/audiences). The chip makes that
  // sharing visible so the operator never thinks they double-mapped by
  // accident.
  const currentCampaignKey = useMemo(
    () => campaignKey(storeId, summary?.platform ?? '', campaignId),
    [storeId, summary?.platform, campaignId],
  );
  const campaignNameByKey = useMemo(() => {
    const out = new Map<string, string>();
    for (const r of campaignsData?.rows ?? []) {
      if (r.storeId !== storeId) continue;
      const k = campaignKey(r.storeId, r.platform, r.campaignId);
      if (!out.has(k)) out.set(k, r.campaignName || '—');
    }
    return out;
  }, [campaignsData, storeId]);
  const otherCampaignsByProduct = useMemo(() => {
    const out = new Map<string, string[]>();
    const storePrefix = `${storeId}::`;
    for (const [k, pids] of Object.entries(productMap)) {
      if (!k.startsWith(storePrefix)) continue;
      if (k === currentCampaignKey) continue; // exclude this campaign — operator wants OTHER mappings
      const name = campaignNameByKey.get(k) ?? '(לא ידוע)';
      for (const pid of pids) {
        if (!out.has(pid)) out.set(pid, []);
        out.get(pid)!.push(name);
      }
    }
    return out;
  }, [productMap, storeId, currentCampaignKey, campaignNameByKey]);

  // Phase 05.7.x (2026-05-23) — Multi-mapping cohort. Builds the
  // current campaign's cohort (other campaigns mapping at least one
  // of the same products) so the drawer can render a side-by-side
  // comparison + ranking chip.
  //
  // Metrics per cohort member: aggregated from campaignsData.rows.
  // We use ROAS Shopify-allocated when possible — but allocating
  // revenue requires the full pipeline (products + orders + allocator)
  // which the drawer doesn't run for non-current campaigns. So we
  // use a SIMPLER proxy here: ROAS = conversionValue / spend
  // (platform-reported). This is the same number the campaigns-table
  // "ROAS" column shows, and it's adequate for relative ranking
  // within the cohort. The drawer for each member (when opened
  // individually) will show the full Shopify allocation in its own
  // panels — the cohort view is a relative-comparison shortcut.
  const cohortAggregated = useMemo(() => {
    type CohortAgg = {
      key: string;
      storeId: string;
      storeName: string;
      platform: string;
      campaignId: string;
      campaignName: string;
      spend: number;
      conversions: number;
      conversionValue: number;
      effectiveStatus: string | null;
    };
    const acc = new Map<string, CohortAgg>();
    for (const r of campaignsData?.rows ?? []) {
      if (r.storeId !== storeId) continue;
      const k = campaignKey(r.storeId, r.platform, r.campaignId);
      const existing = acc.get(k);
      if (existing) {
        existing.spend += r.spend;
        existing.conversions += r.conversions;
        existing.conversionValue += r.conversionValue;
        if (!existing.effectiveStatus && r.effectiveStatus) {
          existing.effectiveStatus = r.effectiveStatus;
        }
      } else {
        acc.set(k, {
          key: k,
          storeId: r.storeId,
          storeName: r.storeName,
          platform: r.platform,
          campaignId: r.campaignId,
          campaignName: r.campaignName || '—',
          spend: r.spend,
          conversions: r.conversions,
          conversionValue: r.conversionValue,
          effectiveStatus: r.effectiveStatus ?? null,
        });
      }
    }
    return Array.from(acc.values());
  }, [campaignsData, storeId]);

  // Phase 05.7.x (2026-05-23) — cannibalization verdicts per
  // multi-mapped product. Pure function over the available daily rows
  // + productMap; renders one verdict per qualifying product. The
  // cohort panel surfaces high/medium/low verdicts as a warning
  // banner above its comparison tables.
  //
  // Inputs are passed AS-IS — the detector filters by storeId and the
  // range halves internally, so no pre-filtering needed here.
  const cannibalizationVerdicts = useMemo(() => {
    if (!summary) return [];
    return detectProductCannibalization({
      range: { from: rangeFrom, to: rangeTo },
      storeId,
      productMap,
      campaignsDaily: (campaignsData?.rows ?? []).map(r => ({
        date: r.date,
        storeId: r.storeId,
        platform: r.platform,
        campaignId: r.campaignId,
        spend: r.spend,
      })),
      productsDaily: (productsData?.rows ?? []).map(r => ({
        date: r.date,
        storeId: r.storeId,
        productId: r.productId,
        productTitle: r.productTitle,
        // products_daily uses `netRevenue` in this API shape — confirm
        // the field name. If the field is `revenue` rename here.
        netRevenue: r.netRevenue ?? 0,
      })),
    });
  }, [summary, rangeFrom, rangeTo, storeId, productMap, campaignsData, productsData]);

  const cohort = useMemo(() => {
    if (!summary) return null;
    // Audit fix 2026-05-23 (CRITICAL-01 + HIGH-01 multi-mapping):
    //
    // Prior versions passed `conversionValue / spend` (the platform-Pixel
    // claim) into BOTH `roasShopifyByKey` AND `roasShopifyPlatformByKey`.
    // Result: the column labeled "ROAS Shopify" inside CohortComparisonPanel
    // actually showed Pixel ROAS, AND the secondary tie-breaker was a no-op
    // (same map fed in twice). Operator validated the "you are weakest"
    // chip against the displayed column — both wrong together.
    //
    // Fix: run `allocateProductRevenue` (the same allocator the parent
    // CampaignsTable uses) here over the drawer's own SWR data
    // (productsData + ordersAttrData are already fetched for cannibalization
    // + per-product breakdown). Use the returned `revenue` (full deter+
    // proportional allocation) for the primary, and `deterministicRevenue`
    // (platform-attributed only) for the secondary.
    //
    // Cost: one extra allocator call per drawer open. The allocator is a
    // pure CPU pass over data already in memory — negligible vs the SWR
    // network round-trips that triggered the memo refresh.
    const productRevenue: Array<{
      productId: string;
      netRevenueCad: number;
      units: number;
    }> = [];
    for (const p of productsData?.rows ?? []) {
      if (p.storeId !== storeId) continue;
      if (p.date < rangeFrom || p.date > rangeTo) continue;
      if (!p.productId) continue;
      const net = p.netRevenue ?? p.revenue;
      // Match the same productsByStore aggregation policy the parent
      // useCampaignTrueRevenue hook uses — skip true-empty rows but
      // keep refund-only ones so the allocator gets to deduct.
      if (net === 0 && p.units === 0) continue;
      const existing = productRevenue.find(x => x.productId === p.productId);
      if (existing) {
        existing.netRevenueCad += net;
        existing.units += p.units;
      } else {
        productRevenue.push({
          productId: p.productId,
          netRevenueCad: net,
          units: p.units,
        });
      }
    }
    const campaignSpend = new Map<string, number>();
    for (const a of cohortAggregated) {
      campaignSpend.set(a.key, a.spend);
    }
    const ordersForAllocator = (ordersAttrData?.rows ?? [])
      .filter(o => o.storeId === storeId)
      .filter(o => o.date >= rangeFrom && o.date <= rangeTo)
      .map(o => ({
        storeId: o.storeId,
        source: o.source,
        fbclidPresent: o.fbclidPresent,
        gclidPresent: o.gclidPresent,
        lineItems: o.lineItems ?? [],
      }));
    const alloc = allocateProductRevenue({
      storeId,
      map: productMap,
      productRevenue,
      campaignSpend,
      orders: ordersForAllocator,
    });

    // Combined Shopify ROAS (deterministic + spend-proportional fallback).
    // Same number the table's "ROAS Shopify (כללי)" column shows for
    // mapped campaigns.
    const roasShopifyByKey = new Map<string, number>();
    // Deterministic-only ROAS (platform-attributed orders only, no
    // fallback). The audit-recommended secondary discriminator. Different
    // from the primary, so the tie-breaker actually breaks ties on
    // strength-of-platform-signal.
    const roasShopifyPlatformByKey = new Map<string, number>();
    for (const a of cohortAggregated) {
      const info = alloc.get(a.key);
      const spend = a.spend;
      roasShopifyByKey.set(
        a.key,
        info && spend > 0 ? info.revenue / spend : 0,
      );
      roasShopifyPlatformByKey.set(
        a.key,
        info && spend > 0 ? info.deterministicRevenue / spend : 0,
      );
    }
    return computeMultiMappingCohort({
      currentCampaignKey,
      productMap,
      // Shape the cohortAggregated into the Aggregated[] type the
      // cohort logic expects. Missing fields (budgets, lastActiveDate)
      // are not used by the cohort module — safe to default.
      aggregated: cohortAggregated.map(a => ({
        ...a,
        impressions: 0,
        clicks: 0,
        campaignBudgetCad: null,
        adSetBudgetCad: null,
        budgetType: '' as const,
        lastActiveDate: null,
        lastLiveTickAt: null,
        regConfiguredStatus: null,
        regEffectiveStatus: null,
        regDeliveryStatus: null,
        regFirstSeenAt: null,
        regStatusChangedAt: null,
        regLastStatusSuccessAt: null,
      })),
      roasShopifyByKey,
      roasShopifyPlatformByKey,
    });
  }, [summary, currentCampaignKey, productMap, cohortAggregated, productsData, ordersAttrData, storeId, rangeFrom, rangeTo]);

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
    const breakdown = analyzeProductChannel({
      productIds: mappedIds,
      orders: ordersRows,
      storeId,
      dateFrom: rangeFrom,
      dateTo: rangeTo,
    });
    if (breakdown.totalOrders < 3) return null;
    return breakdown;
  }, [summary, ordersAttrData, rows, mappedIds, storeId, rangeFrom, rangeTo]);

  if (!open || !summary) return null;

  // FIX-03 (5.2.2.1): storeId arrives as a required prop. Removed rows[0].storeId derivation (which was unreachable but defensive-noisy per AUDIT-P2-11).

  // Reconciliation + analysis: helpers gate their own mounts (return null
  // when not applicable). Reconciliation lives in MetaShopifyReconciliation
  // (T-F); analyzeAttribution stays in @/lib/attributionAnalysis.
  // WR-05: buildReconciliation now only reads `summary.platform`.
  // Pass a minimal projection rather than the full summary — both
  // documents the contract at the call site and removes the noise
  // of unused fields.
  const reconciliation = buildReconciliation({
    summary: { platform: summary.platform },
    mappedIds,
    storeId,
    campaignsData,
    ordersData: ordersAttrData,
    productMap,
    rangeFrom,
    rangeTo,
  });
  const analysis = analyzeAttribution(
    { campaignName: summary.campaignName, campaignId, storeId, platform: summary.platform, metaClaim: summary.value, spend: summary.spend },
    ordersAttrData?.rows ?? [],
    rangeFrom,
    rangeTo,
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
        default: {
          // Exhaustiveness check (WR-04). If a future AdSetSortKey value
          // is added but a case is forgotten, TypeScript fails the
          // `never` assignment at compile time. Returns 0 at runtime so
          // an unhandled key collapses sort to "stable" rather than
          // returning undefined and producing arbitrary order.
          const _exhaustive: never = sortKey;
          void _exhaustive;
          return 0;
        }
      }
    });
    return list;
  })();
  const roasInfo = roasLabel(summary.roas);

  // Phase D (2026-05-30) — every CampaignRow has the same reg_* values
  // (registry is constant per (store, platform, campaign)). Pick from
  // the first row that has them; fall back to per-row sweep for any
  // field still on the legacy daily-only path.
  const statusSectionData = (() => {
    let regConfiguredStatus: string | null = null;
    let regEffectiveStatus: string | null = null;
    let regDeliveryStatus: string | null = null;
    let regFirstSeenAt: string | null = null;
    let regStatusChangedAt: string | null = null;
    let regLastStatusSuccessAt: string | null = null;
    let lastLiveTickAt: string | null = null;
    let lastLiveTickDate = '';
    for (const r of rows) {
      // Registry is constant across rows for this campaign — copy once
      // from the first row that has it.
      regConfiguredStatus    ??= r.regConfiguredStatus;
      regEffectiveStatus     ??= r.regEffectiveStatus;
      regDeliveryStatus      ??= r.regDeliveryStatus;
      regFirstSeenAt         ??= r.regFirstSeenAt;
      regStatusChangedAt     ??= r.regStatusChangedAt;
      regLastStatusSuccessAt ??= r.regLastStatusSuccessAt;
      // lastLiveTickAt remains per-row (per-day truthiness varies).
      if (r.lastLiveTickAt && r.date > lastLiveTickDate) {
        lastLiveTickAt = r.lastLiveTickAt;
        lastLiveTickDate = r.date;
      }
    }
    return {
      regConfiguredStatus, regEffectiveStatus, regDeliveryStatus,
      regFirstSeenAt, regStatusChangedAt, regLastStatusSuccessAt,
      lastLiveTickAt,
    };
  })();

  return (
    <div
      className="fixed inset-0 z-50 flex animate-fade-in"
      role="dialog"
      aria-modal="true"
      aria-labelledby="campaign-drawer-title"
    >
      <div
        className="absolute inset-0 bg-ink/35 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden
      />
      <aside
        dir="rtl"
        style={{ viewTransitionName: 'drawer-panel' as never }}
        className={cn(
          'relative bg-elevated max-w-full',
          'h-full overflow-y-auto',
          'shadow-elevated',
          // Side-drawer mode: 640px panel anchored to the start (right in RTL)
          // Fullscreen mode: stretches edge-to-edge so charts + tables breathe
          !isFullscreen && 'w-full sm:w-[min(640px,100vw)] ml-0 sm:ms-auto',
          isFullscreen && 'w-full',
        )}
      >
        <header className="sticky top-0 bg-elevated/95 backdrop-blur-md z-10 px-4 sm:px-6 py-4 border-b border-line-subtle">
          <div className="flex items-start justify-between gap-3 mb-2">
            <div className="flex items-center gap-2 min-w-0 flex-1">
              <span className="inline-flex items-center justify-center w-8 h-8 rounded-lg bg-accent/8 text-accent shrink-0">
                <Megaphone size={16} />
              </span>
              <div className="min-w-0">
                <h2 id="campaign-drawer-title" className="text-base sm:text-lg font-semibold text-ink tracking-tight truncate">
                  {summary.campaignName ? <bdi dir="ltr">{summary.campaignName}</bdi> : '(ללא שם)'}
                </h2>
                <div className="text-[11px] sm:text-xs text-ink-muted flex items-center gap-1.5 mt-0.5">
                  <StoreIcon size={11} />
                  {/* Phase A.5 v2 (2026-05-29 evening) — show the effective
                      store name so the drawer header reflects the operator's
                      tagging immediately. For non-TikTok or unmapped TikTok
                      campaigns, effectiveStoreName === summary.storeName. */}
                  <span>{effectiveStoreName}</span>
                  <span className="text-ink-subtle">·</span>
                  <span>{summary.platform}</span>
                  <span className="text-ink-subtle">·</span>
                  <Calendar size={11} />
                  <span className="tabular-nums">{summary.activeDays} ימים פעילים</span>
                </div>
              </div>
            </div>
            <div className="flex items-center gap-1 shrink-0">
              <button
                onClick={() => setIsFullscreen(v => !v)}
                aria-label={isFullscreen ? 'כווץ למגירה' : 'הרחב למסך מלא'}
                title={isFullscreen ? 'כווץ למגירה' : 'הרחב למסך מלא'}
                className="inline-flex items-center justify-center w-11 h-11 sm:w-auto sm:h-auto sm:p-1.5 rounded hover:bg-elevated2 text-ink-muted hover:text-ink transition-colors"
              >
                {isFullscreen ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
              </button>
              <button onClick={onClose} aria-label="סגור" className="inline-flex items-center justify-center w-11 h-11 sm:w-auto sm:h-auto sm:p-1.5 rounded hover:bg-elevated2 text-ink-muted hover:text-ink transition-colors">
                <X size={18} />
              </button>
            </div>
          </div>
          {link && (
            <a href={link} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 text-xs sm:text-sm text-accent hover:text-accent/80 font-medium">
              <ExternalLink size={13} />
              פתח ב-<bdi dir="ltr">{summary.platform}</bdi> Ads Manager
            </a>
          )}
        </header>

        <div className="p-4 sm:p-6 space-y-5 sm:space-y-6">
          {/* Phase D Task 12 (2026-05-30) — full status + freshness panel.
              Mounts immediately below the header so the operator sees the
              configured/effective/delivery + freshness metadata before any
              metrics. All 6 reg_* fields + lastLiveTickAt are derived from
              the CampaignRows in scope (see statusSectionData above); the
              registry is constant per (store, platform, campaign) so the
              seeding uses ??= rather than a per-row sweep. metricsLagMinutes
              is reserved for a future phase. */}
          <CampaignDrawerStatusSection
            configuredStatus={statusSectionData.regConfiguredStatus}
            effectiveStatus={statusSectionData.regEffectiveStatus}
            deliveryStatus={statusSectionData.regDeliveryStatus}
            firstSeenAt={statusSectionData.regFirstSeenAt}
            statusChangedAt={statusSectionData.regStatusChangedAt}
            lastStatusSuccessAt={statusSectionData.regLastStatusSuccessAt}
            lastLiveTickAt={statusSectionData.lastLiveTickAt}
            metricsLagMinutes={null}
          />

          {/* Phase 05.7.x — Health Score throughline. The same verdict the
              operator just clicked in the table, expanded inline. Sits
              ABOVE the raw stat cards so the synthesised conclusion is the
              first thing the eye lands on; the individual ROAS / spend /
              conversions stats below are the inputs that fed the score. */}
          {health && <HealthScorePanel health={health} />}

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
                <h3 className="text-sm font-semibold text-ink inline-flex items-center gap-1.5">
                  <TrendingUp size={14} className="text-ink-secondary" />
                  הוצאה ↔ ערך המרות לאורך הזמן
                </h3>
              </div>
              <ChartContainer className="h-40 sm:h-44 rounded-xl bg-elevated2/40 border border-line-subtle p-2" height="100%">
                <AreaChart data={summary.dailyArr} margin={{ top: 4, right: 8, left: 8, bottom: 0 }}>
                  <defs>
                    <linearGradient id="drawer-spend" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={CHART_COLORS.spend} stopOpacity={0.35} />
                      <stop offset="100%" stopColor={CHART_COLORS.spend} stopOpacity={0} />
                    </linearGradient>
                    <linearGradient id="drawer-value" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={CHART_COLORS.value} stopOpacity={0.35} />
                      <stop offset="100%" stopColor={CHART_COLORS.value} stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <XAxis
                    dataKey="date"
                    tick={{ fontSize: 10, fill: CHART_AXIS_COLOR }}
                    tickLine={false}
                    axisLine={false}
                    tickFormatter={d => {
                      const m = String(d).match(/^\d{4}-(\d{2})-(\d{2})/);
                      return m ? `${m[2]}/${m[1]}` : String(d);
                    }}
                  />
                  {/* Phase 05.7.x — show the Y axis with CAD labels so the
                      operator can read the spend / value magnitudes at a
                      glance. Was `hide` previously which left the chart
                      ambiguous (peaks indistinguishable from troughs). */}
                  <YAxis
                    tick={{ fontSize: 10, fill: CHART_AXIS_COLOR }}
                    tickLine={false}
                    axisLine={false}
                    tickFormatter={v => `C$${formatCurrency(Number(v))}`}
                    width={60}
                    domain={[0, 'auto']}
                  />
                  <Tooltip
                    content={({ active, payload }) => {
                      if (!active || !payload || payload.length === 0) return null;
                      const d = payload[0].payload as { date: string; spend: number; value: number };
                      return (
                        <ChartTooltip className="tabular-nums">
                          <ChartTooltipLabel>{formatDate(d.date)}</ChartTooltipLabel>
                          <ChartTooltipRow color={CHART_COLORS.spend} label="הוצאה">
                            CAD <ChartTooltipValue>{formatCurrency(d.spend)}</ChartTooltipValue>
                          </ChartTooltipRow>
                          <ChartTooltipRow color={CHART_COLORS.value} label="ערך המרות">
                            CAD <ChartTooltipValue>{formatCurrency(d.value)}</ChartTooltipValue>
                          </ChartTooltipRow>
                        </ChartTooltip>
                      );
                    }}
                  />
                  <Area type="monotone" dataKey="value" stroke={CHART_COLORS.value} strokeWidth={1.5} fill="url(#drawer-value)" />
                  <Area type="monotone" dataKey="spend" stroke={CHART_COLORS.spend} strokeWidth={1.5} fill="url(#drawer-spend)" />
                </AreaChart>
              </ChartContainer>
              <div className="flex items-center gap-3 text-[10px] text-ink-muted mt-1.5">
                <span className="inline-flex items-center gap-1">
                  <span className="inline-block w-2 h-2 rounded-full bg-status-green" />
                  ערך המרות
                </span>
                <span className="inline-flex items-center gap-1">
                  <span className="inline-block w-2 h-2 rounded-full bg-status-red" />
                  הוצאה
                </span>
              </div>
            </section>
          )}

          {/* CPM over time — cost per 1000 impressions, CAD. Only shows when
              the user picked a range of at least 3 days AND there are at least
              2 days with actual impressions (a single point is not a chart).
              Days with zero impressions are filtered out — they have no
              meaningful CPM and would visually drop the line to zero. */}
          {(() => {
            const cpmSeries = summary.dailyArr.filter(d => d.impressions > 0);
            const fromMs = Date.UTC(
              Number(rangeFrom.slice(0, 4)),
              Number(rangeFrom.slice(5, 7)) - 1,
              Number(rangeFrom.slice(8, 10)),
            );
            const toMs = Date.UTC(
              Number(rangeTo.slice(0, 4)),
              Number(rangeTo.slice(5, 7)) - 1,
              Number(rangeTo.slice(8, 10)),
            );
            const rangeDays = Math.round((toMs - fromMs) / 86400000) + 1;
            if (rangeDays < 3 || cpmSeries.length < 2) return null;
            // Build the previous-period per-day series for THIS campaign
            // by filtering campaignsDataPrev to rows matching this drawer's
            // campaignId. Mirrors the live `summary` aggregation but for
            // the historical window. Only used when the user picks the
            // 'prev' analysis baseline.
            const prevDaily = (() => {
              if (cpmAnalysisMode !== 'prev') return undefined;
              // FIX-10 (5.2.2.1): namespace-strict previous-period filter. Same campaign ID in another store/platform can contaminate the baseline.
              const rows = (campaignsDataPrev?.rows ?? []).filter(r =>
                r.storeId === storeId &&
                r.platform === summary.platform &&
                r.campaignId === campaignId,
              );
              if (rows.length === 0) return undefined;
              const byDay = new Map<string, { spend: number; impressions: number; value: number }>();
              for (const r of rows) {
                if (!byDay.has(r.date)) byDay.set(r.date, { spend: 0, impressions: 0, value: 0 });
                const d = byDay.get(r.date)!;
                d.spend += r.spend;
                d.impressions += r.impressions;
                d.value += r.conversionValue;
              }
              return Array.from(byDay.entries())
                .sort((a, b) => a[0].localeCompare(b[0]))
                .filter(([, v]) => v.impressions > 0)
                .map(([date, v]) => ({
                  date,
                  cpm: (v.spend / v.impressions) * 1000,
                  roas: v.spend > 0 ? v.value / v.spend : 0,
                }));
            })();
            // Smart analysis runs over the same filtered series the chart
            // draws — empty/zero days are excluded so a single dud day
            // doesn't poison the trend calculation.
            const analysis = analyzeCpmVsRoas(
              cpmSeries.map(d => ({ date: d.date, cpm: d.cpm, roas: d.roas })),
              prevDaily ? { prev: prevDaily } : undefined,
            );
            // Build the chart's data array. When the user toggled the 'prev'
            // baseline AND we have previous-period rows, merge in the previous
            // period's CPM by CALENDAR OFFSET — "day 0 of current pairs with
            // day 0 of prev", "day 1 with day 1", regardless of which days
            // got filtered out for zero impressions. Naive index pairing (the
            // original bug c/CR-01) silently warped this whenever current and
            // prev had a different number of active days. Now both series are
            // anchored to days-since-window-start, so the dashed line truly is
            // the same relative day. X-axis labels stay on the current
            // period's dates; the previous period's actual date surfaces in
            // the tooltip.
            const prevByOffset = indexPrevByDateOffset(prevDaily, prevRange.from);
            const chartData = cpmSeries.map(d => {
              const offset = dayOffsetFromRangeStart(d.date, rangeFrom);
              const prev = prevByOffset.get(offset);
              return {
                ...d,
                prevCpm: prev?.cpm ?? null,
                prevDate: prev?.date ?? null,
              };
            });
            const isLoadingPrev = cpmAnalysisMode === 'prev' && !campaignsDataPrev;
            const showPrevLine = cpmAnalysisMode === 'prev' && !isLoadingPrev && (prevDaily?.length ?? 0) > 0;
            const fmtRangeShort = (from: string, to: string) => {
              const f = from.slice(5).replace('-', '/');
              const t = to.slice(5).replace('-', '/');
              return `${f}—${t}`;
            };
            const halfMidIdx = Math.floor(cpmSeries.length / 2);
            const firstHalfDates = cpmSeries.length >= 4
              ? `${cpmSeries[0].date.slice(5).replace('-', '/')}—${cpmSeries[halfMidIdx - 1].date.slice(5).replace('-', '/')}`
              : '';
            const secondHalfDates = cpmSeries.length >= 4
              ? `${cpmSeries[halfMidIdx].date.slice(5).replace('-', '/')}—${cpmSeries[cpmSeries.length - 1].date.slice(5).replace('-', '/')}`
              : '';
            const baselineLabel = analysis.mode === 'previous-period'
              ? `השוואה: ${fmtRangeShort(rangeFrom, rangeTo)} מול ${fmtRangeShort(prevRange.from, prevRange.to)} (תקופה קודמת באותו אורך)`
              : firstHalfDates && secondHalfDates
              ? `השוואה: חצי שני (${secondHalfDates}) מול חצי ראשון (${firstHalfDates})`
              : 'השוואה: חצי שני vs חצי ראשון של הטווח';
            const toneBg: Record<typeof analysis.tone, string> = {
              positive: 'bg-status-greenBg/40 border-status-green/30 text-status-green',
              warning:  'bg-status-warningBg border-status-warning/30 text-status-warningFg',
              negative: 'bg-status-redBg/40 border-status-red/30 text-status-red',
              neutral:  'bg-elevated2 border-line-subtle text-ink-secondary',
            };
            return (
              <section>
                <div className="flex items-center justify-between gap-2 mb-2 flex-wrap">
                  <h3 className="text-sm font-semibold text-ink inline-flex items-center gap-1.5">
                    <TrendingUp size={14} className="text-ink-secondary" />
                    CPM לאורך זמן
                    <span className="text-[10px] font-medium text-ink-muted">
                      (עלות ל-1000 חשיפות, CAD)
                    </span>
                  </h3>
                  <div className="flex items-center gap-3 flex-wrap">
                    {/* Analysis baseline toggle — same UX as CampaignsTable. */}
                    <div className="inline-flex items-center gap-0.5 rounded-md border border-line-subtle bg-elevated p-0.5 text-[10px]">
                      <button
                        type="button"
                        onClick={() => setCpmAnalysisMode('half')}
                        className={cn(
                          'px-2 py-0.5 rounded transition-colors',
                          cpmAnalysisMode === 'half'
                            ? 'bg-accent/10 text-accent font-medium'
                            : 'text-ink-muted hover:text-ink',
                        )}
                      >
                        חצי-חצי
                      </button>
                      <button
                        type="button"
                        onClick={() => setCpmAnalysisMode('prev')}
                        className={cn(
                          'px-2 py-0.5 rounded transition-colors',
                          cpmAnalysisMode === 'prev'
                            ? 'bg-accent/10 text-accent font-medium'
                            : 'text-ink-muted hover:text-ink',
                        )}
                      >
                        vs תקופה קודמת
                      </button>
                    </div>
                    {/* ROAS overlay toggle — a tiny switch that adds a second
                        line + right Y-axis for ROAS so the user can compare
                        auction cost vs return-on-spend at a glance. */}
                    <label className="inline-flex items-center gap-1.5 text-[11px] text-ink-secondary cursor-pointer select-none">
                      <input
                        type="checkbox"
                        checked={showRoasOverlay}
                        onChange={e => setShowRoasOverlay(e.target.checked)}
                        className="rounded border-line-subtle text-accent focus:ring-accent/30 cursor-pointer"
                      />
                      הוסף ROAS לגרף
                    </label>
                  </div>
                </div>
                <ChartContainer className="h-40 sm:h-44 rounded-xl bg-elevated2/40 border border-line-subtle p-2" dir="ltr" height="100%">
                  <LineChart data={chartData} margin={{ top: 8, right: showRoasOverlay ? 56 : 16, left: 4, bottom: 0 }}>
                    <XAxis
                      dataKey="date"
                      tick={{ fontSize: 10, fill: CHART_AXIS_COLOR }}
                      tickLine={false}
                      axisLine={false}
                      tickFormatter={d => {
                        const m = String(d).match(/^\d{4}-(\d{2})-(\d{2})/);
                        return m ? `${m[2]}/${m[1]}` : String(d);
                      }}
                      padding={{ left: 12, right: 12 }}
                    />
                    <YAxis
                      yAxisId="cpm"
                      tick={{ fontSize: 10, fill: CHART_AXIS_COLOR }}
                      tickLine={false}
                      axisLine={false}
                      tickFormatter={v => `C$${Number(v).toFixed(2)}`}
                      width={68}
                      // c/CR-02: zero-anchored Y axis. The previous
                      // `[dataMin * 0.88, dataMax * 1.12]` suppression turned
                      // a 3% CPM change into a chart-height-spanning curve —
                      // the textbook misleading-axis pattern. Operator
                      // dashboards should show the true magnitude; CPM is
                      // always >= 0.
                      domain={[0, (dataMax: number) => dataMax * 1.12]}
                      allowDecimals
                    />
                    {showRoasOverlay && (
                      <YAxis
                        yAxisId="roas"
                        orientation="right"
                        tick={{ fontSize: 10, fill: CHART_COLORS.roas }}
                        tickLine={false}
                        axisLine={false}
                        tickFormatter={v => Number(v).toFixed(2)}
                        width={42}
                        // c/CR-02: same zero-anchor rule for the ROAS overlay.
                        domain={[0, (dataMax: number) => dataMax * 1.12]}
                        allowDecimals
                      />
                    )}
                    <Tooltip
                      content={({ active, payload }) => {
                        if (!active || !payload || payload.length === 0) return null;
                        const d = payload[0].payload as {
                          date: string;
                          cpm: number;
                          impressions: number;
                          spend: number;
                          roas: number;
                          prevCpm: number | null;
                          prevDate: string | null;
                        };
                        // Δ% — sign convention: negative = CPM went DOWN
                        // vs. previous period (good for the operator).
                        // Guard against prevCpm===0 to avoid Infinity.
                        const prevDeltaPct = (showPrevLine && d.prevCpm != null && d.prevCpm > 0)
                          ? ((d.cpm - d.prevCpm) / d.prevCpm) * 100
                          : null;
                        return (
                          <ChartTooltip className="tabular-nums">
                            <ChartTooltipLabel>{formatDate(d.date)}</ChartTooltipLabel>
                            <ChartTooltipRow color={CHART_COLORS.cpm} label="CPM">
                              CAD <ChartTooltipValue>{formatCurrency(d.cpm, 2)}</ChartTooltipValue>
                            </ChartTooltipRow>
                            {showRoasOverlay && (
                              <ChartTooltipRow color={CHART_COLORS.roas} label="ROAS">
                                <ChartTooltipValue>{formatNumber(d.roas, 2)}</ChartTooltipValue>
                              </ChartTooltipRow>
                            )}
                            {showPrevLine && d.prevCpm != null && (
                              <div className="mt-1 pt-1 border-t border-line-subtle">
                                <div className="text-ink-muted text-[10px] mb-0.5">
                                  תקופה קודמת{d.prevDate ? ` (${formatDate(d.prevDate)})` : ''}:
                                </div>
                                <ChartTooltipRow color={CHART_COLORS.cpmPrev} label="CPM">
                                  CAD <ChartTooltipValue>{formatCurrency(d.prevCpm, 2)}</ChartTooltipValue>
                                  {prevDeltaPct != null && (
                                    <span className={cn(
                                      'ms-1.5 text-[10px] font-semibold',
                                      prevDeltaPct < 0 ? 'text-status-green' : prevDeltaPct > 0 ? 'text-status-red' : 'text-ink-muted',
                                    )}>
                                      ({prevDeltaPct > 0 ? '+' : ''}{prevDeltaPct.toFixed(1)}%)
                                    </span>
                                  )}
                                </ChartTooltipRow>
                              </div>
                            )}
                            <div className="text-ink-muted text-[10px] mt-1">
                              {formatNumber(d.impressions, 0)} חשיפות · CAD {formatCurrency(d.spend, 2)}
                            </div>
                          </ChartTooltip>
                        );
                      }}
                    />
                    <Line
                      yAxisId="cpm"
                      type="monotone"
                      dataKey="cpm"
                      stroke={CHART_COLORS.cpm}
                      strokeWidth={1.75}
                      dot={{ r: 2.5, fill: CHART_COLORS.cpm, stroke: 'none' }}
                      activeDot={{ r: 4, fill: CHART_COLORS.cpm, stroke: 'var(--surface-elevated-1)', strokeWidth: 1.5 }}
                    />
                    {showPrevLine && (
                      <Line
                        yAxisId="cpm"
                        type="monotone"
                        dataKey="prevCpm"
                        stroke={CHART_COLORS.cpmPrev}
                        strokeWidth={1.5}
                        strokeDasharray="5 3"
                        strokeOpacity={0.85}
                        dot={{ r: 2, fill: CHART_COLORS.cpmPrev, stroke: 'none', fillOpacity: 0.7 }}
                        activeDot={{ r: 3.5, fill: CHART_COLORS.cpmPrev, stroke: 'var(--surface-elevated-1)', strokeWidth: 1.5 }}
                        connectNulls={false}
                        isAnimationActive={false}
                      />
                    )}
                    {showRoasOverlay && (
                      <Line
                        yAxisId="roas"
                        type="monotone"
                        dataKey="roas"
                        stroke={CHART_COLORS.roas}
                        strokeWidth={1.75}
                        strokeDasharray="5 3"
                        dot={{ r: 2.5, fill: CHART_COLORS.roas, stroke: 'none' }}
                        activeDot={{ r: 4, fill: CHART_COLORS.roas, stroke: 'var(--surface-elevated-1)', strokeWidth: 1.5 }}
                      />
                    )}
                  </LineChart>
                </ChartContainer>
                {/* Mini legend — appears whenever there is more than one line
                    on the chart (ROAS overlay OR previous-period overlay).
                    CPM swatch tracks CHART_COLORS.cpm (= var(--status-orange)). */}
                {(showRoasOverlay || showPrevLine) && (
                  <div className="flex items-center justify-center gap-4 text-[10px] text-ink-muted mt-1.5 flex-wrap">
                    <span className="inline-flex items-center gap-1.5">
                      <span className="inline-block w-3 h-[2px]" style={{ background: CHART_COLORS.cpm }} />
                      CPM {showRoasOverlay ? '(ציר שמאל)' : ''}
                    </span>
                    {showPrevLine && (
                      <span className="inline-flex items-center gap-1.5">
                        <span className="inline-block w-3 border-t-2 border-dashed border-status-warning" />
                        CPM תקופה קודמת
                      </span>
                    )}
                    {showRoasOverlay && (
                      <span className="inline-flex items-center gap-1.5">
                        <span className="inline-block w-3 border-t-2 border-dashed border-status-green" />
                        ROAS (ציר ימין)
                      </span>
                    )}
                  </div>
                )}
                {cpmAnalysisMode === 'prev' && !isLoadingPrev && analysis.mode === 'half-over-half' && (
                  <div className="text-[10px] text-status-warningFg bg-status-warningBg px-2 py-1 rounded mt-1">
                    {/* FIX-19 (5.2.2.1): fallback disclosure when previous period had
                        fewer than PREV_PERIOD_MIN_DAYS active days.
                        WR-01 (5.2.2.1): gated by !isLoadingPrev so the banner does not fire prematurely
                        while SWR is still resolving cpmPrevData (~100-500ms after toggling to 'prev').
                        Without the gate, the analyzer runs without prev data, returns
                        analysis.mode='half-over-half', and the banner asserts <N active days even
                        though prev was never actually evaluated. The banner self-corrects when data
                        arrives, but the operator briefly sees an incorrect explanation.
                        IN-08 (5.2.2.1): the threshold N is sourced from
                        PREV_PERIOD_MIN_DAYS (cpmRoasAnalysis.ts) so the banner copy can
                        never drift from the analyzer gate. */}
                    {`לתקופה הקודמת פחות מ-${PREV_PERIOD_MIN_DAYS} ימים שבהם הקמפיין רץ (חשיפות + הוצאה) — מציג השוואת חצי-חצי במקום.`}
                  </div>
                )}
                {/* Smart analysis box — always renders so the user sees an
                    explicit placeholder when there are too few data points
                    (FIX-24 5.2.2.1: previously hidden via {analysis.hasData &&},
                    which made the analysis silently disappear in sparse
                    campaigns and was indistinguishable from a UI bug). */}
                <div className={cn('mt-2 rounded-lg border px-3 py-2 text-[11px] leading-relaxed', toneBg[analysis.tone])}>
                  {analysis.hasData && (
                    <div className="text-[10px] opacity-70 mb-1">
                      {baselineLabel}
                      {isLoadingPrev && <span className="ms-2 opacity-50">· טוען נתוני תקופה קודמת...</span>}
                    </div>
                  )}
                  <span className="font-semibold ml-1">ניתוח:</span>
                  <span>{analysis.text}</span>
                </div>
              </section>
            );
          })()}

          {/* Mapped products — Meta + TikTok (manual targeting). Google PMax
              is excluded because PMax delivery is feed-governed; manual
              tagging would mislead. TikTok ads, like Meta, target specific
              products manually so manual mapping is meaningful — added
              2026-05-22 per operator request to look at "what's happening"
              on each platform. */}
          {/* Phase A.5 v2 — TikTok campaign↔store mapping (drawer-based).
              The TikTok advertiser is shared across stores; this section lets
              the operator tag which store the campaign actually belongs to.
              Tagging applies immediately to the product picker below (so the
              "tag store → tag products" flow works in one session) and to the
              next cron-live-heavy tick which re-buckets campaigns_daily +
              ads_daily under the new store (Task 3 + 4's DELETE-then-UPSERT
              guarantees no duplicate rows). */}
          {summary.platform === 'TikTok' && (() => {
            // Phase C soak hotfix (2026-05-30) — see comment on
            // `effectiveStoreId` above. The TikTok advertiser is a single
            // shared id; do NOT look it up via `adAccounts[storeId]`
            // (returns '' for tenant stores).
            const advertiserId = resolveSharedTikTokAdvertiserId(adAccounts);
            const key = advertiserId
              ? campaignStoreKey('tiktok', advertiserId, campaignId)
              : '';
            const currentValue = key ? storeMap[key] : undefined;
            const isUnmapped = currentValue === undefined;
            return (
              <section>
                <div className="flex items-center justify-between gap-2 mb-2">
                  <h3 className="text-sm font-semibold text-ink inline-flex items-center gap-1.5">
                    🏪 חנות בעלת הקמפיין
                    {isUnmapped && (
                      <span className="text-[10px] font-medium text-status-orange">
                        (לא ממופה · ברירת מחדל uzoshop)
                      </span>
                    )}
                  </h3>
                </div>
                <p className="text-[11px] text-ink-muted leading-relaxed bg-elevated2/40 rounded-lg px-3 py-2 mb-2">
                  ה-TikTok advertiser שלנו (uzoshop) משרת מספר חנויות. בחר לאיזו חנות הקמפיין שייך —
                  קודם תייג חנות, אח״כ שייך מוצרים. שינוי חל מיידית על מיפוי המוצרים למטה; הסבב הבא של cron-live-heavy (עד 30 דק׳)
                  ירשום את ה-spend תחת החנות הנכונה ב-<code>campaigns_daily</code>. שורות היסטוריות נשארות תחת uzoshop.
                </p>
                <select
                  data-testid="drawer-store-select"
                  disabled={!advertiserId}
                  value={currentValue ?? '__unmapped__'}
                  onChange={(e) => {
                    if (!key) return;
                    const oldEffectiveStoreId = currentValue ?? storeId;
                    const newRawValue = e.target.value;
                    const newEffectiveStoreId = newRawValue === '__unmapped__' ? storeId : newRawValue;

                    // 1. Update the campaign-store-map.
                    const next: CampaignStoreMap = { ...storeMap };
                    if (newRawValue === '__unmapped__') {
                      delete next[key];
                    } else {
                      next[key] = newRawValue;
                    }
                    writeCampaignStoreMap(next);
                    setStoreMap(next);

                    // 2. Phase A.5 v2 — migrate productMap entry from the
                    //    old store's key to the new store's key. Without this,
                    //    products tagged before the store change become orphans
                    //    under the old storeId after cron-live-heavy migrates.
                    if (oldEffectiveStoreId !== newEffectiveStoreId) {
                      const oldProductKey = campaignKey(oldEffectiveStoreId, 'TikTok', campaignId);
                      const existing = productMap[oldProductKey];
                      if (existing && existing.length > 0) {
                        // Write the products under the new key + clear the old key.
                        setMappedProducts(newEffectiveStoreId, 'TikTok', campaignId, existing);
                        setMappedProducts(oldEffectiveStoreId, 'TikTok', campaignId, []);
                      }
                    }
                  }}
                  className="w-full text-sm bg-elevated border border-line rounded px-3 py-2 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <option value="__unmapped__">(לא ממופה · ברירת מחדל uzoshop)</option>
                  <option value="uzoshop">uzoshop</option>
                  <option value="zolplus">Zol Plus</option>
                  <option value="usmile360">360usmile</option>
                </select>
                {!isUnmapped && currentValue !== storeId && (
                  <p className="text-[11px] text-status-orange mt-2">
                    ⚠ מיפוי המוצרים למטה כבר מציג את {currentValue}. שאר הפאנלים בכרטיסייה הזו עדיין מציגים נתונים של {storeId} עד שcron-live-heavy יכתוב מחדש (עד 30 דק׳).
                  </p>
                )}
              </section>
            );
          })()}

          {(summary.platform === 'Meta' || summary.platform === 'TikTok') && (
            <section>
              <div className="flex items-center justify-between gap-2 mb-2">
                <h3 className="text-sm font-semibold text-ink inline-flex items-center gap-1.5">
                  <Package size={14} className="text-ink-secondary" />
                  מוצרי Shopify משויכים
                  {mappedIds.length > 0 && (
                    <span className="text-[10px] font-medium text-ink-muted">
                      ({mappedIds.length})
                    </span>
                  )}
                </h3>
                <button
                  type="button"
                  onClick={() => setPickerOpen(true)}
                  className="inline-flex items-center gap-1 rounded-md bg-elevated border border-line hover:border-accent/40 px-2 py-1 text-[11px] font-medium text-ink-secondary hover:text-accent transition-colors"
                >
                  <Edit3 size={12} />
                  {mappedIds.length > 0 ? 'ערוך מיפוי' : 'שייך מוצרים'}
                </button>
              </div>
              {mappedIds.length === 0 ? (
                <p className="text-[11px] text-ink-muted leading-relaxed bg-elevated2/40 rounded-lg px-3 py-2">
                  לא משויכים מוצרים. לאחר שיוך, ה-ROAS יחושב מחדש לפי מכירות{' '}
                  Shopify אמיתיות במקום ערך ההמרה ש-{summary.platform} דיווחה
                  (לרוב מנופח).
                </p>
              ) : (
                <ul className="flex flex-wrap gap-1.5">
                  {mappedIds.map(id => {
                    const others = otherCampaignsByProduct.get(id) ?? [];
                    return (
                      <li
                        key={id}
                        title={
                          others.length > 0
                            ? `${id}\nגם משויך ל: ${others.join(', ')}`
                            : id
                        }
                        className="inline-flex items-center gap-1 text-[11px] bg-accent/8 text-accent px-2 py-0.5 rounded-md font-mono"
                      >
                        <Package size={10} />
                        <span className="truncate max-w-[120px]">{id}</span>
                        {others.length > 0 && (
                          <span
                            className="text-status-warningFg text-[9px] font-sans ms-1"
                            aria-label={`גם משויך ל-${others.length} קמפיינים אחרים`}
                          >
                            🔗 +{others.length}
                          </span>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
              {/* Phase 05.7.x (2026-05-23) — if ANY of this campaign's
                  mapped products are also mapped to other campaigns,
                  show a short hint so the operator understands the
                  revenue-split implication. Multi-mapping is intentional
                  but its consequence (Shopify revenue split by spend
                  share) isn't obvious without this note. */}
              {mappedIds.length > 0 &&
                mappedIds.some(id => (otherCampaignsByProduct.get(id) ?? []).length > 0) && (
                  <p className="text-[10px] text-ink-muted leading-relaxed mt-2 bg-status-warningBg border border-status-warning/30 rounded-lg px-3 py-1.5">
                    🔗 חלק מהמוצרים גם משויכים לקמפיינים אחרים. ה-ROAS Shopify
                    של הקמפיין הזה מחושב לפי <strong>חלקו של הקמפיין בהוצאה</strong>{' '}
                    (חלוקה פרופורציונלית) — לא לפי כל ההכנסה של המוצר.
                  </p>
                )}
            </section>
          )}

          {/* Phase 05.7.x (2026-05-23) — multi-mapping cohort panel.
              Renders only when this campaign shares a mapped product
              with at least one other campaign in the same store. The
              panel shows side-by-side comparison of the current
              campaign vs the others sharing its products, split by
              intra-platform (competing) vs cross-platform (parallel
              channels). Includes a 🥇/🥈/🥉 ranking chip so the
              operator gets immediate context for sizing decisions. */}
          {cohort && (
            <CohortComparisonPanel
              cohort={cohort}
              cannibalizationVerdicts={cannibalizationVerdicts}
              onDrillCampaign={(targetCampaignId, targetPlatform) => {
                // Stay within the same drawer surface — switch to the
                // clicked campaign in-place. The parent component
                // (CampaignsTable) owns drillCampaignId / drillPlatform
                // state; we can't reach it from here, so we close + the
                // user clicks the target in the table. Future iteration
                // could thread a setter through. For now this prints
                // a hint until we hook it up properly.
                console.info(
                  `cohort drill: ${targetPlatform} / ${targetCampaignId} — ` +
                    `(click on the row in the campaigns table to open its drawer)`,
                );
              }}
            />
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

          <div className="text-[10px] text-ink-muted text-center pt-2">
            לחץ Esc או על הרקע לסגירה
          </div>
        </div>
      </aside>

      <ProductPickerModal
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        storeId={effectiveStoreId}
        storeName={effectiveStoreName}
        campaignName={summary.campaignName}
        initial={productMap[campaignKey(effectiveStoreId, summary.platform, campaignId)] ?? []}
        otherCampaignsByProduct={otherCampaignsByProduct}
        onSave={(productIds) => {
          setMappedProducts(effectiveStoreId, summary.platform, campaignId, productIds);
        }}
      />

      {/* Nested ad-level drawer uses the same user-selected range.
          Platform pass-through preserves the parent campaign's platform
          (Meta / Google / TikTok) instead of forcing 'Meta' as a default —
          a TikTok ad drill-down would otherwise mis-fetch from ads_daily
          filtered to platform='meta' (Phase 05.7.7 added TikTok ad rows). */}
      {adDrillSet && (
        <AdsDrawer
          open
          onClose={() => setAdDrillSet(null)}
          storeId={adDrillSet.storeId}
          platform={
            summary.platform === 'Google'
              ? 'Google'
              : summary.platform === 'TikTok'
                ? 'TikTok'
                : 'Meta'
          }
          campaignId={adDrillSet.campaignId}
          adSetId={adDrillSet.adSetId}
          adSetName={adDrillSet.adSetName}
          rangeFrom={rangeFrom}
          rangeTo={rangeTo}
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
        'rounded-lg border border-line-subtle bg-elevated2/30',
        compact ? 'px-2.5 py-2' : 'px-3 py-2.5 sm:px-3.5 sm:py-3',
      )}
    >
      <div className="text-[10px] sm:text-[11px] text-ink-muted leading-tight uppercase tracking-wide">{label}</div>
      <div className="flex items-baseline gap-1 mt-0.5">
        {prefix && (
          <span className="text-[10px] text-ink-muted font-medium shrink-0">{prefix}</span>
        )}
        <span
          className={cn(
            'font-semibold tabular-nums leading-tight',
            primary ? 'text-base sm:text-lg' : 'text-sm sm:text-base',
            accent === 'green' && 'text-status-green',
            !accent && 'text-ink',
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
