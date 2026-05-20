'use client';

import { useEffect, useMemo, useState } from 'react';
import useSWR from 'swr';
import {
  X,
  ExternalLink,
  Layers,
  ArrowUp,
  ArrowDown,
  ArrowUpDown,
  CheckCircle2,
  Circle,
  Maximize2,
  Minimize2,
} from 'lucide-react';
import { cn, formatCurrency, formatNumber } from '@/lib/utils';
import { roasLabel } from '@/lib/analytics';
import type { AdRow } from '@/lib/ads';
import type { AdsResponse } from '@/app/api/ads/route';
import type { OrdersAttributionResponse } from '@/app/api/orders-attribution/route';
import { analyzeAttributionForAd } from '@/lib/attributionAnalysis';
import { buildAdsManagerLink, type AdAccountMap } from '@/lib/campaignsLinks';
import { readOptimized, toggleOptimized } from '@/lib/campaignOptimized';
import { useDrawerEsc } from '@/lib/drawerStack';
import { buildDateRangeKey } from '@/lib/dateRange';

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
  platform: 'Meta' | 'Google';
  campaignId: string;
  adSetId: string;
  adSetName: string;
  rangeFrom: string;
  rangeTo: string;
  adAccounts: AdAccountMap;
};

const TONE_BG: Record<string, string> = {
  red:    'bg-roas-redBg text-roas-red',
  orange: 'bg-roas-orangeBg text-roas-orange',
  green:  'bg-roas-greenBg text-roas-green',
  blue:   'bg-roas-blueBg text-roas-blue',
  gray:   'bg-surfaceMuted text-text-muted',
};

type AdSortKey = 'name' | 'spend' | 'value' | 'roas' | 'conversions' | 'impressions' | 'clicks';
type AdSortDir = 'asc' | 'desc';

const fetcher = async (url: string): Promise<AdsResponse> => {
  const r = await fetch(url);
  if (!r.ok) return { rows: [], lastUpdated: new Date().toISOString() };
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
  const { data, isLoading } = useSWR<AdsResponse>(
    adsBaseKey,
    fetcher,
    { revalidateOnFocus: false, dedupingInterval: 60_000 },
  );
  // Per-order attribution for the deterministic ROAS chip per ad. Lazy: only
  // fires when this drawer opens so users who never drill into ads don't pay
  // the orders-attribution sheet read.
  const ordersAttrBaseKey = open ? buildDateRangeKey('/api/orders-attribution', drawerRange) : null;
  const { data: ordersAttrData } = useSWR<OrdersAttributionResponse>(
    ordersAttrBaseKey,
    async (url: string) => {
      const r = await fetch(url);
      if (!r.ok) return { rows: [], lastUpdated: new Date().toISOString() };
      return r.json();
    },
    { revalidateOnFocus: false, dedupingInterval: 60_000 },
  );

  const [sortKey, setSortKey] = useState<AdSortKey>('spend');
  const [sortDir, setSortDir] = useState<AdSortDir>('desc');
  // Mirror CampaignDrawer's fullscreen toggle so the ad-level drilldown can
  // also expand edge-to-edge for inspection of long ad lists / tables.
  const [isFullscreen, setIsFullscreen] = useState(false);
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
      // FIX-07 (5.2.2.1): date filter removed — /api/ads now filters by range server-side via fetchAdsData({ range }).
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

  if (!open) return null;
  // Defensive guard: CampaignDrawer derives rangeFrom/rangeTo via
  // `rows.reduce(..., rows[0]?.date ?? '')`, which returns '' if rows is empty.
  // CampaignDrawer currently short-circuits when `rows.length === 0`
  // (summary is null), so AdsDrawer never sees empty strings today — but if
  // that guard is ever relaxed, the `r.date < rangeFrom || r.date > rangeTo`
  // filter below would silently exclude EVERY ad (every non-empty ISO date is
  // lexicographically > ''). Bail loudly instead. (#IN-01)
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
    <div
      className="fixed inset-0 z-[60] flex animate-fade-in"
      role="dialog"
      aria-modal="true"
      aria-labelledby="ads-drawer-title"
    >
      <div className="absolute inset-0 bg-text-primary/35 backdrop-blur-sm" onClick={onClose} aria-hidden />
      <aside
        dir="rtl"
        className={cn(
          'relative h-full bg-surface shadow-elevated border-s border-borderSubtle flex flex-col animate-slide-in',
          !isFullscreen && 'ms-0 me-auto w-full sm:max-w-[640px]',
          isFullscreen && 'w-full max-w-full',
        )}
      >
        <header className="flex items-center justify-between gap-3 px-4 sm:px-5 py-3 border-b border-borderSubtle">
          <div className="min-w-0 flex items-center gap-2.5">
            <span className="inline-flex items-center justify-center w-8 h-8 rounded-lg bg-primary/10 text-primary shrink-0">
              <Layers size={16} />
            </span>
            <div className="min-w-0">
              <div className="text-[10px] uppercase tracking-[0.12em] font-semibold text-text-muted">
                מודעות ב-ad-set
              </div>
              <h2 id="ads-drawer-title" className="text-sm sm:text-base font-bold text-text-primary tracking-tight truncate" title={adSetName}>
                {adSetName}
              </h2>
            </div>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <button
              onClick={() => setIsFullscreen(v => !v)}
              aria-label={isFullscreen ? 'כווץ למגירה' : 'הרחב למסך מלא'}
              title={isFullscreen ? 'כווץ למגירה' : 'הרחב למסך מלא'}
              className="p-1.5 rounded hover:bg-surfaceMuted text-text-muted hover:text-text-primary transition-colors"
            >
              {isFullscreen ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
            </button>
            <button
              onClick={onClose}
              className="p-1.5 rounded hover:bg-surfaceMuted text-text-muted hover:text-text-primary"
              aria-label="סגור"
            >
              <X size={18} />
            </button>
          </div>
        </header>

        <div className="flex-1 overflow-y-auto p-4 sm:p-5 space-y-4">
          {isLoading && (
            <div className="text-center text-sm text-text-muted py-10">
              טוען נתוני מודעות…
            </div>
          )}

          {!isLoading && (!summary || summary.ads.length === 0) && (
            <div className="text-center py-10 text-text-muted">
              <Layers size={28} className="mx-auto mb-2 text-text-muted/60" />
              <div className="text-sm">אין נתוני מודעות לטווח הזה.</div>
              <div className="text-[11px] mt-1 leading-relaxed">
                ודא ש-<code className="font-mono">runDailyUpdate</code>{' '}
                רץ לפחות פעם אחת מאז שהפיצ&apos;ר נפרס.
              </div>
            </div>
          )}

          {summary && summary.ads.length > 0 && (
            <>
              {/* Totals strip — quick reference vs the parent ad-set values */}
              <div className="grid grid-cols-4 gap-2">
                <Stat label="הוצאה" value={`CAD ${formatCurrency(summary.totals.spend)}`} />
                <Stat label="ערך" value={`CAD ${formatCurrency(summary.totals.value)}`} accent="green" />
                <Stat
                  label="ROAS"
                  value={summary.totals.roas > 0 ? formatNumber(summary.totals.roas) : '—'}
                  chip={totalsInfo}
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
              <div className="rounded-xl border border-borderSubtle overflow-auto max-h-[60vh]">
                <table className="w-full text-xs sm:text-sm min-w-[720px]">
                  <thead className="bg-surfaceMuted/60 sticky top-0 z-10">
                    <tr className="text-text-secondary">
                      <th className="px-2 py-2 w-[36px]" aria-label="סימון" />
                      <AdSortHeader label="מודעה"     col="name"        sortKey={sortKey} dir={sortDir} onClick={handleSort} align="start"  />
                      <AdSortHeader label="הוצאה"     col="spend"       sortKey={sortKey} dir={sortDir} onClick={handleSort} align="end"    />
                      <AdSortHeader label="ערך"       col="value"       sortKey={sortKey} dir={sortDir} onClick={handleSort} align="end"    />
                      <AdSortHeader label="ROAS"      col="roas"        sortKey={sortKey} dir={sortDir} onClick={handleSort} align="center" />
                      <th className="font-medium px-3 py-2 text-center text-text-secondary" title="ROAS אמיתי לפי click-id (utm_content={{ad.id}})">
                        ROAS Shopify
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
                            'border-t border-borderSubtle transition-opacity',
                            isOptimized && 'opacity-50 hover:opacity-100',
                          )}
                        >
                          <td className="px-2 py-2 text-center w-[36px]">
                            <button
                              type="button"
                              onClick={e => {
                                // Defensive stopPropagation: no parent row
                                // onClick exists today, but matching the
                                // CampaignDrawer / CampaignsTable pattern keeps
                                // the toggle safe if a row-click is added.
                                e.stopPropagation();
                                onToggle(markKey);
                              }}
                              className={cn(
                                'inline-flex items-center justify-center w-7 h-7 rounded-full transition-colors',
                                isOptimized
                                  ? 'text-roas-green hover:bg-roas-greenBg/60'
                                  : 'text-text-muted hover:text-roas-green hover:bg-roas-greenBg/40',
                              )}
                              title={isOptimized ? 'לחץ להסרת הסימון' : 'סמן כאופטימיזציה בוצעה'}
                              aria-pressed={isOptimized}
                            >
                              {isOptimized ? <CheckCircle2 size={16} /> : <Circle size={16} />}
                            </button>
                          </td>
                          <td className="px-3 py-2 text-text-primary truncate max-w-[220px]" title={a.adName}>
                            {a.adName}
                          </td>
                          <td className="px-3 py-2 text-end tabular-nums">{formatCurrency(a.spend)}</td>
                          <td className={cn('px-3 py-2 text-end tabular-nums', a.value > a.spend && 'text-roas-green font-medium')}>
                            {formatCurrency(a.value)}
                          </td>
                          <td className={cn('px-3 py-2 text-center font-semibold tabular-nums rounded', TONE_BG[info.tone])}>
                            {a.roas > 0 ? formatNumber(a.roas) : '—'}
                          </td>
                          {/* Deterministic ROAS per ad via utm_content. */}
                          <td className="px-3 py-2 text-center">
                            {(() => {
                              // Look up the pre-computed analysis instead of
                              // re-running per cell per render. (IN5-01)
                              const adAttr = attributionByAd.get(a.adId || a.adName) ?? null;
                              if (!adAttr) {
                                return <span className="text-text-muted text-xs">—</span>;
                              }
                              const detRoas = a.spend > 0
                                ? adAttr.deterministicRevenue / a.spend
                                : 0;
                              const tone =
                                adAttr.trust.level === 'high'    ? 'bg-roas-greenBg/60 text-roas-green'
                              : adAttr.trust.level === 'medium'  ? 'bg-amber-50 text-amber-700'
                              : adAttr.trust.level === 'unknown' ? 'bg-surfaceMuted text-text-secondary'
                              :                                    'bg-roas-redBg/60 text-roas-red';
                              const tooltip =
                                `ROAS אמיתי · ${adAttr.trust.label} (${adAttr.trust.score.toFixed(0)}/100)\n\n` +
                                `Meta דיווח: CAD ${a.value.toFixed(0)}\n` +
                                `click-id מתויג: CAD ${adAttr.deterministicRevenue.toFixed(0)} (${adAttr.deterministicOrders} הזמנות)\n` +
                                `modeled: CAD ${adAttr.modeledRevenue.toFixed(0)}\n\n` +
                                adAttr.reasons.map(r => `• ${r}`).join('\n') +
                                `\n\n💡 ${adAttr.recommendation}`;
                              return (
                                <div className="inline-flex flex-col items-center gap-0.5" title={tooltip}>
                                  <span className="font-semibold tabular-nums text-text-primary">
                                    {detRoas > 0 ? formatNumber(detRoas) : '—'}
                                  </span>
                                  <span className={cn('inline-block text-[8px] font-bold px-1 py-0 rounded uppercase tracking-wider', tone)}>
                                    {adAttr.trust.label}
                                  </span>
                                </div>
                              );
                            })()}
                          </td>
                          <td className="px-3 py-2 text-end tabular-nums">{formatNumber(a.conversions, 0)}</td>
                          <td className="px-3 py-2 text-end tabular-nums text-text-secondary">
                            {formatNumber(a.impressions, 0)}
                          </td>
                          <td className="px-3 py-2 text-end tabular-nums text-text-secondary">
                            {formatNumber(a.clicks, 0)}
                          </td>
                          <td className="px-2 py-2 text-center w-[40px]">
                            {link && (
                              <a
                                href={link}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center justify-center w-7 h-7 rounded text-text-muted hover:text-primary hover:bg-primary/8 transition-colors"
                                title="פתח את המודעה במנהל מודעות"
                                aria-label="פתח את המודעה במנהל מודעות"
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
            </>
          )}

          <div className="text-[10px] text-text-muted text-center pt-2">
            לחץ Esc או על הרקע לסגירה
          </div>
        </div>
      </aside>
    </div>
  );
}

function Stat({
  label,
  value,
  chip,
  accent,
}: {
  label: string;
  value: string;
  chip?: { text: string; tone: string } | null;
  /**
   * Color emphasis for the value. Kept intentionally narrow — only the two
   * tones used in totals strips today. Add new tones here (don't widen to
   * `string`) so the TONE_BG lookup table and this prop stay in lockstep.
   * Sibling components: `DrawerStat` in CampaignDrawer.tsx, also widening.
   */
  accent?: 'green' | 'red';
}) {
  return (
    <div className="rounded-lg border border-borderSubtle bg-surfaceMuted/30 px-2.5 py-2">
      <div className="text-[10px] text-text-muted uppercase tracking-wide leading-tight">{label}</div>
      <div className={cn(
        'text-xs sm:text-sm font-semibold tabular-nums mt-0.5',
        accent === 'green' && 'text-roas-green',
        accent === 'red' && 'text-roas-red',
      )}>
        {value}
      </div>
      {chip && (
        <span className={cn('inline-block mt-1 px-1.5 py-0.5 text-[9px] font-semibold rounded', TONE_BG[chip.tone])}>
          {chip.text}
        </span>
      )}
    </div>
  );
}

function AdSortHeader({
  label,
  col,
  sortKey,
  dir,
  onClick,
  align,
}: {
  label: string;
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
      <button
        type="button"
        onClick={() => onClick(col)}
        className={cn(
          'inline-flex items-center gap-1 transition-colors group select-none cursor-pointer w-full',
          justify,
          isActive
            ? 'text-primary font-semibold'
            : 'text-text-secondary hover:text-text-primary',
        )}
        aria-sort={isActive ? (dir === 'asc' ? 'ascending' : 'descending') : 'none'}
      >
        <span>{label}</span>
        {isActive ? (
          dir === 'asc' ? <ArrowUp size={12} className="text-primary" /> : <ArrowDown size={12} className="text-primary" />
        ) : (
          <ArrowUpDown size={12} className="opacity-0 group-hover:opacity-60 transition-opacity" />
        )}
      </button>
    </th>
  );
}
