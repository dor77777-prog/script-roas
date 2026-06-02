'use client';

import { useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import useSWR from 'swr';
import { Button } from '@/components/ui/Button';
import {
  ExternalLink,
  Layers,
  ArrowUp,
  ArrowDown,
  ArrowUpDown,
  CheckCircle2,
  Circle,
  Maximize2,
  Minimize2,
  AlertTriangle,
  RefreshCw,
} from 'lucide-react';
import { cn, formatCurrency, formatNumber } from '@/lib/utils';
import { fmtMoney, fmtMoneyString } from '@/lib/format';
import { roasLabel } from '@/lib/analytics';
import type { AdsResponse } from '@/app/api/ads/route';
import type { OrdersAttributionResponse } from '@/app/api/orders-attribution/route';
import { analyzeAttributionForAd, analyzeFirstClickForAd } from '@/lib/attributionAnalysis';
import { firstClickDelta } from '@/components/firstClickDelta';
import { FirstClickCoverageChip } from '@/components/FirstClickCoverageChip';
import { buildAdsManagerLink, type AdAccountMap } from '@/lib/campaignsLinks';
import { readOptimized, toggleOptimized } from '@/lib/campaignOptimized';
import { useDrawerEsc } from '@/lib/drawerStack';
import { buildDateRangeKey } from '@/lib/dateRange';
import { Heading } from '@/components/ui/Typography';
import { Sheet, SheetContent, SheetHeader, SheetBody } from '@/components/ui/Sheet';
import { Badge, BADGE_TONE_BG, type BadgeTone } from '@/components/ui/Badge';
import { HelpTooltip } from '@/components/ui/Tooltip';
import { Stat } from '@/components/ui/Stat';
import { TableBase } from '@/components/ui/TableBase';

/**
 * Slide-in drawer that opens when the user clicks an ad-set row in the
 * campaigns table (or in the CampaignDrawer's ad-sets section). Shows
 * every ad inside the chosen ad-set with spend / value / ROAS / conversions,
 * sortable, with the same optimization-mark toggle as the parent surfaces.
 *
 * Data is fetched lazily — /api/ads is only hit when the drawer opens, so
 * users who never drill into ads never pay the ad-level query cost.
 */

type Props = {
  open: boolean;
  onClose: () => void;
  /** Filter scope — the drawer fetches all ads then narrows by these. */
  storeId: string;
  platform: 'Meta' | 'Google' | 'TikTok';
  campaignId: string;
  adSetId: string;
  adSetName: string;
  rangeFrom: string;
  rangeTo: string;
  adAccounts: AdAccountMap;
};

type AdSortKey = 'name' | 'spend' | 'value' | 'roas' | 'conversions' | 'impressions' | 'clicks';
type AdSortDir = 'asc' | 'desc';

// Task 5.7 (P0-9) — surface API failures instead of masking as empty.
// Pre-fix returned `{ rows: [] }` on !r.ok which made a real 500/4xx
// look identical to "the ad-set legitimately has no ads in range" —
// the operator stared at an empty list, blamed the data pipeline,
// re-ran the cron, and called it a day. Now the fetcher throws so
// SWR's `error` state activates and the drawer renders an explicit
// error UI with a retry control.
const fetcher = async (url: string): Promise<AdsResponse> => {
  const r = await fetch(url, { cache: 'no-store' });
  if (!r.ok) throw new Error(`AdsDrawer: ${r.status} ${r.statusText}`);
  return r.json();
};

export function AdsDrawer({
  open,
  onClose,
  storeId,
  platform,
  campaignId,
  adSetId,
  adSetName,
  rangeFrom,
  rangeTo,
  adAccounts,
}: Props) {
  // FIX-04 (5.2.2.1): range-keyed SWR for orders-attribution. Without ?from=&to=, the server defaults to 90 days and the drawer sees zero matched orders for any older date.
  const drawerRange = { from: rangeFrom, to: rangeTo };
  // FIX-07 (5.2.2.1): range-keyed SWR for /api/ads. Server now filters by range; cache key per range prevents drawer-to-drawer cache pollution.
  const adsBaseKey = open ? buildDateRangeKey('/api/ads', drawerRange) : null;
  const { data, isLoading, error, mutate } = useSWR<AdsResponse>(
    adsBaseKey,
    fetcher,
    { revalidateOnFocus: false, dedupingInterval: 60_000 },
  );
  // Per-order attribution for the deterministic ROAS chip per ad. Lazy: only
  // fires when this drawer opens so users who never drill into ads don't pay
  // the orders-attribution sheet read.
  const ordersAttrBaseKey = open ? buildDateRangeKey('/api/orders-attribution', drawerRange) : null;
  // Task 5.7 (P0-9) — same throw-on-error contract as the primary ads
  // fetcher. Orders-attribution is non-critical (drives the "ROAS
  // Shopify" per-ad chip + tooltip); if it 4xx/5xx we don't want to
  // block the whole drawer, just degrade the chip silently. So we
  // catch the throw here and fall back to an empty rows array — the
  // chip column renders "—" instead. The primary fetcher above still
  // surfaces ITS errors because losing the ads list IS critical.
  const { data: ordersAttrData } = useSWR<OrdersAttributionResponse>(
    ordersAttrBaseKey,
    async (url: string) => {
      const r = await fetch(url, { cache: 'no-store' });
      if (!r.ok) {
        // Degrade silently — no rows means deterministic ROAS chips
        // render "—" but the primary ad list is unaffected.
        return { rows: [], lastUpdated: new Date().toISOString() };
      }
      return r.json();
    },
    { revalidateOnFocus: false, dedupingInterval: 60_000 },
  );

  const [sortKey, setSortKey] = useState<AdSortKey>('spend');
  const [sortDir, setSortDir] = useState<AdSortDir>('desc');
  // Mirror CampaignDrawer's fullscreen toggle so the ad-level drilldown can
  // also expand edge-to-edge for inspection of long ad lists / tables.
  // Persisted under a separate `drawer:ad:fullscreen` key so the operator
  // can prefer fullscreen ads without forcing fullscreen on the parent
  // CampaignDrawer (and vice-versa).
  const [isFullscreen, setIsFullscreen] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    try {
      return window.localStorage.getItem('drawer:ad:fullscreen') === 'true';
    } catch {
      return false;
    }
  });
  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      window.localStorage.setItem('drawer:ad:fullscreen', String(isFullscreen));
    } catch {
      // ignore — see CampaignDrawer for the same fallback rationale
    }
  }, [isFullscreen]);
  function handleSort(key: AdSortKey) {
    if (key === sortKey) {
      setSortDir(d => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir('desc');
    }
  }

  // Shared optimization marks with the rest of the dashboard.
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

  // Esc closes ONLY this drawer when it's on top of the stack. Coordinated
  // via the shared drawer stack so a nested drawer over CampaignDrawer
  // doesn't collapse both surfaces in one keystroke (#WR-01).
  useDrawerEsc(open, onClose);

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, [open]);

  // Aggregate the in-scope rows by ad. Multiple days → one row per ad with
  // summed metrics. The drawer's range mirrors the CampaignsTable's local
  // range so totals line up with the spend the user just saw on the ad-set
  // row.
  const summary = useMemo(() => {
    if (!data?.rows) return null;
    const byAd = new Map<string, {
      adId: string;
      adName: string;
      campaignId: string;
      campaignName: string;
      adSetId: string;
      adSetName: string;
      platform: string;
      storeId: string;
      spend: number;
      value: number;
      clicks: number;
      impressions: number;
      conversions: number;
    }>();
    for (const r of data.rows) {
      // d/HI-04 (audit 2026-05-23): date filter RESTORED for defensive
      // consistency with `dailyMetaByAd` below — both useMemos walk the
      // same `data.rows`, and the `summary` deps array already includes
      // rangeFrom/rangeTo, so removing the actual filter while keeping
      // the deps was a foot-gun (any future range change re-ran the memo
      // but didn't actually narrow). The server-side filter in
      // fetchAdsData({ range }) is still the primary defense; this is
      // belt-and-suspenders so the two memos can't drift out of sync
      // (which silently produces different ad totals vs daily series).
      // The original FIX-07 (5.2.2.1) note about server-side filtering
      // is still true — this line just keeps the client-side guard
      // symmetric with dailyMetaByAd.
      if (r.date < rangeFrom || r.date > rangeTo) continue;
      if (r.platform !== platform) continue;   // FIX-11 (5.2.2.1): prevent cross-platform rows from sharing an ad drawer scope.
      if (r.storeId !== storeId) continue;
      if (r.campaignId !== campaignId) continue;
      if (r.adSetId !== adSetId) continue;
      const k = r.adId || r.adName;
      if (!byAd.has(k)) {
        byAd.set(k, {
          adId: r.adId,
          adName: r.adName,
          campaignId: r.campaignId,
          campaignName: r.campaignName,
          adSetId: r.adSetId,
          adSetName: r.adSetName,
          platform: r.platform,
          storeId: r.storeId,
          spend: 0, value: 0, clicks: 0, impressions: 0, conversions: 0,
        });
      }
      const a = byAd.get(k)!;
      a.spend += r.spend;
      a.value += r.conversionValue;
      a.clicks += r.clicks;
      a.impressions += r.impressions;
      a.conversions += r.conversions;
    }
    const ads = Array.from(byAd.values()).map(a => ({
      ...a,
      roas: a.spend > 0 ? a.value / a.spend : 0,
    }));
    let spend = 0, value = 0, conversions = 0;
    for (const a of ads) {
      spend += a.spend;
      value += a.value;
      conversions += a.conversions;
    }
    return {
      ads,
      totals: {
        spend, value, conversions,
        roas: spend > 0 ? value / spend : 0,
      },
    };
  }, [data, storeId, platform, campaignId, adSetId, rangeFrom, rangeTo]);

  // Per-ad daily Meta conv-value series. Required by analyzeAttributionForAd →
  // computeWindowStability / detectOutlierDays; without it those features
  // silently no-op at the ad level. Keyed by `adId || adName` to match the
  // summary aggregation. Built in useMemo so the walk over data.rows happens
  // only on data/range changes, not every render. (WR5-03)
  const dailyMetaByAd = useMemo(() => {
    const buckets = new Map<string, Map<string, number>>();
    if (!data?.rows) return new Map<string, Array<{ date: string; value: number }>>();
    for (const r of data.rows) {
      if (r.platform !== platform) continue;   // FIX-11 (5.2.2.1): keep daily attribution series on the same ad platform.
      if (r.date < rangeFrom || r.date > rangeTo) continue;
      if (r.storeId !== storeId) continue;
      if (r.campaignId !== campaignId) continue;
      if (r.adSetId !== adSetId) continue;
      const k = r.adId || r.adName;
      let b = buckets.get(k);
      if (!b) {
        b = new Map<string, number>();
        buckets.set(k, b);
      }
      b.set(r.date, (b.get(r.date) ?? 0) + r.conversionValue);
    }
    const out = new Map<string, Array<{ date: string; value: number }>>();
    for (const [k, byDate] of buckets) {
      out.set(k, Array.from(byDate, ([date, value]) => ({ date, value })));
    }
    return out;
  }, [data, storeId, platform, campaignId, adSetId, rangeFrom, rangeTo]);

  // Per-ad attribution analysis. Pre-computes once per orders/summary change
  // rather than calling analyzeAttributionForAd inside the row IIFE per render
  // (each call walks the full orders array + runs Bayesian / window stability
  // / outlier z-scores; not free). (IN5-01)
  const attributionByAd = useMemo(() => {
    const out = new Map<string, ReturnType<typeof analyzeAttributionForAd>>();
    if (!summary) return out;
    const ordersRows = ordersAttrData?.rows ?? [];
    if (ordersRows.length === 0) return out;
    for (const a of summary.ads) {
      const key = a.adId || a.adName;
      out.set(key, analyzeAttributionForAd(
        {
          adId: a.adId,
          adName: a.adName,
          storeId: a.storeId,
          platform: a.platform,
          metaClaim: a.value,
          spend: a.spend,
        },
        ordersRows,
        rangeFrom,
        rangeTo,
        dailyMetaByAd.get(key) ?? [],
      ));
    }
    return out;
  }, [summary, ordersAttrData, rangeFrom, rangeTo, dailyMetaByAd]);

  // Plan C (Phase 4) — per-ad first-click analysis, keyed exactly like
  // attributionByAd (`adId || adName`) so the cell looks it up O(1). Reuses the
  // same summary / orders / range the deterministic memo already holds.
  // Google-blind by construction (analyzeFirstClickForAd returns null for
  // non-Meta/TikTok platforms; no Google rows at ad grain).
  const firstClickByAd = useMemo(() => {
    const out = new Map<string, ReturnType<typeof analyzeFirstClickForAd>>();
    if (!summary) return out;
    const ordersRows = ordersAttrData?.rows ?? [];
    if (ordersRows.length === 0) return out;
    for (const a of summary.ads) {
      out.set(
        a.adId || a.adName,
        analyzeFirstClickForAd(
          {
            adId: a.adId,
            adName: a.adName,
            storeId: a.storeId,
            platform: a.platform,
            spend: a.spend,
          },
          ordersRows,
          rangeFrom,
          rangeTo,
        ),
      );
    }
    return out;
  }, [summary, ordersAttrData, rangeFrom, rangeTo]);

  if (!open) return null;
  // Defensive guard. CampaignDrawer and CampaignsTable BOTH pass
  // localRange.from / localRange.to (the toolbar's date range) directly
  // as required props — neither caller derives the range from rows
  // anymore. IN-02 (5.2.2.1): the old comment described a deprecated
  // `rows.reduce(..., rows[0]?.date ?? '')` derivation that no longer
  // exists. Today's contract is "callers pass real ISO strings"; the
  // guard below stays useful as defense-in-depth for future callers
  // that might pass empty strings instead of erroring out. If
  // rangeFrom is '', every `r.date < rangeFrom || r.date > rangeTo`
  // check below would silently exclude EVERY ad (every non-empty ISO
  // date is lexicographically > ''). Bail loudly instead.
  if (!rangeFrom || !rangeTo) return null;

  const sortedAds = summary
    ? (() => {
        const list = [...summary.ads];
        const sign = sortDir === 'asc' ? 1 : -1;
        list.sort((x, y) => {
          switch (sortKey) {
            case 'name':
              return sign * (x.adName || '').localeCompare(y.adName || '', 'he');
            case 'spend':
              return sign * (x.spend - y.spend);
            case 'value':
              return sign * (x.value - y.value);
            case 'roas':
              return sign * (x.roas - y.roas);
            case 'conversions':
              return sign * (x.conversions - y.conversions);
            case 'impressions':
              return sign * (x.impressions - y.impressions);
            case 'clicks':
              return sign * (x.clicks - y.clicks);
          }
        });
        return list;
      })()
    : [];
  const totalsInfo = summary ? roasLabel(summary.totals.roas) : null;

  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()}>
      <SheetContent
        side="end"
        dir="rtl"
        onEscapeKeyDown={(e) => e.preventDefault()}
        aria-labelledby="ads-drawer-title"
        // Wave-4 Task 4.3 — the AdsDrawer opens OVER the centered Campaign
        // modal. Both Sheets portal to <body> and the ads portal mounts later
        // (so it's after the modal in DOM order), but we ALSO lift the ads
        // overlay + content to z-[60] so the modal's z-50 scrim can never
        // cover the ad-level drilldown regardless of portal ordering. The
        // modal dims behind this drawer + its own scrim.
        overlayClassName="z-[60]"
        className={cn(
          // Wave-6 Task 6.1 — drawer fullscreen toggle animates over
          // --motion-large (480 ms) so the width morph reads as a
          // deliberate state change instead of a snap. We transition
          // max-width specifically (the only property that flips between
          // the two width modes). prefers-reduced-motion collapses it
          // via the project-wide rule in globals.css.
          //
          // 2026-05-31 widened default 640 → 820px after operator feedback
          // that the ad list felt cramped (impressions/clicks columns
          // force the table into horizontal scroll at 640px). 820px keeps
          // the AdsDrawer narrower than the parent CampaignDrawer (880px)
          // so the nested drilldown reads as a sibling, not an equal.
          'z-[60] flex flex-col p-0 transition-[max-width] duration-large ease-out',
          !isFullscreen && 'w-full sm:max-w-[820px]',
          isFullscreen && 'w-full sm:w-full max-w-full',
        )}
      >
        {/* pe-10 reserves space for the Sheet primitive's auto-injected
            close X (positioned at `end-3 top-3`, ~32 px) so the maximize
            button never sits underneath it. Matches CampaignDrawer. */}
        <SheetHeader className="flex items-center justify-between gap-3 py-3 sm:px-5 pe-10">
          <div className="min-w-0 flex items-center gap-2.5">
            <span className="inline-flex items-center justify-center w-8 h-8 rounded-lg bg-accent-soft text-accent shrink-0">
              <Layers size={16} />
            </span>
            <div className="min-w-0">
              {/* Hebrew "מודעות ב-" + LTR English "ad-set" literal. Wrap the
                  LTR fragment in <bdi> so bidi reordering doesn't pull
                  "ad-set" out of position within the header chip. */}
              <div className="text-[10px] uppercase tracking-[0.12em] font-semibold text-ink-muted">
                מודעות ב-<bdi dir="ltr">ad-set</bdi>
              </div>
              <HelpTooltip content={adSetName}>
                <Heading level="section" id="ads-drawer-title" className="font-bold truncate">
                  {/* Ad-set name is LTR English; isolate so it can't be
                      reordered against the surrounding RTL drawer chrome. */}
                  <bdi dir="ltr">{adSetName}</bdi>
                </Heading>
              </HelpTooltip>
            </div>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setIsFullscreen(v => !v)}
              aria-label={isFullscreen ? 'כווץ למגירה' : 'הרחב למסך מלא'}
              title={isFullscreen ? 'כווץ למגירה' : 'הרחב למסך מלא'}
              data-testid="ads-drawer-fullscreen-toggle"
            >
              {isFullscreen ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
            </Button>
          </div>
        </SheetHeader>

        <SheetBody className="sm:px-5 space-y-4">
          {isLoading && !error && (
            <div className="text-center text-sm text-ink-muted py-10">
              טוען נתוני מודעות…
            </div>
          )}

          {/* Task 5.7 (P0-9) — explicit error UI. Replaces the pre-fix
              behavior where the fetcher swallowed !r.ok and returned
              `{ rows: [] }` → identical to a legitimate empty list →
              operator silently mis-diagnosed the API as healthy. */}
          {error && (
            <div
              role="alert"
              data-testid="ads-drawer-error"
              className="rounded-xl border border-status-red bg-status-redBg text-status-redFg px-4 py-4 mx-1"
            >
              <div className="flex items-start gap-2.5">
                <AlertTriangle size={18} className="shrink-0 mt-0.5" />
                <div className="min-w-0 flex-1">
                  <div className="font-semibold text-[13px]">
                    שגיאה בטעינת מודעות
                  </div>
                  <div className="text-[11px] opacity-80 mt-1 leading-relaxed">
                    הקריאה ל-<code className="font-mono">/api/ads</code> נכשלה.
                    זה לא אומר שאין מודעות — זה אומר שהשרת לא ענה.
                    נסה לרענן, ואם זה לא עוזר בדוק את הלוגים.
                  </div>
                  <div className="text-[10px] opacity-60 mt-1 font-mono">
                    {error instanceof Error ? error.message : String(error)}
                  </div>
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => mutate()}
                    className="mt-3 gap-1.5 text-[12px]"
                  >
                    <RefreshCw size={12} />
                    נסה שוב
                  </Button>
                </div>
              </div>
            </div>
          )}

          {!isLoading && !error && (!summary || summary.ads.length === 0) && (
            <div className="text-center py-10 text-ink-muted">
              <Layers size={28} className="mx-auto mb-2 text-ink-subtle" />
              <div className="text-sm">אין נתוני מודעות לטווח הזה.</div>
              <div className="text-[11px] mt-1 leading-relaxed">
                ודא ש-<code className="font-mono">runDailyUpdate</code>{' '}
                רץ לפחות פעם אחת מאז שהפיצ&apos;ר נפרס.
              </div>
            </div>
          )}

          {!error && summary && summary.ads.length > 0 && (
            <>
              {/* Totals strip — quick reference vs the parent ad-set values */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                <Stat label="הוצאה" value={fmtMoney(summary.totals.spend)} />
                <Stat label="ערך" value={fmtMoney(summary.totals.value)} accent="positive" />
                <Stat
                  label="ROAS"
                  value={summary.totals.roas > 0 ? formatNumber(summary.totals.roas) : '—'}
                  chip={totalsInfo ? <Badge tone={totalsInfo.tone as BadgeTone}>{totalsInfo.text}</Badge> : undefined}
                />
                <Stat label="המרות" value={formatNumber(summary.totals.conversions, 0)} />
              </div>

              {/* Horizontal scroll on narrow drawers — the extra impressions/
                  clicks columns make the table wider than the panel. */}
              {/* overflow-auto + max-h turns this into a real scrolling box
                  so the sticky thead actually has a vertical scroll context
                  to stick within. Drawer body already scrolls, but the inner
                  overflow-x-auto we used to have here scoped sticky to a
                  wrapper that didn't scroll vertically. */}
              <div className="rounded-xl border border-glass-edge overflow-auto max-h-[60vh]">
                <TableBase className="text-xs sm:text-sm" minWidth={720} stickyHeader>
                  <thead>
                    <tr className="text-ink-secondary">
                      <th className="px-2 py-2 w-[36px]" aria-label="סימון" />
                      <AdSortHeader label="מודעה"     col="name"        sortKey={sortKey} dir={sortDir} onClick={handleSort} align="start"  />
                      <AdSortHeader label="הוצאה"     col="spend"       sortKey={sortKey} dir={sortDir} onClick={handleSort} align="end"    />
                      <AdSortHeader label="ערך"       col="value"       sortKey={sortKey} dir={sortDir} onClick={handleSort} align="end"    />
                      <AdSortHeader
                        label={
                          <span className="inline-flex flex-col items-center leading-tight">
                            <span>ROAS</span>
                            <span className="text-[9px] text-ink-muted font-normal">מכוון · directional</span>
                          </span>
                        }
                        col="roas"
                        sortKey={sortKey}
                        dir={sortDir}
                        onClick={handleSort}
                        align="center"
                      />
                      <th className="font-medium px-3 py-2 text-center text-ink-secondary">
                        <HelpTooltip content="ROAS אמיתי לפי click-id (utm_content={{ad.id}})">
                          <span>ROAS Shopify</span>
                        </HelpTooltip>
                      </th>
                      <th className="font-medium px-3 py-2 text-center text-ink-secondary opacity-80">
                        <HelpTooltip content="ROAS לפי first-click (utm_content={{ad.id}} מהמגע הראשון). מבוא ללקוח, לא רק סגירה. עיוור ל-Google. כיסוי <= last-click.">
                          <span>first-click</span>
                        </HelpTooltip>
                      </th>
                      <AdSortHeader label="המרות"     col="conversions" sortKey={sortKey} dir={sortDir} onClick={handleSort} align="end"    />
                      <AdSortHeader label="חשיפות"    col="impressions" sortKey={sortKey} dir={sortDir} onClick={handleSort} align="end"    />
                      <AdSortHeader label="קליקים"    col="clicks"      sortKey={sortKey} dir={sortDir} onClick={handleSort} align="end"    />
                      <th className="px-2 py-2 w-[40px]" aria-label="פעולות" />
                    </tr>
                  </thead>
                  <tbody>
                    {sortedAds.map((a, i) => {
                      const info = roasLabel(a.roas);
                      // Composite key includes adId so ad-level marks don't
                      // collide with ad-set-level marks.
                      const markKey = `${a.storeId}::${a.platform}::${a.campaignId}::${a.adSetId}::${a.adId}`;
                      const isOptimized = optimized.has(markKey);
                      const link = buildAdsManagerLink({
                        platform: a.platform,
                        storeId: a.storeId,
                        campaignId: a.campaignId,
                        adSetId: a.adSetId,
                        adId: a.adId,
                        accounts: adAccounts,
                      });
                      return (
                        <tr
                          key={a.adId || a.adName || i}
                          className={cn(
                            'border-t border-glass-edge transition-opacity',
                            isOptimized && 'opacity-50 hover:opacity-100',
                          )}
                        >
                          <td className="px-2 py-2 text-center w-[36px]">
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              onClick={e => {
                                // Defensive stopPropagation: no parent row
                                // onClick exists today, but matching the
                                // CampaignDrawer / CampaignsTable pattern keeps
                                // the toggle safe if a row-click is added.
                                e.stopPropagation();
                                onToggle(markKey);
                              }}
                              className={cn(
                                'w-7 h-7 rounded-full',
                                isOptimized
                                  ? 'text-status-greenFg hover:bg-status-greenBg'
                                  : 'text-ink-muted hover:text-status-greenFg hover:bg-status-greenBg',
                              )}
                              title={isOptimized ? 'לחץ להסרת הסימון' : 'סמן כאופטימיזציה בוצעה'}
                              aria-pressed={isOptimized}
                            >
                              {isOptimized ? <CheckCircle2 size={16} /> : <Circle size={16} />}
                            </Button>
                          </td>
                          <HelpTooltip content={a.adName}>
                            <td className="px-3 py-2 text-ink truncate max-w-[220px]">
                              {/* Ad name (English/LTR) inside an RTL drawer
                                  table — isolate so bidi can't shuffle
                                  alphanumeric runs against neighbour cells. */}
                              <bdi dir="ltr">{a.adName}</bdi>
                            </td>
                          </HelpTooltip>
                          <td className="px-3 py-2 text-end tabular-nums">{formatCurrency(a.spend)}</td>
                          <td className={cn('px-3 py-2 text-end tabular-nums', a.value > a.spend && 'text-status-greenFg font-medium')}>
                            {formatCurrency(a.value)}
                          </td>
                          <td className={cn('px-3 py-2 text-center font-semibold tabular-nums rounded', BADGE_TONE_BG[info.tone as keyof typeof BADGE_TONE_BG])}>
                            {a.roas > 0 ? formatNumber(a.roas) : '—'}
                          </td>
                          {/* Deterministic ROAS per ad via utm_content. */}
                          <td className="px-3 py-2 text-center">
                            {(() => {
                              // Look up the pre-computed analysis instead of
                              // re-running per cell per render. (IN5-01)
                              const adAttr = attributionByAd.get(a.adId || a.adName) ?? null;
                              if (!adAttr) {
                                return <span className="text-ink-muted text-xs">—</span>;
                              }
                              const detRoas = a.spend > 0
                                ? adAttr.deterministicRevenue / a.spend
                                : 0;
                              const tone =
                                adAttr.trust.level === 'high'    ? 'bg-status-greenBg text-status-greenFg'
                              : adAttr.trust.level === 'medium'  ? 'bg-status-warningBg text-status-warningFg'
                              : adAttr.trust.level === 'unknown' ? 'bg-glass-2 text-ink-secondary'
                              :                                    'bg-status-redBg text-status-redFg';
                              const tooltip =
                                `ROAS אמיתי · ${adAttr.trust.label} (${adAttr.trust.score.toFixed(0)}/100)\n\n` +
                                `Meta דיווח: ${fmtMoneyString(a.value)}\n` +
                                `click-id מתויג: ${fmtMoneyString(adAttr.deterministicRevenue)} (${adAttr.deterministicOrders} הזמנות)\n` +
                                `modeled: ${fmtMoneyString(adAttr.modeledRevenue)}\n\n` +
                                adAttr.reasons.map(r => `• ${r}`).join('\n') +
                                `\n\n💡 ${adAttr.recommendation}`;
                              return (
                                <HelpTooltip content={tooltip}>
                                  <div className="inline-flex flex-col items-center gap-0.5">
                                    <span className="font-semibold tabular-nums text-ink">
                                      {detRoas > 0 ? formatNumber(detRoas) : '—'}
                                    </span>
                                    <span className={cn('inline-block text-[8px] font-bold px-1 py-0 rounded uppercase tracking-wider', tone)}>
                                      {adAttr.trust.label}
                                    </span>
                                  </div>
                                </HelpTooltip>
                              );
                            })()}
                          </td>
                          {/* Plan C (Phase 4) — first-click ROAS + delta beside
                              last-click "ROAS Shopify". ~80% prominence; delta
                              on hover; coverage chip. Google-blind + floor
                              caveats in the tooltip. */}
                          <td className="px-3 py-2 text-center" data-testid={`first-click-roas-${a.adId || a.adName}`}>
                            {(() => {
                              const fc = firstClickByAd.get(a.adId || a.adName) ?? null;
                              const adAttr = attributionByAd.get(a.adId || a.adName) ?? null;
                              if (!fc) return <span className="text-ink-muted text-xs">—</span>;
                              const lastClickRoas = a.spend > 0 && adAttr
                                ? adAttr.deterministicRevenue / a.spend
                                : 0;
                              const d = firstClickDelta(fc.firstClickRoas, lastClickRoas);
                              const tooltip =
                                `first-click ROAS: ${fc.firstClickRoas.toFixed(2)}x (${fc.firstClickOrders} הזמנות)\n` +
                                `last-click ROAS Shopify: ${lastClickRoas.toFixed(2)}x\n` +
                                (d ? `delta: ${d.label}\n` : '') +
                                '\nfirst-click = המגע הראשון. עיוור ל-Google. כיסוי <= last-click.';
                              return (
                                <HelpTooltip content={tooltip}>
                                  <div className="inline-flex flex-col items-center gap-0.5 opacity-80">
                                    <span className="font-medium tabular-nums text-ink">
                                      {fc.firstClickRoas > 0 ? formatNumber(fc.firstClickRoas) : '—'}
                                    </span>
                                    {d && (
                                      <span className={cn(
                                        'text-[10px] font-semibold tabular-nums',
                                        d.direction === 'up'   ? 'text-status-greenFg'
                                      : d.direction === 'down' ? 'text-status-redFg'
                                      :                          'text-ink-muted',
                                      )}>
                                        <bdi dir="ltr">{d.label}</bdi>
                                      </span>
                                    )}
                                    <FirstClickCoverageChip
                                      firstClickOrders={fc.firstClickOrders}
                                      lastClickOrders={adAttr ? adAttr.deterministicOrders : 0}
                                    />
                                  </div>
                                </HelpTooltip>
                              );
                            })()}
                          </td>
                          <td className="px-3 py-2 text-end tabular-nums">{formatNumber(a.conversions, 0)}</td>
                          <td className="px-3 py-2 text-end tabular-nums text-ink-secondary">
                            {formatNumber(a.impressions, 0)}
                          </td>
                          <td className="px-3 py-2 text-end tabular-nums text-ink-secondary">
                            {formatNumber(a.clicks, 0)}
                          </td>
                          <td className="px-2 py-2 text-center w-[40px]">
                            {link && (
                              <HelpTooltip content="פתח את המודעה במנהל מודעות">
                                <a
                                  href={link}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="inline-flex items-center justify-center w-7 h-7 rounded text-ink-muted hover:text-accent hover:bg-accent-bg transition-colors"
                                  aria-label="פתח את המודעה במנהל מודעות"
                                >
                                  <ExternalLink size={14} />
                                </a>
                              </HelpTooltip>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </TableBase>
              </div>
            </>
          )}

          <div className="text-[10px] text-ink-muted text-center pt-2">
            לחץ Esc או על הרקע לסגירה
          </div>
        </SheetBody>
      </SheetContent>
    </Sheet>
  );
}

// Local Stat fork removed in Wave-2 Task 2.3 — unified into
// `@/components/ui/Stat` (density / prefix / chip / active / delta).

function AdSortHeader({
  label,
  col,
  sortKey,
  dir,
  onClick,
  align,
}: {
  label: ReactNode;
  col: AdSortKey;
  sortKey: AdSortKey;
  dir: AdSortDir;
  onClick: (key: AdSortKey) => void;
  align: 'start' | 'center' | 'end';
}) {
  const isActive = col === sortKey;
  const justify =
    align === 'start' ? 'justify-start' : align === 'end' ? 'justify-end' : 'justify-center';
  const textAlign =
    align === 'start' ? 'text-start' : align === 'end' ? 'text-end' : 'text-center';
  return (
    <th className={cn('font-medium px-3 py-2', textAlign)}>
      <Button
        type="button"
        variant="ghost"
        onClick={() => onClick(col)}
        className={cn(
          'gap-1 select-none cursor-pointer w-full h-auto p-0',
          justify,
          isActive
            ? 'text-accent font-semibold'
            : 'text-ink-secondary hover:text-ink',
        )}
        aria-sort={isActive ? (dir === 'asc' ? 'ascending' : 'descending') : 'none'}
      >
        <span>{label}</span>
        {isActive ? (
          dir === 'asc' ? <ArrowUp size={12} className="text-accent" /> : <ArrowDown size={12} className="text-accent" />
        ) : (
          <ArrowUpDown size={12} className="opacity-0 group-hover:opacity-60 transition-opacity" />
        )}
      </Button>
    </th>
  );
}
