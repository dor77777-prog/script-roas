'use client';

import { useEffect, useMemo, useState } from 'react';
import useSWR from 'swr';
import { Package, Search, X, Check } from 'lucide-react';
import { cn, formatNumber } from '@/lib/utils';
import { fmtMoney } from '@/lib/format';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { HelpTooltip } from '@/components/ui/Tooltip';
import { Heading } from '@/components/ui/Typography';
import { Sheet, SheetContent, SheetHeader, SheetBody, SheetFooter, SheetTitle } from '@/components/ui/Sheet';
import type { ProductRow } from '@/lib/products';
import type { ProductsResponse } from '@/app/api/products/route';
import type { ProductCatalogResponse } from '@/app/api/product-catalog/route';

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
 *
 * SHELL: rendered through the shared `Sheet` primitive (`variant="modal"`),
 * NOT a hand-rolled `fixed` overlay. This picker opens ON TOP of the
 * CampaignDrawer, which is itself a modal Radix dialog (`Sheet`). A modal
 * Radix dialog marks everything OUTSIDE its content `aria-hidden` +
 * `pointer-events:none` (inert). A hand-rolled `<div className="fixed …">`
 * is outside that scope, so it rendered VISIBLE but DEAD — clicks and the
 * search box did nothing (the 2026-06-03 "can't search / can't map" bug,
 * across every campaign + platform). Routing through `Sheet` makes the
 * picker a real NESTED dialog that Radix recognises, so it escapes the
 * parent's inert scope and is fully interactive. Same fix the AdsDrawer
 * already uses (overlay + content lifted to `z-[60]` over the parent's
 * `z-50` scrim). Esc / backdrop-close / focus-trap / scroll-lock now come
 * from Radix — the old `useDrawerEsc` + custom backdrop are gone.
 */

const salesFetcher = async (url: string): Promise<ProductsResponse> => {
  const r = await fetch(url, { cache: 'no-store' });
  if (!r.ok) return { rows: [], lastUpdated: new Date().toISOString(), dataLastWriteAt: null };
  return r.json();
};
const catalogFetcher = async (url: string): Promise<ProductCatalogResponse> => {
  const r = await fetch(url, { cache: 'no-store' });
  if (!r.ok) return { rows: [], lastUpdated: new Date().toISOString() };
  return r.json();
};

type Props = {
  open: boolean;
  onClose: () => void;
  storeId: string;
  storeName: string;
  campaignName: string;
  /** Currently-mapped product IDs for this campaign. */
  initial: string[];
  /**
   * Phase 05.7.x (2026-05-23) — for each productId, the list of OTHER
   * campaign NAMES (in this same store) that already have it mapped.
   * Surfaces multi-mapping in the picker: the operator sees "🔗 גם
   * ב-N קמפיינים" next to the product so they know the same product
   * is advertised by another campaign. Multi-mapping is intentional
   * (a product can be promoted by multiple campaigns with different
   * audiences / creatives); the chip just makes it visible so the
   * operator doesn't think they accidentally double-mapped.
   * Map missing or empty → no chip rendered.
   */
  otherCampaignsByProduct?: Map<string, string[]>;
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
  storeName,
  campaignName,
  initial,
  otherCampaignsByProduct,
  onSave,
}: Props) {
  // Full catalog from <storeId>-products-catalog → drives the picker list.
  // Includes products that haven't sold yet, which products-daily misses.
  const { data: catalogData, isLoading: catalogLoading } = useSWR<ProductCatalogResponse>(
    open ? '/api/product-catalog' : null,
    catalogFetcher,
    // 30s dedupe — reasonable middle ground between "refetch every time
    // the picker opens" (wasteful) and "user must wait 5 min to see a
    // freshly-synced catalog" (the bug they just hit).
    { revalidateOnFocus: false, dedupingInterval: 30_000 },
  );
  // Sales data is overlaid as context (units sold, recent revenue) so the
  // user can see which product is the hero — but it's NOT the source of
  // truth for which products exist.
  const { data: salesData, isLoading: salesLoading } = useSWR<ProductsResponse>(
    open ? '/api/products' : null,
    salesFetcher,
    { revalidateOnFocus: false, dedupingInterval: 60_000 },
  );
  const data = salesData;
  const isLoading = catalogLoading || salesLoading;

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

  // Build the picker list from the FULL catalog (so unsold products are
  // visible too), then enrich with sales context (units / revenue) when
  // /api/products has data on the product. Sort by units desc so heroes
  // float; unsold products sit at the bottom alphabetically.
  const products: PickableProduct[] = useMemo(() => {
    // Step 1: aggregate sales by productId from products-daily. We keep
    // the most recent title we see for each product so the fallback path
    // (when catalog isn't synced yet) still has a real name.
    const salesById = new Map<string, { units: number; revenue: number; title: string }>();
    for (const r of (data?.rows as ProductRow[] | undefined) ?? []) {
      if (r.storeId !== storeId) continue;
      if (!r.productId) continue;
      const existing = salesById.get(r.productId);
      const net = r.netRevenue ?? r.revenue;
      const title = r.productTitle || existing?.title || '';
      if (existing) {
        existing.units += r.units;
        existing.revenue += net;
        if (title) existing.title = title;
      } else {
        salesById.set(r.productId, { units: r.units, revenue: net, title });
      }
    }

    // Step 2: build list from catalog (full source of truth for what
    // exists). Fall back to salesById entries when catalog is empty
    // (first-deploy edge case — catalog tab missing/empty).
    const catalogRows = (catalogData?.rows ?? []).filter(c => c.storeId === storeId);
    if (catalogRows.length > 0) {
      const out: PickableProduct[] = catalogRows.map(c => {
        const sales = salesById.get(c.productId);
        return {
          productId: c.productId,
          title: c.title,
          totalUnits: sales?.units ?? 0,
          totalRevenue: sales?.revenue ?? 0,
        };
      });
      // Heroes (sales > 0) first, sorted by units; cold inventory (sales = 0)
      // after, alphabetical so the operator can still find a specific name.
      out.sort((a, b) => {
        if ((a.totalUnits > 0) !== (b.totalUnits > 0)) {
          return a.totalUnits > 0 ? -1 : 1;
        }
        if (a.totalUnits > 0) return b.totalUnits - a.totalUnits;
        return a.title.localeCompare(b.title, 'he');
      });
      return out;
    }

    // Fallback: catalog hasn't been written yet → degrade to sold-only list.
    // Use the actual product title from products-daily so the user can at
    // least recognise products by name; a small warning lives in the
    // header banner (rendered separately) explaining the missing catalog.
    return Array.from(salesById.entries())
      .map(([productId, s]) => ({
        productId,
        title: s.title || `(ללא שם · ${productId})`,
        totalUnits: s.units,
        totalRevenue: s.revenue,
      }))
      .sort((a, b) => b.totalUnits - a.totalUnits);
  }, [catalogData, data, storeId]);
  // Signal whether we're rendering the catalog or the sold-only fallback —
  // drives the warning banner at the top of the picker.
  const usingCatalog = (catalogData?.rows ?? []).some(c => c.storeId === storeId);

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

  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()}>
      <SheetContent
        variant="modal"
        dir="rtl"
        // Radix needs a Title for screen-reader users (rendered sr-only below)
        // and an explicit opt-out of the optional Description.
        aria-describedby={undefined}
        // We render a bespoke close X inside the header (start-aligned, next
        // to the title block) — suppress the Sheet's auto-injected one.
        hideDefaultClose
        // Picker opens OVER the campaign modal (Sheet z-50). Lift the overlay
        // + content to z-[60] so the parent's scrim can't cover it — identical
        // to AdsDrawer. Routing through Sheet is also what makes the picker a
        // real nested Radix dialog (escapes the parent's inert scope — the bug
        // fix). 560px keeps it narrower than the campaign modal; max-sm makes
        // it a full-screen sheet (handled by variant="modal").
        overlayClassName="z-[60]"
        className={cn('z-[60] p-0 gap-0 sm:max-w-[560px]')}
      >
        <SheetTitle className="sr-only">{`שייך מוצרי ${storeName} לקמפיין ${campaignName}`}</SheetTitle>
        <SheetHeader className="flex items-center justify-between gap-3 sm:px-5 py-3">
          <div className="min-w-0 flex items-center gap-2.5">
            <span className="inline-flex items-center justify-center w-8 h-8 rounded-lg bg-accent-soft text-accent shrink-0">
              <Package size={16} />
            </span>
            <div className="min-w-0">
              <div className="text-[10px] uppercase tracking-[0.12em] font-semibold text-ink-muted">
                שייך מוצרי {storeName} לקמפיין
              </div>
              <HelpTooltip content={campaignName}>
                <Heading level="section" id="product-picker-title" className="font-bold truncate">
                  {campaignName}
                </Heading>
              </HelpTooltip>
              <div className="text-[10px] text-ink-muted mt-0.5 inline-flex items-center gap-1">
                <span>מוצגים רק מוצרים מחנות:</span>
                <span className="font-semibold text-accent">{storeName}</span>
              </div>
            </div>
          </div>
          <Button
            variant="ghost"
            size="icon"
            onClick={onClose}
            aria-label="סגור"
            className="shrink-0"
          >
            <X size={18} />
          </Button>
        </SheetHeader>

        <div className="px-4 sm:px-5 py-3 border-b border-glass-edge">
          {!isLoading && !usingCatalog && (
            <div className="mb-2.5 rounded-md bg-status-warningBg border border-status-warning px-2.5 py-2 text-[11px] text-status-warningFg leading-relaxed">
              <strong>הקטלוג עוד לא סונכרן.</strong> מוצגים רק מוצרים שכבר ביצעו
              מכירה. כדי לראות את כל המוצרים בחנות (כולל חדשים בלי הזמנות),
              לחץ על <code className="font-mono bg-status-warningBg px-1 rounded">Sync now</code>{' '}
              בקונסולת האופרטור — או המתן לריצת ה-cron היומית הבאה (00:05 שעון ישראל).
            </div>
          )}
          <p className="text-[11px] sm:text-xs text-ink-secondary leading-relaxed mb-2.5">
            בחר את המוצרים שהקמפיין מקדם. ה-ROAS יחושב מחדש לפי מכירות
            Shopify אמיתיות במקום ערך ההמרה ש-Meta דיווח.{' '}
            <span className="text-ink-muted">
              אם יותר מקמפיין משויך לאותו מוצר, ההכנסה מחולקת ביניהם פרופורציונלית
              להוצאה.
            </span>
          </p>
          {/*
            HIGH-2 audit fix (2026-05-23): use the logical `end-…`
            property (Tailwind v3 emits `inset-inline-end`) instead of
            `right-…`. The picker is rendered inside a `dir="rtl"`
            Hebrew document, where physical right == start (not end).
            The Input's `suffix` slot anchors next to the field's
            `pe-9` padded edge in BOTH directions.
          */}
          <Input
            type="search"
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="חפש מוצר…"
            autoFocus
            suffix={<Search size={14} />}
          />
        </div>

        <SheetBody className="px-2 sm:px-3 py-2">
          {isLoading && (
            <div className="text-center text-sm text-ink-muted py-10">
              טוען מוצרים…
            </div>
          )}
          {!isLoading && filtered.length === 0 && (
            <div className="text-center text-sm text-ink-muted py-10">
              <Package size={28} className="mx-auto mb-2 text-ink-subtle" />
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
                    <Button
                      type="button"
                      variant="ghost"
                      onClick={() => toggle(p.productId)}
                      className={cn(
                        'w-full justify-start h-auto px-3 py-2 gap-3',
                        isOn
                          ? 'bg-accent-bg hover:bg-accent-soft'
                          : 'hover:bg-glass-2',
                      )}
                      aria-pressed={isOn}
                    >
                      <span
                        className={cn(
                          'inline-flex items-center justify-center w-5 h-5 rounded border-2 shrink-0 transition-colors',
                          isOn
                            ? 'bg-accent border-accent text-accent-fg'
                            : 'border-glass-edge bg-glass-1',
                        )}
                      >
                        {isOn && <Check size={12} strokeWidth={3} />}
                      </span>
                      <div className="min-w-0 flex-1">
                        <HelpTooltip content={p.title}>
                          <div className={cn(
                            'text-sm truncate',
                            isOn ? 'font-semibold text-ink' : 'text-ink',
                          )}>
                            {p.title}
                          </div>
                        </HelpTooltip>
                        <div className="text-[10px] sm:text-[11px] text-ink-muted tabular-nums">
                          {p.totalUnits > 0 ? (
                            <>
                              {formatNumber(p.totalUnits, 0)} יח&apos; · {fmtMoney(p.totalRevenue)}
                            </>
                          ) : (
                            <span className="text-ink-muted">עדיין לא בוצעו מכירות</span>
                          )}
                        </div>
                        {(() => {
                          // Phase 05.7.x (2026-05-23) — multi-mapping
                          // visibility. Show a chip listing the OTHER
                          // campaigns (in this store) that already have
                          // this product. Multi-mapping is by design —
                          // a product can be promoted by multiple
                          // campaigns (different audiences / creatives).
                          // The chip just makes it visible so the
                          // operator knows.
                          const others = otherCampaignsByProduct?.get(p.productId) ?? [];
                          if (others.length === 0) return null;
                          const preview = others.slice(0, 2).join(' · ');
                          const more = others.length > 2 ? ` +${others.length - 2}` : '';
                          return (
                            <HelpTooltip content={`גם ממופה ל: ${others.join(', ')}`}>
                              <div className="text-[10px] mt-0.5 inline-flex items-center gap-1 text-status-warningFg bg-status-warningBg rounded px-1.5 py-0.5">
                                🔗 גם ב-{others.length} קמפיינים: {preview}{more}
                              </div>
                            </HelpTooltip>
                          );
                        })()}
                      </div>
                    </Button>
                  </li>
                );
              })}
            </ul>
          )}
        </SheetBody>

        <SheetFooter className="justify-between sm:px-5">
          <span className="text-[11px] sm:text-xs text-ink-secondary tabular-nums">
            <strong className="text-ink">{selected.size}</strong> נבחרו
          </span>
          <div className="flex items-center gap-2">
            <Button
              variant="secondary"
              size="sm"
              onClick={onClose}
            >
              ביטול
            </Button>
            <Button
              size="sm"
              onClick={save}
            >
              <Check size={13} />
              שמור
            </Button>
          </div>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
