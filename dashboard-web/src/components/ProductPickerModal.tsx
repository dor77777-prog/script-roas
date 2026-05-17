'use client';

import { useEffect, useMemo, useState } from 'react';
import useSWR from 'swr';
import { Package, Search, X, Check } from 'lucide-react';
import { cn, formatCurrency, formatNumber } from '@/lib/utils';
import type { ProductRow } from '@/lib/products';
import type { ProductsResponse } from '@/app/api/products/route';

/**
 * Multi-select picker for tagging which Shopify product(s) a campaign
 * promotes. Pulls products from `/api/products` filtered to the caller's
 * `storeId`, ranks them by recent sales (most-active first), and lets the
 * user check / uncheck multiple. On save, calls `onSave(productIds)` with
 * the full new list.
 *
 * Implementation notes:
 * - Search box filters by product title (case-insensitive, RTL-aware via
 *   String.prototype.includes — Hebrew comparison works naturally).
 * - We dedupe products by productId because /api/products returns one row
 *   per (date, product) and the same product appears many times.
 * - "Top 5 sellers" sit at the top of the list when search is empty, so
 *   the common-case (mapping a hero product) is one click away.
 */

const fetcher = async (url: string): Promise<ProductsResponse> => {
  const r = await fetch(url);
  if (!r.ok) return { rows: [], lastUpdated: new Date().toISOString() };
  return r.json();
};

type Props = {
  open: boolean;
  onClose: () => void;
  storeId: string;
  campaignName: string;
  /** Currently-mapped product IDs for this campaign. */
  initial: string[];
  onSave: (productIds: string[]) => void;
};

/** Aggregated product row used inside the picker — dedupes the
 *  many-rows-per-product result of /api/products. */
type PickableProduct = {
  productId: string;
  title: string;
  totalUnits: number;
  totalRevenue: number;
};

export function ProductPickerModal({
  open,
  onClose,
  storeId,
  campaignName,
  initial,
  onSave,
}: Props) {
  const { data, isLoading } = useSWR<ProductsResponse>(
    open ? '/api/products' : null,
    fetcher,
    { revalidateOnFocus: false, dedupingInterval: 60_000 },
  );

  const [selected, setSelected] = useState<Set<string>>(() => new Set(initial));
  const [query, setQuery] = useState('');

  // Reset selection whenever the modal re-opens for a different campaign.
  useEffect(() => {
    if (open) {
      setSelected(new Set(initial));
      setQuery('');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initial.join('|')]);

  // Esc to close (without saving). Mirrors AdsDrawer/CampaignDrawer pattern.
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  // Dedupe + aggregate the multi-day product rows into one entry per
  // productId. Sort by units desc so heroes float to the top.
  const products: PickableProduct[] = useMemo(() => {
    if (!data?.rows) return [];
    const byId = new Map<string, PickableProduct>();
    for (const r of data.rows as ProductRow[]) {
      if (r.storeId !== storeId) continue;
      if (!r.productId) continue;
      const existing = byId.get(r.productId);
      const net = r.netRevenue ?? r.revenue;
      if (existing) {
        existing.totalUnits += r.units;
        existing.totalRevenue += net;
      } else {
        byId.set(r.productId, {
          productId: r.productId,
          title: r.productTitle || '(ללא שם)',
          totalUnits: r.units,
          totalRevenue: net,
        });
      }
    }
    return Array.from(byId.values()).sort((a, b) => b.totalUnits - a.totalUnits);
  }, [data, storeId]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return products;
    return products.filter(
      p =>
        p.title.toLowerCase().includes(q) ||
        p.productId.includes(q),
    );
  }, [products, query]);

  function toggle(id: string) {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function save() {
    onSave(Array.from(selected));
    onClose();
  }

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[70] flex animate-fade-in"
      role="dialog"
      aria-modal="true"
      aria-labelledby="product-picker-title"
    >
      <div
        className="absolute inset-0 bg-text-primary/45 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden
      />
      <div
        dir="rtl"
        className="relative m-auto w-full sm:max-w-[560px] max-h-[88vh] bg-surface rounded-2xl shadow-elevated border border-borderSubtle flex flex-col"
      >
        <header className="flex items-center justify-between gap-3 px-4 sm:px-5 py-3 border-b border-borderSubtle">
          <div className="min-w-0 flex items-center gap-2.5">
            <span className="inline-flex items-center justify-center w-8 h-8 rounded-lg bg-primary/10 text-primary shrink-0">
              <Package size={16} />
            </span>
            <div className="min-w-0">
              <div className="text-[10px] uppercase tracking-[0.12em] font-semibold text-text-muted">
                שייך מוצרי Shopify לקמפיין
              </div>
              <h2 id="product-picker-title" className="text-sm sm:text-base font-bold text-text-primary tracking-tight truncate" title={campaignName}>
                {campaignName}
              </h2>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded hover:bg-surfaceMuted text-text-muted hover:text-text-primary shrink-0"
            aria-label="סגור"
          >
            <X size={18} />
          </button>
        </header>

        <div className="px-4 sm:px-5 py-3 border-b border-borderSubtle">
          <p className="text-[11px] sm:text-xs text-text-secondary leading-relaxed mb-2.5">
            בחר את המוצרים שהקמפיין מקדם. ה-ROAS יחושב מחדש לפי מכירות
            Shopify אמיתיות במקום ערך ההמרה ש-Meta דיווח.{' '}
            <span className="text-text-muted">
              אם יותר מקמפיין משויך לאותו מוצר, ההכנסה מחולקת ביניהם פרופורציונלית
              להוצאה.
            </span>
          </p>
          <div className="relative">
            <Search size={14} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-text-muted pointer-events-none" />
            <input
              type="text"
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="חפש מוצר…"
              className="w-full rounded-lg border border-border bg-surface ps-3 pe-9 py-2 text-sm focus:outline-none focus:border-primary focus:shadow-focus"
              autoFocus
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-2 sm:px-3 py-2">
          {isLoading && (
            <div className="text-center text-sm text-text-muted py-10">
              טוען מוצרים…
            </div>
          )}
          {!isLoading && filtered.length === 0 && (
            <div className="text-center text-sm text-text-muted py-10">
              <Package size={28} className="mx-auto mb-2 text-text-muted/60" />
              {query
                ? 'אין מוצרים שמתאימים לחיפוש.'
                : 'אין מוצרים זמינים לחנות הזאת. ודא ש-products-daily מאוכלס.'}
            </div>
          )}
          {filtered.length > 0 && (
            <ul className="space-y-1">
              {filtered.map(p => {
                const isOn = selected.has(p.productId);
                return (
                  <li key={p.productId}>
                    <button
                      type="button"
                      onClick={() => toggle(p.productId)}
                      className={cn(
                        'w-full text-start rounded-lg px-3 py-2 flex items-center gap-3 transition-colors',
                        isOn
                          ? 'bg-primary/10 hover:bg-primary/15'
                          : 'hover:bg-surfaceMuted',
                      )}
                      aria-pressed={isOn}
                    >
                      <span
                        className={cn(
                          'inline-flex items-center justify-center w-5 h-5 rounded border-2 shrink-0 transition-colors',
                          isOn
                            ? 'bg-primary border-primary text-white'
                            : 'border-border bg-surface',
                        )}
                      >
                        {isOn && <Check size={12} strokeWidth={3} />}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className={cn(
                          'text-sm truncate',
                          isOn ? 'font-semibold text-text-primary' : 'text-text-primary',
                        )} title={p.title}>
                          {p.title}
                        </div>
                        <div className="text-[10px] sm:text-[11px] text-text-muted tabular-nums">
                          {formatNumber(p.totalUnits, 0)} יח&apos; · CAD {formatCurrency(p.totalRevenue)}
                        </div>
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <footer className="flex items-center justify-between gap-3 px-4 sm:px-5 py-3 border-t border-borderSubtle bg-surfaceMuted/30">
          <span className="text-[11px] sm:text-xs text-text-secondary tabular-nums">
            <strong className="text-text-primary">{selected.size}</strong> נבחרו
          </span>
          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              className="rounded-lg border border-border text-text-secondary hover:text-text-primary px-3 py-1.5 text-xs sm:text-sm"
            >
              ביטול
            </button>
            <button
              onClick={save}
              className="inline-flex items-center gap-1 rounded-lg bg-primary text-white px-3 py-1.5 text-xs sm:text-sm font-semibold hover:bg-primary-dark"
            >
              <Check size={13} />
              שמור
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}
