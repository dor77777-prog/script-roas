'use client';

import { useEffect, useMemo } from 'react';
import {
  X,
  ExternalLink,
  Megaphone,
  Calendar,
  Store as StoreIcon,
  TrendingUp,
  Layers,
} from 'lucide-react';
import {
  Area,
  AreaChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { cn, formatCurrency, formatDate, formatNumber } from '@/lib/utils';
import { roasLabel } from '@/lib/analytics';
import type { CampaignRow } from '@/lib/campaigns';
import { buildAdsManagerLink, type AdAccountMap } from '@/lib/campaignsLinks';

/**
 * Slide-in drawer that opens when the user clicks a campaign row in the
 * campaigns table. Linear / Vercel-style: full context, but the rest of the
 * dashboard remains in view so the user knows where they came from.
 *
 * Contents:
 *  - hero: campaign name, store badge, platform badge, ROAS chip, key
 *    aggregate KPIs (spend, value, conversions, CTR, CPC, CPA)
 *  - daily area chart of spend vs conversion value (the cleanest visual
 *    answer to "is this campaign worth it?")
 *  - all ad-sets within the campaign, ranked by spend, with their own
 *    ROAS / spend / conversions
 *  - "פתח ב-Ads Manager" button as the primary action
 */

type Props = {
  /** All rows matching this campaign in the selected period (any store,
   *  any ad-set, any day). The drawer aggregates internally. */
  rows: CampaignRow[];
  campaignId: string;
  open: boolean;
  onClose: () => void;
  /** Map of storeId → ad-account IDs, used to build deep links into the
   *  right account in Ads Manager. */
  adAccounts: AdAccountMap;
};

const TONE_BG: Record<string, string> = {
  red:    'bg-roas-redBg text-roas-red',
  orange: 'bg-roas-orangeBg text-roas-orange',
  green:  'bg-roas-greenBg text-roas-green',
  blue:   'bg-roas-blueBg text-roas-blue',
  gray:   'bg-surfaceMuted text-text-muted',
};

export function CampaignDrawer({ rows, campaignId, open, onClose, adAccounts }: Props) {
  // Close on Esc.
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

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
    const byAdSet = new Map<string, {
      id: string;
      name: string;
      spend: number;
      value: number;
      clicks: number;
      impressions: number;
      conversions: number;
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
          spend: 0,
          value: 0,
          clicks: 0,
          impressions: 0,
          conversions: 0,
        });
      }
      const a = byAdSet.get(aKey)!;
      a.spend += r.spend;
      a.value += r.conversionValue;
      a.clicks += r.clicks;
      a.impressions += r.impressions;
      a.conversions += r.conversions;
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

  if (!open || !summary) return null;

  // All rows in the drawer belong to the same campaign and the same store,
  // so we can pick storeId off any of them to look up the ad-account ID.
  const storeId = rows.length > 0 ? rows[0].storeId : '';
  const link = buildAdsManagerLink({
    platform: summary.platform,
    storeId,
    campaignId,
    accounts: adAccounts,
  });
  const roasInfo = roasLabel(summary.roas);

  return (
    <div
      className="fixed inset-0 z-50 flex animate-fade-in"
      role="dialog"
      aria-modal="true"
      aria-labelledby="campaign-drawer-title"
    >
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-text-primary/35 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden
      />

      {/* Drawer — slides in from the start side (RTL: from the left). */}
      <aside
        dir="rtl"
        className={cn(
          'relative bg-surface w-full sm:w-[min(640px,100vw)] max-w-full',
          'ml-0 sm:ms-auto h-full overflow-y-auto',
          'shadow-elevated animate-fade-in-up',
        )}
      >
        {/* Header */}
        <header className="sticky top-0 bg-surface/95 backdrop-blur-md z-10 px-4 sm:px-6 py-4 border-b border-borderSubtle">
          <div className="flex items-start justify-between gap-3 mb-2">
            <div className="flex items-center gap-2 min-w-0 flex-1">
              <span className="inline-flex items-center justify-center w-8 h-8 rounded-lg bg-primary/8 text-primary shrink-0">
                <Megaphone size={16} />
              </span>
              <div className="min-w-0">
                <h2
                  id="campaign-drawer-title"
                  className="text-base sm:text-lg font-semibold text-text-primary tracking-tight truncate"
                >
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
            <button
              onClick={onClose}
              className="p-1.5 rounded hover:bg-surfaceMuted text-text-muted hover:text-text-primary transition-colors shrink-0"
              aria-label="סגור"
            >
              <X size={18} />
            </button>
          </div>
          {link && (
            <a
              href={link}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-xs sm:text-sm text-primary hover:text-primary-dark font-medium"
            >
              <ExternalLink size={13} />
              פתח ב-{summary.platform} Ads Manager
            </a>
          )}
        </header>

        <div className="p-4 sm:p-6 space-y-5 sm:space-y-6">
          {/* KPI row */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 sm:gap-3">
            <DrawerStat label="ROAS" value={summary.roas > 0 ? formatNumber(summary.roas) : '—'} chip={{ text: roasInfo.text, tone: roasInfo.tone }} primary />
            <DrawerStat label="הוצאה" value={formatCurrency(summary.spend)} prefix="CAD" />
            <DrawerStat label="ערך המרות" value={formatCurrency(summary.value)} prefix="CAD" accent={summary.value > summary.spend ? 'green' : undefined} />
            <DrawerStat label="המרות" value={formatNumber(summary.conversions, 0)} />
          </div>

          {/* Secondary metrics */}
          <div className="grid grid-cols-3 gap-2.5 sm:gap-3">
            <DrawerStat label="CTR" value={summary.impressions > 0 ? `${(summary.ctr * 100).toFixed(2)}%` : '—'} compact />
            <DrawerStat label="CPC" value={summary.clicks > 0 ? `CAD ${formatCurrency(summary.cpc, 2)}` : '—'} compact />
            <DrawerStat label="CPA" value={summary.conversions > 0 ? `CAD ${formatCurrency(summary.cpa, 2)}` : '—'} compact />
          </div>

          {/* Daily trend chart */}
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
                          <div
                            dir="rtl"
                            className="rounded-lg bg-text-primary text-white px-3 py-2 text-xs shadow-elevated tabular-nums"
                          >
                            <div className="text-white/70 mb-1 text-[10px]">{formatDate(d.date)}</div>
                            <div>הוצאה: <span className="font-semibold">CAD {formatCurrency(d.spend)}</span></div>
                            <div>ערך המרות: <span className="font-semibold text-emerald-300">CAD {formatCurrency(d.value)}</span></div>
                          </div>
                        );
                      }}
                    />
                    <Area
                      type="monotone"
                      dataKey="value"
                      stroke="#15803d"
                      strokeWidth={1.5}
                      fill="url(#drawer-value)"
                    />
                    <Area
                      type="monotone"
                      dataKey="spend"
                      stroke="#dc2626"
                      strokeWidth={1.5}
                      fill="url(#drawer-spend)"
                    />
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

          {/* Ad-sets within this campaign */}
          {summary.adSets.length > 0 && (
            <section>
              <h3 className="text-sm font-semibold text-text-primary inline-flex items-center gap-1.5 mb-2">
                <Layers size={14} className="text-text-secondary" />
                אד-סטים ({summary.adSets.length})
              </h3>
              <div className="rounded-xl border border-borderSubtle overflow-hidden">
                <table className="w-full text-xs sm:text-sm">
                  <thead className="bg-surfaceMuted/60">
                    <tr className="text-text-secondary">
                      <th className="px-3 py-2 text-start font-medium">שם</th>
                      <th className="px-3 py-2 text-end font-medium">הוצאה</th>
                      <th className="px-3 py-2 text-end font-medium">ערך</th>
                      <th className="px-3 py-2 text-center font-medium">ROAS</th>
                      <th className="px-3 py-2 text-end font-medium">המרות</th>
                    </tr>
                  </thead>
                  <tbody>
                    {summary.adSets.map((a, i) => {
                      const info = roasLabel(a.roas);
                      return (
                        <tr key={a.id || a.name || i} className="border-t border-borderSubtle">
                          <td className="px-3 py-2 text-text-primary truncate max-w-[200px]">{a.name}</td>
                          <td className="px-3 py-2 text-end tabular-nums">{formatCurrency(a.spend)}</td>
                          <td className={cn('px-3 py-2 text-end tabular-nums', a.value > a.spend && 'text-roas-green font-medium')}>
                            {formatCurrency(a.value)}
                          </td>
                          <td className={cn('px-3 py-2 text-center font-semibold tabular-nums rounded', TONE_BG[info.tone])}>
                            {a.roas > 0 ? formatNumber(a.roas) : '—'}
                          </td>
                          <td className="px-3 py-2 text-end tabular-nums">{formatNumber(a.conversions, 0)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          {/* Foot - tiny */}
          <div className="text-[10px] text-text-muted text-center pt-2">
            לחץ Esc או על הרקע לסגירה
          </div>
        </div>
      </aside>
    </div>
  );
}

function DrawerStat({
  label,
  value,
  prefix,
  chip,
  primary,
  compact,
  accent,
}: {
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
