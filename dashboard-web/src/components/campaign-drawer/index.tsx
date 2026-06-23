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
 * Wave 2 Task 2.5. Task 1.5 — the header is NEUTRAL (no ROAS band
 * gradient): it uses the SheetHeader primitive's own glass surface and
 * shows the campaign name, a brand-colored platform pill, the store
 * chip, a small band-tone ROAS health chip, and the active-days chip.
 * Removing `data-band` here ALSO fixes the prior invisible-header bug:
 * the `.glass[data-band]:not([data-mounted])` opacity:0 rule in
 * globals.css only matches banded .glass elements, and the SheetHeader
 * never added `data-mounted`, so it stayed transparent.
 */

import { useEffect, useMemo, useState } from 'react';
import useSWR from 'swr';
import {
  ExternalLink,
  Calendar,
  Store as StoreIcon,
  AlertTriangle,
} from 'lucide-react';
import { NativeSelect } from '@/components/ui/NativeSelect';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetBody,
} from '@/components/ui/Sheet';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/Tabs';
import { Heading } from '@/components/ui/Typography';
import { PlatformBadge, normalizePlatform } from '@/components/ui/PlatformBadge';
import { roasLabel } from '@/lib/analytics';
import { ROAS_TONE_BG } from '@/lib/format/roasCell';
import type { CampaignsResponse } from '@/app/api/campaigns/route';
import type { OrdersAttributionResponse } from '@/app/api/orders-attribution/route';
import type { ProductsResponse } from '@/app/api/products/route';
import {
  analyzeAttribution,
  analyzeProductChannel,
} from '@/lib/attributionAnalysis';
import { netAdjustFactor } from '@/lib/home/revenueBasis';
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
  adSetKey,
  setMappedProducts,
  setMappedProductsForAdSet,
  readProductsForAdSet,
  allocateProductRevenue,
  type ProductMap,
} from '@/lib/campaignProductMap';
import { buildDateRangeKey, getPreviousPeriod, getTodayInIsraelTz } from '@/lib/dateRange';
import { throwOnErrorBody } from '@/lib/throwOnErrorBody';
import { useStores } from '@/lib/useStores';
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

// Self-serve stores Phase 2 — fallback only. The live label map + the dropdown
// option list are sourced from useStores() inside the component; this hardcoded
// 3-store map preserves byte-identical labels on first paint / fetch failure.
const STORE_DISPLAY_NAMES_FALLBACK: Record<string, string> = {
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
  // Wave-4 Task 4.2 — the campaign view is now a centered MODAL (fixed size,
  // mobile full-screen sheet), so the edge-drawer ⤢ expand/fullscreen toggle
  // is gone. Only the X close remains. The `drawer:campaign:fullscreen`
  // localStorage key and the Maximize2/Minimize2 control were removed here.
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
  // Ad-set-level mapping (2026-06-23). When set, the single ProductPickerModal
  // is scoped to this ad-set (header + save route to setMappedProductsForAdSet);
  // when null the picker is campaign-scoped (legacy behaviour, unchanged).
  const [editingAdSet, setEditingAdSet] = useState<{
    storeId: string;
    platform: string;
    campaignId: string;
    adSetId: string;
    adSetName: string;
  } | null>(null);
  // Phase A.5 v2 — TikTok-only campaign↔store mapping (cloud-synced).
  const [storeMap, setStoreMap] = useState<CampaignStoreMap>(() => ({}));
  // Optimization marks — shared with CampaignsTable.
  const [optimized, setOptimized] = useState<Set<string>>(() => new Set());

  // Self-serve stores Phase 2 — the TikTok store-remap dropdown + the
  // effective-store label both source the store list from the DB-backed
  // useStores() hook. Falls back to the hardcoded 3 so first paint / fetch
  // failure is byte-identical to today.
  const { stores: storeList } = useStores();
  // storeId → display-name map derived from the live list (used by the
  // effective-store name lookup; the option list maps over storeList directly).
  const storeNameById = useMemo(() => {
    const m: Record<string, string> = {};
    for (const s of storeList) m[s.storeId] = s.storeName;
    return m;
  }, [storeList]);

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
  // 2026-06-09 (Task 7): gates the "מתעדכן…/ממתין…" pending state in the ad-set
  // + ads sub-tabs so it only fires when the range includes today.
  const rangeIncludesToday = rangeTo >= getTodayInIsraelTz();
  const prevRange = useMemo(
    () => getPreviousPeriod({ from: rangeFrom, to: rangeTo }),
    [rangeFrom, rangeTo],
  );
  // P0-4 (2026-06-10, full-system audit): STRICT fetchers. Pre-fix all four
  // returned `{ rows: [] }` on !r.ok and never read the 200-degraded `error`
  // body, so a real DB/HTTP failure was cached as SUCCESS and every panel in
  // the drawer rendered the plausible "no data" state — the exact P0-9 class
  // fixed in AdsDrawer on 2026-06-09, one level up. Now: throw on !ok AND on
  // 200-with-error (throwOnErrorBody) → SWR error state → visible error strip
  // (drawerFetchErrors below) instead of fake-empty tabs.
  const strictFetcher = async <T,>(url: string): Promise<T> => {
    const r = await fetch(url, { cache: 'no-store' });
    if (!r.ok) throw new Error(`CampaignDrawer: ${r.status} ${r.statusText}`);
    return throwOnErrorBody(await r.json());
  };
  const { data: campaignsData, error: campaignsError } = useSWR<CampaignsResponse>(
    open ? buildDateRangeKey('/api/campaigns', drawerRange) : null,
    strictFetcher,
    { revalidateOnFocus: false, dedupingInterval: 60_000 },
  );
  const { data: productsData, error: productsError } = useSWR<ProductsResponse>(
    open ? buildDateRangeKey('/api/products', drawerRange) : null,
    strictFetcher,
    { revalidateOnFocus: false, dedupingInterval: 60_000 },
  );
  const { data: campaignsDataPrev } = useSWR<CampaignsResponse>(
    open && cpmAnalysisMode === 'prev' ? buildDateRangeKey('/api/campaigns', prevRange) : null,
    strictFetcher,
    { revalidateOnFocus: false, dedupingInterval: 60_000 },
  );
  const ordersAttrBaseKey = open ? buildDateRangeKey('/api/orders-attribution', drawerRange) : null;
  const { data: ordersAttrData, error: ordersAttrError } = useSWR<OrdersAttributionResponse>(
    ordersAttrBaseKey ? `${ordersAttrBaseKey}&lineItems=true` : null,
    strictFetcher,
    { revalidateOnFocus: false, dedupingInterval: 60_000 },
  );
  // Human-readable list of failed drawer data sources (campaignsDataPrev is
  // an optional compare-mode enrichment — its failure degrades silently by
  // design, matching the AdsDrawer secondary-fetch contract).
  const drawerFetchErrors: string[] = [];
  if (campaignsError) drawerFetchErrors.push('נתוני קמפיינים');
  if (productsError) drawerFetchErrors.push('נתוני מוצרים');
  if (ordersAttrError) drawerFetchErrors.push('נתוני ייחוס-הזמנות');

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
    return (
      storeNameById[effectiveStoreId] ??
      STORE_DISPLAY_NAMES_FALLBACK[effectiveStoreId] ??
      summary?.storeName ??
      effectiveStoreId
    );
  }, [effectiveStoreId, storeNameById, summary?.storeName]);

  // ---- Stable references for downstream memos -------------------------
  const mappedIds = useMemo(
    () => {
      const platformForCampaign = rows[0]?.platform ?? summary?.platform ?? '';
      return productMap[campaignKey(effectiveStoreId, platformForCampaign, campaignId)] ?? [];
    },
    [productMap, rows, summary?.platform, effectiveStoreId, campaignId],
  );

  // P2 fix (2026-06-04) — key the cohort/product-map lookups on
  // `effectiveStoreId`, NOT the raw `storeId` prop. For a TikTok campaign
  // remapped off its default store (Phase A.5 v2 shared-account mapping), the
  // product map entries + the post-rewrite campaigns_daily spend both live
  // under the effective store. Keying on the raw store made
  // `productMap[currentCampaignKey]` empty → the cohort panel vanished. For
  // every NON-remapped case `effectiveStoreId === storeId`, so this is a no-op
  // outside the remapped-TikTok path. See effectiveStoreId memo above.
  const currentCampaignKey = useMemo(
    () => campaignKey(effectiveStoreId, summary?.platform ?? '', campaignId),
    [effectiveStoreId, summary?.platform, campaignId],
  );

  const campaignNameByKey = useMemo(() => {
    const out = new Map<string, string>();
    for (const r of campaignsData?.rows ?? []) {
      if (r.storeId !== effectiveStoreId) continue;
      const k = campaignKey(r.storeId, r.platform, r.campaignId);
      if (!out.has(k)) out.set(k, r.campaignName || '—');
    }
    return out;
  }, [campaignsData, effectiveStoreId]);

  // Bug #1 fix (audit 2026-06-18, CRITICAL): align BOTH sides of the per-campaign
  // attribution to ONE store scope. The orders side already matches
  // `effectiveStoreId`, but the platform-claim side (metaClaim / spend / daily
  // series) comes from `summary`, which is aggregated from the RAW-store `rows`.
  // For a remapped TikTok campaign (effectiveStoreId !== storeId) that compared a
  // claim from one store against orders from ANOTHER → wrong coverage/trust with NO
  // warning. Recompute the claim from `campaignsData` scoped to the effective store
  // + this campaign + range. No-op (uses the raw-store summary verbatim) when not
  // remapped, so every non-TikTok / non-remapped drawer is byte-identical.
  const effectiveClaim = useMemo(() => {
    if (effectiveStoreId === storeId) {
      return {
        value: summary?.value ?? 0,
        spend: summary?.spend ?? 0,
        dailyArr: (summary?.dailyArr ?? []).map((d) => ({ date: d.date, value: d.value })),
      };
    }
    let value = 0;
    let spend = 0;
    const byDay = new Map<string, number>();
    for (const r of campaignsData?.rows ?? []) {
      if (r.storeId !== effectiveStoreId) continue;
      if (r.campaignId !== campaignId) continue;
      if (r.date < rangeFrom || r.date > rangeTo) continue;
      value += r.conversionValue;
      spend += r.spend;
      byDay.set(r.date, (byDay.get(r.date) ?? 0) + r.conversionValue);
    }
    const dailyArr = Array.from(byDay.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([date, v]) => ({ date, value: v }));
    return { value, spend, dailyArr };
  }, [effectiveStoreId, storeId, summary, campaignsData, campaignId, rangeFrom, rangeTo]);

  const otherCampaignsByProduct = useMemo(() => {
    const out = new Map<string, string[]>();
    const storePrefix = `${effectiveStoreId}::`;
    for (const [k, pids] of Object.entries(productMap)) {
      if (!k.startsWith(storePrefix)) continue;
      // The chip reads "גם ב-N קמפיינים" — count ONLY true campaign-level
      // mappings (3-segment store::platform::campaign keys). 4-segment
      // ad-set keys (2026-06-23 ad-set scope) are NOT campaigns: counting
      // them inflates the multi-mapping chip and, since campaignNameByKey is
      // built from 3-segment keys only, labels every ad-set entry '(לא ידוע)'
      // in BOTH the campaign-level and the ad-set picker. Skip them.
      if (k.split('::').length !== 3) continue;
      if (k === currentCampaignKey) continue;
      const name = campaignNameByKey.get(k) ?? '(לא ידוע)';
      for (const pid of pids) {
        if (!out.has(pid)) out.set(pid, []);
        out.get(pid)!.push(name);
      }
    }
    return out;
  }, [productMap, effectiveStoreId, currentCampaignKey, campaignNameByKey]);

  // ---- Per-ad-set mapping summary (2026-06-23) ------------------------
  // For each ad-set row, resolve how many products it maps: `ownCount` from
  // its OWN 4-segment entry (overrides the campaign), `inheritedCount` from
  // the campaign mapping when the ad-set has no own entry. Keyed by the
  // ad-set id (matches `AdSetItem.id`, the key AdSetTable looks up). Drives
  // the per-row own/inherited indicator chip.
  const mappingByAdSet = useMemo(() => {
    const out = new Map<string, { ownCount: number; inheritedCount: number }>();
    const platform = summary?.platform ?? rows[0]?.platform ?? '';
    for (const a of summary?.adSets ?? []) {
      if (!a.id) continue;
      const ownKey = adSetKey(effectiveStoreId, platform, campaignId, a.id);
      const own = productMap[ownKey];
      if (Array.isArray(own) && own.length > 0) {
        out.set(a.id, { ownCount: own.length, inheritedCount: 0 });
      } else {
        // No own entry → it inherits the campaign mapping. Count via the
        // resolver so precedence stays the single source of truth.
        const inherited = readProductsForAdSet(effectiveStoreId, platform, campaignId, a.id, productMap);
        out.set(a.id, { ownCount: 0, inheritedCount: inherited.length });
      }
    }
    return out;
  }, [productMap, summary?.adSets, summary?.platform, rows, effectiveStoreId, campaignId]);

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
      if (r.storeId !== effectiveStoreId) continue;
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
  }, [campaignsData, effectiveStoreId]);

  const cannibalizationVerdicts = useMemo(() => {
    if (!summary) return [];
    return detectProductCannibalization({
      range: { from: rangeFrom, to: rangeTo },
      storeId: effectiveStoreId,
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
  }, [summary, rangeFrom, rangeTo, effectiveStoreId, productMap, campaignsData, productsData]);

  const cohort = useMemo(() => {
    if (!summary) return null;
    const productRevenue: Array<{
      productId: string;
      netRevenueCad: number;
      units: number;
    }> = [];
    for (const p of productsData?.rows ?? []) {
      if (p.storeId !== effectiveStoreId) continue;
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
    // Ad-set-level mapping (2026-06-23): per-ad-set spend from the raw
    // campaign rows (each carries adSetId + spend). Passed to the allocator
    // so an ad-set with its own product mapping overrides its campaign's.
    // No-op when no ad-set mappings exist — the allocator ignores this and
    // the campaign-level output stays byte-identical.
    const adSetSpend = new Map<string, number>();
    for (const r of campaignsData?.rows ?? []) {
      if (r.storeId !== effectiveStoreId) continue;
      if (!r.adSetId) continue;
      const k = adSetKey(r.storeId, r.platform, r.campaignId, r.adSetId);
      adSetSpend.set(k, (adSetSpend.get(k) ?? 0) + r.spend);
    }
    const ordersForAllocator = (ordersAttrData?.rows ?? [])
      .filter(o => o.storeId === effectiveStoreId)
      .filter(o => o.date >= rangeFrom && o.date <= rangeTo)
      .map(o => ({
        storeId: o.storeId,
        source: o.source,
        fbclidPresent: o.fbclidPresent,
        gclidPresent: o.gclidPresent,
        lineItems: o.lineItems ?? [],
      }));
    const alloc = allocateProductRevenue({
      storeId: effectiveStoreId,
      map: productMap,
      productRevenue,
      campaignSpend,
      adSetSpend,
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
  }, [summary, currentCampaignKey, productMap, cohortAggregated, campaignsData, productsData, ordersAttrData, effectiveStoreId, rangeFrom, rangeTo]);

  const productChannelBreakdown = useMemo(() => {
    if (!summary || summary.platform !== 'Meta') return null;
    if (mappedIds.length === 0) return null;
    const ordersRows = ordersAttrData?.rows ?? [];
    if (ordersRows.length === 0 || rows.length === 0) return null;
    const breakdown = analyzeProductChannel({
      productIds: mappedIds,
      orders: ordersRows,
      storeId: effectiveStoreId,
      dateFrom: rangeFrom,
      dateTo: rangeTo,
    });
    if (breakdown.totalOrders < 3) return null;
    return breakdown;
  }, [summary, ordersAttrData, rows, mappedIds, effectiveStoreId, rangeFrom, rangeTo]);

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

  // ---- Bail early -----------------------------------------------------
  if (!open || !summary) return null;

  // ---- Per-render derivations -----------------------------------------
  const reconciliation = buildReconciliation({
    summary: { platform: summary.platform },
    mappedIds,
    // P2 fix — scope channel + Shopify series to the effective store so a
    // remapped TikTok campaign's post-rewrite spend + its mapped-product
    // orders aren't filtered out (raw store → all-zero series + spurious
    // "Dark traffic 100%"). No-op for non-remapped campaigns.
    storeId: effectiveStoreId,
    campaignsData,
    ordersData: ordersAttrData,
    productMap,
    rangeFrom,
    rangeTo,
  });
  // Fix #13: blended NET/GROSS factor for the effective store over the range,
  // from products_daily (gross `revenue` vs `netRevenue`). Threaded into
  // analyzeAttribution so the drawer's "ROAS אמיתי לפי click-id" sits on the
  // SAME net basis as the headline MER (the matched-orders sum is gross-of-
  // refunds — no refund rows are recorded on the attribution path). Uniform per
  // store/period; degrades to factor 1 when there's no gross in the range.
  const effectiveNetAdjust = (() => {
    let net = 0;
    let gross = 0;
    for (const p of productsData?.rows ?? []) {
      if (p.storeId !== effectiveStoreId) continue;
      if (p.date < rangeFrom || p.date > rangeTo) continue;
      gross += p.revenue;
      net += p.netRevenue ?? p.revenue;
    }
    return netAdjustFactor(net, gross).factor;
  })();
  const analysis = analyzeAttribution(
    {
      campaignName: summary.campaignName,
      campaignId,
      // P2 fix — match orders to the effective store; a remapped TikTok
      // campaign's orders live under the effective store, so the raw store
      // matched zero orders (wrong-store attribution). No-op when not remapped.
      storeId: effectiveStoreId,
      platform: summary.platform,
      // Bug #1 fix — claim + spend + daily series from the EFFECTIVE store (see
      // `effectiveClaim` above), so they share the same scope as the matched
      // orders. Identical to summary.* when the campaign isn't remapped.
      metaClaim: effectiveClaim.value,
      spend: effectiveClaim.spend,
    },
    ordersAttrData?.rows ?? [],
    rangeFrom,
    rangeTo,
    effectiveClaim.dailyArr,
    effectiveNetAdjust,
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
                <StoreIcon size={14} className="text-ink-secondary" aria-hidden />
                חנות בעלת הקמפיין
                {isUnmapped && (
                  <span className="text-fs-2xs font-medium text-status-orangeFg">
                    (לא ממופה · ברירת מחדל uzoshop)
                  </span>
                )}
              </Heading>
            </div>
            <p className="text-fs-xs text-ink-muted leading-relaxed bg-pill-track rounded-hz px-3 py-2 mb-2">
              {/* Copy-truth (2026-06-10 audit P1-26): cron-live-heavy was
                  decommissioned in Phase E1 — the hot-metrics worker (~10 דק׳)
                  is what rewrites campaigns_daily now. */}
              ה-TikTok advertiser שלנו (uzoshop) משרת מספר חנויות. בחר לאיזו חנות הקמפיין שייך —
              קודם תייג חנות, אח״כ שייך מוצרים. שינוי חל מיידית על מיפוי המוצרים למטה; הסבב הבא של ה-worker (כ-10 דק׳)
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
              {storeList.map((s) => (
                <option key={s.storeId} value={s.storeId}>{s.storeName}</option>
              ))}
            </NativeSelect>
            {!isUnmapped && currentValue !== storeId && (
              <p className="text-fs-xs text-status-orangeFg mt-2 inline-flex items-start gap-1">
                <AlertTriangle size={11} className="shrink-0 mt-0.5" aria-hidden />
                <span>מיפוי המוצרים למטה כבר מציג את {currentValue}. שאר הפאנלים בכרטיסייה הזו עדיין מציגים נתונים של {storeId} עד שה-worker יכתוב מחדש (כ-10 דק׳).</span>
              </p>
            )}
          </section>
        );
      })()
    : null;

  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()}>
      <SheetContent
        variant="modal"
        dir="rtl"
        onEscapeKeyDown={(e) => e.preventDefault()}
        aria-labelledby="campaign-drawer-title"
        className={cn(
          // Wave-4 Task 4.2 — the campaign view is a centered MODAL (mockup).
          // Layout (centering, flex column, overflow-hidden, hero radius,
          // mobile full-screen sheet, zoom/fade entrance) all come from the
          // Sheet `variant="modal"` cva. Here we only reset the default
          // content padding so Sheet.Header / Sheet.Body fill edge-to-edge,
          // and pin the on-screen width to the operator's preferred 880px
          // (overriding the cva's 920px default to keep the prior feel).
          // The mobile sheet (max-sm:w-full from the cva) still wins on phones.
          'p-0 sm:w-[min(880px,92vw)]',
        )}
      >
        {/* Sheet.Header — NEUTRAL sticky glass strip (Task 1.5). No
            `data-band`: the header uses the SheetHeader primitive's own
            sticky/bg-glass-2/95/backdrop/border-b surface. Identity reads
            from the brand-colored platform pill + store/ROAS/active-days
            chips below the name — NOT from a full band gradient. Dropping
            `data-band` also unblocks the `.glass[data-band]:not(
            [data-mounted])` opacity:0 rule that previously hid this header. */}
        <SheetHeader data-testid="campaign-drawer-hero">
          {/* pe-10 reserves space for the Sheet primitive's auto-injected
              close X (positioned at `end-3 top-3`, ~32 px wide w/ padding) so
              the title row never sits underneath it. The X stays at z-20 from
              Wave-2 Task 2.5. Wave-4 Task 4.2 removed the ⤢ expand/maximize
              control — the modal is a fixed-size centered card (full-screen
              sheet on mobile), so only the X close remains. */}
          <div className="min-w-0 pe-10">
            <Heading as="h2" level="hero" id="campaign-drawer-title" className="truncate">
              {summary.campaignName ? <bdi dir="ltr">{summary.campaignName}</bdi> : '(ללא שם)'}
            </Heading>
            <div className="flex flex-wrap items-center gap-2 mt-2">
              {/* platform pill — brand-tinted bg (CSS class) wrapping the canonical PlatformBadge */}
              <span className="platform-pill" data-platform={normalizePlatform(summary.platform) ?? undefined}>
                <PlatformBadge platform={summary.platform} size="sm" />
              </span>
              {/* store */}
              <span className="inline-flex items-center gap-1.5 rounded-full bg-glass-2 border border-glass-edge px-2.5 py-1 text-xs font-semibold text-ink-secondary">
                <StoreIcon size={12} />
                <span>{effectiveStoreName}</span>
              </span>
              {/* ROAS health chip — band-tone colored, only when a meaningful ratio exists */}
              {summary.roas != null && summary.roas > 0 && (
                <span
                  className={cn('inline-flex items-center rounded-full px-2.5 py-1 text-xs font-extrabold tabular-nums', ROAS_TONE_BG[roasLabel(summary.roas).tone])}
                  dir="ltr"
                >
                  ROAS {summary.roas.toFixed(2)}×
                </span>
              )}
              {/* active days */}
              <span className="inline-flex items-center gap-1.5 rounded-full bg-glass-2 border border-glass-edge px-2.5 py-1 text-xs font-semibold text-ink-secondary">
                <Calendar size={12} />
                <span className="tabular-nums">{summary.activeDays} ימים</span>
              </span>
            </div>
          </div>
          {link && (
            <a
              href={link}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 mt-3 text-xs sm:text-sm text-accent hover:text-accent-deep font-medium"
            >
              <ExternalLink size={13} />
              פתח ב-<bdi dir="ltr">{summary.platform}</bdi> Ads Manager
            </a>
          )}
        </SheetHeader>

        <SheetBody>
          {/* P0-4 (2026-06-10): explicit fetch-failure strip. Without it a DB
              failure rendered every tab as a plausible "no data" state. */}
          {drawerFetchErrors.length > 0 && (
            <div
              role="alert"
              data-testid="campaign-drawer-fetch-error"
              className="mb-4 rounded-md bg-status-redBg border border-status-red text-status-redFg px-3 py-2 text-[12px] leading-relaxed"
            >
              <strong>שגיאה בטעינת {drawerFetchErrors.join(' · ')}.</strong>{' '}
              חלק מהפאנלים במגירה עשויים להיראות ריקים — זו תקלת טעינה, לא היעדר נתונים. סגור ופתח מחדש כדי לנסות שוב.
            </div>
          )}
          <Tabs
            variant="underline"
            value={activeTab}
            onValueChange={(v) => setActiveTab(v as SubTab)}
          >
            <TabsList className="mb-4" data-testid="campaign-drawer-tabs">
              <TabsTrigger value="overview" data-testid="campaign-drawer-tab-trigger-overview">סקירה</TabsTrigger>
              <TabsTrigger value="daily" data-testid="campaign-drawer-tab-trigger-daily">יומי</TabsTrigger>
              <TabsTrigger value="adsets" data-testid="campaign-drawer-tab-trigger-adsets">סטים</TabsTrigger>
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
                onEditMapping={() => {
                  // Campaign scope: clear any ad-set selection so the single
                  // picker opens campaign-scoped (legacy behaviour).
                  setEditingAdSet(null);
                  setPickerOpen(true);
                }}
                storeMappingSlot={storeMappingSlot}
              />
            </TabsContent>

            <TabsContent value="daily">
              {/* P2 fix — `storeId={effectiveStoreId}`: the prev-period CPM
                  comparison filters campaignsDataPrev by store; a remapped
                  TikTok campaign's prior rows live under the effective store
                  too. No-op when the campaign isn't remapped. */}
              <CampaignDrawerDaily
                dailyArr={summary.dailyArr}
                rangeFrom={rangeFrom}
                rangeTo={rangeTo}
                prevRange={prevRange}
                campaignsDataPrev={campaignsDataPrev}
                onAnalysisModeChange={setCpmAnalysisMode}
                storeId={effectiveStoreId}
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
                rangeIncludesToday={rangeIncludesToday}
                mappingByAdSet={mappingByAdSet}
                onMapProducts={(set) => {
                  // Force the effective store + the campaign's platform so the
                  // ad-set key matches the productMap/allocator scope (TikTok
                  // remap-aware). The row carries the same store/platform, but
                  // we normalise via the drawer's resolved scope.
                  setEditingAdSet({
                    storeId: effectiveStoreId,
                    platform: summary.platform,
                    campaignId,
                    adSetId: set.adSetId,
                    adSetName: set.adSetName,
                  });
                  setPickerOpen(true);
                }}
              />
            </TabsContent>

            <TabsContent value="ads">
              <CampaignDrawerAds
                adSets={summary.adSets}
                platform={summary.platform}
                onDrillAds={setAdDrillSet}
                rangeIncludesToday={rangeIncludesToday}
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

          <div className="text-fs-2xs text-ink-muted text-center pt-6">
            לחץ Esc או על הרקע לסגירה
          </div>
        </SheetBody>
      </SheetContent>

      {/* ONE ProductPickerModal serves both scopes. `editingAdSet` decides:
          when set, it's scoped to that ad-set (header + initial = the ad-set's
          OWN 4-segment mapping; save → setMappedProductsForAdSet). When null,
          it's the campaign-level picker (byte-for-byte unchanged). */}
      <ProductPickerModal
        open={pickerOpen}
        onClose={() => {
          setPickerOpen(false);
          setEditingAdSet(null);
        }}
        storeId={effectiveStoreId}
        storeName={effectiveStoreName}
        campaignName={summary.campaignName}
        adSetId={editingAdSet?.adSetId}
        adSetName={editingAdSet?.adSetName}
        initial={
          editingAdSet
            ? // Ad-set scope: seed ONLY from the ad-set's own 4-segment entry
              // (not the inherited campaign mapping) so an empty selection
              // means "inherit", and saving a list writes the ad-set override.
              productMap[
                adSetKey(effectiveStoreId, summary.platform, campaignId, editingAdSet.adSetId)
              ] ?? []
            : productMap[campaignKey(effectiveStoreId, summary.platform, campaignId)] ?? []
        }
        otherCampaignsByProduct={otherCampaignsByProduct}
        onSave={(productIds) => {
          if (editingAdSet) {
            setMappedProductsForAdSet(
              effectiveStoreId,
              summary.platform,
              campaignId,
              editingAdSet.adSetId,
              productIds,
            );
          } else {
            setMappedProducts(effectiveStoreId, summary.platform, campaignId, productIds);
          }
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
