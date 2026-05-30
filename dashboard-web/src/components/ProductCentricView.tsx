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

import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import useSWR from 'swr';
import { ChevronDown, ChevronLeft, Info, Package, Trophy } from 'lucide-react';
import { cn, formatCurrency } from '@/lib/utils';
import { buildProductCentricView, type ProductCohortRow } from '@/lib/productCentricView';
import { aggregate } from '@/lib/campaignsAggregator';
import { readProductMap, type ProductMap } from '@/lib/campaignProductMap';
import { buildDateRangeKey } from '@/lib/dateRange';
import type { CampaignsResponse } from '@/app/api/campaigns/route';
import type { ProductsResponse } from '@/app/api/products/route';

type Props = {
  storeId: string; // 'All' rendered as a hint to pick a store
  range: { from: string; to: string };
  /** Optional override — if not provided, reads from localStorage. */
  productMap?: ProductMap;
};

const fetcher = async <T,>(url: string): Promise<T | null> => {
  const r = await fetch(url);
  if (!r.ok) return null;
  return r.json();
};

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
  // Right-to-left thousand-separator formatting suitable for inline Hebrew —
  // pair it with `<bdi dir="ltr">` at the render site so the bidi algorithm
  // doesn't re-order it when neighboring Hebrew runs.
  return `CAD ${Math.round(n).toLocaleString('en-CA')}`;
}

function statBlock(rows: Array<{ label: string; value: string; emphasis?: boolean }>): ReactNode {
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 my-2 text-[11px]">
      {rows.map((r) => (
        <Fragment key={r.label}>
          <dt className="text-canvas/55">{r.label}</dt>
          <dd
            className={cn(
              'text-end tabular-nums',
              r.emphasis ? 'text-canvas font-semibold' : 'text-canvas/90',
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
      text: 'Meta בלבד',
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
  const { data: campaignsData } = useSWR<CampaignsResponse | null>(
    !isAllStores ? buildDateRangeKey('/api/campaigns', range) : null,
    fetcher,
    { revalidateOnFocus: false, dedupingInterval: 60_000 },
  );
  const { data: productsData } = useSWR<ProductsResponse | null>(
    !isAllStores ? buildDateRangeKey('/api/products', range) : null,
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
  const productNetRevenue = useMemo(() => {
    const out = new Map<string, number>();
    if (isAllStores || !productsData?.rows) return out;
    for (const r of productsData.rows) {
      if (r.storeName !== storeId) continue;
      out.set(r.productId, (out.get(r.productId) ?? 0) + (r.netRevenue ?? 0));
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

  const allRows = useMemo(
    () =>
      buildProductCentricView({
        storeId: internalStoreId,
        productMap,
        aggregated,
        productNetRevenue,
        productTitles,
      }),
    [internalStoreId, productMap, aggregated, productNetRevenue, productTitles],
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
      <section className="rounded-2xl bg-elevated border border-line-subtle shadow-sm p-4 sm:p-5">
        <h2 className="text-base font-semibold text-ink inline-flex items-center gap-2 mb-1.5">
          <Package size={16} className="text-ink-secondary" />
          מוצרים → קמפיינים
        </h2>
        <div className="text-sm text-ink-muted">
          בחר חנות ספציפית בפילטר העליון כדי לראות את הפיבוט. (מיפויים הם לפי
          חנות; ב-"All" אין דרך לאחד.)
        </div>
      </section>
    );
  }

  if (!campaignsData || !productsData) {
    return (
      <section className="rounded-2xl bg-elevated border border-line-subtle shadow-sm p-4 sm:p-5">
        <div className="text-sm text-ink-muted">טוען…</div>
      </section>
    );
  }

  if (allRows.length === 0) {
    return (
      <section className="rounded-2xl bg-elevated border border-line-subtle shadow-sm p-4 sm:p-5">
        <h2 className="text-base font-semibold text-ink inline-flex items-center gap-2 mb-1.5">
          <Package size={16} className="text-ink-secondary" />
          מוצרים → קמפיינים
        </h2>
        <div className="text-sm text-ink-muted">
          אין מיפויים פעילים. ברגע שתוסיף מיפוי דרך מגירת הקמפיין, הוא יופיע כאן.
        </div>
      </section>
    );
  }

  return (
    <section className="rounded-2xl bg-elevated border border-line-subtle shadow-sm p-4 sm:p-5">
      <div className="flex items-center justify-between gap-3 mb-3">
        <h2 className="text-base font-semibold text-ink inline-flex items-center gap-2">
          <Package size={16} className="text-ink-secondary" />
          מוצרים → קמפיינים
          <span className="text-[11px] font-normal text-ink-muted">
            ({multiCount} עם 2+ קמפיינים{soloCount > 0 ? ` · ${soloCount} עם קמפיין אחד` : ''})
          </span>
        </h2>
        {soloCount > 0 && (
          <label className="inline-flex items-center gap-1.5 text-xs text-ink-secondary cursor-pointer">
            <input
              type="checkbox"
              checked={showSolo}
              onChange={e => setShowSolo(e.target.checked)}
              className="rounded border-line"
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
    <li className="rounded-lg border border-line-subtle">
      <button
        type="button"
        onClick={onToggle}
        className={cn(
          'w-full flex items-center gap-3 px-3 py-2.5 hover:bg-elevated2/40 transition-colors text-start',
          expanded ? 'rounded-t-lg' : 'rounded-lg',
        )}
      >
        <span className="shrink-0 text-ink-muted">
          {expanded ? <ChevronDown size={14} /> : <ChevronLeft size={14} />}
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold text-ink truncate" title={row.productTitle}>
            {row.productTitle}
            {row.isMultiMapped && (
              <span className="inline-block text-[10px] font-bold tracking-wider align-middle bg-status-warningBg text-status-warningFg border border-status-warning/30 px-1.5 py-0.5 rounded ms-2">
                🔗 {row.members.length} קמפיינים
              </span>
            )}
          </div>
          <div className="text-[11px] text-ink-muted tabular-nums">
            הוצאת קבוצה: CAD {formatCurrency(row.totalCohortSpend)} · הכנסות נטו:{' '}
            CAD {formatCurrency(row.totalNetRevenue)} · ROAS משוקלל:{' '}
            <strong className="text-ink-secondary">{fmtRoas(row.blendedRoas)}</strong>
          </div>
        </div>
        {row.byPlatform.length > 0 && (
          <div className="hidden sm:flex items-center gap-1.5 text-[10px] text-ink-muted shrink-0">
            {row.byPlatform.map(p => (
              <span key={p.platform} className="bg-elevated2 px-1.5 py-0.5 rounded">
                {p.platform}: {p.members.length}
              </span>
            ))}
          </div>
        )}
      </button>

      {expanded && (
        <div className="px-3 pb-3 pt-1 space-y-3 bg-elevated2/20 rounded-b-lg">
          {row.byPlatform.map(platformGroup => (
            <div key={platformGroup.platform}>
              <div className="flex items-center justify-between gap-2 mb-1.5 text-[11px]">
                <span className="font-semibold text-ink inline-flex items-center gap-1.5">
                  <Trophy size={12} className="text-ink-muted" />
                  {platformGroup.platform} ({platformGroup.members.length})
                </span>
                <span className="text-ink-muted tabular-nums">
                  הוצאת פלטפ.: CAD {formatCurrency(platformGroup.intraSpend)} · הכנסה מוקצית:
                  {' '}CAD {formatCurrency(platformGroup.intraAllocatedRevenue)}
                </span>
              </div>
              <div className="overflow-x-auto -mx-2 sm:mx-0">
              <table className="w-full min-w-[480px] text-xs">
                <thead className="bg-elevated2/60 text-ink-muted">
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
                            המקורי של הפלטפורמה. מקור: <code dir="ltr" className="text-canvas/95">data_daily</code>.
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
                            <code dir="ltr" className="text-canvas/95">
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
                            <code dir="ltr" className="text-canvas/95">
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
                            <code dir="ltr" className="text-canvas/95">
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
                            <code dir="ltr" className="text-canvas/95">
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
                            <code dir="ltr" className="text-canvas/95">
                              (pixel − Shopify) / Shopify
                            </code>
                            .
                            <span className="block mt-2">
                              <span className="text-emerald-300">תואם</span> = פער &lt; 10%
                              (תקין).{' '}
                              <span className="text-orange-300">±10–25%</span> = סטייה
                              בינונית.{' '}
                              <span className="text-red-300">±25%+</span> /{' '}
                              <span className="text-red-300">pixel ריק</span> = הקמפיין הזה
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
                          'border-b border-line-subtle/50 last:border-0',
                          isLeader && 'bg-accent/5',
                        )}
                      >
                        <td className="px-2 py-1.5 truncate max-w-[200px]" title={m.campaignName}>
                          {isLeader && '🥇 '}
                          {m.campaignName}
                        </td>
                        <td className="px-2 py-1.5 text-end tabular-nums">
                          CAD {formatCurrency(m.spend)}
                        </td>
                        <td className="px-2 py-1.5 text-end tabular-nums text-ink-muted">
                          {fmtPct(m.intraPlatformSpendShare)}
                        </td>
                        <td className="px-2 py-1.5 text-end tabular-nums text-ink-muted">
                          {fmtPct(m.totalSpendShare)}
                        </td>
                        <td className="px-2 py-1.5 text-end tabular-nums">
                          CAD {formatCurrency(m.allocatedRevenueEstimate)}
                        </td>
                        <td className="px-2 py-1.5 text-end tabular-nums text-ink-secondary">
                          {m.conversionValue > 0 ? `CAD ${formatCurrency(m.conversionValue)}` : '—'}
                        </td>
                        <td className="px-2 py-1.5 text-end tabular-nums font-semibold">
                          {fmtRoas(m.platformRoas)}
                        </td>
                        <td className="px-2 py-1.5 text-end">
                          {(() => {
                            const d = pixelShopifyDelta(
                              m.conversionValue,
                              m.allocatedRevenueEstimate,
                            );
                            const chip = (
                              <span
                                className={cn(
                                  'inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold tabular-nums border cursor-help',
                                  d.tone === 'good' &&
                                    'bg-status-greenBg/40 text-status-green border-status-green/30',
                                  d.tone === 'warn' &&
                                    'bg-status-orangeBg/60 text-status-orange border-status-orange/30',
                                  d.tone === 'bad' &&
                                    'bg-status-redBg/60 text-status-red border-status-red/30',
                                  d.tone === 'neutral' &&
                                    'bg-elevated2 text-ink-muted border-line-subtle',
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
                                ? 'bg-status-greenBg/40 text-status-green border-status-green/30'
                                : 'bg-elevated2 text-ink-muted border-line-subtle',
                            )}
                          >
                            {isActive ? 'פעיל' : 'כבוי'}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              </div>
            </div>
          ))}
        </div>
      )}
    </li>
  );
}

// =============================================================================
// Tooltip primitives — replace native `title` attribute with a styled popover.
// Pattern mirrors MetricHelp.tsx (HIGH-5 grace timer included so the cursor
// can travel from trigger to popover without flicker).
// =============================================================================

const HIDE_GRACE_MS = 200;

function useHoverTimer() {
  const [open, setOpen] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  function cancelHide() {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }
  function scheduleHide() {
    cancelHide();
    timerRef.current = setTimeout(() => {
      setOpen(false);
      timerRef.current = null;
    }, HIDE_GRACE_MS);
  }
  useEffect(() => () => cancelHide(), []);
  return { open, setOpen, cancelHide, scheduleHide };
}

/**
 * Generic hover popover used for the pixel↔Shopify chip. The trigger is
 * rendered inline; on hover/focus we open a styled tooltip beside it. Same
 * grace-timer mechanics as MetricHelp so the cursor can travel from trigger
 * to popover without dismissing.
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
  const { open, setOpen, cancelHide, scheduleHide } = useHoverTimer();
  return (
    <span className="relative inline-flex">
      <span
        tabIndex={0}
        onMouseEnter={() => {
          cancelHide();
          setOpen(true);
        }}
        onMouseLeave={scheduleHide}
        onFocus={() => {
          cancelHide();
          setOpen(true);
        }}
        onBlur={scheduleHide}
        className="inline-flex"
      >
        {trigger}
      </span>
      {open && (
        <div
          role="tooltip"
          dir="rtl"
          onMouseEnter={cancelHide}
          onMouseLeave={scheduleHide}
          className={cn(
            'absolute z-50 top-full mt-2 end-0',
            'w-[260px] sm:w-[300px] max-w-[min(90vw,320px)]',
            'rounded-xl bg-ink text-canvas p-3 shadow-elevated',
            'text-xs leading-relaxed pointer-events-auto',
          )}
        >
          {title && <div className="font-semibold text-canvas mb-1.5">{title}</div>}
          <div className="text-canvas/85">{body}</div>
          <div
            aria-hidden
            className="absolute -top-1.5 end-3 w-2.5 h-2.5 bg-ink rotate-45"
          />
        </div>
      )}
    </span>
  );
}

/**
 * Column-header help. Renders the label inline with a small "?" affordance
 * that opens a styled popover explaining what the column shows and how it's
 * calculated. Sits inside a `<th>`.
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
  const { open, setOpen, cancelHide, scheduleHide } = useHoverTimer();
  return (
    <span
      className={cn(
        'group relative inline-flex items-center gap-1',
        align === 'start' ? 'justify-start' : 'justify-end',
      )}
    >
      <span>{label}</span>
      <button
        type="button"
        onMouseEnter={() => {
          cancelHide();
          setOpen(true);
        }}
        onMouseLeave={scheduleHide}
        onFocus={() => {
          cancelHide();
          setOpen(true);
        }}
        onBlur={scheduleHide}
        onClick={(e) => {
          e.stopPropagation();
          cancelHide();
          setOpen((o) => !o);
        }}
        aria-label={`הסבר על ${label}`}
        className="inline-flex items-center justify-center w-3.5 h-3.5 rounded-full text-ink-subtle hover:text-ink-secondary opacity-60 hover:opacity-100 transition-colors"
      >
        <Info size={10} />
      </button>
      {open && (
        <div
          role="tooltip"
          dir="rtl"
          onMouseEnter={cancelHide}
          onMouseLeave={scheduleHide}
          className={cn(
            'absolute z-50 top-full mt-2',
            align === 'start' ? 'start-0' : 'end-0',
            'w-[260px] sm:w-[300px] max-w-[min(90vw,320px)]',
            'rounded-xl bg-ink text-canvas p-3 shadow-elevated',
            'text-xs leading-relaxed pointer-events-auto',
            'font-normal text-start',
          )}
        >
          <div className="font-semibold text-canvas mb-1.5">{label}</div>
          <div className="text-canvas/85">{body}</div>
          <div
            aria-hidden
            className={cn(
              'absolute -top-1.5 w-2.5 h-2.5 bg-ink rotate-45',
              align === 'start' ? 'start-3' : 'end-3',
            )}
          />
        </div>
      )}
    </span>
  );
}
