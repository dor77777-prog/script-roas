'use client';

/**
 * "פעילות › סטטיסטיקות והתפלגויות" (Activity Stats) sub-tab — AS-T2.
 *
 * Ports the approved mockup
 * `docs/superpowers/mockups/2026-06-09-activity-stats/index.html`:
 *   • a top KPI row — orders total · % paid-attributed · ATC total · first-touch
 *     coverage %.
 *   • donut 1 — ממומן ↔ לא-ממומן (paid vs organic orders / revenue).
 *   • donut 2 — התפלגות לפי פלטפורמה (the EXHAUSTIVE source buckets).
 *   • a "לפי הזמנות / לפי הכנסה" toggle that switches BOTH donuts between order
 *     count and CAD revenue — a PURE client field switch (no refetch; the
 *     endpoint already returns both fields).
 *   • a per-product table — title · ATC · purchases · %conversion · a STACKED
 *     source bar, with a "רכישות / הוספות-לעגלה" toggle switching the bar between
 *     purchaseBySource and atcBySource (again, no refetch).
 *
 * Data: `/api/activity-stats` via SWR, KEYED by the GLOBAL dashboard range + the
 * GLOBAL store filter (no separate date picker — it respects the dashboard's
 * Filters like every other tab). The store NAME is resolved to its store_id the
 * route filters by (same contract as ActivityEventsTab.resolveStoreId).
 *
 * Token-driven: every colour is a theme-flipping token (no raw hex). The donut
 * uses a conic-gradient of CSS-var bucket tokens; the stacked bars use the SAME
 * one-place bucket→color map. Donut/bar segments carry NO text — every colour is
 * named in a TEXT legend (text-ink-* on the Card surface, AA in both themes), so
 * the chart is never colour-only. Money renders through the shared <Money>
 * primitive (CAD, tabular-nums, overflow-safe, never clipped). Counts render via
 * formatNumber(n, 0). Mobile-first grid (1-col → 2-col donuts), RTL by default.
 */

import { useMemo, useState } from 'react';
import useSWR from 'swr';
import { BarChart3 } from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { Heading } from '@/components/ui/Typography';
import { Money } from '@/components/ui/Money';
import { Button } from '@/components/ui/Button';
import { TableBase } from '@/components/ui/TableBase';
import { cn, formatNumber } from '@/lib/utils';
import { STORE_ID_TO_NAME, type StoreId } from '@/lib/platformsByStore';
import { buildDateRangeKey, type DateRange } from '@/lib/dateRange';
import {
  SOURCE_BUCKET_LABEL,
  type SourceBucket,
} from '@/lib/sourceLabels';
import type {
  ActivityStatsResponse,
  BucketCount,
  PerProduct,
  SourceSplit,
} from '@/app/api/activity-stats/route';

/* --------------------------------------------------------------------------
 * Props
 * -------------------------------------------------------------------------- */

export interface ActivityStatsTabProps {
  /** Global dashboard date range (filters.range) — keys the SWR fetch. */
  range: DateRange;
  /** Global store filter (display NAME or 'All') — resolved to store_id. */
  globalStore?: string;
}

/* --------------------------------------------------------------------------
 * ONE place: bucket → colour token. Brand-mirrored where a brand exists
 * (meta blue / google amber / tiktok pink), distinct AA-legible neutrals/
 * accents elsewhere — every token theme-flips and every segment is also named
 * in a text legend, so the chart is never colour-only.
 *   meta       → --chart-platform-meta    (brand blue)
 *   google     → --chart-platform-google  (brand amber)
 *   tiktok     → --chart-platform-tiktok  (brand pink)
 *   email      → --chart-platform-organic (teal — matches the mockup email teal)
 *   referral   → --accent                 (violet — matches the mockup referral)
 *   other-paid → --status-orange          (orange — "paid, other")
 *   direct     → --text-muted             (neutral grey — matches the mockup)
 * -------------------------------------------------------------------------- */

const BUCKET_COLOR_VAR: Record<SourceBucket, string> = {
  meta: 'var(--chart-platform-meta)',
  google: 'var(--chart-platform-google)',
  tiktok: 'var(--chart-platform-tiktok)',
  email: 'var(--chart-platform-organic)',
  referral: 'var(--accent)',
  'other-paid': 'var(--status-orange)',
  direct: 'var(--text-muted)',
};

/* --------------------------------------------------------------------------
 * Store name ↔ id helper (same contract as ActivityEventsTab.resolveStoreId).
 * The /api/activity-stats route filters by store_id; filters.store is a NAME.
 * -------------------------------------------------------------------------- */

const NAME_TO_STORE_ID: Record<string, StoreId> = Object.fromEntries(
  (Object.entries(STORE_ID_TO_NAME) as [StoreId, string][]).map(([id, name]) => [name, id]),
);

function resolveStoreId(store: string): string {
  if (store in STORE_ID_TO_NAME) return store; // already an id
  return NAME_TO_STORE_ID[store] ?? store; // a display name → id, else as-is
}

/* --------------------------------------------------------------------------
 * Helpers
 * -------------------------------------------------------------------------- */

const fetcher = async (url: string): Promise<ActivityStatsResponse> => {
  const r = await fetch(url, { cache: 'no-store' });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json() as Promise<ActivityStatsResponse>;
};

/** Whole-number count (helper-formatted → not a money cell). */
function countText(n: number): string {
  return formatNumber(n, 0);
}

/** 1-decimal percent, e.g. 79.4 → "79.4%". */
function pctText(n: number): string {
  return `${formatNumber(n, 1)}%`;
}

type DonutMode = 'orders' | 'revenue';
type ProductMetric = 'purchases' | 'atc';

/** A donut slice with its colour token, value (for the chosen mode) + share. */
interface Slice {
  key: string;
  label: string;
  colorVar: string;
  value: number;
  /** CAD value, used only by the revenue legend (<Money>); orders mode = 0. */
  revenueCad: number;
  pct: number;
}

/** Build a conic-gradient `background` from ordered slices (cumulative %). */
function conicGradient(slices: Slice[]): string {
  const total = slices.reduce((s, x) => s + x.pct, 0) || 0;
  if (total <= 0) {
    return `conic-gradient(var(--text-subtle) 0 100%)`;
  }
  let acc = 0;
  const stops: string[] = [];
  for (const s of slices) {
    const start = (acc / total) * 100;
    acc += s.pct;
    const end = (acc / total) * 100;
    stops.push(`${s.colorVar} ${start.toFixed(3)}% ${end.toFixed(3)}%`);
  }
  return `conic-gradient(${stops.join(', ')})`;
}

/* --------------------------------------------------------------------------
 * Donut + legend
 * -------------------------------------------------------------------------- */

function Donut({
  slices,
  centerTop,
  centerBottom,
  mode,
  testId,
}: {
  slices: Slice[];
  /** Big center value (e.g. "79.4%" or "Meta"). */
  centerTop: string;
  /** Small center caption. */
  centerBottom: string;
  mode: DonutMode;
  testId: string;
}) {
  return (
    <div
      data-testid={testId}
      className="flex flex-col sm:flex-row items-center gap-4 sm:gap-5"
    >
      {/* Conic-gradient ring — the inner hole is a neutral plot scrim so the
          center text is legible regardless of which segment sits behind it.
          The segments carry no text; the legend below names every colour. */}
      <div className="relative shrink-0 w-[140px] h-[140px]">
        <div
          className="absolute inset-0 rounded-full"
          style={{ background: conicGradient(slices) }}
          aria-hidden
        />
        <div className="absolute inset-[26px] rounded-full bg-glass-2" aria-hidden />
        <div className="absolute inset-0 z-[1] flex flex-col items-center justify-center text-center">
          <span className="text-xl font-extrabold tabular-nums text-ink">{centerTop}</span>
          <span className="text-2xs text-ink-muted">{centerBottom}</span>
        </div>
      </div>

      {/* Legend — one row per slice: colour swatch · name · value · %. */}
      <ul className="flex-1 min-w-0 w-full flex flex-col gap-2">
        {slices.map((s) => (
          <li key={s.key} className="flex items-center gap-2.5 text-xs">
            <span
              className="inline-block w-2.5 h-2.5 rounded-sm shrink-0"
              style={{ background: s.colorVar }}
              aria-hidden
            />
            <span className="flex-1 min-w-0 truncate text-ink-secondary">{s.label}</span>
            {mode === 'revenue' ? (
              <Money value={s.revenueCad} className="font-bold text-ink" />
            ) : (
              <span className="font-bold tabular-nums text-ink">{countText(s.value)}</span>
            )}
            <span className="w-12 text-end text-2xs tabular-nums text-ink-muted">
              {pctText(s.pct)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/* --------------------------------------------------------------------------
 * Segmented toggle (radiogroup) — reused for both toggles.
 * -------------------------------------------------------------------------- */

function SegToggle<T extends string>({
  ariaLabel,
  options,
  value,
  onChange,
}: {
  ariaLabel: string;
  options: { key: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      className="inline-flex rounded-pill border border-glass-edge bg-glass-2 p-0.5"
    >
      {options.map((o) => {
        const active = value === o.key;
        return (
          <Button
            key={o.key}
            variant="ghost"
            size="sm"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(o.key)}
            className={cn(
              'h-7 rounded-pill px-3.5 font-semibold',
              active
                ? 'bg-accent-btn text-accent-fg hover:bg-accent-btnHover'
                : 'text-ink-secondary',
            )}
          >
            {o.label}
          </Button>
        );
      })}
    </div>
  );
}

/* --------------------------------------------------------------------------
 * Stacked source bar (per-product) — segments sized by share, coloured by the
 * one-place bucket map, named in the shared legend above the table.
 * -------------------------------------------------------------------------- */

function StackedBar({ split, testId }: { split: SourceSplit[]; testId: string }) {
  const total = split.reduce((s, x) => s + x.count, 0) || 1;
  return (
    <div
      data-testid={testId}
      className="flex h-3.5 min-w-[120px] overflow-hidden rounded-pill border border-glass-edge bg-glass-2"
    >
      {split.map((s) => {
        const w = (s.count / total) * 100;
        if (w <= 0) return null;
        return (
          <span
            key={s.bucket}
            data-bucket={s.bucket}
            className="block h-full"
            style={{ width: `${w.toFixed(2)}%`, background: BUCKET_COLOR_VAR[s.bucket] }}
          >
            {/* sr-only label so the colour split is not colour-only for AT. */}
            <span className="sr-only">
              {SOURCE_BUCKET_LABEL[s.bucket]} {countText(s.count)}
            </span>
          </span>
        );
      })}
    </div>
  );
}

/* --------------------------------------------------------------------------
 * KPI tile
 * -------------------------------------------------------------------------- */

function Kpi({ value, label, emphasis }: { value: string; label: string; emphasis?: boolean }) {
  return (
    <Card className="p-4 flex-1 min-w-[130px]">
      <div className={cn('text-xl font-extrabold tabular-nums', emphasis ? 'text-accent' : 'text-ink')}>
        {value}
      </div>
      <div className="mt-0.5 text-2xs text-ink-muted">{label}</div>
    </Card>
  );
}

/* --------------------------------------------------------------------------
 * Component
 * -------------------------------------------------------------------------- */

export function ActivityStatsTab({ range, globalStore }: ActivityStatsTabProps) {
  const [donutMode, setDonutMode] = useState<DonutMode>('orders');
  const [productMetric, setProductMetric] = useState<ProductMetric>('purchases');

  // SWR key — global range + (resolved) store. Pure client toggles never touch
  // this, so flipping orders↔revenue / purchases↔ATC does NOT refetch.
  const swrKey = useMemo(() => {
    const base = buildDateRangeKey('/api/activity-stats', range);
    if (!base) return null;
    if (globalStore && globalStore !== 'All') {
      return `${base}&store=${encodeURIComponent(resolveStoreId(globalStore))}`;
    }
    return base;
  }, [range, globalStore]);

  const { data, error } = useSWR<ActivityStatsResponse>(swrKey, fetcher, {
    revalidateOnFocus: true,
    keepPreviousData: true,
  });

  const isLoading = !data && !error;
  const softError = data?.error;

  // ── Derived donut slices (recomputed per mode — pure client switch). ──────
  const paidSlices = useMemo<Slice[]>(() => {
    if (!data) return [];
    const { paid, organic } = data.orders.paidVsOrganic;
    const paidV = donutMode === 'revenue' ? paid.revenueCad : paid.orders;
    const orgV = donutMode === 'revenue' ? organic.revenueCad : organic.orders;
    const denom = paidV + orgV || 0;
    return [
      {
        key: 'paid',
        label: 'ממומן',
        colorVar: 'var(--accent)',
        value: paid.orders,
        revenueCad: paid.revenueCad,
        pct: denom > 0 ? (paidV / denom) * 100 : 0,
      },
      {
        key: 'organic',
        label: 'לא-ממומן (אורגני / ישיר / אימייל / הפניות)',
        colorVar: 'var(--text-muted)',
        value: organic.orders,
        revenueCad: organic.revenueCad,
        pct: denom > 0 ? (orgV / denom) * 100 : 0,
      },
    ];
  }, [data, donutMode]);

  const platformSlices = useMemo<Slice[]>(() => {
    if (!data) return [];
    const rows: BucketCount[] = data.orders.byPlatform;
    const denom =
      donutMode === 'revenue'
        ? rows.reduce((s, r) => s + r.revenueCad, 0)
        : rows.reduce((s, r) => s + r.orders, 0);
    return rows
      .map((r) => {
        const v = donutMode === 'revenue' ? r.revenueCad : r.orders;
        return {
          key: r.bucket,
          label: r.label,
          colorVar: BUCKET_COLOR_VAR[r.bucket],
          value: r.orders,
          revenueCad: r.revenueCad,
          pct: denom > 0 ? (v / denom) * 100 : 0,
        };
      })
      .sort((a, b) => b.pct - a.pct);
  }, [data, donutMode]);

  // The platform donut center = the leading bucket + its share.
  const topPlatform = platformSlices[0];

  const paidPct = useMemo(() => {
    if (!data) return 0;
    const { paid, organic } = data.orders.paidVsOrganic;
    const denom = paid.orders + organic.orders;
    return denom > 0 ? (paid.orders / denom) * 100 : 0;
  }, [data]);

  // ── Loading / error / empty ───────────────────────────────────────────────
  if (isLoading) {
    return (
      <Card className="!p-0 overflow-hidden animate-fade-in-up" data-testid="activity-stats-tab">
        <div data-testid="as-loading" className="p-5 space-y-4" aria-busy="true">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="skeleton h-20 rounded-xl" aria-hidden />
            ))}
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="skeleton h-44 rounded-2xl" aria-hidden />
            <div className="skeleton h-44 rounded-2xl" aria-hidden />
          </div>
          <div className="skeleton h-56 rounded-2xl" aria-hidden />
          <span className="sr-only">טוען סטטיסטיקות…</span>
        </div>
      </Card>
    );
  }

  if (error || softError) {
    return (
      <Card className="animate-fade-in-up" data-testid="activity-stats-tab">
        <div data-testid="as-error" className="px-5 py-12 text-center">
          <div className="font-bold text-sm text-status-redFg">טעינת הסטטיסטיקות נכשלה</div>
          <div className="mt-1 text-xs text-ink-muted">ננסה שוב אוטומטית…</div>
        </div>
      </Card>
    );
  }

  const ordersTotal = data?.orders.total ?? 0;
  const atcTotal = data?.atc.total ?? 0;
  const ftPct = data?.firstTouchCoverage.orders.pct ?? 0;
  const perProduct: PerProduct[] = data?.perProduct ?? [];
  const isEmpty = ordersTotal === 0 && atcTotal === 0;

  if (isEmpty) {
    return (
      <Card className="animate-fade-in-up" data-testid="activity-stats-tab">
        <div data-testid="as-empty" className="px-5 py-12 text-center">
          <span
            className="grid place-items-center w-10 h-10 mx-auto mb-3 rounded-xl bg-glass-2 text-ink-muted"
            aria-hidden
          >
            <BarChart3 size={18} />
          </span>
          <div className="font-bold text-sm text-ink">אין נתונים בטווח שנבחר</div>
          <div className="mt-1 text-xs text-ink-muted">נסה טווח תאריכים רחב יותר או חנות אחרת.</div>
        </div>
      </Card>
    );
  }

  // The legend for the per-product stacked bars — only buckets that actually
  // appear in the chosen metric, named in text (chart is never colour-only).
  const activeBuckets = new Set<SourceBucket>();
  for (const p of perProduct) {
    const split = productMetric === 'purchases' ? p.purchaseBySource : p.atcBySource;
    for (const s of split) activeBuckets.add(s.bucket);
  }

  return (
    <div className="space-y-4 sm:space-y-5 animate-fade-in-up" data-testid="activity-stats-tab">
      {/* Header + the orders/revenue toggle (drives both donuts). */}
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex items-start gap-2.5 min-w-0 flex-1">
          <span
            className="shrink-0 mt-0.5 inline-flex items-center justify-center w-8 h-8 rounded-lg bg-accent-bg text-accent"
            aria-hidden
          >
            <BarChart3 size={18} />
          </span>
          <div className="min-w-0">
            <Heading level="hero" as="h2">
              סטטיסטיקות והתפלגויות
            </Heading>
            <p className="mt-0.5 text-xs text-ink-secondary">
              פילוח הייחוס של ההזמנות וההוספות-לעגלה — ממומן מול אורגני, לפי פלטפורמה/ערוץ, וירידה
              לרמת המוצר.
            </p>
          </div>
        </div>
        <SegToggle<DonutMode>
          ariaLabel="ערך התצוגה בעוגות"
          options={[
            { key: 'orders', label: 'לפי הזמנות' },
            { key: 'revenue', label: 'לפי הכנסה' },
          ]}
          value={donutMode}
          onChange={setDonutMode}
        />
      </div>

      {/* KPI row */}
      <div data-testid="as-kpis" className="flex flex-wrap gap-3">
        <Kpi value={countText(ordersTotal)} label="הזמנות בטווח" />
        <Kpi value={pctText(paidPct)} label="מיוחס לפרסום ממומן" emphasis />
        <Kpi value={countText(atcTotal)} label="הוספות לעגלה" />
        <Kpi value={pctText(ftPct)} label="כיסוי קליק-ראשון" />
      </div>

      {/* Two donuts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card className="p-4 sm:p-5">
          <Heading level="panel" as="h3">
            ממומן מול לא-ממומן
          </Heading>
          <p className="mb-3.5 text-2xs text-ink-subtle">
            חלוקת ההזמנות לפי מקור בתשלום (meta / google / tiktok-paid) מול אורגני / ישיר / אימייל /
            הפניות
          </p>
          <Donut
            slices={paidSlices}
            centerTop={pctText(donutMode === 'revenue' ? (paidSlices[0]?.pct ?? 0) : paidPct)}
            centerBottom="ממומן"
            mode={donutMode}
            testId="as-donut-paid"
          />
        </Card>

        <Card className="p-4 sm:p-5">
          <Heading level="panel" as="h3">
            התפלגות לפי פלטפורמה
          </Heading>
          <p className="mb-3.5 text-2xs text-ink-subtle">
            כל מקור משויך לפלטפורמה/ערוץ שלו (ממומן + אורגני יחד)
          </p>
          <Donut
            slices={platformSlices}
            centerTop={topPlatform?.label ?? '—'}
            centerBottom={topPlatform ? `${pctText(topPlatform.pct)} מהמקור` : ''}
            mode={donutMode}
            testId="as-donut-platform"
          />
        </Card>
      </div>

      {/* Per-product table */}
      <Card variant="flat" className="overflow-hidden p-0">
        <div className="flex items-center justify-between gap-3 flex-wrap border-b border-glass-edge px-4 py-3.5">
          <div className="min-w-0">
            <Heading level="section" as="h3">
              לפי מוצר — מאיפה מגיעים
            </Heading>
            <p className="mt-0.5 text-2xs text-ink-subtle">
              לכל מוצר: כמה הוספות-לעגלה וכמה רכישות, והפילוח לפי פלטפורמה/ערוץ
            </p>
          </div>
          <SegToggle<ProductMetric>
            ariaLabel="פילוח המקור בטבלה"
            options={[
              { key: 'purchases', label: 'רכישות' },
              { key: 'atc', label: 'הוספות לעגלה' },
            ]}
            value={productMetric}
            onChange={setProductMetric}
          />
        </div>

        {/* Bucket legend — names every stacked-bar colour in text (not colour-
            only). Only buckets present in the chosen metric appear. */}
        <div className="flex flex-wrap gap-x-4 gap-y-1.5 px-4 py-2.5 border-b border-glass-edge">
          {(Array.from(activeBuckets) as SourceBucket[]).map((b) => (
            <span
              key={b}
              className="inline-flex items-center gap-1.5 text-2xs font-semibold text-ink-secondary"
            >
              <i
                className="inline-block w-2 h-2 rounded-sm"
                style={{ background: BUCKET_COLOR_VAR[b] }}
                aria-hidden
              />
              {SOURCE_BUCKET_LABEL[b]}
            </span>
          ))}
        </div>

        <div className="overflow-auto">
          <TableBase minWidth={640} stickyHeader>
            <thead>
              <tr className="text-ink-secondary">
                <th className="border-b border-glass-edge px-3 py-2 text-start text-xs font-semibold">
                  מוצר
                </th>
                <th className="border-b border-glass-edge px-3 py-2 text-end text-xs font-semibold whitespace-nowrap">
                  הוספות לעגלה
                </th>
                <th className="border-b border-glass-edge px-3 py-2 text-end text-xs font-semibold">
                  רכישות
                </th>
                <th className="border-b border-glass-edge px-3 py-2 text-end text-xs font-semibold">
                  המרה
                </th>
                <th className="border-b border-glass-edge px-3 py-2 text-start text-xs font-semibold w-[40%]">
                  פילוח מקור ({productMetric === 'purchases' ? 'רכישות' : 'הוספות לעגלה'})
                </th>
              </tr>
            </thead>
            <tbody>
              {perProduct.map((p, i) => {
                const rowKey = p.productId ?? `row-${i}`;
                const split = productMetric === 'purchases' ? p.purchaseBySource : p.atcBySource;
                return (
                  <tr
                    key={rowKey}
                    data-testid={`as-product-row-${rowKey}`}
                    className="border-t border-glass-edge"
                  >
                    <td className="px-3 py-2.5 font-semibold text-ink">{p.productTitle}</td>
                    <td className="px-3 py-2.5 text-end tabular-nums text-ink">
                      {countText(p.atcCount)}
                    </td>
                    <td className="px-3 py-2.5 text-end tabular-nums text-ink">
                      {countText(p.purchaseCount)}
                    </td>
                    <td className="px-3 py-2.5 text-end text-2xs tabular-nums text-ink-muted">
                      {p.conversionPct != null ? pctText(p.conversionPct) : '—'}
                    </td>
                    <td className="px-3 py-2.5">
                      <StackedBar split={split} testId={`as-product-bar-${rowKey}`} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </TableBase>
        </div>

        <div className="border-t border-glass-edge bg-glass-2 px-4 py-3 text-2xs leading-relaxed text-ink-subtle">
          מקורות: ה<b>עוגות</b> מ-<code dir="ltr" className="font-mono">orders_attribution.source</code> ·
          ה<b>טבלה לפי מוצר</b> מ-<code dir="ltr" className="font-mono">orders_attribution.line_items</code>{' '}
          (רכישות) +{' '}
          <code dir="ltr" className="font-mono">store_events</code> add_to_cart (עגלה). האחוז מחושב לפי
          מספר {donutMode === 'revenue' ? 'הכנסה' : 'הזמנות'}.
        </div>
      </Card>
    </div>
  );
}
