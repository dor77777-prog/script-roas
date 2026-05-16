'use client';

import { useEffect, useMemo, useState } from 'react';
import useSWR from 'swr';
import {
  AlertCircle,
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  Calendar,
  ChevronDown,
  ChevronUp,
  ExternalLink,
  Megaphone,
  Store as StoreIcon,
  X,
} from 'lucide-react';
import { cn, formatCurrency, formatDate, formatNumber } from '@/lib/utils';
import type { CampaignRow } from '@/lib/campaigns';
import type { CampaignsResponse } from '@/app/api/campaigns/route';
import type { DateRange } from '@/lib/types';
import { roasLabel } from '@/lib/analytics';

type Mode = 'campaign' | 'adset';
type Platform = 'all' | 'Meta' | 'Google';

/** All columns the user can sort by. Strings sort lexicographically;
 *  everything else is a numeric metric. */
type SortKey =
  | 'name'
  | 'spend'
  | 'conversionValue'
  | 'roas'
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
};

function aggregate(
  rows: CampaignRow[],
  mode: Mode,
  storeFilter: string,
  platformFilter: Platform,
  range: DateRange,
): Aggregated[] {
  const map = new Map<string, Aggregated>();
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
      });
    }
    const a = map.get(key)!;
    a.spend += r.spend;
    a.impressions += r.impressions;
    a.clicks += r.clicks;
    a.conversions += r.conversions;
    a.conversionValue += r.conversionValue;
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
      case 'conversionValue':
        return a.conversionValue;
      case 'roas':
        return a.spend > 0 ? a.conversionValue / a.spend : 0;
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

// Build a direct link to the right Ads Manager UI.
function adsManagerLink(platform: string, campaignId: string): string | null {
  if (!campaignId) return null;
  if (platform === 'Meta') {
    return `https://business.facebook.com/adsmanager/manage/ads?selected_campaign_ids=${encodeURIComponent(campaignId)}`;
  }
  if (platform === 'Google') {
    return `https://ads.google.com/aw/campaigns?campaignId=${encodeURIComponent(campaignId)}`;
  }
  return null;
}

// --- Component --------------------------------------------------------------

type Props = {
  range: DateRange;
  store: string;
  stores: string[];
};

const TOP_N_DEFAULT = 10;

export function CampaignsTable({ range, store: globalStore, stores }: Props) {
  const { data, error, isLoading } = useSWR<CampaignsResponse>(
    '/api/campaigns',
    fetcher,
    { refreshInterval: 120_000, revalidateOnFocus: false },
  );

  const [mode, setMode] = useState<Mode>('campaign');
  const [platform, setPlatform] = useState<Platform>('all');
  const [showAll, setShowAll] = useState(false);

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
  useEffect(() => { setLocalRange(range); }, [range.from, range.to]); // eslint-disable-line react-hooks/exhaustive-deps

  const today = todayInIsrael();
  const isCustomRange =
    localRange.from !== range.from || localRange.to !== range.to;

  const aggregated = useMemo(() => {
    if (!data) return [];
    const list = aggregate(data.rows, mode, localStore, platform, localRange);
    return sortAggregated(list, mode, sortKey, sortDir);
  }, [data, mode, localStore, platform, localRange, sortKey, sortDir]);

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

  const display = showAll ? aggregated : aggregated.slice(0, TOP_N_DEFAULT);
  const remaining = aggregated.length - display.length;

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
            <table className="w-full text-xs sm:text-sm min-w-[920px]">
              <thead>
                <tr className="text-text-secondary border-b border-borderSubtle bg-surfaceMuted/40">
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
                  const link = adsManagerLink(a.platform, a.campaignId);
                  return (
                    <tr
                      key={a.key}
                      className="border-b border-borderSubtle hover:bg-surfaceMuted/40"
                    >
                      <td className="px-3 sm:px-5 py-2 max-w-[280px] sm:max-w-[400px]">
                        <div className="flex items-center gap-2">
                          <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-surfaceMuted text-[10px] font-bold text-text-secondary tabular-nums shrink-0">
                            {i + 1}
                          </span>
                          <div className="min-w-0">
                            <div className="font-medium text-text-primary truncate">
                              {mode === 'campaign' ? a.campaignName : a.adSetName}
                            </div>
                            <div className="text-[10px] sm:text-[11px] text-text-muted truncate">
                              {a.platform}
                              {' · '}
                              {a.storeName}
                              {mode === 'adset' && a.campaignName ? ` · ${a.campaignName}` : ''}
                            </div>
                          </div>
                        </div>
                      </td>
                      <td className="px-3 py-2 text-end tabular-nums">{formatCurrency(a.spend)}</td>
                      <td className={cn('px-3 py-2 text-end tabular-nums font-medium', a.conversionValue > a.spend && 'text-roas-green')}>
                        {formatCurrency(a.conversionValue)}
                      </td>
                      <td className={cn('px-3 py-2 text-center font-semibold tabular-nums rounded', TONE_BG[info.tone])}>
                        {roas > 0 ? formatNumber(roas) : '—'}
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
    </div>
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
