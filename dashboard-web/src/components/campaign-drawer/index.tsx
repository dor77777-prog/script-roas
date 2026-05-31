'use client';

/**
 * Task 5.5 (Wave 5) — CampaignDrawer compound root.
 *
 * Old pre-split CampaignDrawer.tsx was a 1585-line monolith. This file
 * keeps ALL data-fetching, memo derivation, and shared state in one
 * place, then dispatches into 6 thin sub-tab files via props:
 *
 *   Overview / Daily / AdSets / Ads / Status / History
 *
 * Why one stateful parent + thin sub-tabs (NOT 6 self-fetching tabs):
 *   1. SWR keys would otherwise duplicate per-tab — switching tabs
 *      should be a render-only operation, not a network round-trip.
 *   2. The cohort + reconciliation + analysis derivations all consume
 *      the SAME SWR responses; pulling them apart per tab would force
 *      cross-tab prop drilling anyway.
 *   3. Drawer-stack ESC + body-scroll lock + nested AdsDrawer must live
 *      at the root so a sub-tab swap doesn't tear them down.
 *
 * Visual treatment: Sheet.Header (sticky glass) + Sheet.Body from
 * Wave 2 Task 2.5. Hero metadata row carries `data-band` from
 * `useRoasBandGradient` per [[roas-state-gradient]] so the drawer
 * inherits the same band signal as the rest of the dashboard.
 */

import { useEffect, useMemo, useState } from 'react';
import useSWR from 'swr';
import {
  ExternalLink,
  Maximize2,
  Megaphone,
  Calendar,
  Store as StoreIcon,
  Minimize2,
  AlertTriangle,
} from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { NativeSelect } from '@/components/ui/NativeSelect';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetBody,
} from '@/components/ui/Sheet';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/Tabs';
import { Heading } from '@/components/ui/Typography';
import { useRoasBandGradient } from '@/lib/format/useRoasBandGradient';
import type { CampaignsResponse } from '@/app/api/campaigns/route';
import type { OrdersAttributionResponse } from '@/app/api/orders-attribution/route';
import type { ProductsResponse } from '@/app/api/products/route';
import {
  analyzeAttribution,
  analyzeProductChannel,
} from '@/lib/attributionAnalysis';
import { useCampaignAttribution } from '@/lib/hooks/useCampaignAttribution';
import { cn } from '@/lib/utils';
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
import { AdsDrawer } from '../AdsDrawer';
import { buildReconciliation } from '../MetaShopifyReconciliation';
import { computeMultiMappingCohort } from '@/lib/multiMappingCohort';
import { detectProductCannibalization } from '@/lib/cannibalizationDetection';
import {
  type AdSetSortKey,
  type AdSetSortDir,
} from '../AdSetTable';
import { ProductPickerModal } from '../ProductPickerModal';
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
import { buildDateRangeKey, getPreviousPeriod } from '@/lib/dateRange';
import type { CampaignHealth } from '@/lib/campaignHealthScore';

import { CampaignDrawerOverview } from './CampaignDrawerOverview';
import { CampaignDrawerDaily } from './CampaignDrawerDaily';
import { CampaignDrawerAdSets } from './CampaignDrawerAdSets';
import { CampaignDrawerAds } from './CampaignDrawerAds';
import { CampaignDrawerStatus } from './CampaignDrawerStatus';
import { CampaignDrawerHistory } from './CampaignDrawerHistory';

type Props = {
  /** Rows already filtered to this campaign — drawer aggregates internally. */
  rows: CampaignRow[];
  campaignId: string;
  storeId: string;
  open: boolean;
  onClose: () => void;
  adAccounts: AdAccountMap;
  rangeFrom: string;
  rangeTo: string;
  health?: CampaignHealth;
};

type SubTab = 'overview' | 'daily' | 'adsets' | 'ads' | 'status' | 'history';

const STORE_DISPLAY_NAMES_CONST: Record<string, string> = {
  uzoshop: 'uzoshop',
  zolplus: 'Zol Plus',
  usmile360: '360usmile',
};

export function CampaignDrawer({
  rows,
  campaignId,
  storeId,
  open,
  onClose,
  adAccounts,
  rangeFrom,
  rangeTo,
  health,
}: Props) {
  // ---- Local UI state ---------------------------------------------------
  const [sortKey, setSortKey] = useState<AdSetSortKey>('spend');
  const [sortDir, setSortDir] = useState<AdSetSortDir>('desc');
  const [isFullscreen, setIsFullscreen] = useState(false);
  // Daily sub-tab notifies us when the operator switches to 'prev' baseline
  // so we can flip the SWR fetch from null → the prev key.
  const [cpmAnalysisMode, setCpmAnalysisMode] = useState<'half' | 'prev'>('half');
  // Active sub-tab. Default 'overview' (the at-a-glance synthesis).
  const [activeTab, setActiveTab] = useState<SubTab>('overview');
  // Ad-set → ads drilldown (Meta / TikTok). Nested AdsDrawer over this sheet.
  const [adDrillSet, setAdDrillSet] = useState<{
    storeId: string;
    campaignId: string;
    adSetId: string;
    adSetName: string;
  } | null>(null);
  // Cloud-synced product mapping picker.
  const [productMap, setProductMap] = useState<ProductMap>(() => ({}));
  const [pickerOpen, setPickerOpen] = useState(false);
  // Phase A.5 v2 — TikTok-only campaign↔store mapping (cloud-synced).
  const [storeMap, setStoreMap] = useState<CampaignStoreMap>(() => ({}));
  // Optimization marks — shared with CampaignsTable.
  const [optimized, setOptimized] = useState<Set<string>>(() => new Set());

  function handleSort(key: AdSetSortKey) {
    if (key === sortKey) {
      setSortDir(d => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir('desc');
    }
  }
  function onToggle(key: string) {
    setOptimized(prev => toggleOptimized(key, prev));
  }

  // ---- Cloud-sync subscriptions ---------------------------------------
  useEffect(() => {
    setProductMap(readProductMap());
    const onChange = () => setProductMap(readProductMap());
    window.addEventListener('roas-campaign-product-map-changed', onChange);
    return () => window.removeEventListener('roas-campaign-product-map-changed', onChange);
  }, []);
  useEffect(() => {
    setStoreMap(readCampaignStoreMap());
    const onChange = () => setStoreMap(readCampaignStoreMap());
    window.addEventListener('roas-campaign-store-map-changed', onChange);
    return () => window.removeEventListener('roas-campaign-store-map-changed', onChange);
  }, []);
  useEffect(() => {
    setOptimized(readOptimized());
    const onChange = () => setOptimized(readOptimized());
    window.addEventListener('roas-campaign-optimized-changed', onChange);
    return () => window.removeEventListener('roas-campaign-optimized-changed', onChange);
  }, []);

  // ---- Esc + body-scroll-lock -----------------------------------------
  useDrawerEsc(open, onClose);
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, [open]);

  // ---- SWR fetches ----------------------------------------------------
  const drawerRange = { from: rangeFrom, to: rangeTo };
  const prevRange = useMemo(
    () => getPreviousPeriod({ from: rangeFrom, to: rangeTo }),
    [rangeFrom, rangeTo],
  );
  const { data: campaignsData } = useSWR<CampaignsResponse>(
    open ? buildDateRangeKey('/api/campaigns', drawerRange) : null,
    async (url: string) => {
      const r = await fetch(url);
      if (!r.ok) return { rows: [], lastUpdated: new Date().toISOString() };
      return r.json();
    },
    { revalidateOnFocus: false, dedupingInterval: 60_000 },
  );
  const { data: productsData } = useSWR<ProductsResponse>(
    open ? buildDateRangeKey('/api/products', drawerRange) : null,
    async (url: string) => {
      const r = await fetch(url);
      if (!r.ok) return { rows: [], lastUpdated: new Date().toISOString() };
      return r.json();
    },
    { revalidateOnFocus: false, dedupingInterval: 60_000 },
  );
  const { data: campaignsDataPrev } = useSWR<CampaignsResponse>(
    open && cpmAnalysisMode === 'prev' ? buildDateRangeKey('/api/campaigns', prevRange) : null,
    async (url: string) => {
      const r = await fetch(url);
      if (!r.ok) return { rows: [], lastUpdated: new Date().toISOString() };
      return r.json();
    },
    { revalidateOnFocus: false, dedupingInterval: 60_000 },
  );
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

  // ---- Per-campaign summary (preserved verbatim) ----------------------
  const summary = useMemo(() => {
    if (rows.length === 0) return null;
    const first = rows[0];
    let spend = 0, value = 0, clicks = 0, impressions = 0, conversions = 0;
    const byDay = new Map<string, { spend: number; value: number; impressions: number }>();
    const byAdSet = new Map<string, {
      id: string; name: string; storeId: string; platform: string; campaignId: string;
      spend: number; value: number; clicks: number; impressions: number; conversions: number;
      adSetBudgetCad: number | null;
    }>();
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
        if (!prev || r.date > prev) {
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
        cpm: v.impressions > 0 ? (v.spend / v.impressions) * 1000 : 0,
        roas: v.spend > 0 ? v.value / v.spend : 0,
      }));
    const adSets = Array.from(byAdSet.values())
      .map(a => ({ ...a, roas: a.spend > 0 ? a.value / a.spend : 0 }))
      .sort((a, b) => b.spend - a.spend);
    return {
      campaignName: first.campaignName,
      storeName: first.storeName,
      platform: first.platform,
      // Task 5.6 (P1-10 / Q7) — pass through the resolved (storeId,
      // campaignId) so `CampaignDrawerOverview` can hand them to
      // `HealthScorePanel` / `AttributionAnalysisPanel` which now
      // render an InsightActions secondary (Ads Manager deep-link).
      // We use the drawer-input storeId and campaignId (not first.*),
      // since `first` is the first daily row and we want the canonical
      // identifiers that opened the drawer.
      storeId,
      campaignId,
      spend, value, clicks, impressions, conversions,
      roas, ctr, cpc, cpa,
      dailyArr,
      adSets,
      activeDays: byDay.size,
    };
  }, [rows, storeId, campaignId]);

  // ---- Effective-store (Phase A.5 v2) ---------------------------------
  const effectiveStoreId = useMemo(() => {
    if (summary?.platform !== 'TikTok') return storeId;
    const advertiserId = resolveSharedTikTokAdvertiserId(adAccounts);
    if (!advertiserId) return storeId;
    return storeMap[campaignStoreKey('tiktok', advertiserId, campaignId)] ?? storeId;
  }, [summary?.platform, storeMap, adAccounts, storeId, campaignId]);

  const effectiveStoreName = useMemo(() => {
    return STORE_DISPLAY_NAMES_CONST[effectiveStoreId] ?? summary?.storeName ?? effectiveStoreId;
  }, [effectiveStoreId, summary?.storeName]);

  // ---- Stable references for downstream memos -------------------------
  const mappedIds = useMemo(
    () => {
      const platformForCampaign = rows[0]?.platform ?? summary?.platform ?? '';
      return productMap[campaignKey(effectiveStoreId, platformForCampaign, campaignId)] ?? [];
    },
    [productMap, rows, summary?.platform, effectiveStoreId, campaignId],
  );

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
      if (k === currentCampaignKey) continue;
      const name = campaignNameByKey.get(k) ?? '(לא ידוע)';
      for (const pid of pids) {
        if (!out.has(pid)) out.set(pid, []);
        out.get(pid)!.push(name);
      }
    }
    return out;
  }, [productMap, storeId, currentCampaignKey, campaignNameByKey]);

  // ---- Cohort aggregation (preserved verbatim) ------------------------
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
        netRevenue: r.netRevenue ?? 0,
      })),
    });
  }, [summary, rangeFrom, rangeTo, storeId, productMap, campaignsData, productsData]);

  const cohort = useMemo(() => {
    if (!summary) return null;
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
    const roasShopifyByKey = new Map<string, number>();
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

  // Per-ad-set attribution Map.
  const attributionByAdSet = useCampaignAttribution({
    summary,
    rows,
    ordersAttrData,
    rangeFrom,
    rangeTo,
  });

  // Status section data (Phase D) — derived from rows (registry is constant).
  const statusSectionData = useMemo(() => {
    let regConfiguredStatus: string | null = null;
    let regEffectiveStatus: string | null = null;
    let regDeliveryStatus: string | null = null;
    let regFirstSeenAt: string | null = null;
    let regStatusChangedAt: string | null = null;
    let regLastStatusSuccessAt: string | null = null;
    let lastLiveTickAt: string | null = null;
    let lastLiveTickDate = '';
    for (const r of rows) {
      regConfiguredStatus    ??= r.regConfiguredStatus;
      regEffectiveStatus     ??= r.regEffectiveStatus;
      regDeliveryStatus      ??= r.regDeliveryStatus;
      regFirstSeenAt         ??= r.regFirstSeenAt;
      regStatusChangedAt     ??= r.regStatusChangedAt;
      regLastStatusSuccessAt ??= r.regLastStatusSuccessAt;
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
  }, [rows]);

  // ---- ROAS band signal for the hero card -----------------------------
  // Must be computed BEFORE any early return so the (lint-perceived) hook
  // order is stable. `useRoasBandGradient` is actually a pure function —
  // the `use` prefix is a naming convention locked in
  // lib/format/useRoasBandGradient.ts — but the ESLint hooks rule still
  // requires us to call it unconditionally.
  const heroBand = useRoasBandGradient(summary?.roas ?? null).band;

  // ---- Bail early -----------------------------------------------------
  if (!open || !summary) return null;

  // ---- Per-render derivations -----------------------------------------
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
    {
      campaignName: summary.campaignName,
      campaignId,
      storeId,
      platform: summary.platform,
      metaClaim: summary.value,
      spend: summary.spend,
    },
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
          const _exhaustive: never = sortKey;
          void _exhaustive;
          return 0;
        }
      }
    });
    return list;
  })();

  // ---- TikTok store-mapping section (passed as a slot into Overview) --
  const storeMappingSlot = summary.platform === 'TikTok'
    ? (() => {
        const advertiserId = resolveSharedTikTokAdvertiserId(adAccounts);
        const key = advertiserId
          ? campaignStoreKey('tiktok', advertiserId, campaignId)
          : '';
        const currentValue = key ? storeMap[key] : undefined;
        const isUnmapped = currentValue === undefined;
        return (
          <section>
            <div className="flex items-center justify-between gap-2 mb-2">
              <Heading level="panel" className="inline-flex items-center gap-1.5">
                🏪 חנות בעלת הקמפיין
                {isUnmapped && (
                  <span className="text-[10px] font-medium text-status-orange">
                    (לא ממופה · ברירת מחדל uzoshop)
                  </span>
                )}
              </Heading>
            </div>
            <p className="text-[11px] text-ink-muted leading-relaxed bg-glass-2/40 rounded-lg px-3 py-2 mb-2">
              ה-TikTok advertiser שלנו (uzoshop) משרת מספר חנויות. בחר לאיזו חנות הקמפיין שייך —
              קודם תייג חנות, אח״כ שייך מוצרים. שינוי חל מיידית על מיפוי המוצרים למטה; הסבב הבא של cron-live-heavy (עד 30 דק׳)
              ירשום את ה-spend תחת החנות הנכונה ב-<code>campaigns_daily</code>. שורות היסטוריות נשארות תחת uzoshop.
            </p>
            <NativeSelect
              data-testid="drawer-store-select"
              disabled={!advertiserId}
              value={currentValue ?? '__unmapped__'}
              onChange={(e) => {
                if (!key) return;
                const oldEffectiveStoreId = currentValue ?? storeId;
                const newRawValue = e.target.value;
                const newEffectiveStoreId =
                  newRawValue === '__unmapped__' ? storeId : newRawValue;

                const next: CampaignStoreMap = { ...storeMap };
                if (newRawValue === '__unmapped__') {
                  delete next[key];
                } else {
                  next[key] = newRawValue;
                }
                writeCampaignStoreMap(next);
                setStoreMap(next);

                if (oldEffectiveStoreId !== newEffectiveStoreId) {
                  const oldProductKey = campaignKey(oldEffectiveStoreId, 'TikTok', campaignId);
                  const existing = productMap[oldProductKey];
                  if (existing && existing.length > 0) {
                    setMappedProducts(newEffectiveStoreId, 'TikTok', campaignId, existing);
                    setMappedProducts(oldEffectiveStoreId, 'TikTok', campaignId, []);
                  }
                }
              }}
              className="text-sm disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <option value="__unmapped__">(לא ממופה · ברירת מחדל uzoshop)</option>
              <option value="uzoshop">uzoshop</option>
              <option value="zolplus">Zol Plus</option>
              <option value="usmile360">360usmile</option>
            </NativeSelect>
            {!isUnmapped && currentValue !== storeId && (
              <p className="text-[11px] text-status-orange mt-2 inline-flex items-start gap-1">
                <AlertTriangle size={11} className="shrink-0 mt-0.5" aria-hidden />
                <span>מיפוי המוצרים למטה כבר מציג את {currentValue}. שאר הפאנלים בכרטיסייה הזו עדיין מציגים נתונים של {storeId} עד שcron-live-heavy יכתוב מחדש (עד 30 דק׳).</span>
              </p>
            )}
          </section>
        );
      })()
    : null;

  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()}>
      <SheetContent
        side="end"
        dir="rtl"
        onEscapeKeyDown={(e) => e.preventDefault()}
        aria-labelledby="campaign-drawer-title"
        style={{ viewTransitionName: 'drawer-panel' as never }}
        className={cn(
          'flex flex-col p-0',
          !isFullscreen && 'w-full sm:w-[min(640px,100vw)]',
          isFullscreen && 'w-full sm:w-full max-w-full',
        )}
      >
        {/* Sheet.Header — sticky glass strip from Wave 2 Task 2.5.
            The hero card carries data-band so the band signal renders
            via the .glass[data-band] CSS in globals.css (Task 1.3). */}
        <SheetHeader
          data-band={heroBand}
          data-testid="campaign-drawer-hero"
          className="glass"
        >
          <div className="flex items-start justify-between gap-3 mb-2">
            <div className="flex items-center gap-2 min-w-0 flex-1">
              <span className="inline-flex items-center justify-center w-8 h-8 rounded-lg bg-accent/8 text-accent shrink-0">
                <Megaphone size={16} />
              </span>
              <div className="min-w-0">
                <Heading as="h2" level="hero" id="campaign-drawer-title" className="truncate">
                  {summary.campaignName ? <bdi dir="ltr">{summary.campaignName}</bdi> : '(ללא שם)'}
                </Heading>
                <div className="text-[11px] sm:text-xs text-ink-muted flex items-center gap-1.5 mt-0.5">
                  <StoreIcon size={11} />
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
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setIsFullscreen(v => !v)}
                aria-label={isFullscreen ? 'כווץ למגירה' : 'הרחב למסך מלא'}
                title={isFullscreen ? 'כווץ למגירה' : 'הרחב למסך מלא'}
              >
                {isFullscreen ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
              </Button>
            </div>
          </div>
          {link && (
            <a
              href={link}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-xs sm:text-sm text-accent hover:text-accent/80 font-medium"
            >
              <ExternalLink size={13} />
              פתח ב-<bdi dir="ltr">{summary.platform}</bdi> Ads Manager
            </a>
          )}
        </SheetHeader>

        <SheetBody>
          <Tabs
            variant="underline"
            value={activeTab}
            onValueChange={(v) => setActiveTab(v as SubTab)}
          >
            <TabsList className="mb-4" data-testid="campaign-drawer-tabs">
              <TabsTrigger value="overview" data-testid="campaign-drawer-tab-trigger-overview">סקירה</TabsTrigger>
              <TabsTrigger value="daily" data-testid="campaign-drawer-tab-trigger-daily">יומי</TabsTrigger>
              <TabsTrigger value="adsets" data-testid="campaign-drawer-tab-trigger-adsets">Ad Sets</TabsTrigger>
              <TabsTrigger value="ads" data-testid="campaign-drawer-tab-trigger-ads">מודעות</TabsTrigger>
              <TabsTrigger value="status" data-testid="campaign-drawer-tab-trigger-status">סטטוס</TabsTrigger>
              <TabsTrigger value="history" data-testid="campaign-drawer-tab-trigger-history">היסטוריה</TabsTrigger>
            </TabsList>

            <TabsContent value="overview">
              <CampaignDrawerOverview
                summary={summary}
                health={health}
                analysis={analysis}
                reconciliation={reconciliation}
                productChannelBreakdown={productChannelBreakdown}
                cohort={cohort}
                cannibalizationVerdicts={cannibalizationVerdicts}
                mappedIds={mappedIds}
                otherCampaignsByProduct={otherCampaignsByProduct}
                onEditMapping={() => setPickerOpen(true)}
                storeMappingSlot={storeMappingSlot}
              />
            </TabsContent>

            <TabsContent value="daily">
              <CampaignDrawerDaily
                dailyArr={summary.dailyArr}
                rangeFrom={rangeFrom}
                rangeTo={rangeTo}
                prevRange={prevRange}
                campaignsDataPrev={campaignsDataPrev}
                onAnalysisModeChange={setCpmAnalysisMode}
                storeId={storeId}
                campaignId={campaignId}
                platform={summary.platform}
              />
            </TabsContent>

            <TabsContent value="adsets">
              <CampaignDrawerAdSets
                adSets={sortedAdSets}
                sortKey={sortKey}
                sortDir={sortDir}
                onSort={handleSort}
                attributionByAdSet={attributionByAdSet}
                optimized={optimized}
                onToggleOptimized={onToggle}
                onDrillAds={setAdDrillSet}
              />
            </TabsContent>

            <TabsContent value="ads">
              <CampaignDrawerAds
                adSets={summary.adSets}
                platform={summary.platform}
                onDrillAds={setAdDrillSet}
              />
            </TabsContent>

            <TabsContent value="status">
              <CampaignDrawerStatus
                configuredStatus={statusSectionData.regConfiguredStatus}
                effectiveStatus={statusSectionData.regEffectiveStatus}
                deliveryStatus={statusSectionData.regDeliveryStatus}
                firstSeenAt={statusSectionData.regFirstSeenAt}
                statusChangedAt={statusSectionData.regStatusChangedAt}
                lastStatusSuccessAt={statusSectionData.regLastStatusSuccessAt}
                lastLiveTickAt={statusSectionData.lastLiveTickAt}
                metricsLagMinutes={null}
              />
            </TabsContent>

            <TabsContent value="history">
              <CampaignDrawerHistory
                firstSeenAt={statusSectionData.regFirstSeenAt}
                statusChangedAt={statusSectionData.regStatusChangedAt}
                lastStatusSuccessAt={statusSectionData.regLastStatusSuccessAt}
                lastLiveTickAt={statusSectionData.lastLiveTickAt}
              />
            </TabsContent>
          </Tabs>

          <div className="text-[10px] text-ink-muted text-center pt-6">
            לחץ Esc או על הרקע לסגירה
          </div>
        </SheetBody>
      </SheetContent>

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
    </Sheet>
  );
}
