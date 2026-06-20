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
import { ChevronDown, Gem } from 'lucide-react';
import { fetchJsonStrict } from '@/lib/fetchJson';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { StateBlock } from '@/components/ui/StateBlock';
import { SegmentedControl } from '@/components/ui/SegmentedControl';
import { NativeSelect } from '@/components/ui/NativeSelect';
import { Money } from '@/components/ui/Money';
import { HelpTooltip } from '@/components/ui/Tooltip';
import { SectionIntro } from '@/components/SectionIntro';
import { CohortAsOfBadge } from '@/components/customers/CohortAsOfBadge';
import { cn } from '@/lib/utils';
import { TRANSACTION_FEES_RATE } from '@/lib/costs';
import {
  readCogsSettings,
  effectiveCogsPct,
  COGS_SETTINGS_EVENT,
  type CogsSettings,
} from '@/lib/cogsSettings';
import {
  computeCustomerValue,
  blendedCogsPctByMonth,
  type CustomerValue,
} from '@/lib/home/customerValue';
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
   * A3 — controlled scope from Dashboard ('all' = business-wide, else a store
   * display name). When `onScopeChange` is provided the selector is controlled
   * by the parent so the SAME scope drives blendedNcac/spendByMonth + the LTV
   * compute. Omitted in standalone tests → internal-state fallback.
   */
  scope?: string;
  onScopeChange?: (scope: string) => void;
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

// P1-2 (2026-06-10 state-honesty sweep) — /api/cohorts soft-fails with HTTP
// 200 + { rows: [], error } (so SWR consumers stay consistent). A fetcher that
// only checks `res.ok` resolved that as success → a Supabase blip rendered as
// "LTV $0 / אין עדיין מספיק נתונים" — a WRONG business verdict on a financial
// tab. fetchJsonStrict throws on !ok AND on the 200-with-error body, so SWR's
// `error` state fires and the tab renders an explicit error strip instead.
const fetcher = (url: string): Promise<CohortsResponse> =>
  fetchJsonStrict<CohortsResponse>(url);

/** Format a fraction (0..1) as a whole-percent string. */
function pctText(frac: number): string {
  return `${Math.round(frac * 100)}%`;
}

/**
 * Bucket the flat per-cohort nCAC list into DESCENDING cohort years, each with
 * its member months (ascending) — mirrors the by-year cohort grid so the footer
 * regroups the SAME way. Zero data loss: every cohort month is preserved.
 */
function groupNcacByYear<T extends { firstOrderMonth: string }>(
  items: T[],
): { year: string; items: T[] }[] {
  const byYear = new Map<string, T[]>();
  for (const c of items) {
    const y = c.firstOrderMonth.slice(0, 4);
    if (!byYear.has(y)) byYear.set(y, []);
    byYear.get(y)!.push(c);
  }
  return Array.from(byYear.entries())
    .map(([year, list]) => ({
      year,
      items: [...list].sort((a, b) => a.firstOrderMonth.localeCompare(b.firstOrderMonth)),
    }))
    .sort((a, b) => b.year.localeCompare(a.year));
}

/**
 * LTV:nCAC band tone. Break-even for THIS ratio is ×1 (the LTV is already
 * PROFIT, net of COGS+fees) — so ×1.4 is PROFITABLE, not "below profitability".
 * (The ROAS ×2/×3 bands are a different metric and stay untouched.)
 *   ≥3  → good  (healthy LTV:CAC rule-of-thumb)
 *   1–3 → warn  (profitable, but below the healthy ×3 target)
 *   <1  → bad   (below break-even — actually losing on acquisition)
 */
function ratioTone(ratio: number | null): 'good' | 'warn' | 'bad' | 'none' {
  if (ratio == null || !Number.isFinite(ratio)) return 'none';
  if (ratio >= 3) return 'good';
  if (ratio >= 1) return 'warn';
  return 'bad';
}

export function CustomerValueTab({
  stores,
  globalStore,
  scope: controlledScope,
  onScopeChange,
  spendByMonth,
  blendedNcac,
  injectedRows,
  injectedSpendByMonth,
  injectedBlendedNcac,
  todayMonth,
}: CustomerValueTabProps) {
  const [basis, setBasis] = useState<Basis>('profit');
  const [internalScope, setInternalScope] = useState<string>(
    globalStore && globalStore !== 'All' && stores.includes(globalStore) ? globalStore : 'all',
  );
  // A3 — controlled by Dashboard when onScopeChange is provided (single source
  // of truth so blendedNcac/spendByMonth + the LTV compute share one scope);
  // internal-state fallback keeps the tab usable standalone in tests.
  const scope = controlledScope ?? internalScope;
  const setScope = onScopeChange ?? setInternalScope;
  // Sync to the global filter only when UNCONTROLLED (Dashboard owns the sync
  // when controlled — see Dashboard.customersScope).
  useEffect(() => {
    if (onScopeChange) return;
    if (!globalStore || globalStore === 'All') return;
    if (stores.includes(globalStore)) setInternalScope(globalStore);
  }, [globalStore, stores, onScopeChange]);

  // ── COGS settings (editable %, localStorage + same-tab event) ────────────
  const [cogs, setCogs] = useState<CogsSettings | null>(null);
  useEffect(() => {
    setCogs(readCogsSettings());
    const refresh = () => setCogs(readCogsSettings());
    window.addEventListener(COGS_SETTINGS_EVENT, refresh);
    return () => window.removeEventListener(COGS_SETTINGS_EVENT, refresh);
  }, []);

  // ── cohort rows (injected in tests; SWR in prod) ─────────────────────────
  // P1-2 — destructure error/isLoading too: the tab must distinguish
  // "loading" / "failed" / "settled-empty" instead of rendering the business
  // empty-copy for all three.
  const useInjected = injectedRows != null;
  const { data, error, isLoading, mutate } = useSWR<CohortsResponse>(
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
  //
  // Fix #14: on the 'all stores' view (storeName === undefined) in per-store
  // COGS mode, blend each cohort month's rate by store revenue rather than
  // collapsing to stores[0] — otherwise one store's COGS rate is applied to
  // every store's pooled cohort revenue (wrong blended profit/LTV/payback when
  // stores diverge). Single-store view + business mode are unaffected.
  const cogsPctByMonth = useMemo<Record<string, number> | undefined>(() => {
    if (!cogs) return undefined;
    return blendedCogsPctByMonth(allRows, storeName, (store, m) =>
      effectiveCogsPct(cogs, store, m),
    );
  }, [cogs, storeName, allRows]);

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
  // The curve switches with the toggle (cumulative revenue vs profit per
  // customer). Mature basis = the same cohorts as the headline; fall back to the
  // all-cohort pooled curve only when there's no mature cohort (so the chart
  // isn't an empty flat line).
  const matureCurve = isProfit ? value.cumulativeProfitMature : value.cumulativeNetMature;
  const allCurve = isProfit ? value.cumulativeProfit : value.cumulativeNet;
  const hasMatureCurve = matureCurve.some((v) => v !== 0);
  const curvePoints = hasMatureCurve ? matureCurve : allCurve;
  // Headline שווי-לקוח NUMBER switches with the toggle (revenue or profit LTV).
  const displayLtv = isProfit ? value.ltv12Profit : value.ltv12Net;
  const ncac = value.blendedNcac;

  // ── B3: every PROFITABILITY element is PROFIT-pinned ──────────────────────
  // Revenue is not profit: 1.3× GROSS revenue with ~31.5% COGS+fees still owed
  // is NOT "profitable". So the ratio, badge, net-per-customer, payback and the
  // "losing/recovers" clause ALWAYS derive from profit (value.ltvToNcac /
  // value.paybackMonths are already profit-derived). The basis toggle re-skins
  // ONLY the curve + the headline שווי-לקוח number.
  const profitLtv = value.ltv12Profit;
  const ratio = value.ltvToNcac;
  const payback = value.paybackMonths;
  const tone = ratioTone(ratio);
  const losing = ratio != null && ratio < 1;
  const hasLtv = profitLtv != null;
  const hasNcac = ncac != null;
  // net-per-customer is ALWAYS profit-pinned (round(profitLtv) − round(ncac)).
  // NOTE: in NET (revenue) basis the headline displayLtv shows ltv12Net
  // (revenue), so this does NOT equal the displayed $LTV − $nCAC — that is the
  // intentional B3 design (revenue headline, profit verdict, framed by the
  // "ברווח נטו (אחרי עלויות)" clause). It reconciles with displayLtv − $nCAC
  // only in profit basis. A7: when losing but rounding lands on $0, floor to
  // −$1 so "$0 net" never sits beside a "losing" badge.
  const netPerCustomerRaw =
    hasLtv && hasNcac ? Math.round(profitLtv) - Math.round(ncac as number) : null;
  const netPerCustomer =
    netPerCustomerRaw != null && losing ? Math.min(-1, netPerCustomerRaw) : netPerCustomerRaw;
  const netIsGood = ratio != null ? ratio >= 1 : (netPerCustomer ?? 0) >= 0;
  // A7: 2 decimals near break-even so "0.97×"/"1.04×" never round to a "1.0×"
  // that contradicts the (raw-ratio) badge tone. Also floor the DISPLAYED ratio
  // below 1 when losing so a value like 0.997 can't render "1.00×" beside a
  // red "losing" badge (the same contradiction, pushed to the 2-decimal edge).
  const ratioShown = ratio == null ? null : losing ? Math.min(ratio, 0.99) : ratio;
  const ratioText =
    ratioShown == null ? null : ratioShown >= 0.9 && ratioShown < 1.1 ? ratioShown.toFixed(2) : ratioShown.toFixed(1);

  // Curve break-even line (nCAC) ONLY on the PROFIT curve (comparing a revenue
  // curve to acquisition cost is the B3 category error), and only when there's
  // a mature curve. 2026-06-10 audit (live-pass #2): the line used to be
  // suppressed when LOSING — exactly the case where the copy's "קו עלות-הגיוס"
  // matters most ("how far below break-even are we?"). The curve component
  // includes ncac in its y-domain (maxY = max(curve, ncac) × 1.12) so the line
  // always renders, sitting visibly ABOVE the curve when losing; no payback
  // crossing/callout is drawn because none exists (paybackMonths stays null).
  const curveNcac = isProfit && hasMatureCurve ? ncac : null;
  const curvePayback = isProfit ? payback : null;

  // ── A5: new-vs-old at the SHARED depth (no immature carry-forward) ────────
  const cmpDepth = value.newVsOld.cmpDepth;
  const recentHalf = isProfit ? value.newVsOld.recent.profit : value.newVsOld.recent.net;
  const oldHalf = isProfit ? value.newVsOld.old.profit : value.newVsOld.old.net;
  const recent3 = cmpDepth >= 0 ? recentHalf[cmpDepth] ?? 0 : 0;
  const old3 = cmpDepth >= 0 ? oldHalf[cmpDepth] ?? 0 : 0;
  // Gate the bars on the SAME condition as the sentence (no $0 veteran bar
  // beside "insufficient"): both halves must have real early value.
  const canCompare = cmpDepth >= 0 && old3 > 0 && recent3 > 0;
  const newVsOldDiff = canCompare ? Math.round(((recent3 - old3) / old3) * 100) : null;
  const cmpMax = Math.max(recent3, old3, 1);
  // Hebrew: singular for a count of 1 ("החודש הראשון"), plural otherwise.
  const cmpMonths = (cmpDepth >= 0 ? cmpDepth : 2) + 1;
  const cmpMonthsLabel = cmpMonths === 1 ? 'החודש הראשון' : `${cmpMonths} החודשים הראשונים`;

  // ── B1: are the RECENT cohorts already paying back the current nCAC? ──────
  // The headline LTV is mature-only (older, weaker cohorts) while nCAC is the
  // 2026 window. When recent cohorts' observed early PROFIT already clears nCAC,
  // an absolute "losing" badge is misleading → downgrade it + bridge to the
  // new-vs-old card.
  const recentEarlyProfit = cmpDepth >= 0 ? value.newVsOld.recent.profit[cmpDepth] ?? 0 : 0;
  const recentPaysBack = hasNcac && recentEarlyProfit >= (ncac as number);
  // Show the bridge when the verdict is "losing" on mature cohorts but the
  // recent cohorts are stronger (improving) — so the two cards don't contradict.
  // Gate on canCompare too: the bridge points the reader to the new-vs-old card,
  // so it must not render when that card shows its empty state (old3 ≤ 0).
  const showRecentBridge = losing && canCompare && (recentPaysBack || (newVsOldDiff != null && newVsOldDiff > 0));
  // B1 — downgrade the ABSOLUTE "losing" badge to a qualified amber one when the
  // recent cohorts already pay back: an absolute red "מפסידים" is misleading
  // when current acquisition is profitable and only the OLD (mature) cohorts lag.
  const badgeDowngraded = tone === 'bad' && recentPaysBack;
  const badgeTone: 'good' | 'warn' | 'bad' = badgeDowngraded ? 'warn' : tone === 'none' ? 'warn' : tone;
  const badgeText =
    tone === 'good'
      ? 'בריא ✓'
      : badgeDowngraded
        ? 'מבוסס על קבוצות בוגרות — החדשות חזקות יותר'
        : tone === 'bad'
          ? 'מתחת לסף הרווחיות — מפסידים על הגיוס'
          : 'רווחי · מתחת ליעד ×3';

  // Per-cohort nCAC grouped by cohort YEAR (DESC) — same regrouping as the
  // by-year cohort grid, so the footer reads consistently. Zero data loss.
  const ncacByYear = useMemo(
    () => groupNcacByYear(value.cohortNcac),
    [value.cohortNcac],
  );

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

  // ── P1-2 honest-state gates (SWR path only; injected rows bypass) ────────
  // ERROR (thrown !ok OR 200-with-error body) → explicit red strip + retry.
  // Pre-fix this rendered the "אין עדיין מספיק נתונים" business verdict —
  // a wrong diagnosis (DB blip ≠ immature cohorts) on a financial tab.
  if (!useInjected && (error || data?.error)) {
    return (
      <div className="space-y-4 sm:space-y-5 animate-fade-in-up">
        <SectionIntro
          icon={<Gem size={20} />}
          title="כמה שווה לך לקוח"
          description="כמה רווח לקוח חדש מכניס לאורך זמן, מול כמה עלה לגייס אותו — ואם הגיוס משתלם."
        />
        {/* Horizon re-skin (W5.3) — the bespoke red strip is replaced by the
            shared <StateBlock mode="error"> chrome (icon + AA-safe status-red
            trio + "נסה שוב" retry <Button>). The cv-error testid + role=alert
            stay on the wrapper so the honest-state contract is preserved; the
            full explanatory copy + the mono error detail ride in `message` as a
            composite node (no info loss — and this drains the file's lone
            sub-floor 10px mono offender onto the type-ramp). */}
        <div data-testid="cv-error" role="alert">
          <StateBlock
            mode="error"
            onRetry={() => mutate()}
            message={
              <div className="min-w-0">
                <div className="font-semibold">שגיאה בטעינת נתוני הלקוחות</div>
                <div className="mt-1 text-fs-2xs font-normal leading-relaxed opacity-80">
                  הקריאה ל-<code className="font-mono">/api/cohorts</code> נכשלה. זה לא אומר
                  שאין נתונים — זה אומר שהשרת לא ענה. נסה לרענן, ואם זה לא עוזר בדוק את הלוגים.
                </div>
                <div className="mt-1 font-mono text-fs-2xs font-normal opacity-60">
                  {error instanceof Error ? error.message : String(error ?? data?.error)}
                </div>
              </div>
            }
          />
        </div>
      </div>
    );
  }
  // LOADING → <StateBlock mode="skeleton"> (verdict + 4-up KPI silhouette),
  // never the business empty-copy. cv-loading + aria-busy stay on the wrapper.
  if (!useInjected && isLoading) {
    return (
      <div className="space-y-4 sm:space-y-5 animate-fade-in-up">
        <SectionIntro
          icon={<Gem size={20} />}
          title="כמה שווה לך לקוח"
          description="כמה רווח לקוח חדש מכניס לאורך זמן, מול כמה עלה לגייס אותו — ואם הגיוס משתלם."
        />
        <div data-testid="cv-loading" aria-busy="true" className="space-y-3">
          {/* Verdict-card silhouette. */}
          <div className="skeleton h-24 rounded-hz" aria-hidden />
          {/* 4-up KPI silhouette via the shared StateBlock card grid. */}
          <StateBlock mode="skeleton" shape="card" rows={4} message="טוען נתוני לקוחות…" />
          <div className="p-4 text-center text-fs-sm text-ink-muted">טוען נתוני לקוחות…</div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4 sm:space-y-5 animate-fade-in-up">
      <SectionIntro
        icon={<Gem size={20} />}
        title="כמה שווה לך לקוח"
        description="כמה רווח לקוח חדש מכניס לאורך זמן, מול כמה עלה לגייס אותו — ואם הגיוס משתלם."
        rightSlot={
          <div className="flex flex-wrap items-center gap-2">
            {/* DQ-6 (Wave 3 data-trust) — "עודכן ל-" freshness flag for the
                weekly cohort/LTV refresh. asOf comes from the /api/cohorts
                response; renders nothing when null (no successful refresh yet,
                or test-injected rows that bypass the SWR fetch). */}
            <CohortAsOfBadge asOf={data?.asOf ?? null} />
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
            {/* profit ↔ revenue basis toggle — SegmentedControl (radiogroup).
                Active pill = brand thumb + on-color ink (the primitive owns the
                AA-verified active state). Roving-tabindex + Arrow/Home/End nav. */}
            <SegmentedControl
              role="radiogroup"
              size="sm"
              aria-label="בסיס"
              options={[
                { value: 'profit', label: 'רווח', testId: 'cv-basis-profit' },
                { value: 'net', label: 'הכנסה', testId: 'cv-basis-revenue' },
              ]}
              value={basis}
              onChange={(v) => setBasis(v as Basis)}
            />
          </div>
        }
      />

      {/* 1. THE BOTTOM LINE — plain-Hebrew verdict.
          B3: the headline LTV NUMBER (displayLtv) switches with the basis
          toggle, but the profitability verdict (net / payback / ratio / badge)
          is ALWAYS profit-pinned (revenue is not profit). A4: the empty state
          names WHICH side is missing. B1: era-tag + a qualified badge + a bridge
          to the new-vs-old card when recent cohorts already pay back. */}
      <Card>
        <p data-testid="cv-verdict" className="text-fs-base sm:text-fs-md font-semibold leading-relaxed">
          {!hasLtv ? (
            // A4 — the missing side is the MATURE LTV, not the nCAC.
            <>
              <span className="text-ink-muted">
                {hasNcac ? (
                  <>
                    אין עדיין קבוצת לקוחות בוגרת (12 ח׳) לחישוב שווי-לקוח. עלות-הגיוס הנוכחית היא{' '}
                    <span className="font-extrabold text-ink">
                      <Money value={ncac} />
                    </span>
                    .{' '}
                  </>
                ) : (
                  'אין עדיין מספיק נתונים לחישוב שווי-לקוח. '
                )}
              </span>
              ו-<span className="font-extrabold tabular-nums text-ink">{pctText(value.repeatRate)}</span>{' '}
              חוזרים לקנות שוב.
            </>
          ) : (
            <>
              לקוח חדש שווה לך{' '}
              <span className={cn('font-extrabold', numClass(isProfit ? 'good' : 'accent'))}>
                <Money value={displayLtv} />
              </span>{' '}
              {basisLabel} לאורך שנה
              {hasNcac && (
                <>
                  , ועולה{' '}
                  <span className="font-extrabold text-ink">
                    <Money value={ncac} />
                  </span>{' '}
                  לגייס
                </>
              )}{' '}
              —{' '}
              {hasNcac ? (
                <>
                  ברווח נטו (אחרי עלויות),{' '}
                  {netIsGood ? (
                    <>
                      כל לקוח מכניס לך{' '}
                      <span className={cn('font-extrabold', numClass('good'))}>
                        <Money value={netPerCustomer} />
                      </span>
                      .{' '}
                    </>
                  ) : (
                    <>
                      כל לקוח{' '}
                      <span className={cn('font-extrabold', numClass('bad'))}>
                        מפסיד <Money value={netPerCustomer == null ? null : Math.abs(netPerCustomer)} />
                      </span>
                      .{' '}
                    </>
                  )}
                  {payback != null ? (
                    payback === 0 ? (
                      <>
                        הוא מחזיר את עלות הגיוס{' '}
                        <span className={cn('font-extrabold', numClass('accent'))}>כבר מההזמנה הראשונה</span>,{' '}
                      </>
                    ) : (
                      <>
                        הוא מחזיר את עלות הגיוס תוך{' '}
                        <span className={cn('font-extrabold', numClass('accent'))}>{payback}</span>{' '}
                        חודשים,{' '}
                      </>
                    )
                  ) : (
                    <>
                      <span className={cn('font-extrabold', numClass('bad'))}>
                        לא מחזיר את עלות הגיוס תוך שנה
                      </span>
                      ,{' '}
                    </>
                  )}
                </>
              ) : (
                <span className="text-ink-muted">אין עדיין נתוני עלות-גיוס. </span>
              )}
              ו-<span className="font-extrabold tabular-nums text-ink">{pctText(value.repeatRate)}</span>{' '}
              חוזרים לקנות שוב.
              {ratio != null && hasNcac && (
                <>
                  {' '}על כל <span className="font-extrabold tabular-nums text-ink">$1</span> פרסום אתה מקבל{' '}
                  <span className={cn('font-extrabold tabular-nums', numClass(tone))}>{ratioText}×</span>{' '}
                  ברווח-לקוח (LTV:nCAC)
                  {/* Trap #2 — the LTV:nCAC verdict badge migrates to the
                      <Badge> PRIMITIVE but KEEPS its SEMANTIC status tone
                      (green/warning/red). LTV:nCAC break-even is ×1 — a
                      DIFFERENT metric from ROAS's ×2/×3 bands — so it must NOT
                      use the band `chip-{band}` recipe (that's ROAS-keyed;
                      band-colouring this ratio would be a correctness lie). The
                      status-* trio still resolves to text-status-{red,warning,
                      green}Fg, which the DOM tests assert on. */}
                  {/* NOTE: no `text-fs-*` override here — the <Badge> base
                      already sizes the text (text-2xs), and adding a second
                      `text-*` size class makes tailwind-merge drop the tone's
                      `text-status-*Fg` COLOUR (same `text-` group), which the
                      DOM tests assert on. The pill geometry (rounded-full +
                      padding) + weight are layout/weight-group classes, so they
                      merge cleanly without touching the colour. */}
                  <Badge
                    data-testid="cv-ratio-badge"
                    tone={badgeTone === 'good' ? 'green' : badgeTone === 'bad' ? 'red' : 'warning'}
                    className="ms-1.5 rounded-full px-2.5 py-0.5 font-extrabold"
                  >
                    {badgeText}
                  </Badge>
                  {/* B1 — the headline LTV is restricted to mature (12mo+) cohorts. */}
                  <span className="ms-1.5 text-fs-xs font-normal text-ink-muted">
                    · מבוסס על קבוצות בוגרות (12 ח׳+)
                  </span>
                </>
              )}
              {/* B1 — bridge to the new-vs-old card so "losing" (old cohorts) and
                  "improving" (recent cohorts) never read as a contradiction. */}
              {showRecentBridge && (
                <span
                  data-testid="cv-recent-bridge"
                  className="mt-1.5 block text-fs-sm font-semibold text-status-greenFg"
                >
                  ↗ אבל הקבוצות שגייסת לאחרונה חזקות יותר
                  {newVsOldDiff != null && newVsOldDiff > 0 ? ` ב-${newVsOldDiff}%` : ''}
                  {recentPaysBack ? ' — והן כבר מחזירות את עלות-הגיוס בחודשים הראשונים' : ''}. ראו
                  ״לקוחות חדשים מול ותיקים״ למטה.
                </span>
              )}
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
            <Money value={displayLtv} />
          </div>
          <div className="mt-0.5 text-fs-xs text-ink-muted">
            כמה {basisLabel} ממוצע לקוח מכניס לאורך שנה
          </div>
        </Card>
        <Card data-testid="cv-kpi" className="p-4">
          <div className="text-xs font-semibold text-ink-secondary">עלות גיוס לקוח (nCAC)</div>
          <div data-testid="cv-kpi-cac" className="mt-1 text-2xl font-extrabold tracking-tight">
            <Money value={ncac} />
          </div>
          <div className="mt-0.5 text-fs-xs text-ink-muted">כמה שילמת בפרסום לכל לקוח חדש</div>
        </Card>
        <Card data-testid="cv-kpi" className="p-4">
          <div className="text-xs font-semibold text-ink-secondary">החזר עלות (payback)</div>
          <div data-testid="cv-kpi-payback" className="mt-1 text-2xl font-extrabold tracking-tight tabular-nums">
            {payback != null ? `${payback} ח׳` : '—'}
          </div>
          <div className="mt-0.5 text-fs-xs text-ink-muted">תוך כמה חודשים הרווח מכסה את הגיוס</div>
        </Card>
        <Card data-testid="cv-kpi" className="p-4">
          <div className="text-xs font-semibold text-ink-secondary">חוזרים לקנות (repeat)</div>
          <div data-testid="cv-kpi-repeat" className="mt-1 text-2xl font-extrabold tracking-tight tabular-nums">
            {pctText(value.repeatRate)}
          </div>
          <div className="mt-0.5 text-fs-xs text-ink-muted">אחוז שמזמינים שוב אחרי הראשונה</div>
        </Card>
      </div>

      {/* 3. THE CURVE. */}
      <Card>
        <h3 className="m-0 flex items-center gap-1.5 text-fs-base font-extrabold text-ink">
          העקומה: כמה לקוח מחזיר ככל שעובר הזמן
          <HelpTooltip
            variant="rich"
            title="על מה זה מתבסס"
            content={
              'הקו הסגול (הרווח המצטבר ללקוח) מחושב מ‏כל‏ היסטוריית ההזמנות ב-Shopify — שנים אחורה, לא רק ממאי. קו עלות-הגיוס (nCAC) הוא הבלנדי ה‏נוכחי‏: הוצאת הפרסום ÷ לקוחות חדשים, מנתוני ההוצאה שקיימים בדשבורד (מאי 2026 והלאה — חלון ההוצאה היחיד שיש). כלומר: רווח-חיי-הלקוח לאורך כל ההיסטוריה, מול כמה עולה לגייס לקוח היום. הערה: עלות-גיוס פר-קבוצה (בתצוגה המתקדמת) קיימת רק לקבוצות מ-מאי+; לקבוצות ישנות יש רווח/שימור אבל לא עלות-גיוס.'
            }
          >
            <span
              className="inline-flex h-4 w-4 cursor-help items-center justify-center rounded-full border border-glass-edge text-fs-2xs text-ink-muted"
              aria-label="הסבר על העקומה"
            >
              ?
            </span>
          </HelpTooltip>
        </h3>
        <p className="mb-2.5 mt-0.5 text-fs-xs text-ink-secondary">
          הקו עולה ככל שלקוחות חוזרים לקנות. כשהוא חוצה את <b>קו עלות-הגיוס</b> — הלקוח הפך לרווחי.
          משם זה {basisLabel} נקי.
        </p>
        <CustomerValueCurve
          points={curvePoints}
          // B3: the break-even line + zone split appear ONLY on the PROFIT curve
          // (curveNcac/curvePayback are null on the revenue curve — comparing a
          // revenue curve to acquisition cost is a category error). Also null
          // when there's no mature cohort (pooled fallback shape). When LOSING
          // the line still renders (above the curve — the y-domain includes
          // ncac) but no payback crossing/callout is drawn (none exists).
          ncac={curveNcac}
          paybackMonths={curvePayback}
          basisLabel={basisLabel}
        />
        {/* Legend — the zone swatches mirror the chart's pale background zones
            (status-warningBg / status-greenBg). A 1px status-* rim casing keeps
            each pale swatch perceivable (≥3:1 graphical) against the card
            surface in BOTH themes, so the legend never relies on a sub-3:1
            pale-on-pale fill alone. */}
        <div className="mt-2 flex flex-wrap gap-4 text-fs-xs text-ink-secondary">
          <span className="inline-flex items-center gap-1.5">
            <i className="inline-block h-[3px] w-3.5 rounded-sm bg-accent" /> {basisLabel} מצטבר ללקוח
          </span>
          <span className="inline-flex items-center gap-1.5">
            <i className="inline-block h-2.5 w-3.5 rounded-sm border border-status-warning bg-status-warningBg" /> עדיין מחזיר עלות
          </span>
          <span className="inline-flex items-center gap-1.5">
            <i className="inline-block h-2.5 w-3.5 rounded-sm border border-status-green bg-status-greenBg" /> רווח
          </span>
        </div>
      </Card>

      {/* 4. NEW vs OLD. */}
      <Card>
        <h3 className="m-0 text-fs-base font-extrabold text-ink">
          הלקוחות החדשים — טובים יותר או פחות מהוותיקים?
        </h3>
        <p className="mb-3 mt-0.5 text-fs-xs text-ink-secondary" data-testid="cv-newvsold-sub">
          {/* A5: gate on the SAME condition as the bars (canCompare); the label
              names the SHARED observed depth ("first N months"), not "last 3
              months" — the bucket is recent cohorts vs veterans, both observed
              for the same N months. */}
          {!canCompare || newVsOldDiff == null ? (
            'אין עדיין מספיק קבוצות בוגרות וחדשות להשוואה.'
          ) : newVsOldDiff >= 0 ? (
            <>
              הלקוחות שגייסת לאחרונה שווים{' '}
              <b className="text-status-greenFg">{newVsOldDiff}% יותר</b> ב{cmpMonthsLabel}{' '}
              מהוותיקים — איכות הגיוס משתפרת.
            </>
          ) : (
            <>
              הלקוחות שגייסת לאחרונה שווים{' '}
              <b className="text-status-redFg">{Math.abs(newVsOldDiff)}% פחות</b> ב{cmpMonthsLabel}{' '}
              מהוותיקים — שווה לבדוק את איכות הגיוס.
            </>
          )}
        </p>
        {canCompare && (
          <div className="flex flex-wrap items-center gap-4">
            <div className="min-w-[180px] flex-1">
              <div className="mb-1 flex justify-between text-xs text-ink-secondary">
                <span>חדשים ({cmpMonthsLabel}, {basisLabel})</span>
                <b className="text-ink" data-testid="cv-newvsold-recent">
                  <Money value={recent3} />
                </b>
              </div>
              {/* Recessed pill-track well (bg-pill-track) with a SEMANTIC fill:
                  recent = status-green (the stronger half), veteran = neutral
                  ink-muted. role="meter" so the proportion is announced. */}
              <div
                role="meter"
                aria-label={`חדשים — ${cmpMonthsLabel}`}
                aria-valuemin={0}
                aria-valuemax={Math.round(cmpMax)}
                aria-valuenow={Math.round(recent3)}
                className="h-3.5 overflow-hidden rounded-full bg-pill-track"
              >
                <div
                  className="h-full rounded-full bg-status-green"
                  style={{ width: `${(recent3 / cmpMax) * 100}%` }}
                />
              </div>
            </div>
            <div className="min-w-[180px] flex-1">
              <div className="mb-1 flex justify-between text-xs text-ink-secondary">
                <span>ותיקים ({cmpMonthsLabel}, {basisLabel})</span>
                <b className="text-ink" data-testid="cv-newvsold-old">
                  <Money value={old3} />
                </b>
              </div>
              <div
                role="meter"
                aria-label={`ותיקים — ${cmpMonthsLabel}`}
                aria-valuemin={0}
                aria-valuemax={Math.round(cmpMax)}
                aria-valuenow={Math.round(old3)}
                className="h-3.5 overflow-hidden rounded-full bg-pill-track"
              >
                <div
                  className="h-full rounded-full bg-ink-muted"
                  style={{ width: `${(old3 / cmpMax) * 100}%` }}
                />
              </div>
            </div>
          </div>
        )}
      </Card>

      {/* 5. ADVANCED — collapsed cohort grid (no info loss). */}
      <Card>
        <details data-testid="cv-advanced" className="group">
          {/* The static `▸` glyph (never rotated) is replaced by a lucide
              <ChevronDown> that rotates 180° when the <details> is open
              (group-open:rotate-180), matching the cohort-year accordion. */}
          <summary className="flex cursor-pointer list-none items-center gap-1.5 text-fs-sm font-bold text-accent marker:hidden [&::-webkit-details-marker]:hidden">
            <ChevronDown
              size={15}
              className="shrink-0 transition-transform duration-snap group-open:rotate-180"
              aria-hidden="true"
            />
            תצוגה מתקדמת — רשת ה-cohorts המלאה (לחובבי דאטה)
          </summary>
          <div className="mt-3">
            <p className="text-fs-xs text-ink-secondary">
              שורה = חודש הזמנה-ראשונה · עמודה = חודשים-מאז (M0=הרכישה). תא = % שחזרו לקנות. כלי
              לאנליסט — לא חובה ליומיום.
            </p>
            <CohortGridAdvanced rows={scopedRows} todayMonth={refMonth} />
          </div>
        </details>
        {/* Per-cohort nCAC availability — pre-May cohorts have no ad-spend.
            Grouped by cohort YEAR (DESC), mirroring the by-year cohort grid. */}
        <div className="mt-3 border-t border-glass-edge pt-3 text-fs-xs leading-relaxed text-ink-muted">
          עלות-גיוס לכל קבוצה (nCAC) זמינה רק מ-מאי 2026 והלאה (תקופת היסטוריית הפרסום). לקבוצות
          ישנות יותר מוצג{' '}
          <span className="font-semibold text-ink-secondary">אין נתוני הוצאה</span> במדד עלות-הגיוס.
          {ncacByYear.length > 0 && (
            <div className="mt-2 space-y-2">
              {ncacByYear.map((yg) => (
                <div key={yg.year} data-testid={`cv-ncac-year-${yg.year}`}>
                  <div className="mb-1 text-2xs font-bold tabular-nums text-ink-secondary">
                    {yg.year}
                  </div>
                  <ul className="flex flex-wrap gap-x-4 gap-y-1">
                    {yg.items.map((c) => (
                      <li
                        key={c.firstOrderMonth}
                        className="inline-flex items-center gap-1.5 tabular-nums"
                      >
                        <span className="font-semibold text-ink-secondary">{c.firstOrderMonth}</span>
                        {c.nCac == null ? (
                          <span className="text-ink-muted">אין נתוני הוצאה</span>
                        ) : (
                          <span className="text-ink">
                            <Money value={c.nCac} />
                            {/* A2 — the current month is month-to-date spend ÷
                                full-month M0, so its per-cohort nCAC is not yet
                                settled. Flag it instead of showing a final-looking
                                figure. */}
                            {c.firstOrderMonth === refMonth && (
                              <span className="ms-1 text-ink-muted">(חלקי)</span>
                            )}
                          </span>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          )}
        </div>
      </Card>
    </div>
  );
}
