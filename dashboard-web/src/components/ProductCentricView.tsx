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

import { useEffect, useMemo, useState } from 'react';
import useSWR from 'swr';
import { ChevronDown, ChevronLeft, Package, Trophy } from 'lucide-react';
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
    if (isAllStores || !productsData?.rows) return out;
    for (const r of productsData.rows) {
      if (r.storeName !== storeId) continue;
      if (!out.has(r.productId) && r.productTitle) out.set(r.productId, r.productTitle);
    }
    return out;
  }, [productsData, storeId, isAllStores]);

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
      <section className="rounded-2xl bg-surface border border-borderSubtle shadow-card p-4 sm:p-5">
        <h2 className="text-base font-semibold text-text-primary inline-flex items-center gap-2 mb-1.5">
          <Package size={16} className="text-text-secondary" />
          מוצרים → קמפיינים
        </h2>
        <div className="text-sm text-text-muted">
          בחר חנות ספציפית בפילטר העליון כדי לראות את הפיבוט. (מיפויים הם לפי
          חנות; ב-"All" אין דרך לאחד.)
        </div>
      </section>
    );
  }

  if (!campaignsData || !productsData) {
    return (
      <section className="rounded-2xl bg-surface border border-borderSubtle shadow-card p-4 sm:p-5">
        <div className="text-sm text-text-muted">טוען…</div>
      </section>
    );
  }

  if (allRows.length === 0) {
    return (
      <section className="rounded-2xl bg-surface border border-borderSubtle shadow-card p-4 sm:p-5">
        <h2 className="text-base font-semibold text-text-primary inline-flex items-center gap-2 mb-1.5">
          <Package size={16} className="text-text-secondary" />
          מוצרים → קמפיינים
        </h2>
        <div className="text-sm text-text-muted">
          אין מיפויים פעילים. ברגע שתוסיף מיפוי דרך מגירת הקמפיין, הוא יופיע כאן.
        </div>
      </section>
    );
  }

  return (
    <section className="rounded-2xl bg-surface border border-borderSubtle shadow-card p-4 sm:p-5">
      <div className="flex items-center justify-between gap-3 mb-3">
        <h2 className="text-base font-semibold text-text-primary inline-flex items-center gap-2">
          <Package size={16} className="text-text-secondary" />
          מוצרים → קמפיינים
          <span className="text-[11px] font-normal text-text-muted">
            ({multiCount} עם 2+ קמפיינים{soloCount > 0 ? ` · ${soloCount} עם קמפיין אחד` : ''})
          </span>
        </h2>
        {soloCount > 0 && (
          <label className="inline-flex items-center gap-1.5 text-xs text-text-secondary cursor-pointer">
            <input
              type="checkbox"
              checked={showSolo}
              onChange={e => setShowSolo(e.target.checked)}
              className="rounded border-border"
            />
            הצג גם מוצרים עם קמפיין אחד
          </label>
        )}
      </div>

      {rows.length === 0 ? (
        <div className="text-sm text-text-muted text-center py-6">
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
  return (
    <li className="rounded-lg border border-borderSubtle overflow-hidden">
      <button
        type="button"
        onClick={onToggle}
        className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-surfaceMuted/40 transition-colors text-start"
      >
        <span className="shrink-0 text-text-muted">
          {expanded ? <ChevronDown size={14} /> : <ChevronLeft size={14} />}
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold text-text-primary truncate" title={row.productTitle}>
            {row.productTitle}
            {row.isMultiMapped && (
              <span className="inline-block text-[10px] font-bold tracking-wider align-middle bg-amber-100 text-amber-800 border border-amber-300 px-1.5 py-0.5 rounded ms-2">
                🔗 {row.members.length} קמפיינים
              </span>
            )}
          </div>
          <div className="text-[11px] text-text-muted tabular-nums">
            הוצאת קבוצה: CAD {formatCurrency(row.totalCohortSpend)} · הכנסות נטו:{' '}
            CAD {formatCurrency(row.totalNetRevenue)} · ROAS משוקלל:{' '}
            <strong className="text-text-secondary">{fmtRoas(row.blendedRoas)}</strong>
          </div>
        </div>
        {row.byPlatform.length > 0 && (
          <div className="hidden sm:flex items-center gap-1.5 text-[10px] text-text-muted shrink-0">
            {row.byPlatform.map(p => (
              <span key={p.platform} className="bg-surfaceMuted px-1.5 py-0.5 rounded">
                {p.platform}: {p.members.length}
              </span>
            ))}
          </div>
        )}
      </button>

      {expanded && (
        <div className="px-3 pb-3 pt-1 space-y-3 bg-surfaceMuted/20">
          {row.byPlatform.map(platformGroup => (
            <div key={platformGroup.platform}>
              <div className="flex items-center justify-between gap-2 mb-1.5 text-[11px]">
                <span className="font-semibold text-text-primary inline-flex items-center gap-1.5">
                  <Trophy size={12} className="text-text-muted" />
                  {platformGroup.platform} ({platformGroup.members.length})
                </span>
                <span className="text-text-muted tabular-nums">
                  הוצאת פלטפ.: CAD {formatCurrency(platformGroup.intraSpend)} · הכנסה מוקצית:
                  {' '}CAD {formatCurrency(platformGroup.intraAllocatedRevenue)}
                </span>
              </div>
              <table className="w-full text-xs">
                <thead className="bg-surfaceMuted/60 text-text-muted">
                  <tr>
                    <th className="px-2 py-1 text-start font-medium text-[10px]">קמפיין</th>
                    <th className="px-2 py-1 text-end font-medium text-[10px]">הוצאה</th>
                    <th className="px-2 py-1 text-end font-medium text-[10px]">חלק (פנים-פלטפ.)</th>
                    <th className="px-2 py-1 text-end font-medium text-[10px]">חלק (כללי)</th>
                    <th className="px-2 py-1 text-end font-medium text-[10px]">הכנסה מוקצית</th>
                    <th className="px-2 py-1 text-end font-medium text-[10px]">ROAS פלטפ.</th>
                    <th className="px-2 py-1 text-end font-medium text-[10px]">סטטוס</th>
                  </tr>
                </thead>
                <tbody>
                  {platformGroup.members.map((m, i) => {
                    const isActive =
                      m.effectiveStatus === 'ACTIVE' ||
                      m.effectiveStatus === 'ENABLED' ||
                      m.effectiveStatus === 'ADGROUP_STATUS_DELIVERY_OK';
                    const isLeader = i === 0;
                    return (
                      <tr
                        key={m.campaignKey}
                        className={cn(
                          'border-b border-borderSubtle/50 last:border-0',
                          isLeader && 'bg-primary/5',
                        )}
                      >
                        <td className="px-2 py-1.5 truncate max-w-[200px]" title={m.campaignName}>
                          {isLeader && '🥇 '}
                          {m.campaignName}
                        </td>
                        <td className="px-2 py-1.5 text-end tabular-nums">
                          CAD {formatCurrency(m.spend)}
                        </td>
                        <td className="px-2 py-1.5 text-end tabular-nums text-text-muted">
                          {fmtPct(m.intraPlatformSpendShare)}
                        </td>
                        <td className="px-2 py-1.5 text-end tabular-nums text-text-muted">
                          {fmtPct(m.totalSpendShare)}
                        </td>
                        <td className="px-2 py-1.5 text-end tabular-nums">
                          CAD {formatCurrency(m.allocatedRevenueEstimate)}
                        </td>
                        <td className="px-2 py-1.5 text-end tabular-nums font-semibold">
                          {fmtRoas(m.platformRoas)}
                        </td>
                        <td className="px-2 py-1.5 text-end">
                          <span
                            className={cn(
                              'inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-medium border',
                              isActive
                                ? 'bg-roas-greenBg/40 text-roas-green border-roas-green/30'
                                : 'bg-surfaceMuted text-text-muted border-borderSubtle',
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
          ))}
        </div>
      )}
    </li>
  );
}
