'use client';

import { useEffect, useMemo, useState } from 'react';
import useSWR from 'swr';
import {
  AlertCircle,
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  Calendar,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Circle,
  ExternalLink,
  Megaphone,
  Store as StoreIcon,
  X,
} from 'lucide-react';
import { cn, formatCurrency, formatDate, formatNumber } from '@/lib/utils';
import type { CampaignRow } from '@/lib/campaigns';
import { buildAdsManagerLink, type AdAccountMap } from '@/lib/campaignsLinks';
import {
  clearAllOptimized,
  readOptimized,
  toggleOptimized,
} from '@/lib/campaignOptimized';
import {
  allocateProductRevenue,
  campaignKey,
  readProductMap,
  type ProductMap,
} from '@/lib/campaignProductMap';
import type { ProductsResponse } from '@/app/api/products/route';
import type { OrdersAttributionResponse } from '@/app/api/orders-attribution/route';
import {
  analyzeAttribution,
  type AttributionAnalysis,
} from '@/lib/attributionAnalysis';
import type { CampaignsResponse } from '@/app/api/campaigns/route';
import type { DateRange } from '@/lib/types';
import { roasLabel } from '@/lib/analytics';
import { CampaignDrawer } from './CampaignDrawer';
import { AdsDrawer } from './AdsDrawer';

type Mode = 'campaign' | 'adset';
type Platform = 'all' | 'Meta' | 'Google';

/**
 * Per-campaign output of the true-ROAS allocation. `trueRevenue` is the
 * Shopify-actual revenue allocated to this campaign (proportional to spend
 * when products are shared). `confidence` is a heuristic trust signal so
 * the user knows whether a gap vs Meta is likely real or just an artifact
 * of incomplete mapping / shared attribution / low sample size.
 */
type TrueRevenueInfo = {
  trueRevenue: number;
  /** Allocated Shopify units sold of mapped products in the date range —
   *  uses the same spend-proportional share as trueRevenue. Surfaced as a
   *  separate column so the operator can sanity-check the revenue figure
   *  against unit volume. */
  trueUnits: number;
  metaClaim: number;
  spend: number;
  mappedCount: number;
  sharedCampaigns: number;
  confidence: ConfidenceLevel;
  /** Deterministic per-order attribution analysis (from
   *  /api/orders-attribution). When present, this is the authoritative
   *  signal — replaces the heuristic confidence chip with click-ID-proven
   *  numbers ('X orders tagged, Y modeled, Z% coverage'). null when:
   *    - Google campaign (no per-product attribution),
   *    - orders-attribution tab missing (first deploy), or
   *    - the new pipeline hasn't run yet. */
  attribution: AttributionAnalysis | null;
};

type ConfidenceLevel = {
  /** Color-coded bucket — drives the chip background in the row. */
  level: 'high' | 'medium' | 'low';
  /** Hebrew label shown in the chip itself. */
  label: string;
  /** Multi-line explanation shown in the tooltip. Lists the actual reasons
   *  this campaign landed in this bucket so the user can act on them
   *  (extend mapping, narrow shared products, wait for more spend). */
  reasons: string[];
};

/**
 * Decide how much to trust a campaign's true-ROAS number. Heuristic — not a
 * statistical test — but tuned so the warning bands match the common
 * failure modes operators run into:
 *   - low spend → noise dominates
 *   - mapping shared with many campaigns → allocation arbitrary
 *   - very few mapped products → likely missing the actual hero
 *   - massive Meta vs Shopify gap (>70%) → could be over-attribution OR
 *     incomplete mapping OR halo, but in any case the user shouldn't
 *     treat the gap as gospel without investigating
 */
function computeConfidence(
  trueRevenue: number,
  metaClaim: number,
  spend: number,
  sharedCampaigns: number,
  mappedCount: number,
): ConfidenceLevel {
  const reasons: string[] = [];
  let level: ConfidenceLevel['level'] = 'high';

  // The gap is the primary signal — if Meta and Shopify agree, every
  // other warning becomes much weaker (the agreement is the validation).
  // Computed first so downstream rules can reference it.
  const gap = metaClaim > 0 || trueRevenue > 0
    ? Math.abs(trueRevenue - metaClaim) / Math.max(metaClaim, trueRevenue, 1)
    : 0;

  // Pure return-value version so TS's flow-sensitive type tracking sees the
  // mutations at the call sites (closure mutation hides them and made the
  // final ternary fail with 'low and medium have no overlap'). Same logic:
  // 'high' can drop to anything; 'medium' can drop to 'low'; 'low' stays.
  function applyDowngrade(current: ConfidenceLevel['level'], target: 'medium' | 'low'): ConfidenceLevel['level'] {
    if (current === 'high') return target;
    if (current === 'medium' && target === 'low') return 'low';
    return current;
  }

  // Hard gap thresholds — Meta and Shopify telling different stories.
  if (gap > 0.7) {
    level = 'low';
    reasons.push(`פער של ${(gap * 100).toFixed(0)}% מול Meta — בדוק לעומק לפני שמסיק מסקנות`);
  } else if (gap > 0.3) {
    level = applyDowngrade(level, 'medium');
    reasons.push(`פער של ${(gap * 100).toFixed(0)}% מול Meta — סביר, יתכן שילוב של over-attribution + halo`);
  }

  // Shared products. 3+ is always concerning; 1-2 only matters when there's
  // also a non-trivial gap (with perfect agreement, sharing is fine).
  if (sharedCampaigns >= 3) {
    level = applyDowngrade(level, 'low');
    reasons.push(`מוצרים משותפים עם ${sharedCampaigns} קמפיינים אחרים — החלוקה קירוב`);
  } else if (sharedCampaigns >= 1 && gap > 0.15) {
    level = applyDowngrade(level, 'medium');
    reasons.push(`מוצרים משותפים עם עוד ${sharedCampaigns} קמפיין${sharedCampaigns > 1 ? 'ים' : ''} — חלוקה פרופורציונלית להוצאה`);
  }

  // Mapping completeness — single product + big gap suggests missing mapping.
  // We don't penalise a single-product mapping when the numbers agree
  // (that's actually evidence the mapping is correct).
  if (mappedCount < 2 && metaClaim > 0 && trueRevenue < metaClaim * 0.5) {
    level = applyDowngrade(level, 'medium');
    reasons.push('מוצר יחיד משויך + פער גדול מול Meta — ייתכן שמיפוי לא מלא');
  }

  // Low spend = small sample. Used to be an automatic LOW downgrade, which
  // produced false negatives whenever spend was modest but the two sources
  // agreed strongly (e.g. CAD 78 spend, Meta 1335 vs Shopify 1375 — gap 3%).
  // Now: only downgrade when the gap is also non-trivial; otherwise just
  // an FYI line.
  if (spend < 200) {
    if (gap > 0.15) {
      level = applyDowngrade(level, 'medium');
      reasons.push(`הוצאה נמוכה בתקופה (CAD ${spend.toFixed(0)}) — המדגם קטן, פער ${(gap * 100).toFixed(0)}% עשוי להיות רעש`);
    } else {
      reasons.push(`הוצאה נמוכה (CAD ${spend.toFixed(0)}) — שני המקורות מסכימים, אבל המדגם קטן`);
    }
  }

  if (reasons.length === 0) {
    reasons.push('מיפוי מלא, פער קטן, הוצאה מספיקה — מספרים אמינים');
  }
  const label = level === 'high' ? 'אמין' : level === 'medium' ? 'חלקי' : 'לא אמין';
  return { level, label, reasons };
}

/** All columns the user can sort by. Strings sort lexicographically;
 *  everything else is a numeric metric. */
type SortKey =
  | 'name'
  | 'spend'
  | 'budget'
  | 'conversionValue'
  | 'roas'
  | 'shopifyRoas'   // ROAS computed from actual Shopify sales of mapped products
  | 'conversions'
  | 'ctr'
  | 'cpc'
  | 'cpa';
type SortDir = 'asc' | 'desc';

const fetcher = async (url: string) => {
  const r = await fetch(url);
  if (!r.ok) {
    const body = await r.json().catch(() => ({}));
    throw new Error(body?.error || `HTTP ${r.status}`);
  }
  return r.json() as Promise<CampaignsResponse>;
};

const TONE_BG: Record<string, string> = {
  red:    'bg-roas-redBg text-roas-red',
  orange: 'bg-roas-orangeBg text-roas-orange',
  green:  'bg-roas-greenBg text-roas-green',
  blue:   'bg-roas-blueBg text-roas-blue',
  gray:   'bg-surfaceMuted text-text-muted',
};

function todayInIsrael(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Jerusalem',
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());
}

// --- Aggregation ------------------------------------------------------------

type Aggregated = {
  key: string;             // groupBy key, used as React key
  storeId: string;         // needed to build the right Ads Manager deep link
  storeName: string;
  platform: string;
  campaignId: string;
  campaignName: string;
  adSetId?: string;
  adSetName?: string;
  spend: number;
  impressions: number;
  clicks: number;
  conversions: number;
  conversionValue: number;
  /** Daily campaign-level budget in CAD (CBO). null when ABO / unknown. */
  campaignBudgetCad: number | null;
  /** Daily ad-set-level budget in CAD (ABO, ad-set rows only). null when CBO
   *  or unknown. */
  adSetBudgetCad: number | null;
  /** 'CBO' / 'ABO' / '' (unknown). Taken from the most recent matching row
   *  during aggregation since the type is a current-state property. */
  budgetType: 'CBO' | 'ABO' | '';
};

function aggregate(
  rows: CampaignRow[],
  mode: Mode,
  storeFilter: string,
  platformFilter: Platform,
  range: DateRange,
): Aggregated[] {
  const map = new Map<string, Aggregated>();
  // Per-key "latest budget date" tracker so the overwrite logic depends on
  // the row's `date` field, NOT iteration order (#IN-02). Apps Script's
  // writeCampaignRowsForDay appends backfilled past dates to the END of
  // the sheet, which means a stale past-date row could otherwise stamp
  // its budget as "current". Kept as a sidecar Map rather than fields on
  // the public Aggregated type so consumers downstream are unaffected.
  const latestBudgetDate = new Map<string, string>();
  const latestAdSetBudgetDate = new Map<string, string>();
  const latestBudgetTypeDate = new Map<string, string>();
  for (const r of rows) {
    if (r.date < range.from || r.date > range.to) continue;
    if (storeFilter !== 'All' && r.storeName !== storeFilter) continue;
    if (platformFilter !== 'all' && r.platform !== platformFilter) continue;

    const key =
      mode === 'campaign'
        ? `${r.storeId}::${r.platform}::${r.campaignId}`
        : `${r.storeId}::${r.platform}::${r.campaignId}::${r.adSetId}`;

    if (!map.has(key)) {
      map.set(key, {
        key,
        storeId: r.storeId,
        storeName: r.storeName,
        platform: r.platform,
        campaignId: r.campaignId,
        campaignName: r.campaignName,
        adSetId: mode === 'adset' ? r.adSetId : undefined,
        adSetName: mode === 'adset' ? r.adSetName : undefined,
        spend: 0,
        impressions: 0,
        clicks: 0,
        conversions: 0,
        conversionValue: 0,
        // Budgets are a current-state property — every row carries today's
        // value. Seed with this row's values; the loop below upgrades to
        // the chronologically-latest value as we see more rows.
        campaignBudgetCad: r.campaignBudgetCad,
        adSetBudgetCad: mode === 'adset' ? r.adSetBudgetCad : null,
        budgetType: r.budgetType,
      });
      if (r.campaignBudgetCad != null) latestBudgetDate.set(key, r.date);
      if (mode === 'adset' && r.adSetBudgetCad != null) latestAdSetBudgetDate.set(key, r.date);
      if (r.budgetType) latestBudgetTypeDate.set(key, r.date);
    }
    const a = map.get(key)!;
    a.spend += r.spend;
    a.impressions += r.impressions;
    a.clicks += r.clicks;
    a.conversions += r.conversions;
    a.conversionValue += r.conversionValue;
    // Budget reflects "current" — pick the row with the chronologically
    // latest `date`, NOT the last-iterated row. Backfills of past dates
    // (Apps Script appends them to the end of the sheet) would otherwise
    // stamp their stale budget value as current. (#IN-02)
    if (r.campaignBudgetCad != null) {
      const prev = latestBudgetDate.get(key);
      if (!prev || r.date >= prev) {
        a.campaignBudgetCad = r.campaignBudgetCad;
        latestBudgetDate.set(key, r.date);
      }
    }
    if (mode === 'adset' && r.adSetBudgetCad != null) {
      const prev = latestAdSetBudgetDate.get(key);
      if (!prev || r.date >= prev) {
        a.adSetBudgetCad = r.adSetBudgetCad;
        latestAdSetBudgetDate.set(key, r.date);
      }
    }
    if (r.budgetType) {
      const prev = latestBudgetTypeDate.get(key);
      if (!prev || r.date >= prev) {
        a.budgetType = r.budgetType;
        latestBudgetTypeDate.set(key, r.date);
      }
    }
  }
  return Array.from(map.values());
}

/** Sort a list of aggregated rows by the chosen column + direction.
 *  Derived metrics (ROAS, CTR, CPC, CPA) are computed inline since they
 *  aren't stored on the Aggregated type. */
function sortAggregated(
  list: Aggregated[],
  mode: Mode,
  sortKey: SortKey,
  dir: SortDir,
): Aggregated[] {
  const sign = dir === 'asc' ? 1 : -1;
  function valueOf(a: Aggregated): number | string {
    switch (sortKey) {
      case 'name':
        return (mode === 'campaign' ? a.campaignName : a.adSetName || '') || '';
      case 'spend':
        return a.spend;
      case 'budget':
        // The visible budget for the row: campaign-level when in campaign mode,
        // ad-set-level when in ad-set mode. null becomes 0 so empty rows sort
        // to the bottom on desc.
        return (
          mode === 'campaign'
            ? a.campaignBudgetCad ?? 0
            : a.adSetBudgetCad ?? 0
        );
      case 'conversionValue':
        return a.conversionValue;
      case 'roas':
        return a.spend > 0 ? a.conversionValue / a.spend : 0;
      case 'shopifyRoas': {
        // Shopify-true ROAS isn't on the Aggregated row (it's computed
        // separately from the product map). Sort by it requires the
        // outer scope's `trueRevenueByKey`; we don't have it here, so we
        // fall through to sort by Meta ROAS — the column header still
        // toggles direction. Real value-based sort happens at render
        // time via a separate prepared list (see `display` below).
        return a.spend > 0 ? a.conversionValue / a.spend : 0;
      }
      case 'conversions':
        return a.conversions;
      case 'ctr':
        return a.impressions > 0 ? a.clicks / a.impressions : 0;
      case 'cpc':
        return a.clicks > 0 ? a.spend / a.clicks : 0;
      case 'cpa':
        return a.conversions > 0 ? a.spend / a.conversions : 0;
    }
  }
  const sorted = [...list].sort((x, y) => {
    const vx = valueOf(x);
    const vy = valueOf(y);
    if (typeof vx === 'string' && typeof vy === 'string') {
      return sign * vx.localeCompare(vy, 'he');
    }
    return sign * ((vx as number) - (vy as number));
  });
  return sorted;
}

// Ads Manager deep links are built via `buildAdsManagerLink` in lib/campaigns
// (which needs the storeId → ad-account-ID map fetched from /api/store-meta).
// The old local stub here returned a link missing `act=` / `__c=`, so Meta
// and Google Ads opened the user's last-used account instead of the
// campaign's account — leading to "campaign not found" landings.

// --- Component --------------------------------------------------------------

type Props = {
  range: DateRange;
  store: string;
  stores: string[];
  /** All daily rows from data-daily. Used to compute the Pixel-vs-Shopify
   *  attribution gap panel — Shopify revenue is the source of truth, Meta's
   *  conversion_value is the platform's self-report. */
  dailyRows: import('@/lib/types').DailyRow[];
};

const TOP_N_DEFAULT = 10;

export function CampaignsTable({ range, store: globalStore, stores, dailyRows }: Props) {
  const { data, error, isLoading } = useSWR<CampaignsResponse>(
    '/api/campaigns',
    fetcher,
    { refreshInterval: 120_000, revalidateOnFocus: false },
  );

  // store-meta provides the Meta ad-account ID / Google Ads customer ID per
  // store. We use it to build deep links that open the right account in Ads
  // Manager. Without these IDs, links would land on whatever account the user
  // last viewed (not the campaign's account).
  const { data: storeMeta } = useSWR<{ rows: Array<{ storeId: string; metaAdAccountId: string | null; googleAdsCustomerId: string | null }> }>(
    '/api/store-meta',
    async (url: string) => {
      const r = await fetch(url);
      if (!r.ok) return { rows: [] };
      return r.json();
    },
    { revalidateOnFocus: false, dedupingInterval: 300_000 },
  );
  const adAccounts: AdAccountMap = useMemo(() => {
    const out: AdAccountMap = {};
    for (const row of storeMeta?.rows ?? []) {
      out[row.storeId] = {
        metaAdAccountId: row.metaAdAccountId ?? null,
        googleAdsCustomerId: row.googleAdsCustomerId ?? null,
      };
    }
    return out;
  }, [storeMeta]);

  // Products data + mapping. Together they let us compute "true ROAS" —
  // attributing actual Shopify product sales back to campaigns instead of
  // trusting Meta's self-reported conversion value (which is routinely
  // inflated by view-through credit + modeled conversions).
  const { data: productsResp } = useSWR<ProductsResponse>(
    '/api/products',
    async (url: string) => {
      const r = await fetch(url);
      if (!r.ok) return { rows: [], lastUpdated: new Date().toISOString() };
      return r.json();
    },
    { revalidateOnFocus: false, dedupingInterval: 60_000 },
  );
  // Per-order attribution from {storeId}-orders-attribution tabs. Lets the
  // confidence chip be based on actual click-ID proof instead of just the
  // proportional product allocation. When this is empty (first deploy,
  // before Apps Script has run the new pipeline), `analyzeAttribution`
  // returns null and the row falls back to the old heuristic chip.
  const { data: ordersAttrResp } = useSWR<OrdersAttributionResponse>(
    '/api/orders-attribution',
    async (url: string) => {
      const r = await fetch(url);
      if (!r.ok) return { rows: [], lastUpdated: new Date().toISOString() };
      return r.json();
    },
    { revalidateOnFocus: false, dedupingInterval: 60_000 },
  );
  const [productMap, setProductMap] = useState<ProductMap>(() => ({}));
  useEffect(() => {
    setProductMap(readProductMap());
    const onChange = () => setProductMap(readProductMap());
    window.addEventListener('roas-campaign-product-map-changed', onChange);
    return () => window.removeEventListener('roas-campaign-product-map-changed', onChange);
  }, []);

  const [mode, setMode] = useState<Mode>('campaign');
  const [platform, setPlatform] = useState<Platform>('all');
  const [showAll, setShowAll] = useState(false);

  // "Optimized" marks — purely a UX helper while the user goes through
  // campaigns/ad-sets and ticks the ones they've already touched. Hydrated
  // from localStorage on mount, kept in sync across devices by the cloud
  // sync layer (registered as 'campaign-optimized' in STATE_KEYS).
  const [optimized, setOptimized] = useState<Set<string>>(() => new Set());
  useEffect(() => {
    setOptimized(readOptimized());
    const onChange = () => setOptimized(readOptimized());
    window.addEventListener('roas-campaign-optimized-changed', onChange);
    return () => window.removeEventListener('roas-campaign-optimized-changed', onChange);
  }, []);
  function onToggleOptimized(key: string) {
    setOptimized(prev => toggleOptimized(key, prev));
  }
  function onClearAll() {
    setOptimized(clearAllOptimized());
  }

  // Sort state. Defaults to ROAS desc — same as the implicit sort before.
  // Click a different column → switch + reset to desc (because users almost
  // always want "biggest first" for ad metrics). Click the same column →
  // toggle direction.
  const [sortKey, setSortKey] = useState<SortKey>('roas');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  function handleSort(key: SortKey) {
    if (key === sortKey) {
      setSortDir(d => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      // For the name column, ascending feels more natural (A-Z).
      setSortDir(key === 'name' ? 'asc' : 'desc');
    }
    setShowAll(false); // collapse "show more" back to top-N after re-sort
  }

  // Sync to global filters but allow local override.
  const [localStore, setLocalStore] = useState(globalStore);
  useEffect(() => { setLocalStore(globalStore); }, [globalStore]);

  const [localRange, setLocalRange] = useState<DateRange>(range);
  // Drill-down drawer state — set when the user clicks a row.
  const [drillCampaignId, setDrillCampaignId] = useState<string | null>(null);
  const [drillPlatform, setDrillPlatform] = useState<string | null>(null);
  // Ad-level drilldown: when set, opens the AdsDrawer scoped to one ad-set.
  const [adDrill, setAdDrill] = useState<{
    storeId: string;
    campaignId: string;
    adSetId: string;
    adSetName: string;
  } | null>(null);
  useEffect(() => { setLocalRange(range); }, [range.from, range.to]); // eslint-disable-line react-hooks/exhaustive-deps

  const today = todayInIsrael();
  const isCustomRange =
    localRange.from !== range.from || localRange.to !== range.to;

  const aggregated = useMemo(() => {
    if (!data) return [];
    const list = aggregate(data.rows, mode, localStore, platform, localRange);
    return sortAggregated(list, mode, sortKey, sortDir);
  }, [data, mode, localStore, platform, localRange, sortKey, sortDir]);

  /**
   * "True ROAS" allocation per campaign. For each campaign that has mapped
   * products, sum the actual Shopify net revenue across those products
   * (filtered to the same store and date range), then allocate
   * proportionally to spend when a product is shared with other campaigns.
   *
   * Returns a Map<campaignKey, { trueRevenue, confidence, mappedCount,
   * sharedProducts, metaClaim }> so the renderer can show both the number
   * and the trust signal in one lookup.
   *
   * Only meaningful in campaign mode (mapping is at the campaign level).
   * In ad-set mode the map is empty so all rows fall back to Meta numbers.
   */
  const trueRevenueByKey = useMemo(() => {
    if (mode !== 'campaign') return new Map<string, TrueRevenueInfo>();
    if (!data?.rows || !productsResp?.rows) return new Map<string, TrueRevenueInfo>();

    // Step 1: compute total spend per campaign-key from the aggregated list
    // (already scoped to localRange/localStore/platform).
    const campaignSpend = new Map<string, number>();
    for (const a of aggregated) {
      campaignSpend.set(campaignKey(a.storeId, a.campaignId), a.spend);
    }

    // Step 2: group product net-revenue by (storeId, productId) over the
    // same date range. We iterate products by store because allocation is
    // scoped to one store at a time (campaigns can't sell products from
    // another store).
    const productsByStore = new Map<string, Array<{ productId: string; netRevenueCad: number; units: number }>>();
    for (const p of productsResp.rows) {
      if (p.date < localRange.from || p.date > localRange.to) continue;
      if (!p.productId) continue;
      const net = p.netRevenue ?? p.revenue; // net wins when available
      if (net <= 0 && p.units <= 0) continue;
      if (!productsByStore.has(p.storeId)) productsByStore.set(p.storeId, []);
      const arr = productsByStore.get(p.storeId)!;
      // Dedupe: sum the multi-day rows into a single per-product total.
      const existing = arr.find(x => x.productId === p.productId);
      if (existing) {
        existing.netRevenueCad += net;
        existing.units += p.units;
      } else {
        arr.push({ productId: p.productId, netRevenueCad: net, units: p.units });
      }
    }

    // Step 3: run the allocator per store (keeps the storeId scoping that
    // campaignsForProduct enforces). The allocator now returns both
    // revenue and units per campaign, sharing the same spend-proportional
    // share so the numbers stay internally consistent.
    const allocations = new Map<string, { revenue: number; units: number }>();
    for (const [storeId, productRev] of productsByStore) {
      const allocated = allocateProductRevenue({
        storeId,
        map: productMap,
        productRevenue: productRev,
        campaignSpend,
      });
      for (const [k, v] of allocated) {
        const cur = allocations.get(k) ?? { revenue: 0, units: 0 };
        cur.revenue += v.revenue;
        cur.units += v.units;
        allocations.set(k, cur);
      }
    }

    // Step 4: build the per-key info object with the trust signal.
    const out = new Map<string, TrueRevenueInfo>();
    for (const a of aggregated) {
      const k = campaignKey(a.storeId, a.campaignId);
      const mappedIds = productMap[k] ?? [];
      if (mappedIds.length === 0) continue; // no mapping → no true-ROAS row
      const alloc = allocations.get(k) ?? { revenue: 0, units: 0 };
      const trueRevenue = alloc.revenue;
      const trueUnits = alloc.units;
      // How many OTHER campaigns share at least one of this campaign's
      // mapped products? Higher overlap → noisier allocation → lower trust.
      //
      // #WR-02: Previously a `shared++` counter with `break` only on the
      // inner loop double-counted whenever one other campaign overlapped
      // on multiple products: A=[P1,P2] and B=[P1,P2] reported shared=2
      // instead of 1, pushing computeConfidence toward 'low' too aggressively.
      // Tracking the unique other-campaign keys in a Set and reading .size
      // implements the documented "count each campaign once" semantics.
      const sharedKeys = new Set<string>();
      for (const pid of mappedIds) {
        for (const otherKey of Object.keys(productMap)) {
          if (otherKey === k) continue;
          if (!otherKey.startsWith(`${a.storeId}::`)) continue;
          if ((productMap[otherKey] ?? []).includes(pid)) {
            sharedKeys.add(otherKey);
          }
        }
      }
      const shared = sharedKeys.size;
      // Daily Meta conv-value series for this specific campaign — used by
      // attribution analysis for outlier detection + window stability.
      // We pull from the raw rows (already filtered to range by aggregate)
      // and bucket by date.
      const dailyMeta = (() => {
        const byDate = new Map<string, number>();
        if (!data) return [];
        for (const r of data.rows) {
          if (r.storeId !== a.storeId) continue;
          if (r.platform !== a.platform) continue;
          if (r.campaignId !== a.campaignId) continue;
          if (r.date < localRange.from || r.date > localRange.to) continue;
          byDate.set(r.date, (byDate.get(r.date) ?? 0) + r.conversionValue);
        }
        return Array.from(byDate.entries()).map(([date, value]) => ({ date, value }));
      })();

      // Deterministic per-order attribution. Uses utm_id (campaignId) for
      // primary matching when present, falls back to utm_campaign by name.
      // Returns null for non-Meta campaigns or when the attribution tab is
      // empty (first deploy). Daily series enables Bayesian / window /
      // outlier analysis.
      const attribution = analyzeAttribution(
        {
          campaignName: a.campaignName,
          campaignId: a.campaignId,
          storeId: a.storeId,
          platform: a.platform,
          metaClaim: a.conversionValue,
          spend: a.spend,
        },
        ordersAttrResp?.rows ?? [],
        localRange.from,
        localRange.to,
        dailyMeta,
      );
      out.set(k, {
        trueRevenue,
        trueUnits,
        metaClaim: a.conversionValue,
        mappedCount: mappedIds.length,
        sharedCampaigns: shared,
        spend: a.spend,
        confidence: computeConfidence(trueRevenue, a.conversionValue, a.spend, shared, mappedIds.length),
        attribution,
      });
    }
    return out;
  }, [mode, data, productsResp, ordersAttrResp, productMap, aggregated, localRange]);

  const totals = useMemo(() => {
    let spend = 0, conv = 0, val = 0, clicks = 0, imps = 0;
    for (const a of aggregated) {
      spend += a.spend;
      conv += a.conversions;
      val += a.conversionValue;
      clicks += a.clicks;
      imps += a.impressions;
    }
    return {
      spend,
      conversions: conv,
      conversionValue: val,
      clicks,
      impressions: imps,
      roas: spend > 0 ? val / spend : 0,
      cpc: clicks > 0 ? spend / clicks : 0,
      cpa: conv > 0 ? spend / conv : 0,
      ctr: imps > 0 ? clicks / imps : 0,
    };
  }, [aggregated]);

  // If the user asked to sort by Shopify-ROAS, re-sort here using the
  // values from `trueRevenueByKey` (the inner sortAggregated falls back to
  // Meta ROAS for this key — we override that here so the column actually
  // sorts by what it shows). Unmapped rows go to the bottom on desc.
  const displaySource = useMemo(() => {
    if (sortKey !== 'shopifyRoas' || trueRevenueByKey.size === 0) return aggregated;
    const sign = sortDir === 'asc' ? 1 : -1;
    const withRoas = aggregated.map(a => {
      const info = trueRevenueByKey.get(campaignKey(a.storeId, a.campaignId));
      const roas = info && a.spend > 0 ? info.trueRevenue / a.spend : 0;
      return { a, roas, mapped: !!info };
    });
    withRoas.sort((x, y) => {
      // Always push unmapped rows to the bottom so the meaningful sort is
      // among the mapped campaigns first.
      if (x.mapped !== y.mapped) return x.mapped ? -1 : 1;
      return sign * (x.roas - y.roas);
    });
    return withRoas.map(w => w.a);
  }, [aggregated, sortKey, sortDir, trueRevenueByKey]);
  const display = showAll ? displaySource : displaySource.slice(0, TOP_N_DEFAULT);
  const remaining = displaySource.length - display.length;

  // ----- Pixel-vs-Shopify attribution gap ----------------------------------
  // Compare what the ad platforms *claim* (conversionValue summed across the
  // currently visible campaigns) against what Shopify actually recorded for
  // the matching dates + stores. This is the highest-impact "trust" view:
  // if Meta is over-counting by 40%, the user should know before scaling.
  const attributionGap = useMemo(() => {
    if (aggregated.length === 0) return null;

    // Sum Meta/Google conversion value across all visible campaigns.
    const platformClaimed = aggregated.reduce(
      (s, a) => s + a.conversionValue,
      0,
    );

    // Shopify revenue: same date range + same store scope as the table.
    let shopifyRevenue = 0;
    let metaSpendInScope = 0;
    let googleSpendInScope = 0;
    for (const r of dailyRows) {
      if (r.date < localRange.from || r.date > localRange.to) continue;
      if (localStore !== 'All' && r.storeName !== localStore) continue;
      shopifyRevenue += r.revenue;
      metaSpendInScope += r.fbSpend;
      googleSpendInScope += r.gaSpend;
    }

    if (shopifyRevenue === 0 && platformClaimed === 0) return null;

    // Gap = how much Shopify exceeds the platform's claim, as a percentage of
    // Shopify revenue. Positive → platforms are UNDER-counting (you have
    // more sales than they credit themselves with — iOS 14 / ad blockers /
    // direct traffic / organic halo).
    // Negative → platforms are OVER-counting (view-through inflation, double
    // counting between Meta and Google, modeled conversions).
    const absGap = shopifyRevenue - platformClaimed;
    const gapPct = shopifyRevenue > 0 ? absGap / shopifyRevenue : 0;

    // ROAS comparison — store-truth vs platform-truth.
    const totalSpendShopify = metaSpendInScope + googleSpendInScope;
    const storeRoas = totalSpendShopify > 0 ? shopifyRevenue / totalSpendShopify : 0;
    const platformRoas =
      totals.spend > 0 ? platformClaimed / totals.spend : 0;

    // Interpretation copy — short, factual, Hebrew.
    // tone: 'warn' was previously declared but never assigned (only 'good'
    // and 'flag' branches exist below). Dropped per #IN-01 to keep the
    // type honest — if we want a moderate band later, add the branch AND
    // the toneClass entry in one go.
    let interpretation: string;
    let tone: 'good' | 'flag';
    if (Math.abs(gapPct) < 0.1) {
      interpretation =
        'הפלטפורמות מדווחות בקרבת אמת ל-Shopify. שיוך אמין יחסית.';
      tone = 'good';
    } else if (gapPct > 0.1) {
      // Shopify > platform — under-attribution
      interpretation =
        platform === 'all'
          ? `הפלטפורמות מ-undercounting: יש לך ${(gapPct * 100).toFixed(0)}% יותר מכירות ב-Shopify ממה שהן מקבלות עליהם קרדיט. נפוץ ב-iOS 14+ / ad blockers / organic halo.`
          : `${platform} מ-undercounting ב-${(gapPct * 100).toFixed(0)}% — ייתכן שיש מכירות שמיוחסות לערוץ אחר או לא משויכות בכלל.`;
      tone = 'good';
    } else {
      // platform > Shopify — over-attribution
      interpretation = `הפלטפורמות מ-overcounting ב-${(Math.abs(gapPct) * 100).toFixed(0)}%. כפיל-ספירה בין Meta ו-Google, view-through inflation, או modeled conversions. אל תקבל החלטות "להגדיל קמפיין" רק על בסיס ה-conversion value של הפלטפורמה.`;
      tone = 'flag';
    }

    return {
      platformClaimed,
      shopifyRevenue,
      absGap,
      gapPct,
      storeRoas,
      platformRoas,
      interpretation,
      tone,
    };
    // `totals` is derived from `aggregated` (see the totals useMemo above), so
    // including `aggregated` already covers any change to `totals.spend`. The
    // extra `totals.spend` dep was redundant and easy to mis-maintain if a
    // future tweak referenced `totals.cpc` but forgot the dep. (#IN-05)
  }, [aggregated, dailyRows, localRange, localStore, platform]);

  // ----- Toolbar -----
  const toolbar = (
    <div className="flex flex-col sm:flex-row sm:items-center sm:flex-wrap gap-2 sm:gap-3 px-4 sm:px-5 py-3 bg-surfaceMuted/40 border-b border-borderSubtle">
      {/* Mode selector: campaign or ad-set */}
      <div className="flex items-center gap-2">
        <span className="text-[11px] sm:text-xs text-text-secondary font-medium shrink-0">
          תצוגה:
        </span>
        <div
          role="tablist"
          className="inline-flex rounded-lg border border-border bg-surface overflow-hidden divide-x divide-border"
          dir="ltr"
        >
          {(['campaign', 'adset'] as Mode[]).map(m => (
            <button
              key={m}
              role="tab"
              aria-selected={mode === m}
              onClick={() => setMode(m)}
              className={cn(
                'px-2.5 sm:px-3.5 py-1.5 text-[11px] sm:text-xs font-medium transition-colors min-w-[64px] sm:min-w-[80px]',
                mode === m
                  ? 'bg-primary text-white'
                  : 'bg-surface text-text-secondary hover:bg-surfaceMuted',
              )}
            >
              {m === 'campaign' ? 'קמפיינים' : 'אד-סטים'}
            </button>
          ))}
        </div>
      </div>

      {/* Platform filter */}
      <div className="flex items-center gap-2">
        <div
          role="tablist"
          className="inline-flex rounded-lg border border-border bg-surface overflow-hidden divide-x divide-border"
          dir="ltr"
        >
          {(['all', 'Meta', 'Google'] as Platform[]).map(p => (
            <button
              key={p}
              role="tab"
              aria-selected={platform === p}
              onClick={() => setPlatform(p)}
              className={cn(
                'px-2.5 sm:px-3 py-1.5 text-[11px] sm:text-xs font-medium transition-colors min-w-[48px] sm:min-w-[58px]',
                platform === p
                  ? 'bg-primary text-white'
                  : 'bg-surface text-text-secondary hover:bg-surfaceMuted',
              )}
            >
              {p === 'all' ? 'כולם' : p}
            </button>
          ))}
        </div>
      </div>

      {/* Store filter */}
      <div className="flex items-center gap-2">
        <StoreIcon size={14} className="text-text-muted shrink-0" />
        <select
          value={localStore}
          onChange={e => setLocalStore(e.target.value)}
          className="rounded-lg border border-border bg-surface px-2.5 py-1.5 text-xs sm:text-sm font-medium focus:outline-none focus:ring-2 focus:ring-primary/30 min-w-[120px]"
        >
          <option value="All">כל החנויות</option>
          {stores.map(s => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
      </div>

      {/* Date range */}
      <div className="flex items-center gap-1.5 sm:gap-2 flex-wrap">
        <Calendar size={14} className="text-text-muted shrink-0" />
        <input
          type="date"
          value={localRange.from}
          max={today}
          onChange={e => {
            const v = e.target.value;
            if (!v) return;
            const safe = v > today ? today : v;
            setLocalRange(prev =>
              safe > prev.to ? { from: safe, to: safe } : { ...prev, from: safe },
            );
          }}
          className={cn(
            'rounded-lg border bg-surface px-2 py-1.5 text-xs sm:text-sm font-medium',
            isCustomRange ? 'border-primary text-primary' : 'border-border text-text-secondary',
          )}
        />
        <span className="text-text-muted text-xs">—</span>
        <input
          type="date"
          value={localRange.to}
          max={today}
          onChange={e => {
            const v = e.target.value;
            if (!v) return;
            const safe = v > today ? today : v;
            setLocalRange(prev =>
              safe < prev.from ? { from: safe, to: safe } : { ...prev, to: safe },
            );
          }}
          className={cn(
            'rounded-lg border bg-surface px-2 py-1.5 text-xs sm:text-sm font-medium',
            isCustomRange ? 'border-primary text-primary' : 'border-border text-text-secondary',
          )}
        />
        {isCustomRange && (
          <button
            type="button"
            onClick={() => setLocalRange(range)}
            className="p-1 rounded hover:bg-surfaceMuted text-text-muted hover:text-text-primary"
            title="חזור לטווח הגלובלי"
          >
            <X size={14} />
          </button>
        )}
      </div>

      {/* Optimized-mark counter + bulk-clear. Only renders when something is
          marked, so the toolbar stays calm during the rest of the time. */}
      {optimized.size > 0 && (
        <div className="flex items-center gap-1.5 text-[11px] sm:text-xs">
          <CheckCircle2 size={13} className="text-roas-green shrink-0" />
          <span className="font-medium text-text-secondary tabular-nums">
            {optimized.size} מסומנים
          </span>
          <button
            type="button"
            onClick={onClearAll}
            className="font-semibold text-text-muted hover:text-roas-red transition-colors px-1.5 py-0.5 rounded hover:bg-roas-redBg/40"
            title="הסר את כל הסימונים"
          >
            נקה הכל
          </button>
        </div>
      )}

      <span className="text-[10px] sm:text-xs text-text-muted tabular-nums sm:mr-auto">
        {aggregated.length}{' '}
        {mode === 'campaign' ? 'קמפיינים' : 'אד-סטים'}
      </span>
    </div>
  );

  // ----- Summary -----
  const roasInfo = roasLabel(totals.roas);
  const summary = aggregated.length > 0 && (
    <div className="px-4 sm:px-5 py-3 sm:py-4 bg-gradient-to-l from-primary/5 to-surface border-b border-borderSubtle">
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-2 sm:gap-3">
        <Stat label="ROAS" value={totals.roas > 0 ? formatNumber(totals.roas) : '—'} chip={{ text: roasInfo.text, tone: roasInfo.tone }} />
        <Stat label="הוצאה" value={formatCurrency(totals.spend)} prefix="CAD" />
        <Stat label="ערך המרות" value={formatCurrency(totals.conversionValue)} prefix="CAD" accent={totals.conversionValue >= totals.spend ? 'green' : undefined} />
        <Stat label="המרות" value={formatNumber(totals.conversions, 0)} />
        <Stat label="קליקים" value={formatNumber(totals.clicks, 0)} />
        <Stat label="CTR" value={totals.impressions > 0 ? `${(totals.ctr * 100).toFixed(2)}%` : '—'} />
      </div>
      {totals.spend > 0 && (
        <div className="mt-3 pt-3 border-t border-borderSubtle text-[10px] sm:text-xs text-text-muted tabular-nums flex flex-wrap gap-x-3 gap-y-1">
          <span>CPC: <span className="text-text-secondary font-medium">CAD {formatCurrency(totals.cpc, 2)}</span></span>
          <span className="text-text-subtle">·</span>
          <span>CPA: <span className="text-text-secondary font-medium">CAD {totals.conversions > 0 ? formatCurrency(totals.cpa, 2) : '—'}</span></span>
          <span className="text-text-subtle">·</span>
          <span>חשיפות: <span className="text-text-secondary font-medium">{formatNumber(totals.impressions, 0)}</span></span>
        </div>
      )}
    </div>
  );

  // ----- Rows -----
  return (
    <div>
      {toolbar}
      {attributionGap && <AttributionGapPanel gap={attributionGap} />}
      {summary}

      {error && (
        <div className="m-4 rounded-lg bg-roas-redBg border border-roas-red/30 p-3 flex items-start gap-2 text-sm">
          <AlertCircle className="text-roas-red shrink-0" size={18} />
          <div>
            <div className="font-semibold text-roas-red">שגיאה בטעינת קמפיינים</div>
            <div className="text-text-secondary text-xs mt-1">{(error as Error).message}</div>
          </div>
        </div>
      )}

      {isLoading && (
        <div className="p-8 text-center text-text-muted text-sm">טוען נתוני קמפיינים…</div>
      )}

      {data && !error && aggregated.length === 0 && (
        <div className="p-8 text-center text-text-muted text-sm">
          <Megaphone className="mx-auto mb-2 text-text-muted/60" size={28} />
          <div>אין קמפיינים פעילים בטווח הזה.</div>
          <div className="text-[11px] mt-1">נסה להרחיב את טווח התאריכים או לשנות פלטפורמה.</div>
        </div>
      )}

      {data && display.length > 0 && (
        <>
          <div className="overflow-x-auto">
            <table className="w-full text-xs sm:text-sm min-w-[1340px]">
              <thead>
                <tr className="text-text-secondary border-b border-borderSubtle bg-surfaceMuted/40">
                  {/* Per-row optimization toggle. No label — the leading
                      circle/check icon is self-explanatory and a label would
                      crowd the header. */}
                  <th className="px-3 py-2 w-[36px]" aria-label="סימון אופטימיזציה" />
                  <SortHeader
                    label={mode === 'campaign' ? 'קמפיין' : 'אד-סט'}
                    sortKey="name"
                    activeKey={sortKey}
                    dir={sortDir}
                    onClick={handleSort}
                    align="start"
                    className="px-3 sm:px-5 py-2"
                  />
                  <SortHeader
                    label="הוצאה"
                    sortKey="spend"
                    activeKey={sortKey}
                    dir={sortDir}
                    onClick={handleSort}
                    align="end"
                    className="px-3 py-2 w-[80px]"
                  />
                  <SortHeader
                    label="תקציב יומי"
                    sortKey="budget"
                    activeKey={sortKey}
                    dir={sortDir}
                    onClick={handleSort}
                    align="end"
                    className="px-3 py-2 w-[100px]"
                  />
                  <SortHeader
                    label="ערך המרות"
                    sortKey="conversionValue"
                    activeKey={sortKey}
                    dir={sortDir}
                    onClick={handleSort}
                    align="end"
                    className="px-3 py-2 w-[80px]"
                  />
                  <SortHeader
                    label="ROAS"
                    sortKey="roas"
                    activeKey={sortKey}
                    dir={sortDir}
                    onClick={handleSort}
                    align="center"
                    className="px-3 py-2 w-[64px]"
                  />
                  <SortHeader
                    label="ROAS Shopify"
                    sortKey="shopifyRoas"
                    activeKey={sortKey}
                    dir={sortDir}
                    onClick={handleSort}
                    align="center"
                    className="px-3 py-2 w-[92px]"
                  />
                  {/* New: Shopify-actual columns. NOT sortable because the
                      computation depends on the full trueRevenueByKey map
                      and adding two more sort keys would clutter the union
                      without much value — users sort by 'ROAS Shopify' to
                      surface heroes anyway. */}
                  <th className="px-3 py-2 text-end font-medium text-text-secondary w-[88px]">
                    <span className="inline-flex items-center gap-1" title="ערך המכירות בפועל ב-Shopify של המוצרים המשויכים בטווח הנבחר">
                      ערך Shopify
                    </span>
                  </th>
                  <th className="px-3 py-2 text-end font-medium text-text-secondary w-[80px]">
                    <span className="inline-flex items-center gap-1" title="יחידות שנמכרו בפועל ב-Shopify של המוצרים המשויכים בטווח הנבחר">
                      יח&apos; Shopify
                    </span>
                  </th>
                  <SortHeader
                    label="המרות"
                    sortKey="conversions"
                    activeKey={sortKey}
                    dir={sortDir}
                    onClick={handleSort}
                    align="end"
                    className="px-3 py-2 w-[72px]"
                  />
                  <SortHeader
                    label="CTR"
                    sortKey="ctr"
                    activeKey={sortKey}
                    dir={sortDir}
                    onClick={handleSort}
                    align="end"
                    className="px-3 py-2 w-[72px]"
                  />
                  <SortHeader
                    label="CPC"
                    sortKey="cpc"
                    activeKey={sortKey}
                    dir={sortDir}
                    onClick={handleSort}
                    align="end"
                    className="px-3 py-2 w-[72px]"
                  />
                  <SortHeader
                    label="CPA"
                    sortKey="cpa"
                    activeKey={sortKey}
                    dir={sortDir}
                    onClick={handleSort}
                    align="end"
                    className="px-3 py-2 w-[72px]"
                  />
                  <th className="px-2 py-2 text-center font-medium w-[40px]" aria-label="פעולות" />
                </tr>
              </thead>
              <tbody>
                {display.map((a, i) => {
                  const roas = a.spend > 0 ? a.conversionValue / a.spend : 0;
                  const ctr = a.impressions > 0 ? a.clicks / a.impressions : 0;
                  const cpc = a.clicks > 0 ? a.spend / a.clicks : 0;
                  const cpa = a.conversions > 0 ? a.spend / a.conversions : 0;
                  const info = roasLabel(roas);
                  const link = buildAdsManagerLink({
                    platform: a.platform,
                    storeId: a.storeId,
                    campaignId: a.campaignId,
                    adSetId: a.adSetId,
                    accounts: adAccounts,
                  });
                  const isOptimized = optimized.has(a.key);
                  return (
                    <tr
                      key={a.key}
                      className={cn(
                        'border-b border-borderSubtle hover:bg-surfaceMuted/40 cursor-pointer transition-opacity',
                        // Marked rows visually retreat so the user's eye
                        // anchors on the un-marked work-list. Hovering brings
                        // them back to full opacity so re-reading details
                        // (or unmarking) is easy.
                        isOptimized && 'opacity-50 hover:opacity-100',
                      )}
                      onClick={() => {
                        if (mode === 'campaign' && a.campaignId) {
                          // Campaign click → ad-sets drawer.
                          setDrillCampaignId(a.campaignId);
                          setDrillPlatform(a.platform);
                        } else if (mode === 'adset' && a.adSetId && a.platform === 'Meta') {
                          // Ad-set click → drill deeper into individual ads.
                          // Only Meta — Google ad-level isn't fetched yet.
                          setAdDrill({
                            storeId: a.storeId,
                            campaignId: a.campaignId,
                            adSetId: a.adSetId,
                            adSetName: a.adSetName || a.campaignName,
                          });
                        }
                      }}
                      title={
                        mode === 'campaign'
                          ? 'לחץ לפרטים מלאים'
                          : mode === 'adset' && a.platform === 'Meta'
                          ? 'לחץ לראות את המודעות באד-סט'
                          : undefined
                      }
                    >
                      {/* Per-row optimization toggle. Clicking flips the mark
                          without bubbling into the row click (which would
                          open the drawer). The empty Circle is the un-marked
                          state; CheckCircle2 in green is the marked state. */}
                      <td className="px-2 py-2 text-center w-[36px]">
                        <button
                          type="button"
                          onClick={e => {
                            e.stopPropagation();
                            onToggleOptimized(a.key);
                          }}
                          className={cn(
                            'inline-flex items-center justify-center w-7 h-7 rounded-full transition-colors',
                            isOptimized
                              ? 'text-roas-green hover:bg-roas-greenBg/60'
                              : 'text-text-muted hover:text-roas-green hover:bg-roas-greenBg/40',
                          )}
                          title={isOptimized ? 'לחץ להסרת הסימון' : 'סמן כאופטימיזציה בוצעה'}
                          aria-label={isOptimized ? 'בטל סימון אופטימיזציה' : 'סמן כאופטימיזציה בוצעה'}
                          aria-pressed={isOptimized}
                        >
                          {isOptimized ? <CheckCircle2 size={18} /> : <Circle size={18} />}
                        </button>
                      </td>
                      <td className="px-3 sm:px-5 py-2 max-w-[280px] sm:max-w-[400px]">
                        <div className="flex items-center gap-2">
                          <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-surfaceMuted text-[10px] font-bold text-text-secondary tabular-nums shrink-0">
                            {i + 1}
                          </span>
                          <div className="min-w-0 flex-1">
                            <div className="font-medium text-text-primary truncate flex items-center gap-1.5">
                              {/* Native tooltip on hover when the name overflows.
                                  Browsers automatically show `title` after
                                  a short delay, which is the lowest-friction
                                  way to surface long campaign / ad-set names
                                  without building a custom popover. */}
                              <span
                                className="truncate"
                                title={mode === 'campaign' ? a.campaignName : (a.adSetName || a.campaignName)}
                              >
                                {mode === 'campaign' ? a.campaignName : a.adSetName}
                              </span>
                              {/* CBO / ABO tag — small typographic signal so
                                  the user can tell at a glance which level
                                  owns the budget. Only shown for Meta and only
                                  when we have a non-empty type. */}
                              {a.platform === 'Meta' && a.budgetType && (
                                <span
                                  className={cn(
                                    'inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-bold tracking-wider shrink-0',
                                    a.budgetType === 'CBO'
                                      ? 'bg-primary/10 text-primary'
                                      : 'bg-purple-100 text-purple-700',
                                  )}
                                  title={a.budgetType === 'CBO' ? 'Campaign Budget Optimization — תקציב ברמת קמפיין' : 'Ad-Set Budget Optimization — תקציב ברמת ad-set'}
                                >
                                  {a.budgetType}
                                </span>
                              )}
                            </div>
                            <div
                              className="text-[10px] sm:text-[11px] text-text-muted truncate"
                              title={
                                mode === 'adset' && a.campaignName
                                  ? `${a.platform} · ${a.storeName} · קמפיין: ${a.campaignName}`
                                  : `${a.platform} · ${a.storeName}`
                              }
                            >
                              {a.platform}
                              {' · '}
                              {a.storeName}
                              {mode === 'adset' && a.campaignName ? ` · ${a.campaignName}` : ''}
                            </div>
                          </div>
                        </div>
                      </td>
                      <td className="px-3 py-2 text-end tabular-nums">{formatCurrency(a.spend)}</td>
                      <td className="px-3 py-2 text-end tabular-nums">
                        {(() => {
                          const budget = mode === 'campaign' ? a.campaignBudgetCad : a.adSetBudgetCad;
                          if (!budget || budget <= 0) {
                            return <span className="text-text-muted">—</span>;
                          }
                          // Color hint: when daily spend exceeds 95% of daily
                          // budget, flag amber — useful "pacing" signal.
                          const tight = a.spend > 0 && a.spend > budget * 0.95;
                          return (
                            <span className={cn('font-medium', tight && 'text-amber-700')}>
                              {formatCurrency(budget)}
                            </span>
                          );
                        })()}
                      </td>
                      <td className={cn('px-3 py-2 text-end tabular-nums font-medium', a.conversionValue > a.spend && 'text-roas-green')}>
                        {formatCurrency(a.conversionValue)}
                      </td>
                      <td className={cn('px-3 py-2 text-center font-semibold tabular-nums rounded', TONE_BG[info.tone])}>
                        {roas > 0 ? formatNumber(roas) : '—'}
                      </td>
                      {/* Shopify-true ROAS column. Only campaigns with a
                          product mapping show a number; everything else
                          shows '—' with a hint. Google rows always '—'
                          because PMax doesn't expose per-product mapping
                          (the feed governs delivery, not the campaign). */}
                      <td className="px-3 py-2 text-center">
                        {(() => {
                          const key = campaignKey(a.storeId, a.campaignId);
                          const info = trueRevenueByKey.get(key);
                          if (!info) {
                            return (
                              <span
                                className="text-text-muted text-xs"
                                title={
                                  a.platform === 'Google'
                                    ? 'Google PMax לא תומך במיפוי לפי מוצר — הפיד מנהל את ההצגה'
                                    : 'לא משויכים מוצרים — פתח את הקמפיין כדי לשייך'
                                }
                              >
                                —
                              </span>
                            );
                          }
                          const trueRoas = a.spend > 0 ? info.trueRevenue / a.spend : 0;
                          const gap = info.metaClaim > 0
                            ? ((trueRoas * a.spend) - info.metaClaim) / info.metaClaim
                            : 0;

                          // Tiered signal:
                          //   1. Click-id (deterministic) — used when available
                          //      AND the trust verdict is non-trivial
                          //      (high/medium/low). Strongest evidence.
                          //   2. Product-mapping (heuristic) — used as fallback
                          //      when click-id is null or 'unknown' (utm
                          //      misconfigured / no Meta claim to compare).
                          //      Less precise but still better than silence.
                          //
                          // The tooltip always surfaces both numbers (Meta,
                          // click-id, mapping) regardless of which drove the
                          // chip — lets the operator triangulate when the two
                          // sources disagree.
                          const attrAvailable = info.attribution !== null;
                          const attrUnknown =
                            attrAvailable && info.attribution!.trust.level === 'unknown';
                          const useAttr = attrAvailable && !attrUnknown;
                          const trustLabel = useAttr ? info.attribution!.trust.label : info.confidence.label;
                          const trustLevel = useAttr ? info.attribution!.trust.level : info.confidence.level;
                          const confTone =
                            trustLevel === 'high'    ? 'bg-roas-greenBg/60 text-roas-green'
                          : trustLevel === 'medium'  ? 'bg-amber-50 text-amber-700'
                          : trustLevel === 'unknown' ? 'bg-surfaceMuted text-text-secondary'
                          :                            'bg-roas-redBg/60 text-roas-red';

                          // Mapping comparison line, reused in both tooltip
                          // branches so the operator always sees what the other
                          // signal would have said.
                          const mappingLine =
                            `Shopify מוקצה (מיפוי): CAD ${info.trueRevenue.toFixed(0)}` +
                            (info.metaClaim > 0
                              ? ` (פער ${(gap * 100).toFixed(0)}% מול Meta)`
                              : '');

                          let tooltip: string;
                          if (useAttr) {
                            const at = info.attribution!;
                            const detRoas = a.spend > 0 ? at.deterministicRevenue / a.spend : 0;
                            tooltip =
                              `ROAS מבוסס click-id · ${at.trust.label} (${at.trust.score.toFixed(0)}/100)\n\n` +
                              `Meta דיווח:           CAD ${info.metaClaim.toFixed(0)}\n` +
                              `מתויג click-id:       CAD ${at.deterministicRevenue.toFixed(0)} (${at.deterministicOrders} הזמנות)\n` +
                              `${mappingLine}\n` +
                              `Modeled / view-through: CAD ${at.modeledRevenue.toFixed(0)}\n` +
                              `coverage: ${(at.coverage * 100).toFixed(0)}%\n` +
                              `ROAS אמיתי: ${detRoas.toFixed(2)}x  |  ROAS לפי Meta: ${(info.metaClaim / a.spend).toFixed(2)}x\n\n` +
                              at.reasons.map(r => `• ${r}`).join('\n') +
                              `\n\n💡 ${at.recommendation}`;
                          } else {
                            // Fallback path. Note explicitly that click-id data
                            // is missing/unusable so the operator knows why
                            // they're seeing the heuristic instead.
                            const clickIdNote = attrUnknown
                              ? `\n(click-id: ${info.attribution!.deterministicOrders} הזמנות תויגו — לא מספיק לסיגנל; חוזרים למיפוי מוצרים)`
                              : '\n(אין נתוני click-id בטווח — חוזרים למיפוי מוצרים)';
                            tooltip =
                              `ROAS מבוסס מיפוי מוצרים · ${info.confidence.label}${clickIdNote}\n\n` +
                              `Meta דיווח: CAD ${info.metaClaim.toFixed(0)}\n` +
                              `${mappingLine}\n\n` +
                              info.confidence.reasons.map(r => `• ${r}`).join('\n');
                          }
                          return (
                            <div className="inline-flex flex-col items-center gap-0.5" title={tooltip}>
                              <span className="font-semibold tabular-nums text-text-primary">
                                {trueRoas > 0 ? formatNumber(trueRoas) : '—'}
                              </span>
                              <span className={cn('inline-block text-[8px] font-bold px-1 py-0 rounded uppercase tracking-wider', confTone)}>
                                {trustLabel}
                                {useAttr ? (
                                  <span className="ms-1 opacity-70">·{info.attribution!.deterministicOrders}</span>
                                ) : (
                                  // Marker so the operator can tell at a glance
                                  // that this chip comes from the heuristic, not
                                  // from click-id. Lowercase + opacity so it
                                  // reads as a subdued sub-label, not noise.
                                  <span className="ms-1 opacity-70 normal-case">·מיפוי</span>
                                )}
                              </span>
                            </div>
                          );
                        })()}
                      </td>
                      {/* Shopify actuals — ערך + יחידות. Empty cells when
                          there's no mapping so the row stays cleanly
                          aligned with mapped + unmapped campaigns. */}
                      <td className="px-3 py-2 text-end tabular-nums">
                        {(() => {
                          const key = campaignKey(a.storeId, a.campaignId);
                          const info = trueRevenueByKey.get(key);
                          if (!info || info.trueRevenue <= 0) {
                            return <span className="text-text-muted">—</span>;
                          }
                          return (
                            <span className="font-medium" title="ערך המכירות בפועל ב-Shopify של המוצרים המשויכים — מוקצה פרופורציונלית להוצאה כשהמוצר חולק עם קמפיינים אחרים">
                              {formatCurrency(info.trueRevenue)}
                            </span>
                          );
                        })()}
                      </td>
                      <td className="px-3 py-2 text-end tabular-nums">
                        {(() => {
                          const key = campaignKey(a.storeId, a.campaignId);
                          const info = trueRevenueByKey.get(key);
                          if (!info || info.trueUnits <= 0) {
                            return <span className="text-text-muted">—</span>;
                          }
                          return (
                            <span className="font-medium" title="יחידות שנמכרו בפועל ב-Shopify של המוצרים המשויכים — מוקצה פרופורציונלית להוצאה">
                              {formatNumber(info.trueUnits, info.trueUnits >= 10 ? 0 : 1)}
                            </span>
                          );
                        })()}
                      </td>
                      <td className="px-3 py-2 text-end tabular-nums">{formatNumber(a.conversions, 0)}</td>
                      <td className="px-3 py-2 text-end tabular-nums text-text-secondary">
                        {a.impressions > 0 ? `${(ctr * 100).toFixed(2)}%` : '—'}
                      </td>
                      <td className="px-3 py-2 text-end tabular-nums text-text-secondary">
                        {a.clicks > 0 ? formatCurrency(cpc, 2) : '—'}
                      </td>
                      <td className="px-3 py-2 text-end tabular-nums text-text-secondary">
                        {a.conversions > 0 ? formatCurrency(cpa, 2) : '—'}
                      </td>
                      <td className="px-2 py-2 text-center">
                        {link && (
                          <a
                            href={link}
                            target="_blank"
                            rel="noopener noreferrer"
                            onClick={e => e.stopPropagation()}
                            className="inline-flex items-center justify-center w-7 h-7 rounded text-text-muted hover:text-primary hover:bg-primary/8 transition-colors"
                            title={`פתח ב-${a.platform} Ads Manager`}
                            aria-label="פתח ב-Ads Manager"
                          >
                            <ExternalLink size={14} />
                          </a>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {aggregated.length > TOP_N_DEFAULT && (
            <div className="px-4 sm:px-5 py-2.5 bg-surfaceMuted/30 border-t border-borderSubtle">
              <button
                onClick={() => setShowAll(v => !v)}
                className="text-xs sm:text-sm text-primary hover:text-primary-dark font-medium inline-flex items-center gap-1.5 transition-colors"
              >
                {showAll ? (
                  <>
                    <ChevronUp size={14} />
                    הצג פחות
                  </>
                ) : (
                  <>
                    <ChevronDown size={14} />
                    הצג עוד {remaining}
                  </>
                )}
              </button>
            </div>
          )}
        </>
      )}

      {/* Side drawer with full campaign drill-down. Mounted at the end so
          its fixed-position layout sits on top of everything. */}
      {drillCampaignId && drillPlatform && data && (
        <CampaignDrawer
          campaignId={drillCampaignId}
          open
          onClose={() => { setDrillCampaignId(null); setDrillPlatform(null); }}
          rows={data.rows.filter(r =>
            r.campaignId === drillCampaignId &&
            r.platform === drillPlatform &&
            r.date >= localRange.from && r.date <= localRange.to &&
            (localStore === 'All' || r.storeName === localStore),
          )}
          adAccounts={adAccounts}
          // Pass the user's selected window through so the channel
          // breakdown can analyse the full range, not just campaign-active
          // days. The reconciliation block still derives its own narrower
          // window internally — Pearson needs paired observations.
          rangeFrom={localRange.from}
          rangeTo={localRange.to}
        />
      )}

      {/* Ad-level drilldown. Opens when an ad-set row is clicked in
          ad-set mode (Meta only). Uses a higher z-index than the
          campaign drawer so it stacks correctly when both are open. */}
      {adDrill && (
        <AdsDrawer
          open
          onClose={() => setAdDrill(null)}
          storeId={adDrill.storeId}
          campaignId={adDrill.campaignId}
          adSetId={adDrill.adSetId}
          adSetName={adDrill.adSetName}
          rangeFrom={localRange.from}
          rangeTo={localRange.to}
          adAccounts={adAccounts}
        />
      )}
    </div>
  );
}

/**
 * Pixel-vs-Shopify attribution gap panel. Sits between the toolbar and the
 * summary card. The "trust" view: how much do the ad platforms claim vs.
 * what Shopify actually recorded? This is the single most useful thing in
 * the campaigns view because it tells the operator whether to *trust* the
 * ROAS numbers below.
 */
function AttributionGapPanel({
  gap,
}: {
  gap: {
    platformClaimed: number;
    shopifyRevenue: number;
    absGap: number;
    gapPct: number;
    storeRoas: number;
    platformRoas: number;
    interpretation: string;
    tone: 'good' | 'flag';
  };
}) {
  const toneClass = {
    good: 'border-roas-green/30 bg-roas-greenBg/40',
    flag: 'border-roas-red/30 bg-roas-redBg/40',
  }[gap.tone];

  const arrow = gap.gapPct > 0 ? '↗' : gap.gapPct < 0 ? '↘' : '=';

  return (
    <section
      className={cn(
        'px-4 sm:px-5 py-3 sm:py-4 border-b border-borderSubtle',
        toneClass,
      )}
    >
      <div className="flex items-center gap-2 mb-2">
        <span className="text-[10px] sm:text-xs font-bold uppercase tracking-wider text-text-secondary">
          התאמת שיוך · Meta &amp; Google ↔ Shopify
        </span>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-4">
        <div>
          <div className="text-[10px] text-text-muted uppercase tracking-wide">
            פלטפורמות מדווחות
          </div>
          <div className="text-base sm:text-lg font-semibold tabular-nums text-text-primary mt-0.5">
            <span className="text-[10px] text-text-muted font-medium ml-1">CAD</span>
            {formatCurrency(gap.platformClaimed)}
          </div>
          <div className="text-[10px] text-text-muted tabular-nums">
            ROAS: {gap.platformRoas > 0 ? gap.platformRoas.toFixed(2) : '—'}
          </div>
        </div>

        <div>
          <div className="text-[10px] text-text-muted uppercase tracking-wide">
            Shopify בפועל
          </div>
          <div className="text-base sm:text-lg font-bold tabular-nums text-text-primary mt-0.5">
            <span className="text-[10px] text-text-muted font-medium ml-1">CAD</span>
            {formatCurrency(gap.shopifyRevenue)}
          </div>
          <div className="text-[10px] text-text-muted tabular-nums">
            ROAS: {gap.storeRoas > 0 ? gap.storeRoas.toFixed(2) : '—'}
          </div>
        </div>

        <div>
          <div className="text-[10px] text-text-muted uppercase tracking-wide">
            פער (Shopify − Platforms)
          </div>
          <div
            className={cn(
              'text-base sm:text-lg font-bold tabular-nums mt-0.5',
              gap.absGap >= 0 ? 'text-roas-green' : 'text-roas-red',
            )}
          >
            <span className="text-[10px] text-text-muted font-medium ml-1">CAD</span>
            {gap.absGap >= 0 ? '+' : ''}{formatCurrency(gap.absGap)}
          </div>
          <div className="text-[10px] text-text-muted tabular-nums">
            {arrow} {(gap.gapPct * 100).toFixed(1)}%
          </div>
        </div>

        <div>
          <div className="text-[10px] text-text-muted uppercase tracking-wide">
            יחס אמינות
          </div>
          <div className="text-base sm:text-lg font-semibold tabular-nums mt-0.5">
            {gap.shopifyRevenue > 0
              ? (gap.platformClaimed / gap.shopifyRevenue * 100).toFixed(0) + '%'
              : '—'}
          </div>
          <div className="text-[10px] text-text-muted">
            Platforms ÷ Shopify
          </div>
        </div>
      </div>

      <p className="mt-3 text-[11px] sm:text-xs text-text-secondary leading-relaxed">
        <strong className="text-text-primary">משמעות:</strong> {gap.interpretation}
      </p>
    </section>
  );
}

/**
 * Sortable column header. Renders the label + a sort-direction caret, and
 * is clickable to switch sort. Visually subtle when the column isn't the
 * active sort, prominent (primary color + bold) when it is.
 */
function SortHeader({
  label,
  sortKey,
  activeKey,
  dir,
  onClick,
  align,
  className,
}: {
  label: string;
  sortKey: SortKey;
  activeKey: SortKey;
  dir: SortDir;
  onClick: (key: SortKey) => void;
  align: 'start' | 'center' | 'end';
  className?: string;
}) {
  const isActive = sortKey === activeKey;
  const justify =
    align === 'start' ? 'justify-start' : align === 'end' ? 'justify-end' : 'justify-center';
  const textAlign =
    align === 'start' ? 'text-start' : align === 'end' ? 'text-end' : 'text-center';
  return (
    <th className={cn('font-medium', textAlign, className)}>
      <button
        type="button"
        onClick={() => onClick(sortKey)}
        className={cn(
          'inline-flex items-center gap-1 transition-colors group',
          'select-none cursor-pointer',
          justify,
          isActive
            ? 'text-primary font-semibold'
            : 'text-text-secondary hover:text-text-primary',
        )}
        aria-sort={isActive ? (dir === 'asc' ? 'ascending' : 'descending') : 'none'}
      >
        <span>{label}</span>
        {isActive ? (
          dir === 'asc' ? (
            <ArrowUp size={12} className="text-primary" />
          ) : (
            <ArrowDown size={12} className="text-primary" />
          )
        ) : (
          <ArrowUpDown size={12} className="text-text-subtle opacity-0 group-hover:opacity-100 transition-opacity" />
        )}
      </button>
    </th>
  );
}

function Stat({
  label,
  value,
  prefix,
  chip,
  accent,
}: {
  label: string;
  value: string;
  prefix?: string;
  chip?: { text: string; tone: string };
  accent?: 'green';
}) {
  return (
    <div className="rounded-lg bg-surface border border-borderSubtle px-2.5 sm:px-3 py-1.5 sm:py-2">
      <div className="text-[10px] sm:text-xs text-text-muted leading-tight">{label}</div>
      <div className="flex items-baseline gap-1 mt-0.5">
        {prefix && (
          <span className="text-[10px] text-text-muted font-medium shrink-0">{prefix}</span>
        )}
        <span
          className={cn(
            'font-semibold tabular-nums leading-tight',
            'text-sm sm:text-base',
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
