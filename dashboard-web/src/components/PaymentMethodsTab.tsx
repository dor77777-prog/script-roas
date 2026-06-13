'use client';

/**
 * תשלומים (Payments) tab — split of sales by payment gateway
 * (credit / PayPal / other) as orders · revenue (CAD) · % share, business-wide
 * and per-store. Ports the approved mockup
 * `docs/superpowers/mockups/2026-06-03-payment-methods/payment-methods-mockup.html`
 * in the existing graphic language (MonthlyTables chrome + mesh tokens).
 *
 * Data: `/api/payment-methods` (the FULL per-month × store × category aggregate)
 * via SWR; the client switches scope (business / per-store) over the dataset it
 * already holds — same contract as /api/cohorts. Tests inject the aggregate via
 * `injectedData` (bypassing the fetch), mirroring CustomerValueTab.injectedRows.
 *
 * LAYOUT (2026-06-04 by-year restructure):
 *   • An all-history SUMMARY strip on top — aggregate totals across ALL months
 *     for the scope (general data, not per-month).
 *   • A BY-YEAR ACCORDION replaces the flat month table: one collapsible
 *     `<details>` per year (DESC), each header carrying that year's aggregate
 *     (credit/paypal/other orders · CAD · % + a share bar). The most-recent
 *     year is open by default; older years collapsed. Expanding a year reveals
 *     sub-rows at the chosen GRANULARITY (month / quarter / third) — only
 *     periods that have data render, like MonthlyTables. The footer grand-total
 *     row stays.
 *
 * Token-driven (no hardcoded colours), light + dark, RTL logical classes, WCAG-AA.
 * Every CAD renders through <Money> (tabular, overflow-safe, never clipped).
 * Share-bar segment colours come from dedicated payment-GATEWAY tokens (debt
 * #9): credit = accent, paypal = PayPal's own brand blue (--gateway-paypal, no
 * longer borrowing the locked Meta platform token), other = neutral subtle ink
 * — all clear ≥3:1 as fills. % is computed on ORDER count.
 * CAPI-safe: pure Shopify reporting aggregate, zero pixel/CAPI events.
 */
import { useEffect, useMemo, useState } from 'react';
import useSWR from 'swr';
import { CreditCard, ChevronDown, Info } from 'lucide-react';
import { fetchJsonStrict } from '@/lib/fetchJson';
import { Card } from '@/components/ui/Card';
import { Heading } from '@/components/ui/Typography';
import { StateBlock } from '@/components/ui/StateBlock';
import { NativeSelect } from '@/components/ui/NativeSelect';
import { SegmentedControl } from '@/components/ui/SegmentedControl';
import { Money } from '@/components/ui/Money';
import { TableBase } from '@/components/ui/TableBase';
import { SectionIntro } from '@/components/SectionIntro';
import { cn, formatNumber } from '@/lib/utils';
import type {
  PaymentMethodsByMonth,
  PaymentCategoryTotals,
  PaymentBucket,
} from '@/lib/postgresReaders';
import type { PaymentCategory } from '@/lib/payments';
import type { PaymentMethodsResponse } from '@/app/api/payment-methods/route';

const HE_MONTHS = [
  'ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני',
  'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר',
];

/** 'YYYY-MM' → "מאי 2026". Falls back to the raw key on a malformed month. */
function monthTitle(ym: string): string {
  const [y, m] = ym.split('-').map(Number);
  if (!y || !m || m < 1 || m > 12) return ym;
  return `${HE_MONTHS[m - 1]} ${y}`;
}

// ---------------------------------------------------------------------------
// Pure grouping helpers (exported for unit tests).
//
// All grouping is CLIENT-SIDE from the months array: year = month.slice(0,4);
// quarter/third from the 1-based month number. Each aggregate SUMS the member
// months' credit/paypal/other orders + revenueCad.
// ---------------------------------------------------------------------------

/** Sub-row grouping granularity inside an expanded year. */
export type Granularity = 'month' | 'quarter' | 'third';

/** A row of totals tied to a period key ('YYYY-MM' | 'YYYY-Qn' | 'YYYY-Tn'). */
export interface PeriodRow {
  /** The period bucket key. */
  key: string;
  /** The source month ('YYYY-MM') for `month` granularity, else the period. */
  month: string;
  totals: PaymentCategoryTotals;
}

/** A year block: the year string, its aggregate, and its member month rows. */
export interface YearGroup {
  /** 'YYYY'. */
  year: string;
  /** Aggregate over every month in the year. */
  totals: PaymentCategoryTotals;
  /** The member month rows (each `{ month, totals }`), ascending by month. */
  rows: { month: string; totals: PaymentCategoryTotals }[];
}

/**
 * Map a 'YYYY-MM' month to its period key at the given granularity.
 *   month   → 'YYYY-MM'   (identity)
 *   quarter → 'YYYY-Qn'   (Q1 Jan-Mar … Q4 Oct-Dec)
 *   third   → 'YYYY-Tn'   (T1 Jan-Apr, T2 May-Aug, T3 Sep-Dec — 4 months each)
 * A malformed month falls back to its raw value.
 */
export function periodKey(ym: string, gran: Granularity): string {
  if (gran === 'month') return ym;
  const [y, m] = ym.split('-').map(Number);
  if (!y || !m || m < 1 || m > 12) return ym;
  if (gran === 'quarter') return `${y}-Q${Math.floor((m - 1) / 3) + 1}`;
  return `${y}-T${Math.floor((m - 1) / 4) + 1}`; // third
}

/**
 * Human Hebrew label for a period key.
 *   month   'YYYY-MM' → "מאי 2026"
 *   quarter 'YYYY-Qn' → "רבעון 2 2026"
 *   third   'YYYY-Tn' → "שליש 1 2026"
 */
export function periodLabel(key: string, gran: Granularity): string {
  if (gran === 'month') return monthTitle(key);
  const [y, tag] = key.split('-');
  const n = tag?.slice(1) ?? '';
  if (gran === 'quarter') return `רבעון ${n} ${y}`;
  return `שליש ${n} ${y}`; // third
}

/** Whole-number count for orders. (Helper-formatted → not a money cell.) */
function countText(n: number): string {
  return formatNumber(n, 0);
}

/** % of a part within a denominator (whole-percent). 0 denom → 0. */
function pct(part: number, denom: number): number {
  return denom > 0 ? Math.round((part / denom) * 100) : 0;
}

/** Per-category order/revenue totals across a list of months for one scope. */
function sumTotals(buckets: PaymentCategoryTotals[]): PaymentCategoryTotals {
  const acc: PaymentCategoryTotals = {
    credit: { orders: 0, revenueCad: 0 },
    paypal: { orders: 0, revenueCad: 0 },
    other: { orders: 0, revenueCad: 0 },
  };
  for (const b of buckets) {
    (['credit', 'paypal', 'other'] as PaymentCategory[]).forEach((k) => {
      acc[k].orders += b[k].orders;
      acc[k].revenueCad += b[k].revenueCad;
    });
  }
  return acc;
}

const totalOrders = (t: PaymentCategoryTotals): number =>
  t.credit.orders + t.paypal.orders + t.other.orders;
const totalRevenue = (t: PaymentCategoryTotals): number =>
  t.credit.revenueCad + t.paypal.revenueCad + t.other.revenueCad;

/**
 * Bucket month-rows into DESCENDING years, each with a SUMMED year aggregate
 * and its member month rows (ascending by month). Only years with data appear.
 */
export function groupMonthsByYear(
  rows: { month: string; totals: PaymentCategoryTotals }[],
): YearGroup[] {
  const byYear = new Map<string, { month: string; totals: PaymentCategoryTotals }[]>();
  for (const r of rows) {
    const y = r.month.slice(0, 4);
    if (!byYear.has(y)) byYear.set(y, []);
    byYear.get(y)!.push(r);
  }
  return Array.from(byYear.entries())
    .map(([year, yearRows]) => ({
      year,
      totals: sumTotals(yearRows.map((r) => r.totals)),
      rows: [...yearRows].sort((a, b) => a.month.localeCompare(b.month)),
    }))
    .sort((a, b) => b.year.localeCompare(a.year));
}

/**
 * Group a year's member month rows into period sub-rows at the given
 * granularity (each period SUMS its member months). Sub-rows come back
 * DESCENDING by period key; only periods that have data render.
 */
export function groupRowsByPeriod(
  rows: { month: string; totals: PaymentCategoryTotals }[],
  gran: Granularity,
): PeriodRow[] {
  const byPeriod = new Map<string, { month: string; totals: PaymentCategoryTotals }[]>();
  for (const r of rows) {
    const key = periodKey(r.month, gran);
    if (!byPeriod.has(key)) byPeriod.set(key, []);
    byPeriod.get(key)!.push(r);
  }
  return Array.from(byPeriod.entries())
    .map(([key, members]) => ({
      key,
      // For month granularity the period IS the month; for quarter/third the
      // first member month anchors the period (used only as a stable hint).
      month: members[0]?.month ?? key,
      totals: sumTotals(members.map((m) => m.totals)),
    }))
    .sort((a, b) => b.key.localeCompare(a.key));
}

/**
 * Share-bar segment colour TOKENS (never raw hex). These are PAYMENT-GATEWAY
 * tokens, NOT ad-platform tokens — credit = brand accent, paypal = PayPal's OWN
 * brand blue (--gateway-paypal; previously borrowed the locked Meta brand token
 * --chart-platform-meta, design-debt #9 — retuning Meta would have recolored
 * PayPal), other = neutral subtle ink. Each gateway fill clears ≥3:1 on the
 * card surface in both themes (see contrastGuard.test.ts) and re-skins with the
 * rest of the system.
 */
const SEG_BG: Record<PaymentCategory, string> = {
  credit: 'bg-gateway-credit',
  paypal: 'bg-gateway-paypal',
  other: 'bg-gateway-other',
};

/** A horizontal stacked share bar — segments sized by order-count share. */
function ShareBar({
  totals,
  className,
  ...rest
}: {
  totals: PaymentCategoryTotals;
  className?: string;
} & React.HTMLAttributes<HTMLDivElement>) {
  const denom = totalOrders(totals) || 1;
  // a11y: the bar is otherwise mute graphics. Announce the gateway split as a
  // role="img" with a Hebrew label (אשראי / PayPal / אחר %) so screen readers
  // read the proportions instead of skipping a financial visual. A caller-passed
  // aria-label in `rest` still wins (explicit override).
  const ariaLabel =
    `פילוח הזמנות לפי אמצעי תשלום: אשראי ${pct(totals.credit.orders, denom)}%, ` +
    `PayPal ${pct(totals.paypal.orders, denom)}%, אחר ${pct(totals.other.orders, denom)}%`;
  return (
    <div
      role="img"
      aria-label={ariaLabel}
      {...rest}
      className={cn(
        'flex h-3 overflow-hidden rounded-pill border border-glass-edge',
        className,
      )}
    >
      {(['credit', 'paypal', 'other'] as PaymentCategory[]).map((k) => {
        const w = (totals[k].orders / denom) * 100;
        if (w <= 0) return null;
        return (
          <span
            key={k}
            className={cn('block h-full', SEG_BG[k])}
            style={{ width: `${w.toFixed(2)}%` }}
          />
        );
      })}
    </div>
  );
}

// P1-2 (2026-06-10 state-honesty sweep) — /api/payment-methods soft-fails with
// HTTP 200 + { months: [], error }. A fetcher that only checks `res.ok`
// resolved that as success → a DB blip rendered the "הדאטה תופיע ברגע
// שהזמנות יסונכרנו" empty verdict — a wrong diagnosis on a financial tab.
// fetchJsonStrict throws on !ok AND on the 200-with-error body so SWR's
// `error` state fires and the tab renders an explicit error strip instead.
const fetcher = (url: string): Promise<PaymentMethodsResponse> =>
  fetchJsonStrict<PaymentMethodsResponse>(url);

export interface PaymentMethodsTabProps {
  /** Store names for the per-store picker. */
  stores: string[];
  /** Global store filter (filters.store). 'All'/undefined → business-wide. */
  globalStore?: string;
  /** Test-only injection — bypass the /api/payment-methods SWR fetch. */
  injectedData?: PaymentMethodsByMonth;
}

type Scope = 'business' | 'store';

export function PaymentMethodsTab({
  stores,
  globalStore,
  injectedData,
}: PaymentMethodsTabProps) {
  // Default to per-store when the global filter names a store, else business.
  const initialScope: Scope =
    globalStore && globalStore !== 'All' && stores.includes(globalStore)
      ? 'store'
      : 'business';
  const [scope, setScope] = useState<Scope>(initialScope);
  const [store, setStore] = useState<string>(
    globalStore && globalStore !== 'All' && stores.includes(globalStore)
      ? globalStore
      : stores[0] ?? '',
  );
  // Sub-row grouping inside each expanded year. Default = month.
  const [gran, setGran] = useState<Granularity>('month');

  // Keep the local store/scope in sync when the operator changes the global
  // filter to a specific store (mirrors MonthlyTables / CustomerValueTab).
  useEffect(() => {
    if (!globalStore || globalStore === 'All') return;
    if (stores.includes(globalStore)) {
      setScope('store');
      setStore(globalStore);
    }
  }, [globalStore, stores]);

  // P1-2 — destructure error/isLoading too: the tab must distinguish
  // "loading" / "failed" / "settled-empty" instead of rendering the business
  // empty-copy for all three.
  const useInjected = injectedData != null;
  const { data, error, isLoading, mutate } = useSWR<PaymentMethodsResponse>(
    useInjected ? null : '/api/payment-methods',
    fetcher,
    { revalidateOnFocus: false },
  );
  const showError = !useInjected && Boolean(error || data?.error);
  const showLoading = !useInjected && !showError && isLoading;

  const months = useMemo(
    () => (useInjected ? injectedData!.months : data?.months ?? []),
    [useInjected, injectedData, data],
  );

  // Resolve the per-scope rows: business rollup, or the picked store's buckets
  // (months where that store has no orders are omitted — like MonthlyTables).
  const rows = useMemo<{ month: string; totals: PaymentCategoryTotals }[]>(() => {
    if (scope === 'business') {
      return months.map((m) => ({ month: m.month, totals: m.business }));
    }
    const out: { month: string; totals: PaymentCategoryTotals }[] = [];
    for (const m of months) {
      const t = m.perStore[store];
      if (t && totalOrders(t) > 0) out.push({ month: m.month, totals: t });
    }
    return out;
  }, [scope, months, store]);

  // Group into DESCENDING years, each with a SUMMED aggregate + member months.
  const yearGroups = useMemo(() => groupMonthsByYear(rows), [rows]);
  // The most-recent year (first, since DESC) is the one expanded by default.
  const newestYear = yearGroups[0]?.year;

  const grand = useMemo(() => sumTotals(rows.map((r) => r.totals)), [rows]);
  const grandOrders = totalOrders(grand);
  const grandRevenue = totalRevenue(grand);

  // Pre-backfill heuristic: every order classified "other" (NULL gateway → other)
  // AND there ARE orders → the gateway column hasn't been backfilled yet.
  const isPreBackfill =
    grandOrders > 0 && grand.credit.orders === 0 && grand.paypal.orders === 0;

  const CAT_META: { key: PaymentCategory; label: string }[] = [
    { key: 'credit', label: 'אשראי' },
    { key: 'paypal', label: 'PayPal' },
    { key: 'other', label: isPreBackfill ? 'אחר / לא ידוע' : 'אחר' },
  ];

  return (
    <div className="space-y-4 sm:space-y-5 animate-fade-in-up">
      <SectionIntro
        icon={<CreditCard size={20} />}
        title="אמצעי תשלום"
        description="פילוח מכירות לפי שער-תשלום (אשראי / PayPal / אחר), לפי שנה — מספר הזמנות · הכנסה (CAD) · אחוז. פתחו שנה לפילוח פנימי לפי חודש / רבעון / שליש. כלל-העסק או פר-חנות."
        rightSlot={
          <div className="flex flex-wrap items-center gap-2">
            {/* Granularity toggle — month / quarter / third — SegmentedControl
                (radiogroup). Sets the sub-row grouping inside every expanded
                year. Active pill = brand thumb (primitive-owned, AA both themes).
                Roving-tabindex + Arrow/Home/End nav. */}
            <SegmentedControl
              role="radiogroup"
              size="sm"
              aria-label="רזולוציית פילוח"
              options={[
                { value: 'month', label: 'חודש', testId: 'pm-gran-month' },
                { value: 'quarter', label: 'רבעון', testId: 'pm-gran-quarter' },
                { value: 'third', label: 'שליש', testId: 'pm-gran-third' },
              ]}
              value={gran}
              onChange={(v) => setGran(v as Granularity)}
            />
            {/* Scope toggle — business / per-store — SegmentedControl (radiogroup). */}
            <SegmentedControl
              role="radiogroup"
              size="sm"
              aria-label="היקף"
              options={[
                { value: 'business', label: 'כלל-העסק', testId: 'pm-scope-business' },
                { value: 'store', label: 'פר-חנות', testId: 'pm-scope-store' },
              ]}
              value={scope}
              onChange={(v) => setScope(v as Scope)}
            />
            {scope === 'store' && (
              <div className="w-40">
                <NativeSelect
                  aria-label="חנות"
                  data-testid="pm-store-picker"
                  value={store}
                  onChange={(e) => setStore(e.target.value)}
                >
                  {stores.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </NativeSelect>
              </div>
            )}
          </div>
        }
      />

      {/* P1-2 honest states: error (red strip + retry) → loading (skeleton) →
          settled-empty (the business copy) → data. Pre-fix, error AND loading
          both fell into the "הדאטה תופיע ברגע שהזמנות יסונכרנו" verdict. */}
      {showError ? (
        /* Horizon re-skin (W5.4) — the bespoke red strip is replaced by the
           shared <StateBlock mode="error"> chrome (icon + AA-safe status-red
           trio + "נסה שוב" retry <Button>). The pm-error testid + role=alert
           stay on the wrapper so the honest-state contract is preserved; the
           full explanatory copy + the mono error detail ride in `message` as a
           composite node (no info loss — and this drains the file's lone
           sub-floor 10px mono offender onto the type-ramp). */
        <div data-testid="pm-error" role="alert">
          <StateBlock
            mode="error"
            onRetry={() => mutate()}
            message={
              <div className="min-w-0">
                <div className="font-semibold">שגיאה בטעינת נתוני אמצעי-התשלום</div>
                <div className="mt-1 text-fs-2xs font-normal leading-relaxed opacity-80">
                  הקריאה ל-<code className="font-mono">/api/payment-methods</code> נכשלה.
                  זה לא אומר שאין הזמנות — זה אומר שהשרת לא ענה. נסה לרענן.
                </div>
                <div className="mt-1 font-mono text-fs-2xs font-normal opacity-60">
                  {error instanceof Error ? error.message : String(error ?? data?.error)}
                </div>
              </div>
            }
          />
        </div>
      ) : showLoading ? (
        /* LOADING → <StateBlock mode="skeleton"> (4-up KPI silhouette), never
           the business empty-copy. pm-loading + aria-busy stay on the wrapper. */
        <div data-testid="pm-loading" aria-busy="true" className="space-y-3">
          <StateBlock mode="skeleton" shape="card" rows={4} message="טוען נתוני אמצעי-תשלום…" />
          <div className="p-4 text-center text-fs-sm text-ink-muted">טוען נתוני אמצעי-תשלום…</div>
        </div>
      ) : rows.length === 0 ? (
        /* Settled-empty — the ONLY state allowed to show the "waiting for sync"
           copy. Boxed in a Card so it reads as a real empty surface, with the
           shared <StateBlock mode="empty"> status icon + tint. The exact
           message + the pm-empty testid are preserved. */
        <Card data-testid="pm-empty" className="p-0">
          <StateBlock
            mode="empty"
            icon={<CreditCard aria-hidden />}
            description="אין עדיין נתוני אמצעי-תשלום לתצוגה. הדאטה תופיע כאן ברגע שהזמנות יסונכרנו מ-Shopify."
          />
        </Card>
      ) : (
        <>
          {/* Summary strip — wide totals card + 3 per-gateway cards. */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Card data-testid="pm-summary-total" className="p-4 sm:col-span-1">
              <div className="text-fs-2xs font-semibold uppercase tracking-[0.06em] text-ink-muted">
                חלוקת הזמנות — כל התקופה
              </div>
              <div className="mt-1 text-xl font-extrabold tracking-tight">
                <span className="tabular-nums">{countText(grandOrders)}</span>{' '}
                <span className="text-xs font-semibold text-ink-muted">
                  הזמנות ·{' '}
                  <Money value={grandRevenue} className="text-ink-muted" />
                </span>
              </div>
              <ShareBar
                totals={grand}
                className="mt-2.5"
                data-testid="pm-summary-sharebar"
              />
              <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1">
                {CAT_META.map(({ key, label }) => (
                  <span
                    key={key}
                    className="inline-flex items-center gap-1.5 text-fs-2xs font-semibold text-ink-secondary"
                  >
                    <i className={cn('inline-block h-2 w-2 rounded-sm', SEG_BG[key])} />
                    {label} {pct(grand[key].orders, grandOrders)}%
                  </span>
                ))}
              </div>
            </Card>

            {CAT_META.map(({ key, label }) => (
              <GatewaySummaryCard
                key={key}
                label={label}
                bucket={grand[key]}
                sharePct={pct(grand[key].orders, grandOrders)}
              />
            ))}
          </div>

          {isPreBackfill && (
            /* Info-toned state surface (status-blue trio + Info glyph) so the
               pre-backfill notice reads as a real waiting/info banner, not body
               prose. AA-safe (status-blueFg on status-blueBg, both themes). The
               exact copy + the pm-backfill-hint testid are preserved. */
            <Card
              data-testid="pm-backfill-hint"
              variant="flat"
              className="border border-status-blue bg-status-blueBg p-3"
            >
              <div className="flex items-start gap-2.5 text-status-blueFg">
                <Info size={16} className="mt-0.5 shrink-0" aria-hidden />
                <p className="text-fs-xs leading-relaxed">
                  כל ההזמנות מסווגות כרגע כ<b>"אחר / לא ידוע"</b> — נתוני שער-התשלום עוד
                  לא מולאו אחורה.{' '}
                  <span className="font-semibold">ממתין ל-backfill</span> מ-Shopify;
                  לאחר מכן הפילוח אשראי / PayPal יופיע כאן.
                </p>
              </div>
            </Card>
          )}

          {/* By-year accordion — one collapsible <details> per year (DESC),
              each header carrying the year aggregate; expanding reveals
              sub-rows at the chosen granularity. Footer grand-total row stays.
              W5.4 — BOXED as a proper Horizon <Card> section (was variant="flat"
              floating on canvas) for cross-tab consistency with every customers
              section. Keeps the max-h/scroll behaviour on a real card surface;
              p-0 so the header / scroll body / note manage their own padding. */}
          <Card className="overflow-hidden p-0">
            <div className="flex items-center gap-2 border-b border-glass-edge px-4 py-3">
              <span className="inline-flex h-7 w-7 items-center justify-center rounded-lg bg-accent-bg text-accent">
                <CreditCard size={16} aria-hidden />
              </span>
              <Heading level="section">פילוח לפי שנה</Heading>
            </div>
            <div className="overflow-auto max-h-[62vh] p-3 space-y-2.5">
              {yearGroups.map((yg) => (
                <YearAccordion
                  key={yg.year}
                  group={yg}
                  gran={gran}
                  defaultOpen={yg.year === newestYear}
                />
              ))}
              <PaymentGrandTotal grand={grand} catMeta={CAT_META} />
            </div>
            <div
              data-testid="pm-note"
              className="border-t border-glass-edge bg-glass-2 px-4 py-3 text-fs-2xs leading-relaxed text-ink-subtle"
            >
              המספרים מגיעים מ-Shopify (<code dir="ltr" className="font-mono">payment_gateway_names</code>)
              על כל היסטוריית ההזמנות. "אחר" = מתנה / manual / COD וכו׳. האחוז מחושב לפי
              מספר הזמנות.
            </div>
          </Card>
        </>
      )}
    </div>
  );
}

/** One per-gateway summary card: orders + % + revenue (CAD). */
function GatewaySummaryCard({
  label,
  bucket,
  sharePct,
}: {
  label: string;
  bucket: PaymentBucket;
  sharePct: number;
}) {
  return (
    <Card data-testid="pm-summary-card" className="p-4">
      <div className="text-fs-2xs font-semibold uppercase tracking-[0.06em] text-ink-muted">
        {label}
      </div>
      <div className="mt-1 text-xl font-extrabold tracking-tight">
        <span className="tabular-nums">{countText(bucket.orders)}</span>{' '}
        <span className="text-xs font-semibold text-ink-muted">· {sharePct}%</span>
      </div>
      <div className="mt-1 text-xs text-ink-secondary">
        <Money value={bucket.revenueCad} className="text-ink-secondary" />
      </div>
    </Card>
  );
}

/**
 * One year's collapsible block — a styled `<details>` matching the existing
 * `details.acc` graphic language (CampaignDrawerOverview / CustomerValueTab):
 * a hairline glass-edge surface, a marker-less `<summary>` (year title + a
 * compact per-gateway %-chip strip + a year-level share bar on the start,
 * a rotating caret on the end), keyboard-accessible. The body holds the
 * sub-row table at the chosen granularity. Only periods with data render.
 */
function YearAccordion({
  group,
  gran,
  defaultOpen,
}: {
  group: YearGroup;
  gran: Granularity;
  defaultOpen: boolean;
}) {
  const yo = totalOrders(group.totals);
  const yr = totalRevenue(group.totals);
  const periods = useMemo(
    () => groupRowsByPeriod(group.rows, gran),
    [group.rows, gran],
  );
  const catLabels: Record<PaymentCategory, string> = {
    credit: 'אשראי',
    paypal: 'PayPal',
    other: 'אחר',
  };
  return (
    <details
      open={defaultOpen}
      data-testid={`pm-year-row-${group.year}`}
      className="group rounded-card border border-glass-edge bg-pill-track overflow-hidden"
    >
      <summary
        data-testid={`pm-year-${group.year}`}
        className="flex cursor-pointer list-none flex-wrap items-center gap-x-4 gap-y-2 px-3 py-2.5 marker:hidden [&::-webkit-details-marker]:hidden"
      >
        <span className="flex items-center gap-2 text-sm font-bold tabular-nums text-ink">
          <ChevronDown
            size={15}
            className="shrink-0 text-ink-muted transition-transform group-open:rotate-180"
            aria-hidden="true"
          />
          {group.year}
          <span className="text-xs font-semibold text-ink-muted">
            · <span className="tabular-nums">{countText(yo)}</span> הזמנות ·{' '}
            <Money value={yr} className="text-ink-muted" />
          </span>
        </span>
        <ShareBar totals={group.totals} className="w-24" />
        {/* Per-gateway aggregate — orders · CAD · % (same shape as a sub-row,
            compressed). */}
        <span className="flex flex-wrap items-center gap-x-4 gap-y-1">
          {(['credit', 'paypal', 'other'] as PaymentCategory[]).map((k) => (
            <span
              key={k}
              className="inline-flex items-center gap-1.5 text-fs-2xs font-semibold tabular-nums text-ink-secondary"
            >
              <i className={cn('inline-block h-2 w-2 rounded-sm', SEG_BG[k])} />
              <span className="text-ink-muted">{catLabels[k]}</span>
              <span className="text-ink">{countText(group.totals[k].orders)}</span>
              <Money value={group.totals[k].revenueCad} className="text-ink-secondary" />
              <span className="text-ink-muted">{pct(group.totals[k].orders, yo)}%</span>
            </span>
          ))}
        </span>
      </summary>
      <div className="overflow-auto">
        <PeriodRowsTable periods={periods} gran={gran} />
      </div>
    </details>
  );
}

/** The two-tier sub-row table inside an expanded year — mirrors MonthlyTables
 *  chrome. One row per period at the chosen granularity. */
function PeriodRowsTable({
  periods,
  gran,
}: {
  periods: PeriodRow[];
  gran: Granularity;
}) {
  return (
    <TableBase minWidth={720} stickyHeader>
      <thead>
        <tr className="text-ink-secondary">
          <th
            rowSpan={2}
            className="border-b border-glass-edge px-3 py-2 text-start align-bottom text-xs font-semibold"
          >
            תקופה
          </th>
          <th
            colSpan={3}
            className="border-b border-glass-edge px-3 py-2 text-center text-xs font-bold text-gateway-creditInk"
          >
            אשראי
          </th>
          <th
            colSpan={3}
            className="border-b border-s border-glass-edge px-3 py-2 text-center text-xs font-bold text-gateway-paypalInk"
          >
            PayPal
          </th>
          <th
            colSpan={2}
            className="border-b border-s border-glass-edge px-3 py-2 text-center text-xs font-bold text-gateway-other"
          >
            אחר
          </th>
          <th
            colSpan={2}
            className="border-b border-s border-glass-edge px-3 py-2 text-center text-xs font-semibold"
          >
            סה״כ
          </th>
          <th
            rowSpan={2}
            className="border-b border-s border-glass-edge px-3 py-2 text-center align-bottom text-xs font-semibold"
          >
            חלוקה
          </th>
        </tr>
        <tr className="text-fs-2xs text-ink-muted">
          <th className="border-b border-glass-edge px-3 py-1.5 text-end font-medium">הזמנות</th>
          <th className="border-b border-glass-edge px-3 py-1.5 text-end font-medium">CAD</th>
          <th className="border-b border-glass-edge px-3 py-1.5 text-end font-medium">%</th>
          <th className="border-b border-s border-glass-edge px-3 py-1.5 text-end font-medium">הזמנות</th>
          <th className="border-b border-glass-edge px-3 py-1.5 text-end font-medium">CAD</th>
          <th className="border-b border-glass-edge px-3 py-1.5 text-end font-medium">%</th>
          <th className="border-b border-s border-glass-edge px-3 py-1.5 text-end font-medium">הזמנות</th>
          <th className="border-b border-glass-edge px-3 py-1.5 text-end font-medium">CAD</th>
          <th className="border-b border-s border-glass-edge px-3 py-1.5 text-end font-medium">הזמנות</th>
          <th className="border-b border-glass-edge px-3 py-1.5 text-end font-medium">CAD</th>
        </tr>
      </thead>
      <tbody>
        {periods.map(({ key, totals }) => {
          const ro = totalOrders(totals);
          const rr = totalRevenue(totals);
          return (
            <tr
              key={key}
              data-testid={`pm-period-${key}`}
              className="border-t border-glass-edge"
            >
              <td className="whitespace-nowrap px-3 py-2 font-semibold tabular-nums">
                {periodLabel(key, gran)}
              </td>
              {/* credit */}
              <td className="px-3 py-2 text-end tabular-nums">{countText(totals.credit.orders)}</td>
              <td className="px-3 py-2 text-end tabular-nums">
                <Money value={totals.credit.revenueCad} />
              </td>
              <td className="px-3 py-2 text-end text-fs-2xs tabular-nums text-ink-muted">
                {pct(totals.credit.orders, ro)}%
              </td>
              {/* paypal */}
              <td className="border-s border-glass-edge px-3 py-2 text-end tabular-nums">
                {countText(totals.paypal.orders)}
              </td>
              <td className="px-3 py-2 text-end tabular-nums">
                <Money value={totals.paypal.revenueCad} />
              </td>
              <td className="px-3 py-2 text-end text-fs-2xs tabular-nums text-ink-muted">
                {pct(totals.paypal.orders, ro)}%
              </td>
              {/* other */}
              <td className="border-s border-glass-edge px-3 py-2 text-end tabular-nums">
                {countText(totals.other.orders)}
              </td>
              <td className="px-3 py-2 text-end tabular-nums">
                <Money value={totals.other.revenueCad} />
              </td>
              {/* total */}
              <td className="border-s border-glass-edge px-3 py-2 text-end font-semibold tabular-nums">
                {countText(ro)}
              </td>
              <td className="px-3 py-2 text-end font-semibold tabular-nums">
                <Money value={rr} />
              </td>
              {/* share bar */}
              <td className="border-s border-glass-edge px-3 py-2">
                <ShareBar totals={totals} className="mx-auto w-[88px]" />
              </td>
            </tr>
          );
        })}
      </tbody>
    </TableBase>
  );
}

/** Footer grand-total row — sum across the visible scope, same column shape as
 *  the sub-rows. Standalone table so it survives the per-year accordion split. */
function PaymentGrandTotal({
  grand,
  catMeta,
}: {
  grand: PaymentCategoryTotals;
  catMeta: { key: PaymentCategory; label: string }[];
}) {
  const grandOrders = totalOrders(grand);
  return (
    <TableBase minWidth={720}>
      <tbody>
        <tr
          data-testid="pm-total-row"
          className="border-t-2 border-glass-edge bg-glass-2 font-bold"
        >
          <td className="px-3 py-2.5">סך הכל</td>
          <td className="px-3 py-2.5 text-end tabular-nums">{countText(grand.credit.orders)}</td>
          <td className="px-3 py-2.5 text-end tabular-nums">
            <Money value={grand.credit.revenueCad} />
          </td>
          <td className="px-3 py-2.5 text-end tabular-nums">
            {pct(grand.credit.orders, grandOrders)}%
          </td>
          <td className="border-s border-glass-edge px-3 py-2.5 text-end tabular-nums">
            {countText(grand.paypal.orders)}
          </td>
          <td className="px-3 py-2.5 text-end tabular-nums">
            <Money value={grand.paypal.revenueCad} />
          </td>
          <td className="px-3 py-2.5 text-end tabular-nums">
            {pct(grand.paypal.orders, grandOrders)}%
          </td>
          <td className="border-s border-glass-edge px-3 py-2.5 text-end tabular-nums">
            {countText(grand.other.orders)}
          </td>
          <td className="px-3 py-2.5 text-end tabular-nums">
            <Money value={grand.other.revenueCad} />
          </td>
          <td className="border-s border-glass-edge px-3 py-2.5 text-end tabular-nums">
            {countText(grandOrders)}
          </td>
          <td className="px-3 py-2.5 text-end tabular-nums">
            <Money value={totalRevenue(grand)} />
          </td>
          <td className="border-s border-glass-edge px-3 py-2.5">
            <ShareBar totals={grand} className="mx-auto w-[88px]" />
          </td>
        </tr>
        {/* catMeta drives the gateway labels (incl. the pre-backfill
            "אחר / לא ידוע" relabel); kept available to AT here even though the
            visible header cells live in PeriodRowsTable. */}
        <tr className="sr-only" aria-hidden>
          <td colSpan={12}>{catMeta.map((c) => c.label).join(' · ')}</td>
        </tr>
      </tbody>
    </TableBase>
  );
}
