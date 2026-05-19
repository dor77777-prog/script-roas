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
  Megaphone,
  Store as StoreIcon,
  X,
} from 'lucide-react';
import { cn, formatCurrency, formatNumber } from '@/lib/utils';
import type { CampaignRow } from '@/lib/campaigns';
import type { AdAccountMap } from '@/lib/campaignsLinks';
import {
  clearAllOptimized,
  readOptimized,
  toggleOptimized,
} from '@/lib/campaignOptimized';
import {
  campaignKey,
  migrateProductMapKeys,
  readProductMap,
  type ProductMap,
} from '@/lib/campaignProductMap';
import type { ProductsResponse } from '@/app/api/products/route';
import type { OrdersAttributionResponse } from '@/app/api/orders-attribution/route';
import type { CampaignsResponse } from '@/app/api/campaigns/route';
import type { DateRange } from '@/lib/types';
import { buildDateRangeKey } from '@/lib/dateRange';
import { roasLabel } from '@/lib/analytics';
import { useCampaignTrueRevenue } from '@/lib/hooks/useCampaignTrueRevenue';
import { CampaignsTableRow } from './CampaignsTableRow';
import { CampaignDrawer } from './CampaignDrawer';
import { AdsDrawer } from './AdsDrawer';

type Mode = 'campaign' | 'adset';
type Platform = 'all' | 'Meta' | 'Google';

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

export type Aggregated = {
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
  // Per-key "latest budget date" trackers so overwrite depends on the row's
  // `date`, NOT iteration order (#IN-02 — backfilled past dates appended to
  // sheet end would otherwise stamp stale budgets as current).
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
        // Seed budgets with this row's values; loop below picks the latest.
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
    // Budget = chronologically latest row's value (#IN-02 — see above).
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
        // null → 0 so empty-budget rows sort to bottom on desc.
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
        // Falls back to Meta ROAS; real Shopify-ROAS sort happens at render
        // time via the `displaySource` memo which has trueRevenueByKey in scope.
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
      default: {
        // Exhaustiveness check. If a future SortKey value is added but
        // a case is forgotten here, TypeScript fails the `never`
        // assignment at compile time.
        //
        // WR-04: return 0 (stable sort) at runtime rather than throw.
        // Throwing inside the Array.prototype.sort comparator
        // propagates out of .sort() and tears down the whole table
        // tree via React's error boundary (or worse, an uncaught error
        // if no boundary). If sortKey ever widens at runtime — stale
        // localStorage, hot-reload glitch, future URL-param SortKey —
        // we'd rather collapse sort to "input order" than crash the
        // campaigns view. Mirrors CampaignDrawer.tsx AdSetTable sort
        // (already documented "collapses sort to stable" rationale).
        const _exhaustive: never = sortKey;
        void _exhaustive;
        return 0;
      }
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
  // NOTE: localRange is declared BEFORE the useSWR calls so buildDateRangeKey
  // can use it as the SWR key (CR-02 fix — Phase 5 range-keyed pagination).
  // Changing localRange via the in-toolbar date picker triggers a fresh SWR
  // fetch (new key = new request, no stale-cache shadow). Mirrors the
  // ProductsTable pattern. Without this, the table aggregator filters on
  // localRange but the fetch is keyed on the GLOBAL range — any
  // localRange.from earlier than range.from (or .to later than range.to)
  // would silently filter against dates that were never fetched.
  const [localRange, setLocalRange] = useState<DateRange>(range);
  useEffect(() => {
    setLocalRange(range);
  }, [range.from, range.to]); // eslint-disable-line react-hooks/exhaustive-deps

  const { data, error, isLoading } = useSWR<CampaignsResponse>(
    buildDateRangeKey('/api/campaigns', localRange),
    fetcher,
    { refreshInterval: 120_000, revalidateOnFocus: false },
  );

  // store-meta → Meta ad-account ID / Google Ads customer ID for deep links.
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

  // Products + mapping feed `useCampaignTrueRevenue` (Shopify-based true ROAS).
  // Keyed on localRange so the trust chip and Shopify-ROAS columns stay in
  // sync with the active filter window (CR-02).
  const { data: productsResp } = useSWR<ProductsResponse>(
    buildDateRangeKey('/api/products', localRange),
    async (url: string) => {
      const r = await fetch(url);
      if (!r.ok) return { rows: [], lastUpdated: new Date().toISOString() };
      return r.json();
    },
    { revalidateOnFocus: false, dedupingInterval: 60_000 },
  );
  // Per-order attribution → trust chip basis (click-id proof vs heuristic).
  // Also keyed on localRange (CR-02).
  const { data: ordersAttrResp } = useSWR<OrdersAttributionResponse>(
    buildDateRangeKey('/api/orders-attribution', localRange),
    async (url: string) => {
      const r = await fetch(url);
      if (!r.ok) return { rows: [], lastUpdated: new Date().toISOString() };
      return r.json();
    },
    { revalidateOnFocus: false, dedupingInterval: 60_000 },
  );
  const [productMap, setProductMap] = useState<ProductMap>(() => ({}));
  useEffect(() => {
    // WR-02: Migration runs on EVERY change to `data`, not once per session.
    // The previous useRef-guarded "one-shot" implementation only inspected
    // the SWR window (default 90 days) and silently abandoned legacy
    // 2-segment keys for campaigns paused / inactive in the current
    // window. The downstream cost was a silent UX failure (drawer mapped-
    // products empty) AND a reverse-lookup double-count (legacy 2-seg key
    // matched the `startsWith('${storeId}::')` prefix → halved share
    // via the `share = 1/mappedKeys.length` fallback + biased trust
    // toward 'low' via the shared-campaigns heuristic).
    //
    // migrateProductMapKeys is idempotent — once a key is migrated to
    // 3-segment form, the explicit-segment-count check (WR-07) skips
    // it on subsequent runs. Re-running on each `data` refresh handles
    // the "user widens range to include paused campaign's history"
    // case at marginal cost.
    if (data) {
      setProductMap(migrateProductMapKeys(data));
    } else {
      setProductMap(readProductMap());
    }
    const onChange = () => setProductMap(readProductMap());
    window.addEventListener('roas-campaign-product-map-changed', onChange);
    return () => window.removeEventListener('roas-campaign-product-map-changed', onChange);
  }, [data]);

  const [mode, setMode] = useState<Mode>('campaign');
  const [platform, setPlatform] = useState<Platform>('all');
  const [showAll, setShowAll] = useState(false);

  // "Optimized" marks (UX helper). Cloud-synced via 'campaign-optimized' key.
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

  // Sort state. Same column → toggle dir; different column → switch + dir=desc.
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
  // (localRange and its sync-effect moved above the useSWR calls — see CR-02.)

  const today = todayInIsrael();
  const isCustomRange =
    localRange.from !== range.from || localRange.to !== range.to;

  const aggregated = useMemo(() => {
    if (!data) return [];
    const list = aggregate(data.rows, mode, localStore, platform, localRange);
    return sortAggregated(list, mode, sortKey, sortDir);
  }, [data, mode, localStore, platform, localRange, sortKey, sortDir]);

  const allCampaignRows = useMemo(() => {
    if (!data) return [];
    return data.rows.filter(r => {
      if (r.date < localRange.from || r.date > localRange.to) return false;
      if (localStore !== 'All' && r.storeName !== localStore) return false;
      return true;
    });
  }, [data, localStore, localRange]);

  const trueRevenueByKey = useCampaignTrueRevenue({
    mode,
    data,
    productsResp,
    ordersAttrResp,
    productMap,
    aggregated,
    allCampaignRows,
    localRange,
  });

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

  // Shopify-ROAS sort: re-rank using `trueRevenueByKey` (sortAggregated falls
  // back to Meta ROAS). Unmapped rows pushed to bottom on desc.
  const displaySource = useMemo(() => {
    if (sortKey !== 'shopifyRoas' || trueRevenueByKey.size === 0) return aggregated;
    const sign = sortDir === 'asc' ? 1 : -1;
    const withRoas = aggregated.map(a => {
      const info = trueRevenueByKey.get(campaignKey(a.storeId, a.platform, a.campaignId));
      const roas = info && a.spend > 0 ? info.trueRevenue / a.spend : 0;
      return { a, roas, mapped: !!info };
    });
    withRoas.sort((x, y) => {
      // Push unmapped rows to bottom so mapped sort is meaningful.
      // DESIGN INTENT (WR-05): the tie-break is INTENTIONALLY direction-
      // independent — mapped rows always come first, even when the user
      // clicks the ROAS-Shopify header to flip asc/desc. Only the within-
      // group order rotates with `sign`. Rationale: unmapped rows have
      // no Shopify-ROAS value (their `roas` is 0), so mixing them in with
      // the directional sort would put them at the top on asc — visually
      // dominating the table with rows that carry no information.
      if (x.mapped !== y.mapped) return x.mapped ? -1 : 1;
      return sign * (x.roas - y.roas);
    });
    return withRoas.map(w => w.a);
  }, [aggregated, sortKey, sortDir, trueRevenueByKey]);
  const display = showAll ? displaySource : displaySource.slice(0, TOP_N_DEFAULT);
  const remaining = displaySource.length - display.length;

  // ----- Pixel-vs-Shopify attribution gap (top-of-table trust view) -------
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

    // Gap = (Shopify - platform) / Shopify. Positive → platforms under-count
    // (iOS 14 / ad blockers / organic halo). Negative → over-count (view-through,
    // double-counting between Meta+Google, modeled conversions).
    const absGap = shopifyRevenue - platformClaimed;
    const gapPct = shopifyRevenue > 0 ? absGap / shopifyRevenue : 0;

    // ROAS comparison — store-truth vs platform-truth.
    const totalSpendShopify = metaSpendInScope + googleSpendInScope;
    const storeRoas = totalSpendShopify > 0 ? shopifyRevenue / totalSpendShopify : 0;
    const platformRoas =
      totals.spend > 0 ? platformClaimed / totals.spend : 0;

    // Interpretation copy (#IN-01: only 'good' and 'flag' tones — keep honest).
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
    // `totals` covered transitively via `aggregated` dep (#IN-05).
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

      {/* Optimized-mark counter + bulk-clear (only renders when something marked). */}
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

      {/* Both SWR-thrown errors and the 200+data.error degraded path (#WR-06). */}
      {(error || data?.error) && (
        <div className="m-4 rounded-lg bg-roas-redBg border border-roas-red/30 p-3 flex items-start gap-2 text-sm">
          <AlertCircle className="text-roas-red shrink-0" size={18} />
          <div>
            <div className="font-semibold text-roas-red">שגיאה בטעינת קמפיינים</div>
            <div className="text-text-secondary text-xs mt-1">
              {error ? (error as Error).message : data?.error}
            </div>
          </div>
        </div>
      )}

      {isLoading && (
        <div className="p-8 text-center text-text-muted text-sm">טוען נתוני קמפיינים…</div>
      )}

      {data && !error && !data.error && aggregated.length === 0 && (
        <div className="p-8 text-center text-text-muted text-sm">
          <Megaphone className="mx-auto mb-2 text-text-muted/60" size={28} />
          <div>אין קמפיינים פעילים בטווח הזה.</div>
          <div className="text-[11px] mt-1">נסה להרחיב את טווח התאריכים או לשנות פלטפורמה.</div>
        </div>
      )}

      {data && display.length > 0 && (
        <>
          {/* overflow-auto + max-h makes wrapper the scroll context so sticky
              thead pins to the top of the box (not the page). */}
          <div className="overflow-auto max-h-[calc(100vh-180px)]">
            <table className="w-full text-xs sm:text-sm min-w-[1340px]">
              <thead className="sticky top-0 z-10 bg-surface">
                <tr className="text-text-secondary border-b border-borderSubtle bg-surfaceMuted/40">
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
                  {/* Shopify-actual columns: not sortable — sort via 'ROAS Shopify'. */}
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
                {display.map((a, i) => (
                  <CampaignsTableRow
                    key={a.key}
                    a={a}
                    i={i}
                    mode={mode}
                    trueRevenueByKey={trueRevenueByKey}
                    adAccounts={adAccounts}
                    optimized={optimized}
                    onToggleOptimized={onToggleOptimized}
                    onDrillCampaign={(campaignId, platform) => {
                      setDrillCampaignId(campaignId);
                      setDrillPlatform(platform);
                    }}
                    onDrillAd={(set) => setAdDrill(set)}
                  />
                ))}
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

      {/* Drill-down drawers (campaign + nested ad-level). */}
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
          rangeFrom={localRange.from}
          rangeTo={localRange.to}
        />
      )}

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
