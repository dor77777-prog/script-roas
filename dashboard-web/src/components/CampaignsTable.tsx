'use client';

import { startTransition, useEffect, useMemo, useRef, useState } from 'react';
import useSWR, { useSWRConfig } from 'swr';
import {
  AlertCircle,
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  Calendar,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Filter,
  Megaphone,
  Store as StoreIcon,
  X,
} from 'lucide-react';
import {
  Line,
  LineChart,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { ChartContainer } from '@/components/ui/chart/ChartContainer';
import {
  ChartTooltip,
  ChartTooltipLabel,
  ChartTooltipRow,
  ChartTooltipValue,
} from '@/components/ui/chart/ChartTooltip';
import { cn, formatCurrency, formatDate, formatNumber } from '@/lib/utils';
import {
  analyzeCpmVsRoas,
  dayOffsetFromRangeStart,
  indexPrevByDateOffset,
  PREV_PERIOD_MIN_DAYS,
  type DailyCpmRoasPoint,
} from '@/lib/cpmRoasAnalysis';
import { aggregate, type Aggregated } from '@/lib/campaignsAggregator';
import { buildHealthByKey } from '@/lib/campaignsIntelligence';
import {
  readCampaignsColumnPrefs,
  buildHiddenColumnsCss,
  resolveCampaignsColumnOrder,
} from '@/lib/campaignsColumnPrefs';
import { CampaignsColumnsMenu } from './CampaignsColumnsMenu';
import { CHART_COLORS } from '@/lib/chartColors';
import { filterDrillRows } from '@/lib/drillFilter';
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
import { buildDateRangeKey, getPreviousPeriod } from '@/lib/dateRange';
import { roasLabel } from '@/lib/analytics';
import { useCampaignTrueRevenue } from '@/lib/hooks/useCampaignTrueRevenue';
import { CampaignsTableRow } from './CampaignsTableRow';
import { CampaignDrawer } from './CampaignDrawer';
import { AdsDrawer } from './AdsDrawer';
import { readTabLocalState, syncTabLocalUrl } from '@/lib/urlState';

type Mode = 'campaign' | 'adset';
type Platform = 'all' | 'Meta' | 'Google' | 'TikTok';

/** All columns the user can sort by. Strings sort lexicographically;
 *  everything else is a numeric metric. */
type SortKey =
  | 'name'
  | 'spend'
  | 'budget'
  | 'conversionValue'
  | 'roas'
  | 'shopifyRoas'              // combined Shopify ROAS (deterministic + proportional)
  | 'roasShopifyPlatform'      // Shopify ROAS using ONLY deterministic per-platform revenue
  | 'shopifyValuePlatform'     // deterministic per-platform Shopify revenue
  | 'shopifyUnitsPlatform'     // deterministic per-platform Shopify units
  | 'shopifyValueTotal'        // total Shopify revenue (across all platforms) of mapped products
  | 'shopifyUnitsTotal'        // total Shopify units (across all platforms) of mapped products
  | 'shopifyOrdersTotal'       // Phase 05.7.x (2026-05-23) — total Shopify orders (across all platforms) of mapped products
  | 'health'                   // unified Campaign Health Score (Phase 05.7.x)
  | 'conversions'
  | 'ctr'
  | 'cpc'
  | 'cpm'                      // cost per 1000 impressions (spend / impressions * 1000)
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
  red:    'bg-status-redBg text-status-redFg',
  orange: 'bg-status-orangeBg text-status-orangeFg',
  green:  'bg-status-greenBg text-status-greenFg',
  blue:   'bg-status-blueBg text-status-blueFg',
  gray:   'bg-elevated2 text-ink',
};

function todayInIsrael(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Jerusalem',
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());
}

// --- Aggregation ------------------------------------------------------------

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
      case 'roasShopifyPlatform':
      case 'shopifyValuePlatform':
      case 'shopifyUnitsPlatform':
      case 'shopifyValueTotal':
      case 'shopifyUnitsTotal':
      case 'shopifyOrdersTotal': {
        // Phase 05.7.x — same pattern as shopifyRoas: comparator falls
        // back to Meta ROAS, real sort runs in `displaySource` where
        // `trueRevenueByKey` is in scope.
        return a.spend > 0 ? a.conversionValue / a.spend : 0;
      }
      case 'health': {
        // Falls back to Meta ROAS; real Health-sort happens in `displaySource`
        // where `healthByKey` is in scope (same pattern as shopifyRoas above).
        return a.spend > 0 ? a.conversionValue / a.spend : 0;
      }
      case 'conversions':
        return a.conversions;
      case 'ctr':
        return a.impressions > 0 ? a.clicks / a.impressions : 0;
      case 'cpc':
        return a.clicks > 0 ? a.spend / a.clicks : 0;
      case 'cpm':
        // Cost per 1000 impressions: zero impressions → 0 so empty-impression
        // rows sort to the bottom on desc (matching ctr/cpc/cpa convention).
        return a.impressions > 0 ? (a.spend / a.impressions) * 1000 : 0;
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
  //
  // Phase 12.x — initial value is hydrated from the URL (c_preset + c_from/c_to
  // params). Survives refresh + bookmarkable. When the global range changes,
  // we still reset to it (operator's explicit Filters change should override
  // the per-tab local override).
  const [localRange, setLocalRange] = useState<DateRange>(() => {
    if (typeof window === 'undefined') return range;
    const url = readTabLocalState('campaigns', window.location.search);
    return url.range ?? range;
  });
  // Track whether we've already hydrated from URL so the first global-range
  // change (immediately after mount) doesn't overwrite the URL-restored value.
  const hydratedFromUrlRef = useRef(false);
  useEffect(() => {
    if (!hydratedFromUrlRef.current) {
      hydratedFromUrlRef.current = true;
      return; // skip first global sync — preserve URL-hydrated value
    }
    setLocalRange(range);
  }, [range.from, range.to]); // eslint-disable-line react-hooks/exhaustive-deps

  const { data, error, isLoading } = useSWR<CampaignsResponse>(
    buildDateRangeKey('/api/campaigns', localRange),
    fetcher,
    { refreshInterval: 120_000, revalidateOnFocus: false },
  );

  // store-meta → Meta ad-account ID / Google Ads customer ID for deep links.
  const { data: storeMeta } = useSWR<{ rows: Array<{ storeId: string; metaAdAccountId: string | null; googleAdsCustomerId: string | null; tiktokAdvertiserId: string | null }> }>(
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
        // Phase A.5 — tiktokAdvertiserId is enriched by /api/store-meta from
        // env var (not persisted in `stores` table). Used by CampaignDrawer's
        // store-mapping section to build the campaign-store-map key.
        tiktokAdvertiserId: row.tiktokAdvertiserId ?? null,
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
  //
  // Phase 05.7.9b — append `&lineItems=true` so the response carries the
  // JSONB `lineItems[]` payload. Required for the new deterministic-per-
  // platform Shopify columns: the allocator needs to see which products
  // each order purchased to credit them to the right platform. Without
  // this flag the route strips lineItems for bandwidth (see
  // orders-attribution/route.ts:45) and the new columns render '—' for
  // every row even when the underlying classification is correct.
  const ordersAttrKeyBase = buildDateRangeKey('/api/orders-attribution', localRange);
  const { data: ordersAttrResp } = useSWR<OrdersAttributionResponse>(
    ordersAttrKeyBase ? `${ordersAttrKeyBase}&lineItems=true` : null,
    async (url: string) => {
      const r = await fetch(url);
      if (!r.ok) return { rows: [], lastUpdated: new Date().toISOString() };
      return r.json();
    },
    { revalidateOnFocus: false, dedupingInterval: 60_000 },
  );
  const [productMap, setProductMap] = useState<ProductMap>(() => ({}));
  // Phase 12.5.x audit fix (2026-05-24, HIGH #2) — when the operator edits
  // the product-map (CampaignDrawer / picker), invalidate the SWR caches
  // that feed `useCampaignTrueRevenue` so the Shopify-ROAS columns reflect
  // the new mapping immediately. Without this, /api/products and
  // /api/orders-attribution kept their 60s-deduped responses and the ROAS
  // columns lagged 0-60s (sometimes showing 0 / — while the column WAS
  // technically derivable from the local productMap state).
  //
  // mutate() is idempotent and cheap: marks the entry stale, SWR re-fetches
  // on the next render. No-op if the key is null.
  const { mutate: swrMutate } = useSWRConfig();
  const productsKey = buildDateRangeKey('/api/products', localRange);
  const ordersAttrKeyForMutate = ordersAttrKeyBase ? `${ordersAttrKeyBase}&lineItems=true` : null;
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
    const onChange = () => {
      setProductMap(readProductMap());
      // Invalidate the SWR caches the ROAS columns depend on. SWR will
      // re-fetch on next access; the table re-renders with the new
      // numbers when the new responses land.
      if (productsKey) swrMutate(productsKey);
      if (ordersAttrKeyForMutate) swrMutate(ordersAttrKeyForMutate);
    };
    window.addEventListener('roas-campaign-product-map-changed', onChange);
    return () => window.removeEventListener('roas-campaign-product-map-changed', onChange);
  }, [data, productsKey, ordersAttrKeyForMutate, swrMutate]);

  // Phase 12.5.x (2026-05-24) — mode hydrated from URL `c_mode`. Survives
  // refresh + bookmark so an operator parked on the ad-set view stays there.
  const [mode, setMode] = useState<Mode>(() => {
    if (typeof window === 'undefined') return 'campaign';
    const url = readTabLocalState('campaigns', window.location.search);
    return url.mode ?? 'campaign';
  });
  // Phase 12.x — platform filter hydrated from URL `c_platform` param. Allows
  // refresh / bookmark to preserve the "show only Meta" view.
  const [platform, setPlatform] = useState<Platform>(() => {
    if (typeof window === 'undefined') return 'all';
    const url = readTabLocalState('campaigns', window.location.search);
    if (url.platform === 'meta') return 'Meta';
    if (url.platform === 'google') return 'Google';
    if (url.platform === 'tiktok') return 'TikTok';
    return 'all';
  });
  const [showAll, setShowAll] = useState(false);

  // P1-3 mobile audit (2026-05-29) — collapse secondary filters (platform,
  // multi-mapped, optimized chip) behind an expander on < sm so the toolbar
  // doesn't dominate the mobile viewport. Local-only state; no URL persist.
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false);

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
  // Phase 12.5.x (2026-05-24) — hydrated from URL so refresh keeps the column
  // sort the operator chose.
  const [sortKey, setSortKey] = useState<SortKey>(() => {
    if (typeof window === 'undefined') return 'roas';
    const url = readTabLocalState('campaigns', window.location.search);
    return (url.sortKey as SortKey | undefined) ?? 'roas';
  });
  const [sortDir, setSortDir] = useState<SortDir>(() => {
    if (typeof window === 'undefined') return 'desc';
    const url = readTabLocalState('campaigns', window.location.search);
    return url.sortDir ?? 'desc';
  });
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
  // Phase 12.x — initial value hydrated from URL `c_store` param. If the URL
  // override is present we use it instead of the global default. When the
  // global store changes after mount, we still reset to it (operator's
  // explicit Filters change should override the per-tab override).
  const [localStore, setLocalStore] = useState(() => {
    if (typeof window === 'undefined') return globalStore;
    const url = readTabLocalState('campaigns', window.location.search);
    return url.store ?? globalStore;
  });
  const hydratedStoreFromUrlRef = useRef(false);
  useEffect(() => {
    if (!hydratedStoreFromUrlRef.current) {
      hydratedStoreFromUrlRef.current = true;
      return;
    }
    setLocalStore(globalStore);
  }, [globalStore]);

  // Phase 05.7.9d / 05.7.x — column visibility + order prefs.
  // Subscribes to the cloud-sync event so a toggle on another device
  // applies here on the next poll without a manual refresh.
  const [columnHiddenCss, setColumnHiddenCss] = useState('');
  const [columnOrder, setColumnOrder] = useState<string[]>(() =>
    resolveCampaignsColumnOrder(undefined),
  );
  useEffect(() => {
    const apply = () => {
      const prefs = readCampaignsColumnPrefs();
      setColumnHiddenCss(buildHiddenColumnsCss(prefs.hidden));
      setColumnOrder(resolveCampaignsColumnOrder(prefs.order));
    };
    apply();
    window.addEventListener('roas-campaigns-column-visibility-changed', apply);
    return () =>
      window.removeEventListener(
        'roas-campaigns-column-visibility-changed',
        apply,
      );
  }, []);

  // Drill-down drawer state — set when the user clicks a row.
  // Phase 12.5.x (2026-05-24) — hydrated from URL `c_drill` so refresh keeps
  // the CampaignDrawer open on the same campaign. (adSetName is not in the
  // URL; the drawer re-reads it from `data.rows` once the IDs match.)
  const [drillCampaignId, setDrillCampaignId] = useState<string | null>(() => {
    if (typeof window === 'undefined') return null;
    return readTabLocalState('campaigns', window.location.search).drill?.campaignId ?? null;
  });
  const [drillPlatform, setDrillPlatform] = useState<string | null>(() => {
    if (typeof window === 'undefined') return null;
    return readTabLocalState('campaigns', window.location.search).drill?.platform ?? null;
  });
  const [drillStoreId, setDrillStoreId] = useState<string | null>(() => {
    if (typeof window === 'undefined') return null;
    return readTabLocalState('campaigns', window.location.search).drill?.storeId ?? null;
  });
  // Ad-level drilldown: when set, opens the AdsDrawer scoped to one ad-set.
  // Phase 12.5.x (2026-05-24) — hydrated from URL `c_adDrill`. adSetName is
  // re-resolved from data.rows once the IDs match (avoids URL-encoding free
  // text). Falls back to empty string until the row loads; the drawer just
  // shows the IDs in its header for the brief loading window.
  const [adDrill, setAdDrill] = useState<{
    storeId: string;
    campaignId: string;
    adSetId: string;
    adSetName: string;
    platform: 'Meta' | 'Google' | 'TikTok';
  } | null>(() => {
    if (typeof window === 'undefined') return null;
    const urlAdDrill = readTabLocalState('campaigns', window.location.search).adDrill;
    if (!urlAdDrill) return null;
    return {
      storeId: urlAdDrill.storeId,
      campaignId: urlAdDrill.campaignId,
      adSetId: urlAdDrill.adSetId,
      adSetName: '',
      platform: urlAdDrill.platform,
    };
  });

  // Phase 12.5.x (2026-05-24) — resolve adDrill.adSetName from data.rows once
  // it loads. URL-hydrated adDrill starts with '' (we don't put free text in
  // the URL); the drawer header shows a placeholder until this fires.
  useEffect(() => {
    if (!adDrill || adDrill.adSetName || !data) return;
    const match = data.rows.find(
      r =>
        r.storeId === adDrill.storeId &&
        r.platform === adDrill.platform &&
        r.campaignId === adDrill.campaignId &&
        r.adSetId === adDrill.adSetId,
    );
    if (match?.adSetName) {
      setAdDrill({ ...adDrill, adSetName: match.adSetName });
    }
  }, [adDrill, data]);

  // Push CampaignsTable's tab-local state into the URL whenever it changes so
  // refresh / bookmark / share keeps the operator on the same view.
  // (`syncTabLocalUrl` only updates the `c_*` params — preserves global state.)
  // Phase 12.5.x (2026-05-24) — also serialize mode, sort, drill, and adDrill
  // so refresh restores the full view (not just filters). adDrill is only
  // serialized for Meta/TikTok (Google ad-drill is not a valid state per the
  // row click handler — CampaignsTableRow.tsx guards it).
  // Effect placed AFTER the drill-state declarations to avoid TDZ — moved here
  // from above for that reason.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const platformParam =
      platform === 'all' ? 'all' :
      platform === 'Meta' ? 'meta' :
      platform === 'Google' ? 'google' :
      platform === 'TikTok' ? 'tiktok' : 'all';
    syncTabLocalUrl('campaigns', {
      store: localStore,
      platform: platformParam,
      preset: 'custom',
      range: localRange,
      mode,
      sortKey,
      sortDir,
      drill:
        drillCampaignId && drillPlatform && drillStoreId
          ? {
              storeId: drillStoreId,
              platform: drillPlatform,
              campaignId: drillCampaignId,
            }
          : undefined,
      adDrill:
        adDrill && (adDrill.platform === 'Meta' || adDrill.platform === 'TikTok')
          ? {
              storeId: adDrill.storeId,
              platform: adDrill.platform,
              campaignId: adDrill.campaignId,
              adSetId: adDrill.adSetId,
            }
          : undefined,
    }, globalStore);
  }, [
    localStore,
    platform,
    localRange.from,
    localRange.to,
    globalStore,
    mode,
    sortKey,
    sortDir,
    drillCampaignId,
    drillPlatform,
    drillStoreId,
    adDrill,
  ]);
  // (localRange and its sync-effect moved above the useSWR calls — see CR-02.)

  const today = todayInIsrael();
  const isCustomRange =
    localRange.from !== range.from || localRange.to !== range.to;

  // Phase 05.7.x (2026-05-23) — operator filter "show only multi-mapped
  // campaigns". When ON, the table is filtered down to rows whose
  // campaignKey shares at least one product with another campaign in
  // the same store. Useful for spotting cannibalization risk + comparing
  // co-mapped campaigns side by side.
  const [showOnlyMultiMapped, setShowOnlyMultiMapped] = useState(false);

  const aggregated = useMemo(() => {
    if (!data) return [];
    // Phase 12.5.x (2026-05-24) — pass `currentEffectiveStatus` so the
    // aggregator can override stale in-range status with the absolute-latest
    // DB snapshot. Fixes the "כבוי" chip not appearing for TikTok campaigns
    // paused after the operator's viewing range ended.
    const list = aggregate(
      data.rows,
      mode,
      localStore,
      platform,
      localRange,
      data.currentEffectiveStatus,
    );
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

  // Phase 05.7.x (2026-05-23) — Set of campaign keys whose product
  // mapping is SHARED with at least one other campaign in the same
  // store. Built once from productMap so the multi-mapped filter is O(1)
  // lookup. Same shape used by mappedCampaignKeys (below) and the
  // "🏷️ לא ממופה" chip.
  const multiMappedCampaignKeys = useMemo(() => {
    const set = new Set<string>();
    // Build reverse index: productId → campaignKey[]
    const byProduct = new Map<string, string[]>();
    for (const [k, pids] of Object.entries(productMap)) {
      if (!Array.isArray(pids)) continue;
      const parts = k.split('::');
      if (parts.length !== 3) continue;
      const storeId = parts[0];
      for (const pid of pids) {
        const composite = `${storeId}::${pid}`; // store-scoped product key
        if (!byProduct.has(composite)) byProduct.set(composite, []);
        byProduct.get(composite)!.push(k);
      }
    }
    // Mark every campaignKey that shares a product with at least one OTHER campaign.
    for (const keys of byProduct.values()) {
      if (keys.length >= 2) for (const k of keys) set.add(k);
    }
    return set;
  }, [productMap]);

  // Apply the multi-mapped filter on top of the base aggregate.
  const aggregatedFiltered = useMemo(() => {
    if (!showOnlyMultiMapped) return aggregated;
    return aggregated.filter(a => multiMappedCampaignKeys.has(a.key));
  }, [aggregated, showOnlyMultiMapped, multiMappedCampaignKeys]);

  // Phase 05.7.x (2026-05-23) — set of campaignKeys that have at least one
  // product mapped. Derived from productMap so the row's "🏷️ לא ממופה"
  // chip flips off the moment the operator adds a product (productMap
  // updates via cloud-sync → this memo re-runs → row re-renders without
  // the chip). Same key shape as productMap (`storeId::platform::campaignId`).
  const mappedCampaignKeys = useMemo(() => {
    const set = new Set<string>();
    for (const [key, productIds] of Object.entries(productMap)) {
      if (Array.isArray(productIds) && productIds.length > 0) set.add(key);
    }
    return set;
  }, [productMap]);

  // Phase 05.7.x — per-campaign daily CPM/ROAS series, used by the unified
  // Health Score's `trajectory` component. Built ONCE per data refresh from
  // the same range/store/platform filter as `aggregated`, then handed to
  // `analyzeCpmVsRoas` per row in the health memo. Without this memo the
  // health score has no momentum signal and every campaign scores neutral
  // (60) on trajectory — defeating the "next dollar's expected return"
  // axis the score is built around.
  const dailyByCampaign = useMemo(() => {
    const out = new Map<string, DailyCpmRoasPoint[]>();
    if (!data) return out;
    // Group rows by the same key shape `aggregate()` uses (mode-aware), then
    // by date, so each campaign-or-adset ends up with one daily series.
    type DayBucket = { spend: number; impressions: number; conversionValue: number };
    const grouped = new Map<string, Map<string, DayBucket>>();
    for (const r of data.rows) {
      if (r.date < localRange.from || r.date > localRange.to) continue;
      if (localStore !== 'All' && r.storeName !== localStore) continue;
      if (platform !== 'all' && r.platform !== platform) continue;
      const key =
        mode === 'campaign'
          ? `${r.storeId}::${r.platform}::${r.campaignId}`
          : `${r.storeId}::${r.platform}::${r.campaignId}::${r.adSetId}`;
      let dateMap = grouped.get(key);
      if (!dateMap) {
        dateMap = new Map<string, DayBucket>();
        grouped.set(key, dateMap);
      }
      const existing = dateMap.get(r.date) ?? { spend: 0, impressions: 0, conversionValue: 0 };
      existing.spend += r.spend;
      existing.impressions += r.impressions;
      existing.conversionValue += r.conversionValue;
      dateMap.set(r.date, existing);
    }
    for (const [key, dates] of grouped) {
      const series: DailyCpmRoasPoint[] = [];
      for (const [date, b] of dates) {
        // Drop fully-empty days so analyzeCpmVsRoas's 5-day threshold counts
        // only days the campaign was actually running.
        if (b.spend === 0 && b.impressions === 0) continue;
        series.push({
          date,
          cpm: b.impressions > 0 ? (b.spend / b.impressions) * 1000 : 0,
          roas: b.spend > 0 ? b.conversionValue / b.spend : 0,
        });
      }
      series.sort((a, b) => a.date.localeCompare(b.date));
      out.set(key, series);
    }
    return out;
  }, [data, localRange.from, localRange.to, localStore, platform, mode]);

  // Phase 05.7.x — unified Campaign Health Score per row. Combines the
  // signals previously rendered as independent chips (trust / off-day /
  // CPM trajectory / multiple ROAS values) into one 0..100 score + grade.
  // See `src/lib/campaignHealthScore.ts` for the algorithm + weights.
  //
  // Phase 05.7.x (2026-05-23): after the base score is computed,
  // apply the cohort adjustment so the score reflects multi-mapping
  // context (weakest in cohort → −5; high cannibalization → −10;
  // leader → +3; etc). See campaignHealthScore.ts:applyCohortAdjustmentOnce.
  // The cohort + cannibalization computations run on the full
  // aggregated + productMap so each campaign's adjustment is consistent
  // with what its drawer shows.
  const healthByKey = useMemo(
    () =>
      buildHealthByKey({
        aggregated,
        trueRevenueByKey,
        dailyByCampaign,
        productMap,
        campaignsDaily: (data?.rows ?? []).map(r => ({
          date: r.date,
          storeId: r.storeId,
          platform: r.platform,
          campaignId: r.campaignId,
          spend: r.spend,
        })),
        productsDaily: (productsResp?.rows ?? []).map(r => ({
          date: r.date,
          storeId: r.storeId,
          productId: r.productId,
          productTitle: r.productTitle,
          netRevenue: r.netRevenue ?? 0,
        })),
        localRange,
      }),
    [aggregated, trueRevenueByKey, dailyByCampaign, productMap, data, productsResp, localRange],
  );

  const totals = useMemo(() => {
    // Audit fix 2026-05-23 (FIND-01): summary cards must track what's
    // actually rendered. When "🔗 multi-mapped only" filter is ON,
    // `aggregatedFiltered` is the visible row set; iterating `aggregated`
    // (the unfiltered list) made the totals diverge from the visible
    // rows — operator sees 5 rows of $12K with a "$80K" card.
    let spend = 0, conv = 0, val = 0, clicks = 0, imps = 0;
    for (const a of aggregatedFiltered) {
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
      // Store-level (or all-stores) blended CPM. Same formula as the per-row
      // cell — zero-impressions guard returns 0 so the card renders "—".
      cpm: imps > 0 ? (spend / imps) * 1000 : 0,
    };
  }, [aggregatedFiltered]);

  // Per-day CPM (and ROAS) across the same filters that produce `aggregated`
  // (store, platform, date range). Drives the expandable CPM-over-time chart
  // that sits below the summary cards. Days with zero impressions are filtered
  // out so the line is continuous over real activity.
  //
  // We also accumulate conversionValue per day so the ROAS overlay (toggle
  // below) has a per-day series to plot on the second Y axis.
  const cpmDaily = useMemo(() => {
    const byDay = new Map<string, { spend: number; impressions: number; value: number }>();
    const rows = data?.rows ?? [];
    for (const r of rows) {
      // IN-03 (5.2.2.1): defense-in-depth. /api/campaigns already filters by
      // range via parseRangeParams (campaigns.ts fetchCampaignsData uses
      // isInRange in the parse loop). This in-memory filter is redundant
      // today but cheap and catches any future regression where the lib
      // contract changes — e.g., a cache layer that serves a wider window.
      if (r.date < localRange.from || r.date > localRange.to) continue;
      if (localStore !== 'All' && r.storeName !== localStore) continue;
      if (platform !== 'all' && r.platform !== platform) continue;
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
        spend: v.spend,
        impressions: v.impressions,
        value: v.value,
        cpm: (v.spend / v.impressions) * 1000,
        roas: v.spend > 0 ? v.value / v.spend : 0,
      }));
  }, [data?.rows, localRange.from, localRange.to, localStore, platform]);

  const [cpmExpanded, setCpmExpanded] = useState(false);
  // ROAS overlay toggle (same UX as the CampaignDrawer CPM chart).
  const [cpmShowRoas, setCpmShowRoas] = useState(false);
  // Smart-analysis baseline mode: 'half' compares first vs second half
  // of the selected range; 'prev' compares against the equally-long
  // window immediately before the selected range (the conventional
  // "vs previous period" the Hero KPIs use).
  const [cpmAnalysisMode, setCpmAnalysisMode] = useState<'half' | 'prev'>('half');

  // Compute the equally-long previous-period window (the N days immediately
  // before localRange.from). Used both to label the baseline and to drive
  // the second SWR fetch below — the current /api/campaigns response only
  // covers the user-selected range (Phase 5 range pagination), so an extra
  // fetch is required to get the prev-period rows.
  const cpmPrevRange = useMemo(() => getPreviousPeriod(localRange), [localRange.from, localRange.to]);

  // Fetch previous-period campaigns only when the user actually flips the
  // baseline toggle — so the default open path stays at one fetch.
  //
  // IN-04 (5.2.2.1): match CampaignDrawer's SWR options (line 162/174/188)
  // by passing dedupingInterval: 60_000. SWR's default dedupingInterval is
  // 2000ms, so without this the campaigns table dedupes much more
  // aggressively than the drawer — operators rapidly toggling 'prev' would
  // refetch every ~2s instead of every 60s. Aligns the two sites.
  const { data: cpmPrevData } = useSWR<CampaignsResponse>(
    cpmAnalysisMode === 'prev' ? buildDateRangeKey('/api/campaigns', cpmPrevRange) : null,
    fetcher,
    { revalidateOnFocus: false, dedupingInterval: 60_000 },
  );

  const cpmDailyPrev = useMemo(() => {
    if (cpmAnalysisMode !== 'prev') return null;
    const byDay = new Map<string, { spend: number; impressions: number; value: number }>();
    const rows = cpmPrevData?.rows ?? [];
    for (const r of rows) {
      // IN-03 (5.2.2.1): defense-in-depth — see cpmDaily comment above.
      // /api/campaigns is already filtered server-side by cpmPrevRange via
      // parseRangeParams (the SWR key includes buildDateRangeKey).
      if (r.date < cpmPrevRange.from || r.date > cpmPrevRange.to) continue;
      if (localStore !== 'All' && r.storeName !== localStore) continue;
      if (platform !== 'all' && r.platform !== platform) continue;
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
  }, [cpmAnalysisMode, cpmPrevData?.rows, cpmPrevRange.from, cpmPrevRange.to, localStore, platform]);

  // Shopify-ROAS sort: re-rank using `trueRevenueByKey` (sortAggregated falls
  // back to Meta ROAS). Unmapped rows pushed to bottom on desc.
  //
  // Phase 05.7.x — same pattern extended for `health`: re-rank by the score
  // from `healthByKey`. Insufficient / unknown grades sort to the bottom
  // regardless of direction so they don't dominate the worklist.
  const displaySource = useMemo(() => {
    // Phase 05.7.x (2026-05-23) — use the filtered aggregated when the
    // "multi-mapped only" toggle is on. All sort branches below operate
    // on this filtered list so the row count + sort order are consistent.
    const source = aggregatedFiltered;
    if (sortKey === 'shopifyRoas' && trueRevenueByKey.size > 0) {
      const sign = sortDir === 'asc' ? 1 : -1;
      const withRoas = source.map(a => {
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
    }
    if (sortKey === 'health' && healthByKey.size > 0) {
      const sign = sortDir === 'asc' ? 1 : -1;
      const withHealth = source.map(a => {
        const h = healthByKey.get(a.key);
        return { a, score: h?.score ?? 0, ready: !!h && !h.insufficient };
      });
      withHealth.sort((x, y) => {
        // Insufficient / unknown grades always sort last (same tie-break
        // policy as unmapped rows in the shopifyRoas branch above).
        if (x.ready !== y.ready) return x.ready ? -1 : 1;
        return sign * (x.score - y.score);
      });
      return withHealth.map(w => w.a);
    }
    // Phase 05.7.x — the 5 Shopify metric columns each pull their sort
    // value from trueRevenueByKey (per-platform deterministic share +
    // per-product totals). Same tie-break policy as shopifyRoas above:
    // unmapped rows (no info) sink to the bottom regardless of direction
    // so the operator's "sort by Shopify revenue" still surfaces real
    // values at the top on asc.
    const shopifyCols = [
      'roasShopifyPlatform',
      'shopifyValuePlatform',
      'shopifyUnitsPlatform',
      'shopifyValueTotal',
      'shopifyUnitsTotal',
      'shopifyOrdersTotal',
    ] as const;
    if ((shopifyCols as readonly string[]).includes(sortKey) && trueRevenueByKey.size > 0) {
      const sign = sortDir === 'asc' ? 1 : -1;
      const withVal = source.map(a => {
        const info = trueRevenueByKey.get(campaignKey(a.storeId, a.platform, a.campaignId));
        let v = 0;
        if (info) {
          switch (sortKey) {
            case 'roasShopifyPlatform':
              v = a.spend > 0 ? info.deterministicRevenue / a.spend : 0;
              break;
            case 'shopifyValuePlatform':
              v = info.deterministicRevenue;
              break;
            case 'shopifyUnitsPlatform':
              v = info.deterministicUnits;
              break;
            case 'shopifyValueTotal':
              v = info.productTotals.revenue;
              break;
            case 'shopifyUnitsTotal':
              v = info.productTotals.units;
              break;
            case 'shopifyOrdersTotal':
              v = info.productTotals.orders;
              break;
          }
        }
        return { a, v, mapped: !!info };
      });
      withVal.sort((x, y) => {
        if (x.mapped !== y.mapped) return x.mapped ? -1 : 1;
        return sign * (x.v - y.v);
      });
      return withVal.map(w => w.a);
    }
    return source;
  }, [aggregatedFiltered, sortKey, sortDir, trueRevenueByKey, healthByKey]);
  const display = showAll ? displaySource : displaySource.slice(0, TOP_N_DEFAULT);
  const remaining = displaySource.length - display.length;

  // ----- Pixel-vs-Shopify attribution gap (top-of-table trust view) -------
  const attributionGap = useMemo(() => {
    // Audit fix 2026-05-23 (FIND-01 follow-up): the trust panel reconciles
    // platform-claimed conversion value against the *store's full* Shopify
    // revenue (from dailyRows). When the multi-mapped filter is ON, we'd
    // be comparing a campaign subset's claim against the store total —
    // dishonest math (would always show absurd negative gap). Hide the
    // panel rather than show misleading numbers.
    if (showOnlyMultiMapped) return null;
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
    let ttSpendInScope = 0;
    for (const r of dailyRows) {
      // IN-03 (5.2.2.1): defense-in-depth filter — `dailyRows` (the Sheet's
      // daily-summary tab) is NOT pre-filtered by range on the server today.
      // Unlike /api/campaigns this filter is the authoritative one for
      // dailyRows; do not remove without first range-filtering at the source.
      if (r.date < localRange.from || r.date > localRange.to) continue;
      if (localStore !== 'All' && r.storeName !== localStore) continue;
      shopifyRevenue += r.revenue;
      metaSpendInScope += r.fbSpend;
      googleSpendInScope += r.gaSpend;
      ttSpendInScope += r.ttSpend ?? 0;
      // Phase 05.7.8 — include TikTok spend in the denominator so the
      // store-truth ROAS in the reconciliation panel doesn't overstate
      // ROAS for uzoshop. The "platforms claimed" total above is gathered
      // from CampaignsResponse rows which already include TikTok when
      // present, so adding TikTok spend here keeps the comparison
      // apples-to-apples.
    }

    if (shopifyRevenue === 0 && platformClaimed === 0) return null;

    // Gap = (Shopify - platform) / Shopify. Positive → platforms under-count
    // (iOS 14 / ad blockers / organic halo). Negative → over-count (view-through,
    // double-counting between Meta+Google, modeled conversions).
    const absGap = shopifyRevenue - platformClaimed;
    const gapPct = shopifyRevenue > 0 ? absGap / shopifyRevenue : 0;

    // ROAS comparison — store-truth vs platform-truth.
    const totalSpendShopify = metaSpendInScope + googleSpendInScope + ttSpendInScope;
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
      interpretation = `הפלטפורמות מ-overcounting ב-${(Math.abs(gapPct) * 100).toFixed(0)}%. כפיל-ספירה בין Meta / Google / TikTok, view-through inflation, או modeled conversions. אל תקבל החלטות "להגדיל קמפיין" רק על בסיס ה-conversion value של הפלטפורמה.`;
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
  }, [aggregated, dailyRows, localRange, localStore, platform, showOnlyMultiMapped]);

  // FIX-22 (5.2.2.1): memoize drillRows so the drawer's useMemo([rows]) doesn't invalidate on every parent re-render.
  const drillRows = useMemo(() => {
    if (!drillCampaignId || !drillPlatform || !drillStoreId || !data) return null;
    return filterDrillRows(data.rows, {
      storeId: drillStoreId,
      platform: drillPlatform,
      campaignId: drillCampaignId,
      rangeFrom: localRange.from,
      rangeTo: localRange.to,
    });
  }, [data, drillCampaignId, drillPlatform, drillStoreId, localRange.from, localRange.to]);

  // ----- Toolbar -----
  const toolbar = (
    <div className="flex flex-col sm:flex-row sm:items-center sm:flex-wrap gap-2 sm:gap-3 px-4 sm:px-5 py-3 bg-elevated2/40 border-b border-line-subtle">
      {/* PRIMARY filters — always inline on every breakpoint.
          Order: Mode → Store → Date range. */}
      {/* Mode selector: campaign or ad-set */}
      <div className="flex items-center gap-2">
        <span className="text-[11px] sm:text-xs text-ink-secondary font-medium shrink-0">
          תצוגה:
        </span>
        <div
          role="tablist"
          className="inline-flex rounded-lg border border-line bg-elevated overflow-hidden divide-x divide-line"
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
                  ? 'bg-accent text-white'
                  : 'bg-elevated text-ink-secondary hover:bg-elevated2',
              )}
            >
              {m === 'campaign' ? 'קמפיינים' : 'אד-סטים'}
            </button>
          ))}
        </div>
      </div>

      {/* Store filter */}
      <div className="flex items-center gap-2">
        <StoreIcon size={14} className="text-ink-muted shrink-0" />
        <select
          value={localStore}
          onChange={e => setLocalStore(e.target.value)}
          className="rounded-lg border border-line bg-elevated px-2.5 py-1.5 text-xs sm:text-sm font-medium focus:outline-none focus:ring-2 focus:ring-accent/30 min-w-[120px]"
        >
          <option value="All">כל החנויות</option>
          {stores.map(s => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
      </div>

      {/* Date range */}
      <div className="flex items-center gap-1.5 sm:gap-2 flex-wrap">
        <Calendar size={14} className="text-ink-muted shrink-0" />
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
            'rounded-lg border bg-elevated px-2 py-1.5 text-xs sm:text-sm font-medium',
            isCustomRange ? 'border-accent text-accent' : 'border-line text-ink-secondary',
          )}
        />
        <span className="text-ink-muted text-xs">—</span>
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
            'rounded-lg border bg-elevated px-2 py-1.5 text-xs sm:text-sm font-medium',
            isCustomRange ? 'border-accent text-accent' : 'border-line text-ink-secondary',
          )}
        />
        {isCustomRange && (
          <button
            type="button"
            onClick={() => setLocalRange(range)}
            className="p-2 rounded hover:bg-elevated2 text-ink-muted hover:text-ink"
            title="חזור לטווח הגלובלי"
          >
            <X size={14} />
          </button>
        )}
      </div>

      {/* P1-3 mobile audit (2026-05-29) — expander toggle for SECONDARY
          filters. Visible only on < sm. On sm+ the secondary block is
          always rendered inline so this button stays hidden. */}
      <button
        type="button"
        onClick={() => setMobileFiltersOpen(v => !v)}
        className="sm:hidden inline-flex items-center gap-1.5 rounded-md border border-line bg-elevated text-ink hover:bg-elevated2 px-2.5 py-1.5 text-xs font-medium transition-colors"
        aria-expanded={mobileFiltersOpen}
      >
        <Filter size={13} />
        {mobileFiltersOpen ? 'הסתר' : 'סינון נוסף'}
      </button>

      {/* SECONDARY filters — collapsed behind expander on mobile, always
          inline on sm+. Wrapped in a single flex container so the expander
          state controls all three at once. On sm+ the wrapper itself becomes
          a flex group (`sm:flex`) that wraps with the other primary items. */}
      <div
        className={cn(
          'w-full flex-wrap items-center gap-2 sm:gap-3 sm:w-auto sm:flex',
          mobileFiltersOpen ? 'flex' : 'hidden',
        )}
      >
        {/* Platform filter */}
        <div className="flex items-center gap-2">
          <div
            role="tablist"
            className="inline-flex rounded-lg border border-line bg-elevated overflow-hidden divide-x divide-line"
            dir="ltr"
          >
            {(['all', 'Meta', 'Google', 'TikTok'] as Platform[]).map(p => (
              <button
                key={p}
                role="tab"
                aria-selected={platform === p}
                onClick={() => setPlatform(p)}
                className={cn(
                  'px-2.5 sm:px-3 py-1.5 text-[11px] sm:text-xs font-medium transition-colors min-w-[48px] sm:min-w-[58px]',
                  platform === p
                    ? 'bg-accent text-white'
                    : 'bg-elevated text-ink-secondary hover:bg-elevated2',
                )}
              >
                {p === 'all' ? 'כולם' : p}
              </button>
            ))}
          </div>
        </div>

        {/* Phase 05.7.x (2026-05-23) — multi-mapped only filter. When ON,
            only campaigns sharing a product with another campaign in the
            same store are shown. Useful for inspecting cohort behaviour
            + spotting cannibalization risk at a glance. */}
        <div className="flex items-center gap-2">
          <label className="inline-flex items-center gap-1.5 text-[11px] sm:text-xs text-ink-secondary cursor-pointer select-none">
            <input
              type="checkbox"
              checked={showOnlyMultiMapped}
              onChange={e => setShowOnlyMultiMapped(e.target.checked)}
              className="rounded border-line accent-accent"
            />
            <span>🔗 רק קמפיינים עם מיפוי משותף</span>
            {showOnlyMultiMapped && (
              <span className="text-ink-muted text-[10px] tabular-nums">
                ({aggregatedFiltered.length} מתוך {aggregated.length})
              </span>
            )}
          </label>
        </div>

        {/* Optimized-mark counter + bulk-clear (only renders when something marked). */}
        {optimized.size > 0 && (
          <div className="flex items-center gap-1.5 text-[11px] sm:text-xs">
            <CheckCircle2 size={13} className="text-status-green shrink-0" />
            <span className="font-medium text-ink-secondary tabular-nums">
              {optimized.size} מסומנים
            </span>
            <button
              type="button"
              onClick={onClearAll}
              className="font-semibold text-ink-muted hover:text-status-red transition-colors px-1.5 py-0.5 rounded hover:bg-status-redBg/40"
              title="הסר את כל הסימונים"
            >
              נקה הכל
            </button>
          </div>
        )}
      </div>

      <span className="text-[10px] sm:text-xs text-ink-muted tabular-nums sm:mr-auto">
        {/* Audit fix 2026-05-23 (FIND-14): when the multi-mapped filter is
            on, show the visible-row count instead of the pre-filter total so
            this headline number doesn't disagree with the table body. The
            chip on line 1037-1040 still surfaces "X מתוך Y" detail. */}
        {showOnlyMultiMapped ? aggregatedFiltered.length : aggregated.length}{' '}
        {mode === 'campaign' ? 'קמפיינים' : 'אד-סטים'}
      </span>

      {/* Phase 05.7.9d — column visibility menu (hide/show only). */}
      <CampaignsColumnsMenu mode={mode} />
    </div>
  );

  // ----- Summary -----
  const roasInfo = roasLabel(totals.roas);
  const summary = aggregated.length > 0 && (
    <div className="px-4 sm:px-5 py-3 sm:py-4 bg-gradient-to-l from-accent/5 to-elevated border-b border-line-subtle">
      <div className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-7 gap-2 sm:gap-3">
        <Stat label="ROAS" value={totals.roas > 0 ? formatNumber(totals.roas) : '—'} chip={{ text: roasInfo.text, tone: roasInfo.tone }} />
        <Stat label="הוצאה" value={formatCurrency(totals.spend)} prefix="CAD" />
        <Stat label="ערך המרות" value={formatCurrency(totals.conversionValue)} prefix="CAD" accent={totals.conversionValue >= totals.spend ? 'green' : undefined} />
        <Stat label="המרות" value={formatNumber(totals.conversions, 0)} />
        <Stat label="קליקים" value={formatNumber(totals.clicks, 0)} />
        <Stat label="CTR" value={totals.impressions > 0 ? `${(totals.ctr * 100).toFixed(2)}%` : '—'} />
        <Stat
          label="CPM"
          value={totals.impressions > 0 ? formatCurrency(totals.cpm, 2) : '—'}
          prefix={totals.impressions > 0 ? 'CAD' : undefined}
          onClick={totals.impressions > 0 && cpmDaily.length >= 2 ? () => setCpmExpanded(v => !v) : undefined}
          active={cpmExpanded}
        />
      </div>
      {cpmExpanded && cpmDaily.length >= 2 && (() => {
        // Compute the smart-analysis verdict for this scope before render so
        // the JSX stays flat. Mode toggle ('half' vs 'prev') picks the
        // baseline — when 'prev', we pass the matching-length window
        // immediately before the current range so the helper compares
        // means apples-to-apples (same baseline the Hero KPI deltas use).
        const analysis = analyzeCpmVsRoas(
          cpmDaily.map(d => ({ date: d.date, cpm: d.cpm, roas: d.roas })),
          cpmAnalysisMode === 'prev' && cpmDailyPrev ? { prev: cpmDailyPrev } : undefined,
        );
        const toneBg: Record<typeof analysis.tone, string> = {
          positive: 'bg-status-greenBg/40 border-status-green/30 text-status-green',
          warning:  'bg-amber-50 border-amber-300 text-amber-800',
          negative: 'bg-status-redBg/40 border-status-red/30 text-status-red',
          neutral:  'bg-elevated2 border-line-subtle text-ink-secondary',
        };
        // Build an explicit baseline label with the actual date windows so
        // the user knows exactly what's being compared. Format MM-DD/DD →
        // MM-DD/DD so it reads naturally in Hebrew RTL.
        const fmtRangeShort = (from: string, to: string) => {
          const f = from.slice(5).replace('-', '/');
          const t = to.slice(5).replace('-', '/');
          return `${f}—${t}`;
        };
        const halfMidIdx = Math.floor(cpmDaily.length / 2);
        const firstHalfDates = cpmDaily.length >= 4
          ? `${cpmDaily[0].date.slice(5).replace('-', '/')}—${cpmDaily[halfMidIdx - 1].date.slice(5).replace('-', '/')}`
          : '';
        const secondHalfDates = cpmDaily.length >= 4
          ? `${cpmDaily[halfMidIdx].date.slice(5).replace('-', '/')}—${cpmDaily[cpmDaily.length - 1].date.slice(5).replace('-', '/')}`
          : '';
        const baselineLabel = analysis.mode === 'previous-period'
          ? `השוואה: ${fmtRangeShort(localRange.from, localRange.to)} מול ${fmtRangeShort(cpmPrevRange.from, cpmPrevRange.to)} (תקופה קודמת באותו אורך)`
          : firstHalfDates && secondHalfDates
          ? `השוואה: חצי שני (${secondHalfDates}) מול חצי ראשון (${firstHalfDates})`
          : 'השוואה: חצי שני vs חצי ראשון של הטווח';
        const isLoadingPrev = cpmAnalysisMode === 'prev' && !cpmPrevData;
        // Build the chart's data array. When the user toggled the 'prev'
        // baseline AND we have previous-period rows, merge in the previous
        // period's CPM by CALENDAR OFFSET — "day 0 of current pairs with day 0
        // of prev", "day 1 with day 1", regardless of which days got filtered
        // out for zero impressions. Naive index pairing (the original bug
        // c/CR-01) silently warped this whenever current and prev had a
        // different number of active days. Now both series are anchored to
        // days-since-window-start, so the dashed line truly is the same
        // relative day. X-axis labels stay on the current period's dates;
        // the previous period's actual date surfaces in the tooltip.
        const prevByOffset = indexPrevByDateOffset(cpmDailyPrev, cpmPrevRange.from);
        const cpmChartData = cpmDaily.map(d => {
          const offset = dayOffsetFromRangeStart(d.date, localRange.from);
          const prev = prevByOffset.get(offset);
          return {
            ...d,
            prevCpm: prev?.cpm ?? null,
            prevDate: prev?.date ?? null,
          };
        });
        const showPrevLine = cpmAnalysisMode === 'prev' && !isLoadingPrev && (cpmDailyPrev?.length ?? 0) > 0;
        return (
        <div className="mt-3 rounded-lg bg-elevated border border-line-subtle p-3">
          <div className="flex items-center justify-between gap-2 mb-2 flex-wrap">
            <h3 className="text-xs sm:text-sm font-semibold text-ink inline-flex items-center gap-1.5">
              CPM לאורך זמן
              <span className="text-[10px] font-medium text-ink-muted">
                ({localStore === 'All' ? 'כל החנויות' : localStore}
                {platform !== 'all' ? ` · ${platform}` : ''}
                {', CAD'})
              </span>
            </h3>
            <div className="flex items-center gap-3 flex-wrap">
              {/* Analysis baseline toggle — picks what the smart-analysis
                  box compares against. Two modes: half-over-half (within
                  range) vs previous-period (same-length window before). */}
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
              <label className="inline-flex items-center gap-1.5 text-[11px] text-ink-secondary cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={cpmShowRoas}
                  onChange={e => setCpmShowRoas(e.target.checked)}
                  className="rounded border-line-subtle text-accent focus:ring-accent/30 cursor-pointer"
                />
                הוסף ROAS לגרף
              </label>
              <button
                type="button"
                onClick={() => setCpmExpanded(false)}
                className="text-[11px] text-ink-muted hover:text-ink transition-colors"
                aria-label="סגור"
              >
                ✕
              </button>
            </div>
          </div>
          <ChartContainer className="h-40 sm:h-48" dir="ltr" height="100%">
              <LineChart data={cpmChartData} margin={{ top: 8, right: cpmShowRoas ? 56 : 16, left: 4, bottom: 0 }}>
                <XAxis
                  dataKey="date"
                  tick={{ fontSize: 10, fill: CHART_COLORS.axis }}
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
                  tick={{ fontSize: 10, fill: CHART_COLORS.axis }}
                  tickLine={false}
                  axisLine={false}
                  tickFormatter={v => `C$${Number(v).toFixed(2)}`}
                  width={68}
                  // c/CR-02: zero-anchored Y axis. The previous
                  // `[dataMin * 0.88, dataMax * 1.12]` suppression turned a
                  // 3% CPM change into a chart-height-spanning curve — the
                  // textbook misleading-axis pattern. Operator dashboards
                  // should show the true magnitude; CPM is always >= 0.
                  domain={[0, (dataMax: number) => dataMax * 1.12]}
                  allowDecimals
                />
                {cpmShowRoas && (
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
                    const prevDeltaPct = (showPrevLine && d.prevCpm != null && d.prevCpm > 0)
                      ? ((d.cpm - d.prevCpm) / d.prevCpm) * 100
                      : null;
                    return (
                      <ChartTooltip className="tabular-nums">
                        <ChartTooltipLabel>{formatDate(d.date)}</ChartTooltipLabel>
                        <ChartTooltipRow color={CHART_COLORS.cpm} label="CPM">
                          CAD <ChartTooltipValue>{formatCurrency(d.cpm, 2)}</ChartTooltipValue>
                        </ChartTooltipRow>
                        {cpmShowRoas && (
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
                {cpmShowRoas && (
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
          {(cpmShowRoas || showPrevLine) && (
            <div className="flex items-center justify-center gap-4 text-[10px] text-ink-muted mt-1.5 flex-wrap">
              <span className="inline-flex items-center gap-1.5">
                {/* CPM swatch tracks CHART_COLORS.cpm (= var(--status-orange))
                    so the legend stays in sync with the chart line in both
                    light and dark mode. */}
                <span className="inline-block w-3 h-[2px]" style={{ background: CHART_COLORS.cpm }} />
                CPM {cpmShowRoas ? '(ציר שמאל)' : ''}
              </span>
              {showPrevLine && (
                <span className="inline-flex items-center gap-1.5">
                  <span className="inline-block w-3 border-t-2 border-dashed border-amber-400" />
                  CPM תקופה קודמת
                </span>
              )}
              {cpmShowRoas && (
                <span className="inline-flex items-center gap-1.5">
                  <span className="inline-block w-3 border-t-2 border-dashed border-status-green" />
                  ROAS (ציר ימין)
                </span>
              )}
            </div>
          )}
          {cpmAnalysisMode === 'prev' && !isLoadingPrev && analysis.mode === 'half-over-half' && (
            <div className="text-[10px] text-amber-700 bg-amber-50 px-2 py-1 rounded mt-1">
              {/* FIX-19 (5.2.2.1): fallback disclosure when previous period had
                  fewer than PREV_PERIOD_MIN_DAYS active days.
                  WR-01 (5.2.2.1): gated by !isLoadingPrev so the banner does not fire prematurely
                  while SWR is still resolving cpmPrevData (~100-500ms after toggling to 'prev').
                  Without the gate, the analyzer runs without prev data, returns
                  analysis.mode='half-over-half', and the banner asserts <N active days even though
                  prev was never actually evaluated. The banner self-corrects when data arrives, but
                  the operator briefly sees an incorrect explanation.
                  IN-08 (5.2.2.1): the threshold N is sourced from
                  PREV_PERIOD_MIN_DAYS (cpmRoasAnalysis.ts) so the banner copy can
                  never drift from the analyzer gate. */}
              {`לתקופה הקודמת פחות מ-${PREV_PERIOD_MIN_DAYS} ימים שבהם הקמפיין רץ (חשיפות + הוצאה) — מציג השוואת חצי-חצי במקום.`}
            </div>
          )}
          {/* FIX-24 (5.2.2.1): always render so sparse campaigns see an explicit
              placeholder instead of an empty space that looks like a UI bug.
              Previously gated by {analysis.hasData &&}. */}
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
        </div>
        );
      })()}
      {totals.spend > 0 && (
        <div className="mt-3 pt-3 border-t border-line-subtle text-[10px] sm:text-xs text-ink-muted tabular-nums flex flex-wrap gap-x-3 gap-y-1">
          <span>CPC: <span className="text-ink-secondary font-medium">CAD {formatCurrency(totals.cpc, 2)}</span></span>
          <span className="text-ink-subtle">·</span>
          <span>CPA: <span className="text-ink-secondary font-medium">CAD {totals.conversions > 0 ? formatCurrency(totals.cpa, 2) : '—'}</span></span>
          <span className="text-ink-subtle">·</span>
          <span>חשיפות: <span className="text-ink-secondary font-medium">{formatNumber(totals.impressions, 0)}</span></span>
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
        <div className="m-4 rounded-lg bg-status-redBg border border-status-red/30 p-3 flex items-start gap-2 text-sm">
          <AlertCircle className="text-status-red shrink-0" size={18} />
          <div>
            <div className="font-semibold text-status-red">שגיאה בטעינת קמפיינים</div>
            <div className="text-ink-secondary text-xs mt-1">
              {error ? (error as Error).message : data?.error}
            </div>
          </div>
        </div>
      )}

      {isLoading && (
        <div className="p-8 text-center text-ink-muted text-sm">טוען נתוני קמפיינים…</div>
      )}

      {data && !error && !data.error && aggregated.length === 0 && (
        <div className="p-8 text-center text-ink-muted text-sm">
          <Megaphone className="mx-auto mb-2 text-ink-muted/60" size={28} />
          <div>אין קמפיינים פעילים בטווח הזה.</div>
          <div className="text-[11px] mt-1">נסה להרחיב את טווח התאריכים או לשנות פלטפורמה.</div>
        </div>
      )}

      {data && display.length > 0 && (
        <>
          {/* overflow-auto + max-h makes wrapper the scroll context so sticky
              thead pins to the top of the box (not the page). */}
          <div className="overflow-auto max-h-[60vh] md:max-h-[calc(100vh-180px)] roas-campaigns-table">
            {/* Phase 05.7.9d — column visibility CSS. The roas-campaigns-table
                class scopes the rules so they don't leak into other tables. */}
            {columnHiddenCss && (
              <style dangerouslySetInnerHTML={{ __html: columnHiddenCss }} />
            )}
            {(() => {
              // Phase 05.7.x — build the metric-column headers into a
              // colId → JSX map so the thead can render them in the
              // operator's preferred order (state `columnOrder`).
              // Structural cells (optimized / health / campaignName /
              // deepLink) stay fixed at the edges and aren't part of
              // this map; only the 15 metric columns are reorderable.
              const metricHeaders: Record<string, React.ReactNode> = {
                spend: (
                  <SortHeader
                    key="spend"
                    label="הוצאה"
                    sortKey="spend"
                    activeKey={sortKey}
                    dir={sortDir}
                    onClick={handleSort}
                    align="end"
                    className="px-3 py-2 w-[80px]"
                    dataColId="spend"
                    tooltip="סך ההוצאה (CAD) על הקמפיין בטווח הנבחר. מקור: API של פלטפורמת הפרסום — Meta Ads Insights / Google Ads / TikTok Marketing API, ממירים מ-USD/ILS ל-CAD ברגע ההזנה."
                  />
                ),
                budget: (
                  <SortHeader
                    key="budget"
                    label="תקציב יומי"
                    sortKey="budget"
                    activeKey={sortKey}
                    dir={sortDir}
                    onClick={handleSort}
                    align="end"
                    className="px-3 py-2 w-[100px]"
                    dataColId="budget"
                    tooltip="התקציב היומי שהוגדר בפלטפורמה (CAD). במצב CBO התקציב נשמר ברמת הקמפיין ולכן זהה לכל האד-סטים שבו; במצב ABO כל אד-סט מחזיק תקציב נפרד. ערך — = אין תקציב יומי מוגדר (תקציב Lifetime או לא זמין)."
                  />
                ),
                conversionValue: (
                  <SortHeader
                    key="conversionValue"
                    label="ערך המרות"
                    sortKey="conversionValue"
                    activeKey={sortKey}
                    dir={sortDir}
                    onClick={handleSort}
                    align="end"
                    className="px-3 py-2 w-[80px]"
                    dataColId="conversionValue"
                    tooltip="ערך ההמרות שדווח ע״י הפלטפורמה עצמה (conversion_value מ-Meta Pixel / Google Ads). זו ההצהרה של הפלטפורמה — מה ש-Pixel ראה — לא בהכרח מה שקרה בפועל ב-Shopify. השווה לעמודות ה-Shopify מימין כדי לראות פערי attribution."
                  />
                ),
                roas: (
                  <SortHeader
                    key="roas"
                    label="ROAS"
                    sortKey="roas"
                    activeKey={sortKey}
                    dir={sortDir}
                    onClick={handleSort}
                    align="center"
                    className="px-3 py-2 w-[64px]"
                    dataColId="roas"
                    tooltip={'ROAS לפי הפלטפורמה. נוסחה: ערך המרות ÷ הוצאה. צביעה: אדום <2 (מפסיד), כתום 2-2.7 (גבולי), ירוק 2.7-3 (בריא), כחול >3 (מצוין). זהו ה-ROAS שהפלטפורמה ״רואה״, ולא בהכרח מה שקרה בפועל — קח עם מלח, השווה ל-ROAS Shopify.'}
                  />
                ),
                roasShopify: (
                  <SortHeader
                    key="roasShopify"
                    label="ROAS Shopify"
                    sortKey="shopifyRoas"
                    activeKey={sortKey}
                    dir={sortDir}
                    onClick={handleSort}
                    align="center"
                    className="px-3 py-2 w-[92px]"
                    dataColId="roasShopify"
                    tooltip={'ROAS לפי המכירות בפועל ב-Shopify של המוצרים המשויכים לקמפיין. נוסחה: (revenue דטרמיניסטי + הקצאה פרופורציונלית של נותר) ÷ הוצאה. זהו ה-ROAS האמיתי ביותר — מבוסס על מה ש-Shopify רושם, לא על מה שה-Pixel מדווח. דורש שהקמפיין ימופה למוצרים (לחץ על השורה כדי למפות).\n\n🔗 מיפוי משותף: אם המוצר ממופה ל-2+ קמפיינים, ההכנסה מתחלקת ביניהם פרופורציונלית להוצאה (intra-platform spend share). כלומר ROAS Shopify של קמפיין יחיד בקבוצה הוא חלקו, לא כל ההכנסה של המוצר. ראה גם פאנל ההשוואה במגירת הקמפיין.'}
                  />
                ),
                roasShopifyPlatform: (
                  <SortHeader
                    key="roasShopifyPlatform"
                    label={
                      <span className="inline-flex flex-col items-center leading-tight">
                        <span>ROAS Shopify</span>
                        <span className="text-[9px] text-ink-muted font-normal">פלטפורמה</span>
                      </span>
                    }
                    sortKey="roasShopifyPlatform"
                    activeKey={sortKey}
                    dir={sortDir}
                    onClick={handleSort}
                    align="center"
                    className="px-3 py-2 w-[100px]"
                    dataColId="roasShopifyPlatform"
                    tooltip={'ROAS Shopify מבוסס רק על הזמנות שסווגו דטרמיניסטית לפלטפורמה הזו דרך source / click-id (ttclid, fbclid, gclid, utm_source). נוסחה: deterministicRevenue ÷ הוצאה. אין fallback פרופורציונלי — רק מה שאנחנו יכולים להוכיח. ROAS גבוה כאן = הקמפיין מייצר מכירות שאפשר לייחס אליו בוודאות.\n\n🔗 מיפוי משותף intra-platform: אם 4 קמפיינים של Meta מקדמים את אותו מוצר, ההכנסה הדטרמיניסטית של Meta מתחלקת ביניהם לפי spend share. הקמפיין שהוצאתו 50% מקבל 50% מההכנסה הדטרמיניסטית; הקמפיין שהוצאתו 10% מקבל 10%.'}
                  />
                ),
                shopifyValuePlatform: (
                  <SortHeader
                    key="shopifyValuePlatform"
                    label={
                      <span className="inline-flex flex-col items-end leading-tight">
                        <span>ערך Shopify</span>
                        <span className="text-[9px] text-ink-muted font-normal">פלטפורמה</span>
                      </span>
                    }
                    sortKey="shopifyValuePlatform"
                    activeKey={sortKey}
                    dir={sortDir}
                    onClick={handleSort}
                    align="end"
                    className="px-3 py-2 w-[92px] border-e border-line-subtle"
                    dataColId="shopifyValuePlatform"
                    tooltip="ערך המכירות (CAD) שסווגו דטרמיניסטית לפלטפורמה הזו דרך source / click-id ב-Shopify (utm_source, ttclid, fbclid, gclid). רק הזמנות שאנחנו 100% בטוחים שהן מהפלטפורמה הזו — בלי הקצאה פרופורציונלית. זה מה שאפשר להוכיח."
                  />
                ),
                shopifyUnitsPlatform: (
                  <SortHeader
                    key="shopifyUnitsPlatform"
                    label={
                      <span className="inline-flex flex-col items-end leading-tight">
                        <span>יח&apos; Shopify</span>
                        <span className="text-[9px] text-ink-muted font-normal">פלטפורמה</span>
                      </span>
                    }
                    sortKey="shopifyUnitsPlatform"
                    activeKey={sortKey}
                    dir={sortDir}
                    onClick={handleSort}
                    align="end"
                    className="px-3 py-2 w-[78px] border-e border-line-subtle"
                    dataColId="shopifyUnitsPlatform"
                    tooltip="מספר היחידות שנמכרו ב-Shopify מהזמנות שסווגו דטרמיניסטית לפלטפורמה הזו. סופר units (line_items.quantity) — לא orders. רק הזמנות עם source / click-id ברור."
                  />
                ),
                shopifyValueTotal: (
                  <SortHeader
                    key="shopifyValueTotal"
                    label={
                      <span className="inline-flex flex-col items-end leading-tight">
                        <span>ערך Shopify</span>
                        <span className="text-[9px] text-ink-muted font-normal">סה&quot;כ</span>
                      </span>
                    }
                    sortKey="shopifyValueTotal"
                    activeKey={sortKey}
                    dir={sortDir}
                    onClick={handleSort}
                    align="end"
                    className="px-3 py-2 w-[92px]"
                    dataColId="shopifyValueTotal"
                    tooltip="סך ערך המכירות (CAD) ב-Shopify של המוצרים המשויכים בטווח הנבחר, בלי קשר לפלטפורמה (כולל direct, organic, ופלטפורמות אחרות). זהו ה״מכנה״ — מסגרת הייחוס לכמה מהמכירות הגיעו דרך הקמפיין הזה."
                  />
                ),
                shopifyUnitsTotal: (
                  <SortHeader
                    key="shopifyUnitsTotal"
                    label={
                      <span className="inline-flex flex-col items-end leading-tight">
                        <span>יח&apos; Shopify</span>
                        <span className="text-[9px] text-ink-muted font-normal">סה&quot;כ</span>
                      </span>
                    }
                    sortKey="shopifyUnitsTotal"
                    activeKey={sortKey}
                    dir={sortDir}
                    onClick={handleSort}
                    align="end"
                    className="px-3 py-2 w-[78px]"
                    dataColId="shopifyUnitsTotal"
                    tooltip="סך היחידות שנמכרו ב-Shopify של המוצרים המשויכים בטווח הנבחר, בלי קשר לפלטפורמה. ה״מכנה״ ל-יח׳ פלטפורמה ממש כמו ש-ערך סה״כ הוא המכנה ל-ערך פלטפורמה."
                  />
                ),
                shopifyOrdersTotal: (
                  <SortHeader
                    key="shopifyOrdersTotal"
                    label={
                      <span className="inline-flex flex-col items-end leading-tight">
                        <span>הזמ&apos; Shopify</span>
                        <span className="text-[9px] text-ink-muted font-normal">סה&quot;כ</span>
                      </span>
                    }
                    sortKey="shopifyOrdersTotal"
                    activeKey={sortKey}
                    dir={sortDir}
                    onClick={handleSort}
                    align="end"
                    className="px-3 py-2 w-[78px]"
                    dataColId="shopifyOrdersTotal"
                    tooltip="סך ההזמנות ב-Shopify שכללו את המוצרים המשויכים בטווח הנבחר, מכל הערוצים. מוצר מרובה הזמנות נספר פעם להזמנה. הזמנה אחת עם 2 מוצרים מסוכמת פר-מוצר."
                  />
                ),
                conversions: (
                  <SortHeader
                    key="conversions"
                    label="המרות"
                    sortKey="conversions"
                    activeKey={sortKey}
                    dir={sortDir}
                    onClick={handleSort}
                    align="end"
                    className="px-3 py-2 w-[72px]"
                    dataColId="conversions"
                    tooltip="מספר ההמרות (purchase events) שהפלטפורמה ייחסה לקמפיין בטווח. ב-Meta: actions.purchase, ב-Google: conversions, ב-TikTok: complete_payment. זוהי הספירה של הפלטפורמה — לא בהכרח שווה למספר ההזמנות ב-Shopify."
                  />
                ),
                ctr: (
                  <SortHeader
                    key="ctr"
                    label="CTR"
                    sortKey="ctr"
                    activeKey={sortKey}
                    dir={sortDir}
                    onClick={handleSort}
                    align="end"
                    className="px-3 py-2 w-[72px]"
                    dataColId="ctr"
                    tooltip="Click-Through Rate — מה אחוז הצופים שלחצו על המודעה. נוסחה: קליקים ÷ חשיפות × 100. בנצ׳מארק כללי: <0.5% חלש, 0.5-1% סביר, 1-2% טוב, >2% מעולה (תלוי תעשייה ופלטפורמה)."
                  />
                ),
                cpc: (
                  <SortHeader
                    key="cpc"
                    label="CPC"
                    sortKey="cpc"
                    activeKey={sortKey}
                    dir={sortDir}
                    onClick={handleSort}
                    align="end"
                    className="px-3 py-2 w-[72px]"
                    dataColId="cpc"
                    tooltip="Cost Per Click — כמה עלה לך כל קליק. נוסחה: הוצאה ÷ קליקים. ב-CAD. CPC נמוך לבד לא אומר כלום — צריך גם CTR בריא וגם המרות, אחרת זה רק קליקים זולים שלא קונים."
                  />
                ),
                cpm: (
                  <SortHeader
                    key="cpm"
                    label="CPM"
                    sortKey="cpm"
                    activeKey={sortKey}
                    dir={sortDir}
                    onClick={handleSort}
                    align="end"
                    className="px-3 py-2 w-[80px]"
                    dataColId="cpm"
                    tooltip="Cost Per Mille — עלות לאלף חשיפות. נוסחה: (הוצאה ÷ חשיפות) × 1000. ב-CAD. אינדיקטור לרמת התחרות בקהל היעד / איכות היצירתיים: CPM עולה משמעו או יותר תחרות או יצירתיב גרוע יותר."
                  />
                ),
                cpa: (
                  <SortHeader
                    key="cpa"
                    label="CPA"
                    sortKey="cpa"
                    activeKey={sortKey}
                    dir={sortDir}
                    onClick={handleSort}
                    align="end"
                    className="px-3 py-2 w-[72px]"
                    dataColId="cpa"
                    tooltip="Cost Per Acquisition — כמה עלתה לך כל המרה. נוסחה: הוצאה ÷ המרות. ב-CAD. בריא אם CPA קטן מהרווח הממוצע למוצר. מתבסס על ספירת ההמרות של הפלטפורמה — לא של Shopify."
                  />
                ),
              };
              return (
            <table className="w-full text-xs sm:text-sm min-w-[1340px]">
              <thead className="sticky top-0 z-[5] bg-elevated">
                <tr className="text-ink-secondary border-b border-line-subtle bg-elevated2/40">
                  <ColumnHeaderTh
                    className="px-3 py-2 w-[36px]"
                    ariaLabel="סימון אופטימיזציה"
                    dataColId="optimized"
                    tooltip="צ׳קבוקס לסימון קמפיינים שאתה מבצע בהם אופטימיזציה פעילה (מעקב אישי). לא משפיע על חישובים — רק עוזר לזכור איפה אתה בעבודה."
                  />
                  <SortHeader
                    label="ציון"
                    sortKey="health"
                    activeKey={sortKey}
                    dir={sortDir}
                    onClick={handleSort}
                    align="center"
                    className="px-2 py-2 w-[78px]"
                    dataColId="health"
                    tooltip="Campaign Health Score 0–100 — ציון מאוחד שמשלב 4 רכיבים (רווחיות 40% × אמינות + נפח 15% + מומנטום CPM↔ROAS 25% + בהירות attribution 20%) ± התאמת אופרטור (+15 לאופטימיזציה, −30 לקמפיין כבוי). אות A/B/C/D/F מסכמת. לחץ על התג כדי לראות פירוט מלא של הרכיבים והנימוקים."
                  />
                  <SortHeader
                    label={mode === 'campaign' ? 'קמפיין' : 'אד-סט'}
                    sortKey="name"
                    activeKey={sortKey}
                    dir={sortDir}
                    onClick={handleSort}
                    align="start"
                    className="px-3 sm:px-5 py-2"
                    dataColId="campaignName"
                    tooltip={
                      mode === 'campaign'
                        ? 'שם הקמפיין כפי שמוגדר בפלטפורמה (Meta / Google / TikTok). תג בצבע ליד השם מציין את הפלטפורמה. ה-CBO/ABO באייקון משמאל מציין אם התקציב ברמת הקמפיין (CBO) או ברמת האד-סט (ABO). לחיצה ממיינת אלפבתית.'
                        : 'שם האד-סט כפי שמוגדר בפלטפורמה. לחיצה ממיינת אלפבתית.'
                    }
                  />
                  {/* Plan 4a Task 5 (2026-05-29) — fixed (non-reorderable)
                      "מגמה" column for the per-row ROAS sparkline. Sits
                      outside the columnOrder map so the operator can't
                      hide it (the trend is always-on, on par with the
                      ציון / health badge). Mirrors the matching <td>
                      in CampaignsTableRow. */}
                  <ColumnHeaderTh
                    className="px-2 py-2 text-center font-medium w-[80px] text-[11px] text-ink-secondary"
                    dataColId="roasTrend"
                    tooltip="מגמת ROAS היומית בטווח המסונן (כל יום מציג ROAS = ערך / הוצאה). הקו עוזר לזהות במבט אחד אם הקמפיין במגמת עלייה, ירידה או יציבות, בלי לפתוח את המגירה. מינימום 2 ימים — פחות מזה לא ניתן לצייר טרנד."
                  >
                    מגמה
                  </ColumnHeaderTh>
                  {columnOrder.map(id => metricHeaders[id] ?? null)}
                  <ColumnHeaderTh
                    className="px-2 py-2 text-center font-medium w-[40px]"
                    ariaLabel="פעולות"
                    dataColId="deepLink"
                    tooltip="לחיצה על אייקון הקישור פותחת את הקמפיין ישירות במנהל המודעות של הפלטפורמה (Meta Ads Manager / Google Ads / TikTok Ads Manager) בטאב חדש."
                  />
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
                    mappedCampaignKeys={mappedCampaignKeys}
                    health={healthByKey.get(a.key)}
                    columnOrder={columnOrder}
                    dailySeries={dailyByCampaign.get(a.key)}
                    adAccounts={adAccounts}
                    optimized={optimized}
                    today={today}
                    onToggleOptimized={onToggleOptimized}
                    onDrillCampaign={(campaignId, platform, storeId) => {
                      const doc = document as typeof document & {
                        startViewTransition?: (cb: () => void) => { finished: Promise<void> };
                      };
                      if (typeof doc.startViewTransition === 'function') {
                        doc.startViewTransition(() => {
                          startTransition(() => {
                            setDrillCampaignId(campaignId);
                            setDrillPlatform(platform);
                            setDrillStoreId(storeId);   // FIX-03 (5.2.2.1)
                          });
                        });
                      } else {
                        setDrillCampaignId(campaignId);
                        setDrillPlatform(platform);
                        setDrillStoreId(storeId);   // FIX-03 (5.2.2.1)
                      }
                    }}
                    onDrillAd={(set) => setAdDrill(set)}
                  />
                ))}
              </tbody>
            </table>
              );
            })()}
          </div>

          {aggregated.length > TOP_N_DEFAULT && (
            <div className="px-4 sm:px-5 py-2.5 bg-elevated2/30 border-t border-line-subtle">
              <button
                onClick={() => setShowAll(v => !v)}
                className="text-xs sm:text-sm text-accent hover:text-accent font-medium inline-flex items-center gap-1.5 transition-colors"
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
      {drillRows && drillCampaignId && drillPlatform && drillStoreId && (
        <CampaignDrawer
          campaignId={drillCampaignId}
          storeId={drillStoreId}
          open
          onClose={() => { setDrillCampaignId(null); setDrillPlatform(null); setDrillStoreId(null); }}
          rows={drillRows}
          adAccounts={adAccounts}
          rangeFrom={localRange.from}
          rangeTo={localRange.to}
          // Phase 05.7.x — pass the campaign-level Health Score so the
          // drawer can mirror the table badge's verdict. In campaign mode
          // the drilled row's a.key is exactly the campaign key, so the
          // healthByKey lookup matches. In adset mode the table's
          // healthByKey is keyed per adSet — campaign-level health isn't
          // backfilled in V2, so we just omit the prop.
          health={
            mode === 'campaign'
              ? healthByKey.get(`${drillStoreId}::${drillPlatform}::${drillCampaignId}`)
              : undefined
          }
        />
      )}

      {adDrill && (
        <AdsDrawer
          open
          onClose={() => setAdDrill(null)}
          storeId={adDrill.storeId}
          platform={adDrill.platform}
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
    good: 'border-status-green/30 bg-status-greenBg/40',
    flag: 'border-status-red/30 bg-status-redBg/40',
  }[gap.tone];

  const arrow = gap.gapPct > 0 ? '↗' : gap.gapPct < 0 ? '↘' : '=';

  return (
    <section
      className={cn(
        'px-4 sm:px-5 py-3 sm:py-4 border-b border-line-subtle',
        toneClass,
      )}
    >
      <div className="flex items-center gap-2 mb-2">
        <span className="text-[10px] sm:text-xs font-bold uppercase tracking-wider text-ink-secondary">
          התאמת שיוך · Meta &amp; Google &amp; TikTok ↔ Shopify
        </span>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-4">
        <div>
          <div className="text-[10px] text-ink-muted uppercase tracking-wide">
            פלטפורמות מדווחות
          </div>
          <div className="text-base sm:text-lg font-semibold tabular-nums text-ink mt-0.5">
            <span className="text-[10px] text-ink-muted font-medium ml-1">CAD</span>
            {formatCurrency(gap.platformClaimed)}
          </div>
          <div className="text-[10px] text-ink-muted tabular-nums">
            ROAS: {gap.platformRoas > 0 ? gap.platformRoas.toFixed(2) : '—'}
          </div>
        </div>

        <div>
          <div className="text-[10px] text-ink-muted uppercase tracking-wide">
            Shopify בפועל
          </div>
          <div className="text-base sm:text-lg font-bold tabular-nums text-ink mt-0.5">
            <span className="text-[10px] text-ink-muted font-medium ml-1">CAD</span>
            {formatCurrency(gap.shopifyRevenue)}
          </div>
          <div className="text-[10px] text-ink-muted tabular-nums">
            ROAS: {gap.storeRoas > 0 ? gap.storeRoas.toFixed(2) : '—'}
          </div>
        </div>

        <div>
          <div className="text-[10px] text-ink-muted uppercase tracking-wide">
            פער (Shopify − Platforms)
          </div>
          <div
            className={cn(
              'text-base sm:text-lg font-bold tabular-nums mt-0.5',
              gap.absGap >= 0 ? 'text-status-green' : 'text-status-red',
            )}
          >
            <span className="text-[10px] text-ink-muted font-medium ml-1">CAD</span>
            {gap.absGap >= 0 ? '+' : ''}{formatCurrency(gap.absGap)}
          </div>
          <div className="text-[10px] text-ink-muted tabular-nums">
            {arrow} {(gap.gapPct * 100).toFixed(1)}%
          </div>
        </div>

        <div>
          <div className="text-[10px] text-ink-muted uppercase tracking-wide">
            יחס אמינות
          </div>
          <div className="text-base sm:text-lg font-semibold tabular-nums mt-0.5">
            {gap.shopifyRevenue > 0
              ? (gap.platformClaimed / gap.shopifyRevenue * 100).toFixed(0) + '%'
              : '—'}
          </div>
          <div className="text-[10px] text-ink-muted">
            Platforms ÷ Shopify
          </div>
        </div>
      </div>

      <p className="mt-3 text-[11px] sm:text-xs text-ink-secondary leading-relaxed">
        <strong className="text-ink">משמעות:</strong> {gap.interpretation}
      </p>
    </section>
  );
}

/**
 * Styled column-header tooltip. Wraps a <th> so hovering the cell pops a
 * dark RTL-aware card explaining the metric. Replaces the native `title=`
 * attribute (slow appearance + ugly OS chrome) with the same look used by
 * MetricHelp elsewhere in the dashboard.
 *
 * Behavior:
 *   - 180ms enter delay so accidental flyovers don't flash a tooltip.
 *   - Cancels the timeout on early mouse-leave.
 *   - Renders nothing if `tooltip` is undefined / empty — keeps icon-only
 *     header cells with no help-text from getting a stray relative wrapper.
 *   - Anchors to end-0 (start edge in RTL) and z-[15] so it floats above
 *     the row body (auto stacking) but below TabNav (z-20) and Header
 *     (z-30) — same ladder established in the stacking-bug fix.
 *   - `pointer-events-none` keeps the popover from intercepting the
 *     header's sort-click target.
 */
function ColumnHeaderTh({
  tooltip,
  className,
  dataColId,
  ariaLabel,
  children,
}: {
  tooltip?: string;
  className?: string;
  dataColId?: string;
  ariaLabel?: string;
  children?: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const timeoutRef = useRef<number | null>(null);

  const cancel = () => {
    if (timeoutRef.current !== null) {
      window.clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
  };

  const handleEnter = () => {
    if (!tooltip) return;
    cancel();
    timeoutRef.current = window.setTimeout(() => setOpen(true), 180);
  };
  const handleLeave = () => {
    cancel();
    setOpen(false);
  };

  // Clean up the pending timeout if the row unmounts mid-hover (date-range
  // swap, store filter change, etc.) — otherwise the setTimeout would fire
  // setState on an unmounted component → React warning + leak.
  useEffect(() => cancel, []);

  return (
    <th
      className={cn('relative', className)}
      data-col-id={dataColId}
      aria-label={ariaLabel}
      onMouseEnter={handleEnter}
      onMouseLeave={handleLeave}
      onFocus={handleEnter}
      onBlur={handleLeave}
    >
      {children}
      {/* TODO mobile-fix: tooltip clipped by overflow-auto wrapper — needs Floating UI / portal for proper escape */}
      {open && tooltip && (
        <span
          role="tooltip"
          dir="rtl"
          className={cn(
            'absolute z-[15] top-full mt-2 end-0',
            'w-[260px] sm:w-[280px] max-w-[min(85vw,300px)]',
            'rounded-xl bg-ink text-canvas px-3 py-2.5',
            'shadow-elevated text-[11px] sm:text-[12px] leading-relaxed',
            'pointer-events-none animate-fade-in font-normal text-start whitespace-normal',
          )}
        >
          {tooltip}
          <span
            aria-hidden
            className="absolute -top-1 end-4 w-2 h-2 bg-ink rotate-45"
          />
        </span>
      )}
    </th>
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
  dataColId,
  tooltip,
}: {
  /** Phase 05.7.x — widened from `string` to ReactNode so multi-line
   *  column labels (e.g. the Shopify column group's stacked "ערך
   *  Shopify / פלטפורמה" pair) can become sortable headers without
   *  losing their two-line layout. Existing string labels still work. */
  label: React.ReactNode;
  sortKey: SortKey;
  activeKey: SortKey;
  dir: SortDir;
  onClick: (key: SortKey) => void;
  align: 'start' | 'center' | 'end';
  className?: string;
  /** Phase 05.7.9d — column ID for the visibility prefs. The CSS
   *  generated by buildHiddenColumnsCss matches this attribute. */
  dataColId?: string;
  /** Styled hover-popover tooltip explaining the metric. Rendered via
   *  ColumnHeaderTh (replaces the previous native title= attribute). */
  tooltip?: string;
}) {
  const isActive = sortKey === activeKey;
  const justify =
    align === 'start' ? 'justify-start' : align === 'end' ? 'justify-end' : 'justify-center';
  const textAlign =
    align === 'start' ? 'text-start' : align === 'end' ? 'text-end' : 'text-center';
  return (
    <ColumnHeaderTh
      className={cn('font-medium', textAlign, className)}
      dataColId={dataColId}
      tooltip={tooltip}
    >
      <button
        type="button"
        onClick={() => onClick(sortKey)}
        className={cn(
          'inline-flex items-center gap-1 transition-colors group',
          'select-none cursor-pointer',
          justify,
          isActive
            ? 'text-accent font-semibold'
            : 'text-ink-secondary hover:text-ink',
        )}
        aria-sort={isActive ? (dir === 'asc' ? 'ascending' : 'descending') : 'none'}
      >
        <span>{label}</span>
        {isActive ? (
          dir === 'asc' ? (
            <ArrowUp size={12} className="text-accent" />
          ) : (
            <ArrowDown size={12} className="text-accent" />
          )
        ) : (
          <ArrowUpDown size={12} className="text-ink-subtle opacity-0 group-hover:opacity-100 transition-opacity" />
        )}
      </button>
    </ColumnHeaderTh>
  );
}

function Stat({
  label,
  value,
  prefix,
  chip,
  accent,
  onClick,
  active,
}: {
  label: string;
  value: string;
  prefix?: string;
  chip?: { text: string; tone: string };
  accent?: 'green';
  /** When provided, the card becomes a button (keyboard focusable + hover
   *  affordance). Use for cards that drill into a deeper view. */
  onClick?: () => void;
  /** Render the card with a pressed / open visual state — used when the
   *  drill-down panel is currently expanded. */
  active?: boolean;
}) {
  const interactive = !!onClick;
  const className = cn(
    'rounded-lg border px-2.5 sm:px-3 py-1.5 sm:py-2 text-start',
    !interactive && 'bg-elevated border-line-subtle',
    interactive && !active && 'bg-elevated border-line-subtle hover:border-accent/40 hover:bg-accent/[0.02] transition-colors cursor-pointer',
    interactive && active && 'bg-accent/[0.04] border-accent/40 ring-1 ring-accent/20 cursor-pointer',
  );
  const content = (
    <>
      <div className="text-[10px] sm:text-xs text-ink-muted leading-tight">{label}</div>
      <div className="flex items-baseline gap-1 mt-0.5">
        {prefix && (
          <span className="text-[10px] text-ink-muted font-medium shrink-0">{prefix}</span>
        )}
        <span
          className={cn(
            'font-semibold tabular-nums leading-tight',
            'text-sm sm:text-base',
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
    </>
  );
  if (interactive) {
    return (
      <button type="button" onClick={onClick} aria-pressed={active} className={className}>
        {content}
      </button>
    );
  }
  return <div className={className}>{content}</div>;
}
