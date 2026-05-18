'use client';

import { TrendingUp } from 'lucide-react';
import {
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { ProductsResponse } from '@/app/api/products/route';
import { cn, formatCurrency, formatDate } from '@/lib/utils';

/**
 * Day-by-day Meta-claim vs Shopify-actual reconciliation panel for a single
 * campaign. Visual contract + Hebrew copy + Recharts SVG colors all lifted
 * byte-identical from CampaignDrawer.tsx (pre-refactor lines 768-923 JSX +
 * lines 363-410 analysis IIFE + lines 1242-1279 pearson helpers).
 *
 * The two named-exported helpers (`pearson`, `pearsonWithLag`) are pure and
 * marked safe-to-memoize so Phase 5/6/7 can reuse them without a fresh
 * dependency boundary (CONTEXT 04 §Reusable Assets 3rd bullet).
 *
 * `buildReconciliation` (Option A from 04-PATTERNS.md) is the analysis seam:
 * the parent passes raw inputs, the helper returns the chart-ready series +
 * Pearson r + best lag. The component then renders unconditionally given a
 * non-null `reconciliation` prop.
 */

/**
 * Pearson correlation coefficient. Returns 0 for degenerate cases (constant
 * arrays, length < 2, mismatched lengths). Output is clamped to [-1, 1].
 *
 * Pure function — no side effects, no IO. Safe to memoize on inputs.
 */
export function pearson(xs: number[], ys: number[]): number {
  const n = Math.min(xs.length, ys.length);
  if (n < 2) return 0;
  let sx = 0, sy = 0;
  for (let i = 0; i < n; i++) { sx += xs[i]; sy += ys[i]; }
  const mx = sx / n;
  const my = sy / n;
  let cov = 0, vx = 0, vy = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - mx;
    const dy = ys[i] - my;
    cov += dx * dy;
    vx += dx * dx;
    vy += dy * dy;
  }
  const denom = Math.sqrt(vx * vy);
  if (denom === 0) return 0;
  const r = cov / denom;
  return Math.max(-1, Math.min(1, r));
}

/**
 * Pearson correlation with a lag applied to the second series — useful for
 * detecting attribution windows (Meta credits sooner than Shopify records).
 * Positive lag = `ys` shifted forward (compare xs[i] with ys[i + lag]).
 *
 * Pure function — no side effects, no IO. Safe to memoize on inputs.
 */
export function pearsonWithLag(xs: number[], ys: number[], lag: number): number {
  if (lag === 0) return pearson(xs, ys);
  const xsShift: number[] = [];
  const ysShift: number[] = [];
  for (let i = 0; i < xs.length; i++) {
    const j = i + lag;
    if (j < 0 || j >= ys.length) continue;
    xsShift.push(xs[i]);
    ysShift.push(ys[j]);
  }
  return pearson(xsShift, ysShift);
}

/**
 * Reconciliation analysis seam (PATTERNS.md Option A). Consumes the drawer's
 * already-aggregated `dailyArr` plus the raw Shopify product rows; returns a
 * chart-ready series with Pearson r + best lag, or null when not applicable
 * (non-Meta platform, no mapped products, fewer than 5 paired days).
 *
 * Pure function — no side effects, no IO. Safe to memoize on inputs.
 */
export function buildReconciliation(opts: {
  summary: {
    platform: string;
    dailyArr: Array<{ date: string; value: number }>;
  };
  productsData: ProductsResponse | undefined;
  mappedIds: string[];
  storeId: string;
}): {
  series: Array<{ date: string; meta: number; shopify: number }>;
  r: number;
  bestLag: number;
  bestR: number;
} | null {
  const { summary, productsData, mappedIds, storeId } = opts;
  if (mappedIds.length === 0) return null;
  if (summary.platform !== 'Meta') return null; // Google has no mapping
  const productRows = productsData?.rows ?? [];
  const wantedIds = new Set(mappedIds);
  // Build {date → shopify net revenue} for the campaign's mapped products
  // in this store, scoped to the same date window as the drawer's data.
  const shopifyByDate = new Map<string, number>();
  const datesInDrawer = new Set(summary.dailyArr.map(d => d.date));
  for (const p of productRows) {
    if (p.storeId !== storeId) continue;
    if (!wantedIds.has(p.productId)) continue;
    if (!datesInDrawer.has(p.date)) continue;
    const net = p.netRevenue ?? p.revenue;
    if (net <= 0) continue;
    shopifyByDate.set(p.date, (shopifyByDate.get(p.date) ?? 0) + net);
  }
  // Build the paired series, one point per day in the drawer's window.
  const series = summary.dailyArr.map(d => ({
    date: d.date,
    meta: d.value,
    shopify: shopifyByDate.get(d.date) ?? 0,
  }));
  if (series.length < 5) return null; // not enough points for r

  const r = pearson(series.map(s => s.meta), series.map(s => s.shopify));
  // Lag detection: try offsets -3..3, pick the one with the highest r.
  //
  // #WR-03: pearson on n=2 returns ±1.0 trivially (two points fit a
  // line perfectly), so a 5-day series with lag=3 leaves only 2 paired
  // points and spuriously beats the true r — firing a false "lag
  // detected" banner. Require at least 5 paired points AFTER shifting,
  // matching the outer series.length<5 gate. With lag=3 this means the
  // series itself must be >=8 days to even consider lag=±3.
  let bestLag = 0;
  let bestR = r;
  for (let lag = -3; lag <= 3; lag++) {
    if (lag === 0) continue;
    const effectiveN = series.length - Math.abs(lag);
    if (effectiveN < 5) continue; // n<5 makes |r| trivially close to 1
    const r2 = pearsonWithLag(series.map(s => s.meta), series.map(s => s.shopify), lag);
    if (Math.abs(r2) > Math.abs(bestR)) {
      bestR = r2;
      bestLag = lag;
    }
  }
  return { series, r, bestLag, bestR };
}

type Props = {
  reconciliation: NonNullable<ReturnType<typeof buildReconciliation>>;
};

export function MetaShopifyReconciliation({ reconciliation }: Props) {
  return (
    <section>
      <h3 className="text-sm font-semibold text-text-primary inline-flex items-center gap-1.5 mb-2">
        <TrendingUp size={14} className="text-text-secondary" />
        Meta מול Shopify — מתאם יומי
      </h3>
      <div className="rounded-xl border border-borderSubtle bg-surfaceMuted/30 p-3 space-y-3">
        <div className="flex items-start gap-3 flex-wrap">
          <div className="shrink-0">
            <div className="text-[10px] text-text-muted uppercase tracking-wide">
              מתאם (Pearson r)
            </div>
            <div className={cn(
              'text-2xl font-bold tabular-nums leading-tight',
              Math.abs(reconciliation.r) >= 0.7 ? 'text-roas-green'
                : Math.abs(reconciliation.r) >= 0.3 ? 'text-amber-600'
                : 'text-roas-red',
            )}>
              {reconciliation.r >= 0 ? '+' : ''}{reconciliation.r.toFixed(2)}
            </div>
          </div>
          <div className="flex-1 min-w-[200px] text-[11px] sm:text-xs text-text-secondary leading-relaxed">
            {(() => {
              const absR = Math.abs(reconciliation.r);
              if (absR >= 0.7) {
                return (
                  <>
                    <strong className="text-roas-green">מתאם גבוה.</strong>{' '}
                    Meta תופס את הטרנדים נכון. אם יש פער במספרים — סביר שזה{' '}
                    <strong>bias קבוע</strong> (view-through credit, halo).{' '}
                    החלטות גידול תקציב על בסיס מגמות Meta אמינות.
                  </>
                );
              }
              if (absR >= 0.3) {
                return (
                  <>
                    <strong className="text-amber-600">מתאם חלקי.</strong>{' '}
                    Meta תופס חלק מהתנועות אבל יש ימים שהוא חורג.{' '}
                    התעלם מ-Meta ברמת יום בודד, התייחס רק לאגרגציה של 7+ ימים.
                  </>
                );
              }
              return (
                <>
                  <strong className="text-roas-red">אין מתאם.</strong>{' '}
                  Meta מדווח על המרות שלא מופיעות ב-Shopify. או שהמיפוי לא מלא{' '}
                  (חסרים מוצרים), או שיש over-attribution אגרסיבי. אל תקבל החלטות{' '}
                  על בסיס המרות Meta של הקמפיין הזה.
                </>
              );
            })()}
          </div>
        </div>

        {reconciliation.bestLag !== 0 && Math.abs(reconciliation.bestR) > Math.abs(reconciliation.r) + 0.1 && (
          <div className="rounded-md bg-amber-50 border border-amber-200 px-2.5 py-1.5 text-[11px] text-amber-900">
            <strong>זוהה lag של {Math.abs(reconciliation.bestLag)} ימים:</strong>{' '}
            {reconciliation.bestLag > 0
              ? `Meta מדווח על המרה ${Math.abs(reconciliation.bestLag)} ימים לפני שהמכירה מופיעה ב-Shopify (חלון attribution).`
              : `Shopify מקדים את Meta ב-${Math.abs(reconciliation.bestLag)} ימים — לא טיפוסי, בדוק.`}
          </div>
        )}

        <div className="h-32">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={reconciliation.series} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
              <XAxis
                dataKey="date"
                tick={{ fontSize: 9, fill: '#64748b' }}
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
                  const d = payload[0].payload as { date: string; meta: number; shopify: number };
                  return (
                    <div dir="rtl" className="rounded-lg bg-text-primary/95 text-white px-3 py-2 text-xs shadow-elevated tabular-nums">
                      <div className="text-white/65 mb-1 text-[10px]">{formatDate(d.date)}</div>
                      <div className="flex items-center gap-2">
                        <span className="inline-block w-2 h-2 rounded-full bg-amber-400" />
                        <span>Meta: CAD {formatCurrency(d.meta)}</span>
                      </div>
                      <div className="flex items-center gap-2 mt-0.5">
                        <span className="inline-block w-2 h-2 rounded-full bg-roas-green" />
                        <span>Shopify: CAD {formatCurrency(d.shopify)}</span>
                      </div>
                    </div>
                  );
                }}
              />
              <Line type="monotone" dataKey="meta" stroke="#d97706" strokeWidth={2} dot={false} />
              <Line type="monotone" dataKey="shopify" stroke="#15803d" strokeWidth={2} dot={false} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
        <div className="flex items-center justify-center gap-4 text-[10px] sm:text-[11px]">
          <span className="inline-flex items-center gap-1.5">
            <span className="inline-block w-3 h-[2px] bg-amber-600" />
            <span className="text-text-secondary">Meta (מדווח)</span>
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="inline-block w-3 h-[2px] bg-roas-green" />
            <span className="text-text-secondary">Shopify (בפועל)</span>
          </span>
        </div>

        <details className="text-[11px]">
          <summary className="cursor-pointer text-text-secondary hover:text-text-primary select-none py-1">
            יום-לפי-יום ↓
          </summary>
          <div className="mt-2 max-h-48 overflow-y-auto rounded-md border border-borderSubtle">
            <table className="w-full text-[11px]">
              <thead className="bg-surfaceMuted/60 sticky top-0">
                <tr className="text-text-muted">
                  <th className="px-2 py-1.5 text-start font-medium">תאריך</th>
                  <th className="px-2 py-1.5 text-end font-medium">Meta</th>
                  <th className="px-2 py-1.5 text-end font-medium">Shopify</th>
                  <th className="px-2 py-1.5 text-center font-medium">פער</th>
                </tr>
              </thead>
              <tbody>
                {reconciliation.series.map(s => {
                  const delta = s.shopify - s.meta;
                  const denom = Math.max(s.meta, s.shopify, 1);
                  const deltaPct = (delta / denom) * 100;
                  let tone = 'text-text-muted';
                  if (s.meta > 0 || s.shopify > 0) {
                    if (Math.abs(deltaPct) > 50) tone = 'text-roas-red';
                    else if (Math.abs(deltaPct) > 20) tone = 'text-amber-600';
                    else tone = 'text-roas-green';
                  }
                  return (
                    <tr key={s.date} className="border-t border-borderSubtle">
                      <td className="px-2 py-1 text-text-secondary tabular-nums">{s.date.slice(5)}</td>
                      <td className="px-2 py-1 text-end tabular-nums">{formatCurrency(s.meta)}</td>
                      <td className="px-2 py-1 text-end tabular-nums">{formatCurrency(s.shopify)}</td>
                      <td className={cn('px-2 py-1 text-center tabular-nums font-medium', tone)}>
                        {s.meta === 0 && s.shopify === 0 ? '—' : `${deltaPct > 0 ? '+' : ''}${deltaPct.toFixed(0)}%`}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </details>
      </div>
    </section>
  );
}
