'use client';

/**
 * Wave 2 Task 8 — "לקוחות" (Customer Value) tab. Ports the approved v3c mockup
 * `customer-value-v3c-zones.html`: a plain-Hebrew verdict sentence → 4 KPI
 * cards → the zones LTV curve → "new vs old cohorts" comparison → a collapsed
 * advanced cohort grid. Leads with the ANSWER, not the matrix.
 *
 * Data: `/api/cohorts` (all stores) via SWR; the client slices by store, like
 * /api/orders-attribution. Compute is the pure `computeCustomerValue` over the
 * cohort rows; PROFIT is computed AT RENDER via the editable COGS% (the same
 * `effectiveCogsPct` helper as the P&L) + the constant transaction-fees rate.
 *
 * MAPPING-AWARE: per-cohort spend + the blended nCAC are PASSED IN
 * (`blendedNcac` / `spendByMonth`) — never recomputed from raw account totals.
 * Ad-spend history is May-2026+, so pre-May cohorts surface a muted
 * "אין נתוני הוצאה" for the per-cohort nCAC.
 *
 * Token-driven (no hardcoded colours), light + dark, RTL, WCAG-AA (white on
 * accent for the callout pill; numbers through <Money>). CAPI-safe: Shopify-only
 * aggregate, opaque customer.id upstream, zero pixel/CAPI events.
 */
import { useEffect, useMemo, useState } from 'react';
import useSWR from 'swr';
import { Gem } from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { NativeSelect } from '@/components/ui/NativeSelect';
import { Money } from '@/components/ui/Money';
import { HelpTooltip } from '@/components/ui/Tooltip';
import { SectionIntro } from '@/components/SectionIntro';
import { cn } from '@/lib/utils';
import { TRANSACTION_FEES_RATE } from '@/lib/costs';
import {
  readCogsSettings,
  effectiveCogsPct,
  COGS_SETTINGS_EVENT,
  type CogsSettings,
} from '@/lib/cogsSettings';
import { computeCustomerValue, type CustomerValue } from '@/lib/home/customerValue';
import { getTodayInIsraelTz } from '@/lib/dateRange';
import { CustomerValueCurve } from '@/components/CustomerValueCurve';
import { CohortGridAdvanced } from '@/components/CohortGridAdvanced';
import type { CohortMonthlyRow } from '@/lib/postgresReaders';
import type { CohortsResponse } from '@/app/api/cohorts/route';

type Basis = 'profit' | 'net';

export interface CustomerValueTabProps {
  /** Store names for the scope selector ('כל העסק' = business-wide). */
  stores: string[];
  /** Global store filter (filters.store). 'All'/undefined → business-wide. */
  globalStore?: string;
  /**
   * Mapping-aware spend (CAD) per cohort first-order-month — the SAME agg.spend
   * the rest of the dashboard uses (NEVER recomputed here). Wired by Dashboard.
   */
  spendByMonth?: Record<string, number>;
  /** Headline blended nCAC (CAD) from Wave-1 computeNewCustomerMetrics. */
  blendedNcac?: number | null;
  // ── test-only injection (bypass the /api/cohorts SWR fetch) ──────────────
  injectedRows?: CohortMonthlyRow[];
  injectedSpendByMonth?: Record<string, number>;
  injectedBlendedNcac?: number | null;
  /** 'YYYY-MM' reference month for the maturity gate (default = today IL). */
  todayMonth?: string;
}

const fetcher = async (url: string): Promise<CohortsResponse> => {
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body?.error || `Failed to load (${res.status})`);
  }
  return res.json();
};

/** Format a fraction (0..1) as a whole-percent string. */
function pctText(frac: number): string {
  return `${Math.round(frac * 100)}%`;
}

/** Ratio band tone — locked thresholds (<2 bad, 2-3 warn, ≥3 good). */
function ratioTone(ratio: number | null): 'good' | 'warn' | 'bad' | 'none' {
  if (ratio == null || !Number.isFinite(ratio)) return 'none';
  if (ratio >= 3) return 'good';
  if (ratio >= 2) return 'warn';
  return 'bad';
}

export function CustomerValueTab({
  stores,
  globalStore,
  spendByMonth,
  blendedNcac,
  injectedRows,
  injectedSpendByMonth,
  injectedBlendedNcac,
  todayMonth,
}: CustomerValueTabProps) {
  const [basis, setBasis] = useState<Basis>('profit');
  const [scope, setScope] = useState<string>(
    globalStore && globalStore !== 'All' && stores.includes(globalStore) ? globalStore : 'all',
  );
  // Keep the scope selector in sync when the operator changes the global filter.
  useEffect(() => {
    if (!globalStore || globalStore === 'All') return;
    if (stores.includes(globalStore)) setScope(globalStore);
  }, [globalStore, stores]);

  // ── COGS settings (editable %, localStorage + same-tab event) ────────────
  const [cogs, setCogs] = useState<CogsSettings | null>(null);
  useEffect(() => {
    setCogs(readCogsSettings());
    const refresh = () => setCogs(readCogsSettings());
    window.addEventListener(COGS_SETTINGS_EVENT, refresh);
    return () => window.removeEventListener(COGS_SETTINGS_EVENT, refresh);
  }, []);

  // ── cohort rows (injected in tests; SWR in prod) ─────────────────────────
  const useInjected = injectedRows != null;
  const { data } = useSWR<CohortsResponse>(
    useInjected ? null : '/api/cohorts',
    fetcher,
    { revalidateOnFocus: false },
  );
  const allRows: CohortMonthlyRow[] = useMemo(
    () => (useInjected ? injectedRows! : data?.rows ?? []),
    [useInjected, injectedRows, data],
  );

  const refMonth = todayMonth ?? getTodayInIsraelTz().slice(0, 7);
  const storeName = scope === 'all' ? undefined : scope;
  const effSpendByMonth = injectedSpendByMonth ?? spendByMonth;
  const effBlendedNcac =
    injectedBlendedNcac !== undefined ? injectedBlendedNcac : blendedNcac ?? null;

  // Per-cohort-month editable COGS fraction. effectiveCogsPct ignores the store
  // name in business mode and falls back to the default otherwise.
  const cogsPctByMonth = useMemo<Record<string, number> | undefined>(() => {
    if (!cogs) return undefined;
    const lookupStore = storeName ?? stores[0] ?? '';
    const months = [...new Set(allRows.map((r) => r.firstOrderMonth))];
    const out: Record<string, number> = {};
    for (const m of months) out[m] = effectiveCogsPct(cogs, lookupStore, m);
    return out;
  }, [cogs, storeName, stores, allRows]);

  const scopedRows = useMemo(
    () => (storeName ? allRows.filter((r) => r.storeId === storeName) : allRows),
    [allRows, storeName],
  );

  const value: CustomerValue = useMemo(
    () =>
      computeCustomerValue(allRows, {
        basis,
        feesRate: TRANSACTION_FEES_RATE,
        cogsPctByMonth,
        spendByMonth: effSpendByMonth,
        blendedNcac: effBlendedNcac,
        storeName,
        todayMonth: refMonth,
      }),
    [allRows, basis, cogsPctByMonth, effSpendByMonth, effBlendedNcac, storeName, refMonth],
  );

  const isProfit = basis === 'profit';
  const basisLabel = isProfit ? 'רווח' : 'הכנסה';
  const curvePoints = isProfit ? value.cumulativeProfit : value.cumulativeNet;
  const ltv12 = isProfit ? value.ltv12Profit : value.ltv12Net;
  const ncac = value.blendedNcac;
  const netPerCustomer = ltv12 != null && ncac != null ? ltv12 - ncac : null;
  const ratio = value.ltvToNcac;
  const tone = ratioTone(ratio);

  // new-vs-old: compare cumNet at M2 (early LTV); fall back to M0.
  const recent3 = value.newVsOld.recent[2] ?? value.newVsOld.recent[0] ?? 0;
  const old3 = value.newVsOld.old[2] ?? value.newVsOld.old[0] ?? 0;
  const newVsOldDiff = old3 > 0 ? Math.round(((recent3 - old3) / old3) * 100) : null;
  const cmpMax = Math.max(recent3, old3, 1);

  const numClass = (t: 'good' | 'warn' | 'bad' | 'accent' | 'none') =>
    t === 'good'
      ? 'text-status-greenFg'
      : t === 'warn'
        ? 'text-status-warningFg'
        : t === 'bad'
          ? 'text-status-redFg'
          : t === 'accent'
            ? 'text-accent'
            : 'text-ink';

  return (
    <div className="space-y-4 sm:space-y-5 animate-fade-in-up">
      <SectionIntro
        icon={<Gem size={20} />}
        title="כמה שווה לך לקוח"
        description="כמה רווח לקוח חדש מכניס לאורך זמן, מול כמה עלה לגייס אותו — ואם הגיוס משתלם."
        rightSlot={
          <div className="flex flex-wrap items-center gap-2">
            <div className="w-40">
              <NativeSelect
                aria-label="היקף"
                value={scope}
                onChange={(e) => setScope(e.target.value)}
              >
                <option value="all">כל העסק</option>
                {stores.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </NativeSelect>
            </div>
            {/* profit ↔ revenue basis toggle (segmented). Active = deepened
                accent-btn bg + white (AA-verified, same as Button primary). */}
            <div
              role="radiogroup"
              aria-label="בסיס"
              className="inline-flex rounded-md border border-glass-edge bg-glass-2 p-0.5"
            >
              <Button
                variant="ghost"
                size="sm"
                data-testid="cv-basis-profit"
                role="radio"
                aria-checked={isProfit}
                onClick={() => setBasis('profit')}
                className={cn(
                  'h-7 font-semibold',
                  isProfit ? 'bg-accent-btn text-accent-fg hover:bg-accent-btnHover' : 'text-ink-secondary',
                )}
              >
                רווח
              </Button>
              <Button
                variant="ghost"
                size="sm"
                data-testid="cv-basis-revenue"
                role="radio"
                aria-checked={!isProfit}
                onClick={() => setBasis('net')}
                className={cn(
                  'h-7 font-semibold',
                  !isProfit ? 'bg-accent-btn text-accent-fg hover:bg-accent-btnHover' : 'text-ink-secondary',
                )}
              >
                הכנסה
              </Button>
            </div>
          </div>
        }
      />

      {/* 1. THE BOTTOM LINE — plain-Hebrew verdict. */}
      <Card>
        <p data-testid="cv-verdict" className="text-[15.5px] sm:text-[17px] font-semibold leading-relaxed">
          לקוח חדש שווה לך{' '}
          <span className={cn('font-extrabold', numClass(isProfit ? 'good' : 'accent'))}>
            <Money value={ltv12} />
          </span>{' '}
          {basisLabel} לאורך שנה, ועולה{' '}
          <span className="font-extrabold text-ink">
            <Money value={ncac} />
          </span>{' '}
          לגייס —{' '}
          {netPerCustomer != null ? (
            <>
              כלומר כל לקוח מכניס לך{' '}
              <span className={cn('font-extrabold', numClass(netPerCustomer >= 0 ? 'good' : 'bad'))}>
                <Money value={netPerCustomer} />
              </span>{' '}
              נטו.{' '}
            </>
          ) : (
            <span className="text-ink-muted">אין עדיין נתוני עלות-גיוס. </span>
          )}
          {value.paybackMonths != null && (
            <>
              הוא מחזיר את עלות הגיוס תוך{' '}
              <span className={cn('font-extrabold', numClass('accent'))}>{value.paybackMonths}</span>{' '}
              חודשים,{' '}
            </>
          )}
          ו-<span className="font-extrabold tabular-nums text-ink">{pctText(value.repeatRate)}</span>{' '}
          חוזרים לקנות שוב.
          {ratio != null && (
            <>
              {' '}על כל <span className="font-extrabold tabular-nums text-ink">$1</span> פרסום אתה מקבל{' '}
              <span className={cn('font-extrabold tabular-nums', numClass(tone))}>
                {ratio.toFixed(1)}×
              </span>{' '}
              בערך-לקוח (LTV:nCAC)
              <span
                data-testid="cv-ratio-badge"
                className={cn(
                  'ms-1.5 inline-block rounded-full px-2.5 py-0.5 text-[12.5px] font-extrabold',
                  tone === 'good'
                    ? 'bg-status-greenBg text-status-greenFg'
                    : tone === 'bad'
                      ? 'bg-status-redBg text-status-redFg'
                      : 'bg-status-warningBg text-status-warningFg',
                )}
              >
                {tone === 'good'
                  ? 'בריא ✓'
                  : tone === 'bad'
                    ? 'מתחת לסף הרווחיות'
                    : 'מתחת ליעד 3×'}
              </span>
            </>
          )}
        </p>
      </Card>

      {/* 2. KPI cards. */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Card data-testid="cv-kpi" className="p-4">
          <div className="text-xs font-semibold text-ink-secondary">
            שווי לקוח (12 ח׳, {basisLabel})
          </div>
          <div data-testid="cv-kpi-ltv" className="mt-1 text-2xl font-extrabold tracking-tight">
            <Money value={ltv12} />
          </div>
          <div className="mt-0.5 text-[11.5px] text-ink-muted">
            כמה {basisLabel} ממוצע לקוח מכניס לאורך שנה
          </div>
        </Card>
        <Card data-testid="cv-kpi" className="p-4">
          <div className="text-xs font-semibold text-ink-secondary">עלות גיוס לקוח (nCAC)</div>
          <div data-testid="cv-kpi-cac" className="mt-1 text-2xl font-extrabold tracking-tight">
            <Money value={ncac} />
          </div>
          <div className="mt-0.5 text-[11.5px] text-ink-muted">כמה שילמת בפרסום לכל לקוח חדש</div>
        </Card>
        <Card data-testid="cv-kpi" className="p-4">
          <div className="text-xs font-semibold text-ink-secondary">החזר עלות (payback)</div>
          <div data-testid="cv-kpi-payback" className="mt-1 text-2xl font-extrabold tracking-tight tabular-nums">
            {value.paybackMonths != null ? `${value.paybackMonths} ח׳` : '—'}
          </div>
          <div className="mt-0.5 text-[11.5px] text-ink-muted">תוך כמה חודשים הרווח מכסה את הגיוס</div>
        </Card>
        <Card data-testid="cv-kpi" className="p-4">
          <div className="text-xs font-semibold text-ink-secondary">חוזרים לקנות (repeat)</div>
          <div data-testid="cv-kpi-repeat" className="mt-1 text-2xl font-extrabold tracking-tight tabular-nums">
            {pctText(value.repeatRate)}
          </div>
          <div className="mt-0.5 text-[11.5px] text-ink-muted">אחוז שמזמינים שוב אחרי הראשונה</div>
        </Card>
      </div>

      {/* 3. THE CURVE. */}
      <Card>
        <h3 className="m-0 flex items-center gap-1.5 text-[15px] font-extrabold text-ink">
          העקומה: כמה לקוח מחזיר ככל שעובר הזמן
          <HelpTooltip
            variant="rich"
            title="על מה זה מתבסס"
            content={
              'על מה זה מתבסס: הקו הסגול (הרווח המצטבר ללקוח) מחושב מ‏כל‏ היסטוריית ההזמנות ב-Shopify — שנים אחורה, לא רק ממאי. קו עלות-הגיוס (nCAC) הוא הבלנדי ה‏נוכחי‏: הוצאת הפרסום ÷ לקוחות חדשים, מנתוני ההוצאה שקיימים בדשבורד (מאי 2026 והלאה — חלון ההוצאה היחיד שיש). כלומר: רווח-חיי-הלקוח לאורך כל ההיסטוריה, מול כמה עולה לגייס לקוח היום. הערה: עלות-גיוס פר-קבוצה (בתצוגה המתקדמת) קיימת רק לקבוצות מ-מאי+; לקבוצות ישנות יש רווח/שימור אבל לא עלות-גיוס.'
            }
          >
            <span
              className="inline-flex h-4 w-4 cursor-help items-center justify-center rounded-full border border-glass-edge text-[10px] text-ink-muted"
              aria-label="הסבר על העקומה"
            >
              ?
            </span>
          </HelpTooltip>
        </h3>
        <p className="mb-2.5 mt-0.5 text-[12.5px] text-ink-secondary">
          הקו עולה ככל שלקוחות חוזרים לקנות. כשהוא חוצה את <b>קו עלות-הגיוס</b> — הלקוח הפך לרווחי.
          משם זה {basisLabel} נקי.
        </p>
        <CustomerValueCurve
          points={curvePoints}
          ncac={ncac}
          // paybackMonths is profit-derived. Pin the zone split to it ONLY in
          // profit basis; in net/revenue basis net ≥ profit so the net curve
          // crosses break-even earlier — pass null and let the curve derive its
          // own crossing from the net points it draws, so the amber/green split
          // lands exactly where the visible line meets the nCAC line.
          paybackMonths={isProfit ? value.paybackMonths : null}
          basisLabel={basisLabel}
        />
        <div className="mt-2 flex flex-wrap gap-4 text-xs text-ink-secondary">
          <span className="inline-flex items-center gap-1.5">
            <i className="inline-block h-[3px] w-3.5 rounded-sm bg-accent" /> {basisLabel} מצטבר ללקוח
          </span>
          <span className="inline-flex items-center gap-1.5">
            <i className="inline-block h-2.5 w-3.5 rounded-sm bg-status-warningBg" /> עדיין מחזיר עלות
          </span>
          <span className="inline-flex items-center gap-1.5">
            <i className="inline-block h-2.5 w-3.5 rounded-sm bg-status-greenBg" /> רווח
          </span>
        </div>
      </Card>

      {/* 4. NEW vs OLD. */}
      <Card>
        <h3 className="m-0 text-[15px] font-extrabold text-ink">
          הלקוחות החדשים — טובים יותר או פחות מהוותיקים?
        </h3>
        <p className="mb-3 mt-0.5 text-[12.5px] text-ink-secondary" data-testid="cv-newvsold-sub">
          {newVsOldDiff == null ? (
            'אין עדיין מספיק קבוצות להשוואה.'
          ) : newVsOldDiff >= 0 ? (
            <>
              הלקוחות שגייסת לאחרונה שווים{' '}
              <b className="text-status-greenFg">{newVsOldDiff}% יותר</b> ב-3 החודשים הראשונים
              מהוותיקים — איכות הגיוס משתפרת.
            </>
          ) : (
            <>
              הלקוחות שגייסת לאחרונה שווים{' '}
              <b className="text-status-redFg">{Math.abs(newVsOldDiff)}% פחות</b> ב-3 החודשים הראשונים
              מהוותיקים — שווה לבדוק את איכות הגיוס.
            </>
          )}
        </p>
        <div className="flex flex-wrap items-center gap-4">
          <div className="min-w-[180px] flex-1">
            <div className="mb-1 flex justify-between text-xs text-ink-secondary">
              <span>חדשים (3 ח׳ אחרונים)</span>
              <b className="text-ink">
                <Money value={recent3} />
              </b>
            </div>
            <div className="h-3.5 overflow-hidden rounded-full bg-glass-2">
              <div
                className="h-full rounded-full bg-status-green"
                style={{ width: `${(recent3 / cmpMax) * 100}%` }}
              />
            </div>
          </div>
          <div className="min-w-[180px] flex-1">
            <div className="mb-1 flex justify-between text-xs text-ink-secondary">
              <span>ותיקים</span>
              <b className="text-ink">
                <Money value={old3} />
              </b>
            </div>
            <div className="h-3.5 overflow-hidden rounded-full bg-glass-2">
              <div
                className="h-full rounded-full bg-ink-muted"
                style={{ width: `${(old3 / cmpMax) * 100}%` }}
              />
            </div>
          </div>
        </div>
      </Card>

      {/* 5. ADVANCED — collapsed cohort grid (no info loss). */}
      <Card>
        <details data-testid="cv-advanced">
          <summary className="cursor-pointer list-none text-[13.5px] font-bold text-accent marker:hidden [&::-webkit-details-marker]:hidden">
            ▸ תצוגה מתקדמת — רשת ה-cohorts המלאה (לחובבי דאטה)
          </summary>
          <div className="mt-3">
            <p className="text-[12.5px] text-ink-secondary">
              שורה = חודש הזמנה-ראשונה · עמודה = חודשים-מאז (M0=הרכישה). תא = % שחזרו לקנות. כלי
              לאנליסט — לא חובה ליומיום.
            </p>
            <CohortGridAdvanced rows={scopedRows} todayMonth={refMonth} />
          </div>
        </details>
        {/* Per-cohort nCAC availability — pre-May cohorts have no ad-spend. */}
        <div className="mt-3 border-t border-glass-edge pt-3 text-[11.5px] leading-relaxed text-ink-muted">
          עלות-גיוס לכל קבוצה (nCAC) זמינה רק מ-מאי 2026 והלאה (תקופת היסטוריית הפרסום). לקבוצות
          ישנות יותר מוצג{' '}
          <span className="font-semibold text-ink-secondary">אין נתוני הוצאה</span> במדד עלות-הגיוס.
          {value.cohortNcac.length > 0 && (
            <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
              {value.cohortNcac.map((c) => (
                <li key={c.firstOrderMonth} className="inline-flex items-center gap-1.5 tabular-nums">
                  <span className="font-semibold text-ink-secondary">{c.firstOrderMonth}</span>
                  {c.nCac == null ? (
                    <span className="text-ink-muted">אין נתוני הוצאה</span>
                  ) : (
                    <span className="text-ink">
                      <Money value={c.nCac} />
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </Card>
    </div>
  );
}
