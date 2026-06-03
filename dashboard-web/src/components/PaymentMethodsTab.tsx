'use client';

/**
 * תשלומים (Payments) tab — per-month split of sales by payment gateway
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
 * Token-driven (no hardcoded colours), light + dark, RTL logical classes, WCAG-AA.
 * Every CAD renders through <Money> (tabular, overflow-safe, never clipped).
 * Share-bar segment colours come from tokens: credit = accent, paypal = the
 * defined blue chart-meta brand-blue token, other = ink-subtle — all AA-safe
 * as solid fills carrying no text. % is computed on ORDER count.
 * CAPI-safe: pure Shopify reporting aggregate, zero pixel/CAPI events.
 */
import { useEffect, useMemo, useState } from 'react';
import useSWR from 'swr';
import { CreditCard } from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { Heading } from '@/components/ui/Typography';
import { NativeSelect } from '@/components/ui/NativeSelect';
import { Button } from '@/components/ui/Button';
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
 * Share-bar segment colour TOKENS (never raw hex). credit = brand accent,
 * paypal = the defined blue chart-meta token, other = ink-subtle. Solid fills
 * carry no text so they sit below the AA-on-text bar, but each is a real
 * theme-flipping token so the bar re-skins with the rest of the system.
 */
const SEG_BG: Record<PaymentCategory, string> = {
  credit: 'bg-accent',
  paypal: 'bg-chart-meta',
  other: 'bg-ink-subtle',
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
  return (
    <div
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

const fetcher = async (url: string): Promise<PaymentMethodsResponse> => {
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body?.error || `Failed to load (${res.status})`);
  }
  return res.json();
};

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

  // Keep the local store/scope in sync when the operator changes the global
  // filter to a specific store (mirrors MonthlyTables / CustomerValueTab).
  useEffect(() => {
    if (!globalStore || globalStore === 'All') return;
    if (stores.includes(globalStore)) {
      setScope('store');
      setStore(globalStore);
    }
  }, [globalStore, stores]);

  const useInjected = injectedData != null;
  const { data } = useSWR<PaymentMethodsResponse>(
    useInjected ? null : '/api/payment-methods',
    fetcher,
    { revalidateOnFocus: false },
  );

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

  // Months DESC (newest first) so the current month leads — like MonthlyTables.
  const orderedRows = useMemo(
    () => [...rows].sort((a, b) => b.month.localeCompare(a.month)),
    [rows],
  );

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
        description="פילוח מכירות לפי שער-תשלום (אשראי / PayPal / אחר), פר-חודש — מספר הזמנות · הכנסה (CAD) · אחוז. כלל-העסק או פר-חנות."
        rightSlot={
          <div className="flex flex-wrap items-center gap-2">
            {/* Scope toggle — business / per-store (segmented). */}
            <div
              role="radiogroup"
              aria-label="היקף"
              className="inline-flex rounded-md border border-glass-edge bg-glass-2 p-0.5"
            >
              <Button
                variant="ghost"
                size="sm"
                data-testid="pm-scope-business"
                role="radio"
                aria-checked={scope === 'business'}
                onClick={() => setScope('business')}
                className={cn(
                  'h-7 font-semibold',
                  scope === 'business'
                    ? 'bg-accent-btn text-accent-fg hover:bg-accent-btnHover'
                    : 'text-ink-secondary',
                )}
              >
                כלל-העסק
              </Button>
              <Button
                variant="ghost"
                size="sm"
                data-testid="pm-scope-store"
                role="radio"
                aria-checked={scope === 'store'}
                onClick={() => setScope('store')}
                className={cn(
                  'h-7 font-semibold',
                  scope === 'store'
                    ? 'bg-accent-btn text-accent-fg hover:bg-accent-btnHover'
                    : 'text-ink-secondary',
                )}
              >
                פר-חנות
              </Button>
            </div>
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

      {orderedRows.length === 0 ? (
        <Card data-testid="pm-empty">
          <p className="text-sm text-ink-secondary">
            אין עדיין נתוני אמצעי-תשלום לתצוגה. הדאטה תופיע כאן ברגע שהזמנות יסונכרנו
            מ-Shopify.
          </p>
        </Card>
      ) : (
        <>
          {/* Summary strip — wide totals card + 3 per-gateway cards. */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Card data-testid="pm-summary-total" className="p-4 sm:col-span-1">
              <div className="text-2xs font-semibold uppercase tracking-[0.06em] text-ink-muted">
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
                    className="inline-flex items-center gap-1.5 text-2xs font-semibold text-ink-secondary"
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
            <Card data-testid="pm-backfill-hint" className="p-3">
              <p className="text-xs text-ink-secondary">
                כל ההזמנות מסווגות כרגע כ<b>"אחר / לא ידוע"</b> — נתוני שער-התשלום עוד
                לא מולאו אחורה.{' '}
                <span className="font-semibold text-ink">ממתין ל-backfill</span> מ-Shopify;
                לאחר מכן הפילוח אשראי / PayPal יופיע כאן.
              </p>
            </Card>
          )}

          {/* Per-month table — two-tier header, credit/paypal/other × orders·CAD·%
              + total + per-row share bar. */}
          <Card variant="flat" className="overflow-hidden p-0">
            <div className="flex items-center gap-2 border-b border-glass-edge px-4 py-3">
              <span className="inline-flex h-7 w-7 items-center justify-center rounded-lg bg-accent-soft text-accent">
                <CreditCard size={16} aria-hidden />
              </span>
              <Heading level="section">פילוח חודשי</Heading>
            </div>
            <div className="overflow-auto max-h-[62vh]">
              <PaymentMonthlyTable rows={orderedRows} grand={grand} catMeta={CAT_META} />
            </div>
            <div
              data-testid="pm-note"
              className="border-t border-glass-edge bg-glass-2 px-4 py-3 text-2xs leading-relaxed text-ink-subtle"
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
      <div className="text-2xs font-semibold uppercase tracking-[0.06em] text-ink-muted">
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

/** The two-tier per-month table — mirrors MonthlyTables chrome. */
function PaymentMonthlyTable({
  rows,
  grand,
  catMeta,
}: {
  rows: { month: string; totals: PaymentCategoryTotals }[];
  grand: PaymentCategoryTotals;
  catMeta: { key: PaymentCategory; label: string }[];
}) {
  const grandOrders = totalOrders(grand);
  return (
    <TableBase minWidth={760} stickyHeader>
      <thead>
        <tr className="text-ink-secondary">
          <th
            rowSpan={2}
            className="border-b border-glass-edge px-3 py-2 text-start align-bottom text-xs font-semibold"
          >
            חודש
          </th>
          <th
            colSpan={3}
            className="border-b border-glass-edge px-3 py-2 text-center text-xs font-bold text-accent"
          >
            אשראי
          </th>
          <th
            colSpan={3}
            className="border-b border-s border-glass-edge px-3 py-2 text-center text-xs font-bold text-chart-meta"
          >
            PayPal
          </th>
          <th
            colSpan={2}
            className="border-b border-s border-glass-edge px-3 py-2 text-center text-xs font-bold text-ink-muted"
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
        <tr className="text-2xs text-ink-muted">
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
        {rows.map(({ month, totals }) => {
          const ro = totalOrders(totals);
          const rr = totalRevenue(totals);
          return (
            <tr
              key={month}
              data-testid={`pm-row-${month}`}
              className="border-t border-glass-edge"
            >
              <td className="whitespace-nowrap px-3 py-2 font-semibold tabular-nums">
                {monthTitle(month)}
              </td>
              {/* credit */}
              <td className="px-3 py-2 text-end tabular-nums">{countText(totals.credit.orders)}</td>
              <td className="px-3 py-2 text-end tabular-nums">
                <Money value={totals.credit.revenueCad} />
              </td>
              <td className="px-3 py-2 text-end text-2xs tabular-nums text-ink-muted">
                {pct(totals.credit.orders, ro)}%
              </td>
              {/* paypal */}
              <td className="border-s border-glass-edge px-3 py-2 text-end tabular-nums">
                {countText(totals.paypal.orders)}
              </td>
              <td className="px-3 py-2 text-end tabular-nums">
                <Money value={totals.paypal.revenueCad} />
              </td>
              <td className="px-3 py-2 text-end text-2xs tabular-nums text-ink-muted">
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
      <tfoot>
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
        {/* catMeta drives header labels (incl. the pre-backfill "אחר / לא ידוע"
            relabel); referenced here so the prop is consumed where it matters
            visually — the header cells above already render the same labels. */}
        <tr className="sr-only" aria-hidden>
          <td colSpan={12}>{catMeta.map((c) => c.label).join(' · ')}</td>
        </tr>
      </tfoot>
    </TableBase>
  );
}
