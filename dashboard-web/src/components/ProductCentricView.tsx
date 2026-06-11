'use client';

/**
 * Phase 05.7.x (2026-05-23) — Product-centric pivot view.
 *
 * The dashboard's campaigns table is campaign-centric: one row per
 * campaign. This component pivots: one row per PRODUCT, expandable to
 * show the full cohort of campaigns promoting it across platforms.
 *
 * Lives inside the Products tab as a sub-section. Default filter:
 * only multi-mapped products (>= 2 campaigns).
 *
 * Self-contained data fetching: SWR over /api/campaigns + /api/products,
 * range-keyed so a date-range change triggers a refetch. Both routes
 * are also fetched by CampaignsTable / ProductsTable so SWR dedupes —
 * no duplicate network cost.
 */

import { Fragment, useEffect, useMemo, useState, type ReactNode } from 'react';
import useSWR from 'swr';
import { AlertTriangle, ChevronDown, ChevronLeft, Info, Package, RefreshCw, Trophy } from 'lucide-react';
import { cn } from '@/lib/utils';
import { fetchJsonStrict } from '@/lib/fetchJson';
import { fmtMoney, fmtMoneyString } from '@/lib/format';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { TableBase } from '@/components/ui/TableBase';
import { Heading } from '@/components/ui/Typography';
import { HelpTooltip } from '@/components/ui/Tooltip';
import { buildProductCentricView, type ProductCohortRow } from '@/lib/productCentricView';
import { aggregate } from '@/lib/campaignsAggregator';
import { readProductMap, type ProductMap } from '@/lib/campaignProductMap';
import { buildDateRangeKey } from '@/lib/dateRange';
import type { CampaignsResponse } from '@/app/api/campaigns/route';
import type { ProductsResponse } from '@/app/api/products/route';
import type { OrdersAttributionResponse } from '@/app/api/orders-attribution/route';

type Props = {
  storeId: string; // 'All' rendered as a hint to pick a store
  range: { from: string; to: string };
  /** Optional override — if not provided, reads from localStorage. */
  productMap?: ProductMap;
};

// P1-4a (2026-06-10 state-honesty sweep) — pre-fix this returned `null` on
// `!r.ok`, which left the view stuck on 'טוען…' FOREVER (data never arrives,
// no error ever fires), and a degraded 200 + { rows: [], error } body read as
// the 'אין מיפויים פעילים' business verdict. fetchJsonStrict throws on both so
// SWR's `error` state activates and the explicit error branch below renders.
const fetcher = <T,>(url: string): Promise<T> => fetchJsonStrict<T>(url);

function fmtPct(n: number): string {
  if (!Number.isFinite(n) || n === 0) return '0%';
  return `${Math.round(n * 100)}%`;
}

function fmtRoas(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '—';
  return n.toFixed(2);
}

// Pixel-vs-Shopify attribution delta — answers "does Meta/Google/TikTok see
// reality the way Shopify does?". A big negative means the platform's pixel
// missed sales that Shopify recorded (classic iOS14+ / Safari ITP attribution
// loss). A big positive means the platform over-counts (view-through, dupe
// pixel firing, or revenue attributed to a campaign that didn't really drive
// it). Near zero is the healthy state.
//
// `platformValue` is `conversionValue` (what Meta/Google/TikTok claims).
// `shopifyValue` is `allocatedRevenueEstimate` (Shopify ground-truth allocated
// to this campaign by the cohort allocator). Both already in CAD via the
// existing fetcher → upstream conversion path.
//
// The tooltip body returns a structured ReactNode (not a string) because a
// single-paragraph mix of Hebrew + LTR CAD numbers + percentages breaks the
// browser's bidi algorithm visually (numbers can render in unexpected order
// and the eye stumbles). The body is laid out as a small stat block + a
// one-line conclusion so each side reads cleanly in its own direction.
function fmtCad(n: number): string {
  // Wave 4 / Task 4.3 — route through fmtMoneyString so the CAD prefix +
  // numeric rounding rules stay in lock-step with fmtMoney's JSX sibling.
  // Render sites still pair with `<bdi dir="ltr">` per the original note.
  return fmtMoneyString(n);
}

function statBlock(rows: Array<{ label: string; value: string; emphasis?: boolean }>): ReactNode {
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 my-2 text-[11px]">
      {rows.map((r) => (
        <Fragment key={r.label}>
          <dt className="text-ink-muted">{r.label}</dt>
          <dd
            className={cn(
              'text-end tabular-nums',
              r.emphasis ? 'text-ink font-semibold' : 'text-ink-secondary',
            )}
          >
            <bdi dir="ltr">{r.value}</bdi>
          </dd>
        </Fragment>
      ))}
    </dl>
  );
}

function pixelShopifyDelta(
  platformValue: number,
  shopifyValue: number,
  // P1-25 (2026-06-10 audit, bbadd3c class): the "בלבד" chip used to hardcode
  // the literal "Meta" — a Google PMax row was labeled as Meta-only. The
  // caller passes the row's platform group name. Guarded by the P1-25
  // grep-guard in attributionPlatformTagging.test.ts.
  platform: string = 'הפלטפורמה',
): { text: string; tone: 'good' | 'warn' | 'bad' | 'neutral'; tooltip: ReactNode } {
  const platformValid = Number.isFinite(platformValue) && platformValue > 0;
  const shopifyValid = Number.isFinite(shopifyValue) && shopifyValue > 0;

  if (!platformValid && !shopifyValid) {
    return {
      text: '—',
      tone: 'neutral',
      tooltip: (
        <div>אין נתונים: לא ה-pixel ולא Shopify מייחסים הזמנות לקמפיין הזה בטווח שנבחר.</div>
      ),
    };
  }
  if (!platformValid && shopifyValid) {
    // Pixel reported nothing while Shopify has real revenue. Classic iOS14+
    // attribution loss — the most operationally important state to surface.
    return {
      text: 'pixel ריק',
      tone: 'bad',
      tooltip: (
        <div>
          <div>ה-pixel דיווח על 0 הכנסות, אבל ב-Shopify יש מכירות אמיתיות שהקמפיין הביא:</div>
          {statBlock([
            { label: 'pixel', value: fmtCad(0) },
            { label: 'Shopify', value: fmtCad(shopifyValue), emphasis: true },
          ])}
          <div>סימן קלאסי של iOS14+ / Safari ITP / ad-blocker — אל תאמין למספרים ב-Ads Manager לקמפיין הזה.</div>
        </div>
      ),
    };
  }
  if (platformValid && !shopifyValid) {
    // Platform claims revenue but Shopify has none allocated. Could mean the
    // product didn't actually sell (platform attributing the wrong product) or
    // sales went to other products that aren't mapped to this campaign.
    return {
      text: `${platform} בלבד`,
      tone: 'warn',
      tooltip: (
        <div>
          <div>הפלטפורמה דיווחה הכנסות, אבל Shopify לא הקצה למוצר הזה דרך הקמפיין:</div>
          {statBlock([
            { label: 'pixel', value: fmtCad(platformValue), emphasis: true },
            { label: 'Shopify', value: fmtCad(0) },
          ])}
          <div>או שהפלטפורמה מייחסת לקמפיין מכירות של מוצרים אחרים, או שהמיפוי לא תופס את המוצר האמיתי שנמכר.</div>
        </div>
      ),
    };
  }

  // Both sides have positive values — compute relative delta.
  const delta = (platformValue - shopifyValue) / shopifyValue;
  const absPct = Math.round(Math.abs(delta) * 100);
  const sign = delta > 0 ? '+' : '−';
  const pctStr = `${sign}${absPct}%`;

  // Thresholds calibrated to attribution noise:
  // - |delta| < 10%: normal variance — render as "תואם", quiet OK signal.
  // - 10% ≤ |delta| < 25%: mild drift, amber + number.
  // - |delta| ≥ 25%: meaningful attribution issue, red + number.
  if (absPct < 10) {
    return {
      text: 'תואם',
      tone: 'good',
      tooltip: (
        <div>
          <div>ה-attribution של הקמפיין תקינה — הפער בתוך טווח רעש סביר:</div>
          {statBlock([
            { label: 'pixel', value: fmtCad(platformValue) },
            { label: 'Shopify', value: fmtCad(shopifyValue) },
            { label: 'פער', value: pctStr },
          ])}
        </div>
      ),
    };
  }
  const tone: 'warn' | 'bad' = absPct >= 25 ? 'bad' : 'warn';
  const conclusion = delta > 0
    ? 'הפלטפורמה מדווחת יותר ממה שבאמת קרה — לרוב view-through או dedup לקוי.'
    : 'הפלטפורמה מדווחת פחות ממה שבאמת קרה — attribution loss של ה-pixel.';
  return {
    text: pctStr,
    tone,
    tooltip: (
      <div>
        {statBlock([
          { label: 'pixel', value: fmtCad(platformValue), emphasis: delta > 0 },
          { label: 'Shopify', value: fmtCad(shopifyValue), emphasis: delta < 0 },
          { label: 'פער', value: pctStr, emphasis: true },
        ])}
        <div>{conclusion}</div>
      </div>
    ),
  };
}

export function ProductCentricView({ storeId, range, productMap: propMap }: Props) {
  const [productMap, setProductMap] = useState<ProductMap>(() => propMap ?? readProductMap());

  // Subscribe to local productMap changes (operator edits a mapping in
  // the drawer → cloud-sync writes localStorage → fires this event).
  useEffect(() => {
    if (propMap) {
      setProductMap(propMap);
      return;
    }
    function onChange() {
      setProductMap(readProductMap());
    }
    window.addEventListener('roas-campaign-product-map-changed', onChange);
    return () => window.removeEventListener('roas-campaign-product-map-changed', onChange);
  }, [propMap]);

  const isAllStores = storeId === 'All';

  // Range-keyed SWR fetches. SWR dedupes against CampaignsTable /
  // ProductsTable fetching the same range.
  // P1-4a — read error + mutate for the two REQUIRED feeds (campaigns +
  // products gate the whole pivot); their failure renders the explicit error
  // branch below instead of an infinite 'טוען…'. orders-attribution + catalog
  // are enrichment-only (allocation column / title fallback) and keep
  // degrading softly to undefined.
  const {
    data: campaignsData,
    error: campaignsError,
    mutate: mutateCampaigns,
  } = useSWR<CampaignsResponse | null>(
    !isAllStores ? buildDateRangeKey('/api/campaigns', range) : null,
    fetcher,
    { revalidateOnFocus: false, dedupingInterval: 60_000 },
  );
  const {
    data: productsData,
    error: productsError,
    mutate: mutateProducts,
  } = useSWR<ProductsResponse | null>(
    !isAllStores ? buildDateRangeKey('/api/products', range) : null,
    fetcher,
    { revalidateOnFocus: false, dedupingInterval: 60_000 },
  );
  // 2026-06-09 (Task 5): orders-attribution with line items, so this view runs
  // the SAME deterministic-first allocator the CampaignDrawer cohort uses
  // (click-id-credited revenue first, spend-proportional remainder) instead of
  // the simplified spend-split. `&lineItems=true` mirrors the drawer fetch.
  const { data: ordersAttrData } = useSWR<OrdersAttributionResponse | null>(
    !isAllStores ? `${buildDateRangeKey('/api/orders-attribution', range)}&lineItems=true` : null,
    fetcher,
    { revalidateOnFocus: false, dedupingInterval: 60_000 },
  );

  // Phase 13.10 (2026-05-27) — also pull the catalog so the title fallback
  // works for products that haven't sold yet. products_daily only contains
  // rows for products that had at least one order in the range; mapping a
  // fresh campaign to a brand-new product would otherwise render the bare
  // numeric productId. /api/product-catalog has every Shopify product
  // (active + draft), so it bridges the gap.
  const { data: catalogData } = useSWR<{ rows: Array<{ productId: string; storeName: string; title: string }> } | null>(
    !isAllStores ? '/api/product-catalog' : null,
    fetcher,
    { revalidateOnFocus: false, dedupingInterval: 60_000 },
  );

  // Aggregate campaigns → Aggregated[] for the pure function.
  const aggregated = useMemo(() => {
    if (isAllStores || !campaignsData?.rows) return [];
    // Phase 12.5.x (2026-05-24) — pass currentEffectiveStatus so the
    // product-centric view's "כבוי" indicators reflect the current platform
    // state, not the in-range stale status. Same fix as CampaignsTable.
    return aggregate(
      campaignsData.rows,
      'campaign',
      storeId,
      'all',
      range,
      campaignsData.currentEffectiveStatus,
    );
  }, [campaignsData, storeId, range, isAllStores]);

  // Sum net revenue per product (across days) + collect titles.
  // 2026-06-09 (Task 6): null net_revenue falls back to GROSS revenue, matching
  // the CampaignDrawer cohort allocator (`p.netRevenue ?? p.revenue`). Pre-fix
  // this view used `?? 0`, so a legacy null-net row contributed 0 here but gross
  // in the drawer — two different net totals from the same products_daily rows.
  const productNetRevenue = useMemo(() => {
    const out = new Map<string, number>();
    if (isAllStores || !productsData?.rows) return out;
    for (const r of productsData.rows) {
      if (r.storeName !== storeId) continue;
      out.set(r.productId, (out.get(r.productId) ?? 0) + (r.netRevenue ?? r.revenue));
    }
    return out;
  }, [productsData, storeId, isAllStores]);

  // Per-product units sold (2026-06-09, Task 5) — fed to the allocator alongside
  // orders so the deterministic-first split can run (matches the drawer).
  const productUnits = useMemo(() => {
    const out = new Map<string, number>();
    if (isAllStores || !productsData?.rows) return out;
    for (const r of productsData.rows) {
      if (r.storeName !== storeId) continue;
      out.set(r.productId, (out.get(r.productId) ?? 0) + r.units);
    }
    return out;
  }, [productsData, storeId, isAllStores]);

  const productTitles = useMemo(() => {
    const out = new Map<string, string>();
    if (isAllStores) return out;
    // Phase 13.10 (2026-05-27) — products_daily titles take priority (they
    // reflect the title at sale-time, which can differ from the live
    // catalog title if the operator renamed the product mid-range). Fall
    // back to the catalog for products that have a mapping but haven't
    // sold yet — otherwise the UI renders the raw numeric productId.
    for (const r of productsData?.rows ?? []) {
      if (r.storeName !== storeId) continue;
      if (!out.has(r.productId) && r.productTitle) out.set(r.productId, r.productTitle);
    }
    for (const r of catalogData?.rows ?? []) {
      if (r.storeName !== storeId) continue;
      if (!out.has(r.productId) && r.title) out.set(r.productId, r.title);
    }
    return out;
  }, [productsData, catalogData, storeId, isAllStores]);

  // Resolve storeId from storeName via the campaigns response (campaigns
  // rows carry both storeId + storeName). Falls back to lowercased
  // storeName when no match (very rare).
  const internalStoreId = useMemo(() => {
    const fromCampaigns = (campaignsData?.rows ?? []).find(r => r.storeName === storeId);
    if (fromCampaigns) return fromCampaigns.storeId;
    return storeId.toLowerCase();
  }, [campaignsData, storeId]);

  // Operator-reported 2026-05-26: default-hiding solo-mapped products meant
  // a store with only solo mappings (e.g. Zol Plus had 7 solos, 0 multi)
  // rendered an empty "אין מוצרים עם 2+ קמפיינים" message — looked like
  // the panel was broken even when mappings were present. Default to
  // showing everything; the checkbox now opts INTO the multi-only filter
  // when the operator specifically wants the cohort lens.
  const [showSolo, setShowSolo] = useState(true);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());

  // Map orders to the allocator's order shape (same as the drawer), scoped to
  // this store's internal id + the visible range (2026-06-09, Task 5).
  const ordersForAllocator = useMemo(
    () =>
      (ordersAttrData?.rows ?? [])
        .filter(o => o.storeId === internalStoreId)
        .filter(o => o.date >= range.from && o.date <= range.to)
        .map(o => ({
          storeId: o.storeId,
          source: o.source,
          fbclidPresent: o.fbclidPresent,
          gclidPresent: o.gclidPresent,
          lineItems: o.lineItems ?? [],
        })),
    [ordersAttrData, internalStoreId, range.from, range.to],
  );

  const allRows = useMemo(
    () =>
      buildProductCentricView({
        storeId: internalStoreId,
        productMap,
        aggregated,
        productNetRevenue,
        productTitles,
        productUnits,
        orders: ordersForAllocator,
      }),
    [internalStoreId, productMap, aggregated, productNetRevenue, productTitles, productUnits, ordersForAllocator],
  );

  const rows = useMemo(
    () => (showSolo ? allRows : allRows.filter(r => r.isMultiMapped)),
    [allRows, showSolo],
  );

  const multiCount = allRows.filter(r => r.isMultiMapped).length;
  const soloCount = allRows.length - multiCount;

  function toggleExpand(productId: string) {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(productId)) next.delete(productId);
      else next.add(productId);
      return next;
    });
  }

  if (isAllStores) {
    return (
      <section className="rounded-2xl bg-glass-1 border border-glass-edge shadow-glass p-4 sm:p-5">
        <Heading level="section" className="inline-flex items-center gap-2 mb-1.5">
          <Package size={16} className="text-ink-secondary" />
          מוצרים → קמפיינים
        </Heading>
        <div className="text-sm text-ink-muted">
          בחר חנות ספציפית בפילטר העליון כדי לראות את הפיבוט. (מיפויים הם לפי
          חנות; ב-"All" אין דרך לאחד.)
        </div>
      </section>
    );
  }

  // P1-4a — explicit error branch BEFORE the loading gate. Pre-fix a failed
  // fetch resolved to null → `!campaignsData` stayed true forever → infinite
  // 'טוען…' with no signal that anything broke.
  if (campaignsError || productsError) {
    const err = campaignsError ?? productsError;
    return (
      <section className="rounded-2xl bg-glass-1 border border-glass-edge shadow-glass p-4 sm:p-5">
        <Heading level="section" className="inline-flex items-center gap-2 mb-2">
          <Package size={16} className="text-ink-secondary" />
          מוצרים → קמפיינים
        </Heading>
        <div
          role="alert"
          data-testid="pcv-error"
          className="rounded-xl border border-status-red bg-status-redBg text-status-redFg px-4 py-4"
        >
          <div className="flex items-start gap-2.5">
            <AlertTriangle size={18} className="shrink-0 mt-0.5" />
            <div className="min-w-0 flex-1">
              <div className="font-semibold text-[13px]">שגיאה בטעינת נתוני הפיבוט</div>
              <div className="text-[11px] opacity-80 mt-1 leading-relaxed">
                הקריאה ל-
                <code className="font-mono">
                  {campaignsError ? '/api/campaigns' : '/api/products'}
                </code>{' '}
                נכשלה. זה לא אומר שאין מיפויים — זה אומר שהשרת לא ענה. נסה לרענן.
              </div>
              <div className="text-[10px] opacity-60 mt-1 font-mono">
                {err instanceof Error ? err.message : String(err)}
              </div>
              <Button
                type="button"
                variant="secondary"
                onClick={() => {
                  void mutateCampaigns();
                  void mutateProducts();
                }}
                className="mt-3 gap-1.5 text-[12px]"
              >
                <RefreshCw size={12} />
                נסה שוב
              </Button>
            </div>
          </div>
        </div>
      </section>
    );
  }

  if (!campaignsData || !productsData) {
    return (
      <section className="rounded-2xl bg-glass-1 border border-glass-edge shadow-glass p-4 sm:p-5">
        <div className="text-sm text-ink-muted">טוען…</div>
      </section>
    );
  }

  if (allRows.length === 0) {
    return (
      <section className="rounded-2xl bg-glass-1 border border-glass-edge shadow-glass p-4 sm:p-5">
        <Heading level="section" className="inline-flex items-center gap-2 mb-1.5">
          <Package size={16} className="text-ink-secondary" />
          מוצרים → קמפיינים
        </Heading>
        <div className="text-sm text-ink-muted">
          אין מיפויים פעילים. ברגע שתוסיף מיפוי דרך מגירת הקמפיין, הוא יופיע כאן.
        </div>
      </section>
    );
  }

  return (
    <section className="rounded-2xl bg-glass-1 border border-glass-edge shadow-glass p-4 sm:p-5">
      <div className="flex items-center justify-between gap-3 mb-3">
        <Heading level="section" className="inline-flex items-center gap-2">
          <Package size={16} className="text-ink-secondary" />
          מוצרים → קמפיינים
          <span className="text-[11px] font-normal text-ink-muted">
            ({multiCount} עם 2+ קמפיינים{soloCount > 0 ? ` · ${soloCount} עם קמפיין אחד` : ''})
          </span>
        </Heading>
        {soloCount > 0 && (
          <label className="inline-flex items-center gap-1.5 text-xs text-ink-secondary cursor-pointer">
            <Input
              type="checkbox"
              checked={showSolo}
              onChange={e => setShowSolo(e.target.checked)}
              className="rounded border-glass-edge"
            />
            הצג גם מוצרים עם קמפיין אחד
          </label>
        )}
      </div>

      {rows.length === 0 ? (
        <div className="text-sm text-ink-muted text-center py-6">
          אין מוצרים עם 2+ קמפיינים בטווח שנבחר. בטל את הסימון של התיבה למעלה כדי לראות גם מוצרים עם קמפיין אחד.
        </div>
      ) : (
        <ul className="space-y-2">
          {rows.map(row => (
            <ProductRow
              key={row.productId}
              row={row}
              expanded={expanded.has(row.productId)}
              onToggle={() => toggleExpand(row.productId)}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

function ProductRow({
  row,
  expanded,
  onToggle,
}: {
  row: ProductCohortRow;
  expanded: boolean;
  onToggle: () => void;
}) {
  // overflow:hidden removed (2026-05-26): it was clipping the column-help
  // tooltips inside the expanded section. We compensate by adding matching
  // rounded corners directly to the inner button + expanded panel so the
  // hover bg / panel bg honors the rounded outer border.
  return (
    <li className="rounded-lg border border-glass-edge">
      <Button
        type="button"
        variant="ghost"
        onClick={onToggle}
        className={cn(
          'w-full justify-start h-auto gap-3 px-3 py-2.5',
          expanded ? 'rounded-t-lg' : 'rounded-lg',
        )}
      >
        <span className="shrink-0 text-ink-muted">
          {expanded ? <ChevronDown size={14} /> : <ChevronLeft size={14} />}
        </span>
        <div className="min-w-0 flex-1">
          <HelpTooltip content={row.productTitle}>
            <div className="text-sm font-semibold text-ink truncate">
              {row.productTitle}
              {row.isMultiMapped && (
                <span className="inline-block text-[10px] font-bold tracking-wider align-middle bg-status-warningBg text-status-warningFg px-1.5 py-0.5 rounded ms-2">
                  🔗 {row.members.length} קמפיינים
                </span>
              )}
            </div>
          </HelpTooltip>
          <div className="text-[11px] text-ink-muted tabular-nums">
            הוצאת קבוצה: {fmtMoney(row.totalCohortSpend)} · הכנסות נטו:{' '}
            {fmtMoney(row.totalNetRevenue)} · ROAS משוקלל:{' '}
            <strong className="text-ink-secondary">{fmtRoas(row.blendedRoas)}</strong>
          </div>
        </div>
        {row.byPlatform.length > 0 && (
          <div className="hidden sm:flex items-center gap-1.5 text-[10px] text-ink-muted shrink-0">
            {row.byPlatform.map(p => (
              <span key={p.platform} className="bg-glass-2 px-1.5 py-0.5 rounded">
                {p.platform}: {p.members.length}
              </span>
            ))}
          </div>
        )}
      </Button>

      {expanded && (
        <div className="px-3 pb-3 pt-1 space-y-3 bg-glass-2/20 rounded-b-lg">
          {row.byPlatform.map(platformGroup => (
            <div key={platformGroup.platform}>
              <div className="flex items-center justify-between gap-2 mb-1.5 text-[11px]">
                <span className="font-semibold text-ink inline-flex items-center gap-1.5">
                  <Trophy size={12} className="text-ink-muted" />
                  {platformGroup.platform} ({platformGroup.members.length})
                </span>
                <span className="text-ink-muted tabular-nums">
                  הוצאת פלטפ.: {fmtMoney(platformGroup.intraSpend)} · הכנסה מוקצית:
                  {' '}{fmtMoney(platformGroup.intraAllocatedRevenue)}
                </span>
              </div>
              <div className="overflow-x-auto -mx-2 sm:mx-0">
              <TableBase className="text-xs" minWidth={480} stickyHeader>
                <thead className="bg-glass-2/60 text-ink-muted">
                  <tr>
                    <th className="px-2 py-1 text-start font-medium text-[10px]">
                      <ColHelp
                        label="קמפיין"
                        align="start"
                        body={
                          <>
                            שם הקמפיין שמקדם את המוצר הזה בפלטפורמה הזו. אייקון 🥇 = הקמפיין עם
                            ההוצאה הגבוהה ביותר בתוך הקבוצה (cohort) של המוצר.
                          </>
                        }
                      />
                    </th>
                    <th className="px-2 py-1 text-end font-medium text-[10px]">
                      <ColHelp
                        label="הוצאה"
                        body={
                          <>
                            סך מה שהוצאת על הקמפיין הזה בטווח שנבחר, ב-CAD לאחר המרה מהמטבע
                            המקורי של הפלטפורמה. מקור: <code dir="ltr" className="text-ink-secondary">data_daily</code>.
                          </>
                        }
                      />
                    </th>
                    <th className="px-2 py-1 text-end font-medium text-[10px]">
                      <ColHelp
                        label="חלק (פנים-פלטפ.)"
                        body={
                          <>
                            איזה אחוז מהוצאת המוצר <strong>באותה פלטפורמה</strong> שייך לקמפיין
                            הזה. דוגמה: 60% ב-Meta אומר שהקמפיין הוא 60% מסך הוצאת Meta על המוצר.
                            נוסחה:{' '}
                            <code dir="ltr" className="text-ink-secondary">
                              spend / Σ spend (same platform, same product)
                            </code>
                            .
                          </>
                        }
                      />
                    </th>
                    <th className="px-2 py-1 text-end font-medium text-[10px]">
                      <ColHelp
                        label="חלק (כללי)"
                        body={
                          <>
                            איזה אחוז מסך ההוצאה <strong>של כל הקמפיינים</strong> על המוצר (כל
                            הפלטפורמות יחד) שייך לקמפיין הזה. מאפשר השוואה cross-platform.
                            נוסחה:{' '}
                            <code dir="ltr" className="text-ink-secondary">
                              spend / cohort total spend
                            </code>
                            .
                          </>
                        }
                      />
                    </th>
                    <th className="px-2 py-1 text-end font-medium text-[10px]">
                      <ColHelp
                        label="הכנסה מוקצית"
                        body={
                          <>
                            כמה הקמפיין הזה הביא בפועל מהמוצר <strong>לפי Shopify</strong>, אחרי
                            שה-allocator מחלק את ההכנסות בין הקמפיינים בקוהורט. הסדר: קודם
                            ההזמנות שיוחסו דטרמיניסטית (fbclid/gclid/ttclid), אז השאר מתחלק
                            פרופורציונלית ל-spend. נוסחה מקורבת:{' '}
                            <code dir="ltr" className="text-ink-secondary">
                              Shopify net × intra-platform spend share
                            </code>
                            .
                          </>
                        }
                      />
                    </th>
                    <th className="px-2 py-1 text-end font-medium text-[10px]">
                      <ColHelp
                        label="הכנסה פלטפ."
                        body={
                          <>
                            ה-<strong>conversionValue</strong> ש-Meta/Google/TikTok דיווחו
                            לקמפיין בפיקסל שלהם, ב-CAD. זה מה שתראה ב-Ads Manager של הפלטפורמה.
                            לרוב <strong>שונה</strong> מ-"הכנסה מוקצית" כי ה-pixel מאבד הזמנות
                            של גולשי iOS14+ / Safari ITP / ad-blockers. ההפרש המספרי בין השתי
                            העמודות הזו מגיע בעמודת "פער pixel↔Shopify" משמאל.
                          </>
                        }
                      />
                    </th>
                    <th className="px-2 py-1 text-end font-medium text-[10px]">
                      <ColHelp
                        label="ROAS פלטפ."
                        body={
                          <>
                            ה-ROAS לפי <strong>ה-pixel של הפלטפורמה</strong> (Meta/Google/TikTok)
                            — לא לפי Shopify. נוסחה:{' '}
                            <code dir="ltr" className="text-ink-secondary">
                              conversionValue / spend
                            </code>
                            . שונה מ-ROAS משוקלל בסיכום (שמבוסס Shopify אמיתי). פער גדול בין
                            השניים = ה-pixel לא תופס את כל המכירות (iOS14+, ITP, ad-blocker).
                          </>
                        }
                      />
                    </th>
                    <th className="px-2 py-1 text-end font-medium text-[10px]">
                      <ColHelp
                        label="פער pixel↔Shopify"
                        body={
                          <>
                            ההפרש היחסי בין ההכנסה ש-pixel דיווח להכנסה המוקצית מ-Shopify.
                            נוסחה:{' '}
                            <code dir="ltr" className="text-ink-secondary">
                              (pixel − Shopify) / Shopify
                            </code>
                            .
                            <span className="block mt-2">
                              <span className="text-status-greenFg">תואם</span> = פער &lt; 10%
                              (תקין).{' '}
                              <span className="text-status-orangeFg">±10–25%</span> = סטייה
                              בינונית.{' '}
                              <span className="text-status-redFg">±25%+</span> /{' '}
                              <span className="text-status-redFg">pixel ריק</span> = הקמפיין הזה
                              לא משקף נכון את המכירות, סמוך על ROAS משוקלל.
                            </span>
                          </>
                        }
                      />
                    </th>
                    <th className="px-2 py-1 text-end font-medium text-[10px]">
                      <ColHelp
                        label="סטטוס"
                        body={
                          <>
                            המצב הנוכחי של הקמפיין ב-Ads Manager של הפלטפורמה. ✓ פעיל =
                            מתפרסם כעת. ✗ כבוי = השהית/הוסר. הסטטוס מתעדכן ב-cron-live כל
                            ~10 דקות, גם על שורות היסטוריות.
                          </>
                        }
                      />
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {platformGroup.members.map((m, i) => {
                    const isActive =
                      // Phase D (2026-05-30) — prefer registry-backed
                      // delivery_status (always-fresh ≤10 min); fall back
                      // to legacy effectiveStatus when null OR when registry
                      // returned 'UNKNOWN' (mirrors classifyCampaignStatus's
                      // rung-2 fall-through so this site agrees with the
                      // Task 10 chip on the same input).
                      (m.regDeliveryStatus && m.regDeliveryStatus !== 'UNKNOWN'
                        ? m.regDeliveryStatus === 'DELIVERING'
                        : m.effectiveStatus === 'ACTIVE' ||
                          m.effectiveStatus === 'ENABLED' ||
                          m.effectiveStatus === 'ADGROUP_STATUS_DELIVERY_OK');
                    const isLeader = i === 0;
                    return (
                      <tr
                        key={m.campaignKey}
                        className={cn(
                          'border-b border-glass-edge/50 last:border-0',
                          isLeader && 'bg-accent-bg',
                        )}
                      >
                        <HelpTooltip content={m.campaignName}>
                          <td className="px-2 py-1.5 truncate max-w-[200px]">
                            {isLeader && '🥇 '}
                            {m.campaignName}
                          </td>
                        </HelpTooltip>
                        <td className="px-2 py-1.5 text-end tabular-nums">
                          {fmtMoney(m.spend)}
                        </td>
                        <td className="px-2 py-1.5 text-end tabular-nums text-ink-muted">
                          {fmtPct(m.intraPlatformSpendShare)}
                        </td>
                        <td className="px-2 py-1.5 text-end tabular-nums text-ink-muted">
                          {fmtPct(m.totalSpendShare)}
                        </td>
                        <td className="px-2 py-1.5 text-end tabular-nums">
                          {fmtMoney(m.allocatedRevenueEstimate)}
                        </td>
                        <td className="px-2 py-1.5 text-end tabular-nums text-ink-secondary">
                          {m.conversionValue > 0 ? fmtMoney(m.conversionValue) : '—'}
                        </td>
                        <td className="px-2 py-1.5 text-end tabular-nums font-semibold">
                          {fmtRoas(m.platformRoas)}
                        </td>
                        <td className="px-2 py-1.5 text-end">
                          {(() => {
                            const d = pixelShopifyDelta(
                              m.conversionValue,
                              m.allocatedRevenueEstimate,
                              platformGroup.platform,
                            );
                            const chip = (
                              <span
                                className={cn(
                                  'inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold tabular-nums border cursor-help',
                                  d.tone === 'good' &&
                                    'bg-status-greenBg text-status-greenFg border-status-green',
                                  d.tone === 'warn' &&
                                    'bg-status-orangeBg text-status-orangeFg border-status-orange',
                                  d.tone === 'bad' &&
                                    'bg-status-redBg text-status-redFg border-status-red',
                                  d.tone === 'neutral' &&
                                    'bg-glass-2 text-ink-muted border-glass-edge',
                                )}
                              >
                                {d.text}
                              </span>
                            );
                            return (
                              <HoverTooltip
                                trigger={chip}
                                title="פער pixel↔Shopify"
                                body={d.tooltip}
                              />
                            );
                          })()}
                        </td>
                        <td className="px-2 py-1.5 text-end">
                          <span
                            className={cn(
                              'inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-medium border',
                              isActive
                                ? 'bg-status-greenBg text-status-greenFg border-status-green'
                                : 'bg-glass-2 text-ink-muted border-glass-edge',
                            )}
                          >
                            {isActive ? 'פעיל' : 'כבוי'}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </TableBase>
              </div>
            </div>
          ))}
        </div>
      )}
    </li>
  );
}

// =============================================================================
// Tooltip helpers — Tooltip-system-redesign · Phase 3b (2026-06-03).
//
// The two bespoke hover-popovers (HoverTooltip, ColHelp) that hand-rolled a
// grace-timer + absolutely-positioned bubble (which got CLIPPED by the table's
// overflow-auto wrapper) are gone. Both now delegate to the single sanctioned
// HelpTooltip primitive in variant="rich" mode — a portalled Radix Popover
// (role="dialog") on desktop that escapes the scroll container and flips/shifts
// on collision, and the primitive's ⓘ / bottom-Sheet path on touch. Every
// header's exact help text is preserved verbatim.
// =============================================================================

/**
 * Generic rich popover used for the pixel↔Shopify delta chip. The chip is the
 * trigger; HelpTooltip owns hover-intent (desktop) / tap (touch), Esc, flip,
 * and portalling.
 */
function HoverTooltip({
  trigger,
  title,
  body,
}: {
  trigger: ReactNode;
  title?: string;
  body: ReactNode;
}) {
  return (
    <HelpTooltip variant="rich" title={title} content={body} align="end">
      {trigger}
    </HelpTooltip>
  );
}

/**
 * Column-header help. Renders the label inline next to a small ⓘ affordance
 * that opens a rich popover (title = the column label, body = the explanation).
 * The ⓘ button is the trigger so the popover never sits inside a role=tooltip
 * with focusable content, and — being portalled — is no longer clipped by the
 * table's `overflow-auto` wrapper.
 */
function ColHelp({
  label,
  body,
  align = 'end',
}: {
  label: string;
  body: ReactNode;
  align?: 'start' | 'end';
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1',
        align === 'start' ? 'justify-start' : 'justify-end',
      )}
    >
      <span>{label}</span>
      <HelpTooltip
        variant="rich"
        title={label}
        content={body}
        align={align}
        // 2026-06-11 adversarial-review fix (wave-8A item 2 parity, touch
        // double-ⓘ): the violet ⓘ Button below IS the help affordance — on
        // touch it becomes the tap trigger itself instead of being paired
        // with a duplicate gray ⓘ (which left the violet one dead — its only
        // handler is stopPropagation). Mirrors CampaignsTable's header help.
        touchTrigger="child"
      >
        <Button
          type="button"
          variant="ghost"
          onClick={(e) => e.stopPropagation()}
          aria-label={`הסבר על ${label}`}
          className="!p-0 inline-flex items-center justify-center w-5 h-5 shrink-0 rounded-full bg-accent text-accent-fg hover:bg-accent-deep transition-colors"
        >
          <Info size={11} aria-hidden="true" />
        </Button>
      </HelpTooltip>
    </span>
  );
}
