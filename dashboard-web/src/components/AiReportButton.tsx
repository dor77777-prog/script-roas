'use client';

import { useEffect, useState } from 'react';
import useSWR, { useSWRConfig } from 'swr';
import { Bot, Copy, Check, Download, X, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { generateAiReport } from '@/lib/aiReport';
import { Button } from '@/components/ui/Button';
import { Textarea } from '@/components/ui/Textarea';
import { Heading } from '@/components/ui/Typography';
import type { DashboardData, Filters as F } from '@/lib/types';
import type { ProductsResponse } from '@/app/api/products/route';
import type { CampaignsResponse } from '@/app/api/campaigns/route';
import type { OrdersAttributionResponse } from '@/app/api/orders-attribution/route';
import type { AdsResponse } from '@/app/api/ads/route';
import { buildDateRangeKey } from '@/lib/dateRange';
import { readProductMap } from '@/lib/campaignProductMap';

const fetcher = (url: string) => fetch(url).then(r => r.ok ? r.json() : null);

type Props = {
  data: DashboardData;
  filters: F;
  /** Increment this number to trigger the modal from outside (e.g. command
   *  palette). The internal click handler keeps working independently. */
  openSignal?: number;
};

/**
 * Opens a modal that generates a markdown report of the current store +
 * date-range scope, ready to paste into ChatGPT / Claude / Gemini.
 *
 * The report includes:
 *  - period KPIs (revenue, spend, ROAS, COGS, net)
 *  - daily breakdown
 *  - top products with margin
 *  - top campaigns with ROAS / CTR / CPC / CPA
 *  - ad-set drill-down for the 5 highest-spend campaigns
 *  - a suggested prompt at the bottom so the user doesn't have to think
 */
export function AiReportButton({ data, filters, openSignal }: Props) {
  const [open, setOpen] = useState(false);
  const [report, setReport] = useState<string>('');
  const [generating, setGenerating] = useState(false);
  const [copied, setCopied] = useState(false);

  // External trigger: when openSignal changes (and is > 0), open the modal.
  useEffect(() => {
    if (openSignal !== undefined && openSignal > 0) {
      setOpen(true);
      setReport('');
    }
  }, [openSignal]);

  // Phase 12.5.x audit fix (2026-05-24, HIGH+MEDIUM #1,#4) — range-key
  // ALL four SWR fetchers consistently. Before this fix, /api/products and
  // /api/campaigns used static keys → changing the global range or store
  // wouldn't invalidate the cache, so the report was sometimes generated
  // against the WRONG range's data. The orders + ads keys were already
  // range-keyed; this brings products + campaigns into line.
  const productsKey = open ? buildDateRangeKey('/api/products', filters.range) : null;
  const campaignsKey = open ? buildDateRangeKey('/api/campaigns', filters.range) : null;
  const ordersKey = open ? buildDateRangeKey('/api/orders-attribution', filters.range) : null;
  const adsKey = open ? buildDateRangeKey('/api/ads', filters.range) : null;
  const { data: products } = useSWR<ProductsResponse | null>(productsKey, fetcher, {
    revalidateOnFocus: false,
  });
  const { data: campaigns } = useSWR<CampaignsResponse | null>(campaignsKey, fetcher, {
    revalidateOnFocus: false,
  });
  const { data: orders } = useSWR<OrdersAttributionResponse | null>(ordersKey, fetcher, {
    revalidateOnFocus: false,
  });
  const { data: ads } = useSWR<AdsResponse | null>(adsKey, fetcher, {
    revalidateOnFocus: false,
  });

  // Phase 12.5.x audit fix (2026-05-24, HIGH #1) — when the operator edits
  // the product-map (CampaignDrawer / picker), invalidate the SWR caches the
  // report depends on so the next "Generate" picks up the fresh mapping.
  // Without this, /api/campaigns response was cached for the full session
  // and the report still showed the OLD mapping until a manual page
  // refresh. Cache invalidation is idempotent + cheap (just marks stale,
  // doesn't fetch until next access).
  const { mutate } = useSWRConfig();
  useEffect(() => {
    function invalidate() {
      if (productsKey) mutate(productsKey);
      if (campaignsKey) mutate(campaignsKey);
    }
    window.addEventListener('roas-campaign-product-map-changed', invalidate);
    return () => window.removeEventListener('roas-campaign-product-map-changed', invalidate);
  }, [productsKey, campaignsKey, mutate]);

  async function handleGenerate() {
    setGenerating(true);
    try {
      // Defer to next tick so the loading spinner has a chance to render.
      await new Promise(r => setTimeout(r, 50));
      // Phase 05.7.x (2026-05-23) — pass the operator's local
      // productMap so the report can build the "🔗 מוצרים משותפים"
      // section. readProductMap is sync (localStorage) so no await
      // needed; the map is small (<KB).
      //
      // Audit fix 2026-05-23 (a/WARN-4): also resolve the operator's
      // selected store NAME (filters.store) into the stable storeId via
      // data.rows lookup. The aiReport function uses storeId for
      // row-filtering when provided (fall back to storeName for back-
      // compat). data.rows is guaranteed to have at least one row per
      // selected store in the current range — when none match (operator
      // picked a store with zero activity), storeId is null and the
      // report falls back to the storeName path.
      const resolvedStoreId =
        filters.store === 'All'
          ? null
          : (data.rows.find(r => r.storeName === filters.store)?.storeId ?? null);
      const md = generateAiReport({
        storeName: filters.store,
        storeId: resolvedStoreId,
        range: filters.range,
        dailyRows: data.rows,
        productRows: products?.rows ?? [],
        campaignRows: campaigns?.rows ?? [],
        ordersRows: orders?.rows ?? [],
        adsRows: ads?.rows ?? [],
        productMap: readProductMap(),
      });
      setReport(md);
    } finally {
      setGenerating(false);
    }
  }

  async function handleCopy() {
    if (!report) return;
    try {
      await navigator.clipboard.writeText(report);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // Clipboard blocked — user can still select & copy manually from the textarea.
    }
  }

  function handleDownload() {
    if (!report) return;
    const blob = new Blob([report], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const storeSlug =
      filters.store === 'All' ? 'all-stores' : filters.store.replace(/\s+/g, '-').toLowerCase();
    a.download = `roas-report_${storeSlug}_${filters.range.from}_${filters.range.to}.md`;
    a.click();
    URL.revokeObjectURL(url);
  }

  // Orders are nice-to-have (the report degrades gracefully when missing),
  // so we don't gate "create report" on them — only the core two datasets.
  const dataReady = !!products && !!campaigns;

  return (
    <>
      <Button
        type="button"
        size="sm"
        onClick={() => { setOpen(true); setReport(''); }}
        className="gap-2 shadow-glass"
      >
        <Bot size={15} />
        ייצא דוח ל-AI
      </Button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 backdrop-blur-sm animate-fade-in"
          onClick={() => setOpen(false)}
        >
          <div
            dir="rtl"
            className="bg-glass-1 w-full sm:max-w-3xl sm:mx-4 rounded-t-2xl sm:rounded-2xl shadow-sheet border border-glass-edge max-h-[90vh] flex flex-col"
            onClick={e => e.stopPropagation()}
          >
            {/* Header */}
            <header className="flex items-center justify-between gap-3 px-4 sm:px-5 py-3 border-b border-glass-edge">
              <div className="flex items-center gap-2 min-w-0">
                <Bot size={18} className="text-accent shrink-0" />
                <Heading level="section" className="truncate">
                  ייצוא דוח לבינה מלאכותית
                </Heading>
              </div>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setOpen(false)}
                aria-label="סגור"
              >
                <X size={18} />
              </Button>
            </header>

            {/* Body */}
            <div className="flex-1 overflow-y-auto p-4 sm:p-5 space-y-4">
              <div className="rounded-lg bg-glass-2 border border-glass-edge p-3 sm:p-4 text-xs sm:text-sm text-ink-secondary space-y-2">
                <div className="font-semibold text-ink">היקף הדוח</div>
                <div className="flex flex-wrap gap-x-4 gap-y-1 tabular-nums">
                  <span>
                    חנות:{' '}
                    <span className="font-medium text-ink">
                      {filters.store === 'All' ? 'כל החנויות' : filters.store}
                    </span>
                  </span>
                  <span>
                    טווח:{' '}
                    <span className="font-medium text-ink">
                      {filters.range.from} → {filters.range.to}
                    </span>
                  </span>
                </div>
                <p className="text-ink-muted">
                  הדוח כולל: סיכום ביצועים · פירוט יומי · 25 מוצרים מובילים עם מרג'ין · 25
                  קמפיינים לפי ROAS עם CTR/CPC/CPA · אד-סטים של 5 הקמפיינים עם ההוצאה
                  הגבוהה · פרומפט מוכן לכלי ה-AI.
                </p>
              </div>

              {!report && (
                <Button
                  type="button"
                  onClick={handleGenerate}
                  disabled={generating || !dataReady}
                  className="w-full py-3 gap-2"
                >
                  {generating ? (
                    <>
                      <Loader2 size={16} className="animate-spin" />
                      מכין את הדוח…
                    </>
                  ) : !dataReady ? (
                    <>
                      <Loader2 size={16} className="animate-spin" />
                      טוען נתונים…
                    </>
                  ) : (
                    <>
                      <Bot size={16} />
                      צור דוח
                    </>
                  )}
                </Button>
              )}

              {report && (
                <>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      onClick={handleCopy}
                      size="sm"
                      className={cn(
                        'gap-1.5',
                        copied
                          ? 'bg-status-greenBg text-status-green hover:bg-status-greenBg'
                          : '',
                      )}
                    >
                      {copied ? <Check size={14} /> : <Copy size={14} />}
                      {copied ? 'הועתק!' : 'העתק ללוח'}
                    </Button>
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={handleDownload}
                      className="gap-1.5"
                    >
                      <Download size={14} />
                      הורד כקובץ .md
                    </Button>
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => setReport('')}
                      className="gap-1.5 mr-auto"
                    >
                      צור מחדש
                    </Button>
                  </div>
                  <Textarea
                    readOnly
                    value={report}
                    dir="rtl"
                    className="h-[400px] sm:h-[500px] bg-glass-2/40 p-3 sm:p-4 text-xs sm:text-sm font-mono leading-relaxed"
                    onClick={e => (e.target as HTMLTextAreaElement).select()}
                  />
                  <div className="text-[11px] sm:text-xs text-ink-muted">
                    טיפ: לאחר ההעתקה, הדבק ב-ChatGPT / Claude / Gemini. הפרומפט בסוף
                    הדוח כבר מכיל הוראות לניתוח, אבל אתה יכול להוסיף שאלות משלך.
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
