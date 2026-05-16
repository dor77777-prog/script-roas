'use client';

import useSWR from 'swr';
import { Trophy, TrendingUp, TrendingDown, Sparkles } from 'lucide-react';
import { cn, formatCurrency, formatNumber } from '@/lib/utils';
import type { ProductsResponse } from '@/app/api/products/route';
import type { CampaignsResponse } from '@/app/api/campaigns/route';
import type { CampaignRow } from '@/lib/campaigns';
import type { ProductRow } from '@/lib/products';

/**
 * Compact "what's working" widget — answers three questions in five seconds:
 *   1. What's our best-selling product right now?
 *   2. What's our highest-ROAS campaign right now?
 *   3. What's accelerating / decelerating week over week?
 *
 * Compares the last 7 days to the previous 7 days. Quiet design — no charts,
 * no big numbers, just one short answer per question.
 */

const fetcher = async (url: string) => {
  const r = await fetch(url);
  if (!r.ok) return null;
  return r.json();
};

function todayInIsrael(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Jerusalem',
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());
}

function addDays(dateStr: string, n: number): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + n));
  return dt.toISOString().slice(0, 10);
}

type Insight = {
  kind: 'top-product' | 'top-campaign' | 'rising' | 'falling';
  primary: string;
  secondary: string;
  href?: string;
};

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

function computeInsights(
  products: ProductRow[],
  campaigns: CampaignRow[],
): Insight[] {
  const today = todayInIsrael();
  const last7Start = addDays(today, -6);
  const prev7Start = addDays(today, -13);
  const prev7End   = addDays(today, -7);

  const insights: Insight[] = [];

  // ----- 1. Top product (last 7 days, by net revenue if available else gross)
  {
    const map = new Map<string, { title: string; store: string; units: number; rev: number }>();
    for (const p of products) {
      if (p.date < last7Start || p.date > today) continue;
      const key = `${p.storeName}::${p.productId || p.productTitle}`;
      if (!map.has(key)) map.set(key, { title: p.productTitle, store: p.storeName, units: 0, rev: 0 });
      const e = map.get(key)!;
      e.units += p.units;
      e.rev   += p.netRevenue ?? p.revenue;
    }
    const top = Array.from(map.values()).sort((a, b) => b.rev - a.rev)[0];
    if (top) {
      insights.push({
        kind: 'top-product',
        primary: top.title,
        secondary: `${top.store} · ${formatNumber(top.units, 0)} יח׳ · CAD ${formatCurrency(top.rev)}`,
      });
    }
  }

  // ----- 2. Top campaign (last 7 days, by ROAS where spend >= 100 CAD)
  {
    type Agg = {
      name: string; store: string; platform: string; campaignId: string;
      spend: number; value: number;
    };
    const map = new Map<string, Agg>();
    for (const c of campaigns) {
      if (c.date < last7Start || c.date > today) continue;
      const key = `${c.storeId}::${c.platform}::${c.campaignId}`;
      if (!map.has(key)) {
        map.set(key, {
          name: c.campaignName,
          store: c.storeName,
          platform: c.platform,
          campaignId: c.campaignId,
          spend: 0,
          value: 0,
        });
      }
      const e = map.get(key)!;
      e.spend += c.spend;
      e.value += c.conversionValue;
    }
    // Require non-trivial spend so a $1 campaign with $10 revenue doesn't win.
    const candidates = Array.from(map.values())
      .filter(a => a.spend >= 100)
      .map(a => ({ ...a, roas: a.spend > 0 ? a.value / a.spend : 0 }))
      .sort((a, b) => b.roas - a.roas);
    const top = candidates[0];
    if (top && top.roas > 0) {
      insights.push({
        kind: 'top-campaign',
        primary: top.name,
        secondary: `${top.store} · ${top.platform} · ROAS ${formatNumber(top.roas)} · הוצאה CAD ${formatCurrency(top.spend)}`,
        href: adsManagerLink(top.platform, top.campaignId) || undefined,
      });
    }
  }

  // ----- 3 & 4. Rising / falling product (week over week by units)
  {
    type ProdAgg = { title: string; store: string; thisWeek: number; lastWeek: number };
    const map = new Map<string, ProdAgg>();
    for (const p of products) {
      const key = `${p.storeName}::${p.productId || p.productTitle}`;
      if (!map.has(key)) map.set(key, { title: p.productTitle, store: p.storeName, thisWeek: 0, lastWeek: 0 });
      const e = map.get(key)!;
      if (p.date >= last7Start && p.date <= today) e.thisWeek += p.units;
      else if (p.date >= prev7Start && p.date <= prev7End) e.lastWeek += p.units;
    }
    const withDelta = Array.from(map.values())
      .filter(a => a.thisWeek > 0 || a.lastWeek > 0)
      // Require a baseline so we don't fixate on noise (e.g. 1 → 3 = "+200%").
      .filter(a => a.thisWeek + a.lastWeek >= 5)
      .map(a => {
        const delta = a.lastWeek > 0 ? (a.thisWeek - a.lastWeek) / a.lastWeek : Infinity;
        return { ...a, delta };
      })
      .filter(a => Number.isFinite(a.delta));

    const rising = [...withDelta].sort((a, b) => b.delta - a.delta)[0];
    if (rising && rising.delta > 0.15) {
      insights.push({
        kind: 'rising',
        primary: rising.title,
        secondary: `${rising.store} · ${formatNumber(rising.thisWeek, 0)} השבוע (לעומת ${formatNumber(rising.lastWeek, 0)}) · +${(rising.delta * 100).toFixed(0)}%`,
      });
    }
    const falling = [...withDelta].sort((a, b) => a.delta - b.delta)[0];
    if (falling && falling.delta < -0.15) {
      insights.push({
        kind: 'falling',
        primary: falling.title,
        secondary: `${falling.store} · ${formatNumber(falling.thisWeek, 0)} השבוע (לעומת ${formatNumber(falling.lastWeek, 0)}) · ${(falling.delta * 100).toFixed(0)}%`,
      });
    }
  }

  return insights;
}

export function WhatsWorking() {
  const { data: products } = useSWR<ProductsResponse | null>('/api/products', fetcher, {
    refreshInterval: 120_000,
    revalidateOnFocus: false,
  });
  const { data: campaigns } = useSWR<CampaignsResponse | null>('/api/campaigns', fetcher, {
    refreshInterval: 120_000,
    revalidateOnFocus: false,
  });

  const insights = computeInsights(
    products?.rows ?? [],
    campaigns?.rows ?? [],
  );

  if (insights.length === 0) {
    // Loading or genuinely no data — show a placeholder rather than nothing.
    return (
      <section className="rounded-xl bg-surface border border-borderSubtle shadow-card p-4 sm:p-5">
        <div className="flex items-center gap-2 mb-1">
          <Sparkles size={18} className="text-amber-500" />
          <h2 className="text-sm sm:text-base font-semibold text-text-primary">
            מה עובד השבוע
          </h2>
        </div>
        <p className="text-xs text-text-muted">
          ממתין לנתונים מהשבוע האחרון…
        </p>
      </section>
    );
  }

  return (
    <section className="rounded-xl bg-surface border border-borderSubtle shadow-card overflow-hidden">
      <header className="px-4 sm:px-5 py-3 border-b border-borderSubtle bg-gradient-to-l from-amber-50/60 to-surface">
        <div className="flex items-center gap-2">
          <Sparkles size={18} className="text-amber-500" />
          <h2 className="text-sm sm:text-base font-semibold text-text-primary">
            מה עובד השבוע
          </h2>
          <span className="text-[10px] sm:text-xs text-text-muted ml-auto">
            השוואת 7 ימים אחרונים מול ה-7 שלפניהם
          </span>
        </div>
      </header>
      <ul className="divide-y divide-borderSubtle">
        {insights.map((ins, i) => (
          <InsightRow key={i} insight={ins} />
        ))}
      </ul>
    </section>
  );
}

const KIND_META: Record<
  Insight['kind'],
  { icon: React.ReactNode; label: string; tone: string }
> = {
  'top-product': {
    icon: <Trophy size={16} />,
    label: 'מוצר מוביל',
    tone: 'text-amber-600 bg-amber-50',
  },
  'top-campaign': {
    icon: <Trophy size={16} />,
    label: 'קמפיין מוביל',
    tone: 'text-primary bg-primary/8',
  },
  rising: {
    icon: <TrendingUp size={16} />,
    label: 'בעלייה',
    tone: 'text-roas-green bg-roas-greenBg',
  },
  falling: {
    icon: <TrendingDown size={16} />,
    label: 'בירידה',
    tone: 'text-roas-red bg-roas-redBg',
  },
};

function InsightRow({ insight }: { insight: Insight }) {
  const meta = KIND_META[insight.kind];
  const content = (
    <div className="flex items-center gap-3 px-4 sm:px-5 py-3 hover:bg-surfaceMuted/40 transition-colors">
      <span
        className={cn(
          'inline-flex items-center justify-center w-8 h-8 rounded-lg shrink-0',
          meta.tone,
        )}
      >
        {meta.icon}
      </span>
      <div className="min-w-0 flex-1">
        <div className="text-[10px] sm:text-xs font-medium text-text-secondary tracking-wide uppercase">
          {meta.label}
        </div>
        <div className="text-sm sm:text-base font-semibold text-text-primary truncate mt-0.5">
          {insight.primary}
        </div>
        <div className="text-[11px] sm:text-xs text-text-muted truncate tabular-nums mt-0.5">
          {insight.secondary}
        </div>
      </div>
    </div>
  );
  if (insight.href) {
    return (
      <li>
        <a
          href={insight.href}
          target="_blank"
          rel="noopener noreferrer"
          className="block"
        >
          {content}
        </a>
      </li>
    );
  }
  return <li>{content}</li>;
}
